#Requires -Version 5.1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$script:checkCount = 0
$script:clock = [DateTime]::Now
$script:probeMode = 'ready'
$ApiPort = 58271
$WebPort = 58272

function Assert-Check([string]$Name,[bool]$Passed) {
  if (-not $Passed) { throw "FAILED: $Name" }
  $script:checkCount++
  Write-Host "PASS: $Name"
}
function Get-ProductionFunction([string]$Path,[string]$Name) {
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$null,[ref]$parseErrors)
  if ($parseErrors.Count) { throw $parseErrors[0].Message }
  $targetName = $Name
  $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $targetName },$true)
  if (-not $function) { throw "Missing production function: $Name" }
  Invoke-Expression ($function.Extent.Text -replace '^function\s+', 'function global:')
}

# Extract only production probe functions; never run install/start or create a database.
Get-ProductionFunction (Join-Path $PSScriptRoot 'start-workmesh.ps1') 'Wait-ApiHealth'
Get-ProductionFunction (Join-Path $PSScriptRoot 'start-workmesh.ps1') 'Wait-ApiReady'
Get-ProductionFunction (Join-Path $PSScriptRoot '..\test-release-box.ps1') 'Assert-Healthy'
function Get-Date { $script:clock=$script:clock.AddSeconds(1); return $script:clock }
function Start-Sleep([int]$Milliseconds) { }
function Invoke-WebRequest {
  param([string]$Uri,[switch]$UseBasicParsing,[int]$TimeoutSec)
  if ($script:probeMode -eq 'http-error') { return [pscustomobject]@{StatusCode=503;Content='{}'} }
  if ($script:probeMode -eq 'connection-error') { throw 'connection refused' }
  if ($script:probeMode -eq 'liveness') { return [pscustomobject]@{StatusCode=200;Content='{"data":{"status":"ok"}}'} }
  if ($script:probeMode -eq 'not-migrated') { return [pscustomobject]@{StatusCode=200;Content='{"data":{"ok":true,"database":{"reachable":true,"appliedMigrations":0}}}'} }
  if ($script:probeMode -eq 'invalid-types') { return [pscustomobject]@{StatusCode=200;Content='{"data":{"ok":"true","database":{"reachable":true,"appliedMigrations":20}}}'} }
  return [pscustomobject]@{StatusCode=200;Content='{"data":{"ok":true,"database":{"reachable":true,"appliedMigrations":20}}}'}
}

$readyUrl = "http://127.0.0.1:$ApiPort/api/health/ready"
Assert-Check 'API ready payload passes startup probe' (Wait-ApiReady $readyUrl 3)
$script:probeMode = 'liveness'
Assert-Check 'liveness remains available as a separate diagnostic' (Wait-ApiHealth "http://127.0.0.1:$ApiPort/api/health" 3)
Assert-Check 'HTTP 200 liveness cannot satisfy startup readiness' (-not (Wait-ApiReady $readyUrl 3))
$script:probeMode = 'not-migrated'
Assert-Check 'unmigrated database cannot satisfy startup readiness' (-not (Wait-ApiReady $readyUrl 3))
$script:probeMode = 'http-error'
Assert-Check 'HTTP failure cannot satisfy startup readiness' (-not (Wait-ApiReady $readyUrl 3))
$script:probeMode = 'connection-error'
Assert-Check 'connection failure cannot satisfy startup readiness' (-not (Wait-ApiReady $readyUrl 3))
$script:probeMode = 'invalid-types'
Assert-Check 'string booleans cannot satisfy startup readiness' (-not (Wait-ApiReady $readyUrl 3))

function Assert-OwnedPostgres { }
function Assert-OwnedApplication { }
function Invoke-RestMethod {
  param([string]$Uri,[int]$TimeoutSec)
  if ($Uri.EndsWith('/health/ready')) {
    if ($script:probeMode -eq 'liveness') { return [pscustomobject]@{data=[pscustomobject]@{status='ok'}} }
    if ($script:probeMode -eq 'invalid-types') { return [pscustomobject]@{data=[pscustomobject]@{ok='true';database=[pscustomobject]@{reachable=$true;appliedMigrations=20}}} }
    if ($script:probeMode -eq 'proxy-not-ready' -and $Uri.Contains(":$WebPort/")) { throw 'proxy readiness unavailable' }
    return [pscustomobject]@{data=[pscustomobject]@{ok=$true;database=[pscustomobject]@{reachable=$true;appliedMigrations=20}}}
  }
  return [pscustomobject]@{data=[pscustomobject]@{status='ok'}}
}
$script:checks = [System.Collections.Generic.List[object]]::new()
$script:probeMode = 'ready'
Assert-Healthy 'ready-phase'
Assert-Check 'lifecycle phase retains direct and proxy readiness with loopback evidence' ($script:checks.Count -eq 1 -and $script:checks[0].apiReady -and $script:checks[0].proxyReady -and $script:checks[0].httpAccess -eq 'LOOPBACK_ONLY')
foreach ($mode in @('liveness','proxy-not-ready','invalid-types')) {
  $script:probeMode = $mode
  $failed = $false
  try { Assert-Healthy $mode } catch { $failed=$true }
  Assert-Check "lifecycle rejects $mode even when liveness and Web pass" ($failed -and $script:checks.Count -eq 1)
}
Write-Host "Box readiness regression passed: $script:checkCount checks. No database or service was started."
