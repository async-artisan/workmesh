#Requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$SyftExe,
  [Parameter(Mandatory)][string]$BoxRoot,
  [Parameter(Mandatory)][string]$CliRoot,
  [Parameter(Mandatory)][string]$BoxZip,
  [Parameter(Mandatory)][string]$CliZip,
  [Parameter(Mandatory)][string]$OutputDir,
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$Commit,
  [ValidateSet('clean','dirty','unknown')][string]$SourceTreeState = 'unknown'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant() }
  finally { $hasher.Dispose(); $stream.Dispose() }
}

function Assert-NoReparseAncestors([string]$Path) {
  $current = [System.IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "Reparse points are not allowed in scan paths: $current"
      }
    }
    $parent = [System.IO.Path]::GetDirectoryName($current)
    if ($parent -eq $current) { break }
    $current = $parent
  }
}

function Assert-OutputLocation([string]$OutputPath, [string[]]$Inputs) {
  $output = [System.IO.Path]::GetFullPath($OutputPath).TrimEnd([char[]]'\/')
  Assert-NoReparseAncestors $output
  if (Test-Path -LiteralPath $output) { throw "OutputDir must not already exist: $output" }
  foreach ($inputPath in $Inputs) {
    $inputFull = [System.IO.Path]::GetFullPath($inputPath).TrimEnd([char[]]'\/')
    Assert-NoReparseAncestors $inputFull
    if ($output -ieq $inputFull -or $output.StartsWith($inputFull + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $inputFull.StartsWith($output + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "OutputDir overlaps an input path: $inputFull"
    }
  }
  return $output
}

function Get-SafeArchiveName([string]$Name) {
  $normalized = $Name.Replace('\','/')
  if (-not $normalized -or $normalized.StartsWith('/')) { throw "Unsafe ZIP entry: $Name" }
  $normalized = $normalized.TrimEnd('/')
  foreach ($part in $normalized.Split('/')) {
    if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>:"|?*\x00-\x1f]' -or $part -match '[. ]$' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
      throw "Unsafe ZIP entry: $Name"
    }
  }
  return $normalized
}

function Get-ArchiveInventory([string]$ArchivePath) {
  $archiveHash = Get-Sha256 $ArchivePath
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  $entries = [System.Collections.Generic.List[object]]::new()
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [long]$expandedBytes = 0
  try {
    foreach ($entry in $zip.Entries) {
      $name = Get-SafeArchiveName $entry.FullName
      if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) { continue }
      if (-not $seen.Add($name)) { throw "Duplicate ZIP file entry: $name" }
      $stream = $entry.Open()
      $hasher = [System.Security.Cryptography.SHA256]::Create()
      try { $hash = [Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant() }
      finally { $hasher.Dispose(); $stream.Dispose() }
      $entries.Add([pscustomobject]@{ Path=$name; Length=$entry.Length; Sha256=$hash })
      $expandedBytes += $entry.Length
    }
  } finally { $zip.Dispose() }
  if ($entries.Count -eq 0) { throw 'Release ZIP contains no files.' }
  return [pscustomobject]@{ Entries=$entries.ToArray(); ArchiveSha256=$archiveHash; FileCount=$entries.Count; ExpandedBytes=$expandedBytes }
}

function Assert-ArchiveTree([string]$Root, [object]$Inventory) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]'\/')
  Assert-NoReparseAncestors $rootFull
  if (-not [System.IO.Directory]::Exists($rootFull)) { throw "Scan root is not a directory: $rootFull" }
  $expected = [System.Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $Inventory.Entries) { $expected.Add($entry.Path, $entry) }
  $pending = [System.Collections.Generic.Stack[string]]::new()
  $pending.Push($rootFull)
  [int]$count = 0
  while ($pending.Count -gt 0) {
    foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Scan tree contains a reparse point: $($item.FullName)" }
      if ($item.PSIsContainer) { $pending.Push($item.FullName); continue }
      $relative = [System.IO.Path]::GetRelativePath($rootFull, $item.FullName).Replace('\','/')
      if (-not $expected.ContainsKey($relative)) { throw "Scan tree contains a file absent from ZIP: $relative" }
      $entry = $expected[$relative]
      if ($item.Length -ne $entry.Length -or (Get-Sha256 $item.FullName) -ne $entry.Sha256) { throw "Scan tree differs from ZIP: $relative" }
      $count++
    }
  }
  if ($count -ne $Inventory.FileCount) { throw "Scan tree is missing ZIP files: expected $($Inventory.FileCount), found $count" }
}

