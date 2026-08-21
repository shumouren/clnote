import { useEffect, useState } from 'react'
import { useStore, getNode } from '../store/useStore'
import {
  listSnapshots,
  saveSnapshot,
  deleteSnapshot,
  RESTORE_EVENT,
  type SnapShot,
} from './snapshots'
import { noteToMarkdown } from '../export/exporters'
import { diffLines, type DiffLine } from './diffLines'
import { toast } from '../ui/toast'

function mdOf(nodeId: string, content: unknown, name: string): string {
  // noteToMarkdown 只读 node.content / node.name，构造最小伪节点即可
  return noteToMarkdown({ id: nodeId, name, content } as never)
}

/** 版本快照面板：保存/恢复/删除快照，并与当前内容做行级 diff 对比 */
export default function SnapshotPanel() {
  const activePane = useStore((s) => s.activePane)
  const nodeId = useStore((s) => {
    const c = s.panes[s.activePane]
    return c && c.kind === 'node' ? c.id : null
  })
  const toggleSnap = useStore((s) => s.toggleSnap)
  const [items, setItems] = useState<SnapShot[]>([])
  const [open, setOpen] = useState(true)
  const [diff, setDiff] = useState<{ snap: SnapShot; lines: DiffLine[] } | null>(null)

  const reload = () => {
    if (nodeId) setItems(listSnapshots(nodeId))
    else setItems([])
  }

  useEffect(() => {
    reload()
    // 切换笔记时退出 diff 视图
    setDiff(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, activePane])

  const onSave = async () => {
    if (!nodeId) return
    const n = await getNode(nodeId)
    if (!n) return
    saveSnapshot(nodeId, n.content, new Date().toLocaleString('zh-CN'))
    reload()
    toast('已保存快照')
  }

  const onRestore = (snap: SnapShot) => {
    if (!nodeId) return
    window.dispatchEvent(
      new CustomEvent(RESTORE_EVENT, { detail: { nodeId, content: snap.content } }),
    )
    toast('已恢复到此快照')
  }

  const onDiff = async (snap: SnapShot) => {
    if (!nodeId) return
    const cur = await getNode(nodeId)
    const a = mdOf(nodeId, snap.content, '快照')
    const b = mdOf(nodeId, cur?.content ?? null, '当前')
    setDiff({ snap, lines: diffLines(a, b) })
  }

  const onDelete = (snap: SnapShot) => {
    if (!nodeId) return
    deleteSnapshot(nodeId, snap.id)
    reload()
  }

  if (!nodeId) return null

  return (
    <div className={'snap-drawer' + (open ? '' : ' collapsed')}>
      <div className="bl-head">
        <span className="bl-title" onClick={() => setOpen((o) => !o)} title="版本快照">
          📸 快照{items.length > 0 ? `（${items.length}）` : ''}
        </span>
        <span className="bl-actions">
          <span className="bl-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? '▾' : '▸'}
          </span>
          <span
            className="bl-close"
            title="关闭快照栏"
            onClick={(e) => {
              e.stopPropagation()
              toggleSnap()
            }}
          >
            ✕
          </span>
        </span>
      </div>
      {open && !diff && (
        <div className="bl-list">
          <button className="tb-btn snap-save" onClick={onSave}>
            📸 保存当前快照
          </button>
          {items.length === 0 ? (
            <div className="bl-empty">暂无快照，点击上方按钮保存</div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="snap-item">
                <div className="bl-name">{it.label}</div>
                <div className="snap-actions">
                  <span className="snap-link" onClick={() => onDiff(it)}>
                    对比
                  </span>
                  <span className="snap-link" onClick={() => onRestore(it)}>
                    恢复
                  </span>
                  <span className="snap-link danger" onClick={() => onDelete(it)}>
                    删除
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {open && diff && (
        <div className="bl-list">
          <div className="snap-diff-head">
            <span>对比：{diff.snap.label} ↔ 当前</span>
            <span className="snap-link" onClick={() => setDiff(null)}>
              ← 返回
            </span>
          </div>
          <div className="snap-diff">
            {diff.lines.map((l, i) => (
              <div key={i} className={'diff-' + l.type}>
                <span className="diff-mark">
                  {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}
                </span>
                <span className="diff-text">{l.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
