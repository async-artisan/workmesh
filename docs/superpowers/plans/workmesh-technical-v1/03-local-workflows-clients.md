# 本地角色工作流、角色包与 CLI／Web 技术方案

日期：2026-11-01。状态：待实施的技术契约，本文不代表命令、宿主适配或页面已经可用。

本分册落实[总纲](../2026-11-01-workmesh-open-source-collaboration-plan.md)中的本地执行、项目流程定制与 S5 客户端闭环。身份、票据和能力判定以 [01-identity-permissions.md](01-identity-permissions.md) 为准；正式对象、上下文快照、任务、交付和门禁以 [02-domain-state-transactions.md](02-domain-state-transactions.md) 为准；代码托管证据以 [04-code-hosting-adapters.md](04-code-hosting-adapters.md) 为准。API 的精确路由与请求响应以 [05-api-contract.md](05-api-contract.md) 为准，实施任务与验证入口以 [06-development-tasks-and-verification.md](06-development-tasks-and-verification.md) 为准；本册不另起状态机。

**实施边界：** 保留 TypeScript CLI、NestJS、React 和当前模块化单体。产品、UI、前后端、测试、运维在本地 AI 中执行各自 SOP；平台存正式事实和版本，不运行本地工作流脚本。首版有 CLI 与 Web，不实现 MCP 服务、远程脚本、拖拽编排器或通用工作流 DSL。Spec Kit、BMAD、OpenSpec、Agent Skills 仅提供设计参考，不成为必装依赖。

## 1. 当前入口与需要替换的行为

本次静态阅读确认以下入口；它们是实施定位，不是 v1 通过证据：

| 现有文件 | 已见行为 | v1 落点 |
| --- | --- | --- |
| `apps/cli/src/index.ts` | `init`、密码 `login`、`ready`、按需求编号 `context`、指针式 `deliver`、`sign`、索引 `sync` | 保留 `init` 名称；认证改浏览器授权；补 claim/release 与任务快照；移除直接签字旁路 |
| `apps/cli/src/config.ts`、`client.ts` | 全局配置含 access/refresh token，工作区只读 cwd，401 自动 refresh | 新配置严格校验、向上发现、受限 AgentCredential 隔离；401 不刷新 HUMAN 凭据 |
| `apps/cli/src/spec.ts` | 六个角色常量；向两个规则文件替换标记块；资源依赖源码相对路径 | 动态 ProjectRole；选定宿主；自包含分发；安装锁与修改冲突保护 |
| `apps/cli/src/deliver.ts`、`knowledge.ts` | UTF-8 字符串摘要截为 16 hex；知识只上传本地索引 | 原始字节完整 SHA-256；知识正文经候选、人工发布后由平台托管 |
| `spec/SPEC.md`、`spec/roles/*.md` | 固定产品源头、固定角色流水线及旧命令 | 按新身份、知识、流程与门禁统一改写，不保留旧规则兼容开关 |
| `apps/web/src/pages/{Projects,Knowledge,Prds,Board,Profile}.tsx` | 已有项目表单、知识操作、PRD 版本/审批、看板与用户中心 | 复用页面和 Modal，增加准确版本、权限与独立确认交互 |

只保留用户熟悉的命令拼写不等于保留旧数据结构。无 `schemaVersion` 的旧配置、旧 `accessToken/refreshToken` 字段、旧 `sign` 和“本地 approved 即发布”均不进入 v1 执行路径；不自动删除旧文件或平台数据。

## 2. 版本、标识与摘要

这些版本各有职责，不能用一个 `version` 字段代替：

| 字段 | 定义 |
| --- | --- |
| `packageSchemaVersion` | 角色包 manifest 的结构版本，首版精确为 `1.0` |
| `version` | 角色包内容的严格 SemVer；稳定 `id` 不因标题、文件改名而变化 |
| `protocolVersion` | WorkMesh 本地桥接契约，首版精确为 `1.0`，不是 API 路径版本 |
| `schemaVersion` | 流程配置或本地配置的结构版本，首版 `1.0`；不能据此调用旧 `/api` |
| `WorkflowDefinitionRevision.revision` | 同项目、同 `workflowKey` 的不可变正整数修订序号 |
| `WorkflowInstance.version`、`Task.version` | 可变实例与任务的 CAS 版本，不是流程定义修订号 |
| `Artifact.schemaVersion` | 该工件格式版本，与包版本、HTTP API 版本分别校验 |

`roleKey` 引用 01 的 ProjectRole.key：`^[a-z][a-z0-9-]{0,47}$`，总长 1–48，例如 `product`、`ui`、`frontend`、`backend`、`qa`、`ops`。六个 key 是初始数据，不是运行时全局枚举。流程、步骤、槽位和资源 key 使用同一字符规则，各自命名空间内唯一。数据库对象 ID 使用服务端 UUID，不把本地目录名或需求展示编号当作 ID。

角色包的内置／项目scope、不可变版本及受控JSON资源上传由05第6.1节唯一确定；项目私有包不依赖实施者另选部署目录或任意远程安装。公共manifest和资源GET始终在 `/projects/:projectId/role-packages/:packageId/versions/:version` 之下，资源追加 `/resources/:resourceId`，不能把两个项目的同名包混为全局同一个对象。

文件正文、二进制、附件和角色包资源的 `sha256` 都是原始 bytes 的 SHA-256，64 位小写十六进制；不做 UTF-8 重编码、换行转换、trim 或截断。JSON 结构的规范化摘要则使用 02 约定的 canonical JSON：拒绝重复 key、非有限数和未支持字段后，按同一 canonicalizer 编码为 UTF-8 再算 SHA-256。两者明确分开；同一 PNG 不因尝试按文本解码而得到另一摘要。

流程修订 `digest` 覆盖 canonical `{definition,resolvedRoles,packageLocks,systemGates}`，其中包含 roleKey→ProjectRole.id 的发布时映射、确定包版本和系统门禁。提交的 JSON 排版不是正式 digest 来源。需要留存原始导入文件时另记 `sourceBytesDigest`，不能替代 `digest`。快照的 canonical manifest、正文原始字节和权限重检直接使用 02 的定义。

## 3. 角色包 manifest

### 3.1 JSON Schema

