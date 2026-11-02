# 模型迁移路线

> 状态：计划，未执行。日期：2026-11-03。
> 目标：把已定的模型改动拆成可独立发布、可回滚的分批，遵循 expand → migrate → contract。
> 原则：**先加后改、先写后读、最后删除**；任何一批都不在同一发布里做破坏性变更。

## 1. 待迁移的改动清单

| #   | 改动                                                                                                                                               | 来源                          | 依赖              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------- |
| A   | 知识治理字段：`KnowledgeBase.kind`、文档 `scopeKind/scopeId/owner/reviewDue/supersededBy`、修订 `confidence/evidence`                              | knowledge-architecture §6/§10 | 无                |
| B   | 验收映射：`Task.acceptanceKeys`、实例化 DTO 的 `acceptanceKeys`、`UNCOVERED_ACCEPTANCE`                                                            | §14.1 / §15                   | 无                |
| C   | 变更管理：`ChangeRequest`、`ProjectChangePolicy`、`ReviewKind.CHANGE_APPROVAL`、`ChangeRecipient.action/dueAt/escalatedAt`、`Requirement.frozenAt` | §7/§8/§14                     | B（影响分析精度） |
| D   | 单元与依赖：`Unit`、`UnitDependency`、`Task.unitId`、文档 `scopeId` 指向 Unit                                                                      | 通用性讨论                    | A（scope 字段）   |
| E   | 通用化收尾：文档 kind 从枚举改模板注册、评审类型字符串化                                                                                           | 通用性讨论                    | A/D               |

已经完成、不在本路线内的：需求编号口径（文档已统一）、仓库登记 API、自定义角色 API、流程度量。

## 2. 分批总览

| 批  | 内容              | 迁移名                      | 破坏性              | 预估   |
| --- | ----------------- | --------------------------- | ------------------- | ------ |
| M0  | 基线与闸门        | —                           | 无                  | 0.5 天 |
| M1  | 知识治理字段（A） | `0005_knowledge_governance` | 无（全可空）        | 1 天   |
| M2  | 验收映射（B）     | `0006_acceptance_keys`      | 无（可空 + 回填）   | 1 天   |
| M3  | 变更管理（C）     | `0007_change_management`    | 无（新表 + 枚举值） | 1.5 天 |
| M4  | 单元与依赖（D）   | `0008_units`                | 无（新表 + 可空列） | 2 天   |
| M5  | 通用化收尾（E）   | `0009_kind_registry`        | 有（改类型/删枚举） | 2 天   |

依赖关系：

```
M0 → M1 → M2 → M3
        └────→ M4 → M5
```

M2 与 M4 可并行，但 M3 的影响分析要等 M2。

## 3. M0 基线与闸门

**做什么**

1. 记录当前迁移状态：`prisma migrate status`，核对四个已有迁移（`0001_init` … `0004_ticket_consumed_operation_audit_pointer`）。
2. 全量备份 + 恢复演练一次（隔离库）。
3. CI 加闸门：`prisma validate`、`prisma migrate diff --exit-code`（防止 schema 漂移）、集成测试用隔离库。
4. 记录回滚负责人和窗口。

**退出条件**：备份可恢复；CI 能在 schema 与迁移不一致时失败。

## 4. M1 知识治理字段

> 状态：已实施（`0005_knowledge_governance`），真实库 apply 未验证。

**Schema**

```prisma
model KnowledgeBase {
  kind String @default("SYSTEM") @db.VarChar(16) // BUSINESS | SYSTEM | PRACTICE
}

model KnowledgeDocument {
  scopeKind    String  @default("PROJECT") @db.VarChar(16) // PROJECT | UNIT | ROLE
  scopeId      String? @db.Uuid
  ownerUserId  String? @db.Uuid
  reviewDueAt  DateTime? @db.Timestamptz(3)
  supersededById String? @db.Uuid
}

model DocumentRevision {
  confidence   String  @default("MEDIUM") @db.VarChar(16) // HIGH | MEDIUM | LOW
  evidenceRefs Json?
}
```

