# 使用者路径优化验证记录

日期：2026-11-09；追加复验：2026-11-10（Asia/Shanghai）。对应[执行清单与开源借鉴](../design/user-journey-optimization.md)。

本轮按“明确职责 → 准备与接入 → 执行与交接 → 评审、查询和运维”的顺序实现并验证。结果对应 `G:\yesgoo\workmesh` 的未提交工作树；保留既有并行改动，包级测试总数包含原有及其他工作树修改的用例，不代表本轮新增数量。本记录不代替最终提交的远端 CI、发行制品或真实多人业务链路验收。

11 月 10 日工作区另有[信任链 O1–O9 扩展](../design/trust-chain-experience-optimization.md)持续并行写入。O1 与本轮输入诊断重叠，其余新功能另行验收。每轮检查仅支持当时实际加载的源码和构建产物；记录前后指纹与发生的变化，不能把较早的全套结果概括为最新整个工作树通过。

## 环境与数据库范围

- Windows / PowerShell；Node.js v24.22.1，pnpm 10.28.2。
- 所有本轮数据库写操作限定在显式隔离 PostgreSQL `127.0.0.1:55439`，没有向 5432 的现有开发或业务库迁移或写入数据。
- 初次隔离库 `workmesh_test_userjourney` 曾包含并行任务的 `0022_password_reset`。最终源码不包含该模型和迁移 SQL；不把这一库的 22 条历史记录算作当前源码的迁移证据。
- 最终另建空库 `workmesh_test_journey_final_20261109`，从当前源码复制实际迁移和 schema 至没有 `.env` 的隔离目录，执行 `validate`、`migrate deploy`、`generate`，全部退出 0。`0001_init`–`0021_review_discussions` 共 **21 项**全部完成，无回滚或未完成项。
- 只清理已确认为空、没有 SQL 的 `0022_password_reset` 残留目录；没有删改任何迁移文件。最终客户端从当前 schema 重新生成，数据库集成与 API 类型检查在该客户端上复验。

最终数据库测试参数：

```powershell
$env:Path = 'C:\Users\Windows11\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
$env:WORKMESH_TEST_ENV = 'local'
$env:WORKMESH_TEST_DATABASE_URL = 'postgresql://Windows11@127.0.0.1:55439/workmesh_test_journey_final_20261109?schema=workmesh_v1'
```

## 逐项实现与行为证据

执行清单的勾选表示对应实现及下列行为测试通过；真实接入、跨设备、发行和业务效果的未验证范围在文末独立保留。

