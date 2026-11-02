# 02：领域模型、版本、状态与事务

日期：2026-11-01。本文是目标技术规格，不是已完成的代码、迁移或验证。角色工作流在本地执行，平台只管理正式共享对象、版本、责任和批准，不运行任意角色步骤。

身份与ACL字段以[01](01-identity-permissions.md)为准；流程与包schema以[03](03-local-workflows-clients.md)为准；代码来源与评审证据以[04](04-code-hosting-adapters.md)为准；公开请求响应以[05](05-api-contract.md)为准；迁移和开发任务以[06](06-development-tasks-and-verification.md)为准。本册权威定义领域实体、状态与事务。

## 1. 数据实现约定

- 所有内部ID为UUID，时间为`timestamptz`，正文为Prisma `Bytes`／PostgreSQL `bytea`，JSON为`jsonb`；不把文件内容编码成数据库内Base64。
- 可变聚合具有正整数version，成功业务修改递增一次；generation是执行或输入代次，不是数据库CAS版本。所有关键写动作检查expectedVersion，不能用最后写入获胜。
- 每个项目对象有projectId，核心关系使用真实FK；带projectId的复合FK在迁移中保证引用同项目对象。Prisma无法完整表达的CHECK、partial unique、deferred FK和不可变trigger明确写在migration中，并有真实数据库测试。
- 原始revision、publication、快照、工件、决定、撤销和事件不可原位覆盖；数据库trigger拒绝对其业务内容UPDATE/DELETE。可更新的是明确列出的发布指针、状态、版本、receipt及查询投影，不能以“修数据”为由更新不可变正文。
- 发布与审计对象使用RESTRICT或NO ACTION，不级联删除。项目、库、角色、文档、仓库归档或停用；User和历史stamp保持可引用，普通API不提供物理删除历史的入口。
- 客户端不提供createdBy、PrincipalStamp、发布状态或digest作为可信事实，服务端根据实际请求与原始bytes生成。

## 2. 聚合与精确字段

通用createdAt/updatedAt仅用于明确可变对象；下表`?`代表nullable，非问号字段必填。字符串限制遵守05，说明原始内容的sourceRef不含本机绝对路径或秘密。

### 2.1 项目、需求与流程实例

| 实体 | 字段与约束 |
| --- | --- |
| Project | 保留`id,organizationId,key,name,description?,createdById,createdAt,updatedAt`；新增`version=1,knowledgeBindingsVersion=1,defaultKnowledgeBaseId,archivedAt?,nextRequirementSeq=1`；唯一`(organizationId,key)`，key不可改。默认KB与项目同事务创建。 |
| Requirement | `id,projectId,seq,code,title,description,version=1,generation=1,phase,workStatus,workReason?,workOwnerUserId?,resumeCondition?,workStatusChangedAt?,workStatusByStampId?,responsibleUserId,currentUnderstandingRevisionId?,currentPrdRevisionId?,activeWorkflowInstanceId?,deliveryScope?,nextTaskSeq=1,createdByStampId,createdAt,updatedAt,archivedAt?`；唯一`(projectId,seq)`、`(projectId,code)`；responsible默认创建者，必须为当前项目成员。 |
| ProjectWorkflowDefinition | `id,projectId,workflowKey,currentPublishedRevisionId?,version=1,archivedAt?,createdAt,updatedAt`；唯一`(projectId,workflowKey)`，发布指针引用本定义revision。 |
| WorkflowDefinitionRevision | `id,projectId,definitionId,revision,protocolVersion='1.0',digest,definition:Json,compiledRules:Json,createdByStampId,createdAt`；唯一`(definitionId,revision)`；正文与编译结果不可改。compiledRules为03的resolvedRoles/packageLocks/systemGates。 |
| WorkflowInstance | `id,projectId,requirementId,definitionRevisionId,version=1,workStatus,createdByStampId,createdAt,updatedAt,retiredAt?`；同需求只允许一条retiredAt为空的实例，Requirement.activeWorkflowInstanceId精确引用它。 |
| WorkflowStepBinding | `id,projectId,workflowInstanceId,stepKey,roleId,responsibleUserId`；唯一`(workflowInstanceId,stepKey)`；roleId必须为发布编译映射，责任人当前有该角色。 |
| WorkflowRoleSlotBinding | `id,projectId,workflowInstanceId,slotKey,roleId,userId`；唯一`(workflowInstanceId,slotKey)`；所有必需slot绑定真实当前有资格的成员，不能缺人即跳过。 |

