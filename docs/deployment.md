# Deployment

WorkMesh 使用 Node.js 20.19+、pnpm 10.28.2 与 PostgreSQL 15+。PostgreSQL 是外部依赖，必须显式选择目标；构建与测试不会创建或修改共享数据库。仓库已通过 `packageManager` 固定 pnpm 版本，文档命令直接使用 `pnpm`；如果团队用 Corepack 管理 pnpm，可在本机启用后执行同样的命令。

## 配置

数据库连接串只来自 `WORKMESH_V1_DATABASE_URL`，领域代码不读取隐式数据源，也不提供旧连接变量回退。

| 变量                             | 作用                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `WORKMESH_V1_DATABASE_URL`       | 正式 PostgreSQL 连接串（`workmesh_v1` schema）。                                                                     |
| `WORKMESH_TEST_DATABASE_URL`     | 隔离测试库连接串；仅在显式确认后由 `pnpm test:integration` 使用。                                                    |
| `WORKMESH_COOKIE_MODE`           | `SECURE`（默认，要求 HTTPS 与 `__Host-` Cookie）或 `LOCAL_INSECURE`（仅 loopback HTTP 开发）。                       |
| `WORKMESH_PUBLIC_ORIGIN`         | Web 公共源；用于 Origin 精确匹配与 Cookie 部署校验。                                                                 |
| `WEB_ORIGIN`                     | CORS 允许源，默认 `http://127.0.0.1:5173`。                                                                          |
| `RATE_LIMIT_MAX`                 | 每 IP 每分钟请求上限，默认 120。                                                                                     |
| `RATE_LIMIT_BUCKETS`             | 进程内 IP 限流桶容量，默认 10000；**多实例需配置 `REDIS_URL`**（见下方）。                                           |
| `REDIS_URL`                      | 可选；Redis 连接串（如 `redis://:password@host:6379/0`），配置后启用跨实例共享限流，未配置时降级为进程内单实例限流。 |
| `TRUSTED_PROXY_IPS`              | 受控反向代理地址列表；默认不信任转发 IP。                                                                            |
| `GITHUB_WEBHOOK_SECRET`          | GitHub webhook 签名密钥，缺失时拒绝 webhook。                                                                        |
| `WORKMESH_TICKET_ENCRYPTION_KEY` | 代码证据票据准备所需独立 32 字节随机密钥的十六进制编码；见发布升级说明。                                             |
| `PORT`                           | API 端口，默认 3000。                                                                                                |
| `WORKMESH_SMTP_URL`              | 可选；SMTP 连接串（如 `smtp://user:pass@host:587`），用于手动“邮件摘要”。                                            |
| `WORKMESH_EMAIL_FROM`            | 可选；邮件发件人，默认 `no-reply@workmesh.local`。                                                                   |

`WORKMESH_COOKIE_MODE=SECURE` 必须配合 HTTPS；`LOCAL_INSECURE` 只允许 loopback 且必须为 HTTP，不会根据 Host/Origin/Forwarded 头自动降级。

Web 接入向导可在构建环境中设置 `VITE_WORKMESH_PUBLIC_API_URL`，作为管理员提供给本机 CLI 的完整公共 API 地址，例如 `https://mesh.example.com/platform/api/v1`。它可以与 `WORKMESH_PUBLIC_ORIGIN` 不同，必须包含反向代理前缀并以 `/api/v1` 结尾；不要包含账号、密码或令牌。参考 `apps/web/.env.example`。Vite 在构建时嵌入此公开值，修改后需要重新构建 Web。未配置或格式无效时，向导要求用户填写管理员确认的地址，不会从网页地址猜测 API。

邮件摘要只在用户点击通知中心的“发送邮件摘要”时触发，发送到当前登录账号；未配置 `WORKMESH_SMTP_URL` 时接口返回 `503 EMAIL_NOT_CONFIGURED`。它不是定时提醒，定时发送需要外部 cron 调用同一接口或后续的发送任务。

## 步骤

1. `pnpm install --frozen-lockfile`。
2. `pnpm --filter @workmesh/shared build`，然后 `pnpm --filter @workmesh/api exec prisma generate --schema prisma/schema.prisma`。
3. 用 `bash scripts/db-check.sh` 确认 `WORKMESH_V1_DATABASE_URL` 指向预期库，用 `bash scripts/db-plan.sh` 审阅 SQL 计划。两个数据库检查脚本目前仍是 shell 入口；Windows 可在 Git Bash/WSL 中运行，或直接使用 `workmesh-box doctor` 检查本地服务。
4. 数据库目标与回滚方式确认后，才执行 `pnpm --filter @workmesh/api exec prisma migrate deploy --schema prisma/schema.prisma`。仓库目前包含 `0001_init` 至 `0021_review_discussions` 共 21 项正式迁移，按顺序应用。历史 Windows 隔离库实测范围见 [2026-11-03 验收报告](testing/team-acceptance-2026-11-03.md)；2026-11-09 的评审问题迁移与使用者路径定向验证见[本次记录](testing/user-journey-validation-2026-11-09.md)，不能把历史制品的恢复证据扩大到新增迁移后的当前制品。
5. 开发与发布候选的完整本地检查使用 `pnpm verify`，配置见[完整本地验证](testing/local-verification.md)。该入口跨平台，必须显式选择隔离测试库，身份探针通过后才运行数据库写入测试；默认不应用迁移，首次迁移需明确传入 `pnpm verify -- --apply-migrations`。它还执行迁移漂移、格式、类型、单元、契约、构建、bundle 证据、Chromium 和覆盖率检查。`pnpm test:e2e`、`pnpm test:integration` 仍可用于定向排查，也会写入隔离测试数据。
6. `pnpm build`；从 `apps/api/dist/main.js` 启动 API，`apps/web/dist` 由 TLS 反向代理托管，并由受信代理保留真实客户端 IP 策略。

