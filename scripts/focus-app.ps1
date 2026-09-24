Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Fg {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
if (-not $p) { echo "找不到窗口"; exit 1 }
echo "窗口: $($p.MainWindowTitle)  PID=$($p.Id)"
[Win32Fg]::ShowWindow($p.MainWindowHandle, 6) | Out-Null   # SW_MINIMIZE
Start-Sleep -Milliseconds 400
[Win32Fg]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
Start-Sleep -Milliseconds 400
[Win32Fg]::BringWindowToTop($p.MainWindowHandle) | Out-Null
[Win32Fg]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 600
echo "已置前"
