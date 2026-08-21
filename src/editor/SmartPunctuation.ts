import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { runtime } from '../settings/settings'

/**
 * 智能标点扩展（笔落写作式中文交互）
 * ---------------------------------------------------------------
 * 行为：
 *  1) 输入左符号 → 自动补右符号，光标落中间
 *  2) 右侧已存在右符号 → 跳过，不重复
 *  3) 光标紧贴右符号内侧按回车 → 跳出到外侧、不换行
 *  4) 紧贴配对内侧退格 → 同时删左右两个符号
 *  5) 中英文引号（" ' “ ” ‘ ’）按当前风格统一成 『』「」/ “” ‘’；
 *     开引号成对（光标居中）、闭引号仅补闭符号；右侧已存在对应右符号则跳过
 *  6) -- → —— 智能破折号
 *
 * 关键：基于 ProseMirror 的 handleTextInput + compositionend 双入口，但严格分工、互不重复：
 *  - 直接输入（英文 / 非组合态）→ handleTextInput 一次性配对 + 转换；
 *  - 中文输入法组合上屏 → 组合期间 handleTextInput 直接放行（view.composing 为 true），
 *    待 compositionend 整段归一 + 自动配对，只此一次，杜绝「先配对再转换、转换后再配对」的双插。
 *
 * 覆盖的全部配对符号：小/中/大括号、书名号、双/单引号（含全角）、
 * 方头括号「」『』〖〗〔〕等。
 */

const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>',
  '（': '）',
  '【': '】',
  '〖': '〗',
  '〔': '〕',
  '「': '」',
  '『': '』',
  '《': '》',
  '“': '”',
  '‘': '’',
}

export const CLOSE_TO_OPEN: Record<string, string> = {}
for (const [open, close] of Object.entries(PAIRS)) {
  CLOSE_TO_OPEN[close] = open
}

/** 半角标点 → 全角标点映射（严格只转换符号，绝不触碰数字 / 字母 / 空格，避免误改正文内容） */
const HALF_TO_FULL: Record<string, string> = {
  '!': '！',
  '"': '＂',
  '#': '＃',
  $: '＄',
  '%': '％',
  '&': '＆',
  "'": '＇',
  '(': '（',
  ')': '）',
  '*': '＊',
  '+': '＋',
  ',': '，',
  '-': '－',
  '.': '．',
  '/': '／',
  ':': '：',
  ';': '；',
  '<': '＜',
  '=': '＝',
  '>': '＞',
  '?': '？',
  '@': '＠',
  '[': '［',
  '\\': '＼',
  ']': '］',
  '^': '＾',
  _: '＿',
  '`': '｀',
  '{': '｛',
  '|': '｜',
  '}': '｝',
  '~': '～',
}

/** 把字符串里的半角标点统一转为全角标点（数字 / 字母 / 空格保持不变） */
export function normalizeHalfWidthPunct(s: string): string {
  let out = ''
  for (const ch of s) {
    out += HALF_TO_FULL[ch] ?? ch
  }
  return out
}

/** 引号输入识别：覆盖半角直引号与全角弯引号（输入法直接上屏的 "" ''）。
 *  open=true 表示开/左引号（配对时生成一对开闭符号）；open=false 表示闭/右引号
 *  （只输出对应闭符号，不再额外生成一对，避免"多出一个引号"）。 */
const QUOTE_MAP: Record<string, { double: boolean; open: boolean }> = {
  '"': { double: true, open: true }, // 半角直双引号 "
  "'": { double: false, open: true }, // 半角直单引号 '
  '“': { double: true, open: true }, // 全角弯双引号（左）“
  '‘': { double: false, open: true }, // 全角弯单引号（左）‘
  '”': { double: true, open: false }, // 全角弯双引号（右）”
  '’': { double: false, open: false }, // 全角弯单引号（右）’
}

/** 按风格取开闭符号：straight 直引号 / corner 中文角括号『』「」/ chinese 中文弯引号“”'' */
function quotePair(style: string, double: boolean): { open: string; close: string } {
  if (style === 'corner') return double ? { open: '『', close: '』' } : { open: '「', close: '」' }
  if (style === 'chinese') return double ? { open: '“', close: '”' } : { open: '‘', close: '’' }
  return double ? { open: '"', close: '"' } : { open: "'", close: "'" }
}

