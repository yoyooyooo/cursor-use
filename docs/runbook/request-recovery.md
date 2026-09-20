# 找回不确定的请求

适用于网络失败、CLI 中断或本地回执写入异常。回执位置由 `CURSOR_USE_STATE_DIR` 指定，默认 `~/.local/state/cursor-use`。不要通过删除状态库来解决重复请求冲突。

## 先找回标识

```sh
cursor-use receipts list --json
cursor-use receipts show --request-id <原请求ID> --json
cursor-use doctor --json
```

核对当前账号与回执一致。Key 不同但账号相同可以继续只读核验；账号不匹配时不重放。

## 创建结果未知

```sh
cursor-use agents reconcile --request-id <原请求ID> --json
```

该操作只读取预先记录的 agentId，不再次创建。找到远端 Agent 和 latestRunId 后更新回执。最新 Run 可能是他人后续创建的一轮，检查 `runAttribution` 和 runs list，不冒称找回了原始 Run。

0.2 把 latest-observed 持续保存在回执里，后续重复调用也不会丢掉此标记。环境、仓库或 ref 无法确认时保留未知结果，不把“ID 存在”当作目标一致；旧版仓库回执缺少完整目标记录时也不补造确认。较晚返回的确切创建响应可以纠正此前的观察归属。

仍找不到时保留 OUTCOME_UNKNOWN。服务端 404 不足以证明此前的非幂等工作没有执行，不生成新 ID 盲目派发。

## 续派结果未知

```sh
cursor-use runs list --agent-id <原AgentID> --json
cursor-use runs show --agent-id <原AgentID> --run-id <候选RunID> --json
```

把记录与 receipt.baselineRunId 比较，核对时间和工作内容。此版本不能自动证明某个新增 Run 就是那次未知续派，保留不确定性并由调用方确认，不自动再次 follow-up。

核对后可显式记录人工选择：

```sh
cursor-use receipts bind-run --request-id <原请求ID> --run-id <核对后的RunID> --confirm --json
```

命令验证账号、Agent/Run 配对和非 baseline Run，只写本地回执并标记 operator-selected。没有 --confirm 会拒绝；不能改写已确认回执，也不会发送云任务。

## 流中断与下载失败

流中断时保留错误 details.lastEventId，后续用 `runs stream --after-event <ID>` 续读。只在当前消费者确认交付后保存游标，不让多个独立消费者共享一个游标。410 会读回 Run 终态但不恢复过期历史；仍在运行时用 show/wait。

下载失败先检查 details.output、bytesWritten 和 partialFileRetained。不能把存在的文件当作完整产物。重试选择新输出路径并核对 SHA-256；旧文件需要清理时移至系统废纸篓。403 可能是临时 URL 过期，重新通过 artifacts download 获取新 URL，不直接修改签名查询参数。

## 明确拒绝或等待超时

- rejected 表示收到明确拒绝。解决输入、权限或忙碌原因后，新的逻辑尝试使用新的 request ID。不要反复修改同一个请求的含义。
- REQUEST_CONFLICT 表示同一 ID 的账号或任务内容不同。先检查旧回执，不覆盖它。
- WAIT_TIMEOUT 只停止本地等待。继续调用 runs show 或 wait，不默认 cancel。
- RECEIPT_UPDATE_FAILED 的错误带有远端 Agent/Run ID。先保存这些 ID，再排查磁盘和权限，不重新提交。

## 本地状态异常

目录应仅由当前用户写入，数据库文件权限为 0600。不要在 Agent 仍可能操作该库时迁移或修改 SQLite 文件。若需要备份或迁移，先停止本地写入并同时考虑 WAL 数据；不能只复制主库文件就认定备份完整。

程序会有限重试 SQLite busy 错误，不重试任意存储错误。CLI 是否退出与云端任务是否仍运行无关。任何人工清理都遵循项目的禁止永久删除策略。

返回[CLI 契约](../protocols/cli.md)。
