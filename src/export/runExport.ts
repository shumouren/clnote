/**
 * 导出执行器：单个导出 / 批量导出（可保留目录结构、打包 ZIP、合并成单文件）
 */
import JSZip from 'jszip'
import type { FsNode } from '../model/types'
import { listNodes } from '../storage/fs'
import {
  renderNode,
  sanitizeName,
  wrapHtmlDoc,
  noteToHtmlBody,
  mindToSvg,
  timelineToSvg,
  characterToMarkdown,
  plotToMarkdown,
  settingToMarkdown,
  mapToMarkdown,
  BINARY_FORMATS,
  FORMAT_EXT,
  type ExportKind,
} from './exporters'
import { notesToEpub } from './epub'
import {
  saveBlobWithDialog,
  saveTextWithDialog,
  downloadBlob,
  downloadText,
  dateStamp,
  timestamp,
} from './download'

export interface BatchOptions {
  kind: ExportKind
  /** 保留文件夹层级（zip 内建目录 / 合并时用作标题层级） */
  keepTree: boolean
  /** 打包成一个 zip */
  zip: boolean
  /** 合并成单个文件（与 zip 互斥） */
  merge: boolean
  namePrefix: 'none' | 'index' | 'date'
  accent: string
  /** EPUB 书名（批量导出时默认取顶层文件夹名） */
  bookTitle?: string
  /** EPUB 作者 */
  author?: string
}

export interface BatchResult {
  count: number
  filename: string
  skipped: number
  /** 桌面端用户经「另存为」选定的绝对路径；null 表示退回下载文件夹 */
  savedPath?: string | null
}

/**
 * 统一落盘：桌面端弹「另存为」对话框写精确路径，非桌面端退回 a[download] 下载。
 * 返回用户选定的绝对路径；取消 / 失败退回下载时返回 null。
 */
async function saveOutput(
  filename: string,
  opts: { blob?: Blob; text?: string; mime?: string },
): Promise<string | null> {
  if (opts.blob) return saveBlobWithDialog(filename, opts.blob)
  return saveTextWithDialog(filename, opts.text ?? '', opts.mime ?? 'text/plain;charset=utf-8')
}

/* ---------------- 单个导出 ---------------- */

export async function exportSingle(
  node: FsNode,
  kind: ExportKind,
  accent = '#2f6df6',
  bookTitle?: string,
  author?: string,
): Promise<{ filename: string; path: string | null }> {
  // 从存储读最新内容，避免用到列表里的旧快照；并解析引用（refId → 真正内容）
  const all = await listNodes()
  const byId = new Map(all.map((n) => [n.id, n]))
  const fresh = byId.get(node.id) ?? node

  // EPUB：单节点导出（仅文本笔记有意义）
  if (kind === 'epub') {
    if (fresh.type !== 'note') throw new Error('EPUB 仅支持文本笔记')
    const blob = await notesToEpub([resolveRef(fresh, byId)], {
      bookTitle: bookTitle || fresh.name || '我的手稿',
      author: author || '',
      accent,
      volumePaths: [epubVolumePath(fresh, byId)],
    })
    const fn = `${sanitizeName(fresh.name)}.epub`
    const path = await saveOutput(fn, { blob })
    return { filename: fn, path }
  }

  const r = await renderNode(resolveRef(fresh, byId), kind, { accent })
  const filename = `${r.baseName}.${r.ext}`
  const path = await saveOutput(filename, r.blob ? { blob: r.blob } : { text: r.text ?? '', mime: r.mime })
  return { filename, path }
}

/* ---------------- 批量导出 ---------------- */

function buildPath(node: FsNode, byId: Map<string, FsNode>): string[] {
  const parts: string[] = []
  let cur = node.parentId
  let guard = 0
  while (cur && guard++ < 64) {
    const p = byId.get(cur)
    if (!p) break
    parts.unshift(sanitizeName(p.name))
    cur = p.parentId
  }
  return parts
}

function depthOf(node: FsNode, byId: Map<string, FsNode>): number {
  let d = 0
  let cur = node.parentId
  let guard = 0
  while (cur && guard++ < 64) {
    d++
    cur = byId.get(cur)?.parentId ?? null
  }
  return d
}

