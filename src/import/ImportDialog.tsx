import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  parseImportFile,
  kindLabel,
  type ParsedImport,
  type ImportKind,
} from './importers'
import { pickFiles } from '../export/download'
import { confirmAsync } from '../platform/dialog'

type Kind = ImportKind

const ACCEPT = '.md,.markdown,.txt,.html,.htm,.json,.clnote,.opml'

const ICON: Record<string, string> = {
  backup: '🗄',
  'node-json': '🧩',
  markdown: '📝',
  text: '📄',
  html: '🌐',
  opml: '🧠',
}

interface Picked {
  name: string
  parsed: ParsedImport
}

export default function ImportDialog() {
  const open = useStore((s) => s.importOpen)
  const target0 = useStore((s) => s.importTarget)
  const nodes = useStore((s) => s.nodes)
  const addImportedNodes = useStore((s) => s.addImportedNodes)
  const close = useStore((s) => s.closeImport)

  const [picked, setPicked] = useState<Picked[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTarget(target0 ?? null)
      setPicked([])
      setMsg(null)
      setBusy(false)
    }
  }, [open, target0])

  const folderOptions = useMemo(() => {
    const opts: { id: string | null; label: string }[] = [{ id: null, label: '根目录' }]
    const walk = (pid: string | null, depth: number) => {
      nodes
        .filter((n) => n.parentId === pid && n.type === 'folder')
        .sort((a, b) => a.order - b.order)
        .forEach((f) => {
          opts.push({ id: f.id, label: '　'.repeat(depth) + '📁 ' + f.name })
          walk(f.id, depth + 1)
        })
    }
    walk(null, 0)
    return opts
  }, [nodes])

  if (!open) return null

  const choose = async () => {
    const files = await pickFiles(ACCEPT, true)
    if (!files.length) return
    setPicked(files.map((f) => ({ name: f.name, parsed: parseImportFile(f.name, f.text) })))
    setMsg(null)
  }

  const totalNodes = picked.reduce((a, p) => a + p.parsed.nodes.length, 0)
  const hasBackup = picked.some((p) => p.parsed.kind === 'backup')

  const doImport = async () => {
    if (!picked.length || busy) return
    // 整库备份包含素材库 / 快捷库，必须通过「设置 → 文件存储 → 备份与恢复」恢复，
    // 不能在这里只导入文件树节点，否则会丢素材、丢快捷。
    if (hasBackup) {
      setMsg('检测到整库备份（含素材库 / 快捷库）。请到「设置 → 文件存储 → 备份与恢复」用「从备份覆盖 / 合并」来恢复，可保证数据完整。')
      return
    }
    setBusy(true)
    try {
      const all = picked.flatMap((p) => p.parsed.nodes)
      const n = await addImportedNodes(all, target)
      setMsg(`已导入 ${n} 个节点${target ? '' : '（到根目录）'}`)
      setPicked([])
    } catch (e) {
      setMsg('导入失败：' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-mask" onClick={close}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>导入</h3>
          <span className="modal-close" onClick={close}>
            ✕
          </span>
        </div>

        <div className="modal-body">
          <div className="set-row">
            <span className="set-label">选择文件</span>
            <div className="set-inline wrap">
              <button className="tb-btn primary" onClick={choose} disabled={busy}>
                选择文件…
              </button>
              <span className="set-hint" style={{ margin: 0 }}>
                支持 Markdown / 纯文本 / HTML / JSON（节点）/ OPML 思维导图，可多选。整库备份（.clnote，含素材库、快捷库）请到「设置 → 文件存储 → 备份与恢复」恢复。
              </span>
            </div>
          </div>

          {picked.length > 0 && (
            <div className="set-card">
              <div className="set-card-title">待导入（{picked.length} 个文件 · {totalNodes} 个节点）</div>
              <div className="imp-list">
                {picked.map((p, i) => (
                  <div className="exp-row" key={i}>
                    <span className="exp-icon">{ICON[p.parsed.kind] ?? '📄'}</span>
                    <span className="exp-name" title={p.name}>
                      {p.name}
                    </span>
                    <span className="imp-kind">{kindLabel(p.parsed.kind as Kind)}</span>
                    <span className="imp-sub">
                      {p.parsed.nodes.length} 个 ·{' '}
                      {p.parsed.nodes[0]?.type === 'mindmap' ? '思维导图' : '文本'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="set-row">
            <span className="set-label">导入到</span>
            <select
              className="set-select"
              value={target ?? ''}
              onChange={(e) => setTarget(e.target.value || null)}
            >
              {folderOptions.map((o) => (
                <option key={o.id ?? 'root'} value={o.id ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="set-hint">
              选择目标文件夹，导入的内容会放进去；选「根目录」则放到顶层。
            </div>
          </div>

          {msg && <div className={'set-msg' + (msg.startsWith('已') ? '' : ' imp-err')}>{msg}</div>}

          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <button
              className="tb-btn primary"
              onClick={doImport}
              disabled={!picked.length || busy}
            >
              {busy ? '导入中…' : '开始导入'}
            </button>
            <button className="tb-btn" onClick={close}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
