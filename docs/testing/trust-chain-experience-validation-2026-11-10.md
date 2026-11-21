# 信任链与使用体验优化验证

验证日期：2026-11-09 至 2026-11-10；工作树仍含未提交改动，结果不能替代最终提交的远端 CI 或 HUMAN 批准。实施范围和验收见 `../design/trust-chain-experience-optimization.md`。

## O1 输入诊断

API 只读检查复用快照解析并收集多个独立问题，公开经过当前读取权限检查的文档/修订定位、上游步骤、工件类型、责任人与恢复动作。正文问题保留输入原有的 required 属性；不可读对象只返回通用问题。创建路径继续使用原版本、认领和输入规则。Web 显示恢复提示；CLI 增加 `context --task <id> --inspect [--json]`，不要求认领，不写入快照。

当前验证：

- API 定向单元测试：`v1-snapshot.service.spec.ts`、`v1-snapshot.prisma-repository.spec.ts` 共 46 项通过。覆盖多项缺失、过期引用、不可读/跨项目身份隐藏、检查期间撤权、可选输入、基础设施故障与外部引用。
- 隔离 PostgreSQL：专用实例 `127.0.0.1:59929`，用户 `workmesh_test_runner`，数据目录 `.tmp/trust-chain-experience-20261109/pgdata`，数据库 `workmesh_test_trust_inputs_o1`，schema `workmesh_v1`。通过 SQL 核对实际用户、地址、端口和目录后创建空库并应用全部 21 项迁移。
- `v1-snapshot-input-status.database.spec.ts` 和 `v1-task.database.spec.ts` 首次共 35 项通过；新增真实数据库多问题/零写入回归后，input-status 套件 7 项通过。验证配置显式使用 `WORKMESH_TEST_ENV=local`、`WORKMESH_TEST_DATABASE_USERS` 和 `WORKMESH_TEST_DATABASE_URL`，未回退应用库。
- Web 输入面板 7 项、CLI 输入检查与命令 31 项通过（2026-11-09）。浏览器夹具 API 下的 1440px / 390px 两项通过，检查恢复文字、无写请求、键盘重试与无横向溢出。
- shared 构建、CLI 构建、Web 构建、API/Web/CLI 类型检查和现有 18 项运行时契约检查通过（2026-11-09）。2026-11-10 API `nest build` 通过。

限制：API 标准 build 的 Prisma prebuild 曾因已有进程占用生成客户端 DLL 返回 EPERM；随后只运行编译入口确认 API 编译。此记录不将该次完整 build 记为通过。O1 后续改动和其他优化仍需最终统一检查；浏览器夹具不代替真实部署、GitHub 或人工验收。

## O5 工作台依赖影响

评审、变更与可开工事项新增去重下游数量，以及成功处理后新满足前置依赖的数量。计算读取完整关联实例，独立于工作台显示页。只有当前工件、快照、任务与需求代次、评审摘要都匹配，其他槽已批准相同摘要，且查看者能签唯一实际未决定槽，才推演最后审批后的前置就绪数量；缺少可核对的工件或快照时返回 UNAVAILABLE/null。工作状态和读取权限参与解释；ACK 不推进任务，基线发布后重查。Web 可选影响排序并显示准确语义，不取代风险和时间判断。

- API 依赖算法/聚合与工作台 service 共 16 项通过；包括菱形去重、多前置、130 节点完整图、多个审批槽、过期评审、暂停/退役、ACK、基线发布、图损坏、读取异常和撤权，以及同工件旧摘要、旧快照/需求代次、前槽旧摘要、查看者无法签最后槽和缺少当前工件的回归。
- 隔离 PostgreSQL `v1-workbench-impact.database.spec.ts` 2 项通过：70 节点实例只展示一个根事项时返回 69 个下游和 1 个新增前置就绪任务，并核对零写入；真实工件/快照/评审验证旧摘要、旧需求代次不推演、缺快照返回未知。新增夹具首次漏填 principal stamp 的 userAuthVersion，补齐后通过。
- Web 提示组件与工作台共 27 项通过。1440px/390px 两项浏览器夹具通过，检查排序、依赖文字、无写入及无横向溢出。
- 初次浏览器夹具使用错误 `/workbench` 路径失败；更正为实际 `/?projectId=p1` 后两项通过，保留失败原因，不把错误路由运行算为验证。

