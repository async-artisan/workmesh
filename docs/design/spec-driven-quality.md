# 规格与交付质量方法

> 2026-11-09。采用 GitHub Spec Kit 的方法，嵌入 WorkMesh 现有角色包、本地 CLI、快照、知识和评审链。采用台账以此为准，功能状态与验证范围分别记录。

## 采用判断

一项机制只有同时满足以下条件才引入：解决实际交接或验证问题、复用现有权威事实、复杂度与收益匹配、有明确使用阶段和可复核产物。简单修改可以合并文档和步骤，信息齐全即可；新流程配置不得悄悄改变已有实例。

平台继续负责正式事实、版本、权限和 HUMAN 决定。本地 Agent 调查、提案、实现、分析；检查结果按来源展示，不因存在报告就视为功能通过。

## 已采用的机制与入口

| Spec Kit 优点                  | 在 WorkMesh 中的落点                                              | 使用时机与边界                                                |
| ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| 提案前评估问题、正反证据与投入 | product `assess-idea`、`idea-assessment.md`、既有 BRAINSTORM 状态 | 形成 GO / NEEDS_CLARIFICATION / STOP 建议；不自动建需求或开工 |
| 成文项目原则、修订和例外       | 项目 conventions 模板、已发布 KNOWLEDGE、required 角色绑定        | 使用现有知识发布与快照；不新增第二份权威 constitution         |
| 规格描述结果，技术方案描述实现 | PRD 的场景与可观测验收；backend `plan-change`                     | 按风险补充信息，不强制固定页数或 15 章                        |
| 澄清重要歧义并回写规格         | product `clarify-intent` 与现有单题协议                           | 先查资料、再询问业务决定，未知项不可伪装成结论                |
| 需求本身的质量清单             | product `check-requirements`、角色 `spec-driven.md`               | 根据认证、数据、交互、集成等风险选择；区分需求定义和测试执行  |
| 老项目调查、依据与备选方案     | backend `plan-change`、`change-plan.md`；所有角色开工清单         | 记录当前行为、工具配置、兼容性、来源与取舍                    |
| 按可独立验证的场景拆任务       | 实现计划中的验收 key、依赖、文件归属与验证方式                    | 共享基础先就绪；并行标记不是自动执行许可                      |
| 按价值排序并交付端到端切片     | PRD P1/P2/P3；实现计划先定义可独立验证的 MVP 和延期条件           | 多场景时使用；只是计划建议，不改变正式范围或批准状态          |
| 跨工件一致性与覆盖分析         | 本地 `workmesh quality`、product 语义检查记录                     | 程序检查结构、引用、覆盖和版本；语义结论保留 Agent 来源       |
| 实现后逐条核验并追加缺口       | QA `audit-delivery`、`delivery-audit.md`、DELIVERY 质量包         | 对照真实代码和执行结果；追加返修/后续工作提案，HUMAN 决定     |
| 缺陷使用轻量专用路径           | backend `diagnose-bug`、既有 impl/缺陷记录                        | 保存原始复现，调查、最小修复、原始复现重验；范围变化走变更    |
| 规格持续演进、证据随版本变化   | 复用既有候选修订、需求变更、快照失效和追加审计                    | 不直接覆盖已批准历史，不以本地勾选替代平台状态                |
| 模板与宿主适配分离、按需加载   | 现有 manifest、技能索引、codex/claude-code 适配和版本锁           | 新资源通过新角色包版本安装；项目规范留在项目知识中            |

以上为本次已落到角色方法、模板或本地校验中的采用项。评审页已增加验收条件与证据映射，读取有权限的完整 HOSTED 质量包，显式核对验收 key、PRD、快照与已声明的完整 commit，并保留来源、失败、版本差异及待人工核验状态；行为与验证范围见[使用者路径优化记录](../testing/user-journey-validation-2026-11-09.md)。服务端澄清资源、自动把语义报告变成平台门禁仍未实现；不能用本地分析或映射视图替代平台正式决定。

## 项目规范如何生效

