/**
 * OPML → MindMapDoc
 * ---------------------------------------------------------------
 * <outline text="..."> 递归成 MindNode。若存在多个一级 outline，
 * 则用一个统一的「导入导图」根节点把它们都收为子节点，保证 MindMapDoc 单根结构。
 */
import type { MindMapDoc, MindNode } from '../model/types'
import { newId } from '../model/types'

function outlineToNode(el: Element): MindNode {
  const text = el.getAttribute('text') || el.getAttribute('title') || '（空）'
  const children: MindNode[] = []
  el.querySelectorAll(':scope > outline').forEach((c) => {
    children.push(outlineToNode(c))
  })
  return { id: newId(), text, children }
}

export function opmlToMindMap(xml: string, fallbackName = '导入导图'): MindMapDoc {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const body = doc.querySelector('body')
  const tops = body ? Array.from(body.querySelectorAll(':scope > outline')) : []
  if (tops.length === 0) {
    return { root: { id: newId(), text: fallbackName, children: [] } }
  }
  if (tops.length === 1) {
    const n = outlineToNode(tops[0])
    return { root: n }
  }
  // 多个一级：收到一个统一根下
  const root: MindNode = {
    id: newId(),
    text: fallbackName,
    children: tops.map((t) => outlineToNode(t)),
  }
  return { root }
}
