-- 移除 AI 产品发现（Runs）相关表：平台不再内置 AI 对话流程

ALTER TABLE "requirements" DROP CONSTRAINT IF EXISTS "requirements_ai_run_id_fkey";
ALTER TABLE "requirements" DROP COLUMN IF EXISTS "ai_run_id";

DROP TABLE IF EXISTS "ai_run_messages";
DROP TABLE IF EXISTS "ai_runs";
