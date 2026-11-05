-- T1 / 0016 precheck (read-only). Run BEFORE applying 0016.
-- Target: PostgreSQL schema workmesh_v1. If any expectation below fails, stop and follow RECOVERY.md.

-- 1) Migration history: expect zero rows, or only a rolled_back_at row.
SELECT id, migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '0016_repository_identity_locator';

-- 2) New objects must not exist yet.
SELECT
  to_regtype('"workmesh_v1"."RepositoryIdentityMode"') AS identity_mode_type,
  to_regtype('"workmesh_v1"."RepositoryLocatorSource"') AS locator_source_type,
  to_regclass('"workmesh_v1"."ProjectRepositoryLocator"') AS locator_table;
-- Expect all NULL.

-- 3) Existing rows must satisfy the future PROVIDER branch of the CHECK.
SELECT count(*) AS null_provider_fields
FROM "workmesh_v1"."ProjectRepository"
WHERE "adapter" IS NULL OR "externalId" IS NULL;
-- Expect 0 (pre-0016 schema enforces NOT NULL).

-- 4) Existing unique identity must already hold (defensive; 0001 already created it).
SELECT "projectId", "adapter", "externalId", count(*) AS duplicates
FROM "workmesh_v1"."ProjectRepository"
WHERE "adapter" IS NOT NULL AND "externalId" IS NOT NULL
GROUP BY "projectId", "adapter", "externalId"
HAVING count(*) > 1;
-- Expect 0 rows.

-- 5) Backup reminder: take pg_dump --format=custom before applying. Not a query.
