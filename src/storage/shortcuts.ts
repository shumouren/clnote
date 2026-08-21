/**
 * 快捷库存储层
 * ---------------------------------------------------------------
 * - 桌面端（Tauri）：数据统一存于 Rust 端 clnote.db 的 shortcuts / shortcut_categories
 *   表（SQLite），换版本 / 重装也不丢。首次启动会把旧的 IndexedDB 数据一次性迁过来。
 * - 浏览器（dev）：回退到 IndexedDB（clnote-shortcuts），保证 `npm run dev` 仍可演示。
 *
 * 对外导出函数签名保持与历史调用方一致，内部按运行环境分流。
 */
import type { AssetCategory, ShortcutItem } from '../model/types'
import { openMigratingDB } from './idb'
import { tauriInvoke, type InvokeFn } from './tauriRuntime'

/* ============================================================
   Tauri / SQLite 后端
   ============================================================ */

const MIG_FLAG = 'shortcuts_migrated'
let migratePromise: Promise<void> | null = null

function normShortcut(s: ShortcutItem) {
  // Rust 端 ShortcutRow 以 camelCase 接收 order_idx（JSON 键 orderIdx）；
  // 运行时对象可能带 orderIdx（来自 DB）或 order（新建），统一规整为 orderIdx，
  // 并显式剔除 order，避免与 Rust 的 order_idx 字段冲突（serde 不允许同字段两个键）。
  const src = s as ShortcutItem & { orderIdx?: number }
  const { order, ...rest } = src
  return {
    ...rest,
    title: s.title ?? '',
    tags: s.tags ?? [],
    categoryId: s.categoryId ?? '',
    orderIdx: typeof src.orderIdx === 'number' ? src.orderIdx : (typeof order === 'number' ? order : (s.updatedAt ?? 0)),
    createdAt: s.createdAt ?? Date.now(),
    updatedAt: s.updatedAt ?? Date.now(),
  }
}

function normCat(c: AssetCategory) {
  const src = c as AssetCategory & { orderIdx?: number }
  const { order, ...rest } = src
  return {
    ...rest,
    kind: c.kind ?? 'theme',
    name: c.name ?? '',
    icon: c.icon ?? '',
    parentId: c.parentId ?? null,
    orderIdx: typeof src.orderIdx === 'number' ? src.orderIdx : (typeof order === 'number' ? order : 0),
  }
}

async function ensureMigrated(inv: InvokeFn): Promise<void> {
  if (!migratePromise) migratePromise = doMigrate(inv)
  return migratePromise
}

/** 一次性把旧的 IndexedDB 快捷数据迁到 SQLite（尽力而为，失败不阻断） */
async function doMigrate(inv: InvokeFn): Promise<void> {
  try {
    const done = await inv('get_meta', { key: MIG_FLAG })
    if (done) return
    const legacy = await readLegacyShortcuts()
    if (legacy.shortcuts.length || legacy.categories.length) {
      await inv('put_many_shortcut_categories', { list: legacy.categories.map(normCat) })
      await inv('put_many_shortcuts', { list: legacy.shortcuts.map(normShortcut) })
    }
    await inv('set_meta', { key: MIG_FLAG, value: '1' })
  } catch {
    // 迁移失败不影响使用，下次启动重试
  }
}

async function readLegacyShortcuts(): Promise<{ shortcuts: ShortcutItem[]; categories: AssetCategory[] }> {
  try {
    const db = await openMigratingDB({
      oldName: 'ccc-notes-shortcuts',
      newName: 'clnote-shortcuts',
      version: 1,
      stores: [
        { name: 'shortcuts', keyPath: 'id' },
        { name: 'scats', keyPath: 'id' },
      ],
    })
    const shortcuts = await new Promise<ShortcutItem[]>((res) => {
      const tx = db.transaction('shortcuts', 'readonly')
      const r = tx.objectStore('shortcuts').getAll()
      r.onsuccess = () => res((r.result as ShortcutItem[]) || [])
      r.onerror = () => res([])
    })
    const categories = await new Promise<AssetCategory[]>((res) => {
      const tx = db.transaction('scats', 'readonly')
      const r = tx.objectStore('scats').getAll()
      r.onsuccess = () => res((r.result as AssetCategory[]) || [])
      r.onerror = () => res([])
    })
    db.close()
    return { shortcuts, categories }
  } catch {
    return { shortcuts: [], categories: [] }
  }
}

