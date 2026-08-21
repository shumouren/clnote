import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ASSET_TYPE_ICON,
  ASSET_TYPE_LABEL,
  emptyAsset,
  newId,
  type Asset,
  type AssetCategory,
  type AssetType,
  type AssetTypeDef,
} from '../model/types'
import {
  listAssets,
  listCategories,
  saveAsset,
  deleteAsset,
  clearAllAssets,
  getAsset,
} from '../storage/assets'
import { confirmAsync, promptAsync, alertAsync, iconPickerAsync } from '../platform/dialog'
import { pickHighResImage, pickFile, pickRawImage, exportDataUrlFile } from '../export/download'
import { useStore } from '../store/useStore'

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

function preview(a: Asset): string {
  if (a.type === 'image') return a.title || '图片素材'
  if (a.type === 'link') return a.url || a.title
  if (a.type === 'file') return a.fileName || a.title || '文件素材'
  if (a.type === 'book') return [a.author, a.url].filter(Boolean).join(' · ')
  if (a.type === 'other') return a.fileName || a.url || (a.content || '').replace(/\s+/g, ' ').slice(0, 90) || '其他素材'
  return (a.content || '').replace(/\s+/g, ' ').slice(0, 90)
}

/** 解析素材显示用的图标/名称（优先用户自定义类型，回退到形态） */
function typeInfo(a: Asset, defs: AssetTypeDef[]) {
  const def = defs.find((d) => d.id === a.typeId)
  if (def) return { icon: def.icon, label: def.label }
  if (!a.typeId) return { icon: '🏷️', label: '未分类' }
  return { icon: ASSET_TYPE_ICON[a.type], label: ASSET_TYPE_LABEL[a.type] }
}

