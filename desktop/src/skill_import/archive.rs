//! ZIP 技能来源的安全、有界索引、发现与逐技能暂存。
//!
//! 在调用 `zip` crate 建立内部索引之前，本模块先从固定归档句柄的尾部窗口解析
//! EOCD/Zip64，并逐项、流式校验中央目录。只有归档大小、中央目录大小、条目数和
//! 所有偏移均已受限后，才允许 crate 分配索引。归档内容始终从最初打开的句柄读取。

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crc32fast::Hasher as Crc32Hasher;
use flate2::read::DeflateDecoder;
use flate2::{Decompress, FlushDecompress, Status};
use unicode_normalization::UnicodeNormalization as _;

use super::folder::{FolderBatchUsage, FolderEntryKind};
use super::lease::{LeaseError, SourceKey, SourceReservation, StagingQuota, UnboundedStagingQuota};
use super::model::{
    MAX_BYTES_PER_BATCH, MAX_BYTES_PER_FILE, MAX_BYTES_PER_SKILL, MAX_ENTRIES_PER_BATCH,
    MAX_ENTRIES_PER_SKILL, MAX_ENTRIES_PER_ZIP_SOURCE, MAX_PATH_DEPTH, MAX_SKILLS_PER_BATCH,
    MAX_SKILL_MD_BYTES, MAX_ZIP_METADATA_BYTES, MAX_ZIP_SOURCE_BYTES,
};

const SKILL_FILE: &str = "SKILL.md";
const EOCD_SIGNATURE: u32 = 0x0605_4b50;
const ZIP64_LOCATOR_SIGNATURE: u32 = 0x0706_4b50;
const ZIP64_EOCD_SIGNATURE: u32 = 0x0606_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const DATA_DESCRIPTOR_SIGNATURE: u32 = 0x0807_4b50;
const EOCD_BYTES: u64 = 22;
const MAX_EOCD_SEARCH_BYTES: u64 = EOCD_BYTES + u16::MAX as u64;
const COPY_BUFFER_BYTES: usize = 64 * 1024;

/// 与 `StagedFolderSource` 等价的 ZIP 壳侧结果。所有绝对路径类型刻意不实现
/// `Serialize`；后续任务只需把相对路径、entry 和 fallback name 转为预览模型。
#[derive(Debug)]
pub(crate) struct StagedArchiveSource {
    pub skills: Vec<StagedArchiveSkill>,
    pub entry_count: usize,
    pub total_size: u64,
    pub fingerprint: ArchiveSourceFingerprint,
}

