import {
  Component,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { useStore, type PaneId } from '../store/useStore'
import NoteEditor from '../editor/NoteEditor'
import MindMap from '../mindmap/MindMap'
import Board from '../board/Board'
import Timeline from '../timeline/Timeline'
import Character from '../character/Character'
import Plot from '../plot/Plot'
import Setting from '../setting/Setting'
import MapView from '../map/Map'
import BacklinksPanel from './BacklinksPanel'
import SnapshotPanel from '../editor/SnapshotPanel'
import NotesView from './NotesView'
import MediaPaneView from '../media/MediaPaneView'

const TYPE_LABEL: Record<string, string> = {
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

const MEDIA_TYPE_LABEL: Record<string, string> = {
  book: '书籍',
  text: '文本',
  audio: '音乐',
  video: '视频',
  image: '图片',
}

/**
 * 面板级错误边界：单个面板（编辑器/导图/看板）渲染崩溃时，只在此面板内显示降级提示，
 * 不再让整棵 React 树卸载导致整个软件白屏。切换文件（nodeId 变化）后自动恢复重试。
 */
class PaneErrorBoundary extends Component<
  { nodeId: string; children: ReactNode },
  { err: Error | null }
> {
  state: { err: Error | null } = { err: null }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[PaneErrorBoundary] 面板渲染出错', err, info)
  }
  componentDidUpdate(prev: { nodeId: string }) {
    if (prev.nodeId !== this.props.nodeId && this.state.err) this.setState({ err: null })
  }
  render() {
    if (this.state.err) {
      return (
        <div className="pane-error">
          <div className="pane-error-title">⚠️ 此面板渲染出错</div>
          <pre className="pane-error-msg">{String(this.state.err.message || this.state.err)}</pre>
          <button className="tb-btn" onClick={() => this.setState({ err: null })}>
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function PaneView({ paneId, style }: { paneId: PaneId; style?: CSSProperties }) {
  const content = useStore((s) => s.panes[paneId])
  const activePane = useStore((s) => s.activePane)
  const setActivePane = useStore((s) => s.setActivePane)
  const closePane = useStore((s) => s.closePane)
  const node = useStore((s) =>
    content && content.kind === 'node' ? s.nodes.find((n) => n.id === content.id) : undefined,
  )
  const isActive = activePane === paneId

  const title =
    content?.kind === 'node'
      ? node?.name ?? '未打开文件'
      : content?.kind === 'media'
        ? content.slot.entry.name
        : content?.kind === 'notes'
          ? '笔记内容'
          : '未打开文件'
  const typeLabel =
    content?.kind === 'node'
      ? node
        ? TYPE_LABEL[node.type]
        : '文件'
      : content?.kind === 'media'
        ? MEDIA_TYPE_LABEL[content.slot.kind] ?? '媒体'
        : content?.kind === 'notes'
          ? '笔记'
          : '空'

  return (
    <div
      className={'pane' + (isActive ? ' active' : '')}
      style={style}
      onClick={() => setActivePane(paneId)}
    >
      <div className="pane-head">
        <span className="pane-type">{typeLabel}</span>
        <span className="pane-name" title={content?.kind === 'media' ? content.slot.entry.path : title}>
          {title}
        </span>
        <span className="tb-spacer" />
        {content && (
          <span
            className="pane-close"
            title="关闭此栏"
            onClick={(e) => {
              e.stopPropagation()
              closePane(paneId)
            }}
          >
            ✕
          </span>
        )}
      </div>
      <div className="pane-content">
        <PaneErrorBoundary nodeId={content?.kind === 'node' ? content.id : 'pane-' + paneId}>
        {!content ? (
          <div className="pane-empty">
            从左侧文件树 / 媒体库选择文件打开，或点 ＋ 新建。
            <br />
            开启分栏后可同时打开两个文件 / 思维导图 / 媒体（如一边看书一边看视频）。
          </div>
        ) : content.kind === 'node' && node ? (
          node.type === 'note' ? (
            <NoteEditor
              nodeId={node.id}
              paneId={paneId}
              isActive={isActive}
              onFocusPane={setActivePane}
            />
          ) : node.type === 'mindmap' ? (
            <MindMap
              nodeId={node.id}
              paneId={paneId}
              isActive={isActive}
              onFocusPane={setActivePane}
            />
          ) : node.type === 'board' ? (
            <Board
              nodeId={node.id}
              paneId={paneId}
              isActive={isActive}
              onFocusPane={setActivePane}
            />
          ) : node.type === 'timeline' ? (
            <Timeline
              nodeId={node.id}
              paneId={paneId}
              isActive={isActive}
              onFocusPane={setActivePane}
            />
          ) : node.type === 'character' ? (
            <Character
              nodeId={node.id}
              paneId={paneId}
              isActive={isActive}
              onFocusPane={setActivePane}
            />
          ) : node.type === 'plot' ? (
            <Plot
              nodeId={node.id}
              paneId={paneId}
              isActive={isActive}
              onFocusPane={setActivePane}
            />
          ) : node.type === 'setting' ? (
            <Setting
              nodeId={node.id}
              paneId={paneId}
              isActive={isActive}
              onFocusPane={setActivePane}
            />
          ) : node.type === 'map' ? (
            <MapView
              nodeId={node.id}
              paneId={paneId}
              isActive={isActive}
              onFocusPane={setActivePane}
            />
          ) : (
            <div className="pane-empty">文件夹不可直接打开。</div>
          )
        ) : content.kind === 'node' ? (
          <div className="pane-empty">文件不存在或已被删除。</div>
        ) : content.kind === 'media' ? (
          <MediaPaneView slot={content.slot} paneId={paneId} onClose={() => closePane(paneId)} />
        ) : (
          <NotesView onClose={() => closePane(paneId)} />
        )}
        </PaneErrorBoundary>
      </div>
    </div>
  )
}

export default function WorkArea() {
  const split = useStore((s) => s.split)
  const splitDir = useStore((s) => s.splitDir)
  const backlinksOpen = useStore((s) => s.backlinksOpen)
  const snapOpen = useStore((s) => s.snapOpen)
  // 分栏比例本地记忆：拖好的宽度/高度重启后保持
  const [ratio, setRatio] = useState(() => {
    try {
      const v = Number(localStorage.getItem('clnote-pane-ratio'))
      return v >= 0.15 && v <= 0.85 ? v : 0.5
    } catch {
      return 0.5
    }
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem('clnote-pane-ratio', String(ratio))
    } catch {
      /* 隐私模式等忽略 */
    }
  }, [ratio])

  // 分栏开关 / 方向变化 → 通知分栏内的阅读器（如 epub）按新尺寸重排
  useEffect(() => {
    window.dispatchEvent(new Event('clnote-pane-resized'))
  }, [split, splitDir])

  // 分栏中间的分隔条可拖拽调整两栏宽度/高度（与文件树 resizer 同款交互）。
  // 拖拽期间：加 .dragging 冻结内容交互 + rAF 节流更新比例，避免高频重渲染卡顿。
  const onDividerDown = (e: ReactMouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    containerRef.current?.classList.add('dragging')
    let raf = 0
    let lastEv: MouseEvent | null = null
    const apply = () => {
      raf = 0
      if (!draggingRef.current || !containerRef.current || !lastEv) return
      const rect = containerRef.current.getBoundingClientRect()
      // 左右分栏按 X，上下分栏按 Y
      const r =
        splitDir === 'v'
          ? (lastEv.clientY - rect.top) / rect.height
          : (lastEv.clientX - rect.left) / rect.width
      lastEv = null
      setRatio(Math.max(0.15, Math.min(0.85, r)))
    }
    const move = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      lastEv = ev
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const up = () => {
      draggingRef.current = false
      if (raf) cancelAnimationFrame(raf)
      containerRef.current?.classList.remove('dragging')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      // 通知分栏内的阅读器（如 epub）在拖拽结束后按新尺寸重排
      window.dispatchEvent(new Event('clnote-pane-resized'))
    }
    document.body.style.cursor = splitDir === 'v' ? 'row-resize' : 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      className={'work-area' + (split ? ' split' : '') + (split && splitDir === 'v' ? ' split-v' : '')}
      ref={containerRef}
    >
      <PaneView
        paneId="left"
        style={
          split
            ? splitDir === 'v'
              ? { flex: `0 0 ${ratio * 100}%`, minHeight: 0 }
              : { flex: `0 0 ${ratio * 100}%`, minWidth: 0 }
            : undefined
        }
      />
      {split && (
        <div
          className="pane-divider"
          onMouseDown={onDividerDown}
          title={splitDir === 'v' ? '拖拽调整分栏高度' : '拖拽调整分栏宽度'}
        />
      )}
      {split && <PaneView paneId="right" />}
      {backlinksOpen && <BacklinksPanel />}
      {snapOpen && <SnapshotPanel />}
    </div>
  )
}
