# 工作区接入与 onboarding 验收记录

> 记录更新：2026-11-07（Asia/Shanghai；本机执行结果的原始时间分别保留）
> 首轮工作树 HEAD：`021ac3a`（当时含并行未提交变更；不代表后续测试或当前提交内容）
> 首轮基线 Git status：266 条（staged 0、unstaged 169、untracked 97）；并行任务持续修改，数量不能用作本任务文件归属证明。当前快照另见 §12.7。
> T1 既有隔离 PostgreSQL 证据：Windows 11 + PostgreSQL 17.11（embedded 临时实例，`127.0.0.1:55432`；实例已销毁）
> 首轮工具环境：Node 20.13.1（低于仓库要求 `>=20.19.0`）；pnpm 10.28.2；Git 2.53.0
> 后续复核环境：Node v24.22.1；本轮使用新建的隔离 PostgreSQL 17.11（loopback `127.0.0.1:45052`）及显式测试 URL。无 `psql` / Docker；测试使用隔离集群而非已有数据库。

本文件区分 **真实运行** 与 **仅静态/单测覆盖**。没有执行的项目不会写成通过。

证据等级：**静态** = 代码/文档审查；**单测** = unit/component tests；**隔离 DB** = 专用一次性 PostgreSQL；**真实 HTTP** = AppModule/真实路由及 guard；**真实 UI/CLI** = 应用与真实 API/DB 的操作链；**平台实测** = 对应真实 OS runner。低等级证据不能替代高等级验收。

## 最新验收状态（2026-11-07 文档收尾；执行时间见 §9–§12）

T1 的既有隔离迁移证据通过，外部环境历史未知。T2–T4 已有隔离 DB、真实 HTTP 和成员变化屏障复验；T4 全局与领域 limiter 交互已验证。T5–T8 已有 CLI 测试、最终构建的单机双环境真实接入，以及一次性专属目录上的真实 T8 迁移/恢复演练。T9 已完成真实页面声明、校验、草稿、发布与签码并对照隔离 DB；本轮使用同一页面签发的接入码完成真实 CLI consume、设备批准、精确 revision/digest 校验、init、在线 bind 和 status。首次设备授权超时、磁盘不足和凭据存储安全检查失败均保留为历史失败，恢复专属隔离 PostgreSQL 与空间后 bind/status 复跑成功。离线 bind 的精确 locator、无缓存、摘要不符和 locator 不匹配四场景已有单机真实 CLI 结果。T10 的同项目 Web→CLI→bind/status 证据现已补齐，但仍是单机；真实双机尚缺。T11 已有 Windows 部分实测，UNC、macOS、Linux 和真实双机未运行。§25 与 P0a 综合仍为 **C / 未完成**；认证 locator 快照和 TTL 属未来产品决策，并非已冻结要求。

## 前次验收状态快照（2026-11-06 20:52，保留历史；后续结果见 §12）

当时记录：T1 的既有隔离迁移证据通过，外部环境历史未知。T2–T4 已有隔离 DB、真实 HTTP 和成员变化屏障复验；T4 全局与领域 limiter 交互已验证。T5–T8 已有 CLI 测试及最终构建的单机双环境真实接入，T8 的真实双配置环境演练仍缺。T9 已完成真实页面声明、校验、草稿、发布与签码并对照隔离 DB；T10 的页面与 CLI 分段闭环已有证据，但真实双机尚缺。T11 已有 Windows 部分实测，UNC、macOS、Linux 和真实双机未运行。§25 与 P0a 综合仍为 **C / 未完成**；认证 locator 快照和 TTL 属未来产品决策，并非已冻结要求。

## 更早验收状态快照（2026-11-06，保留历史；后续结果见 §9–§12）

| §24 任务                       | 当前状态                                   | 已有证据及缺口                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 领域模型与迁移              | **隔离库通过**                             | 保留 §1 的空库、存量库、四中间态 deploy 与 postcheck 记录；共享/开发/测试/生产部署历史未知，仍是外部 gate。不得重跑已通过的隔离迁移或连接共享库。                                                                                                                           |
| T2 仓库声明与既有写路径        | **部分验证**                               | Node 24 隔离 PostgreSQL DB spec 16/16、真实 AppModule HTTP 1/1 通过；provider identity、同 key 等覆盖见 §2.2。整体 §25 仍未通过。                                                                                                                                           |
| T3 workspace definition        | **部分验证**                               | 隔离 PostgreSQL DB spec 16/16；包含同 key、项目/文档归档和文档读取授权撤销同步屏障、事务锁及回滚断言。                                                                                                                                                                      |
| T4 接入码服务端                | **部分验证**                               | 隔离 DB 及真实 AppModule HTTP 通过；HTTP 含同 key 和领域限流断言，global 与领域 limiter 互相优先级仍未验证。                                                                                                                                                                |
| T5 CLI v2 配置与双读           | **部分验证**                               | Node 24 的最终 CLI 全套为 20 files / 232 passed / 2 skipped；配置/bind 聚焦复测为 52 passed / 2 skipped。两个独立根目录/configHome 已对真实 API/DB 完成单机接入模拟。                                                                                                       |
| T6 CLI `workspace init --join` | **单机真实 API/DB 模拟通过**               | 两个独立 root/configHome 完成真实 consume、HTTP HUMAN 设备授权批准、精确 revision/digest 获取及 init；真实双机和 Web 页面批准尚未验证。                                                                                                                                     |
| T7 CLI bind/discover/status    | **部分验证**                               | 单机两个独立 root 完成真实 API/DB init、bind 和 status；Windows 路径夹具运行，macOS/Linux、UNC 及真实双机未完成。                                                                                                                                                           |
| T8 CLI migrate                 | **单测通过，验收部分完成**                 | Node v24.22.1 下最终 CLI 全套 20 files / 232 passed / 2 skipped；本地迁移/journal 测试覆盖，但没有真实双配置环境演练。                                                                                                                                                      |
| T9 Web workspace 页面          | **组件测试和当前类型检查通过；集成未验收** | Node v24.22.1 下本轮六文件聚焦复跑 6 files / 59 passed，`apps/web` 类型检查通过；未操作真实 Web→API→DB。包含 `Knowledge.test.tsx` 的七文件扩展命令本轮为 6 files passed / 1 failed（1 assertion found duplicate text nodes），另见 §2.2；该失败超出 onboarding 六文件集合。 |
| T10 集成验证                   | **部分验证**                               | 本轮隔离 PostgreSQL 上 DB spec 16/16、真实 AppModule HTTP 1/1 passed；真实 main 全局 limiter spec 1/1 passed。Web 页面及真实双机闭环仍未完成。                                                                                                                              |
| T11 跨平台验收                 | **部分**                                   | Windows 已运行本机 Git/路径夹具和 junction 别名用例；macOS/Linux 未运行，双临时根目录不代表双机。UNC 及 macOS/Linux 的大小写和符号链接实测仍有缺口。                                                                                                                        |

当时总结果：**C / 未完成**。当时真实 Web 页面尚未执行；后续结果见 §11，真实双机、跨平台和外部迁移历史仍未齐备。

## 1. 迁移 T1

### 1.1 空库 `prisma migrate deploy`

真实执行，隔离库 `t1_deploy_empty`：

```powershell
$env:WORKMESH_V1_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/t1_deploy_empty'
prisma migrate deploy --schema prisma/schema.prisma
```

结果：0001–0019 全部 `Applying migration` 成功，退出码 0；`_prisma_migrations` 19 行且无未完成项。

### 1.2 含存量 `ProjectRepository` 的 `prisma migrate deploy`

真实执行。先用同一 Prisma 项目只应用 0001–0015，插入一条旧格式仓库行（adapter/externalId 非空，owner/name 仅展示），再应用 0016–0019：

```powershell
# 0001–0015 已成功应用
# 插入存量 ProjectRepository 后
$env:WORKMESH_V1_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/t1_deploy_existing2'
prisma migrate deploy --schema <temp-project>/prisma/schema.prisma   # 0016–0019
```

结果：0016–0019 成功；存量行仍存在，`identityMode=PROVIDER`，adapter/externalId/owner/name 保留；`_prisma_migrations` 19 行、无未完成项。

### 1.3 §16.4 四种中间态（Prisma deploy）

均使用隔离库；每种状态保留一条存量仓库行。

| 状态                         | 构造                                                                      | 结果                                                    |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| enum 已建、表未建            | 0001–0015 后手工建两个 enum，再 `migrate deploy`                          | 0016–0019 成功；enum 被复用；表/FK/索引创建；存量行保留 |
| 表已建、索引未建             | 0016 手工执行后删除 locator 索引，`_prisma_migrations` 无 0016，再 deploy | 索引重建；0016–0019 成功；存量行保留                    |
| 部分唯一索引已建、CHECK 未建 | 0016 手工执行后删除 CHECK，再 deploy                                      | CHECK 以 `NOT VALID` 重建；存量行保留                   |
| 对象齐全、历史未标记         | 手工执行 0016–0019，不写历史，再 deploy                                   | 可重入校验通过；历史补齐为 19 行；存量行保留            |

四种状态恢复后均运行 0016–0019 postcheck，全部通过；`_prisma_migrations` 19 行、`finished_at` 全非空。

### 1.4 约束与客户端/旧应用

- 0016 postcheck 后执行 `validate_constraint.sql`，`ProjectRepository_identity_mode_ck.convalidated=true`。
- Prisma Client（生成目录 `apps/node_modules/.prisma/workmesh-v1-client`）连接隔离库成功，`projectRepository.count()` 与旧行查询成功。
- 旧 API（`apps/api/dist/main.js`）以 `WORKMESH_COOKIE_MODE=LOCAL_INSECURE`、隔离库启动成功，`/api/health` 返回 `{"data":{"status":"ok"}}`。
- 部署状态：**共享/开发/测试/生产库均未知**；本记录只证明“隔离库上 Prisma deploy 成功”，不证明任何共享环境已应用或未应用 0016–0019。若共享环境已应用旧版本 migration，当前工作树存在 checksum 冲突风险；不得用 `migrate resolve` 掩盖，也不得继续改写已发布 migration。