以下是 `RolePackageManifest` 的完整 v1 结构。实现使用 JSON Schema 2020-12 验证；表后的跨字段、文件与权限验证同样是接收条件。所有 object 均拒绝未知字段。SemVer 字符串还必须通过严格 SemVer 2.0 解析，拒绝 `v1`、省略 patch、数字预发布段前导零等非 SemVer 值。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:workmesh:role-package:1.0",
  "type": "object",
  "additionalProperties": false,
  "required": ["packageSchemaVersion", "id", "version", "protocolVersion", "title", "roleKey", "compatibility", "inputs", "outputs", "resources", "agentEntries"],
  "properties": {
    "packageSchemaVersion": { "const": "1.0" },
    "id": { "type": "string", "pattern": "^[a-z0-9]+(?:[.-][a-z0-9]+)*$", "maxLength": 120 },
    "version": { "$ref": "#/$defs/semver" },
    "protocolVersion": { "const": "1.0" },
    "title": { "type": "string", "minLength": 1, "maxLength": 120 },
    "roleKey": { "$ref": "#/$defs/roleKey" },
    "compatibility": {
      "type": "object", "additionalProperties": false,
      "required": ["minCliVersion", "maxCliVersionExclusive", "contractVersion"],
      "properties": {
        "minCliVersion": { "$ref": "#/$defs/semver" },
        "maxCliVersionExclusive": { "$ref": "#/$defs/semver" },
        "contractVersion": { "const": "1.0" }
      }
    },
    "inputs": {
      "type": "array", "maxItems": 32,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["key", "source", "kind", "required", "contractVersion"],
        "properties": {
          "key": { "$ref": "#/$defs/key" },
          "source": { "enum": ["TASK_SNAPSHOT", "PUBLISHED_KNOWLEDGE", "CANDIDATE_REVISION", "LOCAL_DRAFT"] },
          "kind": { "enum": ["CONTEXT", "UNDERSTANDING", "DECISION", "PRD", "KNOWLEDGE", "DESIGN", "IMPL", "CASES", "RELEASE"] },
          "required": { "type": "boolean" },
          "contractVersion": { "const": "1.0" }
        }
      }
    },
    "outputs": {
      "type": "array", "minItems": 1, "maxItems": 32,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["key", "channel", "kind", "contractVersion"],
        "properties": {
          "key": { "$ref": "#/$defs/key" },
          "channel": { "enum": ["CANDIDATE", "ARTIFACT"] },
          "kind": { "enum": ["UNDERSTANDING", "DECISION", "PRD", "KNOWLEDGE", "DESIGN", "IMPL", "CASES", "RELEASE"] },
          "contractVersion": { "const": "1.0" },
          "templateResourceId": { "$ref": "#/$defs/key" }
        }
      }
    },
    "resources": {
      "type": "array", "minItems": 1, "maxItems": 128,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["id", "kind", "path", "sha256", "byteLength", "mediaType"],
        "properties": {
          "id": { "$ref": "#/$defs/key" },
          "kind": { "enum": ["SOP", "TEMPLATE", "CHECKLIST", "REFERENCE", "AUXILIARY_SCRIPT", "AGENT_ENTRY"] },
          "path": { "type": "string", "minLength": 1, "maxLength": 240 },
          "sha256": { "$ref": "#/$defs/digest" },
          "byteLength": { "type": "integer", "minimum": 0, "maximum": 4194304 },
          "mediaType": { "type": "string", "minLength": 3, "maxLength": 100 }
        }
      }
    },
    "agentEntries": {
      "type": "array", "minItems": 1, "maxItems": 2,
      "items": {
        "oneOf": [
          {
            "type": "object", "additionalProperties": false,
            "required": ["host", "type", "resourceId", "adapterVersion"],
            "properties": {
              "host": { "const": "codex" },
              "type": { "const": "AGENTS_MD_POINTER" },
              "resourceId": { "$ref": "#/$defs/key" },
              "adapterVersion": { "$ref": "#/$defs/semver" }
            }
          },
          {
            "type": "object", "additionalProperties": false,
            "required": ["host", "type", "resourceId", "adapterVersion"],
            "properties": {
              "host": { "const": "claude-code" },
              "type": { "const": "CLAUDE_MD_POINTER" },
              "resourceId": { "$ref": "#/$defs/key" },
              "adapterVersion": { "$ref": "#/$defs/semver" }
            }
          }
        ]
      }
    }
  },
  "$defs": {
    "key": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,47}$" },
    "roleKey": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,47}$" },
    "digest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "semver": { "type": "string", "minLength": 5, "maxLength": 80 }
  }
}
```

`source=PUBLISHED_KNOWLEDGE` 只能使用 `kind=KNOWLEDGE`；`TASK_SNAPSHOT` 的 CONTEXT 指完整快照，其余 kind 指快照内准确修订；`CANDIDATE_REVISION` 仅允许 UNDERSTANDING/DECISION/PRD/KNOWLEDGE；`LOCAL_DRAFT` 是本地编辑输入，不因此进入共享上下文。ARTIFACT 输出只允许 PRD/DESIGN/IMPL/CASES/RELEASE；CANDIDATE 输出只允许 UNDERSTANDING/DECISION/PRD/KNOWLEDGE。输入、输出各自的 key 唯一，templateResourceId 必须引用 TEMPLATE。

### 3.2 包完整性、兼容和信任

1. `minCliVersion < maxCliVersionExclusive`；客户端版本落在半开区间内，协议精确支持 `1.0` 才允许正式提交。读取已有快照可降为只读，但不得伪装兼容后写入。
2. 包内资源id、path各自唯一，单资源≤4MiB、总原始bytes≤10MiB，JSON请求≤16MiB，与05相同。路径是包根下POSIX相对路径，拒绝绝对路径、驱动器前缀、反斜线、空段、点段、NUL、编码穿越和链接逃逸；typed JSON上传不接受zip或自动解压。先检查本地文件和路径，再验证byteLength及完整摘要。CLI不从cwd同名spec回退加载。
3. 每个 host 最多一个 entry，resourceId 必须引用 AGENT_ENTRY；entry 只生成到适配器声明的 `AGENTS.md` 或 `CLAUDE.md` 管理块，manifest 不能自选用户主目录、覆盖目标或可执行命令。
4. `packageDigest = sha256(canonical(manifest))`；manifest 内已包含资源原始字节摘要，锁同时保留 manifest digest 和每个资源摘要。发布后的同 id+version 不得换内容；变更必须升 SemVer。验证摘要保证完整性，不宣称实现供应链签名。
5. 项目发布配置引用的平台包目录只接收有权维护者明确登记的 manifest 与资源。Agent 可建议本地包，不能把任意下载 URL 变成可信项目包。首版不动态安装远程插件，也不执行 npm 包的 postinstall、manifest hook 或包内脚本。
6. `AUXILIARY_SCRIPT` 是供人检查后单独选择的本地资源，不是工作流 step 的执行类型。调用仍需宿主及用户明确授权，不能由安装、context 或 deliver 顺便执行。包中的 `allowed-tools`、persona、命令正文不授予平台能力。

默认包使用稳定 id，例如 `workmesh.product`、`workmesh.backend`。新增项目业务角色可发布该 roleKey 的包；不能将后台硬编码六角色当作校验白名单。角色 SOP、模板、自检列表与宿主 entry 分开存储；两宿主共享内容来源，但 entry 各自适配。

## 4. 项目流程定义：有界 DAG，不是执行 DSL

### 4.1 可表达范围与 immutable revision

发布请求为 `{expectedVersion:Project.version,definition,packageLocks,expectedCurrentRevision,confirmation}`，携带01/05的票据和幂等头。首次expectedCurrentRevision为0，表示无发布指针而非允许CAS版本0；之后等于当前revision。服务端完成结构、角色、包和图验证后，同事务追加不可变WorkflowDefinitionRevision、更新指针和Project.version。失败不留半份修订；标题修改也产生新revision，不能PATCH／DELETE已发布定义。精确路由与validate响应见05第6.2节。

根对象采用 02 的 `ProjectWorkflowDefinition{id,projectId,workflowKey,currentPublishedRevisionId,version,archivedAt,createdAt,updatedAt}`；`(projectId,workflowKey)` 唯一。修订采用 `WorkflowDefinitionRevision{id,projectId,definitionId,revision,digest,definition,compiledRules,createdByStampId,createdAt}`。`compiledRules={resolvedRoles,packageLocks,systemGates}`，发布时由服务器计算；revision 及当前指针的 CAS、审计事件在同一事务提交，不另造可改写的批准记录。

`resolvedRoles` 包含发布时实际引用的 `{roleKey,roleId}`；roleSlot 的 requiredRoleId 由此编译，不接受客户端提交任意 ID 映射。`packageLocks` 每项为 `{roleKey,packageId,version,packageDigest}`，引用的包必须与 roleKey 一致、协议兼容且覆盖该角色步骤的输入/输出。`systemGates` 是服务端计算结果，不是可被用户覆盖的请求字段。digest 仍按本册第2节把三个 compiledRules 子字段与 definition 组成同一 canonical 对象，不能用数据库封装层变化悄悄换摘要算法。

首版最多 32 步，64 个 reviewer 槽、每步最多 8 个 gate、每 gate 最多 16 个槽；无循环、条件表达式、动态展开、OR、脚本、HTTP 调用或远程 command。`deps` 是 AND 关系；多个无相互依赖的步骤可并行。返修不会向图加入回边，而是由 02 的正式 reopen/changes-requested 机制产生新轮次并重评既有依赖。

### 4.2 WorkflowDefinition JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:workmesh:workflow-definition:1.0",
  "type": "object", "additionalProperties": false,
  "required": ["schemaVersion", "protocolVersion", "workflowKey", "title", "baseRevisionId", "roleExclusions", "stepRemovals", "roleSlots", "steps"],
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "protocolVersion": { "const": "1.0" },
    "workflowKey": { "$ref": "#/$defs/key" },
    "title": { "type": "string", "minLength": 1, "maxLength": 120 },
    "baseRevisionId": { "anyOf": [{ "type": "null" }, { "type": "string", "format": "uuid" }] },
    "roleExclusions": {
      "type": "array", "maxItems": 64,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["roleKey", "reason"],
        "properties": {
          "roleKey": { "$ref": "#/$defs/roleKey" },
          "reason": { "type": "string", "minLength": 1, "maxLength": 1000 }
        }
      }
    },
    "stepRemovals": {
      "type": "array", "maxItems": 32,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["stepKey", "reason"],
        "properties": {
          "stepKey": { "$ref": "#/$defs/key" },
          "reason": { "type": "string", "minLength": 1, "maxLength": 1000 }
        }
      }
    },
    "roleSlots": {
      "type": "array", "minItems": 1, "maxItems": 64,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["key", "roleKey", "kind"],
        "properties": {
          "key": { "$ref": "#/$defs/key" },
          "roleKey": { "$ref": "#/$defs/roleKey" },
          "kind": { "enum": ["UNDERSTANDING_CONFIRM", "PRD_PUBLICATION", "TASK_ACCEPTANCE", "RELEASE_ACCEPTANCE"] }
        }
      }
    },
    "steps": {
      "type": "array", "minItems": 1, "maxItems": 32,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["key", "roleKey", "kind", "baselinePolicy", "outputKinds", "candidateKinds", "deps", "gates"],
        "properties": {
          "key": { "$ref": "#/$defs/key" },
          "roleKey": { "$ref": "#/$defs/roleKey" },
          "kind": { "enum": ["PRODUCT", "DELIVERY", "VERIFY", "RELEASE"] },
          "baselinePolicy": { "enum": ["NONE", "PUBLISHED_PRD"] },
          "outputKinds": { "type": "array", "maxItems": 5, "uniqueItems": true, "items": { "$ref": "#/$defs/artifactKind" } },
          "candidateKinds": { "type": "array", "maxItems": 4, "uniqueItems": true, "items": { "$ref": "#/$defs/candidateKind" } },
          "deps": { "type": "array", "maxItems": 31, "uniqueItems": true, "items": { "$ref": "#/$defs/key" } },
          "gates": { "type": "array", "minItems": 1, "maxItems": 8, "items": { "$ref": "#/$defs/gate" } }
        }
      }
    }
  },
  "$defs": {
    "key": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,47}$" },
    "roleKey": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,47}$" },
    "artifactKind": { "enum": ["PRD", "DESIGN", "IMPL", "CASES", "RELEASE"] },
    "candidateKind": { "enum": ["UNDERSTANDING", "DECISION", "PRD", "KNOWLEDGE"] },
    "gate": {
      "type": "object", "additionalProperties": false,
      "required": ["key", "kind", "outputKinds", "candidateKinds", "reviewerSlots", "mode"],
      "properties": {
        "key": { "$ref": "#/$defs/key" },
        "kind": { "const": "HUMAN_APPROVAL" },
        "outputKinds": { "type": "array", "maxItems": 5, "uniqueItems": true, "items": { "$ref": "#/$defs/artifactKind" } },
        "candidateKinds": { "type": "array", "maxItems": 4, "uniqueItems": true, "items": { "$ref": "#/$defs/candidateKind" } },
        "reviewerSlots": { "type": "array", "minItems": 1, "maxItems": 16, "uniqueItems": true, "items": { "$ref": "#/$defs/key" } },
        "mode": { "const": "ALL" }
      }
    }
  }
}
```

