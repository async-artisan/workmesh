# WorkMesh API

正式协议根路径为 `/api/v1`（Nest 全局前缀 `api` + 领域控制器前缀 `v1`）。除健康探针与 Webhook 外，所有接口都要求认证，并在服务端重新校验项目成员资格与知识库读权限。

## 健康探针

两个端点都在 `/api` 前缀下、没有 `v1` 段（`AppController` 不属于 v1 领域控制器），且不需要认证，语义严格分开（参照 Kubernetes 的 liveness/readiness）：

- `GET /api/health` — **liveness**。进程活着即返回 `{status:"ok"}`，**故意不检查数据库**：liveness 失败会导致重启，把数据库检查放进来会让数据库抖动演变成连环重启。
- `GET /api/health/ready` — **readiness**。执行 `SELECT 1` 并确认 `workmesh_v1._prisma_migrations` 已应用至少一项迁移，成功返回 `{ok,database:{reachable,appliedMigrations},checkedAt}`；失败返回 `503 DEPENDENCY_UNAVAILABLE`，`details.reason` 为 `CONNECT_FAILED` / `SCHEMA_NOT_MIGRATED` / `TIMEOUT` 之一。

失败原因只给枚举值，不回显底层驱动文本——该端点未认证，Prisma 的连接错误会带主机名与库名。运维侧以 `/health/ready` 判定「能用」，`box doctor` 与 `box dev` 已切到该口径。

## 通用约定

- 请求体为严格 JSON：拒绝浮点数、重复键、尾随内容和超限深度；DTO 开启 `whitelist` 与 `forbidNonWhitelisted`，未声明字段一律 400。
- 体积上限（超出均返回 `413 PAYLOAD_TOO_LARGE`，`details.limitBytes` 给出该层实际生效的上限）：
  - **JSON 请求体 16MiB**，由传输层在路由之前判定。注意 Base64 约 4/3 膨胀，所以单个文档实际可传约 12MiB 原始字节。
  - **单个文档 / 单件 HOSTED 正文 10MiB**（按解码后的原始字节算），覆盖 PRD 候选的 `bodyBase64`、角色包资源正文与 HOSTED 工件正文；**单次交付所有 HOSTED 正文总和同样 10MiB**。这一层必须解码后校验——传输层只看得到 JSON 字符串长度，看不到解码后字节。
