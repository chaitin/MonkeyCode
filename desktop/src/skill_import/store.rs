//! 技能库目标基线扫描。
//!
//! 本模块刻意不拥有锁或 revision。生产调用必须由 `skills::SkillStoreState`
//! 取得进程内及跨进程门控后，才可调用 [`BaselineStore::capture_locked`]；这样
//! list/save/delete/default/import/recovery/materialize 不会形成第二套锁域。

use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use super::model::{SkillRecoveryIssue, MAX_SKILL_MD_BYTES};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct StoreRevision {
    pub store_id: String,
    pub revision: u64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TargetPresence {
    Absent,
    Present,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TargetEntryType {
    File,
    Directory,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct TreeIdentity {
    pub relative_path: String,
    pub entry_type: TargetEntryType,
    pub object_a: u64,
    pub object_b: u64,
    pub size: u64,
    pub modified_seconds: i64,
    pub modified_nanos: i64,
    pub changed_seconds: i64,
    pub changed_nanos: i64,
    pub content_sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ExistingSkillPreview {
    pub directory_name: String,
    pub declared_name: Option<String>,
    pub description: String,
    pub skill_md: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct TargetBaseline {
    pub target_name: String,
    pub portable_name_key: String,
    pub store_id: String,
    pub revision: u64,
    pub presence: TargetPresence,
    pub target_type: Option<TargetEntryType>,
    pub target_identity: Option<TreeIdentity>,
    pub tree_identity: Vec<TreeIdentity>,
    pub preview: Option<ExistingSkillPreview>,
}

/// 暂存技能根的非序列化稳定身份。包含根/后代对象身份、时间、大小与文件内容
/// hash；state 只在 Rust 侧保存该值，WebView 永远看不到路径或对象标识。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FixedTreeSnapshot {
    tree: Vec<TreeIdentity>,
}

/// 已从安全父句柄相对打开并固定的暂存技能根。commit 会在任何批次写入前为全部
/// selected item 构造本对象，之后事务只能从这里复制，不能按 PathBuf 重开来源。
pub(crate) struct FixedStagedSkillRoot {
    root: platform::RootHandle,
    expected: FixedTreeSnapshot,
}

impl fmt::Debug for FixedStagedSkillRoot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FixedStagedSkillRoot")
            .field("expected_entries", &self.expected.tree.len())
            .finish_non_exhaustive()
    }
}

impl FixedStagedSkillRoot {
    pub(crate) fn capture(path: &Path) -> Result<FixedTreeSnapshot, SkillStoreError> {
        let root = platform::open_child_root(path)?;
        let snapshot = snapshot_root(&root)?;
        Ok(snapshot)
    }

    pub(crate) fn open_expected(
        path: &Path,
        expected: &FixedTreeSnapshot,
    ) -> Result<Self, SkillStoreError> {
        let root = platform::open_child_root(path)?;
        if expected.tree.first() != Some(&platform::root_identity(&root)?) {
            // 整体替换在读取任何 replacement 后代内容前即局部失败。
            return Err(SkillStoreError::CandidateChanged {
                entry_path: "staged-skill-root".into(),
            });
        }
        let actual = snapshot_root(&root)?;
        if &actual != expected {
            return Err(SkillStoreError::CandidateChanged {
                entry_path: "staged-skill-root".into(),
            });
        }
        Ok(Self {
            root,
            expected: expected.clone(),
        })
    }

    pub(crate) fn snapshot(&self) -> &FixedTreeSnapshot {
        &self.expected
    }

    pub(crate) fn verify(&self) -> Result<(), SkillStoreError> {
        if snapshot_root(&self.root)? != self.expected {
            return Err(SkillStoreError::CandidateChanged {
                entry_path: "staged-skill-root".into(),
            });
        }
        Ok(())
    }

    /// 从固定根句柄直接复制到独占 private prepared 目录；复制前后均重扫稳定树。
    pub(crate) fn copy_to(&self, destination: &Path) -> Result<(), SkillStoreError> {
        self.verify()?;
        platform::copy_root_directory(&self.root, destination)?;
        self.verify()
    }

    /// 文件面板读取：根已经按 expected 固定；文件同样逐级父句柄相对打开。调用
    /// 返回前重扫整棵树，修改只形成局部 CandidateChanged。
    pub(crate) fn read_file_range(
        &self,
        relative: &str,
        offset: u64,
        length: usize,
    ) -> Result<(Vec<u8>, u64), SkillStoreError> {
        self.verify()?;
        let value = platform::read_root_file(&self.root, relative, offset, length)?;
        self.verify()?;
        Ok(value)
    }
}

fn snapshot_root(root: &platform::RootHandle) -> Result<FixedTreeSnapshot, SkillStoreError> {
    let scanned = platform::scan_root(root)?;
    if scanned.target_type != Some(TargetEntryType::Directory) {
        return Err(SkillStoreError::unsafe_object(
            "staged-skill-root",
            "暂存技能根不是普通目录",
        ));
    }
    Ok(FixedTreeSnapshot { tree: scanned.tree })
}

#[derive(Debug)]
pub(crate) enum SkillStoreError {
    InvalidTargetName(String),
    UnsafeObject {
        relative_path: String,
        reason: String,
    },
    TargetChanged {
        target_name: String,
    },
    CandidateChanged {
        entry_path: String,
    },
    RevisionRollback {
        observed: u64,
        disk: u64,
    },
    StoreIdChanged {
        expected: String,
        disk: String,
    },
    RevisionOverflow,
    CorruptRevision(String),
    RecoveryPending(Vec<SkillRecoveryIssue>),
    Io {
        operation: &'static str,
        path: String,
        message: String,
    },
}

impl SkillStoreError {
    pub(crate) fn io(operation: &'static str, path: &Path, error: impl fmt::Display) -> Self {
        Self::Io {
            operation,
            path: path.display().to_string(),
            message: error.to_string(),
        }
    }

    pub(crate) fn unsafe_object(
        relative_path: impl Into<String>,
        reason: impl Into<String>,
    ) -> Self {
        Self::UnsafeObject {
            relative_path: relative_path.into(),
            reason: reason.into(),
        }
    }
}

impl fmt::Display for SkillStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidTargetName(name) => write!(formatter, "不安全的技能目标名: {name}"),
            Self::UnsafeObject {
                relative_path,
                reason,
            } => {
                write!(formatter, "技能库对象 {relative_path} 不安全: {reason}")
            }
            Self::TargetChanged { target_name } => {
                write!(formatter, "技能目标 {target_name} 在基线捕获后发生变化")
            }
            Self::CandidateChanged { entry_path } => {
                write!(formatter, "恢复候选 {entry_path} 在复核期间发生变化")
            }
            Self::RevisionRollback { observed, disk } => {
                write!(
                    formatter,
                    "技能库 revision 回退: 已观察 {observed}，磁盘为 {disk}"
                )
            }
            Self::StoreIdChanged { expected, disk } => {
                write!(
                    formatter,
                    "技能库 store_id 改变: 期望 {expected}，磁盘为 {disk}"
                )
            }
            Self::RevisionOverflow => write!(formatter, "技能库 revision 已到上限"),
            Self::CorruptRevision(message) => write!(formatter, "skills.revision 损坏: {message}"),
            Self::RecoveryPending(issues) => {
                let summary = issues
                    .iter()
                    .map(|issue| format!("{}: {}", issue.transaction_id, issue.error))
                    .collect::<Vec<_>>()
                    .join("; ");
                write!(formatter, "技能库恢复待处理: {summary}")
            }
            Self::Io {
                operation,
                path,
                message,
            } => {
                write!(formatter, "{operation} {path} 失败: {message}")
            }
        }
    }
}

