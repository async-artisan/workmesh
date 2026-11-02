# 04：代码托管适配器与提交级评审证据

本分册定义目标实现，不代表当前代码已经支持。适用协议 `workmesh-api/1.0`，所有 HTTP 路径在 `/api/v1` 下。首个实现为 GitHub.com；Codeup 保留明确接入门槛，不模拟成 GitLab，不降低核心代码评审要求。

## 1. 范围、文件与依赖

复用 API `integrations` 模块和项目访问控制，拆出 `adapters/code-hosting-adapter.ts`、`adapters/github.adapter.ts`、`code-evidence.service.ts`、`provider-connections.service.ts`，原 `git-integration.service.ts` 改为内部事件和追溯协调，不解析厂商请求头。`signoff` 或新 reviews 服务只能消费标准证据。

依赖 01 的 Principal、部署秘密引用和项目管理权限，以及 02 的任务 generation、ArtifactSet、ReviewRequest、事务与版本规则。ProjectRepository 与外部证据的字段由本册定义，02只引用其FK。秘密值只由服务端配置解析器读取，不写数据库正文、返回体或调试日志。

## 2. 确定的数据结构

下列字段是本分册的权威定义。UUID、时间和通用审计字段遵守主方案。所有外部 ID 存字符串，不能转换为会丢精度的 JavaScript number。

| 实体 | 字段与约束 |
| --- | --- |
| ProviderConnection | `id, projectId, provider: GITHUB\|CODEUP, instanceKey, apiBaseUrl, webBaseUrl, externalNamespaceId, credentialRef, webhookSecretRef, version:Int=1, archivedAt?, createdAt, updatedAt`。`credentialRef` 和 `webhookSecretRef` 是部署秘密映射的非敏感键，长度 1..120、仅 `[A-Za-z0-9._-]`，绝不接收秘密值。唯一 `(projectId,provider,instanceKey,externalNamespaceId)`。 |
| ProjectRepository | `id,projectId,connectionId,externalRepositoryId,fullName,repositoryUrl,defaultBranch,version:Int=1,archivedAt?,createdAt,updatedAt`；唯一 `(connectionId,externalRepositoryId)`。`projectId` 必须与 connection 相同；归档而非删除。 |
| ChangeRequestMirror | `id,projectId,projectRepositoryId,externalId,numberLabel,title,authorExternalId,authorKind:USER\|BOT,headSha,baseSha,state:OPEN\|CLOSED\|MERGED,mergedCommitSha?,mergedAt?,providerUpdatedAt,lastFetchedAt,version`；唯一 `(projectRepositoryId,externalId)`。这是可刷新的查询投影，不是永久批准。 |
| ExternalReviewMirror | `id,changeRequestId,externalReviewId,reviewerExternalId,reviewerKind,commitSha?,state:APPROVED\|CHANGES_REQUESTED\|DISMISSED\|COMMENTED\|PENDING,submittedAt?,lastFetchedAt`；唯一 `(changeRequestId,externalReviewId)`，允许刷新当前厂商状态，重要变更写 AuditEvent。 |
| CodeReviewEvidence | `id,projectId,projectRepositoryId,changeRequestId,headSha,mergedCommitSha?,authorExternalId,decision:VALID\|INVALID\|UNKNOWN,reasons:String[],reviews:Json,verifiedAt,expiresAt,digest,providerStateDigest,createdByStampId?,webhookReceiptId?`；不可变，`expiresAt=verifiedAt+60s`。来源stamp与webhookReceipt精确二选一，不伪造HUMAN身份。`reviews` 保存参与判定的稳定 ID、类型、决定、评审提交和时间，不保存评论正文或完整厂商响应。 |
| WebhookReceipt | `id,connectionId,deliveryId,eventType,bodySha256,targets:Json,receivedAt,processedAt?,outcome:PENDING\|APPLIED\|IGNORED\|FAILED,errorCode?`；唯一 `(connectionId,deliveryId)`。targets仅存已解析的仓库、请求ID或提交定位，供重启后主动刷新；不存原始请求体、评论、认证头或秘密。 |

