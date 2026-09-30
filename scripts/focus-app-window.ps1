/**
 * 把 Electron 主窗口恢复并置前。
 *
 * 为什么需要这个：隐藏/最小化/被遮挡的窗口里 requestAnimationFrame 完全停摆
 * （实测 document.hidden=true 时 600ms 内 0 帧）。而 Vue 的 <Transition> 靠
 * 「双 rAF」推进 leave 流程，rAF 不来 → leave-from 一直挂着、属性值不变、
 * transitionend 永不到达 → 配合 mode="out-in"，RouterView 会永久卡死。
 *
 * 所以任何 CDP 驱动的验收/探针，都必须先把窗口显示出来，
 * 否则会得到「点导航没反应」「下载点了不入队」这类假失败。
 */
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@

$procs = Get-Process -Name electron -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 }

if (-not $procs) {
  Write-Output '没有找到带窗口的 electron 进程'
  exit 1
}

foreach ($p in $procs) {
  $h = $p.MainWindowHandle
  $wasMin = [Win]::IsIconic($h)
  # SW_RESTORE = 9
  [void][Win]::ShowWindow($h, 9)
  Start-Sleep -Milliseconds 200
  # HWND_TOP = 0, SWP_NOMOVE|SWP_NOSIZE = 0x0002|0x0001
  [void][Win]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, 0x0003)
  [void][Win]::SetForegroundWindow($h)
  Write-Output ("已恢复并置前: pid={0} 之前最小化={1}" -f $p.Id, $wasMin)
}
