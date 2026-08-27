//! 技能库目标基线扫描。
//!
//! 本模块刻意不拥有锁或 revision。生产调用必须由 `skills::SkillStoreState`
//! 取得进程内及跨进程门控后，才可调用 [`BaselineStore::capture_locked`]；这样
//! list/save/delete/default/import/recovery/materialize 不会形成第二套锁域。

use std::fmt;
use std::fs::File;
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

#[cfg(unix)]
mod platform {
    use super::*;
    use std::ffi::{OsStr, OsString};
    use std::os::fd::{AsFd as _, OwnedFd};
    use std::os::unix::ffi::OsStringExt as _;

    use rustix::fs::{fstat, openat, Dir, FileType, Mode, OFlags, CWD};

    pub(super) struct RootHandle {
        file: File,
        object_a: u64,
        object_b: u64,
    }

    pub(super) fn open_root(path: &Path) -> Result<RootHandle, SkillStoreError> {
        let fd = openat(CWD, path, directory_flags(), Mode::empty())
            .map_err(|error| SkillStoreError::io("固定技能库根", path, error))?;
        let stat = fstat(&fd).map_err(|error| SkillStoreError::io("复核技能库根", path, error))?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::Directory {
            return Err(SkillStoreError::unsafe_object(".", "技能库根不是普通目录"));
        }
        Ok(RootHandle {
            file: File::from(fd),
            object_a: stat.st_dev as u64,
            object_b: stat.st_ino as u64,
        })
    }

    pub(super) fn open_child_root(path: &Path) -> Result<RootHandle, SkillStoreError> {
        let parent_path = path.parent().ok_or_else(|| {
            SkillStoreError::unsafe_object("staged-skill-root", "暂存根缺少父目录")
        })?;
        let name = path.file_name().ok_or_else(|| {
            SkillStoreError::unsafe_object("staged-skill-root", "暂存根缺少末级名称")
        })?;
        let parent = open_root(parent_path)?;
        let fd = openat(parent.file.as_fd(), name, directory_flags(), Mode::empty()).map_err(
            |error| {
                SkillStoreError::io(
                    "父句柄相对固定暂存技能根",
                    Path::new("staged-skill-root"),
                    error,
                )
            },
        )?;
        let stat = fstat(&fd).map_err(|error| {
            SkillStoreError::io("复核暂存技能根", Path::new("staged-skill-root"), error)
        })?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::Directory {
            return Err(SkillStoreError::unsafe_object(
                "staged-skill-root",
                "暂存技能根不是普通目录",
            ));
        }
        Ok(RootHandle {
            file: File::from(fd),
            object_a: stat.st_dev as u64,
            object_b: stat.st_ino as u64,
        })
    }

    pub(super) fn root_identity(root: &RootHandle) -> Result<TreeIdentity, SkillStoreError> {
        let stat = fstat(&root.file).map_err(|error| {
            SkillStoreError::io("复核暂存技能根", Path::new("staged-skill-root"), error)
        })?;
        Ok(identity_from_stat(
            "",
            TargetEntryType::Directory,
            &stat,
            None,
        ))
    }

    pub(super) fn scan_root(root: &RootHandle) -> Result<ScannedTarget, SkillStoreError> {
        let fd =
            openat(root.file.as_fd(), ".", directory_flags(), Mode::empty()).map_err(|error| {
                SkillStoreError::io("复制暂存技能根句柄", Path::new("staged-skill-root"), error)
            })?;
        let mut tree = Vec::new();
        let mut skill_md = None;
        scan_directory(fd, "staged-skill-root", "", &mut tree, &mut skill_md)?;
        tree.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        if let Some(index) = tree.iter().position(|entry| entry.relative_path.is_empty()) {
            tree.swap(0, index);
        }
        Ok(ScannedTarget {
            target_type: Some(TargetEntryType::Directory),
            tree,
            skill_md,
        })
    }

    pub(super) fn copy_root_directory(
        root: &RootHandle,
        destination: &Path,
    ) -> Result<(), SkillStoreError> {
        let fd =
            openat(root.file.as_fd(), ".", directory_flags(), Mode::empty()).map_err(|error| {
                SkillStoreError::io("复制暂存技能根句柄", Path::new("staged-skill-root"), error)
            })?;
        std::fs::create_dir(destination).map_err(|error| {
            SkillStoreError::io("独占创建事务 prepared 目录", destination, error)
        })?;
        copy_directory_to(fd, "staged-skill-root", "", destination)
    }

