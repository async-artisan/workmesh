# 前端（FRONTEND）工作流

角色值：`FRONTEND`。签字方式：**PR review 证明**（PR 已合并 + APPROVED + 与需求有追溯）。

**触发**：`DESIGN_READY`（有设计依赖）或 `PRD_READY`（纯逻辑改动），且任务无阻塞。

## 流程

| 阶段        | 动作                           | 产出                       |
| ----------- | ------------------------------ | -------------------------- |
| F1 取上下文 | `ready` + `context`            | —                          |
| F2 方案     | 改动范围、受影响组件、接口依赖 | 实现方案（写在 `impl.md`） |
| F3 编码     | 分支 / commit 带需求与任务编号 | 代码                       |
| F4 自测     | 按验收标准逐条自验             | 自测记录                   |
| F5 回交     | `deliver` + 提交 PR            | `impl.md` + PR             |
| F6 评审     | 等 PR review                   | 签字（PR 隐式）            |

## DoD 自检

- [ ] 每条验收标准都有对应实现或明确的未完成说明
- [ ] commit / PR 含 `YFF-REQ-123-T01` 形式编号
- [ ] 受影响组件与接口已在 `impl.md` 列出
- [ ] 遗留项与已知限制已写明（不隐藏）

## 命令

```bash
workmesh ready --role FRONTEND --json
workmesh context YFF-REQ-123 --json
workmesh deliver --task <taskId> --kind IMPL --file impl.md --uri src/YFF-REQ-123/impl.md
workmesh sign <taskId> --pr 42        # 由人执行，PR 必须已合并且有 APPROVED review
```

## 交接与协同

- PR review 通过 → 任务 `DONE` → 关联任务全部完成后需求 `CODE_LINKED`；
- 实现与 PRD 冲突时发 `NEEDS_CLARIFY`，**不得自行变更验收标准**；
- 签字证据没有手工填报入口：伪造 PR 编号、未合并、未 APPROVED、与需求无追溯都会被拒。