1. 老项目先从实际代码和 eslint、prettier、测试、构建等配置抽取现状，再与负责人确认需要改变的规则。
2. 使用 `project-templates/software/conventions.md` 与 YAML 规则表；规则写 `id / statement / scope / enforcement / check`，例外写依据、负责人和复查条件。
3. 使用当前 `candidate --kind KNOWLEDGE` 提交正文。经 HUMAN 发布后，在项目准备页绑定给相应角色且设 required；绑定不代替知识库 READ 权限。
4. 编码角色取得快照时核对规则正文和修订确实在资源中。缺失时由项目管理员补发布、绑定或权限，不凭本地副本假定已生效。
5. `LINT/CI` 的规则指向真实执行入口，交付附真实检查证据；`REVIEW` 的规则附具体审查位置。平台不代跑工具。

`CONVENTIONS` 是设计概念，当前 API kind 未开放；使用已支持的 KNOWLEDGE 链路即可承载这些治理信息。项目不另外维护 `.specify/memory/constitution.md`。

## 本地质量包

从 [示例](../../project-templates/software/quality-bundle.example.json) 开始，填真实数据后执行：

```bash
workmesh quality --file quality-bundle.json --json
```

无需登录或联网；只读显式选定文件，不执行任务，不访问证据引用，不修改平台。现有源码开发入口为 `node apps/cli/dist/index.js quality ...`。

| 字段            | 要求                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `1.0` 或 `1.1`；1.0 保留旧语义，并明确缺少执行到用例修订的精确关联                                                                                             |
| `stage`         | `PLAN` 或 `DELIVERY`                                                                                                                                           |
| `requirementId` | 需求标识，用于报告回链；工具不查询服务端真实性                                                                                                                 |
| `basis`         | 必填 PRD 修订 `prdRevisionId`、快照 `snapshotId`；1.1 还需 WorkMesh 登记的 `projectRepositoryId`；DELIVERY 还需完整小写 `commitSha`                            |
| `acceptance[]`  | 1–200 条，`key / text / verification`；key 与正式候选 API 同一约束                                                                                             |
| `tasks[]`       | `id / acceptanceKeys / dependsOn / files`，可选 `parallel`；files 使用仓库相对路径，无点段                                                                     |
| `cases[]`       | `id / covers / kind`；kind 与引用验收的 verification 一致；1.1 增加 `revision: { artifactId, sha256 }`                                                         |
| `evidence[]`    | 必须显式提供，PLAN 可为空；每项 `id / acceptanceKeys / result / source / ref / basis`；1.1 增加非空 `caseRefs: [{ caseId, revision: { artifactId, sha256 } }]` |

证据 result 为 `PASSED / FAILED / BLOCKED / NOT_RUN`；source 为 `AGENT_REPORTED / EXTERNAL_REFERENCE`。每项证据必须绑定 PRD、快照和完整代码提交。`ref` 是可复核位置，不代表工具已解析、下载或信任其内容。

程序报告非法结构/标识、重复 ID、未知验收或任务引用、遗漏的任务/匹配用例、依赖环、无依赖顺序且共用文件的并行任务、过期证据。DELIVERY 中失败、阻塞、未运行、缺失均非零退出，不能被另一个 PASSED 结果隐藏。目录与文件重叠也算并行冲突；应使用仓库真实大小写填写路径。

结果信封为 `{ data, meta: { requestId } }`。失败时返回统一错误信封，`error.details.report` 保留结构化问题与覆盖表，退出码 2。结构无效时 status 为 INVALID，存在覆盖/引用/版本缺口时为 INCOMPLETE，否则为 CONSISTENT。

CONSISTENT 仅表示输入数据满足本地规则。PLAN 的逐条状态是 PLANNED；DELIVERY 证据齐全且全报通过时是 REPORTED_PASS，报告仍携带 `authority: LOCAL_REPORTED` 和待核验证据警告。工具不验证代码实现、不验证测试执行、不取代服务端当前版本校验或 HUMAN 批准。

