/**
 * 核对 release 是否真的传上去了：标题、附件名、大小、下载链接。
 * 只读，不上传。
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

const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
  headers: {
    Authorization: `token ${getToken()}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'MusicHub-Check'
  }
})
if (!res.ok) throw new Error(`HTTP ${res.status}`)
const releases = await res.json()

console.log(`release 总数: ${releases.length}\n`)
for (const r of releases.slice(0, 4)) {
  const notes = (r.body ?? '').split('\n')[0]
  console.log(`${r.tag_name}  ${r.draft ? '[draft]' : ''}${r.prerelease ? '[pre]' : ''}`)
  console.log(`   标题: ${notes}`)
  console.log(`   说明: ${(r.body ?? '').length} 字 / ${(r.body ?? '').split('\n').length} 行`)
  for (const a of r.assets ?? []) {
    console.log(`   附件: ${a.name}  ${(a.size / 1024 / 1024).toFixed(2)} MB  下载次数 ${a.download_count}`)
  }
  console.log(`   链接: ${r.html_url}`)
  console.log('')
}
