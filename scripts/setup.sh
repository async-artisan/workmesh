#!/usr/bin/env bash
set -euo pipefail
pnpm install
if [[ ! -f apps/api/.env ]]; then
  echo 'Create apps/api/.env from apps/api/.env.example using your local secret store.'
fi
pnpm db:generate