function Assert-PinnedSyft([string]$Path) {
  # The Windows AMD64 executable is from the checksum-verified upstream ZIP:
  # syft_1.57.0_windows_amd64.zip SHA256
  # 06e9663e55f7f38ff966710670fbe0763182c621f7ac2f191bcb209a6dfbd969.
  $hash = Get-Sha256 $Path
  if ($hash -ne '66327bc7261636c1a5d4214b40a5890b7845484fa5bc36f8515bfbb203e13476') { throw 'Syft executable does not match the pinned Windows AMD64 distribution.' }
  $result = & $Path version -o json
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read Syft version.' }
  $metadata = ($result -join [Environment]::NewLine) | ConvertFrom-Json
  if ($metadata.version -ne '1.57.0' -or $metadata.gitCommit -ne '30f4bce762f31136e055f2965185f12eb95fbe47' -or $metadata.platform -ne 'windows/amd64') {
    throw 'Syft version/platform/source commit does not match the pinned scanner.'
  }
  return [pscustomobject]@{ name='syft'; version=$metadata.version; commit=$metadata.gitCommit; platform=$metadata.platform; executableSha256=$hash; distributionSha256='06e9663e55f7f38ff966710670fbe0763182c621f7ac2f191bcb209a6dfbd969' }
}

function Get-ScanEvidence([string]$NativeJson, [string]$CycloneDxJson, [string]$Kind) {
  $native = Get-Content -LiteralPath $NativeJson -Raw | ConvertFrom-Json -Depth 100
  $cdx = Get-Content -LiteralPath $CycloneDxJson -Raw | ConvertFrom-Json -Depth 100
  if ($native.descriptor.name -ne 'syft' -or $native.descriptor.version -ne '1.57.0' -or $cdx.bomFormat -ne 'CycloneDX' -or @($cdx.components).Count -eq 0) {
    throw "Invalid or empty scanner output for $Kind."
  }
  $used = @($native.descriptor.configuration.catalogers.used)
  if ($used -notcontains 'javascript-package-cataloger' -or $used -notcontains 'pe-binary-package-cataloger' -or $used -contains 'javascript-lock-cataloger' -or $used -contains 'github-actions-usage-cataloger' -or $used -contains 'github-action-workflow-usage-cataloger') {
    throw "Unexpected cataloger coverage for $Kind."
  }
  if ($native.descriptor.configuration.packages.javascript.'include-dev-dependencies' -ne $true -or $native.descriptor.configuration.files.selection -ne 'all' -or @($native.descriptor.configuration.files.hashers) -notcontains 'sha-256') {
    throw "Unexpected dependency or file-digest coverage for $Kind."
  }
  $artifacts = @($native.artifacts)
  $node = @($artifacts | Where-Object { $_.name -eq 'Node.js' -and $_.version -and $_.version -ne 'UNKNOWN' -and $_.foundBy -eq 'pe-binary-package-cataloger' -and @($_.locations | Where-Object { $_.path -match '(^|/)runtime/node\.exe$' }).Count -gt 0 })
  if ($node.Count -eq 0) { throw "$Kind scan did not identify the packaged Node runtime." }
  if ($Kind -eq 'box') {
    $postgres = @($artifacts | Where-Object { $_.name -eq 'PostgreSQL' -and $_.version -and $_.version -ne 'UNKNOWN' -and @($_.locations | Where-Object { $_.path -match '(^|/)runtime/pgsql/bin/postgres\.exe$' }).Count -gt 0 })
    $prisma = @($artifacts | Where-Object { $_.name -eq 'prisma' -and $_.type -eq 'npm' -and $_.foundBy -eq 'javascript-package-cataloger' -and $_.version -and $_.version -ne 'UNKNOWN' })
    if ($postgres.Count -eq 0 -or $prisma.Count -eq 0) { throw 'Box scan must identify PostgreSQL and the deployed Prisma CLI.' }
  }
  $unknown = @($artifacts | Where-Object { -not $_.version -or $_.version -eq 'UNKNOWN' } | ForEach-Object { [ordered]@{ name=$_.name; version=$_.version; type=$_.type; foundBy=$_.foundBy; locations=@($_.locations.path) } })
  return [ordered]@{ kind=$Kind; components=$artifacts.Count; npmComponents=@($artifacts | Where-Object { $_.type -eq 'npm' }).Count; unknownVersionComponents=$unknown; schemaValidation='JSON structure and required components checked; full CycloneDX schema validation is still required'; nativeJson=[System.IO.Path]::GetFileName($NativeJson); cyclonedxJson=[System.IO.Path]::GetFileName($CycloneDxJson) }
}

