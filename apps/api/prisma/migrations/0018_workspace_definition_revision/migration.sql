-- 0018: 不可变定义 revision、revision-repository 关联，以及 definition.currentRevisionId 外键。
-- 可重入：表/索引/外键先查 catalog；存在则校验定义，不一致必须失败。
-- revision 的不可变性由应用层不提供更新路径保证；数据库不建触发器。

CREATE TABLE IF NOT EXISTS "workmesh_v1"."ProjectWorkspaceDefinitionRevision" (
  "id" UUID NOT NULL,
  "definitionId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "publishedByUserId" UUID,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectWorkspaceDefinitionRevision_pkey" PRIMARY KEY ("id")
);

DO $$
DECLARE
  rec record;
  v_type text;
  v_null text;
  pk_cols text[];
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('id', 'uuid', 'NO'),
    ('definitionId', 'uuid', 'NO'),
    ('projectId', 'uuid', 'NO'),
    ('revisionNo', 'integer', 'NO'),
    ('digest', 'character', 'NO'),
    ('payload', 'jsonb', 'NO'),
    ('publishedByUserId', 'uuid', 'YES'),
    ('publishedAt', 'timestamp with time zone', 'NO'),
    ('createdAt', 'timestamp with time zone', 'NO')
  ) AS v(col, typ, nullable)
  LOOP
    SELECT data_type, is_nullable INTO v_type, v_null
    FROM information_schema.columns
    WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectWorkspaceDefinitionRevision' AND column_name = rec.col;
    IF NOT FOUND THEN
      RAISE EXCEPTION '0018: missing column ProjectWorkspaceDefinitionRevision.%', rec.col;
    END IF;
    IF v_type <> rec.typ THEN
      RAISE EXCEPTION '0018: ProjectWorkspaceDefinitionRevision.% type mismatch: expected %, got %', rec.col, rec.typ, v_type;
    END IF;
    IF v_null <> rec.nullable THEN
      RAISE EXCEPTION '0018: ProjectWorkspaceDefinitionRevision.% nullability mismatch: expected %, got %', rec.col, rec.nullable, v_null;
    END IF;
  END LOOP;
  SELECT array_agg(a.attname ORDER BY k.ord) INTO pk_cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceDefinitionRevision' AND i.indisprimary;
  IF pk_cols IS DISTINCT FROM ARRAY['id'] THEN
    RAISE EXCEPTION '0018: ProjectWorkspaceDefinitionRevision primary key mismatch: %; manual repair required', pk_cols;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectWorkspaceDefinitionRevision_definitionId_revisionNo_key"
  ON "workmesh_v1"."ProjectWorkspaceDefinitionRevision"("definitionId", "revisionNo");
CREATE INDEX IF NOT EXISTS "ProjectWorkspaceDefinitionRevision_projectId_publishedAt_idx"
  ON "workmesh_v1"."ProjectWorkspaceDefinitionRevision"("projectId", "publishedAt");

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
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceDefinitionRevision'
    AND idx.relname = 'ProjectWorkspaceDefinitionRevision_definitionId_revisionNo_key';
  IF cols IS DISTINCT FROM ARRAY['definitionId', 'revisionNo'] OR is_unique IS NOT TRUE THEN
    RAISE EXCEPTION '0018: revision definitionId/revisionNo index mismatch: cols=%, unique=%', cols, is_unique;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord) INTO cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceDefinitionRevision'
    AND idx.relname = 'ProjectWorkspaceDefinitionRevision_projectId_publishedAt_idx';
  IF cols IS DISTINCT FROM ARRAY['projectId', 'publishedAt'] THEN
    RAISE EXCEPTION '0018: revision projectId/publishedAt index mismatch: %', cols;
  END IF;
END $$;

