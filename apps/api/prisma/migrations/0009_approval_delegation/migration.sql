-- M3 补充：槽位超时与委托
ALTER TABLE "workmesh_v1"."ApprovalSlot" ADD COLUMN "dueAt" TIMESTAMPTZ(3);

CREATE TABLE "workmesh_v1"."ApprovalSlotDelegation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "slotId" UUID NOT NULL,
  "delegatorUserId" UUID NOT NULL,
  "delegateUserId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalSlotDelegation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApprovalSlotDelegation_slotId_revokedAt_idx"
  ON "workmesh_v1"."ApprovalSlotDelegation" ("slotId", "revokedAt");
CREATE INDEX "ApprovalSlotDelegation_delegateUserId_expiresAt_idx"
  ON "workmesh_v1"."ApprovalSlotDelegation" ("delegateUserId", "expiresAt");
