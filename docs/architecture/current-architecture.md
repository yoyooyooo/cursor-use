# 当前结构

状态：0.2 已有云端任务闭环、SSE、目标与模型参数、结果聚合、安全产物下载、SQLite 回执和 skill。本文描述实际文件和边界；证据见[0.2 验收](../evidence/2026-09-19-cloud-v02.md)。目标技术方向由[决策 0001](../adr/0001-own-cli-and-skill.md)与[决策 0002](../adr/0002-bun-typescript-effect.md)负责。

## 当前文件

```text
cursor-use/
  README.md
  README.zh-CN.md
  LICENSE
  CHANGELOG.md
  CONTRIBUTING.md
  SECURITY.md
  AGENTS.md
  package.json
  bun.lock
  tsconfig.json
  .editorconfig
  .gitignore
  .github/workflows/check.yml
  .github/workflows/release.yml
  scripts/
    prepare-package.ts
    restore-package.ts
    package-assert.ts
  src/
    cli.ts
    main.ts
    cursor-api.ts
    http-boundary.ts
    cursor-events.ts
    run-stream.ts
    artifact-download.ts
    launch-input.ts
    config.ts
    schemas.ts
    operations.ts
    receipts.ts
    errors.ts
    output.ts
  test/
    cli.test.ts
    toolchain.test.ts
    cursor-api.test.ts
    operations.test.ts
    process-io.test.ts
    stream.test.ts
    artifact-download.test.ts
    errors.test.ts
    skill.test.ts
    docs.test.ts
    package.test.ts
    config.test.ts
  skills/cursor-use/SKILL.md
  docs/
    README.md
    release.md
    product/
    ssot/
    standards/
    architecture/
    adr/
    roadmap/
    research/
    protocols/
    runbook/
    evidence/
```

- [package.json](../../package.json) 声明 Bun 运行时、ESM、命令、精确 catalog 版本、Effect 包族 overrides 和公开包清单。
- [bun.lock](../../bun.lock) 固定解析结果和完整性信息，常规安装使用 frozen lockfile。
- [tsconfig.json](../../tsconfig.json) 启用 strict、noUncheckedIndexedAccess 和 exactOptionalPropertyTypes；检查源码与测试，不负责 emit。
- [.editorconfig](../../.editorconfig) 规定 UTF-8、LF 和基本缩进。
- [.gitignore](../../.gitignore) 排除依赖、构建产物、凭据文件和本地运行数据。
- [文档导航](../README.md) 解释各知识位置，不在此重复文档内容。

## CLI 执行边界

[src/cli.ts](../../src/cli.ts) 使用 `effect/unstable/cli` 定义根命令和业务子命令，名称和版本从包元数据读取。仅启用 Help 和 Version 框架全局选项，不启用交互 wizard；业务 JSON 不依赖交互终端。

当前 beta 在解析失败时也通过 Console.log 输出帮助。因此入口暂存框架帮助/版本文本；普通帮助正常退出，解析错误转为 JSON。此缓冲只服务框架文本，不接管业务输出。预期 Fault、缺陷与中断分别处理，不依赖关闭框架日志来隐藏业务失败。

[src/main.ts](../../src/main.ts) 提供 BunServices、CursorApiLive、ReceiptStoreLive、ArtifactDownloaderLive，通过 BunRuntime.runMain 执行。[output.ts](../../src/output.ts) 等待 stdout/stderr 写完成回调，普通结果是单个 JSON，SSE 消费是逐行 JSON；两者不进入框架帮助缓冲。

| 输入 | 当前观察到的行为 |
| --- | --- |
| 无参数、`--help`、`-h` | stdout 帮助文本，退出码 0 |
| `--version`、`-v` | stdout 包名与版本，退出码 0 |
| 未知选项或子命令 | stderr INVALID_INPUT JSON，退出码 1，stdout 为空 |
| 已实现业务命令成功 | stdout JSON，退出码 0 |
| 缺 Key、失败、未知结果或不支持 | stderr 结构化错误，退出码 1 |

## 提供方与状态边界

