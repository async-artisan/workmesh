# 注册与登录共享 IP 限流验证：2026-11-07

注册与登录现在共同使用每 IP、每 15 分钟 30 次尝试的预算，通用账户限流和 CLI 设备授权限流返回固定窗口实际剩余秒数。Node.js 24.22.1 下，认证目录 117 项、全 API 单元 713 项通过；根集成入口在专属 PostgreSQL 17.11 空库应用全部 20 项迁移，172 项通过、1 项真实 Ollama POC 跳过。这是 `739367a714097a825b96ca7ecf6bce3372855a77` 加未提交改动的本机源码证据，不能替代最终候选 SHA 或不同源码的 ZIP 验收。

## 计数与升级兼容

[身份与权限契约](../superpowers/plans/workmesh-technical-v1/01-identity-permissions.md)要求注册与登录共享 IP 尝试额度。[账户服务](../../apps/api/src/auth/v1-account.service.ts)的两个入口均写入既有 `login-ip`；IP 键沿用 SHA256，不新增 kind 或清除旧计数。成功、失败和被 IP 门禁拒绝的尝试均继续计数。登录邮箱仍按失败预算预约并在成功后退还自身原窗口额度，见[登录邮箱验证](login-rate-limit-validation-2026-11-07.md)。

[Prisma repository](../../apps/api/src/auth/v1-auth.prisma-repository.ts)以单条 SQL 原子递增 canonical 行，同时加上同 key、同窗口遗留的 `register-ip` 次数。它不修改或重复迁入旧行，也不把其他 IP、kind 或旧窗口计入本窗口。新版节点并发写同一 canonical 行，因此共享剩余额度；计数存储异常中止账户操作。429 的 `window` 统一为 `login-ip`。无需 schema 迁移。

遗留读取采用 SQL 语句开始时的快照；等待 canonical 行锁不会刷新这个快照。旧进程仍可能分开放行，不能保证混合版本全局严格 30 次。部署时应暂停旧版本认证写入、排空在途请求后全量切换；保留既有窗口至其自然到期。测试证明新节点保留静态旧预算并读取之后已提交的旧记录，不证明旧节点遵守新共享上限。

账户通用限流及 [CLI 授权服务](../../apps/api/src/auth/v1-cli-authorization.service.ts)按 `ceil((windowMs - now % windowMs) / 1000)` 返回剩余秒数，覆盖 10 分钟与 15 分钟窗口；最后 1 毫秒返回 1 秒，窗口起点返回完整窗口。密码二验和登录邮箱继续保持已有准确冷却语义。

## 验证

- [IP 单元回归](../../apps/api/src/auth/v1-auth-ip-rate-limit.spec.ts)新增 15 项；CLI 授权单测新增 10 项。认证目录 14 个文件、117 项通过，全 API 单元 80 个文件、713 项通过。类型、ESLint 和定向 Prettier 检查通过。
- [共享 IP 数据库回归](../../apps/api/test/v1-auth-shared-ip.database.spec.ts)新增 5 项：真实注册、15 次成功登录和 14 次重复注册累计 30；40 个混合并发请求只有 30 个通过 IP 门禁；旧预算保留；后续已提交的旧记录可见；最后 1 秒和跨窗恢复。使用实际 service、Prisma 和 bcrypt。
- [repository 数据库回归](../../apps/api/test/v1-auth-rate-limit.database.spec.ts)新增 8 项，现共 12 项，包括旧 29 次下 24 并发只有一次获准、同 key/同窗口匹配、其他 kind 隔离和 10/15 分钟冷却边界。既有五项登录数据库测试保持通过。
- 根 `pnpm test:integration -- --apply-migrations` 在 `workmesh_test_shared_ip_20261107_r2?schema=workmesh_v1` 上通过门禁，应用全部 20 项迁移，20 个文件通过、1 个跳过，172 passed / 1 skipped。唯一跳过项为需要显式启用的真实 Ollama POC。

所有新数据库夹具使用唯一用户、邮箱、IP、会话和窗口，按本套件标识清理。测试前后 SQL 核对 loopback 58390、用户、准确数据库和 DataDir；迁移元数据在 `workmesh_v1` 中共 20 项。结束后核验 PID、可执行文件、命令行、pg_ctl status 和 listener 身份，仅停止自有 PostgreSQL；PID 文件消失，58390 已释放。

## 本地证据与限制

证据目录为本机 `G:/workmesh-shared-ip-validation-20261107-r1`，不是公开或已提交资产。

| 文件                            | SHA256                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| `api-unit.log`                  | `3e51e7e04caba0426337957132a9de4102218d4d16ce36a1b43ae6e91b96f3b8` |
| `integration-migrations-r2.log` | `17aa9c203219b80db018db5801826e149cbb96c7c716f932572e74ebe4dc4d10` |

`database-identity.json`、`pg-start.*.log`、`pg-stop.*.log` 和 `cleanup-summary.json` 保留身份与停止证据。最初根入口因 URL 未带 schema 参数被门禁拒绝；早期手动迁移将迁移元数据放在 public，另一个尝试虽有 172 项测试通过，未用作最终迁移入口证据。以上失败与诊断日志保留，最终结果来自全新 `_r2` 空库与正确 URL，不修改失败记录。

旧 Box ZIP `ff80618f…` 早于共享 IP 修复，只证明它自身的生命周期。后续已生成包含此修复的新 Box `029bbab6…`，同包安装恢复与模块证据通过，见[bundle 制品验证](bundle-evidence-validation-2026-11-07.md)。最终 clean SHA、远端 CI、生产、多版本滚动严格限额、完整浏览器链和外部团队证据仍不能由本机测试替代。
