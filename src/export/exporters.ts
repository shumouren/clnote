/**
 * 导出序列化器
 * ---------------------------------------------------------------
 * 文本笔记（TipTap JSON）→ Markdown / HTML / 纯文本 / JSON
 * 思维导图（MindMapDoc）→ Markdown 大纲 / OPML / 纯文本 / SVG / PNG / JSON
 *
 * 全部为纯函数，不依赖编辑器实例，因此批量导出时无需把文件逐个打开。
 */
import type { FsNode, MindMapDoc, MindNode, NodeType, TimelineDoc, TimeNode, CharacterDoc, PlotDoc, PlotItem, PlotMode, SettingDoc, MapDoc } from '../model/types'
import { PLOT_MODE_LABEL, layoutPlot } from '../model/types'
import { layoutTimelines, TL_NODE_W, TL_NODE_H } from '../timeline/layout'
import { loadSettings } from '../settings/settings'

export type ExportKind = 'md' | 'html' | 'txt' | 'json' | 'opml' | 'svg' | 'png' | 'epub'

export const FORMAT_LABEL: Record<ExportKind, string> = {
  md: 'Markdown (.md)',
  html: '网页 HTML (.html)',
  txt: '纯文本 (.txt)',
  json: '源数据 JSON (.json)',
  opml: '大纲 OPML (.opml)',
  svg: '矢量图 SVG (.svg)',
  png: '图片 PNG (.png)',
  epub: '电子书 EPUB (.epub)',
}

export const FORMAT_EXT: Record<ExportKind, string> = {
  md: 'md',
  html: 'html',
  txt: 'txt',
  json: 'json',
  opml: 'opml',
  svg: 'svg',
  png: 'png',
  epub: 'epub',
}

/** 混选时的通用格式（含 EPUB，按章节顺序合并成书） */
export const COMMON: ExportKind[] = ['md', 'html', 'txt', 'json', 'epub']

/** 某类型节点支持的导出格式 */
export function formatsFor(type: NodeType): ExportKind[] {
  if (type === 'note') return ['md', 'html', 'txt', 'json', 'epub']
  if (type === 'mindmap') return ['md', 'txt', 'opml', 'svg', 'png', 'html', 'json']
  if (type === 'timeline') return ['md', 'txt', 'svg', 'png', 'json']
  if (type === 'character') return ['md', 'txt', 'json']
  if (type === 'plot') return ['md', 'txt', 'json']
  if (type === 'setting') return ['md', 'txt', 'json']
  if (type === 'map') return ['md', 'txt', 'json']
  return []
}

/** 二进制格式（不能参与"合并成单文件"；EPUB 本身是单文件成品书，也不参与 ZIP/合并） */
export const BINARY_FORMATS: ExportKind[] = ['png', 'epub']

/* ============================================================
   通用工具
   ============================================================ */

export function sanitizeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '未命名'
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_[\]])/g, '\\$1')
}

/* ============================================================
   ProseMirror JSON 结构
   ============================================================ */

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

function asDoc(content: unknown): PMNode | null {
  if (!content || typeof content !== 'object') return null
  const d = content as PMNode
  return d.type === 'doc' ? d : null
}

/* ---------------- Markdown ---------------- */

function inlineToMd(nodes: PMNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'image') {
        const src = String(n.attrs?.src ?? '')
        const alt = String(n.attrs?.alt ?? '')
        return `![${alt}](${src})`
      }
      let t = escapeMd(n.text ?? '')
      const marks = n.marks ?? []
      // code 优先，避免在代码里再插入 ** 之类
      if (marks.some((m) => m.type === 'code')) return '`' + (n.text ?? '') + '`'
      if (marks.some((m) => m.type === 'bold')) t = `**${t}**`
      if (marks.some((m) => m.type === 'italic')) t = `*${t}*`
      if (marks.some((m) => m.type === 'strike')) t = `~~${t}~~`
      const link = marks.find((m) => m.type === 'link')
      if (link) t = `[${t}](${String(link.attrs?.href ?? '')})`
      return t
    })
    .join('')
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l, i) => (i === 0 || l.length === 0 ? l : pad + l))
    .join('\n')
}

function tableToMd(node: PMNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((b) => blockToMd(b, 0))
        .join(' ')
        .replace(/\n+/g, ' ')
        .replace(/\|/g, '\\|')
        .trim(),
    ),
  )
  if (!rows.length) return ''
  const cols = Math.max(...rows.map((r) => r.length))
  const norm = rows.map((r) => {
    const c = [...r]
    while (c.length < cols) c.push('')
    return c
  })
  const firstIsHeader = (node.content?.[0]?.content ?? []).every(
    (c) => c.type === 'tableHeader',
  )
  const header = firstIsHeader ? norm[0] : new Array(cols).fill('')
  const body = firstIsHeader ? norm.slice(1) : norm
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [
    line(header),
    `| ${new Array(cols).fill('---').join(' | ')} |`,
    ...body.map(line),
  ].join('\n')
}

function listToMd(node: PMNode, depth: number, ordered: boolean): string {
  const items = node.content ?? []
  return items
    .map((item, i) => {
      const marker = ordered ? `${i + 1}. ` : '- '
      const pad = ' '.repeat(marker.length)
      const inner = (item.content ?? []).map((b) => blockToMd(b, depth + 1)).join('\n\n')
      return marker + indent(inner, pad)
    })
    .join('\n')
}

