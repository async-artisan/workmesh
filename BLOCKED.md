# 当前阻塞与外部验证

> 本文件只记录仍需要外部条件、生产窗口或额外验收的事项。已经完成的本地验证见 [当前交付与验证状态](docs/phase-status.md)、[工程整改验证](docs/testing/remediation-verification-2026-11-03.md) 和 [本机部署与团队使用验收](docs/testing/team-acceptance-2026-11-03.md)。

## B0 发布候选质量门禁与维护责任

- 2026-11-06 本机默认 Node.js 为 20.13.1，低于项目要求。临时使用 Node.js 24.22.1 的全仓测试曾出现真实 Git 集成用例超时；调整相关测试的有限时限后，一次无缓存全仓复测 8/8 个任务通过。该结果来自未提交工作树，不是最终候选 commit 的发布证据。
- 仍待：在支持的干净环境对同一最终候选 commit 完成全部质量门禁、保留失败或通过日志，并取得对应的远端 CI 结果；若超时再次复现，继续定位并重新验收。
- 发布工作流已接入严格 SemVer、全部 9 个 manifest 版本一致性及同 SHA `main` push CI/Platform smoke 最新匹配 run 成功门禁；本地 release guard 6 项测试通过，远端 run 仍须实际取得，不能因配置已加入而解除本项。
- 稳定版还需要管理员核验第二维护者、安全报告私密入口、分支保护、发布审批及恢复和发布替补，证据入口见 [维护者说明](MAINTAINERS.md) 和 [GitHub 设置核验](docs/operations/github-settings-verification.md)。
- 工作流除了工作区生产 npm 清单，已接入实际 Box/CLI 归档扫描；本机制品扫描识别 Box 813 条组件记录、独立 CLI 仅 1 条 Node 记录，仍明确为 `DRAFT_PARTIAL_COVERAGE`。须补齐 CLI/Web bundle 模块、原生运行时内嵌组件、UNKNOWN 分类、许可证和完整 schema 校验，见[制品 SBOM 验证记录](docs/testing/artifact-sbom-validation-2026-11-07.md)。
- 2026-11-07 工作区生产审计为零项，但全量审计有 2 项低危、2 项中危，本轮 Box ZIP 包含其中三个包的受影响版本；可达性、兼容修复和维护者风险批准尚未完成。不能仅以生产依赖审计零项解除制品风险，见[依赖审计记录](docs/security/dependency-audit-2026-11-07.md)。
- 2026-11-06 已从独立源码副本真实重新打包 Windows Box ZIP（SHA-256 `7710af641a6f50497495482eeb3bf10f12cadc726d5a714a14c32580008324dc`），直接解压后完成安装、20 项迁移、API/Web 健康检查、冷启动、幂等启动和停止；包内 Box CLI 的备份验证、恢复到另一库及恢复后应用健康检查也通过。该结果来自当时未提交工作树，不是最终候选或新机器验收。仍待最终候选制品的新机与内容核对、旧版本升级和卸载；CLI 目前没有 upgrade/uninstall 命令。详细证据与使用条件见[发布与升级验收](docs/releasing.md#2026-11-06-本机重新打包验收)。
- 解除条件：上述技术门禁和管理员核验均有可复核记录，且发布负责人确认全部记录对应最终候选及其适用范围。

2026-11-07 补充：实际 ZIP 的安装/迁移、四阶段健康检查、备份验证、恢复标记和安全停止已由新生命周期检查器完整复现，36 项检查器防护回归通过，并接入 Release workflow。见 [Windows Box 生命周期验证](docs/testing/box-lifecycle-validation-2026-11-07.md)。最终候选远端运行、新机、旧版本升级与卸载门禁继续保留。

## B1 生产迁移与生产恢复

- 2026-11-06 当前未提交工作树在隔离 PostgreSQL 空库应用了全部 20 项迁移，Prisma 漂移检查无差异；一次备份恢复到另一空库后核对了 20 项迁移、55 张表和一条测试数据。这次演练不代表最终候选 commit 或生产环境验收。
- 同日重新打包的实际 ZIP 又通过包内 Box CLI 的 `backup --verify`、恢复到另一库和恢复后应用健康检查，核对 20 项迁移、55 张表及演练验证标记；这补充的是本机隔离制品证据，不解除生产窗口、RTO/RPO 或最终候选门禁。
- 仍待：在当前待发布 commit 上应用全部迁移并检查漂移；随后完成生产库迁移窗口、生产备份恢复演练、升级回滚和正式 RTO/RPO 记录。
- 记录模板：[运维演练记录模板](docs/operations/game-day-record-template.md)。
- 解除条件：维护者确认目标、备份、回滚责任人和运维窗口，并在最终待发布 commit 上重跑验证。

## B2 GitHub live 与真实 Webhook

- 只读 live 入口和证据归一化器已实现；2026-11-03 验收没有指定获准测试仓库、PR 和凭据，因此结果为 SKIPPED。
- 仍待：真实仓库/PR/reviews 分页、Webhook 投递与签名、提交级证据绑定和发布链路联调。
- 记录模板：[GitHub 仓库设置核验](docs/operations/github-settings-verification.md)。
- 解除条件：提供获准测试仓库、只读凭据和可接收 Webhook 的隔离目标。

## B3 完整浏览器产品闭环

- 基础浏览器自动化已覆盖账户/会话、创建项目、页面加载、登出再登录和 CSRF 拒绝。
- 2026-11-06 隔离真实 Chromium 复测中，上述基础账户与 CSRF 两项通过；新增业务链因测试流程与角色包输出/输入契约不匹配，在工作流校验阶段失败，尚未到达人工审批。不能将新增测试文件或静态检查通过视作完整闭环已验证。
- 2026-11-07 修正真实基线与角色包契约，并修复成功密码二验消耗失败额度的问题后，真实 Chromium 三项通过。新增链覆盖 Agent QA 交付、浏览器读取证据、密码确认票据批准及刷新后的 APPROVED/DONE、认领释放；IMPL 仍开放，RELEASE 继续等待前置。见[浏览器 QA 验收](docs/testing/browser-qa-acceptance-2026-11-07.md)。这补充 QA 人工验收证据，不解除完整 B3。
- `first-run-demo.mjs` 已改用相同流程 helper，但其独立 API 实跑被自动审批以 `blocked by policy` 拒绝，本轮没有该脚本独立通过证据。
- 仍待：需求详情、任务交付、评审决定、发布、变更传播、跨浏览器和无障碍验收。
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
