# CLI 契约

适用于 cursor-use `0.2.x`。实现与参数由 [src/cli.ts](../../src/cli.ts) 和 `--help` 提供，业务行为由[产品范围](../product/scope.md)与[领域模型](../ssot/domain-model.md)约束。此处只描述已经实现的命令；真实验收见[0.2 证据](../evidence/2026-09-19-cloud-v02.md)。

## 调用与输出

构建后通过 `bun dist/main.js` 执行，本地 `bun link` 后可用 `cursor-use`。业务输出始终是 JSON，`--json` 是可选兼容标志。帮助与版本保持文本。

成功写 stdout，退出码 0。错误写 stderr，退出码 1。根据 `error.code` 判断恢复动作，不解析人类消息文本。成功 envelope 为 `{ok:true,data:...}`，错误为 `{ok:false,error:{code,message,status?,uncertain?,providerCode?,retryAfterSeconds?,providerRequestId?,nextStep?,details?}}`。`providerCode`、`retryAfterSeconds` 和 `providerRequestId` 是提供方机器错误码、建议等待秒数和 HTTP 追踪标识，不是本地 request ID。`nextStep` 是稳定的机器后续动作，例如忙碌续派的 `wait-then-new-request-id`。

普通命令只输出一个 JSON 结果，不混入日志。`runs wait` 到终态或本地超时后返回；`runs stream` 是下文单独定义的 JSONL 事件通道。查询成功不代表任务成功，尤其要检查 result 查询里的 executionSucceeded、taskAccepted 和 emptyResult。

## 已实现命令

| 命令 | 主要参数 | 行为 |
| --- | --- | --- |
| capabilities | 无 | 离线报告本版本的实现与缺口 |
| doctor | 无 | 只读核验 API Key 身份、运行时与能力 |
| models / repos | 无 | 读取账号模型或可访问 GitHub 仓库 |
| agents list | --limit, --cursor, --all, --max-pages, --exclude-archived, --pr-url | 有界分页和提供方过滤 |
| agents show | --agent-id | 读取 Agent，包含服务端返回的环境和查看入口 |
| agents result | --agent-id, 可选 --run-id | 汇总 Agent、Run、usage 和 Agent 级产物；`emptyResult` 在 result 文本为 null 或空白时为 true；任一查询失败都不伪造完整结果 |
| agents launch | 目标、prompt、--request-id | 保存回执后创建付费 Agent 和首个 Run |
| agents follow-up | --agent-id、prompt、--request-id，可选 --wait | 在原 Agent 创建付费 Run。忙碌时从不排队；`--wait` 等到空闲后再 POST 一次 |
| agents reconcile | --request-id | 回查创建结果，不再次派发 |
| runs list | --agent-id, --limit, --cursor, --all, --max-pages | 有界 Run 分页 |
| runs show | --agent-id, --run-id | 读取指定 Run |
| runs wait | --agent-id, --run-id, --timeout, --interval | 轮询指定 Run，超时不取消云端任务 |
| runs cancel | --agent-id, --run-id | 请求取消，不自动创建替代 Run |
| runs stream | --agent-id, --run-id, --after-event, --timeout, --reconnects | 消费 SSE，输出 JSONL，断线有限重连 |
| receipts list / show | show 使用 --request-id | 查询本地回执，不需要 Key |
| receipts bind-run | --request-id, --run-id, --confirm | 人工确认未知提交的 Run 归属；只修改本地回执 |
| envs add | --name | 本地登记准确名称，不修改云端 |
| envs list | --observed, --limit, --all, --max-pages | 本地名称及可选有界历史观察；观察项可带 last-seen `repos[]`，始终非全量环境目录 |
| envs show | --name，可选 --observed | 单个命名环境。公开 v1 没有 snapshot catalog；`--observed` 列出匹配 Agent 上看到的 `repos[]` |
| usage | --agent-id, 可选 --run-id | 查询服务端提供的用量及费用信息 |
| artifacts list / url | --agent-id，url 另需 --path | 列出 Agent 产物或获取临时下载 URL |
| artifacts download | --agent-id, --path, --output, --sha256, --max-bytes, --timeout | 下载到新文件，计算并可核对 SHA-256，不覆盖已有文件 |
| projects list | 无 | 明确返回 UNSUPPORTED，不返回伪造空列表 |

