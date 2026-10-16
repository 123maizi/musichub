/**
 * seek-lab —— 进度条「真实指针」试验台。
 *
 * ── 为什么必须新写一个 ─────────────────────────────────────────────────
 * 之前的 probe-drag-to-zero / probe-two-bars 全都是**合成事件**：
 *     input.value = '120'; input.dispatchEvent(new Event('change'))
 * 这条路完全绕过了浏览器的「点击坐标 → range 数值」映射，
 * 所以「点击进度条落点有偏差」这类 bug **在那种探针里物理上不可能复现** ——
 * 它测的只是 Vue 的响应式，不是指针。
 *
 * 这里改用 CDP 的 Input 域派发**真实鼠标事件**（mousePressed/Moved/Released），
 * 由浏览器自己做命中测试与数值换算，与用户手动点击是同一条代码路径。
 *
 * 同时装一个 rAF 录波器，逐帧记录「用户真正看到的那个值」(--p)
 * 以及 store 的内部状态；再把 window.Audio 打桩，拿到**音频元素的真身**，
 * 于是 el.currentTime / el.seeking 这些地面真值也能逐帧拿到 ——
 * 「进度条显示 X、音频实际在 Y」这类分歧只有靠它才能定性。
 *
 * 用法：
 *   node scripts/seek-lab.mjs <port> setup             # 搜歌并开播（前置）
 *   node scripts/seek-lab.mjs <port> status            # 打印几何与状态
 *   node scripts/seek-lab.mjs <port> click 0.6         # 在轨道 60% 处真实单击
 *   node scripts/seek-lab.mjs <port> drag flick        # 快速甩到最左
 *   node scripts/seek-lab.mjs <port> drag slow         # 慢慢拖到最左
 *   node scripts/seek-lab.mjs <port> drag to0.5        # 拖到中间（对照）
 *   node scripts/seek-lab.mjs <port> ev "<表达式>"      # 页面内求值（调试用）
 */
const PORT = Number(process.argv[2] || 9233)
const RAW_CMD = process.argv[3] || 'status'
/**
 * 命令前缀 `np-` 表示「目标改成正在播放页的大进度条」。
 * 两条进度条共用一套 composable，必须两边都实测 —— 只测一条就等于没测。
 */
const NP = RAW_CMD.startsWith('np-')
const CMD = NP ? RAW_CMD.slice(3) : RAW_CMD
const ARG = process.argv[4] || ''
const RAIL_SEL = NP ? '.seek-rail' : '.progress-rail'
const INPUT_SEL = NP ? '.seek' : '.progress-input'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickPage() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://') && t.webSocketDebuggerUrl)
  if (!page) throw new Error(`端口 ${PORT} 上没有页面 target`)
  return page
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    ws.addEventListener('open', () =>
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const mid = ++id
            pending.set(mid, { res, rej })
            ws.send(JSON.stringify({ id: mid, method, params }))
          })
        },
        close: () => ws.close()
      })
    )
    ws.addEventListener('error', () => reject(new Error('WS 连接失败')))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      }
    })
  })
}

const page = await pickPage()
const cdp = await connect(page.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
try {
  await cdp.send('Page.enable')
  await cdp.send('Page.bringToFront')
} catch {
  /* 忽略 */
}

async function ev(expression, awaitPromise = true) {
  const out = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  })
  if (out.exceptionDetails) {
    const d = out.exceptionDetails
    throw new Error((d.exception?.description ?? d.text ?? '页面内异常').slice(0, 1500))
  }
  return out.result?.value
}

const js = (v) => JSON.stringify(v)

/* ------------------------------ 鼠标 ------------------------------ */

/**
 * 鼠标事件派发。
 *
 * ⚠️ 拖动中的 mouseMoved 必须带 `button:'left'` + `buttons:1`（Puppeteer 的做法）。
 * 我第一版按 CDP 文档把 move 的 button 写成 'none'，结果**滑块的取值完全不动**：
 * 按下那一下把值跳到落点（range 的点击跳转是 mousedown 处理的），
 * 之后所有移动都被忽略 —— 于是「拖到最左」实际提交的是「按下的位置」。
 * 这看起来就像产品 bug（拖了没反应），其实是测量工装的问题。
 */
let dragging = false

async function mouse(type, x, y) {
  if (type === 'mousePressed') dragging = true
  const payload = {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: dragging ? 'left' : 'none',
    buttons: dragging ? 1 : 0,
    clickCount: dragging ? 1 : 0,
    pointerType: 'mouse'
  }
  if (type === 'mouseReleased') payload.buttons = 0
  await cdp.send('Input.dispatchMouseEvent', payload)
  if (type === 'mouseReleased') dragging = false
}

