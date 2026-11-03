# 2026-11-03 本机部署与团队使用验收

范围由用户确认：本机完整验收，创建隔离测试团队和测试项目。所有账号、项目、交付文档和数据库均为可丢弃测试数据。没有部署到公网，也没有给真实团队成员发消息。

## 环境与证据

Windows x64；Node.js v20.13.1；pnpm 10.28.2；随包 PostgreSQL 17.11。测试工作目录为 `G:\yesgoo\workmesh`。原有 5432 开发实例未作为验收目标；生命周期测试前后确认该实例 PID 16888 保持不变。

| 用途              | 配置                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 主验收 Web        | `http://127.0.0.1:5180`                                                                                                          |
| 主验收 API        | `http://127.0.0.1:3100/api/v1`                                                                                                   |
| 主验收 PostgreSQL | `127.0.0.1:55432/workmesh_test_acceptance_20261103`                                                                              |
| 团队与需求        | TEAMBU / TEAMBU-001，前端开发成员、QA 审核成员、Owner 三人                                                                       |
| 独立集成库        | 55433 / `workmesh_test_integration_20261103`；验收后已停止                                                                       |
| 全新 ZIP 安装复验 | 仓库外的 `%TEMP%\workmesh-box-acceptance-20261103\installed box`，数据目录 `fresh data retry`；55434 / 3102 / 5182；复验后已停止 |
| 主实例安装目录    | `.tmp/team-acceptance-20261103/installed box`                                                                                    |
| 主实例数据目录    | `.tmp/team-acceptance-20261103/box data`                                                                                         |
| 全部日志和截图    | `.tmp/team-acceptance-20261103/`                                                                                                 |
| 本次原始账号资料  | `.tmp/team-acceptance-20261103/team-state-primary.json`；仅本地忽略目录保存测试密码                                              |

另一个并行验收曾覆盖日期共享的 `team-state.json`。本次原始团队资料已恢复为 `team-state-primary.json`，被覆盖后的文件予以保留；脚本默认输出目录现包含独立运行标识，避免同日运行相互覆盖。

## 自动验证

| 检查              | 结果                                                                      | 证据                                       |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| 强制全量构建      | 6/6 Turbo 任务成功，无缓存                                                | `final-build.log`                          |
| 强制类型检查      | 8/8 任务成功，无缓存                                                      | `final-type-check.log`                     |
| 最终全量单元测试  | 742 项、100 个测试文件通过，8/8 Turbo 任务成功                            | `final-unit-tests-complete.log`            |
| API 集成测试      | 51 项、6 个文件通过，无跳过；包含真实 PostgreSQL 发布与并发一致性         | `baseline/integration-api-suite-final.log` |
| 迁移与 schema     | 12 项迁移全部应用；Prisma diff 无差异                                     | `baseline/summary.json` 及 migration 日志  |
| 运行时契约        | 16/16 通过                                                                | `final-contracts.log`                      |
| 安装包专项回归    | 4/4 通过                                                                  | `deployment-regressions.log`               |
| PowerShell 语法   | install、start、stop、package 脚本解析通过                                | 本次终端检查                               |
| 下载 CLI 独立运行 | HTTP 下载与 SHA-256 对比通过；解压至仓库外运行 `workmesh.cmd --help` 成功 | `cli-outside-repo-help.log`                |

完整测试命令：

```powershell
.\node_modules\.bin\turbo.cmd run build --force --concurrency=1
.\node_modules\.bin\turbo.cmd run type-check --force --concurrency=1
.\node_modules\.bin\turbo.cmd run test --force --concurrency=1
pnpm --filter @workmesh/api test:integration
node scripts/test-contracts.mjs
node --test scripts/box/web-server.test.mjs scripts/box/dependency-links.test.mjs
```

首次并行单元运行出现 Windows `whoami` / `icacls` 上下文文件测试的 5 秒超时。独立执行及限制 Vitest 工作进程后通过，未删除断言或放宽业务门禁。本机 `corepack pnpm` 有签名 keyid 错误，实际使用已安装的 pnpm 10.28.2。构建另有 Vite 主包体积提示、依赖 peer 提示，不影响本次运行结果。

