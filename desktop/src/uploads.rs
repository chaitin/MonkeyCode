// 对话附件上传/回读。落盘 <workdir>/.monkeycode/uploads/(会话工作区内,
// 模型经相对路径 Read 查看)。回读返回 data URL(Tauri 下 <img> 无法带鉴权头,
// 又不想开 asset scope 到任意工作区,小图 base64 内联最稳)。Markdown 里的
// 本地图片也走同一通道,但只放行工作区内的常见图片且限制体积。

use std::collections::{HashMap, HashSet};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use base64::Engine as _;
use serde_json::{json, Value};

use crate::util::LockExt;

/// 单条 IPC 消息的回读上限(read_data_url / read_dropped_file:整包 base64
/// 内联返回,超限会撑爆 webview)。附件**上传**不受此限:分块(upload_begin/
/// chunk/finish)与路径直拷(save_from_path)两条通道单块/零穿越,大小不设限。
const UPLOAD_MAX_BYTES: usize = 20 * 1024 * 1024;

pub(crate) const DESIGN_TEMPLATE_PREVIEW_ROOT: &str = ".monkeycode/design/template-previews";
const DESIGN_TEMPLATE_FILE_MAX_BYTES: u64 = 8 * 1024 * 1024;
const DESIGN_TEMPLATE_TOTAL_MAX_BYTES: u64 = 32 * 1024 * 1024;
// The iframe has an opaque origin (sandbox without allow-same-origin). Every local
// dependency is converted to a data URL, so neither `self` nor workspace asset
// access is required. Network, nested frames and active navigation stay disabled.
const DESIGN_TEMPLATE_CSP: &str = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'";

/// 常见图片 MIME → 扩展名(剪贴板图片无文件名时的命名兜底)。
fn image_ext(media_type: &str) -> Option<&'static str> {
    match media_type {
        "image/png" => Some(".png"),
        "image/jpeg" => Some(".jpg"),
        "image/gif" => Some(".gif"),
        "image/webp" => Some(".webp"),
        _ => None,
    }
}

/// 清洗上传文件名:去路径、去首尾点、白名单字符;超长或清空后为空返回 None。
fn sanitize_name(name: &str) -> Option<String> {
    let base = name.replace('\\', "/");
    let base = base.rsplit('/').next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|r| match r {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => r,
            '\u{4e00}'..='\u{9fff}' => r, // 常用汉字
            _ => '_',
        })
        .collect();
    let out = cleaned.trim_matches(['.', '_']).to_string();
    if out.is_empty() || out.len() > 120 {
        None
    } else {
        Some(out)
    }
}

/// 工作区 uploads 目录(WSL 模式下 workdir 转 UNC 访问)。
/// 工作区根(WSL 模式下映射 UNC)。空 workdir 会让相对路径落到进程 cwd
/// (打包应用下是主目录)——硬错误。
fn uploads_root(workdir: &str, wsl_distro: Option<&str>) -> Result<PathBuf, String> {
    if workdir.trim().is_empty() {
        return Err("会话缺少工作目录,无法定位附件目录".into());
    }
    Ok(match wsl_distro {
        Some(d) => crate::wsl::host_fs_view(d, workdir),
        None => PathBuf::from(workdir),
    })
}

fn uploads_dir(workdir: &str, wsl_distro: Option<&str>) -> Result<PathBuf, String> {
    Ok(uploads_root(workdir, wsl_distro)?
        .join(".monkeycode")
        .join("uploads"))
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

/// 路径按扩展名判定能否当图片内联(<img> 渲染)。与 image_mime 同一张表,
/// 也是 UI isImageFilename 的对齐口径:三层不一致时非图片会以
/// application/octet-stream 数据 URL 塞进 <img>,呈现为裂图。
pub(crate) fn is_image_path(path: &str) -> bool {
    image_mime(Path::new(path)).is_some()
}

/// 读取拖入窗口的本地文件为内容(Linux 壳原生拖放只给路径):返回
/// {name, mediaType, data(base64)},UI 还原成 File。仅云端任务用(内容要
/// 上行对象存储);本地会话走 stat_dropped_file + 路径直拷,不经此限。
/// 整包 base64 穿 IPC,保留 20MB 上限。
#[tauri::command]
pub async fn read_dropped_file(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_dropped(&path))
        .await
        .map_err(|e| format!("读取失败: {e}"))?
}

fn read_dropped(path: &str) -> Result<Value, String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|e| format!("读取失败: {e}"))?;
    if !meta.is_file() {
        return Err("只支持拖入文件(不支持目录)".into());
    }
    if meta.len() > UPLOAD_MAX_BYTES as u64 {
        return Err(format!(
            "文件过大({} 字节,上限 {})",
            meta.len(),
            UPLOAD_MAX_BYTES
        ));
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let data = std::fs::read(p).map_err(|e| format!("读取失败: {e}"))?;
    Ok(json!({
        "name": name,
        "mediaType": image_mime(p).unwrap_or(""),
        "data": base64::engine::general_purpose::STANDARD.encode(&data),
    }))
}