DO $$
DECLARE
  rec record;
  def text;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('ProjectWorkspaceDefinitionRevision_definitionId_fkey', 'definitionId', 'ProjectWorkspaceDefinition', 'id'),
    ('ProjectWorkspaceDefinitionRevision_projectId_fkey', 'projectId', 'Project', 'id'),
    ('ProjectWorkspaceDefinitionRevision_publishedByUserId_fkey', 'publishedByUserId', 'User', 'id')
  ) AS v(cname, col, reftable, refcol)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = '"workmesh_v1"."ProjectWorkspaceDefinitionRevision"'::regclass
      AND c.conname = rec.cname AND c.contype = 'f';
    IF def IS NULL THEN
      EXECUTE format('ALTER TABLE "workmesh_v1"."ProjectWorkspaceDefinitionRevision" ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "workmesh_v1".%I(%I) ON DELETE RESTRICT ON UPDATE CASCADE',
                     rec.cname, rec.col, rec.reftable, rec.refcol);
    ELSE
      IF position(rec.col in def) = 0 OR position(rec.reftable in def) = 0
         OR position(rec.refcol in def) = 0 OR position('ON DELETE RESTRICT' in def) = 0 THEN
        RAISE EXCEPTION '0018: % definition mismatch: %', rec.cname, def;
      END IF;
    END IF;
  END LOOP;
END $$;

-- definition.currentRevisionId -> revision(id)：0017 已建列/唯一索引，这里只补 FK。
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def
  FROM pg_constraint c
  WHERE c.conrelid = '"workmesh_v1"."ProjectWorkspaceDefinition"'::regclass
    AND c.conname = 'ProjectWorkspaceDefinition_currentRevisionId_fkey'
    AND c.contype = 'f';
  IF def IS NULL THEN
    EXECUTE 'ALTER TABLE "workmesh_v1"."ProjectWorkspaceDefinition" ADD CONSTRAINT "ProjectWorkspaceDefinition_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "workmesh_v1"."ProjectWorkspaceDefinitionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  ELSE
    IF position('currentRevisionId' in def) = 0
       OR position('ProjectWorkspaceDefinitionRevision' in def) = 0
       OR position('ON DELETE RESTRICT' in def) = 0 THEN
      RAISE EXCEPTION '0018: ProjectWorkspaceDefinition_currentRevisionId_fkey definition mismatch: %', def;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository" (
  "id" UUID NOT NULL,
  "revisionId" UUID NOT NULL,
  "repositoryId" UUID NOT NULL,
  "logicalKey" VARCHAR(80) NOT NULL,
  "suggestedPath" VARCHAR(500),
  "defaultRef" VARCHAR(200),
  "description" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectWorkspaceDefinitionRevisionRepository_pkey" PRIMARY KEY ("id")
);

