-- M1: 知识治理字段（加列，不收紧约束）
ALTER TABLE "workmesh_v1"."KnowledgeBase"
  ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'SYSTEM';

ALTER TABLE "workmesh_v1"."KnowledgeDocument"
  ADD COLUMN "scopeKind" VARCHAR(16) NOT NULL DEFAULT 'PROJECT',
  ADD COLUMN "scopeId" UUID,
  ADD COLUMN "ownerUserId" UUID,
  ADD COLUMN "reviewDueAt" TIMESTAMPTZ(3),
  ADD COLUMN "supersededById" UUID;

ALTER TABLE "workmesh_v1"."DocumentRevision"
  ADD COLUMN "confidence" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "evidenceRefs" JSONB;

-- 回填：产品知识库是业务事实库，其余默认系统事实库。
UPDATE "workmesh_v1"."KnowledgeBase"
SET "kind" = 'BUSINESS'
WHERE "key" = 'product-knowledge';

CREATE INDEX "KnowledgeDocument_projectId_scopeKind_scopeId_idx"
  ON "workmesh_v1"."KnowledgeDocument" ("projectId", "scopeKind", "scopeId");
