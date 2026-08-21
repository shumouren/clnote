import StarterKit from '@tiptap/starter-kit'
import { Extension, markInputRule, textblockTypeInputRule } from '@tiptap/core'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { SmartPunctuation } from './SmartPunctuation'
import { MermaidBlock } from './MermaidBlock'
import { ForeshadowMark } from './ForeshadowMark'
import { NodeRef } from './NodeRef'

/**
 * Markdown 快捷输入（写作者常用）：
 * - `# ` / `## ` … 空格 → 标题 H1–H6
 * - `> ` → 引用
 * - `**文字**` → 加粗；`*文字*` → 斜体；`` `文字` `` → 行内代码
 */
const MarkdownInput = Extension.create({
  name: 'markdownInput',
  addInputRules() {
    const schema = this.editor.schema
    return [
      textblockTypeInputRule({
        find: /^#{1,6}\s$/,
        type: schema.nodes.heading,
        getAttributes: (match) => ({ level: match[1].length }),
      }),
      textblockTypeInputRule({ find: /^>\s$/, type: schema.nodes.blockquote }),
      markInputRule({ find: /\*\*([^*]+)\*\*$/, type: schema.marks.bold }),
      markInputRule({ find: /\*([^*]+)\*$/, type: schema.marks.italic }),
      markInputRule({ find: /`([^`]+)`$/, type: schema.marks.code }),
    ]
  },
})

/**
 * 在官方 Image 扩展基础上增加 width 属性，支持单张图片单独设置显示宽度。
 * renderHTML 输出 inline style 的 width，CSS 里再用 max-width 兜底，确保不超出编辑区。
 */
const ImageNode = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('width') ?? null,
        renderHTML: (attrs) => {
          if (!attrs.width) return {}
          return { width: attrs.width, style: `width: ${attrs.width}` }
        },
      },
    }
  },
})

/**
 * 编辑器扩展列表
 * - StarterKit：段落/标题/加粗/斜体/列表/引用/代码等基础富文本
 * - Table 全家桶：笔记内嵌表格，支持增删行列、合并拆分单元格
 * - TaskList / TaskItem：待办清单（复选框）
 * - Image：素材库拖入的图片以内嵌节点保存，支持单图宽度
 * - MermaidBlock：正文内联流程图（源码驱动，点击编辑）
 * - SmartPunctuation：笔落写作式中文智能标点
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    // 无限（极大深度）撤销：默认 100 步，这里放大到实际不会触顶的程度
    history: { depth: 100000 },
  }),
  Table.configure({
    resizable: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  ImageNode.configure({
    inline: false,
    allowBase64: true,
  }),
  MermaidBlock,
  SmartPunctuation,
  ForeshadowMark,
  NodeRef,
  MarkdownInput,
]
