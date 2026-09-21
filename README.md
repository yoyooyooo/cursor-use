# cursor-use

[English](./README.md) | [中文](./README.zh-CN.md)

[![CI](https://github.com/yoyooyooo/cursor-use/actions/workflows/check.yml/badge.svg)](https://github.com/yoyooyooo/cursor-use/actions/workflows/check.yml)

A CLI and Agent skill for Cursor Cloud Agents. You can run it from a terminal. Another coding agent can run it too. It launches a cloud task, keeps a receipt you can recover, follows the run, and reads usage or artifacts through Cursor's v1 API.

```sh
cursor-use agents launch \
  --scratch \
  --prompt "Return a short readiness summary." \
  --request-id example-dry-run \
  --dry-run \
  --json
```

This dry-run stays on your machine. No API key, and no cloud call.

## The problem

Cursor Cloud Agents already run in the cloud. A terminal still needs a way to:

- pick a real target
- submit once, under a request ID you can recover
- leave and return to the same Agent and Run
- tell a successful CLI call apart from a finished, accepted task

`cursor-use` does that. Desktop Cursor and `cursor-agent` are out of scope; see Limits.

## What you get

- Launch, follow-up, wait, cancel, and result inspection
- Local SQLite receipts, including recovery when the submit result is unknown
- SSE event streaming with a limited number of reconnects
- Usage, artifact listing, and artifact downloads that check size and SHA-256
- A skill file that tells another agent how to call this CLI

## How it works

1. Give the CLI a prompt and exactly one target: `--env`, `--repo`, `--repos-file`, or `--scratch`.
2. On a paid submit, the CLI writes a local receipt, then calls `https://api.cursor.com`.
3. You can show, reconcile, or replay that request ID. A lost response is not sent again as a new task.
4. Later commands use the saved `agentId` and `runId`. Local wait or stream does not cancel the cloud run.

The CLI reads the API key from the calling process. It does not write the key into the config file, receipt database, prompts, or logs.

## Install

Requires [Bun](https://bun.sh) `1.4.2` or newer.

```sh
bun install -g cursor-use
cursor-use --version
cursor-use capabilities --json
```

Use `0.2.2` or later. `0.2.1` still contains workspace `catalog:` dependency references and will not install.

From source:

```sh
git clone https://github.com/yoyooyooo/cursor-use.git
cd cursor-use
bun install --frozen-lockfile
bun run build
bun link
cursor-use --version
```

Verified on macOS with Bun `1.4.2`. CI covers Ubuntu and macOS. Windows is not a verified platform.

## Quick start

After the dry-run above, remote commands need a Cursor API key in the same process:

```sh
export CURSOR_API_KEY="..."
cursor-use doctor --json
cursor-use models --json
```

Creating an Agent can incur Cursor usage charges. Use one request ID per logical submit. If the result is unclear, inspect the receipt and reconcile. Do not create a new ID and send the task again.

```sh
cursor-use agents launch \
  --scratch \
  --prompt "Return a short readiness summary." \
  --request-id my-task-001 \
  --json
cursor-use receipts show --request-id my-task-001 --json
```

Save `agentId` and `runId` from the receipt, then wait, stream, or continue:

```sh
cursor-use runs wait --agent-id <bc-id> --run-id <run-id> --json
cursor-use agents result --agent-id <bc-id> --run-id <run-id> --json
cursor-use agents follow-up --agent-id <bc-id> --prompt "Add the missing edge case." --request-id my-task-002 --wait --json
```

`FINISHED` means the run ended. It is not task acceptance. Check `emptyResult`, the result text, git snapshot, artifacts, and your own criteria. Follow-up while a run is busy is never queued; prefer `--wait`, or wait and use a new `--request-id` after a rejected receipt.

Named `--env` does not combine with `--repo` or `--ref`. Prompt clone URLs do not replace snapshot git. Inspect `envs show --name <env> --observed --json` and the launch/`agents show` `repos` field.

## Configuration

Optional defaults live in `~/.cursor-use/config.json`. The file stores model and wait/stream preferences only. It does not store the API key, environment, repository, request ID, or state directory.

Command-line flags override the config file. Switching `--model` does not keep the previous model's parameters. Schema and errors are in the [CLI contract](docs/protocols/cli.md#用户级配置).

Local receipts default to `~/.local/state/cursor-use/state.sqlite`. Set `CURSOR_USE_STATE_DIR` to change the directory.

## Agent skill

To let another coding agent operate this CLI, install or link [skills/cursor-use/SKILL.md](skills/cursor-use/SKILL.md) with that host's own rules. Cursor, Claude, and other hosts will not find this skill by themselves.

## Safety

- Do not paste `CURSOR_API_KEY` into chat, commits, or prompt files.
- The CLI does not read Cursor desktop login state.
- Artifact downloads do not forward the API key and do not overwrite existing files.
- Cancel is an explicit command. A local timeout leaves the cloud run running.

## Limits

- No native Projects management
- No complete saved-environment directory
- No `envVars` beta
- No desktop CDP, `cursor-agent`, or terminal-to-desktop control
- No automatic merge
- Environment observation is bounded and can be incomplete
- Named environment snapshot repos are not in the public v1 catalog; last-seen `repos[]` come from matching agents
- Provider git metadata is an Agent-level snapshot, not proof of a specific run's commits

## Documentation

- [CLI contract](docs/protocols/cli.md)
- [Request recovery](docs/runbook/request-recovery.md)
- [Documentation map](docs/README.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [License](LICENSE)

## License

MIT. Cursor accounts, cloud execution, and third-party repositories have their own terms.
