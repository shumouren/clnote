/**
 * 存储位置与数据备份
 * ---------------------------------------------------------------
 * 两种运行环境：
 *   浏览器  → 数据在 IndexedDB（ccc-notes-fs），位置由浏览器托管，不可指定；
 *             提供整库 JSON 备份 / 恢复作为迁移手段。
 *   Tauri   → 数据在磁盘目录，可自定义；通过 get_data_dir / set_data_dir 两个
 *             命令与 Rust 端交互（桌面包未编译时自动降级为只读提示）。
 */
import type { FsNode, Asset, AssetCategory, ShortcutItem } from '../model/types'
import type { Settings } from '../settings/settings'
import { persistSettings, applySettings } from '../settings/settings'
import { listNodes, clearAll, putMany } from './fs'
import {
  listAssets,
  listCategories,
  putManyAssets,
  putManyAssetCategories,
  clearAllAssets,
} from './assets'
import {
  listShortcuts,
  listShortcutCategories,
  putManyShortcuts,
  putManyShortcutCategories,
  clearAllShortcuts,
} from './shortcuts'

export type StorageKind = 'indexeddb' | 'tauri-fs'

export interface StorageInfo {
  kind: StorageKind
  /** 展示用的位置名称 */
  label: string
  /** 桌面端为绝对路径；浏览器端为数据库名 */
  path: string
  /** 是否支持修改位置 */
  changeable: boolean
  nodeCount: number
  folderCount: number
  noteCount: number
  mindmapCount: number
  /** 数据字节数（估算） */
  bytes: number
  /** 浏览器配额（仅浏览器环境有值） */
  quotaBytes?: number
}

/* ---------------- 环境探测 ---------------- */

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

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

/* ---------------- 位置信息 ---------------- */

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const nodes = await listNodes()
  const bytes = new Blob([JSON.stringify(nodes)]).size
  const base = {
    nodeCount: nodes.length,
    folderCount: nodes.filter((n) => n.type === 'folder').length,
    noteCount: nodes.filter((n) => n.type === 'note').length,
    mindmapCount: nodes.filter((n) => n.type === 'mindmap').length,
    bytes,
  }

  const invoke = getInvoke()
  if (isTauri() && invoke) {
    try {
      const dir = (await invoke('get_data_dir')) as string
      return {
        kind: 'tauri-fs',
        label: '本地磁盘目录',
        path: dir,
        changeable: true,
        ...base,
      }
    } catch {
      return {
        kind: 'tauri-fs',
        label: '本地磁盘目录（桌面端命令未就绪）',
        path: '—',
        changeable: false,
        ...base,
      }
    }
  }

  let quotaBytes: number | undefined
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      quotaBytes = est.quota
    }
  } catch {
    /* ignore */
  }

  return {
    kind: 'indexeddb',
    label: '浏览器本地数据库（IndexedDB）',
    path: 'clnote-fs',
    changeable: false,
    quotaBytes,
    ...base,
  }
}

/** 桌面端切换数据目录，返回实际生效的路径 */
export async function setDataDir(path: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('当前是浏览器环境，数据目录由浏览器托管，无法指定')
  const res = (await invoke('set_data_dir', { path })) as string
  return res
}

/** 请求浏览器持久化存储，避免数据被自动清理 */
export async function requestPersistent(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* ignore */
  }
  return false
}

export async function isPersisted(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted) return await navigator.storage.persisted()
  } catch {
    /* ignore */
  }
  return false
}

/* ---------------- 备份 / 恢复 ---------------- */

/**
 * 整库备份结构：覆盖全部本地数据（文件树 / 素材库 / 快捷库 及其分类），
 * 单文件、可读性高，作为「软件更换后数据依然完好」的兜底。
 * 由设置页以 .clnote 专属扩展名保存（本质仍是本 JSON，便于在设备间搬运），
 * app 字段同时兼容旧版 'ccc-notes'，保证早期备份也能恢复。
 */
export interface Backup {
  app: 'clnote-backup' | 'ccc-notes'
  version: number
  exportedAt: string
  nodes: FsNode[]
  assets?: Asset[]
  assetCategories?: AssetCategory[]
  shortcuts?: ShortcutItem[]
  shortcutCategories?: AssetCategory[]
  /** 应用设置（外观 / 编辑器 / 存储 / 导出 / 番茄钟…）。
   *  备份时一并写入，恢复时可选应用，方便把偏好随数据一起迁移。 */
  settings?: Settings
}

export async function buildBackup(settings: Settings): Promise<Backup> {
  const [nodes, assets, assetCategories, shortcuts, shortcutCategories] = await Promise.all([
    listNodes(),
    listAssets(),
    listCategories(),
    listShortcuts(),
    listShortcutCategories(),
  ])
  return {
    app: 'clnote-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    nodes,
    assets,
    assetCategories,
    shortcuts,
    shortcutCategories,
    settings,
  }
}

/** 收集一批对象里所有 id，用于检测冲突 */
function idSet<T extends { id: string }>(list: T[]): Set<string> {
  return new Set(list.map((x) => x.id))
}

