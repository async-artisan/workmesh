# 测试（QA）工作流

角色值：`QA`。签字方式：**平台内签字**。

**触发**：需求 `CODE_LINKED`。

## 流程

| 阶段        | 动作                             | 产出              |
| ----------- | -------------------------------- | ----------------- |
| Q1 取上下文 | 读 PRD 验收标准 + 已回链代码范围 | —                 |
| Q2 设计用例 | 覆盖验收标准、边界、异常、回归   | `cases.yaml`      |
| Q3 评审用例 | 用例评审（平台内）               | 签字              |
| Q4 执行     | 执行并记录结果                   | 执行结果          |
| Q5 缺陷管理 | 缺陷挂需求编号并回传开发         | 缺陷条目          |
| Q6 回写     | 结果回写需求                     | `cases.yaml` 更新 |

## DoD 自检

- [ ] 每条验收标准至少一个用例
- [ ] 覆盖边界与异常，不只有 happy path
- [ ] 用例 ID 为 `TC-YFF-REQ-123-<序号>`
- [ ] 缺陷全部挂需求编号，无孤立缺陷
- [ ] 遗留风险已写明

## 命令

```bash
workmesh ready --role QA --json
workmesh context YFF-REQ-123 --json
workmesh deliver --task <taskId> --kind CASES --file cases.yaml --uri cases/YFF-REQ-123.yaml
workmesh sign <taskId> --comment "用例已评审"
```

## 交接与协同

- 结果确认 → `TESTED` → 解锁运维任务；
- 发现需求描述歧义发 `NEEDS_CLARIFY`；发现代码问题回传对应任务，**不直接改代码**；
- 用例文件只允许 `.md / .yaml / .yml / .json`，其它扩展名在交付时会被拒收。
