/**
 * v3 新库（阅读 / 音乐 / 视频）存储层
 * ---------------------------------------------------------------
 * 这些库浏览的是用户磁盘上的真实文件夹，与笔记 / 素材 / 快捷（SQLite 内部结构）不同，
 * 数据分两部分：
 *   1) 元数据（挂载路径、阅读进度、批注、播放进度）→ 存于 Rust 端 clnote.db
 *      （mounted_folders / book_progress / book_notes / media_progress 表），换版本不丢。
 *   2) 文件本体 → 留在用户磁盘；通过 scanFolder 浏览、readFileBytes / media 协议读取。
 *
 * 桌面端（Tauri）：直接 invoke 对应 Rust 命令。
 * 浏览器（dev，无磁盘访问能力）：用内存态兜底，保证 UI 不崩、可演示；扫描 / 读盘不可用。
 */
import type { BookNote, BookProgress, DiskEntry, LibKey, MediaProgress, MountedFolder } from '../model/types'
import { tauriInvoke } from './tauriRuntime'

/* ---- 浏览器回退用的内存态（仅 dev 演示，dev 下无真实磁盘访问） ---- */
const memMounted: MountedFolder[] = []
const memBookProgress = new Map<string, BookProgress>()
const memBookNotes: BookNote[] = []
const memMediaProgress = new Map<string, MediaProgress>()

/* ---- 磁盘扫描：递归浏览用户文件夹（全递归） ---- */
export async function scanFolder(
  path: string,
  recursive = true,
  extensions?: string[],
): Promise<DiskEntry[]> {
  const inv = tauriInvoke()
  if (inv) {
    return (await inv('scan_folder', { path, recursive, extensions })) as DiskEntry[]
  }
  return []
}

/* ---- 读取文件字节（阅读器 epub.js / pdf.js 加载用） ---- */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const inv = tauriInvoke()
  if (inv) {
    const arr = (await inv('read_file_bytes', { path })) as number[]
    return new Uint8Array(arr)
  }
  throw new Error('浏览器环境无法读取本地文件')
}

/* ---- 媒体源 URL ---- */

/**
 * 自定义 media 协议 URL：让 <audio>/<video> 直接播放用户磁盘上的媒体 / 书籍文件，
 * 无需把整文件读进 JS 内存（Windows 上形如 http://media.localhost/?path=...）。
 */
export function mediaProtocolUrl(absPath: string): string {
  return `http://media.localhost/?path=${encodeURIComponent(absPath)}`
}

/**
 * 生成一个可由 <audio>/<video> 播放的媒体源 URL。
 * 桌面端优先用 media 自定义协议；浏览器 dev 下无磁盘能力，直接抛错由调用方降级。
 */
export async function mediaUrl(absPath: string): Promise<string> {
  const inv = tauriInvoke()
  if (inv) return mediaProtocolUrl(absPath)
  throw new Error('浏览器环境无法播放本地媒体')
}

/* ---- 已挂载文件夹（阅读 / 音乐 / 视频库共用） ---- */
export async function listMountedFolders(lib: LibKey): Promise<MountedFolder[]> {
  const inv = tauriInvoke()
  if (inv) return (await inv('list_mounted_folders', { lib })) as MountedFolder[]
  return memMounted.filter((m) => m.lib === lib)
}

export async function addMountedFolder(folder: MountedFolder): Promise<void> {
  const inv = tauriInvoke()
  if (inv) {
    await inv('add_mounted_folder', { folder })
    return
  }
  memMounted.push(folder)
}

export async function removeMountedFolder(id: string): Promise<void> {
  const inv = tauriInvoke()
  if (inv) {
    await inv('remove_mounted_folder', { id })
    return
  }
  const i = memMounted.findIndex((m) => m.id === id)
  if (i >= 0) memMounted.splice(i, 1)
}

/** 重排某库下挂载文件夹的顺序（拖拽排序后持久化） */
export async function reorderMountedFolders(lib: LibKey, ids: string[]): Promise<void> {
  const inv = tauriInvoke()
  if (inv) {
    await inv('reorder_mounted_folders', { lib, ids })
    return
  }
  const order = new Map(ids.map((id, i) => [id, i]))
  memMounted.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

/* ---- 书籍阅读进度 ---- */
export async function getBookProgress(bookPath: string): Promise<BookProgress | null> {
  const inv = tauriInvoke()
  if (inv) return ((await inv('get_book_progress', { bookPath })) as BookProgress | null) || null
  return memBookProgress.get(bookPath) || null
}

export async function setBookProgress(p: BookProgress): Promise<void> {
  const inv = tauriInvoke()
  if (inv) {
    await inv('set_book_progress', { progress: p })
    return
  }
  memBookProgress.set(p.bookPath, p)
}

/* ---- 书籍批注 / 笔记（全局「所有笔记」面板的数据源） ---- */
export async function listBookNotes(bookPath: string): Promise<BookNote[]> {
  const inv = tauriInvoke()
  if (inv) return (await inv('list_book_notes', { bookPath })) as BookNote[]
  return memBookNotes.filter((n) => n.bookPath === bookPath)
}

export async function addBookNote(note: BookNote): Promise<void> {
  const inv = tauriInvoke()
  if (inv) {
    await inv('add_book_note', { note })
    return
  }
  memBookNotes.push(note)
}

export async function deleteBookNote(id: string): Promise<void> {
  const inv = tauriInvoke()
  if (inv) {
    await inv('delete_book_note', { id })
    return
  }
  const i = memBookNotes.findIndex((n) => n.id === id)
  if (i >= 0) memBookNotes.splice(i, 1)
}

/** 聚合所有书籍的批注 / 笔记（全局「所有笔记」面板用） */
export async function listAllBookNotes(): Promise<BookNote[]> {
  const inv = tauriInvoke()
  if (inv) return (await inv('list_all_book_notes', {})) as BookNote[]
  return [...memBookNotes].sort((a, b) => b.createdAt - a.createdAt)
}

/* ---- 媒体播放进度（记忆播放） ---- */
export async function getMediaProgress(mediaPath: string): Promise<MediaProgress | null> {
  const inv = tauriInvoke()
  if (inv) return ((await inv('get_media_progress', { mediaPath })) as MediaProgress | null) || null
  return memMediaProgress.get(mediaPath) || null
}

export async function setMediaProgress(p: MediaProgress): Promise<void> {
  const inv = tauriInvoke()
  if (inv) {
    await inv('set_media_progress', { progress: p })
    return
  }
  memMediaProgress.set(p.mediaPath, p)
}