impl std::error::Error for SkillStoreError {}

pub(crate) struct BaselineStore {
    root_path: PathBuf,
    root: platform::RootHandle,
}

impl BaselineStore {
    /// 调用方必须已经持有 `SkillStoreState` 写锁。句柄只固定权威目录；锁文件
    /// 本身由 state 每次临界区重新打开和复核，不能由这里缓存。
    pub(crate) fn open_locked(root_path: &Path) -> Result<Self, SkillStoreError> {
        let root = platform::open_root(root_path)?;
        Ok(Self {
            root_path: root_path.to_path_buf(),
            root,
        })
    }

    pub(crate) fn capture_locked(
        &self,
        revision: &StoreRevision,
        target_name: &str,
    ) -> Result<TargetBaseline, SkillStoreError> {
        platform::verify_root(&self.root, &self.root_path)?;
        let portable_name_key = crate::skills::portable_skill_name_key(target_name)
            .ok_or_else(|| SkillStoreError::InvalidTargetName(target_name.to_string()))?;
        let scanned = platform::scan_target(&self.root, target_name)?;
        // 根句柄自身也做扫描前后 identity 复核；子目录和文件由平台实现逐层
        // 复核固定句柄，避免仅校验叶子而漏掉根路径替换。
        platform::verify_root(&self.root, &self.root_path)?;
        let preview = if let Some(skill_md) = scanned.skill_md {
            if skill_md.len() as u64 > MAX_SKILL_MD_BYTES {
                return Err(SkillStoreError::unsafe_object(
                    format!("{target_name}/SKILL.md"),
                    "SKILL.md 超过 1 MiB",
                ));
            }
            let text = String::from_utf8(skill_md).map_err(|_| {
                SkillStoreError::unsafe_object(
                    format!("{target_name}/SKILL.md"),
                    "SKILL.md 不是 UTF-8 文本",
                )
            })?;
            let (declared_name, _) = crate::skills::parse_frontmatter(&text);
            Some(ExistingSkillPreview {
                directory_name: target_name.to_string(),
                declared_name,
                description: crate::skills::derive_description(&text),
                skill_md: text,
            })
        } else {
            None
        };
        Ok(TargetBaseline {
            target_name: target_name.to_string(),
            portable_name_key,
            store_id: revision.store_id.clone(),
            revision: revision.revision,
            presence: if scanned.target_type.is_some() {
                TargetPresence::Present
            } else {
                TargetPresence::Absent
            },
            target_type: scanned.target_type,
            target_identity: scanned.tree.first().cloned(),
            tree_identity: scanned.tree,
            preview,
        })
    }

