# 文档概要与修订历史分页方案

> 2026-11-10。对应 `ASSESSMENT.md` P2 的文档读取范围整改。本文件区分兼容首切片与最终完整切换；方案初稿只做调查，后续新增 history/metadata 及评审精确读取的兼容首切片已取得[本地验证](../testing/document-history-validation-2026-11-10.md)。原列表读取放大、概要、完整搜索和主页面分页仍开放，不能由独立新接口或历史 HTTP 基准 PASS 推断完成。

## 用户结果与范围

用户打开知识库、PRD、需求资料和流程准备页时，先取得准确概要，不为每个文档下载全部历史；打开某份文档后可以继续读取完整的有权限历史。旧评审、搜索命中和任意两版比较仍能定位准确修订，当前发布、候选数和历史总数不依赖已加载页长。

范围限于现有文档列表、文档详情、修订列表与单修订读取，以及这些接口的 Web、脚本、契约和测试调用方。保留当前权限、状态映射、正文摘要、版本、幂等和 HUMAN 签字链；不顺带实现需求完整交付历史、Workbench、flow metrics 或其他列表分页。不新增第二套需求、批准或发布状态：实施范围通过现有需求/变更记录、已发布 KNOWLEDGE、required 角色绑定和快照生效，本地方案及测试勾选不能替代 HUMAN 批准。

异常必须可解释：权限撤销或项目不符按现有隐藏对象规则拒绝；游标与对象/查询不符拒绝；文档版本变化要求刷新；续页失败保留已加载内容并可重试。旧修订不在首批不是“修订不存在”，未读完历史不是“没有更多候选”。切换项目、文档、查询或刷新代次后，旧异步响应不得回写。

## 可判定验收

以下 `key / text / verification` 供实施时映射到既有需求与质量包，key 继续使用 shared 的正式约束；额外核验说明不是新增平台验收字段。`history-api-compatible` 与 `history-review-metadata` 是首切片的独立验收，已取得上述本地 API/Web、真实 PostgreSQL/HTTP 和生产 Chromium fixture 回归；其余最终切换验收仍未执行，不能因为首切片完成而勾选。

| key                     | text                                                                                                                      | verification |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| history-api-compatible  | 新增 history 分页与指定修订 metadata 接口，可见性前置、页长有界、计数准确；既有 GET 响应与完整 revisions 数组语义保持兼容 | TEST         |
| history-review-metadata | 文档评审按 review.documentRevisionId 读取准确完整元数据，不再为定位一条旧修订读取整份 document 历史；正文仍独立读取       | TEST         |
| history-default-bounded | 现有列表和文档详情不再默认嵌入全部修订；历史页默认 50、最多 100，正文独立读取                                             | TEST         |
| history-visible         | 分页前的数据库可见条件与当前成员、KB、主体、作者和明确评审者语义一致，页面与计数均无越权信息                              | TEST         |
| history-complete        | 静态数据下遍历全部历史页无重复、无遗漏、顺序正确；准确可见总数和候选数不取自已加载数组                                    | TEST         |
| history-search          | 标题、版本、状态和关联需求搜索覆盖全部可见历史，候选/发布筛选不受预览长度影响                                             | TEST         |
| history-direct          | 首批以外的评审、搜索命中和比较版本可按真实 revisionId 打开，不替换成当前发布版本                                          | TEST         |
| history-resume          | 项目、文档、查询、权限或文档版本变化后，旧游标和旧响应不会混入新结果；失败可关闭或重试                                    | TEST         |
| history-consumers       | 所有现行调用方和文档使用明确概要/分页契约；写入、角色交付与人工批准语义保持                                               | TEST         |
| history-evidence        | 同源生产构建、契约/数据库/浏览器与真实 HTTP 基准留有输入、退出码和边界，最终候选另有远端 CI                               | INSPECTION   |

实现测试要覆盖超过 100 条历史、当前发布位于很早的 seq、无当前发布、隐藏候选交错、全部不可见、最后一页、空页、恶意/跨对象游标及中途变更。默认读取的响应字节与历史数量分开记录；行数有界不承诺单行 JSON 或数据库扫描成本恒定。

## 当前行为与调查依据