## O2 收件人任务指引

变更通知复用正式事件目标和当前任务事实，按收件人本人及当前角色返回任务编号、责任归属、当前问题、下一步、只读输入检查命令与需求任务深链。Agent 在分页前限制到凭据唯一角色，保留无角色通知；HUMAN 无角色通知覆盖其全部活动角色。同角色他人任务提示联系负责人。事件原始目标不透传其他角色任务标识；无任务列表与已核实空列表分别处理，已过时基线不冒充本次变化造成的当前失效。知悉仍只代表收件，不表示调整或批准完成。

验证结果：

- API 指引与变更服务定向测试最后一次 20 项通过；与 O6/工件服务联合的七文件套件共 88 项通过（2026-11-10）。覆盖当前状态、退休/归档/角色失效、其他责任人、多角色事件、当前验收范围与明确空任务。
- 显式隔离 PostgreSQL `v1-change-guidance.database.spec.ts` 3 项通过，最后一次与 O6 八项共 11 项通过。验证角色在分页前过滤、无角色通知、稳定游标、知悉前后游标继续有效、跨用户游标拒绝、历史任务与成员撤权。
- Web 变更抽屉 8 项通过；CLI 指引、工件诊断与真实命令三文件共 34 项通过，检查 GET、分页参数及 JSON 信封保留服务端指引。
- Chromium 的 `tests/ui-review/change-guidance.spec.ts` 在 1440px、390px 两项通过：具体动作、过时基线解释、键盘直达、零 API 写请求及无横向溢出。首次夹具路由和不存在的写请求计数属性错误已修正，未作为产品缺陷或通过证据。
- API、Web、CLI 类型检查通过。根代理统一执行最终构建、契约与完整门禁；本段不将尚未运行的最终检查视为通过。

## O6 代码证据诊断与精确绑定修复

工件集读取增加逐个代码引用的来源诊断，覆盖登记仓库、可信投递、评审理由、SHA、票据有效期/消费和当前任务代次。读取在项目权限校验后聚合，完成后重新确认当前权限；数据层限制同项目，结果不输出密钥、票据秘密/摘要、原载荷或内部错误正文。关联记录查询设置 1000 项边界，超限明确不完整并停止判定证据满足。Web 评审页与需求交付物可查看，后者按准确工件集 ID 显式展开后 GET；CLI `artifact --artifact-set <id> [--json]` 只读同一接口。

原始复现与范围变化：2026-11-10 在专用 PostgreSQL 中，GIT_REF 工件声明 SHA `a*40`，经真实 HMAC 验签的同仓 PR `10` 的他人 USER 批准指向 `f*40`。原 prepare(f) 与 use(f) 成功，`assertCodeEvidenceAcceptable` 与 `codeReview.acceptable` 均通过。此结果已先保存，再增补现有设计 O6 范围。修复后 prepare 拒绝错误目标；手工模拟历史已消费错绑票据也不能通过最终门禁。测试保留原链说明与拒绝断言，没有把界面诊断当成修复。

prepare/use 与最终门禁共用来源校验：当前工件指针/代次、未退役流程、准确登记仓库提供方与 SHA、作者之外的人类最新批准、无当前修改请求、同项目 GITHUB 已验签且已处理收据。同一评审人相同有效时间的最新候选意见矛盾时，以 `REVIEW_ORDER_AMBIGUOUS` 保守拒绝，不依据本地写入时间或 UUID 推断提供方顺序；同时间修改请求同样参与当前阻塞。创建/消费票据在项目锁和 Serializable 事务内再次复核，失败不消费。每个代码引用至少有一条仍有效的精确已消费绑定；历史失效票据留作诊断，新合法绑定可恢复通过，不会永久污染当前工件集。

验证结果：

