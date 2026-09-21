import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { CursorApi, type Method } from "../src/cursor-api.ts";
import { Fault } from "../src/errors.ts";
import { launch, launchBody, previewLaunch, followUp, reconcile, waitRun, listAgents, listEnvironments, addEnvironment, getRun, bindRun, cancelRun, agentResult, showEnvironment } from "../src/operations.ts";
import { FOLLOW_UP_BUSY_NEXT_STEP } from "../src/errors.ts";
import { makeReceiptStore, ReceiptStore, type Receipt } from "../src/receipts.ts";

type Call = { method: Method; path: string; body?: unknown };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "cursor-use-test-"));
  const store = makeReceiptStore(directory);
  const calls: Call[] = [];
  const agents = new Map<string, { id: string; latestRunId: string; env: { type: string; name?: string }; repos: Array<{ url: string; startingRef?: string }> }>();
  let account = 42;
  let dropLaunch = false;
  let dropFollowUp = false;
  let followUpBusy = false;
  let runGets = 0;
  let runStatus: string | ((n: number) => string) = "FINISHED";
  let runResult: string | null = "test result";
  let returnedEnvironment: string | undefined;
  const api: typeof CursorApi.Service = { events: () => Stream.die("Unexpected SSE request"), request: (method, path, body) => Effect.suspend((): Effect.Effect<unknown, Fault> => {
    calls.push({ method, path, body });
    if (path === "/v1/me") return Effect.succeed({ userId: account });
    if (path === "/v1/models") return Effect.succeed({ items: [{ id: "test-model", parameters: [{ id: "reasoning", values: [{ value: "low" }, { value: "high" }] }], variants: [{ params: [{ id: "reasoning", value: "low" }] }, { params: [{ id: "reasoning", value: "high" }] }] }] });
    if (method === "POST" && path === "/v1/agents") {
      const payload = body as { agentId: string; env?: { name: string }; repos?: Array<{ url: string; startingRef?: string }> };
      const envName = returnedEnvironment ?? payload.env?.name;
      const repos = payload.repos ?? (payload.env?.name ? [{ url: "https://github.com/example/attached" }] : []);
      const agent = { id: payload.agentId, latestRunId: "run-initial", env: { type: "cloud", ...(envName ? { name: envName } : {}) }, repos };
      agents.set(agent.id, agent);
      return dropLaunch ? Effect.fail(new Fault({ code: "OUTCOME_UNKNOWN", message: "response lost", uncertain: true })) : Effect.succeed({ agent, run: { id: "run-initial", agentId: agent.id, status: "CREATING" } });
    }
    const agentId = path.split("/")[3]!;
    if (method === "POST" && path.endsWith("/cancel")) return Effect.succeed({ id: path.split("/")[5] });
    if (path.includes("/usage")) return Effect.succeed({ runs: [], cost: { chargedCents: 0 } });
    if (path.endsWith("/artifacts")) return Effect.succeed({ items: [{ path: "artifacts/proof.txt", sizeBytes: 4 }] });
    if (method === "POST" && path.endsWith("/runs")) {
      if (followUpBusy) return Effect.fail(new Fault({ code: "CONFLICT", message: "Agent is busy", status: 409, uncertain: false, providerCode: "agent_busy" }));
      return dropFollowUp ? Effect.fail(new Fault({ code: "OUTCOME_UNKNOWN", message: "response lost", uncertain: true })) : Effect.succeed({ run: { id: "run-followup", agentId, status: "CREATING" } });
    }
    if (path.includes("/runs/")) {
      runGets++;
      const status = typeof runStatus === "function" ? runStatus(runGets) : runStatus;
      return Effect.succeed({ id: path.split("/")[5], agentId, status, result: runResult, git: { branches: [] } });
    }
    if (path.startsWith("/v1/agents?")) return Effect.succeed({ items: [...agents.values()].map(({ id }) => ({ id })), nextCursor: "another-page" });
    const agent = agents.get(agentId);
    return agent ? Effect.succeed(agent) : Effect.fail(new Fault({ code: "NOT_FOUND", message: "missing", status: 404, uncertain: false }));
  }) };
  const run = <A, E>(effect: Effect.Effect<A, E, CursorApi | ReceiptStore>) => Effect.runPromise(effect.pipe(Effect.provideService(CursorApi, api), Effect.provideService(ReceiptStore, store)));
  return {
    directory, store, calls, agents, api, run,
    setAccount: (value: number) => { account = value; },
    dropLaunch: () => { dropLaunch = true; },
    dropFollowUp: () => { dropFollowUp = true; },
    rejectFollowUpBusy: () => { followUpBusy = true; },
    setStatus: (value: string | ((n: number) => string)) => { runStatus = value; },
    setResult: (value: string | null) => { runResult = value; },
    setReturnedEnvironment: (value: string) => { returnedEnvironment = value; },
  };
}

