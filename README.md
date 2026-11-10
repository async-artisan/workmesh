# WorkMesh

WorkMesh 让 AI 干的活有人签字、有据可查。团队每个角色在自己电脑上用本机 Agent 生产，平台负责需求与流程、角色包、上下文快照、工件与代码证据、评审与变更传播。人只在关键节点用浏览器作正式批准，Agent 只持有受限、可撤销的凭据。

它不执行 Agent、不做 AI 对话、不替代 GitHub：它只裁决「这份交付是否成立」。

事实 · 证据 · 签字

参与项目：[贡献指南](CONTRIBUTING.md) · [社区入口与路线图](docs/community/README.md) · [治理说明](GOVERNANCE.md) · [维护者](MAINTAINERS.md) · [安全政策](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md) · [变更记录](CHANGELOG.md)。

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
- **规格与交付质量**：角色方法覆盖想法评估、需求检查、实现规划与交付核验；`workmesh quality` 在本地检查验收、任务、用例和证据映射，见[采用方法与边界](docs/design/spec-driven-quality.md)。
- **评审与变更**：工作台待办与证据卡、逐条/批量决定、变更请求分级与传播、发布候选冻结。
- **知识与度量**：三类知识库（BUSINESS / SYSTEM / PRACTICE）字段、流程度量接口 `GET /projects/:id/metrics/flow`。
- **项目治理**：代码仓库登记、自定义角色、成员与角色指派。
- **一个盒子**：`workmesh-box status` / `dev` / `backup` / `restore`，三平台共用一份实现（Windows 已实测，Linux/macOS 适配器已实现待验收），见 [docs/box.md](docs/box.md)。
- **文档**：[文档导航](docs/README.md) · [开始使用](docs/getting-started.md) · [本地运行](docs/local-dev.md) · [部署说明](docs/deployment.md) · [支持矩阵](docs/support-matrix.md) · [发布验收](docs/releasing.md) · [API 清单](docs/api.md) · [交付状态](docs/phase-status.md) · [开发计划](docs/dev-plan.md)。

## 快速开始

新用户建议先看[开始使用](docs/getting-started.md)，了解支持边界和本地演示；社区参与、路线图与 issue 分流见[社区入口](docs/community/README.md)。

