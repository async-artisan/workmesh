#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$OutputDir = '',
  [string]$PostgresRoot = '',
  [string]$NodeExe = '',
  [string]$Version = '',
  [switch]$SkipBuild,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$scriptRoot = $PSScriptRoot
$root = (Resolve-Path (Join-Path $scriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) { $OutputDir = Join-Path $root 'release\workmesh-box-win-x64' }
if ([string]::IsNullOrWhiteSpace($PostgresRoot)) { $PostgresRoot = Join-Path $root '.tmp\pgclient\pgsql' }
if ([string]::IsNullOrWhiteSpace($NodeExe)) { $NodeExe = (Get-Command node -ErrorAction Stop).Source }
if ([string]::IsNullOrWhiteSpace($Version)) {
  $rootPackage = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $Version = [string]$rootPackage.version
}
$releasePath = [System.IO.Path]::GetFullPath($OutputDir)
function Require-Path([string]$Path, [string]$Label) { if (-not (Test-Path -LiteralPath $Path)) { throw "$Label not found: $Path" } }
function Copy-Tree([string]$Source, [string]$Destination) {
  Require-Path $Source 'Source directory'
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}
function Run([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Command $($Arguments -join ' ')" }
}
Require-Path $NodeExe 'Node executable'
$releaseVerifier = Join-Path $scriptRoot 'verify-release.mjs'
Require-Path $releaseVerifier 'Release version verifier'
Run $NodeExe @($releaseVerifier,"v$Version")
if ($Force -and (Test-Path -LiteralPath $releasePath)) { Remove-Item -LiteralPath $releasePath -Recurse -Force }
if (Test-Path -LiteralPath $releasePath) { throw "Output directory exists: $releasePath" }
Require-Path $PostgresRoot 'PostgreSQL directory'
Require-Path (Join-Path $PostgresRoot 'bin\postgres.exe') 'PostgreSQL server'
Require-Path (Join-Path $PostgresRoot 'bin\initdb.exe') 'PostgreSQL initdb'
Require-Path (Join-Path $PostgresRoot 'bin\pg_dump.exe') 'PostgreSQL pg_dump'
if (-not $SkipBuild) {
  Run 'pnpm' @('--filter','@workmesh/shared','build')
  Run 'pnpm' @('--filter','@workmesh/role-packages','build')
  Run 'pnpm' @('--filter','@workmesh/api','build')
  Run 'pnpm' @('--filter','@workmesh/web','build')
  Run 'pnpm' @('--filter','@workmesh/cli','build')
  Run 'pnpm' @('--filter','@workmesh/box','build')
}
New-Item -ItemType Directory -Force -Path $releasePath, "$releasePath\runtime", "$releasePath\app", "$releasePath\roles", "$releasePath\scripts" | Out-Null
Copy-Item -LiteralPath $NodeExe -Destination "$releasePath\runtime\node.exe" -Force
$pgRuntime = "$releasePath\runtime\pgsql"
New-Item -ItemType Directory -Force -Path "$pgRuntime\bin", "$pgRuntime\lib", "$pgRuntime\share" | Out-Null
$pgBin = Join-Path $PostgresRoot 'bin'
$pgNames = @('postgres.exe','pg_ctl.exe','initdb.exe','psql.exe','pg_dump.exe','pg_restore.exe','createdb.exe','libpq.dll','libcrypto-3-x64.dll','libssl-3-x64.dll','libiconv-2.dll','libintl-9.dll','libwinpthread-1.dll','libxml2.dll','libxslt.dll','libzstd.dll','liblz4.dll','icudt67.dll','icuin67.dll','icuio67.dll','icutu67.dll','icuuc67.dll')
foreach ($name in $pgNames) { $src = Join-Path $pgBin $name; if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination "$pgRuntime\bin" -Force } }
Copy-Tree (Join-Path $PostgresRoot 'lib') "$pgRuntime\lib"
$pgShare = Join-Path $PostgresRoot 'share'
foreach ($name in @('extension','locale','timezone','timezonesets','tsearch_data')) { if (Test-Path (Join-Path $pgShare $name)) { Copy-Tree (Join-Path $pgShare $name) "$pgRuntime\share\$name" } }
Get-ChildItem -LiteralPath $pgShare -File | Copy-Item -Destination "$pgRuntime\share" -Force
Copy-Tree (Join-Path $root 'apps\web\dist') "$releasePath\app\web\dist"
Copy-Tree (Join-Path $root 'apps\cli\dist') "$releasePath\app\cli\dist"
Copy-Tree (Join-Path $root 'packages\box\dist') "$releasePath\app\box\dist"
Copy-Item -LiteralPath (Join-Path $root 'apps\cli\package.json') -Destination "$releasePath\app\cli\package.json" -Force
Copy-Item -LiteralPath (Join-Path $root 'packages\box\package.json') -Destination "$releasePath\app\box\package.json" -Force
Copy-Tree (Join-Path $root 'packages\role-packages\roles') "$releasePath\roles"
$apiOut = "$releasePath\app\api"
New-Item -ItemType Directory -Force -Path $apiOut | Out-Null
# Keep devDependencies in this deployment because install.ps1 runs Prisma's
# migration CLI from app\api\node_modules\prisma during first-run setup.
Run 'pnpm' @('--filter','@workmesh/api','deploy','--legacy',$apiOut)
foreach ($requiredApiPath in @(
  (Join-Path $apiOut 'dist\main.js'),
  (Join-Path $apiOut 'prisma\schema.prisma'),
  (Join-Path $apiOut 'node_modules\prisma\build\index.js'),
  (Join-Path $apiOut 'node_modules\@prisma\client')
)) {
  Require-Path $requiredApiPath 'Deployed API artifact'
}
$workmeshModules = "$apiOut\node_modules\@workmesh"
New-Item -ItemType Directory -Force -Path $workmeshModules | Out-Null
foreach ($packageName in @('shared','role-packages')) {
  $packageSource = Join-Path $root "packages\$packageName"
  $packageTarget = Join-Path $workmeshModules $packageName
  if (Test-Path -LiteralPath $packageTarget) {
    $existing = Get-Item -LiteralPath $packageTarget -Force
    if ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      [System.IO.Directory]::Delete($packageTarget)
    } else {
      Remove-Item -LiteralPath $packageTarget -Recurse -Force
    }
  }
  New-Item -ItemType Directory -Force -Path $packageTarget | Out-Null
  Copy-Item -LiteralPath (Join-Path $packageSource 'package.json') -Destination $packageTarget -Force
  Copy-Tree (Join-Path $packageSource 'dist') (Join-Path $packageTarget 'dist')
  if ($packageName -eq 'role-packages') { Copy-Tree (Join-Path $packageSource 'roles') (Join-Path $packageTarget 'roles') }
}
Copy-Tree (Join-Path $root 'apps\node_modules\.prisma') "$releasePath\app\node_modules\.prisma"
Run $NodeExe @((Join-Path $scriptRoot 'box\dependency-links.mjs'),'collect',$apiOut)
Copy-Item -LiteralPath (Join-Path $scriptRoot 'box\install.ps1') -Destination "$releasePath\install.ps1" -Force
Copy-Item -LiteralPath (Join-Path $scriptRoot 'box\start-workmesh.ps1') -Destination "$releasePath\start-workmesh.ps1" -Force
Copy-Item -LiteralPath (Join-Path $scriptRoot 'box\stop-workmesh.ps1') -Destination "$releasePath\stop-workmesh.ps1" -Force
Copy-Item -LiteralPath (Join-Path $scriptRoot 'box\web-server.mjs') -Destination "$releasePath\scripts\web-server.mjs" -Force
Copy-Item -LiteralPath (Join-Path $scriptRoot 'box\dependency-links.mjs') -Destination "$releasePath\scripts\dependency-links.mjs" -Force
$downloads = "$releasePath\downloads"
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
$cliStage = "$releasePath\.cli-stage"
New-Item -ItemType Directory -Force -Path "$cliStage\app", "$cliStage\roles", "$cliStage\runtime" | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'apps\cli\dist') -Destination "$cliStage\app\cli" -Recurse -Force
Copy-Tree (Join-Path $root 'packages\role-packages\roles') "$cliStage\roles"
Copy-Item -LiteralPath $NodeExe -Destination "$cliStage\runtime\node.exe" -Force
Set-Content -LiteralPath "$cliStage\package.json" -Encoding ASCII -Value '{"private":true,"type":"module"}'
Set-Content -LiteralPath "$cliStage\workmesh.cmd" -Encoding ASCII -Value '@echo off'
Add-Content -LiteralPath "$cliStage\workmesh.cmd" -Encoding ASCII -Value '"%~dp0runtime\node.exe" "%~dp0app\cli\index.js" %*'
# Validate the staged distribution, including package bytes and setup from an
# unrelated business directory, before publishing the downloadable archive.
Run $NodeExe @((Join-Path $scriptRoot 'verify-cli-package.mjs'), $cliStage)
$cliZip = "$downloads\workmesh-cli-win-x64.zip"
Compress-Archive -Path "$cliStage\*" -DestinationPath $cliZip -Force
$cliHash = (Get-FileHash $cliZip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$cliZip.sha256" -Encoding ASCII -Value ($cliHash + '  workmesh-cli-win-x64.zip')
Remove-Item -LiteralPath $cliStage -Recurse -Force
$cliDownloadPage = '<!doctype html><meta charset="utf-8"><title>WorkMesh Downloads</title><h1>WorkMesh Downloads</h1><p><a href="/download/workmesh-cli-win-x64.zip">Windows x64 CLI ZIP</a> <a href="/download/workmesh-cli-win-x64.zip.sha256">SHA-256</a></p>'
Set-Content -LiteralPath "$downloads\index.html" -Encoding UTF8 -Value $cliDownloadPage
# Keep the existing `node` manifest field for consumers, but make it portable:
# the absolute runner path would disclose the build machine and differ between
# runners. The packaged executable is always at this relative location.
$manifest = [ordered]@{ schemaVersion='1.0'; product='workmesh-box'; version=$Version; platform='win-x64'; builtAt=(Get-Date).ToUniversalTime().ToString('o'); node='runtime\node.exe'; includes=@('node-runtime','postgresql','api','web','cli','box','role-packages'); apiPort=3000; webPort=5173; pgPort=5432 }
$manifestJson = $manifest | ConvertTo-Json -Depth 5
$manifestPath = Join-Path $releasePath 'release-manifest.json'
Set-Content -LiteralPath $manifestPath -Value $manifestJson -Encoding UTF8
$writtenManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ([System.IO.Path]::IsPathRooted([string]$writtenManifest.node)) { throw 'Release manifest node path must be relative to the package root.' }
Require-Path (Join-Path $releasePath ([string]$writtenManifest.node)) 'Packaged Node runtime from release manifest'
$releaseDownloadPage = '<!doctype html><meta charset="utf-8"><title>WorkMesh Downloads</title><h1>WorkMesh Downloads</h1><p><a href="/download/workmesh-box-win-x64.zip">Windows x64 Box Package</a> <a href="/download/workmesh-box-win-x64.zip.sha256">SHA-256</a></p><p><a href="/download/workmesh-cli-win-x64.zip">Windows x64 CLI ZIP</a> <a href="/download/workmesh-cli-win-x64.zip.sha256">SHA-256</a></p>'
Set-Content -LiteralPath "$downloads\index.html" -Encoding UTF8 -Value $releaseDownloadPage
$archive = Join-Path (Split-Path $releasePath -Parent) ((Split-Path $releasePath -Leaf) + '.zip')
$archiveDownload = "$downloads\workmesh-box-win-x64.zip"
if (Test-Path $archive) { Remove-Item $archive -Force }
if (Test-Path $archiveDownload) { Remove-Item $archiveDownload -Force }
Compress-Archive -Path "$releasePath\*" -DestinationPath $archive -Force
Copy-Item -LiteralPath $archive -Destination $archiveDownload -Force
$archiveHash = (Get-FileHash $archiveDownload -Algorithm SHA256).Hash.ToLowerInvariant()
$archiveHashLine = $archiveHash + '  workmesh-box-win-x64.zip'
Set-Content -LiteralPath "$archiveDownload.sha256" -Encoding ASCII -Value $archiveHashLine
Set-Content -LiteralPath "$archive.sha256" -Encoding ASCII -Value ($archiveHash + '  ' + [System.IO.Path]::GetFileName($archive))
Write-Host "Windows box package ready: $releasePath" -ForegroundColor Green
Write-Host "Download archive: $archiveDownload" -ForegroundColor Green
