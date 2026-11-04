# 05：HTTP API、错误、幂等与跨客户端契约

本文保留 HTTP 传输与跨客户端契约，包含已实现接口及目标条款；现行路由使用清单见[API 文档](../../../api.md)，覆盖与验证边界见[交付状态](../../../phase-status.md)。具体实现应与 01–04 分册共同核对。旧 `/api` 写入口、HUMAN bearer、`actorType`、直接写 DONE 和未经评审发布等旁路不注册到正式版本。

## 1. 共同规范与唯一来源

- API root 固定 `/api/v1`；反向代理可有明确前缀，但服务端路径版本只有 v1。不把 Swagger `info.version` 当协议握手。
- [01 身份](01-identity-permissions.md)权威定义认证、角色、grant、票据及对应精确路由；[02 领域](02-domain-state-transactions.md)权威定义实体、状态、不变量与事务；[03 工作流](03-local-workflows-clients.md)权威定义包、配置 schema 和 CLI；[04 适配器](04-code-hosting-adapters.md)权威定义外部证据。这里统一 HTTP 传输与业务路由，不另建第二套权限或状态机。
- 成功统一 `{data:T,meta:{requestId:UUID}}`；新建资源 201，其他成功 200，归档和撤销不返回 204。错误统一 `{error:{code:string,message:string,details?:object,requestId:UUID}}`。
- 服务端为每次请求产生 UUID requestId，响应 `X-Request-Id`；客户端不能指定审计身份。时间为 UTC ISO-8601 字符串，ID 为 UUID 字符串，版本为 1..2147483647 的安全整数。
- roleKey、stepKey、workflowKey、slotKey 使用 `^[a-z][a-z0-9-]{0,47}$`；需求项目 key 为 2..6 位大写字母，创建后不可改；需求和任务 code 只展示和解析，公开动作以真实 ID 为准。
- JSON 请求使用 UTF-8 `application/json`，拒绝未知字段、重复 key、非有限数字和错误类型，不把字符串任意转换为布尔／数字。Nest 全局 `ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true})` 配合明确 DTO、nested validation 和数组上限；query 的整数转换显式声明。未知字段不得被静默删除后导致授权摘要改变。最大嵌套深度32，超过限制400 INVALID_REQUEST。
- JSON body 最大 16MiB；文档和单件正文最多 10MiB 原始字节，单次交付所有 HOSTED 字节总和不超过 10MiB，工件最多32项。超限413 `PAYLOAD_TOO_LARGE`；不因 Base64 膨胀绕过原始字节限制。Webhook另按04限制2MiB。
- 受保护请求每次做当前授权。没有对象访问权返回404 `RESOURCE_NOT_FOUND`，不能通过错误泄露跨项目对象；已可见但动作权限不足403。

## 2. 类型、摘要与错误

### 2.1 共享 DTO

`packages/shared` 保存公开 TS DTO、固定 enum、JSON Schema 与纯校验器；Nest HTTP DTO 使用现有 class-validator/class-transformer 执行同样结构校验。JSON Schema 2020-12 的角色包／流程使用 AJV 8 validator；新增直接依赖 `ajv@8`、`ajv-formats@3`、`semver@7` 和相应类型，锁文件冻结实际版本。不为共享 DTO 导入 Prisma 生成类型，API 与领域服务内部映射数据库类型。

共享包当前直接export源码TS不能作为Nest CommonJS运行时依赖。T00为shared增加与现CLI同系列的tsup构建，输出ESM `dist/index.js`、CJS `dist/index.cjs`和声明文件；package exports按import/require/types分流并设置types字段，T01及应用构建前先build shared。共享schema和纯校验器无浏览器／Nest／Prisma副作用；真实Node20 CJS require与Node ESM import都做冒烟测试，不能只靠TS类型检查掩盖运行时模块错误。

Turbo的type-check与lint同样依赖上游`^build`，确保从干净clone运行类型检查时shared声明已存在；不依赖开发者手动先build。API的build/type-check/test明确调用隔离的v1 client生成入口，不依赖pnpm是否自动执行pre脚本，也不读取用户现有环境文件生成到错误schema。

API Swagger 保持当前锁定工具可生成的 OpenAPI 3.0，不假定它能原生解释2020-12 schema。流程 schema 用其独立 `$id` 验证，OpenAPI 引用的是该接口实际可表示的请求结构；新增 schema 版本不能静默解释旧结构。

重复key检查不由class-validator或JSON.parse自动保证。T00新增共享 `parseJsonStrict(bytes)`：先核UTF-8有效性和JSON语法，再以token扫描维护每个对象的已解码key集合及嵌套深度，识别含转义的等价key；在DTO之前拒绝重复键。数组、字符串中的括号与转义不得当作结构，固定测试覆盖 `"a"` 与 `"\u0061"` 同对象重复、嵌套独立同名、引号/反斜杠、Unicode及深度限制。Webhook原始bytes先验签，再由厂商专用parser消费，不能提前重编码原body。

