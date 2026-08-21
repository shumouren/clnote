import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * 伏笔（标注）标记：把选中的一段文字锚定为一条伏笔。
 * - fid：全局唯一 id，与 SQLite 的 foreshadows 表行对应，用于"伏笔栏"跳转定位。
 * - done：0/1，完成状态；渲染时区分样式（已完成用删除线/弱化）。
 * renderHTML 输出 <span data-foreshadow data-fid data-done class="foreshadow-mark">，
 * 由 global.css 控制高亮样式，并随 done 切换外观。
 */
export const ForeshadowMark = Mark.create({
  name: 'foreshadowing',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      fid: { default: null },
      done: { default: 0 },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-foreshadow]' }]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const done = mark.attrs.done ? '1' : '0'
    const cls = 'foreshadow-mark' + (done === '1' ? ' done' : '')
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-foreshadow': '',
        'data-fid': mark.attrs.fid,
        'data-done': done,
        class: cls,
      }),
      0,
    ]
  },
})
