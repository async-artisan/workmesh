# 文档紧凑概要接口验证

> 2026-11-10。关联 [文档历史与概要方案](../design/document-history-pagination.md) 的完整可见搜索、准确计数与有界投影。后续 r2 的受影响 API 检查与真实 PostgreSQL/HTTP 局部验收已通过，尚未完成全部页面迁移或最终完整门禁。

首次冻结 `20261110-document-summary-r1` 共 1,079 文件，清单 `6bc3dae348bac2ba1f5c5acdfb1bd345ce186bdcb37afe5d5c3f5bb745efc712`。安装、shared/roles 构建、隔离 Prisma 与 API client 生成、API 108 文件 1015/1015 单元、语义类型和 18 项契约实际通过。定向 ESLint 发现 helper 正则的两个多余转义，整轮退出 1；后续 API 构建及数据库未执行。原失败输出和冻结源保留，后置无漂移；改为显式特殊字符集合的等价转义后须新建候选复验，不能把首次结果改成通过。

r2 同为 1,079 文件，结果为 **LOCAL_DOCUMENT_SUMMARY_API_PASSED**。实际再次通过冻结安装、shared/roles 构建、隔离 Prisma/API client 生成、API 108 文件 **1015/1015**、语义类型、18 项契约、定向 ESLint 和生产 API 构建。新隔离数据库 `workmesh_test_document_summary_20261110_r2` 在自有 PostgreSQL 58412 身份核验后应用 21 项迁移；六组真实数据库/Nest HTTP 用例 **65/65**，零跳过，结束后独立 SQL 确认 55 张业务表全部为空。库和原始日志保留；不操作生产库或现有开发服务。

清单为 `84f459a26079d85b10f269bf1013a82b6aafe3ae2e103af231305ab680cba9b5`，包检查摘要 `54df7613406d6e41664b9f7cbebb09f68c3781587d6ce5e2a910801c2d9eda8b`，数据库摘要 `12b15405b234fa1a02e6dddada624e141bfe9776ad754937c2028cde5d0c3efc`，最终汇总 `97290b27b5db25ab254cfc8170421a0186670d0406e0a157d350ae931979fbe5`。全部冻结源后置一致，14 个 API 实现与用例 live 文件一致。后续文档状态追加不在此冻结清单中。

候选新增项目概要列表、单文档概要与项目概要 overview；旧文档三个 GET 的完整历史数组保持兼容。每项概要只含文档、KB、可读需求、最新可见及独立当前发布修订与准确数量，不含全部历史、验收、交付范围或正文。新增 API 本身不代表页面迁移、旧列表放大或生产容量已解决。

实现涉及 summary controller/query/service 与单元、Unicode 大小写适配与单元、knowledge module 注册，以及历史读取共用的 visibility 策略与相应回归。基线是已通过的通知 r1，只覆盖明确后端、用例与文档路径；不混入并行 trust-chain、发布或前端迁移。各轮静态与实际行为结果按上文分别记录。

真实 PostgreSQL/Nest HTTP 用例已验证：205 条历史与很早发布指针下概要字节有界；107 份文档的准确 total、完整续页和默认/最大页长；READ 前置、每 KB 能力、作者与明确用户槽位可见性、角色/委托排除；完整可见历史及跨字段字面搜索、状态独立过滤；Unicode 重音、扩展映射、希腊词尾与补充平面字符；Agent 需求文本隔离；各类 overview 准确计数和每类最近两项；严格游标与当前权限绑定；同一请求 RepeatableRead 计数和投影一致；坏发布引用报错；非法参数与旧 GET 完整数组兼容。概要小于 2500 B，历史由 5 增至 205 条后的增长小于 80 B 是该 fixture 的断言，不能替代 HTTP 容量基准。

