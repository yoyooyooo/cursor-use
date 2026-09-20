import { Context, Effect, Layer, Stream } from "effect";
import { Fault } from "./errors.ts";
import { httpFailure, networkFailure, openCursorResponse, readResponseText, type Method, type ClientOptions } from "./http-boundary.ts";
import { cursorEvents, type WireEvent } from "./cursor-events.ts";
export type { Method } from "./http-boundary.ts";

export class CursorApi extends Context.Service<CursorApi, {
  readonly request: (method: Method, path: string, body?: unknown) => Effect.Effect<unknown, Fault>;
  readonly events: (path: string, lastEventId?: string) => Stream.Stream<WireEvent, Fault>;
}>()("cursor-use/CursorApi") {}

export function makeCursorApi(options: ClientOptions): typeof CursorApi.Service {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;

  const once = (method: Method, path: string, body?: unknown) => Effect.tryPromise({
    try: async (signal) => {
      const response = await openCursorResponse(options, method, path, signal, body);
      const text = await readResponseText(response, maxBytes, method === "POST");
      if (!response.ok) throw httpFailure(response, method, path, text, options.apiKey);
      if (response.status === 204) return {};
      try { return JSON.parse(text) as unknown; }
      catch { throw new Fault({ code: "PROVIDER_CONTRACT", message: "Cursor returned invalid JSON.", uncertain: method === "POST" }); }
    },
    catch: (error) => networkFailure(error, method, options.apiKey),
  });

  return { request: (method, path, body) => Effect.gen(function* () {
    for (let attempt = 0; ; attempt++) {
      const result = yield* Effect.result(once(method, path, body));
      if (result._tag === "Success") return result.success;
      const error = result.failure;
      const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      const rateRetry = error.status === 429 && retryAfter !== undefined && retryAfter <= 5;
      if (method !== "GET" || attempt >= 2 || (!(error.status && error.status >= 500) && !rateRetry)) return yield* Effect.fail(error);
      yield* Effect.sleep(rateRetry ? Math.max(250, retryAfter! * 1000) : 250 * 2 ** attempt);
    }
  }), events: (path, lastEventId) => cursorEvents(options, path, lastEventId) };
}

export const CursorApiLive = Layer.sync(CursorApi, () => makeCursorApi({ apiKey: process.env.CURSOR_API_KEY }));