function Get-HostPathFindings([object]$Value, [string]$Pointer = '') {
  if ($Value -is [string]) {
    if ($Value -match '^(?:(?:file:[/\\]*|dir:))?[A-Za-z]:[/\\]' -or $Value.StartsWith('\\')) { return $Pointer }
    return
  }
  if ($Value -is [System.Collections.IDictionary]) {
    foreach ($key in $Value.Keys) { Get-HostPathFindings $Value[$key] ($Pointer + '/' + $key) }
  } elseif ($Value -is [System.Collections.IEnumerable]) {
    [int]$index = 0
    foreach ($item in $Value) { Get-HostPathFindings $item ($Pointer + '/' + $index); $index++ }
  }
}

function Normalize-ScanOutput([string]$Path, [string]$Format) {
  $originalHash = Get-Sha256 $Path
  $document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -Depth 100
  $normalized = [System.Collections.Generic.List[string]]::new()
  if ($Format -eq 'syft') {
    if ($document.source.metadata.Contains('path')) { $document.source.metadata.path = '.'; $normalized.Add('/source/metadata/path') }
    $packages = $document.descriptor.configuration.packages
    foreach ($pair in @(@('golang','local-mod-cache-dir'),@('golang','local-vendor-dir'),@('java-archive','maven-localrepository-dir'))) {
      if ($packages.Contains($pair[0]) -and $packages[$pair[0]].Contains($pair[1]) -and $packages[$pair[0]][$pair[1]]) {
        $packages[$pair[0]][$pair[1]] = '<unused-host-default>'
        $normalized.Add('/descriptor/configuration/packages/' + $pair[0] + '/' + $pair[1])
      }
    }
  } elseif ($Format -eq 'cyclonedx') {
    if (-not $document.metadata.Contains('properties')) { $document.metadata.properties = @() }
    $document.metadata.properties = @($document.metadata.properties) + @(
      @{ name='workmesh:inventory:status'; value='DRAFT_PARTIAL_COVERAGE' }
      @{ name='workmesh:inventory:limitations'; value='Bundled JavaScript and embedded runtime components require supplemental evidence; see artifact-sbom-draft.json.' }
    )
  } else { throw "Unknown scanner output format: $Format" }
  $findings = @(Get-HostPathFindings $document)
  if ($findings.Count -gt 0) { throw "Unreviewed host path remains in $Format output at $($findings[0]); do not redistribute it." }
  $document | ConvertTo-Json -Depth 100 -Compress | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
  return [ordered]@{ originalScannerOutputSha256=$originalHash; normalizedFields=$normalized.ToArray(); hostPathCheck='No Windows drive/UNC path string values remain; archive-root POSIX evidence paths are retained.' }
}

