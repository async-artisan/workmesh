# Windows PowerShell 5.1 regression tests for the bundled PostgreSQL ownership
# guards. The production functions are extracted from both entry-point scripts;
# filesystem, pg_ctl status, and TCP listener responses are isolated mocks.
# No database process or listening socket is created.
#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Microsoft.PowerShell.Management\Join-Path $PSScriptRoot '..\..'))
$tempRoot = Microsoft.PowerShell.Management\Join-Path ([System.IO.Path]::GetTempPath()) ('workmesh-postgres-ownership-' + [Guid]::NewGuid().ToString('N'))
$pgData = Microsoft.PowerShell.Management\Join-Path $tempRoot 'pg'
$fakePgCtl = Microsoft.PowerShell.Management\Join-Path $tempRoot 'pg_ctl.ps1'
$logs = $tempRoot
$PgPort = 45441
$Port = 45441
$pgBin = $tempRoot
$pgCtl = $fakePgCtl
$script:checkCount = 0
$script:listenerMode = 'owned'
$script:listenerPid = 9876
$script:pgCtlExitCode = 0
$script:fakeClock = [DateTime]::Now

function Assert-Check([string]$Name, [bool]$Passed) {
  $script:checkCount++
  if (-not $Passed) { throw "FAILED: $Name" }
  Write-Host "PASS: $Name"
}

function Get-ProductionFunction([string]$Path, [string]$Name) {
  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count -gt 0) { throw "PowerShell parse error in $Path`: $($parseErrors[0].Message)" }
  $functionAst = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name }, $true)
  if (-not $functionAst) { throw "Function '$Name' not found in $Path" }
  $definition = $functionAst.Extent.Text -replace '^function\s+', 'function global:'
  Invoke-Expression $definition
}

function Join-Path([string]$Path, [string]$ChildPath) {
  if ($ChildPath -eq 'pg_ctl.exe') { return $fakePgCtl }
  return Microsoft.PowerShell.Management\Join-Path -Path $Path -ChildPath $ChildPath
}

function Get-NetTCPConnection([int]$LocalPort, [string]$State, [string]$ErrorAction) {
  if ($script:listenerMode -eq 'owned') { return [pscustomobject]@{ LocalPort = $LocalPort; State = $State; OwningProcess = $script:listenerPid } }
  if ($script:listenerMode -eq 'wrong-pid') { return [pscustomobject]@{ LocalPort = $LocalPort; State = $State; OwningProcess = ($script:listenerPid + 1) } }
  return $null
}

function Start-Sleep([int]$Milliseconds) { }
function Get-Date { $script:fakeClock = $script:fakeClock.AddSeconds(1); return $script:fakeClock }

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $pgData -Force | Out-Null
  '17' | Set-Content -LiteralPath (Microsoft.PowerShell.Management\Join-Path $pgData 'PG_VERSION') -Encoding ASCII
  @('9876', $pgData, '123', "$PgPort") | Set-Content -LiteralPath (Microsoft.PowerShell.Management\Join-Path $pgData 'postmaster.pid') -Encoding ASCII
  '$global:LASTEXITCODE = $global:pgCtlExitCode' | Set-Content -LiteralPath $fakePgCtl -Encoding ASCII

  $installPath = Microsoft.PowerShell.Management\Join-Path $repoRoot 'scripts\box\install.ps1'
  $startPath = Microsoft.PowerShell.Management\Join-Path $repoRoot 'scripts\box\start-workmesh.ps1'

  foreach ($scriptPath in @($installPath, $startPath)) {
    $label = [System.IO.Path]::GetFileName($scriptPath)
    Get-ProductionFunction $scriptPath 'Test-OwnPostgres'
    Get-ProductionFunction $scriptPath 'Assert-PostgresStartExitCode'

    $script:listenerMode = 'owned'
    $script:listenerPid = 9876
    $script:pgCtlExitCode = 0
    $script:fakeClock = [DateTime]::Now
    if ($label -eq 'install.ps1') { $owned = Test-OwnPostgres $pgData } else { $owned = Test-OwnPostgres $pgData $Port }
    Assert-Check "$label accepts matching DataDir, port, pg_ctl status, and listener PID" ([bool]$owned)

    $script:listenerMode = 'wrong-pid'
    $script:fakeClock = [DateTime]::Now
    if ($label -eq 'install.ps1') { $wrongPid = Test-OwnPostgres $pgData } else { $wrongPid = Test-OwnPostgres $pgData $Port }
    Assert-Check "$label rejects a listener owned by another PID" (-not $wrongPid)

    $script:listenerMode = 'none'
    $script:fakeClock = [DateTime]::Now
    if ($label -eq 'install.ps1') { $noListener = Test-OwnPostgres $pgData } else { $noListener = Test-OwnPostgres $pgData $Port }
    Assert-Check "$label rejects a missing listener" (-not $noListener)

    $script:listenerMode = 'owned'
    $script:pgCtlExitCode = 1
    if ($label -eq 'install.ps1') { $badStatus = Test-OwnPostgres $pgData } else { $badStatus = Test-OwnPostgres $pgData $Port }
    Assert-Check "$label rejects failed pg_ctl status" (-not $badStatus)

    $script:pgCtlExitCode = 0
    $pidFile = Microsoft.PowerShell.Management\Join-Path $pgData 'postmaster.pid'
    @('not-a-pid', $pgData, '123', "$PgPort") | Set-Content -LiteralPath $pidFile -Encoding ASCII
    if ($label -eq 'install.ps1') { $badPid = Test-OwnPostgres $pgData } else { $badPid = Test-OwnPostgres $pgData $Port }
    Assert-Check "$label rejects malformed postmaster PID" (-not $badPid)
    @('9876', $pgData, '123', "$PgPort") | Set-Content -LiteralPath $pidFile -Encoding ASCII

    Assert-PostgresStartExitCode $null
    Assert-Check "$label allows null Start-Process ExitCode to proceed to ownership verification" $true
    Assert-PostgresStartExitCode 0
    Assert-Check "$label accepts zero Start-Process ExitCode" $true
    $nonzeroRejected = $false
    try { Assert-PostgresStartExitCode 7 } catch { $nonzeroRejected = $true }
    Assert-Check "$label rejects nonzero Start-Process ExitCode" $nonzeroRejected
  }

  Write-Host "PostgreSQL ownership regression checks passed: $script:checkCount"
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
