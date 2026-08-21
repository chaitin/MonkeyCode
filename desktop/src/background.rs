//! 应用内自定义背景资产服务。
//!
//! 只接受实际字节为 PNG/JPEG/WebP 的静态图片，将其复制到应用私有数据目录；
//! 元数据只保存受控 basename，读取时重新校验全部约束，绝不回读用户原路径。

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine as _;
use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

const METADATA_VERSION: u8 = 1;
const METADATA_FILE: &str = "current.v1.json";
const ASSETS_DIR: &str = "assets";
const MAX_BYTES: u64 = 20 * 1024 * 1024;
const MAX_EDGE: u32 = 16_384;
const MAX_PIXELS: u64 = 50_000_000;
const MAX_DECODE_ALLOC: u64 = 256 * 1024 * 1024;
static CLEAR_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundAsset {
    pub revision: String,
    pub original_name: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub data_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedMetadata {
    version: u8,
    revision: String,
    filename: String,
    original_name: String,
    mime: String,
    width: u32,
    height: u32,
    byte_length: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Kind {
    format: ImageFormat,
    mime: &'static str,
    extension: &'static str,
}

fn kind_for(format: ImageFormat) -> Result<Kind, String> {
    match format {
        ImageFormat::Png => Ok(Kind {
            format,
            mime: "image/png",
            extension: "png",
        }),
        ImageFormat::Jpeg => Ok(Kind {
            format,
            mime: "image/jpeg",
            extension: "jpg",
        }),
        ImageFormat::WebP => Ok(Kind {
            format,
            mime: "image/webp",
            extension: "webp",
        }),
        _ => Err("仅支持 PNG、JPEG 或 WebP 静态图片".into()),
    }
}

fn png_is_animated(bytes: &[u8]) -> bool {
    let mut offset = 8usize;
    while offset.checked_add(12).is_some_and(|end| end <= bytes.len()) {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        if &bytes[offset + 4..offset + 8] == b"acTL" {
            return true;
        }
        let Some(next) = offset
            .checked_add(12)
            .and_then(|base| base.checked_add(length))
        else {
            break;
        };
        if next > bytes.len() {
            break;
        }
        offset = next;
    }
    false
}

fn webp_is_animated(bytes: &[u8]) -> bool {
    let mut offset = 12usize;
    while offset.checked_add(8).is_some_and(|end| end <= bytes.len()) {
        let kind = &bytes[offset..offset + 4];
        if kind == b"ANIM" || kind == b"ANMF" {
            return true;
        }
        let length = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let Some(next) = offset
            .checked_add(8)
            .and_then(|base| base.checked_add(length + (length & 1)))
        else {
            break;
        };
        if next > bytes.len() {
            break;
        }
        offset = next;
    }
    false
}

fn inspect(bytes: &[u8]) -> Result<(Kind, u32, u32), String> {
    let format = image::guess_format(bytes)
        .map_err(|_| "无法识别图片格式，仅支持 PNG、JPEG 或 WebP".to_string())?;
    let kind = kind_for(format)?;
    // image::decode 对 APNG/animated WebP 可能只取首帧；首版只接受静态图，
    // 不能把“能解出第一帧”误判为静态。完整解码仍在下方负责结构校验。
    let animated = match format {
        ImageFormat::Png => png_is_animated(bytes),
        ImageFormat::WebP => webp_is_animated(bytes),
        _ => false,
    };
    if animated {
        return Err("不支持动态图片，请选择静态 PNG、JPEG 或 WebP".into());
    }
    let (width, height) = ImageReader::with_format(Cursor::new(bytes), kind.format)
        .into_dimensions()
        .map_err(|e| format!("无法解码图片: {e}"))?;
    if width == 0 || height == 0 {
        return Err("图片尺寸无效".into());
    }
    if width > MAX_EDGE || height > MAX_EDGE {
        return Err(format!("图片任一边不能超过 {MAX_EDGE} px"));
    }
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("图片总像素不能超过 50,000,000".into());
    }

    // 尺寸通过后再完整解码，既拒绝截断/损坏图片，也用显式分配上限防止压缩炸弹。
    let mut reader = ImageReader::with_format(Cursor::new(bytes), kind.format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    reader.decode().map_err(|e| format!("无法解码图片: {e}"))?;
    Ok((kind, width, height))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn background_dir(local_data_dir: &Path) -> PathBuf {
    local_data_dir.join("background")
}

fn expected_filename(revision: &str, kind: Kind) -> String {
    format!("{revision}.{}", kind.extension)
}

fn data_url(kind: Kind, bytes: &[u8]) -> String {
    format!(
        "data:{};base64,{}",
        kind.mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn validate_regular_file(path: &Path) -> Result<u64, String> {
    // symlink_metadata 不跟随链接：托管目录即使被本机其他进程篡改，也不能借
    // 软链接让 background_read 越出应用私有目录。
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("无法读取图片文件: {e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("请选择普通图片文件".into());
    }
    if metadata.len() > MAX_BYTES {
        return Err("图片文件不能超过 20 MiB".into());
    }
    Ok(metadata.len())
}

fn checked_background_dirs(
    local_data_dir: &Path,
    create: bool,
) -> Result<(PathBuf, PathBuf), String> {
    let root = background_dir(local_data_dir);
    for dir in [&root, &root.join(ASSETS_DIR)] {
        match fs::symlink_metadata(dir) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(format!("背景资产目录 {} 不安全", dir.display()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                fs::create_dir_all(dir)
                    .map_err(|e| format!("创建背景资产目录 {} 失败: {e}", dir.display()))?;
                let metadata = fs::symlink_metadata(dir)
                    .map_err(|e| format!("检查背景资产目录 {} 失败: {e}", dir.display()))?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(format!("背景资产目录 {} 不安全", dir.display()));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("检查背景资产目录 {} 失败: {error}", dir.display())),
        }
    }
    let assets = root.join(ASSETS_DIR);
    Ok((root, assets))
}

fn cleanup_assets(dir: &Path, keep: Option<&str>) {
    let Ok(entries) = fs::read_dir(dir.join(ASSETS_DIR)) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str());
        if path.is_file() && name != keep {
            let _ = fs::remove_file(path);
        }
    }
}

pub(crate) fn import_from(local_data_dir: &Path, source: &Path) -> Result<BackgroundAsset, String> {
    let declared_len = validate_regular_file(source)?;
    let bytes = fs::read(source).map_err(|e| format!("无法读取图片文件: {e}"))?;
    if bytes.len() as u64 != declared_len || bytes.len() as u64 > MAX_BYTES {
        return Err("图片文件读取期间发生变化或超过 20 MiB".into());
    }
    let (kind, width, height) = inspect(&bytes)?;
    let revision = sha256(&bytes);
    let filename = expected_filename(&revision, kind);
    let (root, assets_dir) = checked_background_dirs(local_data_dir, true)?;
    let asset_path = assets_dir.join(&filename);

    // 资产先落盘，元数据最后原子提交。任何前置失败都不会改变旧元数据。
    // 同 hash 文件也必须比对内容：托管副本可能被外部进程损坏或替换成
    // symlink；只看 is_file 会跳过修复，当前会话拿到好 data URL、下次启动却坏。
    let already_exact = fs::read(&asset_path).is_ok_and(|existing| existing == bytes);
    if !already_exact {
        crate::config::atomic_write_private(&asset_path, &bytes)?;
    }
    let original_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("background")
        .to_string();
    let metadata = ManagedMetadata {
        version: METADATA_VERSION,
        revision: revision.clone(),
        filename: filename.clone(),
        original_name: original_name.clone(),
        mime: kind.mime.into(),
        width,
        height,
        byte_length: bytes.len() as u64,
    };
    let encoded =
        serde_json::to_vec_pretty(&metadata).map_err(|e| format!("序列化背景元数据失败: {e}"))?;
    if let Err(error) = crate::config::atomic_write_private(&root.join(METADATA_FILE), &encoded) {
        // 新 revision 尚未成为权威资产，可以安全清掉；相同 revision 可能仍由旧元数据引用。
        let old_uses_asset = fs::read(root.join(METADATA_FILE))
            .ok()
            .and_then(|raw| serde_json::from_slice::<ManagedMetadata>(&raw).ok())
            .is_some_and(|old| old.filename == filename);
        if !old_uses_asset {
            let _ = fs::remove_file(&asset_path);
        }
        return Err(error);
    }
    cleanup_assets(&root, Some(&filename));
    Ok(BackgroundAsset {
        revision,
        original_name,
        mime: kind.mime.into(),
        width,
        height,
        data_url: data_url(kind, &bytes),
    })
}

pub(crate) fn read_from(local_data_dir: &Path) -> Result<Option<BackgroundAsset>, String> {
    let (root, _) = checked_background_dirs(local_data_dir, false)?;
    let metadata_path = root.join(METADATA_FILE);
    let raw = match fs::read(&metadata_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            cleanup_assets(&root, None);
            return Ok(None);
        }
        Err(error) => return Err(format!("读取背景元数据失败: {error}")),
    };
    let metadata: ManagedMetadata =
        serde_json::from_slice(&raw).map_err(|e| format!("背景元数据损坏: {e}"))?;
    if metadata.version != METADATA_VERSION {
        return Err(format!("不支持的背景元数据版本: {}", metadata.version));
    }
    if metadata.revision.len() != 64 || !metadata.revision.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("背景元数据中的 revision 无效".into());
    }
    let kind = match metadata.mime.as_str() {
        "image/png" => kind_for(ImageFormat::Png)?,
        "image/jpeg" => kind_for(ImageFormat::Jpeg)?,
        "image/webp" => kind_for(ImageFormat::WebP)?,
        _ => return Err("背景元数据中的图片格式不受支持".into()),
    };
    let expected = expected_filename(&metadata.revision, kind);
    let basename_ok = Path::new(&metadata.filename)
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n == metadata.filename);
    if !basename_ok || metadata.filename != expected {
        return Err("背景元数据中的资产路径无效".into());
    }
    let asset_path = root.join(ASSETS_DIR).join(&metadata.filename);
    let len = validate_regular_file(&asset_path).map_err(|e| format!("背景图片不可用: {e}"))?;
    if len != metadata.byte_length {
        return Err("背景图片长度与元数据不一致".into());
    }
    let bytes = fs::read(&asset_path).map_err(|e| format!("读取背景图片失败: {e}"))?;
    let (actual_kind, width, height) = inspect(&bytes)?;
    if actual_kind != kind || width != metadata.width || height != metadata.height {
        return Err("背景图片格式或尺寸与元数据不一致".into());
    }
    if sha256(&bytes) != metadata.revision {
        return Err("背景图片内容校验失败".into());
    }
    cleanup_assets(&root, Some(&metadata.filename));
    Ok(Some(BackgroundAsset {
        revision: metadata.revision,
        original_name: metadata.original_name,
        mime: metadata.mime,
        width,
        height,
        data_url: data_url(kind, &bytes),
    }))
}