- [cursor-api.ts](../../src/cursor-api.ts) 是带 API 凭据的唯一服务边界，[http-boundary.ts](../../src/http-boundary.ts) 统一固定主机、认证、HTTP 诊断和受限读重试。POST 不重试，不提供任意 base URL。
- [cursor-events.ts](../../src/cursor-events.ts) 用 Effect 的 SSE 解析器和 Stream 解码 UTF-8/分块，Scope 拥有连接及读取器；[run-stream.ts](../../src/run-stream.ts) 拥有重连、已输出游标、超时、410 降级和 Run 终态判断。
- [artifact-download.ts](../../src/artifact-download.ts) 是独立的无 API 凭据下载边界，只接受已验证 Cursor S3 主机，限制大小、不覆盖文件、计算摘要并保留失败文件；Scope 释放网络和文件句柄。
- [launch-input.ts](../../src/launch-input.ts) 是纯输入规范化与 dry-run，不访问远端；模型目录校验由提交操作负责。
- [config.ts](../../src/config.ts) 在 CLI 边界读取并严格解析 `~/.cursor-use/config.json`，只保存版本化的模型和等待偏好。缺文件使用内置默认值，坏文件直接失败；不读 Key，不移动状态库。
- [schemas.ts](../../src/schemas.ts) 在边界用 Effect Schema 验证关键字段，保留提供方附加结果信息。
- [operations.ts](../../src/operations.ts) 负责目标约束、创建、回查、续派、等待、取消及资源观察，不直接掌握进程输出或数据库连接。
- [receipts.ts](../../src/receipts.ts) 用 Bun SQLite 和事务拥有回执唯一性。每次访问用 acquireUseRelease 关闭连接；WAL、busy timeout 与有限 busy 重试覆盖并发初始化和读写。
- [errors.ts](../../src/errors.ts) 拥有 typed Fault、标识校验和 Key 脱敏。updateFault 显式保留不可枚举的 Error.message，不能直接展开错误对象冒充完整复制。

回执在发送 POST 前持久化，通过事务 claim 限制同一 request ID 的提交者。网络中断后保留 dispatching/unknown；创建可按提前分配的 agentId 回查，续派不自动重发。默认目录为 `~/.local/state/cursor-use`，DB 权限 0600，不保存 prompt 正文。详细状态语义和恢复动作见[CLI 契约](../protocols/cli.md)与[请求恢复](../runbook/request-recovery.md)。

回执保存目标与 Run 归属来源，较弱观察和晚到超时不能覆盖已提交事实。SSE 不维护跨消费者共享游标；调用方保存事件 ID，每个消费者拥有自己的处理进度。目录翻页有页数上限、重复 cursor 检测和显式截断，不能视为原子快照。

环境信息仍为配置名称、有界历史观察和 `envs show`。观察结果可带 last-seen `repos[]`，但公开 v1 没有 snapshot catalog。原生 Projects 报 UNSUPPORTED。envVars beta 暂不接入，不牺牲提交恢复约束。skill 只引用已实现命令，不绕过这些边界。

## 桌面实验边界

[桌面 POC](../evidence/2026-09-19-desktop-poc.md) 保留为历史证据，用户已停止该方向。生产代码和命令树不包含桌面或 cursor-agent 控制器。

## 验证入口

[test/cli.test.ts](../../test/cli.test.ts) 启动真实 Bun 子进程，分别测试源码和构建产物。子进程不继承 Cursor 凭据，测试不创建云任务。

[test/toolchain.test.ts](../../test/toolchain.test.ts) 核对 catalog 引用、精确版本及已安装版本，包括 Effect 的传递平台依赖。

[HTTP 测试](../../test/cursor-api.test.ts) 验证认证、重定向、响应约束、读重试与写不重试；[业务测试](../../test/operations.test.ts) 验证恢复、账号和目标一致性、续派、分页与等待；[进程测试](../../test/process-io.test.ts) 验证大 JSON 与多进程状态初始化。测试不继承真实 Key，不创建付费任务。

[SSE 测试](../../test/stream.test.ts) 与[下载测试](../../test/artifact-download.test.ts) 验证故障、中断和资源释放；[错误测试](../../test/errors.test.ts) 防止诊断丢失；[配置测试](../../test/config.test.ts) 验证严格解析、缺省和大小限制；[skill 测试](../../test/skill.test.ts) 和[文档测试](../../test/docs.test.ts) 校验发现元数据、显式本地链接及入口可达性。

[CI 配置](../../.github/workflows/check.yml) 从 package.json 读取 Bun 版本，在 Ubuntu 和 macOS 上执行 frozen 安装、`bun run check` 和 `bun run package:check`。[发布包工作流](../../.github/workflows/release.yml) 只在版本 tag 上构建包产物，不自动发布 npm。本地配置了流程不等于远端 CI 已经运行。

## 实现进入条件

后续只为真实能力加入模块，不建立空 Service 或多层框架。添加存储或提供方适配器后更新本页，并给源码、测试与对应领域规则建立就近链接。

回执格式已由 ReceiptSchema 和 SQLite 实现确定。许可证、包内容和发布门禁见[发布策略](../release.md)。执行顺序与剩余验证见[实施路线](../roadmap/implementation-plan.md)。
