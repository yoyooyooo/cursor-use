import { createHash } from "node:crypto";
import { assertInput } from "./errors.ts";

export type RepositoryInput = { url: string; startingRef?: string | undefined };
export type ModelParam = { id: string; value: string };
export type LaunchInput = {
  prompt: string;
  env?: string | undefined;
  repo?: string | undefined;
  ref?: string | undefined;
  repos?: ReadonlyArray<RepositoryInput> | undefined;
  scratch?: boolean | undefined;
  model?: string | undefined;
  modelParams?: ReadonlyArray<ModelParam> | undefined;
  name?: string | undefined;
  autoPr?: boolean | undefined;
  mode?: string | undefined;
  requestId?: string | undefined;
};

export function validateRepository(repository: string) {
  const url = new URL(repository);
  assertInput(url.protocol === "https:" && url.hostname === "github.com" && !url.port && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash, "Use an HTTPS GitHub repository URL without credentials, port, query or fragment.");
  return repository;
}

export function validatePrompt(prompt: string) {
  assertInput(prompt.trim().length > 0 && Buffer.byteLength(prompt) <= 512 * 1024, "Prompt must be non-empty and at most 512 KiB.");
}

export function launchBody(input: LaunchInput): Record<string, unknown> {
  validatePrompt(input.prompt);
  assertInput([input.env !== undefined, input.repo !== undefined, input.repos !== undefined, input.scratch === true].filter(Boolean).length === 1, "Choose exactly one of --env, --repo, --repos-file or --scratch.");
  assertInput(input.ref === undefined || (input.repo && input.ref.trim().length > 0), "--ref requires --repo and a non-empty reference, not a named environment or repos file.");
  assertInput(input.mode === undefined || input.mode === "agent" || input.mode === "plan", "Mode must be agent or plan.");
  assertInput(input.name === undefined || (input.name.trim().length > 0 && input.name.length <= 100), "Agent name must contain 1-100 characters.");
  assertInput(input.model === undefined || (input.model.trim() === input.model && input.model.length > 0), "Use a non-empty exact model ID.");
  if (input.env !== undefined) assertInput(input.env.trim() === input.env && input.env.length > 0 && input.env.length <= 200, "Use the exact saved environment name without surrounding whitespace.");
  if (input.requestId !== undefined) assertInput(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.requestId), "Request ID must be 1-128 simple identifier characters.");
  const repos = input.repos ?? (input.repo !== undefined ? [{ url: input.repo, ...(input.ref ? { startingRef: input.ref } : {}) }] : undefined);
  if (repos) {
    assertInput(repos.length > 0 && repos.length <= 20, "Provide between 1 and 20 repositories.");
    const seen = new Set<string>();
    for (const repo of repos) {
      validateRepository(repo.url);
      assertInput(repo.startingRef === undefined || repo.startingRef.trim().length > 0, "Repository references cannot be empty.");
      const key = repo.url.toLowerCase().replace(/\/$/, "").replace(/\.git$/, "");
      assertInput(!seen.has(key), "Duplicate repository URLs are not allowed.");
      seen.add(key);
    }
  }
  const params = input.modelParams ? [...input.modelParams].sort((a, b) => a.id.localeCompare(b.id)) : undefined;
  if (params) {
    assertInput(Boolean(input.model), "Model parameters require --model.");
    assertInput(params.length <= 30 && new Set(params.map(p => p.id)).size === params.length, "Model parameter IDs must be unique (maximum 30).");
    for (const p of params) assertInput(p.id.length > 0 && p.id.length <= 100 && p.value.length <= 500, "Invalid model parameter ID or value.");
  }
  return {
    prompt: { text: input.prompt }, autoCreatePR: input.autoPr ?? false, workOnCurrentBranch: false,
    ...(input.env ? { env: { type: "cloud", name: input.env } } : {}),
    ...(repos ? { repos: repos.map(r => ({ url: r.url, ...(r.startingRef ? { startingRef: r.startingRef } : {}) })) } : {}),
    ...(input.model ? { model: { id: input.model, ...(params ? { params: params.map(p => ({ id: p.id, value: p.value })) } : {}) } } : {}),
    ...(input.name ? { name: input.name } : {}), ...(input.mode ? { mode: input.mode } : {}),
  };
}

export type LaunchGitPreview = {
  readonly source: "named-environment-snapshot" | "explicit-repos" | "scratch";
  readonly repos: ReadonlyArray<RepositoryInput>;
  readonly reposProvenance: "request" | "unavailable";
  readonly requestIncludesRepos: boolean;
  readonly promptDoesNotReplaceSnapshotRepos: boolean;
  readonly envExclusiveOfRepoAndRef: boolean;
  readonly inspectWith: ReadonlyArray<string>;
  readonly authoritativeAfterLaunch: string;
};

export function launchGitPreview(input: LaunchInput, request: Record<string, unknown>): LaunchGitPreview {
  if (input.env) {
    return {
      source: "named-environment-snapshot",
      repos: [],
      reposProvenance: "unavailable",
      requestIncludesRepos: false,
      promptDoesNotReplaceSnapshotRepos: true,
      envExclusiveOfRepoAndRef: true,
      inspectWith: [`envs show --name ${input.env} --observed --json`, "agents show / launch response field repos"],
      authoritativeAfterLaunch: "agent.repos",
    };
  }
  const repos = Array.isArray(request.repos) ? request.repos as ReadonlyArray<RepositoryInput> : [];
  return {
    source: input.scratch ? "scratch" : "explicit-repos",
    repos,
    reposProvenance: "request",
    requestIncludesRepos: repos.length > 0,
    promptDoesNotReplaceSnapshotRepos: true,
    envExclusiveOfRepoAndRef: true,
    inspectWith: ["agents show / launch response field repos"],
    authoritativeAfterLaunch: "agent.repos",
  };
}

export function previewLaunch(input: LaunchInput) {
  const { prompt: _, ...request } = launchBody(input);
  return {
    dryRun: true,
    remoteValidated: false,
    receiptCreated: false,
    request,
    git: launchGitPreview(input, request),
    promptBytes: Buffer.byteLength(input.prompt),
    promptSha256: createHash("sha256").update(input.prompt).digest("hex"),
  };
}
