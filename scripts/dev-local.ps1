#Requires -Version 5.1
<#
.SYNOPSIS
  本地一键启动 WorkMesh：PostgreSQL -> API -> Web，并打印登录信息。

.DESCRIPTION
  这个脚本只做本机开发环境的事，不涉及部署：
    1. 若 5432 未监听，用 embedded-postgres 启动本机 PostgreSQL（数据目录在 $PgHome\data）；
    2. 若 3000 未监听，启动 @workmesh/api 的 nest watch；
    3. 若 5173 未监听，启动 @workmesh/web 的 vite；
    4. 等 API/Web 真正可访问后再打印入口与演示账号。
  已经在监听的服务会跳过，所以可以反复执行。

  端口不在这里改：API 端口来自 apps/api/.env 的 PORT（@nestjs/config 会用它覆盖环境变量），
  Web 端口来自 apps/web/vite.config.ts 的 server.port。要换端口就改这两处，
  并同步 WORKMESH_PUBLIC_ORIGIN / WEB_ORIGIN，否则 Cookie 与 Origin 校验会挡掉请求。

  注意：不要用 `corepack pnpm`（本机 corepack 的签名校验会失败），也不要用 `pnpm dev`
  （turbo 会把 cli/shared/ui 的 watch 一起拉起来），这里只起 api + web。

.PARAMETER Check
  只检查当前状态，不启动任何进程；全部就绪时退出码 0，否则 1。

.PARAMETER Stop
  停止本脚本启动的进程（记录在 .tmp\dev-logs\pids.json），并收掉 3000/5173 上的 node 监听。

.PARAMETER PgHome
  embedded-postgres 的安装目录，默认 %LOCALAPPDATA%\workmesh-pg。

.EXAMPLE
  powershell -NoProfile -File scripts/dev-local.ps1

.EXAMPLE
  powershell -NoProfile -File scripts/dev-local.ps1 -Check
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Stop,
  [int]$PgPort = 5432,
  [int]$ApiPort = 3000,
  [int]$WebPort = 5173,
  [string]$PgHome = (Join-Path $env:LOCALAPPDATA 'workmesh-pg')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root '.tmp\dev-logs'
$pidFile = Join-Path $logDir 'pids.json'

function Write-Step([string]$message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Ok([string]$message) { Write-Host "  ok  $message" -ForegroundColor Green }
function Write-Warn2([string]$message) { Write-Host "  !   $message" -ForegroundColor Yellow }

function Get-PortOwner([int]$port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $conn) { return $null }
  $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  [pscustomobject]@{
    Port = $port
    Pid  = $conn.OwningProcess
    Name = if ($process) { $process.ProcessName } else { 'unknown' }
  }
}

function Test-PortOpen([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($pending)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-Port([int]$port, [int]$timeoutSec, [string]$what) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen $port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  Write-Warn2 "$what 在 ${timeoutSec}s 内没有监听 $port"
  return $false
}

function Wait-Http([string]$url, [int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
    } catch {
      # 连接被拒 / 还没开始监听，继续等。
    }
    Start-Sleep -Milliseconds 700
  }
  return $false
}

# 只接受真正可能是"我们启动的进程"的记录：系统 pid（<=4）绝不参与。
function Read-StartedPids {
  if (-not (Test-Path $pidFile)) { return @() }
  try {
    $raw = Get-Content $pidFile -Raw | ConvertFrom-Json
  } catch {
    return @()
  }
  return @($raw | Where-Object {
      $_ -and $_.Name -and $_.Pid -and ([int]$_.Pid) -gt 4
    })
}

function Save-StartedPids($entries) {
  $valid = @($entries | Where-Object { $_ -and $_.Name -and $_.Pid -and ([int]$_.Pid) -gt 4 })
  if ($valid.Count -eq 0) { return }
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $valid | ConvertTo-Json -Depth 3 | Set-Content -Path $pidFile -Encoding UTF8
}

