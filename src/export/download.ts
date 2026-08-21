/** 文件落盘：浏览器用 a[download]，Tauri WebView 同样走这条路（由系统下载接管） */

/** 导出文件落盘位置提示：浏览器与桌面端均通过 a[download] 落到系统「下载」文件夹 */
export function downloadLocationHint(): string {
  if (typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>
    if ('__TAURI_INTERNALS__' in w || '__TAURI__' in w) {
      return '（已保存到系统「下载」文件夹）'
    }
  }
  return '（已保存到浏览器「下载」文件夹）'
}

/** 当前是否运行在 Tauri 桌面环境（桌面端可弹系统「另存为」对话框指定精确路径） */
export function isTauriEnv(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w
}

/**
 * 把文本以「系统另存为」对话框保存到本地磁盘（桌面端），返回用户选定的绝对路径；
 * 用户在对话框取消时返回 null。非桌面端或调用失败时退回 a[download] 下载（返回 null）。
 * 用于整库备份等"需要知道确切落盘位置"的场景。
 */
export async function saveTextFileWithDialog(
  filename: string,
  text: string,
  mime: string,
): Promise<string | null> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: filename })
    if (!path) return null
    const { invoke } = await import('@tauri-apps/api/core')
    const bytes = new TextEncoder().encode(text)
    await invoke('save_file', { path, contents: bytes })
    return path
  } catch {
    /* 非 Tauri 或调用失败：退回浏览器下载 */
    downloadText(filename, text, mime)
    return null
  }
}

/** 别名：与 saveBlobWithDialog 配对，供导出执行器统一落盘调用 */
export const saveTextWithDialog = saveTextFileWithDialog

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 立刻 revoke 在部分浏览器会中断下载，延迟释放
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * 把 Blob 以「系统另存为」对话框保存到本地磁盘（桌面端），返回用户选定的绝对路径；
 * 用户在对话框取消时返回 null。非桌面端或调用失败时退回 a[download] 下载（返回 null）。
 * 用于 EPUB / ZIP / 图片等二进制导出，让用户每次都能指定精确保存位置。
 */
export async function saveBlobWithDialog(filename: string, blob: Blob): Promise<string | null> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: filename })
    if (!path) return null
    const { invoke } = await import('@tauri-apps/api/core')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await invoke('save_file', { path, contents: bytes })
    return path
  } catch {
    /* 非 Tauri 或调用失败：退回浏览器下载 */
    downloadBlob(filename, blob)
    return null
  }
}

export function downloadText(filename: string, text: string, mime: string): void {
  // 加 BOM，避免 Windows 记事本 / Excel 打开中文乱码
  const needBom = mime.startsWith('text/') || mime.includes('json')
  const parts = needBom ? ['\uFEFF', text] : [text]
  downloadBlob(filename, new Blob(parts, { type: mime }))
}

/** 把 DataURL（图片/文件）下载到本地：优先用 fetch(dataUrl) 转 Blob，失败退回 base64 解析 */
export async function downloadDataUrl(filename: string, dataUrl: string): Promise<void> {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    downloadBlob(filename, blob)
    return
  } catch {
    /* 个别环境 fetch(dataUrl) 不可用，退回传统 base64 解析 */
  }
  const [head, body] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] || 'application/octet-stream'
  const bin = atob(body)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  downloadBlob(filename, new Blob([arr], { type: mime }))
}

/** dataURL → 字节数组 + MIME（用于导出素材时写入本地文件） */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const idx = dataUrl.indexOf(',')
  const head = idx >= 0 ? dataUrl.slice(0, idx) : ''
  const body = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
  const mime = /:(.*?);/.exec(head)?.[1] || 'application/octet-stream'
  let bin = ''
  try {
    bin = atob(body)
  } catch {
    bin = body
  }
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime }
}

/**
 * 把 dataURL（图片 / 文件）导出到本地磁盘：
 *  - Tauri 环境：弹出系统「另存为」对话框，选定后由 Rust 命令 `save_file` 写入
 *    （可靠，且用户可自选保存路径；绕开 WebView 对 a[download] 的静默拦截）；
 *  - 非 Tauri（纯浏览器）环境：退回 a[download] 下载。
 * 返回 true 表示已处理；用户在「另存为」对话框取消时返回 false。
 */
export async function exportDataUrlFile(filename: string, dataUrl: string): Promise<boolean> {
  const { bytes, mime } = dataUrlToBytes(dataUrl)
  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: filename })
    if (!path) return false
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_file', { path, contents: bytes })
    return true
  } catch {
    /* 非 Tauri 或调用失败：退回浏览器下载 */
    try {
      downloadBlob(filename, new Blob([bytes as unknown as BlobPart], { type: mime }))
    } catch {
      /* 忽略 */
    }
    return true
  }
}

