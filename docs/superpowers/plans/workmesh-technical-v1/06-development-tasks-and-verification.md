# 06：开发任务、数据迁移、验收与切换

> **执行调整（2026-11-01）：** T00–T08 继续作为需求与验收覆盖编号，实际替换顺序按[单一实现收敛计划](../2026-11-01-workmesh-single-implementation-plan.md)的 S00–S08。表内 `v1-` 文件路径是初始实现定位，不要求保留平行模块；正式代码、客户端和测试统一切换，不提供旧写法兼容。

本文是实施任务清单，不是本轮执行记录。用户当前要求编写可开发方案；下面的源码、依赖、数据库、服务与外部仓库操作尚未执行。数据库写入、重启、公司或外部测试仓库访问须在执行时确认真实目标与授权。

## 1. 任务组织及唯一写入责任

先按依赖顺序完成 T00–T03，再并行推进 T04/T05/T06 的独立文件，T07 在它们结束后集成。一个源码文件同一时刻只有一个写入者，Prisma schema、共享 DTO、app.module 和 CLI index 属于串行集成边界。已有用户未提交的业务功能与改名结果保留，不用 reset、stash 或覆盖整文件“回到干净基线”。

每项任务执行：先建立对应失败回归 → 实现最小完整行为 → 跑该任务的单元与真实HTTP边界 → 检查实际落盘及调用方 → 记录证据。涉及并发的正确性必须在隔离 PostgreSQL 验证，mock事务不能代替。

| ID／依赖         | 交付与主要文件责任                                                                                                                                                                                                    | 必做测试与退出条件                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| T00，无          | 记录 cwd、Git根/分支、全部已有改动及锁文件；整理当前API/CLI/Web调用。新增共享 `protocol.ts/errors.ts/canonical-json.ts/strict-json.ts`、角色包／流程schema、DTO和fixtures目录，shared双CJS/ESM构建，统一05 envelope。 | canonical JSON向量、正文bytes SHA、未知/重复字段及浮点拒绝，Node20 require/import实际加载；冻结契约后才允许后续任务修改调用方。               |
| T01，T00         | 新建 `apps/api/prisma/v1/schema.prisma` 与独立 migrations，按01–04落实实体、外键、索引、CHECK和append-only保护；旧schema/migrations保留为legacy来源，不在新运行路径生成客户端。                                       | 空隔离库建全schema；非法跨项目FK、重复slot/claim/operation、篡改不可变revision拒绝；Prisma validate和client generate通过。                    |
| T02，T01         | 替换auth controller/service/guard，新增session、Agent授权、CSRF、rate-window、confirmation与authz服务；实现01成员、业务角色、KB ACL。Web auth store改为无token session。                                              | A01–A12认证/授权套件：cookie属性、CSRF/Origin、scope交集、撤权、PKCE、丢响应恢复、票据并发消费、禁HUMAN bearer。                              |
| T03，T01/T02     | 统一PRD/Knowledge文档修订与publication，新增 `workflows` 受限DAG发布/实例、`contexts` 快照和 `reviews` 槽位决定服务；保留当前模块职责而非再建通用repository层。                                                       | 文档不原位覆盖；旧draft不替published；前PRODUCT/NONE可出稿；私库不泄露；流程非法样例拒绝；ALL最后决定原子发布，理解确认不代替PRD批准。        |
| T04，T03         | tasks/artifacts/changes/gates使用02事务与幂等协议；实现claim/release/work-status、ArtifactSet、ChangeRecipient、trace受限关系和board有效性。                                                                          | 双claim单胜、丢响应重放同结果、同key异内容409、release旧claim拒绝；并发签字不漏推进、发布与签字竞争无旧基线批准；ack并发和百条分页不丢。      |
| T05，T02/T03     | integrations拆GitHub adapter、连接/多仓库、不可变CodeReviewEvidence、WebhookReceipt；补prepare-code-evidence与有版本的票据绑定。                                                                                      | 完整04 fixture/HTTP套件；本地不访问GitHub；作者/Bot、旧SHA、dismissal、changes_requested、不完整分页、两次head变化、同号异仓、坏签名均闭门。  |
| T06，T02/T03     | CLI配置、设备login、角色包安装/锁、两宿主入口、正式检查点、materialize、候选/交付/review/receipt/changes；用新的子命令文件拆分index。                                                                                 | 03全客户端测试；本机秘密均替换为tempstore；跨目录dist使用、包资源、config优先级、网络重试、JSON/退出码、受管文件冲突及离线freshness测试通过。 |
| T07，T04/T05/T06 | Web Projects/Knowledge/Prds/Board/Profile复用当前Modal与样式，增加CLI授权页、review详情、二验、角色/ACL与流程JSON导入。同步resources、导航和错误处理。                                                                | Testing Library覆盖实际权限及状态；Playwright在隔离应用验证产品本地候选→Web发布→研发取得相同版本→交付→评审返修→验收的完整场景。               |
| T08，T07         | 完成数据导入plan/apply/verify、包发行检查、部署runbook、备份恢复、无Redis运行测试、CI隔离服务与发布证据。旧路由下线但旧数据不删除。                                                                                   | 本册第2–5节全部范围通过才可标GitHub核心闭环可用；无真实外部仓库授权时单独标记未验证，不虚报该层。                                             |
| T09，独立后续    | Codeup capability PoC、实际版本/形态取证与adapter；复用核心，不改成PASS放行或GitLab兼容猜测。                                                                                                                         | 只有经授权验证评审与当前提交关联、撤销、新提交失效、分页及认证后才标对应范围支持；未知时保持UNKNOWN。                                         |