**执行**

1. 加列（全部带默认值或可空）。
2. 回填：`product-knowledge` → `BUSINESS`，其余库 → `SYSTEM`；`scopeKind='PROJECT'`。
3. 应用开始写新字段；读取先用默认值。
4. 暂不收紧 `ownerUserId` 非空——先让存量数据有 owner 再收紧。

**退出条件**：每类库能按 kind 查询；文档能按 scope 过滤；回填覆盖率 100%（`SELECT count(*) FROM ... WHERE kind IS NULL` = 0）。

**回滚**：停写新列即可，列保留，无数据损失。

## 5. M2 验收映射

> 状态：已实施（`0006_acceptance_keys`），真实库 apply 未验证。

**Schema**

```prisma
model Task {
  acceptanceKeys String[] @default([]) @db.Text
}
```

**执行**

1. 加列（默认空数组），旧任务不受影响。
2. 实例化 DTO 增加 `stepBindings[].acceptanceKeys`；服务端校验：每条验收至少被一个任务覆盖，否则 `UNCOVERED_ACCEPTANCE`。
3. 新实例写入 `acceptanceKeys`；旧实例留空，影响分析退化为「按实例」并在接口里标注。
4. 加一条回填脚本：可按 PRD 的 `deliveryScope` 规则建议初值，人工确认后写入。

**退出条件**：新建实例 100% 有覆盖；未覆盖时建实例被拒；影响分析能按 key 命中。

**回滚**：列保留，停写即可。

## 6. M3 变更管理

**Schema**

```prisma
model ChangeRequest {
  id            String  @id @default(uuid()) @db.Uuid
  projectId     String  @db.Uuid
  requirementId String  @db.Uuid
  level         String  @db.VarChar(4)  // L0..L3
  diff          Json
  reason        String  @db.VarChar(2000)
  proposedById  String  @db.Uuid
  impactPreview Json?
  decision      String  @default("PENDING") @db.VarChar(16)
  decidedById   String? @db.Uuid
  decidedAt     DateTime? @db.Timestamptz(3)
  appliedAt     DateTime? @db.Timestamptz(3)
  createdAt     DateTime @default(now()) @db.Timestamptz(3)
  @@index([projectId, decision, createdAt])
}

model ProjectChangePolicy {
  id        String @id @default(uuid()) @db.Uuid
  projectId String @db.Uuid
  level     String @db.VarChar(4)
  slots     Json
  version   Int    @default(1)
  @@unique([projectId, level])
}

model ChangeRecipient {
  action      String  @default("ACK_ONLY") @db.VarChar(16)
  dueAt       DateTime? @db.Timestamptz(3)
  escalatedAt DateTime? @db.Timestamptz(3)
}

model Requirement {
  frozenAt DateTime? @db.Timestamptz(3)
}

enum ReviewKind {
  CHANGE_APPROVAL // 新增
}
```

**执行**

1. 先加枚举值与可空列；新表先不写。
2. 服务端实现 `ChangeRequest` 创建/决策；决策复用评审槽（`CHANGE_APPROVAL`）。
3. 决策后生成 `ChangeEvent` + 收件人（带 `action/dueAt`），失效动作复用现有票据/基线机制。
4. 冻结：交付发布候选或创建发布评审时写 `Requirement.frozenAt`；冻结后普通变更默认 `DEFERRED`。

**退出条件**：L0/L1 单审、L2 双审、L3 owner 可走通；变更后只失效被改验收；未 ack 会升级。

**回滚**：新表可保留；枚举值无法删除，保留不影响旧逻辑。

## 7. M4 单元与依赖

**Schema**

