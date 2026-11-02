# WorkMesh 开发落地计划

> 状态：开发模式入口。日期：2026-11-03。
> 用途：把前面确认过的设计收拢成可执行工作包；每个包独立提交、独立验证。
> 设计依据：[positioning](positioning.md)、[knowledge-architecture](knowledge-architecture.md)、[role-packages](role-packages.md)、[migration-plan](migration-plan.md)、[metrics](metrics.md)、[approval-workstation](design/approval-workstation.md)。

## 0. 已完成（可核对）

| 能力                                        | 证据                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| 定位与 README/SPEC 收敛                     | `8bef997` 之前的 docs 提交                                       |
| 需求编号统一 `KEY-001` / `KEY-001/stepImpl` | `spec/SPEC.md`、`spec/artifacts/*`                               |
| 代码仓库登记 API                            | `apps/api/src/projects/projects.controller.ts`                   |
| 自定义角色 API                              | 同上                                                             |
| 流程度量接口                                | `apps/api/src/tasks/v1-flow-metrics.*`、[metrics.md](metrics.md) |
| 六个角色包（49 资源）                       | `packages/role-packages/roles/*`                                 |
| 角色包单一来源合并                          | `fd0c8b3`                                                        |
| 审批证据卡（类型/检查/代码引用）            | `v1-workbench.service.ts`、`Workbench.tsx`                       |
| 迁移路线 M0–M5                              | [migration-plan.md](migration-plan.md)                           |

## 1. 开发原则

1. **一个工作包一个 PR**：迁移、代码、测试、文档同步，不混功能。
2. **先加后改**：新增列/表可空或带默认；删除与收紧单独一批。
3. **测试先行**：服务层用假 Prisma，HTTP 层用进程内契约；真实库单独标记。
4. **不可验证就标注**：真实 PostgreSQL、GitHub live、浏览器 E2E 无环境时记为 `unverified`，不写成通过。
5. **不破坏并行线**：动 `apps/web` 前先确认工作树干净；冲突文件优先小步改。

## 2. 工作包总览

| WP   | 内容                                         | 依赖                | 状态                            |
| ---- | -------------------------------------------- | ------------------- | ------------------------------- |
| WP0  | 基线闸门：迁移状态、备份演练、CI 漂移检查    | 无                  | 待做                            |
| WP1  | M1 知识治理字段                              | WP0                 | ✅ 已完成                       |
| WP2  | M2 验收映射 `acceptanceKeys`                 | WP1                 | ✅ 已完成                       |
| WP3  | M3 变更管理（ChangeRequest / 策略 / 冻结）   | WP2                 | ✅ 已完成（apply 受 B1 限制）   |
| WP4  | M4 单元与依赖                                | WP1                 | ✅ 已完成（apply 受 B1 限制）   |
| WP5  | M5 通用化（kind 注册、枚举字符串化）         | WP4                 | ⛔ 暂缓（B5）                   |
| WP6  | 角色包 schema 1.1（`skills[]` / `evidence`） | 无                  | ✅ 已完成                       |
| WP7  | 审批批处理（同类型、逐条校验）               | 无                  | ✅ 已完成（E2E 受 B3/B4 限制）  |
| WP8  | 委托与超时升级                               | WP3（槽位 `dueAt`） | ✅ 已完成（升级动作可手动触发） |
| WP9  | 默认模板 `software-delivery` + 角色排除变体  | WP6                 | ✅ 已完成                       |
| WP10 | 文档/度量收尾与导航                          | 全部                | ✅ 已完成                       |

## 3. 工作包明细

### WP0 基线闸门

- 记录 `prisma migrate status`、schema 校验、现有测试基线。
- 备份与恢复演练一次（隔离库）；无库时明确记录 `unverified`。
- CI 增加：`prisma validate`、`prisma migrate diff --exit-code`、契约测试。
- **验收**：CI 能在 schema 漂移时失败；基线命令与退出码有记录。

### WP1 M1 知识治理

- Schema：`KnowledgeBase.kind`；`KnowledgeDocument.scopeKind/scopeId/ownerUserId/reviewDueAt/supersededById`；`DocumentRevision.confidence/evidenceRefs`。
- 迁移 `0005_knowledge_governance`：加可空列/默认值；`product-knowledge` 回填 `BUSINESS`，其余 `SYSTEM`。
- 应用：创建知识库/文档时写入默认值；列表按 kind/scope 过滤。
- **验收**：`kind IS NULL` 计数为 0；知识库列表可按 kind 查询；`tsc` 与知识域测试通过。

