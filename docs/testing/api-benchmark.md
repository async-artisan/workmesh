# 本地 API HTTP 基准

`node scripts/benchmark-api.mjs` 通过真实 loopback HTTP 请求测量已经构建的 API 应用。它使用正式 `AppModule`、认证、授权、Prisma 仓储和响应拦截器，创建自己的临时端口和应用子进程，不连接已有 HTTP 服务。

首次真实运行完成 HTTP 测量但最终空库复查失败，该轮失败保持原样。2026-11-09 的 r8 小数据集复验通过；2026-11-10 又在已完成完整门禁的 r13 同源构建上，分别用新库执行 `small` 和 `history`，两组均 exit 0 / PASS，分页探针、精确清理与独立全表复查通过。详情见文末各轮记录；这些固定数据集的本机结果不代表生产容量或 SLA。

## 运行条件

使用项目要求的 Node.js 20.19.0 或更新版本、pnpm 10.28.2。先构建 shared/API，并由维护者在本机 PostgreSQL 上创建一个全新的、已完成正式迁移的专用数据库。数据库名称必须匹配 `workmesh_test_api_benchmark_*`，schema 必须为 `workmesh_v1`。本脚本不创建数据库、不运行迁移。

显式设置以下环境变量，然后运行入口：

```powershell
$env:WORKMESH_TEST_ENV = 'local'
$env:WORKMESH_TEST_DATABASE_USERS = '<明确允许的本地数据库用户>'
$env:WORKMESH_TEST_DATABASE_URL = 'postgresql://<用户>@127.0.0.1:<端口>/workmesh_test_api_benchmark_<本次唯一后缀>?schema=workmesh_v1'
node scripts/benchmark-api.mjs --samples 20 --concurrency 4 --warmup 2
```

本地 URL 不允许密码或额外连接参数；不能与应用 `DATABASE_URL` 或 `WORKMESH_V1_DATABASE_URL` 相同。入口复用 shared 测试库校验器，并在首次写入前核实数据库名、用户、schema，以及数据库服务器和客户端实际 loopback 地址。所有业务表必须为空，只有 `_prisma_migrations` 可以已有数据。未迁移或非空数据库会被拒绝。

## 覆盖与测量方法

两个固定数据集都包含 1 个项目、2 个用户及真实会话、1 个工作流修订、1 个待评审及审批槽、1 个待确认变更。数据直接在事务内准备，故此入口不验证公开写操作流程。

| `--dataset`     | 文档 | 每文档修订 | 修订合计 | 需求及任务 |
| --------------- | ---: | ---------: | -------: | ---------: |
| `small`（默认） |   10 |          3 |       30 |          5 |
| `history`       |  100 |        100 |   10,000 |         50 |

`history` 用于观察更长的修订历史，以及更多任务在同一项目中的读取开销。它仍然只包含一个项目、一个角色、一个评审和一个变更，不覆盖历史评审、工件、接收人或多项目增长。任务数限制为 50，与工作台现有可开工任务首批上限一致；不能把该页面的批次计数解释为任意规模项目的完整积压总数。文档和看板请求显式使用 `limit=100`，fixture 断言要求这两种固定数据集的全部预期记录都被返回；它不是遍历所有公开列表游标的容量测试。

选择较大数据集仍须使用另一全新专用空库，例如：

```text
node scripts/benchmark-api.mjs --dataset history --samples 20 --concurrency 8 --warmup 2
```

报告的 `fixture` 记录数据集名称、实际修订数及正文逻辑字节数；精确清理按本次 fixture 的实际 ID 和数量核对。两种数据集共用同一套数据库身份、空库、启动开关、停止和清理门禁。

| HTTP GET                                                  | 正确性检查                                        |
| --------------------------------------------------------- | ------------------------------------------------- |
| `/api/v1/projects/:projectId/documents?limit=100`         | 文档和修订 ID 完整，无 `bodyBytes` 泄露           |
| `/api/v1/projects/:projectId/board?limit=100`             | 看板包含固定数据集的全部预期任务                  |
| `/api/v1/projects/:projectId/requirements/:requirementId` | 需求、任务、评审和变更存在                        |
| `/api/v1/workbench?projectId=...`                         | 可开工任务、待评审、待确认变更存在，warnings 为空 |

