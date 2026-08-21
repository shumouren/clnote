/**
 * Markdown → TipTap (ProseMirror) JSON 解析器
 * ---------------------------------------------------------------
 * 与导出器 noteToMarkdown 反向，覆盖常见语法：
 *   标题 / 段落 / 加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 图片链接
 *   无序列表 / 有序列表 / 任务列表（含嵌套，按缩进）
 *   引用 / 围栏代码块 / 分割线 / GFM 表格
 * 纯函数、无 DOM 依赖，便于单测。
 */

interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}
interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

/* ---------------- 行内解析 ---------------- */

function parseInline(src: string): PMNode[] {
  const out: PMNode[] = []
  const pushText = (t: string, marks?: PMMark[]) => {
    if (!t) return
    out.push(marks ? { type: 'text', text: t, marks } : { type: 'text', text: t })
  }

  // 分组顺序：粗体** > 粗体__ > 斜体* > 斜体_ > 删除线 > 代码 > 链接
  const re =
    /(\*\*([^*]+?)\*\*)|(__([^_]+?)__)|(\*([^*]+?)\*)|(_([^_]+?)_)|(~~([^~]+?)~~)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)\s]+?)\))/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > last) pushText(src.slice(last, m.index))
    if (m[2] !== undefined) pushText(m[2], [{ type: 'bold' }])
    else if (m[4] !== undefined) pushText(m[4], [{ type: 'bold' }])
    else if (m[6] !== undefined) pushText(m[6], [{ type: 'italic' }])
    else if (m[8] !== undefined) pushText(m[8], [{ type: 'italic' }])
    else if (m[10] !== undefined) pushText(m[10], [{ type: 'strike' }])
    else if (m[12] !== undefined) pushText(m[12], [{ type: 'code' }])
    else if (m[14] !== undefined)
      pushText(m[14], [{ type: 'link', attrs: { href: m[15] } }])
    last = re.lastIndex
  }
  if (last < src.length) pushText(src.slice(last))
  return out
}

function para(text: string): PMNode {
  const inner = parseInline(text.trim())
  return { type: 'paragraph', content: inner.length ? inner : undefined }
}

/* ---------------- 块解析 ---------------- */

interface RawItem {
  indent: number
  type: 'bullet' | 'ordered' | 'task'
  checked: boolean
  text: string
}

function makeItem(it: RawItem): PMNode {
  const content: PMNode[] = [para(it.text)]
  return {
    type: it.type === 'task' ? 'taskItem' : 'listItem',
    attrs: it.type === 'task' ? { checked: it.checked } : undefined,
    content,
  }
}

/** 把扁平的列表项（带缩进）构建成嵌套 list 节点（每层用对应 list 节点包裹） */
function sublistType(it: RawItem): 'bulletList' | 'orderedList' | 'taskList' {
  return it.type === 'task' ? 'taskList' : it.type === 'ordered' ? 'orderedList' : 'bulletList'
}

function buildLevel(
  items: RawItem[],
  i: number,
  indent: number,
  listType: 'bulletList' | 'orderedList' | 'taskList',
): { content: PMNode[]; next: number } {
  const content: PMNode[] = []
  while (i < items.length && items[i].indent === indent) {
    const it = items[i]
    const node = makeItem(it)
    i++
    if (i < items.length && items[i].indent > indent) {
      const subType = sublistType(items[i])
      const sub = buildLevel(items, i, items[i].indent, subType)
      node.content!.push({ type: subType, content: sub.content })
      i = sub.next
    }
    content.push(node)
  }
  return { content, next: i }
}

function buildList(items: RawItem[]): PMNode {
  const listType = sublistType(items[0])
  const built = buildLevel(items, 0, items[0].indent, listType)
  return { type: listType, content: built.content }
}

function parseTable(rows: string[]): PMNode {
  const splitCells = (line: string) =>
    line
      .replace(/^\s*\|\s?/, '')
      .replace(/\s?\|\s*$/, '')
      .split('|')
      .map((c) => c.trim())
  const header = splitCells(rows[0])
  const body = rows.slice(2).map(splitCells)
  const toRow = (cells: string[], isHeader: boolean) => ({
    type: 'tableRow',
    content: cells.map((c) => ({
      type: isHeader ? 'tableHeader' : 'tableCell',
      content: [para(c)],
    })),
  })
  return {
    type: 'table',
    content: [toRow(header, true), ...body.map((r) => toRow(r, false))],
  }
}

function parseBlocks(lines: string[], start = 0, end?: number): PMNode[] {
  const last = end ?? lines.length
  const out: PMNode[] = []
  let i = start
  while (i < last) {
    const line = lines[i]

    // 空行
    if (!line.trim()) {
      i++
      continue
    }

    // 围栏代码块
    const fence = /^\s*```(.*)$/.exec(line)
    if (fence) {
      const lang = fence[1].trim()
      const buf: string[] = []
      i++
      while (i < last && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过结束 ```
      out.push({
        type: 'codeBlock',
        attrs: lang ? { language: lang } : undefined,
        content: buf.length ? [{ type: 'text', text: buf.join('\n') }] : undefined,
      })
      continue
    }

    // 分割线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ type: 'horizontalRule' })
      i++
      continue
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = Math.min(6, h[1].length)
      out.push({
        type: 'heading',
        attrs: { level },
        content: parseInline(h[2].trim()),
      })
      i++
      continue
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < last && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      const inner = parseBlocks(buf, 0)
      out.push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] })
      continue
    }

    // 表格（当前行含 | 且下一行是分隔行）
    if (
      line.includes('|') &&
      i + 1 < last &&
      /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])
    ) {
      const buf: string[] = []
      while (i < last && lines[i].includes('|')) {
        buf.push(lines[i])
        i++
      }
      if (buf.length >= 2) out.push(parseTable(buf))
      continue
    }

    // 列表（含嵌套与任务）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const buf: RawItem[] = []
      while (i < last && (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) || /^\s+\S/.test(lines[i]))) {
        const li = lines[i]
        const m = /^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?(.*)$/.exec(li)
        if (m) {
          const indent = m[1].replace(/\t/g, '  ').length
          const marker = m[2]
          const task = !!m[3]
          const checked = task && /\[[xX]\]/.test(m[3])
          buf.push({
            indent,
            type: task ? 'task' : /^\d+\./.test(marker) ? 'ordered' : 'bullet',
            checked,
            text: m[4],
          })
        }
        i++
      }
      if (buf.length) out.push(buildList(buf))
      continue
    }

    // 段落：合并连续非空白、非块起始行
    const buf: string[] = [line]
    i++
    while (
      i < last &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    out.push(para(buf.join('\n')))
  }
  return out
}

/** 提取首行 H1 作为候选标题（导入时用作笔记名） */
export function firstHeading(md: string): string | null {
  const m = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(md)
  return m ? m[1].trim() : null
}

export function markdownToTipTap(md: string): PMNode {
  const lines = md.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n')
  const blocks = parseBlocks(lines)
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}
