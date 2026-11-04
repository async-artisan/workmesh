# 2026-11-03 工程整改验证

本页记录本地工作区的实际验证。工作区包含尚未发布的改动；这些结果不代表 GitHub Actions 已通过，也不代表正式版本已发布。历史基线与本次整改应分开理解。

## 覆盖率与真实数据库

API 使用 Vitest 4、V8 和 SWC 装饰器元数据，在生产源码统计范围内执行单元、HTTP 和真实数据库测试。保留原有 **80% 行覆盖率门禁**，没有降低阈值或排除未覆盖业务文件。

实测为 **67 个文件、604 项测试全部通过，无跳过**；生产行覆盖率 **80.16%（4487 / 5597）**。其中 502 项是单元测试、45 项是主要使用仓储替身的 HTTP 测试、57 项使用真实 PostgreSQL。语句覆盖率 78.17%、分支覆盖率 66.13%、函数覆盖率 82.13%；达到行覆盖率门禁不等于覆盖所有分支，也不等于全部产品流程已验收。

集成覆盖率配置按文件串行执行，共享隔离数据库内的测试仍在各文件内部显式覆盖并发竞争；这样可以避免多个 Prisma 交互事务跨文件同时运行时产生环境相关的死锁重试波动。

测试连接到本轮创建的独立 PostgreSQL 集群，仅使用 `workmesh_test_remediation` 和 `workmesh_v1` schema。测试入口要求显式目标，验证实际数据库身份，不回退到应用数据库。复跑应创建自己的空测试库，应用全部迁移，并设置如下变量：

```powershell
$env:WORKMESH_TEST_ENV = 'local'
$env:WORKMESH_TEST_DATABASE_USERS = 'postgres'
$env:WORKMESH_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55439/workmesh_test_remediation?schema=workmesh_v1'
pnpm --filter @workmesh/api test:coverage
```

端口和数据库名只是本次示例，不是默认应用配置。数据库门禁还会验证本地连接、测试库前缀、schema 和用户白名单。Windows 上应先停止本轮自己启动的 API 进程，再重新生成 Prisma client，避免查询引擎 DLL 被占用。

真实数据库验证按业务风险组织：

| 文件                                                 | 项数 | 主要验证                                                                           |
| ---------------------------------------------------- | ---: | ---------------------------------------------------------------------------------- |
| `apps/api/test/v1-consistency.database.spec.ts`      |    6 | 变更决定竞争单胜、真实约束失败回滚、webhook 并发去重、票据单次消费                 |
| `apps/api/test/v1-account-device.database.spec.ts`   |    9 | 全 AppModule 下注册登录、CSRF、设备授权、凭据撤销、确认动作、邀请注册和项目角色    |
| `apps/api/test/v1-task.database.spec.ts`             |   23 | 认领、快照、交付、验收、返修、拒绝、批准撤销、加密票据准备、资源正文读取和失败回滚 |
| `apps/api/test/v1-knowledge-access.database.spec.ts` |    8 | 权限版本、grant 历史、确认消费、游标绑定、已发布搜索、发布与撤回                   |
| `apps/api/test/v1-workflow.database.spec.ts`         |   10 | 发布修订、并发实例接管、旧实例退役、角色包登记、项目隔离与回滚                     |
| `apps/api/test/v1-publication.e2e-spec.ts`           |    1 | 通过真实 HTTP 决定完成知识发布，由另一个授权主体读取                               |

## 实际修复

- 变更决定、事件及收件人同事务提交；webhook 完成状态和幂等记录同事务提交，并处理并发唯一键竞争。
- 代码证据票据校验项目、工件 generation 和批准证据范围，原子消费。新准备的秘密使用 AES-256-GCM 加密保存，并绑定项目、主体、票据和请求摘要。
- 票据创建和加密重放记录在一个事务内提交，竞争请求不能覆盖先提交者的重放秘密；加密或持久化失败不会留下额外票据。
- 知识库权限变更消费确认票据时补齐 `consumedOperationId`，使确认消费能够关联本次幂等操作；失败时业务数据和审计指针一起回滚。
- 修复重复工作流 key 检测，规范测试入口和依赖工具链，增加有容量上限的进程内限流以及启动配置校验。

## 其他验证与边界

- 原本地整改记录另记载：`pnpm exec turbo run test --force` 实际执行 740 项单元测试、8 个任务成功且无缓存命中，`pnpm test:contracts` 16 项运行时契约通过；多账号 API/数据库演练覆盖 Owner 注册、项目创建、前端与 QA 邀请及接受。这些是 2026-11-03 的历史结果，不是 2026-11-04 文档清理时重新执行的验证，也不能替代外部真实团队使用。
- 全仓单元测试应使用 `pnpm exec turbo run test --force` 核验实际执行，避免把缓存命中当成新增行为验证。CLI 的文件权限测试保留真实 NTFS DACL 检查；一个多文件物化测试仅在 Windows 使用 20 秒截止时间，以容纳整仓并行负载下的系统命令启动。
- Chromium 基础浏览器流程 2 项通过，覆盖注册、会话、创建项目、页面加载、登出再登录及 CSRF 拒绝；尚未覆盖从需求到发布的完整产品浏览器流程。
- 生产依赖审计为 0；完整依赖审计仍有 2 项 low、3 项 moderate，无 high/critical。开发工具间接依赖仍需兼容性评估。
- 隔离库完成全部 12 项迁移、备份、恢复到新库和 49 张基础表逐表行数核对。小型测试数据集不能证明生产容量和 RTO/RPO。
- 前端最大 JS 分块降至 216.76 kB，gzip 71.64 kB；分块体积不能直接换算用户延迟或整体初始下载比例。
- GitHub live 只读入口已实现，但未配置获准测试的真实仓库/PR，本次为 SKIPPED。真实 webhook 投递未联调。

原始日志和覆盖率产物保存在被忽略的 `.tmp/remediation-*.log`、`.tmp/remediation-audit-*.json` 和 `apps/api/coverage/`。这些结果必须随最终待发布 commit 在远端重新验证。发布前还需完成跨平台安装、性能容量、外部接口和安全私密渠道的验收，具体步骤见 [发布与升级验收](../releasing.md)。
