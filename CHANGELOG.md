# Changelog

[English](./CHANGELOG.md) | [中文](./CHANGELOG.zh-CN.md)

This file records notable public changes. Unreleased work stays under `Unreleased`. Versions follow Semantic Versioning.

## Unreleased

- Busy follow-up is never queued: `agents follow-up --wait` waits until idle, then POSTs once. `409 agent_busy` JSON includes `activeRunId` and `nextStep=wait-then-new-request-id`.
- Add `envs show --name`. `--observed` and `envs list` can show last-seen snapshot `repos[]`. Public v1 has no environment catalog, and `--env` still does not combine with `--repo`/`--ref`.
- `--env` dry-run emits `git` constraints: prompt text does not replace snapshot repos; launch / `agents show` `repos` is the git the cloud used.
- `agents result` adds `emptyResult`. `FINISHED` with missing result text is not treated as accepted work.
- Split the changelog into English `CHANGELOG.md` and Chinese `CHANGELOG.zh-CN.md`, matching the README.

## 0.2.2 - 2026-09-20

- Publish by packing a Bun tarball, then handing that tarball to npm, so `catalog:` never reaches the registry.
- Later versions publish through GitHub Actions Trusted Publishing.
- Ship a bilingual user README and an English skill.

## 0.2.1 - 2026-09-20

- Add user-level config at `~/.cursor-use/config.json`.
- Support model, wait, and SSE stream defaults, and strictly reject damaged or unknown fields.
- Keep explicit command-line flags ahead of user config.
- Cover config-related tests and CLI dry-run validation.

## 0.2.0 - 2026-09-19

- Add SSE streaming, bounded reconnects, event resume, and expired-history snapshots.
- Add safe artifact downloads with size limits, a host allowlist, and SHA-256 checks.
- Add bounded pagination, scratch, plan, multiple repositories, explicit refs, and model parameters.
- Add result summaries, run attribution, and recovery protection for unknown outcomes.

## 0.1.0 - 2026-09-19

- Establish the official Cursor Cloud Agents v1 REST CLI.
- Add SQLite receipts and Agent/Run query, follow-up, wait, cancel, and usage commands.
- Add an external Agent skill and a basic live cloud acceptance pass.
