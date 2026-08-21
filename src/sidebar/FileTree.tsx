import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { FsNode, NodeType, PlotMode } from '../model/types'
import { PLOT_MODES } from '../model/types'
import { formatsFor, FORMAT_LABEL, type ExportKind } from '../export/exporters'
import { exportSingle } from '../export/runExport'
import { confirmAsync, promptAsync } from '../platform/dialog'
import { toast } from '../ui/toast'
import { MoveToDialog, type MoveTarget } from '../platform/MoveToDialog'
import MindMapPicker from './MindMapPicker'

/** 拖拽落点相对目标行的位置：上方=插到目标之前(同级重排) / 下方=插到目标之后(同级重排,
 *  若目标是文件夹则=放入文件夹内部) / inside=放入文件夹内部 */
type DropPos = 'before' | 'after' | 'inside'

const ICON: Record<NodeType, string> = {
  folder: '📁',
  note: '📄',
  mindmap: '🧠',
  board: '📋',
  timeline: '⏳',
  character: '🧑',
  plot: '🎬',
  setting: '🌐',
  map: '🗺️',
}

/** 创作库子类型的展示图标（普通节点按 type 取默认图标） */
function nodeIcon(n: FsNode): string {
  if ((n.lib ?? 'file') === 'creation') {
    if (n.refId) return '🔗'
    if (n.kind === 'novel') return '📖'
    if (n.kind === 'volume') return '📚'
    if (n.kind === 'chapter') return '📄'
    if (n.kind === 'foreshow') return '🔖'
  }
  return ICON[n.type]
}

const TYPE_LABEL: Record<NodeType, string> = {
  folder: '文件夹',
  note: '文本',
  mindmap: '思维导图',
  board: '任务看板',
  timeline: '时间线',
  character: '角色',
  plot: '剧情',
  setting: '设定',
  map: '地图',
}

/** 创作库右键菜单里"通用新建"的文案（正文/思维导图等改用右键创建） */
const GEN_LABEL: Record<NodeType, string> = {
  folder: '新建文件夹',
  note: '新建正文',
  mindmap: '新建思维导图',
  board: '新建看板',
  timeline: '新建时间线',
  character: '新建角色',
  plot: '新建剧情',
  setting: '新建设定',
  map: '新建地图',
}

interface MenuState {
  x: number
  y: number
  /** null = 空白处右键，目标为根目录 */
  node: FsNode | null
  /** true 时强制"建在该文件夹内部"（文件夹行的 ＋ 按钮） */
  forceInside?: boolean
}

