const rows = [...document.querySelectorAll('.results .row')]
const hits = rows
  .map((r) => ({
    main: ((r.querySelector('.col-main') ?? {}).textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
    plat: ((r.querySelector('.col-platform') ?? {}).textContent ?? '').trim(),
    time: ((r.querySelector('.col-time') ?? {}).textContent ?? '').trim()
  }))
  .filter((x) => x.main.includes('Ex-Factor'))
return JSON.stringify({ total: rows.length, hits }, null, 1)
