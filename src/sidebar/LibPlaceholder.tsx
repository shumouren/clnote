/** 新库（阅读 / 音乐 / 视频）在「逐库实现」阶段的占位面板，保证点击库栏不白屏 */
export default function LibPlaceholder({
  icon,
  title,
  desc,
}: {
  icon: string
  title: string
  desc: string
}) {
  return (
    <div className="lib-placeholder">
      <div className="lib-ph-ico">{icon}</div>
      <div className="lib-ph-title">{title}</div>
      <div className="lib-ph-desc">{desc}</div>
      <div className="lib-ph-tag">v3 开发中 · 即将开放</div>
    </div>
  )
}
