/** 文件树 / 思维导图 数据模型 */

export type NodeType = 'folder' | 'note' | 'mindmap' | 'board' | 'timeline' | 'character' | 'plot' | 'setting' | 'map'

/** 文件树节点（文件夹 / 文本笔记 / 思维导图） */
export interface FsNode {
  id: string
  type: NodeType
  name: string
  parentId: string | null
  /** note: TipTap JSON；mindmap: MindMapDoc；folder: null */
  content: unknown
  /** note 纯文本缓存，便于列表展示 */
  text?: string
  /** 同级排序，越小越靠前 */
  order: number
  updatedAt: number
  createdAt: number
  /** 所属库：'file'=文本库；'creation'=创作库。旧数据缺省按 'file' 处理 */
  lib?: 'file' | 'creation'
  /** 创作库子类型：'novel'=小说创作；'volume'=卷；'chapter'=章；缺省为普通节点 */
  kind?: string | null
  /** 引用指针：非空表示该节点是「引用」另一节点的"快捷方式"。
   *  当前用于创作库引用文本库的思维导图——真正内容存在 refId 指向的节点，
   *  本节点只存指针（content 不单独保存），编辑时写回被引用节点，实现"一处改全局生效"。 */
  refId?: string | null
}

/** 伏笔（标注）：每个小说创作下所有章的伏笔集中存于此，便于"伏笔栏"聚合展示 */
export interface ForeshadowRow {
  id: string
  /** 所属小说创作 id */
  novelId: string
  /** 所在章（笔记）id */
  chapterId: string
  /** 锚定的正文文本片段 */
  snippet: string
  /** 0=未完成，1=完成 */
  done: number
  /** 备注（可选） */
  note: string
  /** 排序，越小越靠前（写入时一般用创建时间） */
  orderIdx: number
  /** 创建时间（毫秒） */
  createdAt: number
}

/** 思维导图中的单个节点（树结构） */
export interface MindNode {
  id: string
  text: string
  collapsed?: boolean
  /** 节点备注：长文本，默认隐藏，可展开编辑 */
  note?: string
  children: MindNode[]
}

/** 思维导图文档：只有一个根节点 */
export interface MindMapDoc {
  root: MindNode
}

export function emptyMindMap(): MindMapDoc {
  return {
    root: {
      id: newId(),
      text: '中心主题',
      children: [],
    },
  }
}

/* ============================================================
   任务看板（Kanban）
   ============================================================ */

export type Priority = '' | 'low' | 'mid' | 'high'

/** 标签（彩色） */
export interface Label {
  id: string
  name: string
  color: string
}

/** 循环规则：每日/每周/每月/每年，间隔可配；重生时机可选 */
export interface Recurrence {
  unit: 'day' | 'week' | 'month' | 'year'
  interval: number
  /** onComplete: 勾选完成时重生下一周期；onDue: 到期时自动重生 */
  regen: 'onComplete' | 'onDue'
}

/** 单个任务卡片 */
export interface TaskCard {
  id: string
  columnId: string
  title: string
  note?: string
  done: boolean
  /** 标签 id 列表 */
  labels: string[]
  priority: Priority
  /** 截止日期 yyyy-mm-dd（选填） */
  due?: string | null
  /** 截止具体时刻 HH:MM（选填） */
  dueTime?: string | null
  recurrence?: Recurrence | null
  /** 同列内排序，越小越靠前 */
  order: number
  completedAt?: number | null
  createdAt: number
}

/** 看板的一列（如 待办/进行中/已完成） */
export interface BoardColumn {
  id: string
  name: string
}

/** 看板文档 */
export interface BoardDoc {
  columns: BoardColumn[]
  tasks: TaskCard[]
  labels: Label[]
}

