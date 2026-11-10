#Requires -Version 5.1
<#
.SYNOPSIS
  Preview or create one Windows 11 Hyper-V client per WorkMesh role.
.DESCRIPTION
  The default is a read-only plan. -Apply creates powered-off virtual machines
  and attaches a local Windows installation ISO. The script never installs an
  OS, enables Windows features, elevates privileges, downloads an ISO or reboots.
.EXAMPLE
  .\scripts\vm\new-workmesh-lab.ps1 -Json
.EXAMPLE
  .\scripts\vm\new-workmesh-lab.ps1 -WindowsIso G:\ISO\Windows11.iso -Apply
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [string]$LabRoot = 'G:\workmesh-vm-lab',
  [ValidateSet('product', 'ui', 'frontend', 'backend', 'qa', 'ops')]
  [string[]]$Roles = @('product', 'ui', 'frontend', 'backend', 'qa', 'ops'),
  [string]$WindowsIso,
  [string]$SwitchName = 'Default Switch',
  [switch]$Apply,
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Capture WhatIf before CIM module auto-loading, whose alias setup emits WhatIf text.
$planOnlyWhatIf = [bool]$WhatIfPreference
$WhatIfPreference = $false
$checks = New-Object 'System.Collections.Generic.List[object]'
$startupBytes = [long](4GB)
$maximumBytes = [long](8GB)
$diskBytes = [long](80GB)
$hostReserveBytes = [long](8GB)
$minimumDiskBytes = [long](40GB * $Roles.Count + 16GB)
$runId = [guid]::NewGuid().ToString('N')

function Add-PreflightCheck {
  param([string]$Name, [bool]$Passed, [string]$Detail)
  $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail })
}

