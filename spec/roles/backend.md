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
# 1) 领取任务（待办任务 UUID 由平台/看板给出；CLI 没有 ready 子命令）
workmesh claim --task <taskId>

# 2) 物化上下文：角色包资源、已发布基线与上游已验收工件都在里面
workmesh context --task <taskId> --claim <claimId> --expected-version <taskVersion> --materialize

# 3) 产出后按 manifest 交付；IMPL 是 backend 的产物类型
workmesh deliver --task <taskId> --claim <claimId> --snapshot <snapshotId> \
  --expected-version <taskVersion> --manifest deliver-manifest.json

# 4) 请求人工验收
workmesh review --artifact-set <artifactSetId> --expected-version <artifactSetVersion>
```

签字只发生在 Web 评审页（HUMAN 会话 + 一次性票据）。Agent 侧没有签字命令：
`ready` / `sign` / `sync` 均已从 CLI 移除，不要按旧文档执行。

## 交接与协同

- PR review 通过 → 任务 `DONE` → 关联任务全部完成后需求 `CODE_LINKED`；
- 实现与 PRD 冲突时发 `NEEDS_CLARIFY`，不自行变更验收标准；
- 交付只上传指针与自检结果，代码正文不上平台。