### 4.3 必须同时实现的语义验证

JSON Schema 不能单独证明图与业务可行；`validateWorkflowDefinition` 必须返回结构化问题 `{code,jsonPointer,message}`，顺序按 jsonPointer/code 稳定排序：

| 验证 | 精确定义与拒绝代码 |
| --- | --- |
| 身份与角色 | 所有 step、slot、exclusion 的 roleKey 在该项目存在且 ACTIVE；未知/他项目返回 `WORKFLOW_UNKNOWN_ROLE`。roleKey 只编译为本项目稳定 roleId；不能把角色标题当 key |
| key 与重复 | steps、slots、每步 gates 的 key 各自唯一；deps/slots/kinds 不重复；空白 title/reason 视为空。重复为 `WORKFLOW_DUPLICATE_KEY` |
| 图 | deps 必须指向本定义内现存步骤且不得自依赖；引用不存在为 `WORKFLOW_UNKNOWN_DEPENDENCY`，拓扑排序不能覆盖全部节点为 `WORKFLOW_CYCLE` |
| 汇聚 | 恰好一个 `kind=RELEASE`；该步骤 outputKinds 精确为 `["RELEASE"]`、candidateKinds 为空；任何活跃步骤都必须有向路径通向 release。孤立终点为 `WORKFLOW_UNREACHABLE_RELEASE`，不能靠未使用步骤制造“流程已完成” |
| 基线 | PRODUCT 可以 NONE 或 PUBLISHED_PRD；其余必须 PUBLISHED_PRD。NONE 的 PRODUCT 不能声明 IMPL/DESIGN/CASES/RELEASE；仅候选型步骤也可形成正式检查点。违例 `WORKFLOW_BASELINE_REQUIRED` |
| 输出 | 每步 outputKinds 与 candidateKinds 至少一个非空；outputKinds 是本步骤必须交付的工件类型，candidateKinds 是允许登记的中间候选类型；被 gate 引用的候选是本步骤必需检查点。每种必需工件都至少有一个覆盖它的 HUMAN_APPROVAL gate，拒绝 `WORKFLOW_UNGATED_OUTPUT` |
| gate 引用 | gate 的 outputKinds/candidateKinds 至少一个非空，均须为该 step 已声明的类型，reviewerSlots 均存在。引用错误 `WORKFLOW_GATE_TARGET_INVALID`；未使用 roleSlot 也拒绝，避免配置看似有审批却没有生效 |
| 审批 qualifier | UNDERSTANDING_CONFIRM 只覆盖 UNDERSTANDING 候选；PRD_PUBLICATION 只覆盖 PRD 候选；TASK_ACCEPTANCE 只覆盖非 RELEASE 工件；RELEASE_ACCEPTANCE 只覆盖 RELEASE 工件。一个 gate 的所有槽必须与其目标同类；混用或知识发布借用任务槽返回 `WORKFLOW_APPROVAL_QUALIFIER_INVALID` |
| 审批模式 | v1 只接受 ALL，不支持 ANY、人数阈值、local approved 或 bot 自动 approve。运行时每个槽独立保存决定；同一人可绑定多个槽，但须分别确认，不能一条决定补齐全部槽 |
| 发布门 | release 必有 RELEASE_ACCEPTANCE 的 ALL 槽，不能借普通 TASK_ACCEPTANCE 放行。缺失为 `WORKFLOW_RELEASE_GATE_REQUIRED`；RELEASE 不是 ops 角色别名，自定义有权角色也可承担 |
| 实现门 | 任何 step 声明 IMPL，编译器加入不可编辑的 `systemGates[{stepKey,kind:"CODE_REVIEW_EVIDENCE",required:true}]`。客户端若提交 systemGates、codeReviewRequired=false 或可执行 action，按未知字段拒绝。实际有效他人评审、当前源提交与合并证据由 02/04 检查，不因本地规则、角色或标题改变而取消 |
| 裁剪 | 与 baseRevisionId 对比，删除的每个 step 必须恰有一条 stepRemovals 理由；不得列不存在的删除项。删后重新校验全部 deps、gate、汇聚和 scope。被完全移除的原参与 role 须列 roleExclusions 理由；新增首版同样须明确本次裁剪的角色，不以“没有任务”作为自动豁免。违例 `WORKFLOW_REMOVAL_REASON_REQUIRED` |
| 适用范围 | roleExclusions 不得含仍被 step/slot 使用的角色；激活交付步骤时，完整流程须覆盖 Requirement 当前已人工确认 deliveryScope.participatingRoleIds 和 requiredOutputKinds，排除角色理由与确认 scope 一致。少产物或删 IMPL 掩盖已授权实现范围为 `WORKFLOW_SCOPE_MISMATCH` |
| 包契约 | 每个执行角色有确定 package lock；该包允许的输出覆盖 step 输出，必需输入可由其 baselinePolicy 与依赖提供；版本、角色、缺少模板或摘要不匹配为 `WORKFLOW_PACKAGE_INCOMPATIBLE` |

definition始终是完整定义，不应用猜测式数组合并。首次发布可以baseRevisionId=null；以现存模板修订起步时指定该项目可读的准确已发布修订。后续发布baseRevisionId必须等于该workflow当前currentPublishedRevisionId，不能改成null绕过删除理由；stepRemovals精确对比它，不对比当前目录里可能升级过的默认包。原因进入发布摘要及审计；裁剪后的模板仍要经OWNER/ADMIN在Web独立确认。

### 4.4 合法流程 JSON

这是已明确不含独立 UI/前端交付的后端需求样例，项目有 product/backend/qa/ops 角色及对应包；实例激活时还须与该需求确切 PRD 的 deliveryScope 一致。它演示理解确认与 PRD 发布先于交付，但不将产品的全部本地动作塞入中心图。

