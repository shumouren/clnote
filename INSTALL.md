# ccc 笔记 —— 安装与运行指南

技术栈：**Tauri 2 + React + TypeScript + Vite + TipTap**。专注中文编辑（智能标点、富文本、内嵌表格）。
你在 Windows / Linux / Android 三端都能用。下面按「想怎么跑」分三种方式，挑适合自己的。

---

## 方式 A：浏览器里直接试用（最快，今天就能跑）

> 不需要 Rust、不需要装任何系统依赖。前端用 IndexedDB 当临时数据库，所有功能（编辑器、智能标点、表格、主题、命令面板）都能在浏览器里完整体验。

**你需要装：**
- **Node.js 18 以上**（推荐 20 LTS 或 22）。下载：https://nodejs.org （装 LTS 版即可）

**步骤：**
```bash
cd notes-app
npm install          # 拉取前端依赖（首次会等一两分钟）
npm run dev         # 启动开发服务器
```
然后浏览器打开终端里给出的地址，一般是 **http://localhost:5173**

> 如果你机器上已经有全局 Node，直接 `npm` 即可；如果只想用 WorkBuddy 自带的 Node，把 `npm` 换成该 node 的完整路径再跑 `node 路径/npm/cli.js`。

**试用清单：**
- 敲 `(` `（` `[` `【` `《` `"` `“` → 自动补右符号、光标在中间
- 括号里输完按 `Enter` → 跳出配对、不换行
- 紧贴括号内侧按 `Backspace` → 左右一起删
- 顶部「▦ 表格」插入表格；选中单元格后用「合并 / 拆分 / 增删行列」
- 右上角 ⚙ 改主题与强调色；`Ctrl/Cmd+K` 打开命令面板

---

## 方式 B：打包成桌面应用（Windows / Linux / macOS）

> 这才会用到 Rust 和 Tauri。打包后是一个原生窗口、自己带 WebView、**不依赖浏览器**，数据存成本地 SQLite 文件。

### 1) 装 Rust 工具链
- 访问 https://rustup.rs ，按提示安装（Windows 会引导你装 **Visual Studio 生成工具 / MSVC**；Linux/mac 按提示装 clang 等）
- 装完确认：
  ```bash
  rustc --version
  cargo --version
  ```

### 2) 装系统 WebView 依赖（Tauri 把系统浏览器内核当渲染层）

**Windows（你主力系统）：**
- Windows 11 自带 WebView2；Windows 10 去装一下「WebView2 运行时」：
  https://developer.microsoft.com/microsoft-edge/webview2/
- 另外需要 **Visual Studio 生成工具**（勾选「使用 C++ 的桌面开发」），因为 rusqlite 用 bundled 模式要从源码编译 SQLite。

**Linux（Ubuntu / Debian，你要支持 Linux 桌面）：**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential \
  curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  pkg-config libgtk-3-dev
```
- **中文输入（关键）**：装 `fcitx5` 并切到 fcitx5 输入法，否则 Linux 下中文输入可能调不起来。
  ```bash
  sudo apt install -y fcitx5 fcitx5-pinyin fcitx5-configtool
  ```
  （M0 阶段我会在 Linux 上实测 WebKitGTK + fcitx5 的中文输入，这是当初排除 Flutter 的关键原因。）

**macOS：**
```bash
xcode-select --install
```

### 3) 运行 / 打包
```bash
cd notes-app
npm install              # 会一并装 @tauri-apps/cli（package.json 已加）
npm run tauri dev        # 开发模式：热重载，方便调试
npm run tauri build      # 打包成安装包（Windows 的 .msi / Linux 的 .deb / macOS 的 .app）
```

> 第一次 `tauri build` 会编译 Rust 依赖，可能要几分钟到十几分钟，正常。

---

## 方式 C：打包 Android（你要的三端之一）

> Tauri 2 支持 Android。需要 Android SDK + NDK，且用 Linux 或 macOS 作为构建主机更顺（Windows 也能，但坑略多）。

**你需要装：**
1. **Android Studio**（自带 SDK Manager）
2. 在 SDK Manager 里装：
   - **Android SDK Platform 34+**
   - **NDK (Side by side) r25+**
   - **Android SDK Command-line Tools**
3. 设置环境变量（或让 Android Studio 自动管理）：
   ```
   ANDROID_HOME = 你的 sdk 路径
   NDK_HOME     = 你的 ndk 路径
   ```

**步骤：**
```bash
cd notes-app
npm install
npm run tauri android init     # 首次：生成 android/ 工程（只需一次）
npm run tauri android dev      # 连上手机/模拟器直接跑
npm run tauri android build    # 打包 apk / aab
```
> 注意：Tauri 的 Android 支持仍偏早期，建议先在桌面把功能做稳，Android 放到后面阶段验证。

---

## 中文搜索（M1 升级项，当前状态）

- 当前 Rust 端已接 `rusqlite + FTS5`：拼音搜索走 FTS5，中文精确串走 `LIKE` 兜底。
- **真正的中文分词检索**需要把 FTS5 的分词器换成 `wangfenjin/simple`（微信开源的中文+拼音分词器，MIT）。这一步需要把它的 C 源码编进 rusqlite，我放在 **M1** 做，代码里已用注释标好位置（`src-tauri/src/db.rs` 的 `notes_fts` 建表处）。

---

## 常见问题

- **`npm install` 卡住 / 慢**：可能是 registry 网络问题，可换国内镜像
  `npm config set registry https://registry.npmmirror.com`
- **Windows 上 `tauri build` 报找不到 C 编译器**：确认装了「Visual Studio 生成工具」且勾选了「使用 C++ 的桌面开发」。
- **Linux 打包报缺 webkit2gtk**：按方式 B 第 2 步把依赖装全。
- **想换数据库真源为文件（而不是 SQLite）**：M0 阶段前端用 IndexedDB 演示；接 Tauri 后真源就是 SQLite。若坚持文件式，改 `src/storage/storage.ts` 与 `src-tauri/src/db.rs` 即可。
