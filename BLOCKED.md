# 当前阻塞与外部验证

> 本文件只记录仍需要外部条件、生产窗口或额外验收的事项。已经完成的本地验证见 [当前交付与验证状态](docs/phase-status.md)、[工程整改验证](docs/testing/remediation-verification-2026-11-03.md) 和 [本机部署与团队使用验收](docs/testing/team-acceptance-2026-11-03.md)。

## B0 发布候选质量门禁与维护责任

当前本地证据以[统一入口验收](docs/testing/local-verification-validation-2026-11-07.md)、[Board 分页验收](docs/testing/board-pagination-validation-2026-11-09.md)和[许可证分发验收](docs/testing/license-distribution-validation-2026-11-07.md)为准；以下较早轮次保留历史范围。r13 于 2026-11-09 在新空库完成同源完整运行，实际 exit 0 / LOCAL_QUALITY_PASSED，2026-11-10 核对终态及 915 个冻结源码文件无变化：API 812、Web 556、CLI 288 passed / 2 skipped、脚本 240 passed / 1 skipped、真实 PostgreSQL 194 passed / 1 skipped、Chromium 4/4、UI 55/55、coverage 1006 passed / 1 skipped，lines 83.39%、branches 70.54%。20 项迁移、18 项契约及无缓存生产构建通过。r13 只在 r12 上加入三个测试修复，没有混入后续 live 源码；r8 成功及 r12 失败均保留原范围。清单 SHA256 为 `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b`，日志为 `d17d33f102fde6be4862df4aa723928ea25cebc632fc4dc165d06d31c4840fdc`，证据在 `G:/yesgoo/workmesh-validation/20261109-r13/completed/`，本次文档在清单之外。

同源首页 JS 为 284314 B raw / 94516 B gzip，原始 <200000 B 目标仍开放。small/history 两组真实 HTTP 基准随后在各自新库通过，测量零错误、Board 分页正确性及独立 SQL 的 53 张业务表空库复查通过；万条修订数据仍显示文档列表读取放大，生产容量未证明，详见[HTTP 基准记录](docs/testing/api-benchmark.md)。11 月 9 日原 PostgreSQL 进程异常退出后，次日重启并重新核验才执行基准，这些结果不能证明服务连续稳定。这些本机快照结果仍不解除最终 clean SHA、远端 CI、真实外部交付、完整制品和维护责任门禁。

2026-11-10 又从 r13 同源生产构建生成 Box `09d0d2baf4175a96970be9db3c48879b4ad0887cb480420829f1b53eb6a6c3d3` 与 CLI `7c06512dbc1264e46570e6992bd73a75aa7cc85d72862daae2348b27bd840337`。同包的隔离生命周期、20 项迁移、四阶段健康、55 表备份与恢复标记、自有服务停止均实际通过；最终 ZIP 的独立扫描、bundle 绑定、两份 CycloneDX 1.7 校验和许可证索引文本字节核对也通过。915 源码与 807 项选定打包输入复查一致。整体仍 `DRAFT_PARTIAL_COVERAGE`，Box 保留 23 条 UNKNOWN，原生组件许可、完整来源与依赖边尚未齐；本轮不包含后续 live 源码，也不解除新机、升级或卸载门禁。较早许可证 r2 的 `239abf9b…` / `d0ccfeaa…` 保留原历史范围。详情见[生命周期](docs/testing/box-lifecycle-validation-2026-11-07.md)与[制品扫描](docs/testing/artifact-sbom-validation-2026-11-07.md)。

发布入口现在同时要求同 SHA 的 CI、Platform smoke 和 Security 最新匹配 main push run 全部成功；18 项本地门禁回归通过，尚未取得最终候选的真实远端 run。这一配置变化不解除发布批准和维护责任。

后续四文件的工作台按需加载切片已用同一基线独立复验：首页 raw 从 468746 B 降至 284700 B，Web 658/658、类型/构建及生产 Chromium 三项通过。原 200000 B 目标仍未达；该切片未重跑完整门禁或重打包，不能借用 r13 的包或完整结果，见[验收记录](docs/testing/workbench-dialog-loading-validation-2026-11-10.md)。Prisma 6 升级计划也已补齐，实际依赖未升级。