function Start-Logged(
  [string]$name,
  [string]$fileName,
  [string]$file,
  [string[]]$arguments,
  [string]$workDir,
  [int]$port = 0
) {
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $log = Join-Path $logDir $fileName
  $process = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workDir `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
  Write-Ok "$name 已启动 (pid $($process.Id))，日志 .tmp\dev-logs\$fileName"
  [pscustomobject]@{ Name = $name; Pid = $process.Id; Port = $port; Log = $log }
}

# pnpm 会再起 cmd/node，真正监听端口的是孙进程，所以按进程树收网。
function Get-ProcessTree([int]$rootPid) {
  $seen = New-Object 'System.Collections.Generic.List[int]'
  if ($rootPid -le 4) { return $seen }
  $queue = New-Object 'System.Collections.Generic.Queue[int]'
  $queue.Enqueue($rootPid)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($current -le 4 -or $seen.Contains($current)) { continue }
    $seen.Add($current)
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$current" -ErrorAction SilentlyContinue |
      ForEach-Object { $queue.Enqueue([int]$_.ProcessId) }
  }
  return $seen
}

# ---------------------------------------------------------------- -Stop

if ($Stop) {
  $entries = Read-StartedPids
  $stoppedAny = $false
  foreach ($entry in $entries) {
    $targets = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($childPid in @(Get-ProcessTree ([int]$entry.Pid))) { [void]$targets.Add($childPid) }
    if ($entry.Port) {
      $owner = Get-PortOwner ([int]$entry.Port)
      if ($owner) { [void]$targets.Add([int]$owner.Pid) }
    }
    $alive = @($targets | Where-Object { $_ -gt 4 -and (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
    if ($alive.Count -eq 0) { continue }
    foreach ($target in $alive) { Stop-Process -Id $target -Force -ErrorAction SilentlyContinue }
    Write-Ok "已停止 $($entry.Name) ($($alive -join ', '))"
    $stoppedAny = $true
  }
  # 记录丢失时也把本脚本负责的两个端口上的 node 实例收掉。
  foreach ($port in @($ApiPort, $WebPort)) {
    $owner = Get-PortOwner $port
    if ($owner -and $owner.Name -eq 'node') {
      Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
      Write-Ok "已停止 $port 上的 node (pid $($owner.Pid))"
      $stoppedAny = $true
    }
  }
  if (-not $stoppedAny) { Write-Warn2 '没有找到本脚本启动的进程' }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  exit 0
}

# ---------------------------------------------------------------- -Check

$pg = Get-PortOwner $PgPort
$api = Get-PortOwner $ApiPort
$web = Get-PortOwner $WebPort

if ($Check) {
  $ready = $true
  Write-Step "本地状态 ($root)"
  if ($pg) { Write-Ok "PostgreSQL 127.0.0.1:$PgPort (pid $($pg.Pid))" } else { Write-Warn2 "PostgreSQL 未启动 ($PgPort)"; $ready = $false }
  if ($api) { Write-Ok "API 127.0.0.1:$ApiPort (pid $($api.Pid))" } else { Write-Warn2 "API 未启动 ($ApiPort)"; $ready = $false }
  if ($web) { Write-Ok "Web 127.0.0.1:$WebPort (pid $($web.Pid))" } else { Write-Warn2 "Web 未启动 ($WebPort)"; $ready = $false }
  if ($api) {
    if (Wait-Http "http://127.0.0.1:$ApiPort/api/health" 10) { Write-Ok 'GET /api/health -> ok' } else { Write-Warn2 '/api/health 不可用'; $ready = $false }
  }
  if ($web) {
    if (Wait-Http "http://127.0.0.1:$WebPort/" 10) { Write-Ok 'Web 首页可访问' } else { Write-Warn2 'Web 首页不可访问'; $ready = $false }
  }
  if ($ready) { Write-Host "`n全部就绪：http://127.0.0.1:$WebPort`n" -ForegroundColor Green; exit 0 }
  Write-Host "`n有组件未就绪，运行 powershell -NoProfile -File scripts\dev-local.ps1 启动。`n" -ForegroundColor Yellow
  exit 1
}