本机开发（Windows，一条命令起 PostgreSQL + API + Web）的完整说明见 [docs/local-dev.md](docs/local-dev.md)：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-local.ps1
```

也可以直接用 `workmesh-box`（三平台通用，先 `pnpm --filter @workmesh/box build`）：

```powershell
pnpm box status     # 版本/平台/数据库/端口/备份与检查项
pnpm box doctor     # 只体检，关键项失败退出码 1
pnpm box dev        # 起缺失服务并检查 API 就绪；端口已占用时不重复启动
pnpm box backup     # 备份到 <data-dir>/backups/<时间>/
```

下面是手工步骤。`pnpm` 版本已由 `packageManager` 固定，可直接用 `pnpm`；若本机 `corepack` 因签名校验失败（`Cannot find matching keyid`），不要绕它，改用已安装的 pnpm 10.28.2。

```bash
pnpm install
pnpm --filter @workmesh/shared build
pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma
```

配置 `WORKMESH_V1_DATABASE_URL` 指向显式选择的 PostgreSQL（本地开发的其余配置项见 `.env.example`，需要 `WORKMESH_COOKIE_MODE=LOCAL_INSECURE` 才能用 loopback HTTP）。确认目标与回滚方式后按顺序应用迁移（当前 `0001_init`–`0021_review_discussions`，共 21 项；最后一项增加逐项评审问题记录）：

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

业务开发者先登录团队提供的 WorkMesh，进入项目的「工作区」页面（`/workspace`），取得接入码并复制对应 Shell 的单行命令。CLI 可从该平台的 `/download` 获取；本地目录指向自己的业务代码，不是 WorkMesh 源码目录。完整步骤、Shell 路径和故障处理见 [业务项目接入 CLI](docs/cli-onboarding.md)。维护 WorkMesh 的源码构建和数据库迁移另见 [本地运行](docs/local-dev.md)。

新接入使用 `workspace init`，默认只预览本机计划。以下双引号中的占位符必须替换；`--api` 使用管理员提供、在项目接入页填写的实际平台 API 基址，不能从业务系统域名或旧开发端口推断：

```text
workmesh workspace init --join "<一次性接入码>" --root "<业务项目绝对路径>" --role frontend --host codex --api "<平台API基址>"
```

确认目录、角色、平台和写入计划后，在同一条命令末尾加 `--apply`。此时才消费接入码并进入浏览器设备授权，凭据保存在当前用户的 `~/.workmesh`（可用 `--config-home` 覆盖）。按输出继续 `workspace discover`、`workspace bind` 与 `workspace status`；安装或更新角色资源使用 `workmesh setup --dir "<业务项目绝对路径>" --role frontend --host codex`，六个内置角色随发行包自动查找，通常无需 `--package`。

`setup --project "<项目UUID>" --api "<平台API基址>" ...` 仍是兼容初始化入口；新项目接入优先采用页面生成的 `workspace init` 命令。已有 v1 `.workmesh/config.json` 时先运行 `workspace migrate --dry-run`，确认后再 `--apply`。`workmesh doctor --dir "<业务项目绝对路径>" --role frontend --api "<平台API基址>" --online` 可在接入前集中检查环境。

之后按角色执行标准作业序列。任务编号来自 `GET /api/v1/projects/:projectId/tasks/ready` 或 Web 工作台；上下文快照创建后，任务版本以服务端返回为准。

```bash
workmesh context --task "<taskId>" --inspect
workmesh claim --task "<taskId>"
workmesh context --task "<taskId>" --claim "<claimId>" --expected-version "<taskVersion>" --materialize
workmesh deliver --task "<taskId>" --claim "<claimId>" --snapshot "<snapshotId>" --expected-version "<taskVersion>" --manifest deliver.json
workmesh review show --review "<deliver返回的reviewRequestId>"
workmesh changes
```

`context --inspect` 只读报告逐项输入问题、责任角色和下一步；退出码 0 仅表示查询成功，是否可创建快照仍需看 `availability` 与诊断。`deliver` 已自动创建评审，使用其返回的真实 `reviewRequestId` 查询；输出丢失时，可用 `workmesh receipt show --operation "<原交付operationId>" --json` 读取 `data.resultRefs.reviewRequestId`。结果未知时先核对原操作收据，不重复创建评审。

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

`workmesh review` 保留独立创建人工评审请求的用途；工件主体的 `--expected-version` 使用当前任务版本，文档修订主体使用所属文档版本。普通交付已自动创建评审，无需再调用创建命令。批准、返修、撤销与变更确认都只在 Web 会话中发生，Agent 没有批准路径。全部命令 `--json` 输出 `{data, meta:{requestId}}` 信封，失败输出统一错误 envelope。发行包的启动器应加入 PATH；源码开发者可从 WorkMesh 仓库构建 `@workmesh/shared` 与 `@workmesh/cli` 后调用 `apps/cli/dist/index.js`。不要在业务项目里用 `pnpm --filter` 执行 CLI，它会把工作目录切到 CLI 包目录。

## 验证

贡献者与 CI 共用完整入口。先按[完整本地验证](docs/testing/local-verification.md)配置显式隔离测试库，再运行：

```bash
pnpm verify
```

该入口执行格式、静态检查、单元与契约测试、真实数据库集成和迁移漂移检查、构建、bundle 证据、Chromium 与覆盖率门禁；任何一步失败都会非零退出。数据库测试会写入并清理隔离测试数据，默认不执行迁移；只有首次配置且已确认目标时才使用 `pnpm verify -- --apply-migrations`。定向排查命令和运行边界见上述文档。入口由 Node 驱动，可在 Windows、macOS 和 Linux 使用；本机成功不替代待发布 commit 的远端 CI。

## 当前状态

当前为可自部署的开发版。Windows 本机已有隔离安装、真实 PostgreSQL 迁移与并发集成、CLI/Web 交付返修、备份恢复，以及真实 Chromium 的账户、QA 签字和基线变更流程验证。各轮源码、制品和通过范围分别记录，最新完整入口结果见[本地验证验收](docs/testing/local-verification-validation-2026-11-07.md)，当前能力和未完成项见[交付状态](docs/phase-status.md)。

仓库提供 Windows x64 draft Release 自动化，仍需维护者人工验收后发布。最终干净 commit 的远端 CI、真实 GitHub PR/Webhook、完整代码项目发布链、外部真实团队签字、新机与升级卸载、生产容量及长期稳定性仍需独立证据；本机隔离团队与自动化通过不构成生产或稳定版承诺。支持范围与发布条件见[支持矩阵](docs/support-matrix.md)和[发布验收](docs/releasing.md)。
