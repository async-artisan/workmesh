# 完整本地验证入口验收：2026-11-07

本记录保留新增 `pnpm verify` 的实际运行结果和失败修复。来源是 `739367a714097a825b96ca7ecf6bce3372855a77` 加未提交改动的隔离源码副本，不能替代最终干净 commit、远端 CI 或发布批准。使用方法见[完整本地验证](local-verification.md)。

## 环境与范围

- Windows，官方 Node.js 20.19.0，pnpm 10.28.2。Node 可执行文件 SHA-256 为 `6e3a39787e667d50487f7335c85636c2823a53e636d73c2c841d45da4e57906c`。
- 源码副本和原始日志位于本机 `G:/workmesh-verify-validation-20261107-r1`，不作为公开发布资产。副本完成 frozen-lockfile 安装。
- 显式专用库为 loopback 58390 的 `workmesh_test_verify_20261107`，schema 为 `workmesh_v1`；独立测试身份通过配置及真实 SQL 探针核验。应用 URL 使用不可连接的占位目标，不从它推导测试库。
- 数据库套件串行运行。浏览器使用专属端口；UI review 默认 55444，严格拒绝端口占用且不复用已有服务。已有 5173 服务未停止或复用。

入口不创建数据库、不安装浏览器、不调用真实 GitHub/模型、不发布制品。默认要求已有迁移 schema；只有显式 `--apply-migrations` 才允许在身份核验后执行正式迁移。

## 安全与跨平台入口

`scripts/verify.mjs` 固定 pnpm 版本、使用当前 Node 和参数数组、关闭 shell，并在任一步骤非零退出、信号中止或执行失败时停止。参数只有帮助和迁移授权，没有跳过数据库、浏览器或覆盖率的成功模式。CI 和 Bash 转发脚本调用同一个入口。

真实只读探针验证了：缺少 schema 时默认拒绝；显式迁移模式在数据库、用户和服务器身份匹配时允许继续；随后正式 Prisma generate 成功。探针在短生命周期子进程加载原生 Prisma 引擎，避免 Windows 父进程保留 DLL 导致后续生成失败。探针错误不会转发可能包含连接串的 ORM 文本。

验证器后续聚焦测试 21 项通过，包含构建环境与测试环境互不污染的回归。UI review 初次在缺少 shared 构建的独立命令中为 47 passed / 7 failed；构建 shared 后为 54/54，通过记录与首次失败均保留。完整入口本身先构建 shared。

## 完整命令的失败与修复

| 轮次 | 实际命令和终态                              | 发现及处理                                                                                                                                                                        |
| ---- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r1   | `pnpm verify -- --apply-migrations`，exit 2 | 身份及格式通过，API lint 缺少角色包构建输出。Turbo lint 增加依赖包 build，避免依赖已有 dist。                                                                                     |
| r2   | 同上，exit 1                                | 全仓静态、单元及契约通过，向专用空库应用 20 项迁移；真实集成为 185 passed / 1 failed / 1 skipped。恢复测试缺少实际 QA 角色及合法前置条件，触发生产认领约束。                      |
| r3   | `pnpm verify`，exit 1                       | 真实集成 186 passed / 1 skipped、漂移和构建通过；真实浏览器 3 passed / 1 failed，基线用例准备阶段继承前两个账户测试的 IP 请求额度，收到 429。未运行其后的 UI review 和 coverage。 |
| r4   | `pnpm verify`，exit 1                       | 无缓存构建、真实数据库与 bundle 检查通过；Chromium 3 passed / 1 failed。账户测试的“新建项目”同时匹配页面顶部和空状态两个按钮，严格选择器拒绝点击。后续入口未运行。                |
| r5   | `pnpm verify -- --apply-migrations`，exit 1 | 新空库身份与生成器检查通过，但先前并行页面改动的两处格式不符，格式门禁停止。没有运行迁移或后续检查；已格式化两文件，失败日志保留。                                                |

