# 制品 SBOM 验证记录：2026-11-07

本记录按批次保留早期开发依赖包、production deploy 包、共享 IP 与基线修复包，以及后续许可证补齐包的实际扫描。最新 r13 `09d0d2…` ZIP 已从同源完整本地验证的冻结输出重新打包，使用固定 Syft 独立扫描并完成本机生命周期，见末节。状态仍为 **`DRAFT_PARTIAL_COVERAGE`**：预打包候选的最终归因、原生运行时内嵌组件与许可、23 条 UNKNOWN 的精确版本和整体许可证义务仍不完整，不能作为完整 SBOM 或最终发布验收通过的依据。

## 早期扫描的范围与来源

| 项目                        | 实际记录                                                   |
| --------------------------- | ---------------------------------------------------------- |
| 验证日期                    | 2026-11-07（Asia/Shanghai）                                |
| 清单生成时间                | `2026-11-07T00:37:27.6755822Z`                             |
| 制品版本                    | `1.0.0`                                                    |
| 声明的源 commit             | `1fd1635693a77e4b66b0e06818f553719872f494`                 |
| 声明的工作树状态            | `dirty`                                                    |
| 平台                        | Windows AMD64；PowerShell 7                                |
| 实际识别的运行时 / 迁移工具 | Node.js `24.22.1`、PostgreSQL `17.11`、Prisma CLI `5.22.0` |

`declaredSourceCommit`、`declaredSourceTreeState` 是调用者声明的元数据。脚本验证输入 ZIP 的字节、解压目录与扫描结果的绑定，不验证源检出是否干净，也不证明构建过程来自该 commit。本次制品来源为 dirty 快照，最终发布仍需从明确的干净 SHA 重新构建并验证。

实现位于[扫描脚本](../../scripts/release-artifact-sbom.ps1)、[固定扫描配置](../../scripts/release-artifact-sbom.syft.yaml)和[辅助函数回归测试](../../scripts/release-artifact-sbom.test.ps1)。工作区依赖公告与实际交付版本的区别见[依赖审计记录](../security/dependency-audit-2026-11-07.md)。

## 固定工具与配置

| 项目                               | 值                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Syft 版本 / 平台                   | `1.57.0` / `windows/amd64`                                                 |
| Syft 上游源码 commit               | `30f4bce762f31136e055f2965185f12eb95fbe47`                                 |
| 上游 Windows AMD64 分发 ZIP SHA256 | `06e9663e55f7f38ff966710670fbe0763182c621f7ac2f191bcb209a6dfbd969`         |
| `syft.exe` SHA256                  | `66327bc7261636c1a5d4214b40a5890b7845484fa5bc36f8515bfbb203e13476`         |
| 配置 SHA256                        | `99d29c8ce7064fac8ec7393e3ad851433ede5b6ebe6dadf404873ba993e22ee7`         |
| 输出配置文件                       | `artifact-sbom.syft.yaml`，与源 `release-artifact-sbom.syft.yaml` 字节一致 |

脚本在执行扫描器前检查可执行文件哈希，再验证版本、平台和源码 commit。配置明确扫描已安装 npm package manifest 并包含开发依赖，排除工作区 lockfile 与 GitHub Actions usage cataloger，保留文件 SHA256 元数据；关闭扫描器更新检查与 JavaScript 远程许可查询。扫描结果代表当次配置发现的制品记录，不代表工作区锁文件的完整依赖图。

## 早期实际结果

| 制品             | component 记录 | npm 记录 | UNKNOWN 版本记录 | 精确核对的 ZIP 文件 | 解压字节数  |
| ---------------- | -------------- | -------- | ---------------- | ------------------- | ----------- |
| Windows Box      | 813            | 692      | 37               | 28,306              | 726,732,604 |
| 独立 Windows CLI | 1              | 0        | 0                | 73                  | 95,921,978  |

这些是扫描器记录数，不能解释为唯一运行时依赖数。npm 子路径元数据和模板清单可能形成独立记录，尚需分类与去重评审。CLI 唯一识别到的 component 为 Node.js；这直接表明扫描器没有枚举出 CLI JavaScript bundle 的模块依赖，不能把 0 个 npm 记录理解为 CLI 不包含第三方 JavaScript。

| 输入                       | SHA256                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `workmesh-box-win-x64.zip` | `7710af641a6f50497495482eeb3bf10f12cadc726d5a714a14c32580008324dc` |
| `workmesh-cli-win-x64.zip` | `e5fcf604a6b1b37de95db024a7fe32e3906510fbda913ac799b29575e66b8b0a` |

Box 内 `downloads/workmesh-cli-win-x64.zip` 的哈希与独立 CLI 输入相同，二者关系验证通过。Box 与 CLI 分别扫描；不能从 Box 顶层扫描推断其嵌套归档已被覆盖。

脚本在扫描前后均核对完整 ZIP 文件集合、长度和逐文件 SHA256，并确认 ZIP 本身未变化；拒绝输出目录已存在、输入输出路径重叠、reparse point、路径遍历、Windows 不安全文件名和大小写不敏感的重复文件名。

辅助函数回归检查为 **30/30 通过**，覆盖实际目录 junction、同长度内容篡改、缺失和额外文件、遍历、重复文件名、已有输出哨兵保护、不可信扫描器拒绝、已知路径归一化及未知敏感路径字段拒绝。测试从生产脚本 AST 提取函数执行；它验证防护函数行为，不证明扫描器能识别全部组件。实际 Syft 扫描另行成功完成。

## 后续 production ZIP 实际扫描

后续将 Prisma 明确列为 API 运行依赖，Box 改用 production deploy；隔离副本 frozen 安装和全仓无缓存 build 为 6/6 通过后，在全新 `package2` 输出目录真实重新打包。来源声明为版本 `1.0.0`、commit `739367a714097a825b96ca7ecf6bce3372855a77`、工作树 `dirty`；这仍不是干净 SHA 的构建来源证明。初次打包因隔离副本缺少 `verify-cli-package.mjs` 失败，完整同步构建相关文件后重试成功，两次日志均保留。依赖缩减、模块加载和完整打包过程见[Box 生产依赖验证](box-production-dependencies-2026-11-07.md)。

