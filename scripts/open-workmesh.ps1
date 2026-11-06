#Requires -Version 5.1
<#
.SYNOPSIS
  桌面「启动 WorkMesh.cmd」双击后调用的启动器：确保 PostgreSQL / API / Web 都在运行，
  然后打开 http://127.0.0.1:5173 。

.DESCRIPTION
  真正的启动逻辑仍在 scripts\dev-local.ps1（端口、日志、进程记录都在那里），这里只做三件事：
    1. 已经就绪就直接开浏览器；
    2. 没就绪就调用 dev-local.ps1 启动（本机 Node 低于 engines 要求时自动加 -SkipNodeCheck）；
    3. 结束后保留窗口，显示入口与停止命令。
#>
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$devLocal = Join-Path $root 'scripts\dev-local.ps1'
$url = 'http://127.0.0.1:5173'

function Wait-Key([string]$message) {
  # 自动化/脚本调用时用 WORKMESH_NO_PAUSE=1 跳过等待；双击运行时正常等待按键。
  if ($env:WORKMESH_NO_PAUSE -eq '1') { return }
  Write-Host ''
  Write-Host $message -ForegroundColor DarkGray
  try {
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  } catch {
    Start-Sleep -Seconds 8
  }
}

Write-Host 'WorkMesh 本地服务' -ForegroundColor Cyan
Write-Host "  仓库 $root" -ForegroundColor DarkGray

if (-not (Test-Path $devLocal)) {
  Write-Host "  [X] 找不到 $devLocal" -ForegroundColor Red
  Wait-Key '按任意键关闭…'
  exit 1
}

# 1. 已经就绪：直接开浏览器
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $devLocal -Check *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host '  服务已在运行，跳过启动。' -ForegroundColor Green
} else {
  # 2. 本机 Node 低于 package.json engines 要求时，按实测可用继续
  $nodeVersion = (& node --version).Trim()
  $nodeTooOld = $false
  if ($nodeVersion -match '^v(\d+)\.(\d+)') {
    $major = [int]$matches[1]
    $minor = [int]$matches[2]
    $nodeTooOld = ($major -lt 20) -or ($major -eq 20 -and $minor -lt 19)
  }
  $extra = @()
  if ($nodeTooOld) {
    Write-Host "  本机 Node $nodeVersion 低于 engines 要求的 20.19，按实测可用继续（-SkipNodeCheck）。" -ForegroundColor Yellow
    $extra = @('-SkipNodeCheck')
  }

  Write-Host '  正在启动 PostgreSQL / API / Web（首次可能要 1-2 分钟）…' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $devLocal @extra
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  [X] 启动失败：看上面的提示，或 .tmp\dev-logs\*.log' -ForegroundColor Red
    Wait-Key '按任意键关闭…'
    exit 1
  }
}

# 3. 打开浏览器并保留窗口
Start-Process $url
Write-Host ''
Write-Host "  已打开 $url" -ForegroundColor Green
Write-Host '  服务在后台运行，这个窗口可以直接关掉。' -ForegroundColor DarkGray
Write-Host "  停止服务：powershell -NoProfile -File `"$devLocal`" -Stop" -ForegroundColor DarkGray
Wait-Key '按任意键关闭…'
exit 0
