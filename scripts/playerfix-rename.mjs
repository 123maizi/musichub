/**
 * 一次性迁移：`--rail-w` → `--track-w`（我的两个文件）。
 *
 * 背景：`--rail-w` 在 style.css 里表示导航柱宽度(64px)，契约把进度轨道宽度
 * 改名成 `--track-w` 以避免同名不同义。改名这类操作最容易「静默失效」
 * （类名/变量名写错不报错，只是不生效），所以这里把替换写得非常显式，
 * 并在结尾打印每个文件的命中次数供核对。
 *
 * 用法：node scripts/playerfix-rename.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILES = [
  'src/renderer/src/components/PlayerBar.vue',
  'src/renderer/src/views/NowPlayingView.vue'
]

/** 逐条替换：[查找, 替换] —— 全部是 ASCII，避免编码风险 */
const EDITS = [
  // 模板绑定
  [`:style="{ '--p': displayProgress, '--rail-w': railWidth }"`, `:style="{ '--p': displayProgress, '--track-w': railWidth }"`],
  // 本地兜底默认值
  ['--rail-w: 0;', '--track-w: 0;'],
  // 圆点公式
  ['var(--rail-w, 0)', 'var(--track-w, 0)'],
  // 注释：公式说明
  ['translate3d(calc(--p × --rail-w × 1px / 100), …)', 'translate3d(calc(--p × --track-w × 1px / 100), …)'],
  ['契约里 `--rail-w` 是「不带单位的数字」', '契约里 `--track-w` 是「不带单位的数字」'],
  ['契约规定 --rail-w 是不带单位的数字', '契约规定 --track-w 是不带单位的数字'],
  // 注释：为什么要有本地兜底（改名后这条注释要解释清楚两件事）
  [
    '* 本地默认 0：全局 `--rail-w` 是图标导航柱宽度（64px）。\n   * 万一内联的轨道宽度没绑上，滑块宁可停在起点，也不能按 64px 乱跑。',
    '* 本地默认 0：契约把进度轨道宽度改名为 `--track-w`，与 style.css 里表示\n   * 「图标导航柱宽度」的 `--rail-w`(64px) 彻底分开。万一内联值没绑上，\n   * 滑块宁可停在起点，也不能按 64px 乱跑。'
  ],
  [
    '/* 全局 --rail-w 是导航柱宽度，这里给本地默认值兜底 */',
    '/* 契约已把轨道宽度改名为 --track-w（--rail-w 是导航柱宽度），这里给本地默认值兜底 */'
  ]
]

let total = 0
for (const file of FILES) {
  let src = readFileSync(file, 'utf8')
  const hits = []
  for (const [from, to] of EDITS) {
    const count = src.split(from).length - 1
    if (count > 0) {
      src = src.split(from).join(to)
      hits.push(`${count}× ${from.slice(0, 42).replace(/\n/g, '\\n')}`)
      total += count
    }
  }
  writeFileSync(file, src, 'utf8')
  const left = (src.match(/--rail-w/g) ?? []).length
  console.log(`${file}\n  替换: ${hits.length ? hits.join(' | ') : '（无命中）'}\n  剩余 --rail-w: ${left}`)
}
console.log(`\n合计替换 ${total} 处；剩余 --rail-w 应只出现在「解释改名」的注释里`)
