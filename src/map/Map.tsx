import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, getNode } from '../store/useStore'
import {
  type MapDoc,
  type MapLocation,
  type MapEdge,
  type MapFloor,
  type MapLink,
  normalizeMap,
  normalizeSetting,
  makeFloor,
  makeMapFromTemplate,
  newId,
} from '../model/types'

interface Props {
  nodeId: string
  paneId: 'left' | 'right'
  isActive: boolean
  onFocusPane: (p: 'left' | 'right') => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 取所有设定节点里「地点」类别的条目（id -> 名称），用于关联 */
function useSettingPlaceOptions(): Map<string, string> {
  const nodes = useStore((s) => s.nodes)
  return useMemo(() => {
    const m = new Map<string, string>()
    nodes
      .filter((n) => n.type === 'setting')
      .forEach((n) => {
        const d = normalizeSetting(n.content)
        d.entries
          .filter((e) => e.category === '地点' && e.name)
          .forEach((e) => m.set(e.id, e.name))
      })
    return m
  }, [nodes])
}

export default function MapView({ nodeId, paneId, isActive, onFocusPane }: Props) {
  const saveNodeContent = useStore((s) => s.saveNodeContent)
  const [doc, setDoc] = useState<MapDoc | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [view, setView] = useState<'plan' | 'stack'>('plan')
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null)
  /** 正在内联编辑的路线标签：key = `${floorId}|${from}|${to}` */
  const [edgeEdit, setEdgeEdit] = useState<{ key: string; val: string } | null>(null)
  /** 正在内联编辑的跨层连接标签：key = `${from}|${to}` */
  const [linkEdit, setLinkEdit] = useState<{ key: string; val: string } | null>(null)
  const [renamingFloorId, setRenamingFloorId] = useState<string | null>(null)
  /** 计划视图连线模式：当前起点地点 id（点 🔗 进入，点目标退出） */
  const [linkFromId, setLinkFromId] = useState<string | null>(null)
  /** 橡皮筋线终点（光标相对画布坐标），仅用于跟随反馈 */
  const [linkMouse, setLinkMouse] = useState<{ x: number; y: number } | null>(null)
  /** 地点搜索（跨楼层） */
  const [search, setSearch] = useState('')
  /** 地图模板选择弹窗 */
  const [templateOpen, setTemplateOpen] = useState(false)
  /** 画布缩放（平面图 / 楼层关系共享），Ctrl+滚轮调整 */
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom

  const docRef = useRef<MapDoc | null>(null)
  docRef.current = doc
  const activeFloorIdRef = useRef<string | null>(null)
  activeFloorIdRef.current = activeFloorId
  const linkFromRef = useRef<string | null>(null)
  linkFromRef.current = linkFromId
  const saveTimer = useRef<number | null>(null)
  const placeOptions = useSettingPlaceOptions()