/** 取文档某位置的单个字符（跨块边界返回 blockSeparator，这里用 \0 占位） */
function charAt(doc: any, pos: number): string {
  if (pos < 0 || pos >= doc.content.size) return ''
  return doc.textBetween(pos, pos + 1, '\0', '\0')
}

/**
 * 把字符串里的各类引号统一成当前风格的成对符号：
 * 覆盖半角直引号 " ' 与全角弯引号（输入法直接上屏的 "" ''，以及 IME 组合串中的引号）。
 * 非引号字符原样保留，因此可直接作用于整段输入文本。用于 IME 场景——
 * 中文输入法上屏的弯引号往往不经过 handleTextInput，需要整串扫描转换。
 */
/** 把字符串里的各类引号统一成当前风格的成对/单符号。
 * 仅在「开启转换」时改动风格（中文引号→角括号『』「」）；
 * 未开启转换（straight）时保持原样——成对引号已是配对状态不改动，
 * 单引号由单字符路径负责配对。整串一次扫描、单次转换，绝不二次处理。
 * 非引号字符原样保留。 */
function convertQuotesInString(s: string): string {
  const style = runtime.smartQuoteStyle
  const convert = runtime.smartPunctuation && style !== 'straight'
  if (!convert) return s // 不转换：保持原样，避免把中文成对引号改写成直引号
  let out = ''
  let i = 0
  while (i < s.length) {
    const two = s.slice(i, i + 2)
    // 成对上屏的引号（中文「”“」或 ASCII「""」等）→ 归一为一对角括号，单进单出
    if (two === '“”' || two === '““' || two === '””' || two === '""') {
      const { open, close } = quotePair(style, true)
      out += open + close
      i += 2
      continue
    }
    if (two === '‘’' || two === '‘‘' || two === '’’' || two === "''") {
      const { open, close } = quotePair(style, false)
      out += open + close
      i += 2
      continue
    }
    const one = s[i]
    const q = QUOTE_MAP[one]
    if (q) {
      const { open, close } = quotePair(style, q.double)
      // 开引号成对（补闭符号）；闭引号只输出闭符号
      if (q.open) out += open + close
      else out += close
      i += 1
      continue
    }
    out += one
    i += 1
  }
  return out
}

/**
 * 整段归一 + 自动配对（用于 IME 组合上屏的 compositionend 路径）。
 * 覆盖全部配对符号：引号（中文引号→角括号『』「」/“”、ASCII 直引号）+ 普通括号（（）【】《》〖〗〔〕「」『』等）。
 * 顺序固定：先判定符号类型 → 开符号转左角括号/原样 → 自动补右符号；闭符号右侧已存在则跳过（避免重复）。
 * 单次完成，与 handleTextInput 严格分工、绝不双插。
 */
interface ConvResult {
  text: string
  cursor: number
  skipAfter: boolean
}

function convertString(s: string, afterChar: string): ConvResult {
  const style = runtime.smartQuoteStyle
  const convert = runtime.smartPunctuation && style !== 'straight'
  const chars = Array.from(s)
  let out = ''
  let cursor = -1
  let skipAfter = false
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const next = chars[i + 1]
    const isLast = i === chars.length - 1

    const q = QUOTE_MAP[ch]
    if (q) {
      const natClose = ch === '"' ? '"' : ch === "'" ? "'" : q.double ? '”' : '’'
      const { open, close } = convert ? quotePair(style, q.double) : { open: ch, close: natClose }
      if (q.open) {
        if (next === natClose) {
          // IME 已自动配对（如 "" 或 ""），整对归一为一对，跳过右侧闭符号
          out += open + close
          i++
        } else {
          out += open + close
          if (cursor < 0) cursor = out.length - 1
        }
      } else if (isLast && afterChar === close) {
        // 已是闭引号且右侧已存在对应闭符号 → 仅把光标越过，不重复插入
        out += close
        cursor = out.length
        skipAfter = true
      } else {
        out += close
      }
      continue
    }

    // 普通配对开符号（（）【】《》〖〗〔〕「」『』等）
    const pairClose = PAIRS[ch]
    if (pairClose) {
      if (next === pairClose) {
        out += ch + pairClose // IME 已配对，保持整对
        i++
      } else {
        out += ch + pairClose
        if (cursor < 0) cursor = out.length - 1
      }
      continue
    }

    // 单独的闭符号：右侧已存在同一闭符号则跳过（不重复插入）
    if (CLOSE_TO_OPEN[ch]) {
      if (isLast && afterChar === ch) {
        out += ch
        cursor = out.length
        skipAfter = true
      } else {
        out += ch
      }
      continue
    }

    out += ch
  }
  if (cursor < 0) cursor = out.length
  return { text: out, cursor, skipAfter }
}

