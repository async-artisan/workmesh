# 角色包设计（v0.1）

> 状态：设计稿，未实施。日期：2026-11-02。
> 范围：六个默认角色包的目录骨架、manifest v1.1、SKILL.md 规范、校验规则与分发方式。
> 相关：[知识与变更架构](knowledge-architecture.md)、[工作流定义代码](../packages/shared/src/workflow.ts)、[标准模板](../packages/shared/src/workflow-template.ts)。

---

## 1. 设计原则

1. **包是安装单位，skill 是能力单位**：一个角色包 = 3–5 个 skill。
2. **内置包不特殊**：内置与自定义走同一套 manifest、校验、安装、锁。
3. **SKILL.md 做宿主入口，manifest 做安装与锁的权威**。
4. **包只放方法**：知识正文放知识库，包内只放指针；**项目规范放 [project-templates/](../project-templates/)，不进角色包**。
5. **默认包与默认模板成套**：模板引用哪个角色，就必须有对应包，否则编译失败。

## 2. 六个默认包

| 包 id               | roleKey    | 定位                | v0.1 深度 |
| ------------------- | ---------- | ------------------- | --------- |
| `workmesh.product`  | `product`  | 理解 → PRD → 验收   | 深        |
| `workmesh.backend`  | `backend`  | 契约 → 实现 → 证据  | 深        |
| `workmesh.qa`       | `qa`       | 验收 → Evals → 缺陷 | 深        |
| `workmesh.frontend` | `frontend` | 契约对接 → 界面实现 | 薄        |
| `workmesh.ui`       | `ui`       | 设计规格 / 复用声明 | 薄        |
| `workmesh.ops`      | `ops`      | 发布 / 回滚 / 冒烟  | 薄        |

深包 = SOP + 模板 + 清单 + 示例；薄包 = SOP + DoD + 一个模板。

## 3. 目录骨架

```
packages/role-packages/roles/product/
├── package.meta.json
├── manifest.json
├── guide.md
├── skills/
│   ├── clarify-intent/SKILL.md
│   ├── write-prd/SKILL.md
│   └── map-acceptance/SKILL.md
├── assets/
│   ├── templates/
│   │   ├── understanding.md
│   │   ├── prd.md
│   │   └── acceptance.yaml
│   └── examples/
│       └── prd-example.md
├── checklists/
│   └── prd-quality.md
└── references/
    └── references.json        # 指向知识库条目/契约，不复制正文
```

构建时由脚本读取目录、计算摘要、生成 `manifest.json` 的 `resources[]`；提交的是源目录，发布的是构建产物。

## 4. manifest v1.1

相对 v1.0 是**纯增量**，当前没有已发行包，直接升到 1.1，不做双版本兼容。

```json
{
  "packageSchemaVersion": "1.1",
  "id": "workmesh.product",
  "version": "0.1.0",
  "protocolVersion": "1.0",
  "title": "产品角色包",
  "description": "把业务意图转成可判定的 PRD 与验收，供下游并行开工。",
  "license": "MIT",
  "roleKey": "product",
  "compatibility": {
    "minCliVersion": "1.0.0",
    "maxCliVersionExclusive": "2.0.0",
    "contractVersion": "1.0"
  },
  "skills": [
    {
      "key": "write-prd",
      "path": "skills/write-prd/SKILL.md",
      "description": "基于已确认的理解与业务知识产出 PRD。",
      "whenToUse": "理解已确认、需要出稿或修订 PRD 时。"
    }
  ],
  "inputs": [
    {
      "key": "context",
      "source": "TASK_SNAPSHOT",
      "kind": "CONTEXT",
      "required": true,
      "contractVersion": "1.0"
    },
    {
      "key": "prd-baseline",
      "source": "KNOWLEDGE",
      "kind": "PRD",
      "required": false,
      "contractVersion": "1.0"
    }
  ],
  "outputs": [
    {
      "key": "understanding",
      "channel": "CANDIDATE",
      "kind": "UNDERSTANDING",
      "contractVersion": "1.0",
      "templateResourceId": "understanding-template"
    },
    {
      "key": "prd",
      "channel": "CANDIDATE",
      "kind": "PRD",
      "contractVersion": "1.0",
      "templateResourceId": "prd-template",
      "evidence": ["INSPECTION"]
    }
  ],
  "resources": [
    {
      "id": "skill-write-prd",
      "kind": "SKILL",
      "path": "skills/write-prd/SKILL.md",
      "sha256": "<64 位小写 hex>",
      "byteLength": 0,
      "mediaType": "text/markdown"
    }
  ],
  "agentEntries": [
    {
      "host": "codex",
      "type": "AGENTS_MD_POINTER",
      "resourceId": "skill-write-prd",
      "adapterVersion": "1.0.0"
    },
    {
      "host": "claude-code",
      "type": "SKILLS_DIRECTORY",
      "resourceId": "skill-write-prd",
      "adapterVersion": "1.0.0"
    }
  ]
}
```