```json
{
  "schemaVersion": "1.0",
  "protocolVersion": "1.0",
  "workflowKey": "backend-change",
  "title": "后端变更协作",
  "baseRevisionId": null,
  "roleExclusions": [
    { "roleKey": "ui", "reason": "此次交付不改变界面或视觉状态" },
    { "roleKey": "frontend", "reason": "此次交付没有前端代码范围" }
  ],
  "stepRemovals": [],
  "roleSlots": [
    { "key": "understanding-owner", "roleKey": "product", "kind": "UNDERSTANDING_CONFIRM" },
    { "key": "prd-owner", "roleKey": "product", "kind": "PRD_PUBLICATION" },
    { "key": "backend-accept", "roleKey": "backend", "kind": "TASK_ACCEPTANCE" },
    { "key": "qa-accept", "roleKey": "qa", "kind": "TASK_ACCEPTANCE" },
    { "key": "release-owner", "roleKey": "ops", "kind": "RELEASE_ACCEPTANCE" }
  ],
  "steps": [
    {
      "key": "understand", "roleKey": "product", "kind": "PRODUCT", "baselinePolicy": "NONE",
      "outputKinds": [], "candidateKinds": ["UNDERSTANDING", "DECISION"], "deps": [],
      "gates": [{ "key": "understanding", "kind": "HUMAN_APPROVAL", "outputKinds": [], "candidateKinds": ["UNDERSTANDING"], "reviewerSlots": ["understanding-owner"], "mode": "ALL" }]
    },
    {
      "key": "prd", "roleKey": "product", "kind": "PRODUCT", "baselinePolicy": "NONE",
      "outputKinds": [], "candidateKinds": ["PRD", "DECISION", "KNOWLEDGE"], "deps": ["understand"],
      "gates": [{ "key": "publish-prd", "kind": "HUMAN_APPROVAL", "outputKinds": [], "candidateKinds": ["PRD"], "reviewerSlots": ["prd-owner"], "mode": "ALL" }]
    },
    {
      "key": "implement", "roleKey": "backend", "kind": "DELIVERY", "baselinePolicy": "PUBLISHED_PRD",
      "outputKinds": ["IMPL"], "candidateKinds": [], "deps": ["prd"],
      "gates": [{ "key": "accept-impl", "kind": "HUMAN_APPROVAL", "outputKinds": ["IMPL"], "candidateKinds": [], "reviewerSlots": ["backend-accept"], "mode": "ALL" }]
    },
    {
      "key": "verify", "roleKey": "qa", "kind": "VERIFY", "baselinePolicy": "PUBLISHED_PRD",
      "outputKinds": ["CASES"], "candidateKinds": [], "deps": ["implement"],
      "gates": [{ "key": "accept-tests", "kind": "HUMAN_APPROVAL", "outputKinds": ["CASES"], "candidateKinds": [], "reviewerSlots": ["qa-accept"], "mode": "ALL" }]
    },
    {
      "key": "release", "roleKey": "ops", "kind": "RELEASE", "baselinePolicy": "PUBLISHED_PRD",
      "outputKinds": ["RELEASE"], "candidateKinds": [], "deps": ["verify"],
      "gates": [{ "key": "accept-release", "kind": "HUMAN_APPROVAL", "outputKinds": ["RELEASE"], "candidateKinds": [], "reviewerSlots": ["release-owner"], "mode": "ALL" }]
    }
  ]
}
```

其中 UNDERSTANDING_CONFIRM 只确认理解；PRD_PUBLICATION 最后一槽批准后才在同一事务发布该准确 PRD revision，并确认它的 deliveryScope。产品前两步可用 `ArtifactSet.items=[]` 与准确 `candidateRevisionIds` 形成检查点；由正式 gate evaluator 完成相应任务，不造空 PRD 文件、不要求先有发布 PRD 才能理解需求。知识候选的发布走知识库独立权限与 KNOWLEDGE_PUBLICATION，不借产品槽顺带发布。

### 4.5 非法流程 JSON 与稳定错误

下面是结构合法、业务非法的完整 JSON：只有 RELEASE 输出，却把普通任务验收槽当作发布批准。即使操作者是管理员也不能按此发布。

```json
{
  "schemaVersion": "1.0", "protocolVersion": "1.0",
  "workflowKey": "bad-release", "title": "错误发布槽", "baseRevisionId": null,
  "roleExclusions": [], "stepRemovals": [],
  "roleSlots": [{ "key": "ordinary", "roleKey": "ops", "kind": "TASK_ACCEPTANCE" }],
  "steps": [{
    "key": "release", "roleKey": "ops", "kind": "RELEASE", "baselinePolicy": "PUBLISHED_PRD",
    "outputKinds": ["RELEASE"], "candidateKinds": [], "deps": [],
    "gates": [{ "key": "wrong", "kind": "HUMAN_APPROVAL", "outputKinds": ["RELEASE"], "candidateKinds": [], "reviewerSlots": ["ordinary"], "mode": "ALL" }]
  }]
}
```

期望问题至少为 `/steps/0/gates/0` 的 `WORKFLOW_APPROVAL_QUALIFIER_INVALID` 和 `/steps/0/gates` 的 `WORKFLOW_RELEASE_GATE_REQUIRED`；错误集合必须确定，不因遍历顺序只显示其中之一。测试再从合法 fixture 生成以下最小变体：prd.deps 加 implement 形成环；roleKey 改未注册角色；删除 implement 却保留 verify.deps；删除步骤却不写 stepRemovals；新加无通向 release 的步骤；mode 改 ANY；向 PRODUCT/NONE 加 IMPL；移除 system code gate 的未知字段。每项均有单独期望 code，不能仅断言 HTTP 非 200。

## 5. 流程实例、绑定与本地进度

WorkflowDefinitionRevision 是模板；WorkflowInstance 归属于 requirementId，保存选定 definitionRevisionId、definition digest、version、workStatus 和准确绑定。Task 保存 workflowInstanceId+workflowStepKey，执行状态、工作状态、当前输入有效性分别由 02 定义。平台不从本地“stage=P4”猜需求阶段。

实例创建或变更绑定的语义输入为：

```json
{
  "definitionRevisionId": "11111111-1111-4111-8111-111111111111",
  "expectedRequirementVersion": 3,
  "stepBindings": [
    { "stepKey": "understand", "roleId": "22222222-2222-4222-8222-222222222222", "responsibleUserId": "33333333-3333-4333-8333-333333333333" }
  ],
  "roleSlotBindings": [
    { "slotKey": "understanding-owner", "roleId": "22222222-2222-4222-8222-222222222222", "userId": "33333333-3333-4333-8333-333333333333" }
  ]
}
```

这个片段只展示角色绑定格式，完整请求还必须覆盖所有step/slot，并按05在stepBindings提供repositoryIds：IMPL步骤至少一个当前项目代码仓库，非代码步骤可为空。仓库范围由有权HUMAN固定到TaskRepository，不能在交付时缩小。roleId必须等于发布编译映射，每个审批人当前有该角色；同人多槽分别决定，IMPL作者／Bot不能充当外部他人评审。没有合法审批人时拒绝激活，不自动跳过。

responsibleUserId 是交接/通知责任，不是 claim 执行主体。claim 的 PrincipalStamp 由认证上下文派生；body 不允许任意 principalId。认领持久有效，只有责任人或有权管理员显式 release；无心跳过期自动接管、无限轮询接单或恢复后自动重跑外部动作。

首次实例在 PRD 发布前只开放 PRODUCT/NONE；交付步骤激活前必须有当前已确认 deliveryScope，完整定义覆盖其参与角色和产物。修订升级对在途实例不自动生效；显式切换需要当前 version、目标 revision、影响说明及 Web 管理确认，重建受影响 task/gate 关系、废止相关 claim 并重核基线，不复制旧 APPROVED 作为新结论。

本地 `.workmesh/local/runs/<localRunId>.json` 使用独立格式：

| 字段 | 定义 |
| --- | --- |
| `schemaVersion`、`localRunId` | `1.0` 与本地随机 UUID，不当作平台 Run/任务 ID |
| `workflowInstanceId`、`taskId`、`workflowStepKey` | 已知时关联正式对象，否则 null |
| `packageLockDigest`、`host` | 本次所用包锁和 `codex\|claude-code` |
| `lastSeenCheckpoint` | `{taskVersion,claimId,snapshotId,artifactSetId,reviewRequestIds,observedAt}`，只缓存平台返回，不宣告当前仍有效 |
| `localSteps` | `[{key,status:"NOT_STARTED\|IN_PROGRESS\|DONE",notePath?}]`，仅本地详细进度 |
| `draftPaths` | 用户明确选定的本地草稿，不随平台请求自动上传 |

恢复顺序固定为：加载本地定位 → 验证包锁 → 联网读正式检查点和当前权限 → 核对 claim/快照/变更 → 呈现差异 → 继续本地生产或重新认领。离线只允许读已缓存内容并显式标记 `freshness=UNKNOWN`、编辑本地草稿；不能离线发布、交付、批准或宣称依赖仍有效。`FETCHED`、`PRESENTED_TO_AGENT` 最多是输入取得与提供的客户端记录，不证明 Agent 阅读、更不证明遵循；最终要检验产物。

## 6. 定制层次与允许覆盖的字段

规则解析顺序为“默认角色包 → 项目已发布 revision → 个人 advisory”。平台身份、安全、知识授权与门禁先行且不可覆盖。

| 层次 | 可配置字段 | 禁止内容 |
| --- | --- | --- |
| 默认包 | 本章 manifest、SOP、模板、自检方法、两种声明宿主入口 | 凭据、客户知识、自动执行 hooks、把 persona 变成权限 |
| 项目发布定制 | 完整 WorkflowDefinition、packageLocks；SOP追加、模板替换和检查表增补放入该角色的项目定制包新版本，通过 manifest 的 SOP/TEMPLATE/CHECKLIST 资源与输出引用表达 | 修改 Principal、scopes、知识库授权、ALL、系统代码证据或确认票据；删除默认/项目已有必需检查项而不走显式修订与门禁 |
| 个人 advisory | `locale:"zh-CN\|en"`、`verbosity:"concise\|normal\|detailed"`、`preferredHost:"codex\|claude-code"`、`editorHint`(≤120 字符)、`interactionNote`(≤1000 字符) | 覆盖 roleKey、输入/输出、deps、reviewerSlots、required 检查项、endpoint、上传范围、capabilities、任意脚本路径/执行器 |

