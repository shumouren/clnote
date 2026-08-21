import { useEffect, useState } from 'react'

/** 极简全局 Toast：通过 window 事件解耦，任意模块可调用 toast('xxx') */

const EVT = 'ccc-toast'

export function toast(msg: string, ms = 1800): void {
  window.dispatchEvent(new CustomEvent(EVT, { detail: { msg, ms } }))
}

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([])

  useEffect(() => {
    let seq = 0
    const onToast = (e: Event) => {
      const { msg, ms } = (e as CustomEvent<{ msg: string; ms: number }>).detail
      const id = ++seq
      setItems((cur) => [...cur, { id, msg }])
      window.setTimeout(() => {
        setItems((cur) => cur.filter((t) => t.id !== id))
      }, ms)
    }
    window.addEventListener(EVT, onToast)
    return () => window.removeEventListener(EVT, onToast)
  }, [])

  if (!items.length) return null
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.msg}
        </div>
      ))}
    </div>
  )
}
