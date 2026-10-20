# Scripted launch that never takes keyboard focus. Needs tools\noactivate.ps1 (included).
#   .\launch.ps1 --control-port 9120
#   .\launch.ps1 --capture shots\tour.json --out out\tour.mp4 --fps 60
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AppArgs)
. "$PSScriptRoot\tools\noactivate.ps1"
$exe = Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe'
Start-NoActivate -Exe $exe -ArgList (@($PSScriptRoot) + $AppArgs) -WorkDir $PSScriptRoot
