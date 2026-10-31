CREATE TYPE "AiRunType" AS ENUM ('PRODUCT_DISCOVERY');

CREATE TYPE "AiRunStatus" AS ENUM (
    'ACTIVE',
    'PROCESSING',
    'PAUSED',
    'WAITING_CONFIRMATION',
    'COMPLETED',
    'CANCELLED',
    'FAILED'
);

CREATE TYPE "AiRunStep" AS ENUM (
    'BACKGROUND_GOAL',
    'USERS_SCENARIOS',
    'USER_STORIES_FLOWS',
    'ACCEPTANCE_CRITERIA',
    'WAITING_CONFIRMATION'
);

CREATE TYPE "AiRunMessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT');

CREATE TYPE "AiRunEventType" AS ENUM (
    'RUN_STARTED',
    'RUN_PROCESSING',
    'MESSAGE_CREATED',
    'STEP_CHANGED',
    'DRAFT_UPDATED',
    'RUN_WAITING_CONFIRMATION',
    'RUN_COMPLETED',
    'RUN_PAUSED',
    'RUN_RESUMED',
    'RUN_CANCELLED',
    'RUN_FAILED',
    'HEARTBEAT'
);

CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "type" "AiRunType" NOT NULL DEFAULT 'PRODUCT_DISCOVERY',
    "status" "AiRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "step" "AiRunStep" NOT NULL DEFAULT 'BACKGROUND_GOAL',
    "event_sequence" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_run_messages" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" "AiRunMessageRole" NOT NULL,
    "event_type" "AiRunEventType" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_run_messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "requirements" ADD COLUMN "ai_run_id" TEXT;

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

CREATE INDEX "ai_runs_project_id_status_updated_at_idx"
    ON "ai_runs"("project_id", "status", "updated_at");

CREATE INDEX "ai_runs_created_by_id_updated_at_idx"
    ON "ai_runs"("created_by_id", "updated_at");

CREATE UNIQUE INDEX "ai_run_messages_run_id_sequence_key"
    ON "ai_run_messages"("run_id", "sequence");

CREATE INDEX "ai_run_messages_run_id_created_at_idx"
    ON "ai_run_messages"("run_id", "created_at");

CREATE UNIQUE INDEX "requirements_ai_run_id_key" ON "requirements"("ai_run_id");

ALTER TABLE "ai_runs"
    ADD CONSTRAINT "ai_runs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_runs"
    ADD CONSTRAINT "ai_runs_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_run_messages"
    ADD CONSTRAINT "ai_run_messages_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "requirements"
    ADD CONSTRAINT "requirements_ai_run_id_fkey"
    FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
