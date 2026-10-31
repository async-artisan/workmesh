# Deployment

1. Install Node 20+, pnpm 10 and PostgreSQL 15+.
2. Run `pnpm install --frozen-lockfile`.
3. Copy `apps/api/.env.example` to a local secret store and set unique `JWT_SECRET` and `JWT_REFRESH_SECRET` values of at least 32 characters.
4. Run `pnpm --filter @reqflow/api db:generate`, inspect `DATABASE_URL` with `bash scripts/db-check.sh`, and review the SQL plan with `bash scripts/db-plan.sh`.
5. Apply migrations with `pnpm --filter @reqflow/api db:migrate` only after the database target is confirmed.
6. Seed only an isolated local database with `SEED_ADMIN_PASSWORD='...' pnpm db:seed`; set `SEED_ADMIN_EMAIL` if needed. The seed command refuses to run without an explicit password.
7. Run `bash scripts/verify.sh` before release.
8. Build with `pnpm build`; run the API from `apps/api/dist/main.js` and serve `apps/web/dist` behind a TLS reverse proxy.

This deployment path uses Node.js/pnpm directly and does not require a Docker image. PostgreSQL remains an external dependency and must be selected explicitly.

The API exposes `/api/metrics` for request count, failures, and average latency. `RATE_LIMIT_MAX` controls the per-IP minute bucket; keep it behind a trusted proxy that preserves the real client IP policy.

The application does not create or modify a shared database during build or tests. Keep provider keys and database URLs outside Git, rotate them through the deployment secret manager, and back up PostgreSQL before migrations.
