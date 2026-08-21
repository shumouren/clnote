import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getNode } from '../store/useStore'
import { useListReorder } from '../components/useListReorder'
import {
  type SettingDoc,
  type SettingEntry,
  normalizeSetting,
  normalizeCharacter,
  normalizePlot,
  layoutPlot,
  newId,
  DEFAULT_SETTING_CATEGORIES,
} from '../model/types'

interface Props {
  nodeId: string
  paneId: 'left' | 'right'
  isActive: boolean
  onFocusPane: (p: 'left' | 'right') => void
}

export default function Setting({ nodeId, paneId, isActive, onFocusPane }: Props) {
  const saveNodeContent = useStore((s) => s.saveNodeContent)
  const nodes = useStore((s) => s.nodes)
  const [doc, setDoc] = useState<SettingDoc | null>(null)
  const [filter, setFilter] = useState<string>('__all__')
  const [editingId, setEditingId] = useState<string | null>(null)

  const docRef = useRef<SettingDoc | null>(null)
  docRef.current = doc
  const saveTimer = useRef<number | null>(null)

  const persist = (d: SettingDoc) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveNodeContent(nodeId, d), 500)
  }
  const update = (d: SettingDoc) => {
    setDoc(d)
    persist(d)
  }

  useEffect(() => {
    let cancelled = false
    getNode(nodeId).then((n) => {
      if (cancelled) return
      setDoc(normalizeSetting(n?.content))
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

  // 关联剧情：聚合所有 plot 节点里的情节项（id -> {名字, 派生标号}）
  const plotOptions = useMemo(() => {
    const m = new Map<string, { name: string; label: string }>()
    nodes
      .filter((n) => n.type === 'plot')
      .forEach((n) => {
        const d = normalizePlot(n.content)
        const lay = layoutPlot(d.items)
        d.items.forEach((it) => {
          const lab = lay.label.get(it.id)
          m.set(it.id, {
            name: it.title || '（未命名）',
            label: lab != null ? String(lab) : '',
          })
        })
      })
    return m
  }, [nodes])

  // 卡片列表（按当前类别过滤 + 排序）；必须在 early-return 之前调用，保证 hooks 顺序稳定
  const entries = useMemo(() => {
    if (!doc) return []
    const list = filter === '__all__' ? doc.entries : doc.entries.filter((e) => e.category === filter)
    return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }, [doc, filter])

  // 拖拽排序：在全量 entries 上重排并回写（过滤视图下拖拽也按全局顺序正确重排）
  const reorder = useListReorder(doc?.entries ?? [], (next) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, entries: next })
  })

  if (!doc) return <div className="st-pane st-loading">加载中…</div>

  /* ---------------- 操作 ---------------- */

  const updateEntry = (id: string, patch: Partial<SettingEntry>) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }

  const deleteEntry = (id: string) => {
    const d = docRef.current
    if (!d) return
    update({ ...d, entries: d.entries.filter((e) => e.id !== id) })
    setEditingId(null)
  }

  const addCategory = (name: string) => {
    const d = docRef.current
    if (!d || !name || d.categories.includes(name)) return
    update({ ...d, categories: [...d.categories, name] })
  }

  const deleteCategory = (name: string) => {
    const d = docRef.current
    if (!d || d.categories.length <= 1) return // 至少保留一个类别
    const remaining = d.categories.filter((c) => c !== name)
    const fallback = remaining[0] ?? DEFAULT_SETTING_CATEGORIES[0]
    update({
      ...d,
      categories: remaining,
      entries: d.entries.map((e) => (e.category === name ? { ...e, category: fallback } : e)),
    })
  }

  const addEntry = () => {
    const d = docRef.current
    if (!d) return
    const entry: SettingEntry = {
      id: newId(),
      name: '',
      category: filter !== '__all__' ? filter : d.categories[0] ?? '其他',
      desc: '',
      charIds: [],
      plotIds: [],
    }
    update({ ...d, entries: [...d.entries, entry] })
    setEditingId(entry.id)
  }

  const editing = editingId ? doc.entries.find((e) => e.id === editingId) ?? null : null

  return (
    <div className="st-pane" onClick={() => onFocusPane(paneId)}>
      {/* 工具栏：类别过滤 + 新建 */}
      <div className="st-bar">
        <div className="st-filters">
          <button className={'st-filter' + (filter === '__all__' ? ' on' : '')} onClick={() => setFilter('__all__')}>
            全部
          </button>
          {doc.categories.map((c) => (
            <button
              key={c}
              className={'st-filter' + (filter === c ? ' on' : '')}
              onClick={() => setFilter(c)}
            >
              <span className="st-filter-label">{c}</span>
              {doc.categories.length > 1 && (
                <span
                  className="st-filter-del"
                  title="删除该类别"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (filter === c) setFilter('__all__')
                    deleteCategory(c)
                  }}
                >
                  ✕
                </span>
              )}
            </button>
          ))}
        </div>
        <span className="tb-spacer" />
        <button className="tb-btn primary" onClick={addEntry}>
          ＋ 新建设定
        </button>
      </div>

      {/* 卡片网格 */}
      <div className="st-body">
        {entries.length === 0 ? (
          <div className="st-empty">这一类还没有设定。点右上角「＋ 新建设定」开始记录你的世界观。</div>
        ) : (
            <div className="st-grid">
            {entries.map((e) => (
              <div
                key={e.id}
                className={
                  'st-card' +
                  (reorder.dragId === e.id ? ' dragging' : '') +
                  (reorder.overId === e.id ? ' over' : '')
                }
                draggable
                onDragStart={(ev) => reorder.beginDrag(ev, e.id)}
                onDragOver={(ev) => reorder.onDragOver(ev, e.id)}
                onDrop={(ev) => reorder.drop(ev, e.id)}
                onDragEnd={reorder.endDrag}
                onClick={() => setEditingId(e.id)}
              >
                <div className="st-card-top">
                  <span className="st-cat">{e.category}</span>
                </div>
                <div className="st-name">{e.name || '（未命名）'}</div>
                {e.desc && <div className="st-desc">{e.desc}</div>}
                {(e.charIds.length > 0 || e.plotIds.length > 0) && (
                  <div className="st-rel">
                    {e.charIds.length > 0 && <span className="st-chip">🧑 {e.charIds.length}</span>}
                    {e.plotIds.length > 0 && <span className="st-chip">🎬 {e.plotIds.length}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="mat-modal-mask" onClick={() => setEditingId(null)}>
          <SettingModal
            entry={editing}
            categories={doc.categories}
            charOptions={charOptions}
            plotOptions={plotOptions}
            onAddCategory={addCategory}
            onDeleteCategory={deleteCategory}
            onSave={(patch) => {
              updateEntry(editing.id, patch)
              setEditingId(null)
            }}
            onDelete={() => deleteEntry(editing.id)}
            onClose={() => setEditingId(null)}
          />
        </div>
      )}
    </div>
  )
}

/* ============================================================
   编辑弹窗（复用 .ch-edit-modal 栅格：左 名称/类别/关联，右 描述）
   ============================================================ */

interface ModalProps {
  entry: SettingEntry
  categories: string[]
  charOptions: Map<string, string>
  plotOptions: Map<string, { name: string; label: string }>
  onAddCategory: (name: string) => void
  onDeleteCategory: (name: string) => void
  onSave: (patch: Partial<SettingEntry>) => void
  onDelete: () => void
  onClose: () => void
}

function SettingModal({
  entry,
  categories,
  charOptions,
  plotOptions,
  onAddCategory,
  onDeleteCategory,
  onSave,
  onDelete,
  onClose,
}: ModalProps) {
  const [name, setName] = useState(entry.name)
  const [category, setCategory] = useState(entry.category)
  const [desc, setDesc] = useState(entry.desc)
  const [charIds, setCharIds] = useState<string[]>(entry.charIds)
  const [plotIds, setPlotIds] = useState<string[]>(entry.plotIds)
  const [newCat, setNewCat] = useState('')

  const toggle = (arr: string[], setArr: (v: string[]) => void, id: string) =>
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  const addCategory = () => {
    const v = newCat.trim()
    if (!v || categories.includes(v)) {
      setNewCat('')
      return
    }
    onAddCategory(v)
    setCategory(v)
    setNewCat('')
  }

  const commit = () => onSave({ name: name.trim() || '（未命名）', category, desc, charIds, plotIds })
  // 关闭（无论点「完成」还是点空白）都落盘，避免漏存
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => () => commitRef.current(), [])

  return (
    <div className="mat-modal ch-edit-modal" onClick={(e) => e.stopPropagation()}>
      <div className="mat-modal-head">
        <span>编辑设定 · {name || '（未命名）'}</span>
        <span className="mat-modal-close" title="关闭" onClick={onClose}>
          ✕
        </span>
      </div>

      <div className="ch-edit-grid">
        <div className="ch-edit-left">
          <div className="ch-region">
            <div className="ch-region-title">
              名称 <span className="ch-req">＊必填</span>
            </div>
            <input className="ch-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="ch-region">
            <div className="ch-region-title">类别</div>
            <div className="ch-tag-pool">
              {categories.map((c) => (
                <span
                  key={c}
                  className={'ch-tag-chip' + (category === c ? ' ch-tag-chip on' : '')}
                  onClick={() => setCategory(c)}
                >
                  {c}
                  {categories.length > 1 && (
                    <span
                      className="ch-tag-del"
                      title="删除该类别"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (categories.length <= 1) return
                        const fb = categories.filter((x) => x !== c)[0] ?? '其他'
                        if (category === c) setCategory(fb)
                        onDeleteCategory(c)
                      }}
                    >
                      ✕
                    </span>
                  )}
                </span>
              ))}
            </div>
            <div className="ch-tag-add">
              <input
                className="ch-input"
                placeholder="新类别名"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCategory()
                }}
              />
              <button className="tb-btn" onClick={addCategory}>
                ＋
              </button>
            </div>
          </div>

          <div className="ch-region">
            <div className="ch-region-title">关联角色</div>
            <div className="ch-tag-pool">
              {[...charOptions.entries()].map(([id, nm]) => (
                <span
                  key={id}
                  className={'ch-tag-chip' + (charIds.includes(id) ? ' ch-tag-chip on' : '')}
                  onClick={() => toggle(charIds, setCharIds, id)}
                >
                  {nm || '（未命名）'}
                </span>
              ))}
              {charOptions.size === 0 && <span className="pl-muted">暂无角色，请先在「角色」节点创建</span>}
            </div>
          </div>

          <div className="ch-region">
            <div className="ch-region-title">关联剧情</div>
            <div className="ch-tag-pool">
              {[...plotOptions.entries()].map(([id, info]) => (
                <span
                  key={id}
                  className={'ch-tag-chip' + (plotIds.includes(id) ? ' ch-tag-chip on' : '')}
                  onClick={() => toggle(plotIds, setPlotIds, id)}
                >
                  {info.label ? info.label + '. ' : ''}
                  {info.name}
                </span>
              ))}
              {plotOptions.size === 0 && <span className="pl-muted">暂无剧情</span>}
            </div>
          </div>
        </div>

        <div className="ch-edit-right">
          <div className="ch-region" style={{ flex: 1, minHeight: 0 }}>
            <div className="ch-region-title">设定描述</div>
            <textarea
              className="ch-bio"
              style={{ flex: 1 }}
              value={desc}
              placeholder="世界观、背景、规则、来历、细节……"
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