| 清单项                 | 实现与验证结果                                                                                                                                                                | 主要行为用例                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 团队可推进与本人可领取 | `claimEligibility` 独立于依赖状态；负责人、活动角色、scope 与任务状态均影响资格，缺失资格不开放领取；正式写入重新核对                                                         | API `v1-ready.service.spec.ts`、`v1-task.service.spec.ts`；Web `Workbench.test.tsx`、`RequirementDetail.test.tsx`                                |
| 变更 ACK 与影响        | 展示真实变更对象、影响和收件版本；“已知悉”与完成调整、提交验证分别表达；失败可重试                                                                                            | `ChangeDrawer.test.tsx`、`Workbench.test.tsx`                                                                                                    |
| QA 分阶段与角色一致性  | 用例设计可提前，执行依赖实现和 cases；初始为 NOT_RUN，执行报告绑定 cases 修订，HUMAN 决定保持独立                                                                             | shared `workflow-template.test.ts`；role-packages `index.test.ts`、`validation.test.mjs`                                                         |
| 模板必需资料与准备入口 | 已发布知识选择、管理员 required 绑定、普通成员权限和已有实例修订边界均有覆盖                                                                                                  | `Workflows.test.tsx`、`v1-knowledge-binding.service.spec.ts`                                                                                     |
| 真实任务深链与命令     | 任务定位、刷新恢复、高亮和复制均绑定选中任务；无资格仅可复制 ID                                                                                                               | `RequirementDetail.test.tsx`；Playwright `user-journey.spec.ts`                                                                                  |
| 项目准备清单           | 按选定流程检查人员与独立签字、知识、工作区、流程和首次任务；读取失败、列表不全或修订不可读保留待确认                                                                          | `ProjectReadiness.test.tsx`、`Workflows.test.tsx`                                                                                                |
| 接入参数与安全偏好     | 签码前集中预检，只用可信部署 API 地址、本人活动角色；仅记非敏感 Shell/宿主偏好                                                                                                | `EnrollmentCodeDialog.test.tsx`、`onboarding-command.test.ts`；Playwright `onboarding.spec.ts`                                                   |
| 授权复用和接入恢复     | 精确匹配项目、角色、API 后在线核验凭据；中断、消费结果未知、已绑定重跑给出实际恢复步骤；Windows 原子替换仅对短暂占用有限重试，持久拒绝仍失败                                  | CLI `credential-session.test.ts`、`workspace-init.test.ts`、`setup.test.ts`、`private-fs-write.test.ts`、`workspace-bind.test.ts`                |
| 任务上下文             | 流程依赖、本人资格、正文可用性和外部引用分别报告；`issues[]` 给出逐项问题、可公开定位、责任和动作，`issuesComplete` 标识是否检查完整；不可读身份隐藏                          | snapshot service/repository、`TaskInputStatusPanel.test.tsx`、CLI `input-status.test.ts`；真实 DB `v1-snapshot-input-status.database.spec.ts`    |
| 认领前只读诊断         | `context --task <id> --inspect` 仅 GET input-status，不创建 claim/snapshot；拒绝与写入、候选、materialize 等选项组合；查询成功不表示输入可用                                  | CLI `index.test.ts`、`input-status.test.ts`；API snapshot service/repository 单测                                                                |
| 输入版本比较           | 只读比较实际任务快照，校验快照归属、索引与 manifest、一致性、长度与实际 SHA-256；旧代次可比较，失去读权不继续泄露                                                             | `v1-snapshot-comparison.spec.ts`、`v1-snapshot.service.spec.ts`；`TaskInputStatusPanel.test.tsx`；上述真实 DB                                    |
| 逐项评审问题           | 提问、分页回应、解决与重开；按轮次追溯，当前权限与 expectedVersion 在事务中复核；问题状态不改变批准                                                                           | `v1-review-discussion.policy.spec.ts`；真实 DB 与 HTTP discussions 套件；`ReviewDiscussions.test.tsx`；CLI `index.test.ts`                       |
| 真实交付与不确定恢复   | 使用服务端真实评审/问题/回应编号；请求前保存原操作，未知写入先核对收据；默认文本可取得回应所需的问题版本；五个角色指南使用自动创建的评审及原交付收据恢复                      | CLI `index.test.ts`、`operation-write.test.ts`、`operation-reconcile.test.ts`、`receipts.test.ts`；角色包源/生成字节一致性测试                   |
| 需求查询               | 服务端搜索、阶段过滤和统一分页；项目/查询变化淘汰旧响应；列表读取失败不能伪装成空列表                                                                                         | `requirements.service.spec.ts`、`requirements.pagination.spec.ts`、`Requirements.test.tsx`；ready/task/board 回归                                |
| 具体阻塞与责任人       | 显示直接前置和受影响后续任务、当前责任人及定位动作；缺失依赖不能当作无阻塞                                                                                                    | `TaskRelations.test.tsx`；Playwright `user-journey.spec.ts`                                                                                      |
| 验收条件与证据映射     | 只读受保护的完整 HOSTED JSON，拒绝重复字段及转义后重复字段；显式验收 key 关联，核对 PRD/快照/完整 commit/验收正文与验证方式；失败、阻塞、未执行及不可读来源不会被通过记录覆盖 | `acceptanceEvidence.test.ts`、`AcceptanceEvidenceMatrix.test.tsx`、`ReviewDecision.test.tsx`                                                     |
| 通知行动口径与已读     | 仅本人可决定槽位及明确可领取任务计入行动；活动目的地明确；失败保留警告，按账号记录已读；邮件同步个人口径                                                                      | `notificationDisplay.test.ts`、`activitySeen.test.ts`、`v1-notification.service.spec.ts`；Playwright `notifications.spec.ts`、`evidence.spec.ts` |
| 批量评审               | 逐项预检状态和版本、无效原因和有效子集；票据失败不批准，部分结果与未知结果逐项保留                                                                                            | `BatchReviewApprove.test.tsx`                                                                                                                    |
| 运维状态与恢复证据     | 进程监听、API readiness、数据库和迁移计数分开；401/404 或未就绪不能报成功；恢复结构证据不等同于业务完整                                                                       | Box `dev.test.ts`、`status.test.ts`、`net.test.ts`；Windows readiness / PG ownership / 生命周期安全脚本                                          |
| 账号恢复说明           | 明确当前没有自助密码找回，部署运营人员与项目管理员权限边界可见；不生成不存在的恢复链接                                                                                        | `Login.test.tsx`                                                                                                                                 |

