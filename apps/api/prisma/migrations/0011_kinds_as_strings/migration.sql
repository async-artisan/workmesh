-- M5: 文档 kind 与评审 kind 改为字符串，枚举值保留为存量数据
ALTER TABLE "workmesh_v1"."KnowledgeDocument"
  ALTER COLUMN "kind" TYPE VARCHAR(48) USING "kind"::text;

ALTER TABLE "workmesh_v1"."ReviewRequest"
  ALTER COLUMN "kind" TYPE VARCHAR(48) USING "kind"::text;

DROP TYPE "workmesh_v1"."DocumentKind";
DROP TYPE "workmesh_v1"."ReviewKind";
