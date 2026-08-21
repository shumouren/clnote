import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getNode } from '../store/useStore'
import {
  type CharacterDoc,
  type Character,
  normalizeCharacter,
  emptyCharacter,
  makeCharacter,
  newId,
} from '../model/types'

const CH_W = 184
const CH_H = 96
// 关系类型从 doc.relTypes 读取，支持用户自定义增删

interface Props {
  nodeId: string
  paneId: 'left' | 'right'
  isActive: boolean
  onFocusPane: (p: 'left' | 'right') => void
}

/** 角色卡集合编辑器：仅关系图展览模式；点击卡片「编辑」弹出编辑弹窗（左=姓名/属性/标签，右=人物小传） */
export default function Character({ nodeId, paneId, isActive, onFocusPane }: Props) {
  const saveNodeContent = useStore((s) => s.saveNodeContent)
  const [doc, setDoc] = useState<CharacterDoc | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [relInput, setRelInput] = useState('')

  /** 始终指向最新 doc，供鼠标事件回调读取 */
  const docRef = useRef<CharacterDoc | null>(null)
  docRef.current = doc
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedId

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<
    | { id: string; mode: 'move' | 'link'; sx: number; sy: number; moved: boolean; origX: number; origY: number }
    | null
  >(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null)

  const saveTimer = useRef<number | null>(null)

  const persist = (d: CharacterDoc) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveNodeContent(nodeId, d), 500)
  }
  const update = (d: CharacterDoc) => {
    setDoc(d)
    persist(d)
  }

  useEffect(() => {
    let cancelled = false
    getNode(nodeId).then((n) => {
      if (cancelled) return
      const d = normalizeCharacter(n?.content) ?? emptyCharacter()
      setDoc(d)
      if (d.items.length) setSelectedId(d.items[0].id)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const items = doc?.items ?? []
  const tagPool = doc?.tagPool ?? []
  const relTypes = doc?.relTypes ?? []
  const selected = items.find((c) => c.id === selectedId) ?? items[0] ?? null
  const editing = editingId ? items.find((c) => c.id === editingId) ?? null : null

  /* ---------------- 操作 ---------------- */
  const addCharacter = () => {
    const d = docRef.current
    if (!d) return
    const c = makeCharacter()
    update({ ...d, items: [...d.items, c] })
    setSelectedId(c.id)
  }
  const deleteCharacter = (id: string) => {
    const d = docRef.current
    if (!d) return
    const items2 = d.items.filter((c) => c.id !== id)
    const relations = (d.relations ?? []).filter((r) => r.from !== id && r.to !== id)
    const next = items2.length ? items2 : [makeCharacter()]
    update({ items: next, relations, tagPool: d.tagPool })
    setSelectedId(next[0].id)
    if (editingId === id) setEditingId(null)
  }
  const updateField = (id: string, patch: Partial<Character>) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, items: d.items.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  }
  const updateName = (id: string, name: string) => updateField(id, { name })
  const updateBio = (id: string, bio: string) => updateField(id, { bio })

  const updateAttr = (id: string, attrId: string, patch: Partial<{ name: string; value: string }>) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      items: d.items.map((c) =>
        c.id === id
          ? { ...c, attrs: c.attrs.map((a) => (a.id === attrId ? { ...a, ...patch } : a)) }
          : c,
      ),
    })
  }
  const addAttr = (id: string) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      items: d.items.map((c) =>
        c.id === id ? { ...c, attrs: [...c.attrs, { id: newId(), name: '', value: '' }] } : c,
      ),
    })
  }
  const removeAttr = (id: string, attrId: string) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      items: d.items.map((c) =>
        c.id === id ? { ...c, attrs: c.attrs.filter((a) => a.id !== attrId) } : c,
      ),
    })
  }

  const toggleTag = (id: string, tag: string) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      items: d.items.map((c) => {
        if (c.id !== id) return c
        const has = c.tags.includes(tag)
        return { ...c, tags: has ? c.tags.filter((t) => t !== tag) : [...c.tags, tag] }
      }),
    })
  }
  const addTag = (id: string, tag: string) => {
    const d = docRef.current
    if (!d) return
    const pool = d.tagPool.includes(tag) ? d.tagPool : [...d.tagPool, tag]
    const items2 = d.items.map((c) =>
      c.id === id && !c.tags.includes(tag) ? { ...c, tags: [...c.tags, tag] } : c,
    )
    update({ tagPool: pool, items: items2 })
  }

  const setPos = (id: string, x: number, y: number) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, items: d.items.map((c) => (c.id === id ? { ...c, x, y } : c)) })
  }
  const addRelation = (from: string, to: string, type: string) => {
    const d = docRef.current
    if (!d || from === to) return
    const relations = d.relations ?? []
    if (relations.some((r) => r.from === from && r.to === to)) return
    update({ ...d, relations: [...relations, { from, to, type }] })
  }
  const removeRelation = (from: string, to: string) => {
    const d = docRef.current
    if (!d) return
    update({
      ...d,
      relations: (d.relations ?? []).filter((r) => !(r.from === from && r.to === to)),
    })
  }
  const setRelTypes = (types: string[]) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, relTypes: types })
  }
  const addRelType = (type: string) => {
    const d = docRef.current
    if (!d) return
    const cur = d.relTypes ?? []
    if (!type || cur.includes(type)) return
    setRelTypes([...cur, type])
  }
  const removeRelType = (type: string) => {
    const d = docRef.current
    if (!d) return
    setRelTypes((d.relTypes ?? []).filter((t) => t !== type))
  }
  /** 新建自定义关系类型，并立即建立该连线 */
  const addRelTypeAndApply = (type: string) => {
    const t = type.trim()
    if (!t || !pending) return
    addRelType(t)
    addRelation(pending.from, pending.to, t)
    setPending(null)
    setRelInput('')
  }

  /* ---------------- 关系图坐标 ---------------- */
  const posOf = (c: Character, index: number) => ({
    x: typeof c.x === 'number' ? c.x : 40 + (index % 4) * (CH_W + 48),
    y: typeof c.y === 'number' ? c.y : 40 + Math.floor(index / 4) * (CH_H + 56),
  })

  const layerFromClient = (clientX: number, clientY: number) => {
    const el = canvasRef.current
    const rect = el?.getBoundingClientRect()
    const sl = el?.scrollLeft ?? 0
    const st = el?.scrollTop ?? 0
    return { x: clientX - (rect?.left ?? 0) + sl, y: clientY - (rect?.top ?? 0) + st }
  }

  const onNodeMouseDown = (e: React.MouseEvent, c: Character, index: number, mode: 'move' | 'link') => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onFocusPane(paneId)
    setSelectedId(c.id)
    const p = posOf(c, index)
    dragRef.current = { id: c.id, mode, sx: e.clientX, sy: e.clientY, moved: false, origX: p.x, origY: p.y }
    const move = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dist = Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy)
      if (!d.moved && dist > 4) {
        d.moved = true
        if (d.mode === 'link') setDragPos(layerFromClient(d.sx, d.sy))
      }
      if (d.moved) {
        if (d.mode === 'move') {
          const lp = layerFromClient(ev.clientX, ev.clientY)
          setPos(d.id, lp.x - CH_W / 2, lp.y - CH_H / 2)
        } else {
          const lp = layerFromClient(ev.clientX, ev.clientY)
          setDragPos(lp)
          const elx = document.elementFromPoint(ev.clientX, ev.clientY)
          const tid = elx?.closest('[data-ch-id]')?.getAttribute('data-ch-id')
          setHoverTargetId(tid && tid !== d.id ? tid : null)
        }
      }
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = dragRef.current
      dragRef.current = null
      setDragPos(null)
      setHoverTargetId(null)
      if (!d || !d.moved) return
      if (d.mode === 'link') {
        const elx = document.elementFromPoint(ev.clientX, ev.clientY)
        const targetId = elx?.closest('[data-ch-id]')?.getAttribute('data-ch-id')
        if (targetId && targetId !== d.id) setPending({ from: d.id, to: targetId })
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /* ---------------- 关系图渲染 ---------------- */
  const graph = useMemo(() => {
    const els: JSX.Element[] = []
    const posMap: Record<string, { x: number; y: number }> = {}
    items.forEach((c, i) => {
      const p = posOf(c, i)
      posMap[c.id] = { x: p.x + CH_W / 2, y: p.y + CH_H / 2 }
    })
    // 连线（在节点下方）
    ;(doc?.relations ?? []).forEach((r, i) => {
      const a = posMap[r.from]
      const b = posMap[r.to]
      if (!a || !b) return
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      els.push(
        <g key={'rel' + i} className="ch-rel">
          <path
            className="ch-edge"
            d={`M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y}`}
          />
          <text className="ch-edge-label" x={mx} y={my} onClick={() => removeRelation(r.from, r.to)}>
            {r.type} ✕
          </text>
        </g>,
      )
    })
    // 拖拽预览虚线
    if (dragPos && dragRef.current && dragRef.current.mode === 'link') {
      const a = posMap[dragRef.current.id]
      if (a) els.push(<path key="drag" className="ch-edge linking" d={`M ${a.x} ${a.y} L ${dragPos.x} ${dragPos.y}`} />)
    }
    return { els, posMap }
  }, [doc, items, dragPos])

  const graphWidth = Math.max(...items.map((c, i) => posOf(c, i).x + CH_W + 60), 400)
  const graphHeight = Math.max(...items.map((c, i) => posOf(c, i).y + CH_H + 60), 300)

  if (!doc) return <div className="mm-loading">加载中…</div>

  const openEdit = (id: string) => {
    setSelectedId(id)
    setEditingId(id)
  }

  return (
    <div
      className={'pane-inner ch-pane' + (isActive ? ' active' : '')}
      onClick={() => onFocusPane(paneId)}
    >
      <div className="pane-toolbar ch-toolbar">
        <button className="tb-btn" onClick={addCharacter} title="新建角色卡">
          ＋角色
        </button>
        <button
          className="tb-btn"
          disabled={!selected}
          onClick={() => selected && deleteCharacter(selected.id)}
          title="删除当前角色（Del）"
        >
          删除
        </button>
        <button
          className="tb-btn"
          disabled={!selected || items.findIndex((c) => c.id === selected.id) <= 0}
          onClick={() => {
            const idx = items.findIndex((c) => c.id === selected!.id)
            setSelectedId(items[idx - 1].id)
          }}
          title="上一个"
        >
          ↑上
        </button>
        <button
          className="tb-btn"
          disabled={!selected || items.findIndex((c) => c.id === selected.id) >= items.length - 1}
          onClick={() => {
            const idx = items.findIndex((c) => c.id === selected!.id)
            setSelectedId(items[idx + 1].id)
          }}
          title="下一个"
        >
          ↓下
        </button>
        <span className="mm-sel">共 {items.length} 个角色</span>
        <span className="tb-spacer" />
        <span className="ch-hint">关系图模式 · 点卡片「编辑」修改资料</span>
      </div>

      <div className="ch-body">
        {/* 主区：仅关系图 */}
        <div className="ch-main">
          <div className="ch-canvas" ref={canvasRef}>
            <div className="ch-layer" style={{ width: graphWidth, height: graphHeight }}>
              <svg className="ch-edges" width={graphWidth} height={graphHeight}>
                {graph.els}
              </svg>
              {items.map((c, i) => {
                const p = posOf(c, i)
                const isSel = c.id === selectedId
                const isDrop = c.id === hoverTargetId
                return (
                  <div
                    key={c.id}
                    data-ch-id={c.id}
                    className={'ch-node' + (isSel ? ' selected' : '') + (isDrop ? ' ch-drop' : '')}
                    style={{ left: p.x, top: p.y, width: CH_W, height: CH_H }}
                    onMouseDown={(e) => onNodeMouseDown(e, c, i, 'move')}
                  >
                    <div className="ch-node-name">{c.name || '（未命名）'}</div>
                    <div className="ch-node-tags">
                      {c.tags.map((t) => (
                        <span key={t} className="ch-tag">
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="ch-node-actions">
                      <span
                        className="ch-link-handle"
                        title="拖到另一角色上建立关系"
                        onMouseDown={(e) => onNodeMouseDown(e, c, i, 'link')}
                      >
                        🔗
                      </span>
                      <button
                        className="ch-edit-btn"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => openEdit(c.id)}
                      >
                        编辑
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 关系类型选择弹层 */}
      {pending && (
        <div className="mat-modal-mask" onClick={() => setPending(null)}>
          <div className="mat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mat-modal-head">
              <span>选择关系类型</span>
            </div>
            <div className="ch-rel-types">
              {relTypes.map((t) => (
                <span key={t} className="ch-rel-type-chip">
                  <button
                    className="tb-btn"
                    onClick={() => {
                      addRelation(pending.from, pending.to, t)
                      setPending(null)
                    }}
                  >
                    {t}
                  </button>
                  <span
                    className="ch-rel-type-del"
                    title="删除此关系类型"
                    onClick={() => removeRelType(t)}
                  >
                    ✕
                  </span>
                </span>
              ))}
            </div>
            <div className="ch-rel-add">
              <input
                className="ch-input"
                placeholder="自定义关系类型"
                value={relInput}
                onChange={(e) => setRelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && relInput.trim()) addRelTypeAndApply(relInput)
                }}
              />
              <button
                className="tb-btn"
                onClick={() => relInput.trim() && addRelTypeAndApply(relInput)}
              >
                ＋新建
              </button>
            </div>
            <div className="mat-modal-foot">
              <button className="tb-btn" onClick={() => setPending(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 角色编辑弹窗 */}
      {editing && (
        <div className="mat-modal-mask" onClick={() => setEditingId(null)}>
          <div className="mat-modal ch-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mat-modal-head">
              <span>编辑角色 · {editing.name || '（未命名）'}</span>
              <span className="mat-modal-close" title="关闭" onClick={() => setEditingId(null)}>
                ✕
              </span>
            </div>

            <div className="ch-edit-grid">
              <div className="ch-edit-left">
                <div className="ch-region">
                  <div className="ch-region-title">
                    角色姓名 <span className="ch-req">＊必填</span>
                  </div>
                  <input
                    className="ch-input"
                    placeholder="角色姓名"
                    value={editing.name}
                    onChange={(e) => updateName(editing.id, e.target.value)}
                  />
                </div>

                <div className="ch-region">
                  <div className="ch-region-title">
                    角色属性 <span className="ch-hint">名字可自定义，可新建</span>
                  </div>
                  <div className="ch-attr-list">
                    {editing.attrs.map((a) => (
                      <div className="ch-attr" key={a.id}>
                        <div className="ch-attr-row">
                          <input
                            className="ch-attr-name"
                            placeholder="属性名"
                            value={a.name}
                            onChange={(e) => updateAttr(editing.id, a.id, { name: e.target.value })}
                          />
                          <button
                            className="ch-mini-btn"
                            title="删除该属性"
                            onClick={() => removeAttr(editing.id, a.id)}
                          >
                            ✕
                          </button>
                        </div>
                        <textarea
                          className="ch-input"
                          rows={2}
                          placeholder="内容"
                          value={a.value}
                          onChange={(e) => updateAttr(editing.id, a.id, { value: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                  <button className="tb-btn" onClick={() => addAttr(editing.id)}>
                    ＋新建属性
                  </button>
                </div>

                <div className="ch-region">
                  <div className="ch-region-title">
                    标签 <span className="ch-hint">所有角色卡片共用</span>
                  </div>
                  <div className="ch-tag-pool">
                    {tagPool.length === 0 && <span className="ch-hint">（还没有标签，在下面新建）</span>}
                    {tagPool.map((t) => {
                      const on = editing.tags.includes(t)
                      return (
                        <span
                          key={t}
                          className={'ch-tag-chip' + (on ? ' on' : '')}
                          onClick={() => toggleTag(editing.id, t)}
                          title={on ? '点击取消该标签' : '点击添加该标签'}
                        >
                          {t}
                          {on ? ' ✕' : ''}
                        </span>
                      )
                    })}
                  </div>
                  <div className="ch-tag-add">
                    <input
                      className="ch-input"
                      placeholder="新建标签名"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tagInput.trim()) {
                          addTag(editing.id, tagInput.trim())
                          setTagInput('')
                        }
                      }}
                    />
                    <button
                      className="tb-btn"
                      onClick={() => {
                        if (tagInput.trim()) {
                          addTag(editing.id, tagInput.trim())
                          setTagInput('')
                        }
                      }}
                    >
                      ＋新建
                    </button>
                  </div>
                </div>
              </div>

              <div className="ch-edit-right">
                <div className="ch-region-title">人物小传</div>
                <textarea
                  className="ch-bio"
                  placeholder="在此输入人物介绍、背景、成长线等…"
                  value={editing.bio}
                  onChange={(e) => updateBio(editing.id, e.target.value)}
                />
              </div>
            </div>

            <div className="mat-modal-foot">
              <button className="tb-btn" onClick={() => setEditingId(null)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
