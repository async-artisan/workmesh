#Requires -Version 7.0
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('workmesh-artifact-sbom-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$script:checks = 0
function Assert-Check([string]$Name, [bool]$Passed) {
  $script:checks++
  if (-not $Passed) { throw "FAILED: $Name (fixtures retained at $testRoot)" }
  Write-Host "PASS: $Name"
}
function Assert-Throws([string]$Name, [scriptblock]$Action, [string]$Pattern) {
  try { & $Action | Out-Null } catch {
    Assert-Check $Name ($_.Exception.Message -match $Pattern)
    return
  }
  Assert-Check $Name $false
}
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'release-artifact-sbom.ps1'), [ref]$tokens, [ref]$parseErrors)
Assert-Check 'production script parses' ($parseErrors.Count -eq 0)
$production = $ast.Extent.Text
Assert-Check 'bundle merger is included in stable evidence tool hashes' ($production -match '\$evidenceSources = @\([^\r\n]*\$bundleMerger')
Assert-Check 'bundle merge happens before strict CycloneDX validation' ($production.IndexOf('$mergeResult = & node $bundleMerger') -ge 0 -and $production.IndexOf('$mergeResult = & node $bundleMerger') -lt $production.IndexOf('& node $schemaValidator $cdxPath'))
Assert-Check 'bundle merge failure aborts scan evidence generation' ($production -match 'if \(\$LASTEXITCODE -ne 0\) \{ throw "Conservative rendered bundle merge failed')
Assert-Check 'bundle merge summary is retained in scan manifest' ($production.Contains('$evidence.bundleMerge ='))
$bundleAssignment = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -match '^(?:\[string\[\]\])?\$bundleDirectories$' }, $true)
$mergeInvocation = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$mergeResult' }, $true)
if (-not $bundleAssignment -or -not $mergeInvocation) { throw 'Production bundle argument statements are missing.' }
$bundleMerger = Join-Path $testRoot 'native argv fixture.mjs'
[System.IO.File]::WriteAllText($bundleMerger, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));')
$cdxPath = Join-Path $testRoot 'fixture document.cdx.json'
$target = @{ Root=(Join-Path $testRoot 'archive root'); Inventory=@{ ArchiveSha256=('a' * 64) } }
foreach ($kind in @('box','cli')) {
  # Execute the actual production assignment and invocation through a real Node process.
  Invoke-Expression $bundleAssignment.Extent.Text
  Invoke-Expression $mergeInvocation.Extent.Text
  Assert-Check ("$kind merger native invocation exits successfully") ($LASTEXITCODE -eq 0)
  $actualArguments = @(($mergeResult -join [Environment]::NewLine) | ConvertFrom-Json)
  $expectedDirectories = if ($kind -eq 'box') { @('app/cli/dist','app/web/dist') } else { 'app/cli' }
  $expectedArguments = @($cdxPath,$target.Root,$target.Inventory.ArchiveSha256) + @($expectedDirectories)
  Assert-Check ("$kind merger receives intact native argv boundaries") (($actualArguments | ConvertTo-Json -Compress) -eq ($expectedArguments | ConvertTo-Json -Compress))
}
foreach ($name in @('Get-Sha256','Assert-NoReparseAncestors','Assert-OutputLocation','Get-SafeArchiveName','Get-ArchiveInventory','Assert-ArchiveTree','Assert-PinnedSyft','Get-HostPathFindings','Normalize-ScanOutput')) {
  $functionAst = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $functionAst) { throw "Production function missing: $name" }
  Invoke-Expression $functionAst.Extent.Text
}
function New-TestZip([string]$Path, [string[]]$Names) {
  $zip = [System.IO.Compression.ZipFile]::Open($Path, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($name in $Names) {
      $writer = [System.IO.StreamWriter]::new($zip.CreateEntry($name).Open())
      try { $writer.Write('abc') } finally { $writer.Dispose() }
    }
  } finally { $zip.Dispose() }
}
$tree = Join-Path $testRoot 'tree'
New-Item -ItemType Directory -Path $tree | Out-Null
[System.IO.File]::WriteAllText((Join-Path $tree 'a.txt'), 'abc')
$zipPath = Join-Path $testRoot 'fixture.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($tree, $zipPath)
$inventory = Get-ArchiveInventory $zipPath
Assert-Check 'known SHA256 is correct' ((Get-Sha256 (Join-Path $tree 'a.txt')) -eq 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
Assert-Check 'archive inventory has file evidence' ($inventory.FileCount -eq 1 -and $inventory.Entries[0].Length -eq 3 -and $inventory.Entries[0].Sha256 -eq (Get-Sha256 (Join-Path $tree 'a.txt')))
Assert-ArchiveTree $tree $inventory
Assert-Check 'exact extraction is accepted' $true
[System.IO.File]::WriteAllText((Join-Path $tree 'a.txt'), 'xyz')
Assert-Throws 'same-length changed file is rejected' { Assert-ArchiveTree $tree $inventory } 'differs from ZIP'
[System.IO.File]::WriteAllText((Join-Path $tree 'a.txt'), 'abc')
Move-Item -LiteralPath (Join-Path $tree 'a.txt') -Destination (Join-Path $testRoot 'held.txt')
Assert-Throws 'missing ZIP file is rejected' { Assert-ArchiveTree $tree $inventory } 'missing ZIP files'
Move-Item -LiteralPath (Join-Path $testRoot 'held.txt') -Destination (Join-Path $tree 'a.txt')
[System.IO.File]::WriteAllText((Join-Path $tree 'extra.txt'), 'extra')
Assert-Throws 'additional extraction file is rejected' { Assert-ArchiveTree $tree $inventory } 'absent from ZIP'
foreach ($name in @('../escape','/rooted','C:/drive','dir/../escape','dir//empty','NUL.txt','dir/file.','dir/file ')) {
  Assert-Throws ('unsafe entry rejected: ' + $name) { Get-SafeArchiveName $name } 'Unsafe ZIP entry'
}
$duplicateZip = Join-Path $testRoot 'duplicate.zip'
New-TestZip $duplicateZip @('a.txt','A.TXT')
Assert-Throws 'case-insensitive ZIP collision rejected' { Get-ArchiveInventory $duplicateZip } 'Duplicate ZIP'
$traversalZip = Join-Path $testRoot 'traversal.zip'
New-TestZip $traversalZip @('../escape')
Assert-Throws 'ZIP inventory rejects traversal' { Get-ArchiveInventory $traversalZip } 'Unsafe ZIP'
$sentinel = Join-Path $tree 'sentinel'
[System.IO.File]::WriteAllText($sentinel, 'keep')
Assert-Throws 'existing output rejected' { Assert-OutputLocation $tree @($zipPath) } 'already exist'
Assert-Check 'existing output remains unchanged' ([System.IO.File]::ReadAllText($sentinel) -eq 'keep')
Assert-Throws 'output inside input rejected' { Assert-OutputLocation (Join-Path $tree 'out') @($tree) } 'overlaps'
Assert-Throws 'output containing input rejected' { Assert-OutputLocation (Join-Path $testRoot 'parent') @((Join-Path $testRoot 'parent/input')) } 'overlaps'
$safeOutput = Join-Path $testRoot 'new-output'
Assert-Check 'non-overlapping new output accepted' ((Assert-OutputLocation $safeOutput @($tree,$zipPath)) -eq $safeOutput -and -not (Test-Path -LiteralPath $safeOutput))
Assert-Throws 'untrusted scanner rejected before execution' { Assert-PinnedSyft (Join-Path $tree 'a.txt') } 'does not match the pinned'
$nativeFixture = Join-Path $testRoot 'native.json'
@{
  source=@{ metadata=@{ path='C:/private/scan-root' } }
  descriptor=@{ configuration=@{ packages=@{ golang=@{ 'local-mod-cache-dir'='C:/private/go'; 'local-vendor-dir'='' }; 'java-archive'=@{ 'maven-localrepository-dir'='C:/private/maven' } } } }
  artifacts=@(@{ locations=@(@{ path='/runtime/node.exe' }) })
} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $nativeFixture
$normalized = Normalize-ScanOutput $nativeFixture 'syft'
$nativeValue = Get-Content -LiteralPath $nativeFixture -Raw | ConvertFrom-Json -AsHashtable
Assert-Check 'known native host fields are normalized and declared' ($nativeValue.source.metadata.path -eq '.' -and $normalized.normalizedFields.Count -eq 3 -and @(Get-HostPathFindings $nativeValue).Count -eq 0)
Assert-Check 'archive-relative evidence remains intact' ($nativeValue.artifacts[0].locations[0].path -eq '/runtime/node.exe')
$cdxFixture = Join-Path $testRoot 'cdx.json'
@{ metadata=@{} } | ConvertTo-Json | Set-Content -LiteralPath $cdxFixture
Normalize-ScanOutput $cdxFixture 'cyclonedx' | Out-Null
$cdxValue = Get-Content -LiteralPath $cdxFixture -Raw | ConvertFrom-Json -AsHashtable
Assert-Check 'CycloneDX explicitly declares partial coverage' (@($cdxValue.metadata.properties | Where-Object {$_.name -eq 'workmesh:inventory:status' -and $_.value -eq 'DRAFT_PARTIAL_COVERAGE'}).Count -eq 1)
@{ metadata=@{}; unexpected=@{ path='G:/private/unreviewed' } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $cdxFixture
Assert-Throws 'unreviewed host field prevents redistribution' { Normalize-ScanOutput $cdxFixture 'cyclonedx' } 'Unreviewed host path'
@{ metadata=@{}; unexpected=@{ path='dir:G:/private/unreviewed' } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $cdxFixture
Assert-Throws 'URI-prefixed host field is rejected' { Normalize-ScanOutput $cdxFixture 'cyclonedx' } 'Unreviewed host path'
$linkedTree = Join-Path $testRoot 'linked-tree'
New-Item -ItemType Directory -Path $linkedTree | Out-Null
New-Item -ItemType Junction -Path (Join-Path $linkedTree 'outside') -Target $tree | Out-Null
Assert-Throws 'directory junction in scan tree is rejected' { Assert-ArchiveTree $linkedTree $inventory } 'reparse point'
Assert-Throws 'reparse output ancestor rejected' { Assert-OutputLocation (Join-Path $linkedTree 'outside/new-output') @($zipPath) } 'Reparse points'
Write-Host "$script:checks checks passed. Fixtures retained at $testRoot"