const input = { env: "test-env", prompt: "Read only. Return a marker.", requestId: "test-request" };

test("a completed receipt survives restart and prevents duplicate launches", async () => {
  const f = fixture();
  const first = await f.run(launch(input));
  expect(first.receipt).toMatchObject({ requestId: "test-request", state: "submitted", runId: "run-initial" });
  const restarted = makeReceiptStore(f.directory);
  const second = await Effect.runPromise(launch(input).pipe(Effect.provideService(CursorApi, f.api), Effect.provideService(ReceiptStore, restarted)));
  expect(second).toMatchObject({ replayed: true, receipt: { agentId: first.receipt.agentId } });
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  expect(f.calls.find((call) => call.method === "POST")?.body).toMatchObject({ agentId: first.receipt.agentId, env: { type: "cloud", name: "test-env" }, autoCreatePR: false, workOnCurrentBranch: false });
  const database = readFileSync(join(f.directory, "state.sqlite"));
  expect(database.includes(Buffer.from(input.prompt))).toBe(false);
});

test("a lost launch response is reconciled by identity without another POST", async () => {
  const f = fixture();
  f.dropLaunch();
  const first = await f.run(Effect.result(launch(input)));
  expect(first._tag).toBe("Failure");
  if (first._tag !== "Failure") throw new Error("Expected failure");
  expect(first.failure.code).toBe("OUTCOME_UNKNOWN");
  expect(await Effect.runPromise(f.store.get(input.requestId))).toMatchObject({ state: "unknown" });
  const recovered = await f.run(reconcile(input.requestId));
  expect(recovered).toMatchObject({ recovered: true, runAttribution: "latest_observed_not_proven_initial", receipt: { state: "submitted", runId: "run-initial" } });
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("an unconfirmed target preserves returned IDs and does not claim successful dispatch", async () => {
  const f = fixture();
  f.setReturnedEnvironment("unexpected-target");
  const result = await f.run(Effect.result(launch(input)));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toMatchObject({ code: "OUTCOME_UNKNOWN", details: { providerDetails: { agent: { env: { name: "unexpected-target" } }, run: { id: "run-initial" } } } });
  const recovered = await f.run(Effect.result(reconcile(input.requestId)));
  expect(recovered._tag).toBe("Failure");
  if (recovered._tag !== "Failure") throw new Error("Expected failure");
  expect(recovered.failure.code).toBe("OUTCOME_UNKNOWN");
  expect(await Effect.runPromise(f.store.get(input.requestId))).toMatchObject({ state: "unknown" });
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("request IDs cannot be reused with another task or account", async () => {
  const f = fixture();
  await f.run(launch(input));
  const changed = await f.run(Effect.result(launch({ ...input, prompt: "Different task" })));
  expect(changed._tag).toBe("Failure");
  if (changed._tag !== "Failure") throw new Error("Expected failure");
  expect(changed.failure.code).toBe("REQUEST_CONFLICT");
  f.setAccount(99);
  const account = await f.run(Effect.result(launch(input)));
  expect(account._tag).toBe("Failure");
  if (account._tag !== "Failure") throw new Error("Expected failure");
  expect(account.failure.code).toBe("REQUEST_CONFLICT");
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("a follow-up uses the same agent and its own durable run receipt", async () => {
  const f = fixture();
  const first = await f.run(launch(input));
  const next = await f.run(followUp({ agentId: first.receipt.agentId, prompt: "Continue read-only", requestId: "followup-1" }));
  expect(next.receipt).toMatchObject({ agentId: first.receipt.agentId, runId: "run-followup", baselineRunId: "run-initial", operation: "follow-up" });
  const repeated = await f.run(followUp({ agentId: first.receipt.agentId, prompt: "Continue read-only", requestId: "followup-1" }));
  expect(repeated).toMatchObject({ replayed: true });
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(2);
});

test("an uncertain follow-up is not automatically resent", async () => {
  const f = fixture();
  const first = await f.run(launch(input));
  f.dropFollowUp();
  const follow = { agentId: first.receipt.agentId, prompt: "Continue", requestId: "followup-1" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.run(Effect.result(followUp(follow)));
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure.code).toBe("OUTCOME_UNKNOWN");
  }
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(2);
});

test("only one database handle can claim a prepared request", async () => {
  const f = fixture();
  const receipt: Receipt = { requestId: "claim", operation: "launch", account: "42", fingerprint: "digest", agentId: "bc-example", state: "prepared", createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z" };
  await Effect.runPromise(f.store.prepare(receipt));
  const other = makeReceiptStore(f.directory);
  expect(await Effect.runPromise(Effect.all([f.store.claim("claim"), other.claim("claim")], { concurrency: "unbounded" }))).toEqual([true, false]);
  expect(await Effect.runPromise(other.get("claim"))).toMatchObject({ state: "dispatching" });
});

test("wait reports execution completion without claiming task acceptance", async () => {
  const f = fixture();
  expect(await f.run(waitRun("bc-example", "run-initial"))).toMatchObject({ run: { status: "FINISHED", result: "test result", git: { branches: [] } }, taskAccepted: false, emptyResult: false, result: "test result" });
  f.setStatus("ERROR");
  const failed = await f.run(Effect.result(waitRun("bc-example", "run-initial")));
  expect(failed._tag).toBe("Failure");
  if (failed._tag !== "Failure") throw new Error("Expected failure");
  expect(failed.failure).toMatchObject({ code: "RUN_UNSUCCESSFUL" });
});

test("a wait deadline interrupts a stalled GET, never the cloud run", async () => {
  const calls: Call[] = [];
  const api: typeof CursorApi.Service = { events: () => Stream.die("Unexpected SSE request"), request: (method, path) => { calls.push({ method, path }); return Effect.never; } };
  const result = await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.result(waitRun("bc-example", "run-initial", 1, 1)));
    yield* TestClock.adjust("2 seconds");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provideService(CursorApi, api), Effect.provide(TestClock.layer())));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure.code).toBe("WAIT_TIMEOUT");
  expect(calls).toEqual([{ method: "GET", path: "/v1/agents/bc-example/runs/run-initial" }]);
});

test("environment observations stay partial and distinguish configured names", async () => {
  const f = fixture();
  await f.run(addEnvironment("user-choice"));
  await f.run(launch(input));
  const envs = await f.run(listEnvironments(true));
  expect(envs).toMatchObject({ complete: false, hasMoreAgents: true, scannedAgents: 1 });
  expect(envs.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "user-choice", source: "configured", repos: [] }),
    expect.objectContaining({ name: "test-env", source: "observed", repos: [{ url: "https://github.com/example/attached" }] }),
  ]));
  expect(await f.run(listAgents(20, "previous"))).toMatchObject({ complete: false });
});

