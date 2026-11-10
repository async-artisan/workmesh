#Requires -Version 5.1
<#
.SYNOPSIS
  Plan or create a nonbootable ISO from an existing local directory.
.DESCRIPTION
  The default is read-only. -Apply packages the existing source tree with the
  Windows IMAPI2FS API, using ISO9660 and Joliet. It does not mount an image,
  change the source, download anything, or call Hyper-V. Use a dedicated source
  directory containing only files you intend to place on this unencrypted ISO.
  Output must be on an existing local fixed drive other than the system drive.
  Existing output and .partial files are never overwritten. A failed write
  retains its .partial file for inspection. No administrator rights are needed.
.EXAMPLE
  .\new-answer-iso.ps1 -SourceDirectory G:\lab\answer -IsoPath G:\lab\answer.iso
.EXAMPLE
  .\new-answer-iso.ps1 -SourceDirectory G:\lab\answer -IsoPath G:\lab\answer.iso -Apply
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$IsoPath,
  [ValidatePattern('^[A-Z0-9_]{1,32}$')][string]$VolumeLabel = 'WORKMESH_ANSWER',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Get-SourceManifest {
  param([string]$Directory)
  Assert-NoReparseAncestor -Path $Directory
  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $entries = New-Object 'System.Collections.Generic.List[object]'
  $pending.Push($Directory)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    foreach ($path in [IO.Directory]::EnumerateFileSystemEntries($current)) {
      $attributes = [IO.File]::GetAttributes($path)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw ('Source contains a reparse point, junction or symbolic link: ' + $path)
      }
      $relative = $path.Substring($Directory.Length + 1)
      $isDirectory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
      if ($isDirectory) {
        $entries.Add([pscustomobject]@{ relative = $relative; directory = $true; length = [long]0; modified = [long]0 })
        $pending.Push($path)
      } else {
        $file = New-Object IO.FileInfo($path)
        if ($file.Length -gt 4294967295) { throw ('ISO9660/Joliet cannot package a file larger than 4 GiB minus 1 byte: ' + $path) }
        $entries.Add([pscustomobject]@{ relative = $relative; directory = $false; length = $file.Length; modified = $file.LastWriteTimeUtc.Ticks })
      }
    }
  }
  return $entries.ToArray()
}

function Get-ManifestSignature {
  param([object[]]$Entries)
  return @($Entries | Sort-Object relative | ForEach-Object {
    '{0}|{1}|{2}|{3}' -f $_.directory, $_.length, $_.modified, $_.relative
  })
}