Project默认KB使用预生成UUID，Project→默认KB的同项目FK设置DEFERRABLE INITIALLY DEFERRED；创建事务插Project、KB、OWNER、预置角色和创建者显式内容grant后一次提交，不能留下长期nullable默认KB。用户与Organization继续使用现有业务身份，角色及成员关系按01替换。

`ProjectModelPolicy {projectId:UUID PK/FK,version:Int=1,mode:DENY_ALL|ALLOWLIST,providerRefs:String[],updatedByStampId,updatedAt}`同项目初始化为DENY_ALL及空列表。模型策略修改使用Project.version作ActionBinding CAS并同时递增两者版本。基础入库、关键词检索与上下文不调用外部embedding；可选模型适配器调用必须携带project/principal/来源revision目的并检查当前策略、KB READ及部署提供商白名单，无上下文的旧embedding调用不得进入新核心路径。管理员allowlist只是许可，不自动把正文发给外部模型或绕过真实资料权限。

`deliveryScope={participatingRoleIds:UUID[],requiredOutputKinds:ArtifactKind[],excludedRoles:[{roleId,reason}]}`；数组去重排序。PRD_PUBLICATION的最后批准绑定此范围和scopeDigest，实例编译必须覆盖全部参与角色与产物，不能通过自定义把IMPL要求删掉。例外裁剪只影响明确允许的项目步骤，不取消系统代码门槛或唯一RELEASE汇聚。

没有实例时，UNDERSTANDING／PRD默认评审人是Requirement.responsibleUserId，所需角色为项目预置product角色；该成员当前没有此角色时创建评审失败，不能按OWNER自动补资格。有实例时从对应PRODUCT step及roleSlotBinding派生，不再硬编码六角色流水线。

### 2.2 文档、知识与正式发布

| 实体 | 字段与约束 |
| --- | --- |
| KnowledgeBase | `id,projectId,key,name,visibility:PROJECT\|RESTRICTED,version=1,authzVersion=1,publicationApproverUserId,publicationApproverRoleId?,archivedAt?,createdAt,updatedAt`；唯一`(projectId,key)`。grant和授权规则归01；库创建者获得显式USER内容grant，不存在管理身份隐式读后门。 |
| KnowledgeDocument | `id,projectId,knowledgeBaseId,requirementId?,kind:UNDERSTANDING\|DECISION\|PRD\|KNOWLEDGE,version=1,nextRevisionSeq=1,currentPublishedRevisionId?,archivedAt?,createdAt,updatedAt`；kind和requirement绑定不可通过修订更换。UNDERSTANDING/PRD必须有同项目requirement。 |
| DocumentRevision | `id,projectId,documentId,seq,title,mimeType,bodyBytes,byteLength,sha256,sourceRef?,basisUnderstandingRevisionId?,deliveryScope?,acceptance?,createdByStampId?,importBatchId?,createdAt`；唯一`(documentId,seq)`；两种创建来源精确二选一，原始bytes与SHA不可改。 |
| DocumentPublication | `id,projectId,documentId,revisionId,kind:PUBLISH\|WITHDRAW,reviewRequestId?,previousPublicationId?,reason?,createdByStampId,createdAt`；PUBLISH由最后批准产生，WITHDRAW由01票据产生；禁止update旧publication。 |
| DocumentChunk | `id,projectId,revisionId,position,headingPath,content,indexVersion,createdAt`；唯一`(revisionId,indexVersion,position)`；属于可重建派生物，不能反向写正文或发布指针。 |

`sourceRef={sourceSystem:string,sourceId:string,sourceRevision:string|null,logicalPath:string|null}`，各值最长500；拒绝凭据、带userinfo URL或本机绝对路径。人工明确选择的外部资料可以作为候选来源，不自动形成第二发布权威。

PRD候选必须带`basisUnderstandingRevisionId`、deliveryScope和`acceptance:[{key,text,verification:'TEST'|'INSPECTION'|'DEMO'}]`，至少一条、最多200条、key按05标识规则且唯一，text1..2000。最后发布仍核对basis等于当前确认理解及参与范围。验收条款存在不代表语义正确，人在准确版本评审中负责业务判定。

UNDERSTANDING可以先于PRD存在；确认理解与发布PRD使用不同ReviewRequest。新revision不直接改变发布指针；restore只生成新候选。WITHDRAW当前revision后清空指针，不自动回退旧版。除法定留存／删除专用流程外，普通业务不删除历史正文。

KnowledgeDocument与现Source/Entry合并为同一稳定身份，不再维护一套可独立批准的索引。CLI改名移动文件不换documentId；扫描遗漏不调用deleteMany。只有平台PUBLISH确定版本可进入正式共享知识，候选和草稿不能因更新时间较新进入定稿上下文。

