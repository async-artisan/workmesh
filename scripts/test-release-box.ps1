#Requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$BoxZip,
  [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory)][string]$OutputDir,
  [ValidateRange(1024,65535)][int]$PgPort = 58270,
  [ValidateRange(1024,65535)][int]$ApiPort = 58271,
  [ValidateRange(1024,65535)][int]$WebPort = 58272
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'The Windows Box lifecycle check requires Windows and PowerShell 7.' }

function Assert-NoReparseAncestors([string]$Path) {
  $current = [System.IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Reparse point in validation path: $current" }
    }
    $parent = [System.IO.Path]::GetDirectoryName($current)
    if ($parent -eq $current) { break }
    $current = $parent
  }
}

function Get-NewValidationRoot([string]$OutputPath,[string]$ArchivePath) {
  if ([string]::IsNullOrWhiteSpace($OutputPath)) { throw 'OutputDir must name a new directory.' }
  $output = [System.IO.Path]::GetFullPath($OutputPath).TrimEnd([char[]]'\/')
  $archive = [System.IO.Path]::GetFullPath($ArchivePath)
  Assert-NoReparseAncestors $output
  Assert-NoReparseAncestors $archive
  if (Test-Path -LiteralPath $output) { throw "OutputDir already exists; refusing to reuse it: $output" }
  if (-not [System.IO.Directory]::Exists([System.IO.Path]::GetDirectoryName($output))) { throw 'OutputDir parent must already exist.' }
  if ($output -ieq $archive -or $archive.StartsWith($output + [System.IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'OutputDir overlaps the input archive.' }
  return $output
}

function Assert-FreePorts([int[]]$Ports) {
  if (@($Ports | Select-Object -Unique).Count -ne $Ports.Count) { throw 'PostgreSQL, API and Web ports must be distinct.' }
  foreach ($port in $Ports) {
    if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) { throw "Port $port is already listening; refusing to attach to or stop an existing service." }
  }
}

function Assert-SafeZip([string]$ArchivePath) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  try {
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName.Replace('\','/').TrimEnd('/')
      if (-not $name -or $name.StartsWith('/')) { throw "Unsafe ZIP entry: $($entry.FullName)" }
      foreach ($part in $name.Split('/')) {
        if (-not $part -or $part -in @('.','..') -or $part -match '[<>:"|?*\x00-\x1f]' -or $part -match '[. ]$' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw "Unsafe ZIP entry: $($entry.FullName)" }
      }
      if ((($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw "ZIP symlink is not supported: $name" }
      if (-not $entry.FullName.EndsWith('/') -and -not $entry.FullName.EndsWith('\') -and -not $seen.Add($name)) { throw "Duplicate ZIP entry: $name" }
    }
  } finally { $zip.Dispose() }
  if ($seen.Count -eq 0) { throw 'ZIP has no files.' }
}

function Protect-Log([string]$Text) {
  return $Text -replace '(?i)(postgres(?:ql)?://[^:/?#\s]+:)[^@/?#\s]+@','$1***@'
}

function Invoke-LoggedProgram([string]$File,[string[]]$Arguments,[string]$Name,[int]$TimeoutSeconds=180) {
  # Raw captures stay with the isolated data (which already contains config
  # credentials), never in the sanitized logs artifact. Descendants can retain
  # the capture file handle until the owned services stop.
  $captureDir = Join-Path $script:data 'lifecycle-capture'
  New-Item -ItemType Directory -Path $captureDir -Force | Out-Null
  $stdoutPath = Join-Path $captureDir ($Name + '.capture')
  $stderrPath = Join-Path $captureDir ($Name + '.err.capture')
  # Start-Process redirects to files without waiting for EOF on a pipe inherited
  # by PostgreSQL or another background descendant. Quote arguments for the
  # native Windows command line; no shell interprets these arguments.
  $quotedArguments = foreach ($argument in $Arguments) {
    $quoted = [string][char]34
    $backslashes = 0
    foreach ($character in $argument.ToCharArray()) {
      if ($character -eq [char]92) { $backslashes++; continue }
      if ($character -eq [char]34) {
        $quoted += ([string][char]92) * (2 * $backslashes + 1)
      } else {
        $quoted += ([string][char]92) * $backslashes
      }
      $quoted += $character
      $backslashes = 0
    }
    $quoted += ([string][char]92) * (2 * $backslashes)
    $quoted += [char]34
    $quoted
  }
  $process = Start-Process -FilePath $File -ArgumentList $quotedArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  try {
    $null = $process.Handle
    $finished = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $finished) {
      # Only this explicitly-created child is killed; owned application/PG
      # services are checked separately by the lifecycle cleanup below.
      $process.Kill()
      [void]$process.WaitForExit(5000)
    }
    # Drain already-emitted asynchronous file writes, with a bounded stability
    # window. Do not wait for EOF inherited by long-running descendants.
    $previous = ''
    $stable = 0
    $drainDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
      $stdout = [string](Get-Content -LiteralPath $stdoutPath -Raw)
      $stderr = [string](Get-Content -LiteralPath $stderrPath -Raw)
      $snapshot = $stdout + [char]0 + $stderr
      if ($snapshot -ceq $previous) { $stable++ } else { $stable=0; $previous=$snapshot }
      if ($stable -ge 2) { break }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $drainDeadline)
    Protect-Log $stdout | Set-Content -LiteralPath (Join-Path $script:logs ($Name + '.log')) -Encoding utf8NoBOM
    Protect-Log $stderr | Set-Content -LiteralPath (Join-Path $script:logs ($Name + '.err.log')) -Encoding utf8NoBOM
    if (-not $finished) { throw "$Name exceeded its $TimeoutSeconds second limit; see its retained logs." }
    if ($null -eq $process.ExitCode) { throw "$Name completed without a readable exit code." }
    if ($process.ExitCode -ne 0) { throw "$Name failed with exit code $($process.ExitCode); see its retained logs." }
    return $stdout
  } finally { $process.Dispose() }
}

function Invoke-PackageScript([string]$Name,[string]$File,[string[]]$Arguments) {
  [void](Invoke-LoggedProgram $script:pwsh (@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$File) + $Arguments) $Name)
}

function Test-ManagedProcess([int]$ProcessId,[string]$ExpectedExe,[string]$ExpectedArgument) {
  if ($ProcessId -le 4) { return $false }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  $expected = [System.IO.Path]::GetFullPath($ExpectedArgument)
  $command = ([string]$process.CommandLine).Replace('/','\')
  $argumentPattern = '(?i)(?:^|\s)(?:"' + [regex]::Escape($expected) + '"|' + [regex]::Escape($expected) + ')(?=\s|$)'
  return ([string]$process.ExecutablePath -ieq [System.IO.Path]::GetFullPath($ExpectedExe)) -and $command -match $argumentPattern
}

function Assert-OwnedPostgres {
  $pidFile = Join-Path $script:pgData 'postmaster.pid'
  if (-not (Test-Path -LiteralPath $pidFile)) { throw 'Owned PostgreSQL PID file is missing.' }
  $lines = @(Get-Content -LiteralPath $pidFile)
  [int]$serverPid = 0
  [int]$serverPort = 0
  if ($lines.Count -lt 4 -or -not [int]::TryParse($lines[0],[ref]$serverPid) -or -not [int]::TryParse($lines[3],[ref]$serverPort) -or $serverPort -ne $PgPort -or [System.IO.Path]::GetFullPath($lines[1]) -ine $script:pgData) { throw 'PostgreSQL PID file does not match this validation DataDir and port.' }
  if (-not (Test-ManagedProcess $serverPid $script:postgres $script:pgData)) { throw 'PostgreSQL PID/executable/command line does not belong to this validation.' }
  $listeners = @(Get-NetTCPConnection -LocalPort $PgPort -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0 -or @($listeners | Where-Object { $_.OwningProcess -ne $serverPid }).Count -gt 0) { throw 'PostgreSQL listener is not owned by the expected validation process.' }
}

function Assert-OwnedApplication([switch]$AllowExited) {
  $stateFile = Join-Path $script:data 'processes.json'
  if (-not (Test-Path -LiteralPath $stateFile)) {
    if ($AllowExited) { return }
    throw 'Owned application process state is missing.'
  }
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if ([System.IO.Path]::GetFullPath([string]$state.dataDir) -ine $script:data -or [string]$state.apiPath -ine $script:api -or [string]$state.webPath -ine $script:web -or [int]$state.apiPort -ne $ApiPort -or [int]$state.webPort -ne $WebPort) { throw 'Application state does not match this validation installation.' }
  foreach ($target in @(@{ Pid=[int]$state.apiPid; Path=$script:api; Port=$ApiPort },@{ Pid=[int]$state.webPid; Path=$script:web; Port=$WebPort })) {
    if ($AllowExited -and -not (Get-Process -Id $target.Pid -ErrorAction SilentlyContinue)) { continue }
    if (-not (Test-ManagedProcess $target.Pid $script:node $target.Path)) { throw 'Application PID/executable/command line does not belong to this validation.' }
    if (-not $AllowExited) {
      $listeners = @(Get-NetTCPConnection -LocalPort $target.Port -State Listen -ErrorAction SilentlyContinue)
      if ($listeners.Count -eq 0 -or @($listeners | Where-Object { $_.OwningProcess -ne $target.Pid }).Count -gt 0) { throw 'Application listener ownership differs from its process state.' }
    }
  }
}

function Stop-OwnedServices([string]$Name) {
  if (-not (Test-Path -LiteralPath $script:stopScript)) { return }
  Assert-OwnedApplication -AllowExited
  if (Test-Path -LiteralPath (Join-Path $script:pgData 'postmaster.pid')) { Assert-OwnedPostgres }
  Invoke-PackageScript $Name $script:stopScript @('-DataDir',$script:data)
  $deadline = (Get-Date).AddSeconds(10)
  do {
    if (@(Get-NetTCPConnection -LocalPort $PgPort,$ApiPort,$WebPort -State Listen -ErrorAction SilentlyContinue).Count -eq 0) { return }
    if ((Get-Date) -ge $deadline) { throw 'A validation port is still listening after owned-service stop; no unknown process will be terminated.' }
    Start-Sleep -Milliseconds 200
  } while ($true)
}

function Read-OwnConfiguration([string]$DatabaseName) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath (Join-Path $script:data 'config.env')) {
    if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
  }
  $url = [Uri]$values.WORKMESH_V1_DATABASE_URL
  if ($url.Scheme -ne 'postgresql' -or $url.Host -ne '127.0.0.1' -or $url.Port -ne $PgPort -or $url.AbsolutePath -ne ('/' + $DatabaseName) -or $url.Query -ne '?schema=workmesh_v1' -or $url.UserInfo.Split(':',2)[0] -ne 'postgres') { throw 'Generated configuration is not the exact isolated validation database.' }
  foreach ($key in $values.Keys) { [Environment]::SetEnvironmentVariable($key,$values[$key],'Process') }
  $env:PGPASSWORD = [Uri]::UnescapeDataString($url.UserInfo.Split(':',2)[1])
  $env:WORKMESH_PG_BIN = $script:pgBin
}

