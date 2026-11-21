# 文档概要真实 HTTP 对比验证

> 2026-11-10。基准方案与独立验收见 [API 基准](api-benchmark.md)。r1 已执行，small 通过、history 正确性失败，整轮 **FAILED**；后续修复尚待验证。

本轮使用通过的通用概要 API r2 源码，只覆盖独立可选的 `--suite document-summary` 基准脚本、脚本用例和记录。默认 legacy 数据集和完整可见历史 ID 断言继续保持。每组固定 100 份可读 PRD，另有不可读知识库文档；small 每文档 3 条历史、history 每文档 123 条历史，当前发布位于 seq 2，并包含 READ-only 下不可见的新候选。每次使用独立新测试库和随机数据，仅精确删除本轮图谱，之后独立 SQL 核对所有业务表为空，保留数据库与日志。

五个对比场景为旧完整列表、无查询概要、ASCII、中文和 Unicode 搜索概要；测量场景各使用新 API 子进程，权限、分页与搜索 oracle 放在独立正确性子进程中。分别记录冷请求、预热后的串行及并发样本、响应字节和带 requestId 确认的 API RSS 观察；RSS 不代表峰值或 PostgreSQL 内存。原始样本及退出码需要实际执行后填写，不预设改善比例，也不将本机结果作为生产容量或 SLA。

后端业务源码必须与已通过 r2 一致；本轮重新构建 API，并执行脚本单元、语法与格式检查，不重复声称运行原 API/数据库套件。冻结清单、失败尝试、工具链、子进程关闭和独立空库检查逐项留证。本轮不代表 Knowledge/Prds/Workflows 调用方已全部迁移，不退役旧接口，不覆盖完整 `pnpm verify`、制品、最终 clean SHA 远端 CI、真实 GitHub、长期稳定性或 HUMAN 正式批准。

首轮 `20261110-document-summary-benchmark-r1` 冻结 1,080 文件，清单 `d90a21dc469e3cf9cbeca51ea40db99a19a04e3db07b8a8ec8ad0aa1a850ef68`；API 与已通过父候选 r2 相同。冻结安装、shared/roles、隔离 Prisma 与 API client 生成、脚本单元 **65/65**、语法、格式及生产 API 构建实际通过；检查汇总 `9f1bbe7fd30083e57f4c67ec723d3c7612c2c77977099e2c3ff4b3c25c25e6b3`。所有冻结源后置一致，两份 live 脚本一致。

small 新库 `workmesh_test_api_benchmark_summary_small_20261110_r1` 应用 21 项迁移后，43 个正确性请求和五场景各串行/并发 20 个测量请求通过，共 200 个测量请求零错误。旧完整列表每响应 244498 B，概要各场景 146250 B；无查询概要串行 p95 29.52 ms、并发 4 p95 78.38 ms，旧完整列表分别为 626.70/643.60 ms；三种完整历史搜索串行 p95 398.39–422.82 ms。RSS 是各独立子进程的观察值，不能推断峰值。该组报告 `fb11995f6591636fc17ee3ce526853566b9a1ab94a298050b3a8c322beae9799`，精确清理 303 条修订等本轮图谱后独立 SQL 确认 55 张业务表为空。

history 新库 `workmesh_test_api_benchmark_summary_history_20261110_r1` 同样应用 21 项迁移，植入 101 文档 / 12423 修订；在 `summary-correctness` 阶段约 12.2 秒后失败，代码为 `BENCHMARK_FAILED`，**未开始五场景测量**。当前报告只保留通用失败码，没有断言消息或失败请求，不能据此确定是 API、SQL、授权还是 fixture 问题；下一轮先补不含凭据或响应正文的请求诊断，再保留相同 oracle 和超时重验。该组报告 `bc1c8c6e42033dbdc9c258c4590213bc53d950eb06ce5b007634e805165a18e5`，子进程优雅关闭、精确清理全部 12423 修订后独立 SQL 确认 55 张业务表为空，数据库继续保留。

最终失败汇总 `b5ea083faf78e841cb214ff4d560165d2ecda89d2affba55fa03667d1430c626`。small 通过不能替代 history 或关闭容量缺口；这份执行后状态记录不在 r1 冻结清单中。

## r2 诊断重验：真实搜索事务超时

`20261110-document-summary-benchmark-r2` 仍使用完全相同的后端，新增不含凭据或正文的阶段、请求、状态、requestId 与错误诊断，保留独立正确性 oracle 和原超时。1,080 文件冻结后置一致；脚本 68/68、语法、格式与生产 API 构建通过。small 43 个正确性请求与 200 个测量请求通过；history 第 30 个正确性请求 `q=asciineedle&limit=100` 返回 500，尚未开始五场景测量。

失败 requestId 为 `ca95a17e-6163-4e6a-a1b8-91633308a037`，客户端耗时 8815.65 ms。对应受限服务端 stderr 明确记录 Prisma 事务已过期：默认 interactive transaction 时限 5000 ms，执行时已经过约 8807 ms，栈指向概要 list 的 `$queryRaw`。这确认当前长历史搜索有实际服务端性能缺陷，不将它解释为 fixture 错误或放宽超时。下一切片先减少大小写转换工作，再重跑原 oracle 与性能数据。

两组新库均应用 21 项正式迁移；API 子进程停止后精确删除本轮图谱，独立核对各 55 张业务表全部为空。数据库继续保留，整轮仍 **FAILED**。r2 证据摘要：