### 2.3 任务、认领和输入快照

| 实体 | 字段与约束 |
| --- | --- |
| Task | `id,projectId,requirementId,workflowInstanceId,workflowStepKey,seq,code,title,roleId,responsibleUserId,version=1,generation=1,executionStatus,workStatus,workReason?,workOwnerUserId?,resumeCondition?,workStatusChangedAt?,workStatusByStampId?,currentClaimId?,currentSnapshotId?,currentArtifactSetId?,createdAt,updatedAt,retiredAt?`；唯一`(workflowInstanceId,workflowStepKey)`、`(requirementId,seq)`；无任意task status写API。 |
| TaskDependency | `id,projectId,fromTaskId,toTaskId,type='BLOCKS'`；唯一`(fromTaskId,toTaskId,type)`；两端同实例，无自环或环，只从发布定义生成。 |
| TaskRepository | `id,projectId,taskId,projectRepositoryId`；唯一`(taskId,projectRepositoryId)`；两端同项目真实FK，从实例stepBindings的repositoryIds生成。IMPL步骤至少一仓，非代码步骤为空或显式只读参考，不由交付方临时缩小代码范围。 |
| TaskClaim | `id,projectId,taskId,taskGeneration,claimedByStampId,claimedByUserId,agentCredentialId?,claimedAt,releasedAt?,releaseReason?,releasedByStampId?`；每task仅一条releasedAt为空的有效claim，永久关联原主体，不是lease。 |
| ContextSnapshot | `id,projectId,requirementId,taskId,requirementGeneration,taskGeneration,workflowDefinitionRevisionId,claimId,manifest:Json,manifestDigest,createdByStampId,createdAt`；不可变，当前task指向一个明确snapshot。 |
| SnapshotResourceRef | `id,projectId,snapshotId,refKey,kind:DOCUMENT_REVISION\|ARTIFACT\|ROLE_RESOURCE,documentRevisionId?,artifactId?,rolePackageResourceId?,sha256,byteLength,mediaType,authority:PUBLISHED\|CANDIDATE`；目标FK精确一项非空，唯一`(snapshotId,refKey)`，INDEX各资源ID供影响追踪。 |

认领主体必须为任务responsibleUser本人或其同角色受限Agent，且依赖当前有效。roleSlotBinding确定评审人，不代表可抢其他角色或他人责任任务。管理员不能以自己的Agent静默接管，需在Web显式release／重新绑定并审计。

IMPL ArtifactSet中的仓库集合必须覆盖TaskRepository的完整代码范围，且每仓至少有准确commitSha及所需评审证据；出现未登记仓库拒绝。修改代码范围只通过有权HUMAN实例升级形成新task generation，不能在deliver时临时删仓让缺失证据被忽略。

TaskClaim claimedByStamp固定原始认证主体；同一个user的两个AgentCredential不视为同一claim主体。普通release只释放当前凭据claim；强制release仅HUMAN管理员票据。释放、返修、基线失效、实例升级均递增task.version和generation、清当前claim/snapshot/ArtifactSet指针，旧记录保留。

## 3. 输入快照的唯一manifest与构建算法

```ts
type SnapshotManifest = {
  schemaVersion: '1.0';
  projectId: string;
  requirementId: string;
  requirementGeneration: number;
  taskId: string;
  taskGeneration: number;
  workflowDefinitionRevisionId: string;
  workflowDigest: string;
  knowledgeBindingsVersion: number;
  stepKey: string;
  baselinePolicy: 'NONE'|'PUBLISHED_PRD';
  productBaseline: null|{understandingRevisionId:string;prdRevisionId:string;prdSha256:string;deliveryScopeDigest:string};
  resources: Array<{refId:string;kind:string;targetId:string;sha256:string;byteLength:number;mediaType:string;authority:'PUBLISHED'|'CANDIDATE'}>;
};
```

resources按refId字典序排序，target引用ID和摘要全部参与05 canonical SHA；manifest不包含正文、secret、本机绝对路径或可被服务器任意读取的URL。资源包含：编译包内必需输入、当前PRD基线、显式要求的知识revision、已有效接受的前置工件。项目级`ProjectKnowledgeBinding(id,projectId,documentId,roleId?,required:boolean,createdByStampId,createdAt)`保存管理员明确指定的知识，唯一(projectId,documentId,roleId)，null角色有独立partial unique；不通过RAG命中决定强制规范是否存在。绑定替换递增Project.version及knowledgeBindingsVersion，废止受影响角色的当前任务及依赖后继快照；历史manifest仍保留准确绑定版本。

