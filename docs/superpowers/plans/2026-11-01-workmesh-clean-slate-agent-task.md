# WorkMesh 新方案清理重建与完整开发任务书

日期：2026-11-01  
用途：直接交给开发 Agent 执行。目标是让仓库最终只有一套 WorkMesh 新方案实现。

## 一、目标与硬边界

以现有新方案的产品语义、权限模型、工作流和数据约束为唯一标准，完成可运行的 WorkMesh。旧开发代码、旧数据库模型、旧认证方式、旧 CLI/Web 调用全部退出，不提供兼容层、fallback、双写、旧数据导入器或旧接口别名。`/api/v1` 可以保留，因为它是正式协议路径；`v1-*` 只是当前实现来源，最终应按正式领域命名收敛。

保留当前工作树所有不属于本任务的修改，不执行 reset、stash 清场、整仓覆盖、commit、push、部署，不读取或输出 `.env*`、密码、Token、证书和完整连接串。不修改其他仓库。

数据库要求：源码只保留一份正式 Prisma schema、migration 入口和 client。先只读盘点旧 schema、旧 migration、已应用状态；删除仓库中的旧模型和旧迁移源码，建立新方案干净初始 migration。不得擅自删库、删表、重建外部数据库或改生产环境；这些动作必须单独获得明确目标、影响、回滚和验证授权。没有真实数据库时，源码可继续完成，但 DB/并发/E2E 标为 `unverified`。

## 二、执行顺序

### S00 基线与现状固定

先读本文件、`PROGRESS.md`、`BLOCKED.md`（若不存在则创建），以及 `docs/superpowers/plans/` 下主技术方案和 01–06 分册。检查真实 Git 根、分支、工作树 diff、脚本和包入口；不得重做已完成的任务 0。记录≤10行开工回执：目标、顺序、最大风险。

立即运行 API 类型检查，修复当前已知错误：artifact Prisma createMany 缺少 `artifactSetId`，以及 artifact spec 的 TaskRepo/Authz 替身接口不完整。禁止用 `any`、排除文件、关闭 strict、删测试或放宽断言。

### S01 Prisma 与数据库清理重建

以新方案 schema 为唯一 `apps/api/prisma/schema.prisma`；将 `apps/api/prisma/v1/schema.prisma` 的有效模型整合到正式入口后，删除旧 schema 文件和旧 migration 源码（删除前只读保存摘要，不保留 legacy/import 运行路径）。PrismaModule 提供唯一受管 client；移除领域内 `new PrismaClient()`、旧 client import 和重复生成脚本。

完成新方案的实体、复合外键、不可变记录、审批槽、版本指针、幂等键、审计与约束；生成干净初始 migration，统一 validate/generate/build/type-check 入口。为真实数据库准备失败回归：跨项目 FK、重复 claim/slot/operation、不可变更新/删除、事务回滚、并发发布。未获数据库授权时不得 apply，只记录命令和未验证原因。

### S02 正式 Auth 与授权

将 opaque WebSession、AgentCredential、Principal、scope、CSRF/Origin、撤权、确认票据整合进唯一 AuthModule。删除旧 JWT、refresh、客户端自报身份、旧登录路由和旧 guard 注册。补齐注册/登录/登出、设备授权 PKCE、poll、拒绝、凭据列表/撤权、action preview、密码二验和单次 confirmation ticket。权限必须由服务端主体、项目、角色、版本、digest 计算；不得由请求体推导。

### S03 知识、理解、PRD、评审、工作流

将 knowledge/review/PRD/workflow/context 的新实现合并为正式领域模块，移除旧 signoff、直接发布和重复 review 路径。实现候选→槽位审批→精确 digest 发布→受限读取；UNDERSTANDING、PRD、KNOWLEDGE 分别遵守自身审批语义。实现受限 DAG、角色包锁定、确定性 ContextSnapshot、撤销/返修和依赖传播。禁止把 draft 当 published，禁止旧票据批准新摘要。

### S04 任务、工件、变更、看板、追踪

把 `v1-task/artifact/change/board` 的有效逻辑收敛到正式模块，删除旧 tasks/artifacts/changes/board/signoff 旁路。实现 claim/release/work-status 代次、真实 artifact bytes、GIT_REF 完整定位、候选输出、评审槽、门禁、release、收件 ack 和游标分页。禁止客户端只提交摘要、交付时临造 manifest、直接写 DONE。补齐并发冲突、幂等重放、旧 claim 失效、缺 bytes/仓库、旧基线交付拒绝。

### S05 GitHub 适配与证据

实现厂商中立接口的 GitHub adapter：分页、稳定仓库身份、多仓范围、Webhook 验签/去重、提交级 CodeReviewEvidence、prepare-code-evidence。作者自审、Bot、旧 SHA、dismissed、changes_requested、head 变化和坏签名必须拒绝。无 GitHub 授权时完成 fixture/HTTP adapter 测试，live 明确未验证，不伪称通过。

### S06 CLI

将 CLI 切换到正式 API 和 AgentCredential。`login` 只走浏览器设备授权，删除密码登录、HUMAN refresh、旧 token 存储和旧命令 fallback。完成角色包安装/锁定、materialize 冲突保护、candidate/context/claim/deliver/review/receipt/changes 命令；离线不得声称 fresh，批准动作引导 Web。验证临时 home、打包 dist、资源完整性和错误 envelope。

### S07 Web

Web 只使用正式 API、cookie WebSession 和 CSRF，不把 HUMAN token 写入 localStorage。完成项目、知识、PRD、看板、角色/ACL、授权、preview/二验/评审、返修/撤销页面；按钮状态不能代替服务端拒绝。为真实权限、slot、digest、版本、过期证据和错误 envelope 编写浏览器测试。

### S08 删除旧路径与总验收

按调用图逐项删除旧 controller/service/module/DTO/test、旧 Prisma 模型/migration、旧 CLI/Web 客户端和文档示例；不得用 re-export、别名、双路由伪装删除。更新 README、API、CLI 帮助、CI、runbook、PROGRESS/BLOCKED。每删除一域先跑该域测试，再跑全量。

## 三、验收命令与证据

至少执行并记录退出码、测试数、skip 数和未验证原因：

```bash
corepack pnpm --filter @workmesh/api exec tsc --noEmit --incremental false
corepack pnpm --filter @workmesh/shared test
corepack pnpm --filter @workmesh/cli test
corepack pnpm --filter @workmesh/web test
corepack pnpm test:contracts
corepack pnpm build
git diff --check
```

另行区分源码/类型、单测/mock、真实 Nest HTTP、隔离 PostgreSQL、浏览器、GitHub live 六类证据。禁止 `.skip`/`todo`/恒定 SKIP、`|| true`、mock 核心实现、删除测试、降低断言、关闭约束来制造通过。真实 DB、浏览器或 GitHub 缺环境时继续完成安全源码工作，并在 `BLOCKED.md` 写清阻塞目标、所需授权和恢复命令。

## 四、完成条件

只有同时满足以下条件才可报告 `completed`：

1. 代码、Prisma schema/migration/client、Auth、knowledge/review、tasks/artifacts/change/board、CLI、Web 各只有一套正式实现；旧代码和旧数据库模型已从仓库移除，无兼容 fallback。
2. 类型检查、契约、包测试、构建和 diff 检查通过；真实 HTTP/DB/浏览器/GitHub 未验证项逐项标注，不能用单测代替。
3. `PROGRESS.md` 有每阶段命令与结果，`BLOCKED.md` 仅列真实外部阻塞；未完成但仍可独立推进的项目标 `partial`，不可把未授权环境写成通过。