## 2. 自动化测试

### 2.1 先前记录的执行结果

下表来自此前验收记录，不是 2026-11-06 本轮的全量复跑结果。它仅保留作历史证据；与下节本轮复跑冲突时，以本轮复跑为准。
先前记录没有保留每条命令的完整参数或所有测试文件路径，因此这些摘要不可单独作为可复现的验收命令；需要重新验收时，应记录实际 shell 命令及明确文件列表。

| 套件                         | 命令（摘要）                                                                                                                                                      | 结果                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| shared locator               | `pnpm --filter @workmesh/shared exec vitest run src/repository-locator.test.ts`                                                                                   | 6 passed                                                    |
| API workspace unit           | `vitest run` 8 个 projects spec                                                                                                                                   | 95 passed                                                   |
| API workspace DB integration | 隔离库 `workmesh_test_workspace_lead`，`migrate deploy` 后运行 `vitest.integration.config.mts test/workspace-onboarding.database.spec.ts`                         | 6 passed                                                    |
| CLI workspace                | 12 个 workspace/config/index/setup/roles spec，`--maxWorkers=1`                                                                                                   | 140 passed, 2 skipped（Windows 不支持 POSIX mode-bit 断言） |
| Web workspace                | `vitest run src/pages/ProjectWorkspace.test.tsx src/App.test.tsx src/nav.test.ts src/pages/ProjectDetail.test.tsx src/components/WorkflowInstanceDialog.test.tsx` | 51 passed                                                   |
| API typecheck                | `pnpm --filter @workmesh/api exec tsc --noEmit`                                                                                                                   | exit 0                                                      |
| CLI typecheck                | `pnpm --filter @workmesh/cli exec tsc --noEmit`                                                                                                                   | exit 0                                                      |
| Web lint                     | `pnpm --filter @workmesh/web run lint`                                                                                                                            | exit 0                                                      |

API DB 集成覆盖：真实部分唯一索引复用、alias 409、并发 `Project.version` CAS、并发接入码消费、并发发布、`actorStamp` 审计。

### 2.2 本轮复跑与真实链路状态

| 套件                                        | 命令                                                                                                                                                                                                                                                                                                                                                                                                  | 本轮结果                                                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web onboarding 聚焦测试（本轮）             | `pnpm --filter @workmesh/web exec vitest run src/pages/ProjectWorkspace.test.tsx src/components/EnrollmentCodeDialog.test.tsx src/App.test.tsx src/nav.test.ts src/pages/ProjectDetail.test.tsx src/components/WorkflowInstanceDialog.test.tsx --reporter=dot`                                                                                                                                        | Node v24.22.1 下 6 files / 59 passed。                                                                                                                                                                                                              |
| Web 扩展聚焦测试（含 Knowledge）            | `pnpm --filter @workmesh/web exec vitest run src/pages/ProjectWorkspace.test.tsx src/components/EnrollmentCodeDialog.test.tsx src/App.test.tsx src/nav.test.ts src/pages/ProjectDetail.test.tsx src/components/WorkflowInstanceDialog.test.tsx src/pages/Knowledge.test.tsx --reporter=dot`                                                                                                           | 本轮 7 files 中 6 passed、1 failed；`Knowledge.test.tsx:1268` 的 `getByText(/当前生效 · v1/)` 命中多个节点。onboarding 六文件独立复跑通过。                                                                                                         |
| Web 类型检查（当前状态）                    | `pnpm --filter @workmesh/web run lint`                                                                                                                                                                                                                                                                                                                                                                | Node v24.22.1 下 exit 0。先前 Node 20.13.1 运行报 `apps/web/src/pages/Knowledge.tsx:76` 的 TS2322（`KnowledgeBaseKind \| (string & {})` 类型不匹配）；该错误未在当前复跑中重现。                                                                    |
| CLI 全套（19:59:03 快照）                   | `pnpm --filter @workmesh/cli test`                                                                                                                                                                                                                                                                                                                                                                    | Node v24.22.1 下 20 files / 226 passed / 2 skipped。此后又新增两项 bind 负向测试并调整缓存 checksum 校验，226 只对应此前快照。两个跳过项为 Windows 不支持 POSIX mode-bit 断言。此前 device-header 失败未能在 focused client test 或全套复跑中重现。 |
| CLI 配置/bind（20:03:37）                   | `pnpm --filter @workmesh/cli exec vitest run src/workspace-config.test.ts src/workspace-bind.test.ts --reporter=dot`                                                                                                                                                                                                                                                                                  | Node v24.22.1 下 2 files / 52 passed / 2 skipped；覆盖单独篡改 locator、repositoryId、repository project、payload project、archived 和在线缺 payload/project/digest。                                                                               |
| CLI init 聚焦                               | `pnpm --filter @workmesh/cli exec vitest run src/workspace-init.test.ts --reporter=dot`                                                                                                                                                                                                                                                                                                               | Node v24.22.1，24 passed；包括 `payloadPresent=false` 与原始授权错误及锁释放失败。                                                                                                                                                                  |
| CLI 最终全套（20:04:56）                    | `pnpm --filter @workmesh/cli test`                                                                                                                                                                                                                                                                                                                                                                    | Node v24.22.1，20 files / 232 passed / 2 skipped，exit 0。                                                                                                                                                                                          |
| CLI 类型与目标 lint                         | `pnpm --filter @workmesh/cli exec tsc --noEmit`；`pnpm --filter @workmesh/cli exec eslint src/workspace-config.ts src/workspace-config.test.ts src/workspace-bind.ts src/workspace-bind.test.ts src/workspace-fixtures.ts src/workspace-init.ts src/workspace-init.test.ts`                                                                                                                           | 均 exit 0。                                                                                                                                                                                                                                         |
| API onboarding 单测（较早一组）             | `pnpm --filter @workmesh/api exec vitest run src/projects/project-repositories.service.spec.ts src/projects/project-repository-declaration.service.spec.ts src/projects/workspace-definition.service.spec.ts src/projects/workspace-enrollment.service.spec.ts --reporter=dot`                                                                                                                        | 4 files / 48 passed。                                                                                                                                                                                                                               |
| API onboarding focused unit（Node 24 最新） | `pnpm --filter @workmesh/api exec vitest run --config vitest.unit.config.mts src/projects/project-repository-declaration.service.spec.ts src/projects/workspace-definition.service.spec.ts src/projects/workspace-enrollment.service.spec.ts src/projects/workspace-definition-validator.spec.ts --reporter=dot`                                                                                      | Node v24.22.1 下 4 files / 51 passed。此组与上面的 4-file / 48-test 命令文件集合不同。                                                                                                                                                              |
| API onboarding ESLint                       | `pnpm --filter @workmesh/api exec eslint src/projects/project-repository-declaration.service.ts src/projects/project-repository-declaration.service.spec.ts src/projects/workspace-definition.service.ts src/projects/workspace-definition.service.spec.ts src/projects/workspace-enrollment.service.ts src/projects/workspace-enrollment.service.spec.ts test/workspace-onboarding.http.e2e-spec.ts` | exit 0（API agent 报告）。不代表类型检查通过。                                                                                                                                                                                                      |
| API 类型检查                                | `pnpm --filter @workmesh/api exec tsc --noEmit`                                                                                                                                                                                                                                                                                                                                                       | Node v24.22.1 下 exit 0（DTO import 修复后）；此前短暂出现的类型错误均未在最终检查中复现。                                                                                                                                                          |
| Onboarding DB 集成 spec                     | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/workspace-onboarding.database.spec.ts --reporter=dot`                                                                                                                                                                                                                                                        | Node v24.22.1，隔离 PG 17.11：最终 1 file / 16 tests passed。首跑 7 passed / 5 failed，后续修正 fixture 计数和错误码期望，最终通过；此前 guard-skipped 记录保留见 §7。                                                                              |
| 真实 AppModule HTTP spec                    | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/workspace-onboarding.http.e2e-spec.ts --reporter=dot`                                                                                                                                                                                                                                                        | Node v24.22.1，隔离 PG 17.11：最终 1 file / 1 test passed；首跑 1 failed（错误码期望），修正后通过。                                                                                                                                                |

本轮在新建一次性隔离 PostgreSQL 17.11（loopback `127.0.0.1:45052`）的新测试库，以 Prisma `migrate deploy` 准备 schema，0001–0020 成功、exit 0；这是测试准备，不是重跑 T1 空库/存量/四中间态迁移矩阵。测试 URL 显式通过 guard；不把已有 postgres 进程视为测试库。初次 DB 7 passed / 5 failed、HTTP 1 failed 的 fixture 计数和错误码期望已修正，最终 DB 16/16、HTTP 1/1 passed（Node 24）。隔离 PostgreSQL 已正常停止，数据目录保留以备核对。

DB 测试覆盖连接池限制 1/2、事务内授权及锁、P2002 注入与重试、provider identity、同 key 与项目/文档归档及文档读取 grant 撤销同步屏障。HTTP spec 使用真实 AppModule、真实 guard、DTO、鉴权与 envelope，覆盖声明/草稿/发布/接入码四操作的同 key、匿名消费与领域 limiter 等；各 test 证明的范围以对应 spec 为准。

真实 main 全局 limiter：`pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/main-global-limiter.e2e-spec.ts --reporter=dot`，清除 DB URL、配置 max=1；修复前 1 failed（429 缺 `error` envelope），修复后 1/1 passed；真实 HTTP 401→429，真实 CLI `V1Client` 读取 `RATE_LIMITED`。此测试与 AppModule 领域 limiter 测试分别运行，**全局与领域 limiter 同时触发时的优先级尚未验证**。

仍未真实运行：

