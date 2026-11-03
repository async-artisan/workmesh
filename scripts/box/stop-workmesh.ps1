#Requires -Version 5.1
[CmdletBinding()]
param([string]$DataDir = (Join-Path $env:ProgramData 'WorkMesh'))
$ErrorActionPreference='Stop'
$root=[System.IO.Path]::GetFullPath($PSScriptRoot)
$dataRoot=[System.IO.Path]::GetFullPath($DataDir)
$stateFile=Join-Path $dataRoot 'processes.json'
$pgCtl=Join-Path $root 'runtime\pgsql\bin\pg_ctl.exe'
$pgData=Join-Path $dataRoot 'pg'

function Test-Managed([int]$ProcessId,[string]$ExpectedPath,[string]$ExpectedExe) {
  if($ProcessId -le 4){return $false}
  $info=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if(-not $info){return $false}
  $expected=[System.IO.Path]::GetFullPath($ExpectedPath)
  $exe=[System.IO.Path]::GetFullPath($ExpectedExe)
  return ($info.ExecutablePath -ieq $exe) -and ([string]$info.CommandLine).IndexOf($expected,[System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

$pending=$false
if(Test-Path -LiteralPath $stateFile){
  try{$state=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json}catch{$state=$null}
  if($state -and $state.dataDir -eq $dataRoot){
    foreach($target in @(
      [pscustomobject]@{Id=[int]$state.apiPid;Path=[string]$state.apiPath;Label='API'},
      [pscustomobject]@{Id=[int]$state.webPid;Path=[string]$state.webPath;Label='Web'}
    )){
      if($target.Id -le 4 -or [string]::IsNullOrWhiteSpace($target.Path)){continue}
      $expectedExe=Join-Path $root 'runtime\node.exe'
      if(Test-Managed $target.Id $target.Path $expectedExe){Stop-Process -Id $target.Id -Force;Write-Host "Stopped owned $($target.Label) process $($target.Id)." -ForegroundColor Yellow}
      elseif(Get-Process -Id $target.Id -ErrorAction SilentlyContinue){$pending=$true;Write-Warning "PID $($target.Id) no longer matches this WorkMesh installation; left it running."}
    }
  } elseif($state){$pending=$true;Write-Warning 'Process state belongs to a different DataDir; left its processes running.'}
}

if((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))){
  & $pgCtl status -D $pgData *> $null
  if($LASTEXITCODE -eq 0){
    & $pgCtl -D $pgData stop -m fast
    if($LASTEXITCODE -ne 0){throw "Failed to stop PostgreSQL owned by $pgData."}
    Write-Host 'Stopped the PostgreSQL instance owned by this DataDir.' -ForegroundColor Yellow
  }
}
if(-not $pending -and (Test-Path -LiteralPath $stateFile)){Remove-Item -LiteralPath $stateFile -Force}
Write-Host 'WorkMesh stop complete.' -ForegroundColor Yellow
