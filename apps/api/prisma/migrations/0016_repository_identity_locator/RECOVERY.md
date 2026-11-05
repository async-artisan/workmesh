# T1 0016–0019 迁移失败恢复说明

适用于 `workmesh_v1` schema 的 0016–0019。**先读再动手；任何手工修复前先备份。**

本目录中的 `precheck.sql` / `postcheck.sql` / `validate_constraint.sql` 是**人工检查脚本，不是自动 fail-fast gate**；Prisma 只应用 `migration.sql`，不会执行它们。不要把校验文件改名为 `migration.sql`，也不要接入自动部署。

## 事实前提

- 0016–0019 均为手写 SQL；文件内没有 `BEGIN/COMMIT`，**不得假设单个 migration 失败后整份 SQL 自动回滚**。
- `prisma migrate resolve --rolled-back <name>` 只修改 `_prisma_migrations` 历史记录，**不会撤销已执行的 SQL**。
- `prisma migrate resolve --applied <name>` 只标记历史，**不会执行迁移**。
- 已部署环境禁止直接编辑 0016–0019；补偿动作应另写新迁移或按诊断在维护窗口手工执行。
- 不在真实/共享数据库上演练失败；用隔离库 + `pg_dump` 副本。
- 本文件只处理**数据库 schema 迁移**；本机 v1→v2 配置迁移的恢复见设计 §14.3，两者不得互相删除文件。

## 可重入与严格定义校验（0016–0019 已实现）

每个 migration 在 DDL 前查 catalog：

- 对象**不存在**：创建/添加。
- 对象**已存在且定义匹配**：跳过（允许同一 migration 安全重跑）。
- 对象**已存在但定义不匹配**：`RAISE EXCEPTION`，错误信息带对象名与期望值；不会静默跳过，也不会自动 DROP/重建。
- 列校验不只查列名：还校验 `data_type`、`udt_name`、`is_nullable`、`character_maximum_length`、`datetime_precision`、默认值；`version` 必须精确为 `1`，时间戳默认值必须是 `now()`/`CURRENT_TIMESTAMP`，`identityMode` 必须是 `PROVIDER`。
- 外键校验使用 `pg_constraint` 的结构字段，而不是字符串 contains：本地表/列、引用 schema/表/列、`confdeltype='r'`、`confupdtype='c'` 必须全部匹配。
- 部分唯一索引校验使用 `pg_index` 的列顺序、`indisunique` 和 `pg_get_expr(indpred, indrelid)`；谓词规范化后必须严格等价于 `"revokedAt" IS NULL`。
- CHECK 校验使用 `pg_get_expr(conbin, conrelid)` 的规范化完整逻辑；弱化 CHECK、增加额外 OR 分支或改变字段条件都会失败。
- 严格校验使用会话级 `pg_temp` 临时函数，结束后删除；不产生持久 schema 对象。
- 0016 的 CHECK 保持 `NOT VALID`：新写入立即受检，存量行不扫描；验证路径见 `validate_constraint.sql`。
- 失败后修复定义/补齐对象，再重跑同一 migration 即可；不允许用 `db push` 代替。

## 部署状态与 checksum

- 当前工作区没有 0016–0019 的部署记录，但这**不等于**其他环境从未部署；部署状态在未查询目标库前应视为**未知**。
- 直接用 Node/pg 执行 SQL 通过，**不能**冒充 `prisma migrate deploy` 通过；`migrate deploy` 还负责 `_prisma_migrations` 的 checksum 和历史写入。
- 如果任何目标环境的 `_prisma_migrations` 已有 0016–0019，**不要**应用当前改写后的 `migration.sql`；先恢复原始文件或用补偿迁移，禁止用 `migrate resolve` 掩盖 checksum 冲突。
- 如果 `migrate deploy` 因 schema engine 无法启动（例如 `spawn EPERM`）失败：记录完整错误，结论只能是“SQL 直执行通过，Prisma migrate deploy 待运行环境修复”，不能写 T1 完整通过。


## 通用检查顺序

1. 停止应用写流量，记录时间与报错；执行 `pg_dump --format=custom`。
2. 查历史：
   ```sql
   SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
   FROM "_prisma_migrations"
   WHERE migration_name IN (
     '0016_repository_identity_locator',
     '0017_workspace_definition',
     '0018_workspace_definition_revision',
     '0019_workspace_enrollment'
   )
   ORDER BY started_at;
   ```
3. 查实际对象：`to_regtype`、`to_regclass`、`information_schema.columns`、`pg_indexes`、`pg_index`、`pg_constraint`。
4. 先重跑同一 `migration.sql`：可重入逻辑会跳过匹配对象、补齐缺失对象；若报定义不匹配，按错误信息修复后重跑。
5. 修复后运行对应 `postcheck.sql`（0016 还需 `validate_constraint.sql`），再决定 `resolve --applied` 或已由重跑完成。
6. 无法判断时：把备份恢复到隔离库重放定位；生产按备份恢复，再在维护窗口重放。

## 0016：仓库身份与 locator

### 中间态 A：enum 已建，其余未建