#[derive(Debug)]
pub(crate) struct StagedArchiveSkill {
    pub relative_root: String,
    pub fallback_name: String,
    pub staged_root: Option<PathBuf>,
    pub entries: Vec<StagedArchiveEntry>,
    pub entry_count: usize,
    pub total_size: u64,
    pub invalid_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StagedArchiveEntry {
    pub relative_path: String,
    pub kind: FolderEntryKind,
    pub size: u64,
    pub platform_executable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ArchiveSourceFingerprint {
    identity: ArchiveIdentity,
    archive_size: u64,
    central_offset: u64,
    central_size: u64,
    entry_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ArchiveIdentity {
    object_a: u64,
    object_b: u64,
    object_c: u64,
    size: u64,
    modified_seconds: i64,
    modified_nanos: i64,
    changed_seconds: i64,
    changed_nanos: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct ArchivePath(String);

impl ArchivePath {
    fn root() -> Self {
        Self(String::new())
    }

    fn display(&self) -> &str {
        if self.0.is_empty() {
            "."
        } else {
            &self.0
        }
    }

    fn depth(&self) -> usize {
        if self.0.is_empty() {
            0
        } else {
            self.0.split('/').count()
        }
    }

    fn file_name(&self) -> &str {
        self.0.rsplit('/').next().unwrap_or("")
    }

    fn parent(&self) -> Self {
        self.0
            .rsplit_once('/')
            .map(|(parent, _)| Self(parent.to_string()))
            .unwrap_or_else(Self::root)
    }

    fn is_descendant_of(&self, root: &Self) -> bool {
        if root.0.is_empty() {
            return !self.0.is_empty();
        }
        self.0
            .strip_prefix(&root.0)
            .is_some_and(|suffix| suffix.starts_with('/'))
    }

    fn relative_to(&self, root: &Self) -> String {
        if root.0.is_empty() {
            return self.0.clone();
        }
        self.0
            .strip_prefix(&root.0)
            .and_then(|suffix| suffix.strip_prefix('/'))
            .unwrap_or("")
            .to_string()
    }

    fn to_path_buf(&self) -> PathBuf {
        let mut output = PathBuf::new();
        for component in self.0.split('/').filter(|component| !component.is_empty()) {
            output.push(component);
        }
        output
    }

    fn ancestors_inclusive(&self) -> Vec<Self> {
        if self.0.is_empty() {
            return vec![Self::root()];
        }
        let mut output = Vec::with_capacity(self.depth());
        let mut value = String::new();
        for component in self.0.split('/') {
            if !value.is_empty() {
                value.push('/');
            }
            value.push_str(component);
            output.push(Self(value.clone()));
        }
        output
    }
}

#[derive(Clone, Copy, Debug)]
struct ArchiveLimits {
    archive_bytes: u64,
    metadata_bytes: u64,
    archive_entries: usize,
    entries_per_skill: usize,
    bytes_per_skill: u64,
    bytes_per_file: u64,
    skill_md_bytes: u64,
    entries_per_batch: usize,
    bytes_per_batch: u64,
    copy_buffer_bytes: usize,
}

impl ArchiveLimits {
    const fn production() -> Self {
        Self {
            archive_bytes: MAX_ZIP_SOURCE_BYTES,
            metadata_bytes: MAX_ZIP_METADATA_BYTES,
            archive_entries: MAX_ENTRIES_PER_ZIP_SOURCE,
            entries_per_skill: MAX_ENTRIES_PER_SKILL,
            bytes_per_skill: MAX_BYTES_PER_SKILL,
            bytes_per_file: MAX_BYTES_PER_FILE,
            skill_md_bytes: MAX_SKILL_MD_BYTES,
            entries_per_batch: MAX_ENTRIES_PER_BATCH,
            bytes_per_batch: MAX_BYTES_PER_BATCH,
            copy_buffer_bytes: COPY_BUFFER_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ArchiveImportError {
    SourceNotFile,
    SourceTooLarge,
    MetadataTooLarge,
    TooManyEntries,
    MalformedArchive {
        reason: &'static str,
    },
    EncryptedEntry {
        relative_path: String,
    },
    UnsupportedCompression {
        relative_path: String,
        method: u16,
    },
    UnsafeEntry {
        relative_path: String,
        reason: &'static str,
    },
    PathTooDeep {
        relative_path: String,
    },
    DuplicatePath {
        relative_path: String,
    },
    TargetCollision {
        relative_path: String,
    },
    BatchSkillsExceeded,
    BatchEntriesExceeded,
    BatchBytesExceeded,
    ConfigQuotaExceeded {
        message: String,
    },
    SourceChanged,
    CleanupFailed {
        relative_path: String,
        message: String,
    },
    Io {
        operation: &'static str,
        relative_path: String,
        message: String,
    },
    UnsupportedPlatformSafety,
}

impl ArchiveImportError {
    fn malformed(reason: &'static str) -> Self {
        Self::MalformedArchive { reason }
    }

    fn unsafe_entry(path: &ArchivePath, reason: &'static str) -> Self {
        Self::UnsafeEntry {
            relative_path: path.display().to_string(),
            reason,
        }
    }

    fn io(operation: &'static str, relative_path: &str, error: impl fmt::Display) -> Self {
        Self::Io {
            operation,
            relative_path: relative_path.to_string(),
            message: error.to_string(),
        }
    }
}

impl fmt::Display for ArchiveImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceNotFile => write!(formatter, "所选 ZIP 不是普通磁盘文件"),
            Self::SourceTooLarge => write!(formatter, "ZIP 文件超过 500 MiB"),
            Self::MetadataTooLarge => write!(formatter, "ZIP 中央目录超过 32 MiB"),
            Self::TooManyEntries => write!(formatter, "ZIP 条目超过 10000 个"),
            Self::MalformedArchive { reason } => write!(formatter, "ZIP 结构损坏: {reason}"),
            Self::EncryptedEntry { relative_path } => {
                write!(formatter, "ZIP 条目 {relative_path} 已加密")
            }
            Self::UnsupportedCompression {
                relative_path,
                method,
            } => write!(
                formatter,
                "ZIP 条目 {relative_path} 使用不支持的压缩方式 {method}"
            ),
            Self::UnsafeEntry {
                relative_path,
                reason,
            } => write!(formatter, "ZIP 条目 {relative_path} 不安全: {reason}"),
            Self::PathTooDeep { relative_path } => {
                write!(formatter, "ZIP 路径超过 64 层: {relative_path}")
            }
            Self::DuplicatePath { relative_path } => {
                write!(formatter, "ZIP 包含重复逻辑路径: {relative_path}")
            }
            Self::TargetCollision { relative_path } => {
                write!(formatter, "ZIP 暂存目标存在名称或类型碰撞: {relative_path}")
            }
            Self::BatchSkillsExceeded => write!(formatter, "批次检测技能超过 100 个"),
            Self::BatchEntriesExceeded => write!(formatter, "批次暂存条目超过上限"),
            Self::BatchBytesExceeded => write!(formatter, "批次暂存大小超过上限"),
            Self::ConfigQuotaExceeded { message } => write!(formatter, "{message}"),
            Self::SourceChanged => write!(formatter, "ZIP 来源句柄在检查后发生变化"),
            Self::CleanupFailed {
                relative_path,
                message,
            } => write!(
                formatter,
                "清理 ZIP 暂存对象 {relative_path} 失败: {message}"
            ),
            Self::Io {
                operation,
                relative_path,
                message,
            } => write!(formatter, "{operation} {relative_path} 失败: {message}"),
            Self::UnsupportedPlatformSafety => write!(formatter, "当前平台无法保证安全打开 ZIP"),
        }
    }
}

impl std::error::Error for ArchiveImportError {}

impl From<LeaseError> for ArchiveImportError {
    fn from(error: LeaseError) -> Self {
        Self::ConfigQuotaExceeded {
            message: error.to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CentralDirectoryBounds {
    offset: u64,
    size: u64,
    entries: usize,
    eocd_offset: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct IndexedEntry {
    archive_index: usize,
    raw_name: Vec<u8>,
    path: ArchivePath,
    kind: FolderEntryKind,
    flags: u16,
    compression_method: u16,
    compressed_size: u64,
    uncompressed_size: u64,
    uses_zip64_sizes: bool,
    local_header_offset: u64,
    data_offset: u64,
    crc32: u32,
    platform_executable: bool,
}

#[derive(Debug)]
struct SafeArchiveIndex {
    bounds: CentralDirectoryBounds,
    entries: Vec<IndexedEntry>,
}

#[derive(Debug, Default)]
struct ArchiveAliasTrie {
    children: HashMap<String, ArchiveAliasNode>,
}

#[derive(Debug)]
struct ArchiveAliasNode {
    original_component: String,
    kind: FolderEntryKind,
    children: HashMap<String, ArchiveAliasNode>,
}

impl ArchiveAliasTrie {
    fn insert(
        &mut self,
        path: &ArchivePath,
        final_kind: FolderEntryKind,
    ) -> Result<(), ArchiveImportError> {
        let mut children = &mut self.children;
        let components = path.0.split('/').collect::<Vec<_>>();
        let mut walked = String::new();
        for (index, component) in components.iter().enumerate() {
            if !walked.is_empty() {
                walked.push('/');
            }
            walked.push_str(component);
            let alias = component
                .nfd()
                .flat_map(char::to_lowercase)
                .collect::<String>();
            let expected_kind = if index + 1 == components.len() {
                final_kind
            } else {
                FolderEntryKind::Directory
            };
            let node = children.entry(alias).or_insert_with(|| ArchiveAliasNode {
                original_component: (*component).to_string(),
                kind: expected_kind,
                children: HashMap::new(),
            });
            if node.original_component != *component || node.kind != expected_kind {
                return Err(ArchiveImportError::TargetCollision {
                    relative_path: walked,
                });
            }
            children = &mut node.children;
        }
        Ok(())
    }
}

#[derive(Debug)]
struct SkillPlan {
    root: ArchivePath,
    objects: BTreeMap<ArchivePath, FolderEntryKind>,
    files: Vec<usize>,
}

/// 安全打开、完整索引、发现并暂存 ZIP。`batch_usage` 只在整个来源成功后更新。
pub(crate) fn stage_archive_source(
    source_path: &Path,
    staging_root: &Path,
    batch_usage: &mut FolderBatchUsage,
) -> Result<StagedArchiveSource, ArchiveImportError> {
    stage_archive_source_inner(
        source_path,
        staging_root,
        batch_usage,
        ArchiveLimits::production(),
        None,
    )
}

/// 生产状态层入口：使用来源级跨实例 reservation，并在创建每个对象和写入每段
/// 解压数据前增量记账。
pub(crate) fn stage_archive_source_with_reservation(
    source_path: &Path,
    batch_usage: &mut FolderBatchUsage,
    reservation: &mut SourceReservation,
) -> Result<StagedArchiveSource, ArchiveImportError> {
    let staging_root = reservation.staging_root().to_path_buf();
    stage_archive_source_inner_with_quota(
        source_path,
        &staging_root,
        batch_usage,
        ArchiveLimits::production(),
        None,
        None,
        reservation,
    )
}

impl ArchiveSourceFingerprint {
    pub(crate) fn source_key(&self) -> SourceKey {
        SourceKey::archive_identity(
            self.identity.object_a,
            self.identity.object_b,
            self.identity.object_c,
        )
    }
}

/// commit 预检重新安全打开并解析有界索引，且复核固定句柄和选择路径仍指向同一
/// 普通磁盘文件。这里只比较壳侧指纹，绝不返回来源绝对路径。
pub(crate) fn verify_archive_source_fingerprint(
    source_path: &Path,
    expected: &ArchiveSourceFingerprint,
) -> Result<(), ArchiveImportError> {
    let mut opened = platform::open_archive(source_path)?;
    if opened.identity().size > MAX_ZIP_SOURCE_BYTES {
        return Err(ArchiveImportError::SourceTooLarge);
    }
    let index = index_archive(opened.file_mut(), ArchiveLimits::production())?;
    platform::verify_handle(&opened)?;
    platform::verify_source(&opened)?;
    let actual = ArchiveSourceFingerprint {
        identity: opened.identity().clone(),
        archive_size: opened.identity().size,
        central_offset: index.bounds.offset,
        central_size: index.bounds.size,
        entry_count: index.bounds.entries,
    };
    if &actual != expected {
        return Err(ArchiveImportError::SourceChanged);
    }
    Ok(())
}

type CleanupHook<'a> = dyn Fn(&Path) -> io::Result<()> + 'a;

fn stage_archive_source_inner(
    source_path: &Path,
    staging_root: &Path,
    batch_usage: &mut FolderBatchUsage,
    limits: ArchiveLimits,
    cleanup_hook: Option<&CleanupHook<'_>>,
) -> Result<StagedArchiveSource, ArchiveImportError> {
    let mut quota = UnboundedStagingQuota::default();
    stage_archive_source_inner_with_quota(
        source_path,
        staging_root,
        batch_usage,
        limits,
        cleanup_hook,
        None,
        &mut quota,
    )
}

fn stage_archive_source_inner_with_hook(
    source_path: &Path,
    staging_root: &Path,
    batch_usage: &mut FolderBatchUsage,
    limits: ArchiveLimits,
    cleanup_hook: Option<&CleanupHook<'_>>,
    after_index: Option<&dyn Fn()>,
) -> Result<StagedArchiveSource, ArchiveImportError> {
    let mut quota = UnboundedStagingQuota::default();
    stage_archive_source_inner_with_quota(
        source_path,
        staging_root,
        batch_usage,
        limits,
        cleanup_hook,
        after_index,
        &mut quota,
    )
}

#[allow(clippy::too_many_arguments)]
fn stage_archive_source_inner_with_quota(
    source_path: &Path,
    staging_root: &Path,
    batch_usage: &mut FolderBatchUsage,
    limits: ArchiveLimits,
    cleanup_hook: Option<&CleanupHook<'_>>,
    after_index: Option<&dyn Fn()>,
    quota: &mut dyn StagingQuota,
) -> Result<StagedArchiveSource, ArchiveImportError> {
    let mut opened = platform::open_archive(source_path)?;
    if opened.identity().size > limits.archive_bytes {
        return Err(ArchiveImportError::SourceTooLarge);
    }
    let index = index_archive(opened.file_mut(), limits)?;
    if let Some(hook) = after_index {
        hook();
    }
    platform::verify_handle(&opened)?;

    let skill_roots = discover_archive_skill_paths(&index.entries);
    if batch_usage.skills + skill_roots.len() > MAX_SKILLS_PER_BATCH {
        return Err(ArchiveImportError::BatchSkillsExceeded);
    }
    let fingerprint = ArchiveSourceFingerprint {
        identity: opened.identity().clone(),
        archive_size: opened.identity().size,
        central_offset: index.bounds.offset,
        central_size: index.bounds.size,
        entry_count: index.bounds.entries,
    };
    if skill_roots.is_empty() {
        platform::verify_source(&opened)?;
        return Ok(StagedArchiveSource {
            skills: Vec::new(),
            entry_count: 0,
            total_size: 0,
            fingerprint,
        });
    }

    let source_skill_count = skill_roots.len();
    let plans = skill_roots
        .into_iter()
        .map(|root| plan_skill(&index.entries, root, limits.entries_per_skill))
        .collect::<Result<Vec<_>, _>>()?;
    let valid_plan_roots = plans
        .iter()
        .filter(|plan| plan.objects.len() <= limits.entries_per_skill)
        .map(|plan| plan.root.clone())
        .collect::<Vec<_>>();
    let remaining_batch_entries = limits.entries_per_batch.saturating_sub(batch_usage.entries);
    let planned_paths = staged_source_objects(&plans, &valid_plan_roots, remaining_batch_entries)?;
    let starting_usage = *batch_usage;

    preflight_target(staging_root, &planned_paths)?;
    let before_root_entry = quota.checkpoint();
    if planned_paths.contains_key(&ArchivePath::root()) {
        quota.reserve_entries(1)?;
    }
    create_staging_root(staging_root)?;
    let mut guard = ArchiveStagingGuard::new(staging_root, cleanup_hook);
    let stem = archive_stem(source_path);

    let operation = (|| {
        let mut skills = Vec::with_capacity(plans.len());
        let mut successful_roots = Vec::new();
        let mut source_bytes = 0u64;

        for plan in plans {
            let quota_checkpoint = if plan.root == ArchivePath::root() {
                before_root_entry
            } else {
                quota.checkpoint()
            };
            let entry_count = plan.objects.len();
            let fallback_name = if plan.root.0.is_empty() {
                stem.clone()
            } else {
                plan.root.file_name().to_string()
            };
            if entry_count > limits.entries_per_skill {
                skills.push(invalid_skill(
                    &plan.root,
                    fallback_name,
                    "技能条目数超过 1000 个",
                    entry_count,
                ));
                continue;
            }

            let result = extract_one_skill(
                &opened,
                &index.entries,
                staging_root,
                &plan,
                starting_usage,
                source_bytes,
                limits,
                &mut guard.created_directories,
                quota,
            );
            match result {
                Ok(skill) => {
                    source_bytes += skill.total_size;
                    successful_roots.push(plan.root);
                    skills.push(StagedArchiveSkill {
                        fallback_name,
                        ..skill
                    });
                }
                Err(ExtractSkillError::Invalid(reason)) => {
                    let target = staging_root.join(plan.root.to_path_buf());
                    if let Err(error) =
                        cleanup_skill_target(staging_root, &target, &plan.root, cleanup_hook)
                    {
                        guard.preserve();
                        return Err(error);
                    }
                    guard
                        .created_directories
                        .retain(|path| fs::symlink_metadata(path).is_ok());
                    quota.rollback_to(quota_checkpoint)?;
                    skills.push(invalid_skill(
                        &plan.root,
                        fallback_name,
                        reason,
                        entry_count,
                    ));
                }
                Err(ExtractSkillError::Source(error)) => return Err(error),
            }
        }

        platform::verify_handle(&opened)?;
        let actual_paths = staged_source_objects_from_entries(
            &index.entries,
            &successful_roots,
            limits
                .entries_per_batch
                .saturating_sub(starting_usage.entries),
            limits.entries_per_skill,
        )?;
        Ok((
            StagedArchiveSource {
                skills,
                entry_count: actual_paths.len(),
                total_size: source_bytes,
                fingerprint,
            },
            FolderBatchUsage {
                skills: source_skill_count,
                entries: actual_paths.len(),
                bytes: source_bytes,
            },
        ))
    })();

    let operation = operation.and_then(|value| {
        platform::verify_source(&opened)?;
        Ok(value)
    });
    match operation {
        Ok((staged, source_usage)) => {
            *batch_usage = FolderBatchUsage {
                skills: starting_usage.skills + source_usage.skills,
                entries: starting_usage.entries + source_usage.entries,
                bytes: starting_usage.bytes + source_usage.bytes,
            };
            guard.commit();
            Ok(staged)
        }
        Err(error) => {
            if matches!(error, ArchiveImportError::CleanupFailed { .. }) {
                guard.preserve();
                return Err(error);
            }
            match guard.cleanup_explicit() {
                Ok(()) => Err(error),
                Err(cleanup_error) => Err(cleanup_error),
            }
        }
    }
}

fn index_archive(
    file: &mut File,
    limits: ArchiveLimits,
) -> Result<SafeArchiveIndex, ArchiveImportError> {
    let archive_size = file
        .metadata()
        .map_err(|error| ArchiveImportError::io("读取 ZIP 句柄元数据", ".", error))?
        .len();
    parse_archive_index_candidates(file, archive_size, limits)
}

fn parse_archive_index_candidates(
    file: &mut File,
    archive_size: u64,
    limits: ArchiveLimits,
) -> Result<SafeArchiveIndex, ArchiveImportError> {
    if archive_size < EOCD_BYTES {
        return Err(ArchiveImportError::malformed("缺少 EOCD"));
    }
    let tail_len = archive_size.min(MAX_EOCD_SEARCH_BYTES) as usize;
    let mut tail = vec![0u8; tail_len];
    file.seek(SeekFrom::Start(archive_size - tail_len as u64))
        .and_then(|_| file.read_exact(&mut tail))
        .map_err(|error| ArchiveImportError::io("读取 ZIP 尾部", ".", error))?;

    let mut last_error = ArchiveImportError::malformed("EOCD 无效");
    for offset in (0..=tail_len.saturating_sub(EOCD_BYTES as usize)).rev() {
        if le_u32(&tail[offset..offset + 4]) != EOCD_SIGNATURE {
            continue;
        }
        let comment_len = le_u16(&tail[offset + 20..offset + 22]) as usize;
        if offset + EOCD_BYTES as usize + comment_len == tail_len {
            let eocd_offset = archive_size - tail_len as u64 + offset as u64;
            match validate_eocd_candidate(
                file,
                archive_size,
                eocd_offset,
                &tail[offset..offset + EOCD_BYTES as usize],
                limits,
            ) {
                Ok(bounds) => match parse_central_directory(file, archive_size, bounds, limits) {
                    Ok(mut entries) => {
                        match validate_local_headers(file, archive_size, bounds, &mut entries) {
                            Ok(()) => return Ok(SafeArchiveIndex { bounds, entries }),
                            Err(error @ ArchiveImportError::Io { .. }) => return Err(error),
                            Err(error) => last_error = error,
                        }
                    }
                    Err(error @ ArchiveImportError::Io { .. }) => return Err(error),
                    Err(error) => last_error = error,
                },
                Err(error @ ArchiveImportError::Io { .. }) => return Err(error),
                Err(error) => last_error = error,
            }
        }
    }
    Err(last_error)
}

fn validate_eocd_candidate(
    file: &mut File,
    archive_size: u64,
    eocd_offset: u64,
    eocd: &[u8],
    limits: ArchiveLimits,
) -> Result<CentralDirectoryBounds, ArchiveImportError> {
    let disk = le_u16(&eocd[4..6]);
    let central_disk = le_u16(&eocd[6..8]);
    let entries_disk = le_u16(&eocd[8..10]);
    let entries_total = le_u16(&eocd[10..12]);
    let size32 = le_u32(&eocd[12..16]);
    let offset32 = le_u32(&eocd[16..20]);
    if disk != 0 || central_disk != 0 || entries_disk != entries_total {
        return Err(ArchiveImportError::malformed("不支持多磁盘 ZIP"));
    }

    let needs_zip64 = entries_total == u16::MAX || size32 == u32::MAX || offset32 == u32::MAX;
    let (entries, size, offset, structural_end) = if needs_zip64 {
        if eocd_offset < 20 {
            return Err(ArchiveImportError::malformed("缺少 Zip64 locator"));
        }
        let locator_offset = eocd_offset - 20;
        let locator = read_exact_at::<20>(file, locator_offset, "读取 Zip64 locator")?;
        if le_u32(&locator[0..4]) != ZIP64_LOCATOR_SIGNATURE
            || le_u32(&locator[4..8]) != 0
            || le_u32(&locator[16..20]) != 1
        {
            return Err(ArchiveImportError::malformed("Zip64 locator 无效"));
        }
        let zip64_offset = le_u64(&locator[8..16]);
        if zip64_offset
            .checked_add(56)
            .is_none_or(|end| end > locator_offset)
        {
            return Err(ArchiveImportError::malformed("Zip64 EOCD 偏移越界"));
        }
        let zip64 = read_exact_at::<56>(file, zip64_offset, "读取 Zip64 EOCD")?;
        if le_u32(&zip64[0..4]) != ZIP64_EOCD_SIGNATURE {
            return Err(ArchiveImportError::malformed("Zip64 EOCD 签名无效"));
        }
        let record_payload = le_u64(&zip64[4..12]);
        if record_payload > limits.metadata_bytes {
            return Err(ArchiveImportError::MetadataTooLarge);
        }
        let record_end = zip64_offset
            .checked_add(12)
            .and_then(|value| value.checked_add(record_payload))
            .ok_or_else(|| ArchiveImportError::malformed("Zip64 EOCD 大小溢出"))?;
        if record_payload < 44 || record_end != locator_offset {
            return Err(ArchiveImportError::malformed("Zip64 EOCD 大小或边界无效"));
        }
        if le_u32(&zip64[16..20]) != 0 || le_u32(&zip64[20..24]) != 0 {
            return Err(ArchiveImportError::malformed("不支持多磁盘 Zip64"));
        }
        let entries_disk64 = le_u64(&zip64[24..32]);
        let entries64 = le_u64(&zip64[32..40]);
        if entries_disk64 != entries64 {
            return Err(ArchiveImportError::malformed("Zip64 条目计数不一致"));
        }
        (
            usize::try_from(entries64).map_err(|_| ArchiveImportError::TooManyEntries)?,
            le_u64(&zip64[40..48]),
            le_u64(&zip64[48..56]),
            zip64_offset,
        )
    } else {
        (
            entries_total as usize,
            size32 as u64,
            offset32 as u64,
            eocd_offset,
        )
    };

    if entries > limits.archive_entries {
        return Err(ArchiveImportError::TooManyEntries);
    }
    if size > limits.metadata_bytes {
        return Err(ArchiveImportError::MetadataTooLarge);
    }
    let central_end = offset
        .checked_add(size)
        .ok_or_else(|| ArchiveImportError::malformed("中央目录偏移溢出"))?;
    if central_end != structural_end || central_end > archive_size {
        return Err(ArchiveImportError::malformed("中央目录偏移或大小越界"));
    }
    if entries > 0 && size < entries as u64 * 46 {
        return Err(ArchiveImportError::malformed("中央目录小于条目固定头"));
    }
    Ok(CentralDirectoryBounds {
        offset,
        size,
        entries,
        eocd_offset,
    })
}

fn parse_central_directory(
    file: &mut File,
    archive_size: u64,
    bounds: CentralDirectoryBounds,
    _limits: ArchiveLimits,
) -> Result<Vec<IndexedEntry>, ArchiveImportError> {
    file.seek(SeekFrom::Start(bounds.offset))
        .map_err(|error| ArchiveImportError::io("定位 ZIP 中央目录", ".", error))?;
    let mut remaining = bounds.size;
    let mut output = Vec::with_capacity(bounds.entries);
    let mut exact_paths: HashMap<String, FolderEntryKind> = HashMap::with_capacity(bounds.entries);
    let mut alias_trie = ArchiveAliasTrie::default();

    for archive_index in 0..bounds.entries {
        if remaining < 46 {
            return Err(ArchiveImportError::malformed("中央目录条目被截断"));
        }
        let mut fixed = [0u8; 46];
        file.read_exact(&mut fixed)
            .map_err(|error| ArchiveImportError::io("读取 ZIP 中央目录条目", ".", error))?;
        remaining -= 46;
        if le_u32(&fixed[0..4]) != CENTRAL_SIGNATURE {
            return Err(ArchiveImportError::malformed("中央目录条目签名无效"));
        }
        let version_made_by = le_u16(&fixed[4..6]);
        let flags = le_u16(&fixed[8..10]);
        let method = le_u16(&fixed[10..12]);
        let crc32 = le_u32(&fixed[16..20]);
        let compressed32 = le_u32(&fixed[20..24]);
        let uncompressed32 = le_u32(&fixed[24..28]);
        let name_len = le_u16(&fixed[28..30]) as usize;
        let extra_len = le_u16(&fixed[30..32]) as usize;
        let comment_len = le_u16(&fixed[32..34]) as usize;
        let disk_start32 = le_u16(&fixed[34..36]);
        let external_attributes = le_u32(&fixed[38..42]);
        let local_offset32 = le_u32(&fixed[42..46]);
        let variable_len = name_len
            .checked_add(extra_len)
            .and_then(|value| value.checked_add(comment_len))
            .ok_or_else(|| ArchiveImportError::malformed("中央目录变长字段溢出"))?;
        if variable_len as u64 > remaining {
            return Err(ArchiveImportError::malformed("中央目录变长字段越界"));
        }
        let raw_name = read_bounded_vec(file, name_len, "读取 ZIP 条目名")?;
        let extra = read_bounded_vec(file, extra_len, "读取 ZIP extra field")?;
        skip_exact(file, comment_len as u64, "跳过 ZIP 条目注释")?;
        remaining -= variable_len as u64;

        let uses_zip64_sizes = compressed32 == u32::MAX || uncompressed32 == u32::MAX;
        let (compressed_size, uncompressed_size, local_header_offset, disk_start) =
            parse_zip64_extra(
                &extra,
                compressed32,
                uncompressed32,
                local_offset32,
                disk_start32,
            )?;
        if disk_start != 0 {
            return Err(ArchiveImportError::malformed("条目位于其他磁盘"));
        }
        let (path, trailing_directory) = normalize_archive_path(&raw_name, flags)?;
        if flags & 0x0001 != 0 || flags & 0x0040 != 0 || method == 99 {
            return Err(ArchiveImportError::EncryptedEntry {
                relative_path: path.display().to_string(),
            });
        }
        // 仅接受 deflate 选项位、data descriptor 与 UTF-8 位；其余补丁、
        // masked-header、保留位都不在本实现的安全语义内。
        if flags & !0x080e != 0 || (method == 0 && flags & 0x0006 != 0) {
            return Err(ArchiveImportError::malformed("条目使用不支持的通用标志位"));
        }
        if !matches!(method, 0 | 8) {
            return Err(ArchiveImportError::UnsupportedCompression {
                relative_path: path.display().to_string(),
                method,
            });
        }
        let (kind, platform_executable) = classify_entry(
            &path,
            trailing_directory,
            version_made_by,
            external_attributes,
        )?;
        if kind == FolderEntryKind::Directory && (compressed_size != 0 || uncompressed_size != 0) {
            return Err(ArchiveImportError::malformed("目录条目包含文件数据"));
        }
        if method == 0 && compressed_size != uncompressed_size {
            return Err(ArchiveImportError::malformed(
                "Store 条目压缩前后大小不一致",
            ));
        }
        if local_header_offset >= bounds.offset || local_header_offset >= archive_size {
            return Err(ArchiveImportError::malformed("本地头偏移越界"));
        }
        if exact_paths.insert(path.0.clone(), kind).is_some() {
            return Err(ArchiveImportError::DuplicatePath {
                relative_path: path.display().to_string(),
            });
        }
        alias_trie.insert(&path, kind)?;
        output.push(IndexedEntry {
            archive_index,
            raw_name,
            path,
            kind,
            flags,
            compression_method: method,
            compressed_size,
            uncompressed_size,
            uses_zip64_sizes,
            local_header_offset,
            data_offset: 0,
            crc32,
            platform_executable,
        });
    }
    if remaining != 0 {
        return Err(ArchiveImportError::malformed("中央目录含未声明或多余记录"));
    }
    Ok(output)
}

fn parse_zip64_extra(
    extra: &[u8],
    compressed32: u32,
    uncompressed32: u32,
    local_offset32: u32,
    disk_start32: u16,
) -> Result<(u64, u64, u64, u32), ArchiveImportError> {
    let needs_zip64 = compressed32 == u32::MAX
        || uncompressed32 == u32::MAX
        || local_offset32 == u32::MAX
        || disk_start32 == u16::MAX;
    let mut cursor = 0usize;
    let mut zip64 = None;
    while cursor < extra.len() {
        if extra.len() - cursor < 4 {
            return Err(ArchiveImportError::malformed("extra field 头被截断"));
        }
        let id = le_u16(&extra[cursor..cursor + 2]);
        let size = le_u16(&extra[cursor + 2..cursor + 4]) as usize;
        cursor += 4;
        if size > extra.len() - cursor {
            return Err(ArchiveImportError::malformed("extra field 内容越界"));
        }
        if id == 0x0001 {
            if zip64.is_some() {
                return Err(ArchiveImportError::malformed("重复 Zip64 extra field"));
            }
            zip64 = Some(&extra[cursor..cursor + size]);
        }
        cursor += size;
    }
    if !needs_zip64 {
        return Ok((
            compressed32 as u64,
            uncompressed32 as u64,
            local_offset32 as u64,
            disk_start32 as u32,
        ));
    }
    let data = zip64.ok_or_else(|| ArchiveImportError::malformed("缺少 Zip64 extra field"))?;
    let mut position = 0usize;
    let mut take_u64 = || -> Result<u64, ArchiveImportError> {
        if data.len() - position < 8 {
            return Err(ArchiveImportError::malformed("Zip64 extra field 被截断"));
        }
        let value = le_u64(&data[position..position + 8]);
        position += 8;
        Ok(value)
    };
    let uncompressed = if uncompressed32 == u32::MAX {
        take_u64()?
    } else {
        uncompressed32 as u64
    };
    let compressed = if compressed32 == u32::MAX {
        take_u64()?
    } else {
        compressed32 as u64
    };
    let local = if local_offset32 == u32::MAX {
        take_u64()?
    } else {
        local_offset32 as u64
    };
    let disk = if disk_start32 == u16::MAX {
        if data.len() - position < 4 {
            return Err(ArchiveImportError::malformed("Zip64 disk field 被截断"));
        }
        le_u32(&data[position..position + 4])
    } else {
        disk_start32 as u32
    };
    Ok((compressed, uncompressed, local, disk))
}

fn normalize_archive_path(
    raw: &[u8],
    flags: u16,
) -> Result<(ArchivePath, bool), ArchiveImportError> {
    if raw.is_empty() || raw.contains(&0) {
        return Err(ArchiveImportError::UnsafeEntry {
            relative_path: ".".into(),
            reason: "路径为空或包含 NUL",
        });
    }
    let name = decode_archive_name(raw, flags)?;
    if name.starts_with('/') || name.starts_with('\\') {
        return Err(ArchiveImportError::UnsafeEntry {
            relative_path: ".".into(),
            reason: "拒绝绝对路径或 UNC 前缀",
        });
    }
    let normalized = name.replace('\\', "/");
    if normalized.starts_with("//") {
        return Err(ArchiveImportError::UnsafeEntry {
            relative_path: ".".into(),
            reason: "拒绝 UNC 前缀",
        });
    }
    let trailing_directory = normalized.ends_with('/');
    let body = normalized.strip_suffix('/').unwrap_or(&normalized);
    if body.is_empty() {
        return Err(ArchiveImportError::UnsafeEntry {
            relative_path: ".".into(),
            reason: "路径不得指向归档虚拟根",
        });
    }
    let mut components = Vec::new();
    for component in body.split('/') {
        if component.is_empty() || component == "." {
            return Err(ArchiveImportError::UnsafeEntry {
                relative_path: body.to_string(),
                reason: "路径包含空或点组件",
            });
        }
        if component == ".." {
            return Err(ArchiveImportError::UnsafeEntry {
                relative_path: body.to_string(),
                reason: "路径包含父目录跳转",
            });
        }
        if component.contains(':') {
            return Err(ArchiveImportError::UnsafeEntry {
                relative_path: body.to_string(),
                reason: "路径包含 Windows drive 或数据流前缀",
            });
        }
        if component.ends_with(['.', ' ']) || is_windows_reserved_component(component) {
            return Err(ArchiveImportError::UnsafeEntry {
                relative_path: body.to_string(),
                reason: "路径组件会在目标卷形成 Windows 别名",
            });
        }
        components.push(component);
    }
    let path = ArchivePath(components.join("/"));
    if path.depth() > MAX_PATH_DEPTH {
        return Err(ArchiveImportError::PathTooDeep {
            relative_path: path.0,
        });
    }
    Ok((path, trailing_directory))
}

/// APPNOTE 4.4.4：general purpose bit 11 设置时文件名必须是严格 UTF-8；未设置
/// 时 ZIP 的标准兼容编码是 IBM Code Page 437。这里不做有损回退，解码完成后仍由
/// `normalize_archive_path` 执行统一的 Unicode 别名与路径安全检查。
fn decode_archive_name(raw: &[u8], flags: u16) -> Result<String, ArchiveImportError> {
    if flags & 0x0800 != 0 {
        return std::str::from_utf8(raw).map(str::to_owned).map_err(|_| {
            ArchiveImportError::UnsafeEntry {
                relative_path: ".".into(),
                reason: "UTF-8 标志位已设置但路径不是有效 UTF-8",
            }
        });
    }
    Ok(raw
        .iter()
        .map(|byte| {
            if *byte < 0x80 {
                char::from(*byte)
            } else {
                CP437_HIGH_BYTES[(*byte - 0x80) as usize]
            }
        })
        .collect())
}

// 0x80..=0xff 的完整 IBM Code Page 437 映射；0x00..=0x7f 在上面原样保留。
const CP437_HIGH_BYTES: [char; 128] = [
    'Ç', 'ü', 'é', 'â', 'ä', 'à', 'å', 'ç', 'ê', 'ë', 'è', 'ï', 'î', 'ì', 'Ä', 'Å', 'É', 'æ', 'Æ',
    'ô', 'ö', 'ò', 'û', 'ù', 'ÿ', 'Ö', 'Ü', '¢', '£', '¥', '₧', 'ƒ', 'á', 'í', 'ó', 'ú', 'ñ', 'Ñ',
    'ª', 'º', '¿', '⌐', '¬', '½', '¼', '¡', '«', '»', '░', '▒', '▓', '│', '┤', '╡', '╢', '╖', '╕',
    '╣', '║', '╗', '╝', '╜', '╛', '┐', '└', '┴', '┬', '├', '─', '┼', '╞', '╟', '╚', '╔', '╩', '╦',
    '╠', '═', '╬', '╧', '╨', '╤', '╥', '╙', '╘', '╒', '╓', '╫', '╪', '┘', '┌', '█', '▄', '▌', '▐',
    '▀', 'α', 'ß', 'Γ', 'π', 'Σ', 'σ', 'µ', 'τ', 'Φ', 'Θ', 'Ω', 'δ', '∞', 'φ', 'ε', '∩', '≡', '±',
    '≥', '≤', '⌠', '⌡', '÷', '≈', '°', '∙', '·', '√', 'ⁿ', '²', '■', '\u{00a0}',
];

fn is_windows_reserved_component(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or(component);
    matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn classify_entry(
    path: &ArchivePath,
    trailing_directory: bool,
    version_made_by: u16,
    external_attributes: u32,
) -> Result<(FolderEntryKind, bool), ArchiveImportError> {
    let system = (version_made_by >> 8) as u8;
    let mode = external_attributes >> 16;
    let unix_type = mode & 0o170000;
    if system == 3 && unix_type == 0o120000 {
        return Err(ArchiveImportError::unsafe_entry(path, "不允许符号链接条目"));
    }
    if system == 3 && !matches!(unix_type, 0 | 0o040000 | 0o100000) {
        return Err(ArchiveImportError::unsafe_entry(
            path,
            "只允许普通文件和目录",
        ));
    }
    let unix_directory = system == 3 && unix_type == 0o040000;
    let unix_file = system == 3 && unix_type == 0o100000;
    let dos_directory = external_attributes & 0x10 != 0;
    if trailing_directory && unix_file {
        return Err(ArchiveImportError::unsafe_entry(
            path,
            "目录后缀与普通文件类型冲突",
        ));
    }
    if !trailing_directory && unix_directory {
        return Err(ArchiveImportError::unsafe_entry(
            path,
            "目录类型缺少目录路径后缀",
        ));
    }
    let kind = if trailing_directory || unix_directory || dos_directory {
        FolderEntryKind::Directory
    } else {
        FolderEntryKind::File
    };
    Ok((kind, system == 3 && mode & 0o111 != 0))
}

fn target_alias_key(path: &ArchivePath) -> String {
    path.0
        .split('/')
        .map(|component| {
            component
                .nfd()
                .flat_map(char::to_lowercase)
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn validate_local_headers(
    file: &mut File,
    _archive_size: u64,
    bounds: CentralDirectoryBounds,
    entries: &mut [IndexedEntry],
) -> Result<(), ArchiveImportError> {
    let mut starts = entries
        .iter()
        .map(|entry| entry.local_header_offset)
        .collect::<Vec<_>>();
    starts.sort_unstable();
    if starts.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(ArchiveImportError::malformed("多个 ZIP 条目共享本地头偏移"));
    }
    let mut next_boundaries = HashMap::with_capacity(starts.len());
    for (index, start) in starts.iter().copied().enumerate() {
        next_boundaries.insert(
            start,
            starts.get(index + 1).copied().unwrap_or(bounds.offset),
        );
    }
    let mut ranges = Vec::with_capacity(entries.len());
    for entry in entries {
        let fixed = read_exact_at::<30>(file, entry.local_header_offset, "读取 ZIP 本地头")?;
        if le_u32(&fixed[0..4]) != LOCAL_SIGNATURE {
            return Err(ArchiveImportError::malformed("本地头签名无效"));
        }
        let flags = le_u16(&fixed[6..8]);
        let method = le_u16(&fixed[8..10]);
        let local_crc32 = le_u32(&fixed[14..18]);
        let local_compressed = le_u32(&fixed[18..22]);
        let local_uncompressed = le_u32(&fixed[22..26]);
        let name_len = le_u16(&fixed[26..28]) as u64;
        let extra_len = le_u16(&fixed[28..30]) as u64;
        if flags & 0x0001 != 0 || flags & 0x0040 != 0 || method == 99 {
            return Err(ArchiveImportError::EncryptedEntry {
                relative_path: entry.path.display().to_string(),
            });
        }
        if flags != entry.flags || method != entry.compression_method {
            return Err(ArchiveImportError::malformed(
                "本地头与中央目录标志或压缩方式不一致",
            ));
        }
        if flags & 0x0008 == 0 {
            let expected_compressed = u32::try_from(entry.compressed_size).unwrap_or(u32::MAX);
            let expected_uncompressed = u32::try_from(entry.uncompressed_size).unwrap_or(u32::MAX);
            if local_crc32 != entry.crc32
                || local_compressed != expected_compressed
                || local_uncompressed != expected_uncompressed
            {
                return Err(ArchiveImportError::malformed(
                    "本地头与中央目录 CRC 或大小不一致",
                ));
            }
        }
        let data_start = entry
            .local_header_offset
            .checked_add(30)
            .and_then(|value| value.checked_add(name_len))
            .and_then(|value| value.checked_add(extra_len))
            .ok_or_else(|| ArchiveImportError::malformed("本地头大小溢出"))?;
        let data_end = data_start
            .checked_add(entry.compressed_size)
            .ok_or_else(|| ArchiveImportError::malformed("压缩数据大小溢出"))?;
        if data_end > bounds.offset {
            return Err(ArchiveImportError::malformed("压缩数据越过中央目录"));
        }
        let local_name = read_vec_at(file, entry.local_header_offset + 30, name_len as usize)?;
        if local_name != entry.raw_name {
            return Err(ArchiveImportError::malformed(
                "本地头与中央目录条目名不一致",
            ));
        }
        entry.data_offset = data_start;
        let next_boundary = next_boundaries[&entry.local_header_offset];
        let object_end = if flags & 0x0008 != 0 {
            validate_data_descriptor(file, data_end, next_boundary, entry)?
        } else {
            data_end
        };
        ranges.push((entry.local_header_offset, object_end));
    }
    ranges.sort_unstable();
    for pair in ranges.windows(2) {
        if pair[0].1 > pair[1].0 {
            return Err(ArchiveImportError::malformed("ZIP 本地条目范围重叠"));
        }
    }
    Ok(())
}

fn validate_data_descriptor(
    file: &mut File,
    descriptor_offset: u64,
    next_boundary: u64,
    entry: &IndexedEntry,
) -> Result<u64, ArchiveImportError> {
    let size_bytes = if entry.uses_zip64_sizes { 8u64 } else { 4u64 };
    let unsigned_bytes = 4u64 + size_bytes * 2;
    if descriptor_offset
        .checked_add(unsigned_bytes)
        .is_none_or(|end| end > next_boundary)
    {
        return Err(ArchiveImportError::malformed(
            "data descriptor 缺失、截断或与下一对象重叠",
        ));
    }

    let first = read_descriptor_bytes(file, descriptor_offset, 4)?;
    let unsigned =
        parse_data_descriptor_candidate(file, descriptor_offset, next_boundary, entry, false)?;
    let signed = if le_u32(&first) == DATA_DESCRIPTOR_SIGNATURE {
        parse_data_descriptor_candidate(file, descriptor_offset, next_boundary, entry, true)?
    } else {
        None
    };
    match (signed, unsigned) {
        (Some(signed_end), None) => Ok(signed_end),
        (None, Some(unsigned_end)) => Ok(unsigned_end),
        (Some(signed_end), Some(unsigned_end)) => {
            // 邻接下一对象时精确边界优先；否则按照 APPNOTE 推荐的显式签名解释。
            match (signed_end == next_boundary, unsigned_end == next_boundary) {
                (true, false) => Ok(signed_end),
                (false, true) => Ok(unsigned_end),
                _ => Ok(signed_end),
            }
        }
        (None, None) => Err(ArchiveImportError::malformed(
            "data descriptor 与中央目录 CRC 或大小不一致",
        )),
    }
}

fn parse_data_descriptor_candidate(
    file: &mut File,
    descriptor_offset: u64,
    next_boundary: u64,
    entry: &IndexedEntry,
    signed: bool,
) -> Result<Option<u64>, ArchiveImportError> {
    let size_bytes = if entry.uses_zip64_sizes { 8u64 } else { 4u64 };
    let payload_bytes = 4u64 + size_bytes * 2;
    let payload_offset = descriptor_offset + if signed { 4 } else { 0 };
    let descriptor_end = payload_offset
        .checked_add(payload_bytes)
        .ok_or_else(|| ArchiveImportError::malformed("data descriptor 大小溢出"))?;
    if descriptor_end > next_boundary {
        return Ok(None);
    }
    let payload = read_descriptor_bytes(file, payload_offset, payload_bytes as usize)?;
    let crc32 = le_u32(&payload[0..4]);
    let (compressed_size, uncompressed_size) = if entry.uses_zip64_sizes {
        (le_u64(&payload[4..12]), le_u64(&payload[12..20]))
    } else {
        (
            le_u32(&payload[4..8]) as u64,
            le_u32(&payload[8..12]) as u64,
        )
    };
    if crc32 != entry.crc32
        || compressed_size != entry.compressed_size
        || uncompressed_size != entry.uncompressed_size
    {
        return Ok(None);
    }
    Ok(Some(descriptor_end))
}

fn read_descriptor_bytes(
    file: &mut File,
    offset: u64,
    len: usize,
) -> Result<Vec<u8>, ArchiveImportError> {
    let mut output = vec![0u8; len];
    file.seek(SeekFrom::Start(offset))
        .and_then(|_| file.read_exact(&mut output))
        .map_err(|error| ArchiveImportError::io("读取 data descriptor", ".", error))?;
    Ok(output)
}

fn discover_archive_skill_paths(entries: &[IndexedEntry]) -> Vec<ArchivePath> {
    let mut candidates = entries
        .iter()
        .filter(|entry| {
            entry.kind == FolderEntryKind::File
                && entry.path.file_name() == SKILL_FILE
                && !is_excluded_path(&entry.path, entry.kind)
        })
        .map(|entry| entry.path.parent())
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.dedup();
    let mut found: Vec<ArchivePath> = Vec::new();
    for candidate in candidates {
        if found
            .iter()
            .any(|ancestor| candidate == *ancestor || candidate.is_descendant_of(ancestor))
        {
            continue;
        }
        found.push(candidate);
    }
    found
}

fn is_excluded_path(path: &ArchivePath, kind: FolderEntryKind) -> bool {
    if path.0.split('/').any(|component| {
        matches!(
            component,
            ".git" | "__MACOSX" | ".imports" | ".backups" | ".transactions"
        )
    }) {
        return true;
    }
    kind == FolderEntryKind::File && is_platform_metadata(path.file_name())
}

fn is_platform_metadata(name: &str) -> bool {
    name.eq_ignore_ascii_case(".DS_Store")
        || name.eq_ignore_ascii_case("Thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
        || name.starts_with("._")
}

fn plan_skill(
    entries: &[IndexedEntry],
    root: ArchivePath,
    max_objects: usize,
) -> Result<SkillPlan, ArchiveImportError> {
    let mut objects = BTreeMap::new();
    objects.insert(root.clone(), FolderEntryKind::Directory);
    let mut files = Vec::new();
    'entries: for entry in entries {
        if !entry.path.is_descendant_of(&root) || is_excluded_path(&entry.path, entry.kind) {
            continue;
        }
        for ancestor in entry.path.ancestors_inclusive() {
            if ancestor == entry.path {
                break;
            }
            if ancestor == root || ancestor.is_descendant_of(&root) {
                insert_object(&mut objects, ancestor, FolderEntryKind::Directory)?;
                if objects.len() > max_objects {
                    break 'entries;
                }
            }
        }
        insert_object(&mut objects, entry.path.clone(), entry.kind)?;
        if objects.len() > max_objects {
            break;
        }
        if entry.kind == FolderEntryKind::File {
            files.push(entry.archive_index);
        }
    }
    files.sort_by(|left, right| entries[*left].path.cmp(&entries[*right].path));
    Ok(SkillPlan {
        root,
        objects,
        files,
    })
}

fn insert_object(
    objects: &mut BTreeMap<ArchivePath, FolderEntryKind>,
    path: ArchivePath,
    kind: FolderEntryKind,
) -> Result<(), ArchiveImportError> {
    if let Some(previous) = objects.insert(path.clone(), kind) {
        if previous != kind {
            return Err(ArchiveImportError::TargetCollision {
                relative_path: path.display().to_string(),
            });
        }
    }
    Ok(())
}

fn staged_source_objects(
    plans: &[SkillPlan],
    roots: &[ArchivePath],
    max_objects: usize,
) -> Result<BTreeMap<ArchivePath, FolderEntryKind>, ArchiveImportError> {
    let mut output = BTreeMap::new();
    for plan in plans.iter().filter(|plan| roots.contains(&plan.root)) {
        for ancestor in plan.root.ancestors_inclusive() {
            output.insert(ancestor, FolderEntryKind::Directory);
            if output.len() > max_objects {
                return Err(ArchiveImportError::BatchEntriesExceeded);
            }
        }
        for (path, kind) in &plan.objects {
            output.insert(path.clone(), *kind);
            if output.len() > max_objects {
                return Err(ArchiveImportError::BatchEntriesExceeded);
            }
        }
    }
    Ok(output)
}

fn staged_source_objects_from_entries(
    entries: &[IndexedEntry],
    roots: &[ArchivePath],
    max_source_objects: usize,
    max_skill_objects: usize,
) -> Result<BTreeMap<ArchivePath, FolderEntryKind>, ArchiveImportError> {
    let plans = roots
        .iter()
        .cloned()
        .map(|root| plan_skill(entries, root, max_skill_objects))
        .collect::<Result<Vec<_>, _>>()?;
    staged_source_objects(&plans, roots, max_source_objects)
}

#[derive(Debug)]
enum ExtractSkillError {
    Invalid(String),
    Source(ArchiveImportError),
}

impl From<ArchiveImportError> for ExtractSkillError {
    fn from(error: ArchiveImportError) -> Self {
        Self::Source(error)
    }
}

impl From<LeaseError> for ExtractSkillError {
    fn from(error: LeaseError) -> Self {
        Self::Source(error.into())
    }
}

#[allow(clippy::too_many_arguments)]
fn extract_one_skill(
    opened: &platform::OpenedArchive,
    index: &[IndexedEntry],
    staging_root: &Path,
    plan: &SkillPlan,
    batch_start: FolderBatchUsage,
    source_bytes: u64,
    limits: ArchiveLimits,
    created_directories: &mut BTreeSet<PathBuf>,
    quota: &mut dyn StagingQuota,
) -> Result<StagedArchiveSkill, ExtractSkillError> {
    ensure_target_directory(staging_root, &plan.root, created_directories, quota)?;
    for (path, kind) in &plan.objects {
        if *kind == FolderEntryKind::Directory {
            ensure_target_directory(staging_root, path, created_directories, quota)?;
        }
    }

    let mut staged_sizes: HashMap<usize, u64> = HashMap::new();
    let mut skill_bytes = 0u64;
    let mut buffer = vec![0u8; limits.copy_buffer_bytes.max(1)];
    for archive_index in &plan.files {
        let expected = &index[*archive_index];
        ensure_target_directory(
            staging_root,
            &expected.path.parent(),
            created_directories,
            quota,
        )?;
        let target = staging_root.join(expected.path.to_path_buf());
        quota.reserve_entries(1)?;
        let mut target_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| {
                ExtractSkillError::Source(if error.kind() == io::ErrorKind::AlreadyExists {
                    ArchiveImportError::TargetCollision {
                        relative_path: expected.path.display().to_string(),
                    }
                } else {
                    ArchiveImportError::io("创建 ZIP 暂存文件", expected.path.display(), error)
                })
            })?;
        verify_created_object(&target, FolderEntryKind::File, &expected.path)?;
        platform::verify_handle(opened)?;
        let compressed = open_compressed_region(opened, expected)?;
        let (file_bytes, actual_crc32) = match expected.compression_method {
            0 => {
                let mut source = compressed;
                let output = copy_entry_output(
                    &mut source,
                    false,
                    &mut target_file,
                    expected,
                    opened,
                    &mut buffer,
                    &mut skill_bytes,
                    batch_start,
                    source_bytes,
                    limits,
                    quota,
                )?;
                if source.limit() != 0 {
                    return Err(
                        ArchiveImportError::malformed("Store 条目压缩区未被完整消费").into(),
                    );
                }
                output
            }
            8 => {
                let mut decoder = DeflateDecoder::new(compressed);
                let output = copy_entry_output(
                    &mut decoder,
                    true,
                    &mut target_file,
                    expected,
                    opened,
                    &mut buffer,
                    &mut skill_bytes,
                    batch_start,
                    source_bytes,
                    limits,
                    quota,
                )?;
                let decoder_total_in = decoder.total_in();
                let decoder_total_out = decoder.total_out();
                let compressed = decoder.into_inner();
                if decoder_total_in != expected.compressed_size
                    || decoder_total_out != output.0
                    || compressed.limit() != 0
                {
                    return Err(
                        ArchiveImportError::malformed("Deflate 压缩区截断或包含尾随垃圾").into(),
                    );
                }
                validate_deflate_stream(opened, expected)?;
                output
            }
            _ => {
                return Err(ArchiveImportError::UnsupportedCompression {
                    relative_path: expected.path.display().to_string(),
                    method: expected.compression_method,
                }
                .into())
            }
        };
        target_file.flush().map_err(|error| {
            ArchiveImportError::io("刷新 ZIP 暂存文件", expected.path.display(), error)
        })?;
        if file_bytes != expected.uncompressed_size {
            return Err(ArchiveImportError::malformed("ZIP 条目实际大小与中央目录不一致").into());
        }
        if actual_crc32 != expected.crc32 {
            return Err(ArchiveImportError::malformed("ZIP 条目 CRC32 与中央目录不一致").into());
        }
        staged_sizes.insert(*archive_index, file_bytes);
    }
    platform::verify_handle(opened)?;

    let mut staged_entries = Vec::with_capacity(plan.objects.len().saturating_sub(1));
    for (path, kind) in &plan.objects {
        if path == &plan.root {
            continue;
        }
        let archive_entry = index.iter().find(|entry| entry.path == *path);
        let size = archive_entry
            .and_then(|entry| staged_sizes.get(&entry.archive_index))
            .copied()
            .unwrap_or(0);
        staged_entries.push(StagedArchiveEntry {
            relative_path: path.relative_to(&plan.root),
            kind: *kind,
            size,
            platform_executable: archive_entry.is_some_and(|entry| entry.platform_executable),
        });
    }
    Ok(StagedArchiveSkill {
        relative_root: plan.root.display().to_string(),
        fallback_name: String::new(),
        staged_root: Some(staging_root.join(plan.root.to_path_buf())),
        entries: staged_entries,
        entry_count: plan.objects.len(),
        total_size: skill_bytes,
        invalid_reason: None,
    })
}

fn open_compressed_region(
    opened: &platform::OpenedArchive,
    entry: &IndexedEntry,
) -> Result<io::Take<File>, ArchiveImportError> {
    let mut file = opened.clone_file()?;
    file.seek(SeekFrom::Start(entry.data_offset))
        .map_err(|error| {
            ArchiveImportError::io("定位 ZIP 压缩数据", entry.path.display(), error)
        })?;
    Ok(file.take(entry.compressed_size))
}

#[allow(clippy::too_many_arguments)]
fn copy_entry_output<R: Read>(
    source: &mut R,
    deflated: bool,
    target: &mut File,
    entry: &IndexedEntry,
    opened: &platform::OpenedArchive,
    buffer: &mut [u8],
    skill_bytes: &mut u64,
    batch_start: FolderBatchUsage,
    source_bytes: u64,
    limits: ArchiveLimits,
    quota: &mut dyn StagingQuota,
) -> Result<(u64, u32), ExtractSkillError> {
    let mut file_bytes = 0u64;
    let mut crc32 = Crc32Hasher::new();
    loop {
        let read = source.read(buffer).map_err(|error| {
            if deflated
                && matches!(
                    error.kind(),
                    io::ErrorKind::InvalidData
                        | io::ErrorKind::InvalidInput
                        | io::ErrorKind::UnexpectedEof
                )
            {
                ExtractSkillError::Source(ArchiveImportError::malformed("Deflate 条目损坏或被截断"))
            } else {
                ExtractSkillError::Source(ArchiveImportError::io(
                    if deflated {
                        "读取 Deflate 条目"
                    } else {
                        "读取 Store 条目"
                    },
                    entry.path.display(),
                    error,
                ))
            }
        })?;
        if read == 0 {
            break;
        }
        platform::verify_handle(opened)?;
        file_bytes = file_bytes.saturating_add(read as u64);
        *skill_bytes = skill_bytes.saturating_add(read as u64);
        if file_bytes > limits.bytes_per_file {
            return Err(ExtractSkillError::Invalid("单个文件超过 10 MiB".into()));
        }
        if entry.path.file_name() == SKILL_FILE && file_bytes > limits.skill_md_bytes {
            return Err(ExtractSkillError::Invalid("SKILL.md 超过 1 MiB".into()));
        }
        if *skill_bytes > limits.bytes_per_skill {
            return Err(ExtractSkillError::Invalid("技能总大小超过 50 MiB".into()));
        }
        if batch_start.bytes + source_bytes + *skill_bytes > limits.bytes_per_batch {
            return Err(ArchiveImportError::BatchBytesExceeded.into());
        }
        quota.reserve_bytes(read as u64)?;
        crc32.update(&buffer[..read]);
        target.write_all(&buffer[..read]).map_err(|error| {
            ArchiveImportError::io("写入 ZIP 暂存文件", entry.path.display(), error)
        })?;
    }
    Ok((file_bytes, crc32.finalize()))
}

fn validate_deflate_stream(
    opened: &platform::OpenedArchive,
    entry: &IndexedEntry,
) -> Result<(), ArchiveImportError> {
    let mut source = open_compressed_region(opened, entry)?;
    let mut decoder = Decompress::new(false);
    let mut input = [0u8; 64 * 1024];
    let mut output = [0u8; 64 * 1024];
    let mut stream_end = false;

    while source.limit() != 0 {
        let wanted = usize::try_from(source.limit().min(input.len() as u64)).unwrap();
        source.read_exact(&mut input[..wanted]).map_err(|error| {
            ArchiveImportError::io("复核 Deflate 压缩数据", entry.path.display(), error)
        })?;
        let mut position = 0usize;
        while position < wanted {
            let before_in = decoder.total_in();
            let before_out = decoder.total_out();
            let status = decoder
                .decompress(&input[position..wanted], &mut output, FlushDecompress::None)
                .map_err(|_| ArchiveImportError::malformed("Deflate 压缩流损坏"))?;
            let consumed = (decoder.total_in() - before_in) as usize;
            let produced = decoder.total_out() - before_out;
            position += consumed;
            if status == Status::StreamEnd {
                if position != wanted || source.limit() != 0 {
                    return Err(ArchiveImportError::malformed("Deflate 压缩流含尾随垃圾"));
                }
                stream_end = true;
                break;
            }
            if consumed == 0 && produced == 0 {
                return Err(ArchiveImportError::malformed("Deflate 压缩流未完整结束"));
            }
        }
        if stream_end {
            break;
        }
    }
    while !stream_end {
        let before_out = decoder.total_out();
        let status = decoder
            .decompress(&[], &mut output, FlushDecompress::Finish)
            .map_err(|_| ArchiveImportError::malformed("Deflate 压缩流被截断"))?;
        if decoder.total_out() > entry.uncompressed_size {
            return Err(ArchiveImportError::malformed(
                "Deflate 实际输出超过中央目录声明",
            ));
        }
        stream_end = status == Status::StreamEnd;
        if !stream_end && decoder.total_out() == before_out {
            return Err(ArchiveImportError::malformed("Deflate 压缩流未完整结束"));
        }
    }
    if decoder.total_in() != entry.compressed_size || decoder.total_out() != entry.uncompressed_size
    {
        return Err(ArchiveImportError::malformed(
            "Deflate 压缩流消费或输出大小不一致",
        ));
    }
    platform::verify_handle(opened)?;
    Ok(())
}

fn invalid_skill(
    root: &ArchivePath,
    fallback_name: String,
    reason: impl Into<String>,
    entry_count: usize,
) -> StagedArchiveSkill {
    StagedArchiveSkill {
        relative_root: root.display().to_string(),
        fallback_name,
        staged_root: None,
        entries: Vec::new(),
        entry_count,
        total_size: 0,
        invalid_reason: Some(reason.into()),
    }
}

fn archive_stem(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn preflight_target(
    staging_root: &Path,
    planned: &BTreeMap<ArchivePath, FolderEntryKind>,
) -> Result<(), ArchiveImportError> {
    if fs::symlink_metadata(staging_root).is_ok() {
        return Err(ArchiveImportError::TargetCollision {
            relative_path: ".".into(),
        });
    }
    let mut aliases = HashMap::new();
    for (path, kind) in planned {
        let alias = target_alias_key(path);
        if let Some((previous, previous_kind)) = aliases.insert(alias, (path.0.clone(), *kind)) {
            if previous != path.0 || previous_kind != *kind {
                return Err(ArchiveImportError::TargetCollision {
                    relative_path: path.display().to_string(),
                });
            }
        }
    }
    Ok(())
}

fn create_staging_root(path: &Path) -> Result<(), ArchiveImportError> {
    fs::create_dir(path).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            ArchiveImportError::TargetCollision {
                relative_path: ".".into(),
            }
        } else {
            ArchiveImportError::io("创建 ZIP 来源暂存根", ".", error)
        }
    })
}

fn ensure_target_directory(
    staging_root: &Path,
    relative: &ArchivePath,
    created: &mut BTreeSet<PathBuf>,
    quota: &mut dyn StagingQuota,
) -> Result<(), ArchiveImportError> {
    let mut current = staging_root.to_path_buf();
    let mut walked = ArchivePath::root();
    for component in relative
        .0
        .split('/')
        .filter(|component| !component.is_empty())
    {
        current.push(component);
        walked = if walked.0.is_empty() {
            ArchivePath(component.to_string())
        } else {
            ArchivePath(format!("{}/{}", walked.0, component))
        };
        if created.contains(&current) {
            verify_created_object(&current, FolderEntryKind::Directory, &walked)?;
            continue;
        }
        quota.reserve_entries(1)?;
        fs::create_dir(&current).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                ArchiveImportError::TargetCollision {
                    relative_path: walked.display().to_string(),
                }
            } else {
                ArchiveImportError::io("创建 ZIP 暂存目录", walked.display(), error)
            }
        })?;
        verify_created_object(&current, FolderEntryKind::Directory, &walked)?;
        created.insert(current.clone());
    }
    Ok(())
}

fn verify_created_object(
    path: &Path,
    expected: FolderEntryKind,
    relative: &ArchivePath,
) -> Result<(), ArchiveImportError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| ArchiveImportError::io("复核 ZIP 暂存对象", relative.display(), error))?;
    let matches = match expected {
        FolderEntryKind::File => metadata.file_type().is_file(),
        FolderEntryKind::Directory => metadata.file_type().is_dir(),
    };
    if metadata.file_type().is_symlink() || !matches {
        return Err(ArchiveImportError::TargetCollision {
            relative_path: relative.display().to_string(),
        });
    }
    let expected_name = path.file_name();
    if let (Some(parent), Some(expected_name)) = (path.parent(), expected_name) {
        let mut exact = false;
        for entry in fs::read_dir(parent).map_err(|error| {
            ArchiveImportError::io("复核 ZIP 暂存目录名称", relative.display(), error)
        })? {
            let entry = entry.map_err(|error| {
                ArchiveImportError::io("复核 ZIP 暂存目录名称", relative.display(), error)
            })?;
            if entry.file_name() == expected_name {
                exact = true;
                break;
            }
        }
        if !exact {
            return Err(ArchiveImportError::TargetCollision {
                relative_path: relative.display().to_string(),
            });
        }
    }
    Ok(())
}

fn cleanup_skill_target(
    staging_root: &Path,
    target: &Path,
    root: &ArchivePath,
    cleanup_hook: Option<&CleanupHook<'_>>,
) -> Result<(), ArchiveImportError> {
    run_cleanup_hook(target, root, cleanup_hook)?;
    if root.0.is_empty() {
        for entry in fs::read_dir(staging_root).map_err(|error| cleanup_failed(root, error))? {
            let entry = entry.map_err(|error| cleanup_failed(root, error))?;
            let kind = entry
                .file_type()
                .map_err(|error| cleanup_failed(root, error))?;
            if kind.is_dir() {
                fs::remove_dir_all(entry.path())
            } else {
                fs::remove_file(entry.path())
            }
            .map_err(|error| cleanup_failed(root, error))?;
        }
        return Ok(());
    }
    match fs::symlink_metadata(target) {
        Ok(metadata) => {
            if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
                fs::remove_dir_all(target).map_err(|error| cleanup_failed(root, error))?;
            } else {
                fs::remove_file(target).map_err(|error| cleanup_failed(root, error))?;
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(cleanup_failed(root, error)),
    }
    let mut current = target.parent();
    while let Some(directory) = current {
        if directory == staging_root {
            break;
        }
        run_cleanup_hook(directory, root, cleanup_hook)?;
        match fs::remove_dir(directory) {
            Ok(()) => current = directory.parent(),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::DirectoryNotEmpty
                ) =>
            {
                break
            }
            Err(error) => return Err(cleanup_failed(root, error)),
        }
    }
    Ok(())
}

fn run_cleanup_hook(
    path: &Path,
    relative: &ArchivePath,
    cleanup_hook: Option<&CleanupHook<'_>>,
) -> Result<(), ArchiveImportError> {
    if let Some(hook) = cleanup_hook {
        hook(path).map_err(|error| cleanup_failed(relative, error))?;
    }
    Ok(())
}

fn cleanup_failed(relative: &ArchivePath, error: impl fmt::Display) -> ArchiveImportError {
    ArchiveImportError::CleanupFailed {
        relative_path: relative.display().to_string(),
        message: error.to_string(),
    }
}

struct ArchiveStagingGuard<'a> {
    root: PathBuf,
    committed: bool,
    preserve_on_drop: bool,
    cleanup_hook: Option<&'a CleanupHook<'a>>,
    created_directories: BTreeSet<PathBuf>,
}

impl<'a> ArchiveStagingGuard<'a> {
    fn new(root: &Path, cleanup_hook: Option<&'a CleanupHook<'a>>) -> Self {
        Self {
            root: root.to_path_buf(),
            committed: false,
            preserve_on_drop: false,
            cleanup_hook,
            created_directories: BTreeSet::new(),
        }
    }

    fn commit(&mut self) {
        self.committed = true;
    }

    fn preserve(&mut self) {
        self.preserve_on_drop = true;
    }

    fn cleanup_explicit(&mut self) -> Result<(), ArchiveImportError> {
        if self.committed {
            return Ok(());
        }
        if let Err(error) = run_cleanup_hook(&self.root, &ArchivePath::root(), self.cleanup_hook) {
            self.preserve_on_drop = true;
            return Err(error);
        }
        match fs::remove_dir_all(&self.root) {
            Ok(()) => {
                self.committed = true;
                Ok(())
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.committed = true;
                Ok(())
            }
            Err(error) => {
                self.preserve_on_drop = true;
                Err(cleanup_failed(&ArchivePath::root(), error))
            }
        }
    }
}

impl Drop for ArchiveStagingGuard<'_> {
    fn drop(&mut self) {
        if !self.committed && !self.preserve_on_drop {
            // 仅供 panic 展开的最后兜底；普通失败路径始终显式清理并传播失败。
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

fn read_exact_at<const N: usize>(
    file: &mut File,
    offset: u64,
    operation: &'static str,
) -> Result<[u8; N], ArchiveImportError> {
    let mut output = [0u8; N];
    file.seek(SeekFrom::Start(offset))
        .and_then(|_| file.read_exact(&mut output))
        .map_err(|error| ArchiveImportError::io(operation, ".", error))?;
    Ok(output)
}

fn read_vec_at(file: &mut File, offset: u64, len: usize) -> Result<Vec<u8>, ArchiveImportError> {
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| ArchiveImportError::io("定位 ZIP 变长字段", ".", error))?;
    read_bounded_vec(file, len, "读取 ZIP 变长字段")
}

fn read_bounded_vec(
    file: &mut File,
    len: usize,
    operation: &'static str,
) -> Result<Vec<u8>, ArchiveImportError> {
    // `len` 来自 u16 且调用点已确认总和位于 <=32 MiB 的中央目录范围内。
    let mut output = vec![0u8; len];
    file.read_exact(&mut output)
        .map_err(|error| ArchiveImportError::io(operation, ".", error))?;
    Ok(output)
}

fn skip_exact(
    file: &mut File,
    len: u64,
    operation: &'static str,
) -> Result<(), ArchiveImportError> {
    let current = file
        .stream_position()
        .map_err(|error| ArchiveImportError::io(operation, ".", error))?;
    file.seek(SeekFrom::Start(current.checked_add(len).ok_or_else(
        || ArchiveImportError::malformed("ZIP 变长字段偏移溢出"),
    )?))
    .map_err(|error| ArchiveImportError::io(operation, ".", error))?;
    Ok(())
}

fn le_u16(bytes: &[u8]) -> u16 {
    u16::from_le_bytes(bytes.try_into().expect("固定宽度切片"))
}

fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes.try_into().expect("固定宽度切片"))
}

fn le_u64(bytes: &[u8]) -> u64 {
    u64::from_le_bytes(bytes.try_into().expect("固定宽度切片"))
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::os::fd::OwnedFd;

    use rustix::fs::{fstat, openat, statat, AtFlags, FileType, Mode, OFlags, CWD};

    pub(super) struct OpenedArchive {
        file: Option<File>,
        monitor: File,
        parent: OwnedFd,
        selected_name: std::ffi::OsString,
        identity: ArchiveIdentity,
    }

    impl fmt::Debug for OpenedArchive {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("OpenedArchive")
                .field("identity", &self.identity)
                .finish_non_exhaustive()
        }
    }