/** 把 due 按循环规则顺延到下一周期；无 due 则返回 null */
export function advanceDue(due: string | null | undefined, rec: Recurrence): string | null {
  if (!due) return null
  const d = new Date(due + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  if (rec.unit === 'day') d.setDate(d.getDate() + rec.interval)
  else if (rec.unit === 'week') d.setDate(d.getDate() + rec.interval * 7)
  else if (rec.unit === 'month') d.setMonth(d.getMonth() + rec.interval)
  else if (rec.unit === 'year') d.setFullYear(d.getFullYear() + rec.interval)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function emptyBoard(): BoardDoc {
  return {
    columns: [
      { id: newId(), name: '待办' },
      { id: newId(), name: '进行中' },
      { id: newId(), name: '已完成' },
    ],
    tasks: [],
    labels: [
      { id: 'lb-red', name: '重要', color: '#e5484d' },
      { id: 'lb-blue', name: '工作', color: '#2f6df6' },
      { id: 'lb-green', name: '生活', color: '#3aa675' },
    ],
  }
}

/* ============================================================
   时间线（Timeline）—— 竖向树状
   - 文档是一组「时间线」(roots)，每条时间线是一棵竖向生长的树：
       · 根节点 = 一条时间线的标题；根之下的子节点沿竖线向下排列（自动连线）
       · 回车 = 在同一条线上加「同级」（继续向下），Tab = 加「子节点」（向下分叉）
   - 多条时间线在画布上并排成列（自动竖着排列）
   - 拖动某节点到另一条时间线上的节点 → 两条时间线「相交」（新增一条跨时间线连线），
     不移动、不删除任何节点，两条时间线各自保持完整
   ============================================================ */

/** 时间线里的一个节点（树结构，与思维导图一致） */
export interface TimeNode {
  id: string
  /** 节点文本（可多行） */
  text: string
  /** 折叠子节点 */
  collapsed?: boolean
  /** 长文本备注（默认隐藏） */
  note?: string
  children: TimeNode[]
}

/** 时间线文档：roots 中每个元素即一条独立的时间线（竖向树） */
export interface TimelineDoc {
  roots: TimeNode[]
  /** 跨时间线相交连线（拖动节点到另一条时间线节点时产生）：from 指向 to，不改动树结构 */
  links?: TimelineLink[]
}

/** 跨时间线连接（相交）：一条从 from 节点指向 to 节点的连线，本身不移动任何节点 */
export interface TimelineLink {
  from: string
  to: string
}

export function makeTimeNode(text: string): TimeNode {
  return { id: newId(), text, children: [] }
}

export function emptyTimeline(): TimelineDoc {
  return { roots: [makeTimeNode('时间线 1')] }
}

/** 把任意 content 规整为新的 TimelineDoc（兼容旧版自由画布 {nodes,edges}） */
export function normalizeTimeline(content: unknown): TimelineDoc {
  if (!content || typeof content !== 'object') return emptyTimeline()
  const d = content as Record<string, unknown>
  if (Array.isArray(d.roots)) {
    const fix = (n: Record<string, unknown>): TimeNode => ({
      id: typeof n.id === 'string' && n.id ? n.id : newId(),
      text: typeof n.text === 'string' ? n.text : '',
      collapsed: !!n.collapsed,
      note: typeof n.note === 'string' ? n.note : undefined,
      children: Array.isArray(n.children) ? (n.children as Record<string, unknown>[]).map(fix) : [],
    })
    return {
      roots: (d.roots as Record<string, unknown>[]).map(fix),
      links: Array.isArray(d.links)
        ? (d.links as Record<string, unknown>[])
            .map((l) => ({ from: String(l.from ?? ''), to: String(l.to ?? '') }))
            .filter((l) => l.from && l.to)
        : undefined,
    }
  }
  // 旧版自由画布：把所有节点按顺序收进一条时间线作为子节点
  if (Array.isArray(d.nodes)) {
    const root = makeTimeNode('时间线 1')
    root.children = (d.nodes as Record<string, unknown>[]).map((n) =>
      makeTimeNode(typeof n?.text === 'string' ? (n.text as string) : ''),
    )
    return { roots: [root] }
  }
  return emptyTimeline()
}

/* ============================================================
   角色管理（Character）—— 角色卡集合
   - 一个 character 节点 = 一个"角色总览"集合，包含所有角色卡（items）
   - 字段按需求：基础信息（姓名/别名/性别/年龄/身份职业）、外貌与性格（外貌/性格）、备注
   - relations：角色间关系连线（关系图用），type 为关系类型（师徒/恋人/仇敌/亲属/朋友/其他）
   ============================================================ */

/** 单个角色卡 */
/** 角色自定义属性（名自定义，如 性格/优点/缺点/习惯/口头禅） */
export interface CharacterAttr {
  id: string
  /** 属性名（用户自定义） */
  name: string
  /** 属性值 */
  value: string
}

/** 单个角色卡 */
export interface Character {
  id: string
  /** 姓名（必填） */
  name: string
  /** 标签：共享标签池中的子集 */
  tags: string[]
  /** 角色属性（可新建、名字自定义） */
  attrs: CharacterAttr[]
  /** 人物小传（自由文本） */
  bio: string

  /** 关系图里的自由坐标（未设置则按默认网格排布） */
  x?: number
  y?: number
}

/** 角色之间的关系连线 */
export interface CharacterRelation {
  from: string
  to: string
  /** 关系类型：师徒/恋人/仇敌/亲属/朋友/其他 */
  type: string
}

/** 角色文档：一个角色集合节点持有全部角色卡 + 关系 + 共享标签池 */
export interface CharacterDoc {
  items: Character[]
  relations?: CharacterRelation[]
  /** 共享标签池：所有角色卡片共用的标签集合 */
  tagPool: string[]
  /** 关系类型池：可自定义，用于连线选择 */
  relTypes?: string[]
}

/** 默认角色属性模板 */
const DEFAULT_ATTRS = ['性格', '优点', '缺点', '习惯', '口头禅']
const DEFAULT_REL_TYPES = ['师徒', '恋人', '仇敌', '亲属', '朋友', '其他']

export function makeCharacter(name = ''): Character {
  return {
    id: newId(),
    name,
    tags: [],
    attrs: DEFAULT_ATTRS.map((n) => ({ id: newId(), name: n, value: '' })),
    bio: '',
  }
}

export function emptyCharacter(): CharacterDoc {
  return { items: [makeCharacter()], relations: [], tagPool: [], relTypes: [...DEFAULT_REL_TYPES] }
}

/** 把任意 content 规整为 CharacterDoc（兼容旧版字段迁移） */
export function normalizeCharacter(content: unknown): CharacterDoc {
  if (!content || typeof content !== 'object') return emptyCharacter()
  const d = content as Record<string, unknown>

  const items: Character[] = Array.isArray(d.items)
    ? (d.items as Record<string, unknown>[]).map((c) => {
        const id = typeof c.id === 'string' && c.id ? c.id : newId()
        const name = typeof c.name === 'string' ? c.name : ''
        let attrs: CharacterAttr[] = Array.isArray(c.attrs)
          ? (c.attrs as Record<string, unknown>[])
              .map((a) => ({
                id: typeof a.id === 'string' && a.id ? a.id : newId(),
                name: typeof a.name === 'string' ? a.name : '',
                value: typeof a.value === 'string' ? a.value : '',
              }))
              .filter((a) => a.name)
          : []
        if (attrs.length === 0) {
          const legacy: Record<string, string> = {
            身份: typeof c.identity === 'string' ? c.identity : '',
            性格: typeof c.personality === 'string' ? c.personality : '',
            外貌: typeof c.appearance === 'string' ? c.appearance : '',
            别名: typeof c.alias === 'string' ? c.alias : '',
            性别: typeof c.gender === 'string' ? c.gender : '',
            年龄: typeof c.age === 'string' ? c.age : '',
          }
          attrs = Object.entries(legacy)
            .filter(([, v]) => v)
            .map(([k, v]) => ({ id: newId(), name: k, value: v }))
        }
        const bio =
          typeof c.bio === 'string' && c.bio
            ? c.bio
            : typeof c.note === 'string'
              ? c.note
              : ''
        const tags = Array.isArray(c.tags)
          ? (c.tags as unknown[]).filter((t) => typeof t === 'string') as string[]
          : []
        return {
          id,
          name,
          tags,
          attrs,
          bio,
          x: typeof c.x === 'number' ? c.x : undefined,
          y: typeof c.y === 'number' ? c.y : undefined,
        }
      })
    : []
  const relations: CharacterRelation[] = Array.isArray(d.relations)
    ? (d.relations as Record<string, unknown>[])
        .map((r) => ({
          from: String(r.from ?? ''),
          to: String(r.to ?? ''),
          type: typeof r.type === 'string' && r.type ? r.type : '其他',
        }))
        .filter((r) => r.from && r.to)
    : []
  const tagPool = Array.isArray(d.tagPool)
    ? (d.tagPool as unknown[]).filter((t) => typeof t === 'string') as string[]
    : []
  const relTypes = Array.isArray(d.relTypes)
    ? (d.relTypes as unknown[]).filter((t) => typeof t === 'string') as string[]
    : [...DEFAULT_REL_TYPES]

  if (items.length === 0) items.push(makeCharacter())
  return { items, relations, tagPool, relTypes }
}

/** 生成 id（不依赖 uuid 库） */
export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  )
}

