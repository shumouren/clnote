import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { searchAll, type SearchResult } from './searchAll'

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  note: '文本',
  mindmap: '导图',
  board: '看板',
  timeline: '时间线',
  character: '角色',
  plot: '剧情',
  setting: '设定',
  map: '地图',
  asset: '素材',
  shortcut: '快捷',
  folder: '文件夹',
}
const KIND_ORDER: SearchResult['kind'][] = [
  'note',
  'mindmap',
  'board',
  'timeline',
  'character',
  'plot',
  'setting',
  'map',
  'asset',
  'shortcut',
  'folder',
]

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const re = new RegExp(`(${escapeReg(q)})`, 'ig')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === q.toLowerCase() ? (
          <mark key={i}>{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export default function SearchPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const openNode = useStore((s) => s.openNode)
  const setActiveCategory = useStore((s) => s.setActiveCategory)
  const setActiveShortcutCategory = useStore((s) => s.setActiveShortcutCategory)
  const setSideTab = useStore((s) => s.setSideTab)
  const setSelected = useStore((s) => s.setSelected)
  const revealNode = useStore((s) => s.revealNode)
  const setFocusAsset = useStore((s) => s.setFocusAsset)
  const setFocusShortcut = useStore((s) => s.setFocusShortcut)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let alive = true
    if (!query.trim()) {
      setResults([])
      return
    }
    const t = window.setTimeout(async () => {
      const r = await searchAll(query)
      if (alive) {
        setResults(r)
        setActive(0)
      }
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [query])

  const open = (r: SearchResult) => {
    if (r.nodeId) {
      // 按命中节点的实际所属库切换左侧文件树（文件库 / 创作库），
      // 否则会出现"编辑栏跳到创作库、但左侧还停在文件库"的错位。
      const node = useStore.getState().nodes.find((n) => n.id === r.nodeId)
      const tab = (node?.lib ?? 'file') === 'creation' ? 'creation' : 'tree'
      if (r.kind === 'folder') {
        // 文件夹：切到对应库文件树并选中、展开它在树中的位置
        setSideTab(tab)
        setSelected(r.nodeId)
        revealNode(r.nodeId)
      } else {
        // 文本/导图/看板等：必须切到对应文件树，否则编辑栏已跳库但左侧还停在另一库
        setSideTab(tab)
        openNode(r.nodeId)
      }
    } else if (r.assetId) {
      // 素材：切到素材库并定位到该素材（自动打开编辑，即"跳进文件"）
      setSideTab('material')
      setActiveCategory(r.categoryId ?? '__all__')
      setFocusAsset(r.assetId)
    } else if (r.shortcutId) {
      // 快捷：切到快捷库并打开 / 定位到该快捷
      setSideTab('shortcut')
      setActiveShortcutCategory(r.categoryId ?? '__all__')
      setFocusShortcut(r.shortcutId)
    }
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[active]) open(results[active])
    }
  }

  const groups = useMemo(() => {
    const g: Record<string, SearchResult[]> = {}
    for (const r of results) (g[r.kind] ||= []).push(r)
    return KIND_ORDER.filter((k) => g[k]?.length).map((k) => [k, g[k]] as const)
  }, [results])

  return (
    <div className="search-mask" onClick={onClose}>
      <div
        className="search-box"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <input
          ref={inputRef}
          className="search-input"
          placeholder="搜索全部内容：文本、导图、看板、素材库、快捷、文件夹…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="search-stat">
          {query.trim() ? `找到 ${results.length} 条结果（↑↓ 选择，Enter 打开，Esc 关闭）` : '输入关键词开始搜索'}
        </div>
        <div className="search-results">
          {!query.trim() && (
            <div className="search-empty">
              支持一次搜索所有内容（文本 / 思维导图 / 看板 / 素材库 / 快捷库 / 文件夹名称）
            </div>
          )}
          {query.trim() && results.length === 0 && (
            <div className="search-empty">没有匹配结果</div>
          )}
          {groups.map(([kind, list]) => (
            <div key={kind}>
              <div className="search-group-title">
                {KIND_LABEL[kind]}（{list.length}）
              </div>
              {list.map((r) => {
                const idx = results.indexOf(r)
                return (
                  <div
                    key={r.id}
                    className={'search-item' + (idx === active ? ' active' : '')}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => open(r)}
                  >
                    <div className="search-item-title">
                      <span className="search-item-kind">{KIND_LABEL[r.kind]}</span>
                      {r.title}
                    </div>
                    {r.snippet && (
                      <div className="search-item-snippet">
                        <Highlight text={r.snippet} q={query.trim()} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