文档历史与评审精确读取兼容首切片随后通过 r4 本地验证：API 936、Web 666、数据库/HTTP 41、生产 Chromium fixture 87 项；1,057 冻结文件后置一致，55 张业务表清理为空。旧文档列表仍嵌入全部历史，概要/完整搜索/主页面迁移及最终候选完整门禁仍待。该局部结果不覆盖其他并行 live 变更，也不借用 r13 制品，详见[验证记录](docs/testing/document-history-validation-2026-11-10.md)。

需求专用 PRD 概要与任务评审迁移随后通过 r5/r7：API 957、Web 691、真实 PostgreSQL/HTTP 52、最终生产 Chromium fixture 89，1,062 文件冻结来源及 18 个 live 切片文件一致。r7 只改浏览器 fixture，未变化检查明确复用 r5；两轮浏览器失败均保留。第 61 份文档、205 条历史下仍精确读取发布版本，概要字节不随历史增长；旧通用列表、完整搜索/主页面分页、首页原始体积预算和最终完整门禁仍开放，详见同页后续切片记录。

通知按需加载独立 r1 已通过 Web 696/696、类型/定向 ESLint/生产构建和生产 Chromium fixture 95/95，冻结源与六个 live 切片文件一致。同源首页 284938 B raw 降至 284227 B，仅减少 711 B，gzip 估算增加 220 B，原 `<200000 B raw` 目标仍开放。邮件操作由 fixture 拦截，真实投递未验证；本轮未运行 API/数据库/完整门禁或打包，详见[通知验证](docs/testing/notification-loading-validation-2026-11-10.md)。

通用文档概要后端 r2 已通过 API 1015/1015、类型/定向 ESLint/18 项契约/生产构建和真实 PostgreSQL/Nest HTTP 65/65，新库 55 张业务表清理为空。1,079 冻结文件及 14 个 live API 文件一致，205 历史与 107 文档分页、搜索、权限及快照有实际证据；首轮 lint 失败保留。旧三个 GET 的完整历史数组和未迁移页面仍在使用，不能据新增概要 API 关闭读取放大、容量、最终完整门禁或发布条件，详见[概要接口验证](docs/testing/document-summary-validation-2026-11-10.md)。

批量变更按需加载 r4 已通过 Web 709/709、类型/定向 ESLint/生产构建与生产 Chromium fixture 101/101；三轮失败记录保留，1,072 文件与九个 live 切片文件一致。同源首页降到 281475 B raw / 94334 B gzip，原 `<200000 B raw` 预算仍未达。浏览器确认写入为 fixture，本轮未跑实际 API/数据库写入、完整门禁、打包或远端 CI，详见[批量变更验证](docs/testing/batch-change-loading-validation-2026-11-10.md)。

项目准备清单概要迁移 r1 已通过 Web 725/725、类型/定向 ESLint/生产构建与生产 Chromium fixture 117/117；1,088 个冻结文件及十四个整合/本切片 live 文件一致，API 与已通过 r2 相同。必需文档去重概要、读取失败待确认和切项目/流程隔离旧结果已验证；主列表迁移、容量、最终完整门禁和发布条件仍开放，见[准备清单验证](docs/testing/readiness-summary-validation-2026-11-10.md)。

流程资料概要迁移 r1 已通过 Web 743/743、类型/定向 ESLint/生产构建与生产 Chromium fixture 137/137；1,091 个冻结文件及五个 live 实现/测试文件一致。分页部分失败、绑定未知禁写和跨作用域竞态已有 fixture 证据，API/数据库保持父来源并未重跑；主页面、容量及最终门禁仍开放，见[流程资料验证](docs/testing/workflow-summary-validation-2026-11-10.md)。

概要真实 HTTP 对比 r1/r2 的 history 搜索事务超时失败保留；字段转换优化后 API r3 通过 1017 用例、18 契约及真实 PostgreSQL/HTTP 65，同源 benchmark r3 的 small/history 各 43 正确性和 200 测量请求零错误，两组新库各 55 业务表清理为空。history 旧列表 8298118 B、概要 146850 B；原超时问题有复验证据，但旧消费者、多 KB 权限查询、容量和最终门禁仍开放，见[API 回归](docs/testing/document-summary-validation-2026-11-10.md)与[对比记录](docs/testing/document-summary-benchmark-validation-2026-11-10.md)。

