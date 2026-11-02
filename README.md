# WorkMesh

WorkMesh 是面向本地 AI Agent 的证据驱动协作中枢：每个角色在自己电脑上用本机 agent 干活，平台负责需求与流程、角色包、上下文快照、工件与代码证据、评审与变更传播。普通人只在关键节点用浏览器会话作出正式批准，Agent 只持有受限凭据。

## 技术栈

pnpm 10.28.2 + Turborepo 的 monorepo：

- `apps/api`：NestJS + Prisma，正式协议 `/api/v1`，PostgreSQL `workmesh_v1` schema。
- `apps/web`：React + Vite，浏览器会话（Cookie + CSRF）。
- `apps/cli`：`workmesh` CLI，设备授权登录与 Agent 工作流。
- `packages/shared`：跨端契约（错误码、严格 JSON、摘要、角色包与流程校验）。
- `packages/ui`：最小共享组件。

## 快速开始

使用 `corepack pnpm` 以保证 pnpm 版本与 `packageManager` 一致。

```bash
corepack pnpm install
corepack pnpm --filter @workmesh/shared build
corepack pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma
```

配置 `WORKMESH_V1_DATABASE_URL` 指向显式选择的 PostgreSQL，确认目标与回滚方式后再应用唯一初始迁移：

```bash
corepack pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma
```

启动开发环境：

```bash
corepack pnpm dev
```

API 默认 `http://localhost:3000`（Swagger `/api/docs`），Web 默认 `http://127.0.0.1:5173`。完整配置项与部署步骤见 [docs/deployment.md](docs/deployment.md)，接口清单见 [docs/api.md](docs/api.md)。

## 认证模型

- 人：`POST /api/v1/auth/register` 或 `/auth/login` 建立不透明 `WebSession` Cookie，写操作另需双值 CSRF 头；正式部署使用 `__Host-` 前缀且强制 HTTPS。
- Agent：CLI 通过设备授权（PKCE S256）领取 `Bearer wm_a1.<credentialId>.<secret>`，凭据只在创建时返回一次，可按 ID 吊销。
- 批准、撤销、发布、撤回等高风险动作只接受 HUMAN Web 会话，并要求与动作、目标、版本、payload 摘要绑定的一次性确认票据。

不存在密码登录的 Agent 路径、refresh token、旧接口别名或兼容层。

## 验证

```bash
corepack pnpm --filter @workmesh/api exec tsc --noEmit --incremental false
corepack pnpm --filter @workmesh/shared test
corepack pnpm --filter @workmesh/cli test
corepack pnpm --filter @workmesh/web test
corepack pnpm test:contracts
corepack pnpm build
git diff --check
```

数据库相关套件需要隔离目标：`bash scripts/test-integration.sh`（默认只读，`--apply-migrations` 需单独确认）。构建与单元测试不会创建或修改共享数据库。

## CLI

构建后从仓库根目录运行：

```bash
corepack pnpm --filter @workmesh/cli build
corepack pnpm workmesh --help
```

`workmesh login` 使用浏览器设备授权，登录状态保存在 `~/.workmesh`（可用 `--config-home` 覆盖）。业务项目内先运行 `workmesh init` 写入 `.workmesh/` 工作区配置与 Agent 规范入口，之后按角色执行取活、上下文快照、工件交付、评审与变更确认等命令；`--json` 输出 `{data, meta:{requestId}}` 信封，失败输出统一错误 envelope。跨项目使用时把已构建的 `apps/cli/dist/index.js` 放入 PATH（例如 `~/.local/bin/workmesh`），不要在业务项目里用 `pnpm --filter` 执行，它会把工作目录切到 CLI 包目录。
