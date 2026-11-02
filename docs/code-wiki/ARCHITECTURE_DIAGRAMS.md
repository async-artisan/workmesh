# WorkMesh Code Wiki：架构图册

## Architecture Diagrams

> 图例基于当前工作树的源码、package manifests、Prisma schema、运行脚本和 `docs/*.md`。每张图都说明置信度；真实 PostgreSQL、浏览器和 GitHub live 链路尚未由本次分析执行。

## 1. 系统上下文图

**目的**：说明使用者、WorkMesh 和外部系统的边界。

**置信度**：高。边界由 README、部署文档、AppModule、Vite 配置、Prisma datasource 和 integrations 模块直接支持。

```mermaid
flowchart LR
  Human["HUMAN 人类操作者\n浏览器会话"]
  Agent["本地 AI Agent\nWorkMesh CLI"]
  Ops["部署/运维人员"]
  WM["WorkMesh\nAPI + Web 工作台 + 协作协议"]
  DB[("PostgreSQL\nworkmesh_v1")]
  GH["GitHub\nWebhook / 提交证据"]
  Redis[("可选 Redis\n缓存")]

  Human -->|登录、批准、发布、撤销| WM
  Agent -->|设备授权、认领、上下文、交付| WM
  Ops -->|配置、迁移、运行检查| WM
  WM -->|持久化事实与追加历史| DB
  GH -->|HMAC Webhook / 代码读取| WM
  WM -.->|缓存，不承担正确性| Redis
```

**边证据**：`README.md` 明确三个产品面；`docs/deployment.md` 明确 PostgreSQL 与可选 Redis；`docs/api.md` 和 `apps/api/src/integrations/` 明确 GitHub 集成。

## 2. 容器与运行时图

**目的**：展示 monorepo 中可独立运行或构建的单元。

**置信度**：高。

```mermaid
flowchart TB
  subgraph Repo["WorkMesh pnpm + Turborepo monorepo"]
    Web["apps/web\nReact + Vite\n127.0.0.1:5173"]
    API["apps/api\nNestJS + Prisma\n:3000 /api"]
    CLI["apps/cli\nCommander + tsup\nworkmesh"]
    Shared["packages/shared\n协议、schema、摘要、流程校验"]
    UI["packages/ui\n最小 React 共享组件"]
    Config["packages/config\n配置类型"]
    Scripts["scripts/\n构建、迁移、验证、测试入口"]
  end
  PG[("PostgreSQL\nworkmesh_v1")]
  GitHub["GitHub"]

  Web -->|HTTP /api 代理| API
  CLI -->|HTTPS /api/v1| API
  API -->|Prisma Client| PG
  API -->|代码证据 / Webhook| GitHub
  Web --> Shared
  Web --> UI
  CLI --> Shared
  API --> Shared
  Scripts --> API
  Scripts --> Shared
```

**边证据**：各 package.json 的 workspace 依赖；`apps/web/vite.config.ts` 的 `/api` proxy；`apps/api/src/app.module.ts`；`schema.prisma` datasource；`scripts/*.sh`。

## 3. API 模块图

**目的**：定位后端领域模块和公共边界。

**置信度**：高；模块注册来自 `apps/api/src/app.module.ts`，领域职责来自目录、controller、service、repository 和 API 文档。

```mermaid
flowchart LR
  HTTP["HTTP /api"] --> Common["Common boundary\nValidationPipe\nStrict JSON\nResponse/Error/Metrics"]
  Common --> Auth["Auth\nPrincipal / scope / ticket"]
  Common --> Projects["Projects\nproject / member / role"]
  Common --> Knowledge["Knowledge\nKB / documents / publication"]
  Common --> Workflows["Workflows\ndefinition / instance / role package"]
  Common --> Tasks["Tasks\nclaim / snapshot / artifact / board"]
  Common --> Reviews["Reviews\nrequest / decision / revoke"]
  Common --> Integrations["Integrations\nGitHub evidence / webhook"]
  Common --> Receipts["Operation receipts / idempotency"]
  Auth --> Repos["Repository interfaces"]
  Projects --> Repos
  Knowledge --> Repos
  Workflows --> Repos
  Tasks --> Repos
  Reviews --> Repos
  Integrations --> Repos
  Receipts --> Repos
  Repos --> Prisma["Prisma repositories"]
  Prisma --> DB[("workmesh_v1")]
```

**边证据**：`AppModule` imports、各 `*.module.ts`、`v1-*.service.ts` 与 `v1-*.prisma-repository.ts` 的命名/导入关系。图中“Common boundary”也包含全局 middleware/interceptor/filter。

## 4. Agent 交付与人类评审时序图

**目的**：展示 WorkMesh 最核心的业务闭环。

**置信度**：高（控制步骤来自 `docs/api.md`、CLI 命令和领域服务；真实部署未执行）。

