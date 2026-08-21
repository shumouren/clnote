#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{
    Db, FsNodeRow, ForeshadowRow, MoveInput, AssetRow, AssetCategoryRow, ShortcutRow, DiskEntry,
    MountedFolderRow, BookProgressRow, BookNoteRow, MediaProgressRow,
};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use tauri::Manager;
use tauri::http;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{WebviewWindowBuilder, WebviewUrl};

/// 退出行为：关闭窗口时是否最小化到系统托盘（右下角）而非直接退出。
/// 默认 true（参考微信/QQ 等：点 X 收进托盘）。可在设置里关闭。
struct CloseBehavior(Mutex<bool>);

/// 读取持久化的退出行为偏好（存于 app 配置目录下的 close_behavior.json）
fn load_close_behavior(app: &tauri::AppHandle) -> bool {
    if let Ok(dir) = app.path().app_config_dir() {
        let p = dir.join("close_behavior.json");
        if let Ok(s) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                return v
                    .get("minimizeToTray")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(true);
            }
        }
    }
    true
}

fn save_close_behavior(app: &tauri::AppHandle, minimize: bool) {
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("close_behavior.json");
        let _ = std::fs::write(&p, serde_json::json!({ "minimizeToTray": minimize }).to_string());
    }
}

/// 构建系统托盘：
/// - 左键单击：切换窗口显隐（可见且未最小化时收起，否则恢复并置前）。
/// - 右键单击：弹出菜单（显示 / 退出）。
///
/// 关键修复：on_tray_icon_event 必须【只处理左键 + 鼠标抬起】，否则右键弹出菜单的瞬间
/// 会因 set_focus 把焦点抢回主窗口，导致菜单立刻消失、点不到「退出」——表现即「右键点不动、
/// 无法退出软件」。右键路径完全交给 OS 弹菜单，这里不碰。
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 clnote", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 clnote", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or_else(|| panic!("缺少默认窗口图标，无法创建托盘"));
    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("clnote")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 只响应【左键松开】，避免与右键菜单冲突（右键交由 OS 弹菜单处理，不抢焦点）。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let visible = w.is_visible().unwrap_or(false);
                    let minimized = w.is_minimized().unwrap_or(false);
                    if visible && !minimized {
                        // 窗口可见且未最小化：收起到托盘（给明确反馈）
                        let _ = w.hide();
                    } else {
                        // 隐藏或最小化：恢复并显示 + 置前
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
fn list_nodes(db: State<Mutex<Db>>) -> Result<Vec<FsNodeRow>, String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .list_nodes()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_node(id: String, db: State<Mutex<Db>>) -> Result<Option<FsNodeRow>, String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .get_node(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_node(node: FsNodeRow, db: State<Mutex<Db>>) -> Result<(), String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .save_node(&node)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_node(id: String, db: State<Mutex<Db>>) -> Result<(), String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .delete_node(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn move_node(input: MoveInput, db: State<Mutex<Db>>) -> Result<(), String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .move_node(&input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_all(db: State<Mutex<Db>>) -> Result<(), String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .clear_all()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn put_many(nodes: Vec<FsNodeRow>, db: State<Mutex<Db>>) -> Result<(), String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .put_many(&nodes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn next_order(parent_id: Option<String>, db: State<Mutex<Db>>) -> Result<i64, String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .next_order(parent_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn search_nodes(q: String, db: State<Mutex<Db>>) -> Result<Vec<db::FsNodeMeta>, String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .search(&q)
        .map_err(|e| e.to_string())
}

/// 返回当前数据库所在目录（优先读保存过的偏好，其次实际目录）
#[tauri::command]
fn get_data_dir(db: State<Mutex<Db>>) -> Result<String, String> {
    let guard = db.lock().map_err(|_| "数据库锁被污染".to_string())?;
    Ok(guard.data_dir().to_string())
}

/// 切换数据存储目录：把现有数据迁移过去，并持久化偏好
#[tauri::command]
fn set_data_dir(path: String, db: State<Mutex<Db>>) -> Result<String, String> {
    let dir = PathBuf::from(&path);
    let new_db = {
        let guard = db.lock().map_err(|_| "数据库锁被污染".to_string())?;
        guard
            .migrate_to(&dir)
            .map_err(|e| format!("迁移数据库失败：{e}"))?
    };
    // 替换 state 中的句柄
    *db.lock().map_err(|_| "数据库锁被污染".to_string())? = new_db;
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .set_saved_data_dir(&path)
        .map_err(|e| e.to_string())?;
    // 把偏好写进独立于数据 db 的文件，保证重启 / 更新版本后仍能读回并打开该目录
    db::write_data_dir_pref(&path);
    Ok(path)
}

/* ---------------- 伏笔（标注） ---------------- */

#[tauri::command]
fn list_foreshadowings(
    novel_id: String,
    db: State<Mutex<Db>>,
) -> Result<Vec<ForeshadowRow>, String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .list_foreshadowings(&novel_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn add_foreshadow(f: ForeshadowRow, db: State<Mutex<Db>>) -> Result<(), String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .add_foreshadow(&f)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_foreshadow_done(
    id: String,
    done: i64,
    db: State<Mutex<Db>>,
) -> Result<(), String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .set_foreshadow_done(&id, done)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_foreshadow(id: String, db: State<Mutex<Db>>) -> Result<(), String> {
    db.lock()
        .map_err(|_| "数据库锁被污染".to_string())?
        .delete_foreshadow(&id)
        .map_err(|e| e.to_string())
}

/// 由前端选择保存路径后，把字节写入该文件（用于「导出素材」保存到本地）。
/// 之所以用 Rust 命令而非 <a download>，是因为 Tauri v2 的 WebView 会静默拦截
/// a[download] 的下载；显式写文件最可靠，且用户可在系统「另存为」对话框中自选路径。
#[tauri::command]
fn save_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| format!("写入文件失败：{e}"))
}

/// 由前端设置同步「关闭窗口时最小化到系统托盘」偏好（并持久化）
#[tauri::command]
fn set_close_behavior(minimize: bool, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(cb) = app.try_state::<CloseBehavior>() {
        *cb.0.lock().unwrap() = minimize;
    }
    save_close_behavior(&app, minimize);
    Ok(())
}

/* ================ 媒体协议辅助 ================ */

/// 从 query 串（path=...&x=...）解析指定参数并做最小 percent-decode
fn parse_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next()?;
        let v = it.next().unwrap_or("");
        if k == key {
            return Some(percent_decode(v));
        }
    }
    None
}

/// 最小化的 percent-decode（处理 %XX 与 +），足以还原 encodeURIComponent 的结果
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 依据扩展名推断 MIME，供媒体 / 阅读器正确播放 / 渲染
fn mime_for(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") || lower.ends_with(".oga") {
        "audio/ogg"
    } else if lower.ends_with(".m4a") {
        "audio/mp4"
    } else if lower.ends_with(".flac") {
        "audio/flac"
    } else if lower.ends_with(".aac") {
        "audio/aac"
    } else if lower.ends_with(".wma") {
        "audio/x-ms-wma"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".mkv") {
        "video/x-matroska"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else if lower.ends_with(".avi") {
        "video/x-msvideo"
    } else if lower.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if lower.ends_with(".epub") {
        "application/epub+zip"
    } else if lower.ends_with(".pdf") {
        "application/pdf"
    } else if lower.ends_with(".txt") {
        "text/plain; charset=utf-8"
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "text/markdown; charset=utf-8"
    } else if lower.ends_with(".mobi") {
        "application/x-mobipocket-ebook"
    } else if lower.ends_with(".azw") || lower.ends_with(".azw3") {
        "application/vnd.amazon.ebook"
    } else if lower.ends_with(".cbz") {
        "application/vnd.comicbook+zip"
    } else if lower.ends_with(".cbr") {
        "application/vnd.comicbook-rar"
    } else if lower.ends_with(".djvu") {
        "image/vnd.djvu"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}

/* ================ 素材库（SQLite 持久化） ================ */

#[tauri::command]
fn list_assets(state: State<Mutex<Db>>) -> Result<Vec<AssetRow>, String> {
    state.lock().unwrap().list_assets().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_asset(state: State<Mutex<Db>>, id: String) -> Result<Option<AssetRow>, String> {
    state.lock().unwrap().get_asset(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_asset(state: State<Mutex<Db>>, asset: AssetRow) -> Result<(), String> {
    state.lock().unwrap().save_asset(&asset).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_asset(state: State<Mutex<Db>>, id: String) -> Result<(), String> {
    state.lock().unwrap().delete_asset(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_asset_categories(state: State<Mutex<Db>>) -> Result<Vec<AssetCategoryRow>, String> {
    state.lock().unwrap().list_asset_categories().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_asset_category(state: State<Mutex<Db>>, cat: AssetCategoryRow) -> Result<(), String> {
    state.lock().unwrap().save_asset_category(&cat).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_asset_category(state: State<Mutex<Db>>, id: String) -> Result<(), String> {
    state.lock().unwrap().delete_asset_category(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn put_many_assets(state: State<Mutex<Db>>, list: Vec<AssetRow>) -> Result<(), String> {
    state.lock().unwrap().put_many_assets(&list).map_err(|e| e.to_string())
}

#[tauri::command]
fn put_many_asset_categories(state: State<Mutex<Db>>, list: Vec<AssetCategoryRow>) -> Result<(), String> {
    state.lock().unwrap().put_many_asset_categories(&list).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_all_assets(state: State<Mutex<Db>>) -> Result<(), String> {
    state.lock().unwrap().clear_all_assets().map_err(|e| e.to_string())
}

/* ================ 快捷库（SQLite 持久化） ================ */

#[tauri::command]
fn list_shortcuts(state: State<Mutex<Db>>) -> Result<Vec<ShortcutRow>, String> {
    state.lock().unwrap().list_shortcuts().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_shortcut(state: State<Mutex<Db>>, id: String) -> Result<Option<ShortcutRow>, String> {
    state.lock().unwrap().get_shortcut(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_shortcut(state: State<Mutex<Db>>, item: ShortcutRow) -> Result<(), String> {
    state.lock().unwrap().save_shortcut(&item).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_shortcut(state: State<Mutex<Db>>, id: String) -> Result<(), String> {
    state.lock().unwrap().delete_shortcut(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_shortcut_categories(state: State<Mutex<Db>>) -> Result<Vec<AssetCategoryRow>, String> {
    state.lock().unwrap().list_shortcut_categories().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_shortcut_category(state: State<Mutex<Db>>, cat: AssetCategoryRow) -> Result<(), String> {
    state.lock().unwrap().save_shortcut_category(&cat).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_shortcut_category(state: State<Mutex<Db>>, id: String) -> Result<(), String> {
    state.lock().unwrap().delete_shortcut_category(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn put_many_shortcuts(state: State<Mutex<Db>>, list: Vec<ShortcutRow>) -> Result<(), String> {
    state.lock().unwrap().put_many_shortcuts(&list).map_err(|e| e.to_string())
}

#[tauri::command]
fn put_many_shortcut_categories(state: State<Mutex<Db>>, list: Vec<AssetCategoryRow>) -> Result<(), String> {
    state.lock().unwrap().put_many_shortcut_categories(&list).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_all_shortcuts(state: State<Mutex<Db>>) -> Result<(), String> {
    state.lock().unwrap().clear_all_shortcuts().map_err(|e| e.to_string())
}

/* ================ v3 新库（阅读 / 音乐 / 视频）基础设施 ================ */

/// 递归扫描磁盘目录，返回文件 / 文件夹条目（供阅读 / 音乐 / 视频库构建文件树）。
/// - recursive: 是否递归子目录（用户要求"全递归"）
/// - extensions: 可选扩展名白名单（如 [".epub",".pdf"]），命中才返回文件；目录始终返回。
#[tauri::command]
fn scan_folder(
    path: String,
    recursive: bool,
    extensions: Option<Vec<String>>,
) -> Result<Vec<DiskEntry>, String> {
    let root = std::path::Path::new(&path);
    if !root.exists() {
        return Err(format!("目录不存在：{path}"));
    }
    // 归一化扩展名白名单：去掉前端可能传来的前导点（如 ".epub" → "epub"），
    // 与 scan_dir 中 p.extension()（无点）比较，否则会「只返回目录、过滤掉所有文件」。
    let exts: Option<Vec<String>> = extensions.map(|v| {
        v.into_iter()
            .map(|e| e.trim_start_matches('.').to_lowercase())
            .collect()
    });
    let mut out: Vec<DiskEntry> = Vec::new();
    let mut count: usize = 0;
    scan_dir(root, recursive, &exts, &mut out, 0, &mut count);
    Ok(out)
}

/// 实际递归（带深度与总量上限保护，避免海量文件 / 符号链接环路）
fn scan_dir(
    dir: &std::path::Path,
    recursive: bool,
    exts: &Option<Vec<String>>,
    out: &mut Vec<DiskEntry>,
    depth: usize,
    count: &mut usize,
) {
    if *count > 50000 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if *count > 50000 {
            return;
        }
        let p = entry.path();
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // 跳过隐藏文件 / 目录（以 . 开头），避免系统 / 缓存目录污染
        if name.starts_with('.') {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            out.push(DiskEntry {
                path: p.to_string_lossy().to_string(),
                name,
                is_dir: true,
                size: 0,
                modified: mtime_ms(&meta),
                ext: String::new(),
            });
            *count += 1;
            if recursive && depth < 30 && !meta.file_type().is_symlink() {
                scan_dir(&p, recursive, exts, out, depth + 1, count);
            }
        } else if meta.is_file() {
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            if let Some(req) = exts {
                if !req.contains(&ext) {
                    continue;
                }
            }
            out.push(DiskEntry {
                path: p.to_string_lossy().to_string(),
                name,
                is_dir: false,
                size: meta.len() as i64,
                modified: mtime_ms(&meta),
                ext,
            });
            *count += 1;
        }
    }
}

/// 修改时间 → 毫秒时间戳
fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 读取任意文件字节（供阅读器 epub.js / pdf.js 加载，亦可作为媒体回退）。
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("读取文件失败：{e}"))
}

/* ---- 已挂载文件夹 ---- */

#[tauri::command]
fn list_mounted_folders(state: State<Mutex<Db>>, lib: String) -> Result<Vec<MountedFolderRow>, String> {
    state.lock().unwrap().list_mounted_folders(&lib).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_mounted_folder(state: State<Mutex<Db>>, folder: MountedFolderRow) -> Result<(), String> {
    state.lock().unwrap().add_mounted_folder(&folder).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_mounted_folder(state: State<Mutex<Db>>, id: String) -> Result<(), String> {
    state.lock().unwrap().remove_mounted_folder(&id).map_err(|e| e.to_string())
}

/// 重排某库下挂载文件夹的顺序（拖拽排序后用），ids 为希望的新顺序（全量）
#[tauri::command]
fn reorder_mounted_folders(state: State<Mutex<Db>>, lib: String, ids: Vec<String>) -> Result<(), String> {
    state.lock().unwrap().reorder_mounted_folders(&lib, &ids).map_err(|e| e.to_string())
}

/* ---- 书籍阅读进度 ---- */

#[tauri::command]
fn get_book_progress(state: State<Mutex<Db>>, book_path: String) -> Result<Option<BookProgressRow>, String> {
    state.lock().unwrap().get_book_progress(&book_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_book_progress(state: State<Mutex<Db>>, progress: BookProgressRow) -> Result<(), String> {
    state.lock().unwrap().set_book_progress(&progress).map_err(|e| e.to_string())
}

/* ---- 书籍批注 / 笔记 ---- */

#[tauri::command]
fn list_book_notes(state: State<Mutex<Db>>, book_path: String) -> Result<Vec<BookNoteRow>, String> {
    state.lock().unwrap().list_book_notes(&book_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_book_note(state: State<Mutex<Db>>, note: BookNoteRow) -> Result<(), String> {
    state.lock().unwrap().add_book_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_book_note(state: State<Mutex<Db>>, id: String) -> Result<(), String> {
    state.lock().unwrap().delete_book_note(&id).map_err(|e| e.to_string())
}

/// 聚合所有书籍的批注 / 笔记（全局「所有笔记」面板用）
#[tauri::command]
fn list_all_book_notes(state: State<Mutex<Db>>) -> Result<Vec<BookNoteRow>, String> {
    state.lock().unwrap().list_all_book_notes().map_err(|e| e.to_string())
}

/* ---- 媒体播放进度（记忆播放） ---- */

#[tauri::command]
fn get_media_progress(state: State<Mutex<Db>>, media_path: String) -> Result<Option<MediaProgressRow>, String> {
    state.lock().unwrap().get_media_progress(&media_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_media_progress(state: State<Mutex<Db>>, progress: MediaProgressRow) -> Result<(), String> {
    state.lock().unwrap().set_media_progress(&progress).map_err(|e| e.to_string())
}

/* ================ 通用 meta（迁移标记等） ================ */

#[tauri::command]
fn get_meta(state: State<Mutex<Db>>, key: String) -> Result<Option<String>, String> {
    state.lock().unwrap().get_meta(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_meta(state: State<Mutex<Db>>, key: String, value: String) -> Result<(), String> {
    state.lock().unwrap().set_meta(&key, &value).map_err(|e| e.to_string())
}

/// 打开数据库：优先使用「设置 → 存储」里指定的数据目录（若该目录下已有 clnote.db），
/// 否则退回默认位置。保证切换数据目录 / 更新版本后，数据依然能被正确打开，
/// 不会因重启回退到默认目录而"找不到数据"。
fn open_db() -> db::Db {
    if let Some(saved) = db::read_data_dir_pref() {
        let p = std::path::Path::new(&saved).join("clnote.db");
        if p.exists() {
            if let Ok(d) = db::Db::open_at(&p) {
                return d;
            }
        }
    }
    db::Db::open().expect("无法打开本地数据库")
}

fn main() {
    let db = open_db();
    tauri::Builder::default()
        .manage(Mutex::new(db))
        .manage(CloseBehavior(Mutex::new(true)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // 自定义媒体协议：前端用 http://media.localhost/?path=<encodeURIComponent(绝对路径)>
        // 即可让 <audio>/<video> 直接播放用户磁盘上的媒体 / 书籍文件（无需整文件读进 JS 内存）。
        .register_uri_scheme_protocol("media", |_ctx, request| {
            let query = request.uri().query().unwrap_or("");
            let path = parse_query_param(query, "path");
            match path {
                None => http::Response::builder()
                    .status(http::StatusCode::BAD_REQUEST)
                    .body(Vec::new())
                    .unwrap(),
                Some(p) => {
                    let total = match std::fs::metadata(&p) {
                        Ok(m) => m.len(),
                        Err(_) => return http::Response::builder()
                            .status(http::StatusCode::NOT_FOUND)
                            .body(Vec::new())
                            .unwrap(),
                    };
                    // 解析 Range 头：浏览器在拖动进度 / 记忆播放 seek 时会发送，
                    // 仅返回请求的字节区间（206），避免大文件整读进内存，也让 seek 真正生效。
                    let range = request
                        .headers()
                        .get("range")
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string());
                    match range {
                        Some(r) if r.starts_with("bytes=") => {
                            let spec = &r["bytes=".len()..];
                            let (a, b) = spec.split_once('-').unwrap_or(("", ""));
                            let (start, end) = if a.is_empty() {
                                let n = b.parse::<u64>().unwrap_or(0);
                                (total.saturating_sub(n), total.saturating_sub(1))
                            } else {
                                let st = a.parse::<u64>().unwrap_or(0);
                                let en = if b.is_empty() {
                                    total.saturating_sub(1)
                                } else {
                                    b.parse::<u64>()
                                        .unwrap_or(total.saturating_sub(1))
                                        .min(total.saturating_sub(1))
                                };
                                (st, en)
                            };
                            if start > end || start >= total {
                                return http::Response::builder()
                                    .status(http::StatusCode::RANGE_NOT_SATISFIABLE)
                                    .header("content-range", format!("bytes */{total}"))
                                    .body(Vec::new())
                                    .unwrap();
                            }
                            let buf = std::fs::File::open(&p).and_then(|mut f| {
                                use std::io::{Read, Seek, SeekFrom};
                                f.seek(SeekFrom::Start(start))?;
                                let len = (end - start + 1) as usize;
                                let mut buf = vec![0u8; len];
                                f.read_exact(&mut buf)?;
                                Ok(buf)
                            });
                            match buf {
                                Ok(b) => http::Response::builder()
                                    .status(http::StatusCode::PARTIAL_CONTENT)
                                    .header("content-type", mime_for(&p))
                                    .header("access-control-allow-origin", "*")
                                    .header("accept-ranges", "bytes")
                                    .header("content-range", format!("bytes {start}-{end}/{total}"))
                                    .header("content-length", b.len().to_string())
                                    .body(b)
                                    .unwrap(),
                                Err(_) => http::Response::builder()
                                    .status(http::StatusCode::INTERNAL_SERVER_ERROR)
                                    .body(Vec::new())
                                    .unwrap(),
                            }
                        }
                        _ => match std::fs::read(&p) {
                            Ok(bytes) => http::Response::builder()
                                .status(http::StatusCode::OK)
                                .header("content-type", mime_for(&p))
                                .header("access-control-allow-origin", "*")
                                .header("accept-ranges", "bytes")
                                .body(bytes)
                                .unwrap(),
                            Err(_) => http::Response::builder()
                                .status(http::StatusCode::NOT_FOUND)
                                .body(Vec::new())
                                .unwrap(),
                        },
                    }
                }
            }
        })
        .setup(|app| {
            // 便携模式：exe 同目录存在 `.portable` 时，把 WebView 的数据目录
            // （localStorage / 缓存）也放到 exe 旁边，与 db.rs 中 app_data_dir 的
            // 便携逻辑保持一致，真正做到「数据跟着 exe 走」。
            // 注意：素材库与快捷库现已存入 SQLite（clnote.db），同样遵循此数据目录。
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("clnote")
                .inner_size(1100.0, 720.0)
                .min_inner_size(800.0, 500.0)
                .disable_drag_drop_handler();
            if exe_dir.join(".portable").exists() {
                let wv = exe_dir.join("clnote-data").join("webview");
                let _ = std::fs::create_dir_all(&wv);
                builder = builder.data_directory(wv);
            }
            builder.build()?;

            // 恢复持久化的退出行为偏好（默认最小化到托盘）
            let pref = load_close_behavior(app.handle());
            if let Some(cb) = app.try_state::<CloseBehavior>() {
                *cb.0.lock().unwrap() = pref;
            }
            // 系统托盘：点 X 收进托盘，右键菜单可「显示 / 退出」
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭窗口请求：若开启了「最小化到托盘」，则拦截关闭并隐藏窗口，
            // 由托盘图标负责恢复 / 退出。未开启则正常退出。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<CloseBehavior>();
                let minimize = *state.0.lock().unwrap();
                if minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_nodes,
            get_node,
            save_node,
            delete_node,
            move_node,
            clear_all,
            put_many,
            next_order,
            search_nodes,
            get_data_dir,
            set_data_dir,
            save_file,
            set_close_behavior,
            list_foreshadowings,
            add_foreshadow,
            set_foreshadow_done,
            delete_foreshadow,
            list_assets,
            get_asset,
            save_asset,
            delete_asset,
            list_asset_categories,
            save_asset_category,
            delete_asset_category,
            put_many_assets,
            put_many_asset_categories,
            clear_all_assets,
            list_shortcuts,
            get_shortcut,
            save_shortcut,
            delete_shortcut,
            list_shortcut_categories,
            save_shortcut_category,
            delete_shortcut_category,
            put_many_shortcuts,
            put_many_shortcut_categories,
            clear_all_shortcuts,
            get_meta,
            set_meta,
            scan_folder,
            read_file_bytes,
            list_mounted_folders,
            add_mounted_folder,
            remove_mounted_folder,
            reorder_mounted_folders,
            get_book_progress,
            set_book_progress,
            list_book_notes,
            add_book_note,
            delete_book_note,
            list_all_book_notes,
            get_media_progress,
            set_media_progress
        ])
        .run(tauri::generate_context!())
        .expect("启动 clnote 失败");
}
