# clnote 📝

> **本地优先（Local-first）的中文写作与笔记软件** —— 为小说作者与文字工作者打造的桌面写作助手。
> 技术栈：Tauri 2 · React 18 · TypeScript · Vite · TipTap v2（前端）｜ Rust + rusqlite / SQLite + FTS5（桌面端数据）

![Tauri 2](https://img.shields.io/badge/Tauri-2.x-24c8db?logo=tauri&logoColor=fff)
![React 18](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=fff)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=fff)
![SQLite](https://img.shields.io/badge/SQLite-FTS5-003b57?logo=sqlite&logoColor=fff)
![Platform](https://img.shields.io/badge/Windows%20%7C%20Linux%20%7C%20macOS-本地优先-6f42c1)

数据始终留在你自己的电脑上（本机 SQLite / 浏览器 IndexedDB），**不上云**；同一套代码既能 `npm run dev` 跑浏览器演示，也能 `npm run tauri build` 打包成 Windows / Linux / macOS 原生应用（含免安装便携模式）。

## ✨ 功能亮点

- ✍️ **中文写作体验**：智能标点自动配对、打字机固定框（光标行居中）、专注模式、番茄钟倒计时（常驻顶栏 + 桌面通知）、每日写作目标、深色沉浸写作
- 📚 **小说创作支持**：小说 → 卷 → 章 创作库结构，角色 / 剧情 / 设定 / 地图 / 时间线卡片，**伏笔标注与追踪**，**跨节点 @ 引用 + 悬浮预览**，版本快照与差异对比
- 📖 **EPUB 一键成书**：书名 / 作者 / 卷名 / 目录自动生成，桌面端弹「另存为」选择精确保存位置
- 🗂️ **整库备份迁移**：单文件 `.clnote` 备份（文件树 / 素材 / 快捷 / **设置**），覆盖 / 合并恢复，换机不丢数据
- 🎞️ **三库合一媒体库**：挂载本地文件夹即看书（epub / pdf / txt / md）、听歌、看视频、看图，进度续读续播、批注、字幕、播放列表
- 🔍 **全局搜索**：跨文件树 / 素材 / 快捷 / 创作库 / 媒体批注，桌面端中文 FTS5 全文检索
- 🖥️ **多端一致**：文件树侧栏可调宽、左右分栏自由组合（同时看书 + 写笔记）、分区域背景、编辑区缩放

完整功能清单、版本记录、技术架构、数据存储与打包指南见下文各节。

---

## 版本发布记录

### 第一版 v1.0.0（初版）

初始可用版本，确立"本地优先 + 中文写作"的基调：

- **文本笔记**：富文本编辑器（TipTap / ProseMirror），支持加粗/斜体/删除线/行内代码/链接/引用/代码块、H1–H6 标题、中文智能标点、表格、任务列表、图片、Mermaid 流程图、自动保存、打字机/专注模式。
- **内容组织**：文件树（文件夹 / 文本笔记 / 思维导图互相嵌套，可拖拽调整层级、移动到…）；思维导图（导出 OPML / SVG / PNG / Markdown / HTML）；任务看板（响应式多列）。
- **素材库 / 快捷库**：素材支持 文本 / 代码 / 图片 / 链接 / 文件 / 书籍 等类型，分类可嵌套；快捷库收纳本地文件夹、网页链接、常用笔记。
- **搜索与快捷键**：全局搜索（Ctrl/Cmd+F，跨库跳转）、老板键（F9）、命令面板（Ctrl/Cmd+K）。
- **导入导出**：Markdown / HTML / OPML / 纯文本 / JSON 导入；Markdown / HTML / 文本 / JSON / OPML / SVG / PNG 导出；批量导出（保留层级 / 打包 ZIP / 合并）；整库备份与恢复（覆盖 / 合并）。
- **外观**：多套主题、可自定义强调色与字体、分区域背景、界面/正文字号独立。
- **数据**：桌面端存本机 SQLite，浏览器端存 IndexedDB；支持便携模式（`.portable`）与改名迁移不丢数据。

### 第二版 v2.0.0（本版）

重点：素材库 / 快捷库重构、删除行为修正、数据可靠性加固。**对应代码版本：v2.0.0**（已同步到 `src/about.ts`、`Cargo.toml`、`tauri.conf.json`、`package.json`）。

**新增**
- **素材标签类型管理**：在素材编辑区即可新建标签类型（带图标选择）、删除、重命名；内置「文本 / 文件 / 其他」不可删除，用户自建类型可删可改。
- **素材类型收敛**：原 文本/代码/图片/链接/文件/书籍 收敛为 **文本 / 文件 / 其他** 三类，旧数据在首次打开时自动迁移归类（书籍→文件，代码/图片/链接/自定义→其他）。
- **卡片拖拽排序**：素材库与快捷库在无搜索词时可拖拽调整卡片顺序，并持久化（`order_idx`）。
- **删除节点级联删除**：删除素材/快捷分类时，其下所有子分类与卡片**一并删除（不可恢复）**，不再"沉"到某个汇总桶。
- **自定义数据目录真正持久化**：设置 → 存储 → 选择目录，把整个 `clnote.db` 迁移到你指定的文件夹；偏好写入独立于数据文件的 `data_dir.txt`，**重启 / 更新版本后依然生效**（修复了旧实现重启回退默认目录、看似"丢数据"的问题）。

**删除**
- 移除「全部素材 / 全部快捷」汇总栏目入口：点对应 Tab 即显示全部，不再提供独立入口（避免误把数据"转移"到汇总桶）。
- 编辑区不再出现"删除文件树主题 / 文件夹"入口：文件树主题的管理与删除只保留在侧边栏文件树（新建 / 重命名 / 移动到 / 设为默认 / 删除），避免编辑素材时误删整棵主题树。

**优化**
- 多处过时确认文案修正，与"级联删除"的真实行为一致。
- 新建素材默认类型对齐当前筛选；保存链路加超时 / 异常诊断，失败时弹窗提示而非静默卡死。

### 第三版 v3.0.0

重点：把原计划的「阅读库 / 音乐库 / 视频库」三库**合一为「媒体库」**，挂载目录后按文件扩展名自动分派查看器（书 / 文本 / 音乐 / 视频 / 图片）；**媒体内容并入主工作区分栏**（与顶部工具栏「分栏」按钮同一套，可同时看书 + 看视频）；分栏与文件树均可拖拽调宽；笔记入口位于媒体库侧栏；音乐常驻底部播放条。**对应代码版本：v3.0.0**（已同步到 `src/about.ts`、`Cargo.toml`、`tauri.conf.json`、`package.json`）。

**新增**
- **媒体库（三库合一）**：挂载本地文件夹（可多选、可拖拽排序），递归扫描目录下**全部文件（不再按库过滤扩展名）**，按扩展名自动分派查看器——
  - **书 / 文本**：`epub`（epub.js 分页，进度按 CFI 记忆）/ `pdf`（pdf.js 逐页，进度按滚动百分比）/ `txt`·`md`（按滚动百分比）；**文本阅读器支持字号调节（A− / A+）与 GBK 编码自动识别**（UTF-8 解码出乱码替换符时回退 GBK，兼容国内常见 txt）；可随手批注，批注汇聚到媒体库侧栏「📝 笔记内容」入口并可跳回原书位置。
  - **视频**：`mp4`/`mkv`/`webm`/`mov`/`avi`/`m4v`/`flv`/`wmv`/`rmvb`/`3gp`/`ogv` 等，播放器支持倍速（0.5×–2×）、**静音一键切换、画中画（PiP）**、全屏、字幕（同名 `.vtt` 直挂、`.srt` 自动转 vtt）、循环、播放列表与上下集，进度记忆（续播）。
  - **音频**：`mp3`/`flac`/`wav`/`ogg`/`oga`/`m4a`/`aac`/`wma`/`opus`/`mid`/`midi` 等，常驻底部播放条（`AudioBar`，全局可见、切库/切栏不中断），播放 / 暂停 / 进度拖拽 / 音量 / **静音**、顺序 · 单曲循环 · 随机三种模式、**播放列表可展开 / 收起**与上下首，进度续播。
  - **图片**：`jpg`/`jpeg`/`png`/`gif`/`webp`/`svg`/`bmp`/`ico`/`avif`/`tif`/`tiff` 等，看图器支持**滚轮 / 按钮缩放、适应窗口 ↔ 原始尺寸、旋转 90°、上一张 / 下一张**（同文件夹图片自动成组）、尺寸与序号显示。
- **媒体内容并入主分栏**：媒体（书 / 视频 / 图片 / 笔记）与文件树节点共用主工作区的左右分栏与顶部「分栏」按钮——不再有独立的媒体工作区；分栏内容统一为 `节点 / 媒体 / 笔记` 三种（store 的 `PaneContent` 联合类型），左右任意组合。
- **文件树侧栏可调宽**：侧边栏与编辑区之间新增拖拽条，可自由调整文件树宽度（限幅 180–520px），偏好写入 `settings.sidebarWidth`。
- **笔记入口位于媒体库侧栏**：原固定在顶部的「所有笔记」全局入口改为媒体库侧栏（文件树位置）的「📝 笔记内容」条目，点击在分栏展示全部书籍批注，点击单条跳回原书。
- **媒体协议（基建）**：Rust 端自定义 `media` 协议把磁盘文件以 HTTP 喂给 `<audio>/<video>/pdf.js/<img>`，支持 Range 请求（可 seek、可续播），无需整文件读入 JS 内存。
- **通用磁盘能力（基建）**：文件夹多选挂载、递归扫描（含总量 / 深度上限保护）、读字节命令，媒体库复用。

**修复**
- 修复挂载文件夹「只显示目录、不显示文件内容」的 Bug：Rust `scan_folder` 之前把前端传来的**带点**扩展名过滤列表（`['.epub', ...]`）与 `scan_dir` 用 `p.extension()` 取到的**无点**扩展名比较，导致所有文件被错误过滤；现已归一化去掉前导点（`trim_start_matches('.')`）后再匹配，文件正常显示。
- 修复「书 / 文本 / 字幕打不开、提示暂不支持」的 Bug：磁盘扫描返回的扩展名是**无点**形式（`pdf`），而阅读器 / 播放器却用**带点**形式比较（`'.pdf'`、`'.vtt'`），导致 epub / pdf / txt / md 全部落入「暂不支持的格式」；现统一改用 `normExt()`（去点 + 小写）比较，书、文本、字幕全部正常打开。
- 修复媒体库挂载/列表报 `Wrong number of parameters passed to query. Got 1, needed 0` 的 Bug：`list_mounted_folders` 在 `lib='media'` 分支的 SQL 无 `?` 占位符却仍统一传 `params![lib]`，现按分支条件传参（media 分支不传参）。
- 修复 epub 有时**空白不渲染 / 位置偏移**：分栏首次挂载时容器可能无尺寸，epub.js 以 0 尺寸渲染导致空白——现在等容器布局稳定后再 display；并用 `ResizeObserver` 监听容器尺寸变化（拖分栏 / 缩放窗口）自动重排；`spread` 固定单页避免双页错位。
- 修复分栏标题过长时**右侧按钮被挤出**（如批注按钮消失）：`.pane-name` 补齐 `flex:1; min-width:0`，长文件名自动省略号压缩。
- 修复 epub **iframe 沙箱报错**（`Blocked script execution in 'about:srcdoc' ... 'allow-scripts'`）：epub.js 创建 iframe 时用**属性赋值** `sandbox="allow-same-origin"`（缺 `allow-scripts`），WebView2 严格执行拦截正文脚本；现用 epub.js 官方选项 `allowScriptedContent: true` 让 iframe 补上 allow-scripts，正文正常渲染与翻页。（控制台会出现 `An iframe which has both allow-scripts and allow-same-origin ... can escape its sandboxing` 的安全提示——这是浏览器对 epub.js 官方方案的**标准 console 警告，非错误**，不影响任何功能，无法消除，所有用 epub.js 的应用都有。）
- 修复 epub **目录打开时阅读区被遮挡只剩一部分**：目录抽屉原为绝对定位覆盖在阅读区上，epub.js 不会自动让内容让位；现改为 flex 侧栏布局（目录与阅读区并排），阅读区真实变窄并自动重排。
- 修复**大纲 / 伏笔面板被挤到编辑器下方**（回归）：上一轮把 `.pane-body` 误改为纵向 flex，导致原本在右侧的大纲/伏笔栏跑到下面；已还原为横向布局，写作状态条移至 pane 底部。大纲回到右侧、伏笔栏回到右侧。

**兼容**
- 旧版已挂载的「阅读 / 音乐 / 视频」三个库在切换到「媒体库」后**自动兼容**（`list_mounted_folders('media')` 对 `lib IN ('reading','music','video')` 一并返回），历史挂载点不丢；库导航偏好（`sideTab`）旧值自动迁移为 `media`。

**优化**
- 媒体库挂载点均支持拖拽排序；全局搜索覆盖全部内容（含创作库各节点），后端中文 FTS5 检索。
- **文本打开提速**：纯文本阅读器改为优先走 `media` 协议 `fetch`（二进制直接进 `Uint8Array`），避开 `read_file_bytes` 把大字节数组序列化成 `number[]` 传回 JS 的开销，大文本文件秒开。
- **视频 / 音乐拖动进度条不再卡顿**：拖动中只更新预览位置、**松手才真正 seek**，避免拖动过程高频 seek 反复重新解码缓冲。
- **视频控制栏可收起**：功能键较多时点「▾」收起（只看画面，画面右上角「▲」展开）。
- **主分栏分隔条可拖拽调宽**：分栏中间的分隔条与文件树 resizer 一样可左右拖动调整两栏宽度。
- **顶部栏精简**：移除右上角「导入 / 导出 / 命令 / 设置」四个按钮——设置入口固定在最左侧库栏底部；导入 / 导出（含备份恢复）在设置对话框内；命令面板仍可用 Ctrl/Cmd+K 呼出（内含「打开设置」）。
- **切换库时编辑区各自记忆**：文件树 / 素材 / 快捷 / 创作 / 媒体 每个库维护独立的分栏状态（打开的文件 / 分栏开关 / 激活栏），切走自动保存、切回恢复上次页面，互不干扰。
- **编辑器格式工具栏可折叠**：文件库 / 创作库的 NoteEditor 工具栏加「▾ / ▴ 工具栏」按钮，像视频控制栏一样可隐藏，写正文时视野更干净。
- **阅读字号记忆 + 三端生效**：A−/A+ 字号偏好本地记忆（重启保持），且对纯文本（px）、epub（`themes.fontSize`）、pdf（`scale`）三种阅读器都生效。
- **视频快捷键**：点击画面后可用 空格（播放/暂停）、←/→（快退/快进 5 秒），不干扰编辑器输入。
- **分栏比例记忆**：拖好的分栏宽度（左右比例）本地记忆，重启后保持。
- **阅读续读**：打开书 / 视频 / 图片后自动记住，重启后若停在媒体库则自动恢复到上次打开的媒体（进度记忆仍按文件独立续读 / 续播）。
- **epub 目录导航**：epub 工具栏「📑 目录」抽屉展示章节 TOC，点击跳章。
- **图片全屏 + 幻灯片**：看图器支持全屏（⛶）与 3 秒自动播放（▶ 自动播放，到尾循环）。
- **写作字数统计**：笔记编辑器底部状态条实时显示「字数 / 段落数」（节流更新，不影响输入流畅度）。
- **阅读主题**：📖 默认 / 📄 纸感 / 🌙 夜间 三种阅读背景 + Aa 衬线字体切换，本地记忆，文本与 epub 阅读器均生效。
- **epub 翻页方向键**：点进 epub 正文后 ←/→ 直接翻页（仅 iframe 内按键响应，不干扰编辑器）。
- **epub 划词高亮**：在 epub 正文选中文字出现「📌 高亮」浮动按钮，点击把选区标亮（会话内高亮，工具栏可一键清除）。
- **最近阅读书架**：媒体库侧栏「🕐 最近阅读」列出最近打开的 8 个媒体，一键续读 / 续播。
- **深色沉浸写作**：编辑器工具栏「🌙 沉浸」一键切换暗色纸面（独立于全局主题，写长文护眼）。
- **每日写作目标**：设置 → 写作辅助可设每日字数目标，状态条显示「已写/目标」进度（达标变绿）；「今日 +N」增量统计。
- **Markdown 快捷输入**：`# ` 标题、`> ` 引用、`**加粗**`、`*斜体*`、`` `代码` `` 输入即转换。
- **章节快速切换**：创作库小说章节编辑时，工具栏「📖 章节」下拉一键跳转到同小说其他章节。
- **顶部按钮按库显示**：文件库=分栏/大纲/被引用；创作库=分栏/伏笔/被引用；媒体库=仅分栏；素材/快捷库=无按钮。
- **文件树区域可隐藏**：顶部栏「◂ 收起 / ▸ 文件树」一键隐藏 / 展开文件树侧栏（状态记忆），隐藏后编辑区占满窗口。

**写作与创作增强（v3.0.0 迭代）**
- **番茄钟**：顶栏常驻倒计时胶囊（开始 / 暂停 / 重置 / 跳过、轮次圆点、今日完成数），专注 / 短休 / 长休时长、自动开始、桌面通知、提示音均在设置「番茄钟」栏配置。
- **打字机固定框**：开启打字机模式后，编辑区出现一个固定框实时框住光标所在行（跟随光标，改窗口 / 滚动 / 缩放都跟随）；回车后该行如打字机般上移、框原地不动；滚动可平滑 / 瞬时切换。
- **EPUB 导出**：把手稿按文件树顺序拼成 EPUB 3 电子书——导出窗口可填书名与作者，正文自动生成「书名 + 作者 + 目录」扉页，每卷首章前插入卷名页；桌面端弹「另存为」精确保存。
- **导出体验**：普通导出（单文件 / EPUB / 合并 / ZIP）在桌面端弹系统「另存为」对话框；导出顺序严格按文件树「从上到下」；合并 / EPUB 导出自动带卷名层级。
- **版本快照 + 差异**：编辑器「📸 快照」面板保存 / 恢复历史版本，行级 LCS 差异对比，每篇笔记最多保留 60 条快照。
- **伏笔系统**：小说章节内选中文字设为伏笔（🔖），右侧伏笔栏聚合追踪，可标记完成 / 跳转 / 删除，正文标记同步高亮。
- **联动与反向引用**：正文 `@` 或「🔗 引用」插入跨节点引用芯片，悬浮预览目标内容、点击跳转；「被引用」面板反查谁引用了当前节点。
- **编辑体验优化**：工具栏撤销 / 重做、选中文本一键「半角 → 全角标点」；状态栏显示选区字数与「保存中… / 已保存 HH:MM」；切换笔记自动恢复上次光标位置。
- **备份升级**：`.clnote` 整库备份把「设置」一并打入，恢复时可选「一并恢复设置」，偏好随数据一起迁移。

---

## 一、clnote 是什么

clnote 是一款**本地优先（local-first）**的笔记软件：

- 桌面端数据保存在**本机 SQLite 文件 `clnote.db`**（文件树、素材库、快捷库、伏笔全部在同一库里），浏览器端数据保存在**浏览器 IndexedDB**，数据始终在你自己手里，不上云。
- 同一套前端代码，既能跑在浏览器里（`npm run dev`），也能打包成 Windows / Linux / macOS / Android 原生窗口（`npm run tauri build`）。
- 主打**中文写作体验**：智能标点、表格、任务列表、内嵌 Mermaid 流程图、思维导图、素材库、快捷库、分区域背景、全局搜索与老板键。

---

## 二、已实现功能（v3.0.0）

**笔记编辑**
- 富文本编辑器（TipTap / ProseMirror）：加粗、斜体、删除线、行内代码、链接、引用、代码块、标题（**H1–H6**）。
- 中文**智能标点**：输入 `(` `（` `[` `【` `《` `"` `“` 等会自动补上配对符号并把光标放在中间；行内输完按 Enter 跳出配对；紧贴内侧 Backspace 左右一起删。
- **表格**：插入表格、增删行列、合并 / 拆分单元格、列宽可拖拽。
- **任务列表**：复选框待办，支持嵌套。
- **图片**：可在正文插入图片（dataURL，按用途分档压缩）；Mermaid 流程图实时渲染。
- **撤销 / 重做**：工具栏「↩ 撤销 / ↪ 重做」按钮，支持 Ctrl+Z / Ctrl+Y。
- **全角标点**：选中文本一键把半角标点（`,` `.` `;` `:` `!` `?` `(` `)` 等）统一转为全角，数字 / 字母 / 空格不受影响。
- **写作状态栏**：实时显示字数 / 段落数 / 今日增量 / 目标进度 / 选区字数 / 「保存中… · 已保存 HH:MM」。
- **打字机模式**：光标行居中 + 固定框实时框住光标所在行（回车行上移、框不动），滚动平滑 / 瞬时可切换。
- 专注模式（高亮当前段 / 行）、深色沉浸写作、自动保存（防抖可调）、切换笔记自动恢复上次光标位置。

**内容组织**
- **文件树**：文件夹 / 文本笔记 / 思维导图 互相嵌套，支持拖拽调整层级与「移动到…」弹窗。标题保持手动命名，可在侧栏重命名。
- **创作库（小说卷章结构）**：小说 → 卷 → 章 三层自动编号（中文 / 阿拉伯数字按设置切换），章间「📖 章节」下拉一键切换；角色 / 剧情 / 设定 / 地图 / 时间线 各类创作卡片。
- **伏笔标注与追踪**：小说章节内选中文字设为伏笔（🔖），右侧伏笔栏聚合全部伏笔，可标记完成 / 跳转定位 / 删除，正文标记同步高亮。
- **跨节点引用 + 悬浮预览**：正文输入 `@` 或点「🔗 引用」插入引用芯片（可精确到看板 / 角色卡片），悬浮即预览目标内容，点击跨库跳转；「被引用」面板反查反向引用。
- **版本快照 + 差异**：「📸 快照」面板保存 / 恢复每篇笔记的历史版本，行级差异高亮对比。
- **思维导图**：中心主题自由展开，导出 OPML / SVG / PNG / Markdown / HTML。
- **素材库（v2 重构）**：**文本 / 文件 / 其他** 三种素材类型；标签类型可在编辑区**新建（带图标）/ 删除 / 重命名**；图片素材不压缩、灯箱展示原图；单个素材可导出到本地任意文件夹。卡片可**拖拽排序**。
- **快捷库**：把本地文件夹、网页链接、常用笔记一键收纳到侧边栏；卡片可**拖拽排序**。
- **任务看板**：列/卡片响应式布局，窗口够宽时自动多列、卡片自动换行。

**写作辅助**
- **番茄钟**：顶栏常驻倒计时胶囊（专注 / 短休 / 长休，轮次满自动进长休），阶段结束桌面通知 + 提示音；时长、自动开始、通知开关均在设置「番茄钟」栏配置。
- **每日写作目标**：设置每日字数目标，状态条实时显示「已写 / 目标」进度（达标变绿），「今日 +N」增量统计。
- **深色沉浸写作**：编辑器工具栏「🌙 沉浸」一键切换暗色纸面，独立于全局主题，写长文护眼。

**媒体库**
- **媒体库（三库合一）**：挂载本地文件夹（可多选、可拖拽排序），递归浏览目录下全部文件，按扩展名自动分派书（epub / pdf / txt / md）/ 视频（mp4 / mkv / avi 等）/ 音频（mp3 / flac / wav / ogg 等）/ 图片（jpg / png / gif / webp / svg 等）查看器；看书可随手批注（进度记忆），视频 / 音乐支持播放列表与进度续播，图片支持缩放 / 旋转 / 前后翻；批注汇聚到媒体库侧栏「📝 笔记内容」入口。
- **媒体并入主分栏 + 文件树可调宽**：媒体（书 / 视频 / 图片）与笔记共用主工作区的左右分栏（顶部「分栏」按钮同一套），可一边看书一边看视频；文件树侧栏宽度可拖拽调整。
- **音频常驻**：底部播放条常驻，切换分栏或看视频时音乐不中断；视频支持倍速、全屏、同名 `.vtt`/`.srt` 字幕、播放列表，书与视频均记忆播放进度（续播）。

**外观**
- 多套主题（浅色 / 暗色 / 纸感 / 护眼）、可自定义强调色、UI 字体、编辑器字体、**界面字号与正文字号各自独立生效**。
- **分区域背景**：全局、笔记、大纲、文件树、看板、思维导图 各自独立设置背景图。
- 编辑区缩放（Ctrl+滚轮）、图片最大显示宽度、点击图片灯箱放大。

**搜索与快捷键**
- 全局搜索（Ctrl/Cmd+F）：跨库搜索标题、正文、文件夹名、素材库与快捷库；结果点击自动跳转。
- 老板键（默认 F9）：一键隐藏窗口内容、再按恢复（桌面端走系统级全局快捷键真正最小化，浏览器端回退为全屏遮罩）。
- 命令面板（Ctrl/Cmd+K）：新建、分栏、主题切换等快捷操作。
- 常用快捷键：保存 Ctrl/Cmd+S、导入 Ctrl/Cmd+I、导出 Ctrl/Cmd+E、设置 Ctrl/Cmd+,。

**导入导出（数据可携带）**
- 导入：Markdown(.md)、纯文本(.txt)、HTML(.html)、OPML(.opml)、以及 clnote 整库备份 `.clnote` / `.json`。
- 导出（单文件）：Markdown、HTML、纯文本、JSON、OPML、SVG、PNG、**EPUB**。
- 批量导出：可保留文件夹层级、打包成 ZIP、或合并成单个文件；**顺序严格按文件树从上到下**；桌面端导出均弹系统「另存为」指定精确位置。
- **EPUB 一键成书**：导出窗口填写书名 / 作者，正文自动带「书名 + 作者 + 目录」扉页、每卷首章前插入卷名页，生成 EPUB 3 电子书（可直接导入本应用阅读器或任意 EPUB 阅读器）。
- **整库备份 / 恢复（.clnote）**：一键把「文件树 + 素材库 + 快捷库 + 分类 + **设置**」完整导出为单个 `.clnote` 迁移文件，恢复支持「覆盖 / 合并」且可勾选「一并恢复设置」，换机 / 换软件数据与偏好一同迁移。

**设置 / 关于**
- 设置中心含：外观、编辑器、行为、存储（数据目录与备份恢复）、导出、背景、写作辅助等分组。
- **退出确认**：点击窗口右上角关闭（X）会先弹确认框；确认则退出，取消则**最小化到任务栏**（不退出软件）。
- 「关于」页展示版本号、开发者、技术栈、主要功能列表。

---

## 三、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Tauri 2 | Windows/Linux/macOS/Android 原生窗口，用系统 WebView 渲染，体积小 |
| 前端框架 | React 18 + TypeScript | UI 与状态管理 |
| 状态管理 | Zustand 4 | 轻量全局 store（`src/store/useStore.ts`） |
| 构建 | Vite 5 | 开发服务器（`npm run dev`）与产物打包（`npm run build`） |
| 编辑器 | TipTap v2（基于 ProseMirror） | 富文本 / 表格 / 任务列表 / 图片 / Mermaid |
| 流程图 | Mermaid 11 | 正文内流程图渲染 |
| 压缩包 / 电子书 | JSZip 3 | 批量导出打包 ZIP；EPUB 生成（mimetype STORE、META-INF、OPF/NCX） |
| EPUB 阅读 | epub.js | 分页阅读、CFI 进度记忆、划词高亮 |
| PDF 阅读 | pdf.js | 逐页阅读、滚动比例进度记忆 |
| 通知 / 提示音 | Web Notifications + Web Audio | 番茄钟完成通知、合成滴声（零 Tauri 插件依赖） |
| 后端（桌面） | Rust + rusqlite（bundled SQLite，含 FTS5） | 真源数据库 `clnote.db`（文件树 / 素材 / 快捷 / 伏笔 全部在此） |
| 后端（浏览器） | IndexedDB | `npm run dev` 时回退：文件树 `clnote-fs`、素材 `clnote-assets`、快捷 `clnote-shortcuts` |
| 系统能力插件 | `@tauri-apps/plugin-dialog`、`plugin-global-shortcut`、`plugin-opener` | 文件选择、老板键、打开链接/文件夹 |

**双存储后端设计（v2）**
- 桌面端（Tauri）：文件树、素材库、快捷库、伏笔**全部走 Rust SQLite**（`clnote.db`），同一份真源，天然支持自定义数据目录与便携模式。
- 浏览器端（`npm run dev`）：回退到 IndexedDB，三套独立库，保证纯前端也能完整演示功能（除真正的桌面最小化老板键）。
- 两者均对「大内容」无体积硬上限，无按大小拒绝逻辑。

---

## 四、目录结构（每个目录是干什么的）

```
notes-app/
├── index.html              # 前端入口 HTML（<div id="root">、全局标题）
├── package.json            # 前端依赖与脚本（dev/build/tauri），version = 3.0.0
├── tsconfig.json           # TypeScript 配置
├── vite.config.ts          # Vite 配置
├── clnote-icon-source.png  # 图标源图（克莱因蓝五角星，1024×1024）
├── clnote-icon-source.py   # 生成图标源图的脚本（Pillow 绘制）
├── INSTALL.md              # 安装运行指南（环境搭建）
├── EXE打包环境搭建指南.md   # Windows 打包注意事项
├── dist/                   # 前端构建产物（npm run build 生成，勿手改）
├── src/                    # 前端源码（核心，见第五节逐文件说明）
└── src-tauri/              # Rust 桌面端源码与配置
    ├── Cargo.toml          # Rust 依赖与发布配置，version = 3.0.0
    ├── tauri.conf.json     # 应用名/版本(3.0.0)/标识符/窗口/打包目标/图标清单/WebView2 模式
    ├── build.rs            # Tauri 构建脚本
    ├── icons/              # 全套图标（由 clnote-icon-source.png 生成）
    └── src/
        ├── main.rs         # 程序入口、Tauri 命令注册、启动打开数据库
        └── db.rs           # SQLite 数据库：建表、CRUD、搜索、迁移、数据目录偏好
```

> 完整说明文档即本文件（项目根目录 `README.md`）；仓库里还有一些 `笔记软件-*.md` 是早期技术选型调研，与 clnote 当前实现无关，可忽略。

前端 `src/` 下的目录划分：

| 目录 | 职责 |
|---|---|
| `src/model/` | 数据模型（TypeScript 类型定义），全局唯一的数据结构来源 |
| `src/store/` | Zustand 全局状态：节点列表、分栏、设置、选中项、导入导出开关 |
| `src/storage/` | 存储层：文件树（fs）、素材库（assets）、快捷库（shortcuts）、IndexedDB 工具（idb）、备份恢复（location） |
| `src/settings/` | 设置数据模型与设置对话框 |
| `src/editor/` | 文本笔记编辑器及其扩展（表格、Mermaid、智能标点、大纲、工具栏、伏笔栏、快照、跨节点引用、悬浮预览） |
| `src/export/` | 导出：序列化器（exporters）、EPUB 生成（epub）、执行器（runExport）、对话框、下载/另存为工具 |
| `src/import/` | 导入：格式识别（importers）、Markdown/HTML/OPML/文本 解析 |
| `src/material/` | 素材库看板（ThemeBoard） |
| `src/mindmap/` | 思维导图组件与布局算法 |
| `src/board/` | 任务看板组件 |
| `src/sidebar/` | 侧边栏（文件树 Tab + 素材库分类树） |
| `src/shortcut/` | 快捷库看板与分类树 |
| `src/media/` | 媒体库：统一侧边栏（MediaLibrary）、扩展名分派（mediaKind）、书/视频/音频查看器与常驻播放条（BookView/VideoPlayer/AudioBar/MediaWorkArea） |
| `src/search/` | 全局搜索逻辑与面板 |
| `src/platform/` | 平台相关能力：老板键、分类树操作、对话框、打开链接/文件夹、本地文件夹选择、番茄钟通知/提示音（notify） |
| `src/components/` | 全局组件：番茄钟（Pomodoro） |
| `src/theme/` | 主题定义 |
| `src/ui/` | 通用 UI（轻提示 toast） |
| `src/workbench/` | 主工作区（分栏、打开的笔记/导图/看板容器、反向引用面板） |

---

## 五、每个文件是做什么的（前端 src/）

### 根 / 入口
- **`src/main.tsx`** — React 挂载入口。刻意不包 `React.StrictMode`，避免开发模式下 effect 双调用导致 TipTap 重复初始化。
- **`src/App.tsx`** — 应用根组件。组装整体布局（侧边栏 + 顶栏 + 工作区），注册全局快捷键（Ctrl/Cmd+K/E/I/F/S/,），老板键逻辑，命令面板，全局搜索面板，设置/导入/导出对话框挂载点。
- **`src/about.ts`** — 应用元信息单一来源：名称 `clnote`、版本 `2.0.0`、开发者 `cl`、技术栈、主要功能列表。改名字/版本只动这里（其它三处 version 同步改即可）。

### 数据模型
- **`src/model/types.ts`** — 全部数据类型：`FsNode`（文件树节点）、`MindMapDoc`/`MindNode`（导图）、`BoardDoc`/`TaskCard`/`BoardColumn`（看板）、`Asset`/`AssetCategory`/`AssetTypeDef`（素材，内置类型为 文本/文件/其他）、`ShortcutItem`（快捷）。含 `newId()`、内置素材类型、空对象工厂、循环规则顺延 `advanceDue()`。

### 状态管理
- **`src/store/useStore.ts`** — Zustand store。集中管理：节点数组、分栏（左右两栏）、当前选中/展开、设置读写、导入/导出窗口开关、素材/快捷当前分类、保存处理器注册表。关键方法：`loadNodes`、`addNode`、`renameNode`、`deleteNode`、`moveNode`、`saveNodeContent`、`addImportedNodes`、`resolveNewParent`、`revealNode`。

### 存储层
- **`src/storage/fs.ts`** — 文件树存储层（桌面端真源为 SQLite）。探测 Tauri 环境：有则调用 Rust 命令（`list_nodes`/`save_node`/`delete_node`/`move_node`/`clear_all`/`put_many`/`next_order`/`search_nodes`），无则回退 IndexedDB。负责 content 的 JSON 字符串序列化/反序列化、snake/camel 字段归一化。
- **`src/storage/assets.ts`** — 素材库存储层（**双后端**：桌面端经 `invoke` 走 Rust SQLite 的 `list_assets`/`save_asset`/`delete_asset`/`*_asset_category`；浏览器回退 IndexedDB `clnote-assets`）。素材与分类的增删改查、批量写入与清空（供整库备份恢复用）。内置 v3 旧字段迁移（旧 `themeId`→`categoryId`）。
- **`src/storage/shortcuts.ts`** — 快捷库存储层（双后端，结构与素材库对称；桌面端走 Rust SQLite 的 `shortcuts` 表）。
- **`src/storage/idb.ts`** — IndexedDB 打开与**改名迁移**工具 `openMigratingDB`：新库为空且旧库存在时，整体把记录搬过来（保证改名不丢数据，供浏览器回退模式用）。
- **`src/storage/location.ts`** — 存储位置信息与整库备份/恢复。探测当前环境（tauri-fs / indexeddb）、展示路径与占用、`setDataDir` 切换桌面端数据目录、请求浏览器持久化存储；`buildBackup(settings)` 收集全部数据（**含设置**）导出 `.clnote`，`restoreBackup(json, 'replace'|'merge', {restoreSettings})` 恢复（merge 时各集合独立重映射 id 并修正 `categoryId`/`parentId`；可选一并应用备份中的设置）。
- **`src/storage/storage.ts`** — 文件式存储的兼容占位（早期设计，当前真源在 fs.ts；保留供需要时切换到纯文件存储）。

### 设置
- **`src/settings/settings.ts`** — 设置数据模型 `Settings`（外观/编辑器/行为/存储/导出/分区域背景/写作辅助/视图控制）、默认值、字体预设与本地字体探测、localStorage 持久化（兼容旧 key `clnote-settings`）、`applySettings()` 把设置映射为 CSS 变量 + body 主题类。
- **`src/settings/SettingsDialog.tsx`** — 设置对话框：外观、编辑器、**番茄钟（独立栏）**、行为、存储（**数据目录 + .clnote 备份/恢复，恢复可勾选「一并恢复设置」**）、导出、背景、写作辅助、快捷键与「关于」页。

### 编辑器（文本笔记）
- **`src/editor/Editor.tsx`** — 编辑器外层容器，连接 store 的保存/自动保存。
- **`src/editor/NoteEditor.tsx`** — TipTap 编辑器实例：挂载扩展、订阅智能标点开关、处理图片插入与素材插入；打字机固定框跟随光标、专注模式装饰、跨节点 @ 引用选择器、伏笔跳转定位、**选区字数 / 保存状态指示、切换笔记恢复光标位置**、版本快照恢复、编辑区 Ctrl+滚轮缩放。
- **`src/editor/extensions.ts`** — 编辑器扩展清单：StarterKit、Table 全家桶、TaskList、Image（扩展支持单图宽度）、MermaidBlock、SmartPunctuation。
- **`src/editor/Toolbar.tsx`** — 编辑器顶部工具栏（撤销/重做、加粗/标题/列表/表格/图片/导图/代码、**全角标点一键转换**、引用、设为伏笔）。
- **`src/editor/Outline.tsx`** — 标题大纲侧栏，点击跳转。
- **`src/editor/TableToolbar.tsx`** — 表格选中时的浮动工具（增删行列、合并/拆分）。
- **`src/editor/MermaidBlock.tsx`** — Mermaid 代码块节点视图（实时渲染、点击编辑）。
- **`src/editor/mermaidUtils.ts`** — Mermaid 渲染辅助。
- **`src/editor/SmartPunctuation.ts`** — 中文智能标点 ProseMirror 扩展（配对、跳出、左右同删、IME 整段归一、半角→全角标点映射）。
- **`src/editor/nodeRefShared.ts`** — 跨节点引用共享逻辑：`detectMention`/`applyMention`/`getNodeCards`/`NODE_REF_ORDER`。
- **`src/editor/NodeRefPicker.tsx`** — `@` 引用选择器弹窗（节点 / 卡片下钻选择）。
- **`src/editor/RefHoverCard.tsx`** — 引用芯片悬浮预览卡片（角色/剧情/设定/地图/正文摘要）。
- **`src/editor/ForeshadowRail.tsx`** — 伏笔栏：聚合某小说创作下的全部伏笔，完成/跳转/删除，正文标记同步高亮。
- **`src/editor/snapshots.ts`** — 版本快照存储（localStorage，每笔记 60 条，跨节点恢复事件）。
- **`src/editor/diffLines.ts`** — 行级 LCS 差异算法（快照对比用）。
- **`src/editor/SnapshotPanel.tsx`** — 快照面板：保存/恢复/删除/对比差异。

### 导出
- **`src/export/exporters.ts`** — 序列化器（纯函数）：笔记→Markdown/HTML/纯文本/JSON，导图→Markdown/纯文本/OPML/SVG/PNG/HTML；思维导图 SVG 与 `svgToPng()` 栅格化；文件名清洗 `sanitizeName()`。
- **`src/export/epub.ts`** — EPUB 3 生成器：`notesToEpub()` 用 JSZip 打包（mimetype STORE、META-INF/container.xml、content.opf、nav 目录、扉页（书名/作者/目录）、卷名页、章节页）。
- **`src/export/runExport.ts`** — 导出执行器：单文件导出、批量导出（保留层级/打包 ZIP/合并单文件）、同名去重、导出计数；**顺序按文件树从上到下**；单文件/EPUB/合并/ZIP 走系统「另存为」（`savedPath` 回报精确位置）；EPUB 支持书名/作者/卷名。
- **`src/export/ExportDialog.tsx`** — 导出对话框（选择格式、范围、ZIP/合并等；EPUB 时显示书名/作者输入）。
- **`src/export/download.ts`** — 下载工具 `downloadText`/`downloadBlob`、桌面端「另存为」`saveTextFileWithDialog`/`saveBlobWithDialog`（返回绝对路径，取消/失败退回下载）、图片选择 `pickImageFile`（可配置压缩上限）/ `pickHighResImage`（4096px，素材与插图用）。

### 导入
- **`src/import/importers.ts`** — 导入编排：按扩展名识别类型（`.json`/`.md`/`.html`/`.opml`/`.txt`），整库备份（`app==='clnote-backup'` 或旧 `'ccc-notes'`）识别并提示去「设置→备份与恢复」，其余解析成 `FsNode[]`。
- **`src/import/markdown.ts`** — Markdown → TipTap JSON（含首个标题作为笔记名）。
- **`src/import/html.ts`** — HTML → TipTap JSON、取 `<title>`。
- **`src/import/opml.ts`** — OPML → MindMapDoc。
- **`src/import/text.ts`** — 纯文本 → TipTap JSON。
- **`src/import/ImportDialog.tsx`** — 导入对话框（选择文件、预览、选父目录、写入）。

### 素材库 / 思维导图 / 看板 / 侧边栏 / 快捷库
- **`src/material/ThemeBoard.tsx`** — 素材库看板（v2 重构）：分类导航、**标签类型管理（新建带图标 / 删除 / 重命名）**、素材卡片（文本/文件/其他）、新建/编辑/删除、图片用 `pickHighResImage`、**卡片拖拽排序**。
- **`src/mindmap/MindMap.tsx`** — 思维导图编辑器组件（树结构编辑、折叠、备注）。
- **`src/mindmap/layout.ts`** — 思维导图布局算法（节点坐标计算）。
- **`src/board/Board.tsx`** — 任务看板组件（列/卡片/标签/优先级/截止/循环）。
- **`src/sidebar/Sidebar.tsx`** — 侧边栏容器：文件树 Tab 与素材库分类树 Tab 切换；文件树支持新建/重命名/移动到/设为默认/**删除**（级联删子分类与素材）、拖拽、右键菜单。
- **`src/sidebar/FileTree.tsx`** — 文件树组件：文件夹/笔记/导图嵌套、拖拽、`移动到…`、右键、新建/重命名/删除。
- **`src/shortcut/ShortcutBoard.tsx`** — 快捷库看板：本地文件夹 / 链接 / 笔记 三类快捷展示与打开、**卡片拖拽排序**。
- **`src/shortcut/ShortcutTree.tsx`** — 快捷库分类树（与素材库对称，支持拖拽/移动到/删除）。

### 媒体库（src/media/）
- **`src/media/mediaKind.ts`** — 扩展名白名单与归类工具：维护 `BOOK_EXT`/`TEXT_EXT`/`AUDIO_EXT`/`VIDEO_EXT`/`IMAGE_EXT`/`SUB_EXT`，`normExt`（去点 + 小写）/`mediaKindOf` 按扩展名判定媒体类型（book/text/audio/video/image），`collectMedia`（视频 + 同名 `.vtt`/`.srt` 字幕匹配 + 图片列表）/`flattenAudio`（收集全部音频做播放列表），供侧边栏与工作区复用（注意 `TreeNode` 从 `platform/diskTree` 导入）。
- **`src/media/MediaLibrary.tsx`** — 媒体库统一侧边栏：挂载点管理（多选 / 拖拽排序，reorder 用 `'media'`）、递归扫描**不过滤扩展名**、按扩展名分派——书/文本→`openMedia`、视频→带播放列表与字幕打开、图片→带图片列表打开、音频→`openAudio` 走常驻播放条。
- **`src/media/MediaPaneView.tsx`** — 媒体分栏统一分派（挂在 WorkArea 分栏里）：书/文本→`BookView`、视频→`VideoPlayer`、图片→`ImageViewer`、音频→提示看底部播放条；上下集/上下张通过 `openMedia` 替换当前分栏。
- **`src/media/BookView.tsx`** — 书籍查看器容器：按格式分派 epub.js / pdf.js / 纯文本阅读器，自带进度记忆（CFI / 滚动百分比）与批注（`listBookNotes`/`addBookNote`/`deleteBookNote`），文本支持字号调节（A−/A+，传 `fontSize` 给 `TextReader`）；props 为 `slot`。
- **`src/media/ImageViewer.tsx`** — 图片查看器：缩放（滚轮 / 按钮）、适应窗口 ↔ 原始尺寸、旋转 90°、上一张 / 下一张（同文件夹图片列表）、尺寸与序号显示。
- **`src/media/VideoPlayer.tsx`** — 自包含 `<video>` 播放器：倍速 / 静音 / 画中画 / 全屏 / 字幕 / 循环 / 进度记忆；上一集 / 下一集 / 播放结束通过 `onRequestNext` 回调切到播放列表下一集（不用全局 hack）。
- **`src/media/AudioBar.tsx`** — 全局底部常驻音频播放条（App 渲染）：直接读 store 的 `mediaAudio`/`mediaAudioList`，切换库 / 分栏 / 看书看视频时音乐不中断；播放列表可展开 / 收起，带静音。
- **`src/reading/TextReader.tsx`** — 纯文本阅读器：UTF-8 解码，出现乱码替换符时自动回退 GBK；支持 `fontSize` 字号；进度按滚动百分比记忆。

### 搜索
- **`src/search/searchAll.ts`** — 跨库搜索逻辑（聚合文件树节点匹配）。
- **`src/search/SearchPanel.tsx`** — 全局搜索面板（Ctrl/Cmd+F 打开，结果列表点击跳转）。

### 平台能力
- **`src/platform/bossKey.ts`** — 系统级老板键：桌面端用 `plugin-global-shortcut` 注册、按下最小化/恢复；失败回退说明由 App 用遮罩。
- **`src/platform/notify.ts`** — 纯前端通知与提示音：`showNotification`（Web Notifications，未授权静默）+ `playBeep`（Web Audio 合成滴声），番茄钟阶段完成提醒用。
- **`src/platform/categoryTree.ts`** — 分类树纯函数：子节点查询、是否后代、重定父、提升/降级（供素材/快捷分类树复用）。
- **`src/platform/dialog.ts`** — 统一确认/提示/输入对话框封装（`confirmAsync`/`alertAsync`/`promptAsync`），桌面端用 Tauri dialog，浏览器用原生；含 `iconPickerAsync`（emoji 网格选图标）。
- **`src/platform/open.ts`** — 打开链接 / 本地文件夹 / 文件（桌面端用 `plugin-opener`）。
- **`src/platform/pickFolder.ts`** — 选择本地文件夹（供快捷库「文件夹」类型与数据目录切换用）。
- **`src/platform/MoveToDialog.tsx`** — 「移动到…」通用选择弹窗（列出目标 + 搜索过滤，排除自身及后代防循环）。

### 主题 / 通用 UI / 工作区
- **`src/theme/themes.ts`** — 主题定义（浅色/暗色/纸感/护眼 的 CSS 变量值）。
- **`src/ui/toast.tsx`** — 轻提示组件 `toast()` / `<ToastHost/>`。
- **`src/components/Pomodoro.tsx`** — 番茄钟：顶栏常驻倒计时胶囊 + 展开面板（开始/暂停/重置/跳过、轮次圆点、今日完成数），计时阶段时长实时读设置，统计存 localStorage（按日期）。
- **`src/workbench/WorkArea.tsx`** — 主工作区：左右分栏容器（顶部工具栏「分栏」按钮控制），按分栏内容（`PaneContent`：节点 / 媒体 / 笔记）分派渲染笔记、导图、看板、素材、快捷、媒体查看器、笔记内容聚合；媒体与文件树节点共用同一套分栏。
- **`src/workbench/BacklinksPanel.tsx`** — 反向引用面板：扫描全部正文里指向当前节点的引用芯片，列出并可点击跳回。
- **`src/workbench/NotesView.tsx`** — 「笔记内容」视图：聚合 `listAllBookNotes()` 全部书籍批注，点击单条还原原书 `DiskEntry` 并 `openMedia` 跳回对应位置；在 WorkArea 分栏中渲染（`onClose` 关闭分栏）。

### Rust 桌面端（src-tauri/src/）
- **`src-tauri/src/main.rs`** — 程序入口。`open_db()` 打开数据库（优先读 `data_dir.txt` 偏好目录，否则默认位置）；注册 Tauri 命令：`list_nodes`/`get_node`/`save_node`/`delete_node`/`move_node`/`clear_all`/`put_many`/`next_order`/`search_nodes`/`get_data_dir`/`set_data_dir`；注册插件（global-shortcut / dialog / opener）。
- **`src-tauri/src/db.rs`** — SQLite 数据库层（文件树 / 素材 / 快捷 / 伏笔 全部在此）：
  - `FsNodeRow` / `AssetRow` / `AssetCategoryRow` 与前端对齐（`rename_all = "camelCase"`），content 以 JSON 字符串跨边界。
  - `app_data_dir()`：应用数据目录 `<OS data dir>/clnote`；`old_app_data_dir()`：改名前的 `ccc-notes`（用于一次性 `rename` 迁移）。
  - `open_at()`：建表（notes + FTS5 全文检索虚拟表 `notes_fts` + meta 偏好表 + assets/asset_categories/shortcuts/shortcut_categories + 伏笔等），WAL 模式。
  - `open()`：默认位置打开，兼容旧目录一次性迁移。
  - `read_data_dir_pref()` / `write_data_dir_pref()`：读取 / 写入**独立于数据 db** 的目录偏好文件 `data_dir.txt`，保证自定义数据目录在重启 / 更新版本后依然生效。
  - CRUD：递归删除（含后代）、移动（防循环、重排同级）、`put_many`（批量）、`next_order`、`search`（FTS5 + LIKE 兜底）。
  - `delete_asset_category` / `delete_shortcut_category`：**级联删除**其下所有子分类与卡片（v2）。
  - `migrate_to()`：切换数据目录时把数据整体迁到新位置（复制）；`set_saved_data_dir()` 在库内持久化偏好（与 `data_dir.txt` 双写）。
  - 含单元测试 `content_roundtrip_all_types`（验证各类型 content 透明往返）。

---

## 六、数据存储与「更换软件 / 更新版本不丢数据」

**两个运行环境的真源**
- 桌面端：**`<数据目录>/clnote.db`（单一 SQLite 文件）**。文件树、素材库、快捷库、伏笔**全部在这一个文件里**。
  - 默认数据目录：`%LOCALAPPDATA%/clnote/`（Windows）。
  - 便携模式（exe 同级有 `.portable`）：`<exe 所在目录>/clnote-data/`。
  - 自定义目录：设置 → 存储 → 选择目录，可指向任意本地文件夹（见下方"重启持久化"）。
- 浏览器端（`npm run dev`）：IndexedDB 库 `clnote-fs`（文件树）、`clnote-assets`（素材）、`clnote-shortcuts`（快捷）。

**更新版本是否影响数据**
- **不影响**。原因：数据真源是 `clnote.db` 文件，它存放在**系统数据目录 / exe 同级目录 / 你指定的文件夹**，与应用的"安装目录"分离。你重新打包、替换 exe、或升级版本时，只要不手动删掉那个 `clnote.db`，数据就原封不动。
- **自定义数据目录会持久化（v2 修复）**：在设置里"选择目录"后，偏好写入 `data_dir.txt`（独立于 `clnote.db`）。下次启动（含更新版本后）程序会先读该偏好并打开你指定的文件夹；旧实现重启会回退默认目录、让人误以为数据丢了，此问题已在 v2 修复。

**改名（cccnote → clnote）不丢数据，三路保障**
1. Rust 端：`db.rs::open()` 若新目录 `clnote` 不存在但旧 `ccc-notes` 存在，整体 `rename` 整个目录。
2. 前端 IndexedDB：浏览器回退模式下，每个库首次打开时若新库为空且旧库（`ccc-notes-*`）存在，`idb.ts` 自动把记录整体搬过来。
3. localStorage 设置：优先读新 key `clnote-settings`，回退读旧 `ccc-notes-settings`。

**整库备份 / 恢复（软件更换 / 换电脑的兜底）**
- 设置 → 存储 → 备份与恢复 → 「导出整库备份」：导出单个 **`.clnote` 迁移文件**（含文件树 + 素材库 + 快捷库及分类 + **应用设置**），文件名 `clnote-备份-<时间戳>.clnote`；桌面端弹「另存为」指定保存位置。
- 「从备份覆盖」：清空后全量写入；「合并」：冲突 id 自动重编号，并修正 `parentId`/`categoryId` 引用，避免断链或丢素材。
- 恢复时可勾选「**一并恢复设置**」：外观 / 编辑器 / 导出 / 番茄钟等偏好随数据一起迁移到新设备。
- 该备份是「软件更换后数据依然完好」的最可靠手段：换机器 / 换软件，只要拿到这个 `.clnote` 即可完整恢复（含偏好）。

---

## 七、如何打包

> 详细的环境搭建见仓库内 `INSTALL.md` 与 `EXE打包环境搭建指南.md`。下面给最常用流程。

### 1) 前端依赖与开发预览
```bash
cd notes-app
npm install
npm run dev          # 浏览器打开 http://localhost:5173，纯前端、无需 Rust
```
浏览器模式数据存 IndexedDB，可完整演示所有功能（除真正的桌面最小化老板键）。

### 2) 安装桌面端依赖（仅打包机需要）
- **Rust 工具链**：https://rustup.rs （Windows 会引导装 MSVC；Linux/mac 按提示装 clang）。
- **系统 WebView**（仅开发/打包机需要，目标电脑见下一节）：
  - Windows：Win11 自带 WebView2；Win10 装「WebView2 运行时」；另需「Visual Studio 生成工具」勾选「使用 C++ 的桌面开发」（rusqlite bundled 要从源码编译 SQLite）。
  - Linux：`sudo apt install -y libwebkit2gtk-4.1-dev build-essential pkg-config libgtk-3-dev ...`（中文输入建议 `fcitx5`）。
  - macOS：`xcode-select --install`。

### 3) 运行与打包
```bash
cd notes-app
npm install
npm run tauri dev     # 开发模式，热重载，方便调试
npm run tauri build   # 打包安装包
```
- Windows：生成 `src-tauri/target/release/bundle/nsis/*.exe`（NSIS 安装包，配置见 `tauri.conf.json` 的 `bundle.windows.webviewInstallMode`）。
- Linux：`.deb` / `.AppImage` / `.rpm`；macOS：`.app` / `.dmg`。
- 首次 `tauri build` 编译 Rust 依赖可能要几分钟到十几分钟。

### 3.5) Linux 打包注意事项（重点）

> **Tauri 不能从 Windows 直接交叉编译出 Linux 安装包**——必须在 Linux 环境里构建。Windows 用户最省事的是用 **WSL2 装一个 Ubuntu**，在里面跑下面的步骤；也可以直接用 Linux 真机 / 虚拟机 / Docker / GitHub Actions。

**在 Linux（或 WSL2 Ubuntu）里：**

```bash
# 1) 系统依赖（Ubuntu/Debian，首次必装）
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  pkg-config libgtk-3-dev

# 2) 工具链：Rust（https://rustup.rs）+ Node（建议 18+）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Node 用 nvm 或系统包管理器装

# 3) 进入项目并构建
cd notes-app
npm install
npm run tauri build                 # 默认打 .deb（Ubuntu/Debian 系）
npm run tauri build -- --bundles appimage   # 打 .AppImage（不依赖发行版，双击即跑）
npm run tauri build -- --bundles rpm        # 打 .rpm（Fedora/RHEL 系）
```

产物在 `notes-app/src-tauri/target/release/bundle/` 下对应的 `deb/`、`appimage/`、`rpm/` 子目录。

> 说明：`tauri.conf.json` 的 `bundle.targets` 已设为 `"all"`，因此同一份配置在 Windows 自动打 nsis、在 Linux 自动打 deb/appimage/rpm、在 macOS 自动打 app/dmg，无需为不同平台改配置。Linux 图标已补齐 `512x512.png`（deb 打包器必需）。
> WSL 里构建出的 `.deb` 是给真机 Linux 用的，不能直接在 WSL 图形环境里跑（WSL 默认无桌面）；装到带桌面的 Ubuntu/Debian 上即可双击安装。

### 4) 发布配置（`src-tauri/Cargo.toml` 的 `[profile.release]`）
已开启 `lto`、`codegen-units=1`、`opt-level="s"`、`strip=true`、`panic="abort"`，产物更小更快。

### 5) Android（可选）
```bash
npm run tauri android init     # 仅首次
npm run tauri android build    # 打包 apk / aab
```
需 Android SDK + NDK（Platform 34+ / NDK r25+）。

### 6) 装到其他电脑要不要装依赖（WebView2 运行时）

clnote 桌面端用 Tauri 2，Windows 上界面渲染依赖系统自带的 **Microsoft WebView2 运行时**。目标电脑能否「免依赖直接跑」分三种情况：

- **Windows 11**：系统已自带 WebView2，多数情况下双击安装包即可，无需任何额外操作。
- **Windows 10**：大部分机器也通过系统更新装好了 WebView2；个别精简版/老版本可能没有。
- **全新/精简系统**：若目标机没有 WebView2，安装包会在安装时联网下载并安装（需要目标机能联网一次）。

**WebView2 打包模式（`src-tauri/tauri.conf.json` 的 `bundle.windows.webviewInstallMode.type`）——如何开关「离线整包」**：

> 先纠正一个常见误解：这个配置**不是**「运行时先查本地 webview、没有再调离线的」。它只决定**安装阶段**怎么把 WebView2 装到目标机；应用运行时永远用系统已装的 WebView2。四种取值：
>
> | 模式 | 安装包体积 | 安装时行为 | 适用场景 |
> |---|---|---|---|
> | `offlineInstaller` | **+约 150MB**（最大） | 把完整运行时打进安装包，**完全离线、装完即跑** | 目标机都不能联网、要零依赖分发 |
> | `embedBootstrapper` | +约 1.5MB（很小） | 嵌入微型引导器；目标机**已有** WebView2 则什么都不下载，没有则**安装时联网补一次** | **默认推荐**：体积最小，绝大多数 Win10/11 本就自带 |
> | `downloadBootstrapper` | 极小 | 与 embed 类似，但引导器在构建时下载 | 同 embed，只是引导器不进仓库 |
> | `skip` | 0 | 完全不处理 WebView2，**假定系统已装** | 你 100% 确定目标机都有 WebView2 |
>
> 当前仓库默认是 **`embedBootstrapper`**（已关闭离线整包、显著减小安装包）。

**如何切换**（改完需重新 `npm run tauri build` 才生效）：

```json
"bundle": {
  "active": true,
  "targets": "nsis",
  "windows": {
    "webviewInstallMode": { "type": "embedBootstrapper" }
  },
  "icon": [ "icons/32x32.png", "icons/128x128.png", "128x128@2x.png", "icons/icon.icns", "icons/icon.ico" ]
}
```

- **想恢复「完全离线、零依赖」的大安装包** → 把 `type` 改回 `"offlineInstaller"`。
- **想进一步压到最小、且确信目标机都已装 WebView2** → 改成 `"skip"`。

**结论**：用当前配置打出的 `clnote-2.0.0-x64-setup.exe`，拷到另一台 Win10/11 电脑上双击安装即可使用，不需要目标机预先安装 Rust/Node/任何开发环境；仅有极少数没装 WebView2 的机器会在安装时联网补一次（Win11 几乎不会触发）。

### 7) 免安装 / 便携版（.portable 标记）

如果你不想走安装包，也想「数据跟着 exe 走、拷到哪台电脑都能直接用」，clnote 支持**便携模式**：

1. 正常 `npm run tauri build`，在 `src-tauri/target/release/` 下会生成**松耦合**的 `clnote.exe`（免安装、可直接拷贝）。
2. 把 `clnote.exe` 单独放进任意文件夹（U 盘、D 盘、网盘同步盘都行）。
3. **在该文件夹里新建一个空文件，命名为 `.portable`**（注意前面有个点，无扩展名）。
4. 双击 `clnote.exe` 启动。

启动后，**所有数据（文件树 + 素材库 + 快捷库 + 伏笔）都写在 exe 同级的 `clnote-data/clnote.db`**，不再散落到系统目录：

| 数据 | 便携模式位置 | 非便携（默认）位置 |
|---|---|---|
| 全部数据（单一 SQLite） | `<exe 所在目录>/clnote-data/clnote.db` | `%LOCALAPPDATA%/clnote/clnote.db` |

> 原理：Rust 端 `db.rs` 检测 `clnote.exe` 同级是否存在 `.portable`，存在则把 SQLite 目录改到 exe 旁边；`main.rs` 的 `setup` 里用 `WebviewWindowBuilder.data_directory()` 把 WebView 的 IndexedDB/localStorage 也重定向到 `<exe 目录>/clnote-data/webview/`（仅浏览器回退模式用到）。数据完全跟随 exe。

**使用注意**
- 删除/重命名那个 `.portable` 文件，下次启动就回到默认（系统目录）模式，两者数据互不影响。
- 想在便携版里把数据放到别的文件夹：设置 → 存储 → 选择目录（v2 已支持持久化），数据会整体迁移到你指定的文件夹，且重启/更新后依然生效。
- 便携模式的 exe 同样依赖系统 WebView2；当前打包默认用 `embedBootstrapper`，绝大多数 Win10/11 直接可用，个别没装的运行时会安装时联网补一次（详见本节第 6 点）。

---

## 八、如何更换图标

图标全部在 `notes-app/src-tauri/icons/`，覆盖 Windows(.ico)/macOS(.icns)/通用 PNG/商店 SquareLogo/Android mipmap/iOS AppIcon。

**做法 A（推荐）：用一张源图自动生成全套**
```bash
cd notes-app
# 把你的 logo（建议 1024×1024 透明 PNG）放好，例如 my-logo.png
npx tauri icon my-logo.png
```
Tauri 会自动覆盖 `src-tauri/icons/` 下全部尺寸图标。

**做法 B：手动替换**
直接覆盖这些文件（保持文件名不变）：
```
src-tauri/icons/
├── 32x32.png
├── 128x128.png
├── 128x128@2x.png
├── icon.png          # 512 或 1024 通用大图
├── icon.ico          # Windows 任务栏/EXE
├── icon.icns         # macOS
├── android/          # 各 dpi（mipmap-*/）
└── ios/              # AppIcon 各尺寸
```
`tauri.conf.json` 的 `bundle.icon` 已正确指向这些文件，一般无需改。

> 更换后需重新 `npm run tauri build` 才会打进安装包；`tauri dev` 也建议重启一次刷新缓存。

**本项目当前图标**
当前图标由 `clnote-icon-source.png`（克莱因蓝 `#002FA7` 五角星，1024×1024）经 `npx tauri icon` 生成。如需重新生成：
```bash
cd notes-app
C:\Users\clown\.workbuddy\binaries\python\envs\default\Scripts\python.exe clnote-icon-source.py
npx tauri icon clnote-icon-source.png
```
（`clnote-icon-source.py` 用 Pillow 绘制：外接圆半径占画布 42%、内凹点按黄金比例 0.381966，4096×4096 超采样后缩到 1024 得到干净边缘。改颜色只改脚本里的 `klein_blue`。）

---

## 九、常见问题

- **`npm install` 慢**：可换国内镜像 `npm config set registry https://registry.npmmirror.com`。
- **Windows `tauri build` 报找不到 C 编译器**：确认装了「Visual Studio 生成工具」并勾选「使用 C++ 的桌面开发」。
- **Linux 打包缺 webkit2gtk**：按第七节第 2 步装全依赖；中文输入装 `fcitx5`。
- **老板键在浏览器里只是遮罩**：浏览器没有「最小化窗口」，故回退为全屏遮罩；桌面端才是真正最小化。
- **导入整库备份没反应**：整库备份（`app: 'clnote-backup'`）不会作为普通节点导入，请到「设置 → 存储 → 备份与恢复」用「覆盖 / 合并」恢复，否则只导入文件树会丢素材/快捷。
- **大文件/大图片**：存储层对任意大小内容无硬上限；图片按用途分档压缩（背景图 1920px、素材/插图 4096px）以防内存/变量溢出，不影响清晰度。
- **中文搜索**：Rust 端已接 SQLite FTS5，内置零依赖中文分词（`simple_cn_tokenize`：CJK 逐字索引、ASCII 按词），查询按词连续匹配（`"小 说"` 强制短语，避免 "小明说" 误命中 "小说"），中文精确检索可用。
- **EPUB 导出的顺序 / 卷名**：顺序严格按文件树从上到下；每卷首章前会自动插入卷名页，开头带「书名 + 作者 + 目录」扉页；小说根下自动生成的「伏笔展示」节点不会混入成书。
- **导出的文件保存到哪了**：桌面端导出会弹系统「另存为」对话框让你指定精确位置（状态栏会显示完整路径）；浏览器模式（`npm run dev`）回退到浏览器「下载」文件夹。
- **更新版本后数据还在吗**：在。数据在独立的 `clnote.db`（系统目录 / exe 同级 / 你指定的文件夹），与应用安装目录分离；自定义数据目录偏好在 v2 已修复为重启/更新后依然生效。仍建议重大升级前用「整库备份」留一手。
- **拷到别的电脑跑不起来**：先用第七节的 `webviewInstallMode` 配置打包（默认 `embedBootstrapper`，绝大多数 Win10/11 自带 WebView2 可直接跑）；若目标机确属精简系统、安装时也不能联网，可临时改回 `offlineInstaller` 打离线整包。仍报错多半是杀软拦截安装包，加入白名单或换 NSIS 输出目录重试。

---

> 文档版本：对应 clnote v3.0.0（第三版）。如代码结构有调整，请以实际源码与 `src/about.ts` 为准。
