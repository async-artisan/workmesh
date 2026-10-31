#!/usr/bin/env bash
set -euo pipefail

schema="prisma/schema.prisma"
database_url="${DATABASE_URL:-}"
if [[ -z "$database_url" ]]; then
  echo 'DATABASE_URL is required for a migration plan' >&2
  exit 2
fi

pnpm --filter @reqflow/api exec prisma migrate diff \
  --from-empty \
  --to-schema-datamodel "$schema" \
  --script
