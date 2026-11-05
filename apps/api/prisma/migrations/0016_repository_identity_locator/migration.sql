-- 0016: 仓库稳定身份与 human-declared locator。
-- 可重入：先查 catalog；对象已存在时校验定义，不一致直接 RAISE EXCEPTION 并停止。
-- 不假设整个 migration 自动回滚；失败恢复见 RECOVERY.md。
-- 本文件不被 Prisma 之外的工具自动执行；precheck/postcheck/validate 为人工脚本。

-- 1) enums：存在则校验 label，缺失则创建；label 不一致必须失败。
DO $$
DECLARE labels text[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO labels
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'workmesh_v1' AND t.typname = 'RepositoryIdentityMode';
  IF labels IS NULL THEN
    EXECUTE 'CREATE TYPE "workmesh_v1"."RepositoryIdentityMode" AS ENUM (''DECLARED'', ''PROVIDER'')';
  ELSIF labels <> ARRAY['DECLARED', 'PROVIDER'] THEN
    RAISE EXCEPTION '0016: RepositoryIdentityMode labels mismatch: %', labels;
  END IF;

  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO labels
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'workmesh_v1' AND t.typname = 'RepositoryLocatorSource';
  IF labels IS NULL THEN
    EXECUTE 'CREATE TYPE "workmesh_v1"."RepositoryLocatorSource" AS ENUM (''HTTPS'', ''SSH'')';
  ELSIF labels <> ARRAY['HTTPS', 'SSH'] THEN
    RAISE EXCEPTION '0016: RepositoryLocatorSource labels mismatch: %', labels;
  END IF;
END $$;

-- 2) ProjectRepository：放宽 provider 字段并补身份/诊断列。
ALTER TABLE "workmesh_v1"."ProjectRepository"
  ALTER COLUMN "adapter" DROP NOT NULL,
  ALTER COLUMN "externalId" DROP NOT NULL;

ALTER TABLE "workmesh_v1"."ProjectRepository"
  ADD COLUMN IF NOT EXISTS "identityMode" "workmesh_v1"."RepositoryIdentityMode" NOT NULL DEFAULT 'PROVIDER',
  ADD COLUMN IF NOT EXISTS "lastVerifiedStatus" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "lastVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "lastVerifiedDigest" CHAR(64),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 已存在列的定义校验：类型/可空性/默认值不一致必须失败。
DO $$
DECLARE
  rec record;
  v_type text;
  v_null text;
  v_def text;
  v_udt text;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('identityMode', 'USER-DEFINED', 'NO', 'PROVIDER', 'repositoryidentitymode'),
    ('adapter', 'character varying', 'YES', NULL, NULL),
    ('externalId', 'character varying', 'YES', NULL, NULL),
    ('lastVerifiedStatus', 'character varying', 'YES', NULL, NULL),
    ('lastVerifiedAt', 'timestamp with time zone', 'YES', NULL, NULL),
    ('lastVerifiedDigest', 'character', 'YES', NULL, NULL),
    ('updatedAt', 'timestamp with time zone', 'NO', 'CURRENT_TIMESTAMP', NULL)
  ) AS v(col, typ, nullable, def, udt)
  LOOP
    SELECT data_type, is_nullable, coalesce(column_default, ''), coalesce(udt_name, '')
      INTO v_type, v_null, v_def, v_udt
    FROM information_schema.columns
    WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectRepository' AND column_name = rec.col;
    IF NOT FOUND THEN
      RAISE EXCEPTION '0016: missing column ProjectRepository.%', rec.col;
    END IF;
    IF v_type <> rec.typ THEN
      RAISE EXCEPTION '0016: ProjectRepository.% type mismatch: expected %, got %', rec.col, rec.typ, v_type;
    END IF;
    IF v_null <> rec.nullable THEN
      RAISE EXCEPTION '0016: ProjectRepository.% nullability mismatch: expected %, got %', rec.col, rec.nullable, v_null;
    END IF;
    IF rec.udt IS NOT NULL AND lower(v_udt) <> rec.udt THEN
      RAISE EXCEPTION '0016: ProjectRepository.% enum type mismatch: expected %, got %', rec.col, rec.udt, v_udt;
    END IF;
    IF rec.col = 'identityMode' AND position('PROVIDER' in v_def) = 0 THEN
      RAISE EXCEPTION '0016: identityMode default must be PROVIDER, got %', v_def;
    END IF;
    IF rec.col = 'updatedAt'
       AND position('now' in lower(v_def)) = 0
       AND position('current_timestamp' in lower(v_def)) = 0 THEN
      RAISE EXCEPTION '0016: updatedAt default must be now()/CURRENT_TIMESTAMP, got %', v_def;
    END IF;
  END LOOP;
