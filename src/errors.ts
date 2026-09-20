import { Data } from "effect";

export type FaultFields = {
  readonly code: string;
  readonly message: string;
  readonly status?: number | undefined;
  readonly uncertain?: boolean | undefined;
  readonly details?: unknown;
  readonly providerCode?: string | undefined;
  readonly retryAfterSeconds?: number | undefined;
  readonly providerRequestId?: string | undefined;
};
export class Fault extends Data.TaggedError("Fault")<FaultFields> {}

export function updateFault(error: Fault, patch: Partial<FaultFields>): Fault {
  // Error.message is not enumerable; object spread alone loses it.
  return new Fault({ code: error.code, message: error.message, status: error.status, uncertain: error.uncertain, details: error.details, providerCode: error.providerCode, retryAfterSeconds: error.retryAfterSeconds, providerRequestId: error.providerRequestId, ...patch });
}

export function redact(text: string, key = process.env.CURSOR_API_KEY): string {
  return key ? text.split(key).join("[REDACTED]") : text;
}

export function assertInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Fault({ code: "INVALID_INPUT", message });
}

export function validateAgentId(id: string): string {
  assertInput(/^bc-[A-Za-z0-9-]+$/.test(id), "Expected a v1 agent ID beginning with bc-.");
  return id;
}

export function validateRunId(id: string): string {
  assertInput(/^run-[A-Za-z0-9-]+$/.test(id), "Expected a v1 run ID beginning with run-.");
  return id;
}
