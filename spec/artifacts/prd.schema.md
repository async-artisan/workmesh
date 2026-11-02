# PRD 工件规范（kind: PRD）

允许扩展名：`.md`。交付时 `--kind PRD`。

## 必需章节

```markdown
# <需求标题>（YFF-REQ-123）

## 背景

## 目标与非目标

## 用户故事

## 验收标准（可测、可判定）

## 边界与异常

## 外部依赖
```

## 自检项（`workmesh deliver` 本地执行）

| 检查项     | 要求                    |
| ---------- | ----------------------- |
| `exists`   | 文件真实存在            |
| `fileType` | 扩展名属于 PRD 允许列表 |
| `notEmpty` | 文件非空                |
| `anchor`   | 路径或摘要含需求编号    |

平台侧二次校验：uri 不得为绝对路径、不得含 `..`、必须声明 `schemaVersion`、自检项必须全部通过、锚点必须能被平台独立验证（agent 自称"已带锚点"不算）。

## 验收标准写法

每条标准必须可测、可判定，避免"体验良好"这类无法判定的描述：

```markdown
- [ ] 未配置 key 时，模型选择下拉禁用并提示"请先配置 key"
```

## 正式提交边界

prd.md 是本地 Product Agent 生成的正文。正式 PRD 必须通过 workmesh candidate --kind PRD 提交为 DocumentRevision 候选，并携带已确认的 Understanding 基线、deliveryScope 和 acceptance。候选会自动创建 PRD_PUBLICATION 评审请求，只有 Web 上的 HUMAN 评审全部批准后才会发布。

任务 ArtifactSet 的 deliver --kind PRD 只表示一次任务交付，不会自动更新正式 PRD 的 currentPrdRevisionId。需要让 PRD 成为需求事实基线时，必须走 DocumentRevision 候选路径。
