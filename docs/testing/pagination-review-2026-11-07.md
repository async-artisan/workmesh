# API 分页与读取范围审查：2026-11-07

本记录属于成熟度整改 P2 的静态审查。审查基线为 `739367a714097a825b96ca7ecf6bce3372855a77` 加当时未提交改动；同日后续基线发布修复会新增事务查询，因此下述计数只对应审查时刻，不代表最终候选或性能基准。

**最新增量：2026-11-09 已实施 Board 的服务端分页与 Web 继续读取，并通过独立 PostgreSQL 的 7 项完整性回归。当前直接 `findMany` 计数为 108 处；原 103、109 处盘点及旧 Board 行为保留为历史快照。实现、验证证据与未完成边界见文末“2026-11-09 Board 分页实施与数据库验证”。**

TypeScript AST 与文本检索交叉确认 `apps/api/src` 当时有 103 处 Prisma `.findMany()`，分布于 26 个文件，其中 18 处显式设置顶层 `take`，85 处没有。早期 ASSESSMENT 的 87 处不再是现状。没有 `take` 不自动等于分页缺陷：权限计算、页内补齐、单次交付的证据闭包及事务失效传播需要完整集合，不能任意截断。

## 优先风险与接口语义

| 优先范围                 | 已确认的读取行为                                                                                | 应保留的完整性语义                                            | 后续方向                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 文档列表、详情、修订历史 | 外层文档列表最多 100 条且有游标，内层逐文档读全部修订并默认取得 `bodyBytes`；每修订另查评审资格 | 候选可见性、全部历史元数据及修订正文的独立读取                | 先用显式 metadata-only 查询去掉正文放大；历史分页与 reviewer 批量判断另行设计 |
| 项目看板                 | 按项目读取全部任务，继续加载相应 claim 与流程修订；无分页或截断提示                             | 当前 `{projectId,columns:[{key,cards}]}` 被客户端视为完整快照 | 提供计数和可分页卡片读取，明确退役实例与历史范围，配套更新客户端              |
| 需求详情                 | 聚合该需求全部实例任务、工件、评审及其决定和槽位、变更及其收件人                                | 当前详情包含完整交付与决定历史，不能静默丢失                  | 保留概要与准确计数，为工件、评审、变更提供独立分页及界面继续读取              |

文档相关入口是 `GET /projects/:projectId/documents`、`GET /documents/:id`、`GET /documents/:id/revisions`；正文入口为 `GET /document-revisions/:id/content`。Web 的文档索引、Knowledge、Prds、ReviewDecision 和 RequirementDetail 主要消费嵌入的 `revisions`，单改独立修订列表路由无法解决现有读取放大。

看板入口为 `GET /projects/:projectId/board`，需求详情为 `GET /projects/:projectId/requirements/:requirementId`。直接给现有查询加 `take` 会把不完整结果伪装成完整视图，本轮没有采用这一做法。静态审查时，上述风险尚无具体数据规模下的实测延迟；同日后续仅补充了下文文档修订仓储的隔离微基准，看板、需求详情及完整 API 仍无容量实测，不能据此给出超时阈值或容量承诺。

## 已有分页和其他增长来源

requirements、knowledge bases、KB search、documents、review requests、change recipients、ready tasks、role packages、workflow definitions 有游标或继续读取语义。KB search 每批 100，最多扫描 1000，返回 `nextCursor/hasMore/truncated`。ready 每批最多 201，但服务可能为凑齐就绪项扫描完整候选队列，单批有限不证明一次请求总工作量有限。

change requests 固定 100、invitations 固定 50、delegations 固定 200、overdue 固定 100、activity 固定 100，没有完整历史游标。若定位为预览，应明确 `hasMore/truncated` 及完整读取入口；若承诺完整列表，需要补续页。

flow metrics 的时间范围为 1–365 天，但窗口内记录数没有上限，八次集合读取仍可能扩大；应改为准确的数据库聚合或受控批处理，不能截取样本后冒充全量统计。workbench 对当前用户全部项目并发查询，即使单项目集合有限，总项目数、并发扇出与总响应仍没有上限。

项目、成员、凭据、角色、仓库、工作单元和依赖图也需要逐项明确规模与读取承诺。初始化六个角色不是角色总量的业务上限。retention 已有明确批次边界：每批 500、每表最多 20 批。

## 同日 metadata-only 兼容改进

文档仓储的 `listRevisions` 已采用显式元数据 `select`，不从数据库取得 `bodyBytes`。文档列表、详情和历史列表保持原有修订元数据、倒序、最近评审引用、候选可见性与完整数组，服务层另在输出前剔除仓储意外带回的正文。`findRevision`、单修订读取和正文读取路径保持原先行为，本次没有改变单修订 GET 的原有视图语义。

新增仓储 3 项、服务 7 项回归验证查询不选正文、不截断历史、正文仍可取以及作者/指定评审者/只读成员的候选可见性。两个文件合计 46 项在 Node.js 24.22.1 下通过；API 类型、定向 ESLint、格式与 diff 检查通过。root 随后在隔离 Node.js 20.19.0 副本执行 API 单元测试，742 项通过。该结果尚未包括后续仍在补充的基线发布数据库回归。

这项改进移除了正文读取及响应放大，在该轮尚未解决修订行数无界、逐修订 reviewer 查询、看板及需求详情历史聚合，也不是性能容量结论。此前 `96d555…` ZIP 不包含本节改动，不能以旧包扫描或生命周期记录证明此次源码已经随包交付。

## 后续 reviewer 批量判定与工作台并发

后续源码将列表可见性中的逐修订 reviewer 判定改为按最多 500 个去重修订 ID 分批读取，数据库仅选择符合原有 `requiredUserId` 存在性条件的修订 ID。保持原作者、候选、已发布/撤回、READ 前置、完整历史和顺序；不增加角色、委托或评审状态条件，单修订读取仍走原单条判定。定向仓储/服务测试 59 项、API 类型、ESLint 与格式检查通过，真实 PostgreSQL 等价性仍需跟随完整入口验证。原读路径不在一个事务中，不能由批量查询宣称所有并发授权变化的观察时刻与旧逐条路径相同。

工作台把所有项目同时启动的查询改为最多 4 个项目并发，仍遍历全部授权项目并按原项目顺序合并结果；单项目领域失败的 warning 语义保留。6 项工作台单测通过，包含九个项目跨三批、真实 Promise 在途计数和其中一项目读取失败后的继续读取。这个上限限制数据库扇出，不构成请求内存、总项目数、响应大小或生产容量的上限。

上述后续读路径改动尚未进入 `239abf…` 许可证 r2 包；旧微基准和安装包证据不追溯涵盖它们。历史分页、完整 API 压测、看板与需求详情聚合仍开放。

## 同日隔离数据库微基准

本节记录执行者提供的本地原始摘要，经独立读取与 SHA256 核对后补充；文档记录者没有重跑数据库。成功执行时间为 `2026-11-07T03:40:38.621Z` 至 `03:40:40.666Z`（北京时间 11:40:38–11:40:40），退出码 0，`summary-final.json` 为 `PASSED`。环境为 Windows x64、Node.js **20.19.0**、PostgreSQL **17.11**，loopback 单客户端串行执行，没有 HTTP 服务、并发客户端或缓存清空。目标是新建专属库 `workmesh_test_revision_benchmark_20261107`，端口 `58390`，schema 为 `workmesh_v1`；先通过显式 `WORKMESH_TEST_ENV=local`、用户白名单与测试 URL 门禁，正式迁移全部应用成功，连接后核对数据库身份并确认 **53 张业务表为空**。

入口为 [benchmark-revision-summary.mjs](../../scripts/benchmark-revision-summary.mjs)，回归为 [benchmark-revision-summary.test.mjs](../../scripts/benchmark-revision-summary.test.mjs)。在已构建 shared/API、已迁移的新专属空库上，显式设置上述测试环境与目标后运行 `node scripts/benchmark-revision-summary.mjs`；脚本不创建数据库、不执行迁移、不启动服务。默认数据为 **100 个修订 × 131,072 字节**伪随机二进制正文，共 **13,107,200 字节（12.5 MiB）**，另有 **160 条评审请求**。fixture 包含候选/当前发布修订、可空元数据、basis 引用、无评审修订及双评审修订，固定 xorshift32 算法按 seq 生成正文，每次运行的实体 ID 唯一。

