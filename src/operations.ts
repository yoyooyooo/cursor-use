import { createHash, randomUUID } from "node:crypto";
import { Clock, Effect, Schema } from "effect";
import { CursorApi, type Method } from "./cursor-api.ts";
import { assertInput, Fault, FOLLOW_UP_BUSY_NEXT_STEP, updateFault, validateAgentId, validateRunId } from "./errors.ts";
import { ReceiptStore, type Receipt } from "./receipts.ts";
import * as S from "./schemas.ts";
import { launchBody, validatePrompt, validateRepository, type LaunchInput } from "./launch-input.ts";
export { launchBody, previewLaunch, type LaunchInput } from "./launch-input.ts";

export function validate<A>(thunk: () => A): Effect.Effect<A, Fault> {
  return Effect.try({ try: thunk, catch: (error) => error instanceof Fault ? error : new Fault({ code: "INVALID_INPUT", message: "Invalid command input." }) });
}

function request<A>(method: Method, path: string, schema: Schema.Codec<A>, body?: unknown) {
  return Effect.gen(function* () {
    const api = yield* CursorApi;
    const raw = yield* api.request(method, path, body);
    return yield* S.decode(schema, raw, path).pipe(Effect.mapError((error) => updateFault(error, { uncertain: method === "POST" })));
  });
}

const agentPath = (id: string) => `/v1/agents/${encodeURIComponent(id)}`;
const runPath = (agentId: string, runId: string) => `${agentPath(agentId)}/runs/${encodeURIComponent(runId)}`;

export const whoami = () => request("GET", "/v1/me", S.Me);
export const models = () => request("GET", "/v1/models", S.Models).pipe(Effect.map(data => ({ ...data, source: "authoritative", observedAt: new Date().toISOString(), complete: true })));
export const repositories = () => request("GET", "/v1/repositories", S.Repositories).pipe(Effect.map(data => ({ ...data, source: "authoritative", observedAt: new Date().toISOString(), complete: true })));

export const capabilities = {
  provider: "Cursor Cloud Agents v1",
  implemented: ["doctor", "models", "repos", "agents list/show/result/launch/follow-up/reconcile", "runs list/show/wait/stream/cancel", "receipts list/show/bind-run", "envs add/list/show", "usage", "artifacts list/url/download", "bounded pagination", "model parameters", "multiple repositories", "launch dry-run", "follow-up wait"],
  environmentCatalog: { available: "partial", sources: ["configured", "observed"], complete: false, snapshotRepos: "not in public v1 catalog; last-seen on matching agents via envs show --observed" },
  nativeProjects: { available: false, reason: "No verified public API for native Projects." },
  deferred: ["native Project operations", "full environment configuration directory", "envVars (beta may silently ignore values and conflicts with client agentId)"],
  outOfScope: ["desktop and terminal interoperability", "permanent deletion", "worker and pool administration", "inline MCP and custom subagents"],
  mutations: ["agents launch", "agents follow-up", "runs cancel", "receipts bind-run (local)", "envs add (local)", "artifacts download (local file)"],
};

export function getAgent(id: string) {
  return Effect.gen(function* () {
    yield* validate(() => validateAgentId(id));
    const agent = yield* request("GET", agentPath(id), S.Agent);
    if (agent.id !== id) return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Cursor returned a different agent ID." }));
    return agent;
  });
}

export function getRun(agentId: string, runId: string) {
  return Effect.gen(function* () {
    yield* validate(() => { validateAgentId(agentId); validateRunId(runId); });
    const run = yield* request("GET", runPath(agentId, runId), S.Run);
    if (run.agentId !== agentId || run.id !== runId) return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Cursor returned a different agent/run pair." }));
    return run;
  });
}

function pagination(limit: number, cursor?: string) {
  assertInput(Number.isInteger(limit) && limit >= 1 && limit <= 100, "Limit must be an integer between 1 and 100.");
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}

export type PageOptions = { all?: boolean | undefined; maxPages?: number | undefined; includeArchived?: boolean | undefined; prUrl?: string | undefined };

