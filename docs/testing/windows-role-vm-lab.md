# 六角色 Windows 虚拟机实验室

物理 Windows 继续部署 WorkMesh，六个角色各使用一台独立 Windows 11 Hyper-V 客户机。六台均已安装 Windows 11 企业评估版并完成本地账号配置，卸下安装介质后的冷启动和账号认证验收 **6/6 通过**。当前六台均已正常关机；WorkMesh 客户机网络接入和平台角色授权尚未配置。

| 业务角色 | 虚拟机名称               | Windows 账号 | CPU / 内存       | 系统盘           |
| -------- | ------------------------ | ------------ | ---------------- | ---------------- |
| 产品     | workmesh-client-product  | wm01         | 2 vCPU / 4–8 GiB | 80 GiB 动态 VHDX |
| UI       | workmesh-client-ui       | wm02         | 2 vCPU / 4–8 GiB | 80 GiB 动态 VHDX |
| 前端     | workmesh-client-frontend | wm03         | 2 vCPU / 4–8 GiB | 80 GiB 动态 VHDX |
| 后端     | workmesh-client-backend  | wm04         | 2 vCPU / 4–8 GiB | 80 GiB 动态 VHDX |
| 测试     | workmesh-client-qa       | wm05         | 2 vCPU / 4–8 GiB | 80 GiB 动态 VHDX |
| 运维     | workmesh-client-ops      | wm06         | 2 vCPU / 4–8 GiB | 80 GiB 动态 VHDX |

六台 VM 关闭自动启动及自动检查点；配置、系统盘、检查点路径、Smart Paging 和安装镜像均放在 G 盘实验室目录。计算机名分别为 wm-product、wm-ui、wm-frontend、wm-backend、wm-qa、wm-ops。验收结束时六台均为关机状态、系统盘首选启动、安装及应答 DVD 全部卸下；之后的实时电源状态以状态检查结果为准。

## 当前实测状态

2026-11-07，物理宿主为 Windows 11 专业版，31.9 GiB RAM、16 个逻辑处理器。用户已释放 C 盘空间并手动重启；重启后 Hyper-V 管理模块可用，vmms 与 vmcompute 服务正在运行，已清除本次组件启用的待重启标记。六台第二代 VM 的 UUID、名称和独立 VHDX 路径已核验，均配置 2 vCPU、4–8 GiB 动态内存、80 GiB 动态系统盘、Secure Boot、独立虚拟 TPM 和 Default Switch。硬件核验记录为 G:\workmesh-vm-lab\vm-verification.json，成功创建记录为 vm-create-recovery-result.json；较早的失败日志保留用于排查。

物理宿主上的 WorkMesh 已恢复：Web http://127.0.0.1:5173/、API http://127.0.0.1:3000/api/health 和就绪端点 http://127.0.0.1:3000/api/health/ready 均返回 HTTP 200；就绪检查确认数据库可达。通过 Web 的 /api/health 和 /api/health/ready 代理同样可用。上述结果证明宿主本地平台可用，客户机到宿主 WorkMesh 的网络和应用连通尚未配置或验收。

用户最初选择自动安装至 Windows 首次设置阶段（OOBE），随后进一步授权按顺序设置账号。product、ui、frontend、backend、qa、ops 分别使用 wm01、wm02、wm03、wm04、wm05、wm06，各账号已设置独立强随机密码。凭据保存在受限 NTFS ACL 文件 G:\workmesh-vm-lab\secure-answer-20261107T022249268Z-6b6b7c96d99a4c0a9847a794b2ab3643\credentials.json 中；文档不包含密码，启动器也不会读取凭据。

最终 Windows 与账号验收 **6/6 通过**：六台均在安装及应答 DVD 全部卸下后，从独立系统盘冷启动，并使用对应账号及真实密码通过 PowerShell Direct 认证。确认六台计算机名正确、账号启用、ImageState=IMAGE_STATE_COMPLETE、Secure Boot=true、TpmPresent=true、TpmReady=true；六个 MachineGuid 和 AccountSID 均相互独立。系统为 Windows 11 企业评估版，版本 10.0.26300。验收后六台均已正常关机。此处验证的是 Windows 安装、本地账号认证和独立机器身份；PowerShell Direct 不依赖客户机网络，因此不代表 WorkMesh 网络或角色接入已完成。

最终冷启动证据为 G:\workmesh-vm-lab\cold-boot-acceptance.json，其中 Success=true，Stage=SixWindowsColdBootAndAccountAuthenticationVerified。此前各批次的 `account-verification-*.json`、`finalize-*.json` 和 status 目录中的报告与截图保留用于追溯。

官方中文 Windows 11 Enterprise 评估 ISO 已完整下载，文件长度 8548628480 字节，来源和本地 SHA256 保存在相邻 JSON 中。默认计划、六角色映射、PowerShell 5.1 解析、WhatIf 零创建及前置失败零创建检查均已通过。G:\workmesh-vm-lab\plan.json 是创建前的计划快照，创建后的硬件状态应查看 vm-verification.json 和最新状态报告。