## 创建与续派输入

Prompt 必须从 `--prompt` 与 `--prompt-file` 二选一，非空且不超过 512 KiB。文件必须是常规文件，不接受目录或命名管道；不自动读取当前仓库上下文。

创建目标从 `--env`、`--repo`、`--repos-file` 和 `--scratch` 四选一。repo 限定 GitHub HTTPS URL，不接受用户信息、自定义端口、查询或 fragment。`--ref` 只对单个 --repo 有效，可传明确分支或 SHA，不假设 main；命名环境不与 repo/ref 组合。空字符串不是合法目标，也不会静默回退。prompt 中的 clone URL 不能替换 named environment 的 snapshot 仓库。launch / `agents show` 返回的 `repos` 才是云端实际使用的 git。

`--model` 显式值优先于用户配置。没有 `--model` 时，如果存在 `~/.cursor-use/config.json` 的 `model.id`，CLI 使用该值；两者都没有时才把模型选择交给 Cursor 服务端。`--model-params-file` 显式值优先于配置参数；显式指定另一个 model 时不会继承原配置的 params。

### 用户级配置

CLI 可读取 `~/.cursor-use/config.json`。文件不存在时保持现有默认行为。文件必须是 64 KiB 以内的普通 JSON 文件，顶层字段必须符合 `version: 1`；损坏、超限或多余字段会在派发前返回 `INVALID_CONFIG`，不会静默忽略。

当前支持模型默认值和等待默认值：

```json
{
  "version": 1,
  "model": {
    "id": "example-model",
    "params": [
      { "id": "effort", "value": "xhigh" },
      { "id": "fast", "value": "false" }
    ]
  },
  "wait": {
    "timeoutSeconds": 900,
    "intervalSeconds": 5
  },
  "stream": {
    "timeoutSeconds": 900,
    "reconnects": 3
  }
}
```

配置只保存本地偏好，不保存 `CURSOR_API_KEY`、环境、仓库、request ID 或 SQLite 状态目录。命令行优先于配置，配置优先于内置默认值。配置模型的参数只跟随配置模型；命令行切换模型时必须自行提供适用参数，避免把一个模型的参数错误套到另一个模型。`--dry-run` 会读取并校验配置，但仍不读 Key、不访问远端、不创建回执。

示例中的模型值只是格式示例，实际模型和参数必须先通过当前账号的 `models` 目录确认。

可选 `--mode` 为 agent 或 plan，`--name` 长度 1-100，`--auto-pr` 显式允许自动 PR。默认 `autoCreatePR=false`、`workOnCurrentBranch=false`，后者不代表提供方绝不会向新分支推送提交。

`agents follow-up --wait` 使用与 `runs wait` 相同的超时/间隔默认值（配置或 600/5），先等到最新 Run 离开 `CREATING`/`RUNNING`，再 POST 一次。忙碌续派从不排队。未加 `--wait` 时，若最新 Run 仍在执行，CLI 在 POST 前返回 `409`/`providerCode=agent_busy`，`details.followUpQueued=false`，`nextStep=wait-then-new-request-id`，`activeRunId` 与 `activeRunStatus` 指向现有 Run；此时尚未消耗 request ID。若 POST 已发出并被拒绝，回执为 `rejected`，必须换新 request ID，不得用同一 ID 静默重试。

两个 JSON 输入文件最多 64 KiB，拒绝未声明字段。repos-file 为 1-20 个仓库，顺序决定主仓库，不能重复：

```json
[
  { "url": "https://github.com/example/one", "startingRef": "release" },
  { "url": "https://github.com/example/two" }
]
```