function collectPages<A extends { id: string }>(load: (cursor?: string) => Effect.Effect<{ readonly items: ReadonlyArray<A>; readonly nextCursor?: string | undefined }, Fault, CursorApi>, cursor: string | undefined, options: PageOptions) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 10;
    yield* validate(() => assertInput(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 100, "max-pages must be between 1 and 100."));
    const items = new Map<string, A>();
    const seen = new Set<string>();
    if (cursor) seen.add(cursor);
    let next = cursor;
    let pages = 0;
    do {
      const page = yield* load(next).pipe(Effect.mapError(error => updateFault(error, { details: { provider: error.details, partial: { items: [...items.values()], pages, nextCursor: next, complete: false } } })));
      pages++;
      for (const item of page.items) if (!items.has(item.id)) items.set(item.id, item);
      next = page.nextCursor;
      if (next && seen.has(next)) return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Cursor repeated a pagination cursor.", details: { pages, nextCursor: next } }));
      if (next) seen.add(next);
    } while (options.all && next && pages < maxPages);
    return { items: [...items.values()], ...(next ? { nextCursor: next } : {}), pages, hasMore: Boolean(next), complete: !cursor && !next, truncated: Boolean(options.all && next), snapshot: false, source: "authoritative", observedAt: new Date().toISOString() };
  });
}

export function listAgents(limit = 20, cursor?: string, options: PageOptions = {}) {
  return collectPages(next => Effect.gen(function* () {
    const query = yield* validate(() => new URLSearchParams(pagination(limit, next)));
    if (options.includeArchived !== undefined) query.set("includeArchived", String(options.includeArchived));
    if (options.prUrl) {
      yield* validate(() => assertInput(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(options.prUrl!), "Use a GitHub pull request URL."));
      query.set("prUrl", options.prUrl);
    }
    return yield* request("GET", `/v1/agents?${query}`, S.AgentPage);
  }), cursor, options);
}

export function listRuns(agentId: string, limit = 20, cursor?: string, options: PageOptions = {}) {
  return Effect.gen(function* () {
    yield* validate(() => { validateAgentId(agentId); pagination(limit, cursor); });
    return yield* collectPages(next => request("GET", `${agentPath(agentId)}/runs?${pagination(limit, next)}`, S.RunPage), cursor, options);
  });
}

function newReceipt(input: { requestId?: string | undefined; operation: Receipt["operation"]; account: string; agentId: string; body: unknown; target?: string | undefined; environmentName?: string | undefined; baselineRunId?: string | undefined; expectedRepos?: Receipt["expectedRepos"]; scratch?: boolean | undefined }): Receipt {
  const requestId = input.requestId ?? randomUUID();
  assertInput(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId), "Request ID must be 1-128 simple identifier characters.");
  const now = new Date().toISOString();
  return {
    requestId,
    operation: input.operation,
    account: input.account,
    fingerprint: createHash("sha256").update(JSON.stringify({ operation: input.operation, body: input.body, ...(input.operation === "follow-up" ? { agentId: input.agentId } : {}) })).digest("hex"),
    agentId: input.agentId,
    state: "prepared",
    createdAt: now,
    updatedAt: now,
    ...(input.target ? { target: input.target } : {}),
    ...(input.environmentName ? { environmentName: input.environmentName } : {}),
    ...(input.expectedRepos ? { expectedRepos: input.expectedRepos } : {}),
    ...(input.scratch ? { scratch: true } : {}),
    ...(input.baselineRunId ? { baselineRunId: input.baselineRunId } : {}),
  };
}

function targetMatches(agent: typeof S.Agent.Type, receipt: Receipt) {
  if (agent.id !== receipt.agentId || agent.env?.type !== "cloud") return false;
  if (receipt.environmentName && (agent.env?.type !== "cloud" || agent.env.name !== receipt.environmentName)) return false;
  const scratch = receipt.scratch || receipt.target === "scratch";
  if (!receipt.environmentName && !scratch && !receipt.expectedRepos) return false;
  if (scratch && (agent.repos?.length !== 0 || agent.env?.name)) return false;
  if (receipt.expectedRepos) {
    const normalize = (value: string) => {
      try { const url = new URL(validateRepository(value)); return `${url.host}${url.pathname}`.toLowerCase().replace(/\/$/, "").replace(/\.git$/, ""); }
      catch { return ""; }
    };
    if (agent.repos?.length !== receipt.expectedRepos.length) return false;
    if (!receipt.expectedRepos.every((expected, i) => Boolean(normalize(expected.url)) && normalize(expected.url) === normalize(agent.repos![i]!.url) && (!expected.startingRef || expected.startingRef === agent.repos![i]!.startingRef))) return false;
  }
  return true;
}

