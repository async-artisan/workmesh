# BLOCKED

> 记录当前无法在本机完成、需要外部条件的工作项。解除后按对应验证命令补证据。

## B1 迁移 apply 与真实库验证（已解除，生产仍待）

- 目标：`0005`–`0010` 在真实 PostgreSQL 上 apply，并验证约束、漂移与回滚。
- 现状：已在隔离库 `workmesh_m5` 应用 0001–0010，`migrate status` 为 up to date，`migrate diff` 为 no difference；详见 [docs/baseline.md](docs/baseline.md)。
- 2026-11-03 补充：专用隔离库已应用全部 12 项迁移，完成 pg_dump 备份、恢复到新库与 49 张表逐表行数核对；详见 [整改进度](docs/remediation-status.md)。历史上的“本机无 pg_dump”已不适用。
- 仍未覆盖：生产库 apply 与生产备份恢复演练，需要单独运维窗口。

## B2 GitHub live 代码证据

- 目标：真实仓库分页、Webhook 验签、提交级证据绑定。
- 只读 live 入口已实现仓库/PR/reviews 分页读取及生产证据归一化，但本轮没有指定获准测试的仓库与 PR，运行结果 SKIPPED；私有仓库还需要只读凭据。
- 解除条件：提供测试仓库与只读 token，且允许 webhook 回调到本机。

## B3 浏览器 E2E（基础环境已解除，完整产品闭环仍待）

- 目标：工作台、需求详情、评审决定的真实浏览器闭环。
- 已完成：隔离 API、数据库与 Chromium，2 项浏览器测试验证账户/会话、创建项目、页面加载及 CSRF 拒绝。入口 `pnpm test:browser`，不复用用户浏览器。
- 仍待：需求详情、评审决定到发布的完整产品流程、跨浏览器与无障碍验收；不能将基础测试通过写成全部 E2E 完成。

## B4 进程内 HTTP 契约套件无法运行（已解除）

- 目标：`apps/api/test/v1-http-contract.spec.ts`。
- 历史原因：ESM 插件被 CJS require。
- 已处置：API 配置显式使用 `.mts`，动态加载 SWC 并发射装饰器元数据；单元、集成和覆盖率入口均可运行。当前合并套件 604 项通过，其中 57 项使用真实 PostgreSQL；生产行覆盖率 80.16%，保留原有 80% 门禁并实际通过。验证细节见 [工程整改验证](docs/testing/remediation-verification-2026-11-03.md)。

## B5 WP5 破坏性收紧（已解除）

- 目标：文档 kind 与评审类型从枚举改为字符串注册表，删除旧枚举值。
- 处置：迁移 `0011_kinds_as_strings` 在隔离库 `workmesh_m5` 应用成功；`DocumentKind` / `ReviewKind` 枚举已删除，列改为 `VARCHAR(48)`；`migrate diff` 无差异；API 全量 422 个单测通过。
- 仍未覆盖：生产库 apply 仍按 B1 的运维流程执行。

## B6 分支分叉（非阻塞，记录）

- 现象：`feat/yff-demo-data` 与 `main` 分叉；本轮 WP2/WP6/WP9 提交在功能分支上。
- 影响：合并到 `main` 前，主干看不到这些提交。
- 处置：由仓库维护者在功能分支完成后合并；本会话不擅自切分支或 rebase。

## B7 Prisma client 生成被运行中的服务锁住（已解除）

- 目标：为后续模型（`Unit` / `UnitDependency` / `ChangeRequest` / `ApprovalSlotDelegation` 等）重新生成 Prisma client。
- 现象：`prisma generate` 报 `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`。
- 原因：本机有 `pnpm dev`（Nest watch）、`dist/main.js`、`prisma studio` 等进程持有查询引擎 DLL。
- 处置：经授权停掉 dev server / nest watch / vite / prisma studio 后，`prisma generate` 退出 0。
- 现状：已解除；B7 不再阻塞开发。需要重启服务时另行启动。
