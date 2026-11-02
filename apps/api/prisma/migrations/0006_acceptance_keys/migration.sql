-- M2: 任务覆盖的验收 key（加列，默认空数组）
ALTER TABLE "workmesh_v1"."Task"
  ADD COLUMN "acceptanceKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