- API 七个定向单元文件共 88 项通过，含 O2、工件服务、GitHub 服务、最终门禁、来源诊断与有界读取。覆盖机器人/自批、SHA 错误、较新 head 的修改请求、相同时间矛盾意见、收据非成功处理、无关联记录、代次历史、仓库身份、超过查询范围、权限中途撤回与零摘要泄露。
- `v1-code-evidence-diagnostics.database.spec.ts` 8 项通过。真实服务路径验证签名拒绝不落收据、已验签但不合格的处理、票据准备/到期/消费/重放、跨项目/非成员/撤权、原始 SHA 绕过拒绝、旧合法票据失效、交付后修改意见失效、多引用缺口以及同仓不同 SHA 分别绑定后通过。新增恢复正例保留旧失效 consumed 票据，随后新的合格批准和新票据恢复最终门禁；丢失 prepare 响应按原幂等键返回同一票据与秘密，不另建票据。
- 原三个数据库回归文件 `v1-code-evidence.database.spec.ts`、`v1-task.database.spec.ts`、`v1-consistency.database.spec.ts` 由根代理补齐真实工件/登记仓库/收据/当前指针夹具并执行，43 项通过。第一次消费竞态出现 Serializable `P2034`；实现增加最多八次有限冲突重试后复验通过，保留“一次成功、其余 false”、过期拒绝和票据/收据回滚断言。
- Web 诊断组件、评审页和变更抽屉三文件共 30 项通过；CLI 诊断、指引与命令三文件共 34 项通过。新增实际 artifact 命令检查准确工件路径、单次 GET、无写操作、原诊断及 requestId 信封。
- GitHub Webhook HTTP 边界 9 项通过。Chromium `tests/ui-review/code-evidence-diagnostics.spec.ts` 在 1440px、390px 两项通过：展开前无工件请求、键盘展开后准确 GET、签名不可归因解释、可信收据与 SHA 阻塞动作、零 API 写请求及无横向溢出。截图位于 `.tmp/ui-review-results/code-evidence-1440.png` 和 `code-evidence-390.png`。
- API、Web、CLI 的直接 TypeScript 检查通过；最后一次标准 API `type-check` 的 Prisma 前置生成因外部进程占用 query-engine DLL 而 EPERM，没有记作通过，随后 `exec tsc --noEmit` 通过。最终格式、构建、契约与完整联合门禁由根代理统一记录。

限制：以上 GitHub 行为证据来自隔离服务路径和真实数据库，以及浏览器夹具；没有真实外部 GitHub PR/Webhook 网络投递或维护者签字。签名失败在业务收据之前拒绝，不能把未经验证的载荷归因到某工件；无评审载荷也无法用现有存储归因到具体 head。未收到关联记录不等于未投递。诊断及本机通过不代表正式批准或最终候选远端 CI。

按需代码诊断在组件本次挂载内保留首次成功读取的结果；折叠再展开不会重新查询。外部 Webhook 或新票据到达后，需重新载入页面取得新的诊断，并核对显示的 checkedAt。此展示缓存不参与服务端正式验收。

## O9 候选发布机器报告

新增 `pnpm release:readiness`，复用既有版本清单和远端 CI 选择逻辑；报告每项机器检查、时间、候选 SHA、dirty/HEAD 绑定和可选实际制品摘要，保留人工门禁待核对。Box 实例健康与发布决定未改变。

- `node --test scripts/verify-release.test.mjs scripts/release-readiness.test.mjs scripts/verify.test.mjs` 共 47 项通过，其中报告新增 8 项。真实临时 Git 仓库验证干净、dirty、未跟踪文件与版本不符；其余覆盖精确最新运行、失败/无法查询/未检查区分、凭据不出报告、严格参数、制品字节摘要及人工批准始终未提供。
- 随后独立审查复现并修复三处诊断偏差：源码检查后发生同版本本地文件修改仍被绑定候选；合法 JSON 但清单结构非法被误作版本不符；远端 run.path 类型非法被误作已知 CI 失败。机器报告现于检查结束再次核对 HEAD/dirty，并撤销变化后的候选绑定；库存不可用为 ERROR，合法版本不符为 FAIL；非法远端响应为 ERROR。两份发布脚本测试随后共 29 项通过（readiness 11 项），保留前述 47 项历史批次的范围。新增真实临时 checkout 修改与坏清单场景，及可执行命令参数错误退出 2、诊断不完整退出 1 的回归。
- 新报告套件已加入完整本地门禁的 script guards。未访问真实 GitHub，也未提供最终候选制品，不能据此解除任何远端或人工发布门禁。
- 实际工作树以当前 HEAD 为候选运行只读报告：版本清单通过，dirty 源检查失败，三个远端工作流和未选定制品均 `NOT_CHECKED`；结果为 `MACHINE_CHECKS_INCOMPLETE`、`releaseApproved=false`。JSON 保存在 `.tmp/trust-chain-experience-20261109/release-readiness-local.json`。这验证报告未把本机未提交改动的版本一致性冒充候选发布就绪。

