/**
 * 树形文件系统存储层
 * ---------------------------------------------------------------
 * 每个节点独立存储（keyPath=id），通过 parentId 重建树。
 *
 * 运行环境：
 *   浏览器  → IndexedDB（ccc-notes-fs）作为真源。
 *   Tauri   → 调用 Rust 端命令（ccc-notes.db，SQLite，位于应用数据目录）。
 *             仅当探测到 Tauri 运行时才走 invoke，否则回退 IndexedDB，
 *             保证 `npm run dev` 在普通浏览器里依旧能完整演示。
 *
 * 模型与 Rust 端 FsNodeRow 对齐；Tauri 会自动做 camelCase↔snake_case 转换，
 * 但返回结果这里额外做了 snake/camel 兼容归一化，确保两种情况下都能拿到 FsNode。
 */
import type { FsNode, ForeshadowRow } from '../model/types'
import { newId } from '../model/types'
import { openMigratingDB } from './idb'

const DB_NAME = 'clnote-fs'
const OLD_DB_NAME = 'ccc-notes-fs'
const STORE = 'fs'
const VERSION = 1

/* ---------------- Tauri 探测（与 location.ts 同逻辑，避免循环依赖） ---------------- */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w
}

function getInvoke(): InvokeFn | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: InvokeFn }; invoke?: InvokeFn }
    __TAURI_INTERNALS__?: { invoke?: InvokeFn }
  }
  return (
    w.__TAURI__?.core?.invoke ??
    w.__TAURI__?.invoke ??
    w.__TAURI_INTERNALS__?.invoke ??
    null
  )
}

/** Tauri 可用时返回 invoke，否则 null（此时应回退 IndexedDB） */
function tauriInvoke(): InvokeFn | null {
  return isTauri() ? getInvoke() : null
}

/* ---------------- 返回归一化（兼容 snake_case / camelCase） ---------------- */

/**
 * 把存储的 content（JSON 字符串）解析回结构化值。
 * 桌面端经 Tauri 返回的是 JSON 字符串（"null" / "\"...\"" / 嵌套对象字符串）；
 * 浏览器端 IndexedDB 同样存字符串。已为对象时原样返回（兼容兜底）。
 */
function deserializeContent(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  }
  return v
}

/** 把任意 content 规整成 JSON 字符串，安全跨 Tauri 边界（避免直接传 null/对象被反序列化拒绝） */
function serializeContent(v: unknown): string {
  return JSON.stringify(v ?? null)
}

function normalizeNode(raw: Record<string, unknown>): FsNode {
  const content = deserializeContent(raw.content)
  return {
    id: String(raw.id),
    type: (raw.type ?? raw.nodeType ?? raw.node_type) as FsNode['type'],
    name: String(raw.name ?? ''),
    parentId: (raw.parentId ?? raw.parent_id ?? null) as string | null,
    content,
    text: (raw.text ?? '') as string,
    order: Number(raw.order ?? 0),
    updatedAt: Number(raw.updatedAt ?? raw.updated_at ?? 0),
    createdAt: Number(raw.createdAt ?? raw.created_at ?? 0),
    lib: ((raw.lib as string | undefined) ?? 'file') as 'file' | 'creation',
    kind: (raw.kind as string | undefined) ?? null,
    refId: (raw.refId as string | undefined) ?? (raw.ref_id as string | undefined) ?? null,
  }
}

/* ---------------- IndexedDB 实现（浏览器回退） ---------------- */

function openDB(): Promise<IDBDatabase> {
  return openMigratingDB({
    oldName: OLD_DB_NAME,
    newName: DB_NAME,
    version: VERSION,
    stores: [{ name: STORE, keyPath: 'id' }],
  })
}

/* ---------------- 对外 API（Tauri 优先，IndexedDB 回退） ---------------- */

export async function listNodes(): Promise<FsNode[]> {
  const invoke = tauriInvoke()
  if (invoke) {
    const rows = (await invoke('list_nodes')) as Record<string, unknown>[]
    return rows.map(normalizeNode)
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () =>
      resolve((req.result as Record<string, unknown>[]).map(normalizeNode))
    req.onerror = () => reject(req.error)
  })
}

