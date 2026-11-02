# Deployment

WorkMesh 使用 Node.js 20+、pnpm 10.28.2（`corepack pnpm`）与 PostgreSQL 15+。PostgreSQL 是外部依赖，必须显式选择目标；构建与测试不会创建或修改共享数据库。

## 配置

数据库连接串只来自 `WORKMESH_V1_DATABASE_URL`，领域代码不读取隐式数据源，也不提供旧连接变量回退。

| 变量 | 作用 |
| --- | --- |
| `WORKMESH_V1_DATABASE_URL` | 正式 PostgreSQL 连接串（`workmesh_v1` schema）。 |
| `WORKMESH_TEST_DATABASE_URL` | 隔离测试库连接串；仅在显式确认后由 `scripts/test-integration.sh` 使用。 |
| `WORKMESH_COOKIE_MODE` | `SECURE`（默认，要求 HTTPS 与 `__Host-` Cookie）或 `LOCAL_INSECURE`（仅 loopback HTTP 开发）。 |
| `WORKMESH_PUBLIC_ORIGIN` | Web 公共源；用于 Origin 精确匹配与 Cookie 部署校验。 |
| `WEB_ORIGIN` | CORS 允许源，默认 `http://127.0.0.1:5173`。 |
| `RATE_LIMIT_MAX` | 每 IP 每分钟请求上限，默认 120。 |
| `PORT` | API 端口，默认 3000。 |
| `REDIS_URL` | 可选；未设置时缓存直通，不影响正确性。 |

`WORKMESH_COOKIE_MODE=SECURE` 必须配合 HTTPS；`LOCAL_INSECURE` 只允许 loopback 且必须为 HTTP，不会根据 Host/Origin/Forwarded 头自动降级。

## 步骤

1. `corepack pnpm install --frozen-lockfile`。
2. `corepack pnpm --filter @workmesh/shared build`，然后 `corepack pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma`。
3. 用 `bash scripts/db-check.sh` 确认 `WORKMESH_V1_DATABASE_URL` 指向预期库，用 `bash scripts/db-plan.sh` 审阅 SQL 计划。
4. 数据库目标与回滚方式确认后，才执行 `corepack pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma`。仓库只有一份正式初始迁移 `0001_init`。
5. `bash scripts/verify.sh`；若设置了 `WORKMESH_TEST_DATABASE_URL`，先 `bash scripts/test-integration.sh`（默认只读，`--apply-migrations` 需单独确认）。
6. `corepack pnpm build`；从 `apps/api/dist/main.js` 启动 API，`apps/web/dist` 由 TLS 反向代理托管，并由受信代理保留真实客户端 IP 策略。

首个管理员通过 `POST /api/v1/auth/register` 创建，不存在种子脚本或默认密码。凭据、连接串与令牌只经部署密钥管理注入，不进入 Git；迁移前备份 PostgreSQL。
