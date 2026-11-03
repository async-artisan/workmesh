# Deployment

WorkMesh 使用 Node.js 20+、pnpm 10.28.2（`corepack pnpm`）与 PostgreSQL 15+。PostgreSQL 是外部依赖，必须显式选择目标；构建与测试不会创建或修改共享数据库。

## 配置

数据库连接串只来自 `WORKMESH_V1_DATABASE_URL`，领域代码不读取隐式数据源，也不提供旧连接变量回退。

| 变量                             | 作用                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `WORKMESH_V1_DATABASE_URL`       | 正式 PostgreSQL 连接串（`workmesh_v1` schema）。                                               |
| `WORKMESH_TEST_DATABASE_URL`     | 隔离测试库连接串；仅在显式确认后由 `scripts/test-integration.sh` 使用。                        |
| `WORKMESH_COOKIE_MODE`           | `SECURE`（默认，要求 HTTPS 与 `__Host-` Cookie）或 `LOCAL_INSECURE`（仅 loopback HTTP 开发）。 |
| `WORKMESH_PUBLIC_ORIGIN`         | Web 公共源；用于 Origin 精确匹配与 Cookie 部署校验。                                           |
| `WEB_ORIGIN`                     | CORS 允许源，默认 `http://127.0.0.1:5173`。                                                    |
| `RATE_LIMIT_MAX`                 | 每 IP 每分钟请求上限，默认 120。                                                               |
| `RATE_LIMIT_BUCKETS`             | 进程内 IP 限流桶容量，默认 10000；多实例需要上游共享限流。                                     |
| `TRUSTED_PROXY_IPS`              | 受控反向代理地址列表；默认不信任转发 IP。                                                      |
| `GITHUB_WEBHOOK_SECRET`          | GitHub webhook 签名密钥，缺失时拒绝 webhook。                                                  |
| `WORKMESH_TICKET_ENCRYPTION_KEY` | 代码证据票据准备所需独立 32 字节随机密钥的十六进制编码；见发布升级说明。                       |
| `PORT`                           | API 端口，默认 3000。                                                                          |
| `WORKMESH_SMTP_URL`              | 可选；SMTP 连接串（如 `smtp://user:pass@host:587`），用于手动“邮件摘要”。                      |
| `WORKMESH_EMAIL_FROM`            | 可选；邮件发件人，默认 `no-reply@workmesh.local`。                                             |

`WORKMESH_COOKIE_MODE=SECURE` 必须配合 HTTPS；`LOCAL_INSECURE` 只允许 loopback 且必须为 HTTP，不会根据 Host/Origin/Forwarded 头自动降级。

邮件摘要只在用户点击通知中心的“发送邮件摘要”时触发，发送到当前登录账号；未配置 `WORKMESH_SMTP_URL` 时接口返回 `503 EMAIL_NOT_CONFIGURED`。它不是定时提醒，定时发送需要外部 cron 调用同一接口或后续的发送任务。

## 步骤

1. `corepack pnpm install --frozen-lockfile`。
2. `corepack pnpm --filter @workmesh/shared build`，然后 `corepack pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma`。
3. 用 `bash scripts/db-check.sh` 确认 `WORKMESH_V1_DATABASE_URL` 指向预期库，用 `bash scripts/db-plan.sh` 审阅 SQL 计划。
4. 数据库目标与回滚方式确认后，才执行 `corepack pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma`。仓库目前包含 `0001_init` 至 `0012_invitations` 共 12 项正式迁移，按顺序应用。Windows 隔离库实测见 [2026-11-03 验收报告](testing/team-acceptance-2026-11-03.md)。
5. `bash scripts/verify.sh`；若设置了 `WORKMESH_TEST_DATABASE_URL`，先 `bash scripts/test-integration.sh`（默认只读，`--apply-migrations` 需单独确认）。
6. `corepack pnpm build`；从 `apps/api/dist/main.js` 启动 API，`apps/web/dist` 由 TLS 反向代理托管，并由受信代理保留真实客户端 IP 策略。

首个管理员通过 `POST /api/v1/auth/register` 创建，不存在种子脚本或默认密码。凭据、连接串与令牌只经部署密钥管理注入，不进入 Git；迁移前备份 PostgreSQL。
