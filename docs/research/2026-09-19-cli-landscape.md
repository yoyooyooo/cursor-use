# Cursor Cloud CLI 选型核验

知识角色：选型时的研究快照，不是 cursor-use 当前产品、架构或命令契约。2026-09-19 根据当时的公开资料和本项目研究记录整理；保留原始观察和建议，后续版本变化不在本快照中悄然改写。

正式采用的选择见[决策 0001](../adr/0001-own-cli-and-skill.md)，当前目标见[产品范围](../product/scope.md)，实施进度见[实施路线](../roadmap/implementation-plan.md)。下文的临时名称 `cursor-cloud` 已在项目初始化时确定为 `cursor-use`；历史名称和命令示意不表示本项目已有可执行接口。

核验日期：2026-09-19。目标：让个人外部 Agent 通过 CLI + skill 派发和跟进 Cursor Cloud Agent，并发现云端环境及原生 Projects。

## 结论

建议独立实现一个范围受控的 TypeScript CLI + skill，以官方 v1 REST 为任务控制入口；不整体 fork 当前候选，也不创建新的编排平台。借鉴已许可项目的错误处理、权限边界和机器输出设计。原生环境和 Projects 的读取先做能力验证，不能用历史任务归集或本地别名冒充全量平台资源。

选择 REST 不是否定官方 SDK：本需求是远程管理，不需要本地 Agent 循环。REST 可覆盖已公开任务能力，依赖更少，行为更容易审计。将 HTTP 细节集中在一个 client 中即可，不预建多后端框架。若实测 SDK 显著降低事件流或会话恢复成本，可在这个边界内使用官方 SDK；不要再依赖第三方 SDK。

## 证据范围

- GitHub 元数据、main 提交、Releases、Actions 运行及步骤结果，部分上游 CI 日志。
- npm 发布元数据及四个项目的 main 源码快照。
- 本地保存的候选项目源码快照。
- 官方 API、SDK、Projects 文档和 v1 OpenAPI。
- 没有安装候选 CLI，没有把 Cursor Key 交给候选代码，没有执行候选测试或发起付费 Cloud Agent。
- 上游 CI 成功不等于当前账号真实端到端通过；源码检查是重点抽查，不是完整安全审计。
- opensrc 保存的是没有 `.git` 的快照；下列 SHA 来自本次 GitHub API 查询，不冒称从本地 Git 读取。

## 维护和发布

| 项目 | Star / Fork | 创建 / 最近推送 | main 提交记录 | 发布与许可 |
| --- | --- | --- | --- | --- |
| BeckWangthumboon/outsource | 0 / 0 | 07-12 / 07-23 | 23 条，主要维护者一位，另有 cursoragent 提交 | package 0.1.6；Git 安装；正式 GitHub Release 列表仅 v0.1.0；未发现许可 |
| uklok/cursor-cloud-agent | 0 / 0 | 09-15 / 09-15 | 4 条，全部同一天，author 为 aipal-agent | 0.1.0；MIT；npm 包 openclaw-plugin-cursor-cloud 查询 404 |
| ASRagab/cursor-agents-sdk-ts | 0 / 0 | 04-01 / 04-20 | 38 条，含机器人和合并提交 | npm @twelvehart/cursor-agents 1.0.0，04-12 发布；MIT；1.1.0 release PR #8 未关闭 |
| ebrindley/cursor-mcp | 0 / 0 | 09-14 / 09-19 | 24 条，含 backlog 记录；一位主要维护者 | package 0.12.0；MIT；Git 源码构建；GitHub Releases 为空 |

日期均为 2026 年。提交数不是维护者数量；短期频繁提交不是长期维护保证。0 issue 不能解释为口碑好，因为没有足够采用量。

历史候选 `567-labs/cloud-cursor-agent` 为 7 star / 1 fork、MIT，最近推送 2025-11-24，npm `cloud-agent` 0.1.4，源码仍使用 v0。采用信号稍多，但不足以抵消功能和更新滞后。

main SHA：

- outsource：`f04c13f3f2aa1be4f062110392774b6dd42a2085`
- uklok：`4fb1cbd5a6c489241a2209b3da855dcbabb104b9`
- ASRagab：`54567b6ec9126b32be6fbfec945fea3cd74eeff0`
- ebrindley：`61b82cc7870fd5cb8de8e02144c725235081fbdf`

