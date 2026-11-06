#!/usr/bin/env bash
# Compatibility wrapper. The guarded implementation lives in Node so the root
# `pnpm test:integration` entry works on Windows, macOS and Linux alike.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/test-integration.mjs "$@"
