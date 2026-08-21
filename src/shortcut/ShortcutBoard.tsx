import { useEffect, useMemo, useState } from 'react'
import {
  emptyShortcut,
  SHORTCUT_KIND_META,
  type AssetCategory,
  type ShortcutItem,
  type ShortcutKind,
} from '../model/types'
import {
  deleteShortcut,
  deleteShortcutCategory,
  listShortcutCategories,
  listShortcuts,
  saveShortcut,
  saveShortcutCategory,
  clearAllShortcuts,
  getShortcut,
} from '../storage/shortcuts'
import { useStore } from '../store/useStore'
import { openFolder, openUrl } from '../platform/open'
import { pickFolder } from '../platform/pickFolder'
import { confirmAsync, promptAsync } from '../platform/dialog'

/** 求某分类的全部子孙 id（含自身） */
function descendantIds(cats: AssetCategory[], rootId: string): Set<string> {
  const childrenOf = (id: string) => cats.filter((c) => (c.parentId ?? null) === id)
  const out = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    for (const c of childrenOf(id)) {
      if (!out.has(c.id)) {
        out.add(c.id)
        stack.push(c.id)
      }
    }
  }
  return out
}

/** 求某分类到根的路径（含自身） */
function pathOf(cats: AssetCategory[], id: string): AssetCategory[] {
  const map = new Map(cats.map((c) => [c.id, c]))
  const path: AssetCategory[] = []
  let cur: AssetCategory | undefined = map.get(id)
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId ? map.get(cur.parentId) : undefined
  }
  return path
}