- 错误 envelope：`{ "error": { "code": "FORBIDDEN", "message": "...", "requestId": "..." } }`。
- 写接口必须携带 `Idempotency-Key`；同一键同语义重放返回原结果，同键异语义返回 `409 IDEMPOTENCY_CONFLICT`。
- 带版本的资源（需求、任务、评审请求、文档、附件集等）必须提交 `expectedVersion`，不一致返回 `409 VERSION_CONFLICT`。
- **归档项目只读**：`archivedAt` 非空的项目，所有写入返回 `409 PROJECT_ARCHIVED`（`details.archivedAt`），读取不受影响。归档与解除归档本身不受此限制，否则归档后再也解不开。实现上由 `resolveProjectContext(..., 'write' \| 'read')` 的第二参数强制声明访问意图——该参数是必填的，漏声明即编译失败，避免「只有某几个模块记得检查归档」。
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
- `GET/POST /api/v1/projects/:projectId/change-requests`、`GET /api/v1/projects/:projectId/change-requests/:changeId`、`POST /api/v1/projects/:projectId/change-requests/:changeId/decisions` — 变更请求：等级由受影响面取最大值（`COPY`→L0、`SCOPE`/`ACCEPTANCE`→L1、`CONTRACT`→L2、`GOAL`→L3）；需求冻结时非 L3 变更落为 `DEFERRED`；通过后生成 `ChangeEvent` 与收件人（按等级 24–168h 到期）。提案允许成员，决定需 OWNER/ADMIN；**提案人不得决定自己的变更**（`403 CHANGE_SELF_DECISION_FORBIDDEN`），且必须持有该等级在 `change-policy.levels` 里配置的某个活动业务角色（`403 CHANGE_LEVEL_APPROVER_REQUIRED`，`details` 给出 `level` / `requiredRoleKeys` / `heldRoleKeys`）。项目 OWNER 是最高权威，任何等级都可决定。
- `GET/PUT /api/v1/projects/:projectId/change-policy` — 变更策略：`freezeMode` 为 `BLOCK` / `WARN` / `ALLOW`，`levels` 只接受 L0–L3；未配置时使用默认策略（L0 product、L1 product+qa、L2 product+engineering-lead、L3 owner）。
- `GET/POST /api/v1/projects/:projectId/knowledge-bases` — 知识库分页列表（PROJECT 库默认可读，RESTRICTED 库按当前用户/活动角色 grant 过滤）与创建（OWNER/ADMIN，需幂等键）。
- `GET/PUT /api/v1/knowledge-bases/:knowledgeBaseId/access` — 读取/替换知识库 ACL；替换需 `expectedVersion`、`expectedAuthzVersion`、`KB_ACCESS_REPLACE` 票据与幂等键，撤销的 grant 保留历史。
- `GET /api/v1/knowledge-bases/:knowledgeBaseId/search?q` — 只在当前已发布修订中做标题/正文包含检索，返回摘要片段与稳定游标。
- `GET/POST /api/v1/projects/:projectId/documents`、`GET /api/v1/documents/:documentId`、`GET /api/v1/documents/:documentId/revisions`、`GET /api/v1/documents/:documentId/revisions/:revisionId`、`GET /api/v1/document-revisions/:revisionId/content` — 正式文档与修订（正文在发布前仅对有权限的成员可见）。文档列表、文档详情及修订历史列表中的修订只返回元数据，不读取或返回 `bodyBytes`；正文通过 content 入口按当前权限单独读取。历史数组仍完整返回，修订行数分页与超量提示尚待补齐。
- `GET /api/v1/documents/:documentId/history?limit=50&cursor=...` — 明确分页的修订元数据入口，返回 `{ items, nextCursor, total, documentVersion }`。默认 50 条、最多 100 条，按 `seq` 倒序；数据库先限制为当前主体可见的修订，再分页，`total` 是同一请求快照下的完整可见数量。`limit` 必须为正整数，超过 100 封顶，未知参数和非法游标拒绝。每页重新校验项目成员、KB READ 与 Agent 角色/scope；作者或明确用户评审者身份不能绕过 READ。游标绑定文档、主体/凭据、有效权限、KB 授权版本和页大小，换查询应从首页重读；文档版本变化返回 `409 HISTORY_REFRESH_REQUIRED`。每个请求使用独立只读一致事务，跨请求不持有长期快照，游标也不是授权凭据。
- `GET /api/v1/documents/:documentId/revisions/:revisionId/metadata` — 精确读取一条可见修订的元数据，包括验收和交付范围，不读取或返回正文；修订与路径文档不匹配、修订不可见或不存在均为 404。文档评审使用此入口定位旧修订，正文与对照版本仍按精确 ID 从 content 读取。旧文档列表、详情和 `/revisions` 的完整数组暂时保留兼容语义；新增入口不代表主列表读取放大已解决，完整概要与页面迁移见[历史分页方案](design/document-history-pagination.md)。
- `POST /api/v1/documents/:documentId/revisions`、`POST /api/v1/documents/:documentId/restore` — 提交新候选修订或从历史修订恢复；均生成评审请求，不改发布指针。二者与 `POST /projects/:projectId/documents` 一样**必须带 `Idempotency-Key`**（UUID）：同键同语义重放返回首次结果，同键异语义或异路由返回 `409 IDEMPOTENCY_CONFLICT`，缺失则 `400 IDEMPOTENCY_KEY_REQUIRED`。响应中的 `revision` 只携带引用（`id`/`sha256`/`seq`/`reviewRequestId` 等），正文仍只经由 `GET /document-revisions/:revisionId/content` 下发。
- `POST /api/v1/documents/:documentId/withdraw` — 撤回当前发布（追加 `WITHDRAW` 发布记录，清空发布指针）。

