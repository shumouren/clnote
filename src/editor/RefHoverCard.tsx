import type { CSSProperties } from 'react'
import type { FsNode } from '../model/types'
import { NODE_REF_ICON, docToText } from './nodeRefShared'

/** 把被引用的创作库/正文节点压成悬浮预览用的摘要 */
export function summarizeRefNode(node: FsNode): { icon: string; title: string; lines: string[] } {
  const icon = NODE_REF_ICON[node.type] ?? '🔗'
  const title = node.name || '（未命名）'
  const lines: string[] = []
  const c = node.content as Record<string, any> | undefined
  if (!c) return { icon, title, lines: ['（暂无内容）'] }
  switch (node.type) {
    case 'character': {
      const items = Array.isArray(c.items) ? c.items : []
      const it = items[0]
      if (it) {
        if (Array.isArray(it.tags) && it.tags.length) lines.push('标签：' + it.tags.join('、'))
        ;(Array.isArray(it.attrs) ? it.attrs : [])
          .slice(0, 4)
          .forEach((a: any) => {
            if (a?.name && a?.value) lines.push(`${a.name}：${a.value}`)
          })
        if (it.bio) lines.push(it.bio.slice(0, 80))
      }
      const rels = Array.isArray(c.relations) ? c.relations : []
      if (rels.length) lines.push(`关系 ${rels.length} 条`)
      break
    }
    case 'plot': {
      const items = Array.isArray(c.items) ? c.items : []
      const mode = c.mode === 'graph' ? '关系图' : c.mode === 'outline' ? '大纲' : c.mode === 'timeline' ? '时间线' : '看板'
      lines.push(`模式：${mode} · 情节 ${items.length} 项`)
      break
    }
    case 'setting': {
      const entries = Array.isArray(c.entries) ? c.entries : []
      const cats = Array.isArray(c.categories) ? c.categories.length : 0
      lines.push(`分类 ${cats} · 条目 ${entries.length}`)
      if (entries[0]?.desc) lines.push(entries[0].desc.slice(0, 80))
      break
    }
    case 'map': {
      const floors = Array.isArray(c.floors) ? c.floors : []
      const locs = floors.reduce((s: number, f: any) => s + (Array.isArray(f.locations) ? f.locations.length : 0), 0)
      lines.push(`楼层 ${floors.length} · 地点 ${locs}`)
      break
    }
    case 'note': {
      const text = docToText(c).slice(0, 90)
      lines.push(text || '（空）')
      break
    }
    case 'mindmap':
      lines.push('思维导图')
      break
    case 'timeline':
      lines.push('时间线')
      break
    case 'board':
      lines.push('任务看板')
      break
    default:
      break
  }
  return { icon, title, lines: lines.slice(0, 6) }
}

/** 悬浮在引用芯片上时显示的创作库卡片预览（非交互，pointer-events:none，点击交给芯片本身跳转） */
export default function RefHoverCard({ node, x, y }: { node: FsNode; x: number; y: number }) {
  const { icon, title, lines } = summarizeRefNode(node)
  const style: CSSProperties = { position: 'fixed', left: x, top: y, pointerEvents: 'none', zIndex: 9999 }
  return (
    <div className="ref-hover-card" style={style}>
      <div className="rhc-head">
        <span className="rhc-ico">{icon}</span>
        <span className="rhc-title">{title}</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="rhc-line">
          {l}
        </div>
      ))}
      <div className="rhc-foot">点击引用可跳转</div>
    </div>
  )
}