快照构建：

1. 校验当前Principal、任务、claim及expectedVersion；读取定义和输入引用，先做当前权限检查。
2. PRODUCT/NONE可以没有PRD，body显式candidateRevisionIds只允许同项目、当前可见、对应产品候选；在manifest标CANDIDATE，不当权威。其他step必须取当前已发布PRD和其所依赖的准确理解。
3. 对必需知识按project/role绑定选当前发布版，对前置工件按依赖有效性取准确集合；检查全部bytes可取得且SHA与长度匹配。缺件、失权、撤销或基线未定稿，不返回部分可误用快照。
4. 在本册第8节事务中重新读取发布指针、requirement/task generation、claim与ACL，任一变化则409 BASELINE_STALE。写snapshot/ref和task.currentSnapshotId，task.version++；不改变phase。
5. 读取snapshot和任何resource时重新做当前授权、撤销及可用性检查。快照固定内容，不冻结未来权限；索引尚未重建不能绕过撤销。

文件取得与模型消费是客户端证据，不等于AI理解与产物符合性。下游不因上游scope扩大而自动获得受限知识READ；无法取得必需内容明确阻塞交接。

## 4. 不可变交付与版本化评审

| 实体 | 字段与约束 |
| --- | --- |
| Artifact | `id,projectId,taskId,kind:PRD\|DESIGN\|IMPL\|CASES\|RELEASE,schemaVersion='1.0',storage:HOSTED\|GIT_REF,mediaType,byteLength,sha256,bodyBytes?,projectRepositoryId?,commitSha?,repoPath?,summary?,checks:Json,submittedByStampId,createdAt`；HOSTED与git定位精确二选一；原始交付不可改。 |
| ArtifactValidation | `id,projectId,artifactId,source:SUBMITTER_ASSERTION\|PLATFORM_CHECK,validatorId,validatorVersion,passed,checks:Json,createdByStampId?,webhookReceiptId?,createdAt`；来源二选一，独立验证追加，不覆盖提交方声明。 |
| ArtifactSet | `id,projectId,taskId,taskGeneration,snapshotId,manifestDigest,workflowDefinitionRevisionId,localRunId,createdByStampId,createdAt`；不可变集合，清单按artifact／revision ID排序。 |
| ArtifactSetItem | `id,projectId,artifactSetId,artifactId?,candidateRevisionId?`；目标FK二选一；每set目标唯一；candidateRefs与artifacts至少一种非空。 |
| ReviewRequest | `id,projectId,kind,subjectKind:DOCUMENT_REVISION\|TASK_ARTIFACT_SET,documentRevisionId?,artifactSetId?,taskId?,taskGeneration?,requirementGeneration?,subjectDigest,version=1,status:OPEN\|APPROVED\|CHANGES_REQUESTED\|REJECTED\|INVALIDATED,createdByStampId,createdAt,closedAt?`；subject精确一项，当前相同subject/kind只有一个OPEN request。 |
| ApprovalSlot | `id,projectId,reviewRequestId,slotKey,kind,requiredRoleId?,assignedUserId,sourceSlotBindingId?`；唯一`(reviewRequestId,slotKey)`；知识USER-grant场景requiredRoleId可空，其他槽必填；创建后绑定不原位改。 |
| ReviewDecision | `id,projectId,reviewRequestId,approvalSlotId,decision:APPROVE\|CHANGES_REQUESTED\|REJECT,subjectDigest,comment?,createdByStampId,confirmationTicketId,createdAt`；每slot每request仅一条正式决定，重试靠operation幂等，不靠upsert覆盖。 |
| ReviewDecisionRevocation | `id,projectId,decisionId,reason,createdByStampId,confirmationTicketId,createdAt`；原决定最多一条生效撤销，原记录保留。 |
| ReviewRequestCodeEvidence | `reviewRequestId,projectRepositoryId,evidenceId`；当前prepare集合，PK前两项，改集合必须ReviewRequest.version++。 |
| DecisionCodeEvidence | `decisionId,evidenceId`；不可变FK，固定批准依据，不随镜像刷新替换。 |

ArtifactSet允许产品任务使用`items=[]`和非空candidateRevisionIds，形成正式检查点而不是造一个空PRD Artifact。所有候选都必须属于本step允许类型及KB权限范围。TASK_ACCEPTANCE用于工件集合，候选理解与PRD分别产生UNDERSTANDING_CONFIRM和PRD_PUBLICATION。

