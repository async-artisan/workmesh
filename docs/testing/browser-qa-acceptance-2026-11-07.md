# 浏览器 QA 人工验收验证记录（2026-11-07）

隔离环境中的真实浏览器回归已通过三项测试，覆盖账户链路、匿名 CSRF 拒绝，以及 QA Agent 交付后由人在浏览器签字的路径。QA 任务验收通过后仍保留未完成的 IMPL，RELEASE 继续等待前置；本记录不能标记完整 B3 交付闭环通过。

## 验证对象与命令

- 源码工作目录：`G:/yesgoo/workmesh`；实际执行副本：`G:/workmesh-box-validation-20261106-212834/source`。
- 运行时：Node.js `24.22.1`；Playwright Chromium，无头模式，单 worker，零自动重试。
- 独立 PostgreSQL 监听 `127.0.0.1:58160`，使用专属测试数据库 `workmesh_test_browser_20261106` 与 `workmesh_v1` schema。测试入口先校验显式测试库配置，不回退使用日常数据库。
- Playwright 自行启动 API `55442` 和 Web `55443`，配置 `reuseExistingServer: false`，未复用用户已有服务。
- 用例来源：[账户回归](../../tests/browser/account.spec.ts)、[QA 业务链](../../tests/browser/business-chain.spec.ts)、[浏览器配置](../../playwright.config.ts) 和[数据库防护入口](../../scripts/test-browser.mjs)。

在上述隔离副本、已构建 API/Web 与显式测试库环境下执行：

```powershell
pnpm test:browser:run
```

保存结果文件后的最终运行 `browser-tests-final.log` 记录 `3 passed (1.1m)`，使用修复后的源码构建结果。`browser-tests-attempt8.log` 仅保留为此前一次通过的历史日志。此前验证过的 Windows Box ZIP 早于后续密码二验修复，不能据此声称该 ZIP 已包含本次修复。

## 实际覆盖

| 用例        | 实际验证                                                                                                                                     | 结果 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 账户与会话  | 浏览器注册、HttpOnly/SameSite Cookie、浏览器存储不含 token/secret 键、创建项目、刷新保持会话、登出后受保护页跳转、重新登录；未发生 pageerror | 通过 |
| 匿名 CSRF   | 先读取匿名会话，再不携带 CSRF 令牌请求注册，真实 API 返回 `403` 与 CSRF 错误                                                                 | 通过 |
| QA 人工验收 | 公开 API 建立发布基线和流程；真实 QA Agent 凭据认领、快照与交付；人在浏览器读取证据、密码确认签字；刷新及重新读取 API 验证持久化与发布阻塞   | 通过 |

QA 业务链没有使用请求 mock、直接数据库插入或虚构实现证据。共享 [first-run workflow helper](../../scripts/lib/first-run-workflow.mjs) 通过公开 API 发布 UNDERSTANDING、PRD 与接口 KNOWLEDGE；各次发布、流程发布和仓库声明分别使用真实的动作预览、密码确认票据及幂等键。

PRD 的交付范围包含 frontend、qa、ops 和必需产物 IMPL、CASES、RELEASE。流程保留并行的实现与 QA 步骤，发布步骤依赖两者；QA 验收条款由 cases 任务覆盖。仓库采用显式 `DECLARED` 身份和保留域名 `first-run.invalid`，只为未完成的实现任务声明范围，不构成 provider 验证或代码证据。角色输入标识引用实际发布 revision，QA 任务的 `PUBLISHED_PRD` 快照还会明确比对真实 PRD 与 UNDERSTANDING revision。

设备授权的创建、lookup、批准和轮询使用公开 API；后续请求使用实际签发的 QA Agent bearer 凭据执行 claim、context snapshot 和 CASES 交付。CASES 是带原始字节长度与 SHA-256 的托管 Markdown 工件。人类随后在浏览器读取工件预览与已发布 PRD 的验收标准，填写评审说明，经真实密码确认后提交批准。设备授权批准本身没有通过设备授权页面操作。

最终断言同时要求：

- 评审为 `APPROVED`，只有一条预期的 `APPROVE` 决定，记录预期的人类邮箱与说明。
- QA 任务为 `DONE`，`currentClaim` 为 `null`；浏览器刷新后仍显示该决定，任务行保留决定人。
- ready 集合只剩 `impl`，完成的 `cases` 不再出现，`release` 不可领取。
- 浏览器中的发布任务状态为 `WAITING_PREDECESSOR`，没有把 QA 通过视为实现完成或发布签字。

## 实跑发现与修复

真实基线准备需要连续调用多个读取、发布与确认接口，加上应用正常的后台请求，曾触及默认每 IP 每分钟 `120` 次的全局限流。失败 API 返回 `429`，评审页面因需求上下文读取失败而正确禁止直接批准。测试没有使用“证据不完整仍批准”的例外，也没有提高服务限额或总超时。

