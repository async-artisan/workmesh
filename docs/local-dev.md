# 本地运行 WorkMesh

这份文档解决一件事：把仓库在这台 Windows 机器上跑起来，并知道点哪里能看懂它。

部署到服务器不走这里，见 [deployment.md](deployment.md)。

## 1. 一条命令启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-local.ps1
```

或者 `pnpm dev:local`。脚本按顺序做三件事，已经在监听的会跳过，所以可以反复执行：

1. `5432` 没监听 → 用 embedded-postgres 启动本机 PostgreSQL（数据在 `%LOCALAPPDATA%\workmesh-pg\data`）；
2. `3000` 没监听 → `pnpm --filter @workmesh/api dev`（NestJS watch）；
3. `5173` 没监听 → `pnpm --filter @workmesh/web dev`（Vite，`/api` 代理到 3000）。

等 API 的 `/api/health` 和 Web 首页真的可访问后才打印入口，失败会指向 `.tmp\dev-logs\*.log`。

配套开关：

| 命令                               | 作用                                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| `... scripts\dev-local.ps1 -Check` | 只体检，不启动；全绿退出码 0                                     |
| `... scripts\dev-local.ps1 -Stop`  | 停掉本脚本启动过的进程（按进程树收），并收掉 3000/5173 上的 node |

端口不在脚本参数里改：API 端口来自 `apps/api/.env` 的 `PORT`，Web 端口来自 `apps/web/vite.config.ts`。要换端口得同时改 `WORKMESH_PUBLIC_ORIGIN` / `WEB_ORIGIN`，否则 Cookie 和 Origin 校验会挡掉请求——所以默认别动。

> 启动入口使用 Windows PowerShell，脚本兼容 5.1；脚本须保存为 **UTF-8 with BOM**，避免 Windows PowerShell 5.1 误读中文。

## 2. 打开并登录

<http://127.0.0.1:5173>

**必须用 `127.0.0.1`，不要用 `localhost`**：`apps/api/.env` 里 `WORKMESH_PUBLIC_ORIGIN` / `WEB_ORIGIN` 是精确匹配的 `http://127.0.0.1:5173`，换成 `localhost` 会被 Origin 校验挡掉。

`dev-local.ps1` 不会自动写入演示数据。全新数据库建议先跑仓库自带、无需额外资料的最小首跑：

```powershell
pnpm --filter @workmesh/shared build
node scripts/first-run-demo.mjs
```

脚本会创建一个临时演示账号、项目、流程、任务、交付和人工评审，并在结束时打印账号和项目 ID；然后用它打印的账号登录下面的地址。它只适合自己的隔离开发库，产生的数据不会自动清理。

如果你已经拿到外部的易番番需求正文，也可以运行 `scripts/seed-yff.mjs --phase all` 导入完整的 YFF 演示环境。该脚本依赖仓库外的 `.tmp\yff-req\易番番需求`，全新 checkout 默认没有这些正文；缺少该目录时不要把 seed 失败误认为 API 或 Web 启动失败。

只有完成上述 seed 后，以下账号才存在，密码统一 `Yff-Demo-2026!`：

| 账号                 | 角色                             |
| -------------------- | -------------------------------- |
| `owner@yesgoo.local` | 项目负责人（待办最全，先用这个） |
| `pm@yesgoo.local`    | 产品                             |
| `ui@yesgoo.local`    | UI 设计                          |
| `dev@yesgoo.local`   | 前端                             |
| `be@yesgoo.local`    | 后端                             |
| `qa@yesgoo.local`    | 测试                             |
| `ops@yesgoo.local`   | 运维                             |

想自己注册：`/register`。新账号一开始没有任何项目角色，需要 owner 在「角色/ACL」里授予，否则工作台是空的——这是权限模型，不是 bug。

## 3. 手动启动（想分开看日志时）

三个终端，都在仓库根目录：