评审kind为 `UNDERSTANDING_CONFIRM|PRD_PUBLICATION|KNOWLEDGE_PUBLICATION|TASK_ACCEPTANCE|RELEASE_ACCEPTANCE`，与03 slot.kind相同。ReviewRequest的expectedVersion指请求自身version；创建请求的expectedVersion则指subject所属Document或Task.version，不能接受不存在的request版本。

从DOCUMENT_REVISION创建请求时，服务端根据kind与requirement/KB确定槽：无实例的产品用当前responsible+product角色，有实例用准确PRODUCT gate，知识用KB publicationApprover及其当前PUBLISH授权；候选传taskId时必须确实是该Task.currentArtifactSet中的输出。客户端不能传任意slots或approved。审批者失去资格时不按OWNER fallback，旧request INVALIDATED，需要有权管理者修绑定后创建新request。

评审操作效果如下。所有文档的正式发布还需准确KB PUBLISH，业务role槽位不绕过正文ACL；仅创建候选和评审请求不要求Agent取得发布权限。

| 操作 | 同一事务的结果 |
| --- | --- |
| UNDERSTANDING_CONFIRM最后ALL APPROVE | 核当前候选和未决项及KB发布资格；追加该理解文档publication、设置文档指针和Requirement.currentUnderstandingRevisionId，req.version/generation++、阶段至少DEFINITION。若来自当前产品任务且全部step gate满足才完成该任务，再处理下游失效；不是PRD批准。 |
| PRD_PUBLICATION最后ALL APPROVE | 核basisUnderstanding、deliveryScope、acceptance和准确revision；追加publication、设置文档及Requirement.currentPrdRevisionId，req.version/generation++、phase至少DELIVERY；同样重算候选来源Task全部step gate，满足才DONE，不要求不存在的第二个TASK_ACCEPTANCE槽；事件和收件人同事务。 |
| KNOWLEDGE_PUBLICATION最后ALL APPROVE | 核当前KB发布资格和候选；追加publication、切document发布指针，找实际引用旧版的任务和依赖后继并废止；不是全项目无差别generation++。 |
| TASK_ACCEPTANCE最后ALL APPROVE | 核快照、claim产生代次、准确ArtifactSet、所有定义gate及IMPL证据；Task.executionStatus=DONE、version++，claim标记释放；重算需求当前门禁及阶段。 |
| RELEASE_ACCEPTANCE最后ALL APPROVE | 唯一RELEASE step的RELEASE工件、全部上游当前有效；DONE并将phase设RELEASED，保留准确release依据。 |
| CHANGES_REQUESTED | 关闭该request，保留当前发布版；绑定任务进入新generation、OPEN/ACTIVE，废止claim和当前set，记录返修意见与责任人，下游按依赖失效。新候选和新request重新审，不复用旧批准。 |
| REJECT | request关闭；绑定任务OPEN/BLOCKED并保留拒绝原因，后续由责任HUMAN明确恢复／重新提交，不把拒绝当需求已撤回。候选不发布。 |
| 撤销APPROVE | 原决定人或当前准确slot有权HUMAN＋票据；追加revocation，相关published当前有效性撤销，受影响任务及后继失效；已有发布历史不删除。 |

生产当前理解／PRD的PRODUCT任务按“输出revision仍为当前已确认／已发布指针、当前批准未撤销”判断有效，不因为自己的输出刚推进req.generation就立即失效；其旧snapshot只保留来源，不能继续写入。其他任务按快照输入与当前代次严格判断。

## 5. 阶段、工作状态与动作表

`Requirement.phase=DISCOVERY|DEFINITION|DELIVERY|ACCEPTANCE|RELEASED|ARCHIVED`记录历史最高已达里程碑。初始DISCOVERY；理解确认至少DEFINITION；PRD发布至少DELIVERY；当前实例全部必需非RELEASE步骤接受后至少ACCEPTANCE；唯一RELEASE批准后RELEASED；归档只能HUMAN授权动作。失效不倒改历史phase，当前gateStatus单列，防止“曾发布”冒充“现版本仍有效”。

`Task.executionStatus=OPEN|IN_PROGRESS|REVIEW_PENDING|DONE`；`workStatus=ACTIVE|BLOCKED|PAUSED|CANCELLED`分别用于需求、实例和任务。实例或需求非ACTIVE时，任务有效workStatus取最严格的父级限制；本地详细进度不写入这些字段。

