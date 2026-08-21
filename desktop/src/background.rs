//! 应用内自定义背景资产服务。
//!
//! 只接受实际字节为 PNG/JPEG/WebP 的静态图片，将其复制到应用私有数据目录；
//! 元数据只保存受控 basename，读取时重新校验全部约束，绝不回读用户原路径。

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

const METADATA_VERSION: u8 = 1;
const PENDING_ENVELOPE_VERSION: u8 = 1;
const METADATA_FILE: &str = "current.v1.json";
const ASSETS_DIR: &str = "assets";
const PENDING_DIR: &str = "pending";
const LOCK_FILE: &str = ".asset.lock";
const MAX_BYTES: u64 = 20 * 1024 * 1024;
const MAX_EDGE: u32 = 16_384;
const MAX_PIXELS: u64 = 50_000_000;
const MAX_DECODE_ALLOC: u64 = 256 * 1024 * 1024;
// WebView 正常预解码只需很短时间；保留一天避免误删仍在确认中的跨进程导入，
// 同时让崩溃、重载或 IPC 响应丢失留下的 pending 最终可回收。
const PENDING_TTL: Duration = Duration::from_secs(24 * 60 * 60);
static CLEAR_SEQ: AtomicU64 = AtomicU64::new(0);
static ASSET_MUTEX: Mutex<()> = Mutex::new(());

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedBackgroundAsset {
    #[serde(flatten)]
    pub asset: BackgroundAsset,
    pub staged_id: String,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingEnvelope {
    version: u8,
    owner_token: String,
    metadata: ManagedMetadata,
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

fn read_limited(mut reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("无法读取图片文件: {e}"))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("图片文件不能超过 20 MiB".into());
    }
    Ok(bytes)
}

fn read_regular_file(path: &Path) -> Result<Vec<u8>, String> {
    let declared_len = validate_regular_file(path)?;
    let file = File::open(path).map_err(|e| format!("无法读取图片文件: {e}"))?;
    let opened = file
        .metadata()
        .map_err(|e| format!("无法读取图片文件元数据: {e}"))?;
    if !opened.is_file() || opened.len() > MAX_BYTES {
        return Err("请选择不超过 20 MiB 的普通图片文件".into());
    }
    let bytes = read_limited(file)?;
    if bytes.len() as u64 != declared_len || bytes.len() as u64 != opened.len() {
        return Err("图片文件读取期间发生变化或超过 20 MiB".into());
    }
    Ok(bytes)
}

fn checked_background_dirs(
    local_data_dir: &Path,
    create: bool,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let root = background_dir(local_data_dir);
    for dir in [&root, &root.join(ASSETS_DIR), &root.join(PENDING_DIR)] {
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
    let pending = root.join(PENDING_DIR);
    Ok((root, assets, pending))
}

fn with_asset_lock<T>(
    local_data_dir: &Path,
    action: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    // 文件锁负责跨进程，Mutex 负责同一进程中各 blocking worker（部分平台的
    // advisory lock 对同进程多个 fd 不互斥）。panic 后仍恢复 guard。
    let _process_guard = ASSET_MUTEX
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (root, _, _) = checked_background_dirs(local_data_dir, true)?;
    let lock_path = root.join(LOCK_FILE);
    if let Ok(metadata) = fs::symlink_metadata(&lock_path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("背景资产锁文件不安全".into());
        }
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)
        .map_err(|e| format!("打开背景资产锁失败: {e}"))?;
    lock.lock().map_err(|e| format!("锁定背景资产失败: {e}"))?;
    action(&root)
}

fn metadata_filename(metadata: &ManagedMetadata) -> Option<String> {
    let basename = Path::new(&metadata.filename)
        .file_name()
        .and_then(|name| name.to_str())?;
    (basename == metadata.filename).then(|| metadata.filename.clone())
}

fn pending_metadata_filename(raw: &[u8]) -> Option<String> {
    let pending: PendingEnvelope = serde_json::from_slice(raw).ok()?;
    (pending.version == PENDING_ENVELOPE_VERSION && valid_owner_token(&pending.owner_token))
        .then_some(())?;
    metadata_filename(&pending.metadata)
}

