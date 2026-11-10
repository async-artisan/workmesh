# 依赖审计记录：2026-11-07

最新结果见[同日后续处置](#同日后续兼容覆盖与本地补丁)：全量审计为 **840 个依赖、1 项低危、0 项中危/高危/严重**，生产 166 个依赖零项。esbuild、glob、minimatch 路径已兼容更新，deepmerge 已本地补丁并保留版本公告，无忽略或风险豁免。

下列初次结果为历史风险快照：生产依赖审计为零项，全量曾有 2 项低危、2 项中危。早期 Windows Box ZIP 包含其中三个包的受影响版本；将 Prisma 明确列为运行依赖并改用 production deploy 后，已在后续 ZIP 中核对移除这三个包。该移除结果本身不等于工作区公告已修复，也不解除完整 SBOM、最终干净 SHA 和远端 CI 门禁。

## 范围与证据

审计日期为 2026-11-07（Asia/Shanghai）。工作区审计、安装包清单和应用可利用性是三个不同的证据范围，应分别核对。

| 证据                 | 实际结果                                                | 本地证据文件 SHA256                                                            |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 工作区生产依赖审计   | 166 个依赖；低危、中危、高危、严重均为 0                | `018a0f03a3f4b872d5c0709c4508a8ba927e715b4071c67abc0ac5e61c9ea844`             |
| 工作区全量依赖审计   | 866 个依赖；低危 2、中危 2、高危 0、严重 0              | `04507f53aafe72d21b57596e5e91dc47f15d802aeca5d8d11993d09240654f98`             |
| Windows Box ZIP 清单 | 已比对实际 ZIP 内安装的 npm 清单；SBOM 仍为部分覆盖草稿 | ZIP SHA256：`7710af641a6f50497495482eeb3bf10f12cadc726d5a714a14c32580008324dc` |

原始审计文件分别位于本地忽略目录 `.tmp/opensource-audit-prod-20261107.json`、`.tmp/opensource-audit-all-20261107.json`；制品清单验证方法与证据位置见[制品 SBOM 验证记录](../testing/artifact-sbom-validation-2026-11-07.md)。这些是本机证据位置，不是已随仓库归档或发布的资产。公告范围、修复版本和严重程度均采用本次审计响应，后续应重新查询。

上表早期 ZIP 来源声明为版本 `1.0.0`、commit `1fd1635693a77e4b66b0e06818f553719872f494`、工作树 `dirty`。后续 production ZIP 的声明为 `739367a714097a825b96ca7ecf6bce3372855a77`、`dirty`。两者都是构建者声明，不能证明制品来自该 commit 的干净检出，也不能替代最终发布 SHA 的重新构建验证。

审计响应中的 `dev` 标志和依赖分类不足以判定实际交付范围。早期打包为执行 Prisma migration CLI 保留了全部 API 开发依赖；现有[打包脚本](../../scripts/package-box.ps1)使用 production deploy，并把 Prisma 明确列为 API 运行依赖。交付范围仍须按实际归档验证，不能仅依赖 `--prod` 的审计结果。包存在于 ZIP 中也不自动证明存在可被公开 API 触发的调用链。

## 公告、依赖链与早期 ZIP

| 包 / 审计严重程度    | 工作区发现与路径                                                          | 本次公告受影响范围 / 修复版本         | 实际 Box ZIP 的 npm 版本                                         | 处置状态                                          |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| esbuild / low        | `0.27.7`；`apps__cli>tsup>esbuild`                                        | `>=0.27.3 <0.28.1`；修复 `>=0.28.1`   | `0.25.12`、`0.28.2`，均不在本条公告范围内；未识别到 npm `0.27.7` | 工作区发现未关闭；当前 ZIP 清单未命中本条版本范围 |
| deepmerge / low      | `4.3.1`；`apps__api>@nestjs/cli>fork-ts-checker-webpack-plugin>deepmerge` | `>=4.2.0 <=4.3.1`；审计未提供修复版本 | `4.3.1`，在范围内                                                | 随包交付；未修复、未批准风险处置                  |
| glob / moderate      | `13.0.6`；`apps__api>@nestjs/cli>glob`                                    | `>=9.0.0 <=14.0.1`；修复 `>=14.0.2`   | `13.0.6`，在范围内                                               | 随包交付；未修复、未批准风险处置                  |
| minimatch / moderate | `10.2.6`；`.>eslint>minimatch`                                            | `>=7.0.0 <11.0.1`；修复 `>=11.0.1`    | `10.2.6` 在范围内；`3.1.5` 不在本条范围内                        | 随包交付；未修复、未批准风险处置                  |

ZIP 版本来自 `/app/api/node_modules/.pnpm/<包名>@<版本>/node_modules/<包名>/package.json`。这证明文件包含关系，不能证明每个包已执行，也不能完整识别被打包进 CLI/Web JavaScript 的模块。一个版本不在本条公告范围内，只能排除这条版本匹配，不能推断该版本不存在其他漏洞。

表中 minimatch 的工作区审计路径来自根 ESLint；早期 Box 中同版本的可解释引入链则是 `@nestjs/cli → glob → minimatch`。API 全开发依赖部署包含 Nest CLI，不能据此推断根 ESLint 本身也进入 Box。

## Production deploy 与新 ZIP 复验

API 的 `prisma: ^5.21.1` 已从 devDependencies 移到 dependencies，实际锁定版本仍为 `5.22.0`；锁文件仅调整 importer 分类，没有升级依赖。Box 改用 `pnpm deploy --legacy --prod`。独立部署目录实际核对 136 条 manifest、135 个唯一 name/version，Prisma CLI、Client、匹配的 Windows 引擎、工作区运行依赖和全部 20 项迁移均保留；不存在 Nest CLI、deepmerge、glob、minimatch、ESLint、TypeScript、Vitest 等开发工具。生成客户端、原生引擎与 `PrismaService` 模块加载，以及 362 条依赖链接迁移恢复均通过。

随后从同步了最新源码的隔离副本重新 frozen 安装，全仓无缓存 build 为 6/6 通过；真实生成的新制品如下：

| 制品            | 字节数      | SHA256                                                             | 实际核对                                                                            |
| --------------- | ----------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Windows Box ZIP | 197,721,487 | `ff80618f58e2eb2c6f7b592a4abd0d01e06603c6f9d07802f2efa011b28b10bf` | 实际归档路径与扫描均未发现 deepmerge、glob、minimatch 或 Nest CLI 的已安装 npm 清单 |
| 独立 CLI ZIP    | 36,708,339  | `f791a76f0cec1c29d797f58d4a575d81eef6b304489cdb3c8be25719d8c06140` | 与 Box 内下载归档哈希绑定；bundle 模块清单仍未补齐                                  |

新 Box 实际扫描为 276 条 component、160 条 npm、23 条 UNKNOWN；这仍是部分覆盖的 SBOM，不能据此排除所有 bundle 或原生内嵌组件风险。新 ZIP 的隔离 Windows 生命周期检查也已通过：20 项迁移，首次、冷、重复与恢复库四阶段健康检查，55 张表（含验证标记表）、备份恢复标记核对和自有服务停止。生产依赖复查仍为 166 个依赖、零项公告。详情与本地证据见[Box 生产依赖验证](../testing/box-production-dependencies-2026-11-07.md)及[制品 SBOM 验证](../testing/artifact-sbom-validation-2026-11-07.md)。

这证明上述三个受影响包已从本轮新 Box 的已安装 npm 交付范围移除，不能把旧 ZIP 标为已修复，也不能关闭工作区的四项开发依赖公告。尚无对应最终干净 SHA 的远端 CI、新机、旧版升级、卸载或生产验收。

### esbuild

[GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)描述 Windows 开发服务器使用 `servedir` 时的路径遍历与任意文件读取。需要核查开发、CI 或预览环境是否实际启动该服务，以及服务的访问边界。本次没有证明生产静态文件服务使用该功能，也没有完成利用测试。

工作区通过 tsup 引入的版本仍需处理。不能为清除扫描结果直接升级 tsup 主版本或强制覆盖 esbuild：应先证明新组合符合[项目 Node.js 声明](../../package.json)、tsup 调用接口及 CLI 构建要求，并验证输出行为。尤其不能未经决策就提高当前 Node.js `>=20.19` 的兼容基线。

### deepmerge

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) / `CVE-2026-93753` 描述 `mergeObject()` 对返回对象的原型污染。本次审计返回 `recommendation: None`、`patched_versions: <0.0.0`，表示该响应没有可用的修复版本信息；不能将这个字符串当作可以安装的修复版本。

