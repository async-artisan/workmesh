#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${WORKMESH_V1_DATABASE_URL:-}" ]]; then
  echo 'WORKMESH_V1_DATABASE_URL is required' >&2
  exit 2
fi

pnpm --filter @workmesh/api exec prisma db execute \
  --stdin \
  --schema prisma/schema.prisma <<'SQL'
SELECT current_database();
SQL
