# 工作台交互模块按需加载验收：2026-11-10

当前工作台关闭着变更抽屉和批量批准弹窗时，仍静态加载其实现。后续 `ChangeDrawer` 引用 shared 标签后，隔离生产构建的首页闭包实际达到 **468,746 B raw / 149,163 B gzip**，包含 shared 预打包输出。r13 的 284,314 B 是更早快照，不能用于描述这次 live 回退。

本切片把两项交互改为打开时加载。变更目标非空或批量窗口打开时才调用 `import()`；包装组件复用飞行请求和成功结果，失败清除自己的 promise 缓存。局部 Modal 提供加载、失败、重试和关闭；浏览器自身可能缓存失败，错误态另提供先保存其他输入再刷新的恢复入口。选择这一方式是为了允许局部重试，同时保留工作台和原业务组件；仅重新分 vendor chunk 无法减少首页实际依赖闭包。

修改只有 `Workbench.tsx`、`Workbench.test.tsx`、新增 `WorkbenchDialogs.tsx` 与 `WorkbenchDialogs.test.tsx` 四个文件。原变更确认与批量批准实现继续负责票据、权限、版本、错误和提交锁；共享标签仍从 shared 读取。以下是本次工程验收，不建立平台需求或 HUMAN 批准的第二来源。

| key                       | text                                                                                   | verification | 实际结果                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| home-dialog-on-demand     | 首页可操作但未打开弹窗时不加载两个交互实现；点击后才请求对应模块                       | TEST         | 静态闭包及生产 Chromium 的真实脚本请求时机均通过                                                      |
| home-dialog-loading-close | 加载中能关闭、恢复焦点；晚到模块不重新打开；成功切换后保持单层 Modal、焦点与原 busy 锁 | TEST         | 新单元行为回归与生产 Chromium 受控慢请求通过；批量窗口沿用原先首个可编辑控件“说明”作为初始焦点        |
| home-dialog-error         | 加载失败保留工作台，提供局部重试、刷新和关闭；关闭批量窗口后不保留密码                 | TEST         | 单元失败后重试通过；Chromium 受控请求失败、局部恢复入口及密码清空通过，不承诺原生失败缓存一定重新下载 |
| home-dialog-budget        | 用同源实际生产首页闭包核对原 `<200000 B raw` 目标，不用 gzip 或入口单文件代替          | INSPECTION   | 首页降至 284,700 B raw，减少 184,046 B / 39.26%；**原目标仍未达到**                                   |

## 冻结来源与对照方法

基线为 `739367a714097a825b96ca7ecf6bce3372855a77` 加未提交快照。执行使用 Node 20.19.0、pnpm 10.28.2、frozen lockfile；Vite 实际构建版本为 6.4.5。未使用 live 的既有 dist 或生成客户端。

- **before**：复制当时 1,025 个 source 文件，复制完成时复查 live 字节一致；frozen install、shared 与 Web 生产构建均 exit 0。
- **after-r2**：严格复制上述不可变 before，仅覆盖本切片四文件，共 1,027 文件。逐文件对照确认没有其他源码差异；没有混入同时进行的 API、CLI 或 shared 后续编辑。安装、测试和构建结束后，两份清单的全部文件长度与 SHA256 仍匹配。
- 更早的 `after/` 是直接复制后续 live，混入其他任务修改，且一个旧单测把同标题的加载态当成已加载批准表单，结果 657 passed / 1 failed。失败保留；只修正该断言等待真实密码字段，完整批准说明和所属弹窗断言仍保留。该轮不作为体积对照。

计量沿用 r13 的方法：从实际 `index.html` 的 module script/modulepreload 出发，以该快照 Rollup `parseAst` 递归读取静态 import/export；再纳入 Workbench 路由及 Vite 对应 preload，按文件去重加总原始 JS 字节。HTML/CSS 单列，gzip 为逐文件 level 6 本地估算。

| 范围                     |     before raw / gzip B |  after-r2 raw / gzip B |
| ------------------------ | ----------------------: | ---------------------: |
| HTML 入口 JS 静态闭包    |          242270 / 79675 |         242281 / 79678 |
| 已登录首页可操作 JS 闭包 | 468746 / 149163，7 文件 | 284700 / 94926，6 文件 |