集成测试最初暴露测试夹具错误：缺少 PrismaService 注入、票据和幂等键不是 UUID，以及清理顺序违反外键约束。已修正测试装配、输入和清理顺序，保留发布成功的原有语义断言。最终隔离库中测试创建的账号、项目无残留。集成套件中的部分 HTTP 测试仍使用内存 repository；真实数据库发布和并发套件单独执行通过，不能把所有 51 项都解释成真实数据库测试。

## 实际部署复验

通过 `scripts/package-box.ps1` 构建 Windows ZIP；在仓库外、含空格路径解压，恢复包内依赖链接后安装独立数据库。实际执行并通过：初始化新集群、应用 12 项迁移、启动 API 与 Web、经 Web 代理检查 API 健康、重复启动保持同一 API/Web PID、停止所有本实例服务、数据库冷启动后恢复服务，再完整停止。参考 `fresh-install-retry.log`、`fresh-start.log`、`fresh-idempotent-start.log`、`fresh-stop.log`、`fresh-cold-restart.log`、`fresh-final-stop.log`。

修复脚本已写回修正版 ZIP，并逐项比较归档中的 install/start/stop 与已验证源码的 SHA-256。首次新实例启动曾暴露 PowerShell 输出管道等待 PostgreSQL 子进程的问题；修复后另建全新数据目录重新安装，安装命令正常退出并完成迁移。邀请页回归修复后重新构建 Web，并重新生成最终归档：`.tmp/team-acceptance-20261103/final-package.zip`，SHA-256 为 `876c00ce6424070d09db73d80eff61b4c5c4e74293db6ded3f0b93e1c6a43fbc`；归档构建时使用 `-SkipBuild`，Web 产物由本次 `pnpm --filter @workmesh/web build` 生成。最终 ZIP 的归档条目与打包目录按组件比较后，Web、API、CLI、Box、PostgreSQL runtime 与角色包的文件数量和未压缩字节一致。外层打包目录的下载页包含 Box 与 CLI 两种链接；归档自身的 `downloads/index.html` 只链接归档内实际存在的 CLI 下载文件，避免 Box ZIP 在自身内容中自引用。完整外部解压后运行 `runtime/node.exe app/cli/dist/index.js --help` 退出码 0；归档 SHA-256 与 sidecar 一致。

## 实际团队业务链

创建隔离三人团队 TEAMBU：Owner 承担 product/ops，开发成员承担 frontend，独立审核成员承担 qa。完成邀请、加入和角色分配，并通过浏览器确认成员与项目访问。另用新账号在浏览器完成注册和建项目，验证无成员关系时的空列表。

实际业务链：发布三步流程定义 → 创建需求 TEAMBU-001 与实例 → 下载版 CLI 浏览器授权和角色包安装 → claim → context --materialize → HOSTED 工件交付 → 独立 QA 在 Web 要求修改 → 开发重新认领、生成新快照并再次交付 → QA 在 Web 批准 → QA 交付验证记录、Owner 通过人工会话及密码确认票据批准 → Owner 交付发布记录 → QA 在 Web 二次验证并批准发布。

最终公开 API 核对结果：需求 `0bd2a60e-6bd5-4e46-bc94-4716f564d685` 为 `RELEASED` v5；实例 `8b591b57-ee00-4147-b3ef-cb7e7afe08d8` 的 implement、verify、release 三步均为 `DONE`；待领取任务数 0。发布评审 `2e967da9-3726-4795-bbd9-41986a8dcdce` 为 `RELEASE_ACCEPTANCE` / `APPROVED`，声明的发布槽均有独立 QA 的批准决定。证据：`cli-flow-report.md`、`release-delivery-after-fix.log`、`final-team-state.json`、`ui-release-approved.jpg`。