DO $$
DECLARE
  rec record;
  v_type text;
  v_null text;
  pk_cols text[];
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('id', 'uuid', 'NO'),
    ('revisionId', 'uuid', 'NO'),
    ('repositoryId', 'uuid', 'NO'),
    ('logicalKey', 'character varying', 'NO'),
    ('suggestedPath', 'character varying', 'YES'),
    ('defaultRef', 'character varying', 'YES'),
    ('description', 'character varying', 'YES'),
    ('createdAt', 'timestamp with time zone', 'NO')
  ) AS v(col, typ, nullable)
  LOOP
    SELECT data_type, is_nullable INTO v_type, v_null
    FROM information_schema.columns
    WHERE table_schema = 'workmesh_v1' AND table_name = 'ProjectWorkspaceDefinitionRevisionRepository' AND column_name = rec.col;
    IF NOT FOUND THEN
      RAISE EXCEPTION '0018: missing column ProjectWorkspaceDefinitionRevisionRepository.%', rec.col;
    END IF;
    IF v_type <> rec.typ THEN
      RAISE EXCEPTION '0018: ProjectWorkspaceDefinitionRevisionRepository.% type mismatch: expected %, got %', rec.col, rec.typ, v_type;
    END IF;
    IF v_null <> rec.nullable THEN
      RAISE EXCEPTION '0018: ProjectWorkspaceDefinitionRevisionRepository.% nullability mismatch: expected %, got %', rec.col, rec.nullable, v_null;
    END IF;
  END LOOP;
  SELECT array_agg(a.attname ORDER BY k.ord) INTO pk_cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceDefinitionRevisionRepository' AND i.indisprimary;
  IF pk_cols IS DISTINCT FROM ARRAY['id'] THEN
    RAISE EXCEPTION '0018: ProjectWorkspaceDefinitionRevisionRepository primary key mismatch: %; manual repair required', pk_cols;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectWorkspaceDefinitionRevisionRepository_revisionId_logicalKey_key"
  ON "workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository"("revisionId", "logicalKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectWorkspaceDefinitionRevisionRepository_revisionId_repositoryId_key"
  ON "workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository"("revisionId", "repositoryId");
CREATE INDEX IF NOT EXISTS "ProjectWorkspaceDefinitionRevisionRepository_repositoryId_idx"
  ON "workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository"("repositoryId");

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
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceDefinitionRevisionRepository'
    AND idx.relname = 'ProjectWorkspaceDefinitionRevisionRepository_revisionId_logicalKey_key';
  IF cols IS DISTINCT FROM ARRAY['revisionId', 'logicalKey'] OR is_unique IS NOT TRUE THEN
    RAISE EXCEPTION '0018: join revisionId/logicalKey index mismatch: cols=%, unique=%', cols, is_unique;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord), bool_or(i.indisunique) INTO cols, is_unique
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceDefinitionRevisionRepository'
    AND idx.relname = 'ProjectWorkspaceDefinitionRevisionRepository_revisionId_repositoryId_key';
  IF cols IS DISTINCT FROM ARRAY['revisionId', 'repositoryId'] OR is_unique IS NOT TRUE THEN
    RAISE EXCEPTION '0018: join revisionId/repositoryId index mismatch: cols=%, unique=%', cols, is_unique;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord) INTO cols
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'workmesh_v1' AND tbl.relname = 'ProjectWorkspaceDefinitionRevisionRepository'
    AND idx.relname = 'ProjectWorkspaceDefinitionRevisionRepository_repositoryId_idx';
  IF cols IS DISTINCT FROM ARRAY['repositoryId'] THEN
    RAISE EXCEPTION '0018: join repositoryId index mismatch: %', cols;
  END IF;
END $$;

