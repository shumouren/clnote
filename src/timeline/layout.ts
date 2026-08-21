import type { TimeNode } from '../model/types'

/** 节点固定尺寸（与 CSS 中 .tl-node 对应） */
export const TL_NODE_W = 184
export const TL_NODE_H = 40
/** 同一父级下相邻同级节点的垂直间距（竖线向下延伸的步长） */
export const TL_ROW = 64
/** 跨层级（Tab 子节点向右分叉）的水平间距 */
export const TL_COL = 220
/** 两条时间线（列）之间的水平间隔 */
export const TL_GAP = 80

export interface TlPos {
  x: number
  y: number
}

export interface TlTimeline {
  rootId: string
  /** 该时间线列的起始 x（已含偏移） */
  x0: number
  /** 该时间线列的宽度 */
  width: number
}

export interface TlLayout {
  /** 节点 id → 画布世界坐标（左上角，未叠加 pan / zoom） */
  pos: Record<string, TlPos>
  width: number
  height: number
  /** 每条时间线的列信息，便于画标题/分隔 */
  timelines: TlTimeline[]
}

/**
 * 竖向链式布局（思维导图的竖版逻辑）：
 *   · 根节点（时间线）在最上；它的"事件"子节点与根同列，向下竖向延伸成"一条竖着延长的线"。
 *   · 非根节点的子节点（Tab 产生的分支）向右分叉一列，并在该列内竖向堆叠。
 *   · 同级节点按 children 顺序排列，连线由调用方画成：父→首个子，随后 child[i]→child[i+1] 的链条。
 *   · 多条时间线并排成列（自动排列），列间留 TL_GAP。
 * 被折叠节点的子树不计入布局（其本身当作叶子）。
 */
export function layoutTimelines(roots: TimeNode[]): TlLayout {
  const pos: Record<string, TlPos> = {}
  const timelines: TlTimeline[] = []
  let cursorX = 0
  let maxY = 0

  for (const root of roots) {
    const x0 = cursorX
    let localMaxX = 0

    const place = (n: TimeNode, col: number, y: number): number => {
      const x = x0 + col * TL_COL
      pos[n.id] = { x, y }
      // 注意：localMaxX 必须相对当前时间线列（不含 x0），否则 width 会重复累加 x0，
      // 导致每条新时间线的起点成倍右移、列间距越来越长。
      localMaxX = Math.max(localMaxX, col * TL_COL + TL_NODE_W)
      const kids = n.collapsed ? [] : n.children
      if (kids.length === 0) return TL_NODE_H
      // 根节点的子节点（主时间线事件）与根同列，向下延伸；
      // 其余节点的子节点向右分叉一列（同列内竖向堆叠）。
      const childCol = n.id === root.id ? col : col + 1
      let cursorY = n.id === root.id ? y + TL_ROW : y
      for (let i = 0; i < kids.length; i++) {
        const h = place(kids[i], childCol, cursorY)
        cursorY += h
        if (i < kids.length - 1) cursorY += TL_ROW
      }
      return Math.max(TL_NODE_H, cursorY - y)
    }

    const h = place(root, 0, 0)
    maxY = Math.max(maxY, h)

    const width = Math.max(localMaxX, TL_NODE_W) + 40
    timelines.push({ rootId: root.id, x0, width })
    cursorX += width + TL_GAP
  }

  if (timelines.length === 0) {
    return { pos: {}, width: 0, height: 0, timelines: [] }
  }

  return {
    pos,
    width: cursorX - TL_GAP + 60,
    height: maxY + 60,
    timelines,
  }
}