function taskListToMd(node: PMNode, depth: number): string {
  return (node.content ?? [])
    .map((item) => {
      const checked = item.attrs?.checked === true
      const marker = `- [${checked ? 'x' : ' '}] `
      const inner = (item.content ?? []).map((b) => blockToMd(b, depth + 1)).join('\n\n')
      return marker + indent(inner, '  ')
    })
    .join('\n')
}

function blockToMd(node: PMNode, depth: number): string {
  switch (node.type) {
    case 'paragraph':
      return inlineToMd(node.content)
    case 'heading': {
      const lvl = Number(node.attrs?.level ?? 1)
      return '#'.repeat(Math.min(6, Math.max(1, lvl))) + ' ' + inlineToMd(node.content)
    }
    case 'bulletList':
      return listToMd(node, depth, false)
    case 'orderedList':
      return listToMd(node, depth, true)
    case 'taskList':
      return taskListToMd(node, depth)
    case 'listItem':
    case 'taskItem':
      return (node.content ?? []).map((b) => blockToMd(b, depth)).join('\n\n')
    case 'blockquote':
      return (node.content ?? [])
        .map((b) => blockToMd(b, depth))
        .join('\n\n')
        .split('\n')
        .map((l) => '> ' + l)
        .join('\n')
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '')
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      return '```' + lang + '\n' + code + '\n```'
    }
    case 'horizontalRule':
      return '---'
    case 'table':
      return tableToMd(node)
    case 'image':
      return `![${String(node.attrs?.alt ?? '')}](${String(node.attrs?.src ?? '')})`
    case 'mermaid':
      return '```mermaid\n' + String(node.attrs?.code ?? '') + '\n```'
    default:
      if (node.content) return node.content.map((b) => blockToMd(b, depth)).join('\n\n')
      return node.text ?? ''
  }
}

export function noteToMarkdown(node: FsNode): string {
  const doc = asDoc(node.content)
  const body = doc ? (doc.content ?? []).map((b) => blockToMd(b, 0)).join('\n\n') : ''
  return `# ${node.name}\n\n${body}\n`.replace(/\n{3,}/g, '\n\n')
}

/* ---------------- 纯文本 ---------------- */

function blockToText(node: PMNode, depth: number): string {
  const pad = '    '.repeat(depth)
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'hardBreak':
      return '\n'
    case 'paragraph':
    case 'heading':
      return pad + (node.content ?? []).map((c) => blockToText(c, 0)).join('')
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return (node.content ?? [])
        .map((item, i) => {
          const mark =
            node.type === 'orderedList'
              ? `${i + 1}. `
              : node.type === 'taskList'
                ? item.attrs?.checked
                  ? '[x] '
                  : '[ ] '
                : '· '
          const inner = (item.content ?? [])
            .map((b) => blockToText(b, 0))
            .join('\n')
            .trim()
          return pad + mark + inner
        })
        .join('\n')
    case 'codeBlock':
      return (node.content ?? []).map((c) => c.text ?? '').join('')
    case 'table':
      return (node.content ?? [])
        .map((row) =>
          (row.content ?? [])
            .map((cell) =>
              (cell.content ?? []).map((b) => blockToText(b, 0)).join(' ').trim(),
            )
            .join('\t'),
        )
        .join('\n')
    case 'horizontalRule':
      return '────────'
    case 'mermaid':
      return '【流程图】\n' + String(node.attrs?.code ?? '')
    default:
      if (node.content) return node.content.map((b) => blockToText(b, depth)).join('\n')
      return ''
  }
}

export function noteToText(node: FsNode): string {
  const doc = asDoc(node.content)
  const body = doc ? (doc.content ?? []).map((b) => blockToText(b, 0)).join('\n') : ''
  return `${node.name}\n${'='.repeat(20)}\n\n${body}\n`
}

/* ---------------- HTML ---------------- */

function inlineToHtml(nodes: PMNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '<br />'
      if (n.type === 'image')
        return `<img src="${escapeHtml(String(n.attrs?.src ?? ''))}" alt="${escapeHtml(
          String(n.attrs?.alt ?? ''),
        )}" />`
      let t = escapeHtml(n.text ?? '')
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') t = `<strong>${t}</strong>`
        else if (m.type === 'italic') t = `<em>${t}</em>`
        else if (m.type === 'strike') t = `<s>${t}</s>`
        else if (m.type === 'code') t = `<code>${t}</code>`
        else if (m.type === 'link')
          t = `<a href="${escapeHtml(String(m.attrs?.href ?? ''))}">${t}</a>`
      }
      return t
    })
    .join('')
}