BLOCK／PAUSE／CANCEL保存workReason、workOwnerUserId、resumeCondition及改变时间／stamp；负责人未显式指定时取该聚合responsibleUserId，必须是当前成员。BLOCK和PAUSE的resumeCondition必填；CANCEL可空。UNBLOCK／RESUME成功后清当前workReason／workOwnerUserId／resumeCondition，但AuditEvent保留原原因与本次继续理由；状态有效性与取消限制按动作表。实例自己的状态仅由所属需求暂停／撤回或管理员实例升级派生，不增加另一套无路由的自由写入口。

| action | 前置条件与允许主体 | 状态与版本效果 |
| --- | --- | --- |
| CLAIM | Task OPEN/ACTIVE、父级ACTIVE、所有前置当前有效、指定责任人的当前角色、expectedVersion；AGENT需task:claim。 | 新TaskClaim，IN_PROGRESS，task.version++，generation不变。 |
| SNAPSHOT_CREATE | 本claim且generation一致，context:create，满足baselinePolicy及全部必需资源。 | 不可变快照，task.version++，phase不变。 |
| DELIVER | 本claim、IN_PROGRESS/ACTIVE、当前snapshot、全部必要输出及验证；task:deliver。 | ArtifactSet+REVIEW_PENDING，task.version++；不自行DONE。 |
| RELEASE | 本claim主体task:release，或HUMAN管理员票据force=true；非CANCELLED且expectedVersion匹配。 | 原claim释放，generation/version++，OPEN；旧快照与当前set指针清空，历史不删。 |
| BLOCK | 本claim的当前主体，AGENT还需clarification:write；原因、负责人和resumeCondition必填。 | workStatus=BLOCKED、version++；不自动释放claim或推进业务阶段，继续编辑只在本地。 |
| UNBLOCK | 当前任务责任HUMAN或管理员，说明缺口已解决，校验相关澄清与当前基线。 | ACTIVE、version++；若基线变了先走失效并需重新认领，不复活旧claim。 |
| PAUSE／RESUME | 责任HUMAN或管理员；暂停原因、恢复条件，恢复时重核基线及权限；Agent CLI仅Web handoff。 | PAUSED／ACTIVE及version++，不抹历史阶段；暂停不自动触发外部动作重放。 |
| CANCEL | 责任HUMAN或管理员明确撤回，reason必填。 | CANCELLED、version/generation++，释放claim；终止不能通过RESUME复活，需新任务／需求关联历史。 |
| BASELINE_INVALIDATE | 正式版本、撤销或代码证据变化的系统结果，来源必须是真实PrincipalStamp或WebhookReceipt。 | 受影响任务generation/version++、OPEN，旧claim释放，snapshot/set指针清；若原为PAUSED/CANCELLED保留其工作状态。 |
| ARCHIVE | 01规定HUMAN资格＋票据，当前无未处理活动工作或明确列明影响。 | archivedAt、phase=ARCHIVED，停止新写，保留合法历史读取。 |

公开`TaskView.inputValidity`由实际输入和门禁计算，返回VALID|STALE|UNKNOWN及原因，不是数据库可写状态。不能通过修改phase或把依赖executionStatus写为DONE恢复有效性。ready仅展示本主体可认领、依赖有效的任务，不认领；阻塞信息由task读取和board提供。

## 6. 变更、确认与澄清

| 实体 | 字段与约束 |
| --- | --- |
| ChangeEvent | `id,projectId,requirementId?,generation?,sourceKind:DOCUMENT_PUBLICATION\|REVIEW_REVOCATION\|WORKFLOW_UPGRADE\|CODE_OBSERVATION,sourceId,changedFields:String[],targets:Json,actorStampId?,webhookReceiptId?,createdAt`；来源二选一；唯一`(projectId,sourceKind,sourceId,requirementId)`的NULL场景用partial unique，不允许同事件重写targets。 |
| ChangeRecipient | `id,projectId,eventId,userId,roleId?,version=1,ackedAt?,ackedByStampId?,reassignedAt?,replacementRecipientId?,createdAt`；唯一`(eventId,userId,roleId)`，null-role用partial unique；转派保留原记录。 |
| Clarification | `id,projectId,requirementId,taskId?,version=1,question,impact,assignedUserId,resumeCondition,status:OPEN\|DEFERRED\|RESOLVED,dependencyIds:UUID[],createdByStampId,createdAt,updatedAt`；依赖同需求且无环，引用存在和访问权由事务校验。 |
| ClarificationResponse | `id,projectId,clarificationId,answer,resolution:PROPOSED\|CONFIRMED\|DEFERRED,resolutionRefs:Json,createdByStampId,createdAt`；追加记录；Agent只能PROPOSED，不能关闭正式阻塞。 |