DO $$
DECLARE
  rec record;
  def text;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('ProjectWorkspaceDefinitionRevisionRepository_revisionId_fkey', 'revisionId', 'ProjectWorkspaceDefinitionRevision', 'id'),
    ('ProjectWorkspaceDefinitionRevisionRepository_repositoryId_fkey', 'repositoryId', 'ProjectRepository', 'id')
  ) AS v(cname, col, reftable, refcol)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = '"workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository"'::regclass
      AND c.conname = rec.cname AND c.contype = 'f';
    IF def IS NULL THEN
      EXECUTE format('ALTER TABLE "workmesh_v1"."ProjectWorkspaceDefinitionRevisionRepository" ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "workmesh_v1".%I(%I) ON DELETE RESTRICT ON UPDATE CASCADE',
                     rec.cname, rec.col, rec.reftable, rec.refcol);
    ELSE
      IF position(rec.col in def) = 0 OR position(rec.reftable in def) = 0
         OR position(rec.refcol in def) = 0 OR position('ON DELETE RESTRICT' in def) = 0 THEN
        RAISE EXCEPTION '0018: % definition mismatch: %', rec.cname, def;
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
    RAISE EXCEPTION '0018 strict: missing column %.%', p_table, p_column;
  END IF;
  IF v_type <> p_type OR lower(v_udt) <> lower(p_udt) OR v_null <> p_nullable
     OR v_len IS DISTINCT FROM p_char_len OR v_prec IS DISTINCT FROM p_precision THEN
    RAISE EXCEPTION '0018 strict: column %.% definition mismatch: type=%, udt=%, nullable=%, len=%, prec=%',
      p_table, p_column, v_type, v_udt, v_null, v_len, v_prec;
  END IF;
  IF p_default_kind = 'none' THEN
    IF v_has_def THEN
      RAISE EXCEPTION '0018 strict: column %.% must not have default: %', p_table, p_column, v_def;
    END IF;
  ELSE
    IF NOT v_has_def THEN
      RAISE EXCEPTION '0018 strict: column %.% missing default', p_table, p_column;
    END IF;
    v_norm := lower(regexp_replace(regexp_replace(v_def, '::[A-Za-z0-9_."]+', '', 'g'), '[[:space:]"()]', '', 'g'));
    v_norm := replace(v_norm, '''', '');
    IF p_default_kind = 'now' THEN
      IF v_norm NOT IN ('current_timestamp', 'now') THEN
        RAISE EXCEPTION '0018 strict: column %.% default is not now(): %', p_table, p_column, v_def;
      END IF;
    ELSIF p_default_kind = 'literal' THEN
      IF v_norm <> lower(p_default_value) THEN
        RAISE EXCEPTION '0018 strict: column %.% default mismatch: expected %, got %', p_table, p_column, p_default_value, v_def;
      END IF;
    ELSE
      RAISE EXCEPTION '0018 strict: unknown default kind %', p_default_kind;
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
    RAISE EXCEPTION '0018 strict: FK % missing', p_cname;
  END IF;
  IF NOT ref_ok OR del <> 'r' OR upd <> 'c'
     OR local_cols IS DISTINCT FROM ARRAY[p_column]
     OR ref_cols IS DISTINCT FROM ARRAY[p_ref_column] THEN
    RAISE EXCEPTION '0018 strict: FK % mismatch: ref_ok=%, delete=%, update=%, local=%, ref=%',
      p_cname, ref_ok, del, upd, local_cols, ref_cols;
  END IF;
END;
$fn$;

DO $$
BEGIN
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','id','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','definitionId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','projectId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','revisionNo','integer','int4','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','digest','character','bpchar','NO',64,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','payload','jsonb','jsonb','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','publishedByUserId','uuid','uuid','YES',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','publishedAt','timestamp with time zone','timestamptz','NO',NULL,3,'now',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevision','createdAt','timestamp with time zone','timestamptz','NO',NULL,3,'now',NULL);

  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevisionRepository','id','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevisionRepository','revisionId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevisionRepository','repositoryId','uuid','uuid','NO',NULL,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevisionRepository','logicalKey','character varying','varchar','NO',80,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevisionRepository','suggestedPath','character varying','varchar','YES',500,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevisionRepository','defaultRef','character varying','varchar','YES',200,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevisionRepository','description','character varying','varchar','YES',1000,NULL,'none',NULL);
  PERFORM pg_temp.t1_assert_column('ProjectWorkspaceDefinitionRevisionRepository','createdAt','timestamp with time zone','timestamptz','NO',NULL,3,'now',NULL);

  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceDefinitionRevision','ProjectWorkspaceDefinitionRevision_definitionId_fkey','definitionId','ProjectWorkspaceDefinition','id');
  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceDefinitionRevision','ProjectWorkspaceDefinitionRevision_projectId_fkey','projectId','Project','id');
  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceDefinitionRevision','ProjectWorkspaceDefinitionRevision_publishedByUserId_fkey','publishedByUserId','User','id');
  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceDefinition','ProjectWorkspaceDefinition_currentRevisionId_fkey','currentRevisionId','ProjectWorkspaceDefinitionRevision','id');

  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceDefinitionRevisionRepository','ProjectWorkspaceDefinitionRevisionRepository_revisionId_fkey','revisionId','ProjectWorkspaceDefinitionRevision','id');
  PERFORM pg_temp.t1_assert_fk('ProjectWorkspaceDefinitionRevisionRepository','ProjectWorkspaceDefinitionRevisionRepository_repositoryId_fkey','repositoryId','ProjectRepository','id');
END $$;

DROP FUNCTION IF EXISTS pg_temp.t1_assert_column(text,text,text,text,text,integer,integer,text,text);
DROP FUNCTION IF EXISTS pg_temp.t1_assert_fk(text,text,text,text,text);
