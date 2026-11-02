# 后端（BACKEND）工作流

角色值：`BACKEND`。签字方式：**PR review 证明**（PR 已合并 + APPROVED + 与需求有追溯）。

**触发**：同前端；通常无设计依赖，可更早开始。

## 流程

| 阶段        | 动作                               | 产出            |
| ----------- | ---------------------------------- | --------------- |
| B1 取上下文 | `ready` + `context`                | —               |
| B2 方案     | 接口设计、数据模型变更、兼容性影响 | 实现方案        |
| B3 编码     | 分支 / commit 带编号               | 代码            |
| B4 自测     | 接口自测 + 边界用例                | 自测记录        |
| B5 回交     | `deliver` + PR                     | `impl.md` + PR  |
| B6 评审     | 等 PR review                       | 签字（PR 隐式） |

## DoD 自检

- [ ] 接口契约明确（入参、出参、错误码）
- [ ] 数据变更有迁移方案且可回滚
- [ ] 向后兼容性影响已评估
- [ ] 性能与权限约束已考虑并写明
- [ ] commit / PR 含编号

## 命令

```bash
workmesh ready --role BACKEND --json
workmesh context YFF-REQ-123 --json
workmesh deliver --task <taskId> --kind IMPL --file impl.md --uri server/YFF-REQ-123/impl.md
workmesh sign <taskId> --pr 42        # 由人执行
```

## 交接与协同

- PR review 通过 → 任务 `DONE` → 关联任务全部完成后需求 `CODE_LINKED`；
- 实现与 PRD 冲突时发 `NEEDS_CLARIFY`，不自行变更验收标准；
- 交付只上传指针与自检结果，代码正文不上平台。
