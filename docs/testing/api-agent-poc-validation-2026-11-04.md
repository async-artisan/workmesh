# API 驱动 Agent 最小验证记录

日期：2026-11-04。目标：验证 WorkMesh 能否增加一个由模型 API 驱动的执行层，降低对用户电脑上 Codex 等本地 Agent 的依赖。

这份记录区分四种证据：模型 API 工具循环、真实测试进程、业务服务单测、真实 HTTP + PostgreSQL 集成。它们证明一个受限执行切片可行，不等于通用代码 Agent、生产沙箱或云端部署已经验证。

结论：不调用本地 Codex 等 Agent 程序，由本机模型 API 驱动宿主工具，已经在独立 PostgreSQL 与真实 WorkMesh HTTP API 上完成一次受限闭环：领取任务、读取已校验快照资源、运行模型工具、上传 HOSTED 工件、创建 OPEN 人工评审。Agent 决策被真实 API 拒绝，交付幂等重放没有产生重复记录。纯云端模型调用、通用仓库执行和生产沙箱仍未通过本次验证。

## 已完成的验证

### 对先前“真实项目工具 / 59 项测试”记录的核对

先前版本曾记录：模型通过 `read_project_file` 读取 `packages/shared/package.json`，再通过 `run_shared_tests` 执行共享包测试，9 个文件、59 项测试通过。但当前仓库中没有这两个工具的实现，也没有与该说法对应的独立运行日志；留存的 `2026-11-04-local.json` 明确记录的是临时目录中的 `read_file`、`write_file`、`run_tests`，目标是合成的 `formatTask` 纯函数。因此，先前“模型真实调用项目工具并完成 59 项测试”的结论目前**撤回为未核实**，不能把它当作本次实测证据。

可复查的模型工具闭环证据是下一节所述合成 fixture：模型请求工具后，由宿主执行读取、写入和固定可信测试，再将结果交还模型。它证明 API 返回工具调用与宿主执行工具的机制，不证明模型已在 WorkMesh 仓库上自主运行测试。

### 现有 WorkMesh 业务服务

执行：

```powershell
pnpm.cmd --filter @workmesh/api exec vitest run --config vitest.unit.config.mts src/tasks/v1-task.service.spec.ts src/tasks/v1-snapshot.service.spec.ts src/tasks/v1-artifact.service.spec.ts src/reviews/v1-review.service.spec.ts
```

结果：4 个测试文件、81 项测试通过。覆盖任务领取、上下文快照、HOSTED 工件正文摘要校验、幂等约束以及 Agent 不得代替 HUMAN 审批等规则。

这 81 项测试使用内存仓储或测试替身，直接调用业务服务；它们没有连接真实数据库。下面的独立 HTTP 集成记录补充了真实数据库和 API，但不能把这两组测试合并描述成同一条链路。

### 模型到 WorkMesh HTTP API 的真实集成

运行 `scripts/api-agent-poc/verify-http.mjs` 会创建一个随机名称、随机 loopback 端口的一次性 PostgreSQL 集群，在该数据库应用当前迁移，然后只运行 `v1-api-agent.database.spec.ts`。该专用入口会为测试子进程自动设置 `WORKMESH_POC_LIVE=1`，明确 opt in 真实模型 POC；普通 API integration 不设置这个变量，因此会跳过真实模型套件。测试进程启动真实 Nest `AppModule`，监听另一个临时 loopback 端口。它不连接当前开发用的 5432 数据库或 3000 API。

复现命令：

```powershell
node scripts/api-agent-poc/verify-http.mjs
```

默认需要本机 Ollama 和 `qwen2.5:14b`；可用 `--model <name>` 指定模型，或用 `--pg-bin <directory>` 指定 PostgreSQL 二进制目录。脚本清理自己创建的临时集群；若服务停止失败会保留目录并报告路径，不会停止其他数据库服务。直接运行该 spec 时，必须显式设置 `WORKMESH_POC_LIVE=1`，并同时满足隔离测试数据库 guard；只有这两个条件都成立才会启动真实模型测试。

