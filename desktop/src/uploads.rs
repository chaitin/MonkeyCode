// 对话附件上传/回读。落盘 <workdir>/.monkeycode/uploads/(会话工作区内,
// 模型经相对路径 Read 查看)。回读返回 data URL(Tauri 下 <img> 无法带鉴权头,
// 又不想开 asset scope 到任意工作区,小图 base64 内联最稳)。Markdown 里的
// 本地图片也走同一通道,但只放行工作区内的常见图片且限制体积。

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde_json::{json, Value};

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
        _ => None,
    }
}

/// 读取拖入窗口的本地文件(Linux 壳的原生拖放只给路径,拿不到内容):
/// 返回 {name, mediaType, data(base64)},UI 侧还原成 File 后走与 DOM 拖拽
/// 完全相同的附件上传管线。路径由用户拖拽动作产生,大小限制与上传一致。
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

/// 保存附件,返回 {path: 工作区相对路径}。
pub fn save(workdir: &str, wsl_distro: Option<&str>, name: &str, media_type: &str, data_b64: &str) -> Result<Value, String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|_| "文件数据无效".to_string())?;
    if raw.is_empty() {
        return Err("文件数据无效".into());
    }
    if raw.len() > UPLOAD_MAX_BYTES {
        return Err(format!("文件过大({} 字节,上限 {})", raw.len(), UPLOAD_MAX_BYTES));
    }

    let dir = uploads_dir(workdir, wsl_distro)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建上传目录失败: {e}"))?;
    // uploads 不入库:目录内放自免疫的 .gitignore(仅首次创建)
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        let _ = std::fs::write(&gi, "*\n");
    }

    // 命名:优先保留原始文件名(清洗后);无名(剪贴板截图)按时间戳
    let mut fname = sanitize_name(name).unwrap_or_else(|| {
        let (prefix, ext) = match image_ext(media_type) {
            Some(e) => ("img-", e),
            None => ("file-", ".bin"),
        };
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("{prefix}{ts}{ext}")
    });
    // 重名追加序号(插在扩展名前)
    let (stem, ext) = match fname.rfind('.') {
        Some(i) if i > 0 => (fname[..i].to_string(), fname[i..].to_string()),
        _ => (fname.clone(), String::new()),
    };
    let mut i = 2;
    while dir.join(&fname).exists() {
        fname = format!("{stem}-{i}{ext}");
        i += 1;
    }
    std::fs::write(dir.join(&fname), &raw).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(json!({ "path": format!(".monkeycode/uploads/{fname}") }))
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
        None => return Err("仅支持工作区内的 PNG、JPEG、GIF 或 WebP 图片".into()),
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
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("monkeycode-uploads-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// save_raw 是 pub 的,名字必须与 save() 同样清洗:未清洗时 join 遇到
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
