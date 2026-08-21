/**
 * 媒体库：扩展名归类与工具
 * ---------------------------------------------------------------
 * 合并后的「媒体库」把书籍 / 音乐 / 视频统一在一个库里浏览，按文件扩展名判断用哪个查看器打开。
 * 这里集中维护扩展名白名单，供侧边栏（构建播放列表 / 字幕匹配）与 store（openMedia 分派）复用。
 */
import type { DiskEntry, MediaKind } from '../model/types'
import type { TreeNode } from '../platform/diskTree'

/** 书籍阅读器（epub.js / pdf.js） */
export const BOOK_EXT = ['epub', 'pdf']
/** 纯文本阅读器（txt / md / mdown / markdown） */
export const TEXT_EXT = ['txt', 'md', 'mdown', 'markdown']
/** 音频 */
export const AUDIO_EXT = [
  'mp3', 'flac', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'wma', 'opus', 'mid', 'midi',
]
/** 视频 */
export const VIDEO_EXT = [
  'mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'flv', 'wmv', 'rmvb', '3gp', 'ogv',
]
/** 图片（查看器：缩放 / 旋转 / 上一张下一张） */
export const IMAGE_EXT = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tif', 'tiff',
]
/** 字幕（同名 .vtt 直接挂；.srt 在播放端转 vtt） */
export const SUB_EXT = ['vtt', 'srt']

/** 把扩展名（可能带点）归一化为小写无点形式 */
export function normExt(ext: string): string {
  return ext.toLowerCase().replace(/^\./, '')
}

/** 按扩展名判断媒体种类（书 / 文本 / 音频 / 视频 / 图片） */
export function mediaKindOf(ext: string): MediaKind {
  const e = normExt(ext)
  if (BOOK_EXT.includes(e)) return 'book'
  if (TEXT_EXT.includes(e)) return 'text'
  if (AUDIO_EXT.includes(e)) return 'audio'
  if (VIDEO_EXT.includes(e)) return 'video'
  if (IMAGE_EXT.includes(e)) return 'image'
  return 'text'
}

export function isAudioExt(ext: string): boolean {
  return AUDIO_EXT.includes(normExt(ext))
}
export function isVideoExt(ext: string): boolean {
  return VIDEO_EXT.includes(normExt(ext))
}
export function isImageExt(ext: string): boolean {
  return IMAGE_EXT.includes(normExt(ext))
}
export function isSubExt(ext: string): boolean {
  return SUB_EXT.includes(normExt(ext))
}

/* ---- 字幕同名匹配工具 ---- */
export function dirOf(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/[^\/]*$/, '')
}
export function baseOf(p: string): string {
  const f = p.split(/[\\/]/).pop() || p
  const i = f.lastIndexOf('.')
  return i < 0 ? f : f.slice(0, i)
}

/** 收集某挂载文件夹下的全部媒体 + 同名视频字幕，供播放列表 / 自动挂字幕 / 图片轮播 */
export function collectMedia(
  nodes: TreeNode[],
): {
  videos: DiskEntry[]
  audios: DiskEntry[]
  images: DiskEntry[]
  subs: Record<string, DiskEntry>
} {
  const allV: DiskEntry[] = []
  const allA: DiskEntry[] = []
  const allI: DiskEntry[] = []
  const allS: DiskEntry[] = []
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.entry.isDir) walk(n.children)
      else {
        const ext = normExt(n.entry.ext)
        if (isVideoExt(ext)) allV.push(n.entry)
        else if (isAudioExt(ext)) allA.push(n.entry)
        else if (isImageExt(ext)) allI.push(n.entry)
        else if (isSubExt(ext)) allS.push(n.entry)
      }
    }
  }
  walk(nodes)
  // 字幕按目录分组，给每个视频找同名 .vtt / .srt
  const byDir = new Map<string, DiskEntry[]>()
  for (const s of allS) {
    const d = dirOf(s.path)
    if (!byDir.has(d)) byDir.set(d, [])
    byDir.get(d)!.push(s)
  }
  const subs: Record<string, DiskEntry> = {}
  for (const v of allV) {
    const d = dirOf(v.path)
    const b = baseOf(v.path)
    const found = (byDir.get(d) ?? []).find((s) => baseOf(s.path) === b)
    if (found) subs[v.path] = found
  }
  return { videos: allV, audios: allA, images: allI, subs }
}

/** 拍平整棵文件树为有序的音频列表（目录优先、同名排序），供音乐播放列表 */
export function flattenAudio(nodes: TreeNode[]): DiskEntry[] {
  const acc: DiskEntry[] = []
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.entry.isDir) walk(n.children)
      else if (isAudioExt(n.entry.ext)) acc.push(n.entry)
    }
  }
  walk(nodes)
  return acc
}
