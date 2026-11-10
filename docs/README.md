# 文档导航

按用途阅读现行文档；有日期的验收记录保留当时的环境和证据，历史归档不作为当前操作清单。

## 使用与部署

- [项目介绍与快速开始](../README.md)：产品边界、能力和最短运行路径。
- [开始使用](getting-started.md)：面向第一次使用者的最短启动、CLI 闭环和验证路径。
- [本地运行](local-dev.md)：Windows 开发环境与本机演示说明。
- [一个盒子](box.md)：运行检查、备份、恢复及安装边界。
- [部署说明](deployment.md)：服务端配置、数据库迁移与启动。
- [运行保障](operations.md)：健康探针、优雅停机、日志、指标、备份恢复和生产观测边界。
- [发布与升级验收](releasing.md)：发布前检查与升级边界。
- [支持矩阵](support-matrix.md)：运行时、平台、制品和运营场景的支持口径。
- [API 清单](api.md)：现行接口、权限和操作约定。
- [角色包构建与安装](../packages/role-packages/README.md)：维护、构建和安装六个内置角色包。

## 当前状态与待办

- [交付与验证状态](phase-status.md)：当前实现和已记录的验证边界。
- [开发计划](dev-plan.md)：尚未完成的功能与后续工作。
- [规格与交付质量方法](design/spec-driven-quality.md)：Spec Kit 优点的采用判断、角色入口、本地质量包及边界。
- [规格与交付质量采用验证](testing/spec-driven-quality-validation-2026-11-09.md)：角色包、模板契约、本地质量命令的测试、构建结果及未验证范围。
- [2026-11-10 规格方法增补验证](testing/spec-driven-quality-followup-validation-2026-11-10.md)：MVP 切片方法、角色包版本与评审页严格 JSON 解析的回归结果。
- [使用者路径优化](design/user-journey-optimization.md)：按职责、接入、交接、评审和运维排序的实施清单及开源借鉴。
- [2026-11-09 使用者路径验证](testing/user-journey-validation-2026-11-09.md)：逐项行为证据、当前迁移集、API/Web/CLI/浏览器结果及尚未实测范围。
- [外部阻塞项](../BLOCKED.md)：仍需外部环境、目标或证据的工作。

## 运营与验收模板

- [GitHub 仓库设置核验](operations/github-settings-verification.md)：由管理员记录实际设置和证据。
- [维护职责与交接矩阵](operations/maintenance-roles.md)：指定维护、发布、恢复和安全响应责任人。
- [运维演练记录模板](operations/game-day-record-template.md)：记录迁移、备份恢复、回滚和故障演练。
- [外部团队验收记录](operations/external-team-acceptance-template.md)：记录真实外部团队的授权、过程和签字。
- [安全事件响应记录](security/incident-response-template.md)：在受控系统记录分级、修复、披露和复盘。
- [2026-11-07 依赖审计记录](security/dependency-audit-2026-11-07.md)：工作区审计、实际制品版本及尚未关闭的处置要求。
- [Prisma 5 → 6 升级计划](operations/prisma-6-upgrade-plan.md)：精确候选、审计链兼容、迁移与 Box 回退验收；尚未执行升级。

测试结果以具体报告记录的日期、环境与版本为准；文档存在不等于该能力已实现或已通过验收。

## 贡献与治理

- [社区入口与路线图](community/README.md)：选择提问/报告渠道，并查看路线图、issue 分流和兼容性口径。
- [路线图](community/roadmap.md)：按阶段列出项目当前方向，不承诺发布日期。
- [Issue 分流](community/triage.md)：报告缺陷、功能提案和维护者排序依据。
- [版本与兼容性](community/compatibility.md)：运行时基线、制品边界、迁移和弃用口径。
- [贡献指南](../CONTRIBUTING.md)：开发环境、验证命令、提交和 PR 约定。
- [完整本地验证](testing/local-verification.md)：共用 `pnpm verify`、隔离测试库选择、迁移授权和验收范围。
- [治理说明](../GOVERNANCE.md)：日常决策、发布决定、争议处理和维护者交接。
- [维护者](../MAINTAINERS.md)：当前维护入口、职责和联系路径。
- [安全政策](../SECURITY.md)：漏洞报告、披露和部署者责任。
- [社区行为准则](../CODE_OF_CONDUCT.md)：参与 issue、PR 和讨论时适用的规则。

## 架构与设计

