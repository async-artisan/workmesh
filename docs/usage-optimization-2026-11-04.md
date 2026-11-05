# WorkMesh 实际使用体验分析与优化建议

> 日期：2026-11-04 · 基线：`main` @ `e942b23`（工作树另有并行的文档重排，见文末"证据边界"）
> 方法：按"真实工作的一天"走三条路径——① 团队审批人在 Web 上签字/返修；② 开发者或 AI Agent 用 CLI 开工、交付、读返修；③ 开发者/运维把环境跑起来并验证。逐条读代码 + 实跑只读命令（`--help`、参数校验、`/api/health`、`box status/doctor`、`pnpm test:integration`、`pnpm format:check`）+ 既有验收日志与设计文档对照。
> 与 `ASSESSMENT.md` 的分工：那份评成熟度/开源治理；**本文只回答"实际用它干活时，哪里卡、先改什么"**，不重复评分，也不改架构。
> 证据口径：文件路径:行号/命令输出均为【事实】；涉及频率、人群、心理成本的标注【推测】。
> 解决方案：每个断点对应的开源先例、采纳机制与落地方案见 [使用体验优化：开源先例与落地方案](usage-optimization-solutions-2026-11-04.md)。

---

## 0. 结论

**能用，但日常使用有五个真正的"断点"，且绝大多数是"能力已经建好、没接到使用路径上"，不是架构问题。**

按严重度：

1. **开工入口断了**：Agent 无法从 CLI 知道"我该干什么"，Web 给的命令是错的，装完角色包也不会写 `AGENTS.md`、更不会告诉你任务 ID——每天第一件事变成回 Web 抄 UUID，并把 `taskId/claimId/snapshotId/version` 手工串四步。
2. **收工与返修回路断了**：`deliver` 已自动创建验收评审，但 CLI 丢掉 `reviewRequestId`；没有任何命令能读评审、决定、返修意见，返修只能靠人转述。
3. **审批工位吞吐被摩擦吃掉**：工作台不会自己变新；一次批准 5–6 次点击 + 每次重输密码，密码验证还被限成 **5 次/15 分钟**；批量决定/委托/超期/升级 API 已实现但 Web 零入口；"撤销批准"唯一入口是一段永远渲染不到的死代码。
4. **新项目接入没有路径**：真实业务项目（易番番/YFF）需要的"仓库盘点 → 知识草稿 → 批量候选 → 人工发布"没有对应命令，`candidate` 一次只提交一个文件；项目 UUID、知识库 UUID 只能回 Web 找。这是试点的第一公里，不是锦上添花。
5. **"已就绪"信号不可信**：`/api/health` 恒 ok、缺 `WORKMESH_V1_DATABASE_URL` 时 Prisma 静默回退、`dev-local -Check` 与 `box doctor` 只看端口/静态 200；`backup/restore` 缺省读 `apps/api/.env`，可能在错误实例上操作（验收时真实发生过）。

**如果把"实际工作"当验收标准，最该先做的不是加功能，而是把这五条接上。** 下面每一节都给出证据、改法和成本（S ≤ 半天，M 1–3 天，L > 3 天）。

---

## 1. 三条真实路径，现在长什么样

### 路径 A：审批人（Owner / QA）的一天

1. 打开工作台 → 昨晚 Agent 交付过，但**页面不会变新**，要手动点刷新或 F5。
2. 批一条任务验收：打开决定抽屉 → 滚过整篇证据 → 作出决定 → 填说明 → 下一步 → 输密码 → 签发票据 → **再点一次提交**。约 5–6 次点击、2–3 次网络往返、1 次密码。
3. 批完回列表：这条仍显示为待办，铃铛计数也没减，再刷新。
4. 连批到第 6 条：`429 请求过于频繁`，界面只说"[RATE_LIMITED] 请求过于频繁"，不告诉你 **15 分钟后**再试。
5. 同事休假想委托、想看哪些槽位超期：Web 没有入口，只能走 API；批错了想撤销：Web 上找不到入口。

### 路径 B：Agent / 开发者的一天

