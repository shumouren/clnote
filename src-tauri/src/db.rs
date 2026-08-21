use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 数据库句柄（在 Tauri 中以 Mutex<Db> 形式托管为 state）
pub struct Db {
    conn: Connection,
    /// 当前数据库文件所在目录（用于 get_data_dir 展示）
    dir: String,
}

/// 是否为中日韩（CJK）字符：统一表意文字、扩展 A/B、CJK 标点及全角字符。
/// 用于中文友好的零依赖全文检索预处理。
fn is_cjk(c: char) -> bool {
    (c >= '\u{4E00}' && c <= '\u{9FFF}') // CJK 统一表意文字
        || (c >= '\u{3400}' && c <= '\u{4DBF}') // CJK 扩展 A
        || (c >= '\u{20000}' && c <= '\u{2A6DF}') // CJK 扩展 B
        || (c >= '\u{3000}' && c <= '\u{303F}') // CJK 符号和标点
        || (c >= '\u{FF00}' && c <= '\u{FFEF}') // 全角字符
}

/// 中文友好的零依赖全文检索预处理（等价于 simple 中文分词器）：
/// - 中日韩字符逐字成 token（解决 unicode61 不按词切分中文、整句被当成一个 token 的问题）
/// - ASCII 字母/数字保留为完整单词
/// - 其余字符（标点、空格、全角符号等）作为分隔符
/// 配合 FTS5 默认 unicode61 分词器即可实现中文按字/词检索，无需引入外部中文分词库。
fn simple_cn_tokenize(s: &str) -> String {
    let mut out = String::new();
    let mut ascii = String::new();
    for c in s.chars() {
        if is_cjk(c) {
            if !ascii.is_empty() {
                out.push_str(&ascii);
                ascii.clear();
            }
            out.push(c);
            out.push(' ');
        } else if c.is_ascii_alphanumeric() {
            ascii.push(c);
        } else {
            if !ascii.is_empty() {
                out.push_str(&ascii);
                ascii.clear();
            }
            out.push(' ');
        }
    }
    if !ascii.is_empty() {
        out.push_str(&ascii);
    }
    out.trim().to_string()
}

/// 与前端 FsNode 对齐的数据库行。
/// 说明：Tauri v2 只会转换「命令顶层参数名」（如 node / id / parentId），
/// 不会递归转换嵌套对象内部的字段名。因此这里用 rename_all = "camelCase"
/// 直接按前端发出的 camelCase 字段名（updatedAt / parentId / createdAt …）接收，
/// 避免嵌套字段因未被转换而反序列化失败（missing field updated_at 等）。
/// 返回时 Rust 序列化成 camelCase，前端做了 snake/camel 兼容归一化，两种都行。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsNodeRow {
    pub id: String,
    /// folder | note | mindmap（JS 字段名固定为 "type"，与 nodeType 对应）
    #[serde(rename = "type")]
    pub node_type: String,
    /// 'file' = 文本库；'creation' = 创作库。旧库经 ALTER 补列时默认 'file'。
    pub lib: String,
    /// 创作库内的子类型：'novel'(小说创作) / 'volume'(卷) / 'chapter'(章) / NULL(普通)。
    pub kind: Option<String>,
    /// 引用指针：非空表示该节点引用另一节点（用于创作库引用文本库思维导图）。
    /// 被引用节点才是内容真源；本节点只存指针，content 不单独保存。
    pub ref_id: Option<String>,
    pub name: String,
    pub parent_id: Option<String>,
    /// note: TipTap JSON 字符串；mindmap: MindMapDoc 字符串；folder: "null"
    /// 以 JSON 字符串跨 Tauri 边界，避免直接传 serde_json::Value（null/对象）在反序列化时失败。
    pub content: String,
    /// note 纯文本缓存
    pub text: String,
    pub order: i64,
    pub updated_at: i64,
    pub created_at: i64,
}

/// 侧栏列表用的精简项
#[derive(Serialize, Clone)]
pub struct FsNodeMeta {
    pub id: String,
    pub name: String,
    pub updated_at: i64,
}

/// 伏笔（标注）行：每个小说创作下所有章的伏笔集中存放
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForeshadowRow {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    /// 锚定的正文文本片段
    pub snippet: String,
    /// 0=未完成，1=完成
    pub done: i64,
    /// 备注（可选）
    pub note: String,
    pub order_idx: i64,
    pub created_at: i64,
}

/// 素材行：从前端 Asset 对齐。tags 存为 JSON 字符串，跨 Tauri 边界用数组收发。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetRow {
    pub id: String,
    /// Asset.type（'text'|'code'|'image'|'link'|'file'|'book'），用 rename 直接按 "type" 接收
    #[serde(rename = "type")]
    pub asset_type: String,
    pub title: String,
    pub content: String,
    pub url: Option<String>,
    pub image: Option<String>,
    pub file: Option<String>,
    pub file_name: Option<String>,
    pub author: Option<String>,
    pub tags: Vec<String>,
    pub type_id: String,
    pub category_id: String,
    /// 前端 Asset.order 经 camelCase 后为 orderIdx；为兼容历史/手写调用，
    /// 同时接受 `order` 别名，缺失时默认 0。
    #[serde(alias = "order", default)]
    pub order_idx: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 素材 / 快捷 共用的分类行（主题 / 文件夹，可嵌套）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetCategoryRow {
    pub id: String,
    /// 'theme' | 'folder'
    pub kind: String,
    pub name: String,
    pub icon: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    /// 前端 AssetCategory.order 经 camelCase 后为 orderIdx；为兼容历史/手写调用，
    /// 同时接受 `order` 别名，缺失时默认 0（避免命令因缺字段而整体失败）。
    #[serde(alias = "order", default)]
    pub order_idx: i64,
    /// 是否"默认主题"：标记后不可从素材库/文件树删除，避免误删核心结构。
    #[serde(default)]
    pub builtin: bool,
}

