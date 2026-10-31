#!/usr/bin/env bash
set -euo pipefail

pnpm format:check
pnpm lint
pnpm lint:eslint
pnpm type-check
pnpm test
pnpm --filter @reqflow/api test:coverage
pnpm build
DATABASE_URL="${DATABASE_URL:-postgresql://127.0.0.1:5432/reqflow?schema=public}" pnpm --filter @reqflow/api exec prisma validate --schema prisma/schema.prisma
if [[ -n "${REQFLOW_TEST_DATABASE_URL:-}" ]]; then
  bash scripts/test-integration.sh
else
  echo "Skipping API integration tests: REQFLOW_TEST_DATABASE_URL is not set."
fi
