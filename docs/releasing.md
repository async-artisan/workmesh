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
8. 确认私密安全报告入口、发布责任人、回滚责任人与**外部真实团队**验收证据，再由维护者实际创建 tag。已记录的三人隔离团队验收不替代外部团队证据。

发布负责人应把上述结果保存为可审计记录，至少包含最终 commit SHA、对应的 CI run、数据库备份/恢复记录、制品 SHA-256、SBOM 和仍未验证的支持边界。任一必需记录缺失、来自不同 commit，或发现高严重性未评估漏洞时，应停止创建 tag，直到风险被修复、接受并记录。

当前工作流生成的 `workmesh-dependencies.cdx.json` 仅是通过 `pnpm licenses list --prod` 收集的工作区生产 npm 依赖清单，并非完整制品 SBOM：它不包含打包的 Node.js、PostgreSQL，也可能遗漏部署包中保留的开发依赖或构建依赖。正式发布前须另行生成并核验覆盖实际制品的 SBOM，包括上述运行时及随包交付的依赖；不能用该清单单独满足完整制品 SBOM 门禁。

工作流还会用固定 Syft 1.57.0 分别扫描实际 Box 与独立 CLI ZIP 的解压内容，逐文件核对输入与归档，生成 Syft JSON、CycloneDX、扫描配置及 `artifact-sbom-draft.json`。只把经过路径归一化的 JSON/YAML 加入发布资产，按实际资产重算校验和；原始扫描诊断日志不公开。此结果仍标记 `DRAFT_PARTIAL_COVERAGE`：CLI/Web bundle 的模块清单、运行时内嵌组件、UNKNOWN 分类、许可证和完整 schema 校验尚未补齐。实测结果与复现方法见[制品 SBOM 验证记录](testing/artifact-sbom-validation-2026-11-07.md)。

2026-11-07 工作区生产依赖审计为零项，但完整审计仍有 2 项低危、2 项中危；本轮 Windows ZIP 实际包含其中三个包的受影响版本。尚未完成可达性核验、兼容修复或维护者风险批准，详见[依赖审计记录](security/dependency-audit-2026-11-07.md)。生产范围的零项结果不能解除实际制品的依赖处置要求。

## GitHub Release 自动化边界

推送符合 SemVer 的 `v*` tag 后，`.github/workflows/release.yml` 会在 Windows x64 runner 上：

- 通过 `scripts/verify-release.mjs` 严格校验 SemVer 2.0 tag，并要求根目录及全部工作区包的版本一致（当前共 9 个 manifest）；
- 要求 tag 指向的同一 commit SHA 已有 `main` push 触发的 CI 与 Platform smoke，且每个工作流的最新匹配 run 均完成并成功；缺失、仍在运行、失败或取消都会中止打包；
- 安装依赖并构建 CLI、API、Web、Box 和角色包；
- 生成 Windows x64 Box 与 CLI 压缩包；
- 对实际归档内容生成部分覆盖的 SBOM 草稿，并从独立解压目录执行 Box 安装、迁移、启动、备份验证及恢复后的应用健康检查；
- 生成 `SHA256SUMS.txt`，并上传 Actions artifact；
- 创建带制品和自动生成变更说明的 **draft GitHub Release**。

该流程不会自动把 workspace 包发布到 npm，也不会自动将 draft Release 标记为正式发布。维护者必须检查构建日志、制品内容、校验和、变更说明及未验证边界，再在 GitHub 中人工发布 draft。当前官方制品只覆盖 Windows x64；Linux、macOS、ARM 和 npm 包仍没有发布承诺。

工作流中的 archive smoke 只核对解压内容并运行打包后的 CLI `--version`，不会执行 Box 安装、迁移、API/Web 启动、升级或恢复。因此该步骤成功不能替代最终 ZIP 的安装与运维验收。

后续的 `scripts/test-release-box.ps1` 才执行实际生命周期检查：校验指定 SHA-256、使用全新目录和专属端口安装全部随包迁移，检查 API/Web 健康、冷启动及重复启动，再以包内 CLI 备份验证、恢复到新库、读取验证标记并启动恢复后的应用。脚本保留证据，结束时核验 PID、可执行路径、数据目录和监听端口后停止自有服务，不删除验证目录。工作流保留独立的生命周期 summary 和脱敏日志，不上传数据目录、配置或备份。旧版本升级、卸载、生产恢复和跨平台验收仍需另行完成；配置加入仓库也不等于远端 run 已成功。