首个管理员通过 `POST /api/v1/auth/register` 创建，不存在种子脚本或默认密码。凭据、连接串与令牌只经部署密钥管理注入，不进入 Git；迁移前备份 PostgreSQL。

## 运行验收与证据范围

部署验收按下面的顺序推进，前一项通过后仍须核对后一项的实际结果：

| 层次       | 当前检查与证据                                                                                                                     | 仍需确认                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 环境配置   | `workmesh-box doctor` 检查数据库端口、PG 客户端、数据目录；运行中的 API 还检查就绪，仓库形态下比对迁移数量                         | 数据库目标与凭据正确；API 未启动时 doctor 通过不代表服务已启动                     |
| 本机服务   | `/api/health` 证明进程存活；`/api/health/ready` 检查 `SELECT 1` 和至少一项已完成迁移；Windows start 与 Box dev 以 ready 为成功条件 | 迁移数量不证明名称、校验和与完整 schema 一致；完整漂移检查仍走 `pnpm verify`       |
| 使用者访问 | 从实际使用设备访问管理员提供的公共 Web/API 地址，并实际完成登录与一次受权操作                                                      | 回环 HTTP 通过没有验证外部可达性、反向代理前缀、HTTPS/Cookie/Origin 或项目角色权限 |
| 备份恢复   | `backup --verify` 实际临时恢复并记录表数/迁移数；生命周期脚本另核对隔离测试标记                                                    | 业务内容、附件与外部对象完整性、保留策略、异地备份、RPO/RTO 和生产切换仍须单独验收 |
| 业务交付   | 项目已配置角色、知识绑定、代码仓、已发布流程；真实任务提交符合验收条件的证据，由合适角色签署                                       | 基础设施就绪与数据库恢复不能证明需求已完成或业务可发布                             |

Box 的 `status --json` 提供 `evidence` 范围字段；Windows 生命周期验证产物 schema 1.1 的 `scope` 标明回环访问与隔离结构/标记验证边界。运行新脚本才会产生这些新证据，历史验收报告保持其当时版本与测试范围。参考 [Kubernetes 的探针职责分离](https://kubernetes.io/docs/concepts/workloads/pods/probes/)与 [PostgreSQL SQL dump 恢复说明](https://www.postgresql.org/docs/16/backup-dump.html)。

## Docker Compose 本地试用

Compose 配置用于本机试用和验收，不是生产安全基线。先复制示例变量文件，再启动：

```bash
cp docker-compose.env.example .env
docker compose up --build
```

服务只绑定到本机 `127.0.0.1:5173`，默认使用 `LOCAL_INSECURE` 和示例数据库密码；请勿把该配置暴露到公网。生产部署必须改用 HTTPS、强随机数据库密码、`SECURE` Cookie、密钥管理、备份恢复演练，以及受控反向代理。

迁移由独立的 `migrate` 服务完成（`docker/migrate.mjs`），`app` 服务等待它成功退出后才启动。升级时先执行迁移再重启 app：

```bash
# 仅执行迁移（不重启 app）
docker compose run --rm migrate

# 确认迁移结果后再重启 app
docker compose restart app
```

## Docker Compose 生产拆分模式

`docker-compose.split.yml` 把 API 和 Web 拆成独立服务，适合横向扩展场景：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  -f docker-compose.split.yml \
  up --build
```

| 服务      | 进程                              | 端口         | 说明                                |
| --------- | --------------------------------- | ------------ | ----------------------------------- |
| `migrate` | `node docker/migrate.mjs`         | 无           | 一次性迁移 job，完成后退出          |
| `api`     | `node apps/api/dist/main.js`      | 3000（内部） | NestJS API，仅 Compose 内网可达     |
| `web`     | `node scripts/box/web-server.mjs` | 5173         | 静态文件 + `/api` 反代到 `api:3000` |

TLS 反代（nginx/Caddy/Traefik）应放在 `web` 服务前面，对外暴露 443，不直接暴露 `api` 的 3000 端口。多 `api` 实例时需要上游共享限流（配置 `REDIS_URL`）。