首页闭包已排除 `ChangeDrawer`、`BatchReviewApprove` 和 shared 预打包输出，轻量包装仍在首页。不能把 shared 预打包候选内部全部组件提升为确定最终归因；bundle 证据继续为 `PARTIAL_MODULE_EVIDENCE`。首页减少不是整个站点总代码消失，打开相应窗口时仍需加载其依赖。

## 实际验证

after-r2 的 Web **65 文件、658/658 单元测试**通过，包含新增两项按需加载行为回归，以及既有工作台版本冲突、确认、批量预检与票据相关用例。Web type-check、定向 ESLint、shared 与 Web 生产构建均 exit 0。四个切片文件的定向 Prettier 检查通过。

另在全新浏览器上下文运行生产 dist，使用独立 loopback 58435 静态服务和完全拦截的 fixture API，不连接数据库或已有 API。Chromium **3/3**、零跳过、零重试，于 `2026-11-10T09:34:29.685Z` 开始，3.54 秒完成：

1. 首页未请求交互模块；延迟变更 chunk，加载中 Escape 关闭并归还焦点，释放下载后不会重开，再次打开能展示真实确认内容。
2. 批量批准仅在选择后打开才请求 chunk；加载中关闭不幽灵重开，实际表单保留首个可编辑控件焦点，关闭重开后密码为空。
3. 受控中断变更 chunk，工作台仍在，局部显示重试、刷新与关闭，Escape 归还焦点。

三个浏览器用例没有发出 API 写请求，没有实际签票或批准。浏览器首轮为 2 passed / 1 failed：检查错误地要求密码框焦点，截图和 DOM 明确显示真实 Modal 正确聚焦更早的说明 textarea。只修正隔离 harness 的焦点预期，未改产品或覆盖首轮失败；第二轮仍断言准确初始控件。两轮日志、失败截图与 trace 均保留。服务结束后所选端口无监听。

## 证据与剩余边界

本地证据根目录为 `G:/yesgoo/workmesh-validation/20261110-home-dialog-r1/`。`before/`、`after/`、`after-r2/`、`browser-r1/` 和 `browser-r2/` 各自保留原结果；浏览器 harness 位于 after-r2 的独立 `.tmp` 目录，其摘要另记于汇总，不属于 1,027 文件产品清单。

| 证据                               | SHA256                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| `before/source-manifest.json`      | `be203e0b895d6d2b0b268c05cc902e725eecf3e9ee76ad77d68e06046e0e6e9c` |
| `after-r2/source-manifest.json`    | `ed8e090b51cb338aed26601da5deb09c01aae1c60a732d120787ff37e71605e6` |
| `after-r2/validation-summary.json` | `576574f2fc7669da4352b77649ed09de6cf0258cc9b1738a2b5fe03391e3befb` |
| `before/bundle-measurement.json`   | `d0c46622d3c3e841bbb9fbb5308691fea05777a28ba9277e159b8430afebb88a` |
| `after-r2/bundle-measurement.json` | `ecce2bd2dbec1a9637bdf5636dfbfad125eb09c8c0b85643e62500cf693ccceb` |
| `browser-r2/report.json`           | `3b2755892f7ffacccbc139dca1a981a54b64bcd3240614bf6bc4a4a6c59bd199` |
| `summary.json`                     | `2424719d7aa12e3b31f75e3e91d4d47aaf89dcf4451f8411c2605084c4922c69` |

`summary.json` 记录原始日志摘要、两个 source 后置检查、精确四文件差异，以及 live 四文件与 after-r2 相同的复查。本文是在冻结之后补充，不在该清单中。

本轮没有重跑 API、数据库、契约或完整 `pnpm verify`，也没有为这四文件重新生成 Box/CLI。r13 的完整门禁与 `09d0d2ba…` Box 仍只对应它们原有来源；其结果不能覆盖本切片，当前并发 live 的其他修改也没有自动纳入本切片。原首页 `<200000 B raw` 预算、文档历史与其他分页/聚合增长点、最终 clean SHA 远端 CI 和各外部发布门禁继续开放。
