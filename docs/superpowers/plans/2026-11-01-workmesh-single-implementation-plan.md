# WorkMesh 单一实现收敛与开发完成计划书

日期：2026-11-01。状态：待执行。本轮只编写计划，不实施源码、迁移、服务或外部操作。

**目标：** 以已确认的新契约为唯一标准，复用已有有效实现，完成 API、CLI、Web 和测试的整体切换，移除被替代的旧实现与旁路，不维护兼容层。

**架构：** 延续 TypeScript、NestJS、React、Prisma、PostgreSQL 模块化单体。一个能力只有一套正式路由、领域逻辑和数据访问路径；按业务职责拆文件，不按“新旧版本”复制模块。

执行者先读本计划与[主技术方案](2026-11-01-workmesh-technical-implementation.md)，具体权限、状态、DTO 和验收语义仍以[01–06 分册](workmesh-technical-v1/README.md)为准。本计划调整代码组织与替换次序，不降低这些语义要求。出现真实冲突先登记并澄清，不擅自放宽门禁。

## 1. 固定决定

| 对象 | 本次决定 |
| --- | --- |
| HTTP 协议 | 保留 `/api/v1`，不提供旧 `/api` 业务接口兼容；这不禁止未来正常的协议演进。 |
| 代码命名 | 正式模块不保留 `V1AuthService`、`V1TaskModule`、`v1-*.ts` 等用于新旧并行的名字；协议常量、历史文档和 migration 名称不机械改写。 |
| 替换方式 | 在当前仓库整合已写好的新实现，同步切换调用方与测试；不从零重写，也不新增第三套适配业务层。 |
| 认证 | HUMAN 仅来自 opaque WebSession；CLI 仅取得受限 AgentCredential。旧 HUMAN JWT、refresh、客户端自报身份和本地签字不再注册。 |
| 数据访问 | 正式应用只使用一个目标 Prisma client 和一个生命周期受管的 PrismaService；历史数据读取仅存在于受控导入工具。 |
| 数据存储 | 本计划默认保留 `workmesh_v1` 为正式目标 schema，保留旧数据作为可能的导入来源。名称不是兼容层，不为去掉“v1”冒险搬库。 |
| 产品范围 | 继续完成原 T00–T08；Codeup T09 仍属后续，不新增 MCP server、中心 Agent 执行器或通用脚本引擎。 |

“不兼容旧写法”允许移除旧源码和路由，不授权删除历史数据、改写已应用迁移或替用户选择生产切换方案。

## 2. 当前依据与尚未确认的事实

本次核对的真实 Git 根为 `/opt/homebrew/var/www/yesgooo/workmesh`，分支 `main`，存在大量既有未提交修改；旧 `req-flow` 路径不再作为执行目录。

已看到 shared 契约、独立目标 Prisma schema、新认证/授权/确认票据、新知识/评审、认领/交付，以及新增 change/board 文件。旧 auth、signoff、tasks 等模块仍与新模块并存；CLI 和 Web 仍使用 access/refresh JWT。`test:github-live` 明确未实现；导入 apply 仍为拒绝执行的保护入口，不是真实导入器。

上一轮独立检查有 82 个定向单元测试通过，同时 API 类型检查在新增 artifact 实现/测试中失败。这是上一轮快照，不作为本次或未来执行的通过结论。当前工作树持续变化，执行者必须重测，不能沿用“全部 legacy 错误”的归因。

尚未确认：真实数据库有无需要保留的资料、哪些迁移已执行或被其他环境使用、隔离运行目标和外部测试仓授权。源码任务不等待这些事实；涉及应用迁移或真实切换的步骤必须等待对应确认。

## 3. 实现归属与文件收敛表

以下均为相对项目根的路径。表中目标文件是实施后的责任落点，不表示当前已存在。若正式文件混有用户修改，逐段整合，不用新文件整份覆盖。

