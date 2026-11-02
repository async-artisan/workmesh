# WorkMesh 项目定位

> 版本：v1.0（2026-11-02）· 基线：`main` 当前工作树（含未提交改动）
> 用途：统一对外叙事、目标用户与产品边界。本文不替代技术方案与实施计划，只回答三个问题：**卖什么、卖给谁、凭什么**。
> 证据以源码与现存文档为准，文末附证据索引。

---

## 0. 一句话定位

- **对外（中文）**：让 AI 干的活，有人签字、有据可查。WorkMesh 是面向「人 + 本地 AI Agent」团队的事实与签核层：Agent 在各自机器上生产，平台管版本、权限、上下文、证据与人工批准。
- **对外（英文）**：_The sign-off and evidence layer for teams shipping with local AI agents._
- **对内（产品）**：把「需求 → 角色 → 上下文 → 工件 → 评审 → 批准 → 变更」串成一条可追溯链路，让多角色、多 Agent 的协作不靠聊天记录和记忆。
- **对内（工程）**：可自部署的协作治理后端（NestJS + PostgreSQL）加薄桥 CLI；唯一权威事实、确定性输入、不可伪造的批准记录。

## 1. 品类：交付治理层，不是执行平台

WorkMesh 占据的是「执行」与「记录」之间的治理位：它不替任何人干活，只决定**什么算数、谁说了算、凭什么算数**。

| 层次 | 谁负责         | WorkMesh 的角色                        |
| ---- | -------------- | -------------------------------------- |
| 执行 | 本地 Agent、人 | 不执行、不编排、不托管运行时           |
| 记录 | 平台           | 只记录正式事实与证据，不是聊天记录仓库 |
| 裁决 | 平台 + 人      | 门禁由平台校验，批准由人落锤           |

| 是                                                     | 不是                                                |
| ------------------------------------------------------ | --------------------------------------------------- |
| 项目事实的权威源（需求编号、发布版文档、审批记录）     | 需求管理 / 看板工具（Jira、Linear）                 |
| 执行闸门（claim → snapshot → deliver → review → 决定） | Agent 执行平台 / 多 Agent 编排（LangGraph、CrewAI） |
| 证据层（真实字节摘要、提交级代码证据、禁止作者自审）   | 代码托管 / CI-CD                                    |
| 跨工具薄桥（CLI 一等公民，未来 MCP 复用同一契约）      | 统一 AI 客户端 / 聊天界面                           |
| 可私有部署的开源底座（MIT）                            | 托管 SaaS                                           |

