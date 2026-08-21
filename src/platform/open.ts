/**
 * 打开本地文件夹 / 浏览器链接的平台封装（Tauri 原生）
 * ---------------------------------------------------------------
 * 静态导入 @tauri-apps/plugin-opener（插件已在 package.json / Cargo 中安装并注册，
 * capabilities 已授权 opener:allow-open-url / opener:allow-open-path / opener:allow-reveal-item-in-dir）。
 * 严禁使用动态 import 裸模块名——浏览器/WebView 无法解析，会直接抛错并永远走回退。
 */
import { openUrl as tauriOpenUrl, openPath as tauriOpenPath } from '@tauri-apps/plugin-opener'
import { toast } from '../ui/toast'

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

/** 补全链接协议，确保 http(s) 能正确唤起系统浏览器 */
function normalizeUrl(u: string): string {
  const s = u.trim()
  if (!s) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s // 已有协议（http: / https: / mailto: 等）
  if (s.startsWith('//')) return 'https:' + s
  return 'https://' + s
}

/** 用系统默认浏览器打开一个链接 */
export async function openUrl(url: string): Promise<void> {
  const u = normalizeUrl(url)
  if (!u) return
  try {
    await tauriOpenUrl(u)
    return
  } catch (e) {
    console.error('[openUrl] 原生打开失败：', e)
    // 原生失败时回退：尝试在 WebView 内打开（部分环境允许）
    try {
      const w = window.open(u, '_blank', 'noopener,noreferrer')
      if (w) return
    } catch {
      /* 忽略 */
    }
    toast('打开链接失败：' + errMsg(e))
  }
}

/** 在文件管理器中打开本地文件夹（或本地文件） */
export async function openFolder(path: string): Promise<void> {
  const p = path.trim()
  if (!p) return
  try {
    await tauriOpenPath(p)
    return
  } catch (e) {
    console.error('[openFolder] 原生打开失败：', e)
    try {
      await navigator.clipboard.writeText(p)
      toast('无法打开文件夹（已复制路径）：' + errMsg(e))
    } catch {
      toast('无法打开本地文件夹：' + p)
    }
  }
}
