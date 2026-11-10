#Requires -Version 5.1
<#
.SYNOPSIS
  Plan or create private Windows answer media for the six WorkMesh guests.
.DESCRIPTION
  The default is read-only. -Apply creates a unique directory on the lab drive,
  removes inherited access and allows only the current user, SYSTEM and local
  Administrators before writing any credentials. Each guest receives a unique
  random local administrator password. Answer XML, ISO and credentials.json
  contain plaintext secrets and must remain inside that protected directory.
  This helper does not install Windows, change a VM, mount a disk or elevate.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [string]$LabRoot = 'G:\workmesh-vm-lab',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$roleNames = @('product', 'ui', 'frontend', 'backend', 'qa', 'ops')
$isoHelper = Join-Path $PSScriptRoot 'new-answer-iso.ps1'

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

function Get-CryptoIndex {
  param([Security.Cryptography.RandomNumberGenerator]$Generator, [int]$ExclusiveMaximum)
  if ($ExclusiveMaximum -lt 1 -or $ExclusiveMaximum -gt 256) { throw 'Invalid random index range.' }
  $oneByte = New-Object byte[] 1
  $limit = 256 - (256 % $ExclusiveMaximum)
  do { $Generator.GetBytes($oneByte) } while ([int]$oneByte[0] -ge $limit)
  return ([int]$oneByte[0] % $ExclusiveMaximum)
}

function New-LabPassword {
  param([Security.Cryptography.RandomNumberGenerator]$Generator)
  $sets = @('ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#%+=?_-.')
  $characters = New-Object 'System.Collections.Generic.List[char]'
  foreach ($set in $sets) { $characters.Add($set[(Get-CryptoIndex -Generator $Generator -ExclusiveMaximum $set.Length)]) }
  $all = $sets -join ''
  while ($characters.Count -lt 28) { $characters.Add($all[(Get-CryptoIndex -Generator $Generator -ExclusiveMaximum $all.Length)]) }
  for ($i = $characters.Count - 1; $i -gt 0; $i--) {
    $j = Get-CryptoIndex -Generator $Generator -ExclusiveMaximum ($i + 1)
    $saved = $characters[$i]; $characters[$i] = $characters[$j]; $characters[$j] = $saved
  }
  return (-join $characters.ToArray())
}

