/**
 * 更新 GitHub 仓库介绍（描述 + 话题）。
 *
 * 为什么单独一个脚本：release.mjs 只管发布与附件，仓库本身的「一句话介绍」
 * 与话题标签得走 PATCH /repos 与 PUT /repos/.../topics 两个接口。
 * token 依旧从 git 凭据里取，**绝不打印**。
 *
 * 用法: node scripts/update-repo-meta.mjs
 */
import { execFileSync } from 'node:child_process'

const GIT = 'C:\\Users\\18509\\AppData\\Local\\GitHubDesktop\\app-3.6.6\\resources\\app\\git\\cmd\\git.exe'
const REPO = '123maizi/musichub'

function getToken() {
  const out = execFileSync(GIT, ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  })
  const line = out.split('\n').find((l) => l.startsWith('password='))
  if (!line) throw new Error('git 凭据里没有 password 字段')
  return line.slice('password='.length).trim()
}

/** 一句话介绍：GitHub 上限 350 字符 */
const DESCRIPTION =
  '多音源音乐聚合播放与下载器（2.0.0 大版本）· 46 个纯净音源｜点击到出声平均 175ms｜' +
  '进度条逐像素精确｜歌词译文覆盖 96~100% 且零 AI｜不存储、不提供、不传播任何音乐内容'

const TOPICS = [
  'electron',
  'vue3',
  'typescript',
  'music-player',
  'music-downloader',
  'lx-music',
  'neteasemusic',
  'qqmusic',
  'kugou',
  'kuwo',
  'desktop-app'
]

const token = getToken()
const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'MusicHub-Release'
}

if (DESCRIPTION.length > 350) throw new Error(`描述过长：${DESCRIPTION.length} 字符`)

const patch = await fetch(`https://api.github.com/repos/${REPO}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ description: DESCRIPTION })
})
const patched = await patch.json()
if (!patch.ok) {
  console.error('✗ 描述更新失败', patch.status, patched.message ?? '')
  process.exit(1)
}
console.log(`✓ 描述已更新（${DESCRIPTION.length} 字符）`)

const topics = await fetch(`https://api.github.com/repos/${REPO}/topics`, {
  method: 'PUT',
  headers: { ...headers, Accept: 'application/vnd.github+json' },
  body: JSON.stringify({ names: TOPICS })
})
const topicBody = await topics.json()
if (!topics.ok) {
  console.error('✗ 话题更新失败', topics.status, topicBody.message ?? '')
  process.exit(1)
}
console.log(`✓ 话题已更新：${(topicBody.names ?? []).join(', ')}`)
console.log(`  仓库页：https://github.com/${REPO}`)