/// 快捷条目行：从前端 ShortcutItem 对齐
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRow {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub path: Option<String>,
    pub url: Option<String>,
    pub content: Option<String>,
    pub tags: Vec<String>,
    pub category_id: String,
    /// 前端 ShortcutItem.order 经 camelCase 后为 orderIdx；为兼容历史/手写调用，
    /// 同时接受 `order` 别名，缺失时默认 0。
    #[serde(alias = "order", default)]
    pub order_idx: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 把存储的 tags JSON 字符串解析为数组（失败则给空数组）
fn parse_tags(s: String) -> Vec<String> {
    serde_json::from_str(&s).unwrap_or_default()
}

/// 收集某分类的全部子孙分类 id（含自身），利用递归 CTE。table 为受控常量，非用户输入。
fn descendant_category_ids(conn: &Connection, table: &str, root: &str) -> SqlResult<Vec<String>> {
    let sql = format!(
        "WITH RECURSIVE d(id) AS (
            SELECT ?1
            UNION ALL
            SELECT c.id FROM {tbl} c JOIN d ON c.parent_id = d.id
        ) SELECT id FROM d",
        tbl = table
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![root], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 移动节点入参
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveInput {
    pub id: String,
    pub new_parent_id: Option<String>,
    pub index: i64,
}

/* ---------------- v3 新库（阅读 / 音乐 / 视频）基础设施 ---------------- */

/// 磁盘扫描返回的单条条目（scan_folder 命令用，不入库，仅在前端构建文件树）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskEntry {
    /// 绝对路径
    pub path: String,
    /// 文件名 / 目录名
    pub name: String,
    /// 是否为目录
    pub is_dir: bool,
    /// 文件大小（字节）；目录为 0
    pub size: i64,
    /// 修改时间（毫秒时间戳）
    pub modified: i64,
    /// 扩展名（小写，不含点）；目录为空
    pub ext: String,
}

/// 已挂载的用户磁盘文件夹（阅读 / 音乐 / 视频库共用）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MountedFolderRow {
    pub id: String,
    /// 'reading' | 'music' | 'video'
    pub lib: String,
    /// 用户磁盘上的绝对路径
    pub path: String,
    /// 显示名（默认取文件夹名）
    pub name: String,
    pub created_at: i64,
    /// 排序序号（拖拽排序用），越小越靠前；前端挂载时不一定会传，给默认 0，后端落库时按最大值+1 重算
    #[serde(default)]
    pub order_idx: i64,
}

/// 书籍阅读进度（epub/pdf/txt…定位用 cfi 或百分比）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookProgressRow {
    /// 书籍文件绝对路径（主键）
    pub book_path: String,
    /// 阅读器定位锚点（epub.js 的 CFI / pdf 的页码等）
    pub cfi: Option<String>,
    /// 进度百分比 0–100
    pub percent: f64,
    pub updated_at: i64,
}

/// 书籍批注 / 笔记（定位用 章节 + 锚点 + 百分比）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookNoteRow {
    pub id: String,
    pub book_path: String,
    pub book_name: String,
    pub chapter: Option<String>,
    pub anchor: Option<String>,
    pub percent: Option<f64>,
    pub text: String,
    pub created_at: i64,
}

/// 媒体（音乐 / 视频）播放进度（记忆播放用）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaProgressRow {
    /// 媒体文件绝对路径（主键）
    pub media_path: String,
    /// 已播放到的秒数
    pub position: f64,
    /// 总时长（秒）
    pub duration: f64,
    pub updated_at: i64,
}

/* ---------------- 路径工具 ---------------- */

/// 便携模式标记：若 exe 同目录存在 `.portable` 文件，则数据放到 exe 同目录的 `clnote-data`
fn is_portable() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|d| d.join(".portable").exists())
        .unwrap_or(false)
}

/// 计算应用数据目录：
/// - 便携模式（exe 同目录有 `.portable`）：返回 <exe 所在目录>/clnote-data
/// - 普通模式：返回系统目录 <OS data dir>/clnote
/// 用 std::env 直接算，避免依赖 Tauri path 权限（path API 需要 capability）。
fn app_data_dir() -> PathBuf {
    if is_portable() {
        if let Some(dir) = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        {
            return dir.join("clnote-data");
        }
    }
    let mut dir = if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Library/Application Support"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| PathBuf::from(h).join(".local/share"))
                    .unwrap_or_else(|_| PathBuf::from("."))
            })
    };
    dir.push("clnote");
    dir
}

/// 数据库文件完整路径（在给定目录下）
fn db_path_in(dir: &std::path::Path) -> PathBuf {
    dir.join("clnote.db")
}

/// 数据目录偏好文件（与具体数据 db 解耦，保证任何数据位置下重启都能读回用户指定的文件夹）。
/// 注意：不能只存进 clnote.db 的 meta——因为一旦切换了数据目录，那个 db 就不在默认位置了，
/// 启动时若先开默认 db 反而读不到偏好。故单独用一个纯文本文件记录。
fn data_dir_pref_file() -> PathBuf {
    app_data_dir().join("data_dir.txt")
}

/// 读取用户曾在「设置 → 存储」里指定的数据目录（若存在且非空）
pub fn read_data_dir_pref() -> Option<String> {
    std::fs::read_to_string(data_dir_pref_file())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 持久化用户指定的数据目录（写入独立于数据 db 的偏好文件，重启 / 更新版本后由 open_db 读取）
pub fn write_data_dir_pref(path: &str) {
    let _ = std::fs::create_dir_all(app_data_dir());
    let _ = std::fs::write(data_dir_pref_file(), path);
}

/// 改名前的旧数据目录：<OS data dir>/ccc-notes（用于一次性迁移）
fn old_app_data_dir() -> PathBuf {
    let mut dir = if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Library/Application Support"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| PathBuf::from(h).join(".local/share"))
                    .unwrap_or_else(|_| PathBuf::from("."))
            })
    };
    dir.push("ccc-notes");
    dir
}

/* ---------------- 打开 / 建表 ---------------- */

impl Db {
    /// 在应用数据目录打开（默认位置）
    pub fn open() -> SqlResult<Db> {
        let dir = app_data_dir();
        // 兼容改名前：若新目录还不存在，但旧的 ccc-notes 目录存在，则整体迁移过去，
        // 保证「改了软件名字也不会丢数据」。
        if !dir.exists() {
            let old = old_app_data_dir();
            if old.exists() {
                let _ = std::fs::create_dir_all(dir.parent().unwrap_or(&dir));
                let _ = std::fs::rename(&old, &dir);
            }
        }
        let _ = std::fs::create_dir_all(&dir);
        Db::open_at(&db_path_in(&dir))
    }

