import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  advanceDue,
  emptyBoard,
  newId,
  type BoardColumn,
  type BoardDoc,
  type Label,
  type Priority,
  type Recurrence,
  type TaskCard,
} from '../model/types'
import type { PaneId } from '../store/useStore'
import { alertAsync, confirmAsync } from '../platform/dialog'

const PRIORITY_LABEL: Record<Priority, string> = { '': '无', low: '低', mid: '中', high: '高' }
const PRIORITY_COLOR: Record<Priority, string> = {
  '': '#9aa0a6',
  low: '#3aa675',
  mid: '#e0a106',
  high: '#e5484d',
}

const LABEL_COLORS = ['#e5484d', '#2f6df6', '#3aa675', '#e0a106', '#8957e5', '#0aa2c0']

/** 把 due(+dueTime) 解析成毫秒；无 dueTime 视为当天 23:59 */
function dueDateTimeMs(due: string, dueTime?: string | null): number | null {
  const ds = due + 'T' + (dueTime || '23:59') + ':00'
  const ms = new Date(ds).getTime()
  return isNaN(ms) ? null : ms
}

function todayStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function Board({
  nodeId,
  paneId,
  isActive,
  onFocusPane,
}: {
  nodeId: string
  paneId: PaneId
  isActive: boolean
  onFocusPane: (p: PaneId) => void
}) {
  const node = useStore((s) => s.nodes.find((n) => n.id === nodeId))
  const saveNodeContent = useStore((s) => s.saveNodeContent)

  const initial = (node?.content as BoardDoc) ?? emptyBoard()
  const [doc, setDoc] = useState<BoardDoc>(initial)
  const [dragTask, setDragTask] = useState<string | null>(null)
  /** 当前拖拽悬停的卡片 id，用于显示落点高亮 */
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TaskCard | null>(null)
  const [newLabelName, setNewLabelName] = useState('')

  const docRef = useRef(doc)
  docRef.current = doc
  const saveTimer = useRef<number | null>(null)

  // 从正文「精确到卡片」的引用跳转而来：自动定位并展开该卡片的编辑弹窗
  const jumpCardId = useStore((s) => s.jumpCardId)
  useEffect(() => {
    if (!jumpCardId || !nodeId) return
    // 直接从 store 取看板最新内容（避免 docRef 在切换节点时尚未刷新的时序问题）
    const tasks: TaskCard[] =
      (useStore.getState().nodes.find((n) => n.id === nodeId)?.content as
        | { tasks?: TaskCard[] }
        | undefined)?.tasks ?? []
    const t = tasks.find((x) => x.id === jumpCardId)
    if (t) {
      setDraft({ ...t })
      setEditingId(t.id)
    }
    useStore.getState().setJumpCardId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpCardId, nodeId])

  // 切换看板节点时重新载入
  useEffect(() => {
    setDoc((node?.content as BoardDoc) ?? emptyBoard())
    setEditingId(null)
    setDraft(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  /** 局部状态更新 + 防抖持久化（约 400ms 写入一次，避免每次按键都落盘） */
  const persist = (next: BoardDoc) => {
    setDoc(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void saveNodeContent(nodeId, next)
    }, 400)
  }

  const tasksOf = (colId: string) =>
    doc.tasks.filter((t) => t.columnId === colId).sort((a, b) => a.order - b.order)

  const nextOrder = (colId: string) => {
    const ts = tasksOf(colId)
    return ts.length ? Math.max(...ts.map((t) => t.order)) + 1 : 0
  }

  /* ---------------- 循环重生 ---------------- */

  const makeNext = (t: TaskCard): TaskCard | null => {
    if (!t.recurrence) return null
    return {
      id: newId(),
      columnId: t.columnId,
      title: t.title,
      note: t.note ?? '',
      done: false,
      labels: [...t.labels],
      priority: t.priority,
      due: advanceDue(t.due, t.recurrence),
      dueTime: t.dueTime ?? null,
      recurrence: t.recurrence,
      order: nextOrder(t.columnId),
      completedAt: null,
      createdAt: Date.now(),
    }
  }

  const completeTask = (taskId: string, done: boolean) => {
    const tasks = doc.tasks.map((t) => ({ ...t }))
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    task.done = done
    task.completedAt = done ? Date.now() : null
    if (done && task.recurrence && task.recurrence.regen === 'onComplete') {
      const next = makeNext(task)
      if (next) tasks.push(next)
    }
    persist({ ...doc, tasks })
  }

  /* ---------------- 到期自动重生（onDue） ---------------- */

  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      let changed = false
      const tasks = docRef.current.tasks.map((t) => ({ ...t }))
      for (const t of tasks) {
        if (t.done || !t.recurrence || t.recurrence.regen !== 'onDue' || !t.due) continue
        const ms = dueDateTimeMs(t.due, t.dueTime)
        if (ms && ms <= now) {
          t.done = true
          t.completedAt = now
          changed = true
          const next = makeNext(t)
          if (next) tasks.push(next)
        }
      }
      if (changed) persist({ ...docRef.current, tasks })
    }
    const iv = window.setInterval(tick, 60_000)
    return () => window.clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- 块（列）操作 ---------------- */

  /** 新增一块（在 3 列网格中自动换行至下一行，即「向下」新增） */
  const addBlock = () => {
    const col: BoardColumn = { id: newId(), name: `块 ${doc.columns.length + 1}` }
    persist({ ...doc, columns: [...doc.columns, col] })
  }

  const renameColumn = (id: string, name: string) =>
    persist({ ...doc, columns: doc.columns.map((c) => (c.id === id ? { ...c, name } : c)) })

  const deleteColumn = async (id: string) => {
    // 至少保留一块，避免看板被删空后无法继续操作
    if (doc.columns.length <= 1) {
      await alertAsync('至少保留一块，无法删除最后一块。')
      return
    }
    if (!(await confirmAsync('删除该块？块内任务也会一并删除。'))) return
    persist({
      ...doc,
      columns: doc.columns.filter((c) => c.id !== id),
      tasks: doc.tasks.filter((t) => t.columnId !== id),
    })
  }

  /* ---------------- 任务操作 ---------------- */

  const addTask = (colId: string) => {
    const t: TaskCard = {
      id: newId(),
      columnId: colId,
      title: '新任务',
      note: '',
      done: false,
      labels: [],
      priority: '',
      due: null,
      dueTime: null,
      recurrence: null,
      order: nextOrder(colId),
      completedAt: null,
      createdAt: Date.now(),
    }
    persist({ ...doc, tasks: [...doc.tasks, t] })
    setEditingId(t.id)
  }

  const deleteTask = async (id: string) => {
    if (!(await confirmAsync('删除该任务？'))) return
    persist({ ...doc, tasks: doc.tasks.filter((t) => t.id !== id) })
    if (editingId === id) {
      setEditingId(null)
      setDraft(null)
    }
  }

  /** 拖拽：把 taskId 移动到 toCol，beforeId 之前（省略则放到列尾） */
  const moveTask = (taskId: string, toCol: string, beforeId?: string) => {
    const tasks = doc.tasks.map((t) => ({ ...t }))
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    task.columnId = toCol
    const colTasks = tasks
      .filter((t) => t.columnId === toCol && t.id !== taskId)
      .sort((a, b) => a.order - b.order)
    let idx = colTasks.length
    if (beforeId) {
      const bi = colTasks.findIndex((t) => t.id === beforeId)
      if (bi >= 0) idx = bi
    }
    colTasks.splice(idx, 0, task)
    colTasks.forEach((t, i) => (t.order = i))
    persist({ ...doc, tasks })
  }

  /* ---------------- 编辑弹窗 ---------------- */

  const openEditor = (t: TaskCard) => {
    setDraft({ ...t })
    setEditingId(t.id)
  }

  const saveDraft = () => {
    if (!draft) return
    const tasks = doc.tasks.map((t) => (t.id === draft.id ? { ...draft } : t))
    persist({ ...doc, tasks })
    setEditingId(null)
    setDraft(null)
  }

  const addLabel = () => {
    const name = newLabelName.trim()
    if (!name) return
    const id = 'lb-' + newId()
    const color = LABEL_COLORS[doc.labels.length % LABEL_COLORS.length]
    const label: Label = { id, name, color }
    const labels = [...doc.labels, label]
    const nextDraft = draft ? { ...draft, labels: [...draft.labels, id] } : draft
    setDoc({ ...doc, labels })
    setDraft(nextDraft)
    setNewLabelName('')
  }

  const labelName = (id: string) => doc.labels.find((l) => l.id === id)?.name ?? id

  const editing = doc.tasks.find((t) => t.id === editingId) ?? null

  return (
    <div className="board" onMouseDown={() => isActive || onFocusPane(paneId)}>
      <div className="board-bar">
        <span className="board-bar-title">任务看板</span>
        <span className="board-bar-spacer" />
        <button className="board-add-block" onClick={addBlock} title="新增一块（在网格中向下排列）">
          ＋ 新增块
        </button>
      </div>
      <div className="board-grid">
        {doc.columns.map((col) => {
          const list = tasksOf(col.id)
          return (
            <div
              key={col.id}
              className="board-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverId(null)
                if (dragTask) moveTask(dragTask, col.id)
                setDragTask(null)
              }}
            >
              <div className="board-col-head">
                <input
                  className="board-col-name"
                  value={col.name}
                  onChange={(e) => renameColumn(col.id, e.target.value)}
                />
                <span className="board-col-count">{list.length}</span>
                <span
                  className="board-col-del"
                  title="删除该列"
                  onClick={() => deleteColumn(col.id)}
                >
                  ✕
                </span>
              </div>

              <div className="board-col-body">
                {list.map((t) => {
                  const overdue =
                    !t.done && t.due && dueDateTimeMs(t.due, t.dueTime) != null
                      ? dueDateTimeMs(t.due, t.dueTime)! < Date.now()
                      : false
                  return (
                    <div
                      key={t.id}
                      className={
                        'board-card' +
                        (t.done ? ' done' : '') +
                        (dragOverId === t.id ? ' over' : '')
                      }
                      draggable
                      onDragStart={(e) => {
                        setDragTask(t.id)
                        e.dataTransfer.setData('text/plain', t.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => {
                        setDragTask(null)
                        setDragOverId(null)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOverId(t.id)
                      }}
                      onDragLeave={() =>
                        setDragOverId((id) => (id === t.id ? null : id))
                      }
                      onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setDragOverId(null)
                        if (dragTask && dragTask !== t.id) moveTask(dragTask, col.id, t.id)
                        setDragTask(null)
                      }}
                      onClick={() => openEditor(t)}
                    >
                      <label
                        className="board-check"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={(e) => completeTask(t.id, e.target.checked)}
                        />
                      </label>
                      <div className="board-card-main">
                        <div className="board-card-title">{t.title}</div>
                        {t.note ? (
                          <div className="board-card-note">{t.note}</div>
                        ) : null}
                        <div className="board-card-meta">
                          {t.priority && (
                            <span
                              className="board-prio"
                              style={{ background: PRIORITY_COLOR[t.priority] }}
                            >
                              {PRIORITY_LABEL[t.priority]}
                            </span>
                          )}
                          {t.due && (
                            <span className={'board-due' + (overdue ? ' overdue' : '')}>
                              📅 {t.due}
                              {t.dueTime ? ' ' + t.dueTime : ''}
                            </span>
                          )}
                          {t.recurrence && <span className="board-recur">🔁</span>}
                          {t.labels.map((lid) => (
                            <span
                              key={lid}
                              className="board-label"
                              style={{
                                background:
                                  doc.labels.find((l) => l.id === lid)?.color ?? '#888',
                              }}
                            >
                              {labelName(lid)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <button className="board-add" onClick={() => addTask(col.id)}>
                  ＋ 添加任务
                </button>
              </div>
            </div>
          )
        })}

        {/* 响应式网格：列数随容器宽度自适应（最小约 3 列、最大不限），
            新增「块」在标题栏，自动按宽度排布并向下换行 */}
      </div>

      {editing && draft && (
        <div className="board-modal-mask" onClick={() => { setEditingId(null); setDraft(null) }}>
          <div className="board-modal" onClick={(e) => e.stopPropagation()}>
            <div className="board-modal-head">
              <span>编辑任务</span>
              <span className="board-modal-close" onClick={() => { setEditingId(null); setDraft(null) }}>
                ✕
              </span>
            </div>

            <label className="board-field">
              <span>标题 *</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>

            <label className="board-field">
              <span>备注（选填）</span>
              <textarea
                rows={3}
                value={draft.note ?? ''}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>

            <div className="board-field">
              <span>优先级</span>
              <select
                value={draft.priority}
                onChange={(e) =>
                  setDraft({ ...draft, priority: e.target.value as Priority })
                }
              >
                {(['', 'low', 'mid', 'high'] as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>

            <div className="board-field">
              <span>截止日期（选填）</span>
              <div className="board-inline">
                <input
                  type="date"
                  value={draft.due ?? ''}
                  onChange={(e) => setDraft({ ...draft, due: e.target.value || null })}
                />
                <input
                  type="time"
                  value={draft.dueTime ?? ''}
                  onChange={(e) => setDraft({ ...draft, dueTime: e.target.value || null })}
                />
              </div>
            </div>

            <div className="board-field">
              <span>循环（选填）</span>
              {draft.recurrence ? (
                <div className="board-recur-box">
                  <div className="board-inline">
                    <span>每</span>
                    <input
                      type="number"
                      min={1}
                      style={{ width: 64 }}
                      value={draft.recurrence.interval}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          recurrence: {
                            ...draft.recurrence!,
                            interval: Math.max(1, Number(e.target.value) || 1),
                          },
                        })
                      }
                    />
                    <select
                      value={draft.recurrence.unit}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          recurrence: {
                            ...draft.recurrence!,
                            unit: e.target.value as Recurrence['unit'],
                          },
                        })
                      }
                    >
                      <option value="day">天</option>
                      <option value="week">周</option>
                      <option value="month">月</option>
                      <option value="year">年</option>
                    </select>
                  </div>
                  <div className="board-inline">
                    <span>重生时机</span>
                    <select
                      value={draft.recurrence.regen}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          recurrence: {
                            ...draft.recurrence!,
                            regen: e.target.value as Recurrence['regen'],
                          },
                        })
                      }
                    >
                      <option value="onComplete">完成时重生</option>
                      <option value="onDue">到期时重生</option>
                    </select>
                  </div>
                  <button
                    className="tb-btn"
                    onClick={() => setDraft({ ...draft, recurrence: null })}
                  >
                    移除循环
                  </button>
                </div>
              ) : (
                <button
                  className="tb-btn"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      recurrence: { unit: 'week', interval: 1, regen: 'onComplete' },
                    })
                  }
                >
                  ＋ 设置循环
                </button>
              )}
            </div>

            <div className="board-field">
              <span>标签</span>
              <div className="board-labels">
                {doc.labels.map((l) => {
                  const on = draft.labels.includes(l.id)
                  return (
                    <span
                      key={l.id}
                      className={'board-label-toggle' + (on ? ' on' : '')}
                      style={{ background: on ? l.color : 'transparent', borderColor: l.color }}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          labels: on
                            ? draft.labels.filter((x) => x !== l.id)
                            : [...draft.labels, l.id],
                        })
                      }
                    >
                      {l.name}
                    </span>
                  )
                })}
              </div>
              <div className="board-inline" style={{ marginTop: 8 }}>
                <input
                  placeholder="新标签名"
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                />
                <button className="tb-btn" onClick={addLabel}>
                  ＋ 添加
                </button>
              </div>
            </div>

            <div className="board-modal-foot">
              <button
                className="tb-btn danger"
                onClick={() => {
                  const id = draft.id
                  setEditingId(null)
                  setDraft(null)
                  deleteTask(id)
                }}
              >
                删除任务
              </button>
              <span className="tb-spacer" />
              <button className="tb-btn" onClick={saveDraft}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