- [publication service](../../apps/api/src/knowledge/v1-publication.service.ts) 的 `listRevisions`、`getDocument`、`listDocuments` 都调用无界的 `repository.listRevisions(documentId)`，随后在 Node 中过滤可见修订。仓储已用 `REVISION_SUMMARY_SELECT` 去掉正文，但所有历史元数据仍会读出。
- [publication repository](../../apps/api/src/knowledge/v1-publication.prisma-repository.ts) 的 `toRevisionSnapshot` 只按 `currentPublishedRevisionId === revision.id` 生成 `PUBLISHED`，其余为 `CANDIDATE`；没有持久化 revision state 列。当前真实映射不产生 `WITHDRAWN`，不能在分页中把历史 publication 重新解释为撤回状态。
- `isAssignedReviewer` 与批量方法严格按 `reviewRequests.some.approvalSlots.some.requiredUserId === principal.userId` 判断，任意评审状态均可匹配；纯角色槽位和临时 delegation 不在该定义内。现有 [真实数据库回归](../../apps/api/test/v1-knowledge-access.database.spec.ts) 已比较单条/批量判定及跨状态、用户和纯角色槽位。
- [授权服务](../../apps/api/src/auth/v1-authorization.ts) 先检查项目与活动成员，再交集当前 USER/ROLE grant 和 Agent scope。Agent 仅使用凭据唯一活动角色；读取需要 `knowledge:read`，PROPOSE 另需 `knowledge:propose`，Agent 永不获得 PUBLISH/REVOKE。作者/评审者身份不能绕过 KB READ。
- 当前文档列表的 `q` 在仓储中匹配所有修订标题，之后才由 service 过滤 KB 与修订；如果直接作为新搜索入口，隐藏候选的标题可能影响文档是否命中、结果位置或续页。此处是需要专项验证并在查询前限制可见集合的风险，不是本次已实测的泄露结论。
- [r13 HTTP 基准](../testing/api-benchmark.md) 的 100 文档 × 100 修订令文档列表响应达到 5,352,332 B；该批次功能、授权探针和清理 PASS 不证明读取放大已解决。r13 的 915 文件与后续活跃工作区分别留证，不能混用来源。

## 契约选择与可见性查询

首切片采用有实际调用方的兼容迁移：新增 `GET /documents/:documentId/history` 分页和 `GET /documents/:documentId/revisions/:revisionId/metadata`，同时将 ReviewDecision 的文档评审定位迁到指定 metadata 读取。它独立减少“为一条旧评审拉取整份文档历史”的读取放大，并提供后续历史页可复用的授权与分页基础。既有三个 GET 及旧单修订完整 view 的语义保持；旧 `revisions` 数组仍表示原有完整可见集合，不偷偷变成首批预览。

首切片不解决项目列表、普通文档详情及 Knowledge/Prds 历史页的默认无界读取，相关 P2 项继续开放。最终仍切换为“列表概要 + 单文档分页 + 指定修订”；主列表、搜索、数量、历史页和所有相关调用方成套迁移后，再显式退役旧默认无限路径。直接给旧数组加 `take` 会伪装完整历史，不能作为兼容方案。

首切片的新增契约如下：

| 新入口                                                      | 首切片语义与约束                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /documents/:documentId/history`                        | `{ items, nextCursor, total, documentVersion }`，默认 50、上限 100；`seq DESC`，在当前可见集合上分页，metadata-only；先满足完整历史读取，不要求首切片实现最终列表搜索。  |
| `GET /documents/:documentId/revisions/:revisionId/metadata` | 指定修订的完整元数据，包含评审所需 `acceptance / deliveryScope` 等现有字段，排除 `bodyBytes`；保留所属文档、当前权限与隐藏对象行为。旧评审 revisionId 不在首批也可读取。 |

最终切换目标如下；具体退役方式须在实现变更和 HTTP 契约中显式记录：

| 现有入口                                                    | 目标语义与约束                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /projects/:projectId/documents`                        | 有界文档概要页：`document`、`latestVisibleRevision`、独立 `publishedRevision` 概要、准确 `visibleRevisionCount / candidateRevisionCount`；默认不嵌全部历史。保留文档续页，增加需求过滤和完整可见历史搜索/状态筛选。 |
| `GET /documents/:documentId`                                | 单文档概要，与列表同一计数/指针定义；不再默认返回完整 `revisions`。                                                                                                                                                 |
| `GET /documents/:documentId/history`                        | 延续首切片明确分页的元数据契约；历史未读完由游标表示。既有 `/revisions` 完整数组入口在调用方迁完后显式退役或版本化，不能原地静默截断。                                                                              |
| `GET /documents/:documentId/revisions/:revisionId/metadata` | 延续首切片单条元数据契约。旧无 `/metadata` 后缀的单修订接口当前返回含 `bodyBytes` 的完整 view，继续保留其语义直至明确迁移/退役；不得把它暗改成 metadata-only。                                                      |
| `GET /document-revisions/:revisionId/content`               | 保持现有正文读取、字节和摘要语义；调用方不从概要或历史列表猜测正文。                                                                                                                                                |

