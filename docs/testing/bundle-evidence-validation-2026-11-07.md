# Bundle 模块证据验证：2026-11-07

本页按历史批次记录实际 CLI/Web bundle 的构建器模块图、固定版本/PURL、许可证元数据与最终输出字节的关联。下文“本轮”“新 ZIP”均以各节明确的归档 SHA 和冻结来源为准；通过记录不自动涵盖后续源码或制品。证据状态为 **`PARTIAL_MODULE_EVIDENCE`**。模块图完整性仍依赖可信构建 hook、构建工具和来源审查，校验器无法仅从 bundle 字节独立证明图完整，也不能据此宣称完整 SBOM。许可证补齐后的 r2 实际包另见[后续批次说明](#许可证补齐后的-r2-批次与后续源码边界)。

## 实现与证据语义

[CLI 构建配置](../../apps/cli/tsup.config.ts)和[shared 构建配置](../../packages/shared/tsup.config.ts)在内存中捕获 esbuild metafile，完成 tsup 后处理后再计算最终输出哈希；[Web 构建配置](../../apps/web/vite.config.ts)使用 Rollup 的 `chunk.modules` 与 `renderedLength`。原有 bundling 配置语义保持一致，没有把工作区 lockfile 的全部依赖当作实际 bundle 包含证据，也没有公开 raw metafile。

[生成与校验库](../../scripts/lib/bundle-evidence.mjs)为每个构建生成 `dist/bundle-evidence.json`，schemaVersion 为 `1.0`、kind 为 `workmesh-bundle-evidence`。主要字段如下：

| 字段                                    | 含义与边界                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outputs`                               | dist 下除声明文件与侧车自身外的最终文件集合，记录相对路径、字节数和 SHA256；包括已有 sourcemap 的文件哈希，但不枚举 sourcemap 内容                                                    |
| `outputs[].modules`                     | 构建器对该输出记录的输入模块，按实际包内相对路径标识；输入 SHA256 对应磁盘文件，不能等同于经过转换后代码的哈希                                                                        |
| `contribution`                          | `rendered` 与零字节 `tree-shaken` 分开；esbuild 的 `bytesInOutput` 和 Rollup 的 `renderedLength` 保留不同 metric，不能解释为最终压缩字节的精确分区                                    |
| `nonRenderedModules`                    | 构建器加载但未在任何输出贡献代码的输入，单独记录，不能视为最终包含                                                                                                                    |
| `components`                            | 从实际输入文件上溯到已安装 package.json，记录固定 name/version、PURL、manifest 哈希、许可证声明与许可证文件哈希；可能关联未 rendered 或预打包候选输入，不能整体解释为最终运行依赖清单 |
| `licenseDeclared` / `licenseFileStatus` | 缺失声明为 `UNKNOWN`；未在该包根目录记录到许可证文件时文件状态为 `UNKNOWN`，不从仓库根许可证推断子包覆盖                                                                              |
| `externalImports`                       | 保留构建器外部引用；`node:` 记为内置模块，其余为 `unmapped-external`，不编造固定版本归属                                                                                              |
| 虚拟/生成模块                           | 虚拟标识仅公开哈希；生成模块的输入哈希仍绑定转换前磁盘文件，来源归属保留限制                                                                                                          |

CLI/Web 均消费预先构建的 shared 包，因此只记录 `shared/dist/index.js` 会漏掉它的预打包来源。生成器先验证 shared 侧车与输出文件哈希匹配，再附上子图；子图内原先 rendered 的模块降级为 `prebundled-candidate`。下游 tree shaking 可能继续删除 shared 内部代码，所以这些候选不能声称全部进入最终 bundle。缺少可验证子图时显式记为 opaque；本轮实际三个构建的 opaque 计数均为零。

[打包脚本](../../scripts/package-box.ps1)在构建源 dist、Box staging 与独立 CLI staging 中调用[校验入口](../../scripts/verify-bundle-evidence.mjs)，[发布工作流](../../.github/workflows/release.yml)另对实际 ZIP 解压后的三处目录校验。侧车随原有 dist 复制进入归档。

## 构建来源与真实 ZIP

环境为 Windows x64、Node.js `24.22.1`、pnpm `10.28.2`。构建副本为本地 `G:/workmesh-box-validation-20261106-212834/source`，本轮验证根为 `G:/workmesh-shared-ip-validation-20261107-r1`。来源 HEAD 声明为 `739367a714097a825b96ca7ecf6bce3372855a77`、工作树为 `dirty`，包含登录/密码限流修复、注册与登录共享 IP 预算修复、production deploy 及本轮 bundle hook。该声明不证明干净检出或可重现构建来源。

首次全量构建日志 `isolated-build-all.log` 停在 API 的 `nest build`，没有 terminal 完成汇总；继续获取结果时句柄消失，主任务核对该副本没有残留 turbo/nest/node 构建进程后另行重试。首次不能记为通过。第二次独立日志 `isolated-build-attempt2.log` 明确记录 **6 successful / 6 total、0 cached**；其 SHA256 为 `6a65ff0d33ba3d45bd3be758b138ff015c0914b13061f26865a5c571f2a73907`。

随后在全新 `package` 目录成功打包；`package.log` 记录六个角色、55 个资源和独立 CLI smoke 通过。以下实际文件大小和 SHA256 已只读复核：

| 制品            |      字节数 | SHA256                                                             |
| --------------- | ----------: | ------------------------------------------------------------------ |
| Windows Box ZIP | 197,865,504 | `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d` |
| 独立 CLI ZIP    |  36,718,143 | `fc15fc1d6c2dcc135a5fbfc4bae4f64d251125fb6a1ed0a177277df9dd9946a0` |

Box 位于验证根的 `package/workmesh-box-win-x64.zip`，独立 CLI 位于 `package/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip`。这些是本机复核位置，不是已发布下载地址；早期 ZIP 的扫描和验证记录仍独立保留，不能据本轮结果改写旧快照。

## 实际归档中的模块证据

对本轮 ZIP 解压得到的 `artifact-scan/box/app/cli/dist`、`artifact-scan/box/app/web/dist` 和 `artifact-scan/cli/app/cli` 重新运行校验器，三处均通过。另直接打开 ZIP 中对应条目计算 SHA256，核对 Box CLI 的 3 个条目、Box Web 的 50 个条目、独立 CLI 的 3 个条目；各数字包含侧车自身及其覆盖的所有输出，均与解压侧车声明一致。

| 归档目录           | 覆盖输出文件 | 组件元数据条目 | 直接 rendered 记录 | 未 rendered 输入 | 预打包候选记录 | 虚拟模块记录 | opaque |
| ------------------ | -----------: | -------------: | -----------------: | ---------------: | -------------: | -----------: | -----: |
| Box `app/cli/dist` |            2 |              8 |                 35 |                0 |            105 |            0 |      0 |
| Box `app/web/dist` |           49 |             16 |                135 |            1,549 |            105 |            3 |      0 |
| 独立 CLI `app/cli` |            2 |              8 |                 35 |                0 |            105 |            0 |      0 |

这里的模块数字是图中的记录次数，不是唯一模块或运行时依赖数。同一个模块可能出现在多个输出中，Web 的 1,549 个未 rendered 输入也不能记为随包包含。shared 源构建另有 4 个覆盖文件、6 条组件元数据和 211 条直接 rendered 记录；其来源通过输出哈希关联到下游候选图。

| 归档内侧车                            |  字节数 | SHA256                                                             |
| ------------------------------------- | ------: | ------------------------------------------------------------------ |
| Box / 独立 CLI `bundle-evidence.json` |  77,345 | `8ab2ae1576af20f51640d21d31b8fa6b84c7b44ba624bad2c89558217c613b40` |
| Box Web `bundle-evidence.json`        | 774,764 | `5c06de5223f3bd48dba0a1bc23ee3fbc251e881eaaf8ffcfe9f98b92847db5ee` |

CLI 元数据关联 commander `12.1.0`、shared `1.0.0`，并携带 Ajv `8.20.0`、ajv-formats `3.0.1`、fast-deep-equal `3.1.3`、fast-uri `3.1.9` 和 json-schema-traverse `1.0.0` 的 shared 预打包来源候选。Web 还关联实际 React、React DOM、router、lucide-react、zustand 等输入；完整范围以模块贡献状态为准。

实际三份归档侧车中的许可证声明仅为 `UNKNOWN`、`MIT`、`BSD-3-Clause` 和 `ISC`。CLI/shared/Web workspace manifest 未提供可由本生成器认定的包级许可证声明和包根许可证文件，继续记录 `UNKNOWN`；不能因为根仓库是 MIT 就把这些未知改写为已核实。

## 校验器回归与独立审查修复

最初的 21 项[定向回归](../../scripts/verify-bundle-evidence.test.mjs)覆盖最终字节、同长度篡改、文件缺失/增加、目录链接、相对路径越界、未知 schema/字段、重复条目、错误组件与版本、伪造许可证文件状态、缺失真实输入、空 JS 图、预打包输出不一致，以及候选模块不能升级为最终包含。

独立只读审查随后发现路径隐私缺口：许可证声明和 external import 可携带 `file:` URL 或 POSIX 绝对路径。修复后 collector 与 validator 共用文本过滤，拒绝 file URL、Windows/POSIX 绝对路径、UNC 与 `~/` 路径，`SEE LICENSE IN` 另要求安全相对路径；普通许可证表达式、HTTPS 声明和安全相对引用保留。新增 24 项正反例，合计 **45/45 通过**，定向 ESLint/Prettier 通过。上述归档侧车的实际许可证值没有命中泄露样例；仍另行完成下述修复后构建和字节比较。

修复后的 helper 已同步到隔离副本，全仓再次无缓存构建 **6/6 通过**，记录于 `isolated-build-privacy-fix.log`，日志 SHA256 为 `d194f8c7f87f0a827c480137b9683745cd215a16e1bf1c85f443aa4df7f90d46`。主任务逐项核对受管输出与侧车：shared 5 项、Box CLI 3 项、Web 50 项、独立 CLI 3 项，共 61 项文件哈希完全一致；比较不包含声明文件。`build-output-comparison.json` 状态为 `IDENTICAL`，SHA256 为 `99d269eb8d2c391fbc3d323450f9809dbec1ee8fea7aef5d3ff569cb7a1de035`。三份侧车哈希保持上表数值，归档与生命周期继续绑定原 Box SHA `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d`。该比较只证明所列受管输出字节相同，不能扩大为干净来源或整个构建过程的可重现性声明。

校验器严格检查 schema 和实际文件集合、大小与 SHA256，能拒绝实际输出与声明不符。它同时信任构建侧车对模块图的声明；有意删除一个模块声明并保留一致的输出哈希，仍可能形成结构合法的伪图。最终来源保证需要可信 hook、源码审查和同 SHA 的构建/CI 证据，不能把文件哈希通过等同于模块图完整性得到独立证明。

## 同一 Box ZIP 的生命周期结果

本轮 `lifecycle/summary.json` 已只读复核为 **PASSED**，并绑定上表 Box SHA。记录全部 20 项迁移；首次、冷、重复、恢复库四阶段 API 直连和 Web 代理均为 `ok`，Web HTTP 200；备份验证核对 55 张表（含验证标记表）、20 项迁移，恢复标记一致，临时验证库已移除，检查器结束时 `ownedServicesStopped=true`。

| 生命周期证据             | SHA256                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| `lifecycle/summary.json` | `b7da763e09d1be5ed7977d702f5dc05eba7444feb4ca9144abc7db83e07dc4cf` |
| summary 记录的备份 dump  | `e4dc6be4fe0f51b574c483d64f31bbbcb4ae9e8c2849540304183c30249eb983` |

该结果是本机 Windows 隔离验证，不包含最终干净 SHA 的远端 CI、新机器、旧版本升级、卸载、生产数据、容量稳定性、跨平台或生产 RTO/RPO。

## 复核命令与开放边界

对已解压且未被运行修改的制品目录执行：

```powershell
node scripts/verify-bundle-evidence.mjs G:/workmesh-shared-ip-validation-20261107-r1/artifact-scan/box/app/cli/dist
node scripts/verify-bundle-evidence.mjs G:/workmesh-shared-ip-validation-20261107-r1/artifact-scan/box/app/web/dist
node scripts/verify-bundle-evidence.mjs G:/workmesh-shared-ip-validation-20261107-r1/artifact-scan/cli/app/cli
node --test scripts/verify-bundle-evidence.test.mjs
```

模块图本身不是独立的 CycloneDX SBOM。最初 `029bbab` 批次的本节验证当时未执行模块图与扫描清单的自动合并；对应扫描和 schema 结果由[制品 SBOM 验证](artifact-sbom-validation-2026-11-07.md)单独按真实归档记录。后续 r2 已执行有边界的直接 rendered 模块保守合并，见[后续批次说明](#许可证补齐后的-r2-批次与后续源码边界)。原生运行时组件、许可证完整性与分发义务、虚拟模块归属、预打包模块的最终精确裁剪归因及最终发布来源证明仍须分别处理。

## 质量门禁修正后新 ZIP 的模块证据（96d555，2026-11-07）

本段单独绑定主任务在质量门禁修正及依赖处置后提供的新 ZIP，保留前述 `029bbab` 输入、哈希和构建比较的历史范围。新验证根为本机 `G:/workmesh-quality-validation-20261107-r2/`；Box 位于 `package/workmesh-box-win-x64.zip`，独立 CLI 位于 `package/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip`。本轮源 manifest 继续声明版本 `1.0.0`、commit `739367a714097a825b96ca7ecf6bce3372855a77` 和 `dirty`，不能把该声明或前轮构建比较外推为新包的干净来源保证。

| 新制品          |      字节数 | SHA256                                                             |
| --------------- | ----------: | ------------------------------------------------------------------ |
| Windows Box ZIP | 197,865,930 | `96d555cd90526eee9b3ad6aaf541fdb2d1bbb604d6b155c26f3e1a70b24ec49e` |
| 独立 CLI ZIP    |  36,718,187 | `f7c1ed041b90c51be34028a56ad2c757c8190c3941e14bbd923463552632ae30` |

重新解压实际两个 ZIP 到全新扫描目录，扫描脚本在扫描前后核对 Box 全部 12,491 个文件与 493,136,681 解压字节，以及独立 CLI 全部 74 个文件与 96,094,848 解压字节。Box 内嵌 CLI ZIP 与独立输入哈希一致。基于此字节绑定，对 Box `app/cli/dist`、Box `app/web/dist` 和独立 CLI `app/cli` 三处重新校验侧车结构、实际输出集合、大小及 SHA256，全部通过；验证结果及归档内相对路径记录于新 `artifact-scan/evidence/artifact-sbom-draft.json` 的 `bundleEvidence`。

| 归档目录           | 覆盖输出文件 | 组件元数据条目 | 直接 rendered 记录 | 未 rendered 输入 | 预打包候选记录 | 虚拟模块记录 | opaque |
| ------------------ | -----------: | -------------: | -----------------: | ---------------: | -------------: | -----------: | -----: |
| Box `app/cli/dist` |            2 |              8 |                 35 |                0 |            105 |            0 |      0 |
| Box `app/web/dist` |           49 |             16 |                135 |            1,549 |            105 |            3 |      0 |
| 独立 CLI `app/cli` |            2 |              8 |                 35 |                0 |            105 |            0 |      0 |

| 新归档内侧车                                |  字节数 | SHA256                                                             |
| ------------------------------------------- | ------: | ------------------------------------------------------------------ |
| Box CLI `app/cli/dist/bundle-evidence.json` |  77,345 | `be78451290bbc469ff74b206d946f995611672c7556715672cf06738a602191f` |
| Box Web `app/web/dist/bundle-evidence.json` | 774,764 | `19a9772b62069e090b7064481b179e2ec4e5d736653b3b55db1d38370fae91e9` |
| 独立 CLI `app/cli/bundle-evidence.json`     |  77,345 | `be78451290bbc469ff74b206d946f995611672c7556715672cf06738a602191f` |

新侧车字节数和图记录数与前轮一致，但哈希已变化；不能复用前轮侧车哈希或 61 项受管输出比较来证明本轮字节相同。新扫描输出分别保留三份侧车副本，其 SHA256 与归档内侧车一致。模块图仍为 **`PARTIAL_MODULE_EVIDENCE`**：组件元数据可能来自未 rendered 或候选输入，不能直接当作最终运行依赖；105 条候选不证明全部进入最终 bundle，3 条虚拟记录的来源归属仍有限，opaque 为 0 也不证明图完整。

本轮使用固定工具重新扫描新包，两份实际 CycloneDX 1.7 文档均通过离线 schema 与格式语法校验，62 项 bundle/schema 回归和 30 项扫描防护均通过；脚本、helper/verifier、schema validator 和四份 schema 哈希在扫描前后稳定。新 manifest SHA256 为 `1fa18dc4c0eb507768218589650e70b2db9acf7a8d333ef5f1c1dd3da73ad874`。扫描输出 `SHA256SUMS.txt` 的 11 项哈希与实际文件集合另行核对一致，但其中两个 `*.scan.log` 为私有日志；本地校验集合不是公开 Release 资产清单。完整扫描数值和输出哈希见[制品 SBOM 新包记录](artifact-sbom-validation-2026-11-07.md#质量门禁修正后新-zip-的独立扫描96d5552026-11-07)。

同一新 Box ZIP 的 `lifecycle/summary.json` 已只读复核为 **PASSED**，SHA256 为 `81358bac078e5c762a56c4a94305c9397d47ec4778834aa728e06036d1b4cce5`。四阶段 API/代理均 `ok`、Web 200，20 项迁移、55 张表含标记，恢复标记一致、验证库已移除、自有服务已停止；完成时间为 `2026-11-07T02:46:59.5686985Z`。summary 记录 dump SHA256 为 `bdc59af6da6d73b725a8b53c944f3763ba646c42b446fe6a001425b438f71ce0`，这里未另行定位或重算 dump，也未重跑生命周期。

本段覆盖实际新归档的模块侧车与本机生命周期记录，不增加新机器、旧版升级、卸载、跨平台、生产数据或最终 clean SHA 的远端 CI 证据。schema 通过不证明组件覆盖，文件哈希不证明构建 hook 报告的模块图完整；供应方 SBOM、二进制来源、许可证/NOTICE、预打包候选最终归因及完整 CycloneDX 合并门禁继续开放，整体仍为 `DRAFT_PARTIAL_COVERAGE`。本地输入、扫描证据和私有诊断日志的位置均不是公开下载地址。

## 基线修正后最终 ZIP 的模块与构建绑定（554eae，2026-11-07）

本段追加本机 `G:/workmesh-baseline-package-validation-20261107-r2/` 的该批次制品，保留前轮独立范围；本节“最终”仅指该批次收尾，不表示当前发布候选。Box 位于 `package/workmesh-box-win-x64.zip`，独立 CLI 位于 `package/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip`；扫描证据位于 `artifact-scan/evidence/`，manifest 生成于 `2026-11-07T03:52:31.3724451Z`。声明版本 `1.0.0`、commit `739367a714097a825b96ca7ecf6bce3372855a77` 和 `dirty`，不构成干净检出、可重现来源或公开发布证明。

构建比较限定为 `G:/workmesh-box-validation-20261106-212834/source` 中打包时冻结快照与实际 ZIP。冻结后工作树另有四份 `tasks` 文件并行编辑，保留原样，未包含在本轮包或验证中。主任务 699 个构建输入一致的记录也仅对应打包时冻结快照；此处没有独立重验全部 699 项，不声明现在整个工作树与包一致。

| 最终制品        |      字节数 | SHA256                                                             |
| --------------- | ----------: | ------------------------------------------------------------------ |
| Windows Box ZIP | 197,882,772 | `554eae8b559c33f2cf771fae36eb4163aaca1c2bd976287da1c302e3c9035c6e` |
| 独立 CLI ZIP    |  36,718,185 | `6c5bd81bd745971856337aff6febe0e76a431857714ba0f47db6fb24f56f1780` |

两个实际 ZIP 均独立重新哈希。中央目录重新统计 Box 为 12,497 个文件、493,217,411 展开字节，CLI 为 74 个文件、96,094,848 展开字节；直接读取 Box 内嵌 CLI ZIP 再次哈希与独立输入一致。扫描脚本记录前后全文件绑定；以下独立比较采用选定条目，未独立重做全部 ZIP 文件哈希。

独立再次对 `artifact-scan/box/app/cli/dist`、`artifact-scan/box/app/web/dist` 与 `artifact-scan/cli/app/cli` 校验侧车结构、实际输出集合、大小和 SHA256，三处均通过。

| 归档目录           | 覆盖输出文件 | 组件元数据条目 | rendered 记录 | 未 rendered | 预打包候选 | 虚拟记录 | opaque |
| ------------------ | -----------: | -------------: | ------------: | ----------: | ---------: | -------: | -----: |
| Box `app/cli/dist` |            2 |              8 |            35 |           0 |        105 |        0 |      0 |
| Box `app/web/dist` |           49 |             16 |           135 |       1,549 |        105 |        3 |      0 |
| 独立 CLI `app/cli` |            2 |              8 |            35 |           0 |        105 |        0 |      0 |

| 最终归档内侧车                              |  字节数 | SHA256                                                             |
| ------------------------------------------- | ------: | ------------------------------------------------------------------ |
| Box CLI `app/cli/dist/bundle-evidence.json` |  77,345 | `be78451290bbc469ff74b206d946f995611672c7556715672cf06738a602191f` |
| Box Web `app/web/dist/bundle-evidence.json` | 774,764 | `84a49b3a44fbda7968b2454a9a43a3861c0993ca8dfb11e8ed1ceec8c03b61ed` |
| 独立 CLI `app/cli/bundle-evidence.json`     |  77,345 | `be78451290bbc469ff74b206d946f995611672c7556715672cf06738a602191f` |

CLI 侧车与 `96d555` 前轮相同；Web 字节数与图计数相同，SHA256 已变化。该批次实际许可声明仍为 UNKNOWN/MIT/BSD-3-Clause/ISC；CLI/shared/Web workspace 条目在该归档中继续 UNKNOWN，不能从根 MIT 推导包级许可，也不能用后续补齐结果回写历史。模块记录不是唯一依赖数，候选不证明最终进入 bundle，未 rendered 不能记为实际包含，opaque 为 0 不证明图完整；状态仍为 **`PARTIAL_MODULE_EVIDENCE`**。

独立直接从 ZIP 流读取 **60 个 Box 条目**的长度和 SHA256：Web dist 全部 50 项（49 输出加侧车）、CLI dist 3 项（JS/map/侧车，不含声明文件）、API publication repository/service 和 review repository 的 6 个 JS/map 条目、内嵌 CLI ZIP 1 项。全部与 `artifact-scan/box/` 和 `lifecycle/box/` 对应文件一致。其中除内嵌 ZIP 外 **59 个构建文件**与冻结 `source/apps/{api,web,cli}/dist` 输出一致。另直接复核独立 CLI ZIP 的 3 个 JS/map/侧车条目，与扫描解压文件一致；未复用前轮 61 项结果。

实际 Web 侧车中的 **94 个唯一 workspace rendered 源输入**另逐个与冻结 `source/apps/web` 文件重算 SHA256，全部一致。关键冻结输入和实际 ZIP 输出如下：

| 冻结输入或实际 ZIP 输出                | SHA256                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| review repository TS                   | `ba01132c52a91c5b3dd452ea3afbae8254b268999496589a27aaa2be455104da` |
| publication repository TS              | `441ea861ec7d7695579bca521a6cf9a2c10ba24d45d182c7ed3754d3b7daa934` |
| publication service TS                 | `7c99da81a0a6f2d168611f235fe7fe63448598674802d8c583947d280c842f13` |
| `RequirementDetail.tsx` rendered 输入  | `976859570791ec9a5bbad708f52694ac06cc383157b1a601de25b0fcea1505f6` |
| 实际 ZIP review repository JS          | `a9a8ded3595f82034d1794a1df0814c2e94c76ef83ea912bdc25b2e421823b80` |
| 实际 ZIP publication repository JS     | `0e37f87df53fd7663dc35e6f96911a67fd849686732d610788a89ba16fdb3286` |
| 实际 ZIP publication service JS        | `01b1e247ca2efa82c8f174ca7597b60444b69c269ae32cf7ce6655c0accff949` |
| `assets/RequirementDetail-DRmMBKXQ.js` | `8744441e804e5f3644ed4ed20310bcb84e454c834534317f3de53b25192e833d` |

实际 ZIP 上述三个 API JS 分别为 95,246、29,871、24,483 字节，RequirementDetail 输出为 58,178 字节。只读检查确认 publication JS 使用 `select: REVISION_SUMMARY_SELECT` 和 `toRevisionSnapshot` 映射；字节/文本检查不等于独立重跑行为测试。最终构建日志位于 `G:/workmesh-baseline-validation-20261107-r1/`，`api-build-final.log` SHA256 为 `520b633093a31b1dc6169ef2c7923d198576222a4bde2a8cb14857ce1cba9288`，`web-build-final.log` 为 `b07c5a0393c58f66cfdb466c53187ab36052adecfe790827e53f9b56aaebd49b`，Web 日志含该 RequirementDetail 文件和 4.37 秒构建。

最终扫描在首次隔离副本缺 validator 失败后从完整工作区成功执行；首次日志为空，失败原因来自主任务执行报告。独立复核重算 `SHA256SUMS.txt` 的 11 项及精确文件集合，并重验两份实际 CycloneDX 1.7 离线 schema/格式语法，均通过；manifest SHA256 为 `b99fc423b20a665c8cdb54c9552a054441fe6d930e8dfb5c331d7924413ec4c5`，8 项 `evidenceTools` 与复核时工具一致。本轮未重新运行前轮回归套件。工具、扫描数值与日志边界见[最终制品 SBOM 复核](artifact-sbom-validation-2026-11-07.md#基线修正后最终-zip-的独立复核554eae2026-11-07)。

同一 Box SHA 的 `lifecycle/summary.json` 为 **PASSED**，SHA256 为 `28d68dc79bb0e6a52e3251aade4fa75430b9ade77ea7cc214884cacea526cc7e`，完成于 `2026-11-07T03:48:58.7451937Z`。20 项迁移、四阶段 API/代理 `ok` 与 Web 200、55 张表含标记、恢复标记一致、验证库移除与自有服务停止记录均只读核对。另定位实际 310,172 字节的 `lifecycle/data/backups/20261107-114842/db.sql`，独立重算 SHA256 `0769cd96ecb59077d2f62de3204b81a7e790d7bc1ac569db70c0584be8014c7d`，匹配 summary 和备份验证 capture；SQL 标记与 final-stop capture 一致。本轮未重跑生命周期或连接数据库，停止状态仅指该次检查结束时。

独立复核未发现使本轮选定字节绑定、模块校验或生命周期记录失效的矛盾。整体仍为 **`DRAFT_PARTIAL_COVERAGE`**：schema 与字节相同不足以关闭模块覆盖、供应方 SBOM、UNKNOWN 版本、许可证/NOTICE、候选最终归因、完整 CycloneDX 或最终 clean SHA 来源门禁。没有增加新机、旧版升级、卸载、生产数据、容量、跨平台或远端 CI 证据。

## 许可证补齐后的 r2 批次与后续源码边界

后续许可证 r2 的实际 Box SHA 为 `239abf9b446ae04823a362f17088fe42699d61300c627704f73752046ef2d9aa`，独立 CLI SHA 为 `d0ccfeaa4f0f50e91f8bab33f7bb4fbbe5ad793ba8db7ebe509a3e74d06df7ed`。实际 ZIP 文本、索引、运行时通知及 bundle 输出绑定验证见[许可证分发验收](license-distribution-validation-2026-11-07.md#r2-actual-archive-and-lifecycle-supplement)；同包生命周期与修正后的实际扫描见[制品扫描该批次记录](artifact-sbom-validation-2026-11-07.md#许可证补齐后实际-zip-与保守合并239abf2026-11-07)。这些记录独立于上文 `554eae` 及更早的归档，不替换其哈希或许可证状态。

该 r2 扫描已将经实际输出校验、具有固定有效身份的直接 rendered 模块保守合并到 CycloneDX；未将预打包候选、虚拟或生成模块提升为确定组件，也未补造依赖边。已知缺失许可文本记录为零仍不等于完整原生许可或供应链覆盖，状态继续为 **`PARTIAL_MODULE_EVIDENCE`** 和 **`DRAFT_PARTIAL_COVERAGE`**。PostgreSQL 原分发的本地关联有哈希证据，其原始下载来源仍未核实。

后续源码的完整入口结果单列于[本地验证验收](local-verification-validation-2026-11-07.md)。源码构建或侧车校验只对应其明确冻结的输入与输出；没有新的实际 ZIP、扫描及生命周期绑定时，不据此声称旧包已经包含后续实现，也不预先宣告仍在运行的验证成功。

## 2026-11-09 r8 生产首屏与评审延后加载

r8 的 901 文件冻结源码在干净目录和新库完成 `pnpm verify -- --apply-migrations`，exit 0 / LOCAL_QUALITY_PASSED；详见[完整入口复验](local-verification-validation-2026-11-07.md#2026-11-09-r8-干净目录完整复验)。没有为本次源码重新生成 ZIP，因此本节不能扩大上文旧归档的覆盖范围。此段记录在冻结之后追加。

实际 Web 49 个产物的字节/输入/模块侧车验证通过，16 个组件、135 个 rendered 模块、1549 个 tree-shaken 模块、105 个预打包候选、0 个不透明预打包；状态仍为 `PARTIAL_MODULE_EVIDENCE`。生产 React、ReactDOM、JSX runtime、scheduler 有实际 rendered 模块，开发实现为零。

首屏计量从实际 `dist/index.html` 的 module script/modulepreload 发现入口，使用冻结工作区 Rollup `parseAst` 递归遍历静态 import/export 边；已登录 `/` 再定位含 rendered Workbench.tsx 的输出，并解析对应 Vite `__vite__mapDeps` 预加载索引。文件去重后分别加总 raw 字节和逐文件 gzip level 6 大小，HTML/CSS 单列；这不是实际 HTTP 传输观察。

| 范围                    |          r7 raw / gzip B |        r8 raw / gzip B |
| ----------------------- | -----------------------: | ---------------------: |
| HTML 入口 JS 静态闭包   |           244704 / 80060 |         244696 / 80068 |
| 已登录 `/` 首页 JS 闭包 | 338760 / 112167，11 文件 | 285867 / 94391，6 文件 |

首页 raw 减少 52893 B（15.61%），但仍高于原定 200000 B。实际改动是在 ReviewDecisionDrawer 的 reviewId 条件内使用 lazy/Suspense，保持外层 Modal；ReviewDecision、DiffViewer 等评审内容不再属于首页必需闭包。两项新增单元回归、完整 Web 536 项、真实 Chromium 4 项与 UI review 54 项均通过。运行前后冻结源码逐文件哈希一致；没有仅靠重新分 vendor chunk 报告收益。

HTML 真正入口是 `assets/index-56NWZCuR.js`。另一个 `assets/index-DocBlgg0.js` 含 shared/AJV，仅由 Authorization/Workflows 延迟页依赖，不在首页六文件闭包中。不能把 `assets/index-*.js` 的多个匹配结果混为入口，也不能将动态 preload 映射表中列出的所有文件当作已加载。

本地原始记录位于 `G:/workmesh-verify-validation-20261109-r8`；`r8-web-dist` 保存实际 Web 输出副本。清单 `source-r8-frozen.json` SHA256 为 `e0964ba075e262d285b4726030b628d0176966416bbb3a9f3d44f7de0e3fa971`，实际 `bundle-evidence.json` 为 `f8c03d85166ad3068c4d54fda8b596e90f819b86314c2659ab8d62ec4a3750da`，`r8-bundle-measurement.json` 为 `9e8ed07b9a7fb9253033bef2ec81a5b46bdc58b832169125869f550c30cef3af`。这些字节及来源验证不等于完整 SBOM、许可证覆盖、正式发布或生产容量。

## 2026-11-10 r13 实际归档与冻结输出绑定

r13 的 915 文件冻结源码完整验证实际退出 0 / LOCAL_QUALITY_PASSED，来源清单 SHA256 为 `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b`。本轮用该快照已构建的生产输出重新生成 `G:/yesgoo/workmesh-validation/20261109-r13/package-r1/`，版本 `1.0.0`，源声明为 `739367a714097a825b96ca7ecf6bce3372855a77` 加 dirty 快照。该声明不构成 clean SHA 来源或远端 CI 证明，文档追加与后续并行源码修改均不在此冻结范围内。

实际 Box ZIP 为 182,814,742 B，SHA256 `09d0d2baf4175a96970be9db3c48879b4ad0887cb480420829f1b53eb6a6c3d3`；独立 CLI 为 29,047,254 B，SHA256 `7c06512dbc1264e46570e6992bd73a75aa7cc85d72862daae2348b27bd840337`。扫描从这两份最终 ZIP 新解压到独立 `scan-inputs-r1/`；完整归档树在扫描前后均逐文件核对，内嵌 CLI 与独立输入摘要一致，没有复用会被安装流程修改的生命周期目录。

| 归档目录           | 覆盖输出文件 | 组件元数据条目 | rendered 记录 | 未 rendered | 预打包候选 | 虚拟记录 | opaque |
| ------------------ | -----------: | -------------: | ------------: | ----------: | ---------: | -------: | -----: |
| Box `app/cli/dist` |            2 |              8 |            36 |           0 |        105 |        0 |      0 |
| Box `app/web/dist` |           53 |             16 |           136 |       1,549 |        105 |        3 |      0 |
| 独立 CLI `app/cli` |            2 |              8 |            36 |           0 |        105 |        0 |      0 |

三处实际归档的侧车结构、实际输出集合、大小与 SHA256 均经扫描脚本验证。CLI 侧车 SHA256 为 `f1896e2f9afb5a23b72a7e499c0316ac1685b703026d4b5bf877cff7ef103f78`，Web 为 `9fba0ff26d295a342dd90a78694e36490e85b4756bf4b39b708486dfb7dfa2ee`。扫描后另将 Box Web 的全部 53 个受管输出加侧车、Box CLI 的 2 个输出加侧车，以及独立 CLI 的 2 个输出加侧车，与 `G:/workmesh-verify-validation-20261109-r13/source/apps/{web,cli}/dist` 逐项比较，分别 54 / 3 / 3 项全部相同。比较结果 `archive-bundle-comparison-r1.json` SHA256 为 `4a85c18c9a6fdc3f540d2ddae6a10bfc6258a7f8563ce5da806d7faf2c4924f9`；该独立比较不含声明文件、API 其他输出与运行时，不等于完整可复现构建证明。

固定 Syft 1.57.0 扫描实际退出 0，并将可验证的直接 rendered 身份保守合并：Box 新增 8 个组件、匹配 3 条已有记录，代表 157 条模块记录和 10 个 rendered 身份；独立 CLI 新增 3 个，代表 36 条记录和 3 个身份。两份实际合并后 CycloneDX 1.7 schema/格式校验通过，状态仍为 `DRAFT_PARTIAL_COVERAGE`。候选不证明最终包含，virtual/generated 不提升为确定组件，未推断依赖边；模块记录、匹配次数和唯一依赖数不能混用。完整数值及摘要见[该批次扫描](artifact-sbom-validation-2026-11-07.md#r13-同源完整验证后新制品2026-11-10)。

本轮生产首屏计量仍依据实际入口与静态闭包，逐文件 raw/gzip 分开统计：HTML 入口为 `assets/index-BC1ZZBHx.js`，239,134 / 78,646 B；已登录 `/` 为 6 个 JS 文件，284,314 / 94,516 B。React production 实现记录 8 条，development 为 0；评审、登录及注册延后加载仍不能使首页 raw JS 达到 `<200000 B`。计量文件 `r13-bundle-measurement.json` SHA256 为 `c10e83d41ec5111f934db207b03d40d1c38cc4f894f2b3faa5caf9fa819c9f20`；gzip 是逐文件 level 6 的本地估计，不是观察到的网络传输，不能替代 raw 预算。

同一 Box SHA 的本机隔离生命周期退出 0：20 项迁移，首次/冷/重复/恢复库四阶段 API 与 Web 代理健康、Web 200，55 张备份表含标记、恢复标记匹配、验证库移除、自有服务停止。只读核对的 `lifecycle-r1/summary.json` SHA256 为 `1883acfca14bef015d2fe07fea0d3255a4c47c334d3c372d75a340966943cf0b`。许可文本索引仍为 `PARTIAL_COVERAGE`；PostgreSQL 本地文件/通知虽有摘要关联，原始下载来源和供应方签名没有独立核实。bundle、schema、文本与生命周期结果不构成完整 SBOM 或发布批准，也不增加新机、旧版升级、卸载、跨平台、生产容量/稳定性、最终 clean SHA、远端 CI 或最新 live 工作树的验收范围。
