import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react'
import { editorExtensions } from './extensions'
import Toolbar from './Toolbar'
import TableToolbar from './TableToolbar'
import Outline, { type OutlineItem } from './Outline'
import ForeshadowRail from './ForeshadowRail'
import { CLOSE_TO_OPEN } from './SmartPunctuation'
import { useStore } from '../store/useStore'
import { getNode } from '../store/useStore'
import { toast } from '../ui/toast'
import { listForeshadowings, addForeshadow, setForeshadowDone, deleteForeshadow } from '../storage/fs'
import { DARK_THEMES } from './MermaidBlock'
import { copyText, exportSvgAsPng } from './mermaidUtils'
import { newId, type Asset, type ForeshadowRow, type FsNode } from '../model/types'
import {
  detectMention,
  applyMention,
  NODE_REF_ORDER,
  getNodeCards,
  type MentionState,
  type RefTarget,
} from './nodeRefShared'
import NodeRefPicker from './NodeRefPicker'
import RefHoverCard from './RefHoverCard'
import { RESTORE_EVENT, type RestoreDetail } from './snapshots'

/* ---- 今日写作量（按日期累计，用于「今日已写」与目标进度） ---- */
const DAILY_KEY = 'clnote-daily-write'
const IMMERSIVE_KEY = 'clnote-editor-immersive'
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function loadDaily(): { date: string; chars: number } {
  try {
    const d = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null') as {
      date?: string
      chars?: number
    } | null
    if (d && d.date === todayKey() && typeof d.chars === 'number') return { date: d.date, chars: d.chars }
  } catch {
    /* 忽略 */
  }
  return { date: todayKey(), chars: 0 }
}

interface Props {
  nodeId: string
  paneId: 'left' | 'right'
  isActive: boolean
  onFocusPane: (p: 'left' | 'right') => void
}

function computeOutline(editor: TiptapEditor): OutlineItem[] {
  const items: OutlineItem[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      items.push({
        level: node.attrs.level as number,
        text: node.textContent?.trim() || '（空标题）',
        pos,
      })
    }
  })
  return items
}

/** 向上回溯祖先，找到所属的小说创作（kind='novel'）id；不在任何小说创作下则返回 null */
function findNovelId(nodes: FsNode[], nodeId: string): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur: FsNode | undefined = byId.get(nodeId)
  while (cur) {
    if (cur.kind === 'novel') return cur.id
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return null
}

/** 在文档里找到某条伏笔标记（fid）的起始位置；找不到返回 -1 */
function findForeshadowPos(editor: TiptapEditor, fid: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.isText) {
      const hit = node.marks.some(
        (m) => m.type.name === 'foreshadowing' && m.attrs.fid === fid,
      )
      if (hit) {
        found = pos
        return false
      }
    }
    return true
  })
  return found
}

/** 在编辑器内更新某条伏笔标记的完成态（同步渲染样式） */
function updateForeshadowMarkDone(editor: TiptapEditor, fid: string, done: number) {
  const { state } = editor
  const tr = state.tr
  let changed = false
  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const mk = node.marks.find(
      (m) => m.type.name === 'foreshadowing' && m.attrs.fid === fid,
    )
    if (mk) {
      const from = pos
      const to = pos + node.nodeSize
      tr.removeMark(from, to, mk.type)
      tr.addMark(from, to, mk.type.create({ ...mk.attrs, done }))
      changed = true
    }
  })
  if (changed) editor.view.dispatch(tr)
}

/** 在编辑器内移除某条伏笔标记 */
function removeForeshadowMark(editor: TiptapEditor, fid: string) {
  const { state } = editor
  const tr = state.tr
  let changed = false
  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const mk = node.marks.find(
      (m) => m.type.name === 'foreshadowing' && m.attrs.fid === fid,
    )
    if (mk) {
      tr.removeMark(pos, pos + node.nodeSize, mk.type)
      changed = true
    }
  })
  if (changed) editor.view.dispatch(tr)
}

/** 高亮闪烁某条伏笔标记，提示用户跳转落点 */
function flashForeshadow(editor: TiptapEditor, fid: string) {
  const dom = editor.view.dom as HTMLElement
  const els = dom.querySelectorAll(`.foreshadow-mark[data-fid="${fid}"]`)
  els.forEach((el) => {
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1500)
  })
}

/** 把素材按类型插入到编辑器指定位置（省略则插入到当前光标） */
function insertAsset(editor: TiptapEditor, asset: Asset, pos?: number): void {
  const at = pos ?? editor.state.selection.from
  const chain = editor.chain().focus()
  switch (asset.type) {
    case 'text':
      chain.insertContentAt(at, asset.content || '').run()
      break
    case 'code':
      chain
        .insertContentAt(at, {
          type: 'codeBlock',
          content: [{ type: 'text', text: asset.content || '' }],
        })
        .run()
      break
    case 'image':
      if (asset.image) {
        chain.insertContentAt(at, { type: 'image', attrs: { src: asset.image } }).run()
      }
      break
    case 'link': {
      const label = asset.title || asset.url || ''
      const text = asset.url ? (label && label !== asset.url ? `${label} (${asset.url})` : asset.url) : label
      chain.insertContentAt(at, text).run()
      break
    }
    case 'book': {
      const ref: string[] = []
      if (asset.title) ref.push(`《${asset.title}》`)
      if (asset.author) ref.push(asset.author)
      if (asset.url) ref.push(asset.url)
      if (asset.image) {
        chain.insertContentAt(at, { type: 'image', attrs: { src: asset.image } }).run()
      }
      chain.insertContentAt(editor.state.selection.from, ref.join(' ')).run()
      break
    }
  }
}

