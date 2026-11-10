# 全仓格式与 ESLint 收尾：2026-11-07

本轮在 Windows、Node.js 24.22.1、pnpm 10.28.2 下完成全仓格式与 ESLint 检查，两项均 exit 0。结果来自未提交工作树，只证明这两项检查在记录时的结果。

## 改动与检查范围

- `.gitignore`、`.prettierignore` 与 `eslint.config.js` 对齐历史 `.p0a` 隔离生成目录和临时预览脚本的忽略范围；没有把应用源码目录整体排除。
- [Knowledge 页](../../apps/web/src/pages/Knowledge.tsx)只删除未使用的 `TableSkeletonRows` import。
- [pnpm 定位器](../../scripts/lib/pnpm-runner.mjs)只为读取候选 manifest 失败的 catch 添加继续向父目录搜索的说明。
- [onboarding 设计](../design/project-workspace-onboarding.md)与[onboarding 验收记录](workspace-onboarding-acceptance.md)只作格式调整。

检查从仓库根目录执行。完整本机日志保存在 `G:/workmesh-shared-ip-validation-20261107-r1`，下表 SHA-256 与文件长度已独立重读核对；退出码由执行记录确认，日志本身不额外写入退出码。

| 命令                | 结果                                   | 日志                             | 字节数 | SHA-256                                                            |
| ------------------- | -------------------------------------- | -------------------------------- | -----: | ------------------------------------------------------------------ |
| `pnpm format:check` | exit 0，所有匹配文件符合 Prettier 样式 | `format-check-quality-final.log` |    186 | `0889330b1213a62d5af0391c3413abf8da4970a0db5efdfcc482e497b9084e4f` |
| `pnpm lint:eslint`  | exit 0                                 | `eslint-quality-final.log`       |     65 | `8cc6d33cc2c2c3a5c6022ea99f7a8cb391822ce4b2091a12817b5341ca51f0d3` |

## 来源变化与验收边界

旧 Box ZIP 的 SHA-256 为 `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d`。其解压 Web `bundle-evidence.json` 记录 Knowledge 输入哈希为 `22212f6f48a9604e293bd1f0d5d22bb94671d5f251ac63a28aabebb0031867eb`，与原隔离构建副本中的文件一致。删除未使用 import 后，当前工作树该文件的 SHA-256 为 `3f3f714cc770e06d66917591e6e1127f7c65a002283ea2db4065fce0f057a541`。

旧 ZIP 的构建、扫描、bundle 和生命周期通过记录继续适用于其历史来源，不能扩大为当前源码已完成制品验收。即使本轮改动有限，也尚未由这两项静态检查证明新 bundle 输出相同；当前源码需重新隔离构建、打包并按相应门禁验证。旧制品范围见[bundle 验证记录](bundle-evidence-validation-2026-11-07.md)。

本记录不重写依赖审计结果：截至本次记录，四项工作区公告仍开放，兼容修复、可达性或维护者风险批准需单独记录。最终候选的干净 SHA、完整质量门禁、远端 CI、新机、升级卸载、生产和外部团队验收也继续保留，见[发布与升级验收](../releasing.md)和[当前状态](../phase-status.md)。

## 同日后续：Node.js 20.19.0 完整验证

以下是后续隔离源码副本的结果，保留前文格式检查与旧制品的历史边界。副本位于 `G:/workmesh-box-validation-20261106-212834/source`，来源仍声明为 `739367a714097a825b96ca7ecf6bce3372855a77` 加未提交改动，不是最终 clean SHA。验证使用 pnpm 10.28.2 和实际返回 `v20.19.0` 的官方 Windows x64 Node.js 可执行文件；其路径为 `G:/workmesh-shared-ip-validation-20261107-r1/node20-baseline/node.exe`。独立计算的 SHA-256 为 `6e3a39787e667d50487f7335c85636c2823a53e636d73c2c841d45da4e57906c`，与同目录官方 `SHASUMS256.txt` 的 `win-x64/node.exe` 条目一致。没有提高项目的 Node.js 最低版本。

