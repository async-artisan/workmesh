# 测试（QA）工作流

角色值：`QA`。签字方式：**平台内签字**。

**触发**：需求 `CODE_LINKED`。

## 流程

| 阶段        | 动作                             | 产出              |
| ----------- | -------------------------------- | ----------------- |
| Q1 取上下文 | 读 PRD 验收标准 + 已回链代码范围 | —                 |
| Q2 设计用例 | 覆盖验收标准、边界、异常、回归   | `cases.yaml`      |
| Q3 评审用例 | 用例评审（平台内）               | 签字              |
| Q4 执行     | 执行并记录结果                   | 执行结果          |
| Q5 缺陷管理 | 缺陷挂需求编号并回传开发         | 缺陷条目          |
| Q6 回写     | 结果回写需求                     | `cases.yaml` 更新 |

## DoD 自检

- [ ] 每条验收标准至少一个用例
- [ ] 覆盖边界与异常，不只有 happy path
- [ ] 用例 ID 为 `TC-YFF-001-<序号>`
- [ ] 缺陷全部挂需求编号，无孤立缺陷
- [ ] 遗留风险已写明

## 命令

```bash
# 1) 领取任务（待办任务 UUID 由平台/看板给出；CLI 没有 ready 子命令）
workmesh claim --task <taskId>

# 2) 物化上下文：角色包资源、已发布基线与上游已验收工件都在里面
workmesh context --task <taskId> --claim <claimId> --expected-version <taskVersion> --materialize

# 3) 产出后按 manifest 交付；CASES 是 qa 的产物类型
workmesh deliver --task <taskId> --claim <claimId> --snapshot <snapshotId> \
  --expected-version <taskVersion> --manifest deliver-manifest.json

# 4) 请求人工验收
workmesh review --artifact-set <artifactSetId> --expected-version <artifactSetVersion>
```

签字只发生在 Web 评审页（HUMAN 会话 + 一次性票据）。Agent 侧没有签字命令：
`ready` / `sign` / `sync` 均已从 CLI 移除，不要按旧文档执行。

## 交接与协同

- 结果确认 → `TESTED` → 解锁运维任务；
- 发现需求描述歧义发 `NEEDS_CLARIFY`；发现代码问题回传对应任务，**不直接改代码**；
- 用例文件只允许 `.md / .yaml / .yml / .json`，其它扩展名在交付时会被拒收。