test("invalid targets are rejected before a remote request", async () => {
  expect(() => launchBody({ ...input, repo: "https://github.com/example/repo" })).toThrow("Choose exactly one");
  expect(() => launchBody({ ...input, ref: "main" })).toThrow("--ref requires --repo");
  const f = fixture();
  const result = await f.run(Effect.result(getRun("bc-example/../../other", "run-initial")));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure.code).toBe("INVALID_INPUT");
  expect(f.calls).toHaveLength(0);
});

test("dry-run validates targets, hides the prompt and does not create a receipt", () => {
  const preview = previewLaunch({ ...input, model: "test-model", modelParams: [{ id: "reasoning", value: "high" }] });
  expect(preview).toMatchObject({ dryRun: true, remoteValidated: false, receiptCreated: false, request: { model: { id: "test-model", params: [{ id: "reasoning", value: "high" }] }, autoCreatePR: false } });
  expect(JSON.stringify(preview)).not.toContain(input.prompt);
  expect(preview.git).toMatchObject({ source: "named-environment-snapshot", repos: [], reposProvenance: "unavailable", promptDoesNotReplaceSnapshotRepos: true, envExclusiveOfRepoAndRef: true, requestIncludesRepos: false, authoritativeAfterLaunch: "agent.repos" });
  expect(preview.request).not.toHaveProperty("repos");
  expect(preview.promptSha256).toHaveLength(64);
  expect(() => previewLaunch({ prompt: "p", env: "", scratch: true })).toThrow();
  expect(() => previewLaunch({ prompt: "p", env: "" })).toThrow();
  expect(() => previewLaunch({ prompt: "p", scratch: true, model: "" })).toThrow();
  expect(() => previewLaunch({ prompt: "p", scratch: true, requestId: "" })).toThrow();
});

