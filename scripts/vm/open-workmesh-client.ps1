#Requires -Version 5.1
<#
.SYNOPSIS
  Preview or open one of the six verified WorkMesh Windows clients.
.DESCRIPTION
  The default is read-only and prints a JSON plan. -Open requires an
  administrator Windows PowerShell, starts only the selected guest if needed,
  and opens its visible VMConnect console. No other guest is changed. The tool
  never elevates, reads credentials, stops a guest, or changes configuration.
.EXAMPLE
  .\open-workmesh-client.ps1 -Role product
.EXAMPLE
  .\open-workmesh-client.ps1 -Role qa -Open
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [ValidateSet('product', 'ui', 'frontend', 'backend', 'qa', 'ops')]
  [string]$Role = 'product',
  [switch]$Open
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$labRoot = 'G:\workmesh-vm-lab'
$knownIds = @{
  product = 'e7b6c95f-4c49-4f18-b14f-00a7d06ca434'
  ui = '688a6d42-167f-45b2-8c2e-3b756f7bf32f'
  frontend = 'ecad1eb3-8fee-4452-aeda-ed7de7652427'
  backend = 'dbc6fc1e-37cb-49fc-9826-b472a5bf89e4'
  qa = '6aaba492-9c12-4ed9-8921-ab9e1ebb8ed3'
  ops = '8f37fdad-ff17-4f39-81e3-bdf8c528b66b'
}
$allRoles = @('product', 'ui', 'frontend', 'backend', 'qa', 'ops')
$expectedName = 'workmesh-client-' + $Role
$manifestPath = Join-Path $labRoot 'vm-verification.json'
$consolePath = Join-Path ([Environment]::SystemDirectory) 'vmconnect.exe'
$reserveBytes = [long]8GB
$minimumStartupBytes = [long]4GB
$plan = [ordered]@{
  Mode = 'plan'; Role = $Role; VMName = $expectedName; VMId = $knownIds[$Role]
  ReadyToOpen = $false; Administrator = $false; State = $null
  ActiveLabGuests = $null; MaximumActiveLabGuests = 2
  FreeMemoryBytes = $null; HostReserveBytes = $reserveBytes
  RequiredGuestMemoryBytes = $null; ConsolePath = $consolePath
  WillStartGuest = $false; Reason = $null
}

