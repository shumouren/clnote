import { useStore } from '../store/useStore'
import { LIB_ORDER } from '../settings/settings'

/** 最左侧「库栏 / 活动栏」：竖排各库图标，点击切换中间面板；设置固定最底 */
export default function LibraryRail() {
  const sideTab = useStore((s) => s.sideTab)
  const setSideTab = useStore((s) => s.setSideTab)
  const libs = useStore((s) => s.settings.libs)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  const visible = LIB_ORDER.filter((it) => libs[it.key] !== false)

  return (
    <nav className="lib-rail" aria-label="库导航">
      <div className="lib-rail-top">
        {visible.map((it) => (
          <button
            key={it.key}
            className={'lib-rail-btn' + (sideTab === it.key ? ' active' : '')}
            title={it.label}
            onClick={() => setSideTab(it.key)}
          >
            <span className="lib-rail-ico">{it.icon}</span>
            <span className="lib-rail-label">{it.label}</span>
          </button>
        ))}
      </div>
      <div className="lib-rail-bottom">
        <button
          className="lib-rail-btn"
          title="设置"
          onClick={() => setSettingsOpen(true)}
        >
          <span className="lib-rail-ico">⚙</span>
          <span className="lib-rail-label">设置</span>
        </button>
      </div>
    </nav>
  )
}
