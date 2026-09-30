# cover-fix launcher: CDP port 9223 + isolated userData (bypasses the single-instance lock).
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI and mangles CJK.
$ErrorActionPreference = 'Stop'

# electron degrades to plain node when ELECTRON_RUN_AS_NODE is set
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$exe = 'F:\MusicHub\node_modules\electron\dist\electron.exe'
$profile = 'F:\MusicHub\.tmp\cover-fix-profile'

# kill only the 9223 instance; never touch the teammate instance on 9222
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*remote-debugging-port=9223*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 900

Start-Process -FilePath $exe `
  -ArgumentList '.', '--remote-debugging-port=9223', "--user-data-dir=$profile" `
  -WorkingDirectory 'F:\MusicHub'

for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Milliseconds 1000
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9223/json' -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { Write-Output "CDP 9223 ready after ${i}s"; exit 0 }
  } catch { }
}
Write-Output 'CDP 9223 NOT ready'
exit 1
