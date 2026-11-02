# WorkMesh 系统重设计 v0.1（草案）

> 依据《协作规范 v0.1》推导的系统设计。目标：把 WorkMesh 从"需求管理系统"改造为**项目事实的联邦层**。
> 状态：草案，待评审。

---

## 1. 目标与边界

**要做的**

- 平台只存**事实、指针、挂靠关系**；各角色知识正文留本地
- 以产品为源头，需求编号贯穿所有工件与证据
- 向下为各角色 agent **装配上下文**，向上**回收证据**、**传播变更**
- Web 退化为项目进度视图，桥接器（CLI/MCP）升为一等公民

**明确不做**

- 不做 AI 对话能力（保持为可选增强，非核心）
- 不托管各角色的知识正文、不强制迁移现有笔记工具
- 不重复造 CI/CD、代码托管、权限体系（对接即可）

## 2. 现有模型盘点（对照 `prisma/schema.prisma`）

| 现有模型                                                | 处置         | 说明                                                                                                      |
| ------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| `Project.key`                                           | **保留强化** | 已有 key，但需定为不可变、全局唯一、2–6 位大写，作为编号前缀                                              |
| `Organization` / `User` / `ProjectMember`               | **保留改造** | `ProjectMemberRole` 需从 OWNER/ADMIN/MEMBER 扩展出角色维度（PRODUCT/UI/FRONTEND/BACKEND/QA/OPS）          |
| `Requirement`                                           | **改造**     | 缺项目内序号 `seq`（当前 uuid，无人类可读编号）；状态枚举需换成新状态机                                   |
| `Prd` / `PrdVersion` / `PrdApproval`                    | **保留改造** | 审批机制已有，与新的 SignOff 统一                                                                         |
| `TechnicalSpec` / `TechnicalDecision`                   | **保留**     | 对应规范中的技术方案层                                                                                    |
| `KnowledgeBase` / `KnowledgeDocument` / `DocumentChunk` | **重大改造** | 当前是"项目下一个库、正文入库"；需改为**外部/本地知识源注册表 + 条目索引**，正文不入库                    |
| `Trace` / `TraceLink`                                   | **保留扩展** | 多态设计正好承得住，需增加"知识条目 ↔ 需求"边                                                             |
| `GitCommit` / `PullRequest`                             | **保留**     | PR review 作为签字证据来源                                                                                |
| `AuditLog`                                              | **保留**     | 与签字记录互补                                                                                            |
| `AiRun` / `AiRunMessage`                                | **降级**     | AI 产品发现非核心，冻结不再扩展                                                                           |
| `RequirementLink` / `RequirementDependency`             | **保留**     | 需求级依赖；任务级依赖需新增                                                                              |
| —                                                       | **新增**     | `Task` / `TaskDependency` / `Artifact` / `KnowledgeSource` / `KnowledgeEntry` / `SignOff` / `ChangeEvent` |

## 3. 数据模型变更

### 3.1 Requirement（改造）

```
Requirement {
  seq        Int     // 项目内自增，与 Project.key 组成 YFF-REQ-123
  code       String  // 派生展示编号，唯一索引 (projectId, seq)
  status     RequirementStatus  // 换成新状态机
  ...
}
```

新状态枚举：`DRAFT | PRD_READY | DESIGN_READY | IN_DEV | CODE_LINKED | TESTED | RELEASED`
（旧枚举 DRAFT/IN_REVIEW/APPROVED/IN_PROGRESS/DONE/ARCHIVED 需迁移映射）

### 3.2 Task（新增）

```
Task {
  id, requirementId
  code        String   // YFF-REQ-123-T01
  title       String
  role        RoleType // PRODUCT|UI|FRONTEND|BACKEND|QA|OPS
  assigneeType String  // HUMAN | AGENT
  assigneeId  String?
  status      TaskStatus // OPEN|IN_PROGRESS|REVIEW_PENDING|DONE
  acceptance  Json     // 验收点列表
  blockedBy   TaskDependency[]
  artifacts   Artifact[]
  updatedAt
}
```

约束：**agent 身份只能推进到 `REVIEW_PENDING`**，服务层对 agent 的 `DONE` 请求直接拒绝。

### 3.3 Artifact（新增，统一工件模型）