function blockToHtml(node: PMNode): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${inlineToHtml(node.content) || '<br />'}</p>`
    case 'heading': {
      const lvl = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      return `<h${lvl}>${inlineToHtml(node.content)}</h${lvl}>`
    }
    case 'bulletList':
      return `<ul>${(node.content ?? []).map(blockToHtml).join('')}</ul>`
    case 'orderedList':
      return `<ol>${(node.content ?? []).map(blockToHtml).join('')}</ol>`
    case 'listItem':
      return `<li>${(node.content ?? []).map(blockToHtml).join('')}</li>`
    case 'taskList':
      return `<ul class="task-list">${(node.content ?? []).map(blockToHtml).join('')}</ul>`
    case 'taskItem':
      return `<li class="task-item"><input type="checkbox" disabled ${
        node.attrs?.checked ? 'checked' : ''
      } /><div>${(node.content ?? []).map(blockToHtml).join('')}</div></li>`
    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map(blockToHtml).join('')}</blockquote>`
    case 'codeBlock':
      return `<pre><code>${escapeHtml(
        (node.content ?? []).map((c) => c.text ?? '').join(''),
      )}</code></pre>`
    case 'horizontalRule':
      return '<hr />'
    case 'table':
      return `<table>${(node.content ?? []).map(blockToHtml).join('')}</table>`
    case 'tableRow':
      return `<tr>${(node.content ?? []).map(blockToHtml).join('')}</tr>`
    case 'tableHeader':
    case 'tableCell': {
      const tag = node.type === 'tableHeader' ? 'th' : 'td'
      const cs = Number(node.attrs?.colspan ?? 1)
      const rs = Number(node.attrs?.rowspan ?? 1)
      const attrs =
        (cs > 1 ? ` colspan="${cs}"` : '') + (rs > 1 ? ` rowspan="${rs}"` : '')
      return `<${tag}${attrs}>${(node.content ?? []).map(blockToHtml).join('')}</${tag}>`
    }
    case 'image':
      return `<p><img src="${escapeHtml(String(node.attrs?.src ?? ''))}" /></p>`
    case 'mermaid': {
      const src = escapeHtml(String(node.attrs?.code ?? ''))
      return `<div class="mermaid-block" data-code="${src}"><pre class="mermaid-src">${src}</pre></div>`
    }
    default:
      if (node.content) return node.content.map(blockToHtml).join('')
      return escapeHtml(node.text ?? '')
  }
}

export interface HtmlStyle {
  font: string
  fontSize: number
  lineHeight: number
  width: number
  codeFont: string
  accent: string
}

function currentStyle(): HtmlStyle {
  const s = loadSettings()
  return {
    font: s.editorFont,
    fontSize: s.editorFontSize,
    lineHeight: s.lineHeight,
    width: s.editorWidth,
    codeFont: s.codeFont,
    accent: s.accent,
  }
}