// 根据文档体量自适应自动保存间隔（毫秒）。
// 文档越大保存越稀疏，避免长时间序列化整篇 JSON + 整节点写库卡顿。
function autosaveDelay(docSize: number): number {
  if (docSize > 200_000) return 2500
  if (docSize > 50_000) return 1200
  return 600
}

export default function NoteEditor({ nodeId, paneId, isActive, onFocusPane }: Props) {
  const saveNodeContent = useStore((s) => s.saveNodeContent)
  const settings = useStore((s) => s.settings)
  const set = useStore((s) => s.setSettings)
  // 必须在组件顶层无条件调用，避免"Rules of Hooks"违规（之前写在 JSX 的 IIFE 内，
  // 仅 isForeshow=false 分支执行，导致切换伏笔展示/普通章时 hook 数量变化而白屏）
  const outlineOpen = useStore((s) => s.outlineOpen)
  const foreshowOpen = useStore((s) => s.foreshowOpen)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  // editor 在下方 useEditor 才声明；用 ref 让上方回调闭包能延迟取到实例（避免 TDZ）
  const editorRef = useRef<TiptapEditor | null>(null)
  const nodes = useStore((s) => s.nodes)
  // 当前笔记所属的小说创作（kind='novel'）；非空时启用伏笔功能、用伏笔栏替换大纲栏
  const novelId = useMemo(() => findNovelId(nodes, nodeId), [nodes, nodeId])
  // 同小说下的其他章节（卷 > 章），供「章节快速切换」下拉
  const chapterList = useMemo(() => {
    if (!novelId) return []
    const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]))
    const isUnderNovel = (id: string): boolean => {
      let cur = parentOf.get(id)
      while (cur) {
        if (cur === novelId) return true
        cur = parentOf.get(cur)
      }
      return false
    }
    return nodes.filter((n) => n.type === 'note' && n.id !== nodeId && isUnderNovel(n.id))
  }, [nodes, novelId, nodeId])
  const openNode = useStore((s) => s.openNode)
  // 当前节点本身是否为「伏笔展示」节点（kind='foreshow'）：是则整屏展示伏笔栏
  const isForeshow = useMemo(
    () => nodes.find((n) => n.id === nodeId)?.kind === 'foreshow',
    [nodes, nodeId],
  )
  const [fores, setFores] = useState<ForeshadowRow[]>([])
  /** 格式工具栏折叠（像视频控制栏一样可隐藏） */
  const [toolbarOpen, setToolbarOpen] = useState(true)
  /** 写作统计：字数 / 段落数（实时节流更新） */
  const [stats, setStats] = useState({ chars: 0, paras: 0 })
  const statsTimer = useRef<number | null>(null)
  /** 选区字数（状态栏实时显示，光标未选中时为 0） */
  const [selChars, setSelChars] = useState(0)
  /** 自动保存指示：saving=保存中 / saved=已保存（含时间） */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('saved')
  const [lastSavedAt, setLastSavedAt] = useState(0)
  /** 各笔记上次光标位置（切换笔记时按节点记忆并恢复） */
  const cursorPosRef = useRef<Map<string, number>>(new Map())
  /** 今日写作量（增量累计） */
  const [daily, setDaily] = useState(loadDaily)
  const dailyRef = useRef(daily)
  const lastCharsRef = useRef(-1)
  /** 深色沉浸写作：编辑器单独暗色纸面 */
  const [immersive, setImmersive] = useState(() => {
    try {
      return localStorage.getItem(IMMERSIVE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleImmersive = () => {
    setImmersive((v) => {
      try {
        localStorage.setItem(IMMERSIVE_KEY, v ? '0' : '1')
      } catch {
        /* 忽略 */
      }
      return !v
    })
  }
  // 切换文档时重置增量基准，避免把上一篇的字数计入下一篇
  useEffect(() => {
    lastCharsRef.current = -1
  }, [nodeId])

  const updateStats = useCallback((ed: TiptapEditor) => {
    const text = ed.getText()
    const chars = text.replace(/\s/g, '').length
    const paras = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean).length
    setStats({ chars, paras })
    // 今日写作量：只累计本次新增的字数（增量），不重复计入
    if (lastCharsRef.current >= 0 && chars > lastCharsRef.current) {
      const delta = chars - lastCharsRef.current
      const next = { date: todayKey(), chars: dailyRef.current.chars + delta }
      dailyRef.current = next
      setDaily(next)
      try {
        localStorage.setItem(DAILY_KEY, JSON.stringify(next))
      } catch {
        /* 忽略 */
      }
    }
    lastCharsRef.current = chars
  }, [])

  const loadFores = useCallback(async () => {
    if (!novelId) {
      setFores([])
      return
    }
    try {
      setFores(await listForeshadowings(novelId))
    } catch (e) {
      console.error('[loadFores]', e)
      setFores([])
    }
  }, [novelId])

  useEffect(() => {
    loadFores()
  }, [loadFores])

  const onSetForeshadow = useCallback(() => {
    const ed = editorRef.current
    if (!ed || !novelId) return
    const { from, to } = ed.state.selection
    if (from === to) {
      toast('请先选中一段正文，再设为伏笔')
      return
    }
    const snippet = ed.state.doc.textBetween(from, to, ' ').trim()
    if (!snippet) return

    // 切换：若选区已含伏笔标记，则取消（移除标记 + 删除数据），避免重复叠加导致颜色不断加深
    const existingFids: string[] = []
    ed.state.doc.nodesBetween(from, to, (node) => {
      node.marks.forEach((m) => {
        if (m.type.name === 'foreshadowing' && m.attrs.fid) existingFids.push(m.attrs.fid as string)
      })
    })
    if (existingFids.length > 0) {
      ed.chain().focus().unsetMark('foreshadowing').run()
      existingFids.forEach((fid) =>
        deleteForeshadow(fid).catch((e) => console.error('[onSetForeshadow:unset]', e)),
      )
      setFores((xs) => xs.filter((x) => !existingFids.includes(x.id)))
      return
    }

    const fid = newId()
    ed.chain().focus().setMark('foreshadowing', { fid, done: 0 }).run()
    const now = Date.now()
    const row: ForeshadowRow = {
      id: fid,
      novelId,
      chapterId: nodeId,
      snippet,
      done: 0,
      note: '',
      orderIdx: now,
      createdAt: now,
    }
    addForeshadow(row)
      .then(loadFores)
      .catch((e) => {
        console.error('[onSetForeshadow]', e)
        toast('设为伏笔失败')
      })
  }, [novelId, nodeId, loadFores])

  const onToggleDone = useCallback(
    (f: ForeshadowRow) => {
      const next = f.done ? 0 : 1
      setForeshadowDone(f.id, next).catch((e) => console.error('[onToggleDone]', e))
      setFores((xs) => xs.map((x) => (x.id === f.id ? { ...x, done: next } : x)))
      if (editorRef.current && f.chapterId === nodeId)
        updateForeshadowMarkDone(editorRef.current, f.id, next)
    },
    [nodeId],
  )

  const onJump = useCallback(
    (f: ForeshadowRow) => {
      const ed = editorRef.current
      if (f.chapterId === nodeId && ed) {
        const pos = findForeshadowPos(ed, f.id)
        if (pos >= 0) {
          ed.chain().focus().setTextSelection(pos + 1).scrollIntoView().run()
          flashForeshadow(ed, f.id)
        }
        return
      }
      useStore.getState().requestJumpForeshadow(f.id, f.chapterId)
    },
    [nodeId],
  )

  const onDelete = useCallback(
    (f: ForeshadowRow) => {
      deleteForeshadow(f.id).catch((e) => console.error('[onDelete]', e))
      setFores((xs) => xs.filter((x) => x.id !== f.id))
      if (editorRef.current && f.chapterId === nodeId) removeForeshadowMark(editorRef.current, f.id)
    },
    [nodeId],
  )

  const saveTimer = useRef<number | null>(null)
  const outlineTimer = useRef<number | null>(null)
  // 当前已载入并正在编辑的节点 id；切换笔记时先把它的残留改动落盘，防丢
  const editingId = useRef<string>(nodeId)
  // 始终指向最新 nodeId，避免 onUpdate 闭包拿到旧值
  const nodeIdRef = useRef(nodeId)
  nodeIdRef.current = nodeId
  // 滚动容器引用（打字机模式需要把光标行滚到中央）
  const scrollRef = useRef<HTMLDivElement>(null)
  // 正文容器引用（编辑区缩放 Ctrl+滚轮 用 zoom 作用于它）
  const wrapRef = useRef<HTMLDivElement>(null)
  // 打字机固定框引用（框需实时跟随光标行，故用 JS 定位而非固定在 50%）
  const frameRef = useRef<HTMLDivElement>(null)
  // 联动1：文中引用芯片悬浮预览的状态
  const [refHover, setRefHover] = useState<{ node: FsNode; x: number; y: number } | null>(null)
  const hoverToken = useRef(0)
  const zoomRef = useRef(settings.editorZoom)
  const [zoomPct, setZoomPct] = useState(Math.round(settings.editorZoom * 100))
  const commitRef = useRef<number | null>(null)
  // 点击图片 / 流程图放大灯箱
  type LightboxState =
    | { kind: 'image'; src: string }
    | { kind: 'mermaid'; svg: string; code: string }
    | null
  const [lightbox, setLightbox] = useState<LightboxState>(null)

  // 灯箱（图片 / 流程图）打开时，通知全局屏蔽窗口关闭/最小化/最大化按钮
  const setLightboxOpen = useStore((s) => s.setLightboxOpen)
  useEffect(() => {
    setLightboxOpen(lightbox !== null)
  }, [lightbox, setLightboxOpen])

  // —— 跨栏引用 @ 提及选择器 ——
  const mentionStateRef = useRef<MentionState | null>(null)
  const mentionItemsRef = useRef<RefTarget[]>([])
  const mentionIndexRef = useRef(0)
  const [mentionUI, setMentionUI] = useState<{
    items: RefTarget[]
    index: number
    pos: { top: number; left: number }
  } | null>(null)
  /** 当前下钻的「卡片集合」节点（非空表示正处于「节点 → 卡片」选择态） */
  const expandedNodeRef = useRef<{ id: string; name: string; type: string } | null>(null)

  /** 根据查询串从全局节点筛出可引用目标（排除文件夹与当前笔记），按类型排序 */
  const computeMentionItems = (query: string): RefTarget[] => {
    const all = useStore.getState().nodes
    const q = query.trim().toLowerCase()
    const list = all
      .filter((n) => n.type !== 'folder' && n.id !== nodeId)
      .map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name || '',
        hasCards: getNodeCards(n).length > 0,
      }))
      .filter((n) => !q || n.name.toLowerCase().includes(q))
    list.sort((a, b) => NODE_REF_ORDER.indexOf(a.type) - NODE_REF_ORDER.indexOf(b.type))
    return list
  }

  /** 看板/角色等「卡片集合」下钻：列出该节点内的全部卡片（按查询串过滤），供「精确到卡片」引用 */
  const computeCardItems = (nodeId2: string, query: string): RefTarget[] => {
    const node = useStore.getState().nodes.find((n) => n.id === nodeId2)
    if (!node) return []
    const q = query.trim().toLowerCase()
    return getNodeCards(node)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .map((t) => ({
        id: nodeId2,
        type: node.type,
        name: t.name || '（未命名卡片）',
        cardId: t.id,
      }))
  }

  const updateMention = () => {
    const ed = editorRef.current
    if (!ed) return
    const m = detectMention(ed)
    // 卡片集合下钻态：只要 @ 还在，就按查询串过滤卡片（不退回节点列表）
    const expanded = expandedNodeRef.current
    if (expanded) {
      if (!m) {
        // @ 已删 → 退出下钻并关闭
        expandedNodeRef.current = null
        mentionStateRef.current = null
        setMentionUI(null)
        return
      }
      const items = computeCardItems(expanded.id, m.query)
      mentionStateRef.current = m
      mentionItemsRef.current = items
      mentionIndexRef.current = 0
      let pos = { top: 0, left: 0 }
      try {
        const c = ed.view.coordsAtPos(m.to)
        pos = { top: c.bottom + 6, left: c.left }
      } catch {
        /* ignore */
      }
      setMentionUI({ items, index: 0, pos })
      return
    }
    if (!m) {
      mentionStateRef.current = null
      setMentionUI(null)
      return
    }
    const items = computeMentionItems(m.query)
    mentionStateRef.current = m
    mentionItemsRef.current = items
    mentionIndexRef.current = 0
    let pos = { top: 0, left: 0 }
    try {
      const c = ed.view.coordsAtPos(m.to)
      pos = { top: c.bottom + 6, left: c.left }
    } catch {
      /* ignore */
    }
    setMentionUI({ items, index: 0, pos })
  }

  /** 下钻进入某「卡片集合」节点（看板/角色/剧情/设定），列出其卡片 */
  const expandNode = (item: RefTarget) => {
    expandedNodeRef.current = { id: item.id, name: item.name, type: item.type }
    const items = computeCardItems(item.id, '')
    mentionItemsRef.current = items
    mentionIndexRef.current = 0
    setMentionUI((u) => (u ? { ...u, items, index: 0 } : u))
  }

  /** 退回节点列表态（保留 @ 触发） */
  const collapseNode = () => {
    expandedNodeRef.current = null
    updateMention()
  }

  /** 工具栏「🔗 引用」按钮：在光标处手动唤起选择器（空查询=列出全部节点） */
  const openMentionManual = () => {
    const ed = editorRef.current
    if (!ed) return
    const pos = ed.state.selection.from
    const m: MentionState = { active: true, query: '', from: pos, to: pos }
    mentionStateRef.current = m
    mentionItemsRef.current = computeMentionItems('')
    mentionIndexRef.current = 0
    let p = { top: 0, left: 0 }
    try {
      const c = ed.view.coordsAtPos(pos)
      p = { top: c.bottom + 6, left: c.left }
    } catch {
      /* ignore */
    }
    setMentionUI({ items: mentionItemsRef.current, index: 0, pos: p })
  }

  const editor = useEditor({
    extensions: editorExtensions,
    content: '',
    autofocus: 'end',
    editorProps: {
      // 开启「回车段落首行缩进两格」时，回车断开新段落并在段首插入两个全角空格（真实缩进）
      handleKeyDown: (_view, event) => {
        // —— 跨栏引用 @ 选择器键盘导航（popup 打开时拦截方向键/回车/Tab/Esc）——
        const mm = mentionStateRef.current
        if (mm?.active) {
          const items = mentionItemsRef.current
          if (event.key === 'ArrowDown') {
            mentionIndexRef.current = Math.min(items.length - 1, mentionIndexRef.current + 1)
            setMentionUI((u) => (u ? { ...u, index: mentionIndexRef.current } : u))
            return true
          }
          if (event.key === 'ArrowUp') {
            mentionIndexRef.current = Math.max(0, mentionIndexRef.current - 1)
            setMentionUI((u) => (u ? { ...u, index: mentionIndexRef.current } : u))
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const it = items[mentionIndexRef.current]
            if (it) {
              if (it.hasCards && !it.cardId) {
                expandNode(it)
                return true
              }
              mentionStateRef.current = null
              setMentionUI(null)
              const ed = editorRef.current
              if (ed) {
                try {
                  applyMention(ed, it)
                } catch (e) {
                  console.error('[nodeRef] applyMention failed', e)
                }
              }
            }
            return true
          }
          if (event.key === 'Escape') {
            if (expandedNodeRef.current) {
              collapseNode()
              return true
            }
            mentionStateRef.current = null
            setMentionUI(null)
            return true
          }
        }
        if (event.key !== 'Enter' || event.shiftKey) return false
        if (!editor) return false
        // 光标紧贴右配对符号内侧 → 回车先"跳出"到外侧（与 SmartPunctuation 一致）。
        // 必须在缩进逻辑之前判断：editorProps.handleKeyDown 优先级最高，若先走了缩进，
        // SmartPunctuation 的回车跳出就拿不到事件，导致"回车跳出配对"失效。
        const sel = editor.state.selection
        const afterCh = editor.state.doc.textBetween(sel.from, sel.from + 1, '\0', '\0')
        if (CLOSE_TO_OPEN[afterCh]) {
          editor.commands.setTextSelection(sel.from + 1)
          return true
        }
        const indent = useStore.getState().settings.indentCN
        if (!indent) return false
        const { $head } = editor.state.selection
        // 只对普通段落生效；列表/标题/引用等保留各自的回车语义
        if ($head.parent.type.name !== 'paragraph') return false
        // 1) 断开出新段落 2) 在新段落首插入两个全角空格 3) 光标置于空格之后
        editor.chain().focus().splitBlock().run()
        const at = editor.state.selection.from
        editor.chain().focus().insertContentAt(at, '　　').run()
        editor.commands.setTextSelection(at + 2)
        return true
      },
      // 拖拽素材（来自素材库）落到编辑器时，按类型插入到光标处；直接拖入图片文件则内嵌
      handleDrop: (view, event) => {
        const dt = (event as DragEvent).dataTransfer
        if (!dt) return false
        // 1) 素材库素材（带类型标记）
        if (dt.types.includes('application/x-ccc-asset')) {
          event.preventDefault()
          try {
            const asset = JSON.parse(dt.getData('application/x-ccc-asset')) as Asset
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
            const pos = coords ? coords.pos : view.state.selection.from
            if (editor) insertAsset(editor, asset, pos)
          } catch {
            /* ignore */
          }
          return true
        }
        // 2) 直接拖入的图片文件 → 内嵌为图片节点
        const file = Array.from(dt.files ?? []).find((f) => f.type.startsWith('image/'))
        if (file) {
          event.preventDefault()
          const reader = new FileReader()
          reader.onload = () => {
            const src = String(reader.result ?? '')
            if (!src || !editor) return
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
            const pos = coords ? coords.pos : view.state.selection.from
            editor
              .chain()
              .focus()
              .insertContentAt(pos, { type: 'image', attrs: { src } })
              .run()
          }
          reader.readAsDataURL(file)
          return true
        }
        return false
      },
    },
  })
  // 让上方回调闭包能取到编辑器实例
  editorRef.current = editor

  // 编辑/选区变化 → 刷新 @ 提及选择器状态（打开/过滤/关闭）
  useEffect(() => {
    if (!editor) return
    updateMention()
    const onUpdate = () => updateMention()
    const onSel = () => updateMention()
    editor.on('update', onUpdate)
    editor.on('selectionUpdate', onSel)
    return () => {
      editor.off('update', onUpdate)
      editor.off('selectionUpdate', onSel)
    }
  }, [editor])

  // 选区字数：光标移动 / 选区变化时实时统计选中文本（不含空白），未选中显示 0
  useEffect(() => {
    if (!editor) return
    const onSelChange = () => {
      const { from, to, empty } = editor.state.selection
      if (empty) {
        setSelChars(0)
        return
      }
      const text = editor.state.doc.textBetween(from, to, '\n')
      setSelChars(text.replace(/\s/g, '').length)
    }
    onSelChange()
    editor.on('selectionUpdate', onSelChange)
    return () => {
      editor.off('selectionUpdate', onSelChange)
    }
  }, [editor])

  // 点击 @ 选择器之外任意处（包括编辑器内移动光标）即关闭弹窗，避免卡片残留
  useEffect(() => {
    const onDocDown = (e: globalThis.MouseEvent) => {
      if (!mentionStateRef.current) return
      const t = e.target as HTMLElement
      if (t.closest('.mention-popup')) return
      mentionStateRef.current = null
      setMentionUI(null)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

  // 切换笔记：冲刷上一笔记的待保存改动，再载入新正文
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    const leavingId = editingId.current
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      // 切换瞬间编辑器仍是上一笔记内容，可安全落盘
      if (leavingId && leavingId !== nodeId) {
        const text = editor.getText()
        saveNodeContent(leavingId, editor.getJSON(), { text })
      }
    }
    // 记住上一笔记的光标位置，切回来时原位恢复
    if (leavingId && leavingId !== nodeId) {
      cursorPosRef.current.set(leavingId, editor.state.selection.from)
    }
    editingId.current = nodeId
    getNode(nodeId).then((n) => {
      if (cancelled || !n) return
      editor.commands.setContent((n.content as object) ?? '', false)
      if (useStore.getState().outlineOpen) setOutline(computeOutline(editor))
      // 恢复上次离开时的光标位置（文档变短则钳制到末尾）
      const restore = cursorPosRef.current.get(nodeId)
      if (restore != null) {
        const size = editor.state.doc.content.size
        if (restore <= size) editor.commands.setTextSelection(restore)
      }
      // 重置保存指示：以库里的更新时间作为「上次保存」
      setSaveState('saved')
      setLastSavedAt(n.updatedAt)
      // 伏笔跳转：若本次加载是为了跳转到某条伏笔，定位并高亮
      const fid = useStore.getState().jumpForeshadowFid
      if (fid) {
        const pos = findForeshadowPos(editor, fid)
        if (pos >= 0) {
          editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run()
          flashForeshadow(editor, fid)
        }
        useStore.getState().clearJumpForeshadow()
      }
    })
    return () => {
      cancelled = true
    }
  }, [editor, nodeId, saveNodeContent])

  // 编辑后：自适应防抖保存 + 节流刷新大纲（仅大纲开启时，避免每个按键遍历整篇文档）
  useEffect(() => {
    if (!editor) return
    const onUpdate = () => {
      // 一旦有编辑即进入「保存中」态，落盘完成后切回「已保存 HH:MM」
      setSaveState('saving')
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      const ms = autosaveDelay(editor.state.doc.content.size)
      saveTimer.current = window.setTimeout(() => {
        const text = editor.getText()
        const json = editor.getJSON()
        saveNodeContent(nodeIdRef.current, json, { text })
          .then(() => {
            setSaveState('saved')
            setLastSavedAt(Date.now())
          })
          .catch(() => setSaveState('saved'))
      }, ms)

      // 字数 / 段落统计：节流更新，避免每个按键都遍历全文
      if (statsTimer.current) window.clearTimeout(statsTimer.current)
      statsTimer.current = window.setTimeout(() => updateStats(editor), 250)

      if (useStore.getState().outlineOpen) {
        if (outlineTimer.current) window.clearTimeout(outlineTimer.current)
        outlineTimer.current = window.setTimeout(() => {
          setOutline(computeOutline(editor))
        }, 200)
      }
    }
    // 初次打开已有文档时先统计一次
    updateStats(editor)
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (outlineTimer.current) window.clearTimeout(outlineTimer.current)
      if (statsTimer.current) window.clearTimeout(statsTimer.current)
    }
  }, [editor, saveNodeContent, updateStats])

  const jump = (pos: number) => {
    editor?.chain().focus().setTextSelection(pos + 1).scrollIntoView().run()
  }

  // 素材库"插入到当前笔记"按钮：仅由当前激活的编辑器消费，避免分栏时重复插入
  const pendingInsertAsset = useStore((s) => s.pendingInsertAsset)
  useEffect(() => {
    if (!editor || !pendingInsertAsset || !isActive) return
    insertAsset(editor, pendingInsertAsset)
    useStore.getState().clearInsertAsset()
  }, [editor, pendingInsertAsset, isActive])

  /* ---------------- 打字机 + 专注模式 ---------------- */
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // 打字机固定框：用光标行的真实坐标定位，使框始终框住当前行（无论滚动/缩放/改窗口都跟随）
  const positionTwFrame = useCallback(() => {
    const frame = frameRef.current
    const scroll = scrollRef.current
    const wrap = wrapRef.current
    const ed = editorRef.current
    if (!frame || !scroll || !wrap || !ed) return
    if (!settingsRef.current.typewriter) return
    try {
      const sel = ed.state.selection.from
      const coords = ed.view.coordsAtPos(sel)
      const parent = (frame.offsetParent as HTMLElement) || scroll
      const pr = parent.getBoundingClientRect()
      const lineCenter = (coords.top + coords.bottom) / 2
      const lh = coords.bottom - coords.top
      const frameH = lh + 8
      const wrapRect = wrap.getBoundingClientRect()
      frame.style.top = `${lineCenter - pr.top - frameH / 2}px`
      frame.style.left = `${wrapRect.left - pr.left}px`
      frame.style.width = `${wrapRect.width}px`
      frame.style.height = `${frameH}px`
    } catch { /* ignore */ }
  }, [])

  const applyCaretEffects = useCallback(() => {
    if (!editor) return
    const s = settingsRef.current

    // 打字机：光标行居中（独立 try/catch，异常不影响其余逻辑）
    const scroll = scrollRef.current
    if (scroll) {
      scroll.classList.toggle('typewriter', s.typewriter)
      if (s.typewriter) {
        try {
          const coords = editor.view.coordsAtPos(editor.state.selection.from)
          const top = coords.top - scroll.getBoundingClientRect().top
          const target = scroll.scrollTop + top - scroll.clientHeight / 2
          // typewriterSmooth=false 时用瞬时定位，避免长文逐字平滑滚动的晃动
          scroll.scrollTo({ top: Math.max(0, target), behavior: s.typewriterSmooth ? 'smooth' : 'auto' })
        } catch { /* ignore */ }
      }
    }
    // 框住光标所在行（滚动/选中变化后实时定位）
    positionTwFrame()
  }, [editor, positionTwFrame])

  // 专注模式：当前块高亮交由 ProseMirror 节点装饰（focusHighlight 插件）自动处理，
  // 这里只负责在 <body> 上挂/摘 focus-paragraph / focus-line，并强制装饰随 focusMode 变化重算。
  useEffect(() => {
    const fm = settings.focusMode
    document.body.classList.toggle('focus-paragraph', fm === 'paragraph')
    document.body.classList.toggle('focus-line', fm === 'line')
    const ed = editorRef.current
    if (ed && fm !== 'off') {
      // focusMode 改变未必产生编辑器事务，主动派发空事务触发装饰重算
      try {
        ed.view.dispatch(ed.state.tr.setMeta('focusRefresh', true))
      } catch { /* ignore */ }
    }
  }, [settings.focusMode])

  useEffect(() => {
    if (!editor) return
    applyCaretEffects()
    editor.on('selectionUpdate', applyCaretEffects)
    editor.on('update', applyCaretEffects)
    return () => {
      editor.off('selectionUpdate', applyCaretEffects)
      editor.off('update', applyCaretEffects)
      document.body.classList.remove('focus-paragraph', 'focus-line')
    }
  }, [editor, applyCaretEffects])

  // 打字机框跟随：滚动（含平滑滚动动画过程）与窗口尺寸变化时实时重定位
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const onScroll = () => {
      positionTwFrame()
      setRefHover(null)
    }
    const onResize = () => applyCaretEffects()
    scroll.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      scroll.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [applyCaretEffects, positionTwFrame])

  // 版本快照恢复：SnapshotPanel 派发事件后，把快照内容写回编辑器并持久化
  useEffect(() => {
    const onRestore = (e: Event) => {
      const detail = (e as CustomEvent<RestoreDetail>).detail
      if (!detail || detail.nodeId !== nodeIdRef.current) return
      const ed = editorRef.current
      if (!ed) return
      try {
        ed.commands.setContent(detail.content as never, false)
        const text = ed.getText()
        useStore.getState().saveNodeContent(nodeIdRef.current, detail.content as never, { text })
        ed.commands.focus()
      } catch {
        /* ignore */
      }
    }
    window.addEventListener(RESTORE_EVENT, onRestore)
    return () => window.removeEventListener(RESTORE_EVENT, onRestore)
  }, [editor])

  // 设置变化（打字机/专注开关）时重新应用
  useEffect(() => {
    applyCaretEffects()
  }, [settings, applyCaretEffects])

  /* ---------------- 编辑区缩放（Ctrl / ⌘ + 滚轮，类似 Office） ---------------- */
  useEffect(() => {
    if (wrapRef.current) {
      wrapRef.current.style.zoom = String(settings.editorZoom)
      zoomRef.current = settings.editorZoom
    }
    setZoomPct(Math.round(settings.editorZoom * 100))
  }, [settings.editorZoom])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const cur = parseFloat(wrapRef.current?.style.zoom || '') || zoomRef.current || 1
      const next = Math.min(3, Math.max(0.5, cur - e.deltaY * 0.0015))
      const z = Math.round(next * 100) / 100
      if (wrapRef.current) wrapRef.current.style.zoom = String(z)
      zoomRef.current = z
      setZoomPct(Math.round(z * 100))
      if (commitRef.current) window.clearTimeout(commitRef.current)
      // 防抖写回设置（持久化），期间直接改 style 保证缩放跟手
      commitRef.current = window.setTimeout(() => set({ editorZoom: z }), 200)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [set])

  const onEditorClick = (e: MouseEvent) => {
    // 点击跨栏引用芯片 → 跨面板跳转到目标节点（按 node.lib 切侧栏）
    const refEl = (e.target as HTMLElement).closest('.node-ref') as HTMLElement | null
    if (refEl) {
      const nid = refEl.getAttribute('data-nid')
      if (nid) {
        const node = useStore.getState().nodes.find((n) => n.id === nid)
        const tab = (node?.lib ?? 'file') === 'creation' ? 'creation' : 'tree'
        useStore.getState().setSideTab(tab)
        useStore.getState().openNode(nid)
        // 精确到看板内的某张卡片：跳转后让看板自动定位并展开该卡片
        const cardId = refEl.getAttribute('data-card')
        if (cardId) useStore.getState().setJumpCardId(cardId)
      }
      return
    }
    if (!settings.clickZoom) return
    const t = e.target as HTMLElement
    if (t.tagName === 'IMG') {
      const src = t.getAttribute('src')
      if (src) setLightbox({ kind: 'image', src })
      return
    }
    // 点击流程图预览区 → 灯箱放大查看
    const svgHost = t.closest('.mermaid-svg') as HTMLElement | null
    if (svgHost) {
      const block = svgHost.closest('.mermaid-block') as HTMLElement | null
      const svg = svgHost.innerHTML
      const code = block?.getAttribute('data-code') ?? ''
      if (svg) setLightbox({ kind: 'mermaid', svg, code })
    }
  }

  // 联动1：悬浮在引用芯片上 → 显示创作库卡片预览
  const onEditorMouseOver = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.node-ref') as HTMLElement | null
    if (!el) return
    const nid = el.getAttribute('data-nid')
    if (!nid) return
    const r = el.getBoundingClientRect()
    const x = r.left
    const y = r.bottom + 6
    const token = ++hoverToken.current
    getNode(nid).then((n) => {
      if (!n || hoverToken.current !== token) return
      setRefHover({ node: n, x, y })
    })
  }
  const onEditorMouseOut = (e: MouseEvent) => {
    const to = e.relatedTarget as HTMLElement | null
    if (to && to.closest && to.closest('.node-ref')) return
    setRefHover(null)
  }

  /* 重置编辑区缩放到 100% */
  const resetZoom = () => {
    if (commitRef.current) window.clearTimeout(commitRef.current)
    zoomRef.current = 1
    if (wrapRef.current) wrapRef.current.style.zoom = '1'
    set({ editorZoom: 1 })
    setZoomPct(100)
  }

  /* ---------------- 注册"立即保存"回调（供 Ctrl+S 调用） ---------------- */
  useEffect(() => {
    if (!editor || isForeshow) return
    const fn = () => {
      const text = editor.getText()
      setSaveState('saving')
      useStore
        .getState()
        .saveNodeContent(nodeIdRef.current, editor.getJSON(), { text })
        .then(() => {
          setSaveState('saved')
          setLastSavedAt(Date.now())
        })
        .catch(() => setSaveState('saved'))
    }
    useStore.getState().registerSaveHandler(paneId, fn)
    return () => useStore.getState().unregisterSaveHandler(paneId)
  }, [editor, paneId, isForeshow])

  return (
    <div
      className={'pane-inner' + (isActive ? ' active' : '') + (immersive ? ' editor-immersive' : '')}
      onClick={() => onFocusPane(paneId)}
    >
      {isForeshow ? (
        // 「伏笔展示」节点：整屏展示该小说创作下的全部伏笔
        <div className="pane-body fs-pane">
          <ForeshadowRail
            items={fores}
            currentChapterId={nodeId}
            onToggleDone={onToggleDone}
            onJump={onJump}
            onDelete={onDelete}
          />
        </div>
      ) : (
        <>
          {toolbarOpen ? (
            <div className="pane-toolbar">
              <Toolbar
                editor={editor}
                novelId={novelId}
                onSetForeshadow={onSetForeshadow}
                onInsertRef={openMentionManual}
              />
              <span className="tb-sep" />
              <TableToolbar editor={editor} />
              <span className="tb-sep" />
              <span className="tb-zoom">缩放 {zoomPct}%</span>
              <button className="tb-btn" onClick={resetZoom} title="重置缩放为 100%">
                重置
              </button>
              {chapterList.length > 0 && (
                <select
                  className="video-select"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (v) openNode(v, { pane: paneId })
                  }}
                  title="快速切换到同小说的其他章节"
                >
                  <option value="">📖 章节</option>
                  {chapterList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="tb-spacer" />
              <button
                className={'tb-btn' + (immersive ? ' active' : '')}
                onClick={toggleImmersive}
                title="深色沉浸写作：编辑器单独暗色纸面（护眼）"
              >
                🌙 沉浸
              </button>
              <button className="tb-btn" onClick={() => setToolbarOpen(false)} title="收起格式工具栏">
                ▾
              </button>
            </div>
          ) : (
            <div className="pane-toolbar-mini">
              <button className="tb-btn" onClick={() => setToolbarOpen(true)} title="展开格式工具栏">
                ▴ 工具栏
              </button>
            </div>
          )}
          <div className="pane-body">
        <div
          className="editor-scroll"
          ref={scrollRef}
          onClick={onEditorClick}
          onMouseOver={onEditorMouseOver}
          onMouseOut={onEditorMouseOut}
        >
          <div className="editor-wrap" ref={wrapRef}>
            <EditorContent editor={editor} />
          </div>
        </div>
        {/* 打字机模式：固定框实时框住光标所在行（位置由 JS 跟随光标计算） */}
        {settings.typewriter && <div className="tw-frame" ref={frameRef} aria-hidden="true" />}
        {refHover && <RefHoverCard node={refHover.node} x={refHover.x} y={refHover.y} />}
        {mentionUI && (
          <NodeRefPicker
            items={mentionUI.items}
            activeIndex={mentionUI.index}
            pos={mentionUI.pos}
            expandedBoard={expandedNodeRef.current?.name ?? null}
            expandedType={expandedNodeRef.current?.type ?? null}
            onExpand={expandNode}
            onBack={collapseNode}
            onSelect={(it) => {
              // 先关弹窗：即便插入失败（坐标漂移等），卡片也不残留
              mentionStateRef.current = null
              setMentionUI(null)
              const ed = editorRef.current
              if (ed) {
                try {
                  applyMention(ed, it)
                } catch (e) {
                  console.error('[nodeRef] applyMention failed', e)
                }
              }
            }}
            onHover={(i) => {
              mentionIndexRef.current = i
              setMentionUI((u) => (u ? { ...u, index: i } : u))
            }}
          />
        )}
        {(() => {
          // 小说章节：侧栏用「伏笔栏」，由独立开关 foreshowOpen 控制（默认关闭）
          if (novelId) {
            if (!foreshowOpen) return null
            return (
              <ForeshadowRail
                items={fores}
                currentChapterId={nodeId}
                onToggleDone={onToggleDone}
                onJump={onJump}
                onDelete={onDelete}
              />
            )
          }
          // 普通笔记：侧栏用「大纲」，由 outlineOpen 控制
          if (!outlineOpen) return null
          return <Outline items={outline} onJump={jump} />
        })()}
          </div>
        <div className="editor-status">
          <span title="字数（不含空白）">字数 {stats.chars}</span>
          <span title="段落数">段落 {stats.paras}</span>
          {selChars > 0 && <span title="当前选中的字数（不含空白）">选中 {selChars}</span>}
          {daily.chars > 0 && <span title="今日累计写作量（增量）">今日 +{daily.chars}</span>}
          {settings.dailyGoal > 0 && (
            <span
              className={daily.chars >= settings.dailyGoal ? 'status-goal-done' : ''}
              title={`今日目标 ${settings.dailyGoal} 字`}
            >
              目标 {Math.min(daily.chars, settings.dailyGoal)}/{settings.dailyGoal}
            </span>
          )}
          <span className="status-save" title="自动保存状态">
            {saveState === 'saving'
              ? '保存中…'
              : saveState === 'saved' && lastSavedAt > 0
                ? `已保存 ${new Date(lastSavedAt).toTimeString().slice(0, 5)}`
                : ''}
          </span>
        </div>
        </>
      )}

      {lightbox?.kind === 'image' && (
        <div className="img-lightbox" onClick={() => setLightbox(null)}>
          <button className="lb-close" title="关闭（Esc）" onClick={() => setLightbox(null)}>
            ×
          </button>
          <img src={lightbox.src} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      {lightbox?.kind === 'mermaid' && (
        <MermaidLightbox
          svg={lightbox.svg}
          code={lightbox.code}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

/** 流程图放大灯箱：大图预览 + 复制源码 / 导出 PNG / 关闭 */
function MermaidLightbox({
  svg,
  code,
  onClose,
}: {
  svg: string
  code: string
  onClose: () => void
}) {
  const themeId = useStore((s) => s.settings.theme)
  const dark = DARK_THEMES.has(themeId)
  const [busy, setBusy] = useState(false)

  const onCopy = async () => {
    const ok = await copyText(code)
    toast(ok ? '已复制流程图源码' : '复制失败')
  }
  const onExport = async () => {
    if (busy) return
    setBusy(true)
    try {
      await exportSvgAsPng(svg, `流程图-${Date.now()}.png`, 3)
      toast('已导出 PNG')
    } catch (e: unknown) {
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="img-lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div
          className="lightbox-mermaid"
          style={{ background: dark ? '#1e2128' : '#ffffff' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="lightbox-actions">
          <button className="lb-btn" onClick={onCopy}>
            复制源码
          </button>
          <button className="lb-btn" onClick={onExport} disabled={busy}>
            {busy ? '导出中…' : '导出 PNG'}
          </button>
          <button className="lb-btn primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
