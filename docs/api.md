# WorkMesh API

正式协议根路径为 `/api/v1`（Nest 全局前缀 `api` + 领域控制器前缀 `v1`）。除健康探针与 Webhook 外，所有接口都要求认证，并在服务端重新校验项目成员资格与知识库读权限。

## 通用约定

- 请求体为严格 JSON：拒绝浮点数、重复键、尾随内容和超限深度；DTO 开启 `whitelist` 与 `forbidNonWhitelisted`，未声明字段一律 400。
- 错误 envelope：`{ "error": { "code": "FORBIDDEN", "message": "...", "requestId": "..." } }`。
- 写接口必须携带 `Idempotency-Key`；同一键同语义重放返回原结果，同键异语义返回 `409 IDEMPOTENCY_CONFLICT`。
- 带版本的资源（需求、任务、评审请求、文档、附件集等）必须提交 `expectedVersion`，不一致返回 `409 VERSION_CONFLICT`。
- 需要二次确认的高风险动作（发布、撤销、批准决定、撤回、升级流程等）必须先用 `POST /api/v1/auth/confirmation-tickets` 取得一次性票据，并在请求中携带 `confirmation`；票据绑定主体、会话、动作、目标、版本与 payload 摘要，只能消费一次。

## 认证

- `GET /api/v1/auth/session` — 读取当前浏览器会话与 CSRF 状态。
- `POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`POST /api/v1/auth/logout` — 注册、登录与登出。
- `GET /api/v1/auth/me` — 当前主体。
- `GET /api/v1/auth/credentials`、`DELETE /api/v1/auth/credentials/:credentialId` — 凭据列表（仅 HUMAN）与吊销；AGENT 只能吊销自己当前使用的凭据，其余返回 404。
- `POST /api/v1/auth/cli-authorizations`、`POST /api/v1/auth/cli-authorizations/lookup`、`POST /api/v1/auth/cli-authorizations/:authorizationId/approve`、`POST /api/v1/auth/cli-authorizations/:authorizationId/deny`、`POST /api/v1/auth/cli-authorizations/poll` — CLI 设备授权（PKCE S256）。
- `POST /api/v1/auth/action-previews`、`POST /api/v1/auth/confirmation-tickets` — 动作预览与一次性确认票据。

人使用不透明 `WebSession` Cookie（`__Host-wm_session`，本地可显式切到无前缀名）加双值 CSRF（`__Host-wm_csrf`）；Agent 使用 `Authorization: Bearer wm_a1.<credentialId>.<secret>`，凭据只在创建时明文返回一次。只有 HUMAN Web 会话可以作出正式批准或撤销。

## 项目与知识

- `GET/POST /api/v1/projects`、`PUT/DELETE /api/v1/projects/:projectId`、`GET /api/v1/projects/:projectId/members`、`GET /api/v1/projects/:projectId/roles` — 项目、成员与业务角色；项目视图始终带 `defaultKnowledgeBaseId`。
- `PUT /api/v1/projects/:projectId/members/:userId/roles/:roleId`、`POST /api/v1/projects/:projectId/members/:userId/roles/:roleId/revoke` — 授权 OWNER/ADMIN 的 HUMAN 授予/撤销业务角色；票据绑定 `PROJECT_ROLE_ASSIGN`/`PROJECT_ROLE_UNASSIGN`、目标 `PROJECT_MEMBER`、`expectedVersion` 为成员版本。
- `GET/POST /api/v1/projects/:projectId/repositories`、`DELETE /api/v1/projects/:projectId/repositories/:repositoryId` — 代码仓库登记与归档；`adapter` 当前仅 `github`，`externalId` 使用厂商稳定 ID（GitHub 数值仓库 ID），改名不影响引用；重复登记返回 `409 REPOSITORY_EXISTS`，归档不物理删除，已归档仓库重新登记即恢复。
- `POST /api/v1/projects/:projectId/roles`、`PATCH /api/v1/projects/:projectId/roles/:roleId`、`DELETE /api/v1/projects/:projectId/roles/:roleId` — 自定义业务角色：`key` 创建后不可变；重命名需 `expectedVersion`，冲突返回 `409 ROLE_VERSION_CONFLICT`；停用用 `isActive`，有在任成员时返回 `409 ROLE_IN_USE`，停用不删除历史任务与工作流引用。
- `GET/POST /api/v1/projects/:projectId/units`、`PATCH /api/v1/projects/:projectId/units/:unitId` — 工作单元（`SERVICE` / `APP` / `DATASET` / `EXTERNAL`）；`key` 创建后不可变，重复返回 `409 UNIT_EXISTS`，停用用 `status=DEPRECATED`。
- `GET/POST /api/v1/projects/:projectId/unit-dependencies`、`DELETE /api/v1/projects/:projectId/unit-dependencies/:dependencyId` — 单元依赖边（`CALLS` / `READS` / `PUBLISHES` / `UPSTREAM`）；`source` 区分 `DECLARED` / `INFERRED` / `RUNTIME`，`DECLARED` 优先；自环返回 `422 SELF_DEPENDENCY`，重复返回 `409 DEPENDENCY_EXISTS`。
- `GET/POST /api/v1/projects/:projectId/change-requests`、`GET /api/v1/projects/:projectId/change-requests/:changeId`、`POST /api/v1/projects/:projectId/change-requests/:changeId/decisions` — 变更请求：等级由受影响面取最大值（`COPY`→L0、`SCOPE`/`ACCEPTANCE`→L1、`CONTRACT`→L2、`GOAL`→L3）；需求冻结时非 L3 变更落为 `DEFERRED`；通过后生成 `ChangeEvent` 与收件人（按等级 24–168h 到期）。提案允许成员，决定需 OWNER/ADMIN。
- `GET/PUT /api/v1/projects/:projectId/change-policy` — 变更策略：`freezeMode` 为 `BLOCK` / `WARN` / `ALLOW`，`levels` 只接受 L0–L3；未配置时使用默认策略（L0 product、L1 product+qa、L2 product+engineering-lead、L3 owner）。
- `GET/POST /api/v1/projects/:projectId/knowledge-bases` — 知识库分页列表（PROJECT 库默认可读，RESTRICTED 库按当前用户/活动角色 grant 过滤）与创建（OWNER/ADMIN，需幂等键）。
- `GET/PUT /api/v1/knowledge-bases/:knowledgeBaseId/access` — 读取/替换知识库 ACL；替换需 `expectedVersion`、`expectedAuthzVersion`、`KB_ACCESS_REPLACE` 票据与幂等键，撤销的 grant 保留历史。
- `GET /api/v1/knowledge-bases/:knowledgeBaseId/search?q` — 只在当前已发布修订中做标题/正文包含检索，返回摘要片段与稳定游标。
- `GET/POST /api/v1/projects/:projectId/documents`、`GET /api/v1/documents/:documentId`、`GET /api/v1/documents/:documentId/revisions`、`GET /api/v1/documents/:documentId/revisions/:revisionId`、`GET /api/v1/document-revisions/:revisionId/content` — 正式文档与修订（正文在发布前仅对有权限的成员可见）。
- `POST /api/v1/documents/:documentId/revisions`、`POST /api/v1/documents/:documentId/restore` — 提交新候选修订或从历史修订恢复；均生成评审请求，不改发布指针。二者与 `POST /projects/:projectId/documents` 一样**必须带 `Idempotency-Key`**（UUID）：同键同语义重放返回首次结果，同键异语义或异路由返回 `409 IDEMPOTENCY_CONFLICT`，缺失则 `400 IDEMPOTENCY_KEY_REQUIRED`。响应中的 `revision` 只携带引用（`id`/`sha256`/`seq`/`reviewRequestId` 等），正文仍只经由 `GET /document-revisions/:revisionId/content` 下发。
- `POST /api/v1/documents/:documentId/withdraw` — 撤回当前发布（追加 `WITHDRAW` 发布记录，清空发布指针）。

### PRD 的 Agent-first 发布路径

PRD 的生产入口在本地 Product Agent。Web 负责读取候选、查看正文与修订差异，并在需要人做决策时提交评审决定。PRD 不应由 Web 表单手写后直接推进普通流程，也不允许 Agent 直接发布。

权威路径只有一条：

```text
本地 Product Agent
  -> POST /projects/:projectId/documents（新 PRD，必须带 Idempotency-Key）
     或 POST /documents/:documentId/revisions（已有 PRD 的新版本）
  -> 服务端校验 Understanding 基线、deliveryScope 与 acceptance
  -> 创建 CANDIDATE + PRD_PUBLICATION ReviewRequest
  -> Web 上由具备权限的 HUMAN 查看、评论并批准/拒绝/要求修改
  -> 所有审批槽位 APPROVE 后，服务端事务发布 revision
  -> 更新 Requirement.currentPrdRevisionId