test("multiple repositories preserve explicit refs and reject duplicate or unsafe targets", () => {
  const repos = [{ url: "https://github.com/example/one", startingRef: "release" }, { url: "https://github.com/example/two" }];
  expect(launchBody({ prompt: "p", repos })).toMatchObject({ repos });
  expect(() => launchBody({ prompt: "p", repos, env: "test-env" })).toThrow();
  expect(() => launchBody({ prompt: "p", repos: [] })).toThrow();
  expect(() => launchBody({ prompt: "p", repos: [repos[0]!, { url: "https://github.com/EXAMPLE/one.git/" }] })).toThrow();
  expect(() => launchBody({ prompt: "p", repo: "https://github.com:444/example/one" })).toThrow();
});

test("model parameters are checked against discovery before a paid POST", async () => {
  const f = fixture();
  const invalid = await f.run(Effect.result(launch({ ...input, model: "test-model", modelParams: [{ id: "reasoning", value: "unsupported" }] })));
  expect(invalid._tag).toBe("Failure");
  expect(f.calls.filter(c => c.method === "POST")).toHaveLength(0);
  await f.run(launch({ ...input, model: "test-model", modelParams: [{ id: "reasoning", value: "high" }] }));
  expect(f.calls.find(c => c.method === "POST")?.body).toMatchObject({ model: { id: "test-model", params: [{ id: "reasoning", value: "high" }] } });
  const before = f.calls.filter(c => c.path === "/v1/models").length;
  const replay = await f.run(launch({ ...input, model: "test-model", modelParams: [{ id: "reasoning", value: "high" }] }));
  expect(replay).toMatchObject({ replayed: true });
  expect(f.calls.filter(c => c.path === "/v1/models")).toHaveLength(before);
  expect(f.calls.filter(c => c.method === "POST")).toHaveLength(1);
});

test("confirmed receipts cannot be downgraded by late timeout or stale observation", async () => {
  const f = fixture();
  const created = await f.run(launch(input));
  expect(created.receipt.runAttribution).toBe("confirmed");
  await Effect.runPromise(f.store.update(input.requestId, { state: "unknown", error: "late timeout" }));
  await Effect.runPromise(f.store.update(input.requestId, { state: "submitted", runId: "run-other", runAttribution: "latest-observed" }));
  await Effect.runPromise(f.store.update(input.requestId, { state: "submitted", runId: "run-initial", runAttribution: "latest-observed" }));
  expect(await Effect.runPromise(f.store.get(input.requestId))).toEqual(created.receipt);
});

test("latest-observed attribution stays visible on later receipt replay", async () => {
  const f = fixture(); f.dropLaunch();
  await f.run(Effect.result(launch(input)));
  await f.run(reconcile(input.requestId));
  const replay = await f.run(launch(input));
  expect(replay).toMatchObject({ replayed: true, receipt: { runAttribution: "latest-observed" } });
  const explicit = await f.run(bindRun(input.requestId, "run-oldest", true));
  expect(explicit.receipt).toMatchObject({ runId: "run-oldest", runAttribution: "operator-selected" });
  await Effect.runPromise(f.store.update(input.requestId, { state: "submitted", runId: "run-provider-confirmed", runAttribution: "confirmed" }));
  expect(await Effect.runPromise(f.store.get(input.requestId))).toMatchObject({ runId: "run-provider-confirmed", runAttribution: "confirmed" });
});

test("unknown follow-up can be manually bound only with explicit confirmation and a non-baseline run", async () => {
  const f = fixture(); const first = await f.run(launch(input)); f.dropFollowUp();
  const follow = { agentId: first.receipt.agentId, prompt: "Continue", requestId: "unknown-follow" };
  await f.run(Effect.result(followUp(follow)));
  expect((await f.run(Effect.result(bindRun(follow.requestId, "run-new", false))))._tag).toBe("Failure");
  expect((await f.run(Effect.result(bindRun(follow.requestId, "run-initial", true))))._tag).toBe("Failure");
  const bound = await f.run(bindRun(follow.requestId, "run-new", true));
  expect(bound).toMatchObject({ attributionVerifiedByProvider: false, receipt: { state: "submitted", runAttribution: "operator-selected" } });
  expect(await f.run(followUp(follow))).toMatchObject({ replayed: true });
  expect(f.calls.filter(c => c.method === "POST")).toHaveLength(2);
});