旧路径由 runner 重现优化前的 `findUnique + findMany/include + 完整正文 view 映射`，**不是检出并构建历史 commit 的对照程序**；新路径直接调用本次实际构建的 `V1PublicationPrismaRepository.listRevisions`。两者使用同一 Prisma client、同一 document 和同一数据库。实测单位是一次串行仓储方法调用（含 `findUnique`、`findMany` 及关联读取）和映射，不是单条 SQL；本次没有采集 SQL 条数。先各做一次正确性与返回量测量，再各预热 2 次、计时 7 次，每对交替旧/新与新/旧顺序。`performance.now()` 计入 Prisma/数据库读取、传输到进程及 JS 映射的墙钟时间；逐字段核对与 JSON 序列化在计时区间外。没有独立测量纯数据库执行时间或 PostgreSQL wire 字节数。

| 指标                         | 旧路径：读取全部正文 | 新路径：实际 metadata-only 仓储 |
| ---------------------------- | -------------------: | ------------------------------: |
| 返回修订数量                 |                  100 |                             100 |
| 查询读取加映射 p50           |           59.2194 ms |                       3.7751 ms |
| 查询读取加映射 p95           |           74.9271 ms |                       3.9980 ms |
| 返回对象中的逻辑正文总量     |      13,107,200 字节 |                          0 字节 |
| 仓储返回数组 JSON UTF-8 大小 |      46,865,616 字节 |                     66,081 字节 |
| 单次 JSON 编码与字节计量耗时 |          436.8021 ms |                       0.2092 ms |

计时原始样本（按执行顺序，单位 ms，展示至小数点后四位）为：旧路径 `74.9271, 55.1589, 71.4937, 73.2597, 59.2194, 56.4105, 57.6573`；新路径 `3.7751, 3.1914, 3.7517, 3.8981, 3.8205, 3.2509, 3.9980`。分位数使用 nearest rank，7 个样本的 p95 就是该组最大值，不能解释为生产尾延迟估计。JSON 大小是对每个仓储返回对象分别 `JSON.stringify` 后加上数组括号/分隔符的精确 UTF-8 字节数；旧值会受 Prisma Bytes 在 Node 中的 JSON 表示影响。**它不是 HTTP 响应大小，也不是数据库网络流量**。单次 JSON 编码与字节计量耗时包含编码、UTF-8 字节计量及逻辑正文长度汇总，只有各一次，没有形成独立延迟分布。

每次查询结果都核对全部摘要字段、id、seq、digest、顺序、发布状态、nullable 元数据与最新 reviewRequestId；旧路径另验证正文长度和 SHA256，新路径禁止存在 `bodyBytes`。成功后的 `finally` 清理事务仅按本次精确 fixture ID 加 project/document 所属条件，依次删除 **160 评审、100 修订、1 文档、1 KB、1 项目、1 用户**，核对删除数量，摘要记录 `REMOVED_EXACT_FIXTURE`。没有 drop/truncate 数据库或 schema，没有使用已有项目数据。该摘要证明本次 fixture 的精确删除已成功，不替代运行后数据库全表复查。

首次运行保留在 `summary.json`：`03:34:15.158Z` 开始，在 `load-built-repository` 阶段失败，状态 `FAILED / NOT_SEEDED`，尚未连接数据库或创建 fixture。原因是 runner 当时错误地从 `apps/api/node_modules` 加载 generated client；正式 schema 的 output 相对 `apps/api/prisma`，实际产物在 `apps/node_modules`。修复后改为读取正式 `generator client.output` 并相对 schema 解析，新增真实产物无数据库连接加载、含空格/中文及 output 变化的回归。最终 Node.js 20.19.0 的 **13/13 回归通过**，覆盖门禁拒绝、非空库拒绝、精确清理、元数据一致性与测量边界；首次失败没有被成功摘要覆盖。

本次仍以开头记录的 HEAD 加未提交工作区为源码背景，不能称为干净提交的可追溯发布制品。精确实现指纹如下，均为 SHA256：

| 文件/产物                                                                  | SHA256                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 实际仓储源码 `apps/api/src/knowledge/v1-publication.prisma-repository.ts`  | `441ea861ec7d7695579bca521a6cf9a2c10ba24d45d182c7ed3754d3b7daa934` |
| 实测构建仓储 `apps/api/dist/knowledge/v1-publication.prisma-repository.js` | `0e37f87df53fd7663dc35e6f96911a67fd849686732d610788a89ba16fdb3286` |
| 服务源码 `apps/api/src/knowledge/v1-publication.service.ts`                | `7c99da81a0a6f2d168611f235fe7fe63448598674802d8c583947d280c842f13` |
| 微基准脚本 `scripts/benchmark-revision-summary.mjs`                        | `b013f680a98004b983340cc90e480d0c101da4a8d1cec34c040789e5e9c9035f` |
| 回归脚本 `scripts/benchmark-revision-summary.test.mjs`                     | `95b3e0f5ec662f5592a833444fffc3aef34aa526ec7a28fe345930b911b0364f` |

本地证据目录为 `G:/workmesh-revision-benchmark-20261107-r1`，仅作为执行者留存证据，不是公开下载制品；摘要不含正文或密码，日志不得直接作为发布资产。文件均已实际读取并独立计算 SHA256：

| 本地证据文件                                  | SHA256                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `summary-final.json`：成功结果及精确清理数量  | `c294b3bdaccf276814c3265e3cedcc86ad81b012345d5214c45d57161a92eeb7` |
| `summary.json`：首次 client 路径失败，未 seed | `0609ecf7e0add50708d360a29fb7b2a313396e24a6eaae3dcea1824806601c77` |
| `guard-tests-final.log`：13 项通过            | `2ba55862170ec75f20a67d7d718ce07649ce086a232fcfce548afddcddec4383` |
| `database-guard.log`：显式目标门禁通过        | `bd2d38879a6335441cd7a37a02dd37556fbdca5f94fb7dd78751312f641d9d70` |
| `migrations.log`：正式迁移应用成功            | `a57926b601d2e79d06ee94da03e4aa609cc5f31f9545cf373b959639de324b02` |

以上是单次本机、缓存预热后的仓储查询微基准，证明该数据集下正文读取与仓储返回放大的差异。它没有测完整服务权限过滤、reviewer N+1、HTTP/API 吞吐量、并发、CPU/RSS 峰值、冷缓存、历史分页、看板或需求详情；仍不形成 API 总体容量、SLA 或其他部署拓扑承诺，也不证明后续 ZIP 已包含该改动。

## 验证边界

本记录已补充上述文档修订仓储微基准，仍没有执行完整 API 并发或容量压测，也不把全部无顶层 `take` 的查询标为缺陷。公开分页契约、客户端历史读取、权限过滤、游标稳定性与超量提示需要一起验收；事务依赖闭包、代码证据完整性和基线传播不能为追求查询上限而丢行。最终支持范围仍见[发布验收](../releasing.md)和[当前状态](../phase-status.md)。

## 2026-11-09 全量调用盘点（Board 改造前快照）

本节重新读取当前工作树，逐个映射公开路由或后台用途。基线仍为 `739367a714097a825b96ca7ecf6bce3372855a77` 加未提交改动；本次只做静态审查，没有连接数据库、构建或执行容量测试。旧 103 处计数保留为历史快照，不能与本节混用。

TypeScript AST 与 `rg` 交叉核对得到 **109 处直接 Prisma `.findMany()`，分布于 27 个非测试源码文件；18 处具有顶层 `take`（包含简写），91 处没有**。计数范围是 `apps/api/src/**/*.ts`，排除 `*.spec.ts`、`*.test.ts`；不把嵌套 `include/select` 关系、`findFirst/findUnique`、`count/groupBy`、原生 SQL 或服务层同名方法计为额外调用。嵌套集合的放大仍在对应行明确指出。