最终概要只返回列表所需字段，避免为每行附带验收 JSON 或正文。评审需要的完整修订元数据（如 `acceptance / deliveryScope`）通过指定修订读取，不迫使流程准备和普通列表取得它们。ReviewDecision 的已发布 PRD 验收上下文也必须读取确切发布 revisionId 的完整元数据，不能假设紧凑 `publishedRevision` 概要仍含验收数组。各阶段字段在 shared/HTTP 契约中确定并同步实际调用方，不能把旧 `revisions` 数组原样改名后继续无界读取。

单文档 service 先解析当前 `resolveKnowledgeAccess` 并确认 `canRead`，仓储再使用同一可见条件。当前状态映射下，条件如下；需要 `WITHDRAWN` 新语义时另走变更，不借本轮修改：

```ts
// access.canPropose || access.canPublish：该 document 的全部修订可见。
// 否则只允许当前发布、作者或明确用户评审者；publishedId 为 null 时省略该支。
const visibleWhere = {
  documentId,
  OR: [
    ...(publishedId ? [{ id: publishedId }] : []),
    { createdById: principal.userId },
    { reviewRequests: { some: { approvalSlots: { some: { requiredUserId: principal.userId } } } } },
  ],
};
```

此条件必须同时进入历史页、计数、候选计数、历史搜索和文档命中判断，不能先 `take` 再过滤，也不能额外加 OPEN 状态、角色槽位或 delegation 改权。Agent 在通过项目/角色/KB/scope 交集后同样按授权人 `userId` 判断作者与明确用户槽位；它没有 HUMAN 发布能力。

项目列表跨 KB，先由现有授权层解析可读 KB 及各自有效能力，再在相同项目边界下查询概要。不要先取一页文档再删除无权限行，以免页数、计数或隐藏修订的 q 命中影响结果。权限解析不能为了优化而降成“同项目成员都可读候选”。权限/KB 清单如果需要有界批次，必须有明确预算和失败语义，不能静默截断。

单次概要、指针、准确数量和页面使用同一只读一致事务，沿用本项目的 `RepeatableRead` / `SET TRANSACTION READ ONLY` 模式。独立查询当前发布修订，不能从历史首页寻找；`candidateRevisionCount` 按当前可见非发布集合计算。精确 count/exists 仍可能扫描匹配集合，只有取得查询计划和数据后才决定索引，不用静态 `take` 宣称常量成本。

历史游标使用唯一 `(documentId, seq)` 的 `seq DESC` 值边界，续页条件 `seq < beforeSeq`；游标绑定对象、limit、主体/凭据作用域、有效权限、KB authzVersion、规范化查询和 document version，保留严格格式、范围和长度校验。首切片非法参数/游标返回 422，document version 变化返回 409 `HISTORY_REFRESH_REQUIRED`，响应暴露 `documentVersion` 供调用方识别刷新边界。后续页重新解析当前授权，不把游标当权限票据；权限变化继续按当前授权及绑定处理。不同请求不持有长期数据库快照：并发成员/grant/槽位变化仍可能改变可见集合，界面标明刷新边界并按 ID 去重，不能宣称跨请求永不遗漏。

## 搜索、历史与调用方迁移

### 任务评审的下一兼容切片

任务评审只需要判定目标需求的已发布 PRD 为零、一份或多份，不需要浏览全项目文档。下一切片新增 `GET /projects/:projectId/requirements/:requirementId/published-prds`，固定返回最多两份紧凑概要和准确 `total`。响应为 `{ items: [{ document, publishedRevision: { id, documentId, seq, title, digest } }], total }`，没有 `revisions`、验收数组、交付范围或正文，也不把两份预览伪装为完整列表。项目、需求、PRD kind、未归档、当前发布存在和 KB READ 条件先于 SQL count/take 生效；授权、计数与发布指针在同一只读一致事务中解析。只保留当前授权能读的 KB，不借作者或评审者身份绕过 READ。

本次选择专用于唯一性判断的读取投影，不先开放尚无等价搜索实现的通用 summary 查询；它沿用现有文档与发布事实，不创建新的 PRD 批准状态。完整列表概要、可见修订计数、搜索、需求资料页与历史浏览仍按原计划分步交付。此投影只保证输出最多两行，不声称授权集合或准确 count 扫描成本恒定。

