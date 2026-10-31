CREATE TYPE "RoleType" AS ENUM ('PRODUCT', 'UI', 'FRONTEND', 'BACKEND', 'QA', 'OPS');

CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'REVIEW_PENDING', 'DONE');

CREATE TABLE "tasks" (
  "id" TEXT NOT NULL,
  "requirement_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "role" "RoleType" NOT NULL,
  "assignee_type" TEXT NOT NULL DEFAULT 'HUMAN',
  "assignee_id" TEXT,
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "acceptance" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_dependencies" (
  "id" TEXT NOT NULL,
  "from_id" TEXT NOT NULL,
  "to_id" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'blocks',
  CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tasks_requirement_id_seq_key" ON "tasks"("requirement_id", "seq");
CREATE UNIQUE INDEX "tasks_requirement_id_code_key" ON "tasks"("requirement_id", "code");
CREATE INDEX "tasks_requirement_id_status_idx" ON "tasks"("requirement_id", "status");
CREATE INDEX "tasks_role_status_idx" ON "tasks"("role", "status");
CREATE UNIQUE INDEX "task_dependencies_from_id_to_id_type_key" ON "task_dependencies"("from_id", "to_id", "type");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_requirement_id_fkey"
  FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_from_id_fkey"
  FOREIGN KEY ("from_id") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_to_id_fkey"
  FOREIGN KEY ("to_id") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