fn pending_is_expired(path: &Path, now: SystemTime) -> bool {
    // symlink_metadata 不跟随链接；时钟回拨或无法读取 mtime 时宁可延后回收。
    fs::symlink_metadata(path)
        .ok()
        .filter(|metadata| !metadata.file_type().is_symlink() && metadata.is_file())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| now.duration_since(modified).ok())
        .is_some_and(|age| age >= PENDING_TTL)
}

/// 必须在持有跨进程资产锁时调用。保留集始终从锁内的当前元数据和所有未过期
/// 待确认元数据重新推导，绝不使用某次导入开始时捕获的过期 keep。
fn cleanup_assets_locked_at(root: &Path, now: SystemTime) {
    let mut keep = HashSet::new();
    let pending_dir = root.join(PENDING_DIR);
    let entries = match fs::read_dir(&pending_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => return,
        };
        if file_type.is_symlink() || !file_type.is_file() {
            continue;
        }
        if pending_is_expired(&path, now) {
            match fs::remove_file(&path) {
                Ok(()) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                // 删除失败时仍按有效 pending 处理，绝不能误删它引用的资产。
                Err(_) => {}
            }
        }
        let raw = match fs::read(&path) {
            Ok(raw) => raw,
            Err(_) => return,
        };
        match pending_metadata_filename(&raw) {
            Some(filename) => {
                keep.insert(filename);
            }
            None => return,
        }
    }

    let current = root.join(METADATA_FILE);
    match fs::read(&current) {
        Ok(raw) => match serde_json::from_slice::<ManagedMetadata>(&raw)
            .ok()
            .and_then(|metadata| metadata_filename(&metadata))
        {
            Some(filename) => {
                keep.insert(filename);
            }
            // 当前权威元数据存在却无法解析时，宁可暂留孤儿也不能误删它可能引用的资产。
            None => return,
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return,
    }

    let Ok(entries) = fs::read_dir(root.join(ASSETS_DIR)) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name();
        if !file_type.is_dir() && !keep.contains(name.to_string_lossy().as_ref()) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn cleanup_assets_locked(root: &Path) {
    cleanup_assets_locked_at(root, SystemTime::now());
}

fn managed_file_is_exact(path: &Path, expected: &[u8]) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() != expected.len() as u64
    {
        return false;
    }
    let Ok(existing) = read_regular_file(path) else {
        return false;
    };
    existing == expected
        && fs::symlink_metadata(path)
            .is_ok_and(|after| !after.file_type().is_symlink() && after.is_file())
}

