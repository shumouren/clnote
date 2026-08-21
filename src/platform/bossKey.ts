/**
 * 系统级老板键
 * ---------------------------------------------------------------
 * 浏览器环境没有「最小化窗口」的概念，只能用全屏遮罩遮住内容（见 App 的 boss-hidden）。
 * 桌面端（Tauri）走全局快捷键插件，按下后调用窗口 API 真正最小化到任务栏，再按一次恢复；
 * 因为注册的是系统级快捷键，即使窗口已经最小化（失焦）也能收到按键，恢复照常工作。
 *
 * 返回 true 表示已在 Tauri 环境注册成功；false 表示非 Tauri 或注册失败（调用方据此回退到遮罩方案）。
 *
 * 注意：Tauri 相关模块用动态 import 引入，确保浏览器构建不会加载这些仅桌面端可用的依赖。
 */

import { isTauri } from '../storage/location'

let registeredKey: string | null = null

export async function setupBossKey(key: string): Promise<boolean> {
  if (!isTauri()) return false
  // 按键没变且已注册：无需重复
  if (registeredKey === key) return true
  try {
    // 先注销旧键（用户改了老板键），忽略「未注册」报错
    if (registeredKey) {
      try {
        const { unregister } = await import('@tauri-apps/plugin-global-shortcut')
        await unregister(registeredKey)
      } catch {
        /* 旧键本来就未注册，忽略 */
      }
    }
    const { register } = await import('@tauri-apps/plugin-global-shortcut')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await register(key, async (event) => {
      // 全局快捷键的回调在按下与松开时各触发一次，只在按下时切换，避免一按一松导致两次最小化
      if (event.state !== 'Pressed') return
      const w = getCurrentWindow()
      const min = await w.isMinimized()
      if (min) await w.unminimize()
      else await w.minimize()
    })
    registeredKey = key
    return true
  } catch (e) {
    console.warn('[老板键] 全局快捷键注册失败，已在浏览器回退为遮罩方案：', e)
    registeredKey = null
    return false
  }
}
