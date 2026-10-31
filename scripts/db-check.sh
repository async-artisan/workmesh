#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo 'DATABASE_URL is required' >&2
  exit 2
fi

pnpm --filter @reqflow/api exec prisma db execute \
  --stdin \
  --schema prisma/schema.prisma <<'SQL'
SELECT current_database();
SQL