本轮使用同一固定 Syft 1.57.0、可执行文件与配置哈希重新扫描实际新 ZIP。清单生成于 `2026-11-07T01:24:14.9399836Z`，逐文件绑定结果如下：

| 制品             | ZIP 字节数  | component 记录 | npm 记录 | UNKNOWN 版本记录 | 精确核对的 ZIP 文件 | 解压字节数  |
| ---------------- | ----------- | -------------- | -------- | ---------------- | ------------------- | ----------- |
| Windows Box      | 197,721,487 | 276            | 160      | 23               | 12,484              | 492,045,193 |
| 独立 Windows CLI | 36,708,339  | 1              | 0        | 0                | 73                  | 96,017,391  |

| 输入                          | SHA256                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| 新 `workmesh-box-win-x64.zip` | `ff80618f58e2eb2c6f7b592a4abd0d01e06603c6f9d07802f2efa011b28b10bf` |
| 新 `workmesh-cli-win-x64.zip` | `f791a76f0cec1c29d797f58d4a575d81eef6b304489cdb3c8be25719d8c06140` |
| 新 `artifact-sbom-draft.json` | `7f8ec6872d939c09617130417a5a81fd9d3d7653f82109ba7310f1d8c0381c3d` |
| 新 `workmesh-box.syft.json`   | `40a2e2cd8f325d2f560e3ebcc09c6e8e116b3cab91a57d0cd2df83732b4b56de` |

已核对实际归档路径及 Syft 组件清单：新 Box 不含 Nest CLI、deepmerge、glob、minimatch 的已安装 npm 清单，Prisma CLI、Client、engines 均仍识别为 `5.22.0`。这证明早期随包的三个受影响 npm 包已从新制品安装依赖范围移除，不能扩大为全部漏洞已关闭。工作区四项公告和 bundle 证据缺口仍保留；minimatch 的早期 Box 引入链为 Nest CLI → glob，不能据根 ESLint 的工作区审计路径推断 ESLint 本身随包交付。

本轮 Box 内嵌 CLI ZIP 的哈希仍与独立 CLI 输入一致，并独立扫描。CLI 仍只识别 Node.js 一条 component，说明 bundle 模块图缺口继续存在；组件数量减少也不能替代 license、原生内嵌组件与依赖关系审查。

同一新 Box SHA 的生命周期 summary 为 `PASSED`：全部 20 项迁移，首次、冷、重复、恢复库四阶段 API 直连及 Web 代理健康与 Web 200，55 张表（含验证标记表）、备份验证及恢复标记核对，自有服务已停止。此处只引用该次检查器完成时的结果，不代表后续没有独立验证操作。备份 dump SHA256 为 `23a0e3feeaf2100c1172db2ff09f55431a3335472c287dbcf4e4f3652eda9a32`。仍未覆盖旧版升级、卸载、新机、远端 CI、最终干净 SHA 或生产验收。

## 共享 IP 修复与 bundle 证据包扫描

最新源码快照在隔离副本无缓存构建 6/6 后重新打包，包含共享 IP 修复与 CLI/Web/shared 的 `bundle-evidence.json`。源声明仍为 `739367a714097a825b96ca7ecf6bce3372855a77` 加 dirty 工作树。首次构建的执行句柄消失、日志没有完成汇总，不能计为通过；第二次无缓存构建有成功退出及 6/6 汇总。随后修复许可证声明和外部引用可携带主机路径的 P2 问题，再次无缓存 6/6，并比较 61 个受管输出及侧车与实际归档解压文件，全部 SHA256 相同；声明文件不在此比较范围，详见[bundle 验证](bundle-evidence-validation-2026-11-07.md)。

| 制品             | ZIP 字节数  | component 记录 | npm 记录 | UNKNOWN 记录 | 精确核对 ZIP 文件 | 解压字节数  |
| ---------------- | ----------- | -------------- | -------- | ------------ | ----------------- | ----------- |
| Windows Box      | 197,865,504 | 276            | 160      | 23           | 12,491            | 493,136,276 |
| 独立 Windows CLI | 36,718,143  | 1              | 0        | 0            | 74                | 96,094,736  |

| 输入或证据                 | SHA256                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| Box ZIP                    | `029bbab62a26a4e168d96bb23d4a1525e015972942f5f4f252d7a3a0213e102d` |
| CLI ZIP                    | `fc15fc1d6c2dcc135a5fbfc4bae4f64d251125fb6a1ed0a177277df9dd9946a0` |
| `artifact-sbom-draft.json` | `82b2466f2631b67b135782255a007d28f9fc2d5fa04b57253cd39264fc06a631` |
| `workmesh-box.syft.json`   | `a99301bfb32f1ccd4ac11e65ddd468851b7a695e3d08eb7650db13dceba1c132` |
| `workmesh-box.cdx.json`    | `733ffccb08b5223adab8ef95076d02b28b66a8bf05a87d3284cdde5c6e1e93d8` |
| `workmesh-cli.cdx.json`    | `294df757405ca014e6e4ff1614a3f83d1288f8dd3561ac25d6fdbb53db1a3516` |

扫描使用同一固定 Syft 1.57.0，最终证据在本机 `G:/workmesh-shared-ip-validation-20261107-r1/artifact-scan/evidence-final/`。`evidence/` 是较早一次扫描结果；其生成过程尚未加入验证器源码前后哈希绑定，不当作本轮最终证据。最终扫描前后验证扫描脚本、bundle helper/verifier、schema validator 与四份 schema 哈希未变化；manifest 的 `evidenceTools`、`schemaValidation` 和 `bundleEvidence` 记录各证据来源与范围。Box 与独立 CLI 继续按实际 ZIP 分别扫描，内嵌 CLI 与独立输入哈希相同。

三份归档内 CLI/Web 侧车经严格结构与实际文件集合/大小/SHA256 校验后，以独立 JSON 复制到扫描输出并绑定相应 ZIP 哈希。CLI 有 35 条直接 rendered 记录与 105 条 shared 预打包候选，Web 有 135 条直接 rendered、1549 条未 rendered 和 105 条预打包候选、3 条虚拟记录；这些是图中记录次数，不是唯一运行依赖数。预打包候选不保证进入最终 bundle，图完整性仍依赖可信构建 hook，校验器不能仅从最终字节独立重建图。Syft 本身仍只为独立 CLI 识别 Node 一条 component；补充图没有伪装成 Syft 已识别的 npm 记录，也尚未自动合并为完整 CycloneDX。

