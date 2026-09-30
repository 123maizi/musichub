# Isolated MusicHub instance runner (port 9225 by default).
#
# WHY THIS EXISTS (read before using the shared out/ directory for testing)
# ---------------------------------------------------------------------------
# Four agents share F:\MusicHub\out. Views are lazy-loaded:
#   () => import('../views/AlbumView.vue')  etc.
# Every time ANY agent runs a build, Vite rewrites those chunks with new hashes
# and deletes the old files (emptyOutDir). Your already-running instance still
# references the old hashes, so the next navigation fails with:
#   TypeError: Failed to fetch dynamically imported module: .../AlbumView-XXXX.js
# net::ERR_FILE_NOT_FOUND -> the page silently renders nothing.
# This was hit 3 times during UI work (album jump / library page / playlist
# remove) and every time it looked like a product bug. It is not.
#
# THE WORKAROUND
#   1. build the renderer into a PRIVATE directory (scripts/perf-renderer.vite.config.mjs)
#   2. launch electron with ELECTRON_RENDERER_URL pointing at that private index.html
#      (main process loads it when `is.dev` is true)
#   3. main/preload still come from the shared out/ build (loaded into memory at
#      process start, so later rebuilds cannot affect the running process),
#      while renderer + all lazy chunks live in the private dir and are immune.
#
# NOTE: use this for iteration/verification only. Final acceptance should still
# run against the shared out/ built via: node scripts/build-lock.mjs <label>
#
# USAGE
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\isolated-instance.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\isolated-instance.ps1 -Probe scripts\perf-regression.mjs
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\isolated-instance.ps1 -Port 9225 -NoSharedBuild
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI.
param(
  [int]$Port = 9225,
  [string]$Probe = '',
  [string]$Profile = 'F:\MusicHub\.tmp\perf-profile',
  [switch]$NoSharedBuild,
  [switch]$KeepRunning
)

$root = 'F:\MusicHub'
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
$privateOut = Join-Path $root '.tmp\perf-out\renderer'

Set-Location $root

# 1. main/preload from the shared build (serialized by the build lock)
if (-not $NoSharedBuild) {
  Write-Host '[isolated] building shared out/ (main + preload + renderer, lock held)'
  node scripts\build-lock.mjs isolated | Out-Null
}

# 2. renderer into the private directory
Write-Host '[isolated] building renderer into .tmp/perf-out/renderer'
$env:PERF_RENDERER_OUT = '.tmp/perf-out/renderer'
node node_modules\vite\bin\vite.js build --config scripts\perf-renderer.vite.config.mjs --logLevel error
Remove-Item Env:\PERF_RENDERER_OUT -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $privateOut 'index.html'))) {
  Write-Host '[isolated] FAILED: private renderer build produced no index.html'
  exit 1
}

# 3. launch, isolated profile + no background throttling (steady measurements)
#
# --disable-features=CalculateNativeWinOcclusion is REQUIRED, not optional:
# when Windows decides the window is occluded, Chromium marks the page hidden
# (document.hidden = true) and requestAnimationFrame stops firing entirely.
# Consequences seen in practice:
#   * Vue <Transition mode="out-in"> never completes the leave animation, so the
#     router view freezes on the old page (hash changes, content does not)
#   * every rAF-based probe (frame intervals, entry window, interleaved A/B)
#     loses all resolution or reports nonsense
# The other two flags cover renderer/background throttling; Page.bringToFront
# from the probe client is a third layer. All three are cheap, keep them.
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like "*$Profile*" -or $_.CommandLine -like "*--remote-debugging-port=$Port*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

$env:ELECTRON_RENDERER_URL = "file:///$($privateOut.Replace('\', '/'))/index.html"
Start-Process -FilePath $exe -ArgumentList '.', "--remote-debugging-port=$Port", "--user-data-dir=$Profile", '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion' -WorkingDirectory $root
Start-Sleep -Seconds 13

Write-Host "[isolated] launched, renderer = $env:ELECTRON_RENDERER_URL"
node scripts\perf-cdp.mjs ping

# 4. rAF / visibility guard: if this fails, EVERY rAF-based number is worthless
Write-Host '[isolated] checking rAF + visibility (frames in 600ms should be > 0, hidden should be false)'
$env:PERF_CDP_PORT = "$Port"
node scripts\perf-cdp.mjs evalfile scripts\perf-raf-guard.mjs

# 4. optional probe
if ($Probe) {
  $env:PERF_CDP_PORT = "$Port"
  node scripts\perf-cdp.mjs evalfile $Probe
  exit $LASTEXITCODE
}

if (-not $KeepRunning) {
  Write-Host '[isolated] instance left running (use -Probe to run a probe, or kill it manually)'
}
exit 0
