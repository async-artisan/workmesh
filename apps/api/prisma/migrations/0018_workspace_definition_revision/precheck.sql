-- T1 / 0018 precheck (read-only). Run BEFORE applying 0018.
-- 1) 0017 must be finished.
SELECT migration_name, finished_at
FROM "_prisma_migrations"
WHERE migration_name = '0017_workspace_definition';
-- Expect finished_at non-null and rolled_back_at null.

-- 2) 0018 history row: expect zero rows, or only rolled_back_at non-null.
SELECT id, migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '0018_workspace_definition_revision';

-- 3) Target tables must not exist yet.
SELECT
  to_regclass('"workmesh_v1"."ProjectWorkspaceDefinitionRevision"') AS revision_table,
  to_regclass('"workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository"') AS revision_repository_table;
-- Expect both NULL.

-- 4) Existing definition rows must be readable for the later FK; table exists but may be empty.
SELECT count(*) AS definitions FROM "workmesh_v1"."ProjectWorkspaceDefinition";