### WP2 M2 验收映射

- Schema：`Task.acceptanceKeys String[] @default([])`。
- 实例化 DTO 增加 `stepBindings[].acceptanceKeys`；服务端校验全覆盖，未覆盖返回 `UNCOVERED_ACCEPTANCE`。
- 影响分析先用 key 命中任务（变更影响分析的前置）。
- **验收**：新建实例 100% 有覆盖；未覆盖时建实例被拒；测试覆盖「部分覆盖」与「零覆盖」。

### WP3 M3 变更管理

- Schema：`ChangeRequest`、`ProjectChangePolicy`、`ReviewKind.CHANGE_APPROVAL`、`ChangeRecipient.action/dueAt/escalatedAt`、`Requirement.frozenAt`。
- 服务：创建变更单 → 影响预览 → 分级审批（L0–L3）→ 生成 ChangeEvent 与收件人 → 失效动作。
- 冻结：发布候选置 `frozenAt`，冻结后普通变更默认 `DEFERRED`。
- **验收**：L0/L1 单审、L2 双审、L3 owner；只失效被改验收；未 ack 可升级。

### WP4 M4 单元与依赖

- Schema：`Unit`、`UnitDependency`、`Task.unitId`。
- 服务：单元登记、依赖登记（DECLARED 优先）、任务绑定单元、变更沿反向边找影响。
- **验收**：易番番四仓映射到 Unit；按 Unit 过滤任务；反向边能定位受影响任务。

### WP5 M5 通用化

- 文档 kind 与评审类型从枚举改为模板注册字符串；收紧 `ownerUserId`、`scopeKind` 白名单、`unitId` 外键。
- **这是唯一破坏性批次**：单独发布，先切读写再删旧。
- **验收**：新模板不依赖枚举；旧数据抽样校验；备份可恢复。

### WP6 角色包 schema 1.1

- `packages/shared` 增加 `skills[]`、`outputs[].evidence`、`license`、`description`；`packageSchemaVersion` 接受 1.1。
- 构建脚本默认输出 1.1；seeder 与 CLI 同时接受 1.0/1.1（过渡期）。
- **验收**：六个内置包以 1.1 构建并播种；CLI 安装成功；旧 1.0 包仍可读。

### WP7 审批批处理

- API：`POST /review-requests/batch-decisions`，同项目同类型，逐条 `expectedVersion` 与票据，逐条返回结果。
- 规则：高风险（`checks.failed > 0` 或 `criticality=HIGH`）禁止批量。
- UI：工作台多选 + 批量确认对话框 + 逐条结果展示。
- **验收**：部分成功可解释；冲突条目不影响已成功条目；审计完整。

### WP8 委托与超时升级

- Schema：`ApprovalSlot.dueAt`、`ApprovalSlotDelegation`（delegator、delegate、expiresAt）。
- 规则：槽位级临时委托；到期提醒 → 角色负责人 → 项目 owner；只升级不自动批准。
- **验收**：委托到期失效；升级链路可观测；审计保留原责任人。

### WP9 默认模板

- `software-delivery`：PRD → 契约/用例 → 前后端并行 → 合流 → 发布。
- 变体：`software-delivery-no-ui`（roleExclusions + stepRemovals）。
- **验收**：新项目可用模板发布；用到的角色都有内置包。

### WP10 收尾

- 文档导航：README、docs 索引、API 文档同步。
- 度量：工位补充「审批时长」「批量占比」。
- **验收**：新成员按 README 能在 30 分钟内跑通「建项目 → 发布流程 → 人工决定」。

## 4. 阻塞项

| 项          | 原因                   | 解除条件              |
| ----------- | ---------------------- | --------------------- |
| 迁移 apply  | 无真实 PostgreSQL 授权 | 提供隔离库连接与备份  |
| GitHub live | 无测试仓库与凭据       | 提供只读测试仓        |
| 浏览器 E2E  | 无隔离 API+DB          | 与迁移 apply 一并解除 |

## 5. 每包验证命令

```bash
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run            # 在对应包目录
node node_modules/prettier/bin/prettier.cjs --check <改动文件>
```

## 6. 执行顺序

```
WP0 → WP1 → WP2 → WP3 → WP8
        └──→ WP4 → WP5 → WP9
WP6、WP7 可与 WP1–WP3 并行
WP10 最后
```