### 2.2 Canonical JSON 和原始正文

`canonicalJson` 实现 RFC8785 的对象键排序、JSON字符串转义和紧凑编码；v1输入拒绝浮点数，避免跨语言浮点歧义。数组保序，只有 schema 明确为集合的字段先去重按确定键排序。公共实现放 `packages/shared/src/canonical-json.ts`，用固定向量测试顺序、Unicode、反斜杠、null及嵌套对象；所有分册引用同一实现。

`sha256` 为64位小写hex。文档、二进制和附件摘要只对原始字节计算，不 trim、不截断、不替换换行；JSON manifest digest 才使用 canonicalJson。Base64 必须严格验证可逆标准编码，不接受解码后再重新编码不一致的输入。正文默认 `text/markdown; charset=utf-8`；Binary工件不尝试按文本解码。

### 2.3 固定错误分类

| HTTP | code（v1公共分类）                                                                                                                                                                                                                                   | 客户端动作                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 400  | INVALID_REQUEST、CREDENTIAL_CONFLICT、INVALID_CURSOR                                                                                                                                                                                                 | 修正请求；不能通过换凭据类别或忽略字段绕过。                   |
| 401  | AUTH_REQUIRED、AUTH_INVALID、SESSION_EXPIRED、CREDENTIAL_REVOKED                                                                                                                                                                                     | Web重新登录；CLI重新授权，不自动刷新为HUMAN。                  |
| 403  | FORBIDDEN、SCOPE_DENIED、HUMAN_SESSION_REQUIRED、CSRF_REJECTED、ORIGIN_REJECTED                                                                                                                                                                      | 显示需谁处理；不自动扩大scope。                                |
| 404  | RESOURCE_NOT_FOUND                                                                                                                                                                                                                                   | 不显示不存在对象或他人数据的细节。                             |
| 409  | VERSION_CONFLICT、ACTION_CHANGED、IDEMPOTENCY_CONFLICT、CONFIRMATION_USED、CLAIM_CONFLICT、CLAIM_INVALID、BASELINE_STALE、REVIEW_CLOSED、RESOURCE_CONFLICT、WORK_STATUS_CONFLICT、LAST_OWNER_REQUIRED、PROVIDER_UNAVAILABLE、WEBHOOK_REPLAY_CONFLICT | 读取当前状态与差异，交互确认后形成新操作；不盲重试旧业务意图。 |
| 410  | AUTHORIZATION_EXPIRED、CONFIRMATION_EXPIRED                                                                                                                                                                                                          | 重新开始对应授权／确认，不延长原票据。                         |
| 413  | PAYLOAD_TOO_LARGE                                                                                                                                                                                                                                    | 缩小范围；不默默截断。                                         |
| 422  | VALIDATION_FAILED、WORKFLOW_INVALID、ROLE_INACTIVE、MEMBER_INACTIVE、INVALID_GRANT、UNSUPPORTED_SCOPE、INVALID_SECRET_REFERENCE、PROVIDER_UNSUPPORTED、ARTIFACT_INVALID、INPUT_UNAVAILABLE、REVIEW_PRECONDITION_FAILED                               | 展示结构化details及需要补充的资料，不判定已完成。              |
| 429  | RATE_LIMITED、AUTHORIZATION_SLOW_DOWN                                                                                                                                                                                                                | 遵守Retry-After；不并行扩大重试。                              |
| 503  | TRANSACTION_RETRY_EXHAUSTED、PROVIDER_VERIFICATION_UNAVAILABLE、CONTENT_UNAVAILABLE                                                                                                                                                                  | 明确可重试与未完成范围；保留本地草稿及operation key。          |

03的工作流语义细分code保存在 `details.issues:[{path,code,message}]`，外层422 WORKFLOW_INVALID；不凭一个HTTP非200替代精确错误测试。01认证的专用code与04外部取证原因仍保留。message供人读，脚本只依据code；details不得含秘密、原始正文、上游完整响应或无权对象信息。

## 3. 写操作、幂等和只读边界

### 3.1 业务写操作

除本节列出的认证与校验例外，所有POST/PUT/PATCH业务写入要求 `Idempotency-Key:<UUID>`，可变对象的动作同时要求 `expectedVersion`。不存在的动作版本用文档规定的父聚合版本，禁止用0表示“无须检查”。创建新资源的body不伪造当前对象ID。

幂等权威模型为02的IdempotentOperation：服务端UUID主键id与header UUID key分离，唯一范围为`projectScopeKey+principalScopeKey+key`，同key换route也冲突。项目动作scope为`project:<UUID>`并保留真实projectId FK；创建项目等账号动作使用`account:<userId>`与null projectId，不伪造隐藏Project。scopeKey由服务端派生且非空，主体键区分HUMAN user与具体AgentCredential；换凭据不是同一主体的透明重试。

