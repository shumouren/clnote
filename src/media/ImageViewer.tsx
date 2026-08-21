import { useEffect, useRef, useState } from 'react'
import type { DiskEntry, MediaSlot } from '../model/types'
import { mediaProtocolUrl } from '../storage/media'

/**
 * 媒体库「图片」分栏：看图器。
 * 常见功能：滚轮缩放 / 按钮缩放、适应窗口 ↔ 原始大小、旋转 90°、上一张 / 下一张（同文件夹图片）、
 * 尺寸与序号显示；支持全屏与幻灯片自动播放。
 */
export default function ImageViewer({
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
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  const [rotate, setRotate] = useState(0)
  const [failed, setFailed] = useState(false)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  /** 幻灯片自动播放 */
  const [auto, setAuto] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const idx = playlist.findIndex((p) => p.path === entry.path)
  const prev = () => {
    if (idx > 0) onRequestNext?.(playlist[idx - 1])
  }
  const next = () => {
    if (idx >= 0 && idx < playlist.length - 1) onRequestNext?.(playlist[idx + 1])
  }

  // 幻灯片：每 3 秒自动下一张（到尾循环回第一张）
  useEffect(() => {
    if (!auto || playlist.length === 0) return
    const t = window.setInterval(() => {
      const i = playlist.findIndex((p) => p.path === entry.path)
      if (i >= 0 && i < playlist.length - 1) onRequestNext?.(playlist[i + 1])
      else onRequestNext?.(playlist[0])
    }, 3000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, entry.path, playlist])

  const toggleFullscreen = () => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else el.requestFullscreen().catch(() => {})
  }

  const zoomBy = (f: number) => {
    setFit(false)
    setZoom((z) => Math.max(0.05, Math.min(8, z * f)))
  }
  const resetView = () => {
    setFit(true)
    setZoom(1)
    setRotate(0)
  }

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
  }

  return (
    <div className="image-viewer">
      <div className="image-bar">
        <button className="tb-btn" onClick={onClose} title="关闭此分栏">
          ✕
        </button>
        <span className="image-title" title={entry.path}>
          🖼 {entry.name}
        </span>
        {nat && (
          <span className="image-size">
            {nat.w} × {nat.h} · {Math.round(zoom * 100)}%
          </span>
        )}
        {playlist.length > 0 && (
          <span className="image-idx">
            {idx + 1} / {playlist.length}
          </span>
        )}
        <span className="tb-spacer" />
        <button className="tb-btn" onClick={() => onRequestNext?.(playlist[0])} title="跳回第一张" disabled={!playlist.length}>
          ⏮
        </button>
        <button className="tb-btn" onClick={prev} title="上一张" disabled={idx <= 0}>
          ◀
        </button>
        <button className="tb-btn" onClick={next} title="下一张" disabled={idx < 0 || idx >= playlist.length - 1}>
          ▶
        </button>
        <span className="img-gap" />
        <button className="tb-btn" onClick={() => zoomBy(1 / 1.2)} title="缩小 (滚轮)" disabled={fit}>
          −
        </button>
        <button className="tb-btn" onClick={() => zoomBy(1.2)} title="放大 (滚轮)" disabled={fit}>
          ＋
        </button>
        <button
          className={'tb-btn' + (fit ? ' active' : '')}
          onClick={() => {
            setFit(true)
            setZoom(1)
          }}
          title="适应窗口"
        >
          ⛶
        </button>
        <button className="tb-btn" onClick={() => setRotate((r) => (r + 90) % 360)} title="旋转 90°">
          ↻
        </button>
        <button
          className={'tb-btn' + (auto ? ' active' : '')}
          onClick={() => setAuto((v) => !v)}
          title="幻灯片：每 3 秒自动播放下一张"
        >
          ▶ 自动播放
        </button>
        <button className="tb-btn" onClick={toggleFullscreen} title="全屏">
          ⛶
        </button>
        <button className="tb-btn" onClick={resetView} title="重置视图">
          ⟲
        </button>
      </div>

      <div className="image-stage" ref={wrapRef} onWheel={onWheel}>
        {failed ? (
          <div className="pane-empty">
            无法加载图片：{entry.name}
            <br />
            （svg / avif 等格式受浏览器支持限制时可能无法显示）
          </div>
        ) : (
          <img
            ref={imgRef}
            className="image-el"
            src={mediaProtocolUrl(entry.path)}
            alt={entry.name}
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget
              setNat({ w: el.naturalWidth, h: el.naturalHeight })
              setFailed(false)
            }}
            onError={() => setFailed(true)}
            style={{
              transform: `rotate(${rotate}deg) scale(${zoom})`,
              maxWidth: fit ? '100%' : 'none',
              maxHeight: fit ? '100%' : 'none',
              width: fit ? 'auto' : nat ? nat.w : 'auto',
              height: fit ? 'auto' : nat ? nat.h : 'auto',
            }}
          />
        )}
      </div>
    </div>
  )
}
