# 文档历史分页与评审精确读取验证

> 2026-11-10。对应 [文档历史分页方案](../design/document-history-pagination.md) 的兼容首切片。本轮保留旧文档列表、详情和完整历史数组，新增有界历史页与单修订元数据，并迁移文档评审的精确读取。完整概要、搜索、计数及主页面迁移仍开放；本文不把新增接口视为原列表读取放大已解决。

## 变化与可判定验收

文档评审按评审主体的 `documentId / revisionId` 读取 metadata，正文和发布对照继续走原 content 入口；不因目标不在某一页而回退为当前发布版本。候选、发布、票据、幂等和 HUMAN 正式批准继续使用既有事实链。

| key                     | text                                                                                                 | verification |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| history-page-bounded    | 新历史入口默认 50、最多 100 条，按数据库可见集合及 seq 倒序分页，准确 total 与页来自同一只读一致事务 | TEST         |
| history-page-access     | 成员、KB READ、作者、明确用户评审者及 Agent 作用域遵循原规则，隐藏修订不影响可见计数，每页重新授权   | TEST         |
| history-page-cursor     | 游标绑定文档、主体/凭据、权限、授权版本及页大小；非法输入拒绝，文档版本变化要求刷新                  | TEST         |
| history-review-exact    | 首批外旧评审按精确 ID 显示标题、验收及正文，失败不回退，切换后的迟到结果不覆盖当前评审               | TEST         |
| history-page-compatible | 旧完整数组及正文读取语义保留，现有评审、差异与人工批准回归继续成立                                   | TEST         |

数据库与 HTTP 检查使用显式新建的隔离测试库，浏览器使用 loopback 生产构建与完整 API fixture 拦截。Agent 的测试报告、实际执行证据与 HUMAN 正式批准分别记录。

## 冻结来源与失败记录

本轮使用独立源码目录、官方 Node.js 20.19.0 与 pnpm 10.28.2；通过 Node 的实际路径调用固定 pnpm 入口。基础为 `55c7124c31652077c01267a76f2eb9de1a20e9c6` 加未提交快照。它不是该 commit 自身的 clean SHA 验收，也没有混入冻结后的其他 live 修改。

原始证据保存在 `G:/yesgoo/workmesh-validation/`，以下失败没有用后续通过结果覆盖：

1. `20261110-document-history-r1/` 首次运行没有实际生成 API 使用的 Prisma Client，导致 38 个单元测试文件加载失败，618 项通过。`isolated-prisma.mjs` 只在临时目录验证生成后删除，不能代替候选里的客户端生成；runner 已补显式 `prisma generate`。
2. r1 第二次运行 API 936 项通过，Web 665 项通过、1 项失败；新切换评审测试遗漏 `act` 导入。运行期间旧临时 Node 目录被外部移除，Web 实际回落到 20.13.1，因此该轮不能当作受支持工具链的最终通过。
3. r1 的角色包 `build` 调用生成器，把六份 manifest 和 `src/generated.ts` 从 CRLF 重写为 LF，七个冻结文件后置哈希变化。只读检查确认资源字节、70 条资源摘要和内嵌内容没有漂移，仍如实保留来源变化。新候选从哈希匹配的原始字节恢复，仅以 `exec tsup` 编译已核对的生成源，不再在验证中重写它们。准备中止的 r2 目录也保留。
4. r3 仅在原始字节上修正 `act` 导入，1,057 个冻结文件的清单 SHA256 为 `3066902cde566413ef3444117e42e0b1fbd67786b26211d5531d3735e975a502`。API 936、Web 666、类型、定向 ESLint、18 项契约和两端生产构建通过，后置指纹一致。真实数据库初始化发现本套件生成的项目 key 为 11 字符，超过正式 `VARCHAR(6)`，新增 12 项未执行，其余 29 项通过；失败后另以 SQL 核对 55 张业务表全为零。生产 Chromium 为 81 通过、6 失败，六项均因流程页标题的模糊定位同时命中导航 h1 和页面 h2。

r4 从 r3 的冻结源受控复制，**只修改两处测试**：项目 key 改为 6 字符；流程页标题改精确名称定位。没有修改行为断言、skip 或权限，也没有加入新的生产源码。r4 共 1,057 文件，清单 SHA256 为 `129bf0304d5d289a64ae98e45a33f2a503823dc2641bea7076b1654e07e50114`。数据库 fixture 的发布指针和评审状态用于读取测试，不能作为正式批准证据。

## r4 实际执行

本轮汇总为 **LOCAL_HISTORY_SLICE_PASSED**。以下结果均已取得终态并核对原始日志；此前 r13 完整门禁与制品不涵盖本切片。