多仓库交付按仓库/提交分别出报告，当前单包只绑定一个 commit；不要把不同代码库的证据混在同一 basis 中。

### 1.1 精确用例执行关联

`cases[].revision` 指向已经交付的不可变 CASES 工件 ID 与真实 64 位小写 SHA-256。同一 CASES 工件可以包含多个 case，但同一工件 ID 不能声明多个摘要。先形成用例工件，再从实际交付收据取引用；尚未形成工件时先保存计划，不在 1.1 包里填写假 ID。质量包不得引用自身作为用例设计工件，也不要求 CASES 正文自填自身摘要。

每条 `evidence.caseRefs` 指定实际执行的用例和相同修订，不能只按验收 key 推断。`acceptanceKeys` 必须等于这些用例 `covers` 的并集；未知/重复 case、旧修订、摘要冲突和错误验证方式均不能补齐执行覆盖。DELIVERY 必须为全部声明用例提供明确结果；同一验收下仅一个用例 PASS 而其他用例没有结果时保持 MISSING。所有已报失败、阻塞或未执行继续可见，其他 PASS 不能掩盖它们。证据与包的 PRD、快照、登记仓库 ID 和完整提交都需一致。

分析报告自身的 `schemaVersion` 仍为 `1.0`；`bundleSchemaVersion` 表示输入包版本，`executionLinkage` 为 `LEGACY_UNLINKED / EXPLICIT_CASE_REVISION`，`caseCoverage` 输出 1.1 各用例的修订、证据 ID 与状态。旧包的 `caseCoverage` 为空，并携带 `LEGACY_CASE_LINKAGE_MISSING` 警告；不能只修改 schemaVersion 把旧包升级。

这些判断仍是 `LOCAL_REPORTED`：本地工具不查询 CASES 工件是否存在、是否属于本需求或当前是否可读，不核验测试实际运行。后续服务端关联需按项目、权限和不可变工件字节另行核对。1.1 拒绝未知字段及 `verified / authority` 等自填权威；现有 HUMAN 决定链和门禁不因质量包改变。

主[计划样例](../../project-templates/software/quality-bundle.example.json)展示 1.1；[交付样例](../../project-templates/software/quality-bundle.delivery.example.json)保留 NOT_RUN，[旧版样例](../../project-templates/software/quality-bundle.legacy.example.json)展示 1.0 兼容。所有 ID、摘要、提交和结果均为模板占位，必须替换真实数据后使用，不能当作行为证据。

### CI JSON 结果报告的纯输入契约

`WORKMESH_CI_RESULTS` 1.0 的[样例](../../project-templates/software/ci-result-report.example.json)包含 `run / basis / environment / results`。`run` 声明 GitHub 的十进制 `repositoryId / runId`、正整数 `runAttempt`、`jobKey`、可选 `jobId`、事件、`headSha / testedCommitSha`；`basis.projectRepositoryId` 是 WorkMesh 登记仓库 ID，不能与提供方数字 ID 混用。实际被测提交需等于 basis.commitSha，headSha 可以不同，但这种声明不证明事件的代码绑定有效。

每条 result 携带唯一 ID、精确 `caseRef` 和 `PASSED / FAILED / BLOCKED / NOT_RUN`，同一报告的 caseId 唯一，不混合重试或不同修订；相同 CASES 工件 ID 的摘要必须一致。解析限制为 4 MiB、1–2000 条结果，严格拒绝重复 JSON 键、浮点数、未知结论、额外字段与自行填写的权威。零结果不表示零失败。纯解析成功只返回 `LOCAL_REPORTED`，不会联网或生成提供方证明。

报告不能填写自身 artifact ID 或自身摘要；上传后形成的 provider artifact ID、压缩包与报告字节摘要、采集时间和范围由服务端采集信封另存。GitHub artifact 元数据不直接给出 attempt/job 关系，文件名、时间及报告自行填写的 runAttempt/jobId 不足以证明归属；缺少可核对依据时保留未知。此处只交付输入契约，Actions 采集、服务端授权和真实闭环按交付验证计划 EV-07 以后单独实施。

