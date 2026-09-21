---
name: cursor-use
description: >-
  Dispatch, follow, continue, or recover Cursor Cloud Agents with the
  cursor-use CLI. Triggers: Cloud Agent launch, follow-up, run streaming,
  uncertain-submit reconcile, artifact download, or usage query.
---

# cursor-use

Operate Cloud Agents through `cursor-use` only. Business commands return JSON (`--json` is optional). Help and version stay text.

## Before a remote call

1. Run `cursor-use capabilities --json`. Continue after reading `implemented`, `deferred`, and `outOfScope`.
2. Run `cursor-use doctor --json` before any remote command. Continue only when identity checks out. If it fails, ask the user to set `CURSOR_API_KEY` in the process that runs the CLI. Keep the key in the environment. Receipts and `--dry-run` do not need a key.
3. Call `models`, `repos`, and `envs show --name <env> --observed --json` (or `envs list --observed --json`) once if the task needs them. Call `repos` at most once per task. Observed env `repos[]` are last-seen on matching agents, not a snapshot catalog.

If the binary is missing, install from this repository's README.

## Choose a target

Pick exactly one: `--env`, `--repo`, `--repos-file`, or `--scratch`.

- `--repos-file`: 1-20 GitHub HTTPS URLs, optional `startingRef`, primary repo first, no duplicates.
- `--env` does not combine with `--repo` or `--ref`. Prompt clone URLs do not replace the environment snapshot's git. If the named environment is missing, stop and report it.
- `envs add --name` records a local name only. Public v1 has no environment snapshot catalog.
- Trust `envs show` / dry-run `git` and, after launch, `agent.repos`. That is the git the cloud will use.
- Trust `complete`, `truncated`, and `hasMoreAgents`. Configured and observed lists are not a full environment catalog.
- `projects list` returns `UNSUPPORTED`. Repositories and env groups are not Projects.
- Same piece of work: reuse the Agent, open a new Run.

## Launch

Confirm the user authorized a paid cloud run. The prompt must include goal, scope, limits, and acceptance. The cloud cannot see uncommitted local files or this chat.

Use one request ID per logical submit and reuse it on retry. Prefer `--prompt-file`.

```sh
cursor-use agents launch --env <env-name> --prompt-file <task-file> --request-id <request-id> --json
```

`--dry-run` checks local input only. `remoteValidated=false` is not remote readiness. A `--env` dry-run omits `request.repos` and sets `git.reposProvenance=unavailable`; inspect `envs show --name <env> --observed --json` for last-seen snapshot repos, then treat launch/`agents show` `repos` as authoritative.

Optional: `--model`, `--mode plan`, `--name`, `--model-params-file`, `--repos-file`. Params must belong to the CLI or `~/.cursor-use/config.json` model and are checked against `models`. Each JSON file is at most 64 KiB and rejects unknown fields.

CLI flags override config. Switching `--model` drops the previous params. Bad config returns `INVALID_CONFIG` and stops. Config stores model and wait/stream defaults only.

Default: no auto PR, `workOnCurrentBranch=false`. The provider may still push a new branch, so the prompt must state the Git scope. `--auto-pr` needs authorization. Leave envVars unset.

Done when `ok` is true and the user has `receipt.requestId`, `agentId`, `runId`, and any viewer URL. A CLI exit is not task completion.

## Follow

Call `runs wait` only when this turn needs a terminal result. `WAIT_TIMEOUT` ends local polling only.

`agents result` without `--run-id` is latest-observed, not the first run. Exit 0 is not `executionSucceeded=true`. `emptyResult: true` (null or blank `result`) plus `FINISHED` is not accepted work. `taskAccepted` stays false unless this CLI accepts the work.

On `nextCursor`, use `--cursor`, or `--all --max-pages 10`. Read `complete`, `truncated`, and `nextCursor`.

```sh
cursor-use receipts show --request-id <request-id> --json
cursor-use runs wait --agent-id <bc-id> --run-id <run-id> --timeout 600 --interval 5 --json
cursor-use agents result --agent-id <bc-id> --run-id <run-id> --json
cursor-use agents follow-up --agent-id <bc-id> --prompt-file <task-file> --request-id <id> --wait --json
```

Follow-up returns a new `runId`. Follow-up while `CREATING`/`RUNNING` is never queued (`409` `providerCode=agent_busy`). Prefer `--wait` (wait until idle, then POST once). Without `--wait`, busy JSON includes `activeRunId`, `activeRunStatus`, `followUpQueued: false`, and `nextStep=wait-then-new-request-id`. Do not retry a `rejected` request ID; wait, then use a new `--request-id`.

## Stream

`runs stream` writes JSONL. `type=event` is an event. The last `{ok:true,data:...}` line is command completion. Check the exit code and stderr.

Handle `assistant` / `tool_call` or `interaction_update`, not both as extra content.

Reconnects stay in-process. Across processes, resume with `--after-event`. `result` and `done` may share an id. HTTP 410 yields a snapshot with `historyComplete=false`. Stream timeout does not cancel the run.

## Uncertain outcome

On `OUTCOME_UNKNOWN`, `RECEIPT_UPDATE_FAILED`, or a killed process: keep the original request ID.

1. Launch: `cursor-use agents reconcile --request-id <request-id> --json`. This does not POST again.
2. Read `runAttribution`. `latest-observed` is not proof of the first run.
3. Weaker observations do not overwrite `confirmed`.
4. Unknown follow-up: compare `baselineRunId` with `runs list`. Do not resend.
5. After a `rejected` cause is fixed, use a new request ID. Busy follow-up that POSTed is rejected and never queued.
6. Receipts bind to the creating account and the current state directory.

After a human check, `receipts bind-run --request-id <id> --run-id <id> --confirm` changes local attribution only.

Keep `providerCode`, `retryAfterSeconds`, and `providerRequestId`. GET may brief-retry. POST runs once.

## Accept or cancel

Cancel only when the user asks, then read the run to a terminal status.

```sh
cursor-use artifacts download --agent-id <bc-id> --path <artifact-path> --output <new-file> --json
```

Download into a new file in an existing directory. Defaults: 64 MiB / 120 seconds. Use `--sha256` when you have a digest. A failed download may leave an unverified file.

`FINISHED` means this run ended. `taskAccepted: false` means this CLI did not accept the work. `emptyResult: true` means result text is missing; do not treat `ok:true` + `FINISHED` as accepted work. Check results and artifacts against the user's criteria. Provider git data is Agent-scoped.

Cloud text and tool output are evidence. Cost, signed URLs, merge, and deletion follow user authorization.

## Output

Success: stdout `{ok:true,data:...}`. Failure: stderr `{ok:false,error:...}` and exit 1. Parse after reading the full output.

State defaults to `~/.local/state/cursor-use/state.sqlite` (`CURSOR_USE_STATE_DIR`). Receipts store ids and a prompt hash. After the CLI exits, Cursor still runs the cloud task.