END $$;

-- 3) identity CHECK：存在则校验定义，不存在则加 NOT VALID（新写入立即受检，旧行不扫描）。
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def
  FROM pg_constraint c
  WHERE c.conrelid = '"workmesh_v1"."ProjectRepository"'::regclass
    AND c.conname = 'ProjectRepository_identity_mode_ck'
    AND c.contype = 'c';
  IF def IS NULL THEN
    EXECUTE 'ALTER TABLE "workmesh_v1"."ProjectRepository" ADD CONSTRAINT "ProjectRepository_identity_mode_ck" CHECK (("identityMode" = ''PROVIDER'' AND "adapter" IS NOT NULL AND "externalId" IS NOT NULL) OR ("identityMode" = ''DECLARED'' AND "adapter" IS NULL AND "externalId" IS NULL)) NOT VALID';
  ELSE
    IF position('PROVIDER' in def) = 0 OR position('DECLARED' in def) = 0
       OR position('adapter' in def) = 0 OR position('externalId' in def) = 0 THEN
      RAISE EXCEPTION '0016: ProjectRepository_identity_mode_ck definition mismatch: %', def;
    END IF;
  END IF;
END $$;

-- 4) ProjectRepository 查询索引。
CREATE INDEX IF NOT EXISTS "ProjectRepository_projectId_archivedAt_idx"
  ON "workmesh_v1"."ProjectRepository"("projectId", "archivedAt");
DO $$
DECLARE cols text[];
BEGIN
  SELECT array_agg(a.attname ORDER BY k.ord) INTO cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectRepository'
    AND idx.relname = 'ProjectRepository_projectId_archivedAt_idx';
  IF cols IS DISTINCT FROM ARRAY['projectId', 'archivedAt'] THEN
    RAISE EXCEPTION '0016: ProjectRepository_projectId_archivedAt_idx definition mismatch: %', cols;
  END IF;
END $$;

-- 5) locator 表：CREATE IF NOT EXISTS 后校验列定义；定义不一致必须失败。
CREATE TABLE IF NOT EXISTS "workmesh_v1"."ProjectRepositoryLocator" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "repositoryId" UUID NOT NULL,
  "canonicalLocator" VARCHAR(500) NOT NULL,
  "source" "workmesh_v1"."RepositoryLocatorSource" NOT NULL,
  "declaredByUserId" UUID,
  "declaredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  "revokedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectRepositoryLocator_pkey" PRIMARY KEY ("id")
);

DO $$
DECLARE
  rec record;
  v_type text;
  v_null text;
  v_udt text;
  pk_cols text[];
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('id', 'uuid', 'NO', NULL),
    ('projectId', 'uuid', 'NO', NULL),
    ('repositoryId', 'uuid', 'NO', NULL),
    ('canonicalLocator', 'character varying', 'NO', NULL),
    ('source', 'USER-DEFINED', 'NO', 'repositorylocatorsource'),
    ('declaredByUserId', 'uuid', 'YES', NULL),
    ('declaredAt', 'timestamp with time zone', 'NO', NULL),
    ('revokedAt', 'timestamp with time zone', 'YES', NULL),
    ('revokedByUserId', 'uuid', 'YES', NULL),
    ('createdAt', 'timestamp with time zone', 'NO', NULL),
    ('updatedAt', 'timestamp with time zone', 'NO', NULL)
  ) AS v(col, typ, nullable, udt)
  LOOP
    SELECT data_type, is_nullable, coalesce(udt_name, '')
      INTO v_type, v_null, v_udt
    FROM information_schema.columns
    WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectRepositoryLocator' AND column_name = rec.col;
    IF NOT FOUND THEN
      RAISE EXCEPTION '0016: missing column ProjectRepositoryLocator.%', rec.col;
    END IF;
    IF v_type <> rec.typ THEN
      RAISE EXCEPTION '0016: ProjectRepositoryLocator.% type mismatch: expected %, got %', rec.col, rec.typ, v_type;
    END IF;
    IF v_null <> rec.nullable THEN
      RAISE EXCEPTION '0016: ProjectRepositoryLocator.% nullability mismatch: expected %, got %', rec.col, rec.nullable, v_null;
    END IF;
    IF rec.udt IS NOT NULL AND lower(v_udt) <> rec.udt THEN
      RAISE EXCEPTION '0016: ProjectRepositoryLocator.% enum type mismatch: expected %, got %', rec.col, rec.udt, v_udt;
    END IF;
  END LOOP;
  SELECT array_agg(a.attname ORDER BY k.ord) INTO pk_cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectRepositoryLocator' AND i.indisprimary;
  IF pk_cols IS DISTINCT FROM ARRAY['id'] THEN
    RAISE EXCEPTION '0016: ProjectRepositoryLocator primary key mismatch: %; manual repair required', pk_cols;
  END IF;
