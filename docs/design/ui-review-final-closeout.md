# 原始 32 项页面审查统一结项记录

本记录针对用户最后确认的范围：仅补齐 #15、#26、#27、#29 及其必要回归，不重新开发其余 28 项。workspace onboarding / T1–T11 不属于本次任务。原材料是 `C:/Users/Windows11/.codex/attachments/d3909c3b-1ead-40da-aeed-e860116475a2/已粘贴的文本.txt`。

最新数量为：**31 项已解决，#15 按用户明确调整后的范围结项 1 项，部分解决 0 项，完全未做 0 项**。其中 28 项承接已完成基线，4 项完成本轮收口。**“我的待处理邀请列表”和邀请发现接口仍未实现**，不能把本次 32 项结项解读为原邀请发现能力已经上线。

## 32 项状态与证据

下表中的“基线已解决”表示承接用户确认的上一轮完成状态；本轮核对当前实现及已有测试，并通过 Web 全量和相关浏览器必要回归，没有逐项重新开发或声称重新完整验收其全部历史场景。“本轮结项”四项的细节及验证边界见后文。

| 编号 | 审查问题                   | 最新状态                          | 当前实现与可追溯依据                                                                                                                                                                                                                                                         |
| ---- | -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 评审确认缺少可读业务决定   | 基线已解决                        | [ReviewDecision.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/ReviewDecision.test.tsx) 覆盖决定、说明更新和确认摘要；[DecisionSummary.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/DecisionSummary.test.tsx) 对应业务摘要组件。                                    |
| 2    | 截断证据不能查看全文       | 基线已解决；本轮必要回归通过      | [ReviewDecision.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/ReviewDecision.test.tsx) 覆盖完整正文、下载及失败重试；本轮 [evidence.spec.ts](G:/yesgoo/workmesh/tests/ui-review/evidence.spec.ts) 四视口核验批准阻断与恢复。                                               |
| 3    | 上下文失败被当作无资料     | 基线已解决；本轮必要回归通过      | [ReviewDecision.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/ReviewDecision.test.tsx) 区分无关联、403、失败与重试；[evidence.spec.ts](G:/yesgoo/workmesh/tests/ui-review/evidence.spec.ts) 覆盖真实错误契约。                                                             |
| 4    | 批量确认隐式处理筛选外项目 | 基线已解决                        | [Workbench.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Workbench.test.tsx) 覆盖筛选变化清除选择及项目切换竞态。                                                                                                                                                          |
| 5    | 批量部分失败无法判断结果   | 基线已解决                        | [Workbench.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Workbench.test.tsx) 覆盖已确认/失败/未处理计数、失败停止及成功项不重复提交。                                                                                                                                      |
| 6    | 刷新失败仍显示在线成功     | 基线已解决；本轮必要回归通过      | [Workbench.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Workbench.test.tsx) 和 [pages.spec.ts](G:/yesgoo/workmesh/tests/ui-review/pages.spec.ts) 核验 stale、更新时间及重试。                                                                                             |
| 7    | 流程任务卡不能直达任务     | 基线已解决；本轮必要回归通过      | [RequirementDetail.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/RequirementDetail.test.tsx) 覆盖页签、定位、焦点、高亮与 taskId URL 恢复；[pages.spec.ts](G:/yesgoo/workmesh/tests/ui-review/pages.spec.ts) 核验真实入口。                                                |
| 8    | 缺少依赖证据却宣称可领取   | 基线已解决                        | [RequirementPipeline.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/RequirementPipeline.test.tsx) 和 [RequirementDetail.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/RequirementDetail.test.tsx) 覆盖未知状态、前置任务和 readiness。                               |
| 9    | 普通成员缺少初始化说明     | 基线已解决                        | [RequirementDetail.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/RequirementDetail.test.tsx) 覆盖等待管理员、真实管理员联系信息、无联系人不编造，以及权限上下文故障。                                                                                                      |
| 10   | 初始化弹窗难定位缺项       | 基线已解决；本轮名称改动回归通过  | [WorkflowInstanceDialog.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/WorkflowInstanceDialog.test.tsx) 和 [Requirements.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Requirements.test.tsx) 覆盖责任人、审批人、仓库和验收归属校验。                               |
| 11   | 评审只显示第一页           | 基线已解决                        | [Reviews.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Reviews.test.tsx) 覆盖 cursor、追加去重、失败保留列表及继续加载。                                                                                                                                                   |
| 12   | 搜索无结果空态不准确       | 基线已解决                        | [Workbench.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Workbench.test.tsx) 区分加载、失败、真实空态、筛选无结果及清除筛选。                                                                                                                                              |
| 13   | 注册标题误称创建工作区     | 基线已解决                        | [Register.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Register.tsx) 及 [Register.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Register.test.tsx) 使用“创建账号”。                                                                                                          |
| 14   | 项目请求失败误显示空项目   | 基线已解决；本轮必要回归通过      | [Projects.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Projects.test.tsx) 和 [pages.spec.ts](G:/yesgoo/workmesh/tests/ui-review/pages.spec.ts) 区分 403、500、成功空列表。                                                                                                |
| 15   | ProjectSelect 空项目死路   | 本轮结项，用户确认范围调整        | [ProjectSelect.tsx](G:/yesgoo/workmesh/apps/web/src/components/ProjectSelect.tsx)、[ProjectSelect.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/ProjectSelect.test.tsx)、真实调用点及邀请流程；邀请发现明确不在本次。                                                 |
| 16   | 已登录用户邀请失败不可见   | 基线已解决；本轮必要回归通过      | [Invite.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Invite.test.tsx) 保留真实 token 路径、登录返回路径及可读错误。                                                                                                                                                       |
| 17   | 凭据空态没有下一步         | 基线已解决                        | [Profile.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Profile.tsx) 及 [Profile.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Profile.test.tsx) 保留 CLI 设备授权说明和入口。                                                                                                 |
| 18   | 知识库空态缺少 Agent 引导  | 基线已解决                        | [Knowledge.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Knowledge.tsx) 和 [Knowledge.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Knowledge.test.tsx)；本轮仅适配并回归其当前卡片界面，没有认领并行知识库改版。                                                             |
| 19   | ACL 无法新增授权对象       | 基线已解决；本轮权限状态回归通过  | [Roles.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Roles.test.tsx) 覆盖成员/角色添加、去重、权限 diff 和精确 payload；[permissions.spec.ts](G:/yesgoo/workmesh/tests/ui-review/permissions.spec.ts) 覆盖 403。                                                           |
| 20   | 流水线把数量误当完成       | 基线已解决                        | [ProjectPipelineOverview.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/ProjectPipelineOverview.test.tsx) 覆盖中性连接线、真实完成证据和互斥状态统计。                                                                                                                 |
| 21   | PRD 差异制造假差异         | 基线已解决；本轮必要回归通过      | [diff.test.ts](G:/yesgoo/workmesh/apps/web/src/lib/diff.test.ts)、[DiffViewer.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/DiffViewer.test.tsx)、[pages.spec.ts](G:/yesgoo/workmesh/tests/ui-review/pages.spec.ts) 对应真实行对齐及双版本对比。                      |
| 22   | 搜索遗漏候选版本标题       | 基线已解决                        | [Prds.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Prds.test.tsx) 覆盖所有修订标题、版本状态及分页需求索引。                                                                                                                                                              |
| 23   | 导航按内部模块组织         | 基线已解决                        | [nav.test.ts](G:/yesgoo/workmesh/apps/web/src/nav.test.ts) 核验工作、交付、团队、设置及真实路径。                                                                                                                                                                            |
| 24   | 项目上下文不持续统一       | 基线已解决；本轮必要回归通过      | [ProjectContextBoundary.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/ProjectContextBoundary.test.tsx) 覆盖 URL 优先、记忆、后退与旧请求竞态；[pages.spec.ts](G:/yesgoo/workmesh/tests/ui-review/pages.spec.ts) 核验切换和刷新。                                      |
| 25   | 工作台技术化装饰过重       | 基线已解决                        | [Workbench.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Workbench.tsx) 和 [Workbench.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Workbench.test.tsx) 保留中文业务状态、等待信息和优先行动。                                                                                |
| 26   | 多层 CSS 叠加不稳定        | 本轮结项，按确认的有限范围        | [ui-review-style-audit.md](G:/yesgoo/workmesh/docs/design/ui-review-style-audit.md) 列出级联、组件族、保留用途和无引用 runs 清理；四视口代表性交互通过。                                                                                                                     |
| 27   | 辅助信息字号过小           | 本轮结项，按确认的有限范围        | [ui-review-style-audit.md](G:/yesgoo/workmesh/docs/design/ui-review-style-audit.md)、[readability.spec.ts](G:/yesgoo/workmesh/tests/ui-review/readability.spec.ts)、[evidence.spec.ts](G:/yesgoo/workmesh/tests/ui-review/evidence.spec.ts) 核验实际计算字号、长文本和状态。 |
| 28   | 首屏没有突出优先行动       | 基线已解决；本轮必要回归通过      | [Workbench.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Workbench.test.tsx) 覆盖逾期置顶、筛选同源统计和真实行动；[pages.spec.ts](G:/yesgoo/workmesh/tests/ui-review/pages.spec.ts) 核验入口。                                                                            |
| 29   | 流程配置缺少结构化编辑     | 本轮结项，按确认的名称及 ALL 语义 | [WorkflowDefinitionEditor.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/WorkflowDefinitionEditor.test.tsx)、[Workflows.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Workflows.test.tsx)、共享/API/数据库和四视口浏览器测试。                                       |
| 30   | 远程机器人图片不稳定       | 基线已解决                        | [RequirementPipeline.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/RequirementPipeline.test.tsx) 核验随仓库分发的本地图片，无第三方头像请求。                                                                                                                         |
| 31   | 流程装饰遮蔽可执行信息     | 基线已解决；本轮必要回归通过      | [RequirementPipeline.test.tsx](G:/yesgoo/workmesh/apps/web/src/components/RequirementPipeline.test.tsx) 和 [RequirementDetail.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/RequirementDetail.test.tsx) 覆盖默认折叠、阻塞原因、负责人及下一步。                           |
| 32   | 移动表格操作不可达         | 基线已解决；本轮必要回归通过      | [Requirements.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Requirements.test.tsx)、[Roles.test.tsx](G:/yesgoo/workmesh/apps/web/src/pages/Roles.test.tsx) 及 [pages.spec.ts](G:/yesgoo/workmesh/tests/ui-review/pages.spec.ts) 核验卡片、展开详情和四视口页面溢出。       |

