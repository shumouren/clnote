import { useEffect, useMemo, useState } from 'react'

export interface MoveTarget {
  /** null 表示根目录（取消嵌套） */
  id: string | null
  label: string
  /** 嵌套深度，用于缩进展示 */
  depth: number
  icon: string
}

/**
 * 通用的"移动到…"选择弹窗：右键菜单点开后，列出可选的目标节点（含根目录），
 * 用户点选即把当前节点移入该目标之下。子节点（子树）因 parentId 不变而自动跟随。
 */
export function MoveToDialog({
  title,
  targets,
  onPick,
  onClose,
}: {
  title: string
  targets: MoveTarget[]
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    setOpen(false)
    onClose()
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return targets
    return targets.filter((t) => t.label.toLowerCase().includes(kw))
  }, [q, targets])

  if (!open) return null

  return (
    <div className="modal-mask" onClick={close}>
      <div
        className="modal"
        style={{ width: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <span className="modal-close" onClick={close}>
            ✕
          </span>
        </div>
        <div style={{ padding: '10px 18px 0' }}>
          <input
            className="move-to-search"
            autoFocus
            placeholder="搜索目标节点…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="modal-body move-to-body">
          {filtered.map((t) => (
            <div
              key={t.id ?? '__root__'}
              className="move-to-item"
              style={{ paddingLeft: 12 + t.depth * 18 }}
              onClick={() => {
                setOpen(false)
                onPick(t.id)
              }}
            >
              <span className="move-to-icon">{t.icon}</span>
              <span className="move-to-label">{t.label}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="move-to-empty">没有匹配的目标节点</div>}
        </div>
        <div className="modal-foot">
          <button className="tb-btn" onClick={close}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