ReviewDecision 的任务评审用 `total` 区分空、唯一和歧义：唯一时按返回的准确文档/发布修订 ID 读取现有 metadata，并确认仍为 PUBLISHED；失败或指针变化显示读取/刷新错误。多份时继续拒绝选取验收基线。两次请求不共享跨请求事务，正式批准仍由现有服务器版本和票据链核验；切换评审后的旧响应不得回写或继续读取旧 metadata。

| key                 | text                                                                                             | verification |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| prd-context-bounded | 只返回目标需求最多两份已发布 PRD 紧凑概要与准确 total，不读取任何完整修订数组                    | TEST         |
| prd-context-visible | 项目、需求和当前 KB READ 在数据库 count/take 前应用，隐藏或无关文档不影响可见唯一性              | TEST         |
| prd-context-exact   | 项目第 51 份以后及超过 100 版的 PRD 仍按准确发布修订取得验收；零份、多份、失败和发布变化明确区分 | TEST         |
| prd-context-race    | 切换评审/需求后的旧结果不继续读取或回写；失败可重试，保持 HUMAN 批准与旧 GET 兼容                | TEST         |

以上四项已取得本地切片证据：r5 API 957、Web 691、真实数据库/HTTP 52 通过，r7 仅修正浏览器 spec 后 89/89 通过。r7 与 r5 的其余 1,061 文件完全一致，未变化检查明确引用 r5，未声称在 r7 重跑；两轮浏览器 fixture 失败及修正均保留，见[验证记录](../testing/document-history-validation-2026-11-10.md)。后端、前端和 QA 按独立文件边界完成，共用文件已统一冻结复核。通用列表概要、完整搜索与历史页仍是下一阶段。

[Knowledge](../../apps/web/src/pages/Knowledge.tsx) 与 [Prds](../../apps/web/src/pages/Prds.tsx) 当前通过 [loadDocumentIndex](../../apps/web/src/lib/documentIndex.ts) 聚合最多 40 页 × 50 文档，再对全历史标题、`vN`、英文/中文状态和关联需求 code/title 作本地搜索。PRD 的“有候选”及两页候选数量也依赖完整数组。新列表搜索必须覆盖这些用户可见字段：服务端在可见历史上匹配，并在文档分页前应用；中文状态与版本标识使用明确映射。既有 `q` 只有标题搜索，不能当作等价实现。正文搜索继续走现有 KB 搜索入口，不混成新的全文搜索项目。

选中文档后独立维护历史页、已加载数、准确总数及继续读取；失败保留已读行并说明范围。比较选择器可继续加载旧版本，或按准确 ID 解析；它不应只提供首 50 版。搜索结果已有 revisionId 时必须按该 ID 读取，不能因不在预览而回退成当前发布。项目/文档/筛选/刷新代次变化需清理旧游标，并保留现有 request 序号保护。