- `GET/PUT /api/v1/projects/:projectId/knowledge-bindings` — 列出或设置已发布知识的项目/角色绑定。写入仅允许当前项目 OWNER/ADMIN 的 HUMAN，提交 `{ expectedVersion, documentId, roleId?, required }` 与幂等键；文档及角色必须属于本项目，文档当前已发布且对操作者可读。版本为项目知识绑定版本；绑定不会授予知识库 READ，也不覆盖既有任务快照。
- `GET /api/v1/projects/:projectId/requirements?q&phase&limit&cursor` — 在服务端对完整授权范围搜索标题、编号及描述并按阶段筛选，返回 `{ items, total, nextCursor, hasMore }`。游标绑定项目与筛选条件，变更条件应重新从首页查询；`total` 为筛选后的总数。

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

## Product Agent 本地协议

Product Agent 在本地与产品人员进行自然语言交互，WorkMesh 只持久化已声明的状态、版本、证据和候选，不代替 Agent 推理或 HUMAN 决策。产品工作分为两个模式：`BRAINSTORM` 负责扩大问题/方案空间，`REQUIREMENT` 负责收敛为可评审事实。第一阶段命令为：

```text
workmesh product start --title <title> --text <source>
workmesh product resume --request <requestId>
workmesh product update --request <requestId> --understanding @understanding.json
workmesh product answer --request <requestId> --question <questionId> --answer <text> --apply-to <paths>
workmesh product confirm --request <requestId>
workmesh product draft --request <requestId>
```

状态保存在工作区 `.workmesh/product/`，包含 `facts/goals/users/scope/businessRules/acceptance/assumptions/unknowns/questions/currentQuestionId/answerApplications/evidenceRefs`。每轮只回答 `currentQuestionId`；`answer` 会记录用户原话、时间和结构化落点。存在未解决问题或未知项时，`confirm` 和 `draft` 会拒绝。确认后的草稿通过现有 `candidate --kind PRD` 提交，并绑定已发布 Understanding revision；候选发布、批准、撤回仍只允许 HUMAN Web 会话。

当前本地协议不把问题塞进 ReviewRequest。正式跨 Agent 澄清、任务 BLOCKED/恢复、回答历史和引用校验列入 WP12，预计新增 Clarification / ClarificationResponse API。

## 本地规格与交付质量检查

`workmesh quality --file <quality-bundle.json> --json` 无需登录，仅读取显式选定的本地质量包。PLAN 阶段检查验收、任务、用例、依赖与并行文件归属；DELIVERY 阶段还检查证据完整性和 PRD/快照/commit 绑定。输入非法或存在缺口返回退出码 2，报告在 `error.details.report`；一致时返回 `{data, meta:{requestId}}`，status 为 CONSISTENT。

