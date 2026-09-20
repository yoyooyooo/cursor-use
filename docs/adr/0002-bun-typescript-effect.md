# 采用 Bun、TypeScript 和 Effect-first

状态：已接受。2026-09-19 用户明确指定 Bun、TypeScript、Effect-first、Effect v4 beta，并要求通过 Bun catalog 锁定版本。

## 决策

Bun 同时承担运行时、包管理、构建和测试。TypeScript 以 strict 模式检查源码与测试。异步执行、预期失败、资源生命周期和并发优先使用 Effect v4。

此次按用户指定的 beta 发布线选择版本。核验时 `effect` 和 `@effect/platform-bun` 的 beta 标签均为 `4.0.0-beta.107`；虽然 RC 发布线已有更高版本，本决策不自动采用 RC。具体版本以 package.json 的 catalog 与 bun.lock 为准。

在单包根目录使用 `workspaces.catalog`，packages 保持空数组，不为使用 catalog 拆分 monorepo。所有直接依赖使用 `catalog:`。Effect 包族的 override 同样引用 catalog，避免传递依赖在允许的版本范围内解析到其他 beta 或 RC。

根 CLI 使用 Effect 的 CLI 模块，Bun 平台能力在进程入口装配。只为真实能力引入 Service 和 Layer，不把简单纯函数改造成无收益的 Effect 包装。

## 代价与边界

Effect beta 与 unstable CLI 可能改变 API。升级必须集中进行，并重新验证类型、平台装配和真实 CLI 输出。普通安装和 CI 使用 frozen lockfile，不跟随 latest、beta 或 RC 标签浮动。

这项决定替换初始化时的 Node 运行时暂定声明，不修改[决策 0001](0001-own-cli-and-skill.md)的独立 CLI + skill 和官方 API 优先路线。帮助/版本 CLI 只是技术基线，不表明云端能力已实现。

## 受影响知识

- [Effect-first 规则](../standards/effect-first.md)拥有日常执行约束。
- [当前结构](../architecture/current-architecture.md)记录真实代码、依赖和入口。
- [验证规则](../standards/verification-policy.md)规定检查与证据范围。
- [实施路线](../roadmap/implementation-plan.md)记录技术基线和业务工作的不同完成状态。