T03首先以真实Nest HTTP、测试浏览器会话和隔离PostgreSQL完成服务端纵向切片：创建项目及默认KB → 授予受限产品role Agent → 提交理解/PRD候选 → HUMAN准确slot确认并发布 → 另一授权主体取得相同发布正文。这里还不宣称CLI、完整Web页面或任务交付可用。T04补认领与快照，T06/T07再用真正打包CLI和浏览器复现同一场景，不以API测试代替客户端交付；之后完成IMPL/GitHub门槛。

## 2. 数据升级：保留旧数据，不保留旧授权旁路

### 2.1 固定方案

目标数据库在同一被确认 PostgreSQL 实例中新建 `workmesh_v1` schema；旧业务schema保持原样，不双写、不由新API读取。新Prisma源位于 `prisma/v1/`，旧migration历史不重写、不在新schema重跑已知错误的模型。公开业务运行只使用新client；legacy schema只允许受控迁移工具访问。

创建 `MigrationBatch {id,sourceFingerprint,mappingDigest,operatorLabel,createdAt,completedAt?}` 记录导入来源和映射；迁移来源指纹不含连接秘密。普通API无创建batch或填importBatchId入口。新候选DocumentRevision可以用importBatchId解释历史来源，不伪造WebSession或人工批准；其`createdByStampId`与importBatchId精确二选一。发布后另有真实Human决定和publication，不倒填旧作者。

新增三个独立开发命令，由 `apps/api/prisma/v1/plan-import.ts`、`apply-import.ts`、`verify-import.ts` 实现，包脚本为 `db:v1:plan/apply/verify`。plan只读、输出计数和不含正文的映射问题；apply必须显式`--approved-plan <path>`，verify只读。首版没有自动drop或reset命令。

### 2.2 身份探针与快照

执行前从批准的秘密管理通道取得连接，不从聊天、日志或本机 `.env*` 读取或复制。探针核对database、schema、server identity、当前用户和允许操作范围，输出脱敏指纹；白名单外或目标不一致停止。先备份旧数据和原migration历史并验证恢复到隔离实例，再允许apply。

导出源数据时停止旧应用写入，保持一致快照；新API仍不对真实用户开放写入。apply产生可重跑的source-table/source-id映射，唯一约束防重复；同一source ID内容摘要变化而plan未更新时拒绝，不静默覆盖。

### 2.3 确定映射

