window.location.hash = '#/downloads'
await new Promise((r) => setTimeout(r, 2500))
const rows = [...document.querySelectorAll('.task')]
return JSON.stringify(
  rows.map((r) => ({
    text: r.innerText.replace(/\s+/g, ' ').slice(0, 160),
    buttons: [...r.querySelectorAll('button')].map((b) => b.innerText.trim())
  })),
  null,
  1
)
