# WorkMesh 当前交付与验证状态

> 更新时间：2026-11-10。本文汇总当前能力与验证边界；历史验收和本次工作树检查分别标注。工作树仍有未提交改动，本次本地结果不能代替最终待发布 commit 的远端 CI 或发布验收。
>
> 有日期的原始证据见 [工程整改验证](testing/remediation-verification-2026-11-03.md) 和 [本机部署与团队使用验收](testing/team-acceptance-2026-11-03.md)。工作计划见 [dev-plan.md](dev-plan.md)，仍未完成的外部条件见 [BLOCKED.md](../BLOCKED.md)。

当前源码的本地证据以[统一本地入口验收](testing/local-verification-validation-2026-11-07.md)和[Board 分页验收](testing/board-pagination-validation-2026-11-09.md)为准：r13 于 2026-11-09 完整运行 `pnpm verify -- --apply-migrations`，exit 0 / LOCAL_QUALITY_PASSED，2026-11-10 核对终态及 915 个源码文件指纹。真实 PostgreSQL 194 passed / 1 skipped、Chromium 4/4、UI 55/55、API coverage lines 83.39%；r12 的浏览器和独立 UI 失败继续保留。两组同源 HTTP 基准随后通过，见[基准记录](testing/api-benchmark.md)。随后同源新 Box `09d0d2ba…` / CLI `7c06512d…` 完成实际 ZIP 核验、隔离本机完整生命周期、独立扫描、许可证字节核对及保守合并后的 CycloneDX 1.7 校验，见[生命周期记录](testing/box-lifecycle-validation-2026-11-07.md)。供应链覆盖仍为部分，Box 保留 23 条 UNKNOWN。全量依赖审计保留 1 项低危，生产审计为零。后续 live 工作区改动不自动进入 r13 或该制品，最终 clean SHA、远端 CI 与外部发布门禁尚未满足。

## 已交付能力

| 范围         | 当前实现                                                                                                                                                                                         | 证据与边界                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 认证与授权   | WebSession Cookie + 双值 CSRF；Agent Bearer 凭据；设备授权 PKCE；一次性确认票据；项目成员、角色和 scope 校验                                                                                     | 源码、单测、进程内 HTTP 契约；真实公网部署和浏览器属性仍需独立验收                                      |
| 知识与 PRD   | 文档修订、候选提交、评审请求、发布、撤回、恢复；PRD/Understanding 基线绑定                                                                                                                       | 真实 PostgreSQL 测试已覆盖部分发布与权限链路；完整产品浏览器闭环仍待验收                                |
| 工作流       | 内置 `standard`、`software-delivery`、`software-delivery-no-ui` 模板；定义校验、发布、实例化、角色包锁和审批槽派生                                                                               | 源码、单测、真实 PostgreSQL 验收；跨版本迁移和生产升级仍需运维证据                                      |
| 任务与交付   | ready 查询、认领/释放、工作状态、确定性 ContextSnapshot、托管文件或 GIT_REF 工件、基线复核、返修                                                                                                 | CLI 与 API 已实现；Agent 不能批准或发布                                                                 |
| 评审与变更   | 单条/批量决定、返修、拒绝、撤销、槽位委托、超时升级、变更请求、收件人 ack 和失效传播                                                                                                             | 服务层和真实数据库并发测试已记录；真实团队长期使用尚未验证                                              |
| GitHub 证据  | 仓库/PR/reviews 读取、分页、Webhook HMAC 验签、提交级代码证据归一化和绑定                                                                                                                        | 当前只有 GitHub 适配器；本次没有获准的真实仓库/PR，live 结果为 SKIPPED                                  |
| CLI 与角色包 | auth、setup、roles install、claim、context/materialize、product 草稿、candidate、deliver、review、receipt、changes；六个内置角色包 manifest 1.1；PR 上的 Ubuntu/Windows/macOS CLI smoke workflow | 源码和包测试已通过；跨平台 smoke 需由远端 runner 持续提供证据，打包后在全新 home 的长期使用仍需单独记录 |
| Web 工作台   | 工作台、需求、评审、项目、看板、知识、PRD、流程、角色/ACL、设备授权和用户中心                                                                                                                    | 基础浏览器流程已验证；需求详情到发布的完整闭环、跨浏览器和无障碍仍待验收                                |
| workmesh-box | status、doctor、dev、backup、restore；Windows 本机已有隔离安装和恢复记录；tag 触发的 Windows x64 draft Release 打包流程已加入仓库                                                                | Linux/macOS 适配器已实现但未完成对应平台验收；draft Release 尚未经过真实 GitHub runner 和人工发布验收   |

