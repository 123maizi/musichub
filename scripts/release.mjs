/**
 * 创建 / 更新 GitHub Release 并上传安装包。
 *
 * 为什么不用 PowerShell：Invoke-RestMethod 出错时会把整个 .NET 异常对象
 * 连同 System.Management.Automation 的元数据往屏幕上倒，真正的 HTTP
 * 状态码和 GitHub 的报错信息全被淹没，排查靠猜。Node 这边状态码、
 * 响应体都清晰可控。
 *
 * 行为：
 *   - Release 不存在 → 创建；已存在 → 复用，并把说明同步成最新的
 *   - 同名资源已存在 → 先删后传（可重复执行，不会出现重复附件）
 *
 * 用法： node scripts/release.mjs <tag> <版本号> <安装包> <说明文件>
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const GIT = 'C:\\Users\\18509\\AppData\\Local\\GitHubDesktop\\app-3.6.6\\resources\\app\\git\\cmd\\git.exe'
const REPO = '123maizi/musichub'
const OWNER_API = `https://api.github.com/repos/${REPO}`

const [tag, version, assetPath, notesPath] = process.argv.slice(2)
if (!tag || !version || !assetPath || !notesPath) {
  console.error('用法: node scripts/release.mjs <tag> <version> <asset> <notes>')
  process.exit(1)
}

/** 从 git 凭据里取 token —— 绝不打印 */
function getToken() {
  const out = execFileSync(GIT, ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  })
  const line = out.split('\n').find((l) => l.startsWith('password='))
  if (!line) throw new Error('git 凭据里没有 password 字段')
  return line.slice('password='.length).trim()
}

const token = getToken()
const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'MusicHub-Release'
}

async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { ok: res.ok, status: res.status, body }
}

const notes = readFileSync(notesPath, 'utf8')

/* ---------------- 1. 已有就复用，没有才建 ---------------- */
console.log(`[1] 查询 ${tag} 是否已有 Release`)
let rel = (await api(`${OWNER_API}/releases/tags/${tag}`)).body

if (rel && rel.id) {
  console.log(`    已存在，复用 id=${rel.id}`)
  // 说明要跟着代码走：覆盖安装包时描述也得同步，
  // 否则 release 页写的还是上一版的内容
  if (rel.body !== notes) {
    const patched = await api(`${OWNER_API}/releases/${rel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: notes })
    })
    console.log(`    说明已同步: ${patched.ok ? '✓' : `✗ HTTP ${patched.status}`}`)
    if (patched.ok) rel = patched.body
  } else {
    console.log('    说明无变化')
  }
} else {
  console.log('    不存在，创建中…')
  const created = await api(`${OWNER_API}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `${version}`,
      body: notes,
      draft: false,
      prerelease: false
    })
  })
  if (!created.ok) {
    console.error(`    ✗ HTTP ${created.status}`)
    console.error(`    ${JSON.stringify(created.body).slice(0, 500)}`)
    process.exit(1)
  }
  rel = created.body
  console.log(`    ✓ 已创建 id=${rel.id}`)
}

console.log(`    ${rel.html_url}`)

/* ---------------- 2. 上传安装包 ---------------- */
const assetName = `MusicHub-${version}-win-x64.exe`
const size = statSync(assetPath).size
console.log(`\n[2] 上传 ${assetName}  (${(size / 1024 / 1024).toFixed(2)} MB)`)

const existing = (rel.assets ?? []).find((a) => a.name === assetName)
if (existing) {
  console.log(`    已存在同名资源 id=${existing.id}，先删除旧的上传`)
  const del = await api(`${OWNER_API}/releases/assets/${existing.id}`, { method: 'DELETE' })
  console.log(`    删除结果 HTTP ${del.status}`)
}

const buf = readFileSync(assetPath)
const started = Date.now()
const up = await api(
  `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(assetName)}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf
  }
)

if (!up.ok) {
  console.error(`    ✗ HTTP ${up.status}`)
  console.error(`    ${JSON.stringify(up.body).slice(0, 500)}`)
  process.exit(1)
}

console.log(`    ✓ 上传成功，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`    资源: ${up.body.name}  ${(up.body.size / 1024 / 1024).toFixed(2)} MB`)
console.log(`    链接: ${up.body.browser_download_url}`)