fn valid_staged_id(staged_id: &str) -> bool {
    !staged_id.is_empty()
        && staged_id.len() <= 160
        && staged_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_owner_token(owner_token: &str) -> bool {
    owner_token.len() == 64 && owner_token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn pending_path(root: &Path, staged_id: &str) -> Result<PathBuf, String> {
    if !valid_staged_id(staged_id) {
        return Err("待确认背景标识无效".into());
    }
    Ok(root.join(PENDING_DIR).join(format!("{staged_id}.json")))
}

pub(crate) fn stage_from(
    local_data_dir: &Path,
    source: &Path,
    staged_id: &str,
    owner_token: &str,
) -> Result<StagedBackgroundAsset, String> {
    // 调用方必须在 invoke 前就知道该 ID，才能在响应丢失时仍可 discard。
    // 在读取/解码大文件前拒绝路径型或超长 ID。
    if !valid_staged_id(staged_id) {
        return Err("待确认背景标识无效".into());
    }
    if !valid_owner_token(owner_token) {
        return Err("待确认背景所有权令牌无效".into());
    }
    // 大文件读取本身也必须有硬上限，不能只信打开前的一次 metadata。
    let bytes = read_regular_file(source)?;
    let (kind, width, height) = inspect(&bytes)?;
    let revision = sha256(&bytes);
    let filename = expected_filename(&revision, kind);
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
    let pending_envelope = PendingEnvelope {
        version: PENDING_ENVELOPE_VERSION,
        owner_token: owner_token.to_string(),
        metadata,
    };
    let encoded = serde_json::to_vec_pretty(&pending_envelope)
        .map_err(|e| format!("序列化待确认背景元数据失败: {e}"))?;

    with_asset_lock(local_data_dir, |root| {
        cleanup_assets_locked(root);
        let pending = pending_path(root, staged_id)?;
        // 所有 MonkeyCode 进程都在同一文件锁内做存在性检查与写入；调用方 ID
        // 冲突时绝不覆盖另一进程仍可能预解码/确认的事务。
        match fs::symlink_metadata(&pending) {
            Ok(_) => return Err("待确认背景标识已存在，请重试".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("检查待确认背景标识失败: {error}")),
        }
        let asset_path = root.join(ASSETS_DIR).join(&filename);
        // 判等前后都确认路径是普通非 symlink 文件；否则即使链接目标字节等值，
        // 也必须用原子替换恢复为真正的托管副本。
        if !managed_file_is_exact(&asset_path, &bytes) {
            crate::config::atomic_write_private(&asset_path, &bytes)?;
        }
        if let Err(error) = crate::config::atomic_write_private(&pending, &encoded) {
            cleanup_assets_locked(root);
            return Err(error);
        }
        cleanup_assets_locked(root);
        Ok(())
    })?;

    Ok(StagedBackgroundAsset {
        asset: BackgroundAsset {
            revision,
            original_name,
            mime: kind.mime.into(),
            width,
            height,
            data_url: data_url(kind, &bytes),
        },
        staged_id: staged_id.to_string(),
    })
}

fn asset_from_metadata(root: &Path, metadata: ManagedMetadata) -> Result<BackgroundAsset, String> {
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
    let bytes = read_regular_file(&asset_path).map_err(|e| format!("读取背景图片失败: {e}"))?;
    let (actual_kind, width, height) = inspect(&bytes)?;
    if actual_kind != kind || width != metadata.width || height != metadata.height {
        return Err("背景图片格式或尺寸与元数据不一致".into());
    }
    if sha256(&bytes) != metadata.revision {
        return Err("背景图片内容校验失败".into());
    }
    Ok(BackgroundAsset {
        revision: metadata.revision,
        original_name: metadata.original_name,
        mime: metadata.mime,
        width,
        height,
        data_url: data_url(kind, &bytes),
    })
}

pub(crate) fn confirm_from(
    local_data_dir: &Path,
    staged_id: &str,
    owner_token: &str,
) -> Result<(), String> {
    if !valid_owner_token(owner_token) {
        return Err("待确认背景所有权令牌无效".into());
    }
    with_asset_lock(local_data_dir, |root| {
        let path = pending_path(root, staged_id)?;
        let raw = fs::read(&path).map_err(|e| format!("读取待确认背景失败: {e}"))?;
        let pending: PendingEnvelope =
            serde_json::from_slice(&raw).map_err(|e| format!("待确认背景元数据损坏: {e}"))?;
        if pending.version != PENDING_ENVELOPE_VERSION || pending.owner_token != owner_token {
            return Err("待确认背景事务所有权不匹配".into());
        }
        // 提交前重新验证托管资产，不能信任预解码期间一直未被篡改。
        asset_from_metadata(root, pending.metadata.clone())?;
        let metadata = serde_json::to_vec_pretty(&pending.metadata)
            .map_err(|e| format!("序列化背景元数据失败: {e}"))?;
        crate::config::atomic_write_private(&root.join(METADATA_FILE), &metadata)?;
        let _ = fs::remove_file(path);
        cleanup_assets_locked(root);
        Ok(())
    })
}

pub(crate) fn discard_from(
    local_data_dir: &Path,
    staged_id: &str,
    owner_token: &str,
) -> Result<(), String> {
    if !valid_owner_token(owner_token) {
        return Err("待确认背景所有权令牌无效".into());
    }
    with_asset_lock(local_data_dir, |root| {
        let path = pending_path(root, staged_id)?;
        let raw = match fs::read(&path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("读取待丢弃背景失败: {error}")),
        };
        let pending: PendingEnvelope =
            serde_json::from_slice(&raw).map_err(|e| format!("待确认背景元数据损坏: {e}"))?;
        if pending.version != PENDING_ENVELOPE_VERSION || pending.owner_token != owner_token {
            return Err("待确认背景事务所有权不匹配".into());
        }
        fs::remove_file(path).map_err(|error| format!("丢弃待确认背景失败: {error}"))?;
        cleanup_assets_locked(root);
        Ok(())
    })
}

pub(crate) fn read_from(local_data_dir: &Path) -> Result<Option<BackgroundAsset>, String> {
    with_asset_lock(local_data_dir, |root| {
        let metadata_path = root.join(METADATA_FILE);
        let raw = match fs::read(&metadata_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                cleanup_assets_locked(root);
                return Ok(None);
            }
            Err(error) => return Err(format!("读取背景元数据失败: {error}")),
        };
        let metadata: ManagedMetadata =
            serde_json::from_slice(&raw).map_err(|e| format!("背景元数据损坏: {e}"))?;
        let asset = asset_from_metadata(root, metadata)?;
        cleanup_assets_locked(root);
        Ok(Some(asset))
    })
}

