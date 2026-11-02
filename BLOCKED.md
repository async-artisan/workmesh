# BLOCKED

> 记录当前无法在本机完成、需要外部条件的工作项。解除后按对应验证命令补证据。

## B1 迁移 apply 与真实库验证

- 目标：`0005_knowledge_governance`、`0006_acceptance_keys`（后续 `0007+` 同理）在真实 PostgreSQL 上 apply，并验证约束、并发、回滚。
- 阻塞原因：没有可用的隔离数据库连接与备份授权。
- 解除条件：提供隔离库 `WORKMESH_V1_DATABASE_URL`、备份与恢复方式，并确认可回滚。
- 恢复命令：
  ```bash
  corepack pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma
  ```
- 影响：M1–M4 的数据库证据标记为 `unverified`，源码与单测不受影响。

## B2 GitHub live 代码证据

- 目标：真实仓库分页、Webhook 验签、提交级证据绑定。
- 阻塞原因：无只读测试仓库与凭据。
- 解除条件：提供测试仓库与只读 token，且允许 webhook 回调到本机。

## B3 浏览器 E2E

- 目标：工作台、需求详情、评审决定的真实浏览器闭环。
- 阻塞原因：需要隔离 API + 数据库 + 浏览器环境。
- 解除条件：B1 解除后启动隔离服务，再跑 Playwright。

## B4 进程内 HTTP 契约套件无法运行

- 目标：`apps/api/test/v1-http-contract.spec.ts`。
- 现象：`vitest.integration.config.ts` 启动时报 `ERR_REQUIRE_ESM`（`unplugin-swc` / `unplugin` 的 CJS require）。
- 阻塞原因：工具链版本组合问题，与本次业务改动无关。
- 解除条件：升级或替换 swc 插件配置，或改用独立的 Node 测试运行器。
- 临时替代：服务层 spec 已覆盖主要分支；HTTP 层仍待补。

## B5 WP5 破坏性收紧

- 目标：文档 kind 与评审类型从枚举改为字符串注册表，删除旧枚举值。
- 阻塞原因：属于破坏性迁移，必须在 B1 解除、完成双写与抽样校验后执行。
- 解除条件：M1–M4 全部 apply 并通过抽样校验。
- 当前状态：设计已定（dev-plan WP5），执行暂缓。

## B6 分支分叉（非阻塞，记录）

- 现象：`feat/yff-demo-data` 与 `main` 分叉；本轮 WP2/WP6/WP9 提交在功能分支上。
- 影响：合并到 `main` 前，主干看不到这些提交。
- 处置：由仓库维护者在功能分支完成后合并；本会话不擅自切分支或 rebase。

## B7 Prisma client 生成被运行中的服务锁住

- 目标：为 M4（`Unit` / `UnitDependency` / `Task.unitId`）重新生成 Prisma client。
- 现象：`prisma generate` 报 `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`。
- 原因：本机有 `pnpm dev`（Nest watch）、`dist/main.js`、`prisma studio` 等进程持有查询引擎 DLL。
- 解除条件：停止上述进程后重试，或换一台没有服务占用的环境。
- 影响：WP4 的 schema 与迁移已写好，但 client 未更新，服务代码与测试无法通过类型检查；WP3/WP8 同样依赖 schema 变更，一并暂缓。
