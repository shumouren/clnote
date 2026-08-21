import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  listMountedFolders,
  addMountedFolder,
  removeMountedFolder,
  reorderMountedFolders,
  scanFolder,
} from '../storage/media'
import { pickFolders } from '../platform/pickFolder'
import { basename, buildForest, type TreeNode } from '../platform/diskTree'
import { mediaKindOf, isAudioExt, isVideoExt, isSubExt, flattenAudio, collectMedia } from './mediaKind'
import type { DiskEntry, LibKey, MountedFolder } from '../model/types'
import { toast } from '../ui/toast'

/** 扩展名 → 图标（覆盖书 / 文本 / 音频 / 视频） */
const EXT_ICON: Record<string, string> = {
  epub: '📘',
  pdf: '📕',
  txt: '📄',
  md: '📝',
  mdown: '📝',
  markdown: '📝',
  mp3: '🎵',
  flac: '🎵',
  wav: '🎵',
  ogg: '🎵',
  oga: '🎵',
  m4a: '🎵',
  aac: '🎵',
  wma: '🎵',
  opus: '🎵',
  mid: '🎹',
  midi: '🎹',
  mp4: '🎬',
  mkv: '🎬',
  webm: '🎬',
  mov: '🎬',
  avi: '🎬',
  m4v: '🎬',
  flv: '🎬',
  wmv: '🎬',
  rmvb: '🎬',
  ogv: '🎬',
  vtt: '💬',
  srt: '💬',
  jpg: '🖼',
  jpeg: '🖼',
  png: '🖼',
  gif: '🖼',
  webp: '🖼',
  svg: '🖼',
  bmp: '🖼',
  ico: '🖼',
  avif: '🖼',
  tif: '🖼',
  tiff: '🖼',
}

