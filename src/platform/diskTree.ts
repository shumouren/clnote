import type { DiskEntry } from '../model/types'

/** 跨平台取父目录（统一把反斜杠当分隔符） */
export function dirname(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i <= 0 ? '' : norm.slice(0, i)
}

/** 跨平台取文件名 */
export function basename(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i < 0 ? norm : norm.slice(i + 1)
}

export interface TreeNode {
  entry: DiskEntry
  children: TreeNode[]
}

/**
 * 由 scanFolder 返回的扁平列表（含各级目录与文件）构建成嵌套森林（根挂在挂载目录下）。
 * - dirs 排在 files 前；
 * 同级按中文名排序。
 */
export function buildForest(entries: DiskEntry[], rootPath: string): TreeNode[] {
  const normRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '')
  const byKey = new Map<string, TreeNode>()
  for (const e of entries) {
    byKey.set(e.path.replace(/\\/g, '/'), { entry: e, children: [] })
  }
  const roots: TreeNode[] = []
  for (const e of entries) {
    const key = e.path.replace(/\\/g, '/')
    const node = byKey.get(key)!
    const parent = dirname(key)
    if (parent === normRoot || !byKey.has(parent)) {
      roots.push(node)
    } else {
      byKey.get(parent)!.children.push(node)
    }
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.entry.isDir !== b.entry.isDir) return a.entry.isDir ? -1 : 1
      return a.entry.name.localeCompare(b.entry.name, 'zh')
    })
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)
  return roots
}