```powershell
# 终端 1：数据库
node "$env:LOCALAPPDATA\workmesh-pg\start-pg.mjs"

# 终端 2：API（http://127.0.0.1:3000，Swagger 在 /api/docs）
pnpm --filter @workmesh/api dev

# 终端 3：Web（http://127.0.0.1:5173）
pnpm --filter @workmesh/web dev
```

三个坑先说清楚：

- **不要用 `corepack pnpm`**。本机 corepack 报 `Cannot find matching keyid`（签名密钥过期），README 里的那套命令会直接失败。已装的 `pnpm` 就是 10.28.2，和 `packageManager` 一致，直接用。
- **不要用根目录的 `pnpm dev`**。它是 `turbo run dev`，会把 `cli` / `shared` / `ui` 的 watch 一起拉起来，CLI 那个 watch 纯噪音。本地只要 api + web，脚本里就是这么做的。
- 本地配置样例见 [`apps/api/.env.example`](../apps/api/.env.example)；首次运行前据此创建 `apps/api/.env`，设置匹配本机 PostgreSQL 的 `WORKMESH_V1_DATABASE_URL`，并保留 `WORKMESH_COOKIE_MODE=LOCAL_INSECURE`（只允许 loopback + HTTP 的本地开发模式）。已有个人 `.env` 时不要直接覆盖。
- `apps/api` 的 `dev` 带了 `predev`（先 `prisma generate`），所以第一次启动会多几秒；这是为了防止切分支后 Prisma Client 与 schema 不一致。
- API 使用 `@nestjs/config`，已有进程环境变量优先于 `.env`。修改端口时须同步启动脚本的端口检查、Web 代理与 Origin 配置；本地一键脚本默认按 API 3000、Web 5173 检查。

## 4. 界面里有什么

左侧导航 11 项，按组：

| 分组 | 页面                      | 一句话                                                  |
| ---- | ------------------------- | ------------------------------------------------------- |
| 日常 | 工作台 `/`                | 跨项目待办数字：待签字 / 待审批 / 待确认变更 / 可开工   |
| 日常 | 需求 `/requirements`      | 需求列表，点进去是详情：流程实例、任务、工件、评审      |
| 日常 | 评审 `/reviews`           | 槽位、摘要、版本；批准 / 返修 / 撤销都在这里            |
| 交付 | 项目 `/projects`          | 建项目、仓库登记、归档                                  |
| 交付 | 看板 `/board`             | 只读的任务与交付状态                                    |
| 交付 | 知识库 `/knowledge`       | BUSINESS / SYSTEM / PRACTICE 三类知识库，候选文档与发布 |
| 交付 | PRD `/prd`                | PRD 候选、返修、撤销发布                                |
| 管理 | 流程 `/workflows`         | 流程定义校验、发布、版本基线                            |
| 管理 | 角色/ACL `/roles`         | 成员、业务角色、知识库访问集合                          |
| 管理 | 设备授权 `/authorization` | CLI 设备授权批准（Agent 登录用）                        |
| 账号 | 用户中心 `/profile`       | 当前会话与 Agent 凭据（创建/吊销）                      |

导入 YFF 数据后，可以用下面这条路径体验完整页面；仅运行最小首跑时，使用 `first-run-demo.mjs` 打印的账号和项目查看相应流程、交付和评审：

1. 导入 YFF 数据时用 `owner@yesgoo.local` 登录，工作台会显示 6 件待办（3 条评审、1 条变更、2 个可开工）；只跑 `first-run-demo.mjs` 时，使用脚本打印的账号登录。
2. 进「评审」，打开任意一条 `TASK_ACCEPTANCE`（YFF 示例为 `YFF-008 成本核算 / impl-fe`），查看提交人、审批槽位、摘要与版本。
3. 点批准。会要求**再输一次密码**换成一次性确认票据——批准、撤销、发布这类高风险动作都这样，票据和动作 + 目标 + 版本 + payload 摘要绑定。前端弹窗不是多此一举。
4. 回到「需求」看同一需求：流程实例、任务版本、工件与证据卡都在。
5. 「看板」是只读视图，用来确认任务/交付状态，不会产生写操作。

