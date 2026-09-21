# cursor-use

[English](./README.md) | [中文](./README.zh-CN.md)

[![CI](https://github.com/yoyooyooo/cursor-use/actions/workflows/check.yml/badge.svg)](https://github.com/yoyooyooo/cursor-use/actions/workflows/check.yml)

给 Cursor Cloud Agents 用的 CLI。你可以自己跑，也可以交给另一个 Coding Agent。它派发云端任务，留下能找回的回执，跟进 Run，再用官方 v1 API 读用量和产物。

```sh
cursor-use agents launch \
  --scratch \
  --prompt "Return a short readiness summary." \
  --request-id example-dry-run \
  --dry-run \
  --json
```

这条 dry-run 只在本机跑，不读 Key，也不打到云端。

## 解决的问题

Cursor Cloud Agents 已经在云端跑。终端这边还缺一套办法：

- 选一个真实目标
- 一次提交配一个能找回的 request ID
- 离开后再回到同一个 Agent 和 Run
- 分清「CLI 调用成功」和「任务跑完且验收通过」

`cursor-use` 做的就是这些。桌面 Cursor 和 `cursor-agent` 不在范围内，见「限制」。

## 主要能力

- 创建、续派、等待、取消、查结果
- 本地 SQLite 回执，提交结果不明时也能恢复
- SSE 事件流，断线后有限次重连
- 用量、产物列表，以及按大小和 SHA-256 校验的下载
- 一份 skill，告诉外部 Agent 怎么调用这套 CLI

## 工作原理

1. 给 CLI 一段 prompt，并只选一个目标：`--env`、`--repo`、`--repos-file` 或 `--scratch`。
2. 付费提交时，CLI 先写本地回执，再请求 `https://api.cursor.com`。
3. 这个 request ID 可以查询、回查或复用。响应丢了，不会当成新任务再发。
4. 后续命令用已保存的 `agentId` 和 `runId`。本地等待或订阅流，都不会取消云端 Run。

CLI 从调用进程的环境变量读 API Key。它不会把 Key 写进配置、回执库、prompt 或日志。

## 安装

需要 [Bun](https://bun.sh) `1.4.2` 或更高版本。

```sh
bun install -g cursor-use
cursor-use --version
cursor-use capabilities --json
```

请安装 `0.2.2` 或更高版本。`0.2.1` 的依赖仍是 workspace `catalog:`，装不上。

从源码安装：

```sh
git clone https://github.com/yoyooyooo/cursor-use.git
cd cursor-use
bun install --frozen-lockfile
bun run build
bun link
cursor-use --version
```

已在 macOS、Bun `1.4.2` 上验证。CI 覆盖 Ubuntu 和 macOS。Windows 尚未验证。

## 快速开始

上面的 dry-run 过后，远端命令要在同一进程里提供 Cursor API Key：

```sh
export CURSOR_API_KEY="..."
cursor-use doctor --json
cursor-use models --json
```

创建 Agent 可能产生 Cursor 用量费用。每个逻辑提交用一个 request ID。结果不清楚时，先看回执再回查，不要换新 ID 重发。

```sh
cursor-use agents launch \
  --scratch \
  --prompt "Return a short readiness summary." \
  --request-id my-task-001 \
  --json
cursor-use receipts show --request-id my-task-001 --json
```

从回执里记下 `agentId` 和 `runId`，再等待、订阅或续派：

```sh
cursor-use runs wait --agent-id <bc-id> --run-id <run-id> --json
cursor-use agents result --agent-id <bc-id> --run-id <run-id> --json
cursor-use agents follow-up --agent-id <bc-id> --prompt "Add the missing edge case." --request-id my-task-002 --wait --json
```

`FINISHED` 只表示这轮跑完了，不等于验收通过。还要看 `emptyResult`、结果文本、git 快照、产物，以及你自己的标准。忙碌时续派不会排队；优先 `--wait`。若回执已被拒绝，等空闲后换新的 `--request-id`。

`--env` 不能和 `--repo`/`--ref` 组合。prompt 里的 clone URL 替换不了 snapshot 仓库。先看 `envs show --name <env> --observed --json`，以及 launch / `agents show` 返回的 `repos`。

## 配置

可选默认值在 `~/.cursor-use/config.json`。文件只存模型和等待 / 流式偏好，不存 API Key、环境、仓库、request ID 或状态目录。

命令行参数覆盖配置文件。换 `--model` 时，不会沿用上一个模型的参数。格式和报错见 [CLI 契约](docs/protocols/cli.md#用户级配置)。

本地回执默认在 `~/.local/state/cursor-use/state.sqlite`，用 `CURSOR_USE_STATE_DIR` 改目录。

## Agent skill

要让另一个 Coding Agent 操作这套 CLI，按那个宿主自己的规则安装或链接 [skills/cursor-use/SKILL.md](skills/cursor-use/SKILL.md)。Cursor、Claude 和其他宿主不会自己找到这份 skill。

## 安全

- 不要把 `CURSOR_API_KEY` 写进对话、提交或 prompt 文件。
- CLI 不读 Cursor 桌面登录态。
- 产物下载不转发 API Key，也不覆盖已有文件。
- 取消要显式发命令。本地超时不会停掉云端 Run。

## 限制

- 不支持原生 Projects 管理
- 没有完整的保存环境目录
- 不开放 `envVars` beta
- 不支持桌面 CDP、`cursor-agent`，也不做终端到桌面控制
- 不自动合并
- 环境观察有上限，列表可能不完整
- 命名环境的 snapshot 仓库不在公开 v1 catalog 里；last-seen `repos[]` 来自匹配的 Agent
- 提供方 git 元数据是 Agent 级快照，不能当某一轮的提交证明

## 文档

- [CLI 契约](docs/protocols/cli.md)
- [请求恢复](docs/runbook/request-recovery.md)
- [文档导航](docs/README.md)
- [变更记录](CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [许可证](LICENSE)

## 许可证

MIT。Cursor 账号、云端执行和第三方仓库仍走各自条款。