/** 中间区的素材看板：支持嵌套分类、自定义类型、搜索、筛选、拖拽排序、新建/编辑/删除 */
export default function ThemeBoard() {
  const activeCategoryId = useStore((s) => s.activeCategoryId)
  const types = useStore((s) => s.settings.assetTypes)
  const setSettings = useStore((s) => s.setSettings)

  const selectedId = activeCategoryId && activeCategoryId !== '__all__' ? activeCategoryId : null

  const [allAssets, setAllAssets] = useState<Asset[]>([])
  const [cats, setCats] = useState<AssetCategory[]>([])
  const [selectedCat, setSelectedCat] = useState<AssetCategory | null>(null)
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [draft, setDraft] = useState<Asset | null>(null)
  const [tagsText, setTagsText] = useState('')
  const [hint, setHint] = useState('')
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const refresh = () => {
    listAssets().then(setAllAssets).finally(() => setLoading(false))
    listCategories().then((list) => {
      setCats(list)
      setSelectedCat(selectedId ? list.find((c) => c.id === selectedId) ?? null : null)
    })
  }
  useEffect(() => {
    setLoading(true)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryId])

  /** 选中分类（含子孙）的素材 id 集合；null 表示"全部素材" */
  const descSet = useMemo(
    () => (selectedId ? descendantIds(cats, selectedId) : null),
    [cats, selectedId],
  )

  const visibleAssets = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allAssets
      .filter((a) => !descSet || descSet.has(a.categoryId))
      .filter((a) => {
        if (typeFilter === 'all') return true
        if (typeFilter === '__none__') return a.typeId === ''
        return a.typeId === typeFilter
      })
      .filter((a) => {
        if (!q) return true
        const hay = [a.title, a.content, a.url, a.author, ...a.tags]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAssets, descSet, typeFilter, query])

  const flash = (msg: string) => {
    setHint(msg)
    window.setTimeout(() => setHint(''), 1600)
  }

  /* 搜索结果点击后，自动跳进并打开该素材（编辑弹窗即"进入文件"）。
     直接按 id 取素材，不依赖本板是否已载入列表，避免停留在别的页面 / 列表未就绪时跳不过去。 */
  const focusAssetId = useStore((s) => s.focusAssetId)
  const setFocusAsset = useStore((s) => s.setFocusAsset)
  useEffect(() => {
    if (!focusAssetId) return
    let cancelled = false
    getAsset(focusAssetId).then((a) => {
      if (a && !cancelled) {
        openEdit(a)
        setFocusAsset(null)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAssetId])

  const openNew = () => {
    // 若当前正停留在某个具体类型筛选下，新建素材默认采用该类型，
    // 避免保存后因子类型过滤而不显示（易被误判为"保存没反应"）。
    const def =
      (typeFilter !== 'all' && typeFilter !== '__none__'
        ? types.find((t) => t.id === typeFilter)
        : undefined) || types[0]
    const base = emptyAsset(def?.kind ?? 'text')
    setDraft({
      ...base,
      typeId: def?.id ?? '',
      categoryId: selectedId ?? '',
    })
    setTagsText('')
  }
  const openEdit = (a: Asset) => {
    setDraft({ ...a })
    setTagsText(a.tags.join(', '))
  }

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim()) {
      flash('请填写标题')
      return
    }
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const order = draft.order ?? allAssets.length
    const next: Asset = { ...draft, title: draft.title.trim(), tags, order }
    // 诊断性保护：任何保存失败都给出明确提示，避免"点不动"却无反馈；
    // 10s 超时用于区分"后端未响应(pending)"与"明确报错"。
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(
        () => rej(new Error('保存超时：后端未响应，请完全退出并重启 tauri dev 后再试')),
        10000,
      ),
    )
    try {
      await Promise.race([saveAsset(next), timeout])
      setDraft(null)
      refresh()
      flash('已保存')
    } catch (e) {
      console.error('保存素材失败', e)
      const msg = e instanceof Error ? e.message : String(e)
      await alertAsync('保存失败：' + msg)
    }
  }

  const remove = async (a: Asset) => {
    if (!(await confirmAsync(`确定删除素材「${a.title}」？`))) return
    await deleteAsset(a.id)
    refresh()
  }

  const copy = async (a: Asset) => {
    const text =
      a.type === 'link'
        ? a.url || a.title
        : a.type === 'image'
          ? a.image || a.title
          : a.type === 'file'
            ? a.fileName || a.title
            : a.content || a.title
    try {
      await navigator.clipboard.writeText(text ?? '')
      flash('已复制到剪贴板')
    } catch {
      flash('复制失败')
    }
  }

  const pickImage = async () => {
    // 素材图片保留原图清晰度，完整展示 / 导出
    const img = await pickRawImage()
    if (img && draft) setDraft({ ...draft, image: img.dataUrl, title: draft.title || img.name })
  }

  const pickLocalFile = async () => {
    const f = await pickFile()
    if (f && draft) {
      setDraft({
        ...draft,
        file: f.dataUrl,
        fileName: f.name,
        title: draft.title || f.name,
      })
    }
  }

  /** 把当前素材的图片 / 文件导出到本地磁盘 */
  const exportAsset = async () => {
    if (!draft) return
    if (draft.type === 'image' && draft.image) {
      const ext =
        {
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/gif': 'gif',
          'image/webp': 'webp',
          'image/svg+xml': 'svg',
          'image/bmp': 'bmp',
        }[/data:([^;]+);/.exec(draft.image)?.[1] ?? ''] ?? 'png'
      const ok = await exportDataUrlFile(`${draft.title || 'image'}.${ext}`, draft.image)
      flash(ok ? '已导出图片到本地' : '已取消导出')
    } else if (draft.type === 'file' && draft.file) {
      const ok = await exportDataUrlFile(draft.fileName || `${draft.title || 'file'}`, draft.file)
      flash(ok ? '已导出文件到本地' : '已取消导出')
    }
  }

  /* 数字排序：每张卡片右上角显示序号（按 order 从 1 开始），
     「↑ 前进 / ↓ 后退」按钮交换相邻卡片的 order，整库按数字排序，简单可靠。
     注意：Rust 返回的素材字段是 orderIdx（camelCase），读写都要用 orderIdx 而非 order。 */
  const ordOf = (x: Asset) =>
    ((x as Asset & { orderIdx?: number }).orderIdx ?? x.order ?? 0)
  const sortedAssets = useMemo(
    () => [...allAssets].sort((a, b) => ordOf(a) - ordOf(b)),
    [allAssets],
  )
  const indexOf = (id: string) => sortedAssets.findIndex((a) => a.id === id)
  const moveAsset = async (id: string, dir: -1 | 1) => {
    const idx = indexOf(id)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= sortedAssets.length) return
    const a = sortedAssets[idx]
    const b = sortedAssets[j]
    await Promise.all([
      saveAsset({ ...a, orderIdx: ordOf(b) } as Asset & { orderIdx?: number }),
      saveAsset({ ...b, orderIdx: ordOf(a) } as Asset & { orderIdx?: number }),
    ])
    await refresh()
  }

  /* ---- 标签分类管理：类型即标签（文本 / 文件 / 其他 / 未分类 + 可自建 / 删除 / 重命名） ---- */
  const onTypeChange = (val: string) => {
    if (val === '__new__') {
      createType()
      return
    }
    if (val === '__none__') {
      setDraft((d) => (d ? { ...d, typeId: '' } : d))
      return
    }
    const def = types.find((t) => t.id === val)
    if (def) setDraft((d) => (d ? { ...d, typeId: def.id, type: def.kind } : d))
  }

  /** 新建标签分类：命名后挑图标；自定义标签默认双布局（文本 + 文件），最灵活 */
  const createType = async () => {
    const label = await promptAsync('新标签分类名称（如：灵感语录）')
    if (!label || !label.trim()) return
    const icon = (await iconPickerAsync('🏷️')) ?? '🏷️'
    const def: AssetTypeDef = {
      id: 'ut_' + newId(),
      label: label.trim(),
      icon,
      kind: 'other',
      builtin: false,
    }
    setSettings({ assetTypes: [...types, def] })
    setDraft((d) => (d ? { ...d, typeId: def.id, type: def.kind } : d))
    flash('已新建标签分类')
  }

  /** 删除标签分类：把使用该标签的素材改为未分类（内容不丢失） */
  const deleteType = async (id: string) => {
    const def = types.find((t) => t.id === id)
    if (!def) return
    if (def.builtin) {
      flash('内置标签（文本 / 文件 / 其他）不可删除')
      return
    }
    if (
      !(await confirmAsync(
        `删除标签分类「${def.label}」？使用该标签的素材会变为“未分类”（内容不丢失）。`,
      ))
    )
      return
    try {
      const affected = allAssets.filter((a) => a.typeId === id)
      await Promise.all(affected.map((a) => saveAsset({ ...a, typeId: '' })))
      setSettings({ assetTypes: types.filter((t) => t.id !== id) })
      setDraft((d) => (d ? { ...d, typeId: '' } : d))
      refresh()
      flash(`已删除标签「${def.label}」`)
    } catch (e) {
      console.error('删除标签失败', e)
      flash('删除标签失败，请重试')
    }
  }

  /** 重命名标签分类（可同时改图标） */
  const renameType = async (id: string) => {
    const def = types.find((t) => t.id === id)
    if (!def) return
    const label = await promptAsync('重命名标签分类', def.label)
    if (!label || !label.trim()) return
    const icon = (await iconPickerAsync(def.icon || '🏷️')) ?? def.icon
    const next = { ...def, label: label.trim(), icon }
    setSettings({ assetTypes: types.map((t) => (t.id === id ? next : t)) })
    flash('已重命名')
  }

  const clearAll = async () => {
    if (!(await confirmAsync('确定清空素材库的全部素材与分类？此操作不可恢复。'))) return
    await clearAllAssets()
    refresh()
    flash('已清空素材库')
  }

  const breadcrumb = selectedCat ? pathOf(cats, selectedCat.id) : []
  const title = selectedCat
    ? breadcrumb.map((c) => `${c.icon}${c.name}`).join(' / ')
    : '素材库'

  return (
    <div className="theme-board">
      <div className="theme-board-bar">
        <span className="theme-board-title" title={selectedCat?.name}>
          {title}
        </span>
        <input
          className="mat-search"
          placeholder="搜索素材…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="tb-btn" onClick={openNew} disabled={cats.length === 0} title={cats.length === 0 ? '请先在左侧建立主题或文件夹' : '新建素材（未选主题时归入"未归类"）'}>
          ＋ 新建素材
        </button>
        <button className="tb-btn danger" onClick={clearAll} title="清空素材库全部素材与分类">
          清空全部
        </button>
      </div>

      <div className="mat-filters">
        <button
          className={'mat-chip' + (typeFilter === 'all' ? ' active' : '')}
          onClick={() => setTypeFilter('all')}
        >
          全部
        </button>
        {types.map((t) => (
          <span
            key={t.id}
            className={'mat-chip' + (typeFilter === t.id ? ' active' : '')}
            onClick={() => setTypeFilter(t.id)}
            title={`${t.label}（点击筛选；悬停可删除该标签分类）`}
          >
            {t.icon} {t.label}
            {!t.builtin && (
              <span
                className="mat-chip-del"
                title="删除该标签分类"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteType(t.id)
                }}
              >
                ✕
              </span>
            )}
          </span>
        ))}
        <button
          className={'mat-chip' + (typeFilter === '__none__' ? ' active' : '')}
          onClick={() => setTypeFilter('__none__')}
        >
          🏷️ 未分类
        </button>
        <button
          className="mat-chip add"
          title="新建标签分类（文本 / 文件 / 其他 / 自定义），可挑图标"
          onClick={() => createType()}
        >
          ＋ 标签分类
        </button>
      </div>

      {hint && <div className="mat-hint">{hint}</div>}

      <div className="theme-grid">
        {loading && <div className="mat-empty">加载中…</div>}
        {!loading && cats.length === 0 && (
          <div className="mat-empty">
            还没有主题或文件夹。在左侧「素材库」点「＋ 主题 / ＋ 文件夹」先建立分类，
            <br />
            再在分类下新建素材。
          </div>
        )}
        {!loading && cats.length > 0 && selectedId === null && (
          <div className="mat-empty">
            请在左侧选择某个主题或文件夹，再查看 / 新建其中的素材；
            <br />
            也可在左侧「＋ 主题 / ＋ 文件夹」新建分类。
          </div>
        )}
        {!loading && selectedId !== null && visibleAssets.length === 0 && (
          <div className="mat-empty">
            该分类下还没有素材。点上方「＋ 新建素材」添加；标签分类可在素材编辑框的「类型」里新建或删除。
            <br />
            当前分类（含子分类）的素材会陈列在这里，可拖拽调整顺序、随时搜索。
          </div>
        )}
        {!loading && selectedId !== null &&
          visibleAssets.map((a) => {
          const ti = typeInfo(a, types)
          const num = indexOf(a.id) + 1
          return (
            <div
              key={a.id}
              className="mat-card"
              onClick={() => openEdit(a)}
              title="点击编辑"
            >
              <span className="mat-order">{num}</span>
              <div className="mat-card-head">
                <span className="mat-type">
                  {ti.icon} {ti.label}
                </span>
                <span className="mat-card-title">{a.title || '（未命名）'}</span>
              </div>
              {a.type === 'image' && a.image ? (
                <img
                  className="mat-thumb"
                  src={a.image}
                  alt={a.title}
                  title="点击编辑"
                />
              ) : (
                <div className="mat-preview">{preview(a)}</div>
              )}
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
                    moveAsset(a.id, -1)
                  }}
                >
                  ↑ 前进
                </button>
                <button
                  className="tb-btn"
                  title="下移一位（序号 +1）"
                  disabled={num >= sortedAssets.length}
                  onClick={(e) => {
                    e.stopPropagation()
                    moveAsset(a.id, 1)
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
              <span>{draft.id && allAssets.some((x) => x.id === draft.id) ? '编辑素材' : '新建素材'}</span>
              <span className="mat-modal-close" onClick={() => setDraft(null)}>
                ✕
              </span>
            </div>

            <div className="mat-field">
              <span>类型（标签分类）</span>
              <div className="mat-type-row">
                <select
                  value={draft.typeId || '__none__'}
                  onChange={(e) => onTypeChange(e.target.value)}
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.icon} {t.label}
                    </option>
                  ))}
                  <option value="__none__">🏷️ 未分类</option>
                  <option value="__new__">＋ 新建标签分类…</option>
                </select>
                {draft.typeId && (
                  <>
                    <button
                      className="tb-btn"
                      title="重命名当前标签分类"
                      onClick={() => renameType(draft.typeId)}
                    >
                      重命名
                    </button>
                    {!types.find((t) => t.id === draft.typeId)?.builtin && (
                      <button
                        className="tb-btn danger"
                        title="删除当前标签分类"
                        onClick={() => deleteType(draft.typeId)}
                      >
                        删除标签
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {(draft.type === 'link' || draft.type === 'book' || draft.type === 'other') && (
              <div className="mat-field">
                <span>
                  {draft.type === 'book'
                    ? '链接 / 购买地址'
                    : draft.type === 'other'
                      ? '链接（选填）'
                      : '链接地址'}
                </span>
                <input
                  value={draft.url ?? ''}
                  placeholder="https://…"
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </div>
            )}

            {draft.type === 'book' && (
              <div className="mat-field">
                <span>作者</span>
                <input
                  value={draft.author ?? ''}
                  onChange={(e) => setDraft({ ...draft, author: e.target.value })}
                />
              </div>
            )}

            <div className="mat-field">
              <span>标题 *</span>
              <input
                value={draft.title}
                placeholder="给素材起个名字"
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>

            {(draft.type === 'text' || draft.type === 'code' || draft.type === 'link' || draft.type === 'file' || draft.type === 'other') && (
              <div className="mat-field">
                <span>
                  {draft.type === 'link' || draft.type === 'file'
                    ? '备注（选填）'
                    : draft.type === 'code'
                      ? '代码内容'
                      : '文本内容（选填）'}
                </span>
                <textarea
                  className={draft.type === 'code' ? 'mono' : ''}
                  rows={5}
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
              </div>
            )}

            {(draft.type === 'file' || draft.type === 'other') && (
              <div className="mat-field">
                <span>{draft.type === 'other' ? '附件（选填，从本地上传并保存）' : '文件（从本地上传并保存）'}</span>
                {draft.file ? (
                  <div className="mat-file-info">
                    📄 {draft.fileName || '已上传文件'}
                    {draft.file.startsWith('data:') && (
                      <span className="mat-file-meta">
                        {' '}
                        · {Math.round(draft.file.length / 1024)} KB 已保存
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mat-empty">未选择文件</div>
                )}
                <button className="tb-btn" onClick={pickLocalFile}>
                  选择文件…
                </button>
              </div>
            )}

            {(draft.type === 'image' || draft.type === 'book') && (
              <div className="mat-field">
                <span>{draft.type === 'book' ? '封面图（选填）' : '图片'}</span>
                {draft.image ? (
                  <img
                    className="mat-modal-thumb clickable"
                    src={draft.image}
                    alt={draft.title}
                    onClick={() => setLightboxSrc(draft.image!)}
                    title="点击放大查看"
                  />
                ) : (
                  <div className="mat-empty">未选择图片</div>
                )}
                <button className="tb-btn" onClick={pickImage}>
                  选择图片
                </button>
              </div>
            )}

            {draft.type === 'image' && (
              <div className="mat-field">
                <span>说明 / 替代文字（选填）</span>
                <input
                  value={draft.content}
                  placeholder="图片的备注"
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
              </div>
            )}

            <div className="mat-field">
              <span>标签（逗号分隔，选填）</span>
              <input
                value={tagsText}
                placeholder="如：常用, 周报"
                onChange={(e) => setTagsText(e.target.value)}
              />
            </div>

            <div className="mat-modal-foot">
              <button className="tb-btn danger" onClick={() => setDraft(null)}>
                取消
              </button>
              <span className="tb-spacer" />
              {(draft.type === 'image' && draft.image) ||
              (draft.type === 'file' && draft.file) ? (
                <button
                  className="tb-btn"
                  onClick={exportAsset}
                  title="将素材导出为本地文件"
                >
                  导出素材
                </button>
              ) : null}
              <button className="tb-btn" onClick={save}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          title={draft?.title || '图片'}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </div>
  )
}

/** 图片灯箱：无按钮、无提示，Ctrl / ⌘ + 滚轮平滑缩放（默认完整展示整图）；
 *  点击空白处或按 Esc 关闭。用原生非被动 wheel 监听，确保能 preventDefault，
 *  阻止浏览器把 Ctrl+滚轮当成整页缩放，从而缩放手感顺滑且只作用于图片。 */
function ImageLightbox({
  src,
  title,
  onClose,
}: {
  src: string
  title: string
  onClose: () => void
}) {
  const [z, setZ] = useState(1)
  const frameRef = useRef<HTMLDivElement>(null)
  const setLightboxOpen = useStore((s) => s.setLightboxOpen)

  useEffect(() => {
    setLightboxOpen(true)
    return () => setLightboxOpen(false)
  }, [setLightboxOpen])

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setZ((prev) => Math.min(8, Math.max(0.1, prev * Math.exp(-e.deltaY * 0.0015))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="img-lightbox" onClick={onClose}>
      <button className="lb-close" title="关闭（Esc）" onClick={onClose}>
        ×
      </button>
      <div className="lb-img-frame" ref={frameRef} onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={title} style={{ transform: `scale(${z})` }} />
      </div>
    </div>
  )
}