测量前对四个测量接口和四个 Board 分页路由分别验证匿名访问为 401；已认证非成员在项目路由得到 404，在限定项目工作台得到空结果，共 16 个权限探针。正式测量使用真实 session Cookie，其认证开销包括服务端会话读取和活动时间更新。

另以 `limit=7` 独立遍历 Board 的 BACKLOG 列、需求聚合、角色选项和需求选项。断言任务 ID 和需求编号的顺序、完整性、无重复、精确总数、状态计数、角色及选项标签，并拒绝不完整页面、循环游标和续页作用域变化。`small` 固定数据集需要 4 次分页正确性请求，`history` 需要 25 次；报告记录于 `boardPagination`，这些请求及权限探针、预热均不进入延迟样本。此检查只遍历本 fixture 使用的四条路径，其他列与跨请求并发修改仍须独立覆盖。

每个接口先做串行预热，再做指定数量串行请求；然后独立预热并做有界并发请求。`--samples` 范围为 4–100，`--concurrency` 为 2–8 且不能大于样本数，`--warmup` 为 1–5。默认实际测量为每接口 20 个串行和 20 个并发请求，另有预热、16 个权限探针及上述分页正确性请求。请求不重试；单请求 20 秒超时，每个串行或并发阶段 45 秒截止。

JSON 报告记录请求数、未尝试请求数、状态分布、错误数、响应正文 UTF-8 字节数及延迟 p50/p95。耗时从发起 HTTP 请求开始，到正文完整读入并完成 JSON 解析结束，不包含后续 fixture 断言；百分位使用 completed responses 的 nearest rank，非 200/内容错误也计入 errors，网络错误单独计数。任何请求错误、数据断言失败、未尝试请求或清理失败都使运行失败，退出码为 2；全部通过为 0。

RSS 由应用子进程在启动和测量阶段之间采样，只报告观察到的最大值及样本数。它不是进程峰值，也不包括 PostgreSQL、父进程或整个系统。报告同时记录相关源码与构建产物指纹；它不会自行证明两者的构建对应关系，因此运行前必须重新构建 API。

## 隔离和清理

应用子进程只继承最少系统路径环境，`NODE_ENV=test` 禁止加载 `.env`，retention 定时清理关闭，不继承 GitHub/模型凭据、外部集成地址、代理或 `NODE_OPTIONS`。Node 的 outbound HTTP/fetch/socket 连接被禁止；Prisma 的 native engine 只使用前面验证的本地数据库 URL。该保护不是操作系统网络沙箱，不用于运行不可信应用代码。

子进程显式设置已有应用开关 `WORKMESH_SEED_BUILTIN_ROLE_PACKAGES=false`，关闭启动时的内置角色包安装。报告的 `bootstrapData` 记录这项策略，并在启动前、启动后、清理后分别检查 `RolePackageVersion` 和 `RolePackageResource` 都为零行；最终仍检查全部业务表为空，不排除这两张表。

入口先停止自己启动的应用，再按本次生成的精确 ID 和所属项目关系，在事务内清理 fixture；删除数量必须完全符合预期。最后复查所有业务表为空。不会 truncate、删库或按宽泛项目条件删除其他记录。若子进程无法确认已停止，保留 fixture；清理失败时报告 runId/projectId，等待人工检查，不自动扩大删除范围。异常退出或强制终止时也应先检查遗留进程和 fixture，不应直接复用该库。

精确删除事务与后续复查分开记录：事务已提交、两类复查也通过时，`cleanup.status` 为 `REMOVED_EXACT_FIXTURE`；事务已提交但角色包零行检查或最终全表空库检查失败时，为 `POSTCHECK_FAILED`，保留 `removed` 中的精确删除数量和 runId/projectId，整体仍为 `FAILED`。删除事务本身失败时则为 `FAILED`，不报告未提交的删除数量。