/* ------------------------------ 页面桩 ------------------------------ */

/** 打桩 window.Audio：store 里两个音频元素（播放用 + 预热用）都会被截获 */
const HOOK_AUDIO = `
  if (!window.__mhHook) {
    window.__mhHook = true;
    window.__mhEls = [];
    var Orig = window.Audio;
    function Patched() {
      var el = new Orig(...arguments);
      window.__mhEls.push(el);
      return el;
    }
    Patched.prototype = Orig.prototype;
    window.Audio = Patched;
  }
  'ok'
`

/**
 * 逐帧录波。
 * 字段：[t, --p(用户看到的填充), data-progress, data-display, data-seeking,
 *        data-pending, data-current, el.currentTime, el.seeking]
 */
const RECORDER = `
  if (!window.__ptrOn || window.__ptrOn !== ${JSON.stringify(INPUT_SEL)}) {
    window.__ptrOn = ${JSON.stringify(INPUT_SEL)};
    window.__lastX = null;
    var i0 = document.querySelector(${JSON.stringify(INPUT_SEL)});
    if (i0) i0.addEventListener('pointermove', function (e) { window.__lastX = e.clientX }, true);
  }
  window.__rec = [];
  window.__t0 = performance.now();
  window.__recOn = true;
  (function loop() {
    if (!window.__recOn) return;
    var rail = document.querySelector(${JSON.stringify(RAIL_SEL)});
    var st = document.querySelector('.pb-state');
    var el = (window.__mhEls || [])[0] || null;
    var p = rail ? getComputedStyle(rail).getPropertyValue('--p').trim() : null;
    /**
     * 指针期望的百分比：用与 useSeekBar 相同的映射在页面内独立算一遍。
     * 两个数（--p 与 exp）之间的差就是「填充跟不跟手」的直接量度 ——
     * 用户说的「有偏差」在旧实现里是 step 量化 + 520ms 缓动两个来源。
     */
    var exp = null;
    var i1 = document.querySelector(${JSON.stringify(INPUT_SEL)});
    if (i1 && window.__lastX !== null) {
      var r = i1.getBoundingClientRect();
      var usable = r.width - 2;
      if (usable > 0) {
        var ratio = (window.__lastX - r.left - 1) / usable;
        exp = Math.round(Math.max(0, Math.min(1, ratio)) * 10000) / 100;
      }
    }
    window.__rec.push([
      Math.round(performance.now() - window.__t0),
      p === null ? null : Math.round(Number(p) * 100) / 100,
      st ? st.getAttribute('data-progress') : null,
      st ? st.getAttribute('data-display') : null,
      st ? st.getAttribute('data-seeking') : null,
      st ? st.getAttribute('data-pending') : null,
      st ? st.getAttribute('data-current') : null,
      el ? Math.round(el.currentTime * 1000) / 1000 : null,
      el ? (el.seeking ? 1 : 0) : null,
      exp,
      window.__lastX === null ? null : Math.round(window.__lastX)
    ]);
    requestAnimationFrame(loop);
  })();
  'ok'
`

async function state() {
  return ev(`
    (function () {
      var st = document.querySelector('.pb-state');
      var rail = document.querySelector(${JSON.stringify(RAIL_SEL)});
      var input = document.querySelector(${JSON.stringify(INPUT_SEL)});
      var r = rail ? rail.getBoundingClientRect() : null;
      var i = input ? input.getBoundingClientRect() : null;
      var el = (window.__mhEls || [])[0] || null;
      var g = function (n) { return st ? st.getAttribute(n) : null };
      return JSON.stringify({
        rail: r ? { x: r.x, w: r.width, y: r.y, h: r.height } : null,
        input: i ? { x: i.x, w: i.width, y: i.y, h: i.height } : null,
        progress: g('data-progress'), display: g('data-display'), current: g('data-current'),
        duration: g('data-duration'), playing: g('data-playing'), pending: g('data-pending'),
        seeking: g('data-seeking'),
        inputValue: input ? input.value : null, inputMax: input ? input.max : null,
        inputStep: input ? input.step : null, inputDisabled: input ? input.disabled : null,
        elCount: (window.__mhEls || []).length,
        el: el ? { t: Math.round(el.currentTime * 1000) / 1000, seeking: el.seeking, paused: el.paused,
                   dur: Math.round((el.duration || 0) * 1000) / 1000, rs: el.readyState,
                   src: String(el.src).slice(0, 60), se: el.seekable && el.seekable.length ? Math.round(el.seekable.end(el.seekable.length - 1) * 10) / 10 : null } : null
      });
    })()
  `)
}