`CodeReviewEvidence.digest` 是05的canonical JSON对 `{schemaVersion:'1.0',projectRepositoryId,changeRequestId,headSha,mergedCommitSha,authorExternalId,decision,reasons,reviews,verifiedAt,expiresAt,providerStateDigest}` 计算的完整SHA-256；nullable字段显式null，reviews按reviewerExternalId、reviewId排序，reasons去重排序。`providerStateDigest`覆盖PR／评审业务集合但不含本地核验时间。批准记录引用证据ID，并固定headSha与工件集合，不能只保存PR编号或URL。

实例标识是显式配置的逻辑身份，连接域名不是按用户任意请求动态发现。v1实际启用的provider只有GITHUB；CODEUP保留领域枚举以表达后续目标，但v1创建Codeup连接及取证均以422 PROVIDER_UNSUPPORTED拒绝，不填造默认地址或返回假成功。S7能力核实后才开放其实际配置契约。

## 3. 有界的服务端适配接口

```ts
interface CodeHostingAdapter {
  capabilities(): {
    webhook: boolean;
    fetchChangeRequest: boolean;
    commitBoundReviews: boolean;
    immutableBlob: boolean;
  };
  verifyWebhook(connection: ConnectionRuntime, headers: HeadersView, rawBody: Uint8Array): VerifiedEvent;
  refreshChangeRequest(repository: RepositoryRuntime, externalId: string): Promise<NormalizedChangeRequest>;
  fetchBlob(repository: RepositoryRuntime, commitSha: string, repoPath: string): Promise<Uint8Array>;
}
```

`ConnectionRuntime/RepositoryRuntime` 由已授权数据库对象和部署配置构造，不能来自 HTTP 请求中的秘密或任意 base URL。接口只在服务内部注册，不提供“上传适配器代码”“执行任意回调”接口。`NormalizedChangeRequest` 为第 2 节镜像字段及 review 列表，具体厂商字段不流向领域层。

初始白名单是 `api.github.com` 和 `github.com` 的 HTTPS 443。自建 GitHub Enterprise 和 Codeup 需要增加已批准部署实例及独立能力验收，不允许用户通过仓库链接把服务变成任意 HTTP 代理。禁止跟随跨域重定向，禁止从提交的 URI 读取 `.git/config` 或凭据。

## 4. GitHub 实现的精确取证规则

### 4.1 认证及访问范围

首版使用部署者配置的 fine-grained 只读 token，实际需要所选仓库的 Metadata、Pull requests 和 Contents 读取能力。不要求部署者把 token 输入聊天或存入项目正文。GitHub App、SSO 授权与企业版不在 v1 实现范围。

连接的创建和变更只允许当前 HUMAN OWNER/ADMIN，绑定仓库时由适配器读取仓库详情获得 GitHub 仓库稳定 ID；请求中的 `owner/repo` 仅作为定位候选，不作为最终身份凭据。连接错误日志仅输出连接 ID、状态码类别和 requestId，不输出上游响应全文。

### 4.2 查询与分页

使用 GitHub REST JSON，版本头固定为所实现并通过契约测试的 `2022-11-28`：

- `GET /repos/{owner}/{repo}`：绑定仓库身份及默认分支。
- `GET /repos/{owner}/{repo}/pulls/{number}`：查询当前 PR 作者、head／base SHA、state、merged、merged_at 和 merge_commit_sha。
- `GET /repos/{owner}/{repo}/pulls/{number}/reviews?per_page=100&page=N`：按分页读取全部 review，不能只读第一页。
- `GET /repos/{owner}/{repo}/git/blobs/{blob_sha}` 配合提交树定位：只取登记仓库和固定提交下的文件字节，供 GIT_REF 工件独立校验，不能将网页 HTML 当源码。

所有请求超时 10s；GET 仅在网络失败或 502/503/504 时重试两次，间隔 250ms、1000ms，尊重更长的 `Retry-After` 时返回可重试错误而不是无限等待。401/403、404、429、无效 JSON 或必填字段缺失不制造默认值。分页超过 1000 条评审或 100 页树结果时返回证据不足及容量原因，不把截断结果当完整集合。

### 4.3 批准判定

取证依次读取 PR、完整 reviews、再次读取 PR。两次仓库身份、head、合并状态或 providerUpdatedAt 不一致，本次返回 `UNKNOWN/UPSTREAM_CHANGED`，不在同一次人工批准中自动改为新提交。

