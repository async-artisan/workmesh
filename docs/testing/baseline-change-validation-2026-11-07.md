# 正式基线变更事务验收：2026-11-07

本轮修复正式 UNDERSTANDING／PRD 发布推进需求代次后，已有任务仍保留旧完成状态和当前执行指针的问题，并修复浏览器验收暴露的需求详情页标签竞争。最终冻结源码已通过独立 PostgreSQL 回归 9/9、API build、完整根集成和 API coverage、完整 Web 测试 529/529、Web build，以及真实 Chromium 浏览器 4/4。本记录不代表完整产品流程或开源发布验收完成。

## 真实缺陷与修复范围

旧实现最后批准 PRD 时更新文档发布指针、追加 `DocumentPublication` 并推进 `Requirement.generation`，但没有同步重开受影响的任务、释放认领、清除当前快照／工件集，也没有写入相应变更事件和收件人。用户因而仍能看到旧基线下的 QA 为 DONE，即使后续写入会因需求代次不一致而被拒绝。

修复位于 [review Prisma 仓储](../../apps/api/src/reviews/v1-review.prisma-repository.ts)。在既有项目锁和 Serializable 事务中，最后批准正式基线同时完成以下动作：

1. CAS 更新文档和需求指针，追加正式发布记录，推进需求 version／generation。
2. 识别同项目、同需求、未退休工作流实例的实际受影响任务，并沿冻结定义的 DAG 传播到后继。
3. 对受影响任务执行 version／generation 加一、executionStatus 回到 OPEN、清空当前 claim／snapshot／artifactSet，释放其尚未释放的认领。一般工作状态回到 ACTIVE；PAUSED／CANCELLED 保持原限制。
4. 将受影响任务当前 OPEN review 置为 INVALIDATED，review version 加一；不改写已 APPROVED 的历史事实。
5. 在同一事务写入 `DOCUMENT_PUBLICATION` 事件及按任务责任人和角色去重的 `ACK_ONLY` 收件人，再提交批准决定、审计与幂等操作。

文档发布、需求推进、任务更新、认领释放、review 失效、票据消费、事件／收件人和幂等操作中任一步失败，整个事务回滚。没有受影响任务时不制造变更事件，包括无任务的首次发布。

## 影响范围、产品来源与历史保留

根任务依据冻结 `WorkflowRevision.definition` 的 `PUBLISHED_PRD` 策略、编译后的必需 PRD／UNDERSTANDING 输入、当前快照使用的旧基线，以及当前 PRODUCT 输出引用识别。尚无快照但声明必需基线输入的任务也纳入失效。传播只发生在相应活动实例的 DAG 内；其他需求、其他项目、已退休实例和无关联的 NONE 步骤保持原状。

当前产品输出仅从任务的 `currentArtifactSetId` 查找，同时核对 taskId、task generation、当前 snapshot 和冻结 workflow revision，并要求冻结 PRODUCT 步骤允许对应输出类型。不会扫描历史工件集来扩大影响范围，也不依赖文档 review 可选的 taskId 关联来认定来源。当前输出候选正是被替换的旧基线时，该旧产品任务和后继需要重开。

生产新基线的 PRODUCT 来源仅在任务已经 DONE、当前工件集确有同代次 APPROVED 验收、所有批准决定仍有效且未撤销时保留；当前集合同时含被替换旧候选时不适用豁免。待验收来源会正常失效、收到通知并重新交付，避免保留一个必然被旧需求代次检查拒绝的 OPEN 验收。数据库用例通过真实仓储批准产生 DONE，没有直接写 DONE 来模拟有效验收。

这个来源例外没有增加“文档发布自动完成 PRODUCT 全部 gates”的行为，不能据此宣称该完整产品门禁契约已经实现。

历史 APPROVED review、决定、artifactSet 和 snapshot 继续保留准确旧代次与内容。任务仅清除当前指针；旧记录仍可追溯，但不能继续用于当前写入或验收。需求 phase 保留历史最高里程碑，不因本轮失效倒退。

## 新理解、旧 PRD 与确认边界

旧快照构建逻辑只要求需求的理解和 PRD 指针存在，无法在新理解发布后自动拒绝“新理解＋旧 PRD”的组合。本轮在理解最后批准的同一事务清空需求当前 PRD 指针和旧 `deliveryScope`，保留旧 PRD 文档发布指针及历史批准记录。仅创建理解候选不会清除当前基线。