/** 把逐帧记录压缩成「变化点」序列，避免刷屏 */
function compress(rec) {
  const out = []
  let prev = null
  for (const f of rec) {
    const key = f.slice(1).join('|')
    if (key !== prev) {
      out.push(f)
      prev = key
    }
  }
  const last = rec[rec.length - 1]
  if (last && (out.length === 0 || out[out.length - 1] !== last)) out.push(last)
  return out
}

const HDR = '     t |    --p |   prog |   disp | seek | pend |    cur | elTime | elS'

/**
 * 逐帧表。
 * ⚠️ 不要再用「定宽补空格」拼接 —— 我第一版就是这么写的，而 data-progress 是
 * 18 位的浮点字符串，直接撑破列宽把后面所有列挤位，看起来像
 * 「--p=0 而 display=2.34 且 seeking=true」这种自相矛盾的状态，差点让我
 * 得出错误结论。现在统一取整到两位并用 | 分隔。
 */
function fmt(rows) {
  const n = (v, d = 2) => (v === null || v === undefined ? '-' : String(Math.round(Number(v) * 10 ** d) / 10 ** d))
  return rows
    .map((f) =>
      [
        String(f[0]).padStart(6),
        n(f[1]).padStart(7),
        n(f[2]).padStart(7),
        n(f[3]).padStart(7),
        String(f[4]).padStart(5),
        n(f[5]).padStart(6),
        n(f[6]).padStart(7),
        n(f[7]).padStart(7),
        String(f[8]).padStart(4)
      ].join(' | ')
    )
    .join('\n')
}

/**
 * 事件取证：把 range 上真实收到的每个事件都记下来。
 *
 * 这一步是为了回答那个决定修法的问题：拖动没生效时，
 * 浏览器到底**没发** `change`，还是发了但我们的处理链断了？
 * 猜是没用的 —— 打点看。
 */
const EVENT_LOG = `
  (function () {
    if (window.__evOn === ${JSON.stringify(INPUT_SEL)}) return 'already';
    window.__evOn = ${JSON.stringify(INPUT_SEL)};
    window.__ev = [];
    var inp = document.querySelector(${JSON.stringify(INPUT_SEL)});
    if (!inp) return 'no-input';
    var types = ['input','change','pointerdown','pointerup','pointercancel','lostpointercapture','mousedown','mouseup','click','blur'];
    types.forEach(function (t) {
      inp.addEventListener(t, function (e) {
        window.__ev.push([Math.round(performance.now()), 'el:' + t, inp.value, e.buttons]);
      }, true);
    });
    ['pointerup','pointercancel','mouseup','lostpointercapture'].forEach(function (t) {
      document.addEventListener(t, function (e) {
        var tgt = e.target && e.target.className ? String(e.target.className) : String(e.target && e.target.tagName);
        window.__ev.push([Math.round(performance.now()), 'doc:' + t, inp.value, e.buttons, tgt]);
      }, true);
    });
    return 'ok';
  })()
`

/* ------------------------------ 拖动工况矩阵 ------------------------------ */

/**
 * 一次拖动试验：给出「按下位置 → 目标位置」的指针轨迹与松手条件，
 * 然后回答那个唯一要紧的问题：**这一下拖动到底有没有生效**。
 *
 * 判据（三个都要看，缺一个就会误判）：
 *  1. 松手后 200ms 内 data-seeking 是否变回 false —— 变了才说明提交逻辑跑到了；
 *  2. 松手后 2.6s 时音频元素真的在哪（el.currentTime）—— 提交了但没 seek 成功也白搭；
 *  3. 输入框当时的 value —— 拖到最后到底是多少秒。
 */