async function taListShortcuts(inv: InvokeFn, categoryId?: string): Promise<ShortcutItem[]> {
  await ensureMigrated(inv)
  let list = (await inv('list_shortcuts')) as ShortcutItem[]
  if (categoryId !== undefined) {
    list = list.filter((a) => (a.categoryId ?? '') === categoryId)
  }
  list.sort((a, b) => (((a as ShortcutItem & { orderIdx?: number }).orderIdx ?? a.order ?? a.updatedAt) - ((b as ShortcutItem & { orderIdx?: number }).orderIdx ?? b.order ?? b.updatedAt)))
  return list
}

async function taGetShortcut(inv: InvokeFn, id: string): Promise<ShortcutItem | undefined> {
  await ensureMigrated(inv)
  return ((await inv('get_shortcut', { id })) as ShortcutItem | null) || undefined
}

async function taSaveShortcut(inv: InvokeFn, item: ShortcutItem): Promise<void> {
  await ensureMigrated(inv)
  await inv('save_shortcut', { item: { ...normShortcut(item), updatedAt: Date.now() } })
}

async function taDeleteShortcut(inv: InvokeFn, id: string): Promise<void> {
  await ensureMigrated(inv)
  await inv('delete_shortcut', { id })
}

async function taListCategories(inv: InvokeFn): Promise<AssetCategory[]> {
  await ensureMigrated(inv)
  const list = (await inv('list_shortcut_categories')) as AssetCategory[]
  return list.sort((a, b) => (((a as AssetCategory & { orderIdx?: number }).orderIdx ?? a.order ?? 0) - ((b as AssetCategory & { orderIdx?: number }).orderIdx ?? b.order ?? 0)))
}

async function taSaveCategory(inv: InvokeFn, cat: AssetCategory): Promise<void> {
  await ensureMigrated(inv)
  await inv('save_shortcut_category', { cat: normCat(cat) })
}

async function taDeleteCategory(inv: InvokeFn, id: string): Promise<void> {
  await ensureMigrated(inv)
  await inv('delete_shortcut_category', { id })
}

async function taPutManyShortcuts(inv: InvokeFn, list: ShortcutItem[]): Promise<void> {
  await ensureMigrated(inv)
  await inv('put_many_shortcuts', { list: list.map(normShortcut) })
}

async function taPutManyShortcutCategories(inv: InvokeFn, list: AssetCategory[]): Promise<void> {
  await ensureMigrated(inv)
  await inv('put_many_shortcut_categories', { list: list.map(normCat) })
}

async function taClearAllShortcuts(inv: InvokeFn): Promise<void> {
  await ensureMigrated(inv)
  await inv('clear_all_shortcuts')
}

/* ============================================================
   浏览器 / IndexedDB 回退（仅 dev 用，逻辑同历史实现）
   ============================================================ */

const DB_NAME = 'clnote-shortcuts'
const OLD_DB_NAME = 'ccc-notes-shortcuts'
const STORE = 'shortcuts'
const CATEGORY_STORE = 'scats'
const VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return openMigratingDB({
    oldName: OLD_DB_NAME,
    newName: DB_NAME,
    version: VERSION,
    stores: [
      { name: STORE, keyPath: 'id' },
      { name: CATEGORY_STORE, keyPath: 'id' },
    ],
  })
}

async function idbListShortcuts(categoryId?: string): Promise<ShortcutItem[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      let list = req.result as ShortcutItem[]
      if (categoryId !== undefined) {
        list = list.filter((a) => (a.categoryId ?? '') === categoryId)
      }
      list.sort((a, b) => (a.order ?? a.updatedAt) - (b.order ?? b.updatedAt))
      resolve(list)
    }
    req.onerror = () => reject(req.error)
  })
}

