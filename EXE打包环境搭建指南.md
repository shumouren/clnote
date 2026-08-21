# ccc 笔记 — Windows EXE 打包环境搭建指南（超详细）

本文档面向「第一次在本机打包成 exe」的场景，按 **安装顺序** 一步步写。  
只要照着做，最终用一条命令就能产出可安装的 `.exe`（NSIS）和 `.msi`（WiX）。

> 适用项目：`notes-app/`（Tauri 2 + React + Vite + rusqlite[`bundled`] + pinyin）  
> 目标产物：`src-tauri/target/release/bundle/` 下的安装包  
> 系统要求：Windows 10 / 11 64 位

---

## 0. 整体的产物长什么样

打包完成后会生成：

```
notes-app/src-tauri/target/release/bundle/
├── nsis/        ← ccc-notes_0.1.0_x64-setup.exe   （双击安装版，最常用）
├── msi/         ← ccc-notes_0.1.0_x64_en-US.msi    （企业部署用）
└── ...
```

当前 `tauri.conf.json` 里的配置：

```jsonc
"bundle": {
  "active": true,
  "targets": "all",          // 同时打 nsis(.exe) 和 wix(.msi)
  "icon": ["icons/icon.png"] // ⚠️ 现在只有 70 字节占位图，必须先换真实图标
}
```

---

## 1. 安装 Rust 工具链（必须）

Rust 用来编译 `src-tauri/` 下的后端（含从源码编译 SQLite）。

1. 打开官网 <https://rustup.rs> ，点击 **Download rustup-init.exe**（Windows 版）。
2. 双击运行，出现黑框时选 **1) Default installation**（默认回车即可）。
   - 它会自动安装 `rustc` / `cargo` 以及 **MSVC 目标**（`stable-x86_64-pc-windows-msvc`）。
3. 安装完会提示「关闭此窗口」。关闭后 **重新打开一个 PowerShell 或 CMD**（让 PATH 生效）。
4. 验证：
   ```powershell
   rustc --version
   cargo --version
   ```
   能打印出版本号（如 `rustc 1.8x.x`）即成功。

> 提示：国内部署可设镜像加速（可选，网络好可跳过）：
>
> ```powershell
> $env:RUSTUP_DIST_SERVER = "https://rsproxy.cn"
> $env:CARGO_HOME = "$env:USERPROFILE\.cargo"
> # 然后把上面两行写进系统环境变量，或每次新开窗口执行一次
> ```

---

## 2. 安装 MSVC C++ 生成工具（必须，最容易漏）

本项目 `Cargo.toml` 里：

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
```

`bundled` 意味着 **从 C 源码编译 SQLite**，必须有 C/C++ 编译器。  
**没有它，`cargo build` 会直接报错找不到 `cl.exe` / `link.exe`。**

1. 下载 **Visual Studio 2022 生成工具**（Build Tools，不是完整 IDE，体积小很多）：  
   <https://visualstudio.microsoft.com/zh-hans/downloads/> → 找到「Visual Studio 2022 生成工具」下载。
2. 双击运行安装器，在工作负载页 **务必勾选**：
   - ✅ **使用 C++ 的桌面开发**（英文：Desktop development with C++）
3. 右侧「安装详细信息」里确认包含：
   - ✅ MSVC v14x - VS 2022 C++ x64/x86 生成工具
   - ✅ Windows 10/11 SDK（任选一个版本即可，如 Windows 10 SDK 10.0.x）
   - ✅ 适用于 Windows 的 C++ CMake 工具（可选，但勾上更稳）
4. 点「安装」，等待完成（约 2–5 GB，需要联网）。
5. 安装后 **必须重启一次电脑**，让 `cl.exe` 等工具进入 PATH。

> 验证（重启后）：打开「x64 Native Tools Command Prompt for VS 2022」，  
> 输入 `cl` 能看到 Microsoft 编译器版权信息即成功。普通 PowerShell 里 `cargo build` 也能自动找到它。

---

## 3. 安装 WebView2 运行时（必须，一般已带）

Tauri 2 在 Windows 上渲染界面依赖 **WebView2（Edge 内核）**。

- Windows 10/11 大部分已预装。验证：
  - 任务管理器里搜「WebView2」进程，或访问 `edge://settings/help` 看 Edge 版本。
