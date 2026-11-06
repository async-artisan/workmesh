#!/usr/bin/env bash
set -euo pipefail

pnpm format:check
pnpm lint
pnpm lint:eslint
pnpm type-check
pnpm test
pnpm --filter @workmesh/api test:coverage
pnpm build
WORKMESH_V1_DATABASE_URL="${WORKMESH_V1_DATABASE_URL:-postgresql://127.0.0.1:5432/workmesh?schema=workmesh_v1}" pnpm --filter @workmesh/api exec prisma validate --schema prisma/schema.prisma
if [[ -n "${WORKMESH_TEST_DATABASE_URL:-}" ]]; then
  pnpm test:integration
else
  echo "Skipping API integration tests: WORKMESH_TEST_DATABASE_URL is not set."
fi