```prisma
model Unit {
  id           String @id @default(uuid()) @db.Uuid
  projectId    String @db.Uuid
  key          String @db.VarChar(48)
  name         String @db.VarChar(120)
  kind         String @db.VarChar(16) // SERVICE | APP | DATASET | EXTERNAL
  repositoryId String? @db.Uuid
  repoPath     String? @db.VarChar(200)
  ownerUserId  String? @db.Uuid
  status       String @default("ACTIVE") @db.VarChar(16)
  @@unique([projectId, key])
}

model UnitDependency {
  id         String @id @default(uuid()) @db.Uuid
  projectId  String @db.Uuid
  fromUnitId String @db.Uuid
  toUnitId   String @db.Uuid
  edgeKind   String @db.VarChar(16) // CALLS | READS | PUBLISHES | UPSTREAM
  protocol   String? @db.VarChar(16)
  contractDocumentId String? @db.Uuid
  source     String @db.VarChar(16) // DECLARED | INFERRED | RUNTIME
  confidence String @db.VarChar(16)
  evidence   String? @db.VarChar(500)
  verifiedAt DateTime? @db.Timestamptz(3)
  @@unique([projectId, fromUnitId, toUnitId, edgeKind])
}

model Task {
  unitId String? @db.Uuid
}
```

**执行**

1. 建表 + `Task.unitId` 可空列；先不写。
2. 提供 Unit/Dependency 的登记接口（人工声明优先，扫描推断后置）。
3. 实例化时把 `repositoryId` 映射到 `unitId`；映射不上的任务保持空，并在看板标注。
4. 文档 `scopeKind='UNIT'` 开始写入 `scopeId`。

**退出条件**：易番番四个仓库能映射到 Unit；任务可按 Unit 过滤；变更传播能沿反向边找到受影响任务。

**回滚**：新表与可空列保留，停写即可。

## 8. M5 通用化收尾

> 状态：已实施（`0011_kinds_as_strings`），隔离库验证通过；生产 apply 待运维。

**内容**

1. 文档 kind 从枚举改为字符串 + 模板注册表（`DocumentKind` 枚举保留为兼容，逐步停用）。
2. 评审类型从枚举改为字符串（`ReviewKind` 同样处理）。
3. 清理：删除 M1–M4 期间不再使用的旧列/旧枚举值（需单独确认无读取方）。
4. 收紧约束：`ownerUserId` 非空、`scopeKind` 白名单、`unitId` 外键。

**这是唯一有破坏性的批次**，必须满足：

- 所有读取方已切到新字段（代码搜索 + 集成测试）；
- 旧数据已回填并通过抽样校验；
- 备份可恢复；
- 单独发布，不与功能混在一起。

## 9. 每批的通用纪律

| 项       | 要求                                                               |
| -------- | ------------------------------------------------------------------ |
| 发布单位 | 一批一个 PR，一个迁移，不混功能                                    |
| 应用顺序 | 先迁移后代码（加列）→ 先代码后迁移（删列）                         |
| 双写窗口 | 新字段写入后至少保留一个发布周期再切读                             |
| 测试     | 单测 + 隔离库集成；迁移在隔离库演练两次（正向 + 恢复）             |
| 观测     | 监控新列空值率、回填脚本失败数                                     |
| 回滚     | 加列类 = 停写；新表类 = 保留或补偿迁移删除；删列类 = 只能恢复备份  |
| 文档     | 每批更新 `docs/knowledge-architecture.md` 第 10 节与 `docs/api.md` |

## 10. 建议的执行顺序与原因

1. **M1 先行**：知识治理字段是 M3（变更影响知识）与 M4（scope 指向 Unit）的前置，且零破坏。
2. **M2 紧跟**：验收映射决定影响分析精度；没有它，M3 的「只失效被改部分」做不到。
3. **M3 再做**：变更单依赖 M2 的粒度；同时它引入的评审类型变更最容易被前端依赖，放后面减少返工。
4. **M4 独立**：单元模型可以并行，但要等 M1 的 `scopeId` 才能挂文档。
5. **M5 最后**：类型收紧放在所有读写收敛之后，避免边改边破。

## 11. 与其它工作的关系

- **角色包合并**（两套目录）：纯代码与打包，不涉及数据库，可与 M1/M2 并行。
- **Web 工位**：依赖 M3 的收件人字段与 M2 的覆盖展示，建议 M3 之后。
- **前端/UI/运维薄包**：纯内容，随时可做。