| 检查                                                  | 实际结果                                                       | 证据目录，相对 `20261110-document-history-r4/`         |
| ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| frozen 安装、shared/角色编译、实际 Prisma Client 生成 | exit 0                                                         | `validation-a2/`                                       |
| API 单元                                              | 101 文件、936/936 通过                                         | `validation-a2/api-unit.log`                           |
| Web 单元                                              | 66 文件、666/666 通过                                          | `validation-a2/web-unit.log`                           |
| API/Web 类型、切片 ESLint、两端生产构建               | exit 0                                                         | `validation-a2/summary.json`                           |
| 契约                                                  | 18 项运行时检查通过                                            | `validation-a2/contracts.log`                          |
| 真实 PostgreSQL / HTTP                                | 4 文件、41/41 通过，无跳过                                     | `database/integration.log`                             |
| 正式迁移与独立清理核验                                | 21 项迁移；55 张业务表全为零                                   | `database/migrations.log`、`business-table-counts.txt` |
| 生产 Chromium UI review                               | 87/87 通过，无跳过、失败或 flaky；预览端口退出后无监听         | `browser/report.json`、`runner-summary.json`           |
| 源码及 live 切片复核                                  | 1,057 个冻结文件后置摘要一致；本切片 13 个 live 文件与候选一致 | `summary.json`                                         |

数据库使用经过进程、可执行文件摘要、data directory 和 SQL 身份核验的 loopback `127.0.0.1:58412`，新建专属库 `workmesh_test_document_history_20261110_r4`；没有连接已有业务库。测试仅清理记录的随机 fixture ID，空测试库保留。独立逐表计数 SHA256 为 `f234ca788d37cb31f1b8722d693492efb367095fde94ef75925e54321e920b48`。

真实数据库覆盖 205 条历史无遗漏遍历、默认 50/上限 100、当前发布位于第 2 版、准确可见并集与计数、作者/明确用户评审者、纯角色与 delegation 不额外授予可见性、READ/角色/成员及 Agent 作用域撤销、精确旧元数据、跨对象/身份/凭据/权限的游标拒绝、文档版本刷新、严格 JSON 与 PostgreSQL Int 上界。Web 单元另覆盖完整正文、metadata 失败不回退，以及切换评审后的迟到响应不读取旧正文或覆盖新评审。

生产浏览器通过 loopback `127.0.0.1:58437` 访问本轮 Web 构建，所有业务 API 由 fixture 拦截；覆盖桌面和窄屏的文档评审、验收映射、版本比较和错误恢复，以及既有各页回归。它不把 fixture 的签字状态提升为真实数据库 HUMAN 批准，也不替代代码项目 IMPL→RELEASE、真实 GitHub 或跨浏览器验收。

| 记录                         | SHA256                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| `summary.json`               | `bbdf0428ad33e1185862115a9d06db76b054d6246a8ad102553cb2854cf751f6` |
| `validation-a2/summary.json` | `ecd189515e4a17d64bd0248edade7aa06dc0080884f8d7c3fed6731ded692523` |
| `database/summary.json`      | `4ffe0542c1e185f0f3c71eb4155551d70dbbeec5ed4743f069f358c1a183069b` |
| `browser/report.json`        | `2dc38097507c429ab67665a5105c5da80878cedc9dd43ed1d2d7d2bbf64650ce` |

本页五项切片验收均取得上述本地测试证据；它们不等于最终概要/搜索/主页面分页验收。本次验证记录及后续状态文案在冻结清单外；其他并行 live 修改也没有自动纳入本轮。未运行完整 `pnpm verify`、重新打包、最终 clean SHA 的远端 CI 或生产容量基准。

## 后续需求 PRD 上下文切片

为避免任务评审扫描整个项目的 PRD 与完整修订，新增按项目和需求读取的 `published-prds` 投影：准确 `total` 和最多两份紧凑概要，唯一时按当前发布的确切 revisionId 读取完整 metadata。验收 key 为方案中的 `prd-context-bounded / visible / exact / race`；候选选择、发布与 HUMAN 决定仍来自现有事实。本段对应后续代码变化，不自动纳入 r4 已通过结果。

需求投影与任务评审迁移已取得 **LOCAL_HISTORY_SLICE_PASSED**。工程验收只覆盖本节的四个 key，不扩大上节 r4 的结果或把旧通用列表标为完成。

冻结来源为 `G:/yesgoo/workmesh-validation/20261110-document-history-r5/`，1,062 文件、清单 SHA256 `e714e6b3f9ac81129fcca6d63a09886d097864b0514353908cebe007b12b5199`。它从不可变 r4 受控复制，仅覆盖显式列出的需求 PRD 投影、任务评审、测试与文档文件；其他并行修改未纳入。执行使用官方 Node 20.19.0、pnpm 10.28.2。