| 当前来源 | 正式归属 | 处理方式 |
| --- | --- | --- |
| `apps/api/src/auth/v1-auth.*`、`v1-policy.*`、`v1-cookie-policy.*`、`v1-credential-policy.*` | `auth/auth.service.ts`、`auth/auth.guard.ts`、`auth/session-policy.ts`、`auth/credential-policy.ts` | 合并为正式认证链，保留清晰的会话与 Agent 职责；删除旧 JWT 认证实现。 |
| `auth/v1-authorization*`、`v1-confirmation*` | `auth/authorization.service.ts`、`auth/confirmation.service.ts` 及必要策略文件 | 保留唯一完整 Principal 授权与准确动作票据规则；补预览、密码核验、签发和管理入口。 |
| `knowledge/v1-publication*`、旧 knowledge/source/prd 索引与发布逻辑 | `knowledge/publication.service.ts`、正式 knowledge controller；PRD 保留业务组织职责 | 正文与发布只有一个权威；不保留能独立批准的旧索引或旧 PRD 版本路径。 |
| `reviews/v1-review*`、旧 `signoff/` | `reviews/review.*` | 正式决定统一从 ReviewRequest 进入；被替代的旧 signoff controller/service 移除。 |
| `tasks/v1-task*`、`v1-artifact*`、旧 tasks/artifacts | `tasks/task.*`、`artifacts/artifact.*` | 按任务与交付职责合并，保留一个入口；不同时注册两个 tasks 模块。 |
| `tasks/v1-change*`、`v1-board*`、旧 changes/board/trace | `changes/`、`board/`、`trace/` | 放回各自业务模块，统一当前权限、基线有效性和分页。 |
| `integrations/v1-code-evidence-policy*`、旧 git integration | `integrations/` 的 GitHub adapter 与证据服务 | 保留厂商中立核心，新增真实 adapter，不把纯策略测试当 adapter 完成。 |
| `common/v1-idempotency*`、`v1-test-database*` | `common/idempotency.*`、`common/test-database.*` | 统一幂等、事务与测试边界；测试库守卫不得进入普通业务请求逻辑。 |
| `apps/api/prisma/v1/schema.prisma` 与目标 migrations | `apps/api/prisma/schema.prisma` 与正式 migrations 入口 | 先保护旧 schema/migration 来源，再切唯一生成入口；已应用历史不重写。 |
| 各 `*.prisma-repository.ts` | 正式 PrismaService 与领域服务 | 不保留只转发 Prisma 调用的通用仓储包装；确有边界价值的适配器可保留，但不得各自创建 client 或复制授权。 |
| CLI `v1-credential-store` 与旧 client/config/index | 正式 `credentials.ts`、`client.ts`、`config.ts`、分职责命令文件 | 浏览器授权、限定 scope、显式撤权；移除密码登录和 HUMAN refresh 逻辑。 |

移动/整合某项时，同步处理对应 spec、imports、DI token、exports、模块注册、生成产物引用、文档示例及调用方。不能以残留 re-export、旧类别名或双路由完成“兼容”。

## 4. 数据历史处理门槛

### 默认路线：保留历史，单独切换正式运行路径

1. 执行时记录旧/目标 schema 文件、migration 目录和校验摘要；确认生成物、部署命令、CI 和运行配置各自指向。
2. 在仓库保留明确标注的历史来源，例如 `apps/api/prisma/legacy/`。它只供数据对照/导入，不被应用 imports、普通生成命令或默认启动路径使用。
3. 正式 schema 移至唯一标准入口，但数据库目标仍为 `workmesh_v1`；固定客户端生成位置和 API 的 import 路径。客户端生成在无环境文件的隔离目录完成。
4. 未应用、未共享的目标初始迁移可在取证后整理；已应用或被共享环境采用的迁移只追加，不修改历史内容。情况不明时按“已应用”保护。
5. 新模型落库、导入和切换另设授权检查点。备份、恢复演练、来源映射和新权限核验通过前，不开放真实用户写入。

只有用户确认没有需保留资料、迁移未共享并明确批准重建，才可走干净初始库路线。该决定不影响源码先行，不自动删目录、删库或 reset。

## 5. 任务与退出条件

任务采用 S00–S08，表示收敛后的执行顺序，不是另一套产品版本。先完成一个领域的实现、调用方和静态回归，再进入后继；完整运行验收在授权环境完成。中间分支状态不得用于部署，也不以临时双注册维持表面可用。

