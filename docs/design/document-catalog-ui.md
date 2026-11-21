# 文档主页面的概要与分页历史

> 2026-11-10。延续[文档概要与历史方案](document-history-pagination.md)；PRD 切片 r2 已通过独立包级与生产浏览器验收，Knowledge 切片仍在实施。实际结果见[PRD 验证](../testing/prd-summary-history-validation-2026-11-10.md)，设计描述本身不作为行为证据。

用户在 PRD 和知识页搜索、筛选或翻页时先取得紧凑概要；选中一份文档后才读取分页历史。搜索覆盖全部可见历史，候选数量来自服务端准确计数，当前发布可位于首历史页以外。用户仍可读取、评审、撤销和比较任意有权限的准确修订，部分加载和读取失败需要明确展示，不能把未读完解释为不存在。

实际调查见 `pages/Prds.tsx`、`pages/Knowledge.tsx`、`lib/documentIndex.ts` 及现有概要/history/metadata 服务。两个主页面当前共用含全部 revisions 的 DocumentDetail，同时承担搜索、数量、版本列表和比较状态。新实现使用三个独立来源：概要查询、分页历史、指定修订 metadata；正文和差异沿用已有 content。不能把概要补成空 revisions 的旧详情，也不在本轮抽取 Markdown 与纯文本正文阅读器。

先新增独立 `api/documentHistory.ts`、`hooks/useDocumentHistory.ts` 和相应用例，再新增概要目录客户端及查询 hook；API 类型以已落地服务为准，正式约束仍来自 shared。历史状态区分分页 items 与确切 metadata 缓存；首屏外精确修订可以直接解析，其缓存不计入已读历史页数或 total。先让 Prds 接入形成独立用户结果，再迁 Knowledge，复用已验证基础。Workflows 的固定 published 索引继续独立，公共 resources 和共享 browser fixture 的修改由集成任务协调。

概要查询的项目、q、kind、status、knowledgeBaseKind、requirementId、searchProfile 或页长改变时，旧游标与响应失效。q 长度明确限制 100，不静默截断；列表首屏只取一页，继续翻页才请求下一页。概要 total、门户 overview 与历史 total 各自使用本次服务端值，不以已加载页长估算，也不承诺独立请求的共同快照。当前阅读对象与当前筛选页分开保存，切筛选后明确它是否仍在结果中。

历史默认 50、最多 100，按 seq 降序；中途失败保留已读页并可重试当前页。409 `HISTORY_REFRESH_REQUIRED` 废弃续页并明确要求刷新；其他 401/403/404 不回退旧全量读。相同 documentVersion 下授权槽位变化也可能改变 total，不能把旧缓存并集标为当前完整集合；发现 total/version 变化时停止续页并要求重新读取。切项目、文档、刷新或比较选择后，旧请求不能覆盖状态或继续多页拉取。确切目标失去访问时清正文和可操作缓存。

`publishedRevision` 从概要独立获取；不能用 history 第一项替代它。任意两个比较版本保留真实 revisionId，翻页不丢选择；指定 revision 不可读时不得换成另一版。`basisUnderstandingRevisionId` 可指向其他文档，当前文档 metadata 的 404 不能据此判断理解基线不存在。撤销沿用文档 expectedVersion、既有一次性票据和 HUMAN 权限，成功后刷新概要、门户与历史并失效旧正文/比较。

| key                      | text                                                                                    | verification |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------ |
| catalog-summary-pages    | 概要分页、搜索与筛选全部走服务端，准确 total 和候选数不取自首屏数组；默认不读取完整历史 | TEST         |
| catalog-history-pages    | 选中文档按页读取完整可见历史，顺序与去重正确，未读完、错误与刷新边界可见                | TEST         |
| catalog-exact-revision   | 首历史页之外的发布、指定旧版与任意两版比较按真实 ID 定位，不替换不可读版本              | TEST         |
| catalog-state-races      | 项目、文档、查询、刷新或比较代次改变后旧响应失效，权限变化与 409 不混入旧页             | TEST         |
| catalog-existing-actions | 评审、撤销票据、需求关联、Markdown/纯文本正文与移动端键盘交互保持                       | TEST         |
| catalog-evidence         | 冻结源下包检查、契约、真实数据库/HTTP、生产浏览器和对比数据留证，未跑范围如实记录       | INSPECTION   |

