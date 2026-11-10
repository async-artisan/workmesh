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

工作流还会用固定 Syft 1.57.0 分别扫描实际 Box 与独立 CLI ZIP 的解压内容，逐文件核对输入与归档，并严格离线验证生成的 CycloneDX 1.7 文档。构建器模块图以 `PARTIAL_MODULE_EVIDENCE` 侧车绑定实际 CLI/Web 文件、版本/PURL 与许可元数据；扫描入口只将经过实际输出校验、具有固定有效 npm 身份的直接 rendered 模块保守合并到 CycloneDX。预打包候选、虚拟或生成模块不会据此升级为确定组件，也不补造依赖边。扫描前后验证工具与 schema 哈希不变；只把归一化 JSON/YAML 加入发布资产并按实际资产重算校验和，原始扫描日志不公开。整体仍为 `DRAFT_PARTIAL_COVERAGE`：运行时内嵌组件、候选最终归因、UNKNOWN 精确版本及整体许可证义务尚未补齐。schema 通过只证明结构与格式语法，不能代替覆盖审查。实测结果见[制品 SBOM 验证](testing/artifact-sbom-validation-2026-11-07.md)和[bundle 验证](testing/bundle-evidence-validation-2026-11-07.md)。

2026-11-07 后续全量审计为 840 个依赖、1 项低危、0 项中危/高危/严重，生产范围 166 个依赖零项。esbuild、glob、minimatch 路径已兼容更新，deepmerge 4.3.1 已本地补丁并通过 12 项回归，但其版本公告仍保留；没有忽略或风险豁免。早期 ZIP 与四项公告继续保留历史记录，最新处置边界见[依赖审计记录](security/dependency-audit-2026-11-07.md#同日后续兼容覆盖与本地补丁)。本地缓解不等于上游已发布安全版本或全仓审计清零。

## GitHub Release 自动化边界

推送符合 SemVer 的 `v*` tag 后，`.github/workflows/release.yml` 会在 Windows x64 runner 上：

- 通过 `scripts/verify-release.mjs` 严格校验 SemVer 2.0 tag，并要求根目录及全部工作区包的版本一致（当前共 9 个 manifest）；
- 要求 tag 指向的同一 commit SHA 已有 `main` push 触发的 CI、Platform smoke 和 Security，且每个工作流的最新匹配 run 均完成并成功；缺失、仍在运行、失败、跳过或取消都会中止打包；18 项本地发布门禁回归通过不替代真实远端 run；
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

## 2026-11-07 production 依赖重新打包

后续将 Prisma CLI 显式声明为 API 运行依赖，Box 改用 `deploy --legacy --prod`。同步源码的隔离副本在 Node.js 24.22.1 下完成 frozen 安装和无缓存构建 6/6 后，生成包含二验及登录修复的新 Windows ZIP：197721487 字节，SHA-256 `ff80618f58e2eb2c6f7b592a4abd0d01e06603c6f9d07802f2efa011b28b10bf`。它的首次安装、20 项迁移、四阶段健康、备份验证、恢复标记和安全停止均实跑通过。

实际扫描已不含此前命中公告的 deepmerge、glob 和 minimatch，Box 从此前 813 条组件记录缩至 276 条；这不是全仓漏洞清零，工作区开发依赖的四项公告仍待处置。SBOM 仍为部分覆盖草稿，不能以组件减少替代 bundle、原生嵌入组件、许可和 schema 核验。结果与完整本地证据位置见[运行依赖缩减验证](testing/box-production-dependencies-2026-11-07.md)。本次来源为 `739367a` 加未提交改动的快照，不替代最终 clean SHA、远端 CI、新机、旧版本升级、卸载及生产验收。

## 本次兼容性变化

- 密码二验额度按既有安全契约统计失败和正在校验的请求：正确密码只释放本请求在原窗口的预约，不清除其他失败；超过五次失败仍在 bcrypt 前拒绝。429 返回当前固定窗口剩余时间。无需迁移；升级前已耗尽额度的旧窗口会保留到到期。

- 登录邮箱采用相同的失败额度语义，保留原双 hash 邮箱键以延续升级前窗口；IP 继续统计所有尝试。新增 13 项登录单测及五项真实 PostgreSQL 场景通过，见[登录限流验证](testing/login-rate-limit-validation-2026-11-07.md)。后续源码进一步共享注册/登录 IP 预算，保留旧计数并修正账户及 CLI 冷却；认证单测 117 项、API 单元 713 项、真实集成 172 项通过（另 1 项 Ollama POC 跳过），见[共享 IP 限流验证](testing/shared-ip-rate-limit-validation-2026-11-07.md)。
- 共享 IP 修复需要先暂停旧版本认证写入并排空在途请求，再全量切换。新语句只能读取其快照可见的遗留计数，旧节点仍按独立预算放行；不能承诺混合版本全局严格 30 次。保留旧窗口，不通过更换 key 或清库升级。上述 `ff80618f…` ZIP 早于该修复，最终候选仍须重新打包验证。

包含共享 IP 修复与模块证据的后续 Box SHA 为 `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d`，已完成重新打包、实际扫描、两份 1.7 schema 验证和同包完整本机生命周期。路径过滤修复后再无缓存构建 6/6，受管 bundle 输出及侧车哈希与该归档相同；详细比较范围、排除的声明文件和发布边界见[bundle 验证](testing/bundle-evidence-validation-2026-11-07.md)。来源仍为 dirty 工作树，不能代替最终 clean SHA、远端 CI、新机、升级卸载或生产验收。

- Nest 升级至 11，前端 Router 升级至 7，测试工具升级至 Vitest 4，Vite 升级至 6。开发与 CI 建议使用 Node.js 20.19 或更新的兼容版本，并固定 pnpm 10.28.2。
- API 测试配置使用 `.mts`，以显式 ESM 加载；单元、集成及覆盖率统一发射 Nest 装饰器元数据。推荐使用包内脚本，不复制旧的 `.ts` 配置文件名。
- `SECURE` Cookie 模式启动时要求 HTTPS 公共 Origin；`LOCAL_INSECURE` 只允许 HTTP loopback。模板显式配置本地模式，正式部署应覆盖。
- 新增 `RATE_LIMIT_BUCKETS`，默认 10000，限制进程内 IP 桶数量。`RATE_LIMIT_MAX`、桶数必须为正整数。全局 HTTP 等进程内限流仍需多实例共享的上游限制；注册/登录共享 IP、登录邮箱和密码二验预算已由 PostgreSQL 维护，按上述升级条件切换。各端点的配额语义不同，不能用进程内桶承诺全局上限。
- 代码证据票据准备要求 `WORKMESH_TICKET_ENCRYPTION_KEY`，值为单独生成的随机 32 字节密钥的 64 位十六进制编码。应通过部署密钥管理注入，不使用 webhook 密钥，也不写入数据库或版本控制。缺失时此准备入口返回 503，其余接口不因此停用。
- 所有实例使用相同的票据加密密钥并通过安全备份保存。票据秘密使用 AES-256-GCM，并绑定项目、主体、票据和请求摘要。更换或丢失密钥会使旧重放记录无法解密；旧明文记录和解密失败返回 `CODE_EVIDENCE_TICKET_REPREPARE_REQUIRED`，客户端应使用新的幂等键重新准备。旧版本遗留明文仍需按保留策略清理，备份也应受访问控制。
- 票据按项目和有效期进行条件消费，并发只有一次成功；过期或已消费返回冲突。旧工件 generation 和其他项目的批准证据不能用于准备新票据。

## 候选发布机器报告

维护者可对明确的候选提交生成只读 JSON 报告：

```bash
pnpm release:readiness -- --tag v1.0.0 --sha <完整的40位小写commit> --verify-ci --repository owner/repository
```

可追加 `--artifact <归档路径>` 计算实际字节数和 SHA-256。报告时间、候选 tag/SHA、当前 HEAD 与 dirty 状态、工作区 manifest 版本、三个远端工作流结果和制品身份分别列出；每项使用 `PASS / FAIL / NOT_CHECKED / ERROR`。版本检查只针对本地工作树，只有 HEAD 匹配且干净时才标记 `candidateBound=true`。提交、tag 和制品摘要都不会凭参数自动成为已批准事实；制品来源、扫描、安装演练仍按既有发布证据核对。

远端复用 `verify-release.mjs` 的 exact SHA、main push、最新运行及 rerun 选择规则，同时要求 CI、platform-smoke 和 security。`--verify-ci` 使用环境中的 `GH_TOKEN`，可从 `GITHUB_REPOSITORY` 读取仓库名；缺配置或未请求远端查询均为 `NOT_CHECKED`，查询失败为 `ERROR`，没有匹配的成功最新运行是 `FAIL`。报告不输出凭据。`machineChecksPassed=false` 时命令退出 1；参数/报告失败退出 2。

机器检查通过时状态仍为 `MANUAL_REVIEW_REQUIRED`，`releaseApproved` 恒为 `false`。B0–B6 人工项统一保留 `PENDING`，由维护者回查 `BLOCKED.md`、本文和实际验收记录；报告不覆盖其中状态。`workmesh-box status` 继续报告已安装实例的健康，不能代替候选发布验收。

## 外部 GitHub 验证

`pnpm test:github-live` 仅在显式设置 `WORKMESH_GITHUB_LIVE=1` 时请求 GitHub；同时指定获准测试的 `WORKMESH_GITHUB_TEST_REPOSITORY=owner/repository` 和正整数 `WORKMESH_GITHUB_TEST_PR`。私有仓库通过 `WORKMESH_GITHUB_TEST_TOKEN` 提供只读权限。先构建 API。

入口读取真实仓库、PR 和完整分页 reviews，调用生产证据归一化器，并在读取前后校验 PR 未变化。可设置 `WORKMESH_GITHUB_EXPECT_DECISION=VALID|INVALID|UNKNOWN` 断言预期。没有预期时只证明读取和归一化成功，不代表证据满足发布条件。此入口不创建 PR、不提交代码、不触发 webhook；真实 webhook 投递、签名及发布链路仍需独立联调。

## 2026-11-07 Node.js 20.19.0 后续质量与新包

隔离源码副本在官方校验的 Node.js 20.19.0 下完成 frozen 安装、无缓存构建 6/6、类型检查 10/10、全仓测试 8/8、18 项契约；这是后续基线和页面改动前的全仓快照。后续 API coverage 为 923 passed / 1 skipped，真实 PostgreSQL 根集成为 181 passed / 1 skipped，Web 单测 529 项、真实 Chromium 四项通过；覆盖率阈值未降低。完整代码项目交付发布仍依赖真实 GitHub 证据。首次失败、修复、日志摘要和各轮范围见[质量收尾记录](testing/quality-closeout-2026-11-07.md)。

该批次本机 Box 为 197882772 字节，SHA-256 `554eae8b559c33f2cf771fae36eb4163aaca1c2bd976287da1c302e3c9035c6e`；CLI 为 36718185 字节，SHA-256 `6c5bd81bd745971856337aff6febe0e76a431857714ba0f47db6fb24f56f1780`。该 Box 的首次/冷/重复/恢复库四阶段 API、代理、Web 健康均通过，应用全部 20 项迁移，备份核对 55 张表和恢复标记，自有服务已停止。实际 ZIP 独立扫描、bundle 与 CycloneDX 1.7 校验通过，仍保持部分覆盖状态；详见[制品扫描](testing/artifact-sbom-validation-2026-11-07.md)与[bundle 验证](testing/bundle-evidence-validation-2026-11-07.md)。

这些是声明来源 `739367a` 加当时冻结的未提交改动的本机 Windows 包；构建 Node.js 20.19.0，包内运行时为 Node.js 24.22.1 与 PostgreSQL 17.11。冻结后的任务认领并行改动未包含于这些制品或测试证据，具体文件见[质量收尾记录](testing/quality-closeout-2026-11-07.md#同日后续基线失效列表优化与最新本机包)。本轮没有创建 commit、tag 或发布制品，不替代最终 clean SHA、同源远端 CI、新机、旧版升级、卸载、完整供应链或生产验收。下列发布门禁继续适用。

## 2026-11-07 许可证补齐后实际包与扫描（239abf）

本批次在 `G:/workmesh-verify-validation-20261107-r1/source` 的冻结构建完成后以 `-SkipBuild` 生成新包，证据保存在本机 `G:/workmesh-license-package-validation-20261107-r2/`。构建宿主为 Node.js 20.19.0 / pnpm 10.28.2；包内使用官方 Node.js 24.22.1 分发可执行文件及其 LICENSE，PostgreSQL 17.11 使用保留的完整供应方分发目录。925 个源码、构建与打包输入及 1567 个运行时输入的前后哈希清单完全一致。声明来源仍为 `739367a714097a825b96ca7ecf6bce3372855a77` 加 dirty 快照；该包不包含冻结后继续修改的 release 安全联动或 knowledge reviewer 批量查询，也不能代表后续整个工作树或完整质量入口已经通过。

| 实际制品        |      字节数 | SHA256                                                             |
| --------------- | ----------: | ------------------------------------------------------------------ |
| Windows Box ZIP | 198,284,290 | `239abf9b446ae04823a362f17088fe42699d61300c627704f73752046ef2d9aa` |
| 独立 CLI ZIP    |  36,764,850 | `d0ccfeaa4f0f50e91f8bab33f7bb4fbbe5ad793ba8db7ebe509a3e74d06df7ed` |

实际 ZIP 许可证检查通过：Box 159 条记录、162 次文本引用、148 个唯一文本；CLI 9 条记录与 9 个文本。索引中无 `MISSING*` 记录，仍为 `PARTIAL_COVERAGE`。检查包含根 MIT、已部署自有包许可、官方 Node LICENSE、PostgreSQL 供应方通知、canvas 精确 revision 的项目 MIT、token 原包 README 许可段、全部引用文本字节与摘要，以及 Box 内嵌 CLI 的精确哈希关系。供应方通知或项目 MIT 不能证明原生嵌入组件的许可证义务全部完成，范围见[许可证分发验证](testing/license-distribution-validation-2026-11-07.md)。

同一 Box SHA 的新目录生命周期实跑退出 0：全部 20 项迁移，首次、冷、重复和恢复库四阶段 API/代理/Web 健康通过，55 张表含验证标记的备份验证与恢复标记一致，自有服务已停止，58430/58431/58432 端口复查无监听。`lifecycle/summary.json` SHA256 为 `478bc0f806251567270864061ba5f0cd9b63bf871ff3495af74cb596ff564cc9`，summary 记录 dump SHA256 为 `1416ac07564c6e2f2d82a1dafc9b9bed0923d284714185a974bf60c7c0119e77`。这不是新机、旧版升级、卸载或生产恢复证明。

首次扫描暴露 PowerShell 将 CLI 单个 bundle 目录字符串展开为字符参数的问题，失败证据保留在 `artifact-sbom/` 和 `scan.log`。修复后对相同 ZIP、独立解压目录在全新 `artifact-sbom-r2/` 重扫，退出 0，两份合并后的 CycloneDX 1.7 文档通过离线 schema/格式校验。Syft 原始组件范围仍为 Box 276 条 / 160 条 npm / 23 条 UNKNOWN，CLI 1 条 Node / 0 条 npm；直接 rendered 证据为 Box 新增 8 条、匹配 3 条已有组件记录，CLI 新增 3 条，均未虚构依赖边。最终 CDX 的 Box 12,941 条记录中有 12,657 条文件记录，其余为 116 条 application 和 168 条 library；CLI 的 90 条中有 86 条文件、1 条 application 和 3 条 library。文件记录不能计作软件包。

成功扫描摘要 SHA256 为 `614380e0d44c2387c609cebf09f38c8167421b84210b60a3aea69c6f19a8ec4b`。完整输入、侧车、输出哈希及首次失败范围见[制品扫描本批次记录](testing/artifact-sbom-validation-2026-11-07.md#许可证补齐后实际-zip-与保守合并239abf2026-11-07)。状态继续为 `DRAFT_PARTIAL_COVERAGE`：23 条 UNKNOWN、原生组件 SBOM 与完整许可、候选最终归因和完整依赖关系仍待补齐；本地通过不能替代最终干净 SHA 的同源远端 CI、外部 GitHub、真实团队、新机、升级卸载或生产验收。

## 当前发布结论

本地 API 行覆盖率门禁已通过，最新完整入口运行和验证边界见 [统一本地验证验收](testing/local-verification-validation-2026-11-07.md)，历史记录见 [工程整改验证](testing/remediation-verification-2026-11-03.md)。当前 Windows x64 发布门禁尚未全部满足：最终 commit 的远端 CI、最终制品的新机安装、升级与卸载、外部 GitHub、性能容量和外部真实团队验收仍需证据；已有隔离团队手工验收不能替代外部团队证据。Linux/macOS 安装与运维验收是扩大平台支持范围前的门禁，当前没有对应官方制品承诺。即使 draft Release 自动创建成功，也不应在人工验收前将其描述为正式发布或全部完成。
