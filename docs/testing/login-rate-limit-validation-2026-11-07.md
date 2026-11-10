# 登录邮箱失败限流验证：2026-11-07

本次修复登录成功也占用邮箱失败额度的问题。Node.js 24.22.1 下，认证目录 92 项、全 API 单元 688 项通过；专属 PostgreSQL 17.11 空库应用全部 20 项迁移后，根集成套件 159 项通过、1 项真实 Ollama POC 跳过，其中新增五项真实登录数据库场景均通过。结果来自 `739367a714097a825b96ca7ecf6bce3372855a77` 加本轮未提交改动的本地快照，不能替代最终发布 commit 的远端 CI。

## 契约与实现

[身份与权限契约](../superpowers/plans/workmesh-technical-v1/01-identity-permissions.md)规定每 email 每 15 分钟最多五次登录失败、每 IP 每 15 分钟最多 30 次尝试。原先 login-email 在 bcrypt 前计入所有尝试，正确登录也会累加；连续成功后可能阻断正确密码。

[账户服务](../../apps/api/src/auth/v1-account.service.ts)复用二验已有的原子预约接口，在 bcrypt 前预约邮箱失败额度：最多五个失败或正在校验的请求。错误密码、未知或停用用户和比较异常保留预约；正确且活动的用户只释放自己的原窗口预约，不清其他失败或新窗口。预约或退款存储错误时不创建认证会话。超限不会再递增邮箱计数，429 返回该固定邮箱窗口实际剩余秒数。

邮箱 trim/lowercase 后继续使用原有双 SHA256 key，以保留升级前窗口。旧窗口可能包含修复前的成功次数，保守沿用到期，不通过更换 key 清除。未知用户仍经过 dummy bcrypt 并返回同一 AUTH_INVALID。login-ip 继续统计全部尝试；没有更改 repository、数据库 schema 或迁移。

## 验证范围

[新增登录单测](../../apps/api/src/auth/v1-login-rate-limit.spec.ts)共 13 项，覆盖重复成功、既有失败、五次失败后阻断、规范化邮箱和旧 key、五并发上限、混合结果退款、跨窗、冷却、未知和停用用户、比较异常、IP 第 31 次请求，以及预约/退款存储异常时不创建会话。完整 auth 目录 13 个文件、92 项通过；全 API 单元 79 个文件、688 项通过。

[真实数据库回归](../../apps/api/test/v1-login-rate-limit.database.spec.ts)使用实际 V1AccountService、Prisma repository 和 bcrypt。五项场景分别核对六次正确登录后的失败计数与会话/token/CSRF 持久化、跨 IP 错误与成功退款、24 个并发错误中只有五个 AUTH_INVALID 和 19 个邮箱限流、未知账户，以及旧 key 和下一窗口恢复。测试在创建 PrismaClient 前通过数据库门禁；唯一用户、邮箱、IP、会话和固定窗口确保清理只匹配本套件记录。

本轮完整根入口在新建 `workmesh_test_login_20261107` 库上执行，SQL 身份核对为 loopback 58370、postgres 用户和准确库名，显式允许该本地测试用户。全部 20 项迁移成功；19 个集成文件通过、1 个跳过，159 项测试通过、1 项跳过。跳过的是需要单独显式启用的真实 Ollama POC，不是登录测试。检查结束后核验 DataDir、PID、exe、命令行、SQL 和 listener 身份，停止本次专属服务；58370/58380/58381/58382 均释放。

构建副本同步当前受版本管理的构建源码，在 Node.js 24.22.1 下 frozen 安装和全仓无缓存构建 6/6 通过。包含本修复的新 ZIP 安装恢复也通过，详见[Box 运行依赖缩减验证](box-production-dependencies-2026-11-07.md)。类型检查、ESLint、Prettier、release/integration runner 九项回归和 CLI 归档检查四项回归均通过。

## 本地证据与运行边界

原始证据保留在本机忽略目录 `G:/workmesh-login-validation-20261107-r1`，没有随仓库公开归档：

- `api-unit.log`：688 项 API 单元通过。
- `integration.log`：20 项迁移和 159 passed / 1 skipped。
- `isolated-install.log`、`isolated-build-all.log`：frozen 安装及 6/6 无缓存构建。
- `lifecycle/summary.json`：新 ZIP 的安装、健康、备份恢复与自有服务停止。
- `pg-start.stdout.log`、`pg-stop.stdout.log`：专属数据库的启动与停止。

最初直接执行新目录 initdb/pg_ctl 时返回 Permission denied/Access is denied，失败日志仍保留。后续使用生命周期检查器实际采用的隐藏子进程启动方式及新解压运行时后成功；没有据此确定操作系统拒绝的根因，没有删除失败记录。此前首次使用 demo 独立 API 启动曾被自动审批拒绝，本轮没有重试该动作，也不将数据库或安装包检查解释为该脚本已独立通过。

## 仍未关闭

- 此报告阶段的注册/登录独立 IP 窗口及通用冷却差异已在后续源码修复；新的单元、真实数据库结果和停止旧认证写入的部署边界见[共享 IP 限流验证](shared-ip-rate-limit-validation-2026-11-07.md)。本报告的旧 ZIP 与计数保持历史快照含义。
- 进程异常退出时未释放的预约会保留到原窗口结束，采用保守限流。
- 最终 clean SHA 的远端 CI、生产流量、分布式限流、完整浏览器 B3 和外部团队证据仍不足，见[阻塞项](../../BLOCKED.md)。