## 源码和测试判断

### outsource

- 最新上游 CI 成功：55 tests passed / 0 failed，9 个测试文件，包含类型检查和构建。
- `src/` 非测试 TypeScript 约 562 行、12 个文件。结构简单，但功能窄。
- `src/cursor.ts:19` 绑定单仓库、agent mode、独立分支和 `autoCreatePR: true`。
- `src/git.ts:7` 只接受 github.com origin。不能直接用于 AGS origin；显式 ref 只允许分支，不允许 commit SHA。
- 自带 skill 要求主要通过 PR 跟踪，不持续轮询 Cursor，与通用云任务管理的完整语义不符。
- 网络错误统一标注 retryable，未在封装中提供持久化创建请求或结果未知状态管理，不能据此盲目重发任务。
- 源码树无 LICENSE/LICENCE/COPYING，package 无 license。可学习设计思想；复制、修改、分发实现前需获得许可，不能仅因公开访问就视作开源。

判断：适合受控试用单仓库 PR 派发，不适合作为本需求的 fork 基础。

### uklok/cursor-cloud-agent

- 有 13 个测试文件。唯一 CI annotation：`The job was not started because your account is locked due to a billing issue.` Node 22 未运行，Node 24 取消；不是代码测试失败，也不是测试通过。
- `src/` 非测试 TypeScript 约 3207 行、27 个文件。
- `src/env-catalog.ts:27` 环境发现只读 3 页，每页 20 个 Agent；最多从 60 个记录归集环境。返回没有完整性标记表明是否还有分页；旧环境、未使用环境和未命名环境可能缺失。
- `src/ledger.ts:23` 本地只留 50 条 Agent 记录。read-modify-write 没有通用并发事务保护，多 CLI 进程存在丢失更新风险。
- `src/client.ts` 设置 `Idempotency-Key` header；当前官方 v1 明确的创建防重复机制是请求体 `agentId`。没有证据证明该 header 有同等保证，不能把选项名称当成已验证的防重复能力。
- GET 对 429/5xx 重试；POST 不自动重试；固定 API host 和拒绝重定向值得借鉴。
- client 收到 headers 后就清理超时，再读取 JSON body；超时未覆盖整个 body 读取。
- 非 optional OpenClaw peer dependency，prepack 依赖 OpenClaw 插件构建；虽有独立 CLI，打包流程仍以 OpenClaw 为中心。
- 环境 role 的 `project` 是自身分类，不是 Cursor 原生 Projects。

判断：借鉴环境别名、回执和会话映射；不直接部署或整体 fork。复制 MIT 代码需保留许可与来源。

### ASRagab/cursor-agents-sdk-ts

- 最新 CI 的 lint、typecheck、unit tests、build、打包内容检查、packed CLI smoke 成功。旧运行日志下载返回 410，未取得测试数量。
- 有 9 个测试文件，含集成测试和只读契约验证。CI 的成功不能解释为这些实时测试全部运行过。
- npm 1.0.0 在 04-12 发布，main 在 04-20 有额外修复，release PR #8 未发布。因此 main/README 与 npm 包不能视为一致。
- `src/agents.ts:51` 起仍调用 `/v0/agents`，没有 v1 Agent/Run 分离。
- JSON 成功/错误、退出码、prompt-file、wait/watch/产物，以及只读契约验证值得参考。
- skill 的裸 `npx cursor-agents` 与 README scoped npm 包名不同，不能盲目照搬。
- v0 仍有官方 legacy 文档，不将其称为已退役；问题是路线不适合建立长期新依赖。

判断：不作底座，借鉴输出和验证方法。

### ebrindley/cursor-mcp

- 最新 CI 在 Node 20/22/24 成功：每个矩阵为 1004 tests passed、37 个 Vitest 文件；Node 22/24 另有 18 个安装测试通过。
- 有类型检查、构建、入口检查、秘密模式扫描和依赖审计。
- 审计以 high 为失败阈值，日志仍报告 Hono moderate 级漏洞；CI 绿不代表零漏洞。未评估这些漏洞路径在该工具中是否可达。
- `src/` 非测试 TypeScript 约 23987 行、49 个文件；本地统计 38 个测试文件，含安装测试。
- `src/client.ts:283` 不自动重试 POST，区分写入结果未知。`src/tools/agents.ts:1010` 附近支持稳定 client agentId 并核对返回 ID。
- GET 重试、取消、超时、预算耗尽与限流区分、响应校验、响应大小限制、身份权限检查值得参考。
- 全局环境清单依赖显式配置的官方 CLI `env list --output json`，不是公开 v1 REST；先验 help、版本、身份，缺能力明确返回不可用。
- 部分环境诊断另开付费 Cloud Agent；不能理解为零费用、无副作用的普通查询。
- 引入了 MCP、环境生命周期、远程终端等本需求暂不需要的复杂度。
- README 明确独立维护、不接受 PR、无支持承诺。五天公开历史只能证明近期活跃，不能证明长期维护。