/** 中栏的"快捷"看板：嵌套分类 + 三类快捷（文件夹/链接/笔记）的卡片展示与增删改 */
export default function ShortcutBoard() {
  const activeCategoryId = useStore((s) => s.activeShortcutCategoryId)
  const setActiveCategory = useStore((s) => s.setActiveShortcutCategory)

  const selectedId = activeCategoryId && activeCategoryId !== '__all__' ? activeCategoryId : null

  const [allItems, setAllItems] = useState<ShortcutItem[]>([])
  const [cats, setCats] = useState<AssetCategory[]>([])
  const [selectedCat, setSelectedCat] = useState<AssetCategory | null>(null)
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<ShortcutKind | 'all'>('all')
  const [draft, setDraft] = useState<ShortcutItem | null>(null)
  const [tagsText, setTagsText] = useState('')
  const [hint, setHint] = useState('')

  const refresh = () => {
    listShortcuts()
      .then(setAllItems)
      .finally(() => setLoading(false))
    listShortcutCategories().then((list) => {
      setCats(list)
      setSelectedCat(selectedId ? list.find((c) => c.id === selectedId) ?? null : null)
    })
  }
  useEffect(() => {
    setLoading(true)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryId])

  const descSet = useMemo(
    () => (selectedId ? descendantIds(cats, selectedId) : null),
    [cats, selectedId],
  )

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allItems
      .filter((a) => !descSet || descSet.has(a.categoryId))
      .filter((a) => kindFilter === 'all' || a.kind === kindFilter)
      .filter((a) => {
        if (!q) return true
        const hay = [a.title, a.path, a.url, a.content, ...a.tags]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, descSet, kindFilter, query])

  const flash = (msg: string) => {
    setHint(msg)
    window.setTimeout(() => setHint(''), 1600)
  }

  /* 数字排序：卡片右上角显示序号（按 order 从 1 开始），
     「↑ 前进 / ↓ 后退」交换相邻卡片 order，整库按数字排序。
     注意：Rust 返回的快捷字段是 orderIdx（camelCase），读写都用 orderIdx。 */
  const ordOf = (x: ShortcutItem) =>
    ((x as ShortcutItem & { orderIdx?: number }).orderIdx ?? x.order ?? 0)
  const sortedItems = useMemo(
    () => [...allItems].sort((a, b) => ordOf(a) - ordOf(b)),
    [allItems],
  )
  const indexOf = (id: string) => sortedItems.findIndex((a) => a.id === id)
  const moveItem = async (id: string, dir: -1 | 1) => {
    const idx = indexOf(id)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= sortedItems.length) return
    const a = sortedItems[idx]
    const b = sortedItems[j]
    await Promise.all([
      saveShortcut({ ...a, orderIdx: ordOf(b) } as ShortcutItem & { orderIdx?: number }),
      saveShortcut({ ...b, orderIdx: ordOf(a) } as ShortcutItem & { orderIdx?: number }),
    ])
    await refresh()
  }

  /* 搜索结果点击后，自动跳进并打开该快捷（文件夹→打开目录 / 链接→浏览器 / 笔记→编辑）。
     直接按 id 取快捷，不依赖本板是否已载入列表，避免停留在别的页面 / 列表未就绪时跳不过去。 */
  const focusShortcutId = useStore((s) => s.focusShortcutId)
  const setFocusShortcut = useStore((s) => s.setFocusShortcut)
  useEffect(() => {
    if (!focusShortcutId) return
    let cancelled = false
    getShortcut(focusShortcutId).then((a) => {
      if (a && !cancelled) {
        primaryAction(a)
        setFocusShortcut(null)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusShortcutId])

  const openNew = (kind: ShortcutKind) => {
    setDraft(emptyShortcut(kind, selectedId ?? ''))
    setTagsText('')
  }
  const openEdit = (a: ShortcutItem) => {
    setDraft({ ...a })
    setTagsText(a.tags.join(', '))
  }

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim()) {
      flash('请填写名称')
      return
    }
    if (draft.kind === 'folder' && !draft.path?.trim()) {
      flash('请选择本地文件夹')
      return
    }
    if (draft.kind === 'link' && !draft.url?.trim()) {
      flash('请填写链接地址')
      return
    }
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const order = draft.order ?? allItems.length
    const next: ShortcutItem = { ...draft, title: draft.title.trim(), tags, order }
    await saveShortcut(next)
    setDraft(null)
    refresh()
    flash('已保存')
  }

  const remove = async (a: ShortcutItem) => {
    const label = SHORTCUT_KIND_META[a.kind].label
    if (!(await confirmAsync(`确定删除${label}「${a.title}」？`))) return
    await deleteShortcut(a.id)
    refresh()
  }

  const copy = async (a: ShortcutItem) => {
    const text = a.kind === 'folder' ? a.path : a.kind === 'link' ? a.url : a.content
    try {
      await navigator.clipboard.writeText(text ?? '')
      flash('已复制到剪贴板')
    } catch {
      flash('复制失败')
    }
  }

  const onPickFolder = async () => {
    const p = await pickFolder()
    if (p && draft) setDraft({ ...draft, path: p })
  }

  /* ---- 分类：重命名 / 删除 ---- */
  const renameCat = async () => {
    if (!selectedCat) return
    const name = await promptAsync('重命名分类', selectedCat.name)
    if (!name || !name.trim()) return
    const next = { ...selectedCat, name: name.trim() }
    await saveShortcutCategory(next)
    setSelectedCat(next)
    setCats((cs) => cs.map((c) => (c.id === next.id ? next : c)))
  }
  const deleteCat = async () => {
    if (!selectedCat) return
    if (
      !(await confirmAsync(
        `删除「${selectedCat.name}」？其下所有子分类与快捷会一并删除（不可恢复）。`,
      ))
    )
      return
    await deleteShortcutCategory(selectedCat.id)
    setActiveCategory('__all__')
  }

  const clearAll = async () => {
    if (!(await confirmAsync('确定清空快捷库的全部快捷与分类？此操作不可恢复。'))) return
    await clearAllShortcuts()
    refresh()
    flash('已清空快捷库')
  }

  const breadcrumb = selectedCat ? pathOf(cats, selectedCat.id) : []
  const title = selectedCat
    ? breadcrumb.map((c) => `${c.icon}${c.name}`).join(' / ')
    : '快捷库'

  const primaryAction = (a: ShortcutItem) => {
    if (a.kind === 'folder') {
      if (a.path) openFolder(a.path)
      else flash('未设置文件夹路径')
    } else if (a.kind === 'link') {
      if (a.url) openUrl(a.url)
      else flash('未设置链接')
    } else {
      openEdit(a) // 笔记：点击进入编辑
    }
  }

  return (
    <div className="theme-board">
      <div className="theme-board-bar">
        <span className="theme-board-title" title={selectedCat?.name}>
          {title}
        </span>
        <input
          className="mat-search"
          placeholder="搜索快捷…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="tb-btn" onClick={() => openNew('folder')} disabled={cats.length === 0 || !selectedId} title={!selectedId ? '请先在左侧选择主题或文件夹' : cats.length === 0 ? '请先建立主题或文件夹' : '新建快捷文件夹'}>
          ＋ 快捷文件夹
        </button>
        <button className="tb-btn" onClick={() => openNew('link')} disabled={cats.length === 0 || !selectedId} title={!selectedId ? '请先在左侧选择主题或文件夹' : cats.length === 0 ? '请先建立主题或文件夹' : '新建快捷链接'}>
          ＋ 快捷链接
        </button>
        <button className="tb-btn" onClick={() => openNew('note')} disabled={cats.length === 0 || !selectedId} title={!selectedId ? '请先在左侧选择主题或文件夹' : cats.length === 0 ? '请先建立主题或文件夹' : '新建快捷笔记'}>
          ＋ 快捷笔记
        </button>
        <button className="tb-btn danger" onClick={clearAll} title="清空快捷库全部快捷与分类">
          清空全部
        </button>
        {selectedCat && (
          <>
            <button className="tb-btn" onClick={renameCat} title="重命名分类">
              重命名
            </button>
            <button className="tb-btn danger" onClick={deleteCat} title="删除分类">
              删除分类
            </button>
          </>
        )}
      </div>

      <div className="mat-filters">
        <button
          className={'mat-chip' + (kindFilter === 'all' ? ' active' : '')}
          onClick={() => setKindFilter('all')}
        >
          全部
        </button>
        {(Object.keys(SHORTCUT_KIND_META) as ShortcutKind[]).map((k) => (
          <button
            key={k}
            className={'mat-chip' + (kindFilter === k ? ' active' : '')}
            onClick={() => setKindFilter(k)}
          >
            {SHORTCUT_KIND_META[k].icon} {SHORTCUT_KIND_META[k].label}
          </button>
        ))}
      </div>

      {hint && <div className="mat-hint">{hint}</div>}

      <div className="theme-grid">
        {loading && <div className="mat-empty">加载中…</div>}
        {!loading && cats.length === 0 && (
          <div className="mat-empty">
            还没有主题或文件夹。在左侧「快捷库」点「＋ 快捷主题 / ＋ 文件夹」先建立分类，
            <br />
            再在分类下新建快捷。
          </div>
        )}
        {!loading && cats.length > 0 && selectedId === null && (
          <div className="mat-empty">
            请在左侧选择某个主题或文件夹，再查看 / 新建其中的快捷；
            <br />
            也可在左侧「＋ 快捷主题 / ＋ 文件夹」新建分类。
          </div>
        )}
        {!loading && selectedId !== null && visibleItems.length === 0 && (
          <div className="mat-empty">
            该分类下还没有快捷。点上方「＋ 快捷文件夹 / 快捷链接 / 快捷笔记」添加。
            <br />
            快捷文件夹点卡片可打开本地文件夹；快捷链接点卡片可调用浏览器访问；快捷笔记存标题与内容。
          </div>
        )}
        {!loading && selectedId !== null &&
          visibleItems.map((a) => {
          const meta = SHORTCUT_KIND_META[a.kind]
          const num = indexOf(a.id) + 1
          return (
            <div
              key={a.id}
              className="mat-card"
              onClick={() => primaryAction(a)}
              title={
                a.kind === 'folder'
                  ? '点击打开本地文件夹'
                  : a.kind === 'link'
                  ? '点击在浏览器中打开'
                  : '点击编辑'
              }
            >
              <span className="mat-order">{num}</span>
              <div className="mat-card-head">
                <span className="mat-type">
                  {meta.icon} {meta.label}
                </span>
                <span className="mat-card-title">{a.title || '（未命名）'}</span>
              </div>
              <div className="mat-preview">
                {a.kind === 'folder' && (
                  <span
                    className="mat-path"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (a.path) openFolder(a.path)
                    }}
                  >
                    📂 {a.path || '（未设置路径）'}
                  </span>
                )}
                {a.kind === 'link' && (
                  <span
                    className="mat-path"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (a.url) openUrl(a.url)
                    }}
                  >
                    🔗 {a.url || '（未设置链接）'}
                  </span>
                )}
                {a.kind === 'note' && <span>{(a.content || '').replace(/\s+/g, ' ').slice(0, 120)}</span>}
              </div>
              {a.tags.length > 0 && (
                <div className="mat-tags">
                  {a.tags.map((t) => (
                    <span key={t} className="mat-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="mat-card-actions">
                {(a.kind === 'folder' || a.kind === 'link') && (
                  <button
                    className="tb-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      primaryAction(a)
                    }}
                  >
                    打开
                  </button>
                )}
                <button
                  className="tb-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(a)
                  }}
                >
                  编辑
                </button>
                <button
                  className="tb-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    copy(a)
                  }}
                >
                  复制
                </button>
                <button
                  className="tb-btn danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(a)
                  }}
                >
                  删除
                </button>
                <button
                  className="tb-btn"
                  title="上移一位（序号 −1）"
                  disabled={num <= 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    moveItem(a.id, -1)
                  }}
                >
                  ↑ 前进
                </button>
                <button
                  className="tb-btn"
                  title="下移一位（序号 +1）"
                  disabled={num >= sortedItems.length}
                  onClick={(e) => {
                    e.stopPropagation()
                    moveItem(a.id, 1)
                  }}
                >
                  ↓ 后退
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {draft && (
        <div className="mat-modal-mask" onClick={() => setDraft(null)}>
          <div className="mat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mat-modal-head">
              <span>
                {draft.id && allItems.some((x) => x.id === draft.id)
                  ? `编辑${SHORTCUT_KIND_META[draft.kind].label}`
                  : `新建${SHORTCUT_KIND_META[draft.kind].label}`}
              </span>
              <span className="mat-modal-close" onClick={() => setDraft(null)}>
                ✕
              </span>
            </div>

            <div className="mat-field">
              <span>名称 *</span>
              <input
                value={draft.title}
                placeholder="给快捷起个名字"
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>

            {draft.kind === 'folder' && (
              <div className="mat-field">
                <span>本地文件夹 *</span>
                <div className="mat-type-row">
                  <input
                    value={draft.path ?? ''}
                    placeholder="选择或粘贴文件夹路径"
                    readOnly
                    onChange={() => {}}
                  />
                  <button className="tb-btn" onClick={onPickFolder}>
                    选择文件夹
                  </button>
                </div>
                {draft.path && (
                  <div className="mat-path" onClick={() => openFolder(draft.path!)}>
                    📂 {draft.path}
                  </div>
                )}
              </div>
            )}

            {draft.kind === 'link' && (
              <div className="mat-field">
                <span>链接地址 *</span>
                <input
                  value={draft.url ?? ''}
                  placeholder="https://…"
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </div>
            )}

            {draft.kind === 'note' && (
              <div className="mat-field">
                <span>内容</span>
                <textarea
                  rows={6}
                  value={draft.content ?? ''}
                  placeholder="笔记正文…"
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
              </div>
            )}

            <div className="mat-field">
              <span>标签（逗号分隔，选填）</span>
              <input
                value={tagsText}
                placeholder="如：常用, 工作"
                onChange={(e) => setTagsText(e.target.value)}
              />
            </div>

            <div className="mat-modal-foot">
              <button className="tb-btn danger" onClick={() => setDraft(null)}>
                取消
              </button>
              <span className="tb-spacer" />
              <button className="tb-btn" onClick={save}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