if ($Commit -notmatch '^[a-fA-F0-9]{40}$') { throw 'Commit must be a full declared source SHA.' }
if ($Version -notmatch '^[0-9A-Za-z.+-]+$') { throw 'Version contains invalid source-label characters.' }
if (@(Get-ChildItem Env: | Where-Object { $_.Name -like 'SYFT_*' }).Count -gt 0) { throw 'Clear ambient SYFT_* variables before generating release evidence.' }
$config = Join-Path $PSScriptRoot 'release-artifact-sbom.syft.yaml'
foreach ($file in @($SyftExe,$BoxZip,$CliZip,$config)) {
  if (-not [System.IO.File]::Exists([System.IO.Path]::GetFullPath($file))) { throw "Input file not found: $file" }
}
$output = Assert-OutputLocation $OutputDir @($SyftExe,$BoxRoot,$CliRoot,$BoxZip,$CliZip,$config)
$scanner = Assert-PinnedSyft $SyftExe
$boxInventory = Get-ArchiveInventory $BoxZip
$cliInventory = Get-ArchiveInventory $CliZip
Assert-ArchiveTree $BoxRoot $boxInventory
Assert-ArchiveTree $CliRoot $cliInventory
$releaseManifest = Get-Content -LiteralPath (Join-Path $BoxRoot 'release-manifest.json') -Raw | ConvertFrom-Json
if ($releaseManifest.version -ne $Version) { throw 'Box release-manifest version does not match Version.' }
$nestedCli = Join-Path $BoxRoot 'downloads/workmesh-cli-win-x64.zip'
if ((Get-Sha256 $nestedCli) -ne $cliInventory.ArchiveSha256) { throw 'Independent CLI ZIP does not match the CLI ZIP bundled in Box.' }
$configHash = Get-Sha256 $config
New-Item -ItemType Directory -Path $output -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath $config -Destination (Join-Path $output 'artifact-sbom.syft.yaml')
$scans = [System.Collections.Generic.List[object]]::new()
foreach ($target in @(@{ Kind='box'; Root=$BoxRoot; Zip=$BoxZip; Inventory=$boxInventory },@{ Kind='cli'; Root=$CliRoot; Zip=$CliZip; Inventory=$cliInventory })) {
  $kind = $target.Kind
  $nativePath = Join-Path $output "workmesh-$kind.syft.json"
  $cdxPath = Join-Path $output "workmesh-$kind.cdx.json"
  & $SyftExe scan --config $config --source-name ([System.IO.Path]::GetFileName($target.Zip)) --source-version $Version ('dir:' + [System.IO.Path]::GetFullPath($target.Root)) -o ('syft-json=' + $nativePath) -o ('cyclonedx-json=' + $cdxPath) 2> (Join-Path $output "workmesh-$kind.scan.log")
  if ($LASTEXITCODE -ne 0) { throw "Syft $kind scan failed; diagnostic output is retained in OutputDir." }
  $nativeNormalization = Normalize-ScanOutput $nativePath 'syft'
  $cdxNormalization = Normalize-ScanOutput $cdxPath 'cyclonedx'
  $evidence = Get-ScanEvidence $nativePath $cdxPath $kind
  $evidence.normalization = [ordered]@{ native=$nativeNormalization; cyclonedx=$cdxNormalization }
  Assert-ArchiveTree $target.Root $target.Inventory
  if ((Get-Sha256 $target.Zip) -ne $target.Inventory.ArchiveSha256) { throw 'ZIP changed during scanning.' }
  $evidence.archive = [System.IO.Path]::GetFileName($target.Zip)
  $evidence.archiveSha256 = $target.Inventory.ArchiveSha256
  $evidence.verifiedArchiveFiles = $target.Inventory.FileCount
  $evidence.verifiedExpandedBytes = $target.Inventory.ExpandedBytes
  $scans.Add($evidence)
}
if ((Get-Sha256 $config) -ne $configHash -or (Get-Sha256 $SyftExe) -ne $scanner.executableSha256) { throw 'Scanner or configuration changed during scanning.' }
$manifest = [ordered]@{
  schemaVersion='1.0'; status='DRAFT_PARTIAL_COVERAGE'; generatedAt=(Get-Date).ToUniversalTime().ToString('o'); version=$Version
  declaredSourceCommit=$Commit.ToLowerInvariant(); declaredSourceTreeState=$SourceTreeState
  sourceBinding='Caller-declared source metadata; this script verifies archive bytes and scan inputs, not checkout cleanliness or build provenance.'
  scanner=$scanner; configuration=[ordered]@{ file='artifact-sbom.syft.yaml'; sourceFile='release-artifact-sbom.syft.yaml'; sha256=$configHash }; scans=$scans.ToArray()
  archiveRelationship=[ordered]@{ parent=$boxInventory.ArchiveSha256; child=$cliInventory.ArchiveSha256; childPath='downloads/workmesh-cli-win-x64.zip'; verified=$true }
  limitations=@(
    'Partial artifact inventory; it does not satisfy the complete release SBOM gate.'
    'CLI/Web bundled JavaScript dependencies require actual bundle module graphs mapped to pinned versions, PURLs and licenses.'
    'PE runtime records do not enumerate every embedded Node/PostgreSQL component; supplier SBOM/source/license evidence is required.'
    'UNKNOWN versions, package classifications, dependency relationships and license completeness require review.'
    'Nested archives are not assumed covered; the bundled CLI ZIP is hash-bound and independently scanned.'
    'Full CycloneDX schema validation and merging the missing component evidence remain release requirements.'
    'Syft JSON is normalized evidence: scan root and unused host cache defaults are replaced; original scanner-output hashes are recorded.'
    'Scan logs are private diagnostics and may include local paths; do not attach them to public releases.'
  )
}
$manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $output 'artifact-sbom-draft.json') -Encoding utf8NoBOM
$checksums = foreach ($file in Get-ChildItem -LiteralPath $output -File | Sort-Object Name) { (Get-Sha256 $file.FullName) + '  ' + $file.Name }
$checksums | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii
Write-Host "Draft artifact inventories written to $output. Complete SBOM gate remains open."
