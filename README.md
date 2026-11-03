# WorkMesh

WorkMesh 让 AI 干的活有人签字、有据可查。团队每个角色在自己电脑上用本机 Agent 生产，平台负责需求与流程、角色包、上下文快照、工件与代码证据、评审与变更传播。人只在关键节点用浏览器作正式批准，Agent 只持有受限、可撤销的凭据。

它不执行 Agent、不做 AI 对话、不替代 GitHub：它只裁决「这份交付是否成立」。

事实 · 证据 · 签字

## 技术栈

pnpm 10.28.2 + Turborepo 的 monorepo：

- `apps/api`：NestJS + Prisma，正式协议 `/api/v1`，PostgreSQL `workmesh_v1` schema。
- `apps/web`：React + Vite，浏览器会话（Cookie + CSRF）。
- `apps/cli`：`workmesh` CLI，设备授权登录与 Agent 工作流。
- `packages/shared`：跨端契约（错误码、严格 JSON、摘要、角色包与流程校验）。
- `packages/ui`：最小共享组件。
- `packages/role-packages`：六个内置角色包（product / ui / frontend / backend / qa / ops），manifest 1.1。

## 能力概览

- **需求与流程**：需求编号 `KEY-001`、任务编号 `KEY-001/stepKey`；流程定义校验与发布、内置模板 `standard` / `software-delivery`、任务实例的验收 key 覆盖校验。
- **角色与工件**：内置角色包安装、上下文快照、HOSTED / GIT_REF 工件、代码评审证据。
- **评审与变更**：工作台待办与证据卡、逐条/批量决定、变更请求分级与传播、发布候选冻结。
- **知识与度量**：三类知识库（BUSINESS / SYSTEM / PRACTICE）字段、流程度量接口 `GET /projects/:id/metrics/flow`。
- **项目治理**：代码仓库登记、自定义角色、成员与角色指派。
- **文档**：[本地运行](docs/local-dev.md) · [开发计划](docs/dev-plan.md) · [API 清单](docs/api.md) · [流程度量](docs/metrics.md) · [审批工位](docs/design/approval-workstation.md) · [迁移路线](docs/migration-plan.md) · [阻塞项](BLOCKED.md)。

## 快速开始

本机开发（Windows，一条命令起 PostgreSQL + API + Web）的完整说明见 [docs/local-dev.md](docs/local-dev.md)：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-local.ps1
```

下面是手工步骤。`pnpm` 版本已由 `packageManager` 固定，可直接用 `pnpm`；若本机 `corepack` 因签名校验失败（`Cannot find matching keyid`），不要绕它，改用已安装的 pnpm 10.28.2。

```bash
pnpm install
pnpm --filter @workmesh/shared build
pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma
```

配置 `WORKMESH_V1_DATABASE_URL` 指向显式选择的 PostgreSQL（本地开发的其余配置项见 `apps/api/.env.example`，需要 `WORKMESH_COOKIE_MODE=LOCAL_INSECURE` 才能用 loopback HTTP）。确认目标与回滚方式后按顺序应用迁移（当前 0001–0011）：

```bash
pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma
```

启动开发环境。API 与 Web 分开起，不要用根目录 `pnpm dev`（`turbo run dev` 会连 CLI 的 watch 一起拉起）：

```bash
pnpm --filter @workmesh/api dev
pnpm --filter @workmesh/web dev
```

API 默认 `http://localhost:3000`（Swagger `/api/docs`），Web 默认 `http://127.0.0.1:5173`，用 `127.0.0.1` 打开（Origin 精确匹配）。完整配置项与部署步骤见 [docs/deployment.md](docs/deployment.md)，接口清单见 [docs/api.md](docs/api.md)。

## 认证模型

- 人：`POST /api/v1/auth/register` 或 `/auth/login` 建立不透明 `WebSession` Cookie，写操作另需双值 CSRF 头；正式部署使用 `__Host-` 前缀且强制 HTTPS。
- Agent：CLI 通过设备授权（PKCE S256）领取 `Bearer wm_a1.<credentialId>.<secret>`，凭据只在创建时返回一次，可按 ID 吊销。
- 批准、撤销、发布、撤回等高风险动作只接受 HUMAN Web 会话，并要求与动作、目标、版本、payload 摘要绑定的一次性确认票据。

不存在密码登录的 Agent 路径、refresh token、旧接口别名或兼容层。

## CLI

构建后从仓库根目录运行：

```bash
corepack pnpm --filter @workmesh/cli build
corepack pnpm workmesh --help
```

`workmesh auth login` 使用浏览器设备授权，凭据保存在 `~/.workmesh`（可用 `--config-home` 覆盖）。业务项目首次使用先安装角色包并绑定项目：`--api` 指向平台，`--host` 只接受 `codex` 或 `claude-code`。仓库自带六个内置角色包，位于 `packages/role-packages/roles/<role>`。

首次初始化用一条命令即可（登录 + 装角色包 + 自检；登录仍在浏览器批准）：

```bash
workmesh setup --role backend --host codex --api https://<host>/api/v1 --project <项目UUID>
```

等价的手工步骤：

```bash
workmesh roles install --package packages/role-packages/roles/product --project <项目UUID> --api https://<host>/api/v1 --host codex
```

之后按角色执行标准作业序列。任务编号来自 `GET /api/v1/projects/:projectId/tasks/ready` 或 Web 工作台；上下文快照创建后，任务版本以服务端返回为准。

```bash
workmesh claim --task <taskId>
workmesh context --task <taskId> --claim <claimId> --expected-version <taskVersion> --materialize
workmesh deliver --task <taskId> --claim <claimId> --snapshot <snapshotId> --expected-version <taskVersion> --manifest deliver.json
workmesh review --artifact-set <artifactSetId> --expected-version <artifactSetVersion>
workmesh changes
```

交付 manifest 只接受精确工件：HOSTED 项由 CLI 读取本地文件并计算字节摘要，GIT_REF 项必须给出 `projectRepositoryId`、`commitSha` 与 `repoPath`。

```json
{
  "workflowDefinitionRevisionId": "<uuid>",
  "localRunId": "local-20261102-1",
  "items": [
    {
      "kind": "IMPL",
      "schemaVersion": "1.0",
      "storage": "HOSTED",
      "mediaType": "text/markdown",
      "file": "impl.md",
      "checks": [{ "code": "anchor", "passed": true }]
    }
  ]
}
```

`workmesh review` 只创建人工评审请求；批准、返修、撤销与变更确认都只在 Web 会话中发生，Agent 没有批准路径。全部命令 `--json` 输出 `{data, meta:{requestId}}` 信封，失败输出统一错误 envelope。跨项目使用时把已构建的 `apps/cli/dist/index.js` 放入 PATH（例如 `~/.local/bin/workmesh`），不要在业务项目里用 `pnpm --filter` 执行，它会把工作目录切到 CLI 包目录。

## 验证

```bash
pnpm --filter @workmesh/api exec tsc --noEmit --incremental false
pnpm --filter @workmesh/shared test
pnpm --filter @workmesh/cli test
pnpm --filter @workmesh/web test
pnpm test:contracts
pnpm build
git diff --check
```

数据库相关套件需要隔离目标：`bash scripts/test-integration.sh`（默认只读，`--apply-migrations` 需单独确认）。构建与单元测试不会创建或修改共享数据库。

## 当前状态

当前为可自部署的开发版。真实 PostgreSQL 迁移与并发约束、浏览器 E2E、GitHub live 尚未验证，完整边界见 [docs/phase-status.md](docs/phase-status.md)；在完成这些验证之前，不要把它当作已上线的生产系统。
