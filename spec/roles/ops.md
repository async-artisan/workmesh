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
workmesh ready --role OPS --json
workmesh context YFF-REQ-123 --json
workmesh deliver --task <taskId> --kind RELEASE --file release.md --uri releases/YFF-REQ-123.md
workmesh sign <taskId> --comment "已发布并冒烟"
```

## 交接与协同

- 确认 → `RELEASED`，需求闭环；
- 发布记录只允许 `.md`，且必须列出本次影响的需求编号。