model-params-file 是最多 30 个唯一参数的数组，value 必须是目录返回的字符串，不把 true 布尔值当作 "true" 字符串。有效模型可以来自 `--model` 或 config.json：

```json
[{ "id": "fast", "value": "false" }]
```

`--dry-run` 只做本地校验，输出规范化选项、prompt 字节数和哈希，不输出正文，不读 Key、不访问远端，也不创建回执。remoteValidated=false 表示环境、仓库访问和模型目录尚未远端验证。针对 `--env` 的 dry-run 带有 `git`：`reposProvenance=unavailable`、`promptDoesNotReplaceSnapshotRepos=true`，并指出应使用 `envs show --observed` 与 launch/`agents show` 的 `repos`。

没有开放 envVars：提供方 beta 可能静默忽略它，且与 client agentId 互斥。也未开放任意 MCP 配置、环境管理或永久删除接口。

`--request-id` 为 1 至 128 个简单标识字符。建议调用方在提交前固定它。省略时 CLI 生成 ID 并写入本地回执，不应在响应丢失后另生成新 ID 重试。

成功的 launch 通常返回 agent、run 和 receipt。相同 request ID 已成功提交时返回 receipt 与 `replayed:true`，不重新发送 POST。调用方以 receipt 中的 Agent/Run ID 为稳定追踪入口，不要求所有成功结果都重复完整提供方对象。

创建响应会核对预期 Agent ID、cloud 环境、仓库顺序与显式 ref，或无仓库目标。回查也沿用这些条件。提交后无法确认目标时保留未知结果和返回标识，不静默改投。

## 回执与恢复

SQLite 保存 request ID、账号、操作类型、请求摘要哈希、Agent/Run ID、状态和时间，不保存 Key 或 prompt 正文。通过事务把 prepared 改为 dispatching，只有取得本地提交权的进程能发 POST。

状态为 prepared、dispatching、submitted、unknown 或 rejected。dispatching 中断后可能已经远端执行，不能当作失败重发。相同 request ID 不允许更换账号或任务内容。

去重范围是同一状态库。不同机器或不同 CURSOR_USE_STATE_DIR 不共享提交权，不得通过换目录或换机器重试未知结果。CLI 没有宣称提供方的重复 POST 本身具有幂等性。

JSON GET 的 5xx 最多自动重试两次；429 仅在服务端明确给出不超过 5 秒的 Retry-After 时有限重试。其他限流直接返回等待提示。POST 不自动重试；HTTP 408、5xx 和 agent_id_conflict 也不能当作确定未创建。创建前生成 client agentId，恢复时查询该 ID。

receipt.runAttribution 持续保留 Run 来源：confirmed 是创建/续派响应确认，latest-observed 只是回查时看到的最新 Run，operator-selected 是人工指定。旧回执缺失该字段时不补造证明。晚到的超时或较弱观察不能覆盖已提交回执；较晚的确切响应可以纠正此前的观察归属。

bind-run 必须有 --confirm，只用于 unknown/dispatching 或 latest-observed 回执；会验证当前账号、Agent/Run 配对，并拒绝把 baselineRunId 当成未知续派的新 Run。它不证明服务端幂等，也不发送云任务。

`RECEIPT_UPDATE_FAILED` 表示服务端已接受，但本地更新失败；错误保留远端 IDs。原生 provider 的 git 分支快照属于 Agent，不是可靠的单 Run 归因。

完整异常操作步骤见[请求恢复](../runbook/request-recovery.md)。

## 范围与限制

`runs wait` 默认从 `~/.cursor-use/config.json` 的 `wait.timeoutSeconds` 和 `wait.intervalSeconds` 读取，未配置时分别为 600 秒和 5 秒；最长 3600 秒，间隔默认限制在实现允许范围内。`runs stream` 同理读取 `stream.timeoutSeconds` 和 `stream.reconnects`，未配置时分别为 600 秒和 3 次。命令行显式参数优先。