    /// 从固定技能库根和逐层父句柄读取一个目录型技能，并独占生成目标树。
    /// 调用方必须持有 SkillStoreState 读/写锁；本方法在复制前后捕获完整
    /// identity/hash 树，任何来源变化、链接、reparse point 或特殊文件都失败。
    pub(crate) fn copy_directory_verified_locked(
        &self,
        revision: &StoreRevision,
        target_name: &str,
        destination: &Path,
    ) -> Result<TargetBaseline, SkillStoreError> {
        let before = self.capture_locked(revision, target_name)?;
        if before.presence != TargetPresence::Present
            || before.target_type != Some(TargetEntryType::Directory)
        {
            return Err(SkillStoreError::unsafe_object(
                target_name,
                "物化来源必须是普通目录",
            ));
        }
        platform::verify_root(&self.root, &self.root_path)?;
        platform::copy_target_directory(&self.root, target_name, destination)?;
        platform::verify_root(&self.root, &self.root_path)?;
        let after = self.capture_locked(revision, target_name)?;
        if before.tree_identity != after.tree_identity
            || before.target_identity != after.target_identity
        {
            return Err(SkillStoreError::TargetChanged {
                target_name: target_name.into(),
            });
        }
        Ok(after)
    }
}

pub(crate) fn copy_skill_directory_verified(
    root: &Path,
    target_name: &str,
    destination: &Path,
) -> Result<(), SkillStoreError> {
    let store = BaselineStore::open_locked(root)?;
    let revision = StoreRevision {
        store_id: "materialize".into(),
        revision: 0,
    };
    store
        .copy_directory_verified_locked(&revision, target_name, destination)
        .map(|_| ())
}

