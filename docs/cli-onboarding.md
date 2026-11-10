# 业务项目接入 CLI

本指南面向在自己电脑上开发业务项目的人。先登录团队已经部署的 WorkMesh，再把本机业务目录与项目工作区关联。安装和维护 WorkMesh 平台另见 [部署说明](deployment.md) 与 [本地运行](local-dev.md)。

## 从项目工作区页开始

1. 打开团队提供的 WorkMesh，选择项目，进入「工作区」页面（`/workspace`）。项目负责人先声明代码仓库并发布工作区定义；没有已发布定义时，页面不能签发接入码。
2. 从该平台的 `/download` 取得适用的 CLI 制品，解压后将启动器所在目录加入 PATH。平台支持和验收边界见 [支持矩阵](support-matrix.md)。已有 CLI 时先运行 `workmesh --version`，确认使用的是预期版本。
3. 生成接入码后，在页面选择业务角色、Agent 宿主和 Shell，填写自己的业务工作区根目录及管理员提供的 WorkMesh API 地址，再复制单行预览命令。API 字段需要明确填写，页面不会从网页地址猜测。`--api` 保留反向代理前缀并以 `/api/v1` 结束；它是 WorkMesh 平台的地址，也不一定与历史本地示例使用同一个端口。
4. 执行默认预览命令，核对目标目录、角色、平台和计划写入的位置。确认后在原命令末尾加 `--apply`，此时才消费接入码，随后在 CLI 指定的浏览器页面批准设备授权。批准的项目和角色应与接入目标一致。

以下是命令结构，双引号内的占位符必须换成真实值。优先复制页面已经填好的命令：

```text
workmesh workspace init --join "<一次性接入码>" --root "<业务项目绝对路径>" --role frontend --host codex --api "<平台API基址>"
```

预览不消费接入码、不写工作区配置，也不表示服务端已接受接入码。确认后执行：

```text
workmesh workspace init --join "<同一个一次性接入码>" --root "<同一个业务项目绝对路径>" --role frontend --host codex --api "<同一个平台API基址>" --apply
```

`--host` 接受 `codex` 或 `claude-code`。非交互执行需要 `--apply --yes`；`--yes` 不能替代 `--apply`，浏览器设备批准仍需由人完成。一次性码已消费后不能重复使用；中断处理见下文。

## Windows 的 Shell 和路径

命令默认使用一行，避免续行符被另一个 Shell 解释。下表中两种写法指向同一个示例业务目录；替换成自己的真实路径。空格路径始终保留双引号。