r2 的夹具先补齐实际角色并构造无证据的已完成前序，定向 9/9 通过，r3 使用该版本。独立审查后进一步改为在冻结工作流建立前定义合法、无前序依赖的 QA 基线消费者，继续保留 `PUBLISHED_PRD` 和真实认领路径。其他 DAG 测试保留原依赖。这个更准确的夹具随后定向真实数据库 9/9 通过，但不追溯扩大 r3 的覆盖范围。生产认领约束未为夹具放宽。

r3 的 429 是正常生产限流。浏览器用例增加准备阶段之前的完整窗口等待，在新页面 `about:blank` 上停留，不提高额度、不绕过限流、不自动重试写请求。随后在同一隔离目标按原顺序运行两个账户测试及基线测试，3/3 通过、exit 0，总耗时 3.2 分钟；基线测试 3.1 分钟。格式、ESLint 和独立 TypeScript 检查通过。该文件与副本 SHA-256 均为 `4f715415d477b81f678283fcf68e3c832d9dfe725260a8c0c2072270a96deed3`。这一定向结果不能代替完整入口复验。

r4 中基线测试及业务链均通过；账户测试定位改为页面顶部的按钮后，仍须整套重跑确认。r5 冻结了 897 个受管源码文件，清单 SHA-256 为 `aaa8de49f85c888216aeb5a9e7e134b9dd7fef692a1be2b5a35022e8575f884c`，其中包含后来修正格式前的页面。r5 的专用空库为 `workmesh_test_verify_r5_20261107`；失败前实际数据库身份为 `postgres / 127.0.0.1`，schema 尚不存在。后续源码及文档变化不属于该冻结清单。

## r3 已完成的门禁

下列结果来自同一次 r3 命令，不能把终态写成完整验证成功：

| 检查                           | 结果                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 全仓格式、ESLint               | 通过                                                                                                       |
| 无缓存 lint / 类型             | 各 10/10 任务，串行、0 cached                                                                              |
| 无缓存工作区测试               | 8/8 任务，0 cached                                                                                         |
| 单元数量                       | API 761、Web 529、CLI 288 passed / 2 skipped、shared 73、role-packages 24、Box 23                          |
| 脚本防护                       | 155 项，154 passed / 1 skipped；Windows 当前身份不能创建 symlink 的测试显式跳过，junction 防护另有实际覆盖 |
| 隔离 Prisma、运行时契约        | 通过，18 项契约                                                                                            |
| 真实 PostgreSQL 集成           | 21 文件通过 / 1 跳过，186 passed / 1 skipped；跳过真实 Ollama POC                                          |
| schema drift                   | 无差异                                                                                                     |
| 无缓存生产构建                 | 6/6 任务，0 cached                                                                                         |
| shared / CLI / Web bundle 绑定 | 通过，保持 `PARTIAL_MODULE_EVIDENCE`                                                                       |
| 真实 Chromium                  | 3 passed / 1 failed，限流失败保留                                                                          |

## r6 完整通过与 r7 生产环境复验

r6 在 `workmesh_test_verify_r6_20261107` 上执行 `pnpm verify -- --apply-migrations`，真实退出码 0，终态为 `LOCAL_QUALITY_PASSED`。单元测试 API 775、Web 531、CLI 288 passed / 2 skipped、shared 73、role-packages 24、Box 23；真实 PostgreSQL 187 passed / 1 skipped，Chromium 4/4、UI review 54/54、API coverage 962 passed / 1 skipped，lines 83.02%（5855/7052）、branches 69.92%（4415/6314）。真实 Ollama POC 仍跳过。该轮冻结清单共 897 文件，SHA-256 为 `cd8fab24f9e3a6e44d46928d7f87721c7f55e41a0d5a6927a5806ca0edefc4b9`。

随后检查发现当时 verifier 为所有步骤统一继承 `NODE_ENV=test`，使 Web 构建包含 React 开发实现。r6 的完整命令通过结果保留，但不能用它证明生产构建正确。修复后 `build-shared-guard` 与 `workspace-build` 使用各自独立的 `NODE_ENV=production`，测试、数据库、浏览器和覆盖率继续使用 `test`。此前表格中的构建成功仅指当时命令退出成功。