数据库里已有 `YFF 易番番 ERP`：25 条需求、48 个任务、73 条评审请求，足够把上面每一步都点开。

## 5. Agent 侧（CLI）

```powershell
pnpm --filter @workmesh/cli build
pnpm workmesh --help
```

登录走设备授权（浏览器批准），凭据落在 `~/.workmesh`，可用 `--config-home` 隔离：

```powershell
pnpm workmesh --config-home .tmp\wm-home auth login --api http://127.0.0.1:3000/api/v1
```

批准发生在 Web 的「设备授权」页。之后按角色跑标准序列（`claim` → `context` → `deliver` → `review` → `changes`），细节见 [../README.md](../README.md#cli)。

`.tmp\wm-workspace` 是一次已经跑通的工作目录示例（`impl.md` + `deliver.json` + `.workmesh\` 配置），可以直接对照 manifest 格式。跨项目使用时把 `apps/cli/dist/index.js` 放进 PATH，别在业务项目里用 `pnpm --filter` 跑（它会把 cwd 切到 CLI 包目录）。

## 6. 数据在哪，怎么重置

- PostgreSQL 数据目录：`%LOCALAPPDATA%\workmesh-pg\data`（`persistent: true`，`-Stop` 或重启机器都不丢）。
- 库 `workmesh`，schema `workmesh_v1`；当前代码包含 20 项迁移。表数量会随迁移和统计口径变化，不把某个历史快照的固定数量当作兼容性承诺；已有开发库的实际进度请用 `prisma migrate status` 确认，并以目标版本的 schema/迁移检查为准。历史验收记录中的 12 项迁移对应当时的代码版本，不代表当前工作树的完整迁移集合。
- 本机没有系统 `psql`。仓库自带的客户端：`.tmp\pgclient\pgsql\bin\psql.exe`，口令 `workmesh_local`。

想回到干净库：

```powershell
$env:PGPASSWORD = 'workmesh_local'
# 1. 删 schema（表名是 PascalCase，psql 里必须加双引号）
& .\.tmp\pgclient\pgsql\bin\psql.exe -h 127.0.0.1 -U postgres -d workmesh -c 'drop schema if exists workmesh_v1 cascade'
# 2. 重建
pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma
# 3. 灌演示数据（需要 .tmp\yff-req\易番番需求 里的需求正文）
node scripts/seed-yff.mjs --phase all
```

只想要最小闭环、不灌易番番数据：`node scripts/first-run-demo.mjs`——它自己注册一个 `demo-*@workmesh.local` 账号，走完建项目 → 发布流程 → 认领 → 交付 → 人工批准，最后打印账号和项目 ID。

## 7. 从零重建（换机器）

```powershell
pnpm install
pnpm --filter @workmesh/shared build
pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma
pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-local.ps1
```

数据库有两种来源：

- **embedded-postgres（当前用法，无需装数据库）**：`%LOCALAPPDATA%\workmesh-pg` 是个独立 npm 目录，`npm i embedded-postgres` 后放一个 `start-pg.mjs`：

  ```js
  import EmbeddedPostgres from 'embedded-postgres';
  const pg = new EmbeddedPostgres({
    databaseDir: 'C:/Users/<you>/AppData/Local/workmesh-pg/data',
    user: 'postgres',
    password: 'workmesh_local',
    port: 5432,
    persistent: true,
    autoRehydrateSymlinks: true,
  });
  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('workmesh');
  } catch {}
  setInterval(() => {}, 60_000); // 保持父进程存活
  ```

- **系统 / Docker 的 PostgreSQL 15+**：起好库之后只改 `apps/api/.env` 的 `WORKMESH_V1_DATABASE_URL`，脚本检测到 5432 已监听就不会再启 embedded 实例。

## 8. 常见问题

| 现象                                                             | 原因与处理                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `corepack` 报 `Cannot find matching keyid`                       | corepack 签名校验坏了；直接用 `pnpm`，版本已对齐                                                      |
| 登录页或批准时 `429 请求过于频繁`                                | 固定窗口限流（登录、确认票据都计数）。等窗口过去；开发时可 `delete from workmesh_v1."AuthRateWindow"` |
| 登录成功但立刻跳回登录页                                         | 用了 `localhost` 而不是 `127.0.0.1`，Cookie/Origin 不匹配                                             |
| API 起不来 / `EADDRINUSE`                                        | 看 `.tmp\dev-logs\api.log`；先 `-Stop`，确需换端口就改 `apps/api/.env` 的 `PORT` 并同步 Origin 白名单 |
| API 一启动就退出，日志 `内置角色包 … 内容发生变化但版本号未提升` | dev 库的内置角色包是旧构建登记的；见下面的「内置角色包摘要冲突」                                      |
| `/api/health` 通但页面报错                                       | 前端在 `5173`，代理到 `3000`；确认 Vite 代理那段没被改动                                              |
| `prisma` 生成物缺失（类型全红）                                  | `pnpm db:generate`                                                                                    |
| 中文日志乱码                                                     | 重定向日志的编码混排，不影响功能；以页面和接口返回为准                                                |
| `-Stop` 后端口还占着                                             | 旧版本只杀 pnpm 壳；当前版本按进程树 + 端口上的 node 收网，且跳过系统 pid（<= 4）                     |

### Windows 上 Prisma Client 生成失败

如果 `prisma generate`、`pnpm test`、`pnpm type-check` 或 `pnpm build` 报 `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`，检查是否有正在使用同一生成目录的 API、开发监视进程或 Prisma Studio。Windows 可能不允许替换正在加载的引擎文件。确认这些进程属于当前开发环境且可以停止后，停止它们，再重新执行原命令；不要删除数据库或跳过客户端生成来掩盖错误。其他原因也可能导致 `EPERM`，若停止相关进程后仍失败，应保留完整报错并继续排查权限或文件占用。

### 内置角色包摘要冲突

API 启动时 `V1BuiltinRolePackageSeeder` 会拿 `packages/role-packages` **当前构建**的 manifest 摘要，和库里 `workmesh_v1."RolePackageVersion"`（`projectId IS NULL`）比对：同 packageId + version 摘要不同就直接抛错，宁可起不来也不悄悄替换已锁定的字节。

本机已经踩过一次：`backend` / `frontend` 在库里是按 1.0 格式登记的，仓库升到 manifest 1.1 后版本号仍是 `1.1.0`，重建 `dist` 后摘要对不上。两种处理：

1. **不在乎本地数据**：按第 6 节 drop schema 重建，最干净。
2. **想保留数据**：把仍引用旧内容的那两行改标成它真实的历史版本号（它们确实是 1.0 格式），让 seeder 补登新的 `1.1.0`。写个 sql 文件再执行，避免引号在 PowerShell 里被吞：

```sql
-- .tmp/role-package-relabel.sql
begin;
update workmesh_v1."RolePackageVersion"
  set "version" = '1.0.0'
  where "projectId" is null
    and "packageId" in ('workmesh.role.backend', 'workmesh.role.frontend')
    and "version" = '1.1.0';
commit;
```

```powershell
$env:PGPASSWORD = 'workmesh_local'
& .\.tmp\pgclient\pgsql\bin\psql.exe -h 127.0.0.1 -U postgres -d workmesh -f .tmp\role-package-relabel.sql
powershell -NoProfile -File scripts\dev-local.ps1   # 启动时会打印「新增 N，已存在 M」
```

长期做法是给改过内容的角色包升 SemVer 再登记（错误信息说的就是这个），别指望本地库能自动追上构建产物。

提交前想自检，跑 README「验证」那一节；数据库相关的集成测试要单独确认目标库，别指向这份本地库。
