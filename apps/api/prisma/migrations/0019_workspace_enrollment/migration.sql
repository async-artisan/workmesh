-- 0019: CLI 一次性接入码；只存哈希，绑定已发布 revision。
-- 可重入：表/索引/外键先查 catalog；存在则校验定义，不一致必须失败。

CREATE TABLE IF NOT EXISTS "workmesh_v1"."ProjectWorkspaceEnrollment" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "definitionRevisionId" UUID NOT NULL,
  "definitionDigest" CHAR(64) NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectWorkspaceEnrollment_pkey" PRIMARY KEY ("id")
);

DO $$
DECLARE
  rec record;
  v_type text;
  v_null text;
  v_def text;
  pk_cols text[];
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('id', 'uuid', 'NO', NULL),
    ('projectId', 'uuid', 'NO', NULL),
    ('createdByUserId', 'uuid', 'NO', NULL),
    ('definitionRevisionId', 'uuid', 'NO', NULL),
    ('definitionDigest', 'character', 'NO', NULL),
    ('codeHash', 'character', 'NO', NULL),
    ('version', 'integer', 'NO', '1'),
    ('expiresAt', 'timestamp with time zone', 'NO', NULL),
    ('consumedAt', 'timestamp with time zone', 'YES', NULL),
    ('revokedAt', 'timestamp with time zone', 'YES', NULL),
    ('createdAt', 'timestamp with time zone', 'NO', NULL)
  ) AS v(col, typ, nullable, def)
  LOOP
    SELECT data_type, is_nullable, coalesce(column_default, '')
      INTO v_type, v_null, v_def
    FROM information_schema.columns
    WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectWorkspaceEnrollment' AND column_name = rec.col;
    IF NOT FOUND THEN
      RAISE EXCEPTION '0019: missing column ProjectWorkspaceEnrollment.%', rec.col;
    END IF;
    IF v_type <> rec.typ THEN
      RAISE EXCEPTION '0019: ProjectWorkspaceEnrollment.% type mismatch: expected %, got %', rec.col, rec.typ, v_type;
    END IF;
    IF v_null <> rec.nullable THEN
      RAISE EXCEPTION '0019: ProjectWorkspaceEnrollment.% nullability mismatch: expected %, got %', rec.col, rec.nullable, v_null;
    END IF;
    IF rec.col = 'version' AND position('1' in v_def) = 0 THEN
      RAISE EXCEPTION '0019: version default must be 1, got %', v_def;
    END IF;
  END LOOP;
  SELECT array_agg(a.attname ORDER BY k.ord) INTO pk_cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceEnrollment' AND i.indisprimary;
  IF pk_cols IS DISTINCT FROM ARRAY['id'] THEN
    RAISE EXCEPTION '0019: ProjectWorkspaceEnrollment primary key mismatch: %; manual repair required', pk_cols;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectWorkspaceEnrollment'
      AND column_name IN ('code', 'plaintextCode', 'secret', 'token')
  ) THEN
    RAISE EXCEPTION '0019: plaintext code/secret column is not allowed';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectWorkspaceEnrollment_codeHash_key"
  ON "workmesh_v1"."ProjectWorkspaceEnrollment"("codeHash");
CREATE INDEX IF NOT EXISTS "ProjectWorkspaceEnrollment_projectId_createdAt_idx"
  ON "workmesh_v1"."ProjectWorkspaceEnrollment"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectWorkspaceEnrollment_expiresAt_idx"
  ON "workmesh_v1"."ProjectWorkspaceEnrollment"("expiresAt");

DO $$
DECLARE
  cols text[];
  is_unique boolean;
BEGIN
  SELECT array_agg(a.attname ORDER BY k.ord), bool_or(i.indisunique) INTO cols, is_unique
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceEnrollment'
    AND idx.relname = 'ProjectWorkspaceEnrollment_codeHash_key';
  IF cols IS DISTINCT FROM ARRAY['codeHash'] OR is_unique IS NOT TRUE THEN
    RAISE EXCEPTION '0019: ProjectWorkspaceEnrollment_codeHash_key definition mismatch: cols=%, unique=%', cols, is_unique;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord) INTO cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceEnrollment'
    AND idx.relname = 'ProjectWorkspaceEnrollment_projectId_createdAt_idx';
  IF cols IS DISTINCT FROM ARRAY['projectId', 'createdAt'] THEN
    RAISE EXCEPTION '0019: ProjectWorkspaceEnrollment_projectId_createdAt_idx definition mismatch: %', cols;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord) INTO cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceEnrollment'
    AND idx.relname = 'ProjectWorkspaceEnrollment_expiresAt_idx';
  IF cols IS DISTINCT FROM ARRAY['expiresAt'] THEN
    RAISE EXCEPTION '0019: ProjectWorkspaceEnrollment_expiresAt_idx definition mismatch: %', cols;
  END IF;
END $$;

