/**
 * 素材库存储层
 * ---------------------------------------------------------------
 * - 桌面端（Tauri）：数据统一存于 Rust 端 clnote.db 的 assets / asset_categories
 *   表（SQLite），换版本 / 重装也不丢。首次启动会把旧的 IndexedDB 数据一次性迁过来。
 * - 浏览器（dev）：回退到 IndexedDB（clnote-assets），保证 `npm run dev` 仍可演示。
 *
 * 对外导出函数的签名保持与历史调用方一致，内部按运行环境分流。
 */
import type { Asset, AssetCategory } from '../model/types'
import { openMigratingDB } from './idb'
import { tauriInvoke, type InvokeFn } from './tauriRuntime'

/* ============================================================
   Tauri / SQLite 后端
   ============================================================ */

const MIG_FLAG = 'assets_migrated'
let migratePromise: Promise<void> | null = null

/** 把 Asset 规整为 Rust 端期望的完整字段（补全可能为 undefined 的必填项） */
function normAsset(a: Asset) {
  // 同 normShortcut：统一发 orderIdx，剔除 order，避免触发 Rust AssetRow.order_idx 的重复/缺失判定。
  const src = a as Asset & { orderIdx?: number }
  const { order, ...rest } = src
  return {
    ...rest,
    title: a.title ?? '',
    content: a.content ?? '',
    tags: a.tags ?? [],
    typeId: a.typeId ?? '',
    categoryId: a.categoryId ?? '',
    orderIdx: typeof src.orderIdx === 'number' ? src.orderIdx : (typeof order === 'number' ? order : (a.updatedAt ?? 0)),
    createdAt: a.createdAt ?? Date.now(),
    updatedAt: a.updatedAt ?? Date.now(),
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
    builtin: !!c.builtin,
  }
}

async function ensureMigrated(inv: InvokeFn): Promise<void> {
  if (!migratePromise) migratePromise = doMigrate(inv)
  return migratePromise
}

/** 一次性把旧的 IndexedDB 素材数据迁到 SQLite（尽力而为，失败不阻断） */
async function doMigrate(inv: InvokeFn): Promise<void> {
  try {
    const done = await inv('get_meta', { key: MIG_FLAG })
    if (done) return
    const legacy = await readLegacyAssets()
    if (legacy.assets.length || legacy.categories.length) {
      await inv('put_many_asset_categories', { list: legacy.categories.map(normCat) })
      await inv('put_many_assets', { list: legacy.assets.map(normAsset) })
    }
    await inv('set_meta', { key: MIG_FLAG, value: '1' })
  } catch {
    // 迁移失败不影响使用，下次启动重试
  }
}

/** 读取旧 IndexedDB（clnote-assets）中的素材与分类，用于迁移 */
async function readLegacyAssets(): Promise<{ assets: Asset[]; categories: AssetCategory[] }> {
  try {
    const db = await openMigratingDB({
      oldName: 'ccc-notes-assets',
      newName: 'clnote-assets',
      version: 3,
      stores: [
        { name: 'assets', keyPath: 'id' },
        { name: 'themes', keyPath: 'id' },
      ],
      onUpgrade: (db, oldV) => {
        if (oldV < 3) {
          const tx = db.transaction(['assets', 'themes'], 'readwrite')
          if (db.objectStoreNames.contains('assets')) {
            const cur = tx.objectStore('assets').openCursor()
            cur.onsuccess = () => {
              const c = cur.result
              if (c) {
                const a = c.value as Asset & { themeId?: string }
                if (a.categoryId === undefined && a.themeId !== undefined) a.categoryId = a.themeId
                if ((a as { typeId?: string }).typeId === undefined) (a as { typeId: string }).typeId = ''
                c.update(a)
                c.continue()
              }
            }
          }
          if (db.objectStoreNames.contains('themes')) {
            const cur = tx.objectStore('themes').openCursor()
            cur.onsuccess = () => {
              const c = cur.result
              if (c) {
                const t = c.value as AssetCategory & { kind?: string }
                if (t.kind === undefined) {
                  t.kind = 'theme'
                  t.parentId = null
                }
                c.update(t)
                c.continue()
              }
            }
          }
        }
      },
    })
    const assets = await new Promise<Asset[]>((res) => {
      const tx = db.transaction('assets', 'readonly')
      const r = tx.objectStore('assets').getAll()
      r.onsuccess = () => res((r.result as Asset[]) || [])
      r.onerror = () => res([])
    })
    const categories = await new Promise<AssetCategory[]>((res) => {
      const tx = db.transaction('themes', 'readonly')
      const r = tx.objectStore('themes').getAll()
      r.onsuccess = () => res((r.result as AssetCategory[]) || [])
      r.onerror = () => res([])
    })
    db.close()
    return { assets, categories }
  } catch {
    return { assets: [], categories: [] }
  }
}

