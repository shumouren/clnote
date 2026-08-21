/**
 * HTML → TipTap (ProseMirror) JSON
 * ---------------------------------------------------------------
 * 用浏览器自带的 DOMParser 解析，仅产出当前 schema 支持的节点类型：
 *   doc / paragraph / heading / bulletList / orderedList / listItem
 *   / taskList / taskItem / blockquote / codeBlock / horizontalRule / table
 *   / tableRow / tableHeader / tableCell / text（marks: bold/italic/strike/code/link）
 * 不支持的标签（如 img）会被忽略，保证导入内容一定能加载进编辑器。
 */

interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}
interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

function domInline(node: ChildNode): PMNode[] {
  const out: PMNode[] = []
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3 /* TEXT */) {
      const t = child.textContent ?? ''
      if (t) out.push({ type: 'text', text: t })
      return
    }
    if (child.nodeType !== 1) return
    const el = child as HTMLElement
    const tag = el.tagName.toLowerCase()
    const marks: PMMark[] = []
    switch (tag) {
      case 'strong':
      case 'b':
        marks.push({ type: 'bold' })
        break
      case 'em':
      case 'i':
        marks.push({ type: 'italic' })
        break
      case 's':
      case 'strike':
      case 'del':
        marks.push({ type: 'strike' })
        break
      case 'code':
        marks.push({ type: 'code' })
        break
      case 'a':
        marks.push({ type: 'link', attrs: { href: el.getAttribute('href') ?? '' } })
        break
      case 'br':
        out.push({ type: 'hardBreak' })
        return
      case 'img':
        // 当前 schema 不含图片节点，跳过
        return
    }
    const inner = domInline(child)
    if (marks.length === 0) {
      out.push(...inner)
    } else {
      // 把子文本节点打上同样的 mark
      inner.forEach((n) => {
        if (n.type === 'text') {
          n.marks = [...(n.marks ?? []), ...marks]
        }
        out.push(n)
      })
    }
  })
  return out
}

function paraOf(node: HTMLElement): PMNode {
  const inner = domInline(node)
  return { type: 'paragraph', content: inner.length ? inner : undefined }
}

function blocksOf(el: HTMLElement): PMNode[] {
  const out: PMNode[] = []
  const walk = (parent: HTMLElement) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType !== 1) return
      const e = child as HTMLElement
      const tag = e.tagName.toLowerCase()
      switch (tag) {
        case 'p':
          out.push(paraOf(e))
          break
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
          out.push({
            type: 'heading',
            attrs: { level: Math.min(3, Number(tag[1])) },
            content: domInline(e),
          })
          break
        case 'ul':
        case 'ol': {
          const listType = tag === 'ol' ? 'orderedList' : 'bulletList'
          const items: PMNode[] = []
          e.querySelectorAll(':scope > li').forEach((li) => {
            items.push({ type: 'listItem', content: blocksOf(li as HTMLElement) })
          })
          out.push({ type: listType, content: items })
          break
        }
        case 'blockquote':
          out.push({ type: 'blockquote', content: blocksOf(e) })
          break
        case 'pre': {
          const code = e.querySelector('code')
          const text = (code ?? e).textContent ?? ''
          out.push({
            type: 'codeBlock',
            attrs: code?.getAttribute('class')?.includes('language-')
              ? { language: (code!.getAttribute('class') || '').replace('language-', '') }
              : undefined,
            content: text ? [{ type: 'text', text }] : undefined,
          })
          break
        }
        case 'hr':
          out.push({ type: 'horizontalRule' })
          break
        case 'table': {
          const rows: PMNode[] = []
          e.querySelectorAll(':scope > tr, :scope > tbody > tr, :scope > thead > tr').forEach(
            (tr) => {
              const cells: PMNode[] = []
              ;(tr as HTMLElement)
                .querySelectorAll(':scope > td, :scope > th')
                .forEach((c) => {
                  const isHead = c.tagName.toLowerCase() === 'th'
                  cells.push({
                    type: isHead ? 'tableHeader' : 'tableCell',
                    content: blocksOf(c as HTMLElement),
                  })
                })
              rows.push({ type: 'tableRow', content: cells })
            },
          )
          if (rows.length) out.push({ type: 'table', content: rows })
          break
        }
        case 'div':
        case 'section':
        case 'article':
        case 'main':
        case 'header':
        case 'footer':
          // 容器：递归处理内部
          walk(e)
          break
        default:
          // 其它块级标签：当作段落文本兜底
          if (e.textContent?.trim()) out.push(paraOf(e))
      }
    })
  }
  walk(el)
  return out
}

/** 提取 <title> 作为候选笔记名 */
export function htmlTitle(html: string): string | null {
  const m = /<title>([^<]*)<\/title>/i.exec(html)
  return m ? m[1].trim() : null
}

export function htmlToTipTap(html: string): PMNode {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks = blocksOf(doc.body)
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}
