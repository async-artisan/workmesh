# 制品 SBOM 验证记录：2026-11-07

本次验证已成功生成 Windows Box 与独立 CLI ZIP 的制品清单草稿，状态为 **`DRAFT_PARTIAL_COVERAGE`**。ZIP 文件与扫描目录的一致性验证通过，但 CLI/Web bundle、原生运行时组件与许可、UNKNOWN 条目和完整 CycloneDX schema 验证仍有缺口，本记录不能作为完整 SBOM 或发布验收通过的依据。

## 范围与来源

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

## 实际结果

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

## 输出、隐私处理与本地证据

输出包括 `workmesh-box.syft.json`、`workmesh-box.cdx.json`、`workmesh-cli.syft.json`、`workmesh-cli.cdx.json`、`artifact-sbom-draft.json`、`artifact-sbom.syft.yaml` 和 `SHA256SUMS.txt`。最终扫描后已核对输出校验和、配置文件名及配置哈希。

Syft JSON 是归一化后的证据文件：扫描源目录改为 `.`，未使用的 Go/Maven 主机默认缓存路径改为 `<unused-host-default>`。manifest 记录归一化字段和原扫描器输出 SHA256，保留以制品根目录为基准的 POSIX 证据路径；遍历 JSON 字符串检查剩余的 Windows 盘符和 UNC 根路径。CycloneDX 增加了草稿与覆盖限制属性。这些输出不能称为未经修改的扫描器原文。

`workmesh-box.scan.log`、`workmesh-cli.scan.log` 是私有诊断日志，可能含本机路径，不应附加到公开 Release。若只选择公开 JSON/YAML 文件，发布校验和应按实际公开文件集合重新生成。

最终成功证据位于本机 `G:/workmesh-artifact-sbom-validation-20261107-0140/evidence-final2`，执行日志为 `G:/workmesh-artifact-sbom-validation-20261107-0140/validation-final2.log`；同目录的 `box`、`cli` 保留了扫描输入。原 Box ZIP 位于仓库本地忽略目录 `.tmp/box-release-validation-20261106-212834/workmesh-box-win-x64.zip`。这些路径是本地复核位置，不是已提交的证据归档或公开下载地址。

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

1. 为 CLI/Web 实际 bundle 导出模块图，并映射到固定版本、PURL 与许可信息；不能以工作区 lockfile 扫描替代 bundle 的包含证据。
2. 为嵌入 Node.js、PostgreSQL 及其原生组件补齐供应方 SBOM、源码与许可证据；PE 版本记录不足以枚举运行时的所有组成部分。
3. 逐项审查 37 条 UNKNOWN、npm 子路径和模板记录、重复组件、依赖关系与许可完整性，保留有依据的修正记录。
4. 对最终输出执行完整 CycloneDX schema 验证；本次仅验证 JSON 结构和必要组件，尚未执行完整 schema 校验。
5. 合并缺失的组件证据，完成依赖公告处置，并对最终发布 SHA 重新构建、扫描和核对校验和。上述缺口关闭前，保持 `DRAFT_PARTIAL_COVERAGE` 状态。