- 完整 API HTTP + CLI + Web 三方联调闭环。
- 真机 macOS / Linux 路径行为。
- 浏览器 E2E（P0a 明确不要求浏览器 E2E）。
- 旧 `ProjectDetail` 的仓库登记入口已改为跳转 `/workspace`，不再用 owner/name 拼 `externalId`；`WorkflowInstanceDialog` 的旧登记表单不再直接调用 provider POST，只提示到 `/workspace` 声明。两处均未做真实 API 联调。

## 3. Git 拓扑与 CLI

真实或临时 git 仓库覆盖（CLI 测试内，Windows）：

| 拓扑                    | 覆盖方式                       | 结果             |
| ----------------------- | ------------------------------ | ---------------- |
| 单仓                    | 临时真实 git repo              | 通过             |
| monorepo（单 Git root） | 临时真实 git repo              | 通过             |
| sibling 多仓            | 多个临时真实 git root          | 通过             |
| worktree                | 真实 `git worktree`            | 通过             |
| submodule               | 真实 submodule 夹具            | 通过             |
| 无 Git                  | 普通目录                       | 通过             |
| 目录移动                | 路径变化后状态报告             | 通过             |
| 同仓不同绝对路径        | 两处路径同一 canonical locator | 通过（测试夹具） |

CLI 五态、`migrate`、`init`、`discover`、`bind`、`status` 均由单元测试覆盖；本轮还运行了真实子进程并发索引更新与并行 bind，验证共享 configHome 下两条 workspace 记录均保留。路径测试覆盖 Windows 大小写等价、符号链接/junction 别名和不同同名目录。另已用真实 CLI 和真实 API/隔离 DB，在单机两个独立 root/configHome 完成 init（consume、HTTP HUMAN 设备授权批准、按精确 revision 读取及 digest 校验）、bind 和 status；这是单机模拟，不是双机或 Web 页面操作。脱敏日志为 `%TEMP%\workmesh-p0a-cli-evidence.log`。索引和 bind 锁通过独占文件创建；异常中断留下的完整或部分锁均失败关闭，需要确认没有 CLI 写入进程后手动移除。

本轮单机模拟在 Node 24 下以隔离库 `workmesh_test_p0a_cli_e3ab4a4d14a5`、19:56:52–19:57:20 完成，驱动命令 `node "$env:TEMP\workmesh-p0a-cli-evidence.cjs" 2>&1 | Tee-Object -FilePath "$env:TEMP\workmesh-p0a-cli-evidence.log"` exit 0；事先以 `P0A_CLI_DB` 指定该测试库。API 构建命令为 `pnpm --filter @workmesh/api exec tsc --project tsconfig.json --outDir .p0a-cli-build-e3ab4a4d14a5 --incremental false`。该 CLI 模拟使用的是随后 global limiter 修复之前启动的 API 版本；limiter 修复后的真实 main 结果见 §2.2，不能倒推该 CLI 模拟已覆盖修复后的服务。本机临时测试 root 含测试凭据，应按凭据处理，未在本记录中列出。

此后 init/bind/config 仍有修改，约 20:07 使用最终 CLI 源码复跑：`node "$env:TEMP\workmesh-p0a-cli-evidence.cjs" 2>&1 | Tee-Object -FilePath "$env:TEMP\workmesh-p0a-cli-final-evidence.log"`，`P0A_CLI_DB=workmesh_test_p0a_cli_e3ab4a4d14a5`，exit 0。两个独立 root 的 init、bind、status 均 exit 0，project/revision/repository 身份一致且导出配置不含测试 root；设备授权仍由 HUMAN 经 HTTP 批准，未操作真实 Web 页面，也不代表真实双机。API 使用同一 19:56 私有编译快照，先于 main limiter 修复；修复后的真实 main limiter 由 §2.2 独立测试覆盖。本次临时 root `workmesh-cli-p0a-omDwyS` 含测试凭据，应按凭据处理。

API 驱动结束、隔离 PostgreSQL 停止后，在上述单个测试环境真实执行离线 bind：`node apps/cli/node_modules/tsx/dist/cli.mjs apps/cli/src/index.ts workspace bind --root "$env:TEMP\workmesh-cli-p0a-omDwyS\machine-a\workspace" --repository 0bc4d03b-8c06-4f08-96fc-d7a63a1498ec --path . --config-home "$env:TEMP\workmesh-cli-p0a-omDwyS\machine-a\config" --offline --yes`，exit 0，来源为 `CACHED_DEFINITION`，并显示离线不能获知撤销/归档的提示；此结果不证明本地缓存能抵御主动篡改。

## 4. 跨平台矩阵

| 场景                | Windows                                        | macOS  | Linux  |
| ------------------- | ---------------------------------------------- | ------ | ------ |
| 基础路径 / Git 探测 | 真实运行（临时 repo）                          | 未运行 | 未运行 |
| 盘符路径            | 真实运行（临时路径）                           | N/A    | N/A    |
| UNC 路径            | 未运行                                         | N/A    | N/A    |
| 中文路径            | 仅测试夹具/静态                                | 未运行 | 未运行 |
| 空格路径            | 仅测试夹具/静态                                | 未运行 | 未运行 |
| 符号链接            | Windows 临时目录 junction 夹具                 | 未运行 | 未运行 |
| 大小写变化          | 路径身份 helper 夹具通过；文件系统端到端未运行 | 未运行 | 未运行 |
| 两台机器不同根目录  | 单机两套独立根目录/API/DB 模拟，真实双机未运行 | 未运行 | 未运行 |

因此 T11 当前只能判定为 **部分完成**：Windows 已有本机 Git/路径夹具、junction 与独占锁文件创建验证；大小写覆盖仅为路径身份 helper 夹具，文件系统端到端、macOS/Linux 和 UNC 未运行，不是跨平台实测通过。

## 5. §25 统一闭环

目前具备的分层证据（不构成完整闭环）：

1. 隔离库 Prisma migrate deploy（空库/存量库/四中间态）。
2. 本轮隔离 PostgreSQL DB spec 16/16 与真实 AppModule HTTP spec 1/1；先前服务层隔离 DB 记录仍属历史证据。
3. Web mockFetch：成员只读、manager 写、NOT_CONFIGURED、空仓库、声明、草稿、校验、发布、409/422、票据、一次性码。
4. CLI mock 和真实 CLI：五态、migrate、init、discover、在线/离线 bind、status；本轮两个独立 root/configHome 接入同一真实 API/DB 项目，身份一致、导出配置无测试机器绝对根路径，但只是一台机器的模拟。

未完成或未真实串联的段：

- Web 页面 → 真实 API → 真实 DB 的操作证据。隔离 API 和 Vite 已启动，但计算机操作工具无法可靠识别当前 Windows 浏览器 URL，按其策略停止；未进行页面操作。P0a 不要求浏览器 E2E，但必须有真实页面到服务端和数据库的闭环。
- 真实双机上的 CLI 接入、绑定、身份一致性与配置导出；当前真实 CLI 证据仅为单机双根目录模拟，设备授权由 HUMAN 经 HTTP 批准。
- 机器 A/B 不同根目录的真实双机闭环。
- 旧 Web 仓库登记入口的新票据流程。
- macOS/Linux 实际运行。

结论：**§25 未完整通过**。本轮隔离 DB、真实 HTTP 和单机双根目录 CLI/API/DB 有运行证据；Web 页面、真实双机及其他 gate 未完成，不能写成 P0a 端到端验收通过。

## 5.1 §19.2.1 用例 20–29 覆盖状态

| 用例                          | 覆盖方式                                                                             | 状态                                             |
| ----------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 20 迁移四中间态               | 隔离库 Prisma deploy 真实演练                                                        | 通过（隔离库）                                   |
| 21 v1→v2 dry-run/apply/双配置 | CLI 单测（真实临时文件）                                                             | 通过（本地文件），未做真实 API/DB                |
| 22 init --join 八步           | 真实 CLI + API/DB，两个独立 root/configHome，HTTP HUMAN 授权批准                     | 单机模拟通过；真实双机和 Web 页面授权未验证      |
| 23 离线 bind                  | CLI 单测及基于真实接入缓存的单环境离线 CLI bind，见 §3                               | 单环境已执行；强认证和新鲜度边界见 §6            |
| 24 幂等/票据/声明             | API unit、隔离 DB 16/16 及 AppModule HTTP 1/1；HTTP 覆盖四操作同 key                 | 部分验证；完整 §25 闭环仍未通过                  |
| 25 并发/版本                  | 隔离 PostgreSQL DB 16/16，含同 key 与项目/文档归档、读取授权撤销同步屏障及事务锁测试 | 已取得该轮隔离 DB 证据；完整验收仍需其他 gate    |
| 26 身份字段/CHECK             | T1 postcheck；本轮隔离 DB provider identity 测试                                     | 隔离 DB 验证通过；不代表共享环境部署状态         |
| 27 P0a 不冒充 provider        | Web mock 文案 + API 不写 lastVerified                                                | 静态/单测通过                                    |
| 28 接入码权限                 | API unit、隔离 DB 和真实 AppModule HTTP，含领域 limiter                              | 部分验证；global 与领域 limiter 相互优先级未验证 |
| 29 文档引用 payload           | DB 文档归档、权限撤销同步屏障及 HTTP 无效文档发布断言                                | 隔离 DB/HTTP 已执行；§25 真实 Web 页面待验证     |

## 6. 剩余 gate 与解除条件