function Invoke-DatabaseQuery([string]$DatabaseName,[string]$Sql) {
  $script:queryNumber++
  return ([string](Invoke-LoggedProgram $script:psql @('-h','127.0.0.1','-p',[string]$PgPort,'-U','postgres','-d',$DatabaseName,'-v','ON_ERROR_STOP=1','-At','-c',$Sql) ('sql-' + $script:queryNumber.ToString('000')))).Trim()
}

function Assert-Healthy([string]$Phase) {
  Assert-OwnedPostgres
  Assert-OwnedApplication
  $apiResult = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $ApiPort + '/api/health') -TimeoutSec 10
  $proxyResult = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $WebPort + '/api/health') -TimeoutSec 10
  $webResult = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $WebPort + '/') -UseBasicParsing -TimeoutSec 10
  if ($apiResult.data.status -ne 'ok' -or $proxyResult.data.status -ne 'ok' -or $webResult.StatusCode -ne 200) { throw "$Phase API/Web health checks failed." }
  $script:checks.Add([ordered]@{ phase=$Phase; api='ok'; proxy='ok'; web=200 })
}

$archive = [System.IO.Path]::GetFullPath($BoxZip)
if (-not [System.IO.File]::Exists($archive)) { throw 'BoxZip is not an existing file.' }
$output = Get-NewValidationRoot $OutputDir $archive
Assert-FreePorts @($PgPort,$ApiPort,$WebPort)
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $ExpectedSha256.ToLowerInvariant()) { throw 'BoxZip SHA-256 does not match ExpectedSha256; no validation directory was created.' }
Assert-SafeZip $archive

