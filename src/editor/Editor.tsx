import { EditorContent, type Editor as TiptapEditor } from '@tiptap/react'

interface Props {
  editor: TiptapEditor | null
}

/** 纯展示组件：渲染 TipTap 编辑器内容区 */
export default function Editor({ editor }: Props) {
  return <EditorContent editor={editor} />
}