### S00：固定当前基线与唯一接口清单（对应 T00）

文件：`apps/api/src/app.module.ts`、各 module/controller、根/各包 `package.json`、`apps/api/tsconfig.json`、测试配置、现有本机进度文件。

- 增量读取当前 diff，记录已有修改与暂存状态；不重新做全套任务0。
- 对照05建立“正式路由→controller→service→数据client→CLI/Web调用→测试”映射，另列待移除旧入口。数量取当前源码，不预填未经实测的覆盖率。
- 重现并修复当前类型/构建问题。区分接口真实不匹配、测试替身缺方法、生成客户端过期与配置故障；禁止用 `any`、排除文件或关闭类型检查逃避。
- **退出条件：** 基线有命令和退出码，当前编译问题有定位；每个后续任务有明确文件归属。基线记录不是任务结束点。

### S01：统一 Prisma 与事务基础（对应 T01）

文件：`apps/api/prisma/`、`apps/api/src/prisma/prisma.service.ts`、`prisma.module.ts`、各目标数据访问文件、`scripts/lib/isolated-prisma.mjs`、包 scripts、`turbo.json`。

- 按第4节处理 schema 与历史迁移，切换正式生成入口；修改应用构建/type-check/test，不再隐式生成 legacy client。
- 由 PrismaModule 提供唯一受管 client，显式连接目标 schema、退出时断开；移除领域内 `new PrismaClient()` 和穿透到 node_modules 的硬编码 imports。
- 统一 Serializable、项目锁顺序、最多三次纯DB重试与失败错误。授权/票据/业务事实/审计/幂等同事务；外部请求不进入数据库重试。
- **失败回归：** 跨项目FK、重复当前claim/slot/operation、不可变记录更新与删除、事务中途故障回滚；实际数据库层待授权，不以mock替代。
- **退出条件：** 单一生成来源与应用client成立，隔离 validate/generate、类型检查通过；数据库约束状态分开报告。

### S02：正式认证、授权与管理入口（对应 T02）

文件：`apps/api/src/auth/`、`projects/`、知识ACL相关服务；`apps/web/src/store/auth.ts`、`api/client.ts`、登录注册页及后续授权页。

- 将新实现整合进正式 AuthModule，补 session bootstrap、注册/登录/登出、密码及全局撤权；不再注册 JWT refresh。
- 补设备授权 create/lookup/approve/poll/deny、PKCE/proof、丢响应恢复、限流、凭据列表和撤权；Agent 范围取当前服务端记录。
- 补 action-preview 与密码二验签发 confirmation ticket；严格绑定会话、动作、项目、slot、version、digest，有效期和单次消费按01。
- 补动态成员/业务角色/KB ACL 管理入口及当前权限交集。作者、OWNER、多角色用户均不能绕过正文权限或放大Agent凭据。
- Web改为cookie+CSRF，不保存HUMAN token；清除明确的本应用旧token缓存键，不能扫描或清空其他应用存储。
- **失败回归：** 旧JWT401、混合凭据400、错误Origin/CSRF、过期/撤权、跨项目/角色scope、票据复用与版本变化、PKCE错误和poll过快。
- **退出条件：** HTTP可完成真实会话和票据签发链，不依赖测试手动灌票据；正式客户端不调用旧认证。

### S03：统一知识、PRD、评审、流程与上下文（对应 T03）

文件：`knowledge/`、`prd/`、`reviews/`；新增职责明确的 `workflows/`、`contexts/`，以及 shared DTO/schema 和 Prisma实体。

- 统一DocumentRevision/Publication，补05的文档创建、修订、读取、restore、withdraw、搜索及类型scope；正文按原始bytes生成摘要。
- UNDERSTANDING、PRD、KNOWLEDGE使用各自ReviewRequest语义；PRD必须绑定当前理解、deliveryScope和acceptance，不把所有候选硬编码为知识发布。
- 最后ALL批准同事务完成对应指针、阶段、任务推进及旧基线失效；决定撤销和返修保留历史并按依赖传播。
- 实现受限DAG发布/实例、角色包锁定和确定版本上下文快照；私库资料逐项检查当前权限，离线仅允许草稿。
- **失败回归：** 新draft不替published、旧票据批准新版本拒绝、理解确认不等于PRD批准、非法DAG、失权快照、旧基线交付拒绝。
- **退出条件：** 产品可从无PRD的理解候选开始，经正式Web会话批准后另一主体取得相同版本；删除直接发布及旧签字路由。