/// 保存原始字节到上传目录(浏览器截图等壳内生成物),返回工作区相对路径。
///
/// name 与 save() 同样过 sanitize_name:当前唯一调用方传的是壳自己生成的
/// `browser-<ms>.png`,但本函数是 pub 的,未清洗时 `../../x` 能写出目录外
/// (join 遇到 `..` 会向上跳)。清洗成本为零,不留这条latent 路径遍历。
pub fn save_raw(
    workdir: &str,
    wsl_distro: Option<&str>,
    name: &str,
    data: &[u8],
) -> Result<String, String> {
    let name = sanitize_name(name).ok_or("文件名无效")?;
    let dir = uploads_dir(workdir, wsl_distro)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建上传目录失败: {e}"))?;
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        let _ = std::fs::write(&gi, "*\n");
    }
    std::fs::write(dir.join(&name), data).map_err(|e| format!("写入失败: {e}"))?;
    Ok(format!(".monkeycode/uploads/{name}"))
}

/// 建好 uploads 目录(含自免疫 .gitignore)并返回。
fn ensure_uploads_dir(workdir: &str, wsl_distro: Option<&str>) -> Result<PathBuf, String> {
    let dir = uploads_dir(workdir, wsl_distro)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建上传目录失败: {e}"))?;
    // uploads 不入库:目录内放自免疫的 .gitignore(仅首次创建)
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        let _ = std::fs::write(&gi, "*\n");
    }
    Ok(dir)
}

/// 无名文件(剪贴板截图)的时间戳命名兜底。
fn fallback_name(media_type: &str) -> String {
    let (prefix, ext) = match image_ext(media_type) {
        Some(e) => ("img-", e),
        None => ("file-", ".bin"),
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{prefix}{ts}{ext}")
}

/// 重名追加序号(插在扩展名前);同时避开分块上传的半成品 `<名>.part`,
/// 两个并发 begin 选同名时后者让位。
fn reserve_name(dir: &Path, mut fname: String) -> String {
    let (stem, ext) = match fname.rfind('.') {
        Some(i) if i > 0 => (fname[..i].to_string(), fname[i..].to_string()),
        _ => (fname.clone(), String::new()),
    };
    let mut i = 2;
    while dir.join(&fname).exists() || dir.join(format!("{fname}.part")).exists() {
        fname = format!("{stem}-{i}{ext}");
        i += 1;
    }
    fname
}

// ==================== 分块上传(附件大小不设限的内容通道)====================
//
// 整文件 base64 一次性穿 IPC 是旧 20MB 上限的根源(webview 内存 + 单条消息
// 上限)。改为 begin/chunk/finish:begin 独占 `<名>.part` 建档,chunk 逐块
// 追加(UI 侧每块 4MB,单条消息有界),finish 改名为最终名。UI 崩溃遗留的
// .part 躺在 gitignored 的 uploads 目录里,无害且不会被当作附件引用。

struct PendingUpload {
    file: std::fs::File,
    part: PathBuf,
    dest: PathBuf,
    rel: String,
}

fn pending() -> &'static Mutex<HashMap<u64, PendingUpload>> {
    static P: OnceLock<Mutex<HashMap<u64, PendingUpload>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}
static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);

/// 开始分块上传:占位半成品文件,返回句柄。命名:优先保留原始文件名
/// (清洗后);无名按时间戳兜底;重名追加序号。
pub fn begin(
    workdir: &str,
    wsl_distro: Option<&str>,
    name: &str,
    media_type: &str,
) -> Result<u64, String> {
    let dir = ensure_uploads_dir(workdir, wsl_distro)?;
    let fname = reserve_name(
        &dir,
        sanitize_name(name).unwrap_or_else(|| fallback_name(media_type)),
    );
    let part = dir.join(format!("{fname}.part"));
    // create_new:与并发 begin 争抢同名时硬失败而不是互写
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part)
        .map_err(|e| format!("创建上传文件失败: {e}"))?;
    let h = NEXT_HANDLE.fetch_add(1, Ordering::Relaxed);
    pending().lock_ok().insert(
        h,
        PendingUpload {
            file,
            part,
            dest: dir.join(&fname),
            rel: format!(".monkeycode/uploads/{fname}"),
        },
    );
    Ok(h)
}

/// 追加一块。写失败即销档删半成品:句柄失效让 UI 立刻感知,不留残档。
pub fn chunk(handle: u64, data_b64: &str) -> Result<(), String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|_| "文件数据无效".to_string())?;
    let mut map = pending().lock_ok();
    let p = map.get_mut(&handle).ok_or("上传已失效,请重试")?;
    if let Err(e) = p.file.write_all(&raw) {
        let p = map.remove(&handle).expect("刚取过必在");
        drop(p.file);
        let _ = std::fs::remove_file(&p.part);
        return Err(format!("写入文件失败: {e}"));
    }
    Ok(())
}

/// 收尾:半成品改名为最终名,返回 {path: 工作区相对路径}。
pub fn finish(handle: u64) -> Result<Value, String> {
    let p = pending()
        .lock_ok()
        .remove(&handle)
        .ok_or("上传已失效,请重试")?;
    p.file
        .sync_all()
        .map_err(|e| format!("写入文件失败: {e}"))?;
    drop(p.file);
    std::fs::rename(&p.part, &p.dest).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(json!({ "path": p.rel }))
}

/// 放弃上传(UI 侧任一块失败后调用):销档删半成品,幂等。
pub fn abort(handle: u64) {
    if let Some(p) = pending().lock_ok().remove(&handle) {
        drop(p.file);
        let _ = std::fs::remove_file(&p.part);
    }
}

