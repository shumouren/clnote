import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getNode } from '../store/useStore'
import {
  type PlotDoc,
  type PlotItem,
  type PlotEdge,
  type PlotMode,
  type FsNode,
  normalizePlot,
  normalizeCharacter,
  PLOT_MODES,
  layoutPlot,
  PLOT_MAX_ROOTS,
  PLOT_MAX_CHILDREN,
  PLOT_MAX_DEPTH,
  newId,
} from '../model/types'
import { listForeshadowings } from '../storage/fs'
import { toast } from '../ui/toast'

interface Props {
  nodeId: string
  paneId: 'left' | 'right'
  isActive: boolean
  onFocusPane: (p: 'left' | 'right') => void
}

/** 向上找所属的小说创作（kind==='novel'）id，用于聚合该小说的伏笔 */
function findNovelId(nodes: FsNode[], nodeId: string): string | null {
  let cur = nodes.find((n) => n.id === nodeId)
  while (cur) {
    if (cur.kind === 'novel') return cur.id
    cur = cur.parentId ? nodes.find((n) => n.id === cur!.parentId) : undefined
  }
  return null
}

/** 各视图共享的操作上下文 */
interface PlotCtx {
  doc: PlotDoc
  layout: ReturnType<typeof layoutPlot>
  update: (d: PlotDoc) => void
  updateItem: (id: string, patch: Partial<PlotItem>) => void
  deleteItem: (id: string) => void
  addRoot: () => void
  addChild: (parentId: string) => void
  addSibling: (id: string) => void
  reparent: (id: string, newParentId: string) => void
  reorderSibling: (id: string, dir: -1 | 1) => void
  addEdge: (from: string, to: string) => void
  removeEdge: (from: string, to: string) => void
  setEdgeLabel: (from: string, to: string, label: string | undefined) => void
  openEditor: (id: string) => void
  setMode: (m: PlotMode) => void
  charOptions: Map<string, string>
  foreMap: Map<string, string>
}