HUMAN 通过真实注册会话创建项目，并走真实 CLI device authorization 的查看、批准和轮询流程签发最小权限 Agent 凭据。工作流、需求、任务和角色资源为了聚焦执行协议，直接通过 Prisma 写入这个一次性测试数据库；这不是工作流发布 API 的端到端覆盖。随后模型客户端通过 HTTP 执行 ready → claim → context snapshot → resource hydration/hash 校验 → 本地 Ollama 工具循环 → HOSTED IMPL artifact delivery → 读取自动创建的 review。保存的模型工具事件记录了 `read_file` → `run_tests` → `write_file` → `run_tests`，真实测试退出码为 `[1, 0]`。

成功证据保存在 `docs/testing/api-agent-poc/2026-11-04-http.json`。该次结果显示：模型 5 轮、4 次工具执行、约 5.818 秒；快照中的 ROLE_RESOURCE 正文进入模型任务上下文；Artifact 正文长度与 SHA-256 和数据库保存值一致，提交者 stamp 和任务 claim 都指向此次 Agent credential。对同一交付请求重放后 `replayed: true`，工件集数量仍为 1。Agent 的审批请求返回 `403 HUMAN_SESSION_REQUIRED`，review 仍为 `OPEN` 且决定数为 0；凭据撤销后旧 bearer 返回 401。

失败运行也保留在 `2026-11-04-http-attempt-1.json` 和 `2026-11-04-http-attempt-2.json`。前两次整链路尝试中，模型要么没有给出完整运行证据，要么把写文件与测试请求合并为一轮；执行器都拒绝交付。将工具 schema 按阶段限制为当前只允许的一个工具后，当前代码与本地模型通过了整链路。这是一个单次成功样例，不是成功率或稳定性基准。

本次由浏览器会话模拟 HUMAN 查看与授权，但没有作出批准决定。模型仍运行在本机 Ollama；仓库代码也仍是受限 `formatTask` 合成 fixture，并没有检出、修改或测试 WorkMesh 仓库。

## 可复现的代码修复实验

实验实现位于 `scripts/api-agent-poc/runtime.mjs`，校验脚本位于同目录的 `runtime.test.mjs`。每次创建新的临时工作目录，提供一个有缺陷的 `formatTask` 纯函数。目标行为是去掉首尾空白、转成小写、把连续空白换成一个连字符。

工具只有 `read_file`、`write_file` 和 `run_tests`。可读写的文件只有 `src/format-task.mjs`；可信测试放在工具不可改写的目录。源码带有每次随机生成的 canary，任务提示不包含其值，模型必须读文件才能在最终回复中给出正确值。

验收要求：每轮模型工具请求都实际执行并回传；观察到真实断言失败后才允许写入；写入后必须再次运行并通过可信测试；最终回复不能为空，且必须包含读取到的 canary。宿主程序不会自动生成修复代码。

复现命令：

```powershell
node --test scripts/api-agent-poc/runtime.test.mjs
node scripts/api-agent-poc/runtime.mjs --provider ollama --model qwen2.5:14b --output docs/testing/api-agent-poc/2026-11-04-local.json
```

第二条命令需要本机已有可用的 Ollama 服务和对应模型。本次 POC 的 provider 适配器仅允许本机 Ollama 地址，没有实现云端 provider。

首次真实运行记录保留在 `docs/testing/api-agent-poc/2026-11-04-local-attempt-1.json`：模型实际完成读文件、失败测试（退出码 1）、写入修复代码、通过测试（退出码 0），但随后继续发出无效或成批的工具请求，最终达到工具次数上限。运行总计 22.691 秒，宿主准确记录 `ok: false`、`TOOL_CALL_LIMIT`，没有把“测试通过”直接冒充“完整 Agent 运行成功”。

这暴露了执行编排的一项实际要求：完成条件成立后，应收回工具权限，转入只生成最终答复的阶段。第一次失败记录用于保留该限制，不从报告中删掉。

