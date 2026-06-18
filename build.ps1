$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "-> Building..."
npm run build

Write-Host "-> Installing globally..."
npm install -g .

$ver = & omm --version 2>$null
if (-not $ver) { $ver = 'omm installed' }
Write-Host "Done -- $ver"
