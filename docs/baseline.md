# 基线记录（WP0）

> 日期：2026-11-03。目的：给迁移与漂移闸门留下可复核证据。

## 环境

| 项     | 值                                                                          |
| ------ | --------------------------------------------------------------------------- |
| 数据库 | 本机隔离库 `workmesh_m5`（`127.0.0.1:5432`，schema `workmesh_v1`）          |
| 来源   | 由 `apps/api/.env` 的 `WORKMESH_V1_DATABASE_URL` 复制，仅替换库名；不改生产 |
| 工具链 | Prisma 5.22.0，Node 20                                                      |

## 执行与结果

```bash
# 1) 建库（用 postgres 库执行）
CREATE DATABASE workmesh_m5;

# 2) 应用迁移
prisma migrate deploy --schema prisma/schema.prisma
# → All migrations have been successfully applied.（0001–0010，共 10 个）

# 3) 状态
prisma migrate status --schema prisma/schema.prisma
# → 10 migrations found；Database schema is up to date!

# 4) 漂移比对
prisma migrate diff --from-url <workmesh_m5> --to-schema-datamodel prisma/schema.prisma --exit-code
# → No difference detected.（退出 0）

# 5) 客户端生成
prisma generate --schema prisma/schema.prisma
# → 退出 0（此前 EPERM 已解除：停掉 dev server / prisma studio / nest watch）
```

## 修复的既有漂移

`0005_knowledge_governance` 建了 `KnowledgeDocument(projectId, scopeKind, scopeId)` 索引，但 `schema.prisma` 未声明，导致 `migrate diff` 报 `Removed index`。已补 `@@index([projectId, scopeKind, scopeId])`，比对归零。

## CI 闸门

`.github/workflows/ci.yml` 新增 Postgres service，并在 `prisma validate` 之后执行：

```bash
prisma migrate deploy
prisma migrate diff --from-url "$WORKMESH_V1_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

迁移目录与 schema 不一致时流水线直接失败。

## 未覆盖

- 生产库 apply 与回滚演练（需运维窗口与备份）。
- `pg_dump` 不在 PATH；隔离库的回滚方式是 drop 后重建，生产必须另有备份。
- 浏览器 E2E 与 HTTP 契约套件（B3/B4）。