pub(crate) fn clear_from(local_data_dir: &Path) -> Result<(), String> {
    with_asset_lock(local_data_dir, |root| {
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
        // clear 同时使尚未确认的旧选择失效，防止其稍后复活已清除背景。
        if let Ok(entries) = fs::read_dir(root.join(PENDING_DIR)) {
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|kind| !kind.is_dir()) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        cleanup_assets_locked(root);
        Ok(())
    })
}

#[tauri::command]
pub async fn background_import(
    app: AppHandle,
    path: String,
    staged_id: String,
    owner_token: String,
) -> Result<StagedBackgroundAsset, String> {
    let dir = crate::config::local_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        stage_from(&dir, Path::new(&path), &staged_id, &owner_token)
    })
    .await
    .map_err(|e| format!("背景导入任务失败: {e}"))?
}

#[tauri::command]
pub async fn background_confirm(
    app: AppHandle,
    staged_id: String,
    owner_token: String,
) -> Result<(), String> {
    let dir = crate::config::local_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || confirm_from(&dir, &staged_id, &owner_token))
        .await
        .map_err(|e| format!("背景确认任务失败: {e}"))?
}

#[tauri::command]
pub async fn background_discard(
    app: AppHandle,
    staged_id: String,
    owner_token: String,
) -> Result<(), String> {
    let dir = crate::config::local_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || discard_from(&dir, &staged_id, &owner_token))
        .await
        .map_err(|e| format!("背景丢弃任务失败: {e}"))?
}

#[tauri::command]
pub async fn background_read(app: AppHandle) -> Result<Option<BackgroundAsset>, String> {
    let dir = crate::config::local_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_from(&dir))
        .await
        .map_err(|e| format!("背景读取任务失败: {e}"))?
}

