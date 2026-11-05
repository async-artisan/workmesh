-- T1 / 0019 postcheck (read-only). Run AFTER applying 0019.

-- 1) Columns: must contain codeHash but no plaintext code/secret column.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectWorkspaceEnrollment'
ORDER BY ordinal_position;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectWorkspaceEnrollment'
  AND column_name IN ('code', 'plaintextCode', 'secret', 'token');
-- Expect 0 rows.

-- 2) Unique codeHash plus query indexes.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'workmesh_v1' AND tablename = 'ProjectWorkspaceEnrollment'
ORDER BY indexname;
-- Expect codeHash unique, (projectId,createdAt) index, expiresAt index.

-- 3) Foreign keys: project, createdBy, definitionRevision.
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = '"workmesh_v1"."ProjectWorkspaceEnrollment"'::regclass
ORDER BY conname;

-- 4) Application-enforced invariant: enrollment revision must belong to the same project.
SELECT e.id, e."projectId" AS enrollment_project, r."projectId" AS revision_project
FROM "workmesh_v1"."ProjectWorkspaceEnrollment" e
JOIN "workmesh_v1"."ProjectWorkspaceDefinitionRevision" r ON r.id = e."definitionRevisionId"
WHERE e."projectId" <> r."projectId";
-- Expect 0.

-- 5) Stored definitionDigest must match the revision digest (application-enforced).
SELECT e.id
FROM "workmesh_v1"."ProjectWorkspaceEnrollment" e
JOIN "workmesh_v1"."ProjectWorkspaceDefinitionRevision" r ON r.id = e."definitionRevisionId"
WHERE e."definitionDigest" <> r."digest";
-- Expect 0.