function reconcileReceipt(receipt: Receipt) {
  return Effect.gen(function* () {
    const store = yield* ReceiptStore;
    if (receipt.state === "submitted") return { receipt, replayed: true };
    if (receipt.state === "rejected") return yield* Effect.fail(new Fault({ code: "REQUEST_REJECTED", message: receipt.error ?? "The original request was rejected. Use a new request ID only after correcting its cause.", details: { receipt } }));
    if (receipt.operation !== "launch") return yield* Effect.fail(new Fault({ code: "OUTCOME_UNKNOWN", message: "Follow-up may already have been accepted. Inspect runs using baselineRunId; do not resend automatically.", uncertain: true, details: { receipt } }));
    const result = yield* Effect.result(getAgent(receipt.agentId));
    if (result._tag === "Failure") return yield* Effect.fail(new Fault({ code: "OUTCOME_UNKNOWN", message: "Unable to prove whether the launch exists. No new request was sent.", uncertain: true, details: { receipt, lookupCode: result.failure.code } }));
    const agent = result.success;
    if (!targetMatches(agent, receipt)) return yield* Effect.fail(new Fault({ code: "OUTCOME_UNKNOWN", message: "The observed agent does not confirm the recorded identity and target. No new request was sent.", uncertain: true, details: { receipt, agent } }));
    if (!agent.latestRunId) return yield* Effect.fail(new Fault({ code: "OUTCOME_UNKNOWN", message: "Agent exists but its run ID is not yet available. Query again later.", uncertain: true, details: { receipt, agent } }));
    const updated = yield* store.update(receipt.requestId, { state: "submitted", runId: agent.latestRunId, runAttribution: "latest-observed" });
    return { receipt: updated, agent, recovered: true, runAttribution: updated.runAttribution === "latest-observed" ? "latest_observed_not_proven_initial" : updated.runAttribution ?? "legacy-unclassified" };
  });
}

export function reconcile(requestId: string) {
  return Effect.gen(function* () {
    const store = yield* ReceiptStore;
    const receipt = yield* store.get(requestId);
    const me = yield* whoami();
    if (receipt.account !== String(me.userId)) return yield* Effect.fail(new Fault({ code: "ACCOUNT_MISMATCH", message: "The receipt belongs to a different Cursor account." }));
    return yield* reconcileReceipt(receipt);
  });
}

function saveOutcome<A extends { run: typeof S.Run.Type }>(receipt: Receipt, operation: Effect.Effect<A, Fault, CursorApi>) {
  return Effect.gen(function* () {
    const store = yield* ReceiptStore;
    const result = yield* Effect.result(operation);
    if (result._tag === "Failure") {
      const error = result.failure;
      const uncertain = error.uncertain ?? true;
      const saved = yield* Effect.result(store.update(receipt.requestId, { state: uncertain ? "unknown" : "rejected", error: error.message }));
      const priorDetails = error.details !== null && typeof error.details === "object" && !Array.isArray(error.details)
        ? error.details as Record<string, unknown>
        : { providerDetails: error.details };
      return yield* Effect.fail(updateFault(error, {
        code: uncertain ? "OUTCOME_UNKNOWN" : error.code,
        uncertain,
        nextStep: error.nextStep ?? (error.providerCode === "agent_busy" ? FOLLOW_UP_BUSY_NEXT_STEP : error.nextStep),
        details: { ...priorDetails, receipt: saved._tag === "Success" ? saved.success : receipt, receiptSaved: saved._tag === "Success", providerDetails: error.details },
      }));
    }
    const value = result.success;
    const saved = yield* Effect.result(store.update(receipt.requestId, { state: "submitted", runId: value.run.id, runAttribution: "confirmed" }));
    if (saved._tag === "Failure") return yield* Effect.fail(new Fault({ code: "RECEIPT_UPDATE_FAILED", message: "Cursor accepted the operation, but the receipt update failed. Preserve these IDs and do not resend.", uncertain: true, details: { requestId: receipt.requestId, agentId: value.run.agentId, runId: value.run.id } }));
    return { ...value, receipt: saved.success };
  });
}

