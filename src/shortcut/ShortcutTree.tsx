import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  listShortcutCategories,
  saveShortcutCategory,
  deleteShortcutCategory,
} from '../storage/shortcuts'
import { newCategory, type AssetCategory, type AssetCategoryKind } from '../model/types'
import { confirmAsync, promptAsync, iconPickerAsync } from '../platform/dialog'
import { reparentCat, isCatDescendant } from '../platform/categoryTree'
import { MoveToDialog, type MoveTarget } from '../platform/MoveToDialog'
import { toast } from '../ui/toast'

/** 侧边栏的"快捷"Tab：可互相嵌套的分类树（主题 / 文件夹） */
export default function ShortcutTree() {
  const activeCategoryId = useStore((s) => s.activeShortcutCategoryId)
  const setActiveCategory = useStore((s) => s.setActiveShortcutCategory)

    const [cats, setCats] = useState<AssetCategory[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; cat: AssetCategory } | null>(null)
  /** "移动到…"弹窗当前要移动的分类（null = 未打开） */
  const [moveCatTarget, setMoveCatTarget] = useState<AssetCategory | null>(null)

  const refresh = () => {
    listShortcutCategories()
      .then((list) => {
        setCats(list)
        setExpanded((prev) => {
          const next = { ...prev }
          for (const c of list) next[c.id] = next[c.id] ?? true
          return next
        })
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 右键菜单：点击外部 / Esc 关闭
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const byParent = (parentId: string | null) =>
    cats.filter((c) => (c.parentId ?? null) === parentId)

  const onPick = (id: string) => setActiveCategory(id)

  const createRoot = async (kind: AssetCategoryKind) => {
    const name = await promptAsync(kind === 'folder' ? '文件夹名称' : '快捷主题名称（如：常用、工作）')
    if (!name || !name.trim()) return
    const def = kind === 'folder' ? '📁' : '🔖'
    const icon = (await iconPickerAsync(def)) ?? def
    const c = newCategory(kind, name.trim(), null, cats.length)
    c.icon = icon
    await saveShortcutCategory(c)
    refresh()
    onPick(c.id)
  }

  const createChild = async (parent: AssetCategory, kind: AssetCategoryKind) => {
    const name = await promptAsync(
      `在「${parent.name}」下新建${kind === 'folder' ? '文件夹' : '快捷主题'}名称`,
    )
    if (!name || !name.trim()) return
    const def = kind === 'folder' ? '📁' : '🔖'
    const icon = (await iconPickerAsync(def)) ?? def
    const c = newCategory(kind, name.trim(), parent.id, byParent(parent.id).length)
    c.icon = icon
    await saveShortcutCategory(c)
    setExpanded((p) => ({ ...p, [parent.id]: true }))
    refresh()
    onPick(c.id)
  }

  const remove = async (c: AssetCategory) => {
    if (
      !(await confirmAsync(
        `删除「${c.name}」？其下所有子分类与快捷会一并删除（不可恢复）。`,
      ))
    )
      return
    await deleteShortcutCategory(c.id)
    refresh()
    if (activeCategoryId === c.id) onPick('__all__')
  }

  const renameCat = async (c: AssetCategory) => {
    const name = await promptAsync('重命名分类', c.name)
    if (!name || !name.trim()) return
    await saveShortcutCategory({ ...c, name: name.trim() })
    refresh()
  }

  /* ---------------- 拖拽 / 调整层级（带着子节点） ---------------- */
  const handleDrop = (target: AssetCategory) => {
    setDropTarget(null)
    const id = dragId
    setDragId(null)
    if (!id || id === target.id) return
    if (isCatDescendant(cats, target.id, id)) return // 不能拖进自己的后代
    const dragCat = cats.find((c) => c.id === id)
    if (!dragCat) return
    const next = reparentCat(dragCat, cats, target.id)
    void saveShortcutCategory(next).then(refresh)
  }

  /** 构建"移动到…"的目标列表：根目录 + 其余分类（排除自身及其后代，避免循环嵌套） */
  const buildMoveTargets = (cat: AssetCategory): MoveTarget[] => {
    const depthOf = (id: string): number => {
      let d = 0
      let cur: string | null = cats.find((c) => c.id === id)?.parentId ?? null
      while (cur) {
        d++
        cur = cats.find((c) => c.id === cur)?.parentId ?? null
      }
      return d
    }
    const root: MoveTarget = { id: null, label: '根目录', depth: 0, icon: '📂' }
    const others: MoveTarget[] = cats
      .filter((c) => c.id !== cat.id && !isCatDescendant(cats, cat.id, c.id))
      .map((c) => ({ id: c.id, label: c.name, depth: depthOf(c.id), icon: c.icon || '📁' }))
    return [root, ...others]
  }

  const onMovePick = (targetId: string | null) => {
    const cat = moveCatTarget
    setMoveCatTarget(null)
    if (!cat) return
    const next = reparentCat(cat, cats, targetId)
    const dest = targetId ? cats.find((c) => c.id === targetId)?.name ?? '目标' : '根目录'
    saveShortcutCategory(next)
      .then(refresh)
      .then(() => toast(`已移动到「${dest}」`))
      .catch((e) => {
        console.error('[onMovePick] 移动失败：', e)
        toast(`移动失败：${String(e)}`)
      })
  }

  const renderNode = (c: AssetCategory, depth: number): JSX.Element => {
    const kids = byParent(c.id)
    const open = expanded[c.id] !== false
    const isActive = activeCategoryId === c.id
    return (
      <div key={c.id}>
        <div
          className={'mat-cat-item' + (isActive ? ' active' : '') + (dropTarget === c.id ? ' drop' : '')}
          style={{ paddingLeft: 8 + depth * 16 }}
          draggable
          onClick={() => onPick(c.id)}
          title="点击在中间区查看该分类下的快捷；拖到其它分类上可改变层级，右键可提升/降低层级"
          onDragStart={(e) => {
            setDragId(c.id)
            e.dataTransfer.setData('text/plain', c.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDragId(null)
            setDropTarget(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            e.stopPropagation()
            setDropTarget(c.id)
          }}
          onDragLeave={() => setDropTarget((t) => (t === c.id ? null : t))}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleDrop(c)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY, cat: c })
          }}
        >
          <span
            className={'mat-cat-caret' + (kids.length ? '' : ' empty')}
            onClick={(e) => {
              e.stopPropagation()
              if (kids.length) setExpanded((p) => ({ ...p, [c.id]: !open }))
            }}
          >
            {kids.length ? (open ? '▾' : '▸') : ''}
          </span>
          <span className="mat-cat-icon">{c.icon}</span>
          <span className="mat-cat-name">{c.name}</span>
          <span
            className="mat-cat-add"
            title="新建子主题"
            onClick={(e) => {
              e.stopPropagation()
              createChild(c, 'theme')
            }}
          >
            🔖
          </span>
          <span
            className="mat-cat-add"
            title="新建子文件夹"
            onClick={(e) => {
              e.stopPropagation()
              createChild(c, 'folder')
            }}
          >
            📁
          </span>
          <span
            className="mat-cat-del"
            title="删除"
            onClick={(e) => {
              e.stopPropagation()
              remove(c)
            }}
          >
            ✕
          </span>
        </div>
        {open && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    )
  }

  return (
    <>
      <div
        className="mat-theme-list"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropTarget(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDropTarget(null)
          const id = dragId
          setDragId(null)
          if (!id) return
          const dragCat = cats.find((c) => c.id === id)
          if (!dragCat) return
          const next = reparentCat(dragCat, cats, null)
          void saveShortcutCategory(next).then(refresh)
        }}
      >
        <div className="mat-theme-add-row">
          <button className="tb-btn" onClick={() => createRoot('theme')}>
            ＋ 快捷主题
          </button>
          <button className="tb-btn" onClick={() => createRoot('folder')}>
            ＋ 文件夹
          </button>
        </div>
        {loading && <div className="mat-empty">加载中…</div>}
        {!loading && cats.length === 0 && (
          <div className="mat-empty">还没有分类，点上方"＋ 快捷主题 / ＋ 文件夹"开始（可互相嵌套）。</div>
        )}
        {!loading && byParent(null).map((c) => renderNode(c, 0))}
      </div>

      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="ctx-title">「{menu.cat.name}」</div>
          <div
            className="ctx-item"
            onClick={() => {
              const c = menu.cat
              setMenu(null)
              createChild(c, 'theme')
            }}
          >
            🔖 新建子主题
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const c = menu.cat
              setMenu(null)
              createChild(c, 'folder')
            }}
          >
            📁 新建子文件夹
          </div>
          <div className="ctx-sep" />
          <div
            className="ctx-item"
            onClick={() => {
              const c = menu.cat
              setMenu(null)
              void renameCat(c)
            }}
          >
            ✎ 重命名
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const c = menu.cat
              setMenu(null)
              setMoveCatTarget(c)
            }}
          >
            📥 移动到…
          </div>
          <div className="ctx-sep" />
          <div
            className="ctx-item danger"
            onClick={async () => {
              const c = menu.cat
              setMenu(null)
              await remove(c)
            }}
          >
            🗑 删除
          </div>
        </div>
      )}

      {moveCatTarget && (
        <MoveToDialog
          title={`移动「${moveCatTarget.name}」到`}
          targets={buildMoveTargets(moveCatTarget)}
          onPick={onMovePick}
          onClose={() => setMoveCatTarget(null)}
        />
      )}
    </>
  )
}
