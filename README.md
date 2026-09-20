# cursor-use

[![CI](https://github.com/yoyooyooo/cursor-use/actions/workflows/check.yml/badge.svg)](https://github.com/yoyooyooo/cursor-use/actions/workflows/check.yml)

A Bun CLI and Agent skill for Cursor Cloud Agents. It provides recoverable task dispatch, Run tracking, SSE streaming, usage and artifact inspection through the official v1 API.

> The first npm version must be published from a logged-in local session. After that, later versions use GitHub Actions trusted publishing.

## Scope

- Official Cursor Cloud Agents v1 REST API
- Agent and Run creation, inspection, waiting, cancellation and follow-up
- SQLite receipts, stable request IDs and unknown-outcome recovery
- SSE events, bounded reconnects and event resumption
- Usage, artifacts and bounded resource observation
- Artifact downloads with host allowlists, size limits and SHA-256 verification
- An external Agent skill for safe task dispatch and acceptance

The project does not claim native Projects management, a complete environment directory, the `envVars` beta, desktop CDP integration, `cursor-agent` integration or automatic merge. Historical experiments are not current product capabilities.

## Requirements

- Bun `1.4.2` or newer
- Access to the Cursor Cloud Agents API
- `CURSOR_API_KEY` in the process environment for remote operations

Local development and packaging have been verified on macOS with Bun `1.4.2`.
CI is configured for Ubuntu and macOS. Windows is not a verified platform.

The CLI does not read desktop login state and does not write the API key to configuration, receipts, prompts or logs.

## Install From Source

```sh
bun install --frozen-lockfile
bun run package:check
bun link
cursor-use --version
cursor-use capabilities --json
```

Run a local, no-network dry-run first:

```sh
cursor-use agents launch \
  --scratch \
  --prompt "Return a short readiness summary." \
  --request-id example-dry-run \
  --dry-run \
  --json
```

For a remote operation, set the credential in the process that invokes the CLI:

```sh
export CURSOR_API_KEY="..."
cursor-use doctor --json
cursor-use models --json
```

Creating a Cloud Agent may incur service charges. Use one stable request ID per logical submission. The CLI persists a receipt before a paid POST and does not automatically retry an uncertain submission.

## User Configuration

Optional defaults live in `~/.cursor-use/config.json`. The file stores only model and wait/stream preferences, never the API key, task target, repository, request ID or state directory. Explicit command-line values take precedence. See the [CLI contract](docs/protocols/cli.md#用户级配置) for the schema and validation rules.

## Agent Skill

The skill source is [skills/cursor-use/SKILL.md](skills/cursor-use/SKILL.md). Install or link it using the conventions of the host Agent. The project does not assume that a particular host will discover or activate it automatically.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run package:check
git diff --check
```

Tests use fake providers and local subprocesses. They do not require a Cursor credential or create Cloud Agents. Keep real cloud validation separate from CI and record its scope without publishing account-specific identifiers, signed URLs or local paths.

## Documentation and Project Policy

- [中文说明](README.zh-CN.md)
- [Documentation map](docs/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [Maintainer guide](AGENTS.md)
- [Release and package policy](docs/release.md)
- [License](LICENSE)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

This project is released under the [MIT License](LICENSE). Cursor services, account permissions, remote repositories and other third-party services remain subject to their own terms.
