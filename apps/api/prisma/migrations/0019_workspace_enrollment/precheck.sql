-- T1 / 0019 precheck (read-only). Run BEFORE applying 0019.
-- 1) 0018 must be finished.
SELECT migration_name, finished_at
FROM "_prisma_migrations"
WHERE migration_name = '0018_workspace_definition_revision';
-- Expect finished_at non-null and rolled_back_at null.

-- 2) 0019 history row: expect zero rows, or only rolled_back_at non-null.
SELECT id, migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '0019_workspace_enrollment';

-- 3) Target table must not exist yet.
SELECT to_regclass('"workmesh_v1"."ProjectWorkspaceEnrollment"') AS enrollment_table;
-- Expect NULL.

-- 4) There must be a published revision source; count is informational.
SELECT count(*) AS revisions FROM "workmesh_v1"."ProjectWorkspaceDefinitionRevision";
