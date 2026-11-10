#Requires -Version 5.1
<#
.SYNOPSIS
  Inspect the six recorded WorkMesh Hyper-V guests without changing them.
.DESCRIPTION
  Run from an administrator Windows PowerShell. Without OutputDirectory this
  script only prints JSON status. Supplying an absolute non-system-drive output
  directory also saves a PNG thumbnail per guest and one JSON report. It never
  starts, stops, connects to, mounts or reconfigures a guest and never elevates.
.EXAMPLE
  .\get-workmesh-lab-status.ps1 -Roles product
.EXAMPLE
  .\get-workmesh-lab-status.ps1 -OutputDirectory G:\workmesh-vm-lab\status
#>
[CmdletBinding()]
param(
  [ValidateSet('product', 'ui', 'frontend', 'backend', 'qa', 'ops')]
  [string[]]$Roles = @('product', 'ui', 'frontend', 'backend', 'qa', 'ops'),
  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$labRoot = 'G:\workmesh-vm-lab'
$manifestPath = Join-Path $labRoot 'vm-verification.json'
$allRoles = @('product', 'ui', 'frontend', 'backend', 'qa', 'ops')
$knownIds = @{
  product = 'e7b6c95f-4c49-4f18-b14f-00a7d06ca434'
  ui = '688a6d42-167f-45b2-8c2e-3b756f7bf32f'
  frontend = 'ecad1eb3-8fee-4452-aeda-ed7de7652427'
  backend = 'dbc6fc1e-37cb-49fc-9826-b472a5bf89e4'
  qa = '6aaba492-9c12-4ed9-8921-ab9e1ebb8ed3'
  ops = '8f37fdad-ff17-4f39-81e3-bdf8c528b66b'
}

function Get-AbsoluteLocalPath {
  param([string]$Value, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^[A-Za-z]:[\\/]') {
    throw ($Label + ' must be an absolute local drive path.')
  }
  if ($Value.Substring(2).Contains(':')) { throw ($Label + ' must not contain an alternate data stream.') }
  return [IO.Path]::GetFullPath($Value).TrimEnd('\', '/')
}

function Assert-NoReparseAncestor {
  param([string]$Path)
  $candidate = $Path
  while (-not [string]::IsNullOrWhiteSpace($candidate)) {
    if (Test-Path -LiteralPath $candidate) {
      $item = Get-Item -LiteralPath $candidate -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw ('Reparse points, junctions and symbolic links are not allowed: ' + $candidate)
      }
    }
    $parent = [IO.Path]::GetDirectoryName($candidate)
    if ($parent -eq $candidate) { break }
    $candidate = $parent
  }
}

function Write-NewBytes {
  param([string]$Path, [byte[]]$Bytes)
  Assert-NoReparseAncestor -Path $Path
  $stream = $null
  try {
    $stream = New-Object IO.FileStream($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $stream.Write($Bytes, 0, $Bytes.Length)
    $stream.Flush($true)
  } finally { if ($null -ne $stream) { $stream.Dispose() } }
}

function Save-Rgb565Png {
  param([byte[]]$Bytes, [int]$Offset, [int]$Width, [int]$Height, [string]$Path)
  $bitmap = $null
  $memory = $null
  try {
    $bitmap = New-Object Drawing.Bitmap($Width, $Height)
    $memory = New-Object IO.MemoryStream
    for ($y = 0; $y -lt $Height; $y++) {
      for ($x = 0; $x -lt $Width; $x++) {
        $i = $Offset + 2 * ($y * $Width + $x)
        $pixel = [int]$Bytes[$i] -bor ([int]$Bytes[$i + 1] -shl 8)
        $r = ($pixel -shr 11) -band 31
        $g = ($pixel -shr 5) -band 63
        $b = $pixel -band 31
        $r = ($r -shl 3) -bor ($r -shr 2)
        $g = ($g -shl 2) -bor ($g -shr 4)
        $b = ($b -shl 3) -bor ($b -shr 2)
        $bitmap.SetPixel($x, $y, [Drawing.Color]::FromArgb($r, $g, $b))
      }
    }
    $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
    Write-NewBytes -Path $Path -Bytes $memory.ToArray()
  } finally {
    if ($null -ne $memory) { $memory.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
  }
}

if ($Roles.Count -eq 0 -or @($Roles | Select-Object -Unique).Count -ne $Roles.Count) {
  throw 'Choose at least one role without duplicate roles.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this read-only inspection from an administrator Windows PowerShell. The script does not elevate itself.'
}
if (-not (Get-Module -ListAvailable -Name Hyper-V)) { throw 'The Hyper-V PowerShell module is unavailable.' }
Import-Module Hyper-V -ErrorAction Stop
Assert-NoReparseAncestor -Path $manifestPath
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $manifest.Success -or @($manifest.VMs).Count -ne $allRoles.Count) { throw 'The recorded verification manifest must contain the six successfully verified guests.' }
foreach ($role in $allRoles) {
  $records = @($manifest.VMs | Where-Object { $_.Role -eq $role })
  if ($records.Count -ne 1) { throw ('Expected one manifest record for role ' + $role) }
  $record = $records[0]
  $expectedName = 'workmesh-client-' + $role
  $expectedDisk = Join-Path (Join-Path $labRoot $expectedName) ($expectedName + '.vhdx')
  if ([string]$record.Id -ine $knownIds[$role] -or [string]$record.Name -cne $expectedName) {
    throw ('Manifest UUID or name differs from the known guest for role ' + $role)
  }
  if (@($record.DiskPaths).Count -ne 1 -or (Get-AbsoluteLocalPath -Value ([string]$record.DiskPaths[0]) -Label 'Recorded disk') -ine $expectedDisk) {
    throw ('Manifest disk path differs from the known guest for role ' + $role)
  }
}

$saveScreens = -not [string]::IsNullOrWhiteSpace($OutputDirectory)
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N')
$reportPath = $null
$service = $null
if ($saveScreens) {
  $OutputDirectory = Get-AbsoluteLocalPath -Value $OutputDirectory -Label 'OutputDirectory'
  $root = [IO.Path]::GetPathRoot($OutputDirectory)
  if ($OutputDirectory.TrimEnd('\') -eq $root.TrimEnd('\')) { throw 'OutputDirectory must be a dedicated directory, not a drive root.' }
  if ($root -ieq [IO.Path]::GetPathRoot([Environment]::SystemDirectory)) { throw 'OutputDirectory must be outside the Windows system drive.' }
  Assert-NoReparseAncestor -Path $OutputDirectory
  $drive = New-Object IO.DriveInfo($root)
  if (-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'OutputDirectory must be on a ready local fixed drive.' }
  if (Test-Path -LiteralPath $OutputDirectory) {
    if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { throw 'OutputDirectory is an existing file.' }
  } else { $null = New-Item -ItemType Directory -Path $OutputDirectory }
  Add-Type -AssemblyName System.Drawing
  $services = @(Get-CimInstance -Namespace 'root/virtualization/v2' -ClassName Msvm_VirtualSystemManagementService)
  if ($services.Count -ne 1) { throw 'Expected one Hyper-V virtual system management service.' }
  $service = $services[0]
  $reportPath = Join-Path $OutputDirectory ('status-' + $runId + '.json')
}

$rows = New-Object 'System.Collections.Generic.List[object]'
foreach ($role in $Roles) {
  $expectedName = 'workmesh-client-' + $role
  $expectedDisk = Join-Path (Join-Path $labRoot $expectedName) ($expectedName + '.vhdx')
  $row = [ordered]@{
    Role = $role; Id = $knownIds[$role]; Name = $expectedName
    State = $null; Heartbeat = $null; DiskPath = $expectedDisk; DiskFileSize = $null
    IPAddresses = @(); ScreenPath = $null; ScreenReturnValue = $null
    ScreenWidth = $null; ScreenHeight = $null; ScreenReturnedBytes = $null
    ScreenPayloadOffset = $null; ScreenHeaderBytes = @(); ScreenHeaderHex = $null
    ScreenError = $null; Error = $null
  }
  try {
    $vm = Get-VM -Id ([guid]$knownIds[$role]) -ErrorAction Stop
    if ([string]$vm.Name -cne $expectedName -or $vm.Generation -ne 2) { throw 'Live VM UUID/name/generation did not match the recorded guest.' }
    $row.State = [string]$vm.State
    $row.Heartbeat = [string]$vm.Heartbeat
    $disks = @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
    if ($disks.Count -ne 1 -or (Get-AbsoluteLocalPath -Value ([string]$disks[0].Path) -Label 'Live VM disk') -ine $expectedDisk) {
      throw 'Live VM system disk differs from the known single VHDX path.'
    }
    Assert-NoReparseAncestor -Path $expectedDisk
    $row.DiskFileSize = [long](Get-Item -LiteralPath $expectedDisk -Force -ErrorAction Stop).Length
    $addresses = @()
    foreach ($adapter in @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)) {
      foreach ($address in @($adapter.IPAddresses)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$address)) { $addresses += [string]$address }
      }
    }
    $row.IPAddresses = @($addresses | Select-Object -Unique)
  } catch { $row.Error = $_.Exception.Message }

  if ($saveScreens -and $null -eq $row.Error) {
    try {
      $computer = @(Get-CimInstance -Namespace 'root/virtualization/v2' -ClassName Msvm_ComputerSystem -Filter ("Name='" + $knownIds[$role] + "'"))
      if ($computer.Count -ne 1) { throw 'Expected one live CIM computer system for the known guest UUID.' }
      $settings = @(Get-CimAssociatedInstance -InputObject $computer[0] -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData | Where-Object { $_.VirtualSystemType -eq 'Microsoft:Hyper-V:System:Realized' })
      if ($settings.Count -ne 1) { throw 'Expected one realized virtual system setting, excluding snapshots.' }
      $row.ScreenWidth = 640
      $row.ScreenHeight = 480
      $capture = Invoke-CimMethod -InputObject $service -MethodName GetVirtualSystemThumbnailImage -Arguments @{
        TargetSystem = $settings[0]; WidthPixels = [uint16]640; HeightPixels = [uint16]480
      } -ErrorAction Stop
      $row.ScreenReturnValue = [uint32]$capture.ReturnValue
      if ($row.ScreenReturnValue -ne 0) { throw ('Thumbnail method returned ' + $row.ScreenReturnValue + '. No screenshot was written.') }
      $raw = [byte[]]$capture.ImageData
      $row.ScreenReturnedBytes = $raw.Length
      if ($raw.Length -eq 614400) {
        $row.ScreenPayloadOffset = 0
      } elseif ($raw.Length -eq 614404) {
        # This host's four-byte prefix was verified with an actual Setup screen.
        # Preserve it verbatim; do not interpret it as image dimensions.
        $row.ScreenPayloadOffset = 4
        $row.ScreenHeaderBytes = @($raw[0..3] | ForEach-Object { [int]$_ })
        $row.ScreenHeaderHex = [BitConverter]::ToString($raw, 0, 4)
      } else { throw ('Unexpected RGB565 thumbnail length: ' + $raw.Length) }
      $screenPath = Join-Path $OutputDirectory ($role + '-' + $runId + '.png')
      Save-Rgb565Png -Bytes $raw -Offset $row.ScreenPayloadOffset -Width 640 -Height 480 -Path $screenPath
      $row.ScreenPath = $screenPath
    } catch { $row.ScreenError = $_.Exception.Message }
  }
  $rows.Add([pscustomobject]$row)
}
$report = [ordered]@{
  CheckedUtc = [DateTime]::UtcNow.ToString('o'); LabRoot = $labRoot
  ManifestPath = $manifestPath; ScreensRequested = $saveScreens; ReportPath = $reportPath
  VMs = $rows.ToArray()
}
$json = $report | ConvertTo-Json -Depth 8
if ($saveScreens) {
  $encoding = New-Object Text.UTF8Encoding($true)
  $bytes = $encoding.GetPreamble() + $encoding.GetBytes($json + [Environment]::NewLine)
  Write-NewBytes -Path $reportPath -Bytes $bytes
}
Write-Output $json