## O4 CLI 精确执行状态与恢复

CLI 从当前平台、项目、角色与凭据范围内的私有操作回执重建执行状态，自动携带准确的 claim、generation、snapshot 和 taskVersion；不以最新任务读取结果替换原操作版本。认领返回 executionId，context/deliver 可用此 ID，review 可读取交付时自动创建的评审。显式 ID 命令保留。API 的认领和交付另返 committedState；重放只使用原操作记录中的版本，旧记录缺少准确版本时标为待检查。恢复方法与限制见 `../cli-execution-state.md`。

当前验证：

- CLI 定向测试 `execution-command`、`execution-state`、`receipts`、`operation-write`、`operation-reconcile`、`index` 共 68 项通过。覆盖跨进程调用重建、准确版本传递、原键重试、未知结果阻止下一次写、对账、范围与多执行歧义、真实子进程退出后的锁恢复、并发同任务互斥、独占回执创建与保留显式参数。
- API task/artifact 两个 service 套件共 45 项通过，覆盖当前任务已推进后仍返原提交版本、旧操作记录不伪造准确版本；此前包含两个 Prisma repository 套件的四文件批次共 79 项通过。
- 显式隔离 PostgreSQL 上 `v1-task.database.spec.ts` 共 29 项通过；核验并发获胜认领和交付的 operation refs 精确记录对应提交 taskVersion、generation、claim、snapshot、artifactSet 与 review。
- CLI 类型检查已通过；上述 O4 文件定向格式化已完成。CLI 入口文件与最终全包类型、构建和契约检查交由联合门禁统一执行，尚不在此节记为通过。

限制：命令行为测试使用受控 HTTP 响应；不表示生产 API、远端 CI 或真实 GitHub 集成已验收。本地执行状态是安全恢复线索，不是服务端新鲜度或人工批准的替代品。

## O7 角色包与上下文基线诊断

输入检查新增只读 `rolePackage` 元数据，按任务已发布工作流的准确锁返回 packageId、roleKey、version、packageDigest 及资源 path/ref/hash/bytes，并单独列出同包、同角色、当前项目或内置范围的最新严格 SemVer。CLI 普通 context 和 inspect 输出 `roleContext`：新版本可用、本地准确锁或真实资源不匹配、任务上次快照的真实角色资源变化分别提示。没有报告、不完整锁、不可读或损坏安装都不会视为匹配。历史 snapshot 不借用当前任务锁。说明见 `../role-context-diagnostics.md`。

当前验证：

- API 角色元数据、角色比较、snapshot service 和 repository 四个定向文件共 54 项通过。覆盖准确 digest、同角色同包与项目/内置范围、严格 SemVer、未配置与不可用、资源增删/摘要变化、仅 targetId 变化不冒充内容变化、旧快照不被修改。
- CLI 含 O4 的八文件批次共 82 项通过；随后新增安全中文/空格资源路径和 UNAVAILABLE/NOT_CONFIGURED 区分后，角色诊断与执行命令两文件共 18 项通过。行为覆盖正常 context 输出更新可用与本地缺失、历史快照不请求当前 task input-status、多版本共存只校验准确版本、真实 bytes 变化、损坏锁、路径穿越、符号链接祖先、旧 API 缺字段与准确变化文件列表。
- 同一显式隔离 PostgreSQL 实例上的 `v1-snapshot-input-status.database.spec.ts` 共 8 项通过。新增真实数据库场景证明：发布 1.3.0 后在途任务仍使用 1.2.0；其他项目 9.0.0 不进入可用版本；只有工作流修订切换后才报告 role ref 的实际摘要变化；旧快照、任务及 snapshot 数量未被只读检查修改。
- API 和 CLI `tsc --noEmit` 通过。O7 独立模块与测试已定向格式化；入口与联合完整检查由根任务统一执行。
- 独立审查补充严格 SemVer 大整数回归：shared 数字标识符改以十进制字符串比较，避免超过 Number 安全整数范围后漏判新版；`schemas.test.ts` 共 6 项通过，覆盖 core 与 prerelease。修改未涉及角色资源字节或已锁定版本。