`main` push、pull request 和手工触发均可运行 `.github/workflows/platform-smoke.yml`，在 Ubuntu、Windows 和 macOS 上安装锁定的依赖，顺序构建 shared、role-packages 和 CLI，并运行 CLI 测试；Windows job 还会使用 Windows PowerShell 5.1 检查 PostgreSQL 进程归属保护，并用 PowerShell 7 执行制品扫描和生命周期脚本的防护回归。这个矩阵只证明其实际检查覆盖的范围，不替代 API/PostgreSQL、浏览器、安装包、生产迁移或长期运行验收。本地版本门禁与测试通过也不能证明远端 run 已经成功。

## 2026-11-06 本机重新打包验收

在独立源码副本中使用 Node.js 24.22.1、pnpm 10.28.2 和 PostgreSQL 17.11 重新构建并生成 Windows x64 Box ZIP，随后直接解压该 ZIP 进行验收，没有再替换包内安装或启动脚本。制品大小为 279273057 字节，SHA-256 为 `7710af641a6f50497495482eeb3bf10f12cadc726d5a714a14c32580008324dc`，本机校验值与 sidecar 一致。

- 恢复 1705 个依赖链接，首次安装应用全部 20 项迁移；API 直连和 Web 代理健康检查均返回 `data.status=ok`，Web 返回 HTTP 200。
- 完全停止后冷启动成功；重复启动识别为 already running；停止后演练使用的 PostgreSQL、API 和 Web 端口均释放。
- 通过包内 Box CLI 执行 `backup --verify`，核对 20 项迁移和 55 张表（含演练验证标记表），再恢复到另一个库并精确读回验证标记。将本次隔离配置切换到恢复库后，重新执行安装未发现待应用迁移，应用启动和健康检查通过。dump SHA-256 为 `39969c1ea3f7d9f21f8d4b5599e381b803cc1bc1afc5d386838b63910f11affc`。

本机原始证据位于 `.tmp/box-release-validation-20261106-212834/summary.json` 及同目录日志和 ZIP；这些是本机保存的演练材料，没有随仓库提交。备份与恢复时显式把隔离 `config.env` 加载到进程环境，并将 `WORKMESH_PG_BIN` 指向解压包的 `runtime/pgsql/bin`。此结果来自当时未提交工作树，不对应最终候选 commit，也不是新机器或远端 runner 的验收。Box CLI 尚无 upgrade/uninstall 命令，本次没有验证旧版本升级、卸载、生产恢复或跨平台安装；上述发布门禁继续保留。

2026-11-07 已把这条流程固化为 PowerShell 7 生命周期检查器，并对同一 ZIP 在全新目录完整实跑通过：20 项迁移，首次、冷、重复、恢复库四阶段的 API/Web 健康检查，以及备份验证、55 张表（含显式验证标记表）和恢复标记核对均通过，自有服务已停止。36 项检查器安全回归通过；验证细节、命令、失败修复和日志边界见 [Windows Box 生命周期验证](testing/box-lifecycle-validation-2026-11-07.md)。Release 工作流已接入该入口，但尚无最终候选的远端实跑结果。

该 ZIP 早于随后发现并修复的密码二验失败额度问题。浏览器和认证回归使用修正后的源码，不能把旧 ZIP 的生命周期通过扩大为“含最新修复的最终制品已验收”；最终候选须重新构建、扫描与验证。

## 本次兼容性变化

- 密码二验额度按既有安全契约统计失败和正在校验的请求：正确密码只释放本请求在原窗口的预约，不清除其他失败；超过五次失败仍在 bcrypt 前拒绝。429 返回当前固定窗口剩余时间。无需迁移；升级前已耗尽额度的旧窗口会保留到到期。

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

本地 API 行覆盖率门禁已通过，实测数字与验证边界见 [工程整改验证](testing/remediation-verification-2026-11-03.md)。发布门禁尚未全部满足：最终 commit 的远端 CI、外部 GitHub、跨平台安装、性能容量和外部真实团队验收仍需证据；已有隔离团队手工验收不能替代外部团队证据。即使 draft Release 自动创建成功，也不应在人工验收前将其描述为正式发布或全部完成。