    impl OpenedArchive {
        pub(super) fn file_mut(&mut self) -> &mut File {
            self.file.as_mut().expect("归档句柄尚未交给解析器")
        }

        pub(super) fn clone_file(&self) -> Result<File, ArchiveImportError> {
            self.file
                .as_ref()
                .expect("归档句柄仍由安全索引持有")
                .try_clone()
                .map_err(|error| ArchiveImportError::io("复制 ZIP 内容句柄", ".", error))
        }

        pub(super) fn identity(&self) -> &ArchiveIdentity {
            &self.identity
        }
    }

    pub(super) fn open_archive(path: &Path) -> Result<OpenedArchive, ArchiveImportError> {
        let selected_name = path
            .file_name()
            .ok_or(ArchiveImportError::SourceNotFile)?
            .to_os_string();
        let parent_path = path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let parent = openat(
            CWD,
            parent_path,
            OFlags::RDONLY
                | OFlags::DIRECTORY
                | OFlags::NOFOLLOW
                | OFlags::NONBLOCK
                | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| ArchiveImportError::io("安全打开 ZIP 父目录", ".", error))?;
        let initial = statat(&parent, &selected_name, AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|error| ArchiveImportError::io("检查 ZIP 来源", ".", error))?;
        if FileType::from_raw_mode(initial.st_mode) != FileType::RegularFile {
            return Err(ArchiveImportError::SourceNotFile);
        }
        let fd = openat(
            &parent,
            &selected_name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| ArchiveImportError::io("安全打开 ZIP 来源", ".", error))?;
        let actual =
            fstat(&fd).map_err(|error| ArchiveImportError::io("复核 ZIP 来源句柄", ".", error))?;
        if FileType::from_raw_mode(actual.st_mode) != FileType::RegularFile {
            return Err(ArchiveImportError::SourceNotFile);
        }
        let initial_identity = identity_from_stat(&initial);
        let identity = identity_from_stat(&actual);
        if initial_identity.object_a != identity.object_a
            || initial_identity.object_b != identity.object_b
        {
            return Err(ArchiveImportError::SourceChanged);
        }
        let file = File::from(fd);
        let monitor = file
            .try_clone()
            .map_err(|error| ArchiveImportError::io("复制 ZIP 来源句柄", ".", error))?;
        Ok(OpenedArchive {
            file: Some(file),
            monitor,
            parent,
            selected_name,
            identity,
        })
    }