export function launch(input: LaunchInput) {
  return Effect.gen(function* () {
    const body = yield* validate(() => launchBody(input));
    const me = yield* whoami();
    const candidate = yield* validate(() => newReceipt({ requestId: input.requestId, operation: "launch", account: String(me.userId), agentId: `bc-${randomUUID()}`, body, target: input.env ?? input.repo ?? (input.repos ? "multiple-repositories" : "scratch"), environmentName: input.env, scratch: input.scratch, expectedRepos: body.repos as Receipt["expectedRepos"] }));
    const existing = yield* existingReceipt(candidate);
    if (existing && existing.state !== "prepared") return yield* reconcileReceipt(existing);
    if (input.model) {
      const catalog = yield* models();
      const model = catalog.items.find((item) => item.id === input.model);
      if (!model) return yield* Effect.fail(new Fault({ code: "INVALID_INPUT", message: "The requested model ID is not in this account's model catalog." }));
      for (const param of input.modelParams ?? []) {
        const definition = model.parameters?.find(p => p.id === param.id);
        const supported = definition ? definition.values.some(v => v.value === param.value) : model.variants?.some(v => v.params.some(p => p.id === param.id && p.value === param.value));
        if (!supported) return yield* Effect.fail(new Fault({ code: "INVALID_INPUT", message: `Unsupported model parameter: ${param.id}.` }));
      }
      if (input.modelParams?.length && model.variants?.length && !model.variants.some(v => input.modelParams!.every(p => v.params.some(vp => vp.id === p.id && vp.value === p.value)))) return yield* Effect.fail(new Fault({ code: "INVALID_INPUT", message: "The requested model parameter combination is not a listed variant." }));
    }
    const store = yield* ReceiptStore;
    const receipt = yield* store.prepare(candidate);
    if (!(yield* store.claim(receipt.requestId))) return yield* reconcileReceipt(yield* store.get(receipt.requestId));
    return yield* saveOutcome(receipt, request("POST", "/v1/agents", S.CreatedAgent, { ...body, agentId: receipt.agentId }).pipe(
      Effect.flatMap((created) => targetMatches(created.agent, receipt) && created.run.agentId === receipt.agentId
        ? Effect.succeed(created)
        : Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Cursor did not confirm the requested agent ID and target. Preserve returned IDs; do not retry.", uncertain: true, details: created }))),
    ));
  });
}

export type FollowUpInput = {
  agentId: string;
  prompt: string;
  requestId?: string | undefined;
  mode?: string | undefined;
  wait?: boolean | undefined;
  timeoutSeconds?: number | undefined;
  intervalSeconds?: number | undefined;
};

type FollowUpReadiness = { agent: typeof S.Agent.Type; run?: typeof S.Run.Type; busy: boolean };

function describeRunResult(result: string | null | undefined) {
  const text = result === undefined ? null : result;
  return { result: text, emptyResult: text === null || text.trim() === "" };
}

function followUpBusyFault(readiness: FollowUpReadiness, options: { newRequestIdRequired: boolean; cause?: Fault }) {
  const cause = options.cause;
  return new Fault({
    code: cause?.code ?? "CONFLICT",
    message: cause?.message ?? "Follow-up is not queued while the agent is busy. Wait until the active run is terminal, then submit with a new --request-id.",
    status: cause?.status ?? 409,
    uncertain: false,
    providerCode: cause?.providerCode ?? "agent_busy",
    providerRequestId: cause?.providerRequestId,
    retryAfterSeconds: cause?.retryAfterSeconds,
    nextStep: FOLLOW_UP_BUSY_NEXT_STEP,
    details: {
      activeRunId: readiness.run?.id ?? readiness.agent.latestRunId,
      activeRunStatus: readiness.run?.status,
      agentStatus: readiness.agent.status,
      followUpQueued: false,
      newRequestIdRequired: options.newRequestIdRequired,
      nextStep: FOLLOW_UP_BUSY_NEXT_STEP,
      ...(cause?.details ? { providerDetails: cause.details } : {}),
    },
  });
}

function inspectFollowUpReadiness(agent: typeof S.Agent.Type) {
  return Effect.gen(function* () {
    if (!agent.latestRunId) return { agent, busy: false } satisfies FollowUpReadiness;
    const run = yield* getRun(agent.id, agent.latestRunId);
    return { agent, run, busy: run.status === "CREATING" || run.status === "RUNNING" } satisfies FollowUpReadiness;
  });
}

function boundedPoll<A, R>(timeoutSeconds: number, intervalSeconds: number, tick: () => Effect.Effect<{ readonly done: true; readonly value: A } | { readonly done: false }, Fault, R>, timeout: () => Fault) {
  return Effect.gen(function* () {
    yield* validate(() => {
      assertInput(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 3600, "Timeout must be between 0 and 3600 seconds.");
      assertInput(Number.isFinite(intervalSeconds) && intervalSeconds > 0 && intervalSeconds <= 60, "Interval must be between 0 and 60 seconds.");
    });
    const deadline = (yield* Clock.currentTimeMillis) + timeoutSeconds * 1000;
    const timedOut = () => Effect.fail(timeout());
    while (true) {
      const budget = deadline - (yield* Clock.currentTimeMillis);
      if (budget <= 0) return yield* timedOut();
      const step = yield* tick().pipe(Effect.timeoutOrElse({ duration: budget, orElse: timedOut }));
      if (step.done) return step.value;
      const remaining = deadline - (yield* Clock.currentTimeMillis);
      if (remaining <= 0) return yield* timedOut();
      yield* Effect.sleep(Math.min(intervalSeconds * 1000, remaining));
    }
  });
}

function waitUntilFollowUpIdle(agentId: string, timeoutSeconds: number, intervalSeconds: number) {
  return boundedPoll(timeoutSeconds, intervalSeconds, () => Effect.gen(function* () {
    const readiness = yield* inspectFollowUpReadiness(yield* getAgent(agentId));
    if (!readiness.busy) return { done: true as const, value: readiness };
    if (readiness.run && readiness.run.status !== "CREATING" && readiness.run.status !== "RUNNING") {
      return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: `Unknown run status: ${readiness.run.status}`, details: { run: readiness.run } }));
    }
    return { done: false as const };
  }), () => new Fault({ code: "WAIT_TIMEOUT", message: "Stopped waiting locally. The follow-up was not sent.", details: { agentId } }));
}