/**
 * 合并恢复：把 incoming 里的每个对象按 id 冲突情况整体重映射，
 * 同时修正其内部引用（parentId / categoryId），避免覆盖已有内容或断链。
 */
async function mergeCollection<T extends { id: string }>(
  incoming: T[],
  existingIds: Set<string>,
  put: (list: T[]) => Promise<void>,
  remapRefs?: (item: T, remap: Map<string, string>) => T,
): Promise<number> {
  const remap = new Map<string, string>()
  for (const n of incoming) {
    if (existingIds.has(n.id)) {
      remap.set(n.id, `${n.id}-r${Math.random().toString(36).slice(2, 6)}`)
    }
  }
  const merged = incoming.map((n) => {
    const id = remap.get(n.id) ?? n.id
    const fixed = remapRefs ? remapRefs(n, remap) : n
    return { ...fixed, id }
  })
  if (merged.length) await put(merged)
  return merged.length
}

/**
 * 恢复备份
 * @param mode replace = 清空后导入；merge = 保留现有，冲突 id 自动重新编号
 * @param opts.restoreSettings 为 true 且备份内含设置时，一并恢复应用设置
 *        （外观 / 编辑器 / 存储 / 导出 / 番茄钟等偏好），方便随数据一起迁移。
 */
export async function restoreBackup(
  json: string,
  mode: 'replace' | 'merge',
  opts?: { restoreSettings?: boolean },
): Promise<number> {
  const data = JSON.parse(json) as Partial<Backup>
  if (!data || !Array.isArray(data.nodes)) throw new Error('备份文件格式不正确')

  const incomingNodes = (data.nodes ?? []) as FsNode[]
  const incomingAssets = (data.assets ?? []) as Asset[]
  const incomingAssetCats = (data.assetCategories ?? []) as AssetCategory[]
  const incomingShortcuts = (data.shortcuts ?? []) as ShortcutItem[]
  const incomingShortcutCats = (data.shortcutCategories ?? []) as AssetCategory[]

  if (mode === 'replace') {
    await clearAll()
    await clearAllAssets()
    await clearAllShortcuts()
    await putMany(incomingNodes)
    await putManyAssets(incomingAssets)
    await putManyAssetCategories(incomingAssetCats)
    await putManyShortcuts(incomingShortcuts)
    await putManyShortcutCategories(incomingShortcutCats)
    applyRestoredSettings(data, opts)
    return (
      incomingNodes.length +
      incomingAssets.length +
      incomingShortcuts.length
    )
  }

  // merge：各集合独立重映射，并跟随分类重映射修正 categoryId
  const existingNodes = await listNodes()
  const existingAssets = await listAssets()
  const existingShortcuts = await listShortcuts()
  const existingAssetCats = await listCategories()
  const existingShortcutCats = await listShortcutCategories()

  const nCats = await mergeCollection(
    incomingAssetCats,
    idSet(existingAssetCats),
    putManyAssetCategories,
  )
  const nSCats = await mergeCollection(
    incomingShortcutCats,
    idSet(existingShortcutCats),
    putManyShortcutCategories,
  )
  const catRemap = new Map<string, string>()
  // 把分类重映射结果收集起来，供素材/快捷修正 categoryId
  const collect = (incoming: AssetCategory[], existing: AssetCategory[]) => {
    const used = idSet(existing)
    for (const c of incoming) if (used.has(c.id)) catRemap.set(c.id, `${c.id}-r${Math.random().toString(36).slice(2, 6)}`)
  }
  collect(incomingAssetCats, existingAssetCats)
  collect(incomingShortcutCats, existingShortcutCats)

  const nAssets = await mergeCollection(
    incomingAssets,
    idSet(existingAssets),
    putManyAssets,
    (a) => ({
      ...a,
      categoryId: a.categoryId ? (catRemap.get(a.categoryId) ?? a.categoryId) : a.categoryId,
    }),
  )
  const nShortcuts = await mergeCollection(
    incomingShortcuts,
    idSet(existingShortcuts),
    putManyShortcuts,
    (s) => ({
      ...s,
      categoryId: s.categoryId ? (catRemap.get(s.categoryId) ?? s.categoryId) : s.categoryId,
    }),
  )

  const nNodes = await mergeCollection(
    incomingNodes,
    idSet(existingNodes),
    putMany,
    (n, remap) => ({
      ...n,
      parentId: n.parentId ? (remap.get(n.parentId) ?? n.parentId) : null,
    }),
  )

  void nCats
  void nSCats
  applyRestoredSettings(data, opts)
  return nNodes + nAssets + nShortcuts
}

/** 备份内含设置且用户选择恢复时，把设置写入 localStorage 并即时应用到界面 */
function applyRestoredSettings(
  data: Partial<Backup>,
  opts?: { restoreSettings?: boolean },
): void {
  if (!opts?.restoreSettings || !data.settings) return
  try {
    persistSettings(data.settings)
    applySettings(data.settings)
  } catch {
    /* 设置恢复失败不应影响数据恢复结果 */
  }
}