首次发布交付实际返回 422 `TASK_ACCEPTANCE_GATE_REQUIRED`，暴露产品只派生普通任务验收槽的问题。修复交付与 review-create 两条路径，按已发布定义的当前 step.kind 派生对应类型；RELEASE 只用 RELEASE_ACCEPTANCE，不添加普通任务槽、不修改不可变流程定义。批准事务再次核对类型，保留当前 claim/代次/工件以及“同实例其余任务必须全部 DONE”的门禁。构建并部署修正版后，在同一原始任务上重新交付并完成发布，未直接修改业务数据库。

## 权限与错误路径

通过正式 HTTP 接口验证，无直接数据库写入或测试绕过：

| 用例                   | 实际结果                                                                                  | 证据                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 非成员项目列表         | 不包含 TEAMBU                                                                             | `negative-checks.json`                                                                                                                                 |
| 非成员读取团队成员     | 404 `REQUEST_REJECTED`                                                                    | 同上                                                                                                                                                   |
| 已登录跨 Origin 写入   | 403 `UNSAFE_ORIGIN`                                                                       | 同上                                                                                                                                                   |
| 已登录缺少 CSRF 写入   | 403 `CSRF_FAILED`                                                                         | 同上                                                                                                                                                   |
| Agent 执行人工审批     | 403 `HUMAN_SESSION_REQUIRED`                                                              | `agent-negative.json`                                                                                                                                  |
| Agent 撤销前读取 ready | 200                                                                                       | 同上                                                                                                                                                   |
| 撤销 Agent 凭据        | 已吊销；旧 HTTP 请求返回 401 `AUTH_REQUIRED`，CLI 只读请求退出码 3 并返回 `AUTH_REQUIRED` | `agent-revocation.json`；`.tmp/team-acceptance-20261103/final-cli-revoked-changes.log`、`.tmp/team-acceptance-20261103/final-cli-revoked-snapshot.log` |
| 空评审队列             | 显示 0 项及“当前没有待评审请求”                                                           | `ui-empty-review-queue.jpg`                                                                                                                            |
| 人工退回决定           | 决定历史记录审核成员及意见，原评审只读                                                    | `ui-rework.jpg`                                                                                                                                        |

验收诊断曾意外输出一次测试 Agent secret；相关凭据现已撤销，旧 HTTP/CLI 认证均失败（HTTP 401、CLI exit 3），本报告不复述该 secret。

静态 Web 回归验证错误 URL 编码返回 400、目录穿越被拒绝且进程持续健康；依赖链接回归验证含空格路径重定位、幂等恢复、越界目标拒绝和缺失目标不留下部分恢复结果。

## 备份、恢复与主实例重启

完成业务后停止本实例 API/Web，保持隔离 PostgreSQL 运行以冻结应用写入。使用随包 `workmesh-box backup` 创建 402306 字节 SQL dump，manifest 确认为 55432 / `workmesh_test_acceptance_20261103`、12 项迁移；恢复到同隔离实例上的新库 `workmesh_test_restore_20261103`，49 张表共 346 行逐表行数与排序 JSON 内容 MD5 全部一致。证据：`backup-isolated.log`、`restore-isolated.log`、`backup-restore-comparison.json`。

运维辅助脚本首轮遗漏去除 UTF-8 BOM，环境变量键错误，回退到仓库开发连接。该轮对 5432 / workmesh 执行过只读 pg_dump，并在同实例创建了新临时恢复库；未对源 workmesh 库执行 DDL/DML。已移除该临时恢复库和误生成的 dump，并保留脱敏纠正记录 `ops-target-correction.json`。辅助脚本现先清理 BOM，再对 hostname=127.0.0.1、port=55432、database=workmesh_test_acceptance_20261103 作精确断言，然后完整重跑上述隔离演练。不能将此描述为从未访问过开发实例。