该命令不访问证据引用、不读实际代码、不确认服务端当前状态，结果固定标为 LOCAL_REPORTED；功能验证和 HUMAN 正式验收仍走既有链路。字段、模板、角色方法和已实现范围见 [规格与交付质量方法](design/spec-driven-quality.md)。

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
- `GET/POST /api/v1/review-requests/:reviewId/discussions` — 分页读取或提出逐项评审问题；创建正文为 `{ title, body }`。同一任务/文档的后续评审可显示此前轮次未解决的问题，来源保持原评审及实际文档修订/工件集。响应提供每项当前主体的 `canReply/canManage` 与分页游标。
- `GET/POST /api/v1/review-requests/:reviewId/discussions/:discussionId/entries` — 分页读取或追加回应；写入为 `{ kind: 'REPLY' | 'RESOLVED' | 'REOPENED', expectedVersion, body, addressedInReviewId? }`，需幂等键。`expectedVersion` 绑定问题版本；可选关联必须是真实的同任务/文档后续交付评审。解决/重开仅限人类问题作者或来源评审准确指定的审批人/有效业务角色，管理员不能绕过，Agent 可提问和回应。问题状态与人工决定、评审版本及发布状态相互独立。
- `POST /api/v1/review-requests/:reviewId/decisions` — 提交 `APPROVE` / `CHANGES_REQUESTED` / `REJECT`；仅当前槽位资格的 HUMAN，携带父请求 `expectedVersion`、一次性票据与幂等键。`CHANGES_REQUESTED` 与 `REJECT` 必须提供非空 `comment`，让本地 Agent 能据此生成下一版；`APPROVE` 的说明可选。全部槽位批准时在同一事务完成发布或任务验收效应。
- `POST /api/v1/review-requests/batch-decisions` — 批量决定：`{ decision, items: [{ reviewId, slotId, expectedVersion, comment?, confirmation }] }`；逐条独立校验与授权，最多 20 条，返回每条 `APPLIED` 或错误码，部分失败不回滚已成功条目。
- `POST /api/v1/review-decisions/:decisionId/revoke` — 撤销批准；`expectedVersion` 指所属评审请求版本。追加撤销记录，失效发布指针与受影响任务，不删除历史。
- `GET/POST /api/v1/projects/:projectId/delegations`、`DELETE .../delegations/:delegationId` — 槽位级临时委托；原责任人不变，`expiresAt` 必填且必须晚于当前时间；同一槽位同时只允许一条有效委托（`409 DELEGATION_EXISTS`）；被委托人在有效期内可代为决定。
- `GET /api/v1/projects/:projectId/approvals/overdue` — 到期未决定的槽位视图（按 `dueAt` 升序）；只读，不自动批准。
- `POST /api/v1/projects/:projectId/approvals/escalate` — 把到期未决定且未升级的槽位标记为已升级（`escalatedAt`），返回标记数量；不自动批准。

## 任务与工件

- `GET /api/v1/tasks/:taskId`、`POST /api/v1/tasks/:taskId/claims`、`POST /api/v1/tasks/:taskId/release`、`POST /api/v1/tasks/:taskId/work-status` — 认领/释放与工作状态；认领按任务当前代次串行，客户端不声明版本。
- `GET /api/v1/projects/:projectId/tasks/ready?roleId&limit&cursor` — 前置任务已完成的团队任务分页：`OPEN`、无活动认领、`ACTIVE`，且当前有效实例中前序依赖全部为 `DONE/ACTIVE`。Agent 只能看本凭据角色，HUMAN 按责任人与活动角色范围过滤。每项 `claimEligibility: { canClaim, reason }` 说明本人能否领取，团队可见不表示本人可领取；输入和本机环境需另行核验，正式领取仍在事务中复核。候选/依赖读取失败返回可重试的 `503 INPUT_UNAVAILABLE`，不会伪装成成功空列表。

  支持条件请求（RFC 7232）：响应带弱验证器 `ETag` 与 `Cache-Control: private, no-cache`；请求携带 `If-None-Match` 命中时返回 `304` 且不带正文（仍带 `X-Request-Id`）。验证器只由响应载荷派生，与 `meta.requestId` 无关，所以轮询方可以放心用它判断「就绪集是否变了」。这是给固定间隔轮询的 Agent 用的：命中 304 时省掉正文传输与解析；服务端仍会执行查询，只是不重复下发相同结果——查询本身的开销由 `Task_ready_queue_idx` / `Task_ready_role_idx` / `Task_ready_responsible_idx` 覆盖过滤与排序。

- `POST /api/v1/tasks/:taskId/artifact-sets`、`GET /api/v1/artifact-sets/:id` — 交付并读取工件集（只接受真实字节或完整代码引用，交付时复核基线）。