基于旧理解的 PRD 再次发布会被既有 `PRD_BASIS_STALE` 检查拒绝；缺少需求当前 PRD 时，新快照由既有 `SNAPSHOT_BASELINE_UNAVAILABLE` 闸门拒绝。基于新理解的新 PRD 正式批准后恢复需求当前 PRD／范围，新快照绑定新的准确理解和 PRD 修订。

变更事件沿用现有确认协议：

| 字段            | 本轮约定                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sourceKind`    | `DOCUMENT_PUBLICATION`                                                                                               |
| `sourceId`      | 本次新建 `DocumentPublication.id`                                                                                    |
| `changedFields` | 对应需求当前基线指针与 `generation`；新理解清除旧 PRD 时包含 `currentPrdRevisionId` 和 `deliveryScope`               |
| `targets`       | 排序后的实际 `taskIds`、`documentId`、`previousDocumentRevisionId`、`documentRevisionId`、新 `requirementGeneration` |
| 收件人          | 按受影响任务 `responsibleUserId + roleId` 去重；同人不同角色分别收件，包含发布者本人                                 |
| `action`        | `ACK_ONLY`；确认不替代任务验收，也不自动恢复 QA 通过状态                                                             |

当前 Task schema 的责任人及角色均为必填外键，本轮没有通过猜选角色成员填补空责任人的逻辑，也没有把收件范围扩大到全项目 OWNER。

## 九项真实数据库回归

[独立数据库套件](../../apps/api/test/v1-baseline-publication.database.spec.ts)在加载时使用既有测试数据库 guard，只接受显式配置的隔离测试库。主任务新建并核对目标为 `127.0.0.1:58390/workmesh_test_baseline_20261107?schema=workmesh_v1`，应用全部 20 项迁移后运行。没有以 mock 事务代替真实 SQL 回滚验证。

| 用例                       | 关键断言                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已完成 QA 与当前执行链失效 | 真实批准 QA 到 DONE 后发布替换 PRD；任务重开、指针清空、认领释放、OPEN review 失效；旧批准／工件／快照保留；无关联范围不变；同责任人按角色去重通知 |
| 无任务首次发布             | 发布成功且不产生人为变更事件                                                                                                                       |
| PAUSED／CANCELLED          | 任务基线失效，但工作状态限制保持                                                                                                                   |
| 有效 PRODUCT 来源保留      | 真实仓储批准的 DONE 当前来源保留；任意关联非产品任务不能获得豁免；来源识别不要求 review.taskId                                                     |
| 待验收 PRODUCT 来源        | 重开任务、释放认领、清空指针、OPEN review 失效且 version 加一，产生来源负责人通知                                                                  |
| 旧 PRODUCT 当前输出被替换  | 已批准来源重开、后继失效且通知；旧批准与工件保留；仅历史集合引用旧候选的任务不被误传播                                                             |
| 并发最后批准               | 五个竞争请求仅一个成功，任务只推进一次代次，publication／event／收件人各一份                                                                       |
| 真实收件人数据库故障       | 对本用例项目施加数据库约束使收件失败，检查文档／需求／任务／认领／review／决定／票据／事件／幂等操作全部回滚；撤掉约束后同输入重试成功             |
| 新理解到新 PRD 恢复        | 理解候选不影响当前基线；正式批准清 PRD／范围，新快照被拒绝；旧 basis PRD 被拒绝；匹配新理解的 PRD 批准后快照恢复并保留旧快照                       |

最终 `baseline-database-final9.log` 记录 1 个文件、9 passed；主任务执行记录确认 exit 0。此前 2 项、7 项阶段性通过记录继续作为中间证据，不能代替最终九项结果。

## 失败、修正与已完成检查

首次数据库运行的 `baseline-database-red.log` 为 2 failed，原因是测试 fixture 在创建 KnowledgeBase 时使用了 title，缺少必填 name。该运行没有到领域断言，不能作为缺陷复现或修复前 red。修正 fixture 字段后，单独把测试复制到仍保留旧生产实现的隔离副本，再运行得到 `baseline-database-red2.log`：1 failed／1 passed，失败明确显示新 PRD 批准后 QA 仍为 DONE／generation 1，当前 snapshot 和 artifactSet 仍非空，预期应为 OPEN／generation 2。这才是本次真实领域 red。

首次真实浏览器 `baseline-browser.log` 已执行新 PRD 浏览器密码批准和任务失效断言，随后在历史快照整体比较处失败：顶层 resources 返回顺序不同，条目集合保持一致。测试作者随后改为排序后的集合比较，并继续单独校验 manifest 与历史内容；没有因此修改生产快照内容。首次失败保留为失败记录，不能提前当作浏览器通过。

第一次修正后运行的 `baseline-browser-corrected.log` 又在 IMPL 历史快照的第二处整体比较遇到相同的 resources 顺序差异，仍记为失败；这次定位属于测试比较顺序假设，不记为新生产回归。测试作者统一修正两处集合比较，当时[浏览器回归文件](../../tests/browser/baseline-change.spec.ts)的 SHA-256 为 `9fdad2edc0c55947c2a958a13f54db607ca5773830e8afe7831b7ce0d3caae68`，该摘要仅绑定对应中间版本。

后续完整四项浏览器的首次运行记录于 `browser-suite-final.log`，实际为 2 passed／2 failed，exit 1。账户与匿名 CSRF 两项通过；baseline 用例末尾通过不含 taskId 的需求详情路径跳转后，找不到目标 QA 任务行，测试随后改为带官方 taskId 定位参数的导航。business 用例重载后发布任务状态实际为 UNKNOWN，预期为 WAITING_PREDECESSOR；该日志没有 HTTP 429 证据，不能把限流当作已证实原因。

修正后 `browser-suite-corrected.log` 记录 3 passed／1 failed，exit 1：baseline 通过，但 business 点击需求详情页“交付物”后未找到交付摘要。进一步检查发现真实的 UI 状态竞争：带 `taskId` 的深链接进入任务页后，点击交付物标签同时更新本地标签状态和路由参数；过渡渲染仍带旧 `taskId`，effect 又把内容切回任务，造成可见标签、选中状态和面板不一致。

在修改生产代码前新增两条针对性回归：一条验证任务深链接切到交付物时 URL、选中标签、面板和工件摘要一致；另一条覆盖 `tab` 与 `taskId` 冲突的初始链接、切换交付物、同一组件内后续跳转到另一任务以及清除 `taskId` 后的面板同步。旧实现两条均失败（2 failed／29 skipped）；修改后两条均通过（2 passed／29 skipped），完整 RequirementDetail 套件 31/31 通过。修复将标签状态统一由 URL 参数派生：存在 `taskId` 时展示任务，切换标签时在同一次 URL 更新中写入标签并清除 `taskId`。

最终 `browser-suite-ui-final.log` 的真实 Chromium 四项全部通过（4 passed，4.3 分钟，主任务确认 exit 0）：账户注册／会话／重载／退出、匿名写入 CSRF 拒绝、PRD 基线变更后 QA 重验收，以及真实 Agent QA 交付／人工批准后重载仍阻止发布。两条业务测试结果 JSON 分别记录新基线历史与当前证据、QA 批准及 `WAITING_PREDECESSOR` 发布状态；各自 `notCovered` 字段仍列明未覆盖范围。先前失败日志继续保留，不以最后通过覆盖其历史。

| 检查                     | 本记录冻结时确认的结果与范围                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 最终独立 PostgreSQL 回归 | 9/9 passed，主任务确认 exit 0；日志 `baseline-database-final9.log`                                                                           |
| 最终 API build           | 主任务确认 exit 0；日志 `api-build-final.log`                                                                                                |
| reviews 单元测试         | 7 个文件、89/89 passed；本地执行 `vitest run --config vitest.unit.config.mts src/reviews`                                                    |
| API 类型检查             | `tsc --noEmit -p apps/api/tsconfig.json` 通过                                                                                                |
| 数据库 spec 类型检查     | 独立 strict TypeScript 检查通过；不能用仅包含 src 的 API tsconfig 代替 test 文件检查                                                         |
| 定向格式与差异检查       | 两个冻结源码／测试文件 Prettier、`git diff --check` 通过                                                                                     |
| 独立只读源码复审         | 最终冻结仓储的来源豁免、当前引用与历史集合边界复核完成，未发现新的确定 P1／P2                                                                |
| 完整真实浏览器失败历史   | 首次 2 passed／2 failed，随后 3 passed／1 failed，均 exit 1；分别见 `browser-suite-final.log`、`browser-suite-corrected.log`                 |
| 最终真实 Chromium 四项   | 4/4 passed，4.3 分钟，主任务确认 exit 0；日志 `browser-suite-ui-final.log`                                                                   |
| RequirementDetail 回归   | 先对旧实现获得 2 failed，再对修复后实现获得 2 passed；完整页面套件 31/31 passed，Web 类型检查及定向 ESLint／Prettier 通过                    |
| 完整 Web 测试与 build    | 51 个文件、529/529 passed，Web build 通过；主任务确认均 exit 0，日志 `web-tests-final.log`、`web-build-final.log`                            |
| 最终完整 integration     | 21 个文件通过、1 个跳过；181 passed／1 skipped（真实 Ollama POC），主任务确认 exit 0；日志 `integration-final.log`                           |
| 最终 API coverage        | 103 个文件通过、1 个跳过；923 passed／1 skipped（真实 Ollama POC），主任务确认 exit 0；日志 `api-coverage-final.log`，全部既有覆盖率阈值通过 |

完整根集成入口重读日志确认使用测试数据库 guard，并明确跳过重复迁移；本次完整集成通过不表述为又一次从空库应用 20 项迁移。API coverage 覆盖单元、HTTP 和数据库测试，未降低既有阈值。独立重读 `coverage-summary.json` 得到全局 lines 82.93%（5811/7007）、branches 69.57%（4352/6255）；review Prisma 仓储 lines 85.35%（402/471）、branches 75.84%（358/472）。覆盖率通过证明本轮完整命令达标，不代表每条产品业务路径或真实外部 GitHub 证据链均已验证。

## 冻结来源与本机证据

源码来自当前未提交工作树及隔离构建副本 `G:/workmesh-box-validation-20261106-212834/source`，不是 clean SHA 或可重现发布制品证明。以下文件摘要已只读重算核对；最终数据库、Web 和浏览器运行对应此冻结版本。

冻结后，当前工作树的 `apps/api/src/tasks/v1-task.prisma-repository.ts`、`apps/api/src/tasks/v1-task.repository.ts`、`apps/api/src/tasks/v1-task.service.ts` 和 `apps/api/src/tasks/v1-task.service.spec.ts` 出现并行编辑，与上述验收副本不同。这些后续编辑保留原样，未包含在下述 Box `554eae8b…`／CLI `6c5bd81b…` 制品中，也不在本记录 API coverage 923 项、integration 181 项及真实 Chromium 4 项的验证证据范围内；不能将这些通过结果推广到包含后续编辑的整个当前工作树。下表其他已冻结文件的摘要保持不变。

| 文件                                                     | SHA-256                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/src/reviews/v1-review.prisma-repository.ts`    | `ba01132c52a91c5b3dd452ea3afbae8254b268999496589a27aaa2be455104da` |
| `apps/api/test/v1-baseline-publication.database.spec.ts` | `e206db561cfe4ff2c75998bfb5108ec704720a35e1d96e209829028edaef9cce` |
| `apps/web/src/pages/RequirementDetail.tsx`               | `976859570791ec9a5bbad708f52694ac06cc383157b1a601de25b0fcea1505f6` |
| `apps/web/src/pages/RequirementDetail.test.tsx`          | `42d7d288126aefa3f131d7b45ca9a025ac9ea84f309607a4750689e03b414311` |
| `tests/browser/baseline-change.spec.ts`                  | `e1d4331bc6cc21c05f340907f9f5737f79f01bb8c3bca8f1407f00048de80285` |
| `tests/browser/business-chain.spec.ts`                   | `78647a333c88f8b7e4f934263f7341cb0cc5e8105aebbdabee17032424d5cbbc` |