项目定制不引入第二套任意JSON override：定制 SOP/模板/检查表生成新的项目私有 role package，沿用同一 manifest schema，packageLocks 指定它的稳定 id、准确版本和digest；可由项目发布者选择，不能覆盖同id+version原内容。模板替换必须仍满足相应输出 contract；所有引用资源进入已发布包锁，不从可变本地路径随时读最新版。默认与项目 required 检查项保留稳定 key，个人不得用 false/空值删除。个人 advisory 原文留本地，不因初始化、取上下文或切换宿主上传。提示词中出现“忽略审批”“上传全部聊天”不改变平台行为；客户端也不能把这些文字解释为执行指令。

## 7. CLI 配置发现、隔离与安装

### 7.1 Workspace 与 profile

工作区配置固定 `.workmesh/config.json`，只接受以下字段，拒绝未知项：

```json
{
  "schemaVersion": "1.0",
  "profile": "private",
  "platform": { "origin": "https://mesh.example.invalid", "apiBasePath": "/api/v1" },
  "projectId": "44444444-4444-4444-8444-444444444444",
  "roleKey": "backend",
  "repositoryId": null,
  "host": "codex",
  "workflowDefinitionRevisionId": null
}
```

schemaVersion、profile、platform、projectId、roleKey、host 必填；repositoryId 和 workflowDefinitionRevisionId 为 UUID 或 null。profile 是 1–48 字符小写字母/数字/连字符名；origin/basePath 按下述归一化；roleKey 使用统一正则。绑定的包版本与生成文件摘要保存在 `.workmesh/lock.json`，不是塞入未受校验的 config 扩展字段。任何 accessToken、refreshToken、password、secret、arbitrary provider 字段均拒绝。

用户配置根默认是 `~/.workmesh/`，可由显式 `--config-home <absolute-dir>` 改变；不从角色包正文或workspace任意字段改变秘密存储位置。profile 文件固定为该根下 `profiles.json`，结构 `{schemaVersion:"1.0",defaultProfile,profiles:{[name]:{platform,defaultProjectId?,defaultRoleKey?,personalAdvisory?}}}`，最多 64 个 profile；profile 名、platform 和 advisory 使用相同验证器，不含凭据。配置读取错误必须分清不存在、权限不足和 JSON 无效，不能 catch 一切后静默回到 localhost。

发现算法：

1. 从 `--dir`/当前目录的 realpath 向上找最近 `.workmesh/config.json`；到最近 Git worktree 根（含该根）停止，绝不越过它读取父仓库配置。普通 `.git` 目录、worktree `.git` 文件和嵌套仓库都测试。
2. 无 Git 根时最多走到文件系统根；遇第一个配置即停止。嵌套工作区的最近配置完全遮蔽外层，不把两项目的字段拼接。`--workspace <dir>` 则明确指定该目录，只读取它的 config，不继续向上猜测。
3. 先选 `--profile`，否则 workspace.profile，否则 defaultProfile；业务解析优先级是**显式参数 > 最近 workspace > 选定 profile 默认值**。未提供的 CLI option 不写 commander 默认值覆盖已发现配置；配置解析结果显示来源，不显示秘密。
4. 命令行指定另一平台/项目/角色只改变本次请求目标，不替换已存凭据或隐式修改 workspace。不存在完全匹配的受限凭据时要求重新授权，不能借已有 token 尝试跨域请求。

platform key 由 URL 解析后组成 `{origin,apiBasePath}`：scheme/hostname 小写、去默认端口和末尾 `/`；拒绝 userinfo、query、fragment、点段、编码分隔符与非 http(s)。正式 origin 必须 HTTPS，仅用户明确选择的 loopback 本地开发允许 HTTP；不把私网地址统称 localhost。apiBasePath 以 `/` 开头、以 `/api/v1` 结束，允许明确的反向代理前缀，且不含空段/点段。带凭据请求禁止跨 origin redirect，避免 Token 被重定向带走。

### 7.2 凭据与授权

`workmesh auth login` 遵循 01 的设备 proof 流程：本地先生成并安全保存 codeVerifier 与 credentialSecret，提交 S256 challenge 及 secret hash；服务端仅回 metadata，CLI 组合 `wm_a1.<credentialId>.<localSecret>`。Web 授权只选择一个 project、一个 role 和受限 scopes；CLI 绝不接收 HUMAN WebSession/refresh token，不提供 approve/签字参数，也不索取账号密码。

凭据索引 key 为 canonical `{origin,apiBasePath,userId,projectId,roleId}` 的 SHA-256，roleKey 是可读展示而非隔离唯一依据。v1 明确使用 Node 内置 fs 的 user-only file store，支持 macOS/Linux，不添加 keytar 或系统凭据库依赖。`auth login --credential-store file` 表示明确同意；未给该参数时，TTY先说明存储边界并请求一次同意，非TTY则拒绝。文件为 `<config-home>/credentials/<key>.json`，目录0700、文件0600；pending proof位于 `<config-home>/pending-authorizations/`，同样受保护。

读写先拒绝 symlink、非当前UID所有者和过宽权限，临时文件0600并原子rename；不修复/读取未知他人文件后继续。file store不宣称对同一OS用户加密隔离。Windows ACL适配不在首版实现或支持声明中，doctor与login返回 `HOST_OS_UNSUPPORTED`，不能以未实现的“等价ACL”承诺可用。pending proof不能写workspace、锁文件、receipt、Git、stdout或错误日志。

`auth status` 只显示origin、API base、userId、credentialId、project/role、scopes、到期时间、最近联网核验时间，不显示bearer、deviceCode、verifier或secret。`auth logout` 仅调用01的 `POST /auth/agent-credential/revoke-self`，body为 `{reason:"CLI logout"}`，不可指定其他credentialId；确认当前凭据自撤销后删除本地秘密。此入口只减权，不是通用凭据管理或人工批准。撤销其他凭据必须打开Web由有权HUMAN二验确认。离线 `--local-only` 必须提示“仅清除本地，服务端尚未撤销”；撤销响应丢失则保留安全metadata并提示到Web核对，不报告已全局登出。

设备授权初始有效期、5 秒 poll、429 Retry-After、10 分钟已签发 metadata 恢复窗口及精确路由以 01 为准。浏览器链接不含 deviceCode、verifier、credentialSecret、token 或 userCode query；人工可见的 userCode 只在登录提示中给出，不进入诊断/receipt。`--json` 时登录过程提示走 TTY stderr，stdout 只在终态输出一次无秘密结果。

### 7.3 安装、重复执行与升级

`workmesh init --role backend --project <id> --host codex --api <base>` 是保留的起步入口；`workmesh roles install` 作为同一安装服务的显式子命令别名。旧 init 无 schemaVersion 的结果不自动兼容：诊断为 `CONFIG_SCHEMA_UNSUPPORTED`，用户检查旧文件后显式重新初始化，不自动读取旧 token，也不自动删除旧文件。

包安装到 `.workmesh/packages/<id>/<version>/`，项目资源进入 `.workmesh/project/<definitionRevisionId>/`；它们是受管副本。`.workmesh/lock.json` 固定 `{schemaVersion,protocolVersion,packageLocks,workflowDefinitionRevisionId,projectResourceDigests,hostAdapters,managedFiles}`，managedFiles 是 `{path,sha256,kind}`；不含本地草稿、秘密或系统权限授权。草稿置于用户选定目录或 `.workmesh/drafts/`，管理文件不能与其重叠。本机受管副本、context、local progress/receipt默认不入仓库，init只在 `.git/info/exclude` 追加确切本机路径；不改业务 `.gitignore`，不暂存用户文件。用户配置与凭据始终在仓库外config-home。

安装先完整校验再构建 staging，最后同文件系统原子 rename 更新 lock/受管目录。相同版本和摘要重复 init 不修改 bytes/mtime；升级先输出变更计划，要求显式 `roles update --to <version>`，不自动升级在途实例。若旧受管文件当前摘要与锁不同，返回 `LOCAL_MANAGED_FILE_MODIFIED`，保留原件与锁，不使用 `--force` 静默覆盖；用户可导出本地修改，或选择另目录安装。

只为选定宿主生成入口。Codex 使用 AGENTS.md，Claude Code 使用 CLAUDE.md；均只写已声明管理块，其外 bytes 必须原样保留。管理块缺失时新增一个块；重复块、损坏标记或人工改动块与锁不符则冲突退出。包不能修改用户主目录规则。先从两宿主声明支持的规则入口入手，不将“入口已生成”写成“所有 Agent 都会自动加载/遵循”。实际宿主版本、入口识别、交付契约和续跑结果进入验收记录；未经实测的宿主仍标未验证。

