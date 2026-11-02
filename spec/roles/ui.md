# UI 工作流

角色值：`UI`。签字方式：**平台内签字**。

**触发**：需求 `PRD_READY` 且存在 UI 任务。

## 流程

| 阶段        | 动作                             | 产出                       |
| ----------- | -------------------------------- | -------------------------- |
| U1 理解     | 读 PRD + 现有设计规范            | —                          |
| U2 设计     | 出页面、状态、交互               | 设计文件（命名含需求编号） |
| U3 标注约束 | 标出边界条件、异常态、响应式要求 | `design.md`                |
| U4 自审     | 对照验收标准逐条检查覆盖         | 自审结果                   |
| U5 确认     | 提交产品 + 设计负责人确认        | 签字                       |

## DoD 自检

- [ ] 每条验收标准都有对应界面表现
- [ ] 覆盖正常态、空态、错误态、加载态、权限受限态
- [ ] 文件命名与 front-matter 均含需求编号
- [ ] 与既有设计规范一致，偏离处已说明理由

## 命令

```bash
# 1) 领取任务（待办任务 UUID 由平台/看板给出；CLI 没有 ready 子命令）
workmesh claim --task <taskId>

# 2) 物化上下文：角色包资源、已发布基线与上游已验收工件都在里面
workmesh context --task <taskId> --claim <claimId> --expected-version <taskVersion> --materialize

# 3) 产出后按 manifest 交付；DESIGN 是 ui 的产物类型
workmesh deliver --task <taskId> --claim <claimId> --snapshot <snapshotId> \
  --expected-version <taskVersion> --manifest deliver-manifest.json

# 4) 请求人工验收
workmesh review --artifact-set <artifactSetId> --expected-version <artifactSetVersion>
```

签字只发生在 Web 评审页（HUMAN 会话 + 一次性票据）。Agent 侧没有签字命令：
`ready` / `sign` / `sync` 均已从 CLI 移除，不要按旧文档执行。

## 交接与协同

- 确认 → `DESIGN_READY` → 解锁前后端任务；
- PRD 信息不足以完成设计时，发 `NEEDS_CLARIFY` 给产品，不自行假设。