变更recipient从实际受影响任务responsibleUserId+roleId生成；同人不同角色独立收件。知识仅影响无任务的订阅角色时按明确绑定生成；无法确定责任人则交项目唯一OWNER、roleId=null，不能静默丢事件。后续角色或人员变化不删已有事件，管理者可明确转派并审计；ack不等于重新批准。

CONFIRMED答复只能由指定回答HUMAN记录，resolutionRefs必须关联当前可读修订的真实行范围；RULE／ACCEPTANCE落点存在不证明语义正确。DEFERRED保留未决状态。只有依赖问题和本问题均RESOLVED才允许UNBLOCK；正式UNDERSTANDING／PRD发布仍执行独立人类批准。

pending在SQL内先按项目、user、Agent单角色、未转派且未确认过滤，再按(createdAt,id)稳定分页，超过百条不截掉旧项。cursor不是确认水位，一轮扫完可以重新从头列剩余未确认，不把翻页当处理成功。

## 7. 失效传播与当前有效性

所有共享版本按“新候选不影响当前发布；正式替换或撤销才触发”处理。

1. 正式理解或PRD变化更新Requirement.generation并识别该需求的后续任务；生产该基线的产品任务按第4节例外核验其输出，不立刻自我失效。
2. 正式知识变化通过SnapshotResourceRef定位**确实使用**该文档旧版的当前任务，追加DAG后继；不因任何知识更新就废止所有项目任务。
3. 代码head变化或评审被撤销，04刷新投影并产生CODE_OBSERVATION，只废止引用该外部证据的任务和后继；历史批准依然保留当时依据，不因证据expiresAt经过60秒直接自动作废。
4. 对影响闭包按task ID排序，逐条清当前claim/snapshot/set指针、递增generation/version、重算gate与ready；当前ReviewRequest变INVALIDATED，未消费票据不能再用于新版本。
5. 绑定角色失去资格不猜另一个人；相关任务／review明确BLOCKED，管理员重新绑定时形成新请求或新实例版本，不更新旧ApprovalSlot冒充原决定。

知识新版本不自动修改已物化的本地文件。客户端看到BASELINE_STALE后说明差异，再取得新快照；历史revision只按当前READ/撤销政策读取，不能因为知道snapshotId就永久读取。

## 8. 事务、锁顺序与幂等

### 8.1 固定数据库边界

v1选择可靠且容易检查的项目级串行写边界，而不是一开始优化为细粒度分布式锁。所有项目内正式写入、ACL／角色变更、publication、snapshot、claim、交付、review、ack及外部证据失效，均锁同一Project行；不同项目仍可并行。PostgreSQL是唯一协调源，Redis不承担锁或决定。

授权主体动作的固定顺序：

1. 在Serializable事务中锁当前User行FOR SHARE（账号authVersion／停用／logout-all的更新与之互斥），再锁Project行FOR UPDATE；Webhook动作从已认证receipt开始，不伪造User锁。
2. 在锁内读取当前成员、assignment、AgentCredential与KB grant／slot。Agent凭据检查在Project锁后完成，凭据撤销同样先取Project锁，避免“先锁凭据再等Project”的反向锁死。
3. 文档与KB、Requirement、Task、ReviewRequest按各表UUID排序读取／锁定；先由Project串行化避免知识发布与新快照的phantom窗口，再核所有expectedVersion、generation、当前发布指针和claim。
4. 同一个Project内跨多个需求的知识发布，收集引用及其依赖闭包并按requirementId/taskId排序处理；构建快照与发布都经过同一Project锁，不能漏掉并发新增引用。
5. 校验幂等、票据、当前证据及门禁，写业务、PrincipalStamp／receipt来源、AuditEvent、ChangeEvent/Recipient和operation结果，一次commit。

外部GitHub、文件上传完整性检查、密码hash比较和模型请求不在长数据库事务内等待；最终事务重验其绑定版本与有效期。密码二验只在01票据签发前完成，最终事务核票据而非再次发外部请求。

遇Prisma P2034或PostgreSQL serialization/deadlock冲突，整个纯DB事务最多三次，重读全部目标，间隔25ms/100ms；超过返回503 TRANSACTION_RETRY_EXHAUSTED。若版本或业务前提变化返回409，不将它当序列化冲突自动换意图。事务内无邮件、命令执行或外部POST，避免副作用重放。

项目级锁是有意选择，后续只有实际指标证明写争用成为瓶颈，才在保持不变量和并发套件的前提下细化；不为未来性能拆微服务。

### 8.2 幂等与收据模型