/* ============================================================
   素材库（Material Library）
   - 复用的"片段/素材"：文本、代码、图片、链接、文件
   - 独立于文件树，存在单独的 IndexedDB 库（assets），随应用持久化
   ============================================================ */
/** 素材的"形态"：决定编辑/渲染布局。
 *  现收敛为 文本 / 文件 / 其他 三种；code/image/link/book 仅作为旧数据的兼容回退值。 */
export type AssetType = 'text' | 'code' | 'image' | 'link' | 'file' | 'book' | 'other'

/**
 * 素材类型（标签）。内置 文本 / 文件 / 其他 三种；「其他」可同时承载文本与文件。
 * 每个类型带一个"形态(kind)"，决定编辑与渲染方式。
 */
export interface AssetTypeDef {
  id: string
  label: string
  icon: string
  kind: AssetType
  builtin?: boolean
}

/** 素材类型收敛为 文本 / 文件 / 其他 三种（「其他」可同时承载文本与文件） */
export const BUILTIN_TYPES: AssetTypeDef[] = [
  { id: 'text', label: '文本', icon: '📝', kind: 'text', builtin: true },
  { id: 'file', label: '文件', icon: '📄', kind: 'file', builtin: true },
  { id: 'other', label: '其他', icon: '📦', kind: 'other', builtin: true },
]

/** 分类种类：主题 / 文件夹（两者可互相嵌套） */
export type AssetCategoryKind = 'theme' | 'folder'

/** 素材分类（侧边栏里的"灵感""法宝"等，可建文件夹并互相嵌套） */
export interface AssetCategory {
  id: string
  kind: AssetCategoryKind
  name: string
  icon: string
  /** 父分类 id；null 表示位于根层 */
  parentId: string | null
  /** 同层排序，越小越靠前 */
  order: number
  /** 是否"默认主题"：标记后不可删除，避免误删核心结构 */
  builtin?: boolean
}

/** 生成一个分类对象 */
export function newCategory(
  kind: AssetCategoryKind,
  name: string,
  parentId: string | null,
  order: number,
): AssetCategory {
  return {
    id: 'cat_' + newId(),
    kind,
    name,
    icon: kind === 'folder' ? '📁' : '🔖',
    parentId,
    order,
  }
}

export interface Asset {
  id: string
  /** 形态（决定编辑/渲染布局） */
  type: AssetType
  title: string
  /** 文本/代码/链接/书籍说明的文本内容；image 类型可为空 */
  content: string
  /** 链接地址（link 必填；book 可为购买/封面链接） */
  url?: string
  /** 图片 dataURL（image 必填；book 可为封面） */
  image?: string
  /** 文件 dataURL（file 类型：从本地上传并保存的内容） */
  file?: string
  /** 文件名（file 类型展示用） */
  fileName?: string
  /** 书籍作者（book 用） */
  author?: string
  tags: string[]
  /** 用户自定义类型 id（引用 AssetTypeDef）；空串表示未分类 */
  typeId: string
  /** 所属分类 id（主题/文件夹）；空串表示未归类（在"全部素材"可见） */
  categoryId: string
  /** 看板内排列顺序，越小越靠前；缺省按 updatedAt */
  order?: number
  createdAt: number
  updatedAt: number
}