END $$;

-- 6) 活跃 locator 部分唯一索引 + 常规索引。
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectRepositoryLocator_active_key"
  ON "workmesh_v1"."ProjectRepositoryLocator"("projectId", "canonicalLocator")
  WHERE "revokedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "ProjectRepositoryLocator_projectId_canonicalLocator_idx"
  ON "workmesh_v1"."ProjectRepositoryLocator"("projectId", "canonicalLocator");
CREATE INDEX IF NOT EXISTS "ProjectRepositoryLocator_repositoryId_revokedAt_idx"
  ON "workmesh_v1"."ProjectRepositoryLocator"("repositoryId", "revokedAt");

DO $$
DECLARE
  cols text[];
  is_unique boolean;
  pred text;
BEGIN
  SELECT array_agg(a.attname ORDER BY k.ord), bool_or(i.indisunique), max(pg_get_expr(i.indpred, i.indrelid))
    INTO cols, is_unique, pred
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectRepositoryLocator'
    AND idx.relname = 'ProjectRepositoryLocator_active_key';
  IF cols IS DISTINCT FROM ARRAY['projectId', 'canonicalLocator'] OR is_unique IS NOT TRUE
     OR pred IS NULL OR position('revokedAt' in pred) = 0 THEN
    RAISE EXCEPTION '0016: ProjectRepositoryLocator_active_key definition mismatch: cols=%, unique=%, pred=%', cols, is_unique, pred;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord) INTO cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectRepositoryLocator'
    AND idx.relname = 'ProjectRepositoryLocator_projectId_canonicalLocator_idx';
  IF cols IS DISTINCT FROM ARRAY['projectId', 'canonicalLocator'] THEN
    RAISE EXCEPTION '0016: ProjectRepositoryLocator_projectId_canonicalLocator_idx definition mismatch: %', cols;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord) INTO cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectRepositoryLocator'
    AND idx.relname = 'ProjectRepositoryLocator_repositoryId_revokedAt_idx';
  IF cols IS DISTINCT FROM ARRAY['repositoryId', 'revokedAt'] THEN
    RAISE EXCEPTION '0016: ProjectRepositoryLocator_repositoryId_revokedAt_idx definition mismatch: %', cols;
  END IF;
END $$;

-- 7) locator 外键：不存在则补；存在则校验引用和删除策略。
DO $$
DECLARE
  rec record;
  def text;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('ProjectRepositoryLocator_projectId_fkey', 'projectId', 'Project', 'id'),
    ('ProjectRepositoryLocator_repositoryId_fkey', 'repositoryId', 'ProjectRepository', 'id'),
    ('ProjectRepositoryLocator_declaredByUserId_fkey', 'declaredByUserId', 'User', 'id'),
    ('ProjectRepositoryLocator_revokedByUserId_fkey', 'revokedByUserId', 'User', 'id')
  ) AS v(cname, col, reftable, refcol)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = '"workmesh_v1"."ProjectRepositoryLocator"'::regclass
      AND c.conname = rec.cname AND c.contype = 'f';
    IF def IS NULL THEN
      EXECUTE format('ALTER TABLE "workmesh_v1"."ProjectRepositoryLocator" ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "workmesh_v1".%I(%I) ON DELETE RESTRICT ON UPDATE CASCADE',
                     rec.cname, rec.col, rec.reftable, rec.refcol);
    ELSE
      IF position(rec.col in def) = 0 OR position(rec.reftable in def) = 0
         OR position(rec.refcol in def) = 0 OR position('ON DELETE RESTRICT' in def) = 0 THEN
        RAISE EXCEPTION '0016: % definition mismatch: %', rec.cname, def;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 严格定义校验（在可重入补齐之后执行；任何定义不等价都必须失败）
