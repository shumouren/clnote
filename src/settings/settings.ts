/**
 * 应用设置
 * ---------------------------------------------------------------
 * 设计参考 Obsidian / 思源笔记 / Typora：
 *   - 全部设置集中在一个对象里，localStorage 持久化
 *   - 视觉相关的项统一映射为 CSS 变量，改动即时生效、无需重渲染组件
 *   - 少量需要在非 React 代码里读到的项（自动保存间隔、智能标点开关）
 *     同步到 runtime 对象，供编辑器扩展直接读取
 */

export type ExportFormat = 'md' | 'html' | 'txt' | 'json'

import { BUILTIN_TYPES, type AssetTypeDef, type LibKey } from '../model/types'

// LibKey 的规范定义位于 model/types.ts，这里仅做再导出，保证既有 `from '../settings/settings'`
// 的导入（如 SettingsDialog）继续可用，避免重复定义导致维护分歧。
export type { LibKey }

/** 库栏中可显示的库；顺序即库栏从上到下的顺序 */
export const LIB_ORDER: { key: LibKey; icon: string; label: string }[] = [
  { key: 'shortcut', icon: '⚡', label: '快捷库' },
  { key: 'tree', icon: '📁', label: '文件库' },
  { key: 'material', icon: '📦', label: '素材库' },
  { key: 'creation', icon: '✍️', label: '创作库' },
  { key: 'media', icon: '🎞️', label: '媒体库' },
]

/** 默认全部库开启 */
export const DEFAULT_LIBS: Record<LibKey, boolean> = {
  shortcut: true,
  tree: true,
  material: true,
  creation: true,
  media: true,
}

export interface Settings {
  /* ---- 外观 ---- */
  theme: string
  accent: string
  uiFont: string
  uiFontSize: number
  sidebarWidth: number

  /* ---- 编辑器 ---- */
  editorFont: string
  editorFontSize: number
  lineHeight: number
  /** 段间距，单位 em */
  paraSpacing: number
  /** 字间距，单位 em */
  letterSpacing: number
  /** 正文区最大宽度 px */
  editorWidth: number
  codeFont: string

  /* ---- 行为 ---- */
  /** 自动保存防抖/防抖间隔 ms */
  autosaveDelay: number
  smartPunctuation: boolean
  /** 引号风格：straight=直引号 '' ""；corner=中文角括号「」『』；chinese=中文弯引号 “” ‘’ */
  smartQuoteStyle: 'straight' | 'corner' | 'chinese'
  spellcheck: boolean
  /** 回车后新段落首行缩进两格（中文排版：段首空两个中文字符） */
  indentCN: boolean
  /** 关闭窗口时最小化到系统托盘（右下角）而非直接退出；参考微信/QQ 等软件逻辑 */
  minimizeToTray: boolean

  /* ---- 存储 ---- */
  /** 桌面端自定义数据目录；浏览器端恒为空 */
  dataDir: string

  /* ---- 导出 ---- */
  exportFormat: ExportFormat
  /** 批量导出时保留文件夹层级 */
  exportKeepTree: boolean
  /** 多文件时打包成 zip */
  exportZip: boolean
  /** 批量导出合并成单个文件 */
  exportMerge: boolean
  exportNamePrefix: 'none' | 'index' | 'date'

  /* ---- 分区域背景 ---- */
  /** 整个软件（全局）背景 */
  bgGlobal: RegionBg
  /** 笔记编辑区背景 */
  bgNote: RegionBg
  /** 大纲区域背景 */
  bgOutline: RegionBg
  /** 文件树区域背景 */
  bgTree: RegionBg
  /** 看板区域背景 */
  bgBoard: RegionBg
  /** 思维导图区域背景 */
  bgMindmap: RegionBg
  /** 素材库的类型（收敛为 文本 / 文件 / 其他 三种） */
  assetTypes: AssetTypeDef[]

  /* ---- 库开关（库栏显示哪些库，默认全开） ---- */
  /** 各库是否在库栏显示；关闭则库栏隐藏该图标 */
  libs: Record<LibKey, boolean>