`IdempotentOperation {id:UUID,projectId:UUID?,projectScopeKey:string,principalScopeKey:string,key:UUID,method,route,requestDigest,resultRefs:Json,responseMetadata:Json,createdAt,committedAt}`；唯一`(projectScopeKey,principalScopeKey,key)`，action不进唯一键。同key换route仍冲突。项目动作scope为`project:<UUID>`并有真实projectId FK；创建项目等账号动作使用`account:<userId>`与null projectId，不伪造隐藏Project。HUMAN主体键按userId，AGENT按credentialId；scopeKey非空且由服务端推导，不依赖SQL NULL唯一比较。

首次动作在同一事务创建operation、业务对象与结果，失败回滚无假COMMITTED。已提交重放先核**当前授权**，同digest返回原业务资源、版本和状态，不重验首次expectedVersion或消费原票据；异digest409。responseMetadata只存无秘密／无正文的原响应业务元数据，不缓存认证secret或文档body；响应requestId为本次新请求ID。详细正文始终走当前授权GET。

幂等结果与正式对象同寿命，v1不自动过期清除。确认票据consumedOperationId引用数据库operation.id，不是header key；原id与key不可混用。receipt接口按原key和当前主体查，不给新credential自动代重放旧操作。

### 8.3 关键原子动作

- **发布：** 当前request、准确revision、全部slot最新决定、KB／角色资格、当前理解与scope、publication、指针、generation、影响任务、事件、收件人和最后批准票据同事务。
- **交付：** 本claim、snapshot、版本、必要输出、Artifact/Set、REVIEW_PENDING、审计和幂等同事务；不能先保存工件后失败推进任务。
- **接受任务：** 先在04准备不变代码证据，最终事务核review version和60s时效；最后ALL决定、DONE、release claim及需求gate重算同事务，不能使用事务外读取的旧需求阶段。
- **ack：** 当前准确recipient、user/role、version、ackedAt/stamp及operation同事务；不同收件行不覆盖JSON。

## 9. 当前门禁、追溯与读取投影

ReviewDecision不可变且没有独立version。`POST /review-decisions/:id/revoke`的expectedVersion始终指所属ReviewRequest.version；ActionBinding.targetId仍为decisionId，但normalizer从其父request读取版本并绑定。撤销事务同时递增request.version，不由执行者猜测用1或原决定序号。

统一GateEvaluator接收准确实例、Task generation、当前输入、ArtifactSet和有效决定，输出 `{status:'SATISFIED'|'UNSATISFIED'|'UNKNOWN',conditions:[{code,satisfied,reason,evaluatedAgainst:{requirementGeneration,taskGeneration,workflowRevisionId,snapshotId?,artifactSetId?}}]}`。UNKNOWN不可放行。

输入、阶段、包文件或Markdown中的“必须”只提供上下文，不能替代权限或门禁。纯结构校验、不可信自检、平台独立校验和人批准分开显示。历史phase、当前workStatus、inputValidity和gateSummary一起进入board，不以SignOff存在推导全绿。

TraceLink只用于非核心扩展关系：`id,projectId,sourceType,sourceId,targetType,targetId,linkType,createdAt`，type/linkType有限注册表，唯一包含project、两端及linkType。允许 `REQUIREMENT→DOCUMENT(DEFINED_BY)`、`TASK→ARTIFACT_SET(DELIVERED)`、`TASK→CHANGE_REQUEST(IMPLEMENTED_BY)`、`DOCUMENT→DOCUMENT(SUPERSEDES)` 等明确关系；真实端点存在、同项目和类型组合都须校验，不作为取代核心FK的万能图表。

公开Graph只在当前权限内展开；没有READ的知识不返回名称、路径或原文摘要。候选可见性为作者／被指派评审者／当前KB PROPOSE或PUBLISH主体，并始终与READ求交；不能只因是任务审阅者就绕过KB。

## 10. 迁移来源与实施验收

迁移按06，`MigrationBatch`与DocumentRevision的importBatchId为历史候选来源；普通API无创建或伪造此来源的入口，导入不会自动产生currentPublished或ReviewDecision。旧schema及历史批准保留，不灌成新模型有效签字。

先落真实数据库约束，再按05实现用例事务。至少以两个独立数据库连接验证：双claim单胜、release后旧claim拒绝、知识发布与快照竞争不漏引用、发布与批准竞争不能批准旧基线、不同任务同时最后批准必推进需求、多slot同人分别记录、丢响应幂等、同key异内容冲突、事务中断无半发布、无权限快照不泄露，以及APPROVE撤销后历史保留而当前门禁失效。

本分册不运行任何上述操作，也不以文档静态检查宣称领域正确性已经验证。