限制：诊断不自动升级角色包或在途流程，不把本地匹配作为人工批准。缺少角色包锁时快照创建沿用现有输入行为；此项只解释锁与资源，未新增创建门禁。全量构建、契约、远端 CI 与最终 HUMAN 决定仍需分别记录。

## O3 需求证据完整性与正式事实时间线

需求详情返回只读 `trustChain`，从同一 RepeatableRead 数据快照聚合当前发布基线、交付、上下文快照、审批槽、人类签字、撤销与变更。Web 概览可查看缺口和验收 key 的任务承接情况，追溯页可按事件类型与当前/历史状态筛选正式事实，并定位到真实任务或评审。

诊断明确限定为平台已登记事实的关联。`LINKED` 不表示功能正确、外部测试已核验或获准发布；它不改变任务与批准状态。Agent 提交与 HUMAN 正式决定分别展示，原模型没有记录的撤回操作人保持未知，不推断签字人。旧服务端没有诊断字段时显示无法确认完整性。

当前交付按任务代次、当前工件/快照指针、流程修订、评审种类和 subject digest 核对。RELEASE 步骤必须使用 `RELEASE_ACCEPTANCE`，其他步骤使用 `TASK_ACCEPTANCE`。当前需求代次还核对 manifest 身份、固定流程中的基线策略、理解/PRD 修订、PRD 与发布资源摘要及交付范围摘要；错误引用不因代次相同而显示当前。平台明确保留的旧代次已验收任务标注 `PRESERVED_ACCEPTANCE`，历史批准不能替代返修后的当前验收。

文档与候选修订沿用既有 KB READ、作者/评审人及 PROPOSE/PUBLISH 可见性规则。不可读文档的名称、修订标识、评审和精确变更目标不进入响应；隐藏基线导致 `UNAVAILABLE`，无法核对快照时为 `SNAPSHOT_UNVERIFIABLE`，不伪造缺失或完整。聚合完成后复核当前成员资格与文档授权，基础设施错误不吞成权限问题。

2026-11-10 已执行的行为证据：

- API 定向测试 `requirement-trust-chain.spec.ts`、`requirements.service.spec.ts` 共 24 项通过，覆盖当前/历史事实、发布验收种类、同代次错误 PRD/摘要、NONE 基线策略、所有审批槽、撤销、不可确认签字、代码绑定及读取权限边界。
- 专用 PostgreSQL `127.0.0.1:59929/workmesh_test_trust_inputs_o1`、测试用户 `workmesh_test_runner`、schema `workmesh_v1` 下，`v1-baseline-publication.database.spec.ts` 10 项通过。新增真实仓库用例验证正式批准、同代次错误 manifest、PRD 替换后的历史批准、真实撤销/撤回事实、KB 撤权后的身份隐藏与成员撤权 404；另验证同项目 GitHub 签名收据和已消费票据可关联代码，关联 PR 的后续跨 head 意见会令旧批准失效。新增 GIT_REF 夹具首次漏 repoPath 触发真实 storage constraint，补齐后整套通过。测试显式设置测试环境、允许用户和测试 URL，未使用应用库。
- Web 组件与需求详情集成共 40 项通过，验证概览到时间线再到具体任务、事件筛选、来源与历史状态、评审深链以及按工件所属交付集显式展开代码证据诊断。
- Playwright 独立夹具 API 与临时端口 55448 下，`requirement-trust-chain.spec.ts` 的 1440px 和 390px 两项通过：键盘打开时间线、筛选、真实任务 DOM 焦点、无 API 写请求、无横向溢出。窄屏截图人工查看无截断；夹具不能替代真实部署或 GitHub 投递验收。
- O6 最终来源判定统一后，O3 批量读取关联 PR 的全部后续意见并复用 `codeEvidenceReviewReasons`；仓库需为未归档 PROVIDER/GITHUB，票据的 PR/仓库/head/代次和真实批准的完整 commit/head 均需匹配。BOT、自审、被后续意见取代、有效 CHANGES_REQUESTED 都不关联；新合法票据可恢复关联，历史失效票据保留。最终 API 定向 O3/O5 共 40 项、上述两套 PostgreSQL 共 12 项及 API tsc 通过。
- 工件行的按需代码诊断改为占整行；联合重跑时间线与代码诊断浏览器共 4 项通过，并查看 390px 代码诊断截图确认内容不再挤在复制按钮旁。
- shared 构建、API/Web 类型检查、Web 生产构建和 `pnpm test:contracts` 的 18 项运行时契约检查已通过。后续并行改动仍由最终统一门禁覆盖。

