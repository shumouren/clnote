/**
 * 存储抽象层
 * ---------------------------------------------------------------
 * 当前用浏览器 IndexedDB 做临时真源（前端阶段即可完整演示）。
 *
 * 接 Tauri 时把下面四个函数替换为：
 *   import { invoke } from '@tauri-apps/api/core'
 *   listNotes  -> invoke('list_notes')
 *   getNote    -> invoke('get_note', { id })
 *   saveNote   -> invoke('save_note', { note })
 *   deleteNote -> invoke('delete_note', { id })
 * Rust 侧用 rusqlite + FTS5(+simple 中文/拼音分词) 实现，真源 = TipTap JSON，
 * 另落 text / pinyin / pinyin_initials 列进 FTS5 做检索。
 */

const DB_NAME = 'clnote-notes'
const STORE = 'notes'
const VERSION = 1

export interface StoredNote {
  id: string
  title: string
  content: unknown // TipTap JSON
  text: string // 纯文本，用于列表预览 / 将来 FTS5
  updatedAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function listNotes(): Promise<StoredNote[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () =>
      resolve(
        (req.result as StoredNote[]).sort((a, b) => b.updatedAt - a.updatedAt),
      )
    req.onerror = () => reject(req.error)
  })
}

export async function getNote(id: string): Promise<StoredNote | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result as StoredNote | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function saveNote(note: StoredNote): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(note)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteNote(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 生成 id（不依赖 uuid 库） */
export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  )
}
