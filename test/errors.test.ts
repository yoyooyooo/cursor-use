import { expect, test } from "bun:test";
import { Fault, updateFault } from "../src/errors.ts";

test("adding recovery details preserves non-enumerable messages and provider diagnostics", () => {
  const original = new Fault({ code: "PROVIDER_ERROR", message: "provider failed", providerCode: "upstream_error", retryAfterSeconds: 3, providerRequestId: "trace-1", status: 503 });
  const copied = updateFault(original, { code: "OUTCOME_UNKNOWN", uncertain: true, details: { receiptSaved: true } });
  expect(copied.message).toBe("provider failed");
  expect(copied).toMatchObject({ code: "OUTCOME_UNKNOWN", uncertain: true, status: 503, providerCode: "upstream_error", providerRequestId: "trace-1", retryAfterSeconds: 3, details: { receiptSaved: true } });
});

test("busy follow-up diagnostics keep nextStep across recovery patches", () => {
  const original = new Fault({ code: "CONFLICT", message: "busy", status: 409, providerCode: "agent_busy", nextStep: "wait-then-new-request-id" });
  const copied = updateFault(original, { details: { followUpQueued: false } });
  expect(copied).toMatchObject({ nextStep: "wait-then-new-request-id", providerCode: "agent_busy", status: 409, details: { followUpQueued: false } });
  expect(copied.message).toBe("busy");
});