对当前 USER 评审者，排除作者本人，以稳定用户 ID 分组；按 `submittedAt`、review ID 排序，保留最新有决定性的 `APPROVED/CHANGES_REQUESTED/DISMISSED`。COMMENTED 不覆盖先前决定，PENDING 不参与。最新决定是 DISMISSED 时，该评审者的更早批准不得复活。必要类型、ID 或时间缺失时返回 UNKNOWN，不用用户名或本地接收时间补造可信身份。

仅当以下条件全部满足，证据才为 VALID：

1. 仓库与任务登记的代码范围一致；PR 与该任务有明确引用关系，需求编号只作辅助追溯，不能代替任务级绑定。
2. PR 已合并，存在 head SHA 及合并事实。
3. 至少一名非作者、非 Bot 的 USER，其最新有效决定是 APPROVED，且 `commitSha === PR.headSha`。
4. 没有非作者 USER 的当前有效 CHANGES_REQUESTED；即使该意见提交于旧 head，也需明确解除，不能仅因为追加提交就忽略。
5. ArtifactSet 中每个 IMPL 项都声明所属 `projectRepositoryId/commitSha`；对应代码证据的 head 与交付的提交一致。多仓任务对每个实现仓库分别取得证据，不能用其中一份批准覆盖其他仓库。

有效决定不足、当前要求修改、未合并返回 INVALID；接口失败、不完整分页、无法关联提交、并发变化返回 UNKNOWN。两者都不得放行，但错误原因区分“需要补评审”和“当前无法核验”。

不能声称跨 GitHub 与 PostgreSQL 的校验是分布式原子事务。`POST /review-requests/:id/prepare-code-evidence` 先在事务外获取各仓证据，再用短事务CAS绑定 `ReviewRequestCodeEvidence(reviewRequestId,projectRepositoryId,evidenceId)` 并递增ReviewRequest.version；不能在preview、ticket和最终决定之间每次悄悄新建一套证据ID。

Web preview及确认票据的actionDigest包含这组准确证据ID与digest。批准事务只消费已绑定、核验不超过60s的证据，并重读需求generation、任务版本、ArtifactSet、仓库版本及当前授权；任何变化拒绝。过期后必须重新准备证据，再预览和确认。DecisionCodeEvidence以FK永久保存批准所依据的证据；后续撤销或head变化触发当前有效性重算。60s只限制新批准时的取证新鲜度，不让历史批准在60s后自动作废。

### 4.4 Webhook 和对账

入口 `POST /integrations/code-hosting/:connectionId/webhook`。先根据已登记连接选适配器，不从缺失的请求头猜厂商。限制原始 body 2MiB；GitHub 用每连接的 HMAC-SHA256 和 timing-safe 比较，要求 `X-GitHub-Delivery` 及已识别事件类型。

已验签的 `push`、`pull_request`、`pull_request_review`、`pull_request_review_thread` 中与证据有关的变化只触发规范化刷新；不把单个 webhook 的 state 直接视为最新批准。不需要的线程事件可以 IGNORED，但 review dismissal、PR synchronize、merge、close、reopen 必须处理。

同delivery ID、同body摘要重复投递返回200原处理结果；同ID不同body返回409 `WEBHOOK_REPLAY_CONFLICT`。Receipt与解析后的非敏感targets先持久化，再由进程内处理服务刷新；失败保留FAILED，进程重启遗留PENDING不冒充APPLIED。管理员通过receipt重试入口根据targets重新取状态，不需要持有旧payload；每次人工批准前实时刷新也提供补偿。v1不增加持续轮询worker，不宣称无遗漏事件订阅。

镜像更新及对当前任务的失效标记使用 02 事务规则；Webhook receipt 与重要审计写数据库失败时本次不得返回 APPLIED。公开响应只有 receipt ID、状态和是否重复，不回显 payload。

## 5. Codeup 的交付边界

目前公开新版 GetChangeRequest 可查询评审意见，ListChangeRequestPatchSets 可查询源版本；公开评审条目没有明确的提交关联字段。因此核心不把 `reviewTime` 或 `PASS` 自动解释为“针对当前 head 批准”。

Codeup 适配器作为后续独立开发切片，必需输入是经授权的实际部署形态、API 版本和可脱敏验证仓库。进入代码门禁前，必须实际证明：

- 请求认证和仓库身份与该企业实例匹配；中心版／Region 版契约不混用。
- 源分支追加提交后的旧批准是否失效，可取得什么可信关联证据。
- 撤销、NOT_PASS、重开、合并等状态如何刷新；Token 请求头不冒充 GitHub HMAC。
- 分页、限流、重复或漏事件下，主动取证不能把不完整数据标为有效。

