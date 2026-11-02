---
name: attach-evidence
description: 收集提交级证据与检查结果，组成可复核的交付工件集；当实现完成、准备交付时使用。
license: MIT
metadata:
  roleKey: backend
  packageVersion: 0.1.0
---

# 附着证据

## 何时用

- 实现完成，准备交付。
- 需要补交上一轮缺失的证据。

## 步骤

1. 列证据：提交 SHA、测试结果、lint、类型检查、迁移验证。
2. 写 `checks[]`：每项 `code`、`passed`、`message`。
3. 核对覆盖：每条被本任务覆盖的验收，是否都有对应证据。
4. 交付：HOSTED 传字节，GIT_REF 给仓库定位、提交 SHA 与路径。
5. 失败项写明原因与影响，不隐藏。

## 规则

- **只交可校验的证据**：能复跑的测试、能定位的提交。
- **不伪造通过**：没跑的检查标 `passed: false` 并写原因，比编一个通过强。
- **旧基线拒绝**：交付必须绑定本次任务的快照；换基线要重新取快照。
- **证据与验收对齐**：`INSPECTION` 类证据要给人看（截图、链接），`TEST` 类给可复跑的结果。

## checks 示例

```json
[
  { "code": "type-check", "passed": true },
  { "code": "unit-test", "passed": true, "message": "128 passed" },
  { "code": "migration-rollback", "passed": true },
  { "code": "perf-p95", "passed": false, "message": "P95 1.2s，超过 800ms 阈值" }
]
```

## 交接

交付 `ArtifactSet`，进入 `REVIEW_PENDING`；批准、返修、撤销都由人在 Web 作出，Agent 不自行关门。