当前测试在真实 Agent 交付后离开应用至 `about:blank`，卸载后台轮询，等待一次有界 `60` 秒窗口冷却，再重新进入需求和评审页面读取完整证据。业务链总时限仍为 `90` 秒。票据与决定的响应等待在点击前建立，并核验真实 HTTP 状态；页面不满足前置条件时保留错误详情和失败 API 诊断。

冷却后还发现独立的密码二验缺陷：准备阶段的三份文档审批、流程发布与仓库声明已成功使用五次密码确认，第六次 QA 签字却收到 `password-verify-session` 的 `429`。原实现对所有密码验证请求计数，与[身份权限契约](../superpowers/plans/workmesh-technical-v1/01-identity-permissions.md)中“每会话每 15 分钟最多五次失败”的规定不一致。

修复后的 [reauthenticate](../../apps/api/src/auth/v1-account.service.ts) 在密码比较前通过 PostgreSQL 条件 UPSERT 原子预约名额；错误密码、无效账号或校验异常保留该名额。正确密码仅释放本次在原窗口预约的一格，不清零并发失败，也不扣减新窗口的失败次数。超额请求不能进入 bcrypt，429 返回当前窗口的实际剩余秒数。[数据库实现](../../apps/api/src/auth/v1-auth.prisma-repository.ts)与[定向安全回归](../../apps/api/src/auth/v1-password-rate-limit.spec.ts)保留了失败与在途请求的并发上限。全局限流、每动作密码确认和一次性绑定票据均继续生效。

此前失败的 `attempt3` 至 `attempt6` 日志保留为定位证据，不能计入通过结果。

## 证据与公开边界

原始日志目录为 `G:/workmesh-box-validation-20261106-212834`。最终日志 `browser-tests-final.log` 记录三项通过；执行副本内 `.tmp/browser-results/.last-run.json` 的状态为 `passed`，`failedTests` 为空。

业务链现在会将 `business-chain-result.json` 写入 `testInfo.outputPath`，再以路径形式附加到 Playwright 结果。该 JSON 记录项目、需求、任务、评审、决定、真实发布基线标识、ready 步骤和未覆盖范围；它不包含登录密码、会话 Cookie、Agent secret 或确认票据。仅调用 `testInfo.attach({ body })` 配合 list reporter 的旧轮次没有留下独立附件文件，不能把其内存附件声称为已保存工件。

最终实际文件为：

```text
G:/workmesh-box-validation-20261106-212834/source/.tmp/browser-results/business-chain-real-Agent--dc939--stays-blocked-after-reload/business-chain-result.json
```

该文件 SHA-256 为 `6a75191629bd37b0f87b58d20e6a2851de8735cad11d0dbc5b63bbb8d455f6aa`。已读取的关键字段如下：

| 字段                               | 实际值                                 |
| ---------------------------------- | -------------------------------------- |
| `projectId`                        | `c9c53f84-5f7f-4d5d-a32f-49a680395336` |
| `requirementId`                    | `1a8193fa-e130-45d4-8cf9-8167e8b010e2` |
| `taskId`                           | `c5839ee9-8ab1-4cb2-81cc-c169e59aa356` |
| `reviewId`                         | `3d560296-7d6b-4e6b-81fa-171e4ba76fe4` |
| `decisionId`                       | `8a3e1be5-e54f-4258-b227-1af9a753713b` |
| `reviewStatus` / `taskStatus`      | `APPROVED` / `DONE`                    |
| `nextReadySteps` / `releaseState`  | `["impl"]` / `WAITING_PREDECESSOR`     |
| `baseline.prdRevisionId`           | `7ca6bbf9-365d-4451-98cb-f5e800876be0` |
| `baseline.understandingRevisionId` | `c07dde9f-17cd-4640-9428-78f37e986a3a` |

原始失败页面快照可能含测试密码输入，隔离数据库、配置、Cookie、授权 secret 与确认票据不应随公开 CI artifact 上传。[CI 浏览器证据配置](../../.github/workflows/ci.yml)已将该真实浏览器套件的上传范围收窄为 `.tmp/browser-results/**/business-chain-result.json`。本地公开证据同样限定为核对过的成功日志和最终结果 JSON。

## 未覆盖与结论限制

本次通过的是 QA 人工验收链。知识发布使用 API 完成，尚未验证浏览器中的知识候选创建、发布、撤销；也未完成真实代码实现与代码证据、发布签字、变更传播及确认。因此完整 B3 仍未完成。

[first-run-demo.mjs](../../scripts/first-run-demo.mjs) 已使用同源 helper，并补齐真实基线、QA 角色与持久化断言。该脚本明确使用 HUMAN 会话执行 claim/delivery，不代表真实 CLI 设备授权端到端。本轮为独立实跑它而启动专用 API 的命令被自动审批以 `blocked by policy` 拒绝，未给出具体原因；因此不能将浏览器通过扩展为该脚本独立实跑通过。

本记录也不代表干净机器安装、远程最终提交 CI、正式发布制品、生产容量、跨平台或完整安全审计通过。