需要核查 Nest 构建工具链是否处理攻击者可控对象或配置。当前未完成该核查，也未验证可兼容的替换或补丁；应继续跟踪上游修复。本轮已通过 production deploy 缩减交付依赖并从新 Box 中移除 deepmerge，但工作区构建工具链仍保留该包。

### glob

[GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) / `CVE-2026-118773` 描述遍历被中止或超时后仍继续消耗文件系统和 CPU 资源。风险条件包括攻击者影响匹配模式或目录树，以及应用依赖 `AbortSignal` 限制遍历预算。

早期 ZIP 已确认构建工具依赖链与交付版本命中，未确认公开 API 可达；本轮新 ZIP 已移除 glob，工作区构建链仍保留。修复范围跨越 glob 主版本；应采用上游兼容升级或经过构建与运行验证的替代方案。直接在 Nest CLI 下覆盖 glob 14 不构成已验证修复。

### minimatch

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) / `CVE-2026-118764` 描述 `optimizationLevel >= 2` 时攻击者控制匹配模式导致的 CPU / 内存放大。需核查实际调用选项及输入来源。当前未完成公开 API 或构建入口的可达性验证。

工作区审计路径来自 ESLint；早期 Box 内的 `10.2.6` 来自 Nest CLI → glob，本轮新 ZIP 已移除该包。不能由旧 ZIP 的版本存在推断根 ESLint 随包交付，也不能在没有 ESLint、Nest 工具链兼容证据时，直接强制覆盖为 minimatch 11。

