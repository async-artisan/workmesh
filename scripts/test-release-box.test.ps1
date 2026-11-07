#Requires -Version 7.0
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'The Box lifecycle safety regression requires Windows and PowerShell 7.' }

$production = Join-Path $PSScriptRoot 'test-release-box.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('workmesh-release-guards-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$script:logs = Join-Path $testRoot 'logs'
New-Item -ItemType Directory -Path $script:logs | Out-Null
$script:checks = 0
$global:workmeshReleaseGuardListenerMode = 'none'
$script:fakeProcess = $null

function Assert-Check([string]$Name,[bool]$Passed) {
  if (-not $Passed) { throw "FAILED: $Name" }
  $script:checks++
  Write-Host "PASS: $Name"
}

function Assert-Rejected([string]$Name,[scriptblock]$Action,[string]$MessagePattern) {
  $caught = $null
  try { & $Action | Out-Null } catch { $caught = $_ }
  if ($null -ne $caught -and $caught.Exception.Message -notmatch $MessagePattern) { Write-Host ("Unexpected rejection: " + $caught.Exception.Message) }
  Assert-Check $Name ($null -ne $caught -and $caught.Exception.Message -match $MessagePattern)
}

function New-TestZip([string]$Name,[string[]]$Entries,[switch]$Symlink) {
  $path = Join-Path $testRoot ($Name + '.zip')
  $zip = [System.IO.Compression.ZipFile]::Open($path,[System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($name in $Entries) {
      $entry = $zip.CreateEntry($name)
      if ($Symlink) { $entry.ExternalAttributes = -1577058304 }
      $writer = [System.IO.StreamWriter]::new($entry.Open())
      try { $writer.Write('guard regression evidence') } finally { $writer.Dispose() }
    }
  } finally { $zip.Dispose() }
  return $path
}

# Extract the production guards without running its install/start entrypoint.
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($production,[ref]$null,[ref]$parseErrors)
if ($parseErrors.Count) { throw $parseErrors[0].Message }
$guardNames = @('Assert-NoReparseAncestors','Get-NewValidationRoot','Assert-FreePorts','Assert-SafeZip','Protect-Log','Invoke-LoggedProgram','Invoke-DatabaseQuery','Test-ManagedProcess','Assert-OwnedApplication','Stop-OwnedServices')
$definitions = foreach ($name in $guardNames) {
  $targetName = $name
  $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $targetName },$true)
  if (-not $function) { throw "Missing production guard: $name" }
  $function.Extent.Text
}
. ([scriptblock]::Create($definitions -join [Environment]::NewLine))

# Only OS query boundaries are mocked; all path, archive and identity decisions
# below execute the production functions. No listener or database is started.
function Get-NetTCPConnection {
  param([int[]]$LocalPort,[string]$State,[string]$ErrorAction)
  if ($global:workmeshReleaseGuardListenerMode -eq 'occupied') { [pscustomobject]@{ LocalPort=$LocalPort[0]; State='Listen'; OwningProcess=9876 } }
}
function Get-CimInstance {
  param([string]$ClassName,[string]$Filter,[string]$ErrorAction)
  return $script:fakeProcess
}

$validZip = New-TestZip 'valid' @('safe/file.txt')
$hash = (Get-FileHash -LiteralPath $validZip -Algorithm SHA256).Hash
$existing = Join-Path $testRoot 'existing'
New-Item -ItemType Directory -Path $existing | Out-Null
$sentinel = Join-Path $existing 'sentinel.txt'
'preserve me' | Set-Content -LiteralPath $sentinel -NoNewline
Assert-Rejected 'existing OutputDir is rejected' { & $production -BoxZip $validZip -ExpectedSha256 $hash -OutputDir $existing } 'already exists'
Assert-Check 'existing OutputDir contents are preserved' ((Get-Content -LiteralPath $sentinel -Raw) -ceq 'preserve me')

$badHashOutput = Join-Path $testRoot 'bad-hash-output'
Assert-Rejected 'wrong hash rejects before extraction' { & $production -BoxZip $validZip -ExpectedSha256 ('0' * 64) -OutputDir $badHashOutput } 'SHA-256 does not match'
Assert-Check 'wrong hash creates no output directory' (-not (Test-Path -LiteralPath $badHashOutput))
Assert-Rejected 'overlapping ports are rejected' { Assert-FreePorts @(58270,58270,58272) } 'must be distinct'
$global:workmeshReleaseGuardListenerMode = 'occupied'
Assert-Rejected 'occupied port is rejected' { Assert-FreePorts @(58270,58271,58272) } 'already listening'
$global:workmeshReleaseGuardListenerMode = 'none'
Assert-FreePorts @(58270,58271,58272)
Assert-Check 'distinct unoccupied ports are accepted' $true