| 检查                                       | 实际结果与来源                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| API 单元                                   | r5：103 文件、957/957 通过                                                                                |
| Web 单元                                   | r5：66 文件、691/691 通过                                                                                 |
| 类型、定向 ESLint、18 项契约、两端生产构建 | r5 全部 exit 0                                                                                            |
| 真实 PostgreSQL/HTTP                       | r5：5 文件、52/52 通过，无跳过；包含新增 11 项需求投影场景                                                |
| 迁移及清理                                 | 新库 `workmesh_test_document_history_20261110_r5`，21 项正式迁移；独立 SQL 确认 55 张业务表全为零，库保留 |
| 最终生产 Chromium fixture                  | r7：89/89 通过，无跳过、失败或 flaky；loopback 58437 释放                                                 |
| 来源复核                                   | r5、r7 全部 1,062 冻结文件后置摘要一致；收集时本切片 18 个 live 实现/测试文件与 r7 一致                   |

数据库在全部 fixture 创建及发布指针更新后，按旧列表实际的 `updatedAt DESC, id DESC` 实查目标排名为第 61，前 50 条不含目标；历史由 5 增长到 205 后再次核对排名。两次概要 data JSON 完全相同且均小于 2,000 B，随后精确读取第 2 版发布 metadata 与验收。此结果证明本投影响应不随该文档历史条数增长，不证明准确 count、授权集合或生产查询成本恒定。另覆盖完整可见 total=5/最多两行、隐藏 KB 排序靠前仍不影响唯一性、无关/归档/未发布/非 PRD 排除、READ/成员/角色撤销、真实 Agent scope/项目/角色边界、路径/query/响应包及损坏发布指针 409。

Web 另验证概要、metadata 和任务→实例→需求重试链各阶段的迟到成功/失败：切换评审后不继续读取旧下游或覆盖新需求/验收，不使新 PRD 请求失效。零份、多份、失败和发布变化分别呈现；原 HUMAN 决定链未新增门禁或降级为自动批准。

浏览器失败和修正均保留：r5 为 87 passed / 2 failed，新场景把需求列表任务摘要当作 TaskView，缺少 `responsibleUserId` 导致渲染异常；r6 仅将该 spec 改为完整 TaskView，初次矩阵及准确读取断言通过，但发布变化后未先展开技术详情就要求其可见，再次 87 passed / 2 failed。r7 继续只修改该 spec，按实际操作展开详情并保留精确错误、矩阵消失、重试恢复和三次 metadata 读取断言，同时补本场景讨论空页 fixture，最终 89/89。两轮日志、截图和 trace 未覆盖；没有为通过测试修改产品校验。

r7 受控副本与 r5 **只有 `tests/ui-review/user-journey.spec.ts` 不同**，仍为 1,062 文件。r7 重新安装、构建 shared/Web 并运行全套生产 Chromium；API/Web 单元、API 类型/构建、契约和数据库等未变化输入的检查，明确引用 r5 实际结果，未声称在 r7 重跑。r7 及 r5 全源摘要、精确差异、引用路径和摘要均记于汇总。r6 的失败汇总仍保留。

| 记录                            | SHA256                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| r5 `validation-a2/summary.json` | `7780de1ba16ec09418f56135749afc43339b550adee80ba96e5c130819c6f075` |
| r5 `database/summary.json`      | `b95ea6a1441310bf9bb3f93a5803a952813f56c11b0ce95560d49d36ccc0f193` |
| r7 `source-manifest.json`       | `502418450e1deeb05f848e59e9f5e34e545e7fae488f3579710c7d4ac1303077` |
| r7 `validation-a2/summary.json` | `f586ce7d470bf2b7267bbb9687f8a9f81bb7072b15b6791bfc69e54bbde77a21` |
| r7 `browser/report.json`        | `4f58932db24498e472fc3a6e4b0a00e3849ba8b297c5369039f02d6b15888589` |
| r7 `summary.json`               | `d2e18f577d8391239c8c2f3c2c1ef45f74ad3059a412db65081878e56ddeec0c` |

本节及后续状态文字在上述清单外。浏览器业务 API 全为 fixture，没有真实数据库 HUMAN 签字或邮件/GitHub 调用；没有运行新完整 `pnpm verify`、重新打包、远端 CI 或生产容量基准。

## 剩余范围

旧项目文档列表仍嵌入全部可见修订；r13 的 100 文档 × 100 修订、5,352,332 B 响应保留原历史范围。Knowledge/PRD 的完整搜索、准确概要、历史续页和比较，以及需求资料的服务端需求过滤仍需后续成套迁移。新历史页仅保证行数有界，不承诺单行 JSON、精确 count 扫描成本或生产容量恒定。

本切片的局部测试不能替代新候选的完整 `pnpm verify`、实际发行包、最终 clean SHA 的远端 CI、外部团队签字、真实 GitHub 联动或跨平台验收。
