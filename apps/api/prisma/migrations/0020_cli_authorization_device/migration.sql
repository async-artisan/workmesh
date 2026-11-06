-- 0020: CLI 授权请求记录设备元数据（主机名/平台/客户端版本/来源 IP），
-- 供用户中心「Agent 凭据」列表区分凭据属于哪台机器。
-- 仅新增可空列：老客户端不发送 x-workmesh-* 头部时这些列为 NULL，读写均向后兼容。
-- 可重入：列先查 catalog；存在则严格校验定义，不一致必须失败。
ALTER TABLE "workmesh_v1"."CliAuthorizationRequest"
  ADD COLUMN IF NOT EXISTS "deviceName" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "devicePlatform" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "clientVersion" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "clientIp" VARCHAR(64);

DO $$
DECLARE
  rec record;
  v_type text;
  v_null text;
  v_len integer;
  v_has_def boolean;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    ('deviceName', 'character varying', 'YES', 80),
    ('devicePlatform', 'character varying', 'YES', 60),
    ('clientVersion', 'character varying', 'YES', 30),
    ('clientIp', 'character varying', 'YES', 64)
  ) AS v(col, typ, nullable, maxlen)
  LOOP
    SELECT data_type, is_nullable, character_maximum_length, column_default IS NOT NULL
      INTO v_type, v_null, v_len, v_has_def
    FROM information_schema.columns
    WHERE table_schema = 'workmesh_v1' AND table_name = 'CliAuthorizationRequest' AND column_name = rec.col;
    IF NOT FOUND THEN
      RAISE EXCEPTION '0020: missing column CliAuthorizationRequest.%', rec.col;
    END IF;
    IF v_type <> rec.typ OR v_null <> rec.nullable OR v_len IS DISTINCT FROM rec.maxlen THEN
      RAISE EXCEPTION '0020: CliAuthorizationRequest.% definition mismatch: type=%, nullable=%, len=%',
        rec.col, v_type, v_null, v_len;
    END IF;
    IF v_has_def THEN
      RAISE EXCEPTION '0020: CliAuthorizationRequest.% must not have a default', rec.col;
    END IF;
  END LOOP;
END $$;
