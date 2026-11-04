-- 就绪队列索引。
--
-- GET /v1/projects/:projectId/tasks/ready 是 Agent 按固定间隔轮询的端点：
--   WHERE "projectId" = $1 AND "executionStatus" = 'OPEN' AND "currentClaimId" IS NULL
--     AND "workStatus" = 'ACTIVE' AND instance.retiredAt IS NULL
--   ORDER BY "stepKey", "id"
-- Task 此前只有主键与两个唯一键，这条查询每次轮询都要全表扫再排序。
--
-- 三个索引分别覆盖三种可见范围：
--   ready_queue       人类/管理者看到的全部就绪任务（含排序列，就地有序）
--   ready_role        Agent 按凭据角色收敛（ownership=AGENT 或 roleId 过滤）
--   ready_responsible 人类按 responsibleUserId 与在任角色做 OR 过滤
CREATE INDEX "Task_ready_queue_idx" ON "workmesh_v1"."Task"("projectId", "executionStatus", "workStatus", "stepKey", "id");
CREATE INDEX "Task_ready_role_idx" ON "workmesh_v1"."Task"("projectId", "roleId", "executionStatus", "workStatus");
CREATE INDEX "Task_ready_responsible_idx" ON "workmesh_v1"."Task"("projectId", "responsibleUserId", "executionStatus", "workStatus");