- **真实 HTTP 剩余范围**：隔离 DB、AppModule 及真实 main 全局 limiter 的本轮测试已运行；全局与领域 limiter 同时触发的优先级尚未验证。后续复跑仍须用经 guard 接受的隔离测试库，不得连接共享库或重跑 T1 矩阵。
- **CLI 与 locator 信任边界**：单机两套 root/configHome 的真实 init/bind/status 已通过，但真实双机未验证。revision payload 必须存在并校验 digest，核对 project 与 payload/仓库 ID、key、path 关联；本地 checksum 只能检测未同步更改，攻击者可同时修改缓存和 hash。旧缓存需在线刷新；离线不能获知撤销，也无 TTL 承诺。服务端签名或认证快照及新鲜度策略需协议和产品决策，强认证/新鲜度 **BLOCKED**，不宣称攻防保证。
- **Web→API→DB**：解决当前浏览器 URL 不可可靠识别的操作阻塞，或由人工在真实 Web 页面完成声明、草稿、发布和接入码操作，并以真实 API/DB 状态核对结果。P0a 不要求浏览器 E2E；人工页面操作或现有轻量入口均可，但必须保留可复核的请求/结果证据。
- **平台矩阵 / 双机**：在真实 Windows、macOS、Linux runner 补做要求的路径/Git 场景。真实第二台设备未提供前，双机闭环保持未验证；双临时目录只能标模拟。
- **外部迁移历史**：由各环境负责人提供脱敏的部署记录及 `_prisma_migrations` 迁移名称/checksum/完成状态，供本地 migration history 比对。缺少这些证据时，部署状态保持未知；不得自行连接共享库，也不得用 `migrate resolve` 消除不确定性。
- **P0b**：完整目录自动发现恢复、根外 checkout 等按后续变更请求跟踪，不计入本轮 P0a 已完成项，也不得借此放宽路径边界。

## 7. 失败与恢复记录

- 本轮新隔离库首跑 DB 7 passed / 5 failed、HTTP 1 failed；调整 fixture 计数和错误码期望后分别 16/16、1/1 passed。真实 main limiter 修复前 HTTP spec 1 failed（429 无 error envelope），修复后 1/1 passed；global 与领域 limiter 的互相优先级仍未验证。

- 先前串行复跑记录包括 Web 六文件 58 passed 与七文件扩展套件 82 passed。本轮 Node v24.22.1 复跑中，onboarding 六文件为 59/59 passed；将 `Knowledge.test.tsx` 纳入的七文件扩展套件为 82 passed、1 failed，失败是 `Knowledge.test.tsx:1268` 的重复文本查询。Web `lint`（`tsc --noEmit`）通过，API onboarding focused unit 为 4 files / 51 passed、API tsc 通过。准备隔离库前 onboarding DB spec 12 skipped、真实 AppModule HTTP spec 1 skipped；后续隔离库运行结果见 §2.2。CLI 新增路径/锁测试完成后，全套复跑为 20 files / 213 passed / 2 skipped，CLI tsc 通过；HTTP spec 目标 ESLint 与 Prettier check 通过。更早并行 CLI/Web 运行超时和失败未在当时串行复跑中重现；资源争用可能是原因，但未获证实。上述各次结果按命令和时间区分，不将历史通过覆盖本轮失败。
- Prisma schema engine 在受限环境曾出现 `spawn EPERM`；本次使用隔离临时 PostgreSQL 并在可执行 schema engine 的环境下完成真实 deploy。此前 SQL 直执行记录仅作为补充证据，不替代 deploy。
- `workspace migrate` 的 dry-run/inspect 零写入、apply 回滚到 V1_ONLY、keep-v2 有效/无效、journal 不满足、`.bak` 忽略、重复执行幂等均有 CLI 单测；未做真实双配置环境演练。
- 所有失败路径都保留原配置/数据；未执行删除、重置或迁移历史伪造。

## 8. 本轮修改文件与测试产物

下列文件为本轮实际修改范围；这些文件可能在本轮开始前已有并行修改，本轮未覆盖或归因其他已有工作。

- CLI：`apps/cli/src/workspace-init.ts`、`workspace-init.test.ts`、`workspace-config.ts`、`workspace-config.test.ts`、`workspace-bind.ts`、`workspace-bind.test.ts`、`workspace-fixtures.ts`：接入及本地配置、缓存校验、绑定和回归测试。
- API：`apps/api/src/common/v1-idempotency.ts`、`v1-idempotency.prisma-repository.ts`，`apps/api/src/auth/v1-authorization.ts`、`v1-authorization.prisma-repository.ts`，`apps/api/src/projects/project-repository-declaration.service.ts`、`workspace-definition.service.ts`、`workspace-enrollment.service.ts`，以及 `apps/api/test/workspace-onboarding.database.spec.ts`、`workspace-onboarding.http.e2e-spec.ts`：幂等、授权、事务与隔离 DB/HTTP 验证。
- API 全局限流：`apps/api/src/main.ts`、`apps/api/test/main-global-limiter.e2e-spec.ts`：429 envelope 及真实 main 回归验证。
- Web：`apps/web/src/components/DeclareRepositoryDialog.tsx`、`DeclareRepositoryDialog.test.tsx`、`apps/web/src/api/resources.ts`：仓库声明入口及测试。
- 文档：`docs/design/project-workspace-onboarding.md`、`docs/testing/workspace-onboarding-acceptance.md`：保留冻结契约并记录实施状态、证据与未完成 gate。

单独保留的测试产物为 `apps/api/.p0a-cli-build-e3ab4a4d14a5/` 和 `apps/web/.p0a-vite-e3ab4a4d14a5.mjs`，不属于功能源码。删除生成目录的请求被自动审批拒绝，未绕过；临时测试 root 含凭据，按凭据处理。

## 9. 2026-11-06 后续复跑：提交后恢复与限流交互

本节追加新证据，上文先前失败、跳过和结论保留。后续结果仅覆盖所列命令及当时文件集合，不把工作树其他并行改动归因于本次测试。开始快照 HEAD 为 `021ac3aafbdffd1b38c8a614a2d27c0f0d8cbfe6`，共 970 个状态条目：staged 0、unstaged 181、untracked 789；完整状态清单和 diff 保存在 `%TEMP%\workmesh-p0a-final-baseline-5340f219bb9e487993fadc5a1bf04d05`。本次未暂存、提交或重置；共享工作树后续仍有并行修改，该基线不是各命令运行时完整状态的替代。

测试使用 Windows NT 10.0.22000、Node v24.22.1（通过在 `PATH` 前加入 `C:\Users\Windows11\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` 指定）、Git 2.53.0.windows.1；时间为本地时间 Asia/Shanghai。以下文件已有或可能有并行工作，只记录本次实际追加内容：

- `apps/cli/src/workspace-init.ts`、`apps/cli/src/workspace-init.test.ts`：在 workspace.json 和索引提交后发生 pending 清理故障时，保留已提交文件、实际错误代码及提交状态，说明无需重新签码或重新 init，并指导确认无写入进程、核对后手动清理 pending。故障注入断言 EACCES、两文件一致、pending 保留、锁释放和再次 init 不消费码。
- `apps/api/test/main-limiter-interaction.e2e-spec.ts`：使用 guard 核验过的一次性本地 PostgreSQL 与真实编译启动的 main，结合真实 CLI `V1Client` 检验两个 limiter 的相互作用。测试只读取随机不存在的接入码记录，不写入测试数据。

