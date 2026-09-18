/**
 * 鍒涘缓 GitHub Release 骞朵笂浼犲畨瑁呭寘銆? *
 * 涓轰粈涔堜笉鐢?PowerShell锛欼nvoke-RestMethod 鍑洪敊鏃朵細鎶婃暣涓?.NET 寮傚父瀵硅薄
 * 杩炲悓 System.Management.Automation 鐨勫厓鏁版嵁寰€灞忓箷涓婂€掞紝鐪熸鐨?HTTP
 * 鐘舵€佺爜鍜?GitHub 鐨勬姤閿欎俊鎭叏琚饭娌°€侼ode 杩欒竟鐘舵€佺爜銆佸搷搴斾綋閮芥竻鏅板彲鎺с€? *
 * 鐢ㄦ硶锛?node scripts/release.mjs <tag> <鐗堟湰鍙? <瀹夎鍖呰矾寰? <璇存槑鏂囦欢>
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'

const GIT = 'C:\\Users\\18509\\AppData\\Local\\GitHubDesktop\\app-3.6.6\\resources\\app\\git\\cmd\\git.exe'
const REPO = '123maizi/musichub'
const OWNER_API = `https://api.github.com/repos/${REPO}`

const [tag, version, assetPath, notesPath] = process.argv.slice(2)
if (!tag || !version || !assetPath || !notesPath) {
  console.error('鐢ㄦ硶: node scripts/release.mjs <tag> <version> <asset> <notes>')
  process.exit(1)
}

/** 浠?git 鍑嵁閲屽彇 token 鈥斺€?缁濅笉鎵撳嵃 */
function getToken() {
  const out = execFileSync(GIT, ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  })
  const line = out.split('\n').find((l) => l.startsWith('password='))
  if (!line) throw new Error('git 鍑嵁閲屾病鏈?password 瀛楁')
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

/* ---------------- 1. 宸叉湁灏卞鐢紝娌℃湁鎵嶅缓 ---------------- */
console.log(`[1] 鏌ヨ ${tag} 鏄惁宸叉湁 Release`)
let rel = (await api(`${OWNER_API}/releases/tags/${tag}`)).body
if (rel && rel.id) {
  console.log(`    宸插瓨鍦紝澶嶇敤 id=${rel.id}`)
} else {
  console.log('    涓嶅瓨鍦紝鍒涘缓涓€?)
  const notes = readFileSync(notesPath, 'utf8')
  const created = await api(`${OWNER_API}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `${version} 姝岃瘝缈昏瘧`,
      body: notes,
      draft: false,
      prerelease: false
    })
  })
  if (!created.ok) {
    console.error(`    鉁?HTTP ${created.status}`)
    console.error(`    ${JSON.stringify(created.body).slice(0, 500)}`)
    process.exit(1)
  }
  rel = created.body
  console.log(`    鉁?宸插垱寤?id=${rel.id}`)
}

console.log(`    ${rel.html_url}`)

/* ---------------- 2. 涓婁紶瀹夎鍖?---------------- */
const assetName = `MusicHub-${version}-win-x64.exe`
const size = statSync(assetPath).size
console.log(`\n[2] 涓婁紶 ${assetName}  (${(size / 1024 / 1024).toFixed(2)} MB)`)

const existing = (rel.assets ?? []).find((a) => a.name === assetName)
if (existing) {
  console.log(`    宸插瓨鍦ㄥ悓鍚嶈祫婧?id=${existing.id}锛屽厛鍒犻櫎鏃х殑涓婁紶`)
  const del = await api(`${OWNER_API}/releases/assets/${existing.id}`, { method: 'DELETE' })
  console.log(`    鍒犻櫎缁撴灉 HTTP ${del.status}`)
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
  console.error(`    鉁?HTTP ${up.status}`)
  console.error(`    ${JSON.stringify(up.body).slice(0, 500)}`)
  process.exit(1)
}

console.log(`    鉁?涓婁紶鎴愬姛锛岃€楁椂 ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`    璧勬簮: ${up.body.name}  ${(up.body.size / 1024 / 1024).toFixed(2)} MB`)
console.log(`    閾炬帴: ${up.body.browser_download_url}`)