## 后续处置与发布条件

这四项均未被本记录标记为“接受风险”。责任人、期限、批准人和复查日期尚未确定，不应推定维护者已经批准临时例外。

1. 按[锁文件](../../pnpm-lock.yaml)和实际安装图确认每条引入链，优先验证受支持的兼容更新；需要跨主版本时，明确兼容范围并执行对应构建、测试和安装验证。
2. 保持新 Box 的 production deploy 依赖边界。首次安装、当前版本迁移、启动与备份恢复已在本轮新 ZIP 验证；旧版升级迁移、新机、卸载和最终候选仍需补充证据。
3. 对仍存在的受影响版本记录入口、攻击者可控输入、调用选项和部署边界。未测试的可达性标为未验证，不能写成不可利用。
4. 重新构建来自最终明确 SHA 的制品，再运行工作区审计与制品组件比对。对打包模块和原生运行时补齐 SBOM 证据，记录复现命令、工具版本和制品哈希。
5. 发布前对每项发现取得可审查的处置结果：经验证的修复、经验证的移除，或由负责维护者明确批准且有范围、依据、负责人和复查日期的临时风险处理。当前记录尚未满足这些条件。

复查时可在受支持的 Node.js 环境中运行以下命令，并保存响应和退出码。`pnpm audit` 发现公告时可能返回非零退出码，仍需检查 JSON 内容；生产范围与全量范围都要保留。新扫描的哈希和发现可能与本记录不同。

```powershell
pnpm audit --prod --json
pnpm audit --json
```

## 同日后续：兼容覆盖与本地补丁

本节记录四项初始公告的后续处置；前文的四项发现、旧 ZIP、移除结果和未关闭状态均为此前快照，不改写历史。最新工作区全量审计为 **840 个依赖、1 项低危、0 项中危/高危/严重**；保留的是 `deepmerge@4.3.1` 的版本公告。生产依赖仍为 166 个，全部严重程度为零。没有配置审计忽略或漏洞豁免，不能把本地补丁称作上游已修复，也不能声称全量审计清零。

精确作用于调用方的覆盖已写入根 `package.json` 与锁文件，没有升级 tsup 或 Nest CLI 主版本，也没有提高 Node.js `>=20.19.0` 基线：

| 调用方覆盖                                       | 锁定版本 | 已核查的调用方式与运行基线                                                                |
| ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `tsup>esbuild`                                   | `0.28.2` | tsup 构建 API；包要求 Node.js `>=18`                                                      |
| `@nestjs/cli>glob`                               | `14.0.2` | Nest 资产管理调用 `glob.sync(pattern, { ignore, dot })`；包支持 Node.js 18、20、22 及以上 |
| `eslint>minimatch`                               | `11.0.5` | ESLint 使用 `Minimatch`、`match()` 及部分路径匹配                                         |
| `@eslint/config-array>minimatch`                 | `11.0.5` | 配置数组使用缓存的 `Minimatch` 和匹配选项                                                 |
| `@typescript-eslint/typescript-estree>minimatch` | `11.0.5` | 项目服务调用 `minimatch(filePath, pattern, { dot: true })`                                |

minimatch 11.0.5 要求 Node.js 20 或 22 及以上，符合当前 20.19 基线。初次只覆盖 ESLint 直连时，审计先后显示 config-array 与 typescript-estree 的同版本路径，随后分别增加限定覆盖；没有用全局替换影响不相关的 minimatch 3.x。Prisma 继续保留在 API 的生产依赖分类，Box production deploy 边界没有在本次依赖处置中放宽。

在经官方校验的 Windows Node.js 20.19.0 下，实际 consumer 解析确认三种新版本，并通过 tsup 所用 esbuild 内存构建、Nest 所用同步 glob 的 ignore/dot 行为、ESLint 的 Minimatch 构造与匹配检查；Nest CLI `--version` 返回 11.0.24，已构建 Workmesh CLI `--version` 返回 1.0.0。全仓 `pnpm lint:eslint` 通过。完整隔离构建、应用测试与新制品结果应与本轮主验证记录合并核对，不能仅凭版本覆盖或这些定向检查宣称发布门禁完成。

