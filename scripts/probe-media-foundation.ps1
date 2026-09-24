/**
 * 直接用 Windows Media Foundation 打开文件 —— 这就是「媒体播放器」双击时走的那条路。
 * Chromium 能解码不代表 MF 能解码，两者是两套完全不同的实现。
 *
 * MFCreateSourceReaderFromURL 的 HRESULT 就是用户在弹窗里看到的那个错误码。
 */
param([Parameter(Mandatory = $true)][string[]]$Files)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class MFProbe {
  [DllImport("mfplat.dll", ExactSpelling = true)]
  public static extern int MFStartup(int Version, int dwFlags);

  [DllImport("mfplat.dll", ExactSpelling = true)]
  public static extern int MFShutdown();

  [DllImport("mfplat.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern int MFCreateSourceReaderFromURL(string pwszURL, IntPtr pAttributes, out IntPtr ppSourceReader);

  [DllImport("mfreadwrite.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern int MFCreateSourceReaderFromByteStream(IntPtr pByteStream, IntPtr pAttributes, out IntPtr ppSourceReader);
}
"@

# MFSTARTUP_FULL = 0, MF_API_VERSION = 0x0070
$hr = [MFProbe]::MFStartup(0x0070, 0)
Write-Host "MFStartup: 0x{0:X8}" -f $hr
Write-Host ""

foreach ($f in $Files) {
  if (-not (Test-Path -LiteralPath $f)) {
    Write-Host "不存在: $f"
    continue
  }
  $reader = [IntPtr]::Zero
  $code = [MFProbe]::MFCreateSourceReaderFromURL($f, [IntPtr]::Zero, [ref]$reader)
  $name = Split-Path -Leaf $f
  $size = (Get-Item -LiteralPath $f).Length

  if ($code -eq 0) {
    $verdict = "OK  Windows 能打开"
  }
  else {
    # 有符号形式，和弹窗里显示的一致
    $signed = [int]$code
    $verdict = "FAIL 0x{0:X8} ({1})" -f $code, $signed
  }

  Write-Host ("{0,-46} {1,10} 字节  {2}" -f $name, $size, $verdict)

  if ($reader -ne [IntPtr]::Zero) {
    [System.Runtime.InteropServices.Marshal]::Release($reader) | Out-Null
  }
}

[MFProbe]::MFShutdown() | Out-Null
