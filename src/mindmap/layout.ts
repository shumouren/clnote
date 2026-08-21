import type { MindNode } from '../model/types'

export const NODE_W = 172
export const NODE_H = 34
export const LEVEL = 200 // 每一层级的水平间距（含节点宽度 + 间隙）
export const ROW = 48 // 同一父级下相邻叶子节点的垂直间距

export interface Pos {
  x: number
  y: number
}

export interface LayoutResult {
  pos: Record<string, Pos>
  width: number
  height: number
}

/** 水平树布局：x 按层级，y 按叶子顺序（父节点取子节点中点） */
export function layoutTree(root: MindNode): LayoutResult {
  const pos: Record<string, Pos> = {}
  let cursorY = 0

  function walk(node: MindNode, depth: number): number {
    const x = depth * LEVEL
    const kids = node.collapsed ? [] : node.children
    let y: number
    if (kids.length === 0) {
      y = cursorY + ROW / 2
      cursorY += ROW
    } else {
      const childYs = kids.map((c) => walk(c, depth + 1))
      y = (childYs[0] + childYs[childYs.length - 1]) / 2
    }
    pos[node.id] = { x, y }
    return y
  }

  walk(root, 0)

  let maxX = 0
  let maxY = 0
  for (const p of Object.values(pos)) {
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return {
    pos,
    width: maxX + NODE_W + 40,
    height: Math.max(maxY, cursorY) + ROW,
  }
}