/** 阅读库的书籍笔记（定位采用「章节 + 锚点 + 百分比」推荐方案） */
export interface BookNote {
  id: string
  /** 书籍在用户磁盘上的绝对路径（书籍文件本身不入库，仅记路径） */
  bookPath: string
  /** 书籍显示名（文件名或书名） */
  bookName: string
  /** 章节标题（可选） */
  chapter?: string
  /** 锚点标识（用于跳回原书位置，可选） */
  anchor?: string
  /** 阅读进度百分比 0–100（可选） */
  percent?: number
  /** 笔记摘要 / 批注文本 */
  text: string
  /** 创建时间戳 */
  createdAt: number
}

/* ================ v3 新库（统一「媒体库」）基础设施类型 ================ */

export type LibKey =
  | 'shortcut'
  | 'tree'
  | 'material'
  | 'creation'
  | 'media'

/** 媒体文件按扩展名归类的「种类」，决定用哪个查看器打开 */
export type MediaKind = 'book' | 'audio' | 'video' | 'text' | 'image'

/** 已挂载的用户磁盘文件夹（统一「媒体库」共用；旧版 reading/music/video 记录兼容） */
export interface MountedFolder {
  id: string
  /** 'media'（旧版可能为 'reading' | 'music' | 'video'，由列表查询兼容返回） */
  lib: LibKey
  /** 用户磁盘上的绝对路径 */
  path: string
  /** 显示名（默认取文件夹名） */
  name: string
  createdAt: number
  /** 排序序号（拖拽排序用），越小越靠前 */
  orderIdx?: number
}

/** 媒体库某分栏里当前展示的一个条目（书 / 音频 / 视频 / 图片） */
export interface MediaSlot {
  entry: DiskEntry
  kind: MediaKind
  /** 同文件夹的同类媒体列表（上一首 / 下一张用）；音频、视频、图片会有 */
  playlist?: DiskEntry[]
  /** 视频：视频路径 → 同名 .vtt/.srt 字幕条目，自动挂字幕用 */
  subs?: Record<string, DiskEntry>
}

/** 书籍阅读进度 */
export interface BookProgress {
  /** 书籍文件绝对路径（主键） */
  bookPath: string
  /** 阅读器定位锚点（epub.js 的 CFI / pdf 的页码等） */
  cfi?: string
  /** 进度百分比 0–100 */
  percent: number
  updatedAt: number
}

/** 媒体（音乐 / 视频）播放进度（记忆播放用） */
export interface MediaProgress {
  /** 媒体文件绝对路径（主键） */
  mediaPath: string
  /** 已播放到的秒数 */
  position: number
  /** 总时长（秒） */
  duration: number
  updatedAt: number
}

/** 磁盘扫描返回的单条条目（scanFolder 用，不入库，仅在前端构建文件树） */
export interface DiskEntry {
  /** 绝对路径 */
  path: string
  /** 文件名 / 目录名 */
  name: string
  /** 是否为目录 */
  isDir: boolean
  /** 文件大小（字节）；目录为 0 */
  size: number
  /** 修改时间（毫秒时间戳） */
  modified: number
  /** 扩展名（小写，不含点）；目录为空 */
  ext: string
}

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  text: '文本',
  code: '代码',
  image: '图片',
  link: '链接',
  file: '文件',
  book: '文件',
  other: '其他',
}

export const ASSET_TYPE_ICON: Record<AssetType, string> = {
  text: '📝',
  code: '💻',
  image: '🖼️',
  link: '🔗',
  file: '📄',
  book: '📄',
  other: '📦',
}

export function emptyAsset(type: AssetType): Asset {
  const now = Date.now()
  return {
    id: newId(),
    type,
    title: '',
    content: '',
    tags: [],
    typeId: '',
    categoryId: '',
    createdAt: now,
    updatedAt: now,
  }
}

/* ============================================================
   快捷库（Shortcuts）
   - 与素材库结构类似，但素材只有 3 种：本地文件夹 / 浏览器链接 / 笔记
   - 分类（主题/文件夹）同样可互相嵌套
   - 独立的 IndexedDB 库（shortcuts），不混入素材库数据
   ============================================================ */
/** 快捷素材的三种类型 */
export type ShortcutKind = 'folder' | 'link' | 'note'

export const SHORTCUT_KIND_META: Record<ShortcutKind, { label: string; icon: string }> = {
  folder: { label: '快捷文件夹', icon: '📂' },
  link: { label: '快捷链接', icon: '🔗' },
  note: { label: '快捷笔记', icon: '📝' },
}

/** 一条快捷素材 */
export interface ShortcutItem {
  id: string
  kind: ShortcutKind
  /** 名称（三类都有） */
  title: string
  /** 快捷文件夹：本地文件夹绝对路径 */
  path?: string
  /** 快捷链接：浏览器地址 */
  url?: string
  /** 快捷笔记：正文内容 */
  content?: string
  tags: string[]
  /** 所属分类 id（主题/文件夹）；空串表示未归类（在"全部快捷"可见） */
  categoryId: string
  /** 同分类内排列顺序，越小越靠前 */
  order?: number
  createdAt: number
  updatedAt: number
}