    pub(super) fn verify_handle(opened: &OpenedArchive) -> Result<(), ArchiveImportError> {
        let stat = fstat(&opened.monitor)
            .map_err(|error| ArchiveImportError::io("复核 ZIP 来源句柄", ".", error))?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile
            || identity_from_stat(&stat) != opened.identity
        {
            return Err(ArchiveImportError::SourceChanged);
        }
        Ok(())
    }

    pub(super) fn verify_source(opened: &OpenedArchive) -> Result<(), ArchiveImportError> {
        verify_handle(opened)?;
        let stat = statat(
            &opened.parent,
            &opened.selected_name,
            AtFlags::SYMLINK_NOFOLLOW,
        )
        .map_err(|_| ArchiveImportError::SourceChanged)?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile
            || identity_from_stat(&stat) != opened.identity
        {
            return Err(ArchiveImportError::SourceChanged);
        }
        Ok(())
    }

    fn identity_from_stat(stat: &rustix::fs::Stat) -> ArchiveIdentity {
        let (modified_seconds, modified_nanos, changed_seconds, changed_nanos) = stat_times(stat);
        ArchiveIdentity {
            object_a: stat.st_dev as u64,
            object_b: stat.st_ino as u64,
            object_c: 0,
            size: stat.st_size.max(0) as u64,
            modified_seconds,
            modified_nanos,
            changed_seconds,
            changed_nanos,
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn stat_times(stat: &rustix::fs::Stat) -> (i64, i64, i64, i64) {
        // rustix 跟随 libc：Linux 纳秒字段为 u64，macOS 为 i64；其合法范围均小于 10^9。
        (
            stat.st_mtime,
            stat.st_mtime_nsec as i64,
            stat.st_ctime,
            stat.st_ctime_nsec as i64,
        )
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    fn stat_times(_stat: &rustix::fs::Stat) -> (i64, i64, i64, i64) {
        (0, 0, 0, 0)
    }
}

// Windows 最终 ZIP 组件必须通过 `NtCreateFile(RootDirectory=parent)` 相对父句柄
// 打开；完整路径 API 只用于固定父目录自身，不能用于最终来源文件。
#[cfg(windows)]
mod platform {
    use super::*;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, IntoRawHandle, OwnedHandle, RawHandle};

    use windows::core::{PCWSTR, PWSTR};
    use windows::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows::Wdk::Storage::FileSystem::{
        NtCreateFile, FILE_NON_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_REPARSE_POINT,
        FILE_SYNCHRONOUS_IO_NONALERT,
    };
    use windows::Win32::Foundation::{
        HANDLE, OBJ_CASE_INSENSITIVE, OBJ_DONT_REPARSE, UNICODE_STRING,
    };
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FileBasicInfo, FileIdInfo, FileStandardInfo, GetFileInformationByHandleEx,
        GetFileType, FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_READ, FILE_ID_INFO, FILE_SHARE_READ,
        FILE_STANDARD_INFO, FILE_TYPE_DISK, OPEN_EXISTING,
    };
    use windows::Win32::System::IO::IO_STATUS_BLOCK;

    pub(super) struct OpenedArchive {
        file: Option<File>,
        monitor: File,
        // 持有父目录且不共享 WRITE/DELETE，保证相对命名上下文不被替换。
        _parent: OwnedHandle,
        identity: ArchiveIdentity,
    }

    impl fmt::Debug for OpenedArchive {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("OpenedArchive")
                .field("identity", &self.identity)
                .finish_non_exhaustive()
        }
    }