/// 按源路径直拷进 uploads 目录(Linux 原生拖拽给真实路径):内容零穿越
/// IPC,大小不设限。返回 {path: 工作区相对路径}。
pub fn save_from_path(workdir: &str, wsl_distro: Option<&str>, src: &str) -> Result<Value, String> {
    let sp = Path::new(src);
    let meta = std::fs::metadata(sp).map_err(|e| format!("读取源文件失败: {e}"))?;
    if !meta.is_file() {
        return Err("只支持拖入文件(不支持目录)".into());
    }
    let dir = ensure_uploads_dir(workdir, wsl_distro)?;
    let name = sp.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let media = image_mime(sp).unwrap_or("");
    let fname = reserve_name(
        &dir,
        sanitize_name(name).unwrap_or_else(|| fallback_name(media)),
    );
    std::fs::copy(sp, dir.join(&fname)).map_err(|e| format!("复制文件失败: {e}"))?;
    Ok(json!({ "path": format!(".monkeycode/uploads/{fname}") }))
}

/// 原生拖拽文件的元数据(路径直拷通道的探针:UI 拿它造 path-backed 占位
/// File,内容由壳按路径直拷,不设大小限制)。
#[tauri::command]
pub async fn stat_dropped_file(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        let meta = std::fs::metadata(p).map_err(|e| format!("读取失败: {e}"))?;
        if !meta.is_file() {
            return Err("只支持拖入文件(不支持目录)".into());
        }
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        Ok(json!({
            "name": name,
            "mediaType": image_mime(p).unwrap_or(""),
            "size": meta.len(),
        }))
    })
    .await
    .map_err(|e| format!("读取失败: {e}"))?
}

/// 分块上传的三个命令面(begin 在 driver/mod.rs——要解析会话工作目录)。
#[tauri::command]
pub async fn upload_chunk(handle: u64, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || chunk(handle, &data))
        .await
        .map_err(|e| format!("上传失败: {e}"))?
}

#[tauri::command]
pub async fn upload_finish(handle: u64) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || finish(handle))
        .await
        .map_err(|e| format!("上传失败: {e}"))?
}

#[tauri::command]
pub async fn upload_abort(handle: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || abort(handle))
        .await
        .map_err(|e| format!("上传失败: {e}"))
}

/// 回读文件为 data URL:
/// - `.monkeycode/uploads/` 内仍允许任意附件(下载用,未知类型按 octet-stream);
/// - 其他路径只允许工作区内的常见图片(Markdown `<img>` 用)。
/// 绝对路径与相对路径都先 canonicalize 并校验仍在工作区内,防 `..` 和符号链接越界。
pub fn read_data_url(
    workdir: &str,
    wsl_distro: Option<&str>,
    path: &str,
) -> Result<String, String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("图片路径为空".into());
    }
    let root = std::fs::canonicalize(uploads_root(workdir, wsl_distro)?)
        .map_err(|e| format!("工作区路径无效: {e}"))?;
    let requested = Path::new(raw);
    let candidate = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        root.join(requested)
    };
    let p = std::fs::canonicalize(&candidate).map_err(|e| format!("读取失败: {e}"))?;
    if !p.starts_with(&root) {
        return Err("图片路径超出工作区".into());
    }
    let rel = p
        .strip_prefix(&root)
        .map_err(|_| "图片路径超出工作区".to_string())?;
    let in_uploads = rel.starts_with(Path::new(".monkeycode").join("uploads"));
    let mime = match image_mime(&p) {
        Some(m) => m,
        None if in_uploads => "application/octet-stream",
        None => return Err("仅支持工作区内的常见图片格式(PNG/JPEG/GIF/WebP/BMP/SVG/AVIF)".into()),
    };
    let meta = std::fs::metadata(&p).map_err(|e| format!("读取失败: {e}"))?;
    if !meta.is_file() {
        return Err("图片路径不是文件".into());
    }
    if meta.len() > UPLOAD_MAX_BYTES as u64 {
        return Err(format!(
            "文件过大({} 字节,上限 {})",
            meta.len(),
            UPLOAD_MAX_BYTES
        ));
    }
    let data = std::fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&data)
    ))
}