function Assert-LocalPath {
  param([string]$Value, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^[A-Za-z]:[\\/]') {
    throw ($Label + ' must be an absolute local drive path, for example G:\workmesh-vm-lab.')
  }
  return [IO.Path]::GetFullPath($Value).TrimEnd('\', '/')
}

function Test-ReparseAncestor {
  param([string]$Path)
  $candidate = $Path
  while (-not [string]::IsNullOrWhiteSpace($candidate)) {
    if (Test-Path -LiteralPath $candidate) {
      $item = Get-Item -LiteralPath $candidate -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
    }
    $parent = Split-Path -Parent $candidate
    if ($parent -eq $candidate) { break }
    $candidate = $parent
  }
  return $false
}

function Write-LabPlan {
  param($Plan)
  if ($Json) {
    $Plan | ConvertTo-Json -Depth 10
  } else {
    Write-Output ('Mode: ' + $Plan.mode + '; ready to create: ' + $Plan.readyToApply)
    Write-Output ('Lab root: ' + $Plan.labRoot)
    Write-Output ('Windows ISO: ' + $Plan.windowsIso)
    Write-Output ('Existing switch: ' + $Plan.switchName)
    $Plan.virtualMachines | Format-Table role, name, startupMemoryGB, maximumMemoryGB, diskCapacityGB, state -AutoSize
    $Plan.preflight | Format-Table name, passed, detail -Wrap -AutoSize
    foreach ($note in $Plan.notes) { Write-Output $note }
  }
}

if ($Roles.Count -lt 1 -or (@($Roles | Select-Object -Unique).Count -ne $Roles.Count)) {
  throw 'Select at least one role, without duplicate roles.'
}
$LabRoot = Assert-LocalPath -Value $LabRoot -Label 'LabRoot'
$driveRoot = [IO.Path]::GetPathRoot($LabRoot)
if ($LabRoot.TrimEnd('\') -eq $driveRoot.TrimEnd('\')) { throw 'LabRoot must be a dedicated directory, not a drive root.' }
if ($driveRoot.TrimEnd('\') -eq $env:SystemDrive) { throw 'LabRoot must be outside the Windows system drive.' }
if (Test-ReparseAncestor -Path $LabRoot) { throw 'LabRoot and its existing ancestors must not be junctions or symbolic links.' }
if ((Test-Path -LiteralPath $LabRoot) -and -not (Test-Path -LiteralPath $LabRoot -PathType Container)) {
  throw 'LabRoot already exists as a file.'
}
if (-not [string]::IsNullOrWhiteSpace($WindowsIso)) { $WindowsIso = Assert-LocalPath -Value $WindowsIso -Label 'WindowsIso' }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Add-PreflightCheck 'Administrator' $isAdministrator 'Creation requires an elevated Windows PowerShell; this script never elevates itself.'
$pendingRebootReasons = @()
$rebootCheckSucceeded = $true
try {
  if (Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending' -ErrorAction Stop) {
    $pendingRebootReasons += 'Component Based Servicing'
  }
  if (Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' -ErrorAction Stop) {
    $pendingRebootReasons += 'Windows Update'
  }
} catch {
  $rebootCheckSucceeded = $false
}
$rebootDetail = 'No CBS or Windows Update pending-restart marker was found.'
if ($pendingRebootReasons.Count -gt 0) {
  $rebootDetail = 'Restart pending from ' + ($pendingRebootReasons -join ', ') + '. Save your work and restart Windows manually before creating VMs. This script never removes restart markers or restarts Windows.'
} elseif (-not $rebootCheckSucceeded) {
  $rebootDetail = 'Could not inspect pending-restart markers. Creation is blocked until the read-only check succeeds.'
}
Add-PreflightCheck 'PendingReboot' ($rebootCheckSucceeded -and $pendingRebootReasons.Count -eq 0) $rebootDetail
$hyperVAvailable = [bool](Get-Module -ListAvailable -Name Hyper-V)
Add-PreflightCheck 'HyperVModule' $hyperVAvailable 'Enable the complete Hyper-V feature and restart first if requested by Windows.'

$computer = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$totalBytes = [long]$computer.TotalPhysicalMemory
$freeBytes = [long]$os.FreePhysicalMemory * 1KB
Add-PreflightCheck 'PhysicalMemory' ($totalBytes -ge ($startupBytes + $hostReserveBytes)) 'At least 12 GiB host RAM is required; guests remain powered off after creation.'
Add-PreflightCheck 'AvailableMemory' ($freeBytes -ge $startupBytes) 'At least 4 GiB currently available RAM is required; creation does not start any VM.'
$disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $driveRoot.Substring(0, 2) + "'")
$diskReady = $null -ne $disk -and $disk.DriveType -eq 3 -and [long]$disk.FreeSpace -ge $minimumDiskBytes
Add-PreflightCheck 'DiskSpace' $diskReady ('Require a local fixed drive with at least ' + [math]::Ceiling($minimumDiskBytes / 1GB) + ' GiB free (40 GiB per guest plus 16 GiB reserve).')
$systemDisk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$systemDiskReady = $null -ne $systemDisk -and [long]$systemDisk.FreeSpace -ge 15GB
Add-PreflightCheck 'SystemDiskHeadroom' $systemDiskReady 'This lab tool requires 15 GiB free on the Windows system drive as a safety margin; this is not a Windows installation minimum.'
$isoReady = -not [string]::IsNullOrWhiteSpace($WindowsIso) -and [IO.Path]::GetExtension($WindowsIso) -ieq '.iso'
if ($isoReady) { $isoReady = (Test-Path -LiteralPath $WindowsIso -PathType Leaf) -and (Get-Item -LiteralPath $WindowsIso).Length -gt 0 }
Add-PreflightCheck 'WindowsIso' $isoReady 'Supply an existing, nonempty Windows 11 x64 installation .iso from a trusted source. Verify authenticity and licence rights separately.'

$existingVmNames = @()
$switchReady = $false
$hyperVQueryReady = $false
if ($hyperVAvailable -and $isAdministrator) {
  try {
    Import-Module Hyper-V -ErrorAction Stop
    $requiredCommands = @('Get-VM', 'New-VM', 'Get-VMSwitch', 'Set-VM', 'Set-VMProcessor', 'Set-VMMemory', 'Add-VMDvdDrive', 'Set-VMFirmware', 'Set-VMKeyProtector', 'Enable-VMTPM')
    foreach ($commandName in $requiredCommands) {
      if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) { throw ('Missing Hyper-V command: ' + $commandName) }
    }
    foreach ($parameterName in @('SnapshotFileLocation', 'SmartPagingFilePath', 'AutomaticCheckpointsEnabled')) {
      if (-not (Get-Command Set-VM).Parameters.ContainsKey($parameterName)) { throw ('Missing Set-VM parameter: ' + $parameterName) }
    }
    $existingVmNames = @(Get-VM -ErrorAction Stop | Select-Object -ExpandProperty Name)
    $switchReady = $null -ne (Get-VMSwitch -Name $SwitchName -ErrorAction Stop)
    $hyperVQueryReady = $true
  } catch {
    Add-PreflightCheck 'HyperVQuery' $false $_.Exception.Message
  }
}
Add-PreflightCheck 'ExistingSwitch' $switchReady ('An existing Hyper-V switch named "' + $SwitchName + '" is required. The script never changes host networking.')

$virtualMachines = @()
foreach ($role in $Roles) {
  $name = 'workmesh-client-' + $role
  $vmRoot = Join-Path $LabRoot $name
  $vhdPath = Join-Path $vmRoot ($name + '.vhdx')
  if (-not $vmRoot.StartsWith($LabRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'A VM path escaped LabRoot.' }
  $targetFree = -not (Test-Path -LiteralPath $vmRoot) -and -not (Test-Path -LiteralPath $vhdPath)
  Add-PreflightCheck ($role + ':TargetAbsent') $targetFree ('Refuse any existing target: ' + $vmRoot)
  $nameFree = $hyperVQueryReady -and $existingVmNames -notcontains $name
  $nameDetail = 'No existing VM may use this name: ' + $name
  if (-not $hyperVQueryReady) { $nameDetail = 'Name could not be checked until an elevated Hyper-V query succeeds: ' + $name }
  Add-PreflightCheck ($role + ':NameAbsent') $nameFree $nameDetail
  $virtualMachines += [pscustomobject]@{
    role = $role; name = $name; generation = 2; processors = 2
    startupMemoryGB = 4; minimumMemoryGB = 4; maximumMemoryGB = 8
    diskCapacityGB = 80; diskType = 'DynamicVHDX'
    path = $vmRoot; vhdPath = $vhdPath
    state = 'Planned; powered off; OS not installed'
  }
}

$currentConcurrency = [math]::Max(0, [math]::Floor(($freeBytes - $hostReserveBytes) / $startupBytes))
$currentConcurrency = [math]::Min(2, [math]::Min($Roles.Count, $currentConcurrency))
$diskFreeGB = $null
if ($null -ne $disk) { $diskFreeGB = [math]::Round([long]$disk.FreeSpace / 1GB, 1) }
$notes = @(
  'Each VM has its own OS disk and role. Existing physical Windows remains the platform server.',
  'No VM is started and no guest OS is installed. Finish Windows setup and obtain required licences before use.',
  'Six Windows guests cannot all run smoothly alongside the platform on a 32 GiB host; run selected roles in batches.',
  ('Conservative current concurrency estimate: ' + $currentConcurrency + ' guest(s), capped at two and reserving 8 GiB of currently free RAM for host/platform.'),
  ('Virtual disk capacity totals ' + (80 * $Roles.Count) + ' GiB. This can exceed physical free space; disks grow on demand. Monitor space and allow for OS updates.'),
  'Hyper-V feature installation, elevation, reboot, ISO download and macOS provisioning are never performed.'
)
$plan = [pscustomobject]@{
  schemaVersion = 1; mode = 'Plan'
  readyToApply = @($checks | Where-Object { -not $_.passed }).Count -eq 0
  labRoot = $LabRoot; windowsIso = $WindowsIso; switchName = $SwitchName
  hostMemoryGB = [math]::Round($totalBytes / 1GB, 1)
  hostFreeMemoryGB = [math]::Round($freeBytes / 1GB, 1)
  hostDiskFreeGB = $diskFreeGB; recommendedConcurrentGuestsNow = $currentConcurrency
  virtualMachines = $virtualMachines; preflight = @($checks.ToArray()); notes = $notes
}

if (-not $Apply -or $planOnlyWhatIf) {
  if ($Apply) {
    $plan.mode = 'WhatIf'
    # Return before all mutations, including when Hyper-V is unavailable.
  }
  Write-LabPlan $plan
  return
}
if (-not $plan.readyToApply) {
  Write-LabPlan $plan
  $failed = @($checks | Where-Object { -not $_.passed } | ForEach-Object { $_.name })
  throw ('Preflight failed before creating any resources: ' + ($failed -join ', '))
}
if (-not $PSCmdlet.ShouldProcess($LabRoot, ('Create ' + $Roles.Count + ' powered-off Windows client VMs'))) {
  $plan.mode = 'Declined'
  Write-LabPlan $plan
  return
}

foreach ($vm in $virtualMachines) {
  if ((Test-Path -LiteralPath $vm.path) -or (Get-VM -Name $vm.name -ErrorAction SilentlyContinue)) {
    throw ('Target appeared after preflight; no resources created: ' + $vm.name)
  }
}
if (Test-ReparseAncestor -Path $LabRoot) { throw 'LabRoot changed after preflight; no resources created.' }

$manifestPath = Join-Path $LabRoot ('provision-' + $runId + '.json')
$manifest = [pscustomobject]@{
  schemaVersion = 1; createdAt = [DateTimeOffset]::Now.ToString('o')
  labRoot = $LabRoot; windowsIso = $WindowsIso; switchName = $SwitchName
  state = 'Creating'; error = $null; virtualMachines = $virtualMachines
}
function Save-Manifest {
  $content = $manifest | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText($manifestPath, $content, (New-Object Text.UTF8Encoding($true)))
}

try {
  if (-not (Test-Path -LiteralPath $LabRoot)) { $null = New-Item -Path $LabRoot -ItemType Directory }
  Save-Manifest
  foreach ($vm in $virtualMachines) {
    if ((Test-Path -LiteralPath $vm.path) -or (Get-VM -Name $vm.name -ErrorAction SilentlyContinue)) { throw ('Target appeared during creation: ' + $vm.name) }
    $null = New-Item -Path $vm.path -ItemType Directory
    $vm.state = 'Creating; OS not installed'
    Save-Manifest
    $createdVm = New-VM -Name $vm.name -Generation 2 -MemoryStartupBytes $startupBytes -Path $vm.path -NewVHDPath $vm.vhdPath -NewVHDSizeBytes $diskBytes -SwitchName $SwitchName
    Set-VMProcessor -VM $createdVm -Count 2
    Set-VMMemory -VM $createdVm -DynamicMemoryEnabled $true -MinimumBytes $startupBytes -StartupBytes $startupBytes -MaximumBytes $maximumBytes
    $checkpointPath = Join-Path $vm.path 'checkpoints'
    $smartPagingPath = Join-Path $vm.path 'smartpaging'
    $null = New-Item -Path $checkpointPath -ItemType Directory
    $null = New-Item -Path $smartPagingPath -ItemType Directory
    Set-VM -VM $createdVm -AutomaticStartAction Nothing -AutomaticStopAction ShutDown -CheckpointType Disabled -AutomaticCheckpointsEnabled $false -SnapshotFileLocation $checkpointPath -SmartPagingFilePath $smartPagingPath
    Set-VMKeyProtector -VM $createdVm -NewLocalKeyProtector
    Enable-VMTPM -VM $createdVm
    $dvd = Add-VMDvdDrive -VM $createdVm -Path $WindowsIso -Passthru
    Set-VMFirmware -VM $createdVm -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice $dvd
    $vm.state = 'Created; powered off; OS not installed'
    Save-Manifest
  }
  $manifest.state = 'Created; all VMs powered off; OS not installed'
  Save-Manifest
} catch {
  $manifest.state = 'Failed; partial resources preserved'
  $manifest.error = $_.Exception.Message
  try { Save-Manifest } catch { Write-Warning ('Could not update manifest: ' + $_.Exception.Message) }
  throw ('Creation stopped. Existing and partial VMs were preserved; inspect Hyper-V and ' + $manifestPath + '. Failure: ' + $manifest.error)
}

if ($Json) {
  $manifest | ConvertTo-Json -Depth 10
} else {
  Write-Output ('Created ' + $Roles.Count + ' powered-off Windows VMs. Windows is NOT installed.')
  Write-Output ('Manifest: ' + $manifestPath)
  $virtualMachines | Format-Table role, name, state -AutoSize
  foreach ($note in $notes) { Write-Output $note }
}