最终退役旧三个全量读入口前还须迁移 RequirementDetail 的旧 PRD 首屏过滤、first-run-workflow、seed-yff、baseline-change 实库断言、legacy 基准和相关契约/测试。RequirementDetail 正有其他信任链任务修改，需先协调所有权。主页面迁移通过不能单独授权删除旧接口；单修订旧入口和写入/content 不顺带退役。基础切片自身不宣称主页面已优化，后续全仓 `pnpm verify`、制品和最终 clean SHA 远端 CI 仍独立执行。

## Knowledge 的后续独立切片

PRD 与八个基础模块在保留 r1 浏览器失败并限定修复后，冻结 r2 已通过 789 项 Web 用例、类型、定向 lint、生产构建和 155 项生产 Chromium fixture。Knowledge 实现基于相同稳定接口，独立冻结整合候选后验收。本节范围由一名实现者独占 `Knowledge.tsx / Knowledge.test.tsx`，QA 独占新 `knowledge-summary-history.spec.ts`，共享 fixture 由集成负责人按顺序修改；其他消费者和公共 resources 不在本切片编辑。

Knowledge 目录使用 `useDocumentSummaries` 的当前页、服务端类型/集合/q 过滤、total 和上一/下一页，不自动选择首文档或提前读取历史。三类门户使用独立 overview 的准确文档/KB 数及每类最近两项；overview 有独立 loading/error/stale/retry 与代次守卫，失败不回退当前页计数，空项目引导只依赖已成功读取的项目总数。选中 summary 与目录页分离，目录外阅读只提示“不在当前结果页”，不能断言不匹配全部筛选。

上方跨知识库的已发布正文搜索继续使用现有 KB 列表与每 KB search、excerpt、cursor、truncated 和部分失败提示；其 500 字符限制独立于目录 q 的 100 字符，目录/overview 故障不阻断独立搜索。搜索命中页外文档时读取单文档 summary，再按准确命中 revisionId 解析 metadata 和正文，不追加目录、不增加总数、不找不到就换发布版。

当前发布由独立 summary.publishedRevision 取值。历史、精确比较、正文/metadata 的权限失败及迟到失效、跨文档理解基线未知说明与 PRD 保持同一规则，沿用 MarkdownReader 和 DiffViewer，不抽通用正文组件。撤销沿用 HUMAN 票据、原因绑定与 expectedVersion；在打开确认时捕获项目/文档/version/发布 ID，冲突后刷新并重新确认，成功只刷新当前代次的 summary/catalog/overview/history 并清旧正文和差异。

继续使用上述 `catalog-*` 验收，并增加门户与正文搜索的本页证据：107 文档/三类 KB 的准确计数和每类最多两条最近项；123 历史按需读取；首屏外 seq2 发布及准确 seq2/seq7 比较；正文搜索命中目录外版本且不可读不替换；503/409/total 变化、权限、查询/项目/文档/比较迟到；原评审、票据、系统关系、返回集合与 1440/390 键盘交互。现有全量聚合测试改成服务端查询及无自动聚合断言，已有正文/比较/竞态/票据行为保留。真实行为检查仍为 NOT_RUN，冻结后统一执行 Web、类型、lint、生产构建和完整 Chromium fixture。

## 需求详情的后续独立切片

当前需求详情只读项目 PRD 列表首 50 份，再客户端按需求过滤；失败归为空数组，候选数、修订数和页签数量来自局部完整详情。这会遗漏后页文档，并把暂时不可读显示为没有文档。新 `RequirementPrdPanel` 独立持有 `kind=PRD&requirementId=真实需求UUID&limit=50` 概要分页；父页面只接入组件和带项目/需求 scope 的总数状态，保留既有信任链、工件布局、URL 页签与任务定位行为。