2026-11-03 完成本机主实例冷停止与冷启动。启动后重新检查 API/数据库状态，`post-restart-state.json` 与重启前一致：TEAMBU-001 为 `RELEASED`，implement、verify、release 三步均为 `DONE`，待领任务为 0；`final-doctor.log` 报告 55432 数据库、3100 API、5180 Web 全部健康。主实例当前仍在运行；原有 5432 开发实例前后均为 PID 16888，验收服务端口没有监听 55433、55434 或 3102、5182。证据：`main-cold-stop.log`、`main-cold-start.log`、`post-restart-state.json`、`final-doctor.log` 及最终端口/PID 检查。

## 修复清单

1. ZIP 丢失 pnpm Windows junction，导致解压安装缺少 Prisma 及运行时依赖。新增相对链接 manifest、打包采集与安装恢复；验证路径边界和恢复前目标存在性。
2. CLI 重复 shebang、ESM 内动态 require 和缺少独立包元数据，导致实际下载件无法启动。修正 tsup banner，加入 createRequire 及 ESM 元数据。
3. CLI setup 未搜索下载 ZIP 的 `runtime/../roles`，独立下载件找不到角色包。补充发现路径及回归。
4. 安装忽略原生命令失败、可能误用已占用数据库端口。改为检查退出码、校验实例数据目录、端口与 schema。
5. 服务启动的路径引号、健康判断与重复启动；停止脚本可能影响未托管进程。改为进程状态文件及可执行文件/脚本路径核验；在含空格目录验证。
6. 首次 PostgreSQL 启动在重定向 PowerShell 输出时管道不返回。改为单独日志及等待 pg_ctl 本身退出；停止脚本补正 Test-Path 布尔表达式。
7. 静态 Web 服务器错误 URL 解码可导致退出、路径前缀检查不完整。加入错误处理、相对边界/realpath 校验及安全 index fallback。
8. 同日验收脚本产物目录冲突。默认按独立运行标识输出，可用 `WORKMESH_ACCEPTANCE_OUTPUT_DIR` 指定。
9. CLI review subject 修复为恰好一个 subject；缺少、双提供、仅 ArtifactSet、仅 DocumentRevision 四种组合回归通过。CLI 单 worker 全量单测 12 文件/90 tests 通过，build 与 type-check 通过。日志：`.tmp/team-acceptance-20261103/final-cli-unit-tests.log`、`.tmp/team-acceptance-20261103/final-cli-build.log`、`.tmp/team-acceptance-20261103/final-cli-type-check.log`。
10. 生产挂载的邀请页原先直接渲染 `Invite`，导致 `useParams()` 取不到 token，浏览器请求了 `/api/v1/invitations/`。`App.tsx` 现在把 `matchPath('/invite/:token')` 得到的 token 显式传给 `Invite`，`Invite.tsx` 同时保留 Route 场景兼容；Web 单元测试新增生产挂载回归。重新部署到 `.tmp/team-acceptance-20261103/installed box` 并重启后，真实邀请 URL `http://127.0.0.1:5180/invite/wmi_zOhGdQ-ndAkWxiWuHbUBW9lwp9XuhxxKtaswcpYBxbc` 已显示 TEAMBU 项目与“前端”角色，验证请求不再丢失 token。

## 验证边界

这是 Windows 单机、loopback HTTP 与隔离测试数据的验收。实际 UI 检查通过浏览器逐步操作完成；没有把它包装成持续 CI 浏览器套件。交付使用 HOSTED 文档，检查项明确保留 Agent 自述属性；未声称外部 CI 或真实 Git 提交已获人工代码审查。

以下未由本次验收覆盖：Linux/macOS、远程多机团队/真实 SSO、公网 TLS/反向代理与生产密钥配置、真实 GitHub PR/webhook 全链路、SMTP 实际发送、Redis 运行、压力/长时间稳定性、生产升级回滚和外部灾备。GitHub live 无外部授权，现有 live runner 也未完成实现；不能据此宣称生产全能力通过。

其他并行工作在同一工作区中持续修改文件。验收保留这些修改，未重置、提交或推送工作区。这里记录的是相应日志对应的实际快照；后续产品代码变更仍需重跑相关检查。