## 已执行检查与适用范围

| 检查                     | 实际结果                                                      | 命令或范围                                                                                                                 |
| ------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API 全套单测             | **95 文件、894 项通过**                                       | 11-10 17:25:34 启动；API 源码、测试及实际 shared/roles dist 前后稳定；不覆盖 17:26:21 后新增的 O6 契约                     |
| API 隔离集成/HTTP        | **7 文件、85 项通过**                                         | 11-10 17:17:21 启动；下方命令，21 项迁移的隔离库；其后变更不能沿用此结果                                                   |
| API 类型、构建           | **分别通过**                                                  | 17:19 当前源码 tsc / nest build 通过；17:25 API/shared 无增量类型检查通过；随后新增源码须另验                              |
| Web 全套组件/单测        | **64 文件、656 项通过**                                       | 11-10 17:23:50 启动，Web/shared 源码 204 文件前后稳定；不是新增用例数量                                                    |
| Web 类型、生产构建       | **分别通过**                                                  | 上述全套后类型通过；17:17:41–17:17:56 类型/生产构建通过，253 文件前后稳定；不把较早 dist 视为后续新源码已构建              |
| CLI 稳定基线全套         | **29 文件、352 项通过、2 项跳过**                             | 11-10 17:10:24 启动，61 个 CLI 源码前后一致；含 Windows 原子写入修复                                                       |
| CLI 并行扩展检查         | **全套 361 通过、2 跳过；补充定向 81 通过**                   | 17:21 与 17:23；type/build 通过，但 index/execution-state 等运行期间改变，不能拼接成当前完整稳定基线                       |
| UI Review 浏览器         | **最近完整 83/83；此前 79/79、73/79 后原失败 6/6**            | 最近一轮运行期间工作台/shared 源码仍有变化；不能表述为最新整个工作树的稳定全套；原 6 项恢复时 source/dist 251 文件前后一致 |
| 真实浏览器/API/DB        | **首次 2 通过、2 失败；修复定位后原两项 2/2 通过**            | 真实注册/会话/CSRF 与真实 Agent API 交付、HUMAN 批准、基线变更；复验固定 API/Web 产物副本，仍非真实 CLI 接入全链路         |
| 构建后 shared 运行时契约 | **18 项通过**                                                 | 11-10 17:19 `pnpm test:contracts`，包含 shared build；其后新增 O6 契约另验                                                 |
| shared / 角色包          | **90 / 29 项通过**                                            | Node24 重跑；shared 类型、角色资源生成/类型/构建通过；角色登记 API 定向另 20 项通过                                        |
| Box                      | **38 项通过；类型、构建通过**                                 | 本轮负责代理执行的 Box 包测试、type-check、build                                                                           |
| Windows 运维回归         | **readiness 11、PG ownership 16、生命周期安全 36 项检查通过** | 本轮负责代理执行，运行范围见 `docs/box.md` 与部署说明                                                                      |
| 格式与差异               | **通过**                                                      | 本轮负责文件 ESLint/Prettier、最终文档 Prettier、`git diff --check`；LF/CRLF 提示不算失败                                  |

