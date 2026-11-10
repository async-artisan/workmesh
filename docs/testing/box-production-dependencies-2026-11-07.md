# Box 生产依赖与新制品验证：2026-11-07

本轮已把 Box 从全部 API 开发依赖部署改为 production deploy，并验证实际部署目录及重新构建的新 ZIP。Prisma 迁移工具、运行时引擎和应用依赖保留，Nest CLI 与此前匹配公告的三个 npm 包已移除。新 ZIP 的本机隔离生命周期检查通过；这仍不是最终干净 commit 的远端 CI、新机、旧版升级、卸载或生产验收，也不是完整 SBOM。

## 改动范围

[API manifest](../../apps/api/package.json) 将 `prisma: ^5.21.1` 从 devDependencies 移到 dependencies，实际版本仍锁定 `5.22.0`。[锁文件](../../pnpm-lock.yaml)只移动 importer 分类，没有升级依赖。[打包脚本](../../scripts/package-box.ps1)使用 `pnpm --filter @workmesh/api deploy --legacy --prod`，保留 schema、Prisma CLI、Client 和自定义生成客户端的既有路径检查与复制逻辑。

安装入口直接运行 `app/api/node_modules/prisma/build/index.js`，因此必须显式保留 Prisma；应用启动只运行已构建的 `dist/main.js`，Box 备份恢复使用随包 PostgreSQL 工具。保留迁移 CLI 不再要求交付 Nest CLI、编译器和测试工具。

## 独立 production 部署验证

环境为 Windows x64、Node.js `24.22.1`、pnpm `10.28.2`。在全新本地目录 `G:/workmesh-box-prod-dependencies-20261107-r1/` 执行实际 production deploy，未启动数据库或 API，得到以下结果：

| 检查                          | 实际结果                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 已安装 package manifest       | 136 条记录、135 个唯一 name/version；计数不是扫描器 component 数                                                   |
| Prisma CLI / Client / engines | 均为 `5.22.0`，query/schema engine hash 匹配 `605197351a3c8bdd595af2d2a9bc3025bca48ea2`                            |
| 运行依赖路径                  | Nest、Prisma、shared、role-packages 的真实路径全部位于部署目录内                                                   |
| 迁移                          | 保留全部 20 项迁移                                                                                                 |
| 迁移工具                      | staging 内 `prisma --version`、`migrate deploy --help`、`prisma generate` 均成功                                   |
| 生成客户端                    | 自定义客户端、原生 query engine 和 `PrismaService` 模块可加载；没有连接数据库                                      |
| 开发工具移除                  | 不含 Nest CLI/testing、deepmerge、glob、minimatch、ESLint、TypeScript、Vitest、tsx、SWC、supertest、webpack        |
| 生产审计                      | 166 个依赖，低危、中危、高危、严重均为零；全量工作区公告另见[依赖审计](../security/dependency-audit-2026-11-07.md) |

随后仅复制 10,771 个常规文件到另一全新目录，跳过 362 个 junction 以模拟 ZIP 丢失依赖链接；现有恢复器恢复 362/362 条链接，再次通过相同模块与清单检查。最初直接对原始 pnpm staging 运行 restore 时，源码自别名与 collect 后包内自别名不一致，保护检查拒绝覆盖；未删除或绕过保护，改用符合恢复前提的无链接副本验证。该步骤是依赖迁移 smoke，不是完整 Box ZIP 生命周期。

本阶段的模块 smoke 使用已有 dist，只证明依赖加载；后续新制品另行同步源码并重新构建。frozen-lockfile、定向 Prettier、PowerShell AST 和 diff 检查通过。主要证据为本地 `summary.json`、`installed-package-manifests.json`、`prisma-generate.log`、`relocated-summary.json`；没有把这些本机路径当作公开下载地址。

| 证据                               | SHA256                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| production stage `summary.json`    | `8d0c18636f9f512c60db1d5ecdc9972bb186032a36f11309bd2a5c7cdd9dcdf8` |
| `installed-package-manifests.json` | `f8bb296e8e976f0d22bd36c2523604f8689ef7bdf66ce5a124f4a70681a5b915` |
| 生产依赖审计 JSON                  | `018a0f03a3f4b872d5c0709c4508a8ba927e715b4071c67abc0ac5e61c9ea844` |

## 实际重新构建与归档

将最新工作树的构建相关 tracked 文件同步到独立副本，使用相同 Node/pnpm 完成 frozen 安装和全仓无缓存 build：6/6 任务通过、0 缓存。初次打包因隔离副本缺少 `verify-cli-package.mjs` 失败；完整同步文件并重新构建后，在全新 `package2` 目录打包成功，未把失败目录覆盖为成功结果。成功日志同时记录六个角色、55 个资源和 CLI smoke 通过。

