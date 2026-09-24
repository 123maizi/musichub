/* 在页面里取下载任务列表（渲染进程上下文） */
const tasks = await window.api.download.list()
return JSON.stringify(
  tasks.map((t) => ({
    id: t.id,
    status: t.status,
    fileName: t.fileName,
    savePath: t.savePath,
    name: t.song?.name,
    singer: t.song?.singer,
    error: t.error ?? null
  }))
)
