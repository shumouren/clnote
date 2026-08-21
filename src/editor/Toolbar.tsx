import type { Editor } from '@tiptap/react'
import { pickHighResImage } from '../export/download'
import { toast } from '../ui/toast'
import { normalizeHalfWidthPunct } from './SmartPunctuation'

interface Props {
  editor: Editor | null
  /** 当前笔记所属的小说创作 id（非空时显示"设为伏笔"按钮） */
  novelId?: string | null
  /** 点击"设为伏笔"的回调 */
  onSetForeshadow?: () => void
  /** 点击"🔗 引用"：在光标处手动唤起跨栏引用选择器 */
  onInsertRef?: () => void
}

/** 富文本基础工具栏 */
export default function Toolbar({ editor, novelId, onSetForeshadow, onInsertRef }: Props) {
  if (!editor) return null

  const btn = (active: boolean) =>
    'tb-btn' + (active ? ' active' : '')

  const insertImage = async () => {
    const img = await pickHighResImage()
    if (img?.dataUrl) {
      editor.chain().focus().setImage({ src: img.dataUrl }).run()
    }
  }

  // 选中图片时显示宽度滑块（单图独立宽度）；未选中图片时禁用
  const imgActive = editor.isActive('image')
  const imgW = imgActive ? parseInt(String(editor.getAttributes('image').width ?? '100'), 10) || 100 : 100

  /** 把选中文字里的半角标点统一转为全角标点（不触碰数字/字母） */
  const normalizePunct = () => {
    const { from, to, empty } = editor.state.selection
    if (empty) {
      toast('请先选中要规范化的文本，再点「全角标点」')
      return
    }
    const text = editor.state.doc.textBetween(from, to, '\n')
    const conv = normalizeHalfWidthPunct(text)
    if (conv === text) {
      toast('选中内容里没有可转换的半角标点')
      return
    }
    editor.chain().focus().insertContentAt({ from, to }, conv).run()
    toast('已把半角标点转为全角标点')
  }

  return (
    <>
      <button
        className="tb-btn"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
        title="撤销（Ctrl+Z）"
      >
        ↩ 撤销
      </button>
      <button
        className="tb-btn"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
        title="重做（Ctrl+Y）"
      >
        ↪ 重做
      </button>
      <button
        className={btn(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="加粗"
      >
        B
      </button>
      <button
        className={btn(editor.isActive('italic'))}
        style={{ fontStyle: 'italic' }}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="斜体"
      >
        I
      </button>
      <button
        className={btn(editor.isActive('strike'))}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="删除线"
      >
        S
      </button>
      <button
        className={btn(false)}
        onClick={insertImage}
        title="插入图片"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="8.5" cy="9.5" r="1.8" fill="currentColor" />
          <path d="M5 17l4.2-4.2a1.4 1.4 0 0 1 2 0L16 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14.5 15l2-2a1.4 1.4 0 0 1 2 0L21 16.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="tb-imgctl" title="选中图片后可调节该图宽度，不超过编辑区">
        <input
          type="range"
          min={20}
          max={100}
          step={5}
          value={imgW}
          disabled={!imgActive}
          onChange={(e) => {
            const v = Number(e.target.value)
            editor.chain().focus().updateAttributes('image', { width: `${v}%` }).run()
          }}
        />
        <button
          className="tb-btn"
          disabled={!imgActive}
          title="恢复默认宽度（随编辑区）"
          onClick={() => editor.chain().focus().updateAttributes('image', { width: null }).run()}
        >
          适应
        </button>
      </span>
      <span className="tb-sep" />
      <button
        className={btn(false)}
        onClick={() => (editor.chain().focus() as unknown as { insertMermaid: () => { run: () => void } }).insertMermaid().run()}
        title="插入流程图（Mermaid 语法）"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="7" height="5" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
          <rect x="14" y="15" width="7" height="5" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
          <path d="M6.5 9v3h11v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="17.5" cy="12" r="1.4" fill="currentColor" />
        </svg>
      </button>
      <span className="tb-sep" />
      <button
        className={btn(editor.isActive('heading', { level: 1 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="标题1"
      >
        H1
      </button>
      <button
        className={btn(editor.isActive('heading', { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="标题2"
      >
        H2
      </button>
      <button
        className={btn(editor.isActive('heading', { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="标题3"
      >
        H3
      </button>
      <button
        className={btn(editor.isActive('heading', { level: 4 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        title="标题4"
      >
        H4
      </button>
      <button
        className={btn(editor.isActive('heading', { level: 5 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
        title="标题5"
      >
        H5
      </button>
      <button
        className={btn(editor.isActive('heading', { level: 6 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
        title="标题6"
      >
        H6
      </button>
      <span className="tb-sep" />
      <button
        className={btn(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="无序列表"
      >
        •
      </button>
      <button
        className={btn(editor.isActive('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="有序列表"
      >
        1.
      </button>
      <button
        className={btn(editor.isActive('blockquote'))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="引用"
      >
        ❝
      </button>
      <button
        className={btn(editor.isActive('codeBlock'))}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="代码块"
      >
        {'</>'}
      </button>
      <span className="tb-sep" />
      <button
        className={btn(editor.isActive('taskList'))}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="待办清单"
      >
        ☑
      </button>
      <span className="tb-sep" />
      <button
        className={btn(false)}
        onClick={() => onInsertRef?.()}
        title="插入跨栏引用：选择其它节点（角色/剧情/设定/地图/时间线/正文…），点击可跳转；正文里直接输入 @ 也能唤起"
      >
        🔗 引用
      </button>
      <span className="tb-sep" />
      <button
        className="tb-btn"
        onClick={normalizePunct}
        title="把选中文字里的半角标点（,.;:!?() 等）统一转为全角标点（，。；：！？（）），数字和字母不受影响"
      >
        全角标点
      </button>
      {novelId ? (
        <>
          <span className="tb-sep" />
          <button
            className="tb-btn tb-foreshadow"
            title="选中文字后将其设为伏笔（标注），可在伏笔栏查看与跳转"
            onClick={() => onSetForeshadow?.()}
          >
            🔖 设为伏笔
          </button>
        </>
      ) : null}
    </>
  )
}
