import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getNode } from '../store/useStore'
import type { TimelineDoc, TimeNode } from '../model/types'
import { newId, emptyTimeline, normalizeTimeline, makeTimeNode } from '../model/types'
import { layoutTimelines, TL_NODE_W, TL_NODE_H, type TlPos } from './layout'

/** 原生滚动下节点已用世界坐标定位，连线无需再叠加 pan 偏移 */
const ZERO_PAN = { x: 0, y: 0 }

/* 两个节点之间的连线：同列 → 竖向（父底中→子顶中）；异列 → 横向（父右中→子左中） */
function edgePath(p: TlPos, c: TlPos, pan: { x: number; y: number }): string {
  const W = TL_NODE_W
  const H = TL_NODE_H
  const px = p.x + pan.x
  const py = p.y + pan.y
  const cx = c.x + pan.x
  const cy = c.y + pan.y
  if (Math.abs(p.x - c.x) < 1) {
    const x1 = px + W / 2
    const y1 = py + H
    const x2 = cx + W / 2
    const y2 = cy
    const dy = Math.max(16, (y2 - y1) / 2)
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`
  }
  const x1 = px + W
  const y1 = py + H / 2
  const x2 = cx
  const y2 = cy + H / 2
  const dx = Math.max(16, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/* ---------------- 纯函数树操作（作用在 roots 数组上） ---------------- */
function findInRoots(roots: TimeNode[], id: string): TimeNode | null {
  for (const r of roots) {
    if (r.id === id) return r
    const f = findInRoots(r.children, id)
    if (f) return f
  }
  return null
}
/** 返回父节点 id；若 id 本身是根节点（时间线）则返回 null */
function findParentId(roots: TimeNode[], id: string): string | null {
  for (const r of roots) {
    if (r.children.some((c) => c.id === id)) return r.id
    const p = findParentId(r.children, id)
    if (p) return p
  }
  return null
}
function mapNode(n: TimeNode, id: string, fn: (n: TimeNode) => TimeNode): TimeNode {
  if (n.id === id) return fn(n)
  return { ...n, children: n.children.map((c) => mapNode(c, id, fn)) }
}
function mapChildren(children: TimeNode[], id: string, fn: (n: TimeNode) => TimeNode): TimeNode[] {
  return children.map((c) => (c.id === id ? fn(c) : mapNode(c, id, fn)))
}
function mapInRoots(
  roots: TimeNode[],
  id: string,
  fn: (n: TimeNode) => TimeNode,
): TimeNode[] {
  return roots.map((r) => (r.id === id ? fn(r) : { ...r, children: mapChildren(r.children, id, fn) }))
}
function removeKids(children: TimeNode[], id: string): TimeNode[] {
  return children
    .filter((c) => c.id !== id)
    .map((c) => ({ ...c, children: removeKids(c.children, id) }))
}
function removeFromRoots(roots: TimeNode[], id: string): TimeNode[] {
  return roots.filter((r) => r.id !== id).map((r) => ({ ...r, children: removeKids(r.children, id) }))
}

interface Props {
  nodeId: string
  paneId: 'left' | 'right'
  isActive: boolean
  onFocusPane: (p: 'left' | 'right') => void
}

export default function Timeline({ nodeId, paneId, isActive, onFocusPane }: Props) {
  const saveNodeContent = useStore((s) => s.saveNodeContent)
  const [doc, setDoc] = useState<TimelineDoc | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [noteEditId, setNoteEditId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const ready = !!doc

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const saveTimer = useRef<number | null>(null)
  const panState = useRef<{ sx: number; sy: number; sl: number; st: number } | null>(null)
  /** 拖动相交：记录起点、是否已移动、源节点 id */
  const dragRef = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null)
  /** 拖动时的光标层坐标（用于画虚线） */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  /** 拖动悬停的潜在相交目标 */
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null)

  /** 始终指向最新 doc，供鼠标事件回调读取 */
  const docRef = useRef<TimelineDoc | null>(null)
  docRef.current = doc

  useEffect(() => {
    let cancelled = false
    getNode(nodeId).then((n) => {
      if (cancelled) return
      const d = normalizeTimeline(n?.content) ?? emptyTimeline()
      setDoc(d)
      if (d.roots.length) setSelectedId(d.roots[0].id)
    })
    return () => {
      cancelled = true
    }
  }, [nodeId])

  const layout = useMemo(() => (doc ? layoutTimelines(doc.roots) : { pos: {}, width: 0, height: 0, timelines: [] }), [doc])

  const persist = (d: TimelineDoc) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveNodeContent(nodeId, d), 500)
  }
  const update = (roots: TimeNode[]) => {
    const cur = docRef.current
    const d: TimelineDoc = { roots, links: cur?.links ?? [] }
    setDoc(d)
    persist(d)
  }
  /** 全量更新文档（用于改动 links 等 roots 之外的字段） */
  const updateDoc = (d: TimelineDoc) => {
    setDoc(d)
    persist(d)
  }

  /* ---------------- Ctrl / ⌘ + 滚轮 缩放 ---------------- */
  useEffect(() => {
    const el = canvasRef.current
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
    const d = docRef.current
    if (!d) return
    update(mapInRoots(d.roots, id, (n) => ({ ...n, text })))
  }
  /** 新增一条时间线（新的根） */
  const addTimeline = () => {
    const d = docRef.current
    if (!d) return
    const nn = makeTimeNode(`时间线 ${d.roots.length + 1}`)
    update([...d.roots, nn])
    setSelectedId(nn.id)
    setEditingId(nn.id)
    focusContainer()
  }
  const addSiblingOf = (id: string) => {
    const d = docRef.current
    if (!d) return
    if (findParentId(d.roots, id) === null) return // 根节点（时间线首个节点）不能加同级，请用「新增时间线」
    const nn = makeTimeNode('')
    update(mapInRootsAfter(d.roots, id, nn))
    setSelectedId(nn.id)
    setEditingId(nn.id)
    focusContainer()
  }
  /** 在 id 之后插入同级；若 id 是根（时间线）则新增一条时间线 */
  function mapInRootsAfter(roots: TimeNode[], id: string, newNode: TimeNode): TimeNode[] {
    const p = findParentId(roots, id)
    if (p === null) return [...roots, newNode] // id 本身是时间线 → 新增一条时间线
    return mapInRoots(roots, p, (parent) => {
      const idx = parent.children.findIndex((c) => c.id === id)
      const kids = [...parent.children]
      kids.splice(idx + 1, 0, newNode)
      return { ...parent, children: kids }
    })
  }
  const addChildOf = (id: string) => {
    const d = docRef.current
    if (!d) return
    const nn = makeTimeNode('')
    update(mapInRoots(d.roots, id, (n) => ({ ...n, children: [...n.children, nn] })))
    setSelectedId(nn.id)
    setEditingId(nn.id)
    focusContainer()
  }
  const removeSelected = (id: string) => {
    const d = docRef.current
    if (!d) return
    let after = removeFromRoots(d.roots, id)
    if (after.length === 0) after = emptyTimeline().roots
    const links = (d.links ?? []).filter((l) => l.from !== id && l.to !== id)
    updateDoc({ roots: after, links })
    setSelectedId(after[0]?.id ?? null)
    setEditingId(null)
    focusContainer()
  }
  const toggleCollapse = (id: string) => {
    const d = docRef.current
    if (!d) return
    update(mapInRoots(d.roots, id, (n) => ({ ...n, collapsed: !n.collapsed })))
  }
  const setNodeNote = (id: string, note: string) => {
    const d = docRef.current
    if (!d) return
    update(mapInRoots(d.roots, id, (n) => ({ ...n, note })))
  }

  /**
   * 拖动相交：把「第二条时间线」的节点拖到「第一条时间线」的节点上，两条时间线在落点处相连，
   * 但【不移动、不删除任何节点】——只新增一条「目标 → 源」的跨时间线连接线，
   * 两条时间线各自保持完整，从视觉上形成「相交」。所有既有连线均原样保留。
   */
  const connectNodes = (sourceId: string, targetId: string) => {
    const d = docRef.current
    if (!d) return
    if (sourceId === targetId) return
    const links = d.links ?? []
    // 去重：已存在相同方向的跨时间线连线则不再重复添加
    if (links.some((l) => l.from === targetId && l.to === sourceId)) {
      setSelectedId(targetId)
      setEditingId(null)
      focusContainer()
      return
    }
    updateDoc({ roots: d.roots, links: [...links, { from: targetId, to: sourceId }] })
    setSelectedId(targetId)
    setEditingId(null)
    focusContainer()
  }

  /* 可见节点（折叠的子树不渲染），用于连线与键盘导航 */
  const visible = useMemo(() => {
    if (!doc) return [] as TimeNode[]
    const out: TimeNode[] = []
    const walk = (n: TimeNode) => {
      out.push(n)
      if (!n.collapsed) n.children.forEach(walk)
    }
    doc.roots.forEach(walk)
    return out
  }, [doc])

  const moveSelection = (dir: number) => {
    if (!selectedId) return
    const idx = visible.findIndex((n) => n.id === selectedId)
    if (idx < 0) return
    const next = visible[Math.min(visible.length - 1, Math.max(0, idx + dir))]
    if (next) {
      setSelectedId(next.id)
      focusContainer()
    }
  }

  /* ---------------- 键盘：回车/ Tab / 删除 / 方向 / 直接输入 ---------------- */
  const onContainerKey = (e: React.KeyboardEvent) => {
    if (!doc || editingId || !selectedId) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
      return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (findParentId(doc.roots, selectedId) === null) addChildOf(selectedId) // 根节点回车 → 新建首个事件（子节点）
      else addSiblingOf(selectedId)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (findParentId(doc.roots, selectedId) === null) return // 根节点 Tab 不能建同级（另一条时间线），请用「＋新增时间线」
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
      e.preventDefault()
      setNodeText(selectedId, e.key)
      setEditingId(selectedId)
    }
  }

  /* 画布层坐标（世界坐标，已含 zoom 逆变换与滚动偏移）：
   * 节点在缩放后的内层里定位于 pos.x/pos.y，故 screen = canvasRect.left - scrollLeft + worldX*zoom
   * → worldX = (clientX - rect.left + scrollLeft) / zoom                                  */
  const layerFromClient = (clientX: number, clientY: number) => {
    const el = canvasRef.current
    const rect = el?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    const sl = el?.scrollLeft ?? 0
    const st = el?.scrollTop ?? 0
    return { x: (clientX - left + sl) / zoom, y: (clientY - top + st) / zoom }
  }

  /* ---------------- 背景拖动平移（操纵原生滚动条） ---------------- */
  const onBgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.tl-node')) return
    const el = canvasRef.current
    if (!el) return
    onFocusPane(paneId)
    focusContainer()
    panState.current = { sx: e.clientX, sy: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
    const move = (ev: MouseEvent) => {
      const ps = panState.current
      if (!ps || !el) return
      el.scrollLeft = ps.sl - (ev.clientX - ps.sx)
      el.scrollTop = ps.st - (ev.clientY - ps.sy)
    }
    const up = () => {
      panState.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /* ---------------- 节点：点击编辑 / 拖动合并 ---------------- */
  const onNodeMouseDown = (e: React.MouseEvent, n: TimeNode) => {
    if (editingId === n.id) return
    if ((e.target as HTMLElement).closest('.tl-caret, .tl-note-badge')) return
    e.stopPropagation()
    e.preventDefault()
    onFocusPane(paneId)
    setSelectedId(n.id)
    dragRef.current = { id: n.id, sx: e.clientX, sy: e.clientY, moved: false }
    const move = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dist = Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy)
      if (!d.moved && dist > 4) {
        d.moved = true
        setDragPos(layerFromClient(d.sx, d.sy))
      }
      if (d.moved) {
        const lp = layerFromClient(ev.clientX, ev.clientY)
        setDragPos(lp)
        const elx = document.elementFromPoint(ev.clientX, ev.clientY)
        const tid = elx?.closest('[data-node-id]')?.getAttribute('data-node-id')
        setHoverTargetId(tid && tid !== d.id ? tid : null)
      }
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = dragRef.current
      dragRef.current = null
      setDragPos(null)
      setHoverTargetId(null)
      if (!d) return
      if (d.moved) {
        const elx = document.elementFromPoint(ev.clientX, ev.clientY)
        const targetId = elx?.closest('[data-node-id]')?.getAttribute('data-node-id')
        if (targetId && targetId !== d.id) connectNodes(d.id, targetId)
      } else {
        // 未移动 → 视为点击，进入编辑
        selectAndEdit(d.id)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  useEffect(() => {
    if (editingId && inputRefs.current[editingId]) {
      const el = inputRefs.current[editingId]!
      el.focus()
      el.select()
    }
  }, [editingId])

  if (!doc) return <div className="mm-loading">加载中…</div>

  const selName = selectedId ? findInRoots(doc.roots, selectedId)?.text || '（空）' : ''
  const selIsRoot = selectedId ? findParentId(doc.roots, selectedId) === null : false

  /* ---------------- 连线几何（链式：父→首个子，随后同级依次相连） ---------------- */
  const edges: JSX.Element[] = []
  for (const n of visible) {
    if (n.collapsed) continue
    const pp = layout.pos[n.id]
    if (!pp) continue
    const kids = n.children
    if (kids.length === 0) continue
    const fp = layout.pos[kids[0].id]
    if (fp) edges.push(<path key={'e' + n.id + kids[0].id} className="tl-edge" d={edgePath(pp, fp, ZERO_PAN)} />)
    for (let i = 0; i < kids.length - 1; i++) {
      const a = layout.pos[kids[i].id]
      const b = layout.pos[kids[i + 1].id]
      if (a && b)
        edges.push(<path key={'c' + kids[i].id + kids[i + 1].id} className="tl-edge" d={edgePath(a, b, ZERO_PAN)} />)
    }
  }
  /* 跨时间线相交连线（拖动产生的 links）：不改动树，仅以高亮虚线连接两条时间线 */
  for (const l of doc.links ?? []) {
    const fp = layout.pos[l.from]
    const tp = layout.pos[l.to]
    if (fp && tp)
      edges.push(<path key={'lk' + l.from + l.to} className="tl-edge link" d={edgePath(fp, tp, ZERO_PAN)} />)
  }

  return (
    <div
      className={'pane-inner tl-pane' + (isActive ? ' active' : '')}
      ref={containerRef}
      tabIndex={0}
      onClick={() => onFocusPane(paneId)}
      onKeyDown={onContainerKey}
    >
      <div className="pane-toolbar tl-toolbar">
        <button className="tb-btn" onClick={addTimeline} title="新增一条时间线">
          ＋新增时间线
        </button>
        <span className="mm-sel">当前：{selName}</span>
        <button
          className="tb-btn"
          disabled={!selectedId}
          onClick={() => selectedId && addChildOf(selectedId)}
          title="新增子节点 (Tab) · 根节点可建首个事件"
        >
          ＋子节点
        </button>
        <button
          className="tb-btn"
          disabled={!selectedId || selIsRoot}
          onClick={() => selectedId && !selIsRoot && addSiblingOf(selectedId)}
          title={selIsRoot ? '根节点不能加同级，请用「＋新增时间线」' : '新增同级节点 (Enter)'}
        >
          ＋同级
        </button>
        <button
          className="tb-btn"
          disabled={!selectedId}
          onClick={() => selectedId && removeSelected(selectedId)}
          title="删除节点 (Del)"
        >
          删除
        </button>
        <button
          className="tb-btn"
          disabled={!selectedId}
          onClick={() => selectedId && toggleCollapse(selectedId)}
          title="折叠/展开子节点"
        >
          折叠
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
      <div className="tl-help">
        点击节点编辑 · 回车：根节点建首个事件／其余节点加同级（从当前节点向下连线）· Tab：加子节点（向右分叉，根节点禁用）· 方向键移动 · 删除节点
        <br />
        根节点不能 Tab 建同级（另一条时间线），请用「＋新增时间线」· 拖某节点到另一时间线的节点上 → 两条时间线「相交」（新增跨时间线连线，两条线都不动、各自完整）· 拖空白处滚动画布 · Ctrl+滚轮缩放
      </div>
      <div className="tl-canvas" ref={canvasRef} onMouseDown={onBgMouseDown}>
        <div
          className="tl-layer"
          style={{
            width: layout.width * zoom,
            height: layout.height * zoom,
          }}
        >
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              width: layout.width,
              height: layout.height,
              position: 'relative',
            }}
          >
            <svg className="tl-edges" width={layout.width} height={layout.height}>
              {edges}
              {dragPos &&
                dragRef.current &&
                (() => {
                  const src = findInRoots(doc.roots, dragRef.current.id)
                  const sp = src ? layout.pos[src.id] : null
                  if (!sp) return null
                  const x1 = sp.x + TL_NODE_W / 2
                  const y1 = sp.y + TL_NODE_H / 2
                  return <path className="tl-edge linking" d={`M ${x1} ${y1} L ${dragPos.x} ${dragPos.y}`} />
                })()}
            </svg>
            {visible.map((n) => {
              const p = layout.pos[n.id]
              if (!p) return null
              const isSel = n.id === selectedId
              const isEdit = n.id === editingId
              const isRoot = findParentId(doc.roots, n.id) === null
              const isDrop = n.id === hoverTargetId
              const hasKids = n.children.length > 0
              return (
                <div
                  key={n.id}
                  data-node-id={n.id}
                  className={
                    'tl-node' +
                    (isRoot ? ' tl-root' : '') +
                    (isSel ? ' selected' : '') +
                    (isDrop ? ' tl-drop' : '') +
                    (isEdit ? ' editing' : '')
                  }
                  style={{ left: p.x, top: p.y, width: TL_NODE_W, height: TL_NODE_H }}
                  onMouseDown={(e) => onNodeMouseDown(e, n)}
                >
                {isRoot && <span className="tl-tag">时间线</span>}
                {hasKids && (
                  <span
                    className="tl-caret"
                    title={n.collapsed ? '展开' : '折叠'}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      toggleCollapse(n.id)
                    }}
                  >
                    {n.collapsed ? '＋' : '－'}
                  </span>
                )}
                {isEdit ? (
                  <input
                    ref={(el) => {
                      inputRefs.current[n.id] = el
                    }}
                    className="tl-input"
                    value={n.text}
                    placeholder="输入内容…"
                    onChange={(e) => setNodeText(n.id, e.target.value)}
                    onBlur={() => {
                      setEditingId(null)
                      focusContainer()
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
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
                        addChildOf(n.id)
                      }
                      e.stopPropagation()
                    }}
                  />
                ) : (
                  <span className="tl-text">{n.text || '（空）'}</span>
                )}
                {n.note && n.note.trim() && (
                  <span
                    className="tl-note-badge"
                    title="查看 / 编辑备注"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      openNote(n.id)
                    }}
                  >
                    📝
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      </div>

      {noteEditId &&
        (() => {
          const n = findInRoots(doc.roots, noteEditId)
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

  function openNote(id: string) {
    setNoteEditId(id)
  }
}