# ---------------------------------------------------------------- 启动

Write-Step "WorkMesh 本地启动（仓库 $root）"
$started = @()

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '找不到 node，请先安装 Node.js 20+。' }
if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { throw '找不到 pnpm，请先安装 pnpm 10.x。' }

# 1. PostgreSQL
if ($pg) {
  Write-Ok "PostgreSQL 已在 127.0.0.1:$PgPort 运行 (pid $($pg.Pid))，跳过"
} else {
  $pgStarter = Join-Path $PgHome 'start-pg.mjs'
  if (-not (Test-Path $pgStarter)) {
    throw "找不到 $pgStarter。本机 PostgreSQL 由 embedded-postgres 提供，重建方法见 docs/local-dev.md；已有别的 PostgreSQL 时把 -PgHome 指向它或改 apps/api/.env。"
  }
  $started += Start-Logged 'PostgreSQL' 'postgres.log' (Get-Command node).Source @($pgStarter) $PgHome $PgPort
  if (-not (Wait-Port $PgPort 90 'PostgreSQL')) { throw 'PostgreSQL 启动失败，见 .tmp\dev-logs\postgres.log' }
  Write-Ok "PostgreSQL 127.0.0.1:$PgPort 就绪"
}

# 2. API
if ($api) {
  Write-Ok "API 已在 127.0.0.1:$ApiPort 运行 (pid $($api.Pid))，跳过"
} else {
  $started += Start-Logged 'API' 'api.log' 'pnpm.cmd' @('--filter', '@workmesh/api', 'dev') $root $ApiPort
  if (-not (Wait-Http "http://127.0.0.1:$ApiPort/api/health" 180)) {
    throw 'API 启动失败或超时，见 .tmp\dev-logs\api.log 与 api.log.err（常见原因：数据库连不上、内置角色包摘要冲突、端口被占、迁移未应用）'
  }
  Write-Ok "API 127.0.0.1:$ApiPort 就绪（Swagger /api/docs）"
}

# 3. Web
if ($web) {
  Write-Ok "Web 已在 127.0.0.1:$WebPort 运行 (pid $($web.Pid))，跳过"
} else {
  $started += Start-Logged 'Web' 'web.log' 'pnpm.cmd' @('--filter', '@workmesh/web', 'dev') $root $WebPort
  if (-not (Wait-Http "http://127.0.0.1:$WebPort/" 120)) {
    throw 'Web 启动失败或超时，见 .tmp\dev-logs\web.log'
  }
  Write-Ok "Web 127.0.0.1:$WebPort 就绪"
}

if ($started.Count -gt 0) {
  $previous = @(Read-StartedPids | Where-Object { $_.Pid -notin $started.Pid })
  Save-StartedPids ($previous + $started)
}

Write-Host ""
Write-Host "WorkMesh 已就绪" -ForegroundColor Green
Write-Host "  Web          http://127.0.0.1:$WebPort   （必须用 127.0.0.1，不能换 localhost：Origin 白名单要求精确匹配）"
Write-Host "  API          http://127.0.0.1:$ApiPort/api/v1"
Write-Host "  Swagger      http://127.0.0.1:$ApiPort/api/docs"
Write-Host "  数据          PostgreSQL 127.0.0.1:$PgPort/workmesh，schema workmesh_v1"
Write-Host "  演示账号      owner@yesgoo.local / Yff-Demo-2026!   （另有 pm/ui/dev/be/qa/ops@yesgoo.local，同密码）"
Write-Host "  日志          .tmp\dev-logs\*.log"
Write-Host "  停止          powershell -NoProfile -File scripts\dev-local.ps1 -Stop"
Write-Host ""
exit 0
