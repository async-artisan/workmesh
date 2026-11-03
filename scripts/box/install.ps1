#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$DataDir = (Join-Path $env:ProgramData 'WorkMesh'),
  [int]$PgPort = 5432,
  [int]$ApiPort = 3000,
  [int]$WebPort = 5173,
  [string]$DatabaseName = 'workmesh'
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'runtime\node.exe'
$pgBin = Join-Path $root 'runtime\pgsql\bin'
$dataRoot = [System.IO.Path]::GetFullPath($DataDir)
$pgData = Join-Path $dataRoot 'pg'
$logs = Join-Path $dataRoot 'logs'
$config = Join-Path $dataRoot 'config.env'

function Invoke-Required([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    $safeArguments = ($Arguments | ForEach-Object { $_ -replace '(?i)(postgres(?:ql)?://[^:/?#]+:)[^@/?#]+@', '$1***@' }) -join ' '
    throw "Command failed ($LASTEXITCODE): $File $safeArguments"
  }
}
function Read-EnvFile([string]$Path) {
  foreach ($line in (Get-Content -LiteralPath $Path)) {
    if ($line -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
  }
}
function Get-ConnectionParts([string]$Url) {
  $match = [regex]::Match($Url, '^postgres(?:ql)?://(?<user>[^:/?#]+)(?::(?<password>[^@/?#]*))?@(?<host>[^/:?#]+):(?<port>\d+)/(?<database>[A-Za-z_][A-Za-z0-9_]*)(?:\?(?<query>.*))?$')
  if (-not $match.Success) { throw 'WORKMESH_V1_DATABASE_URL must be a PostgreSQL URL with user, password, host, port and database name.' }
  $query = $match.Groups['query'].Value
  if ($query -notmatch '(^|&)schema=workmesh_v1(&|$)') { throw 'WORKMESH_V1_DATABASE_URL must select schema=workmesh_v1.' }
  if ($match.Groups['host'].Value -ne '127.0.0.1') { throw 'Packaged WorkMesh must use a local PostgreSQL host (127.0.0.1).' }
  [pscustomobject]@{
    User = $match.Groups['user'].Value
    Password = $match.Groups['password'].Value
    Host = $match.Groups['host'].Value
    Port = [int]$match.Groups['port'].Value
    Database = $match.Groups['database'].Value
    Url = $Url
    AdminUrl = "postgresql://$($match.Groups['user'].Value):$($match.Groups['password'].Value)@$($match.Groups['host'].Value):$($match.Groups['port'].Value)/postgres"
  }
}
function Test-OwnPostgres([string]$DataPath) {
  $pidFile=Join-Path $DataPath 'postmaster.pid'
  if (-not (Test-Path -LiteralPath (Join-Path $DataPath 'PG_VERSION')) -or -not (Test-Path -LiteralPath $pidFile)) { return $false }
  $pidLines=Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
  if ($pidLines.Count -lt 4 -or [int]$pidLines[3] -ne $PgPort) { return $false }
  if ([System.IO.Path]::GetFullPath($pidLines[1]) -ine [System.IO.Path]::GetFullPath($DataPath)) { return $false }
  & (Join-Path $pgBin 'pg_ctl.exe') status -D $DataPath *> $null
  return $LASTEXITCODE -eq 0
}

if ($PgPort -lt 1024 -or $PgPort -gt 65535 -or $ApiPort -lt 1 -or $ApiPort -gt 65535 -or $WebPort -lt 1 -or $WebPort -gt 65535) { throw 'Ports must be within 1..65535 (PostgreSQL should normally use an unprivileged port).' }
if ($DatabaseName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'DatabaseName must contain only letters, digits and underscores and start with a letter or underscore.' }
if (!(Test-Path -LiteralPath $node)) { throw 'Missing runtime\node.exe' }
if (!(Test-Path -LiteralPath (Join-Path $pgBin 'initdb.exe'))) { throw 'Missing runtime\pgsql\bin\initdb.exe' }
foreach ($tool in @('pg_ctl.exe','psql.exe','pg_dump.exe')) { if (!(Test-Path -LiteralPath (Join-Path $pgBin $tool))) { throw "Missing runtime\pgsql\bin\$tool" } }
New-Item -ItemType Directory -Force -Path $dataRoot, $logs | Out-Null

$linkScript = Join-Path $root 'scripts\dependency-links.mjs'
$linkManifest = Join-Path $root 'app\api\dependency-links.json'
if (Test-Path -LiteralPath $linkManifest) {
  if (!(Test-Path -LiteralPath $linkScript)) { throw 'Dependency link manifest exists but scripts\dependency-links.mjs is missing.' }
  Invoke-Required $node @($linkScript,'restore',(Join-Path $root 'app\api'))
}

if (Test-Path -LiteralPath $config) {
  Read-EnvFile $config
} else {
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  $password = [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  @(
    "WORKMESH_V1_DATABASE_URL=postgresql://postgres:$password@127.0.0.1:$PgPort/${DatabaseName}?schema=workmesh_v1"
    'WORKMESH_COOKIE_MODE=LOCAL_INSECURE'
    "WORKMESH_PUBLIC_ORIGIN=http://127.0.0.1:$WebPort"
    "WEB_ORIGIN=http://127.0.0.1:$WebPort"
    "PORT=$ApiPort"
  ) | Set-Content -LiteralPath $config -Encoding UTF8
  Read-EnvFile $config
}
$db = Get-ConnectionParts $env:WORKMESH_V1_DATABASE_URL
$PgPort = $db.Port
if ($env:PORT) { $ApiPort = [int]$env:PORT }
if ($env:WEB_ORIGIN -match ':(\d+)$') { $WebPort = [int]$matches[1] }
if ($db.Database -ne $DatabaseName) {
  if ($PSBoundParameters.ContainsKey('DatabaseName')) { throw 'Configured database name does not match -DatabaseName.' }
  $DatabaseName = $db.Database
}

$running = Get-NetTCPConnection -LocalPort $PgPort -State Listen -ErrorAction SilentlyContinue
if ($running -and -not (Test-OwnPostgres $pgData)) {
  throw "PostgreSQL port $PgPort is already occupied by a server outside this DataDir. Choose an unused -PgPort; refusing to migrate an unknown database."
}
if (!(Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  New-Item -ItemType Directory -Force -Path $pgData | Out-Null
  $pwFile = Join-Path $dataRoot '.pgpw'
  $db.Password | Set-Content -LiteralPath $pwFile -NoNewline -Encoding ASCII
  try { Invoke-Required (Join-Path $pgBin 'initdb.exe') @('-D',$pgData,'-U',$db.User,'-A','scram-sha-256',"--pwfile=$pwFile") } finally { Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue }
}
if (-not (Get-NetTCPConnection -LocalPort $PgPort -State Listen -ErrorAction SilentlyContinue)) {
  $pgStart = Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList @('-D',('"'+$pgData+'"'),'-o',('"-p '+$PgPort+'"'),'-l',('"'+(Join-Path $logs 'postgres.log')+'"'),'start') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'pg-start.log') -RedirectStandardError (Join-Path $logs 'pg-start.err.log')
  if (-not $pgStart.WaitForExit(60000)) { throw 'Timed out starting bundled PostgreSQL.' }
  if ($pgStart.ExitCode -ne 0) { throw "Failed to start bundled PostgreSQL. See $logs\pg-start.err.log" }
  Start-Sleep -Seconds 2
}
if (-not (Get-NetTCPConnection -LocalPort $PgPort -State Listen -ErrorAction SilentlyContinue)) { throw "PostgreSQL did not start on port $PgPort." }

$psql = Join-Path $pgBin 'psql.exe'
$env:PGPASSWORD = $db.Password
try {
  $instance = & $psql -h $db.Host -p $db.Port -U $db.User -d postgres -tAc 'SELECT current_setting(''data_directory'') || chr(9) || current_setting(''port'')'
  if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the PostgreSQL instance selected by this DataDir.' }
  $instanceParts = (($instance -join '').Trim() -split "`t")
  if ($instanceParts.Count -lt 2 -or [System.IO.Path]::GetFullPath($instanceParts[0]) -ine [System.IO.Path]::GetFullPath($pgData) -or [int]$instanceParts[1] -ne $PgPort) {
    throw 'The PostgreSQL listener does not match this DataDir and configured port; refusing to use it.'
  }
  $exists = & $psql -h $db.Host -p $db.Port -U $db.User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DatabaseName'"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to query PostgreSQL administrative database.' }
  if (($exists -join '').Trim() -ne '1') {
    Invoke-Required $psql @("--dbname=$($db.AdminUrl)",'-v','ON_ERROR_STOP=1','-c',"CREATE DATABASE `"$DatabaseName`"")
  }
  Invoke-Required $node @((Join-Path $root 'app\api\node_modules\prisma\build\index.js'),'migrate','deploy','--schema',(Join-Path $root 'app\api\prisma\schema.prisma'))
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
Write-Host "WorkMesh initialized. Configuration: $config" -ForegroundColor Green
Write-Host 'Start: powershell -ExecutionPolicy Bypass -File .\start-workmesh.ps1' -ForegroundColor Cyan
Write-Host "URL: http://127.0.0.1:$WebPort" -ForegroundColor Cyan
