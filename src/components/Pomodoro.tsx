import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { showNotification, playBeep } from '../platform/notify'
import { toast } from '../ui/toast'

type Phase = 'work' | 'short' | 'long'

const PHASE_LABEL: Record<Phase, string> = { work: '专注', short: '短休', long: '长休' }
const PHASE_ICON: Record<Phase, string> = { work: '🍅', short: '☕', long: '🛌' }

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

const STAT_KEY = 'clnote-pomodoro-stat'
function loadStat(): { date: string; count: number } {
  try {
    const d = JSON.parse(localStorage.getItem(STAT_KEY) || 'null') as {
      date?: string
      count?: number
    } | null
    if (d && d.date === todayKey() && typeof d.count === 'number') return { date: d.date, count: d.count }
  } catch {
    /* ignore */
  }
  return { date: todayKey(), count: 0 }
}
function saveStat(s: { date: string; count: number }) {
  try {
    localStorage.setItem(STAT_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/**
 * 番茄钟：常驻顶部工具栏右侧的胶囊。
 * - 计时逻辑用 ref 持有最新值，避免 setInterval 闭包拿到旧 state；
 *   phase / duration 的实际取值始终走 useStore.getState().settings，保证设置改了即时生效。
 * - 组件只挂载在 App 顶层一次，切笔记 / 分栏 / 切库都不会卸载，计时不中断。
 */
export default function Pomodoro() {
  const settings = useStore((s) => s.settings)
  const openSettings = useStore((s) => s.setSettingsOpen)

  const cfg = () => useStore.getState().settings
  const durationFor = (p: Phase) => {
    const s = cfg()
    const m = p === 'work' ? s.pomodoroWork : p === 'short' ? s.pomodoroShort : s.pomodoroLong
    return Math.max(1, Math.round(m * 60))
  }

  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<Phase>('work')
  const [left, setLeft] = useState(() => durationFor('work'))
  const [round, setRound] = useState(0)
  const [stat, setStat] = useState(loadStat)
  const [expanded, setExpanded] = useState(false)

  const leftRef = useRef(left)
  const phaseRef = useRef(phase)
  const roundRef = useRef(round)
  const statRef = useRef(stat)
  leftRef.current = left
  phaseRef.current = phase
  roundRef.current = round
  statRef.current = stat

  const setTime = (v: number) => {
    leftRef.current = v
    setLeft(v)
  }
  const setPhaseState = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  const onPhaseEnd = () => {
    const s = cfg()
    const p = phaseRef.current
    if (p === 'work') {
      const ns = { date: todayKey(), count: statRef.current.count + 1 }
      statRef.current = ns
      setStat(ns)
      saveStat(ns)
      const nr = roundRef.current + 1
      roundRef.current = nr
      setRound(nr)
      const next: Phase = nr % s.pomodoroRounds === 0 ? 'long' : 'short'
      if (s.pomodoroNotify) showNotification('🍅 专注完成', `已完成 ${ns.count} 个番茄，休息一下吧`)
      if (s.pomodoroSound === 'beep') playBeep()
      toast(`🍅 专注完成，已完成 ${ns.count} 个番茄，休息一下吧`)
      setPhaseState(next)
      setTime(durationFor(next))
      if (!s.pomodoroAutoStart) setRunning(false)
    } else {
      if (s.pomodoroNotify) showNotification('☕ 休息结束', '开始新的专注吧')
      if (s.pomodoroSound === 'beep') playBeep()
      toast('☕ 休息结束，开始新的专注吧')
      setPhaseState('work')
      setTime(durationFor('work'))
      if (!s.pomodoroAutoStart) setRunning(false)
    }
  }

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      const next = leftRef.current - 1
      if (next > 0) setTime(next)
      else {
        setTime(0)
        onPhaseEnd()
      }
    }, 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const toggle = () => {
    if (!running && leftRef.current <= 0) setTime(durationFor(phaseRef.current))
    setRunning((v) => !v)
  }
  const reset = () => {
    setRunning(false)
    setTime(durationFor(phaseRef.current))
  }
  const skip = () => {
    const s = cfg()
    const p = phaseRef.current
    const next: Phase =
      p === 'work' ? ((roundRef.current + 1) % s.pomodoroRounds === 0 ? 'long' : 'short') : 'work'
    setPhaseState(next)
    setTime(durationFor(next))
  }

  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  const rounds = settings.pomodoroRounds
  const cur = round % rounds
  const dots = '●'.repeat(cur) + '○'.repeat(rounds - cur)

  return (
    <div className={'pomodoro' + (expanded ? ' open' : '')}>
      <button
        className={'pomo-capsule' + (running ? ' running' : '')}
        onClick={() => setExpanded((v) => !v)}
        title="番茄钟（点击展开控制面板）"
      >
        <span className="pomo-icon">{PHASE_ICON[phase]}</span>
        <span className="pomo-time">
          {mm}:{ss}
        </span>
        <span className="pomo-phase">{PHASE_LABEL[phase]}</span>
        <span className="pomo-dots" title={`第 ${cur + 1} / ${rounds} 轮`}>
          {dots}
        </span>
        <span className="pomo-today" title="今日完成番茄数">
          今日 {stat.count}
        </span>
      </button>
      {expanded && (
        <div className="pomo-panel">
          <div className="pomo-row">
            <button className="tb-btn" onClick={toggle}>
              {running ? '⏸ 暂停' : '▶ 开始'}
            </button>
            <button className="tb-btn" onClick={reset} title="重置当前阶段">
              ↺ 重置
            </button>
            <button className="tb-btn" onClick={skip} title="跳到下一阶段">
              ⏭ 跳过
            </button>
          </div>
          <div className="pomo-stat">
            阶段：{PHASE_LABEL[phase]} · 今日已完成 {stat.count} 个番茄
          </div>
          <button
            className="pomo-settings-link"
            onClick={() => {
              openSettings(true)
              setExpanded(false)
            }}
          >
            在设置中调整时长与提醒 →
          </button>
        </div>
      )}
    </div>
  )
}
