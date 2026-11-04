-- 代码证据去重键改为项目内唯一。
--
-- 原约束是全局 @@unique([evidenceFingerprint])，但指纹没含 projectId，而同一个 GitHub 仓库
-- 允许被两个 WorkMesh 项目登记（ProjectRepository 的唯一键是 (projectId, adapter, externalId)）。
-- 于是两个项目收到同一条评审时：先到者写入证据行，后到者在按指纹查重时命中对方的行并直接复用，
-- 该行的 projectId 属于先到者。后到项目随后按 projectId 过滤查询，永远查不到自己的证据，
-- 表现为「明明有他人批准，验收却一直 CODE_EVIDENCE_MISSING」。
--
-- 迁移后：指纹本身包含 projectId（应用层），唯一约束也收敛到项目内。
-- 存量行的指纹由旧算法算出、不含 projectId，不会与新指纹相同——旧行只作为历史保留，
-- 后续同一条评审会写入一条新行；去重失效只可能产生重复记录，不会产生错误归属。
DROP INDEX "workmesh_v1"."CodeReviewEvidence_evidenceFingerprint_key";
CREATE UNIQUE INDEX "CodeReviewEvidence_projectId_evidenceFingerprint_key" ON "workmesh_v1"."CodeReviewEvidence"("projectId", "evidenceFingerprint");