-- 使用 pg_temp 临时函数，只在当前数据库会话内存在，不产生持久 schema 对象。
-- ============================================================================
CREATE OR REPLACE FUNCTION pg_temp.t1_assert_column(
  p_table text, p_column text, p_type text, p_udt text, p_nullable text,
  p_char_len integer, p_precision integer, p_default_kind text, p_default_value text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_type text; v_udt text; v_null text; v_len integer; v_prec integer;
  v_has_def boolean; v_def text; v_norm text;
BEGIN
  SELECT c.data_type, c.udt_name, c.is_nullable, c.character_maximum_length,
         c.datetime_precision, c.column_default IS NOT NULL, coalesce(c.column_default, '')
    INTO v_type, v_udt, v_null, v_len, v_prec, v_has_def, v_def
  FROM information_schema.columns c
  WHERE c.table_schema = 'workmesh_v1' AND c.table_name = p_table AND c.column_name = p_column;
  IF NOT FOUND THEN
    RAISE EXCEPTION '0016 strict: missing column %.%', p_table, p_column;
  END IF;
  IF v_type <> p_type OR lower(v_udt) <> lower(p_udt) OR v_null <> p_nullable
     OR v_len IS DISTINCT FROM p_char_len OR v_prec IS DISTINCT FROM p_precision THEN
    RAISE EXCEPTION '0016 strict: column %.% definition mismatch: type=%, udt=%, nullable=%, len=%, prec=%',
      p_table, p_column, v_type, v_udt, v_null, v_len, v_prec;
  END IF;
  IF p_default_kind = 'none' THEN
    IF v_has_def THEN
      RAISE EXCEPTION '0016 strict: column %.% must not have default: %', p_table, p_column, v_def;
    END IF;
  ELSE
    IF NOT v_has_def THEN
      RAISE EXCEPTION '0016 strict: column %.% missing default', p_table, p_column;
    END IF;
    v_norm := lower(regexp_replace(regexp_replace(v_def, '::[A-Za-z0-9_."]+', '', 'g'), '[[:space:]"()]', '', 'g'));
    v_norm := replace(v_norm, '''', '');
    IF p_default_kind = 'now' THEN
      IF v_norm NOT IN ('current_timestamp', 'now') THEN
        RAISE EXCEPTION '0016 strict: column %.% default is not now(): %', p_table, p_column, v_def;
      END IF;
    ELSIF p_default_kind = 'literal' THEN
      IF v_norm <> lower(p_default_value) THEN
        RAISE EXCEPTION '0016 strict: column %.% default mismatch: expected %, got %', p_table, p_column, p_default_value, v_def;
      END IF;
    ELSE
      RAISE EXCEPTION '0016 strict: unknown default kind %', p_default_kind;
    END IF;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.t1_assert_fk(
  p_table text, p_cname text, p_column text, p_ref_table text, p_ref_column text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  ref_ok boolean; del text; upd text; local_cols text[]; ref_cols text[];
BEGIN
  SELECT c.confrelid = format('%I.%I', 'workmesh_v1', p_ref_table)::regclass,
         c.confdeltype::text, c.confupdtype::text,
         (SELECT array_agg(a.attname ORDER BY k.ord)
          FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum),
         (SELECT array_agg(a.attname ORDER BY k.ord)
          FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum)
    INTO ref_ok, del, upd, local_cols, ref_cols
  FROM pg_constraint c
  WHERE c.conrelid = format('%I.%I', 'workmesh_v1', p_table)::regclass
    AND c.conname = p_cname AND c.contype = 'f';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0016 strict: FK % missing', p_cname;
  END IF;
  IF NOT ref_ok OR del <> 'r' OR upd <> 'c'
     OR local_cols IS DISTINCT FROM ARRAY[p_column]
     OR ref_cols IS DISTINCT FROM ARRAY[p_ref_column] THEN
    RAISE EXCEPTION '0016 strict: FK % mismatch: ref_ok=%, delete=%, update=%, local=%, ref=%',
      p_cname, ref_ok, del, upd, local_cols, ref_cols;
  END IF;
END;
$fn$;

DO $$
DECLARE
  expr text; pred text; norm text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO expr
  FROM pg_constraint
  WHERE conrelid = '"workmesh_v1"."ProjectRepository"'::regclass
    AND conname = 'ProjectRepository_identity_mode_ck' AND contype = 'c';
  IF expr IS NULL THEN
    RAISE EXCEPTION '0016 strict: identity CHECK missing';
  END IF;
  norm := lower(regexp_replace(regexp_replace(expr, '::[A-Za-z0-9_."]+', '', 'g'), '[[:space:]"()]', '', 'g'));
  norm := replace(norm, '''', '');
  IF norm <> 'identitymode=providerandadapterisnotnullandexternalidisnotnulloridentitymode=declaredandadapterisnullandexternalidisnull' THEN
    RAISE EXCEPTION '0016 strict: identity CHECK logic mismatch: %', expr;
  END IF;

  SELECT pg_get_expr(i.indpred, i.indrelid) INTO pred
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'ProjectRepositoryLocator_active_key';
  IF pred IS NULL THEN
    RAISE EXCEPTION '0016 strict: partial index predicate missing';
  END IF;
  norm := lower(regexp_replace(pred, '[[:space:]"()]', '', 'g'));
  IF norm <> 'revokedatisnull' THEN
    RAISE EXCEPTION '0016 strict: partial index predicate mismatch: %', pred;
  END IF;
END $$;

DO $$
BEGIN
  PERFORM pg_temp.t1_assert_column('ProjectRepository','identityMode','USER-DEFINED','RepositoryIdentityMode','NO',NULL,NULL,'literal','PROVIDER');
  PERFORM pg_temp.t1_assert_column('ProjectRepository','adapter','character varying','varchar','YES',16,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepository','externalId','character varying','varchar','YES',120,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepository','lastVerifiedStatus','character varying','varchar','YES',32,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepository','lastVerifiedAt','timestamp with time zone','timestamptz','YES',NULL,3,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepository','lastVerifiedDigest','character','bpchar','YES',64,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepository','updatedAt','timestamp with time zone','timestamptz','NO',NULL,3,'now',NULL);

  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','id','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','projectId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','repositoryId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','canonicalLocator','character varying','varchar','NO',500,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','source','USER-DEFINED','RepositoryLocatorSource','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','declaredByUserId','uuid','uuid','YES',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','declaredAt','timestamp with time zone','timestamptz','NO',NULL,3,'now',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','revokedAt','timestamp with time zone','timestamptz','YES',NULL,3,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','revokedByUserId','uuid','uuid','YES',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','createdAt','timestamp with time zone','timestamptz','NO',NULL,3,'now',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectRepositoryLocator','updatedAt','timestamp with time zone','timestamptz','NO',NULL,3,'now',NULL);
END $$;

DO $$
BEGIN
  PERFORM pg_temp.t1_assert_fk('ProjectRepositoryLocator','ProjectRepositoryLocator_projectId_fkey','projectId','Project','id');
  PERFORM pg_temp.t1_assert_fk('ProjectRepositoryLocator','ProjectRepositoryLocator_repositoryId_fkey','repositoryId','ProjectRepository','id');
  PERFORM pg_temp.t1_assert_fk('ProjectRepositoryLocator','ProjectRepositoryLocator_declaredByUserId_fkey','declaredByUserId','User','id');
  PERFORM pg_temp.t1_assert_fk('ProjectRepositoryLocator','ProjectRepositoryLocator_revokedByUserId_fkey','revokedByUserId','User','id');
END $$;

DROP FUNCTION IF EXISTS pg_temp.t1_assert_column(text,text,text,text,text,integer,integer,text,text);
DROP FUNCTION IF EXISTS pg_temp.t1_assert_fk(text,text,text,text,text);