`requestDigest` 覆盖 method、规范化route及有业务意义的body，包括 expectedVersion、claimId、snapshotId、候选和工件摘要；排除password、confirmation secret、CSRF、requestId和header key本身。提交的文件在客户端重试前核对原始摘要，变了就不能复用旧操作key。

执行顺序为：当前认证与授权 → 查询相同幂等范围 → 同digest返回已存原结果／异digest409 → 首次进入02事务校验版本、条件和票据 → 写领域、审计及操作结果 → commit。合法重放先于旧expectedVersion拒绝，以处理“已成功但响应丢失”。重放仍重检当前可见性，不能越过撤权读取敏感结果；保存原响应的无秘密／无正文业务元数据与资源引用，返回相同业务ID、版本和状态，新的requestId不要求相同。

创建、发布、交付和批准的key记录至少保存到所引用正式对象归档后90天，v1不自动清理；不能用短TTL让同key晚重试变成新操作。只回滚失败事务不保留假成功操作，客户端可同key重试；有真实外部副作用的步骤不得因纯DB重试再次执行。

### 3.2 例外

以下不写业务IdempotentOperation，不能要求用户的登录密码、票据secret或会话响应进入幂等缓存：auth bootstrap/login/register/logout/logout-all/password/profile、device create/lookup/poll/deny、Agent self-revoke、action-preview、confirmation-ticket，以及无副作用的workflow validate。设备授权恢复遵循01，不用业务幂等代替proof。

Webhook按04的连接＋delivery ID管理，不使用Agent Idempotency-Key。`GET`不写业务事实；认证session bootstrap是01明确列出的会话初始化例外。

### 3.3 操作收据

`GET /operation-receipts/:operationKey?projectId=:p` 返回 `{operationKey,requestDigest,status:'COMMITTED',resultRefs,committedAt}`；项目动作传projectId，账号级创建项目动作省略它并按当前user账号scope查找。只有原主体，或原Agent的授权用户以当前HUMAN权限，能读取自己当前仍可见的结果；其他key与未提交操作统一404。不得因凭据更新而自动以新主体重放旧操作。

## 4. 资源 View

以下 View 包含公共字段；不得直接序列化Prisma全表，尤其不自动展开password、tokenHash、受限正文或原始外部payload。

| View            | data结构                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProjectView     | `{id,organizationId,key,name,description,version,defaultKnowledgeBaseId,archivedAt}`                                                                                                                                                               |
| RequirementView | `{id,projectId,seq,code,title,version,generation,phase,workStatus,currentUnderstandingRevisionId,currentPrdRevisionId,activeWorkflowInstanceId,deliveryScope,inputValidity,gateSummary}`                                                           |
| DocumentView    | `{id,projectId,knowledgeBaseId,requirementId,kind,version,currentPublishedRevisionId,archivedAt}`；知识库READ检查通过后才返回标题与修订列表。                                                                                                      |
| RevisionView    | `{id,documentId,seq,title,mimeType,byteLength,sha256,sourceRef,createdAt,status:'CANDIDATE'\|'PUBLISHED'\|'WITHDRAWN'}`；status是发布记录投影，revision正文自身不可变。                                                                            |
| TaskView        | `{id,projectId,requirementId,workflowInstanceId,workflowStepKey,code,title,roleId,version,generation,executionStatus,workStatus,responsibleUserId,currentClaimId,currentSnapshotId,currentArtifactSetId,inputValidity,blockedReasons,gateSummary}` |
| ClaimView       | `{id,taskId,taskGeneration,claimedBy:{kind,userId,agentCredentialId},claimedAt,releasedAt}`；不含凭据。                                                                                                                                            |
| SnapshotView    | `{id,taskId,taskGeneration,requirementGeneration,manifest,manifestDigest,createdAt}`，manifest为02唯一schema。                                                                                                                                     |
| ArtifactSetView | `{id,taskId,taskGeneration,snapshotId,manifestDigest,workflowDefinitionRevisionId,localRunId,items,candidateRevisionIds,createdAt}`，每项分开标记校验来源。                                                                                        |
| ReviewView      | `{id,projectId,kind,subject,taskId,version,status,subjectDigest,slots,preparedCodeEvidence,decisions,createdAt}`，slots及决定按当前权限过滤。                                                                                                      |
| ChangeView      | `{id,projectId,requirementId,generation,source,changedFields,targets,createdAt,recipients}`；不得把无权知识标题或路径带入targets。                                                                                                                 |

`inputValidity`、gateSummary和blockedReasons为02计算结果，不是客户端可写字段。列表统一 `data:{items:T[],nextCursor:string|null,hasMore:boolean}`；limit默认20最大100，cursor为base64url编码的schemaVersion与确定排序键，严格解析并绑定project/filter摘要；变过滤条件后旧cursor返回400。不返回跨权限总量。成员／角色特殊排序遵循01。

