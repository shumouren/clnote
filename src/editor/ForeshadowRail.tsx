import { useStore } from '../store/useStore'
import type { ForeshadowRow } from '../model/types'

interface Props {
  items: ForeshadowRow[]
  currentChapterId: string
  onToggleDone: (f: ForeshadowRow) => void
  onJump: (f: ForeshadowRow) => void
  onDelete: (f: ForeshadowRow) => void
}

/**
 * 伏笔栏：替代大纲栏（仅当正在编辑"小说创作"下的笔记时显示）。
 * 聚合展示该小说创作下的全部伏笔，显示完成状态，点击可跳回正文对应位置。
 */
export default function ForeshadowRail({
  items,
  currentChapterId,
  onToggleDone,
  onJump,
  onDelete,
}: Props) {
  const nodes = useStore((s) => s.nodes)
  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? '（已删除）'
  const doneCount = items.filter((f) => f.done === 1).length

  return (
    <div className="outline-rail fs-rail">
      <div className="outline-title">
        伏笔 <span className="fs-count">{doneCount}/{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="outline-empty">
          选中正文里的一段文字，点工具栏「🔖 设为伏笔」即可在此列出，并显示是否完成。
        </div>
      ) : (
        <div className="outline-items fs-items">
          {items.map((f) => (
            <div
              key={f.id}
              className={'fs-item' + (f.done === 1 ? ' done' : '') + (f.chapterId === currentChapterId ? ' here' : '')}
            >
              <input
                type="checkbox"
                className="fs-check"
                checked={f.done === 1}
                onChange={() => onToggleDone(f)}
                title="标记完成 / 未完成"
              />
              <div className="fs-body" onClick={() => onJump(f)} title="跳转到正文对应位置">
                <div className="fs-chapter">{nameOf(f.chapterId)}</div>
                <div className="fs-snippet">{f.snippet}</div>
              </div>
              <button
                className="fs-del"
                title="删除该伏笔"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(f)
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
