# Effect-first 工程规则

适用范围为 cursor-use 的源码、测试和依赖更新。采用依据见[决策 0002](../adr/0002-bun-typescript-effect.md)。

## 工具链与版本

[package.json](../../package.json) 的 `packageManager` 固定本地和 CI 使用的 Bun 版本。TypeScript 与 Bun 类型声明也进入 `workspaces.catalog`。直接依赖与根 overrides 使用 `catalog:`，catalog 中只写精确版本，不使用范围或 dist-tag。

[bun.lock](../../bun.lock) 固定实际依赖树。`@effect/platform-node-shared` 虽是传递依赖，也通过 catalog override 固定到同一 Effect beta 版本。不能只锁 effect 而让平台包随范围漂移。

普通安装使用 `bun install --frozen-lockfile`。有意升级时先更新 catalog，再执行 `bun install` 生成锁文件，最后重新执行 frozen 安装和 `bun run check`。不要引入其他包管理器的锁文件。

## 执行与依赖

- 执行路径优先表达为 Effect，使用类型化失败、Scope、取消和结构化并发。
- 在 CLI 宿主入口执行 Effect 并装配平台 Layer，不在业务函数里随意 runPromise 或另造全局 Runtime。
- I/O、需要替换的提供方能力和共享失败语义可以成为 Effect Service。纯转换和局部算法保留普通 TypeScript。
- 一个能力只保留一份主要契约，不为了文件对称建立重复 Port/Service，或空的 services、layers、adapters 目录。
- 外部输入在边界解析；内部依赖已验证类型。预期失败、程序缺陷、中断和结果未知分别表达。
- 本地超时不证明远端操作失败。重试必须符合[派发与恢复不变量](../ssot/domain-model.md#派发与恢复不变量)。

## 输出与资源

框架帮助/版本文本和业务机器输出分开。当前 CLI 的框架文本缓冲只用于修正 beta 的错误输出通道；后续业务 JSON 和流式结果不经过该缓冲，应使用独立的标准输出写入路径。

诊断写 stderr。引入业务处理器时同时补全错误协议，不能依赖关闭运行时报告来隐藏缺陷。子任务和资源必须有所属 Scope 或宿主，并在取消、失败和正常结束时关闭。

## 可验证性

具体 API 语法以锁定版本、已安装类型声明和编译结果为准，不把 v3 或其他 beta 示例混入项目。

纯逻辑按行为测试。Effect 测试在真正的能力边界替换依赖；涉及 Clock、资源释放和并发时验证对应语义，不以 mock 次数替代可观察结果。CLI 验收启动真实进程并检查输出与退出码。

当前检查命令与尚未覆盖的业务情形见[验证规则](verification-policy.md)。