v1.1 新增字段：

| 字段                 | 说明                                                         |
| -------------------- | ------------------------------------------------------------ |
| `description`        | 包级一句话，用于发现与列表                                   |
| `license`            | 开源合规                                                     |
| `skills[]`           | `{ key, path, description, whenToUse }`，一个包多个能力      |
| `outputs[].evidence` | 该类产出需要的证据类型数组（`TEST` / `INSPECTION` / `DEMO`） |

`resources[]` 的摘要由构建脚本生成；`byteLength` 为 0 只是示例，实际为真实字节数。

## 5. SKILL.md 规范

对齐 [Agent Skills](https://agentskills.io/specification)：

| 字段            | 必填 | 约束                                               |
| --------------- | ---- | -------------------------------------------------- |
| `name`          | 是   | ≤64 字符，小写字母/数字/连字符，不以连字符开头结尾 |
| `description`   | 是   | ≤1024 字符，写「做什么 + 何时用」                  |
| `license`       | 否   | 与包一致                                           |
| `compatibility` | 否   | ≤500 字符，环境要求                                |
| `metadata`      | 否   | 字符串键值对，可放 `roleKey`、`packageVersion`     |

示例（`skills/map-acceptance/SKILL.md`）：

```markdown
---
name: map-acceptance
description: 把 PRD 拆成可判定的验收条目，标注 verification、category 与 criticality；当 PRD 草稿完成或验收需要修订时使用。
license: MIT
metadata:
  roleKey: product
---

# 拆验收

## 何时用

- PRD 草稿已完成，需要给出验收。
- 下游回问验收口径，需要补充或修订。

## 步骤

1. 逐条检查 PRD 的目标与边界，确认可观测的结果。
2. 每条验收只写一个结果，出现「并且/同时」就拆。
3. 标注 `verification`：能用 TEST 就不用 INSPECTION，能用 INSPECTION 就不用 DEMO。
4. 标注 `category` 与 `criticality`；性能类用 TEST，阈值写进正文。
5. 自检黑名单词：友好、快速、合理、尽量、优化、完善。

## 交接

产出 `acceptance.yaml`，交产品确认、QA 做可测性签核。
```

> 包形态的来源与边界见 [references.md](references.md) 第 9 节（Agent Skills、Spec Kit、Claude Plugins、BMAD、OpenSpec）。

## 6. 六个包的 skill 清单

| 包       | skills                                                   | 关键产出                     |
| -------- | -------------------------------------------------------- | ---------------------------- |
| product  | `clarify-intent`、`write-prd`、`map-acceptance`          | 理解、PRD、验收              |
| backend  | `design-contract`、`implement-change`、`attach-evidence` | 契约、实现、证据             |
| qa       | `derive-cases`、`run-evals`、`report-defects`            | 用例、评测结果、缺陷         |
| frontend | `consume-contract`、`implement-ui`                       | 实现方案、界面               |
| ui       | `write-design-spec`、`declare-reuse`                     | 设计规格、复用声明           |
| ops      | `prepare-release`、`rollback-plan`、`smoke-check`        | 发布计划、回滚方案、冒烟记录 |

每个 skill 的 `description` 必须写「做什么 + 何时用」，这是宿主决定是否加载它的唯一依据。

## 7. 模板与清单

| 包       | 模板                                            | 清单                   |
| -------- | ----------------------------------------------- | ---------------------- |
| product  | `understanding.md`、`prd.md`、`acceptance.yaml` | `prd-quality.md`       |
| backend  | `contract.md`、`impl.md`                        | `contract-quality.md`  |
| qa       | `cases.yaml`、`evals.yaml`、`defect.md`         | `cases-coverage.md`    |
| frontend | `impl.md`、`component-map.md`                   | `impl-selfcheck.md`    |
| ui       | `design-spec.md`、`reuse-declaration.md`        | `design-coverage.md`   |
| ops      | `release.md`、`rollback.md`、`smoke.md`         | `release-readiness.md` |

清单不只给人看：交付时逐项校验，未过项进入拒收原因。

## 8. 校验规则

安装时（CLI）：

1. manifest schema 通过，`packageSchemaVersion=1.1`、`protocolVersion=1.0`。
2. 每个 `skills[].path` 存在、是普通文件、内容以 YAML frontmatter 开头。
3. `name` 合法、`description` 非空且 ≤1024。
4. `resources[]` 的摘要与长度匹配实际文件。
5. 路径无绝对路径、无点段、无符号链接、无 `.env` 类文件。
6. `agentEntries[].resourceId` 必须在 `resources[]` 中存在。

发布时（服务端）：

1. 所有 `skills[].path` 的资源都已登记且摘要一致。
2. `outputs[].kind` 属于项目模板允许的工件类型。
3. 工作流引用该包时，step 的 `outputKinds` 必须被 `outputs[].kind` 覆盖。

编译时（工作流）：

1. 每个被引用的角色都有包锁。
2. 包锁 digest 与服务端登记一致。
3. 输入匹配：`baselinePolicy=PUBLISHED_PRD` 的步骤，包必须声明 PRD 输入且 `required=true`。

## 9. 与默认模板的对应

| 默认模板                        | 引用角色                                | 需要的包        |
| ------------------------------- | --------------------------------------- | --------------- |
| `standard`（现有）              | product、frontend、qa、ops              | 四个            |
| `software-delivery`（建议新增） | product、ui、frontend、backend、qa、ops | 六个，ui 可排除 |

**规则**：模板用到的角色必须有包，否则发布失败（`WORKFLOW_PACKAGE_INCOMPATIBLE`）。所以模板与包必须成套发版。

## 10. 构建与分发

- 源目录：`packages/role-packages/roles/<role>/`，提交源文件，不提交生成的摘要。
- 构建：`pnpm build:role-packages` 读取 `package.meta.json` 与目录内容，计算 sha256/byteLength，生成 `manifest.json` 与 `src/generated.ts`。
- 登记：服务端 seeder 读取 `src/generated.ts`，内置包 `projectId=null`、对所有项目可见；同版本摘要变化会拒绝覆盖，必须升 SemVer。
- 分发：git tag = `<packageId>@<version>`；安装走本地目录，服务端登记同一 digest。
- 升级：SemVer；major 变更输出契约，minor 新增可选资源，patch 文案修正。
- 在途任务锁旧版本，升级不静默生效。

## 11. 待决（附推荐）

| #   | 问题                         | 推荐                                                                                               | 理由                                               |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `agentEntries.type` 取值集合 | 固定三种：`AGENTS_MD_POINTER`（codex）、`SKILLS_DIRECTORY`（claude-code）、`SLASH_COMMAND`（可选） | 开放任意字符串会让宿主适配失控，加新类型走协议版本 |
| 2   | 薄包是否保留模板             | 保留一个最小模板，清单可省                                                                         | 没有模板就没有交付格式，校验无从谈起               |
| 3   | `examples/` 是否默认安装     | 默认安装，但单文件 ≤ 200KB、每包 ≤ 2 个                                                            | 体积小、对 Agent 质量影响大；超限改为按需拉取      |
| 4   | 自定义包能否覆盖内置 id      | 禁止；内置用 `workmesh.*`，自定义用 `org.team.*`                                                   | 避免升级时被覆盖，也避免供应链混淆                 |
| 5   | 包升级是否自动重装           | 不自动，显式 `roles upgrade`                                                                       | 在途任务锁旧版本，自动升级会静默改变工作区         |
