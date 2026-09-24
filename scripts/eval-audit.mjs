/* 验证新的 audit IPC 是否已生效 */
const has = typeof window.api?.download?.audit === 'function'
if (!has) return JSON.stringify({ auditAvailable: false })
const result = await window.api.download.audit()
return JSON.stringify({ auditAvailable: true, count: Object.keys(result ?? {}).length, result })