| 时间 / 文件集合 | 精确命令（从仓库根目录执行） | 结果 |
| --- | --- | --- |
| 约 20:40:18；CLI init 测试及源码 | `pnpm --filter @workmesh/cli exec vitest run src/workspace-init.test.ts --reporter=dot` | 25/25 passed，exit 0。同期 `pnpm --filter @workmesh/cli exec eslint src/workspace-init.ts src/workspace-init.test.ts` exit 0；`pnpm --filter @workmesh/cli exec tsc --noEmit` 首次失败，测试中的 `unknown` 未缩窄，已修正。 |
| 20:40:41；修正后的同一 CLI 文件集合 | `pnpm --filter @workmesh/cli exec vitest run src/workspace-init.test.ts --reporter=dot` | 25/25 passed，exit 0；`pnpm --filter @workmesh/cli exec eslint src/workspace-init.ts src/workspace-init.test.ts` 和 `pnpm --filter @workmesh/cli exec tsc --noEmit` 均 exit 0。 |
| 20:41:50；`src/git.test.ts`、`src/workspace-config.test.ts` | `pnpm --filter @workmesh/cli exec vitest run src/git.test.ts src/workspace-config.test.ts --reporter=verbose` | 37 passed / 2 skipped，exit 0；这些测试包括临时 Git 仓库及路径夹具。中文、空格、大小写、junction 的具体覆盖以测试代码与已有矩阵为准，不把夹具一概记为实际平台端到端。真实 Windows UNC、macOS、Linux 和双机仍未运行。 |
| 约 20:43；`test/main-limiter-interaction.e2e-spec.ts` | `pnpm --filter @workmesh/api exec vitest run test/main-limiter-interaction.e2e-spec.ts --reporter=verbose` | 首次使用默认 unit 配置，没有发现该 test 文件，exit 1；未计为通过。 |
| 20:43:25；同一 limiter 测试，production main 临时构建 | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/main-limiter-interaction.e2e-spec.ts --reporter=verbose` | 1/1 passed，exit 0；`pnpm exec eslint apps/api/test/main-limiter-interaction.e2e-spec.ts` exit 0。 |

限流测试环境显式设置 `WORKMESH_TEST_ENV=local`、`WORKMESH_TEST_DATABASE_USERS=postgres`、`WORKMESH_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:51801/workmesh_test_p0a_final?schema=workmesh_v1`；套件执行 guard 并查询 `current_database()` 核对目标。真实 main 的全局上限设为 11，匿名 consume 的领域上限为 10：同一客户端前十次请求返回 404，第 11 次领域层返回 429，错误 envelope 的 message 为 `RATE_LIMITED`；第 12 次两层均达到阈值，由全局层先返回 429，message 为 `请求过于频繁`，有 Retry-After 且响应头 request ID 与 envelope 一致。真实 CLI 对两个 429 均报告 `RATE_LIMITED`、status 429，12 次 POST 没有自动重试。此记录补充了上文当时尚未验证的交互优先级；它不代替真实 Web、完整 CLI 闭环或其他未完成 gate。

## 10. 2026-11-06 成员权限竞态与 Web 组件复验

本节为 §9 之后的补充，保留此前的失败、跳过和当时结论。测试期间共享工作树有并行修改；HEAD 为 `021ac3aafbdffd1b38c8a614a2d27c0f0d8cbfe6`，这不是干净工作树。此次成员竞态实际修改的三个文件为 `apps/api/src/projects/workspace-definition.service.ts`、`apps/api/src/projects/workspace-enrollment.service.ts`、`apps/api/test/workspace-onboarding.database.spec.ts`，三个文件在本次工作前已为 untracked；其余工作树状态见 §9 开始快照。各次测试没有单独保存完整工作树快照，不能将该开始快照当成每次运行时的精确文件状态。未暂存、提交、重置或清理其他改动。

### 10.1 成员权限变化竞态：隔离 PostgreSQL

使用 Windows 本机、Node `v24.22.1`，时间为 2026-11-06 Asia/Shanghai。专用一次性 PostgreSQL 17.11 监听 loopback `127.0.0.1:51761`，数据库名称 `workmesh_test_member_races`；测试使用现有 guard 验证目标并检查 `current_database()`。该新库通过 `prisma migrate deploy --schema prisma/schema.prisma` 应用 0001–0020，exit 0，仅为测试准备 schema，不能替代已有 T1 迁移矩阵或说明共享环境状态。测试后使用 `pg_ctl -D <该实例专用数据目录> -m fast -w stop` 正常停机，数据目录 `%TEMP%\workmesh-p0a-auth-race-b570e60796f140119d3b36e76fd116bf\data` 保留。

在仓库根目录 PowerShell 中运行，先将 `C:\Users\Windows11\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` 前置于 `PATH`，再设置 `WORKMESH_TEST_ENV=local`、`WORKMESH_TEST_DATABASE_USERS=postgres`、`WORKMESH_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:51761/workmesh_test_member_races?schema=workmesh_v1`。实际记录如下：

| 本地启动时间 | 文件集合 / 精确命令 | 实际结果 |
| --- | --- | --- |
| 20:41:32 | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/workspace-onboarding.database.spec.ts -t '成员权限预检后变化' --reporter=dot` | exit 1；4 failed、16 skipped。新增测试当时依赖全套运行先创建 definition，过滤运行缺少夹具。后来补建测试所需 definition/revision；此次失败不证明权限竞态。 |
| 20:41:43 | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/workspace-onboarding.database.spec.ts --reporter=dot` | exit 1；17 passed、3 failed。同步屏障下草稿、发布在 OWNER 降级后仍成功，签码在成员撤权后仍成功；声明正确拒绝。这是在隔离库直接更新成员行构造的竞态，并非通过已有撤权或降级产品接口复现。 |
| 20:43:06 | 同一 DB spec 和命令 | exit 1；19 passed、1 failed。已加入事务内重验；原归档测试的假授权未模拟归档错误，修正该测试夹具后复跑。 |
| 20:43:26 | 同一 DB spec 和命令 | exit 0；20/20 passed，后续又增加撤权和普通成员并发测试。 |
| 20:45:13 | 同一 DB spec 和命令 | exit 0；25/25 passed。 |
| 20:43:49 | `pnpm --filter @workmesh/api exec vitest run --config vitest.unit.config.mts src/projects/workspace-definition.service.spec.ts src/projects/workspace-enrollment.service.spec.ts src/projects/project-repository-declaration.service.spec.ts --reporter=dot` | exit 0；3 files、38/38 passed。 |
| 同轮 | `pnpm --filter @workmesh/api exec tsc --noEmit` | exit 0。 |
| 20:45 左右 | `pnpm exec eslint apps/api/src/projects/workspace-definition.service.ts apps/api/src/projects/workspace-enrollment.service.ts apps/api/test/workspace-onboarding.database.spec.ts` | exit 0。 |

最终屏障测试在预检之后、事务取得项目锁之前，由另一个隔离库连接直接将成员 `revokedAt` 置值或将 OWNER 改为 MEMBER，递增成员版本，然后允许事务继续。草稿、发布、声明分别验证撤权返回 404、降级返回 403；票据未消费，项目及定义版本、revision、审计、幂等、仓库和接入码没有半写。签码撤权返回 404；降级为仍活动的 MEMBER 后仍可签发，审计 actorStamp 的成员版本与事务锁后版本一致。另有活动 MEMBER 正常签码测试。真实 PostgreSQL 屏障覆盖的是这些构造状态和执行次序，不能推断线上曾发生越权写入。

修复在草稿、发布及签码事务中按 Project 行 `FOR UPDATE` → ProjectMember 行 `FOR SHARE` 的顺序锁定，再用当前事务 client 重验活动 HUMAN 成员；草稿和发布继续要求 OWNER/ADMIN，签码保留任意活动 HUMAN 成员契约。发布和签码审计使用锁后授权上下文；签码重放撤销未消费旧码的路径也在锁后重验。声明原本已采用 Project → ProjectMember 锁与事务内重验，屏障验证了该路径。

实际产品写路径的代码审查：`projects.service.ts` 的 `addMemberByEmail` 能将撤销成员重新激活并设为 MEMBER；`invitations.service.ts` 的 `join` 能重新激活撤销成员；两处成员更新未先锁 Project。`project-role.prisma-repository.ts` 的业务角色授予/撤销先锁 Project，之后对目标成员版本执行 CAS 递增；业务角色 assignment 不等于 ProjectMember 的 OWNER/ADMIN 管理角色。代码检索未找到现成成员撤权或 OWNER/ADMIN 降级接口，因此上述撤权和降级测试均为直接构造数据库条件，不能表述为现有接口复现。

### 10.2 三个 Web 组件测试的历史及本轮结果

三个目标文件为 `src/components/DeclareRepositoryDialog.test.tsx`、`src/components/ConfirmationPrompt.test.tsx`、`src/pages/ProjectWorkspace.test.tsx`。19:52:43 的历史命令为 `pnpm --filter @workmesh/web exec vitest run src/components/DeclareRepositoryDialog.test.tsx src/components/ConfirmationPrompt.test.tsx src/pages/ProjectWorkspace.test.tsx --reporter=dot | Select-Object -Last 22`，当时报告 3 files、31/31 passed、exit 0；未保留逐文件工作树快照。由于管道截取和快照限制，只能按该次记录报告，不能推断其覆盖后续更改。

归档回归首跑的现存日志 `%TEMP%\workmesh-archive-test.log` 显示 20:41:39 实际命令为 `pnpm --filter @workmesh/web exec vitest run src/pages/ProjectWorkspace.test.tsx -t '项目切换后旧归档' --reporter=dot`，exit 1、4 failed / 20 skipped；失败定位到 `findByText('beta/workspace')` 多个匹配。`%TEMP%\workmesh-archive-test2.log` 显示 20:42:07 后续过滤运行 4 passed / 20 skipped。曾提及的 35 项（31 passed、4 failed）没有找到可核对的原始日志，不能把它作为已确认的实际运行结果。

20:42:48 及 20:43:45 三文件复跑的现存日志分别为 `%TEMP%\workmesh-three-web-tests.log` 和 `%TEMP%\workmesh-three-web-tests-final.log`；后者记录 `pnpm --filter @workmesh/web exec vitest run src/components/DeclareRepositoryDialog.test.tsx src/components/ConfirmationPrompt.test.tsx src/pages/ProjectWorkspace.test.tsx --reporter=dot`，3 files、38/38 passed、exit 0。相较历史 31 项，本轮增加 7 项测试；由于历史未保存逐文件快照，数量差不能单独证明覆盖差异或解释其他结果。此前提到的当前三个文件 30 项复跑，其原始日志及对应工作树快照未找到，保持未核实，不凭数量差推断原因。上述组件测试为 mock 环境，不代表真实 Web 页面 → API → DB 已执行。

## 11. 2026-11-06 最终构建、真实 Web 与 API/CLI 复验

本节追加后续证据，不删除或覆盖上文旧失败、跳过、旧结论及浏览器操作阻塞记录。运行环境为 Windows 本机、Node `v24.22.1`、HEAD `021ac3aafbdffd1b38c8a614a2d27c0f0d8cbfe6` 的脏共享工作树；测试时仍有并行修改，§9 的开始快照不等同于各命令运行时完整状态。时间为 Asia/Shanghai。此节覆盖下述执行及其文件集合，不推断其他 gate 已完成。

### 11.1 最终 API/CLI 构建和真实接入

20:45:05 API 构建命令为 `pnpm --filter @workmesh/api exec tsc --project tsconfig.json --outDir .p0a-final-build-b65ec978 --incremental false`，exit 0；CLI 构建命令为 `pnpm --filter @workmesh/cli exec tsup --out-dir .p0a-final-build-b65ec978 --clean`，exit 0，输出至本轮独占的新目录。使用上述 API/CLI 构建和 §9 的 guard 核验过的一次性隔离 PostgreSQL（loopback `127.0.0.1:51801`，`workmesh_test_p0a_final`），约 20:45:21 的 PowerShell 调用为 `$env:PATH='C:\Users\Windows11\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; $env:P0A_CLI_DB='workmesh_test_p0a_final'; node (Join-Path $env:TEMP 'workmesh-p0a-cli-final-b65ec978.cjs')`，实际输出重定向至 `%TEMP%\workmesh-p0a-cli-final-b65ec978.log`，exit 0。驱动脚本由旧证据脚本复制并替换数据库端口和 API/CLI 构建路径，脚本中 API 监听端口为 46091。执行了真实注册、HTTP HUMAN 批准设备授权、consume → 读取精确 revision 并校验 digest → init → bind/status。两个不同的 workspace root 和 configHome 在同一台机器上，仅是双环境模拟，不能称为真实双机。该轮使用的 API 构建包含本轮成员权限事务重验和 main limiter 改动，不再沿用 §3 较早构建。

### 11.2 真实页面 → API → 数据库

