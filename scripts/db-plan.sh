#!/usr/bin/env bash
set -euo pipefail

schema="prisma/schema.prisma"
if [[ -z "${WORKMESH_V1_DATABASE_URL:-}" ]]; then
  echo 'WORKMESH_V1_DATABASE_URL is required for a migration plan' >&2
  exit 2
fi

pnpm --filter @workmesh/api exec prisma migrate diff \
  --from-empty \
  --to-schema-datamodel "$schema" \
  --script
