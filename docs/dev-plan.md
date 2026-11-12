# WorkMesh 开发计划

> 更新时间：2026-11-04。本文只保留仍需开发或补证据的工作；当前状态汇总见 [phase-status.md](phase-status.md)，外部阻塞见 [BLOCKED.md](../BLOCKED.md)。本轮只整理文档，没有重新运行服务、数据库或浏览器测试。

## 已完成基线

WP0–WP10 的主要代码工作已在当前仓库实现并有源码、测试或本地验收记录：

- WP0：迁移/漂移闸门、备份恢复演练和验证入口。
- WP1–WP5：知识治理、验收映射、变更管理、工作单元/依赖和 kind 字符串化。
- WP6：角色包 schema 1.1、六个内置角色包、构建和登记。
- WP7–WP8：审批批处理、槽位委托和超时升级。
- WP9：`software-delivery`、`software-delivery-no-ui` 模板和角色排除变体。
- WP10：API 清单、流程度量、box 和验收记录收尾。

这些项目的运行时边界和验证等级只在 [phase-status.md](phase-status.md) 与两份 testing 记录中维护，不在本计划重复一份状态表。

## 进行中与待实现

### WP11 Product Agent 协议收尾

状态：第一阶段已实现，候选评审接入已完成；仍需补齐协议边界和验证。最新状态见 [phase-status.md](phase-status.md)。

- 本地 Product Agent 支持 `product start/resume/update/answer/confirm/draft` 命令、本地状态和 PRD 草稿；理解稿字段、每轮单题、原话与落点记录、未解决项门禁等约定见 [API 文档中的本地协议](api.md#product-agent-本地协议)。
- `candidate --kind PRD` 已提交到既有修订/评审路径，并返回 `reviewRequestId`；正式发布仍由 Web 中的 HUMAN 决定。
- 仍需核对未知项、问题队列、证据引用和恢复状态在不同失败/重试场景下的持久化行为。

### WP12 澄清服务 API 与任务阻塞/恢复

状态：待实现。最新状态见 [phase-status.md](phase-status.md)。

- 新增 Clarification / ClarificationResponse 资源，支持 Agent 提案、HUMAN 确认或延期、依赖和引用校验。
- 创建澄清与任务 `BLOCKED`、确认答复与精确恢复在同一事务完成，沿用权限、幂等键和版本 CAS。
- 验收：历史不覆盖；跨项目、无权限、过期版本和无效引用均拒绝；恢复只影响对应任务代次。

### WP13 按风险组织 PRD、原型 verify、产品/QA 验收与归档

状态：待实现。最新状态见 [phase-status.md](phase-status.md)。

- 将当前草稿按实际风险组织为评审版，补齐场景、边界、异常、非功能要求和成功标准；允许简单需求合并章节，不强制固定 15 章。补齐修改任务、PRD/原型 hash 绑定和返修失效。
- 原型作为绑定 PRD 的工件；build/verify 只提供机器证据，产品与 QA 仍需 HUMAN 验收。
- 验收：PRD、原型和归档回写形成可恢复闭环，旧版本批准不会静默复用。

## 近期补证据工作

质量包还有一项待开发增量：执行证据明确关联具体用例 ID 与用例修订。目前 QA 执行模板已有 `case / casesRevision` 指导，本地质量包 1.0 只绑定验收、PRD、快照和 commit，无法核对执行用例版本。后续以新质量包版本同步 shared、CLI、评审映射和模板；拒绝未知用例、用例/验收关系错误与过期用例证据，保留旧版报告的识别和证据来源，不将 LOCAL_REPORTED 升级为正式批准。当前状态为待实现。

规格与交付质量方法、角色包和本地质量检查已纳入本轮改进，采用边界见 [设计与入口](design/spec-driven-quality.md)。评审页已增加显式验收 key 的证据映射、来源与版本核对，验证与限制见[使用者路径记录](testing/user-journey-validation-2026-11-09.md)。服务端澄清资源仍按 WP12 推进，自动引用报告门禁尚未实现；映射视图不产生自动批准。

这些工作不一定需要新增产品代码，但在发布前必须完成：

1. GitHub live 和真实 Webhook 联调，见 [BLOCKED.md](../BLOCKED.md) B2。
2. 完整浏览器产品闭环、跨浏览器和无障碍验收，见 B3。
3. Linux/macOS 安装与服务验收、容量和长时间稳定性，见 B4。
4. 生产迁移、恢复、升级回滚和外部真实团队使用，见 B1/B5。

## 计划原则

- 先更新协议和状态，再修改实现；每项工作同时补测试和文档。
- 不能验证的环境条件写成未验证，不写成通过。
- 数据库、票据、权限、版本、幂等和审计约束不能绕过。
- 新工作优先复用现有评审槽、确认票据和审计链，避免建立第二套审批路径。