export function emptyShortcut(kind: ShortcutKind, categoryId: string): ShortcutItem {
  const now = Date.now()
  return {
    id: 'sc_' + newId(),
    kind,
    title: '',
    tags: [],
    categoryId,
    createdAt: now,
    updatedAt: now,
  }
}



/* ============================================================
   剧情（Plot）—— 多模式情节编排
   四种模式（情节看板 / 大纲 / 时间线 / 关系图）共享同一份"情节项" PlotItem[]。
   统一用"树结构 + 数字标号"组织，避免不按顺序添加导致各模式顺序错乱：
     · 顶层最多 4 个根节点，固定对应 起 / 承 / 转 / 合；
     · 每个节点最多 10 个子节点；
     · 从顶层起最多再往下 3 层（共 4 层）。
   数字标号由树结构自动派生（起=1，其下第 1 个子=10，再下=100…），
   各视图统一按派生标号排序/展示，切换模式不丢数据。
   ============================================================ */

/** 剧情模式 */
export type PlotMode = 'board' | 'outline' | 'timeline' | 'graph'

/** 一个情节项（剧情最小单元）；四种模式共享同一份 items */
export interface PlotItem {
  id: string
  /** 事件名 */
  title: string
  /** 摘要 / 情节要点 */
  summary: string
  /** 关联角色卡 id 列表 */
  charIds: string[]
  /** 关联伏笔 fid 列表 */
  foreshadowIds: string[]
  /** 父项 id（'' 或 undefined 表示顶层/起承转合之一） */
  parentId?: string
  /** 同层排序，越小越靠前 */
  order?: number
  /** 关系图模式：自由坐标（左上角） */
  x?: number
  y?: number
}

/** 关系图里的因果连线 */
export interface PlotEdge {
  from: string
  to: string
  /** 连线说明（可选，如"因→果"） */
  label?: string
}

/** 剧情文档 */
export interface PlotDoc {
  mode: PlotMode
  /** 全部情节项（四种模式共享） */
  items: PlotItem[]
  /** 关系图连线（仅 graph 模式使用） */
  edges?: PlotEdge[]
}

/** 顶层固定四阶段（起承转合） */
export const PLOT_ROOTS = ['起', '承', '转', '合'] as const
/** 顶层最大数量 */
export const PLOT_MAX_ROOTS = 4
/** 每个节点最大子节点数 */
export const PLOT_MAX_CHILDREN = 10
/** 从顶层起最大层级（顶层为第 1 层） */
export const PLOT_MAX_DEPTH = 4

/** 新建剧情时可选的模式（顺序即展示顺序） */
export const PLOT_MODES: { key: PlotMode; label: string; icon: string; desc: string }[] = [
  { key: 'board', label: '情节看板', icon: '🎬', desc: '按起/承/转/合四阶段分列，拖拽编排' },
  { key: 'outline', label: '大纲', icon: '📑', desc: '树状层级：卷→章→场景，逐层展开' },
  { key: 'timeline', label: '时间线', icon: '⏳', desc: '按数字标号（故事顺序）串联事件' },
  { key: 'graph', label: '关系图', icon: '🕸️', desc: '自由画布 + 因果连线，梳理情节网络' },
]

export const PLOT_MODE_LABEL: Record<PlotMode, string> = {
  board: '情节看板',
  outline: '大纲',
  timeline: '时间线',
  graph: '关系图',
}

/** 派生布局：数字标号、所属根、深度、前序（故事）顺序 */
export interface PlotLayout {
  /** id -> 数字标号（起=1，子=父×10+序号） */
  label: Map<string, number>
  /** id -> 所属根节点 id（自身为根时为自己） */
  rootId: Map<string, string>
  /** id -> 深度（根为 0） */
  depth: Map<string, number>
  /** 前序遍历的 id 顺序（故事阅读顺序） */
  order: string[]
}

/** 由 items 派生标号与前序顺序；四个视图与导出统一使用 */
export function layoutPlot(items: PlotItem[]): PlotLayout {
  const byParent = new Map<string, PlotItem[]>()
  items.forEach((it) => {
    const p = it.parentId || ''
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(it)
  })
  byParent.forEach((arr) => arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))

  const label = new Map<string, number>()
  const rootId = new Map<string, string>()
  const depth = new Map<string, number>()
  const order: string[] = []

  const walk = (it: PlotItem, parentLabel: number, root: string, d: number) => {
    const sibs = byParent.get(it.parentId || '') ?? []
    const idx = Math.max(0, sibs.findIndex((s) => s.id === it.id))
    const lab = d === 0 ? (it.order ?? 0) + 1 : parentLabel * 10 + idx
    label.set(it.id, lab)
    rootId.set(it.id, root)
    depth.set(it.id, d)
    order.push(it.id)
    ;(byParent.get(it.id) ?? []).forEach((k) => walk(k, lab, root, d + 1))
  }

  ;(byParent.get('') ?? []).forEach((r) => walk(r, 0, r.id, 0))
  return { label, rootId, depth, order }
}

function seedRoots(): PlotItem[] {
  return (PLOT_ROOTS as readonly string[]).map((name, i) => ({
    id: newId(),
    title: name,
    summary: '',
    charIds: [],
    foreshadowIds: [],
    parentId: '',
    order: i,
  }))
}

