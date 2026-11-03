#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$DataDir = (Join-Path $env:ProgramData 'WorkMesh'),
  [int]$ApiPort = 3000,
  [int]$WebPort = 5173
)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$config=Join-Path $DataDir 'config.env'
if (!(Test-Path -LiteralPath $config)) { throw "Configuration not found: $config. Run install.ps1 first." }
foreach($line in (Get-Content $config)){
  if($line -match '^([^#=]+)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')}
  if($line -match '^PORT=(\d+)$'){$ApiPort=[int]$matches[1]}
  if($line -match '^WEB_ORIGIN=http://[^:]+:(\d+)$'){$WebPort=[int]$matches[1]}
}
$node=Join-Path $root 'runtime\node.exe'
$pgCtl=Join-Path $root 'runtime\pgsql\bin\pg_ctl.exe'
$pgData=Join-Path $dataDir 'pg'
$api=Join-Path $root 'app\api\dist\main.js'
$web=Join-Path $root 'scripts\web-server.mjs'
$pgPort=5432
if($env:WORKMESH_V1_DATABASE_URL -match ':(\d+)/'){ $pgPort=[int]$matches[1] }
$pgListening=Get-NetTCPConnection -LocalPort $pgPort -State Listen -ErrorAction SilentlyContinue
if(!$pgListening -and (Test-Path $pgCtl) -and (Test-Path (Join-Path $pgData 'PG_VERSION'))){
  & $pgCtl -D $pgData -o "-p $pgPort" -l (Join-Path $dataDir 'logs\postgres.log') start
  if ($LASTEXITCODE -ne 0) { throw 'Failed to start bundled PostgreSQL.' }
  Start-Sleep -Seconds 3
}
if (!(Test-Path $node) -or !(Test-Path $api) -or !(Test-Path $web)) { throw 'A required Node or WorkMesh application file is missing.' }
$apiOutLog=Join-Path $dataDir 'logs\api.log'
$apiErrLog=Join-Path $dataDir 'logs\api.err.log'
$webOutLog=Join-Path $dataDir 'logs\web.log'
$webErrLog=Join-Path $dataDir 'logs\web.err.log'
$apiJob=Start-Process -FilePath $node -ArgumentList $api -WorkingDirectory (Join-Path $root 'app\api') -RedirectStandardOutput $apiOutLog -RedirectStandardError $apiErrLog -PassThru
$webJob=Start-Process -FilePath $node -ArgumentList $web,'--root',($root + '\app\web\dist'),'--port',$WebPort,'--api-port',$ApiPort,'--downloads-root',($root + '\downloads') -WorkingDirectory $root -RedirectStandardOutput $webOutLog -RedirectStandardError $webErrLog -PassThru
Start-Sleep -Seconds 5
if ($apiJob.HasExited) { throw "API exited during startup. See $apiErrLog" }
if ($webJob.HasExited) { throw "Web exited during startup. See $webErrLog" }
Write-Host "API PID=$($apiJob.Id), Web PID=$($webJob.Id)" -ForegroundColor Green
Write-Host "Open http://127.0.0.1:$WebPort" -ForegroundColor Cyan
