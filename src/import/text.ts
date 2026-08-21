/**
 * 纯文本 → TipTap (ProseMirror) JSON
 * 每行一个段落；连续空行切分；保留顺序。
 */

interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
}

export function textToTipTap(text: string): PMNode {
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n')
  const paras: PMNode[] = []
  let buf: string[] = []
  const flush = () => {
    if (buf.length) {
      const t = buf.join('\n').trim()
      if (t) paras.push({ type: 'paragraph', content: [{ type: 'text', text: t }] })
      buf = []
    }
  }
  for (const line of lines) {
    if (!line.trim()) flush()
    else buf.push(line)
  }
  flush()
  return { type: 'doc', content: paras.length ? paras : [{ type: 'paragraph' }] }
}
