# 交付验证与评审体验实施记录

本记录承接 [实施计划](../design/verification-evidence-task-plan.md)，自 2026-11-12 开始持续追加。任务编号只用于开发分工；不构成正式需求、已发布 KNOWLEDGE、需求快照、HUMAN 批准或发布状态。

## 来源与运行环境（EV-00）

- 起始 HEAD：`55c7124c31652077c01267a76f2eb9de1a20e9c6`。起始工作树已有 133 条状态记录；保存 1115 个受版本控制及非忽略新增源码文件的路径、字节数、SHA-256。完整来源清单位于本地忽略目录 `.tmp/verification-evidence-20261112T125743Z/baseline.json`。该清单用于区分原有工作，不是最终提交证据。
- 使用既有依赖，不更改系统运行时；检查命令在子进程 PATH 首位设置 Codex bundled Node，实测 Node `24.22.1`、pnpm `10.28.2`。默认系统 Node `20.13.1` 不满足项目最低版本，未用其结果证明兼容性。一次初步命令误用了默认版本并显示 engine warning，随后在 Node 24 上重新执行并通过，正式记录以下列日志为准。
- 原始评审定向基线：`acceptanceEvidence.test.ts`、`AcceptanceEvidenceMatrix.test.tsx`、`ReviewDecision.test.tsx` 共 **78/78 通过**，退出码 0。日志 `ev00-web-baseline.log` 位于上述本地目录。
- 当前没有真实需求/PRD/快照与本文任务的正式映射，不编造 ID 或质量包。未提供隔离 GitHub Actions 仓库及最小只读凭据；真实外部闭环保持 **NOT_RUN**。已存在的 PR review/Webhook 测试不能替代 Actions run/attempt/report 验证。

## 评审首屏与决定摘要（EV-01、EV-02）

实现分别说明资料读取、验收报告、版本关系、代码评审、正式决定，并显示服务端未解决问题总数。完整质量包读取复用验收矩阵原请求；加载时不统计最终缺失，部分不可读时保留已知失败且不声称全通过。版本字段匹配不代表执行已验证。

决定前摘要绑定查看者、评审 ID、版本与对象摘要；切换评审清除草稿和旧确认，晚到全文与提交结果不回写新对象。问题数量使用服务端计数，首次读取失败为未知、刷新失败保留旧数并标明陈旧。质量报告失败、缺失和问题未解决均为可见依据，不新增隐含批准门禁；既有全文、代码评审、HUMAN、票据与服务端版本检查保留。

实际验证：

- 2026-11-12 21:15（本地时间），Node 24.22.1：`pnpm --filter @workmesh/web exec vitest run src/pages/ReviewDecision.test.tsx src/components/AcceptanceEvidenceMatrix.test.tsx src/components/ReviewDiscussions.test.tsx src/components/DecisionSummary.test.tsx src/lib/reviewEvidenceSummary.test.ts src/lib/acceptanceEvidence.test.ts`，**108/108 通过，6 文件，退出码 0**，日志 `ev01-02-web-tests-retry.log`。涵盖 FAILED/PASSED 加缺失验收、问题失败与服务端分页总数、切换确认对象、加载/部分读取、迟到 review/account/scope 响应及原有代码门禁。
- 原始整合执行有两项失败：父页面在 PRD 读取中清除了已完成的问题摘要，而 PRD scope 未变化时子组件不会重新回报；将摘要清理移到整页对象切换后复验通过。原始失败保留在 `ev01-02-web-tests.log`，不覆盖。
- `pnpm --filter @workmesh/web type-check` 退出码 0，日志 `ev01-02-web-types.log`。组件负责人执行的 8 文件 ESLint/格式检查通过；整页及最终候选检查待后续统一记录。

这些是受控组件行为证据，不证明真实部署、数据库并发、外部 GitHub 来源或 HUMAN 实际批准。浏览器、构建、完整门禁和最终来源清单在对应任务完成后追加。

## 任务进度与尚待证据

| 任务        | 当前实施状态                   | 证据或剩余范围                                                          |
| ----------- | ------------------------------ | ----------------------------------------------------------------------- |
| EV-00       | 已固定本地基线；外部条件待落实 | 源码哈希和原始 78 测试已保存；正式平台映射、GitHub 目标、只读凭据未提供 |
| EV-01       | 已实现，定向行为已验证         | 首屏摘要、读取/报告语义；浏览器和最终门禁待补                           |
| EV-02       | 已实现，定向行为已验证         | 同对象确认、问题总数/失败、切换与迟到响应；真实签字链待最终回归         |
| EV-03       | 实施中                         | 工作台逐流覆盖、时间、原因与已加载范围筛选                              |
| EV-04       | 实施中                         | 已知差异、恢复入口、历史适用范围                                        |
| EV-05–EV-06 | 契约实施中                     | 质量包 1.1、CLI/Web/示例/角色资源同步                                   |
| EV-07–EV-12 | 待前置实施；外部验收未执行     | 不能据此声称 M1–M4 或发布完成                                           |
