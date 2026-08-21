import { useCallback, useState } from 'react'

/** 任何带 id + 可选 order 的列表项都可用此 hook 做拖拽排序 */
export interface OrderableItem {
  id: string
  order?: number
}

/**
 * 通用「卡片拖拽排序」hook。
 *
 * 适用场景：卡片列表的项内嵌在某个 Doc 的数组里（如 SettingEntry / PlotItem / Map location …），
 * 排序后由调用方负责持久化（通常是 update(doc)）。本 hook 只负责：
 *   1. 维护拖拽中的来源 id 与悬浮目标 id（用于高亮）；
 *   2. 计算拖放后的新数组，并把 order 按新位置顺序重排（0,1,2…）；
 *   3. 通过 onReorder 把新数组交回调用方。
 *
 * 注意：传入的 `items` 应是「同一排序域」的完整数组（例如某个类别/某列下的全部项，
 * 或整个 doc.entries）。拖拽只在该数组内部重排，不会跨域移动。
 *
 * 需要连线的关系图视图（角色关系图 / 地图平面图 / 时间线连线）请勿使用本 hook，
 * 那些视图的拖拽语义是「画连线」而非「排序」。
 */
export function useListReorder<T extends OrderableItem>(
  items: T[],
  onReorder: (next: T[]) => void,
) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const beginDrag = useCallback((e: React.DragEvent, id: string) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', id)
    } catch {
      /* 某些浏览器在 dragstart 阶段 setData 可能抛错，忽略即可 */
    }
  }, [])

  const onDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (id !== overId) setOverId(id)
    },
    [overId],
  )

  const drop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault()
      const fromId =
        dragId ??
        (() => {
          try {
            return e.dataTransfer.getData('text/plain')
          } catch {
            return ''
          }
        })()
      setDragId(null)
      setOverId(null)
      if (!fromId || fromId === targetId) return

      const fromIdx = items.findIndex((it) => it.id === fromId)
      const toIdx = items.findIndex((it) => it.id === targetId)
      if (fromIdx < 0 || toIdx < 0) return

      const next = items.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)

      // 按新位置重新赋 order（顺序整数），保持显示稳定
      const reordered = next.map((it, i) => ({ ...it, order: i }))
      onReorder(reordered)
    },
    [dragId, items, onReorder],
  )

  const endDrag = useCallback(() => {
    setDragId(null)
    setOverId(null)
  }, [])

  return { dragId, overId, beginDrag, onDragOver, drop, endDrag }
}