## 解释结果的边界

2026-11-07 首轮真实运行使用 Node.js 20.19.0、PostgreSQL 17.11，全新专用库完成 20 个迁移，运行前 53 张业务表为空；8 个权限探针通过，四类接口共 160 个测量请求均为 200 且错误数为零，应用已优雅关闭。精确 fixture 删除事务已完成，但应用默认启动安装留下 6 个 `RolePackageVersion` 和 55 个 `RolePackageResource`，最终空库检查失败，退出码为 2。只读复查确认其余 51 张业务表为空。首轮证据保留于 `G:\workmesh-api-benchmark-20261107-r1`，修复过程没有删除这些遗留数据或改写首轮证据。关闭已有启动安装开关后，于 2026-11-09 在另一新库复验通过，详见文末；首轮失败不被改写。

历史实跑是默认小数据集、已预热、单机 loopback 的 API 回归观察。后来新增的 `history` 选项须有独立实跑记录，不能追溯引用这些小数据集结果。它不启动 `main.ts`，因此不包含其全局 IP 限流、安全响应头、CORS、Swagger、反代和 TLS 配置；项目内认证授权与读取逻辑保持真实。GitHub、Webhook、模型服务、公开写入、长稳压测、生产容量和 SLA 均不在范围内。

无数据库检查需要安装仓库开发依赖并构建 shared，不需要 API 的 `dist`、生成的 Prisma 客户端或数据库。启动开关用例在内存中转译并执行真实 seeder 源码，通过受控依赖阻止数据库访问；CLI 用例在不包含任何 API 文件的临时目录运行真实脚本与 shared guard，验证非法配置在读取实现指纹前被拒绝。正式 HTTP 基准仍要求先构建 API。检查可单独运行：

```text
pnpm --filter @workmesh/shared build
node --test scripts/benchmark-api.test.mjs
```

## 2026-11-09 新库复验

