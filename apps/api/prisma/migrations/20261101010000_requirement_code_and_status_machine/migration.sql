-- 需求编号：项目内自增 seq + 派生展示编号 code（<PROJECT_KEY>-REQ-<seq>）

ALTER TABLE "requirements" ADD COLUMN "seq" INTEGER;
ALTER TABLE "requirements" ADD COLUMN "code" TEXT;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "project_id" ORDER BY "created_at", "id") AS rn
  FROM "requirements"
)
UPDATE "requirements" AS r
SET "seq" = ranked.rn
FROM ranked
WHERE r."id" = ranked."id";

UPDATE "requirements" AS r
SET "code" = p."key" || '-REQ-' || r."seq"
FROM "projects" AS p
WHERE p."id" = r."project_id";

ALTER TABLE "requirements" ALTER COLUMN "seq" SET NOT NULL;
ALTER TABLE "requirements" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "requirements_project_id_seq_key" ON "requirements"("project_id", "seq");
CREATE UNIQUE INDEX "requirements_project_id_code_key" ON "requirements"("project_id", "code");

-- 状态机：旧枚举（需求评审视角）→ 新枚举（工件流水视角）
--   DRAFT / IN_REVIEW -> DRAFT      需求尚未定稿
--   APPROVED          -> PRD_READY  需求已批准，PRD 就绪
--   IN_PROGRESS       -> IN_DEV     已进入实现
--   DONE              -> RELEASED   已交付
--   ARCHIVED          -> ARCHIVED   归档语义保留

ALTER TABLE "requirements" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "requirements" ALTER COLUMN "status" TYPE TEXT;

UPDATE "requirements"
SET "status" = CASE "status"
  WHEN 'IN_REVIEW' THEN 'DRAFT'
  WHEN 'APPROVED' THEN 'PRD_READY'
  WHEN 'IN_PROGRESS' THEN 'IN_DEV'
  WHEN 'DONE' THEN 'RELEASED'
  ELSE "status"
END;

DROP TYPE "RequirementStatus";

CREATE TYPE "RequirementStatus" AS ENUM (
  'DRAFT',
  'PRD_READY',
  'DESIGN_READY',
  'IN_DEV',
  'CODE_LINKED',
  'TESTED',
  'RELEASED',
  'ARCHIVED'
);

ALTER TABLE "requirements"
  ALTER COLUMN "status" TYPE "RequirementStatus" USING ("status"::"RequirementStatus");
ALTER TABLE "requirements" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