运行器早期单测结果曾为 12 项，11 项通过、1 项跳过；当前 API driver 与运行器回归命令 `node --test scripts/api-agent-poc/runtime.test.mjs scripts/api-agent-poc/workmesh-http.test.mjs` 共 19 项，18 项通过、1 项因当前 Windows 账号不能创建 symlink 而跳过，0 项失败。用例覆盖真实失败/通过进程、路径与工具白名单、资源/运行摘要完整性、HTTP 错误脱敏、以及拒绝未授权的成批工具调用。

### 最终实测结果

增加完成后的答复阶段与按阶段收窄工具列表后，以同一个本机模型重新运行，当前运行器版本的成功证据保存在 `docs/testing/api-agent-poc/2026-11-04-local-retry-2.json`：

| 项目           | 观察到的结果                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| 宿主最终判定   | `ok: true`；脚本进程退出码 0                                                                                  |
| 模型交互       | 5 轮，约 8 秒；这是一次本机样例，不是性能基准                                                                 |
| 工具请求       | 4 次，执行器每轮只向模型提供当前阶段允许的一种工具                                                            |
| 实际执行顺序   | `read_file` → `run_tests` → `write_file` → `run_tests`                                                        |
| 真实测试退出码 | 先 1，后 0；失败输出含 `CASE_FAILED` 断言，成功输出显示测试通过                                               |
| 读文件证明     | 初始提示不含随机 canary；最终回复及修复后的源码均保留了正确值                                                 |
| 最终答复       | 非空；最终一轮不再提供工具，模型未继续请求执行                                                                |
| 可复查内容     | 每轮模型的工具请求、拒绝原因、实际工具参数、stdout/stderr、初始与最终源码 SHA-256、最终源码、可信测试 SHA-256 |

模型实际写入的函数为：

```js
export function formatTask(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, '-');
}
```

代码由模型提供，宿主没有按失败输出硬编码修复。可信测试检查多个不同输入，断言在待测代码的 VM 上下文之外执行；每次只开放当前阶段的工具，再将结果交回模型。本次成功只证明这个受限纯函数任务的闭环，不证明任意代码库都能稳定完成。模型最终自然语言回复出现俄语；本实验没有规定答复语言，语言一致性未纳入通过条件，也需要作为产品体验另行约束。

## 云端模型 API

直连官方模型 API 出现连接超时。经本机已有代理后，能够到达官方端点，但环境中现有凭据返回 HTTP 401、`invalid_api_key`。

因此，本次未获得成功的云端模型响应。该结果只说明本次端点与凭据组合不可用，不能用于判断其他云端配置是否可用。凭据未写入代码、报告或证据文件。

## 实验边界

- 没有修改 WorkMesh 生产接口、数据库结构或业务代码；新增内容是 POC 客户端、集成测试、一次性数据库运行器和验证记录。
- 模型没有绕过人工审批，也没有向共享数据库写入任务或交付物；成功交付和评审记录只存在于本次独立临时数据库中。
- 没有把 Node 子进程、路径白名单或虚拟机上下文称为可承载不可信代码的生产级安全沙箱。
- Node 20 的权限设置没有网络禁用开关；VM 仅用于本次纯函数测试的额外隔离，不是安全承诺。可读写路径限制也不等于跨租户操作系统隔离。
- POC 只支持本次受限纯函数脚手架，没有实现通用依赖安装、任意模块导入或真实仓库构建环境。
- 本次只验证一项任务、一个 Agent 角色、一个快照资源和一次交付的 HTTP + 数据库闭环。工作流发布 API、通用仓库 checkout/build/test、真实浏览器人工操作、平台侧持久 AgentRun 记录、云端执行隔离、任务中断恢复、多角色交接与并发运行仍需单独验证。

## 架构含义

模型 API 可以输出工具名与参数；真正读取文件、修改代码、运行测试或提交交付物的仍是执行程序。要消除对用户本地 Agent 的依赖，需要把这个执行程序及其工作环境放在服务端或其他受控计算环境。

这不要求从零训练模型，也不要求先实现 Codex 的全部功能。需要增加的是工具分发、工作目录、执行限制、模型循环和运行记录，再把执行结果接入 WorkMesh 已有的任务与交付协议。