async function idbGetShortcut(id: string): Promise<ShortcutItem | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result as ShortcutItem | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSaveShortcut(item: ShortcutItem): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...item, updatedAt: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDeleteShortcut(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function collectDescendantCategoryIds(cats: AssetCategory[], rootId: string): Set<string> {
  const childrenOf = (id: string) => cats.filter((c) => (c.parentId ?? null) === id)
  const out = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    for (const c of childrenOf(id)) {
      if (!out.has(c.id)) {
        out.add(c.id)
        stack.push(c.id)
      }
    }
  }
  return out
}

async function idbListCategories(): Promise<AssetCategory[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATEGORY_STORE, 'readonly')
    const req = tx.objectStore(CATEGORY_STORE).getAll()
    req.onsuccess = () =>
      resolve((req.result as AssetCategory[]).sort((a, b) => a.order - b.order))
    req.onerror = () => reject(req.error)
  })
}

async function idbSaveCategory(cat: AssetCategory): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATEGORY_STORE, 'readwrite')
    tx.objectStore(CATEGORY_STORE).put(cat)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDeleteCategory(id: string): Promise<void> {
  const db = await openDB()
  const allCats = await new Promise<AssetCategory[]>((res, rej) => {
    const tx = db.transaction(CATEGORY_STORE, 'readonly')
    const r = tx.objectStore(CATEGORY_STORE).getAll()
    r.onsuccess = () => res(r.result as AssetCategory[])
    r.onerror = () => rej(r.error)
  })
  const ids = collectDescendantCategoryIds(allCats, id)
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, CATEGORY_STORE], 'readwrite')
    for (const cid of ids) tx.objectStore(CATEGORY_STORE).delete(cid)
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      for (const a of req.result as ShortcutItem[]) {
        if (ids.has(a.categoryId ?? '')) tx.objectStore(STORE).delete(a.id)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbPutManyShortcuts(list: ShortcutItem[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    for (const s of list) tx.objectStore(STORE).put(s)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbPutManyShortcutCategories(list: AssetCategory[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATEGORY_STORE, 'readwrite')
    for (const c of list) tx.objectStore(CATEGORY_STORE).put(c)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbClearAllShortcuts(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, CATEGORY_STORE], 'readwrite')
    tx.objectStore(STORE).clear()
    tx.objectStore(CATEGORY_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/* ============================================================
   对外导出：按运行环境分流
   ============================================================ */

export async function listShortcuts(categoryId?: string): Promise<ShortcutItem[]> {
  const inv = tauriInvoke()
  return inv ? taListShortcuts(inv, categoryId) : idbListShortcuts(categoryId)
}

export async function getShortcut(id: string): Promise<ShortcutItem | undefined> {
  const inv = tauriInvoke()
  return inv ? taGetShortcut(inv, id) : idbGetShortcut(id)
}

export async function saveShortcut(item: ShortcutItem): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taSaveShortcut(inv, item) : idbSaveShortcut(item)
}

export async function deleteShortcut(id: string): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taDeleteShortcut(inv, id) : idbDeleteShortcut(id)
}

export async function listShortcutCategories(): Promise<AssetCategory[]> {
  const inv = tauriInvoke()
  return inv ? taListCategories(inv) : idbListCategories()
}

export async function saveShortcutCategory(cat: AssetCategory): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taSaveCategory(inv, cat) : idbSaveCategory(cat)
}

export async function deleteShortcutCategory(id: string): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taDeleteCategory(inv, id) : idbDeleteCategory(id)
}

export async function putManyShortcuts(list: ShortcutItem[]): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taPutManyShortcuts(inv, list) : idbPutManyShortcuts(list)
}

export async function putManyShortcutCategories(list: AssetCategory[]): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taPutManyShortcutCategories(inv, list) : idbPutManyShortcutCategories(list)
}

export async function clearAllShortcuts(): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taClearAllShortcuts(inv) : idbClearAllShortcuts()
}
