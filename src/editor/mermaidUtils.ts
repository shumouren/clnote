// Mermaid 流程图相关的小工具：复制文本、SVG 转 PNG、下载 Blob。
// 既给正文内联的流程图块用，也给灯箱里的放大视图用。

/** 复制文本到剪贴板，返回是否成功（带 execCommand 兜底） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 走兜底方案 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** 从 SVG 字符串里读出尺寸（优先 viewBox，其次 width/height 属性） */
function getSvgSize(svg: string): { w: number; h: number } {
  const vb = svg.match(/viewBox\s*=\s*["']\s*-?[\d.]+\s+-?[\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i)
  if (vb) return { w: parseFloat(vb[1]), h: parseFloat(vb[2]) }
  const wm = svg.match(/<svg[^>]*\bwidth\s*=\s*["']?\s*([\d.]+)/i)
  const hm = svg.match(/<svg[^>]*\bheight\s*=\s*["']?\s*([\d.]+)/i)
  if (wm && hm) return { w: parseFloat(wm[1]), h: parseFloat(hm[1]) }
  return { w: 800, h: 600 }
}

/** 确保 svg 根节点带 width/height，避免绘制到 canvas 时尺寸为 0 */
function withSizedSvg(svg: string, w: number, h: number): string {
  if (!/<svg[\s>/]/.test(svg)) return svg
  let out = svg
  if (!/\bwidth\s*=/.test(out)) {
    out = out.replace(/(<svg[^>]*?)>/i, `$1 width="${w}" height="${h}">`)
  }
  return out
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('SVG 加载失败'))
    img.src = src
  })
}

/** 把 Mermaid 渲染出的 SVG 转成 PNG Blob（scale 为放大倍数，保证清晰度） */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const { w, h } = getSvgSize(svg)
  const sized = withSizedSvg(svg, w, h)
  const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!png) throw new Error('导出 PNG 失败')
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 触发浏览器下载一个 Blob */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 一步到位：SVG → PNG 并下载 */
export async function exportSvgAsPng(svg: string, filename: string, scale = 2): Promise<void> {
  const blob = await svgToPngBlob(svg, scale)
  downloadBlob(blob, filename)
}
