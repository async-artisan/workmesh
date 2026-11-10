# Prisma 5 → 6 升级计划

> 2026-11-10。对应 `ASSESSMENT.md` P2「制定 Prisma 6 升级计划」。本文是待实施的技术计划；本次没有升级依赖、生成新客户端、连接数据库或执行升级验收。当前声明仍是 `prisma` / `@prisma/client: ^5.21.1`，锁文件实际解析为 `5.22.0`。

## 用户结果、范围与实施前提

升级后，部署者能用同一份候选制品完成安装、正式迁移、运行及备份恢复；已有知识正文、工件字节、任务状态、幂等结果和 HUMAN 签字审计保持一致。客户端与安装时使用的 Prisma CLI 必须来自同一个精确版本、同一份锁文件，不能依赖开发机残留的生成目录或引擎。

本计划以 **`prisma@6.19.0` 与 `@prisma/client@6.19.0`** 为调查候选，固定候选便于复现；这不是“当前最新版”或安全状态承诺。实施前检查该精确版本的官方发布说明、包 `engines`、依赖公告与目标运行环境。如果发现未处置风险或不兼容，应在现有变更记录中调整候选并重新核验，不能执行 `@latest` 或仅更新其中一个包。

本轮实施范围限于 Prisma 兼容改动、匹配的生成/验证/打包脚本和回归证据。保持 PostgreSQL、HTTP 契约、权限、版本检查、人工批准、事务与幂等语义。保留 `prisma-client-js` 及既有输出目录；不同时切换 Prisma 7、无 Rust 引擎、驱动适配器或数据库大版本，也不顺带启用 `strictUndefinedChecks`、`omit` 等功能。

实施由后端负责人认领，发布与恢复负责人复核环境和回退方案，QA 核对逐条证据；具体人员使用[维护职责矩阵](maintenance-roles.md)登记。范围与规则通过当前需求/变更、已发布 KNOWLEDGE、required 角色绑定和快照生效，本文不建立另一套批准状态。合并与发布仍遵循[治理说明](../../GOVERNANCE.md)及[发布验收](../releasing.md)，Agent 不能替维护者批准升级或发布。

## 已调查的现状与官方差异

