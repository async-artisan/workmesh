-- M4: 工作单元与依赖图（新表 + Task.unitId 可空）
CREATE TABLE "workmesh_v1"."Unit" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "key" VARCHAR(48) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "kind" VARCHAR(16) NOT NULL DEFAULT 'SERVICE',
  "repositoryId" UUID,
  "repoPath" VARCHAR(200),
  "ownerUserId" UUID,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Unit_projectId_key_key" ON "workmesh_v1"."Unit" ("projectId", "key");
CREATE UNIQUE INDEX "Unit_id_projectId_key" ON "workmesh_v1"."Unit" ("id", "projectId");
CREATE INDEX "Unit_projectId_status_idx" ON "workmesh_v1"."Unit" ("projectId", "status");
ALTER TABLE "workmesh_v1"."Unit"
  ADD CONSTRAINT "Unit_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES "workmesh_v1"."Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "workmesh_v1"."UnitDependency" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "fromUnitId" UUID NOT NULL,
  "toUnitId" UUID NOT NULL,
  "edgeKind" VARCHAR(16) NOT NULL DEFAULT 'CALLS',
  "protocol" VARCHAR(16),
  "contractDocumentId" UUID,
  "source" VARCHAR(16) NOT NULL DEFAULT 'DECLARED',
  "confidence" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  "evidence" VARCHAR(500),
  "verifiedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnitDependency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UnitDependency_projectId_fromUnitId_toUnitId_edgeKind_key"
  ON "workmesh_v1"."UnitDependency" ("projectId", "fromUnitId", "toUnitId", "edgeKind");
CREATE INDEX "UnitDependency_projectId_toUnitId_idx"
  ON "workmesh_v1"."UnitDependency" ("projectId", "toUnitId");
ALTER TABLE "workmesh_v1"."UnitDependency"
  ADD CONSTRAINT "UnitDependency_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES "workmesh_v1"."Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workmesh_v1"."UnitDependency"
  ADD CONSTRAINT "UnitDependency_fromUnitId_projectId_fkey" FOREIGN KEY ("fromUnitId", "projectId")
  REFERENCES "workmesh_v1"."Unit" ("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workmesh_v1"."UnitDependency"
  ADD CONSTRAINT "UnitDependency_toUnitId_projectId_fkey" FOREIGN KEY ("toUnitId", "projectId")
  REFERENCES "workmesh_v1"."Unit" ("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workmesh_v1"."Task" ADD COLUMN "unitId" UUID;
ALTER TABLE "workmesh_v1"."Task"
  ADD CONSTRAINT "Task_unitId_projectId_fkey" FOREIGN KEY ("unitId", "projectId")
  REFERENCES "workmesh_v1"."Unit" ("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
