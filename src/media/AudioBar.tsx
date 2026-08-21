import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { getMediaProgress, setMediaProgress, mediaProtocolUrl } from '../storage/media'
import type { DiskEntry } from '../model/types'

type Mode = 'order' | 'loop' | 'shuffle'

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const MODE_LABEL: Record<Mode, string> = {
  order: '顺序',
  loop: '单曲循环',
  shuffle: '随机',
}

/**
 * 媒体库常驻音频播放条（底部）：与分栏解耦，保证「看书 / 看视频」时音乐继续播。
 * 直接读 store 的 mediaAudio / mediaAudioList，上一首 / 下一首通过 setMediaAudio 切换。
 */
export default function AudioBar() {
  const media = useStore((s) => s.mediaAudio)
  const playlist = useStore((s) => s.mediaAudioList)
  const setMediaAudio = useStore((s) => s.setMediaAudio)

  const audioRef = useRef<HTMLAudioElement>(null)
  const saveTimer = useRef<number | null>(null)
  const restoreRef = useRef<number>(0)

  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(1)
  const [muted, setMuted] = useState(false)
  const [mode, setMode] = useState<Mode>('order')
  const [listOpen, setListOpen] = useState(false)
  /** 拖动进度条时的预览位置（0–1000） */
  const [dragPct, setDragPct] = useState<number | null>(null)

  useEffect(() => {
    const a = audioRef.current
    if (!a || !media) return
    let cancelled = false
    setCur(0)
    setDur(0)
    setPlaying(false)
    getMediaProgress(media.path)
      .then((p) => {
        if (cancelled) return
        restoreRef.current = p?.position ?? 0
        a.src = mediaProtocolUrl(media.path)
        a.load()
      })
      .catch(() => {
        if (cancelled) return
        restoreRef.current = 0
        a.src = mediaProtocolUrl(media.path)
        a.load()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media])

  const onLoadedMeta = () => {
    const a = audioRef.current
    if (!a) return
    setDur(a.duration)
    const pos = restoreRef.current
    if (pos > 0 && pos < a.duration) {
      try {
        a.currentTime = pos
      } catch {
        /* 某些格式 seek 受限，忽略 */
      }
    }
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  const onTimeUpdate = () => {
    const a = audioRef.current
    if (!a) return
    setCur(a.currentTime)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      if (media) {
        setMediaProgress({
          mediaPath: media.path,
          position: a.currentTime,
          duration: a.duration,
          updatedAt: Date.now(),
        }).catch(() => {})
      }
    }, 1000)
  }

  const onEnded = () => {
    if (mode === 'loop') {
      const a = audioRef.current
      if (a) {
        a.currentTime = 0
        a.play().catch(() => {})
      }
      return
    }
    const idx = playlist.findIndex((p) => p.path === media?.path)
    if (mode === 'shuffle') {
      if (playlist.length > 1) {
        let n = idx
        while (n === idx) n = Math.floor(Math.random() * playlist.length)
        setMediaAudio(playlist[n])
      }
      return
    }
    if (idx >= 0 && idx < playlist.length - 1) setMediaAudio(playlist[idx + 1])
  }

  const togglePlay = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => {})
    else {
      a.pause()
      setPlaying(false)
    }
  }

  const seek = (v: number) => {
    const a = audioRef.current
    if (!a || !isFinite(a.duration) || a.duration <= 0) return
    a.currentTime = (v / 1000) * a.duration
  }

  /** 拖动结束：提交真正的 seek（拖动中只预览，避免高频 seek 卡顿） */
  const commitSeek = (pct: number | null) => {
    if (pct == null) return
    seek(pct)
    setDragPct(null)
  }

  const cycleMode = () => setMode((m) => (m === 'order' ? 'loop' : m === 'loop' ? 'shuffle' : 'order'))

  const idx = playlist.findIndex((p) => p.path === media?.path)
  const prev = () => {
    if (idx > 0) setMediaAudio(playlist[idx - 1])
  }
  const next = () => {
    if (idx >= 0 && idx < playlist.length - 1) setMediaAudio(playlist[idx + 1])
  }

  if (!media) return null

  return (
    <div className="audio-bar">
      <div className="audio-bar-main">
        <div className="audio-bar-cover">🎵</div>
        <div className="audio-bar-meta" title={media.path}>
          <div className="audio-bar-title">{media.name}</div>
        </div>
        <div className="audio-bar-controls">
          <button className="audio-btn" onClick={prev} title="上一首">
            ⏮
          </button>
          <button className="audio-btn audio-play" onClick={togglePlay} title={playing ? '暂停' : '播放'}>
            {playing ? '⏸' : '▶'}
          </button>
          <button className="audio-btn" onClick={next} title="下一首">
            ⏭
          </button>
          <button className="audio-btn audio-mode" onClick={cycleMode} title="播放模式">
            {MODE_LABEL[mode]}
          </button>
        </div>
        <div className="audio-bar-seek">
          <span className="audio-time">{fmt(dragPct != null ? (dragPct / 1000) * dur : cur)}</span>
          <input
            className="audio-range"
            type="range"
            min={0}
            max={1000}
            value={dragPct ?? (dur ? (cur / dur) * 1000 : 0)}
            onChange={(e) => setDragPct(Number(e.target.value))}
            onPointerUp={(e) => commitSeek(Number((e.currentTarget as HTMLInputElement).value))}
            onBlur={() => commitSeek(dragPct)}
            title="拖动到目标位置（松开跳转）"
          />
          <span className="audio-time">{fmt(dur)}</span>
        </div>
        <div className="audio-vol">
          <button className="audio-btn" onClick={() => {
            const a = audioRef.current
            if (!a) return
            setMuted((m) => {
              a.muted = !m
              return !m
            })
          }} title={muted ? '取消静音' : '静音'}>
            {muted || vol === 0 ? '🔇' : '🔊'}
          </button>
          <input
            className="audio-range audio-range-sm"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVol(v)
              setMuted(v === 0)
              if (audioRef.current) {
                audioRef.current.volume = v
                if (v > 0) audioRef.current.muted = false
              }
            }}
          />
        </div>
        <button className="audio-btn" onClick={() => setListOpen((v) => !v)} title={listOpen ? '收起播放列表' : '展开播放列表'}>
          {listOpen ? '▾' : '▴'}
        </button>
      </div>
      {listOpen && (
        <div className="audio-bar-list">
          <div className="audio-pl-title">播放列表（{playlist.length}）</div>
          {playlist.length === 0 && <div className="mat-empty">暂无列表。</div>}
          {playlist.map((t, i) => (
            <div
              key={t.path}
              className={'audio-pl-item' + (t.path === media.path ? ' active' : '')}
              onClick={() => setMediaAudio(t)}
              title={t.path}
            >
              <span className="audio-pl-idx">{i + 1}</span>
              <span className="audio-pl-name">{t.name}</span>
              {t.path === media.path && playing && <span className="audio-pl-eq">🎶</span>}
            </div>
          ))}
        </div>
      )}
      <audio
        ref={audioRef}
        onLoadedMetadata={onLoadedMeta}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </div>
  )
}