PRD 主页面 r2 已通过 Web 789/789、类型/定向 lint/生产构建与生产 Chromium fixture 155/155；首轮四项失败保留，107 文档与 123 历史的原计数及后页评审场景复验通过。1,102 冻结文件一致，API 与概要 r3 相同；独立比较的 235 个 Web/UI-review 文件仅未纳入本轮的并行 Knowledge 页面不同。Knowledge、其他旧消费者、全局 legacy 评审兼容、真实写入与完整发布门禁仍待，见[PRD 验证](docs/testing/prd-summary-history-validation-2026-11-10.md)。

- 2026-11-06 本机默认 Node.js 为 20.13.1，低于项目要求。临时使用 Node.js 24.22.1 的全仓测试曾出现真实 Git 集成用例超时；调整相关测试的有限时限后，一次无缓存全仓复测 8/8 个任务通过。该结果来自未提交工作树，不是最终候选 commit 的发布证据。
- 2026-11-07 在官方 Node.js 20.19.0 的隔离源码副本完成 frozen 安装、无缓存构建 6/6、类型检查 10/10、全仓测试 8/8 和 18 项契约；后续变更后的 API 覆盖率为 923 passed / 1 skipped，真实 PostgreSQL 根集成为 181 passed / 1 skipped，Web 单测 529 项和真实 Chromium 四项通过。全仓构建、类型及测试为早于基线和页面改动的快照，后续检查的范围与失败修复记录见[质量收尾记录](docs/testing/quality-closeout-2026-11-07.md)。仍待最终 clean SHA 的同源远端 CI 与 Platform smoke，不能把 dirty 快照当作最终候选。
- 发布工作流已接入严格 SemVer、全部 9 个 manifest 版本一致性及同 SHA `main` push CI/Platform smoke 最新匹配 run 成功门禁；本地 release guard 6 项测试通过，远端 run 仍须实际取得，不能因配置已加入而解除本项。
- 稳定版还需要管理员核验第二维护者、安全报告私密入口、分支保护、发布审批及恢复和发布替补，证据入口见 [维护者说明](MAINTAINERS.md) 和 [GitHub 设置核验](docs/operations/github-settings-verification.md)。
- 工作流已接入实际 Box/CLI ZIP 扫描、bundle 侧车验证及严格离线 CycloneDX 1.7 结构/格式校验。最新本机 Box `554eae8b…` 扫描有 276 条组件、23 条 UNKNOWN，CLI 扫描仍仅一条 Node；两份 schema 校验通过，另有明确标注的实际 bundle 模块证据。原生内嵌组件、预打包候选最终归因、UNKNOWN 精确版本和许可证义务仍未齐，保持 `DRAFT_PARTIAL_COVERAGE`，见[制品 SBOM 验证](docs/testing/artifact-sbom-validation-2026-11-07.md)。
- 最新工作区生产审计为 166 个依赖、零项发现；全量为 840 个依赖、1 项低危、0 项中危/高危/严重。esbuild、glob、minimatch 路径已通过限定调用方的兼容覆盖修复；deepmerge 4.3.1 已加入本地补丁并通过 12 项回归，版本公告继续保留，未添加忽略或风险豁免。补丁不等于上游安全版本或所有输入均安全，仍需跟踪上游及维护者处置，见[依赖审计记录](docs/security/dependency-audit-2026-11-07.md#同日后续兼容覆盖与本地补丁)。
- 登录邮箱与密码二验按失败预算预约、成功仅退自身原窗口；后续源码已修复注册/登录共享 IP 和账户/CLI 剩余冷却。认证 117 项、全 API 单元 713 项通过，根集成入口在新空库应用 20 项迁移，172 项通过、1 项 Ollama POC 跳过。旧计数保留，但必须暂停旧认证写入并排空后全量切换；混合旧节点不能承诺严格共享上限。最终候选制品和远端 CI 仍待，见[共享 IP 限流验证](docs/testing/shared-ip-rate-limit-validation-2026-11-07.md)。
- 2026-11-06 已从独立源码副本真实重新打包 Windows Box ZIP（SHA-256 `7710af641a6f50497495482eeb3bf10f12cadc726d5a714a14c32580008324dc`），直接解压后完成安装、20 项迁移、API/Web 健康检查、冷启动、幂等启动和停止；包内 Box CLI 的备份验证、恢复到另一库及恢复后应用健康检查也通过。该结果来自当时未提交工作树，不是最终候选或新机器验收。仍待最终候选制品的新机与内容核对、旧版本升级和卸载；CLI 目前没有 upgrade/uninstall 命令。详细证据与使用条件见[发布与升级验收](docs/releasing.md#2026-11-06-本机重新打包验收)。
- 解除条件：上述技术门禁和管理员核验均有可复核记录，且发布负责人确认全部记录对应最终候选及其适用范围。

2026-11-07 补充：实际 ZIP 的安装/迁移、四阶段健康检查、备份验证、恢复标记和安全停止已由新生命周期检查器完整复现，36 项检查器防护回归通过，并接入 Release workflow。见 [Windows Box 生命周期验证](docs/testing/box-lifecycle-validation-2026-11-07.md)。最终候选远端运行、新机、旧版本升级与卸载门禁继续保留。

同日后续：Prisma CLI 已显式声明为运行依赖，Box 改用 production deploy。同步源码的隔离副本无缓存构建 6/6 后重新生成包含密码二验和登录修复的新 ZIP（SHA-256 `ff80618f58e2eb2c6f7b592a4abd0d01e06603c6f9d07802f2efa011b28b10bf`）；该 ZIP 的制品扫描和完整本机生命周期实跑通过，deepmerge、glob、minimatch 和 Nest CLI 已从实际扫描中移除。SBOM 仍为部分覆盖草稿（Box 276 条组件、160 条 npm、23 条 UNKNOWN；CLI 仍仅识别 Node），工作区四项依赖公告仍待处置。上述结果来自 `739367a` 加未提交改动的快照，不能解除最终 clean SHA、远端 CI、完整 SBOM、新机和旧版本升级门禁。详见[运行依赖缩减验证](docs/testing/box-production-dependencies-2026-11-07.md)。

再后续：包含共享 IP 修复与 bundle 证据的 Box `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d` 已重新打包，同 SHA 的完整本机生命周期通过。bundle 隐私过滤修复后，无缓存重构建 6/6，61 个受管输出及侧车与归档字节相同；bundle/schema 回归共 62 项、扫描防护 30 项通过。最终实际扫描及两份 1.7 schema 校验通过，整体 SBOM 仍部分覆盖；详情见[bundle 验证](docs/testing/bundle-evidence-validation-2026-11-07.md)。这没有解除干净候选、远端、新机、升级卸载、生产和维护者责任门禁。

同日后续：完成基线变更和需求详情页修复后，又生成本机 Box `554eae8b559c33f2cf771fae36eb4163aaca1c2bd976287da1c302e3c9035c6e` 与 CLI `6c5bd81bd745971856337aff6febe0e76a431857714ba0f47db6fb24f56f1780`。该 Box 的 20 项迁移、四阶段 API/代理/Web 健康、备份验证、55 张表、恢复标记和自有服务停止全部通过；实际 ZIP 的独立扫描、bundle 和 schema 复核通过，SBOM 仍部分覆盖。此前 `96d555cd…`、四项公告与其他旧 ZIP 的结果继续是历史快照；详见[质量收尾记录](docs/testing/quality-closeout-2026-11-07.md)。

## B1 生产迁移与生产恢复

- 2026-11-06 当前未提交工作树在隔离 PostgreSQL 空库应用了全部 20 项迁移，Prisma 漂移检查无差异；一次备份恢复到另一空库后核对了 20 项迁移、55 张表和一条测试数据。这次演练不代表最终候选 commit 或生产环境验收。
- 同日重新打包的实际 ZIP 又通过包内 Box CLI 的 `backup --verify`、恢复到另一库和恢复后应用健康检查，核对 20 项迁移、55 张表及演练验证标记；这补充的是本机隔离制品证据，不解除生产窗口、RTO/RPO 或最终候选门禁。
- 仍待：在当前待发布 commit 上应用全部迁移并检查漂移；随后完成生产库迁移窗口、生产备份恢复演练、升级回滚和正式 RTO/RPO 记录。
- 记录模板：[运维演练记录模板](docs/operations/game-day-record-template.md)。
- 解除条件：维护者确认目标、备份、回滚责任人和运维窗口，并在最终待发布 commit 上重跑验证。

## B2 GitHub live 与真实 Webhook

这一项是在测试仓库中创建或使用一条测试 PR，核对 GitHub 的变更通知能否送达 WorkMesh，以及代码提交能否正确关联交付证据。Webhook 就是 GitHub 主动发送这类通知的接口。当前用户无需为本地整改准备这些条件；没有获准的测试目标时保留为未验证，继续本地工作。凭据应通过本机环境或密钥配置提供，不在聊天中传递。

- 只读 live 入口和证据归一化器已实现；2026-11-03 验收没有指定获准测试仓库、PR 和凭据，因此结果为 SKIPPED。
- 仍待：真实仓库/PR/reviews 分页、Webhook 投递与签名、提交级证据绑定和发布链路联调。
- 记录模板：[GitHub 仓库设置核验](docs/operations/github-settings-verification.md)。
- 本项是在测试用 GitHub 仓库核对代码、评审与交付通知的联动；不要求试用者先懂 GitHub 配置，也不阻塞可独立完成的本地整改。没有获准外部目标时继续标记未验证，凭据只通过本机密钥配置提供。
- 解除条件：由负责联调的维护者准备获准测试仓库、只读凭据和可接收 Webhook 的隔离目标，再实际留证。

## B3 完整浏览器产品闭环

- 基础浏览器自动化已覆盖账户/会话、创建项目、页面加载、登出再登录和 CSRF 拒绝。
- 2026-11-06 隔离真实 Chromium 复测中，上述基础账户与 CSRF 两项通过；新增业务链因测试流程与角色包输出/输入契约不匹配，在工作流校验阶段失败，尚未到达人工审批。不能将新增测试文件或静态检查通过视作完整闭环已验证。
- 2026-11-07 修正真实基线与角色包契约，并修复成功密码二验消耗失败额度的问题后，真实 Chromium 三项通过。新增链覆盖 Agent QA 交付、浏览器读取证据、密码确认票据批准及刷新后的 APPROVED/DONE、认领释放；IMPL 仍开放，RELEASE 继续等待前置。见[浏览器 QA 验收](docs/testing/browser-qa-acceptance-2026-11-07.md)。这补充 QA 人工验收证据，不解除完整 B3。
- 同日后续真实 Chromium 四项通过，新增 PRD 变更后任务失效、三角色确认、旧认领和快照拒绝、新基线重新交付及批准；修复需求详情页选项卡切换被旧 taskId 重新覆盖的问题。该链结束时 IMPL 仍开放、RELEASE 仍等待前置，见[基线变更验收](docs/testing/baseline-change-validation-2026-11-07.md)。
- `first-run-demo.mjs` 已改用相同流程 helper，但其独立 API 实跑被自动审批以 `blocked by policy` 拒绝，本轮没有该脚本独立通过证据。
- 仍待：代码项目从 IMPL 到 RELEASE 的完整发布链、超出上述范围的变更传播、跨浏览器和无障碍验收。
- 当前代码项目的 GIT_REF 批准还要求已消费、绑定项目/仓库/PR/head 的非 Bot APPROVED 评审证据；真实写入入口是验签后的 GitHub Webhook。本地 git 提交、测试脚本或应用内人工票据不能替代这份证据，因此代码项目 IMPL→RELEASE 完整链依赖 B2 的获准外部目标。不得改成无代码托管工件来声称代码链已完成。
- 记录模板：[质量基线记录模板](docs/testing/quality-baseline-template.md)。
- 解除条件：使用隔离 API、数据库和浏览器跑完整流程，并保留结果和边界。

## B4 跨平台安装与长期运行

- Windows 隔离安装、启动、备份、恢复和团队验收已有记录；Linux/macOS 适配器已实现但尚无对应平台验收。
- 仍待：Linux/macOS 安装、服务管理、升级、卸载、备份恢复，以及长时间稳定性和容量测试。
- 记录模板：[质量基线记录模板](docs/testing/quality-baseline-template.md) 和 [运维演练记录模板](docs/operations/game-day-record-template.md)。
- 解除条件：在目标平台使用干净机器或隔离环境完成可复现验收。

## B5 外部真实团队证据

- 本地三人测试团队已经走过需求、交付、返修、评审、发布和恢复流程；这不等于外部团队使用。
- 仍待：至少一个真实团队完成一条需求的人工签字链路，并留下时间线、截图和度量结果。
- 记录模板：[外部团队验收记录](docs/operations/external-team-acceptance-template.md)。
- 解除条件：由维护者记录外部团队授权、过程证据和已知限制。

## B6 未完成产品协议

- Product Agent 第一阶段已有本地状态、理解、候选和 PRD 草稿路径；候选提交已经接入既有人工评审请求。
- 仍待：澄清服务 API 与任务精确阻塞/恢复、15 章 PRD、原型 verify、产品/QA 验收和归档闭环。
- 解除条件：按 [dev-plan.md](docs/dev-plan.md) WP12/WP13 的验收项实现并补测试。
