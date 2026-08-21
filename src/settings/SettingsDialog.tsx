import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { THEMES, ACCENTS } from '../theme/themes'
import {
  TEXT_FONTS,
  CODE_FONTS,
  isFontAvailable,
  matchPreset,
  getLocalFonts,
  loadSettings,
  type FontPreset,
  type RegionBg,
  LIB_ORDER,
  type LibKey,
  DEFAULT_LIBS,
} from './settings'
import {
  getStorageInfo,
  formatBytes,
  setDataDir,
  requestPersistent,
  isPersisted,
  buildBackup,
  restoreBackup,
  type StorageInfo,
} from '../storage/location'
import { pickTextFile, pickImageFile, timestamp, saveTextFileWithDialog, downloadLocationHint } from '../export/download'
import { confirmAsync } from '../platform/dialog'
import { toast } from '../ui/toast'
import { pickFolder } from '../platform/pickFolder'
import { APP_NAME, APP_VERSION, APP_DEV, APP_TECH, APP_FEATURES } from '../about'

type SectionId = 'appearance' | 'editor' | 'storage' | 'export' | 'about' | 'libs' | 'pomodoro'

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'appearance', label: '外观', icon: '🎨' },
  { id: 'editor', label: '编辑器与字体', icon: '✍️' },
  { id: 'libs', label: '库管理', icon: '🧭' },
  { id: 'storage', label: '文件存储', icon: '💾' },
  { id: 'export', label: '导出', icon: '📤' },
  { id: 'pomodoro', label: '番茄钟', icon: '🍅' },
  { id: 'about', label: '快捷键与关于', icon: 'ℹ️' },
]

/* ---------------- 通用小组件 ---------------- */

function Range({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div className="set-row">
      <span className="set-label">
        {label}
        <b className="set-val">
          {value}
          {unit ?? ''}
        </b>
      </span>
      <input
        className="set-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="set-hint">{hint}</div>}
    </div>
  )
}