判断：若接受 MCP 并需要大量高级功能，这是四者中工程防护最值得优先验证的候选。对 CLI + skill 需求，作为技术参考优于整体依赖。

## 自建策略

### 先验证真正困难的能力

1. 先核对当前账号环境和原生 Projects 的只读入口。若最新版官方 CLI 有相关命令，先独立验证 help、版本、身份和只读返回。不能把未知命令交给会将位置参数当 prompt 的 Agent CLI。
2. 官方 v1 OpenAPI 没有环境列表或 Projects 管理路由。若需要内部接口，单独评估认证、账户匹配、版本漂移和用户授权，不自动提取桌面登录 Token。
3. 环境返回标记 `source`、`complete`、`observedAt`。历史 Agent 归集仅为 observed 库存；手工登记仅为 configured 别名，不冒充权威全量目录。
4. Projects 无可验证入口时明确 unsupported/needs-auth 并给 UI 入口。不得用 repositories 或本地分组冒充；这仍属于未完成能力。

### 第一版命令范围

暂用 `cursor-cloud` 作为讨论名称，发布前需检查冲突：

```text
doctor / capabilities
models / repos
agents list / get / launch / follow-up
runs get / wait / stream / cancel
usage / artifacts
envs list / get
projects list / get
open
```

- stable JSON、确定的退出码；stdout 仅结果，stderr 诊断。
- 显式仓库或命名环境，不依赖当前 origin，不强制 PR、不改 remote。
- 创建前保存 requestId 到 agentId 的映射，提交官方支持的 client agentId；超时先回查，不换 ID 重试。envVars 与 client agentId 互斥，不能宣称全场景幂等。
- follow-up 无服务端幂等保证时，结果未知不能自动重发。
- agentId/runId 持久化；本地退出不取消云任务；wait 超时不等于 cancel。
- 区分 FINISHED 和验收通过；支持 plan/no-repo，不要求所有任务产出 PR。
- SSE 游标和终态记录可恢复，以 GET 回查为准，不把 SSE 视作无限期存储。
- 不加入自动合并、永久删除、复杂编排、全局 Daemon 或完整 MCP 层。
- CLI 执行和校验，skill 教目标选择、任务上下文、恢复和验收，不重复网络逻辑。

### 验收条件

- 身份、模型、仓库、已有 Agent，以及环境/Project 能力矩阵只读验证。
- 用户授权后一个小额真实任务：创建、状态、续派、结果、费用和 UI 打开。
- 故障测试：响应丢失、重复提交、409、429、断流、等待超时、并发写记录。
- 完整分页与主动截断可区分，缓存与权威数据可区分。
- 不因 mock tests 或派发成功，就宣称环境/Projects 需求完成。

## 来源

- https://github.com/BeckWangthumboon/outsource
- https://github.com/BeckWangthumboon/outsource/actions/runs/29995764282
- https://github.com/uklok/cursor-cloud-agent
- https://github.com/uklok/cursor-cloud-agent/actions/runs/35016228163
- https://github.com/ASRagab/cursor-agents-sdk-ts
- https://github.com/ASRagab/cursor-agents-sdk-ts/pull/8
- https://github.com/ASRagab/cursor-agents-sdk-ts/actions/runs/24643717172
- https://github.com/ebrindley/cursor-mcp
- https://github.com/ebrindley/cursor-mcp/actions/runs/35411299554
- https://cursor.com/docs/cloud-agent/api/endpoints
- https://cursor.com/docs-static/cloud-agents-openapi.yaml
- https://cursor.com/docs/sdk/typescript
- https://cursor.com/docs/agent/projects
- https://cursor.com/docs/cloud-agent/capabilities#cursor-cloud-mcp
