/**
 * Tauri 运行时探测 + invoke 封装
 * ---------------------------------------------------------------
 * 与 fs.ts 的探测逻辑一致：仅在检测到 Tauri 注入的全局对象时才返回可用的
 * invoke，否则返回 null（此时调用方应回退到浏览器本地存储，如 IndexedDB）。
 * 这样同一份前端代码既能在桌面端（Tauri）走 SQLite，也能在 `npm run dev`
 * 的普通浏览器里走 IndexedDB 回退，保证开发期依旧可演示。
 */

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w
}

export function getInvoke(): InvokeFn | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: InvokeFn }; invoke?: InvokeFn }
    __TAURI_INTERNALS__?: { invoke?: InvokeFn }
  }
  return (
    w.__TAURI__?.core?.invoke ??
    w.__TAURI__?.invoke ??
    w.__TAURI_INTERNALS__?.invoke ??
    null
  )
}

/** 返回可用的 invoke，否则 null（此时调用方应回退本地存储） */
export function tauriInvoke(): InvokeFn | null {
  return isTauri() ? getInvoke() : null
}
