/**
 * 版本快照：纯前端存储（localStorage），避免改动 Rust 后端。
 * 每个文本笔记最多保留 MAX 条快照；恢复时把保存时的 TipTap content 写回编辑器。
 */
export interface SnapShot {
  id: string
  ts: number
  label: string
  content: unknown
}

const PREFIX = 'clnote-snaps:'
const MAX = 60

function keyOf(noteId: string): string {
  return PREFIX + noteId
}

export function listSnapshots(noteId: string): SnapShot[] {
  try {
    const raw = localStorage.getItem(keyOf(noteId))
    if (!raw) return []
    const arr = JSON.parse(raw) as SnapShot[]
    return Array.isArray(arr) ? arr.slice().sort((a, b) => b.ts - a.ts) : []
  } catch {
    return []
  }
}

export function saveSnapshot(noteId: string, content: unknown, label?: string): SnapShot {
  const list = listSnapshots(noteId)
  const snap: SnapShot = {
    id: 'snap-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    label: label || new Date().toLocaleString('zh-CN'),
    content,
  }
  list.unshift(snap)
  localStorage.setItem(keyOf(noteId), JSON.stringify(list.slice(0, MAX)))
  return snap
}

export function deleteSnapshot(noteId: string, id: string): void {
  const list = listSnapshots(noteId).filter((s) => s.id !== id)
  localStorage.setItem(keyOf(noteId), JSON.stringify(list))
}

/** NoteEditor 监听到此事件后，把快照内容写回编辑器并持久化 */
export const RESTORE_EVENT = 'clnote-restore-content'
export interface RestoreDetail {
  nodeId: string
  content: unknown
}