准备脚本要求 C 盘至少空闲 15 GiB；这是实验室脚本的安全裕量，本机创建时已满足，空间会随运行和更新变化。独立运行的脚本不会删除文件、自动提权或自动重启。Hyper-V 启用记录保存在 G:\workmesh-vm-lab\hyperv-enable-result.json 和相邻 hyperv-enable.log；该历史记录中的 RestartNeeded=True 已由本次手动重启处理。Hyper-V 查询和管理命令仍需管理员 Windows PowerShell。

32 GiB 宿主应先同时运行最多两台客户机，为物理宿主和平台保留内存。六台客户机仅最低启动内存就需要 24 GiB，安装更新和 Agent 工作负载会继续增长。动态盘不会在创建时预占全部空间，但六块盘的逻辑容量合计 480 GiB，超过目前 G 盘空闲空间；必须监控实际占用。

## 1. 查看主机与创建计划

以下两个命令默认只读，不下载镜像、不启用组件、不创建虚拟机：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\prepare-workmesh-vm-host.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\new-workmesh-lab.ps1 -Json
```

## 2. 安装镜像和 Hyper-V（本机已完成）

可使用已有合法 Windows 11 x64 安装 ISO。准备脚本也提供微软官方中文 Windows 11 Enterprise 评估镜像的断点续传下载，约 8.55 GB：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\prepare-workmesh-vm-host.ps1 -DownloadIso
```

下载位置为 G:\workmesh-vm-lab\images\windows-11-enterprise-eval-zh-cn-x64.iso。下载中断时保留 .partial 和来源记录，重复同一命令续传；已完成的 ISO 不会覆盖。附带 JSON 中的 SHA256 只是本地文件指纹，不表示已与微软发布的校验和独立比对。镜像来自[微软评估中心](https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise)，实际安装时阅读并确认适用的评估期限和许可条件。下载不等于安装或许可接受。

首次准备其他符合条件的宿主时，释放系统盘空间后，在**管理员 Windows PowerShell**运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\prepare-workmesh-vm-host.ps1 -EnableHyperV
```

此命令使用 -NoRestart。若返回 RestartNeeded=True，保存工作后自行重启，再进行创建。本机已完成此步骤。

## 3. 首次创建六台 Windows 虚拟机（本机已完成）

以下是首次创建流程。本机六个名称和目录均已存在，不应再次运行 -Apply；查询当前状态使用下一节的检查工具。首次在新实验室创建时，在管理员 PowerShell 先预览，再应用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\new-workmesh-lab.ps1 -WindowsIso G:\workmesh-vm-lab\images\windows-11-enterprise-eval-zh-cn-x64.iso -Json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\new-workmesh-lab.ps1 -WindowsIso G:\workmesh-vm-lab\images\windows-11-enterprise-eval-zh-cn-x64.iso -Apply
```

默认复用 Hyper-V 的 Default Switch，不自动改动宿主网卡。若已有其他合适的交换机，用 -SwitchName 指定其完整名称；缺少交换机时脚本失败，不会偷偷创建外部交换机。

创建脚本要求所有预检通过后才创建资源；同名 VM 或已存在的目标目录会导致拒绝，避免覆盖。成功时在 G:\workmesh-vm-lab 写入 provision-*.json。中途失败保留现场和清单，不会自动删除已创建资源；检查后再处理，不能盲目重复 -Apply。

## 4. 安装记录与日常启动

本次使用微软官方安装 ISO 和每角色独立的第二张只读应答 ISO。产品客户机的首版应答文件只设置中文区域、UEFI 分区、映像索引和唯一计算机名，随后在原安装上完成 wm01 账号配置；其余客户机在用户授权后使用包含相应账号配置的新应答文件。不得为更换应答文件对已有系统重新清盘。Windows 版本仍可能要求网络、组织登录、隐私或更新操作。评估镜像受其许可条件和评估期限约束。

本次现场文件位于 G:\workmesh-vm-lab：

- prepare-answer-media.ps1：生成各角色的 Autounattend.xml 和应答介质。
- answer-media-20261107-101542\manifest.json：首版无凭据应答 ISO 的角色、计算机名、路径与 SHA256；包含账号的新版本应另存清单，并以实际安装记录为准。
- start-guest-install.ps1：核对已记录的 VM UUID、单系统盘路径和空盘状态后启动指定客户机的安装；重复安装由尝试标记和磁盘大小检查阻止。
- status\status-*.json 及同目录 PNG：安装期间的只读状态和屏幕证据。

这些现场文件绑定本次实验室和空盘安装阶段。已有安装进度时，应先查状态，不能重新套用清盘应答文件。包含密码的 XML、ISO 和凭据清单均按明文凭据保护，并限制 NTFS 访问权限；不得把它们提交到仓库或写进日志。安装分区为 EFI 300 MB、MSR 16 MB 和其余 NTFS 系统分区；未配置独立 WinRE 分区，恢复功能尚未验证。