function Assert-NoReparseAncestor {
  param([string]$Path)
  $candidate = $Path
  while (-not [string]::IsNullOrWhiteSpace($candidate)) {
    if (Test-Path -LiteralPath $candidate) {
      if (((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw ('Reparse points are not allowed: ' + $candidate)
      }
    }
    $parent = [IO.Path]::GetDirectoryName($candidate)
    if ($parent -eq $candidate) { break }
    $candidate = $parent
  }
}

function Assert-DiskPath {
  param([object[]]$Paths, [string]$Expected, [string]$Label)
  if ($Paths.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$Paths[0])) {
    throw ($Label + ' must have exactly one system disk.')
  }
  $path = [string]$Paths[0]
  if ($path -notmatch '^[A-Za-z]:[\\/]' -or $path.Substring(2).Contains(':')) {
    throw ($Label + ' must use an absolute local disk path.')
  }
  $path = [IO.Path]::GetFullPath($path).TrimEnd('\', '/')
  if ($path -ine $Expected) { throw ($Label + ' does not match its known VHDX path.') }
  Assert-NoReparseAncestor -Path $path
}

try {
  Assert-NoReparseAncestor -Path $manifestPath
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $manifest.Success -or @($manifest.VMs).Count -ne 6) { throw 'The verification manifest must contain the six verified guests.' }
  foreach ($candidateRole in $allRoles) {
    $records = @($manifest.VMs | Where-Object { $_.Role -eq $candidateRole })
    $name = 'workmesh-client-' + $candidateRole
    $diskPath = Join-Path (Join-Path $labRoot $name) ($name + '.vhdx')
    if ($records.Count -ne 1 -or [string]$records[0].Id -ine $knownIds[$candidateRole] -or [string]$records[0].Name -cne $name) {
      throw ('Manifest identity mismatch for role ' + $candidateRole)
    }
    Assert-DiskPath -Paths @($records[0].DiskPaths) -Expected $diskPath -Label ('Manifest role ' + $candidateRole)
  }
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  $plan.Administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $plan.Administrator) {
    throw 'Run this tool from an administrator Windows PowerShell to inspect or open the guest. It does not elevate itself.'
  }
  if (-not (Get-Module -ListAvailable -Name Hyper-V)) { throw 'The Hyper-V PowerShell module is unavailable.' }
  Import-Module Hyper-V -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $consolePath -PathType Leaf)) { throw 'Windows VMConnect is unavailable.' }
  $guests = @()
  foreach ($candidateRole in $allRoles) {
    $name = 'workmesh-client-' + $candidateRole
    $guest = Get-VM -Id ([guid]$knownIds[$candidateRole]) -ErrorAction Stop
    if ([string]$guest.Name -cne $name -or $guest.Generation -ne 2) { throw ('Live VM identity mismatch for role ' + $candidateRole) }
    $diskPath = Join-Path (Join-Path $labRoot $name) ($name + '.vhdx')
    $disks = @(Get-VMHardDiskDrive -VM $guest -ErrorAction Stop)
    Assert-DiskPath -Paths @($disks | ForEach-Object { $_.Path }) -Expected $diskPath -Label ('Live role ' + $candidateRole)
    $guests += $guest
  }
  $vm = $guests | Where-Object { $_.Id -eq [guid]$knownIds[$Role] }
  $plan.State = [string]$vm.State
  if ($plan.State -notin @('Off', 'Running', 'Saved')) { throw ('Guest state must be Off, Running or Saved; found ' + $plan.State) }
  $active = @($guests | Where-Object { [string]$_.State -notin @('Off', 'Saved') })
  $plan.ActiveLabGuests = $active.Count
  $plan.WillStartGuest = $plan.State -ne 'Running'
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  $plan.FreeMemoryBytes = [long]$os.FreePhysicalMemory * 1KB
  $memory = Get-VMMemory -VM $vm -ErrorAction Stop
  $required = [long][Math]::Max($minimumStartupBytes, [long]$memory.Startup)
  # Saved guests may resume with more than their startup RAM; reserve their cap.
  if ($plan.State -eq 'Saved') { $required = [long][Math]::Max($required, [long]$memory.Maximum) }
  $plan.RequiredGuestMemoryBytes = $required
  if ($plan.WillStartGuest) {
    if ($active.Count -ge 2) { throw 'Two lab guests are already active. Shut down a guest normally before opening another.' }
    if ($plan.FreeMemoryBytes -lt ($reserveBytes + $required)) { throw 'Insufficient available memory to start this guest while retaining the 8 GiB host reserve.' }
  }
  $plan.ReadyToOpen = $true
  $plan.Reason = 'Identity, guest state, console and resource preflight passed.'
} catch {
  $plan.Reason = $_.Exception.Message
  if ($Open -and -not $WhatIfPreference) { throw }
}

if (-not $Open -or $WhatIfPreference) { [pscustomobject]$plan | ConvertTo-Json -Depth 5; return }
if (-not $plan.ReadyToOpen) { throw $plan.Reason }
if ($PSCmdlet.ShouldProcess($expectedName, 'Start if needed and open the visible VMConnect console')) {
  if ($plan.WillStartGuest) { Start-VM -VM $vm -ErrorAction Stop | Out-Null }
  Start-Process -FilePath $consolePath -ArgumentList @('localhost', $expectedName, '-G', $knownIds[$Role]) -WindowStyle Normal -ErrorAction Stop | Out-Null
  $plan.Mode = 'opened'
  $plan.State = [string](Get-VM -Id ([guid]$knownIds[$Role]) -ErrorAction Stop).State
  [pscustomobject]$plan | ConvertTo-Json -Depth 5
}
