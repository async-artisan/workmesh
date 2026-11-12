# 外部团队模拟脚本使用指南

`scripts/sim-external-team.mjs` 是 G0 目标的本地演练入口。它用三个独立会话（owner、dev、qa）模拟一次完整的外部团队交付闭环，让维护者在没有真实外部团队时也能演练并记录整条链路。

## 覆盖范围

| 步骤                            | 操作者     | 说明                                             |
| ------------------------------- | ---------- | ------------------------------------------------ |
| 注册 + 建项目                   | owner      | 全新账号、全新项目                               |
| 发布流程 + PRD/Understanding    | owner      | 复用 `first-run-workflow.mjs`                    |
| 邀请成员                        | owner      | 邀请 frontend（dev）和 qa reviewer               |
| 接受邀请                        | dev、qa    | 各自用独立会话注册并加入项目                     |
| 认领 IMPL 任务 → 交付           | dev        | 含完整快照 + 工件 SHA-256                        |
| 评审提出返修                    | qa / owner | REWORK 决定                                      |
| 重新认领 → 修订交付             | dev        | 展示返修后重新提交的完整路径                     |
| 批准修订后的 IMPL               | qa + owner | 所有槽位批准                                     |
| 认领 CASES 任务 → 交付          | qa         | QA 验收用例                                      |
| 批准 CASES                      | owner      | CASES 任务 DONE                                  |
| 认领 RELEASE 任务 → 交付 → 批准 | owner      | 全链路完成，三个任务全部 DONE                    |
| 最终状态验证                    | —          | 断言 IMPL + CASES + RELEASE 全部 DONE + APPROVED |

**不覆盖**（需要额外环境或操作）：

- CLI 设备授权（需要浏览器交互）
- 真实代码仓库和 commit 级证据
- 跨平台安装与升级验收
- 生产数据库迁移与备份恢复
- 需求变更后的失效传播

## 前置条件

1. Node.js 20.19.0+，pnpm 10.28.2
2. `@workmesh/shared` 已构建：`pnpm --filter @workmesh/shared build`
3. API 已启动并完成所有迁移（端口默认 `3000`）
4. 使用**隔离测试数据库**，不要指向生产或共享团队库

## 运行方法

```bash
# 使用默认地址（API: http://127.0.0.1:3000，Origin: http://127.0.0.1:5173）
node scripts/sim-external-team.mjs

# 自定义地址
WORKMESH_API=http://127.0.0.1:3000 \
WORKMESH_ORIGIN=http://127.0.0.1:5173 \
node scripts/sim-external-team.mjs
```

## 预期输出

脚本成功时输出类似：

```
WorkMesh external team simulation against http://127.0.0.1:3000

  ok  owner: register and establish session (142ms)
  ok  owner: create project (38ms)
  ok  owner: read roles (12ms)
  ok  owner: publish workflow and product baseline (1823ms)
  ok  owner: invite frontend dev (95ms)
  ok  owner: invite qa reviewer (88ms)
  ok  dev: accept invitation and join project (67ms)
  ok  qa: accept invitation and join project (61ms)
  ok  dev: claim IMPL task (43ms)
  ok  dev: build context snapshot (55ms)
  ok  dev: deliver IMPL (first attempt) (112ms)
  ok  qa: request rework on IMPL review (78ms)
  ok  owner: request rework on IMPL review (if still open) (22ms)
  ok  dev: re-claim IMPL after rework (41ms)
  ok  dev: rebuild context snapshot (53ms)
  ok  dev: re-deliver IMPL (after rework) (108ms)
  ok  qa + owner: approve revised IMPL (195ms)
  ok  qa: claim CASES task (38ms)
  ok  qa: build context snapshot for CASES (52ms)
  ok  qa: deliver CASES (99ms)
  ok  owner: approve CASES review (127ms)
  ok  owner: claim RELEASE task (41ms)
  ok  owner: build context snapshot for RELEASE (51ms)
  ok  owner: deliver RELEASE artifact (104ms)
  ok  owner: approve RELEASE review (133ms)
  ok  verify final state (62ms)

RESULT: All 3 tasks (IMPL + CASES + RELEASE) DONE and APPROVED
project <project-id>  requirement KEY-001
sign in at http://127.0.0.1:5173 to inspect.

accounts:
  owner    sim-owner-<stamp>@workmesh.local
  dev      sim-dev-<stamp>@workmesh.local
  qa       sim-qa-<stamp>@workmesh.local
  password SimTeam-2026!

result written to .tmp/sim-external-<timestamp>/result.json
```

## 结果文件格式

`.tmp/sim-external-<timestamp>/result.json` 记录机器可读的运行摘要：

```json
{
  "schemaVersion": "1.0",
  "simulatedAt": "2026-11-12T...",
  "serverBase": "http://127.0.0.1:3000",
  "projectId": "...",
  "projectKey": "ABCDEF",
  "requirementCode": "ABCDEF-001",
  "accounts": { "owner": "...", "dev": "...", "qa": "...", "password": "SimTeam-2026!" },
  "reviews": { "impl": "...", "cases": "...", "release": "..." },
  "finalStatus": {
    "implTask": "DONE",
    "casesTask": "DONE",
    "releaseTask": "DONE"
  },
  "timeline": [{ "name": "...", "ms": 142 }, ...],
  "totalMs": 3450,
  "notCovered": [...]
}
```

## 如何填写外部团队验收模板

运行成功后，把结果填入 `docs/operations/external-team-acceptance-template.md`：

| 模板字段      | 取自结果                                                |
| ------------- | ------------------------------------------------------- |
| 版本 / commit | `git rev-parse HEAD`                                    |
| 运行时间      | `result.simulatedAt`                                    |
| 项目 ID       | `result.projectId`                                      |
| 评审 ID       | `result.reviews.impl / cases / release`                 |
| 场景结果      | `result.finalStatus`（全部 DONE = 通过）                |
| 时间线 / 耗时 | `result.timeline` + `result.totalMs`                    |
| 未覆盖范围    | `result.notCovered`                                     |
| 结论          | 通过（但标注未覆盖的真实 GitHub、CLI 授权、生产运维项） |

**注意**：本模拟结果属于「内部隔离验收」，不等同于「外部真实团队使用并签署」。G0 的最终目标仍需 1 个外部真实团队完成并留下截图 + 时间线 + 三项指标数值。

## 常见错误排查

| 错误                                                   | 原因                               | 处理                                                 |
| ------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| `no IMPL task found in ready queue`                    | 流程发布失败或任务未正确实例化     | 检查 `owner: publish workflow` 步骤输出              |
| `no RELEASE task in ready queue after IMPL+CASES done` | IMPL 或 CASES 未完全 DONE          | 确认两个前置任务的评审均 APPROVED                    |
| `HTTP 409 SNAPSHOT_STALE`                              | 任务版本已推进                     | 重新运行脚本（脚本不支持断点续跑）                   |
| `HTTP 403` 在邀请步骤                                  | 项目版本不匹配                     | 脚本内部会重新读取 project.version，若仍失败检查并发 |
| `HTTP 429`                                             | 触发限流（初始化请求每 60 秒一次） | 等待 60 秒后重试                                     |