$script:pwsh = Join-Path $PSHOME 'pwsh.exe'
$script:box = Join-Path $output 'box'
$script:data = Join-Path $output 'data'
$script:logs = Join-Path $output 'logs'
$script:pgData = Join-Path $script:data 'pg'
$script:pgBin = Join-Path $script:box 'runtime/pgsql/bin'
$script:postgres = Join-Path $script:pgBin 'postgres.exe'
$script:psql = Join-Path $script:pgBin 'psql.exe'
$script:node = Join-Path $script:box 'runtime/node.exe'
$script:api = Join-Path $script:box 'app/api/dist/main.js'
$script:web = Join-Path $script:box 'scripts/web-server.mjs'
$script:stopScript = Join-Path $script:box 'stop-workmesh.ps1'
$script:queryNumber = 0
$script:checks = [System.Collections.Generic.List[object]]::new()
$run = [Guid]::NewGuid().ToString('N')
$database = 'workmesh_test_release_' + $run.Substring(0,12)
$restoredDatabase = 'workmesh_test_restore_' + $run.Substring(0,12)
$marker = 'release-validation-' + $run
$savedEnvironment = @{}
foreach ($key in @('WORKMESH_V1_DATABASE_URL','WORKMESH_COOKIE_MODE','WORKMESH_PUBLIC_ORIGIN','WEB_ORIGIN','PORT','PGPASSWORD','WORKMESH_PG_BIN')) { $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
$summary = [ordered]@{ schemaVersion='1.0'; status='RUNNING'; archive=[System.IO.Path]::GetFileName($archive); archiveSha256=$hash; ports=@{ postgres=$PgPort; api=$ApiPort; web=$WebPort }; checks=$script:checks; limitations=@('Local isolated Windows validation; not a clean-machine or final-commit CI claim.','No prior-version upgrade, uninstall, production data, capacity or cross-platform validation.') }
$failure = $null
New-Item -ItemType Directory -Path $output,$script:logs -ErrorAction Stop | Out-Null
try {
  Expand-Archive -LiteralPath $archive -DestinationPath $script:box
  foreach ($required in @($script:node,$script:postgres,$script:psql,$script:api,$script:web,$script:stopScript,(Join-Path $script:box 'install.ps1'),(Join-Path $script:box 'start-workmesh.ps1'),(Join-Path $script:box 'app/box/dist/index.js'))) { if (-not (Test-Path -LiteralPath $required)) { throw 'Box is missing a required lifecycle entrypoint/runtime.' } }
  $migrationNames = @(Get-ChildItem -LiteralPath (Join-Path $script:box 'app/api/prisma/migrations') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'migration.sql') } | Sort-Object Name | ForEach-Object Name)
  if ($migrationNames.Count -eq 0) { throw 'Packaged migration set is empty.' }
  Assert-FreePorts @($PgPort,$ApiPort,$WebPort)
  Invoke-PackageScript 'install' (Join-Path $script:box 'install.ps1') @('-DataDir',$script:data,'-PgPort',[string]$PgPort,'-ApiPort',[string]$ApiPort,'-WebPort',[string]$WebPort,'-DatabaseName',$database)
  Read-OwnConfiguration $database
  Assert-OwnedPostgres
  $identity = Invoke-DatabaseQuery 'postgres' "SELECT current_setting('data_directory') || chr(9) || current_setting('port')"
  $identityParts = $identity.Split([char]9)
  if ($identityParts.Count -ne 2 -or [System.IO.Path]::GetFullPath($identityParts[0]) -ine $script:pgData -or [int]$identityParts[1] -ne $PgPort) { throw 'SQL instance identity differs from the isolated DataDir/port.' }
  $applied = @( (Invoke-DatabaseQuery $database 'SELECT migration_name FROM workmesh_v1."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name').Split([char]10) | ForEach-Object { $_.Trim() } )
  if (@(Compare-Object $migrationNames $applied).Count -gt 0) { throw 'Applied migrations do not match every packaged migration.' }
  $summary.migrations = $applied.Count
  Invoke-PackageScript 'start' (Join-Path $script:box 'start-workmesh.ps1') @('-DataDir',$script:data)
  Assert-Healthy 'first-start'
  Stop-OwnedServices 'stop-before-cold-start'
  Invoke-PackageScript 'cold-start' (Join-Path $script:box 'start-workmesh.ps1') @('-DataDir',$script:data)
  Assert-Healthy 'cold-start'
  $before = Get-Content -LiteralPath (Join-Path $script:data 'processes.json') -Raw | ConvertFrom-Json
  Invoke-PackageScript 'idempotent-start' (Join-Path $script:box 'start-workmesh.ps1') @('-DataDir',$script:data)
  $after = Get-Content -LiteralPath (Join-Path $script:data 'processes.json') -Raw | ConvertFrom-Json
  if ($before.apiPid -ne $after.apiPid -or $before.webPid -ne $after.webPid) { throw 'Repeated start replaced the running processes.' }
  Assert-Healthy 'idempotent-start'
  [void](Invoke-DatabaseQuery $database ("CREATE TABLE workmesh_v1._release_validation (marker text PRIMARY KEY); INSERT INTO workmesh_v1._release_validation VALUES ('" + $marker + "')"))
  $tableCount = [int](Invoke-DatabaseQuery $database "SELECT count(*) FROM information_schema.tables WHERE table_schema='workmesh_v1'")
  $boxEntry = Join-Path $script:box 'app/box/dist/index.js'
  $backup = (Invoke-LoggedProgram $script:node @($boxEntry,'backup','--verify','--data-dir',$script:data,'--install-root',$script:box,'--json') 'backup-verify') | ConvertFrom-Json
  if ($backup.verification.tables -ne $tableCount -or $backup.verification.migrationsApplied -ne $applied.Count -or $backup.manifest.dumpSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Backup verification counts/hash are missing or inconsistent.' }
  $leftovers = Invoke-DatabaseQuery 'postgres' "SELECT datname FROM pg_database WHERE datname LIKE 'workmesh_backup_verify_%'"
  if ($leftovers) { throw 'Box backup verification left a temporary database behind.' }
  $restore = (Invoke-LoggedProgram $script:node @($boxEntry,'restore','--from',[string]$backup.dir,'--database',$restoredDatabase,'--yes','--data-dir',$script:data,'--install-root',$script:box,'--json') 'restore') | ConvertFrom-Json
  if ($restore.database -ne $restoredDatabase -or $restore.tables -ne $tableCount -or (Invoke-DatabaseQuery $restoredDatabase 'SELECT marker FROM workmesh_v1._release_validation') -ne $marker) { throw 'Restored table count or marker differs from the source.' }
  $summary.backup = @{ tables=$tableCount; migrations=$applied.Count; dumpSha256=$backup.manifest.dumpSha256; verificationDatabaseRemoved=$true; restoredMarkerMatches=$true }
  Stop-OwnedServices 'stop-before-restored-app'
  $configPath = Join-Path $script:data 'config.env'
  $config = @(Get-Content -LiteralPath $configPath | ForEach-Object { if ($_.StartsWith('WORKMESH_V1_DATABASE_URL=')) { $_.Replace('/' + $database + '?','/' + $restoredDatabase + '?') } else { $_ } })
  $config | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
  Read-OwnConfiguration $restoredDatabase
  Invoke-PackageScript 'install-restored-database' (Join-Path $script:box 'install.ps1') @('-DataDir',$script:data,'-DatabaseName',$restoredDatabase)
  Invoke-PackageScript 'start-restored-database' (Join-Path $script:box 'start-workmesh.ps1') @('-DataDir',$script:data)
  Assert-Healthy 'restored-database'
  if ((Invoke-DatabaseQuery $restoredDatabase 'SELECT marker FROM workmesh_v1._release_validation') -ne $marker) { throw 'Restored application database lost the verification marker.' }
  $summary.status = 'PASSED'
} catch {
  $failure = $_
  $summary.status = 'FAILED'
  $summary.error = Protect-Log $_.Exception.Message
} finally {
  try { Stop-OwnedServices 'final-stop'; $summary.ownedServicesStopped=$true }
  catch { $summary.ownedServicesStopped=$false; $summary.cleanupError=$_.Exception.Message; if (-not $failure) { $failure=$_ }; $summary.status='FAILED' }
  foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key,$savedEnvironment[$key],'Process') }
  $summary.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
  $summary | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $output 'summary.json') -Encoding utf8NoBOM
}
if ($failure) { throw $failure }
Write-Host "Box lifecycle validation passed; evidence retained at $output. No validation directories were deleted."