export function makePlot(mode: PlotMode = 'board'): PlotDoc {
  const roots = seedRoots()
  // 一个示例事件，演示"起 → 10"的子节点标号
  const sample: PlotItem = {
    id: newId(),
    title: '示例事件',
    summary: '',
    charIds: [],
    foreshadowIds: [],
    parentId: roots[0].id,
    order: 0,
  }
  return { mode, items: [...roots, sample], edges: [] }
}

export function emptyPlot(mode: PlotMode = 'board'): PlotDoc {
  return makePlot(mode)
}

/** 把任意 content 规整为 PlotDoc（兼容旧版 {columns,cards} 数据） */
export function normalizePlot(content: unknown): PlotDoc {
  if (!content || typeof content !== 'object') return makePlot()
  const d = content as Record<string, unknown>
  const mode: PlotMode =
    d.mode === 'outline' || d.mode === 'timeline' || d.mode === 'graph' || d.mode === 'board'
      ? (d.mode as PlotMode)
      : 'board'

  const columns: { id: string; name: string }[] = Array.isArray(d.columns)
    ? (d.columns as Record<string, unknown>[]).map((c, i) => ({
        id: typeof c.id === 'string' && c.id ? c.id : newId(),
        name: typeof c.name === 'string' ? c.name : (PLOT_ROOTS as readonly string[])[i] ?? '阶段' + (i + 1),
      }))
    : []

  const legacyCards = Array.isArray(d.cards) ? (d.cards as Record<string, unknown>[]) : null
  const rawItems: Record<string, unknown>[] = legacyCards
    ? legacyCards
    : Array.isArray(d.items)
      ? (d.items as Record<string, unknown>[])
      : []

  const cidById = new Map<string, string>()
  const items: PlotItem[] = rawItems.map((c, i) => {
    const id = typeof c.id === 'string' && c.id ? c.id : newId()
    const cid = typeof c.columnId === 'string' && c.columnId ? c.columnId : ''
    if (cid) cidById.set(id, cid)
    return {
      id,
      title: typeof c.title === 'string' ? c.title : '',
      summary: typeof c.summary === 'string' ? c.summary : '',
      charIds: Array.isArray(c.charIds)
        ? (c.charIds as unknown[]).filter((x) => typeof x === 'string') as string[]
        : [],
      foreshadowIds: Array.isArray(c.foreshadowIds)
        ? (c.foreshadowIds as unknown[]).filter((x) => typeof x === 'string') as string[]
        : [],
      parentId: typeof c.parentId === 'string' ? c.parentId : '',
      order: typeof c.order === 'number' ? c.order : i,
      x: typeof c.x === 'number' ? c.x : undefined,
      y: typeof c.y === 'number' ? c.y : undefined,
    }
  })

  const edges: PlotEdge[] = Array.isArray(d.edges)
    ? (d.edges as Record<string, unknown>[])
        .map((e) => ({
          from: String(e.from ?? ''),
          to: String(e.to ?? ''),
          label: typeof e.label === 'string' ? e.label : undefined,
        }))
        .filter((e) => e.from && e.to)
    : []

  let finalItems = items
  if (columns.length) {
    // 旧版看板：把"列"变成"根（起承转合）"，列内卡片挂到对应根下
    const roots = columns.map((c, i) => ({
      id: newId(),
      title: c.name,
      summary: '',
      charIds: [],
      foreshadowIds: [],
      parentId: '',
      order: i,
    }))
    const colId2Root = new Map(columns.map((c, i) => [c.id, roots[i].id]))
    finalItems = items.map((it) => ({
      ...it,
      parentId: it.parentId || (cidById.get(it.id) && colId2Root.get(cidById.get(it.id)!)) || roots[0].id,
    }))
    finalItems = [...roots, ...finalItems]
  } else if (rawItems.length === 0) {
    // 空文档：种子四根
    finalItems = seedRoots()
  }

  return { mode, items: finalItems, edges: edges.length ? edges : undefined }
}


/* ============================================================
   设定 / 世界观（Setting）
   - 一个 setting 节点 = 一个"世界观"工作区，集中登记地点、势力、道具、功法等设定条目
   - 类别可自定义（共享类别池 categories），缺省：地点/势力/道具/功法·魔法/种族/其他
   - 每个条目可关联角色卡与剧情情节项，打通跨模块引用
   ============================================================ */

/** 单个设定条目 */
export interface SettingEntry {
  id: string
  /** 名称（必填） */
  name: string
  /** 类别（取自共享类别池） */
  category: string
  /** 描述 / 设定正文 */
  desc: string
  /** 关联角色卡 id 列表 */
  charIds: string[]
  /** 关联剧情情节项 id 列表 */
  plotIds: string[]
  /** 同类别内排序，越小越靠前 */
  order?: number
}

/** 设定文档 */
export interface SettingDoc {
  /** 共享类别池 */
  categories: string[]
  /** 全部设定条目 */
  entries: SettingEntry[]
}

export const DEFAULT_SETTING_CATEGORIES = ['地点', '势力', '道具', '功法/魔法', '种族', '其他']

export function makeSettingEntry(name = ''): SettingEntry {
  return {
    id: newId(),
    name,
    category: DEFAULT_SETTING_CATEGORIES[0],
    desc: '',
    charIds: [],
    plotIds: [],
  }
}

export function makeSetting(): SettingDoc {
  return {
    categories: [...DEFAULT_SETTING_CATEGORIES],
    entries: [makeSettingEntry()],
  }
}

export function emptySetting(): SettingDoc {
  return makeSetting()
}