pub(crate) fn clear_from(local_data_dir: &Path) -> Result<(), String> {
    let (root, _) = checked_background_dirs(local_data_dir, false)?;
    let metadata = root.join(METADATA_FILE);
    let tombstone = root.join(format!(
        ".{METADATA_FILE}.clear-{}-{}",
        std::process::id(),
        CLEAR_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    match fs::rename(&metadata, &tombstone) {
        Ok(()) => {
            let _ = fs::remove_file(&tombstone);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("清除背景元数据失败: {error}")),
    }
    cleanup_assets(&root, None);
    Ok(())
}

#[tauri::command]
pub fn background_import(app: AppHandle, path: String) -> Result<BackgroundAsset, String> {
    let dir = crate::config::local_data_dir(&app)?;
    import_from(&dir, Path::new(&path))
}

#[tauri::command]
pub fn background_read(app: AppHandle) -> Result<Option<BackgroundAsset>, String> {
    let dir = crate::config::local_data_dir(&app)?;
    read_from(&dir)
}

#[tauri::command]
pub fn background_clear(app: AppHandle) -> Result<(), String> {
    let dir = crate::config::local_data_dir(&app)?;
    clear_from(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, Rgb};

    static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mc-background-test-{}-{}",
                std::process::id(),
                NEXT_DIR.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn encoded(format: ImageFormat, color: [u8; 3]) -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 1, Rgb(color)));
        let mut cursor = Cursor::new(Vec::new());
        image.write_to(&mut cursor, format).unwrap();
        cursor.into_inner()
    }

    fn write_source(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for &byte in bytes {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb8_8320u32 & (0u32.wrapping_sub(crc & 1)));
            }
        }
        !crc
    }

    fn png_with_header_dimensions(width: u32, height: u32) -> Vec<u8> {
        let mut out = encoded(ImageFormat::Png, [1, 2, 3]);
        out[16..20].copy_from_slice(&width.to_be_bytes());
        out[20..24].copy_from_slice(&height.to_be_bytes());
        let crc = crc32(&out[12..29]);
        out[29..33].copy_from_slice(&crc.to_be_bytes());
        out
    }

    #[test]
    fn supported_formats_use_actual_bytes_and_control_data_url_mime() {
        for (format, mime, fake_name) in [
            (ImageFormat::Png, "image/png", "fake.jpg"),
            (ImageFormat::Jpeg, "image/jpeg", "fake.webp"),
            (ImageFormat::WebP, "image/webp", "fake.png"),
        ] {
            let dir = TestDir::new();
            let source = write_source(&dir.0, fake_name, &encoded(format, [1, 2, 3]));
            let asset = import_from(&dir.0, &source).unwrap();
            assert_eq!(asset.mime, mime);
            assert!(asset.data_url.starts_with(&format!("data:{mime};base64,")));
            assert_eq!(read_from(&dir.0).unwrap(), Some(asset));
        }
    }

    #[test]
    fn rejects_unsupported_truncated_and_too_large_files_without_replacing_old() {
        let dir = TestDir::new();
        let good = write_source(&dir.0, "good.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        let old = import_from(&dir.0, &good).unwrap();
        for (name, bytes) in [
            ("fake.png", b"not an image".to_vec()),
            (
                "cut.png",
                encoded(ImageFormat::Png, [4, 5, 6])[..20].to_vec(),
            ),
        ] {
            let source = write_source(&dir.0, name, &bytes);
            assert!(import_from(&dir.0, &source).is_err());
            assert_eq!(read_from(&dir.0).unwrap(), Some(old.clone()));
        }
        let huge = write_source(&dir.0, "huge.png", &vec![0; MAX_BYTES as usize + 1]);
        assert!(import_from(&dir.0, &huge).unwrap_err().contains("20 MiB"));
        assert_eq!(read_from(&dir.0).unwrap(), Some(old));
    }

    #[test]
    fn rejects_edge_and_pixel_limits_before_full_decode() {
        let dir = TestDir::new();
        let edge = write_source(
            &dir.0,
            "edge.png",
            &png_with_header_dimensions(MAX_EDGE + 1, 1),
        );
        let edge_error = import_from(&dir.0, &edge).unwrap_err();
        assert!(edge_error.contains("16384"), "{edge_error}");
        let pixels = write_source(
            &dir.0,
            "pixels.png",
            &png_with_header_dimensions(10_000, 5_001),
        );
        let pixel_error = import_from(&dir.0, &pixels).unwrap_err();
        assert!(pixel_error.contains("50,000,000"), "{pixel_error}");
    }

    #[test]
    fn animation_markers_are_rejected_as_non_static() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(&8u32.to_be_bytes());
        png.extend_from_slice(b"acTL");
        png.extend_from_slice(&[0; 8]);
        png.extend_from_slice(&0u32.to_be_bytes());
        assert!(png_is_animated(&png));

        let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
        webp.extend_from_slice(b"ANIM");
        webp.extend_from_slice(&0u32.to_le_bytes());
        assert!(webp_is_animated(&webp));
    }

    #[test]
    fn second_import_atomically_replaces_metadata_and_cleans_old_asset() {
        let dir = TestDir::new();
        let a = write_source(&dir.0, "a.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        let first = import_from(&dir.0, &a).unwrap();
        let b = write_source(&dir.0, "b.jpg", &encoded(ImageFormat::Jpeg, [9, 8, 7]));
        let second = import_from(&dir.0, &b).unwrap();
        assert_ne!(first.revision, second.revision);
        assert_eq!(read_from(&dir.0).unwrap(), Some(second));
        let assets: Vec<_> = fs::read_dir(background_dir(&dir.0).join(ASSETS_DIR))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(assets.len(), 1);
    }

    #[test]
    fn invalid_metadata_path_version_missing_asset_and_hash_are_rejected() {
        let cases = [
            (
                "path",
                serde_json::json!({"version":1,"revision":"a".repeat(64),"filename":"../x.png","originalName":"x","mime":"image/png","width":1,"height":1,"byteLength":1}),
            ),
            (
                "version",
                serde_json::json!({"version":2,"revision":"a".repeat(64),"filename":format!("{}.png", "a".repeat(64)),"originalName":"x","mime":"image/png","width":1,"height":1,"byteLength":1}),
            ),
        ];
        for (_, metadata) in cases {
            let dir = TestDir::new();
            crate::config::atomic_write_private(
                &background_dir(&dir.0).join(METADATA_FILE),
                serde_json::to_string(&metadata).unwrap().as_bytes(),
            )
            .unwrap();
            assert!(read_from(&dir.0).is_err());
        }
        let corrupt = TestDir::new();
        crate::config::atomic_write_private(&background_dir(&corrupt.0).join(METADATA_FILE), b"{")
            .unwrap();
        assert!(read_from(&corrupt.0).unwrap_err().contains("损坏"));

        let dir = TestDir::new();
        let source = write_source(&dir.0, "x.png", &encoded(ImageFormat::Png, [1, 1, 1]));
        let asset = import_from(&dir.0, &source).unwrap();
        let asset_path = background_dir(&dir.0)
            .join(ASSETS_DIR)
            .join(format!("{}.png", asset.revision));
        fs::remove_file(&asset_path).unwrap();
        assert!(read_from(&dir.0).is_err());
        import_from(&dir.0, &source).unwrap();
        fs::write(&asset_path, encoded(ImageFormat::Png, [2, 2, 2])).unwrap();
        assert!(read_from(&dir.0).is_err());
        // 重新选择同一张原图必须修复同 hash 路径，不能因文件名已存在而跳过。
        import_from(&dir.0, &source).unwrap();
        assert_eq!(read_from(&dir.0).unwrap().unwrap().revision, asset.revision);
    }

    #[test]
    fn clear_is_idempotent() {
        let dir = TestDir::new();
        let source = write_source(&dir.0, "x.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        import_from(&dir.0, &source).unwrap();
        clear_from(&dir.0).unwrap();
        clear_from(&dir.0).unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn failed_replacement_and_symlinked_managed_directory_cannot_escape_or_lose_old_asset() {
        use std::os::unix::fs::{symlink, PermissionsExt as _};

        let dir = TestDir::new();
        let first_source = write_source(&dir.0, "first.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        let first = import_from(&dir.0, &first_source).unwrap();
        let assets = background_dir(&dir.0).join(ASSETS_DIR);
        fs::set_permissions(&assets, fs::Permissions::from_mode(0o500)).unwrap();
        let second_source =
            write_source(&dir.0, "second.png", &encoded(ImageFormat::Png, [4, 5, 6]));
        assert!(import_from(&dir.0, &second_source).is_err());
        fs::set_permissions(&assets, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), Some(first));

        clear_from(&dir.0).unwrap();
        fs::remove_dir_all(background_dir(&dir.0)).unwrap();
        let outside = dir.0.join("outside");
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, background_dir(&dir.0)).unwrap();
        assert!(read_from(&dir.0).unwrap_err().contains("不安全"));
    }
}
