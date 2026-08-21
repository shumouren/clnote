import { useEffect, useMemo, useRef, useState } from 'react'
import type { BookNote, BookProgress, MediaSlot } from '../model/types'
import {
  getBookProgress,
  setBookProgress,
  listBookNotes,
  addBookNote,
  deleteBookNote,
} from '../storage/media'
import EpubReader from '../reading/EpubReader'
import PdfReader from '../reading/PdfReader'
import TextReader from '../reading/TextReader'
import { normExt } from './mediaKind'

const uid = () => 'bn_' + Math.random().toString(36).slice(2) + Date.now().toString(36)

/** 阅读字号（A−/A+）偏好：本地记忆，重启后保持（对文本 / epub / pdf 均生效） */
const FONT_KEY = 'clnote-reader-font'
function loadFontScale(): number {
  try {
    const v = Number(localStorage.getItem(FONT_KEY))
    return v >= 0.7 && v <= 2 ? v : 1
  } catch {
    return 1
  }
}

/** 阅读主题：背景（默认 / 纸感 / 夜间）+ 字体（默认 / 衬线），本地记忆 */
type ReaderBg = 'default' | 'paper' | 'night'
const THEME_KEY = 'clnote-reader-theme'
const READER_BG: Record<ReaderBg, { bg: string; color: string; label: string }> = {
  default: { bg: '', color: '', label: '📖 默认' },
  paper: { bg: '#f5ecd9', color: '#3f3628', label: '📄 纸感' },
  night: { bg: '#1e232b', color: '#c6cfdd', label: '🌙 夜间' },
}
function loadReaderTheme(): { bg: ReaderBg; serif: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_KEY) || '{}') as {
      bg?: ReaderBg
      serif?: boolean
    }
    return { bg: raw.bg ?? 'default', serif: !!raw.serif }
  } catch {
    return { bg: 'default', serif: false }
  }
}