test("cancel confirms the pair but does not claim the remote terminal state", async () => {
  const f = fixture();
  expect(await f.run(cancelRun("bc-example", "run-example"))).toMatchObject({ agentId: "bc-example", runId: "run-example", cancellationRequested: true });
  expect(f.calls).toEqual([{ method: "POST", path: "/v1/agents/bc-example/runs/run-example/cancel", body: undefined }]);
});

test("result summary labels latest selection, agent-scoped artifacts and independent acceptance", async () => {
  const f = fixture(); const created = await f.run(launch(input));
  expect(await f.run(agentResult(created.receipt.agentId))).toMatchObject({ runSelection: "latest-observed", executionSucceeded: true, taskAccepted: false, emptyResult: false, result: "test result", artifactsScope: "agent", gitScope: "agent-snapshot" });
  expect(await f.run(agentResult(created.receipt.agentId, "run-explicit"))).toMatchObject({ runSelection: "explicit", run: { id: "run-explicit" } });
});

test("bounded paging deduplicates identities, forwards filters and exposes truncation", async () => {
  const seen: string[] = [];
  const api: typeof CursorApi.Service = { events: () => Stream.die("unexpected"), request: (_method, path) => {
    seen.push(path);
    const cursor = new URL(`https://example.test${path}`).searchParams.get("cursor");
    return Effect.succeed(cursor ? { items: [{ id: "bc-1" }, { id: "bc-2" }] } : { items: [{ id: "bc-1" }], nextCursor: "page-two" });
  } };
  const run = (options: Parameters<typeof listAgents>[2], cursor?: string) => Effect.runPromise(listAgents(20, cursor, options).pipe(Effect.provideService(CursorApi, api)));
  expect(await run({ all: true, includeArchived: false, prUrl: "https://github.com/example/repo/pull/1" })).toMatchObject({ items: [{ id: "bc-1" }, { id: "bc-2" }], pages: 2, complete: true, snapshot: false });
  expect(seen[0]).toContain("includeArchived=false");
  expect(seen[1]).toContain("cursor=page-two");
  expect(await run({ all: true, maxPages: 1 })).toMatchObject({ complete: false, truncated: true, nextCursor: "page-two" });
  expect(await run({ all: true }, "page-two")).toMatchObject({ complete: false, hasMore: false });
});

test("paging cycles fail explicitly instead of looping or reporting an empty list", async () => {
  let calls = 0;
  const api: typeof CursorApi.Service = { events: () => Stream.die("unexpected"), request: () => { calls++; return Effect.succeed({ items: [{ id: "bc-1" }], nextCursor: "same" }); } };
  const result = await Effect.runPromise(Effect.result(listAgents(20, undefined, { all: true })).pipe(Effect.provideService(CursorApi, api)));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure.code).toBe("PROVIDER_CONTRACT");
  expect(calls).toBe(2);
});

test("reconciliation does not invent missing target proof for legacy repository receipts", async () => {
  const f = fixture();
  f.agents.set("bc-legacy", { id: "bc-legacy", latestRunId: "run-initial", env: { type: "cloud" }, repos: [] });
  await Effect.runPromise(f.store.prepare({ requestId: "legacy", operation: "launch", account: "42", fingerprint: "legacy", agentId: "bc-legacy", state: "unknown", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), target: "https://github.com/example/repo" }));
  const result = await f.run(reconcile("legacy").pipe(Effect.result));
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure.code).toBe("OUTCOME_UNKNOWN");
  expect((await Effect.runPromise(f.store.get("legacy"))).state).toBe("unknown");
  expect(f.calls.every(call => call.method === "GET")).toBe(true);
});

