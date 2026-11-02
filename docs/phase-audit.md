# WorkMesh v1 completion audit (S00–S08)

审计区分“源码证据”和“环境依赖证据”；环境依赖项未执行时不得计入 completed。
旧 Phase 0–6 审计结论已随旧实现退出而作废。

| 阶段 | 源码证据                                          | 本地可复现证据                              | 剩余证据缺口                                  |
| ---- | ------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| S00  | 基线核对、旧实现清单、工作树保留                  | `git status`、API `tsc --noEmit` 退出 0     | 无（仅记录基线）                              |
| S01  | 唯一 schema + 单一初始迁移 + 独立 Prisma client   | schema validate、离线迁移 DDL、静态迁移检查 | 真实 PostgreSQL apply 与约束失败回归          |
| S02  | WebSession/CSRF/AgentCredential/确认票据/设备授权 | 单测 + 进程内 HTTP 契约                     | 真实部署会话链、Cookie 属性在真实浏览器的行为 |
| S03  | 文档修订→评审→发布、工作流编译/实例化、审批槽     | 单测 + 进程内 HTTP 契约                     | 真实数据库并发发布、immutable 触发器等        |
| S04  | 认领/快照/工件/评审决定/验收/变更传播             | 单测 + 进程内 HTTP 契约                     | 真实数据库 Serializable 冲突与回滚            |
| S05  | GitHub adapter、Webhook 验签去重、代码证据        | 单测 + fixture                              | GitHub live（无独立测试仓与凭据）             |
| S06  | CLI 正式 API 命令面                               | CLI 单测、命令面禁止旧命令断言              | pack 后在干净 home 的真实执行                 |
| S07  | Web Cookie+CSRF、评审/ACL/角色页面                | Web 单测、构建                              | 浏览器 E2E（需隔离 API+DB）                   |
| S08  | 缺口端点、命名收敛、文档                          | 全量 tsc/test/contracts/build               | 真实数据库/HTTP/浏览器/GitHub                 |

## 不可接受的“通过”方式

排除文件、关闭 strict、使用 `any`、删除测试、放宽断言、`.skip`/`todo`、`|| true`、mock 核心实现，均不计为证据。

## 解除条件

真实 PostgreSQL、浏览器 E2E、GitHub live 需要用户显式授权隔离目标；在此之前这些层保持 unverified。
