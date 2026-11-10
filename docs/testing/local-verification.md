# 完整本地验证

`pnpm verify` 是贡献者和 CI 共用的完整本地质量入口，使用 Node.js 20.19+ 与根目录固定的 pnpm 10.28.2。运行前先完成 `pnpm install --frozen-lockfile`，准备专用 PostgreSQL 测试库，并安装 Chromium：`pnpm exec playwright install chromium --only-shell`。Linux CI 的系统依赖由工作流单独安装，验证入口不会安装浏览器、启动 PostgreSQL 或创建数据库。

## 选择隔离目标

该命令会在指定库中创建、更新和删除测试夹具。请由测试环境负责人先准备专用库；不能使用工作库、生产库、个人开发数据所在库或含有需要保留的数据的库。数据库名必须以 `workmesh_test_` 开头、连接到 loopback，并使用 `schema=workmesh_v1`。

以下 PowerShell 示例假设本机已经有专用 PostgreSQL 实例，用户 `test_runner` 已获准访问端口 5432 上的 `workmesh_test_local`。它只展示变量格式，不会创建数据库或用户：

```powershell
$env:WORKMESH_TEST_ENV = 'local'
$env:WORKMESH_TEST_DATABASE_USERS = 'test_runner'
$env:WORKMESH_TEST_DATABASE_URL = 'postgresql://test_runner@127.0.0.1:5432/workmesh_test_local?schema=workmesh_v1'
pnpm verify
```

Bash 使用同样的变量：

```bash
export WORKMESH_TEST_ENV=local
export WORKMESH_TEST_DATABASE_USERS=test_runner
export WORKMESH_TEST_DATABASE_URL='postgresql://test_runner@127.0.0.1:5432/workmesh_test_local?schema=workmesh_v1'
pnpm verify
```

`local` 模式不允许 URL 携带密码；使用本机已配置的测试身份。密码认证的隔离 CI 环境应显式使用 `WORKMESH_TEST_ENV=ci`，通过密钥配置注入连接串，不能提交或粘贴到公开日志。`DATABASE_URL` 不能与测试 URL 相同；入口不会从它或 `WORKMESH_V1_DATABASE_URL` 推导测试目标。

入口先构建 shared，再验证目标配置、生成正式 Prisma Client，并执行只读身份探针，核对实际数据库、用户、schema 和服务器地址。默认要求 schema 已存在；配置缺失、身份不符、连接失败或检查失败均停止。首次对已经准备好的专用空库应用仓库迁移时，明确使用：

```bash
pnpm verify -- --apply-migrations
```

该选项只允许在目标配置和实际连接身份核验通过后应用迁移，不会创建、删除或重置数据库。已有迁移不匹配或漂移时保留失败结果，按正式迁移流程修正；不能用 `db push` 掩盖差异。

## 检查范围与结果

完整入口依次执行格式、无缓存 lint/类型/单元测试、脚本防护回归、隔离 Prisma、运行时契约、隔离数据库集成及迁移漂移、无缓存构建、shared/CLI/Web bundle 证据校验、真实 Chromium 流程、使用夹具 API 的 UI review，以及 API 完整覆盖率。任何步骤失败都会非零退出；没有跳过数据库、浏览器或覆盖率的成功模式。`pnpm verify --help` 只显示帮助，不运行门禁。Bash 的 `scripts/verify.sh` 仅转发到同一个 Node 入口。

浏览器测试需要空闲 loopback 端口 55442、55443；UI review 默认使用 55444，可通过 `WORKMESH_UI_REVIEW_PORT` 指定另一个有效端口。UI review 使用 `--strictPort` 且不复用已存在服务；端口被占用时会失败，入口不会停止你的开发服务。

脚本逐项输出结构化状态。只有全部本地门禁成功才输出 `LOCAL_QUALITY_PASSED`。结果仍可能包含各套件显式声明的可选外部集成跳过，例如真实 Ollama POC；记录时必须保留其名称与范围。这个状态证明本次源码及环境的本地质量检查，发布仍需同一干净 commit 的远端 CI、平台验证、实际制品、升级恢复和维护者批准。真实 GitHub PR/Webhook、外部团队、生产容量/RTO/RPO、跨浏览器及无障碍人工验收均需独立证据；本入口不会调用真实 GitHub、模型或发布服务。
