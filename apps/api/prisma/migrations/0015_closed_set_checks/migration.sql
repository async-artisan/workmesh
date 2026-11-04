-- 给「闭合集合」的字符串列补数据库级校验。
--
-- 0011 把文档 kind 与评审 kind 从原生 enum 改成 VARCHAR，换来了「模板可注册」的扩展性，
-- 代价是丢掉了数据库层校验：错拼的值（decision='ACCEPTD'）能写进去，随后因为 CAS 只匹配
-- PENDING/DEFERRED 而永远无法被决定，成为一条没有出口的脏数据。
--
-- 这里只给**值集合确实封闭**的三列加约束。刻意用 NOT VALID：
-- 约束对新的 INSERT/UPDATE 立即生效，但不扫描存量数据。这样迁移不会因为历史脏行而失败，
-- 存量问题留待单独清理后再 VALIDATE CONSTRAINT，而不是把整个迁移堵死。
--
-- AuditEvent.outcome / Unit.kind / scopeKind 等列暂不加：它们的取值集合仍需确认，
-- 猜一个集合去约束审计表，风险高于收益。
ALTER TABLE "workmesh_v1"."ChangeRequest" ADD CONSTRAINT "ChangeRequest_level_check" CHECK ("level" IN ('L0', 'L1', 'L2', 'L3')) NOT VALID;
ALTER TABLE "workmesh_v1"."ChangeRequest" ADD CONSTRAINT "ChangeRequest_decision_check" CHECK ("decision" IN ('PENDING', 'DEFERRED', 'ACCEPTED', 'REJECTED')) NOT VALID;
ALTER TABLE "workmesh_v1"."ChangeRecipient" ADD CONSTRAINT "ChangeRecipient_action_check" CHECK ("action" IN ('ACK_ONLY')) NOT VALID;