20:46–20:48 使用真实 IAB 页面、本地 Vite、真实 main/API 和隔离数据库：注册本地测试用户，创建 `PWEB` 项目 `ba032b52-3d08-46b1-bb86-5a9d9f51e242`；声明仓库 `7b46eb30-0177-4bfb-a3f8-b872f5e23443`；选择 `SINGLE_ROOT`、校验并保存草稿、通过票据发布、签发接入码。页面显示 revision `62a2a167-d103-40e1-a9a9-5d33ac798787`，digest `cf07cf9a8c3335fd5e43fa941876901335dd110e0ca12934b086818a37e22e7a`。

隔离数据库只读 SELECT 的脱敏结果保存于 `%TEMP%\workmesh-p0a-web-db-b65ec978.log` 和 `%TEMP%\workmesh-p0a-web-operations-b65ec978.log`：查询结果与页面所示项目、仓库、revision 和 digest 一致，定义版本为 v2；仓库 identityMode 为 DECLARED 且未标记为 provider 已核验；接入码引用同一 revision 且未消费。后一个日志记录声明、草稿保存、发布、签码的 method/route、幂等记录提交时间，以及声明、发布和签码审计成功；日志不含凭据。页面完整网络请求/响应包未单独保存，不能把数据库记录当成完整 HTTP 包；页面观察和数据库记录各自证明的范围如上。此前浏览器无法可靠操作的失败仍为历史记录，本次后续页面操作与之分时记录。

### 11.3 最终 HTTP 与 limiter 复验

下列测试使用 §9 同一隔离测试环境设置和 guard；命令从仓库根目录运行：

| 本地启动时间 | 精确命令 | 结果 |
| --- | --- | --- |
| 20:49:13 | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/workspace-onboarding.http.e2e-spec.ts --reporter=verbose` | AppModule 真实 HTTP：1/1 passed，exit 0。 |
| 20:49:25 | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/main-limiter-interaction.e2e-spec.ts --reporter=verbose` | 真实 main 全局与领域 limiter 交互：1/1 passed，exit 0；具体阈值、envelope 和 CLI 行为见 §9。 |

本次真实 Web 页面证据补足上文当时缺失的页面 → API → DB 操作段；单机双 root 不能替代真实双机，也不证明生产或共享环境状态。真实双机、Windows UNC、真实 macOS/Linux runner、外部环境迁移历史证据仍为 BLOCKED/UNRUN；其解除条件见 §6。因所需真实证据尚未全部满足，§24、§25 和 P0a 综合结论继续为 **C / 未完成**，不得宣布整体通过。

### 11.4 Windows 中文、空格和 junction 的真实 Git 补充

20:50:40 使用 PowerShell `New-Item` 创建 `%TEMP%\workmesh-p0a-中文 空格-b65ec978`；执行 `git -C <该目录> init`、`git -C <该目录> rev-parse --show-toplevel` 和 `git -C <该目录> status --short`。随后使用 `New-Item -ItemType Junction` 创建 `%TEMP%\workmesh-p0a-junction-b65ec978` 指向该目录；`git -C <junction> rev-parse --show-toplevel` 返回同一中文、空格真实根，exit 0。两个目录保留，未清除。这是 Windows 上的真实 Git 操作证据，不代表完整 CLI 路径矩阵、UNC、大小写端到端、macOS 或 Linux 已通过。

### 11.5 CLI 全套复跑

20:50:10，Node `v24.22.1`、上述 HEAD 和持续并行修改的工作树，在仓库根目录运行 `pnpm --filter @workmesh/cli exec vitest run --maxWorkers=1 --reporter=dot`，20 个测试文件、233 passed、2 skipped，exit 0。输出中 `--json` 和 `--password` 的 unknown option 为测试触发的预期错误文本；不能将两个 skipped 计为通过。此命令不替代真实双机或其他平台矩阵。

20:52:01 保存结束前工作树快照至 `%TEMP%\workmesh-p0a-final-after-b65ec978`，HEAD 未变；status 共 1653 条，staged 0、unstaged 183、untracked 1470；tracked diff 为 149 文件、9971 行新增、2199 行删除。快照中的 status/diff 属于整个共享工作树，不可归因于本任务；较开始新增的 untracked 包含本轮独占 API/CLI 构建及其他并行产物。`git diff --check` exit 0，只检查 Git 已跟踪 diff；命令输出含既有 LF/CRLF 提示。该段是快照后追加，未改变 status 文件集合，也未在该快照中保存此未跟踪文档的内容。一次性 API、Vite 进程和本轮 51801 PostgreSQL 已停止，数据库目录与日志保留。

## 12. 2026-11-06 21:01–21:47 T8、同项目单机双环境、离线及 Windows 补验（2026-11-07 收尾）

本节是当前状态的追加记录，保留 §1–§11 的旧失败、跳过、浏览器阻塞和分段结果。运行环境为 Windows NT 10.0.22000；构建与测试为 Node `v24.22.1`，21:26 首次恢复 bind/status 使用 Node `v20.13.1`，21:32:28–29 已用显式 Node `v24.22.1` 复跑；Git 工作树持续存在并行未提交改动。本节不把单机双环境写成真实双机，也不把数据库记录写成完整浏览器网络包。接入码、cookie、设备授权码和 CLI 凭据均未写入本文或共享日志。

21:23 的父任务只读快照显示并行工作树 HEAD 已变为 `1fd1635693a77e4b66b0e06818f553719872f494`，staged 0、unstaged 55、untracked 2105；这不是本验收任务提交。历史 `021ac3a` 是前述测试开始时的基线，不以当前文件计数推断本任务归属。

### 12.1 真实 T8 v1→v2 演练

专属临时目录为 `%TEMP%\workmesh-p0a-t8-b917-jx4S4s`；脱敏命令、退出码、文件清单和前后 SHA-256 快照保存在该目录的 `evidence.json`。实际驱动调用为：

```powershell
$env:PATH='C:\Users\Windows11\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
node (Join-Path $env:TEMP 'workmesh-p0a-t8-driver-20261106-b917-v3.cjs')
```

该驱动通过真实 CLI 入口（`apps/cli/node_modules/tsx/dist/cli.mjs` + `apps/cli/src/index.ts`）执行以下结果，命令内的 root/configHome 均为本次专属临时目录：

| 场景 | 结果 |
| --- | --- |
| 合法 v1 `workspace migrate --dry-run` | exit 0；活动文件快照和 SHA-256 完全不变，确认零写入。 |
| 合法 v1 `workspace migrate --apply` | exit 0；状态 `MIGRATED`，journal `COMMITTED`，v1 归档为 `.bak`，v2 和用户索引可读。 |
| 迁移后旧入口 `auth status --json` | exit 0；读取 v2。将本次专属 `.bak` 改为非法内容后旧入口仍读取 v2，证明 `.bak` 不作为活动配置。 |
| 合法 `DUAL_ACTIVE` + `V2_WRITTEN` journal | `workspace status` exit 5、只读并返回 `WORKSPACE_DUAL_CONFIG`；`migrate --inspect` exit 0 且无写入/删除；`workspace discover` 与 `auth status` exit 5，文件快照不变。 |
| 合法条件 `migrate --resolve keep-v2` | exit 0，收敛到 `MIGRATED`，仅归档 v1，保留 v2 和索引。 |
| 无效 v2 或非收敛 `PLANNED` journal 的 `keep-v2` | 各 exit 5；两个活动配置均保留，文件 SHA-256 不变，拒绝恢复。 |

两次早先驱动失败也保留在 `%TEMP%\workmesh-p0a-t8-b917-eeQNdj\evidence.json` 和 `%TEMP%\workmesh-p0a-t8-b917-W34Gmi\evidence.json`：前者误读 `--json` envelope 顶层字段，后者误把设计规定的 `DUAL_ACTIVE` status exit 5 当成 exit 0。v3 修正后 exit 0；这两次是演练驱动错误，不是产品失败，旧记录不删除。

### 12.2 同一项目的真实页面→API→CLI 与单机双环境

本轮真实页面使用的同一测试项目、仓库、revision 和 digest 为：project `012415bd-1a01-4bb2-993b-b26d20e93baa`、projectRepository `d5b14c87-9ecb-4ff6-afa2-482f820ff1eb`、revision `32a1d6c1-ad15-4b7a-b8f3-32561690a79f`、digest `4337c82f5944c138c04f5be400887bebe074f63096b587950e2afad7eba0df93`。页面完成声明、草稿保存、校验、发布和签码；页面实际签发的码随后用于真实 CLI `workspace init --join`。第一次设备授权等待超时 exit 1；保留失败后，用页面重新签发的码和真实网页设备授权完成 consume、精确 revision 获取和 digest 校验，`init` exit 0，`workspace status` exit 0。文档不记录任何一次性码、cookie 或凭据。

同一项目实际 checkout 的在线 bind 首次在 C 盘因 `ENOSPC` exit 9；复制凭据到 G 盘后因继承 ACL 安全检查 `CREDENTIAL_STORE_UNSAFE` exit 2；这两次失败均保留。恢复空间后的第一次重试还因隔离 PostgreSQL 已停返回 API 500，服务端日志为 `Can't reach 127.0.0.1:51913`。随后仅重启本任务专属隔离 PostgreSQL（PostgreSQL 17.11，loopback `127.0.0.1:51913`）后，使用同项目构建 `apps/cli/.p0a-sameproject-498c2a/index.js`（API `apps/api/.p0a-sameproject-498c2a/main.js`、Web `.p0a-sameproject-498c2a`），于 21:26 Asia/Shanghai 运行真实 bind/status，两者均 exit 0。21:26 这次恢复重试实际使用 PATH 中的 Node `v20.13.1`，不能计为 Node 24 复跑。

