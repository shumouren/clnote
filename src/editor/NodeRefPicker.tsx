import { useEffect, useRef } from 'react'
import { NODE_REF_ICON, NODE_REF_LABEL, type RefTarget } from './nodeRefShared'

interface Props {
  items: RefTarget[]
  activeIndex: number
  /** 视口坐标（position: fixed 直接使用） */
  pos: { top: number; left: number }
  onSelect: (item: RefTarget) => void
  onHover: (i: number) => void
  /** 卡片集合下钻态：显示集合名与「返回」 */
  expandedBoard?: string | null
  /** 下钻态时集合的类型（用于面包屑图标） */
  expandedType?: string | null
  /** 点击可下钻节点 → 展开其卡片 */
  onExpand?: (item: RefTarget) => void
  /** 返回上层节点列表 */
  onBack?: () => void
}

/** @ 提及引用选择器弹窗：列出匹配节点，键盘/鼠标均可选取。
 *  可下钻节点（看板/角色/剧情/设定等带卡片集合）点「▸」展开其卡片，选卡片即精确到卡片引用。 */
export default function NodeRefPicker({
  items,
  activeIndex,
  pos,
  onSelect,
  onHover,
  expandedBoard,
  expandedType,
  onExpand,
  onBack,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector('.mention-item.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const iconOf = (it: RefTarget) =>
    it.cardId ? '🗂️' : NODE_REF_ICON[it.type] ?? '🔗'

  return (
    <div className="mention-popup" style={{ top: pos.top, left: pos.left }} ref={listRef}>
      {expandedBoard && (
        <div className="mention-crumb" onMouseDown={(e) => { e.preventDefault(); onBack?.() }}>
          {NODE_REF_ICON[expandedType ?? ''] ?? '🔗'} {expandedBoard} <span className="mention-crumb-sep">▸</span> 卡片 · 返回
        </div>
      )}
      {items.length === 0 ? (
        <div className="mention-empty">{expandedBoard ? '该集合暂无卡片' : '无匹配节点'}</div>
      ) : (
        items.map((it, i) => {
          const isBack = it.id === '__back__'
          const isCardHost = !!it.hasCards && !it.cardId && !isBack
          return (
            <div
              key={isBack ? '__back__' : it.cardId ? `${it.id}#${it.cardId}` : it.id}
              className={
                'mention-item' +
                (i === activeIndex ? ' active' : '') +
                (isBack ? ' mention-back' : '') +
                (it.cardId ? ' mention-card' : '') +
                (isCardHost ? ' mention-host' : '')
              }
              onMouseEnter={() => onHover(i)}
              // 用 mousedown + preventDefault：在 editor 失去光标前完成插入，避免选区被清空
              onMouseDown={(e) => {
                e.preventDefault()
                if (isBack) onBack?.()
                else if (isCardHost) onExpand?.(it)
                else onSelect(it)
              }}
            >
              <span className="mention-ico">{isBack ? '↩' : iconOf(it)}</span>
              <span className="mention-name">{it.name || '（未命名）'}</span>
              {isCardHost ? (
                <span className="mention-type">{NODE_REF_LABEL[it.type] ?? it.type} ▸</span>
              ) : (
                <span className="mention-type">
                  {it.cardId ? '卡片' : NODE_REF_LABEL[it.type] ?? it.type}
                </span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