分发包必须自包含；建议 `@workmesh/cli` npm files 白名单为 `dist/**`、`spec/**`、`roles/**`、`templates/**`、`schemas/**`、`role-packages.lock.json`、`README.md`、`LICENSE` 及 npm 必需 package metadata。构建将仓库规范复制为包内这些资源，运行仅从安装包解析，不能依赖 checkout 或 cwd。

发行前在全新临时目录 `pnpm --filter @workmesh/cli pack`，检查 tar 清单；禁止 `.env*`、`env*.ini`、`env_private*`、tempConfig、本机 memory/harness/Run、客户资料、workspace credentials、源码 sourcemap 中的秘密或完整仓库被带入。角色包资源只走同一 manifest 白名单；不使用 `**/*` 作为发行授权。MIT/第三方资源来源与许可随实际复用清单核对，不将参考项目全文无审查复制。

## 8. CLI 命令与 HTTP 语义

本表是**首版必须实现并验收的命令面**，不是现有代码能力清单。所有业务请求使用 `/api/v1`；只在共享业务服务内决定权限与状态，CLI 不自算批准。

| 命令 | 必需输入与效果 | 类型/权限边界 |
| --- | --- | --- |
| `init` / `roles install` | `--role --project --host`；平台、目录可由 profile/参数确定；校验并安装声明资源 | 只写明确本地受管范围；不联网授权、不执行脚本、不自动发布 |
| `roles validate --package <path>` | 验 manifest、资源路径/bytes/摘要与兼容性 | 只读本地；错误给 jsonPointer/code |
| `roles update --to <semver>` | 明确目标包版本，校验 lock 与用户修改 | 本地显式更新；不改变在途平台 revision |
| `auth login/status/logout` | 浏览器proof授权、显式file store同意；状态/当前凭据自撤销；`login` 可作 auth login 拼写别名 | 不保存HUMAN token；不支持 `--password`/`--actor-type`；不可借self-revoke撤销他人凭据 |
| `doctor` | 配置来源、当前 project/role、API/protocol、包锁、权限与宿主入口诊断 | 本地检查加只读 HTTP；`--offline` 标网络新鲜度 UNKNOWN；无自动修复/安装/发信 |
| `workflow list/show` | 项目流程列表，或 `--revision <id>` 读 immutable revision | 授权读取，不仅取“最新版” |
| `workflow validate --file <json>` | 本地完整语义检查；`--online` 用真实项目角色/包/基线补充验证 | validate 无持久写；Agent 可校验建议，正式发布只在 Web |
| `ready` | 当前 project/role，输出分页任务、version、依赖与阻塞原因 | GET 只读；不会认领、改状态或分配工作 |
| `claim --task <id> --expected-version <n>` | 原子认领，返回 claimId 与新 task version | 服务端派生主体；冲突不自动换人/任务 |
| `release --task <id> --claim <id> --expected-version <n> --reason <text>` | 以AGENT身份只释放本凭据认领，使旧claim失效 | 管理员强制接管必须转Web二验；CLI不伪装其授权人或别的凭据 |
| `context --task <id> --materialize` | POST 创建准确快照；校验全体 bytes 后原子落盘，返回 snapshotId | 创建有副作用；受当前读取权、任务与包 pin 约束 |
| `context --snapshot <id>` | GET 读指定准确快照；`--materialize` 仅物化它 | 读取不创建新快照；再次核验当前访问权限 |
| `knowledge submit --kb <id> --kind <candidateKind> --file <path>` | 选定正文/附件候选，明确 requirement/task 与来源引用 | 不递归扫聊天/目录；不发布；KNOWLEDGE/PRD 等按02候选契约校验 |
| `knowledge get --document <id> --revision <id> --out <path>` | 读取授权的指定修订正文与附件 | 只在 `--published` 明确请求时解析当前发布指针；结果返回确定revision |
| `deliver --task <id> --claim <id> --snapshot <id> --expected-version <n> --manifest <file>` | 提交 exact ArtifactSet、完整摘要、localRunId、包锁与自检证据 | 正式事务；最多 REVIEW_PENDING，不自动 DONE；见02准确payload |
| `review --task <id> --artifact-set <id>` | 创建统一 ReviewRequest，返回 reviewRequestId、槽、准确版本和 Web URL | Agent 只能请求；槽由服务端从 revision 导出，不接受自造通过结果 |
| `review --document-revision <id> --expected-version <n>` | 创建DOCUMENT_REVISION评审，服务端按kind派生理解确认／PRD发布／知识发布槽 | 可在没有workflow实例前请求候选评审；只请求、不批准，仍检查KB与当前发布前置条件 |
| `reviews show --id <id>` | 查询当前槽、决定、返修意见、有效性及针对版本 | GET，不执行 gate approve |
| `changes` | 当前 project/role 的收件事件，`--cursor` 稳定分页 | DB 先授权/收件人过滤；items/nextCursor/hasMore |
| `ack --event <id> --recipient <id> --expected-version <n>` | 当前责任人/当前角色逐槽确认处理 | ack 幂等，不恢复旧批准、不代其他角色确认 |
| `block --task <id> --expected-version <n> --reason <text> --resume-condition <text>` | 当前claim且clarification:write Agent登记阻塞；不变业务阶段 | 走02合法转换，必填责任与继续条件，不解除依赖门槛 |
| `pause/resume --task <id>` | 读取当前状态并返回对应Web操作链接，不产生正式状态写入 | PAUSE／RESUME／CANCEL由责任HUMAN或管理者在Web执行；CLI显示“待人工操作”而非已暂停／恢复 |
| `clarify --task <id> --file <json>` | 登记缺口、依据、影响、回答责任与继续条件 | 共享结构化澄清；不上传全部对话 |
| `receipts show --operation <uuid>` | 读取本地操作结果定位、digest 与未知结果提示 | 无秘密/敏感响应正文；不是可执行任意历史请求的调度器 |
| `receipts reconcile --operation <uuid>` | GET `/operation-receipts/:operationKey?projectId=<p>` 读取记录，再以安全metadata更新本地receipt | 只读业务；operationKey为原header key而非数据库PK，当前鉴权后只返回允许结果；他人operation统一404 |

`knowledge submit --kind` 仅 CANDIDATE 枚举；kind=PRD 的候选进入 PRD_PUBLICATION，kind=KNOWLEDGE 进入知识库发布权限。局部产品理解等用同一候选服务，CLI 名称不把它们都当成“已发布知识”。`deliver` 不接受 `actorType`、裸 `provider+number` 或 `--uri` 无 bytes/可信存储定位的旧指针交付。多仓库清单引用 projectRepositoryId、源提交和内部证据 ID；详细字段从02/04共享类型生成。

不提供 `sign`、`approve`、`set-status DONE/RELEASED`、隐式全量 `sync` 或通用任意 `api POST` 命令。撤销批准、发布/撤销知识、配置流程和凭据管理属于 Web 独立人工界面；首版 CLI 不借管理 scope 开旁路。若只提供 review Web 链接，结果必须写“已请求确认”，不能写“已批准”。

### 8.1 上下文落盘与草稿保护

`context --task --materialize` 先获取 snapshot manifest；正文按准确修订取 bytes 并校验长度、SHA 和当前权限，全部成功后原子发布到 `.workmesh/context/<snapshotId>/`。manifest、正文及 `input-receipt.json` 同一 staged tree，不混用不同下载批次；任一失败都不切换 `.workmesh/context/current.json`。路径由内部 ID/安全文件名构造，不信任服务器标题作文件路径。旧副本保留但标记历史，不覆盖 `.workmesh/drafts`、用户文件或当前 Agent 正在使用的输入。

显式选择当前快照也不意味着在途工作即时升级；修改输入需新快照、新检查/交付，受影响批准按02失效。权限撤销后，联网读取和正式动作闭门；平台不能追回用户已经合法复制到本机或外部工具的内容，此限制应直接说明。

### 8.2 输出、错误与重试

`--json` 的 stdout 恰好一份 JSON（一个对象和末尾换行），成功采用 `{data,meta:{requestId}}`；错误采用 `{error:{code,message,details?,requestId}}`。纯本地动作 requestId 为 CLI 生成的 UUID。日志、下载进度、浏览器授权引导和安全诊断只到 stderr；库函数不得 console.log。非 JSON 模式默认中文帮助/错误及下一步提示；`--lang en` 只改文案，不改 keys/codes。成功数据不打印 bearer、秘密、本地 proof 或无关受限内容。

| 退出码 | 含义 |
| --- | --- |
| `0` | 声明命令已完成；review 只代表请求已创建 |
| `2` | 参数、配置、schema 或本地输入验证失败 |
| `3` | AUTH_REQUIRED / AUTH_EXPIRED / AUTH_REVOKED；含 HTTP 401 |
| `4` | FORBIDDEN；含 HTTP 403，不泄露资源存在性 |
| `5` | VERSION_CONFLICT / CLAIM_CONFLICT / IDEMPOTENCY_CONFLICT；含对应409/412 |
| `6` | WORKFLOW_BLOCKED / STALE_INPUT / GATE_NOT_SATISFIED，需先处理业务条件 |
| `7` | 网络不可达、超时、重试耗尽；写操作可能结果未知 |
| `8` | CONTENT_INTEGRITY_FAILED / LOCAL_MANAGED_FILE_MODIFIED / PACKAGE_TAMPERED |
| `9` | 服务端5xx或响应协议不符合约定 |
| `130` | 用户中断；已经发出的写请求仍可能结果未知，保留receipt |