边界是主动收窄的，不是能力不足：不做中心化 Agent 执行器、不做工作流市场、不做 GitLab 式万能兼容，Codeup 单列后续阶段，Redis 不承担正确性（见[开源协作计划](superpowers/plans/2026-11-01-workmesh-open-source-collaboration-plan.md#L9)、[技术边界](superpowers/plans/2026-11-01-workmesh-open-source-collaboration-plan.md#L33-L38)）。

## 2. 目标用户与反例

### 2.1 适配画像

| 维度     | 适配                                                          |
| -------- | ------------------------------------------------------------- |
| 团队规模 | 3–30 人的产品团队，**至少 3 个协作角色**                      |
| 工具     | 已在用本地 coding agent（Claude Code / Codex / WorkBuddy 等） |
| 代码托管 | GitHub（首个适配器），介意多仓与提交级证据                    |
| 数据边界 | 不接受项目知识与代码出域，能接受自部署 Postgres + API + Web   |
| 组织诉求 | 需要回答「谁批的、批的是哪一版、依据是什么」                  |

### 2.2 不适用的场景

- 单人开发或纯外包：没有跨角色交接，平台只剩表单负担。
- 只用云端 IDE / 云端 Agent：与「本地生产、平台裁决」的前提不符。
- 只要一个看板：Jira / GitHub Projects 更便宜。
- 不想运维数据库与服务的团队：这是基础设施，不是插件。

判断标准很简单：**当「交接是否可信」开始造成返工或扯皮时，WorkMesh 才有价值。** 在这之前，它是成本。

## 3. 结构：三层，加一个关键不对称

1. **本地层**：每个角色在自己机器上用本机 Agent 干活，草稿、记忆、过程留本地。
2. **桥接层**：CLI 用设备授权取得受限凭据，取上下文、交工件、发评审请求，**不能替人批准**。
3. **平台层**：只裁决正式事实——版本、权限、门禁、签字。Principal 由服务端派生，客户端自报身份 / 版本 / 审批一律不信（[docs/architecture.md](architecture.md#L3-L9)）。

关键不对称：**责任在人，执行在 Agent。** 任务的责任人是人（`Task.responsibleUserId`，[schema.prisma](../apps/api/prisma/schema.prisma#L454)），Agent 只能凭可撤销凭据认领与交付，正式决定只接受 HUMAN Web 会话（[README.md](../README.md#L39-L45)）。这比「给 Agent 派任务」更接近真实组织的问责方式，也是与多数 Agent 工具的分水岭。

## 4. 演进与当前基线

定位漂移过三次，对外叙事需要收敛到第三代：

| 代际               | 主张（一句话）                                                       | 现状                           |
| ------------------ | -------------------------------------------------------------------- | ------------------------------ |
| 第一代             | 需求管理 + AI 产品发现                                               | 代码已删除，仅存 Git 历史      |
| 第二代             | 事实联邦层：只存指针，正文留本地，Web 只看进度                       | 文档仍在，但与实现冲突         |
| **第三代（当前）** | **证据驱动的协作底座**：托管发布版，Web 是审批工位，流程可发布成 DAG | 代码事实（schema 与 CLI 为证） |

证据：第一代见 [phase-status](phase-status.md#L1-L4)；第二代见 [collaboration-spec](collaboration-spec-v0.1.md#L10-L18) 与 [redesign](redesign-v0.1.md#L15-L20)；
第三代见 `WorkflowRevision`、`RolePackageVersion` 与 `Requirement.phase`（[schema.prisma](../apps/api/prisma/schema.prisma#L341)、[#L405](../apps/api/prisma/schema.prisma#L405)、[#L978](../apps/api/prisma/schema.prisma#L978)）。

### 4.1 文档漂移（已修）

以下三处不一致已于 2026-11-02 收敛：README 按代码改写，`spec/SPEC.md` 升到 v0.2。保留记录用于防止回退。

**① 命令面。**

- 修复前：`workmesh init / ready / sign / sync / ack`（旧 README 与 SPEC）。
- 现实：正式命令为 `auth login`、`roles install`、`claim`、`context`、`materialize`、`candidate`、`deliver`、`review`、`receipt`、`changes`，测试断言旧命令**不存在**（[index.test.ts](../apps/cli/src/index.test.ts#L66-L96)）。
- 现状：见 [SPEC 命令表](../spec/SPEC.md#L120-L133) 与 [README CLI 一节](../README.md#L51-L95)。

**② 内容归属。**

- 修复前：内容留在本地，平台只同步索引（[collaboration-spec](collaboration-spec-v0.1.md#L34)）。
- 现实：平台托管**发布版**正文与工件真实字节（[architecture](architecture.md#L9)）。
- 现状：统一为「发布版托管、草稿与个人知识留在本地」（[SPEC §5](../spec/SPEC.md#L90-L118)）。

**③ Web 角色。**

- 修复前：Web 退化为进度视图（[redesign](redesign-v0.1.md#L15)）。
- 现实：Web 是审批工位——待办优先、一门一动作、Agent 不出现签字按钮（[工作台设计](design/workbench-and-requirement-detail.md#L5-L17)）。
- 现状：SPEC 心智模型已写明「网页是人做决定的地方」（[SPEC §0](../spec/SPEC.md#L5-L13)）。

## 5. 差异化

### 5.1 品类象限

```text
权威门禁 ↑
         │  GitHub PR review          WorkMesh
         │  （仅代码、单点）           （全角色 + 证据 + 签字）
         │
         │  Jira / Linear             Backstage
         │  （记录、无门禁）           （目录、无交付门禁）
         │  Confluence                BMAD / Spec Kit / OpenSpec
         │  （文档协作）               （本地工作流，无跨人权威）
         └──────────────────────────────────────────────→ 覆盖范围
            单点（代码/任务）                全角色交付
```

### 5.2 与相邻品类的关系

| 品类                       | 它解决         | 缺什么                               |
| -------------------------- | -------------- | ------------------------------------ |
| Jira / Linear              | 任务流转       | 无 Agent 身份、无输入锁定、无证据    |
| GitHub PR review           | 代码门禁       | 覆盖不到 PRD / 设计 / 用例 / 发布    |
| Confluence / Notion        | 文档协作       | 无版本化批准、无门禁                 |
| Backstage                  | 服务与归属目录 | 无交付门禁与人工签字                 |
| BMAD / Spec Kit / OpenSpec | 本地角色工作流 | 只有本地门，没有跨人跨角色的权威事实 |
| Agent 编排框架             | 执行           | 不管问责与证据                       |

结论：它们要么**只有门禁没有全角色**，要么**只有全角色没有门禁**。WorkMesh 的空位是「跨角色 + 权威门禁 + 可验证证据」。

### 5.3 护城河（别人不愿意做的脏活）

1. **确定性上下文快照**：发布版 + 真实字节 + SHA-256，Agent 输入不随访问权限漂移。
2. **服务端 Principal + 一次性确认票据**：防自报身份、防重放、防拿旧票据批新版本。
3. **厂商中立的代码证据 + 反自审规则**：作者自审、Bot、旧 SHA、已撤销评审一律闭门。
4. **追加式历史**：撤销是新增记录，不是改写过去。

这四条都不产生「酷炫 demo」，但正是审计与追责场景的准入条件。

## 6. 定位风险

| 编号 | 风险           | 表现                                    | 缓解                                                            |
| ---- | -------------- | --------------------------------------- | --------------------------------------------------------------- |
| R1   | 叙事过宽       | 「协作中枢」什么都能装，用户记不住      | 对外只用「签字 + 证据」这一个记忆点                             |
| R2   | 空手起步       | 无默认角色包、无示例项目，装完是空的    | 见 A2 / A3                                                      |
| R3   | 合规级摩擦     | 每个高风险动作都要密码二验 + 一次性票据 | 按部署模式分级，不取消门禁                                      |
| R4   | 范围压过完成度 | 全链路都很重，任何一段不闭环定位就落空  | 对外只承诺已验证范围（[phase-status](phase-status.md#L25-L31)） |

## 7. 收敛动作

| 优先级 | 动作                            | 验收标准                                                                                           |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| **P0** | A1 统一「托管 / 本地」口径      | 全仓只剩一种说法；v0.1 文档加「已被 v1 取代」横幅或移入 `docs/archive/`                            |
| **P0** | A2 发布默认角色包               | `spec/roles/*.md` + `spec/artifacts/*` 打包为可 `roles install` 的 manifest；装完即有 6 个角色 SOP |
| **P1** | A3 十分钟首跑路径               | 新用户从零到「一条需求被人工签字」≤ 30 分钟，且不需要读源码                                        |
| **P1** | A4 README / SPEC 重写（已完成） | 已落：README 与 `spec/SPEC.md` v0.2 不再出现代码中不存在的命令                                     |
| **P2** | A5 定位指标看板                 | 见第 9 节，按周记录                                                                                |
| **P2** | A6 术语与对外材料统一           | 第 10 节口径字典进入 README 与产品页                                                               |

> A2 是当前最高杠杆的动作：`roles install` 需要用户自备含 `manifest.json` 的包目录（[roles.ts](../apps/cli/src/roles.ts#L245-L252)），而 CLI 发行包只含 `dist`（[package.json](../apps/cli/package.json#L6)），仓库内也没有可安装的默认包。六份 SOP 已经写好，只差装进盒子。

## 8. README 改写（已应用）

以下文案已于 2026-11-02 应用到 [README.md](../README.md)，保留作为后续修改基线。

### 8.1 首段

> **建议改为：**
>
> WorkMesh 让 AI 干的活有人签字、有据可查。团队每个角色在自己电脑上用本机 Agent 生产，平台负责需求与流程、角色包、上下文快照、工件与代码证据、评审与变更传播。人只在关键节点用浏览器作正式批准，Agent 只持有受限、可撤销的凭据。
>
> 它不执行 Agent、不做 AI 对话、不替代 GitHub：它只裁决「这份交付是否成立」。

理由：把「协作中枢」换成可验证的一句话；同时用「不做什么」挡住错误预期。

### 8.2 快速开始

删除 `workmesh init`（命令不存在），改为真实路径：

```bash
corepack pnpm workmesh auth login          # 浏览器设备授权
corepack pnpm workmesh roles install --package <角色包目录> --project <uuid> --host codex
```

并在末尾加一段诚实的当前状态：

> 当前为可自部署的开发版：真实 PostgreSQL 迁移、浏览器 E2E、GitHub live 尚未验证（见 [docs/phase-status.md](phase-status.md)）。

### 8.3 标题与描述

- `package.json` 的英文 description 建议由 `Evidence-driven project collaboration hub for local AI agents` 改为 `Sign-off and evidence layer for teams shipping with local AI agents`。
- README 一级标题下加一行 tagline：`事实 · 证据 · 签字`。

## 9. 定位是否成立的验证指标

| 指标                 | 目标            | 说明                                    |
| -------------------- | --------------- | --------------------------------------- |
| 首次价值时间（TTFV） | ≤ 30 分钟       | 从 clone 到第一条需求被人工签字         |
| 角色覆盖             | 单项目 ≥ 3 角色 | 少于 3 个角色时平台价值不成立           |
| 门禁拒收率与原因分布 | 有稳定拒收      | 全部通过说明门禁形同虚设                |
| 作者自审拦截次数     | > 0             | 证明代码证据规则真的在拦                |
| 上下文快照复用率     | 稳步上升        | 反映「确定性输入」是否被 Agent 真正消费 |
| 变更 ack 时延        | 天级以内        | 反映变更传播是否真的触达                |

## 10. 口径字典

| 说法                             | 含义                                       | 不要混用为           |
| -------------------------------- | ------------------------------------------ | -------------------- |
| 发布版（published）              | 平台托管、可被他人在授权内取得的权威版本   | 草稿、候选           |
| 草稿 / 候选（draft / candidate） | 本地或平台内未批准版本                     | 发布版               |
| 批准（approve）                  | 人对某动作、目标、版本、摘要作出的正式决定 | 验收、合并           |
| 验收（accept）                   | 交付物满足验收条件的判定                   | 批准                 |
| 评审（review）                   | 提出请求与意见，不等于批准                 | 签字                 |
| Agent                            | 持有受限凭据的执行主体，无批准权           | 责任人               |
| 责任人                           | 对任务结果负责的人                         | Agent                |
| 事实（fact）                     | 平台裁决的正式状态与记录                   | 索引、缓存、检索结果 |

## 11. 证据索引

| 结论                        | 证据                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| 产品定位原话                | [README.md](../README.md#L3)                                                                         |
| 责任在人 / Agent 受限       | [README.md](../README.md#L39-L45)、[schema.prisma Task](../apps/api/prisma/schema.prisma#L454)       |
| 服务端 Principal 与真实字节 | [docs/architecture.md](architecture.md#L3-L9)                                                        |
| 流程驱动（非固定状态机）    | [schema.prisma Requirement.phase](../apps/api/prisma/schema.prisma#L341)                             |
| 角色包版本化                | [schema.prisma RolePackageVersion](../apps/api/prisma/schema.prisma#L978)                            |
| CLI 正式命令面              | [apps/cli/src/index.test.ts](../apps/cli/src/index.test.ts#L66-L96)                                  |
| 命令面（已对齐）            | [spec/SPEC.md](../spec/SPEC.md#L120-L133)、[README.md](../README.md#L51-L95)                         |
| 架构与未验证边界            | [docs/phase-status.md](phase-status.md#L25-L31)                                                      |
| 非目标与边界                | [开源协作计划](superpowers/plans/2026-11-01-workmesh-open-source-collaboration-plan.md#L26-L31)      |
| 人的工位设计                | [docs/design/workbench-and-requirement-detail.md](design/workbench-and-requirement-detail.md#L5-L17) |

## 12. 外部参照

定位与节奏的判断不是凭感觉：

- 瓶颈决定系统产出，非瓶颈提效只增加库存（[TOC](https://en.wikipedia.org/wiki/Theory_of_constraints)）。
- 在制品 × 周期时间 ≈ 队列长度，等待应该被度量（[Little's Law](https://en.wikipedia.org/wiki/Little%27s_law)）。
- 交付看四项指标，不看主观感受（[DORA](https://dora.dev/)）。

并行与大厂做法、验收、规范、通用性、度量的完整台账，见 [references.md](references.md)。
