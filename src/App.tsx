import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import Sidebar from './sidebar/Sidebar'
import LibraryRail from './sidebar/LibraryRail'
import WorkArea from './workbench/WorkArea'
import ThemeBoard from './material/ThemeBoard'
import ShortcutBoard from './shortcut/ShortcutBoard'
import AudioBar from './media/AudioBar'
import SettingsDialog from './settings/SettingsDialog'
import ExportDialog from './export/ExportDialog'
import ImportDialog from './import/ImportDialog'
import SearchPanel from './search/SearchPanel'
import Pomodoro from './components/Pomodoro'
import { ToastHost, toast } from './ui/toast'
import { applySettings } from './settings/settings'
import { useStore, type PaneContent } from './store/useStore'
import { setupBossKey } from './platform/bossKey'
import type { DiskEntry, NodeType } from './model/types'

interface PaletteCmd {
  id: string
  label: string
  run: () => void
}

export default function App() {
  const {
    split,
    splitDir,
    outlineOpen,
    backlinksOpen,
    snapOpen,
    foreshowOpen,
    settings,
    setSplit,
    setSplitDir,
    toggleOutline,
    toggleBacklinks,
    toggleSnap,
    toggleForeshow,
    setTheme,
    loadNodes,
    addNode,
    setSettingsOpen,
    openExport,
    openImport,
    panes,
    activePane,
    setSettings,
    sideTab,
    sidebarHidden,
    toggleSidebarHidden,
  } = useStore()

  /** 顶部按钮按库显示：文件库=分栏/大纲/被引用/快照；创作库=分栏/伏笔/被引用/快照；媒体库=仅分栏；素材/快捷=无 */
  const tb = (() => {
    if (sideTab === 'tree') return { split: true, outline: true, backlinks: true, foreshow: false, snap: true }
    if (sideTab === 'creation') return { split: true, outline: false, backlinks: true, foreshow: true, snap: true }
    if (sideTab === 'media') return { split: true, outline: false, backlinks: false, foreshow: false, snap: false }
    return { split: false, outline: false, backlinks: false, foreshow: false, snap: false }
  })()

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [bossHidden, setBossHidden] = useState(false)
  // 是否已在 Tauri 端成功注册系统级老板键：成功则不用文档监听（避免重复切换），走真正最小化
  const bossTauriRef = useRef(false)
  const bossKey = settings.bossKey

  // 文件树宽度可拖拽调整：直接改 settings.sidebarWidth（经 CSS 变量 --sidebar-width 生效并持久化）
  const resizingRef = useRef(false)
  const startResizeSidebar = (e: ReactMouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    const sidebarEl = document.querySelector('.sidebar') as HTMLElement | null
    const origin = sidebarEl ? sidebarEl.getBoundingClientRect().left : 0
    const move = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      let w = ev.clientX - origin
      w = Math.max(180, Math.min(520, w))
      setSettings({ sidebarWidth: Math.round(w) })
    }
    const up = () => {
      resizingRef.current = false
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  useEffect(() => {
    loadNodes()
  }, [loadNodes])

  // 启动续读：上次停在媒体库且最后打开过书/视频/图片时，自动恢复到分栏
  useEffect(() => {
    try {
      const raw = localStorage.getItem('clnote-last-media')
      if (!raw) return
      const d = JSON.parse(raw) as { path?: string; name?: string; ext?: string }
      if (!d?.path || useStore.getState().sideTab !== 'media') return
      const name = d.name || String(d.path).split(/[\\/]/).pop() || d.path
      const entry: DiskEntry = {
        path: d.path,
        name,
        isDir: false,
        size: 0,
        modified: 0,
        ext: d.ext || '',
      }
      useStore.getState().openMedia(entry)
    } catch {
      /* 忽略损坏数据 */
    }
  }, [])

  // 首次挂载把持久化的设置写进 CSS 变量（之后的改动由 setSettings 直接生效）
  useEffect(() => {
    applySettings(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        const c = useStore.getState().panes[useStore.getState().activePane]
        openExport(c && c.kind === 'node' ? c.id : null)
      } else if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        openImport(null)
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const { activePane, saveHandlers } = useStore.getState()
        saveHandlers[activePane]?.()
        toast('已保存')
      } else if (e.key === 'Escape') {
        setPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSettingsOpen, openExport, openImport, setSearchOpen])

  // 老板键：在 Tauri 端注册系统级全局快捷键（真正最小化/恢复窗口）；
  // 注册成功后走真实最小化，浏览器环境或非 Tauri 则回退为全屏遮罩。
  useEffect(() => {
    let alive = true
    setupBossKey(bossKey).then((ok) => {
      if (alive) bossTauriRef.current = ok
    })
    return () => {
      alive = false
    }
  }, [bossKey])

  // 浏览器回退方案：仅在未注册系统级快捷键时，用文档监听 + 全屏遮罩隐藏内容
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (bossTauriRef.current) return
      const bk = useStore.getState().settings.bossKey || 'F9'
      if (e.key === bk) {
        e.preventDefault()
        setBossHidden((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    document.body.classList.toggle('boss-hidden', bossHidden)
  }, [bossHidden])

  // 新建落点统一由 store 依据文件树选中项推断（见 resolveNewParent）
  const newUnderActive = (type: NodeType) => {
    addNode(type)
  }

  /** 导出仅针对文件树节点：分栏里是媒体 / 笔记时视为未选中（导出全部） */
  const exportTargetOf = (c: PaneContent) => (c && c.kind === 'node' ? c.id : null)

  const commands: PaletteCmd[] = [
    { id: 'new-note', label: '新建文本', run: () => newUnderActive('note') },
    { id: 'new-folder', label: '新建文件夹', run: () => newUnderActive('folder') },
    { id: 'new-mind', label: '新建思维导图', run: () => newUnderActive('mindmap') },
    { id: 'new-note-root', label: '新建文本（根目录）', run: () => addNode('note', null) },
    { id: 'new-folder-root', label: '新建文件夹（根目录）', run: () => addNode('folder', null) },
    { id: 'split', label: split ? '关闭分栏' : '开启分栏', run: () => setSplit(!split) },
    { id: 'outline', label: outlineOpen ? '隐藏大纲' : '显示大纲', run: () => toggleOutline() },
    { id: 'backlinks', label: backlinksOpen ? '隐藏被引用' : '显示被引用', run: () => toggleBacklinks() },
    { id: 'settings', label: '打开设置', run: () => setSettingsOpen(true) },
    { id: 'import', label: '导入文件', run: () => openImport(null) },
    { id: 'export-cur', label: '导出当前文件', run: () => openExport(exportTargetOf(panes[activePane])) },
    { id: 'export-all', label: '批量导出全部', run: () => openExport(null) },
    { id: 't-light', label: '主题：浅色', run: () => setTheme('light') },
    { id: 't-dark', label: '主题：暗色', run: () => setTheme('dark') },
    { id: 't-paper', label: '主题：纸感', run: () => setTheme('paper') },
    { id: 't-eye', label: '主题：护眼', run: () => setTheme('eye') },
  ]
  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  )
  const runCmd = (c: PaletteCmd) => {
    c.run()
    setPaletteOpen(false)
    setPaletteQuery('')
  }

  return (
    <>
      <div className="app-shell">
        <LibraryRail />
        {!sidebarHidden && (
          <>
            <Sidebar />
            <div className="sidebar-resizer" onMouseDown={startResizeSidebar} title="拖拽调整文件树宽度" />
          </>
        )}
      <div className="main">
        <div className="topbar">
          <button
            className={'tb-btn' + (sidebarHidden ? ' active' : '')}
            title={sidebarHidden ? '展开文件树区域' : '隐藏文件树区域'}
            onClick={toggleSidebarHidden}
          >
            {sidebarHidden ? '▸ 文件树' : '◂ 收起'}
          </button>
          {tb.split && (
          <>
          <button
            className={'tb-btn' + (split && splitDir === 'h' ? ' active' : '')}
            title="左右分栏：左栏与右栏并排"
            onClick={() => {
              if (split && splitDir === 'h') setSplit(false)
              else {
                setSplitDir('h')
                setSplit(true)
              }
            }}
          >
            ▥ 左右
          </button>
          <button
            className={'tb-btn' + (split && splitDir === 'v' ? ' active' : '')}
            title="上下分栏：上栏与下栏堆叠"
            onClick={() => {
              if (split && splitDir === 'v') setSplit(false)
              else {
                setSplitDir('v')
                setSplit(true)
              }
            }}
          >
            ▤ 上下
          </button>
          </>
          )}
          {tb.outline && (
          <button
            className={'tb-btn' + (outlineOpen ? ' active' : '')}
            title="标题大纲"
            onClick={() => toggleOutline()}
          >
            大纲
          </button>
          )}
          {tb.backlinks && (
          <button
            className={'tb-btn' + (backlinksOpen ? ' active' : '')}
            title="被引用 / 反向链接"
            onClick={() => toggleBacklinks()}
          >
            🔗 被引用
          </button>
          )}
          {tb.snap && (
          <button
            className={'tb-btn' + (snapOpen ? ' active' : '')}
            title="版本快照（保存 / 恢复 / 对比历史版本）"
            onClick={() => toggleSnap()}
          >
            📸 快照
          </button>
          )}
          {tb.foreshow && (
          <button
            className={'tb-btn' + (foreshowOpen ? ' active' : '')}
            title="伏笔栏（仅小说章节内显示该小说的全部伏笔）"
            onClick={() => toggleForeshow()}
          >
            🔖 伏笔
          </button>
          )}
          <input
            className="topbar-search"
            placeholder="🔍 搜索全部内容 (Ctrl/Cmd+F)"
            readOnly
            onFocus={() => setSearchOpen(true)}
            onClick={() => setSearchOpen(true)}
          />
          <span className="tb-spacer" />
          {/* 番茄钟：常驻顶栏右侧（最大化/关闭按钮下方），切库/分栏不中断计时 */}
          <Pomodoro />
        </div>

        {sideTab === 'shortcut' ? (
          <ShortcutBoard />
        ) : sideTab === 'material' ? (
          <ThemeBoard />
        ) : (
          /* 文件树 / 创作库 / 媒体库 共用主工作区：媒体（书·视频·图片·笔记）与笔记同分栏 */
          <WorkArea />
        )}
        {/* 音频常驻底部播放条：与分栏 / 所在库解耦，看书看视频时音乐不中断 */}
        <AudioBar />

        {paletteOpen && (
          <div className="palette-mask" onClick={() => setPaletteOpen(false)}>
            <div className="palette" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                className="palette-input"
                placeholder="输入命令…"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0]) runCmd(filtered[0])
                }}
              />
              {filtered.map((c) => (
                <div key={c.id} className="palette-item" onClick={() => runCmd(c)}>
                  {c.label}
                </div>
              ))}
              {filtered.length === 0 && <div className="palette-empty">无匹配命令</div>}
            </div>
          </div>
        )}
      </div>

      <SettingsDialog />
      <ExportDialog />
      <ImportDialog />

      {/* 古风纸主题：叠加极淡宣纸噪点纹理 */}
      {settings.theme === 'guofeng' && <div className="paper-noise" />}

      {/* 全局搜索 */}
      {searchOpen && <SearchPanel onClose={() => setSearchOpen(false)} />}

      {/* 轻提示 */}
      <ToastHost />
      </div>

      {/* 老板键遮罩：置于 app-shell 之外，避免被 visibility:hidden 一起隐藏 */}
      {bossHidden && <div className="boss-veil">已隐藏 · 按 {settings.bossKey} 恢复</div>}
    </>
  )
}