  /* ---- 写作辅助 ---- */
  /** 打字机模式：光标所在行始终保持在屏幕中央，长文沉浸书写 */
  typewriter: boolean
  /** 打字机滚动是否平滑（false=瞬时定位，避免长文逐字滚动时的晃动） */
  typewriterSmooth: boolean
  /** 专注模式：off=关闭；paragraph=高亮当前段落、其余变淡；line=高亮当前行、其余变淡 */
  focusMode: 'off' | 'line' | 'paragraph'
  /** 老板键（全局快捷键），如 "F9"：按下隐藏软件内容，再按恢复 */
  bossKey: string
  /** 每日写作字数目标（0=不启用）；状态条显示进度 */
  dailyGoal: number
  /** 卷编号风格：cn=中文数字（第一卷），arabic=阿拉伯数字（第1卷） */
  volumeNumeral: 'cn' | 'arabic'
  /** 章编号风格：cn=中文数字（第一章），arabic=阿拉伯数字（第1章） */
  chapterNumeral: 'cn' | 'arabic'

  /* ---- 番茄钟 ---- */
  /** 专注时长（分钟） */
  pomodoroWork: number
  /** 短休息时长（分钟） */
  pomodoroShort: number
  /** 长休息时长（分钟） */
  pomodoroLong: number
  /** 长休息前的专注轮数 */
  pomodoroRounds: number
  /** 阶段结束自动开始下一段 */
  pomodoroAutoStart: boolean
  /** 阶段结束桌面通知 */
  pomodoroNotify: boolean
  /** 提示音：beep=滴声 / none=无 */
  pomodoroSound: 'beep' | 'none'

  /* ---- 编辑区视图控制 ---- */
  /** 编辑区缩放（类似 Office 的 Ctrl+滚轮），1 = 100% */
  editorZoom: number
  /** 图片最大显示宽度，占编辑区宽度的百分比；100 表示铺满编辑区，图片永远不会超出编辑区 */
  imageWidth: number
  /** 点击编辑器内图片时放大查看（灯箱） */
  clickZoom: boolean
}

/** 单个区域的背景配置：图片 DataURL（空串表示无）、填充方式、遮罩浓度 0–70 */
export interface RegionBg {
  image: string
  mode: 'cover' | 'tile' | 'stretch'
  dim: number
}

export const SYSTEM_UI_STACK =
  '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'

export const SYSTEM_CODE_STACK =
  '"SFMono-Regular", Consolas, "Cascadia Mono", "Sarasa Mono SC", monospace'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  accent: '#2f6df6',
  uiFont: SYSTEM_UI_STACK,
  uiFontSize: 15,
  sidebarWidth: 260,

  editorFont: SYSTEM_UI_STACK,
  editorFontSize: 16,
  lineHeight: 1.8,
  paraSpacing: 0.6,
  letterSpacing: 0,
  editorWidth: 780,
  codeFont: SYSTEM_CODE_STACK,

  autosaveDelay: 600,
  smartPunctuation: true,
  smartQuoteStyle: 'chinese',
  spellcheck: false,
  indentCN: true,
  minimizeToTray: true,

  dataDir: '',

  exportFormat: 'md',
  exportKeepTree: true,
  exportZip: true,
  exportMerge: false,
  exportNamePrefix: 'none',

  /* ---- 分区域背景（默认均无图，由全局/主题底色兜底） ---- */
  bgGlobal: { image: '', mode: 'cover', dim: 35 },
  bgNote: { image: '', mode: 'cover', dim: 35 },
  bgOutline: { image: '', mode: 'cover', dim: 35 },
  bgTree: { image: '', mode: 'cover', dim: 35 },
  bgBoard: { image: '', mode: 'cover', dim: 35 },
  bgMindmap: { image: '', mode: 'cover', dim: 35 },
  assetTypes: BUILTIN_TYPES,

  /* ---- 库开关（默认全部开启） ---- */
  libs: { ...DEFAULT_LIBS },

  /* ---- 写作辅助（默认：专注模式关闭，老板键 F9） ---- */
  typewriter: false,
  typewriterSmooth: true,
  focusMode: 'off',
  bossKey: 'F9',
  dailyGoal: 0,
  volumeNumeral: 'cn',
  chapterNumeral: 'cn',

  /* ---- 番茄钟（默认：25 分钟专注 / 5 分钟短休 / 15 分钟长休，4 轮后长休） ---- */
  pomodoroWork: 25,
  pomodoroShort: 5,
  pomodoroLong: 15,
  pomodoroRounds: 4,
  pomodoroAutoStart: false,
  pomodoroNotify: true,
  pomodoroSound: 'beep',

  /* ---- 编辑区视图控制（默认：100% 缩放、图片铺满编辑区、点击图片放大） ---- */
  editorZoom: 1,
  imageWidth: 100,
  clickZoom: true,
}