function Write-NewPrivateText {
  param([string]$Path, [string]$Text)
  $encoding = New-Object Text.UTF8Encoding($true)
  $bytes = $encoding.GetPreamble() + $encoding.GetBytes($Text)
  $stream = $null
  try {
    $stream = New-Object IO.FileStream($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { if ($null -ne $stream) { $stream.Dispose() } }
}

if ([string]::IsNullOrWhiteSpace($LabRoot) -or $LabRoot -notmatch '^[A-Za-z]:[\\/]') { throw 'LabRoot must be an absolute local drive path.' }
if ($LabRoot.Substring(2).Contains(':')) { throw 'Alternate data streams are not allowed.' }
$LabRoot = [IO.Path]::GetFullPath($LabRoot).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath $LabRoot -PathType Container)) { throw 'LabRoot must already exist.' }
Assert-NoReparseAncestor -Path $LabRoot
$driveRoot = [IO.Path]::GetPathRoot($LabRoot)
if ($LabRoot -ieq $driveRoot.TrimEnd('\')) { throw 'LabRoot must not be a drive root.' }
if ($driveRoot -ieq [IO.Path]::GetPathRoot([Environment]::SystemDirectory)) { throw 'LabRoot must be outside the system drive.' }
$drive = New-Object IO.DriveInfo($driveRoot)
if (-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') { throw 'LabRoot must be on a ready local NTFS fixed drive.' }
if ($drive.AvailableFreeSpace -lt 128MB) { throw 'At least 128 MiB free space is required.' }
if (-not (Test-Path -LiteralPath $isoHelper -PathType Leaf)) { throw 'The new-answer-iso.ps1 helper is missing.' }
Assert-NoReparseAncestor -Path $isoHelper
$mapping = @()
for ($index = 0; $index -lt $roleNames.Count; $index++) {
  $role = $roleNames[$index]
  $mapping += [pscustomobject]@{ Role = $role; Account = ('wm{0:00}' -f ($index + 1)); ComputerName = ('wm-' + $role); VMName = ('workmesh-client-' + $role) }
}
$plan = [ordered]@{ Mode = 'plan'; LabRoot = $LabRoot; Accounts = $mapping; PasswordLength = 28; PasswordsPrinted = $false; ContainsPlaintextSecrets = $true; AutoLogon = $false; ChangesVMs = $false }
if (-not $Apply -or $WhatIfPreference) { [pscustomobject]$plan; return }
if (-not $PSCmdlet.ShouldProcess($LabRoot, 'Create private answer media and unique local guest credentials')) { return }

$run = Join-Path $LabRoot ('secure-answer-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N'))
Assert-NoReparseAncestor -Path $run
if (Test-Path -LiteralPath $run) { throw 'The unique answer directory already exists.' }
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$allowedSids = @($currentSid.Value, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sidText in $allowedSids) {
  $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit), [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
}
# The new directory is empty until its restrictive ACL has been checked.
$null = New-Item -ItemType Directory -Path $run
Set-Acl -LiteralPath $run -AclObject $acl
$actualAcl = Get-Acl -LiteralPath $run
if (-not $actualAcl.AreAccessRulesProtected) { throw 'Private answer directory still inherits access.' }
$actualRules = @($actualAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($actualRules.Count -ne $allowedSids.Count) { throw 'Unexpected private answer directory access rules.' }
foreach ($rule in $actualRules) {
  if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $allowedSids -notcontains $rule.IdentityReference.Value -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Private answer directory access validation failed.' }
}

$credentialsPath = Join-Path $run 'credentials.json'
$manifestPath = Join-Path $run 'manifest.json'
$credentials = New-Object 'System.Collections.Generic.List[object]'
$manifest = New-Object 'System.Collections.Generic.List[object]'
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  foreach ($entry in $mapping) {
    $password = New-LabPassword -Generator $generator
    $credentials.Add([pscustomobject]@{ Role = $entry.Role; Account = $entry.Account; Password = $password; VMName = $entry.VMName; ComputerName = $entry.ComputerName })
  }
  Write-NewPrivateText -Path $credentialsPath -Text ($credentials.ToArray() | ConvertTo-Json -Depth 5)
  foreach ($entry in $credentials) {
    $role = $entry.Role
    $account = $entry.Account
    $passwordXml = [Security.SecurityElement]::Escape($entry.Password)
    $roleRoot = Join-Path $run $role
    $source = Join-Path $roleRoot 'source'
    $null = New-Item -ItemType Directory -Path $source
    $oobeSettings = @"
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><InputLocale>0804:00000804</InputLocale><SystemLocale>zh-CN</SystemLocale><UILanguage>zh-CN</UILanguage><UserLocale>zh-CN</UserLocale></component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <UserAccounts><LocalAccounts><LocalAccount wcm:action="add"><Name>$account</Name><DisplayName>WorkMesh $role</DisplayName><Description>WorkMesh isolated role lab</Description><Group>Administrators</Group><Password><Value>$passwordXml</Value><PlainText>true</PlainText></Password></LocalAccount></LocalAccounts></UserAccounts>
      <OOBE><HideEULAPage>true</HideEULAPage><HideOEMRegistrationScreen>true</HideOEMRegistrationScreen><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC></OOBE>
    </component>
  </settings>
"@
    $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <SetupUILanguage><UILanguage>zh-CN</UILanguage></SetupUILanguage>
      <InputLocale>0804:00000804</InputLocale><SystemLocale>zh-CN</SystemLocale><UILanguage>zh-CN</UILanguage><UserLocale>zh-CN</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <DiskConfiguration><Disk wcm:action="add"><DiskID>0</DiskID><WillWipeDisk>true</WillWipeDisk>
        <CreatePartitions>
          <CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>300</Size></CreatePartition>
          <CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition>
          <CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition>
        </CreatePartitions>
        <ModifyPartitions>
          <ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition>
          <ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition>
        </ModifyPartitions>
      </Disk><WillShowUI>OnError</WillShowUI></DiskConfiguration>
      <ImageInstall><OSImage><InstallFrom><MetaData wcm:action="add"><Key>/IMAGE/INDEX</Key><Value>1</Value></MetaData></InstallFrom><InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo><WillShowUI>OnError</WillShowUI></OSImage></ImageInstall>
      <UserData><AcceptEula>true</AcceptEula><FullName>WorkMesh Lab</FullName><Organization>WorkMesh Lab</Organization></UserData>
      <DynamicUpdate><Enable>false</Enable></DynamicUpdate>
    </component>
  </settings>
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><ComputerName>wm-$role</ComputerName><TimeZone>China Standard Time</TimeZone></component>
  </settings>
$oobeSettings
</unattend>
"@
    $oobeOnly = '<?xml version="1.0" encoding="utf-8"?>' + "`r`n" + '<unattend xmlns="urn:schemas-microsoft-com:unattend">' + "`r`n" + $oobeSettings + "`r`n</unattend>"
    try { $null = [xml]$xml; $null = [xml]$oobeOnly } catch { throw ('Generated XML validation failed for role ' + $role + '. No secret content is included in this error.') }
    Write-NewPrivateText -Path (Join-Path $source 'Autounattend.xml') -Text $xml
    Write-NewPrivateText -Path (Join-Path $source 'oobe-only.xml') -Text $oobeOnly
    $isoPath = Join-Path $roleRoot ($role + '-answer.iso')
    $made = & $isoHelper -SourceDirectory $source -IsoPath $isoPath -VolumeLabel ('WM_' + $role.ToUpperInvariant()) -Apply
    $manifest.Add([pscustomobject]@{ Role = $role; Account = $account; ComputerName = $entry.ComputerName; VMName = $entry.VMName; IsoPath = $isoPath; IsoSHA256 = $made.sha256; CredentialsFile = $credentialsPath; OobeOnlyPath = (Join-Path $source 'oobe-only.xml'); ContainsCredentials = $true; AutoLogon = $false })
    $passwordXml = $null; $xml = $null; $oobeOnly = $null; $oobeSettings = $null
  }
  Write-NewPrivateText -Path $manifestPath -Text ($manifest.ToArray() | ConvertTo-Json -Depth 5)
  [pscustomobject]@{ Mode = 'created'; Directory = $run; ManifestPath = $manifestPath; CredentialsFile = $credentialsPath; Accounts = $mapping; PasswordsPrinted = $false; ProtectedForSids = @($allowedSids); AutoLogon = $false }
} finally {
  $generator.Dispose()
  $password = $null; $passwordXml = $null; $xml = $null; $oobeOnly = $null; $oobeSettings = $null
}
