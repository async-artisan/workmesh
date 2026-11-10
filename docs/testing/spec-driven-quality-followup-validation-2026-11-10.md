# 规格方法增补验证

记录日期：2026-11-10（Asia/Shanghai）。关联[采用设计](../design/spec-driven-quality.md)。结果来自当前工作树，包级统计包含原有与其他工作区改动的测试，不等于本次新增数量。

## 增补内容

- 产品 PRD 模板、撰写方法和检查清单要求多场景按 P1/P2/P3 排序，确定最小可用且可独立验证的端到端 MVP 切片，记录延期理由与重启条件。
- 后端实现计划和方法包含相同交付顺序及验证检查点；基础工作可以先做，但不得误报成已交付用户价值。简单需求可省略分期，优先级和延期建议仍需既有业务范围确认。
- product/backend 资源版本从 1.2.0 升至 1.2.1；重新生成 manifest 与嵌入资源，其余四个角色仍为 1.2.0。
- 评审页解析完整 HOSTED 质量包时复用 `parseJsonStrict`，与 CLI 一致。修复普通 JSON 解析采用重复字段最后值、使先写 FAILED 被后写 PASSED 覆盖的问题；覆盖普通重复键和转义后相同键两种情况。

## 复现与回归

新增回归先在原实现上运行：两个重复键场景均失败，原实现错误地接受质量包；其余 24 项通过。改用 shared 严格解析后，两个场景拒绝输入，正常质量包仍可解析。组件继续显示读取问题，不能使用预览推断覆盖；保留原错误提示的可识别表述。

Node.js v24.22.1、pnpm 10.28.2；使用已有兼容 runtime，无新增依赖。

| 范围                           | 命令                                                                                                                                                                             | 实际结果                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 角色包生成与构建               | `pnpm --filter @workmesh/role-packages build`                                                                                                                                    | 六个包生成，JS/声明构建通过               |
| 角色包回归                     | `pnpm --filter @workmesh/role-packages test`                                                                                                                                     | 2 个文件，29 项通过；源资源与生成字节一致 |
| 角色包类型                     | `pnpm --filter @workmesh/role-packages type-check`                                                                                                                               | 通过                                      |
| API 内置包登记及包服务         | `pnpm --filter @workmesh/api exec vitest run --config vitest.unit.config.mts src/workflows/v1-role-package-builtin.seeder.spec.ts src/workflows/v1-role-package.service.spec.ts` | 2 个文件，20 项通过                       |
| Web 解析、证据映射组件、评审页 | `pnpm --filter @workmesh/web exec vitest run src/lib/acceptanceEvidence.test.ts src/components/AcceptanceEvidenceMatrix.test.tsx src/pages/ReviewDecision.test.tsx`              | 3 个文件，50 项通过                       |
| Web 类型和生产构建             | `pnpm --filter @workmesh/web type-check`；`pnpm --filter @workmesh/web build`                                                                                                    | 均通过                                    |
| 格式与静态检查                 | 本次文件 Prettier、两个 Web TS 文件 ESLint、`git diff --check`                                                                                                                   | 均通过                                    |

## 范围与剩余项

本轮未运行完整 `pnpm verify`、真实数据库、浏览器或远端 CI；组件检查使用测试环境，不作为真实浏览器验收。未向平台登记/安装新角色版本，未部署，未提交 Git。

质量包未新增字段或改变 1.0 契约。具体用例 ID/用例修订与执行证据的机器关联、WP12 澄清与任务精确恢复仍待实现，已保留在开发计划。所有证据状态继续表示提交者报告，人工批准仍沿既有链路。
