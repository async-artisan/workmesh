#Requires -Version 5.1
[CmdletBinding()]
param([string]$DataDir = (Join-Path $env:ProgramData 'WorkMesh'))
$config=Join-Path $DataDir 'config.env'
$ports=@(3000,5173)
if(Test-Path $config){
  foreach($line in (Get-Content $config)){
    if($line -match '^PORT=(\d+)$'){$ports += [int]$matches[1]}
    if($line -match '^WEB_ORIGIN=http://[^:]+:(\d+)$'){$ports += [int]$matches[1]}
  }
}
$ports=$ports | Select-Object -Unique
foreach($port in $ports){
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object {$_ -gt 4} |
    ForEach-Object {Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}
}
$root=$PSScriptRoot
$pgCtl=Join-Path $root 'runtime\pgsql\bin\pg_ctl.exe'
$pgData=Join-Path $dataDir 'pg'
if(Test-Path $pgCtl){& $pgCtl -D $pgData stop -m fast 2>$null}
Write-Host 'WorkMesh stopped.' -ForegroundColor Yellow