仓库工具 scripts\vm\new-answer-iso.ps1 兼容 Windows PowerShell 5.1，默认仅输出计划；-Apply 才把专用源目录打包为非启动 ISO9660/Joliet ISO，并拒绝覆盖已有镜像。此工具只制作介质，不挂载镜像或操作虚拟机。

在**管理员 Windows PowerShell**查看六台当前状态；指定 -OutputDirectory 才保存截图和 JSON，默认仅打印 JSON：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\get-workmesh-lab-status.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\get-workmesh-lab-status.ps1 -Roles product -OutputDirectory G:\workmesh-vm-lab\status
```

该工具同样兼容 PowerShell 5.1，核对记录的六台 UUID、名称和单 VHDX 路径，报告电源状态、心跳、实际磁盘占用、IP 和截图路径；不会启动、停止或重新配置 VM。心跳和 IP 的出现不能单独证明 OOBE 已完成，应结合屏幕确认。

用 Hyper-V 控制台观察指定客户机，或查看已完成安装的产品客户机登录界面：

```powershell
vmconnect.exe localhost workmesh-client-product
```

日常可使用 scripts\vm\open-workmesh-client.ps1。该工具兼容 Windows PowerShell 5.1，默认输出只读 JSON 计划；在管理员 Windows PowerShell 加 -Open 后，才启动指定角色的客户机并打开可见的 VMConnect 控制台：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\open-workmesh-client.ps1 -Role product
powershell.exe -NoProfile -ExecutionPolicy Bypass -File G:\yesgoo\workmesh\scripts\vm\open-workmesh-client.ps1 -Role product -Open
```

-Role 支持 product、ui、frontend、backend、qa、ops。启动前会核对六台记录的 UUID、名称、系统盘路径和宿主可用内存，并限制最多两台活动客户机、保留至少 8 GiB 宿主内存；所选客户机已运行时直接打开控制台。该工具不会自动提权、读取凭据、关闭其他客户机或修改虚拟机配置。

将名称替换为表格中相应 VM 可打开其他角色控制台。只有确认客户机已关机且当前阶段适合继续时，才使用 Start-VM 启动它；无需为查看正在运行的安装重复启动。安装期间每批最多运行两台，前一批完成当前安装和账号步骤并保存验收证据后再切换下一批。按授权设置的 wm01 至 wm06 使用各自独立密码，不使用通用密码；Windows 账号也不能代替 WorkMesh 平台成员和角色授权。

首次从 DVD 进入安装后，安装自动重启时不要再次按键从 DVD 启动，以免重新触发应答文件中的清盘步骤。确认系统盘可启动后，将其设为首选启动设备；确认进入 OOBE 后卸下安装和应答 ISO。日常也先同时运行最多两台，需要第三个角色时正常关闭一台再切换。

## 5. 连接物理宿主上的 WorkMesh

所有客户机连接**同一个项目和平台**，每个角色使用独立普通成员账号和相应业务角色。只在本机 CLI 写 --role 不会授予服务端权限。

当前 CLI 拒绝非 loopback 的 HTTP API；平台 LOCAL_INSECURE 同样只允许 loopback 公共源，因此不能直接使用 http://宿主局域网IP:3000/api/v1。可以选择：

- 长期接入：在物理宿主提供统一 HTTPS 地址，例如 https://workmesh.test；宿主和客户机解析同一名称，信任测试 CA；平台启用 SECURE Cookie 并设置一致的 PUBLIC_ORIGIN/WEB_ORIGIN。Node CLI 也要信任该 CA，例如通过 NODE_EXTRA_CA_CERTS 指定证书。
- 保留当前开发平台：在各 Windows 客户机启用 OpenSSH Server，由物理宿主主动连接客户机并建立下面的 SSH 反向回环隧道。

```powershell
ssh -NT -o ExitOnForwardFailure=yes -R 127.0.0.1:5173:127.0.0.1:5173 <客户机用户>@<客户机IP>
```

隧道运行时，客户机的 http://127.0.0.1:5173 指向物理宿主 Web；Web 的 /api 代理访问物理宿主 API。客户机浏览器使用这一地址，CLI 使用 http://127.0.0.1:5173/api/v1。每台客户机分别建立隧道，不需要暴露数据库；此方式要求宿主 Web 正在 5173 运行，且客户机 5173 空闲。

上述客户机网络方案尚未实施。Windows 冷启动验收仅确认各客户机可正常启动和认证本地账号；未配置到物理宿主 WorkMesh 的访问通道，也未配置客户端 CLI 或平台成员角色。本次主机准备脚本不会更改现有 WorkMesh 的 Cookie、Origin、证书、网络或数据库。

每个客户机取得新的接入码，按[CLI 接入指南](../cli-onboarding.md)完成 init、设备授权、仓库绑定与角色资源安装。使用测试项目，分别验证正确角色可以领取任务、错误角色被拒绝、交付和人工评审能流转。六台的 Windows 安装、网络连通与角色授权全部通过后，才能记录为六角色真实多机验收完成。
