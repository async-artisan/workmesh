[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [switch]$EnableHyperV,
  [switch]$DownloadIso,
  [string]$ImageDirectory = 'G:\workmesh-vm-lab\images'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Downloading an evaluation ISO does not accept its licence or install Windows.
# This pinned Microsoft URL avoids mixing different versions when resuming.
$isoName = 'windows-11-enterprise-eval-zh-cn-x64.iso'
$isoUri = 'https://software-static.download.prss.microsoft.com/dbazure/26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_zh-cn.iso'
$isoBytes = [long]8548628480
$sourcePage = 'https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise'

if ($env:OS -ne 'Windows_NT') { throw 'Run this script on the Windows deployment host.' }
if ($ImageDirectory -notmatch '^[A-Za-z]:[\\/]') { throw 'ImageDirectory must be an absolute local drive path.' }
$ImageDirectory = [System.IO.Path]::GetFullPath($ImageDirectory).TrimEnd('\')
if ($ImageDirectory -eq [System.IO.Path]::GetPathRoot($ImageDirectory).TrimEnd('\')) {
  throw 'Use a dedicated image directory, not a drive root.'
}
if ($ImageDirectory.StartsWith([System.IO.Path]::GetPathRoot($env:SystemRoot), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Use a non-system drive for the large installation image.'
}

function Assert-OrdinaryPath {
  param([string]$Path)
  $candidate = $Path
  while (-not [string]::IsNullOrWhiteSpace($candidate)) {
    if (Test-Path -LiteralPath $candidate) {
      $item = Get-Item -LiteralPath $candidate -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw ('Image paths must not contain junctions or symbolic links: ' + $candidate)
      }
    }
    $parent = Split-Path -Parent $candidate
    if ($parent -eq $candidate) { break }
    $candidate = $parent
  }
}
Assert-OrdinaryPath $ImageDirectory

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$computer = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$systemDrive = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$feature = Get-CimInstance Win32_OptionalFeature -Filter "Name='Microsoft-Hyper-V-All'"
$isoPath = Join-Path $ImageDirectory $isoName
$featureEnabled = $null -ne $feature -and $feature.InstallState -eq 1
$report = [ordered]@{
  HostOS = $os.Caption
  Administrator = $isAdmin
  HyperVEnabled = $featureEnabled
  HypervisorPresent = $computer.HypervisorPresent
  MemoryGB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
  FreeMemoryGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
  SystemDriveFreeGB = [math]::Round($systemDrive.FreeSpace / 1GB, 1)
  MinimumSystemDriveFreeGB = 15
  IsoPath = $isoPath
  IsoDownloadBytes = $isoBytes
  IsoSourcePage = $sourcePage
  RequestedEnableHyperV = [bool]$EnableHyperV
  RequestedDownloadIso = [bool]$DownloadIso
  AutomaticallyReboots = $false
  Note = 'The 15 GB system-drive threshold is a lab safety margin, not a Microsoft minimum. Default invocation is read-only.'
}
$report | ConvertTo-Json -Depth 4

if ($EnableHyperV -and -not $featureEnabled) {
  if (-not $isAdmin) { throw 'Enabling Hyper-V requires an administrator PowerShell. No elevation was attempted.' }
  if ($systemDrive.FreeSpace -lt 15GB) {
    throw 'Free at least 15 GB on the system drive before enabling Hyper-V. No user files were removed.'
  }
  if ($PSCmdlet.ShouldProcess('Microsoft-Hyper-V-All', 'Enable Windows feature without restarting')) {
    $result = Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart
    $result | Select-Object FeatureName, State, RestartNeeded
    Write-Output 'Hyper-V enablement returned. If RestartNeeded is true, save work and arrange a manual restart before creating VMs.'
  }
}

if (-not $DownloadIso) { return }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw 'curl.exe is required for the resumable download.' }
if (Test-Path -LiteralPath $isoPath) {
  throw ('ISO already exists; it will not be overwritten: ' + $isoPath)
}
$partialPath = $isoPath + '.partial'
$sourcePath = $partialPath + '.source.txt'
$metadataPath = $isoPath + '.json'
$downloadLockPath = $isoPath + '.download.lock'
foreach ($imageFilePath in @($partialPath, $sourcePath, $metadataPath, $downloadLockPath)) { Assert-OrdinaryPath $imageFilePath }
if (Test-Path -LiteralPath $metadataPath) { throw 'ISO metadata already exists; inspect it before retrying. It will not be overwritten.' }
$remainingBytes = $isoBytes
if (Test-Path -LiteralPath $partialPath) {
  if (-not (Test-Path -LiteralPath $sourcePath)) { throw 'Existing partial file has no source record; inspect it manually.' }
  if ((Get-Content -LiteralPath $sourcePath -Raw).Trim() -ne $isoUri) { throw 'Partial file source differs; refusing to resume.' }
  $remainingBytes -= (Get-Item -LiteralPath $partialPath).Length
  if ($remainingBytes -lt 0) { throw 'Partial file is larger than the selected ISO.' }
}
$imageDriveRoot = [System.IO.Path]::GetPathRoot($ImageDirectory)
$imageDrive = New-Object System.IO.DriveInfo($imageDriveRoot)
if ($imageDrive.AvailableFreeSpace -lt ($remainingBytes + 10GB)) { throw 'The image drive needs the remaining ISO size plus 10 GB reserve.' }
if (-not $PSCmdlet.ShouldProcess($isoPath, 'Download pinned Microsoft Windows evaluation ISO (installation and licence acceptance remain manual)')) { return }
New-Item -ItemType Directory -Path $ImageDirectory -Force | Out-Null
Assert-OrdinaryPath $ImageDirectory
$downloadLock = $null
try {
  $downloadLock = [IO.File]::Open($downloadLockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
  throw 'Another process holds the ISO download lock. No download was started.'
}
try {
if (Test-Path -LiteralPath $isoPath) { throw 'ISO appeared after preflight; refusing to overwrite it.' }
if (-not (Test-Path -LiteralPath $sourcePath)) { [System.IO.File]::WriteAllText($sourcePath, $isoUri) }
if ($remainingBytes -gt 0) {
  & curl.exe --fail --location --retry 3 --continue-at - --output $partialPath --url $isoUri
  if ($LASTEXITCODE -ne 0) { throw 'Download did not complete. The same command can resume the partial file.' }
}
if ((Get-Item -LiteralPath $partialPath).Length -ne $isoBytes) { throw 'ISO byte length differs from the selected Microsoft download.' }
$sha256 = (Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash
$metadata = [ordered]@{
  File = $isoPath
  Source = $isoUri
  SourcePage = $sourcePage
  Bytes = $isoBytes
  SHA256 = $sha256
  HashMeaning = 'Local download fingerprint only; not independently compared with a Microsoft-published checksum.'
  DownloadedAtUtc = [DateTime]::UtcNow.ToString('o')
  Installed = $false
  LicenceAccepted = $false
}
$metadataBytes = [Text.Encoding]::UTF8.GetBytes(($metadata | ConvertTo-Json -Depth 4))
$metadataStream = [IO.File]::Open($metadataPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try { $metadataStream.Write($metadataBytes, 0, $metadataBytes.Length) } finally { $metadataStream.Dispose() }
try {
  Move-Item -LiteralPath $partialPath -Destination $isoPath
} catch {
  throw ('ISO publication failed; the completed partial and metadata were preserved. Inspect ' + $partialPath + ' and ' + $metadataPath + ' before retrying. ' + $_.Exception.Message)
}
Write-Output ('Downloaded evaluation ISO: ' + $isoPath)
Write-Output ('Local SHA256: ' + $sha256)
} finally {
  $downloadLock.Dispose()
}
