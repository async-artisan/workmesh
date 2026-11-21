# 工作台原因与查询覆盖：有限切片验证

2026-11-12，工作树验证，尚未固定最终提交。对应 `docs/design/verification-evidence-task-plan.md` 的 EV-03 / ev-workbench、ev-authority，只覆盖本节列明的增量；不宣称整个 EV-03 或 M1 已完成。

工作台保留原有授权领域分页和正式动作资格。新增的只读 coverage 区分单项目评审、待确认变更、前置就绪任务，以及所选项目合计的逾期审批上限；数量与原因筛选只描述已加载行。记录分页状态、后续游标、采集时间与错误；摘要补齐失败只影响相应流。逾期审批读取 51 行判断上限，最多展示 50 行；没有工作台继续加载入口，可打开既有相关列表。

评审 attention 只投影既有工件 checks 的明确 `passed: false`，标记为提交报告，不等于独立执行。原因绑定当前 review ID / version，提供已知责任角色与评审入口。质量包正文、代码评审、讨论均为 NOT_QUERIED，基线适用性为 UNKNOWN；未提供或版本不匹配的原因摘要不能表示证据通过。此投影不启动 Agent、不运行检查、不决定批准。

## 已执行的受控检查

运行环境为 Windows / Node.js 24.22.1 / pnpm 10.28.2；先构建 shared，再使用本机已有依赖。以下受控测试不连接数据库，不替代真实浏览器、权限集成或最终提交的远端 CI。

- `pnpm --filter @workmesh/api exec vitest run --config vitest.unit.config.mts src/workbench/v1-workbench.service.spec.ts src/workbench/v1-workbench-attention.spec.ts src/workbench/v1-dependency-impact.spec.ts`：初轮 3 文件 / 23 项通过；新增服务事实来源与补齐失败场景后，复验 3 文件 / 25 项通过。
- `pnpm --filter @workmesh/web exec vitest run src/pages/Workbench.test.tsx src/lib/workbenchAttention.test.ts`：2 文件 / 32 项通过。覆盖部分/失败/旧响应、同版本原因、已加载行筛选、保留旧采集时间、筛选清空选择、既有正式动作资格及不额外下载质量正文。
- `pnpm --filter @workmesh/api exec tsc --noEmit`：通过，复用当前已生成 Prisma Client。
- `pnpm --filter @workmesh/web type-check`：并行质量契约的 fixture 修正后复验通过。
- `pnpm test:contracts`：初轮 19 项通过，含原因枚举导出；质量契约并行修改后最终数量以统一复验为准。

原始失败保留：API package test/type-check 的 Prisma generate 前置步骤遇 Windows `query_engine-windows.dll.node` 重命名 EPERM，未停止占用进程；改用上述直接入口验证。一次 `pnpm ... test -- <files>` 将 `--` 传入 Vitest，实际运行全 Web：860 项通过、1 项失败，失败为 `RequirementDetail.test.tsx` 的 `PRD—` 定位，未修改该用例。一次 Web type-check 在并行质量契约变化期间报告 `acceptanceEvidence.test.ts:160` 的 V10/V11 union 缺 caseRefs；由该文件负责人处理，不能把这轮写成通过。shared 初轮 DTS 在同一并行修改期间报告 `quality.ts` 的 sameBasis 未定义，修正后重建通过。

## 隔离数据库与浏览器入口：未执行

本切片没有连接数据库或启动浏览器服务。执行前按 [完整本地验证](local-verification.md) 显式选择 loopback、`workmesh_test_` 数据库、`workmesh_v1` schema 和允许用户；不得从工作库 `.env` 推导测试目标。

先以既有 `apps/api/test/v1-workbench-impact.database.spec.ts` 为受控入口复验依赖图、跨项目隔离和只读行为：

```text
pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/v1-workbench-impact.database.spec.ts
```

该既有数据库套件不覆盖此次 coverage / attention。后续需增加真实授权领域的工作台服务场景：至少 51 个可见 OPEN 评审和第 52 个隐藏知识评审、101 个待确认变更、51 个就绪任务、跨项目 51 个逾期槽；核对游标与全局上限、隐藏项不返回、逐流错误与补齐失败、正式决定资格不被原因标签改变，以及所有聚合前后业务事实不变。没有这些执行证据时，相应集成验收保持 NOT_RUN。

真实隔离浏览器按现有 `pnpm test:browser` 入口验证原因选择、清除筛选、键盘焦点、相关列表入口、刷新失败后旧快照和正式批准链。最终候选仍需完整 `pnpm verify` 与同提交远端 CI。

## EV-03 尚缺的范围

此切片不聚合质量包逐验收结论、真实 CI 运行事实、讨论跨轮未解决数量、快照/PRD/代码基线适用性、定义独立性；这些均保持未查询或未知。不提供工作台后续页加载，不把前 50/100 行称为全量异常。原因的责任角色来自现有已授权角色元数据；未提供时保留待确认，不推测具体个人。
