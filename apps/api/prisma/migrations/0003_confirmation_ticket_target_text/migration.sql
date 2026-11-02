-- 票据 targetId 按动作类型而异：项目成员与评审目标是 UUID，工作流是 workflowKey
-- （例如 standard），角色包是 packageId（例如 workmesh.role.product）。
-- 原来的 Uuid 列会让这两类动作在写入票据时直接报 "invalid character" 500，
-- 等于"发布工作流"和"安装角色包"在真实数据库上完全不可用。
ALTER TABLE "workmesh_v1"."ConfirmationTicket"
  ALTER COLUMN "targetId" TYPE VARCHAR(200) USING "targetId"::text;
