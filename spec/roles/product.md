# 产品（PRODUCT）工作流

角色值：`PRODUCT`。Product Agent 在本地负责把业务意图整理成 PRD 候选；Web 只承担查看、比较和人工决策。

## 边界

| 责任方             | 负责的事情                                                                       |
| ------------------ | -------------------------------------------------------------------------------- |
| 人                 | 提供业务意图，回答关键澄清问题，确认范围，并批准高风险决策                       |
| 本地 Product Agent | 读取需求与已确认 Understanding，生成 PRD、交付范围和验收标准，提交候选并附带证据 |
| Web                | 查看候选正文和修订差异，显示评审状态，提交批准、拒绝或要求修改的决定             |
| API                | 校验版本、权限、Understanding 基线、交付范围和验收字段，并在全部批准后发布       |

## 流程

| 阶段          | 动作                                                                                                           | 输出                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| P1 收集与澄清 | 读取需求上下文，向人提出最少的关键问题                                                                         | 已确认的需求与 Understanding revision                  |
| P2 生成 PRD   | 在本地生成目标、范围、用户故事、边界、依赖和验收标准                                                           | `prd.md` 与候选绑定元数据                              |
| P3 提交候选   | 通过 `workmesh candidate --kind PRD` 创建文档或追加修订                                                        | `CANDIDATE` revision + `PRD_PUBLICATION` ReviewRequest |
| P4 人工评审   | 人在 Web 查看正文、历史版本和差异，做 APPROVE / CHANGES_REQUESTED / REJECT；要求修改或驳回时必须写明可执行说明 | 评审决定与审计记录                                     |
| P5 发布后拆解 | 只有全部评审槽位批准后，读取已发布 PRD 并拆解下游任务                                                          | `Requirement.currentPrdRevisionId` 与 Task 列表        |
| P6 变更管理   | 收到下游澄清或发现范围变化时生成新 revision，重新走评审                                                        | 新版本与 ChangeEvent                                   |

## Product Agent 提交

先读取当前需求、项目角色和已确认的 Understanding 基线，再在本地生成正文。提交正式 PRD 候选时，必须提供：

- `requirementId`
- `basisUnderstandingRevisionId`
- `deliveryScope`，其中 `requiredOutputKinds` 必须包含 `IMPL`
- 至少一条 `acceptance`，每条包含可判定的 `key`、`text` 和 `verification`（`TEST`、`INSPECTION` 或 `DEMO`）

示例：

```bash
workmesh claim --task <taskId>
workmesh context --task <taskId> --claim <claimId> --expected-version <taskVersion> --materialize
workmesh candidate \
  --kb <knowledge-base-id> \
  --kind PRD \
  --file prd.md \
  --requirement <requirement-id> \
  --basis-understanding-revision <understanding-revision-id> \
  --delivery-scope @delivery-scope.json \
  --acceptance @acceptance.json
```

命令只提交候选，不发布 PRD。服务端创建 `PRD_PUBLICATION` 评审请求并返回 `reviewRequestId`；Product Agent 应把该 ID 交给人或在本地 receipt 中记录，不能调用批准接口代替 HUMAN 决策。

已有 PRD 需要修改时，使用同一命令携带 `--document <document-id>` 追加候选 revision。不要用普通 `deliver --kind PRD` 的 ArtifactSet 作为正式 PRD 发布；该路径只代表任务交付，除非后续显式绑定到 DocumentRevision，否则不会更新 `currentPrdRevisionId`。

## DoD 自检（缺一不可）

- [ ] 每条验收标准可测试且有明确判定方式
- [ ] 范围与边界已写清（做什么、不做什么）
- [ ] `basisUnderstandingRevisionId` 指向需求当前已发布且已确认的 Understanding
- [ ] `deliveryScope` 明确参与角色、产物类型和排除理由
- [ ] 任务已拆分，每个任务归属明确角色
- [ ] 外部依赖（设计、接口、数据）已在 PRD 中标注

## 交接与协同

- PRD 只有在 Web 上全部评审槽位批准后才进入发布状态，并更新 `Requirement.currentPrdRevisionId`。
- 收到下游 `NEEDS_CLARIFY` 时先回答问题；如果改变目标、范围或验收标准，必须生成新的 PRD revision 并重新评审。
- `CHANGES_REQUESTED` 或 `REJECT` 的说明是本地 Product Agent 返修的输入；Agent 应通过评审请求详情或 operation receipt 读取说明，生成下一版候选，不在 Web 中直接改正文。
- 已发布 PRD 是后续设计、实现和测试的事实基线；任何冲突都要回到评审流程解决。
