# 文档导航

此处是项目知识地图，不是强制阅读顺序。用户入口见 [English README](../README.md) 和 [中文 README](../README.zh-CN.md)。按正在处理的问题进入对应文档。

| 问题 | 负责的文档 | 知识角色 |
| --- | --- | --- |
| 为谁做、要解决什么、哪些行为不可接受？ | [产品范围](product/scope.md) | 已接受目标与约束 |
| Agent、Run、环境、Project 各指什么？ | [领域模型](ssot/domain-model.md) | 跨能力共享语义 |
| 为什么自建，为什么先用官方 REST？ | [决策 0001](adr/0001-own-cli-and-skill.md) | 已接受技术决策及理由 |
| 为什么采用 Bun、TypeScript 和 Effect v4 beta？ | [决策 0002](adr/0002-bun-typescript-effect.md) | 已接受技术基线 |
| Effect-first 如何执行，依赖怎样锁定？ | [Effect-first 规则](standards/effect-first.md) | 源码和版本管理规则 |
| 现在实际上有哪些实现？ | [当前结构](architecture/current-architecture.md) | 源码和配置的说明 |
| 有哪些可用命令、输入和输出？ | [CLI 契约](protocols/cli.md) | 当前实现的调用接口 |
| 中断或响应丢失后怎么找回请求？ | [请求恢复](runbook/request-recovery.md) | 运行操作步骤 |
| 外部 Agent 怎么使用？ | [cursor-use skill](../skills/cursor-use/SKILL.md) | 调用方执行指导 |
| 当前云端版本验证过什么？ | [0.2 云端验收](evidence/2026-09-19-cloud-v02.md) | SSE、产物、取消、目标与参数的运行证据 |
| 初版云任务验证过什么？ | [0.1 云端验收](evidence/2026-09-19-cloud-smoke.md) | 历史快照，不代表当前缺口 |
| 桌面探索留下了什么？ | [桌面 POC](evidence/2026-09-19-desktop-poc.md) | 历史实验，方向已停止 |
| CLI 与桌面联动查过什么？ | [CLI 升级与可见性测试](evidence/2026-09-19-cli-desktop-visibility.md) | 历史记录，互通未证实且不再推进 |
| 下一步做什么，什么条件才算完成？ | [实施路线](roadmap/implementation-plan.md) | 计划与交付状态 |
| 发布和包清单如何核验？ | [发布策略](release.md) | 版本、包内容和外部发布门禁 |
| 文档如何命名、分工和保持新鲜？ | [文档治理](standards/documentation.md) | 本项目采用的治理规则 |
| 修改后应验证什么，能声称什么？ | [验证规则](standards/verification-policy.md) | 检查要求及证据限制 |
| 候选工具的判断来自哪里？ | [2026-09-19 选型核验](research/2026-09-19-cli-landscape.md) | 有时效的调研快照 |

研究快照不决定现行产品含义。已接受的目标、技术选择、实际实现和观察证据分别由对应文档负责。

只创建有内容和独立维护需要的目录，不为布局对称创建空首页、空标准或占位功能文档。移动文件或标题时，同步修复相关入口和交叉引用。