21:32:28–21:32:29 使用显式 Node `v24.22.1` 路径再次运行同一构建的 bind/status，两者均 exit 0；脱敏响应为 `G:/workmesh-p0a-sameproject-evidence/bind-node24-20261106.json` 和 `status-node24-20261106.json`。CLI 结果与页面身份一致：projectId、revisionId、digest、projectRepositoryId 如上，绑定状态 `DECLARED_MATCH`，`providerVerified=false`。命令模板（一次性码仅以占位符表示）：`workspace init --join <redacted> --root %TEMP%/workmesh-p0a-sameproject-cli-21b1 --api http://127.0.0.1:46112 --role backend --config-home <root>/config --apply --yes --timeout 180`；`workspace bind --yes --json --repository d5b14c87-9ecb-4ff6-afa2-482f820ff1eb --path . --dir <root> --config-home <root>/config --api http://127.0.0.1:46112/api/v1`；`workspace status --json --dir <root> --config-home <root>/config`。

21:34:35 的数据库证据通过现有 guard，并使用只读事务查询项目、revision、repository 关联及摘要，均与上述身份一致；脱敏结果为 `G:/workmesh-p0a-sameproject-evidence/sameproject-db-readonly-v2-success-20261106.json`，安全查询脚本为 `sameproject-db-readonly-v2-20261106.cjs`。首次带密码 URL 被 guard 拒绝、exit 2，拒绝记录保留；改为本任务专属 trust 实例的无密码 URL 后 guard 接受，未绕过 guard。数据库记录证明的关联和审计范围与页面观察、CLI 响应分开记录；未保存完整浏览器网络请求包。此同一项目单机 Web→CLI→bind/status 段不能替代真实双机。

21:37:28–21:39:16，使用真实页面新签发的另一枚一次性码，在全新第二套 root `G:/workmesh-p0a-sameproject-second-O5yl3f/checkout`、独立 configHome `G:/workmesh-p0a-sameproject-second-O5yl3f/config-home` 完成真实 consume、页面设备批准、精确 revision/digest、init、在线 bind/status。显式 Node `v24.22.1`；init 于 21:38:38 exit 0，bind/status 于 21:39:16 各 exit 0。workspaceId 为 `409cf830-498c-4ede-b225-7cd3e0932eb7`；第一环境 `%TEMP%/workmesh-p0a-sameproject-cli-21b1` 的 workspaceId 为 `0fdcd144-32c7-4353-9ecb-9783c274cdc1`，configHome 是其 `config`。两套环境没有复制凭据，第二次 init 的 timeout 参数为 300 秒；该结果仅为同一台 Windows 上的单机双环境。证据在 `G:/workmesh-p0a-sameproject-evidence/second-init-environment.json`、`second-init-node24-20261106.log`、`second-bind-node24-20261106.json`、`second-status-node24-20261106.json`，不记录明文码或设备代码。

21:41:53 通过同一 guard 的最终只读 SQL 再次核对：数据库 `workmesh_test_p0a_sameproject`、port 51913、schema `workmesh_v1`、`read_only=on`；项目/定义版本为 3/3，revisionNo 为 1，payload SHA-256 重算一致，仓库/locator/revision 关联一致。查询共观察到 5 条签码记录（3 条已消费、2 条已撤销未消费）、10 条审计和 9 条幂等操作记录。证据 `sameproject-db-readonly-final-20261106.json` 不含接入码、凭据或幂等响应正文。页面截图 `sameproject-web-evidence.jpg` 显示同一项目、revision、摘要与 DECLARED 身份；截图和只读数据库观察不能表述为完整浏览器网络请求存档。

两套环境分别导出共享 `workspace.json` 至 `environment-1-shareable-workspace.json`、`environment-2-shareable-workspace.json`，未导出用户索引或 credentials；`identity-export-build-manifest.json` 检查两者的 projectId/revisionId/digest/projectRepositoryId 均与本节身份一致，仓库路径为 `.`，共享导出没有本机绝对文件路径。manifest 还保留本次同套 `.p0a-sameproject-498c2a` API（676 文件）、CLI（3 文件）、Web（49 文件）的逐文件 SHA-256。三个构建命令均 exit 0：`pnpm --filter @workmesh/api exec tsc --project tsconfig.json --outDir .p0a-sameproject-498c2a --incremental false`；`pnpm --filter @workmesh/cli exec tsup --out-dir .p0a-sameproject-498c2a --clean`；`pnpm --filter @workmesh/web exec vite build --outDir .p0a-sameproject-498c2a --emptyOutDir false`。这些结果只对应保留的构建集合，不把后来并行源码改动当成同一次构建。辅助导出检查两次首跑失败（字符串转义、把平台 `/api/v1` 当作绝对文件路径）保留；修正检查脚本后 Node24 exit 0，不把驱动错误当作产品失败。

### 12.3 离线 locator 四场景

专属验证目录为 `%TEMP%\workmesh-p0a-offline-verify-jQGEQB`，四个场景目录为 `exact`、`missing-cache`、`bad-payload-digest`、`locator-mismatch`。Node `v24.22.1` 下使用最终 CLI 构建 `apps/cli/.p0a-final-build-b65ec978/index.js`；脱敏日志为 `%TEMP%\workmesh-p0a-offline-20261106-final.log`，驱动为 `%TEMP%\workmesh-p0a-offline-20261106-final.cjs`。这些是单机真实命令证据，不能替代真实双机：

| 场景 | 实际结果 |
| --- | --- |
| `exact`：有效 revision 缓存 + 精确 canonical locator | bind 成功。 |
| `missing-cache`：移除有效缓存 | bind 拒绝，exit 6。 |
| `bad-payload-digest`：保持 locator 但破坏 payload 摘要 | bind 拒绝，exit 6。 |
| `locator-mismatch`：摘要仍有效但 locator 不精确 | bind 拒绝，exit 6。 |

21:33:46–21:33:49 Asia/Shanghai，另使用同项目真实缓存和 `.p0a-sameproject-498c2a/index.js`，显式 Node `v24.22.1` 重跑四场景，结果仍为 exact exit 0（`DECLARED_MATCH`、`CACHED_DEFINITION`），三个负向均 exit 6 / `WORKSPACE_OFFLINE_UNVERIFIED`，哈希前后不变。证据为 `G:/workmesh-p0a-sameproject-evidence/offline-sameproject-6d4f3a/results.json` 和 `output.log`，未复制凭据；payload/digest 负向即使重算本地 checksum 仍被拒绝。命令模板：`<explicit-node> G:/yesgoo/workmesh/apps/cli/.p0a-sameproject-498c2a/index.js workspace bind --root <case-checkout> --repository d5b14c87-9ecb-4ff6-afa2-482f820ff1eb --path . --config-home <case-config-home> --offline --yes`，实际参数和时间保存在 results.json。此前 driver 转义错误 exit 1，未启动场景；失败脚本和日志同样保留。旧的不同项目缓存结果仅作历史，不与本次同项目结果混同。

三个拒绝场景的 `.workmesh` 与独立 configHome 文件哈希前后不变。该结果支持 P0a 的 fail-closed 边界；本地 checksum 能发现未同步损坏，但不能抵抗同时改写缓存和 checksum 的本机主动篡改，离线也看不到服务端撤销/归档，当前没有既定 TTL。强认证快照、签名和 TTL 仍是产品/协议待决策，不是本轮新增的冻结门槛。

### 12.4 candidate/deliver/review 证据与范围

在 Node `v24.22.1` 下，CLI 聚焦命令 `pnpm --filter @workmesh/cli exec vitest run src/candidate.test.ts src/deliver.test.ts src/index.test.ts src/workspace-cli.test.ts --maxWorkers=1 --reporter=dot` 为 4 files、33 passed、exit 0；API review 命令 `pnpm --filter @workmesh/api exec vitest run --config vitest.unit.config.mts src/reviews/v1-review.service.spec.ts src/reviews/v1-review-request.spec.ts src/reviews/v1-review-policy.spec.ts src/reviews/v1-review-code-evidence.spec.ts src/reviews/v1-review-batch.spec.ts --maxWorkers=1 --reporter=dot` 为 5 files、76 passed、exit 0。专属隔离 PostgreSQL `127.0.0.1:51924/workmesh_test_p0a_negative` 上，`pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/v1-task.database.spec.ts --reporter=verbose --maxWorkers=1` 为 23/23 passed、exit 0，脱敏日志 `%TEMP%\workmesh-p0a-negative-task-db-2124ac39.log`。显式 `WORKMESH_POC_LIVE=1` 的 `v1-api-agent.database.spec.ts` exit 1，状态为 `RUN_NOT_DELIVERABLE`；不猜测原因。上述结果是 candidate/deliver/review 与任务 DB 的独立证据，不能当作同一项目工作区闭环；本次审查发现的真实 HTTP 负向证据缺口及后续补验分别保留在下文和 §12.8。

2026-11-06 21:46:07–21:46:10，Node `v24.22.1`、HEAD `1fd1635693a77e4b66b0e06818f553719872f494` 下另补两组独立聚焦回归：从 `apps/cli` 执行 `<node24> G:/yesgoo/workmesh/node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=verbose src/candidate.test.ts src/deliver.test.ts src/workspace-cli.test.ts`，3 files、22 passed / 0 failed / 0 skipped、exit 0；从 `apps/api` 执行 `<node24> G:/yesgoo/workmesh/node_modules/vitest/vitest.mjs run --config vitest.unit.config.mts --maxWorkers=1 --reporter=verbose src/auth/v1-authorization.spec.ts src/tasks/v1-artifact.service.spec.ts src/reviews/v1-review.service.spec.ts`，3 files、69 passed / 0 failed / 0 skipped、exit 0。精确 executable/args/cwd、前后 HEAD/status 和 9 个目标源文件 SHA-256 在 `G:/workmesh-p0a-sameproject-evidence/candidate-audit-6e674c/audit.json`，日志为该目录 `cli.log`、`api-unit.log`；源文件 hash 前后相同。这两组与先前 33/76 项有重叠，不能相加为独立用例数。

