#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$DataDir = (Join-Path $env:ProgramData 'WorkMesh'),
  [int]$ApiPort = 3000,
  [int]$WebPort = 5173
)
$ErrorActionPreference='Stop'
$root=[System.IO.Path]::GetFullPath($PSScriptRoot)
$dataRoot=[System.IO.Path]::GetFullPath($DataDir)
$config=Join-Path $dataRoot 'config.env'
$stateFile=Join-Path $dataRoot 'processes.json'
if (!(Test-Path -LiteralPath $config)) { throw "Configuration not found: $config. Run install.ps1 first." }
foreach($line in (Get-Content -LiteralPath $config)){
  if($line -match '^([^#=]+)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')}
}
if($env:PORT){$ApiPort=[int]$env:PORT}
if($env:WEB_ORIGIN -match ':(\d+)$'){$WebPort=[int]$matches[1]}
$node=Join-Path $root 'runtime\node.exe'
$pgCtl=Join-Path $root 'runtime\pgsql\bin\pg_ctl.exe'
$pgData=Join-Path $dataRoot 'pg'
$api=Join-Path $root 'app\api\dist\main.js'
$web=Join-Path $root 'scripts\web-server.mjs'
$webRoot=Join-Path $root 'app\web\dist'
$pgPort=5432
if($env:WORKMESH_V1_DATABASE_URL -match ':(\d+)/'){ $pgPort=[int]$matches[1] }
foreach($required in @($node,$pgCtl,$api,$web,$webRoot)){if(!(Test-Path -LiteralPath $required)){throw "Required path missing: $required"}}

function Get-ProcessInfo([int]$ProcessId) { Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue }
function Test-Managed([int]$ProcessId,[string]$ExpectedPath,[string]$ExpectedExe=$node) {
  $info=Get-ProcessInfo $ProcessId
  if(-not $info){return $false}
  $expected=[System.IO.Path]::GetFullPath($ExpectedPath)
  $expectedExe=[System.IO.Path]::GetFullPath($ExpectedExe)
  $cmd=[string]$info.CommandLine
  return ($info.ExecutablePath -ieq $expectedExe) -and ($cmd.IndexOf($expected,[System.StringComparison]::OrdinalIgnoreCase) -ge 0)
}
function Get-PortOwner([int]$Port) { Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 }
function Wait-Http([string]$Url,[int]$TimeoutSec) {
  $deadline=(Get-Date).AddSeconds($TimeoutSec)
  while((Get-Date)-lt $deadline){try{$r=Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3;if($r.StatusCode -eq 200){return $true}}catch{};Start-Sleep -Milliseconds 500}
  return $false
}
function Wait-ApiHealth([string]$Url,[int]$TimeoutSec) {
  $deadline=(Get-Date).AddSeconds($TimeoutSec)
  while((Get-Date)-lt $deadline){
    try{$r=Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3;if($r.StatusCode -eq 200){$body=$r.Content | ConvertFrom-Json;if($body.data.status -eq 'ok'){return $true}}}catch{}
    Start-Sleep -Milliseconds 500
  }
  return $false
}
function Wait-ApiReady([string]$Url,[int]$TimeoutSec) {
  $deadline=(Get-Date).AddSeconds($TimeoutSec)
  while((Get-Date)-lt $deadline){
    try{
      $r=Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if($r.StatusCode -eq 200){
        $body=$r.Content | ConvertFrom-Json
        $migrations=$body.data.database.appliedMigrations
        if($body.data.ok -is [bool] -and $body.data.ok -and $body.data.database.reachable -is [bool] -and $body.data.database.reachable -and ($migrations -is [int] -or $migrations -is [long]) -and $migrations -gt 0){return $true}
      }
    }catch{}
    Start-Sleep -Milliseconds 500
  }
  return $false
}
function Quote-Arg([string]$Value) { return '"' + $Value + '"' }
function Stop-Started([object[]]$Processes) { foreach($item in $Processes){if($item -and (Test-Managed ([int]$item.Id) ([string]$item.Path) $node)){Stop-Process -Id ([int]$item.Id) -Force -ErrorAction SilentlyContinue}} }
function Assert-PostgresStartExitCode([object]$ExitCode) {
  if($null -ne $ExitCode -and [int]$ExitCode -ne 0){throw "Failed to start bundled PostgreSQL (exit $ExitCode). See logs\pg-start.err.log."}
}
function Test-OwnPostgres([string]$DataPath,[int]$Port) {
  $pidFile=Join-Path $DataPath 'postmaster.pid'
  if(!(Test-Path -LiteralPath (Join-Path $DataPath 'PG_VERSION')) -or !(Test-Path -LiteralPath $pidFile)){return $false}
  try {
    $lines=@(Get-Content -LiteralPath $pidFile -ErrorAction Stop)
    [int]$serverPid=0
    [int]$serverPort=0
    if($lines.Count -lt 4 -or -not [int]::TryParse(([string]$lines[0]).Trim(), [ref]$serverPid) -or $serverPid -le 0 -or -not [int]::TryParse(([string]$lines[3]).Trim(), [ref]$serverPort) -or $serverPort -ne $Port){return $false}
    if([System.IO.Path]::GetFullPath(([string]$lines[1]).Trim()) -ine [System.IO.Path]::GetFullPath($DataPath)){return $false}
    & $pgCtl status -D $DataPath *> $null
    if($LASTEXITCODE -ne 0){return $false}

    # pg_ctl status confirms the data directory, while this bounded retry confirms
    # that the same postmaster PID owns the configured TCP listener.
    $deadline=(Get-Date).AddSeconds(5)
    do {
      $listeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
      foreach($listener in $listeners){
        if([int]$listener.OwningProcess -eq $serverPid){return $true}
      }
      if((Get-Date) -ge $deadline){break}
      Start-Sleep -Milliseconds 200
    } while($true)
    return $false
  } catch { return $false }
}