[离线校验器](../../scripts/validate-cyclonedx.mjs)使用固定官方提交的四份 CycloneDX 1.7 draft-07 schema，全部引用离线解析；校验两份最终实际扫描文档均通过。官方源、Apache-2.0 文本、文件 SHA256 和更新方法见[固定 schema 说明](../../scripts/vendor/cyclonedx-1.7/README.md)。17 项 schema 回归、45 项 bundle 回归合计 62 项通过；原扫描函数 30 项防护仍通过。缺引用、缺指针、未知格式、错误 schema、非 1.7 文档和无效文档均返回非零。IRI/国际邮箱为语法检查，不验证 DNS、邮箱存在或网络可达性；通过也不证明组件覆盖或许可完整。工作流原工作区生产清单为 1.5，不在此 1.7 校验范围。

同一 Box SHA 的完整本机生命周期再次为 PASSED：20 项迁移、四阶段 API/代理/Web 健康、55 张表含验证标记、备份恢复标记一致、自有服务安全停止。summary SHA256 为 `b7da763e09d1be5ed7977d702f5dc05eba7444feb4ca9144abc7db83e07dc4cf`，dump 为 `e4dc6be4fe0f51b574c483d64f31bbbcb4ae9e8c2849540304183c30249eb983`。没有旧版本升级、卸载、新机、远端 CI、生产或最终 clean SHA 证据。

## 输出、隐私处理与本地证据

输出包括 `workmesh-box.syft.json`、`workmesh-box.cdx.json`、`workmesh-cli.syft.json`、`workmesh-cli.cdx.json`、`artifact-sbom-draft.json`、`artifact-sbom.syft.yaml` 和 `SHA256SUMS.txt`。最终扫描后已核对输出校验和、配置文件名及配置哈希。

Syft JSON 是归一化后的证据文件：扫描源目录改为 `.`，未使用的 Go/Maven 主机默认缓存路径改为 `<unused-host-default>`。manifest 记录归一化字段和原扫描器输出 SHA256，保留以制品根目录为基准的 POSIX 证据路径；遍历 JSON 字符串检查剩余的 Windows 盘符和 UNC 根路径。CycloneDX 增加了草稿与覆盖限制属性。这些输出不能称为未经修改的扫描器原文。

`workmesh-box.scan.log`、`workmesh-cli.scan.log` 是私有诊断日志，可能含本机路径，不应附加到公开 Release。若只选择公开 JSON/YAML 文件，发布校验和应按实际公开文件集合重新生成。

最终成功证据位于本机 `G:/workmesh-artifact-sbom-validation-20261107-0140/evidence-final2`，执行日志为 `G:/workmesh-artifact-sbom-validation-20261107-0140/validation-final2.log`；同目录的 `box`、`cli` 保留了扫描输入。原 Box ZIP 位于仓库本地忽略目录 `.tmp/box-release-validation-20261106-212834/workmesh-box-win-x64.zip`。这些路径是本地复核位置，不是已提交的证据归档或公开下载地址。

后续 production ZIP 的扫描证据位于 `G:/workmesh-login-validation-20261107-r1/artifact-scan/evidence/`，manifest 记录本轮精确输入与归一化字段；对应新归档位于同一验证根目录的 `package2/`，生命周期结果为 `lifecycle/summary.json`。这些也只是本机证据位置。`scan.log` 即使本次为空，仍作为私有诊断日志保留，不加入公开 Release；公开校验和必须按实际公开资产重新计算。

## 复现

使用 PowerShell 7 和上表固定的 Windows AMD64 Syft 分发包。以下输入路径是示例，须替换为实际待验证 ZIP 与已校验的 `syft.exe`。每次使用全新的扫描根目录；`OutputDir` 必须不存在，且不得与 ZIP 或解压根目录重叠。不要在扫描期间修改输入。

```powershell
$boxZip = (Resolve-Path 'C:\release-input\workmesh-box-win-x64.zip').Path
$cliZip = (Resolve-Path 'C:\release-input\workmesh-cli-win-x64.zip').Path
$syftExe = (Resolve-Path 'C:\tools\syft-1.57.0\syft.exe').Path
$validationRoot = Join-Path $env:TEMP ('workmesh-sbom-' + [guid]::NewGuid().ToString('N'))
$boxRoot = Join-Path $validationRoot 'box'
$cliRoot = Join-Path $validationRoot 'cli'
$outputDir = Join-Path $validationRoot 'evidence'
New-Item -ItemType Directory -Path $validationRoot | Out-Null
Expand-Archive -LiteralPath $boxZip -DestinationPath $boxRoot
Expand-Archive -LiteralPath $cliZip -DestinationPath $cliRoot

pwsh -NoProfile -File scripts/release-artifact-sbom.ps1 `
  -SyftExe $syftExe `
  -BoxRoot $boxRoot `
  -CliRoot $cliRoot `
  -BoxZip $boxZip `
  -CliZip $cliZip `
  -OutputDir $outputDir `
  -Version '1.0.0' `
  -Commit '1fd1635693a77e4b66b0e06818f553719872f494' `
  -SourceTreeState dirty