$overlap = Join-Path $testRoot 'archive-parent'
Assert-Rejected 'archive below output path is rejected' { Get-NewValidationRoot $overlap (Join-Path $overlap 'input.zip') } 'overlaps'
Assert-SafeZip $validZip
Assert-Check 'normal ZIP is accepted' $true
foreach ($entry in @('../escape.txt','nested/../../escape.txt','/absolute.txt','C:/drive.txt','nested/CON.txt','trailing./file.txt','nested//file.txt')) {
  $name = 'unsafe-' + [Guid]::NewGuid().ToString('N')
  $unsafeZip = New-TestZip $name @($entry)
  Assert-Rejected ("rejects unsafe ZIP path: $entry") { Assert-SafeZip $unsafeZip } 'Unsafe ZIP entry'
}
$duplicateZip = New-TestZip 'duplicate' @('a.txt','A.TXT')
Assert-Rejected 'case-insensitive duplicate ZIP names are rejected' { Assert-SafeZip $duplicateZip } 'Duplicate ZIP entry'
$symlinkZip = New-TestZip 'symlink' @('link') -Symlink
Assert-Rejected 'ZIP symlinks are rejected' { Assert-SafeZip $symlinkZip } 'ZIP symlink'
$traversalZip = New-TestZip 'traversal-entrypoint' @('../escape.txt')
$traversalOutput = Join-Path $testRoot 'traversal-output'
$traversalHash = (Get-FileHash -LiteralPath $traversalZip -Algorithm SHA256).Hash
Assert-Rejected 'entrypoint rejects traversal before creating output' { & $production -BoxZip $traversalZip -ExpectedSha256 $traversalHash -OutputDir $traversalOutput } 'Unsafe ZIP entry'
Assert-Check 'traversal creates neither output nor escaped file' (-not (Test-Path -LiteralPath $traversalOutput) -and -not (Test-Path -LiteralPath (Join-Path $testRoot 'escape.txt')))

$junctionTarget = Join-Path $testRoot 'junction-target'
$junction = Join-Path $testRoot 'junction'
New-Item -ItemType Directory -Path $junctionTarget | Out-Null
New-Item -ItemType Junction -Path $junction -Target $junctionTarget | Out-Null
Assert-Rejected 'reparse output ancestor is rejected' { Get-NewValidationRoot (Join-Path $junction 'output') $validZip } 'Reparse point'
$linkedArchive = Join-Path $junction 'archive.zip'
Assert-Rejected 'reparse archive ancestor is rejected' { Get-NewValidationRoot (Join-Path $testRoot 'plain-output') $linkedArchive } 'Reparse point'

$expectedExe = Join-Path $testRoot 'runtime/node.exe'
$expectedEntry = Join-Path $testRoot 'app/main.js'
$script:fakeProcess = [pscustomobject]@{ ExecutablePath=$expectedExe; CommandLine=('"' + $expectedExe + '" "' + $expectedEntry + '"') }
Assert-Check 'process identity accepts the exact executable and argument' (Test-ManagedProcess 9876 $expectedExe $expectedEntry)
$script:fakeProcess.CommandLine = '"' + $expectedExe + '" "' + $expectedEntry + '.foreign"'
Assert-Check 'process identity rejects an argument path prefix collision' (-not (Test-ManagedProcess 9876 $expectedExe $expectedEntry))
$script:fakeProcess.CommandLine = '"' + $expectedExe + '" --log="' + $expectedEntry + '"'
Assert-Check 'process identity rejects a matching path inside another argument' (-not (Test-ManagedProcess 9876 $expectedExe $expectedEntry))
$script:fakeProcess.ExecutablePath = Join-Path $testRoot 'foreign/node.exe'
Assert-Check 'process identity rejects a different executable' (-not (Test-ManagedProcess 9876 $expectedExe $expectedEntry))
Assert-Check 'process identity rejects a system PID' (-not (Test-ManagedProcess 4 $expectedExe $expectedEntry))