export async function getNode(id: string): Promise<FsNode | undefined> {
  const invoke = tauriInvoke()
  if (invoke) {
    const row = (await invoke('get_node', { id })) as Record<string, unknown> | null
    return row ? normalizeNode(row) : undefined
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () =>
      resolve(req.result ? normalizeNode(req.result as Record<string, unknown>) : undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function saveNode(node: FsNode): Promise<void> {
  const invoke = tauriInvoke()
  // content 统一序列化为 JSON 字符串，跨 Tauri 边界更稳（字符串不会触发 serde_json::Value 对 null/对象的反序列化问题）
  const payload = { ...node, content: serializeContent(node.content) }
  if (invoke) {
    // 直接传 camelCase 的 FsNode，Tauri 会自动转成 snake_case 给 Rust
    await invoke('save_node', { node: payload })
    return
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(payload)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 删除节点及其全部后代（递归） */
export async function deleteNodeRecursive(id: string): Promise<void> {
  const invoke = tauriInvoke()
  if (invoke) {
    await invoke('delete_node', { id })
    return
  }
  const all = await listNodes()
  const toDelete = new Set<string>()
  const collect = (nid: string) => {
    toDelete.add(nid)
    all.filter((n) => n.parentId === nid).forEach((c) => collect(c.id))
  }
  collect(id)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    toDelete.forEach((nid) => store.delete(nid))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 把节点移动到新的父节点下，并放到 index 位置（同级重新排序） */
export async function moveNode(
  id: string,
  newParentId: string | null,
  index: number,
): Promise<void> {
  const invoke = tauriInvoke()
  if (invoke) {
    // 命令签名是 move_node(input: MoveInput)，Tauri v2 按参数名匹配，
    // 必须用参数名 `input` 包裹（与 save_node 用 `node` 包裹一致）。
    await invoke('move_node', { input: { id, newParentId, index } })
    return
  }
  const all = await listNodes()
  const node = all.find((n) => n.id === id)
  if (!node) return

  // 禁止把文件夹移动到它自己的后代里
  if (newParentId) {
    let p: string | null = newParentId
    while (p) {
      if (p === id) return // 非法移动，忽略
      p = all.find((n) => n.id === p)?.parentId ?? null
    }
  }

  const siblings = all
    .filter((n) => n.parentId === newParentId && n.id !== id)
    .sort((a, b) => a.order - b.order)

  const reordered = [...siblings]
  reordered.splice(index < 0 ? reordered.length : index, 0, {
    ...node,
    parentId: newParentId,
  })

  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    reordered.forEach((n, i) => {
      store.put({ ...n, parentId: newParentId, order: i })
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 清空全部节点（恢复备份时用） */
export async function clearAll(): Promise<void> {
  const invoke = tauriInvoke()
  if (invoke) {
    await invoke('clear_all')
    return
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 批量写入（恢复备份时用） */
export async function putMany(nodes: FsNode[]): Promise<void> {
  const invoke = tauriInvoke()
  const payload = nodes.map((n) => ({ ...n, content: serializeContent(n.content) }))
  if (invoke) {
    await invoke('put_many', { nodes: payload })
    return
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    payload.forEach((n) => store.put(n))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 取某父节点下的最大 order + 1 */
export async function nextOrder(parentId: string | null): Promise<number> {
  const invoke = tauriInvoke()
  if (invoke) {
    return (await invoke('next_order', { parentId })) as number
  }
  const all = await listNodes()
  const sibs = all.filter((n) => n.parentId === parentId)
  return sibs.length ? Math.max(...sibs.map((s) => s.order)) + 1 : 0
}

/* ---------------- 伏笔（标注） ---------------- */

const FS_KEY = 'clnote-foreshadows'

function localFores(): ForeshadowRow[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(FS_KEY) || '[]') as ForeshadowRow[]
  } catch {
    return []
  }
}
function saveLocalFores(list: ForeshadowRow[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(FS_KEY, JSON.stringify(list))
}

/**
 * 伏笔存储：优先走 Tauri 命令（SQLite）；若命令缺失 / invoke 失败（例如运行中的
 * 二进制尚未包含这些命令，或处在浏览器演示模式），则自动回退到 localStorage，
 * 保证「设为伏笔 / 伏笔栏」在任何环境下都可用，而不是整功能报错。
 */
function localList(novelId: string): ForeshadowRow[] {
  return localFores()
    .filter((f) => f.novelId === novelId)
    .sort((a, b) => a.orderIdx - b.orderIdx || a.createdAt - b.createdAt)
}

/** 列出某小说创作下的全部伏笔（聚合所有章） */
export async function listForeshadowings(novelId: string): Promise<ForeshadowRow[]> {
  const invoke = tauriInvoke()
  if (invoke) {
    try {
      return (await invoke('list_foreshadowings', { novelId })) as ForeshadowRow[]
    } catch (e) {
      console.warn('[listForeshadowings] invoke 失败，回退本地存储', e)
    }
  }
  return localList(novelId)
}

/** 新增 / 更新一条伏笔 */
export async function addForeshadow(row: ForeshadowRow): Promise<void> {
  const invoke = tauriInvoke()
  if (invoke) {
    try {
      await invoke('add_foreshadow', { f: row })
      return
    } catch (e) {
      console.warn('[addForeshadow] invoke 失败，回退本地存储', e)
    }
  }
  const list = localFores()
  const idx = list.findIndex((x) => x.id === row.id)
  if (idx >= 0) list[idx] = row
  else list.push(row)
  saveLocalFores(list)
}

/** 切换伏笔完成状态 */
export async function setForeshadowDone(id: string, done: number): Promise<void> {
  const invoke = tauriInvoke()
  if (invoke) {
    try {
      await invoke('set_foreshadow_done', { id, done })
      return
    } catch (e) {
      console.warn('[setForeshadowDone] invoke 失败，回退本地存储', e)
    }
  }
  saveLocalFores(localFores().map((x) => (x.id === id ? { ...x, done } : x)))
}

/** 删除一条伏笔 */
export async function deleteForeshadow(id: string): Promise<void> {
  const invoke = tauriInvoke()
  if (invoke) {
    try {
      await invoke('delete_foreshadow', { id })
      return
    } catch (e) {
      console.warn('[deleteForeshadow] invoke 失败，回退本地存储', e)
    }
  }
  saveLocalFores(localFores().filter((x) => x.id !== id))
}

export { newId }