/** 剧情编辑器：四种模式共享同一份情节项，顶部可随时切换模式 */
export default function Plot({ nodeId, paneId, isActive, onFocusPane }: Props) {
  const saveNodeContent = useStore((s) => s.saveNodeContent)
  const nodes = useStore((s) => s.nodes)
  const [doc, setDoc] = useState<PlotDoc | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const docRef = useRef<PlotDoc | null>(null)
  docRef.current = doc
  const saveTimer = useRef<number | null>(null)

  const persist = (d: PlotDoc) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveNodeContent(nodeId, d), 500)
  }
  const update = (d: PlotDoc) => {
    setDoc(d)
    persist(d)
  }

  useEffect(() => {
    let cancelled = false
    getNode(nodeId).then((n) => {
      if (cancelled) return
      setDoc(normalizePlot(n?.content))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  // 关联角色：聚合所有 character 节点里的角色卡（id -> 名字）
  const charOptions = useMemo(() => {
    const m = new Map<string, string>()
    nodes
      .filter((n) => n.type === 'character')
      .forEach((n) => {
        const d = normalizeCharacter(n.content)
        d.items.forEach((c) => m.set(c.id, c.name))
      })
    return m
  }, [nodes])

  const novelId = useMemo(() => findNovelId(nodes, nodeId), [nodes, nodeId])
  const [fores, setFores] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    let cancelled = false
    if (!novelId) {
      setFores([])
      return
    }
    listForeshadowings(novelId).then((rows) => {
      if (cancelled) return
      setFores(rows.map((r) => ({ id: r.id, label: r.snippet })))
    })
    return () => {
      cancelled = true
    }
  }, [novelId])

  const foreMap = useMemo(() => {
    const m = new Map<string, string>()
    fores.forEach((f) => m.set(f.id, f.label))
    return m
  }, [fores])

  const layout = useMemo(() => (doc ? layoutPlot(doc.items) : null), [doc])

  if (!doc || !layout) return <div className="pl-pane pl-loading">加载中…</div>

  /* ---------------- 共享操作 ---------------- */

  const updateItem = (id: string, patch: Partial<PlotItem>) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, items: d.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })
  }

  const deleteItem = (id: string) => {
    const d = docRef.current
    if (!d) return
    // 收集自身 + 所有后代
    const toRemove = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const it of d.items) {
        if (it.parentId && toRemove.has(it.parentId) && !toRemove.has(it.id)) {
          toRemove.add(it.id)
          changed = true
        }
      }
    }
    const n = toRemove.size
    update({
      ...d,
      items: d.items.filter((it) => !toRemove.has(it.id)),
      edges: (d.edges ?? []).filter((e) => !toRemove.has(e.from) && !toRemove.has(e.to)),
    })
    setEditingId((v) => (v === id ? null : v))
    if (n > 1) toast(`已删除 ${n} 个节点（含子节点）`)
  }

  const addRoot = () => {
    const d = docRef.current
    if (!d) return
    const roots = d.items.filter((it) => !it.parentId)
    if (roots.length >= PLOT_MAX_ROOTS) {
      toast(`顶层最多 ${PLOT_MAX_ROOTS} 个（起承转合）`)
      return
    }
    const item: PlotItem = {
      id: newId(),
      title: '新阶段',
      summary: '',
      charIds: [],
      foreshadowIds: [],
      parentId: '',
      order: roots.length,
    }
    update({ ...d, items: [...d.items, item] })
    setEditingId(item.id)
  }

  const addChild = (parentId: string) => {
    const d = docRef.current
    if (!d || !parentId) return
    const pd = layout.depth.get(parentId)
    if (pd === undefined || pd >= PLOT_MAX_DEPTH - 1) {
      toast(`已达最大层级（起承转合下最多 ${PLOT_MAX_DEPTH - 1} 层），无法再添加子节点`)
      return
    }
    const kids = d.items.filter((it) => (it.parentId || '') === parentId)
    if (kids.length >= PLOT_MAX_CHILDREN) {
      toast(`每个节点最多 ${PLOT_MAX_CHILDREN} 个子节点`)
      return
    }
    const item: PlotItem = {
      id: newId(),
      title: '新事件',
      summary: '',
      charIds: [],
      foreshadowIds: [],
      parentId,
      order: kids.length,
    }
    update({ ...d, items: [...d.items, item] })
    setEditingId(item.id)
  }

  const addSibling = (id: string) => {
    const d = docRef.current
    if (!d) return
    const it = d.items.find((x) => x.id === id)
    if (!it || !it.parentId) return // 根节点没有同级
    const pid = it.parentId
    const sibs = d.items.filter((x) => (x.parentId || '') === pid)
    if (sibs.length >= PLOT_MAX_CHILDREN) {
      toast(`每个节点最多 ${PLOT_MAX_CHILDREN} 个子节点`)
      return
    }
    const item: PlotItem = {
      id: newId(),
      title: '新情节',
      summary: '',
      charIds: [],
      foreshadowIds: [],
      parentId: pid,
      order: sibs.length,
    }
    update({ ...d, items: [...d.items, item] })
    setEditingId(item.id)
  }

  const reparent = (id: string, newParentId: string) => {
    const d = docRef.current
    if (!d || id === newParentId) return
    // 不能挂到自己的后代下（成环）
    let cur: string | null = newParentId
    while (cur) {
      if (cur === id) {
        toast('不能挂到自己的子节点下')
        return
      }
      cur = d.items.find((x) => x.id === cur)?.parentId || null
    }
    const npd = layout.depth.get(newParentId)
    if (npd === undefined || npd >= PLOT_MAX_DEPTH - 1) {
      toast(`目标层级已达上限（最多 ${PLOT_MAX_DEPTH - 1} 层）`)
      return
    }
    const kids = d.items.filter((it) => (it.parentId || '') === newParentId)
    if (kids.length >= PLOT_MAX_CHILDREN) {
      toast(`每个节点最多 ${PLOT_MAX_CHILDREN} 个子节点`)
      return
    }
    update({
      ...d,
      items: d.items.map((it) => (it.id === id ? { ...it, parentId: newParentId, order: kids.length } : it)),
    })
  }

  const reorderSibling = (id: string, dir: -1 | 1) => {
    const d = docRef.current
    if (!d) return
    const it = d.items.find((x) => x.id === id)
    if (!it) return
    const pid = it.parentId || ''
    const sibs = d.items
      .filter((x) => (x.parentId || '') === pid)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const idx = sibs.findIndex((s) => s.id === id)
    const j = idx + dir
    if (j < 0 || j >= sibs.length) return
    const a = sibs[idx]
    const b = sibs[j]
    update({
      ...d,
      items: d.items.map((x) =>
        x.id === a.id ? { ...x, order: b.order } : x.id === b.id ? { ...x, order: a.order } : x,
      ),
    })
  }

  const addEdge = (from: string, to: string) => {
    const d = docRef.current
    if (!d || from === to) return
    const edges = d.edges ?? []
    if (edges.some((e) => e.from === from && e.to === to)) return
    update({ ...d, edges: [...edges, { from, to }] })
  }

  const removeEdge = (from: string, to: string) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, edges: (d.edges ?? []).filter((e) => !(e.from === from && e.to === to)) })
  }

  const setEdgeLabel = (from: string, to: string, label: string | undefined) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      edges: (d.edges ?? []).map((e) => (e.from === from && e.to === to ? { ...e, label } : e)),
    })
  }

  const setMode = (m: PlotMode) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, mode: m })
  }

  const openEditor = (id: string) => setEditingId(id)

  const ctx: PlotCtx = {
    doc,
    layout,
    update,
    updateItem,
    deleteItem,
    addRoot,
    addChild,
    addSibling,
    reparent,
    reorderSibling,
    addEdge,
    removeEdge,
    setEdgeLabel,
    openEditor,
    setMode,
    charOptions,
    foreMap,
  }

  const editingItem = doc.items.find((it) => it.id === editingId) ?? null
  const modeMeta = PLOT_MODES.find((m) => m.key === doc.mode)

  return (
    <div className="pl-pane" onClick={() => isActive || onFocusPane(paneId)}>
      <div className="pl-toolbar">
        <div className="pl-modes">
          {PLOT_MODES.map((m) => (
            <button
              key={m.key}
              className={'pl-mode' + (doc.mode === m.key ? ' on' : '')}
              title={m.desc}
              onClick={() => setMode(m.key)}
            >
              <span className="pl-mode-ico">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
        <span className="pl-hint">{modeMeta?.desc}</span>
      </div>

      {doc.mode === 'board' && <BoardView ctx={ctx} />}
      {doc.mode === 'outline' && <OutlineView ctx={ctx} />}
      {doc.mode === 'timeline' && <TimelineView ctx={ctx} />}
      {doc.mode === 'graph' && <GraphView ctx={ctx} />}

      {editingItem && (
        <div className="mat-modal-mask" onClick={() => setEditingId(null)}>
          <PlotItemModal
            key={editingItem.id}
            item={editingItem}
            charOptions={charOptions}
            fores={fores}
            onSave={(patch) => updateItem(editingItem.id, patch)}
            onDelete={() => deleteItem(editingItem.id)}
            onClose={() => setEditingId(null)}
          />
        </div>
      )}
    </div>
  )
}

/* 节点上的关联角色/伏笔小标签（四个视图共用） */
function ItemChips({ it, ctx }: { it: PlotItem; ctx: PlotCtx }) {
  if (it.charIds.length === 0 && it.foreshadowIds.length === 0) return null
  return (
    <div className="pl-card-tags">
      {it.charIds.map((id, i) => (
        <span key={'c' + i} className="pl-chip pl-chip-char">
          {ctx.charOptions.get(id) || '？'}
        </span>
      ))}
      {it.foreshadowIds.map((fid) => (
        <span key={'f' + fid} className="pl-chip pl-chip-fore" title={ctx.foreMap.get(fid)}>
          🔖 {(ctx.foreMap.get(fid) || '').slice(0, 8)}
        </span>
      ))}
    </div>
  )
}

/* ============================================================
   情节看板（board）：按起/承/转/合 四阶段分列
   ============================================================ */
function BoardView({ ctx }: { ctx: PlotCtx }) {
  const { doc, layout } = ctx
  const roots = doc.items
    .filter((it) => !it.parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const [dropRoot, setDropRoot] = useState<string | null>(null)

  const cardsOf = (rootId: string) =>
    layout.order.filter((id) => layout.rootId.get(id) === rootId && id !== rootId)

  return (
    <div className="pl-board">
      {roots.map((root) => (
        <div
          key={root.id}
          className={'pl-col' + (dropRoot === root.id ? ' pl-drop' : '')}
          onDragOver={(e) => {
            e.preventDefault()
            setDropRoot(root.id)
          }}
          onDragLeave={() => setDropRoot((v) => (v === root.id ? null : v))}
          onDrop={(e) => {
            e.preventDefault()
            const cid = e.dataTransfer.getData('text/plain')
            setDropRoot(null)
            if (cid && cid !== root.id) ctx.reparent(cid, root.id)
          }}
        >
          <div className="pl-col-head">
            <span className="pl-col-name" title="点击编辑阶段名" onClick={() => ctx.openEditor(root.id)}>
              {root.title || '（未命名）'}
            </span>
            <button className="pl-col-del" title="删除该阶段及其全部情节" onClick={() => ctx.deleteItem(root.id)}>
              ✕
            </button>
          </div>

          <div className="pl-cards">
            {cardsOf(root.id).map((id) => {
              const it = doc.items.find((x) => x.id === id)
              if (!it) return null
              return (
                <div
                  key={id}
                  className="pl-card"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', id)}
                  onClick={() => ctx.openEditor(id)}
                >
                  <div className="pl-card-title">
                    <span className="pl-seq">{layout.label.get(id)}</span>
                    {it.title || '（未命名）'}
                  </div>
                  {it.summary && <div className="pl-card-sum">{it.summary}</div>}
                  <ItemChips it={it} ctx={ctx} />
                </div>
              )
            })}
            <button className="pl-add-card" onClick={() => ctx.addChild(root.id)}>
              ＋ 事件
            </button>
          </div>
        </div>
      ))}
      {roots.length < PLOT_MAX_ROOTS && (
        <button className="pl-add-col" title={`新增阶段（最多 ${PLOT_MAX_ROOTS} 个）`} onClick={ctx.addRoot}>
          ＋ 阶段
        </button>
      )}
    </div>
  )
}

/* ============================================================
   大纲视图（outline）：树状层级
   ============================================================ */
function OutlineView({ ctx }: { ctx: PlotCtx }) {
  const roots = ctx.doc.items
    .filter((it) => !it.parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return (
    <div className="pl-outline">
      <div className="pl-ol-bar">
        <button className="tb-btn" onClick={ctx.addRoot}>
          ＋ 顶层情节
        </button>
        <span className="pl-hint">回车加同级 · Tab 加子项 · 数字为结构标号（起=1，其子=10，再下=100…）</span>
      </div>
      <div className="pl-ol-body">
        {roots.map((it) => (
          <OutlineNode key={it.id} item={it} ctx={ctx} depth={0} />
        ))}
        {roots.length === 0 && <div className="pl-muted">还没有情节，点上方「＋ 顶层情节」开始。</div>}
      </div>
    </div>
  )
}

function OutlineNode({
  item,
  ctx,
  depth,
}: {
  item: PlotItem
  ctx: PlotCtx
  depth: number
}) {
  const kids = ctx.doc.items
    .filter((it) => (it.parentId || '') === item.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const isRoot = !item.parentId

  return (
    <div className="pl-ol-node">
      <div className="pl-ol-row" style={{ paddingLeft: 6 + depth * 18 }}>
        <span className="pl-ol-bullet">▸</span>
        <span className="pl-seq pl-seq-ol">{ctx.layout.label.get(item.id)}</span>
        <input
          className="pl-ol-title"
          value={item.title}
          placeholder="（未命名）"
          onChange={(e) => ctx.updateItem(item.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!isRoot) ctx.addSibling(item.id)
            } else if (e.key === 'Tab') {
              e.preventDefault()
              ctx.addChild(item.id)
            }
          }}
        />
        {item.summary && <span className="pl-ol-sum" title={item.summary}>📝</span>}
        <button className="pl-ol-btn" title="添加子项" onClick={() => ctx.addChild(item.id)}>
          ＋子
        </button>
        <button
          className="pl-ol-btn"
          title={isRoot ? '顶层节点无同级' : '添加同级'}
          disabled={isRoot}
          onClick={() => ctx.addSibling(item.id)}
        >
          ＋同级
        </button>
        <button className="pl-ol-btn" title="编辑详情（摘要 / 角色 / 伏笔）" onClick={() => ctx.openEditor(item.id)}>
          ✎
        </button>
        <button className="pl-ol-btn pl-del" title="删除（其子项一并删除）" onClick={() => ctx.deleteItem(item.id)}>
          ✕
        </button>
      </div>
      {kids.length > 0 && (
        <div className="pl-ol-children">
          {kids.map((k) => (
            <OutlineNode key={k.id} item={k} ctx={ctx} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   时间线视图（timeline）：按数字标号（故事顺序）串联
   ============================================================ */
function TimelineView({ ctx }: { ctx: PlotCtx }) {
  const ordered = ctx.layout.order
    .map((id) => ctx.doc.items.find((x) => x.id === id))
    .filter((x): x is PlotItem => Boolean(x))

  const addEvent = () => {
    const root = ctx.doc.items.find((it) => !it.parentId)
    if (root) ctx.addChild(root.id)
    else ctx.addRoot()
  }

  return (
    <div className="pl-timeline">
      <div className="pl-ol-bar">
        <button className="tb-btn" onClick={addEvent}>
          ＋ 事件
        </button>
        <span className="pl-hint">按数字标号（故事顺序）排列 · ↑↓ 调整同级顺序</span>
      </div>
      <div className="pl-tl-body">
        {ordered.map((it, i) => (
          <div className="pl-tl-item" key={it.id}>
            <div className="pl-tl-axis">
              <span className="pl-tl-dot">{ctx.layout.label.get(it.id)}</span>
              {i < ordered.length - 1 && <span className="pl-tl-line" />}
            </div>
            <div className="pl-tl-card" onClick={() => ctx.openEditor(it.id)}>
              <div className="pl-tl-head">
                <span className="pl-card-title">{it.title || '（未命名）'}</span>
                <span className="pl-tl-ops">
                  <button
                    className="pl-ol-btn"
                    title="上移"
                    onClick={(e) => {
                      e.stopPropagation()
                      ctx.reorderSibling(it.id, -1)
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="pl-ol-btn"
                    title="下移"
                    onClick={(e) => {
                      e.stopPropagation()
                      ctx.reorderSibling(it.id, 1)
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="pl-ol-btn pl-del"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation()
                      ctx.deleteItem(it.id)
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
              {it.summary && <div className="pl-card-sum">{it.summary}</div>}
              <ItemChips it={it} ctx={ctx} />
            </div>
          </div>
        ))}
        {ordered.length === 0 && <div className="pl-muted">还没有事件，点上方「＋ 事件」开始。</div>}
      </div>
    </div>
  )
}

/* ============================================================
   关系图视图（graph）：自由画布 + 因果连线
   ============================================================ */
const GR_NODE_W = 184
const GR_NODE_H = 72

function GraphView({ ctx }: { ctx: PlotCtx }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null)
  const linkRef = useRef<{ from: string } | null>(null)
  const [linkPos, setLinkPos] = useState<{ x: number; y: number } | null>(null)
  /** 正在内联编辑的连线标签：key = `${from}|${to}` */
  const [edgeEdit, setEdgeEdit] = useState<{ key: string; val: string } | null>(null)

  const items = ctx.doc.items
  const edges = ctx.doc.edges ?? []
  const byId = new Map(items.map((it) => [it.id, it]))

  const fallbackPos = (it: PlotItem, idx: number) => ({
    x: it.x ?? 40 + (idx % 4) * (GR_NODE_W + 30),
    y: it.y ?? 40 + Math.floor(idx / 4) * (GR_NODE_H + 30),
  })

  const center = (it: PlotItem, idx: number) => {
    const p = fallbackPos(it, idx)
    return { x: p.x + GR_NODE_W / 2, y: p.y + GR_NODE_H / 2 }
  }

  const onNodeDown = (e: React.MouseEvent, it: PlotItem, idx: number) => {
    if (linkRef.current) return
    const layer = layerRef.current
    if (!layer) return
    const lr = layer.getBoundingClientRect()
    const p = fallbackPos(it, idx)
    dragRef.current = { id: it.id, offX: e.clientX - (p.x + lr.left), offY: e.clientY - (p.y + lr.top) }
    window.addEventListener('mousemove', onNodeMove)
    window.addEventListener('mouseup', onNodeUp)
  }

  const onNodeMove = (e: MouseEvent) => {
    const dr = dragRef.current
    const layer = layerRef.current
    if (!dr || !layer) return
    const lr = layer.getBoundingClientRect()
    const x = e.clientX - dr.offX - lr.left
    const y = e.clientY - dr.offY - lr.top
    ctx.updateItem(dr.id, { x: Math.max(0, x), y: Math.max(0, y) })
  }

  const onNodeUp = () => {
    window.removeEventListener('mousemove', onNodeMove)
    window.removeEventListener('mouseup', onNodeUp)
    dragRef.current = null
  }

  const onHandleDown = (e: React.MouseEvent, it: PlotItem) => {
    e.stopPropagation()
    linkRef.current = { from: it.id }
    window.addEventListener('mousemove', onLinkMove)
    window.addEventListener('mouseup', onLinkUp)
  }

  const onLinkMove = (e: MouseEvent) => {
    const layer = layerRef.current
    if (!layer) return
    const lr = layer.getBoundingClientRect()
    setLinkPos({ x: e.clientX - lr.left, y: e.clientY - lr.top })
  }

  const onLinkUp = (e: MouseEvent) => {
    window.removeEventListener('mousemove', onLinkMove)
    window.removeEventListener('mouseup', onLinkUp)
    const from = linkRef.current?.from
    linkRef.current = null
    setLinkPos(null)
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const targetEl = el?.closest('[data-plot-node]') as HTMLElement | null
    const to = targetEl?.getAttribute('data-plot-node')
    if (from && to && from !== to) ctx.addEdge(from, to)
  }

  const addNode = () => {
    const root = ctx.doc.items.find((it) => !it.parentId)
    if (root) ctx.addChild(root.id)
    else ctx.addRoot()
  }

  return (
    <div className="pl-gr-pane">
      <div className="pl-ol-bar">
        <button className="tb-btn" onClick={addNode}>
          ＋ 节点
        </button>
        <span className="pl-hint">拖动节点摆放 · 从节点右下 🔗 拖到另一节点建立因果连线</span>
      </div>
      <div className="pl-gr-canvas">
        <div className="pl-gr-layer" ref={layerRef}>
          <svg className="pl-gr-edges">
            <defs>
              <marker id="pl-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,3 L0,6 Z" fill="#e0862e" />
              </marker>
            </defs>
            {edges.map((ed, i) => {
              const a = byId.get(ed.from)
              const b = byId.get(ed.to)
              if (!a || !b) return null
              const ia = items.findIndex((x) => x.id === ed.from)
              const ib = items.findIndex((x) => x.id === ed.to)
              const A = center(a, ia)
              const B = center(b, ib)
              return (
                <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="pl-gr-line" markerEnd="url(#pl-arrow)" />
              )
            })}
            {edges.map((ed, i) => {
              const a = byId.get(ed.from)
              const b = byId.get(ed.to)
              if (!a || !b) return null
              const ia = items.findIndex((x) => x.id === ed.from)
              const ib = items.findIndex((x) => x.id === ed.to)
              const A = center(a, ia)
              const B = center(b, ib)
              const mx = (A.x + B.x) / 2
              const my = (A.y + B.y) / 2
              const key = `${ed.from}|${ed.to}`
              return (
                <div key={'l' + i} className="pl-gr-label" style={{ left: mx, top: my }}>
                  {edgeEdit?.key === key ? (
                    <input
                      className="pl-gr-edge-input"
                      autoFocus
                      value={edgeEdit.val}
                      placeholder="因果说明"
                      onChange={(e) => setEdgeEdit({ key, val: e.target.value })}
                      onBlur={() => {
                        ctx.setEdgeLabel(ed.from, ed.to, edgeEdit.val.trim() || undefined)
                        setEdgeEdit(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          ctx.setEdgeLabel(ed.from, ed.to, edgeEdit.val.trim() || undefined)
                          setEdgeEdit(null)
                        }
                        if (e.key === 'Escape') setEdgeEdit(null)
                      }}
                    />
                  ) : (
                    <>
                      <span
                        className="pl-gr-edge-text"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEdgeEdit({ key, val: ed.label ?? '' })
                        }}
                      >
                        {ed.label || '因果'}
                      </span>
                      <span
                        className="pl-gr-del"
                        title="删除连线"
                        onClick={(e) => {
                          e.stopPropagation()
                          ctx.removeEdge(ed.from, ed.to)
                        }}
                      >
                        ✕
                      </span>
                    </>
                  )}
                </div>
              )
            })}
            {linkPos && linkRef.current && byId.get(linkRef.current.from) && (() => {
              const ia = items.findIndex((x) => x.id === linkRef.current!.from)
              const A = center(byId.get(linkRef.current.from)!, ia)
              return <line x1={A.x} y1={A.y} x2={linkPos.x} y2={linkPos.y} className="pl-gr-line linking" />
            })()}
          </svg>

          {items.map((it, idx) => {
            const p = fallbackPos(it, idx)
            return (
              <div
                key={it.id}
                data-plot-node={it.id}
                className="pl-gr-node"
                style={{ left: p.x, top: p.y, width: GR_NODE_W, minHeight: GR_NODE_H }}
                onMouseDown={(e) => onNodeDown(e, it, idx)}
                onClick={() => ctx.openEditor(it.id)}
              >
                <div className="pl-gr-node-title">
                  <span className="pl-seq">{ctx.layout.label.get(it.id)}</span>
                  {it.title || '（未命名）'}
                </div>
                {(it.charIds.length > 0 || it.foreshadowIds.length > 0) && (
                  <div className="pl-card-tags">
                    {it.charIds.slice(0, 3).map((id, k) => (
                      <span key={'c' + k} className="pl-chip pl-chip-char">
                        {ctx.charOptions.get(id) || '？'}
                      </span>
                    ))}
                    {it.foreshadowIds.slice(0, 2).map((fid) => (
                      <span key={'f' + fid} className="pl-chip pl-chip-fore" title={ctx.foreMap.get(fid)}>
                        🔖
                      </span>
                    ))}
                  </div>
                )}
                <span className="pl-gr-handle" title="拖到另一节点建立因果连线" onMouseDown={(e) => onHandleDown(e, it)}>
                  🔗
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   情节项编辑弹窗（四种模式共用）
   ============================================================ */
interface ModalProps {
  item: PlotItem
  charOptions: Map<string, string>
  fores: { id: string; label: string }[]
  onSave: (patch: Partial<PlotItem>) => void
  onDelete: () => void
  onClose: () => void
}

function PlotItemModal({ item, charOptions, fores, onSave, onDelete, onClose }: ModalProps) {
  const [title, setTitle] = useState(item.title)
  const [summary, setSummary] = useState(item.summary)
  const [charIds, setCharIds] = useState<string[]>(item.charIds)
  const [foreIds, setForeIds] = useState<string[]>(item.foreshadowIds)

  const toggle = (arr: string[], setArr: (v: string[]) => void, id: string) =>
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  const commit = () => onSave({ title: title.trim() || '（未命名）', summary, charIds, foreshadowIds: foreIds })
  // 关闭（无论是点「完成」还是点空白）时把当前编辑内容落盘，避免漏存
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => () => commitRef.current(), [])

  return (
    <div className="mat-modal ch-edit-modal" onClick={(e) => e.stopPropagation()}>
      <div className="mat-modal-head">
        <span>编辑事件 · {title || '（未命名）'}</span>
        <span className="mat-modal-close" title="关闭" onClick={onClose}>
          ✕
        </span>
      </div>

      <div className="ch-edit-grid">
        <div className="ch-edit-left">
          <div className="ch-region">
            <div className="ch-region-title">
              事件名 <span className="ch-req">＊必填</span>
            </div>
            <input className="ch-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="ch-region">
            <div className="ch-region-title">关联角色</div>
            <div className="ch-tag-pool">
              {[...charOptions.entries()].map(([id, name]) => (
                <span
                  key={id}
                  className={'ch-tag' + (charIds.includes(id) ? ' ch-tag-on' : '')}
                  onClick={() => toggle(charIds, setCharIds, id)}
                >
                  {name || '（未命名）'}
                </span>
              ))}
              {charOptions.size === 0 && <span className="pl-muted">暂无角色，请先在「角色」节点创建</span>}
            </div>
          </div>

          <div className="ch-region">
            <div className="ch-region-title">关联伏笔</div>
            <div className="ch-tag-pool">
              {fores.map((f) => (
                <span
                  key={f.id}
                  className={'ch-tag' + (foreIds.includes(f.id) ? ' ch-tag-on' : '')}
                  title={f.label}
                  onClick={() => toggle(foreIds, setForeIds, f.id)}
                >
                  🔖 {f.label.slice(0, 12)}
                </span>
              ))}
              {fores.length === 0 && <span className="pl-muted">该小说下暂无伏笔</span>}
            </div>
          </div>
        </div>

        <div className="ch-edit-right">
          <div className="ch-region-title">摘要 / 情节要点</div>
          <textarea
            className="ch-input ch-bio"
            value={summary}
            placeholder="这一情节发生了什么、转折点在哪…"
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>
      </div>

      <div className="mat-modal-foot">
        <button className="tb-btn" style={{ color: '#d9483b' }} onClick={onDelete}>
          删除
        </button>
        <button className="tb-btn" onClick={() => { commit(); onClose() }}>
          完成
        </button>
      </div>
    </div>
  )
}