/** 节点的树形坐标：从根到自身各级的 order 序列，即文件树「从上到下」的展示顺序 */
function treeIndex(node: FsNode, byId: Map<string, FsNode>): number[] {
  const idx: number[] = []
  let cur: FsNode | undefined = node
  let guard = 0
  while (cur && guard++ < 64) {
    idx.unshift(cur.order ?? 0)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return idx
}

/** 按文件树层级顺序比较两个节点：先比根序、再逐级比子序，与侧边栏展示的上下顺序一致 */
function compareTreeOrder(a: FsNode, b: FsNode, byId: Map<string, FsNode>): number {
  const ia = treeIndex(a, byId)
  const ib = treeIndex(b, byId)
  const len = Math.max(ia.length, ib.length)
  for (let i = 0; i < len; i++) {
    const va = ia[i] ?? -1
    const vb = ib[i] ?? -1
    if (va !== vb) return va - vb
  }
  return 0
}

/** 从根到父级的全部祖先文件夹原始名（用于给章节标题拼卷名等层级） */
function rawAncestorNames(node: FsNode, byId: Map<string, FsNode>): string[] {
  const parts: string[] = []
  let cur = node.parentId
  let guard = 0
  while (cur && guard++ < 64) {
    const p = byId.get(cur)
    if (!p) break
    parts.unshift(p.name)
    cur = p.parentId
  }
  return parts
}

/** EPUB 章节所属的卷路径（祖先文件夹名，不含最顶层书名文件夹）；无卷时为空数组 */
function epubVolumePath(node: FsNode, byId: Map<string, FsNode>): string[] {
  return rawAncestorNames(node, byId).slice(1)
}

/**
 * 导出时解析"引用"节点：若本节点是对另一节点的引用（refId 非空），
 * 则用被引用节点的 content 替换（保留本节点名称），使导出的是真正的导图内容。
 * 被引用节点不存在（悬空）时原样返回。
 */
function resolveRef(node: FsNode, byId: Map<string, FsNode>): FsNode {
  if (node.refId) {
    const t = byId.get(node.refId)
    if (t) return { ...node, content: t.content }
  }
  return node
}

/** 同名文件自动加 (2)(3) 后缀 */
function uniquePath(used: Set<string>, path: string): string {
  if (!used.has(path)) {
    used.add(path)
    return path
  }
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  const ext = dot > 0 ? path.slice(dot) : ''
  let i = 2
  let candidate = `${stem} (${i})${ext}`
  while (used.has(candidate)) {
    i++
    candidate = `${stem} (${i})${ext}`
  }
  used.add(candidate)
  return candidate
}

export async function exportBatch(
  ids: string[],
  opts: BatchOptions,
): Promise<BatchResult> {
  const all = await listNodes()
  const byId = new Map(all.map((n) => [n.id, n]))
  const order = new Map(all.map((n, i) => [n.id, i]))

  // 只导出文件；文件夹只用于构造路径。按文件树的「从上到下」顺序排列
  const targets = ids
    .map((id) => byId.get(id))
    .filter((n): n is FsNode => !!n && n.type !== 'folder')
    .sort(
      (a, b) =>
        compareTreeOrder(a, b, byId) ||
        (order.get(a.id)! - order.get(b.id)!),
    )

  if (!targets.length) throw new Error('没有可导出的文件（文件夹本身不产生文件）')

  // EPUB：把手稿（文本笔记）按当前顺序拼成一本电子书（自成一档，不参与合并/ZIP）
  if (opts.kind === 'epub') {
    // 只收真正的章节正文；「伏笔展示」这类界面节点不参与成书
    const notes = targets.filter((n) => n.type === 'note' && n.kind !== 'foreshow')
    if (notes.length === 0) throw new Error('EPUB 导出需要至少选择一篇文本笔记')
    const path0 = buildPath(notes[0], byId)
    const bookTitle = opts.bookTitle || (path0.length ? path0[0] : notes[0].name) || '我的手稿'
    const blob = await notesToEpub(
      notes.map((n) => resolveRef(n, byId)),
      {
        bookTitle,
        author: opts.author || '',
        accent: opts.accent,
        // 每章所属卷路径：正文会为每卷首章前插入卷名页
        volumePaths: notes.map((n) => epubVolumePath(n, byId)),
      },
    )
    const fn = `手稿-${timestamp()}.epub`
    const savedPath = await saveOutput(fn, { blob })
    return { count: notes.length, filename: fn, savedPath, skipped: 0 }
  }

  const isBinary = BINARY_FORMATS.includes(opts.kind)
  const stamp = dateStamp()

  const prefixOf = (i: number) => {
    if (opts.namePrefix === 'index') return `${String(i + 1).padStart(2, '0')}-`
    if (opts.namePrefix === 'date') return `${stamp}-`
    return ''
  }

  /* ---- 合并成单文件 ---- */
  if (opts.merge && !isBinary) {
    if (opts.kind === 'json') {
      const payload = {
        app: 'clnote',
        exportedAt: new Date().toISOString(),
        nodes: targets,
      }
      const filename = `笔记合集-${timestamp()}.json`
      const savedPath = await saveOutput(filename, {
        text: JSON.stringify(payload, null, 2),
        mime: 'application/json;charset=utf-8',
      })
      return { count: targets.length, filename, savedPath, skipped: 0 }
    }

    if (opts.kind === 'html') {
      // 开启「保留文件夹层级」时，章节标题带上卷名等祖先文件夹（如 第一卷 / 第一章）
      const heading = (n: FsNode): string => {
        const dirs = opts.keepTree ? buildPath(n, byId) : []
        return dirs.length ? `${dirs.join(' / ')} / ${n.name}` : n.name
      }
      const body = targets
        .map((n) => {
          const h = heading(n)
          if (n.type === 'mindmap')
            return `<section><h1>${h}</h1>${mindToSvg(resolveRef(n, byId), {
              accent: opts.accent,
            })}</section>`
          if (n.type === 'timeline')
            return `<section><h1>${h}</h1>${timelineToSvg(resolveRef(n, byId), {
              accent: opts.accent,
            })}</section>`
          if (n.type === 'character')
            return `<section><h1>${h}</h1><div class="character">${characterToMarkdown(
              resolveRef(n, byId),
            )}</div></section>`
          if (n.type === 'plot')
            return `<section><h1>${h}</h1><div class="plot">${plotToMarkdown(
              resolveRef(n, byId),
            )}</div></section>`
          if (n.type === 'setting')
            return `<section><h1>${h}</h1><div class="setting">${settingToMarkdown(
              resolveRef(n, byId),
            )}</div></section>`
          if (n.type === 'map')
            return `<section><h1>${h}</h1><div class="map">${mapToMarkdown(
              resolveRef(n, byId),
            )}</div></section>`
          return `<section>${noteToHtmlBody(n)}</section>`
        })
        .join('\n<hr />\n')
      const filename = `笔记合集-${timestamp()}.html`
      const savedPath = await saveOutput(filename, {
        text: wrapHtmlDoc('笔记合集', body),
        mime: 'text/html;charset=utf-8',
      })
      return { count: targets.length, filename, savedPath, skipped: 0 }
    }

    const chunks: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const n = targets[i]
      const r = await renderNode(resolveRef(n, byId), opts.kind, { accent: opts.accent })
      let text = r.text ?? ''
      if (opts.keepTree) {
        const path = buildPath(n, byId)
        if (path.length && opts.kind === 'md') {
          text = `> 位置：${path.join(' / ')}\n\n${text}`
        } else if (path.length) {
          text = `[${path.join(' / ')}]\n${text}`
        }
      }
      chunks.push(text.trim())
    }
    const sep = opts.kind === 'md' ? '\n\n---\n\n' : '\n\n────────────────\n\n'
    const filename = `笔记合集-${timestamp()}.${FORMAT_EXT[opts.kind]}`
    const savedPath = await saveOutput(
      filename,
      {
        text: chunks.join(sep) + '\n',
        mime: opts.kind === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8',
      },
    )
    return { count: targets.length, filename, savedPath, skipped: 0 }
  }

  /* ---- 单个文件：直接下载，不打包 ---- */
  if (targets.length === 1 && !opts.zip) {
    const r = await exportSingle(
      targets[0],
      opts.kind,
      opts.accent,
      opts.bookTitle,
      opts.author,
    )
    return { count: 1, filename: r.filename, savedPath: r.path, skipped: 0 }
  }

  /* ---- 多文件：ZIP ---- */
  if (opts.zip) {
    const zip = new JSZip()
    const used = new Set<string>()
    let skipped = 0
    for (let i = 0; i < targets.length; i++) {
      const n = targets[i]
      try {
        const r = await renderNode(resolveRef(n, byId), opts.kind, { accent: opts.accent })
        const dir = opts.keepTree ? buildPath(n, byId) : []
        const path = uniquePath(
          used,
          [...dir, `${prefixOf(i)}${r.baseName}.${r.ext}`].join('/'),
        )
        if (r.blob) zip.file(path, r.blob)
        else zip.file(path, r.text ?? '')
      } catch {
        skipped++
      }
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
    const filename = `笔记导出-${timestamp()}.zip`
    const savedPath = await saveOutput(filename, { blob })
    return { count: targets.length - skipped, filename, savedPath, skipped }
  }

  /* ---- 多文件且不打包：逐个触发下载 ---- */
  let ok = 0
  let skipped = 0
  for (let i = 0; i < targets.length; i++) {
    try {
    const r = await renderNode(resolveRef(targets[i], byId), opts.kind, { accent: opts.accent })
    const filename = `${prefixOf(i)}${r.baseName}.${r.ext}`
      if (r.blob) downloadBlob(filename, r.blob)
      else downloadText(filename, r.text ?? '', r.mime)
      ok++
      // 浏览器对连续下载有节流，稍微错开
      await new Promise((res) => window.setTimeout(res, 180))
    } catch {
      skipped++
    }
  }
  return { count: ok, filename: `${ok} 个文件`, skipped }
}

/** 供 UI 计算"当前选择会导出多少个文件" */
export function countExportable(ids: string[], all: FsNode[]): number {
  const byId = new Map(all.map((n) => [n.id, n]))
  return ids.filter((id) => byId.get(id)?.type !== 'folder' && byId.has(id)).length
}

export { depthOf }