```
Artifact {
  id, requirementId, taskId?
  kind        ArtifactKind   // PRD | DESIGN | IMPL | CASES | RELEASE
  storage     StorageMode    // HOSTED（平台存正文，如 PRD）| EXTERNAL（只存指针）
  uri         String?        // 外部位置（仓库路径 / 文件路径 / URL）
  contentHash String?        // 用于检测外部工件是否变更
  schemaVersion String
  validation  Json           // 校验结果：通过/失败项
  summary     String?        // 供进度视图展示的摘要，不存全文
  createdBy   String         // 人或 agent
}
```

原则：**产品源工件（PRD）平台托管正文**；其余角色工件只存指针、校验结果与摘要。

### 3.4 知识源与条目（改造 KnowledgeBase，新增）

```
KnowledgeSource {
  id, projectId
  role        RoleType
  kind        SourceKind   // LOCAL_MARKDOWN | EXTERNAL（Notion/Confluence 等）
  rootPath    String?      // 本地根目录
  adapter     String?      // 外部源适配器标识
  syncMode    String       // INDEX_ONLY（默认）
}

KnowledgeEntry {              // 只存索引，不存正文
  id, sourceId
  externalId  String        // 来自 front-matter 的 id（路径哈希）
  title       String
  path        String
  contentHash String
  anchors     String[]      // 挂靠的需求 code 列表
  status      EntryStatus   // APPROVED | DRAFT（DRAFT 不进上下文）
  updatedAt
}
```

同步契约：`workmesh sync` 只上报 `{externalId, title, path, contentHash, anchors, updatedAt}`，**正文字段不存在于接口中**。

### 3.5 SignOff（新增，统一签字）

```
SignOff {
  id
  targetType  String   // REQUIREMENT | TASK
  targetId    String
  gate        String   // PRD | DESIGN | CODE | TEST | RELEASE
  source      String   // PLATFORM | PR_REVIEW
  actorId     String
  evidenceUrl String?  // PR review 链接
  createdAt
  supersededBy String? // 更正以追加新记录实现，不删旧记录
}
```

- `PR_REVIEW` 来源由 webhook 写入，需含 reviewer、approve 时间、任务编号三要素；
- 签字不可撤销，反向更正通过 `supersededBy` 追加。

### 3.6 ChangeEvent（新增，变更传播）

```
ChangeEvent {
  id, requirementId
  version     Int         // 触发变更的需求版本
  changedFields String[]
  targets     Json        // 受影响的知识条目/任务/工件 + 所属角色
  acks        Json        // 各角色的确认状态
  createdAt
}
```

产品定稿新版本 → 生成 ChangeEvent → 按挂靠关系推送到各角色 → 角色确认或更新后回填 `acks`。

### 3.7 TraceLink 扩展

在现有多态 `(sourceType, sourceId, targetType, targetId, linkType)` 上增加类型：

- `knowledge_entry ↔ requirement`（挂靠边，变更传播的基础）
- `task ↔ requirement`、`commit ↔ task`、`pull_request ↔ task`
- `artifact ↔ requirement`

## 4. 桥接器接口

### 4.1 命令面

| 命令                            | 作用                                                                                               | 使用者     |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ---------- |
| `workmesh init --role <role>`    | 初始化本地工作区，下发 `.workmesh/` 规范与目录骨架（规范源在仓库根 `spec/`，版本见 `spec/VERSION`） | 人（一次） |
| `workmesh ready --json`          | 返回本角色未被阻塞的任务队列                                                                       | agent      |
| `workmesh context <CODE> --json` | 拉取上下文包                                                                                       | agent      |
| `workmesh deliver`               | 提交工件（本地 schema 自检后上传指针与校验结果）                                                   | agent      |
| `workmesh sync`                  | 上报本地知识索引与挂靠关系                                                                         | agent      |
| `workmesh sign <taskId>`         | 签字关门（代码任务须带已合并且 APPROVED 的 PR）                                                    | 人         |
| `workmesh ack <eventId>`         | 确认需求变更已处理                                                                                 | 人/agent   |

原则（对齐 beads）：**默认非交互、输出可 JSON 解析、ID 稳定防冲突**。

### 4.2 上下文包结构（示例）