## 5. 项目与知识

01中成员、角色、ACL、凭据及认证route不在此重复；以下业务route的HUMAN写同样要Origin/CSRF，标注确认的动作还需01票据。

| 方法／路径                             | request或query                                                                                                                              | 响应与授权                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/projects`                        | `{limit?,cursor?}`                                                                                                                          | 当前用户可见ProjectView分页；Agent只能读自己项目。                                                                                                                                          |
| POST `/projects`                       | `{name(1..120),key,description?(<=2000)}`                                                                                                   | HUMAN；创建organization下项目、OWNER关系、六个初始ProjectRole、创建者角色assignment、一个默认PROJECT KB及创建者显式全部内容grant，单事务201 ProjectView；项目key组织内唯一。                |
| GET `/projects/:p`                     | 无                                                                                                                                          | 当前成员或该项目 `project:read` Agent；ProjectView。                                                                                                                                        |
| PATCH `/projects/:p`                   | `{expectedVersion,name?,description?,confirmation}`                                                                                         | HUMAN管理者＋PROJECT_UPDATE票据；不接受key、status、repositoryUrl；ProjectView。                                                                                                            |
| POST `/projects/:p/archive`            | `{expectedVersion,reason,confirmation}`                                                                                                     | HUMAN OWNER；归档阻止新业务写入但保留合法历史读取，不物理删除；ProjectView。                                                                                                                |
| POST `/projects/:p/requirements`       | `{title(1..200),description?(<=10000)}`                                                                                                     | 当前业务角色HUMAN或 `requirement:propose` Agent；201 RequirementView，原子分配项目序号。                                                                                                    |
| GET `/projects/:p/requirements`        | `{phase?,workStatus?,limit?,cursor?}`                                                                                                       | `requirement:read`；权限内分页。                                                                                                                                                            |
| GET `/requirements/:id`                | 无                                                                                                                                          | `requirement:read`；RequirementView。                                                                                                                                                       |
| PATCH `/requirements/:id`              | `{expectedVersion,title?,description?}`                                                                                                     | 责任人或项目管理者；Agent仅本角色被分配的产品候选范围；返回view。不得接收phase/status/generation/acceptanceCriteria，正式规则和验收写入候选修订再评审。                                     |
| POST `/requirements/:id/archive`       | `{expectedVersion,reason,confirmation}`                                                                                                     | HUMAN OWNER/ADMIN；ARCHIVED，不删除产物；view。                                                                                                                                             |
| POST `/projects/:p/knowledge-bases`    | `{key,name,visibility:'PROJECT'\|'RESTRICTED'}`                                                                                             | HUMAN OWNER/ADMIN；创建者显式grant+默认publicationApprover，201 KB View；其他成员不自动获PROPOSE/PUBLISH。                                                                                  |
| GET `/projects/:p/knowledge-bindings`  | 无                                                                                                                                          | 当前项目读取；仅返回当前可读文档引用，不泄露私库标题。                                                                                                                                      |
| PUT `/projects/:p/knowledge-bindings`  | `{expectedVersion:Project.version,bindings:[{documentId,roleId:null或UUID,required:boolean}],reason,confirmation}`                          | HUMAN OWNER/ADMIN＋PROJECT_KNOWLEDGE_BINDINGS票据，且每文档当前READ；替换绑定、递增knowledgeBindingsVersion并废止受影响任务快照，返回`{bindings,knowledgeBindingsVersion,projectVersion}`。 |
| GET `/projects/:p/knowledge-bases`     | `{limit?,cursor?}`                                                                                                                          | 当前KB READ筛选后分页；管理者可从ACL管理接口读取无正文的管理ID，不在普通列表暴露受限标题。                                                                                                  |
| POST `/knowledge-bases/:kb/documents`  | `{kind:'UNDERSTANDING'\|'DECISION'\|'PRD'\|'KNOWLEDGE',requirementId?}`                                                                     | 当前KB PROPOSE，Agent还需requirement:propose或knowledge:propose；UNDERSTANDING/PRD必须同项目requirementId；201 DocumentView。                                                               |
| GET `/knowledge-bases/:kb/documents`   | `{kind?,limit?,cursor?}`                                                                                                                    | KB READ；DocumentView分页；候选仅作者、明确评审者或当前PROPOSE/PUBLISH主体可见。                                                                                                            |
| POST `/documents/:id/revisions`        | `{expectedVersion,title,bodyBase64,mimeType,sourceRef?,basisUnderstandingRevisionId?,deliveryScope?,acceptance?:[{key,text,verification}]}` | KB PROPOSE及类型scope；201 `{document:DocumentView,revision:RevisionView}`；服务器算SHA；PRD必须含当前确认理解、deliveryScope和至少一条02验收条款，verification仅TEST/INSPECTION/DEMO。     |
| GET `/documents/:id/revisions`         | `{limit?,cursor?}`                                                                                                                          | 当前KB READ及候选可见性；revision分页。                                                                                                                                                     |
| GET `/documents/:id/revisions/:rid`    | 无                                                                                                                                          | RevisionView；rid必须属于该doc及同项目，不能枚举别库。                                                                                                                                      |
| GET `/document-revisions/:rid/content` | 无                                                                                                                                          | 当前KB READ及候选可见性，data=`{revisionId,mimeType,encoding:'base64',bodyBase64,byteLength,sha256}`；`Cache-Control:no-store`。                                                            |
| POST `/documents/:id/restore`          | `{expectedVersion,sourceRevisionId,title?}`                                                                                                 | KB PROPOSE；按历史原文产生新候选revision，不改变发布指针；201。                                                                                                                             |
| POST `/documents/:id/withdraw`         | `{expectedVersion,revisionId,reason,confirmation}`                                                                                          | HUMAN当前KB REVOKE；清当前发布指针时不自动回退旧版，追加withdraw及变更；DocumentView。                                                                                                      |
| GET `/knowledge-bases/:kb/search`      | `{q(1..500),limit?,cursor?}`                                                                                                                | KB READ，仅当前可用发布版；data=`{items:[{revisionId,documentId,title,excerpt,sha256}],nextCursor,hasMore,truncated}`；v1采用本地关键词检索，外部embedding非必需。                          |
| GET `/projects/:p/model-policy`        | 无                                                                                                                                          | 管理者得完整配置，普通成员只得到是否允许当前资料处理；无秘密。                                                                                                                              |
| PUT `/projects/:p/model-policy`        | `{expectedVersion:Project.version,mode:'DENY_ALL'\|'ALLOWLIST',providerRefs:string[],reason,confirmation}`                                  | HUMAN OWNER/ADMIN二验；providerRefs只可来自部署批准注册表，变更带AuditEvent；data=`{mode,providerRefs,version,projectVersion}`。                                                            |

v1正文支持Markdown UTF-8；已有PDF／TXT按06保留原文件及解析文本候选，不自动取得发布资格。整库导入只能显式选定文件并产生候选，禁止CLI扫描目录后自动批准或缺席即删。知识索引、切片和摘要的当前授权与撤销检查不能等待后台重建。

所有文档创建、revision和restore对Agent按同一规则派生scope：UNDERSTANDING／PRD及绑定requirement的DECISION要求 `requirement:propose`，KNOWLEDGE及无requirement的DECISION要求 `knowledge:propose`；两者都同时要求当前KB PROPOSE、当前项目及凭据角色允许的候选范围。不能用“二者任一scope”或仅授权人有KB写权限来允许只读Agent写入。文档kind和requirement绑定创建后不可通过revision更改，以免借改类型绕过scope。

## 6. 流程、任务与快照

流程配置与角色包的精确schema、validate/publish route由03定义；发布要求HUMAN项目管理者票据，Agent的 workflow:propose 只允许候选校验，不保存另一套批准权威。

### 6.1 角色包登记与资源存储

首版固定使用受控 typed JSON 上传，不做zip解压或任意远程仓库安装。内置包随CLI发行并按明确白名单登记，项目私有包由当前HUMAN OWNER/ADMIN上传并二次确认，不从目录环境配置或包脚本自动注册。

`RolePackageVersion {id:UUID,projectId:UUID|null,packageId:string,version:SemVer,manifest:Json,manifestDigest:sha256,createdByStampId:UUID|null,createdAt}`；内置projectId为null、无用户stamp且有发行sourceRef，项目包两项均非null。`RolePackageResource {id:UUID,rolePackageVersionId,resourceKey,path,mediaType,byteLength,sha256,bodyBytes:Bytes}`。资源按(rolePackageVersionId,resourceKey)及(rolePackageVersionId,path)唯一；版本按项目或内置scope、packageId、version唯一，NULL范围用独立partial unique而非依赖NULL比较。任何版本一旦登记不可覆盖，改内容必须换SemVer。

manifest严格按03验证；resources中的每项必须精确对应声明的resourceId，服务端核原始bytes长度及hash，拒绝缺件、多件、重复路径、绝对路径、点段、symlink或未知字段。单资源4MiB、总原始bytes10MiB、请求16MiB，文件不写入任意主机路径，不自动执行AUXILIARY_SCRIPT。项目包不得与内置packageId同名shadow；所有项目成员可读这些项目流程资料，因此受限知识正文不得嵌入包中，只通过快照的KB授权引用。

| 方法／路径                                                                          | 请求与权限                                                                                                                                   | data                                                                                                                        |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET `/projects/:p/role-packages`                                                    | 当前workflow:read；含可见内置与本项目版本。                                                                                                  | `{items:[{id,packageId,version,roleKey,manifestDigest,scope:'BUILTIN'\|'PROJECT'}],nextCursor,hasMore}`。                   |
| POST `/projects/:p/role-packages`                                                   | HUMAN OWNER/ADMIN＋ROLE_PACKAGE_PUBLISH票据；`{expectedVersion:Project.version,manifest,resources:[{resourceId,bodyBase64}],confirmation}`。 | `{packageVersionId,packageId,version,manifestDigest,projectVersion}`，201；同version同digest合法重试不重复，不同digest409。 |
| GET `/projects/:p/role-packages/:packageId/versions/:version`                       | 当前workflow:read，project私有包不跨项目返回。                                                                                               | `{packageVersionId,manifest,manifestDigest}`。                                                                              |
| GET `/projects/:p/role-packages/:packageId/versions/:version/resources/:resourceId` | 同上；只返回登记的资源。                                                                                                                     | `{resourceId,encoding:'base64',bodyBase64,byteLength,sha256,mediaType}`。                                                   |

### 6.2 实例、任务和上下文

流程定义发布的body精确为 `{expectedVersion:Project.version,expectedCurrentRevision:number,definition:WorkflowDefinition,packageLocks:[{roleKey,packageId,version,packageDigest}],confirmation}`。首次expectedCurrentRevision为0，仅表示不存在已发布修订；它不是对象CAS版本，expectedVersion仍须>=1。之后必须等于该workflowKey当前revision。服务端编译03的角色、包与系统门禁后生成compiledDigest并纳入01 ActionBinding，客户端不能自报系统门槛。

| 方法／路径                                                    | request／query                                             | data与权限                                                                                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/projects/:p/workflow-definitions`                       | `{limit?,cursor?}`                                         | workflow:read；`{items:[{workflowKey,title,version,currentPublishedRevisionId}],nextCursor,hasMore}`。                                                                |
| POST `/projects/:p/workflow-definitions/validate`             | `{definition,packageLocks}`                                | workflow:propose或HUMAN项目管理者；只校验无写入，200 `{valid,issues:[{path,code,message}],compiledDigest:string\|null}`；非法结构仍400，合法结构业务问题valid=false。 |
| POST `/projects/:p/workflow-definitions/:workflowKey/publish` | 本节准确发布body，path key必须等于definition.workflowKey。 | HUMAN OWNER/ADMIN＋WORKFLOW_CONFIG_PUBLISH票据；追加不可变revision和CAS发布指针、Project.version，201 `{definitionRevisionId,revision,digest,projectVersion}`。       |
| GET `/workflow-definition-revisions/:rid`                     | 无                                                         | 当前workflow:read；`{id,projectId,workflowKey,revision,digest,definition,compiledRules}`。                                                                            |