## 证据等级

- **代码/类型**：源码、schema、构建和静态检查支持，不等于运行时部署验证。
- **单测/进程内 HTTP**：Vitest 和 Nest HTTP 契约支持，不等于真实数据库或浏览器行为。
- **真实隔离 PostgreSQL**：历史整改记录覆盖当时的 12 项迁移。2026-11-06 对当前未提交工作树在独立 PostgreSQL 17.11 空库应用了全部 20 项迁移，Prisma 漂移检查无差异；一次隔离备份恢复核对了迁移数量、55 张表及一条测试数据。这不替代最终候选 commit 或生产环境的迁移、恢复验收。
- **基础浏览器自动化**：记录覆盖注册、会话、创建项目、页面加载、重新登录和 CSRF 拒绝；不等于完整产品闭环。
- **手工隔离团队验收**：记录了 Windows 环境下三人测试团队的需求、交付、返修、评审、发布和恢复流程；不等于外部真实团队验收。
- **SKIPPED / 未验证**：没有获准目标或必要外部条件时保持原状态，不把实现了入口写成已经验证。

## 2026-11-06 工作树检查

- 本机 Windows 使用 Node.js 20.13.1 和 pnpm 10.28.2；Node 低于项目要求的 20.19.0，因此结果仅用于诊断，不能作为支持环境或发布验收证据。
- `pnpm format:check`、`pnpm type-check` 和 `pnpm lint:eslint` 通过；类型检查使用了 Turbo 缓存，不能替代干净环境检查。
- 全仓测试初次运行时有两个 CLI `workspace-bind` 用例超过默认 5 秒时限；使用 Node.js 24.22.1 重试仍出现同样超时，单独运行该套件为 21 项通过。随后一次全仓无缓存复测在另一条真实 Git 探测用例上超时；这些测试涉及多个 Git 子进程，现有证据仍不能证明超时的具体根因。
- 为上述真实 Git 集成场景设置有限的 15 秒测试时限，保留并发测试内部 5 秒等待诊断；以 Node.js 24.22.1 运行 `pnpm exec turbo run test --force` 后，8/8 个任务通过、无缓存，其中 API 654 项、Web 476 项、CLI 213 项通过且 2 项跳过。这是一轮本机工作树结果，不能证明持续稳定，也不能替代最终 commit 的远端 CI。
- Node.js 24.22.1 下 `pnpm test:contracts` 的 16 项运行时检查通过。随后无缓存 `turbo run build --force` 在 API 的 Prisma Client 生成步骤遇到 Windows `EPERM`；只读进程模块检查发现现有 API 进程加载了目标引擎 DLL。该进程未停止，构建整体未完成，处理方法见[本地运行常见问题](local-dev.md#windows-上-prisma-client-生成失败)。
- 在独立端口和目录运行 Chromium UI review，15 项通过；测试使用 mock API，覆盖多个视口和部分键盘、错误及流程编辑交互，不等于真实数据库浏览器交付闭环或无障碍认证。
- 单独执行 Web 生产构建通过，产物包含按页面拆分的 chunk；构建大小不等同真实首屏下载量，尚未形成性能或容量基准。
- 隔离 PostgreSQL 空库应用了全部 20 项迁移；修正 schema 中两个已有索引的映射后，Prisma 漂移检查无差异。一次备份恢复到另一空库后核对了 20 项迁移、55 张表和一条测试数据；新空库中的 onboarding 数据库及 HTTP 套件 16 项通过。这些是当前工作树的隔离演练，不代表生产或最终候选验收。
- Node.js 24.22.1 下 `pnpm test:isolated-prisma` 通过，包括 2 项路径测试、Prisma validate 和隔离 generate。
- 在新建隔离 PostgreSQL 空库应用 20 项迁移后，完整 API integration 为 16 个测试文件通过、1 个跳过；138 项通过、1 项跳过。跳过的是默认不启用的真实 Ollama 模型 POC；它需要显式启用，以上结果不证明模型联调成功。结果来自未提交工作树。
- 随后在独立工作副本以 Node.js 24.22.1 完成 frozen-lockfile 安装，并无缓存执行全仓 build（6/6 任务）及 test（8/8 任务），格式、类型和 ESLint 检查通过；这是该副本当时的未提交工作树快照，后续改动仍需复验。该阶段先将既有 Windows Box ZIP 解压并替换修复中的安装/启动脚本，以独立数据目录完成安装、20 项迁移及 API/Web 健康检查；该次结果本身未覆盖重新打包、升级、卸载与备份恢复。后续真实重新打包结果单独记录如下。
- 跨平台根入口 `pnpm test:integration -- --apply-migrations` 在 Node.js 24.22.1 与新建隔离 PostgreSQL 库上通过：20 项迁移，17 个测试文件通过、1 个跳过，148 项测试通过、1 项跳过；跳过的是真实 Ollama 模型 POC。该结果来自当前未提交工作树，不代替最终候选 commit 的 CI。
- 根集成入口的参数/guard/resolver 测试为 3/3 通过；CI 已改为调用该跨平台入口，并明确集成测试会写入已通过门禁的隔离测试库。限流启动测试改用临时空工作目录并清除数据库环境变量，定向测试通过，避免回填仓库 `.env`。
- Windows 包启动脚本修复了 PowerShell `Start-Process` 对 `pg_ctl` 返回空退出码时的误判，并要求 `pg_ctl status`、数据目录/端口和 TCP listener PID 一致。修复后的脚本在隔离 ZIP 解压目录完成 20 项迁移、API `/api/health` 和 Web HTTP 健康检查；已停止并清理该演练实例。该演练未重新打包最终 ZIP，也未覆盖升级、卸载和备份恢复。
- 本次未验证真实 GitHub/Webhook 或完整浏览器产品闭环。

## 2026-11-06 后续重打包与浏览器检查

- 独立源码副本使用 Node.js 24.22.1 和 PostgreSQL 17.11 完成真实 Windows ZIP 打包，补上干净构建所需的 role-packages 构建顺序。直接解压新 ZIP 后恢复了 1705 个依赖链接，完成首次安装、全部 20 项迁移、API/Web 健康检查、冷启动、幂等启动及安全停止。ZIP 为 279273057 字节，SHA-256 为 `7710af641a6f50497495482eeb3bf10f12cadc726d5a714a14c32580008324dc`，与 sidecar 核对一致。
- 包内 Box CLI 的 `backup --verify` 和恢复到另一库均通过：20 项迁移、55 张表（含演练验证标记表），恢复标记精确读回；切换隔离配置到恢复库后重新安装显示无待应用迁移，应用健康检查通过。本次显式加载隔离 `config.env` 并设置 `WORKMESH_PG_BIN`；没有验证旧版本升级或卸载，CLI 目前也没有相应命令。详细范围见[发布与升级验收](releasing.md#2026-11-06-本机重新打包验收)。原始本机材料保留在 `.tmp/box-release-validation-20261106-212834/`，未随仓库提交。
- 发布工作流新增严格 SemVer 与全部 9 个 manifest 版本一致性检查，并要求同一 SHA 的 `main` push CI 和 Platform smoke 最新匹配 run 均完成且成功；本地 release guard 的 6 项回归测试通过，不能代替对应的远端 run 结果。Platform smoke 已增加 `main` push 触发。
- 在一次性隔离 PostgreSQL 应用 20 项迁移后运行真实 Chromium 套件：修正注册页面选择器及确认密码输入后，账户/项目流程和 CSRF 拒绝两项通过；新增业务链在工作流定义校验时失败，原因是测试所选角色包不声明 CASES 输出且缺少所需 PRD/KNOWLEDGE 输入。本次尚未到达任务人工审批，不作为该闭环通过证据。
- 上述结果来自当时的未提交工作树和本机隔离环境，不能代替最终候选 commit、干净新机、远端 CI、生产运维、完整制品 SBOM、管理员设置或外部真实团队验收。

## 2026-11-07 制品检查补充

2026-11-07 补充：实际 Box/CLI ZIP 扫描和逐文件输入绑定已通过，Box 813 条组件记录、独立 CLI 仅 1 条 Node 记录，30 项防护回归通过。该结果是部分覆盖的 SBOM 草稿，不能替代 bundle、原生内嵌组件、许可证或完整 schema 核验。生产依赖审计为零项，全量审计仍有 2 项低危、2 项中危，其中三个包的受影响版本进入本轮 Box ZIP；处置尚未关闭。详情见[制品扫描验证](testing/artifact-sbom-validation-2026-11-07.md)和[依赖审计记录](security/dependency-audit-2026-11-07.md)。

同一真实 ZIP 已通过新生命周期检查器的全新目录实跑：20 项迁移，首次/冷/重复/恢复库四阶段健康检查，备份验证、55 张表（含验证标记表）与恢复标记核对，自有服务已停止。检查器 36 项防护回归通过，Release 工作流已接入。结果和限制见[Windows Box 生命周期验证](testing/box-lifecycle-validation-2026-11-07.md)；本机通过不代表最终候选或远端 runner 已通过。

真实 Chromium 的账户、CSRF 和 QA 人工验收链已全部通过。QA 链使用公开 API 发布 Understanding、PRD 和接口说明，以 Agent 凭据认领、生成实际基线快照并交付 CASES，再在浏览器读取证据、经密码票据批准；刷新和 API 重读后为 APPROVED/DONE，认领已释放，IMPL 仍未完成且 RELEASE 等待前置。这不是完整 B3 实现与发布闭环。初始化请求按默认全局限流冷却 60 秒，没有提高限额。详细边界见[浏览器 QA 验收](testing/browser-qa-acceptance-2026-11-07.md)。

该回归发现密码二验错误地把成功验证计入“每会话 15 分钟最多 5 次失败”的额度。修复使用原子预约与成功后释放原窗口一格，保留错误和并发失败；没有修改 schema 或放宽票据语义。认证目录 79 项、全 API 单元 675 项、真实 PostgreSQL 4 项并发回归均通过；根集成入口为 154 项通过、1 项真实 Ollama POC 跳过。隔离源码副本的 API 重新构建通过。这些仍是未提交工作树结果；前述 ZIP 早于该密码修复，不能当作已经包含修复的最终制品。

首次使用脚本与浏览器链已共享修正后的流程 helper，但独立启动 API 实跑该脚本的命令被自动审批审核以 `blocked by policy` 拒绝，未给更具体理由；该独立脚本本轮仍未验证，没有通过其他启动方式绕过。

## 2026-11-07 登录与制品后续验证

登录邮箱限流已按失败次数契约修复，沿用既有双 hash 邮箱键，bcrypt 前预约最多五个失败或在途请求；成功只退还自身原窗口的额度。认证目录 92 项、全 API 单测 688 项通过；专属 PostgreSQL 空库应用 20 项迁移后，根集成套件为 159 项通过、1 项真实 Ollama POC 跳过，包括新增的五项真实登录数据库回归。这一阶段尚未修复的共享 IP 与通用冷却差异，后续结果单独记录。详见[登录限流验证](testing/login-rate-limit-validation-2026-11-07.md)。

Prisma CLI 从 API 开发依赖移为运行依赖，版本仍为 5.22.0；Box 改用 production deploy。隔离 staging 的 Prisma CLI、生成客户端、引擎和 20 项迁移检查通过，恢复依赖链接后仍能独立加载。随后同步当前源码，在隔离副本完成 frozen 安装和无缓存全仓构建 6/6，真实重打包新 Windows ZIP。新 ZIP 为 197721487 字节，SHA-256 `ff80618f58e2eb2c6f7b592a4abd0d01e06603c6f9d07802f2efa011b28b10bf`，包含二验和登录限流修复；实际扫描已不含此前匹配公告的 deepmerge、glob 和 minimatch。

该新 ZIP 的完整生命周期检查通过：20 项迁移，首次、冷、重复、恢复库四阶段 API/代理/Web 健康，备份验证、55 张表（含验证标记表）和恢复标记核对，以及自有服务停止。扫描仍为 `DRAFT_PARTIAL_COVERAGE`，Box 276 条组件、160 条 npm、23 条 UNKNOWN，独立 CLI 仍只识别 Node。详情见[运行依赖缩减验证](testing/box-production-dependencies-2026-11-07.md)。这是一份声明来源 `739367a` 加未提交改动的本机快照；没有 final clean SHA 的远端 CI、新机器、旧版本升级、卸载、完整 SBOM 或生产验收证据，P0/P1/P2 尚未全部完成。

后续源码已将注册和登录统一写入既有 `login-ip`，原子递增并叠加同 IP/同窗口的遗留注册预算；账户和 CLI 授权冷却返回真实剩余秒数。认证 117 项、全 API 单元 713 项通过；新空库经根入口应用 20 项迁移后，真实集成为 172 passed / 1 skipped（Ollama POC）。停止旧认证写入并排空后才可保证切换后的共享上限；不能称混合版本滚动严格限流已通过。旧 `ff80618f…` ZIP 不含这次修复，详见[共享 IP 限流验证](testing/shared-ip-rate-limit-validation-2026-11-07.md)。

当时的 Box `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d` 已包含共享 IP 与 bundle 证据，并通过同包完整本机生命周期。shared、CLI、Web 导出实际模块图、固定版本/PURL 与许可证据；预打包内层仅标候选，缺失许可保留 UNKNOWN。独立审查发现的主机路径泄露已修复，45 项 bundle 与 17 项 schema 回归共 62 项通过；修复后重构建 6/6，61 个受管输出/侧车与已验收归档哈希相同。当时扫描逐文件绑定 Box 12491 个文件，276 条组件、23 条 UNKNOWN；独立 CLI 74 个文件、仍只由 Syft 识别 Node。两份实际 CycloneDX 1.7 文档通过严格离线结构/格式语法校验；这没有证明组件覆盖或许可合规，整体仍为 `DRAFT_PARTIAL_COVERAGE`。见[bundle 验证](testing/bundle-evidence-validation-2026-11-07.md)、[制品扫描](testing/artifact-sbom-validation-2026-11-07.md)和[UNKNOWN 分类](testing/artifact-unknown-classification-2026-11-07.md)。最终干净 SHA、远端 CI、B1–B6 外部或产品门禁仍未关闭。

## 2026-11-07 全仓格式与 ESLint 收尾

Node.js 24.22.1 下完整执行 `pnpm format:check` 与 `pnpm lint:eslint`，两项均 exit 0。本轮修正历史 `.p0a` 隔离生成目录和临时预览脚本的忽略范围，删除 Knowledge 页未使用的 import，为 pnpm 定位器的空 catch 添加说明，并格式化两份 onboarding 文档。定向改动、日志 SHA-256 和适用范围见[质量检查收尾记录](testing/quality-closeout-2026-11-07.md)。

Knowledge 输入文件的 SHA-256 已由旧 bundle 记录的 `22212f6f48a9604e293bd1f0d5d22bb94671d5f251ac63a28aabebb0031867eb` 变为 `3f3f714cc770e06d66917591e6e1127f7c65a002283ea2db4065fce0f057a541`。上述 Box `029bbab6…` 的构建、扫描和生命周期证据继续只对应其历史来源，不能据此称当前源码已完成制品验收；当前源码仍需新的隔离构建、打包和相应验证。依赖四项公告继续保持开放，最终干净 SHA、远端 CI 和外部验收门禁仍未关闭。

## 2026-11-07 Node.js 20.19.0 后续验证

后续使用官方校验的 Node.js 20.19.0 与 pnpm 10.28.2，在隔离源码副本完成 frozen 安装、无缓存全仓 build 6/6、type-check 10/10、test 8/8，以及 18 项契约、71 项脚本防护。完整 API coverage 为 904 passed / 1 skipped，全局 lines 82.18%、branches 68.71%；工件仓储新增 19 项有意义的安全回归后达到该路径门槛，未降低任何阈值。根入口真实 PostgreSQL 集成为 172 passed / 1 skipped，20 项迁移已在同一新建测试库应用，漂移检查无发现。真实 Chromium 3 项通过仍只覆盖账户、CSRF 和 QA 人工签字；mock API UI review 54 项不能当作完整产品闭环。首次失败、修复、各次来源及日志摘要见[质量收尾记录](testing/quality-closeout-2026-11-07.md)。

当时的 Box ZIP 为 197865930 字节，SHA-256 `96d555cd90526eee9b3ad6aaf541fdb2d1bbb604d6b155c26f3e1a70b24ec49e`；CLI ZIP 为 36718187 字节，SHA-256 `f7c1ed041b90c51be34028a56ad2c757c8190c3941e14bbd923463552632ae30`。该包已纳入 Knowledge 输入变化、共享 IP 修复和依赖处置，同包完整本机生命周期通过：20 项迁移、四阶段健康、备份验证、55 张表、恢复标记及自有服务停止。该 ZIP 的独立扫描、bundle 验证、两份 CycloneDX 1.7 校验及 62+30 项防护通过；Box 仍为 276 条组件、23 条 UNKNOWN，独立 CLI 的 Syft 记录仍只有 Node，整体继续 `DRAFT_PARTIAL_COVERAGE`。完整输入绑定和覆盖缺口见[制品扫描](testing/artifact-sbom-validation-2026-11-07.md)、[bundle 验证](testing/bundle-evidence-validation-2026-11-07.md)和[UNKNOWN 分类](testing/artifact-unknown-classification-2026-11-07.md)。

工作区依赖的 esbuild、glob 和 minimatch 公告路径已用限定调用方的兼容覆盖处置，deepmerge 加入本地补丁并通过 12 项回归；全量审计为 840 个依赖、1 项低危，其余严重程度为零，生产 166 个依赖零项。deepmerge 的版本公告继续保留，无审计忽略或风险豁免，详见[依赖处置记录](security/dependency-audit-2026-11-07.md#同日后续兼容覆盖与本地补丁)。上述各项均来自 `739367a` 加未提交改动的本机快照，仍未满足最终 clean SHA、远端 CI、新机、旧版本升级、卸载、生产或外部真实团队验收，不能把 P0/P1/P2 标记为全部完成。

## 2026-11-07 基线、列表与页面后续验证

正式 PRD/Understanding 发布已在同一事务推进基线、失效受影响任务与开放评审、保留历史，并生成角色确认通知。九项真实数据库回归和新增真实浏览器链覆盖旧认领及快照拒绝、新基线交付、三角色确认和重新批准。详情页标签切换竞争已修复，Web 单测 529 项和最终真实 Chromium 四项通过。API 完整覆盖率 923 passed / 1 skipped，全局 lines 82.93%、branches 69.57%；真实集成 181 passed / 1 skipped。跳过项仍为真实 Ollama POC。这些后续检查不能改写前述全仓快照的时间和范围。详见[基线变更验收](testing/baseline-change-validation-2026-11-07.md)。

修订列表已改为只读元数据，去除正文加载；真实本地单次微基准显示仓储方法 p50 从 59.2194 ms 到 3.7751 ms，100 个 128 KiB 修订的逻辑正文读取从 12.5 MiB 到零。该结果不代表 HTTP、并发容量或生产延迟；历史行数、N+1 及其他列表聚合仍需设计，见[分页审查](testing/pagination-review-2026-11-07.md)。

含上述冻结改动的最新本机 Box 为 `554eae8b559c33f2cf771fae36eb4163aaca1c2bd976287da1c302e3c9035c6e`，CLI 为 `6c5bd81bd745971856337aff6febe0e76a431857714ba0f47db6fb24f56f1780`。同包完整生命周期、实际 ZIP 扫描、模块侧车和两份 CycloneDX 1.7 校验通过，SBOM 仍部分覆盖。具体长度、摘要和来源见[质量收尾](testing/quality-closeout-2026-11-07.md#同日后续基线失效列表优化与最新本机包)。本机包和验证绑定该轮冻结源码，不自动涵盖其后工作树的并行改动。

## 当前仍未验证

统一的 `pnpm verify` 已接入 CI。2026-11-09 r8 的 901 文件完整通过保留历史范围；r12 的完整浏览器失败和独立 UI 失败也没有改写。r13 由 r12 的 915 个冻结文件加三个最小测试修复构成，frozen 安装成功，冻结前无 dist/generated client；在新空库完整运行 exit 0 / LOCAL_QUALITY_PASSED：API 812、Web 556、CLI 288 passed / 2 skipped、脚本 240 passed / 1 skipped、真实 PostgreSQL 194 passed / 1 skipped、Chromium 4/4、UI 55/55、API coverage 1006 passed / 1 skipped，lines 83.39%（5995/7189）、branches 70.54%（4548/6447）。20 项正式迁移、18 项契约、无缓存生产构建 6/6 和 schema drift 均通过，915 个文件后置指纹一致。清单 SHA256 为 `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b`，完整日志为 `d17d33f102fde6be4862df4aa723928ea25cebc632fc4dc165d06d31c4840fdc`，稳定证据在 `G:/yesgoo/workmesh-validation/20261109-r13/completed/`。本次状态文字和后续并发 live 修改不属于该清单。

生产首页为 6 个 JS 文件、284314 B raw / 94516 B gzip，入口为 239134 B raw / 78646 B gzip；React 生产实现 8 个、开发实现 0 个。原始首屏 <200000 B 目标仍开放，gzip 是本机逐文件 level 6 估算。2026-11-10 同源 small/history 两组 HTTP 基准实际 exit 0 / PASS，各 160 个测量请求零错误、16 个权限探针通过，Board `limit=7` 遍历分别以 4/25 个正确性请求验证 5/50 个任务和需求，两库独立 SQL 确认 53 张业务表全零，源码 915 文件后置无变。history 为 100 文档 × 100 修订，文档列表响应仍达 5352332 B、并发 8 p95 为 1453.4321 ms，显现修订历史读取放大；不是生产容量承诺。原 PostgreSQL 进程在 11 月 9 日异常退出，次日重启并重新核验后才运行基准，不能据这些成功结果称服务连续稳定，详见[HTTP 基准记录](testing/api-benchmark.md)。

Board 已实现准确统计、全局筛选和服务端分页；文档修订、需求完整历史、ready 扫描预算、flow metrics 和 Workbench 完整性仍需逐项整改，见[分页审查](testing/pagination-review-2026-11-07.md)。109 处 findMany 的全量语义清单是历史盘点，不能当作后续并发 live 源码的当前计数或容量验收。

2026-11-10 从 r13 实际生产输出重新生成的 Box `09d0d2ba…` / CLI `7c06512d…` 已完成同包隔离生命周期与独立扫描。20 项冻结迁移、四阶段健康、55 表备份、恢复标记和自有服务停止通过；扫描与两份 CycloneDX 1.7、许可证文本字节核验通过。915 源码和 807 项选定打包输入仍一致。整体继续为 `DRAFT_PARTIAL_COVERAGE`，不等于完整原生许可或正式发布，也不覆盖后续 live 改动。发布入口已加入 Security 与 CI、Platform smoke 同 SHA 联动；18 项门禁回归通过，真实远端结果仍待。详情见[同包生命周期](testing/box-lifecycle-validation-2026-11-07.md)、[制品扫描](testing/artifact-sbom-validation-2026-11-07.md)和[许可证分发验收](testing/license-distribution-validation-2026-11-07.md)。

1. GitHub live：真实仓库、PR、reviews 分页、Webhook 投递和提交级代码证据的端到端联调。
2. 完整浏览器产品闭环：代码项目从 IMPL 到 RELEASE 的发布链、超出上述范围的变更传播；跨浏览器与无障碍验收。
3. 生产运维：生产库迁移、生产备份恢复、升级回滚、容量、长时间稳定性和灾备。
4. 安装生命周期：Windows 最终制品的新机、旧版本升级与卸载仍待；Linux/macOS 安装、服务管理及恢复是扩大平台支持范围前的门禁。
5. 外部使用证据：尚无外部真实团队完成并签署一条交付链路。
6. 未来协议：澄清服务 API、任务精确恢复、15 章 PRD、原型 verify 和产品/QA 归档闭环仍在开发计划中，应作为路线图公布，并按实际完成范围说明开发版能力。

## 2026-11-10 工作台交互模块按需加载

后续 live 的 ChangeDrawer 静态 shared 依赖使隔离生产首页达到 468746 B raw。仅叠加工作台两个窗口的按需加载及相关测试四文件后，首页降至 **284700 B raw / 94926 B gzip**，减少 184046 B / 39.26%，原 `<200000 B raw` 目标仍未达。该比较用同一份 1025 文件基线加四文件覆盖得到 1027 文件，没有混入同时进行的 API/CLI/shared 修改；运行后指纹一致。Web 658/658、类型检查、定向 ESLint、生产构建及生产 Chromium 的三项受控脚本加载/关闭/失败检查均实际通过。首次旧同步单测失败和浏览器 harness 焦点预期失败各自保留，见[按需加载验收](testing/workbench-dialog-loading-validation-2026-11-10.md)。本切片未重跑 API/数据库/完整门禁、未重新打包；r13 的完整门禁和包不覆盖该四文件，当前 live 其他改动也未自动纳入此轮。

Prisma 5 → 6 的精确候选、审计关联兼容、引擎矩阵和旧包升级/回退方案已形成[升级计划](operations/prisma-6-upgrade-plan.md)，补齐原 P2 的计划要求；依赖仍为 5.22.0，升级验收均未执行。

## 解释

当前仓库是可自部署的开发版。已记录的本地隔离验证证明实现链路可以运行，但不能替代最终 commit 的远端 CI、生产环境检查、外部 GitHub、跨平台安装或真实团队使用证据。