| 检查                     | 后续实际结果与范围                                                                                               | 日志                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| frozen-lockfile 安装     | 成功；锁文件为最新，使用 pnpm 10.28.2                                                                            | `node20-frozen-install.log`     |
| 全仓构建                 | 6/6 任务成功，0 cached                                                                                           | `node20-build-final.log`        |
| 全仓类型检查             | 10/10 任务成功，0 cached                                                                                         | `node20-types-final.log`        |
| 全仓测试                 | 8/8 任务成功，0 cached；API 713、Web 527、CLI 288 passed / 2 skipped、shared 73、role-packages 24、Box 23 passed | `node20-workspace-tests.log`    |
| 运行时契约               | 18 项通过                                                                                                        | `node20-contracts.log`          |
| 脚本防护回归             | 71 项通过，0 failed / skipped                                                                                    | `node20-guards.log`             |
| API 完整覆盖率（修复后） | 904 passed / 1 skipped，全部覆盖率阈值通过，exit 0；跳过真实 Ollama POC                                          | `node20-api-coverage-final.log` |
| 根集成入口（夹具修复后） | 20 个文件通过、1 个跳过；172 passed / 1 skipped（真实 Ollama POC），exit 0                                       | `node20-integration-final.log`  |
| Chromium UI review       | 54 项通过；使用 mock API，属于界面与交互检查                                                                     | `node20-ui-review.log`          |
| 真实浏览器链             | 3 项通过：账户/会话、CSRF 拒绝、QA 交付与人工批准；IMPL 未完成，RELEASE 继续等待前置                             | `node20-browser-final.log`      |

全仓测试先于下述 19 项新仓储单测运行，因此表中的 API 713 不能改写为已经重跑后的全仓结果。后续完整 API coverage 已包含新增 19 项；其通过不能替代其他包的新一轮全仓运行。UI review 的 54 项和真实浏览器的 3 项也不能合并称作完整 B3、跨浏览器或无障碍验收。

### 首次失败、修复与重跑

首次 API coverage 运行已有 885 passed / 1 skipped，全局 lines 为 81.93%、branches 为 68.28%，但工件 Prisma 仓储仅 lines 80.35%、branches 64.03%，低于该路径的 84% / 68% 门槛；命令因此 exit 1。失败日志 `node20-api-coverage.log` 继续保留，没有因总体测试通过而把它记为成功。

随后新增[工件仓储安全回归](../../apps/api/src/tasks/v1-artifact.prisma-repository.spec.ts)，19 项测试覆盖 HOSTED 字节与元数据、GIT_REF 不伪造正文、外部检查来源、已消费票据与项目范围、失效及跨凭据认领、跨项目快照和仓库、审批契约缺失、任务版本 CAS 失败与幂等唯一冲突不重试。生产仓储源码与覆盖率阈值均未修改；模拟事务测试不声称证明真实 SQL 回滚，该职责仍由现有数据库套件承担。

完整 coverage 重跑为 904 passed / 1 skipped，所有阈值通过。全局 lines 82.18%（5691/6925）、branches 68.71%（4231/6157）；该仓储 lines 95.53%（107/112）、branches 87.71%（100/114）。独立重读的 `coverage-summary.json` SHA-256 为 `785604034f1a0176a62dce3ed1602442911794795673ed1c1eacc58cbebbbec7`。

另一次根集成入口运行应用了隔离迁移，但 `main-global-limiter.e2e-spec.ts` 的生产启动夹具因 `SECURE_REQUIRES_HTTPS` 退出：汇总为 171 passed / 2 skipped，1 个套件失败，exit 1，记录于 `node20-integration-current.log`。修复只在该 HTTP loopback 夹具显式设置 `LOCAL_INSECURE` 及对应 loopback Origin，没有修改生产 HTTPS 校验；定向重跑 1/1 passed，记录于 `node20-limiter-fixture.log`。该定向通过当时尚不证明完整集成已通过，最终重跑结果单独记录如下。

后续最终根集成已完成：`node20-integration-final.log` 为 20 个文件通过、1 个跳过，172 passed / 1 skipped（真实 Ollama POC），exit 0。两次日志均绑定同一显式隔离目标 `127.0.0.1:58390/workmesh_test_quality_20261107?schema=workmesh_v1`；首次运行已将全部 20 项迁移应用到该新库，最终重跑明确跳过重复迁移。因此最终通过不应表述为又一次从空库应用迁移，也不替代生产迁移或恢复验收。前述首次失败与定向修复记录继续保留。

验证结束后，主任务核对自有 PostgreSQL 的 PID、可执行路径、数据目录、监听端口和 SQL 身份，使用 `pg_ctl` fast stop 正常停止该实例，并确认 `postmaster.pid` 消失、58390 及生命周期 58410/58411/58412 端口无监听。`pg-quality-stop.log` 记录 `server stopped`，SHA-256 已独立重读核对如下；本记录没有操作其他已有业务服务。

### 日志与摘要绑定

下表日志均位于本机 `G:/workmesh-shared-ip-validation-20261107-r1`。文件长度、摘要与上述关键结果已独立读取；退出码由执行记录确认。原始日志只保留在本机，没有随本记录公开上传。

