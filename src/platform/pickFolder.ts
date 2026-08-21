/**
 * 选择本地文件夹的平台封装
 * ---------------------------------------------------------------
 * 在 Tauri 下用 @tauri-apps/plugin-dialog 的 open({ directory: true }) 选取真实
 * 绝对路径；非 Tauri（浏览器）环境无法取得绝对路径，退化为让用户手动粘贴路径。
 * 同样使用静态导入（插件已安装并注册），避免裸模块名动态导入在 WebView 中无法解析。
 */
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { toast } from '../ui/toast'
import { promptAsync } from './dialog'

/** 弹出文件夹选择框，返回绝对路径；取消或失败返回 null */
export async function pickFolder(): Promise<string | null> {
  try {
    const res = await dialogOpen({ directory: true, multiple: false })
    if (typeof res === 'string') return res
    if (Array.isArray(res)) return (res[0] as string) ?? null
    return null
  } catch (e) {
    console.error('[pickFolder] 选择文件夹失败：', e)
    toast('选择文件夹失败：' + (e instanceof Error ? e.message : String(e)))
  }
  // 回退：让用户手动粘贴路径
  const p = await promptAsync('请输入本地文件夹路径（例如 D:\\Projects 或 /Users/me/Documents）', '')
  return p && p.trim() ? p.trim() : null
}

/**
 * 多选文件夹：阅读 / 音乐 / 视频库挂载多个本地文件夹用。
 * 返回绝对路径数组；取消或失败返回空数组。
 */
export async function pickFolders(): Promise<string[]> {
  try {
    const res = await dialogOpen({ directory: true, multiple: true })
    if (typeof res === 'string') return [res]
    if (Array.isArray(res)) return (res as string[]).filter(Boolean)
    return []
  } catch (e) {
    console.error('[pickFolders] 选择文件夹失败：', e)
    toast('选择文件夹失败：' + (e instanceof Error ? e.message : String(e)))
  }
  return []
}