```

新建 PRD 候选请求必须包含 `requirementId`、`basisUnderstandingRevisionId`、`deliveryScope` 和至少一条 `acceptance`；对已有 PRD 追加 revision 时，`requirementId` 由服务端从 document 绑定关系派生，不应在 revision 请求体中重复传入。`basisUnderstandingRevisionId` 必须指向该需求当前已发布且已确认的 UNDERSTANDING revision；`deliveryScope.requiredOutputKinds` 必须包含 `IMPL`；验收条目的 `verification` 只能是 `TEST`、`INSPECTION` 或 `DEMO`。这些字段由服务端重新校验，客户端不能绕过。

新 PRD 的请求体示例：

```json
{
  "knowledgeBaseId": "<knowledge-base-id>",
  "kind": "PRD",
  "requirementId": "<requirement-id>",
  "title": "Checkout flow",
  "mimeType": "text/markdown; charset=utf-8",
  "bodyBase64": "<utf8 markdown encoded as base64>",
  "basisUnderstandingRevisionId": "<published-understanding-revision-id>",
  "deliveryScope": {
    "participatingRoleIds": ["<product-role-id>", "<engineering-role-id>"],
    "requiredOutputKinds": ["PRD", "IMPL"],
    "excludedRoles": []
  },
  "acceptance": [
    {
      "key": "checkout-completes",
      "text": "用户可以完成结算并看到订单确认",
      "verification": "TEST"
    }
  ]
}
```

`POST /api/v1/review-requests` 只用于已有候选主体需要单独建立评审请求的场景；PRD 创建和修订接口会自动生成 `PRD_PUBLICATION` 请求，避免客户端自行拼接审批槽位。历史的 `deliver --kind PRD` 只产生任务 ArtifactSet 时，不会更新正式 PRD 指针；Product Agent 应使用 candidate/document revision 路径提交正式 PRD 候选。

创建或追加 revision 的响应会返回 `reviewRequestId`。CLI 会把它放进 JSON 输出和本地 operation receipt，便于本地 Agent 将候选交给 Web 评审；该 ID 不代表已经批准或发布。

## 流程与角色包

- `GET/POST /api/v1/projects/:projectId/workflow-definitions`、`POST /api/v1/projects/:projectId/workflow-definitions/validate`、`POST /api/v1/projects/:projectId/workflow-definitions/:workflowKey/publish`、`GET /api/v1/workflow-definition-revisions/:revisionId` — 受限 DAG 定义校验与发布。
- `GET /api/v1/projects/:projectId/workflow-templates` — 内置流程模板（`standard`、`software-delivery`、`software-delivery-no-ui`）；返回可编辑草稿，仍需通过服务端 validate 和人工确认票据后发布。软件交付模板中的 `PUBLISHED_KNOWLEDGE` `knowledgeKey` 是待配置项，发布前必须替换为当前项目中已发布、未归档且绑定到步骤角色或全项目的知识文档 UUID。
- `POST /api/v1/requirements/:requirementId/workflow-instances`、`GET /api/v1/workflow-instances/:instanceId` — 为需求创建流程实例并读取步骤/任务状态。
- `GET/POST /api/v1/projects/:projectId/role-packages`、`GET /api/v1/projects/:projectId/role-packages/:packageId/versions/:version`、`GET /api/v1/projects/:projectId/role-packages/:packageId/versions/:version/resources/:resourceId` — 角色包清单与锁定版本资源。

服务端编译会检查每个步骤的 `outputKinds` 是否属于锁定角色包的候选输出，并为必需输入保留来源规则：`UPSTREAM_ARTIFACT` 必须指向祖先步骤声明的匹配工件类型，`PUBLISHED_KNOWLEDGE` 必须是当前可用且对该角色可见的项目知识文档，`EXTERNAL_INPUT` 必须提供 `externalKey` 和理由。任务快照创建时还会校验所需上游工件已通过验收。流程没有 `VERIFY` 步骤时，定义必须包含 `verificationExemption.reason` 和 `verificationExemption.auditRef`，并写入发布审计事件。

## 邀请链接

- `POST /api/v1/projects/:projectId/invitations` — 管理员生成邀请：`{ roleKeys, email?, expiresInHours?, expectedVersion, confirmation }`。角色按 key 解析成项目角色；票据绑定“项目 + 角色 id 集合 + 邮箱 + 有效期”，创建同时递增项目版本。响应里的 `token`（`wmi_…`）**只返回一次**，服务端只存 sha256。
- `GET /api/v1/projects/:projectId/invitations` — 管理员查看未接受、未撤销、未过期的邀请；列表只有邮箱、角色与过期时间，没有 token。
- `POST /api/v1/projects/:projectId/invitations/:invitationId/revoke` — 撤回未接受的邀请；已接受的邀请不受影响。
- `GET /api/v1/invitations/:token` — 公开解析（接受页用）：返回项目名、角色名、状态（`PENDING` / `ACCEPTED` / `EXPIRED` / `REVOKED`）与过期时间，不返回成员信息。
- `POST /api/v1/invitations/:token/accept` — 未注册用户接受：`{ password, name?, email? }`。邀请绑定邮箱时忽略 `email`；邮箱已注册返回 `409 EMAIL_ALREADY_REGISTERED`，应改为登录后走 join。成功后建号、自动登录、加入项目并授予角色（一次性，CAS 抢占）。
- `POST /api/v1/invitations/:token/join` — 已有账号登录后接受；绑定邮箱与当前账号不一致返回 `403 INVITATION_EMAIL_MISMATCH`。

邀请是唯一“不需要管理员在场即可授权角色”的路径，因此创建侧必须票据；接受侧不新增任何权限，只执行票据已授权的角色集合。

## 评审

- `POST /api/v1/review-requests` — 创建评审请求；只接受 `{ subject: { kind: 'DOCUMENT_REVISION' | 'TASK_ARTIFACT_SET', id }, expectedVersion, taskId? }`，kind、审批槽位与 subject 摘要全部服务端派生。同一 subject 已有 `OPEN` 请求时返回既有请求，需幂等键。
- `GET /api/v1/projects/:projectId/review-requests?assignedToMe&status&limit&cursor` — 项目评审待办分页；按主体可见范围、指派/业务角色与状态过滤。
- `GET /api/v1/review-requests/:reviewId` — 读取评审请求、槽位与已作决定。
- `POST /api/v1/review-requests/:reviewId/decisions` — 提交 `APPROVE` / `CHANGES_REQUESTED` / `REJECT`；仅当前槽位资格的 HUMAN，携带父请求 `expectedVersion`、一次性票据与幂等键。`CHANGES_REQUESTED` 与 `REJECT` 必须提供非空 `comment`，让本地 Agent 能据此生成下一版；`APPROVE` 的说明可选。全部槽位批准时在同一事务完成发布或任务验收效应。
- `POST /api/v1/review-requests/batch-decisions` — 批量决定：`{ decision, items: [{ reviewId, slotId, expectedVersion, comment?, confirmation }] }`；逐条独立校验与授权，最多 20 条，返回每条 `APPLIED` 或错误码，部分失败不回滚已成功条目。
- `POST /api/v1/review-decisions/:decisionId/revoke` — 撤销批准；`expectedVersion` 指所属评审请求版本。追加撤销记录，失效发布指针与受影响任务，不删除历史。
- `GET/POST /api/v1/projects/:projectId/delegations`、`DELETE .../delegations/:delegationId` — 槽位级临时委托；原责任人不变，`expiresAt` 必填且必须晚于当前时间；同一槽位同时只允许一条有效委托（`409 DELEGATION_EXISTS`）；被委托人在有效期内可代为决定。
- `GET /api/v1/projects/:projectId/approvals/overdue` — 到期未决定的槽位视图（按 `dueAt` 升序）；只读，不自动批准。
- `POST /api/v1/projects/:projectId/approvals/escalate` — 把到期未决定且未升级的槽位标记为已升级（`escalatedAt`），返回标记数量；不自动批准。

## 任务与工件

- `GET /api/v1/tasks/:taskId`、`POST /api/v1/tasks/:taskId/claims`、`POST /api/v1/tasks/:taskId/release`、`POST /api/v1/tasks/:taskId/work-status` — 认领/释放与工作状态；认领按任务当前代次串行，客户端不声明版本。
- `GET /api/v1/projects/:projectId/tasks/ready?roleId&limit&cursor` — 就绪任务分页：`OPEN`、无活动认领、`ACTIVE`，且同实例同步骤的前序依赖全部 `DONE`。Agent 只能看本凭据角色，HUMAN 按责任人与活动角色范围过滤。
- `POST /api/v1/tasks/:taskId/artifact-sets`、`GET /api/v1/artifact-sets/:id` — 交付并读取工件集（只接受真实字节或完整代码引用，交付时复核基线）。

工件 `checks[]` 的旧格式仍兼容；未提供 `source` 的检查会按 `AGENT_REPORTED` 保存。若引用外部 CI 或测试报告，可提交 `source: "EXTERNAL_REFERENCE"` 与 `evidence: { kind: "CI_RUN" | "TEST_REPORT", provider, url, runId?, commitSha? }`。外部链接必须是 HTTPS，若声明 `commitSha` 则须与所交代码引用一致。该字段仅提供给评审人复核的链接，WorkMesh 当前不抓取或验证 CI 结果；Agent 不能提交 `verified` 标记。代码评审状态仍由独立代码托管证据决定。

- `POST /api/v1/tasks/:taskId/context-snapshots`、`GET /api/v1/context-snapshots/:snapshotId`、`GET /api/v1/context-snapshots/:snapshotId/resources/:refId` — 确定性上下文快照与受限资源读取。
- `GET /api/v1/projects/:projectId/board` — 项目看板聚合。
- `GET /api/v1/projects/:projectId/metrics/flow?days=30` — 流程度量：两端时长（首次认领、首次交付、批准）、端到端 lead time、WIP 与变更确认率；只从既有时间戳派生，口径见 [docs/metrics.md](metrics.md)。
- `GET /api/v1/change-recipients`、`POST /api/v1/change-recipients/:id/ack` — 变更传播收件人与确认。

## 代码证据

- **`IMPL` 工件必须绑定代码证据才能被验收。** 交付 `kind: 'IMPL'` 的工件集时，服务端会按工作流为该步骤派生 `CODE_REVIEW_EVIDENCE` 系统闸门；若工件没有通过下面的 code-evidence 接口绑定到具体提交，评审决定会以 `422 CODE_EVIDENCE_MISSING`（`CODE_REVIEW_EVIDENCE_MISSING`）拒绝。也就是说：`IMPL` 不能只交托管字节，必须能被人类按 commit 复核。非代码类工件（`DESIGN` / `CASES` / `RELEASE` / `PRD`）不受此约束。
- `POST /api/v1/integrations/github/webhooks` — GitHub Webhook（HMAC-SHA256 签名校验，免会话认证）。
- `POST /api/v1/integrations/github/code-evidence/prepare`、`POST /api/v1/integrations/github/code-evidence/:ticketId/use` — 准备提交级代码证据并把证据绑定到工件集。仓库身份使用稳定的数值仓库 ID，owner/name 仅作展示；两次读取之间 head/状态变化返回 `UPSTREAM_CHANGED`。

## 操作收据

- `GET /api/v1/operation-receipts/:operationKey?projectId=` — 只读查询已提交操作的收据（`requestDigest`、`resultRefs`、`method`、`route`、`committedAt`）；只允许原主体读取，HUMAN 可代读自己 Agent 的收据，其他主体/跨项目/未提交一律 404，视图不含响应正文，也不自动重放。

## 运维

- `GET /api/health` — 健康探针（不属于 `/api/v1` 协议面）。
- `GET /api/metrics` — 请求计数、失败数与平均延迟。
- Swagger 在 API 启动后于 `/api/docs` 可读。