#[tauri::command]
pub async fn background_clear(app: AppHandle) -> Result<(), String> {
    let dir = crate::config::local_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || clear_from(&dir))
        .await
        .map_err(|e| format!("背景清除任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, Rgb};

    static NEXT_DIR: AtomicU64 = AtomicU64::new(0);
    static NEXT_STAGE: AtomicU64 = AtomicU64::new(0);
    const TEST_OWNER_TOKEN: &str =
        "0000000000000000000000000000000000000000000000000000000000000001";
    const OTHER_OWNER_TOKEN: &str =
        "0000000000000000000000000000000000000000000000000000000000000002";

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

    fn stage(local_data_dir: &Path, source: &Path) -> Result<StagedBackgroundAsset, String> {
        let staged_id = format!(
            "test-{}-{}",
            std::process::id(),
            NEXT_STAGE.fetch_add(1, Ordering::Relaxed)
        );
        stage_from(local_data_dir, source, &staged_id, TEST_OWNER_TOKEN)
    }

    fn import_and_confirm(local_data_dir: &Path, source: &Path) -> Result<BackgroundAsset, String> {
        let staged = stage(local_data_dir, source)?;
        confirm_from(local_data_dir, &staged.staged_id, TEST_OWNER_TOKEN)?;
        Ok(staged.asset)
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
            let asset = import_and_confirm(&dir.0, &source).unwrap();
            assert_eq!(asset.mime, mime);
            assert!(asset.data_url.starts_with(&format!("data:{mime};base64,")));
            assert_eq!(read_from(&dir.0).unwrap(), Some(asset));
        }
    }

    #[test]
    fn rejects_unsupported_truncated_and_too_large_files_without_replacing_old() {
        let dir = TestDir::new();
        let good = write_source(&dir.0, "good.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        let old = import_and_confirm(&dir.0, &good).unwrap();
        for (name, bytes) in [
            ("fake.png", b"not an image".to_vec()),
            (
                "cut.png",
                encoded(ImageFormat::Png, [4, 5, 6])[..20].to_vec(),
            ),
        ] {
            let source = write_source(&dir.0, name, &bytes);
            assert!(import_and_confirm(&dir.0, &source).is_err());
            assert_eq!(read_from(&dir.0).unwrap(), Some(old.clone()));
        }
        let huge = write_source(&dir.0, "huge.png", &vec![0; MAX_BYTES as usize + 1]);
        assert!(import_and_confirm(&dir.0, &huge)
            .unwrap_err()
            .contains("20 MiB"));
        assert_eq!(read_from(&dir.0).unwrap(), Some(old));
    }

    #[test]
    fn bounded_reader_stops_after_limit_plus_one_byte() {
        struct EndlessZeros {
            read: u64,
        }
        impl Read for EndlessZeros {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                buffer.fill(0);
                self.read += buffer.len() as u64;
                Ok(buffer.len())
            }
        }

        let mut reader = EndlessZeros { read: 0 };
        assert!(read_limited(&mut reader).unwrap_err().contains("20 MiB"));
        assert!(reader.read <= MAX_BYTES + 1);
    }

    #[test]
    fn rejects_edge_and_pixel_limits_before_full_decode() {
        let dir = TestDir::new();
        let edge = write_source(
            &dir.0,
            "edge.png",
            &png_with_header_dimensions(MAX_EDGE + 1, 1),
        );
        let edge_error = import_and_confirm(&dir.0, &edge).unwrap_err();
        assert!(edge_error.contains("16384"), "{edge_error}");
        let pixels = write_source(
            &dir.0,
            "pixels.png",
            &png_with_header_dimensions(10_000, 5_001),
        );
        let pixel_error = import_and_confirm(&dir.0, &pixels).unwrap_err();
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
        let first = import_and_confirm(&dir.0, &a).unwrap();
        let b = write_source(&dir.0, "b.jpg", &encoded(ImageFormat::Jpeg, [9, 8, 7]));
        let second = import_and_confirm(&dir.0, &b).unwrap();
        assert_ne!(first.revision, second.revision);
        assert_eq!(read_from(&dir.0).unwrap(), Some(second));
        let assets: Vec<_> = fs::read_dir(background_dir(&dir.0).join(ASSETS_DIR))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(assets.len(), 1);
    }

    #[test]
    fn staged_import_preserves_current_until_confirm_and_discard_rolls_back() {
        let dir = TestDir::new();
        let old_source = write_source(&dir.0, "old.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        let old = import_and_confirm(&dir.0, &old_source).unwrap();
        let next_source = write_source(&dir.0, "next.png", &encoded(ImageFormat::Png, [4, 5, 6]));

        let rejected = stage(&dir.0, &next_source).unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), Some(old.clone()));
        discard_from(&dir.0, &rejected.staged_id, TEST_OWNER_TOKEN).unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), Some(old.clone()));

        let accepted = stage(&dir.0, &next_source).unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), Some(old));
        confirm_from(&dir.0, &accepted.staged_id, TEST_OWNER_TOKEN).unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), Some(accepted.asset));
    }

    #[test]
    fn id_collision_cannot_discard_or_confirm_another_owners_pending_transaction() {
        let dir = TestDir::new();
        let first_bytes = encoded(ImageFormat::Png, [1, 2, 3]);
        let first_source = write_source(&dir.0, "first.png", &first_bytes);
        let second_bytes = encoded(ImageFormat::Png, [9, 8, 7]);
        let second_source = write_source(&dir.0, "second.png", &second_bytes);

        for invalid in ["", "../escape", "slash/id", "下", &"a".repeat(161)] {
            let error = stage_from(&dir.0, &first_source, invalid, TEST_OWNER_TOKEN).unwrap_err();
            assert!(error.contains("标识无效"), "{error}");
        }

        let first = stage_from(&dir.0, &first_source, "web-fixed-id", TEST_OWNER_TOKEN).unwrap();
        assert_eq!(first.staged_id, "web-fixed-id");
        assert!(stage_from(&dir.0, &second_source, "web-fixed-id", OTHER_OWNER_TOKEN,).is_err());

        // 串联复现：B 的 import 因撞到 A 的 ID 失败，随后 catch 中携 B token 的
        // discard/confirm 都不能删除或提交 A 的 pending；测试不识别任何错误文案。
        assert!(discard_from(&dir.0, "web-fixed-id", OTHER_OWNER_TOKEN).is_err());
        assert!(confirm_from(&dir.0, "web-fixed-id", OTHER_OWNER_TOKEN).is_err());
        assert!(pending_path(&background_dir(&dir.0), "web-fixed-id")
            .unwrap()
            .exists());
        assert_eq!(read_from(&dir.0).unwrap(), None);

        // A 仍持有 token，响应丢失后可主动回收。随后复用已释放 ID 再导入、确认。
        discard_from(&dir.0, "web-fixed-id", TEST_OWNER_TOKEN).unwrap();
        assert!(!pending_path(&background_dir(&dir.0), "web-fixed-id")
            .unwrap()
            .exists());
        let retried = stage_from(&dir.0, &first_source, "web-fixed-id", TEST_OWNER_TOKEN).unwrap();
        assert_eq!(retried.asset, first.asset);
        confirm_from(&dir.0, "web-fixed-id", TEST_OWNER_TOKEN).unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), Some(retried.asset));
        // 第二份资产未因冲突被落盘。
        assert!(!background_dir(&dir.0)
            .join(ASSETS_DIR)
            .join(format!("{}.png", sha256(&second_bytes)))
            .exists());
    }

    #[test]
    fn cleanup_keeps_short_pending_but_expires_abandoned_pending_and_orphan_assets() {
        let dir = TestDir::new();
        let orphan_source =
            write_source(&dir.0, "orphan.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        let orphan = stage_from(&dir.0, &orphan_source, "orphan-stage", TEST_OWNER_TOKEN).unwrap();
        let root = background_dir(&dir.0);
        let orphan_pending = pending_path(&root, "orphan-stage").unwrap();
        let now = SystemTime::now();

        with_asset_lock(&dir.0, |root| {
            cleanup_assets_locked_at(root, now + PENDING_TTL / 2);
            Ok(())
        })
        .unwrap();
        assert!(orphan_pending.exists());

        let current_source =
            write_source(&dir.0, "current.png", &encoded(ImageFormat::Png, [7, 8, 9]));
        let current = import_and_confirm(&dir.0, &current_source).unwrap();
        // 同一 current 资产也被另一个 abandoned pending 引用；过期只能删 pending，
        // 不能删仍由权威元数据引用的共享资产。
        stage_from(&dir.0, &current_source, "shared-stage", TEST_OWNER_TOKEN).unwrap();

        with_asset_lock(&dir.0, |root| {
            cleanup_assets_locked_at(root, now + PENDING_TTL * 2);
            Ok(())
        })
        .unwrap();
        assert!(!orphan_pending.exists());
        assert!(!pending_path(&root, "shared-stage").unwrap().exists());
        assert!(!root
            .join(ASSETS_DIR)
            .join(format!("{}.png", orphan.asset.revision))
            .exists());
        assert_eq!(read_from(&dir.0).unwrap(), Some(current));
    }

    #[test]
    fn cleanup_reloads_authoritative_metadata_instead_of_using_stale_keep() {
        let dir = TestDir::new();
        let a = write_source(&dir.0, "a.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        let first = import_and_confirm(&dir.0, &a).unwrap();
        let b = write_source(&dir.0, "b.png", &encoded(ImageFormat::Png, [7, 8, 9]));
        let current = import_and_confirm(&dir.0, &b).unwrap();

        // 模拟旧导入在新元数据提交后才开始清理。清理函数没有 keep 参数，
        // 必须重新读取 current.v1.json，因此只能保留 current。
        with_asset_lock(&dir.0, |root| {
            cleanup_assets_locked(root);
            Ok(())
        })
        .unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), Some(current.clone()));
        assert!(!background_dir(&dir.0)
            .join(ASSETS_DIR)
            .join(format!("{}.png", first.revision))
            .exists());
        assert!(background_dir(&dir.0)
            .join(ASSETS_DIR)
            .join(format!("{}.png", current.revision))
            .exists());
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
        let asset = import_and_confirm(&dir.0, &source).unwrap();
        let asset_path = background_dir(&dir.0)
            .join(ASSETS_DIR)
            .join(format!("{}.png", asset.revision));
        fs::remove_file(&asset_path).unwrap();
        assert!(read_from(&dir.0).is_err());
        import_and_confirm(&dir.0, &source).unwrap();
        fs::write(&asset_path, encoded(ImageFormat::Png, [2, 2, 2])).unwrap();
        assert!(read_from(&dir.0).is_err());
        // 重新选择同一张原图必须修复同 hash 路径，不能因文件名已存在而跳过。
        import_and_confirm(&dir.0, &source).unwrap();
        assert_eq!(read_from(&dir.0).unwrap().unwrap().revision, asset.revision);
    }

    #[test]
    fn clear_is_idempotent() {
        let dir = TestDir::new();
        let source = write_source(&dir.0, "x.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        import_and_confirm(&dir.0, &source).unwrap();
        clear_from(&dir.0).unwrap();
        clear_from(&dir.0).unwrap();
        assert_eq!(read_from(&dir.0).unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn equal_symlinked_managed_asset_is_atomically_rewritten_as_regular_file() {
        use std::os::unix::fs::symlink;

        let dir = TestDir::new();
        let bytes = encoded(ImageFormat::Png, [1, 2, 3]);
        let source = write_source(&dir.0, "source.png", &bytes);
        let first = import_and_confirm(&dir.0, &source).unwrap();
        let managed = background_dir(&dir.0)
            .join(ASSETS_DIR)
            .join(format!("{}.png", first.revision));
        let outside = write_source(&dir.0, "outside.png", &bytes);
        fs::remove_file(&managed).unwrap();
        symlink(&outside, &managed).unwrap();

        import_and_confirm(&dir.0, &source).unwrap();
        let metadata = fs::symlink_metadata(&managed).unwrap();
        assert!(metadata.is_file());
        assert!(!metadata.file_type().is_symlink());
        assert_eq!(fs::read(outside).unwrap(), bytes);
    }

    #[cfg(unix)]
    #[test]
    fn failed_replacement_and_symlinked_managed_directory_cannot_escape_or_lose_old_asset() {
        use std::os::unix::fs::{symlink, PermissionsExt as _};

        let dir = TestDir::new();
        let first_source = write_source(&dir.0, "first.png", &encoded(ImageFormat::Png, [1, 2, 3]));
        let first = import_and_confirm(&dir.0, &first_source).unwrap();
        let assets = background_dir(&dir.0).join(ASSETS_DIR);
        fs::set_permissions(&assets, fs::Permissions::from_mode(0o500)).unwrap();
        let second_source =
            write_source(&dir.0, "second.png", &encoded(ImageFormat::Png, [4, 5, 6]));
        assert!(import_and_confirm(&dir.0, &second_source).is_err());
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
