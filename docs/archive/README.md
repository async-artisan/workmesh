# 历史实施与迁移记录

这里保留原始实施步骤、设计取舍、验收要求及当时的环境记录，供追溯使用。文中的“待执行”“未验证”、旧命令、路径和迁移基线描述只对应原始写作时点，不作为当前操作依据。

当前信息见 [交付与验证状态](../phase-status.md)、[开发计划](../dev-plan.md)、[部署说明](../deployment.md) 和 [发布与升级验收](../releasing.md)。身份、领域、客户端与 API 的技术契约仍在 [技术规格分册](../superpowers/plans/workmesh-technical-v1/README.md)。

## 2026-11-01 实施方案

- [单一实现收敛计划](2026-11-01/workmesh-single-implementation-plan.md)。
- [技术实施方案初稿](2026-11-01/workmesh-technical-implementation.md)。
- [T00–T09 开发任务与验收矩阵](2026-11-01/development-tasks-and-verification.md)：保留历史覆盖编号和独有验收要求，不要求按旧顺序重新开发。Codeup 等后续能力仍需独立实现与验证。

## 2026-11-03 基线与迁移

- [WP0 基线记录](2026-11-03/baseline.md)。
- [S00–S08 阶段审计](2026-11-03/phase-audit.md)。
- [M0–M5 模型迁移路线](2026-11-03/migration-plan.md)：已更正历史表格中的迁移名；现行迁移以仓库迁移目录为准，生产升级按部署与发布说明执行。
