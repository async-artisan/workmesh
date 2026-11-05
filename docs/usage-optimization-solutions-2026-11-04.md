# WorkMesh 使用体验优化：开源先例与落地方案

> 日期：2026-11-04 · 基线：`main` @ `9893e01`（代码行号基于与之代码树一致的 `d0d5e8a`；写作期间另有并行未提交改动，见 §10）
> 问题依据：[实际使用体验分析与优化建议](usage-optimization-2026-11-04.md)（5 个 P0 断点 + P1/P2 清单）。
> 方法：把每个断点映射到成熟开源项目**真正解决问题的那条机制**（而非功能清单），给出 WorkMesh 落地点、边界、可测验收与成本。
> 口径：外部机制均带官方链接，标【事实】的本次已核对原文；WorkMesh 落点引用当前工作树 file:line，标【推测】的是成本/频率估计。

---

## 0. 结论

**五个断点在成熟开源项目里都有"教科书答案"，共同点不是加功能，而是把混在一起的三件事拆开：发现、授权、证据。**

| 断点                      | 直接先例（机制）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 采纳的核心机制                                                                        | 成本 | 优先级 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---- | ------ |
| P0-1 开工入口断链         | [gh status](https://cli.github.com/manual/gh_status)、[taskwarrior next](https://taskwarrior.org/docs/report/)、[conda init](https://docs.conda.io/projects/conda/en/latest/commands/init.html)/[projen](https://projen.io/docs/introduction/the-projen-workflow/) 托管块、[BMAD project-context](https://docs.bmad-method.org/existing-codebases/set-and-maintain-project-context/)                                                                                                                                                                                                                                                                                                             | "发现返回下一步、ID 是输出不是输入" + 托管块写 Agent 入口 + 本地检查点                | S/M  | P0     |
| P0-2 收工/返修闭环        | [gh pr create 打印 URL](https://cli.github.com/manual/gh_pr_create)、[gh pr view --comments](https://cli.github.com/manual/gh_pr_view)、[gh pr checks](https://cli.github.com/manual/gh_pr_checks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 交付动作返回评审句柄；评审/返修只读可查、可 watch                                     | S    | P0     |
| P0-3 审批吞吐             | [GitHub sudo mode](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode)、[GitHub submit review](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)、[git revert](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/reverting-a-pull-request)、[GitHub notifications](https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications)、[SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html)、[ETag/304](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-the-rest-api#use-conditional-requests) | 认证与授权分离（step-up 窗口）+ 一次判断覆盖 N 项但逐项绑定 + 追加式撤销 + 派生收件箱 | S/M  | P0     |
| P0-4 新项目接入           | [BMAD project-context](https://docs.bmad-method.org/existing-codebases/set-and-maintain-project-context/)（**官方已弃用全仓库文档生成**）、[repomix](https://www.npmjs.com/package/repomix)、[git add -p](https://git-scm.com/docs/git-add)/[terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)、[arc42](https://arc42.org/overview/)/[ADR](https://adr.github.io/)                                                                                                                                                                                                                                                                                                    | 只读 scan（带 commit/sha256）→ 少量高价值草稿 → dry-run + 逐条候选 → 增量 rescan      | M    | P0     |
| P0-5 "就绪"不可信 + 备份  | [K8s probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)、[Spring Actuator](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)、[restic check](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)、[pgBackRest verify](https://pgbackrest.org/command.html#command-verify)、[gitattributes](https://git-scm.com/docs/gitattributes)                                                                                                                                                                                                                                                              | liveness/readiness 分层 + 自描述可校验备份 + 单一配置来源/跨平台入口                  | S/M  | P0     |
| P1 Windows 上手/验证/文档 | [pnpm 自管版本](https://pnpm.io/10.x/settings#managepackagemanagerversions)、[Taskfile](https://taskfile.dev/)、[release-please](https://github.com/googleapis/release-please)、[lychee](https://lychee.cli.rs/)、[markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2)                                                                                                                                                                                                                                                                                                                                                                                                           | 版本文件钉死 + 单任务入口 + 文档/命令进 CI                                            | S/M  | P1     |

> 写作期间工作区已出现并行的 readiness 实现（`/api/health/ready`、`box doctor` 复用，未提交），方向与本文 §6.1 一致，本文按"完整设计 + 验收"给方案，不把未提交改动当已完成。

---

## 1. 从开源项目提炼的 8 条设计原则

这些原则贯穿下文每个方案，比具体工具更重要：

1. **发现与 ID 解耦**：命令回答"下一步做什么"，ID 是输出而不是输入。`gh status` 聚合 Assigned/Review requested/Mentions；`taskwarrior next` 先算"可做"再排序；`gh issue list --assignee @me` 让身份成为过滤条件而不是先验知识。
2. **认证与授权分离**：证明"是本人"（会话级、可复用）与证明"这次动作被授权"（动作级、一次性）分开。GitHub sudo mode 是工业级范例；票据语义不因此放宽。
3. **一次判断覆盖 N 项，但每项独立绑定**：GitHub 一次 review submission 可携带多条待发评论 + 一个结论事件；批量决定的强度来自"每个对象的版本/摘要仍单独绑定"，而不是"少校验"。
4. **撤销 = 追加反向事实**：`git revert` 不回滚历史、GitHub revert 生成反向 PR；WorkMesh 已有 `ReviewDecisionRevocation`，缺的是入口。
5. **先预览、再执行；显式目标；逐条结果**：`terraform plan`、`kubectl diff`、`git add -p`、`rsync --dry-run` 都把"将发生什么"变成可读对象；WorkMesh 自己的 batch-decisions"逐条独立校验、无整批回滚"已是正确形状，应沿用到所有批处理。
6. **托管块与幂等安装**：只改标记区间、保留用户字节、重复安装不覆盖（`conda init` 的 `# >>> conda initialize >>>`、`projen` 的生成文件、BMAD 的 `<!-- bmad:context -->` 块）。BMAD 的另一个结论同样重要：**仓库概览/目录树/技术栈清单不该写进上下文**，Agent 读代码比读散文准。
7. **自描述、可校验、可回放**：产物带来源 commit/sha256（repomix manifest）、快照可 `check`（restic）、流可断点回放（SSE `Last-Event-ID`）、轮询可廉价探测（ETag/304）。
8. **自己的交付也要可验证**：产品卖"可验证证据"，自身发布/治理也应可验证——dogfooding + 发布产物 attestation + 公开健康指标（见 §7）。

---

## 2. P0-1 开工入口：发现 → 入口 → 检查点

### 2.1 任务发现：`workmesh status` / `tasks --ready` / `claim --next`

**借鉴**：`gh status` 是"个人工作台"：把 Assigned Issues、Assigned PRs、Review Requests、Mentions 聚合为一屏，并支持 `--org`/`--exclude` 过滤【事实，手册】；`taskwarrior next`/`ready` 先算"可行动"再按紧急度排序【事实，Reports 文档】；`gh issue list --assignee @me --json` 让同一命令既给人看也给脚本用。

**落地**

- `workmesh tasks --ready [--limit] [--cursor] [--json]` → 已存在的 `GET /api/v1/projects/:pid/tasks/ready`（`v1-ready.controller.ts:28-39`）。**前置小改**：ready 响应补 `requirement:{code,title}`（`v1-ready.prisma-repository.ts:80-95` 现在只有 `id/stepKey/roleId/version/...`，没有需求编号，CLI 只能印 UUID）。
- `workmesh claim --next`：取 ready 首页第一条（服务端已按 `stepKey,id` 稳定排序），复用现有 claim 路径，不新增接口。
- `workmesh status [--json]`：三段——「可开工」= ready 前 3 条；「待我评审」=`GET /projects/:pid/review-requests?assignedToMe=true&status=OPEN`（`v1-review.controller.ts:350-363`）；「待确认变更」=`GET /change-recipients`（`apps/cli/src/index.ts:1389-1396`）。空时明确打印"无事可做"。
- `workmesh open <task|review|requirement>`：打印/打开 Web 深链（`gh --web` 惯例），解决"CLI 干到一半要回 Web"。
- **人类句柄解析**（更根本的一步）：CLI 现在只收 UUID；成熟 CLI 都接受多种句柄（`gh pr view 123|URL|branch`、`git rev-parse --short`、`docker` 接受名称或 ID 前缀）。建议 `--task` 接受 `KEY-001/stepKey` 或 8 位 UUID 前缀，由服务端解析为唯一任务；这是把"回 Web 抄 UUID"从根上消除的一步（M）。

**边界**：`gh status` 靠 GraphQL 跨仓库聚合，WorkMesh 一个凭据绑定一个 project（`config.ts:13-22`），`status` 只能是单项目视图；ready 判定必须由服务端算（`v1-ready.service.ts:87-120`），CLI 不得重算出第二套口径。

**验收**：`tasks --ready --json` 可被脚本按 `items[].id` 遍历；`claim --next` 一步认领；`status` 三类信号为空时打印"无事可做"；`--task KEY-001/impl` 与 UUID 等价可用。

### 2.2 Agent 入口：AGENTS.md 托管块（先修 bug，再谈卖点）

**借鉴**：`conda init` 在 shell 配置写 `# >>> conda initialize >>> … # <<< conda initialize <<<` 标记块，重复执行幂等、可撤销【事实】；`projen` 用 synth 生成"带标记、非手写"的文件【事实】；BMAD `bmad-project-context` 把内容写进 `AGENTS.md` 的 `<!-- bmad:context -->` / `<!-- /bmad:context -->` 之间，**写前给完整块、批准后写入、块外字节不动、从不提交**，且明确"仓库概览/目录树/技术栈清单不进块"【事实，官方文档】；spec-kit `specify init` 按宿主生成集成文件【事实】。

**落地**

1. **先修真实 bug**：`apps/cli/src/setup.ts:119-127` 用相对前缀过滤 `files`，而 `apps/cli/src/roles.ts:373` 返回绝对路径 → `agentEntries` 恒为空；单测因为 mock 了相对路径（`setup.test.ts:46,130`）一直绿。修法：在 `roles.ts:344-348` 已有的相对路径结果上生成 entries（同时保留 `files` 的绝对路径）。
2. 新增 `packages/role-packages/hosts/{codex,claude-code}` adapter：Codex 写项目根 `AGENTS.md`，Claude Code 写 `CLAUDE.md`（或在 `CLAUDE.md` 里放一行 `@AGENTS.md` import，同 BMAD 做法）；块标记 `<!-- workmesh:begin v1 -->` / `<!-- workmesh:end -->`，块外逐字节保留；块缺失→追加，重复块/标记损坏/块内摘要与 `lock.json` 不符 → 拒绝覆盖（`LOCAL_MANAGED_FILE_MODIFIED`）。
3. **块内容要小**（照 BMAD 的"什么才配进上下文"）：角色一句话 + `claim → context --materialize → deliver → review show` 四步 + `review inbox` + guide.md 路径 + 退出码表 + 禁用条款（不得代替 HUMAN 批准）。**不放**目录树、技术栈、全量 SOP——那些由角色包资源与 `context` 物化提供。
4. `setup --host codex --dry-run` 先展示将写入的块与文件路径；`setup` 成功打印真实写入的入口文件（`index.ts:536-540` 的分支已存在，缺数据）。

**边界**：不写用户全局 shell rc（mise 式让用户自己 eval 一行即可）；不做 spec-kit/OpenSpec 那种 30+ 宿主私有目录矩阵（维护成本与阶段不匹配）；不改 `.cursor/rules` 等易变目录。

**验收**：空仓库 `setup --host codex` 后 `AGENTS.md` 存在且含四步命令；块外加一段文字后重装，文字逐字节保留、块被更新；手改块内命令后重装被拒且不覆盖；`--dry-run` 零写入。

### 2.3 检查点：`.workmesh/local/state.json` + 可选 git trailer

**借鉴**：Gerrit 用 commit footer 的 `Change-Id: I…` 把"同一评审的新 patchset"关联起来（缺 Change-Id 直接拒绝推送）【事实】；`git interpret-trailers` 提供确定性读写 trailer 的原语【事实】；`terraform plan -out` 把计划存成文件、`apply <plan>` 执行该确切计划【事实】；`gh pr create` 失败还提供 `--recover` 恢复上次输入【事实，手册】。

**落地**

- `.workmesh/local/state.json`（复用 `config.ts:85-99` 的私有目录约定与原子写）：`{schemaVersion, projectId, roleKey, taskId, requirementCode, claimId, snapshotId, taskVersion, reviewRequestId, operationId, updatedAt}`；只存 ID/版本，不存 bearer、正文、评审意见。
- `claim/context/deliver/review show` 成功后写入；失败/冲突不写；`--task/--claim/--snapshot/--expected-version` 允许缺省并从 state 读；缺省且无 state → 明确报错并提示 `workmesh status`。
- `context` 人类输出补 `taskVersion`（`index.ts:697-707` 现在不打印），并直接打印下一步命令（`claim` 已有此风格，`index.ts:584-590`）。
- 可选 `--trailer`（默认关）：deliver 成功后用 `git interpret-trailers --in-place` 给 HEAD commit 加 `Workmesh-Task: …` / `Workmesh-Review: …`，便于 `git log --grep` 追溯。

**边界**：不做 Gerrit 式"缺 Change-Id 拒收"门禁——WorkMesh 的 claim/generation/version 已提供更强的一致性，trailer 只作追溯；state.json 不跨用户共享、不随仓库提交。

**验收**：`claim` 后新开终端直接 `context --materialize`（不带 claim/version）成功；`deliver` 后 `review show` 不带参可读到同一评审；state.json 无明文密钥且不出现在 `git status`。

### 2.4 Web → CLI 的桥：复制命令必须可执行

**落地**：`Workbench.tsx:194-204` 改为复制 `workmesh claim --task <taskId>`（行上直接显示可复制的任务 ID）；`RequirementDetail.tsx:665-674` 改为复制 `workmesh context --task <taskId>` 或 `workmesh claim --task <taskId>`；删除 `Workbench.tsx:844-846` 里 `workmesh context <code>` 的错误帮助文案。

**验收**：新用户从 Web 复制命令到业务项目终端，第一条即成功（不再出现 `INVALID_REQUEST`）。

---

## 3. P0-2 收工/返修：交付即返回评审，评审只读可查

**借鉴**：`gh pr create` 手册明确成功即打印 PR URL（部分附件失败仍建 PR、以非零码提示）【事实】；`arc diff` 提交后打印 `Revision URI`，`arc list` 可列待审【事实，Phabricator 已归档但设计经典】；`gh pr view --comments`、`glab mr view --comments/--unresolved`、`gerrit query --comments` 都提供"只读、可过滤、机器可读"的讨论/决定数据面；`gh pr checks` 用退出码表达状态（pending=8）【事实】。

**落地**

1. `deliver` 输出补三处（`index.ts:1192-1203` 的 resultRefs 现在只留 taskId/artifactSetId/taskVersion）：`resultRefs` 加 `reviewRequestId`；JSON 顶层加 `reviewRequestId` + `webUrl`；人类输出 4 行：`已交付 ArtifactSet <id>` / `评审：<reviewRequestId>` / `Web：<origin>/projects/<pid>/reviews/<id>` / `下一步：workmesh review show --id <id>`。深链复用 `index.ts:1269` 的拼法，origin 取自 workspace。
2. 删除误导提示"再跑 `workmesh review`"（`index.ts:1228`）；`review` 命令保留，文档改为"仅当对已有候选主体单独建评审时使用"（对齐 API 文档中 `POST /review-requests` 的定位）。
3. 新增只读命令：
   - `review show --id <reviewId> [--comments] [--json]`：状态、槽位、决定历史；把 `CHANGES_REQUESTED|REJECT` 的非空 comment 置顶（服务端强制这两类决定必须有 comment，`v1-review.service.ts:516-521`——读不到意见是渲染缺失，不是数据缺失）；
   - `review inbox [--all] [--limit] [--cursor]`：`GET /review-requests?assignedToMe=true&status=OPEN`（快照已带 `requirement{code,title}` 与 `subjectLabel`）；
   - `task show [--task] [--json]`：`GET /tasks/:id`，并与 state.json 对齐提示"本地 v3 / 服务端 v4，请重新 context"；
   - `review watch --id <id> [--timeout]`：阻塞等待人工决定（`gh pr checks --watch` / `kubectl wait` 模式），决定后打印结果与下一步——把"Agent 等人"变成显式、可编排的动作。
4. `changes` 补人话：服务端收件人快照补 `requirement code/title` 与 `changedFields`（`v1-change.repository.ts:5-14` 现在没有 summary，CLI 只能印两个 UUID）。

**边界**：CLI 只读，**不提供 decide/approve/revoke**（违背"人在 Web 签字"与票据语义）；`--comments` 不隐藏已撤销决定，而是按追加式完整展示并标注 revoke；自部署 Web 深链可能内网不可达，**不能**当规范 URL 写进证据链，只作"人该去哪"的提示；旧服务端缺 `reviewRequestId` 时从 resultRefs 兜底，不编造链接。

**验收**：`deliver --json` 含 `reviewRequestId`/`webUrl`；QA 选 `CHANGES_REQUESTED` 后，Agent 只用 `review inbox` → `review show --id` 读到 comment（含决定人/时间）并重新交付；`review watch` 在人工决定后返回并打印结果。

---

## 4. P0-3 审批工位：把"认证 / 判断 / 记录"拆开

### 4.1 认证与授权分离：step-up 窗口（GitHub sudo mode）

**借鉴**：GitHub 对敏感动作要求重新认证，认证后进入 sudo mode；文档写明 **two-hour 会话超时、期间再做敏感动作会重置计时**，认证方式可为密码/passkey/security key/TOTP【事实，官方文档】。机制价值：把"证明是本人"（会话级）与"证明这次动作被授权"（动作级一次性票据）拆开，降摩擦但不降证据强度。

**落地**（**不照搬 2 小时**，取 5–10 分钟）：

- `WebSession` 增 `stepUpVerifiedAt/stepUpExpiresAt`（一条迁移；模型在 `schema.prisma:389`）。
- `reauthenticate`（`v1-account.service.ts:284-293`）成功后写窗口；`issueTicket`（`v1-action.service.ts:67-125`）接受 `password` **或** 有效窗口；窗口在登出、改密、会话撤销、401 时失效。
- `AuditEvent.details.reauthMethod = PASSWORD | WINDOW`，审计能回答"这票是复用窗口签的"。
- 每窗口最多签 20 张票（防批量刷），窗口内仍受现有 5 次/15 分钟密码尝试限流（那只统计真实密码校验）。
- 保留 `CONFIRMATION_TTL_MS`（5 分钟单次票）不变；票据仍绑定动作/目标/版本/摘要。

**边界**：窗口只减少输密码次数，不免票据、不延长票据 TTL、不放宽项目授权；不做"记住设备"式的长期免密（高后果动作不接受）。

**验收**：连批 10 条密码输入 ≤1 次、10 张票 `actionDigest` 各不相同；跨项目复用窗口仍被 403；窗口过期后首次动作重新要密码；审计可见 `reauthMethod`。

### 4.2 一次签名覆盖 N 条：批量票据（GitHub submit review）

**借鉴**：GitHub 评审流程把行内评论先放 pending，点 "Submit review" 时一次性提交并附一个结论（Comment/Approve/Request changes）【事实】；GitLab 批量编辑是"勾选 → 侧栏统一字段 → Update selected"【事实】；Linear 多选后底部出现批量操作条【事实】；Gerrit Reply 一次可发布多条 inline 评论 + label 投票【事实】。WorkMesh 已有 `POST /review-requests/batch-decisions`：逐条独立校验、返回每条结果、**明确无整批回滚**（`v1-review.controller.ts:272-341`）——形状正确，缺"一次密码签 N 张票"与 Web 入口。

**落地**

- 新表 `ConfirmationBatch(id, userId, webSessionId, itemCount, rootDigest, expiresAt)` + `ConfirmationTicket.batchId`（`schema.prisma:853` 的票据表加一列）。`rootDigest` = 按 `reviewId` 稳定排序后的 `(reviewId, expectedVersion, actionDigest)` 列表的 Merkle/哈希根。
- 新端点 `POST /api/v1/action-tickets/batch`：一次密码或 step-up 窗口签发 N 张单次票（N≤20，见 `apps/api/src/reviews/v1-review.controller.ts:81-82` 的 `@ArrayMaxSize(20)`），每张票仍独立绑定单条目标；batch 只做"集合完整性"校验。
- 客户端：工作台复选（`Workbench.tsx:123,629-637` 已有模型）→ 底部固定操作条（Linear 模式）→ 确认框展示 N 条与摘要根 → 调 batch endpoint → 把 `{batchId, items:[{reviewId, slotId, expectedVersion, confirmation}]}` 交给现有 batch-decisions。
- 服务端在 batch-decisions 前校验 batch 成员、根、过期与逐条授权/版本。

**边界**：只允许同项目、同 kind；`criticality: HIGH` 或 `checks.failed>0`、跨项目、含未通过证据者禁入（规则见 `docs/design/approval-workstation.md` 的批处理/委托/超时章节）；不做整批回滚，逐条失败可见；不提供"一键全批"（审批价值在"看一眼"）。

**验收**：10 条一次勾选、一次密码全成功；混入 1 条已变更 → 9 成功 1 失败且原因可见；重放整批返回"票据已消费"而非全绿。

### 4.3 签票即执行 + 追加式撤销 + 委托/超期入口

**借鉴**：GitHub submit review 把"准备"与"签署"合成一次原子提交；GitHub revert 生成反向 PR、不回滚历史【事实】；GitLab 把 approve/revoke/所需批准集中在 MR 的 approval widget 就地展示【事实】。

**落地**

- `ConfirmationPrompt`（`ConfirmationPrompt.tsx:82-127`）把"验证密码并签票 / 再点提交"两段合成一个主按钮"验证并提交"，签票成功直接 `onConfirmed`；预览、动作摘要、期望版本仍先展示（安全前提）。
- `formatApiError`（`client.ts:160-167`）透出 `details.retryAfterSeconds`（429 时显示"请 15 分钟后再试"）；动作码走 `lib/labels.ts` 的 `ACTION_LABELS`，目标显示需求编号而非 UUID。
- 撤销：把 `Reviews.tsx:381-388` 的死代码入口迁到 `ReviewDecision` 决定历史行（`ReviewDecision.tsx:640-677`），复用 `reviewApi.revoke` → `ReviewDecisionRevocation`（`schema.prisma:807`，服务端逻辑 `v1-review.service.ts:754-790` 已存在）；文案写"撤销批准（追加记录）"，不提供删除。
- 委托/超期：评审右栏加"审批健康"卡 + 工作台逾期视图，复用 `GET /projects/:id/delegations`、`/approvals/overdue`、`POST /approvals/escalate`（`delegations.controller.ts:27,50,55`）；委托/撤销也走票据；升级只标记不自动批准。

**边界**：不引入 GitHub 式行内评论线程（证据卡先够用）；不引入 Gerrit 可反复改写的投票；撤销后重新批准是另一条决定，不是"恢复"。

**验收**：一次批准 ≤3 次点击、≤2 次网络往返、密码 ≤1；摘要变化仍返回 `ACTION_CHANGED`；Web 能撤销并留审计；OWNER 能建委托、被委托人在工作台看到"可代决"。

### 4.4 待办新鲜度：TanStack Query + 派生收件箱 + SSE/ETag

**借鉴**：TanStack Query 的 `staleTime`/`refetchInterval`/`refetchOnWindowFocus` 与 SWR `revalidateOnFocus` 是"页面自己保鲜"的标准解法；GitHub 通知收件箱按 `reason` 打标（review_requested、mention、assign…）、支持 unread/read 与多选 triage【事实】；WHATWG SSE 用 `id:` + 自动重连时带 `Last-Event-ID` 回放，注释心跳防代理断流【事实】；GitHub REST 条件请求 ETag/`If-None-Match` → 304，304 不计主限流【事实，官方文档】；Gerrit 变更页默认 30s 轮询可作节奏参照。

**落地**

1. `main.tsx` 包 `QueryClientProvider`（依赖已在 `apps/web/package.json:15` 声明但全仓 0 引用——直接接线即可）：键 `['workbench', projectId]`、`['review', id]`、`['notifications', filters]`、`['metrics', projectId, days]`；workbench `staleTime 30s` + `refetchInterval 60s`；评审详情 `staleTime 10s`；`refetchOnWindowFocus: true`；决定/确认/撤销成功后 `invalidateQueries` + 乐观移除。
2. **派生收件箱，不先建大表**：`GET /api/v1/notifications?projectId=&reason=` 从现有数据派生 `{reason, subjectType, subjectId, title, deepLink, createdAt}`；reason 先取 `REVIEW_REQUESTED | CHANGES_REQUESTED | CHANGE_ACK_REQUIRED | APPROVAL_OVERDUE | DECISION_MADE`；已读用新小表 `NotificationRead(userId, reason, subjectType, subjectId, readAt)`（唯一键四元组），支持"全部标为已读"。铃铛未读数 = 派生条目中 readAt 为空者，替换 `App.tsx:57-116,331-405` 的计数面板。
3. SSE：`GET /api/v1/events`（`text/event-stream`，Nest `@Sse`），事件只推 `{type, subjectId}`，**event id 用 `(createdAt,id)` 复合游标**（注意 `AuditEvent.id` 是随机 UUID，不能按 id 当时间序），支持 `Last-Event-ID` 从审计表回放；前端收到后只 `invalidateQueries`；`onerror` 降级 60s 轮询；多实例时用 Redis 扇出或退回轮询。
4. ETag：客户端 `etagCache: Map<url, etag>`，GET 自动带 `If-None-Match`，304 返回缓存；服务端先 `curl -I` 实测 Express 默认弱 ETag 是否已生效（【推测】），否则对 `/v1/workbench`、`/v1/activity` 显式设置。
5. 邮件摘要：保持手动按钮，但可由外部 cron/`box` 任务定时调同一接口（GitHub scheduled reminders 思路），Web 不再新增按钮。

**边界**：不做 mention/CI 这类没有数据源的 reason；SSE 必须有轮询兜底、事件不带敏感正文；不缓存跨用户响应；写请求不做条件请求。

**验收**：Agent 交付后 ≤60s 工作台出现（无聚焦也生效）；两窗口 A 批准后 B 3s 内计数变化；断网恢复后不丢事件；空闲轮询全部 304；"全部已读"后徽标归零且多端一致。

### 4.5 首屏资产、列表规模、IA 与度量

**借鉴**：`@fontsource/inter` 自托管字体（OFL-1.1）【事实】；`jdenticon`/`boring-avatars` 用稳定种子本地生成 SVG 头像【事实】；GitHub Command Palette `Ctrl/Cmd+K` + `?` 快捷键表 + `g` 前缀导航【事实】；GitHub REST 建议用 `Link` 头/稳定游标而非手拼分页【事实】；Apache DevLake、Four Keys、CHAOSS 提供 DORA 指标口径与看板形态【事实】。

**落地**

- 删 `index.css:7` 的 `fonts.googleapis.com`，改 `@fontsource/inter` + `@fontsource/jetbrains-mono`（只 400/500/600/700）；`RequirementPipeline.tsx:63` 的第三方文生图外链整体删除，改本地 `UserAvatar/RoleAvatar/AgentAvatar`（种子只用内部 ID/角色键，不用邮箱姓名）。
- 列表：`requirementApi.list`/`documentApi.list` 已支持 cursor（`resources.ts:471-475,639-645`），页面接 `useInfiniteQuery` + "加载更多/共 N 条" + 骨架/空/错误三态；工作台 `v1-workbench.service.ts:152-159` 的固定 limit 与"用已加载长度当计数"（`:127-133`）要补真实计数或 `truncated` 标记。
- IA：`nav.ts:33-103` 同时生成侧栏与命令面板项；Cmd+K 支持页面跳转、项目切换、按需求编号/评审 ID 直达、对当前选择执行批量动作；`?` 打开快捷键表；`lib/labels.ts` 作唯一词典，删 `Board.tsx:17-22` 本地副本，禁止页面直接渲染枚举（`ReviewDecision` 弹窗的 `REVIEW_REQUEST · UUID` 改成人话）。
- 度量：复用已实现的 `GET /projects/:id/metrics/flow`（`v1-flow-metrics.controller.ts:20-36`）做"流程度量"卡：时长 p50/p90 + samples、WIP、ackRate/avgAckHours；`samples=0` 显示"—"；窗口 7/30/90 天；标注"近似口径"（`docs/metrics.md` 已声明近似口径与限制）。

**边界**：不引 DevLake/Grafana 依赖，只借指标口径；中文正文仍用系统字体；不做全站全文索引；不把管理页塞进命令面板第一位。

**验收**：首屏第三方请求 0、断网无破图；60 条需求能翻到第 60 条且无重复；只用键盘完成"切到评审→选中→批量批准"；卡上数字与 `curl` 一致、空样本显示"—"。

---

## 5. P0-4 新项目接入：只读 scan → 少量草稿 → 可预览提交 → 增量

**关键反证**：BMAD 官方已把"生成仓库文档"的旧 skill（`bmad-document-project`）标记为弃用，理由是"证据不支持这么做"；替代者只在 `AGENTS.md` 写"扫描得不到的规则"，并强调**仓库概览、目录树、技术栈清单不该进上下文**——Agent 读代码比读散文准，抄下来只会过期【事实，官方文档】。这条结论应直接约束 WorkMesh 的 onboarding，避免把产品做成"AI 生成的过期文档库"。

**借鉴**：repomix 的 git-aware 扫描（尊重 `.gitignore/.ignore/.repomixignore`、默认排除 node_modules、`--remote-branch <commit>` 锁版本、secretlint 防密钥）【事实】；gitingest 的 summary/tree/content 三段 digest【事实】；dependency-cruiser/madge 出模块图、code-maat 用 `git log --numstat` 算 churn/coupling 并按 `--min-revs` 过滤噪声【事实】；arc42/C4/ADR 提供"该写什么"的模板与决策日志【事实】；`git add -p` 的分阶段、`terraform plan`/`kubectl diff` 的"先预览再执行"【事实】；WorkMesh 自己 batch-decisions 的逐条结果契约（无整批回滚）。

**落地（四步 + 一条演示链）**

1. **scan（M）**：`workmesh onboard scan --repo <path> [--since <commit>] [--json]`，只读、禁写源码：采集 `git rev-parse HEAD`、dirty 标记、`git ls-files` + ignore 合成、lockfile/package.json/tsconfig/Dockerfile/CI、启动/构建/测试命令、schema/migrations、API 路由与模块入口、已有 docs/ADR。产物 `.workmesh/onboard/<scanId>/`：`manifest.json`（commit、branch、dirty、files[{path,sha256,byteLength}]、toolVersions、tokenEstimate）、`tree.txt`、`metrics.md`（文件数/语言/churn Top-N）。scanId=`<UTC>-<commit8>`。
2. **draft（S/M）**：首批 **7 篇**（与 YFF 文档一致）：SYSTEM/overview、SYSTEM/startup、SYSTEM/module-map、SYSTEM/env-and-deps、SYSTEM/test-build、BUSINESS/rules-and-terms、PRACTICE/deploy-rollback。每篇 front-matter：`docKey/title/kbKind/sourcePaths/sourceCommit/generatedAt/confidence/evidenceRefs/unknowns`；`unknowns[]` 未清零时 submit 默认拒绝（`--allow-unknown` 才提交）。**复用现有字段**：`DocumentRevision.sourceRef/confidence/evidenceRefs` 已在 schema（`schema.prisma:320-326`，注释就写着"老项目重建时区分机器结论与推断"），但 API DTO 未暴露（`v1-publication.controller.ts:51-72`）——先补 DTO（S），未上线前用正文 front-matter 兜底。
3. **submit（M）**：`--dry-run` 打印表格 `docKey | 新建/新修订 | 库 | bytes | sha256 前 8 位 | confidence | 去重判定`；`--yes` 执行时逐篇走现有候选/修订接口（`candidate.ts:209-226`），每篇一个确定性幂等键（UUIDv5 = docKey+正文 sha256），单篇失败继续并汇总，写 `submit-report.json`（含 reviewRequestId）；**任何情况下不自动批准/发布**。
4. **rescan（M）**：读 `.workmesh/onboard/state.json`（lastScanId/commit/docKey→documentId/revisionId/sourceSha256），`git diff --name-status commit..HEAD` 得 added/changed/removed；changed→同 docKey 新修订、added→新草稿、removed→标 `source-missing` 但**不生成删除候选**；三层去重：docKey 稳定 slug、提交前按 kind/q 查已有文档、正文 sha256 命中已有 revision 则跳过。
5. **UUID 发现（S，前置）**：`workmesh projects list` / `workmesh kb list`（服务端已有 `GET /projects`、`GET /projects/:id/knowledge-bases`），`setup` 同步打印 projectId/defaultKnowledgeBaseId/repositoryId。
6. **演示数据自包含（M）**：`scripts/seed-demo.mjs` 替代依赖 gitignored `.tmp/yff-req` 的 `seed-yff.mjs`；fixtures 随仓库提交，`faker.seed(固定)` + `setDefaultRefDate`，自然键用确定性 UUIDv5 保证 upsert 幂等；直连库路径保留但必须 `--allow-db-reset` + 打印实例指纹。

**边界**：不做全仓库文档生成（BMAD 的反证）；不把 repomix 整包塞进知识库（那是 LLM 临时上下文，含密钥与体积风险）；不造第二套 spec 流程（只借"变更目录 + 归档 + 存量项目先做小切口"）；不自动删除"扫不到"的文档；服务端不做整批导入/回滚。

**验收**：5k 文件仓库 scan <60s、除 `.workmesh/onboard/` 外零写入、`manifest.commit == git rev-parse HEAD`、环境变量只记名不记值；7 篇每篇 ≥1 个 sourcePaths+sourceCommit+confidence；submit dry-run 后文档数/评审数/工作树不变；重放同一 scan 不产生重复文档；干净 clone 一条命令看到 25 条需求 + ≥7 篇知识（TTFV ≤30 分钟）。

---

## 6. P0-5 就绪、备份与跨平台：让信号可信、让操作可回退

### 6.1 就绪分层：`/api/health`（liveness）与 `/api/health/ready`（readiness）

**借鉴**：Kubernetes 把 liveness（失败→重启）、readiness（失败→摘流量）、startup（慢启动宽限）分开，`/livez`、`/readyz`、`/healthz` 是惯例【事实】；Spring Boot Actuator 返回 `status` + `components[]{status,details}` 并可分组暴露 liveness/readiness【事实】；`pg_isready` 用退出码区分在启动/无响应/未尝试【事实】；Playwright `webServer.url` 以 HTTP 状态判定就绪，本仓已用它等 `/api/health`（`playwright.config.ts:18-36`）；Prisma `migrate status`、Flyway `info`/`validate` 提供迁移状态与漂移校验【事实】。

**落地**（与工作树中并行实现方向一致，补齐三点）：

- `/api/health` 保持"进程活、不碰 DB"（现有 `app.controller.ts:7-10`）；`/api/health/ready` 返回结构化 `{status, checks:[{name,status,detail?,remediation?}]}`，检查项：`env`（`WORKMESH_V1_DATABASE_URL` 存在且 schema 正确）、`db.connect`（`SELECT 1`，2s 超时）、`db.migrations`（`_prisma_migrations` 完成数 vs `apps/api/prisma/migrations` 目录数——现有并行实现只查 `applied>0`，需补"数量对齐"）、`rolePackages`（复用内置角色包 seeder 的摘要比对逻辑）。每项 DOWN 附下一条命令。
- 启动 fail-fast：zod/env schema（参照 `@t3-oss/env-core`、`envalid` 思路）校验必需变量；PrismaService 删掉免密回退 URL 并无条件 `$connect()`（`prisma.service.ts:14-24`），失败输出 `[ENV_INVALID]`/`[DB_UNREACHABLE]` 并退出。
- 单一检查内核：`packages/diagnostics` 导出 `runChecks()` 与 JSON 契约，`/api/health/ready`、`box doctor`、`dev-local.ps1 -Check`、Playwright `webServer.url` 全部消费同一结构；`box doctor` 文档从"无副作用"改为"只创建数据目录"（`docs/box.md` 的 doctor 行与 `status.ts:53` 的 mkdir 不符）。
- 健康端点放行限流中间件（`main.ts:27-47`），避免监控被 429。

**边界**：不引入 K8s/Actuator 依赖，只借语义；liveness 绝不查 DB（避免数据库抖动连环重启）；readiness 明细不回显主机/端口/库名（未认证端点），只给枚举 reason + remediation。

**验收**：停 PG → health 200、ready 503 且 `db.connect` DOWN；缺 env → 进程退出且 stderr 含字段名；空库 → ready DOWN 并列出待应用迁移；`-Check`/`doctor`/ready 对同一故障输出相同 check name 与修复命令。

### 6.2 备份/恢复：自描述 + 可校验 + 显式目标

**借鉴**：restic 用 `snapshots` 展示快照元数据、`check`/`check --read-data` 校验、`forget --prune` 按策略清理【事实】；pgBackRest 每个 backup 带逐文件校验和的 manifest、`verify` 按 manifest 重算【事实】；`pg_dump -Fc` 归档自带 TOC，`pg_restore -l` 可在恢复前先列出内容【事实】；**`pg_verifybackup` 只校验 `pg_basebackup` 的 base backup，不适用于 pg_dump 逻辑备份**【事实，官方文档】；`terraform apply` 先出 plan 再要求确认；`gh repo delete` 要求显式输入仓库名才能执行【事实，手册】；`kubectl --context`/`git --git-dir` 要求显式目标。

**落地**

- manifest 升 1.1：`createdAtUtc`（与本地目录名统一）、`instance{host,port,database,schema,migrationsApplied,serverVersion,source}`（source = `env|apps/api/.env|--database-url`，`packages/box/src/lib/config.ts:37-55` 现在可能静默回退到 `apps/api/.env`）、`dump{format:'custom',bytes,sha256,tocEntries}`、`tables` + 关键表行数、`boxVersion`、`manifestSha256`。
- `box backup` 先打印实例指纹（`host:port/db · 迁移 10/12 · 来源 apps/api/.env`）并要求确认（`restore` 已要求 `--yes`，`backup` 没有）；`--dry-run`/`--json`。
- `box restore --from` 先打印 manifest 与当前实例的 diff（host/port/db/迁移数），`--yes --verify` 后比对表数与关键表行数，不一致即删新库并 exit 1；恢复用 `pg_restore --exit-on-error -1`。
- 新增 `box backups list|verify|prune`：`verify` 重算 dump SHA-256 + `pg_restore -l` TOC 条目数比对；`prune --keep N --dry-run` 先列将删项。dump 默认 `pg_dump -Fc`，保留 `--format=plain` 读旧备份。
- `parseEnvFile` 去 BOM、拒绝重复键、记录来源文件与行号，并加回归测试（对应验收事故 `docs/testing/team-acceptance-2026-11-03.md:93` 的 BOM→回退开发库）。

**边界**：不引入 restic/pgBackRest 服务端依赖（单机逻辑备份 + 自有 manifest 够用），不用 `pg_verifybackup`（产物模型不匹配），不改成"原地删库恢复"（恢复到新库是正确设计）。

**验收**：dump 改 1 字节 → `backups verify` exit 1；restore `--verify` 表数/行数不一致即 exit 1 且清理新库；BOM `.env` 不再回退；迁移 0/12 的库备份被拒绝或强警告。

### 6.3 跨平台开发入口：让"任何 checkout 能跑"

**借鉴**：Git 官方 `* text=auto eol=lf` 统一仓库内 LF【事实】；pnpm 10 `managePackageManagerVersions` **默认 true**，会按 `packageManager` 字段自动下载并运行对应版本，可直接绕开坏掉的 corepack【事实，pnpm 10 docs 原文】；`mise`/`volta`/`.node-version` 把 Node 版本钉在文件里；Taskfile/just 提供单二进制跨平台任务入口；`windows-latest` 是 GitHub 官方 runner；Testcontainers 依赖 Docker daemon（CI 方便、Windows 本地重）。

**落地**

1. `.gitattributes`：`* text=auto eol=lf`、`*.ps1 text eol=crlf`；跑一次 `prettier --write`；CONTRIBUTING 写 `git config core.autocrlf false`。直接消 P1-1 的 78 个 CRLF 失败。
2. 根 `package.json#packageManager` 已有 10.28.2；文档删除 `corepack pnpm` 写法（README:85-86、deployment:31-36、local-dev:69 三处矛盾），说明 pnpm 10 自管版本；`.node-version` 对齐 CI 的 20.19（`.github/workflows/ci.yml:37`）。
3. `Taskfile.yml`（或 justfile，二选一）作唯一入口：`setup`/`doctor`/`test:integration`/`backup`/`docs:check`/`ci:local`；现有 `scripts/*.ps1|*.sh` 退为被调实现。
4. `scripts/test-integration.sh` 去 corepack，逻辑搬进 `scripts/test-integration.mjs`（复用 `scripts/lib/check-test-database.mjs` 守卫），`package.json:28` 改指向它；Windows 不再需要 WSL。
5. `scripts/setup-local.mjs`（幂等）：检测/启动 embedded-postgres → 写 `apps/api/.env`（随机口令）→ `prisma migrate deploy` → `prisma db seed`；把 local-dev "从零重建"5 条收成 1 条，`dev-local.ps1:224-227` 的"start-pg.mjs 不在仓库"随之消失。
6. CI 加 `windows` job：install → `format:check` → `type-check` → `lint:eslint` → 单测 → `PSScriptAnalyzer`（Error 级）→ `box doctor --json`；**不**在 Windows 跑 DB 集成（无 service container，成本高）。
7. `pg_dump/psql` 不再依赖 gitignored `.tmp/pgclient`（1.19GB）：提供 `scripts/fetch-pgclient.ps1` 或文档化官方安装来源；Testcontainers 只作可选路径。

**边界**：不同时维护 just + Taskfile；不要求 Windows 装 WSL；不把 `turbo run dev` 当入口；不追求 Windows CI 全量 DB 集成。

**验收**：干净 Windows clone 后 `git status` 干净且 `pnpm format:check` 通过；`pnpm test:integration` 一条命令跑通（无 WSL/corepack）；`task doctor` 与 `pnpm dev:local:check` 等价；windows job 绿。

### 6.4 版本与文档门禁：让"不一致即红"

**借鉴**：release-please 从 conventional commit 生成 release PR（版本号 + CHANGELOG），合并后打 tag【事实】；changesets 是 pnpm 生态等价物【事实】；lychee 做链接检查、markdownlint-cli2 做 Markdown 结构 lint、vale 做词表/文风；mdBook `test`/rustdoc `--test` 把文档代码块当测试跑（doctest 思想）【事实】；shellcheck/PSScriptAnalyzer 做脚本静态检查。

**落地**

1. 版本单源：根 `package.json` 为唯一版本；`release-please-config.json` + `.release-please-manifest.json`；提交走现有 commitlint + husky；打包时把版本注入 `packages/box/src/version.ts:1` 的 `BOX_VERSION`（现硬编码 1.0.0）；`spec/VERSION`（0.2）改名 `spec/PROTOCOL_VERSION`。
2. `pnpm docs:check`：`markdownlint-cli2` + `lychee --offline --include-fragments README.md docs CONTRIBUTING.md`；vale 暂缓（需要人维护词表）。
3. 文档命令 smoke：`scripts/docs-smoke.mjs` 执行文档中标记 `<!-- smoke -->` 的**只读**命令（`workmesh --help`、`box status --json`、`prisma migrate status`），非零即失败——这是 doctest 思想，不引 mdBook。
4. 脚本 lint：`shellcheck scripts/*.sh`（ubuntu job）+ `Invoke-ScriptAnalyzer -Path scripts -Severity Error`（windows job）。
5. 角色包 4 份 guide 修正后（`.workmesh/local/context` → `.workmesh/context`；`review --expected-version` 口径），把 guide 内命令纳入 docs-smoke。

**验收**：release PR 合并后 tag/CHANGELOG/package.json/box 版本四处一致；`docs:check` 在坏内链上失败；文档命令 smoke 0 失败；脚本 lint 0 error。

---

## 7. 自证与治理：回应"证据自指"（R5）

产品卖"可验证证据"，自身也应可验证——这是开源社区成熟做法，不是新增产品功能：

- **Dogfooding**：GitLab 用 GitLab 开发自身（公开 handbook 有流程记录），Sentry 等也如此。WorkMesh 至少让"WorkMesh 自身的需求/交付/评审"走一遍自己的链路，自然产出 §8 指标所需的真实数据，直接消解 `positioning.md` R5 的"零外部用户/零真实闭环"。
- **发布产物可验证**：现有 ZIP + SHA-256 sidecar 之上，加 [SLSA](https://slsa.dev/) provenance 或 GitHub artifact attestations、可选 `cosign` 签名；版本由 release-please 生成——"发布物从哪来"也有据可查。
- **治理与指标证据**：接入 [OpenSSF Scorecard](https://scorecard.dev/)（分支保护、依赖更新、安全策略等可量化）、[CHAOSS](https://chaoss.community/kb/metrics-and-metrics-models/) 指标口径；度量 UI 用 [DORA/DevLake/Four Keys](https://devlake.apache.org/docs/DORA) 的单屏形态，口径与 `docs/metrics.md` 对齐。
- **可选（P2）**：审计链引入 hash chain（Rekor/透明日志思路，每条记录含 prevDigest）——现有追加式 `AuditEvent` 已接近，先不做，避免为"更酷的证据"增加运维复杂度。

**边界**：不在产品运行时引入 Sigstore/透明日志依赖；不做"为了指标而指标"；不把 OpenSSF 徽章当治理已成事实。

---

## 8. 采纳路线图（合并四份 MVP，按"每天生效"排序）

**第 1 周（全部 S，先摘低垂果实）**

1. `ConfirmationPrompt` 签票即执行 + 单主按钮；`formatApiError` 带 `retryAfterSeconds`；`ACTION_LABELS` 说人话。
2. `deliver` 打印 `reviewRequestId` + Web 深链，删误导提示。
3. `review show/inbox`、`task show`、`review watch`（GET 已存在，纯 CLI 渲染）。
4. Web 复制命令改为可执行 + 展示 taskId；修正 4 份角色包 guide。
5. 删 Google Fonts + 第三方头像外链。
6. `.gitattributes` + `prettier --write` + windows-latest job。
7. `report()` 补 details/operationId；未知命令 exit 2 + 建议。

**第 2–3 周（S/M，消除"回 Web 抄 ID"与"每次输密码"）**

8. `tasks --ready`（服务端补 requirement code）+ `claim --next` + `status` + `open`。
9. `.workmesh/local/state.json` + 参数缺省 + `context` 打印新 version。
10. `WebSession` step-up 窗口 + 审计字段。
11. `QueryClientProvider` 接线 + 决定/撤销后 invalidate；通知派生收件箱 + `NotificationRead`。
12. `box backup` 指纹确认 + manifest 1.1 + `backups verify`；`/api/health/ready` 补迁移数/角色包摘要 + `-Check`/doctor 复用。
13. `test-integration` Node 入口 + `setup-local.mjs` + 删 corepack 写法。

**第 4–6 周（M，接入真项目）**

14. AGENTS.md/CLAUDE.md 托管块（修 `agentEntries` 后）。
15. `onboard scan` + 7 篇草稿 + `submit --dry-run`/`--yes` + `onboard status`；在 `G:\yesgoo\yff` 实跑一次 scan→人工补 unknowns→提交→1 篇发布。
16. 批量票据 `ConfirmationBatch` + 工作台底部批量条（先 APPROVE，N≤20，同项目同 kind）。
17. `onboard rescan` 三层去重 + `seed-demo.mjs` 自包含。
18. 需求/知识/PRD 列表 cursor 分页 + 三态；Cmd+K + `labels.ts` 单一词典。

**第 7 周起（P1/P2，视真实使用数据取舍）**

19. SSE `/api/v1/events` + ETag + 度量卡；委托/超期入口；docs-smoke + release-please；SSE 多实例 Redis 扇出。
20. §7 自证：WorkMesh 自身走一遍 + 发布 attestation + Scorecard。

**每阶段统一验收门槛**：新 Agent 空项目只读 `AGENTS.md` + 3 条命令完成 claim/context/deliver；交付即打印评审深链，零次打开 Web 抄 ID；返修只用 `review inbox/show/watch` 闭环；一次批准 ≤3 点击、连批 10 条密码 ≤1 次；`-Check`/`doctor`/ready 对同一故障给同一结论。

---

## 9. 不建议照搬（含理由）

| 不照搬                                                    | 理由                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GitHub 的 2 小时 sudo 窗口                                | WorkMesh 批准是高后果动作，取 5–10 分钟；且窗口只免密码，不放宽票据/版本/摘要      |
| GitHub 行内评论 + 自由线程                                | 与 WorkMesh 追加式决定/票据语义冲突；证据卡 + 发布 diff 先够用                     |
| Gerrit Change-Id 服务端硬门禁、可反复改票                 | 已有 claim/generation/version 强一致；投票可改写会破坏"一条决定 + 追加撤销"        |
| `gh pr merge` 式 CLI 批准                                 | 绕开 WebSession + 一次性票据，违背"人在 Web 签字"                                  |
| GitHub GraphQL/全量命令系统                               | 命令面板先只做导航 + 少量动作，不重写成插件框架                                    |
| GitLab 审批规则引擎（required approvals/CODEOWNERS 叠加） | 已有槽位模型，别引入第二套规则引擎                                                 |
| DevLake/Grafana 平台                                      | 只借 DORA 指标口径，不引仪表盘平台/指标仓库                                        |
| 服务端"批量导入 + 整批回滚"                               | 与逐文档评审、追加式审计、一次性票据冲突；batch-decisions 的"无整批回滚"是刻意设计 |
| restic/pgBackRest/pg_verifybackup 引入                    | 单机逻辑备份 + 自有 manifest 校验和已覆盖；`pg_verifybackup` 不适用 pg_dump        |
| BMAD 旧 `document-project` 全仓库文档生成                 | 官方自己已弃用（"证据不支持"），再抄会把"过期散文"引回产品                         |
| repomix/gitingest 整包入知识库                            | 那只是 LLM 临时上下文；含密钥与体积风险，且无法逐篇人工签字                        |
| spec-kit/OpenSpec 全套 spec 工作流                        | 与既有 UNDERSTANDING/PRD/评审/快照重叠，会造第二套真相源                           |
| Nx/Bazel、Lerna、mdBook、vale                             | 对当前阶段过重；只借机制（doctest 思想、词表思路），不引工具链                     |
| Testcontainers 作唯一 DB 来源                             | Windows 本地 Docker 前置太重；作可选/未来 Linux CI，embedded-postgres 保留         |
| 把 WorkMesh 做进用户全局 shell rc                         | mise 式"输出一行让用户自己 eval"即可；不写用户全局配置                             |

---

## 10. 证据边界

- **外部机制**：本文所有"【事实】"均已抓取官方文档/仓库核对，包括 GitHub sudo mode 的 2 小时与动作重置、GitHub submit review/notifications/conditional requests、WHATWG SSE、pnpm 10 `managePackageManagerVersions` 默认 true、BMAD project-context 的托管块与"弃用 document-project"结论、`pg_verifybackup` 的适用边界、GitLab/Linear/Gerrit/restic/pgBackRest/Playwright/K8s/Actuator/arc42/ADR 的机制描述。未逐段抓取的（如 Four Keys、DevLake 部分页面）只作形态参照，并已在对应段落标注。
- **版本敏感**：pnpm 设置名与默认值以 pnpm 10 文档为准；GitHub 文档当前为 2026-03-10 API 版本；BMAD 文档为当前 v6；落地前建议按所用版本复核一次。
- **WorkMesh 落点**：`file:line` 对应本轮工作树（`main` @ `9893e01`，代码树与 `d0d5e8a` 一致；另有写作期间并行未提交改动）。**写作期间已有并行的 readiness 实现（`apps/api/src/common/readiness.service.ts`、`box doctor` 复用、`/api/health/ready`）与评审/工件仓库重构，本文方向与其一致，但文中"现状"描述按问题报告快照，实施前请以合并前代码复核行号与字段。**
- **未验证**：真实 Codex/Claude Code 对 `AGENTS.md`/`CLAUDE.md` 的加载优先级与冲突处理；Express 默认弱 ETag 是否已足够命中 304；step-up 窗口时长（5–10 分钟）应否按团队节奏调整；onboard scan 在 5k/50k 文件仓库的真实耗时。这些都需要在试点里用数据校准，不接受"装了就一定有效"的声明。
- **子报告**（工作产物，未入库）：`.tmp/usage-audit/solutions-{cli,web,onboard,ops}.md`，共 4 份、约 500 行先例-方案映射，本文做了去重、交叉校验与取舍。