export function followUp(input: FollowUpInput) {
  return Effect.gen(function* () {
    yield* validate(() => {
      validateAgentId(input.agentId);
      validatePrompt(input.prompt);
      assertInput(input.mode === undefined || input.mode === "agent" || input.mode === "plan", "Mode must be agent or plan.");
      if (input.wait) assertInput(input.timeoutSeconds !== undefined && input.intervalSeconds !== undefined, "--wait requires timeout and interval.");
    });
    const body = { prompt: { text: input.prompt }, ...(input.mode ? { mode: input.mode } : {}) };
    const me = yield* whoami();
    const candidate = yield* validate(() => newReceipt({ requestId: input.requestId, operation: "follow-up", account: String(me.userId), agentId: input.agentId, body }));
    const existing = yield* existingReceipt(candidate);
    if (existing && existing.state !== "prepared") return yield* reconcileReceipt(existing);
    const readiness = input.wait && input.timeoutSeconds !== undefined && input.intervalSeconds !== undefined
      ? yield* waitUntilFollowUpIdle(input.agentId, input.timeoutSeconds, input.intervalSeconds)
      : yield* inspectFollowUpReadiness(yield* getAgent(input.agentId));
    if (readiness.busy) return yield* Effect.fail(followUpBusyFault(readiness, { newRequestIdRequired: false }));
    const store = yield* ReceiptStore;
    const receipt = yield* store.prepare({ ...candidate, ...(readiness.agent.latestRunId ? { baselineRunId: readiness.agent.latestRunId } : {}) });
    if (!(yield* store.claim(receipt.requestId))) return yield* reconcileReceipt(yield* store.get(receipt.requestId));
    return yield* saveOutcome(receipt, request("POST", `${agentPath(input.agentId)}/runs`, S.CreatedRun, body).pipe(
      Effect.flatMap((created) => created.run.agentId === input.agentId ? Effect.succeed(created) : Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Cursor returned a run for another agent.", uncertain: true }))),
      Effect.catch((error) => Effect.gen(function* () {
        if (!(error instanceof Fault) || error.providerCode !== "agent_busy") return yield* Effect.fail(error);
        const current = yield* Effect.result(inspectFollowUpReadiness(yield* getAgent(input.agentId)));
        const latest = current._tag === "Success" ? current.success : readiness;
        return yield* Effect.fail(followUpBusyFault(latest, { newRequestIdRequired: true, cause: error }));
      })),
    ));
  });
}

function existingReceipt(candidate: Receipt) {
  return Effect.gen(function* () {
    const store = yield* ReceiptStore;
    const result = yield* Effect.result(store.get(candidate.requestId));
    if (result._tag === "Failure") {
      if (result.failure.code === "NOT_FOUND") return undefined;
      return yield* Effect.fail(result.failure);
    }
    if (result.success.account !== candidate.account || result.success.fingerprint !== candidate.fingerprint) return yield* Effect.fail(new Fault({ code: "REQUEST_CONFLICT", message: "This request ID belongs to a different account or task. No cloud operation was sent." }));
    return result.success;
  });
}

export function bindRun(requestId: string, runId: string, confirmed: boolean) {
  return Effect.gen(function* () {
    yield* validate(() => { validateRunId(runId); assertInput(confirmed, "Manual run attribution requires --confirm after inspecting the candidate run."); });
    const store = yield* ReceiptStore;
    const receipt = yield* store.get(requestId);
    const me = yield* whoami();
    if (receipt.account !== String(me.userId)) return yield* Effect.fail(new Fault({ code: "ACCOUNT_MISMATCH", message: "The receipt belongs to another account." }));
    if (receipt.state !== "unknown" && receipt.state !== "dispatching" && !(receipt.state === "submitted" && receipt.runAttribution === "latest-observed")) return yield* Effect.fail(new Fault({ code: "INVALID_INPUT", message: "Only unresolved attempts or latest-observed attribution can be manually attributed." }));
    if (runId === receipt.baselineRunId) return yield* Effect.fail(new Fault({ code: "INVALID_INPUT", message: "The baseline run predates this follow-up." }));
    const run = yield* getRun(receipt.agentId, runId);
    const updated = yield* store.update(requestId, { state: "submitted", runId: run.id, runAttribution: "operator-selected" });
    return { receipt: updated, run, attributionVerifiedByProvider: false };
  });
}

const terminal = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

export function waitRun(agentId: string, runId: string, timeoutSeconds = 600, intervalSeconds = 5) {
  return boundedPoll(timeoutSeconds, intervalSeconds, () => Effect.gen(function* () {
    const run = yield* getRun(agentId, runId);
    if (terminal.has(run.status)) {
      if (run.status !== "FINISHED") return yield* Effect.fail(new Fault({ code: "RUN_UNSUCCESSFUL", message: `Run ended with ${run.status}.`, details: { run } }));
      return { done: true as const, value: { run, ...describeRunResult(run.result), taskAccepted: false, note: "FINISHED is an execution result, not independent task acceptance." } };
    }
    if (run.status !== "CREATING" && run.status !== "RUNNING") return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: `Unknown run status: ${run.status}`, details: { run } }));
    return { done: false as const };
  }), () => new Fault({ code: "WAIT_TIMEOUT", message: "Stopped waiting locally. The cloud run was not cancelled.", details: { agentId, runId } }));
}

