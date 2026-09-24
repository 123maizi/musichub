/** 诊断：哪些行没封面、什么原因 */
const rows = [...document.querySelectorAll('.results .row')]
const missing = []
const present = []

for (const row of rows) {
  const title = row.querySelector('.col-main')?.innerText?.split('\n')[0]?.trim() ?? ''
  const platform = row.querySelector('.col-platform')?.innerText?.trim() ?? ''
  const hasImg = Boolean(row.querySelector('.mini-cover img'))
  if (hasImg) present.push({ title, platform })
  else missing.push({ title, platform })
}

const counts = {}
for (const r of rows) {
  const p = r.querySelector('.col-platform')?.innerText?.trim() || 'unknown'
  const has = Boolean(r.querySelector('.mini-cover img'))
  if (!counts[p]) counts[p] = { withImg: 0, withoutImg: 0 }
  if (has) counts[p].withImg += 1
  else counts[p].withoutImg += 1
}

return JSON.stringify({
  total: rows.length,
  byPlatform: counts,
  missingSample: missing.slice(0, 12).map((m) => m.platform + ' ' + m.title.slice(0, 26))
}, null, 1)