工件 `checks[]` 的旧格式仍兼容；未提供 `source` 的检查会按 `AGENT_REPORTED` 保存。若引用外部 CI 或测试报告，可提交 `source: "EXTERNAL_REFERENCE"` 与 `evidence: { kind: "CI_RUN" | "TEST_REPORT", provider, url, runId?, commitSha? }`。外部链接必须是 HTTPS，若声明 `commitSha` 则须与所交代码引用一致。该字段仅提供给评审人复核的链接，WorkMesh 当前不抓取或验证 CI 结果；Agent 不能提交 `verified` 标记。代码评审状态仍由独立代码托管证据决定。

- `POST /api/v1/tasks/:taskId/context-snapshots`、`GET /api/v1/context-snapshots/:snapshotId`、`GET /api/v1/context-snapshots/:snapshotId/resources/:refId` — 确定性上下文快照与受限资源读取。
- `GET /api/v1/tasks/:taskId/input-status` — 只读解析当前任务的实际输入，与本任务当前快照逐项比较引用、内容元数据和交付范围；不要求先领取，也不创建快照。响应分别给出 `availability`、每项 `contentStatus` 和 `comparison`。服务端可取得的正文核对摘要及长度；外部代码引用只能标记需本机核验。当前授权失效或旧快照不属于本任务时不返回旧输入信息，不能把读取失败解释为没有变化。客户端仍需检查本机仓库及运行环境。
  - `issues[]` 给出 `kind / reason / required / blocking / action / responsible`，并按输入附上 `inputKey`、可读取的 `documentId / revisionId`、`fromStepKey / artifactKind` 或已授权资源的 `refId`。未绑定、未发布、过期发布引用、缺少已验收上游、正文校验失败和外部引用分别解释；无法确认读取权时不返回文档/修订标识。权限和基础设施异常仍返回请求错误，不能解释为缺失。
  - `issuesComplete: true` 表示此次已遍历当前配置的输入及可解析资源；未知或不可读对象仍保留不可用问题，不代表查明了其内部原因。只读诊断可收集多个问题，不产生部分可交付快照；创建快照仍按原权限、版本、代次及完整输入门禁拒绝不满足条件的请求。旧平台缺少诊断字段时客户端必须保留诊断不完整提示。
  - Agent 可用 `workmesh context --task <taskId> --inspect [--json]` 查询，不能与认领、版本、候选、已有快照、materialize 或写操作编号组合。退出码 0 只代表查询成功，能否创建快照应读取 `availability` 和逐项诊断。

  必需上游工件只有已验收的 `GIT_REF` 时，只读预览将其标为 `EXTERNAL_REFERENCE`，并给出 `issue: SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED`；当前正式快照仍要求可展开的 `HOSTED` 正文，创建返回 `422 INPUT_UNAVAILABLE`。需要上游按流程补交并验收正文，本机 Git 检查不能解除这个限制。