## #15：邀请链接范围内结项

真实 `ProjectSelect` 调用点包括需求、看板、项目流水线、知识库、PRD、角色、评审、流程配置及当前项目工作区。它们的创建入口均导航到真实 `/projects`；项目工作区只核对共享选择器接线，不扩展 onboarding。

组件区分首次加载、成功空列表、无旧数据的失败、有旧数据的刷新失败和正常选择。成功空态说明创建项目或打开管理员发送的邀请链接，没有因为空列表断言用户对某个项目无权访问；403 使用真实错误与联系项目管理员提示，不编造联系人。无真实 token 的邀请回调/按钮已移除。已有 `/invite/:token` 校验、登录返回和接受流程保持可用。

**范围调整：本次不新增“我的待处理邀请列表”及邀请发现 API，该能力未实现。** 目前由项目管理员创建并发送真实邀请链接，用户打开该链接加入。后续独立能力的最小方案、身份绑定、状态和权限边界见 [ui-review-contract-proposals.md](G:/yesgoo/workmesh/docs/design/ui-review-contract-proposals.md)。

后续如启动邀请发现，推荐先采用可证明的收件人身份（已验证邮箱或明确绑定用户 ID），再开放本人待处理列表和受绑定校验保护的接受动作；当前 `User` 没有邮箱验证状态，不能仅按未验证邮箱匹配暴露邀请。待处理应排除已接受、撤销和过期，接受时仍重新校验并使用事务/CAS。是否展示归档或不可接受历史邀请及如何绑定无邮箱邀请属于后续产品/API 决策，不阻塞本次已调整范围。

