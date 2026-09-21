/**
 * 验证下载链路：
 *   1. 内容校验——下到的必须是音频，否则判失败并删文件
 *   2. 标签——专辑、专辑艺术家、封面都要写进去
 *   3. 平台没给封面时，跨平台补一张
 *
 * 用临时目录，不污染用户自己的下载文件夹。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-test'

await window.api.download.setConfig({ dir: TEST_DIR, writeTag: true, downloadCover: true })
// 清掉旧任务，避免干扰
const existing = await window.api.download.list()
if (existing.length > 0) {
  await window.api.download.remove(existing.map((t) => t.id), true)
}

/* 找一首酷我的歌（酷我搜索结果常常没有封面地址，正好测补图） */
const res = await window.api.search.search({ keyword: '蛋堡 收敛水', limit: 30 })
const all = res.platforms.flatMap((p) => p.songs)
const noCover = all.filter((s) => s.platform === 'kw' && !s.picUrl)
const withCover = all.filter((s) => s.platform === 'kw' && s.picUrl)
const pick = noCover[0] ?? withCover[0] ?? all[0]

const out = {
  候选: {
    总数: all.length,
    酷我无封面: noCover.length,
    酷我有封面: withCover.length
  },
  选中的歌: {
    名: pick.name,
    歌手: pick.singer,
    专辑: pick.albumName,
    平台: pick.platform,
    平台给了封面: Boolean(pick.picUrl)
  }
}

const tasks = await window.api.download.add({ songs: [pick], quality: '320k' })
out.任务已建 = tasks.length

/* 等下载完成 */
let done = null
for (let i = 0; i < 90; i += 1) {
  await sleep(1000)
  const list = await window.api.download.list()
  const t = list[0]
  if (!t) continue
  if (t.status === 'done' || t.status === 'error') {
    done = t
    break
  }
}

out.结果 = done
  ? {
      状态: done.status,
      文件: done.fileName,
      路径: done.savePath,
      错误: done.error,
      大小KB: done.received ? Math.round(done.received / 1024) : null
    }
  : { 状态: '超时未完成' }

return JSON.stringify(out, null, 1)