- `GET /api/v1/projects/:projectId/board?q&roleTitle&requirementCode&limit` — 看板首批：返回 `projectId/queryKey/summary/columns`；固定六列各自包含 `total/cards/nextCursor`。默认每列 20 张，上限 100；`summary.total` 是项目全部任务数，`matchedTotal`、`columns[].total` 和 `requirementTotal` 是完整筛选范围的准确计数。`cards` 是有界页，不能继续按旧的完整快照理解或在首批卡片上做全局筛选。
- `GET /api/v1/projects/:projectId/board/columns/:column?q&roleTitle&requirementCode&limit&cursor` — 单列续页：返回 `projectId/queryKey/key/total/cards/nextCursor`，按 `generation DESC, id ASC` 排序。
- `GET /api/v1/projects/:projectId/board/requirements?q&roleTitle&requirementCode&limit&cursor` — 需求聚合分页：返回 `projectId/queryKey/summary/items/nextCursor`。每组包含 `code/title/total/counts/roles/roleTotal/rolesNextCursor`，`counts` 为全部匹配任务的六列计数；按“阻塞数 × 10 + 进行中数”降序、需求编号升序排列。每组 `roles` 默认预览 10 项，更多角色按下面的角色选项入口续读。
- `GET /api/v1/projects/:projectId/board/filters/:kind?search&q&roleTitle&requirementCode&limit&cursor` — `kind` 为 `roles` 或 `requirements`，返回 `projectId/queryKey/total/items/nextCursor`；`items` 为 `{value,label}`。默认 50 项、上限 100，只包含有任务的角色标题或需求编号；`search` 文字匹配选项标签。项目筛选器只传 `search/limit/cursor`，不传当前看板筛选，因此选项不会随已加载卡片缩小。需求行角色续页传该组 `requirementCode`、当前 `q/roleTitle`、`limit=10` 和 `rolesNextCursor`。

以上四个看板入口都沿用项目只读和 `task:read` 权限，不增加 `requirement:read` 要求。`q` 对需求编号、标题、步骤 key、角色标题和当前活动认领人邮箱拼接后做不区分大小写的文字搜索，`%`、`_` 和反斜杠均按普通字符处理；`roleTitle/requirementCode` 为精确筛选。所有任务代次和已退役流程实例仍在读取范围内。列归属保持“有交付指针 → 已交付；无认领指针 → 未开始；其余按工作状态分列”的优先顺序。

计数和对应页面在单次 PostgreSQL 只读、RepeatableRead 事务中计算；后续 HTTP 页读取当时的实时数据，`queryKey` 标识规范化筛选条件，不是跨请求冻结的数据版本。刷新或修改任务可能改变后续页的位置，客户端应在刷新和筛选变化时重新开始分页。游标绑定项目、筛选和视图；跨列、跨需求聚合/选项入口或修改选项搜索后复用会返回 400。`nextCursor=null` 表示当前读取没有下一页。需求编号、角色标题和选项采用 PostgreSQL `C` 排序以保证确定性，与旧客户端 `zh-CN` 排序可能略有不同。

- `GET /api/v1/projects/:projectId/metrics/flow?days=30` — 流程度量：两端时长（首次认领、首次交付、批准）、端到端 lead time、WIP 与变更确认率；只从既有时间戳派生，口径见 [docs/metrics.md](metrics.md)。
- `GET /api/v1/change-recipients`、`POST /api/v1/change-recipients/:id/ack` — 变更传播收件人与确认。
  - 列表限定当前用户与项目；Agent 还限定凭据角色（保留没有指定角色的通知）。`ackedOnly=false` 只列待知悉项，`true` 只列已知悉项，省略时列两者；游标必须属于同一用户、项目及凭据角色范围，可继续使用刚刚已确认的本页末项游标。
  - 每项附 `event` 摘要（来源、需求、变更字段与时间，不附原始 targets）和只读 `guidance: {checkedAt, scope, eventBaseline, tasks}`。`tasks` 给出 `taskId / taskCode / role / responsibleUserId / relation / version / generation / executionStatus / workStatus / reason / action / href / inspectCommand`。负责人任务与同角色其他成员任务分别标记，同角色任务只建议联系负责人。
  - `scope=EVENT_TASKS` 来自事件记录的 taskIds；已接受变更请求没有 taskIds 时，`CURRENT_ACCEPTANCE_SCOPE` 按当前需求与验收 key 匹配，明确不代表历史时刻已使任务失效；无法判定时为 `UNKNOWN`。`eventBaseline=SUPERSEDED` 表示事件基线已有后续更新。当前状态会区分无快照、快照跨代、正在评审、已完成、阻塞、暂停、取消、退役、角色失效与项目归档，不由 ACK 推断已处理。
  - `workmesh changes` 在人类可读输出中显示同一任务诊断、输入检查命令及 Web 深链；`--json` 保留服务端结构与分页。旧平台缺少 guidance 时明确提示未提供诊断。知悉仍只确认收到通知，不批准需求、恢复认领或完成调整。

