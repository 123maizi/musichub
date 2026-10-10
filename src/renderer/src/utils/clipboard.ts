/**
 * 复制文本到剪贴板。
 *
 * 为什么要写降级：应用打包后页面走的是 `file://` 协议，而 `navigator.clipboard`
 * 在部分 Electron 版本 / 非安全上下文下会直接不可用或抛错。这种情况退回
 * `document.execCommand('copy')` —— 它虽然被标记为废弃，但在 Electron 里稳定可用，
 * 是这类场景的标准兜底。
 */
export async function copyText(text: string): Promise<boolean> {
  const value = (text ?? '').trim()
  if (!value) return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* 继续走降级路径 */
  }

  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    // 不能 display:none —— 那样选不中；用离屏定位
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/**
 * 复制用的歌名文本。
 *
 * 带歌手是因为这个字符串多半要被粘到别处去搜同一首歌 ——
 * 「歌手 - 歌名」比光秃秃的歌名命中率高得多。歌手缺失时退回歌名本身。
 */
export function songCopyText(song: { name?: string; singer?: string } | null | undefined): string {
  if (!song) return ''
  const name = (song.name ?? '').trim()
  const singer = (song.singer ?? '').trim()
  if (name && singer) return `${singer} - ${name}`
  return name || singer
}
