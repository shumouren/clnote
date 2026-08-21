import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getNode } from '../store/useStore'
import type { MindMapDoc, MindNode } from '../model/types'
import { newId, emptyMindMap } from '../model/types'
import { layoutTree, NODE_W, NODE_H } from './layout'

/* ---------------- 纯函数树操作 ---------------- */
function findNode(node: MindNode, id: string): MindNode | null {
  if (node.id === id) return node
  for (const c of node.children) {
    const r = findNode(c, id)
    if (r) return r
  }
  return null
}
function findParent(node: MindNode, id: string): string | null {
  for (const c of node.children) {
    if (c.id === id) return node.id
    const r = findParent(c, id)
    if (r) return r
  }
  return null
}
function mapNode(node: MindNode, id: string, fn: (n: MindNode) => MindNode): MindNode {
  if (node.id === id) return fn(node)
  return { ...node, children: node.children.map((c) => mapNode(c, id, fn)) }
}
function removeNode(node: MindNode, id: string): MindNode {
  return {
    ...node,
    children: node.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)),
  }
}
function addSibling(
  root: MindNode,
  id: string,
  newNode: MindNode,
): MindNode {
  if (root.children.some((c) => c.id === id)) {
    const idx = root.children.findIndex((c) => c.id === id)
    const kids = [...root.children]
    kids.splice(idx + 1, 0, newNode)
    return { ...root, children: kids }
  }
  return { ...root, children: root.children.map((c) => addSibling(c, id, newNode)) }
}
function addChild(root: MindNode, id: string, newNode: MindNode): MindNode {
  if (root.id === id) return { ...root, children: [...root.children, newNode] }
  return { ...root, children: root.children.map((c) => addChild(c, id, newNode)) }
}
const makeNode = (text: string): MindNode => ({ id: newId(), text, children: [] })

interface Props {
  nodeId: string
  paneId: 'left' | 'right'
  isActive: boolean
  onFocusPane: (p: 'left' | 'right') => void
}

