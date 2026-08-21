/**
 * IndexedDB 打开 + 改名迁移小工具
 * ---------------------------------------------------------------
 * 软件从 cccnote 改名为 clnote 后，旧的数据库名（ccc-notes-*）会失效。
 * 这里在首次打开新库时，若新库为空且检测到同名旧库，自动把数据整体搬过来，
 * 保证「换了软件名字也不会丢数据」。
 *
 * 迁移是尽力而为的：任何一步失败都不会阻断新库的使用。
 */

export interface StoreSpec {
  name: string
  keyPath: string
}

export interface OpenOpts {
  /** 改名前的旧库名；传 null 表示不迁移 */
  oldName: string | null
  newName: string
  version: number
  stores: StoreSpec[]
  /** 版本升级时的额外建表/迁移逻辑（如旧字段兼容），可选 */
  onUpgrade?: (db: IDBDatabase, oldVersion: number) => void
}

function isStoreEmpty(db: IDBDatabase, store: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) return resolve(true)
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).count()
    req.onsuccess = () => resolve(req.result === 0)
    req.onerror = () => resolve(false)
  })
}

function readAll(oldDb: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve) => {
    if (!oldDb.objectStoreNames.contains(store)) return resolve([])
    const tx = oldDb.transaction(store, 'readonly')
    const req = tx.objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as unknown[])
    req.onerror = () => resolve([])
  })
}

function writeAll(db: IDBDatabase, store: string, items: unknown[]): Promise<void> {
  return new Promise((resolve) => {
    if (!items.length) return resolve()
    if (!db.objectStoreNames.contains(store)) return resolve()
    const tx = db.transaction(store, 'readwrite')
    for (const it of items) tx.objectStore(store).put(it as never)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

async function migrateFromOld(oldName: string, db: IDBDatabase, stores: StoreSpec[]): Promise<void> {
  try {
    const oldDb = await new Promise<IDBDatabase | null>((res) => {
      const req = indexedDB.open(oldName)
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
      req.onupgradeneeded = () => {
        // 不应该触发，但保险起见阻止自动建表占用
        req.result.close()
      }
    })
    if (!oldDb) return
    let copied = 0
    for (const s of stores) {
      const all = await readAll(oldDb, s.name)
      if (all.length) {
        await writeAll(db, s.name, all)
        copied += all.length
      }
    }
    oldDb.close()
    // 搬完后关闭旧库引用即可（保留旧文件不影响，用户可自行删除）
    void copied
  } catch {
    /* 迁移失败不影响新库 */
  }
}

export function openMigratingDB(opts: OpenOpts): Promise<IDBDatabase> {
  const { oldName, newName, version, stores, onUpgrade } = opts
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(newName, version)
    req.onupgradeneeded = (e) => {
      const db = req.result
      for (const s of stores) {
        if (!db.objectStoreNames.contains(s.name)) {
          db.createObjectStore(s.name, { keyPath: s.keyPath })
        }
      }
      try {
        onUpgrade?.(db, (e as IDBVersionChangeEvent).oldVersion)
      } catch {
        /* 忽略升级回调异常 */
      }
    }
    req.onsuccess = async () => {
      const db = req.result
      try {
        if (oldName && oldName !== newName) {
          // 仅当新库确实为空时才迁移，避免重复/覆盖现有数据
          const empty = (await Promise.all(stores.map((s) => isStoreEmpty(db, s.name)))).every(
            (x) => x,
          )
          if (empty) await migrateFromOld(oldName, db, stores)
        }
      } catch {
        /* 忽略 */
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}