pub fn read_design_template_html(
    workdir: &str,
    wsl_distro: Option<&str>,
    path: &str,
) -> Result<String, String> {
    let raw = path.trim();
    let requested = Path::new(raw);
    if raw.is_empty()
        || requested.is_absolute()
        || requested
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("模板预览路径必须是无 traversal 的相对路径".into());
    }
    let workspace = uploads_root(workdir, wsl_distro)?;
    let root = workspace.join(DESIGN_TEMPLATE_PREVIEW_ROOT);
    reject_symlink(&workspace, &root)?;
    let relative = requested
        .strip_prefix(DESIGN_TEMPLATE_PREVIEW_ROOT)
        .unwrap_or(requested);
    let mut candidate = root.join(relative);
    reject_symlink(&workspace, &candidate)?;
    if std::fs::symlink_metadata(&candidate)
        .map_err(|e| format!("读取模板预览失败: {e}"))?
        .is_dir()
    {
        candidate = candidate.join("index.html");
        reject_symlink(&workspace, &candidate)?;
    }
    let cache_root =
        std::fs::canonicalize(&root).map_err(|e| format!("模板预览缓存根无效: {e}"))?;
    // The first path component is the Agent-generated digest. Scope the whole
    // dependency closure to that one bundle, not to sibling digest directories.
    let digest = relative
        .components()
        .next()
        .and_then(|c| match c {
            std::path::Component::Normal(v) => Some(v),
            _ => None,
        })
        .ok_or("模板预览缺少 digest")?;
    let bundle_root_candidate = root.join(digest);
    reject_symlink(&workspace, &bundle_root_candidate)?;
    let canonical_root = std::fs::canonicalize(&bundle_root_candidate)
        .map_err(|e| format!("模板预览 bundle 根无效: {e}"))?;
    if !canonical_root.starts_with(&cache_root) || !canonical_root.is_dir() {
        return Err("模板预览 bundle 根无效".into());
    }
    let canonical = checked_bundle_file(&workspace, &canonical_root, &candidate)?;
    if bundle_mime(&canonical) != Some("text/html") {
        return Err("模板预览 bundle 必须是 HTML".into());
    }

    let canonical_workspace =
        std::fs::canonicalize(&workspace).map_err(|e| format!("工作区路径无效: {e}"))?;
    let mut inliner = BundleInliner {
        workspace: &canonical_workspace,
        root: &canonical_root,
        total: 0,
        active_resources: HashSet::new(),
    };
    let bytes = inliner.read_file(&canonical)?;
    let html = String::from_utf8(bytes).map_err(|_| "模板预览 HTML 必须是 UTF-8".to_string())?;
    let html = inliner.rewrite_html(&html, canonical.parent().ok_or("模板预览入口无父目录")?)?;
    // First parser token: even malformed bundles cannot execute before the policy.
    let policy =
        format!(r#"<meta http-equiv="Content-Security-Policy" content="{DESIGN_TEMPLATE_CSP}">"#);
    Ok(format!("{policy}{html}"))
}

struct BundleInliner<'a> {
    workspace: &'a Path,
    root: &'a Path,
    total: u64,
    active_resources: HashSet<PathBuf>,
}

