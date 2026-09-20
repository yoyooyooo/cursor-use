import { Effect, Stream } from "effect";
import * as Sse from "effect/unstable/encoding/Sse";
import { Fault } from "./errors.ts";
import { httpFailure, networkFailure, openCursorResponse, readResponseText, type ClientOptions } from "./http-boundary.ts";

export type WireEvent = { event: string; id?: string | undefined; data: Record<string, unknown>; retentionSeconds?: number | undefined };

export function cursorEvents(options: ClientOptions, path: string, lastEventId?: string): Stream.Stream<WireEvent, Fault> {
  return Stream.unwrap(Effect.gen(function* () {
    const controller = yield* Effect.acquireRelease(Effect.sync(() => new AbortController()), c => Effect.sync(() => c.abort()));
    const response = yield* Effect.tryPromise({ try: () => openCursorResponse({ ...options, timeoutMs: options.timeoutMs ?? 3_600_000 }, "GET", path, controller.signal, undefined, lastEventId, "text/event-stream"), catch: error => networkFailure(error, "GET", options.apiKey) });
    // Register cleanup before inspecting headers or handing the reader to Stream.
    yield* Effect.addFinalizer(() => Effect.promise(async () => { controller.abort(); if (!response.body?.locked) await response.body?.cancel().catch(() => undefined); }));
    if (!response.ok) {
      const text = yield* Effect.tryPromise({ try: () => readResponseText(response, 64 * 1024, false), catch: error => networkFailure(error, "GET", options.apiKey) });
      return yield* Effect.fail(httpFailure(response, "GET", path, text, options.apiKey));
    }
    if (!response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Expected an SSE response body." }));
    const retention = Number(response.headers.get("x-cursor-stream-retention-seconds"));
    const retentionSeconds = Number.isFinite(retention) && retention > 0 ? retention : undefined;
    let pending: Sse.AnyEvent[] = [];
    let receivedBytes = 0;
    const parser = Sse.makeParser(event => pending.push(event), { maxEventSize: 1024 * 1024 });
    return Stream.fromReadableStream({ evaluate: () => response.body!, onError: error => networkFailure(error, "GET", options.apiKey) }).pipe(
      Stream.mapEffect(chunk => Effect.try({ try: () => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > 64 * 1024 * 1024 || chunk.byteLength > 8 * 1024 * 1024) throw new Fault({ code: "STREAM_TOO_LARGE", message: "SSE connection exceeded its bounded byte budget." });
        return chunk;
      }, catch: error => networkFailure(error, "GET", options.apiKey) })),
      Stream.decodeText(),
      Stream.mapEffect(text => Effect.try({ try: () => {
        pending = [];
        const error = parser.feed(text);
        if (error) throw new Fault({ code: "STREAM_TOO_LARGE", message: "SSE event exceeded 1 MiB." });
        const result: WireEvent[] = [];
        for (const event of pending) {
          if (event._tag !== "Event") continue;
          if (Buffer.byteLength(event.data) > 1024 * 1024) throw new Fault({ code: "STREAM_TOO_LARGE", message: "SSE event exceeded 1 MiB." });
          const data: unknown = JSON.parse(event.data);
          if (!data || typeof data !== "object" || Array.isArray(data)) throw new Fault({ code: "PROVIDER_CONTRACT", message: "SSE payload must be a JSON object." });
          result.push({ event: event.event, id: event.id, data: data as Record<string, unknown>, retentionSeconds });
        }
        return result;
      }, catch: error => error instanceof Fault ? error : new Fault({ code: "PROVIDER_CONTRACT", message: "Cursor emitted malformed SSE JSON." }) })),
      Stream.flatMap(events => Stream.fromIterable(events)),
    );
  }));
}