- 如果确实没有（极少数精简系统），装 runtime：  
  <https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/> → 下载「Evergreen Bootstrapper」安装。
- ⚠️ 本项目 `tauri.conf.json` 的 `bundle` 已配置把 WebView2 引导程序打进安装包  
  （Tauri 默认 `webviewInstallMode = downloadBootstrapper`），所以**最终用户机器上没装也会自动引导安装**，  
  本机打包时只要自己机器有就行。

---

## 4. 安装打包器：WiX 与 NSIS

`bundle.targets: "all"` 会同时产出 `.msi`（WiX）和 `.exe`（NSIS）。

### 4.1 NSIS（出 .exe，推荐优先）

- NSIS 由 Tauri **自动下载**，无需手动安装。只要本机能联网，首次打包会自己拉取。
- 所以「只想要 exe 安装包」的话，**这步可以什么都不做**。

### 4.2 WiX Toolset v3.11（出 .msi，必须手动装）

> ⚠️ **只能装 3.11，不要装 4.x / 5.x** —— Tauri 2 当前只认 WiX 3.11。

1. 下载：<https://github.com/wixtoolset/wix3/releases> （找 `wix311-binaries.zip` 或 `wix311.exe`）。
2. 安装/解压后，把 `bin` 目录加入 **系统 PATH**（如 `C:\Program Files (x86)\WiX Toolset v3.1\bin`）。
3. 验证：新开 PowerShell 输入 `candle` / `light`，能打印用法即成功。

### 4.3 想省事：只打 exe（最推荐新手）

如果你只是想最快拿到一个能发的 exe，可以把 `tauri.conf.json` 改成只出 NSIS：

```jsonc
"bundle": {
  "active": true,
  "targets": "nsis",     // 只出 .exe，不必装 WiX
  "icon": ["icons/icon.png"]
}
```

> 本项目已经帮你把 `targets` 改成了 `"nsis"` 即可，等你想出 msi 再改回 `"all"` 并装 WiX 3.11。

---

## 5. 生成真实图标（当前 blocker，必须先做）

现在 `src-tauri/icons/icon.png` 只有 **70 字节**，是无效占位图，打包会失败或出空图标。

1. 准备一张 **512×512 PNG**（建议透明底，方图）。  
   放到任意位置，比如 `notes-app/icon-source.png`。
2. 在项目根 `notes-app/` 下执行：
   ```powershell
   npx tauri icon icon-source.png
   ```
   它会自动：
   - 生成完整图标集：`icons/icon.png`(512)、`icon.ico`、`icon.icns`、各种尺寸 png、  
     以及 Windows 商店用的 `Square*Logo.png` / `StoreLogo.png`。
   - **自动更新** `tauri.conf.json` 的 `bundle.icon` 列表为完整图标集。
3. 之后 `tauri.conf.json` 的 icon 会变成：
   ```jsonc
   "icon": [
     "icons/32x32.png",
     "icons/128x128.png",
     "icons/128x128@2x.png",
     "icons/icon.icns",
     "icons/icon.ico"
   ]
   ```

> 没有现成图？用任意在线工具（如 favicon 生成器）导一张 512 PNG 即可，不要求美术水平。

---

## 6. 安装 Node 环境（你大概率已有）

- 需要 **Node 22**（项目已用 22 验证）。检查：`node -v`。
- npm 随 Node 自带。
- 依赖已安装（`node_modules` 在 `notes-app/` 下）；若换机器，先 `npm install`。
- `@tauri-apps/cli` 已在 `devDependencies`，无需单独装。

---

## 7. 代码签名证书（可选，但强烈建议）

- 不签名也能出 exe，但用户双击安装包时会看到 Windows SmartScreen 的  
  「Windows 已保护你的电脑 / 未知发布者」红字警告。
- 消除办法：购买 **EV 或 OV 代码签名证书**（DigiCert / Sectigo 等），  
  然后在 `tauri.conf.json` 的 `bundle.windows` 里配置 `certificateThumbprint` 与  
  `digestAlgorithm`（或用环境变量注入 pfx 和密码）。
- 个人项目可先跳过，等发布再处理。

