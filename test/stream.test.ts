import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { CursorApi, makeCursorApi } from "../src/cursor-api.ts";
import type { WireEvent } from "../src/cursor-events.ts";
import { Fault } from "../src/errors.ts";
import { streamRun } from "../src/run-stream.ts";

const agentId = "bc-stream-test";
const runId = "run-stream-test";
const path = `/v1/agents/${agentId}/runs/${runId}/stream`;
const event = (type: string, data: Record<string, unknown>, id?: string): WireEvent => ({ event: type, data, id });
const finish = [event("result", { runId, status: "FINISHED", text: "done" }, "opaque-end"), event("done", {}, "opaque-end")];
const unexpectedRequest: typeof CursorApi.Service.request = () => Effect.die("Unexpected request");

test("SSE decoder handles split UTF-8, CRLF, multiline JSON and equal result/done IDs", async () => {
  const text = ': comment\r\nevent: assistant\r\nid: opaque-1\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\nevent: result\nid: opaque-end\ndata: {"runId":"run-stream-test","status":"FINISHED"}\n\nevent: done\nid: opaque-end\ndata: {}\n\n';
  const bytes = new TextEncoder().encode(text);
  let headers: Headers | undefined;
  const api = makeCursorApi({ apiKey: "test-only-key", fetch: async (_url, init) => {
    headers = new Headers(init.headers);
    return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 2) c.enqueue(bytes.slice(i, i + 2)); c.close(); } }), { headers: { "Content-Type": "text/event-stream", "X-Cursor-Stream-Retention-Seconds": "3600" } });
  } });
  const values = await Effect.runPromise(Stream.runCollect(api.events(path, "previous")));
  expect(values.map(v => v.event)).toEqual(["assistant", "result", "done"]);
  expect(values[0]).toMatchObject({ id: "opaque-1", data: { text: "你好" }, retentionSeconds: 3600 });
  expect(values[1]?.id).toBe(values[2]?.id);
  expect(headers?.get("Last-Event-ID")).toBe("previous");
  expect(headers?.get("Accept")).toBe("text/event-stream");
});

test("SSE finalization cancels its reader and aborts its transport on interruption", async () => {
  let cancelled = false;
  let signal: AbortSignal | undefined;
  const api = makeCursorApi({ apiKey: "test-only-key", fetch: async (_url, init) => {
    signal = init.signal!;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: assistant\ndata: {"text":"hello"}\n\n')); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "text/event-stream" } });
  } });
  await Effect.runPromise(Effect.gen(function* () {
    const ready = yield* Deferred.make<void>();
    const fiber = yield* Effect.forkChild(api.events(path).pipe(Stream.runForEach(() => Deferred.succeed(ready, undefined))));
    yield* Deferred.await(ready);
    yield* Fiber.interrupt(fiber);
  }));
  expect(cancelled).toBe(true);
  expect(signal?.aborted).toBe(true);
});

test("malformed and oversized SSE events are typed failures", async () => {
  for (const [body, code] of [['event: assistant\ndata: nope\n\n', "PROVIDER_CONTRACT"], [`event: assistant\ndata: ${JSON.stringify({ text: "x".repeat(1024 * 1024) })}\n\n`, "STREAM_TOO_LARGE"]]) {
    const api = makeCursorApi({ apiKey: "test-only-key", fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }) });
    const result = await Effect.runPromise(Effect.result(Stream.runCollect(api.events(path))));
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure.code).toBe(code!);
  }
});

test("reconnect uses the last emitted event ID without dropping result/done", async () => {
  const cursors: Array<string | undefined> = [];
  const emitted: WireEvent[] = [];
  const api: typeof CursorApi.Service = { request: unexpectedRequest, events: (_path, cursor) => {
    cursors.push(cursor);
    return Stream.fromIterable(cursors.length === 1 ? [event("assistant", { text: "part" }, "opaque-1")] : finish);
  } };
  const value = await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(streamRun(agentId, runId, {}, e => Effect.sync(() => { emitted.push(e); })));
    yield* TestClock.adjust("1 second");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provideService(CursorApi, api), Effect.provide(TestClock.layer())));
  expect(cursors).toEqual([undefined, "opaque-1"]);
  expect(emitted.map(e => e.event)).toEqual(["assistant", "reconnecting", "result", "done"]);
  expect(value).toMatchObject({ connections: 2, status: "FINISHED", lastEventId: "opaque-end", historyComplete: true, taskAccepted: false });
});

test("an output failure never advances its cursor or triggers a transport retry", async () => {
  let calls = 0;
  const api: typeof CursorApi.Service = { request: unexpectedRequest, events: () => { calls++; return Stream.fromIterable([event("assistant", { text: "part" }, "new-id")]); } };
  const result = await Effect.runPromise(Effect.result(streamRun(agentId, runId, { afterEvent: "prior" }, () => Effect.fail(new Fault({ code: "NETWORK_ERROR", message: "sink failed" })))).pipe(Effect.provideService(CursorApi, api)));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toMatchObject({ code: "NETWORK_ERROR", details: { lastEventId: "prior" } });
  expect(calls).toBe(1);
});

test("stream timeout closes the source, returns a cursor and does not cancel the remote run", async () => {
  let closed = false;
  const api: typeof CursorApi.Service = { request: unexpectedRequest, events: () => Stream.fromIterable([event("assistant", { text: "part" }, "resume-here")]).pipe(Stream.concat(Stream.never), Stream.ensuring(Effect.sync(() => { closed = true; }))) };
  const result = await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.result(streamRun(agentId, runId, { timeoutSeconds: 1 }, () => Effect.void)));
    yield* TestClock.adjust("2 seconds");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provideService(CursorApi, api), Effect.provide(TestClock.layer())));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toMatchObject({ code: "WAIT_TIMEOUT", details: { lastEventId: "resume-here" } });
  expect(closed).toBe(true);
});

test("expired stream history falls back to an explicitly incomplete terminal snapshot", async () => {
  const emitted: WireEvent[] = [];
  const api: typeof CursorApi.Service = { events: () => Stream.fail(new Fault({ code: "STREAM_EXPIRED", message: "expired", status: 410 })), request: (method, target) => {
    expect(method).toBe("GET"); expect(target).toBe(`/v1/agents/${agentId}/runs/${runId}`);
    return Effect.succeed({ id: runId, agentId, status: "FINISHED", result: "final" });
  } };
  const result = await Effect.runPromise(streamRun(agentId, runId, {}, e => Effect.sync(() => { emitted.push(e); })).pipe(Effect.provideService(CursorApi, api)));
  expect(result.historyComplete).toBe(false);
  expect(emitted).toEqual([expect.objectContaining({ event: "snapshot", data: expect.objectContaining({ replayUnavailable: true, result: "final" }) })]);
});

test("stream rejects another run and reports unsuccessful terminal states", async () => {
  for (const events of [[event("status", { runId: "run-other", status: "FINISHED" }), event("done", {})], [event("result", { runId, status: "CANCELLED" }), event("done", {})]]) {
    const api: typeof CursorApi.Service = { request: unexpectedRequest, events: () => Stream.fromIterable(events) };
    const result = await Effect.runPromise(Effect.result(streamRun(agentId, runId, {}, () => Effect.void)).pipe(Effect.provideService(CursorApi, api)));
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(["PROVIDER_CONTRACT", "RUN_UNSUCCESSFUL"]).toContain(result.failure.code);
  }
});
