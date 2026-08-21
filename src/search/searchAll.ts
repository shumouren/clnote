import type {
  Asset,
  BoardDoc,
  CharacterDoc,
  FsNode,
  MapDoc,
  MindMapDoc,
  MindNode,
  PlotDoc,
  SettingDoc,
  ShortcutItem,
  TaskCard,
  TimelineDoc,
  TimeNode,
} from '../model/types'
import { listAssets } from '../storage/assets'
import { listShortcuts } from '../storage/shortcuts'
import { useStore } from '../store/useStore'
import { tauriInvoke } from '../storage/tauriRuntime'

export interface SearchResult {
  id: string
  kind:
    | 'note'
    | 'mindmap'
    | 'board'
    | 'folder'
    | 'timeline'
    | 'character'
    | 'plot'
    | 'setting'
    | 'map'
    | 'asset'
    | 'shortcut'
  title: string
  snippet: string
  /** 文本 / 导图 / 看板 / 文件夹：对应的文件节点 id（用于点击打开） */
  nodeId?: string
  /** 素材：素材 id */
  assetId?: string
  /** 素材 / 快捷：所属分类 id（用于点击后在对应库定位） */
  categoryId?: string
  /** 快捷：快捷 id */
  shortcutId?: string
}

function snippetAround(hay: string, q: string, len = 90): string {
  const i = hay.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return hay.slice(0, len)
  const start = Math.max(0, i - 30)
  return (start > 0 ? '…' : '') + hay.slice(start, start + len) + (start + len < hay.length ? '…' : '')
}

function walkMind(n: MindNode, out: { text: string; note?: string }[]): void {
  out.push({ text: n.text, note: n.note })
  n.children.forEach((c) => walkMind(c, out))
}

function jsonContent<T>(c: unknown): T | null {
  if (!c) return null
  if (typeof c === 'string') {
    try {
      return JSON.parse(c) as T
    } catch {
      return null
    }
  }
  return c as T
}

/** 把任意节点类型抽取为可搜索纯文本：标题 + 正文缓存 + 各类型 content 内的关键字段。
 *  这样【创作库】的角色/剧情/设定/地图/时间线等内容也能被全文检索到。 */
function extractSearchText(n: FsNode): string {
  const parts: string[] = [n.name ?? '', n.text ?? '']
  const c = n.content
  switch (n.type) {
    case 'mindmap': {
      const doc = jsonContent<MindMapDoc>(c)
      if (doc) {
        const items: { text: string; note?: string }[] = []
        walkMind(doc.root, items)
        parts.push(items.map((it) => it.text + ' ' + (it.note ?? '')).join(' '))
      }
      break
    }
    case 'board': {
      const doc = jsonContent<BoardDoc>(c)
      if (doc) parts.push((doc.tasks as TaskCard[]).map((t) => t.title + ' ' + (t.note ?? '')).join(' '))
      break
    }
    case 'timeline': {
      const doc = jsonContent<TimelineDoc>(c)
      if (doc) {
        const texts: string[] = []
        const walk = (tn: TimeNode) => {
          texts.push(tn.text + ' ' + (tn.note ?? ''))
          tn.children.forEach(walk)
        }
        doc.roots.forEach(walk)
        parts.push(texts.join(' '))
      }
      break
    }
    case 'character': {
      const doc = jsonContent<CharacterDoc>(c)
      if (doc) {
        const blocks = doc.items.map((ch) => {
          const attrs = ch.attrs.map((a) => a.name + '：' + a.value).join(' ')
          const tags = (ch.tags ?? []).join(' ')
          return [ch.name, tags, attrs, ch.bio].join(' ')
        })
        parts.push(blocks.join(' '))
        parts.push((doc.tagPool ?? []).join(' '))
      }
      break
    }
    case 'plot': {
      const doc = jsonContent<PlotDoc>(c)
      if (doc) parts.push(doc.items.map((it) => it.title + ' ' + it.summary).join(' '))
      break
    }
    case 'setting': {
      const doc = jsonContent<SettingDoc>(c)
      if (doc) {
        parts.push((doc.categories ?? []).join(' '))
        parts.push(doc.entries.map((e) => e.name + ' ' + e.category + ' ' + e.desc).join(' '))
      }
      break
    }
    case 'map': {
      const doc = jsonContent<MapDoc>(c)
      if (doc) {
        const locs = doc.floors.flatMap((f) => f.locations.map((l) => l.name + ' ' + l.desc))
        const edges = doc.floors.flatMap((f) => f.edges.map((e) => e.label ?? '').filter(Boolean))
        const links = (doc.links ?? []).map((l) => l.label ?? '').filter(Boolean)
        parts.push([...locs, ...edges, ...links].join(' '))
      }
      break
    }
  }
  return parts.join('\n')
}

