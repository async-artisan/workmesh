ALTER TABLE "ai_runs" ADD COLUMN "completed_at" TIMESTAMP(3);
ALTER TABLE "ai_run_messages" ADD COLUMN "step" "AiRunStep";
