import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { listAllBookNotes } from '../storage/media'
import type { BookNote, DiskEntry } from '../model/types'

/** 媒体库「笔记内容」入口在编辑区展示的聚合笔记面板：汇聚全部书籍批注，点击可跳回原书 */
export default function NotesView({ onClose }: { onClose: () => void }) {
  const openMedia = useStore((s) => s.openMedia)
  const [notes, setNotes] = useState<BookNote[]>([])

  useEffect(() => {
    listAllBookNotes()
      .then(setNotes)
      .catch(() => setNotes([]))
  }, [])

  const jump = (n: BookNote) => {
    const path = n.bookPath
    const name = path.split(/[\\/]/).pop() || path
    const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : ''
    const entry: DiskEntry = { path, name, isDir: false, size: 0, modified: 0, ext }
    openMedia(entry)
  }

  return (
    <div className="notes-view">
      <div className="notes-view-head">
        <span className="reading-lib-title">📝 笔记内容</span>
        <span className="tb-spacer" />
        <button className="tb-btn" onClick={onClose} title="关闭">
          ✕
        </button>
      </div>
      <div className="notes-view-body">
        {notes.length === 0 ? (
          <div className="allnotes-empty">
            还没有任何批注。
            <br />
            在媒体库里打开书籍、随手添加批注后，这里会按书籍汇聚全部笔记，点击即可跳回原书位置。
          </div>
        ) : (
          <div className="allnotes-list">
            {notes.map((n) => (
              <div className="allnotes-item" key={n.id} title="跳回原书位置" onClick={() => jump(n)}>
                <div className="allnotes-head">
                  <b className="allnotes-book">📖 {n.bookName}</b>
                  {n.chapter && <span className="allnotes-chapter">{n.chapter}</span>}
                  {typeof n.percent === 'number' && (
                    <span className="allnotes-percent">{Math.round(n.percent)}%</span>
                  )}
                </div>
                <div className="allnotes-text">{n.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