## 模板契约与升级

正式验收仅使用 `key / text / verification`。风险分类与优先级写 PRD 或评审记录，不能放进 API 不保存的字段并声称已生效。YAML 模板供人阅读，JSON 数组供 `candidate --acceptance @acceptance.json` 使用；构建会拒绝两者不一致、非法 key、额外字段，以及 QA 示例引用或验证方式漂移。

六个内置角色包的基础方法版本为 1.2.0；增补价值优先级与 MVP 切片后，product/backend 升为 1.2.1。随后修正普通交付自动创建评审的角色指引，backend 升为 1.2.2，frontend/ui/qa/ops 升为 1.2.1，product 保持 1.2.1；本轮精确用例修订关联将 QA 升为 1.2.2、backend 升为 1.2.3。最新完整循环先只读检查输入，再使用 deliver 返回或原交付收据中的真实 reviewRequestId 查询评审。既有锁定内容不覆盖。更新通过现有 setup/roles install 的预览与受管文件检查，发现本地修改先按现有诊断处理；项目自定义规则随知识修订发布。新增文档和模板按当前任务允许的工件类型提交，不增加隐含 outputKinds 或审批槽。

## 未采用的部分

- 不引入 Specify CLI、第二套需求编号/分支/状态目录，也不让仓库文件与平台各自决定哪个基线生效。
- 不把每条需求都串成固定长流程，不按每个小决定强制生成独立 research/data-model/quickstart 文件。
- 不引入任意 hook 执行器、插件市场和大量宿主适配；已有两个宿主及角色资源安装足以承载本次方法。
- 不启动自动收敛修复循环、不把 Agent 自报升级成机器已验证或正式批准。

## 复核后保留的功能缺口

产品和后端角色已增补按价值排序、MVP 端到端切片与独立验证检查点；质量包现支持 1.0/1.1 并存识别。评审页与 CLI 统一使用 shared 的严格 JSON 解析，重复字段不能用后值覆盖前值参与验收映射。

1.1 已补充本地执行证据到具体用例 ID/不可变修订的机器关联，1.0 仍明确缺少该能力。服务端实际 CASES 工件授权核对、外部运行来源及当前适用性仍需按交付验证计划继续实施；本地一致性不能替代这些事实。WP12 澄清问题与任务阻塞/精确恢复仍按既有开发计划推进。

## 官方来源与复核

复核版本：GitHub `github/spec-kit` main 提交 `a60bd9bad5af2d25df42188330e8281f2dd1c8bb`（2026-11-09 核对）。只借鉴机制与取舍，本文及角色方法为 WorkMesh 场景的独立表述。

- [官方流程与选择](https://github.com/github/spec-kit/blob/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/README.md)
- [想法评估指南](https://github.com/github/spec-kit/blob/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/docs/guides/assessment.md)
- [规格、技术规划与任务](https://github.com/github/spec-kit/tree/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/templates)
- [按用户故事和 MVP 组织任务](https://github.com/github/spec-kit/blob/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/templates/tasks-template.md)
- [需求质量 checklist](https://github.com/github/spec-kit/blob/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/templates/commands/checklist.md)
- [跨工件分析](https://github.com/github/spec-kit/blob/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/templates/commands/analyze.md)
- [交付收敛](https://github.com/github/spec-kit/blob/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/templates/commands/converge.md)
- [缺陷诊断与复验指南](https://github.com/github/spec-kit/blob/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/docs/guides/bugfix.md)
- [项目原则与治理](https://github.com/github/spec-kit/blob/a60bd9bad5af2d25df42188330e8281f2dd1c8bb/templates/commands/constitution.md)

## 验证记录

本次定向测试、类型检查、构建与未执行范围见 [采用验证记录](../testing/spec-driven-quality-validation-2026-11-09.md)。

后续 MVP 方法与评审页严格解析增补见 [2026-11-10 增补验证](../testing/spec-driven-quality-followup-validation-2026-11-10.md)。
