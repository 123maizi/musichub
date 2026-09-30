/** 仅把格式下拉展开，供截图取证 */
document.querySelector('.fmt-menu .trigger')?.click()
await new Promise((r) => setTimeout(r, 450))
return document.querySelector('.fmt-menu .menu') ? 'opened' : 'not opened'