数据库大小写规则不能直接替代页面原有 JavaScript `toLowerCase()`。当前适配按正在运行的 Node Unicode 表生成参数化映射与词尾 Sigma 上下文，不要求数据库 ICU 扩展。外部只读探针 `20261110-document-summary-unicode-probe-r1/attempt3` 已在 C/C、UTF8 PostgreSQL 中实际比较 17 组输出 UTF8 hex，全部与 Node 20.19.0 的原生大小写结果一致，包括重音、扩展映射、词尾 Sigma、U+0345 重叠分类、组合字符、补充平面、全部变换标量的复合串和长中文。身份、进程、数据目录、postgres/psql 摘要前后核对通过，产品源未变。探针 manifest 为 `2a5d255772c2e0b49ff5ed4e1fd22e5af994c218c2388279aafea56f485daaf6`，最终摘要为 `6b2988d05b1a5b6096b440aaec02770b6ebf0c98a1999630f4001a16197596fb`。初次辅助脚本语法错误及第二次 identity 查询失败均保留，没有覆盖成通过。

该探针保留原始 Prisma 参数 SQL 与 values；psql 执行副本将值转为等价 ASCII Unicode 字面量，不能当成协议 bind 或完整 HTTP 通过证据。实际首次计划构造 180.313 ms，映射参数 15716 B；17 组含连接批次 295.701 ms、单次 20k 中文含连接查询 188.379 ms，仅用于发现兼容与成本问题，不是容量承诺。Node 的 Unicode 数据版本为 16.0，运行版本变化可能更新表，不承诺不同 Node 版本间完全相同的字符分类。搜索原始输入上限 100，页面迁移时同步此限制。

静态审查同时发现每 KB 串行解析权限的查询成本随 KB 数增长；Unicode translate 映射包含 1459 项，完整历史搜索在 count/page 各执行一次，其长文本成本也需后续基准。当前不在权限重构范围内，没有容量、超时或查询计划通过结论。不能通过截断 KB 解决这一问题。

执行顺序为冻结候选、受影响 API 单元/类型/定向 ESLint/契约/生产构建，再在显式新隔离库执行 summary、history、requirement PRD、publication、knowledge access 和 HTTP contract 六组。保留首次失败及后续候选，不覆盖旧证据；运行结束核对冻结源与用例图清理。完整一致候选的 `pnpm verify`、最终 clean SHA 远端 CI、制品及真实 GitHub 另行验收。

## 搜索优化 r3：API 与数据库回归已通过，性能另验

后续真实基准 r2 发现长历史搜索超出默认 5 秒事务，原始失败见[基准诊断记录](document-summary-benchmark-validation-2026-11-10.md)。按[限定修复方案](../design/document-history-pagination.md)将 prefix 与各 title 分别小写，再按原空格分隔聚合；UTF8 纯 ASCII 字段走小映射，其他字符继续使用原 Unicode plan。事务时限、RR 只读、授权、查询参数、total 和结果契约均保持。

`G:\yesgoo\workmesh-validation\20261110-document-summary-r3` 以通过的 API r2 为父，只覆盖四个实现/用例文件及方案记录，1,080 文件后置一致，四个 live API 文件与候选一致。实际通过 API **1017/1017**、类型、18 项契约、定向 ESLint 与生产 API 构建；新库 `workmesh_test_document_summary_20261110_r3` 应用 21 项正式迁移后，六组真实 PostgreSQL/Nest HTTP **65/65**，独立 SQL 检查 55 张业务表全部为零。既有 Unicode、跨字段、早期历史、权限及准确 total 的行为回归均重新执行，没有借用 r2 通过结果。

- 源清单：`9ce1d6e13eae9773adfb241d1d56aaa80559c090b0ae5cf01608a88a9de9a6df`
- 包检查：`53bee617d438a29f7d67338338e3ee8f806243ef433712ab5b98860952008d69`
- 数据库汇总：`eefc5aaf5b6584442df538691be03bde74864f0dda2f686e015f418d5b142364`
- 最终汇总：`d5130f689539889394838e5747b7f1384c7cb8609a859fad30e8a05cd329c149`

该结果验证 `summary-search-equivalence / summary-search-regression` 的本切片行为；随后相同后端的 benchmark r3 在 100×123 真实 HTTP 正确性与五组测量均通过，取得 `summary-search-history-timeout` 原问题复验证据，见[基准 r3 结果](document-summary-benchmark-validation-2026-11-10.md)。旧消费者、多 KB 成本和生产容量仍开放。本轮未运行 Web/浏览器、完整门禁、制品或最终 clean SHA 远端 CI。