| 旧记录                                   | 新记录与规则                                                                                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization/User                        | 保留稳定ID和账号数据，密码hash不打印；新authVersion=1，不迁入旧JWT/RefreshToken/WebSession，全部重新登录或授权。                                                                                     |
| Project/ProjectMember                    | 保留项目ID、名称、合法key、组织与当前成员管理角色；无活动OWNER、key冲突或非法值列为阻断，不自动选人或改编号。项目业务角色创建六个预置值，只给OWNER明确初始assignment，其他人由管理操作授权。         |
| 默认KB                                   | 每项目创建一个默认PROJECT库；旧KB保留各自名称及文档身份，在新schema按项目关联。原有项目内可读行为不作为“已审核发布”依据；受限范围由批准的映射明确设置，不猜历史保密级别。                            |
| KnowledgeDocument/DocumentChunk          | 正文保留原始文档ID或稳定映射，旧解析文本导入为候选revision；原PDF等附件能取得时保留原始bytes及摘要，只有解析文本时标明sourceRef，不能伪称已保留原文件。chunk/embedding不当权威，按新版本与授权重建。 |
| Prd/PrdVersion                           | 同一requirement聚合为逻辑PRD文档，按旧来源建立明确候选revision映射。遇同号不同内容保留两个来源候选、列冲突报告，不猜哪份正式。所有候选初始未发布。                                                   |
| Requirement/Task                         | 需求保留ID/code/原话为候选资料；新phase初始DISCOVERY，无currentPublished指针。旧任务与阶段存legacy导出供审阅，不自动生成已满足新门槛的DONE任务；新实例按已发布定义生成。                             |
| SignOff/PrdApproval/Artifact/ChangeEvent | 原记录保留旧schema及受控导出，不灌成新有效Decision/Publication/ArtifactSet；缺少基线、摘要或身份依据不能自动升级为有效批准。                                                                         |
| GitCommit/PullRequest/Trace              | 保留来源映射资料；仓库按真实连接和稳定外部ID重新绑定，旧字符串批准不作为新证据，外部状态在授权后重新只读取证。                                                                                       |

为避免无依据自动赋权，迁移plan必须逐项目列明defaultKB及旧库的visibility、creator/approver和grant；未提供这些映射时apply拒绝该项目。既有数据可保留而不自动开放应用，不等于全部回填为有效新事实。

### 2.4 切换与回退

切换前只在隔离副本执行新migration和导入验证；verify比较来源计数、ID映射、正文bytes摘要、FK/唯一约束、权限和无有效假批准。满足后部署同版本API/Web/CLI，旧应用保持停止写入，旧凭据作废。

真实切换失败时停止新应用写入并保留 `workmesh_v1` 完整备份；不得为快速回退重新开放旧身份或status旁路。优先回到维护模式并恢复已验证的新schema备份。若业务要求恢复旧应用，需要明确的人工风险决定，当前方案不自动执行。旧schema、备份和导出不会在交付后自动删除。

## 3. 隔离测试环境与fixture

### 3.1 固定环境

Node 20和24、pnpm 10.28.2、PostgreSQL 15或16，当前TS/Nest/Prisma/React锁定版本不为本功能升级大版本。核心测试不需要Redis、真实模型或代码托管token。

数据库套件加载AppModule之前，自己读取显式 `WORKMESH_TEST_DATABASE_URL` 并核验：仅loopback、数据库名 `workmesh_test_*`、测试用户范围和schema workmesh_v1；缺失或越界立即exit2，不能回退应用DATABASE_URL。调用Nest测试bootstrap设置`ignoreEnvFile=true`，不读取真实环境文件；认证、部署origin和外部adapter使用测试内生成配置。

CI可创建只用于本job的PostgreSQL服务和一次性schema，fixture凭据在测试内生成且不输出；本地脚本保持当前更严格的本机用户白名单。两者由明确 `WORKMESH_TEST_ENV=ci|local` 及受控CI标识区分，不用`NODE_ENV=test`单独豁免数据库目标检查。测试通过不授权在公司或其他租户库运行。

单元测试明确mock数据库与网络；把当前真实Redis读写用例移入单独可选集成套件。API纯构建或Prisma generate只生成本地client，不连接数据库；Prisma schema复制到隔离生成工作目录，使用显式测试配置，避免CLI自动加载现有环境文件。

### 3.2 必须新增的fixture