$SourceDirectory = Get-AbsoluteLocalPath -Value $SourceDirectory -Label 'SourceDirectory'
$IsoPath = Get-AbsoluteLocalPath -Value $IsoPath -Label 'IsoPath'
if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) { throw 'SourceDirectory must already exist.' }
if ($SourceDirectory.TrimEnd('\') -eq [IO.Path]::GetPathRoot($SourceDirectory).TrimEnd('\')) {
  throw 'SourceDirectory must be a dedicated directory, not a drive root.'
}
if ([IO.Path]::GetExtension($IsoPath) -ine '.iso') { throw 'IsoPath must end with .iso.' }
if ($IsoPath.StartsWith($SourceDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'IsoPath must be outside SourceDirectory.'
}
$outputDirectory = [IO.Path]::GetDirectoryName($IsoPath)
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) { throw 'The ISO parent directory must already exist.' }
Assert-NoReparseAncestor -Path $IsoPath
$driveRoot = [IO.Path]::GetPathRoot($IsoPath)
$systemRoot = [IO.Path]::GetPathRoot([Environment]::SystemDirectory)
if ($driveRoot -ieq $systemRoot) { throw 'IsoPath must be outside the Windows system drive.' }
$drive = New-Object IO.DriveInfo($driveRoot)
if (-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'IsoPath must be on a ready local fixed drive.' }
$partialPath = $IsoPath + '.partial'
if ((Test-Path -LiteralPath $IsoPath) -or (Test-Path -LiteralPath $partialPath)) {
  throw 'The target ISO or its .partial file already exists. Neither will be overwritten.'
}
if ($null -eq [Type]::GetTypeFromProgID('IMAPI2FS.MsftFileSystemImage')) { throw 'Windows IMAPI2FS is not available.' }
$manifest = @(Get-SourceManifest -Directory $SourceDirectory)
$files = @($manifest | Where-Object { -not $_.directory })
$sourceBytes = [long]0
foreach ($entry in $files) { $sourceBytes += $entry.length }
# Source may also be staged by IMAPI; reserve two copies plus metadata headroom.
$requiredBytes = [long]($sourceBytes * 2 + 64MB)
if ($drive.AvailableFreeSpace -lt $requiredBytes) { throw 'The output drive needs at least twice the source size plus 64 MiB free.' }
$plan = [ordered]@{
  mode = 'plan'; readyToApply = $true; sourceDirectory = $SourceDirectory
  isoPath = $IsoPath; partialPath = $partialPath; volumeLabel = $VolumeLabel
  fileSystems = @('ISO9660', 'Joliet'); bootable = $false
  fileCount = $files.Count; sourceBytes = $sourceBytes
  note = 'The ISO is unencrypted. Only package files intended for its recipients. -Apply creates it; no source file is changed.'
}
if (-not $Apply -or $WhatIfPreference) { [pscustomobject]$plan; return }
if (-not $PSCmdlet.ShouldProcess($IsoPath, 'Create a nonbootable ISO from the existing source directory')) { return }

$scratchPath = Join-Path $outputDirectory ('.answer-iso-' + [guid]::NewGuid().ToString('N') + '.work')
$image = $null
$root = $null
$result = $null
$imageStream = $null
$savedTemp = $env:TEMP
$savedTmp = $env:TMP
$createdScratch = $false
try {
  Assert-NoReparseAncestor -Path $IsoPath
  $current = @(Get-SourceManifest -Directory $SourceDirectory)
  $beforeSignature = @(Get-ManifestSignature -Entries $manifest)
  $currentSignature = @(Get-ManifestSignature -Entries $current)
  if (($beforeSignature -join "`n") -cne ($currentSignature -join "`n")) { throw 'Source changed after preflight. Run the script again with a stable source directory.' }
  $null = New-Item -ItemType Directory -Path $scratchPath
  $createdScratch = $true
  # Windows PowerShell Add-Type compilation and IMAPI scratch stay on this drive.
  $env:TEMP = $scratchPath
  $env:TMP = $scratchPath
  if ($null -eq ('WorkMesh.VmIso.StreamCopyV1' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
namespace WorkMesh.VmIso {
    public static class StreamCopyV1 {
        public static long Write(object source, string destination, long expectedLength) {
            IStream stream = (IStream)source;
            byte[] buffer = new byte[65536];
            IntPtr bytesRead = Marshal.AllocHGlobal(sizeof(int));
            long total = 0;
            try {
                stream.Seek(0, 0, IntPtr.Zero);
                using (FileStream output = new FileStream(destination, FileMode.CreateNew,
                    FileAccess.Write, FileShare.None, buffer.Length, FileOptions.SequentialScan)) {
                    while (true) {
                        Marshal.WriteInt32(bytesRead, 0);
                        stream.Read(buffer, buffer.Length, bytesRead);
                        int count = Marshal.ReadInt32(bytesRead);
                        if (count < 0 || count > buffer.Length) throw new IOException("Invalid COM IStream byte count.");
                        if (count == 0) break;
                        if (total > expectedLength - count) throw new IOException("ISO stream exceeded its declared length.");
                        output.Write(buffer, 0, count);
                        total += count;
                    }
                    if (total != expectedLength) throw new IOException("ISO stream was shorter than its declared length.");
                    output.Flush(true);
                }
                return total;
            } finally { Marshal.FreeHGlobal(bytesRead); }
        }
    }
}
'@
  }
  $image = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
  $image.WorkingDirectory = $scratchPath
  $image.FileSystemsToCreate = 3
  $image.StrictFileSystemCompliance = $true
  $image.VolumeName = $VolumeLabel
  $root = $image.Root
  $root.AddTree($SourceDirectory, $false)
  $result = $image.CreateResultImage()
  $expectedBytes = [long]$result.TotalBlocks * [long]$result.BlockSize
  if ($expectedBytes -le 0) { throw 'IMAPI returned an empty ISO stream.' }
  $imageStream = $result.ImageStream
  Assert-NoReparseAncestor -Path $partialPath
  $written = [WorkMesh.VmIso.StreamCopyV1]::Write($imageStream, $partialPath, $expectedBytes)
  $afterSignature = @(Get-ManifestSignature -Entries @(Get-SourceManifest -Directory $SourceDirectory))
  if (($beforeSignature -join "`n") -cne ($afterSignature -join "`n")) {
    throw 'Source changed during ISO generation. The .partial file is retained; the final ISO was not published.'
  }
  Assert-NoReparseAncestor -Path $IsoPath
  Assert-NoReparseAncestor -Path $partialPath
  # .NET Framework File.Move refuses an existing target; there is no overwrite.
  [IO.File]::Move($partialPath, $IsoPath)
  $plan.mode = 'created'
  $plan['isoBytes'] = $written
  $plan['sha256'] = (Get-FileHash -LiteralPath $IsoPath -Algorithm SHA256).Hash
  $plan['createdUtc'] = [DateTime]::UtcNow.ToString('o')
  [pscustomobject]$plan
} catch {
  throw ('ISO creation failed: ' + $_.Exception.Message + ' Any partial output is retained at ' + $partialPath + '; scratch directory: ' + $scratchPath)
} finally {
  $env:TEMP = $savedTemp
  $env:TMP = $savedTmp
  foreach ($com in @($imageStream, $result, $root, $image)) {
    if ($null -ne $com -and [Runtime.InteropServices.Marshal]::IsComObject($com)) {
      try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com) } catch { }
    }
  }
  if ($createdScratch -and (Test-Path -LiteralPath $scratchPath -PathType Container)) {
    try {
      # Never recursively delete scratch; retain any unexpected content.
      if (@(Get-ChildItem -LiteralPath $scratchPath -Force).Count -eq 0) {
        Remove-Item -LiteralPath $scratchPath -ErrorAction Stop
      } else { Write-Warning ('ISO scratch files were retained at ' + $scratchPath) }
    } catch { Write-Warning ('ISO scratch directory was retained at ' + $scratchPath) }
  }
}