r7 重新冻结 900 文件，清单 SHA-256 为 `080f655e2cf0105cdb6660fd3d1e61b0e69c7262dbad85c25388f4e4f26f8cad`，包含环境修复、reviewer 批量判定、工作台并发上限及 HTTP 基准入口。使用新的 `workmesh_test_verify_r7_20261107` 空库运行相同命令：20 项迁移、格式、无缓存 lint/类型/单元、196 passed / 1 skipped 脚本防护、隔离 Prisma、18 契约、187 passed / 1 skipped 真实数据库、漂移、无缓存构建、三份 bundle 绑定及 Chromium 4/4 均通过。

r7 最终退出码 **1**：UI review 53 passed / 1 failed，390px 基础弹窗用例在弹窗可见后立即按 Escape，归档弹窗没有关闭；门禁在 `ui-contracts` 停止，未运行 API coverage。失败截图、trace 和报告复制保留在本机 `r7-ui-review-results`。不能将 r6 的 coverage 合并为 r7 整体成功。

r7 全部 49 个 Web 产物及侧车绑定通过；实际 rendered 的 React、ReactDOM、JSX runtime 和 scheduler 均为生产实现，开发实现为零。HTML 入口静态 JS 为 244704 B raw / 80060 B gzip，已登录 `/` 工作台闭包为 11 文件、338760 B raw / 112167 B gzip；CSS 与 HTML 单列在本机 `r7-bundle-measurement.json`。gzip 是逐文件 level 6 压缩的本机估算，未测实际网络传输。原始首屏 JS 小于 200000 B 的目标仍未达成，不能用 gzip 数字替代。

## 2026-11-09 r8 干净目录完整复验

r8 使用新的 `G:/workmesh-verify-validation-20261109-r8/source`，先执行 `pnpm install --frozen-lockfile`（exit 0），再同步冻结 901 个受管/非忽略源码文件。运行前 API、Web、shared 的 dist 和 generated Prisma client 都不存在。基线仍为 `739367a714097a825b96ca7ecf6bce3372855a77` 加未提交工作树；这是干净构建目录，尚不是干净提交或正式发布。清单 `source-r8-frozen.json` 的 SHA-256 为 `e0964ba075e262d285b4726030b628d0176966416bbb3a9f3d44f7de0e3fa971`，完整运行及后续 HTTP 基准结束后，逐文件复核无变化。

同一源码在新空库 `workmesh_test_verify_r8_20261109` 上运行 `pnpm verify -- --apply-migrations`，实际 **exit 0 / LOCAL_QUALITY_PASSED**。Node.js 20.19.0、pnpm 10.28.2、PostgreSQL 17.11；只使用已核验的自有 loopback 58390 实例。检查不使用 Turbo 缓存。

| 检查                      | 本次实际结果                                                                      |
| ------------------------- | --------------------------------------------------------------------------------- |
| 格式、ESLint、lint、类型  | 全部通过；lint/type-check 各 10/10 任务、0 cached                                 |
| 工作区单元测试            | API 775、Web 536、CLI 288 passed / 2 skipped、shared 73、role-packages 24、Box 23 |
| 脚本防护与运行时契约      | 201 passed / 1 skipped；18 契约通过                                               |
| 正式迁移与真实 PostgreSQL | 20 项迁移；187 passed / 1 skipped；schema drift 无差异                            |
| 生产构建与 bundle         | 6/6 任务、0 cached；shared/CLI/Web 绑定通过，仍为部分模块证据                     |
| 真实 Chromium             | 4/4；账户、CSRF、基线变更和 QA 人工签字链                                         |
| UI review                 | 54/54，包括 r7 失败的 390px Escape 关闭检查                                       |
| API coverage              | 962 passed / 1 skipped；lines 83.02%（5855/7052）、branches 69.92%（4415/6314）   |

数据库与覆盖率跳过项仍为真实 Ollama POC；脚本跳过项仍为当前 Windows 身份不能创建 symlink 的用例，junction 防护另有实际覆盖。没有降低门槛、增加自动重试或移用旧轮次结果。