1. `workmesh setup --role backend --host codex --api ... --project <uuid>` → 装完只打印"下一步：让 Agent 按 AGENTS.md 领任务"，但**项目里没有 AGENTS.md**（`agentEntries` 恒为空）。
2. 拿到任务 ID：CLI 没有 `tasks/ready/status` 命令，只能回 Web 工作台，或自己 curl `GET /projects/:id/tasks/ready`；Web 的"复制命令"给出 `workmesh context YFF-012`，**这条命令执行即失败**。
3. `claim` 成功后按提示走 `context --expected-version <claim 返回值>` → `deliver` 需要 `context` 返回的新版本 → `review` 又需要 `deliver` 的新版本；`context` 的人类可读输出**不打印新版本号**，换终端/上下文被截断就得重来。
4. `deliver` 其实已经自动建好验收评审并返回 `reviewRequestId`，但 CLI 把这个字段扔了，还提示你再跑 `review`；之后**没有任何命令能读评审、决定或"要求修改"的 comment**。
5. 返修意见只能等人转述；`changes` 每行只有两个 UUID，说明列恒空白。

### 路径 C：第一次把项目跑起来 / 运维的一天

1. README 是 4 条命令，实际是 **8–9 步、2–3 个终端**：Node/pnpm → install → shared build → prisma generate → **手工搭 embedded-postgres（`start-pg.mjs` 不在仓库）** → **手写 `apps/api/.env`** → migrate → seed → 起服务。
2. 示例连接串不带密码（`apps/api/.env.example:3`），而本机 embedded-postgres 口令是 `workmesh_local`（`docs/local-dev.md:71`）→ 照抄示例大概率认证失败。
3. `-Check`、`/api/health`、`box doctor` 全绿，但可能 `.env` 缺失、迁移没跑、连的是另一个库——第一批请求才 500。
4. 想跑文档写的验证：`pnpm test:integration` 在这台 Windows 上直接命中未安装的 WSL；干净 checkout 上 `pnpm format:check` 报 78 个文件（CRLF）不合格；`backup` 缺省从 `apps/api/.env` 取连接串，执行前不回显目标。

---

## 2. P0：五个断点与改法

### P0-1 开工入口断链：任务发现 + Agent 入口 + ID 串联

| 现象                                                                                                                     | 证据                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 只有 `claim/context/deliver/review/changes` 五个业务命令，没有"列任务/查状态"的发现命令                              | `node apps/cli/dist/index.js --help` 实测；`README.md:103` 明说 taskId 来自 `GET …/tasks/ready` 或 Web                                                                                                                                                                                                                                                               |
| Web"复制命令"复制 `workmesh context <需求编号>`，而 `context` 只认 `--task <uuid> --claim <uuid> --expected-version <n>` | `apps/web/src/pages/Workbench.tsx:194-204`、`:844-846`；`apps/web/src/pages/RequirementDetail.tsx:665-674`；`apps/cli/src/index.ts:609-610`；实测有效工作区执行 → `INVALID_REQUEST` exit 2                                                                                                                                                                           |
| 角色包装完不写 `AGENTS.md/CLAUDE.md`，`setup` 却提示"按 AGENTS.md 领任务"                                                | `apps/cli/src/setup.ts:119-127` 用相对前缀过滤 `files`，而 `apps/cli/src/roles.ts:373` 返回的是**绝对路径** → 永远过滤为空；单测用相对路径 mock（`setup.test.ts:46,130`）所以一直绿；内置包只声明 `agentEntries` 指针、没有实体资源，也没有 host adapter 写入实现；验收日志 `agentEntries: []`（`.tmp/team-acceptance-20261103/cli-setup-logs/setup.stdout.log:20`） |
| `taskId/claimId/snapshotId/version` 全靠人眼从 JSON 抄，无断点续做                                                       | `apps/cli/src/index.ts:584-589`（claim 打印下一步）；`context` 人类输出不打印新 version（`index.ts:697-707`）；设计里的 `.workmesh/local/runs/*` 检查点未实现（`docs/superpowers/plans/workmesh-technical-v1/03-local-workflows-clients.md:614-625`）                                                                                                                |

**改法（按 ROI 排序）**

1. **S**：Web"复制命令"改成可执行命令，并直接暴露 `taskId`：可开工任务行复制 `workmesh claim --task <taskId>`；需求详情/看板提供"复制任务 ID"。这一处修完，"回 Web 抄 UUID"的路径就通了。
2. **M**：新增 `workmesh tasks --ready`（服务端 `GET /projects/:id/tasks/ready` 已存在）和 `workmesh claim --next`；`claim/context/deliver` 成功后写 `.workmesh/local/state.json`（taskId/claimId/snapshotId/taskVersion/reviewRequestId），后续命令允许省略 `--claim/--snapshot/--expected-version`。
3. **S/M**：在业务项目根写 `AGENTS.md/CLAUDE.md` 托管块（带 `<!-- workmesh:begin/end -->` 标记，保留用户字节，冲突退出），内容 = 角色 + `claim → context → deliver` 三步 + `guide.md` 路径；`setup` 打印真实写入的入口文件。这是"规范可下发"卖点的最低成本兑现。
4. **S**：`claim` 冲突时返回/打印已有 `claimId`，而不是只报 `CLAIM_CONFLICT`。