async function oneDrag(spec) {
  const st0 = JSON.parse(await state())
  /**
   * 前置断言：没拿到音频元素真身时**直接判定为不可测**，绝不给出产品结论。
   *
   * 我在这上面栽过一次：在共享构建的实例上没先 `boot`（打桩晚于第一次播放），
   * 七个工况全部报「★ 提交了但音频没到落点」—— 看起来像功能全废，
   * 其实只是 el 为 null 导致真值列是空的。测量工装缺前置时必须自己喊停。
   */
  if (!st0.el) {
    return {
      工况: spec.name,
      结论: '⊘ 不可测：window.Audio 打桩晚于元素创建（el 为空），请先跑 boot 再 setup'
    }
  }
  const railR = st0.rail
  const yMid = railR.y + railR.h / 2
  const dur = Number(st0.duration)
  const startPct = Number(st0.display)
  const startX = railR.x + (startPct / 100) * railR.w
  const endX = railR.x + railR.w * spec.targetFrac + (spec.releaseOffsetPx || 0)

  await ev(RECORDER)
  await mouse('mouseMoved', startX, yMid)
  await sleep(80)
  await mouse('mousePressed', startX, yMid)
  await sleep(spec.holdMs || 50)
  const steps = spec.steps || 3
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    await mouse('mouseMoved', startX + (endX - startX) * t, yMid)
    await sleep(spec.stepMs || 14)
  }
  if (spec.pauseBeforeReleaseMs) await sleep(spec.pauseBeforeReleaseMs)

  const valueAtRelease = await ev(`document.querySelector(${JSON.stringify(INPUT_SEL)}).value`)
  await mouse('mouseReleased', endX, yMid)

  await sleep(200)
  const after200 = JSON.parse(await state())
  await sleep(2400)
  const after2600 = JSON.parse(await state())
  await ev(`window.__recOn = false`)

  const targetSec = spec.targetFrac * dur
  const elT = after2600.el ? after2600.el.t : null
  const followed = elT !== null && Math.abs(elT - targetSec) < 4
  return {
    工况: spec.name,
    轨迹点: steps,
    每步ms: spec.stepMs || 14,
    松手偏移px: spec.releaseOffsetPx || 0,
    松手前pauseMs: spec.pauseBeforeReleaseMs || 0,
    松手前_input: valueAtRelease,
    期望秒: Math.round(targetSec * 10) / 10,
    '200ms后_seeking': after200.seeking,
    '200ms后_display': Math.round(Number(after200.display) * 100) / 100,
    '2.6s后_audio秒': elT,
    '2.6s后_display': Math.round(Number(after2600.display) * 100) / 100,
    '2.6s后_input': after2600.inputValue,
    音频是否跟到落点: followed,
    结论: followed && after200.seeking === 'false' ? '✓ 拖动生效' : after200.seeking === 'true' ? '★ 松手 200ms 后仍是 seeking=true（change 没来，拖动被吞）' : '★ 提交了但音频没到落点'
  }
}

/* ------------------------------ 前置：搜歌开播 ------------------------------ */

async function setup() {
  const rail = (label) =>
    ev(`
      (function () {
        var items = [].slice.call(document.querySelectorAll('.rail .nav-item'));
        var hit = items.find(function (x) {
          return (x.querySelector('.nav-label') || {}).textContent &&
                 x.querySelector('.nav-label').textContent.indexOf(${js(label)}) >= 0;
        });
        if (hit) { hit.click(); return 'clicked' }
        return 'notfound';
      })()
    `)

  await rail('搜索')
  await sleep(1500)

  const hasRows = async () =>
    ev(`document.querySelectorAll('.results .row').length`)

  if ((await hasRows()) === 0) {
    await ev(`
      (function () {
        var inp = document.querySelector('.search-box input');
        if (!inp) return 'noinput';
        inp.focus();
        inp.value = '周杰伦';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        return 'searched';
      })()
    `)
    for (let i = 0; i < 25; i += 1) {
      await sleep(1000)
      if ((await hasRows()) > 0) break
    }
  }

  const rows = await hasRows()
  if (rows === 0) return { ok: false, why: '搜索没有结果' }

  const already = await ev(`document.querySelector('.pb-state').getAttribute('data-playing')`)
  if (already !== 'true') {
    await ev(`
      (function () {
        var row = document.querySelector('.results .row');
        var btn = row && row.querySelector('.col-actions button[title="播放"]');
        if (btn) { btn.click(); return 'play' }
        if (row) { row.click(); return 'rowclick' }
        return 'norow';
      })()
    `)
  }

  for (let i = 0; i < 30; i += 1) {
    await sleep(1000)
    const st = JSON.parse(await state())
    if (st.playing === 'true' && Number(st.duration) > 30 && Number(st.current) > 1.5) {
      return { ok: true, waited: i + 1, state: st }
    }
  }
  return { ok: false, why: '等了 30 秒还没进入稳定播放', state: JSON.parse(await state()) }
}

/* ------------------------------ 主流程 ------------------------------ */