| fixture标识                  | 固定内容／约束                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `team-a`、`team-b`           | 两项目、各自OWNER；用户Alice同时有product/backend，Bob有qa；不同项目同名repo和同号PR，不串链。                                  |
| `kb-public`、`kb-restricted` | 公共库PROJECT，受限库只授Bob READ及明确发布者权限；Alice管理身份没有隐式正文READ。                                              |
| `product-candidates`         | UNDERSTANDING、PRD、KNOWLEDGE的UTF-8原文，创建后独立revision；多次回答有明确规则和验收落点，不使用真实客户材料。                |
| `workflow-valid`             | 03合法DAG完整JSON，PRODUCT/NONE两步、IMPL、CASES与RELEASE；相同人可占多个内部slot，代码仍要求另一GitHub用户。                   |
| `workflow-invalid`           | 环、未知role、缺依赖、丢步骤未声明理由、ALL改ANY、缺发布汇聚、产品NONE夹IMPL和删除系统门槛，每个有稳定错误code。                |
| `hosted-bytes`               | UTF-8 CRLF/LF、空字节及不可按UTF-8解释的PNG/PDF测试bytes，按原始bytes摘要，不因文本解码而相同。                                 |
| `github-normalized`          | 当前head、作者、他人APPROVED、COMMENTED、DISMISSED、CHANGES_REQUESTED、新head、Bot及多页review；遵守04来源契约，不存真实token。 |
| `concurrency-barriers`       | 两独立HTTP客户端与数据库连接、可控事务屏障；不靠sleep希望竞态碰巧出现。                                                         |
| `migration-legacy`           | 与现schema相符的脱敏小数据：冲突PRD版本、旧批准无digest、旧KB文本、无OWNER项目；映射验证应分别成功或明确阻断。                  |
| `auth-device`                | 测试内随机生成secret/challenge/password，记录只存hash；断响应时只验证metadata恢复，不打印秘密。                                 |

fixture文件放各suite的 `fixtures/` 下，payload与预期以01–05为准。只有构造与真实接口契约一致的fixture才可证明本地行为，不能用模拟结果宣称厂商已联调。

## 4. 实际验证套件与开发命令

以下脚本名是实施任务需新增／调整的目标入口，当前不能假定已存在或已经运行。

