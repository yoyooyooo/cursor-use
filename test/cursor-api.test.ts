import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { makeCursorApi } from "../src/cursor-api.ts";

test("the HTTP boundary pins the host, refuses redirects and authenticates only with the configured key", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const api = makeCursorApi({ apiKey: "unit-test-key", fetch: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ userId: 42 });
  } });
  expect(await Effect.runPromise(api.request("GET", "/v1/me"))).toEqual({ userId: 42 });
  expect(calls[0]?.url).toBe("https://api.cursor.com/v1/me");
  expect(calls[0]?.init.redirect).toBe("error");
  expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer unit-test-key");
});

test("POST transport failures remain unknown, redact the key and never retry", async () => {
  let count = 0;
  const api = makeCursorApi({ apiKey: "unit-test-key", fetch: async () => {
    count++;
    throw new Error("connection lost unit-test-key");
  } });
  const result = await Effect.runPromise(Effect.result(api.request("POST", "/v1/agents", {})));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toMatchObject({ code: "OUTCOME_UNKNOWN", uncertain: true, message: "connection lost [REDACTED]" });
  expect(count).toBe(1);
});

test("a bodyless cancel request does not advertise a JSON body", async () => {
  let observed: RequestInit | undefined;
  const api = makeCursorApi({ apiKey: "unit-test-key", fetch: async (_url, init) => {
    observed = init;
    return Response.json({ id: "run-example" });
  } });
  expect(await Effect.runPromise(api.request("POST", "/v1/agents/bc-example/runs/run-example/cancel"))).toEqual({ id: "run-example" });
  expect(observed?.method).toBe("POST");
  expect(new Headers(observed?.headers).get("content-type")).toBeNull();
  expect(observed?.body).toBeUndefined();
});

test("GET transient failures retry with the Effect clock", async () => {
  let count = 0;
  const api = makeCursorApi({ apiKey: "unit-test-key", fetch: async () => ++count < 3 ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ userId: 42 }) });
  const value = await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(api.request("GET", "/v1/me"));
    yield* TestClock.adjust("1 second");
    yield* TestClock.adjust("1 second");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer())));
  expect(value).toEqual({ userId: 42 });
  expect(count).toBe(3);
});

test("rate limits and rejected writes are not blindly retried", async () => {
  let count = 0;
  const api = makeCursorApi({ apiKey: "unit-test-key", fetch: async () => { count++; return Response.json({ error: "slow down" }, { status: 429 }); } });
  const result = await Effect.runPromise(Effect.result(api.request("POST", "/v1/agents", {})));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toMatchObject({ code: "RATE_LIMITED", status: 429, uncertain: false });
  expect(count).toBe(1);
});

test("malformed successful writes and oversized responses cannot masquerade as success", async () => {
  const malformed = makeCursorApi({ apiKey: "unit-test-key", fetch: async () => new Response("not-json") });
  const first = await Effect.runPromise(Effect.result(malformed.request("POST", "/v1/agents", {})));
  expect(first._tag).toBe("Failure");
  if (first._tag !== "Failure") throw new Error("Expected failure");
  expect(first.failure).toMatchObject({ code: "PROVIDER_CONTRACT", uncertain: true });
  const oversized = makeCursorApi({ apiKey: "unit-test-key", maxBytes: 8, fetch: async () => Response.json({ value: "far too large" }) });
  const second = await Effect.runPromise(Effect.result(oversized.request("GET", "/v1/me")));
  expect(second._tag).toBe("Failure");
  if (second._tag !== "Failure") throw new Error("Expected failure");
  expect(second.failure.code).toBe("RESPONSE_TOO_LARGE");
});

test("HTTP request timeouts preserve unknown POST outcomes and request diagnostics", async () => {
  let count = 0;
  const api = makeCursorApi({ apiKey: "test-only-key", fetch: async () => { count++; return Response.json({ error: { code: "upstream_timeout", message: "late" } }, { status: 408, headers: { "x-request-id": "trace-1" } }); } });
  const result = await Effect.runPromise(Effect.result(api.request("POST", "/v1/agents", {})));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toMatchObject({ uncertain: true, details: { providerCode: "upstream_timeout", requestId: "trace-1" } });
  expect(count).toBe(1);
});

test("long rate-limit delays are exposed without hidden retry loops", async () => {
  let count = 0;
  const api = makeCursorApi({ apiKey: "test-only-key", fetch: async () => { count++; return Response.json({ message: "slow down" }, { status: 429, headers: { "retry-after": "60" } }); } });
  const result = await Effect.runPromise(Effect.result(api.request("GET", "/v1/repositories")));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toMatchObject({ code: "RATE_LIMITED", details: { retryAfterSeconds: 60 } });
  expect(count).toBe(1);
});