构建限制：本轮标准 API build 在 Prisma prebuild 遭外部进程占用 query-engine DLL 而 EPERM，未把它记为通过；随后独立编译曾碰到并行 O6/O7 未完成修改。最终对齐后的 API tsc 已通过，完整发布门禁仍由统一源码副本复验。诊断展示与本地夹具不能替代真实 GitHub 投递验收。

读取范围限制：O3 对关联正式事实执行完整批量读取；O6 的代码诊断与验收来源读取有界，票据、初始证据或后续意见任一查询超过 1000 条时标为不完整并拒绝据此通过门禁。因此 O3 的 LINKED 只表示已读取正式事实的关联，不表示 O6 有界诊断已完整或验收可通过。记录规模超过此范围时，应展开对应工件的代码证据诊断，核对其 complete 与阻塞原因；该界面仍不授予批准。

## 最终联合门禁

原工作区执行 `pnpm verify -- --apply-migrations` 在 Prisma 生成阶段遭 query-engine DLL 占用而 EPERM，未通过；没有结束占用它的外部进程。为执行完整标准入口，使用独立依赖目录 `G:/yesgoo/workmesh-validation/20261110-trust-chain-final`，离线 frozen-lockfile 安装 730 个包，再按源文件清单复制工作树。清单记录每个输入的长度和 SHA-256，不复制凭据、node_modules 或临时运行目录。

保留的失败与恢复证据：

- `.tmp/trust-chain-experience-20261109/verify-original-worktree.log`：原工作区 DLL 占用，未把后续步骤记作通过。
- `verify-independent-final.log`：独立目录首次运行在两个文件的格式检查失败，随后仅格式化相关文件。
- `verify-independent-final-2.log`：格式、lint、类型、全包单元、脚本保护、Prisma 隔离及 18 项契约通过；API 集成为 230 项通过、13 项跳过、1 个套件失败。新增文档历史测试的 `Project.key` 夹具使用 11 字符，违反正式 `VARCHAR(6)`，12 项用例因 beforeAll 失败未执行，不能算作有效跳过。原工作区已有 6 字符修复，复制后单文件 12 项全部通过；未改变 schema 或产品约束。
- `coverage-preflight.log`：并行修改期间的覆盖率预检已中止，没有有效覆盖率结论；只结束本次预检自己的 Vitest 进程，未终止外部进程。

最终复核另外补齐 O3 事件关联：任务/文档评审必须匹配准确主体、代次、摘要和评审种类，决定必须匹配评审摘要；能核实的旧主体标历史，缺失或矛盾的关联标未知，撤销优先保留撤销。文档发布基线也核对正式评审种类，避免概览 LINKED 与时间线 UNKNOWN 冲突。定向两个文件 32 项通过；其中类型缺失/错误先取得四项红测，再修复。

### 最终执行结果

2026-11-10 18:17:14.721 +08:00 冻结的源清单包含 1,057 文件、11,975,395 字节，清单 SHA-256 为 `59e5ebd656f69a3473e8e2b3486d3b04fcb8c43a3f3155930bb7a14191920858`。复制后源与副本全部输入逐字节一致。使用 Node 20.19.0、pnpm 10.28.2、专用 PostgreSQL `127.0.0.1:59929/workmesh_test_trust_full_final` 和 `workmesh_test_runner`，执行未删减的标准入口：

```text
pnpm --dir G:/yesgoo/workmesh-validation/20261110-trust-chain-final verify -- --apply-migrations
```