| 方法／路径                                     | request                                                                                                                                                                            | 响应与权限                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST `/requirements/:id/workflow-instances`    | `{definitionRevisionId,expectedRequirementVersion,stepBindings:[{stepKey,roleId,responsibleUserId,repositoryIds:UUID[]}],roleSlotBindings:[{slotKey,roleId,userId}],confirmation}` | HUMAN OWNER/ADMIN；准确绑定全部step/slot；IMPL步骤必须声明非空代码仓库范围并校验同项目；201 `{instance,tasks,requirementVersion}`，不要求先有PRD发布版。                                                                             |
| GET `/workflow-instances/:id`                  | 无                                                                                                                                                                                 | 当前项目workflow:read；实例及准确绑定，不返回无权产物正文。                                                                                                                                                                          |
| POST `/workflow-instances/:id/upgrade`         | `{expectedVersion,definitionRevisionId,stepBindings,roleSlotBindings,reason,confirmation}`                                                                                         | HUMAN OWNER/ADMIN；明示升级影响、版本切换和旧claim失效；`{instance,affectedTaskIds}`。                                                                                                                                               |
| GET `/projects/:p/tasks/ready`                 | `{roleId?,limit?,cursor?}`                                                                                                                                                         | task:read；Agent固定本凭据role，无任意改角色；先SQL项目与责任范围过滤，再评估02依赖门槛；TaskView分页。                                                                                                                              |
| GET `/requirements/:id/tasks`                  | `{limit?,cursor?}`                                                                                                                                                                 | task:read；需求任务分页。                                                                                                                                                                                                            |
| GET `/tasks/:id`                               | 无                                                                                                                                                                                 | task:read；TaskView。                                                                                                                                                                                                                |
| POST `/tasks/:id/claim`                        | `{expectedVersion}`                                                                                                                                                                | 当前任务责任人或其单角色Agent＋task:claim；一次claim写主体并推进版本；data=`{task,claim}`。                                                                                                                                          |
| POST `/tasks/:id/release`                      | `{expectedVersion,claimId,reason,force:false}`，管理员可`force:true,confirmation`                                                                                                  | 本claim主体＋task:release；force仅HUMAN OWNER/ADMIN票据；`{task,releasedClaimId}`。                                                                                                                                                  |
| POST `/tasks/:id/work-status`                  | `{expectedVersion,action:'BLOCK'\|'UNBLOCK'\|'PAUSE'\|'RESUME'\|'CANCEL',reason,blockedByUserId?,resumeCondition?}`                                                                | 当前claim＋clarification:write Agent仅可BLOCK；UNBLOCK/PAUSE/RESUME/CANCEL只允许02规定的责任HUMAN或管理者，不能借action写DONE；返回TaskView。                                                                                        |
| POST `/requirements/:id/work-status`           | `{expectedVersion,action:'BLOCK'\|'UNBLOCK'\|'PAUSE'\|'RESUME'\|'CANCEL',reason,resumeCondition?}`                                                                                 | HUMAN责任人/管理者；按02传播限定允许的写入；RequirementView。                                                                                                                                                                        |
| POST `/tasks/:id/context-snapshots`            | `{expectedVersion,claimId,candidateRevisionIds?:UUID[]}`                                                                                                                           | 当前claim＋context:create；候选只对PRODUCT/NONE可显式选取；201 `{snapshot,taskVersion}`；快照创建不推进旧业务阶段。                                                                                                                  |
| GET `/context-snapshots/:sid`                  | 无                                                                                                                                                                                 | 当前context:read；SnapshotView，任何必需引用已失权则整个读取拒绝，不返回部分可误用manifest。                                                                                                                                         |
| GET `/context-snapshots/:sid/resources/:refId` | 无                                                                                                                                                                                 | 当前正文／资源授权；data=`{refId,encoding:'base64',bodyBase64,byteLength,sha256}`，不能从manifest提供任意file路径让服务器读取。                                                                                                      |
| POST `/requirements/:id/clarifications`        | `{expectedVersion,taskId?,question,impact,assignedUserId,dependencyIds:UUID[],resumeCondition}`                                                                                    | clarification:write且项目责任范围匹配；question/impact/resumeCondition分别1..2000字，依赖最多32且同需求、无环；201 `{clarification,requirementVersion}`。                                                                            |
| POST `/clarifications/:cid/responses`          | `{expectedVersion,answer,resolution:'PROPOSED'\|'CONFIRMED'\|'DEFERRED',resolutionRefs:[{revisionId,purpose:'RULE'\|'ACCEPTANCE'\|'UNKNOWN',lineStart,lineEnd}]}`                  | Agent＋clarification:write仅可PROPOSED，不关闭正式阻塞；指定回答HUMAN可CONFIRMED／DEFERRED。REF最多32、同项目且当前可读、行范围真实存在；CONFIRMED须至少一处RULE或ACCEPTANCE落点，DEFERRED保留未决。data=`{clarification,version}`。 |

