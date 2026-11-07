# 开始使用 WorkMesh

这份指南面向业务项目开发者、评审者、试用团队和 WorkMesh 维护者。已经有团队平台时，从项目接入开始；需要搭建或修改 WorkMesh 时，再使用本文后面的本机开发、迁移和演示步骤。

## 先确认支持边界

阅读 [支持矩阵](support-matrix.md) 了解已验证的平台、运行时版本和发布制品。当前完整的本机 Box 安装、启动、备份和恢复证据来自 Windows；Linux 和 macOS 的 CLI 有 CI smoke，但 Box 安装和运维仍待平台验收。

## 业务开发者：接入已有平台

登录团队提供的 WorkMesh，选择项目并打开「工作区」页面（`/workspace`）。从页面取得接入码、实际平台 API 地址和对应 Shell 的单行命令，在自己的业务代码目录接入。项目负责人需要先发布工作区定义，才可以生成接入码。

`workspace init` 默认只预览，确认后在原命令末尾加 `--apply` 才消费接入码并进入浏览器设备授权。不要自行拼项目 UUID、源码里的角色包路径或旧开发端口。CLI 使用发行包内置角色资源，正常选择 `--role frontend` 等角色无需填写 `--package`。

完整步骤、Windows PowerShell/Git Bash 路径示例、`doctor` 预检、v1 迁移和中断恢复见 [业务项目接入 CLI](cli-onboarding.md)。评审者可直接在 Web 查看需求、证据和评审，无需先安装 CLI 或在本机启动数据库。

## WorkMesh 维护者：本机启动（Windows）

下面保留源码开发和本地演示的完整步骤，供需要运行或修改 WorkMesh 平台的人使用。业务项目开发者接入已有平台时，无需执行这些构建、数据库迁移或演示脚本。

需要 Node.js 20.19.0 或更新版本、pnpm 10.28.2，以及可用的 PostgreSQL 15+。仓库提供 `.nvmrc` 和根目录 `packageManager`，可用它们对齐版本。

```powershell
pnpm install --frozen-lockfile
pnpm --filter @workmesh/shared build
pnpm --filter @workmesh/role-packages build
```

API 依赖这两个 workspace 包的构建产物；全新 checkout 不能跳过构建。首次运行还要配置 API 数据库连接并应用当前全部迁移。`dev:local` 会启动 PostgreSQL、API 和 Web，但**不会替你执行 Prisma 迁移**；未迁移的数据库可能导致 API 健康检查失败。

若 `apps/api/.env` 不存在，先复制本地配置样例；已有文件时不要覆盖。然后编辑 `WORKMESH_V1_DATABASE_URL`，使它的用户名、密码、端口和数据库与下方选定的本地 PostgreSQL 相匹配：

```powershell
if (-not (Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
```

如果使用仓库文档中的 embedded PostgreSQL，在一个单独的 PowerShell 窗口先启动它（已有 PostgreSQL 15+ 实例时跳过这一步）：

```powershell
node "$env:LOCALAPPDATA\workmesh-pg\start-pg.mjs"
```

如果该文件不存在，请先按[本地运行的从零重建说明](local-dev.md#7-从零重建换机器)安装 embedded PostgreSQL，或改用自己管理的 PostgreSQL 实例。然后在仓库根目录执行：

```powershell
# 使用 embedded PostgreSQL 时，连接串应类似：
# postgresql://postgres:workmesh_local@127.0.0.1:5432/workmesh?schema=workmesh_v1
pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma
pnpm dev:local
```

`dev:local` 看到已经监听的 PostgreSQL 会跳过启动；也可以先运行 `pnpm dev:local:check` 只检查环境。打开 `http://127.0.0.1:5173`，不要把本地 Origin 改成 `localhost`；Cookie 和 Origin 校验按精确地址配置。迁移、演示脚本和重置命令只应指向自己的隔离数据库，不要指向生产或共享团队数据库。

如果要了解每个页面、演示数据和重置方式，继续阅读 [本地运行](local-dev.md)。服务器部署请改读 [部署说明](deployment.md)，不要把本地 `LOCAL_INSECURE` 配置用于生产。

若要在隔离的本地数据库上演练一条最小 API QA 交付与人工批准链路，可在 API 已启动、迁移已应用且 `packages/shared` 已构建后运行：

```bash
pnpm --filter @workmesh/shared build
node scripts/first-run-demo.mjs
```

脚本默认连接 `http://127.0.0.1:3000`，也可用 `WORKMESH_API` 和 `WORKMESH_ORIGIN` 指定本机服务地址。它会注册演示账号并在目标数据库中创建项目、需求、流程、任务、工件和评审记录；数据不会自动清理，所以只应指向自己的本地/隔离环境，不要指向生产或共享团队数据库。它通过官方 `/api/v1` 路径发布 Understanding、PRD 和接口说明，用同一个人工会话提交 QA 的 CASES，并经密码确认票据批准，最后重新读取持久状态确认 QA 任务完成和认领释放。实现任务仍未完成，发布任务继续等待前置；输出会明确这两个状态。占位仓库采用 DECLARED 身份与 `.invalid` 地址，不代表真实 provider 验证。该演练不会代替浏览器操作、Agent/CLI 设备授权、实现代码证据、发布签字或变更传播验收。脚本结束时会打印新账号和项目 ID。当前改版尚缺单独实跑证据，详见[当前验证状态](phase-status.md)。

## 跑通 CLI 最小路径

使用已有平台的业务开发者按 [CLI 接入指南](cli-onboarding.md) 操作。从源码维护 CLI 时，在 WorkMesh 仓库先构建共享契约和 CLI：

```bash
pnpm --filter @workmesh/shared build
pnpm --filter @workmesh/cli build
pnpm workmesh --help
```

接入仍使用项目「工作区」页生成的 `workspace init` 单行命令；先预览，再以 `--apply` 进入设备授权。`setup` 用于安装或更新角色资源，也保留兼容初始化路径；已有 v1 配置先迁移。绑定和状态检查完成后，再按 `claim` → `context` → `deliver` → `review` → `changes` 工作。`review` 只创建人工评审请求，批准、返修、撤销和发布仍在 Web 会话中完成。

完整命令示例见根目录 [README 的 CLI 章节](../README.md#cli)，接口和权限约定见 [API 清单](api.md)。

## 验证你改动的最小集合

提交前至少运行受影响包的测试和构建；完整仓库门禁见 [贡献指南](../CONTRIBUTING.md)：

```bash
pnpm format:check
pnpm lint:eslint
pnpm type-check
pnpm test
pnpm build
```

涉及数据库的测试必须使用显式隔离库。不要把迁移、清理或恢复命令指向个人开发库。

## 下一步

- 了解服务端配置、迁移、反向代理和生产边界：[部署说明](deployment.md)。
- 查看当前实现、证据等级和未完成验收：[交付与验证状态](phase-status.md)。
- 参与代码、文档或测试：[贡献指南](../CONTRIBUTING.md)。
- 了解维护、决策和交接：[治理说明](../GOVERNANCE.md) 与 [维护者](../MAINTAINERS.md)。
- 查找提问、功能提案、issue 分流、路线图和版本兼容口径：[社区入口](community/README.md)。
- 准备版本和制品：[发布与升级验收](releasing.md)。