| 实际现状 / 官方差异                                                                                                                                                        | 具体选择及验证要求                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma` 使用 `prisma-client-js`、输出 `../../node_modules/.prisma/workmesh-v1-client`，启用 `multiSchema`；没有显式 `binaryTargets` / `engineType` | 候选保持生成器和路径。6.13.0 已将 multi-schema 转为正式能力，6.19.0 候选应移除过时 preview 标记；同步 `scripts/lib/isolated-prisma.mjs` 中强制写入该标记的逻辑及回归，保留 `schemas = ["workmesh_v1"]`。                                                                         |
| `PrismaService.installRequestIdStamp()` 用 `$use` 为 `PrincipalStamp.create` 注入当前 `requestId`，事务内也依赖它；官方 6.14.0 已移除 middleware                           | 这是升级阻断项。先验证仅修改当前 query 参数的 query extension 能覆盖普通调用与交互事务，不能在 hook 中另开客户端或另起写查询。若不能保留事务及 Nest 注入/生命周期语义，采用统一显式 stamp helper 并逐一迁移所有创建点；两种方案均须用真实事务证明审计链完整。禁止直接删除 hook。 |
| `DocumentRevision.bodyBytes` 为 `Bytes`；工件视图存在 `bodyBytes?: Buffer`；Prisma 6 将 `Bytes` 返回值从 `Buffer` 改为 `Uint8Array`                                        | 查完所有读写边界；HTTP/摘要/base64/文本解码在边界显式使用 `Buffer.from(bytes)` 或等价字节处理。二进制、UTF-8、多字节字符和空字节均比较原始 bytes、SHA-256、下载 Content-Type 与响应，不只比较字符串。                                                                            |
| `Prisma.JsonNull` 与 `Prisma.DbNull` 分别出现在知识仓储和工作区定义服务；PATCH 用条件 spread 区分缺省值                                                                    | 保留 SQL NULL、JSON null、字段缺省和显式值的差别；验证创建、部分更新、读回与恢复。候选不启用新的 undefined 检查语义，不把 `undefined`、`null` 和 `Prisma.skip` 批量互换；`omit` 仍未采用，查询字段集与可见性保持原样。                                                           |
| 官方 v6 指南列出 `NotFoundError`、Bytes、隐式多对多关系的迁移差异                                                                                                          | 对实际 `findUniqueOrThrow`、`findFirstOrThrow` 与错误捕获进行审查，缺失行保持既有 HTTP 信封；核对 P2023 非法 UUID 映射、P2002 唯一冲突和 P2034 重试。用候选 `migrate diff` 检查隐式关系表可能产生的差异，不凭“只是依赖升级”认定无 schema 影响。                                  |
| 写路径存在 Serializable、行锁、40001/40P01/P2034 重试；Board 使用 RepeatableRead + `SET TRANSACTION READ ONLY`；评审讨论使用 ReadCommitted                                 | 每条路径保留原隔离级别、事务 client、超时和重试边界。真实并发覆盖认领、确认票据消费、签字、发布、幂等回放与 Board 一致读取；不通过提高超时或统一隔离级别掩盖变化。                                                                                                               |
| Box 用 `pnpm deploy --legacy --prod`，Prisma CLI 是运行依赖；安装脚本调用包内 `prisma/build/index.js migrate deploy`；生成客户端另行复制到 `app/node_modules/.prisma`      | 保留生产依赖分类，核对目标 CLI、Client、query/schema engine 版本/来源及生成目录解析。实际解压的新 ZIP 在离开源码目录、没有全局 Prisma 的环境运行，不得由宿主缓存补齐文件。                                                                                                       |

源码调查入口包括 [PrismaService](../../apps/api/src/prisma/prisma.service.ts)、[schema](../../apps/api/prisma/schema.prisma)、[知识仓储](../../apps/api/src/knowledge/v1-publication.prisma-repository.ts)、[工件仓储](../../apps/api/src/tasks/v1-artifact.prisma-repository.ts)、[Board 仓储](../../apps/api/src/tasks/v1-board.prisma-repository.ts)、[HTTP 错误过滤器](../../apps/api/src/common/http-exception.filter.ts)和[Box 打包脚本](../../scripts/package-box.ps1)。实施时重新搜索调用点，本文列举不替代完整清单。

选择精确 6.19.0 候选的代价是必须迁移审计 middleware；退回到仍有 `$use` 的早期 6.x 只能作为另行评估的过渡方案，不能靠压低版本绕过审计与依赖风险处置。维持 5.22.0 是本轮计划交付后的实际状态，不代表长期冻结；直接升级 7.x 或同时更换引擎会扩大迁移范围，本计划不采用。

## 运行环境与引擎矩阵

官方 v6 升级指南列出的最低 Node 版本为 18.18.0、20.9.0、22.11.0，TypeScript 最低 5.1.0。WorkMesh 保留更严格的项目基线 **Node 20.19.0 / pnpm 10.28.2**；满足最低版本仅代表可进入验证。实施前还要按候选包的 `engines` 和当时的运行时维护状态作出部署决定，不能用既有测试承诺所有更高 Node 版本。

查阅时，官方 v6 系统要求页面的软件版本表与专门的 v6 升级指南存在不一致；本计划不据该通用表放宽 Node/TypeScript 要求。版本兼容以精确候选包的 `engines`、v6 升级说明及实际测试共同核对，系统要求页用于核对 OS 和运行库。

| 验证环境                                                                    | 计划覆盖                                                                                     | 引擎与环境核对                                                                                              | 支持结论                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Windows x64，开发/CI 基线 Node 20.19.0；Box 使用实际选定且有来源校验的 Node | validate/generate、API/数据库、全门禁、新 ZIP 安装与恢复；记录构建 Node 和包内 Node 是否相同 | VC++ 运行库、架构、Windows query/schema engine；生成输出、Prisma CLI 和依赖链接在解压目录可解析             | 本计划必验；实际通过后仍按发布流程决定支持范围     |
| Ubuntu CI + PostgreSQL 16；Debian bookworm-slim Docker 的 Node 20.19        | Linux 真实数据库与全门禁；可用时构建并启动现行 Docker 镜像                                   | 记录发行版、glibc/libz、OpenSSL、架构与 Prisma 检测结果；验证 Debian OpenSSL 3 对应引擎、证书和非 root 用户 | 不由 Windows 结果替代；Docker 未运行需明确保留缺口 |
| macOS 与 Ubuntu 的现行 CLI smoke                                            | 重跑既有 smoke；若声明 API/Box 支持，则另增对应引擎生成、连接、迁移与恢复                    | 记录 Intel/ARM、平台检测和原生引擎来源，不将 Windows 生成目录跨平台复制                                     | CLI smoke 不扩大为 API/Box 支持                    |
| PostgreSQL 15+ 的部署口径；CI 16、当前 Windows 演练 17.11                   | 空库安装、旧库副本升级与恢复分别记录实际版本；部署方选择的 15/16/17 组合逐项留证             | Prisma 引擎兼容性与 PostgreSQL 服务大版本分开判断；本次不升级 PostgreSQL 数据目录                           | 未运行的组合继续未验证，不用“15+”替代全部实测      |

Windows 所需 VC++、Linux 的 OpenSSL/libc/zlib 等按官方 v6 系统要求与目标引擎实查。不能仅凭 Node 可启动判定引擎兼容；保存 `prisma -v`、生成日志、query/schema engine 文件摘要、模块加载和真实连接证据。若构建与运行平台不同，先单独设计并验证 `binaryTargets`；当前优先在目标平台生成，不盲目增加所有引擎或复制宿主缓存。

## 实施切片与文件归属

| 顺序 | 负责角色 / 文件                                                                                     | 依赖与交付                                                                                | 验证方法                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1    | 后端 + QA：候选与现状记录，`apps/api/package.json`、`pnpm-lock.yaml` 调查                           | 固定 source SHA/dirty 清单、候选版本、环境、迁移名/SQL 哈希和现有行为；先保留 5.22.0 基线 | 候选官方说明与公告复核；干净隔离安装能复现原基线，不修改原工作库                                  |
| 2    | 后端：`PrismaService`、对应单测/DB 测试                                                             | 审计注入兼容方案先通过评审；避免与包版本/生成脚本并行改同一文件                           | requestId 普通/事务/回滚/显式值/无请求上下文/并发隔离实测，再执行候选升级                         |
| 3    | 后端：API manifest、锁文件、schema、隔离生成脚本及相关测试                                          | Client/CLI 同步精确版本；清除隔离候选中的旧生成产物后重新生成；完成 Bytes 与错误兼容      | frozen install、validate/generate、类型检查、单元测试、契约、真实 DB/HTTP 与 migration diff       |
| 4    | QA：现有集成、浏览器、基准脚本与验收记录                                                            | 候选完成；使用新隔离库重跑原行为、并发和两组 HTTP 基准，与同环境 5.22.0 基线比较          | `pnpm verify`、真实原始结果、延迟/响应字节/RSS及查询差异；异常不得只以总体 PASS 覆盖              |
| 5    | 发布/恢复负责人：`scripts/package-box.ps1`、`scripts/box/install.ps1`、生命周期/SBOM 入口、升级记录 | 同一候选 source 的 production 构建和新 ZIP；不复用旧包报告                                | 新解压安装/冷启动/重复启动/备份恢复；另做 5.22.0 旧包到候选升级及回退演练；最终 clean SHA 远端 CI |

共用 schema、锁文件和打包脚本按此顺序协调，其他角色只在负责测试/记录上并行。若升级产生 API 或共享契约变化，先通过现有变更机制明确范围，随后同步 shared、调用方、角色模板、示例及文档并执行 `pnpm test:contracts`；不在本计划内默许协议漂移。

## 可判定验收

以下是实施时要映射到现有需求与质量包的验收建议，当前均为 **NOT_RUN**。字段使用正式 `key / text / verification`；后续质量包仍从 shared 校验 key，不把本表勾选当成平台批准。

| key                      | text                                                                                                                             | verification | 核验方法                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| prisma6-version          | 同源候选内 Prisma CLI、Client 均精确为选定 6.19.0；锁文件、生成客户端与引擎对应且无宿主残留                                      | TEST         | frozen install、`prisma -v`、版本/摘要清单、无旧生成目录的新生成，以及包内模块加载记录                                       |
| prisma6-audit            | 普通写入和交互事务写入的 PrincipalStamp 关联正确 requestId；显式字段不覆盖，无上下文不伪造，回滚不留孤立审计，两个并发请求不串号 | TEST         | 真实 HTTP + PostgreSQL 比较响应、日志关联与持久化；覆盖事务成功/回滚、显式 null/值、脚本和并发                               |
| prisma6-data             | 知识正文及工件逐字节一致，摘要与下载一致；JSON null、SQL NULL、字段缺省及 PATCH 语义保持                                         | TEST         | 代表性空/二进制/UTF-8/大正文、JsonNull/DbNull、缺省/null/显式值的 5.x 与 6.x 差异对照及恢复读回                              |
| prisma6-behavior         | 授权、版本冲突、确认票据、人工签字、幂等回放、事务隔离、错误信封与 retry 保持现有行为                                            | TEST         | 现有 DB/HTTP/契约/Chromium 与针对 P2002/P2023/P2025/P2034、40001/40P01 的真实失败/并发回归，不只用 mock                      |
| prisma6-migrations       | 新空库与脱敏旧库副本的正式迁移集完整，迁移历史与 SQL 哈希未被改写，schema drift 可解释且已评审                                   | TEST         | 按本节迁移流程逐项记录 deploy/status/diff、实际退出码、应用名和 checksum；非预期 DDL 则失败                                  |
| prisma6-package          | 同源新 Windows ZIP 独立安装、冷/重复启动、备份校验及恢复库运行通过，Prisma CLI/Client/engines 随包可用                           | TEST         | 实际 ZIP SHA、包内版本和 `test-release-box.ps1` 原始结果；从最终 ZIP 另行新解压做固定扫描/许可证核对，保留 SBOM 部分覆盖结论 |
| prisma6-upgrade-rollback | 5.22.0 旧包及旧库副本能升级至候选；停止候选后按已选回退分支恢复，业务基线与审计可读                                              | TEST         | 旧→新→回退的分阶段日志、恢复标记、代表性业务行/字节/签字关系与包摘要；首次安装脚本通过不能替代                               |
| prisma6-release          | 受影响检查、完整门禁和最终 clean SHA 远端 CI 通过；基准变化、公告与未覆盖环境由实际维护者评审                                    | INSPECTION   | 引用真实命令/退出码、CI run、制品与批准；记录未运行项，保持 GitHub live/外部团队等独立发布门禁                               |

## 迁移、异常与回退

截至本计划源码调查，活跃工作区有 **21 项迁移，`0001_init`–`0021_review_discussions`**。r13 冻结快照是 20 项；其通过记录只覆盖当时来源，不作为升级候选或新增第 21 项的证据。实施时重新枚举候选目录并保存每份 SQL 的 SHA-256；若并行工作新增迁移，以新快照为准，重新记录基线，不修改旧报告数量。

迁移验证使用两个全新隔离目标：候选从零 deploy 的空库，以及用 5.22.0 旧包建立代表性数据后备份/恢复得到的副本。写入前通过现有 test-database guard 核对数据库名、用户、loopback、端口和实例身份；Box 目标另核对 DataDir、PID 与自有端口。旧库副本迁移前保存 `_prisma_migrations` 的名称、checksum、完成/回滚状态及 schema diff，使用候选包内 CLI 执行 deploy，再核对全部正式迁移和业务样本。生产库、开发工作库和未知服务不作为试验目标。

先检查候选 `migrate diff --help` 与现有 `scripts/verify.mjs` 使用的 `--from-schema-datasource` / `--to-schema-datamodel` / `--exit-code` 兼容性，保存真实 diff 和退出码。若 implicit relation、multi-schema 或类型映射产生 DDL，暂停无 schema 变更假设并通过现有变更流程评审：需要时新增正式迁移，不修改已应用 SQL、不手填成功 checksum、不以 `db push` 消除漂移。历史 SQL 不保证整份失败自动回滚，`migrate resolve` 也不撤销已执行 SQL；故障演练必须识别部分应用并验证恢复路径。

出现以下任一结果，停止候选推广：requestId 丢失/串号、字节或摘要差异、权限/幂等/事务回归、非预期 schema diff、迁移部分失败、包内引擎缺失/不兼容、备份无法恢复、未处置依赖风险，或性能异常尚无可解释结论。保留失败输入、日志与快照，按问题追加记录；不得降低门禁或改写既有通过报告。基准比较使用同机同库版本、相同数据与采样参数，记录 warm/cold 和响应大小；升级前由负责人固定可接受预算，再对照至少重复运行的结果决定，不能用历史本机小样本替代生产容量结论。

回退按数据库是否改变分支处理：

1. **没有 DDL/不可逆数据写入，且旧包兼容已实测**：停止并确认只停止候选自有服务，保留候选日志和包，切回预先保存且摘要可核对的 5.22.0 完整旧包及配置，再核对健康、迁移历史和代表性业务读写。不能仅降两个 npm 包后继续使用 6.x 生成客户端。
2. **已有 DDL/数据变化、部分迁移或旧包兼容性不确定**：保持写入冻结，把升级前已校验的备份恢复到新的隔离实例/库，运行保存的完整旧包并验证业务与审计，再由恢复负责人决定服务切换；保留原候选库调查。先明确备份后新增写入的处理与数据损失窗口，不能自动丢弃。

`test-release-box.ps1` 的首次安装、结构计数和验证标记是基础检查；还需用旧包副本验证实际升级/回退，核对知识正文、工件摘要、角色/权限、确认票据与签字关系。恢复演练记录复用[运维演练模板](game-day-record-template.md)，完成时间、实测恢复耗时和数据窗口据实填写；没有执行不能宣称 RTO/RPO 或新机/生产支持。

## 执行入口与证据边界

候选实施完成后，先按 [CONTRIBUTING](../../CONTRIBUTING.md) 执行受影响包测试、类型检查及构建，运行 `pnpm test:isolated-prisma`、`pnpm test:contracts`，再在显式隔离库执行共用 `pnpm verify`。仅首次选定空库且身份确认后使用 `pnpm verify -- --apply-migrations`；详细配置沿用[完整本地验证](../testing/local-verification.md)。打包与扫描按[发布验收](../releasing.md)执行，不能让新版本复用 5.22.0 的制品或远端检查结果。

每次记录候选版本、source SHA 与 dirty 边界、Node/OS/PostgreSQL/引擎、锁文件及迁移清单摘要、命令/退出码、日志和报告路径。外部官方差异是 EXTERNAL_REFERENCE；静态审查是 Agent 分析；本地实际运行、远端 CI 与 HUMAN 批准分别留证。本次只完成计划与来源调查，以上升级、数据库、性能、制品和回退验收均未执行。

## 官方来源

查阅日期：**2026-11-10**。下列均为 Prisma 官方资料；v6 页面用于核对本计划，不将当前通用文档或 v7 迁移命令套用到候选。

- [Prisma ORM 6 升级指南](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-6)：Node/TypeScript 最低版本、Bytes、错误类与隐式多对多差异。
- [Prisma ORM v6 系统要求](https://www.prisma.io/docs/orm/v6/reference/system-requirements)：OS、架构及运行库要求；最终以精确候选和目标引擎实查为准。
- [Prisma 6.13.0 官方发布说明](https://github.com/prisma/prisma/releases/tag/6.13.0)：multi-schema 正式可用与 preview 标记处理。
- [Prisma 6.14.0 官方发布说明](https://github.com/prisma/prisma/releases/tag/6.14.0)：移除 Client middleware，需迁移现有 `$use`。
- [Prisma 6.19.0 官方发布说明](https://github.com/prisma/prisma/releases/tag/6.19.0)：本计划精确调查候选；不是“最新版”或已通过验证的声明。