  const persist = (d: MapDoc) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveNodeContent(nodeId, d), 500)
  }
  const update = (d: MapDoc) => {
    setDoc(d)
    persist(d)
  }

  useEffect(() => {
    let cancelled = false
    getNode(nodeId).then((n) => {
      if (cancelled) return
      const d = normalizeMap(n?.content)
      setDoc(d)
      setActiveFloorId((cur) => (cur && d.floors.some((f) => f.id === cur) ? cur : topFloorId(d)))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  /* ---------------- 计算 ---------------- */

  const floorsByLevel = useMemo(
    () => [...(doc?.floors ?? [])].sort((a, b) => a.order - b.order),
    [doc],
  )
  const topFloorId = (d: MapDoc) => {
    const sorted = [...d.floors].sort((a, b) => a.order - b.order)
    return sorted.length ? sorted[sorted.length - 1].id : null
  }
  const activeFloor = doc?.floors.find((f) => f.id === activeFloorId) ?? floorsByLevel[floorsByLevel.length - 1] ?? null

  /* ---- 地点搜索（跨全部楼层）---- */
  const allLocs = useMemo(
    () => (doc ? doc.floors.flatMap((f) => f.locations.map((l) => ({ floorId: f.id, floorName: f.name, loc: l }))) : []),
    [doc],
  )
  const totalLocs = allLocs.length
  const matchedIds = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const s = new Set<string>()
    allLocs.forEach(({ loc }) => {
      if ((loc.name || '').toLowerCase().includes(q) || (loc.desc || '').toLowerCase().includes(q)) s.add(loc.id)
    })
    return s
  }, [search, allLocs])
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return allLocs.filter(
      ({ loc }) => (loc.name || '').toLowerCase().includes(q) || (loc.desc || '').toLowerCase().includes(q),
    )
  }, [search, allLocs])

  /** 跨楼层地点名查找 */
  const locName = (id: string) => {
    for (const f of doc?.floors ?? []) {
      const l = f.locations.find((x) => x.id === id)
      if (l) return l.name || '？'
    }
    return '？'
  }
  void locName

  /* ---------------- 操作 ---------------- */

  const replaceFloor = (fid: string, patch: Partial<MapFloor> | ((f: MapFloor) => MapFloor)) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      floors: d.floors.map((f) => {
        if (f.id !== fid) return f
        return typeof patch === 'function' ? patch(f) : { ...f, ...patch }
      }),
    })
  }

  const updateLoc = (id: string, patch: Partial<MapLocation>) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      floors: d.floors.map((f) => ({
        ...f,
        locations: f.locations.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      })),
    })
  }

  const addLocAt = (x: number, y: number) => {
    const f = activeFloor
    if (!f) return
    const loc: MapLocation = { id: newId(), name: '新地点', x: Math.max(0, x), y: Math.max(0, y), desc: '' }
    replaceFloor(f.id, { locations: [...f.locations, loc] })
    setEditingId(loc.id)
  }

  const deleteLoc = (id: string) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      floors: d.floors.map((f) => ({
        ...f,
        locations: f.locations.filter((l) => l.id !== id),
        edges: f.edges.filter((e) => e.from !== id && e.to !== id),
      })),
      links: (d.links ?? []).filter((l) => l.from !== id && l.to !== id),
    })
    setEditingId(null)
  }

  const addEdge = (from: string, to: string, floorId?: string) => {
    const fid = floorId ?? activeFloorIdRef.current ?? undefined
    const f = docRef.current?.floors.find((x) => x.id === fid)
    if (!f || from === to) return
    if (f.edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return
    replaceFloor(f.id, { edges: [...f.edges, { from, to }] })
  }

  const removeEdge = (from: string, to: string, floorId?: string) => {
    const d = docRef.current
    if (!d) return
    const fid = floorId ?? activeFloor?.id
    update({
      ...d,
      floors: d.floors.map((f) =>
        f.id === fid ? { ...f, edges: f.edges.filter((e) => !(e.from === from && e.to === to)) } : f,
      ),
    })
  }

  const setEdgeLabel = (floorId: string, from: string, to: string, label: string | undefined) => {
    replaceFloor(floorId, (f) => ({
      ...f,
      edges: f.edges.map((e) => (e.from === from && e.to === to ? { ...e, label } : e)),
    }))
  }

  /* ---- 楼层操作 ---- */

  const addFloor = () => {
    const d = docRef.current
    if (!d) return
    const maxOrder = d.floors.reduce((m, f) => Math.max(m, f.order), 0)
    const order = maxOrder >= 1 ? maxOrder + 1 : 1
    const floor = makeFloor(maxOrder >= 1 ? `${order}层` : '新楼层', order)
    update({ ...d, floors: [...d.floors, floor] })
    setActiveFloorId(floor.id)
  }

  const renameFloor = (fid: string, name: string) => {
    replaceFloor(fid, { name: name.trim() || '未命名层' })
    setRenamingFloorId(null)
  }

  const moveFloor = (fid: string, dir: 1 | -1) => {
    const d = docRef.current
    if (!d) return
    const sorted = [...d.floors].sort((a, b) => a.order - b.order)
    const i = sorted.findIndex((f) => f.id === fid)
    const j = i + dir
    if (j < 0 || j >= sorted.length) return
    const a = sorted[i]
    const b = sorted[j]
    const ao = a.order
    update({
      ...d,
      floors: d.floors.map((f) =>
        f.id === a.id ? { ...f, order: b.order } : f.id === b.id ? { ...f, order: ao } : f,
      ),
    })
  }

  const deleteFloor = (fid: string) => {
    const d = docRef.current
    if (!d || d.floors.length <= 1) return
    const target = d.floors.find((f) => f.id === fid)
    if (!target) return
    const removedIds = new Set(target.locations.map((l) => l.id))
    const floors = d.floors.filter((f) => f.id !== fid)
    update({
      ...d,
      floors,
      links: (d.links ?? []).filter((l) => !removedIds.has(l.from) && !removedIds.has(l.to)),
    })
    if (activeFloorId === fid) setActiveFloorId(topFloorId({ ...d, floors }))
  }

  /* ---- 模板 / 搜索跳转 ---- */

  /** 套用地图模板（替换当前内容） */
  const applyTemplate = (kind: 'blank' | 'building' | 'world') => {
    const d = makeMapFromTemplate(kind)
    update(d)
    setActiveFloorId(topFloorId(d))
    // 切回平面图视图：只有平面图支持「双击空白新增地点」，避免套用空白地图后停在楼层关系视图导致"加不了地点"
    setView('plan')
    setTemplateOpen(false)
    setSearch('')
  }

  /** 搜索结果点击：切到该地点所在楼层并滚动居中 */
  const jumpToLoc = (floorId: string, loc: MapLocation) => {
    onFocusPane(paneId)
    setView('plan')
    setActiveFloorId(floorId)
    window.setTimeout(() => {
      const el = canvasRef.current
      if (!el) return
      const targetX = (loc.x + 40) * zoomRef.current
      const targetY = (loc.y + 20) * zoomRef.current
      el.scrollTo({
        left: Math.max(0, targetX - el.clientWidth / 2),
        top: Math.max(0, targetY - el.clientHeight / 2),
        behavior: 'smooth',
      })
    }, 80)
  }

  /* ---- 跨层连接 ---- */

  const addLink = (from: string, to: string) => {
    const d = docRef.current
    if (!d || from === to) return
    const links = d.links ?? []
    if (links.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))) return
    update({ ...d, links: [...links, { from, to }] })
  }

  const removeLink = (from: string, to: string) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, links: (d.links ?? []).filter((l) => !(l.from === from && l.to === to)) })
  }

  const setLinkLabel = (from: string, to: string, label: string | undefined) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      links: (d.links ?? []).map((l) => (l.from === from && l.to === to ? { ...l, label } : l)),
    })
  }

  /* ---------------- 计划视图：拖拽移动 / 连线 ---------------- */

  const layerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  /** 画布滚动容器（平面图 = .mp-canvas），用于拖背景平移 */
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const panState = useRef<{ sx: number; sy: number; sl: number; st: number } | null>(null)

  /** 拖地图空白处 = 平移画布视图（操作原生滚动条，松手即停） */
  const onCanvasDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    // 点在节点 / 路线标签 / 按钮 / 输入框上时不平移，交给各自处理
    if ((e.target as HTMLElement).closest('.mp-node, .mp-edge-label, button, input, textarea')) return
    const el = canvasRef.current
    if (!el) return
    onFocusPane(paneId)
    panState.current = { sx: e.clientX, sy: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
    e.preventDefault()
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

  const onMarkerDown = (e: React.MouseEvent, loc: MapLocation) => {
    // 连线模式下不触发节点拖动
    if (linkFromRef.current) return
    e.stopPropagation()
    e.preventDefault()
    const d = { id: loc.id, sx: e.clientX, sy: e.clientY, ox: loc.x, oy: loc.y, moved: false }
    dragRef.current = d
    // 自包含的 move/up：add 与 remove 使用同一引用，跨重渲染也不会失配卡死
    const move = (ev: MouseEvent) => {
      const dd = dragRef.current
      if (!dd) return
      const dx = ev.clientX - dd.sx
      const dy = ev.clientY - dd.sy
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dd.moved = true
      const z = zoomRef.current || 1
      updateLoc(dd.id, { x: Math.max(0, dd.ox + dx / z), y: Math.max(0, dd.oy + dy / z) })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const dd = dragRef.current
      dragRef.current = null
      if (dd && !dd.moved) setEditingId(dd.id)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /* ---- 连线（点击 / 拖拽 皆可，稳健版）---- */
  const startLink = (id: string) => {
    setLinkFromId(id)
    setLinkMouse(null)
  }
  const cancelLink = () => {
    setLinkFromId(null)
    setLinkMouse(null)
  }
  const completeLink = (targetId: string) => {
    const from = linkFromRef.current
    if (!from || targetId === from) {
      cancelLink()
      return
    }
    addEdge(from, targetId, activeFloorIdRef.current ?? undefined)
    cancelLink()
  }
  const onHandleDown = (e: React.MouseEvent, loc: MapLocation) => {
    e.stopPropagation()
    startLink(loc.id)
    window.addEventListener('mousemove', onHandleMove)
    window.addEventListener('mouseup', onHandleUp)
  }
  const onHandleMove = (e: MouseEvent) => {
    const rect = layerRef.current?.getBoundingClientRect()
    if (!rect) return
    const z = zoomRef.current || 1
    setLinkMouse({ x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z })
  }
  const onHandleUp = (e: MouseEvent) => {
    window.removeEventListener('mousemove', onHandleMove)
    window.removeEventListener('mouseup', onHandleUp)
    const from = linkFromRef.current
    if (!from) return
    // 松手时若落在某目标附近（70px）则直接连上
    const rect = layerRef.current?.getBoundingClientRect()
    const d = docRef.current
    const f = d?.floors.find((x) => x.id === activeFloorIdRef.current)
    if (rect && f) {
      const px = (e.clientX - rect.left) / (zoomRef.current || 1)
      const py = (e.clientY - rect.top) / (zoomRef.current || 1)
      let best: string | null = null
      let bestDist = Infinity
      for (const l of f.locations) {
        if (l.id === from) continue
        const dist = Math.hypot(l.x + 40 - px, l.y + 20 - py)
        if (dist < bestDist) {
          bestDist = dist
          best = l.id
        }
      }
      if (best && bestDist <= 70) {
        addEdge(from, best, f.id)
        cancelLink()
        return
      }
    }
    // 否则保持连线模式，等待用户点击目标（或点空白取消）
  }

  const onLayerMouseMove = (e: React.MouseEvent) => {
    if (!linkFromRef.current || !layerRef.current) return
    const rect = layerRef.current.getBoundingClientRect()
    const z = zoomRef.current || 1
    setLinkMouse({ x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z })
  }
  const onLayerClick = () => {
    if (linkFromRef.current) cancelLink()
  }

  const onCanvasDouble = (e: React.MouseEvent) => {
    const rect = layerRef.current?.getBoundingClientRect()
    if (!rect) return
    const z = zoomRef.current || 1
    addLocAt((e.clientX - rect.left) / z, (e.clientY - rect.top) / z)
  }

  // ESC 取消连线模式
  useEffect(() => {
    if (!linkFromId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelLink()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linkFromId])

  if (!doc) return <div className="mp-pane mp-loading">加载中…</div>

  const editing = editingId ? doc.floors.flatMap((f) => f.locations).find((l) => l.id === editingId) ?? null : null

  return (
    <div className="mp-pane" onClick={() => onFocusPane(paneId)}>
      {/* 楼层标签栏 */}
      <div className="mp-floors">
        <span className="mp-floors-label">楼层</span>
        <div className="mp-floor-tabs">
          {floorsByLevel.map((f) => (
            <span
              key={f.id}
              className={'mp-floor-tab' + (f.id === activeFloor?.id && view === 'plan' ? ' on' : '')}
              onClick={() => {
                setActiveFloorId(f.id)
                setView('plan')
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenamingFloorId(f.id)
              }}
              title="点击进入该层平面图 · 双击重命名"
            >
              {renamingFloorId === f.id ? (
                <input
                  className="mp-floor-rename"
                  autoFocus
                  defaultValue={f.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => renameFloor(f.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameFloor(f.id, (e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setRenamingFloorId(null)
                  }}
                />
              )
              : f.name}
              {renamingFloorId !== f.id && (
                <span className="mp-floor-ops">
                  <span
                    className="mp-floor-op"
                    title="上移一层"
                    onClick={(e) => {
                      e.stopPropagation()
                      moveFloor(f.id, 1)
                    }}
                  >
                    ▲
                  </span>
                  <span
                    className="mp-floor-op"
                    title="下移一层"
                    onClick={(e) => {
                      e.stopPropagation()
                      moveFloor(f.id, -1)
                    }}
                  >
                    ▼
                  </span>
                  {doc.floors.length > 1 && (
                    <span
                      className="mp-floor-op del"
                      title="删除该层（含其地点与路线）"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteFloor(f.id)
                      }}
                    >
                      ✕
                    </span>
                  )}
                </span>
              )}
            </span>
          ))}
          <button className="mp-floor-add" title="新增一层" onClick={addFloor}>
            ＋层
          </button>
        </div>
        <button className="mp-view-btn" onClick={() => setTemplateOpen(true)} title="套用地图模板">
          模板
        </button>
        <div className="mp-search">
          <input
            className="mp-search-input"
            placeholder="搜索地点…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearch('')
            }}
            onClick={(e) => {
              e.stopPropagation()
              onFocusPane(paneId)
            }}
          />
          {searchResults.length > 0 && (
            <div className="mp-search-results">
              {searchResults.map(({ floorId, floorName, loc }) => (
                <div key={loc.id} className="mp-search-item" onClick={() => jumpToLoc(floorId, loc)}>
                  <span className="mp-search-name">{loc.name || '（未命名）'}</span>
                  <span className="mp-search-floor">{floorName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <span className="tb-spacer" />
        <div className="mp-view-toggle">
          <button className={'mp-view-btn' + (view === 'plan' ? ' on' : '')} onClick={() => setView('plan')}>
            平面图
          </button>
          <button className={'mp-view-btn' + (view === 'stack' ? ' on' : '')} onClick={() => setView('stack')}>
            楼层关系
          </button>
        </div>
      </div>

      {templateOpen && (
        <div className="mp-tpl-mask" onClick={() => setTemplateOpen(false)}>
          <div className="mp-tpl-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mp-tpl-head">
              <span>选择地图模板</span>
              <span className="mat-modal-close" title="关闭" onClick={() => setTemplateOpen(false)}>
                ✕
              </span>
            </div>
            <div className="mp-tpl-grid">
              <button className="mp-tpl-card" onClick={() => applyTemplate('building')}>
                <div className="mp-tpl-emoji">🏢</div>
                <div className="mp-tpl-name">大楼模板</div>
                <div className="mp-tpl-desc">B1 / 1F / 2F / 3F 四层，含示例房间、层内路线与跨层电梯楼梯</div>
              </button>
              <button className="mp-tpl-card" onClick={() => applyTemplate('world')}>
                <div className="mp-tpl-emoji">🌍</div>
                <div className="mp-tpl-name">世界地图</div>
                <div className="mp-tpl-desc">单张大图，多个区域 + 道路连线</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {!templateOpen && totalLocs === 0 && (
        <div className="mp-empty-overlay">
          <div className="mp-empty-card">
            <div className="mp-empty-title">这张地图还是空的</div>
            <div className="mp-empty-sub">从模板开始，或直接在画布上双击空白处新增地点</div>
            <button
              className="mp-tpl-btn primary"
              style={{ marginBottom: 12 }}
              onClick={() => {
                setView('plan')
                addLocAt(600, 300)
              }}
            >
              ＋ 直接新增第一个地点
            </button>
            <div className="mp-template-row">
              <button className="mp-tpl-btn" onClick={() => applyTemplate('building')}>
                🏢 大楼模板
              </button>
              <button className="mp-tpl-btn" onClick={() => applyTemplate('world')}>
                🌍 世界地图
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'plan' ? (
        <PlanView
          floor={activeFloor}
          layerRef={layerRef}
          canvasRef={canvasRef}
          onCanvasDown={onCanvasDown}
          edgeEdit={edgeEdit}
          setEdgeEdit={setEdgeEdit}
          onCommitEdge={(floorId, from, to, label) => setEdgeLabel(floorId, from, to, label)}
          onDeleteEdge={(floorId, from, to) => removeEdge(from, to, floorId)}
          onMarkerDown={onMarkerDown}
          onHandleDown={onHandleDown}
          onLayerMouseMove={onLayerMouseMove}
          onLayerClick={onLayerClick}
          onCanvasDouble={onCanvasDouble}
          linkFromId={linkFromId}
          linkMouse={linkMouse}
          completeLink={completeLink}
          cancelLink={cancelLink}
          addLocAt={addLocAt}
          searchActive={!!matchedIds}
          matchedIds={matchedIds}
          zoom={zoom}
          setZoom={setZoom}
        />
      ) : (
        <StackView
          doc={doc}
          linkEdit={linkEdit}
          setLinkEdit={setLinkEdit}
          onCommitLink={(from, to, label) => setLinkLabel(from, to, label)}
          onAddLink={addLink}
          onOpenLoc={(id) => setEditingId(id)}
          onDeleteLink={removeLink}
          onMoveLoc={(id, patch) => updateLoc(id, patch)}
          zoom={zoom}
          setZoom={setZoom}
        />
      )}

      {editing && (
        <div className="mat-modal-mask" onClick={() => setEditingId(null)}>
          <MapModal
            loc={editing}
            placeOptions={placeOptions}
            onSave={(patch) => {
              updateLoc(editing.id, patch)
              setEditingId(null)
            }}
            onDelete={() => deleteLoc(editing.id)}
            onClose={() => setEditingId(null)}
          />
        </div>
      )}
    </div>
  )
}

/* ============================================================
   平面图（当前楼层）
   ============================================================ */
function PlanView({
  floor,
  layerRef,
  canvasRef,
  onCanvasDown,
  edgeEdit,
  setEdgeEdit,
  onCommitEdge,
  onDeleteEdge,
  onMarkerDown,
  onHandleDown,
  onLayerMouseMove,
  onLayerClick,
  onCanvasDouble,
  linkFromId,
  linkMouse,
  completeLink,
  cancelLink,
  addLocAt,
  searchActive,
  matchedIds,
  zoom,
  setZoom,
}: {
  floor: MapFloor | null
  layerRef: React.MutableRefObject<HTMLDivElement | null>
  canvasRef: React.MutableRefObject<HTMLDivElement | null>
  onCanvasDown: (e: React.MouseEvent) => void
  edgeEdit: { key: string; val: string } | null
  setEdgeEdit: (v: { key: string; val: string } | null) => void
  onCommitEdge: (floorId: string, from: string, to: string, label: string | undefined) => void
  onDeleteEdge: (floorId: string, from: string, to: string) => void
  onMarkerDown: (e: React.MouseEvent, loc: MapLocation) => void
  onHandleDown: (e: React.MouseEvent, loc: MapLocation) => void
  onLayerMouseMove: (e: React.MouseEvent) => void
  onLayerClick: () => void
  onCanvasDouble: (e: React.MouseEvent) => void
  linkFromId: string | null
  linkMouse: { x: number; y: number } | null
  completeLink: (targetId: string) => void
  cancelLink: () => void
  addLocAt: (x: number, y: number) => void
  searchActive: boolean
  matchedIds: Set<string> | null
  zoom: number
  setZoom: (z: number | ((p: number) => number)) => void
}) {
  if (!floor) return <div className="mp-canvas mp-empty">（没有楼层）</div>
  const locById = (id: string) => floor.locations.find((l) => l.id === id)
  const startEdgeEdit = (ed: MapEdge) => setEdgeEdit({ key: `${floor.id}|${ed.from}|${ed.to}`, val: ed.label ?? '' })
  const linkSrc = linkFromId ? locById(linkFromId) : null

  // Ctrl + 滚轮缩放画布（native 非被动监听，确保可 preventDefault）
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.3, 3))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [canvasRef, setZoom])

  return (
    <div className="mp-plan">
      <div className="mp-bar">
        <span className="mp-hint">
          {linkFromId
            ? '连线模式：点击另一地点完成连接 · 点空白 / 自身 / ESC 取消'
            : '拖空白处平移视图 · 双击空白新增地点 · 拖动标记移动 · 点 🔗 后点目标连路线 · 点路线文字可编辑'}
        </span>
        <span className="tb-spacer" />
        <button
          className="tb-btn primary"
          onClick={() => {
            const rect = layerRef.current?.getBoundingClientRect()
            addLocAt(rect ? rect.width / 2 : 120, rect ? rect.height / 2 : 120)
          }}
        >
          ＋ 新增地点
        </button>
      </div>
      <div className="mp-canvas" ref={canvasRef} onMouseDown={onCanvasDown}>
      <div className="mp-zoom" style={{ width: 2200 * zoom, height: 1500 * zoom }}>
      <div
        className="mp-layer"
        ref={layerRef}
        style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}
        onDoubleClick={onCanvasDouble}
        onMouseMove={onLayerMouseMove}
        onClick={onLayerClick}
      >
        <svg className="mp-edges">
          {floor.edges.map((ed, i) => {
            const a = locById(ed.from)
            const b = locById(ed.to)
            if (!a || !b) return null
            return <line key={i} x1={a.x + 40} y1={a.y + 20} x2={b.x + 40} y2={b.y + 20} className="mp-line" />
          })}
          {/* 连线模式橡皮筋 */}
          {linkSrc && linkMouse && (
            <line
              x1={linkSrc.x + 40}
              y1={linkSrc.y + 20}
              x2={linkMouse.x}
              y2={linkMouse.y}
              className="mp-line mp-line-temp"
            />
          )}
        </svg>

        {/* 路线标签（HTML 覆盖层，支持内联编辑） */}
        {floor.edges.map((ed, i) => {
          const a = locById(ed.from)
          const b = locById(ed.to)
          if (!a || !b) return null
          const mx = (a.x + 40 + (b.x + 40)) / 2
          const my = (a.y + 20 + (b.y + 20)) / 2
          const key = `${floor.id}|${ed.from}|${ed.to}`
          return (
            <div key={'l' + i} className="mp-edge-label" style={{ left: mx, top: my }}>
              {edgeEdit?.key === key ? (
                <input
                  className="mp-edge-input"
                  autoFocus
                  value={edgeEdit.val}
                  placeholder="路线名"
                  onChange={(e) => setEdgeEdit({ key, val: e.target.value })}
                  onBlur={() => {
                    onCommitEdge(floor.id, ed.from, ed.to, edgeEdit.val.trim() || undefined)
                    setEdgeEdit(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onCommitEdge(floor.id, ed.from, ed.to, edgeEdit.val.trim() || undefined)
                      setEdgeEdit(null)
                    }
                    if (e.key === 'Escape') setEdgeEdit(null)
                  }}
                />
              ) : (
                <>
                  <span className="mp-edge-text" onClick={(e) => { e.stopPropagation(); startEdgeEdit(ed) }}>
                    {ed.label || '路线'}
                  </span>
                  <span
                    className="mp-del"
                    title="删除路线"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteEdge(floor.id, ed.from, ed.to)
                    }}
                  >
                    ✕
                  </span>
                </>
              )}
            </div>
          )
        })}

        {floor.locations.map((loc) => (
          <div
            key={loc.id}
            data-mp-node={loc.id}
            className={
              'mp-node' +
              (linkFromId === loc.id ? ' link-source' : '') +
              (linkFromId && linkFromId !== loc.id ? ' link-armed' : '') +
              (searchActive && matchedIds?.has(loc.id) ? ' search-hit' : '') +
              (searchActive && !matchedIds?.has(loc.id) ? ' search-dim' : '')
            }
            style={{ left: loc.x, top: loc.y }}
            onMouseDown={(e) => onMarkerDown(e, loc)}
            onClick={(e) => {
              e.stopPropagation()
              if (linkFromId) {
                if (loc.id === linkFromId) cancelLink()
                else completeLink(loc.id)
              }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <div className="mp-node-name">{loc.name || '（未命名）'}</div>
            <div className="mp-node-handle" title="点此连到另一地点" onMouseDown={(e) => onHandleDown(e, loc)} onClick={(e) => e.stopPropagation()}>
              🔗
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
    </div>
  )
}

/* ============================================================
   楼层关系（竖向堆叠 + 跨层连接）
   - 各层按层级从下到上堆叠，地点按 x 横向位置摆放（体现方位）
   - 点某地点 🔗↕ 后点另一层地点 → 建立跨层连接（楼梯 / 电梯 / 通道）
   ============================================================ */
function StackView({
  doc,
  linkEdit,
  setLinkEdit,
  onCommitLink,
  onAddLink,
  onOpenLoc,
  onDeleteLink,
  onMoveLoc,
  zoom,
  setZoom,
}: {
  doc: MapDoc
  linkEdit: { key: string; val: string } | null
  setLinkEdit: (v: { key: string; val: string } | null) => void
  onCommitLink: (from: string, to: string, label: string | undefined) => void
  onAddLink: (from: string, to: string) => void
  onOpenLoc: (id: string) => void
  onDeleteLink: (from: string, to: string) => void
  onMoveLoc: (id: string, patch: Partial<MapLocation>) => void
  zoom: number
  setZoom: (z: number | ((p: number) => number)) => void
}) {
  const stackRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  /** 内容真实高度（由 ResizeObserver 测量 .mp-stack 的实际撑开高度，不受 transform:scale 影响）。
   *  用它撑开 .mp-zoom，杜绝"只有长度没有高度"。首帧用 natH 兜底，测量后自动校正。 */
  const [contentH, setContentH] = useState(0)
  const panState = useRef<{ sx: number; sy: number; sl: number; st: number } | null>(null)
  const chipEls = useRef<Map<string, HTMLElement>>(new Map())

  /** 拖楼层关系空白 = 平移滚动视图（松手即停） */
  const onStackDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.mp-stack-chip, button, input, textarea')) return
    const el = wrapRef.current
    if (!el) return
    panState.current = { sx: e.clientX, sy: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
    e.preventDefault()
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
  const [lines, setLines] = useState<{ from: string; to: string; x1: number; y1: number; x2: number; y2: number }[]>([])
  // 楼层关系视图采用与平面图一致的「固定自然坐标尺寸」策略：宽度锁定坐标系 2200，
  // 高度按楼层数确定性计算（chip 绝对定位、canvas 高度固定，故每层高度恒定）。
  // 这样无论缩放与否都不会塌成一小块，且 mp-zoom 始终撑开滚动区域。
  // 宽度：原来 2200 在默认缩放下会横向超出编辑器区。收窄到 1600，配合楼层坐标（loc.x 0..2200
  // 以百分比映射到画布宽度）相对位置不变，仅整体更紧凑、不再大幅溢出。
  const STACK_W = 1600
  // 每层高度按 CSS 固定值确定性推算（.mp-stack-canvas 高度 200 + 楼层名与内边距约 52 = 252），
  // 不再依赖运行时测量，保证缩放盒高度与真实内容一致、不再塌成"只有长度没有高度"。
  const FLOOR_BLOCK = 252
  // 只有一层时画布加高，让单层平面图显示得更大更舒展（用户需求）。doc.floors 已可用，提前计算。
  const singleFloor = doc.floors.length === 1
  const FLOOR_CANVAS_H = singleFloor ? 400 : 200
  const FLOOR_BLOCK_EFF = singleFloor ? 452 : FLOOR_BLOCK
  const STACK_PAD = 32
  const GAP = 14
  const chipMovedRef = useRef(false)
  const chipDragRef = useRef<{ id: string; sx: number; sy: number; oxPct: number; oyPct: number; moved: boolean; rectW: number; rectH: number } | null>(null)

  // 高度由数据确定性推算（natH，见下方 floorsTopDown 之后），无需运行时测量。

  // Ctrl + 滚轮缩放（native 非被动监听，确保可 preventDefault）
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.3, 3))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setZoom])
  /** 跨层连线模式起点 */
  const [linkFromId, setLinkFromId] = useState<string | null>(null)
  const linkFromRef = useRef<string | null>(null)
  linkFromRef.current = linkFromId
  const [linkMouse, setLinkMouse] = useState<{ x: number; y: number } | null>(null)

  const floorsTopDown = useMemo(() => [...doc.floors].sort((a, b) => b.order - a.order), [doc])
  // 内容自然高度按楼层数确定性推算（与 CSS 各楼层固定高度一致），作为首帧兜底高度。
  // 真实高度由下方 ResizeObserver 测量 .mp-stack 的 offsetHeight 得到（不受 scale 影响），
  // 测量值优先用于撑开 .mp-zoom，杜绝"只有长度没有高度"或被 overflow:hidden 裁切。
  const natH = STACK_PAD + (floorsTopDown.length ? floorsTopDown.length * FLOOR_BLOCK_EFF + (floorsTopDown.length - 1) * GAP : 0)

  // 测量 .mp-stack 真实内容高度（offsetHeight 不受 transform:scale 影响），驱动缩放盒高度。
  useLayoutEffect(() => {
    const el = stackRef.current
    if (!el) return
    const measure = () => setContentH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [floorsTopDown.length])

  useLayoutEffect(() => {
    const base = stackRef.current?.getBoundingClientRect()
    if (!base) {
      setLines([])
      return
    }
    const z = zoom || 1
    const ls = (doc.links ?? [])
      .map((l) => {
        const a = chipEls.current.get(l.from)
        const b = chipEls.current.get(l.to)
        if (!a || !b) return null
        const ra = a.getBoundingClientRect()
        const rb = b.getBoundingClientRect()
        return {
          from: l.from,
          to: l.to,
          x1: (ra.left + ra.width / 2 - base.left) / z,
          y1: (ra.top + ra.height / 2 - base.top) / z,
          x2: (rb.left + rb.width / 2 - base.left) / z,
          y2: (rb.top + rb.height / 2 - base.top) / z,
        }
      })
      .filter(Boolean) as { from: string; to: string; x1: number; y1: number; x2: number; y2: number }[]
    setLines(ls)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, zoom])

  const startLink = (id: string) => {
    setLinkFromId(id)
    setLinkMouse(null)
  }
  const cancelLink = () => {
    setLinkFromId(null)
    setLinkMouse(null)
  }
  const completeLink = (to: string) => {
    const from = linkFromRef.current
    if (!from || to === from) {
      cancelLink()
      return
    }
    onAddLink(from, to)
    cancelLink()
  }

  /** 拖动地点卡片调整其在楼层画布中的位置（按百分比换算回 2200×1500 坐标） */
  const startChipDrag = (e: React.MouseEvent, loc: MapLocation) => {
    if (e.button !== 0) return
    const canvasEl = (e.currentTarget as HTMLElement).closest('.mp-stack-canvas') as HTMLElement | null
    if (!canvasEl) return
    const rect = canvasEl.getBoundingClientRect()
    chipMovedRef.current = false
    chipDragRef.current = {
      id: loc.id,
      sx: e.clientX,
      sy: e.clientY,
      oxPct: (loc.x / 2200) * 100,
      oyPct: (loc.y / 1500) * 64,
      moved: false,
      rectW: rect.width,
      rectH: rect.height,
    }
    e.stopPropagation()
    e.preventDefault()
    const move = (ev: MouseEvent) => {
      const d = chipDragRef.current
      if (!d) return
      const dxPx = ev.clientX - d.sx
      const dyPx = ev.clientY - d.sy
      if (Math.abs(dxPx) > 3 || Math.abs(dyPx) > 3) {
        d.moved = true
        chipMovedRef.current = true
      }
      const newLeftPct = clamp(d.oxPct + (dxPx / d.rectW) * 100, 0, 100)
      const newTopPct = clamp(d.oyPct + (dyPx / d.rectH) * 100, 6, 64)
      onMoveLoc(d.id, {
        x: Math.max(0, (newLeftPct / 100) * 2200),
        y: Math.max(0, Math.min(1500, (newTopPct / 64) * 1500)),
      })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      chipDragRef.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onLinkHandleDown = (e: React.MouseEvent, locId: string) => {
    e.stopPropagation()
    e.preventDefault()
    startLink(locId)
    window.addEventListener('mousemove', onLinkMove)
    window.addEventListener('mouseup', onLinkUp)
  }
  const onLinkMove = (e: MouseEvent) => {
    const base = stackRef.current?.getBoundingClientRect()
    if (!base) return
    const z = zoom || 1
    setLinkMouse({ x: (e.clientX - base.left) / z, y: (e.clientY - base.top) / z })
  }
  const onLinkUp = (e: MouseEvent) => {
    window.removeEventListener('mousemove', onLinkMove)
    window.removeEventListener('mouseup', onLinkUp)
    const from = linkFromRef.current
    if (!from) return
    let best: string | null = null
    let bestDist = Infinity
    for (const [id, el] of chipEls.current) {
      if (id === from) continue
      const r = el.getBoundingClientRect()
      const dist = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY)
      if (dist < bestDist) {
        bestDist = dist
        best = id
      }
    }
    if (best && bestDist <= 80) {
      onAddLink(from, best)
      cancelLink()
    }
    // 否则保持连线模式，等待点击目标
  }

  const onStackMouseMove = (e: React.MouseEvent) => {
    if (!linkFromRef.current || !stackRef.current) return
    const base = stackRef.current.getBoundingClientRect()
    const z = zoom || 1
    setLinkMouse({ x: (e.clientX - base.left) / z, y: (e.clientY - base.top) / z })
  }
  const onStackClick = () => {
    if (linkFromRef.current) cancelLink()
  }

  // ESC 取消跨层连线模式
  useEffect(() => {
    if (!linkFromId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelLink()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linkFromId])

  const linkSrc = linkFromId ? chipEls.current.get(linkFromId) : null
  const linkSrcPos = linkSrc
    ? (() => {
        const base = stackRef.current?.getBoundingClientRect()
        const r = linkSrc.getBoundingClientRect()
        if (!base) return null
        const z = zoom || 1
        return { x: (r.left + r.width / 2 - base.left) / z, y: (r.top + r.height / 2 - base.top) / z }
      })()
    : null

  const startLinkEdit = (l: MapLink) => setLinkEdit({ key: `${l.from}|${l.to}`, val: l.label ?? '' })

  return (
    <div className="mp-stack-wrap" ref={wrapRef} onMouseDown={onStackDown}>
      <div className="mp-bar">
        <span className="mp-hint">
          {linkFromId
            ? '连线模式：点击另一层地点完成跨层连接 · 点空白 / 自身 / ESC 取消'
            : '各层由下到上堆叠（方位＝横向位置）· 拖空白处平移视图 · 拖动地点卡片可调整位置 · 点 🔗↕ 后点另一层地点建立跨层连接 · Ctrl+滚轮缩放 · 点连接文字可编辑'}
        </span>
      </div>
      <div
        className="mp-zoom"
        style={{ width: STACK_W * zoom, height: (contentH || natH) * zoom }}
      >
      <div
        className="mp-stack"
        ref={stackRef}
        style={{ width: STACK_W, minHeight: natH, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
        onMouseMove={onStackMouseMove}
        onClick={onStackClick}
      >
        <svg className="mp-stack-edges">
          {lines.map((ln, i) => (
            <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} className="mp-stack-line" />
          ))}
          {/* 连线模式橡皮筋 */}
          {linkSrcPos && linkMouse && (
            <line x1={linkSrcPos.x} y1={linkSrcPos.y} x2={linkMouse.x} y2={linkMouse.y} className="mp-stack-line mp-line-temp" />
          )}
        </svg>

        {/* 跨层连接标签覆盖层 */}
        <div className="mp-stack-labels">
          {lines.map((ln, i) => {
            const key = `${ln.from}|${ln.to}`
            const mx = (ln.x1 + ln.x2) / 2
            const my = (ln.y1 + ln.y2) / 2
            const link = (doc.links ?? []).find((x) => x.from === ln.from && x.to === ln.to)
            return (
              <div key={i} className="mp-stack-label" style={{ left: mx, top: my }}>
                {linkEdit?.key === key ? (
                  <input
                    className="mp-edge-input"
                    autoFocus
                    value={linkEdit.val}
                    placeholder="楼梯/电梯"
                    onChange={(e) => setLinkEdit({ key, val: e.target.value })}
                    onBlur={() => {
                      onCommitLink(ln.from, ln.to, linkEdit.val.trim() || undefined)
                      setLinkEdit(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onCommitLink(ln.from, ln.to, linkEdit.val.trim() || undefined)
                        setLinkEdit(null)
                      }
                      if (e.key === 'Escape') setLinkEdit(null)
                    }}
                  />
                ) : (
                  <>
                    <span
                      className="mp-edge-text"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (link) startLinkEdit(link)
                      }}
                    >
                      {link?.label || '连接'}
                    </span>
                    <span
                      className="mp-del"
                      title="删除跨层连接"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteLink(ln.from, ln.to)
                      }}
                    >
                      ✕
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {floorsTopDown.map((f) => (
          <div className="mp-stack-floor" key={f.id}>
            <div className="mp-stack-floor-name">{f.name}</div>
            <div className="mp-stack-canvas" style={singleFloor ? { height: FLOOR_CANVAS_H } : undefined}>
              {f.locations.length === 0 && <span className="mp-stack-empty">（本层暂无地点）</span>}
              {f.locations.map((loc) => (
                <div
                  key={loc.id}
                  data-mp-stack-node={loc.id}
                  ref={(el) => {
                    if (el) chipEls.current.set(loc.id, el)
                    else chipEls.current.delete(loc.id)
                  }}
                  className={
                    'mp-stack-chip' +
                    (linkFromId === loc.id ? ' link-source' : '') +
                    (linkFromId && linkFromId !== loc.id ? ' link-armed' : '')
                  }
                  style={{
                    left: Math.min(92, Math.max(4, (loc.x / 2200) * 100)) + '%',
                    top: Math.min(64, Math.max(6, (loc.y / 1500) * 64)) + '%',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (linkFromId) {
                      if (loc.id === linkFromId) cancelLink()
                      else completeLink(loc.id)
                    } else {
                      if (!chipMovedRef.current) onOpenLoc(loc.id)
                      chipMovedRef.current = false
                    }
                  }}
                  onMouseDown={(e) => {
                    // 连接手柄启动跨层连线；卡片本体拖动以调整位置
                    if ((e.target as HTMLElement).classList.contains('mp-stack-chip-link')) {
                      onLinkHandleDown(e, loc.id)
                    } else {
                      startChipDrag(e, loc)
                    }
                  }}
                  title={loc.name}
                >
                  <span className="mp-stack-chip-name">{loc.name || '（未命名）'}</span>
                  <span
                    className="mp-stack-chip-link"
                    title="点此连到另一层地点"
                    onClick={(e) => e.stopPropagation()}
                  >
                    🔗↕
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}

/* ============================================================
   地点编辑弹窗
   ============================================================ */
interface ModalProps {
  loc: MapLocation
  placeOptions: Map<string, string>
  onSave: (patch: Partial<MapLocation>) => void
  onDelete: () => void
  onClose: () => void
}

function MapModal({ loc, placeOptions, onSave, onDelete, onClose }: ModalProps) {
  const [name, setName] = useState(loc.name)
  const [desc, setDesc] = useState(loc.desc)
  const [settingId, setSettingId] = useState<string | undefined>(loc.settingId)

  const commit = () => onSave({ name: name.trim() || '（未命名）', desc, settingId })
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => () => commitRef.current(), [])

  return (
    <div className="mat-modal ch-edit-modal" onClick={(e) => e.stopPropagation()}>
      <div className="mat-modal-head">
        <span>编辑地点 · {name || '（未命名）'}</span>
        <span className="mat-modal-close" title="关闭" onClick={onClose}>
          ✕
        </span>
      </div>

      <div className="ch-edit-grid">
        <div className="ch-edit-left">
          <div className="ch-region">
            <div className="ch-region-title">
              地点名称 <span className="ch-req">＊必填</span>
            </div>
            <input className="ch-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="ch-region">
            <div className="ch-region-title">关联设定地点</div>
            <div className="ch-tag-pool">
              {[...placeOptions.entries()].map(([id, nm]) => (
                <span
                  key={id}
                  className={'ch-tag-chip' + (settingId === id ? ' ch-tag-chip on' : '')}
                  onClick={() => setSettingId(settingId === id ? undefined : id)}
                >
                  {nm}
                </span>
              ))}
              {placeOptions.size === 0 && (
                <span className="pl-muted">暂无「地点」设定，请先在「设定」节点创建「地点」类条目</span>
              )}
            </div>
          </div>
        </div>

        <div className="ch-edit-right">
          <div className="ch-region" style={{ flex: 1, minHeight: 0 }}>
            <div className="ch-region-title">地点说明</div>
            <textarea
              className="ch-bio"
              style={{ flex: 1 }}
              value={desc}
              placeholder="地理、势力、风土、关键事件……"
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mat-modal-foot">
        <button className="tb-btn" style={{ color: '#d9483b' }} onClick={onDelete}>
          删除
        </button>
        <button className="tb-btn" onClick={commit}>
          完成
        </button>
      </div>
    </div>
  )
}
