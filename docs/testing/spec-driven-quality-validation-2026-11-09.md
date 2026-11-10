# Spec Kit 方法采用验证记录

日期：2026-11-09。关联[采用设计与入口](../design/spec-driven-quality.md)。

本记录覆盖本次角色方法、模板契约、本地质量检查及相关调用链。结果来自当前工作区，不能代替最终提交的远端 CI 或正式发布验收；工作区还有其他变更，以下包级测试数量不是本次新增测试数量。

## 环境

- Windows / PowerShell，工作区 `G:\yesgoo\workmesh`。
- Node.js `v24.22.1`，pnpm `10.28.2`；从 Codex 已有 runtime 的 Node 路径运行，满足仓库 `>=20.19.0` 要求。
- 未安装 Specify CLI，未新增运行时依赖，未访问证据 URL，未向 WorkMesh 平台写入数据。

```powershell
$env:PATH = 'C:\Users\Windows11\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
```

## 自动化检查

| 范围                   | 命令                                                                                                                                                                                           | 结果                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| shared 全量            | `pnpm --filter @workmesh/shared test`                                                                                                                                                          | 11 个文件，90 项通过                            |
| 角色包全量             | `pnpm --filter @workmesh/role-packages test`                                                                                                                                                   | 2 个文件，29 项通过                             |
| CLI 全量               | `pnpm --filter @workmesh/cli test`                                                                                                                                                             | 27 个文件，333 项通过、2 项跳过；跳过项不计通过 |
| API 发布、角色包与快照 | `pnpm --filter @workmesh/api exec vitest run --config vitest.unit.config.mts src/knowledge/v1-publication.service.spec.ts src/workflows/v1-role-package src/tasks/v1-snapshot.service.spec.ts` | 5 个文件，102 项通过                            |
| HTTP 契约              | `pnpm --filter @workmesh/api exec vitest run --config vitest.integration.config.mts test/v1-http-contract.spec.ts`                                                                             | 1 个文件，19 项通过；使用测试替身，无真实数据库 |
| 构建后的运行时契约     | `node scripts/test-contracts.mjs`                                                                                                                                                              | 18 项通过                                       |
| 类型检查               | `pnpm --filter @workmesh/shared type-check`、`pnpm --filter @workmesh/role-packages type-check`、`pnpm --filter @workmesh/cli type-check`、`pnpm --filter @workmesh/api exec tsc --noEmit`     | 均通过                                          |
| 构建                   | `pnpm --filter @workmesh/shared build`、`pnpm --filter @workmesh/role-packages build`、`pnpm --filter @workmesh/cli build`                                                                     | JS 与声明构建通过；重新生成六个角色包           |

本次新增与扩展的检查覆盖：

- PLAN 的 PLANNED 与 DELIVERY 的执行证据分离；空包、错误结构、重复标识、未知引用、缺失任务/用例以及验证方式不匹配均不能报告一致。
- 任务依赖环、无依赖顺序的并行文件/目录冲突和 2000 项任务长链；长链不依赖递归调用栈。
- 证据绑定同一 PRD、快照及完整 commit；过期证据不能补齐覆盖，FAILED / BLOCKED / NOT_RUN 不被另一个 PASSED 隐藏。
- 即使证据均报通过，结果仍为 LOCAL_REPORTED / REPORTED_PASS，保留 EVIDENCE_REQUIRES_REVIEW 提示。
- 本地文件不需要登录、工作区配置或网络；拒绝重复 JSON 键、超过 4 MiB 的输入及目录，失败报告保留在统一错误信封中。
- 已发货 acceptance JSON 通过真实候选构建器；YAML/JSON 模板、正式 key/字段、QA 示例覆盖和验证方式在角色包构建时交叉校验。
- 生成资源与磁盘源文件字节及技能元数据一致，角色 manifest 可被现有工作流编译与包契约消费。

对本次涉及的 TS/MJS 文件执行 ESLint；对本次文档、代码、模板和角色源资源执行 Prettier 检查，并执行 `git diff --check`。结果均通过。没有把整个工作区的其他变更算成本次实现。

## 构建后 CLI 冒烟

直接运行构建产物，未通过源码测试入口代替：

```bash
node apps/cli/dist/index.js quality --file project-templates/software/quality-bundle.example.json --json
```

退出 0，结果为 CONSISTENT，逐条覆盖状态为 PLANNED，authority 为 LOCAL_REPORTED。示例中的修订和快照是明确的占位值；此结果只检查示例结构和映射，不证明服务端存在这些资源。

另将同一示例复制到系统临时文件，改为 DELIVERY 并补完整格式的 commit SHA，保持 evidence 为空。执行构建产物后断言：退出 2，报告 INCOMPLETE，覆盖 MISSING，问题码 DELIVERY_EVIDENCE_INCOMPLETE。断言通过，临时文件随后删除。该负例用于验证缺证据会失败，未制造或宣称真实交付证据。

## 验证边界

- 本次未运行 `pnpm verify`、真实 PostgreSQL 集成、浏览器验收、GitHub live 或远端 CI，不能据此声称完整发布门禁通过。
- 本次未进行角色包的真实平台登记、既有项目升级或宿主安装；生成包与安装相关 CLI 测试通过，不等于已有项目已自动使用 1.2.0。
- 后续增补价值优先级与 MVP 切片方法后，product/backend 源角色包版本升为 1.2.1；该改动只影响角色模板与指导，不改质量包结构或服务端协议。增补和评审页解析一致性检查单独记录在 [2026-11-10 增补验证](spec-driven-quality-followup-validation-2026-11-10.md)。
- 本记录对应的交付为角色方法、模板、项目协作约定和本地一致性检查。当时未交付评审页专用映射视图；后续同日的实现与验证见[使用者路径优化记录](user-journey-validation-2026-11-09.md)，不追溯计入上表测试结果。服务端 WP12 澄清资源和语义报告自动门禁仍未实现。
- 质量包不读实际实现、不执行测试、不下载或核验引用，也不查询平台当前版本；正式状态、权限、基线和 HUMAN 批准继续由原链路决定。
