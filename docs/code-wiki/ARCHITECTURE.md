# WorkMesh Code Wiki：架构与代码地图

> 初始分析基线：2026-11-02 工作树快照；2026-11-04 文档清理时复核了运行入口、配置与验证状态。源码、schema 和脚本是实现依据；当前交付与验证边界统一见 [阶段状态](../phase-status.md)。本轮整理未重跑业务测试。

## 1. Executive Summary / 执行摘要

WorkMesh 是面向本地 AI Agent 的证据驱动协作中枢。人类通过浏览器会话负责批准、发布、撤销等高风险决策；Agent 在本机通过 CLI 获取受限凭据，领取任务、生成上下文、提交工件并请求评审；API 负责权限、版本并发、幂等、审计、证据绑定和状态流转；PostgreSQL 保存项目事实与追加式历史。

它不是单纯的聊天界面或任务列表，而是把“需求/知识 → 工作流 → 角色包与任务 → 上下文快照 → 工件/代码证据 → 人类评审 → 发布与变更传播”串成可追踪链路。当前仓库采用 pnpm + Turborepo monorepo，包含 NestJS API、React Web、Commander CLI、跨端 shared 契约和最小 UI 包。

## 2. Repository Purpose / 仓库目的与业务能力

### 2.1 解决的问题

- 为本地 Agent 提供项目、角色、流程和任务边界，避免 Agent 自行推断授权或发布状态。
- 为人类提供浏览器工作台，在明确的动作、目标、版本和摘要上作一次性确认。
- 让交付物具备真实字节或完整代码引用，并将 GitHub 提交级证据绑定到工件。
- 通过版本号、幂等键、确认票据、审计事件和操作收据，使重复请求、并发修改和撤销保持可解释。

### 2.2 领域词汇

| 术语                           | 含义                                                |
| ------------------------------ | --------------------------------------------------- |
| HUMAN                          | 浏览器 WebSession 主体，可执行需要人类批准的动作    |
| AGENT                          | CLI 持有的受限 AgentCredential 主体                 |
| Project / ProjectRole          | 工作空间与其业务角色                                |
| KnowledgeBase                  | 项目知识库，支持 PROJECT/RESTRICTED 可见性与 ACL    |
| DocumentRevision / Publication | 候选修订与已发布指针；发布和撤回是追加记录          |
| WorkflowDefinition / Instance  | 经校验并发布的 DAG 定义及其运行实例                 |
| RolePackageVersion             | 角色 SOP、资源和 Agent 入口的不可变版本             |
| TaskClaim                      | Agent 领取任务的代次，限制并发生产                  |
| ContextSnapshot                | 绑定任务、需求、工作流和资源摘要的确定性输入        |
| ArtifactSet                    | 任务交付物集合，包含托管字节或代码引用              |
| ReviewRequest / Decision       | 评审请求、审批槽位和人类决定                        |
| Code evidence                  | 由代码托管适配器标准化的提交级证据，当前实现 GitHub |

## 3. Audience Guide / 读者导览

- **新开发者**：先看本文第 5、6、7 节，再读 `README.md`、`docs/architecture.md`、`docs/api.md`，然后从 `apps/api/src/app.module.ts` 和 `apps/web/src/App.tsx` 进入。
- **后端开发者**：从 `apps/api/src/auth/v1-auth.service.ts`、`apps/api/src/knowledge/v1-knowledge-base.service.ts`、对应 controller/repository/spec 和 `apps/api/prisma/schema.prisma` 开始。
- **前端开发者**：从 `apps/web/src/App.tsx`、`apps/web/src/api/client.ts`、`apps/web/src/api/resources.ts`、`apps/web/src/store/` 及 `apps/web/src/pages/` 开始。
- **CLI/Agent 集成开发者**：从 `apps/cli/src/index.ts`、`apps/cli/src/client.ts`、`apps/cli/src/auth.ts`、`apps/cli/src/config.ts`、`apps/cli/src/context.ts`、`apps/cli/src/deliver.ts` 和 `apps/cli/src/receipts.ts` 开始。
- **运维人员**：先读 `docs/deployment.md`、`scripts/db-check.sh`、`scripts/db-plan.sh`、`scripts/test-integration.mjs`、`scripts/verify.sh`。
- **未来 AI Agent**：先读仓库根部 `README.md`、`docs/deployment.md`、`docs/phase-status.md`、`docs/api.md`、`spec/SPEC.md` 以及本文第 10、11 节；修改前确认当前工作树和目标环境。

