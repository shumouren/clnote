import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { FsNode, NodeType, MindMapDoc, Asset, AssetCategory, PlotMode, MediaSlot, DiskEntry } from '../model/types'
import { emptyMindMap, emptyBoard, emptyTimeline, emptyCharacter, emptyPlot, emptySetting, emptyMap } from '../model/types'
import {
  listNodes,
  getNode,
  saveNode,
  deleteNodeRecursive,
  moveNode as fsMove,
  nextOrder,
  newId,
  putMany,
} from '../storage/fs'
import {
  loadSettings,
  persistSettings,
  applySettings,
  DEFAULT_SETTINGS,
  type Settings,
} from '../settings/settings'
import { mediaKindOf } from '../media/mediaKind'

export type PaneId = 'left' | 'right'

/** 侧边栏可切换的库：文件树 / 素材 / 快捷 / 创作 / 媒体 */
export type SideTab = 'tree' | 'material' | 'shortcut' | 'creation' | 'media'

/**
 * 分栏内容：文件树节点 / 媒体条目（书·视频·图片）/ 笔记内容聚合。
 * 媒体与笔记共用主分栏（与顶部工具栏「分栏」按钮同一套），不再有独立的媒体分栏。
 */
export type PaneContent =
  | { kind: 'node'; id: string }
  | { kind: 'media'; slot: MediaSlot }
  | { kind: 'notes' }
  | null

interface Panes {
  left: PaneContent
  right: PaneContent
}

/** 某个库的分栏状态快照（切换库时保存/恢复用） */
export interface PaneSnap {
  panes: Panes
  activePane: PaneId
  split: boolean
  splitDir?: 'h' | 'v'
}

/** 最近打开的媒体（书架用） */
export interface RecentMedia {
  path: string
  name: string
  ext: string
  time: number
}

const EMPTY_PANE_SNAP = (): PaneSnap => ({
  panes: { left: null, right: null },
  activePane: 'left',
  split: false,
})

/* ---- 最近阅读（书架）持久化 ---- */
const RECENT_KEY = 'clnote-recent-media'
function loadRecent(): RecentMedia[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as RecentMedia[]
    return Array.isArray(arr) ? arr.slice(0, 8) : []
  } catch {
    return []
  }
}

interface AppState {
  nodes: FsNode[]
  panes: Panes
  activePane: PaneId
  split: boolean
  /** 分栏方向：h=左右，v=上下 */
  splitDir: 'h' | 'v'
  /** 各库独立的分栏状态：切换库时编辑区跟着切换，切回来恢复上次打开的页面 */
  paneSnaps: Partial<Record<SideTab, PaneSnap>>
  /** 最近打开的媒体（书架：最近阅读一键续读） */
  recentMedia: RecentMedia[]
  /** 文件树区域（中间侧栏）隐藏 / 展开 */
  sidebarHidden: boolean
  toggleSidebarHidden: () => void
  outlineOpen: boolean
  backlinksOpen: boolean
  /** 版本快照面板显隐 */
  snapOpen: boolean
  toggleSnap: () => void
  /** 伏笔栏（ForeshadowRail）显隐：仅作用于小说章节内的侧栏；默认关闭 */
  foreshowOpen: boolean

  /** 全局设置（外观 / 编辑器 / 存储 / 导出） */
  settings: Settings
  setSettings: (patch: Partial<Settings>) => void
  resetSettings: () => void

  /** 设置窗口 */
  settingsOpen: boolean
  setSettingsOpen: (b: boolean) => void
  /** 导出窗口；exportTarget 为预选中的节点，null 表示全部 */
  exportOpen: boolean
  exportTarget: string | null
  openExport: (targetId?: string | null) => void
  closeExport: () => void

  /** 导入窗口；importTarget 为预选中的父节点，null 表示根目录 */
  importOpen: boolean
  importTarget: string | null
  openImport: (targetId?: string | null) => void
  closeImport: () => void

  /** 文件树中当前选中的节点（与"已打开的文件"解耦，文件夹也能被选中） */
  selectedId: string | null
  /** 处于收起状态的文件夹 id（默认展开） */
  collapsedIds: string[]
  /** 刚新建、需要自动进入重命名的节点 id */
  pendingRenameId: string | null