## #29：独立步骤显示名称端到端落地

真实定义字段为 `definition.steps[].displayName?: string`。省略表示沿用已有中文显示映射，无法映射时回退 `key`；提供时必须是字符串，trim 后 1–120 个 Unicode code points。`null`、非字符串、空白或超长产生 `/steps/N/displayName` 字段级中文错误。读取与校验不改写原文，Web 展示时 trim；结构化空输入省略字段，key 始终是稳定机器标识。

名称随完整定义保存、编译和发布，不只存在前端状态。结构化/高级 JSON 双向切换、定义级及步骤级未知字段、自动草稿保存/恢复、发布成功清理草稿、CAS 冲突保留草稿均有测试。步骤类型中文显示为产品、交付、验证、发布，提交保留 `PRODUCT / DELIVERY / VERIFY / RELEASE`。

Task、Board、RequirementDetail 的任务及评审、Review 列表/详情/事务返回、Workbench 待评审及可开工、Workflow instance 创建/读取投影新增 `stepDisplayName`。服务端按实例绑定的 `definitionRevisionId` 读取修订，并按对应 `projectId` 限定查询；未授权调用者不获得名称。需求和工作台沿用先授权再查询；评审详情沿用先按 ID 读取记录、再按记录所属真实项目授权的既有顺序，不能声称所有拒绝调用都不查询名称。Web 在看板、需求任务/团队卡、任务评审列表/决定页、工作台和初始化弹窗接线。文档评审保留文档标题；项目流水线聚合需求阶段，没有虚构步骤标题字段。

