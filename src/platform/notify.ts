/**
 * 轻量通知工具
 * ---------------------------------------------------------------
 * 不依赖任何 Tauri 插件，纯前端实现，桌面端与浏览器端通用：
 *   - showNotification：用标准 Web Notifications API 弹系统通知（Tauri WebView 同样支持）。
 *     若用户未授权或环境不支持，则静默失败，由调用方用 toast / 提示音兜底。
 *   - playBeep：用 Web Audio 合成一声短「滴」，无需音频文件；在阶段切换时给明确听觉反馈。
 *
 * 注意：AudioContext 在部分浏览器需用户手势后才可发声；这里每次都尝试 resume()，
 * 即便番茄钟在无人操作时切阶段，也能尽量出声（无声则忽略，不影响主流程）。
 */

/** 系统通知（Web Notifications API），授权失败时静默忽略 */
export function showNotification(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      new Notification(title, { body })
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission()
        .then((p) => {
          if (p === 'granted') new Notification(title, { body })
        })
        .catch(() => {
          /* 用户拒绝或不支持，忽略 */
        })
    }
  } catch {
    /* 非安全上下文（非 https / 非 Tauri）可能抛错，忽略 */
  }
}

/** 合成一声短「滴」，给番茄钟阶段切换听觉反馈；不支持 Web Audio 时忽略 */
export function playBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    const t = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    osc.start(t)
    osc.stop(t + 0.42)
    osc.onended = () => {
      try {
        ctx.close()
      } catch {
        /* ignore */
      }
    }
    // 部分浏览器需 resume 才会发声
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  } catch {
    /* 不支持则忽略 */
  }
}
