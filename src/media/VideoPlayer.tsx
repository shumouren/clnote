import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DiskEntry, MediaSlot } from '../model/types'
import { getMediaProgress, setMediaProgress, mediaProtocolUrl } from '../storage/media'
import { normExt } from './mediaKind'

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 简易 srt → WebVTT（忽略序号行，时间轴逗号改点） */
function srtToVtt(srt: string): string {
  let vtt = 'WEBVTT\n\n'
  const blocks = srt.replace(/\r/g, '').split(/\n\n+/)
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim().length > 0)
    const timeIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeIdx < 0) continue
    const time = lines[timeIdx].replace(/,/g, '.')
    const text = lines.slice(timeIdx + 1).join('\n')
    if (!text) continue
    vtt += `${time}\n${text}\n\n`
  }
  return vtt
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** 媒体库「视频」分栏：自定义 <video> 播放器，倍速 / 全屏 / 字幕 / 记忆播放 */
export default function VideoPlayer({
  slot,
  onClose,
  onRequestNext,
}: {
  slot: MediaSlot
  onClose: () => void
  onRequestNext?: (e: DiskEntry) => void
}) {
  const entry: DiskEntry = slot.entry
  const playlist: DiskEntry[] = slot.playlist ?? []
  const subs: Record<string, DiskEntry> = slot.subs ?? {}

  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | null>(null)
  const restoreRef = useRef<number>(0)
  const blobRef = useRef<string | null>(null)

  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(false)
  const [showSub, setShowSub] = useState(true)
  const [subSrc, setSubSrc] = useState<string | null>(null)
  /** 拖动进度条时的预览位置（0–1000）；拖动中不真正 seek，松手才 seek，避免高频 seek 卡顿 */
  const [dragPct, setDragPct] = useState<number | null>(null)
  /** 控制栏收起（功能键较多时只看画面） */
  const [collapsed, setCollapsed] = useState(false)

  const revokeBlob = () => {
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current)
      blobRef.current = null
    }
  }

  // 切换视频：先读进度，再设置 src 并加载（记忆播放不丢）
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let cancelled = false
    setCur(0)
    setDur(0)
    setPlaying(false)
    getMediaProgress(entry.path)
      .then((p) => {
        if (cancelled) return
        restoreRef.current = p?.position ?? 0
        v.src = mediaProtocolUrl(entry.path)
        v.load()
      })
      .catch(() => {
        if (cancelled) return
        restoreRef.current = 0
        v.src = mediaProtocolUrl(entry.path)
        v.load()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path])

  // 字幕：根据 showSub / subs 计算 <track> 的 src（不重载视频）
  useEffect(() => {
    const sub = subs[entry.path]
    if (!sub || !showSub) {
      setSubSrc(null)
      return
    }
    const url = mediaProtocolUrl(sub.path)
    if (normExt(sub.ext) === 'vtt') {
      revokeBlob()
      setSubSrc(url)
      return
    }
    let cancelled = false
    fetch(url)
      .then((r) => r.text())
      .then((txt) => {
        if (cancelled) return
        const vtt = srtToVtt(txt)
        revokeBlob()
        const burl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
        blobRef.current = burl
        setSubSrc(burl)
      })
      .catch(() => setSubSrc(null))
    return () => {
      cancelled = true
    }
  }, [entry.path, subs, showSub])

  useEffect(() => () => revokeBlob(), [])

  const onLoadedMeta = () => {
    const v = videoRef.current
    if (!v) return
    setDur(v.duration)
    const pos = restoreRef.current
    if (pos > 0 && pos < v.duration) {
      try {
        v.currentTime = pos
      } catch {
        /* 某些格式 seek 受限，忽略 */
      }
    }
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  const onTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    setCur(v.currentTime)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      setMediaProgress({
        mediaPath: entry.path,
        position: v.currentTime,
        duration: v.duration,
        updatedAt: Date.now(),
      }).catch(() => {})
    }, 1000)
  }

  const onEnded = () => {
    if (loop) {
      const v = videoRef.current
      if (v) {
        v.currentTime = 0
        v.play().catch(() => {})
      }
      return
    }
    const idx = playlist.findIndex((p) => p.path === entry.path)
    if (idx >= 0 && idx < playlist.length - 1) onRequestNext?.(playlist[idx + 1])
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().then(() => setPlaying(true)).catch(() => {})
    else {
      v.pause()
      setPlaying(false)
    }
  }

  /** 画面聚焦时的快捷键：空格 播放/暂停，←/→ 快退/快进 5 秒（点画面后生效，不干扰其他输入） */
  const onStageKeyDown = (e: ReactKeyboardEvent) => {
    const v = videoRef.current
    if (!v) return
    if (e.key === ' ') {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      v.currentTime = Math.max(0, v.currentTime - 5)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5)
    }
  }

  const seek = (v2: number) => {
    const v = videoRef.current
    if (!v || !isFinite(v.duration) || v.duration <= 0) return
    v.currentTime = (v2 / 1000) * v.duration
  }

  /** 拖动结束：提交真正的 seek */
  const commitSeek = (pct: number | null) => {
    if (pct == null) return
    seek(pct)
    setDragPct(null)
  }

  const changeSpeed = (s: number) => {
    setSpeed(s)
    if (videoRef.current) videoRef.current.playbackRate = s
  }

  const toggleFullscreen = () => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else el.requestFullscreen().catch(() => {})
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    setMuted((m) => {
      v.muted = !m
      return !m
    })
  }

  const togglePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture()
      }
    } catch {
      /* 画中画不可用时忽略 */
    }
  }

  const idx = playlist.findIndex((p) => p.path === entry.path)
  const prev = () => {
    if (idx > 0) onRequestNext?.(playlist[idx - 1])
  }
  const next = () => {
    if (idx >= 0 && idx < playlist.length - 1) onRequestNext?.(playlist[idx + 1])
  }

  return (
    <div className="video-board">
      <div
        className="video-stage"
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onStageKeyDown}
        onFocus={(e) => {
          // 点画面后聚焦，快捷键即可用；保持焦点样式淡出
          e.currentTarget.style.outline = 'none'
        }}
        title="点画面后可用快捷键：空格 播放/暂停 · ←/→ 快退/快进 5 秒"
      >
        <video
          ref={videoRef}
          className="video-el"
          onLoadedMetadata={onLoadedMeta}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={() => {
            // 点击画面聚焦到舞台，使空格/←/→ 快捷键生效
            wrapRef.current?.focus()
            togglePlay()
          }}
        >
          {subSrc ? (
            <track key={subSrc} kind="subtitles" src={subSrc} srcLang="zh" label="字幕" default />
          ) : null}
        </video>
        {collapsed && (
          <button className="video-expand" onClick={() => setCollapsed(false)} title="展开控制栏">
            ▲
          </button>
        )}
      </div>

      {!collapsed && (
      <>
      <div className="video-controls">
        <div className="video-seek">
          <span className="video-time">{fmt(dragPct != null ? (dragPct / 1000) * dur : cur)}</span>
          <input
            className="video-range"
            type="range"
            min={0}
            max={1000}
            value={dragPct ?? (dur ? (cur / dur) * 1000 : 0)}
            onChange={(e) => setDragPct(Number(e.target.value))}
            onPointerUp={(e) => commitSeek(Number((e.currentTarget as HTMLInputElement).value))}
            onBlur={() => commitSeek(dragPct)}
            title="拖动到目标位置（松开跳转）"
          />
          <span className="video-time">{fmt(dur)}</span>
        </div>
        <div className="video-buttons">
          <button className="audio-btn" onClick={prev} title="上一集">
            ⏮
          </button>
          <button className="audio-btn audio-play" onClick={togglePlay} title={playing ? '暂停' : '播放'}>
            {playing ? '⏸' : '▶'}
          </button>
          <button className="audio-btn" onClick={next} title="下一集">
            ⏭
          </button>
          <select
            className="video-select"
            value={speed}
            onChange={(e) => changeSpeed(Number(e.target.value))}
            title="播放速度"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <button
            className={'audio-btn' + (loop ? ' active' : '')}
            onClick={() => setLoop((v) => !v)}
            title="循环播放"
          >
            🔁
          </button>
          <button
            className={'audio-btn' + (showSub ? ' active' : '')}
            onClick={() => setShowSub((v) => !v)}
            title="字幕开关"
          >
            💬
          </button>
          <button className="audio-btn" onClick={togglePip} title="画中画">
            📌
          </button>
          <button className="audio-btn" onClick={toggleFullscreen} title="全屏">
            ⛶
          </button>
          <button className="audio-btn" onClick={() => setCollapsed(true)} title="收起控制栏（只看画面）">
            ▾
          </button>
          <button className="audio-btn" onClick={onClose} title="关闭此分栏">
            ✕
          </button>
          <span className="video-vol">
            <button className="audio-btn" onClick={toggleMute} title={muted ? '取消静音' : '静音'}>
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
                if (videoRef.current) {
                  videoRef.current.volume = v
                  if (v > 0) videoRef.current.muted = false
                }
              }}
            />
          </span>
        </div>
        <div className="video-meta" title={entry.path}>
          {entry.name}
        </div>
      </div>

      <div className="audio-playlist">
        <div className="audio-pl-title">播放列表（{playlist.length}）</div>
        {playlist.length === 0 && <div className="mat-empty">暂无列表，从左侧文件夹点一个视频开始。</div>}
        {playlist.map((t, i) => (
          <div
            key={t.path}
            className={'audio-pl-item' + (t.path === entry.path ? ' active' : '')}
            onClick={() => onRequestNext?.(t)}
            title={t.path}
          >
            <span className="audio-pl-idx">{i + 1}</span>
            <span className="audio-pl-name">{t.name}</span>
            {subs[t.path] && <span className="audio-pl-sub" title="有字幕">💬</span>}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  )
}