/* ============================================================
   字体预设（偏中文排版）
   ============================================================ */

export interface FontPreset {
  id: string
  label: string
  /** 实际写入 CSS 的 font-family */
  stack: string
  /** 用于检测系统是否装了这款字体；留空表示一定可用 */
  probe?: string
  /** 是否适合作为正文字体（衬线体归到"阅读"一类，仅用于分组展示） */
  serif?: boolean
}

/** 内置字体分组：刻意收敛，只保留「系统默认 + 霞鹜文楷」，
 *  其余常用中文字体统一放到「本机字体」分组（见 getLocalFonts 与 COMMON_FALLBACK_FONTS）。 */
export const TEXT_FONTS: FontPreset[] = [
  { id: 'system', label: '系统默认', stack: SYSTEM_UI_STACK },
  {
    id: 'lxgw',
    label: '霞鹜文楷',
    stack: '"LXGW WenKai", "LXGW WenKai GB", serif',
    probe: 'LXGW WenKai',
    serif: true,
  },
]

export const CODE_FONTS: FontPreset[] = [
  { id: 'system-mono', label: '系统等宽', stack: SYSTEM_CODE_STACK },
]

/** 内置字体收敛后「下放」到「本机字体」分组的常用字体。
 *  当浏览器不支持 queryLocalFonts() 时，用 isFontAvailable 探测这些字体作为兜底，
 *  避免下拉只剩「系统默认 + 霞鹜文楷」两个选项。 */
export const COMMON_FALLBACK_FONTS: FontPreset[] = [
  { id: 'yahei', label: '微软雅黑', stack: '"Microsoft YaHei", "微软雅黑", sans-serif', probe: 'Microsoft YaHei' },
  { id: 'pingfang', label: '苹方', stack: '"PingFang SC", "苹方-简", sans-serif', probe: 'PingFang SC' },
  { id: 'hmos', label: '鸿蒙黑体', stack: '"HarmonyOS Sans SC", "HarmonyOS Sans", sans-serif', probe: 'HarmonyOS Sans SC' },
  { id: 'sourcehans', label: '思源黑体', stack: '"Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif', probe: 'Source Han Sans SC' },
  { id: 'sourcehanserif', label: '思源宋体', stack: '"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", serif', probe: 'Source Han Serif SC', serif: true },
  { id: 'simsun', label: '宋体', stack: '"SimSun", "宋体", serif', probe: 'SimSun', serif: true },
  { id: 'simhei', label: '黑体', stack: '"SimHei", "黑体", sans-serif', probe: 'SimHei' },
  { id: 'kaiti', label: '楷体', stack: '"KaiTi", "楷体", "STKaiti", serif', probe: 'KaiTi', serif: true },
  { id: 'fangsong', label: '仿宋', stack: '"FangSong", "仿宋", "STFangsong", serif', probe: 'FangSong', serif: true },
  { id: 'sarasa', label: '更纱黑体', stack: '"Sarasa Gothic SC", "Sarasa UI SC", sans-serif', probe: 'Sarasa Gothic SC' },
  { id: 'consolas', label: 'Consolas', stack: 'Consolas, monospace', probe: 'Consolas' },
  { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono", monospace', probe: 'JetBrains Mono' },
  { id: 'firacode', label: 'Fira Code', stack: '"Fira Code", monospace', probe: 'Fira Code' },
  { id: 'cascadia', label: 'Cascadia Code', stack: '"Cascadia Code", monospace', probe: 'Cascadia Code' },
  { id: 'sarasa-mono', label: '等距更纱黑体', stack: '"Sarasa Mono SC", monospace', probe: 'Sarasa Mono SC' },
]

/* ---- 字体可用性检测（canvas 量宽法，比 document.fonts.check 稳） ---- */
const availCache = new Map<string, boolean>()

export function isFontAvailable(probe?: string): boolean {
  if (!probe) return true
  const hit = availCache.get(probe)
  if (hit !== undefined) return hit
  let ok = true
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const sample = '中文测试Wgq89'
      ok = false
      for (const base of ['monospace', 'serif', 'sans-serif']) {
        ctx.font = `72px ${base}`
        const w0 = ctx.measureText(sample).width
        ctx.font = `72px "${probe}", ${base}`
        const w1 = ctx.measureText(sample).width
        if (Math.abs(w1 - w0) > 0.5) {
          ok = true
          break
        }
      }
    }
  } catch {
    ok = true
  }
  availCache.set(probe, ok)
  return ok
}