| 套件／入口                                                                                  | 执行内容                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm type-check`                                                                  | 新共享DTO、Prisma client、API、CLI、Web类型，无HUMAN JWT依赖残留。                                                        |
| `corepack pnpm --filter @workmesh/api exec vitest run`                                      | 01–05纯单元测试，网络默认拒绝，所有Redis已mock。                                                                          |
| `corepack pnpm --filter @workmesh/cli test`                                                 | 配置、bytes、安装、JSON、receipt和CLI真实dist调用；临时home/config，不访问用户凭据。                                      |
| `corepack pnpm --filter @workmesh/web test`                                                 | session无token、权限空态、准确slot确认、过期证据、知识版本与返工交互。                                                    |
| `WORKMESH_TEST_ENV=local bash scripts/test-integration.sh`                                  | 入口及套件双重测试库核验→隔离schema migration→真实Nest HTTP/Prisma并发套件；URL由用户批准通道配置，不在聊天命令写连接串。 |
| `corepack pnpm test:contracts`                                                              | 新增，基于真实Nest bootstrap导出OpenAPI，验证DTO数组／嵌套对象、错误envelope、scope、05路由和未知字段拒绝。               |
| `corepack pnpm test:e2e`                                                                    | 新增Playwright suite，仅启动显式隔离应用；真实浏览器会话、CLI授权、二验与产品到下游闭环。                                 |
| `corepack pnpm --filter @workmesh/cli build` 与 `corepack pnpm --filter @workmesh/cli pack` | dist在包外help/init/spec资源可用；tar清单不包含私人资料、环境、Run、workspace和凭据。                                     |
| `corepack pnpm build`、`git diff --check`                                                   | 最终集成构建与diff检查，不替代任何行为／权限测试。                                                                        |
| `corepack pnpm test:github-live`                                                            | 新增，缺显式授权开关与测试repo返回SKIPPED；在独立测试仓验证04实场，不推公司代码。                                         |

为E2E新增 `@playwright/test` 直接开发依赖并冻结lockfile，使用项目专属临时profile；不能借用户现有登录浏览器。A11y至少覆盖keyboard/label/focus、确认弹窗和错误可感知，沿现有Modal结构而非额外设计系统。

全部测试按以下组命名并保留精确断言：

- `auth-policy.e2e-spec.ts`：Cookie/Origin/CSRF、设备proof、scope交集、撤权与票据重放。
- `knowledge-publication.e2e-spec.ts`：受限库隐藏、候选与发布、并发revision、撤销和无外发。
- `collaboration-concurrency.e2e-spec.ts`：双claim单胜、release后旧claim、丢响应、同key异内容、事务回滚、两任务并发决定、发布与批准竞争。
- `workflow-contracts.e2e-spec.ts`：schema合法非法、绑定、裁剪审计、升级影响与平台旁路封闭。
- `change-inbox.e2e-spec.ts`：并发多角色ack、转派、>100条和同时间戳过滤分页。
- `code-evidence.e2e-spec.ts`：签名与receipt、准备证据版本、过期后旧ticket拒绝、多仓缺证据拒绝。
- `migration-v1.e2e-spec.ts`：导入plan不写、apply映射、重复批次、冲突拒绝及恢复校验。
- CLI `dist-bridge.test.ts`：从临时目录用打包文件跑完整公开命令解析，未知旧参数错误码可预期。

## 5. 最小纵向场景的完整验收

1. HUMAN注册并创建项目，得到真实默认KB和预置role；bootstrap不要求真实模型或Redis。
2. 产品CLI通过浏览器明确授权本角色写scope，在临时业务工作区取得角色资源；不用HUMAN密码登录终端。
3. 本地产品工作流形成理解候选；理解确认request在Web逐slot二验，同意后仅形成当前确认理解，不自动批准PRD。
4. 基于已确认理解提交PRD候选和deliveryScope；Web准确展示“批准并发布”，ALL满足后同事务设置发布基线并生成变更收件记录。
5. 下游研发claim并创建snapshot，另一工作区按相同manifest取得同一正文，摘要一致；受限库资料始终不进入无权快照。
6. 先用非代码DESIGN/CASES等工件验证完整交付／返工／重新交付，再用IMPL+GitHub fixture验证当前提交他人review及多仓门槛；需要真实GitHub层时单独授权运行。
7. 丢弃首次交付响应后用同操作key重试，ArtifactSet不重复，原claim/version语义不误拒合法重放；换digest或换主体不得偷读或重复登记。
8. Web准备准确代码证据→preview→密码票据→APPROVE；证据准备后head、ArtifactSet或req generation变化会拒绝旧票据，不悄悄换内容。
9. 同一人担多个业务slot分别批准，外部代码作者自审依然拒绝；所有必要任务和release slot完成才显示RELEASED。
10. 发布新知识或PRD，直接关联任务及依赖链旧批准不再满足当前门禁，历史正文/批准不删；新draft本身不改变当前发布事实。
11. 两责任人并发ack均保留；旧任务读取被撤销或失权资源拒绝；离线只能写草稿，关键动作必须联网检查。
12. 备份恢复到隔离实例后重建索引，正文、revision、grant、批准和必要附件引用及摘要一致；无Redis仍可完成核心闭环。

## 6. 运行与发布默认值

正式环境Web/API同origin HTTPS反代，API与PostgreSQL为核心；附件和角色包v1受限bytes也存PostgreSQL，避免增设对象存储。外部blob取证仅允许04登记GitHub实例；默认没有外部模型请求。个人本地工具是否另行发送资料给模型，平台不能仅靠本客户端声明证明，项目政策需同时约束实际执行环境。

备份范围包括整个 `workmesh_v1` schema及migration元数据；每日完整备份、发布前额外备份，默认保留30日，至少按周在隔离实例恢复验证一次。v1不承诺尚未实测的RPO/RTO数值；发布包注明最近恢复时间、备份策略与实际测得恢复时间。生产资料复制到验证环境须另行授权及脱敏，不因测试要求自动复制。

审核、publication、决定与业务操作日志不得被现有通用AuditInterceptor的“失败仅warn”替代：正式决定的AuditEvent必须同事务成功，否则本次批准回滚。普通诊断日志只保留requestId、资源ID、错误类别、耗时，不写正文、secret或完整上游响应。

## 7. 交付状态和后续边界

每项完成报告按源码/类型与单元、真实HTTP、隔离数据库、CLI打包、浏览器、真实GitHub、Codeup分别列证据；无权运行或未执行的层明确未验证。代码提交不是业务完成，授权创建的工程Run也要按本项目规则独立收尾，不能用其状态代替领域验收。

v1不实现MCP server、GitLab审批、Codeup猜测适配、自动租约、通用脚本引擎、全角色中央运行、实时多人编辑或供应链密码学签名。当前方案允许未来客户端和厂商通过同一契约接入，但支持范围只能依据真实验证结果标注。