| 文件                                         | 字节数 | SHA-256                                                            |
| -------------------------------------------- | -----: | ------------------------------------------------------------------ |
| `node20-frozen-install.log`                  |   1175 | `81fd12fb18170a6c3732406fad25336731fcf7530e8f7923cfd12aea05df5c14` |
| `node20-build-final.log`                     |  10429 | `2bc8171ead34d21d9a1735e5c3982615f1a946f5c62e37173ca2125e7a804a50` |
| `node20-types-final.log`                     |   6495 | `1dba9b6ee9789922e515b1dfeb64ea99c102fecbf51ead53a3ebf27b9f98c1c5` |
| `node20-workspace-tests.log`                 | 242424 | `8ef2c96a6350c6c16f35aba341c3a3173c7ba0f2ddae30b5ff8c3a38af9cb2b1` |
| `node20-contracts.log`                       |   1804 | `5fd7255e57e244e6ed43e471e6ef3a12daab67e857d5011d0154c0899facd6ab` |
| `node20-guards.log`                          |  12761 | `a86c3c403976a8a9559cff061ca0e848b913a9ed640d1ed1b8f4620d87c8a9f5` |
| `node20-api-coverage.log`（首次失败）        |  15074 | `bb7baf55356ffb364a8a2cf1a7f952533d8f351003b4140b2d6a9986c7e4fe08` |
| `node20-api-coverage-final.log`              |  14631 | `7ca99c346c833f6c6ad23a642538b05d73ebca255b57ac45ea33bc147d38f18e` |
| `node20-ui-review.log`                       |   6855 | `4baad8828c2bb96dcd43323785a1ec40397e9475a2e67bab037540a8019cac9f` |
| `node20-browser-final.log`                   |    751 | `8ced2f82d7f0d900d12140d818b9a2abbeffcaff22e61ccafb13cd7251ff154b` |
| `node20-integration-current.log`（首次失败） |   7140 | `b76c257d18f0bbeae217f005c50962cf1695e943cfdcff3ce2511772392a44b2` |
| `node20-limiter-fixture.log`                 |    252 | `e4aa8ceb21430fbf7d072445317c239b4127a56d4b71cb33f84b35805791fdac` |
| `node20-integration-final.log`               |   2437 | `8b7c5d4ac870408dc10fe32d1940ed86109c268c1000b8476936f0220d54da0c` |
| `pg-quality-stop.log`                        |     58 | `3589d2bd01f8295cc7c9ec3f5e07625fcd347ccb6f33f2d80edafe5f5217c1fb` |

### 同日新制品与完整本机生命周期

后续隔离构建已将更新后的 Knowledge 输入和依赖处置纳入新制品。新 Web 侧车中的 Knowledge 输入哈希为 `3f3f714cc770e06d66917591e6e1127f7c65a002283ea2db4065fce0f057a541`，与当前源码及隔离副本一致；这项确认不改写旧 `029bbab6…` ZIP 的来源。

| 文件                     |    字节数 | SHA-256                                                            |
| ------------------------ | --------: | ------------------------------------------------------------------ |
| 新 Windows Box ZIP       | 197865930 | `96d555cd90526eee9b3ad6aaf541fdb2d1bbb604d6b155c26f3e1a70b24ec49e` |
| 新独立 CLI ZIP           |  36718187 | `f7c1ed041b90c51be34028a56ad2c757c8190c3941e14bbd923463552632ae30` |
| `package.log`            |      3325 | `81b03e2f9a5c8961fe7522a7e7597f33f2010113f5c1f6c2ed9f4bb4843a4852` |
| `lifecycle/summary.json` |      1265 | `81358bac078e5c762a56c4a94305c9397d47ec4778834aa728e06036d1b4cce5` |

上述文件位于本机 `G:/workmesh-quality-validation-20261107-r2`：Box 为 `package/workmesh-box-win-x64.zip`，CLI 为 `package/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip`。这些路径不是已发布下载地址。

独立重读生命周期 summary 为 **PASSED**，绑定新 Box SHA：全部 20 项迁移；首次、冷、重复及恢复库四阶段均为 API `ok`、代理 `ok`、Web HTTP 200；备份核对 55 张表和 20 项迁移，恢复标记一致，临时验证库已移除，`ownedServicesStopped=true`。备份 dump SHA-256 为 `bdc59af6da6d73b725a8b53c944f3763ba646c42b446fe6a001425b438f71ce0`。这是一份本机隔离 Windows 验收，不包含新机器、旧版升级、卸载、生产数据、容量、跨平台或正式 RTO/RPO。

