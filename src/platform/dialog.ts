/**
 * 跨平台确认/提示/输入对话框
 * ---------------------------------------------------------------
 * Tauri v2 的 WebView 会把 window.confirm/alert 重写为异步的 IPC 调用，
 * 直接 `if (!confirm(...))` 会因为拿到的是 Promise（永远为真）而跳过确认，
 * 导致删除等操作在 Tauri 下“无确认直接执行”。这里统一封装为 async 版本：
 *   - Tauri 环境：使用 @tauri-apps/plugin-dialog 的原生对话框
 *   - 浏览器环境（vite dev）：回退到原生 window.confirm/alert/prompt
 * 调用处必须用 `await` 获取结果。
 */
import { confirm as tauriConfirm, message as tauriMessage } from '@tauri-apps/plugin-dialog'

function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

/** 确认框：返回用户是否点击“确定” */
export async function confirmAsync(message: string, title = '提示'): Promise<boolean> {
  if (isTauri()) {
    try {
      return await tauriConfirm(message, { title })
    } catch {
      return false
    }
  }
  return window.confirm(message)
}

/** 提示框（仅“确定”） */
export async function alertAsync(message: string, title = '提示'): Promise<void> {
  if (isTauri()) {
    try {
      await tauriMessage(message, { title })
    } catch {
      /* 忽略 */
    }
    return
  }
  window.alert(message)
}

/** 输入框：返回用户输入的字符串；取消返回 null */
export async function promptAsync(message: string, defaultValue = ''): Promise<string | null> {
  if (isTauri()) {
    return domPrompt(message, defaultValue)
  }
  const r = window.prompt(message, defaultValue)
  return r === null ? null : r
}

/**
 * Tauri 下没有原生 prompt，用轻量 DOM 模态框代替（不依赖 React）。
 */
function domPrompt(message: string, defaultValue: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.45);font-family:system-ui,sans-serif;'

    const box = document.createElement('div')
    box.style.cssText =
      'min-width:300px;max-width:90vw;padding:18px 20px;border-radius:12px;' +
      'background:var(--bg,rgb(255,255,255));color:var(--text,#222);' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.3);'

    const p = document.createElement('div')
    p.textContent = message
    p.style.cssText = 'margin-bottom:12px;font-size:14px;line-height:1.5;'

    const input = document.createElement('input')
    input.type = 'text'
    input.value = defaultValue
    input.style.cssText =
      'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;font-size:14px;' +
      'border:1px solid var(--line,rgba(0,0,0,0.15));background:var(--bg,rgb(255,255,255));color:var(--text,#222);'

    const btns = document.createElement('div')
    btns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;'

    const cancel = document.createElement('button')
    cancel.textContent = '取消'
    cancel.style.cssText =
      'padding:7px 16px;border-radius:8px;border:1px solid var(--line,rgba(0,0,0,0.15));' +
      'background:transparent;color:var(--text,#222);cursor:pointer;font-size:13px;'

    const ok = document.createElement('button')
    ok.textContent = '确定'
    ok.style.cssText =
      'padding:7px 16px;border-radius:8px;border:none;' +
      'background:var(--accent,#3b82f6);color:#fff;cursor:pointer;font-size:13px;'

    const close = (val: string | null) => {
      document.body.removeChild(overlay)
      resolve(val)
    }

    ok.onclick = () => close(input.value)
    cancel.onclick = () => close(null)
    overlay.onclick = (e) => {
      if (e.target === overlay) close(null)
    }
    input.onkeydown = (e) => {
      if (e.key === 'Enter') close(input.value)
      if (e.key === 'Escape') close(null)
    }

    btns.appendChild(cancel)
    btns.appendChild(ok)
    box.appendChild(p)
    box.appendChild(input)
    box.appendChild(btns)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    input.focus()
    input.select()
  })
}

/** 预设图标候选（用于分类/类型图标选择，点击即可选用） */
export const ICON_PRESETS = [
  '📁', '📂', '🔖', '📌', '📝', '💡',
  '📚', '🎯', '⭐', '🔥', '💎', '🧩',
  '🗂️', '📒', '🏷️', '🌟', '🔧', '📷',
  '🎨', '✨', '📜', '🗒️', '🔗', '🧭',
]

/**
 * 图标选择框：弹出图标网格，返回用户选中的 emoji；取消返回 null。
 * Tauri 与浏览器环境统一用轻量 DOM 模态（plugin-dialog 不支持网格）。
 */
export function iconPickerAsync(defaultIcon = '📁'): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.45);font-family:system-ui,sans-serif;'

    const box = document.createElement('div')
    box.style.cssText =
      'min-width:320px;max-width:92vw;padding:18px 20px;border-radius:12px;' +
      'background:var(--bg,rgb(255,255,255));color:var(--text,#222);' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.3);'

    const title = document.createElement('div')
    title.textContent = '选择图标'
    title.style.cssText = 'margin-bottom:12px;font-size:14px;font-weight:600;'

    const grid = document.createElement('div')
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:12px;'

    const close = (val: string | null) => {
      document.body.removeChild(overlay)
      resolve(val)
    }

    for (const ic of ICON_PRESETS) {
      const b = document.createElement('button')
      b.textContent = ic
      b.style.cssText =
        'font-size:22px;padding:8px;border-radius:8px;' +
        'border:1px solid var(--line,rgba(0,0,0,0.15));background:transparent;' +
        'cursor:pointer;line-height:1;'
      if (ic === defaultIcon) {
        b.style.borderColor = 'var(--accent,#3b82f6)'
        b.style.background = 'var(--accent-soft,rgba(59,130,246,0.12))'
      }
      b.onclick = () => close(ic)
      grid.appendChild(b)
    }

    const hint = document.createElement('div')
    hint.textContent = '点击图标选用；取消则保留默认图标。'
    hint.style.cssText = 'font-size:12px;opacity:0.6;margin-bottom:10px;'

    const btns = document.createElement('div')
    btns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;'

    const cancel = document.createElement('button')
    cancel.textContent = '取消'
    cancel.style.cssText =
      'padding:7px 16px;border-radius:8px;border:1px solid var(--line,rgba(0,0,0,0.15));' +
      'background:transparent;color:var(--text,#222);cursor:pointer;font-size:13px;'
    cancel.onclick = () => close(null)

    btns.appendChild(cancel)
    box.appendChild(title)
    box.appendChild(grid)
    box.appendChild(hint)
    box.appendChild(btns)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
  })
}
