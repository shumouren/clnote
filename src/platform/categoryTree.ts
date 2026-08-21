/**
 * 分类树的"调整层级"纯逻辑（素材库 / 快捷库共用）
 * ---------------------------------------------------------------
 * 数据模型里分类只存 parentId，因此"移动一个分类"只需改它自己的 parentId，
 * 它的子分类（同样以它 id 为 parentId）会随之整体平移——即"带着子节点"。
 * 这里只产出"新的分类对象"，真正的持久化（saveCategory / saveShortcutCategory）
 * 由调用方完成，逻辑与存储解耦。
 */
import type { AssetCategory } from '../model/types'

/** 取某父级下的直接子分类，按 order 升序 */
export function catChildren(cats: AssetCategory[], parentId: string | null): AssetCategory[] {
  return cats
    .filter((c) => (c.parentId ?? null) === parentId)
    .sort((a, b) => (((a as AssetCategory & { orderIdx?: number }).orderIdx ?? a.order ?? 0) - ((b as AssetCategory & { orderIdx?: number }).orderIdx ?? b.order ?? 0)))
}

/** ancestorId 是否为 maybeChildId 的祖先（含自身）——用于阻止"拖进自己的后代" */
export function isCatDescendant(
  cats: AssetCategory[],
  ancestorId: string,
  maybeChildId: string,
): boolean {
  const map = new Map(cats.map((c) => [c.id, c]))
  let cur: string | null = maybeChildId
  while (cur) {
    if (cur === ancestorId) return true
    cur = map.get(cur)?.parentId ?? null
  }
  return false
}

/** 把 cat 变为 newParentId 的子节点，放在末尾；返回新对象（不修改入参） */
export function reparentCat(
  cat: AssetCategory,
  cats: AssetCategory[],
  newParentId: string | null,
): AssetCategory {
  const sibs = catChildren(cats, newParentId).filter((c) => c.id !== cat.id)
  return { ...cat, parentId: newParentId, order: sibs.length }
}

/** 提升一级：成为当前父级的同级，挂在祖父级、原父级之后（末尾） */
export function promoteCat(cat: AssetCategory, cats: AssetCategory[]): AssetCategory | null {
  if (cat.parentId == null) return null
  const parent = cats.find((c) => c.id === cat.parentId)
  if (!parent) return null
  const gp = parent.parentId
  const order = catChildren(cats, gp).filter((c) => c.id !== cat.id).length
  return { ...cat, parentId: gp, order }
}

/** 降低一级：成为前一兄弟的子节点（末尾）。无前一兄弟则返回 null */
export function demoteCat(cat: AssetCategory, cats: AssetCategory[]): AssetCategory | null {
  // 注意：这里不能先 filter 掉自身，否则下面 findIndex(cat.id) 恒为 -1，
  // 导致 prev 必定为 undefined、整个降级被静默跳过。
  const sibs = catChildren(cats, cat.parentId)
  const pos = sibs.findIndex((c) => c.id === cat.id)
  if (pos <= 0) return null // 第一个兄弟没有"前一个"，无法降级
  const prev = sibs[pos - 1]
  const order = catChildren(cats, prev.id).length
  return { ...cat, parentId: prev.id, order }
}
