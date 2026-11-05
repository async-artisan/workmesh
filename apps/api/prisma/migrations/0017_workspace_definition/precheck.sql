-- T1 / 0017 precheck (read-only). Run BEFORE applying 0017.
-- 1) 0016 must be finished.
SELECT migration_name, finished_at
FROM "_prisma_migrations"
WHERE migration_name = '0016_repository_identity_locator';
-- Expect finished_at non-null and rolled_back_at null.

-- 2) 0017 history row: expect zero rows, or only rolled_back_at non-null.
SELECT id, migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '0017_workspace_definition';

-- 3) Target table must not exist yet.
SELECT to_regclass('"workmesh_v1"."ProjectWorkspaceDefinition"') AS definition_table;
-- Expect NULL.