## 代码证据

工作台的评审、变更和可开工任务额外返回 `blocking` 与 `dependencyImpact`。`blocking` 是完整相关流程图中去重后的未完成下游数；变更/基线事项还包含直接关联任务，不能称为关键路径或承诺全部解锁。读取不受当前工作台 50 条显示页限制；图不完整、成环、读取失败或权限撤回时返回 `null` 与 `status=UNAVAILABLE`，不会用零隐藏未知。

`dependencyImpact` 包含 `checkedAt / scenario / reason / readyAfterAction`。`readyAfterAction` 只计算本次动作成功后新满足前置依赖的任务数：当前代次、当前工件集、最后必需审批槽且工作状态可推进时才能模拟完成；多个审批槽、暂停/取消/退役及过期评审不会独立推进。可开工卡片按“完成本任务后”模拟，不表示领取即解锁。输入、认领权限及其他运行门禁仍需另外检查。变更 ACK 的就绪增量恒为 0；文档基线发布的增量为 `null`，发布后重查输入。Web 可选依赖影响排序，原时间与风险信息继续展示。这是只读说明，不参与批准或任务状态计算。

- **`IMPL` 工件必须绑定代码证据才能被验收。** 交付 `kind: 'IMPL'` 的工件集时，服务端会按工作流为该步骤派生 `CODE_REVIEW_EVIDENCE` 系统闸门；若工件没有通过下面的 code-evidence 接口绑定到具体提交，评审决定会以 `422 CODE_EVIDENCE_MISSING`（`CODE_REVIEW_EVIDENCE_MISSING`）拒绝。也就是说：`IMPL` 不能只交托管字节，必须能被人类按 commit 复核。非代码类工件（`DESIGN` / `CASES` / `RELEASE` / `PRD`）不受此约束。

  验收时的证据解析口径：`prepare` 在工件集下建的是一条 `PENDING` 占位票据行，而 webhook 写入的真实批准证据不带 `artifactSetId`。因此闸门**不按 `artifactSetId` 直接取证据**，而是沿「已消费（`preparedExpiresAt` 为空）的票据 → `preparedEvidenceId`」解析出真正被认领的那条证据，占位行本身不计入。`403`/`422` 之外，`details.reason` 为 `CODE_CLAIM_REQUIRES_APPROVED_PR_REVIEW`（未建立绑定）或 `BOUND_EVIDENCE_NOT_APPROVED`（已绑定但证据不是全员 APPROVED 的他人评审）。

- `POST /api/v1/integrations/github/webhooks` — GitHub Webhook（HMAC-SHA256 签名校验，免会话认证）。
- `POST /api/v1/integrations/github/code-evidence/prepare`、`POST /api/v1/integrations/github/code-evidence/:ticketId/use` — 准备提交级代码证据并把证据绑定到工件集。仓库身份使用稳定的数值仓库 ID，owner/name 仅作展示；两次读取之间 head/状态变化返回 `UPSTREAM_CHANGED`。

## 操作收据

- `GET /api/v1/operation-receipts/:operationKey?projectId=` — 只读查询已提交操作的收据（`requestDigest`、`resultRefs`、`method`、`route`、`committedAt`）；只允许原主体读取，HUMAN 可代读自己 Agent 的收据，其他主体/跨项目/未提交一律 404，视图不含响应正文，也不自动重放。

## 运维

- `GET /api/health`、`GET /api/health/ready` — 存活/就绪探针，语义与差异见上文「健康探针」（不属于 `/api/v1` 协议面）。
- `GET /api/metrics` — 请求计数、失败数与平均延迟。
- Swagger 在 API 启动后于 `/api/docs` 可读。