---

## 8. 第一次打包（耐心等，会联网编译）

1. 确保所有窗口已关闭并重新打开了终端（PATH 生效）。
2. 在 `notes-app/` 下执行（等价于 `npm run tauri build`）：
   ```powershell
   npx tauri build
   ```
3. 首次会：
   - `npm run build` 先构建前端（Vite）→ 产出 `dist/`。
   - `cargo` 拉取并编译所有 Rust crate（rusqlite 要从 C 源码编译 SQLite，较耗时，  
     **首次 5–15 分钟**，之后有缓存就快了）。
   - 用 WiX/NSIS 打包。
4. 成功后在 `src-tauri/target/release/bundle/` 看到安装包。

> 想只编译不打包（快速验证后端能编译）：
>
> ```powershell
> npx tauri build --no-bundle
> ```
>
> 或直接 `cargo build`（在 `notes-app/src-tauri/` 下）。

---

## 9. 常见问题速查

| 现象                                                                      | 原因                                  | 解决                                       |
| ----------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| `error: failed to run custom build command for rusqlite` / 找不到 `cl.exe` | 没装 MSVC 生成工具                        | 回看第 2 步，装「使用 C++ 的桌面开发」并重启               |
| `error: linker 'link.exe' not found`                                    | 同上，PATH 未刷新                         | 重启电脑；或用 VS 自带「x64 Native Tools」终端        |
| 图标报错 / 空图标                                                              | `icon.png` 是占位图                     | 回看第 5 步 `npx tauri icon`                 |
| WiX 报错 `The WiX toolset is required`                                    | 没装 WiX 3.11                         | 装 WiX 3.11 并加 PATH；或把 `targets` 改 `nsis` |
| SmartScreen 红字警告                                                        | 没代码签名                               | 第 7 步；或用户点「仍要运行」                         |
| 安装后数据是空的 / 和浏览器不一致                                                      | 桌面端数据存本地 SQLite，和浏览器 IndexedDB 本就独立 | 见下方「数据说明」                                |
| `cargo` 下载极慢                                                            | 网络/镜像                               | 设 rsproxy 镜像（第 1 步）                      |

---

## 10. 本项目的「数据存哪」说明（已接 SQLite 后端）

按你拍板的 **方案 B（正规路径）**，桌面端数据现在走 Rust 端 SQLite：

- 数据库文件：`ccc-notes.db`，位于  
  `C:\Users\<你>\AppData\Roaming\ccc-notes\ccc-notes.db`  
  （即 OS 数据目录下的 `ccc-notes/`，由后端 `app_data_dir()` 计算）。
- 前端 `src/storage/fs.ts` 在检测到 Tauri 运行时，会把所有节点读写  
  **自动路由到 Rust 命令**（`list_nodes` / `save_node` / `delete_node` / `move_node` / …），  
  浏览器里仍回退 IndexedDB（保证 `npm run dev` 直接在网页也能用）。
- 设置面板里「文件存储 → 更改位置」调用 `set_data_dir`，会把现有数据  
  **迁移**到新目录并持久化偏好（后端已实 `migrate_to` + `meta` 表）。
- 备份/恢复（整库 JSON）走 `buildBackup` / `restoreBackup`，在桌面端也会落到 SQLite。

> 也就是说：以前打包出来的 exe 实际把数据存在 WebView2 的 IndexedDB（不规范）；  
> 现在已切到真正的本地 SQLite 文件，符合「正规」要求。

---

## 11. 一句话命令清单（按顺序执行）

```powershell
# 1) 装 Rust（官网 rustup-init.exe，选 Default）
rustc --version; cargo --version

# 2) 装 VS2022 生成工具，勾「使用 C++ 的桌面开发」，重启

# 3) 确认 WebView2 已装（没有就去装 runtime）

# 4) 想出 msi 再装 WiX 3.11 并加 PATH；只出 exe 跳过
#    并把 tauri.conf.json 的 targets 改为 "nsis"

# 5) 生成图标
cd notes-app
npx tauri icon <你的512图>.png

# 6) 打包
npx tauri build

# 产物：
# src-tauri/target/release/bundle/nsis/ccc-notes_0.1.0_x64-setup.exe
```