/** 把任意 content 规整为 SettingDoc（兼容旧版字段迁移） */
export function normalizeSetting(content: unknown): SettingDoc {
  if (!content || typeof content !== 'object') return makeSetting()
  const d = content as Record<string, unknown>
  const categories = Array.isArray(d.categories)
    ? (d.categories as unknown[]).filter((x) => typeof x === 'string' && x) as string[]
    : [...DEFAULT_SETTING_CATEGORIES]
  const entries: SettingEntry[] = Array.isArray(d.entries)
    ? (d.entries as Record<string, unknown>[]).map((c, i) => ({
        id: typeof c.id === 'string' && c.id ? c.id : newId(),
        name: typeof c.name === 'string' ? c.name : '',
        category:
          typeof c.category === 'string' && c.category
            ? c.category
            : categories[0] ?? DEFAULT_SETTING_CATEGORIES[0],
        desc: typeof c.desc === 'string' ? c.desc : '',
        charIds: Array.isArray(c.charIds)
          ? (c.charIds as unknown[]).filter((x) => typeof x === 'string') as string[]
          : [],
        plotIds: Array.isArray(c.plotIds)
          ? (c.plotIds as unknown[]).filter((x) => typeof x === 'string') as string[]
          : [],
        order: typeof c.order === 'number' ? c.order : i,
      }))
    : []
  return {
    categories: categories.length ? categories : [...DEFAULT_SETTING_CATEGORIES],
    entries: entries.length ? entries : [makeSettingEntry()],
  }
}


/* ============================================================
   地图（Map）
   - 一个 map 节点 = 一栋"建筑 / 区域"的地图，由多层（floor）组成
   - 每一层是独立的平面图：放置地点标记、绘制本层内的路线（edge）
   - 跨层连接（link）：不同层之间的地点通过楼梯 / 电梯 / 通道相连，
     体现"层级"与"方位"（每层内部用 x/y 摆放，跨层用 link 串联）
   - 地点标记可关联到「设定」里的「地点」类别条目，打通跨模块引用
   ============================================================ */

/** 地图上的地点标记 */
export interface MapLocation {
  id: string
  /** 地点名 */
  name: string
  /** 画布坐标（左上角为原点，单位 px） */
  x: number
  y: number
  /** 备注 / 说明 */
  desc: string
  /** 关联设定条目 id（设定里「地点」类别的条目） */
  settingId?: string
}

/** 同一层内的路线 */
export interface MapEdge {
  from: string
  to: string
  /** 路线说明（如"走廊""官道""秘径"） */
  label?: string
}

/** 地图的一层（楼层） */
export interface MapFloor {
  id: string
  /** 楼层名（如"B1 地下车库""1F 大堂""3F 行政层"） */
  name: string
  /** 竖向层级顺序，数值越小越靠下（地下室为负，地上为正）。同值按数组序 */
  order: number
  /** 本层地点标记 */
  locations: MapLocation[]
  /** 本层内路线连线 */
  edges: MapEdge[]
}

/** 跨层连接（楼梯 / 电梯 / 通道），连接不同层的两个地点 */
export interface MapLink {
  from: string
  to: string
  /** 连接说明（如"楼梯""货梯""安全通道"） */
  label?: string
}

/** 地图文档 */
export interface MapDoc {
  /** 全部楼层 */
  floors: MapFloor[]
  /** 跨层连接 */
  links?: MapLink[]
}

/** 新建一层 */
export function makeFloor(name = '1层', order = 1): MapFloor {
  return { id: newId(), name, order, locations: [], edges: [] }
}

export function makeMap(): MapDoc {
  const a: MapLocation = { id: newId(), name: '大堂', x: 160, y: 140, desc: '', settingId: undefined }
  const b: MapLocation = { id: newId(), name: '电梯口', x: 420, y: 260, desc: '', settingId: undefined }
  return {
    floors: [
      {
        id: newId(),
        name: '1层',
        order: 1,
        locations: [a, b],
        edges: [{ from: a.id, to: b.id, label: '走廊' }],
      },
    ],
    links: [],
  }
}

export function emptyMap(): MapDoc {
  return { floors: [makeFloor('1层', 1)], links: [] }
}