## 4. System Context / 系统上下文

系统包含三个直接使用者：浏览器中的人类操作者、本地运行的 AI Agent、负责部署和维护的工程人员。浏览器和 CLI 都通过正式 `/api/v1` 协议访问 API；API 使用 PostgreSQL `workmesh_v1` schema，GitHub 通过 Webhook 与代码证据 API 接入；当前实现未使用 Redis。

详见本目录 [`ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md) 的系统上下文图、容器图和部署图。

## 5. Main Entry Points / 主要入口

| 入口            | 文件/命令                                                                | 职责                                                                                                                      |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| API bootstrap   | [`apps/api/src/main.ts`](../../apps/api/src/main.ts)                     | 创建 Nest 应用、设置 `/api` 前缀、CORS、限流、安全响应头、ValidationPipe、Swagger 和端口                                  |
| API composition | [`apps/api/src/app.module.ts`](../../apps/api/src/app.module.ts)         | 注册 Prisma、Auth、Projects、Knowledge、Reviews、Tasks、Workflows、Integrations、OperationReceipt 模块及全局拦截器/过滤器 |
| API probe       | [`apps/api/src/app.controller.ts`](../../apps/api/src/app.controller.ts) | `/api/health`、`/api/metrics`                                                                                             |
| Web bootstrap   | [`apps/web/src/main.tsx`](../../apps/web/src/main.tsx)                   | StrictMode、BrowserRouter 和根组件挂载                                                                                    |
| Web shell       | [`apps/web/src/App.tsx`](../../apps/web/src/App.tsx)                     | 会话 bootstrap、健康状态、导航、页面选择、ErrorBoundary、Toast 与过期会话处理                                             |
| CLI entry       | [`apps/cli/src/index.ts`](../../apps/cli/src/index.ts)                   | 构造 `workmesh` Commander 程序，注册 auth、roles、claim、context、candidate、deliver、review、receipt、changes 命令       |
| Shared entry    | [`packages/shared/src/index.ts`](../../packages/shared/src/index.ts)     | 导出协议、错误、严格 JSON、摘要、schema、认证和工作流校验能力                                                             |
| Database schema | [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma)   | PostgreSQL datasource、枚举、模型、关系、索引和 `workmesh_v1` schema                                                      |

## 6. Major Components / 主要模块职责

### 6.1 API 应用层

API 遵循当前代码中的 `controller → domain service → repository → Prisma` 请求链。Controller 负责 DTO、路由和 HTTP 形状；Service 负责主体、项目成员、角色、版本、票据、事务和领域状态；Repository 抽象持久化并有 Prisma 实现；PrismaService 创建 v1 client。

| 模块         | 目录                         | 职责与代表文件                                                                                   |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| 认证与授权   | `apps/api/src/auth/`         | WebSession + 双值 CSRF、Agent Bearer、设备授权 PKCE、scope、动作预览、一次性确认票据和认证持久化 |
| 项目与角色   | `apps/api/src/projects/`     | 项目生命周期、成员、项目业务角色、角色分配和项目访问上下文                                       |
| 知识与发布   | `apps/api/src/knowledge/`    | 知识库 ACL、文档/修订、候选版本、发布/撤回、已发布内容检索                                       |
| 流程与角色包 | `apps/api/src/workflows/`    | WorkflowDefinition 校验/发布、实例物化、RolePackageVersion 与资源读取                            |
| 任务与工件   | `apps/api/src/tasks/`        | 任务 ready 查询、认领/释放、工作状态、ContextSnapshot、ArtifactSet、看板、变更收件人             |
| 评审         | `apps/api/src/reviews/`      | 评审请求、审批槽位、决定、撤销和发布/验收副作用                                                  |
| GitHub 集成  | `apps/api/src/integrations/` | Webhook HMAC 验签、GitHub adapter、代码证据准备与版本化使用票据                                  |
| 公共基础设施 | `apps/api/src/common/`       | request context、严格 JSON、响应 envelope、异常过滤、指标、幂等、操作收据                        |
| Prisma       | `apps/api/src/prisma/`       | PrismaModule/PrismaService 与数据库连接边界                                                      |

### 6.2 Web 工作台

Web 使用 React 18、Vite、React Router 的浏览器能力、Zustand、TanStack Query、Axios 和 shared 契约。路由页面当前覆盖登录/注册、项目、知识、PRD、评审、看板、角色、授权、个人资料和 Workbench。`src/api/client.ts` 统一 API 请求、错误处理和会话过期事件；`src/store/*` 保存认证、项目和 Toast 状态；`src/components/*` 提供 Modal、确认提示、错误边界、项目选择和 Toast。

### 6.3 CLI

CLI 使用 Commander 构建单文件入口，配置写入用户 `~/.workmesh` 与项目 `.workmesh`。`auth.ts` 执行浏览器设备授权并接收 AgentCredential；`client.ts` 固化 `/api/v1`、严格路径、GET 有限重试和写请求幂等要求；`context.ts` 生成/物化上下文；`deliver.ts` 提交工件；`receipts.ts` 记录本地操作收据；`roles.ts` 安装角色包；`errors.ts` 将协议错误映射为 CLI 错误与退出码。

### 6.4 跨端包

- `packages/shared`：AJV schema、严格 JSON 解析、canonical JSON、SHA-256、错误 envelope、Principal/scopes、角色包清单校验、流程 DAG 校验/编译和跨端协议常量。
- `packages/ui`：当前为最小 React 共享组件出口，实际业务页面主要位于 Web。
- `packages/config`：配置类型包，当前没有独立运行时职责。

## 7. Key Classes and Functions / 关键类与函数

### 7.1 认证、权限与确认

| 符号                                            | 位置                                                | 作用                                                     |
| ----------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `V1AuthGuard.canActivate`                       | `apps/api/src/auth/v1-auth.guard.ts`                | 从 WebSession Cookie 或 Agent Bearer 解析并注入主体      |
| `V1AuthService.authenticate`                    | `apps/api/src/auth/v1-auth.service.ts`              | 认证主流程，区分 HUMAN 与 AGENT                          |
| `V1AuthorizationService.resolveProjectContext`  | `apps/api/src/auth/v1-authorization.ts`             | 每请求重新解析项目成员、角色和 scope                     |
| `requireScope` / `resolveKnowledgeAccess`       | 同上                                                | 强制权限和知识库 ACL                                     |
| `V1ActionService.preview` / `issueTicket`       | `apps/api/src/auth/v1-action.service.ts`            | 生成动作预览和绑定摘要的一次性票据                       |
| `V1ConfirmationService.verifyTicketBinding`     | `apps/api/src/auth/v1-confirmation.ts`              | 校验主体、会话、动作、目标、版本、payload 摘要与消费状态 |
| `V1CliAuthorizationService.create/approve/poll` | `apps/api/src/auth/v1-cli-authorization.service.ts` | CLI 设备授权和 PKCE S256 流程                            |

### 7.2 流程、任务和评审

| 符号                                                | 位置                                                | 作用                                                                      |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| `validateWorkflowDefinition`                        | `packages/shared/src/workflow.ts`                   | 校验 schema/protocol、步骤 key、依赖、环路和 release step，并产生结构摘要 |
| `compileWorkflowDefinition`                         | 同上                                                | 解析角色、审批槽、角色包锁和服务端 system gate，产生 canonical digest     |
| `V1WorkflowService.validate/publish/createInstance` | `apps/api/src/workflows/v1-workflow.service.ts`     | 服务端校验、发布流程定义并为需求实例化步骤/任务                           |
| `V1RolePackageService`                              | `apps/api/src/workflows/v1-role-package.service.ts` | 注册/列出角色包版本并读取资源                                             |
| `V1TaskService.claim/release/setWorkStatus`         | `apps/api/src/tasks/v1-task.service.ts`             | 按任务代次串行认领、释放和工作状态变更                                    |
| `V1SnapshotService.create/getSnapshot/getResource`  | `apps/api/src/tasks/v1-snapshot.service.ts`         | 构造确定性上下文快照并按引用读取资源                                      |
| `V1ArtifactService.deliver/getArtifactSet`          | `apps/api/src/tasks/v1-artifact.service.ts`         | 接收真实字节或完整代码引用，并复核基线                                    |
| `V1ReviewService.requestReview/decide/revoke`       | `apps/api/src/reviews/v1-review.service.ts`         | 管理评审请求、决定、发布/验收效果及决定撤销                               |

### 7.3 代码证据与公共协议

| 符号                                | 位置                                                      | 作用                                                |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `GithubCodeHostAdapter`             | `apps/api/src/integrations/v1-code-host-adapter.ts`       | 将 GitHub 提供者字段隔离在适配器边界                |
| `V1GithubEvidenceService`           | `apps/api/src/integrations/v1-github-evidence.service.ts` | Webhook、提交级证据准备、指纹和版本化使用票据       |
| `canonicalJson` / `parseJsonStrict` | `packages/shared/src/{canonical-json,strict-json}.ts`     | 生成稳定摘要并拒绝浮点、重复键、尾随内容和过深 JSON |
| `sha256Bytes`                       | `packages/shared/src/bytes.ts`                            | 内容摘要，用于协议和证据绑定                        |
| `errorEnvelope` / `WorkmeshError`   | `packages/shared/src/errors.ts`                           | 跨 API、Web、CLI 的统一错误形状                     |

## 8. Data and Control Flow / 数据模型与依赖关系

### 8.1 PostgreSQL 模型分组

数据模型定义在 `schema.prisma`，全部落在 `workmesh_v1` schema。可以按业务关系理解为：

1. **身份与控制**：`User`、`WebSession`、`AgentCredential`、`CliAuthorizationRequest/View`、`ConfirmationTicket`、`PrincipalStamp`、`AuthRateWindow`。
2. **项目与权限**：`Project`、`ProjectMember`、`ProjectRole`、`ProjectRoleAssignment`、`KnowledgeBaseGrant`、`ProjectKnowledgeBinding`。
3. **知识与需求**：`KnowledgeBase`、`KnowledgeDocument`、`DocumentRevision`、`DocumentPublication`、`Requirement`。
4. **流程与执行**：`WorkflowDefinition`、`WorkflowRevision`、`WorkflowInstance`、`Task`、`TaskClaim`、`RolePackageVersion`、`RolePackageResource`。
5. **上下文与交付**：`ContextSnapshot`、`SnapshotResourceRef`、`ArtifactSet`、`ArtifactSetItem`、`Artifact`。
6. **评审与传播**：`ReviewRequest`、`ApprovalSlot`、`ReviewDecision`、`ReviewDecisionRevocation`、`ChangeEvent`、`ChangeRecipient`。
7. **集成与可追溯性**：`ProjectRepository`、`CodeReviewEvidence`、`WebhookReceipt`、`IdempotentOperation`、`AuditEvent`。

### 8.2 一致性原则

- 写操作使用 Serializable 事务、项目行锁、版本 compare-and-set 和有界序列化重试（架构说明与服务测试均支持该方向）。
- 评审决定、发布、撤销、凭据和审计以追加式记录保留历史；撤销通过新记录失效当前指针或状态。
- 版本资源要求 `expectedVersion`；写接口要求 `Idempotency-Key`；高风险动作还要求一次性 confirmation ticket。
- Agent 的工作输入锁定为已发布角色包版本、ContextSnapshot 和 TaskClaim generation；客户端不能自报 system gate 或批准结果。

### 8.3 依赖方向

```text
apps/web ───────► /api/v1 ◄─────── apps/cli
    │                                  │
    ├──► @workmesh/shared ◄────────────┘
    └──► @workmesh/ui

apps/api ───► @workmesh/shared
    ├──► NestJS / class-validator / Swagger
    ├──► Prisma Client ───► PostgreSQL(workmesh_v1)
    └──► GitHub adapter
```

依赖边由 package manifest、imports、Vite proxy、AppModule imports 与 Prisma datasource 直接支持；GitHub live 运行未完成，不能把 live API 可用性当作已验证事实。

## 9. Control and Data Flows / 典型控制与数据流

### 9.1 Agent 交付主链路

1. HUMAN 在 Web 中建立项目、角色和工作流，并通过确认票据完成发布或授权。
2. CLI 通过 PKCE 设备授权取得受限 AgentCredential，写入本地权限受限文件。
3. Agent 调用 ready tasks，按角色和 scope 领取任务，获得 TaskClaim generation。
4. CLI 创建 ContextSnapshot，平台按已发布知识、需求、流程和角色包资源生成确定性输入。
5. Agent 在本地按角色包工作，将文件或完整代码引用提交为 ArtifactSet。
6. API 复核基线与代码证据，创建 ReviewRequest；HUMAN 在 Web 中批准、要求修改或拒绝。
7. 全部审批槽满足时，服务在同一事务完成发布/任务验收及 ChangeEvent，CLI 可通过操作收据和变更收件人确认结果。

### 9.2 Web 请求链

Web 页面 → `api/client.ts` → `/api/v1` → 全局 middleware/interceptor/guard → Controller → Service → Repository → Prisma → Response/Error envelope。正式 API 前缀由 `main.ts` 的 `api` 与领域 controller 的 `v1` 组成。

## 10. Runtime, Configuration, and Deployment / 运行、配置与部署

### 10.1 本地开发

```bash
pnpm install
pnpm --filter @workmesh/shared build
pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma
```

按 [部署说明](../deployment.md) 配置环境与数据库后，在两个终端分别执行 `pnpm --filter @workmesh/api dev` 和 `pnpm --filter @workmesh/web dev`。Windows 一键启动说明见 [本地运行](../local-dev.md)。API 默认端口为 3000，Swagger 为 `/api/docs`；Web 默认 `http://127.0.0.1:5173`，Vite 将 `/api` 代理到 `127.0.0.1:3000`。

### 10.2 数据库与生产部署

Node.js 20.19+、pnpm 10.28.2、PostgreSQL 15+ 是文档要求。正式连接只使用 `WORKMESH_V1_DATABASE_URL`，迁移前先运行 `scripts/db-check.sh` 与 `scripts/db-plan.sh`，确认目标和回滚策略后再执行：

```bash
pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma
```

生产默认 `WORKMESH_COOKIE_MODE=SECURE`，需要 HTTPS 与 `__Host-` Cookie；`LOCAL_INSECURE` 仅用于 loopback 开发。`WORKMESH_PUBLIC_ORIGIN`、`WEB_ORIGIN`、`PORT` 和 `RATE_LIMIT_MAX` 由部署环境注入。API 从 `apps/api/dist/main.js` 启动，Web `dist` 由 TLS 反向代理托管。

### 10.3 CLI

```bash
pnpm --filter @workmesh/cli build
pnpm workmesh --help
```

跨项目使用构建后的 `apps/cli/dist/index.js`。首次初始化执行 `workmesh setup --role backend --host codex --api https://<host>/api/v1 --project <项目UUID>`，完成浏览器设备授权、角色包安装和自检，再按需执行 `claim`、`context`、`deliver`、`review`、`receipt` 和 `changes` 等命令。也可分别使用 `auth login` 与 `roles install`；参数示例见根目录 README 的 CLI 章节。

## 11. Testing and Verification / 测试与验证

### 11.1 已配置的检查

```bash
pnpm --filter @workmesh/api exec tsc --noEmit --incremental false
pnpm --filter @workmesh/shared test
pnpm --filter @workmesh/cli test
pnpm --filter @workmesh/web test
pnpm test:contracts
pnpm build
git diff --check
```

`scripts/verify.sh` 还会执行格式、lint、type-check、全量测试、API coverage、构建和 Prisma validate。

### 11.2 测试边界

- API：领域 service spec、进程内 Nest HTTP contract、知识权限和发布 e2e spec。
- Web：Vitest + Testing Library + jsdom，覆盖页面与组件交互。
- CLI/shared：Vitest，覆盖协议、配置、认证、上下文、收据、角色包和严格 JSON。
- 隔离数据库：`pnpm test:integration` 默认不执行正式迁移（不自动运行 DDL），但集成套件会在通过门禁的隔离测试库中写入测试数据；它不是只读入口。`--apply-migrations` 还会明确对该隔离库应用正式迁移。
- GitHub live：`scripts/test-github-live.mjs` 已实现显式开启后的只读真实 API 校验、reviews 分页与生产归一化；未配置授权仓库/PR 时跳过。该入口不验证真实 webhook 投递。浏览器验证入口为 `pnpm test:browser`。

## 12. How to Navigate the Codebase

按入口定位：API 看 `apps/api/src/app.module.ts`；浏览器工作台看 `apps/web/src/App.tsx`；CLI 看 `apps/cli/src/index.ts`；跨端 schema/算法看 `packages/shared/src/index.ts`；数据约束看 `apps/api/prisma/schema.prisma`。涉及线上行为时同时核对 `docs/api.md` 和对应测试。

## 13. Safe Change Guide for Humans and AI Agents

本节同时适用于人工开发者和 AI agent；AI agent 必须先核对工作树、契约、真实请求响应和目标环境，再修改代码。

### 13.1 修改前

1. `git status --short --branch`，确认不要覆盖他人或重构中的工作树改动。
2. 读 `README.md`、目标模块的 controller/service/repository/spec、`docs/api.md` 和 `schema.prisma`。
3. 若涉及前端，核对 `apps/web/src/api/resources.ts` 的真实请求/响应，不从相似页面猜字段。
4. 若涉及数据库、迁移、租户或运行态，先确认 `WORKMESH_V1_DATABASE_URL` / `WORKMESH_TEST_DATABASE_URL` 的目标与权限。

### 13.2 修改边界

- 不直接修改 `dist/`、coverage、`.turbo/`、Prisma 生成产物或 lockfile 以外的构建输出。
- 不把旧 JWT、refresh、seed、旧 `DATABASE_URL` 或旧 signoff 设计重新引入 v1。
- 不绕过 Guard、scope、版本、幂等键、确认票据或审计；不让客户端提交服务端派生的审批槽和 system gate。
- 不在工作树混有他人改动时整文件覆盖；提交时只提交自己的改动。

### 13.3 修改后

按变更面运行最小相关测试，再运行 `pnpm type-check`、`pnpm test`、`pnpm build` 或 `scripts/verify.sh`。涉及协议时必须运行 `pnpm test:contracts`；涉及 DB 时先 Prisma validate，再用隔离测试库。

## 14. Assumptions and Items Needing Human Validation / 假设与待核实项

- 文档中的实现描述不能代替发布或部署记录。
- 根 `.env.example` 与 `apps/api/.env.example` 已使用 v1 配置；两者默认是本地开发模式，生产配置按 [部署说明](../deployment.md) 设置 HTTPS、Cookie 与数据库连接。
- 2026-11-03 验收记录覆盖隔离 PostgreSQL 迁移、备份恢复及部分并发约束；生产升级、回滚、容量和灾备仍需验证，详见 [阶段状态](../phase-status.md)。
- 基础浏览器流程和打包后 CLI 已有验收记录；完整交付闭环、跨浏览器、Node 20/24 矩阵和获准真实仓库的 GitHub live 仍需补充证据。本轮文档整理未执行这些验证。
- `packages/ui` 和 `packages/config` 当前职责较小；未来是否扩展为统一设计系统或配置运行时，需要产品/架构决策，不应从包名推断。

### 验证说明

本 Wiki 的关系依据来自 package manifests、imports、AppModule、Vite 配置、Prisma schema、公开 API 文档、测试文件和运行脚本。未能由这些证据确认的关系已标注为待核实；GitHub live 验收尚未完成，不能从适配器存在推断线上链路已验证。

## 15. Suggested Architecture Improvements / 建议的架构改进

| Category               | Recommendation                                                                    | Evidence                                                                                | Senior developer rationale         | Manager rationale                | Effort | Risk | Priority |
| ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------- | ------ | ---- | -------- |
| Documentation/context  | 保持两份 `.env.example` 与部署说明同步，区分本地和生产配置                        | 两份样例已使用 v1 配置，但默认是本地开发模式                                            | 降低错误配置和排障分支             | 缩短新成员上手时间，减少部署事故 | 小     | 低   | P1       |
| Verification/guardrail | 在 CI 增加架构文档校验、契约测试和 `git diff --check` 门禁                        | 已有 `scripts/test-contracts.mjs`、`scripts/verify.sh`，但工作树状态显示文档/代码易漂移 | 让协议与说明的偏差更早暴露         | 提高交付可预测性                 | 小     | 低   | P1       |
| Contract/schema        | 为 API v1 生成或维护机器可检查的 OpenAPI/route contract snapshot                  | `docs/api.md` 是手写清单，Swagger 在运行时生成                                          | 防止 controller、Web、CLI 契约漂移 | 降低跨端联调成本                 | 中     | 中   | P1       |
| Verification/guardrail | 补充生产 PostgreSQL 升级、回滚、容量与灾备验收                                    | 隔离数据库验证已有记录，生产与规模化运行证据仍待补充                                    | 检查真实运行环境的约束和恢复能力   | 降低数据损坏和回滚风险           | 中     | 中   | P0       |
| Security/data safety   | 将 CLI 凭据文件存储接入系统钥匙串或明确部署基线                                   | CLI 当前支持用户 home 下 0600 文件，并明确不宣称同用户隔离                              | 减少本地凭据泄露面                 | 降低终端失陷后的凭据处置成本     | 中     | 中   | P1       |
| Boundary/modularity    | 为每个 API 领域补一份“controller/service/repository/事务边界”短 README 或目录索引 | 领域文件数量多，入口关系目前主要靠命名和本文恢复                                        | 降低跨模块修改时的误读             | 减少新人和 AI Agent 的定位时间   | 小     | 低   | P2       |
| Documentation/context  | 为图中低置信度关系补一份关系清单或 ADR，尤其是 Web 页面与 API resource 映射       | 当前可由 imports 推断大部分边，但真实浏览器链路未验证                                   | 让架构边有可审计来源               | 减少维护中的“看起来应该如此”     | 小     | 低   | P2       |

## 16. Glossary / 术语表

见第 2.2 节。协议字段和枚举必须保留代码中的英文拼写；中文解释不能替代 `HUMAN`、`AGENT`、`expectedVersion`、`Idempotency-Key`、`confirmation`、`TaskClaim generation` 等正式字段。

## 17. Appendix: Evidence Map / 附录：证据地图

| 证据类型   | 文件/命令                                                                                                       | 支持的结论                                                                        | 置信度 |
| ---------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| 产品定位   | `README.md`                                                                                                     | WorkMesh 是本地 Agent 的证据驱动协作中枢，包含 API/Web/CLI/shared/ui              | 高     |
| 架构原则   | `docs/architecture.md`                                                                                          | controller→service→repository→Prisma、Principal、事务、追加式历史、GitHub adapter | 高     |
| API 契约   | `docs/api.md`、`apps/api/src/knowledge/v1-knowledge-base.controller.ts`                                         | `/api/v1` 路由、认证、幂等、版本和确认票据                                        | 高     |
| API 组合   | `apps/api/src/app.module.ts`、`main.ts`                                                                         | 模块、全局管道、拦截器、前缀、Swagger、CORS、限流                                 | 高     |
| 数据       | `apps/api/prisma/schema.prisma`                                                                                 | PostgreSQL `workmesh_v1` schema、模型、枚举、关系                                 | 高     |
| 前端       | `apps/web/src/App.tsx`、`apps/web/src/api/client.ts`、`apps/web/src/pages/Board.tsx`、`apps/web/vite.config.ts` | 浏览器会话、页面入口、API 客户端和开发代理                                        | 高     |
| CLI        | `apps/cli/src/index.ts`、`apps/cli/src/client.ts`、`apps/cli/src/auth.ts`、`apps/cli/src/config.ts`             | 命令、设备授权、配置、重试和收据                                                  | 高     |
| 跨端契约   | `packages/shared/src/index.ts`、`packages/shared/src/strict-json.ts`、`scripts/test-contracts.mjs`              | 严格 JSON、摘要、错误、角色包和流程校验                                           | 高     |
| 运行部署   | `docs/deployment.md`、`scripts/test-integration.mjs`、`scripts/verify.sh`、`package.json`                       | Node/pnpm/Postgres、迁移、构建、测试与部署步骤                                    | 高     |
| 状态/缺口  | `docs/phase-status.md`                                                                                          | 隔离数据库和基础浏览器已有记录，生产与 GitHub live 验收仍有缺口                   | 高     |
| 工作树状态 | `git status --short --branch`                                                                                   | 修改前识别已有本地变更及当前分支                                                  | 高     |
