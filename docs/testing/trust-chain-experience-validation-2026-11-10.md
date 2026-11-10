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

评审、变更与可开工事项新增去重下游数量，以及成功处理后新满足前置依赖的数量。计算读取完整关联实例，独立于工作台显示页。当前工件/代次、最后审批槽、工作状态和读取权限参与解释；ACK 不推进任务，基线发布后重查。Web 可选影响排序并显示准确语义，不取代风险和时间判断。

- API 依赖算法/聚合与工作台 service 共 14 项通过；包括菱形去重、多前置、130 节点完整图、多个审批槽、过期评审、暂停/退役、ACK、基线发布、图损坏、读取异常和撤权。
- 隔离 PostgreSQL `v1-workbench-impact.database.spec.ts` 1 项通过：70 节点实例只展示一个根事项时返回 69 个下游和 1 个新增前置就绪任务，并核对零写入。
- Web 提示组件与工作台共 27 项通过。1440px/390px 两项浏览器夹具通过，检查排序、依赖文字、无写入及无横向溢出。
- 初次浏览器夹具使用错误 `/workbench` 路径失败；更正为实际 `/?projectId=p1` 后两项通过，保留失败原因，不把错误路由运行算为验证。

## O9 候选发布机器报告

新增 `pnpm release:readiness`，复用既有版本清单和远端 CI 选择逻辑；报告每项机器检查、时间、候选 SHA、dirty/HEAD 绑定和可选实际制品摘要，保留人工门禁待核对。Box 实例健康与发布决定未改变。

- `node --test scripts/verify-release.test.mjs scripts/release-readiness.test.mjs scripts/verify.test.mjs` 共 47 项通过，其中报告新增 8 项。真实临时 Git 仓库验证干净、dirty、未跟踪文件与版本不符；其余覆盖精确最新运行、失败/无法查询/未检查区分、凭据不出报告、严格参数、制品字节摘要及人工批准始终未提供。
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

限制：诊断不自动升级角色包或在途流程，不把本地匹配作为人工批准。缺少角色包锁时快照创建沿用现有输入行为；此项只解释锁与资源，未新增创建门禁。全量构建、契约、远端 CI 与最终 HUMAN 决定仍需分别记录。

## O3 需求证据完整性与正式事实时间线

需求详情返回只读 `trustChain`，从同一 RepeatableRead 数据快照聚合当前发布基线、交付、上下文快照、审批槽、人类签字、撤销与变更。Web 概览可查看缺口和验收 key 的任务承接情况，追溯页可按事件类型与当前/历史状态筛选正式事实，并定位到真实任务或评审。

诊断明确限定为平台已登记事实的关联。`LINKED` 不表示功能正确、外部测试已核验或获准发布；它不改变任务与批准状态。Agent 提交与 HUMAN 正式决定分别展示，原模型没有记录的撤回操作人保持未知，不推断签字人。旧服务端没有诊断字段时显示无法确认完整性。

当前交付按任务代次、当前工件/快照指针、流程修订、评审种类和 subject digest 核对。RELEASE 步骤必须使用 `RELEASE_ACCEPTANCE`，其他步骤使用 `TASK_ACCEPTANCE`。当前需求代次还核对 manifest 身份、固定流程中的基线策略、理解/PRD 修订、PRD 与发布资源摘要及交付范围摘要；错误引用不因代次相同而显示当前。平台明确保留的旧代次已验收任务标注 `PRESERVED_ACCEPTANCE`，历史批准不能替代返修后的当前验收。

文档与候选修订沿用既有 KB READ、作者/评审人及 PROPOSE/PUBLISH 可见性规则。不可读文档的名称、修订标识、评审和精确变更目标不进入响应；隐藏基线导致 `UNAVAILABLE`，无法核对快照时为 `SNAPSHOT_UNVERIFIABLE`，不伪造缺失或完整。聚合完成后复核当前成员资格与文档授权，基础设施错误不吞成权限问题。

2026-11-10 已执行的行为证据：

- API 定向测试 `requirement-trust-chain.spec.ts`、`requirements.service.spec.ts` 共 24 项通过，覆盖当前/历史事实、发布验收种类、同代次错误 PRD/摘要、NONE 基线策略、所有审批槽、撤销、不可确认签字、代码绑定及读取权限边界。
- 专用 PostgreSQL `127.0.0.1:59929/workmesh_test_trust_inputs_o1`、测试用户 `workmesh_test_runner`、schema `workmesh_v1` 下，`v1-baseline-publication.database.spec.ts` 10 项通过。新增真实仓库用例验证正式批准、同代次错误 manifest、PRD 替换后的历史批准、真实撤销/撤回事实、KB 撤权后的身份隐藏与成员撤权 404。测试显式设置测试环境、允许用户和测试 URL，未使用应用库。
- Web 组件与需求详情集成共 40 项通过，验证概览到时间线再到具体任务、事件筛选、来源与历史状态、评审深链以及按工件所属交付集显式展开代码证据诊断。
- Playwright 独立夹具 API 与临时端口 55448 下，`requirement-trust-chain.spec.ts` 的 1440px 和 390px 两项通过：键盘打开时间线、筛选、真实任务 DOM 焦点、无 API 写请求、无横向溢出。窄屏截图人工查看无截断；夹具不能替代真实部署或 GitHub 投递验收。
- shared 构建、API/Web 类型检查、Web 生产构建和 `pnpm test:contracts` 的 18 项运行时契约检查已通过。后续并行改动仍由最终统一门禁覆盖。

构建限制：本轮标准 API build 在 Prisma prebuild 遭外部进程占用 query-engine DLL 而 EPERM，未把它记为通过；随后独立编译曾碰到并行 O6/O7 未完成修改，需统一复验。代码来源诊断与 O6 共用的最终门禁一致性修复另行验证，不能把诊断展示当作真实 GitHub 验收。
