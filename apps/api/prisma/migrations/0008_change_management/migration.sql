-- M3: 变更管理结构（新表 + 枚举值 + 收件人字段 + 需求冻结）
ALTER TYPE "workmesh_v1"."ReviewKind" ADD VALUE IF NOT EXISTS 'CHANGE_APPROVAL';

CREATE TABLE "workmesh_v1"."ChangeRequest" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "requirementId" UUID NOT NULL,
  "level" VARCHAR(4) NOT NULL,
  "diff" JSONB NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "proposedById" UUID NOT NULL,
  "impactPreview" JSONB,
  "decision" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "decidedById" UUID,
  "decidedAt" TIMESTAMPTZ(3),
  "appliedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChangeRequest_projectId_decision_createdAt_idx"
  ON "workmesh_v1"."ChangeRequest" ("projectId", "decision", "createdAt");
CREATE INDEX "ChangeRequest_requirementId_createdAt_idx"
  ON "workmesh_v1"."ChangeRequest" ("requirementId", "createdAt");

CREATE TABLE "workmesh_v1"."ProjectChangePolicy" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "level" VARCHAR(4) NOT NULL,
  "slots" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectChangePolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectChangePolicy_projectId_level_key"
  ON "workmesh_v1"."ProjectChangePolicy" ("projectId", "level");

ALTER TABLE "workmesh_v1"."ChangeRecipient"
  ADD COLUMN "action" VARCHAR(16) NOT NULL DEFAULT 'ACK_ONLY',
  ADD COLUMN "dueAt" TIMESTAMPTZ(3),
  ADD COLUMN "escalatedAt" TIMESTAMPTZ(3);

ALTER TABLE "workmesh_v1"."Requirement"
  ADD COLUMN "frozenAt" TIMESTAMPTZ(3);