没有 `PATCH /tasks/:id/status`，没有 `PATCH Requirement.status`，也不提供直接更新snapshot内容的入口。重开和返工由02的评审决定／基线变更／显式动作触发，不能用任意字符串目标状态替代有权限动作。

澄清是正式共享问题，不要求把本地每轮问答都登记。PROPOSED只是受限主体提交的建议；行号校验不证明决定语义已经落实，正式UNDERSTANDING／PRD仍需人针对准确版本批准。本地产品工作流可以先整理对话与候选，再一次提出准确版本的理解确认，而不因每题回答强制取得HUMAN凭据。

## 7. 工件、评审与变更

### 7.1 交付请求

`POST /tasks/:id/artifact-sets`，需要task:deliver、当前claim、幂等键：

```ts
type DeliverArtifactSet = {
  expectedVersion: number;
  claimId: string;
  snapshotId: string;
  workflowDefinitionRevisionId: string;
  localRunId: string;
  candidateRevisionIds: string[];
  items: Array<{
    kind: 'PRD' | 'DESIGN' | 'IMPL' | 'CASES' | 'RELEASE';
    schemaVersion: '1.0';
    storage: 'HOSTED' | 'GIT_REF';
    mediaType: string;
    sha256: string;
    byteLength: number;
    bodyBase64?: string;
    projectRepositoryId?: string;
    commitSha?: string;
    repoPath?: string;
    summary?: string;
    checks: Array<{ code: string; passed: boolean; message?: string }>;
  }>;
};
```

