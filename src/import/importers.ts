/**
 * 导入编排
 * ---------------------------------------------------------------
 * 识别文件类型并把内容解析成 FsNode[]：
 *   .json / .clnote  → 整库备份（app==='ccc-notes' / 'clnote-backup'） 或 单/多个节点数据
 *   .clnote 是整库备份的专属扩展名（特殊格式迁移文件，本质为 JSON），便于在设备间搬运
 *   .md    → 文本笔记（Markdown → TipTap JSON）
 *   .txt   → 文本笔记（纯文本 → TipTap JSON）
 *   .html  → 文本笔记（HTML → TipTap JSON）
 *   .opml  → 思维导图（OPML → MindMapDoc）
 * 解析结果是"原始节点"，id 为临时值；真正写入时由 store 重映射并落库。
 */
import type { FsNode, NodeType } from '../model/types'
import { newId } from '../model/types'
import { sanitizeName } from '../export/exporters'
import { markdownToTipTap, firstHeading } from './markdown'
import { htmlToTipTap, htmlTitle } from './html'
import { textToTipTap } from './text'
import { opmlToMindMap } from './opml'

export type ImportKind = 'backup' | 'node-json' | 'markdown' | 'text' | 'html' | 'opml'

export interface ParsedImport {
  kind: ImportKind
  summary: string
  nodes: FsNode[]
}

export interface ImportPreview {
  name: string
  kind: ImportKind
  /** 将生成的节点类型 */
  nodeType: NodeType
  nodeCount: number
  summary: string
}

const KIND_LABEL: Record<ImportKind, string> = {
  backup: '整库备份',
  'node-json': '节点数据',
  markdown: 'Markdown',
  text: '纯文本',
  html: 'HTML 网页',
  opml: 'OPML 导图',
}

export function kindLabel(k: ImportKind): string {
  return KIND_LABEL[k]
}

function isFsNodeLike(o: unknown): o is FsNode {
  if (!o || typeof o !== 'object') return false
  const n = o as Record<string, unknown>
  return (
    (n.type === 'folder' || n.type === 'note' || n.type === 'mindmap') &&
    typeof n.name === 'string' &&
    'content' in n
  )
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function makeNode(type: NodeType, name: string, content: unknown): FsNode {
  const now = Date.now()
  return {
    id: newId(),
    type,
    name: sanitizeName(name),
    parentId: null,
    content,
    text: '',
    order: 0,
    updatedAt: now,
    createdAt: now,
  }
}

export function parseImportFile(name: string, text: string): ParsedImport {
  const lower = name.toLowerCase()
  const base = stripExt(name)

  if (lower.endsWith('.json') || lower.endsWith('.clnote')) {
    try {
      const data = JSON.parse(text)
      // 整库备份：兼容旧版 'ccc-notes' 与当前 'clnote-backup'（.clnote 专属格式本质也是它）
      // （注意：合并导出的笔记合集 app 为 'clnote'，会被下面的 node-json 分支当作普通节点导入，不会误判为整库备份）
      if (
        data &&
        (data.app === 'ccc-notes' || data.app === 'clnote-backup') &&
        Array.isArray(data.nodes)
      ) {
        const extra =
          (Array.isArray(data.assets) ? data.assets.length : 0) +
          (Array.isArray(data.shortcuts) ? data.shortcuts.length : 0)
        return {
          kind: 'backup',
          summary:
            extra > 0
              ? `整库备份 · ${data.nodes.length} 个文件树节点 + 素材/快捷`
              : `整库备份 · ${data.nodes.length} 个节点`,
          nodes: data.nodes as FsNode[],
        }
      }
      const arr = Array.isArray(data) ? data : [data]
      if (arr.length && arr.every(isFsNodeLike)) {
        return {
          kind: 'node-json',
          summary: `节点数据 · ${arr.length} 个`,
          nodes: arr as FsNode[],
        }
      }
    } catch {
      /* 非法 JSON：降级为纯文本 */
    }
    return {
      kind: 'text',
      summary: '文本（JSON 解析失败）',
      nodes: [makeNode('note', base, textToTipTap(text))],
    }
  }

  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const title = firstHeading(text) || base
    return {
      kind: 'markdown',
      summary: 'Markdown 文本',
      nodes: [makeNode('note', title, markdownToTipTap(text))],
    }
  }

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const title = htmlTitle(text) || base
    return {
      kind: 'html',
      summary: 'HTML 网页',
      nodes: [makeNode('note', title, htmlToTipTap(text))],
    }
  }

  if (lower.endsWith('.opml')) {
    return {
      kind: 'opml',
      summary: 'OPML 思维导图',
      nodes: [makeNode('mindmap', base, opmlToMindMap(text, base))],
    }
  }

  // 默认按纯文本
  return {
    kind: 'text',
    summary: '纯文本',
    nodes: [makeNode('note', base, textToTipTap(text))],
  }
}

/** 把解析结果整理成对话框预览信息 */
export function toPreview(name: string, parsed: ParsedImport): ImportPreview {
  const first = parsed.nodes[0]
  const nodeType: NodeType = first ? first.type : 'note'
  return {
    name,
    kind: parsed.kind,
    nodeType,
    nodeCount: parsed.nodes.length,
    summary: parsed.summary,
  }
}