不同修订保留各自名称，已绑定实例不会跟随最新修订改名。历史定义 JSON、digest、版本和实例绑定不改写；没有名称快照列、没有数据库 schema 改动、没有新增迁移。旧客户端可忽略新增投影，旧定义无需回填。

验收继续使用角色槽位、评审槽位、`gates.reviewerSlots` 和 `ALL`：表达验收归属及所有必需槽位通过，沿用任务/发布验收和 PRD 验收 key 覆盖检查。**没有新增自由文本验收规则、ANY 或任意可执行条件**，这些不等同于既有 ALL 门槛。当前没有需要用户继续决定才能完成的本轮阻塞。

## #26 / #27：有限页面与状态验收

本轮沿用既有 tokens、foundations 和页面迁移，重点补齐实际仍欠缺的动态状态，未以删除所有旧文件或消除所有小字号作为目标。完整分类见 [ui-review-style-audit.md](G:/yesgoo/workmesh/docs/design/ui-review-style-audit.md) 顶部当前结论；下方旧统计是被替代的历史记录。

| 范围                        | 验收状态与实际检查                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| 壳层、顶栏、侧栏、工作台    | 优先行动、stale、筛选空态、非空活动通知、长邮箱、变更抽屉；字号、状态文字、键盘打开/关闭与焦点归还。      |
| 项目、选择器与基础控件      | 正常、加载、成功空态、403、500、网络失败及重试；创建导航、新建/归档弹窗、危险按钮、焦点及页面级横向溢出。 |
| 需求、流水线、详情、看板    | readiness、等待/阻塞/负责人/角色/下一步、任务定位、移动卡片、阶段轨道、完整摘要展开及名称回退。           |
| PRD、知识库、评审列表、凭据 | 双版本对比、同版本阻止、读取失败重试、项目切换、分页、技术元信息和窄屏操作。                              |
| 角色与 ACL                  | 角色抽屉标题和机器 key、键盘/Escape 关闭与归还焦点、403 技术详情、隐藏无权替换操作，不伪装空集合。        |
| 评审证据                    | 截断预览、完整正文加载中→500→键盘重试成功、批准阻断/恢复、校验信息、SHA 展开/复制入口、上下文 403。       |
| 流程编辑器                  | 中文类型、名称字段、结构化/JSON 往返、未知字段、表单键盘和四视口无页面级横向溢出。                        |

