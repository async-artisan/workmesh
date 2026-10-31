# ReqFlow

ReqFlow 是面向异构 AI 协作团队的需求与追溯中枢：每个角色在自己电脑上用自己的 agent 干活，平台只负责沉淀事实——把需求、PRD、代码与测试串成可追溯的链条，并向各角色的 agent 供给上下文。本仓库按 Phase 0–6 的规格组织为 pnpm + Turbo monorepo。

## 快速开始

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm --filter @reqflow/api db:migrate
pnpm db:generate
pnpm dev
```

API 默认运行在 `http://localhost:3000`，Web 默认运行在 `http://localhost:5173`。

## 工作区

- `apps/api`：NestJS API、认证、需求、知识库、PRD、追溯和 Webhook。
- `apps/web`：React + Vite 前端。
- `apps/cli`：`reqflow` CLI，支持需求同步与本地 PRD 提交。
- `packages/shared`：跨端类型契约。
- `packages/ui`：最小共享组件。

## 验证

```bash
pnpm type-check
pnpm build
pnpm test
```

数据库迁移和真实 AI 调用需要用户提供本地配置；质量门禁只生成 Prisma Client 和验证 schema，不会写入共享租户数据库。

首次本地管理员账号可在已确认的隔离数据库上运行 `SEED_ADMIN_PASSWORD='...' pnpm db:seed`，可选设置 `SEED_ADMIN_EMAIL`。CLI 首次登录使用 `pnpm --filter @reqflow/cli exec reqflow login --email <email>`，随后按终端提示输入密码。
