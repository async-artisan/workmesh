# 文档概要与修订历史分页方案

> 2026-11-10。对应 `ASSESSMENT.md` P2 的文档读取范围整改。本文件区分兼容首切片与最终完整切换；文档编写时没有修改接口或执行数据库、浏览器、性能验收，以下实施验收均为 **NOT_RUN**。它不将已完成的 metadata-only 优化、独立新接口或 HTTP 基准 PASS 改写为原列表历史分页完成。

## 用户结果与范围

用户打开知识库、PRD、需求资料和流程准备页时，先取得准确概要，不为每个文档下载全部历史；打开某份文档后可以继续读取完整的有权限历史。旧评审、搜索命中和任意两版比较仍能定位准确修订，当前发布、候选数和历史总数不依赖已加载页长。

范围限于现有文档列表、文档详情、修订列表与单修订读取，以及这些接口的 Web、脚本、契约和测试调用方。保留当前权限、状态映射、正文摘要、版本、幂等和 HUMAN 签字链；不顺带实现需求完整交付历史、Workbench、flow metrics 或其他列表分页。不新增第二套需求、批准或发布状态：实施范围通过现有需求/变更记录、已发布 KNOWLEDGE、required 角色绑定和快照生效，本地方案及测试勾选不能替代 HUMAN 批准。

异常必须可解释：权限撤销或项目不符按现有隐藏对象规则拒绝；游标与对象/查询不符拒绝；文档版本变化要求刷新；续页失败保留已加载内容并可重试。旧修订不在首批不是“修订不存在”，未读完历史不是“没有更多候选”。切换项目、文档、查询或刷新代次后，旧异步响应不得回写。

## 可判定验收

以下 `key / text / verification` 供实施时映射到既有需求与质量包，key 继续使用 shared 的正式约束；额外核验说明不是新增平台验收字段。当前全部 **NOT_RUN**。`history-api-compatible` 与 `history-review-metadata` 是首切片的独立验收；其余是最终切换验收，不能因为首切片完成而勾选。

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

以下为可独立核验的工作切片；第 1 项可交付独立用户效果，但不单独将原列表历史分页标记完成。最终主列表与页面迁移须在第 2–3 项接通后验收。共用 service/repository/resources 文件按顺序协调，不并行覆盖。

| 顺序 | 负责范围与文件                                                                                                                                                                                   | 依赖与可验收结果                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | 后端：`v1-publication-policy.ts`、publication service/repository、控制器 DTO 及对应单元/HTTP/DB 用例；前端：`api/resources.ts`、`ReviewDecision.tsx` 及对应测试；shared 类型若实际新增由后端同步 | 新增 history 与 metadata 读 API；ReviewDecision 文档评审按 ID 迁移。真实 PostgreSQL 比较旧可见集合与分页全量并集，覆盖用户槽位/角色/委托/Agent、撤权和首批外旧评审；验证旧 GET 的数组及正文响应保持。数据库/浏览器证据未取得时分别留 NOT_RUN，不能只凭单元测试宣称完成。 |
| 2    | 后端：概要/搜索/计数查询及三个旧 GET 的显式迁移方案；协调 `api/resources.ts / documentIndex.ts` 类型与调用方式                                                                                   | 依赖 1；确定需求过滤、完整可见历史搜索、准确计数与独立发布指针，避免把紧凑概要字段直接供评审验收读取。只是后端基础时不退役仍被页面使用的旧契约。                                                                                                                         |
| 3    | 前端 + 后端：Knowledge/Prds、ReviewDecision 的 PRD 上下文、RequirementDetail、Workflows、projectReadiness；QA：HTTP/DB、受影响 UI/浏览器和 `tests/browser/baseline-change.spec.ts`               | 依赖 2；主列表与历史页面成套切换后，明确退役旧默认无限读。覆盖完整搜索、准确数量、多页历史、首批外评审/搜索/比较、并发与失败重试；同步旧数组断言并保留发布、票据和角色签字证据。                                                                                         |
| 4    | 后端/QA：`scripts/benchmark-api.mjs` 及测试、API/分页文档与验收记录                                                                                                                              | 首切片保留旧列表完整数组 benchmark 断言，另补新接口与评审读取探针；最终依赖 2–3 更新“文档列表应嵌全部修订”的旧断言并保留独立历史完整性探针。同环境 small/history 和更深历史分别量测响应字节、延迟、RSS 与精确清理，保留 r13 5.35 MB 原记录。                             |

先跑受影响包测试、类型检查和构建，契约变化执行 `pnpm test:contracts`；然后使用新冻结源码与显式隔离库/浏览器运行 `pnpm verify`、真实 HTTP 基准和源码后置摘要核对。默认列表不含全部历史是行为断言，不仅是 schema 或 snapshot 改名；参数化查询、授权/分页前过滤及查询计划也要留证。最终 clean SHA 的远端 CI、实际制品与外部验收另行绑定，不能复用 r13 或本方案的文档检查。

本次实际完成的只有代码调查与设计文档。方案中的实现、性能收益、数据库/浏览器回归均未执行；后续发现遗漏时追加关联原项，不改写历史验收结果。