至少一个候选或工件；候选必须是本step允许的准确revision，属于同项目和允许KB。HOSTED必须bodyBase64且无git字段，GIT_REF必须repo/commit/path且无bodyBase64；禁止任意HTTP uri。artifact统一mediaType，文档revision保持mimeType，不在同一实体存两个同义字段。

服务器重算HOSTED摘要及长度，不信客户端自报；GIT_REF客户端摘要是提交方声明，04受控取证后才记录PLATFORM_CHECK。代码门槛检查每个相关仓库，不能用摘要相同代替他人评审。响应201 `{task:TaskView,artifactSet:ArtifactSetView,operationKey}`。

### 7.2 评审与变更接口

| 方法／路径                                         | request／query                                                                                     | 响应与语义                                                                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/tasks/:id/artifact-sets`                     | `{limit?,cursor?}`                                                                                 | task:read，ArtifactSetView分页；正文另需原资源权限。                                                                                                                            |
| POST `/review-requests`                            | `{subject:{kind:'DOCUMENT_REVISION'\|'TASK_ARTIFACT_SET',id},expectedVersion,taskId?}`             | review:request；kind和slots服务端派生，不接受approved或任意slot。未给taskId且候选属于唯一当前Task产物时自动关联；多于一个需明确taskId，无当前产物则按独立候选。201 ReviewView。 |
| GET `/review-requests/:rid`                        | 无                                                                                                 | review:read及subject当前访问权，ReviewView。                                                                                                                                    |
| POST `/review-requests/:rid/prepare-code-evidence` | `{expectedVersion}`                                                                                | 本请求提交者HUMAN、当前slot审批HUMAN，或仍有任务claim的task:deliver Agent；04外部核验后短事务CAS绑定证据并递增ReviewRequest.version，响应ReviewView。非IMPL返回422。            |
| POST `/review-requests/:rid/decisions`             | `{slotId,decision:'APPROVE'\|'CHANGES_REQUESTED'\|'REJECT',expectedVersion,comment?,confirmation}` | 仅当前slot资格HUMAN；有准确版本的票据；最后ALL批准同事务完成02发布／验收效应，响应`{review,subjectResult,task?,requirement?}`。                                                 |
| POST `/review-decisions/:did/revoke`               | `{expectedVersion:所属ReviewRequest.version,reason,confirmation}`                                  | 02撤销资格＋01二验；决定没有可变version，normalizer绑定父request版本；追加撤销，不删旧决定，响应`{revocation,affectedTaskIds}`。                                                |
| GET `/projects/:p/review-requests`                 | `{assignedToMe?:boolean,status?,limit?,cursor?}`                                                   | 当前review:read，Agent仅本角色关联请求；ReviewView分页，Web待办依据实际slot指派。                                                                                               |
| GET `/projects/:p/changes`                         | `{pending?:boolean,roleId?,limit?,cursor?}`                                                        | change:read；SQL先过滤recipient与权限，按(createdAt,id)升序分页，不跨过遗漏未确认项。                                                                                           |
| POST `/change-recipients/:recipientId/ack`         | `{expectedVersion}`                                                                                | 精确收件用户＋该角色change:ack；幂等，不恢复旧审批；`{recipientId,eventId,roleId,ackedAt}`。                                                                                    |
| POST `/change-recipients/:recipientId/reassign`    | `{expectedVersion,userId,roleId,reason,confirmation}`                                              | HUMAN管理者，目标具备当前角色和访问权；追加转派记录，原确认不冒充新人的处理；`{oldRecipient,newRecipient}`。                                                                    |
| GET `/projects/:p/board`                           | 无                                                                                                 | 当前项目read，聚合阶段、工作情况、输入有效性和门禁，不把曾有签字标为当前有效。                                                                                                  |
| GET `/projects/:p/trace`                           | `{requirementId?,limit?,cursor?}`                                                                  | 当前可见范围内的限定类型关系图；按仓库、项目、端点和linkType校验，不能查到别项目资源。                                                                                          |

ReviewRequest.kind精确为 UNDERSTANDING_CONFIRM、PRD_PUBLICATION、KNOWLEDGE_PUBLICATION、TASK_ACCEPTANCE、RELEASE_ACCEPTANCE。两种publication按钮必须明确“批准并发布”。先准备代码证据再preview／二验，prepared evidence过期须刷新并重新确认，不能在最终事务里悄悄换一份证据。

## 8. 服务实现与兼容规则

- 05不是让实施者自动生成一套平行REST服务器；在现有module/controller/service中替换新契约，按01–04增加必要模块与用例服务。
- auth、候选、workflow、tasks、reviews、knowledge和integrations均使用同一Principal、权限服务、canonicalizer、事务执行器、门禁evaluator和审计写入；不做通用Repository层包裹Prisma。
- 旧JWT刷新、指针索引sync、本地签字、任意status写接口和未锁版本PRD修订在新router中不存在。已有源文件和历史记录按06映射保存，不因移除路由而删数据。
- `docs/api.md`、CLI help、角色资源和Web请求一起更新；在测试中导出OpenAPI并检查关键routes/DTO/error字段，测试编译成功不能代替真实bootstrap和HTTP数组校验。
- 所有未来调用方，包括MCP，都消费此契约；v1不实现MCP server，不能将tools调用确认等同于领域批准。