    /// 在指定文件打开（用于 set_data_dir 改位置）
    pub fn open_at(path: &std::path::Path) -> SqlResult<Db> {
        let dir = path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS notes (
                id         TEXT PRIMARY KEY,
                type       TEXT NOT NULL,
                name       TEXT NOT NULL,
                parent_id  TEXT,
                content    TEXT NOT NULL,
                text       TEXT NOT NULL DEFAULT '',
                order_idx  INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes(parent_id);
             CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

             -- FTS5 全文检索：底层 unicode61 仅做基础切分；写入/查询时由 simple_cn_tokenize
             -- 对中文逐字成 token、ASCII 词保留，从而实现中文按词检索（免外部分词库）。
             CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                note_id UNINDEXED,
                name,
                text,
                tokenize = 'unicode61'
             );

             CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );",
        )?;
        // 创作库：给 notes 增加 lib 列（'file'=文本库, 'creation'=创作库），旧库自动补列
        let has_lib: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'lib'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if has_lib == 0 {
            conn.execute(
                "ALTER TABLE notes ADD COLUMN lib TEXT NOT NULL DEFAULT 'file'",
                [],
            )?;
        }
        // 创作库子类型：给 notes 增加 kind 列（'novel'/'volume'/'chapter'/NULL），旧库自动补列
        let has_kind: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'kind'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if has_kind == 0 {
            conn.execute("ALTER TABLE notes ADD COLUMN kind TEXT", [])?;
        }
        // 引用指针：给 notes 增加 ref_id 列（非空表示该节点引用另一节点），旧库自动补列
        let has_ref: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'ref_id'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if has_ref == 0 {
            conn.execute("ALTER TABLE notes ADD COLUMN ref_id TEXT", [])?;
        }

        // 伏笔（标注）表：每个小说创作下所有章的伏笔集中存于此，便于"伏笔栏"聚合展示
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS foreshadows (
                id          TEXT PRIMARY KEY,
                novel_id    TEXT NOT NULL,
                chapter_id  TEXT NOT NULL,
                snippet     TEXT NOT NULL DEFAULT '',
                done        INTEGER NOT NULL DEFAULT 0,
                note        TEXT NOT NULL DEFAULT '',
                order_idx   INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_foreshadow_novel ON foreshadows(novel_id);
             CREATE INDEX IF NOT EXISTS idx_foreshadow_chapter ON foreshadows(chapter_id);

             -- 素材库：与文件树解耦，单独存储，换版本也不丢
             CREATE TABLE IF NOT EXISTS assets (
                id          TEXT PRIMARY KEY,
                type        TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                content     TEXT NOT NULL DEFAULT '',
                url         TEXT,
                image       TEXT,
                file        TEXT,
                file_name   TEXT,
                author      TEXT,
                tags        TEXT NOT NULL DEFAULT '[]',
                type_id     TEXT NOT NULL DEFAULT '',
                category_id TEXT NOT NULL DEFAULT '',
                order_idx   INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_assets_cat ON assets(category_id);

             CREATE TABLE IF NOT EXISTS asset_categories (
                id          TEXT PRIMARY KEY,
                kind        TEXT NOT NULL,
                name        TEXT NOT NULL DEFAULT '',
                icon        TEXT NOT NULL DEFAULT '',
                parent_id   TEXT,
                order_idx   INTEGER NOT NULL DEFAULT 0,
                builtin     INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_assetcat_parent ON asset_categories(parent_id);

             -- 快捷库：与素材库完全独立
             CREATE TABLE IF NOT EXISTS shortcuts (
                id          TEXT PRIMARY KEY,
                kind        TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                path        TEXT,
                url         TEXT,
                content     TEXT,
                tags        TEXT NOT NULL DEFAULT '[]',
                category_id TEXT NOT NULL DEFAULT '',
                order_idx   INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_shortcuts_cat ON shortcuts(category_id);

             CREATE TABLE IF NOT EXISTS shortcut_categories (
                id          TEXT PRIMARY KEY,
                kind        TEXT NOT NULL,
                name        TEXT NOT NULL DEFAULT '',
                icon        TEXT NOT NULL DEFAULT '',
                parent_id   TEXT,
                order_idx   INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_scat_parent ON shortcut_categories(parent_id);

             -- v3 新库（阅读 / 音乐 / 视频）基础设施表。
             -- 注意：书籍 / 媒体文件本体存于用户磁盘，这里只存「挂载路径 + 进度 + 笔记」。
             CREATE TABLE IF NOT EXISTS mounted_folders (
                id          TEXT PRIMARY KEY,
                lib         TEXT NOT NULL,
                path        TEXT NOT NULL,
                name        TEXT NOT NULL DEFAULT '',
                created_at  INTEGER NOT NULL,
                order_idx   INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_mf_lib ON mounted_folders(lib);

             CREATE TABLE IF NOT EXISTS book_progress (
                book_path   TEXT PRIMARY KEY,
                cfi         TEXT,
                percent     REAL NOT NULL DEFAULT 0,
                updated_at  INTEGER NOT NULL
             );

             CREATE TABLE IF NOT EXISTS book_notes (
                id          TEXT PRIMARY KEY,
                book_path   TEXT NOT NULL,
                book_name   TEXT NOT NULL DEFAULT '',
                chapter     TEXT,
                anchor      TEXT,
                percent     REAL,
                text        TEXT NOT NULL DEFAULT '',
                created_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_booknotes_book ON book_notes(book_path);

             CREATE TABLE IF NOT EXISTS media_progress (
                media_path  TEXT PRIMARY KEY,
                position    REAL NOT NULL DEFAULT 0,
                duration    REAL NOT NULL DEFAULT 0,
                updated_at  INTEGER NOT NULL
             );",
        )?;

        // 一次性迁移：用新中文分词重建 FTS 索引。
        // 旧库 notes_fts 存的是未预处理的原始文本，中文被 unicode61 当成整句 token，
        // 无法按词检索；重建后存量笔记也能按中文检索。靠 meta 标记保证只跑一次。
        let fts_rebuilt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM meta WHERE key = 'fts_cn_rebuild'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if fts_rebuilt == 0 {
            conn.execute("DELETE FROM notes_fts", [])?;
            let mut sel = conn.prepare("SELECT id, name, text FROM notes WHERE type <> 'folder'")?;
            let rows = sel.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            let mut ins =
                conn.prepare("INSERT INTO notes_fts (note_id, name, text) VALUES (?1, ?2, ?3)")?;
            for r in rows {
                let (id, name, text) = r?;
                ins.execute(params![
                    id,
                    simple_cn_tokenize(&name),
                    simple_cn_tokenize(&text)
                ])?;
            }
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('fts_cn_rebuild', '1')",
                [],
            )?;
        }

        // 一次性迁移：素材类型收敛为 文本 / 文件 / 其他 三类。
        // - book（旧「文件」）统一为 file；
        // - code / image / link 以及任何非三类的自定义类型，统一归入 other；
        // 内容（content / file / url 等）原样保留，仅改类型标记。靠 meta 标记保证只跑一次。
        let at_conv: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM meta WHERE key = 'asset_type_converge_v1'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if at_conv == 0 {
            conn.execute(
                "UPDATE assets SET type='file', type_id='file' WHERE type_id='book' OR type='book'",
                [],
            )?;
            conn.execute(
                "UPDATE assets SET type='other', type_id='other' WHERE type_id IN ('code','image','link') OR type IN ('code','image','link')",
                [],
            )?;
            conn.execute(
                "UPDATE assets SET type='other', type_id='other' WHERE type_id != '' AND type_id NOT IN ('text','file','other')",
                [],
            )?;
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('asset_type_converge_v1', '1')",
                [],
            )?;
        }

        // 一次性迁移：asset_categories 增加 builtin 列（用于保护"默认主题"不被误删）。
        // 用 pragma 探测列是否存在，已存在则跳过，保证可重复执行、旧库升级不报错。
        let has_builtin: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('asset_categories') WHERE name='builtin'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if has_builtin == 0 {
            conn.execute(
                "ALTER TABLE asset_categories ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }

        // 若之前存过 data_dir 偏好，读取它以决定展示路径（DB 本体位置由调用方决定）
        Ok(Db {
            conn,
            dir,
        })
    }

    pub fn data_dir(&self) -> &str {
        &self.dir
    }

    /* ---------------- 文件树 CRUD（镜像前端 fs.ts） ---------------- */

    pub fn list_nodes(&self) -> SqlResult<Vec<FsNodeRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, name, parent_id, content, text, order_idx, updated_at, created_at, lib, kind, ref_id
             FROM notes",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(FsNodeRow {
                id: row.get(0)?,
                node_type: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                content: row.get(4)?,
                text: row.get(5)?,
                order: row.get(6)?,
                updated_at: row.get(7)?,
                created_at: row.get(8)?,
                lib: row.get(9)?,
                kind: row.get(10)?,
                ref_id: row.get(11)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_node(&self, id: &str) -> SqlResult<Option<FsNodeRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, name, parent_id, content, text, order_idx, updated_at, created_at, lib, kind, ref_id
             FROM notes WHERE id = ?",
        )?;
        let note = stmt.query_row(params![id], |row| {
            Ok(FsNodeRow {
                id: row.get(0)?,
                node_type: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                content: row.get(4)?,
                text: row.get(5)?,
                order: row.get(6)?,
                updated_at: row.get(7)?,
                created_at: row.get(8)?,
                lib: row.get(9)?,
                kind: row.get(10)?,
                ref_id: row.get(11)?,
            })
        })?;
        Ok(Some(note))
    }

    /// upsert 单个节点；同时维护 FTS 行
    pub fn save_node(&self, n: &FsNodeRow) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM notes_fts WHERE note_id = ?", params![n.id])?;
        self.conn.execute(
            "INSERT INTO notes (id, type, name, parent_id, content, text, order_idx, updated_at, created_at, lib, kind, ref_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
               type=excluded.type,
               name=excluded.name,
               parent_id=excluded.parent_id,
               content=excluded.content,
               text=excluded.text,
               order_idx=excluded.order_idx,
               updated_at=excluded.updated_at,
               created_at=excluded.created_at,
               lib=excluded.lib,
               kind=excluded.kind,
               ref_id=excluded.ref_id",
            params![
                n.id,
                n.node_type,
                n.name,
                n.parent_id,
                n.content,
                n.text,
                n.order,
                n.updated_at,
                n.created_at,
                n.lib,
                n.kind,
                n.ref_id
            ],
        )?;
        self.conn.execute(
            "INSERT INTO notes_fts (note_id, name, text) VALUES (?1, ?2, ?3)",
            params![n.id, simple_cn_tokenize(&n.name), simple_cn_tokenize(&n.text)],
        )?;
        Ok(())
    }

    /// 递归删除节点及其全部后代（参数化，避免 SQL 注入）
    pub fn delete_node(&mut self, id: &str) -> SqlResult<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM notes_fts WHERE note_id IN (
                WITH RECURSIVE d(id) AS (
                    SELECT ?1
                    UNION ALL
                    SELECT n.id FROM notes n JOIN d ON n.parent_id = d.id
                )
                SELECT id FROM d
            )",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM notes WHERE id IN (
                WITH RECURSIVE d(id) AS (
                    SELECT ?1
                    UNION ALL
                    SELECT n.id FROM notes n JOIN d ON n.parent_id = d.id
                )
                SELECT id FROM d
            )",
            params![id],
        )?;
        // 级联删除这些章节下的伏笔，避免孤儿数据
        tx.execute(
            "DELETE FROM foreshadows WHERE chapter_id IN (
                WITH RECURSIVE d(id) AS (
                    SELECT ?1
                    UNION ALL
                    SELECT n.id FROM notes n JOIN d ON n.parent_id = d.id
                )
                SELECT id FROM d
            )",
            params![id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// 移动节点到 new_parent_id 下的 index 位置，并重排同级 order
    pub fn move_node(&mut self, input: &MoveInput) -> SqlResult<()> {
        let all = self.list_nodes()?;
        let node = match all.iter().find(|n| n.id == input.id) {
            Some(n) => n,
            None => return Ok(()),
        };

        // 禁止把文件夹移动到自己的后代里
        if let Some(pid) = &input.new_parent_id {
            let mut p: Option<String> = Some(pid.clone());
            while let Some(cur) = p {
                if cur == input.id {
                    return Ok(()); // 非法移动，忽略
                }
                p = all.iter().find(|n| n.id == cur).and_then(|x| x.parent_id.clone());
            }
        }

        let mut siblings: Vec<&FsNodeRow> = all
            .iter()
            .filter(|n| n.parent_id == input.new_parent_id && n.id != input.id)
            .collect();
        siblings.sort_by_key(|n| n.order);

        let idx = if input.index < 0 {
            siblings.len()
        } else {
            (input.index as usize).min(siblings.len())
        };

        let mut reordered: Vec<FsNodeRow> = Vec::with_capacity(siblings.len() + 1);
        for (i, s) in siblings.iter().enumerate() {
            if i == idx {
                let mut moved = node.clone();
                moved.parent_id = input.new_parent_id.clone();
                moved.order = i as i64;
                reordered.push(moved);
            }
            let mut sib = (*s).clone();
            sib.order = reordered.len() as i64;
            reordered.push(sib);
        }
        if idx >= siblings.len() {
            let mut moved = node.clone();
            moved.parent_id = input.new_parent_id.clone();
            moved.order = reordered.len() as i64;
            reordered.push(moved);
        }

        let tx = self.conn.transaction()?;
        for n in &reordered {
            tx.execute(
                "UPDATE notes SET parent_id = ?1, order_idx = ?2 WHERE id = ?3",
                params![n.parent_id, n.order, n.id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn clear_all(&self) -> SqlResult<()> {
        self.conn.execute_batch(
            "DELETE FROM notes_fts; DELETE FROM notes;",
        )?;
        Ok(())
    }

    pub fn put_many(&mut self, nodes: &[FsNodeRow]) -> SqlResult<()> {
        let tx = self.conn.transaction()?;
        for n in nodes {
            tx.execute(
                "INSERT OR REPLACE INTO notes (id, type, name, parent_id, content, text, order_idx, updated_at, created_at, lib, kind)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    n.id, n.node_type, n.name, n.parent_id, n.content, n.text, n.order, n.updated_at, n.created_at, n.lib, n.kind
                ],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO notes_fts (note_id, name, text) VALUES (?1, ?2, ?3)",
                params![n.id, simple_cn_tokenize(&n.name), simple_cn_tokenize(&n.text)],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn next_order(&self, parent_id: Option<String>) -> SqlResult<i64> {
        let max: Option<i64> = match &parent_id {
            Some(pid) => self.conn.query_row(
                "SELECT MAX(order_idx) FROM notes WHERE parent_id = ?",
                params![pid],
                |row| row.get(0),
            )?,
            None => self.conn.query_row(
                "SELECT MAX(order_idx) FROM notes WHERE parent_id IS NULL",
                [],
                |row| row.get(0),
            )?,
        };
        Ok(max.unwrap_or(-1) + 1)
    }

    /* ---------------- 伏笔（标注） ---------------- */

    pub fn list_foreshadowings(&self, novel_id: &str) -> SqlResult<Vec<ForeshadowRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, novel_id, chapter_id, snippet, done, note, order_idx, created_at
             FROM foreshadows WHERE novel_id = ? ORDER BY order_idx ASC, created_at ASC",
        )?;
        let rows = stmt.query_map(params![novel_id], |row| {
            Ok(ForeshadowRow {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                chapter_id: row.get(2)?,
                snippet: row.get(3)?,
                done: row.get(4)?,
                note: row.get(5)?,
                order_idx: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_foreshadow(&self, f: &ForeshadowRow) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO foreshadows (id, novel_id, chapter_id, snippet, done, note, order_idx, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               snippet=excluded.snippet,
               done=excluded.done,
               note=excluded.note",
            params![
                f.id, f.novel_id, f.chapter_id, f.snippet, f.done, f.note, f.order_idx, f.created_at
            ],
        )?;
        Ok(())
    }

    pub fn set_foreshadow_done(&self, id: &str, done: i64) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE foreshadows SET done = ?2 WHERE id = ?1",
            params![id, done],
        )?;
        Ok(())
    }

    pub fn delete_foreshadow(&self, id: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM foreshadows WHERE id = ?", params![id])?;
        Ok(())
    }

    /* ---------------- 素材库（SQLite 持久化） ---------------- */

    pub fn list_assets(&self) -> SqlResult<Vec<AssetRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, title, content, url, image, file, file_name, author, tags,
                    type_id, category_id, order_idx, created_at, updated_at
             FROM assets ORDER BY order_idx ASC, updated_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AssetRow {
                id: row.get(0)?,
                asset_type: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                url: row.get(4)?,
                image: row.get(5)?,
                file: row.get(6)?,
                file_name: row.get(7)?,
                author: row.get(8)?,
                tags: parse_tags(row.get(9)?),
                type_id: row.get(10)?,
                category_id: row.get(11)?,
                order_idx: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_asset(&self, id: &str) -> SqlResult<Option<AssetRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, title, content, url, image, file, file_name, author, tags,
                    type_id, category_id, order_idx, created_at, updated_at
             FROM assets WHERE id = ?",
        )?;
        let r = stmt.query_row(params![id], |row| {
            Ok(AssetRow {
                id: row.get(0)?,
                asset_type: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                url: row.get(4)?,
                image: row.get(5)?,
                file: row.get(6)?,
                file_name: row.get(7)?,
                author: row.get(8)?,
                tags: parse_tags(row.get(9)?),
                type_id: row.get(10)?,
                category_id: row.get(11)?,
                order_idx: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        });
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn upsert_asset(&self, a: &AssetRow) -> SqlResult<()> {
        let tags = serde_json::to_string(&a.tags).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            "INSERT INTO assets (id, type, title, content, url, image, file, file_name, author, tags, type_id, category_id, order_idx, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
             ON CONFLICT(id) DO UPDATE SET
               type=excluded.type, title=excluded.title, content=excluded.content,
               url=excluded.url, image=excluded.image, file=excluded.file,
               file_name=excluded.file_name, author=excluded.author, tags=excluded.tags,
               type_id=excluded.type_id, category_id=excluded.category_id,
               order_idx=excluded.order_idx, updated_at=excluded.updated_at",
            params![
                a.id, a.asset_type, a.title, a.content, a.url, a.image, a.file, a.file_name,
                a.author, tags, a.type_id, a.category_id, a.order_idx, a.created_at, a.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn save_asset(&self, a: &AssetRow) -> SqlResult<()> {
        self.upsert_asset(a)
    }

    pub fn delete_asset(&self, id: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM assets WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn put_many_assets(&mut self, list: &[AssetRow]) -> SqlResult<()> {
        let tx = self.conn.transaction()?;
        for a in list {
            let tags = serde_json::to_string(&a.tags).unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                "INSERT INTO assets (id, type, title, content, url, image, file, file_name, author, tags, type_id, category_id, order_idx, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
                 ON CONFLICT(id) DO UPDATE SET
                   type=excluded.type, title=excluded.title, content=excluded.content,
                   url=excluded.url, image=excluded.image, file=excluded.file,
                   file_name=excluded.file_name, author=excluded.author, tags=excluded.tags,
                   type_id=excluded.type_id, category_id=excluded.category_id,
                   order_idx=excluded.order_idx, updated_at=excluded.updated_at",
                params![
                    a.id, a.asset_type, a.title, a.content, a.url, a.image, a.file, a.file_name,
                    a.author, tags, a.type_id, a.category_id, a.order_idx, a.created_at, a.updated_at
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn clear_all_assets(&self) -> SqlResult<()> {
        self.conn
            .execute_batch("DELETE FROM assets; DELETE FROM asset_categories;")?;
        Ok(())
    }

    /* ---------------- 素材分类（主题 / 文件夹，可嵌套） ---------------- */

    pub fn list_asset_categories(&self) -> SqlResult<Vec<AssetCategoryRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, name, icon, parent_id, order_idx, builtin FROM asset_categories
             ORDER BY order_idx ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AssetCategoryRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                icon: row.get(3)?,
                parent_id: row.get(4)?,
                order_idx: row.get(5)?,
                builtin: row.get(6)?,
            })
        })?;
        rows.collect()
    }

    pub fn save_asset_category(&self, c: &AssetCategoryRow) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO asset_categories (id, kind, name, icon, parent_id, order_idx, builtin)
             VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(id) DO UPDATE SET
               kind=excluded.kind, name=excluded.name, icon=excluded.icon,
               parent_id=excluded.parent_id, order_idx=excluded.order_idx, builtin=excluded.builtin",
            params![c.id, c.kind, c.name, c.icon, c.parent_id, c.order_idx, c.builtin],
        )?;
        Ok(())
    }

    pub fn put_many_asset_categories(&mut self, list: &[AssetCategoryRow]) -> SqlResult<()> {
        let tx = self.conn.transaction()?;
        for c in list {
            tx.execute(
                "INSERT INTO asset_categories (id, kind, name, icon, parent_id, order_idx, builtin)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(id) DO UPDATE SET
                   kind=excluded.kind, name=excluded.name, icon=excluded.icon,
                   parent_id=excluded.parent_id, order_idx=excluded.order_idx, builtin=excluded.builtin",
                params![c.id, c.kind, c.name, c.icon, c.parent_id, c.order_idx, c.builtin],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// 级联删除分类：连同全部子孙分类，以及这些分类下的所有素材一起删除
    pub fn delete_asset_category(&mut self, id: &str) -> SqlResult<()> {
        let ids = descendant_category_ids(&self.conn, "asset_categories", id)?;
        let tx = self.conn.transaction()?;
        for cid in &ids {
            tx.execute("DELETE FROM asset_categories WHERE id = ?", params![cid])?;
            tx.execute("DELETE FROM assets WHERE category_id = ?", params![cid])?;
        }
        tx.commit()?;
        Ok(())
    }

    /* ---------------- 快捷库（SQLite 持久化） ---------------- */

    pub fn list_shortcuts(&self) -> SqlResult<Vec<ShortcutRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, title, path, url, content, tags, category_id, order_idx, created_at, updated_at
             FROM shortcuts ORDER BY order_idx ASC, updated_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ShortcutRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                path: row.get(3)?,
                url: row.get(4)?,
                content: row.get(5)?,
                tags: parse_tags(row.get(6)?),
                category_id: row.get(7)?,
                order_idx: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_shortcut(&self, id: &str) -> SqlResult<Option<ShortcutRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, title, path, url, content, tags, category_id, order_idx, created_at, updated_at
             FROM shortcuts WHERE id = ?",
        )?;
        let r = stmt.query_row(params![id], |row| {
            Ok(ShortcutRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                path: row.get(3)?,
                url: row.get(4)?,
                content: row.get(5)?,
                tags: parse_tags(row.get(6)?),
                category_id: row.get(7)?,
                order_idx: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        });
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn put_many_shortcuts(&mut self, list: &[ShortcutRow]) -> SqlResult<()> {
        let tx = self.conn.transaction()?;
        for s in list {
            let tags = serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                "INSERT INTO shortcuts (id, kind, title, path, url, content, tags, category_id, order_idx, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
                 ON CONFLICT(id) DO UPDATE SET
                   kind=excluded.kind, title=excluded.title, path=excluded.path, url=excluded.url,
                   content=excluded.content, tags=excluded.tags, category_id=excluded.category_id,
                   order_idx=excluded.order_idx, updated_at=excluded.updated_at",
                params![
                    s.id, s.kind, s.title, s.path, s.url, s.content, tags, s.category_id,
                    s.order_idx, s.created_at, s.updated_at
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn save_shortcut(&self, s: &ShortcutRow) -> SqlResult<()> {
        let tags = serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            "INSERT INTO shortcuts (id, kind, title, path, url, content, tags, category_id, order_idx, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(id) DO UPDATE SET
               kind=excluded.kind, title=excluded.title, path=excluded.path, url=excluded.url,
               content=excluded.content, tags=excluded.tags, category_id=excluded.category_id,
               order_idx=excluded.order_idx, updated_at=excluded.updated_at",
            params![
                s.id, s.kind, s.title, s.path, s.url, s.content, tags, s.category_id,
                s.order_idx, s.created_at, s.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_shortcut(&self, id: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM shortcuts WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn clear_all_shortcuts(&self) -> SqlResult<()> {
        self.conn
            .execute_batch("DELETE FROM shortcuts; DELETE FROM shortcut_categories;")?;
        Ok(())
    }

    /* ---------------- 快捷分类（主题 / 文件夹，可嵌套） ---------------- */

    pub fn list_shortcut_categories(&self) -> SqlResult<Vec<AssetCategoryRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, name, icon, parent_id, order_idx FROM shortcut_categories
             ORDER BY order_idx ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AssetCategoryRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                icon: row.get(3)?,
                parent_id: row.get(4)?,
                order_idx: row.get(5)?,
                // 快捷分类表 shortcut_categories 无 builtin 列；快捷分类不参与\"默认主题不可删\"保护
                builtin: false,
            })
        })?;
        rows.collect()
    }

    pub fn save_shortcut_category(&self, c: &AssetCategoryRow) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO shortcut_categories (id, kind, name, icon, parent_id, order_idx)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(id) DO UPDATE SET
               kind=excluded.kind, name=excluded.name, icon=excluded.icon,
               parent_id=excluded.parent_id, order_idx=excluded.order_idx",
            params![c.id, c.kind, c.name, c.icon, c.parent_id, c.order_idx],
        )?;
        Ok(())
    }

    pub fn put_many_shortcut_categories(&mut self, list: &[AssetCategoryRow]) -> SqlResult<()> {
        let tx = self.conn.transaction()?;
        for c in list {
            tx.execute(
                "INSERT INTO shortcut_categories (id, kind, name, icon, parent_id, order_idx)
                 VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(id) DO UPDATE SET
                   kind=excluded.kind, name=excluded.name, icon=excluded.icon,
                   parent_id=excluded.parent_id, order_idx=excluded.order_idx",
                params![c.id, c.kind, c.name, c.icon, c.parent_id, c.order_idx],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// 级联删除快捷分类：连同全部子孙分类，以及这些分类下的所有快捷条目一起删除
    pub fn delete_shortcut_category(&mut self, id: &str) -> SqlResult<()> {
        let ids = descendant_category_ids(&self.conn, "shortcut_categories", id)?;
        let tx = self.conn.transaction()?;
        for cid in &ids {
            tx.execute("DELETE FROM shortcut_categories WHERE id = ?", params![cid])?;
            tx.execute("DELETE FROM shortcuts WHERE category_id = ?", params![cid])?;
        }
        tx.commit()?;
        Ok(())
    }

    /* ---------------- 通用 meta（迁移标记等） ---------------- */

    pub fn get_meta(&self, key: &str) -> SqlResult<Option<String>> {
        let r: Result<Option<String>, rusqlite::Error> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key = ?", params![key], |row| {
                row.get(0)
            });
        match r {
            Ok(v) => Ok(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_meta(&self, key: &str, value: &str) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /* ---------------- 搜索（侧栏 / 命令面板用） ---------------- */

    pub fn search(&self, q: &str) -> SqlResult<Vec<FsNodeMeta>> {
        let tokenized = simple_cn_tokenize(q);
        let like = format!("%{}%", q);
        if tokenized.is_empty() {
            // 查询串不含可索引 token（纯标点等）：退化为 LIKE 子串匹配
            let mut stmt = self.conn.prepare(
                "SELECT n.id, n.name, n.updated_at FROM notes n
                 WHERE n.type <> 'folder'
                   AND (n.name LIKE ?1 OR n.text LIKE ?1)
                 ORDER BY n.updated_at DESC
                 LIMIT 50",
            )?;
            let rows = stmt.query_map(params![like], |row| {
                Ok(FsNodeMeta {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            })?;
            return rows.collect();
        }
        // 中文按字/词检索：把查询串预处理成 token 短语（FTS5 短语要求 token 连续出现，
        // 避免 "小明说" 被 "小说" 误命中）。双引号内的双引号转义为 ""。
        let fts_q = format!("\"{}\"", tokenized.replace('"', "\"\""));
        let mut stmt = self.conn.prepare(
            "SELECT n.id, n.name, n.updated_at FROM notes n
             WHERE n.type <> 'folder'
               AND (n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?1)
                    OR n.name LIKE ?2 OR n.text LIKE ?2)
             ORDER BY n.updated_at DESC
             LIMIT 50",
        )?;
        let rows = stmt.query_map(params![fts_q, like], |row| {
            Ok(FsNodeMeta {
                id: row.get(0)?,
                name: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    /* ---------------- 数据目录偏好 ---------------- */

    #[allow(dead_code)]
    pub fn get_saved_data_dir(&self) -> SqlResult<Option<String>> {
        let r: Result<Option<String>, rusqlite::Error> = self.conn.query_row(
            "SELECT value FROM meta WHERE key = 'data_dir'",
            [],
            |row| row.get(0),
        );
        match r {
            Ok(v) => Ok(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_saved_data_dir(&self, path: &str) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES ('data_dir', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![path],
        )?;
        Ok(())
    }
}

/// 供 main.rs 在 set_data_dir 时重建数据库句柄
impl Db {
    /// 把现有数据迁移到新目录下的数据库文件，并返回新 Db
    pub fn migrate_to(&self, dir: &std::path::Path) -> SqlResult<Db> {
        let _ = std::fs::create_dir_all(dir);
        let new_path = db_path_in(dir);
        let all = self.list_nodes()?;
        let mut new_db = Db::open_at(&new_path)?;
        new_db.put_many(&all)?;
        Ok(new_db)
    }
}

/* ---------------- v3 新库（阅读 / 音乐 / 视频）基础设施 ---------------- */

impl Db {
    /* ---- 已挂载文件夹 ---- */

    pub fn list_mounted_folders(&self, lib: &str) -> SqlResult<Vec<MountedFolderRow>> {
        // 合并后的「媒体库」(lib='media') 需兼容旧版的 阅读/音乐/视频 三库挂载记录，
        // 避免老用户升级后已挂载的文件夹「消失」。
        let sql: &str = if lib == "media" {
            "SELECT id, lib, path, name, created_at, order_idx FROM mounted_folders \
             WHERE lib = 'media' OR lib IN ('reading','music','video') \
             ORDER BY order_idx ASC, created_at ASC"
        } else {
            "SELECT id, lib, path, name, created_at, order_idx FROM mounted_folders WHERE lib = ? ORDER BY order_idx ASC, created_at ASC"
        };
        let mut stmt = self.conn.prepare(sql)?;
        // media 分支的 SQL 已写死 'media'，无需参数；其余分支带一个 ? 占位符。
        // 不能统一传 params![lib]，否则 media 分支会报
        // "Wrong number of parameters passed to query. Got 1, needed 0"。
        let params: &[&dyn rusqlite::ToSql] = if lib == "media" { &[] } else { &[&lib] };
        let rows = stmt.query_map(params, |row| {
            Ok(MountedFolderRow {
                id: row.get(0)?,
                lib: row.get(1)?,
                path: row.get(2)?,
                name: row.get(3)?,
                created_at: row.get(4)?,
                order_idx: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_mounted_folder(&self, f: &MountedFolderRow) -> SqlResult<()> {
        // 新挂载点排在末尾：order_idx = 当前最大 + 1
        let max_order: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(order_idx), -1) FROM mounted_folders WHERE lib = ?",
                params![f.lib],
                |row| row.get(0),
            )
            .unwrap_or(-1);
        self.conn.execute(
            "INSERT INTO mounted_folders (id, lib, path, name, created_at, order_idx)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET lib=excluded.lib, path=excluded.path, name=excluded.name, order_idx=excluded.order_idx",
            params![f.id, f.lib, f.path, f.name, f.created_at, max_order + 1],
        )?;
        Ok(())
    }

    /// 重排某库下挂载文件夹的顺序（拖拽排序后用），ids 为希望的新顺序（全量）
    /// 注意：id 为主键，直接用 id 定位即可，无需再按 lib 过滤（合并后的「媒体库」下
    /// 既可能有 lib='media' 的新挂载，也可能有 lib='reading/music/video' 的旧挂载）。
    pub fn reorder_mounted_folders(&mut self, _lib: &str, ids: &[String]) -> SqlResult<()> {
        let tx = self.conn.transaction()?;
        for (idx, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE mounted_folders SET order_idx = ?1 WHERE id = ?2",
                params![idx as i64, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_mounted_folder(&self, id: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM mounted_folders WHERE id = ?", params![id])?;
        Ok(())
    }

    /* ---- 书籍阅读进度 ---- */

    pub fn get_book_progress(&self, book_path: &str) -> SqlResult<Option<BookProgressRow>> {
        let r = self.conn.query_row(
            "SELECT book_path, cfi, percent, updated_at FROM book_progress WHERE book_path = ?",
            params![book_path],
            |row| {
                Ok(BookProgressRow {
                    book_path: row.get(0)?,
                    cfi: row.get(1)?,
                    percent: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        );
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_book_progress(&self, p: &BookProgressRow) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO book_progress (book_path, cfi, percent, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(book_path) DO UPDATE SET cfi=excluded.cfi, percent=excluded.percent, updated_at=excluded.updated_at",
            params![p.book_path, p.cfi, p.percent, p.updated_at],
        )?;
        Ok(())
    }

    /* ---- 书籍批注 / 笔记 ---- */

    pub fn list_book_notes(&self, book_path: &str) -> SqlResult<Vec<BookNoteRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, book_path, book_name, chapter, anchor, percent, text, created_at
             FROM book_notes WHERE book_path = ? ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![book_path], |row| {
            Ok(BookNoteRow {
                id: row.get(0)?,
                book_path: row.get(1)?,
                book_name: row.get(2)?,
                chapter: row.get(3)?,
                anchor: row.get(4)?,
                percent: row.get(5)?,
                text: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_book_note(&self, n: &BookNoteRow) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO book_notes (id, book_path, book_name, chapter, anchor, percent, text, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET chapter=excluded.chapter, anchor=excluded.anchor, percent=excluded.percent, text=excluded.text",
            params![n.id, n.book_path, n.book_name, n.chapter, n.anchor, n.percent, n.text, n.created_at],
        )?;
        Ok(())
    }

    pub fn delete_book_note(&self, id: &str) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM book_notes WHERE id = ?", params![id])?;
        Ok(())
    }

    /// 聚合所有书籍的批注 / 笔记（供全局「所有笔记」面板展示）
    pub fn list_all_book_notes(&self) -> SqlResult<Vec<BookNoteRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, book_path, book_name, chapter, anchor, percent, text, created_at
             FROM book_notes ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BookNoteRow {
                id: row.get(0)?,
                book_path: row.get(1)?,
                book_name: row.get(2)?,
                chapter: row.get(3)?,
                anchor: row.get(4)?,
                percent: row.get(5)?,
                text: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    /* ---- 媒体播放进度（记忆播放） ---- */

    pub fn get_media_progress(&self, media_path: &str) -> SqlResult<Option<MediaProgressRow>> {
        let r = self.conn.query_row(
            "SELECT media_path, position, duration, updated_at FROM media_progress WHERE media_path = ?",
            params![media_path],
            |row| {
                Ok(MediaProgressRow {
                    media_path: row.get(0)?,
                    position: row.get(1)?,
                    duration: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        );
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_media_progress(&self, p: &MediaProgressRow) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO media_progress (media_path, position, duration, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(media_path) DO UPDATE SET position=excluded.position, duration=excluded.duration, updated_at=excluded.updated_at",
            params![p.media_path, p.position, p.duration, p.updated_at],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> Db {
        let dir = std::env::temp_dir().join(format!("ccc_test_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&dir);
        Db::open_at(&dir).unwrap()
    }

    #[test]
    fn content_roundtrip_all_types() {
        let db = tmp_db();

        // 注意：Tauri 边界上 content 是 JSON 字符串（与前端 JSON.stringify 对齐）
        // folder: JSON.stringify(null) -> "null"
        let folder = FsNodeRow {
            id: "f1".into(),
            node_type: "folder".into(),
            lib: "file".into(),
            kind: None,
            name: "新建文件夹".into(),
            parent_id: None,
            content: "null".into(),
            text: "".into(),
            order: 0,
            updated_at: 1,
            created_at: 1,
        };
        // note: JSON.stringify("") -> "\"\""
        let note = FsNodeRow {
            id: "n1".into(),
            node_type: "note".into(),
            lib: "file".into(),
            kind: None,
            name: "未命名笔记".into(),
            parent_id: None,
            content: "\"\"".into(),
            text: "".into(),
            order: 1,
            updated_at: 2,
            created_at: 2,
        };
        // mindmap: JSON.stringify(MindMapDoc)
        let mind = FsNodeRow {
            id: "m1".into(),
            node_type: "mindmap".into(),
            lib: "file".into(),
            kind: None,
            name: "新思维导图".into(),
            parent_id: None,
            content: "{\"root\":{\"id\":\"r1\",\"text\":\"中心主题\",\"children\":[]}}".into(),
            text: "".into(),
            order: 2,
            updated_at: 3,
            created_at: 3,
        };

        db.save_node(&folder).unwrap();
        db.save_node(&note).unwrap();
        db.save_node(&mind).unwrap();

        let all = db.list_nodes().unwrap();
        assert_eq!(all.len(), 3, "应有 3 个节点");

        let got_mind = all.iter().find(|n| n.id == "m1").unwrap();
        assert_eq!(got_mind.node_type, "mindmap");
        // content 作为 JSON 字符串透明往返，不做结构化解析
        assert_eq!(
            got_mind.content,
            "{\"root\":{\"id\":\"r1\",\"text\":\"中心主题\",\"children\":[]}}"
        );

        let got_folder = all.iter().find(|n| n.id == "f1").unwrap();
        assert_eq!(got_folder.content, "null");

        let got_note = all.iter().find(|n| n.id == "n1").unwrap();
        assert_eq!(got_note.content, "\"\"");

        // get_node 单条读取
        let one = db.get_node("m1").unwrap().unwrap();
        assert_eq!(one.content, "{\"root\":{\"id\":\"r1\",\"text\":\"中心主题\",\"children\":[]}}");
    }
}