if(Test-Path -LiteralPath $stateFile){
  try{$old=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json}catch{$old=$null}
  if($old -and $old.dataDir -eq $dataRoot -and (Test-Managed ([int]$old.apiPid) $api) -and (Test-Managed ([int]$old.webPid) $web)){
    if((Wait-ApiReady "http://127.0.0.1:$ApiPort/api/health/ready" 3) -and (Wait-Http "http://127.0.0.1:$WebPort/" 3)){
      Write-Host "WorkMesh already running and locally ready (API $($old.apiPid), Web $($old.webPid))." -ForegroundColor Green
      Write-Host 'Scope: loopback HTTP and database readiness; remote access, project authorization and business release are not checked.'
      exit 0
    }
    $alive=Wait-ApiHealth "http://127.0.0.1:$ApiPort/api/health" 1
    throw "Managed WorkMesh processes exist but API readiness or Web HTTP checks failed (API liveness=$alive). Existing processes were preserved. Check logs and the database configuration/migrations."
  }
}
foreach($port in @($ApiPort,$WebPort)){
  $owner=Get-PortOwner $port
  if($owner){throw "Port $port is already occupied by an unmanaged process (PID $($owner.OwningProcess)); refusing to attach or overwrite it."}
}
$running=Get-NetTCPConnection -LocalPort $pgPort -State Listen -ErrorAction SilentlyContinue
if($running -and -not (Test-OwnPostgres $pgData $pgPort)){throw "PostgreSQL port $pgPort is occupied by a server outside this DataDir; refusing to use or stop it."}
New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot 'logs') | Out-Null
if(-not $running){
  $pgStart=Start-Process -FilePath $pgCtl -ArgumentList @('-D',(Quote-Arg $pgData),'-o',(Quote-Arg "-p $pgPort"),'-l',(Quote-Arg (Join-Path $dataRoot 'logs\postgres.log')),'start') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataRoot 'logs\pg-start.log') -RedirectStandardError (Join-Path $dataRoot 'logs\pg-start.err.log')
  $pgExited=$pgStart.WaitForExit(60000)
  if(-not $pgExited){throw 'Timed out starting bundled PostgreSQL.'}
  Assert-PostgresStartExitCode $pgStart.ExitCode
}
if(-not (Test-OwnPostgres $pgData $pgPort)){throw "PostgreSQL is not healthy for this data directory on port $pgPort."}
$apiOutLog=Join-Path $dataRoot 'logs\api.log';$apiErrLog=Join-Path $dataRoot 'logs\api.err.log';$webOutLog=Join-Path $dataRoot 'logs\web.log';$webErrLog=Join-Path $dataRoot 'logs\web.err.log'
New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot 'logs') | Out-Null
$apiArgs=@( (Quote-Arg $api) )
$webArgs=@( (Quote-Arg $web), '--root', (Quote-Arg $webRoot), '--port', "$WebPort", '--api-port', "$ApiPort", '--downloads-root', (Quote-Arg (Join-Path $root 'downloads')) )
$apiJob=$null;$webJob=$null
try {
  $apiJob=Start-Process -FilePath $node -ArgumentList $apiArgs -WorkingDirectory (Join-Path $root 'app\api') -RedirectStandardOutput $apiOutLog -RedirectStandardError $apiErrLog -WindowStyle Hidden -PassThru
  $webJob=Start-Process -FilePath $node -ArgumentList $webArgs -WorkingDirectory $root -RedirectStandardOutput $webOutLog -RedirectStandardError $webErrLog -WindowStyle Hidden -PassThru
  $state=[ordered]@{schemaVersion='1';dataDir=$dataRoot;apiPid=$apiJob.Id;webPid=$webJob.Id;apiPath=[System.IO.Path]::GetFullPath($api);webPath=[System.IO.Path]::GetFullPath($web);apiPort=$ApiPort;webPort=$WebPort;pgPort=$pgPort}
  $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
  if(!(Wait-ApiReady "http://127.0.0.1:$ApiPort/api/health/ready" 60)){
    $alive=Wait-ApiHealth "http://127.0.0.1:$ApiPort/api/health" 1
    throw "WorkMesh API readiness failed (API liveness=$alive). Check database connectivity and migrations."
  }
  if(!(Wait-Http "http://127.0.0.1:$WebPort/" 30)){throw 'WorkMesh failed Web HTTP health checks.'}
  if(!(Test-Managed $apiJob.Id $api) -or !(Test-Managed $webJob.Id $web)){throw 'The expected WorkMesh processes did not remain alive after health checks.'}
} catch {
  $processes=@();if($apiJob){$processes+=@([pscustomobject]@{Id=$apiJob.Id;Path=$api})};if($webJob){$processes+=@([pscustomobject]@{Id=$webJob.Id;Path=$web})}
  Stop-Started $processes;Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
  throw "WorkMesh failed to start: $($_.Exception.Message) See $apiErrLog and $webErrLog"
}
Write-Host "WorkMesh locally ready (API PID=$($apiJob.Id), Web PID=$($webJob.Id))." -ForegroundColor Green
Write-Host 'Scope: loopback HTTP and database readiness; remote access, project authorization and business release are not checked.'
Write-Host "Open http://127.0.0.1:$WebPort" -ForegroundColor Cyan