r7 的弹窗失败来自 DOM 提交可见之后、被动 effect 注册键盘处理之前的时序窗口。Modal 改用 layout effect 同步栈层、回调、焦点和键盘监听，并在 Escape 时只允许当前顶层处理且阻止同事件继续关闭下层。父组件 layout effect 在弹窗提交后立刻派发 Escape 的确定性回归证明修复；聚焦 Modal 13/13 和本次完整 UI 均通过，没有为该用例添加等待。

本轮还将工作台评审抽屉内的 ReviewDecision 延后到实际打开时加载，保持外层 Modal 和已有 ErrorBoundary。新增两项回归覆盖关闭时不加载、加载期间关闭与焦点归还、加载完成不自行重开、决定回调和异常传播。生产产物中 React、ReactDOM、JSX runtime、scheduler 均为生产实现，开发实现为零。HTML 入口 JS 为 244696 B raw / 80068 B gzip；已登录 `/` 首页静态依赖及运行时 preload 的 JS 闭包为 **6 文件、285867 B raw / 94391 B gzip**，较 r7 raw 减少 52893 B（15.61%）。这是本机逐文件 level 6 gzip 估算，未测网络传输；原始首屏 <200000 B 仍未达到。ReviewDecision 已不在首页闭包内；独立 shared/AJV chunk 只属于 Authorization/Workflows，不能当作首页体积来源。

