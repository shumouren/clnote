export interface OutlineItem {
  level: number
  text: string
  pos: number
}

interface Props {
  items: OutlineItem[]
  onJump: (pos: number) => void
}

/** 标题大纲：列出当前笔记的 H1-H3，点击跳转到对应位置 */
export default function Outline({ items, onJump }: Props) {
  if (items.length === 0) {
    return (
      <div className="outline-rail">
        <div className="outline-title">大纲</div>
        <div className="outline-empty">用 H1/H2/H3 写标题后，这里会出现大纲。</div>
      </div>
    )
  }
  return (
    <div className="outline-rail">
      <div className="outline-title">大纲</div>
      <div className="outline-items">
        {items.map((it, i) => (
          <div
            key={i}
            className={'outline-item lvl-' + it.level}
            title={it.text}
            onClick={() => onJump(it.pos)}
          >
            {it.text}
          </div>
        ))}
      </div>
    </div>
  )
}
