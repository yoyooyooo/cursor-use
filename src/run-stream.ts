import { Effect, Stream } from "effect";
import { CursorApi } from "./cursor-api.ts";
import type { WireEvent } from "./cursor-events.ts";
import { Fault, assertInput, updateFault, validateAgentId, validateRunId } from "./errors.ts";
import { getRun, validate } from "./operations.ts";

export type StreamOptions = { afterEvent?: string | undefined; timeoutSeconds?: number | undefined; reconnects?: number | undefined };
const terminal = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

export function streamRun<E, R>(agentId: string, runId: string, options: StreamOptions, emit: (event: WireEvent) => Effect.Effect<void, E, R>) {
  return Effect.gen(function* () {
    const timeout = options.timeoutSeconds ?? 600;
    const reconnects = options.reconnects ?? 3;
    yield* validate(() => {
      validateAgentId(agentId); validateRunId(runId);
      assertInput(Number.isFinite(timeout) && timeout > 0 && timeout <= 3600, "Stream timeout must be between 0 and 3600 seconds.");
      assertInput(Number.isInteger(reconnects) && reconnects >= 0 && reconnects <= 10, "Reconnects must be between 0 and 10.");
      assertInput(options.afterEvent === undefined || (options.afterEvent.length > 0 && options.afterEvent.length <= 512 && !/[\r\n\0]/.test(options.afterEvent)), "Invalid SSE event ID.");
    });
    const api = yield* CursorApi;
    let lastEventId = options.afterEvent;
    let status: string | undefined;
    let events = 0;
    let connections = 0;
    let historyComplete = !options.afterEvent;
    let retentionSeconds: number | undefined;
    const work = Effect.gen(function* () {
      for (let attempt = 0; ; attempt++) {
        let done = false;
        let outputFailed = false;
        connections++;
        const result = yield* Effect.result(api.events(`/v1/agents/${agentId}/runs/${runId}/stream`, lastEventId).pipe(
          Stream.takeUntil(event => event.event === "done"),
          Stream.runForEach(event => Effect.gen(function* () {
            if ((event.event === "status" || event.event === "result") && (event.data.runId !== runId || typeof event.data.status !== "string")) return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "SSE event does not match the requested run." }));
            if (event.event === "error") return yield* Effect.fail(new Fault({ code: "STREAM_PROVIDER_ERROR", message: "Cursor reported a stream error.", providerCode: typeof event.data.code === "string" ? event.data.code : undefined, details: event.data }));
            if (event.event === "status" || event.event === "result") status = event.data.status as string;
            retentionSeconds = event.retentionSeconds ?? retentionSeconds;
            yield* emit(event).pipe(Effect.tapError(() => Effect.sync(() => { outputFailed = true; })));
            // Acknowledged here means written to the output sink, not processed downstream.
            if (event.id !== undefined) lastEventId = event.id || undefined;
            events++;
            if (event.event === "done") done = true;
          })),
        ));
        if (result._tag === "Success" && done) break;
        if (result._tag === "Failure") {
          const error = result.failure;
          if (outputFailed || !(error instanceof Fault)) return yield* Effect.fail(error);
          if (error.code === "STREAM_EXPIRED") {
            historyComplete = false;
            const run = yield* getRun(agentId, runId);
            status = run.status;
            yield* emit({ event: "snapshot", data: { ...run, replayUnavailable: true } });
            if (!terminal.has(status)) return yield* Effect.fail(new Fault({ code: "STREAM_EXPIRED", message: "Stream history expired; the run is not terminal. Use runs show/wait.", details: { agentId, runId, run } }));
            break;
          }
          if (!(error.code === "NETWORK_ERROR" || (error.status !== undefined && error.status >= 500))) return yield* Effect.fail(error);
        }
        if (attempt >= reconnects) return yield* Effect.fail(new Fault({ code: "STREAM_INTERRUPTED", message: "Stream ended before done; no cloud task was cancelled.", details: { agentId, runId, lastEventId, events, connections } }));
        yield* emit({ event: "reconnecting", data: { attempt: attempt + 1, lastEventId } });
        yield* Effect.sleep(Math.min(500 * 2 ** attempt, 5000));
      }
      if (!status || !terminal.has(status)) return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Stream completed without a known terminal run status.", details: { agentId, runId, status, lastEventId } }));
      if (status !== "FINISHED") return yield* Effect.fail(new Fault({ code: "RUN_UNSUCCESSFUL", message: `Run ended with ${status}.`, details: { agentId, runId, status, lastEventId } }));
      return { agentId, runId, status, lastEventId, events, connections, historyComplete, retentionSeconds, taskAccepted: false };
    });
    return yield* work.pipe(
      Effect.timeoutOrElse({ duration: timeout * 1000, orElse: () => Effect.fail(new Fault({ code: "WAIT_TIMEOUT", message: "Stopped consuming the stream locally; the cloud run was not cancelled." })) }),
      Effect.mapError(error => error instanceof Fault ? updateFault(error, { details: { provider: error.details, agentId, runId, lastEventId, events, connections } }) : error),
    );
  });
}