  setSelected: (id: string | null) => void
  toggleCollapse: (id: string) => void
  setCollapsed: (id: string, collapsed: boolean) => void
  /** 展开该节点的所有祖先，保证它在树里可见 */
  revealNode: (id: string) => void
  setPendingRename: (id: string | null) => void
  /** 依据当前选中项推断"新建到哪个父级" */
  resolveNewParent: () => string | null

  loadNodes: () => Promise<void>
  setNodes: (n: FsNode[]) => void
  openNode: (id: string, opts?: { pane?: PaneId }) => void
  setActivePane: (p: PaneId) => void
  setSplit: (b: boolean) => void
  setSplitDir: (d: 'h' | 'v') => void
  toggleOutline: () => void
  toggleBacklinks: () => void
  toggleForeshow: () => void
  setTheme: (t: string) => void
  setAccent: (c: string) => void
  closePane: (p: PaneId) => void
  addNode: (
    type: NodeType,
    parentId?: string | null,
    lib?: 'file' | 'creation',
    opts?: { kind?: string | null; name?: string; rename?: boolean; refId?: string | null; plotMode?: PlotMode; content?: unknown },
  ) => Promise<string>
  renameNode: (id: string, name: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  moveNode: (id: string, parentId: string | null, index: number) => Promise<void>
  saveNodeContent: (
    id: string,
    content: unknown,
    opts?: { text?: string; name?: string },
  ) => Promise<void>
  getNodeContent: (id: string) => Promise<FsNode | undefined>
  addImportedNodes: (raw: FsNode[], parentId: string | null) => Promise<number>

  /** 素材库：请求把某个素材插入到"当前笔记"（由编辑器组件消费后清空） */
  pendingInsertAsset: Asset | null
  requestInsertAsset: (a: Asset) => void
  clearInsertAsset: () => void

  /** 当前选中的素材主题；null=普通笔记模式；'__all__'=全部素材；其余为具体主题 id */
  activeCategoryId: string | null
  setActiveCategory: (id: string | null) => void

  /** 侧边栏当前 Tab：文件树 / 素材库 / 快捷 / 创作库 / 媒体库（书+音乐+视频合一） */
  sideTab: SideTab
  setSideTab: (tab: SideTab) => void

  /** 当前选中的"快捷"分类；null=普通笔记模式；'__all__'=全部快捷；其余为具体分类 id */
  activeShortcutCategoryId: string | null
  setActiveShortcutCategory: (id: string | null) => void

  /** 搜索结果点击后，请求素材库打开并定位到该素材（点击即"跳进文件"） */
  focusAssetId: string | null
  setFocusAsset: (id: string | null) => void
  /** 搜索结果点击后，请求快捷库打开并定位到该快捷 */
  focusShortcutId: string | null
  setFocusShortcut: (id: string | null) => void

  /** 是否有图片灯箱（素材 / 编辑器插图 / 流程图）打开：
   *  打开时屏蔽窗口的关闭 / 最小化 / 最大化按钮，避免误触直接退出软件 */
  lightboxOpen: boolean
  setLightboxOpen: (b: boolean) => void

  /** 各栏注册"立即保存"回调（供 Ctrl+S 全局快捷键调用）。key 为 paneId */
  saveHandlers: Record<string, () => void>
  registerSaveHandler: (paneId: string, fn: () => void) => void
  unregisterSaveHandler: (paneId: string) => void

  /** 伏笔跳转：请求跳转到某条伏笔所在的章并高亮；存该伏笔 fid，由目标编辑器消费后清空 */
  jumpForeshadowFid: string | null
  requestJumpForeshadow: (fid: string, chapterId: string) => void
  clearJumpForeshadow: () => void

  /** 看板卡片跳转：点击正文里的「精确到卡片」引用后，请求看板定位并展开该卡片 */
  jumpCardId: string | null
  setJumpCardId: (id: string | null) => void

  /** 媒体库侧栏里的「笔记内容」入口：切到媒体库并在激活的分栏展示全部书籍笔记 */
  openNotes: () => void

  /** 在某个分栏打开一个媒体条目（书 / 音频 / 视频 / 图片，按扩展名自动分派查看器）；与节点共用主分栏 */
  openMedia: (
    entry: DiskEntry,
    opts?: { pane?: PaneId; playlist?: DiskEntry[]; subs?: Record<string, DiskEntry> },
  ) => void

  /** 音频常驻播放（底部条）：切栏 / 看视频时音乐继续播 */
  mediaAudio: DiskEntry | null
  mediaAudioList: DiskEntry[]
  openAudio: (entry: DiskEntry, list: DiskEntry[]) => void
  setMediaAudio: (m: DiskEntry | null) => void
  setMediaAudioList: (l: DiskEntry[]) => void
}

const DEFAULT_NAMES: Record<NodeType, string> = {
  folder: '新建文件夹',
  note: '未命名笔记',
  mindmap: '新思维导图',
  board: '新任务看板',
  timeline: '新时间线',
  character: '新角色',
  plot: '新剧情',
  setting: '新设定',
  map: '新地图',
}

/* ---------------- 库导航位置记忆（切换库 / 重启后恢复） ---------------- */
const LIBNAV_KEY = 'clnote-libnav'
interface LibNav {
  sideTab?: AppState['sideTab']
  material?: string | null
  shortcut?: string | null
}
function loadLibNav(): LibNav {
  try {
    const raw = localStorage.getItem(LIBNAV_KEY)
    if (raw) {
      const nav = JSON.parse(raw) as LibNav
      // 兼容旧版（阅读 / 音乐 / 视频三库）：升级到合并后的「媒体库」
      const oldNav = nav.sideTab as string | undefined
      if (oldNav === 'reading' || oldNav === 'music' || oldNav === 'video') {
        nav.sideTab = 'media'
      }
      return nav
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return {}
}
function persistLibNav(patch: Partial<LibNav>) {
  try {
    const cur = loadLibNav()
    localStorage.setItem(LIBNAV_KEY, JSON.stringify({ ...cur, ...patch }))
  } catch {
    /* 忽略写入失败（如隐私模式） */
  }
}

const initialLibNav = loadLibNav()
const initSideTab: AppState['sideTab'] = initialLibNav.sideTab ?? 'tree'
const initMaterial = initialLibNav.material ?? (initSideTab === 'material' ? '__all__' : null)
const initShortcut = initialLibNav.shortcut ?? (initSideTab === 'shortcut' ? '__all__' : null)

export const useStore = create<AppState>((set, get) => ({
  nodes: [],
  panes: { left: null, right: null },
  activePane: 'left',
  split: false,
  splitDir: 'h',
  paneSnaps: {},
  recentMedia: loadRecent(),
  sidebarHidden: (() => {
    try {
      return localStorage.getItem('clnote-sidebar-hidden') === '1'
    } catch {
      return false
    }
  })(),
  toggleSidebarHidden: () => {
    set((s) => {
      const next = !s.sidebarHidden
      try {
        localStorage.setItem('clnote-sidebar-hidden', next ? '1' : '0')
      } catch {
        /* 忽略 */
      }
      return { sidebarHidden: next }
    })
  },
  outlineOpen: true,
  backlinksOpen: false,
  snapOpen: false,
  foreshowOpen: false,

  settings: loadSettings(),
  settingsOpen: false,
  exportOpen: false,
  exportTarget: null,
  importOpen: false,
  importTarget: null,

  setSettings: (patch) => {
    const next = { ...get().settings, ...patch }
    persistSettings(next)
    applySettings(next)
    // 关闭行为偏好需同步给 Rust（最小化到托盘由 Rust 端拦截窗口关闭实现）
    if ('minimizeToTray' in patch) {
      invoke('set_close_behavior', { minimize: next.minimizeToTray }).catch(() => {})
    }
    set({ settings: next })
  },
  resetSettings: () => {
    const next = { ...DEFAULT_SETTINGS }
    persistSettings(next)
    applySettings(next)
    set({ settings: next })
  },
  setSettingsOpen: (b) => set({ settingsOpen: b }),
  openExport: (targetId) => set({ exportOpen: true, exportTarget: targetId ?? null }),
  closeExport: () => set({ exportOpen: false }),

  openImport: (targetId) => set({ importOpen: true, importTarget: targetId ?? null }),
  closeImport: () => set({ importOpen: false }),

  pendingInsertAsset: null,
  requestInsertAsset: (a) => set({ pendingInsertAsset: a }),
  clearInsertAsset: () => set({ pendingInsertAsset: null }),

  activeCategoryId: initMaterial,
  setActiveCategory: (id) => {
    set({ activeCategoryId: id })
    persistLibNav({ material: id })
  },

  sideTab: initSideTab,
  setSideTab: (tab) => {
    const cur = get().sideTab
    // 先快照当前库的分栏状态（编辑区跟着库切换走），再恢复目标库上次的打开状态
    const snap: PaneSnap = {
      panes: get().panes,
      activePane: get().activePane,
      split: get().split,
      splitDir: get().splitDir,
    }
    const target = get().paneSnaps[tab] ?? EMPTY_PANE_SNAP()
    const patch: Partial<AppState> = {
      sideTab: tab,
      paneSnaps: { ...get().paneSnaps, [cur]: snap },
      panes: target.panes,
      activePane: target.activePane,
      split: target.split,
      splitDir: target.splitDir ?? 'h',
    }
    const nav: Partial<LibNav> = { sideTab: tab }
    if (tab === 'material' && get().activeCategoryId == null) {
      patch.activeCategoryId = '__all__'
      nav.material = '__all__'
    }
    if (tab === 'shortcut' && get().activeShortcutCategoryId == null) {
      patch.activeShortcutCategoryId = '__all__'
      nav.shortcut = '__all__'
    }
    // 进入创作库时清空文件树选中，避免误把创作节点建到文件库文件夹下
    if (tab === 'creation') patch.selectedId = null
    // 进入文件库（tree）时，若当前选中项是创作库节点（lib 不是 'file'），也要清空，
    // 否则从「创作库文本」切到「文件库」后点「新建文本」会把节点建到创作库层级下，
    // 在文件库中看起来「新建无效」。
    if (tab === 'tree') {
      const sel = get().nodes.find((n) => n.id === get().selectedId)
      if (sel && sel.lib !== 'file') patch.selectedId = null
    }
    // 快照面板只属于文件库 / 创作库：切到其它库时自动收起，避免面板残留
    if (tab !== 'tree' && tab !== 'creation') patch.snapOpen = false
    set(patch)
    persistLibNav(nav)
  },

  activeShortcutCategoryId: initShortcut,
  setActiveShortcutCategory: (id) => {
    set({ activeShortcutCategoryId: id })
    persistLibNav({ shortcut: id })
  },

  focusAssetId: null,
  setFocusAsset: (id) => set({ focusAssetId: id }),
  focusShortcutId: null,
  setFocusShortcut: (id) => set({ focusShortcutId: id }),

  lightboxOpen: false,
  setLightboxOpen: (b) => set({ lightboxOpen: b }),

  saveHandlers: {},
  registerSaveHandler: (paneId, fn) =>
    set((s) => ({ saveHandlers: { ...s.saveHandlers, [paneId]: fn } })),
  unregisterSaveHandler: (paneId) =>
    set((s) => {
      const next = { ...s.saveHandlers }
      delete next[paneId]
      return { saveHandlers: next }
    }),

  jumpForeshadowFid: null,
  requestJumpForeshadow: (fid, chapterId) => {
    get().openNode(chapterId)
    set({ jumpForeshadowFid: fid })
  },
  clearJumpForeshadow: () => set({ jumpForeshadowFid: null }),

  jumpCardId: null,
  setJumpCardId: (id) => set({ jumpCardId: id }),

  openNotes: () => {
    const { sideTab } = get()
    if (sideTab !== 'media') {
      // 先切到媒体库（setSideTab 会保存当前库状态、恢复媒体库状态）
      get().setSideTab('media')
    }
    const { panes, activePane } = get()
    set({
      panes: { ...panes, [activePane]: { kind: 'notes' } },
      activePane,
    })
  },

  openMedia: (entry, opts) => {
    const kind = mediaKindOf(entry.ext)
    const { panes, activePane, split } = get()
    const target: PaneId = opts?.pane ?? activePane
    // 记住最后打开的媒体（重启后自动续读 / 续播）
    try {
      localStorage.setItem(
        'clnote-last-media',
        JSON.stringify({ path: entry.path, name: entry.name, ext: entry.ext }),
      )
    } catch {
      /* 忽略 */
    }
    // 书架：最近阅读列表（去重，最多 8 条）
    const recent: RecentMedia[] = [
      { path: entry.path, name: entry.name, ext: entry.ext, time: Date.now() },
      ...get().recentMedia.filter((r) => r.path !== entry.path),
    ].slice(0, 8)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
    } catch {
      /* 忽略 */
    }
    set({
      panes: {
        ...panes,
        [target]: {
          kind: 'media',
          slot: { entry, kind, playlist: opts?.playlist, subs: opts?.subs },
        },
      },
      activePane: target,
      split: split || target === 'right',
      recentMedia: recent,
    })
  },

  mediaAudio: null,
  mediaAudioList: [],
  openAudio: (entry, list) => set({ mediaAudio: entry, mediaAudioList: list }),
  setMediaAudio: (m) => set({ mediaAudio: m }),
  setMediaAudioList: (l) => set({ mediaAudioList: l }),

  selectedId: null,
  collapsedIds: [],
  pendingRenameId: null,

  setSelected: (id) => set({ selectedId: id }),

  toggleCollapse: (id) =>
    set((s) => ({
      collapsedIds: s.collapsedIds.includes(id)
        ? s.collapsedIds.filter((x) => x !== id)
        : [...s.collapsedIds, id],
    })),

  setCollapsed: (id, collapsed) =>
    set((s) => ({
      collapsedIds: collapsed
        ? s.collapsedIds.includes(id)
          ? s.collapsedIds
          : [...s.collapsedIds, id]
        : s.collapsedIds.filter((x) => x !== id),
    })),

  revealNode: (id) => {
    const { nodes, collapsedIds } = get()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const chain: string[] = []
    let cur = byId.get(id)?.parentId ?? null
    while (cur) {
      chain.push(cur)
      cur = byId.get(cur)?.parentId ?? null
    }
    if (!chain.length) return
    set({ collapsedIds: collapsedIds.filter((x) => !chain.includes(x)) })
  },

  setPendingRename: (id) => set({ pendingRenameId: id }),

  /**
   * 新建目标父级的唯一判定入口：
   *   选中文件夹 → 建在它里面
   *   选中文件   → 建在它的同级（即它的父级）
   *   没有选中   → 根目录
   */
  resolveNewParent: () => {
    const { nodes, selectedId } = get()
    if (!selectedId) return null
    const sel = nodes.find((n) => n.id === selectedId)
    if (!sel) return null
    return sel.type === 'folder' ? sel.id : sel.parentId
  },

  loadNodes: async () => {
    const all = await listNodes()
    // 清理已被删除节点残留的选中/收起状态
    const ids = new Set(all.map((n) => n.id))
    set((s) => ({
      nodes: all,
      selectedId: s.selectedId && ids.has(s.selectedId) ? s.selectedId : null,
      collapsedIds: s.collapsedIds.filter((x) => ids.has(x)),
    }))
  },
  setNodes: (n) => set({ nodes: n }),

  openNode: (id, opts) => {
    const { panes, activePane, split } = get()
    let target: PaneId = opts?.pane ?? activePane
    // 分栏时若目标栏已打开同一节点，则仅切换焦点
    if (panes[target] && panes[target]!.kind === 'node' && panes[target]!.id === id) {
      set({ activePane: target, selectedId: id })
      return
    }
    set({
      panes: { ...panes, [target]: { kind: 'node', id } },
      activePane: target,
      selectedId: id,
      split: split || target === 'right',
    })
  },

  setActivePane: (p) => set({ activePane: p }),
  setSplit: (b) => set({ split: b, activePane: b ? get().activePane : 'left' }),
  setSplitDir: (d) => set({ splitDir: d }),
  toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen })),
  toggleBacklinks: () => set((s) => ({ backlinksOpen: !s.backlinksOpen })),
  toggleSnap: () => set((s) => ({ snapOpen: !s.snapOpen })),
  toggleForeshow: () => set((s) => ({ foreshowOpen: !s.foreshowOpen })),
  setTheme: (t) => get().setSettings({ theme: t }),
  setAccent: (c) => get().setSettings({ accent: c }),

  closePane: (p) => {
    const { panes, activePane } = get()
    const next = { ...panes, [p]: null }
    if (activePane === p) {
      const other: PaneId = p === 'left' ? 'right' : 'left'
      set({ panes: next, activePane: next[other] ? other : p })
    } else {
      set({ panes: next })
    }
  },

  /**
   * 新建节点。
   * parentId 省略（undefined）时按当前选中项推断；显式传 null 表示强制建到根目录。
   */
  addNode: async (type, parentId, lib = 'file', opts) => {
    const pid = parentId === undefined ? get().resolveNewParent() : parentId
    const id = newId()
    const now = Date.now()
    const order = await nextOrder(pid)
    const content: unknown =
      opts?.content !== undefined
        ? opts.content
        : type === 'mindmap'
          ? emptyMindMap()
          : type === 'board'
            ? emptyBoard()
            : type === 'timeline'
              ? emptyTimeline()
              : type === 'character'
                ? emptyCharacter()
                : type === 'plot'
              ? emptyPlot(opts?.plotMode)
              : type === 'setting'
                ? emptySetting()
                : type === 'map'
                  ? emptyMap()
                  : type === 'note'
                    ? ''
                    : null
    const node: FsNode = {
      id,
      type,
      name: opts?.name ?? DEFAULT_NAMES[type],
      parentId: pid,
      content,
      text: '',
      order,
      updatedAt: now,
      createdAt: now,
      lib,
      kind: opts?.kind ?? null,
      refId: opts?.refId ?? null,
    }
    await saveNode(node)
    await get().loadNodes()

    // 展开祖先链，保证新节点可见；并把它设为选中项 + 进入重命名
    get().revealNode(id)
    set({ selectedId: id })
    if (opts?.rename ?? true) set({ pendingRenameId: id })

    // 文件夹不占用编辑栏，只有文本/思维导图才打开
    if (type !== 'folder') {
      const { activePane, split, panes } = get()
      let target: PaneId = activePane
      if (split) {
        const other: PaneId = activePane === 'left' ? 'right' : 'left'
        if (!panes[activePane]) target = activePane
        else if (!panes[other]) target = other
      }
      get().openNode(id, { pane: target })
    }
    return id
  },

  renameNode: async (id, name) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    const updated = { ...node, name, updatedAt: Date.now() }
    await saveNode(updated)
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? updated : n)) }))
  },

  deleteNode: async (id) => {
    await deleteNodeRecursive(id)
    await get().loadNodes()
    const { panes } = get()
    const isNode = (c: PaneContent) => c !== null && c.kind === 'node' && c.id === id
    const next = {
      left: isNode(panes.left) ? null : panes.left,
      right: isNode(panes.right) ? null : panes.right,
    }
    set({ panes: next })
  },

  moveNode: async (id, parentId, index) => {
    await fsMove(id, parentId, index)
    await get().loadNodes()
    // 移动后展开目标层级，让节点保持可见
    if (parentId) get().setCollapsed(parentId, false)
    get().revealNode(id)
    set({ selectedId: id })
  },

  saveNodeContent: async (id, content, opts) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    const updated: FsNode = {
      ...node,
      content,
      text: opts?.text ?? node.text,
      name: opts?.name ?? node.name,
      updatedAt: Date.now(),
    }
    await saveNode(updated)
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? updated : n)) }))
  },

  getNodeContent: (id) => getNode(id),

  /**
   * 导入节点：重映射 id（避免覆盖现有内容），按目标父节点归位后批量写入并刷新。
   * 返回实际写入的节点数。
   */
  addImportedNodes: async (raw: FsNode[], parentId: string | null) => {
    const remap = new Map<string, string>()
    raw.forEach((n) => remap.set(n.id, newId()))
    const base = await nextOrder(parentId)
    const now = Date.now()
    const final: FsNode[] = raw.map((n, i) => {
      const pid =
        n.parentId && remap.has(n.parentId)
          ? remap.get(n.parentId)!
          : parentId ?? (n.parentId ?? null)
      return {
        ...n,
        id: remap.get(n.id)!,
        parentId: pid,
        order: base + i,
        createdAt: now,
        updatedAt: now,
      }
    })
    await putMany(final)
    await get().loadNodes()
    return final.length
  },
}))

export { getNode }
