import { useEffect } from 'react'
import type { FsNode, MindMapDoc } from '../model/types'

interface Props {
  /** 候选：文本库下的全部思维导图节点 */
  candidates: FsNode[]
  /** 选中某张导图（创建对其的引用） */
  onPick: (n: FsNode) => void
  onClose: () => void
}

/** 从思维导图 content 里取根节点文字，作为列表里的预览 */
function previewOf(n: FsNode): string {
  try {
    const doc = n.content as MindMapDoc | undefined
    return doc?.root?.text ?? '（空导图）'
  } catch {
    return '（空导图）'
  }
}

export default function MindMapPicker({ candidates, onPick, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="mat-modal-mask" onClick={onClose}>
      <div className="mat-modal ref-picker" onClick={(e) => e.stopPropagation()}>
        <div className="mat-modal-head">
          <span>引用文本库的思维导图</span>
          <span className="mat-modal-close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="mat-modal-sub">
          选择一张文本库已有的思维导图，创作库里将生成一个「引用」节点；
          <b>两端共享同一份内容，在一处修改全局生效</b>。
        </div>
        <div className="ref-picker-list">
          {candidates.length === 0 ? (
            <div className="ref-picker-empty">
              文本库还没有思维导图。请先在「文本库」页签新建思维导图，再回来引用。
            </div>
          ) : (
            candidates.map((n) => (
              <div
                key={n.id}
                className="ref-picker-item"
                onClick={() => onPick(n)}
                title="点击创建对此导图的引用"
              >
                <span className="ref-picker-icon">🧠</span>
                <span className="ref-picker-meta">
                  <span className="ref-picker-name">{n.name}</span>
                  <span className="ref-picker-prev">{previewOf(n)}</span>
                </span>
                <span className="ref-picker-go">引用 ›</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