- 清单：`0f52bf1867d4edb7a87ea21e55a8742e42114949fb8daf829f56bdcf63413ad4`
- 包检查：`dd5b9b4d22a71aa5de170946d8c033fe1b3d7549c2fa9b0f6cd2d8bf1f3d87f8`
- small 报告：`07eed904725ee4650446885ba39ef0d401ae3d600d73911f09ba7b98d2ae6c88`
- history 报告：`3ae5b9380aacc928e64e31cc683dd699b8c7a9d7ef725e017663ab7161cd37d9`
- history stderr：`8bab9a67734c624cbc183aa76620e8bb6ffeeecc3ba7bef00c414113be62cf13`
- 失败汇总：`b2a28fecdb1f1bcdf4d94701661ea9ab5c39ae1ecdbe3b525f5b4f9fd80af885`

另以只读 scalar probe 调查 Unicode 转换开销：相同 22403 B 拼接文本在 10 个有区别的输入中，原映射约 866.52 ms，加入 ASCII identity 前缀约 160.35 ms，结果均与原生 JavaScript 相同。这只定位转换成本；identity 前缀方案没有进入产品。首个探针因 `Prisma.Sql` 构造方式错误停止，第二个恒定表达式可能被常量折叠，均保留且不作为成本证据。后续采用字段独立折叠和 ASCII 快路径的方案，需单独取得 API/数据库与 HTTP 证据。本轮仍不覆盖容量、完整门禁或最终发布。

## r3 原问题复验通过

API r3 的字段独立折叠已取得完整受影响 API 与六组真实数据库/HTTP 回归证据，详见[API 验证](document-summary-validation-2026-11-10.md)。`20261110-document-summary-benchmark-r3` 严格以该通过来源为父，只覆盖同一套基准及记录，后端逐文件相同；共 1,080 冻结文件后置一致，两份 live 脚本相同。脚本 68/68、语法、格式与生产 API 构建通过。原数据量、正确性 oracle、请求及事务时限没有放宽。

small 和 history 各使用新隔离测试库、21 项正式迁移；各 **43 个正确性请求和 200 个测量请求通过，零错误、超时或未尝试请求**。每组一个独立正确性子进程和五个测量子进程均确认优雅关闭，之后精确清理本轮图谱并独立核对 55 张业务表全部为空；数据库及完整原始样本保留。整轮为 **LOCAL_DOCUMENT_SUMMARY_BENCHMARK_PASSED**。

| 数据集 / 场景          | 每响应字节 | 串行 p95 ms | 并发 p95 ms |
| ---------------------- | ---------: | ----------: | ----------: |
| small / 旧完整列表     |     244498 |      845.90 |      693.24 |
| small / 无查询概要     |     146250 |       27.29 |       72.48 |
| small / ASCII 搜索     |     146250 |      279.20 |      317.72 |
| small / 中文搜索       |     146250 |      255.94 |      316.37 |
| small / Unicode 搜索   |     146250 |      257.64 |      295.74 |
| history / 旧完整列表   |    8298118 |     5480.24 |     2175.95 |
| history / 无查询概要   |     146850 |       40.98 |      253.26 |
| history / ASCII 搜索   |     146850 |      712.56 |     1142.08 |
| history / 中文搜索     |     146850 |      720.24 |     1132.45 |
| history / Unicode 搜索 |     146850 |      781.71 |     1446.77 |

每个场景分别取预热后串行 20 个和并发 20 个请求；small 并发 4、history 并发 8，冷请求和预热样本独立记录且不计入上述分位数。history 原先首次搜索 500 已在相同正确性请求复验，并完成后续搜索测量。历史从 3 增至 123 时概要响应仅随准确数字等字段由 146250 增至 146850 B；旧列表增长为 8298118 B。该 fixture 的有界投影改善成立，搜索仍比无查询昂贵，不能推导任意数据量、任意 KB 数或生产容量承诺。

history 旧列表与无查询概要 API RSS 观察最大值分别为 298573824 / 134549504 B，三种搜索为约 125–127 MB；这些是独立 API 子进程在确认 requestId 时的采样观察，不是峰值，不含 PostgreSQL 或父进程，不能解释为整机内存上限。本机同时有其他隔离检查，单轮 p95 不是稳定 SLA。

- 清单：`6d4d8971e215315098d2ec559d73cf28410efb8597d338c5d4b187c1356a6d23`
- 包检查：`7fece9c478e008bd94e23d74840d88fe02c9b092cb2a5c4a0f4b66f10c597e81`
- small 报告：`769f4ac37bf7a46be35e1bfe043b8c504219c0a6d258ca79605433c33d772ad3`
- history 报告：`a229a31f5edeb42d484ff94a485cdd6dcc2f37833e36dc5d4072e5fdc2942a9e`
- 最终汇总：`10dfe25d4c6e16c10ed90b7144be30fcfde7405a62f514bcd9a7abfc7af8693b`

这完成 `summary-search-history-timeout` 的本轮复现修复验证，先前 r1/r2 失败仍保留。尚未迁移调用方继续使用完整数组，不能据新接口基准关闭全局读取放大；多 KB 权限解析、规模上限、长期稳定性、完整门禁、制品、最终 clean SHA 远端 CI 与外部 GitHub 仍独立验收。