隔离集成命令：

```powershell
pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts `
  test/v1-snapshot-input-status.database.spec.ts `
  test/v1-review-discussions.database.spec.ts `
  test/v1-review-discussions.http.spec.ts `
  test/v1-task.database.spec.ts `
  test/v1-board-pagination.database.spec.ts `
  test/v1-http-contract.spec.ts `
  test/v1-knowledge-access.database.spec.ts --reporter=verbose
```

79 项 UI Review 包括 1920px（1 项）、1440px（19 项）、1024px（14 项）、640px（14 项）、390px（20 项）以及不按尺寸命名的 11 项。浏览器验证定位、复制、通知、键盘关闭、任务/评审、门槛与前置资料的小屏布局；接口使用固定夹具，不能称作真实 API/DB 全链路。第一轮 79 项全过；第二轮并行加入 shared 运行时导出而 dist 滞后，工作台 6 项渲染失败；重建后在 source/dist 稳定的窗口原 6 项全过。不得把这些轮次相加，声称最后字节全套 79 项已跑过。

17:26 左右再次执行完整 UI Review，含新增仓库配置布局用例共 **83/83 通过**（约 1.5 分钟）。前后范围 260→261 文件；工作台、WorkbenchDialogs 及其测试、shared/index 和新诊断契约在运行期间改变，实际 shared dist 保持不变。完整差异保存在 `user-journey-ui-final-fingerprint-summary-20261110.json`；该结果不覆盖运行结束后才加入或改写的功能。

## 真实浏览器交付与基线变更

11 月 10 日另运行现有 `tests/browser` 四项，使用真实 API `55442`、Web `55443` 和上述 `55439` 隔离数据库，单 worker、retries 0，保留生产限流与原有等待。注册/会话/重新加载/退出和匿名 CSRF 拒绝两项通过；交付与基线变更两项首次失败，均因新依赖区让多个任务卡包含“后续发布任务”，旧 `hasText` 定位命中三张卡，HTTP failures 为空。没有将此定位失败当作业务通过。

只调整两处场景的目标定位：基线变更使用真实 release task ID；交付场景使用精确可访问 group 名，保留原状态、决定人、旧证据失效、历史记录与持久化断言，不用 first/nth 忽略多匹配。首次运行期间原 API dist 被并行重建，复验因此复制现有 API/Web 产物并核对副本一致性。临时配置继承原数据库 guard、端口、worker、timeout 和限流，只覆盖产物及测试输出路径。

固定副本复验在 **17:30:26** 启动，原两项 **2/2 通过**，约 **5.2 分钟**。实际验证：Agent 通过真实 API 认领/取得快照/交付，HUMAN 在浏览器读证据后用正式票据批准；变更发布使旧 QA 失效，必须重新取得快照、交付并批准；刷新后状态和历史事实保持，实现仍未完成时发布仍等待前置。Agent 操作由测试 API 客户端执行，未运行真实 CLI 的 workspace init、设备批准和本机绑定。

冻结 API 共 787 文件，产物清单 SHA-256 `A2BB3AA2476C3F3F0602AC66AEF1546D57758463A94ED957EFB4FCB80A425E03`；Web 共 57 文件，清单 SHA-256 `F56AC5C3287F9C3D51A037E79583B924E263E6E7D9BA2580C1EAD84549736D05`。这些是已构建副本的执行证据，不代表复验期间继续写入的新源码已构建或已通过。临时副本首次目录层级不匹配 Prisma 相对路径导致启动拒绝，未执行测试；调整为与原 dist 同深度后启动成功，原启动错误另行保留，不计入通过或业务失败。

结束时间 **17:35:41**，API/Web 副本前后零变化。工作区原始 API/shared 等源码和构建产物仍有并行变化，完整差异另存；不能把固定副本结果扩展成最新依赖或整个仓库已验收。

## 失败复现及收尾修复

- API 首次全套因未构建 `@workmesh/shared` 导致一个套件加载失败；先构建 shared，再完整重跑，最终 92 文件、857 项通过。
- 手机任务详情在 390px 的初次浏览器复验发现约 90px 页面级横向溢出，调整为纵向布局后，桌面和小屏定向检查及最终全套通过。
- UI Review 首次完整运行 **59 通过、4 失败**：通知条目新增动作提示后，旧 `.notification-item small` 匹配两段文字。修正为定位明确通知按钮，再分别检查作者时间与动作提示可见、字号与溢出；没有使用 first/nth 忽略多匹配。原四尺寸复现 **4/4 通过**，最终完整 **67/67 通过**。
- 独立复审发现 CLI `review reply` 强制问题版本，但默认 `review show` 不显示该版本。新增三个默认文本用例先复现失败，再让 show、issue/reply 使用服务端问题版本；CLI 全套重跑通过。
- 输入审查补修跨项目引用、历史快照归属、manifest/索引一致性、权限撤回和等长正文篡改；真实数据库新增 **6/6**，原任务 DB 回归 **29/29** 通过，并计入最终 84 项集成结果。
- 收尾核对发现部署文档把并行隔离库中的 22 条记录误写成源码迁移数量；按实际 SQL 纠正为 21，并在新的隔离空库验证当前迁移集。未修改历史发行制品验收记录。
- Windows CLI 原完整套件得到 347 通过、1 失败、2 跳过及一次未处理拒绝：将临时配置原子替换为 `workspace.json` 时发生 `EPERM`。未确定具体持锁进程。新增确定性回归修复前 2 失败/2 通过，修复后 4/4；仅在 Windows 对 `EPERM/EACCES/EBUSY` 的同源同目标 rename 最多尝试 6 次、总等待 500ms，不删除目标或放宽权限。原并发用例、三文件 41 项及稳定 CLI 全套 352 项通过。并发测试提前观察拒绝，原成功/回滚断言保留。
- 五个非 product 指南仍要求 `deliver` 后手工创建评审，且把工件主体的任务版本误写为 artifactSetVersion。改为读取真实 `reviewRequestId` 后 `review show`，返修同样使用新交付返回编号；原操作不确定先核对收据。backend 升至 **1.2.2**，frontend/ui/qa/ops 升至 **1.2.1**，product 保持 **1.2.1** 且 manifest 指纹不变；生成、资源一致性与包登记回归通过。
- 严格 JSON 增补期间 Web 649 项中的两条旧文案断言曾失败；最终错误提示保留原可识别表述，未修改断言规避失败。映射定向 31/31，后续稳定 Web 全套 656/656 通过。
- 新增完整依赖图读取后，工作台原查询次数断言曾失败。仅该测试补齐成功的 scope 校验并验证三次查询的精确项目、修订和字段范围；没有靠缺失 mock 引发的异常跳过新读取。需求详情新增当前交付/代次关联后，旧评审 fixture 缺字段曾失败；并行作者补齐关联后定向 10/10，最终 API 全套 894/894 通过。
- 新增信任链聚合的 shared 导出一度缺失，API 类型/构建失败；补充已有模块导出并重建后通过。后续新增 O6 契约仍属于单独计划，不能沿用这次构建结果。

## 原始证据位置

以下为本机 `.tmp` 诊断文件，不是发行制品或已提交证据。结构化行为结论保存在本文；完整命令输出可在本机复核。

- `.tmp/user-journey-api-unit-auditfinal-20261110.log` 及同前缀的 `before/after/fingerprint-summary.json`；API 894 项与实际加载产物范围。历史日志 `user-journey-api-unit-final.log` 不再代表最新计数。
- `.tmp/user-journey-api-integration-node24-20261110.log` 为 85 项；历史 84 项保留在 `user-journey-api-integration-current-final.log`、`user-journey-api-integration-current21.log`。
- `.tmp/user-journey-api-{typecheck,build}-current-node24-20261110.log`、`user-journey-api-types-auditfinal-20261110.log`；分别记录实际执行时的类型/构建。
- `.tmp/user-journey-final-migrations.log`、`user-journey-final-migration-evidence.json`。
- `.tmp/user-journey-web-tests-closeout-20261110.log`、`user-journey-web-typecheck-closeout-20261110.log`、`user-journey-web-exit-closeout-20261110.json` 为稳定的 656 项和类型结果；构建时间见 `user-journey-realweb-exits-20261110.json`。
- `.tmp/user-journey-cli-test-20261110.log` 和 `user-journey-cli-test-exit-20261110.json` 为稳定 352 项；`user-journey-cli-test-full-handoff-20261110.log`、`user-journey-cli-test-final-handoff-20261110.log` 及各轮指纹保留后续并行扩展检查。
- `.tmp/user-journey-browser-20261110-stable.log` 保留 73/79 和 6 项渲染失败；`user-journey-browser-20261110-six.log`、同前缀 report/exit、source-current-final 指纹保留 6 项稳定恢复。
- `.tmp/user-journey-ui-final-20261110.log`、`user-journey-ui-final-20261110-report.json`、`user-journey-ui-final-fingerprint-summary-20261110.json` 为 83 项与运行期间变化。通用 `ui-review-results/report.json` 会被后续测试覆盖，以独立副本为准。
- `.tmp/user-journey-role-guide-{build,test,typecheck,api-seeder,format}.log` 记录角色教程、生成与回归；`user-journey-workbench-scope-after.log` 记录授权/查询范围定向。
- `.tmp/user-journey-contracts-current-node24-20261110.log`、`user-journey-shared-node24-20261110.log`、`user-journey-docs-format-20261110.log`、`user-journey-diff-check-20261110.log`。
- `.tmp/web-closeout-real-browser-original-failures-20261110/` 保留首次两失败日志和页面上下文；`web-closeout-real-browser-frozen-20261110.log` 与同前缀 JSON 报告记录两项复验；`web-closeout-frozen-artifacts-20261110.json` 及同深度 API/Web 前后指纹记录实际产物。

## 仍保留的产品与验证边界

- 知识绑定提供 upsert，尚无删除入口；绑定不授予知识库 READ。准备清单不替代实例中的人员分配、独立签字安排或本机 checkout。
- `GIT_REF` 只能报告外部引用与本机核验要求。必需上游输入只有 Git 引用时，正式快照仍返回 `422 INPUT_UNAVAILABLE / SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED`，需上游补交并验收可展开的 HOSTED 正文；本机检查不能解除这个限制。
- 质量包映射只分析有权限的完整 HOSTED JSON 与当前可读取的版本依据。提交者自报、外部地址、缺少可核对 commit、原始测试执行真实性和业务效果均需人工核验，不产生自动批准或语义门禁。
- 问题解决不替代 HUMAN 批准；任务领取前的只读资格不预留任务，也不保证输入或本机环境可用。
- 通知已读仅在当前浏览器按账号保存，最多 1000 个事件 ID，未做服务端或跨设备同步。部分目的地明确进入项目集合，未知目标不伪造深链。
- 当前没有自助密码找回。项目管理员身份不包含重置平台账号密码的权限。
- 本轮已补真实 API/DB 浏览器交付与基线变更，但未执行当前工作树的完整 `pnpm verify`、真实 Web→设备授权→CLI→API/DB 接入链、跨设备或 Linux/macOS 全流程、GitHub live、远端 CI、新 ZIP 安装/备份恢复及正式业务验收。历史制品、旧数据库和固定产物的结果不扩大为本轮这些步骤或后续并行功能的通过证据。
- Gerrit Attention Set 官方页面在本轮调研时网络读取超时，设计文档保留该来源的读取限制。
