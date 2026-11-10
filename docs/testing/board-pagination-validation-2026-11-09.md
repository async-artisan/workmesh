# Board 分页验收记录：2026-11-09

本记录说明 Board 的准确统计、服务端分页与 Web 继续读取的完成范围。**r13 在 2026-11-09 完成同源完整本地门禁，exit 0 / LOCAL_QUALITY_PASSED；2026-11-10 核对终态、完成 small/history 两组 HTTP 基准及同源新包的隔离生命周期与扫描。r12 的失败与独立检查保留为历史。其他本地增长点、最终候选和外部门禁仍待验收，不能据本记录宣告 P2 或发布验收完成。** 同源制品结果见[生命周期记录](box-lifecycle-validation-2026-11-07.md)。

## 源码快照与证据范围

r12 历史候选为 `G:/workmesh-verify-validation-20261109-r12/source`，稳定备份为 `G:/yesgoo/workmesh-validation/20261109-r12/source-snapshot`。源码背景是 `739367a714097a825b96ca7ecf6bce3372855a77` 加获准的未提交改动，冻结清单共 **915 个文件**。`source-r12-frozen.json` 的 SHA256 为：

```text
3d81aa0bb2c32d1c4e65b7eea1fc7c3966fe07c82c8fa513e3eb9e6e6dfc7ffe
```

r12 来自保留的 r9 源码快照，加六个文件格式修复、CLI `receipt list` 已有命令的测试断言同步，以及依据该快照角色资源重新生成的角色 manifest/生成源码。它没有重新吸收后续并发修改中的整个工作区。`source-parent.json`、`r12-format-delta.json` 和 `r12-source-preflight.json` 记录来源与差异；安装采用冻结锁文件，门禁开始前没有 API/Web/shared 构建产物或生成的 Prisma client。完整运行失败后，915 个源码文件的后置指纹核对仍全部一致。

本验收文档在 r12 冻结后新增，**不属于 r12 或 r13 的 915 文件清单**。后续工作区修改、文档修订及额外测量不得追溯称为已由这些快照验证。较早的 109 处查询用途清单及 Board 改造后的静态计数增量保留在[分页与读取范围审查](pagination-review-2026-11-07.md)；其中旧“待执行 r9”描述对应当时阶段，后续同源完整终态见本文 r13 节。

此前失败没有改写为成功：r9 在格式步骤失败，原始日志随后被外部清理，当前无法再次复核，不能称为仍保留的原始证据。r10 的格式失败和 r11 的工作区测试/冻结后置核对问题，其日志、退出码与清单保存在稳定备份的 `prior-runs/`；失败原因汇总于 `prior-runs-and-preflight.json`。

## 已完成的接口与界面行为

以下路由带 `/api/v1/projects/:projectId` 前缀；项目读取权限及 `task:read` 覆盖全部路径，需求汇总与需求选项没有额外增加 `requirement:read`。完整响应形状见 [API 文档](../api.md)。

