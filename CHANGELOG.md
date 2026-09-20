# Changelog

本文件记录公开版本的重要变化。未发布内容放在 `Unreleased`，版本号遵循 Semantic Versioning。

## Unreleased

- 完善公开仓库许可证、贡献、安全报告和发布入口。
- 增加受限 npm 包清单、构建前置、catalog 展开和发布包检查。
- 清理公开文档中的本机路径、真实云端标识和桌面实验细节。

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