### S04：完成任务、工件、变更与门禁（对应 T04）

文件：正式 `tasks/`、`artifacts/`、`changes/`、`board/`、`trace/` 及调用DTO。

- 收敛新旧模块，补认领/显式释放/work-status与完整代次规则；收口当前artifact类型和测试接口错误。
- 交付必须引用事先取得的合法snapshot，HOSTED存实际bytes，GIT_REF绑定完整仓库定位；不能仅存客户端摘要或交付时现造任意manifest冒充确定输入。
- 实现ArtifactSet与候选输出、评审槽、系统门禁、release推进、多角色收件及并发ack/游标分页；board/trace仅派生当前有效事实。
- **失败回归：** 双claim单胜、响应丢失同key重放、异digest409、旧claim失效、缺bytes/缺仓库拒绝、并发ack不丢、百条以上分页、发布与批准竞争。
- **退出条件：** 正式任务可交付/返修/重交，不允许直接写DONE；不可用旧tasks/signoff路径兜底。

### S05：GitHub具体适配与提交级证据（对应 T05）

文件：`integrations/`、代码连接/项目仓库管理入口、证据模型、review prepare调用、fixture与 `scripts/test-github-live.mjs`。

- 实现厂商中立接口的GitHub.com adapter，完整分页、稳定仓库身份、多仓范围、Webhook验签与去重。
- 完成不可变CodeReviewEvidence与prepare-code-evidence，把当前提交、评审撤销及证据版本绑定预览与票据。
- **失败回归：** 作者自审、Bot、旧SHA、dismissed、changes_requested、分页不完整、同号异仓、准备后head变化和坏签名一律闭门。
- **退出条件：** 无网fixture/HTTP adapter测试成立；live runner具有真实实现。没有独立测试仓授权时，真实平台联调明确未验证。

### S06：CLI与角色工作流切换（对应 T06）

文件：`apps/cli/src/index.ts`、`client.ts`、`config.ts`、`credentials.ts`及分职责命令、角色资源、包 `files`/exports与打包测试。

- login仅浏览器设备授权；移除账号密码及HUMAN refresh。将已有credential store接入真实主路径，不只增加孤立文件。
- 完成role包安装/锁定、Codex/Claude Code入口、materialize冲突保护、候选/context/claim/deliver/review/receipt/changes。
- 接同一API错误和幂等协议，离线不声称fresh；正式批准只引导Web，不在CLI生成HUMAN决定。
- **退出条件：** 临时home和业务目录、包外dist完成真实命令解析与资源读取；打包含必要角色资源，不含源码测试、本机记录和秘密。旧CLI测试按新契约替换，不保留兼容行为。

### S07：Web全链路与客户端集成（对应 T07）

文件：`apps/web/src/api/`、`store/auth.ts`、Projects/Knowledge/Prds/Board/Profile及角色/ACL、授权、preview/二验/评审页；新增Playwright配置与测试。

- 页面统一消费新API、cookie会话与错误envelope，复用现有组件和样式；关闭旧API调用和token注入。
- 测试真实权限、准确slot/版本/正文摘要、返修/撤销和过期证据；不能通过按钮禁用代替服务端拒绝。
- **退出条件：** 隔离环境使用真正打包CLI与浏览器完成候选→批准发布→下游同版→认领交付→返修重交→验收→变更重评；真实GitHub另列证据。

### S08：迁移交付、删除旧路径与总验收（对应 T08）

文件：正式导入工具、`scripts/`、`.github/workflows/ci.yml`、`docs/api.md`、deployment/runbook、CLI帮助、技术分册和导航。

