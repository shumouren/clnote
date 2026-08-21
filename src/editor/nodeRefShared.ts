import type { Editor } from '@tiptap/react'
import type { FsNode } from '../model/types'

/** 引用目标的类型图标（与文件树 ICON 保持一致） */
export const NODE_REF_ICON: Record<string, string> = {
  folder: '📁',
  note: '📄',
  mindmap: '🧠',
  board: '📋',
  timeline: '⏳',
  character: '🧑',
  plot: '🎬',
  setting: '🌐',
  map: '🗺️',
}

/** 引用目标的类型中文名 */
export const NODE_REF_LABEL: Record<string, string> = {
  folder: '文件夹',
  note: '文本',
  mindmap: '思维导图',
  board: '任务看板',
  timeline: '时间线',
  character: '角色',
  plot: '剧情',
  setting: '设定',
  map: '地图',
}

/** 引用选择器里节点的展示顺序（创作库类型优先） */
export const NODE_REF_ORDER = [
  'character',
  'plot',
  'setting',
  'map',
  'timeline',
  'note',
  'mindmap',
  'board',
]

export interface MentionState {
  active: boolean
  query: string
  /** '@' 字符所在文档位置 */
  from: number
  /** 光标位置（query 之后） */
  to: number
}

export interface RefTarget {
  id: string
  type: string
  name: string
  /** 精确到看板/角色/剧情/设定内的某张卡片（卡片级引用时填写） */
  cardId?: string | null
  /** 该节点是否为「可下钻卡片集合」（@ 选择器里显示 ▸ 提示可进一步选卡片） */
  hasCards?: boolean
}

/**
 * 检测光标前的 @ 提及触发。
 * 规则：'@' 之后跟 0~40 个不含空格/@ 的字符（即查询串）即触发；'@' 前允许是任意字符
 * （行首、空白、或紧跟中文/英文均可），以支持同一行多次 @ 引用。
 * 返回 {query, from, to}，无触发返回 null。
 */
export function detectMention(editor: Editor): MentionState | null {
  const sel = editor.state.selection
  const $from = sel.$from
  const parent = $from.parent
  if (!parent || !parent.isTextblock) return null
  const text = parent.textBetween(0, $from.parentOffset, '\0', '\0')
  const m = /@([^\s@]{0,40})$/.exec(text)
  if (!m) return null
  const query = m[1]
  const at = $from.start() + ($from.parentOffset - (query.length + 1))
  return { active: true, query, from: at, to: $from.pos }
}

/**
 * 在光标前的 @ 触发位置插入一个引用节点（并补一个空格方便继续输入）。
 * 用单个 ProseMirror 事务 replaceWith+insert 完成「删 @query → 插引用芯片+空格」，
 * 不再拆成 deleteRange + insertContentAt 两个 chain 命令——后者在删除后位置映射易失效
 * （链命令返回 false，导致 @query 被删掉但芯片没插进去，编辑区看起来"什么都没有"）。
 * 返回是否成功插入（调用方负责关闭弹窗，故这里不抛错）。
 */
export function applyMention(editor: Editor, item: RefTarget): boolean {
  const m = detectMention(editor)
  if (!m) return false
  const nodeType = editor.schema.nodes['nodeRef']
  if (!nodeType) return false
  const node = nodeType.create({
    nodeId: item.id,
    nodeType: item.type,
    label: item.name,
    cardId: item.cardId ?? null,
  })
  const tr = editor.state.tr
    .replaceWith(m.from, m.to, node)
    .insert(m.from + 1, editor.schema.text(' '))
  editor.view.dispatch(tr)
  editor.commands.focus(m.from + 2)
  return true
}

/**
 * 遍历 TipTap doc（存储形式为纯 JSON，无 PMNode 实例方法），收集所有 nodeRef 引用；
 * 给定 targetId 时只返回指向它的引用。
 */
export function collectNodeRefs(
  doc: unknown,
  targetId?: string,
): { nodeId: string; nodeType: string; label: string; cardId?: string | null }[] {
  const out: { nodeId: string; nodeType: string; label: string; cardId?: string | null }[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'nodeRef') {
      const a = n.attrs || {}
      if (!targetId || a.nodeId === targetId) {
        out.push({ nodeId: a.nodeId, nodeType: a.nodeType, label: a.label, cardId: a.cardId ?? null })
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  try {
    walk(doc)
  } catch {
    /* ignore */
  }
  return out
}

/** 把 TipTap doc（纯 JSON）拍平成纯文本（用于反向链接片段预览） */
export function docToText(doc: unknown): string {
  let text = ''
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'text') text += n.text ?? ''
    else if (n.type === 'nodeRef') text += (n.attrs?.label as string) ?? ''
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  try {
    walk(doc)
  } catch {
    /* ignore */
  }
  return text
}

/**
 * 返回某节点内可作为「卡片级引用」的子项（按节点类型分别解析其集合内容）。
 * 支持：board(tasks) / character(items) / plot(items) / setting(entries)。
 * 无卡片或集合为空 → 返回 []（该节点不可下钻，@ 选择器只能引用到整个节点）。
 */
export function getNodeCards(node: FsNode): { id: string; name: string }[] {
  const c = node.content as Record<string, unknown> | undefined
  if (!c || typeof c !== 'object') return []
  switch (node.type) {
    case 'board':
      return (Array.isArray(c.tasks) ? (c.tasks as any[]) : []).map((t) => ({
        id: String(t.id),
        name: String(t.title || '（未命名卡片）'),
      }))
    case 'character':
      return (Array.isArray(c.items) ? (c.items as any[]) : []).map((t) => ({
        id: String(t.id),
        name: String(t.name || '（未命名角色）'),
      }))
    case 'plot':
      return (Array.isArray(c.items) ? (c.items as any[]) : []).map((t) => ({
        id: String(t.id),
        name: String(t.title || t.name || '（未命名情节）'),
      }))
    case 'setting':
      return (Array.isArray(c.entries) ? (c.entries as any[]) : []).map((t) => ({
        id: String(t.id),
        name: String(t.name || '（未命名条目）'),
      }))
    default:
      return []
  }
}