/** 由 font-family 字符串反查预设 id，认不出来就是 custom */
export function matchPreset(stack: string, list: FontPreset[]): string {
  const found = list.find((f) => f.stack === stack)
  return found ? found.id : 'custom'
}

/* ---- 本机字体枚举（Chromium / Tauri WebView 支持时，可列出系统已装字体） ---- */
let localFontCache: FontPreset[] | null = null

export async function getLocalFonts(): Promise<FontPreset[]> {
  if (localFontCache) return localFontCache
  const out: FontPreset[] = []
  try {
    const w = window as unknown as {
      queryLocalFonts?: () => Promise<{ family?: string; fullName?: string }[]>
    }
    if (typeof w.queryLocalFonts === 'function') {
      const list = await w.queryLocalFonts()
      const seen = new Set<string>()
      for (const f of list) {
        const fam = (f.family ?? '').trim()
        if (!fam || seen.has(fam)) continue
        seen.add(fam)
        // 本机字体用 family 名直接引用即可（系统已安装）
        out.push({
          id: 'loc-' + fam,
          label: fam,
          stack: `"${fam}", ${fam.includes('Mono') || fam.toLowerCase().includes('mono') ? 'monospace' : 'sans-serif'}`,
        })
        if (out.length >= 240) break
      }
    }
  } catch {
    /* 无权限或不支持时回退到探测常用字体 */
  }
  // queryLocalFonts 不可用 / 无权限 / 返回为空时，退化为用 canvas 量宽法探测常用字体，
  // 保证「本机字体」分组不至于为空（内置分组已收敛到只有系统默认 + 霞鹜文楷）。
  if (out.length === 0) {
    for (const f of COMMON_FALLBACK_FONTS) {
      if (isFontAvailable(f.probe)) out.push(f)
    }
  }
  localFontCache = out
  return out
}

/* ============================================================
   运行时开关：供非 React 代码（ProseMirror 扩展等）直接读取
   ============================================================ */
export const runtime = {
  autosaveDelay: DEFAULT_SETTINGS.autosaveDelay,
  smartPunctuation: DEFAULT_SETTINGS.smartPunctuation,
  smartQuoteStyle: DEFAULT_SETTINGS.smartQuoteStyle,
  focusMode: DEFAULT_SETTINGS.focusMode,
}

/* ============================================================
   持久化 + 应用
   ============================================================ */