Agent/Run 单页 limit 默认 20、范围 1-100。--all 才会自动翻页，max-pages 默认 10、范围 1-100；触及上限返回 truncated=true、nextCursor 和 complete=false。重复 cursor 是协议错误，跨页相同 ID 保留首次记录。complete 仅在无起始 cursor 且读到最后一页时成立，snapshot=false 表示不是原子时间点快照。后续页失败时错误保留已读部分，不返回伪造空列表。

环境观察扫描明确选择的 Agent 页，以最多 4 个并发请求补详情，并带上该 Agent 上看到的 `repos[]`。即使读完所有 Agent，也不能证明得到所有保存环境，所以 envs 的 complete 始终为 false，`catalogAvailable` 始终为 false。原生 Projects 和全量环境配置仍未支持。

凭据仅从 `CURSOR_API_KEY` 读取。API host 固定为 api.cursor.com，拒绝重定向，没有任意 base URL 参数。仓库目录限额严格，repos 只应按需调用，不作为轮询接口。

## 事件流

runs stream 默认最长 600 秒、最多 3600 秒，断线最多重连 3 次，可用 --reconnects 设置 0-10。每个事件一行：

```json
{"ok":true,"type":"event","agentId":"bc-example","runId":"run-example","event":"assistant","id":"opaque-id","data":{"text":"delta"}}
```

成功结束后另输出普通 `{ok:true,data:...}` 汇总，包括 status、lastEventId、events、connections、historyComplete、retentionSeconds、taskAccepted。失败写 stderr 并非零退出，之前已输出的事件不会撤回。消费管道必须检查 CLI 退出码，不能只看下游工具是否成功。

- --after-event 使用不解析的 opaque ID，通过 Last-Event-ID 续读。进程内重连使用最后成功交给输出通道的 ID；跨进程由调用方保留该 ID，不使用多个消费者共享的全局游标。
- 交付不是 exactly-once；重连会再次收到无 ID 的 status。result 和 done 可能共享 ID，不能仅按 ID 丢弃事件。
- assistant/tool_call 等简化事件与 interaction_update 是重复的信息投影。应用选择其中一组消费，不重复拼接两者。
- 410 表示历史过期：输出明确的 snapshot，并查询 Run 终态；historyComplete=false，不伪造重放历史。仍在运行时报告 STREAM_EXPIRED，改用 show/wait。
- error 事件、错配 Run、错误 JSON、未知终态都明确失败。事件最多 1 MiB，单连接接收最多 64 MiB；超限不会继续无限缓冲。
- WAIT_TIMEOUT 只停止本地流消费，错误带 lastEventId，不取消云任务。输出到 OS 不等于下游已经处理，需要下游自行维护业务确认。

## 下载与结果验收

artifacts download 必须显式给 --output，父目录必须已存在。默认上限 64 MiB，可用 --max-bytes 调整至最多 512 MiB；timeout 默认 120 秒、最多 3600 秒。--sha256 可指定预期摘要。

下载只接受文档或实测确认的 cloud-agent-artifacts / agent-stores S3 HTTPS 主机及对应 S3 path-style URL，不发送 API Authorization、Cookie 或 referrer，不跟随重定向。成功返回本地绝对路径、字节数和 SHA-256，不输出临时签名 URL。

使用独占创建和 0600 权限，不覆盖已有文件或符号链接。失败可能保留未验证或部分写入的文件，并在错误 details 中给出位置和已记录字节数。不会自动删除、覆盖或盲目续写；需要重试时使用新路径，旧文件按废纸篓策略处理。

agents result 省略 --run-id 时选择 latestRunId，并标为 latest-observed；它不代表首轮。artifact 和 git 信息属于 Agent，不能冒称某个 Run 的独立产物或提交。`emptyResult` 在 `result` 为 null 或空白文本时为 true；`ok:true` 且 `FINISHED` 并不表示任务已被接受。最终业务验收仍由调用方根据要求完成。