$script:data = Join-Path $testRoot 'managed-data'
$script:api = Join-Path $testRoot 'api.js'
$script:web = Join-Path $testRoot 'web.js'
$ApiPort = 58271
$WebPort = 58272
$script:stopScript = Join-Path $testRoot 'must-not-run.ps1'
$stopSentinel = Join-Path $testRoot 'stop-was-called'
('Set-Content -LiteralPath "' + $stopSentinel + '" -Value unsafe') | Set-Content -LiteralPath $script:stopScript
New-Item -ItemType Directory -Path $script:data | Out-Null
@{ dataDir=(Join-Path $testRoot 'foreign-data'); apiPath=$script:api; webPath=$script:web; apiPort=$ApiPort; webPort=$WebPort } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $script:data 'processes.json')
Assert-Rejected 'stop refuses state belonging to another installation' { Stop-OwnedServices 'foreign-stop' } 'does not match'
Assert-Check 'foreign state never invokes packaged stop' (-not (Test-Path -LiteralPath $stopSentinel))

# A child that leaves an inherited output handle open must not hold up the
# command result. The short-lived descendant exits on its own.
$script:data = Join-Path $testRoot 'capture-data'
$pwsh = Join-Path $PSHOME 'pwsh.exe'
$childScript = Join-Path $testRoot 'inherited-output.ps1'
@'
$info = [System.Diagnostics.ProcessStartInfo]::new()
$info.FileName = Join-Path $PSHOME 'pwsh.exe'
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.ArgumentList.Add('-NoProfile')
$info.ArgumentList.Add('-NonInteractive')
$info.ArgumentList.Add('-Command')
$info.ArgumentList.Add('Start-Sleep -Seconds 6')
$descendant = [System.Diagnostics.Process]::Start($info)
@{ outcome='complete'; descendantPid=$descendant.Id; value='postgresql://user:secret@localhost/db' } | ConvertTo-Json -Compress
exit 0
'@ | Set-Content -LiteralPath $childScript -Encoding utf8NoBOM
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$result = (Invoke-LoggedProgram $pwsh @('-NoProfile','-NonInteractive','-File',$childScript) 'inherited-output' 15) | ConvertFrom-Json
$clock.Stop()
Assert-Check 'child exit does not wait for inherited output EOF' ($clock.Elapsed.TotalSeconds -lt 4.5 -and $result.outcome -eq 'complete')
Assert-Check 'command result retains complete JSON' ($result.descendantPid -gt 4 -and $result.value -eq 'postgresql://user:secret@localhost/db')
$retainedLog = Get-Content -LiteralPath (Join-Path $script:logs 'inherited-output.log') -Raw
Assert-Check 'retained logs redact database passwords' ($retainedLog -notmatch ':secret@' -and $retainedLog.Contains(':***@'))
Assert-Rejected 'native nonzero exit is a failure' { Invoke-LoggedProgram $pwsh @('-NoProfile','-NonInteractive','-Command','exit 7') 'nonzero' 15 } 'exit code 7'
Assert-Rejected 'native timeout is a failure' { Invoke-LoggedProgram $pwsh @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 6') 'timeout' 1 } 'exceeded its 1 second limit'

$echoScript = Join-Path $testRoot 'echo-argument.ps1'
'param([string]$Value); [Console]::Write($Value)' | Set-Content -LiteralPath $echoScript -Encoding utf8NoBOM
$argumentValue = 'C:' + [char]92 + 'a path' + [char]92 + [char]34 + 'quoted' + [char]34 + ' &' + [char]92
$echoResult = Invoke-LoggedProgram $pwsh @('-NoProfile','-NonInteractive','-File',$echoScript,$argumentValue) 'quoted-argument' 15
Assert-Check 'native argv preserves spaces, quotes, metacharacters and trailing slash' ($echoResult -ceq $argumentValue)

# An empty SQL result is valid (the verification database must be absent).
function Invoke-LoggedProgram { param($File,$Arguments,$Name,$TimeoutSeconds) return $null }
$script:queryNumber = 0
$script:psql = 'not-executed'
$PgPort = 58270
Assert-Check 'zero-row query returns an empty string without error' ((Invoke-DatabaseQuery 'postgres' 'SELECT 1 WHERE false') -ceq '')

Write-Host "Box lifecycle safety regression passed: $script:checks checks. Evidence retained at $testRoot."
