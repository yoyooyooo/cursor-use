# Changelog

本文件记录公开版本的重要变化。未发布内容放在 `Unreleased`，版本号遵循 Semantic Versioning。

## Unreleased

- 忙碌续派明确从不排队：`agents follow-up --wait` 等到空闲后再 POST 一次；`409 agent_busy` JSON 带 `activeRunId`、`nextStep=wait-then-new-request-id`。
- 增加 `envs show --name`；`--observed` 与 `envs list` 可显示 last-seen snapshot `repos[]`。公开 v1 没有环境 catalog，`--env` 仍不与 `--repo`/`--ref` 组合。
- `--env` dry-run 输出 `git` 约束：prompt 不能替换 snapshot 仓库，launch/`agents show` 的 `repos` 才是云端 git。
- `agents result` 增加 `emptyResult`；`FINISHED` 且 result 为空不再被包装器误当成已验收。

## 0.2.2 - 2026-09-20

- 发布包用 Bun 打 tarball，再交给 npm 发布，避免 `catalog:` 进入 registry。
- 后续版本通过 GitHub Actions Trusted Publishing 发版。
- 面向用户的双语 README 和英文 skill。

## 0.2.1 - 2026-09-20

- 增加用户级配置 `~/.cursor-use/config.json`。
- 支持模型、等待和 SSE 流默认值，并严格拒绝损坏或未知字段。
- 保持命令行显式参数优先于用户配置。
- 完善配置相关测试和 CLI dry-run 验证。

## 0.2.0 - 2026-09-19

- 增加 SSE 流、有限重连、事件续读和历史过期快照。
- 增加安全产物下载、大小限制、主机白名单和 SHA-256 校验。
- 增加有界分页、scratch、plan、多仓库、明确 ref 和模型参数。
- 增加结果汇总、Run 归属和未知结果恢复保护。

## 0.1.0 - 2026-09-19

- 建立官方 Cursor Cloud Agents v1 REST CLI。
- 增加 SQLite 回执、Agent/Run 查询、续派、等待、取消和 usage 查询。
- 增加外部 Agent skill 和基础真实云端验收。