/** 把任意 content 规整为 MapDoc（兼容旧版 {locations,edges} 单平面图迁移为单层） */
export function normalizeMap(content: unknown): MapDoc {
  if (!content || typeof content !== 'object') return emptyMap()
  const d = content as Record<string, unknown>

  const mapLoc = (c: Record<string, unknown>): MapLocation => ({
    id: typeof c.id === 'string' && c.id ? c.id : String(c.id ?? newId()),
    name: typeof c.name === 'string' ? c.name : '',
    x: typeof c.x === 'number' ? c.x : 0,
    y: typeof c.y === 'number' ? c.y : 0,
    desc: typeof c.desc === 'string' ? c.desc : '',
    settingId: typeof c.settingId === 'string' ? c.settingId : undefined,
  })
  const mapEdge = (e: Record<string, unknown>): MapEdge => ({
    from: String(e.from ?? ''),
    to: String(e.to ?? ''),
    label: typeof e.label === 'string' ? e.label : undefined,
  })

  // 新结构：楼层数组
  if (Array.isArray(d.floors)) {
    const floors: MapFloor[] = (d.floors as Record<string, unknown>[]).map((f) => ({
      id: typeof f.id === 'string' && f.id ? f.id : newId(),
      name: typeof f.name === 'string' && f.name ? f.name : '1层',
      order: typeof f.order === 'number' ? f.order : 1,
      locations: Array.isArray(f.locations) ? (f.locations as Record<string, unknown>[]).map(mapLoc) : [],
      edges: Array.isArray(f.edges)
        ? (f.edges as Record<string, unknown>[]).map(mapEdge).filter((e) => e.from && e.to)
        : [],
    }))
    const links: MapLink[] = Array.isArray(d.links)
      ? (d.links as Record<string, unknown>[])
          .map((e) => ({
            from: String(e.from ?? ''),
            to: String(e.to ?? ''),
            label: typeof e.label === 'string' ? e.label : undefined,
          }))
          .filter((e) => e.from && e.to)
      : []
    return { floors: floors.length ? floors : [makeFloor()], links }
  }

  // 旧结构：单张平面图 → 收敛为单层
  const locations: MapLocation[] = Array.isArray(d.locations)
    ? (d.locations as Record<string, unknown>[]).map(mapLoc)
    : []
  const edges: MapEdge[] = Array.isArray(d.edges)
    ? (d.edges as Record<string, unknown>[]).map(mapEdge).filter((e) => e.from && e.to)
    : []
  if (locations.length === 0 && edges.length === 0) return emptyMap()
  return { floors: [{ id: newId(), name: '1层', order: 1, locations, edges }], links: [] }
}

export type MapTemplateKind = 'blank' | 'building' | 'world'

/**
 * 地图模板：一键生成带示例内容的地图，免去从空白开始。
 * - blank：单层空地图
 * - building：一栋楼，B1/1F/2F/3F 四层，每层有示例房间 + 层内路线 + 跨层电梯/楼梯
 * - world：单张世界地图，多个区域 + 道路连线
 */
export function makeMapFromTemplate(kind: MapTemplateKind): MapDoc {
  if (kind === 'blank') return emptyMap()
  const mk = (name: string, x: number, y: number): MapLocation => ({
    id: newId(),
    name,
    x,
    y,
    desc: '',
    settingId: undefined,
  })
  if (kind === 'world') {
    const capital = mk('王都', 900, 400)
    const forest = mk('幽暗森林', 300, 520)
    const north = mk('北境山脉', 900, 150)
    const sea = mk('东海', 1520, 300)
    const desert = mk('南境沙漠', 900, 820)
    const west = mk('西陲荒原', 330, 860)
    return {
      floors: [
        {
          id: newId(),
          name: '世界地图',
          order: 1,
          locations: [capital, forest, north, sea, desert, west],
          edges: [
            { from: capital.id, to: forest.id, label: '官道' },
            { from: capital.id, to: north.id, label: '山道' },
            { from: capital.id, to: sea.id, label: '运河' },
            { from: capital.id, to: desert.id, label: '商道' },
            { from: capital.id, to: west.id, label: '古道' },
            { from: forest.id, to: west.id, label: '小径' },
          ],
        },
      ],
      links: [],
    }
  }
  // building：四层大楼
  const b1 = { 电梯厅: mk('电梯厅', 700, 500), 停车A区: mk('停车A区', 200, 200), 停车B区: mk('停车B区', 700, 200), 设备间: mk('设备间', 200, 500) }
  const f1 = { 电梯厅: mk('电梯厅', 700, 300), 大堂: mk('大堂', 200, 200), 前台: mk('前台', 450, 200), 安保室: mk('安保室', 700, 600) }
  const f2 = { 电梯厅: mk('电梯厅', 700, 550), 商铺A: mk('商铺A', 200, 200), 商铺B: mk('商铺B', 700, 200), 中庭: mk('中庭', 450, 450) }
  const f3 = { 电梯厅: mk('电梯厅', 700, 500), 董事长室: mk('董事长室', 200, 200), 会议室: mk('会议室', 700, 200), 茶水间: mk('茶水间', 450, 450) }
  const floor = (name: string, order: number, locs: Record<string, MapLocation>, edges: [string, string, string?][]): MapFloor => ({
    id: newId(),
    name,
    order,
    locations: Object.values(locs),
    edges: edges.map(([a, b, label]) => ({ from: locs[a].id, to: locs[b].id, label })),
  })
  return {
    floors: [
      floor('B1 地下车库', -1, b1, [['停车A区', '设备间'], ['停车B区', '电梯厅'], ['电梯厅', '设备间']]),
      floor('1F 大堂', 1, f1, [['大堂', '前台'], ['大堂', '电梯厅'], ['前台', '安保室']]),
      floor('2F 商业层', 2, f2, [['商铺A', '中庭'], ['商铺B', '中庭'], ['中庭', '电梯厅']]),
      floor('3F 行政层', 3, f3, [['董事长室', '茶水间'], ['会议室', '茶水间'], ['茶水间', '电梯厅']]),
    ],
    links: [
      { from: b1.电梯厅.id, to: f1.电梯厅.id, label: '货梯' },
      { from: f1.电梯厅.id, to: f2.电梯厅.id, label: '客梯' },
      { from: f2.电梯厅.id, to: f3.电梯厅.id, label: '客梯' },
      { from: b1.设备间.id, to: f1.安保室.id, label: '楼梯' },
      { from: f1.安保室.id, to: f2.中庭.id, label: '楼梯' },
      { from: f2.中庭.id, to: f3.茶水间.id, label: '楼梯' },
    ],
  }
}