/**
 * 处理单个引号字符（单路径、一次完成，顺序固定）：
 *  1) 先判定它是什么引号（中文双/单、英文直引号等）；
 *  2) 若开启转换 → 开引号先转成左角括号『/「，再自动补右角括号』/」；
 *     若未开启转换 → 开引号保持原样，仅补上对应中文闭符号（" " → ""）；
 *  3) 闭引号只补对应闭符号；
 *  4) 右侧已是对应闭符号 → 仅把光标越过，不重复插入（杜绝"多出一个引号"）。
 * 仅此一处处理引号，不依赖 compositionend 二次转换，从根上避免"出来→配对→转换→再配对"。
 */
function handleQuote(
  view: any,
  from: number,
  to: number,
  text: string,
  after: string,
): boolean {
  const q = QUOTE_MAP[text]
  if (!q) return false
  const style = runtime.smartQuoteStyle
  const convert = runtime.smartPunctuation && style !== 'straight'
  // 该引号自身的「自然配对」闭符号：不转换时保持原样（中文" → "，英文" → "）
  const naturalClose =
    text === '"' ? '"' : text === "'" ? "'" : q.double ? '”' : '’'
  const { state } = view
  if (q.open) {
    const openChar = convert ? quotePair(style, q.double).open : text
    const closeChar = convert ? quotePair(style, q.double).close : naturalClose
    if (after === closeChar) {
      // 右侧已有配对闭符号，仅移动光标，不重复插入
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)))
      return true
    }
    const tr = state.tr.insertText(openChar + closeChar, from, to)
    tr.setSelection(TextSelection.create(tr.doc, from + 1))
    view.dispatch(tr)
    return true
  }
  // 闭引号：补对应闭符号（转换时补角括号闭，否则补本风格闭）；右侧已有则越光标
  const closeChar = convert ? quotePair(style, q.double).close : naturalClose
  if (after === closeChar) {
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)))
    return true
  }
  view.dispatch(state.tr.insertText(closeChar, from, to))
  return true
}

