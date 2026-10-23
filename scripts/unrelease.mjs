/**
 * 撤销一次发布：删 GitHub Release + 删 tag。
 *
 * 用途：发出去的包有问题（例如 2.0.1 的 logo 要换）而又不想留一个"改过内容的同一版本号"。
 * 顺序不能反：先删 Release，再删 tag —— 反过来 tag 删了 Release 还会挂着，
 * 用户点进去只有个 404 的源码包。
 *
 * token 依旧从 git 凭据里取，**绝不打印**。
 *
 * 用法: node scripts/unrelease.mjs v2.0.1
 */
import { execFileSync } from 'node:child_process'

const GIT = 'C:\\Users\\18509\\AppData\\Local\\GitHubDesktop\\app-3.6.6\\resources\\app\\git\\cmd\\git.exe'
const REPO = '123maizi/musichub'
const tag = process.argv[2]
if (!tag) {
  console.error('用法: node scripts/unrelease.mjs <tag>')
  process.exit(1)
}

function getToken() {
  const out = execFileSync(GIT, ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  })
  const line = out.split('\n').find((l) => l.startsWith('password='))
  if (!line) throw new Error('git 凭据里没有 password 字段')
  return line.slice('password='.length).trim()
}

const headers = {
  Authorization: `token ${getToken()}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'MzHearken-Release'
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { ok: res.ok, status: res.status, body }
}

/* 1. 找 Release 并删除 */
const rel = await api(`/repos/${REPO}/releases/tags/${tag}`)
if (rel.ok && rel.body?.id) {
  const del = await api(`/repos/${REPO}/releases/${rel.body.id}`, { method: 'DELETE' })
  if (!del.ok) {
    console.error(`✗ 删除 Release 失败 ${del.status}`, del.body?.message ?? '')
    process.exit(1)
  }
  console.log(`✓ 已删除 Release ${tag}（id=${rel.body.id}，含其附件）`)
} else if (rel.status === 404) {
  console.log(`· Release ${tag} 本来就不存在`)
} else {
  console.error(`✗ 查询 Release 失败 ${rel.status}`, rel.body?.message ?? '')
  process.exit(1)
}

/* 2. 删远端 tag */
const ref = await api(`/repos/${REPO}/git/refs/tags/${tag}`)
if (ref.ok) {
  const del = await api(`/repos/${REPO}/git/refs/tags/${tag}`, { method: 'DELETE' })
  if (!del.ok) {
    console.error(`✗ 删除 tag 失败 ${del.status}`, del.body?.message ?? '')
    process.exit(1)
  }
  console.log(`✓ 已删除远端 tag ${tag}`)
} else if (ref.status === 404) {
  console.log(`· 远端 tag ${tag} 本来就不存在`)
} else {
  console.error(`✗ 查询 tag 失败 ${ref.status}`, ref.body?.message ?? '')
  process.exit(1)
}

console.log('\n下一步：本地 `git tag -f <tag>` 后 push，再用 scripts/release.mjs 重新发布')