function FontSelect({
  label,
  value,
  list,
  onChange,
  extra,
}: {
  label: string
  value: string
  list: FontPreset[]
  onChange: (stack: string) => void
  extra?: FontPreset[]
}) {
  const combined = useMemo(() => [...list, ...(extra ?? [])], [list, extra])
  const id = matchPreset(value, combined)
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
      <select
        className="set-select"
        value={id}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'custom') {
            onChange(value + ' ')
            return
          }
          const f = combined.find((x) => x.id === v)
          if (f) onChange(f.stack)
        }}
      >
        <optgroup label="内置">
          {list.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
              {isFontAvailable(f.probe) ? '' : '（系统未安装）'}
            </option>
          ))}
        </optgroup>
        {extra && extra.length > 0 && (
          <optgroup label="本机字体">
            {extra.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </optgroup>
        )}
        <option value="custom">自定义…</option>
      </select>
      {id === 'custom' && (
        <input
          className="set-input"
          value={value}
          placeholder='例如： "Noto Serif SC", serif'
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

/* ---------------- 分区域背景控件 ---------------- */

function RegionBgControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: RegionBg
  onChange: (v: RegionBg) => void
}) {
  const has = !!value.image
  return (
    <div className="set-card">
      <div className="set-card-title">{label}</div>
      {has ? (
        <div className="set-kv" style={{ marginTop: 8 }}>
          <span>图片地址</span>
          <b className="set-path" title={value.image}>
            {value.image}
          </b>
        </div>
      ) : (
        <div className="set-hint" style={{ marginTop: 8 }}>
          图片地址：（空）
        </div>
      )}
      <div className="set-inline wrap" style={{ marginTop: 10 }}>
        <button
          className="tb-btn"
          onClick={async () => {
            const img = await pickImageFile()
            if (img) onChange({ ...value, image: img.dataUrl })
          }}
        >
          选择图片
        </button>
        {has && (
          <button className="tb-btn danger" onClick={() => onChange({ ...value, image: '' })}>
            清除
          </button>
        )}
      </div>

      {has && (
        <>
          <div className="set-row" style={{ marginTop: 12, marginBottom: 6 }}>
            <span className="set-label">填充方式</span>
            <select
              className="set-select"
              value={value.mode}
              onChange={(e) => onChange({ ...value, mode: e.target.value as RegionBg['mode'] })}
            >
              <option value="cover">铺满（保持比例裁切）</option>
              <option value="tile">平铺（原始大小重复）</option>
              <option value="stretch">拉伸（填满，可能变形）</option>
            </select>
          </div>
          <Range
            label="遮罩浓度"
            value={value.dim}
            min={0}
            max={70}
            step={5}
            unit="%"
            hint="在图片上叠一层与主题接近的半透明色，保证文字清晰可读"
            onChange={(v) => onChange({ ...value, dim: v })}
          />
        </>
      )}
    </div>
  )
}

/* ---------------- 主体 ---------------- */

export default function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const s = useStore((st) => st.settings)
  const set = useStore((st) => st.setSettings)
  const sideTab = useStore((st) => st.sideTab)
  const setSideTab = useStore((st) => st.setSideTab)
  const reset = useStore((st) => st.resetSettings)
  const loadNodes = useStore((st) => st.loadNodes)
  const openExport = useStore((st) => st.openExport)
  const openImport = useStore((st) => st.openImport)

  const [section, setSection] = useState<SectionId>('appearance')
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [persisted, setPersisted] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const [storageMsg, setStorageMsg] = useState<string | null>(null)
  /** 恢复备份时是否一并恢复设置（外观 / 编辑器 / 导出等偏好） */
  const [restoreSettings, setRestoreSettings] = useState(false)
  const [localFonts, setLocalFonts] = useState<FontPreset[]>([])

  // 对话框一打开就加载本机字体：外观分区的界面字体下拉也要用到 extra 才能正确回显已选字体
  useEffect(() => {
    if (open && localFonts.length === 0) {
      getLocalFonts().then(setLocalFonts)
    }
  }, [open, localFonts.length])

  useEffect(() => {
    if (!open || section !== 'storage') return
    let alive = true
    getStorageInfo().then((i) => {
      if (!alive) return
      setInfo(i)
      setDirInput(i.changeable ? i.path : '')
    })
    isPersisted().then((p) => alive && setPersisted(p))
    return () => {
      alive = false
    }
  }, [open, section])

  if (!open) return null

  const refreshStorage = async () => {
    setInfo(await getStorageInfo())
  }

  const doBackup = async () => {
    const b = await buildBackup(useStore.getState().settings)
    const total = (b.nodes?.length ?? 0) + (b.assets?.length ?? 0) + (b.shortcuts?.length ?? 0)
    const fn = `clnote-备份-${timestamp()}.clnote`
    const path = await saveTextFileWithDialog(
      fn,
      JSON.stringify(b, null, 2),
      'application/json;charset=utf-8',
    )
    if (path) {
      setStorageMsg(
        `已导出整库备份（单个 .clnote 迁移文件）：${path}\n包含 ${b.nodes?.length ?? 0} 个文件树节点 · ${b.assets?.length ?? 0} 条素材 · ${b.shortcuts?.length ?? 0} 条快捷（共 ${total} 项）。把它拷到另一台设备，在「设置 → 文件存储 → 备份与恢复」用「从备份覆盖 / 合并」即可恢复。`,
      )
    } else {
      setStorageMsg(
        `已导出整库备份（单个 .clnote 迁移文件）${downloadLocationHint()}：共 ${total} 项（${b.nodes?.length ?? 0} 个文件树节点 · ${b.assets?.length ?? 0} 条素材 · ${b.shortcuts?.length ?? 0} 条快捷）。`,
      )
    }
  }

  const doRestore = async (mode: 'merge' | 'replace') => {
    const f = await pickTextFile('.json,.clnote')
    if (!f) return
    if (
      mode === 'replace' &&
      !(await confirmAsync('覆盖恢复会先清空当前全部内容，确定继续？建议先导出一份备份。'))
    )
      return
    try {
      const n = await restoreBackup(f.text, mode, { restoreSettings })
      // 设置已写入 localStorage + 应用 CSS；这里同步 React store，让设置页立即反映新偏好
      if (restoreSettings) {
        try {
          set(loadSettings())
        } catch {
          /* 忽略同步失败 */
        }
      }
      await loadNodes()
      await refreshStorage()
      setStorageMsg(
        `已${mode === 'replace' ? '覆盖' : '合并'}恢复 ${n} 条记录` +
          (restoreSettings ? '，并已应用备份中的设置' : ''),
      )
    } catch (e) {
      setStorageMsg(`恢复失败：${(e as Error).message}`)
    }
  }

  const pickDir = async () => {
    const p = await pickFolder()
    if (!p) return
    try {
      const r = await setDataDir(p)
      setDirInput(r)
      set({ dataDir: r })
      await refreshStorage()
      setStorageMsg(`数据目录已切换到：${r}`)
    } catch (e) {
      setStorageMsg((e as Error).message)
    }
  }

  return (
    <div className="modal-mask" onClick={() => setOpen(false)}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>设置</h3>
          <span className="modal-close" onClick={() => setOpen(false)}>
            ✕
          </span>
        </div>

        <div className="modal-body set-body">
          <nav className="set-nav">
            {SECTIONS.map((sec) => (
              <div
                key={sec.id}
                className={'set-nav-item' + (section === sec.id ? ' active' : '')}
                onClick={() => setSection(sec.id)}
              >
                <span className="set-nav-icon">{sec.icon}</span>
                {sec.label}
              </div>
            ))}
          </nav>

          <div className="set-page">
            {/* ---------------- 外观 ---------------- */}
            {section === 'appearance' && (
              <>
                <div className="set-row">
                  <span className="set-label">主题预设</span>
                  <div className="theme-chips">
                    {THEMES.map((t) => (
                      <div
                        key={t.id}
                        className={'theme-chip' + (s.theme === t.id ? ' active' : '')}
                        style={{ background: t.swatch }}
                        title={t.name}
                        onClick={() => set({ theme: t.id })}
                      />
                    ))}
                  </div>
                </div>

                <div className="set-row">
                  <span className="set-label">强调色</span>
                  <div className="swatches">
                    {ACCENTS.map((c) => (
                      <div
                        key={c}
                        className={'swatch' + (s.accent === c ? ' active' : '')}
                        style={{ background: c }}
                        onClick={() => set({ accent: c })}
                      />
                    ))}
                    <input
                      type="color"
                      value={s.accent}
                      onChange={(e) => set({ accent: e.target.value })}
                      className="set-color"
                      title="自定义强调色"
                    />
                  </div>
                </div>

                <FontSelect
                  label="界面字体"
                  value={s.uiFont}
                  list={TEXT_FONTS}
                  extra={localFonts}
                  onChange={(v) => set({ uiFont: v })}
                />
                <Range
                  label="界面字号"
                  value={s.uiFontSize}
                  min={12}
                  max={19}
                  step={1}
                  unit=" px"
                  onChange={(v) => set({ uiFontSize: v })}
                />
                <Range
                  label="侧栏宽度"
                  value={s.sidebarWidth}
                  min={200}
                  max={420}
                  step={10}
                  unit=" px"
                  onChange={(v) => set({ sidebarWidth: v })}
                />

                <div className="set-sep" />

                <div className="set-card">
                  <div className="set-card-title">分区域背景</div>
                  <div className="set-hint">
                    先设「整个软件背景」做全局底图；再按需为笔记、大纲、文件树、看板、思维导图单独设图，
                    单独设置会覆盖该区域的全局背景。不设置的区域自动沿用全局背景。
                  </div>
                </div>

                <RegionBgControl
                  label="整个软件背景（全局）"
                  value={s.bgGlobal}
                  onChange={(v) => set({ bgGlobal: v })}
                />
                <RegionBgControl
                  label="笔记编辑区背景"
                  value={s.bgNote}
                  onChange={(v) => set({ bgNote: v })}
                />
                <RegionBgControl
                  label="大纲区域背景"
                  value={s.bgOutline}
                  onChange={(v) => set({ bgOutline: v })}
                />
                <RegionBgControl
                  label="文件树区域背景"
                  value={s.bgTree}
                  onChange={(v) => set({ bgTree: v })}
                />
                <RegionBgControl
                  label="看板区域背景"
                  value={s.bgBoard}
                  onChange={(v) => set({ bgBoard: v })}
                />
                <RegionBgControl
                  label="思维导图背景"
                  value={s.bgMindmap}
                  onChange={(v) => set({ bgMindmap: v })}
                />
              </>
            )}

            {/* ---------------- 编辑器 ---------------- */}
            {section === 'editor' && (
              <>
                <div
                  className="font-preview"
                  style={{
                    fontFamily: s.editorFont,
                    fontSize: s.editorFontSize,
                    lineHeight: s.lineHeight,
                    letterSpacing: `${s.letterSpacing}em`,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>预览 · 春江花月夜</div>
                  春江潮水连海平，海上明月共潮生。滟滟随波千万里，何处春江无月明！
                  <div style={{ marginTop: `${s.paraSpacing}em` }}>
                    The quick brown fox jumps over the lazy dog. 0123456789
                  </div>
                </div>

                <FontSelect
                  label="正文字体"
                  value={s.editorFont}
                  list={TEXT_FONTS}
                  extra={localFonts}
                  onChange={(v) => set({ editorFont: v })}
                />
                <Range
                  label="正文字号"
                  value={s.editorFontSize}
                  min={13}
                  max={26}
                  step={1}
                  unit=" px"
                  onChange={(v) => set({ editorFontSize: v })}
                />
                <Range
                  label="行高"
                  value={s.lineHeight}
                  min={1.2}
                  max={2.6}
                  step={0.05}
                  onChange={(v) => set({ lineHeight: v })}
                />
                <Range
                  label="段间距"
                  value={s.paraSpacing}
                  min={0}
                  max={1.8}
                  step={0.1}
                  unit=" em"
                  onChange={(v) => set({ paraSpacing: v })}
                />
                <Range
                  label="字间距"
                  value={s.letterSpacing}
                  min={0}
                  max={0.2}
                  step={0.01}
                  unit=" em"
                  hint="中文排版通常 0–0.05em 之间即可"
                  onChange={(v) => set({ letterSpacing: v })}
                />
                <Range
                  label="正文区宽度"
                  value={s.editorWidth}
                  min={560}
                  max={1400}
                  step={20}
                  unit=" px"
                  onChange={(v) => set({ editorWidth: v })}
                />
                <FontSelect
                  label="代码字体"
                  value={s.codeFont}
                  list={CODE_FONTS}
                  extra={localFonts}
                  onChange={(v) => set({ codeFont: v })}
                />

                <div className="set-card-title">编辑区视图</div>
                <Range
                  label="编辑区缩放"
                  value={Math.round(s.editorZoom * 100)}
                  min={50}
                  max={300}
                  step={10}
                  unit="%"
                  hint="也可用 Ctrl / ⌘ + 滚轮 实时缩放，类似 Office"
                  onChange={(v) => set({ editorZoom: v / 100 })}
                />
                <Range
                  label="图片最大宽度"
                  value={s.imageWidth}
                  min={40}
                  max={100}
                  step={5}
                  unit="%"
                  hint="插入图片的显示上限（占编辑区宽度）。100% 表示铺满编辑区，图片永远不会超出编辑区"
                  onChange={(v) => set({ imageWidth: v })}
                />
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.clickZoom}
                    onChange={(e) => set({ clickZoom: e.target.checked })}
                  />
                  点击图片放大查看（灯箱）
                </label>

                <div className="set-sep" />

                <Range
                  label="自动保存间隔"
                  value={s.autosaveDelay}
                  min={200}
                  max={3000}
                  step={100}
                  unit=" ms"
                  hint="停止输入后多久写入存储，值越小越及时、写入越频繁"
                  onChange={(v) => set({ autosaveDelay: v })}
                />
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.smartPunctuation}
                    onChange={(e) => set({ smartPunctuation: e.target.checked })}
                  />
                  智能标点（输入左符号自动配对、回车跳出）
                </label>
                <div className="set-row">
                  <span className="set-label">引号风格</span>
                  <select
                    className="set-select"
                    disabled={!s.smartPunctuation}
                    value={s.smartQuoteStyle}
                    onChange={(e) => set({ smartQuoteStyle: e.target.value as 'straight' | 'corner' | 'chinese' })}
                  >
                    <option value="corner">中文角括号 「」『』（推荐：小说对话 / 中文引号）</option>
                    <option value="chinese">中文弯引号 “” ‘’（标准中文）</option>
                    <option value="straight">直引号 ' ' / " "</option>
                  </select>
                </div>
                <div className="set-hint">
                  选「中文角括号」后，输入英文 ' " 或中文弯引号 ‘’ “” 都会自动成对为「」『』，符合中文（尤其小说对话）排版。也可选用「中文弯引号」或「直引号」。需开启上方「智能标点」。
                </div>
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.spellcheck}
                    onChange={(e) => set({ spellcheck: e.target.checked })}
                  />
                  拼写检查（英文写作时开启）
                </label>
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.indentCN}
                    onChange={(e) => set({ indentCN: e.target.checked })}
                  />
                  回车段落首行缩进两格（中文排版：段首空两个中文字符）
                </label>
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.minimizeToTray}
                    onChange={(e) => set({ minimizeToTray: e.target.checked })}
                  />
                  关闭窗口时最小化到系统托盘（右下角），而非直接退出
                </label>
                <div className="set-hint">
                  参考微信 / QQ 等软件：点窗口右上角 ✕ 时收进系统托盘，点击托盘图标恢复，右键菜单可「退出」。关闭此选项则点 ✕ 直接退出。
                </div>

                <div className="set-sep" />

                <div className="set-card-title">写作辅助</div>
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.typewriter}
                    onChange={(e) => set({ typewriter: e.target.checked })}
                  />
                  打字机模式（光标始终居中，长文沉浸书写）
                </label>
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.typewriterSmooth}
                    onChange={(e) => set({ typewriterSmooth: e.target.checked })}
                  />
                  打字机滚动平滑（关闭则瞬时定位，长文逐字不晃）
                </label>
                <div className="set-row">
                  <span className="set-label">专注模式</span>
                  <select
                    className="set-select"
                    value={s.focusMode}
                    onChange={(e) => set({ focusMode: e.target.value as typeof s.focusMode })}
                  >
                    <option value="off">关闭</option>
                    <option value="paragraph">高亮当前段落（其余变淡）</option>
                    <option value="line">高亮当前行（其余变淡）</option>
                  </select>
                </div>
                <div className="set-hint">专注模式会在当前段落/行之外降低文字亮度，帮助集中注意力。</div>

                <div className="set-sep" />

                <div className="set-card-title">每日写作目标</div>
                <div className="set-row">
                  <span className="set-label">每日字数目标（0=不启用）</span>
                  <input
                    className="set-input"
                    type="number"
                    min={0}
                    step={100}
                    value={s.dailyGoal}
                    onChange={(e) => set({ dailyGoal: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
                <div className="set-hint">设置后编辑器底部状态条显示「目标 已写/目标」，达到目标变绿色。</div>

                <div className="set-sep" />

                <div className="set-card-title">卷 / 章编号</div>
                <div className="set-row">
                  <span className="set-label">卷编号风格</span>
                  <select
                    className="set-select"
                    value={s.volumeNumeral}
                    onChange={(e) =>
                      set({ volumeNumeral: e.target.value as typeof s.volumeNumeral })
                    }
                  >
                    <option value="cn">中文数字（第一卷）</option>
                    <option value="arabic">阿拉伯数字（第1卷）</option>
                  </select>
                </div>
                <div className="set-row">
                  <span className="set-label">章编号风格</span>
                  <select
                    className="set-select"
                    value={s.chapterNumeral}
                    onChange={(e) =>
                      set({ chapterNumeral: e.target.value as typeof s.chapterNumeral })
                    }
                  >
                    <option value="cn">中文数字（第一章）</option>
                    <option value="arabic">阿拉伯数字（第1章）</option>
                  </select>
                </div>
                <div className="set-hint">
                  新建小说创作时自动生成的卷/章、以及右键「新建卷/新建章」的自动续编号，都会按这里的风格命名（已存在的卷/章名称不改变）。
                </div>

                <div className="set-sep" />

                <div className="set-card-title">老板键</div>
                <div className="set-row">
                  <span className="set-label">隐藏 / 恢复快捷键</span>
                  <input
                    className="set-input"
                    style={{ maxWidth: 160 }}
                    value={s.bossKey}
                    onChange={(e) => set({ bossKey: e.target.value.trim() || 'F9' })}
                  />
                </div>
                <div className="set-hint">
                  按下该键隐藏全部内容（防窥），再按一次恢复。默认 F9。桌面端会真正最小化窗口到任务栏，
                  浏览器端则以全屏遮罩遮盖。改键后需重启软件生效。
                </div>

                <div className="set-hint">
                  内置字体仅保留「霞鹜文楷」，其余中文字体请在上方字体下拉的「本机字体」分组中选用；
                  {localFonts.length > 0
                    ? `已检测到 ${localFonts.length} 款本机字体。`
                    : '若分组为空，是浏览器限制了字体枚举，可改用桌面版获得完整本机字体列表。'}
                </div>
              </>
            )}

            {/* ---------------- 存储 ---------------- */}
            {section === 'storage' && (
              <>
                <div className="set-card">
                  <div className="set-card-title">当前存储位置</div>
                  {!info ? (
                    <div className="set-hint">读取中…</div>
                  ) : (
                    <>
                      <div className="set-kv">
                        <span>类型</span>
                        <b>{info.label}</b>
                      </div>
                      <div className="set-kv">
                        <span>位置</span>
                        <b className="set-path" title={info.path}>
                          {info.path}
                        </b>
                      </div>
                      <div className="set-kv">
                        <span>内容</span>
                        <b>
                          {info.folderCount} 个文件夹 · {info.noteCount} 篇文本 ·{' '}
                          {info.mindmapCount} 张导图
                        </b>
                      </div>
                      <div className="set-kv">
                        <span>占用</span>
                        <b>
                          {formatBytes(info.bytes)}
                          {info.quotaBytes ? ` / 可用配额 ${formatBytes(info.quotaBytes)}` : ''}
                        </b>
                      </div>
                    </>
                  )}
                </div>

                {info?.changeable ? (
                  <div className="set-row">
                    <span className="set-label">数据目录</span>
                    <div className="set-inline">
                      <button className="tb-btn primary" onClick={pickDir}>
                        选择目录…
                      </button>
                      <span className="set-path" title={dirInput || info?.path}>
                        {dirInput || info?.path || '（默认位置）'}
                      </span>
                    </div>
                    <div className="set-hint">
                      点击「选择目录」在文件管理器中选取一个文件夹作为数据存储位置（不再手输地址）；切换后原目录文件不会自动搬迁，可先导出备份再到新目录恢复。
                    </div>
                  </div>
                ) : (
                  <div className="set-row">
                    <span className="set-label">关于存储位置</span>
                    <div className="set-hint">
                      浏览器里运行时，数据由浏览器托管在本机 IndexedDB，无法指定磁盘路径；
                      清理浏览器数据会一并清空。想放到指定文件夹，请使用桌面版（Tauri
                      打包后此处会变成可填写的目录）。
                      <br />
                      现在可以用下面的「备份 / 恢复」在设备之间搬运数据。
                    </div>
                    <label className="set-check" style={{ marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={persisted}
                        onChange={async (e) => {
                          if (!e.target.checked) return
                          const ok = await requestPersistent()
                          setPersisted(ok)
                          setStorageMsg(
                            ok ? '已开启持久化存储' : '浏览器拒绝了持久化请求（可稍后再试）',
                          )
                        }}
                      />
                      申请持久化存储（降低被浏览器自动清理的风险）
                    </label>
                  </div>
                )}

                <div className="set-sep" />

                <div className="set-row">
                  <span className="set-label">备份与恢复</span>
                  <div className="set-inline wrap">
                    <button className="tb-btn primary" onClick={doBackup}>
                      导出整库备份（.clnote）
                    </button>
                    <button className="tb-btn" onClick={() => doRestore('merge')}>
                      从备份合并
                    </button>
                    <button className="tb-btn danger" onClick={() => doRestore('replace')}>
                      从备份覆盖
                    </button>
                    <button className="tb-btn" onClick={() => openImport(null)}>
                      📥 导入文件…
                    </button>
                    <button className="tb-btn" onClick={refreshStorage}>
                      刷新统计
                    </button>
                  </div>
                  <label className="set-check" style={{ marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={restoreSettings}
                      onChange={(e) => setRestoreSettings(e.target.checked)}
                    />
                    恢复时一并恢复设置（外观 / 编辑器 / 导出 / 番茄钟等偏好，随数据一起迁移）
                  </label>
                  <div className="set-hint">
                    <b>.clnote</b> 是把「全部本地数据」整合成的一个特殊格式迁移文件：包含文件树（笔记 / 思维导图 / 人物 / 情节 / 设定 / 地图 / 时间线）、素材库、快捷库及其分类，单个文件即可在设备间搬运。
                    合并：保留现有内容，冲突 id 自动重新编号；覆盖：清空后完全还原备份。
                    日常写作导出（Markdown / HTML 等）请用「导出」窗口，那里导出的是成品文档。
                  </div>
                  {storageMsg && <div className="set-msg">{storageMsg}</div>}
                </div>
              </>
            )}

            {/* ---------------- 导出 ---------------- */}
            {section === 'export' && (
              <>
                <div className="set-row">
                  <span className="set-label">默认导出格式</span>
                  <select
                    className="set-select"
                    value={s.exportFormat}
                    onChange={(e) =>
                      set({ exportFormat: e.target.value as typeof s.exportFormat })
                    }
                  >
                    <option value="md">Markdown (.md)</option>
                    <option value="html">网页 HTML (.html)</option>
                    <option value="txt">纯文本 (.txt)</option>
                    <option value="json">源数据 JSON (.json)</option>
                  </select>
                </div>

                <div className="set-row">
                  <span className="set-label">默认选项</span>
                  <label className="set-check">
                    <input
                      type="checkbox"
                      checked={s.exportKeepTree}
                      onChange={(e) => set({ exportKeepTree: e.target.checked })}
                    />
                    保留文件夹层级
                  </label>
                  <label className="set-check">
                    <input
                      type="checkbox"
                      checked={s.exportZip}
                      onChange={(e) => set({ exportZip: e.target.checked })}
                    />
                    多个文件时打包成 ZIP
                  </label>
                  <label className="set-check">
                    <input
                      type="checkbox"
                      checked={s.exportMerge}
                      onChange={(e) => set({ exportMerge: e.target.checked })}
                    />
                    合并成单个文件
                  </label>
                </div>

                <div className="set-row">
                  <span className="set-label">文件名前缀</span>
                  <select
                    className="set-select"
                    value={s.exportNamePrefix}
                    onChange={(e) =>
                      set({ exportNamePrefix: e.target.value as typeof s.exportNamePrefix })
                    }
                  >
                    <option value="none">不加前缀</option>
                    <option value="index">序号（01- 02-）</option>
                    <option value="date">日期（2026-08-10-）</option>
                  </select>
                </div>

                <div className="set-sep" />
                <div className="set-row">
                  <span className="set-label">立即导出</span>
                  <div className="set-inline wrap">
                    <button
                      className="tb-btn primary"
                      onClick={() => {
                        setOpen(false)
                        openExport(null)
                      }}
                    >
                      打开导出窗口
                    </button>
                  </div>
                  <div className="set-hint">
                    支持单个导出与批量导出：文本可导出 Markdown / HTML / TXT / JSON，
                    思维导图额外支持 OPML / SVG / PNG。
                  </div>
                </div>
              </>
            )}

            {/* ---------------- 番茄钟 ---------------- */}
            {section === 'pomodoro' && (
              <>
                <div className="set-card-title">番茄钟</div>
                <div className="set-hint" style={{ marginTop: -4 }}>
                  番茄钟常驻在顶部工具栏右侧（最大化 / 关闭按钮下方），点击胶囊可展开控制面板。
                </div>
                <Range
                  label="专注时长"
                  value={s.pomodoroWork}
                  min={5}
                  max={90}
                  step={5}
                  unit=" 分钟"
                  onChange={(v) => set({ pomodoroWork: v })}
                />
                <Range
                  label="短休息"
                  value={s.pomodoroShort}
                  min={1}
                  max={30}
                  step={1}
                  unit=" 分钟"
                  onChange={(v) => set({ pomodoroShort: v })}
                />
                <Range
                  label="长休息"
                  value={s.pomodoroLong}
                  min={5}
                  max={60}
                  step={5}
                  unit=" 分钟"
                  onChange={(v) => set({ pomodoroLong: v })}
                />
                <Range
                  label="长休息前专注轮数"
                  value={s.pomodoroRounds}
                  min={2}
                  max={8}
                  step={1}
                  unit=" 轮"
                  onChange={(v) => set({ pomodoroRounds: v })}
                />
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.pomodoroAutoStart}
                    onChange={(e) => set({ pomodoroAutoStart: e.target.checked })}
                  />
                  阶段结束自动开始下一段
                </label>
                <label className="set-check">
                  <input
                    type="checkbox"
                    checked={s.pomodoroNotify}
                    onChange={(e) => set({ pomodoroNotify: e.target.checked })}
                  />
                  阶段结束桌面通知（系统通知；未授权则提示音兜底）
                </label>
                <div className="set-row">
                  <span className="set-label">提示音</span>
                  <select
                    className="set-select"
                    value={s.pomodoroSound}
                    onChange={(e) => set({ pomodoroSound: e.target.value as 'beep' | 'none' })}
                  >
                    <option value="beep">滴声（Web Audio 合成）</option>
                    <option value="none">无</option>
                  </select>
                </div>
              </>
            )}

            {/* ---------------- 关于 ---------------- */}
            {section === 'about' && (
              <>
                <div className="set-card">
                  <div className="set-card-title">快捷键</div>
                  <div className="set-kv"><span>命令面板</span><b>Ctrl / Cmd + K</b></div>
                  <div className="set-kv"><span>设置</span><b>Ctrl / Cmd + ,</b></div>
                  <div className="set-kv"><span>导出</span><b>Ctrl / Cmd + E</b></div>
                  <div className="set-kv"><span>全局搜索</span><b>Ctrl / Cmd + F</b></div>
                  <div className="set-kv"><span>编辑区缩放</span><b>Ctrl / Cmd + 滚轮</b></div>
                  <div className="set-kv"><span>立即保存</span><b>Ctrl / Cmd + S</b></div>
                  <div className="set-kv"><span>老板键（隐藏 / 恢复）</span><b>{s.bossKey}</b></div>
                  <div className="set-kv"><span>关闭弹窗 / 搜索</span><b>Esc</b></div>
                  <div className="set-kv"><span>思维导图 · 新增同级</span><b>Enter（非编辑态）</b></div>
                  <div className="set-kv"><span>思维导图 · 新增子级</span><b>Tab</b></div>
                  <div className="set-kv"><span>思维导图 · 退出编辑</span><b>Enter（编辑态）</b></div>
                  <div className="set-kv"><span>智能标点 · 跳出配对</span><b>Enter</b></div>
                </div>

                <div className="set-card">
                  <div className="set-card-title">关于</div>
                  <div className="set-kv"><span>名称</span><b>{APP_NAME}</b></div>
                  <div className="set-kv"><span>版本</span><b>{APP_VERSION}</b></div>
                  <div className="set-kv"><span>开发者</span><b>{APP_DEV}</b></div>
                  <div className="set-kv"><span>技术栈</span><b>{APP_TECH}</b></div>
                </div>

                <div className="set-card">
                  <div className="set-card-title">主要功能</div>
                  {APP_FEATURES.map((f) => (
                    <div className="set-feature" key={f.title}>
                      <b>{f.title}</b>
                      <span>{f.desc}</span>
                    </div>
                  ))}
                </div>

                <div className="set-row">
                  <span className="set-label">重置</span>
                  <button
                    className="tb-btn danger"
                    onClick={async () => {
                      if (await confirmAsync('恢复全部设置为默认值？（不会影响笔记内容）')) reset()
                    }}
                  >
                    恢复默认设置
                  </button>
                </div>
              </>
            )}

            {/* ---------------- 库管理 ---------------- */}
            {section === 'libs' && (
              <>
                <div className="set-hint" style={{ marginBottom: 8 }}>
                  关闭某个库后，最左侧库栏将不再显示它的图标（不影响已存数据）。需要时可随时重新打开。
                </div>
                {LIB_ORDER.map((lib) => (
                  <div className="set-row" key={lib.key}>
                    <span className="set-label">
                      <span style={{ marginRight: 6 }}>{lib.icon}</span>
                      {lib.label}
                    </span>
                    <label className="set-check">
                      <input
                        type="checkbox"
                        checked={s.libs[lib.key] !== false}
                        onChange={(e) => {
                          const next = { ...s.libs, [lib.key]: e.target.checked }
                          set({ libs: next })
                          // 关闭当前正在使用的库时，自动切回文件库，避免库栏空指
                          if (!e.target.checked && sideTab === lib.key) setSideTab('tree')
                        }}
                      />
                      <span>{s.libs[lib.key] !== false ? '显示' : '已隐藏'}</span>
                    </label>
                  </div>
                ))}
                <div className="set-row">
                  <button
                    className="tb-btn"
                    onClick={() => {
                      set({ libs: { ...DEFAULT_LIBS } })
                      toast('已恢复全部库显示')
                    }}
                  >
                    全部显示
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