| 路径                         | 完成行为                                                                                     | 页面边界                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /board`                 | 返回六列各自首批卡片和游标；`summary` 独立返回项目总数、匹配总数、六列准确数量与匹配需求数量 | 默认每列 20、最大每列 100                   |
| `GET /board/columns/:column` | 独立继续读取指定列，返回该列准确数量与下一游标                                               | 默认 20、最大 100                           |
| `GET /board/requirements`    | 在完整匹配集上聚合需求及六种状态计数，按全局权重排序并继续读取；角色有准确数量与预览游标     | 默认 20 组、最大 100 组；每组角色预览 10 个 |
| `GET /board/filters/:kind`   | `roles`、`requirements` 真实选项分页及独立文字搜索；同时用于需求行更多角色                   | 默认 50、最大 100                           |

Web 列卡片、需求汇总、两类全项目选项和需求行角色分别使用对应路径。工具栏、状态数量和需求排序不从已加载卡片推断全量事实。全项目选项不带当前看板的查询/角色/需求过滤；选项搜索拥有独立游标。显式刷新会重读两类选项首批并淘汰旧游标，保留选值与搜索；项目、筛选、视图、刷新代次改变或组件卸载后，旧响应不能覆盖新界面。续页按身份去重，失败保留已加载内容并提供重试。

仓储在 PostgreSQL 中用参数化 CTE、窗口函数和 `limit + 1` 确定页面 ID，再补齐本页任务、每任务一条活动认领及绑定流程修订。首屏最多补齐六列各 100 条任务，单列续页最多 100 条；没有将项目全部任务、全部认领或全部流程修订载入 Node 后切片。需求状态统计与排序在数据库完成，角色预览只针对本页需求。

## 保留语义及已知边界

- 每个请求在 `RepeatableRead`、`SET TRANSACTION READ ONLY` 事务内读取数量和页面；请求之间没有冻结历史快照。任务代次、状态、需求权重或权限并发变化可能使记录跨页移动。去重不能保证实时变更期间绝无遗漏，刷新会重新开始。续页列数量也可能比初次读取的工具栏汇总更新。
- 列游标采用 `generation DESC, id ASC`；需求采用 `blocked × 10 + active DESC, code ASC`；选项按值升序。游标绑定项目、规范化查询、视图/列，选项游标另外绑定类型和选项搜索，错误范围不能沿用。
- 全部任务代次与退役流程实例保持可见。列归属沿用任务指针优先级：有当前交付集为 DELIVERED，没有当前认领为 BACKLOG，随后为 BLOCKED/PAUSED/CANCELLED，其余为 ACTIVE。卡片步骤名称来自各自绑定的流程修订。
- 查询保留需求编号、标题、步骤 key、角色标题和活动认领人邮箱拼接后的大小写不敏感文字匹配；百分号、下划线和反斜杠为普通字符。需求编号及角色值采用 PostgreSQL `COLLATE "C"`，中文次序可能与旧前端 `localeCompare('zh-CN')` 不同。异常重复活动认领现在按 `claimedAt DESC, id DESC LIMIT 1` 确定一条，旧路径对此没有确定顺序。
- 精确数量、分组权重、选项去重和角色计数仍须扫描匹配关系并可能排序。传输和渲染行数有界，不等于数据库 CPU、扫描量或耗时与项目规模无关。流程修订定义仍是完整 JSON，单个定义字节数也未因行数分页获得上限。本轮没有增加 schema 迁移或未经执行计划测量支持的索引。

## 当前保留的数据库集成证据

r12 在经执行文件、进程命令行、loopback 监听及 SQL 身份核对的独立 PostgreSQL 17.11 上，创建新库 `workmesh_test_verify_r12_20261109`，目标为 `127.0.0.1:58412`、schema `workmesh_v1`。测试显式设置本地环境、数据库用户白名单与专用测试 URL；正式 20 个迁移成功应用后执行数据库集成。该环境与先前独立 r1 的端口及数据库不同，不能混用身份记录。

稳定备份的 `verify-full-r12.log` 已记录 `pnpm --filter @workmesh/api test:integration` 对应的实际 Vitest 集成执行：**22 个文件通过、1 个文件跳过；194 项通过、1 项跳过**，随后 `api-integration` 步骤为 `PASSED`，schema drift 为 `No difference detected`。该冻结测试集包含 [v1-board-pagination.database.spec.ts](../../apps/api/test/v1-board-pagination.database.spec.ts) 的 **7 项 Board 数据库测试**。日志使用汇总输出，没有逐项打印测试名称；测试范围与 fixture 可由同源冻结测试文件复核。

Board fixture 是 **315 个任务、50 个需求、12 个角色**，覆盖六列、多个任务代次、退役实例、特殊文字、超过 10 个角色预览的单需求，以及改变全局权重的额外任务。7 项分别检查：

1. 默认首屏每列 20 条，同时项目、匹配、各列及需求总数准确，保留旧实例和代次。
2. 六列分别以 `limit=7` 完整遍历，与 fixture 的 generation/id 顺序逐个比对，无遗漏、重复。
3. 全项目文字搜索、角色和需求精确过滤、大小写及百分号/下划线/反斜杠/引号字面语义。
4. 需求全局权重排序、完整状态计数与角色总数，10 个角色预览继续读取到完整 12 个。
5. 两类全项目选项的完整分页、确定顺序、准确数量和独立文字搜索。
6. 跨列、视图、查询、角色、需求及选项搜索的游标拒绝，以及畸形游标拒绝。
7. 仅有 `task:read` 的 Agent 可以读取；缺少 scope、项目外用户及跨项目目标被拒绝。

这些测试调用真实服务与 Prisma 仓储访问 PostgreSQL，证明该固定数据集的读取正确性；它们不替代真实 HTTP、浏览器或容量测量。测试自身按精确 fixture ID 和所属项目清理数据；**目前没有另附 r12 套件结束后全部业务表的独立 `psql` 计数，不能把测试清理视作已完成该项复核。**

| 当前保留证据（相对稳定备份根目录）                                                  | 可复核内容                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `source-r12-frozen.json`、`source-snapshot/`                                        | 915 文件清单及同源代码；清单 SHA256 见前文                                                                               |
| `r12-source-preflight.json`                                                         | 冻结来源、锁文件安装、构建前产物不存在及范围                                                                             |
| `run-verification-r12.ps1`、`postgres-owned-identity.json`、`postgres-identity.txt` | 新库创建前的本地 PostgreSQL 进程、监听和 SQL 身份核对                                                                    |
| `verify-full-r12.log`                                                               | 20 个迁移、194/1skip 数据库集成及完整失败终态；SHA256 `880bdd556fe3108a01ae233d5b527fd8ed6baf1d950ab8e1bd810c5663c3608c` |
| `source-snapshot/apps/api/test/v1-board-pagination.database.spec.ts`                | 冻结的 315 任务 fixture 与 7 项断言；SHA256 `bbe7d58203d63cbc5bac20a096d104192fc790d5050c3561d60a01f8ab7fcded`           |
| `prior-runs/`、`prior-runs-and-preflight.json`                                      | r10/r11 的原始失败证据及 r9 原始日志缺失说明                                                                             |

此前还在专属库 `workmesh_test_board_pagination_r1_20261109` 上单独运行过相同 315 任务 fixture，实际观察并核对过 **7/7 通过、退出码 0，以及清理后 53 张业务表均为 0**。当时记录者读取了原始运行日志、逐表计数并核对 SHA256。这是历史执行事实；原目录 `G:/workmesh-board-pagination-validation-20261109-r1` 后被外部清理，**原始日志和计数当前不可再次复核，也没有名为 `board-database-r1` 的可用稳定备份**。因此本记录主证据采用上表保留的 r12 同源集成，不把历史结果冒称为现存独立原始证据。

## r12 最终结果及独立检查

r12 的 API 单元 **812**、Web **556**、CLI **288/2skip**、脚本 **240/1skip** 以及真实数据库 **194/1skip** 通过。完整入口最终 **exit 1**，在真实浏览器步骤以 **3 passed / 1 failed** 停止，未执行入口内的 UI review 和 API coverage。失败为 `baseline-change.spec.ts` 仍精确查找旧按钮“确认已处理”，实际界面显示“确认已知悉”，确认请求因此没有发出；不能将它记为后端确认失败或完整成功。915 个冻结源码文件的运行后 SHA256 核对全部一致。

随后在相同冻结源码上分别执行独立检查：API coverage **exit 0、1006 passed / 1 skipped**，lines **83.39%（5995/7189）**、branches **70.54%（4548/6447）**，既有阈值通过；UI review **exit 1、53 passed / 2 failed**。这两项不改变完整入口的失败终态，也不能拼接成 `LOCAL_QUALITY_PASSED`。

UI 的两项失败均已定位：工作台测试等待旧按钮“打开可开工任务”，实际为“打开前置任务已完成”；新 Board 测试把首屏 `/board` 的绝对请求次数固定为 1，而开发服务的 StrictMode 挂载发出 2 次，均发生在点击续页之前，点击后仅发出一次指定列的续页请求。修复分别同步精确按钮名称，以及比较续页前后首屏请求次数保持不变。卡片数、准确总数、独立需求聚合、URL、任务定位和溢出断言保留；Board 首次失败之后的需求聚合及溢出检查当时尚未执行，必须复验。

上述独立日志、覆盖率、失败截图、trace 和 Web dist 已复制到稳定备份根目录中的 `r12-independent-api-coverage/`、`r12-browser-results/`、`r12-independent-ui-review-results/`、`r12-web-dist/`。`r12-final-evidence-summary.json` 记录终态与文件哈希。覆盖率日志 SHA256 为 `7da4b117805918262a2ed89ea7af43e5984faaeffa3616ac1afd3bd24f0886b4`，UI 日志为 `da29c97a59f700601049c3f0d5a2562e740680b51e73be596b5087aa386f0e1d`。修复后的 r13 另建来源清单和新空库，不改写 r12 原始证据。

已构建的 Web 测量保存在稳定备份 `r12-bundle-measurement.json`，同属上述清单：53 个产物，真实 HTML JS 入口 **239,134 raw / 78,646 gzip 字节**，已登录首页静态 JS 依赖并集 **284,314 raw / 94,516 gzip 字节**。gzip 是逐文件 level 6 本地估计，不是实测网络传输；HTML/CSS 单列，不混入 JS 数值。React 证据显示生产实现，没有开发实现；**首页 JS raw 小于 200,000 字节的目标仍未达到**。这些构建测量不构成 Board 分页的容量证明或完整依赖 SBOM。

## r13 同源完整复验

r13 逐字节复制并核对 r12 的 915 个冻结文件，仅改变三个测试文件：基线变更测试同步确认按钮并展开技术详情核对修订 ID；工作台测试同步精确行动按钮名称；Board 测试改为核对续页前后首屏请求数不变，保留唯一指定列续页、准确统计、独立需求聚合及溢出断言。没有从后续并发修改中的 live 工作区复制源码，没有关闭 StrictMode、增加重试、降低阈值或削弱 ACK/URL/任务定位断言。冻结锁文件安装成功，冻结时 API/Web/shared dist 及正式 Prisma client 均不存在。

在已核验的同一 PostgreSQL 17.11 实例 `127.0.0.1:58412` 上，使用新空库 `workmesh_test_verify_r13_20261109` 运行完整 `pnpm verify -- --apply-migrations`，实际 **exit 0 / LOCAL_QUALITY_PASSED**。原始完整日志创建于 **2026-11-09 22:20:35**、最后写入于 **22:36:39（Asia/Shanghai）**；2026-11-10 再次核对终态与全部源码指纹，并生成汇总和稳定备份。不是在整理日期重新执行了一次门禁。

| 检查                             | r13 实际结果                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| 格式、ESLint、无缓存 lint / 类型 | 全部通过，lint 与 type-check 各 10/10 任务、0 cached                                             |
| 工作区单元测试                   | API 812、Web 556、CLI 288 passed / 2 skipped、shared 73、role-packages 24、Box 23                |
| 脚本防护与契约                   | 240 passed / 1 skipped；18 项运行时契约通过                                                      |
| 正式迁移及数据库                 | 20 项迁移；真实 PostgreSQL 194 passed / 1 skipped，包含上述 7 项 Board 测试；schema drift 无差异 |
| 生产构建与 bundle                | 6/6 任务、0 cached；shared/CLI/Web 绑定通过，仍为 `PARTIAL_MODULE_EVIDENCE`                      |
| 真实 Chromium                    | 4/4，通过原基线变更失败场景                                                                      |
| mock HTTP UI review              | 55/55，包括 390px Board 续页与需求聚合、工作台跳转及刷新定位                                     |
| API coverage                     | 1006 passed / 1 skipped；lines 83.39%（5995/7189）、branches 70.54%（4548/6447），既有阈值通过   |

r13 源码位于 `G:/workmesh-verify-validation-20261109-r13/source`，稳定源码备份为 `G:/yesgoo/workmesh-validation/20261109-r13/source-snapshot`，终态证据为同根 `completed/`。915 文件清单 SHA256 为 `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b`；完整日志 SHA256 为 `d17d33f102fde6be4862df4aa723928ea25cebc632fc4dc165d06d31c4840fdc`。`r13-validation-summary.json` 记录退出码、21 个完成步骤、覆盖率及源码后置核对零差异；`r13-source-delta.json` 记录三个测试修复。Web dist、coverage、browser、UI 结果也在 `completed/` 分别保存。

同源生产测量为首页 **6 个 JS 文件、284,314 raw / 94,516 gzip 字节**，入口 **239,134 raw / 78,646 gzip 字节**，React 生产实现 8 个、开发实现 0 个；原始首屏 <200,000 字节目标仍未达到。`r13-bundle-measurement.json` SHA256 为 `c10e83d41ec5111f934db207b03d40d1c38cc4f894f2b3faa5caf9fa819c9f20`。gzip 仍是本机逐文件 level 6 估算，不能替代 raw 目标、实际网络测量或生产容量。r13 是 dirty 源码快照的本地证据，不能覆盖后续 live 工作区改动、最终 clean SHA 的远端 CI 或新安装包。

2026-11-10 同源 small/history 两组真实 HTTP 基准实际 exit 0 / PASS，各 160 个测量请求零错误、16 个权限探针通过。Board 以 `limit=7` 分别发出 4/25 个正确性请求，完整遍历 5/50 个任务和需求，两库运行后由独立 `psql` 核对 53 张业务表全零，915 文件后置指纹无变化。稳定结果在 `G:/yesgoo/workmesh-validation/20261109-r13-benchmark-small` 和 `G:/yesgoo/workmesh-validation/20261109-r13-benchmark-history`，详细数据与范围见[HTTP 基准记录](api-benchmark.md)。history 数据集的 100 文档 × 100 修订仍使文档列表响应放大，不能把 PASS 解释为无界历史或生产容量已经解决。原 PostgreSQL 进程在 11 月 9 日异常退出，次日重启并重新核验后运行基准，不构成服务连续稳定证据。

| 待补项目                         | 当前状态与后续证据要求                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 完整本地门禁                     | r13 同源完整 exit 0，源码后置核对通过；r12 exit 1 保持原终态。后续 live 源码与最终 clean SHA 仍须各自验证 |
| 真实浏览器与 UI 合同             | r13 Chromium 4/4、UI 55/55；390px Board 用 mock HTTP，不能称为真实数据库端到端 Board 浏览器测试           |
| API 覆盖率                       | r13 完整入口内通过，1006/1skip，lines 83.39%、branches 70.54%；r12 入口内未执行的步骤仍不补写             |
| small/history 两组真实 HTTP 基准 | 两组实际 exit 0 / PASS，权限与分页正确性、精确清理及独立 53 表计数通过；固定单机数据集不能证明生产容量    |
| 额外独立 Board 数据库与逐表复核  | 如再执行，需新专属库、实际原始日志与清理后独立 `psql` 计数；此前被清理的 r1 目录不作现存资产引用          |

Board 已补准确统计、全局筛选与可继续读取，但没有因此解决文档修订历史、需求完整交付/评审/决定/变更历史、flow metrics、ready 单请求扫描预算、Workbench 全项目/全待办完整性。真实 GitHub PR/Webhook 交付链、同 SHA 远程 CI、发布制品、新机器生命周期和生产容量仍需各自验收，不能由本记录代替。
