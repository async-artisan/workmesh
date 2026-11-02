-- 超时升级：记录已升级时间，不自动批准
ALTER TABLE "workmesh_v1"."ApprovalSlot"
  ADD COLUMN "escalatedAt" TIMESTAMPTZ(3);