- [架构概览](architecture.md)、[代码地图](code-wiki/ARCHITECTURE.md)、[架构图册](code-wiki/ARCHITECTURE_DIAGRAMS.md)。
- [技术契约分册](superpowers/plans/workmesh-technical-v1/README.md)：身份权限、领域事务、客户端和代码证据契约。
- [协作规范](../spec/SPEC.md)：角色交付与正式人工决定的共同约定。
- [角色包设计](role-packages.md)、[知识与变更架构](knowledge-architecture.md)。
- [审批工位](design/approval-workstation.md)、[当前 UI 与样式层次](design/ui.md)。
- [项目接入、本地工作区与任务上下文设计](design/project-workspace-onboarding.md)：通用开源项目的共享项目身份、多仓库接入、本机路径映射、Agent 上下文、知识来源与实施验收方案（设计稿，尚未实施）。
- [托管 Agent 模式可行性分析](design/api-driven-agent-feasibility.md)：新分支「不依赖本地 Agent」的四种切法与 go/no-go（分析稿，非承诺）。
- [流程度量口径](metrics.md)。

## 验收记录

- [2026-11-07 完整本地验证入口验收](testing/local-verification-validation-2026-11-07.md)：共用 `pnpm verify` 的真实运行、失败修复、并发认领及最终源码边界。
- [2026-11-07 许可证分发验收](testing/license-distribution-validation-2026-11-07.md)：实际 Box/CLI ZIP 的文本、索引及哈希核验，保留运行时和原生组件缺口。
- [2026-11-07 质量检查与新包收尾](testing/quality-closeout-2026-11-07.md)：Node.js 20.19.0 构建、测试、覆盖率、真实集成、浏览器及新包生命周期的结果、失败修复和来源边界。
- [2026-11-07 基线变更验收](testing/baseline-change-validation-2026-11-07.md)：真实数据库和浏览器中的基线发布、任务失效、通知确认及重新验收，并保留未覆盖范围。
- [2026-11-07 API 分页审查](testing/pagination-review-2026-11-07.md)：公开列表、历史聚合、完整业务集合与仍需设计的分页边界；静态审查不代表容量验收。
- [质量基线记录模板](testing/quality-baseline-template.md)：记录无障碍、浏览器兼容性、性能与容量验收；模板本身不是验收结果。
- [2026-11-03 工程整改验证](testing/remediation-verification-2026-11-03.md)。
- [2026-11-03 本机部署与团队使用验收](testing/team-acceptance-2026-11-03.md)。
- [2026-11-07 制品 SBOM 验证](testing/artifact-sbom-validation-2026-11-07.md)：实际 ZIP 输入绑定、部分组件清单及完整覆盖缺口。
- [2026-11-07 bundle 模块证据](testing/bundle-evidence-validation-2026-11-07.md)：实际模块图、固定版本/PURL、输出字节绑定与预打包候选边界。
- [2026-11-07 UNKNOWN 分类](testing/artifact-unknown-classification-2026-11-07.md)：npm 子路径父包证据和仍未知的二进制版本。
- [2026-11-07 Windows Box 生命周期验证](testing/box-lifecycle-validation-2026-11-07.md)：真实 ZIP 安装、冷启动、备份与恢复，以及检查器回归和证据边界。
- [2026-11-07 浏览器 QA 人工验收](testing/browser-qa-acceptance-2026-11-07.md)：真实 Agent 交付、浏览器密码签字与持久化，以及仍未完成的实现和发布范围。
- [2026-11-07 登录限流验证](testing/login-rate-limit-validation-2026-11-07.md)：邮箱失败预算、真实 PostgreSQL 并发和会话持久化。
- [2026-11-07 共享 IP 限流验证](testing/shared-ip-rate-limit-validation-2026-11-07.md)：注册/登录共享预算、遗留计数、准确冷却和部署切换边界。
- [2026-11-07 Box 运行依赖缩减验证](testing/box-production-dependencies-2026-11-07.md)：production 部署、新 ZIP 的组件扫描和安装恢复，保留最终发布与完整 SBOM 门禁。

## 参考与历史

- [产品定位](positioning.md)、[外部参照台账](references.md)。
- [BPMN 概念映射与差距](workflow-bpmn-2.0-mapping.md)：不代表支持 BPMN XML 或标准互操作。
- [历史项目接入讨论](yff-workmesh-discussion-context-2026-11-03.md)：包含尚未实现的提案，不是接入操作手册。
- [历史实施与迁移记录](archive/README.md)、[历史 Web 改造方案](design/archive/README.md)。
