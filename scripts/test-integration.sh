#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${REQFLOW_TEST_DATABASE_URL:-}" ]]; then
  echo "Set REQFLOW_TEST_DATABASE_URL to a disposable local reqflow_test_* PostgreSQL database."
  exit 2
fi

node -e '
const value = process.env.REQFLOW_TEST_DATABASE_URL;
let url;
try { url = new URL(value); } catch { process.exit(1); }
const database = url.pathname.replace(/^\//, "");
const localUser = require("node:os").userInfo().username;
let username;
try { username = decodeURIComponent(url.username); } catch { process.exit(1); }
if (
  !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
  !database.startsWith("reqflow_test_") ||
  username !== localUser ||
  url.password
) process.exit(1);
' || {
  echo "Refusing integration tests outside a local-user reqflow_test_* database without a password."
  exit 2
}

cd "$(dirname "$0")/.."
pnpm --filter @reqflow/api build
DATABASE_URL="$REQFLOW_TEST_DATABASE_URL" NODE_ENV=test \
  pnpm --filter @reqflow/api exec prisma migrate deploy --schema prisma/schema.prisma
DATABASE_URL="$REQFLOW_TEST_DATABASE_URL" NODE_ENV=test \
  pnpm --filter @reqflow/api test:integration