后续新 ZIP 的独立扫描已完成：Box 276 条组件、160 条 npm、23 条 UNKNOWN，独立 CLI 的 Syft 结果仍仅一条 Node；三处 bundle 校验、两份实际 CycloneDX 1.7 离线结构/格式校验、62 项 bundle/schema 回归与 30 项扫描防护均通过。新 manifest SHA-256 为 `1fa18dc4c0eb507768218589650e70b2db9acf7a8d333ef5f1c1dd3da73ad874`。本节的 Node.js 20.19.0 指构建与测试宿主，实际制品扫描识别的打包 Node.js 仍为 24.22.1。具体来源、文件集合、扫描输出哈希及私有日志边界见[新制品扫描记录](artifact-sbom-validation-2026-11-07.md#质量门禁修正后新-zip-的独立扫描96d5552026-11-07)、[新 bundle 记录](bundle-evidence-validation-2026-11-07.md#质量门禁修正后新-zip-的模块证据96d5552026-11-07)和[UNKNOWN 复核](artifact-unknown-classification-2026-11-07.md#质量门禁修正后新-box-的三轮复核96d5552026-11-07)。

上述扫描仍为 `DRAFT_PARTIAL_COVERAGE`，模块证据仍为 `PARTIAL_MODULE_EVIDENCE`；完整 SBOM 覆盖、许可/NOTICE 义务、最终 clean SHA 和远端 CI 均不能由结构校验、构建或生命周期通过推导。

依赖状态由后续[安全审计记录](../security/dependency-audit-2026-11-07.md#同日后续兼容覆盖与本地补丁)更新：全量审计仍有 **1 项 low**，生产审计为零；保留 deepmerge 4.3.1 的版本公告与本地补丁边界，不称全量清零，也不预设维护者已接受风险。前文“四项开放”是早期快照，后续兼容覆盖、补丁与残留风险以该审计记录为准。

## 同日后续：基线失效、列表优化与最新本机包

在前述全仓构建、类型和测试快照之后，本轮继续修改基线发布、文档修订列表及需求详情页面。全仓 6/6、10/10 和 8/8 结果仍只适用于当时的源码；没有将其改写为后续最终工作树的全仓重跑。后续变更与针对性验证如下，日志使用同一已核验的 Node.js 20.19.0、pnpm 10.28.2 和隔离源码副本。

- PRD 或 Understanding 正式发布时，同一事务推进基线、失效受影响任务及开放评审、保留历史证据，并向相关角色发送确认通知。九项真实 PostgreSQL 回归包含并发单胜者与实际收件人写入失败时的完整回滚；旧基线快照、认领及历史审批边界详见[基线变更验收](baseline-change-validation-2026-11-07.md)。
- 文档修订列表查询只读取元数据，不再加载正文二进制，同时保留原顺序、最新评审与权限字段。真实本地数据库微基准以 100 个各 128 KiB 修订、160 条评审、两次预热和七对交替测量，仓储方法中位数由 59.2194 ms 到 3.7751 ms；对照实现由脚本重现，并非历史 commit 实测。该数字不代表 HTTP 吞吐、并发容量或生产尾延迟，详见[分页审查及微基准](pagination-review-2026-11-07.md)。
- 真实浏览器复测发现详情页从任务切换到交付物后会被旧 `taskId` 抢回任务页；修复为由 URL 决定选项卡，并将切换和清除 `taskId` 一次写入。页面 31 项、完整 Web 529 项测试及 Web 构建通过；最终真实 Chromium 账户、CSRF、基线变更及 QA 交付共 4/4 通过。IMPL 尚未完成、RELEASE 仍等待前置；不是完整代码交付发布、跨浏览器或无障碍验收。

后续 API 完整覆盖率 923 passed / 1 skipped（真实 Ollama POC），所有既有门槛通过且未降低；全局 lines 82.93%（5811/7007）、branches 69.57%（4352/6255）。真实 PostgreSQL 根集成 21 个文件通过、1 个跳过，181 passed / 1 skipped；此前已向独立空库应用 20 项迁移，最终运行跳过重复迁移。原始日志保存在本机 `G:/workmesh-baseline-validation-20261107-r1`，不作为公开资产：

| 验证材料                      | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `api-coverage-final.log`      | `813675ac0008867b66dff8d5c81533b24bbc31b9dad5bab2f717a6f7e4ed254d` |
| `coverage-summary.json`       | `d9383c7f0c0b005ad7d15b18fe7ca30df0efaf3e4d5f9b29c097d106e6931d0e` |
| `integration-final.log`       | `aa03178d57c892a0e21b501d9b7fe9c1193d6629401fb85c532346e0f6c72ae8` |
| `web-tests-final.log`         | `c8938a908957bd52258d133b3e9d790253c01a9f8466d6668d4c38f35b46fdf5` |
| `browser-suite-ui-final.log`  | `d27477a042acc6d9bfef699e213147adcd924d9d4c71eb7893c83868a8bf44cd` |
| `baseline-change-result.json` | `995ebd9483c3baa801715347aefa0230fd0d3124380bca0b2d7eca4f89b65f5f` |
| `business-chain-result.json`  | `8cd150d70cfc5b82c823f06b6ad3ebe00ede91ebbcbbf1f3e316a21650b1cb9b` |

完成上述 API 和 Web 构建后，使用 `SkipBuild` 重新生成本机 Windows 包；隔离副本与打包时工作树的原有 699 个构建输入逐项哈希一致，这项比较不包括所有新增测试、文档和 CI，也不涵盖冻结后的并行改动。PostgreSQL 运行时复用此前已验收包中的副本，并非本轮重新下载。构建宿主为 Node.js 20.19.0，包内运行时为 Node.js 24.22.1 和 PostgreSQL 17.11。文件位于本机 `G:/workmesh-baseline-package-validation-20261107-r2`，不是公开下载地址：

| 文件                                                              |    字节数 | SHA-256                                                            |
| ----------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `package/workmesh-box-win-x64.zip`                                | 197882772 | `554eae8b559c33f2cf771fae36eb4163aaca1c2bd976287da1c302e3c9035c6e` |
| `package/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip` |  36718185 | `6c5bd81bd745971856337aff6febe0e76a431857714ba0f47db6fb24f56f1780` |
| `lifecycle/summary.json`                                          |         — | `28d68dc79bb0e6a52e3251aade4fa75430b9ade77ea7cc214884cacea526cc7e` |
| `artifact-scan/evidence/artifact-sbom-draft.json`                 |         — | `b99fc423b20a665c8cdb54c9552a054441fe6d930e8dfb5c331d7924413ec4c5` |

该 Box 的生命周期摘要为 **PASSED**：20 项迁移，首次、冷、幂等及恢复库四阶段 API 与代理 `ok`、Web 200；备份 55 张表，恢复标记一致，临时验证库移除，自有服务停止。对两个实际 ZIP 独立扫描，Box 有 276 条组件、160 条 npm、23 条 UNKNOWN，CLI 仅识别 1 条 Node；两个 CycloneDX 1.7 文件通过离线结构与格式校验。扫描首次调用因隔离副本缺少校验脚本而在扫描前失败，保留日志；随后从完整工作区调用脚本复测通过。扫描仍是 `DRAFT_PARTIAL_COVERAGE`，模块侧车仍为 `PARTIAL_MODULE_EVIDENCE`。私有 scan 日志不得作为公开 Release 资产，公开校验和须按实际公开文件重新生成。详情见[制品扫描](artifact-sbom-validation-2026-11-07.md)和[bundle 验证](bundle-evidence-validation-2026-11-07.md)。

这些制品的来源声明为 `739367a714097a825b96ca7ecf6bce3372855a77` 加当时冻结的未提交改动；调用者声明和文件哈希不证明干净构建或供应链来源。冻结后，当前工作树的 `apps/api/src/tasks/v1-task.prisma-repository.ts`、`v1-task.repository.ts`、`v1-task.service.ts` 和 `v1-task.service.spec.ts` 出现并行编辑，与验收副本不同；这四份后续变更未包含于上述 ZIP 或 923/181/4 项验证证据，本轮保留原样。此前 `96d555cd…`、中间包 `7ec2adf2…` 和相关失败记录均保留为历史。新机、旧版升级、卸载、生产迁移与恢复目标、容量、真实 GitHub 证据、外部团队及最终 clean SHA 的远端 CI 仍未完成。

本轮收尾在 Node.js 20.19.0 下再次运行全仓 `pnpm format:check` 和 `pnpm lint:eslint`，均 exit 0；本机日志 `format-closeout.log`（186 字节、SHA-256 `0889330b1213a62d5af0391c3413abf8da4970a0db5efdfcc482e497b9084e4f`）与 `eslint-closeout.log`（65 字节、SHA-256 `8cc6d33cc2c2c3a5c6022ea99f7a8cb391822ce4b2091a12817b5341ca51f0d3`）保存在上述基线证据目录。已跟踪改动的 `git diff --check` 通过；该命令不覆盖未跟踪补丁文件，不能据此声称 deepmerge 补丁的 no-index 空白检查通过。静态检查不扩大这些后续任务编辑的运行时验收范围。
