-- T1 / 0018 postcheck (read-only). Run AFTER applying 0018.
-- 0018 creates the revision tables, the revision -> definition/project FKs,
-- the definition.currentRevisionId -> revision FK, and the revision-repository join table.

-- 1) Tables and columns.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'workmesh_v1'
  AND table_name IN ('ProjectWorkspaceDefinitionRevision',
                     'ProjectWorkspaceDefinitionRevisionRepository')
ORDER BY table_name, ordinal_position;

-- 2) Unique/query indexes.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'workmesh_v1'
  AND tablename IN ('ProjectWorkspaceDefinitionRevision',
                    'ProjectWorkspaceDefinitionRevisionRepository')
ORDER BY tablename, indexname;
-- Expect revision (definitionId,revisionNo) unique and (projectId,publishedAt) index;
-- join table unique (revisionId,logicalKey), unique (revisionId,repositoryId), repositoryId index.

-- 3) Foreign keys, including the current-revision pointer.
SELECT conname, contype
FROM pg_constraint
WHERE conrelid IN (
  '"workmesh_v1"."ProjectWorkspaceDefinitionRevision"'::regclass,
  '"workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository"'::regclass,
  '"workmesh_v1"."ProjectWorkspaceDefinition"'::regclass
)
ORDER BY conrelid::regclass::text, conname;

SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = '"workmesh_v1"."ProjectWorkspaceDefinition"'::regclass
  AND conname = 'ProjectWorkspaceDefinition_currentRevisionId_fkey';
-- Expect present.

-- 4) Application-enforced invariant: revision.projectId must equal definition.projectId.
SELECT r.id, r."projectId" AS revision_project, d."projectId" AS definition_project
FROM "workmesh_v1"."ProjectWorkspaceDefinitionRevision" r
JOIN "workmesh_v1"."ProjectWorkspaceDefinition" d ON d.id = r."definitionId"
WHERE r."projectId" <> d."projectId";
-- Expect 0.

-- 5) Application-enforced invariant: currentRevisionId must belong to the same definition.
SELECT d.id
FROM "workmesh_v1"."ProjectWorkspaceDefinition" d
JOIN "workmesh_v1"."ProjectWorkspaceDefinitionRevision" r ON r.id = d."currentRevisionId"
WHERE r."definitionId" <> d.id;
-- Expect 0.

-- 6) Application-enforced invariant: revision and repository must belong to the same project.
SELECT rr.id, r."projectId" AS revision_project, p."projectId" AS repository_project
FROM "workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository" rr
JOIN "workmesh_v1"."ProjectWorkspaceDefinitionRevision" r ON r.id = rr."revisionId"
JOIN "workmesh_v1"."ProjectRepository" p ON p.id = rr."repositoryId"
WHERE r."projectId" <> p."projectId";
-- Expect 0. If nonzero, stop; do not delete rows; fix ownership or definition data explicitly.
