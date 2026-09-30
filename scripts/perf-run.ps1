# Render-perf A/B runner (port 9225, private user-data-dir).
#
# NOTE: this shell is Windows PowerShell 5.1 and reads .ps1 as ANSI,
# so keep this file ASCII-only.
#
# Usage:
#   & .\scripts\perf-run.ps1 -Label before1
#   & .\scripts\perf-run.ps1 -Label afterCvOff -RendererUrl "file:///F:/MusicHub/.tmp/perf-after-out/renderer/index.html" -Cv off
param(
  [Parameter(Mandatory = $true)][string]$Label,
  [string]$RendererUrl = '',
  [string]$Cv = 'default'
)

$root = 'F:\MusicHub'
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
$profile = Join-Path $root '.tmp\perf-profile'

Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*perf-profile*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

if ($RendererUrl) { $env:ELECTRON_RENDERER_URL = $RendererUrl }
else { Remove-Item Env:\ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue }

Start-Process -FilePath $exe -ArgumentList '.', '--remote-debugging-port=9225', "--user-data-dir=$profile", '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows' -WorkingDirectory $root
Start-Sleep -Seconds 8

Set-Location $root
$env:PERF_CV = $Cv
$env:PERF_OUT = "$root\.tmp\perf-$Label.json"
node scripts\perf-cdp.mjs ping
node scripts\perf-probe.mjs $Label | Out-Null
$code = $LASTEXITCODE
Write-Host "[perf-run] $Label exit=$code cv=$Cv"
if ($code -ne 0) { Get-Content "$root\.tmp\perf-$Label.log" -ErrorAction SilentlyContinue | Select-Object -First 20 }
exit $code
