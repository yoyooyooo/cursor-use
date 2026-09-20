# Contributing

感谢贡献。`cursor-use` 是一个面向外部 Agent 的 Bun CLI 和 skill，变更必须保持官方 Cloud API 边界、可恢复请求语义和可验证输出契约。

## 开发环境

- Bun `1.4.2` 或更高版本
- Git
- 不需要 Cursor 凭据即可运行类型检查、构建和测试

初始化和检查：

```sh
bun install --frozen-lockfile
bun run check
bun run package:check
```

`bun run package:check` 会验证构建产物、包清单和版本输出。测试不得创建真实 Cloud Agent 或产生付费请求。需要修改云端行为时，优先使用 fake API 和离线测试；真实验收必须由维护者单独授权并记录范围。

## 提交变更

1. 从最新的 `main` 创建分支。
2. 保持变更聚焦，更新负责该含义的文档、测试和 skill 入口。
3. 不提交 `CURSOR_API_KEY`、私有仓库地址、签名 URL、SQLite 状态目录、真实 Agent/Run 标识或本机绝对路径。
4. 运行 `bun run check`、`bun run package:check` 和 `git diff --check`。
5. Pull request 中说明行为变化、验证命令、未验证边界和是否改变费用或凭据边界。

## 代码约定

- 使用 TypeScript、Bun 和仓库中锁定的 Effect 版本。
- 依赖版本集中在 `package.json` 的 catalog，消费者使用 `catalog:`。
- 成功业务结果写 stdout，失败写 stderr 并返回非零退出码。
- 付费 POST 必须先持久化意图；未知结果不得自动重试。
- 不新增任意 API proxy、登录态提取、桌面 CDP、`cursor-agent` 或未验证的原生 Projects 能力。

## Pull request

请使用仓库的 Pull Request 模板。维护者会检查测试、文档入口、敏感信息扫描、包清单和公共契约是否同步。合并由仓库维护者根据 CI 和审查结果决定。

## 相关文件

- [行为准则](CODE_OF_CONDUCT.md)
- [维护者指南](AGENTS.md)
- [发布策略](docs/release.md)
- [第三方许可证](THIRD_PARTY_NOTICES.md)
