import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { FsNode, NodeType } from '../model/types'
import { FORMAT_LABEL, formatsFor, BINARY_FORMATS, COMMON, type ExportKind } from './exporters'
import { exportBatch } from './runExport'
import { downloadLocationHint } from './download'

const ICON: Record<NodeType, string> = { folder: '📁', note: '📄', mindmap: '🧠', board: '📋', timeline: '⏳', character: '🧑', plot: '🎬', setting: '🌐', map: '🗺️' }

export default function ExportDialog() {
  const open = useStore((s) => s.exportOpen)
  const target = useStore((s) => s.exportTarget)
  const close = useStore((s) => s.closeExport)
  const nodes = useStore((s) => s.nodes)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)

  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [kind, setKind] = useState<ExportKind>(settings.exportFormat)
  const [keepTree, setKeepTree] = useState(settings.exportKeepTree)
  const [zip, setZip] = useState(settings.exportZip)
  const [merge, setMerge] = useState(settings.exportMerge)
  const [namePrefix, setNamePrefix] = useState(settings.exportNamePrefix)
  const [bookTitle, setBookTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const childrenOf = (pid: string | null) =>
    nodes.filter((n) => n.parentId === pid).sort((a, b) => a.order - b.order)

  const descendants = (id: string): string[] => {
    const out: string[] = []
    const walk = (pid: string) => {
      for (const c of nodes.filter((n) => n.parentId === pid)) {
        out.push(c.id)
        walk(c.id)
      }
    }
    walk(id)
    return out
  }

  // 打开时初始化勾选：有目标就选目标（文件夹连同内部），否则全选
  useEffect(() => {
    if (!open) return
    setMsg(null)
    setKind(settings.exportFormat)
    setKeepTree(settings.exportKeepTree)
    setZip(settings.exportZip)
    setMerge(settings.exportMerge)
    setNamePrefix(settings.exportNamePrefix)
    setBookTitle('')
    setAuthor('')
    if (target && byId.has(target)) {
      setChecked(new Set([target, ...descendants(target)]))
    } else {
      setChecked(new Set(nodes.map((n) => n.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target])

  const selectedFiles = useMemo(
    () => [...checked].map((id) => byId.get(id)).filter((n): n is FsNode => !!n && n.type !== 'folder'),
    [checked, byId],
  )

  // 可选格式：全是笔记 / 全是导图 → 各自完整格式；混选 → 通用格式
  const availableFormats = useMemo(() => {
    const types = new Set(selectedFiles.map((n) => n.type))
    if (types.size === 1) return formatsFor([...types][0])
    return COMMON
  }, [selectedFiles])

  useEffect(() => {
    if (!availableFormats.includes(kind)) setKind(availableFormats[0] ?? 'md')
  }, [availableFormats, kind])

  const isBinary = BINARY_FORMATS.includes(kind)
  const multi = selectedFiles.length > 1

  /** EPUB 书名默认取选中笔记所在顶层文件夹名；无父文件夹则取首篇笔记名 */
  const defaultBookTitle = useMemo(() => {
    const first = selectedFiles[0]
    if (!first) return ''
    let cur: string | null = first.parentId
    let rootName = ''
    while (cur) {
      const p = byId.get(cur)
      if (!p) break
      rootName = p.name
      cur = p.parentId
    }
    return rootName || first.name
  }, [selectedFiles, byId])

  if (!open) return null

  const toggleNode = (n: FsNode, on: boolean) => {
    const ids = [n.id, ...(n.type === 'folder' ? descendants(n.id) : [])]
    setChecked((prev) => {
      const s = new Set(prev)
      ids.forEach((id) => (on ? s.add(id) : s.delete(id)))
      return s
    })
  }

  const folderState = (n: FsNode): 'none' | 'some' | 'all' => {
    const kids = descendants(n.id).filter((id) => byId.get(id)?.type !== 'folder')
    if (!kids.length) return checked.has(n.id) ? 'all' : 'none'
    const on = kids.filter((id) => checked.has(id)).length
    if (on === 0) return 'none'
    return on === kids.length ? 'all' : 'some'
  }

  const renderRow = (n: FsNode, depth: number): JSX.Element => {
    const isFolder = n.type === 'folder'
    const state = isFolder ? folderState(n) : checked.has(n.id) ? 'all' : 'none'
    return (
      <div key={n.id}>
        <label className="exp-row" style={{ paddingLeft: 4 + depth * 16 }}>
          <input
            type="checkbox"
            checked={state === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = state === 'some'
            }}
            onChange={(e) => toggleNode(n, e.target.checked)}
          />
          <span className="exp-icon">{ICON[n.type]}</span>
          <span className="exp-name">{n.name}</span>
        </label>
        {isFolder && childrenOf(n.id).map((c) => renderRow(c, depth + 1))}
      </div>
    )
  }

  const doExport = async () => {
    setBusy(true)
    setMsg(null)
    try {
      setSettings({
        exportFormat: (COMMON.includes(kind) ? kind : settings.exportFormat) as typeof settings.exportFormat,
        exportKeepTree: keepTree,
        exportZip: zip,
        exportMerge: merge,
        exportNamePrefix: namePrefix,
      })
      const r = await exportBatch([...checked], {
        kind,
        keepTree,
        zip: zip && multi && !merge,
        merge: merge && !isBinary,
        namePrefix,
        accent: settings.accent,
        bookTitle: bookTitle.trim() || defaultBookTitle || undefined,
        author: author.trim() || undefined,
      })
      const loc =
        r.savedPath
          ? `（已保存到：${r.savedPath}）`
          : `→ ${r.filename} ${downloadLocationHint()}`
      setMsg(
        `已导出 ${r.count} 个文件 ${loc}` +
          (r.skipped ? `（${r.skipped} 个失败）` : ''),
      )
    } catch (e) {
      setMsg(`导出失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-mask" onClick={close}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>导出</h3>
          <span className="modal-close" onClick={close}>
            ✕
          </span>
        </div>

        <div className="modal-body exp-body">
          <div className="exp-left">
            <div className="exp-tools">
              <button className="tb-btn" onClick={() => setChecked(new Set(nodes.map((n) => n.id)))}>
                全选
              </button>
              <button className="tb-btn" onClick={() => setChecked(new Set())}>
                清空
              </button>
              <button
                className="tb-btn"
                title="只保留文本笔记"
                onClick={() =>
                  setChecked(new Set(nodes.filter((n) => n.type === 'note').map((n) => n.id)))
                }
              >
                仅文本
              </button>
              <button
                className="tb-btn"
                title="只保留思维导图"
                onClick={() =>
                  setChecked(new Set(nodes.filter((n) => n.type === 'mindmap').map((n) => n.id)))
                }
              >
                仅导图
              </button>
            </div>
            <div className="exp-tree">
              {childrenOf(null).length === 0 && <div className="exp-empty">还没有任何内容</div>}
              {childrenOf(null).map((n) => renderRow(n, 0))}
            </div>
          </div>

          <div className="exp-right">
            <div className="set-row">
              <span className="set-label">导出格式</span>
              <div className="exp-formats">
                {availableFormats.map((f) => (
                  <label key={f} className={'exp-fmt' + (kind === f ? ' active' : '')}>
                    <input
                      type="radio"
                      name="exp-fmt"
                      checked={kind === f}
                      onChange={() => setKind(f)}
                    />
                    {FORMAT_LABEL[f]}
                  </label>
                ))}
              </div>
            </div>

            <div className="set-row">
              <span className="set-label">选项</span>
              <label className="set-check">
                <input
                  type="checkbox"
                  checked={keepTree}
                  onChange={(e) => setKeepTree(e.target.checked)}
                />
                保留文件夹层级
              </label>
              <label className={'set-check' + (!multi || merge ? ' disabled' : '')}>
                <input
                  type="checkbox"
                  disabled={!multi || merge}
                  checked={zip && multi && !merge}
                  onChange={(e) => setZip(e.target.checked)}
                />
                打包成一个 ZIP
              </label>
              <label className={'set-check' + (isBinary ? ' disabled' : '')}>
                <input
                  type="checkbox"
                  disabled={isBinary}
                  checked={merge && !isBinary}
                  onChange={(e) => {
                    setMerge(e.target.checked)
                    if (e.target.checked) setZip(false)
                  }}
                />
                合并成单个文件
              </label>
            </div>

            <div className="set-row">
              <span className="set-label">文件名前缀</span>
              <select
                className="set-select"
                value={namePrefix}
                onChange={(e) => setNamePrefix(e.target.value as typeof namePrefix)}
              >
                <option value="none">不加前缀</option>
                <option value="index">序号（01- 02-）</option>
                <option value="date">日期（2026-08-10-）</option>
              </select>
            </div>

            {kind === 'epub' && (
              <div className="set-row epub-meta">
                <span className="set-label">EPUB 元信息</span>
                <div className="epub-meta-fields">
                  <label className="epub-field">
                    <span>书名</span>
                    <input
                      className="set-input"
                      value={bookTitle}
                      placeholder={defaultBookTitle || '我的手稿'}
                      onChange={(e) => setBookTitle(e.target.value)}
                    />
                  </label>
                  <label className="epub-field">
                    <span>作者</span>
                    <input
                      className="set-input"
                      value={author}
                      placeholder="佚名"
                      onChange={(e) => setAuthor(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="exp-hint">
              {kind === 'epub'
                ? 'EPUB 会把选中的文本笔记按当前顺序拼成一本电子书（自动生成目录），可直接导入本应用阅读器或任意 EPUB 阅读器。'
                : isBinary
                  ? 'PNG 为图片格式，不支持合并成单文件。'
                  : kind === 'json'
                    ? '源数据 JSON 可用于备份与再次导入本应用。'
                    : kind === 'md'
                      ? 'Markdown 兼容 Obsidian / 思源 / Typora；表格与待办按 GFM 语法输出。'
                      : kind === 'html'
                        ? 'HTML 自带排版样式，可直接双击打开或打印成 PDF。'
                        : '纯文本会丢弃所有格式，仅保留文字内容。'}
            </div>
            <div className="set-hint" style={{ marginTop: 10 }}>
              📁 导出文件将保存到系统「下载」文件夹，文件名见左下角状态栏。
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="modal-status">
            已选 <b>{selectedFiles.length}</b> 个文件
            {msg && <span className="exp-msg"> · {msg}</span>}
          </span>
          <button className="tb-btn" onClick={close}>
            取消
          </button>
          <button
            className="tb-btn primary"
            disabled={busy || selectedFiles.length === 0}
            onClick={doExport}
          >
            {busy ? '导出中…' : '开始导出'}
          </button>
        </div>
      </div>
    </div>
  )
}
