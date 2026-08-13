// 对话附件上传/回读。落盘 <workdir>/.monkeycode/uploads/(会话工作区内,
// 模型经相对路径 Read 查看)。回读返回 data URL(Tauri 下 <img> 无法带鉴权头,
// 又不想开 asset scope 到任意工作区,小图 base64 内联最稳)。Markdown 里的
// 本地图片也走同一通道,但只放行工作区内的常见图片且限制体积。

use std::collections::HashMap;
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
pub(crate) fn sanitize_name(name: &str) -> Option<String> {
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
    Ok(uploads_root(workdir, wsl_distro)?.join(".monkeycode").join("uploads"))
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
        return Err(format!("文件过大({} 字节,上限 {})", meta.len(), UPLOAD_MAX_BYTES));
    }
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
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
pub fn save_raw(workdir: &str, wsl_distro: Option<&str>, name: &str, data: &[u8]) -> Result<String, String> {
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
pub fn begin(workdir: &str, wsl_distro: Option<&str>, name: &str, media_type: &str) -> Result<u64, String> {
    let dir = ensure_uploads_dir(workdir, wsl_distro)?;
    begin_in_dir(dir, ".monkeycode/uploads/", name, media_type)
}

/// begin 的目录参数化本体(待办图片走 config_dir/todo-uploads,与会话工作区
/// 共用同一张句柄表与 chunk/finish/abort 命令面):rel = rel_prefix + 落盘名,
/// 即 finish 回给 UI 的引用路径——会话通道是工作区相对路径,待办是裸文件名。
pub(crate) fn begin_in_dir(dir: PathBuf, rel_prefix: &str, name: &str, media_type: &str) -> Result<u64, String> {
    let fname = reserve_name(&dir, sanitize_name(name).unwrap_or_else(|| fallback_name(media_type)));
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
        PendingUpload { file, part, dest: dir.join(&fname), rel: format!("{rel_prefix}{fname}") },
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
    let p = pending().lock_ok().remove(&handle).ok_or("上传已失效,请重试")?;
    p.file.sync_all().map_err(|e| format!("写入文件失败: {e}"))?;
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
    let dir = ensure_uploads_dir(workdir, wsl_distro)?;
    save_from_path_in_dir(dir, ".monkeycode/uploads/", src)
}

/// save_from_path 的目录参数化本体(与 begin_in_dir 同一组;rel 语义同)。
pub(crate) fn save_from_path_in_dir(dir: PathBuf, rel_prefix: &str, src: &str) -> Result<Value, String> {
    let sp = Path::new(src);
    let meta = std::fs::metadata(sp).map_err(|e| format!("读取源文件失败: {e}"))?;
    if !meta.is_file() {
        return Err("只支持拖入文件(不支持目录)".into());
    }
    let name = sp.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let media = image_mime(sp).unwrap_or("");
    let fname = reserve_name(&dir, sanitize_name(name).unwrap_or_else(|| fallback_name(media)));
    std::fs::copy(sp, dir.join(&fname)).map_err(|e| format!("复制文件失败: {e}"))?;
    Ok(json!({ "path": format!("{rel_prefix}{fname}") }))
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
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            // 纳秒戳在并行测试线程下可能同刻撞名(共用目录 → 互踩/互删,
            // 偶发挂):再叠一个进程内自增号,唯一性不再赌时钟分辨率
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("monkeycode-uploads-{}-{nonce}-{seq}", std::process::id()));
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
        assert!(tmp.0.join(".monkeycode/uploads/big.bin.part").is_file(), "begin 未占位半成品");
        chunk(h, &b64(b"hello ")).unwrap();
        chunk(h, &b64(b"world")).unwrap();
        let out = finish(h).unwrap();
        assert_eq!(out["path"], ".monkeycode/uploads/big.bin");
        let dest = tmp.0.join(".monkeycode/uploads/big.bin");
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello world");
        assert!(!tmp.0.join(".monkeycode/uploads/big.bin.part").exists(), "半成品未清理");
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
        assert!(!tmp.0.join(".monkeycode/uploads/a.txt.part").exists(), "abort 未删半成品");
        abort(h1); // 幂等
    }

    /// 待办图片通道的底座:目录参数化 + 空 rel_prefix 时分块/直拷都回
    /// **裸文件名**(todos.rs 的命令面建立在这个语义上,存进 todos.json 的
    /// 就是它)。
    #[test]
    fn dir_parameterized_upload_returns_bare_names() {
        let tmp = TempDir::new();
        let dir = tmp.0.join("todo-uploads");
        std::fs::create_dir_all(&dir).unwrap();
        let h = begin_in_dir(dir.clone(), "", "shot.png", "image/png").unwrap();
        chunk(h, &b64(b"png-bytes")).unwrap();
        assert_eq!(finish(h).unwrap()["path"], "shot.png");
        assert_eq!(std::fs::read(dir.join("shot.png")).unwrap(), b"png-bytes");

        let src = tmp.0.join("photo.jpg");
        std::fs::write(&src, b"jpg").unwrap();
        let lossy = src.to_string_lossy();
        assert_eq!(save_from_path_in_dir(dir.clone(), "", &lossy).unwrap()["path"], "photo.jpg");
        // 重名让位与会话通道同一套
        assert_eq!(save_from_path_in_dir(dir, "", &lossy).unwrap()["path"], "photo-2.jpg");
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
        assert_eq!(std::fs::read(ws.join(".monkeycode/uploads/数据集.csv")).unwrap(), b"a,b\n1,2\n");

        let out2 = save_from_path(&workdir, None, &src.to_string_lossy()).unwrap();
        assert_eq!(out2["path"], ".monkeycode/uploads/数据集-2.csv");

        assert!(save_from_path(&workdir, None, &tmp.0.to_string_lossy()).is_err(), "目录必须拒绝");
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
        assert_eq!(v["data"], base64::engine::general_purpose::STANDARD.encode(b"fake-png"));

        // 非图片扩展名 MIME 置空(UI 侧按 [文件] 处理)
        let txt = tmp.0.join("notes.txt");
        std::fs::write(&txt, b"hi").unwrap();
        assert_eq!(read_dropped(&txt.to_string_lossy()).unwrap()["mediaType"], "");

        // 目录、不存在的路径、超限文件(sparse 快速置长)都拒绝
        assert!(read_dropped(&tmp.0.to_string_lossy()).unwrap_err().contains("目录"));
        assert!(read_dropped(&tmp.0.join("missing").to_string_lossy()).is_err());
        let big = tmp.0.join("big.bin");
        let f = std::fs::File::create(&big).unwrap();
        f.set_len(UPLOAD_MAX_BYTES as u64 + 1).unwrap();
        assert!(read_dropped(&big.to_string_lossy()).unwrap_err().contains("过大"));
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