缺少上述证据时 `capabilities.commitBoundReviews=false`，取证返回 UNKNOWN，核心、界面和 CLI 均说明限制。此时可以管理普通需求与非代码协作，但不能声称 Codeup 的代码批准闭环已支持。若需要改用额外可信证明，必须新增技术决策及独立验收，不以手填 APPROVED 绕过。

## 6. HTTP 契约

共同 envelope、错误和幂等规则见 05。

| 方法与路径 | 授权与请求 | 响应 data |
| --- | --- | --- |
| GET `/projects/:p/code-connections` | 当前项目 HUMAN 管理者。 | 非敏感连接元数据数组；不返回 secret 值，secretRef 仅管理页面可见。 |
| POST `/projects/:p/code-connections` | HUMAN OWNER/ADMIN＋票据；`{expectedVersion:Project.version,provider,instanceKey,externalNamespaceId,credentialRef,webhookSecretRef,confirmation}`，v1 GITHUB URL服务端固定。 | `{connection,projectVersion}`，201。 |
| POST `/code-connections/:id/archive` | HUMAN OWNER/ADMIN＋票据；`{expectedVersion,reason,confirmation}`，有关联待审任务时先阻塞并审计。 | `{id,version,archivedAt}`。 |
| GET `/projects/:p/repositories` | 项目读取权限。 | 仓库列表，不含秘密引用。 |
| POST `/projects/:p/repositories` | HUMAN OWNER/ADMIN＋票据；`{expectedVersion:Project.version,connectionId,fullName,confirmation}`，服务端核验仓库并将其稳定身份及连接版本纳入ActionBinding。 | `{repository,projectVersion}`，201。 |
| POST `/repositories/:id/archive` | HUMAN OWNER/ADMIN＋票据；`{expectedVersion,reason,confirmation}`；不得删证据历史。 | `{id,version,archivedAt}`。 |
| POST `/repositories/:id/change-requests/refresh` | HUMAN 管理者或具备 `task:deliver` 且持有本仓 IMPL task claim 的 Agent；`{externalId,taskId?}`；幂等键必需。 | `{changeRequest,evidence:{id,decision,reasons,headSha,verifiedAt,expiresAt}}`。 |
| GET `/code-review-evidence/:id` | 对证据关联任务／仓库有当前读取权。 | 不可变标准证据，不含原始敏感评论。 |
| POST `/integrations/code-hosting/:connectionId/webhook` | 厂商请求认证，不接收人／Agent Cookie。 | `{receiptId,outcome,duplicate}`；成功 200。 |
| POST `/code-connections/:id/webhook-receipts/:receiptId/retry` | HUMAN当前项目管理者，`{}`，幂等键必需；只允许本连接PENDING/FAILED且targets合法。 | `{receiptId,outcome}`；不能按请求提供的新URL或payload执行。 |

连接 secretRef 若不存在或不在部署批准白名单，返回 422 `INVALID_SECRET_REFERENCE`。已归档或能力不支持返回 409 `PROVIDER_UNAVAILABLE` 或 422 `PROVIDER_UNSUPPORTED`；GitHub 状态无法取得返回 503 `PROVIDER_VERIFICATION_UNAVAILABLE`。错误信息不包含秘密或上游原始响应。

## 7. 首版测试

Adapter 单测使用与真实官方字段契约一致的脱敏 fixture：多页 reviews、COMMENTED 后批准不丢失、同 reviewer 决定变更、DISMISSED、作者自审、Bot、旧 SHA、source 新提交、missing fields、API 权限和限流、两次 PR 变化、不同仓库同 PR 号。

真实 Nest HTTP 测试覆盖每连接验签、raw body、缺 delivery、同 ID 异 body、大小限制、未知连接、跨项目证据读取和接口失败 closed；数据库集成覆盖 receipt 唯一性、镜像刷新与任务失效事务。不得在默认单元测试中访问 GitHub。

经另行授权的 GitHub 测试仓库验证“合并＋他人当前提交批准→Web代码确认”“旧批准＋新提交→拒绝”“dismissal→当前批准失效”“多仓缺一仓证据→拒绝”。没有真实仓库授权则此层标为未验证，不能用 fixture 通过声称真实平台闭环完成。