const LS_KEY = 'clnote-settings'
const OLD_LS_KEY = 'ccc-notes-settings'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY) ?? localStorage.getItem(OLD_LS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Record<string, any>
    const s: Settings = { ...DEFAULT_SETTINGS, ...parsed }
    const defRegion = (): RegionBg => ({ image: '', mode: 'cover', dim: 35 })
    const normRegion = (v: any): RegionBg => ({ ...defRegion(), ...(v ?? {}) })
    // 旧版本只有单个 bgImage/bgMode/bgDim；迁移到「整个软件背景」
    if (typeof parsed.bgImage === 'string' && parsed.bgImage && !s.bgGlobal?.image) {
      s.bgGlobal = { image: parsed.bgImage, mode: parsed.bgMode ?? 'cover', dim: parsed.bgDim ?? 35 }
    }
    s.bgGlobal = normRegion(s.bgGlobal)
    s.bgNote = normRegion(s.bgNote)
    s.bgOutline = normRegion(s.bgOutline)
    s.bgTree = normRegion(s.bgTree)
    s.bgBoard = normRegion(s.bgBoard)
    s.bgMindmap = normRegion(s.bgMindmap)

    // 素材类型收敛：仅保留 文本 / 文件 / 其他 三种。
    // 旧版的 code/image/link/book 以及任何自定义类型，在 UI 上不再作为可选项；
    // 旧素材数据由 Rust 端 open() 一次性迁移到上述三类。
    const keepIds = new Set(BUILTIN_TYPES.map((t) => t.id))
    const hasRemoved =
      s.assetTypes.some((t) => !keepIds.has(t.id)) || !s.assetTypes.some((t) => t.id === 'other')
    if (hasRemoved) s.assetTypes = BUILTIN_TYPES

    // 库开关：旧配置可能没有 libs 字段，或某些库缺失 → 默认开启
    if (!s.libs || typeof s.libs !== 'object') s.libs = { ...DEFAULT_LIBS }
    for (const k of LIB_ORDER) {
      if (typeof s.libs[k.key] !== 'boolean') s.libs[k.key] = true
    }

    return s
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function persistSettings(s: Settings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 背景遮罩底色（与主题背景接近），让图片上的文字可读。
 *  必须返回 linear-gradient 这种合法的 <image> 类型——裸的 rgba(...) 是颜色值，
 *  直接作为 background-image 的一层会被浏览器判定为非法，导致整条 background-image
 *  声明被丢弃，背景图完全不渲染。 */
function bgScrim(theme: string, dimPct: number): string {
  const base: Record<string, string> = {
    light: '245,246,248',
    dark: '22,24,29',
    paper: '239,233,220',
    eye: '199,237,204',
  }
  const rgb = base[theme] ?? base.light
  const a = Math.max(0, Math.min(80, dimPct)) / 100
  return `linear-gradient(rgba(${rgb}, ${a}), rgba(${rgb}, ${a}))`
}

/** 把设置映射到 CSS 变量 + body 主题类 + runtime 开关 */
export function applySettings(s: Settings): void {
  const r = document.documentElement
  r.style.setProperty('--ui-font', s.uiFont)
  r.style.setProperty('--ui-font-size', `${s.uiFontSize}px`)
  r.style.setProperty('--sidebar-width', `${s.sidebarWidth}px`)

  r.style.setProperty('--editor-font', s.editorFont)
  r.style.setProperty('--editor-font-size', `${s.editorFontSize}px`)
  r.style.setProperty('--editor-line-height', String(s.lineHeight))
  r.style.setProperty('--editor-para-spacing', `${s.paraSpacing}em`)
  r.style.setProperty('--editor-letter-spacing', `${s.letterSpacing}em`)
  r.style.setProperty('--editor-width', `${s.editorWidth}px`)
  r.style.setProperty('--code-font', s.codeFont)
  // 图片最大显示宽度（占编辑区百分比）：保证图片永远不会超出编辑区
  r.style.setProperty('--img-width', `${s.imageWidth}%`)

  r.style.setProperty('--accent-user', s.accent)
  document.body.className = `theme-${s.theme}`
  // 中文段首缩进两格（回车后新段落首行空两格）
  document.body.classList.toggle('indent-cn', s.indentCN)

  // 分区域背景：把每个区域的图片/遮罩/填充方式写进以 --bg-<区域>-* 命名的 CSS 变量。
  // 无图时变量为 none，容器退化为透明、露出「整个软件」的全局背景。
  const regions: [string, RegionBg][] = [
    ['global', s.bgGlobal],
    ['note', s.bgNote],
    ['outline', s.bgOutline],
    ['tree', s.bgTree],
    ['board', s.bgBoard],
    ['mindmap', s.bgMindmap],
  ]
  for (const [prefix, bg] of regions) {
    const hasBg = !!bg.image
    r.style.setProperty(`--bg-${prefix}-image`, hasBg ? `url("${bg.image}")` : 'none')
    r.style.setProperty(`--bg-${prefix}-scrim`, hasBg ? bgScrim(s.theme, bg.dim) : 'none')
    const mode = hasBg ? bg.mode : 'cover'
    r.style.setProperty(
      `--bg-${prefix}-size`,
      mode === 'cover' ? 'cover' : mode === 'stretch' ? '100% 100%' : 'auto',
    )
    r.style.setProperty(`--bg-${prefix}-repeat`, mode === 'tile' ? 'repeat' : 'no-repeat')
  }

  runtime.autosaveDelay = s.autosaveDelay
  runtime.smartPunctuation = s.smartPunctuation
  runtime.smartQuoteStyle = s.smartQuoteStyle
  runtime.focusMode = s.focusMode
}