- 检查：
  ```sql
  SELECT to_regtype('"workmesh_v1"."RepositoryIdentityMode"'), to_regtype('"workmesh_v1"."RepositoryLocatorSource"');
  SELECT to_regclass('"workmesh_v1"."ProjectRepositoryLocator"');
  ```
- 处理：直接重跑 0016。若 enum label 与期望一致，会跳过 enum 并继续建列/表/索引；若 label 不一致，migration 会抛出 `RepositoryIdentityMode labels mismatch`，先修正或重建 enum（确认无依赖对象后）再重跑。
- 不要在 enum 已被列/表引用时直接 DROP。

### 中间态 B：列/表已建，CHECK/索引/外键未建

- 检查列与表：
  ```sql
  SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='workmesh_v1' AND table_name='ProjectRepository'
    AND column_name IN ('identityMode','lastVerifiedStatus','lastVerifiedAt','lastVerifiedDigest','updatedAt');
  SELECT to_regclass('"workmesh_v1"."ProjectRepositoryLocator"');
  ```
- 处理：直接重跑 0016；会补齐缺失的 CHECK、索引、表、外键与部分唯一索引。已存在但类型/可空性/默认值不匹配时会抛错，按错误修正后再重跑。
- `identityMode` 默认 `PROVIDER` 必须已回填；若列为 `NULL`（异常中间态），先停用写入并调查，不得直接删除行。

### 中间态 C：CHECK 已加但 `NOT VALID`

- 这是 0016 的正常结束状态。先运行 `postcheck.sql` 第 4 节，期望 0 行违规。
- 再在维护窗口执行 `validate_constraint.sql`（`VALIDATE CONSTRAINT` 会加 `SHARE UPDATE EXCLUSIVE` 锁并扫描表；不重写行）。
- 存量违规处理：按身份语义修正 `identityMode/adapter/externalId`（例如历史行全部应为 `PROVIDER`），保留行与历史；不得为通过约束而删行。

### 中间态 D：对象齐全但历史未标记

- 先运行 `postcheck.sql`；全部通过后重跑 0016 会验证对象并成功（不重复创建），随后由 Prisma 记录历史。
- 若历史仍缺失且确认对象齐全，可：
  ```
  prisma migrate resolve --applied 0016_repository_identity_locator
  ```
- 不要手工删除已存在对象。

## 0017：definition 头

- 重跑 0017 会校验表/列/唯一索引/FK；缺失则补，定义不匹配则抛错。
- 0017 结束时 `currentRevisionId` **还没有 FK**（由 0018 添加）；此时不要删除表，也不要手工加半套 FK。
- 对象齐全且历史缺失时：重跑 0017 或 `prisma migrate resolve --applied 0017_workspace_definition`。

## 0018：revision 与关联表

- 重跑 0018 会校验 revision/join 表、索引、三个 revision FK 和 `definition.currentRevisionId` FK；缺失则补，定义不匹配则抛错。
- 特别检查：
  ```sql
  SELECT conname FROM pg_constraint
  WHERE conrelid='"workmesh_v1"."ProjectWorkspaceDefinition"'::regclass
    AND conname='ProjectWorkspaceDefinition_currentRevisionId_fkey';
  ```
- 若 `definition.currentRevisionId` 有值但对应 revision 不存在，先停写并人工修正指针；不要删除 definition 行。
- 对象齐全后运行 `postcheck.sql`，再决定重跑或 `resolve --applied`。

## 0019：enrollment

- 重跑 0019 会校验表/列/唯一索引/FK；缺失则补，定义不匹配则抛错。
- 只允许 `codeHash`，不得新增明文码列。
- 对象齐全后运行 `postcheck.sql`，再决定重跑或 `resolve --applied`。

## `migrate resolve` 的安全用法

| 情况 | 命令 | 前置 |
|---|---|---|
| 已重跑成功或已手工补齐全部对象并验证 | `resolve --applied <name>` | `postcheck.sql` 通过 |
| 已手工撤销**全部**已执行语句 | `resolve --rolled-back <name>` | 对象确实不存在、数据已备份 |
| 只是想“清除失败记录” | 不允许 | 会掩盖真实状态 |

禁止在未知数据库状态下直接重跑其他 migration，也禁止用 `db push` 代替迁移。0016–0019 自身可重入，但 0001–0015 不可重入；不要重跑旧迁移。

## 应用层一致性边界

以下规则没有数据库复合外键，由应用事务保证，`postcheck.sql` 提供检测查询：

- locator.repositoryId 属于同一 projectId；
- revision.projectId = definition.projectId；
- definition.currentRevisionId 属于同一 definition；
- revision-repository 关联的两端属于同一 project；
- enrollment.definitionRevisionId 属于同一 projectId，且 `definitionDigest` 与 revision.digest 一致。

T1 不写业务逻辑；T2/T3/T4 必须在事务内维护上述一致性。发现 postcheck 非 0 时停止继续迁移，保留数据并人工判定归属，不得静默删除或改绑。

## 事故记录

记录 migration 名、失败语句、实际对象状态、选择路径、验证 SQL 结果、操作人与时间。补偿迁移单独编号，不改写已发布 migration。