**验收**：新 Agent 在空项目里只读 `AGENTS.md` + 跑 3 条命令即可完成 claim/context/deliver；零次打开 Web 抄 ID。

---

### P0-2 收工与返修闭环：`deliver` 丢 reviewRequestId、无评审读取

| 现象                                                                                                                         | 证据                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 交付事务已自动创建 `TASK_ACCEPTANCE` 评审并返回 `reviewRequestId`，CLI 只留 `artifactSetId/taskVersion`，还提示再跑 `review` | 服务端 `apps/api/src/tasks/v1-artifact.prisma-repository.ts:396-428,493-497`；CLI `apps/cli/src/index.ts:1192-1203`（resultRefs）、`:1212-1230`（输出）、`:1228`（提示） |
| 没有任何命令能读评审、决定、返修 comment、任务详情、工件集                                                                   | 命令面见 `index.ts:338-1414`；`docs/api.md:86` 说明 `POST /review-requests` 只用于"已有候选主体单独建评审"，README 却把它列成标准步骤（`README.md:109`）                 |
| `changes` 每行只有 eventId + 空摘要                                                                                          | `apps/cli/src/index.ts:1408-1414` vs `apps/api/src/tasks/v1-change.repository.ts:5-14`（收件人快照没有 summary 字段）                                                    |

**改法**

- **S**：`deliver` 输出 `reviewRequestId` + Web 深链（复用 `index.ts:1269` 已有拼法），提示改为"已在 Web 待评审，可用 `workmesh review show` 查看"。
- **M**：新增 `workmesh review show/inbox`、`workmesh task show`（GET 接口均已存在）；`changes` 服务端补需求编号/标题/changedFields，让"变更传播"在 CLI 真正可读。
- **S**：`--json` 与人类输出都带 `reviewRequestId`；文档把"交付即建评审"写成唯一口径，删掉"再跑 review"的误导步骤。

**验收**：QA 要求修改后，Agent 只靠 CLI 就能读到返修意见并重新交付，不需要人转述。

---

### P0-3 审批工位吞吐与新鲜度

| 现象                                                                                                                             | 证据                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工作台只在切项目时 load；签字抽屉关闭不刷新；顶部 60s 定时只刷铃铛计数                                                           | `apps/web/src/pages/Workbench.tsx:143-145`、`:531`、`:865`；`apps/web/src/App.tsx:90-116`                                                                                                         |
| 一次批准 = 打开 → 滚证据 → 作出决定 → 下一步 → 输密码 → 签发票据 → 提交；弹窗直接显示 `REVIEW_DECIDE`、`REVIEW_REQUEST · <UUID>` | `apps/web/src/pages/ReviewDecision.tsx:779-788`；`apps/web/src/components/ConfirmationPrompt.tsx:109-125`、`:140-159`、`:168-177`                                                                 |
| 密码二次验证限 **5 次/15 分钟/会话**，超限 429；Web 错误文案丢掉 `retryAfterSeconds`                                             | `apps/api/src/auth/v1-account.service.ts:284-292`；每次签票都走 `apps/api/src/auth/v1-action.service.ts:67-77`；`apps/web/src/api/client.ts:160-167` 只拼 code/message/requestId                  |
| 批量决定/槽位委托/超期/升级 API 有，Web 零入口；`reviewApi.batchDecide` 写了没人调用                                             | `apps/api/src/reviews/v1-review.controller.ts:272-339`；`docs/api.md:133-137`；`apps/web/src/api/resources.ts:705-721`（全仓唯一一处）；`apps/api/src/reviews/delegations.controller.ts:27,50,55` |
| "撤销批准"按钮只在 `?id=` 旧详情里，而 App 会把 `/reviews?id=` 一律重定向掉；测试直接挂载组件所以一直是绿的                      | `apps/web/src/pages/Reviews.tsx:38,177,381-388`；`apps/web/src/App.tsx:487-494`；`apps/web/src/pages/Reviews.test.tsx:277`                                                                        |

**改法（先做"让它能用"，再谈"让它好用"）**