export default function MindMap({ nodeId, paneId, isActive, onFocusPane }: Props) {
  const saveNodeContent = useStore((s) => s.saveNodeContent)
  const openNode = useStore((s) => s.openNode)
  const [doc, setDoc] = useState<MindMapDoc | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [noteEditId, setNoteEditId] = useState<string | null>(null)
  const [pan, setPan] = useState({ x: 60, y: 60 })
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const ready = !!doc

  /** 引用相关：refTarget 非空表示本节点是引用，真正内容存在 refTarget 指向的节点；
   *  编辑时写回 refTarget（一处改全局生效）。refMissing 表示被引用节点已被删除。 */
  const [refTarget, setRefTarget] = useState<string | null>(null)
  const [refName, setRefName] = useState('')
  const [refMissing, setRefMissing] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const saveTimer = useRef<number | null>(null)
  const panState = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ref = await getNode(nodeId)
      if (cancelled) return
      const targetId = ref?.refId ?? nodeId
      const target = await getNode(targetId)
      if (cancelled) return
      // 引用但原图已不存在 → 标记悬空，提示用户在侧栏删除该引用节点
      if (ref?.refId && !target) {
        setRefTarget(ref.refId)
        setRefName('')
        setRefMissing(true)
        setDoc(null)
        return
      }
      setRefMissing(false)
      setRefTarget(ref?.refId ?? null)
      setRefName(target?.name ?? '')
      const d = (target?.content as MindMapDoc) ?? emptyMindMap()
      setDoc(d)
      setSelectedId(d.root.id)
      setEditingId(null)
    })()
    return () => {
      cancelled = true
    }
  }, [nodeId])

  const layout = useMemo(
    () => (doc ? layoutTree(doc.root) : { pos: {}, width: 0, height: 0 }),
    [doc],
  )

  const persist = (d: MindMapDoc) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    // 引用导图：写回被引用的原图节点，实现"一处改全局生效"
    const saveId = refTarget ?? nodeId
    saveTimer.current = window.setTimeout(() => saveNodeContent(saveId, d), 500)
  }
  const update = (root: MindNode) => {
    const d = { root }
    setDoc(d)
    persist(d)
  }

  useEffect(() => {
    if (editingId && inputRefs.current[editingId]) {
      const el = inputRefs.current[editingId]!
      el.focus()
      el.select()
    }
  }, [editingId])

  /* ---------------- Ctrl / ⌘ + 滚轮 缩放（类似 Office / 编辑器） ---------------- */
  useEffect(() => {
    const el = containerRef.current
    if (!el || !ready) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      const next = Math.min(3, Math.max(0.3, zoomRef.current * factor))
      zoomRef.current = next
      setZoom(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ready])

  const focusContainer = () => containerRef.current?.focus()

  const selectAndEdit = (id: string) => {
    setSelectedId(id)
    setEditingId(id)
    focusContainer()
  }
  const setNodeText = (id: string, text: string) => {
    if (!doc) return
    update(mapNode(doc.root, id, (n) => ({ ...n, text })))
  }
  const addSiblingOf = (id: string) => {
    if (!doc) return
    if (id === doc.root.id) return addChildOf(id)
    const nn = makeNode('')
    update(addSibling(doc.root, id, nn))
    setSelectedId(nn.id)
    setEditingId(nn.id)
    focusContainer()
  }
  const addChildOf = (id: string) => {
    if (!doc) return
    const nn = makeNode('')
    update(addChild(doc.root, id, nn))
    setSelectedId(nn.id)
    setEditingId(nn.id)
    focusContainer()
  }
  const removeSelected = (id: string) => {
    if (!doc || id === doc.root.id) return
    const parent = findParent(doc.root, id)
    update(removeNode(doc.root, id))
    setSelectedId(parent ?? doc.root.id)
    setEditingId(null)
    focusContainer()
  }
  const toggleCollapse = (id: string) => {
    if (!doc) return
    update(mapNode(doc.root, id, (n) => ({ ...n, collapsed: !n.collapsed })))
  }
  const openNote = (id: string) => setNoteEditId(id)
  const setNodeNote = (id: string, note: string) => {
    if (!doc) return
    update(mapNode(doc.root, id, (n) => ({ ...n, note })))
  }

  const visibleOrder = useMemo(() => {
    if (!doc) return []
    const order: string[] = []
    const walk = (n: MindNode) => {
      order.push(n.id)
      if (!n.collapsed) n.children.forEach(walk)
    }
    walk(doc.root)
    return order
  }, [doc])

  const moveSelection = (dir: number) => {
    if (!selectedId) return
    const idx = visibleOrder.indexOf(selectedId)
    if (idx < 0) return
    setSelectedId(visibleOrder[Math.min(visibleOrder.length - 1, Math.max(0, idx + dir))])
    focusContainer()
  }

  const onContainerKey = (e: React.KeyboardEvent) => {
    if (!doc || editingId || !selectedId) return
    // 焦点在输入框 / 文本域 / 下拉框 / 可编辑元素内（如备注弹窗的 textarea）时，
    // 不拦截按键，让回车正常换行、输入框正常输入
    const t = e.target as HTMLElement | null
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      addSiblingOf(selectedId)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      addChildOf(selectedId)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeSelected(selectedId)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSelection(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelection(-1)
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // 直接输入字符 → 进入编辑并把该字符作为起点
      e.preventDefault()
      setNodeText(selectedId, e.key)
      setEditingId(selectedId)
    }
  }

  const onBgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.mm-node')) return
    onFocusPane(paneId)
    focusContainer()
    panState.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y }
    const move = (ev: MouseEvent) => {
      if (!panState.current) return
      setPan({
        x: Math.max(0, panState.current.ox + (ev.clientX - panState.current.sx)),
        y: Math.max(0, panState.current.oy + (ev.clientY - panState.current.sy)),
      })
    }
    const up = () => {
      panState.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (refMissing) {
    return (
      <div className="pane-inner mm-pane">
        <div className="mm-dangling">
          <div className="mm-dangling-title">⚠️ 引用的原思维导图已不存在</div>
          <div className="mm-dangling-msg">
            本节点是对文本库某张思维导图的引用，但原图已被删除。
            请在左侧文件树删除此「🔗」引用节点，或重新引用一张导图。
          </div>
        </div>
      </div>
    )
  }

  if (!doc) return <div className="mm-loading">加载中…</div>

  const nodes = Object.entries(layout.pos).map(([id, p]) => {
    const n = findNode(doc.root, id)!
    const isSel = id === selectedId
    const isEdit = id === editingId
    const hasKids = n.children.length > 0
    return (
      <div
        key={id}
        className={'mm-node' + (isSel ? ' selected' : '') + (isEdit ? ' editing' : '')}
        style={{ left: p.x + pan.x, top: p.y - NODE_H / 2 + pan.y, width: NODE_W }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          selectAndEdit(id)
        }}
      >
        {hasKids && (
          <span
            className="mm-caret"
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapse(id)
            }}
            title={n.collapsed ? '展开' : '折叠'}
          >
            {n.collapsed ? '＋' : '－'}
          </span>
        )}
        {isEdit ? (
          <input
            ref={(el) => {
              inputRefs.current[id] = el
            }}
            className="mm-input"
            value={n.text}
            onChange={(e) => setNodeText(id, e.target.value)}
            onBlur={() => {
              setEditingId(null)
              focusContainer()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setEditingId(null)
                focusContainer()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEditingId(null)
                focusContainer()
              } else if (e.key === 'Tab') {
                e.preventDefault()
                setEditingId(null)
                addChildOf(id)
              }
              e.stopPropagation()
            }}
          />
        ) : (
          <span className="mm-text">{n.text || '（空）'}</span>
        )}
        {n.note && n.note.trim() && (
          <span
            className="mm-note-badge"
            title="查看 / 编辑备注"
            onClick={(e) => {
              e.stopPropagation()
              openNote(id)
            }}
          >
            📝
          </span>
        )}
      </div>
    )
  })

  const edges: JSX.Element[] = []
  const walkEdges = (n: MindNode) => {
    if (n.collapsed) return
    const pp = layout.pos[n.id]
    n.children.forEach((c) => {
      const cp = layout.pos[c.id]
      if (pp && cp) {
        const x1 = pp.x + NODE_W + pan.x
        const y1 = pp.y + pan.y
        const x2 = cp.x + pan.x
        const y2 = cp.y + pan.y
        // 常规对称 S 曲线：控制点水平偏移取两节点间距的一半，曲线随距离自适应、更顺滑
        const dx = Math.max(20, (x2 - x1) / 2)
        const dpath = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
        edges.push(<path key={c.id + n.id} className="mm-edge" d={dpath} />)
      }
      walkEdges(c)
    })
  }
  walkEdges(doc.root)

  const selName = selectedId ? findNode(doc.root, selectedId)?.text || '（空）' : ''

  return (
    <div
      className={'pane-inner mm-pane' + (isActive ? ' active' : '')}
      ref={containerRef}
      tabIndex={0}
      onClick={() => onFocusPane(paneId)}
      onKeyDown={onContainerKey}
    >
      {refTarget && !refMissing && (
        <div className="mm-ref-bar">
          <span className="mm-ref-tag">🔗 引用</span>
          <span className="mm-ref-text">来自文本库《{refName}》· 编辑将同步原图</span>
          <button className="tb-btn mm-ref-open" onClick={() => openNode(refTarget)}>
            打开原图
          </button>
        </div>
      )}
      <div className="pane-toolbar mm-toolbar">
        <span className="mm-sel">当前：{selName}</span>
        <button
          className="tb-btn"
          onClick={() => selectedId && addChildOf(selectedId)}
          title="新增子节点 (Tab)"
        >
          ＋子节点
        </button>
        <button
          className="tb-btn"
          onClick={() => selectedId && addSiblingOf(selectedId)}
          title="新增同级节点 (Enter)"
        >
          ＋同级
        </button>
        <button
          className="tb-btn"
          onClick={() => selectedId && removeSelected(selectedId)}
          title="删除节点 (Del)"
        >
          删除
        </button>
        <button
          className="tb-btn"
          onClick={() => selectedId && toggleCollapse(selectedId)}
          title="折叠/展开子节点"
        >
          折叠
        </button>
        <button
          className="tb-btn"
          onClick={() => selectedId && openNote(selectedId)}
          title="编辑节点备注（长文本，平时可隐藏）"
        >
          📝 备注
        </button>
        <span className="mm-sel">缩放 {Math.round(zoom * 100)}%</span>
        <button
          className="tb-btn"
          onClick={() => {
            zoomRef.current = 1
            setZoom(1)
          }}
          title="重置缩放为 100%"
        >
          重置缩放
        </button>
      </div>
      <div className="mm-help">
        点击节点直接编辑 · 编辑中回车退出 · 非编辑回车加同级 · Tab 加子级 · 方向键移动 · 拖空白处平移
      </div>
      <div className="mm-canvas" onMouseDown={onBgMouseDown}>
        <div
          className="mm-layer"
          style={{
            width: (layout.width + pan.x + 60) * zoom,
            height: (layout.height + pan.y + 60) * zoom,
            transform: `scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            className="mm-edges"
            width={layout.width + pan.x + 60}
            height={layout.height + pan.y + 60}
          >
            {edges}
          </svg>
          {nodes}
        </div>
      </div>

      {noteEditId &&
        (() => {
          const n = findNode(doc.root, noteEditId)
          if (!n) return null
          return (
            <div className="mat-modal-mask" onClick={() => setNoteEditId(null)}>
              <div className="mat-modal" onClick={(e) => e.stopPropagation()}>
                <div className="mat-modal-head">
                  <span>节点备注：{n.text || '（空）'}</span>
                  <span className="mat-modal-close" onClick={() => setNoteEditId(null)}>
                    ✕
                  </span>
                </div>
                <div className="mat-field">
                  <span>长文本备注（平时隐藏，点 📝 徽标展开编辑）</span>
                  <textarea
                    rows={8}
                    value={n.note ?? ''}
                    placeholder="写点说明、背景、待办…"
                    onChange={(e) => setNodeNote(noteEditId, e.target.value)}
                  />
                </div>
                <div className="mat-modal-foot">
                  <button className="tb-btn" onClick={() => setNoteEditId(null)}>
                    完成
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}
