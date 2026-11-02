# 流程度量

> 状态：已实现（`GET /api/v1/projects/:projectId/metrics/flow`）。日期：2026-11-03。
> 原则：只从既有时间戳派生，不新增事件表、不改业务状态。

## 1. 为什么先做这四个

「开发快、两头慢」的假设必须被度量证伪或证实。四个时长分别对应链条的两端：

| 指标                 | 回答                     | 对应痛点           |
| -------------------- | ------------------------ | ------------------ |
| `toFirstClaim`       | 需求提出到有人认领要多久 | 等上下文、等排期   |
| `claimToDelivery`    | 认领到交付要多久         | 中间生产（应最快） |
| `deliveryToApproval` | 交付到人批准要多久       | 等评审、等人拍板   |
| `leadTime`           | 提出到批准总共多久       | 端到端             |

配套两个健康度指标：

- `wip`：未完成任务数（`OPEN` / `IN_PROGRESS` / `REVIEW_PENDING`），用于判断是否在制品堆积。
- `changes`：窗口内变更事件数、收件人数、确认率与平均确认时长。

## 2. 数据来源

| 指标     | 来源                          | 时间戳                  |
| -------- | ----------------------------- | ----------------------- |
| 需求创建 | `Requirement`                 | `createdAt`             |
| 首次认领 | `TaskClaim`                   | `claimedAt`             |
| 首次交付 | `ArtifactSet`                 | `createdAt`             |
| 批准     | `ReviewDecision`（`APPROVE`） | `createdAt`             |
| WIP      | `Task.executionStatus`        | 当前值                  |
| 变更确认 | `ChangeRecipient`             | `createdAt` / `ackedAt` |

## 3. 计算口径

```
需求集合 = 窗口内创建的需求
首次认领 = 该需求所有任务的最早 claimedAt
首次交付 = 该需求所有任务的最早 artifactSet.createdAt
批准     = 该需求所有 APPROVE 决定的最晚 createdAt
```

- `toFirstClaim` = 首次认领 − 需求创建
- `claimToDelivery` = 首次交付 − 首次认领
- `deliveryToApproval` = 批准 − 首次交付
- `leadTime` = 批准 − 需求创建

缺失前置条件的需求不进入对应样本（例如未认领的需求不参与 `claimToDelivery`），样本数在 `samples` 中返回。

## 4. 接口

```
GET /api/v1/projects/:projectId/metrics/flow?days=30
```

- `days`：1–365，默认 30；非法返回 `422 DAYS_INVALID`。
- 需要 `task:read` scope 与项目成员资格。

```json
{
  "window": { "from": "2026-10-04T00:00:00.000Z", "to": "2026-11-03T00:00:00.000Z", "days": 30 },
  "requirements": { "created": 12, "claimed": 9, "delivered": 7, "approved": 5 },
  "durationsHours": {
    "toFirstClaim": { "samples": 9, "p50": 18.5, "p90": 60 },
    "claimToDelivery": { "samples": 7, "p50": 12, "p90": 40 },
    "deliveryToApproval": { "samples": 5, "p50": 26, "p90": 72 },
    "leadTime": { "samples": 5, "p50": 64, "p90": 140 }
  },
  "wip": { "OPEN": 4, "IN_PROGRESS": 2, "REVIEW_PENDING": 3 },
  "changes": { "events": 3, "recipients": 8, "acked": 6, "ackRate": 0.75, "avgAckHours": 5.5 }
}
```

## 5. 目标怎么定

不预设绝对目标，先建立基线，再按「瓶颈在哪」定改进方向：

| 现象                    | 判断                  | 动作                      |
| ----------------------- | --------------------- | ------------------------- |
| `toFirstClaim` 高       | 前端堵（上下文/排期） | 看 `ready` 队列与认领延迟 |
| `deliveryToApproval` 高 | 后端堵（评审/拍板）   | 看批处理、委托、超时升级  |
| `claimToDelivery` 高    | 中间慢（与假设相反）  | 先查上下文是否缺失        |
| `wip` 持续上涨          | 在制品堆积            | 限制认领，先清评审        |
| `ackRate` 低            | 变更通知失效          | 查收件人解析与升级策略    |

对外可以引用 DORA 四项指标做校准，但 WorkMesh 当前先看自己的两端时长。

## 6. 已知限制

1. **没有任务状态变更时间戳**：`Task` 只有当前状态，无法算「在某个状态停留多久」。要精确到状态级，需补状态变更事件表。
2. **批准 = `APPROVE` 决定**：多审批槽时取最晚一次，近似「全部通过」；撤销后的重批会推后时间，符合直觉。
3. **无实例的需求不计入时长**：只创建未实例化的需求会出现在 `created`，但不产生时长样本。
4. **WIP 是全项目当前值**：不受 `days` 窗口限制，用于看当下堆积。
5. **窗口边界**：跨窗口边界的需求可能只被计入一次，趋势分析建议按周对齐。

## 7. 与成熟实践的关系

- 两端时长与在制品的关系遵循 Little's Law；瓶颈判断参考 TOC。
- 四项交付指标可对齐 DORA；来源与边界见 [references.md](references.md)。