最终运行于 18:32 完成，退出码 0，返回 **LOCAL_QUALITY_PASSED**。原始日志 `.tmp/trust-chain-experience-20261109/verify-independent-final-3.log`。

| 检查                                       | 实际终态                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 格式、workspace lint、ESLint、全包类型检查 | 全部通过，API 正式 Prisma 生成钩子在独立目录通过                                                                    |
| 全包单元测试                               | shared 91、box 38、CLI 383、role-packages 29、Web 666、API 945，共 2,152 通过；CLI 2 跳过                           |
| 脚本保护、Prisma 隔离、运行时契约          | 脚本 251 通过 / 1 跳过；隔离检查通过；契约 18 项通过                                                                |
| 正式迁移与 API 集成                        | 21 项迁移已应用且无待执行；29 文件 242 项通过、1 项跳过                                                             |
| schema drift                               | No difference detected                                                                                              |
| 所有包生产构建与三份 bundle 证据校验       | 通过；bundle 结果仍为 PARTIAL_MODULE_EVIDENCE，不等于完整制品 SBOM                                                  |
| 真实 Chromium + 隔离 API/数据库            | 4/4 通过，含 PRD 变更令旧 QA 证据失效及新基线验收、Agent QA 交付后浏览器签字与 RELEASE 继续阻塞                     |
| Chromium UI 合约                           | 87/87 通过，含本轮 1440px / 390px 输入、变更、依赖影响、时间线和代码诊断                                            |
| API 综合覆盖率                             | 130 文件、1,187 项通过 / 1 跳过；lines 85.94%、branches 75.13%、statements 84.24%、functions 88.96%；原门槛全部通过 |

CLI 两项跳过是 Windows 上不适用的 POSIX 0600/0700 权限模式检查；脚本一项跳过是当前 Windows 主体不能创建文件符号链接。API 集成及覆盖率跳过同一个 `WORKMESH_POC_LIVE=0` 的外部模型联调用例。没有通过跳过数据库、浏览器或降低覆盖率阈值取得成功。

构建会重新生成六份角色 manifest 与 generated.ts，七份文件从 CRLF 变为 LF。后置核对规范化后 7/7 相等，角色路径 82/82 相同，非 manifest 文件 76/76 原始字节相同，70/70 角色资源的实际字节、SHA-256、长度与声明全部一致；未改角色资源或已锁版本。后置审计保存于 `validation-source-audit.json`，源清单为 `validation-source-manifest.json`，均在上述临时证据目录。

### 并行源码与结论边界

冻结后其他任务继续修改文档历史/需求 PRD 概要读取及通知懒加载，包括 knowledge module、Web resources 与 ReviewDecision、其测试和 UI fixtures，并增加 requirement-prds 的 service/controller/数据库用例、通知组件及相关文档。后置审计逐文件列出差异和新增项；本次完整门禁只证明冻结快照，不把持续变化的当前工作树或后续切片写成全量通过。没有回退这些修改，也未执行 index、commit、reset 或 push。

18:28 在当前工作区额外运行 `ReviewDecision.test.tsx`、`CodeEvidenceStatus.test.tsx`、`RequirementDetail.test.tsx` 三文件共 81 项通过，日志 `live-web-concurrency-regression.log`。这是该时刻的定向回归，不能替代后续全部改动的联合门禁。两份本轮设计/验证记录在最终结果后追加说明，只执行定向格式检查。

仍未执行最终 clean SHA 的远端 CI/platform-smoke、真实外部 GitHub PR/Webhook 网络投递、外部团队或正式 HUMAN 发布验收、完整制品与许可证/安全扫描、生产恢复/容量/长期稳定性、跨平台升级卸载回滚及完整跨浏览器/辅助技术验收。真实浏览器中的测试账号签字仅证明隔离场景，不代表本次发布获批。

运行结束后仅关闭本轮 `pgdata` 对应的 PostgreSQL 实例（PID 25364），`pg_ctl stop -m fast` 成功，并确认 59929 端口已释放；浏览器测试端口 55442、55443、55479 已无监听。临时日志、源码清单、数据库目录与验证副本保留供复核。最终两份记录的 Prettier 检查通过。