DO $$
DECLARE
  rec record;
  def text;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('ProjectWorkspaceEnrollment_projectId_fkey', 'projectId', 'Project', 'id'),
    ('ProjectWorkspaceEnrollment_createdByUserId_fkey', 'createdByUserId', 'User', 'id'),
    ('ProjectWorkspaceEnrollment_definitionRevisionId_fkey', 'definitionRevisionId', 'ProjectWorkspaceDefinitionRevision', 'id')
  ) AS v(cname, col, reftable, refcol)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = '"workmesh_v1"."ProjectWorkspaceEnrollment"'::regclass
      AND c.conname = rec.cname AND c.contype = 'f';
    IF def IS NULL THEN
      EXECUTE format('ALTER TABLE "workmesh_v1"."ProjectWorkspaceEnrollment" ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "workmesh_v1".%I(%I) ON DELETE RESTRICT ON UPDATE CASCADE',
                     rec.cname, rec.col, rec.reftable, rec.refcol);
    ELSE
      IF position(rec.col in def) = 0 OR position(rec.reftable in def) = 0
         OR position(rec.refcol in def) = 0 OR position('ON DELETE RESTRICT' in def) = 0 THEN
        RAISE EXCEPTION '0019: % definition mismatch: %', rec.cname, def;
      END IF;
    END IF;
  END LOOP;
END $$;

-- 严格定义校验（在可重入补齐之后执行；任何定义不等价都必须失败）
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
    RAISE EXCEPTION '0019 strict: missing column %.%', p_table, p_column;
  END IF;
  IF v_type <> p_type OR lower(v_udt) <> lower(p_udt) OR v_null <> p_nullable
     OR v_len IS DISTINCT FROM p_char_len OR v_prec IS DISTINCT FROM p_precision THEN
    RAISE EXCEPTION '0019 strict: column %.% definition mismatch: type=%, udt=%, nullable=%, len=%, prec=%',
      p_table, p_column, v_type, v_udt, v_null, v_len, v_prec;
  END IF;
  IF p_default_kind = 'none' THEN
    IF v_has_def THEN
      RAISE EXCEPTION '0019 strict: column %.% must not have default: %', p_table, p_column, v_def;
    END IF;
  ELSE
    IF NOT v_has_def THEN
      RAISE EXCEPTION '0019 strict: column %.% missing default', p_table, p_column;
    END IF;
    v_norm := lower(regexp_replace(regexp_replace(v_def, '::[A-Za-z0-9_."]+', '', 'g'), '[[:space:]"()]', '', 'g'));
    v_norm := replace(v_norm, '''', '');
    IF p_default_kind = 'now' THEN
      IF v_norm NOT IN ('current_timestamp', 'now') THEN
        RAISE EXCEPTION '0019 strict: column %.% default is not now(): %', p_table, p_column, v_def;
      END IF;
    ELSIF p_default_kind = 'literal' THEN
      IF v_norm <> lower(p_default_value) THEN
        RAISE EXCEPTION '0019 strict: column %.% default mismatch: expected %, got %', p_table, p_column, p_default_value, v_def;
      END IF;
    ELSE
      RAISE EXCEPTION '0019 strict: unknown default kind %', p_default_kind;
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
    RAISE EXCEPTION '0019 strict: FK % missing', p_cname;
  END IF;
  IF NOT ref_ok OR del <> 'r' OR upd <> 'c'
     OR local_cols IS DISTINCT FROM ARRAY[p_column]
     OR ref_cols IS DISTINCT FROM ARRAY[p_ref_column] THEN
    RAISE EXCEPTION '0019 strict: FK % mismatch: ref_ok=%, delete=%, update=%, local=%, ref=%',
      p_cname, ref_ok, del, upd, local_cols, ref_cols;
  END IF;
END;
$fn$;

DO $$
BEGIN
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','id','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','projectId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','createdByUserId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','definitionRevisionId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','definitionDigest','character','bpchar','NO',64,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','codeHash','character','bpchar','NO',64,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','version','integer','int4','NO',NULL,NULL,'literal','1');
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','expiresAt','timestamp with time zone','timestamptz','NO',NULL,3,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','consumedAt','timestamp with time zone','timestamptz','YES',NULL,3,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','revokedAt','timestamp with time zone','timestamptz','YES',NULL,3,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceEnrollment','createdAt','timestamp with time zone','timestamptz','NO',NULL,3,'now',NULL);

  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceEnrollment','ProjectWorkspaceEnrollment_projectId_fkey','projectId','Project','id');
  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceEnrollment','ProjectWorkspaceEnrollment_createdByUserId_fkey','createdByUserId','User','id');
  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceEnrollment','ProjectWorkspaceEnrollment_definitionRevisionId_fkey','definitionRevisionId','ProjectWorkspaceDefinitionRevision','id');
END $$;

DROP FUNCTION IF EXISTS pg_temp.t1_assert_column(text,text,text,text,text,integer,integer,text,text);
DROP FUNCTION IF EXISTS pg_temp.t1_assert_fk(text,text,text,text,text);
