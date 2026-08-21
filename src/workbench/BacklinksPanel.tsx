import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { collectNodeRefs, docToText } from '../editor/nodeRefShared'

interface Backlink {
  noteId: string
  noteName: string
  count: number
  snippet: string
}

/** 在纯文本里取 label 附近的预览片段 */
function makeSnippet(text: string, label: string): string {
  if (!text) return ''
  const i = text.indexOf(label)
  if (i < 0) return text.slice(0, 40)
  const s = Math.max(0, i - 12)
  const head = s > 0 ? '…' : ''
  const tail = i + label.length + 20 < text.length ? '…' : ''
  return head + text.slice(s, i + label.length + 20) + tail
}

/**
 * 反向链接面板：扫描所有正文（note）的 TipTap 内容，找出引用了"当前打开节点"的引用，
 * 列出「被以下正文引用」，点击直达该正文并定位到引用处。
 */
export default function BacklinksPanel() {
  const activePane = useStore((s) => s.activePane)
  const nodeId = useStore((s) => {
    const c = s.panes[s.activePane]
    return c && c.kind === 'node' ? c.id : null
  })
  const openNode = useStore((s) => s.openNode)
  const setSideTab = useStore((s) => s.setSideTab)
  const toggleBacklinks = useStore((s) => s.toggleBacklinks)
  const [items, setItems] = useState<Backlink[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!nodeId) {
      setItems([])
      return
    }
    const run = async () => {
      const nodes = useStore.getState().nodes
      const notes = nodes.filter((n) => n.type === 'note')
      const res: Backlink[] = []
      for (const note of notes) {
        if (note.id === nodeId) continue
        let content = note.content
        if (!content) {
          const full = await useStore.getState().getNodeContent(note.id)
          content = full?.content
        }
        if (!content) continue
        const refs = collectNodeRefs(content as never, nodeId)
        if (refs.length > 0) {
          const text = docToText(content)
          res.push({
            noteId: note.id,
            noteName: note.name || '（未命名）',
            count: refs.length,
            snippet: makeSnippet(text, refs[0].label),
          })
        }
      }
      if (!cancelled) setItems(res)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [nodeId, activePane])

  const node = useStore.getState().nodes.find((n) => n.id === nodeId)

  if (!nodeId) return null

  return (
    <div className={'backlinks-drawer' + (open ? '' : ' collapsed')}>
      <div className="bl-head">
        <span
          className="bl-title"
          onClick={() => setOpen((o) => !o)}
          title="被引用 / 反向链接（点击折叠/展开）"
        >
          🔗 被引用{node ? ` · ${node.name || ''}` : ''}
          {items.length > 0 ? `（${items.length}）` : ''}
        </span>
        <span className="bl-actions">
          <span className="bl-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? '▾' : '▸'}
          </span>
          <span
            className="bl-close"
            title="关闭被引用栏"
            onClick={(e) => {
              e.stopPropagation()
              toggleBacklinks()
            }}
          >
            ✕
          </span>
        </span>
      </div>
      {open && (
        <div className="bl-list">
          {items.length === 0 ? (
            <div className="bl-empty">暂无其它正文引用此节点</div>
          ) : (
            items.map((it) => (
              <div
                key={it.noteId}
                className="bl-item"
                onClick={() => {
                  setSideTab('tree')
                  openNode(it.noteId)
                }}
              >
                <div className="bl-name">📄 {it.noteName}</div>
                {it.snippet && <div className="bl-snippet">{it.snippet}</div>}
                <div className="bl-count">引用 {it.count} 处 →</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