export default function FileTree({ lib = 'file' }: { lib?: 'file' | 'creation' }) {
  const nodes = useStore((s) => s.nodes)
  const settings = useStore((s) => s.settings)
  const addNode = useStore((s) => s.addNode)
  const renameNode = useStore((s) => s.renameNode)
  const deleteNode = useStore((s) => s.deleteNode)
  const moveNode = useStore((s) => s.moveNode)
  const openNode = useStore((s) => s.openNode)
  const panes = useStore((s) => s.panes)
  const activePane = useStore((s) => s.activePane)
  const split = useStore((s) => s.split)

  const selectedId = useStore((s) => s.selectedId)
  const setSelected = useStore((s) => s.setSelected)
  const collapsedIds = useStore((s) => s.collapsedIds)
  const toggleCollapse = useStore((s) => s.toggleCollapse)
  const setCollapsed = useStore((s) => s.setCollapsed)
  const pendingRenameId = useStore((s) => s.pendingRenameId)
  const setPendingRename = useStore((s) => s.setPendingRename)
  const openExport = useStore((s) => s.openExport)
  const openImport = useStore((s) => s.openImport)
  const accent = useStore((s) => s.settings.accent)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dropPos, setDropPos] = useState<DropPos | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** 右键菜单里"导出为…"展开的子菜单所针对的节点 id */
  const [exportSub, setExportSub] = useState<string | null>(null)
  /** "移动到…"弹窗当前要移动的节点（null = 未打开） */
  const [moveNodeTarget, setMoveNodeTarget] = useState<FsNode | null>(null)
  /** "引用文本库思维导图"选择器（null = 未打开） */
  const [refPickerOpen, setRefPickerOpen] = useState(false)
  /** 打开选择器时记录"新建落点"，避免关闭菜单后丢失目标父级 */
  const [refPickParent, setRefPickParent] = useState<string | null>(null)
  /** "新建剧情"时先选择模式（null = 未打开） */
  const [plotPicker, setPlotPicker] = useState<{ parentId: string | null } | null>(null)
  /** 右键菜单实际渲染坐标（收敛到视口内，避免超出屏幕） */
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)

  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const hoverTimer = useRef<{ id: string; t: number } | null>(null)

  const openedIds = [panes.left, panes.right]
    .filter((c): c is { kind: 'node'; id: string } => !!c && c.kind === 'node')
    .map((c) => c.id)

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const childrenOf = (parentId: string | null) =>
    nodes
      .filter((n) => (n.lib ?? 'file') === lib && n.parentId === parentId)
      .sort((a, b) => a.order - b.order)

  const isDescendant = (ancestorId: string, maybeChildId: string): boolean => {
    let cur: string | null = maybeChildId
    while (cur) {
      if (cur === ancestorId) return true
      cur = byId.get(cur)?.parentId ?? null
    }
    return false
  }

  /** 目标父级的展示路径，如 "根目录" / "工作 / 周报" */
  const targetLabel = useMemo(() => {
    const sel = selectedId ? byId.get(selectedId) : undefined
    const pid = sel ? (sel.type === 'folder' ? sel.id : sel.parentId) : null
    if (!pid) return '根目录'
    const parts: string[] = []
    let cur: string | null = pid
    while (cur) {
      const n = byId.get(cur)
      if (!n) break
      parts.unshift(n.name)
      cur = n.parentId
    }
    return parts.join(' / ') || '根目录'
  }, [selectedId, byId])

  /* ---------------- 重命名 ---------------- */

  const startRename = (n: FsNode) => {
    setRenamingId(n.id)
    setRenameVal(n.name)
  }

  const commitRename = async () => {
    const id = renamingId
    if (!id) return
    setRenamingId(null)
    const v = renameVal.trim()
    const cur = byId.get(id)
    if (v && cur && v !== cur.name) await renameNode(id, v)
  }

  // 新建后自动进入重命名，并全选默认名，直接打字即可覆盖
  useEffect(() => {
    if (!pendingRenameId) return
    const n = byId.get(pendingRenameId)
    if (!n) return
    setRenamingId(pendingRenameId)
    setRenameVal(n.name)
    setPendingRename(null)
  }, [pendingRenameId, byId, setPendingRename])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  /* ---------------- 右键菜单 ---------------- */

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  /** 菜单打开时记录初始坐标，并在布局阶段收敛到视口内（贴底/贴右时上移/左移，避免超出屏幕无法点选） */
  useEffect(() => {
    if (menu) setMenuPos({ x: menu.x, y: menu.y })
    else setMenuPos(null)
  }, [menu])

  useLayoutEffect(() => {
    if (!menu || !menuRef.current || !menuPos) return
    const r = menuRef.current.getBoundingClientRect()
    const pad = 6
    let x = menuPos.x
    let y = menuPos.y
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - r.width - pad)
    if (y + r.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - r.height - pad)
    if (x < pad) x = pad
    if (y < pad) y = pad
    if (x !== menuPos.x || y !== menuPos.y) setMenuPos({ x, y })
  }, [menu, menuPos])

  /** 重新打开菜单时收起导出子菜单 */
  useEffect(() => {
    if (menu) setExportSub(null)
  }, [menu])

  /** 菜单里"新建"的落点：文件夹→内部；文件→同级；空白→根 */
  const menuParent = (m: MenuState): string | null => {
    if (!m.node) return null
    if (m.forceInside || m.node.type === 'folder') return m.node.id
    return m.node.parentId
  }

  const createIn = async (type: NodeType, parentId: string | null) => {
    setMenu(null)
    if (parentId) setCollapsed(parentId, false)
    await addNode(type, parentId, lib)
  }

  /** 新建剧情：先选模式，再创建对应模式的剧情节点 */
  const choosePlot = async (mode: PlotMode) => {
    const pid = plotPicker?.parentId ?? null
    setPlotPicker(null)
    if (pid) setCollapsed(pid, false)
    await addNode('plot', pid, lib, { plotMode: mode })
  }

  /* ---------------- 创作库：小说创作 / 卷 / 章 ---------------- */

  /** 解析中文/阿拉伯数字为整数（支持 零-九、十百千、五百零一 等常见序数写法） */
  const parseCN = (token: string): number => {
    if (/^\d+$/.test(token)) return parseInt(token, 10)
    const CN: Record<string, number> = {
      零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    }
    let total = 0, section = 0, num = 0
    for (const ch of token) {
      if (ch in CN) num = CN[ch]
      else if (ch === '十') { section += (num || 1) * 10; num = 0 }
      else if (ch === '百') { section += (num || 1) * 100; num = 0 }
      else if (ch === '千') { section += (num || 1) * 1000; num = 0 }
      else if (ch === '万') { total += (section + num) * 10000; section = 0; num = 0 }
      else break
    }
    return total + section + num
  }

  /** 从名称里抽取"第X卷/章/节"的 X；unit 给定时只匹配该单位，否则返回 0 */
  const parseChapterNumber = (name: string, unit?: string): number => {
    const m = name.match(/第\s*([\d零一二三四五六七八九十百千两]+)\s*(卷|章|节)/)
    if (!m) return 0
    if (unit && m[2] !== unit) return 0
    return parseCN(m[1])
  }

  /** 阿拉伯数字转中文（1→一、11→十一、21→二十一…支持到 9999） */
  const toCN = (n: number): string => {
    if (n <= 0) return String(n)
    const d = '零一二三四五六七八九'
    if (n < 10) return d[n]
    if (n < 20) return '十' + (n % 10 ? d[n % 10] : '')
    if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '')
    if (n < 1000) {
      const h = Math.floor(n / 100)
      const r = n % 100
      return d[h] + '百' + (r ? (r < 10 ? '零' + d[r] : toCN(r)) : '')
    }
    const k = Math.floor(n / 1000)
    const r = n % 1000
    return d[k] + '千' + (r ? (r < 100 ? '零' + toCN(r) : toCN(r)) : '')
  }

  /** 按设置输出编号：cn=中文数字 / arabic=阿拉伯数字 */
  const numeral = (n: number, style: 'cn' | 'arabic'): string =>
    style === 'cn' ? toCN(n) : String(n)

  /** 某个父级下"卷"的下一个默认名（按 type 判断，兼容 kind 缺失的老数据；风格跟随设置） */
  const nextVolumeName = (parentId: string | null): string => {
    const vols = nodes.filter(
      (n) => (n.lib ?? 'file') === 'creation' && n.type === 'folder' && n.parentId === parentId,
    )
    const maxN = vols.reduce((mx, n) => Math.max(mx, parseChapterNumber(n.name, '卷')), 0)
    return `第${numeral(maxN + 1, settings.volumeNumeral)}卷`
  }

  /** 某个父级下"章"的下一个默认名（重命名过则按当前章续编；风格跟随设置） */
  const nextChapterName = (parentId: string | null): string => {
    const chaps = nodes.filter(
      (n) => (n.lib ?? 'file') === 'creation' && n.type === 'note' && n.parentId === parentId,
    )
    const maxN = chaps.reduce((mx, n) => Math.max(mx, parseChapterNumber(n.name, '章')), 0)
    return `第${numeral(maxN + 1, settings.chapterNumeral)}章`
  }

  const createNovel = async () => {
    setMenu(null)
    const name = await promptAsync('小说创作名称', '新建小说创作')
    if (!name || !name.trim()) return
    const id = await addNode('folder', undefined, 'creation', {
      kind: 'novel',
      name: name.trim(),
      rename: false,
    })
    setSelected(id)
    // 每个子节点独立 try/catch：单条失败不影响其余自动生成
    const addSafe = async (...args: Parameters<typeof addNode>) => {
      try {
        return await addNode(...args)
      } catch (e) {
        console.error('[createNovel] 自动新建子节点失败', args[0], e)
        return null
      }
    }
    // 自动带一个「伏笔展示」子节点（🔖），集中查看该小说创作下的全部伏笔
    await addSafe('note', id, 'creation', {
      kind: 'foreshow',
      name: '伏笔展示',
      rename: false,
    })
    // 自动带「第一卷」，并在其下带「第一章」，开箱即可开始写作（编号风格跟随设置）
    const volId = await addSafe('folder', id, 'creation', {
      kind: 'volume',
      name: `第${numeral(1, settings.volumeNumeral)}卷`,
      rename: false,
    })
    if (volId) {
      await addSafe('note', volId, 'creation', {
        kind: 'chapter',
        name: `第${numeral(1, settings.chapterNumeral)}章`,
        rename: false,
      })
    }
  }

  const createVolume = async (parentId: string | null) => {
    setMenu(null)
    if (parentId) setCollapsed(parentId, false)
    await addNode('folder', parentId, 'creation', { kind: 'volume', name: nextVolumeName(parentId), rename: true })
  }

  const createChapter = async (parentId: string | null) => {
    setMenu(null)
    if (parentId) setCollapsed(parentId, false)
    await addNode('note', parentId, 'creation', { kind: 'chapter', name: nextChapterName(parentId), rename: true })
  }

  /* ---------------- 拖拽 ---------------- */

  /** 计算拖拽落点相对目标行的位置：上半部=插到目标之前(同级重排)，下半部=若是文件夹则放入内部、否则插到目标之后(同级重排) */
  const computeDropPos = (e: React.DragEvent, n: FsNode): DropPos => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    if (before) return 'before'
    return n.type === 'folder' ? 'inside' : 'after'
  }

  const handleDrop = async (target: FsNode | null, id: string | null, pos?: DropPos) => {
    setDropTarget(null)
    setDropPos(null)
    setDragId(null)
    if (!id || id === (target?.id ?? null)) return
    if (target && isDescendant(id, target.id)) return // 不能拖进自己的后代

    if (!target) {
      // 落到空白区域：移到根目录末尾
      await moveNode(id, null, childrenOf(null).filter((n) => n.id !== id).length)
      return
    }
    if (pos === 'inside' && target.type === 'folder') {
      // 拖到文件夹下半部 → 放入文件夹内部（末尾）
      await moveNode(id, target.id, childrenOf(target.id).filter((n) => n.id !== id).length)
      return
    }
    // before / after：同级重排（可把文件放到文件夹之前/之后）
    const filtered = childrenOf(target.parentId).filter((n) => n.id !== id)
    const ti = filtered.findIndex((n) => n.id === target.id)
    if (ti < 0) return
    const index = pos === 'before' ? ti : ti + 1
    await moveNode(id, target.parentId, index)
  }

  /** 右键菜单"上移 / 下移"：在同父级兄弟间调整一位顺序 */
  const shiftNode = async (node: FsNode, dir: -1 | 1) => {
    setMenu(null)
    const sibs = childrenOf(node.parentId)
    const idx = sibs.findIndex((n) => n.id === node.id)
    const ni = idx + dir
    if (ni < 0 || ni >= sibs.length) return
    const targetSib = sibs[ni]
    const filtered = sibs.filter((n) => n.id !== node.id)
    const ti = filtered.findIndex((n) => n.id === targetSib.id)
    await moveNode(node.id, node.parentId, dir < 0 ? ti : ti + 1)
  }

  /** 构建"移动到…"的目标列表：根目录 + 所有文件夹（排除自身及其后代，避免循环嵌套） */
  const buildMoveTargets = (node: FsNode): MoveTarget[] => {
    const depthOf = (id: string): number => {
      let d = 0
      let cur: string | null = byId.get(id)?.parentId ?? null
      while (cur) {
        d++
        cur = byId.get(cur)?.parentId ?? null
      }
      return d
    }
    const root: MoveTarget = { id: null, label: '根目录', depth: 0, icon: '📂' }
    const folders: MoveTarget[] = nodes
      .filter(
        (n) =>
          n.type === 'folder' &&
          (n.lib ?? 'file') === lib &&
          n.id !== node.id &&
          !isDescendant(node.id, n.id),
      )
      .map((n) => ({ id: n.id, label: n.name, depth: depthOf(n.id), icon: '📁' }))
    return [root, ...folders]
  }

  /** "移动到…"选中目标后执行 */
  const onMovePick = (targetId: string | null) => {
    const node = moveNodeTarget
    setMoveNodeTarget(null)
    if (!node) return
    const idx = targetId ? childrenOf(targetId).length : childrenOf(null).length
    const dest = targetId ? byId.get(targetId)?.name ?? '目标' : '根目录'
    moveNode(node.id, targetId, idx)
      .then(() => toast(`已移动到「${dest}」`))
      .catch((e) => {
        console.error('[onMovePick] 移动失败：', e)
        toast(`移动失败：${String(e)}`)
      })
  }

  /** 拖到折叠文件夹上悬停 ~0.7s 自动展开，方便丢到深层 */
  const scheduleAutoExpand = (n: FsNode) => {
    if (n.type !== 'folder' || !collapsedIds.includes(n.id)) return
    if (hoverTimer.current?.id === n.id) return
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current.t)
    hoverTimer.current = {
      id: n.id,
      t: window.setTimeout(() => {
        setCollapsed(n.id, false)
        hoverTimer.current = null
      }, 700),
    }
  }
  const clearAutoExpand = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current.t)
    hoverTimer.current = null
  }

  /* ---------------- 渲染 ---------------- */

  const renderNode = (n: FsNode, depth: number): JSX.Element => {
    const isFolder = n.type === 'folder'
    const kids = isFolder ? childrenOf(n.id) : []
    const isCollapsed = collapsedIds.includes(n.id)
    const isSelected = n.id === selectedId
    const isOpened = openedIds.includes(n.id)

    return (
      <div key={n.id}>
        <div
          className={
            'tree-row' +
            (isSelected ? ' selected' : '') +
            (isOpened ? ' opened' : '') +
            (dropTarget === n.id
              ? dropPos === 'inside'
                ? ' drop-inside'
                : dropPos === 'before'
                  ? ' drop-before'
                  : ' drop-after'
              : '')
          }
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={renamingId !== n.id}
          title={
            n.type === 'folder'
              ? '拖拽调整同级顺序：上半部=放到此文件夹前，下半部=放入文件夹内；右键可上移/下移'
              : '拖拽可调整同级顺序（放到目标前/后）；右键可上移/下移'
          }
          onClick={(e) => {
            e.stopPropagation()
            setSelected(n.id)
            if (isFolder) toggleCollapse(n.id)
            else openNode(n.id)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (isFolder) return
            if (split) openNode(n.id, { pane: activePane === 'left' ? 'right' : 'left' })
            else openNode(n.id)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSelected(n.id)
            setMenu({ x: e.clientX, y: e.clientY, node: n })
          }}
          onDragStart={(e) => {
            setDragId(n.id)
            e.dataTransfer.setData('text/plain', n.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDragId(null)
            setDropTarget(null)
            clearAutoExpand()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            e.stopPropagation()
            setDropTarget(n.id)
            setDropPos(computeDropPos(e, n))
            scheduleAutoExpand(n)
          }}
          onDragLeave={() => {
            if (dropTarget === n.id) {
              setDropTarget(null)
              setDropPos(null)
            }
            if (hoverTimer.current?.id === n.id) clearAutoExpand()
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            clearAutoExpand()
            const pos = computeDropPos(e, n)
            handleDrop(n, e.dataTransfer.getData('text/plain') || dragId, pos)
          }}
        >
          <span
            className="tree-caret"
            onClick={(e) => {
              if (!isFolder) return
              e.stopPropagation()
              toggleCollapse(n.id)
            }}
          >
            {isFolder && kids.length > 0 ? (isCollapsed ? '▸' : '▾') : ''}
          </span>
          <span className="tree-icon">{nodeIcon(n)}</span>

          {renamingId === n.id ? (
            <input
              ref={renameInputRef}
              className="tree-rename"
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tree-name" title={n.name}>
              {n.name}
            </span>
          )}

          <span className="tree-actions">
            {isFolder && (
              <span
                title="在此文件夹内新建"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(n.id)
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    node: n,
                    forceInside: true,
                  })
                }}
              >
                ＋
              </span>
            )}
            <span
              title="重命名"
              onClick={(e) => {
                e.stopPropagation()
                startRename(n)
              }}
            >
              ✎
            </span>
            <span
              title="删除"
              onClick={async (e) => {
                e.stopPropagation()
                const extra = isFolder && kids.length ? '及其全部内容' : ''
                if (await confirmAsync(`确定删除「${n.name}」${extra}？`)) deleteNode(n.id)
              }}
            >
              🗑
            </span>
          </span>
        </div>

        {isFolder && !isCollapsed && kids.length > 0 && (
          <div>{kids.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    )
  }

  const roots = childrenOf(null)

  return (
    <>
      <div className="tree-newbar">
        {lib === 'creation' ? (
          <button className="tb-btn" title="新建小说创作（自动带伏笔看板/角色/剧情/设定/地图）" onClick={createNovel}>
            ＋ 新建创作
          </button>
        ) : (
          <>
            <button className="tb-btn" title="新建文件夹" onClick={() => addNode('folder')}>
              ＋📁
            </button>
            <button className="tb-btn" title="新建文本" onClick={() => addNode('note')}>
              ＋📄
            </button>
            <button className="tb-btn" title="新建思维导图" onClick={() => addNode('mindmap')}>
              ＋🧠
            </button>
            <button className="tb-btn" title="新建任务看板" onClick={() => addNode('board')}>
              ＋📋
            </button>
          </>
        )}
        <span className="tb-spacer" />
        <button
          className="tb-btn"
          title="把新建位置切回根目录（取消选中）"
          onClick={() => setSelected(null)}
        >
          ⌂
        </button>
      </div>

      <div className="tree-target" title="新建的内容会放到这里">
        新建到：<b>{targetLabel}</b>
      </div>

      <div
        className="tree-list"
        onClick={() => setSelected(null)}
        onContextMenu={(e) => {
          e.preventDefault()
          setSelected(null)
          setMenu({ x: e.clientX, y: e.clientY, node: null })
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropTarget(null)
          setDropPos(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          clearAutoExpand()
          handleDrop(null, e.dataTransfer.getData('text/plain') || dragId)
        }}
      >
        {roots.length === 0 && (
          <div className="tree-empty">
            还没有内容。点上方 ＋ 新建文件夹 / 文本 / 思维导图 / 时间线。
            <br />
            右键树中任意项可在其内部（或同级）新建；同级之间可拖拽或用右键「上移/下移」调整顺序。
          </div>
        )}
        {roots.map((n) => renderNode(n, 0))}
      </div>

      {menu && menuPos && (
        <div
          ref={menuRef}
          className="ctx-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="ctx-title">
            {menu.node
              ? menuParent(menu) === menu.node.id
                ? `在「${menu.node.name}」内新建`
                : `在「${menu.node.name}」同级新建`
              : '在根目录新建'}
          </div>

          {lib === 'creation' && !menu.node && (
            <div className="ctx-item" onClick={createNovel}>
              📖 新建小说创作
            </div>
          )}
          {/* 创作库下任何文件夹（小说根 / 卷）都可新建卷与章：按 type 判断，
              不依赖 kind（老数据 kind 可能缺失，此前导致右键入口消失） */}
          {lib === 'creation' && menu.node && menu.node.type === 'folder' && (
            <div className="ctx-item" onClick={() => createVolume(menu.node!.id)}>
              📚 新建卷
            </div>
          )}
          {lib === 'creation' && menu.node && menu.node.type === 'folder' && (
            <div className="ctx-item" onClick={() => createChapter(menu.node!.id)}>
              📄 新建章
            </div>
          )}
          {lib === 'creation' && (
            <div
              className="ctx-item"
              onClick={() => {
                setRefPickParent(menuParent(menu))
                setMenu(null)
                setRefPickerOpen(true)
              }}
            >
              🔗 引用文本库思维导图
            </div>
          )}
          {lib === 'creation' && <div className="ctx-sep" />}

          {(lib === 'file'
            ? (['folder', 'note', 'mindmap', 'board'] as NodeType[])
            : (['folder', 'note', 'mindmap', 'board', 'timeline', 'character', 'plot', 'setting', 'map'] as NodeType[])
          ).map((t) => (
            <div
              key={t}
              className="ctx-item"
              onClick={() => {
                if (t === 'plot') {
                  setMenu(null)
                  setPlotPicker({ parentId: menuParent(menu) })
                } else {
                  createIn(t, menuParent(menu))
                }
              }}
            >
              {ICON[t]} {lib === 'creation' ? GEN_LABEL[t] : TYPE_LABEL[t]}
            </div>
          ))}

          {menu.node && !menu.forceInside && menu.node.type !== 'folder' && (
            <>
              <div className="ctx-sep" />
              <div
                className="ctx-item"
                onClick={() => {
                  const target = menu.node!
                  setMenu(null)
                  if (split)
                    openNode(target.id, {
                      pane: activePane === 'left' ? 'right' : 'left',
                    })
                  else openNode(target.id)
                }}
              >
                ▥ 在{split ? '另一栏' : '编辑区'}打开
              </div>
            </>
          )}

          {menu.node && menu.node.type !== 'folder' && formatsFor(menu.node.type).length > 0 && (
            <>
              <div className="ctx-sep" />
              <div
                className="ctx-item has-sub"
                onClick={(e) => {
                  e.stopPropagation()
                  const id = menu.node!.id
                  setExportSub((cur) => (cur === id ? null : id))
                }}
              >
                📤 导出为…
                {exportSub === menu.node.id && (
                  <div
                    className={'ctx-sub' + (menuPos && menuPos.x > window.innerWidth - 360 ? ' ctx-sub-left' : '')}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {formatsFor(menu.node!.type).map((k) => (
                      <div
                        key={k}
                        className="ctx-item"
                        onClick={() => {
                          const target = menu.node!
                          setMenu(null)
                          setExportSub(null)
                          void exportSingle(target, k, accent)
                        }}
                      >
                        {FORMAT_LABEL[k]}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {menu.node && (
            <>
              <div className="ctx-sep" />
              <div
                className="ctx-item"
                onClick={() => {
                  const id = menu.node!.id
                  setMenu(null)
                  setExportSub(null)
                  openExport(id)
                }}
              >
                📦 批量导出（含子项）…
              </div>
              <div
                className="ctx-item"
                onClick={() => {
                  const node = menu.node!
                  setMenu(null)
                  setExportSub(null)
                  // 文件夹：导入到其内部；文件：导入到其同级
                  openImport(node.type === 'folder' ? node.id : node.parentId ?? null)
                }}
              >
                📥 导入到此处…
              </div>
            </>
          )}

          {menu.node && (
            <>
              <div className="ctx-sep" />
              {(() => {
                const sibs = childrenOf(menu.node!.parentId)
                const idx = sibs.findIndex((n) => n.id === menu.node!.id)
                const canUp = idx > 0
                const canDown = idx >= 0 && idx < sibs.length - 1
                return (
                  <>
                    <div
                      className={'ctx-item' + (canUp ? '' : ' disabled')}
                      title={canUp ? '在同层级上移一位' : '已在最顶部'}
                      onClick={() => canUp && shiftNode(menu.node!, -1)}
                    >
                      ⬆ 上移
                    </div>
                    <div
                      className={'ctx-item' + (canDown ? '' : ' disabled')}
                      title={canDown ? '在同层级下移一位' : '已在最底部'}
                      onClick={() => canDown && shiftNode(menu.node!, 1)}
                    >
                      ⬇ 下移
                    </div>
                  </>
                )
              })()}
              <div
                className="ctx-item"
                onClick={() => {
                  const target = menu.node!
                  setMenu(null)
                  startRename(target)
                }}
              >
                ✎ 重命名
              </div>

              {menu.node && (
                <div
                  className="ctx-item"
                  onClick={() => {
                    const target = menu.node!
                    setMenu(null)
                    setMoveNodeTarget(target)
                  }}
                >
                  📥 移动到…
                </div>
              )}
              <div
                className="ctx-item danger"
                onClick={async () => {
                  const target = menu.node!
                  setMenu(null)
                  const has = childrenOf(target.id).length > 0
                  if (await confirmAsync(`确定删除「${target.name}」${has ? '及其全部内容' : ''}？`))
                    deleteNode(target.id)
                }}
              >
                🗑 删除
              </div>
            </>
          )}
        </div>
      )}

      {moveNodeTarget && (
        <MoveToDialog
          title={`移动「${moveNodeTarget.name}」到`}
          targets={buildMoveTargets(moveNodeTarget)}
          onPick={onMovePick}
          onClose={() => setMoveNodeTarget(null)}
        />
      )}

      {refPickerOpen && (
        <MindMapPicker
          candidates={nodes.filter(
            (n) => n.type === 'mindmap' && (n.lib ?? 'file') === 'file',
          )}
          onPick={async (picked) => {
            setRefPickerOpen(false)
            const parent = refPickParent
            if (parent) setCollapsed(parent, false)
            await addNode('mindmap', parent, 'creation', {
              refId: picked.id,
              name: picked.name,
              rename: true,
            })
          }}
          onClose={() => setRefPickerOpen(false)}
        />
      )}

      {plotPicker && (
        <div className="mat-modal-mask" onClick={() => setPlotPicker(null)}>
          <div className="mat-modal pl-mode-picker" onClick={(e) => e.stopPropagation()}>
            <div className="mat-modal-head">
              <span>新建剧情 · 选择模式</span>
              <span className="mat-modal-close" title="取消" onClick={() => setPlotPicker(null)}>
                ✕
              </span>
            </div>
            <div className="pl-mode-grid">
              {PLOT_MODES.map((m) => (
                <button key={m.key} className="pl-mode-card" onClick={() => choosePlot(m.key)}>
                  <span className="pl-mode-card-ico">{m.icon}</span>
                  <span className="pl-mode-card-label">{m.label}</span>
                  <span className="pl-mode-card-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