本轮实际样式增量是：评审工件摘要/正文预览/全文提高到 14px；角色抽屉标题 14px、技术 key 12px，并接入语义令牌和长文本换行；通知操作者/时间、工作台 Agent 命令提高到 12px。保留有文字的业务状态表达，技术摘要可以聚焦展开并查看完整值，相关入口提供复制或可选择原文。

确认无引用的纯 `.runs-*` 组件族已删除 939 行（index 913、v4 26），包括专属响应式块及 `runs-spin`/`runs-bounce`。当前没有 Runs JSX、页面、导入或路由；GitHub `/actions/runs/42` 是外部证据 URL，不能据此虚构隐藏页面。工作台最近活动使用真实 ActivityItem 契约，已单独构造非空夹具。

确认保留的旧规则承担具体职责：v2 的导航/按钮/表单几何和禁用态，v3 的工作台结构与动画，v4 的流程几何、连接线、状态及断点，index 的通用布局/弹窗几何；页面专属 CSS 继续负责移动卡片、流程轨道和确认抽屉。基础层在最后导入，统一表面、边框、字体、阴影及焦点。局部内联进度宽度、统计图尺寸和组件作用域布局有真实用途，未机械替换。

允许保留 9–10px 的导航短序号、阶段圆点编号、头像首字等极短装饰标记；旁边有完整阶段、角色、负责人或输入框可访问名称。工作台命令 rail 沿用 `<=1100px` 隐藏断点，窄屏任务操作仍可达；浏览器测试核对这一真实行为。低字号声明计数仅用于定位，不能代表实际 DOM 字号或完成度。

## 实际验证、失败与未执行项

本轮使用桌面附带 Node 24.22.1、pnpm 10.28.2；系统 Node 20.13.1 低于仓库要求，后续检查已切换运行时。C 盘空间不足后将 TEMP/TMP 指向 `G:/yesgoo/workmesh/.tmp/ui-review-final-temp`，没有清理未知文件。

