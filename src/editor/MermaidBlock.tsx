import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { toast } from '../ui/toast'
import { copyText, exportSvgAsPng } from './mermaidUtils'

/**
 * 流程图块（Mermaid）
 * ---------------------------------------------------------------
 * 文本即图表：节点只保存 mermaid 源码（attrs.code），渲染时由 mermaid 动态生成 SVG。
 * - 预览态：显示渲染结果；点击「编辑」切到源码文本框，实时（防抖）预览。
 * - 暗色主题自动切换 mermaid 的 dark 配色。
 * - mermaid 走动态 import，首屏不加载，只有在笔记里出现流程图时才拉取。
 */

const DEFAULT_CODE = `flowchart TD
  A[开始] --> B{条件判断}
  B -->|是| C[执行处理]
  B -->|否| D[结束]
  C --> D`

export const DARK_THEMES = new Set(['dark', 'graphite', 'deepsea', 'cyber'])

/** mermaid 懒加载（只加载一次，缓存 Promise） */
let mermaidP: Promise<typeof import('mermaid').default> | null = null
function getMermaid() {
  if (!mermaidP) {
    mermaidP = import('mermaid').then((m) => m.default)
  }
  return mermaidP
}

function MermaidView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const code = (node.attrs.code as string) || ''
  const themeId = useStore((s) => s.settings.theme)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(code)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  // 外部 code 变化且不在编辑态时，同步草稿
  useEffect(() => {
    if (!editing) setDraft(code)
  }, [code, editing])

  // 渲染 SVG（预览态、code/主题变化时触发；编辑态不渲染避免抖动）
  useEffect(() => {
    if (editing) return
    let cancelled = false
    const run = async () => {
      const id = 'mmd-' + Math.random().toString(36).slice(2, 10)
      try {
        const mermaid = await getMermaid()
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: DARK_THEMES.has(themeId) ? 'dark' : 'default',
        })
        const { svg } = await mermaid.render(id, code || 'graph TD\nA')
        if (!cancelled) {
          setSvg(svg)
          setError('')
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setSvg('')
        }
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [code, editing, themeId])

  const commit = () => {
    updateAttributes({ code: draft })
    setEditing(false)
  }

  const [exporting, setExporting] = useState(false)
  const onCopy = async () => {
    const ok = await copyText(code)
    toast(ok ? '已复制流程图源码' : '复制失败')
  }
  const onExport = async () => {
    if (!svg || exporting) return
    setExporting(true)
    try {
      await exportSvgAsPng(svg, `流程图-${Date.now()}.png`, 2)
      toast('已导出 PNG')
    } catch (e: unknown) {
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExporting(false)
    }
  }

  return (
    <NodeViewWrapper
      className={'mermaid-block' + (selected ? ' selected' : '')}
      data-mermaid="true"
      data-code={code}
    >
      <div className="mermaid-bar" contentEditable={false}>
        <span className="mermaid-tag">流程图</span>
        <span className="mermaid-spacer" />
        <button
          className="tb-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCopy}
          title="复制 Mermaid 源码"
        >
          复制源码
        </button>
        <button
          className="tb-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onExport}
          disabled={!svg || exporting}
          title="导出为 PNG 图片"
        >
          {exporting ? '导出中…' : '导出 PNG'}
        </button>
        {!editing ? (
          <button className="tb-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraft(code); setEditing(true) }}>
            编辑
          </button>
        ) : (
          <button className="tb-btn active" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
            完成
          </button>
        )}
        <button className="tb-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => deleteNode()}>
          删除
        </button>
      </div>

      {editing ? (
        <textarea
          className="mermaid-edit"
          value={draft}
          spellCheck={false}
          placeholder={'输入 Mermaid 语法，例如：\nflowchart TD\n  A[开始] --> B(处理)'}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : error ? (
        <div className="mermaid-error">
          <div className="mermaid-err-title">⚠ 语法有误，无法渲染</div>
          <pre className="mermaid-err-msg">{error}</pre>
          <details>
            <summary>查看源码</summary>
            <pre className="mermaid-src">{code}</pre>
          </details>
        </div>
      ) : (
        <div
          className="mermaid-svg"
          // mermaid 输出的已是受 securityLevel 净化的 SVG
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </NodeViewWrapper>
  )
}

export const MermaidBlock = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      code: {
        default: DEFAULT_CODE,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-code') ?? '',
        renderHTML: (attrs) => ({ 'data-code': attrs.code }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addCommands() {
    return {
      insertMermaid:
        (code?: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { code: code ?? DEFAULT_CODE } }),
    } as unknown as Partial<Record<string, unknown>>
  },
})

export { DEFAULT_CODE }