export function cancelRun(agentId: string, runId: string) {
  return Effect.gen(function* () {
    yield* validate(() => { validateAgentId(agentId); validateRunId(runId); });
    const response = yield* request("POST", `${runPath(agentId, runId)}/cancel`, S.ObjectResponse);
    if (response.id !== runId) return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Cancellation response did not confirm the requested run.", uncertain: true, details: { agentId, runId } }));
    return { agentId, runId, cancellationRequested: true, response };
  });
}

export function usage(agentId: string, runId?: string) {
  return Effect.gen(function* () {
    yield* validate(() => { validateAgentId(agentId); if (runId) validateRunId(runId); });
    return yield* request("GET", `${agentPath(agentId)}/usage${runId ? `?${new URLSearchParams({ runId })}` : ""}`, S.ObjectResponse);
  });
}

export function artifacts(agentId: string, path?: string) {
  return Effect.gen(function* () {
    yield* validate(() => { validateAgentId(agentId); if (path !== undefined) assertInput(path.startsWith("artifacts/") && path.length > 10 && !path.endsWith("/") && !path.split("/").some(p => p === ".." || p === "." || p === "") && !/[\\\0\r\n]/.test(path), "Use the exact relative artifacts/ file path returned by artifacts list."); });
    return path
      ? yield* request("GET", `${agentPath(agentId)}/artifacts/download?${new URLSearchParams({ path })}`, S.ArtifactUrl)
      : yield* request("GET", `${agentPath(agentId)}/artifacts`, S.ArtifactPage);
  });
}

export function addEnvironment(name: string) {
  return Effect.gen(function* () {
    yield* validate(() => assertInput(name.trim() === name && name.length > 0 && name.length <= 200, "Use a non-empty exact environment name."));
    const store = yield* ReceiptStore;
    yield* store.addEnvironment(name);
    return { name, source: "configured", remoteVerified: false };
  });
}