面板在详情存在时保持挂载，未打开 PRD 页签只读一页概要供准确页签计数，不读历史、metadata 或正文。父页计数只使用同 scope 成功且非 stale 的服务端 total，未知或失败不显示零。目录提供真实总量、上一/下一页、错误与独立重试；临时故障可保留同 scope 数据并标过期，首次读取失败不显示空状态。候选与可见修订数取概要字段，不用已读历史条数推算。

用户显式展开一份文档后才挂载唯一历史子组件，复用分页 hook；默认 50，继续加载由用户触发，metadata 不计入已载数量。当前发布卡片独立于首历史页，点击准确发布修订才解析该 ID 的 metadata，成功后展示版本和关联评审入口；按真实 reviewRequestId 进入规范路径。403/404 清除可操作缓存，不换到其他版本；409 或 total/version 变化停止续页并要求刷新。切项目、需求、文档及刷新后旧响应失效，概要版本或发布 ID 变化也失效旧 metadata。

现有主 PRD 页面没有 documentId 深链。本切片不伪造精确跳转，将原通用按钮标明为“打开项目文档页”，并携带当前 projectId；精确历史和评审在本面板完成。另加 Prds 深链是备选，但会扩展已独立验收页面的查询、选择和竞态契约，本轮暂不采用。

文件归属：一名实现者负责 `RequirementDetail.tsx/.test.tsx` 的限定接入、新 `RequirementPrdPanel.tsx/.test.tsx`；QA 独占新浏览器 spec，共享 fixture 由集成负责人顺序更新。不得覆盖父页面已有信任链与代码证据改动，不修改 Prds、resources 或基础 hook。验收沿用 `catalog-summary-pages / history-pages / exact-revision / state-races / evidence`，增加未展开零历史、第 51/107 份文档、准确页签数量、123 历史、首屏外发布 metadata/评审、失败不伪装为空、跨需求迟到及 1440/390 键盘场景。实施前包级与实际浏览器验证均为 NOT_RUN，冻结后分别留证。

## 开发与验收脚本的读取迁移

first-run 的发布重读和 baseline-change 的发布断言只需要当前发布指针，改读单文档 summary。YFF 演示脚本原项目列表仅取 50 份，并以旧 revisions 首项判断文档标题；新脚本使用独立只读 helper 完整读取概要分页。需要按准确标题识别既有文档时，先通过 q 缩小候选，再对不在最新/发布概要中的标题按需读取该文档分页历史，避免误把需求文字命中当作标题相同，也不遗漏早期可见标题。

撤销发布使用独立选择器，只接受当前 `publishedRevision.title` 与目标标题准确匹配；完整读取所有候选后发现同名发布文档即报错，未找到也不写入。最新候选或历史标题仅可辅助幂等存在性判断，不能选择撤回对象。审查发现的反例是文档旧标题仍命中搜索、当前发布已改为另一用途；票据与 CAS 不能纠正此前选错的文档，故在目标选择阶段排除。

概要聚合要求游标不重复、文档 ID 唯一、total 不变且末页数量一致；历史要求 documentVersion 与概要及各页一致，total 不变、修订 ID 唯一。最多 40 页，达到上限、权限失败、服务失败或分页变化均明确失败，不把部分数据用于后续新建或撤销目标选择。不宣称多页共同数据库快照；实际写入仍由现有票据、expectedVersion 和幂等链核验。helper 回归使用受控只读 call，不执行 seed 的写入、限流清理或直连默认数据库。

集成负责人负责 `scripts/lib/document-summary-reader.mjs` 及测试、`seed-yff.mjs`、`first-run-workflow.mjs`、baseline-change 的限定调用与完整门禁测试登记。先取得 helper 的分页/错误/标题回归和脚本静态证据，真实首次运行与 baseline 浏览器链在后续完整隔离验证中重验；不得把无数据库检查写成实际 seed/批准通过。
