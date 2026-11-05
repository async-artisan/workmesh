-- T1 / 0017 postcheck (read-only). Run AFTER applying 0017.
-- currentRevisionId has no FK yet; 0018 adds it. Do not delete or rewrite the table while 0018 is pending.

-- 1) Columns.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectWorkspaceDefinition'
ORDER BY ordinal_position;

-- 2) Unique indexes: one definition per project, one current revision pointer.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'workmesh_v1' AND tablename = 'ProjectWorkspaceDefinition'
ORDER BY indexname;
-- Expect ProjectWorkspaceDefinition_projectId_key and ProjectWorkspaceDefinition_currentRevisionId_key.

-- 3) Foreign keys present now: project, updatedBy.
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = '"workmesh_v1"."ProjectWorkspaceDefinition"'::regclass
ORDER BY conname;
-- Expect pkey + projectId_fkey + updatedByUserId_fkey; currentRevisionId_fkey arrives in 0018.

-- 4) Definition/project ownership is a normal FK; no cross-project rows expected at T1.
SELECT d.id, d."projectId" AS definition_project, p.id AS project_exists
FROM "workmesh_v1"."ProjectWorkspaceDefinition" d
LEFT JOIN "workmesh_v1"."Project" p ON p.id = d."projectId"
WHERE p.id IS NULL;
-- Expect 0 rows.
