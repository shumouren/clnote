import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { BookProgress, DiskEntry } from '../model/types'
import { mediaProtocolUrl } from '../storage/media'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** PDF 阅读器：pdf.js 将每页渲染到 canvas，纵向滚动；进度按滚动位置记忆；字号经 scale 缩放 */
export default function PdfReader({
  book,
  progress,
  onProgress,
  fontSize = 1,
}: {
  book: DiskEntry
  progress: BookProgress | null
  onProgress: (p: { percent: number; cfi?: string }) => void
  fontSize?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const lastPct = useRef(-1)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    let cancelled = false
    lastPct.current = -1
    container.innerHTML = ''
    setLoading(true)

    const report = () => {
      const max = container.scrollHeight - container.clientHeight
      const pct = max > 0 ? (container.scrollTop / max) * 100 : 0
      if (Math.abs(pct - lastPct.current) < 0.5) return
      lastPct.current = pct
      onProgress({ percent: pct })
    }
    const onScroll = () => report()

    const load = async () => {
      const pdf = await pdfjsLib.getDocument({ url: mediaProtocolUrl(book.path) }).promise
      if (cancelled) return
      setNumPages(pdf.numPages)
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1.4 * fontSize })
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.height = 'auto'
        canvas.style.marginBottom = '12px'
        canvas.style.boxShadow = '0 1px 6px rgba(0,0,0,.18)'
        await page.render({ canvas, viewport }).promise
        if (cancelled) return
        container.appendChild(canvas)
      }
      // 恢复上次阅读位置
      const max = container.scrollHeight - container.clientHeight
      if (progress && max > 0) {
        container.scrollTop = (progress.percent / 100) * max
      }
      lastPct.current = -1
      report()
      setLoading(false)
    }
    load().catch((e) => {
      console.error('[PdfReader] 加载失败：', e)
      container.innerHTML = '<div class="reading-unsupported">PDF 加载失败，请确认文件未损坏。</div>'
      setLoading(false)
    })

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelled = true
      container.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, fontSize])

  return (
    <div className="pdf-wrap">
      <div className="pdf-meta">
        {loading ? '加载中…' : `共 ${numPages} 页`}
      </div>
      <div className="pdf-scroll" ref={scrollRef} />
    </div>
  )
}