test("follow-up while RUNNING is never queued and includes a stable next step", async () => {
  const f = fixture();
  const first = await f.run(launch(input));
  f.setStatus("RUNNING");
  const busy = await f.run(Effect.result(followUp({ agentId: first.receipt.agentId, prompt: "Continue", requestId: "busy-follow" })));
  expect(busy._tag).toBe("Failure");
  if (busy._tag !== "Failure") throw new Error("Expected failure");
  expect(busy.failure).toMatchObject({
    code: "CONFLICT",
    status: 409,
    providerCode: "agent_busy",
    nextStep: FOLLOW_UP_BUSY_NEXT_STEP,
    details: { activeRunId: "run-initial", activeRunStatus: "RUNNING", followUpQueued: false, newRequestIdRequired: false, nextStep: FOLLOW_UP_BUSY_NEXT_STEP },
  });
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  const missing = await Effect.runPromise(Effect.result(f.store.get("busy-follow")));
  expect(missing._tag).toBe("Failure");
  f.setStatus("FINISHED");
  const reused = await f.run(followUp({ agentId: first.receipt.agentId, prompt: "Continue", requestId: "busy-follow" }));
  expect(reused).toMatchObject({ receipt: { runId: "run-followup", state: "submitted" } });
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(2);
});

test("follow-up --wait polls until idle then POSTs once", async () => {
  const f = fixture();
  const first = await f.run(launch(input));
  f.setStatus((n) => n < 2 ? "RUNNING" : "FINISHED");
  const follow = { agentId: first.receipt.agentId, prompt: "Continue after idle", requestId: "wait-follow", wait: true, timeoutSeconds: 5, intervalSeconds: 1 };
  const value = await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(followUp(follow));
    yield* TestClock.adjust("1 second");
    yield* TestClock.adjust("1 second");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provideService(CursorApi, f.api), Effect.provideService(ReceiptStore, f.store), Effect.provide(TestClock.layer())));
  expect(value).toMatchObject({ receipt: { requestId: "wait-follow", runId: "run-followup", state: "submitted" } });
  expect(f.calls.filter((call) => call.method === "POST" && String(call.path).endsWith("/runs"))).toHaveLength(1);
});

test("a rejected busy follow-up POST requires a new request ID and is not retried", async () => {
  const f = fixture();
  const first = await f.run(launch(input));
  f.rejectFollowUpBusy();
  const follow = { agentId: first.receipt.agentId, prompt: "Continue", requestId: "race-busy" };
  const busy = await f.run(Effect.result(followUp(follow)));
  expect(busy._tag).toBe("Failure");
  if (busy._tag !== "Failure") throw new Error("Expected failure");
  expect(busy.failure).toMatchObject({
    providerCode: "agent_busy",
    nextStep: FOLLOW_UP_BUSY_NEXT_STEP,
    details: { followUpQueued: false, newRequestIdRequired: true, nextStep: FOLLOW_UP_BUSY_NEXT_STEP },
  });
  expect(await Effect.runPromise(f.store.get("race-busy"))).toMatchObject({ state: "rejected" });
  const replay = await f.run(Effect.result(followUp(follow)));
  expect(replay._tag).toBe("Failure");
  if (replay._tag !== "Failure") throw new Error("Expected failure");
  expect(replay.failure.code).toBe("REQUEST_REJECTED");
  expect(f.calls.filter((call) => call.method === "POST" && String(call.path).endsWith("/runs"))).toHaveLength(1);
});

test("envs show lists last-seen snapshot repos without treating observation as a catalog", async () => {
  const f = fixture();
  await f.run(addEnvironment("test-env"));
  await f.run(launch(input));
  const shown = await f.run(showEnvironment("test-env", true));
  expect(shown).toMatchObject({
    name: "test-env",
    configured: true,
    observed: true,
    complete: false,
    catalogAvailable: false,
    reposProvenance: "observed-agent",
    repos: [{ url: "https://github.com/example/attached" }],
    git: { promptDoesNotReplaceSnapshotRepos: true, envExclusiveOfRepoAndRef: true, authoritativeAfterLaunch: "agent.repos" },
  });
  const unseen = await f.run(showEnvironment("missing-env"));
  expect(unseen).toMatchObject({ exists: false, repos: [], reposProvenance: "unavailable", catalogAvailable: false });
});

test("empty result text is first-class and is not treated as accepted work", async () => {
  const f = fixture();
  const created = await f.run(launch(input));
  f.setResult(null);
  expect(await f.run(agentResult(created.receipt.agentId))).toMatchObject({
    executionSucceeded: true,
    taskAccepted: false,
    emptyResult: true,
    result: null,
    run: { status: "FINISHED", result: null },
  });
  f.setResult("   ");
  expect(await f.run(agentResult(created.receipt.agentId))).toMatchObject({ emptyResult: true, taskAccepted: false, result: "   " });
  f.setResult("done");
  expect(await f.run(agentResult(created.receipt.agentId))).toMatchObject({ emptyResult: false, result: "done", taskAccepted: false });
});