async function taListAssets(inv: InvokeFn, categoryId?: string): Promise<Asset[]> {
  await ensureMigrated(inv)
  let list = (await inv('list_assets')) as Asset[]
  if (categoryId !== undefined) {
    list = list.filter((a) => (a.categoryId ?? '') === categoryId)
  }
  list.sort((a, b) => (((a as Asset & { orderIdx?: number }).orderIdx ?? a.order ?? a.updatedAt) - ((b as Asset & { orderIdx?: number }).orderIdx ?? b.order ?? b.updatedAt)))
  return list
}

async function taGetAsset(inv: InvokeFn, id: string): Promise<Asset | undefined> {
  await ensureMigrated(inv)
  return ((await inv('get_asset', { id })) as Asset | null) || undefined
}

async function taSaveAsset(inv: InvokeFn, asset: Asset): Promise<void> {
  await ensureMigrated(inv)
  await inv('save_asset', { asset: { ...normAsset(asset), updatedAt: Date.now() } })
}

async function taDeleteAsset(inv: InvokeFn, id: string): Promise<void> {
  await ensureMigrated(inv)
  await inv('delete_asset', { id })
}

async function taListCategories(inv: InvokeFn): Promise<AssetCategory[]> {
  await ensureMigrated(inv)
  const list = (await inv('list_asset_categories')) as AssetCategory[]
  return list.sort((a, b) => (((a as AssetCategory & { orderIdx?: number }).orderIdx ?? a.order ?? 0) - ((b as AssetCategory & { orderIdx?: number }).orderIdx ?? b.order ?? 0)))
}

async function taSaveCategory(inv: InvokeFn, cat: AssetCategory): Promise<void> {
  await ensureMigrated(inv)
  await inv('save_asset_category', { cat: normCat(cat) })
}

async function taDeleteCategory(inv: InvokeFn, id: string): Promise<void> {
  await ensureMigrated(inv)
  await inv('delete_asset_category', { id })
}

async function taPutManyAssets(inv: InvokeFn, list: Asset[]): Promise<void> {
  await ensureMigrated(inv)
  await inv('put_many_assets', { list: list.map(normAsset) })
}

async function taPutManyAssetCategories(inv: InvokeFn, list: AssetCategory[]): Promise<void> {
  await ensureMigrated(inv)
  await inv('put_many_asset_categories', { list: list.map(normCat) })
}

async function taClearAllAssets(inv: InvokeFn): Promise<void> {
  await ensureMigrated(inv)
  await inv('clear_all_assets')
}

/* ============================================================
   浏览器 / IndexedDB 回退（仅 dev 用，逻辑同历史实现）
   ============================================================ */

const DB_NAME = 'clnote-assets'
const OLD_DB_NAME = 'ccc-notes-assets'
const STORE = 'assets'
const CATEGORY_STORE = 'themes'
const VERSION = 3