| 命令/检查                                                                                                                                                                      | 结果与边界                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @workmesh/shared test`                                                                                                                                          | 10 文件、73 项通过。                                                                                                                                                                                                                                                                                          |
| `pnpm --filter @workmesh/shared build`                                                                                                                                         | ESM/CJS/DTS 构建通过。                                                                                                                                                                                                                                                                                        |
| API 受影响专项，命令见下方                                                                                                                                                     | 8 文件、62 项通过；使用生产 service/repository 配合 Prisma mock，不冒充真实数据库。                                                                                                                                                                                                                           |
| `pnpm --filter @workmesh/api exec tsc --noEmit`                                                                                                                                | 通过，使用当前已生成 Prisma client。                                                                                                                                                                                                                                                                          |
| `pnpm --filter @workmesh/api exec nest build`                                                                                                                                  | 通过，使用当前已生成 Prisma client。                                                                                                                                                                                                                                                                          |
| `pnpm --filter @workmesh/api type-check` 生命周期                                                                                                                              | 前置 Prisma generate 两次因 Windows EPERM 无法 rename 已占用的 query engine DLL；未终止并行 API 或强制覆盖引擎。完整生命周期不能写为通过。普通 API build 同样有 generate 前置步骤，故本轮以直接 nest build 验证代码构建。                                                                                     |
| `pnpm test:integration -- --apply-migrations`                                                                                                                                  | 正式守卫和 isolated-Prisma 检查通过，隔离库应用 20 个现有迁移；首次完整运行 16 文件通过、1 失败、1 跳过，136 项通过、14 失败、1 跳过。14 失败均由新增 task 夹具误改公共 helper 导致重复修订，已修复并复跑受影响文件。没有重跑整个套件并声称全量最终通过。                                                     |
| `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/v1-task.database.spec.ts test/v1-workflow.database.spec.ts`                           | 修复后 2 文件、35 项全部通过，覆盖不同绑定修订和旧 JSON/digest 不变。隔离 PostgreSQL 为 127.0.0.1:55439 / workmesh_test_ui_review_final / workmesh_v1，未连接业务库，完成后已停止本轮集群。                                                                                                                   |
| 数据库跳过项                                                                                                                                                                   | `v1-api-agent.database.spec.ts` 依赖 `WORKMESH_POC_LIVE=1`，本轮未开启；未为凑数量运行独立的真实 Agent POC。最初缺 schema/public 的连接被安全守卫拒绝后按要求更正，没有绕过隔离要求。                                                                                                                         |
| `pnpm --filter @workmesh/web test`                                                                                                                                             | 最新全量 50 文件、497 项全部通过。                                                                                                                                                                                                                                                                            |
| `pnpm --filter @workmesh/web exec vitest run src/pages/Workflows.test.tsx`                                                                                                     | 补强后 1 文件、9 项通过，覆盖名称、未知字段、草稿恢复、发布与 CAS。                                                                                                                                                                                                                                           |
| `pnpm --filter @workmesh/web exec vitest run src/components/ProjectSelect.test.tsx src/pages/Projects.test.tsx src/pages/Invite.test.tsx src/hooks/useProjectContext.test.tsx` | 匹配到的 3 文件、23 项通过；最后给出的 hook 路径没有匹配测试文件，不能将其计为第 4 个通过文件。项目上下文测试仍包含在 Web 全量中。                                                                                                                                                                            |
| `pnpm --filter @workmesh/web type-check`                                                                                                                                       | 通过。                                                                                                                                                                                                                                                                                                        |
| `pnpm --filter @workmesh/web build`                                                                                                                                            | 生产构建通过。                                                                                                                                                                                                                                                                                                |
| 本轮认领文件的格式检查                                                                                                                                                         | 本轮 49 个认领文件中的 47 个 TS/TSX/MD 文件 Prettier 通过；新增本结项文档另行格式化并检查。项目 `format:check` 本来不包括 CSS。index.css 和 ui-v4.css 的显式全文件 Prettier 检查失败，HEAD 原文件同样失败，保留既有格式以避免无关重写；四个旧 CSS 的 PostCSS 语法解析均通过。不能将其写为全文件格式问题清零。 |
| `git diff --check`                                                                                                                                                             | 主代理全工作区检查退出 0，仅有既有 LF/CRLF 转换提示。                                                                                                                                                                                                                                                         |
| Chromium，命令见下方                                                                                                                                                           | 1440、1024、640、390px；54 个不同用例在最后相关运行均通过。通过次数按不同用例统计，不累计重复运行。                                                                                                                                                                                                           |

API 专项实际命令：

```powershell
pnpm --filter @workmesh/api exec vitest run --config vitest.unit.config.mts src/tasks/v1-step-display-name.prisma.spec.ts src/reviews/v1-review.prisma-repository.spec.ts src/projects/requirements.service.spec.ts src/workbench/v1-workbench.service.spec.ts src/workflows/v1-workflow.prisma-repository.spec.ts src/reviews/v1-review.service.spec.ts src/tasks/v1-task.service.spec.ts src/tasks/v1-board.service.spec.ts
```

Chromium 实际运行记录：

```powershell
pnpm exec playwright test -c playwright.ui-review.config.ts
pnpm exec playwright test -c playwright.ui-review.config.ts tests/ui-review/pages.spec.ts tests/ui-review/readability.spec.ts tests/ui-review/permissions.spec.ts tests/ui-review/evidence.spec.ts
pnpm exec playwright test -c playwright.ui-review.config.ts tests/ui-review/evidence.spec.ts --grep '审计活动通知'
```

首轮 50 例中 41 通过、9 失败，失败是并行知识库卡片改版后旧表格选择器失效。按当前真实界面适配后，相关 31 例中 28 通过、3 失败；剩余失败是新增测试错误要求窄屏隐藏的命令 rail 可见。保留真实断点并修正测试后通知 4 视口全部通过。没有回滚知识库改版，也没有放宽字号、页面溢出或键盘验收标准。流程编辑器、步骤名称回退、基础弹窗、变更抽屉与完整摘要等其余通过用例无需无意义重复。

日志分别为 [Web 全量](G:/yesgoo/workmesh/.tmp/ui-review-final-web-tests.log)、[隔离数据库首次完整运行](G:/yesgoo/workmesh/.tmp/ui-review-final-db-tests.log)、[数据库修复后专项](G:/yesgoo/workmesh/.tmp/ui-review-final-db-focused.log)、[Chromium 首轮](G:/yesgoo/workmesh/.tmp/ui-review-final-browser.log)、[相关用例复跑](G:/yesgoo/workmesh/.tmp/ui-review-final-browser-recheck.log)、[通知最终复跑](G:/yesgoo/workmesh/.tmp/ui-review-final-notifications.log)。截图位于 `G:/yesgoo/workmesh/.tmp/ui-review-captures`。Playwright report.json 会被后一次定向运行覆盖，因此不能仅靠最后 report.json 推断 54 例全套同次通过。

浏览器使用 API 契约夹具，未访问真实业务 API。真实 PostgreSQL 验证是独立 API 集成检查；没有执行连接真实后端的浏览器端到端、真实邀请 token 的浏览器验证、实体设备、Safari/Firefox、系统强制高对比度，亦未穷举所有历史定义、工件 MIME 和权限组合。以上限制不冒充已通过环境。

## 本轮实际修改文件

以下仅列本任务认领的增量，不包括工作区内他人并行的 Knowledge/MarkdownReader 改版、onboarding、脚本、发布/治理文档及其他浏览器测试；对其只做必要兼容回归。审计文档原本已未跟踪，本轮在既有内容上更新。

```text
G:/yesgoo/workmesh/packages/shared/src/workflow.ts
G:/yesgoo/workmesh/packages/shared/src/workflow.test.ts
G:/yesgoo/workmesh/apps/api/src/projects/requirements.service.ts
G:/yesgoo/workmesh/apps/api/src/projects/requirements.service.spec.ts
G:/yesgoo/workmesh/apps/api/src/reviews/v1-review.prisma-repository.ts
G:/yesgoo/workmesh/apps/api/src/reviews/v1-review.repository.ts
G:/yesgoo/workmesh/apps/api/src/reviews/v1-review.prisma-repository.spec.ts
G:/yesgoo/workmesh/apps/api/src/tasks/v1-board.prisma-repository.ts
G:/yesgoo/workmesh/apps/api/src/tasks/v1-board.repository.ts
G:/yesgoo/workmesh/apps/api/src/tasks/v1-task.prisma-repository.ts
G:/yesgoo/workmesh/apps/api/src/tasks/v1-task.repository.ts
G:/yesgoo/workmesh/apps/api/src/tasks/v1-step-display-name.prisma.spec.ts
G:/yesgoo/workmesh/apps/api/src/workbench/v1-workbench.service.ts
G:/yesgoo/workmesh/apps/api/src/workbench/v1-workbench.service.spec.ts
G:/yesgoo/workmesh/apps/api/src/workflows/v1-workflow.prisma-repository.ts
G:/yesgoo/workmesh/apps/api/src/workflows/v1-workflow.repository.ts
G:/yesgoo/workmesh/apps/api/src/workflows/v1-workflow.prisma-repository.spec.ts
G:/yesgoo/workmesh/apps/api/test/v1-task.database.spec.ts
G:/yesgoo/workmesh/apps/api/test/v1-workflow.database.spec.ts
G:/yesgoo/workmesh/apps/web/src/api/resources.ts
G:/yesgoo/workmesh/apps/web/src/components/ProjectSelect.tsx
G:/yesgoo/workmesh/apps/web/src/components/ProjectSelect.test.tsx
G:/yesgoo/workmesh/apps/web/src/components/WorkflowDefinitionEditor.tsx
G:/yesgoo/workmesh/apps/web/src/components/WorkflowDefinitionEditor.test.tsx
G:/yesgoo/workmesh/apps/web/src/components/WorkflowInstanceDialog.tsx
G:/yesgoo/workmesh/apps/web/src/components/WorkflowInstanceDialog.test.tsx
G:/yesgoo/workmesh/apps/web/src/pages/Board.tsx
G:/yesgoo/workmesh/apps/web/src/pages/Board.test.tsx
G:/yesgoo/workmesh/apps/web/src/pages/RequirementDetail.tsx
G:/yesgoo/workmesh/apps/web/src/pages/RequirementDetail.test.tsx
G:/yesgoo/workmesh/apps/web/src/pages/Reviews.tsx
G:/yesgoo/workmesh/apps/web/src/pages/Reviews.test.tsx
G:/yesgoo/workmesh/apps/web/src/pages/ReviewDecision.tsx
G:/yesgoo/workmesh/apps/web/src/pages/ReviewDecision.test.tsx
G:/yesgoo/workmesh/apps/web/src/pages/Workbench.tsx
G:/yesgoo/workmesh/apps/web/src/pages/Workbench.test.tsx
G:/yesgoo/workmesh/apps/web/src/pages/Workflows.test.tsx
G:/yesgoo/workmesh/apps/web/src/index.css
G:/yesgoo/workmesh/apps/web/src/ui-v4.css
G:/yesgoo/workmesh/tests/ui-review/fixtures.ts
G:/yesgoo/workmesh/tests/ui-review/pages.spec.ts
G:/yesgoo/workmesh/tests/ui-review/readability.spec.ts
G:/yesgoo/workmesh/tests/ui-review/workflows.spec.ts
G:/yesgoo/workmesh/tests/ui-review/dynamic-states.spec.ts
G:/yesgoo/workmesh/tests/ui-review/evidence.spec.ts
G:/yesgoo/workmesh/tests/ui-review/permissions.spec.ts
G:/yesgoo/workmesh/tests/ui-review/step-names.spec.ts
G:/yesgoo/workmesh/docs/design/ui-review-style-audit.md
G:/yesgoo/workmesh/docs/design/ui-review-contract-proposals.md
G:/yesgoo/workmesh/docs/design/ui-review-final-closeout.md
```

## 工作区保护

开始前记录的 git status 保存在 `C:/Users/Windows11/AppData/Local/Temp/workmesh-review-final-baseline.txt`；两份既有审计分别留有修改前副本。工作区在任务前已有大量修改和未跟踪文件，过程中也有其他并行任务继续写入，最终工作区仍非干净状态。没有执行 reset、clean、覆盖式 checkout、删除他人文件或创建 commit。

本轮开始与收尾核对的 HEAD 均为 `1fd1635693a77e4b66b0e06818f553719872f494`。仅停止本轮 `G:/yesgoo/workmesh/.tmp/ui-review-final-pgdata` 对应的隔离 PostgreSQL，没有终止占用 Prisma DLL 的并行 API 或其他 PostgreSQL 实例。
