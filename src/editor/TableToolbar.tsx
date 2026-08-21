import type { Editor } from '@tiptap/react'

interface Props {
  editor: Editor | null
}

/** 表格工具栏：插入表格、增删行列、合并/拆分单元格、标题行 */
export default function TableToolbar({ editor }: Props) {
  if (!editor) return null
  const c = () => editor.chain().focus()
  const inTable = editor.isActive('table')

  const opBtn = (label: string, cmd: () => unknown, title: string) => (
    <button
      className="tb-btn"
      title={title}
      disabled={!inTable}
      style={!inTable ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      onClick={() => cmd()}
    >
      {label}
    </button>
  )

  return (
    <>
      <button
        className="tb-btn"
        title="插入 3×3 表格"
        onClick={() =>
          c()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        ▦ 表格
      </button>
      <span className="tb-sep" />
      {opBtn('◀+列', () => c().addColumnBefore().run(), '左侧加列')}
      {opBtn('+列▶', () => c().addColumnAfter().run(), '右侧加列')}
      {opBtn('−列', () => c().deleteColumn().run(), '删除列')}
      <span className="tb-sep" />
      {opBtn('▲+行', () => c().addRowBefore().run(), '上方加行')}
      {opBtn('+行▼', () => c().addRowAfter().run(), '下方加行')}
      {opBtn('−行', () => c().deleteRow().run(), '删除行')}
      <span className="tb-sep" />
      {opBtn('合并', () => c().mergeCells().run(), '合并选中单元格')}
      {opBtn('拆分', () => c().splitCell().run(), '拆分单元格')}
      {opBtn('标题行', () => c().toggleHeaderRow().run(), '切换标题行')}
      {opBtn('删表', () => c().deleteTable().run(), '删除整个表格')}
    </>
  )
}