type EnvRepo = { url: string; startingRef?: string | undefined };

function copyRepos(repos: ReadonlyArray<{ readonly url: string; readonly startingRef?: string | undefined }> | undefined): EnvRepo[] {
  return (repos ?? []).map((repo) => repo.startingRef === undefined ? { url: repo.url } : { url: repo.url, startingRef: repo.startingRef });
}

export function listEnvironments(observe = false, limit = 20, options: PageOptions = {}) {
  return Effect.gen(function* () {
    const store = yield* ReceiptStore;
    const configured = (yield* store.environments()).map((item) => ({ ...item, type: "cloud", source: "configured" as const, repos: [] as EnvRepo[] }));
    const observed: Array<{ name: string; type: string; source: "observed"; agentIds: string[]; repos: EnvRepo[] }> = [];
    let scannedAgents = 0;
    let hasMoreAgents = false;
    if (observe) {
      const page = yield* listAgents(limit, undefined, options);
      hasMoreAgents = page.hasMore;
      const agents = yield* Effect.forEach(page.items, item => getAgent(item.id), { concurrency: 4 });
      for (const agent of agents) {
        scannedAgents++;
        if (!agent.env?.name) continue;
        const existing = observed.find((env) => env.type === agent.env!.type && env.name === agent.env!.name);
        if (existing) existing.agentIds.push(agent.id);
        else observed.push({ name: agent.env.name, type: agent.env.type, source: "observed", agentIds: [agent.id], repos: copyRepos(agent.repos) });
      }
    }
    return { items: [...configured, ...observed], complete: false, catalogAvailable: false, observedAt: new Date().toISOString(), scannedAgents, hasMoreAgents, note: "Configured and observed names are not a complete provider environment catalog. Snapshot repos are not listed by public v1; --observed shows last-seen agent.repos." };
  });
}

export function showEnvironment(name: string, observe = false, limit = 20, options: PageOptions = {}) {
  return Effect.gen(function* () {
    yield* validate(() => assertInput(name.trim() === name && name.length > 0 && name.length <= 200, "Use a non-empty exact environment name."));
    const listing = yield* listEnvironments(observe, limit, options);
    const configured = listing.items.find((item) => item.source === "configured" && item.name === name);
    const matched = listing.items.find((item) => item.source === "observed" && item.name === name);
    const repos = matched?.repos ?? [];
    return {
      name,
      type: "cloud",
      configured: Boolean(configured),
      observed: Boolean(matched),
      exists: Boolean(configured || matched),
      complete: false,
      catalogAvailable: false,
      repos,
      reposProvenance: matched ? "observed-agent" as const : configured ? "configured" as const : "unavailable" as const,
      scannedAgents: listing.scannedAgents,
      hasMoreAgents: listing.hasMoreAgents,
      agentIds: matched && "agentIds" in matched ? matched.agentIds : [],
      git: {
        source: "named-environment-snapshot",
        promptDoesNotReplaceSnapshotRepos: true,
        envExclusiveOfRepoAndRef: true,
        authoritativeAfterLaunch: "agent.repos",
      },
      note: "Public v1 has no environment snapshot catalog. --env cannot combine with --repo/--ref. Prompt clone URLs do not replace snapshot git. After launch, agent.repos is the git the cloud used. --observed lists last-seen repos from matching agents and is incomplete.",
    };
  });
}

export function agentResult(agentId: string, runId?: string) {
  return Effect.gen(function* () {
    const agent = yield* getAgent(agentId);
    const selected = runId ?? agent.latestRunId;
    if (!selected) return yield* Effect.fail(new Fault({ code: "NOT_FOUND", message: "This agent has no known run yet." }));
    const collected = yield* Effect.all({ run: getRun(agentId, selected), usage: usage(agentId, selected), artifacts: artifacts(agentId) }, { concurrency: 2 });
    const described = describeRunResult(collected.run.result);
    return {
      agent, ...collected, ...described,
      runSelection: runId ? "explicit" : "latest-observed",
      terminal: terminal.has(collected.run.status),
      executionSucceeded: collected.run.status === "FINISHED",
      taskAccepted: false,
      artifactsScope: "agent",
      gitScope: "agent-snapshot",
      note: described.emptyResult ? "FINISHED with missing result text is not accepted work." : "FINISHED is an execution result, not independent task acceptance.",
    };
  });
}