if (CMD === 'viewport') {
  /**
   * 改布局视口大小。
   *
   * 为什么必须要有这个：在 1280×800 下，正在播放页的进度条 (y≈760) 正好压在
   * 固定的底部播放条 (y≈756~780) 底下，elementFromPoint 命中的是**缩略条**。
   * 我第一轮 np 测量就是这么被骗的：点击落点看起来差 −12/−55 秒，
   * 其实那一下点在了缩略条上、按缩略条的几何算得好好的。
   * 测哪一条，就得先保证那一条真的在最上层。
   */
  const w = Number(process.argv[4] || 1440)
  const h = Number(process.argv[5] || 1000)
  if (w === 0) {
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await sleep(400)
    console.log(JSON.stringify({ cleared: true, viewport: await ev(`JSON.stringify([innerWidth, innerHeight])`) }))
    cdp.close()
    process.exit(0)
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: false
  })
  await sleep(600)
  const info = await ev(`
    (function () {
      var inp = document.querySelector(${JSON.stringify(INPUT_SEL)});
      if (!inp) return JSON.stringify({ ok: false, why: 'no input' });
      var r = inp.getBoundingClientRect();
      var x = r.x + r.width * 0.5;
      var y = r.y + r.height / 2;
      var hit = document.elementFromPoint(x, y);
      return JSON.stringify({
        viewport: [innerWidth, innerHeight],
        rail: [Math.round(r.x), Math.round(r.y), Math.round(r.width)],
        hitAtCenter: hit ? hit.tagName + '.' + hit.className : null,
        hitIsTarget: hit === inp
      });
    })()
  `)
  console.log(info)
} else if (CMD === 'nav') {
  /** 切到「正在播放」页，用来测那条大进度条 */
  await ev(`location.hash = '#/now-playing'; 'ok'`)
  await sleep(2500)
  const info = await ev(
    `JSON.stringify({ hash: location.hash, rail: !!document.querySelector(${JSON.stringify(RAIL_SEL)}), input: !!document.querySelector(${JSON.stringify(INPUT_SEL)}) })`
  )
  console.log(info)
} else if (CMD === 'boot') {
  /**
   * 重新加载页面并**立刻**打桩 window.Audio。
   * store 的播放元素是单例、第一次播放时才 new Audio()，所以打桩必须早于任何播放 ——
   * 否则拿到的是 null，逐帧真值全丢（第一轮实测就踩到了这个：elCount=0）。
   */
  await cdp.send('Page.reload', { ignoreCache: false })
  await sleep(7000)
  await ev(HOOK_AUDIO)
  const els = await ev(`window.__mhEls ? window.__mhEls.length : -1`)
  console.log(JSON.stringify({ reloaded: true, hook: true, elsBeforePlay: els }, null, 1))
} else if (CMD === 'setup') {
  console.log(JSON.stringify(await setup(), null, 1))
} else if (CMD === 'status') {
  await ev(HOOK_AUDIO)
  console.log(JSON.stringify(JSON.parse(await state()), null, 1))
} else if (CMD === 'ev') {
  console.log(JSON.stringify(await ev(process.argv[4]), null, 1))
} else if (CMD === 'trace') {
  await ev(HOOK_AUDIO)
  const steps = Number(process.argv[4] || 3)
  const stepMs = Number(process.argv[5] || 14)
  console.log(JSON.stringify(await ev(EVENT_LOG)))
  const st0 = JSON.parse(await state())
  const railR = st0.rail
  const yMid = railR.y + railR.h / 2
  const startX = railR.x + (Number(st0.display) / 100) * railR.w
  const endX = railR.x
  await mouse('mouseMoved', startX, yMid)
  await sleep(80)
  await mouse('mousePressed', startX, yMid)
  await sleep(50)
  for (let i = 1; i <= steps; i += 1) {
    await mouse('mouseMoved', startX + (endX - startX) * (i / steps), yMid)
    await sleep(stepMs)
  }
  await mouse('mouseReleased', endX, yMid)
  await sleep(400)
  const s1 = JSON.parse(await state())
  await sleep(2200)
  const s2 = JSON.parse(await state())
  const log = JSON.parse(await ev(`JSON.stringify(window.__ev)`))
  console.log(
    JSON.stringify(
      {
        拖动: { steps, stepMs, startX: Math.round(startX), endX: Math.round(endX), 松手前不读值: true },
        '200ms': { seeking: s1.seeking, display: s1.display, input: s1.inputValue },
        '2.6s': { seeking: s2.seeking, display: s2.display, input: s2.inputValue, elTime: s2.el && s2.el.t },
        事件序列: log.map((e) => e[0] + ' ' + e[1] + ' v=' + e[2] + ' btn=' + e[3] + (e[4] ? ' on=' + e[4] : ''))
      },
      null,
      1
    )
  )
} else if (CMD === 'keys') {
  /**
   * 键盘步进：focus 后按两下 ←/→，音频应当准确走 ±10 秒。
   * 提交路径这一版改过（change 不再是唯一入口），键盘必须重新证一遍 ——
   * 它是**唯一**不走指针的入口，很容易在重构里被漏掉。
   */
  await ev(HOOK_AUDIO)
  const key = ARG === 'left' ? 'ArrowLeft' : 'ArrowRight'
  const code = key === 'ArrowLeft' ? 37 : 39
  await ev(`document.querySelector(${JSON.stringify(INPUT_SEL)}).focus(); 'ok'`)
  await sleep(200)
  const t0 = JSON.parse(await state())
  for (let i = 0; i < 2; i += 1) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key })
    await sleep(150)
  }
  await sleep(1200)
  const t1 = JSON.parse(await state())
  const delta = t1.el && t0.el ? Math.round((t1.el.t - t0.el.t) * 100) / 100 : null
  const expect = key === 'ArrowRight' ? 10 : -10
  console.log(
    JSON.stringify(
      {
        按键: key + ' ×2',
        按前音频秒: t0.el && t0.el.t,
        按后音频秒: t1.el && t1.el.t,
        实际位移秒: delta,
        期望位移秒: expect,
        input值: t1.inputValue,
        seeking: t1.seeking,
        判定: delta !== null && Math.abs(delta - expect) < 4 ? '✓ 键盘步进生效' : '★ 键盘步进没生效/位移不对'
      },
      null,
      1
    )
  )
} else if (CMD === 'track') {
  /**
   * 跟手度：拖动过程中「填充显示的百分比」与「指针位置对应的百分比」之间的差。
   * 旧实现的两个偏差来源在这里会直接现形：
   *   · step=5 量化 → 拖到一半时填充会偏低/偏高最多 0.93%（≈12px），且只在跨步时跳
   *   · 520ms 缓动 → 快速回拖时填充明显落后
   */
  await ev(HOOK_AUDIO)
  await ev(EVENT_LOG)
  const results = []
  for (const spec of [
    { name: '快速左拖（从当前位置甩到最左）', to: 0, steps: 3, stepMs: 14 },
    { name: '快速右拖（甩到 70%）', to: 0.7, steps: 3, stepMs: 14 },
    { name: '中速左拖（6 步×45ms）', to: 0, steps: 6, stepMs: 45 }
  ]) {
    const st0 = JSON.parse(await state())
    const railR = st0.rail
    const yMid = railR.y + railR.h / 2
    const startX = railR.x + (Number(st0.display) / 100) * railR.w
    const endX = railR.x + railR.w * spec.to
    await ev(RECORDER)
    await mouse('mouseMoved', startX, yMid)
    await sleep(80)
    await mouse('mousePressed', startX, yMid)
    await sleep(40)
    for (let i = 1; i <= spec.steps; i += 1) {
      await mouse('mouseMoved', startX + (endX - startX) * (i / spec.steps), yMid)
      await sleep(spec.stepMs)
    }
    await mouse('mouseReleased', endX, yMid)
    await sleep(300)
    await ev(`window.__recOn = false`)
    const rec = JSON.parse(await ev(`JSON.stringify(window.__rec)`))
    // 只看拖动期间（seeking=true 且指针已移动）
    const during = rec.filter((f) => f[4] === 'true' && f[9] !== null && f[1] !== null)
    const errs = during.map((f) => Math.abs(f[1] - f[9]))
    const railW = railR.w
    results.push({
      工况: spec.name,
      采样帧: during.length,
      最大偏差百分比: errs.length ? Math.round(Math.max(...errs) * 100) / 100 : null,
      最大偏差像素: errs.length ? Math.round((Math.max(...errs) / 100) * railW) : null,
      平均偏差百分比: errs.length ? Math.round((errs.reduce((a, b) => a + b, 0) / errs.length) * 100) / 100 : null,
      填充取到过的不同值个数: new Set(during.map((f) => f[1])).size,
      指针不同位置个数: new Set(during.map((f) => f[10])).size
    })
    await sleep(700)
  }
  console.log(JSON.stringify({ 逐次: results, 注: '偏差 = |填充 --p − 指针应到的百分比|，像素按轨道宽 ' + Math.round(JSON.parse(await state()).rail.w) + 'px 折算' }, null, 1))
} else if (CMD === 'clicks') {
  /**
   * 点击落点精度扫描：在每个位置真实单击一次，量「音频真正落到的秒数 − 期望秒数」。
   * 旧实现（step=5 量化）这里会稳定出现 −2.5~0 秒的系统偏差；修好后应当是接近 0 的亚秒误差。
   */
  await ev(HOOK_AUDIO)
  if (!JSON.parse(await state()).el) {
    console.error('⊘ 前置不满足：window.Audio 打桩晚于元素创建 —— 落点真值不可用。先 boot 再 setup。')
    process.exit(3)
  }
  const out = []
  for (const frac of [0.2, 0.4, 0.6, 0.8, 0.95, 0.05, 0.33]) {
    const st0 = JSON.parse(await state())
    const railR = st0.rail
    const dur = Number(st0.duration)
    const yMid = railR.y + railR.h / 2
    const x = railR.x + railR.w * frac
    const expected = frac * dur
    await mouse('mouseMoved', x, yMid)
    await sleep(60)
    await mouse('mousePressed', x, yMid)
    await sleep(40)
    await mouse('mouseReleased', x, yMid)
    // 等 seek 落位（el.seeking 变回 false）再读真值。
    // ⚠️ 落位判据必须收得够紧：早期版本用 |el.t − 期望| < 90，
    // 结果「其实没发生任何跳转」也会被当成落位成功（音频本来就在那个区间里），
    // 这次差点把「点在了被遮挡的另一条进度条上」误判成产品缺陷。
    let landed = null
    for (let i = 0; i < 40; i += 1) {
      await sleep(60)
      const s = JSON.parse(await state())
      if (s.el && s.el.seeking === false && Math.abs(s.el.t - expected) < 5) {
        landed = s
        break
      }
    }
    const elT = landed && landed.el ? landed.el.t : null
    out.push({
      点击位置: Math.round(frac * 100) + '%',
      期望秒: Math.round(expected * 10) / 10,
      落点秒: elT,
      误差秒: elT === null ? null : Math.round((elT - expected) * 100) / 100,
      显示百分比: landed ? Math.round(Number(landed.display) * 100) / 100 : null,
      期望百分比: Math.round(frac * 10000) / 100
    })
    await sleep(900)
  }
  const errs = out.map((o) => o.误差秒).filter((v) => v !== null)
  console.log(
    JSON.stringify(
      {
        逐次: out,
        最大绝对误差秒: errs.length ? Math.max(...errs.map(Math.abs)) : null,
        判定: errs.length === out.length && Math.max(...errs.map(Math.abs)) < 1 ? '✓ 每一次都落在点击位置上（<1 秒）' : '★ 仍有明显偏差'
      },
      null,
      1
    )
  )
} else if (CMD === 'matrix') {
  await ev(HOOK_AUDIO)
  const pre = JSON.parse(await state())
  if (!pre.el) {
    console.error('⊘ 前置不满足：window.Audio 打桩晚于元素创建（elCount=' + pre.elCount + '）。')
    console.error('  逐帧真值不可用，任何「音频有没有跟到落点」的结论都是假的。')
    console.error('  请按顺序执行：node scripts/seek-lab.mjs <port> boot && node scripts/seek-lab.mjs <port> setup')
    process.exit(3)
  }
  const CASES = [
    { name: 'A 快速甩到最左(松手在边缘 x=railLeft)', targetFrac: 0, steps: 3, stepMs: 14 },
    { name: 'B 快速甩到中间 50%', targetFrac: 0.5, steps: 3, stepMs: 14 },
    { name: 'C 中等速度拖到 0(7步×40ms)', targetFrac: 0, steps: 7, stepMs: 40 },
    { name: 'D 慢速拖到 0(14步×55ms)', targetFrac: 0, steps: 14, stepMs: 55 },
    { name: 'E 快速甩到最左但松手前停 150ms', targetFrac: 0, steps: 3, stepMs: 14, pauseBeforeReleaseMs: 150 },
    { name: 'F 快速甩到最左、松手点再往左 8px(出控件)', targetFrac: 0, releaseOffsetPx: -8, steps: 3, stepMs: 14 },
    { name: 'G 单步直达最左(1步)', targetFrac: 0, steps: 1, stepMs: 14 }
  ]
  const out = []
  for (const c of CASES) {
    out.push(await oneDrag(c))
    await sleep(1200)
  }
  console.log(JSON.stringify(out, null, 1))
} else if (CMD === 'click' || CMD === 'drag') {
  await ev(HOOK_AUDIO)

  const st0 = JSON.parse(await state())
  if (!st0.rail || !st0.input) {
    console.error('找不到进度条元素'); process.exit(1)
  }
  if (st0.elCount === 0) {
    console.error('★ window.Audio 打桩没生效（可能元素在打桩前就建好了）→ 逐帧真值不可信')
  }
  const railR = st0.rail
  const dur = Number(st0.duration)
  const basePct = Number(st0.display)

  await ev(RECORDER)

  const yMid = railR.y + railR.h / 2
  let plan = ''
  let clickPct = 0

  if (CMD === 'click') {
    const frac = Number(ARG || 0.6)
    const x = railR.x + railR.w * frac
    clickPct = frac * 100
    await mouse('mouseMoved', x, yMid)
    await sleep(60)
    await mouse('mousePressed', x, yMid)
    await sleep(40)
    await mouse('mouseReleased', x, yMid)
    plan = '单击 x=' + Math.round(x) + ' (轨道 ' + (frac * 100).toFixed(1) + '%)'
  } else {
    const mode = ARG || 'flick'
    const startX = railR.x + (basePct / 100) * railR.w
    const targetFrac = mode.startsWith('to0.') ? Number(mode.slice(4)) : 0
    const endX = railR.x + railR.w * targetFrac
    await mouse('mouseMoved', startX, yMid)
    await sleep(120)
    await mouse('mousePressed', startX, yMid)
    await sleep(50)
    if (mode === 'slow') {
      const STEPS = 14
      for (let i = 1; i <= STEPS; i += 1) {
        const t = i / STEPS
        await mouse('mouseMoved', startX + (endX - startX) * t, yMid)
        await sleep(55)
      }
    } else {
      // 快速甩：3 步走完，全程约 40ms，和「一下滑到最开头」一致
      for (const t of [0.45, 0.8, 1]) {
        await mouse('mouseMoved', startX + (endX - startX) * t, yMid)
        await sleep(14)
      }
    }
    await sleep(20)
    await mouse('mouseReleased', endX, yMid)
    plan =
      '真实拖动 ' + mode + '：x ' + Math.round(startX) + ' → ' + Math.round(endX) +
      '（起点 ' + basePct.toFixed(1) + '% → 目标 ' + (targetFrac * 100).toFixed(0) + '%）'
  }

  const WAIT = CMD === 'click' ? 3200 : 4200
  await sleep(WAIT)
  await ev(`window.__recOn = false`)
  const rec = JSON.parse(await ev(`JSON.stringify(window.__rec)`))
  const st1 = JSON.parse(await state())

  const rows = compress(rec)
  const changes = rows
    .map((f, i) => ({ i, t: f[0], p: f[1], prog: f[2], disp: f[3], seek: f[4], pend: f[5], el: f[7], els: f[8] }))

  // 逐帧找「回退」：--p 比上一帧小 0.25% 以上
  const backs = []
  for (let i = 1; i < rec.length; i += 1) {
    const a = rec[i - 1][1]
    const b = rec[i][1]
    if (a !== null && b !== null && b < a - 0.25) backs.push({ t: rec[i][0], from: a, to: b, drop: Math.round((a - b) * 100) / 100 })
  }

  const elSettle = rec.filter((f) => f[8] === 0 && f[7] !== null)
  const summary = {
    构建: await ev(`document.title`),
    计划: plan,
    拖动前: { display: st0.display, current: st0.current, duration: st0.duration, elTime: st0.el && st0.el.t, inputValue: st0.inputValue, inputMax: st0.inputMax },
    拖动后: { display: st1.display, current: st1.current, duration: st1.duration, elTime: st1.el && st1.el.t, inputValue: st1.inputValue, seeking: st1.seeking, pending: st1.pending },
    帧数: rec.length,
    回退次数: backs.length,
    回退明细: backs.slice(0, 12),
    变化点表: HDR + '\n' + fmt(rows.slice(0, 60))
  }

  if (CMD === 'click') {
    const expectPct = ((railR.w * Number(ARG || 0.6)) / railR.w) * 100
    const finalPct = Number(st1.display)
    summary.落点判定 = {
      点击期望百分比: Math.round(clickPct * 100) / 100,
      最终显示百分比: finalPct,
      偏差百分比: Math.round((finalPct - clickPct) * 100) / 100,
      期望秒: Math.round((clickPct / 100) * dur * 10) / 10,
      最终秒: Math.round(Number(st1.current) * 10) / 10,
      秒偏差: Math.round((Number(st1.current) - (clickPct / 100) * dur) * 10) / 10,
      备注: '最终秒已含播过去的' + (WAIT / 1000).toFixed(1) + '秒，所以「秒偏差」应当约等于 +' + (WAIT / 1000).toFixed(1) + '；若明显小于它，说明落点真的偏后（往后退了）'
    }
    summary.参考_理论偏差 = expectPct
  }

  console.log(JSON.stringify(summary, null, 1))
  console.log('\n--- 逐帧（仅变化点）---')
  console.log(fmt(rows))
} else {
  console.error('未知命令: ' + CMD)
  process.exit(2)
}

cdp.close()
process.exit(0)