function openDB(): Promise<IDBDatabase> {
  return openMigratingDB({
    oldName: OLD_DB_NAME,
    newName: DB_NAME,
    version: VERSION,
    stores: [
      { name: STORE, keyPath: 'id' },
      { name: CATEGORY_STORE, keyPath: 'id' },
    ],
    onUpgrade: (db, oldV) => {
      if (oldV < 3) {
        const tx = db.transaction([STORE, CATEGORY_STORE], 'readwrite')
        if (db.objectStoreNames.contains(STORE)) {
          const cur = tx.objectStore(STORE).openCursor()
          cur.onsuccess = () => {
            const c = cur.result
            if (c) {
              const a = c.value as Asset & { themeId?: string }
              if (a.categoryId === undefined && a.themeId !== undefined) a.categoryId = a.themeId
              if ((a as { typeId?: string }).typeId === undefined) (a as { typeId: string }).typeId = ''
              c.update(a)
              c.continue()
            }
          }
        }
        if (db.objectStoreNames.contains(CATEGORY_STORE)) {
          const cur = tx.objectStore(CATEGORY_STORE).openCursor()
          cur.onsuccess = () => {
            const c = cur.result
            if (c) {
              const t = c.value as AssetCategory & { kind?: string }
              if (t.kind === undefined) {
                t.kind = 'theme'
                t.parentId = null
              }
              c.update(t)
              c.continue()
            }
          }
        }
      }
    },
  })
}

async function idbListAssets(categoryId?: string): Promise<Asset[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      let list = req.result as Asset[]
      if (categoryId !== undefined) {
        list = list.filter((a) => (a.categoryId ?? '') === categoryId)
      }
      list.sort((a, b) => (a.order ?? a.updatedAt) - (b.order ?? b.updatedAt))
      resolve(list)
    }
    req.onerror = () => reject(req.error)
  })
}

async function idbGetAsset(id: string): Promise<Asset | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result as Asset | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSaveAsset(asset: Asset): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...asset, updatedAt: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDeleteAsset(id: string): Promise<void> {
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
      for (const a of req.result as Asset[]) {
        if (ids.has(a.categoryId ?? '')) tx.objectStore(STORE).delete(a.id)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbPutManyAssets(list: Asset[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    for (const a of list) tx.objectStore(STORE).put(a)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbPutManyAssetCategories(list: AssetCategory[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATEGORY_STORE, 'readwrite')
    for (const c of list) tx.objectStore(CATEGORY_STORE).put(c)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbClearAllAssets(): Promise<void> {
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

export async function listAssets(categoryId?: string): Promise<Asset[]> {
  const inv = tauriInvoke()
  return inv ? taListAssets(inv, categoryId) : idbListAssets(categoryId)
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  const inv = tauriInvoke()
  return inv ? taGetAsset(inv, id) : idbGetAsset(id)
}

export async function saveAsset(asset: Asset): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taSaveAsset(inv, asset) : idbSaveAsset(asset)
}

export async function deleteAsset(id: string): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taDeleteAsset(inv, id) : idbDeleteAsset(id)
}

export async function listCategories(): Promise<AssetCategory[]> {
  const inv = tauriInvoke()
  return inv ? taListCategories(inv) : idbListCategories()
}

export async function saveCategory(cat: AssetCategory): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taSaveCategory(inv, cat) : idbSaveCategory(cat)
}

export async function deleteCategory(id: string): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taDeleteCategory(inv, id) : idbDeleteCategory(id)
}

export async function putManyAssets(list: Asset[]): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taPutManyAssets(inv, list) : idbPutManyAssets(list)
}

export async function putManyAssetCategories(list: AssetCategory[]): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taPutManyAssetCategories(inv, list) : idbPutManyAssetCategories(list)
}

export async function clearAllAssets(): Promise<void> {
  const inv = tauriInvoke()
  return inv ? taClearAllAssets(inv) : idbClearAllAssets()
}