```

版本、commit 和工作树状态参数应填写实际来源信息；上述值仅用于解释本次快照。不得仅更改参数就把 dirty 制品声明为干净来源。辅助函数检查可以单独执行：

```powershell
pwsh -NoProfile -File scripts/release-artifact-sbom.test.ps1
```

## 尚未满足的发布要求

1. 后续 `239abf…` 已将直接 rendered 的固定版本/PURL 证据保守合并到 CycloneDX；继续补齐虚拟模块及预打包候选的最终归因，复核完整图及依赖关系。不能把这次部分合并或工作区 lockfile 当作完整包含证据。
2. 后续包已附带实际 Node.js 分发 LICENSE 和 PostgreSQL 供应方通知；仍需为运行时及其原生组件补齐供应方 SBOM、源码与完整许可证据。PE 版本记录及供应方总通知不足以逐一枚举和归属所有内嵌组件。
3. 继续处理 23 条 UNKNOWN 的精确版本、重复组件、依赖关系与许可完整性。[分类核查](artifact-unknown-classification-2026-11-07.md)区分 18 条 npm 子路径父包关联与 5 条二进制未知版本；父包版本不能替代二进制版本，附加说明不改写原扫描。
4. 对最终发布及后续合并后的文档继续执行严格 schema 校验。本轮两份实际 Syft 1.7 文档已通过，不能把这一结构门禁扩大为整体 SBOM 完整性或许可证审查已通过。
5. 合并缺失的组件证据，完成依赖公告处置，并对最终发布 SHA 重新构建、扫描和核对校验和。上述缺口关闭前，保持 `DRAFT_PARTIAL_COVERAGE` 状态。

## 质量门禁修正后新 ZIP 的独立扫描（96d555，2026-11-07）

本段仅追加本机 `G:/workmesh-quality-validation-20261107-r2/` 的新制品结果，不替换前文各轮输入和历史结论。主任务在质量门禁修正及依赖处置后重新提供实际 ZIP；本轮扫描重新读取这两个 ZIP，并使用全新 `artifact-scan/box/`、`artifact-scan/cli/` 和 `artifact-scan/evidence/`。版本仍为 `1.0.0`，源声明仍为 `739367a714097a825b96ca7ecf6bce3372855a77` 加 `dirty`；这些字段是调用者声明，不能作为干净构建或来源证明。扫描 manifest 生成于 `2026-11-07T02:50:24.6352140Z`。

| 制品             |  ZIP 字节数 | component 记录 | npm 记录 | UNKNOWN 记录 | 精确核对 ZIP 文件 |  解压字节数 |
| ---------------- | ----------: | -------------: | -------: | -----------: | ----------------: | ----------: |
| Windows Box      | 197,865,930 |            276 |      160 |           23 |            12,491 | 493,136,681 |
| 独立 Windows CLI |  36,718,187 |              1 |        0 |            0 |                74 |  96,094,848 |

| 新输入或证据               | SHA256                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| Box ZIP                    | `96d555cd90526eee9b3ad6aaf541fdb2d1bbb604d6b155c26f3e1a70b24ec49e` |
| 独立 CLI ZIP               | `f7c1ed041b90c51be34028a56ad2c757c8190c3941e14bbd923463552632ae30` |
| `artifact-sbom-draft.json` | `1fa18dc4c0eb507768218589650e70b2db9acf7a8d333ef5f1c1dd3da73ad874` |
| `workmesh-box.syft.json`   | `1e07ed75ec2f56e0b6c23a99b39dbe01551e8d46ff2b57c796eea336b7110f8d` |
| `workmesh-cli.syft.json`   | `156cf7a118198987d073177d1abaf6b487ae841742d5bca213f36ce7adb20d32` |
| `workmesh-box.cdx.json`    | `2b9107dcf4bf3582276993db75e64b9c78aba2f3ff2d78ea2bf4acb87e1c3cf8` |
| `workmesh-cli.cdx.json`    | `edd5c276773139272610e29ffd0c0e7c6121b6e2061e6e02dca31298f2f737ae` |

本轮再次验证固定 Syft `1.57.0` 的可执行文件 SHA256 为 `66327bc7261636c1a5d4214b40a5890b7845484fa5bc36f8515bfbb203e13476`，使用前述相同配置与上游版本/平台绑定。扫描前后核对完整 ZIP 文件集合、长度和逐文件 SHA256；Box 内 `downloads/workmesh-cli-win-x64.zip` 与独立 CLI 输入的哈希相同，两者分别扫描。三处 CLI/Web 侧车校验和两份实际 CycloneDX 1.7 离线 schema/格式校验均通过，manifest 同时记录扫描脚本、bundle helper/verifier、schema validator 与四份 schema 的稳定哈希。独立 CLI 仍只识别到 `Node.js@24.22.1` 一条 binary，0 个 npm 记录不能理解为没有第三方 JavaScript。

新 CLI 侧车 SHA256 为 `be78451290bbc469ff74b206d946f995611672c7556715672cf06738a602191f`，Web 为 `19a9772b62069e090b7064481b179e2ec4e5d736653b3b55db1d38370fae91e9`，均与前一轮不同。CLI 图仍为 2 个输出、8 条组件元数据、35 条 rendered、105 条预打包候选；Web 为 49 个输出、16 条组件元数据、135 条 rendered、1,549 条未 rendered、105 条候选、3 条虚拟记录；三处 opaque 均为 0。它们是模块图记录，不是唯一运行依赖数，候选不证明最终包含。详细绑定见[bundle 新包验证](bundle-evidence-validation-2026-11-07.md#质量门禁修正后新-zip-的模块证据96d5552026-11-07)。

本轮 Node bundle/schema 回归 **62/62**、PowerShell scanner 防护 **30/30** 均通过。扫描完成后另逐条重算 `SHA256SUMS.txt` 的全部 11 个条目，与输出目录实际文件集合一致（校验和文件自身除外）。该本地集合包含两个私有 `*.scan.log`，不能将它原样当作公开 Release 资产清单；公开发布须排除私有日志后按实际资产集合重新生成校验和。`artifact-scan-command.log`、`artifact-guard-regression.log`、`artifact-scanner-guards.log` 也仅作为本机诊断证据。

另直接读取新 Syft JSON 并从三个实际 ZIP 复核 UNKNOWN：仍为 18 条 npm 子路径、5 条 binary；23 条许可字段为空，5 条 binary 版本资源为 null。23 个主证据文件加 11 个支持文件，分别核对各轮 ZIP entry 与其实际解压文件，共 **102 次**长度/SHA256 比较通过；34 个选定文件跨三轮字节相同，名称/类型/路径集合及 23 个 ID 均稳定。该结果仅覆盖选定文件，不能解释为三轮 ZIP 整体相同，详见[UNKNOWN 新包复核](artifact-unknown-classification-2026-11-07.md#质量门禁修正后新-box-的三轮复核96d5552026-11-07)。

只读复核同一新 Box SHA 的 `lifecycle/summary.json` 为 **PASSED**，SHA256 为 `81358bac078e5c762a56c4a94305c9397d47ec4778834aa728e06036d1b4cce5`，完成于 `2026-11-07T02:46:59.5686985Z`。记录 20 项迁移，首次/冷/重复/恢复库四阶段 API 和代理 `ok`、Web 200，55 张表含验证标记，恢复标记一致、验证库已移除、自有服务已停止；summary 记录 dump SHA256 为 `bdc59af6da6d73b725a8b53c944f3763ba646c42b446fe6a001425b438f71ce0`，此处未另行定位或重算 dump。没有重新运行生命周期，也未增加新机、旧版升级、卸载、远端 CI 或最终 clean SHA 证据。

**本轮状态仍为 `DRAFT_PARTIAL_COVERAGE`，模块证据仍为 `PARTIAL_MODULE_EVIDENCE`。** schema、文件哈希、选定 UNKNOWN 字节相同和生命周期通过，均不能证明完整组件覆盖、原生供应方来源或许可证/NOTICE 义务已完成。

## 基线修正后最终 ZIP 的独立复核（554eae，2026-11-07）

本段追加本机 `G:/workmesh-baseline-package-validation-20261107-r2/` 的最终制品，不替换前述历史结果。Box 位于 `package/workmesh-box-win-x64.zip`，独立 CLI 位于 `package/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip`，扫描证据位于 `artifact-scan/evidence/`。manifest 生成于 `2026-11-07T03:52:31.3724451Z`，声明版本 `1.0.0`、commit `739367a714097a825b96ca7ecf6bce3372855a77` 和 `dirty`。这些是本地位置和调用者声明，不是公开下载地址或干净构建来源证明。

构建比较限定为 `G:/workmesh-box-validation-20261106-212834/source` 中打包时冻结快照与实际 ZIP。冻结后工作树另有四份 `tasks` 文件并行编辑，保留原样，未包含在本轮包或验证中。主任务的 699 个构建输入一致记录也仅对应打包时冻结快照；本段没有独立重验全部 699 项，不声明现在整个工作树与包一致。

| 制品             |  ZIP 字节数 | Syft artifact 记录 | npm 记录 | UNKNOWN 记录 | ZIP 文件数 |  解压字节数 |
| ---------------- | ----------: | -----------------: | -------: | -----------: | ---------: | ----------: |
| Windows Box      | 197,882,772 |                276 |      160 |           23 |     12,497 | 493,217,411 |
| 独立 Windows CLI |  36,718,185 |                  1 |        0 |            0 |         74 |  96,094,848 |

| 最终输入或证据             | SHA256                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| Box ZIP                    | `554eae8b559c33f2cf771fae36eb4163aaca1c2bd976287da1c302e3c9035c6e` |
| 独立 CLI ZIP               | `6c5bd81bd745971856337aff6febe0e76a431857714ba0f47db6fb24f56f1780` |
| `artifact-sbom-draft.json` | `b99fc423b20a665c8cdb54c9552a054441fe6d930e8dfb5c331d7924413ec4c5` |
| `workmesh-box.syft.json`   | `81670c7c328d8d1fd7323f4bb9a336320bf091e14d05c3856bec75cecefca489` |
| `workmesh-cli.syft.json`   | `0408bde8e84431132fd5dbe6fdf838ca6c716249604d5d148eaef4a28b5417a6` |
| `workmesh-box.cdx.json`    | `02e8a7a9c5b8af4ad7d466f3bb359451efbbd4805d42cc02b9d4c568df3e62bb` |
| `workmesh-cli.cdx.json`    | `76fc58363d3ef2da2d0b2f8f27466de592e4246bce85ee43883858f59fa719fc` |
| `SHA256SUMS.txt`           | `d99b563adcb7d87f7162e2c6f73adc3fb8141b45b0441ff43fd3adca9c5d4798` |

两个实际 ZIP 的字节数、SHA256、中央目录文件数及展开字节均已独立重算，与 manifest 一致。直接读取 Box 内嵌 CLI ZIP 的哈希也与独立 CLI 相同。扫描脚本记录扫描前后全文件集合、大小及逐文件 SHA256 绑定；独立复核另从 ZIP 流选取 60 个 Box 条目与扫描和生命周期解压文件比较，其中 59 个构建文件与冻结输出比较，全部一致，未独立重做全部 12,497 文件哈希。具体范围见[bundle 最终复核](bundle-evidence-validation-2026-11-07.md#基线修正后最终-zip-的模块与构建绑定554eae2026-11-07)。

固定 Syft 仍为 `1.57.0` / `windows/amd64` / commit `30f4bce762f31136e055f2965185f12eb95fbe47`。重新下载后实际 `tools/syft/syft.exe` 为 89,307,136 字节，独立重算 SHA256 为 `66327bc7261636c1a5d4214b40a5890b7845484fa5bc36f8515bfbb203e13476`；分发 ZIP 为 30,253,627 字节，独立重算为 `06e9663e55f7f38ff966710670fbe0763182c621f7ac2f191bcb209a6dfbd969`。配置哈希仍为 `99d29c8ce7064fac8ec7393e3ad851433ede5b6ebe6dadf404873ba993e22ee7`。

主任务执行报告说明首次扫描因隔离副本缺少 `scripts/validate-cyclonedx.mjs` 失败，随后从含完整工具的工作区重新运行成功。独立检查确认隔离副本保留的路径没有该文件、工作区存在；首次 `artifact-scan-command.log` 为 0 字节，没有保存具体报错，不能由空日志独立证明失败原因。最终 `artifact-scan-command-final.log` 含两份 schema PASS 和完成记录，SHA256 为 `892ff5078ff3e1d4ab650df07a5deab4d45893420184e17a4323618bce1def3e`；失败尝试不计为通过。

独立复核重算 `SHA256SUMS.txt` 全部 11 项，与实际精确文件集合一致，校验和自身除外。manifest 的 8 项 `evidenceTools` 哈希与复核时读取的扫描脚本、helper/verifier、schema validator 和四份 schema 一致。独立再次运行三处实际解压目录的 bundle 校验与两份实际 CycloneDX 的离线 schema/格式校验，全部通过；没有新运行前轮 62 项 Node 回归或 30 项 PowerShell 防护。两个空 `*.scan.log` 仍按私有日志处理，本地校验集合不能原样作为公开 Release 资产清单。

Box CycloneDX 1.7 的 `components` 总数为 **12,773 = 276 个非 file + 12,497 个 file**；独立 CLI 为 **75 = 1 个非 file + 74 个 file**，不能与 Syft artifact 数混用。Syft 源路径已归一化为 `.`，CycloneDX 保留 `DRAFT_PARTIAL_COVERAGE`，均非未经处理的原始扫描输出。CLI 只识别一条 Node.js binary，0 个 npm 不能解释为没有第三方 JavaScript。

本轮 Box JSON 重新统计为 18 条 npm 子路径和 5 条 binary UNKNOWN，23 条许可数组均为空。本轮没有重验完整 23 个 ID、34 个支持文件跨轮字节或前轮 102 次条目比较；前轮结论保留原范围。三份实际 bundle 侧车仍为 `PARTIAL_MODULE_EVIDENCE`：候选不证明最终包含，workspace 包许可继续 UNKNOWN，opaque 为 0 不证明图完整。

同一 Box SHA 的 `lifecycle/summary.json` 只读复核为 **PASSED**，SHA256 为 `28d68dc79bb0e6a52e3251aade4fa75430b9ade77ea7cc214884cacea526cc7e`，完成于 `2026-11-07T03:48:58.7451937Z`。记录 20 项迁移、首次/冷/重复/恢复库四阶段 API 与代理 `ok`、Web 200、55 张表含标记、恢复标记一致、验证库移除与自有服务停止。本轮另定位实际 `lifecycle/data/backups/20261107-114842/db.sql`，310,172 字节，独立重算 SHA256 为 `0769cd96ecb59077d2f62de3204b81a7e790d7bc1ac569db70c0584be8014c7d`，匹配 summary 和备份验证 capture；SQL 标记与 final-stop capture 也已只读核对。本轮未重跑生命周期、启动服务或连接数据库，停止状态指该次检查完成时。

本轮未发现使上述字节绑定、schema 或生命周期记录失效的矛盾，整体仍为 **`DRAFT_PARTIAL_COVERAGE`**。原生供应方 SBOM、UNKNOWN 精确版本、许可证/NOTICE、候选最终归因、完整 CycloneDX 合并及最终 clean SHA 来源仍开放；没有增加新机、旧版升级、卸载、跨平台、生产数据、容量或远端 CI 验收证据。

## 许可证补齐后实际 ZIP 与保守合并（239abf，2026-11-07）

本节追加 `G:/workmesh-license-package-validation-20261107-r2/` 的实际新包、生命周期和修复后扫描，前文各轮历史保持原范围。打包输入来自 `G:/workmesh-verify-validation-20261107-r1/source` 当时冻结的构建输出；无缓存构建 6/6 及 shared/CLI/Web bundle 校验通过后，以 `-SkipBuild` 打包。声明版本 `1.0.0`、源 commit `739367a714097a825b96ca7ecf6bce3372855a77` 和 dirty 工作树，均不是干净来源证明。本批次不包含冻结后继续修改的 release 安全联动和 knowledge reviewer 批量查询，也不证明现在整个工作树或完整 `pnpm verify` 已通过。

打包宿主为官方 Node.js 20.19.0 / pnpm 10.28.2；包内 Node.js 24.22.1 改用官方分发可执行文件，SHA256 `d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5`，附带同一分发的 LICENSE。PostgreSQL 17.11 来自 `G:/yesgoo/workmesh/.tmp/pgclient/pgsql`；保留原 ZIP SHA256 `6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`，其 1512 个已绑定运行时文件逐项复核，并校验供应方通知。此为保留的本地分发与原归档字节绑定，不提升为本轮远端供应方签名验证。

`package-inputs-before.json` 与 `package-inputs-after.json` 的 925 个源码、构建、迁移、生成 client、角色包和补充许可输入完全相同，SHA256 均为 `9a0166b1440403628ad6161c51304c6d422d7fb218e9efb28d5cdcde55c2beda`。`runtime-inputs-before.json` 与 `runtime-inputs-after.json` 的 1567 个运行时及通知输入也相同，SHA256 均为 `69c6cd159387d558b2030d6253d6c3c4ed0e59b9a67be41ecab22f51c6fbac3b`。清单是选定打包输入的绑定，不覆盖后续源码变更或可复现构建来源。

| 实际制品         |  ZIP 字节数 | Syft artifact 记录 | npm 记录 | UNKNOWN 记录 | ZIP 文件数 |  解压字节数 |
| ---------------- | ----------: | -----------------: | -------: | -----------: | ---------: | ----------: |
| Windows Box      | 198,284,290 |                276 |      160 |           23 |     12,657 | 494,846,773 |
| 独立 Windows CLI |  36,764,850 |                  1 |        0 |            0 |         86 |  96,474,384 |

| 输入或成功证据                              | SHA256                                                              |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Box ZIP                                     | `239abf9b446ae04823a362f17088fe42699d61300c627704f73752046ef2d9aa`  |
| 独立 CLI ZIP                                | `d0ccfeaa4f0f50e91f8bab33f7bb4fbbe5ad793ba8db7ebe509a3e74d06df7ed`  |
| `artifact-sbom-r2/artifact-sbom-draft.json` | `614380e0d44c2387c609cebf09f38c8167421b84210b60a3aea69c6f19a8ec4b`  |
| `artifact-sbom-r2/workmesh-box.syft.json`   | `a3ddb053b04d97c6d6e71a469636215d3f220ddd74707ad35ff68a8d8dbb647f`  |
| `artifact-sbom-r2/workmesh-cli.syft.json`   | `ea8f36a89938c923dccaaade2a67f1923fb9dc9543fa2ad0438c215e32ef09d3c` |
| `artifact-sbom-r2/workmesh-box.cdx.json`    | `3ea130ddc89e6d0e95850f98dbac3a6dc02d681a71288f72a61b2fd864d0d7e8`  |
| `artifact-sbom-r2/workmesh-cli.cdx.json`    | `ac84021d3a99058c2c39e834650e1d865de8f0e77309155365bfca8e9a9ef1c1`  |
| `artifact-sbom-r2/SHA256SUMS.txt`           | `bf08a50eb0ce078dd3e5d49849e0c41a3caaa107b96ee8cfc6b24de771ce054e`  |
| `scan-r2.log`                               | `51dab02d51dc01aefe7f23eab4e88283cfa0f566137036ed9f9af73775868061`  |
| `zip-license-verification.json`             | `a0c9e35919cfbe459953bfe7bf513fa95cd9fdf7f5f3257c7acb4c90acd1a7cc`  |
| `lifecycle/summary.json`                    | `478bc0f806251567270864061ba5f0cd9b63bf871ff3495af74cb596ff564cc9`  |

实际 ZIP 许可检查退出 0：Box 159 条许可记录、162 次文本引用、148 个唯一文本，CLI 9 条记录、9 次引用、9 个文本。索引没有 `MISSING*` 记录，但仍为 `PARTIAL_COVERAGE`。检查从 ZIP 流校验根 MIT、每个引用文件的长度与 SHA256、精确许可文件集合、51 个 Box / 2 个 CLI bundle 输出，以及 Box 内嵌 CLI ZIP 与独立输入的相等关系。Node 原分发 LICENSE、PostgreSQL 供应方通知、部署后的 shared/role-packages MIT、canvas 精确 revision 的项目 MIT 与 token 原包 README 完整 MIT 段均包含在验证范围；canvas 的项目许可不枚举 Skia、ICU 等原生内嵌组件，详见[许可证分发验证](license-distribution-validation-2026-11-07.md)。

首次实际扫描保存在 `artifact-sbom/` 和 `scan.log`，以非零退出：Box 合并后 schema 已通过，CLI 的单个 bundle 目录字符串在 PowerShell splat 时被展开为字符参数，merger 按安全相对路径契约拒绝。没有跳过 CLI，也未覆盖失败证据。修复数组保留后，对相同 ZIP 和同一对独立解压目录，在全新 `artifact-sbom-r2/` 重扫退出 0；成功 manifest 生成于 `2026-11-07T07:08:16.1990558Z`。固定 Syft 可执行文件、版本、配置与前文一致；成功 manifest 记录生产扫描脚本 SHA256 `47fd8de7a3e28399a88c10e99692dc6186129a006e7a0dca6a1f09496a8a72a4` 及 merger、校验器和 schema 的稳定哈希。扫描前后再次逐文件核对解压目录与 ZIP，未把外层 staging 中额外下载文件当作 ZIP 内容。

[保守合并器](../../scripts/merge-bundle-sbom.mjs)只读取实际输出已重新校验的侧车，选择具有固定有效 npm/workspace 身份、贡献状态为 rendered 且贡献字节大于 0 的直接模块；不遍历预打包候选，不将 virtual/generated 提升为组件，不推断依赖边。CLI 侧车 SHA256 为 `d6ddfc8fb3fb1014712329813e0469f2d1ac1c0b713a1a5ee8d8636fbbd41ac7`，Web 为 `1d0f25d1db0f1f7e7a2ba2822183585edfe1ff1164fdf43d0d82c8411528edd4`，均绑定实际 ZIP 与输出摘要。

| 合并器实际结果 | 新增组件记录 | 匹配已有组件记录 | 直接 rendered 模块记录 | rendered 组件身份 |
| -------------- | -----------: | ---------------: | ---------------------: | ----------------: |
| Box CLI + Web  |            8 |                3 |                    155 |                10 |
| 独立 CLI       |            3 |                0 |                     35 |                 3 |

匹配记录数与唯一 rendered 身份数口径不同，不能相加推导唯一依赖数。最终 Box CycloneDX 为 **12,941 = 12,657 个 file + 116 个 application + 168 个 library**；独立 CLI 为 **90 = 86 个 file + 1 个 application + 3 个 library**。Box library 中 168 条、CLI library 中 3 条带 npm PURL；这些仍是记录，不是去重后的完整运行依赖图。Syft native 统计仍为上表 276 / 1，不能把合并后新增的 bundle 组件写成扫描器自行识别，也不能把 file 计作软件包。原有 `dependencies` 记录各保留 1 条，合并没有补造模块依赖关系。

两份合并后实际 CDX 均通过 CycloneDX 1.7 离线 schema/格式校验；成功目录 `SHA256SUMS.txt` 的全部 11 个输出条目另行重算匹配。归一化与私有日志边界继续适用；本地校验集合含 `*.scan.log`，不是可原样公开的 Release 资产集合。状态仍为 **`DRAFT_PARTIAL_COVERAGE`**，bundle 侧车仍为 **`PARTIAL_MODULE_EVIDENCE`**；Box 仍有 23 条 UNKNOWN，包含 npm 子路径记录和原生 binary，完整身份、许可、原生内嵌组件与候选最终归因仍未由此次合并解决。

同一新 Box ZIP 的生命周期实际退出 0，summary 为 PASSED：专属端口 58430/58431/58432、20 项迁移、首次/冷/重复/恢复库四阶段 API 与代理 ok、Web 200，55 张表含验证标记，备份验证库已移除、恢复标记一致，`ownedServicesStopped=true`。summary 记录 dump SHA256 `1416ac07564c6e2f2d82a1dafc9b9bed0923d284714185a974bf60c7c0119e77`；结束后另复查三个端口无监听。本节没有据 summary 另行重算 dump，不扩大为生产数据恢复证明。

这些本机路径不是公开下载地址。此次实际包、许可文本、文件绑定、schema 与生命周期通过，不满足最终 clean SHA、同源远端 CI、新机、旧版升级、卸载、跨平台、生产容量与稳定性、外部 GitHub 或真实团队验收要求；上述发布门禁继续保留。

## r13 同源完整验证后新制品（2026-11-10）

本批次从 `G:/workmesh-verify-validation-20261109-r13/source` 的 915 文件冻结快照和该快照完整 `pnpm verify -- --apply-migrations` 成功后的实际生产输出，以 `-SkipBuild` 生成全新 `G:/yesgoo/workmesh-validation/20261109-r13/package-r1/`。冻结清单 SHA256 为 `d5f9c6c7afd9e73fd9a2fa85a2cacb1cf07a5c932b22d4921c4cdc7308aa596b`；选定 807 个生产输出与运行时输入的清单为 `63e94f9dc3e3545115e5373fc4070f0bfb9675d4eb3670d958abacf18067ac2e`。打包与生命周期后两类输入复核均退出 0。声明版本 `1.0.0`、源 commit `739367a714097a825b96ca7ecf6bce3372855a77` 加 dirty 快照；不覆盖冻结后的并行工作树编辑，也不证明最终 clean SHA 的来源或远端 CI。

固定 Syft 1.57.0 的可执行文件摘要仍为 `66327bc7261636c1a5d4214b40a5890b7845484fa5bc36f8515bfbb203e13476`，固定配置仍为 `99d29c8ce7064fac8ec7393e3ad851433ede5b6ebe6dadf404873ba993e22ee7`。本次从最终 Box/CLI ZIP 分别新解压到 `scan-inputs-r1/box` 和 `scan-inputs-r1/cli`，未扫描打包后会追加下载文件的 staging，也未复用生命周期解压树。扫描实际执行于 `2026-11-10T09:15:03.3373068Z`–`09:15:53.8095278Z`，退出 0；扫描前后完整文件集合、大小、SHA256 与 ZIP 一致，内嵌 CLI 摘要与独立 CLI 输入一致。

| 实际制品         |  ZIP 字节数 | Syft artifact | npm / binary | UNKNOWN | ZIP 文件数 |  解压字节数 |
| ---------------- | ----------: | ------------: | -----------: | ------: | ---------: | ----------: |
| Windows Box      | 182,814,742 |           276 |    160 / 116 |      23 |     12,679 | 463,718,674 |
| 独立 Windows CLI |  29,047,254 |             1 |        0 / 1 |       0 |         86 |  73,582,027 |

| 输入或证据（均在 `G:/yesgoo/workmesh-validation/20261109-r13/`）     | SHA256                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `package-r1/workmesh-box-win-x64.zip`                                | `09d0d2baf4175a96970be9db3c48879b4ad0887cb480420829f1b53eb6a6c3d3` |
| `package-r1/workmesh-box-win-x64/downloads/workmesh-cli-win-x64.zip` | `7c06512dbc1264e46570e6992bd73a75aa7cc85d72862daae2348b27bd840337` |
| `scan-r1/artifact-sbom-draft.json`                                   | `46a005e63c38afb7d4d2f81f2f3aed5a614b2aa7807d38777806c9374f0e2492` |
| `scan-r1/workmesh-box.syft.json`                                     | `8c8874d94e7add6e928ab0aadb2ee88c8ae89ff89a693718677dffa0cf6e3dbc` |
| `scan-r1/workmesh-cli.syft.json`                                     | `7e6000304295bcad682df6ef55b2fa6ec59de9c5656520848bd9141b22fcb485` |
| `scan-r1/workmesh-box.cdx.json`                                      | `3b672110bc8917afea06058a01e5966e0a1bd4544d2c7d4d0010f746269ec31d` |
| `scan-r1/workmesh-cli.cdx.json`                                      | `e9178f92980f4916bd06baf738f62ca05d373c25927d75723eabb8619014748a` |
| `scan-r1/SHA256SUMS.txt`                                             | `872bd7abb679ac4934032e8e4fda5598448f02b09cb33aff3ede0197c6ebb33c` |
| `lifecycle-r1/summary.json`                                          | `1883acfca14bef015d2fe07fea0d3255a4c47c334d3c372d75a340966943cf0b` |

扫描确认实际包内 Node.js 20.19.0、PostgreSQL 17.11 和 Prisma CLI 5.22.0。两份合并后 CycloneDX 1.7 文档均通过离线 schema 与格式语法校验。Box 保守合并新增 8 个组件、匹配 3 条已有组件，表示 157 条直接 rendered 模块记录与 10 个 rendered 身份；CLI 新增 3 个，表示 36 条模块记录与 3 个身份。最终 Box 为 **12,963 = 12,679 file + 116 application + 168 library**；CLI 为 **90 = 86 file + 1 application + 3 library**，file 不计为软件包。23 条 UNKNOWN 仍为 18 条 npm 子路径和 5 条 binary；没有借用父包或上轮结论改写其版本。

同一 Box SHA 的隔离 Windows 生命周期实际退出 0，`lifecycle-r1/summary.json` 为 PASSED：20 项迁移、首次/冷/重复/恢复库四阶段 API 与 Web 代理 ok、Web 200，备份 55 张表（含验证标记），恢复标记一致、验证库移除、`ownedServicesStopped=true`，完成于 `2026-11-10T09:16:10.7828872Z`。summary 中 dump SHA 为 `3ea850588e87e6b135a80c020e54b9cdeca126b0a94345e8d7003605f38ff972`；本节读取 summary，未另行重跑生命周期或独立复算 dump。

实际许可文本的索引记录为 Box 159 条、CLI 9 条，缺失文本记录均为 0，详见[该批次许可记录](license-distribution-validation-2026-11-07.md#r13-frozen-source-artifacts--2026-11-10)。这不等于机器可读 CDX 的 license 字段齐全：非 file 组件仍有 Box 145 条、CLI 4 条没有 license 数据；也不能据此直接判定法律合规。Node 使用本轮固定官方分发与匹配 LICENSE；PostgreSQL 只保持本地运行时和供应方通知的字节关联，原始下载 URL 与供应方签名仍未独立核实。原生内嵌组件、候选最终归因、完整依赖关系与许可证义务继续开放。

本轮状态继续为 **`DRAFT_PARTIAL_COVERAGE`** / **`PARTIAL_MODULE_EVIDENCE`**。扫描日志及生命周期 data/logs 是私有诊断资料，本地 `SHA256SUMS.txt` 不能直接充当公开资产清单。没有新增新机、旧版升级、卸载、跨平台、生产容量/长时稳定、真实 GitHub、外部团队、最终 clean SHA 或远端 CI 证据；本轮文档本身也在冻结清单之外。