### deepmerge 的补丁范围与回归

原版 4.3.1 的返回对象原型投毒已在内存中复现：带自身 `__proto__` 数据键的 target、空原型 target 配合恶意 source，以及嵌套 target，均可能令返回对象继承注入的属性。观察到的是返回对象的原型改变；未观察到全局 `Object.prototype` 污染，不能混称。

实际构建调用已核查：fork-ts-checker-webpack-plugin 9.1.0 的 `lib/plugin.js` 通过 `cosmiconfigSync('fork-ts-checker').search()` 发现本地外部配置，随后执行 `deepmerge(externalOptions || {}, options || {})`，再验证合并结果；外部配置作为易受影响的 target 参数进入合并。Nest CLI 11.0.24 的 `lib/compiler/defaults/webpack-defaults.js` 实例化该插件并传入 TypeScript 配置文件。因此本次证实的输入边界是开发或 CI 构建中的本地配置与构造参数。未证明公开 API 的远程输入可达此调用，也未完成完整插件实例化利用链，不能将未验证写成不可达。独立只读审查在内存替换 CJS 三处赋值后，另以 25 个断言确认投毒被阻止且主要合并语义保持；这不替代仓库中的 12 项可重复回归。

[`patches/deepmerge@4.3.1.patch`](../../patches/deepmerge@4.3.1.patch) 同时覆盖源码、CommonJS 和 UMD 入口，把三个 destination 赋值点改为 `Object.defineProperty` 定义可枚举、可写、可配置的自身数据属性，避免调用继承的 `__proto__` setter。补丁保留正常对象原型和自身数据键，未改成空原型结果或丢弃所有特殊名称。它是仓库维护的本地缓解，不是上游安全版本，未更改包的 4.3.1 版本号。

[`patches/deepmerge.test.mjs`](../../patches/deepmerge.test.mjs) 从实际 Nest CLI → fork-ts-checker-webpack-plugin → deepmerge 安装解析被测代码，CJS 与 UMD 各 6 项，共 **12 项在 Node.js 20.19.0 下通过**。回归覆盖 target/source/nested 投毒、customMerge、普通嵌套配置、数组拼接、自定义 arrayMerge、克隆与 clone false、Symbol、Date、RegExp、all() 及属性描述符。CI 已加入同一测试入口。源码入口使用相同补丁；它依赖仅在上游开发环境使用的 is-mergeable-object，因此本次运行时回归直接覆盖分发的 CJS/UMD。

补丁文件通过 `patches/.gitattributes` 的 `*.patch -text` 保持原始字节，锁文件绑定 SHA-256 `e1a2a934569bffb46254645a6b484335bfd9d7f123f829a8beb0ca7267fd1ba3`。补丁的 unified diff 上下文含原始 tab，新增 UMD helper 后仍有一条 tab 空白行，不影响功能；对补丁文本作 `git diff --no-index --check` 会报告这些空白，不能把该检查说成全部通过。没有为通过检查关闭仓库 whitespace 规则。

### 最新审计原始证据

| 范围                        | 本地原始文件                                                                 | SHA-256                                                            |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 全量，1 项 low（deepmerge） | `G:/workmesh-shared-ip-validation-20261107-r1/audit-final-patched.json`      | `cafc8d092420907ccf95527822e82237b22359b1fecc1773e7d4c02c407ed817` |
| 生产，零项                  | `G:/workmesh-shared-ip-validation-20261107-r1/audit-final-patched-prod.json` | `018a0f03a3f4b872d5c0709c4508a8ba927e715b4071c67abc0ac5e61c9ea844` |

当前剩余 `GHSA-gcqx-w48m-w2h4` 的版本发现继续保留；局部补丁回归证明上述投毒路径得到缓解，未证明所有可能攻击输入均不存在，也不替代维护者风险决定、上游更新跟踪、最终候选 clean SHA 与远端 CI。前述历史 ZIP 不因工作区修复自动改变；后续制品必须重新构建、核对实际依赖与 bundle 清单后再记录结果。

## 后续依赖升级计划（2026-11-10）

Prisma 5 → 6 的精确候选、审计 requestId 中间件替换、Bytes/JSON/事务兼容、迁移与 Box 升级回退验收见[升级计划](../operations/prisma-6-upgrade-plan.md)。当前锁文件仍解析为 `5.22.0`，计划存在不代表已升级或完成安全处置；本节不改变前述历史审计与制品结论。
