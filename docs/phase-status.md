# WorkMesh v1 delivery status (S00–S08)

本文件只记录新方案（`/api/v1`、opaque WebSession、AgentCredential、确认票据、幂等与版本并发）的交付状态。
旧 Phase 0–6 内容（JWT/refresh、seed、GitLab、signoff、AI provider）已随旧代码退出，不再代表本仓库。

| 阶段 | 已交付内容 | 证据类别 | 边界 |
| ---- | ---------- | -------- | ---- |
| S00 | 基线核对与工作树保护；类型检查基线归零 | 源码/类型 | 未提交、未部署 |
| S01 | 唯一 `apps/api/prisma/schema.prisma`（`workmesh_v1` multiSchema）、单一干净初始迁移、`PrismaService` 独立 client 输出、旧迁移/seed/导入脚本删除 | 源码/类型 | 真实 PostgreSQL apply 未授权 |
| S02 | `@Global AuthModule`：HUMAN WebSession Cookie + 双值 CSRF、AGENT `Bearer wm_a1.*`、确认票据、动作预览、CLI 设备授权（PKCE S256）、固定窗口限流 | 源码/类型、单测、进程内 Nest HTTP | 真实部署 HTTP 与浏览器未验证 |
| S03 | 知识库文档/候选修订/发布/恢复/撤回、UNDERSTANDING/PRD 绑定与基线校验、工作流 DAG 编译与实例物化、审批槽派生 | 源码/类型、单测、进程内 Nest HTTP | 真实 PostgreSQL 约束/并发未验证 |
| S04 | 任务认领/释放/工作状态、确定性 ContextSnapshot、工件交付与基线复核、评审决定与撤销、TASK/RELEASE 验收效应、变更传播 | 源码/类型、单测、进程内 Nest HTTP | 真实 PostgreSQL 并发与触发器未验证 |
| S05 | 厂商中立 GitHub adapter、分页/多仓、Webhook HMAC 验签与去重、提交级代码证据准备与绑定 | 源码/类型、单测、fixture/HTTP adapter | GitHub live 未授权 |
| S06 | CLI 迁移到正式 API：设备授权、AgentCredential、角色包/上下文/交付/评审/回执，旧登录与 refresh 删除 | 源码/类型、单测 | 打包后在干净 home 的真实执行未验证 |
| S07 | Web 改为同源 Cookie + CSRF，删除旧 signoff/直接发布，补齐评审/返修/撤销/角色/ACL 页面 | 源码/类型、单测 | 浏览器 E2E 未验证 |
| S08 | 协议收尾：缺口端点补齐、正式命名收敛、文档与进度记录 | 源码/类型、单测、构建 | 真实数据库/HTTP/浏览器/GitHub 仍为 unverified |

## 证据口径

- **源码/类型**：`tsc --noEmit`、构建与静态检查。
- **单测**：shared/API/CLI/Web 的 vitest 套件，不跳过、不放宽断言。
- **进程内 Nest HTTP**：`apps/api/test/v1-http-contract.spec.ts` 与各域 HTTP spec，使用内存仓储，不等价真实部署。
- **隔离 PostgreSQL / 浏览器 E2E / GitHub live**：需要用户授权的外部目标，未执行时一律记为 unverified。

## 未验证

- 真实 PostgreSQL：迁移 apply、跨项目复合外键、不可变触发器、并发事务与回滚。
- 真实 Nest HTTP 会话链与浏览器闭环。
- GitHub live 分页/验签/提交级证据。
- Node 版本矩阵（规格 Node 20/24，本机 v22.22.2）。

详细阻塞与解除条件见 `.agent-local/workmesh-v1/BLOCKED.md`，轮次记录见 `.agent-local/workmesh-v1/PROGRESS.md`。
