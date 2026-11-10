# CLI 任务执行状态与恢复

认领后 CLI 把精确的认领、任务版本和代次写入本机安全操作收据。`executionId` 等于首次认领的操作编号；后续命令可以沿用这个编号，CLI 从原始收据自动携带 `claimId`、`snapshotId` 和准确版本。

```bash
workmesh claim --task "<taskId>" --json
workmesh context --execution "<executionId>" --materialize
workmesh deliver --execution "<executionId>" --manifest deliver.json
workmesh review --execution "<executionId>"
```

`deliver` 已创建人工评审，最后一条命令读取已有评审状态和入口。人工批准仍在 Web 完成。

也可在 `context`、`deliver`、`review` 中使用 `--task "<taskId>"`，省略认领、快照与版本参数。该任务必须在当前凭据范围内只有一个本地执行；存在多次执行历史时显式提供 `--execution`，CLI 不自动选择最新历史。

```bash
workmesh execution list --task "<taskId>" --json
workmesh execution status --execution "<executionId>" --json
```

状态从 `.workmesh/local/receipts` 重新派生，重启 CLI 不会丢失已确认的执行位置，也不另维护一份可覆盖的“最新基线”。它绑定平台 origin、API 路径、项目、角色和具体凭据；变更其中任何一项不会借用另一范围的状态。本机同一范围内同一任务的命令由执行锁串行处理，服务端继续检查权限、认领、代次和版本。状态查询只反映本机记录，远端可能已释放认领、调整基线或要求返修。

## 未知结果与原操作恢复

写入前先记录 `PENDING`。超时、断线或本地成功记录更新失败时，命令输出原操作编号和核对命令；执行仍处于待核对状态。此时新操作被阻止，以免把未知提交误当失败后重复交付。

```bash
workmesh receipt reconcile --operation "<operationId>" --dir "<原工作目录>" --config-home "<原配置目录>"
workmesh execution status --execution "<executionId>"
```

核对确认服务端已提交后，原收据的结果引用推动执行状态。未取得可访问的已提交收据时仍保留未知结果。需要重发时使用原 `--operation`，请求摘要和执行关联必须一致；修改 manifest、候选、版本或凭据后不能复用原编号。

平台认领和交付响应中的 `committedState` 是该操作提交时的精确任务版本与代次；响应的 `task` 仍可能是当前读模型。旧操作未保存精确版本时 `committedState` 为 `null`，CLI 显示 `NEEDS_INSPECTION` 并要求核对，不能把当前任务版本当作原提交结果。

## 输入变化与显式恢复

已有快照的执行重新获取上下文时会先比较输入。变化后先运行 `context --task "<taskId>" --inspect` 核对，再显式使用 `context --execution "<executionId>" --refresh` 请求新快照。`--refresh` 仍使用执行已知的精确任务版本；远端版本已变化时请求会被拒绝，不自动接受新版本。

需要采用人工核对后的新任务版本时，继续使用原有精确参数入口：`context --task ... --claim ... --expected-version ...`，然后按返回的新版本与快照显式交付。这些显式参数不会悄悄修改旧执行的基线。返修、旧认领释放或代次变化后应按平台当前工作流重新认领。

诊断字段、命令退出码和本机状态不构成验收或正式批准；本机 Git 检查、Agent 自报与平台接受的证据继续分别保留来源。