    impl OpenedArchive {
        pub(super) fn file_mut(&mut self) -> &mut File {
            self.file.as_mut().expect("归档句柄尚未交给解析器")
        }
        pub(super) fn clone_file(&self) -> Result<File, ArchiveImportError> {
            self.file
                .as_ref()
                .expect("归档句柄仍由安全索引持有")
                .try_clone()
                .map_err(|error| ArchiveImportError::io("复制 ZIP 内容句柄", ".", error))
        }
        pub(super) fn identity(&self) -> &ArchiveIdentity {
            &self.identity
        }
    }

    pub(super) fn open_archive(path: &Path) -> Result<OpenedArchive, ArchiveImportError> {
        let selected_name = path.file_name().ok_or(ArchiveImportError::SourceNotFile)?;
        let parent_path = path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new("."));

        let mut parent_wide = parent_path.as_os_str().encode_wide().collect::<Vec<_>>();
        parent_wide.push(0);
        let parent_handle = unsafe {
            CreateFileW(
                PCWSTR(parent_wide.as_ptr()),
                FILE_GENERIC_READ.0,
                FILE_SHARE_READ,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                None,
            )
        }
        .map_err(|error| ArchiveImportError::io("安全打开 ZIP 父目录", ".", error))?;
        let parent = unsafe { OwnedHandle::from_raw_handle(parent_handle.0 as RawHandle) };
        validate_windows_object(parent_handle, true)?;

