import { expect, test } from "bun:test";
import { Fault, updateFault } from "../src/errors.ts";

test("adding recovery details preserves non-enumerable messages and provider diagnostics", () => {
  const original = new Fault({ code: "PROVIDER_ERROR", message: "provider failed", providerCode: "upstream_error", retryAfterSeconds: 3, providerRequestId: "trace-1", status: 503 });
  const copied = updateFault(original, { code: "OUTCOME_UNKNOWN", uncertain: true, details: { receiptSaved: true } });
  expect(copied.message).toBe("provider failed");
  expect(copied).toMatchObject({ code: "OUTCOME_UNKNOWN", uncertain: true, status: 503, providerCode: "upstream_error", providerRequestId: "trace-1", retryAfterSeconds: 3, details: { receiptSaved: true } });
});
