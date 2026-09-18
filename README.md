# MusicHub

多音源音乐聚合播放与下载器。桌面端（Electron + Vue 3 + TypeScript）。

> 本软件不存储、不提供任何音乐内容，只作为聚合播放工具，
> 通过用户自行导入的第三方音源脚本获取播放地址。请勿用于商业传播。

---

## 它解决什么问题

市面上的音乐聚合工具，核心难点从来不是「播放器」，而是这三件事：

1. **搜得到** —— 洛雪（lx-music）音源协议只提供「取流」，**不提供搜索**。
   想要搜歌，宿主必须自己实现各平台的搜索接口。
2. **接得上** —— 音源脚本是第三方 JS，格式不一、有混淆、有版本要求，
   需要一个能安全隔离、可诊断的运行时。
3. **放得出** —— 平台返回的媒体地址普遍校验 Referer / UA，直接丢给 `<audio>` 会 403，
   需要一个本地代理来补头并绕开跨域。

MusicHub 就是围绕这三点设计的。

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  渲染层  Vue 3 + Pinia + Vue Router                          │
│  搜索页 / 下载页 / 音源页 / 设置页  +  底部播放条             │
└──────────────────────── IPC (contextBridge) ─────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────┐
│  主进程 (Electron)                                           │
│                                                              │
│  ┌─ SourceManager ────────────────────────────────────────┐ │
│  │  · SourceSandbox   vm 沙箱执行第三方脚本                │ │
│  │  · LxRuntime       注入 globalThis.lx（洛雪协议）        │ │
│  │  · 协议握手 send('inited') → 能力表 → 可用性统计         │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ SearchEngine ─────────────────────────────────────────┐ │
│  │  · 五大平台内置 Provider（kw/kg/tx/wy/mg）并发搜索        │ │
│  │  · 结果归一为 Song，并按本机音源能力校正可用音质          │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ MusicResolver ────────────────────────────────────────┐ │
│  │  · 候选音源评分排序（成功率/连续失败/响应速度）           │ │
│  │  · 音质从高到低分层，层内并发竞速，失败自动降级           │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ StreamProxy ──────────────────────────────────────────┐ │
│  │  · 本地 HTTP 代理，补 Referer/UA，透传 Range，加 CORS     │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ DownloadManager ──────────────────────────────────────┐ │
│  │  · 队列 + 并发 + 断点续传(.part)                         │ │
│  │  · TagWriter 手写 ID3v2.3 / FLAC Vorbis Comment + 封面   │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 两条数据链

**搜索链**（自建）
```
关键词 → SearchEngine → 5 个平台 Provider 并发 → 归一化 Song[]
                    ↗ 另可选：音源脚本自带 musicSearch
```

**播放/下载链**（复用同一套取流逻辑）
```
Song → MusicResolver → 按平台挑音源 → LxRuntime.dispatch('musicUrl')
                    → 拿到裸地址 → StreamProxy 包装成本地地址
                    → <audio> 播放 / DownloadManager 落盘
```

播放和下载走**同一条取流路径**，所以「能播的就能下，播不了的也下不了」，行为一致。

---

## 核心机制

### 音源协议（洛雪 LX 格式）

音源脚本开头的固定写法：

```js
const { EVENT_NAMES, request, on, send, utils, env, version } = globalThis.lx
```

宿主需要做的事：

1. 在脚本执行前把 `lx` 注入其上下文（`vm.createContext`）
2. 接收脚本的 `send(EVENT_NAMES.inited, { status, sources })` —— 这就是能力上报
3. 需要取流时，调用脚本通过 `on(EVENT_NAMES.request, handler)` 注册的处理器，
   传入 `{ action: 'musicUrl', source: 'kw', info: { type: '320k', musicInfo } }`

`action` 取值：`musicUrl` | `lyric` | `pic` | `musicSearch`

### 沙箱

- 独立 `vm` 上下文，脚本的 `globalThis` 被替换
- `require` 走白名单（crypto / buffer / url / … ，**不含** fs / child_process / net）
- 定时器可跟踪可回收，防止脚本泄漏
- `console` 输出被捕获，在音源详情里可视化，音源报错能直接看到上下文

> `vm` 不是安全边界，它的目标是「隔离全局、限制能力、可回收」。
> 音源脚本始终来自第三方，请不要导入来路不明的脚本。

### 音源未知性的处理

音源会失效、会限流、会互相冲突。所以取流不是「选一个源试试」，而是：

1. 按**历史成功率**给音源打分排序
2. 音质**从高到低**分层（无损 → 320k → 128k），层内 **3 个并发竞速**
3. 拿不到就自动降级，最后能听到歌永远优先于听到最好的音质
4. 每次结果回写统计，**越用越准**

---

## 目录结构

```
src/
├── main/                      主进程
│   ├── core/
│   │   ├── source/            音源体系
│   │   │   ├── lx-protocol.ts   洛雪协议实现（globalThis.lx）
│   │   │   ├── sandbox.ts       vm 沙箱
│   │   │   ├── parser.ts        脚本元信息解析
│   │   │   ├── manager.ts       音源生命周期
│   │   │   └── resolver.ts      取流调度（择优/降级/竞速）
│   │   ├── search/
│   │   │   ├── builtin.ts       五大平台搜索 Provider
│   │   │   └── engine.ts        聚合搜索
│   │   ├── proxy/stream-proxy.ts  本地流代理
│   │   ├── download/
│   │   │   ├── manager.ts       下载队列
│   │   │   └── tag-writer.ts    ID3v2.3 / FLAC 标签写入
│   │   ├── net/http.ts          统一 HTTP 客户端
│   │   └── storage/store.ts     JSON 持久化
│   ├── ipc/index.ts           IPC 路由
│   ├── window.ts              窗口
│   └── index.ts               装配入口
├── preload/index.ts           安全桥
├── renderer/                  Vue 界面
└── shared/                    主/渲染共享的类型与常量
resources/sources/             随应用分发的内置音源
scripts/                       诊断脚本
```

---

## 开发

```bash
npm install
npm run dev            # 开发模式（HMR）
npm run typecheck      # 类型检查
npm run build:win      # 打包 Windows
```

### 诊断脚本

音源接口和搜索接口都会不定期失效。这些脚本是判断「哪条路还通」的最快手段：

```bash
node scripts/probe-search.mjs 周杰伦      # 探五大平台搜索接口
node scripts/probe-alt.mjs 周杰伦         # 探备选接口
node scripts/dump-one.mjs 周杰伦          # 转储原始响应字段结构
```

验证真实的归一化映射（走真实代码路径）：

```bash
node_modules\.bin\esbuild.cmd scripts/verify-search.ts --bundle --format=esm \
  --platform=node --outfile=.tmp/verify-search.mjs --alias:@shared=./src/shared
node .tmp/verify-search.mjs 周杰伦
```

---

## 音源导入

支持三种方式（音源页）：

- **从文件导入** —— 选择本地 `.js` 音源脚本
- **从 URL 导入** —— 粘贴直链
- **导入内置音源** —— 一键装入 `resources/sources/` 下的随附音源

音源存放在用户数据目录下的 `sources/`，可用「打开目录」直接管理。

---

## 已知限制

- 咪咕搜索结果不返回时长，列表中显示为 `--:--`（不编造数据）
- 标签写入支持 MP3 / FLAC；M4A 的 MP4 atom 改写风险高，暂未实现
- 第三方音源随时可能失效，这是生态常态，不是软件缺陷