- plan读取批准的真实来源并生成映射/冲突报告；apply核验批准计划、来源指纹和权限映射，verify核对计数、bytes与授权。不得将schema文件hash当真实数据指纹。
- 完成备份恢复、无Redis核心运行、Node20/24、隔离PostgreSQL CI及发布包检查。旧数据不自动删除，旧批准不自动变有效。
- 每域调用方切换并验证后，精确删除已被替代的旧源码/路由/测试；不删除用户无关修改或历史数据。无法安全分离的删除项留原样并报告。
- **退出条件：** 第6节全部门槛有证据；仅授权受限层可标未验证，不能因未验证而称“全部完成”。

## 6. 总验收与执行纪律

### 源码与契约门槛

- 正式应用没有旧JWT/refresh、直接发布、客户端自报身份、任意status写入和重复业务路由。
- 所有正式模块、CLI和Web只依赖目标契约/client；`v1-`搜索结果逐项归类为协议、历史、迁移或必须移除的平行实现，不要求机械零匹配。
- shared/schema/DTO/HTTP/OpenAPI/CLI帮助一致；真实contract测试绑定包脚本和CI。覆盖真实Guard的认证套件与替身Guard的DTO套件分开报告。
- 无编译错误、空检查、恒定skip伪通过；不删测试、放宽断言/阈值、关闭约束或mock核心实现换绿灯。

### 验证入口

以下为执行者需核对并维护的入口，不是本轮通过记录：

```bash
corepack pnpm --filter @workmesh/api exec tsc --noEmit --incremental false
corepack pnpm --filter @workmesh/shared test
corepack pnpm --filter @workmesh/cli test
corepack pnpm --filter @workmesh/web test
corepack pnpm test:contracts
corepack pnpm build
git diff --check
```

API全量单测、build和包脚本先排查隐式Prisma生成、环境文件和Redis连接；消除副作用后再执行。数据库集成、HTTP服务、Playwright和GitHub live必须先取得对应环境授权。E2E不得手动插入正式决定或票据冒充完整人工链路；不可变表不能用deleteMany清理，通过经授权的一次性环境生命周期回收。

交付按源码/类型与单元、HTTP契约、真实认证HTTP、数据库约束与并发、CLI打包、浏览器、真实GitHub、迁移恢复分别列命令、退出码、结果和未验证原因。没有环境不等于代码无需实现，单元通过不等于真实事务成立。

### 持续推进与暂停条件

每个任务完成后增量更新本机PROGRESS/BLOCKED与覆盖矩阵，继续后继，不要求重复“继续”。同一检查连续失败三次先核因；无法安全解决时换独立项。只在真正的规格裁决、必要授权或环境缺失且已无安全独立工作时以blocked交付；其余未完成均为partial。

不自动commit、push、创建PR或部署。执行中不读取秘密文件、打印连接串，不修改其他仓库，不用reset/stash清场。未来L2/L3执行按适用规则选择必要流程，本次L1计划交付不启动开发Run。

## 7. 原任务与文档同步

| 原任务 | 本计划承接 | 不得漏掉的剩余范围 |
| --- | --- | --- |
| T00 | S00、S01、S08 | 共享契约、双模块加载、构建依赖、HTTP envelope。 |
| T01 | S01及各域数据模型 | 正式client、完整约束、历史保护、真实数据库验证。 |
| T02 | S02、S06、S07 | 完整认证签发/撤销、管理入口、Web/CLI身份分离。 |
| T03 | S03 | 理解/PRD/知识不同效应、流程与上下文，不仅知识发布。 |
| T04 | S04 | 工件实际内容、并发门禁、变更与有效性。 |
| T05 | S05 | 真实adapter与提交级证据，不止策略函数。 |
| T06 | S06 | 真正可发行、可授权、带资源的CLI。 |
| T07 | S07 | 真实用户页面和浏览器闭环。 |
| T08 | S08 | 导入映射、恢复、CI及发布证据。 |

实施每域时同步更新相应技术分册中的文件位置与旧代码替换说明；保留01–05的产品和协议语义。06仍保留T00–T08作为需求覆盖编号，以本计划S00–S08安排收敛次序。旧执行提示词不得继续指导“平行新增v1模块”；新会话从本计划及当前进度接续。

最终交付不是文件批量改名，而是：**唯一正式实现已经贯通、旧旁路已移除、历史数据被保护、适用验证有证据。**
