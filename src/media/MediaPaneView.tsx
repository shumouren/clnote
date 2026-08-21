import { useStore } from '../store/useStore'
import type { MediaSlot } from '../model/types'
import BookView from './BookView'
import VideoPlayer from './VideoPlayer'
import ImageViewer from './ImageViewer'

/**
 * 媒体分栏统一分派：书 / 文本 → BookView，视频 → VideoPlayer，图片 → ImageViewer，
 * 音频 → 提示看底部常驻播放条。挂在主工作区（WorkArea）的分栏里，与笔记共用同一套分栏。
 */
export default function MediaPaneView({
  slot,
  paneId,
  onClose,
}: {
  slot: MediaSlot
  paneId: 'left' | 'right'
  onClose: () => void
}) {
  const openMedia = useStore((s) => s.openMedia)

  if (slot.kind === 'audio') {
    return (
      <div className="pane-empty">
        🎵 音频正在底部常驻播放条播放，可边听边在分栏里看书 / 看视频 / 看图片。
      </div>
    )
  }
  if (slot.kind === 'video') {
    return (
      <VideoPlayer
        slot={slot}
        onClose={onClose}
        onRequestNext={(e) => openMedia(e, { pane: paneId, playlist: slot.playlist, subs: slot.subs })}
      />
    )
  }
  if (slot.kind === 'image') {
    return (
      <ImageViewer
        slot={slot}
        onClose={onClose}
        onRequestNext={(e) => openMedia(e, { pane: paneId, playlist: slot.playlist })}
      />
    )
  }
  return <BookView slot={slot} onClose={onClose} />
}