本次使用完整 `pnpm verify` 已通过的 r8 冻结源码及其同次生产构建产物，没有复用首轮失败库。来源是 `739367a714097a825b96ca7ecf6bce3372855a77` 加未提交改动，901 文件清单 SHA256 为 `e0964ba075e262d285b4726030b628d0176966416bbb3a9f3d44f7de0e3fa971`；运行前后逐文件哈希一致。r8 目录初始无 dist/generated client，经 frozen-lockfile 安装和完整门禁后构建对应关系见[统一入口验收](local-verification-validation-2026-11-07.md#2026-11-09-r8-干净目录完整复验)。本节文字是在冻结后补充的验收说明。

只使用已经核验进程路径、data_directory 和实际地址的自有 PostgreSQL 17.11 / `127.0.0.1:58390`；新库名为 `workmesh_test_api_benchmark_r2_20261109`、schema `workmesh_v1`、用户 postgres。配置与 SQL 身份门禁通过后应用全部 20 个正式迁移，启动前 53 张业务表为空。Node.js 20.19.0 / pnpm 10.28.2，实际命令为 `node scripts/benchmark-api.mjs --samples 20 --concurrency 4 --warmup 2`。

运行时间 `2026-11-09T13:02:03.329Z` 至 `13:02:07.699Z`，整体 **exit 0 / PASS**，stderr 为空。8 个权限探针通过；四类接口各 20 次串行及 20 次并发测量，共 160 次请求全部返回 200，零错误、零未尝试、无阶段超时。下表毫秒值显示至两位小数，原 JSON 保留实际浮点值；响应大小为每阶段总字节除以 20，本轮各响应长度一致。

| 接口     | 串行 p50 / p95 ms | 并发 4 p50 / p95 ms | 单响应 UTF-8 字节 |
| -------- | ----------------: | ------------------: | ----------------: |
| 文档列表 |     44.80 / 50.95 |      56.77 / 122.52 |             19412 |
| 项目看板 |       6.51 / 7.19 |        9.64 / 13.70 |              3298 |
| 需求详情 |       7.82 / 8.89 |       10.47 / 83.44 |              1886 |
| 工作台   |     12.92 / 14.91 |       18.80 / 70.09 |              3137 |

每组只有 20 个已完成响应，nearest-rank p95 对应第 19 个排序值，不能将它当作稳定生产尾延迟。没有历史实现的同条件 HTTP 对照，不能据此量化优化收益。应用 RSS 在 14 个采样时点中观察到最大 133562368 B；它不是峰值，也不包含 PostgreSQL 或父进程。

已有关闭开关令两张角色包表在启动前、启动后、清理后都为零行；没有排除这两张表。自有子进程优雅停止后，精确清理提交：收件记录/变更/槽/评审各 1、任务/实例各 5、工作流修订/定义各 1、文档修订 30、文档 10、KB 1、需求 5、角色/成员/项目各 1、会话/用户各 2。状态为 `REMOVED_EXACT_FIXTURE`，脚本确认 53 张业务表为空；随后另用 psql 动态生成逐表 `count(*)` 的只读查询，独立确认全部 53 表为 0。没有 truncate、删库、扩大删除谓词或清理首轮证据库。

本地证据目录为 `G:/workmesh-api-benchmark-20261109-r2`，不是公开发布资产。真实 `.exit` 文件分别记录 target guard、迁移、benchmark、独立全表检查为 0；已读取文件的 SHA256 如下：

| 文件                        | SHA256                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| `summary.json`              | `c23e411f5ff8cec0ee1fdeb10671469f3a467d360a22b0727ff7f24ad653b3a0` |
| `database-counts-after.txt` | `27e84464cb78385bc8065650cfeb64681464760effc2a65b59755bbf1779cd8d` |
| `database-guard.log`        | `d74709faedb64a68336d81f2d63fd7c5c01e648ae2d56c2da3aeb45b4dd5bab3` |
| `migrations.log`            | `b0860e09a1e3168670749ca168b1bc00c2ff87917f47909ee804730b1d025a2f` |

无数据库回归现为 17/17，并已纳入 r8 的完整脚本防护检查：真实 seeder 源码在内存转译后验证开关的关闭与启用路径；真实 CLI 在没有任何 API 文件的临时目录验证 guard 优先和凭据不泄漏；清理收尾由正式 finally 使用，测试区分已提交后检失败与事务回滚，保存正确删除数量且不覆盖原始错误。

本次只证明这一固定小数据集下的真实读取、权限和清理路径。main.ts 的全局限流、TLS/反代、GitHub/Webhook、公开写入、跨请求快照一致性、数据量增长、持续吞吐和长稳容量仍未由该入口验证；Board/需求详情历史等无界读取也没有因为本轮通过而关闭。

## 2026-11-10 r13 小数据与万条修订历史复验

两组运行均使用 r13 冻结的 915 文件及其完整 `pnpm verify` 生产构建。清单 SHA256 为 `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b`；完整门禁 exit 0 / `LOCAL_QUALITY_PASSED`，日志 SHA256 为 `d17d33f102fde6be4862df4aa723928ea25cebc632fc4dc165d06d31c4840fdc`。r13 只在 r12 来源上同步三个浏览器/UI 测试，包含 Board 服务端分页和授权页延迟加载，不包含后续并发工作区的所有变化。运行前后 915 个文件的字节长度与 SHA256 均一致，文档更新在冻结清单之外。

环境仍为 Windows x64、Node.js 20.19.0、pnpm 10.28.2、PostgreSQL 17.11。暂停期间，原自有 PostgreSQL 进程于 2026-11-09 22:41:38（北京时间）异常退出；2026-11-10 恢复工作后确认原进程和 58412 监听均不存在，核对精确执行文件哈希与既有数据目录后重新启动，并保留自动恢复日志。随后重新检查唯一 loopback 监听、命令行精确数据目录与 SQL 身份，分别创建新库。该过程不构成服务连续稳定性或生产恢复演练；未连接或停止本机其他 PostgreSQL。首次 small 启动前守卫因无监听拒绝，无写入；恢复后才开始下述实际测量。

| 数据集  | 专用新数据库                                       | 运行时间 UTC              | fixture                             | 并发 | 终态                            |
| ------- | -------------------------------------------------- | ------------------------- | ----------------------------------- | ---: | ------------------------------- |
| small   | `workmesh_test_api_benchmark_small_r13_20261109`   | 09:03:50.051–09:03:56.398 | 10 文档、30 修订、5 需求/任务       |    4 | benchmark / runner exit 0，PASS |
| history | `workmesh_test_api_benchmark_history_r13_20261109` | 09:04:44.882–09:05:25.498 | 100 文档、10,000 修订、50 需求/任务 |    8 | benchmark / runner exit 0，PASS |

每组均有 16 个授权探针，以及四接口各 20 次串行和 20 次并发测量，共 160 次测量请求，全部 200、零错误、零未尝试、无阶段超时。Board 独立使用 `limit=7`，small 的 4 次请求与 history 的 25 次请求完整核对任务、需求聚合、角色和需求选项，分别检查 5 / 50 条任务与需求的准确数量、排序及唯一性。它们不进入延迟样本，也不覆盖其他列、跨请求修改或大规模积压任务。

| 数据集 / 接口    | 串行 p50 / p95 ms |   并发 p50 / p95 ms | 单响应 UTF-8 字节 |
| ---------------- | ----------------: | ------------------: | ----------------: |
| small 文档列表   |    79.21 / 107.10 |      87.10 / 122.35 |            19,412 |
| small 项目看板   |     14.74 / 16.84 |       15.08 / 23.19 |             3,786 |
| small 需求详情   |     10.17 / 14.14 |       17.09 / 58.88 |             1,886 |
| small 工作台     |     18.80 / 23.25 |      17.04 / 141.22 |             4,147 |
| history 文档列表 | 780.30 / 1,167.34 | 1,193.43 / 1,453.43 |         5,352,332 |
| history 项目看板 |     17.06 / 21.95 |       31.66 / 43.27 |            30,783 |
| history 需求详情 |     11.73 / 13.69 |      17.61 / 102.93 |             1,886 |
| history 工作台   |     28.91 / 33.77 |       61.95 / 72.87 |            29,883 |

百分位按每阶段 20 个已完成响应的 nearest rank 计算，p95 是第 19 个排序值；表内保留两位小数，原 JSON 保存浮点值。单响应字节数为阶段总字节除以 20，本轮各响应长度相同。没有同条件旧实现对照，不能量化分页优化收益。history 的文档响应达到 5,352,332 B，说明文档列表嵌入完整修订元数据仍随历史增长；不能因 benchmark 为 PASS 就解除该分页缺口。该 fixture 正文逻辑字节仅 340,000 B，不能作为大正文、历史评审或附件负载结果。

两组子进程均优雅停止，按精确 fixture ID 提交清理；全部业务表由脚本检查为空后，又通过独立 psql 动态逐表计数确认 **53 表均为 0**，20 条正式迁移记录完整。角色包两张表在启动前、启动后、清理后均为零。没有 truncate、删库或扩大删除范围。每组 RSS 仅 14 个采样时点：small 最大观察值 133,193,728 B，history 为 202,907,648 B；它们不是峰值或整个系统资源。

稳定证据目录为 `G:/yesgoo/workmesh-validation/20261109-r13-benchmark-small` 与 `G:/yesgoo/workmesh-validation/20261109-r13-benchmark-history`；运行脚本来源在同级 `20261109-r13-benchmark-runners`，PostgreSQL 恢复记录在 `20261110-r13-postgres-restart`。两组 `.exit`、`runner-summary.json`、`source-postcheck.json` 与独立计数均已实际读取，关键 SHA256 为：

| 文件                             | SHA256                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| small `summary.json`             | `70883e90a93cd49d80f970affb2bac94aba6c7dc9ac6a798f5f26edadd8629a9` |
| history `summary.json`           | `a47853bdcada4728513b16ce66447e9444d4114e2a524b972b0ec78a1171c46c` |
| small `runner-summary.json`      | `544fad09513c0d68f7f6edf8ff6fd4646d462b3a00ea8eef810ade009c4202bb` |
| history `runner-summary.json`    | `6c921533bcd4556690bd6467e0bc9c03c79febd650c0ddf7db57e5e021c3c33e` |
| 每组 `database-counts-after.txt` | `27e84464cb78385bc8065650cfeb64681464760effc2a65b59755bbf1779cd8d` |
| 每组 `source-postcheck.json`     | `a775186d1c1afad5b2f790ee75cc2b119e3b4f2f8f909152b320874b7e803aa3` |

该记录完成固定数据集的真实 HTTP、分页正确性和清理验证。文档完整历史、需求历史、flow metrics、ready 扫描预算、Workbench 全项目与全待办完整性仍按各自审查项处理；main.ts 全局限流、TLS/反代、公开写流程、GitHub、生产吞吐及长稳、完整交付和外部团队验收仍未由本基准证明。

## 2026-11-10 文档概要独立基准实施约定

用户结果：在相同可读文档数量下，能分别观察旧完整列表与新概要接口的响应字节、真实 HTTP 延迟和 API 进程 RSS，并确认历史超过 100 版后搜索仍覆盖早期可见修订，隐藏标题和不可读知识库不影响搜索、计数或续页。概要后端的冻结 r1/r2 不追溯包含未来基准脚本；脚本实施后另冻新 candidate，真实运行由根任务协调。

范围为显式 `--suite document-summary`，数据集仍选 `small|history`，两个概要数据集固定 100 份可读文档，每文档分别 3/123 版，并有 READ-only、READ+PROPOSE 和不可读 RESTRICTED KB。原默认 `small/history`、四类测量入口及旧完整 revision ID 断言保持。五个独立测量场景为旧完整列表、无 q 概要、ASCII q、中文 q 和 Unicode q；每个场景使用新应用子进程，RSS 使用带 requestId 的 IPC 确认采样。真实 session、成员、grant、Agent scope 与修订作者/发布事实参与权限检查，不以概要自身作为预期答案。

可判定验收：无数据库脚本回归通过；真实运行的匿名/非成员、隐藏标题、需求文本 redaction、精确总数与 limit=7 续页探针通过；旧列表保留全部可见修订；概要没有正文、revisions、验收或交付范围；五场景预热后各 20 次串行及 20 次并发请求全部完成、零错误且不重试；所有自有应用子进程已停止；按精确 fixture ID 和所属关系清理的删除数量完全匹配，角色包零行与全部业务表空库检查通过，并由外部 runner 独立复查。源码/构建和证据指纹须记录，首次失败不得覆盖。

取舍：复用已有数据库身份守卫、最小子进程环境、限时和精确清理，新增 opt-in 分支以控制兼容影响。选择同文档数量的 3/123 版对照，避免把分页文档数量变化当作历史优化；五场景分别启动进程，避免先测旧完整列表的保留堆空间污染概要 RSS。RSS 只报告观察值，不称峰值；延迟/字节比值是本地固定 fixture 结果，不设未经基准支持的生产 SLA。KB 数固定，本轮不关闭 KB 授权查询随 KB 数增长的容量缺口。公开写流程、TLS/反代、main.ts 全局限流、数据库 RSS、长稳和外部集成仍不在范围内。

执行状态：**NOT_RUN**。当前先实现脚本与无数据库回归；没有创建数据库、写入 fixture、启动服务或执行真实 HTTP 测量。真实运行需后端验证完成后的独立冻结 candidate。

以上为实施约定形成时的状态。后续真实运行保留 r1/r2 的 history 失败，定位并修复字段大小写转换成本后，r3 已实际通过；最新结果见本页末节和[真实 HTTP 对比记录](document-summary-benchmark-validation-2026-11-10.md)。

### 概要 suite 入口与报告

`--suite` 缺省为 `legacy`；只有明确指定 `document-summary` 才使用新 fixture 和五场景。`--dataset small` 为 100 份可读 PRD × 3 版，`history` 为同样 100 份可读 PRD × 123 版；另有一份不可读 KNOWLEDGE 文档。90 份 READ-only PRD 的最后一版由其他用户创建、当前发布在 seq=2，故可见历史为 2/122；另 10 份 PRD 的用户 PROPOSE grant 允许全部 3/123 版。knowledge-only Agent 没有 propose scope，即使绑定同一用户也只看到其作者/发布并集。三类标题为固定 160 UTF-8 字节，避免长短数据集的概要字段长度变化。

不可读文档采用 KNOWLEDGE kind，五个测量入口统一 `kind=PRD&limit=100`。这样旧列表的“先分页再过滤 KB”不会把不可读的第 101 份文档混进首批，旧/新测量都读取同样 100 份可见 PRD；独立概要分页、搜索和 overview 探针不加 kind，仍核对不可读 KB 完全排除。这一固定选择不修复也不验收旧接口的权限后置分页缺口。

三个 q 分别为 `asciineedle`、`中文检索` 和 `ÉCLAIR ΟΣ İSTANBUL 𐐀` 的原生 JavaScript 小写结果。它们只出现在每文档 seq=1 的早期可见标题，三个查询都应命中同样 100 份文档。隐藏候选和不可读文档带不同唯一标记，反向查询必须零结果；literal `%/_`、需求文本 HUMAN 可读而 knowledge-only Agent 不可读、精确 total/status 和 limit=7 全量续页在测量前独立核对。预期由 fixture、grant、作者和发布指针计算，不读取概要结果作为答案。

每组先用独立子进程执行正确性探针，再为五个测量场景各启动一个新 API 子进程。每场景先记录一次 cold 请求，之后独立预热并执行串行和并发样本；cold、预热和正确性请求不进入延迟百分位。带 requestId 的 RSS 请求必须在 5 秒内收到对应确认，按 startup/cold/serial-warmup/serial/concurrent-warmup/concurrent 标记，不能把迟到响应归入别的阶段。每场景结束确认子进程停止后才启动下一场景；失败仍保存该场景已有测量、RSS 与停止结果，未确认停止时保留 fixture。

报告 `results` 包含各场景的 cold、serial、concurrent；`children` 保存停止与带标签 RSS；`comparisons` 对每个概要场景报告相对于旧完整列表的单响应字节、p50/p95 和最大观察 RSS 比值。跨 small/history 的历史增长比较须引用各自独立报告和同源冻结证据。映射构造冷耗时与搜索扫描包含在真实请求中；API/数据库执行计划、KB 数增长和生产容量仍需单独调查。RSS 没有后台高频采样，不能称峰值。

先构建 shared，运行无数据库回归，再构建 API。真实运行使用本节上方相同环境守卫，每次更换一座新迁移空库：

```text
pnpm --filter @workmesh/shared build
node --test scripts/benchmark-api.test.mjs
pnpm --filter @workmesh/api build
node scripts/benchmark-api.mjs --suite document-summary --dataset small --samples 20 --concurrency 4 --warmup 2
node scripts/benchmark-api.mjs --suite document-summary --dataset history --samples 20 --concurrency 4 --warmup 2
```

无数据库检查不构造 API 子进程，HTTP/RSS/清理回归使用受控替身；它证明脚本拒绝缺项、泄漏、循环游标、错误清理计数、无响应 RSS 和停止失败，不证明真实 fixture 可写入或 HTTP/容量通过。实施交付时真实概要基准为 NOT_RUN；后续 r1 实跑 small 通过、history 正确性失败，整轮 FAILED，输入、失败与待诊断边界见[真实 HTTP 对比记录](document-summary-benchmark-validation-2026-11-10.md)。

### 实施后的无数据库验证

2026-11-10 使用固定官方 Node.js 20.19.0 运行。首次脚本语法检查曾因编辑中多余的右括号失败，修正后才执行单元回归；该初次输出在任务工具记录中，未另存为外部日志。首轮回归为 63/63；补齐预热 RSS、比值和异常退出断言后第二轮为 65/65，格式化后的第三轮仍为 **65/65**（33 个顶层测试、32 个嵌套测试，零失败、跳过或取消）。`closed` 确认只有与退出码 0、无退出信号同时成立才算优雅停止，已覆盖非零退出和信号终止。

两个脚本的 ESLint、`node --check` 及三文件限定 `git diff --check` 均通过，Prettier 已处理本次三个负责文件。证据保留在 `G:/yesgoo/workmesh-validation/20261110-document-summary-benchmark-impl-r1`，三轮 `node-test-attempt*.log/.exit`、`eslint-attempt1.log/.exit` 与 `prettier-write-attempt1.log/.exit` 分开保存，未覆盖首轮记录。没有运行完整 `pnpm verify`，本地结果也不代表最终提交远端 CI。

上述脚本实施检查没有数据库创建或写入、API 服务启动、外部网络请求或真实 HTTP 基准；SQL fixture 可写入、真实授权/分页、测量和精确清理在该阶段均为 NOT_RUN。随后冻结 r1 的实际执行独立记录在[真实 HTTP 对比记录](document-summary-benchmark-validation-2026-11-10.md)，不得用这份无数据库检查覆盖它的 history 失败。

### 最新实际状态：r2 诊断与 r3 复验

r2 没有放宽超时或正确性判据：small 通过，history 第 30 个正确性探针 `q=asciineedle` 实际返回 500，约 8.8 秒的查询超过 Prisma 默认 5 秒事务；原报告、requestId、stderr 和未执行的 history 测量均保留。限定修复按原空格边界分别转换字段，再聚合标题；仅 UTF8 且字节长度等于字符数时走 ASCII 转换，其余保持原 Unicode 与 JavaScript 小写语义。超时、权限、total、游标和隔离级别保持。

同源 API r3 通过 1017 项用例、18 项契约及真实 PostgreSQL/Nest HTTP 65 项后，独立冻结的 benchmark r3 通过脚本回归 68/68、语法/格式与构建。small/history 两组各 43 个正确性探针及 200 个测量请求全部完成，零错误、超时或未尝试；每组六个自有 API 子进程优雅停止，精确 fixture 清理后，独立确认各新库 55 张业务表全为空。

| 数据集 / 场景        | 单响应字节 | 串行 p95 ms | 并发 p95 ms |
| -------------------- | ---------: | ----------: | ----------: |
| small 旧完整列表     |     244498 |      845.90 |      693.24 |
| small 无 q 概要      |     146250 |       27.29 |       72.48 |
| history 旧完整列表   |    8298118 |     5480.24 |     2175.95 |
| history 无 q 概要    |     146850 |       40.98 |      253.26 |
| history ASCII 搜索   |     146850 |      712.56 |     1142.08 |
| history 中文搜索     |     146850 |      720.24 |     1132.45 |
| history Unicode 搜索 |     146850 |      781.71 |     1446.77 |

每阶段 20 个样本，small 并发 4、history 并发 8；cold 和预热另记。history RSS 最大观察值旧列表为 298573824 B、概要为 134549504 B，属于有限采样，不是峰值，也不含 PostgreSQL 或父进程。实际命令参数以冻结报告为准，本页上方示例不是本轮 history 并发记录。

证据在 `G:/yesgoo/workmesh-validation/20261110-document-summary-benchmark-r3`；1,080 文件后置一致，两个 live 脚本匹配。清单 SHA256 `6d4d8971e215315098d2ec559d73cf28410efb8597d338c5d4b187c1356a6d23`，最终汇总 `10dfe25d4c6e16c10ed90b7144be30fcfde7405a62f514bcd9a7abfc7af8693b`，状态 `LOCAL_DOCUMENT_SUMMARY_BENCHMARK_PASSED`。该结果复验了固定 fixture 的原超时；多 KB 授权增长、生产容量、长稳、未迁移旧消费者及最终完整发布门禁仍需独立证据。