1. **S**：工作台接入已声明但 0 引用的 `@tanstack/react-query`（`apps/web/package.json:15`）做 30–60s staleTime + 窗口 focus 重取；决定/确认成功后乐观移除并 refetch。**这是全篇 ROI 最高的一处**——不改权限语义，每天生效。
2. **S**：票据签发成功后自动执行，去掉第二次"提交"；密码改为"会话内 5 分钟复用 + 每动作一张票据"（票据仍绑定动作/目标/版本/摘要、单次有效），或一次密码签发同批 N 张绑定票据。
3. **S**：`formatApiError` 把 `details.retryAfterSeconds` 拼进提示（"请 15 分钟后再试"）；动作码用 `lib/labels.ts` 的 `ACTION_LABELS` 映射，目标显示人话而非 UUID。
4. **M**：把批量决定/委托/超期入口接到工作台与评审列表（规则 `docs/design/approval-workstation.md:44-86` 已写好）；批量按"同项目同 kind、高风险禁批、逐条校验部分成功"。
5. **S**：在决定历史行加"撤销批准"（`reviewApi.revoke` 与票据绑定代码都已存在），并删除 `Reviews.tsx` 里那段不可达的旧详情（约 170 行死代码）。

**验收**：Agent 交付 → 工作台 60s 内可见；一次批准 ≤3 次点击、密码 ≤1 次；连续批准 10 条不撞限流（或明确倒计时）；Web 能完成一次撤销并留下审计。

---

### P0-4 新项目（历史代码库）接入没有路径

这是 YFF 试点暴露的第一公里问题，不是"更高级的功能"：

| 缺口                                                                  | 证据                                                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 没有"扫描仓库 → 生成知识草稿 → 批量提交候选 → 人工审核发布"的一键流程 | `docs/yff-workmesh-discussion-context-2026-11-03.md:68-105`（明确提出 `onboard scan/submit/rescan`，尚未实现） |
| `candidate` 一次只提交一个文件、不递归扫描目录                        | 同上 `:81`；`apps/cli/src/index.ts:1051-1163`                                                                  |
| 项目 UUID、知识库 UUID、文档 UUID 都要回 Web 找，没有 CLI 发现命令    | `apps/cli/src/index.ts` 无 project/kb 列表命令；YFF 文档 `:213-220` 自己列了"仍需确认项目 UUID/知识库 UUID"    |
| 长期知识只靠人工另起候选，PRD 发布不会沉淀为知识                      | YFF 文档 `:250-288`；`docs/knowledge-architecture.md`                                                          |

**改法（建议作为"接入一个真实项目"这个 P0 目标的唯一范围）**

1. **M**：`workmesh onboard scan`（只读盘点：结构/技术栈/启动构建测试命令/数据库 schema/API 模块/README/ADR，产出带来源文件与 commit 的草稿目录）+ `workmesh onboard submit --dry-run`（先展示将提交哪些候选，再批量提交）。
2. **S**：`workmesh projects/kb list`，把 projectId、默认知识库、仓库 ID 放进 `setup`/`context` 输出，消除"回 Web 找 UUID"。
3. **M**：接入后第一批知识固定 7 类（项目概览、启动说明、模块地图、环境变量、测试构建、业务规则、部署回滚），允许"先公共基础 + 第一个需求涉及的模块"，与 YFF 文档建议一致。
4. **S**：把 `.tmp` 里的演示数据（`scripts/seed-yff.mjs` 依赖 gitignored 的 `.tmp/yff-req`）改为脚本内生成或随仓库提供最小正文，让"新机器 30 分钟看到 25 条需求"成立（`docs/positioning.md:110,181` 已列为 G2）。

**验收**：一个陌生仓库 + 一个真实需求，从 clone 到第一条需求被签字 ≤30 分钟（对齐 `docs/positioning.md:227` 的 TTFV 目标）。

---

### P0-5 "已就绪"信号不可信（含运维目标歧义）

