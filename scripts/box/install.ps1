#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$DataDir = (Join-Path $env:ProgramData 'WorkMesh'),
  [int]$PgPort = 5432,
  [int]$ApiPort = 3000,
  [int]$WebPort = 5173
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'runtime\node.exe'
$pgBin = Join-Path $root 'runtime\pgsql\bin'
$pgData = Join-Path $DataDir 'pg'
$logs = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force -Path $DataDir,$logs | Out-Null
if (!(Test-Path $node)) { throw 'Missing runtime\node.exe' }
if (!(Test-Path (Join-Path $pgBin 'initdb.exe'))) { throw 'Missing runtime\pgsql\bin\initdb.exe' }

$config = Join-Path $DataDir 'config.env'
if (!(Test-Path $config)) {
  $password = (1..24 | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) -join ''
  @(
    "WORKMESH_V1_DATABASE_URL=postgresql://postgres:$password@127.0.0.1:$PgPort/workmesh?schema=workmesh_v1"
    'WORKMESH_COOKIE_MODE=LOCAL_INSECURE'
    "WORKMESH_PUBLIC_ORIGIN=http://127.0.0.1:$WebPort"
    "WEB_ORIGIN=http://127.0.0.1:$WebPort"
    "PORT=$ApiPort"
  ) | Set-Content -LiteralPath $config -Encoding UTF8
}
$envLines = Get-Content $config
foreach ($line in $envLines) {
  if ($line -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process') }
}
$dbUrl = $env:WORKMESH_V1_DATABASE_URL
if ($dbUrl -notmatch '@127\.0\.0\.1:(\d+)/') { throw 'WORKMESH_V1_DATABASE_URL must target local PostgreSQL and include a port' }
$PgPort = [int]$matches[1]
if ($env:PORT) { $ApiPort = [int]$env:PORT }
if ($env:WEB_ORIGIN -match ':(\d+)$') { $WebPort = [int]$matches[1] }
if (!(Test-Path (Join-Path $pgData 'PG_VERSION'))) {
  New-Item -ItemType Directory -Force -Path $pgData | Out-Null
  $pw = ($dbUrl -replace '^postgresql://postgres:','') -replace '@.*$',''
  $pwFile = Join-Path $DataDir '.pgpw'
  $pw | Set-Content -LiteralPath $pwFile -NoNewline -Encoding ASCII
  & (Join-Path $pgBin 'initdb.exe') -D $pgData -U postgres -A scram-sha-256 --pwfile=$pwFile
  Remove-Item $pwFile -Force
}
$running = Get-NetTCPConnection -LocalPort $PgPort -State Listen -ErrorAction SilentlyContinue
if (!$running) {
  & (Join-Path $pgBin 'pg_ctl.exe') -D $pgData -o "-p $PgPort" -l (Join-Path $logs 'postgres.log') start
  Start-Sleep -Seconds 3
}
$adminUrl = ($dbUrl -replace '/workmesh\?schema=.*$','/postgres')
$psql = Join-Path $pgBin 'psql.exe'
$dbExists = & $psql "--dbname=$adminUrl" -tAc "SELECT 1 FROM pg_database WHERE datname='workmesh'" 2>$null
if (($dbExists -join '').Trim() -ne '1') {
  & $psql "--dbname=$adminUrl" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE "workmesh"'
  if ($LASTEXITCODE -ne 0) { throw "Failed to create WorkMesh database ($LASTEXITCODE)" }
}
& $node (Join-Path $root 'app\api\node_modules\prisma\build\index.js') migrate deploy --schema (Join-Path $root 'app\api\prisma\schema.prisma')
Write-Host "WorkMesh initialized. Configuration: $config" -ForegroundColor Green
Write-Host 'Start: powershell -ExecutionPolicy Bypass -File .\start-workmesh.ps1' -ForegroundColor Cyan
Write-Host "URL: http://127.0.0.1:$WebPort" -ForegroundColor Cyan
