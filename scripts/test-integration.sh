#!/usr/bin/env bash
# 隔离数据库套件入口。
# 流程：入口级目标核验 -> 隔离目录 Prisma validate/generate（不加载 .env）-> 只读身份探针 -> 套件内二次核验。
# 迁移是写操作，默认不执行；需显式 --apply-migrations 且目标已核验。
# URL 由用户批准通道配置，不在命令行内写连接串。
set -euo pipefail

APPLY_MIGRATIONS=0
for arg in "$@"; do
  case "$arg" in
    --apply-migrations) APPLY_MIGRATIONS=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

corepack pnpm --filter @workmesh/shared build >/dev/null

node scripts/lib/check-test-database.mjs

node scripts/lib/isolated-prisma.mjs

if [[ "$APPLY_MIGRATIONS" == "1" ]]; then
  echo "applying formal migrations on the verified isolated target"
  WORKMESH_V1_DATABASE_URL="$WORKMESH_TEST_DATABASE_URL" NODE_ENV=test \
    corepack pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma
else
  echo "skipping migrations: pass --apply-migrations after the target and backup are confirmed"
fi

WORKMESH_V1_DATABASE_URL="$WORKMESH_TEST_DATABASE_URL" NODE_ENV=test \
  corepack pnpm --filter @workmesh/api test:integration