18 个顶层 take 进一步对应 8 个可续读列表/候选入口、6 个固定预览、4 个有预算扫描调用（知识库搜索 1 个、retention 3 个）。这只是代码形态及契约分类，不能据此计算“已解决比例”：ready 的单批有限但总扫描无预算，公开分页也可能包含无界嵌套集合。另有 reviewer 权限补齐按 500 个 ID 分批，虽不直接写 take，单批唯一 ID 数仍有界。

完整机器清单保留在本机 `G:/workmesh-pagination-inventory-20261109-r1/findmany-inventory-final.json`，包含每次调用的文件、行号、方法、where/orderBy/select/include、take 和 27 个输入文件 SHA256。该文件 SHA256 为 `d0fb84f02cd04f187cc1fe1ccef9060bad3319ff9fdbfa7fe0a3920b0d1c6721`；它是本次审查的本地证据，不是公开下载制品。以下行号对应这份快照，之后源码移动须重新核对。

“页内唯一 ID 补齐”只在 ID 来自已证明有界的父页、且查询目标 ID 唯一时说明根行数边界；仅有 `where: { id: { in: ... } }` 不自动说明输入集合或嵌套行数有上限。“完整事务/权限/证据闭包”要求不能漏项，后续可以采用正确的数据库聚合、存在性谓词或保持原子语义的分批算法，但不能直接加 take 后照旧返回完整事实。

### `apps/api/src/auth/v1-auth.prisma-repository.ts`

GET /api/v1/auth/credentials。