```json
{
  "code": "YFF-REQ-123",
  "status": "DESIGN_READY",
  "source": {
    "title": "支持本地模型接入",
    "prdVersion": 3,
    "acceptance": ["可通过配置切换到本地模型", "无 key 时给出明确提示"],
    "authority": "product"
  },
  "artifacts": [
    {
      "kind": "DESIGN",
      "role": "UI",
      "uri": "designs/YFF-REQ-123-settings.png",
      "status": "approved"
    }
  ],
  "tasks": [{ "code": "YFF-REQ-123-T01", "role": "BACKEND", "status": "OPEN", "blockedBy": [] }],
  "localKnowledge": [
    {
      "externalId": "k-8f3a2c",
      "title": "AI provider 适配层约定",
      "path": "knowledge/backend/ai-provider.md"
    }
  ],
  "evidence": [{ "type": "commit", "ref": "a1b2c3d", "task": "YFF-REQ-123-T01" }],
  "rules": {
    "onConflict": "product source wins",
    "mustIncludeAnchor": "YFF-REQ-123",
    "cannotSetDone": true
  }
}
```

`localKnowledge` 只给**指针**，正文由本地 agent 自行读取——这是"内容留在本地"的关键实现。

### 4.3 MCP 暴露

同一套能力以 MCP 工具暴露，供不支持 CLI 的 agent 调用：

- `workmesh.ready`、`workmesh.context`、`workmesh.deliver`、`workmesh.sync`、`workmesh.ack`

## 5. 校验与推进流程

1. agent 执行 `workmesh ready` 取任务 → 置 `IN_PROGRESS`
2. `workmesh context` 取上下文 → 本地生产
3. `workmesh deliver` → **本地 schema 自检**（锚点、必填字段、格式）→ 上传指针 + 校验结果
4. 平台侧二次校验 → 不通过则拒收并回执失败项
5. 任务置 `REVIEW_PENDING`（agent 无法置 DONE）
6. 签字：代码环节由 PR review webhook 写入，其余环节平台内签字
7. 关联任务全部 DONE + 各环节签字齐全 → 需求状态门放行

## 6. 落地步骤（建议顺序）

| 步骤 | 内容                                                  | 目的                         |
| ---- | ----------------------------------------------------- | ---------------------------- |
| S1   | 需求编号改造（`seq` + `code`）、项目 key 不可变       | 一切锚定的前提               |
| S2   | `Task` + `TaskDependency` + 桥接器 `ready/context`    | 让 agent 能拉到活和上下文    |
| S3   | `KnowledgeSource`/`KnowledgeEntry` + `sync`（仅索引） | 建立挂靠关系，为变更传播铺路 |
| S4   | `Artifact` + schema 校验 + `deliver`                  | 规范可执行                   |
| S5   | `SignOff`（含 PR review 证据）                        | 状态门闭合                   |
| S6   | `ChangeEvent` + 变更传播                              | 杀手锏能力                   |
| S7   | Web 进度视图改造（项目维度看板）                      | 给人看                       |

**进度**：S1–S7 全部落地。知识索引只含指针；`workmesh deliver` 本地自检 + 平台二次校验，通过后任务自动进 `REVIEW_PENDING`；`workmesh sign` 由人关门，代码任务须带已合并且 APPROVED 的 PR 证据，签字后任务 DONE 并按角色梯队推进需求状态；PRD 全数审批通过后生成 `ChangeEvent`，按挂靠的知识与任务分角色推送，支持 `workmesh changes`/`ack`；`workmesh init --role` 把规范与工件 schema 下发到各角色工作区并写入 AGENTS.md / CLAUDE.md 入口；Web 新增「进度看板」（`GET /projects/:id/board`），按需求状态分列展示各角色签字与待确认变更。

**Dogfooding**：S1–S2 完成后，立即用一条真实需求（建议：本地模型接入）在自己机器上跑通"建需求 → 定稿 PRD → 拉上下文 → 编码 → commit 回链"，验证后再继续 S3 之后。

## 7. 待确认

1. 旧 `RequirementStatus` 枚举如何迁移（直接切换 vs 双写过渡）？
2. `Artifact.storage` 中 HOSTED 是否仅限 PRD，还是技术方案/设计说明也托管？
3. 外部知识源（Notion 等）是否纳入 v0.1，还是先只支持本地 Markdown？
4. 签字是否要求多人会签（如设计需产品+设计负责人双签）？
