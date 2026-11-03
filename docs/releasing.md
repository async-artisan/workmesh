# 发布与升级验收

当前改动处于未发布状态。仓库中的 `1.0.0` 字段不代表已经存在可用的正式发布。本地测试不能代替待发布 commit 的 GitHub Actions 结果。

## 发布前必须通过

1. 锁定待发布 commit 和版本号，工作区没有未提交变更。预发布使用 SemVer 的 `-rc.N` 等标识，同步所有包与变更记录。
2. 执行 `pnpm install --frozen-lockfile`、格式、ESLint、类型检查、全量单元测试、契约检查、生产构建。
3. 在显式隔离数据库应用全部迁移，检查漂移，执行 `pnpm test:e2e` 和 `pnpm --filter @workmesh/api test:coverage`。API 行覆盖率必须实际达到 80%，不得降低阈值或删除业务源码来通过。
4. 安装测试浏览器后执行 `pnpm test:browser`。测试会启动专用端口 55442/55443，不复用开发服务或用户浏览器；测试目标必须经过 `WORKMESH_TEST_DATABASE_URL` 门禁。
5. 保存生产依赖和完整依赖审计结果；逐项评估开发依赖遗留公告。生成版本说明时明确尚未验证的平台、外部接口与风险。
6. 对隔离数据库完成备份、恢复到新库、表和数据核对。生产升级仍需独立的备份与恢复窗口；测试库演练不能授权生产操作。
7. 对最终安装包完成新机安装、启动、升级及卸载验收，并核对包内没有 `.env`、数据库内容、个人工作目录或凭据。生成每个制品的 SHA-256 清单，与制品一并发布；记录来源 commit 和构建环境。
8. 确认私密安全报告入口、发布责任人、回滚责任人与真实团队验收证据，再由维护者实际创建 tag 和发布。当前没有自动发布到 npm 或 GitHub Release 的流程。

## 本次兼容性变化

- Nest 升级至 11，前端 Router 升级至 7，测试工具升级至 Vitest 4，Vite 升级至 6。开发与 CI 建议使用 Node.js 20.19 或更新的兼容版本，并固定 pnpm 10.28.2。
- API 测试配置使用 `.mts`，以显式 ESM 加载；单元、集成及覆盖率统一发射 Nest 装饰器元数据。推荐使用包内脚本，不复制旧的 `.ts` 配置文件名。
- `SECURE` Cookie 模式启动时要求 HTTPS 公共 Origin；`LOCAL_INSECURE` 只允许 HTTP loopback。模板显式配置本地模式，正式部署应覆盖。
- 新增 `RATE_LIMIT_BUCKETS`，默认 10000，限制进程内 IP 桶数量。`RATE_LIMIT_MAX`、桶数必须为正整数。多实例部署需要在上游配置共享限流，进程内限制不能作为全局配额。
- 代码证据票据准备要求 `WORKMESH_TICKET_ENCRYPTION_KEY`，值为单独生成的随机 32 字节密钥的 64 位十六进制编码。应通过部署密钥管理注入，不使用 webhook 密钥，也不写入数据库或版本控制。缺失时此准备入口返回 503，其余接口不因此停用。
- 所有实例使用相同的票据加密密钥并通过安全备份保存。票据秘密使用 AES-256-GCM，并绑定项目、主体、票据和请求摘要。更换或丢失密钥会使旧重放记录无法解密；旧明文记录和解密失败返回 `CODE_EVIDENCE_TICKET_REPREPARE_REQUIRED`，客户端应使用新的幂等键重新准备。旧版本遗留明文仍需按保留策略清理，备份也应受访问控制。
- 票据按项目和有效期进行条件消费，并发只有一次成功；过期或已消费返回冲突。旧工件 generation 和其他项目的批准证据不能用于准备新票据。

## 外部 GitHub 验证

`pnpm test:github-live` 仅在显式设置 `WORKMESH_GITHUB_LIVE=1` 时请求 GitHub；同时指定获准测试的 `WORKMESH_GITHUB_TEST_REPOSITORY=owner/repository` 和正整数 `WORKMESH_GITHUB_TEST_PR`。私有仓库通过 `WORKMESH_GITHUB_TEST_TOKEN` 提供只读权限。先构建 API。

入口读取真实仓库、PR 和完整分页 reviews，调用生产证据归一化器，并在读取前后校验 PR 未变化。可设置 `WORKMESH_GITHUB_EXPECT_DECISION=VALID|INVALID|UNKNOWN` 断言预期。没有预期时只证明读取和归一化成功，不代表证据满足发布条件。此入口不创建 PR、不提交代码、不触发 webhook；真实 webhook 投递、签名及发布链路仍需独立联调。

## 当前发布结论

本地 API 行覆盖率门禁已通过，实测数字与验证边界见 [工程整改验证](testing/remediation-verification-2026-11-03.md)。发布门禁尚未全部满足：最终 commit 的远端 CI、外部 GitHub、跨平台安装、性能容量和真实团队验收仍需证据，不应把本轮改动描述为正式发布或全部完成。