/** 弹出系统文件选择框读取一个文本文件 */
export function pickTextFile(accept = '.json'): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top = '0'
    input.style.width = '1px'
    input.style.height = '1px'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve({ name: f.name, text: String(reader.result ?? '') })
      reader.onerror = () => resolve(null)
      reader.readAsText(f, 'utf-8')
    }
    document.body.appendChild(input)
    input.click()
    document.body.removeChild(input)
  })
}

/** 多选文本文件读取（用于批量导入） */
export function pickFiles(
  accept: string,
  multiple = true,
): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top = '0'
    input.style.width = '1px'
    input.style.height = '1px'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'
    const cleanup = () => input.remove()
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (!files.length) {
        cleanup()
        resolve([])
        return
      }
      Promise.all(
        files.map(
          (f) =>
            new Promise<{ name: string; text: string }>((res) => {
              const r = new FileReader()
              r.onload = () => res({ name: f.name, text: String(r.result ?? '') })
              r.onerror = () => res({ name: f.name, text: '' })
              r.readAsText(f, 'utf-8')
            }),
        ),
      ).then((t) => {
        cleanup()
        resolve(t)
      })
    }
    document.body.appendChild(input)
    input.click()
  })
}

/** 把图片 DataURL 压缩到合适体积：等比缩放到 maxDim 以内，转 JPEG。
 *  背景图若原图过大，直接存会撑爆 localStorage，且超长 DataURL 作为 CSS
 *  变量值可能被判定为非法，导致 background-image 整体失效（背景不显示）。 */
function compressImageDataUrl(src: string, maxDim = 1920, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('no 2d context'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      // 背景图不需要透明通道，统一转 JPEG 体积更小
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/**
 * 弹系统文件选择框，返回选中的 File 列表。
 * 关键修复：隐藏方式不能用 display:none——部分 WebView2 / Chromium 下对
 * display:none 的 file input 调 click() 不会弹出选择框；改为移出视口但不隐藏，
 * 保证在用户手势内可靠触发。
 */
function openFilePicker(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top = '0'
    input.style.width = '1px'
    input.style.height = '1px'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'
    const cleanup = () => input.remove()
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      cleanup()
      resolve(files)
    }
    // 极少数环境点击后未弹窗（极端情况），兜底：用户取消/失焦也结束
    input.oncancel = () => {
      cleanup()
      resolve([])
    }
    document.body.appendChild(input)
    // 必须在用户手势（点击）的同步调用栈内触发
    input.click()
  })
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

/** 选择一张图片并读成 DataURL（用于背景图 / 素材 / 编辑器插入）。
 *  - 默认压缩到 1920px JPEG，避免超大图撑爆 localStorage 或作为 CSS 变量值时溢出；
 *  - 传 maxDim / quality 可放宽上限（如素材库、编辑器插入保留更高清晰度）；
 *  - 不支持压缩的环境会退回原图，不会阻断功能。 */
export function pickImageFile(opts?: {
  maxDim?: number
  quality?: number
}): Promise<{ name: string; dataUrl: string } | null> {
  const maxDim = opts?.maxDim ?? 1920
  const quality = opts?.quality ?? 0.82
  return openFilePicker('image/*', false).then(async (files) => {
    const f = files[0]
    if (!f) return null
    const src = await readFileAsDataURL(f)
    try {
      const dataUrl = await compressImageDataUrl(src, maxDim, quality)
      return { name: f.name, dataUrl }
    } catch {
      // 压缩失败则退回原图，至少不阻断功能
      return { name: f.name, dataUrl: src }
    }
  })
}

/** 素材库「文件」类型：从本地选择任意文件，读成 DataURL 保存（文件名单独记录） */
export function pickFile(): Promise<{
  name: string
  dataUrl: string
  size: number
} | null> {
  return openFilePicker('*/*', false).then(async (files) => {
    const f = files[0]
    if (!f) return null
    const dataUrl = await readFileAsDataURL(f)
    return { name: f.name, dataUrl, size: f.size }
  })
}

/** 素材库 / 编辑器插入：保留较高清晰度（4096px），又不至于让笔记体积失控 */
export const pickHighResImage = () => pickImageFile({ maxDim: 4096, quality: 0.9 })

/** 素材库图片：保留原始清晰度（不压缩），用于素材完整展示与导出 */
export function pickRawImage(): Promise<{ name: string; dataUrl: string } | null> {
  return openFilePicker('image/*', false).then(async (files) => {
    const f = files[0]
    if (!f) return null
    const dataUrl = await readFileAsDataURL(f)
    return { name: f.name, dataUrl }
  })
}

export function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}`
}

export function dateStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