export const SmartPunctuation = Extension.create({
  name: 'smartPunctuation',

  addProseMirrorPlugins() {
    // 记录 IME 组合起始位置：组合结束后据此定位刚上屏的区段，做一次归一转换
    let composeStart = -1
    return [
      new Plugin({
        key: new PluginKey('smartPunctuation'),

        props: {
        handleTextInput(view, from, to, text) {
          // 总开关：设置里关闭智能标点时，本扩展完全不介入
          if (!runtime.smartPunctuation) return false
          // 中文输入法组合（composition）进行中：先让原始引号完整上屏（可能是输入法自动配对的一对），
          // 待 compositionend 一次性整段归一 + 自动配对。此处直接放行，既避免打断拼音选词，
          // 也确保 IME 引号只被 compositionend 处理一次，绝不双插。
          if (view.composing) return false
          if (text.length === 0) return false
          const { state } = view
            const doc = state.doc
            const before = charAt(doc, from - 1)
            const after = charAt(doc, from)

            // 1) 普通配对（左右不同）
            if (PAIRS[text]) {
              const tr = state.tr.insertText(text + PAIRS[text], from, to)
              tr.setSelection(TextSelection.create(tr.doc, from + 1))
              view.dispatch(tr)
              return true
            }

            // 2) 右符号已存在 → 跳过
            if (CLOSE_TO_OPEN[text] && after === text) {
              const tr = state.tr.setSelection(
                TextSelection.create(doc, from + 1),
              )
              view.dispatch(tr)
              return true
            }

            // 5) 引号（直接输入路径；顺序固定：判定→转换左角括号→自动配对右角括号）：
            //    单字符走 handleQuote；多字符（如一次上屏一对引号 ""）走 convertQuotesInString 整串一次性转换。
            //    组合态（IME）的引号不在此处处理——handleTextInput 在组合期间已 return false，
            //    改由 compositionend 整段归一，确保每处引号只转换一次。
            if (text.length === 1 && QUOTE_MAP[text]) {
              if (handleQuote(view, from, to, text, after)) return true
            } else if (text.length > 1) {
              const converted = convertQuotesInString(text)
              if (converted !== text) {
                const tr = state.tr.insertText(converted, from, to)
                tr.setSelection(TextSelection.create(tr.doc, from + converted.length))
                view.dispatch(tr)
                return true
              }
            }

            // 6) -- → ——（避免三连杠误伤）
            if (
              text === '-' &&
              before === '-' &&
              charAt(doc, from - 2) !== '-'
            ) {
              const tr = state.tr.insertText('——', from - 1, to)
              tr.setSelection(TextSelection.create(tr.doc, from + 1))
              view.dispatch(tr)
              return true
            }

            return false
          },

          handleKeyDown(view, event) {
            // 总开关：设置里关闭智能标点时，本扩展完全不介入
            if (!runtime.smartPunctuation) return false
            if (view.composing) return false
            const { state } = view
            const { empty, from } = state.selection
            const doc = state.doc

            // 3) 回车跳出配对
            if (event.key === 'Enter') {
              const after = charAt(doc, from)
              if (after && CLOSE_TO_OPEN[after]) {
                const tr = state.tr.setSelection(
                  TextSelection.create(doc, from + 1),
                )
                view.dispatch(tr)
                return true
              }
              return false
            }

            // 4) 退格删除配对
            if (event.key === 'Backspace' && empty) {
              const before = charAt(doc, from - 1)
              const after = charAt(doc, from)
              if (before && after && PAIRS[before] === after) {
                const tr = state.tr.delete(from - 1, from + 1)
                view.dispatch(tr)
                return true
              }
              return false
            }

            return false
          },

          // 中文输入法组合上屏：此处是 IME 引号的唯一处理入口（handleTextInput 在组合期间已放行）。
          // 组合结束后整段读回、统一归一 + 自动配对，只此一次，绝不与 handleTextInput 重复。
          handleDOMEvents: {
            compositionstart(view) {
              composeStart = view.state.selection.from
              return false
            },
            compositionend(view, _event) {
              if (!runtime.smartPunctuation) return false
              const { state } = view
              const end = state.selection.from
              const start = composeStart
              composeStart = -1
              if (start < 0 || start > end) return false
              const seg = state.doc.textBetween(start, end, '\0', '\0')
              if (!seg) return false
              // 整段归一 + 自动配对：覆盖引号与全部括号符号（（）【】《》等）。
              // 仅当确有符号被转换时才派发事务（避免无谓刷新），且每处只转换一次，绝不双插。
              const afterChar = charAt(state.doc, end)
              const converted = convertString(seg, afterChar)
              if (converted.text === seg) return false
              const to = end + (converted.skipAfter ? 1 : 0)
              const tr = state.tr.insertText(converted.text, start, to)
              tr.setSelection(TextSelection.create(tr.doc, start + converted.cursor))
              view.dispatch(tr)
              return false
            },
          },
        },
      }),
      focusPlugin,
    ]
  },
})

/**
 * 专注模式：用 ProseMirror 节点装饰高亮当前块（官方稳定方案，替代手动 DOM 回溯）。
 * 读取 runtime.focusMode：off 不装饰；否则给光标所在的顶层块加 .focus-here。
 * 装饰随选区自动重算，从根上解决「当前块不加深、全部变淡」的问题。
 */
const focusPlugin = new Plugin({
  key: new PluginKey('focusHighlight'),
  props: {
    decorations(state) {
      const mode = runtime.focusMode
      if (!mode || mode === 'off') return DecorationSet.empty
      const $from = state.selection.$from
      if ($from.depth < 1) return DecorationSet.empty
      const blockStart = $from.before(1)
      const node = state.doc.nodeAt(blockStart)
      if (!node) return DecorationSet.empty
      return DecorationSet.create(state.doc, [
        Decoration.node(blockStart, blockStart + node.nodeSize, { class: 'focus-here' }),
      ])
    },
  },
})
