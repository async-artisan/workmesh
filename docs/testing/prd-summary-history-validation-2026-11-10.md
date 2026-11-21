# PRD 概要目录与分页历史验证

> 2026-11-10。对应[文档主页面方案](../design/document-catalog-ui.md)的 `catalog-summary-pages / catalog-history-pages / catalog-exact-revision / catalog-state-races / catalog-existing-actions / catalog-evidence`。r1 失败保留，限定修复后的 r2 已通过包级检查与生产 Chromium fixture；结果不包含真实应用写入或正式 HUMAN 批准。

PRD 页面只读取当前概要页，目录搜索和状态筛选由服务端完成，候选数及 total 来自概要。选中文档后按 50 条读取历史；当前发布卡片独立于首历史页，精确 metadata 缓存不增加已加载历史计数。任意准确修订 ID 比较、旧版评审、纯文本正文和 HUMAN 撤销票据/CAS 保持。旧全量文档及需求索引不再用于本页。

分页历史和概要查询有独立客户端与 hook；目录查询变动清游标，超长查询明确无请求。历史临时续页失败保留旧行并重试相同游标；版本/total 变化或 409/422 停止续页并要求刷新。权限失败清正文与动作缓存，比较变化或切项目/文档后迟到结果失效。独立选中概要不等于当前目录页的一项，缺席只标为“不在当前结果页”。理解基线可能来自其他文档，不能借当前文档 metadata 的 404 判断其不存在。

候选以通过的 Workflows r1 为父，叠加八个新 API/hook 文件、Prds 页面及用例、新 PRD 浏览器 spec 和记录。四个后端搜索优化文件按通过的概要 API r3 精确整合；本轮不重复声称执行其 API/数据库检查。共享 fixture 只新增概要列表、summary 与 history，保留旧 Knowledge 路由及需求 published-prds 的历史版本 205；非当前发布修订改为 CANDIDATE，与实际后端一致。

先执行完整 Web 包用例、类型、定向 lint 和生产构建，再通过显式隔离生产预览运行完整 Chromium fixture。新增浏览器夹具含 107 文档的 50/50/7 页、123 修订的 50/50/23 页、seq2 当前发布、122 候选、早期历史词和精确 seq7/seq3 比较；还覆盖 503 同游标重试、409 刷新、跨查询/项目/文档正文竞态、metadata 404、后页准确评审以及撤销冲突后重新签票。记录每轮失败、源摘要和结束后监听，不将静态检查记为行为通过。

范围不含 Knowledge 主页面迁移、其他旧调用方退役、真实 GitHub、完整 `pnpm verify`、制品、最终 clean SHA 远端 CI 或正式 HUMAN 批准。浏览器使用受限 fixture；即使票据交互通过，也不代表实际应用写入链已实测。

## r1 首轮实际失败与 r2 限定修复

`20261110-prd-summary-r1` 的 1,102 个文件冻结后实际通过 Web 74 文件 **789/789**、类型、定向 ESLint 和生产构建；完整生产 Chromium 为 **151 通过 / 4 失败**，零跳过/flaky，预览结束后 58443 监听为零。两种宽度各出现同样的两类失败：目录标题断言使用含相对 `first()` 的 `has` locator，同时匹配目录和历史卡片，触发 strict mode；后页候选点击后进入旧 `/reviews?id=...`，目标 review GET 在 5 秒内为零，快照仅余空 main。原错误、截图和 trace 保留。

目录断言限定到实际 PRD 标题并继续核对完整总数，不削弱业务断言。评审入口改为现有规范 `/reviews/:reviewId`，避免旧 query 入口与 ProjectContextBoundary 补 projectId 的导航竞争；单元渲染准确 route param，浏览器核对规范 URL 与真实目标 GET。限定改动为 Prds 页面及测试和新 PRD spec，不修改 App 或 ProjectContextBoundary 的其他兼容入口。此处竞争机制来自实际代码调查，首轮行为证据直接证明的是旧入口未完成读取；规范入口是否修复由 r2 原场景复验判定。

r2 以保留的 r1 源码为父，只覆盖以上三文件和本记录，再重新执行包检查与完整生产浏览器，不借首轮通过关闭失败。

## r2 实际复验

外部证据目录为 `G:/yesgoo/workmesh-validation/20261110-prd-summary-r2`。1,102 文件冻结后，Web 74 个测试文件 **789/789**、类型检查、定向 ESLint 和生产构建全部通过。1440/390 两种宽度下完整生产 Chromium fixture **155/155**，零失败、跳过或 flaky；其中新增 PRD 场景 18 项，原目录计数和后页评审读取场景均已复验通过。runner 退出 0，结束后自有 58443 预览监听为零。

目录 107 份文档与 123 条修订按 50/50/7 和 50/50/23 实际操作；当前发布 seq2 在首历史页以外仍精确读取。比较、评审按准确修订 ID，503 重试、409 刷新、迟到响应、metadata 不可读和撤销冲突后的重新签票均由受控 fixture 校验。评审跳转使用规范路径后实际请求目标 review；这关闭本页首轮故障，其他旧 `/reviews?id=...` 调用方与全局兼容入口仍须另行复核。

全部冻结源码后置哈希一致，整合的所有 API 文件与通过的概要 API r3 精确一致。另独立比较 235 个 Web/UI-review 文件与 live：234 个相同，仅正在并行实施、未纳入本轮的 `Knowledge.tsx` 不同；八个基础模块、PRD 三文件、共享 fixture 和其余整合代码均一致。不能将 Knowledge 的并行修改视作这轮已通过。

| 证据                      | SHA256                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| `source-manifest.json`    | `6b2076e1ec920688336494a4d2e0e32f8144c786f329e1b16fddb84b226e6245` |
| `validation/summary.json` | `97b5ad1f83f62043af887da3139f800280b21dc939006bf42a0b14512d6ae4c5` |
| `browser/report.json`     | `d367da2e0074b21851778df9eba164ea6f9f15c939998a968166fb6bcfa44f19` |
| `live-web-postcheck.json` | `786b91a90d8981082431d9f581470ab33c67d963b8a2fa073df9e59a94a57a9d` |
| `summary.json`            | `0eb50d7afec022142ee9c3e3ecbe21b393b381e5d7db23ec0ed7a5c528d5c3c8` |

最终状态为 `LOCAL_PRD_SUMMARY_SLICE_PASSED`。本次未重跑不变 API 的数据库/HTTP 检查，未执行新的完整 `pnpm verify`、打包、最终 clean SHA 远端 CI 或真实 GitHub；fixture 的票据与撤销交互不能替代实际写入链或 HUMAN 正式批准。