        let mut name_wide = selected_name.encode_wide().collect::<Vec<_>>();
        let name_bytes = name_wide
            .len()
            .checked_mul(2)
            .and_then(|bytes| u16::try_from(bytes).ok())
            .ok_or(ArchiveImportError::SourceNotFile)?;
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
        let mut file_handle = HANDLE::default();
        let status = unsafe {
            NtCreateFile(
                &mut file_handle,
                FILE_GENERIC_READ,
                &object_attributes,
                &mut io_status,
                None,
                Default::default(),
                FILE_SHARE_READ,
                FILE_OPEN,
                FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                None,
                0,
            )
        };
        if status.0 < 0 {
            return Err(ArchiveImportError::Io {
                operation: "父句柄相对打开 ZIP 来源",
                relative_path: ".".into(),
                message: format!("NTSTATUS 0x{:08x}", status.0 as u32),
            });
        }
        let owned_file = unsafe { OwnedHandle::from_raw_handle(file_handle.0 as RawHandle) };
        let identity = validate_windows_object(file_handle, false)?;
        let file = unsafe { File::from_raw_handle(owned_file.into_raw_handle()) };
        let monitor = file
            .try_clone()
            .map_err(|error| ArchiveImportError::io("复制 ZIP 来源句柄", ".", error))?;
        Ok(OpenedArchive {
            file: Some(file),
            monitor,
            _parent: parent,
            identity,
        })
    }

    pub(super) fn verify_handle(opened: &OpenedArchive) -> Result<(), ArchiveImportError> {
        let handle = HANDLE(opened.monitor.as_raw_handle());
        if validate_windows_object(handle, false)? != opened.identity {
            return Err(ArchiveImportError::SourceChanged);
        }
        Ok(())
    }

    pub(super) fn verify_source(opened: &OpenedArchive) -> Result<(), ArchiveImportError> {
        // FILE_SHARE_READ 明确拒绝了 WRITE/DELETE，共享锁覆盖整个读取期；不按路径
        // 或名称重新打开最终组件，只复核固定句柄。
        verify_handle(opened)
    }

    fn validate_windows_object(
        handle: HANDLE,
        require_directory: bool,
    ) -> Result<ArchiveIdentity, ArchiveImportError> {
        if unsafe { GetFileType(handle) } != FILE_TYPE_DISK {
            return Err(ArchiveImportError::SourceNotFile);
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
        .map_err(|error| ArchiveImportError::io("复核 ZIP Windows 句柄", ".", error))?;
        if basic.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
            || standard.Directory != require_directory
            || standard.EndOfFile < 0
        {
            return Err(ArchiveImportError::SourceNotFile);
        }
        let low = u64::from_le_bytes(id.FileId.Identifier[0..8].try_into().unwrap());
        let high = u64::from_le_bytes(id.FileId.Identifier[8..16].try_into().unwrap());
        Ok(ArchiveIdentity {
            object_a: id.VolumeSerialNumber,
            object_b: low,
            object_c: high,
            size: standard.EndOfFile as u64,
            modified_seconds: basic.LastWriteTime,
            modified_nanos: 0,
            changed_seconds: 0,
            changed_nanos: 0,
        })
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use super::*;

    #[derive(Debug)]
    pub(super) struct OpenedArchive;

    impl OpenedArchive {
        pub(super) fn file_mut(&mut self) -> &mut File {
            unreachable!()
        }
        pub(super) fn clone_file(&self) -> Result<File, ArchiveImportError> {
            Err(ArchiveImportError::UnsupportedPlatformSafety)
        }
        pub(super) fn identity(&self) -> &ArchiveIdentity {
            unreachable!()
        }
    }

    pub(super) fn open_archive(_path: &Path) -> Result<OpenedArchive, ArchiveImportError> {
        Err(ArchiveImportError::UnsupportedPlatformSafety)
    }
    pub(super) fn verify_handle(_opened: &OpenedArchive) -> Result<(), ArchiveImportError> {
        Err(ArchiveImportError::UnsupportedPlatformSafety)
    }
    pub(super) fn verify_source(_opened: &OpenedArchive) -> Result<(), ArchiveImportError> {
        Err(ArchiveImportError::UnsupportedPlatformSafety)
    }
}

#[cfg(test)]
#[path = "archive_tests.rs"]
mod tests;
