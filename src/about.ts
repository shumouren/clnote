/**
 * 应用元信息（单一来源）
 * ---------------------------------------------------------------
 * 设置「关于」、窗口标题、构建信息统一从这里取，改名 / 升版本只改这一处。
 */
export const APP_NAME = 'clnote'
export const APP_VERSION = '3.0.0'
export const APP_DEV = 'cl'

/** 主要能力列表，用于「关于」展示 */
export const APP_FEATURES: { title: string; desc: string }[] = [
  { title: '文本笔记', desc: '专注中文排版：智能标点、表格、任务列表、代码块、Mermaid 流程图、撤销/重做、全角标点' },
  { title: '小说创作', desc: '小说 → 卷 → 章 卷章结构，角色 / 剧情 / 设定 / 地图 / 时间线卡片，伏笔标注与追踪' },
  { title: '思维导图', desc: '中心主题自由展开，支持导出 OPML / SVG / PNG' },
  { title: '文件树', desc: '文件夹 / 笔记 / 导图互相嵌套，支持拖拽调整层级、移动到…' },
  { title: '素材库', desc: '文本 / 文件 / 其他 三种类型，标签可自定义（新建带图标 / 删除 / 重命名），卡片可拖拽排序' },
  { title: '快捷库', desc: '把本地文件夹、网页链接、常用笔记一键收纳到侧边栏' },
  { title: '写作辅助', desc: '番茄钟倒计时（常驻顶栏 + 桌面通知）、打字机固定框、专注模式、每日写作目标、深色沉浸写作' },
  { title: 'EPUB 导出', desc: '书名 / 作者 / 卷名 / 目录自动成书，桌面端弹「另存为」指定位置' },
  { title: '伏笔与快照', desc: '章节伏笔标注追踪、版本快照与差异对比、跨节点引用与悬浮预览' },
  { title: '分区域背景', desc: '全局与笔记 / 大纲 / 文件树 / 看板 / 导图分别设定背景' },
  { title: '全局搜索 & 老板键', desc: '跨库搜索内容，一键隐藏窗口保护隐私' },
  { title: '导入导出', desc: 'Markdown / HTML / OPML / JSON / EPUB；.clnote 整库备份与恢复（含设置）' },
  { title: '本地优先', desc: '桌面端存于本机 SQLite，浏览器端存于 IndexedDB，数据始终在你手里' },
]

export const APP_TECH = 'Tauri 2 + React 18 + TypeScript + TipTap v2'
