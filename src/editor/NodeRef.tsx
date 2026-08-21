import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { NODE_REF_ICON, NODE_REF_LABEL } from './nodeRefShared'
import { useStore } from '../store/useStore'

export interface NodeRefAttrs {
  nodeId: string | null
  nodeType: string | null
  label: string
}

/**
 * 跨栏引用节点：内联 atom，表示一个指向其它节点（角色/剧情/设定/地图/时间线/正文…）的引用。
 * - nodeId：目标节点 id；nodeType：目标类型；label：展示名（冗余存一份，离线/改名前仍可读）。
 * - 显示用 React 节点视图（NodeRefView）：直接渲染芯片 span（含 data-nid/data-ntype）。
 * - renderHTML 仅用于 getHTML() / 剪贴板等纯序列化，吐出可解析的 <span data-node-ref>。
 * ⚠️ 关键坑（曾导致编辑器崩溃 `RangeError: Invalid array passed to renderSpec`）：
 *    schema 属性名 `nodeType` 与 prosemirror 的 `renderSpec` 内部判定 `attrs.nodeType == null`
 *    冲突。若把 nodeId/nodeType/label 作为元素属性透传，序列化时属性对象里会带
 *    `nodeType:'character'`，使 `attrs.nodeType != null` → renderSpec 误把属性对象当子节点 → 抛错。
 *    因此每个 schema 属性都用 `renderHTML: () => ({})` 抑制，且 renderHTML 只用 node.attrs
 *    手动拼 data-* / class / contenteditable，绝不把原始属性名透传进元素属性对象。
 * - 引用直接存进 TipTap 文档，无需改数据库；点击跳转由 NoteEditor 统一拦截（见 onEditorClick）。
 */
function NodeRefView({ node }: NodeViewProps) {
  const ico = NODE_REF_ICON[node.attrs.nodeType as string] ?? '🔗'
  const label = String(node.attrs.label ?? '')
  const cardId = node.attrs.cardId as string | null
  // 看板卡片引用：额外显示看板名，点击可直达该卡片
  const boardName = useStore(
    (s) => (cardId ? s.nodes.find((n) => n.id === node.attrs.nodeId)?.name ?? '' : ''),
  )
  const isCard = !!cardId
  const typeLabel =
    NODE_REF_LABEL[node.attrs.nodeType as string] ?? node.attrs.nodeType ?? '引用'
  const title = isCard
    ? `${typeLabel}：${boardName || '（未命名）'} · 卡片：${label}`
    : typeLabel
  return (
    <NodeViewWrapper
      as="span"
      className={'node-ref' + (isCard ? ' node-ref-card' : '')}
      data-node-ref=""
      data-nid={node.attrs.nodeId ?? ''}
      data-ntype={node.attrs.nodeType ?? ''}
      data-card={cardId ?? ''}
      contentEditable={false}
      title={title}
    >
      <span className="node-ref-ico">{isCard ? '🗂️' : ico}</span>
      <span className="node-ref-label">{label}</span>
    </NodeViewWrapper>
  )
}

export const NodeRef = Node.create({
  name: 'nodeRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      nodeId: {
        default: null,
        // 作为元素属性吐出会与 prosemirror renderSpec 的 attrs.nodeType 判定冲突，故抑制
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-nid') || null,
        renderHTML: () => ({}),
      },
      nodeType: {
        default: null,
        // 关键：schema 属性名 nodeType 与 prosemirror 的 renderSpec 内部判定
        // (attrs.nodeType == null) 冲突——若作为元素属性吐出，renderSpec 会误把
        // 属性对象当成子节点而抛 "Invalid array passed to renderSpec"。故显式抑制。
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-ntype') || null,
        renderHTML: () => ({}),
      },
      label: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-label') || '',
        renderHTML: () => ({}),
      },
      cardId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-card') || null,
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-node-ref]' }]
  },

  renderHTML({ node }) {
    // 必须用 node.attrs 手动拼属性，绝不能把 schema 原始属性（nodeId/nodeType/label）
    // 透传进元素属性对象——其中 nodeType 会与 prosemirror renderSpec 的
    // `attrs.nodeType == null` 判定冲突，导致渲染/序列化抛 "Invalid array passed to renderSpec"。
    // 这里只吐出安全的 data-* / class / contenteditable。
    return [
      'span',
      {
        'data-node-ref': '',
        'data-nid': (node.attrs.nodeId as string) ?? '',
        'data-ntype': (node.attrs.nodeType as string) ?? '',
        'data-label': (node.attrs.label as string) ?? '',
        'data-card': (node.attrs.cardId as string) ?? '',
        class: 'node-ref',
        contenteditable: 'false',
      },
      String((node.attrs.label as string) ?? ''),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NodeRefView)
  },

  // 导出纯文本时给出可读的引用名（如「『林惊羽』」），便于 txt/md 导出与搜索文本
  renderText({ node }) {
    const label = node.attrs.label as string
    return label ? `「${label}」` : ''
  },

  addCommands() {
    return {
      insertNodeRef:
        (attrs: NodeRefAttrs) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs }).run(),
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    nodeRef: {
      insertNodeRef: (attrs: NodeRefAttrs) => ReturnType
    }
  }
}