fn hash_open_file(file: &mut File) -> Result<String, io::Error> {
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

struct ScannedTarget {
    target_type: Option<TargetEntryType>,
    tree: Vec<TreeIdentity>,
    skill_md: Option<Vec<u8>>,
}

/// 统一的 std 平台实现。TOCTOU 级句柄钉扎已废弃：能篡改本地暂存文件的
/// 攻击者同样能直接改技能库，钉句柄换不来额外防御，却让 Windows 上后续
/// 的 rename/删除与自家句柄互斥（线上 os error 32 的根因）。内容一致性
/// 改由前后快照（大小/mtime/内容 hash）比对保证；symlink/特殊对象仍然
/// 在扫描与复制的每一层被拒绝。
mod platform {
    use super::*;

    pub(super) struct RootHandle {
        path: PathBuf,
    }

    fn plain_dir(metadata: &fs::Metadata) -> bool {
        metadata.file_type().is_dir() && !metadata.file_type().is_symlink()
    }

    fn open_dir_root(path: &Path, label: &str) -> Result<RootHandle, SkillStoreError> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| SkillStoreError::io("固定技能库根", path, error))?;
        if !plain_dir(&metadata) {
            return Err(SkillStoreError::unsafe_object(label, "根不是普通目录"));
        }
        Ok(RootHandle {
            path: path.to_path_buf(),
        })
    }

    pub(super) fn open_root(path: &Path) -> Result<RootHandle, SkillStoreError> {
        open_dir_root(path, ".")
    }

    pub(super) fn open_child_root(path: &Path) -> Result<RootHandle, SkillStoreError> {
        open_dir_root(path, "staged-skill-root")
    }

    pub(super) fn verify_root(root: &RootHandle, expected: &Path) -> Result<(), SkillStoreError> {
        if root.path != expected {
            return Err(SkillStoreError::unsafe_object(".", "技能库根路径不一致"));
        }
        open_dir_root(&root.path, ".").map(|_| ())
    }

    fn time_parts(time: std::io::Result<std::time::SystemTime>) -> (i64, i64) {
        let Ok(time) = time else { return (0, 0) };
        match time.duration_since(std::time::UNIX_EPOCH) {
            Ok(duration) => (duration.as_secs() as i64, duration.subsec_nanos() as i64),
            Err(before) => {
                let duration = before.duration();
                (-(duration.as_secs() as i64), duration.subsec_nanos() as i64)
            }
        }
    }

    fn identity(relative: &str, metadata: &fs::Metadata, hash: Option<String>) -> TreeIdentity {
        let (object_a, object_b);
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;
            object_a = metadata.dev();
            object_b = metadata.ino();
        }
        #[cfg(not(unix))]
        {
            object_a = 0;
            object_b = 0;
        }
        let (modified_seconds, modified_nanos) = time_parts(metadata.modified());
        #[cfg(unix)]
        let (changed_seconds, changed_nanos) = {
            use std::os::unix::fs::MetadataExt as _;
            (metadata.ctime(), metadata.ctime_nsec())
        };
        #[cfg(not(unix))]
        let (changed_seconds, changed_nanos) = (modified_seconds, modified_nanos);
        TreeIdentity {
            relative_path: relative.to_string(),
            entry_type: if metadata.is_dir() {
                TargetEntryType::Directory
            } else {
                TargetEntryType::File
            },
            object_a,
            object_b,
            size: if metadata.is_dir() { 0 } else { metadata.len() },
            modified_seconds,
            modified_nanos,
            changed_seconds,
            changed_nanos,
            content_sha256: hash,
        }
    }

    fn scan_tree(
        base: &Path,
        prefix: &str,
        tree: &mut Vec<TreeIdentity>,
        skill_md: &mut Option<Vec<u8>>,
    ) -> Result<(), SkillStoreError> {
        let entries =
            fs::read_dir(base).map_err(|error| SkillStoreError::io("枚举技能目录", base, error))?;
        for entry in entries {
            let entry =
                entry.map_err(|error| SkillStoreError::io("读取技能目录项", base, error))?;
            let name = entry.file_name();
            let Some(name) = name.to_str().map(str::to_string) else {
                return Err(SkillStoreError::unsafe_object(prefix, "名称不是 UTF-8"));
            };
            if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
                return Err(SkillStoreError::unsafe_object(prefix, "路径组件非法"));
            }
            let child = base.join(&name);
            let relative = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            let metadata = fs::symlink_metadata(&child)
                .map_err(|error| SkillStoreError::io("检查技能对象", &child, error))?;
            if metadata.file_type().is_symlink() {
                return Err(SkillStoreError::unsafe_object(relative, "不允许符号链接"));
            }
            if metadata.is_dir() {
                tree.push(identity(&relative, &metadata, None));
                scan_tree(&child, &relative, tree, skill_md)?;
            } else if metadata.is_file() {
                let mut file = File::open(&child)
                    .map_err(|error| SkillStoreError::io("打开技能文件", &child, error))?;
                let hash = hash_open_file(&mut file)
                    .map_err(|error| SkillStoreError::io("读取技能文件", &child, error))?;
                if relative == "SKILL.md" {
                    let bytes = fs::read(&child)
                        .map_err(|error| SkillStoreError::io("读取 SKILL.md", &child, error))?;
                    *skill_md = Some(bytes);
                }
                tree.push(identity(&relative, &metadata, Some(hash)));
            } else {
                return Err(SkillStoreError::unsafe_object(relative, "不支持的对象类型"));
            }
        }
        Ok(())
    }

    fn scan_directory_root(base: &Path) -> Result<ScannedTarget, SkillStoreError> {
        let metadata = fs::symlink_metadata(base)
            .map_err(|error| SkillStoreError::io("检查技能根", base, error))?;
        if !plain_dir(&metadata) {
            return Err(SkillStoreError::unsafe_object(".", "技能根不是普通目录"));
        }
        let mut tree = vec![identity("", &metadata, None)];
        let mut skill_md = None;
        scan_tree(base, "", &mut tree, &mut skill_md)?;
        tree.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        Ok(ScannedTarget {
            target_type: Some(TargetEntryType::Directory),
            tree,
            skill_md,
        })
    }

    pub(super) fn root_identity(root: &RootHandle) -> Result<TreeIdentity, SkillStoreError> {
        let metadata = fs::symlink_metadata(&root.path)
            .map_err(|error| SkillStoreError::io("检查技能根", &root.path, error))?;
        if !plain_dir(&metadata) {
            return Err(SkillStoreError::unsafe_object(".", "技能根不是普通目录"));
        }
        Ok(identity("", &metadata, None))
    }

    pub(super) fn scan_root(root: &RootHandle) -> Result<ScannedTarget, SkillStoreError> {
        scan_directory_root(&root.path)
    }

    pub(super) fn scan_target(
        root: &RootHandle,
        target_name: &str,
    ) -> Result<ScannedTarget, SkillStoreError> {
        let path = root.path.join(target_name);
        let metadata = match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(ScannedTarget {
                    target_type: None,
                    tree: Vec::new(),
                    skill_md: None,
                });
            }
            Err(error) => return Err(SkillStoreError::io("检查技能目标", &path, error)),
            Ok(metadata) => metadata,
        };
        if metadata.file_type().is_symlink() {
            return Err(SkillStoreError::unsafe_object(
                target_name,
                "不允许符号链接",
            ));
        }
        if metadata.is_dir() {
            return scan_directory_root(&path);
        }
        if !metadata.is_file() {
            return Err(SkillStoreError::unsafe_object(
                target_name,
                "不支持的对象类型",
            ));
        }
        let mut file =
            File::open(&path).map_err(|error| SkillStoreError::io("打开技能目标", &path, error))?;
        let hash = hash_open_file(&mut file)
            .map_err(|error| SkillStoreError::io("读取技能目标", &path, error))?;
        Ok(ScannedTarget {
            target_type: Some(TargetEntryType::File),
            tree: vec![identity(target_name, &metadata, Some(hash))],
            skill_md: None,
        })
    }

    fn copy_tree(source: &Path, destination: &Path) -> Result<(), SkillStoreError> {
        fs::create_dir(destination)
            .map_err(|error| SkillStoreError::io("独占创建目标目录", destination, error))?;
        let entries = fs::read_dir(source)
            .map_err(|error| SkillStoreError::io("枚举复制来源", source, error))?;
        for entry in entries {
            let entry =
                entry.map_err(|error| SkillStoreError::io("读取复制来源项", source, error))?;
            let child = entry.path();
            let output = destination.join(entry.file_name());
            let metadata = fs::symlink_metadata(&child)
                .map_err(|error| SkillStoreError::io("检查复制来源", &child, error))?;
            if metadata.file_type().is_symlink() {
                return Err(SkillStoreError::unsafe_object(
                    child.display().to_string(),
                    "不允许符号链接",
                ));
            }
            if metadata.is_dir() {
                copy_tree(&child, &output)?;
            } else if metadata.is_file() {
                fs::copy(&child, &output)
                    .map_err(|error| SkillStoreError::io("复制技能文件", &child, error))?;
            } else {
                return Err(SkillStoreError::unsafe_object(
                    child.display().to_string(),
                    "不支持的对象类型",
                ));
            }
        }
        Ok(())
    }

    pub(super) fn copy_root_directory(
        root: &RootHandle,
        destination: &Path,
    ) -> Result<(), SkillStoreError> {
        copy_tree(&root.path, destination)
    }

    pub(super) fn copy_target_directory(
        root: &RootHandle,
        target_name: &str,
        destination: &Path,
    ) -> Result<(), SkillStoreError> {
        copy_tree(&root.path.join(target_name), destination)
    }

    pub(super) fn read_root_file(
        root: &RootHandle,
        relative: &str,
        offset: u64,
        length: usize,
    ) -> Result<(Vec<u8>, u64), SkillStoreError> {
        let components = relative.split('/').collect::<Vec<_>>();
        if components.is_empty()
            || components
                .iter()
                .any(|part| part.is_empty() || *part == "." || *part == "..")
        {
            return Err(SkillStoreError::unsafe_object(relative, "文件路径组件非法"));
        }
        let mut path = root.path.clone();
        for (index, component) in components.iter().enumerate() {
            path = path.join(component);
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| SkillStoreError::io("检查暂存文件路径", &path, error))?;
            if metadata.file_type().is_symlink() {
                return Err(SkillStoreError::unsafe_object(relative, "不允许符号链接"));
            }
            let is_last = index + 1 == components.len();
            if is_last {
                if !metadata.is_file() {
                    return Err(SkillStoreError::unsafe_object(relative, "对象不是普通文件"));
                }
            } else if !metadata.is_dir() {
                return Err(SkillStoreError::unsafe_object(relative, "路径中间不是目录"));
            }
        }
        let mut file =
            File::open(&path).map_err(|error| SkillStoreError::io("打开暂存文件", &path, error))?;
        let total = file
            .metadata()
            .map_err(|error| SkillStoreError::io("复核暂存文件", &path, error))?
            .len();
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| SkillStoreError::io("定位暂存文件", &path, error))?;
        let mut buffer = vec![0u8; length];
        let mut filled = 0;
        while filled < buffer.len() {
            let read = file
                .read(&mut buffer[filled..])
                .map_err(|error| SkillStoreError::io("读取暂存文件", &path, error))?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        buffer.truncate(filled);
        Ok((buffer, total))
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::*;

    /// Windows 真实句柄回归：同一个固定根会连续触发多次完整枚举；每轮都必须从
    /// 目录开头重启，而不能沿用 capture/open_expected 留下的共享 file-object 游标。
    #[cfg(windows)]
    #[test]
    fn fixed_staged_root_repeated_snapshot_verify_and_read_use_the_same_handle() {
        use std::sync::atomic::{AtomicU64, Ordering};

        static NEXT_TEST: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "monkeycode-fixed-staged-root-windows-{}-{}",
            std::process::id(),
            NEXT_TEST.fetch_add(1, Ordering::Relaxed)
        ));
        let skill = root.join("skill");
        std::fs::create_dir_all(skill.join("nested")).unwrap();
        std::fs::write(skill.join("SKILL.md"), b"# fixed root\n").unwrap();
        std::fs::write(skill.join("nested/notes.txt"), b"same handle").unwrap();

        let expected = FixedStagedSkillRoot::capture(&skill).unwrap();
        let fixed = FixedStagedSkillRoot::open_expected(&skill, &expected).unwrap();
        assert_eq!(fixed.snapshot(), &expected);
        fixed.verify().unwrap();
        assert_eq!(
            fixed.read_file_range("SKILL.md", 0, 64).unwrap(),
            (b"# fixed root\n".to_vec(), 13)
        );
        fixed.verify().unwrap();
        assert_eq!(
            fixed.read_file_range("nested/notes.txt", 5, 64).unwrap(),
            (b"handle".to_vec(), 11)
        );
        fixed.verify().unwrap();

        drop(fixed);
        std::fs::remove_dir_all(root).unwrap();
    }
}
