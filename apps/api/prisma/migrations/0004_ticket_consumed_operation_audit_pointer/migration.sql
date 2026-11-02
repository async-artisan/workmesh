-- 票据的 consumedOperationId 是审计指针，指向消费它的幂等操作。
-- 票据消费发生在 IdempotentOperation 行写入之前，因此外键会让所有
-- "票据门禁"动作（发布流程、装角色包、授权、评审决定、撤回）在真实数据库上
-- 以 23503 失败；内存 fake 不校验外键，所以单测一直没暴露。
-- 同一事务已保证两条记录同生共死，这里去掉外键即可，列本身保留。
ALTER TABLE "workmesh_v1"."ConfirmationTicket"
  DROP CONSTRAINT IF EXISTS "ConfirmationTicket_consumedOperationId_fkey";
