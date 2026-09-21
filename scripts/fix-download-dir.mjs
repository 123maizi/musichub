/** 把下载目录改回正确路径（用文件传参，避免命令行转义把反斜杠搞成双的） */
const target = 'C:\\Users\\18509\\Desktop\\歌曲下载'
const cfg = await window.api.download.setConfig({ dir: target })
return JSON.stringify({ 设置的: target, 实际生效: cfg.dir, 一致: cfg.dir === target }, null, 1)