r8 的 Web dist、API coverage、browser 和 UI 结果分别另存到同根的 `r8-web-dist`、`r8-apps-api-coverage`、`r8-browser-results`、`r8-ui-review-results`。后续在另一新库的 HTTP 基准也已通过，见 [HTTP 基准记录](api-benchmark.md#2026-11-09-新库复验)。本节及后续状态、分页盘点等文档更新发生在冻结之后，不属于上述 901 文件清单；不能把新增文字追溯为被该轮格式门禁检查过的版本。

## 2026-11-09 r12 失败与 r13 同源完整复验

r12 在保留的 915 文件快照上执行完整入口，最终 exit 1：真实 Chromium 3 passed / 1 failed，基线变更测试仍查找旧按钮“确认已处理”，实际界面为“确认已知悉”，因此没有发出 ACK。入口在浏览器步骤停止，没有运行其后的 UI 和 coverage。随后相同冻结源码的独立 UI 为 53 passed / 2 failed，分别是工作台旧行动按钮文案及 Board 对开发 StrictMode 首屏请求数的错误绝对计数；独立 API coverage 1006 passed / 1 skipped、lines 83.39%、branches 70.54% 通过。这些独立结果不能把 r12 拼接成整体成功。原始失败日志、截图、trace、清单与独立报告保存在 `G:/yesgoo/workmesh-validation/20261109-r12`，详见[Board 验收记录](board-pagination-validation-2026-11-09.md#r12-最终结果及独立检查)。

r13 由 r12 的 915 个冻结文件逐字节校验后复制，仅应用三个测试修复：同步 ACK 按钮、明确展开技术详情后核对修订 ID；同步工作台精确行动按钮文案；记录 Board 续页前首屏请求数并断言续页没有新增首屏请求。原 ACK 结果、版本、任务定位、准确总数与独立续页断言保留，没有增加重试或降低阈值。没有复制后续并发 live 工作区变更。锁文件 frozen 安装 exit 0；冻结时 API/Web/shared dist 和正式 Prisma client 均不存在。

使用官方 Node.js 20.19.0、pnpm 10.28.2，以及经二进制哈希、进程、监听和 SQL 身份核验的自有 PostgreSQL 17.11 `127.0.0.1:58412`，在新空库 `workmesh_test_verify_r13_20261109` 上运行 `pnpm verify -- --apply-migrations`，实际 **exit 0 / LOCAL_QUALITY_PASSED**。原始完整日志创建于 **2026-11-09 22:20:35**、末次写入于 **22:36:39（Asia/Shanghai）**；2026-11-10 核对终态、再次检查 915 个冻结源码文件均未变化并保存汇总。整理日期不是另一次执行日期。

| 检查                      | r13 实际结果                                                                      |
| ------------------------- | --------------------------------------------------------------------------------- |
| 格式、ESLint、lint、类型  | 全部通过；lint / type-check 各 10/10 任务、0 cached                               |
| 工作区单元                | API 812、Web 556、CLI 288 passed / 2 skipped、shared 73、role-packages 24、Box 23 |
| 脚本防护与运行时契约      | 240 passed / 1 skipped；18 项契约通过                                             |
| 正式迁移、真实 PostgreSQL | 20 项迁移；194 passed / 1 skipped；schema drift 无差异                            |
| 生产构建与 bundle         | 6/6 任务、0 cached；shared/CLI/Web 绑定通过，仍为 `PARTIAL_MODULE_EVIDENCE`       |
| 真实 Chromium、UI review  | 4/4、55/55，包含 r12 原失败场景                                                   |
| 完整入口内 API coverage   | 1006 passed / 1 skipped；lines 83.39%（5995/7189）、branches 70.54%（4548/6447）  |

集成和覆盖率跳过项仍为真实 Ollama POC，脚本跳过项仍为当前 Windows 身份不能创建 symlink 的用例；CLI 两项跳过保持原范围。冻结清单 SHA256 为 `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b`，完整日志 SHA256 为 `d17d33f102fde6be4862df4aa723928ea25cebc632fc4dc165d06d31c4840fdc`。基线仍为 `739367a714097a825b96ca7ecf6bce3372855a77` 加获准未提交改动，不能称为最终干净提交。

稳定源码备份为 `G:/yesgoo/workmesh-validation/20261109-r13/source-snapshot`，终态证据为同根 `completed/`，包含 `verify-full-r13.log/.exit`、`source-r13-frozen.json`、`r13-source-preflight.json`、`r13-source-delta.json`、`r13-validation-summary.json`，以及 Web dist、coverage、browser 和 UI 结果。原源码执行目录为 `G:/workmesh-verify-validation-20261109-r13/source`。本次追加文档在冻结之后，不属于 915 文件清单；后续 live 修改、文档整理、HTTP 基准与新制品不能追溯算入本次门禁。

生产首页为 **6 个 JS 文件、284314 B raw / 94516 B gzip**，入口为 **239134 B raw / 78646 B gzip**；React 生产实现 8 个、开发实现 0 个，ReviewDecision 仍延后加载。gzip 是本机逐文件 level 6 估算，原始首屏 <200000 B 目标仍未达到。2026-11-10 同源 small/history 两组真实 HTTP 基准随后实际通过，各 160 个测量请求零错误、16 个权限探针及 Board 分页正确性通过，两库独立核对 53 张业务表全零，915 文件后置指纹无变化，见[HTTP 基准记录](api-benchmark.md)。万条修订数据仍显示文档列表读取放大，未形成生产容量承诺；原 PostgreSQL 进程异常退出后是重新启动、核验再运行，不能称服务连续稳定。随后从本轮生产输出生成新 Box/CLI 并完成同包隔离生命周期和扫描，见[生命周期增量](box-lifecycle-validation-2026-11-07.md#2026-11-10-r13-同源新包复验)；r8 小数据基准和更早 ZIP 仍只证明各自历史来源。

## 并发认领边界

认领仓储在项目锁内重新检查已归档状态，防止服务层可写检查之后项目被归档、随后认领仍写入的竞争。修复前实际红测观察到认领成功及版本推进；修复后聚焦单元 50 项、真实 PostgreSQL 任务套件 29 项通过。已有角色、成员、凭据、前序和代次约束继续保留。

更准确的 QA 夹具同步后，完整 API coverage 独立运行通过：104 文件通过、1 文件跳过，947 passed / 1 skipped（真实 Ollama POC）；lines 82.96%（5839/7038），branches 69.75%（4403/6312），全部既有门槛通过，未降低阈值。这次结果仍独立于完整入口，不能把 r3 的终态改为成功。

## 已核对日志

以下 SHA-256 绑定本机保留的文件；退出码来自真实进程及同名 `.exit` 记录，不从日志文本推断成功：

| 文件                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `verify-full.log`                  | `9b70d75855842c4fdbfd6ec46c21048afb07073f3b5db0ebb7ba6eabe5aafdad` |
| `verify-full-r2.log`               | `4343dc2044df8cb60a2ebce5cee590c7439ec51ce8c212c1ee6f9cc9d3e8afc9` |
| `verify-full-r3.log`               | `d834793c0cdb6d8f058cae0baf4b25a44d4124048f251cfaf23e95d53817e39c` |
| `verify-full-r4.log`               | `3658d3e1a54b3dbac276d2acb2c132a3b6489266248253cb93fed4d8b3f6417d` |
| `verify-full-r5.log`               | `9dccdbef490192241625b2b1c49c8bc95c70f2c3619a29c23fd7e92926f6274b` |
| `verify-full-r6.log`               | `5fd12aca24faa063cb8fd0c0f89751361a8caba330f3fe0955432a4215bfe797` |
| `verify-full-r7.log`               | `14fe322e4da2e01d7c811db72a9446e82ffdc3195720ee54da5b23915226bcb6` |
| `r7-bundle-measurement.json`       | `4d323cd18fdd80b58819ef98f3064b408c562616e460e2afac938ea6f78958ee` |
| `verify-full-r8.log`               | `467e8a532b8895ee4be474ada6f337f743a3dbf18d9a785aef0497800c734dc7` |
| `r8-bundle-measurement.json`       | `9e8ed07b9a7fb9253033bef2ec81a5b46bdc58b832169125869f550c30cef3af` |
| r8 `coverage-summary.json`         | `7225ce17c984f374e8859dc867bfe45d827919eacf637ff5d06eba076c2b4fbc` |
| `r8-validation-summary.json`       | `dadc4d0da0cc852b41b652334c95bfcfe2caa24af254032d277faf21667c74a1` |
| `source-r13-frozen.json`           | `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b` |
| `verify-full-r13.log`              | `d17d33f102fde6be4862df4aa723928ea25cebc632fc4dc165d06d31c4840fdc` |
| `r13-bundle-measurement.json`      | `c10e83d41ec5111f934db207b03d40d1c38cc4f894f2b3faa5caf9fa819c9f20` |
| r13 `coverage-summary.json`        | `a9b5bea3195e5bfc15c0cd08de5c802e65bd21e70754215fe7f884eec6c1248f` |
| `real-probe-lifecycle.log`         | `95e8a08f225d1e5c54c31ce198b491e8ac556f8b9ba0e07e7352c363c6620f1a` |
| `baseline-fixture-clean-rerun.log` | `3813a5790d9a1e23b785cab58a9645911d757fe6a6542696f2ff57eaedaba5f7` |
| `claim-database.log`               | `ddac0209f95f4f34a7e883232a10b109c8e74d38c23b47c6900bb93a7c5cb6ef` |
| `api-coverage-current.log`         | `4c670506709831b8488dfbdc777e78c92a8332cef2dda12a396a7b1d521f147a` |
| 此轮 `coverage-summary.json`       | `66bdbc7734af22244feb613cf601571ef29c32d9dc72e6d40e287eab756b5d5a` |

## 仍未完成

r13 已完成包含 Board 分页、认证页延后加载及三个测试修复的同源完整 `LOCAL_QUALITY_PASSED` 复验，r8 成功、r12 失败及更早结果均保留各自范围。small/history 两组同源 HTTP 基准也已实际通过，仍只覆盖固定单机数据集。从同轮生产构建生成的 Box `09d0d2ba…` / CLI `7c06512d…` 又通过实际 ZIP 的本机隔离生命周期、独立扫描和许可证文本核验。最终干净 SHA 的远端 CI、新机和跨平台安装、旧版升级/卸载及完整供应链覆盖尚未证明，整体仍为部分覆盖，见[生命周期](box-lifecycle-validation-2026-11-07.md)与[制品扫描](artifact-sbom-validation-2026-11-07.md)。后续并发 live 改动没有自动进入 r13 或该包。

真实 GitHub PR/Webhook、完整 IMPL 到 RELEASE、跨浏览器及无障碍、原生组件和许可证完整覆盖、外部团队、生产恢复/容量/稳定性及维护责任继续按 [BLOCKED.md](../../BLOCKED.md) 保留。没有获准的 GitHub 测试目标，本轮未要求用户提供聊天凭据，也未从仓库 remote 推导联调授权。
