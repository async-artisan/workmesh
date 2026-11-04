# WorkMesh 技术规格 v1 导航

本目录保留身份、领域、客户端、代码证据与 HTTP 的技术契约。`v1` 是规格和协议版本，不表示需要同时维护新旧业务实现。

这些分册含已实现的契约和未完成的目标条款。阅读时对照源码与 [现行 API 清单](../../../api.md)；实现及验证边界统一见 [交付状态](../../../phase-status.md)，未完成工作见 [开发计划](../../../dev-plan.md)。不能仅凭某条规格存在宣称功能可用，也不要按历史任务表重新执行已经完成的迁移或开发。

| 顺序 | 分册                                                    | 范围                                                                  |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| 1    | [身份、权限与人工确认](01-identity-permissions.md)      | Principal、scope、WebSession、Agent、角色/知识库 ACL 与确认票据。     |
| 2    | [领域模型、状态与事务](02-domain-state-transactions.md) | 不可变修订、共享基线、任务、claim、快照、工件、评审、事件与事务。     |
| 3    | [本地角色工作流与客户端](03-local-workflows-clients.md) | JSON Schema、角色包、宿主入口、工作区配置、CLI/Web 与本地产品工作流。 |
| 4    | [代码托管适配器](04-code-hosting-adapters.md)           | 仓库身份、GitHub 证据、Webhook 与后续 Codeup 准入。                   |
| 5    | [API 契约](05-api-contract.md)                          | HTTP 输入输出、错误、业务幂等及资源传输语义。                         |

01–04 的细分契约与 05 的传输约定应一致。发现规格与代码的真实冲突时应明确记录差距，不能以文档较旧为由自动放宽授权、票据或验收要求。`docs/api.md` 负责现行接口使用清单，分册负责协议与领域语义。

## 历史背景与验收要求

产品与架构选择来自 [产品与架构总纲](../2026-11-01-workmesh-open-source-collaboration-plan.md)。早期的 [主实施方案](../../../archive/2026-11-01/workmesh-technical-implementation.md)、[单一实现收敛计划](../../../archive/2026-11-01/workmesh-single-implementation-plan.md) 和 [T00–T09 任务与验收矩阵](../../../archive/2026-11-01/development-tasks-and-verification.md) 已归档，仍可用于追溯需求与核对独有验收条款。

早期供手工复制、未被构建或测试读取的 JSON 文档样例已清除。实际校验和回归以 `packages/shared/src/*test.ts`、`apps/api/src/workflows/*spec.ts` 等测试及其明确构造的 fixture 为准。

## 历史文档检查

2026-11-01 的检查仅确认当时分册、链接、JSON Schema 与样例自洽，没有运行应用、HTTP、数据库、浏览器或外部仓库验证。后续工程与团队验收见 [文档导航](../../../README.md) 中的验收记录，不能把早期文档检查当作当前实现的验证结论。