HOST_OS_UNSUPPORTED 属本地环境验证失败，退出码2，不得在不安全文件权限下继续。GET 最多三次请求，总 deadline 30 秒，单次 timeout 10 秒；只对连接中断、timeout、408、429、502、503、504 使用指数退避加 jitter，基础 250ms、上限 2s，Retry-After 存在则采用但不得越过 deadline。其它4xx不重试。POST/受保护写入只允许复用同 Idempotency-Key 和完全相同 requestDigest 的重试；不自动重跑任意外部命令，也不为冲突创建新键掩盖原请求。

所有正式候选、认领、释放、交付、评审请求、ack 与状态动作使用随机 UUID operationId 作为 Idempotency-Key。发请求前，原子写本地受保护 `.workmesh/local/receipts/<operationId>.json`：`{schemaVersion,operationId,scopeKey,credentialId,method,relativeRoute,requestDigest,sourceFiles:[{path,sha256,byteLength}],status:"PENDING|COMMITTED|REJECTED",resultRefs?,createdAt,updatedAt}`。scopeKey 对应 origin/base/project/role/credential，requestDigest 遵循02的幂等 canonical request 定义，包含语义 body 与 bytes digests，不含 bearer/证明秘密。ledger 不保存请求/响应正文、全部聊天、票据或可执行脚本。

进程内重试保留原始 body。进程崩溃或响应丢失后，先用 `receipts reconcile` 查询；不存在已提交结果且当前凭据仍有效时，以相同业务命令 `--operation <existing-id>` 加原输入/flags 恢复。只有当前 credentialId、scope 与重构 digest 完全一致才复用原 key。不同文件/flags返回本地 IDEMPOTENCY_CONFLICT，不能用同键重发新内容。服务器在当前授权通过后识别合法重放并返回原结果；未经授权不因旧 receipt 披露结果，其他principal的操作返回404。输入缺失时只能报告未知并查询正式对象，不猜测曾成功、不生成替代交付。receipt 仅保留安全 resultRefs（对象 ID/版本/状态），不是整段敏感响应。

重新 login 得到新 credentialId 不是旧 Principal，禁止自动拿新凭据重放旧键或自行换新键再提交。旧凭据过期后，由有权凭据所有者在 Web 只读查看其 Agent 的 receipt 和正式对象；核对是否已完成后，由用户决定是否发起新的业务意图。该只读恢复不授予 HUMAN 代旧AGENT重放的资格；也不引入泛型“执行历史HTTP”恢复器。

HTTP 401 立即停止本命令、标记所选凭据需重新授权，不自动 refresh、不切换别的 profile、不重复开浏览器；引导 `auth login`。403 不撤销本地 token 也不重试。正文 hash mismatch 不自动降级成指针；保留用户文件及必要脱敏错误。网络失败不会清除 PENDING receipt，也不输出确定成功/失败。

### 8.3 中文起步帮助

无参数 `workmesh` 和 `workmesh help start` 输出同一简明起步说明；机器模式只返回结构化提示，不混入 banner：

```text
WorkMesh 连接本地 AI 与项目协作事实，不替你自动批准。
1. workmesh init --project <id> --role <roleKey> --host codex --api <base>
2. workmesh auth login --credential-store file
3. workmesh doctor
4. workmesh ready --json
5. workmesh claim --task <id> --expected-version <version> --json
6. workmesh context --task <id> --materialize --json
按角色 SOP 本地生产；交付后用 review 请求 Web 人工确认。
修改角色、项目或平台需匹配的新授权；不要上传聊天、个人记忆或凭据。
```

## 9. Web：复用现有页面完成独立人工确认

本分册只规定最小交互，不另起整套 CRUD 管理台、流程设计器或新视觉系统。实现参考当前 `Projects.tsx` 的表单/Modal、`Prds.tsx` 的修订与审批弹窗、`Knowledge.tsx` 的候选/正文操作、`Board.tsx` 的项目看板和 `Profile.tsx` 的用户安全入口；进入编码时再核对工作区前端权威规则。

| 页面 | 增补与必须显示的事实 | 权限与禁止动作 |
| --- | --- | --- |
| Projects | ProjectRole 列表/人员角色分配；包与协议；导入完整流程 JSON、validate 错误定位、diff、裁剪理由与发布 revision；关联仓库展示 | OWNER/ADMIN 发布配置与分配角色，专业负责人维护候选 SOP；不得因能维护项目而自动获得受限知识读取权 |
| Knowledge | 候选与已发布视图区分；正文/附件准确 revision、摘要、来源、KB 授权；请求发布、撤销及受影响项 | KB READ/PUBLISH 分别判定；人独立确认准确候选；Agent/维护角色不能自授发布资格；不展示无权条目标题/片段 |
| Prds | 理解候选、决定落点与 PRD 修订区分；评审意见、确切版本diff、deliveryScope、PRD_PUBLICATION 显示“批准并发布” | 理解确认不自动批准 PRD；最后 ALL 槽统一发布当前确切revision；原型/实现的额外范围不因批准PRD自动授权 |
| Board | workflow revision、参与/裁剪角色、责任人、deps、phase、workStatus、inputValidity、claim、缺失门禁与下一接手人；ReviewRequest入口/返修/changes ack | 当前有效性与历史批准分开；无拖拽改阶段/手填DONE；代码证据用厂商中立连接/仓库/提交/评审/合并事实 |
| Profile | 当前 WebSession、AgentCredential 安全metadata、单凭据撤销/全量撤销入口；列出项目/角色/到期与scopes | 仅显示自己的或有权管理的凭据；不展示任何 token 明文、不提供复制HUMAN token给CLI功能 |
| `/cli/authorize` | userCode lookup、clientName、目标项目/角色/scopes预览、批准或拒绝 | 有效WebSession+密码二验票据；不接受URL中的token/userCode自动批准；当前身份只能授权自己有权的单project/role |

统一 ReviewRequest 详情可使用现有页面内 Modal/路由弹层，无须增加导航模块。进入确认时重新 GET 当前 subject/版本、槽、依赖、代码门禁和允许动作；显示不可变 artifactSet/snapshot/documentRevision、diff、业务目的及当前槽。用户明确选择当前业务槽、决定与必要意见，输入密码获得 01 的一次性 ConfirmationTicket，再发送准确 action digest 与 expectedVersion；`APPROVED` 以外也按该受保护动作契约执行。二验或结果失败时只保留非秘密表单，不保留密码/票据。

同一用户多槽只允许一次提交一个槽，不能“全选我的槽一键通过”。其他槽变化、revision更新或代码新提交使当前确认摘要过期，409后刷新并重新呈现差异，不能自动重用票据批准新版本。任何客户端 actorType=HUMAN 声明均无效，服务端只认有效 WebSession 与票据。知识发布、撤销、流程发布、凭据管理、外发授权分别使用01确定的 protected action，不用普通资源 PATCH 模拟。

禁用按钮不是权限证明：手造 HTTP 同样要被API拒绝。加载失败复用页面现有刷新/重新进入入口，不主动新增失败横幅、独立重试按钮或点击重试空态。Web状态和审批提示需对屏幕阅读器可见，版本冲突不丢用户已输入但尚未提交的意见。对待处理变更使用稳定游标分页，ack只确认该责任角色，不隐藏其他角色未确认项。

## 10. chanpingzhishiku 产品工作流接入

保留现有 Python 产品工作流的检索、澄清、理解、出稿和返修能力；写一个显式调用本地 CLI/共享 bridge contract 的适配层即可，不把 Python、SQLite、目录扫描或全部内部状态搬进中心。以下是未来适配映射，不运行现有脚本，也不导入现有客户资料。