impl BundleInliner<'_> {
    fn read_file(&mut self, path: &Path) -> Result<Vec<u8>, String> {
        let meta = std::fs::metadata(path).map_err(|e| format!("读取模板预览资源失败: {e}"))?;
        if !meta.is_file() || meta.len() > DESIGN_TEMPLATE_FILE_MAX_BYTES {
            return Err("模板预览资源不是文件或超过 8 MiB".into());
        }
        self.total = self
            .total
            .checked_add(meta.len())
            .ok_or("模板预览 bundle 过大")?;
        if self.total > DESIGN_TEMPLATE_TOTAL_MAX_BYTES {
            return Err("模板预览 bundle 依赖超过 32 MiB".into());
        }
        std::fs::read(path).map_err(|e| format!("读取模板预览资源失败: {e}"))
    }

    fn resolve(&self, base: &Path, url: &str) -> Result<Option<PathBuf>, String> {
        let url = url.trim();
        if url.is_empty()
            || url.starts_with('#')
            || url.starts_with("data:")
            || url.starts_with("blob:")
            || url.starts_with("//")
            || url.contains("://")
        {
            return Ok(None);
        }
        let path_part = url.split(['?', '#']).next().unwrap_or("");
        let decoded = percent_decode_path(path_part)?;
        let requested = Path::new(&decoded);
        if requested.is_absolute() {
            return Err("模板预览资源路径不允许 absolute".into());
        }
        // `../` is normal inside nested CSS (for example styles/app.css ->
        // ../fonts/x.woff2). Canonical containment below rejects escape, while
        // reject_symlink inspects every traversed component before canonicalize.
        let candidate = base.join(requested);
        reject_symlink(self.workspace, &candidate)?;
        Ok(Some(checked_bundle_file(
            self.workspace,
            self.root,
            &candidate,
        )?))
    }

    fn data_url(&mut self, base: &Path, url: &str) -> Result<Option<String>, String> {
        let Some(path) = self.resolve(base, url)? else {
            return Ok(None);
        };
        let mime = bundle_mime(&path)
            .ok_or_else(|| format!("不支持的模板预览资源类型: {}", path.display()))?;
        let mut bytes = self.read_file(&path)?;
        if mime == "text/css" || mime == "text/javascript" {
            if !self.active_resources.insert(path.clone()) {
                return Err("模板预览资源不允许循环依赖".into());
            }
            let text = String::from_utf8(bytes)
                .map_err(|_| format!("模板预览 {mime} 资源必须是 UTF-8"))?;
            let parent = path.parent().ok_or("模板预览资源无父目录")?;
            let rewritten = if mime == "text/css" {
                self.rewrite_css(&text, parent)
            } else {
                self.rewrite_javascript(&text, parent)
            };
            self.active_resources.remove(&path);
            bytes = rewritten?.into_bytes();
        }
        Ok(Some(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )))
    }

    fn rewrite_css(&mut self, css: &str, base: &Path) -> Result<String, String> {
        let url_re = regex::Regex::new(r#"(?i)url\(\s*(['\"]?)([^'\")]+)['\"]?\s*\)"#)
            .expect("static regex");
        let mut out = replace_regex_result(css, &url_re, |caps| {
            let original = caps.get(0).unwrap().as_str();
            Ok(match self.data_url(base, caps.get(2).unwrap().as_str())? {
                Some(url) => format!("url(\"{url}\")"),
                None => original.to_string(),
            })
        })?;
        // CSS permits bare @import "theme.css" in addition to @import url(...).
        let import_re =
            regex::Regex::new(r#"(?i)@import\s+(['\"])([^'\"]+)['\"]"#).expect("static regex");
        out = replace_regex_result(&out, &import_re, |caps| {
            let original = caps.get(0).unwrap().as_str();
            Ok(match self.data_url(base, caps.get(2).unwrap().as_str())? {
                Some(url) => format!("@import url(\"{url}\")"),
                None => original.to_string(),
            })
        })?;
        Ok(out)
    }

    fn rewrite_javascript(&mut self, script: &str, base: &Path) -> Result<String, String> {
        // Static imports/exports and dynamic import() lose their filesystem base
        // after the parent module becomes a data URL, so inline those edges too.
        let static_re = regex::Regex::new(
            r#"(?m)(\b(?:import|export)\s+(?:[^;\n'\"]*?\s+from\s+)?)(['\"])([^'\"]+)(['\"])"#,
        )
        .expect("static regex");
        let mut out = replace_regex_result(script, &static_re, |caps| {
            Ok(match self.data_url(base, caps.get(3).unwrap().as_str())? {
                Some(data) => format!("{}{}{}{}", &caps[1], &caps[2], data, &caps[4]),
                None => caps.get(0).unwrap().as_str().to_string(),
            })
        })?;
        let dynamic_re = regex::Regex::new(r#"(?m)(\bimport\s*\(\s*)(['\"])([^'\"]+)(['\"])"#)
            .expect("static regex");
        out = replace_regex_result(&out, &dynamic_re, |caps| {
            Ok(match self.data_url(base, caps.get(3).unwrap().as_str())? {
                Some(data) => format!("{}{}{}{}", &caps[1], &caps[2], data, &caps[4]),
                None => caps.get(0).unwrap().as_str().to_string(),
            })
        })?;
        let asset_re = regex::Regex::new(
            r#"(?m)(\bnew\s+URL\s*\(\s*)(['\"])([^'\"]+)(['\"])(\s*,\s*import\.meta\.url\s*\))"#,
        )
        .expect("static regex");
        out = replace_regex_result(&out, &asset_re, |caps| {
            Ok(match self.data_url(base, caps.get(3).unwrap().as_str())? {
                Some(data) => format!("{}{}{}{}{}", &caps[1], &caps[2], data, &caps[4], &caps[5]),
                None => caps.get(0).unwrap().as_str().to_string(),
            })
        })?;
        Ok(out)
    }

    fn rewrite_html(&mut self, html: &str, base: &Path) -> Result<String, String> {
        // Inline style/module blocks need a synthetic bundle base because the blob
        // document itself has no local filesystem URL.
        let style_tag_re =
            regex::Regex::new(r#"(?is)(<style\b[^>]*>)(.*?)(</style\s*>)"#).expect("static regex");
        let mut out = replace_regex_result(html, &style_tag_re, |caps| {
            Ok(format!(
                "{}{}{}",
                &caps[1],
                self.rewrite_css(&caps[2], base)?,
                &caps[3]
            ))
        })?;
        let script_tag_re = regex::Regex::new(r#"(?is)(<script\b[^>]*>)(.*?)(</script\s*>)"#)
            .expect("static regex");
        let script_src_re = regex::Regex::new(r"(?i)\bsrc\s*=").expect("static regex");
        out = replace_regex_result(&out, &script_tag_re, |caps| {
            if script_src_re.is_match(&caps[1]) {
                return Ok(caps.get(0).unwrap().as_str().to_string());
            }
            Ok(format!(
                "{}{}{}",
                &caps[1],
                self.rewrite_javascript(&caps[2], base)?,
                &caps[3]
            ))
        })?;
        let style_attr_re = regex::Regex::new(r#"(?i)(\bstyle\s*=\s*)(['\"])([^'\"]*)(['\"])"#)
            .expect("static regex");
        out = replace_regex_result(&out, &style_attr_re, |caps| {
            Ok(format!(
                "{}{}{}{}",
                &caps[1],
                &caps[2],
                self.rewrite_css(&caps[3], base)?,
                &caps[4]
            ))
        })?;
        // href is rewritten only for stylesheets; ordinary links remain inert under
        // sandbox/CSP. src/poster cover scripts, images, media and source elements.
        let attr_re = regex::Regex::new(r#"(?i)(\b(?:src|poster)\s*=\s*)(['\"])([^'\"]+)(['\"])"#)
            .expect("static regex");
        out = replace_regex_result(&out, &attr_re, |caps| {
            let url = caps.get(3).unwrap().as_str();
            Ok(match self.data_url(base, url)? {
                Some(data) => format!("{}{}{}{}", &caps[1], &caps[2], data, &caps[4]),
                None => caps.get(0).unwrap().as_str().to_string(),
            })
        })?;
        let href_re =
            regex::Regex::new(r#"(?i)(\bhref\s*=\s*)(['\"])([^'\"]+\.css(?:[?#][^'\"]*)?)(['\"])"#)
                .expect("static regex");
        out = replace_regex_result(&out, &href_re, |caps| {
            Ok(match self.data_url(base, caps.get(3).unwrap().as_str())? {
                Some(data) => format!("{}{}{}{}", &caps[1], &caps[2], data, &caps[4]),
                None => caps.get(0).unwrap().as_str().to_string(),
            })
        })?;
        Ok(out)
    }
}

fn replace_regex_result<F>(input: &str, re: &regex::Regex, mut replace: F) -> Result<String, String>
where
    F: FnMut(&regex::Captures<'_>) -> Result<String, String>,
{
    let mut out = String::with_capacity(input.len());
    let mut end = 0;
    for caps in re.captures_iter(input) {
        let matched = caps.get(0).expect("capture zero");
        out.push_str(&input[end..matched.start()]);
        out.push_str(&replace(&caps)?);
        end = matched.end();
    }
    out.push_str(&input[end..]);
    Ok(out)
}

fn percent_decode_path(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("模板预览资源 URL 编码无效".into());
            }
            let hex = |b: u8| match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(b - b'a' + 10),
                b'A'..=b'F' => Some(b - b'A' + 10),
                _ => None,
            };
            let hi = hex(bytes[i + 1]).ok_or("模板预览资源 URL 编码无效")?;
            let lo = hex(bytes[i + 2]).ok_or("模板预览资源 URL 编码无效")?;
            out.push(hi * 16 + lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "模板预览资源 URL 必须是 UTF-8".into())
}

fn checked_bundle_file(workspace: &Path, root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    reject_symlink(workspace, candidate)?;
    let canonical =
        std::fs::canonicalize(candidate).map_err(|e| format!("读取模板预览失败: {e}"))?;
    if !canonical.starts_with(root) {
        return Err(format!(
            "模板预览路径超出缓存根: {} (root {})",
            canonical.display(),
            root.display()
        ));
    }
    Ok(canonical)
}

fn bundle_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "html" | "htm" => Some("text/html"),
        "css" => Some("text/css"),
        "js" | "mjs" => Some("text/javascript"),
        "json" => Some("application/json"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        "ico" => Some("image/x-icon"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "ogg" => Some("audio/ogg"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        _ => None,
    }
}

fn reject_symlink(anchor: &Path, candidate: &Path) -> Result<(), String> {
    let relative = candidate
        .strip_prefix(anchor)
        .map_err(|_| "模板预览路径超出缓存根")?;
    let mut current = anchor.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        if std::fs::symlink_metadata(&current)
            .map_err(|e| format!("读取模板预览失败: {e}"))?
            .file_type()
            .is_symlink()
        {
            return Err("模板预览路径不允许符号链接".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);
            let path = std::env::temp_dir().join(format!(
                "monkeycode-uploads-{}-{nonce}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn b64(data: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(data)
    }

    /// 分块上传全链路:begin 占位 .part,chunk 逐块追加(独立解码后按字节
    /// 拼接,块边界与 base64 3 字节组无关),finish 改名;句柄一次性。
    #[test]
    fn chunked_upload_reassembles_and_renames() {
        let tmp = TempDir::new();
        let workdir = tmp.0.to_string_lossy().to_string();
        let h = begin(&workdir, None, "big.bin", "").unwrap();
        assert!(
            tmp.0.join(".monkeycode/uploads/big.bin.part").is_file(),
            "begin 未占位半成品"
        );
        chunk(h, &b64(b"hello ")).unwrap();
        chunk(h, &b64(b"world")).unwrap();
        let out = finish(h).unwrap();
        assert_eq!(out["path"], ".monkeycode/uploads/big.bin");
        let dest = tmp.0.join(".monkeycode/uploads/big.bin");
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello world");
        assert!(
            !tmp.0.join(".monkeycode/uploads/big.bin.part").exists(),
            "半成品未清理"
        );
        // 句柄一次性:finish 后 chunk/finish 都拒绝
        assert!(chunk(h, &b64(b"x")).is_err());
        assert!(finish(h).is_err());
    }

    /// abort 销档删半成品;重名(含 .part 半成品占位)追加序号。
    #[test]
    fn chunked_upload_abort_and_name_collision() {
        let tmp = TempDir::new();
        let workdir = tmp.0.to_string_lossy().to_string();
        let h1 = begin(&workdir, None, "a.txt", "").unwrap();
        // 与在途半成品同名:必须让位成 a-2.txt,不得互写
        let h2 = begin(&workdir, None, "a.txt", "").unwrap();
        chunk(h2, &b64(b"two")).unwrap();
        assert_eq!(finish(h2).unwrap()["path"], ".monkeycode/uploads/a-2.txt");
        abort(h1);
        assert!(
            !tmp.0.join(".monkeycode/uploads/a.txt.part").exists(),
            "abort 未删半成品"
        );
        abort(h1); // 幂等
    }

    /// 路径直拷:复制进 uploads、保留文件名、重名追加序号、目录拒绝。
    #[test]
    fn save_from_path_copies_and_uniquifies() {
        let tmp = TempDir::new();
        let ws = tmp.0.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let workdir = ws.to_string_lossy().to_string();
        let src = tmp.0.join("数据集.csv");
        std::fs::write(&src, b"a,b\n1,2\n").unwrap();

        let out = save_from_path(&workdir, None, &src.to_string_lossy()).unwrap();
        assert_eq!(out["path"], ".monkeycode/uploads/数据集.csv");
        assert_eq!(
            std::fs::read(ws.join(".monkeycode/uploads/数据集.csv")).unwrap(),
            b"a,b\n1,2\n"
        );

        let out2 = save_from_path(&workdir, None, &src.to_string_lossy()).unwrap();
        assert_eq!(out2["path"], ".monkeycode/uploads/数据集-2.csv");

        assert!(
            save_from_path(&workdir, None, &tmp.0.to_string_lossy()).is_err(),
            "目录必须拒绝"
        );
    }

    /// save_raw 是 pub 的,名字必须与分块/直拷同样清洗:未清洗时 join 遇到
    /// `..` 会跳出 uploads 目录,把字节写到工作区外。
    #[test]
    fn save_raw_rejects_path_traversal_and_keeps_path_consistent() {
        let tmp = TempDir::new();
        // 工作区嵌在临时目录内层:逃逸目标才落在受控的 tmp.0 里,而不是
        // 共享的系统 temp(否则一次失败会留下 /tmp/evil.png 污染后续跑批)。
        let ws = tmp.0.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let workdir = ws.to_string_lossy().to_string();

        // uploads 目录是 <workdir>/.monkeycode/uploads,三级 `..` 才真正逃出
        // 工作区——旧实现会把字节写到 workdir 的父目录里。
        let rel = save_raw(&workdir, None, "../../../evil.png", b"x").unwrap();
        assert_eq!(rel, ".monkeycode/uploads/evil.png");
        assert!(ws.join(".monkeycode/uploads/evil.png").is_file());
        assert!(!tmp.0.join("evil.png").exists(), "不得写出工作区");

        // 返回的相对路径与实际落盘文件名一致(壳把它当模型可读路径回传)
        let rel = save_raw(&workdir, None, "browser-1730000000000.png", b"y").unwrap();
        assert_eq!(rel, ".monkeycode/uploads/browser-1730000000000.png");
        assert!(ws.join(&rel).is_file());

        // 清洗后为空的名字必须硬错误,不能写出无名文件
        assert!(save_raw(&workdir, None, "../..", b"z").is_err());
    }

    #[test]
    fn markdown_image_accepts_relative_and_absolute_paths_inside_workspace() {
        let tmp = TempDir::new();
        let image = tmp.0.join("cat.jpg");
        std::fs::write(&image, [0xff, 0xd8, 0xff, 0xd9]).unwrap();
        let workdir = tmp.0.to_string_lossy();
        let expected = "data:image/jpeg;base64,/9j/2Q==";
        assert_eq!(read_data_url(&workdir, None, "cat.jpg").unwrap(), expected);
        assert_eq!(
            read_data_url(&workdir, None, &image.to_string_lossy()).unwrap(),
            expected
        );
    }

    #[test]
    fn markdown_image_rejects_outside_workspace_and_non_images() {
        let parent = TempDir::new();
        let workspace = parent.0.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let outside = parent.0.join("outside.jpg");
        std::fs::write(&outside, [0xff, 0xd8]).unwrap();
        std::fs::write(workspace.join("notes.txt"), b"not an image").unwrap();
        let workdir = workspace.to_string_lossy();
        assert!(read_data_url(&workdir, None, &outside.to_string_lossy())
            .unwrap_err()
            .contains("超出工作区"));
        assert!(read_data_url(&workdir, None, "notes.txt")
            .unwrap_err()
            .contains("仅支持"));
    }

    /// 拖入文件按路径读回:名字/MIME/内容齐全;目录与超限文件硬错误
    /// (Linux 原生拖放只给路径,这是唯一取内容的通道)。
    #[test]
    fn dropped_file_roundtrip_and_limits() {
        let tmp = TempDir::new();
        let img = tmp.0.join("猫图.png");
        std::fs::write(&img, b"fake-png").unwrap();
        let v = read_dropped(&img.to_string_lossy()).unwrap();
        assert_eq!(v["name"], "猫图.png");
        assert_eq!(v["mediaType"], "image/png");
        assert_eq!(
            v["data"],
            base64::engine::general_purpose::STANDARD.encode(b"fake-png")
        );

        // 非图片扩展名 MIME 置空(UI 侧按 [文件] 处理)
        let txt = tmp.0.join("notes.txt");
        std::fs::write(&txt, b"hi").unwrap();
        assert_eq!(
            read_dropped(&txt.to_string_lossy()).unwrap()["mediaType"],
            ""
        );

        // 目录、不存在的路径、超限文件(sparse 快速置长)都拒绝
        assert!(read_dropped(&tmp.0.to_string_lossy())
            .unwrap_err()
            .contains("目录"));
        assert!(read_dropped(&tmp.0.join("missing").to_string_lossy()).is_err());
        let big = tmp.0.join("big.bin");
        let f = std::fs::File::create(&big).unwrap();
        f.set_len(UPLOAD_MAX_BYTES as u64 + 1).unwrap();
        assert!(read_dropped(&big.to_string_lossy())
            .unwrap_err()
            .contains("过大"));
    }

    #[test]
    fn design_template_bundle_inlines_nested_css_font_image_and_script() {
        let tmp = TempDir::new();
        let root = tmp.0.join(DESIGN_TEMPLATE_PREVIEW_ROOT).join("card");
        std::fs::create_dir_all(root.join("styles/nested")).unwrap();
        std::fs::create_dir_all(root.join("scripts")).unwrap();
        std::fs::create_dir_all(root.join("images")).unwrap();
        std::fs::create_dir_all(root.join("fonts")).unwrap();
        std::fs::write(root.join("index.html"), r#"<link rel="stylesheet" href="styles/main.css"><style>.inline{background:url('images/card.png')}</style><img src="images/card.png"><script src="scripts/app.js"></script><script type="module">import './scripts/nested.js'</script>"#).unwrap();
        std::fs::write(
            root.join("styles/main.css"),
            r#"@import "nested/theme.css"; .hero{background:url('../images/card.png')}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("styles/nested/theme.css"),
            r#"@font-face{font-family:demo;src:url('../../fonts/demo.woff2')}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("scripts/app.js"),
            b"import './nested.js'; document.body.dataset.loaded='yes'",
        )
        .unwrap();
        std::fs::write(root.join("scripts/nested.js"), b"window.nested=true").unwrap();
        std::fs::write(root.join("images/card.png"), b"png-bytes").unwrap();
        std::fs::write(root.join("fonts/demo.woff2"), b"woff-bytes").unwrap();

        let html = read_design_template_html(&tmp.0.to_string_lossy(), None, "card").unwrap();
        assert!(html.starts_with("<meta http-equiv=\"Content-Security-Policy\""));
        for directive in [
            "connect-src 'none'",
            "frame-src 'none'",
            "form-action 'none'",
            "navigate-to 'none'",
            "object-src 'none'",
        ] {
            assert!(
                html.contains(directive),
                "missing CSP directive {directive}"
            );
        }
        assert!(html.contains("data:text/css;base64,"));
        assert!(html.contains("data:text/javascript;base64,"));
        assert!(html.contains("data:image/png;base64,"));
        assert!(!html.contains("styles/main.css"));
        assert!(!html.contains("scripts/app.js"));
        let script_b64 = html
            .split("data:text/javascript;base64,")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap();
        let script = String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(script_b64)
                .unwrap(),
        )
        .unwrap();
        assert!(
            script.contains("data:text/javascript;base64,"),
            "nested script was not inlined: {script}"
        );

        let css_b64 = html
            .split("data:text/css;base64,")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap();
        let css = String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(css_b64)
                .unwrap(),
        )
        .unwrap();
        assert!(
            css.contains("data:image/png;base64,"),
            "CSS image was not inlined: {css}"
        );
        assert!(
            css.contains("data:text/css;base64,"),
            "nested CSS was not inlined: {css}"
        );
        let nested_b64 = css
            .split("data:text/css;base64,")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap();
        let nested = String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(nested_b64)
                .unwrap(),
        )
        .unwrap();
        assert!(
            nested.contains("data:font/woff2;base64,"),
            "nested font was not inlined: {nested}"
        );
    }

    #[test]
    fn design_template_html_is_scoped_and_gets_strict_csp() {
        let tmp = TempDir::new();
        let root = tmp.0.join(DESIGN_TEMPLATE_PREVIEW_ROOT).join("card");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("index.html"),
            "<html><head><title>x</title></head><body></body></html>",
        )
        .unwrap();
        let html = read_design_template_html(&tmp.0.to_string_lossy(), None, "card").unwrap();
        assert!(html.contains("connect-src 'none'"));
        assert!(html.contains("navigate-to 'none'"));
        assert!(html.find("Content-Security-Policy").unwrap() < html.find("<title>").unwrap());
        assert!(
            read_design_template_html(&tmp.0.to_string_lossy(), None, "../outside.html").is_err()
        );
        assert!(
            read_design_template_html(&tmp.0.to_string_lossy(), None, "/tmp/outside.html").is_err()
        );
        let sibling = tmp.0.join(DESIGN_TEMPLATE_PREVIEW_ROOT).join("other");
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("secret.png"), b"secret").unwrap();
        std::fs::write(root.join("index.html"), "<img src=\"../other/secret.png\">").unwrap();
        assert!(
            read_design_template_html(&tmp.0.to_string_lossy(), None, "card")
                .unwrap_err()
                .contains("超出缓存根")
        );
    }

    #[cfg(unix)]
    #[test]
    fn design_template_html_rejects_symlinks() {
        use std::os::unix::fs::symlink;
        let tmp = TempDir::new();
        let root = tmp.0.join(DESIGN_TEMPLATE_PREVIEW_ROOT);
        std::fs::create_dir_all(root.join("real")).unwrap();
        std::fs::write(
            root.join("real/index.html"),
            "<img src=\"inside-link.png\">",
        )
        .unwrap();
        std::fs::write(root.join("real/image.png"), b"png").unwrap();
        symlink(
            root.join("real/image.png"),
            root.join("real/inside-link.png"),
        )
        .unwrap();
        symlink(root.join("real"), root.join("linked")).unwrap();
        assert!(
            read_design_template_html(&tmp.0.to_string_lossy(), None, "linked")
                .unwrap_err()
                .contains("符号链接")
        );
        assert!(
            read_design_template_html(&tmp.0.to_string_lossy(), None, "real")
                .unwrap_err()
                .contains("符号链接")
        );
    }

    #[test]
    fn uploaded_non_image_remains_downloadable() {
        let tmp = TempDir::new();
        let uploads = tmp.0.join(".monkeycode/uploads");
        std::fs::create_dir_all(&uploads).unwrap();
        std::fs::write(uploads.join("notes.txt"), b"hello").unwrap();
        let url = read_data_url(
            &tmp.0.to_string_lossy(),
            None,
            ".monkeycode/uploads/notes.txt",
        )
        .unwrap();
        assert_eq!(url, "data:application/octet-stream;base64,aGVsbG8=");
    }
}