| 现象                                                                                                                                                  | 证据                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/api/health` 恒 `{status:'ok'}`；缺 `WORKMESH_V1_DATABASE_URL` 时 Prisma 静默回退到无密码 URL，且启动时不连接                                        | `apps/api/src/app.controller.ts:7-10`；`apps/api/src/prisma/prisma.service.ts:14-23`                          |
| `dev-local.ps1 -Check` 与 `box doctor` 只看端口/静态 200；迁移、角色包摘要、DB `SELECT 1` 都不查（而这两项正是 `local-dev.md` 记录的 API 起不来主因） | `scripts/dev-local.ps1:195-209`；`packages/box/src/commands/doctor.ts:11-15`；`docs/local-dev.md:182,188-214` |
| `backup/restore` 缺省从 `apps/api/.env` 取连接串、执行前不回显目标；验收时真实发生过"BOM/键错误 → 回退开发库、备错库、在开发实例建恢复库"             | `packages/box/src/lib/config.ts:37-55`；`docs/testing/team-acceptance-2026-11-03.md:93`                       |
| `box status` 打印 `winsw · C:\ProgramData\WorkMesh\workmesh-service.xml`，但该目录不存在；doctor 宣称"无副作用"却会 `mkdir` 数据目录                  | 实测输出 + `Test-Path C:\ProgramData\WorkMesh` = False；`docs/box.md:10-11`                                   |
| 打包安装数据在 `%ProgramData%\WorkMesh`，box 默认 `%LOCALAPPDATA%\workmesh`，包内没有 `workmesh-box` 启动器                                           | `scripts/box/install.ps1:4,17`；`packages/box/src/adapters/windows.ts:11-16`；`scripts/package-box.ps1:52-86` |

**改法**

1. **M**：`main.ts` 启动强校验（必需 env + `SELECT 1`）；新增 `/api/ready`（DB、迁移数、内置角色包摘要）；`dev-local.ps1 -Check` 与 `box doctor` 复用同一套检查，每个失败项打印"下一条修复命令"。
2. **M**：`backup/restore` 执行前打印实例指纹（host/port/db/迁移数）并要求显式确认；manifest 增 dump SHA-256、表数、PostgreSQL 版本；`restore` 后自动核对表数。
3. **S**：`box status` 服务状态输出"已安装/未安装"；备份同时打印绝对路径（UTC `createdAt` 与本地目录名统一）；补 `box backups list/verify/prune`。
4. **M**：打包安装与 box 的数据目录、配置来源统一；包内提供 `workmesh-box.cmd`；`doctor` 文档改为"只创建数据目录"。

**验收**：停掉 PostgreSQL 或指向空库后，`-Check`/`doctor` 必须红；`backup` 打印的目标与 `restore --from` 打印的 manifest 能对上号。

---

## 3. P1：会明显拖慢一天，但不到"断链"的程度

| #   | 摩擦                                                                                                                                                                                                                                                                                                 | 证据                                                                                                                                                                                      | 建议（成本）                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Windows 干净 checkout 上 `pnpm format:check` 报 78 个文件不合格（工作区 CRLF，仓库无 `.gitattributes`；119 个文件 `w/crlf`；`App.tsx` 即使按 CRLF 仍不合格）                                                                                                                                         | 实测 `git ls-files --eol`、`prettier --check`；`.editorconfig` 只声明 lf                                                                                                                  | 加 `.gitattributes`（`* text=auto eol=lf`）+ 跑一次 `prettier --write`；PR 模板提示 `git config core.autocrlf false`（S）                    |
| 2   | 文档写的集成测试入口在 Windows 不可用：`bash` 命中未安装的 WSL，脚本内又用已坏的 `corepack pnpm`，测试库 env 从未写进用户文档                                                                                                                                                                        | 实测 `pnpm test:integration` 立即 exit 1；`scripts/test-integration.sh:18,27,33`；`docs/local-dev.md:69`                                                                                  | 脚本去 corepack；提供 `scripts/test-integration.ps1` 或纯 node 入口；补 `docs/testing/README.md`：5 个入口 × 前置 × 建库示例 × 预计耗时（M） |
| 3   | 首次上手 8–9 步且依赖"这台机器"：embedded-postgres 的 `start-pg.mjs` 不在仓库、`.env` 手写、`pg_dump/psql` 只在 gitignored 的 `.tmp/pgclient`（1.19GB）                                                                                                                                              | `scripts/dev-local.ps1:224-227`；`docs/local-dev.md:124,150-172`；`.gitignore:12`                                                                                                         | 仓库内置幂等 `scripts/setup-local.mjs`（生成 PG home/.env/跑迁移）；`scripts/fetch-pgclient.ps1` 或文档化安装来源（M）                       |
| 4   | 角色包 guide 指错路径：4 份 guide 让 Agent 读 `.workmesh/local/context/...`，实际是 `.workmesh/context/...`；`review --expected-version` 文档写 artifactSetVersion，服务端校验 taskVersion                                                                                                           | `packages/role-packages/roles/{backend:20,frontend:22,qa:21,ui:21}/guide.md`；`apps/cli/src/context.ts:249`；`apps/api/src/reviews/v1-review.service.ts:299-305`；`schema.prisma:661-681` | 修 4 份 guide；把 guide 里的命令加入 CI 的 CLI smoke（S）                                                                                    |
| 5   | 错误不可行动：人类模式丢 `details`（`VERSION_CONFLICT` 只显示重复码）、写失败不打印 `operationId`、未知子命令 exit 0                                                                                                                                                                                 | `apps/cli/src/index.ts:1449-1466`、`:239-246`；`apps/cli/src/errors.ts:122-130`；实测 `workmesh tasks` → exit 0 并打印 onboarding                                                         | 人类模式打印 expected/current 与"用 `--operation` 重放"；写失败输出 operationId；未知命令 exit 2 + 最近似命令建议（S）                       |
| 6   | 自部署/内网首屏依赖外部服务：Google Fonts `@import` + 每个角色/任务头像走第三方文生图接口（断网破图，且把角色信息发给外部，和"数据不出域"矛盾）                                                                                                                                                      | `apps/web/src/index.css:7`；`apps/web/src/components/RequirementPipeline.tsx:63`                                                                                                          | 字体改 system-ui/自托管；头像改本地 SVG/首字母（S）                                                                                          |
| 7   | 列表规模上限：需求/知识/PRD 只拉 `limit=50`、前端不翻页（>50 条静默丢），且首屏先闪"还没有数据"                                                                                                                                                                                                      | `apps/web/src/api/resources.ts:471-475,640-644`；`Requirements.tsx:43,57-67`                                                                                                              | 接服务端 cursor 分页 + "加载更多"；三态组件（骨架/空/错误+重试）（M）                                                                        |
| 8   | 度量只有 API 没有 UI：`GET /projects/:id/metrics/flow` 在 Web 无任何入口；邮件摘要要手动点、不是提醒                                                                                                                                                                                                 | `docs/metrics.md`；Web 全仓无 metrics 引用；`docs/deployment.md:27`；`apps/web/src/App.tsx:186-195`                                                                                       | 工作台加"门禁拒收率/失效后重审率/变更 ack 时延"卡片；用 cron 调 digest 接口或做发送任务（M）                                                 |
| 9   | 备份/恢复与安装脱节 + 时间对不上（见 P0-5）；`-Stop` 直接强杀 PostgreSQL 进程树（没有 `pg_ctl stop -m fast`）                                                                                                                                                                                        | `scripts/dev-local.ps1:159-186`；`packages/box/src/lib/backup.ts:21-26`                                                                                                                   | PG 走 `pg_ctl fast`；杀前打印将停止的进程并支持 `-WhatIf`（S/M）                                                                             |
| 10  | 文档命令照抄失败与口径漂移：`docs/local-dev.md:113` 的 `--config-home` 位置实测 `unknown option`、相对路径被拒；README 用 `corepack pnpm`（`:85-86`）而 local-dev 禁用 corepack；`local-dev.md:70-71` 说根 `.env.example` 是旧模板（实测两份已相同）；导航实际 12 项而 `local-dev.md:79-91` 写 11 项 | 实测错误输出；`README.md:49,85-86`；`docs/local-dev.md:69-71,79-91`；`apps/web/src/nav.ts:33-103`                                                                                         | 修 CLI 命令示例（选项放子命令后、用绝对路径）；统一"是否用 corepack"；删掉过时描述（S）                                                      |
| 11  | Windows 上 `prisma generate` 与 dev/watch 抢 DLL → EPERM；而 `predev/pretest` 每次都 generate                                                                                                                                                                                                        | `BLOCKED.md` 原 B7（被归档后该经验只剩 `docs/archive/2026-11-03/baseline.md:35`）；`apps/api/package.json:10,17`                                                                          | 按 schema/client mtime 跳过 generate；失败提示"先 -Stop 或改输出目录"，并放回 FAQ（S）                                                       |
| 12  | Node 版本三处不一致：本机 20.13.1、CI 20.19、`engines >=20.0.0`                                                                                                                                                                                                                                      | 实测 `node -v`；`.github/workflows/ci.yml:37`；`package.json:8-11`                                                                                                                        | 加 `.nvmrc` 对齐 20.19，或说明 CI 为何单独钉版本（S）                                                                                        |

---

## 4. P2：可以做，但先别花时间

- **术语与称谓**：同一状态四套叫法（`Board.tsx:17-22` vs `lib/labels.ts:17-22`）、评审页直接渲染 `stepKey`/枚举；导航"看板/需求流水线/流程"三处同名不同物。→ `labels.ts` 做唯一来源，页面禁止直接渲染枚举（S/M）。
- **通知中心不是通知**：只有总数与最近活动，不能点进具体评审/变更，没有未读/已读（`App.tsx:331-405`）。→ 深链 + 未读态（S/M）。
- **工作台决定抽屉**：决定区排在整篇正文之后，长 PRD 要滚两屏才见主按钮（`ReviewDecision.tsx:378,680,749-791`）。→ embedded 模式把决定区 sticky 到底部（S）。
- **初始化流程实例太重**：逐项选责任人/审批人/验收归属，缺项只表现为按钮变灰，无"还差 N 项"提示（`WorkflowInstanceDialog.tsx:219-232,351-391`）。→ 记住上次绑定 + 缺项提示（M）。
- **变更批量确认串行失败中断**，且勾选框在"全部"tab 也渲染但批量按钮只在变更 tab（`Workbench.tsx:172-192,629`）。→ 逐条收集结果、跳过已成功（S）。
- **需求详情首屏是装饰**：6 阶段协作图在 tabs 之前，门禁/下一步在后（`RequirementDetail.tsx:692-702`，单文件 1263 行）。→ 折叠成一行、门禁上提、按 Tab 拆文件（M）。
- **角色/阶段硬编码 6 个**：自定义角色的任务在门禁显示"不适用"、流水线不归类（`RequirementDetail.tsx:144-148,393-400`）。→ 从流程定义动态生成（M）。
- **CLI 细节**：本地命令伪造 `meta.requestId`（`index.ts:118-120`）；`product` 本地状态命令强制联网（`index.ts:835-1034`）；物化目录 `001-prd.md` 不直观且无 `README`（`context.ts:165-175`）；全局选项只能放子命令后、无 `WORKMESH_API` 环境变量（`index.ts:93-100`）；凭据文件按次累积（`credential-store.ts:44-59`）；未知命令/拼错角色退出码不规范（9 / 0）。
- **box/Linux**：`BOX_VERSION` 硬编码 `1.0.0`（`packages/box/src/version.ts:1`）；Linux 默认数据目录 `/var/lib/workmesh` 非 root 不可写、`dev` 的 PG 自启逻辑写死 Windows（`packages/box/src/adapters/linux.ts:12`、`commands/dev.ts:45`）；help 无 `install/service` 命令却暗示"三平台一套实现"。
- **中文日志乱码恰好糊住启动错误**：`dev-local.ps1` 必须 UTF-8 BOM，重定向日志在 PS 5.1 下乱码，而"内置角色包摘要冲突"正是最需要读的错误。→ 启动错误带 ASCII code，或 `dev-local.ps1 -Logs` 用正确编码 tail（S）。

---

## 5. 建议的两周路线（按"每天生效"排序）

**第 1 天–第 2 天（全是 S，改完立刻每天受益）**

1. 工作台/需求详情接 30–60s 轮询 + focus 重取 + 动作后刷新（P0-3.1）。
2. 修 Web"复制命令"为可执行命令并展示 `taskId`（P0-1.1）。
3. `deliver` 打印 `reviewRequestId` + Web 深链；`formatApiError` 带 `retryAfterSeconds`；动作码说人话（P0-2、P0-3.3）。
4. 修 4 份角色包 guide 路径；修 `local-dev.md` 的 CLI 命令示例；删掉过时描述（P1-4、P1-10）。
5. 去掉 Google Fonts 与第三方头像外链（P1-6）。
6. 加 `.gitattributes` + 跑一次 `prettier --write`（P1-1）。

**第 3 天–第 5 天（S/M，消除"必须回 Web 抄 ID"）**

7. `workmesh tasks --ready` + `claim --next` + `.workmesh/local/state.json` 检查点（P0-1.2）。
8. 写 `AGENTS.md/CLAUDE.md` 托管块 + `setup` 打印真实入口（P0-1.3）。
9. `review show/inbox`、`task show`、`changes` 补摘要（P0-2.2）。
10. 票据：签票后自动执行 + 会话内密码复用窗口（P0-3.2）。

**第 6 天–第 10 天（M，让"就绪"可信、让体检有用）**

11. `/api/ready` + 启动强校验 + `-Check`/`doctor` 复用（P0-5.1）。
12. `backup/restore` 显式目标 + manifest 校验和（P0-5.2）。
13. 批量决定/委托/超期入口 + 撤销批准入口（P0-3.4、P0-3.5）。
14. `scripts/setup-local.mjs` + `fetch-pgclient` + `docs/testing/README.md`（P1-2、P1-3）。

**第 3–4 周（M/L，接入真项目）**

15. `onboard scan/submit` MVP + `projects/kb list` + 演示数据自包含（P0-4）。
16. 列表服务端分页、度量看板、通知深链（P1-7、P1-8、P2）。

---

## 6. 不要动的部分（已经做得好，别为"统一体验"改坏）

- **安全与证据链**：一次性票据绑定动作/目标/版本/payload 摘要、timing-safe 校验、集中授权、默认拒绝、404 不泄露存在性、追加式决定/撤销记录——这是产品立身之本，优化只应"减少输密码次数"，不应放宽票据语义。
- **CLI 中段的确定性**：严格 UUID/摘要校验、写前 PENDING receipt、写操作不自动重试、GET 有限重试、上下文原子物化且不覆盖本地草稿——质量在线。
- **构建与 CI**：数据库漂移闸门（先迁移到空库再 `migrate diff --exit-code`）、覆盖率 80% 门禁已接线、前端已按路由 lazy 拆分（首屏约 117 KB gzip JS，506 KB 单包警告是旧基线）。
- **文档纪律**：验收报告明确区分"已验/未验"，不把"测试通过"写成"产品闭环完成"——这类自我约束在同类项目里少见，继续保留。

---

## 7. 改完怎么验证（可度量，不必等用户访谈）

| 指标                                   | 目标             | 现状                                  |
| -------------------------------------- | ---------------- | ------------------------------------- |
| Agent 交付 → 工作台可见延迟            | ≤60s             | 除非手动刷新，否则永不                |
| 一次批准：点击数 / 密码次数 / 网络往返 | ≤3 / ≤1 / ≤2     | 5–6 / 1（且每 15 分钟最多 5 次）/ 2–3 |
| 开工前获取 taskId 的步骤               | 0 次打开 Web     | 1 次打开 Web + 手动抄写               |
| 返修意见获取                           | CLI 可读         | 只能人转述                            |
| 新机器"能开始干活"的步骤               | ≤4 步、1 个入口  | 8–9 步、2–3 终端                      |
| `-Check`/`doctor` 与真实可用性一致     | 断库/缺迁移必红  | 可能全绿                              |
| 首页第三方请求数                       | 0                | 1 个字体域 + 每角色/任务 1 张外链图   |
| 集成测试入口                           | Windows 一条命令 | 当前不可用（WSL + corepack）          |
| 需求 >50 条                            | 可见、可翻页     | 静默丢                                |

---

## 8. 证据边界与需要复核的点

- 本报告未启动新的浏览器自动化，也未联网触发需要真实凭据的冲突/限流场景；Web 侧的点击成本来自代码路径与既有验收日志，**"频率/痛感"是 3–30 人团队日常形态的推断**，建议用 3 人各走一天校准。
- **写作期间工作区有并行的文档重排**（`git status` 约 30 项：`docs/operations-boundaries.md`、`docs/migration-plan.md`、`docs/baseline.md` 等已删除/归档，`BLOCKED.md`/`phase-status.md`/`dev-plan.md` 被重写，新增 `docs/README.md`）。这不是本次审计产生的；本文对文档的引用以 19:20 左右的快照为准，代码、脚本与命令输出证据不受影响。其中"审批工位状态"、"BLOCKED 口径"、"文档导航"等漂移类问题可能已被该并行工作部分解决，请以当前工作树复核再排期。
- 行号对应 `e942b23` + 上述工作树快照；后续改动可能移位，建议用文件中引用的关键字符串检索。
- 未覆盖：真实 GitHub live/webhook、生产 HTTPS/TLS、Linux/macOS 实机、长时间稳定性与容量、无障碍与跨浏览器——这些是 `BLOCKED.md` 已有边界，不属本文"使用体验"范围。

---

## 附：本报告依据的三份原始审计（工作产物，未入库）

| 方向                  | 文件                                  | 规模                                                  |
| --------------------- | ------------------------------------- | ----------------------------------------------------- |
| Web 使用摩擦          | `.tmp/usage-audit/web-usage.md`       | 20 条（3 P0 / 9 P1 / 8 P2），含"一天的点击路径复现"   |
| CLI + Agent 工作流    | `.tmp/usage-audit/cli-agent-usage.md` | 15 条（3 P0 / 7 P1 / 5 P2），含命令实测输出           |
| 本地开发 / 测试 / box | `.tmp/usage-audit/dev-ops-usage.md`   | 25 条（4 P0 / 8 P1 / 13 P2），含 5 个验证入口实测矩阵 |

三份原始报告均标注了证据口径与未验证边界；本文做了去重、交叉核对（对其中会误导的旧结论——如"bundle 506KB"、"App.tsx 乱码"——已按当前构建日志与严格 UTF-8 校验排除）。
