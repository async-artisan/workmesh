# 产品（PRODUCT）工作流

角色值：`PRODUCT`。签字方式：**平台内签字**。

## 流程

| 阶段            | 动作                           | 产出              |
| --------------- | ------------------------------ | ----------------- |
| P1 收集与澄清   | 收集诉求，标注来源与背景       | 需求条目（DRAFT） |
| P2 撰写 PRD     | 写清目标、范围、用户故事、边界 | `prd.md`          |
| P3 定义验收标准 | 每条标准可测、可判定           | PRD 验收章节      |
| P4 评审定稿     | 提交评审，通过后定稿           | 定稿版本 + 签字   |
| P5 拆解任务     | 按角色拆任务，指定依赖与验收点 | `Task` 列表       |
| P6 变更管理     | 变更必须升版本并触发传播       | `ChangeEvent`     |

## DoD 自检（缺一不交付）

- [ ] 每条验收标准可测且有明确判定方式
- [ ] 范围与边界已写清（做什么、不做什么）
- [ ] 任务已拆分，每个任务归属明确角色
- [ ] 外部依赖（设计 / 接口 / 数据）已在 PRD 中标注

## 命令

```bash
workmesh ready --role PRODUCT --json
workmesh context YFF-REQ-123 --json
workmesh deliver --task <taskId> --kind PRD --file prd.md --uri docs/prd/YFF-REQ-123.md
workmesh sign <taskId>          # 人签字，agent 不可用
```

## 交接与协同

- 定稿并签字 → `PRD_READY` → 解锁 UI 与前后端任务；
- 收到下游 `NEEDS_CLARIFY` 必须在任务上回应；若是实质修改，升 PRD 版本并触发变更传播；
- 定稿后即为权威事实，任何冲突以产品源为准。
