# Changelog

This file records notable public changes. Unreleased work stays under `Unreleased`. Versions follow Semantic Versioning.

本文件记录公开版本的重要变化。未发布内容放在 `Unreleased`，版本号遵循 Semantic Versioning。

## Unreleased

### English

- Busy follow-up is never queued: `agents follow-up --wait` waits until idle, then POSTs once. `409 agent_busy` JSON includes `activeRunId` and `nextStep=wait-then-new-request-id`.
- Add `envs show --name`. `--observed` and `envs list` can show last-seen snapshot `repos[]`. Public v1 has no environment catalog, and `--env` still does not combine with `--repo`/`--ref`.
- `--env` dry-run emits `git` constraints: prompt text does not replace snapshot repos; launch / `agents show` `repos` is the git the cloud used.
- `agents result` adds `emptyResult`. `FINISHED` with missing result text is not treated as accepted work.

### 中文

- 忙碌续派明确从不排队：`agents follow-up --wait` 等到空闲后再 POST 一次；`409 agent_busy` JSON 带 `activeRunId`、`nextStep=wait-then-new-request-id`。
- 增加 `envs show --name`；`--observed` 与 `envs list` 可显示 last-seen snapshot `repos[]`。公开 v1 没有环境 catalog，`--env` 仍不与 `--repo`/`--ref` 组合。
- `--env` dry-run 输出 `git` 约束：prompt 不能替换 snapshot 仓库，launch/`agents show` 的 `repos` 才是云端 git。
- `agents result` 增加 `emptyResult`；`FINISHED` 且 result 为空不再被包装器误当成已验收。

## 0.2.2 - 2026-09-20

### English

- Publish by packing a Bun tarball, then handing that tarball to npm, so `catalog:` never reaches the registry.
- Later versions publish through GitHub Actions Trusted Publishing.
- Ship a bilingual user README and an English skill.

### 中文

- 发布包用 Bun 打 tarball，再交给 npm 发布，避免 `catalog:` 进入 registry。
- 后续版本通过 GitHub Actions Trusted Publishing 发版。
- 面向用户的双语 README 和英文 skill。

## 0.2.1 - 2026-09-20

### English

- Add user-level config at `~/.cursor-use/config.json`.
- Support model, wait, and SSE stream defaults, and strictly reject damaged or unknown fields.
- Keep explicit command-line flags ahead of user config.
- Cover config-related tests and CLI dry-run validation.

### 中文

- 增加用户级配置 `~/.cursor-use/config.json`。
- 支持模型、等待和 SSE 流默认值，并严格拒绝损坏或未知字段。
- 保持命令行显式参数优先于用户配置。
- 完善配置相关测试和 CLI dry-run 验证。

## 0.2.0 - 2026-09-19

### English

- Add SSE streaming, bounded reconnects, event resume, and expired-history snapshots.
- Add safe artifact downloads with size limits, a host allowlist, and SHA-256 checks.
- Add bounded pagination, scratch, plan, multiple repositories, explicit refs, and model parameters.
- Add result summaries, run attribution, and recovery protection for unknown outcomes.

### 中文

- 增加 SSE 流、有限重连、事件续读和历史过期快照。
- 增加安全产物下载、大小限制、主机白名单和 SHA-256 校验。
- 增加有界分页、scratch、plan、多仓库、明确 ref 和模型参数。
- 增加结果汇总、Run 归属和未知结果恢复保护。

## 0.1.0 - 2026-09-19

### English

- Establish the official Cursor Cloud Agents v1 REST CLI.
- Add SQLite receipts and Agent/Run query, follow-up, wait, cancel, and usage commands.
- Add an external Agent skill and a basic live cloud acceptance pass.

### 中文

- 建立官方 Cursor Cloud Agents v1 REST CLI。
- 增加 SQLite 回执、Agent/Run 查询、续派、等待、取消和 usage 查询。
- 增加外部 Agent skill 和基础真实云端验收。