function kindPrefix(t: string): string {
  switch (t) {
    case 'folder': return 'f_'
    case 'note': return 'n_'
    case 'mindmap': return 'm_'
    case 'board': return 'b_'
    case 'timeline': return 'tl_'
    case 'character': return 'ch_'
    case 'plot': return 'pl_'
    case 'setting': return 'st_'
    case 'map': return 'mp_'
    default: return 'x_'
  }
}

function defaultTitle(t: string): string {
  switch (t) {
    case 'folder': return '未命名文件夹'
    case 'note': return '未命名笔记'
    case 'mindmap': return '思维导图'
    case 'board': return '看板'
    case 'timeline': return '时间线'
    case 'character': return '角色'
    case 'plot': return '剧情'
    case 'setting': return '设定'
    case 'map': return '地图'
    default: return '节点'
  }
}

/** 聚合搜索全部内容：文本笔记、思维导图、看板、素材库。
 *  - 桌面端（Tauri）：笔记走后端 FTS（已支持中文按词检索，且覆盖全部已落库笔记）；
 *  - 浏览器端：全部走前端 substring（不依赖后端 search_nodes）。 */
export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const results: SearchResult[] = []
  const nodes = useStore.getState().nodes
  const invoke = tauriInvoke()

  // 桌面端：优先用后端 FTS 检索笔记（中文按词、覆盖全部已落库笔记）
  let backendNotes: { id: string; name: string }[] | null = null
  if (invoke) {
    try {
      const rows = (await invoke('search_nodes', { q: query.trim() })) as {
        id: string
        name: string
        updated_at: number
      }[]
      backendNotes = rows
    } catch {
      backendNotes = null
    }
  }

  if (backendNotes) {
    const nodeById = new Map((nodes as FsNode[]).map((n) => [n.id, n]))
    for (const r of backendNotes) {
      const n = nodeById.get(r.id)
      // 仅把笔记交给后端结果；思维导图/看板的 JSON 正文不进 FTS，仍由前端检索
      if (n && n.type !== 'note') continue
      const text = (n?.name ?? '') + '\n' + (n?.text ?? '')
      results.push({
        id: 'n_' + r.id,
        kind: 'note',
        title: r.name || n?.name || '未命名笔记',
        snippet: snippetAround(text, q),
        nodeId: r.id,
      })
    }
  }

  for (const n of nodes as FsNode[]) {
    // 笔记在桌面端已由后端 FTS（中文按词）覆盖，避免重复；浏览器端则走下方前端检索
    if (n.type === 'note' && backendNotes) continue
    const full = extractSearchText(n)
    if (!full.toLowerCase().includes(q)) continue
    results.push({
      id: kindPrefix(n.type) + n.id,
      kind: n.type,
      title: n.name || defaultTitle(n.type),
      snippet: snippetAround(full, q),
      nodeId: n.id,
    })
  }

  // 素材库（独立 IndexedDB）
  try {
    const assets = await listAssets()
    for (const a of assets as Asset[]) {
      const hay = [a.title, a.content, a.url, a.author, a.fileName, ...a.tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (hay.includes(q)) {
        results.push({
          id: 'a_' + a.id,
          kind: 'asset',
          title: a.title || '素材',
          snippet: snippetAround(
            (a.type === 'image' ? a.title : a.type === 'file' ? a.fileName || a.content : a.content || a.url || '') ?? '',
            q,
          ),
          assetId: a.id,
          categoryId: a.categoryId || '__all__',
        })
      }
    }
  } catch {
    /* 素材库不可用时忽略 */
  }

  // 快捷库（独立 IndexedDB）
  try {
    const shortcuts = await listShortcuts()
    for (const sc of shortcuts as ShortcutItem[]) {
      const hay = [sc.title, sc.path, sc.url, sc.content, ...sc.tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (hay.includes(q)) {
        results.push({
          id: 's_' + sc.id,
          kind: 'shortcut',
          title: sc.title || '快捷',
          snippet: snippetAround(
            (sc.kind === 'folder' ? sc.path : sc.kind === 'link' ? sc.url : sc.content || '') ?? '',
            q,
          ),
          shortcutId: sc.id,
          categoryId: sc.categoryId || '__all__',
        })
      }
    }
  } catch {
    /* 快捷库不可用时忽略 */
  }

  return results
}