    pub(super) fn read_root_file(
        root: &RootHandle,
        relative: &str,
        offset: u64,
        length: usize,
    ) -> Result<(Vec<u8>, u64), SkillStoreError> {
        let mut components = relative.split('/').collect::<Vec<_>>();
        if components.is_empty()
            || components
                .iter()
                .any(|part| part.is_empty() || *part == "." || *part == "..")
        {
            return Err(SkillStoreError::unsafe_object(relative, "文件路径组件非法"));
        }
        let name = components.pop().expect("已检查非空");
        let mut parent = openat(root.file.as_fd(), ".", directory_flags(), Mode::empty())
            .map_err(|error| SkillStoreError::io("复制暂存根句柄", Path::new(relative), error))?;
        for component in components {
            parent = openat(
                &parent,
                OsStr::new(component),
                directory_flags(),
                Mode::empty(),
            )
            .map_err(|error| {
                SkillStoreError::io("父句柄相对打开暂存目录", Path::new(relative), error)
            })?;
        }
        let fd = openat(
            &parent,
            OsStr::new(name),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| {
            SkillStoreError::io("父句柄相对打开暂存文件", Path::new(relative), error)
        })?;
        let stat = fstat(&fd)
            .map_err(|error| SkillStoreError::io("复核暂存文件句柄", Path::new(relative), error))?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile {
            return Err(SkillStoreError::unsafe_object(relative, "对象不是普通文件"));
        }
        let size = stat.st_size.max(0) as u64;
        if offset > size {
            return Err(SkillStoreError::CandidateChanged {
                entry_path: relative.into(),
            });
        }
        let mut file = File::from(fd);
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| SkillStoreError::io("定位暂存文件", Path::new(relative), error))?;
        let wanted = length.min((size - offset) as usize);
        let mut bytes = vec![0u8; wanted];
        file.read_exact(&mut bytes)
            .map_err(|error| SkillStoreError::io("读取暂存文件", Path::new(relative), error))?;
        let after = fstat(&file)
            .map_err(|error| SkillStoreError::io("结束复核暂存文件", Path::new(relative), error))?;
        if stat.st_dev != after.st_dev
            || stat.st_ino != after.st_ino
            || stat.st_size != after.st_size
            || stat.st_mtime != after.st_mtime
            || stat.st_mtime_nsec != after.st_mtime_nsec
            || stat.st_ctime != after.st_ctime
            || stat.st_ctime_nsec != after.st_ctime_nsec
        {
            return Err(SkillStoreError::CandidateChanged {
                entry_path: relative.into(),
            });
        }
        Ok((bytes, size))
    }

    pub(super) fn verify_root(root: &RootHandle, path: &Path) -> Result<(), SkillStoreError> {
        let fd = openat(CWD, path, directory_flags(), Mode::empty())
            .map_err(|error| SkillStoreError::io("重新打开技能库根", path, error))?;
        let stat = fstat(&fd).map_err(|error| SkillStoreError::io("复核技能库根", path, error))?;
        if stat.st_dev as u64 != root.object_a || stat.st_ino as u64 != root.object_b {
            return Err(SkillStoreError::unsafe_object(
                ".",
                "技能库根在扫描期间被替换",
            ));
        }
        Ok(())
    }

    pub(super) fn scan_target(
        root: &RootHandle,
        target_name: &str,
    ) -> Result<ScannedTarget, SkillStoreError> {
        let target = match openat(
            root.file.as_fd(),
            OsStr::new(target_name),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(error) if error == rustix::io::Errno::NOENT => {
                return Ok(ScannedTarget {
                    target_type: None,
                    tree: Vec::new(),
                    skill_md: None,
                });
            }
            Err(error) => {
                return Err(SkillStoreError::io(
                    "安全打开技能目标",
                    Path::new(target_name),
                    error,
                ));
            }
        };
        let stat = fstat(&target)
            .map_err(|error| SkillStoreError::io("复核技能目标", Path::new(target_name), error))?;
        match FileType::from_raw_mode(stat.st_mode) {
            FileType::RegularFile => {
                let mut file = File::from(target);
                let before = identity_from_stat(target_name, TargetEntryType::File, &stat, None);
                let hash = hash_open_file(&mut file).map_err(|error| {
                    SkillStoreError::io("读取技能目标", Path::new(target_name), error)
                })?;
                let after_stat = fstat(&file).map_err(|error| {
                    SkillStoreError::io("复核技能目标", Path::new(target_name), error)
                })?;
                let after =
                    identity_from_stat(target_name, TargetEntryType::File, &after_stat, Some(hash));
                if !same_metadata(&before, &after) {
                    return Err(SkillStoreError::TargetChanged {
                        target_name: target_name.into(),
                    });
                }
                Ok(ScannedTarget {
                    target_type: Some(TargetEntryType::File),
                    tree: vec![after],
                    skill_md: None,
                })
            }
            FileType::Directory => {
                let mut tree = Vec::new();
                let mut skill_md = None;
                scan_directory(target, target_name, "", &mut tree, &mut skill_md)?;
                tree.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
                if let Some(index) = tree.iter().position(|entry| entry.relative_path.is_empty()) {
                    tree.swap(0, index);
                }
                Ok(ScannedTarget {
                    target_type: Some(TargetEntryType::Directory),
                    tree,
                    skill_md,
                })
            }
            FileType::Symlink => Err(SkillStoreError::unsafe_object(
                target_name,
                "目标不得为符号链接",
            )),
            _ => Err(SkillStoreError::unsafe_object(
                target_name,
                "目标只允许普通文件或目录",
            )),
        }
    }

    fn scan_directory(
        directory: OwnedFd,
        target_name: &str,
        relative: &str,
        tree: &mut Vec<TreeIdentity>,
        skill_md: &mut Option<Vec<u8>>,
    ) -> Result<(), SkillStoreError> {
        let before_stat = fstat(&directory)
            .map_err(|error| SkillStoreError::io("复核技能目录", Path::new(relative), error))?;
        if FileType::from_raw_mode(before_stat.st_mode) != FileType::Directory {
            return Err(SkillStoreError::unsafe_object(relative, "对象不是普通目录"));
        }
        let before = identity_from_stat(relative, TargetEntryType::Directory, &before_stat, None);
        tree.push(before.clone());

        let mut names = Vec::new();
        let mut stream = Dir::read_from(&directory)
            .map_err(|error| SkillStoreError::io("枚举技能目录", Path::new(relative), error))?;
        while let Some(entry) = stream.read() {
            let entry = entry
                .map_err(|error| SkillStoreError::io("枚举技能目录", Path::new(relative), error))?;
            let bytes = entry.file_name().to_bytes();
            if bytes == b"." || bytes == b".." {
                continue;
            }
            let name = OsString::from_vec(bytes.to_vec());
            if name.to_str().is_none() {
                return Err(SkillStoreError::unsafe_object(
                    relative,
                    "路径必须是有效 Unicode",
                ));
            }
            names.push(name);
        }
        names.sort();
        for name in names {
            let name_text = name.to_string_lossy();
            if name_text.is_empty()
                || name_text == "."
                || name_text == ".."
                || name_text.contains(['/', '\\'])
            {
                return Err(SkillStoreError::unsafe_object(
                    relative,
                    "包含不安全路径组件",
                ));
            }
            let child_relative = if relative.is_empty() {
                name_text.into_owned()
            } else {
                format!("{relative}/{name_text}")
            };
            let child = openat(
                &directory,
                &name,
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|error| {
                SkillStoreError::io("安全打开技能对象", Path::new(&child_relative), error)
            })?;
            let stat = fstat(&child).map_err(|error| {
                SkillStoreError::io("复核技能对象", Path::new(&child_relative), error)
            })?;
            match FileType::from_raw_mode(stat.st_mode) {
                FileType::Directory => {
                    scan_directory(child, target_name, &child_relative, tree, skill_md)?;
                }
                FileType::RegularFile => {
                    let mut file = File::from(child);
                    let before =
                        identity_from_stat(&child_relative, TargetEntryType::File, &stat, None);
                    let mut captured_skill = None;
                    let hash = if child_relative == "SKILL.md" {
                        let mut bytes = Vec::new();
                        file.read_to_end(&mut bytes).map_err(|error| {
                            SkillStoreError::io(
                                "读取现有 SKILL.md",
                                Path::new(&child_relative),
                                error,
                            )
                        })?;
                        let digest = format!("{:x}", Sha256::digest(&bytes));
                        captured_skill = Some(bytes);
                        digest
                    } else {
                        hash_open_file(&mut file).map_err(|error| {
                            SkillStoreError::io("读取技能文件", Path::new(&child_relative), error)
                        })?
                    };
                    let after_stat = fstat(&file).map_err(|error| {
                        SkillStoreError::io("复核技能文件", Path::new(&child_relative), error)
                    })?;
                    let after = identity_from_stat(
                        &child_relative,
                        TargetEntryType::File,
                        &after_stat,
                        Some(hash),
                    );
                    if !same_metadata(&before, &after) {
                        return Err(SkillStoreError::TargetChanged {
                            target_name: target_name.into(),
                        });
                    }
                    if captured_skill.is_some() {
                        *skill_md = captured_skill;
                    }
                    tree.push(after);
                }
                FileType::Symlink => {
                    return Err(SkillStoreError::unsafe_object(
                        child_relative,
                        "不允许符号链接",
                    ));
                }
                _ => {
                    return Err(SkillStoreError::unsafe_object(
                        child_relative,
                        "只允许普通文件和目录",
                    ));
                }
            }
        }
        let after_stat = fstat(&directory)
            .map_err(|error| SkillStoreError::io("复核技能目录", Path::new(relative), error))?;
        let after = identity_from_stat(relative, TargetEntryType::Directory, &after_stat, None);
        if before != after {
            return Err(SkillStoreError::TargetChanged {
                target_name: target_name.into(),
            });
        }
        Ok(())
    }

    fn identity_from_stat(
        relative_path: &str,
        entry_type: TargetEntryType,
        stat: &rustix::fs::Stat,
        content_sha256: Option<String>,
    ) -> TreeIdentity {
        TreeIdentity {
            relative_path: relative_path.to_string(),
            entry_type,
            object_a: stat.st_dev as u64,
            object_b: stat.st_ino as u64,
            size: stat.st_size.max(0) as u64,
            modified_seconds: stat.st_mtime,
            modified_nanos: stat.st_mtime_nsec,
            changed_seconds: stat.st_ctime,
            changed_nanos: stat.st_ctime_nsec,
            content_sha256,
        }
    }

    fn same_metadata(left: &TreeIdentity, right: &TreeIdentity) -> bool {
        left.relative_path == right.relative_path
            && left.entry_type == right.entry_type
            && left.object_a == right.object_a
            && left.object_b == right.object_b
            && left.size == right.size
            && left.modified_seconds == right.modified_seconds
            && left.modified_nanos == right.modified_nanos
            && left.changed_seconds == right.changed_seconds
            && left.changed_nanos == right.changed_nanos
    }

    pub(super) fn copy_target_directory(
        root: &RootHandle,
        target_name: &str,
        destination: &Path,
    ) -> Result<(), SkillStoreError> {
        let target = openat(
            root.file.as_fd(),
            OsStr::new(target_name),
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| {
            SkillStoreError::io("固定待物化技能目录", Path::new(target_name), error)
        })?;
        let stat = fstat(&target).map_err(|error| {
            SkillStoreError::io("复核待物化技能目录", Path::new(target_name), error)
        })?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::Directory {
            return Err(SkillStoreError::unsafe_object(
                target_name,
                "物化来源不是普通目录",
            ));
        }
        std::fs::create_dir(destination)
            .map_err(|error| SkillStoreError::io("独占创建物化技能目录", destination, error))?;
        copy_directory_to(target, target_name, "", destination)
    }

    fn copy_directory_to(
        directory: OwnedFd,
        target_name: &str,
        relative: &str,
        destination: &Path,
    ) -> Result<(), SkillStoreError> {
        let before = fstat(&directory)
            .map_err(|error| SkillStoreError::io("复核技能目录", Path::new(relative), error))?;
        if FileType::from_raw_mode(before.st_mode) != FileType::Directory {
            return Err(SkillStoreError::unsafe_object(relative, "对象不是普通目录"));
        }
        let mut names = Vec::new();
        let mut stream = Dir::read_from(&directory)
            .map_err(|error| SkillStoreError::io("枚举技能目录", Path::new(relative), error))?;
        while let Some(entry) = stream.read() {
            let entry = entry
                .map_err(|error| SkillStoreError::io("枚举技能目录", Path::new(relative), error))?;
            let bytes = entry.file_name().to_bytes();
            if bytes == b"." || bytes == b".." {
                continue;
            }
            let name = OsString::from_vec(bytes.to_vec());
            if name.to_str().is_none() {
                return Err(SkillStoreError::unsafe_object(
                    relative,
                    "路径必须是有效 Unicode",
                ));
            }
            names.push(name);
        }
        names.sort();
        for name in names {
            let text = name.to_string_lossy();
            if text.is_empty() || text == "." || text == ".." || text.contains(['/', '\\']) {
                return Err(SkillStoreError::unsafe_object(
                    relative,
                    "包含不安全路径组件",
                ));
            }
            let child_relative = if relative.is_empty() {
                text.into_owned()
            } else {
                format!("{relative}/{text}")
            };
            let child = openat(
                &directory,
                &name,
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|error| {
                SkillStoreError::io("安全打开物化技能对象", Path::new(&child_relative), error)
            })?;
            let stat = fstat(&child).map_err(|error| {
                SkillStoreError::io("复核物化技能对象", Path::new(&child_relative), error)
            })?;
            let output = destination.join(&name);
            match FileType::from_raw_mode(stat.st_mode) {
                FileType::Directory => {
                    std::fs::create_dir(&output).map_err(|error| {
                        SkillStoreError::io("独占创建物化子目录", &output, error)
                    })?;
                    copy_directory_to(child, target_name, &child_relative, &output)?;
                }
                FileType::RegularFile => {
                    let before_file = stat;
                    let mut source = File::from(child);
                    let mut target = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&output)
                        .map_err(|error| {
                            SkillStoreError::io("独占创建物化技能文件", &output, error)
                        })?;
                    io::copy(&mut source, &mut target).map_err(|error| {
                        SkillStoreError::io(
                            "从固定句柄复制技能文件",
                            Path::new(&child_relative),
                            error,
                        )
                    })?;
                    target
                        .sync_all()
                        .map_err(|error| SkillStoreError::io("同步物化技能文件", &output, error))?;
                    let after_file = fstat(&source).map_err(|error| {
                        SkillStoreError::io("复核物化技能文件", Path::new(&child_relative), error)
                    })?;
                    if before_file.st_dev != after_file.st_dev
                        || before_file.st_ino != after_file.st_ino
                        || before_file.st_size != after_file.st_size
                        || before_file.st_mtime != after_file.st_mtime
                        || before_file.st_mtime_nsec != after_file.st_mtime_nsec
                        || before_file.st_ctime != after_file.st_ctime
                        || before_file.st_ctime_nsec != after_file.st_ctime_nsec
                    {
                        return Err(SkillStoreError::TargetChanged {
                            target_name: target_name.into(),
                        });
                    }
                }
                FileType::Symlink => {
                    return Err(SkillStoreError::unsafe_object(
                        child_relative,
                        "不允许符号链接",
                    ));
                }
                _ => {
                    return Err(SkillStoreError::unsafe_object(
                        child_relative,
                        "只允许普通文件和目录",
                    ));
                }
            }
        }
        let after = fstat(&directory)
            .map_err(|error| SkillStoreError::io("复核技能目录", Path::new(relative), error))?;
        if before.st_dev != after.st_dev
            || before.st_ino != after.st_ino
            || before.st_mtime != after.st_mtime
            || before.st_mtime_nsec != after.st_mtime_nsec
            || before.st_ctime != after.st_ctime
            || before.st_ctime_nsec != after.st_ctime_nsec
        {
            return Err(SkillStoreError::TargetChanged {
                target_name: target_name.into(),
            });
        }
        Ok(())
    }

    fn directory_flags() -> OFlags {
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::{OsStr, OsString};
    use std::mem::{offset_of, size_of};
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, RawHandle};

    use windows::core::{PCWSTR, PWSTR};
    use windows::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows::Wdk::Storage::FileSystem::{
        NtCreateFile, FILE_OPEN, FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT,
    };
    use windows::Win32::Foundation::{
        HANDLE, OBJ_CASE_INSENSITIVE, OBJ_DONT_REPARSE, STATUS_OBJECT_NAME_NOT_FOUND,
        STATUS_OBJECT_PATH_NOT_FOUND, UNICODE_STRING,
    };
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FileBasicInfo, FileIdBothDirectoryInfo, FileIdInfo, FileStandardInfo,
        GetFileInformationByHandleEx, GetFileType, FILE_ATTRIBUTE_DEVICE, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_READ, FILE_ID_BOTH_DIR_INFO, FILE_ID_INFO,
        FILE_INFO_BY_HANDLE_CLASS, FILE_SHARE_READ, FILE_STANDARD_INFO, FILE_TYPE_DISK,
        OPEN_EXISTING,
    };
    use windows::Win32::System::IO::IO_STATUS_BLOCK;

    const DIRECTORY_BUFFER_BYTES: usize = 64 * 1024;
    const HRESULT_NO_MORE_FILES: u32 = 0x8007_0012;
    // windows 0.61 metadata 未导出该命名常量；FILE_INFO_BY_HANDLE_CLASS 的 SDK
    // 固定值 11 即 FileIdBothRestartDirectoryInfo。
    #[allow(non_upper_case_globals)]
    const FileIdBothRestartDirectoryInfo: FILE_INFO_BY_HANDLE_CLASS = FILE_INFO_BY_HANDLE_CLASS(11);

    pub(super) struct RootHandle {
        file: File,
        identity: HandleIdentity,
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct HandleIdentity {
        volume: u64,
        file_id_low: u64,
        file_id_high: u64,
        size: u64,
        modified: i64,
        changed: i64,
        directory: bool,
    }

    struct DirectoryEntry {
        name: OsString,
        directory: bool,
    }

    pub(super) fn open_root(path: &Path) -> Result<RootHandle, SkillStoreError> {
        let file = open_root_path(path)?;
        let identity = inspect_handle(&file, ".")?;
        if !identity.directory {
            return Err(SkillStoreError::unsafe_object(
                ".",
                "技能库根不是普通磁盘目录",
            ));
        }
        Ok(RootHandle { file, identity })
    }

    pub(super) fn open_child_root(path: &Path) -> Result<RootHandle, SkillStoreError> {
        let parent_path = path.parent().ok_or_else(|| {
            SkillStoreError::unsafe_object("staged-skill-root", "暂存根缺少父目录")
        })?;
        let name = path.file_name().ok_or_else(|| {
            SkillStoreError::unsafe_object("staged-skill-root", "暂存根缺少末级名称")
        })?;
        let parent = open_root(parent_path)?;
        let file = open_relative(&parent.file, name, "staged-skill-root")?.ok_or_else(|| {
            SkillStoreError::CandidateChanged {
                entry_path: "staged-skill-root".into(),
            }
        })?;
        let identity = inspect_handle(&file, "staged-skill-root")?;
        if !identity.directory {
            return Err(SkillStoreError::unsafe_object(
                "staged-skill-root",
                "暂存技能根不是普通目录",
            ));
        }
        Ok(RootHandle { file, identity })
    }

    pub(super) fn root_identity(root: &RootHandle) -> Result<TreeIdentity, SkillStoreError> {
        let identity = inspect_handle(&root.file, "staged-skill-root")?;
        Ok(tree_identity(
            "",
            TargetEntryType::Directory,
            &identity,
            None,
        ))
    }

    pub(super) fn scan_root(root: &RootHandle) -> Result<ScannedTarget, SkillStoreError> {
        let mut tree = Vec::new();
        let mut skill_md = None;
        let file = root.file.try_clone().map_err(|error| {
            SkillStoreError::io("复制暂存根句柄", Path::new("staged-skill-root"), error)
        })?;
        scan_directory(file, "staged-skill-root", "", &mut tree, &mut skill_md)?;
        tree.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        if let Some(index) = tree.iter().position(|entry| entry.relative_path.is_empty()) {
            tree.swap(0, index);
        }
        Ok(ScannedTarget {
            target_type: Some(TargetEntryType::Directory),
            tree,
            skill_md,
        })
    }

    pub(super) fn copy_root_directory(
        root: &RootHandle,
        destination: &Path,
    ) -> Result<(), SkillStoreError> {
        let file = root.file.try_clone().map_err(|error| {
            SkillStoreError::io("复制暂存根句柄", Path::new("staged-skill-root"), error)
        })?;
        std::fs::create_dir(destination).map_err(|error| {
            SkillStoreError::io("独占创建事务 prepared 目录", destination, error)
        })?;
        copy_directory_to(file, "staged-skill-root", "", destination)
    }

    pub(super) fn read_root_file(
        root: &RootHandle,
        relative: &str,
        offset: u64,
        length: usize,
    ) -> Result<(Vec<u8>, u64), SkillStoreError> {
        let mut components = relative.split('/').collect::<Vec<_>>();
        if components.is_empty()
            || components
                .iter()
                .any(|part| part.is_empty() || *part == "." || *part == "..")
        {
            return Err(SkillStoreError::unsafe_object(relative, "文件路径组件非法"));
        }
        let name = components.pop().expect("已检查非空");
        let mut parent = root
            .file
            .try_clone()
            .map_err(|error| SkillStoreError::io("复制暂存根句柄", Path::new(relative), error))?;
        for component in components {
            parent = open_relative(&parent, OsStr::new(component), relative)?.ok_or_else(|| {
                SkillStoreError::CandidateChanged {
                    entry_path: relative.into(),
                }
            })?;
            if !inspect_handle(&parent, relative)?.directory {
                return Err(SkillStoreError::unsafe_object(relative, "父路径不是目录"));
            }
        }
        let mut file = open_relative(&parent, OsStr::new(name), relative)?.ok_or_else(|| {
            SkillStoreError::CandidateChanged {
                entry_path: relative.into(),
            }
        })?;
        let before = inspect_handle(&file, relative)?;
        if before.directory {
            return Err(SkillStoreError::unsafe_object(relative, "对象不是普通文件"));
        }
        if offset > before.size {
            return Err(SkillStoreError::CandidateChanged {
                entry_path: relative.into(),
            });
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| SkillStoreError::io("定位暂存文件", Path::new(relative), error))?;
        let wanted = length.min((before.size - offset) as usize);
        let mut bytes = vec![0u8; wanted];
        file.read_exact(&mut bytes)
            .map_err(|error| SkillStoreError::io("读取暂存文件", Path::new(relative), error))?;
        if inspect_handle(&file, relative)? != before {
            return Err(SkillStoreError::CandidateChanged {
                entry_path: relative.into(),
            });
        }
        Ok((bytes, before.size))
    }

    pub(super) fn verify_root(root: &RootHandle, path: &Path) -> Result<(), SkillStoreError> {
        let current = open_root_path(path)?;
        if inspect_handle(&current, ".")? != root.identity {
            return Err(SkillStoreError::unsafe_object(
                ".",
                "技能库根在扫描期间被替换或修改",
            ));
        }
        Ok(())
    }

    pub(super) fn scan_target(
        root: &RootHandle,
        target_name: &str,
    ) -> Result<ScannedTarget, SkillStoreError> {
        let Some(target) = open_relative(&root.file, OsStr::new(target_name), target_name)? else {
            return Ok(ScannedTarget {
                target_type: None,
                tree: Vec::new(),
                skill_md: None,
            });
        };
        let identity = inspect_handle(&target, target_name)?;
        if identity.directory {
            let mut tree = Vec::new();
            let mut skill_md = None;
            scan_directory(target, target_name, "", &mut tree, &mut skill_md)?;
            tree.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
            if let Some(index) = tree.iter().position(|entry| entry.relative_path.is_empty()) {
                tree.swap(0, index);
            }
            Ok(ScannedTarget {
                target_type: Some(TargetEntryType::Directory),
                tree,
                skill_md,
            })
        } else {
            let mut file = target;
            let before = inspect_handle(&file, target_name)?;
            let hash = hash_open_file(&mut file).map_err(|error| {
                SkillStoreError::io("读取技能目标", Path::new(target_name), error)
            })?;
            let after = inspect_handle(&file, target_name)?;
            if before != after {
                return Err(SkillStoreError::TargetChanged {
                    target_name: target_name.into(),
                });
            }
            Ok(ScannedTarget {
                target_type: Some(TargetEntryType::File),
                tree: vec![tree_identity(
                    target_name,
                    TargetEntryType::File,
                    &after,
                    Some(hash),
                )],
                skill_md: None,
            })
        }
    }

    fn open_root_path(path: &Path) -> Result<File, SkillStoreError> {
        let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
        wide.push(0);
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_GENERIC_READ.0,
                FILE_SHARE_READ,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                None,
            )
        }
        .map_err(|error| SkillStoreError::io("固定技能库根", path, error))?;
        Ok(unsafe { File::from_raw_handle(handle.0 as RawHandle) })
    }

    /// 所有 target/子项都仅以单个名称相对已固定父句柄打开。OBJ_DONT_REPARSE
    /// 与 FILE_OPEN_REPARSE_POINT 共同保证组件不会被重解析；FILE_SHARE_READ
    /// 在句柄生命周期内拒绝写入和删除替换。
    fn open_relative(
        parent: &File,
        name: &OsStr,
        relative: &str,
    ) -> Result<Option<File>, SkillStoreError> {
        let mut name_wide = name.encode_wide().collect::<Vec<_>>();
        let name_bytes = name_wide
            .len()
            .checked_mul(2)
            .and_then(|bytes| u16::try_from(bytes).ok())
            .ok_or_else(|| SkillStoreError::unsafe_object(relative, "路径组件过长"))?;
        let unicode_name = UNICODE_STRING {
            Length: name_bytes,
            MaximumLength: name_bytes,
            Buffer: PWSTR(name_wide.as_mut_ptr()),
        };
        let object_attributes = OBJECT_ATTRIBUTES {
            Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: HANDLE(parent.as_raw_handle()),
            ObjectName: &unicode_name,
            Attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
            SecurityDescriptor: std::ptr::null(),
            SecurityQualityOfService: std::ptr::null(),
        };
        let mut io_status: IO_STATUS_BLOCK = unsafe { std::mem::zeroed() };
        let mut handle = HANDLE::default();
        let status = unsafe {
            NtCreateFile(
                &mut handle,
                FILE_GENERIC_READ,
                &object_attributes,
                &mut io_status,
                None,
                Default::default(),
                FILE_SHARE_READ,
                FILE_OPEN,
                FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                None,
                0,
            )
        };
        if status == STATUS_OBJECT_NAME_NOT_FOUND || status == STATUS_OBJECT_PATH_NOT_FOUND {
            return Ok(None);
        }
        if status.0 < 0 {
            return Err(SkillStoreError::Io {
                operation: "父句柄相对打开技能对象",
                path: relative.into(),
                message: format!("NTSTATUS 0x{:08x}", status.0 as u32),
            });
        }
        Ok(Some(unsafe {
            File::from_raw_handle(handle.0 as RawHandle)
        }))
    }

    fn scan_directory(
        directory: File,
        target_name: &str,
        relative: &str,
        tree: &mut Vec<TreeIdentity>,
        skill_md: &mut Option<Vec<u8>>,
    ) -> Result<(), SkillStoreError> {
        let before = inspect_handle(&directory, relative)?;
        if !before.directory {
            return Err(SkillStoreError::unsafe_object(
                relative,
                "对象不是普通磁盘目录",
            ));
        }
        tree.push(tree_identity(
            relative,
            TargetEntryType::Directory,
            &before,
            None,
        ));

        for entry in enumerate_directory(&directory, relative)? {
            let name_text = entry.name.to_string_lossy();
            let child_relative = if relative.is_empty() {
                name_text.into_owned()
            } else {
                format!("{relative}/{name_text}")
            };
            let child =
                open_relative(&directory, &entry.name, &child_relative)?.ok_or_else(|| {
                    SkillStoreError::TargetChanged {
                        target_name: target_name.into(),
                    }
                })?;
            let child_identity = inspect_handle(&child, &child_relative)?;
            if child_identity.directory != entry.directory {
                return Err(SkillStoreError::TargetChanged {
                    target_name: target_name.into(),
                });
            }
            if child_identity.directory {
                scan_directory(child, target_name, &child_relative, tree, skill_md)?;
            } else {
                scan_file(child, target_name, &child_relative, tree, skill_md)?;
            }
        }

        if inspect_handle(&directory, relative)? != before {
            return Err(SkillStoreError::TargetChanged {
                target_name: target_name.into(),
            });
        }
        Ok(())
    }

    fn scan_file(
        mut file: File,
        target_name: &str,
        relative: &str,
        tree: &mut Vec<TreeIdentity>,
        skill_md: &mut Option<Vec<u8>>,
    ) -> Result<(), SkillStoreError> {
        let before = inspect_handle(&file, relative)?;
        if before.directory {
            return Err(SkillStoreError::unsafe_object(
                relative,
                "对象不是普通磁盘文件",
            ));
        }
        let mut captured_skill = None;
        let hash = if relative == "SKILL.md" {
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).map_err(|error| {
                SkillStoreError::io("读取现有 SKILL.md", Path::new(relative), error)
            })?;
            let digest = format!("{:x}", Sha256::digest(&bytes));
            captured_skill = Some(bytes);
            digest
        } else {
            hash_open_file(&mut file)
                .map_err(|error| SkillStoreError::io("读取技能文件", Path::new(relative), error))?
        };
        let after = inspect_handle(&file, relative)?;
        if before != after {
            return Err(SkillStoreError::TargetChanged {
                target_name: target_name.into(),
            });
        }
        if captured_skill.is_some() {
            *skill_md = captured_skill;
        }
        tree.push(tree_identity(
            relative,
            TargetEntryType::File,
            &after,
            Some(hash),
        ));
        Ok(())
    }

    fn enumerate_directory(
        directory: &File,
        relative: &str,
    ) -> Result<Vec<DirectoryEntry>, SkillStoreError> {
        let mut entries = Vec::new();
        let mut restart = true;
        loop {
            // u64 backing gives the variable-length FILE_ID_BOTH_DIR_INFO records
            // sufficient alignment while still allowing byte-offset parsing.
            let mut buffer = vec![0u64; DIRECTORY_BUFFER_BYTES / size_of::<u64>()];
            // try_clone/DuplicateHandle 共享同一个 file object 及其目录枚举游标。
            // 每次独立 list 的首轮必须 restart，后续轮次再从当前游标继续。
            let information_class = if restart {
                FileIdBothRestartDirectoryInfo
            } else {
                FileIdBothDirectoryInfo
            };
            let result = unsafe {
                GetFileInformationByHandleEx(
                    HANDLE(directory.as_raw_handle()),
                    information_class,
                    buffer.as_mut_ptr().cast(),
                    DIRECTORY_BUFFER_BYTES as u32,
                )
            };
            if let Err(error) = result {
                if error.code().0 as u32 == HRESULT_NO_MORE_FILES {
                    break;
                }
                return Err(SkillStoreError::io(
                    "枚举技能目录句柄",
                    Path::new(relative),
                    error,
                ));
            }
            restart = false;

            let bytes = unsafe {
                std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), DIRECTORY_BUFFER_BYTES)
            };
            let mut offset = 0usize;
            loop {
                let header_size = offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
                if offset
                    .checked_add(header_size)
                    .is_none_or(|end| end > bytes.len())
                {
                    return Err(SkillStoreError::unsafe_object(relative, "目录枚举记录越界"));
                }
                let record = unsafe {
                    std::ptr::read_unaligned(
                        bytes.as_ptr().add(offset).cast::<FILE_ID_BOTH_DIR_INFO>(),
                    )
                };
                let name_bytes = record.FileNameLength as usize;
                if name_bytes % 2 != 0
                    || offset
                        .checked_add(header_size)
                        .and_then(|start| start.checked_add(name_bytes))
                        .is_none_or(|end| end > bytes.len())
                {
                    return Err(SkillStoreError::unsafe_object(
                        relative,
                        "目录项名称记录非法",
                    ));
                }
                let name_start = offset + header_size;
                let wide = bytes[name_start..name_start + name_bytes]
                    .chunks_exact(2)
                    .map(|pair| u16::from_ne_bytes([pair[0], pair[1]]))
                    .collect::<Vec<_>>();
                let name = String::from_utf16(&wide).map_err(|_| {
                    SkillStoreError::unsafe_object(relative, "路径必须是有效 Unicode")
                })?;
                if name != "." && name != ".." {
                    if name.is_empty() || name.contains(['/', '\\']) {
                        return Err(SkillStoreError::unsafe_object(
                            relative,
                            "包含不安全路径组件",
                        ));
                    }
                    if record.FileAttributes
                        & (FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_DEVICE.0)
                        != 0
                    {
                        return Err(SkillStoreError::unsafe_object(
                            if relative.is_empty() {
                                name.clone()
                            } else {
                                format!("{relative}/{name}")
                            },
                            "不允许重解析点或特殊对象",
                        ));
                    }
                    entries.push(DirectoryEntry {
                        name: OsString::from(name),
                        directory: record.FileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0,
                    });
                }
                if record.NextEntryOffset == 0 {
                    break;
                }
                let next = record.NextEntryOffset as usize;
                if next < header_size
                    || offset
                        .checked_add(next)
                        .is_none_or(|next| next >= bytes.len())
                {
                    return Err(SkillStoreError::unsafe_object(
                        relative,
                        "目录枚举链偏移非法",
                    ));
                }
                offset += next;
            }
        }
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(entries)
    }

    fn inspect_handle(file: &File, relative: &str) -> Result<HandleIdentity, SkillStoreError> {
        let handle = HANDLE(file.as_raw_handle());
        if unsafe { GetFileType(handle) } != FILE_TYPE_DISK {
            return Err(SkillStoreError::unsafe_object(
                relative,
                "对象不是磁盘文件或目录",
            ));
        }
        let mut basic = FILE_BASIC_INFO::default();
        let mut standard = FILE_STANDARD_INFO::default();
        let mut id = FILE_ID_INFO::default();
        unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileBasicInfo,
                (&mut basic as *mut FILE_BASIC_INFO).cast(),
                size_of::<FILE_BASIC_INFO>() as u32,
            )
            .and_then(|_| {
                GetFileInformationByHandleEx(
                    handle,
                    FileStandardInfo,
                    (&mut standard as *mut FILE_STANDARD_INFO).cast(),
                    size_of::<FILE_STANDARD_INFO>() as u32,
                )
            })
            .and_then(|_| {
                GetFileInformationByHandleEx(
                    handle,
                    FileIdInfo,
                    (&mut id as *mut FILE_ID_INFO).cast(),
                    size_of::<FILE_ID_INFO>() as u32,
                )
            })
        }
        .map_err(|error| {
            SkillStoreError::io("复核 Windows 技能对象句柄", Path::new(relative), error)
        })?;
        if basic.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_DEVICE.0) != 0
            || standard.EndOfFile < 0
        {
            return Err(SkillStoreError::unsafe_object(
                relative,
                "不允许重解析点或特殊对象",
            ));
        }
        Ok(HandleIdentity {
            volume: id.VolumeSerialNumber,
            file_id_low: u64::from_le_bytes(id.FileId.Identifier[..8].try_into().unwrap()),
            file_id_high: u64::from_le_bytes(id.FileId.Identifier[8..].try_into().unwrap()),
            size: standard.EndOfFile as u64,
            modified: basic.LastWriteTime,
            changed: basic.ChangeTime,
            directory: standard.Directory,
        })
    }

    pub(super) fn copy_target_directory(
        root: &RootHandle,
        target_name: &str,
        destination: &Path,
    ) -> Result<(), SkillStoreError> {
        let target =
            open_relative(&root.file, OsStr::new(target_name), target_name)?.ok_or_else(|| {
                SkillStoreError::TargetChanged {
                    target_name: target_name.into(),
                }
            })?;
        let identity = inspect_handle(&target, target_name)?;
        if !identity.directory {
            return Err(SkillStoreError::unsafe_object(
                target_name,
                "物化来源不是普通磁盘目录或包含重解析点",
            ));
        }
        std::fs::create_dir(destination)
            .map_err(|error| SkillStoreError::io("独占创建物化技能目录", destination, error))?;
        copy_directory_to(target, target_name, "", destination)
    }

    fn copy_directory_to(
        directory: File,
        target_name: &str,
        relative: &str,
        destination: &Path,
    ) -> Result<(), SkillStoreError> {
        let before = inspect_handle(&directory, relative)?;
        if !before.directory {
            return Err(SkillStoreError::unsafe_object(
                relative,
                "对象不是普通磁盘目录或包含重解析点",
            ));
        }
        for entry in enumerate_directory(&directory, relative)? {
            let text = entry.name.to_string_lossy();
            let child_relative = if relative.is_empty() {
                text.into_owned()
            } else {
                format!("{relative}/{text}")
            };
            let child =
                open_relative(&directory, &entry.name, &child_relative)?.ok_or_else(|| {
                    SkillStoreError::TargetChanged {
                        target_name: target_name.into(),
                    }
                })?;
            let child_before = inspect_handle(&child, &child_relative)?;
            if child_before.directory != entry.directory {
                return Err(SkillStoreError::unsafe_object(
                    child_relative,
                    "对象类型变化或包含重解析点",
                ));
            }
            let output = destination.join(&entry.name);
            if child_before.directory {
                std::fs::create_dir(&output)
                    .map_err(|error| SkillStoreError::io("独占创建物化子目录", &output, error))?;
                copy_directory_to(child, target_name, &child_relative, &output)?;
            } else {
                let mut source = child;
                let mut target = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&output)
                    .map_err(|error| SkillStoreError::io("独占创建物化技能文件", &output, error))?;
                io::copy(&mut source, &mut target).map_err(|error| {
                    SkillStoreError::io("从固定句柄复制技能文件", Path::new(&child_relative), error)
                })?;
                target
                    .sync_all()
                    .map_err(|error| SkillStoreError::io("同步物化技能文件", &output, error))?;
                if inspect_handle(&source, &child_relative)? != child_before {
                    return Err(SkillStoreError::TargetChanged {
                        target_name: target_name.into(),
                    });
                }
            }
        }
        if inspect_handle(&directory, relative)? != before {
            return Err(SkillStoreError::TargetChanged {
                target_name: target_name.into(),
            });
        }
        Ok(())
    }

    fn tree_identity(
        relative_path: &str,
        entry_type: TargetEntryType,
        identity: &HandleIdentity,
        content_sha256: Option<String>,
    ) -> TreeIdentity {
        let (modified_seconds, modified_nanos) = split_windows_time(identity.modified);
        let (changed_seconds, changed_nanos) = split_windows_time(identity.changed);
        // TreeIdentity 的旧 IPC 形态只有两个 object 槽；baseline 内部比较仍使用
        // 完整 128-bit file id，上层稳定快照以 volume + 两半异或携带对象身份。
        TreeIdentity {
            relative_path: relative_path.into(),
            entry_type,
            object_a: identity.volume,
            object_b: identity.file_id_low ^ identity.file_id_high.rotate_left(1),
            size: identity.size,
            modified_seconds,
            modified_nanos,
            changed_seconds,
            changed_nanos,
            content_sha256,
        }
    }

    fn split_windows_time(value: i64) -> (i64, i64) {
        (
            value.div_euclid(10_000_000),
            value.rem_euclid(10_000_000) * 100,
        )
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use super::*;

    pub(super) struct RootHandle;

    fn unsupported() -> SkillStoreError {
        SkillStoreError::unsafe_object(".", "当前平台不支持安全技能库句柄")
    }

    pub(super) fn open_root(_path: &Path) -> Result<RootHandle, SkillStoreError> {
        Err(unsupported())
    }

    pub(super) fn open_child_root(_path: &Path) -> Result<RootHandle, SkillStoreError> {
        Err(unsupported())
    }

    pub(super) fn root_identity(_root: &RootHandle) -> Result<TreeIdentity, SkillStoreError> {
        Err(unsupported())
    }

    pub(super) fn scan_root(_root: &RootHandle) -> Result<ScannedTarget, SkillStoreError> {
        Err(unsupported())
    }

    pub(super) fn copy_root_directory(
        _root: &RootHandle,
        _destination: &Path,
    ) -> Result<(), SkillStoreError> {
        Err(unsupported())
    }

    pub(super) fn read_root_file(
        _root: &RootHandle,
        _relative: &str,
        _offset: u64,
        _length: usize,
    ) -> Result<(Vec<u8>, u64), SkillStoreError> {
        Err(unsupported())
    }

    pub(super) fn verify_root(_root: &RootHandle, _path: &Path) -> Result<(), SkillStoreError> {
        Err(unsupported())
    }

    pub(super) fn scan_target(
        _root: &RootHandle,
        _target_name: &str,
    ) -> Result<ScannedTarget, SkillStoreError> {
        Err(unsupported())
    }

    pub(super) fn copy_target_directory(
        _root: &RootHandle,
        _target_name: &str,
        _destination: &Path,
    ) -> Result<(), SkillStoreError> {
        Err(unsupported())
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

    /// macOS CI 无法执行 Win32 API，但仍锁定首轮 restart、后续 continue 的源码契约。
    #[cfg(target_os = "macos")]
    #[test]
    fn windows_directory_enumeration_restart_contract_is_present() {
        let source = include_str!("store.rs");
        assert!(source.contains(
            "const FileIdBothRestartDirectoryInfo: FILE_INFO_BY_HANDLE_CLASS = FILE_INFO_BY_HANDLE_CLASS(11);"
        ));
        let start = source.find("    fn enumerate_directory(").unwrap();
        let end = source[start..].find("\n    fn inspect_handle(").unwrap() + start;
        let body = &source[start..end];
        let restart = body.find("let mut restart = true;").unwrap();
        let first_class = body.find("FileIdBothRestartDirectoryInfo").unwrap();
        let later_class = body.find("FileIdBothDirectoryInfo").unwrap();
        let consume = body.find("restart = false;").unwrap();
        assert!(restart < first_class && first_class < later_class && later_class < consume);
    }
}
