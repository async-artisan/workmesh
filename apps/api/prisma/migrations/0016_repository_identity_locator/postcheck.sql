-- T1 / 0016 postcheck (read-only). Run AFTER applying 0016.
-- 0016 adds the CHECK as NOT VALID, so new writes are checked immediately but old rows are not scanned.
-- Run validate_constraint.sql only after section 4 returns 0.

-- 1) Enum labels.
SELECT t.typname, e.enumlabel, e.enumsortorder
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'workmesh_v1'
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('RepositoryIdentityMode', 'RepositoryLocatorSource')
ORDER BY t.typname, e.enumsortorder;
-- Expect DECLARED/PROVIDER and HTTPS/SSH.

-- 2) ProjectRepository new columns.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectRepository'
  AND column_name IN ('identityMode', 'adapter', 'externalId', 'lastVerifiedStatus',
                      'lastVerifiedAt', 'lastVerifiedDigest', 'updatedAt')
ORDER BY column_name;
-- Expect adapter/externalId nullable YES; identityMode NO default 'PROVIDER'; updatedAt NO default now().

-- 3) CHECK exists and its validation state is explicit.
SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = '"workmesh_v1"."ProjectRepository"'::regclass
  AND conname = 'ProjectRepository_identity_mode_ck';
-- Expect convalidated = false until validate_constraint.sql runs.

-- 4) Rows violating the CHECK.
SELECT count(*) AS identity_mode_violations
FROM "workmesh_v1"."ProjectRepository"
WHERE NOT (
  ("identityMode" = 'PROVIDER' AND "adapter" IS NOT NULL AND "externalId" IS NOT NULL)
  OR ("identityMode" = 'DECLARED' AND "adapter" IS NULL AND "externalId" IS NULL)
);
-- Expect 0 before VALIDATE CONSTRAINT.

-- 5) Partial unique index must only constrain active locators.
SELECT indexdef
FROM pg_indexes
WHERE schemaname = 'workmesh_v1' AND tablename = 'ProjectRepositoryLocator'
  AND indexname = 'ProjectRepositoryLocator_active_key';
-- Expect UNIQUE ... WHERE (revokedAt IS NULL).

-- 6) Locator table, columns, and foreign keys.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectRepositoryLocator'
ORDER BY ordinal_position;

SELECT conname, contype, convalidated
FROM pg_constraint
WHERE conrelid = '"workmesh_v1"."ProjectRepositoryLocator"'::regclass
ORDER BY conname;
-- Expect pkey and four foreign keys: project, repository, declaredBy, revokedBy.

-- 7) Application-enforced invariant: locator.repositoryId must belong to the same project.
SELECT l.id, l."projectId" AS locator_project, r."projectId" AS repository_project
FROM "workmesh_v1"."ProjectRepositoryLocator" l
JOIN "workmesh_v1"."ProjectRepository" r ON r.id = l."repositoryId"
WHERE l."projectId" <> r."projectId";
-- Expect 0.

-- 8) Supporting index on ProjectRepository(projectId, archivedAt).
SELECT indexdef
FROM pg_indexes
WHERE schemaname = 'workmesh_v1' AND tablename = 'ProjectRepository'
  AND indexname = 'ProjectRepository_projectId_archivedAt_idx';