export function wrapHtmlDoc(title: string, body: string, style?: HtmlStyle): string {
  const st = style ?? currentStyle()
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --accent: ${st.accent}; }
  body {
    margin: 0; padding: 48px 24px 120px;
    font-family: ${st.font};
    font-size: ${st.fontSize}px;
    line-height: ${st.lineHeight};
    color: #1f2329; background: #fff;
  }
  .doc { max-width: ${st.width}px; margin: 0 auto; }
  h1, h2, h3, h4 { line-height: 1.35; margin: 1.2em 0 .5em; }
  h1 { font-size: 1.8em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
  p { margin: .6em 0; }
  a { color: var(--accent); }
  blockquote { margin: .8em 0; padding-left: 1em; border-left: 3px solid #e5e7eb; color: #6b7280; }
  code { font-family: ${st.codeFont}; background: #f0f2f5; border-radius: 4px; padding: 1px 5px; font-size: .9em; }
  pre { background: #f0f2f5; border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #e5e7eb; padding: 8px 10px; vertical-align: top; }
  th { background: #f0f2f5; text-align: left; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.6em 0; }
  ul.task-list { list-style: none; padding-left: .4em; }
  li.task-item { display: flex; gap: 8px; align-items: flex-start; }
  img { max-width: 100%; }
  .mermaid-block { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin: 1em 0; background: #fafbfc; overflow-x: auto; }
  .mermaid-src { white-space: pre; font-family: ${st.codeFont}; font-size: 13px; color: #374151; margin: 0; }
</style>
</head>
<body><div class="doc">${body}</div></body>
</html>`
}

export function noteToHtmlBody(node: FsNode): string {
  const doc = asDoc(node.content)
  const inner = doc ? (doc.content ?? []).map(blockToHtml).join('\n') : ''
  return `<h1>${escapeHtml(node.name)}</h1>\n${inner}`
}

export function noteToHtml(node: FsNode, style?: HtmlStyle): string {
  return wrapHtmlDoc(node.name, noteToHtmlBody(node), style)
}

/* ============================================================
   思维导图
   ============================================================ */

function asMind(content: unknown): MindMapDoc | null {
  if (!content || typeof content !== 'object') return null
  const d = content as MindMapDoc
  return d.root ? d : null
}

export function mindToMarkdown(node: FsNode): string {
  const doc = asMind(node.content)
  if (!doc) return `# ${node.name}\n`
  const lines: string[] = [`# ${node.name}`, '']
  const walk = (n: MindNode, depth: number) => {
    if (depth === 0) {
      lines.push(`## ${n.text || '（空）'}`, '')
    } else {
      lines.push(`${'  '.repeat(depth - 1)}- ${n.text || '（空）'}`)
    }
    n.children.forEach((c) => walk(c, depth + 1))
  }
  walk(doc.root, 0)
  return lines.join('\n') + '\n'
}

export function mindToText(node: FsNode): string {
  const doc = asMind(node.content)
  if (!doc) return `${node.name}\n`
  const lines: string[] = [node.name, '='.repeat(20), '']
  const walk = (n: MindNode, depth: number) => {
    lines.push('  '.repeat(depth) + (n.text || '（空）'))
    n.children.forEach((c) => walk(c, depth + 1))
  }
  walk(doc.root, 0)
  return lines.join('\n') + '\n'
}

export function mindToOpml(node: FsNode): string {
  const doc = asMind(node.content)
  const body = doc ? outlineXml(doc.root, 3) : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeHtml(node.name)}</title>
    <dateModified>${new Date(node.updatedAt).toUTCString()}</dateModified>
  </head>
  <body>
${body}  </body>
</opml>`
}

function outlineXml(n: MindNode, indentSize: number): string {
  const pad = ' '.repeat(indentSize)
  const text = escapeHtml(n.text || '')
  if (!n.children.length) return `${pad}<outline text="${text}" />\n`
  return (
    `${pad}<outline text="${text}">\n` +
    n.children.map((c) => outlineXml(c, indentSize + 2)).join('') +
    `${pad}</outline>\n`
  )
}

/* ---------------- 思维导图 → SVG ---------------- */

const CJK_RE = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/

function measure(text: string, fontSize: number): number {
  let w = 0
  for (const ch of text) w += CJK_RE.test(ch) ? fontSize : fontSize * 0.56
  return w
}

interface ExpNode {
  id: string
  text: string
  depth: number
  x: number
  y: number
  w: number
  children: ExpNode[]
}

/** 导出专用布局：节点宽度按文字自适应，每一层列宽取该层最大值，避免重叠 */
function layoutForExport(root: MindNode, fontSize: number) {
  const padX = 14
  const boxH = fontSize + 16
  const rowGap = 14
  const colGap = 52

  const colW: number[] = []
  const measureDepth = (n: MindNode, d: number) => {
    const w = Math.max(72, measure(n.text || '（空）', fontSize) + padX * 2)
    colW[d] = Math.max(colW[d] ?? 0, w)
    n.children.forEach((c) => measureDepth(c, d + 1))
  }
  measureDepth(root, 0)

  const colX: number[] = []
  let acc = 0
  for (let i = 0; i < colW.length; i++) {
    colX[i] = acc
    acc += colW[i] + colGap
  }

  let cursorY = 0
  const build = (n: MindNode, d: number): ExpNode => {
    const kids = n.children.map((c) => build(c, d + 1))
    let y: number
    if (!kids.length) {
      y = cursorY + boxH / 2
      cursorY += boxH + rowGap
    } else {
      y = (kids[0].y + kids[kids.length - 1].y) / 2
    }
    return {
      id: n.id,
      text: n.text || '（空）',
      depth: d,
      x: colX[d],
      y,
      w: colW[d],
      children: kids,
    }
  }
  const tree = build(root, 0)
  const width = acc - colGap
  const height = Math.max(cursorY - rowGap, boxH)
  return { tree, width, height, boxH }
}

export interface MindSvgOptions {
  accent?: string
  fontFamily?: string
  fontSize?: number
  background?: string
  title?: string
}

export function mindToSvg(node: FsNode, opts: MindSvgOptions = {}): string {
  const doc = asMind(node.content)
  const accent = opts.accent ?? '#2f6df6'
  const fontFamily = opts.fontFamily ?? 'system-ui, "Microsoft YaHei", "PingFang SC", sans-serif'
  const fontSize = opts.fontSize ?? 14
  const bg = opts.background ?? '#ffffff'
  if (!doc) return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`

  const margin = 32
  const titleH = 40
  const { tree, width, height, boxH } = layoutForExport(doc.root, fontSize)
  const totalW = width + margin * 2
  const totalH = height + margin * 2 + titleH

  const edges: string[] = []
  const boxes: string[] = []

  const walk = (n: ExpNode) => {
    const x = n.x + margin
    const y = n.y + margin + titleH
    const isRoot = n.depth === 0
    const fill = isRoot ? accent : '#ffffff'
    const stroke = isRoot ? accent : '#d7dbe2'
    const color = isRoot ? '#ffffff' : '#1f2329'
    const weight = n.depth <= 1 ? 600 : 400
    boxes.push(
      `<rect x="${x}" y="${y - boxH / 2}" width="${n.w}" height="${boxH}" rx="8" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="1.2" />` +
        `<text x="${x + n.w / 2}" y="${y}" fill="${color}" font-size="${fontSize}" ` +
        `font-family='${fontFamily}' font-weight="${weight}" text-anchor="middle" ` +
        `dominant-baseline="central">${escapeHtml(n.text)}</text>`,
    )
    for (const c of n.children) {
      const x1 = x + n.w
      const y1 = y
      const x2 = c.x + margin
      const y2 = c.y + margin + titleH
      const mid = (x2 - x1) / 2
      edges.push(
        `<path d="M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}" ` +
          `fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.5" />`,
      )
      walk(c)
    }
  }
  walk(tree)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
<rect width="100%" height="100%" fill="${bg}" />
<text x="${margin}" y="${margin}" font-family='${fontFamily}' font-size="17" font-weight="600" fill="#1f2329">${escapeHtml(
    opts.title ?? node.name,
  )}</text>
${edges.join('\n')}
${boxes.join('\n')}
</svg>`
}

/** SVG 字符串 → PNG Blob（浏览器内用 canvas 栅格化，默认 2 倍图） */
export function svgToPng(svg: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const wMatch = /width="(\d+(?:\.\d+)?)"/.exec(svg)
    const hMatch = /height="(\d+(?:\.\d+)?)"/.exec(svg)
    const w = Number(wMatch?.[1] ?? 800)
    const h = Number(hMatch?.[1] ?? 600)
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(w * scale)
      canvas.height = Math.ceil(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('无法创建绘图上下文'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 生成失败'))), 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 渲染失败'))
    }
    img.src = url
  })
}

export function timelineToHtml(node: FsNode, opts: MindSvgOptions = {}): string {
  return wrapHtmlDoc(
    node.name,
    `<h1>${escapeHtml(node.name)}</h1>\n<div class="timeline">${timelineToSvg(node, opts)}</div>`,
  )
}

export function mindToHtml(node: FsNode, opts: MindSvgOptions = {}): string {
  return wrapHtmlDoc(
    node.name,
    `<h1>${escapeHtml(node.name)}</h1>\n<div class="mindmap">${mindToSvg(node, opts)}</div>`,
  )
}

/* ============================================================
   时间线（Timeline）—— 竖向树状
   ============================================================ */

function asTimeline(content: unknown): TimelineDoc | null {
  if (!content || typeof content !== 'object') return null
  const d = content as TimelineDoc
  if (!d || !Array.isArray(d.roots)) return null
  return d
}

function asCharacter(content: unknown): CharacterDoc | null {
  if (!content || typeof content !== 'object') return null
  const d = content as CharacterDoc
  if (!d || !Array.isArray(d.items)) return null
  return d
}

export function characterToMarkdown(node: FsNode): string {
  const doc = asCharacter(node.content)
  if (!doc) return `# ${node.name}\n`
  const nameOf = (id: string) => doc.items.find((c) => c.id === id)?.name || '（未知）'
  const lines: string[] = [`# ${node.name}`, '']
  doc.items.forEach((c, i) => {
    if (i > 0) lines.push('', '---', '')
    lines.push(`## ${c.name || '（未命名）'}`, '')
    if (c.tags.length) lines.push(`- 标签：${c.tags.join('、')}`)
    c.attrs.forEach((a) => {
      if (a.name && a.value) lines.push(`- ${a.name}：${a.value}`)
    })
    if (c.bio) lines.push('', c.bio)
  })
  const rels = doc.relations ?? []
  if (rels.length) {
    lines.push('', '### 关系', '')
    rels.forEach((r) => lines.push(`- ${nameOf(r.from)} →（${r.type}）→ ${nameOf(r.to)}`))
  }
  return lines.join('\n') + '\n'
}

export function characterToText(node: FsNode): string {
  const doc = asCharacter(node.content)
  if (!doc) return `${node.name}\n`
  const nameOf = (id: string) => doc.items.find((c) => c.id === id)?.name || '（未知）'
  const lines = [node.name, '='.repeat(20), '']
  doc.items.forEach((c) => {
    lines.push(`【${c.name || '（未命名）'}】`)
    if (c.tags.length) lines.push(`  标签：${c.tags.join('、')}`)
    c.attrs.forEach((a) => {
      if (a.name && a.value) lines.push(`  ${a.name}：${a.value}`)
    })
    if (c.bio) lines.push(`  小传：${c.bio}`)
    lines.push('')
  })
  const rels = doc.relations ?? []
  if (rels.length) {
    lines.push('关系：')
    rels.forEach((r) => lines.push(`  ${nameOf(r.from)} -${r.type}-> ${nameOf(r.to)}`))
  }
  return lines.join('\n') + '\n'
}

/** 展开所有折叠节点（导出时给出完整结构） */
function expandRoots(roots: TimeNode[]): TimeNode[] {
  const fix = (n: TimeNode): TimeNode => ({
    ...n,
    collapsed: false,
    children: n.children.map(fix),
  })
  return roots.map(fix)
}

function asSetting(content: unknown): SettingDoc | null {
  if (!content || typeof content !== 'object') return null
  const d = content as SettingDoc
  if (!d || !Array.isArray(d.entries)) return null
  return d
}

export function settingToMarkdown(node: FsNode): string {
  const doc = asSetting(node.content)
  if (!doc) return `# ${node.name}\n`
  const lines: string[] = [`# ${node.name}`, '']
  doc.categories.forEach((cat, ci) => {
    const items = doc.entries
      .filter((e) => e.category === cat)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    if (ci > 0) lines.push('', '---', '')
    lines.push(`## ${cat}`, '')
    if (items.length === 0) {
      lines.push('（暂无）', '')
      return
    }
    items.forEach((e) => {
      lines.push(`### ${e.name || '（未命名）'}`)
      if (e.desc) lines.push('', e.desc)
      if (e.charIds.length) lines.push('', `- 关联角色：${e.charIds.join('、')}`)
      if (e.plotIds.length) lines.push(`- 关联剧情：${e.plotIds.length} 项`)
      lines.push('')
    })
  })
  return lines.join('\n') + '\n'
}

export function settingToText(node: FsNode): string {
  const doc = asSetting(node.content)
  if (!doc) return `${node.name}\n`
  const lines = [node.name, '='.repeat(20), '']
  doc.categories.forEach((cat) => {
    const items = doc.entries
      .filter((e) => e.category === cat)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    lines.push(`【${cat}】`)
    if (!items.length) {
      lines.push('  暂无', '')
      return
    }
    items.forEach((e) => {
      lines.push(`  · ${e.name || '（未命名）'}`)
      if (e.desc) lines.push(`    ${e.desc.replace(/\n+/g, '\n    ')}`)
      if (e.charIds.length) lines.push(`    角色：${e.charIds.join(' ')}`)
      if (e.plotIds.length) lines.push(`    剧情：${e.plotIds.length}`)
    })
    lines.push('')
  })
  return lines.join('\n') + '\n'
}

/* ============================================================
   地图（Map）
   ============================================================ */

function asMap(content: unknown): MapDoc | null {
  if (!content || typeof content !== 'object') return null
  const d = content as MapDoc
  if (!d || !Array.isArray(d.floors)) return null
  return d
}

export function mapToMarkdown(node: FsNode): string {
  const doc = asMap(node.content)
  if (!doc) return `# ${node.name}\n`
  const allLocs = doc.floors.flatMap((f) => f.locations)
  const nameOf = (id: string) => allLocs.find((l) => l.id === id)?.name || '？'
  const lines = [`# ${node.name}`, '']
  if (allLocs.length === 0) {
    lines.push('（暂无地点）', '')
  }
  doc.floors.forEach((f) => {
    lines.push(`## ${f.name}`, '')
    if (f.locations.length === 0) lines.push('（本层暂无地点）', '')
    f.locations.forEach((l) => {
      lines.push(`### ${l.name || '（未命名）'}`)
      if (l.desc) lines.push(l.desc.replace(/\n+/g, '\n\n').trim(), '')
    })
    if (f.edges.length) {
      lines.push('路线：')
      f.edges.forEach((e) => lines.push(`- ${nameOf(e.from)} → ${nameOf(e.to)}${e.label ? `（${e.label}）` : ''}`))
      lines.push('')
    }
  })
  const links = doc.links ?? []
  if (links.length) {
    lines.push('## 跨层连接', '')
    links.forEach((l) => lines.push(`- ${nameOf(l.from)} ⇅ ${nameOf(l.to)}${l.label ? `（${l.label}）` : ''}`))
    lines.push('')
  }
  return lines.join('\n') + '\n'
}

export function mapToText(node: FsNode): string {
  const doc = asMap(node.content)
  if (!doc) return `${node.name}\n`
  const allLocs = doc.floors.flatMap((f) => f.locations)
  const nameOf = (id: string) => allLocs.find((l) => l.id === id)?.name || '？'
  const lines = [node.name, '='.repeat(20), '']
  if (allLocs.length === 0) lines.push('（暂无地点）')
  doc.floors.forEach((f) => {
    lines.push('', `【${f.name}】`)
    if (f.locations.length === 0) lines.push('（本层暂无地点）')
    f.locations.forEach((l) => {
      lines.push(`  · ${l.name || '（未命名）'}`)
      if (l.desc) lines.push('    ' + l.desc.replace(/\n+/g, '\n    '))
    })
    if (f.edges.length) {
      lines.push('  路线：')
      f.edges.forEach((e) => lines.push(`    - ${nameOf(e.from)} -> ${nameOf(e.to)}${e.label ? `（${e.label}）` : ''}`))
    }
  })
  const links = doc.links ?? []
  if (links.length) {
    lines.push('', '跨层连接：')
    links.forEach((l) => lines.push(`  · ${nameOf(l.from)} ⇅ ${nameOf(l.to)}${l.label ? `（${l.label}）` : ''}`))
  }
  return lines.join('\n') + '\n'
}

export function timelineToMarkdown(node: FsNode): string {
  const doc = asTimeline(node.content)
  if (!doc) return `# ${node.name}\n`
  const lines: string[] = [`# ${node.name}`, '']
  let first = true
  const walk = (n: TimeNode, depth: number) => {
    if (depth === 0) {
      if (!first) lines.push('', '---', '')
      first = false
      lines.push(`## ${n.text || '（空）'}`, '')
    } else {
      lines.push(`${'  '.repeat(depth - 1)}- ${n.text || '（空）'}`)
    }
    n.children.forEach((c) => walk(c, depth + 1))
  }
  doc.roots.forEach((r) => walk(r, 0))
  const links = doc.links ?? []
  if (links.length) {
    const nameOf = (id: string): string => {
      let t = ''
      const find = (n: TimeNode) => {
        if (n.id === id) t = n.text
        else n.children.forEach(find)
      }
      doc.roots.forEach(find)
      return t || '（空）'
    }
    lines.push('', '### 相交连线', '')
    links.forEach((l) => lines.push(`- ${nameOf(l.from)} → ${nameOf(l.to)}`))
  }
  return lines.join('\n') + '\n'
}

export function timelineToText(node: FsNode): string {
  const doc = asTimeline(node.content)
  if (!doc) return `${node.name}\n`
  const lines = [node.name, '='.repeat(20), '']
  const walk = (n: TimeNode, depth: number) => {
    lines.push('  '.repeat(depth) + (n.text || '（空）'))
    n.children.forEach((c) => walk(c, depth + 1))
  }
  doc.roots.forEach((r) => walk(r, 0))
  const links = doc.links ?? []
  if (links.length) {
    const nameOf = (id: string): string => {
      let t = ''
      const find = (n: TimeNode) => {
        if (n.id === id) t = n.text
        else n.children.forEach(find)
      }
      doc.roots.forEach(find)
      return t || '（空）'
    }
    lines.push('', '相交连线：')
    links.forEach((l) => lines.push(`  ${nameOf(l.from)} -> ${nameOf(l.to)}`))
  }
  return lines.join('\n') + '\n'
}

/** 两个节点框（左上角坐标 px,py / cx,cy）之间的连线：同列→竖向，异列→横向 */
function tlEdge(px: number, py: number, cx: number, cy: number, accent: string): string {
  const W = TL_NODE_W
  const H = TL_NODE_H
  if (Math.abs(px - cx) < 1) {
    const x1 = px + W / 2
    const y1 = py + H
    const x2 = cx + W / 2
    const y2 = cy
    const dy = Math.max(20, (y2 - y1) / 2)
    return `<path d="M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.55" />`
  }
  const x1 = px + W
  const y1 = py + H / 2
  const x2 = cx
  const y2 = cy + H / 2
  const dx = Math.max(20, (x2 - x1) / 2)
  return `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.55" />`
}

export function timelineToSvg(node: FsNode, opts: MindSvgOptions = {}): string {
  const doc = asTimeline(node.content)
  const accent = opts.accent ?? '#2f6df6'
  const fontFamily = opts.fontFamily ?? 'system-ui, "Microsoft YaHei", "PingFang SC", sans-serif'
  const fontSize = opts.fontSize ?? 14
  const bg = opts.background ?? '#ffffff'
  if (!doc || doc.roots.length === 0)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`

  const roots = expandRoots(doc.roots)
  const { pos, width, height } = layoutTimelines(roots)
  const margin = 36
  const titleH = 40

  const edges: string[] = []
  const boxes: string[] = []

  const walk = (n: TimeNode) => {
    const p = pos[n.id]
    if (!p) return
    const x = p.x + margin
    const y = p.y + margin + titleH
    const isRoot = roots.some((r) => r.id === n.id)
    const fill = isRoot ? accent : '#ffffff'
    const stroke = isRoot ? accent : '#d7dbe2'
    const color = isRoot ? '#ffffff' : '#1f2329'
    const weight = isRoot ? 600 : 400
    boxes.push(
      `<rect x="${x}" y="${y}" width="${TL_NODE_W}" height="${TL_NODE_H}" rx="8" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="1.2" />` +
        `<text x="${x + TL_NODE_W / 2}" y="${y + TL_NODE_H / 2}" fill="${color}" font-size="${fontSize}" ` +
        `font-family='${fontFamily}' font-weight="${weight}" text-anchor="middle" ` +
        `dominant-baseline="central">${escapeHtml(n.text?.trim() || '（空）')}</text>`,
    )
    if (!n.collapsed && n.children.length) {
      const fp = pos[n.children[0].id]
      if (fp) edges.push(tlEdge(x, y, fp.x + margin, fp.y + margin + titleH, accent))
      for (let i = 0; i < n.children.length - 1; i++) {
        const a = pos[n.children[i].id]
        const b = pos[n.children[i + 1].id]
        if (a && b) edges.push(tlEdge(a.x + margin, a.y + margin + titleH, b.x + margin, b.y + margin + titleH, accent))
      }
      n.children.forEach((c) => walk(c))
    }
  }
  roots.forEach(walk)

  /* 跨时间线相交连线（拖动产生）：以橙色虚线连接两条时间线，不改动树结构 */
  for (const l of doc.links ?? []) {
    const from = pos[l.from]
    const to = pos[l.to]
    if (from && to)
      edges.push(tlEdge(from.x + margin, from.y + margin + titleH, to.x + margin, to.y + margin + titleH, '#e0862e'))
  }

  const totalW = width + margin * 2
  const totalH = height + margin * 2 + titleH

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
<rect width="100%" height="100%" fill="${bg}" />
<text x="${margin}" y="${margin}" font-family='${fontFamily}' font-size="17" font-weight="600" fill="#1f2329">${escapeHtml(
    opts.title ?? node.name,
  )}</text>
${edges.join('\n')}
${boxes.join('\n')}
</svg>`
}


/* ============================================================
   统一入口
   ============================================================ */

export interface RenderResult {
  /** 不含扩展名 */
  baseName: string
  ext: string
  mime: string
  /** 文本内容；二进制格式为 null */
  text: string | null
  blob: Blob | null
}

const MIME: Record<ExportKind, string> = {
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
  opml: 'text/x-opml;charset=utf-8',
  svg: 'image/svg+xml;charset=utf-8',
  png: 'image/png',
  epub: 'application/epub+zip',
}

/** 把单个节点渲染成目标格式 */
export async function renderNode(
  node: FsNode,
  kind: ExportKind,
  opts: MindSvgOptions = {},
): Promise<RenderResult> {
  const baseName = sanitizeName(node.name)
  const mk = (text: string): RenderResult => ({
    baseName,
    ext: FORMAT_EXT[kind],
    mime: MIME[kind],
    text,
    blob: null,
  })

  if (kind === 'json') return mk(JSON.stringify(node, null, 2))

  if (node.type === 'note') {
    if (kind === 'md') return mk(noteToMarkdown(node))
    if (kind === 'txt') return mk(noteToText(node))
    if (kind === 'html') return mk(noteToHtml(node))
    // 笔记不支持的格式退化为 Markdown
    return {
      baseName,
      ext: 'md',
      mime: MIME.md,
      text: noteToMarkdown(node),
      blob: null,
    }
  }

  if (node.type === 'mindmap') {
    if (kind === 'md') return mk(mindToMarkdown(node))
    if (kind === 'txt') return mk(mindToText(node))
    if (kind === 'opml') return mk(mindToOpml(node))
    if (kind === 'svg') return mk(mindToSvg(node, opts))
    if (kind === 'html') return mk(mindToHtml(node, opts))
    if (kind === 'png') {
      const blob = await svgToPng(mindToSvg(node, opts))
      return { baseName, ext: 'png', mime: MIME.png, text: null, blob }
    }
    return mk(mindToMarkdown(node))
  }

  if (node.type === 'timeline') {
    if (kind === 'md') return mk(timelineToMarkdown(node))
    if (kind === 'txt') return mk(timelineToText(node))
    if (kind === 'svg') return mk(timelineToSvg(node, opts))
    if (kind === 'html') return mk(timelineToHtml(node, opts))
    if (kind === 'png') {
      const blob = await svgToPng(timelineToSvg(node, opts))
      return { baseName, ext: 'png', mime: MIME.png, text: null, blob }
    }
    return mk(timelineToMarkdown(node))
  }

  if (node.type === 'character') {
    if (kind === 'md') return mk(characterToMarkdown(node))
    if (kind === 'txt') return mk(characterToText(node))
    return mk(characterToMarkdown(node))
  }

  if (node.type === 'plot') {
    if (kind === 'md') return mk(plotToMarkdown(node))
    if (kind === 'txt') return mk(plotToText(node))
    return mk(plotToMarkdown(node))
  }

  if (node.type === 'setting') {
    if (kind === 'md') return mk(settingToMarkdown(node))
    if (kind === 'txt') return mk(settingToText(node))
    return mk(settingToMarkdown(node))
  }

  if (node.type === 'map') {
    if (kind === 'md') return mk(mapToMarkdown(node))
    if (kind === 'txt') return mk(mapToText(node))
    return mk(mapToMarkdown(node))
  }

  return mk('')
}


function asPlot(content: unknown): PlotDoc | null {
  if (!content || typeof content !== 'object') return null
  const d = content as PlotDoc
  if (!d || !Array.isArray(d.items)) return null
  return d
}

export function plotToMarkdown(node: FsNode): string {
  const doc = asPlot(node.content)
  if (!doc) return `# ${node.name}\n`
  const lines: string[] = [`# ${node.name}（${PLOT_MODE_LABEL[doc.mode]}）`, '']
  appendPlotBody(lines, doc, false)
  return lines.join('\n') + '\n'
}

export function plotToText(node: FsNode): string {
  const doc = asPlot(node.content)
  if (!doc) return `${node.name}\n`
  const lines = [node.name, '='.repeat(20), '']
  appendPlotBody(lines, doc, true)
  return lines.join('\n') + '\n'
}

/** 按剧情模式把内容追加进 lines（md / txt 共用，asText 控制要点符号） */
function appendPlotBody(lines: string[], doc: PlotDoc, asText: boolean): void {
  const layout = layoutPlot(doc.items)
  const itemOf = (id: string) => doc.items.find((x) => x.id === id)
  const bullet = (it: PlotItem, indent: string, label: number | undefined) => {
    const prefix = asText ? '·' : '-'
    const tag = label != null ? `${label}. ` : ''
    lines.push(`${indent}${prefix} ${tag}${it.title || '（未命名）'}`)
    if (it.summary) lines.push(`${indent}  ${it.summary}`)
    if (it.charIds.length) lines.push(`${indent}  角色：${it.charIds.join('、')}`)
    if (it.foreshadowIds.length) lines.push(`${indent}  伏笔：${it.foreshadowIds.join('、')}`)
  }

  if (doc.mode === 'graph') {
    // 关系图：按派生标号平铺，并列出因果连线
    doc.items.forEach((it) => bullet(it, '', layout.label.get(it.id)))
    const edges = doc.edges ?? []
    if (edges.length) {
      const nameOf = (id: string) => doc.items.find((x) => x.id === id)?.title || '？'
      lines.push('', '因果连线：')
      edges.forEach((e) => lines.push(`- ${nameOf(e.from)} → ${nameOf(e.to)}${e.label ? `（${e.label}）` : ''}`))
    }
  } else {
    // board / outline / timeline 统一按派生标号的前序（故事顺序）输出
    layout.order.forEach((id) => {
      const it = itemOf(id)
      if (!it) return
      const d = layout.depth.get(id) ?? 0
      bullet(it, '  '.repeat(d), layout.label.get(id))
    })
  }
}
