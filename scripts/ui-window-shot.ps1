# Capture the MusicHub window pixels straight from the desktop.
# CDP Page.captureScreenshot hangs in this GPU-composited window, so we grab the
# real window rect and copy the screen region instead.
# ASCII only: Windows PowerShell reads BOM-less .ps1 as ANSI and mangles CJK.
param(
  [string]$Out = 'F:\MusicHub\.tmp\ui-window.png',
  [string]$Match = '9223'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sig = @'
using System;
using System.Runtime.InteropServices;
public class Win32Rect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
'@
if (-not ('Win32Rect' -as [type])) { Add-Type -TypeDefinition $sig }

# A plain SetForegroundWindow is not enough: another window (e.g. the DSH Web GUI)
# can steal focus back before CopyFromScreen runs, and we capture its pixels instead.
# Pin the target on top for the capture, then release it.
$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP_NOMOVE_NOSIZE = 0x0002 -bor 0x0001

# Find our own instance by its command line (the one carrying the CDP port)
$proc = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like "*remote-debugging-port=$Match*" -and $_.CommandLine -notlike '*--type=*' } |
  Select-Object -First 1
if (-not $proc) { Write-Output "no electron main process for port $Match"; exit 1 }

$p = Get-Process -Id $proc.ProcessId
$h = $p.MainWindowHandle
if ($h -eq 0) { Write-Output "main window handle is 0 (window not realized yet)"; exit 1 }

[void][Win32Rect]::ShowWindow($h, 9)   # SW_RESTORE
[void][Win32Rect]::SetWindowPos($h, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_NOMOVE_NOSIZE)
[void][Win32Rect]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 900

$r = New-Object Win32Rect+RECT
[void][Win32Rect]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$hh = $r.Bottom - $r.Top
if ($w -le 0 -or $hh -le 0) { Write-Output "bad window rect ${w}x${hh}"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

# Release topmost so we do not leave the window pinned above everything
[void][Win32Rect]::SetWindowPos($h, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP_NOMOVE_NOSIZE)

$size = (Get-Item $Out).Length
Write-Output "saved $Out  ${w}x${hh}  $size bytes  (handle=$h)"