```mermaid
sequenceDiagram
  actor H as HUMAN
  participant W as Web
  participant A as API
  participant C as CLI
  actor G as Local Agent
  participant DB as PostgreSQL

  H->>W: 登录 / 创建项目 / 配置角色与工作流
  W->>A: action preview + confirmation ticket
  A->>DB: 保存项目、角色、流程与审计
  H->>W: 批准发布/授权
  W->>A: consume one-time ticket
  G->>C: workmesh auth login
  C->>A: PKCE device authorization
  A-->>C: AgentCredential（仅创建时返回 secret）
  C->>A: GET ready task
  C->>A: claim task（generation）
  C->>A: create ContextSnapshot
  A-->>C: 确定性上下文与受限资源
  G->>C: 本地按 RolePackage 工作
  C->>A: deliver ArtifactSet + Idempotency-Key
  A->>DB: 基线复核、保存工件、创建 ReviewRequest
  H->>W: 查看证据并批准/要求修改/拒绝
  W->>A: decision + expectedVersion + ticket
  A->>DB: 发布/验收、ChangeEvent、AuditEvent
  C->>A: receipt / changes ack
```

**省略**：GitHub 证据准备和 Webhook 是可插入的集成支路；图中没有把它们画成每次交付都必经。

## 5. 依赖方向图

**目的**：明确 workspace 包和运行时依赖，避免把共享包当作反向依赖 API。

**置信度**：高，来自各 `package.json` 和源码 imports。

```mermaid
flowchart LR
  Web["@workmesh/web"] --> Shared["@workmesh/shared"]
  Web --> UI["@workmesh/ui"]
  CLI["@workmesh/cli"] --> Shared
  API["@workmesh/api"] --> Shared
  API --> Nest["NestJS"]
  API --> PrismaClient["Prisma Client"]
  PrismaClient --> PG[("PostgreSQL")]
  Shared --> AJV["AJV + ajv-formats"]
  Root["root scripts / Turbo"] --> Web
  Root --> API
  Root --> CLI
  Root --> Shared
```

## 6. 边界与契约图

**目的**：展示验证、身份和写入保护所在的边界。

**置信度**：高，来自 `docs/api.md`、`main.ts`、`v1-auth*`、`v1-confirmation*`、`common` 和 shared 包。

```mermaid
flowchart LR
  Client["Web / CLI client"]
  Strict["严格 JSON + DTO whitelist\n拒绝未知字段/浮点/重复键/尾随内容"]
  Principal["AuthGuard\nHUMAN WebSession / AGENT Bearer"]
  Access["Project context + scope + KB ACL"]
  Write["Idempotency-Key\nexpectedVersion\nconfirmation ticket"]
  Domain["Domain service\n事务 + CAS + 审计"]
  Store["Prisma / PostgreSQL"]
  Client --> Strict --> Principal --> Access --> Write --> Domain --> Store
```

**关键约束**：客户端不能自报身份、角色、版本、审批槽或 system gate；确认票据绑定主体、会话、动作、目标、版本和 payload 摘要，只消费一次。

## 7. AI Agent 导航图

**目的**：给未来 Agent 一个最短安全阅读路径。

**置信度**：高；路径均为当前工作树文件。

```mermaid
flowchart TB
  Start["README.md\n产品定位与快速开始"] --> Contract["docs/api.md\n正式 /api/v1 契约"]
  Start --> Arch["docs/architecture.md\n事务、权限、证据原则"]
  Contract --> APIMain["apps/api/src/app.module.ts\n模块组合"]
  APIMain --> Domain["目标领域 controller/service/spec"]
  Domain --> Schema["apps/api/prisma/schema.prisma\n数据约束"]
  Start --> Web["apps/web/src/App.tsx\n页面与会话"]
  Start --> CLI["apps/cli/src/index.ts\n命令入口"]
  Start --> Shared["packages/shared/src/index.ts\n跨端协议与校验"]
  Arch --> Safety["修改前：git status + 目标/环境核验"]
  Safety --> Verify["修改后：相关测试 + type-check + build"]
```

## 8. 部署/运行图

**目的**：区分构建、API 进程、Web 托管和外部数据库。

**置信度**：高（部署文件和文档支持）；实际反向代理配置不在仓库中。

```mermaid
flowchart LR
  Dev["开发者"] --> Install["corepack pnpm install"]
  Install --> Build["shared build + prisma generate\npnpm build"]
  Build --> APIProc["node apps/api/dist/main.js"]
  Build --> WebDist["apps/web/dist\nTLS 反向代理托管"]
  APIProc --> PG[("PostgreSQL 15+\nWORKMESH_V1_DATABASE_URL")]
  Browser["浏览器"] --> WebDist
  WebDist --> APIProc
  CLIProc["workmesh CLI"] --> APIProc
  APIProc -.-> Redis[("可选 REDIS_URL")]
```

**运行前门禁**：`scripts/db-check.sh` 检查当前数据库；`scripts/db-plan.sh` 输出迁移计划；确认目标和回滚方式后才运行 `prisma migrate deploy`。`scripts/test-integration.sh` 默认不迁移，需显式 `--apply-migrations`。

## 9. 图册假设与遗漏

- 没有画出后台队列、定时 worker 或消息总线，因为当前源码和脚本没有足够证据证明存在这些运行单元。
- Redis 以虚线表示可选缓存；`docs/deployment.md` 明确未设置时直通且不影响正确性。
- Web 页面与 API resource 的细粒度映射只在页面和 `src/api/resources.ts` 中分散体现，未做浏览器 E2E，因此图中保持容器级关系。
- GitHub live runner 当前明确未实现，不能从适配器存在推断线上 GitHub 已验证。