§25.8 保留既有 candidate/deliver/review 通道的回归证据包括 candidate 结构/跨项目/撤权、deliver claim/version/snapshot/digest/provenance、review ticket/version/idempotency/失败回滚；独立真实任务 DB 的 23 项日志覆盖 claim/snapshot/deliver/review/revoke 竞争和持久化失败回滚。当前 `v1-task.database.spec.ts` 已有额外的 `projects the optional step display name from the task instance revision` 用例，旧 23 项日志没有该名字，不能称当前文件全量已在那次执行。live POC 的 `RUN_NOT_DELIVERABLE` 保留为 1 failed/exit 1，原始持久化日志和 `WORKMESH_POC_OUTPUT` 未定位，具体底层原因未知；冻结契约未要求 live model POC，不因此新增门槛。

§25.7 证据分级：重复消费、文档归档/读取授权撤销、两管理员竞争发布、归档后草稿/消费和撤权签码已有真实 HTTP 或隔离 DB 屏障证据；离线三个拒绝和 DUAL_ACTIVE 已有真实命令证据。成员撤权/降级由测试直接修改隔离库状态构造，不能称已有管理接口复现。未发布定义签码、非成员/归档签码、发布后旧编辑器新 key/旧 key、主动伪造 PROVIDER 字段在本次审查时尚缺对应真实 route/DB 请求证据，原有单测/静态边界不冒称完整负向闭环；后续补验另记 §12.8。

### 12.5 外部平台、真实双机与部署历史

真实第二台设备、macOS/Linux runner、Windows UNC 和共享/开发/测试/生产迁移历史仍为 **BLOCKED/UNRUN**。解除真实双机需要第二台可控设备、不同绝对根目录、同一最终 API/CLI 构建和可复核脱敏身份对照；解除跨平台 gate 需要对应 runner 实际执行 §19.2/§19.2.1/T11 命令并保留 OS、Node、Git、exit code 和日志；解除部署历史 gate 需要各环境负责人提供脱敏 `_prisma_migrations` 名称、checksum、完成/回滚状态及环境标识。CI 配置、单机双 root 和本地隔离库都不能替代这些证据。

### 12.6 Windows 本机路径/Git 补验及当前结论

2026-11-06 21:41:08，真实 Windows 11 Pro x64 10.0.22000、Node `v24.22.1`、Git `2.53.0.windows.1` 执行 `pnpm --filter @workmesh/cli exec vitest run src/git.test.ts src/workspace-discover.test.ts --maxWorkers=1 --reporter=verbose`：2 files、19 passed / 0 failed / 0 skipped，exit 0。日志 `G:/workmesh-p0a-sameproject-evidence/windows-paths-vitest-20261106.log`；实际 Git 子进程覆盖 worktree、submodule、monorepo、sibling、no-Git 及路径边界，覆盖以逐项测试名为准。

21:42:37，`<node24> G:/workmesh-p0a-sameproject-evidence/windows-paths-manual-20261106.cjs` exit 0，使用同套真实 CLI 构建；逐条命令/退出码在 `windows-paths-manual-20261106.json`。中文/空格、真实小写路径别名、专属目录显式移动前后同一 Git commit、junction 通过；目录移动仅证明 discover 观察同一 commit，不代表 P0b 自动定位/恢复。目录 symlink 实际创建返回 EPERM，**BLOCKED**，junction 不能替代 symlink；UNC 无授权共享，**BLOCKED**；macOS/Linux 没有 runner，**UNRUN**。这不是全量 §19.2/§19.2.1/T11 通过。

本轮新增了真实 T8、同一项目 Web→CLI→bind/status、两套独立 root/configHome 的单机模拟、共享导出无本机绝对路径、离线四场景及 Windows 部分路径证据；真实双机、完整跨平台矩阵和外部迁移历史仍缺。§24 的 T11 未完成，§25 的真实机器 B 与外部 gate 未完成，P0a 继续为 **C / 未完成**。

### 12.7 2026-11-07 文档收尾与工作树保护

本轮产品源码未修改；实际文档补充仅为本文件 §12/当前状态与 `docs/design/project-workspace-onboarding.md` 顶部实施状态/§25 结论。两文档其他既有或并行内容不计为本任务修改。最终全工作树 HEAD、staged/unstaged/untracked 清单、staged 与 unstaged diff/stat/check、两文档内容快照及 SHA-256 保存到 `G:/workmesh-p0a-sameproject-evidence/final-worktree-20261107/`，以其中 `summary.json` 的采集时间和数量为准。初始完整基线仍在 `%TEMP%/workmesh-p0a-sameproject-baseline-0b7164ab48184476bfda9f4f2d104f5e/`；21:23 中间状态在 evidence 根目录 `status-entry-20261106.txt`。HEAD 从 `021ac3aafbdffd1b38c8a614a2d27c0f0d8cbfe6` 变为 `1fd1635693a77e4b66b0e06818f553719872f494` 是共享工作树观察，本任务未提交、暂存或恢复其他任务的 index/HEAD。

21:47:07 已用 Ctrl-C 停止本轮 API/Vite/localhost 内存桥，并仅对本轮 PGDATA 执行 `pg_ctl -D <sameproject PGDATA> -m fast -w stop`（exit 0）；51913/46112/46113/46114 无监听，见 `service-stop-20261106.json`。所有隔离库数据、fixture、失败脚本和构建目录原样保留；没有重试任何被审批拒绝的删除。敏感本机文件仅标记位置：第一环境 `config/credentials/`、先前 ACL 失败的 `G:/workmesh-p0a-sameproject-config/credentials/`、第二环境 `G:/workmesh-p0a-sameproject-second-O5yl3f/config-home/credentials/`；不读取或导出其内容。一次性码只在页面/进程内存流转，脱敏证据没有记录其明文。

外部迁移历史尚未收到。请共享/开发/测试/生产各环境负责人提供环境标识，以及 `_prisma_migrations` 的 `migration_name`、`checksum`、`finished_at`、`rolled_back_at` 脱敏导出，供只读比对本地已发布 migration；不要提供凭据。没有这些材料前均保持“未核验”；若出现差异，单独评审补偿方案，不改写 migration、不用 `migrate resolve` 或 `db push` 掩盖。

### 12.8 2026-11-07 真实 main HTTP 负向补验

08:33:51–08:33:54（Asia/Shanghai），Node `v24.22.1`、Windows、HEAD `1fd1635693a77e4b66b0e06818f553719872f494`，执行 `<node24> G:/workmesh-p0a-sameproject-evidence/negative-http-final-20261107-v3.cjs`，driver exit 0，**7 passed / 0 failed / 0 skipped**。复用同一最终 API 构建 `.p0a-sameproject-498c2a/main.js`，SHA-256 `4595f26decb8bab972837ae08c58ffebf01ebf07b34b17d183ddb6b7a80339f1`。启动真实 main（本轮端口 12199），只连接 guard 接受的专属 `127.0.0.1:51913/workmesh_test_p0a_sameproject?schema=workmesh_v1`，先核对 postmaster 的 PGDATA/PID/port；没有重新迁移 schema。使用新随机账户、新项目 `c88e61ec-9c4b-4fbe-bcc8-3cfd87a93ec3`，不修改 §12.2 正向项目，不把本轮负向项目拼成正向闭环。

| 场景 | 真实 HTTP 与持久化结果 |
| --- | --- |
| 未发布定义签码 | 409 `PROJECT_UNCONFIGURED`；零签码/幂等/审计/版本变化。 |
| 非成员签码 | 404，公共 code `RESOURCE_NOT_FOUND`、message `MEMBER_NOT_ACTIVE`；无持久变化。 |
| DECLARED 请求注入 `identityMode=PROVIDER`、adapter、externalId | 400 `REQUEST_REJECTED`，DTO 明确拒绝额外字段；票据未消费，零仓库/版本/审计/幂等写入。 |
| 随后合法声明 | 201；数据库 identityMode=DECLARED，adapter/externalId/lastVerifiedStatus/lastVerifiedAt 均 NULL，未声称 provider 核验。 |
| 保存草稿并发布后，旧 expectedDefinitionVersion + 新 key 保存 | 409 `DEFINITION_VERSION_CONFLICT`；项目/定义/revision/审计/幂等和票据消费数量不变。 |
| 发布后，原 key 同摘要重放草稿保存 | 200，`replayed=true`、原响应 definitionVersion=1；数据库保持发布后的 version=2，无回滚或新写。 |
| 项目归档后签码 | 通过真实 `DELETE /api/v1/projects/:id`（200）归档，之后签码409；公共 code `RESOURCE_CONFLICT`、message `PROJECT_ARCHIVED`，无新增签码或半写。这不是直接构造数据库归档状态。 |

脱敏逐请求 method/route、请求字段名、Origin/CSRF/Idempotency-Key 是否存在、status、错误 envelope 和 request ID 对照，以及只读 DB 前后计数在 `G:/workmesh-p0a-sameproject-evidence/negative-http-final-20261107-v3/result.json`。不记录密码、cookie、CSRF 值、票据、幂等 key 或接入码；这些请求未成功签出接入码。真实认证、DTO、Guard、票据与路由未 mock；这是 HTTP driver 的请求摘要，独立于浏览器截图，并非补造浏览器网络存档。

首轮驱动遗漏 PG 启动端口，导致专属 PGDATA 按默认监听5432；51913监听检查失败后，在任何 Prisma/API连接之前终止，未连接5432，随后仅按该专属PGDATA停机。首轮 `negative-http-final-20261107/` FAIL保留。v2明确指定51913后为5 passed/2 failed，失败来自驱动把两种公共错误code猜成业务message，实际请求已正确404/409拒绝；v2证据保留。v3按实际公共envelope修正断言后7/7通过，未修改产品代码。v3最终API子进程已停止，专属PG `pg_ctl ... -m fast -w stop` exit0，51913/12199均无监听；result.json保留生命周期记录。

当前 §25.7 的上述路由证据缺口已由独立负向补验补足，其他并发/权限/文档/限流仍按原隔离DB/HTTP/单测证据分级；不声称所有负向均由同一个项目、同一个浏览器会话执行。§25.5的真实第二台设备、T11完整平台矩阵、外部部署迁移历史仍缺。§24、§25及P0a综合保持 **C / 未完成**。