/** 媒体库侧边栏：挂载本地文件夹、递归浏览全部文件（书 / 音乐 / 视频合一），按扩展名打开 */
export default function MediaLibrary() {
  const [folders, setFolders] = useState<MountedFolder[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [trees, setTrees] = useState<Record<string, TreeNode[]>>({})
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const openMedia = useStore((s) => s.openMedia)
  const openAudio = useStore((s) => s.openAudio)
  const openNotes = useStore((s) => s.openNotes)

  const refresh = () => listMountedFolders('media').then(setFolders)
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mount = async () => {
    const paths = await pickFolders()
    if (!paths.length) return
    try {
      for (const p of paths) {
        await addMountedFolder({
          id: 'mf_' + Math.random().toString(36).slice(2),
          lib: 'media' as LibKey,
          path: p,
          name: basename(p) || p,
          createdAt: Date.now(),
        })
      }
      await refresh()
      toast(`已挂载 ${paths.length} 个文件夹`)
    } catch (e) {
      console.error('[media] 挂载失败：', e)
      toast('挂载失败：' + (e instanceof Error ? e.message : String(e)))
      await refresh()
    }
  }

  const toggleFolder = async (f: MountedFolder) => {
    const next = !expanded[f.id]
    setExpanded((e) => ({ ...e, [f.id]: next }))
    if (next && !trees[f.id]) {
      setLoadingFolders((l) => ({ ...l, [f.id]: true }))
      try {
        // 不过滤扩展名：书 / 音乐 / 视频统一扫描，由前端按扩展名分派查看器
        const entries: DiskEntry[] = await scanFolder(f.path, true)
        setTrees((t) => ({ ...t, [f.id]: buildForest(entries, f.path) }))
      } finally {
        setLoadingFolders((l) => ({ ...l, [f.id]: false }))
      }
    }
  }

  const openEntry = (entry: DiskEntry, folderTree: TreeNode[]) => {
    const kind = mediaKindOf(entry.ext)
    if (kind === 'audio') {
      // 音频走常驻底部播放条，看书 / 看视频时音乐继续播
      openAudio(entry, flattenAudio(folderTree))
      return
    }
    if (kind === 'video') {
      const { videos, subs } = collectMedia(folderTree)
      openMedia(entry, { playlist: videos, subs })
      return
    }
    if (kind === 'image') {
      const { images } = collectMedia(folderTree)
      openMedia(entry, { playlist: images })
      return
    }
    // 书 / 文本
    openMedia(entry)
  }

  const onDropFolder = async (targetId: string) => {
    const id = dragId
    setDragId(null)
    setDropTarget(null)
    if (!id || id === targetId) return
    const ids = folders.map((f) => f.id)
    const from = ids.indexOf(id)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = [...ids]
    next.splice(to, 0, next.splice(from, 1)[0])
    setFolders((fs) => {
      const map = new Map(fs.map((f) => [f.id, f]))
      return next.map((i) => map.get(i)!).filter(Boolean)
    })
    await reorderMountedFolders('media', next)
  }

  return (
    <div className="reading-lib">
      <div className="reading-lib-head">
        <span className="reading-lib-title">🎞️ 媒体库</span>
        <button className="tb-btn" onClick={mount} title="选择本地文件夹（可多选）挂载到媒体库">
          ＋ 挂载
        </button>
      </div>
      <div className="reading-lib-hint">
        挂载本地文件夹，递归浏览书籍 / 音乐 / 视频，按扩展名自动分派查看器；可多分栏同时看。
      </div>

      {/* 「笔记内容」入口：放在媒体库的文件树位置，点开在编辑区（媒体分栏）展示全部书籍批注 */}
      <div
        className="tree-row notes-entry"
        style={{ paddingLeft: 6 }}
        onClick={(e) => {
          e.stopPropagation()
          openNotes()
        }}
        title="在编辑区查看全部书籍的批注 / 笔记（按书籍聚合），点击笔记可跳回原书"
      >
        <span className="tree-icon">📝</span>
        <span className="tree-name">笔记内容</span>
      </div>

      {folders.length === 0 && (
        <div className="mat-empty">还没有挂载文件夹，点上方「＋ 挂载」选择本地书籍 / 音乐 / 视频目录。</div>
      )}

      {folders.map((f) => (
        <div
          key={f.id}
          className={'mount-card' + (dropTarget === f.id ? ' drop' : '')}
          draggable
          onDragStart={(e) => {
            setDragId(f.id)
            e.dataTransfer.setData('text/plain', f.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDragId(null)
            setDropTarget(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(f.id)
          }}
          onDragLeave={() => setDropTarget((t) => (t === f.id ? null : t))}
          onDrop={(e) => {
            e.preventDefault()
            onDropFolder(f.id)
          }}
        >
          <div className="mount-card-head">
            <span className="mount-caret" onClick={() => toggleFolder(f)} title="展开 / 收起">
              {expanded[f.id] ? '▾' : '▸'}
            </span>
            <span className="mount-name" onClick={() => toggleFolder(f)} title={f.path}>
              📁 {f.name}
            </span>
            <span
              className="mount-del"
              title="移除挂载"
              onClick={async () => {
                await removeMountedFolder(f.id)
                await refresh()
              }}
            >
              ✕
            </span>
          </div>
          <div className="mount-path" onClick={() => toggleFolder(f)}>
            {f.path}
          </div>

          {expanded[f.id] && (
            <div className="mount-tree">
              {loadingFolders[f.id] && <div className="mat-empty">扫描中…</div>}
              {!loadingFolders[f.id] && trees[f.id]?.length === 0 && (
                <div className="mat-empty">该文件夹下没有可识别的媒体文件。</div>
              )}
              {!loadingFolders[f.id] &&
                trees[f.id]?.map((node) => (
                  <TreeView
                    key={node.entry.path}
                    node={node}
                    depth={0}
                    onOpen={(e) => openEntry(e, trees[f.id] ?? [])}
                  />
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** 递归渲染媒体文件树（目录可折叠，文件按种类可点击打开） */
function TreeView({
  node,
  depth,
  onOpen,
}: {
  node: TreeNode
  depth: number
  onOpen: (e: DiskEntry) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const { entry } = node
  if (entry.isDir) {
    return (
      <div>
        <div
          className="tree-row dir"
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="tree-caret">{open ? '▾' : '▸'}</span>
          <span className="tree-name">📂 {entry.name}</span>
        </div>
        {open && node.children.map((c) => <TreeView key={c.entry.path} node={c} depth={depth + 1} onOpen={onOpen} />)}
      </div>
    )
  }
  const ext = entry.ext.toLowerCase().replace(/^\./, '')
  const icon = EXT_ICON[ext] ?? '📄'
  const kind = mediaKindOf(entry.ext)
  const isSub = isSubExt(entry.ext)
  if (isSub) {
    return (
      <div className="tree-row file" style={{ paddingLeft: 6 + depth * 14 + 14 }} title={entry.path}>
        <span className="tree-ico">{icon}</span>
        <span className="tree-name tree-sub">{entry.name}</span>
      </div>
    )
  }
  const clickable =
    kind === 'audio' || kind === 'video' || kind === 'book' || kind === 'text' || kind === 'image'
  return (
    <div
      className={'tree-row file' + (clickable ? ' playable' : '')}
      style={{ paddingLeft: 6 + depth * 14 + 14 }}
      title={entry.path}
      onClick={() => clickable && onOpen(entry)}
    >
      <span className="tree-ico">{icon}</span>
      <span className="tree-name">{entry.name}</span>
      {!clickable && <span className="tree-warn">（不支持）</span>}
    </div>
  )
}