原始证据目录为本机 `G:/workmesh-baseline-validation-20261107-r1`。下表文件长度与摘要已独立重读，退出码由主任务执行记录确认；原始日志没有额外写入退出码，也没有随本文公开上传。

| 日志                             | 字节数 | SHA-256                                                            |
| -------------------------------- | -----: | ------------------------------------------------------------------ |
| `baseline-database-red.log`      |   4667 | `2a481abfa832ab071668ef643d14350ab40f746efe1a58b0328536f41bd1c97a` |
| `baseline-database-red2.log`     |   2073 | `c96f6d5c254fd11e77a16f4c808e5a3aec1779482db57ba25b15211f6e498c29` |
| `baseline-database-final9.log`   |    252 | `e71127e2bcf04b31ac472bfb814eb0a2e32fc49d4ad7ad7e8e543820d14f6772` |
| `api-build-final.log`            |    616 | `520b633093a31b1dc6169ef2c7923d198576222a4bde2a8cb14857ce1cba9288` |
| `baseline-browser.log`           |   3448 | `0b27523ba0e61460c3064ee32e345dbfc6968110db344439b5f51e369d8a6647` |
| `baseline-browser-corrected.log` |   3625 | `443baf0df9cc4c337a075a2c90cb45e6fb89cb5ae8407332fd4030af71dd74a0` |
| `integration-final.log`          |   2440 | `aa03178d57c892a0e21b501d9b7fe9c1193d6629401fb85c532346e0f6c72ae8` |
| `api-coverage-final.log`         |  14641 | `813675ac0008867b66dff8d5c81533b24bbc31b9dad5bab2f717a6f7e4ed254d` |
| `coverage-summary.json`          |  46161 | `d9383c7f0c0b005ad7d15b18fe7ca30df0efaf3e4d5f9b29c097d106e6931d0e` |
| `browser-suite-final.log`        |   4308 | `b7af06557419b0d1810002755ffcd4ebd1ada040325ede7dc55fd025b939232c` |
| `browser-suite-corrected.log`    |   2745 | `fa6e89cbafac0169e41db7b963c0661bc968473bfd4a4d7f203e436aac22b223` |
| `browser-suite-ui-final.log`     |    907 | `d27477a042acc6d9bfef699e213147adcd924d9d4c71eb7893c83868a8bf44cd` |
| `web-tests-final.log`            |    373 | `c8938a908957bd52258d133b3e9d790253c01a9f8466d6668d4c38f35b46fdf5` |
| `web-build-final.log`            |   3309 | `b07c5a0393c58f66cfdb466c53187ab36052adecfe790827e53f9b56aaebd49b` |

