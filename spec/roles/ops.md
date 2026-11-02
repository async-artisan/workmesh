# 运维（OPS）工作流

角色值：`OPS`。签字方式：**平台内签字**。

**触发**：需求 `TESTED`。

## 流程

| 阶段        | 动作                         | 产出         |
| ----------- | ---------------------------- | ------------ |
| O1 发布准备 | 确认依赖、灰度策略、回滚方案 | 发布计划     |
| O2 发布     | 执行发布                     | 发布记录     |
| O3 冒烟     | 按验收标准做生产冒烟         | 冒烟结果     |
| O4 记录     | 版本号、时间、环境、影响需求 | `release.md` |
| O5 确认     | 发布确认                     | 签字         |

## DoD 自检

- [ ] 回滚方案存在且已验证可行
- [ ] `release.md` 含影响需求编号列表
- [ ] 冒烟覆盖该需求的关键路径
- [ ] 监控与告警已就位

## 命令

```bash
# 1) 领取任务（待办任务 UUID 由平台/看板给出；CLI 没有 ready 子命令）
workmesh claim --task <taskId>

# 2) 物化上下文：角色包资源、已发布基线与上游已验收工件都在里面
workmesh context --task <taskId> --claim <claimId> --expected-version <taskVersion> --materialize

# 3) 产出后按 manifest 交付；RELEASE 是 ops 的产物类型
workmesh deliver --task <taskId> --claim <claimId> --snapshot <snapshotId> \
  --expected-version <taskVersion> --manifest deliver-manifest.json

# 4) 请求人工验收
workmesh review --artifact-set <artifactSetId> --expected-version <artifactSetVersion>
```

签字只发生在 Web 评审页（HUMAN 会话 + 一次性票据）。Agent 侧没有签字命令：
`ready` / `sign` / `sync` 均已从 CLI 移除，不要按旧文档执行。

## 交接与协同

- 确认 → `RELEASED`，需求闭环；
- 发布记录只允许 `.md`，且必须列出本次影响的需求编号。