本轮制品包含修正后的认证源码与 production deploy 改动。版本声明为 `1.0.0`，源 HEAD 声明为 `739367a714097a825b96ca7ecf6bce3372855a77`，工作树为 `dirty`。这是构建者声明，不能证明干净检出或重现构建来源。

| 新制品          | 字节数      | SHA256                                                             |
| --------------- | ----------- | ------------------------------------------------------------------ |
| Windows Box ZIP | 197,721,487 | `ff80618f58e2eb2c6f7b592a4abd0d01e06603c6f9d07802f2efa011b28b10bf` |
| 独立 CLI ZIP    | 36,708,339  | `f791a76f0cec1c29d797f58d4a575d81eef6b304489cdb3c8be25719d8c06140` |

本地验证根目录为 `G:/workmesh-login-validation-20261107-r1/`。ZIP 位于 `package2/`，安装与构建日志为 `isolated-install.log`、`isolated-build-all.log`；失败打包日志为 `package.log`，成功重试为 `package-attempt2.log`。

## 新 ZIP 的扫描与运行结果

固定 Syft `1.57.0` 对实际 Box/CLI ZIP 分别扫描，扫描前后核对文件集合、长度及 SHA256，Box 内嵌 CLI ZIP 与独立 CLI 哈希绑定通过。Box 核对 12,484 个文件、492,045,193 展开字节，识别 276 条 component、160 条 npm 和 23 条 UNKNOWN；CLI 核对 73 个文件、96,017,391 展开字节，仍只识别 Node.js 一条 component。

已直接核对新 ZIP 的 `.pnpm` 归档路径及本轮 Syft 清单，不存在 Nest CLI、deepmerge、glob、minimatch 的已安装 npm 清单；Prisma CLI、Client、engines 仍为 `5.22.0`。这证明此前随包的 deepmerge `4.3.1`、glob `13.0.6`、minimatch `10.2.6` 已从该新 ZIP 的已安装依赖范围移除。工作区四项开发依赖公告仍未关闭；早期 Box 中 minimatch 的来源是 Nest CLI → glob，不能据根 ESLint 的审计路径推断 ESLint 本身随包。

扫描证据位于本地 `artifact-scan/evidence/`；精确输入、工具哈希和归一化字段见其 `artifact-sbom-draft.json`。清单继续标记 `DRAFT_PARTIAL_COVERAGE`，CLI/Web bundle 模块、原生内嵌组件、许可证、UNKNOWN 分类和完整 CycloneDX schema 仍未补齐。原始 `scan.log` 为私有诊断日志，即使本次为空也不公开；公开资产应另按实际文件集合计算校验和。详见[制品 SBOM 验证](artifact-sbom-validation-2026-11-07.md)。

同一 Box SHA 的 `lifecycle/summary.json` 为 **PASSED**：全部 20 项迁移；首次、冷、重复、恢复库四阶段 API 直连和 Web 代理均为 `ok`、Web HTTP 200；备份验证核对 55 张表（含验证标记表）、20 项迁移和恢复标记一致，临时验证库已移除；检查器结束时 `ownedServicesStopped=true`。dump SHA256 为 `23a0e3feeaf2100c1172db2ff09f55431a3335472c287dbcf4e4f3652eda9a32`。该停止字段描述生命周期检查器完成时的状态，后续独立数据库回归另留记录。

认证配套验证由主任务另外记录：API 单元为 688 项通过；全新隔离库应用 20 项迁移后，根 integration 为 159 项通过、1 项真实 Ollama POC 跳过，其中包括新增登录限流 5 项和既有原子预约并发 4 项。这些本机工作树结果不替代最终候选的远端 CI。

## 保留的验收边界

早期 ZIP SHA `7710af641a6f50497495482eeb3bf10f12cadc726d5a714a14c32580008324dc` 的 813 条 component、692 条 npm、37 条 UNKNOWN 及三项受影响包存在记录继续保留，不能因新包通过而把旧包改写为已修复。

本轮证明新 production ZIP 的依赖移除、Windows 隔离安装和当前版本恢复链能运行。最终干净 SHA 的远端 CI与平台检查、新机器、旧版本升级、卸载、生产迁移及恢复 RTO/RPO、跨平台、长期稳定性和外部真实团队仍未验收。完整 SBOM 与工作区开发依赖公告也没有关闭。