| 产品侧字段/事件 | WorkMesh 映射 | 不能作出的推断 |
| --- | --- | --- |
| 本地需求编号、目录 | `externalRef:{source:"chanpingzhishiku",id}` 关联平台 requirementId，项目/需求ID由平台返回 | 本地编号不保证全局唯一；不能用目录生成他项目任务 |
| fact/assumption/unknown | UNDERSTANDING 候选结构化章节，显式 sourceRefs 与未决项 | 检索命中不等于已核实事实 |
| 有依赖澄清问题、回答人、答案、落实位置 | 05的dependencyIds、assignedUserId、impact、resumeCondition与resolutionRefs；Agent记录为PROPOSED，真正责任人CONFIRMED仍不替代PRD批准 | “已经答复”不等于决定已落实；行号引用只证明位置存在，不证明业务语义正确 |
| 理解版本、理解确认 | 精确 UNDERSTANDING revision + UNDERSTANDING_CONFIRM ReviewRequest | 本地 approved/复选框/口头摘要不能生成 HUMAN ApprovalDecision |
| PRD 草稿、原文摘要、评审轮次 | PRD 候选 revision、原始 bytes digest、localRunId 与候选关联；review意见绑定确切revision | 不能从已确认理解自动升级成已发布 PRD |
| 经用户授权的决定、验收与知识变更 | DECISION/KNOWLEDGE 候选；明确 requirement/task/sourceRefs、目标KB | 不全量上传聊天、私人记忆、原始源资料；候选不自动成为共享发布版 |
| PRD 本地 gate/pass | 仅 `validation.source="LOCAL_SELF_CHECK"` 自检证据 | 不是独立校验/人类批准，不切平台发布指针 |
| 评审修改任务、返修与恢复说明 | 平台ReviewRequest意见/Clarification引用和新的候选修订；恢复先读正式检查点 | 旧 review round/旧摘要不能批准新内容 |
| 本地暂停/撤回 | 本地暂停留progress；需要正式暂停／撤回时返回Web链接，由有权HUMAN执行，适配器只读回结果 | 不抹历史phase、不把撤回计为DONE，不把自然语言确认变成HUMAN凭据 |
| 原型、编码、上传和发布动作 | 单独 scope/任务/宿主或运行态授权 | PRD 通过不自动取得原型、代码或外部副作用授权 |

适配器持有的是用户授予的单项目、单角色 AgentCredential；获授权保存候选只表明可以登记该份内容。不得把本地用户名、环境变量、签字字段或人工对话文本映射为平台 HUMAN Principal/ConfirmationTicket；不得重放旧 Python “approve”伪造 Web 确认。平台批准是 Web 用户对准确版本的独立动作，适配器只轮询读取其结果。

现有源码阅读最多说明怎样调用已有能力，不能证明包一定触发或被遵循；同样，“已读取全部文档”不替代来源核对、产物检查和业务验收。输入提供、局部步骤完成、工件有效和业务阶段前进是四种证据。

## 11. 实施文件与可执行验收

以下是后续编码落点，本次只新增本文档：

| 文件/模块 | 单一职责 |
| --- | --- |
| `packages/shared/src/contracts/role-package.schema.json`、`workflow-definition.schema.json`、`workspace-config.schema.json` | 上述结构与严格unknown field验证；类型由同源生成/推导，不手写第二份enum |
| `packages/shared/src/workflow/validate.ts`、`compile.ts` | 有界DAG、qualification、scope/包校验与不可编辑systemGates；不执行脚本 |
| `apps/api/src/workflows/` | 项目读取、validate、发布 immutable revision 与实例编排；调用02服务处理正式检查点 |
| `apps/cli/src/config.ts`、`credentials.ts`、`client.ts` | 配置解析/来源、凭据存储、严格envelope/错误/幂等重试 |
| `apps/cli/src/roles.ts`、`spec.ts`、`hosts/{codex,claude-code}.ts` | 包验证、分发资源定位、安装锁/冲突、宿主入口 |
| `apps/cli/src/context.ts`、`receipts.ts` | 原始bytes验证与原子materialize、无秘密receipt及恢复 |
| `apps/cli/src/index.ts`、`commands/` | 仅命令参数/输出编排；不承载正式审批逻辑 |
| `spec/`、`roles/`、`templates/`、`schemas/` | 新规范、初始6角色包、模板与最终发行资源；内容不携公司业务资料 |
| `apps/web/src/api/resources.ts`、`client.ts` | 统一/v1 DTO/envelope、错误与CSRF/票据请求；不靠类型断言绕运行校验 |
| 现有5页面与共用 ReviewRequest/confirmation组件 | 上节最小交互；不新增平行审批状态机 |

实施必须增加以下 fixtures/tests；示例命令是届时运行入口，不是本次已运行结果：

| fixture / 测试文件 | 必须断言的结果 | 运行命令 |
| --- | --- | --- |
| `packages/shared/test/fixtures/workflows/{backend-valid,release-slot-invalid,cycle,unknown-role,removed-step,orphan-endpoint}.json`；`src/workflow/validate.test.ts` | 合法图编译稳定digest与code系统gate；非法图精确code/jsonPointer；同人多槽ALL不合并；无IMPL伪豁免 | `pnpm --filter @workmesh/shared exec vitest run src/workflow/validate.test.ts` |
| `packages/shared/src/workflow/compile.test.ts` | roleKey→roleId、包lock、systemGates任一改变必变digest；JSON排版/key顺序不影响canonical digest；未知字段/重复JSON key拒绝 | `pnpm --filter @workmesh/shared exec vitest run src/workflow/compile.test.ts` |
| `apps/cli/test/fixtures/packages/{valid,bad-sha,traversal,duplicate-host,script-resource}/`；`src/roles.test.ts` | 原始二进制hash、长度、路径、大小限制；script资源不执行；与角色/协议不匹配拒绝 | `pnpm --filter @workmesh/cli test -- src/roles.test.ts` |
| `apps/cli/src/config.test.ts` | cwd→Git根停止、嵌套repo/worktree/config、坏JSON不fallback、flags优先级、profile隔离、normalized origin/base/role不串token | `pnpm --filter @workmesh/cli test -- src/config.test.ts` |
| `apps/cli/src/auth.test.ts`、`client.test.ts` | 设备proof正确恢复；任何输出无秘密；401零refresh/零跨profile；429 deadline；同key同body重放、异body拒绝、凭据撤销先于旧receipt访问 | `pnpm --filter @workmesh/cli test -- src/auth.test.ts src/client.test.ts` |
| `apps/cli/src/spec.test.ts`、`hosts/hosts.test.ts` | 两宿主只改各自管理块；重复安装bytes/mtime不变；人工改动冲突保留；更新不改草稿/用户规则；包从任意cwd解析 | `pnpm --filter @workmesh/cli test -- src/spec.test.ts src/hosts/hosts.test.ts` |
| `apps/cli/src/context.test.ts`、`receipts.test.ts` | 分片中断不混版；hash错误不切current；草稿不覆盖；崩溃后same digest恢复；秘密/正文不进ledger | `pnpm --filter @workmesh/cli test -- src/context.test.ts src/receipts.test.ts` |
| `apps/cli/src/output.test.ts` | 每条命令success/error stdout各能一次JSON.parse且无额外字节；stderr诊断脱敏；每类固定退出码 | `pnpm --filter @workmesh/cli test -- src/output.test.ts` |
| `apps/api/test/workflow-definition.e2e-spec.ts` | 真实Nest DTO/格式验证、无权发布、validate不落库、CAS双发布单胜、非法scope/槽/role外键；PRODUCT先于PRD可claim，下游不可 | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.ts test/workflow-definition.e2e-spec.ts` |
| `apps/api/test/local-workflow.e2e-spec.ts` | 选定授权样例候选→Web理解确认→PRD发布→研发交付/代码证据→返修→重交→测试→发布；local approved/HUMAN自报均拒绝 | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.ts test/local-workflow.e2e-spec.ts` |
| 现有页面 `*.test.tsx` 与 `apps/web/e2e/independent-confirmation.spec.ts` | 精确版本/槽、同人多槽分别确认、二验ticket过期/重放、变更冲突重新预览、凭据metadata无秘密；未授权页面/API均闭门 | `pnpm --filter @workmesh/web test`；授权隔离环境执行Web浏览器套件 |
| `apps/cli/test/packaged-cli.test.ts` | pack tar中只有白名单，脱离源码安装后init/doctor/help，spec/roles/templates/lock齐全，CLI无postinstall/遥控脚本 | `pnpm --filter @workmesh/cli build`；`pnpm --filter @workmesh/cli test -- test/packaged-cli.test.ts` |

当前 `packages/shared/package.json` 尚无test脚本，实施先按06增加Vitest测试依赖/配置再使用表中exec命令；API现有runner是Vitest而非Jest，隔离HTTP用例纳入integration配置，不临时发明jest配置文件。凭据套件还须验证明确file store同意、0700/0600、UID/symlink拒绝和Windows unsupported；本地chmod/目录构造仅在测试临时目录。

数据库/API套件按总测试册自验证隔离目标，不能因测试名字就连接现有库。真实宿主验收另用一个无客户资料的公开fixture，分别记录 Codex 和 Claude Code 的实际版本、entry类型、包版本与digest；在各自窗口完成同一授权输入→本地角色产物→平台交付，并中断/切换宿主后从正式检查点接续。该层不能由字符串模板测试替代；只读入口生成、模拟HTTP、真实Nest+隔离DB、浏览器独立确认和真实宿主行为分别报告。

产物结构/完整性通过，只证明该 artifact 或候选满足声明 contract；阶段推进还需当前依赖、全部审批槽、scope、claim/快照和代码证据满足。上述测试在实施后才可改为已通过记录，本次不运行服务、真实工作流、迁移、联网、安装或提交。