| 调用位置                                                                                             | 顶层 take | 读取范围与分页结论                                                       |
| ---------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| [177](../../apps/api/src/auth/v1-auth.prisma-repository.ts#L177) `listCredentials · agentCredential` | 无        | 全量列表：当前用户全部凭据，包括已撤销历史；无续页，行数随凭据签发增长。 |

### `apps/api/src/auth/v1-authorization.prisma-repository.ts`

各项目和知识库入口共享的授权计算，不是独立列表路由。

| 调用位置                                                                                                                    | 顶层 take | 读取范围与分页结论                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [40](../../apps/api/src/auth/v1-authorization.prisma-repository.ts#L40) `findActiveRoleAssignments · projectRoleAssignment` | 无        | 完整权限集合：项目/用户的全部角色 assignment（此查询也包含 revokedAt）；后续资格计算不能因截断而漏授或误授，数量随角色增加。 |
| [88](../../apps/api/src/auth/v1-authorization.prisma-repository.ts#L88) `findGrants · knowledgeBaseGrant`                   | 无        | 完整权限集合：知识库全部 grant（含撤销历史），无固定上限；可改为准确谓词/存在性判断，但不能只取前 N 条。                     |

### `apps/api/src/changes/change-requests.service.ts`

GET /api/v1/projects/:projectId/change-policy、GET /api/v1/projects/:projectId/change-requests，以及 POST 同路径/:changeId/decisions。

| 调用位置                                                                                                          | 顶层 take | 读取范围与分页结论                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [111](../../apps/api/src/changes/change-requests.service.ts#L111) `readPolicy · projectChangePolicy`              | 无        | 完整策略集合：正式 updatePolicy 仅写 L0–L3 和 FREEZE，结合 projectId/level 唯一键，当前写入口最多 5 行；每行 slots JSON 数组没有这里的硬上限。 |
| [165](../../apps/api/src/changes/change-requests.service.ts#L165) `assertDeciderEligible · projectRoleAssignment` | 无        | 完整资格集合：项目/用户全部活动角色 assignment，用于变更分级审批；无固定角色数量上限，不能截断资格。                                           |
| [259](../../apps/api/src/changes/change-requests.service.ts#L259) `list · changeRequest`                          | `100`     | 固定预览：createdAt 倒序取 100，直接返回数组，没有 nextCursor/hasMore，较早变更无法在该入口续读。                                              |
| [346](../../apps/api/src/changes/change-requests.service.ts#L346) `decide · projectMember`                        | 无        | 完整事务闭包：接受变更后读取全部活动成员，向所有应通知的人创建收件记录；成员数无固定上限，不能分页后漏发。                                     |

### `apps/api/src/common/retention.service.ts`

后台 RetentionService.sweep；测试也可直接调用，没有公开列表路由。

| 调用位置                                                                                | 顶层 take | 读取范围与分页结论                                                                                                  |
| --------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| [93](../../apps/api/src/common/retention.service.ts#L93) `sweep · authRateWindow`       | `take`    | 有预算批处理：过期 authRateWindow 每批 take=500、每表最多 20 批，一次 sweep 最多挑选 10000 行；只选 ID 后精确删除。 |
| [106](../../apps/api/src/common/retention.service.ts#L106) `sweep · confirmationTicket` | `take`    | 有预算批处理：过期且无决定引用的 confirmationTicket，500×20；保留审计引用，不是开放式全表排空。                     |
| [119](../../apps/api/src/common/retention.service.ts#L119) `sweep · webSession`         | `take`    | 有预算批处理：过期且无 stamp/票据/CLI 视图引用的 webSession，500×20；保留引用完整性。                               |

### `apps/api/src/common/v1-operation-receipt.prisma-repository.ts`

GET /api/v1/operation-receipts/:operationKey?projectId=...。

| 调用位置                                                                                                             | 顶层 take | 读取范围与分页结论                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [22](../../apps/api/src/common/v1-operation-receipt.prisma-repository.ts#L22) `findOperations · idempotentOperation` | 无        | 完整主体候选：按 projectScopeKey/key 读所有主体的同键操作，再选择当前主体或其 Agent 收据；唯一键还含 principalScopeKey，因此并非至多一行，数量无固定上限。 |

### `apps/api/src/integrations/v1-github-evidence.prisma-repository.ts`

POST /api/v1/integrations/github/webhooks 的重复 delivery 回放。

| 调用位置                                                                                                                          | 顶层 take | 读取范围与分页结论                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| [76](../../apps/api/src/integrations/v1-github-evidence.prisma-repository.ts#L76) `findEvidenceIdsByReceipt · codeReviewEvidence` | 无        | 完整单回执集合：按 receiptId 返回已记录证据 ID，不能随意截断同一回执的幂等响应；无 take，非通用历史列表。 |

### `apps/api/src/knowledge/v1-knowledge-base.prisma-repository.ts`

GET /api/v1/projects/:projectId/knowledge-bases；GET/PUT /api/v1/knowledge-bases/:knowledgeBaseId/access；GET /api/v1/knowledge-bases/:knowledgeBaseId/search。

| 调用位置                                                                                                                  | 顶层 take          | 读取范围与分页结论                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [327](../../apps/api/src/knowledge/v1-knowledge-base.prisma-repository.ts#L327) `listKnowledgeBases · knowledgeBase`      | `query.limit + 1`  | 公开分页：默认 20、最大 100，createdAt/id 升序值游标，limit+1，nextCursor/hasMore。                                            |
| [361](../../apps/api/src/knowledge/v1-knowledge-base.prisma-repository.ts#L361) `listAccessGrants · knowledgeBaseGrant`   | 无                 | 全量权限历史：access GET 读取全部 grants（含已撤销）；没有历史续页，随授权替换次数增长。                                       |
| [474](../../apps/api/src/knowledge/v1-knowledge-base.prisma-repository.ts#L474) `replaceAccess · knowledgeBaseGrant`      | 无                 | 完整事务响应：replaceAccess 撤销旧 grant、追加新 grant 后读回全部历史，保存幂等结果；不是仅当前 grants，不能在未改契约时截断。 |
| [577](../../apps/api/src/knowledge/v1-knowledge-base.prisma-repository.ts#L577) `searchKnowledgeBase · knowledgeDocument` | `SEARCH_BATCH + 1` | 有预算扫描：候选文档每批 100+1，最多处理 1000 个文档，再返回 nextCursor/hasMore/truncated；行数预算不限制正文总字节。          |
| [599](../../apps/api/src/knowledge/v1-knowledge-base.prisma-repository.ts#L599) `searchKnowledgeBase · documentRevision`  | 无                 | 页内补齐：只读该批最多 100 个 currentPublishedRevisionId；每行含 bodyBytes，单行正文大小与累计字节仍需另计。                   |
| [669](../../apps/api/src/knowledge/v1-knowledge-base.prisma-repository.ts#L669) `findProjectRoles · projectRole`          | 无                 | 输入 ID 补齐：按本次访问替换所引用 roleIds 全集验证项目和活动状态；输入数组未在此处限制长度，不能据 in 谓词称固定上限。        |

### `apps/api/src/knowledge/v1-publication.prisma-repository.ts`

GET /api/v1/projects/:projectId/documents、GET /api/v1/documents/:documentId、GET /api/v1/documents/:documentId/revisions；文档写入还使用角色全集。

| 调用位置                                                                                                                          | 顶层 take   | 读取范围与分页结论                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [212](../../apps/api/src/knowledge/v1-publication.prisma-repository.ts#L212) `listRevisions · documentRevision`                   | 无          | 全量修订历史：单文档全部修订按 seq 倒序；已 metadata-only，仍无行数上限。列表内嵌修订也调用此方法，外层 100 文档不限制内层历史。 |
| [235](../../apps/api/src/knowledge/v1-publication.prisma-repository.ts#L235) `listAssignedReviewerRevisionIds · documentRevision` | 无          | 分批权限补齐：去重 revisionIds 每批至多 500 个，返回匹配 requiredUserId 的 revision ID；循环总批数仍随完整修订历史增长。         |
| [270](../../apps/api/src/knowledge/v1-publication.prisma-repository.ts#L270) `projectRoleIds · projectRole`                       | 无          | 完整角色集合：文档写入校验所需项目全部角色 ID；无固定角色数量上限，初始化六角色不是总量上限。                                    |
| [299](../../apps/api/src/knowledge/v1-publication.prisma-repository.ts#L299) `listDocuments · knowledgeDocument`                  | `limit + 1` | 公开分页：默认 20、最大 100，updatedAt/id 倒序值游标，limit+1/nextCursor；服务仍为每个文档读取完整修订元数据与权限。             |

### `apps/api/src/projects/invitations.service.ts`

POST/GET /api/v1/projects/:projectId/invitations；GET /api/v1/invitations/:token；POST 同路径/join（与 accept 共享邀请流程）。

| 调用位置                                                                                  | 顶层 take | 读取范围与分页结论                                                                                                        |
| ----------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| [161](../../apps/api/src/projects/invitations.service.ts#L161) `create · projectRole`     | 无        | 输入 ID 补齐：创建邀请按 roleKeys 验证活动角色；当前 DTO 限 1–12 个 key，查回行数受唯一角色 key 约束。                    |
| [332](../../apps/api/src/projects/invitations.service.ts#L332) `resolve · projectRole`    | 无        | 单邀请补齐：按已存 invitation.roleIds 读取显示角色；当前创建入口至多 12，数据库数组本身没有此处硬上限，旧数据不据此截断。 |
| [405](../../apps/api/src/projects/invitations.service.ts#L405) `join · projectRole`       | 无        | 完整加入校验：按邀请引用角色 ID 全集复核活动角色，再赋予身份；沿当前邀请创建规则有界，不能漏赋。                          |
| [550](../../apps/api/src/projects/invitations.service.ts#L550) `list · projectInvitation` | `50`      | 固定预览：最近 50 个未接受、未撤销且未过期邀请，无 nextCursor/hasMore；不是全部有效邀请的证明。                           |
| [557](../../apps/api/src/projects/invitations.service.ts#L557) `list · projectRole`       | 无        | 页内角色补齐：来自上面 50 个邀请的去重 roleIds；当前每邀请最多 12，可达 600 个不同角色，旧数组未有数据库长度约束。        |

### `apps/api/src/projects/projects.service.ts`

GET /api/v1/projects；GET /api/v1/projects/:projectId/members、/roles、/repositories。

| 调用位置                                                                                       | 顶层 take | 读取范围与分页结论                                                                                      |
| ---------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| [209](../../apps/api/src/projects/projects.service.ts#L209) `list · project`                   | 无        | 全量列表：当前用户全部活动项目，无游标和项目数上限。                                                    |
| [214](../../apps/api/src/projects/projects.service.ts#L214) `list · knowledgeBase`             | 无        | 项目补齐：为全部已取项目读取 key=DEFAULT 的知识库；每项目 key 唯一，最多一行/项目，但上游项目集合无界。 |
| [308](../../apps/api/src/projects/projects.service.ts#L308) `members · projectMember`          | 无        | 全量列表：项目全部活动成员，无分页。                                                                    |
| [313](../../apps/api/src/projects/projects.service.ts#L313) `members · projectRoleAssignment`  | 无        | 完整成员角色补齐：项目全部活动角色 assignment；既无成员页边界也无角色数量上限。                         |
| [435](../../apps/api/src/projects/projects.service.ts#L435) `roles · projectRole`              | 无        | 全量列表：项目全部业务角色，key 排序，无分页。                                                          |
| [742](../../apps/api/src/projects/projects.service.ts#L742) `repositories · projectRepository` | 无        | 全量列表：项目全部未归档仓库及每仓库全部未撤销 locators；根集合与嵌套集合均未设行数上限。               |

### `apps/api/src/projects/requirements.service.ts`

GET /api/v1/projects/:projectId/requirements；GET/PATCH 同路径/:requirementId。

| 调用位置                                                                                    | 顶层 take  | 读取范围与分页结论                                                                                |
| ------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| [38](../../apps/api/src/projects/requirements.service.ts#L38) `list · requirement`          | `take + 1` | 公开分页：默认 20、最大 100，seq 升序/seq>cursor，take+1/nextCursor。                             |
| [141](../../apps/api/src/projects/requirements.service.ts#L141) `update · workflowInstance` | 无         | 完整事务闭包：需求更新后读取全部 workflowInstance，为变更影响传播准备全集；无实例数上限。         |
| [148](../../apps/api/src/projects/requirements.service.ts#L148) `update · task`             | 无         | 完整事务闭包：读取上述实例全部未取消任务，计算所有责任人/角色通知，不能只通知首批。               |
| [212](../../apps/api/src/projects/requirements.service.ts#L212) `detail · task`             | 无         | 全量详情：需求全部实例任务按 stepKey 排序，无 take/退役实例过滤；页面状态和流程判断目前依赖全集。 |
| [239](../../apps/api/src/projects/requirements.service.ts#L239) `detail · workflowRevision` | 无         | 完整显示补齐：读取上述任务的去重流程修订定义；上游任务集合无界。                                  |
| [251](../../apps/api/src/projects/requirements.service.ts#L251) `detail · artifact`         | 无         | 全量历史：需求全部任务的全部工件，参与 artifactCount；无 take，不能截断后仍称准确总数。           |
| [270](../../apps/api/src/projects/requirements.service.ts#L270) `detail · reviewRequest`    | 无         | 全量历史：任务评审与需求文档评审全部读取；嵌套 approvalSlots 和 decisions 同样全部读取。          |
| [313](../../apps/api/src/projects/requirements.service.ts#L313) `detail · changeEvent`      | 无         | 全量历史：需求全部变更事件及各事件全部 recipients；根和嵌套都无分页。                             |

### `apps/api/src/projects/units.service.ts`

GET /api/v1/projects/:projectId/units、GET /api/v1/projects/:projectId/unit-dependencies。

| 调用位置                                                                                     | 顶层 take | 读取范围与分页结论                                                                             |
| -------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| [42](../../apps/api/src/projects/units.service.ts#L42) `list · unit`                         | 无        | 全量列表：项目全部工作单元（含状态），无游标/总量上限。                                        |
| [100](../../apps/api/src/projects/units.service.ts#L100) `listDependencies · unitDependency` | 无        | 全量依赖图：项目全部依赖边并补齐两端名称；若改分页必须区分图是否完整，不能按首批边判定无依赖。 |

### `apps/api/src/projects/workspace-definition.service.ts`

GET /api/v1/projects/:projectId/workspace-definition 及 /revisions/:revisionId；PUT /draft、POST /validate、POST /publish 复用引用校验。

| 调用位置                                                                                                                                          | 顶层 take | 读取范围与分页结论                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| [786](../../apps/api/src/projects/workspace-definition.service.ts#L786) `loadRevisionRepositories · projectWorkspaceDefinitionRevisionRepository` | 无        | 单修订完整定义：全部逻辑仓库及各仓库全部活动 locators；无固定仓库数/嵌套 locator 数上限。                 |
| [865](../../apps/api/src/projects/workspace-definition.service.ts#L865) `collectReferenceIssues · projectRepository`                              | 无        | 输入 ID 补齐：验证 payload.repositories 中全部仓库归属和归档状态；payload 长度没有这里的固定上限。        |
| [890](../../apps/api/src/projects/workspace-definition.service.ts#L890) `collectReferenceIssues · knowledgeDocument`                              | 无        | 输入 ID 补齐：全部去重文档引用，逐知识库执行当前可读权限校验；不能遗漏引用，ID 数随 payload 增长。        |
| [1043](../../apps/api/src/projects/workspace-definition.service.ts#L1043) `lockReferenceState · knowledgeDocument`                                | 无        | 完整事务闭包：锁引用状态后补齐全部文档的 knowledgeBaseId，以锁住权限并重检；数量随 payload 文档引用增长。 |

### `apps/api/src/reviews/delegations.service.ts`

GET /api/v1/projects/:projectId/delegations、GET /api/v1/projects/:projectId/approvals/overdue。

| 调用位置                                                                                    | 顶层 take | 读取范围与分页结论                                                                 |
| ------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| [34](../../apps/api/src/reviews/delegations.service.ts#L34) `list · approvalSlotDelegation` | `200`     | 固定预览：最近 200 条委托历史，无 nextCursor/hasMore，较早委托无此入口续页。       |
| [158](../../apps/api/src/reviews/delegations.service.ts#L158) `overdue · approvalSlot`      | `100`     | 固定预览：最早到期的 100 个未决定审批槽，无 nextCursor/hasMore；不是完整逾期列表。 |

### `apps/api/src/reviews/v1-review-code-evidence.ts`

POST /api/v1/review-requests/:reviewId/decisions 等决定路径内的代码证据闸门；无独立列表路由。

| 调用位置                                                                                                            | 顶层 take | 读取范围与分页结论                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| [57](../../apps/api/src/reviews/v1-review-code-evidence.ts#L57) `assertCodeEvidenceAcceptable · artifact`           | 无        | 完整验收闭包：一个 artifactSet 的全部工件，用于判断任何代码声明是否需要代码证据；不能截断后误判无需证据。     |
| [63](../../apps/api/src/reviews/v1-review-code-evidence.ts#L63) `assertCodeEvidenceAcceptable · codeReviewEvidence` | 无        | 完整证据闭包：该交付集全部 prepared 票据行，解析所有已绑定证据 ID；无固定票据数上限。                         |
| [74](../../apps/api/src/reviews/v1-review-code-evidence.ts#L74) `assertCodeEvidenceAcceptable · codeReviewEvidence` | 无        | 输入 ID 补齐：全部已绑定真实证据状态，要求全部满足 APPROVED/非 Bot；ID 数随该交付集票据增长，不能只检查首批。 |

### `apps/api/src/reviews/v1-review.prisma-repository.ts`

GET /api/v1/projects/:projectId/review-requests；POST /api/v1/review-requests/:reviewId/decisions（含正式文档发布/返工）；POST /api/v1/review-decisions/:decisionId/revoke。

| 调用位置                                                                                                                      | 顶层 take         | 读取范围与分页结论                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [382](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L382) `listReviews · reviewRequest`                           | `query.limit + 1` | 公开分页：默认 20、最大 200，createdAt/id 倒序值游标、limit+1、nextCursor/hasMore；嵌套 REVIEW_SNAPSHOT_INCLUDE 的 approvalSlots/decisions 没有分页，根行数限制不等于响应字节有界。 |
| [399](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L399) `listReviews · requirement`                             | 无                | 页内唯一 ID 补齐：最多一条需求/本页文档评审，用于需求标签。                                                                                                                         |
| [413](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L413) `listReviews · workflowRevision`                        | 无                | 页内唯一 ID 补齐：最多一条流程修订/本页任务评审，用于步骤显示名。                                                                                                                   |
| [1095](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L1095) `runRevoke · snapshotResourceRef`                     | 无                | 完整撤销传播：查引用被撤销文档修订的全部 snapshot refs；历史增长无上限，漏查会留下有效旧基线任务。                                                                                  |
| [1106](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L1106) `runRevoke · task`                                    | 无                | 完整事务闭包：按全部受影响 taskIds 重新读取任务，逐项 CAS 失效、释放认领、失效未决评审。                                                                                            |
| [1703](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L1703) `invalidatePublishedBaselineTasks · workflowInstance` | 无                | 完整发布传播：需求全部活动实例，嵌套读取实例全部任务；只筛 retiredAt=null，不是分页。                                                                                               |
| [1734](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L1734) `invalidatePublishedBaselineTasks · workflowRevision` | 无                | 完整传播补齐：上述实例全部流程修订，用冻结 DAG 识别受影响下游；上游实例无固定上限。                                                                                                 |
| [1739](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L1739) `invalidatePublishedBaselineTasks · contextSnapshot`  | 无                | 完整传播补齐：上述任务的当前快照及其 PUBLISHED 文档资源引用；嵌套 resources 未设上限。                                                                                              |
| [1760](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L1760) `invalidatePublishedBaselineTasks · artifactSet`      | 无                | 完整传播补齐：上述任务当前交付集及候选 items；嵌套 items 未设上限，不能漏掉合法新基线来源。                                                                                         |
| [2359](../../apps/api/src/reviews/v1-review.prisma-repository.ts#L2359) `reworkTaskTree · task`                               | 无                | 完整返工闭包：同实例根步骤及全部下游任务，保持暂停/取消状态并失效代次；集合来自冻结 DAG，不可硬截断。                                                                               |

### `apps/api/src/tasks/v1-artifact.prisma-repository.ts`

GET /api/v1/artifact-sets/:id 的代码证据读取。

| 调用位置                                                                                                            | 顶层 take | 读取范围与分页结论                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| [140](../../apps/api/src/tasks/v1-artifact.prisma-repository.ts#L140) `findCodeReviewEvidence · codeReviewEvidence` | 无        | 完整单交付集集合：全部 prepared 票据，沿已消费绑定解析真实证据；无票据数量上限。                    |
| [151](../../apps/api/src/tasks/v1-artifact.prisma-repository.ts#L151) `findCodeReviewEvidence · codeReviewEvidence` | 无        | 输入 ID 补齐：读取所有 boundIds 的真实代码评审证据，ID 数随票据增加。                               |
| [168](../../apps/api/src/tasks/v1-artifact.prisma-repository.ts#L168) `findCodeReviewEvidence · projectRepository`  | 无        | 输入 ID 补齐：按证据 external repository IDs 查 PROVIDER 身份和展示名称；外部证据集合未设固定上限。 |

### `apps/api/src/tasks/v1-board.prisma-repository.ts`

GET /api/v1/projects/:projectId/board。

| 调用位置                                                                                        | 顶层 take | 读取范围与分页结论                                                          |
| ----------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| [11](../../apps/api/src/tasks/v1-board.prisma-repository.ts#L11) `listCards · task`             | 无        | 全量快照：项目全部任务，generation desc/id asc，无 take/游标/退役实例过滤。 |
| [25](../../apps/api/src/tasks/v1-board.prisma-repository.ts#L25) `listCards · taskClaim`        | 无        | 完整补齐：以上全部 task ID 的未释放 claim；上游任务无界。                   |
| [38](../../apps/api/src/tasks/v1-board.prisma-repository.ts#L38) `listCards · workflowRevision` | 无        | 完整显示补齐：以上任务全部去重 workflowRevision ID；上游任务无界。          |

### `apps/api/src/tasks/v1-change.prisma-repository.ts`

GET /api/v1/change-recipients；POST /api/v1/change-recipients/:id/ack 等读取单事件完整状态。

| 调用位置                                                                                               | 顶层 take         | 读取范围与分页结论                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [160](../../apps/api/src/tasks/v1-change.prisma-repository.ts#L160) `findEvent · changeRecipient`      | 无                | 单事件完整集合：读取 changeEvent 全部 recipients，行数随被通知角色/人数增长，不是已分页事件详情。                                                         |
| [328](../../apps/api/src/tasks/v1-change.prisma-repository.ts#L328) `listRecipients · changeRecipient` | `query.limit + 1` | 公开分页：默认 50、最大 200，createdAt/id 倒序，limit+1/nextCursor；cursor 为 recipient ID 后查该行边界，失效 cursor 会回到首批，游标稳定性仍需专门验收。 |

### `apps/api/src/tasks/v1-flow-metrics.service.ts`

GET /api/v1/projects/:projectId/metrics/flow?days=...；days 默认 30、范围 1–365。

| 调用位置                                                                                 | 顶层 take | 读取范围与分页结论                                                                                       |
| ---------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| [76](../../apps/api/src/tasks/v1-flow-metrics.service.ts#L76) `flow · requirement`       | 无        | 完整指标范围：窗口内全部需求；时间有界不限制行数。                                                       |
| [82](../../apps/api/src/tasks/v1-flow-metrics.service.ts#L82) `flow · workflowInstance`  | 无        | 完整指标补齐：窗口需求的全部实例，无实例数上限。                                                         |
| [90](../../apps/api/src/tasks/v1-flow-metrics.service.ts#L90) `flow · task`              | 无        | 完整指标补齐：上述实例全部任务，无任务数上限。                                                           |
| [101](../../apps/api/src/tasks/v1-flow-metrics.service.ts#L101) `flow · taskClaim`       | 无        | 完整指标历史：上述任务全部认领，求最早开始时间；不能抽样后保留原指标含义。                               |
| [108](../../apps/api/src/tasks/v1-flow-metrics.service.ts#L108) `flow · artifactSet`     | 无        | 完整指标历史：上述任务全部交付，求首次交付时间，无交付数上限。                                           |
| [115](../../apps/api/src/tasks/v1-flow-metrics.service.ts#L115) `flow · reviewRequest`   | 无        | 完整指标历史：上述任务全部评审，无评审数上限。                                                           |
| [122](../../apps/api/src/tasks/v1-flow-metrics.service.ts#L122) `flow · reviewDecision`  | 无        | 完整指标历史：上述评审全部 APPROVE 决定，求最终批准时间，无决定数上限。                                  |
| [191](../../apps/api/src/tasks/v1-flow-metrics.service.ts#L191) `flow · changeRecipient` | 无        | 完整指标历史：窗口内全部已 ACK 收件人，求数量/平均耗时；应改准确数据库聚合或受控批处理，不能直接取样本。 |

### `apps/api/src/tasks/v1-ready.prisma-repository.ts`

GET /api/v1/projects/:projectId/tasks/ready；服务还被 Workbench 调用。

| 调用位置                                                                                                  | 顶层 take        | 读取范围与分页结论                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [67](../../apps/api/src/tasks/v1-ready.prisma-repository.ts#L67) `listCandidates · task`                  | `input.take + 1` | 有游标候选批：服务默认 50、最大 200，stepKey/id 升序，单批 take<=201；服务为凑足真实就绪项可扫描全部候选，无单请求总扫描预算。 |
| [101](../../apps/api/src/tasks/v1-ready.prisma-repository.ts#L101) `findRevisionSteps · workflowRevision` | 无               | 页内唯一 ID 补齐：本批最多 200 个候选关联的流程修订，用于依赖判定。                                                            |
| [114](../../apps/api/src/tasks/v1-ready.prisma-repository.ts#L114) `listInstanceTasks · task`             | 无               | 完整前置集合：本批至多 200 个实例 ID 的全部任务；实例 ID 有界，每实例任务数未有此处硬上限，不能截断依赖判定。                  |

### `apps/api/src/tasks/v1-snapshot.prisma-repository.ts`

POST /api/v1/tasks/:taskId/context-snapshots 的输入/资源闭包构造。

| 调用位置                                                                                                                    | 顶层 take | 读取范围与分页结论                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| [206](../../apps/api/src/tasks/v1-snapshot.prisma-repository.ts#L206) `findCandidateRevisions · documentRevision`           | 无        | 输入 ID 补齐：请求中全部 candidateRevisionIds；DTO 只验证数组及 UUID，未设置 ArrayMaxSize，不能称固定条数上限。    |
| [241](../../apps/api/src/tasks/v1-snapshot.prisma-repository.ts#L241) `listRoleKnowledgeBindings · projectKnowledgeBinding` | 无        | 完整知识绑定：项目全局及本角色全部绑定，决定必需资源；无绑定数上限，不可漏掉必需输入。                             |
| [296](../../apps/api/src/tasks/v1-snapshot.prisma-repository.ts#L296) `listAcceptedPrerequisiteArtifacts · task`            | 无        | 完整前置集合：同实例冻结定义中全部依赖步骤任务；任务唯一键使每依赖步骤最多一行，但定义步骤数无这里的固定上限。     |
| [319](../../apps/api/src/tasks/v1-snapshot.prisma-repository.ts#L319) `listAcceptedPrerequisiteArtifacts · artifact`        | 无        | 完整输入闭包：所有已接受前置交付集的 HOSTED 工件，形成固定上下文引用；每集工件数未受 take 限制。                   |
| [367](../../apps/api/src/tasks/v1-snapshot.prisma-repository.ts#L367) `listRolePackageResources · rolePackageResource`      | 无        | 完整角色包闭包：锁定 packageVersion 的全部资源元数据，resourceKey 排序；不能任意裁掉规范或技能，包规模须单独管理。 |

### `apps/api/src/tasks/v1-task.prisma-repository.ts`

POST /api/v1/tasks/:taskId/claims 的事务内就绪复查。

| 调用位置                                                                            | 顶层 take | 读取范围与分页结论                                                                                                    |
| ----------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| [275](../../apps/api/src/tasks/v1-task.prisma-repository.ts#L275) `runClaim · task` | 无        | 完整资格闭包：同实例冻结 step.deps 中全部前置任务，检查每个依赖 DONE/ACTIVE；每步骤最多一行，但依赖定义数无固定上限。 |

### `apps/api/src/workbench/v1-activity.service.ts`

GET /api/v1/activity?limit=...。

| 调用位置                                                                          | 顶层 take | 读取范围与分页结论                                                                                                |
| --------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| [15](../../apps/api/src/workbench/v1-activity.service.ts#L15) `list · project`    | 无        | 完整可见项目集合：当前用户全部活动 membership 对应项目；不筛 archivedAt，项目数量无上限。                         |
| [21](../../apps/api/src/workbench/v1-activity.service.ts#L21) `list · auditEvent` | `take`    | 固定预览：默认 30、最多 100 个最近审计事件，items 无 nextCursor/hasMore；event 根行数有界，上游项目 ID 集合无界。 |

### `apps/api/src/workbench/v1-workbench.service.ts`

GET /api/v1/workbench?projectId=...。领域列表只取每项目 reviews 50 / change recipients 100 / ready 50 的首批；并发项目数最多 4。

| 调用位置                                                                                               | 顶层 take | 读取范围与分页结论                                                                                            |
| ------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------- |
| [125](../../apps/api/src/workbench/v1-workbench.service.ts#L125) `get · project`                       | 无        | 全量项目集合：当前用户全部未归档项目；可选 projectId 缩为一个，默认总项目数/结果大小无上限。                  |
| [175](../../apps/api/src/workbench/v1-workbench.service.ts#L175) `loadOverdueApprovals · approvalSlot` | `50`      | 固定预览：这些项目最早到期 50 个未决定审批槽，未透传 nextCursor/hasMore。                                     |
| [283](../../apps/api/src/workbench/v1-workbench.service.ts#L283) `enrichReviews · reviewRequest`       | 无        | 页内唯一 ID 补齐：每项目首批最多 50 个 review IDs 的创建时间。                                                |
| [288](../../apps/api/src/workbench/v1-workbench.service.ts#L288) `enrichReviews · documentRevision`    | 无        | 页内唯一 ID 补齐：首批 reviews 关联的文档修订，最多 50 个唯一 ID。                                            |
| [294](../../apps/api/src/workbench/v1-workbench.service.ts#L294) `enrichReviews · task`                | 无        | 页内唯一 ID 补齐：首批 reviews 关联任务，最多 50 个唯一 ID。                                                  |
| [310](../../apps/api/src/workbench/v1-workbench.service.ts#L310) `enrichReviews · artifactSet`         | 无        | 根集合按页补齐：最多 50 个 artifactSet ID，但嵌套 artifacts 全量读取，每集合工件数未设上限。                  |
| [335](../../apps/api/src/workbench/v1-workbench.service.ts#L335) `enrichReviews · projectRole`         | 无        | 角色补齐：ID 来自全部 approvalSlots 和 tasks；slots 无这里的数量上限，不能按 50 reviews 声称角色集合至多 50。 |
| [351](../../apps/api/src/workbench/v1-workbench.service.ts#L351) `enrichReviews · requirement`         | 无        | 页内唯一 ID 补齐：首批文档评审的需求，最多 50 个唯一 ID。                                                     |
| [368](../../apps/api/src/workbench/v1-workbench.service.ts#L368) `enrichReviews · workflowRevision`    | 无        | 页内唯一 ID 补齐：首批任务评审的流程修订，最多 50 个唯一 ID。                                                 |
| [460](../../apps/api/src/workbench/v1-workbench.service.ts#L460) `enrichChanges · changeEvent`         | 无        | 页内唯一 ID 补齐：从首批最多 100 个收件记录导出的 changeEvent ID。                                            |
| [470](../../apps/api/src/workbench/v1-workbench.service.ts#L470) `enrichChanges · changeRecipient`     | 无        | 完整收件人补齐：上述至多 100 事件的全部未 ACK recipients，每事件人数无固定上限，用于完整 pendingRoles。       |
| [482](../../apps/api/src/workbench/v1-workbench.service.ts#L482) `enrichChanges · requirement`         | 无        | 页内唯一 ID 补齐：上述事件对应需求，最多 100 个唯一 ID。                                                      |
| [488](../../apps/api/src/workbench/v1-workbench.service.ts#L488) `enrichChanges · projectRole`         | 无        | 角色补齐：来自 470 全部待 ACK 收件人的 roleId，ID 数随收件人增长。                                            |
| [541](../../apps/api/src/workbench/v1-workbench.service.ts#L541) `enrichReadyTasks · task`             | 无        | 页内唯一 ID 补齐：本项目首批最多 50 个 ready task ID。                                                        |
| [565](../../apps/api/src/workbench/v1-workbench.service.ts#L565) `enrichReadyTasks · workflowRevision` | 无        | 页内唯一 ID 补齐：这些 ready tasks 的流程修订，最多 50 个唯一 ID。                                            |

### `apps/api/src/workflows/v1-role-package.prisma-repository.ts`

GET/POST /api/v1/projects/:projectId/role-packages；projectRoleKeys 供导入校验。

| 调用位置                                                                                                      | 顶层 take         | 读取范围与分页结论                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [57](../../apps/api/src/workflows/v1-role-package.prisma-repository.ts#L57) `list · rolePackageVersion`       | `query.limit + 1` | 公开分页：默认 20、最大 100，packageId/version 升序值游标，limit+1/nextCursor；内置和项目版本并列的同键顺序仍需分页稳定性用例验证。 |
| [138](../../apps/api/src/workflows/v1-role-package.prisma-repository.ts#L138) `projectRoleKeys · projectRole` | 无                | 完整角色校验：项目全部活动角色 key，用于角色包导入兼容性；角色数未设固定上限。                                                      |

### `apps/api/src/workflows/v1-workflow.prisma-repository.ts`

GET /api/v1/projects/:projectId/workflow-definitions；POST 同路径/validate 与 /:workflowKey/publish；单定义读取复用修订补齐。

| 调用位置                                                                                                       | 顶层 take         | 读取范围与分页结论                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [59](../../apps/api/src/workflows/v1-workflow.prisma-repository.ts#L59) `listDefinitions · workflowDefinition` | `query.limit + 1` | 公开分页：默认 20、最大 100，workflowKey 升序，复合唯一游标+skip:1，limit+1/nextCursor。                                             |
| [125](../../apps/api/src/workflows/v1-workflow.prisma-repository.ts#L125) `projectRoles · projectRole`         | 无                | 完整编译上下文：项目全部角色，用于编译角色映射及校验；角色总量无固定上限。                                                           |
| [646](../../apps/api/src/workflows/v1-workflow.prisma-repository.ts#L646) `revisionNumbers · workflowRevision` | 无                | 页内或单对象唯一 ID 补齐：读取 listDefinitions/findDefinition 输入对象的 currentRevisionId；公开列表每页最多 100，单对象路径最多 1。 |

### 改造前客户端完整性与待实施契约

Board 的 `apps/web/src/pages/Board.tsx:83` 展平全部列为 allCards；88–131 行的总数、角色/需求筛选选项、全局搜索及筛选后数量，144–170 行的按需求聚合与阻塞/进行中优先排序，以及 381–388 行各状态数和参与角色，全部依赖完整快照。只给每列加 take 会改变统计与筛选事实。需要把精确 summary/全局筛选与受控卡片读取分离，并为按需求视图明确续读契约；本次没有实施。

RequirementDetail 的 `apps/web/src/pages/RequirementDetail.tsx:535` 等位置以 tasks 是否为空判断是否初始化；229–303 行生成门禁，560–581 行读取相关实例依赖图，687–718 行以完整 DONE 步骤集合判断依赖和领取。600 行若找不到 taskId 就清除深链，因此分页后必须独立解析或定位该任务，不能把“首批没有”当成任务不存在。678–681 行从工件推导缺失类型，837–1004 行生成流程阶段与责任人，1007–1055 行把工件/评审/决定/变更拼成追溯，1059–1117 行统计待签字、领取和全部完成并生成下一步。这些准确摘要必须独立于历史页，完整交付历史仍须可遍历；本次没有改成首批数组。

Workbench 的 `apps/api/src/workbench/v1-workbench.service.ts:223` 每项目只请求 reviews 50、changes 100、ready 50 的首批；251–258 行只取 items，不透传领域 nextCursor/hasMore；154–158 行 counts 是这些首批的聚合长度，不是全部待办的准确总数。并发上限 4 已限制数据库扇出，仍未限制所有项目的总读取/响应，也未补项目续页或待办继续读取。

优先实施范围仍为：Board 与 requirement detail 的准确概要和端到端续页；文档修订历史的显式继续读取；flow metrics 的准确数据库聚合/受控批处理；ready 的单请求扫描预算及不足时的明确继续读取；Workbench 全部项目/待办的分页、准确总数或明确预览口径。固定 50/100/200 条入口须补续页或明确 truncated/hasMore。项目、成员、凭据、角色、仓库、权限历史及工作单元也没有统一的规模承诺。游标畸形/跨范围、同排序值、并发插入/删除、权限变化、旧/退役实例、任务深链和完整追溯均需相应契约及真实数据库/浏览器验收，不能以这份清单宣称已完成这些改造。

本节完成的是当前 109 处直接调用的静态范围与用途审查；没有把全部无 take 调用判成缺陷，没有修改权限、代次传播、事务或证据完整性，也没有给出容量/SLA 结论。**本节为 r8 冻结之后追加的文档说明，不属于 r8 的 901 文件冻结清单，也不将后续文字改动追溯算入该轮验证源码。**

## 2026-11-09 Board 分页实施与数据库验证

本节对应上述 109 处盘点之后的工作树增量，基线仍为 `739367a714097a825b96ca7ecf6bce3372855a77` 加未提交改动。文档记录者读取了实际源码、独立数据库运行日志和清理后逐表结果，没有重新连接数据库。这里的分页正确性证据不属于 r8 冻结快照；写入本节时，r9 全量门禁、构建后的浏览器验证与较大 HTTP 数据集基准仍待统一执行。

### 公开契约与客户端读取

Board 已将准确统计、全局筛选与受控页面分开。以下路径均带 `/api/v1/projects/:projectId` 前缀，要求项目读取权限和 `task:read`，需求汇总与筛选选项没有额外增加 `requirement:read`。完整接口形状见 [API 文档](../api.md)。

| 路径                         | 页面与全量事实                                                                                            | 默认及最大页大小                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /board`                 | 六列各自的首批 `cards/nextCursor`；`summary` 返回项目任务总数、筛选后总数、六列准确数量与匹配需求数量     | 每列默认 20、最大 100                       |
| `GET /board/columns/:column` | 指定列续页、准确 `total` 和 `nextCursor`                                                                  | 默认 20、最大 100                           |
| `GET /board/requirements`    | 全部匹配任务上的需求分组、每组准确状态数与角色总数；按全局 `blocked × 10 + active` 降序、需求编号升序续读 | 默认 20 组、最大 100 组；每组角色预览 10 个 |
| `GET /board/filters/:kind`   | `roles` 或 `requirements` 的真实选项页、准确数量及文字搜索；需求行更多角色复用角色选项续页并绑定该需求    | 默认 50、最大 100                           |

Web 的列视图、需求汇总、两类筛选选项和需求行角色分别使用对应路径继续读取，工具栏及需求状态统计不再从已加载卡片推断完整事实。全项目筛选选项不带当前看板的查询、角色或需求过滤；选项搜索独立分页。显式刷新会重新读取两类选项的首批、使旧续页失效，并保留选值和搜索。项目、筛选、视图或刷新代次变化后会拒绝旧响应；追加时按任务 ID、需求编号或选项值去重，续页失败保留已加载内容供重试。

单次请求中的数量与页面位于 `RepeatableRead`、`SET TRANSACTION READ ONLY` 事务。列使用 `generation DESC, id ASC` 的值游标；需求使用权重与编号值游标，选项使用值游标。游标绑定项目、规范化查询、视图/列；选项游标另绑定类型与选项搜索。搜索保留需求编号、标题、步骤 key、角色标题及活动认领人邮箱拼接后的大小写不敏感文字匹配；百分号、下划线、反斜杠按普通字符处理。

历史语义保留全部任务代次及退役流程实例，并沿用指针决定列归属的优先级：有当前交付集为 DELIVERED，无当前认领为 BACKLOG，随后处理 BLOCKED/PAUSED/CANCELLED，其余为 ACTIVE。卡片步骤名称仍来自各自绑定的流程修订。需求编号与角色值改用 PostgreSQL `COLLATE "C"` 的确定顺序，中文选项次序可能与旧客户端 `localeCompare('zh-CN')` 不同。异常重复活动认领现在按 `claimedAt DESC, id DESC LIMIT 1` 选取一条，避免扩张页面；旧路径对此没有确定顺序。

不同 HTTP 页是实时视图，只有各请求内部的一致读取；没有冻结跨请求历史快照。并发更新代次、需求权重或可见数据可使记录跨页移动，客户端去重不能保证实时变更期间绝无遗漏，刷新会重新开始读取。续页返回的列数量也可能比初次读取的工具栏汇总更新；需要同一时点的数量时应刷新。

### 数据库分页实现与静态计数增量

仓储通过参数化 SQL CTE、窗口函数和 `limit + 1` 在 PostgreSQL 中确定页面 ID，再仅补齐本页任务、单条活动认领与绑定流程修订。首屏一次确定六列各自的有界 ID，需求聚合在完整匹配关系上计算状态数、权重及排序，仅为本页需求读取前 10 个角色和是否可续读。它没有把项目全部任务、全部认领或全部流程修订加载到 Node 后切片。

Board 原来的 3 处无顶层 `take` 的 `findMany` 已替换为 2 处页内补齐查询；任务查询按本页任务 ID 集合、流程修订查询按这些任务的去重修订 ID 集合读取，两者都显式 `take: ids.length`。初始最多补齐六列各 100 条任务，列续页最多 100 条。每条流程修订中的定义 JSON 仍是完整对象，单个定义的字节大小没有因行数分页获得上限。

| 当前位置                                                             | 顶层 `take`  | 上游边界                                                  |
| -------------------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| `v1-board.prisma-repository.ts:321`，`cardsByIds · task`             | `ids.length` | 数据库分页确定的本页任务 ID；初始至多 600、单列至多 100   |
| `v1-board.prisma-repository.ts:365`，`cardsByIds · workflowRevision` | `ids.length` | 上述本页任务所引用的唯一流程修订 ID，数量不超过任务 ID 数 |

同范围 AST 复核结果现在为 **108 处直接 `findMany` / 27 个非测试源码文件 / 20 处顶层 `take` / 88 处无顶层 `take`**。计数范围仍是 `apps/api/src/**/*.ts`，排除 `*.spec.ts`、`*.test.ts`。本地机器结果为 `G:/workmesh-verify-validation-20261109-r9/pagination-count-r9.json`，SHA256 为 `c0483f0849ee19f6510c3dbbe4fd066352d017ab405c906abf5ac21151ce852d`；包含输入文件 SHA256 和逐调用文件/行号/take，属于此次增量计数，**没有替换或重做前文 109 行公开入口和用途清单**。

新增的原生 SQL 必须单独审查：全项目/匹配总数、六列统计、需求分组权重、选项去重及角色计数仍须扫描匹配关系并可能排序。输出行数有界不表示数据库 CPU、扫描行数或请求耗时与项目规模无关，静态 `findMany` 计数降低也不能代表风险清零。本轮没有新增 schema 迁移或未经查询计划测量支持的索引；仍需更大数据集的真实 HTTP 测量及必要的执行计划证据。

### 独立 PostgreSQL 回归与证据

独立回归入口为 [v1-board-pagination.database.spec.ts](../../apps/api/test/v1-board-pagination.database.spec.ts)。执行者在经身份门禁和正式迁移的新专属库 `workmesh_test_board_pagination_r1_20261109` 上运行，目标是 loopback `127.0.0.1:58390`、schema `workmesh_v1`；本次没有使用已有项目数据。fixture 为 **315 个任务、50 个需求、12 个角色**，包含六列、多个代次、退役实例、字面通配符与特殊字符、超过角色预览的单需求角色，以及影响全局权重的额外任务。日志记录 **1 个文件、7/7 测试通过，退出码 0**。

7 项回归验证了六列首屏限制与完整准确总数、每列 `limit=7` 的全部遍历及 generation/id 顺序无重复或遗漏、全项目文字及精确筛选、需求全局权重排序和准确分组计数、12 角色预览与续页及全项目选项遍历、跨视图/列/筛选与选项搜索的游标拒绝，以及仅 `task:read` 的 Agent 读取和缺 scope/项目外成员/跨项目拒绝。测试通过实际服务与 Prisma 仓储读取 PostgreSQL，**不是 HTTP 或浏览器验收**；畸形 DTO 和 HTTP 契约另由控制器等测试负责。

测试按本次精确 fixture ID 和所属项目删除数据后，执行者另以 `psql` 查询全部业务表；文档逐行核对结果为 **53 张业务表均为 0**。证据目录 `G:/workmesh-board-pagination-validation-20261109-r1` 保留如下原始文件，仅为本机证据，不是公开下载制品：

| 证据                                                            | 内容 / SHA256                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `database-guard.log`、`postgres-identity.txt`、`migrations.log` | 显式测试目标门禁、实际本地 PostgreSQL 身份和迁移记录                                 |
| `database-tests.exit`                                           | `0`                                                                                  |
| `database-tests.log`                                            | 7/7 通过；`e42f92e3dd0fef9801be421fcee2d35e0188da3c5e7a526221828f223b8b11be`         |
| `database-counts-after.txt`                                     | 独立逐表空库复核；`27e84464cb78385bc8065650cfeb64681464760effc2a65b59755bbf1779cd8d` |

### 仍待处理的读取范围

Board 已补准确概要、全局筛选与端到端继续读取；其真实浏览器表现、并发变更行为和较大数据量的资源成本仍需后续证据。该结果不解决文档完整修订历史、需求详情的工件/评审/决定/变更历史、flow metrics 聚合、ready 单请求扫描预算，以及 Workbench 的全部项目/全部待办续页和准确总数。前文关于事务依赖闭包、权限集合和交付证据不可任意截断的结论继续有效；这些入口不能因 Board 改造而标为已完成。

2026-11-10 已补充[文档概要与修订历史分页方案](../design/document-history-pagination.md)，区分新增分页/metadata 接口并迁移旧评审的兼容首切片，与概要列表、完整搜索、历史页和调用方的最终成套迁移。方案仍待实施，数据库、浏览器与性能验收均为 NOT_RUN，不据此将原列表历史分页标记完成。