| Shell      | 切换目录的单行示例                        | 多行命令的续行符 |
| ---------- | ----------------------------------------- | ---------------- |
| PowerShell | `Set-Location "D:/work/business-project"` | 反引号（U+0060） |
| Git Bash   | `cd "/d/work/business-project"`           | 反斜杠 `\`       |

在 Git Bash 中，`D:\work\business-project` 对应 `/d/work/business-project`；PowerShell 的反引号不能作为 Bash 续行符。WSL 使用 Linux 路径和 Linux 运行环境，挂载盘路径通常是 `/mnt/d/...`，不要直接套用 Git Bash 的 `/d/...` 命令。

当前 CLI 的 Windows 权限检查使用原生 `whoami.exe` 和 `icacls.exe`，不要求把 Windows 系统目录手工放到 Git Bash PATH 前面。如果旧版仍出现 `whoami 未返回 DOMAIN\user`，先核对 `workmesh --version` 和实际程序路径并更新 CLI。

## 接入前集中检查

使用目标业务目录和实际 API 地址执行：

```text
workmesh doctor --dir "<业务项目绝对路径>" --role frontend --api "<平台API基址>" --online
```

`doctor` 默认只读；`--online` 增加不携带凭据的服务就绪检查，不会登录或消费接入码。报告集中显示 CLI/Node 版本和位置、工作目录、Windows 系统工具、配置、角色包与资源摘要，以及服务状态。尚未接入时的配置或凭据提示不等于已接入失败，应区分 warning 和 fail。

若要实际验证本机能否创建只供当前用户读取的文件，显式增加 `--check-storage`。它创建并移除临时权限探针，不写业务配置或真实凭据；默认检查不会执行这个临时写入。

```text
workmesh doctor --dir "<业务项目绝对路径>" --role frontend --api "<平台API基址>" --online --check-storage
```

服务就绪检查失败时先核对平台地址和平台运行状态；初始化尚未开始时不要为重试而重新生成接入码。

## 接入后绑定本机仓库与角色资源

`workspace init` 写入 v2 `.workmesh/workspace.json`，固定接入码对应的工作区定义 revision 和 digest，并更新当前用户索引。接入成功后仍应按 CLI 输出检查本机 checkout：

```text
workmesh workspace discover --root "<业务项目绝对路径>"
workmesh workspace bind --root "<业务项目绝对路径>" --repository "<平台仓库UUID>" --path "<工作区内的仓库相对路径>"
```

`bind` 默认预览；确认仓库映射后，在同一命令末尾增加 `--yes` 写入。本机根目录本身就是仓库时，`--path` 可用 `"."`。多仓库工作区逐一核对，平台仓库 UUID 来自项目工作区定义，不能用项目 UUID 替代。最后运行：

```text
workmesh workspace status --root "<业务项目绝对路径>"
```

匹配成功显示的是声明匹配状态；它不代表托管方已核验仓库，也不代表任务已经开发或通过评审。

安装或更新工作区使用的角色资源时运行：

```text
workmesh setup --dir "<业务项目绝对路径>" --role frontend --host codex
```

`setup` 会做预检并使用浏览器设备授权。已接入目录可读取平台和项目配置，内置角色随发行包自动定位，通常无需 `--package`。六个内置角色是 `product`、`ui`、`frontend`、`backend`、`qa`、`ops`；选择本次实际承担的角色。自定义角色包才需要显式 `--package "<自定义角色包绝对目录>"`，目录必须含 `manifest.json`。路径无效时 CLI 会报错并提示可用候选，不会偷偷换成另一个包。

绑定和资源检查后，按 [README 的任务命令](../README.md#cli) 使用 `context --inspect` → `claim` → `context` → `deliver` → `review show` → `changes`。任务与版本参数来自当前平台响应；`deliver` 自动创建评审，再用返回的真实 `reviewRequestId` 查询。批准、返修、撤销和发布仍在 Web 完成。

## 已有配置、兼容入口与中断恢复

已有 v1 `.workmesh/config.json` 时先查看迁移计划，确认后再执行迁移，不要手工同时创建两份活动配置：

```text
workmesh workspace migrate --root "<业务项目绝对路径>" --dry-run
workmesh workspace migrate --root "<业务项目绝对路径>" --apply
```

`setup` 也保留没有工作区配置时的兼容初始化路径，需要显式项目 UUID 和平台 API：

```text
workmesh setup --dir "<业务项目绝对路径>" --role frontend --host codex --project "<项目UUID>" --api "<平台API基址>"
```

新接入优先用项目页面生成的 `workspace init` 命令；`auth login` 用于已有绑定的设备重新授权，不必从“手工安装角色包再登录”开始。

遇到初始化中断或提示遗留 pending 时，先做本机只读检查：

```text
workmesh workspace recover --root "<业务项目绝对路径>"
```

仅当报告确认 pending 与已提交的工作区、平台、定义和用户索引精确一致，且没有活动锁，才按提示执行：

```text
workmesh workspace recover --root "<业务项目绝对路径>" --apply
```

`recover --apply` 只清理已证明提交完成的 pending 记录，不消费接入码、不删除活动锁、不重写已提交配置，也不自动续接设备授权。未完成、摘要不符、旧记录缺少证据或存在锁时保留现场，按报告核对；已消费的码需要回 Web 重新生成，但不能拿新码直接覆盖未解决的本机状态。若初次命令使用了 `--config-home`，后续诊断、状态检查和恢复也使用同一个绝对配置目录。

## 验收步骤与证据边界

接入和角色资源准备完成后，可直接发现任务与检查上下文：

```text
workmesh tasks ready --dir "<业务项目绝对路径>" --json
workmesh tasks show --task <真实任务UUID> --dir "<业务项目绝对路径>" --json
workmesh context --task <真实任务UUID> --inspect --dir "<业务项目绝对路径>" --json
```

`tasks ready` 列的是当前可见范围内前置任务已完成的任务；每项另给出本人领取资格。列表中的其他责任人任务、无效角色和不足的凭据权限不会变成本人的领取入口。`tasks show` 同时读取当前任务与只读输入核验：服务端正文、外部 Git 引用、本机环境分别判断。输入读取失败会保留错误，不能据此断言没有输入或没有变化。

`context --inspect` 不需要 claim 或任务版本，不创建快照；逐项列出缺失或不可用的输入、责任角色和恢复动作。查询退出码 0 只代表成功读取诊断，能否创建快照仍需检查 `availability`；旧平台缺少逐项诊断时会保留不完整提示。不要与 `--claim`、`--expected-version`、`--materialize` 或写操作编号组合。

`deliver` 成功后返回自动创建的 `reviewRequestId`、Web 地址、任务版本和操作编号；该编号也保存到本地收据，无需再次创建同一轮评审。使用返回的真实编号继续：

```text
workmesh review show --review <评审UUID> --dir "<业务项目绝对路径>" --json
workmesh review issue --review <评审UUID> --title "缺少边界用例" --body "请补充权限撤回后的场景" --dir "<业务项目绝对路径>" --json
workmesh review reply --review <当前评审UUID> --discussion <问题UUID> --expected-version <当前问题版本> --body "调整说明与依据" --addressed-in-review <实际交付评审UUID> --dir "<业务项目绝对路径>" --json
```

若交付输出丢失，用 `workmesh receipt show --operation <原交付操作UUID> --dir "<业务项目绝对路径>" --json` 读取 `data.resultRefs.reviewRequestId`；PENDING 或未知结果先按下文核对原收据。返修后重新 `deliver` 会自动创建本轮评审，使用新返回的真实编号继续查询。

`review show` 返回来源评审、问题、追加回应、当前版本及分页游标。默认文本输出在每条问题编号旁显示该问题自己的 `vN`，它与顶部的评审版本不同；`reply --expected-version` 使用问题版本。`issue` / `reply` 成功后显示服务端返回的问题编号和新版本。问题或回应超过单页时，用 `--discussion-cursor`，或按输出执行 `review entries --review <来源评审UUID> --discussion <问题UUID> --cursor <游标>`；游标为不透明值，直接复用。讨论读取失败时 `discussionError` 保留具体错误，`discussions: null` 不表示没有问题。`reply` 默认 `REPLY`；`--kind RESOLVED` / `REOPENED` 只改变问题状态，权限仍由服务端复核，不能代替 HUMAN 正式批准。

写请求发送前先保存原操作的 PENDING 收据；网络中断、超时或服务端结果未知时不自动重试。先在原工作区查询本地列表并用同一配置目录、原凭据核对原操作：

```text
workmesh receipt list --dir "<业务项目绝对路径>" --json
workmesh receipt reconcile --operation <原操作UUID> --dir "<业务项目绝对路径>" --json
```

`receipt list` 可离线查看。服务端返回统一 404 时，仍可能是未提交、不可读或尚未取得结果，原记录保持待核对；不要把它解释成可安全换新编号重发。需要重放时按错误提示保留原内容与 `--operation <原操作UUID>`。成功响应后仅本地落盘失败会明确报告服务端已经提交，不能把它当作普通提交失败重复创建。

可在隔离的业务目录和独立 `--config-home` 中按下表验收，使用测试平台和测试项目，不复用生产的一次性接入码。

| 步骤       | 执行动作                                                                                     | 应核对的结果                                                                  |
| ---------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 命令来源   | 打开项目工作区页，选择 Shell、角色和根目录，复制命令                                         | 单行命令包含该平台 API、当前角色和正确 Shell 路径；未手工拼 UUID 或内置包路径 |
| 预检       | 运行 `doctor --role frontend --api "<平台API基址>" --online` 并明确 `--dir`、`--config-home` | 独立问题集中报告；无授权请求、无接入码消费、无真实凭据写入                    |
| 预览       | 运行复制的 `workspace init`，不加 `--apply`                                                  | 只显示计划；工作区配置和用户索引未写入，码未消费                              |
| 实际接入   | 同一命令加 `--apply`，在 Web 批准测试设备                                                    | CLI 显示对应项目和固定 revision；检查配置、浏览器授权项目和角色一致           |
| 仓库与角色 | 预览 bind，再用 `--yes` 绑定；执行 setup，不传 `--package`                                   | 匹配目标 checkout；自动找到内置角色包；status 给出本机状态                    |
| 恢复边界   | 无中断时运行 recover；中断夹具使用专门的测试工具生成                                         | 默认只读；只有精确提交证据才允许清理，不用手工篡改生产配置制造夹具            |

维护者可重复运行角色包分发守卫：

```bash
node --test scripts/verify-cli-package.test.mjs
```

Windows 打包流程会对 staged CLI 运行 `verify-cli-package.mjs`，检查六个内置角色、资源长度和摘要，并从临时业务目录启动 CLI 验证自动定位，不进入授权或访问真实用户 home。

本轮接入体验改动已做定向单元测试、构建和临时发行布局验证；本文新增的完整 Web 复制命令 → 浏览器批准 → CLI 绑定链路尚未在真实浏览器重新跑通，跨平台完整接入也不能仅凭 CI 配置视为通过。既有工作区接入验收与历史边界见 [接入验收记录](testing/workspace-onboarding-acceptance.md)，不把历史证据作为本轮 UI 改动的通过结果。
