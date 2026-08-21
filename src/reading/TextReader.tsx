import { useEffect, useRef, useState } from 'react'
import type { BookProgress, DiskEntry } from '../model/types'
import { readFileBytes, mediaProtocolUrl } from '../storage/media'
import { tauriInvoke } from '../storage/tauriRuntime'

/** 解码字节：优先 UTF-8，出现乱码替换符则回退 GBK（国内 txt 常见编码） */
function decodeBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch {
      return utf8
    }
  }
  return utf8
}

/** 纯文本 / Markdown 阅读器：读取字节解码为文本，纵向滚动；进度按滚动位置记忆。
 *  读取优先走 media 协议 fetch（二进制直接进 Uint8Array），避免 invoke 把大字节数组
 *  序列化成 number[] 传回 JS 的开销（大文本文件打开更快）；fetch 失败再回退 read_file_bytes。 */
export default function TextReader({
  book,
  progress,
  onProgress,
  fontSize = 15,
  bg,
  color,
  font,
}: {
  book: DiskEntry
  progress: BookProgress | null
  onProgress: (p: { percent: number; cfi?: string }) => void
  fontSize?: number
  /** 阅读主题：背景色 / 文字色 / 字体（纸感 / 夜间 / 衬线） */
  bg?: string
  color?: string
  font?: string
}) {
  const scrollRef = useRef<HTMLPreElement>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const lastPct = useRef(-1)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const load = async (): Promise<string> => {
      if (tauriInvoke()) {
        try {
          const resp = await fetch(mediaProtocolUrl(book.path))
          if (resp.ok) {
            const buf = new Uint8Array(await resp.arrayBuffer())
            return decodeBytes(buf)
          }
        } catch {
          /* 回退到命令通道 */
        }
      }
      return decodeBytes(await readFileBytes(book.path))
    }
    load()
      .then((t) => {
        if (!cancelled) setText(t)
      })
      .catch((e) => {
        if (!cancelled) setText('读取失败：' + (e instanceof Error ? e.message : String(e)))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [book.path])

  // 渲染文本后：恢复进度 + 绑定滚动上报
  useEffect(() => {
    const el = scrollRef.current
    if (!el || loading) return
    const max = el.scrollHeight - el.clientHeight
    if (progress && max > 0) {
      el.scrollTop = (progress.percent / 100) * max
    }
    const onScroll = () => {
      const m = el.scrollHeight - el.clientHeight
      const pct = m > 0 ? (el.scrollTop / m) * 100 : 0
      if (Math.abs(pct - lastPct.current) < 0.5) return
      lastPct.current = pct
      onProgress({ percent: pct })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, loading])

  return (
    <div className="text-wrap">
      {loading ? (
        <div className="reading-unsupported">加载中…</div>
      ) : (
        <pre
          className="text-view"
          ref={scrollRef}
          style={{ fontSize, background: bg || undefined, color: color || undefined, fontFamily: font || undefined }}
        >
          {text}
        </pre>
      )}
    </div>
  )
}
