# 首次价值时间（TTFV）记录

> 更新时间：2026-11-12

## 定义

TTFV（Time To First Value）= 从零开始到第一条需求被人工签字完成的时间。

定位文档 §9 定义目标为 **TTFV ≤ 30 分钟**（从 clone 到第一条需求被人工签字）。

## 当前可用入口

### 1. `scripts/first-run-demo.mjs`（自包含）

**自包含性**：✅ 完全自包含。PRD、Understanding、Knowledge 正文均内嵌在 `scripts/lib/first-run-workflow.mjs` 中，无外部文件依赖。

**覆盖**：注册账号 → 创建项目 → 发布 workflow + PRD/Understanding → 认领 QA 任务 → 交付 → 人工批准 → 验证持久化。

**未覆盖**：IMPL 和 RELEASE 任务保持 OPEN/WAITING，不构成完整交付闭环。

**运行**：

```bash
pnpm --filter @workmesh/shared build
node scripts/first-run-demo.mjs
```

### 2. `scripts/sim-external-team.mjs`（自包含，新增）

**自包含性**：✅ 完全自包含。三角色（owner + dev + qa）完整闭环。

**覆盖**：注册 → 创建项目 → 邀请成员 → 接受邀请 → IMPL 交付 → 返修 → 重新交付 → 批准 → CASES 交付 → 批准 → RELEASE 交付 → 批准 → 最终验证。

**输出**：每步耗时 + 操作 ID + 时间线摘要，写入 `.tmp/sim-external-<timestamp>/result.json`。

**运行**：

```bash
pnpm --filter @workmesh/shared build
node scripts/sim-external-team.mjs
```

详见 [外部团队模拟脚本使用指南](sim-external-team-guide.md)。

## G2「演示自包含」状态

| 脚本                            | 依赖 `.tmp/` 外部文件   | 状态                                  |
| ------------------------------- | ----------------------- | ------------------------------------- |
| `scripts/first-run-demo.mjs`    | ❌ 不依赖               | ✅ 已自包含                           |
| `scripts/sim-external-team.mjs` | ❌ 不依赖               | ✅ 已自包含（2026-11-12 新增）        |
| `scripts/seed-yff.mjs`          | ✅ 依赖 `.tmp/yff-req/` | ⬜ 仍依赖外部目录（YFF 业务演示数据） |

`seed-yff.mjs` 的外部依赖来自业务项目「易番番」的真实需求正文，不是仓库自带资源。该脚本面向特定业务演示场景，新用户首次试用建议使用 `first-run-demo.mjs` 或 `sim-external-team.mjs`。

## 待实测项

- [ ] 在干净新机器（全新 checkout + 全新 PostgreSQL）实测 TTFV，记录时间线
- [ ] 目标：从 `git clone` 到 `sim-external-team.mjs` 完成所有三任务批准 ≤ 30 分钟
- [ ] 实测时记录：安装时间、迁移时间、脚本运行时间、人工签字时间

## 历史

- 2026-11-12：新增 `sim-external-team.mjs`，覆盖完整三角色闭环，自包含
- 2026-11-04：`first-run-demo.mjs` 已自包含，PRD/Understanding 正文内嵌
