#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-box.ps1') -Raw
$cliStart = $source.IndexOf('$cliDownloadPage = ')
$cliEnd = $source.IndexOf('# Keep the existing `node` manifest field', $cliStart)
$tailStart = $source.IndexOf('$releaseDownloadPage = ')
if ($cliStart -lt 0 -or $cliEnd -le $cliStart -or $tailStart -lt 0) { throw 'Cannot locate the production download packaging statements.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('workmesh-box-download-test-' + [guid]::NewGuid().ToString('N'))
$releasePath = Join-Path $testRoot 'box'
$downloads = Join-Path $releasePath 'downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
try {
  Set-Content -LiteralPath (Join-Path $downloads 'workmesh-cli-win-x64.zip') -Value 'CLI fixture' -Encoding ASCII
  $cliHash = (Get-FileHash -LiteralPath (Join-Path $downloads 'workmesh-cli-win-x64.zip') -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath (Join-Path $downloads 'workmesh-cli-win-x64.zip.sha256') -Value ($cliHash + '  workmesh-cli-win-x64.zip') -Encoding ASCII
  $NodeExe = 'fixture-node'; $licensePackager = 'fixture-licenses'; $root = $testRoot; $PostgresRoot = $testRoot
  function Run([string]$Command, [string[]]$Arguments) {
    if ($Command -ne 'fixture-node' -or $Arguments[0] -ne 'fixture-licenses' -or $Arguments[1] -ne 'box') { throw 'Unexpected command in download packaging fixture.' }
    Set-Content -LiteralPath (Join-Path $releasePath 'LICENSE') -Value 'fixture license' -Encoding ASCII
  }
  # Execute the actual production statements, skipping only unrelated full product builds.
  & ([scriptblock]::Create($source.Substring($cliStart, $cliEnd - $cliStart)))
  & ([scriptblock]::Create($source.Substring($tailStart)))
  $archive = Join-Path $testRoot 'box.zip'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $page = @($zip.Entries | Where-Object { $_.FullName.Replace('\','/') -eq 'downloads/index.html' })
    if ($page.Count -ne 1) { throw 'Archived download page is missing.' }
    $reader = New-Object IO.StreamReader($page[0].Open())
    try { $html = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $links = @([regex]::Matches($html, 'href="/download/([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
    if ($links.Count -ne 2 -or @($links | Where-Object { $_ -notlike 'workmesh-cli-win-x64.zip*' }).Count -ne 0) { throw 'Archived page must advertise only the available CLI ZIP and hash.' }
    foreach ($link in $links) { if (@($zip.Entries | Where-Object { $_.FullName.Replace('\','/') -eq ('downloads/' + $link) }).Count -ne 1) { throw 'An archive page link has no packaged target.' } }
  } finally { $zip.Dispose() }
  $published = Get-Content -LiteralPath (Join-Path $downloads 'index.html') -Raw
  $publishedLinks = @([regex]::Matches($published, 'href="/download/([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  if ($publishedLinks.Count -ne 4 -or $publishedLinks -notcontains 'workmesh-box-win-x64.zip') { throw 'Published page must advertise Box and CLI after publication.' }
  foreach ($link in $publishedLinks) { if (-not (Test-Path -LiteralPath (Join-Path $downloads $link) -PathType Leaf)) { throw 'Published page link has no target.' } }
  $actual = (Get-FileHash -LiteralPath (Join-Path $downloads 'workmesh-box-win-x64.zip') -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = ((Get-Content -LiteralPath (Join-Path $downloads 'workmesh-box-win-x64.zip.sha256') -Raw).Trim() -split '\s+')[0]
  if ($actual -ne $expected -or $actual -ne (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Published Box ZIP or hash differs from original archive.' }
  Write-Output 'PASS: archive CLI-only links and published Box/CLI links have available targets; Box SHA256 matches.'
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if ((Split-Path -Leaf $resolved) -notlike 'workmesh-box-download-test-*' -or (Split-Path -Parent $resolved) -ine [IO.Path]::GetTempPath().TrimEnd('\')) { throw 'Refusing unexpected fixture cleanup path.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