/** 媒体库中「书 / 文本」分栏：按扩展名分派阅读器，统一处理进度记忆与批注 */
export default function BookView({ slot, onClose }: { slot: MediaSlot; onClose: () => void }) {
  const { entry } = slot
  const [progress, setProgress] = useState<BookProgress | null>(null)
  const [notes, setNotes] = useState<BookNote[]>([])
  /** 批注面板默认关闭，进入书籍后按需打开（打开时阅读器自动重排，不会超屏） */
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [fontScale, setFontScale] = useState(loadFontScale)
  const [readerTheme, setReaderTheme] = useState(loadReaderTheme)
  const saveTimer = useRef<number | null>(null)
  /** 新批注的锚点 CFI（从阅读器划词「批注」而来；手动输入时用当前进度） */
  const [anchorCfi, setAnchorCfi] = useState<string | null>(null)
  /** 点击批注列表 → 跳转到书内该位置（CFI 精确定位） */
  const [jumpCfi, setJumpCfi] = useState<string | null>(null)
  const [jumpTick, setJumpTick] = useState(0)
  /** 批注输入框聚焦计数（划词批注后自动聚焦） */
  const [noteFocusTick, setNoteFocusTick] = useState(0)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  /** 工具栏「高亮」按钮点击计数（递增传给阅读器高亮当前选区） */
  const [hlSignal, setHlSignal] = useState(0)
  /** 删除高亮笔记时传给阅读器移除对应标记 */
  const [removeHl, setRemoveHl] = useState<{ cfi: string; tick: number } | null>(null)
  const readerWrapRef = useRef<HTMLDivElement>(null)

  // 阅读区容器尺寸变化（批注开关 / 文件树拖宽 / 分栏拖宽 / 窗口缩放）→ 通知 epub 重排。
  // 监听的是外层 flex 容器 reading-reader：其尺寸由 flex 布局决定、不随 epub 内容变化
  // （epub-view overflow hidden），故不会像早前监听内层那样形成重排循环。
  useEffect(() => {
    const el = readerWrapRef.current
    if (!el) return
    let lastW = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - lastW) < 2) return
      lastW = el.clientWidth
      window.dispatchEvent(new Event('clnote-pane-resized'))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** 已持久化的高亮 CFI 列表（空文本批注 = 高亮笔记），打开书时重放 */
  const replayHighlights = useMemo(
    () => notes.filter((n) => !n.text && !!n.anchor).map((n) => n.anchor as string),
    [notes],
  )

  // 划词「批注」：打开批注面板、锚定到选中文字位置、自动聚焦输入框
  const onAddNoteFromReader = (cfi: string, percent: number) => {
    setAnchorCfi(cfi)
    setNotesOpen(true)
    setNoteFocusTick((t) => t + 1)
  }

  // 阅读器高亮成功 → 持久化为「高亮笔记」（空文本批注，anchor 记录位置）。
  // 去重：同一位置已有高亮笔记则不重复添加，避免高亮两层。
  const onHighlightFromReader = (cfi: string) => {
    if (notes.some((n) => !n.text && n.anchor === cfi)) return
    const note: BookNote = {
      id: uid(),
      bookPath: entry.path,
      bookName: entry.name,
      anchor: cfi,
      text: '',
      createdAt: Date.now(),
    }
    addBookNote(note)
      .then(() => refreshNotes())
      .catch(() => {})
  }

  useEffect(() => {
    if (noteFocusTick > 0) noteInputRef.current?.focus()
  }, [noteFocusTick])

  /** 字号变化：写入本地记忆 */
  const changeFont = (next: number) => {
    setFontScale(next)
    try {
      localStorage.setItem(FONT_KEY, String(next))
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }

  /** 阅读主题变化：写入本地记忆 */
  const changeTheme = (patch: Partial<{ bg: ReaderBg; serif: boolean }>) => {
    const next = { ...readerTheme, ...patch }
    setReaderTheme(next)
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(next))
    } catch {
      /* 忽略 */
    }
  }

  /** 循环背景：默认 → 纸感 → 夜间 → 默认 */
  const cycleBg = () => {
    const order: ReaderBg[] = ['default', 'paper', 'night']
    const i = order.indexOf(readerTheme.bg)
    changeTheme({ bg: order[(i + 1) % order.length] })
  }

  // 阅读主题应用到阅读器（文本用内联样式，epub 用 themes.override）
  const themeOf: { bg: string; color: string } =
    readerTheme.bg === 'default' ? { bg: '', color: '' } : READER_BG[readerTheme.bg]
  const readerThemeProps = {
    bg: themeOf.bg || undefined,
    color: themeOf.color || undefined,
    font: readerTheme.serif ? 'Georgia, "Songti SC", "Noto Serif SC", serif' : undefined,
  }

  useEffect(() => {
    let alive = true
    getBookProgress(entry.path)
      .then((p) => alive && setProgress(p))
      .catch(() => {})
    listBookNotes(entry.path)
      .then((n) => {
        if (alive) setNotes(n)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [entry.path])

  const onProgress = (p: { percent: number; cfi?: string }) => {
    const next: BookProgress = {
      bookPath: entry.path,
      cfi: p.cfi,
      percent: p.percent,
      updatedAt: Date.now(),
    }
    // setProgress 节流：percent 变化 <0.5 且 cfi 相同则不刷新 UI，
    // 避免阅读器高频回调（如 epub relocated）导致界面反复重渲染
    setProgress((prev) =>
      prev &&
      prev.cfi === p.cfi &&
      Math.abs((prev.percent ?? 0) - (p.percent ?? 0)) < 0.5
        ? prev
        : next,
    )
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      setBookProgress(next).catch(() => {})
    }, 800)
  }

  const refreshNotes = async () => {
    const n = await listBookNotes(entry.path).catch(() => [])
    setNotes(n)
  }

  const addNote = async () => {
    if (!noteText.trim()) return
    const note: BookNote = {
      id: uid(),
      bookPath: entry.path,
      bookName: entry.name,
      // 锚定到划词位置（CFI）；手动输入时用当前阅读位置
      anchor: anchorCfi ?? progress?.cfi ?? null,
      percent: progress?.percent,
      text: noteText.trim(),
      createdAt: Date.now(),
    }
    await addBookNote(note)
    setNoteText('')
    setAnchorCfi(null)
    await refreshNotes()
  }

  // 点击批注列表项：跳到书内对应文字位置（CFI 精确锚定；同一条可重复点击）
  const jumpToNote = (n: BookNote) => {
    if (n.anchor) {
      setJumpCfi(n.anchor)
      setJumpTick((t) => t + 1)
    } else if (n.percent != null) {
      // 无锚点的旧批注：按百分比跳转（由阅读器滚动处理，先尝试设置进度）
      setJumpCfi(null)
      setJumpTick((t) => t + 1)
    }
  }

  const delNote = async (id: string) => {
    const target = notes.find((n) => n.id === id)
    await deleteBookNote(id)
    // 删除「高亮笔记」（空文本批注）→ 同时移除正文里的高亮标记
    if (target && !target.text && target.anchor) {
      setRemoveHl((prev) => ({ cfi: target.anchor!, tick: (prev?.tick ?? 0) + 1 }))
    }
    await refreshNotes()
  }

  // 磁盘扫描返回的扩展名不含点（如 pdf）；normExt 兼容带点形式
  const ext = normExt(entry.ext)
  const renderReader = () => {
    if (ext === 'epub')
      return (
        <EpubReader
          book={entry}
          progress={progress}
          onProgress={onProgress}
          fontSize={fontScale}
          theme={readerThemeProps}
          onAddNote={onAddNoteFromReader}
          jumpCfi={jumpCfi}
          jumpTick={jumpTick}
          highlightSignal={hlSignal}
          replayHighlights={replayHighlights}
          removeHighlight={removeHl}
          onHighlight={onHighlightFromReader}
        />
      )
    if (ext === 'pdf')
      return <PdfReader book={entry} progress={progress} onProgress={onProgress} fontSize={fontScale} />
    if (['txt', 'md', 'mdown', 'markdown'].includes(ext))
      return (
        <TextReader
          book={entry}
          progress={progress}
          onProgress={onProgress}
          fontSize={Math.round(15 * fontScale)}
          bg={readerThemeProps.bg}
          color={readerThemeProps.color}
          font={readerThemeProps.font}
        />
      )
    return <div className="reading-unsupported">暂不支持的格式：.{ext}</div>
  }

  return (
    <div className="reading-board">
      <div className="reading-bar">
        <button className="tb-btn" onClick={onClose} title="关闭此分栏">
          ← 返回
        </button>
        <span className="reading-title" title={entry.path}>
          {entry.name}
        </span>
        <span className="reading-pct">{Math.round(progress?.percent ?? 0)}%</span>
        <span className="tb-spacer" />
        <button className="tb-btn" onClick={cycleBg} title="阅读背景：默认 / 纸感 / 夜间">
          {READER_BG[readerTheme.bg].label}
        </button>
        <button
          className={'tb-btn' + (readerTheme.serif ? ' active' : '')}
          onClick={() => changeTheme({ serif: !readerTheme.serif })}
          title="衬线字体（适合长时间阅读）"
        >
          Aa 衬线
        </button>
        <button className="tb-btn" onClick={() => changeFont(Math.max(0.7, +(fontScale - 0.1).toFixed(1)))} title="减小字号（文本 / epub / pdf）">
          A−
        </button>
        <button className="tb-btn" onClick={() => changeFont(Math.min(2, +(fontScale + 0.1).toFixed(1)))} title="增大字号（文本 / epub / pdf）">
          A+
        </button>
        <button
          className="tb-btn"
          onClick={() => {
            setHlSignal((t) => t + 1)
          }}
          title="先选中正文文字，再点此按钮即可高亮（保存为高亮笔记）"
        >
          🖍 高亮
        </button>
        <button
          className={'tb-btn' + (notesOpen ? ' active' : '')}
          onClick={() => setNotesOpen((v) => !v)}
        >
          📝 批注 {notes.length}
        </button>
      </div>
      <div className="reading-body">
        <div className="reading-reader" ref={readerWrapRef}>{renderReader()}</div>
        {notesOpen && (
          <div className="reading-notes">
            <div className="notes-add">
              <textarea
                ref={noteInputRef}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={
                  anchorCfi
                    ? `在选中的文字处写批注…（Ctrl+Enter 提交）`
                    : `在 ${Math.round(progress?.percent ?? 0)}% 处写批注…（Ctrl+Enter 提交）`
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote()
                }}
              />
              <button className="tb-btn" onClick={addNote}>
                添加批注
              </button>
            </div>
            <div className="notes-list">
              {notes.length === 0 && (
                <div className="mat-empty">
                  还没有笔记。选中文字点「🖍 高亮」标亮，或在选中处写批注。
                </div>
              )}
              {(() => {
                const hlNotes = notes.filter((n) => !n.text)
                const noteItems = notes.filter((n) => n.text)
                return (
                  <>
                    {hlNotes.length > 0 && (
                      <div className="notes-group">
                        <div className="notes-group-title">🖍 高亮笔记（{hlNotes.length}）</div>
                        {hlNotes.map((n) => (
                          <div
                            key={n.id}
                            className="note-item hl-note"
                            onClick={() => jumpToNote(n)}
                            title="点击跳转到原文该高亮位置"
                          >
                            <div className="note-meta">
                              {n.percent != null ? `约 ${Math.round(n.percent)}%` : '高亮'} 📍
                            </div>
                            <div className="note-hl-line">高亮内容（删除此项即清除正文高亮）</div>
                            <span
                              className="note-del"
                              title="删除高亮（同时清除正文标记）"
                              onClick={(e) => {
                                e.stopPropagation()
                                delNote(n.id)
                              }}
                            >
                              ✕
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {noteItems.length > 0 && (
                      <div className="notes-group">
                        <div className="notes-group-title">💬 批注（{noteItems.length}）</div>
                        {noteItems.map((n) => (
                          <div
                            key={n.id}
                            className="note-item"
                            onClick={() => jumpToNote(n)}
                            title={n.anchor ? '点击跳转到原文该位置' : '点击跳转到原文该位置（约）'}
                          >
                            <div className="note-meta">
                              {n.chapter ||
                                (n.percent != null ? `约 ${Math.round(n.percent)}%` : '批注')}
                              {n.anchor ? ' 📍' : ''}
                            </div>
                            <div className="note-text">{n.text}</div>
                            <span
                              className="note-del"
                              title="删除"
                              onClick={(e) => {
                                e.stopPropagation()
                                delNote(n.id)
                              }}
                            >
                              ✕
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