本次最终浏览器成功 JSON 已从隔离副本的 `.tmp/browser-results` 复制到上述证据目录；以下为最终副本，与先前另存的 baseline 中间结果不是同一轮：

| 证据文件                      | 字节数 | SHA-256                                                            |
| ----------------------------- | -----: | ------------------------------------------------------------------ |
| `baseline-change-result.json` |   1258 | `995ebd9483c3baa801715347aefa0230fd0d3124380bca0b2d7eca4f89b65f5f` |
| `business-chain-result.json`  |    820 | `8cd150d70cfc5b82c823f06b6ad3ebe00ede91ebbcbbf1f3e316a21650b1cb9b` |

本轮没有绕过真实代码交付的外部审查证据门禁，未配置并验证 GitHub 目标的代码链继续保留未验证状态。本机数据库和浏览器 QA 结果不能替代真实 GitHub 审查、完整 B3／WP11、远端 CI、跨平台、新机、生产迁移恢复或最终发布候选的干净来源验收。

SHA-256 前缀为 `7ec…` 的本轮中间包通过生命周期检查，但早于 UI 修复，该前缀仅用于区分阶段。包含 UI 修复的最终 Box 包 SHA-256 为 `554eae8b559c33f2cf771fae36eb4163aaca1c2bd976287da1c302e3c9035c6e`，CLI 包为 `6c5bd81bd745971856337aff6febe0e76a431857714ba0f47db6fb24f56f1780`；主任务确认最终生命周期检查通过，summary SHA-256 为 `28d68dc79bb0e6a52e3251aade4fa75430b9ade77ea7cc214884cacea526cc7e`。

最终 `G:/workmesh-baseline-package-validation-20261107-r2/artifact-scan-command-final.log`（688 字节，SHA-256 `892ff5078ff3e1d4ab650df07a5deab4d45893420184e17a4323618bce1def3e`）记录 Box 和 CLI 两份 CycloneDX 1.7 文档的 schema 与格式均通过，主任务确认命令 exit 0。该检查只证明文档结构和格式符合要求，组件覆盖、来源及许可证完整性仍需独立证据；生成的清单仍为草稿，完整 SBOM 门禁保持开放。
