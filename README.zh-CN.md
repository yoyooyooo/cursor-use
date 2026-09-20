# cursor-use

`cursor-use` 是一个 Bun CLI 和 Agent skill，用于通过官方 Cursor Cloud Agents API 派发、跟进和恢复云端任务。

首个 npm 版本必须从已登录的本地会话发布。之后的版本通过 GitHub Actions Trusted Publishing 发布。

## 当前范围

- 官方 Cloud Agents API v1
- Agent/Run 创建、查询、等待、取消和续派
- SQLite 回执、固定 request ID 和未知结果恢复
- SSE 事件流、有限重连和事件续读
- 用量、产物和有界资源观察
- 安全产物下载、主机白名单和 SHA-256 校验
- 外部 Agent skill

当前不支持原生 Projects 管理、完整环境目录、envVars beta、桌面 CDP、`cursor-agent` 互通或自动合并。仓库中的历史实验记录不代表当前产品能力。

## 要求

- Bun `1.4.2` 或更高版本
- Cursor Cloud Agents API 访问权限
- 远端操作时由调用进程提供 `CURSOR_API_KEY`

本地开发和打包已在 macOS、Bun `1.4.2` 上验证。CI 覆盖 Ubuntu 和 macOS。Windows 不是已验证平台。

CLI 不会读取 Cursor 桌面登录态，也不会把 API Key 写入配置、回执、prompt 或日志。

## 从源码安装

```sh
bun install --frozen-lockfile
bun run package:check
bun link
cursor-use --version
cursor-use capabilities --json
```

先用不访问远端的 dry-run 验证输入和构建产物：

```sh
cursor-use agents launch \
  --scratch \
  --prompt "Return a short readiness summary." \
  --request-id example-dry-run \
  --dry-run \
  --json
```

真实远端操作前，在调用 CLI 的进程中设置凭据：

```sh
export CURSOR_API_KEY="..."
cursor-use doctor --json
cursor-use models --json
```

真实创建任务会产生服务费用。每次逻辑提交使用固定 request ID，提交前会写入本地回执；响应不明确时先恢复，不要生成新 ID 重试。

## 用户配置

可选配置位于 `~/.cursor-use/config.json`，只保存个人默认模型和等待偏好，不保存 API Key、任务目标、仓库或状态目录。命令行显式参数优先。示例和严格校验规则见 [CLI 契约](docs/protocols/cli.md#用户级配置)。

## Skill

Skill 文件位于 [skills/cursor-use/SKILL.md](skills/cursor-use/SKILL.md)。宿主可以按自身规则安装或链接该目录；项目不会假定某个 Agent 宿主会自动发现它。

## 文档与维护

- [中文说明](README.zh-CN.md)
- [文档导航](docs/README.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [变更记录](CHANGELOG.md)
- [维护者 Agent 指南](AGENTS.md)
- [许可证](LICENSE)
- [第三方许可证清单](THIRD_PARTY_NOTICES.md)

## 许可证

本项目采用 [MIT License](LICENSE)。Cursor 服务、账号权限、远端仓库和相关第三方服务遵循各自的条款。