| 调用方                                    | 同步改动                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Knowledge.tsx / Prds.tsx`                | 概要列表与完整搜索；准确候选/总数；选中文档的分页历史、旧版直达和任意两版比较；不自动把所有文档所有历史重新拉回客户端。                                                                                                                                                                       |
| `ReviewDecision.tsx`                      | 首切片将文档评审改为按 `review.documentRevisionId` 取得完整元数据，正文仍走 content；不能在 `get().revisions` 查找旧评审。最终概要切换时，`loadPrdContext` 用服务端 `requirementId` 过滤并继续核对唯一已发布 PRD，出现多份时保留歧义拒绝；验收上下文按确切发布 revisionId 再取完整 metadata。 |
| `RequirementDetail.tsx`                   | 当前只读项目首 50 个 PRD 再按需求过滤，可能遗漏远页文档。改为服务端需求过滤并正确续页；准确数量来自概要，明确的前 5 条预览可进入完整历史。                                                                                                                                                    |
| `Workflows.tsx`                           | 资料选择只需概要的当前发布信息，不读取历史；继续处理文档页未完成状态。                                                                                                                                                                                                                        |
| `lib/projectReadiness.ts`                 | 目前只用 `get().document` 等准备信息，改概要即可，不因未加载历史判定资料缺失。                                                                                                                                                                                                                |
| `api/resources.ts / lib/documentIndex.ts` | 同步概要、历史页及单修订类型/方法，增加查询绑定；保留文档页失败、重复游标及安全上限的明确不完整状态。                                                                                                                                                                                         |
| CLI                                       | 本次定向检索 `apps/cli/src`，匹配文档路由的是 `candidate.ts` 的 POST 创建/候选路径及测试，没有发现这三个文档 GET 的直接消费者。实施前复查新增调用；POST 请求/响应及幂等不因同路径的 GET 变化而改写。CLI context 的快照/materialize 链保持现有内容完整性。                                     |

放弃的替代方案：仅加 `take` 会丢失历史、计数与旧评审；自动为每个文档拉完所有历史只是拆小 HTTP 包，整体放大仍在；只增加接口却没有实际调用方不能交付首切片用户效果；迁移期间保留旧默认无限入口可以保证兼容，但不能据此将原问题标为解决；把角色/委托等价成明确评审者会改变权限；以 gzip 或少量数据的 PASS 替代响应范围和完整性证据不能成立。

## 实施顺序、负责文件与验证

### 通用概要后端兼容切片的固定契约

本轮先新增三个读入口，保留旧完整数组，后续页面接入后另验收退役：`GET /projects/:projectId/document-summaries`、`GET /documents/:documentId/summary` 和 `GET /projects/:projectId/document-summary-overview`。列表参数为 `kind? / knowledgeBaseKind? / requirementId? / status=all|candidate|published / q? / searchProfile=knowledge|prd / limit / cursor`，默认 profile=knowledge、limit=50、最多 100；prd profile 只用于 PRD 范围，缺省 kind 归一为 PRD，显式冲突拒绝。项目和对象参数必须是有效 UUID，未知或非法 query 按现有白名单及 422 语义拒绝。

概要 item 包含原八字段 `document`、`updatedAt`、`knowledgeBase: {id,name,kind}`、可读时的 `requirement: {id,code,title}|null`、`latestVisibleRevision`、独立解析的 `publishedRevision`、`visibleRevisionCount` 和 `candidateRevisionCount`。紧凑修订只含 `id/documentId/seq/title/digest/state`；不含正文、revisions、验收和交付范围。KB 可读但零可见修订的文档仍有概要行。绑定需求没有读取能力时保留 requirementId，但不返回、不搜索需求 code/title，也不让隐藏文本影响 total。Agent 的需求文本可读条件为现有 requirement:read scope；授权仍要求当前活动成员和角色。

列表排序为 `updatedAt DESC, id DESC`，`total` 是应用全部过滤后、不带游标边界的准确可见文档数。游标严格规范 base64url/JSON/精确字段，绑定项目、主体/凭据/scope/角色、当前 KB 权限及 authzVersion、需求文本能力、全部归一查询与页长。每页授权、过滤、计数及投影使用同一只读 RepeatableRead 事务；跨页没有全局列表快照，不能以 Project.version 或最大更新时间伪装。数据变化时刷新列表才能重新确认完整遍历，各页自身仍一致。

`q` 保留页面的拼接串语义：knowledge profile 的中文 kind 标签和英文 kind，或 prd profile 的固定 PRD、prd 和英文 kind；随后为可读需求 code、title、重复组合 code · title；再按 seq DESC 拼接全部可见修订的 title、vN、英文状态和中文状态标签。对 q 做 trim/lower，执行字面子串搜索，允许跨字段边界，%/_ 不作通配符，v1 仍可匹配 v10。status 是独立文档存在条件，不先裁去历史后再搜索。空 q 不生成历史字符串聚合。状态仍仅由当前发布事实映射，候选使用 `IS DISTINCT FROM` 正确处理空指针；隐藏修订不得影响搜索、计数或位置。

overview 不接收 q/status/kind 等筛选：返回项目可读文档总数、四种正式 document kind 的准确数量，以及 BUSINESS/SYSTEM/PRACTICE 各自可读 KB 数、文档数和按同一更新时间顺序的最近最多两项概要。概要列表的页长不能作为统计输入；overview 与列表各自一致，但独立请求不声称共享快照。当前发布指针若指向缺失或其他文档/项目的修订，所选投影明确返回刷新冲突，不静默替换为最新版本。

实现范围为新 service/controller/query helper 及其单元、module 注册；复用经回归的 visibility policy 描述器，SQL 适配明确保留当前发布/作者/明确用户评审槽位联合，不扩大到角色或委托，不限制评审状态。参数化相关查询避免先拉全部修订或发布指针到 Node；响应有界不等于查询成本恒定，真实数据库和查询计划另行验收。父任务负责数据库/HTTP 用例和 API 文档，前端公共资源契约及页面按后续切片顺序接入。

这一后端切片覆盖 history-visible/search 的 API 基础与准确概要，不代表旧列表放大、完整页面迁移或生产容量已解决。验收至少覆盖超过 100 条历史、很早的发布版、空发布、混合 KB 能力、显式用户槽位与角色/委托排除、隐藏标题/需求文本、跨字段和特殊字符、准确全部 total/类别、游标与权限变化、首批外单文档、坏发布指针，以及旧 GET 完整数组兼容。执行前仍为 NOT_RUN。

以下为可独立核验的工作切片；第 1 项可交付独立用户效果，但不单独将原列表历史分页标记完成。最终主列表与页面迁移须在第 2–3 项接通后验收。共用 service/repository/resources 文件按顺序协调，不并行覆盖。

| 顺序 | 负责范围与文件                                                                                                                                                                                   | 依赖与可验收结果                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | 后端：`v1-publication-policy.ts`、publication service/repository、控制器 DTO 及对应单元/HTTP/DB 用例；前端：`api/resources.ts`、`ReviewDecision.tsx` 及对应测试；shared 类型若实际新增由后端同步 | 新增 history 与 metadata 读 API；ReviewDecision 文档评审按 ID 迁移。真实 PostgreSQL 比较旧可见集合与分页全量并集，覆盖用户槽位/角色/委托/Agent、撤权和首批外旧评审；验证旧 GET 的数组及正文响应保持。数据库/浏览器证据未取得时分别留 NOT_RUN，不能只凭单元测试宣称完成。 |
| 2    | 后端：概要/搜索/计数查询及三个旧 GET 的显式迁移方案；协调 `api/resources.ts / documentIndex.ts` 类型与调用方式                                                                                   | 依赖 1；确定需求过滤、完整可见历史搜索、准确计数与独立发布指针，避免把紧凑概要字段直接供评审验收读取。只是后端基础时不退役仍被页面使用的旧契约。                                                                                                                         |
| 3    | 前端 + 后端：Knowledge/Prds、ReviewDecision 的 PRD 上下文、RequirementDetail、Workflows、projectReadiness；QA：HTTP/DB、受影响 UI/浏览器和 `tests/browser/baseline-change.spec.ts`               | 依赖 2；主列表与历史页面成套切换后，明确退役旧默认无限读。覆盖完整搜索、准确数量、多页历史、首批外评审/搜索/比较、并发与失败重试；同步旧数组断言并保留发布、票据和角色签字证据。                                                                                         |
| 4    | 后端/QA：`scripts/benchmark-api.mjs` 及测试、API/分页文档与验收记录                                                                                                                              | 首切片保留旧列表完整数组 benchmark 断言，另补新接口与评审读取探针；最终依赖 2–3 更新“文档列表应嵌全部修订”的旧断言并保留独立历史完整性探针。同环境 small/history 和更深历史分别量测响应字节、延迟、RSS 与精确清理，保留 r13 5.35 MB 原记录。                             |

先跑受影响包测试、类型检查和构建，契约变化执行 `pnpm test:contracts`；然后使用新冻结源码与显式隔离库/浏览器运行 `pnpm verify`、真实 HTTP 基准和源码后置摘要核对。默认列表不含全部历史是行为断言，不仅是 schema 或 snapshot 改名；参数化查询、授权/分页前过滤及查询计划也要留证。最终 clean SHA 的远端 CI、实际制品与外部验收另行绑定，不能复用 r13 或本方案的文档检查。

方案初稿只完成代码调查。后续兼容首切片的实现与执行证据已分别追加到[验证记录](../testing/document-history-validation-2026-11-10.md)：r4 共 1,057 冻结文件，API 936、Web 666、数据库/HTTP 41、生产 Chromium fixture 87 项通过。旧完整列表保持兼容，未测得其响应放大改善，也未执行本方案最终切换的性能、完整门禁或远端验收；后续发现遗漏时追加关联原项，不改写历史结果。

### 项目准备清单的单文档概要切片

用户展开项目准备清单后，按选定流程核对每份必需知识的项目、发布、归档与角色绑定状态；这一判断只需要已知文档 ID 的概要，不再为它读取整份修订历史。重复引用同一文档只读一次；可选知识、没有编译规则或绑定读取失败时不额外读取文档。准备清单保持只读，其结果不替代服务端的角色 READ 检查或 HUMAN 正式批准。

本切片依赖上述固定 `GET /documents/:documentId/summary` 契约，新增独立 `apps/web/src/api/documentSummaries.ts`，只提供紧凑概要类型与单文档概要读取。`DocumentView` 使用现有资源类型的 type-only 引用，不增加 shared 权威或模块副作用。选择独立模块以隔离并行的资源客户端修改；本轮不迁移 Workflows、知识库和 PRD 主列表，也不退役旧 GET。`lib/projectReadiness.ts` 只替换读取来源，沿用当前状态判定；`ProjectReadiness.tsx` 的请求代次保护继续隔离切换项目、流程和刷新后的旧结果。

权限受限、404 隐藏、409 刷新冲突和服务读取失败继续为 UNKNOWN，不能解释为未配置或回退读取旧完整文档。成功读取后确认跨项目、已归档、未发布或不支持的文档类型才按现有语义标为 MISSING；普通成员看不到角色绑定仍为 UNKNOWN。概要、绑定与流程是独立请求，没有共同数据库快照，最终使用和批准继续由现有服务端版本及权限链核验。

| key                          | text                                                                                                      | verification |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| readiness-summary-bounded    | 只按必需且去重后的文档 ID 请求概要；不读项目文档列表、完整修订数组、历史、元数据或正文                    | TEST         |
| readiness-summary-state      | 读取失败和访问限制保持待确认；成功概要确认的发布、归档、项目、类型及角色绑定缺口沿用原准备状态            | TEST         |
| readiness-summary-race       | 切换项目、流程或刷新后，迟到的旧概要结果不能覆盖当前选择的准备状态                                        | TEST         |
| readiness-summary-compatible | 现有人员、流程、工作区和任务准备项与链接保持；无需必需知识或绑定读取失败时不读取文档，旧文档 GET 继续兼容 | TEST         |

文件职责：前端概要客户端、`lib/projectReadiness.ts`、`components/ProjectReadiness.test.tsx` 与定向 `lib/projectReadiness.test.ts` 由同一切片负责；共用 `api/resources.ts` 与浏览器 fixtures 由集成负责人协调，不在此切片并行修改。组件用例验证概要请求边界、刷新和迟到结果，函数用例验证去重及失败/缺失状态矩阵。集成负责人冻结源码后执行受影响包测试、类型检查、构建和隔离浏览器验证，并核对真实数据库/HTTP 的概要契约。实施前这些行为检查记录为 NOT_RUN；fixture 使用简短 ID 的结果不能作为真实 UUID 路由、数据库授权、远端 CI 或最终发布证据。

readiness r1 随后取得实际本地证据：Web 725/725、类型检查、lint、生产构建及生产 Chromium 117/117 通过，无 skip/flaky/fail；1,088 份源文件与 14 份 live 源码匹配，API 字节与后端 summary r2 一致。具体冻结清单和执行证据见[验证记录](../testing/document-history-validation-2026-11-10.md)。该结果不包含下述尚未验证的 Workflows 切片，也不代表远端 CI 或正式批准。

### Workflows 已发布资料选择的概要切片

用户在流程编辑器选择已发布知识或决策资料时，可以继续看到已读取的选项、保存手动文档 ID，并分别重试资料列表和角色绑定状态。资料选择只读取已发布文档的紧凑概要，不随每份文档的修订历史增长而取回全部历史；选择和绑定仍不替代服务端编译、角色 READ 校验、版本约束与 HUMAN 发布票据。

本轮独占新增 `apps/web/src/lib/documentSummaryIndex.ts` 及测试、`pages/Workflows.tsx` 及测试。新索引使用 `apiRequest` 和现有 `DocumentSummary` 类型，固定 `status=published&limit=50`，按游标读取、文档 ID 去重并保留 40 页保护。后端 kind 查询一次只支持一个类型；本轮保留一条 published 列表流，再沿用 KNOWLEDGE / DECISION 与未归档筛选。概要的 total 属于当页服务端过滤范围，不当作可选知识数量或跨页共同快照。旧资源客户端、旧文档索引、readiness 和共享 browser fixtures 不在此切片修改。

资料列表的中途失败、重复游标和页上限均保留部分结果并明确提示不完整，错误保留 code/message/requestId；只有完整且没有合格项时显示暂无资料。绑定读取独立完成，失败时为待确认且禁用管理写；列表失败不擦除绑定结果，绑定成功或失败不擦除列表警告。两类重试只刷新自身来源，并按当前项目和请求代次隔离迟到结果。流程 key、发布基线和接收槽位签名变化时重新读取；失效列表在迟到页返回后停止继续翻页。绑定写入期间更换所选文档或修改草稿时同步失效旧动作，清除旧绑定授权与版本并提示重试绑定状态；普通文档选择本身不重读完整资料列表。列表重试从第一页开始，保留草稿中的文档 ID；临时不在选项内不自动清空手动引用。绑定写失败后继续重读绑定版本；若重读也失败，清除旧绑定授权与版本，保留原写错误和重读错误，不能使用旧 canManage 继续写。

| key                         | text                                                                                                     | verification |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| workflow-summary-bounded    | 资料选择只读取固定 published 概要分页，不调用旧完整文档 GET、历史、元数据或正文                          | TEST         |
| workflow-summary-pages      | 第二页和重复 ID 正确聚合；重复游标、40 页保护和中途失败保留部分结果与明确的不完整错误                    | TEST         |
| workflow-summary-errors     | 列表与绑定独立完成和重试；绑定操作不清除列表警告，只有完整空列表才显示暂无资料                           | TEST         |
| workflow-summary-binding    | 绑定状态读取失败时待确认禁写；写入冲突后重读失败清除旧授权和版本，管理权限、版本与全部角色绑定语义保持   | TEST         |
| workflow-summary-race       | 切换项目、流程基线、前置槽位或写入时修改草稿后，迟到的列表、绑定与绑定写响应不能覆盖当前状态或继续旧翻页 | TEST         |
| workflow-summary-compatible | 资料选择、手动 ID、已发布标题、草稿、服务端校验和人工发布票据保持；桌面和移动布局及键盘操作继续可用      | TEST         |

实现者只执行定向格式、语法和 diff 检查。集成负责人冻结实际源码后运行 Web 测试、类型检查和构建；QA 协调 `tests/ui-review/workflow-prerequisites.spec.ts` 的概要 fixture、失败重试和迟到结果，以及现有四种视口交互回归。真实 API/数据库契约另引后端冻结记录，不能用 fixture 替代。实施前上述行为验收为 NOT_RUN；本切片不声称旧主列表退役、跨页无遗漏、生产容量或远端 CI 已通过。

### 大历史搜索事务超时的限定修复

真实 HTTP benchmark r2 的 100 份文档各 123 条修订，在首次 `q=asciineedle` 正确性请求返回 500；requestId 与服务端 stderr 证实概要查询超过默认 5 秒事务限制。原始失败、请求 oracle 与数据库清理证据保存在[基准验证](../testing/document-summary-benchmark-validation-2026-11-10.md)。本切片保持事务时限、RR 只读快照、权限、过滤、准确 total、排序和游标不变，减少文本转换工作。

将整个历史拼接串的 JavaScript 小写转换改为 prefix 与每个 revision title 分别转换，再以原 U+0020 分隔、原 seq 顺序聚合；固定版本状态标签直接使用相同的小写值。ASCII 空格既非 Cased 也非 Case_Ignorable，可切断 Final_Sigma 上下文，所以保留跨字段字面子串与 Unicode 扩展语义。在 UTF8 数据库中，字节长度等于字符长度的字段只使用 26 字符 ASCII 映射；其余走现有 locale-independent 完整 Unicode plan，避免依赖数据库 lower/collation 的不同语义。增加整个映射的 identity 前缀是只读探针备选，仍会扫描长拼接串且没有采用。

本轮由集成负责人独占 `v1-document-summary.case-fold.ts/.spec.ts` 与 `v1-document-summary.query.ts/.spec.ts`；另一个 Agent 只读审查空格边界、NULL、UTF8 条件、权限和 SQL。验收 `summary-search-equivalence` 对照原生 JS 检查 ASCII、中文、İ、Final_Sigma、astral、跨字段、早期可见/隐藏标题及状态独立性；`summary-search-history-timeout` 用原 benchmark 的 100×123、43 项正确性与五组串行/并发请求复验原问题；`summary-search-regression` 重跑 API、类型、契约、定向 lint、构建与真实 PostgreSQL/HTTP 套件。修复实施后的行为结果仍为 NOT_RUN，需先冻结新的 API 候选，再冻结依赖其确切源码的 benchmark；不能借旧后端通过结果。

后续 API r3 已重新通过 1017 项 API 用例、类型、18 项契约、lint、构建与真实 PostgreSQL/HTTP 65；同源 benchmark r3 的 small/history 各 43 正确性及 200 测量请求零错误，原搜索 500 已复验消失。history 响应旧列表 8298118 B、概要 146850 B，概要无查询串行 p95 40.98 ms，三种搜索 712.56–781.71 ms；具体样本、并发、子进程和清理界限见上述验证记录。该结果只关闭限定 fixture 的原超时问题，未宣称所有消费者退役或生产容量已达标。
