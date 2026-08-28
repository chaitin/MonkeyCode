//! 文件夹技能来源的安全清单、发现与暂存。
//!
//! 统一的 std 路径实现：枚举、复核与打开的每一层都以 `symlink_metadata` 拒绝
//! symlink 与特殊对象；来源一致性由稳定元数据清单在暂存前后整树重扫比对保证，
//! 不再按平台钉扎目录或文件句柄。

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

use super::lease::{LeaseError, SourceKey, SourceReservation, StagingQuota, UnboundedStagingQuota};
use super::model::{
    MAX_BYTES_PER_BATCH, MAX_BYTES_PER_FILE, MAX_BYTES_PER_SKILL, MAX_ENTRIES_PER_BATCH,
    MAX_ENTRIES_PER_SKILL, MAX_PATH_DEPTH, MAX_SKILLS_PER_BATCH, MAX_SKILL_MD_BYTES,
};

const SKILL_FILE: &str = "SKILL.md";
const COPY_BUFFER_BYTES: usize = 64 * 1024;

/// 调用方已暂存批次的用量。只有整个新来源成功时才更新。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct FolderBatchUsage {
    pub skills: usize,
    pub entries: usize,
    pub bytes: u64,
}

/// 单个技能暂存后的内部模型。该类型刻意不实现 `Serialize`，绝对暂存路径只在
/// Rust 壳中流转；其余字段足以供后续任务构造 `SkillImportItem`。
#[derive(Debug)]
pub(crate) struct StagedFolderSkill {
    pub relative_root: String,
    pub staged_root: Option<PathBuf>,
    pub entries: Vec<StagedFolderEntry>,
    pub entry_count: usize,
    pub total_size: u64,
    pub invalid_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StagedFolderEntry {
    pub relative_path: String,
    pub kind: FolderEntryKind,
    pub size: u64,
    pub platform_executable: bool,
}

#[derive(Debug)]
pub(crate) struct StagedFolderSource {
    pub skills: Vec<StagedFolderSkill>,
    pub entry_count: usize,
    pub total_size: u64,
    /// 后续提交预检可保留并比较的来源指纹，不可序列化。
    pub fingerprint: FolderSourceFingerprint,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FolderSourceFingerprint {
    root: StableMetadata,
    entries: Vec<ManifestEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FolderEntryKind {
    File,
    Directory,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ManifestEntry {
    path: RelativePath,
    kind: FolderEntryKind,
    stable: StableMetadata,
    platform_executable: bool,
}

/// 预检后的安全来源清单。根句柄和绝对来源路径均不可序列化。
#[derive(Debug)]
pub(crate) struct SecureFolderManifest {
    source_path: PathBuf,
    root: platform::RootHandle,
    root_stable: StableMetadata,
    entries: Vec<ManifestEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct StableMetadata {
    object_a: u64,
    object_b: u64,
    object_c: u64,
    size: u64,
    modified_seconds: i64,
    modified_nanos: i64,
    changed_seconds: i64,
    changed_nanos: i64,
    kind: FolderEntryKind,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct RelativePath(String);

impl RelativePath {
    fn root() -> Self {
        Self(String::new())
    }

    fn parse(path: &Path) -> Result<Self, FolderImportError> {
        if path.as_os_str().is_empty() || path == Path::new(".") {
            return Ok(Self::root());
        }
        if path.is_absolute() {
            return Err(FolderImportError::unsafe_path("路径不得为绝对路径"));
        }
        let mut parts = Vec::new();
        for component in path.components() {
            match component {
                Component::Normal(part) => {
                    let Some(part) = part.to_str() else {
                        return Err(FolderImportError::unsafe_path("路径必须是有效 Unicode"));
                    };
                    if part.is_empty() || part == "." || part == ".." || part.contains(['/', '\\'])
                    {
                        return Err(FolderImportError::unsafe_path("路径包含非法组件"));
                    }
                    parts.push(part);
                }
                _ => {
                    return Err(FolderImportError::unsafe_path(
                        "路径包含绝对或父目录跳转组件",
                    ))
                }
            }
        }
        if parts.len() > MAX_PATH_DEPTH {
            return Err(FolderImportError::PathTooDeep {
                relative_path: parts.join("/"),
            });
        }
        Ok(Self(parts.join("/")))
    }

    fn child(&self, name: &str) -> Result<Self, FolderImportError> {
        if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
            return Err(FolderImportError::unsafe_path("目录项包含非法路径组件"));
        }
        let path = if self.0.is_empty() {
            name.to_string()
        } else {
            format!("{}/{}", self.0, name)
        };
        Self::parse(Path::new(&path))
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
        let mut path = PathBuf::new();
        for component in self.0.split('/').filter(|part| !part.is_empty()) {
            path.push(component);
        }
        path
    }

    fn ancestors_inclusive(&self) -> Vec<Self> {
        if self.0.is_empty() {
            return vec![Self::root()];
        }
        let mut output = Vec::with_capacity(self.depth());
        let mut current = Self::root();
        for component in self.0.split('/') {
            current = current
                .child(component)
                .expect("已规范化路径的组件始终安全");
            output.push(current.clone());
        }
        output
    }

    fn display(&self) -> &str {
        if self.0.is_empty() {
            "."
        } else {
            &self.0
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct FolderLimits {
    manifest_entries: usize,
    entries_per_skill: usize,
    bytes_per_skill: u64,
    bytes_per_file: u64,
    skill_md_bytes: u64,
    entries_per_batch: usize,
    bytes_per_batch: u64,
    copy_buffer_bytes: usize,
}

impl FolderLimits {
    const fn production() -> Self {
        Self {
            manifest_entries: MAX_ENTRIES_PER_BATCH,
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
pub(crate) enum FolderImportError {
    SourceNotDirectory,
    UnsafeEntry {
        relative_path: String,
        reason: &'static str,
    },
    PathTooDeep {
        relative_path: String,
    },
    SourceChanged {
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
    CleanupFailed {
        relative_path: String,
        message: String,
    },
    Io {
        operation: &'static str,
        relative_path: String,
        message: String,
    },
}

impl FolderImportError {
    fn unsafe_path(reason: &'static str) -> Self {
        Self::UnsafeEntry {
            relative_path: ".".into(),
            reason,
        }
    }

    fn io(operation: &'static str, relative: &RelativePath, error: impl fmt::Display) -> Self {
        Self::Io {
            operation,
            relative_path: relative.display().to_string(),
            message: error.to_string(),
        }
    }
}

impl fmt::Display for FolderImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceNotDirectory => write!(formatter, "所选来源不是普通目录"),
            Self::UnsafeEntry {
                relative_path,
                reason,
            } => write!(formatter, "来源条目 {relative_path} 不安全: {reason}"),
            Self::PathTooDeep { relative_path } => {
                write!(formatter, "来源路径超过 64 层: {relative_path}")
            }
            Self::SourceChanged { relative_path } => {
                write!(formatter, "来源在检查后发生变化: {relative_path}")
            }
            Self::TargetCollision { relative_path } => {
                write!(formatter, "暂存目标存在名称或类型碰撞: {relative_path}")
            }
            Self::BatchSkillsExceeded => write!(formatter, "批次检测技能超过 100 个"),
            Self::BatchEntriesExceeded => write!(formatter, "批次暂存条目超过上限"),
            Self::BatchBytesExceeded => write!(formatter, "批次暂存大小超过上限"),
            Self::ConfigQuotaExceeded { message } => write!(formatter, "{message}"),
            Self::CleanupFailed {
                relative_path,
                message,
            } => write!(formatter, "清理暂存对象 {relative_path} 失败: {message}"),
            Self::Io {
                operation,
                relative_path,
                message,
            } => write!(formatter, "{operation} {relative_path} 失败: {message}"),
        }
    }
}

impl std::error::Error for FolderImportError {}

impl From<LeaseError> for FolderImportError {
    fn from(error: LeaseError) -> Self {
        Self::ConfigQuotaExceeded {
            message: error.to_string(),
        }
    }
}

/// 打开固定来源根并建立完整安全清单。枚举阶段只接受普通文件和普通目录；链接、
/// FIFO、socket 与设备在内容打开之前即被拒绝。
pub(crate) fn preflight_folder(
    source_path: &Path,
) -> Result<SecureFolderManifest, FolderImportError> {
    preflight_folder_with_limit(source_path, MAX_ENTRIES_PER_BATCH)
}

fn preflight_folder_with_limit(
    source_path: &Path,
    max_entries: usize,
) -> Result<SecureFolderManifest, FolderImportError> {
    let (root, root_stable) = platform::open_root(source_path)?;
    let entries = scan_manifest(&root, &root_stable, max_entries)?;
    Ok(SecureFolderManifest {
        source_path: source_path.to_path_buf(),
        root,
        root_stable,
        entries,
    })
}

/// 从完整安全清单执行稳定 DFS。发现技能根后不再访问其后代。
pub(crate) fn discover_folder_skills(manifest: &SecureFolderManifest) -> Vec<String> {
    discover_skill_paths(&manifest.entries)
        .into_iter()
        .map(|path| path.display().to_string())
        .collect()
}

/// 预检、发现并把每个技能安全复制到调用方提供的来源独立暂存根。
pub(crate) fn stage_folder_source(
    source_path: &Path,
    staging_root: &Path,
    batch_usage: &mut FolderBatchUsage,
) -> Result<StagedFolderSource, FolderImportError> {
    stage_folder_source_inner(
        source_path,
        staging_root,
        batch_usage,
        FolderLimits::production(),
        None,
    )
}

/// 生产状态层入口：暂存根由来源 reservation 分配，跨实例 entry/byte 在实际
/// 创建和写入前增量预留。失败时调用方丢弃 reservation 即完整释放。
pub(crate) fn stage_folder_source_with_reservation(
    source_path: &Path,
    batch_usage: &mut FolderBatchUsage,
    reservation: &mut SourceReservation,
) -> Result<StagedFolderSource, FolderImportError> {
    let staging_root = reservation.staging_root().to_path_buf();
    stage_folder_source_inner_with_quota(
        source_path,
        &staging_root,
        batch_usage,
        FolderLimits::production(),
        None,
        reservation,
        None,
    )
}

fn scan_manifest(
    root: &platform::RootHandle,
    expected_root: &StableMetadata,
    max_entries: usize,
) -> Result<Vec<ManifestEntry>, FolderImportError> {
    let mut output = Vec::new();
    scan_directory(
        root,
        &RelativePath::root(),
        expected_root,
        &mut output,
        max_entries,
    )?;
    output.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(output)
}

fn scan_directory(
    root: &platform::RootHandle,
    relative: &RelativePath,
    expected: &StableMetadata,
    output: &mut Vec<ManifestEntry>,
    max_entries: usize,
) -> Result<(), FolderImportError> {
    let remaining_entries = max_entries.saturating_sub(output.len());
    let (actual, mut children) = platform::list_directory(root, relative, remaining_entries)?;
    if &actual != expected {
        return Err(FolderImportError::SourceChanged {
            relative_path: relative.display().to_string(),
        });
    }
    children.sort_by(|left, right| left.name.cmp(&right.name));
    let mut child_directories = Vec::new();
    for child in children {
        if output.len() >= max_entries {
            return Err(FolderImportError::BatchEntriesExceeded);
        }
        let child_path = relative.child(&child.name)?;
        let entry = ManifestEntry {
            path: child_path.clone(),
            kind: child.stable.kind,
            stable: child.stable,
            platform_executable: child.platform_executable,
        };
        output.push(entry.clone());
        if entry.kind == FolderEntryKind::Directory {
            child_directories.push((child_path, entry.stable));
        }
    }
    // 先把本级条目全部记入全局 manifest，再下探。这样下一级拿到的 remaining
    // 预算包含尚未递归前的全部兄弟项，不会因持有父级 Vec 而跨层超配。
    for (child_path, child_stable) in child_directories {
        scan_directory(root, &child_path, &child_stable, output, max_entries)?;
    }
    let after = platform::metadata_for_directory(root, relative)?;
    if &after != expected {
        return Err(FolderImportError::SourceChanged {
            relative_path: relative.display().to_string(),
        });
    }
    Ok(())
}

fn discover_skill_paths(entries: &[ManifestEntry]) -> Vec<RelativePath> {
    let mut directory_children: BTreeMap<RelativePath, Vec<RelativePath>> = BTreeMap::new();
    let mut skill_files = BTreeSet::new();
    directory_children.entry(RelativePath::root()).or_default();

    for entry in entries {
        if is_excluded_path(&entry.path, entry.kind) {
            continue;
        }
        if entry.kind == FolderEntryKind::Directory {
            directory_children
                .entry(entry.path.parent())
                .or_default()
                .push(entry.path.clone());
            directory_children.entry(entry.path.clone()).or_default();
        } else if entry.path.file_name() == SKILL_FILE {
            skill_files.insert(entry.path.parent());
        }
    }
    for children in directory_children.values_mut() {
        children.sort();
        children.dedup();
    }

    fn dfs(
        directory: &RelativePath,
        children: &BTreeMap<RelativePath, Vec<RelativePath>>,
        skill_files: &BTreeSet<RelativePath>,
        found: &mut Vec<RelativePath>,
    ) {
        if skill_files.contains(directory) {
            found.push(directory.clone());
            return;
        }
        if let Some(next) = children.get(directory) {
            for child in next {
                dfs(child, children, skill_files, found);
            }
        }
    }

    let mut found = Vec::new();
    dfs(
        &RelativePath::root(),
        &directory_children,
        &skill_files,
        &mut found,
    );
    found.sort();
    found
}

fn is_excluded_path(path: &RelativePath, kind: FolderEntryKind) -> bool {
    let mut components = path.0.split('/');
    while let Some(component) = components.next() {
        if matches!(
            component,
            ".git" | "__MACOSX" | ".imports" | ".backups" | ".transactions"
        ) {
            return true;
        }
    }
    kind == FolderEntryKind::File && is_platform_metadata(path.file_name())
}

fn is_platform_metadata(name: &str) -> bool {
    name.eq_ignore_ascii_case(".DS_Store")
        || name.eq_ignore_ascii_case("Thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
        || name.starts_with("._")
}

fn stage_folder_source_inner(
    source_path: &Path,
    staging_root: &Path,
    batch_usage: &mut FolderBatchUsage,
    limits: FolderLimits,
    after_manifest: Option<&dyn Fn()>,
) -> Result<StagedFolderSource, FolderImportError> {
    let mut quota = UnboundedStagingQuota::default();
    stage_folder_source_inner_with_quota(
        source_path,
        staging_root,
        batch_usage,
        limits,
        after_manifest,
        &mut quota,
        None,
    )
}

type CleanupHook<'a> = dyn Fn(&Path) -> io::Result<()> + 'a;

fn stage_folder_source_inner_with_cleanup(
    source_path: &Path,
    staging_root: &Path,
    batch_usage: &mut FolderBatchUsage,
    limits: FolderLimits,
    after_manifest: Option<&dyn Fn()>,
    cleanup_hook: Option<&CleanupHook<'_>>,
) -> Result<StagedFolderSource, FolderImportError> {
    let mut quota = UnboundedStagingQuota::default();
    stage_folder_source_inner_with_quota(
        source_path,
        staging_root,
        batch_usage,
        limits,
        after_manifest,
        &mut quota,
        cleanup_hook,
    )
}

#[allow(clippy::too_many_arguments)]
fn stage_folder_source_inner_with_quota(
    source_path: &Path,
    staging_root: &Path,
    batch_usage: &mut FolderBatchUsage,
    limits: FolderLimits,
    after_manifest: Option<&dyn Fn()>,
    quota: &mut dyn StagingQuota,
    cleanup_hook: Option<&CleanupHook<'_>>,
) -> Result<StagedFolderSource, FolderImportError> {
    let manifest = preflight_folder_with_limit(source_path, limits.manifest_entries)?;
    let skill_roots = discover_skill_paths(&manifest.entries);
    if batch_usage.skills + skill_roots.len() > MAX_SKILLS_PER_BATCH {
        return Err(FolderImportError::BatchSkillsExceeded);
    }
    if let Some(hook) = after_manifest {
        hook();
    }
    if skill_roots.is_empty() {
        verify_manifest_unchanged(&manifest)?;
        return Ok(StagedFolderSource {
            skills: Vec::new(),
            entry_count: 0,
            total_size: 0,
            fingerprint: manifest.fingerprint(),
        });
    }

    let source_skill_count = skill_roots.len();
    let plans = skill_roots
        .into_iter()
        .map(|root| {
            let entries = entries_for_skill(&manifest.entries, &root);
            let entry_count = entries.len() + 1; // 技能根本身也是实际暂存对象。
            (root, entries, entry_count)
        })
        .collect::<Vec<_>>();
    let planned_roots = plans
        .iter()
        .filter(|(_, _, entry_count)| *entry_count <= limits.entries_per_skill)
        .map(|(root, _, _)| root.clone())
        .collect::<Vec<_>>();
    let planned_paths = staged_object_paths(&manifest.entries, &planned_roots);
    let starting_usage = *batch_usage;
    if starting_usage.entries + planned_paths.len() > limits.entries_per_batch {
        return Err(FolderImportError::BatchEntriesExceeded);
    }

    preflight_target_paths(staging_root, &planned_paths)?;
    let before_root_entry = quota.checkpoint();
    if planned_paths.contains_key(&RelativePath::root()) {
        // ZIP/文件夹虚拟根本身是根技能目录时，来源 staging root 同时也是一个
        // 技能 entry；普通包装来源的基础设施 root 不计入批次。
        quota.reserve_entries(1)?;
    }
    create_staging_root(staging_root)?;
    let mut guard = StagingGuard::new(staging_root, cleanup_hook);

    let operation = (|| {
        let mut source_usage = FolderBatchUsage {
            skills: source_skill_count,
            ..FolderBatchUsage::default()
        };
        let mut skills = Vec::with_capacity(plans.len());
        let mut successful_roots = Vec::new();

        for (skill_root, skill_entries, entry_count) in plans {
            let quota_checkpoint = if skill_root == RelativePath::root() {
                before_root_entry
            } else {
                quota.checkpoint()
            };
            let target_skill_root = staging_root.join(skill_root.to_path_buf());
            if entry_count > limits.entries_per_skill {
                skills.push(invalid_skill(
                    &skill_root,
                    "技能条目数超过 1000 个",
                    entry_count,
                ));
                continue;
            }
            ensure_target_directory(
                staging_root,
                &skill_root,
                &mut guard.created_directories,
                quota,
            )?;
            let copy_result = copy_one_skill(
                &manifest,
                staging_root,
                &skill_root,
                &skill_entries,
                starting_usage,
                source_usage,
                limits,
                &mut guard.created_directories,
                quota,
            );
            match copy_result {
                Ok(skill) => {
                    source_usage.bytes += skill.total_size;
                    successful_roots.push(skill_root);
                    skills.push(skill);
                }
                Err(CopySkillError::Invalid(reason)) => {
                    cleanup_skill_target(
                        staging_root,
                        &target_skill_root,
                        &skill_root,
                        cleanup_hook,
                    )?;
                    guard
                        .created_directories
                        .retain(|path| fs::symlink_metadata(path).is_ok());
                    quota.rollback_to(quota_checkpoint)?;
                    skills.push(invalid_skill(&skill_root, reason, entry_count));
                }
                Err(CopySkillError::Source(error)) => return Err(error),
            }
        }

        verify_manifest_unchanged(&manifest)?;
        let actual_paths = staged_object_paths(&manifest.entries, &successful_roots);
        source_usage.entries = actual_paths.len();
        debug_assert!(starting_usage.entries + source_usage.entries <= limits.entries_per_batch);
        Ok((
            StagedFolderSource {
                skills,
                entry_count: source_usage.entries,
                total_size: source_usage.bytes,
                fingerprint: manifest.fingerprint(),
            },
            source_usage,
        ))
    })();

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
        Err(error) => match guard.cleanup_explicit() {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(cleanup_error),
        },
    }
}

impl FolderSourceFingerprint {
    pub(crate) fn source_key(&self) -> SourceKey {
        SourceKey::folder_identity(self.root.object_a, self.root.object_b)
    }
}

/// commit 预检在后台重新固定并完整枚举来源；任何对象、类型、大小或时间身份变化
/// 都会使指纹不相等。绝对来源路径只作为壳侧输入，不进入错误或 serde 模型。
pub(crate) fn verify_folder_source_fingerprint(
    source_path: &Path,
    expected: &FolderSourceFingerprint,
) -> Result<(), FolderImportError> {
    let manifest = preflight_folder(source_path)?;
    verify_manifest_unchanged(&manifest)?;
    if &manifest.fingerprint() != expected {
        return Err(FolderImportError::SourceChanged {
            relative_path: ".".into(),
        });
    }
    Ok(())
}

impl SecureFolderManifest {
    fn fingerprint(&self) -> FolderSourceFingerprint {
        FolderSourceFingerprint {
            root: self.root_stable.clone(),
            entries: self.entries.clone(),
        }
    }
}

fn entries_for_skill(entries: &[ManifestEntry], root: &RelativePath) -> Vec<ManifestEntry> {
    entries
        .iter()
        .filter(|entry| {
            entry.path.is_descendant_of(root) && !is_excluded_path(&entry.path, entry.kind)
        })
        .cloned()
        .collect()
}

/// 返回真实会在来源 staging 根下存在的唯一对象。技能自身计一个 entry；深层
/// 技能所需的来源包装祖先也计入，多个技能共享的祖先只保留一次。
fn staged_object_paths(
    entries: &[ManifestEntry],
    skill_roots: &[RelativePath],
) -> BTreeMap<RelativePath, FolderEntryKind> {
    let mut output = BTreeMap::new();
    for root in skill_roots {
        for ancestor in root.ancestors_inclusive() {
            output.insert(ancestor, FolderEntryKind::Directory);
        }
        for entry in entries {
            if entry.path.is_descendant_of(root) && !is_excluded_path(&entry.path, entry.kind) {
                output.insert(entry.path.clone(), entry.kind);
            }
        }
    }
    output
}

fn invalid_skill(
    root: &RelativePath,
    reason: impl Into<String>,
    entry_count: usize,
) -> StagedFolderSkill {
    StagedFolderSkill {
        relative_root: root.display().to_string(),
        staged_root: None,
        entries: Vec::new(),
        entry_count,
        total_size: 0,
        invalid_reason: Some(reason.into()),
    }
}

#[derive(Debug)]
enum CopySkillError {
    Invalid(String),
    Source(FolderImportError),
}

impl From<FolderImportError> for CopySkillError {
    fn from(error: FolderImportError) -> Self {
        Self::Source(error)
    }
}

impl From<LeaseError> for CopySkillError {
    fn from(error: LeaseError) -> Self {
        Self::Source(error.into())
    }
}

#[allow(clippy::too_many_arguments)]
fn copy_one_skill(
    manifest: &SecureFolderManifest,
    staging_root: &Path,
    skill_root: &RelativePath,
    entries: &[ManifestEntry],
    batch_start: FolderBatchUsage,
    source_usage: FolderBatchUsage,
    limits: FolderLimits,
    created_directories: &mut BTreeSet<PathBuf>,
    quota: &mut dyn StagingQuota,
) -> Result<StagedFolderSkill, CopySkillError> {
    let mut copied = Vec::with_capacity(entries.len());
    let mut skill_bytes = 0u64;
    let mut buffer = vec![0u8; limits.copy_buffer_bytes.max(1)];

    for entry in entries {
        let within_skill = entry.path.relative_to(skill_root);
        let target = staging_root.join(entry.path.to_path_buf());
        match entry.kind {
            FolderEntryKind::Directory => {
                let actual = platform::metadata_for_directory(&manifest.root, &entry.path)?;
                if actual != entry.stable || actual.kind != FolderEntryKind::Directory {
                    return Err(FolderImportError::SourceChanged {
                        relative_path: entry.path.display().to_string(),
                    }
                    .into());
                }
                ensure_target_directory(staging_root, &entry.path, created_directories, quota)?;
                copied.push(StagedFolderEntry {
                    relative_path: within_skill,
                    kind: FolderEntryKind::Directory,
                    size: 0,
                    platform_executable: entry.platform_executable,
                });
            }
            FolderEntryKind::File => {
                ensure_target_parent(staging_root, &entry.path, created_directories, quota)?;
                let mut source = platform::open_file(&manifest.root, &entry.path, &entry.stable)?;
                let before = platform::metadata_for_open_file(&source)?;
                if before != entry.stable || before.kind != FolderEntryKind::File {
                    return Err(FolderImportError::SourceChanged {
                        relative_path: entry.path.display().to_string(),
                    }
                    .into());
                }
                quota.reserve_entries(1)?;
                let mut target_file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target)
                    .map_err(|error| {
                        CopySkillError::Source(if error.kind() == io::ErrorKind::AlreadyExists {
                            FolderImportError::TargetCollision {
                                relative_path: entry.path.display().to_string(),
                            }
                        } else {
                            FolderImportError::io("创建暂存文件", &entry.path, error)
                        })
                    })?;
                let mut file_bytes = 0u64;
                loop {
                    let read = source.read(&mut buffer).map_err(|error| {
                        FolderImportError::io("读取来源文件", &entry.path, error)
                    })?;
                    if read == 0 {
                        break;
                    }
                    // 先复核对象稳定性，再解释容量结果。并发增长/替换属于来源级
                    // TOCTOU，不能被降级成仅当前技能无效。
                    let during = platform::metadata_for_open_file(&source)?;
                    if during != before {
                        return Err(FolderImportError::SourceChanged {
                            relative_path: entry.path.display().to_string(),
                        }
                        .into());
                    }
                    file_bytes = file_bytes.saturating_add(read as u64);
                    skill_bytes = skill_bytes.saturating_add(read as u64);
                    if file_bytes > limits.bytes_per_file {
                        return Err(CopySkillError::Invalid("单个文件超过 10 MiB".into()));
                    }
                    if entry.path.file_name() == SKILL_FILE && file_bytes > limits.skill_md_bytes {
                        return Err(CopySkillError::Invalid("SKILL.md 超过 1 MiB".into()));
                    }
                    if skill_bytes > limits.bytes_per_skill {
                        return Err(CopySkillError::Invalid("技能总大小超过 50 MiB".into()));
                    }
                    if batch_start.bytes + source_usage.bytes + skill_bytes > limits.bytes_per_batch
                    {
                        return Err(FolderImportError::BatchBytesExceeded.into());
                    }
                    quota.reserve_bytes(read as u64)?;
                    target_file.write_all(&buffer[..read]).map_err(|error| {
                        FolderImportError::io("写入暂存文件", &entry.path, error)
                    })?;
                }
                target_file
                    .flush()
                    .map_err(|error| FolderImportError::io("刷新暂存文件", &entry.path, error))?;
                let after = platform::metadata_for_open_file(&source)?;
                if before != after {
                    return Err(FolderImportError::SourceChanged {
                        relative_path: entry.path.display().to_string(),
                    }
                    .into());
                }
                copied.push(StagedFolderEntry {
                    relative_path: within_skill,
                    kind: FolderEntryKind::File,
                    size: file_bytes,
                    platform_executable: entry.platform_executable,
                });
            }
        }
    }

    Ok(StagedFolderSkill {
        relative_root: skill_root.display().to_string(),
        staged_root: Some(staging_root.join(skill_root.to_path_buf())),
        entry_count: copied.len() + 1,
        total_size: skill_bytes,
        entries: copied,
        invalid_reason: None,
    })
}

fn verify_manifest_unchanged(manifest: &SecureFolderManifest) -> Result<(), FolderImportError> {
    platform::verify_root_path(&manifest.source_path, &manifest.root, &manifest.root_stable)?;
    let current_root = platform::metadata_for_directory(&manifest.root, &RelativePath::root())?;
    if current_root != manifest.root_stable {
        return Err(FolderImportError::SourceChanged {
            relative_path: ".".into(),
        });
    }
    let current = scan_manifest(&manifest.root, &manifest.root_stable, MAX_ENTRIES_PER_BATCH)?;
    if current != manifest.entries {
        let changed = first_manifest_difference(&manifest.entries, &current);
        return Err(FolderImportError::SourceChanged {
            relative_path: changed,
        });
    }
    Ok(())
}

fn first_manifest_difference(before: &[ManifestEntry], after: &[ManifestEntry]) -> String {
    before
        .iter()
        .zip(after)
        .find_map(|(left, right)| (left != right).then(|| left.path.display().to_string()))
        .or_else(|| {
            before
                .get(after.len())
                .map(|entry| entry.path.display().to_string())
        })
        .or_else(|| {
            after
                .get(before.len())
                .map(|entry| entry.path.display().to_string())
        })
        .unwrap_or_else(|| ".".into())
}

fn preflight_target_paths(
    staging_root: &Path,
    planned_paths: &BTreeMap<RelativePath, FolderEntryKind>,
) -> Result<(), FolderImportError> {
    if fs::symlink_metadata(staging_root).is_ok() {
        return Err(FolderImportError::TargetCollision {
            relative_path: ".".into(),
        });
    }
    let parent = staging_root
        .parent()
        .ok_or(FolderImportError::TargetCollision {
            relative_path: ".".into(),
        })?;
    let case_insensitive = target_is_case_insensitive(parent)?;
    check_target_path_collisions(planned_paths, case_insensitive)
}

fn check_target_path_collisions(
    planned_paths: &BTreeMap<RelativePath, FolderEntryKind>,
    case_insensitive: bool,
) -> Result<(), FolderImportError> {
    let mut exact: HashMap<String, (String, FolderEntryKind)> = HashMap::new();
    let mut insert =
        |path: &RelativePath, kind: FolderEntryKind| -> Result<(), FolderImportError> {
            let normalized = if case_insensitive {
                path.0.to_ascii_lowercase()
            } else {
                path.0.clone()
            };
            if let Some((previous, previous_kind)) = exact.get(&normalized) {
                if previous != &path.0 || previous_kind != &kind {
                    return Err(FolderImportError::TargetCollision {
                        relative_path: path.display().to_string(),
                    });
                }
            } else {
                exact.insert(normalized, (path.0.clone(), kind));
            }
            Ok(())
        };
    for (path, kind) in planned_paths {
        insert(path, *kind)?;
    }
    Ok(())
}

fn target_is_case_insensitive(parent: &Path) -> Result<bool, FolderImportError> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_PROBE: AtomicU64 = AtomicU64::new(0);
    let id = NEXT_PROBE.fetch_add(1, Ordering::Relaxed);
    let lower = parent.join(format!(
        ".monkeycode-case-probe-{}-{id}-a",
        std::process::id()
    ));
    let upper = parent.join(format!(
        ".monkeycode-case-probe-{}-{id}-A",
        std::process::id()
    ));
    fs::create_dir(&lower).map_err(|error| FolderImportError::Io {
        operation: "探测暂存卷",
        relative_path: ".".into(),
        message: error.to_string(),
    })?;
    let second = fs::create_dir(&upper);
    let insensitive = second
        .as_ref()
        .err()
        .is_some_and(|error| error.kind() == io::ErrorKind::AlreadyExists);
    if second.is_ok() {
        fs::remove_dir(&upper).map_err(|error| cleanup_failed(&RelativePath::root(), error))?;
    }
    fs::remove_dir(&lower).map_err(|error| cleanup_failed(&RelativePath::root(), error))?;
    match second {
        Ok(()) => Ok(false),
        Err(_error) if insensitive => Ok(true),
        Err(error) => Err(FolderImportError::Io {
            operation: "探测暂存卷",
            relative_path: ".".into(),
            message: error.to_string(),
        }),
    }
}

fn create_staging_root(path: &Path) -> Result<(), FolderImportError> {
    fs::create_dir(path).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            FolderImportError::TargetCollision {
                relative_path: ".".into(),
            }
        } else {
            FolderImportError::Io {
                operation: "创建来源暂存根",
                relative_path: ".".into(),
                message: error.to_string(),
            }
        }
    })
}

fn ensure_target_parent(
    staging_root: &Path,
    path: &RelativePath,
    created: &mut BTreeSet<PathBuf>,
    quota: &mut dyn StagingQuota,
) -> Result<(), FolderImportError> {
    ensure_target_directory(staging_root, &path.parent(), created, quota)
}

fn ensure_target_directory(
    staging_root: &Path,
    relative: &RelativePath,
    created: &mut BTreeSet<PathBuf>,
    quota: &mut dyn StagingQuota,
) -> Result<(), FolderImportError> {
    let mut current = staging_root.to_path_buf();
    for component in relative.0.split('/').filter(|part| !part.is_empty()) {
        current.push(component);
        if created.contains(&current) {
            let metadata = fs::symlink_metadata(&current)
                .map_err(|error| FolderImportError::io("复核暂存目录", relative, error))?;
            if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
                return Err(FolderImportError::TargetCollision {
                    relative_path: relative.display().to_string(),
                });
            }
            continue;
        }
        quota.reserve_entries(1)?;
        fs::create_dir(&current).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                FolderImportError::TargetCollision {
                    relative_path: relative.display().to_string(),
                }
            } else {
                FolderImportError::io("创建暂存目录", relative, error)
            }
        })?;
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| FolderImportError::io("复核暂存目录", relative, error))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err(FolderImportError::TargetCollision {
                relative_path: relative.display().to_string(),
            });
        }
        created.insert(current.clone());
    }
    Ok(())
}

fn cleanup_skill_target(
    staging_root: &Path,
    target_skill_root: &Path,
    skill_root: &RelativePath,
    cleanup_hook: Option<&CleanupHook<'_>>,
) -> Result<(), FolderImportError> {
    cleanup_skill_target_with_metadata(
        staging_root,
        target_skill_root,
        skill_root,
        cleanup_hook,
        &filesystem_symlink_metadata,
    )
}

fn filesystem_symlink_metadata(path: &Path) -> io::Result<fs::Metadata> {
    fs::symlink_metadata(path)
}

fn cleanup_skill_target_with_metadata(
    staging_root: &Path,
    target_skill_root: &Path,
    skill_root: &RelativePath,
    cleanup_hook: Option<&CleanupHook<'_>>,
    metadata: &dyn Fn(&Path) -> io::Result<fs::Metadata>,
) -> Result<(), FolderImportError> {
    run_cleanup_hook(target_skill_root, skill_root, cleanup_hook)?;
    if skill_root.depth() == 0 {
        for entry in
            fs::read_dir(staging_root).map_err(|error| cleanup_failed(skill_root, error))?
        {
            let entry = entry.map_err(|error| cleanup_failed(skill_root, error))?;
            let file_type = entry
                .file_type()
                .map_err(|error| cleanup_failed(skill_root, error))?;
            if file_type.is_dir() {
                fs::remove_dir_all(entry.path())
            } else {
                fs::remove_file(entry.path())
            }
            .map_err(|error| cleanup_failed(skill_root, error))?;
        }
    } else {
        match metadata(target_skill_root) {
            Ok(target_metadata) => {
                if target_metadata.file_type().is_dir() && !target_metadata.file_type().is_symlink()
                {
                    fs::remove_dir_all(target_skill_root)
                        .map_err(|error| cleanup_failed(skill_root, error))?;
                } else {
                    fs::remove_file(target_skill_root)
                        .map_err(|error| cleanup_failed(skill_root, error))?;
                }
                prune_empty_skill_ancestors(
                    staging_root,
                    target_skill_root,
                    skill_root,
                    cleanup_hook,
                )?;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                prune_empty_skill_ancestors(
                    staging_root,
                    target_skill_root,
                    skill_root,
                    cleanup_hook,
                )?;
            }
            Err(error) => return Err(cleanup_failed(skill_root, error)),
        }
    }
    Ok(())
}

fn prune_empty_skill_ancestors(
    staging_root: &Path,
    target_skill_root: &Path,
    skill_root: &RelativePath,
    cleanup_hook: Option<&CleanupHook<'_>>,
) -> Result<(), FolderImportError> {
    let mut current = target_skill_root.parent();
    while let Some(directory) = current {
        if directory == staging_root {
            break;
        }
        run_cleanup_hook(directory, skill_root, cleanup_hook)?;
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
            Err(error) => return Err(cleanup_failed(skill_root, error)),
        }
    }
    Ok(())
}

fn run_cleanup_hook(
    path: &Path,
    relative: &RelativePath,
    cleanup_hook: Option<&CleanupHook<'_>>,
) -> Result<(), FolderImportError> {
    if let Some(hook) = cleanup_hook {
        hook(path).map_err(|error| cleanup_failed(relative, error))?;
    }
    Ok(())
}

fn cleanup_failed(relative: &RelativePath, error: impl fmt::Display) -> FolderImportError {
    FolderImportError::CleanupFailed {
        relative_path: relative.display().to_string(),
        message: error.to_string(),
    }
}

struct StagingGuard<'a> {
    root: PathBuf,
    committed: bool,
    preserve_on_drop: bool,
    cleanup_hook: Option<&'a CleanupHook<'a>>,
    created_directories: BTreeSet<PathBuf>,
}

impl<'a> StagingGuard<'a> {
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

    fn cleanup_explicit(&mut self) -> Result<(), FolderImportError> {
        if self.committed {
            return Ok(());
        }
        if let Err(error) = run_cleanup_hook(&self.root, &RelativePath::root(), self.cleanup_hook) {
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
                Err(cleanup_failed(&RelativePath::root(), error))
            }
        }
    }
}

impl Drop for StagingGuard<'_> {
    fn drop(&mut self) {
        if !self.committed && !self.preserve_on_drop {
            // panic 等非预期展开的最后兜底；所有普通错误路径都先调用
            // cleanup_explicit，并会观察及传播删除失败。
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

#[derive(Debug)]
struct PlatformDirectoryEntry {
    name: String,
    stable: StableMetadata,
    platform_executable: bool,
}

/// 统一的 std 平台实现。历史上按平台以固定句柄逐组件打开来源；该句柄钉扎在本
/// 威胁模型下无增益（能改本地暂存文件的攻击者同样能直接改技能库），而 Windows
/// 上受限共享打开还会与其他句柄持有者互斥（线上 os error 32 的根因）。现在每层
/// 都以 `symlink_metadata` 复核并拒绝 symlink 与特殊对象，TOCTOU 由调用方在暂存
/// 前后比对稳定元数据清单兜底。
mod platform {
    use super::*;

    pub(super) struct RootHandle {
        path: PathBuf,
    }

    impl fmt::Debug for RootHandle {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.debug_struct("RootHandle").finish_non_exhaustive()
        }
    }

    pub(super) fn open_root(
        path: &Path,
    ) -> Result<(RootHandle, StableMetadata), FolderImportError> {
        let metadata = fs::symlink_metadata(path).map_err(|error| FolderImportError::Io {
            operation: "检查来源根",
            relative_path: ".".into(),
            message: error.to_string(),
        })?;
        if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
            return Err(FolderImportError::SourceNotDirectory);
        }
        let stable = stable_from_metadata(path, &metadata, FolderEntryKind::Directory);
        Ok((
            RootHandle {
                path: path.to_path_buf(),
            },
            stable,
        ))
    }

    pub(super) fn list_directory(
        root: &RootHandle,
        relative: &RelativePath,
        remaining_entries: usize,
    ) -> Result<(StableMetadata, Vec<PlatformDirectoryEntry>), FolderImportError> {
        let directory = resolve(root, relative);
        let before = directory_metadata(&directory, relative)?;
        let reader = fs::read_dir(&directory)
            .map_err(|error| FolderImportError::io("枚举来源目录", relative, error))?;
        let mut output = Vec::new();
        for entry in reader {
            let entry =
                entry.map_err(|error| FolderImportError::io("枚举来源目录", relative, error))?;
            let name_os = entry.file_name();
            if name_os == "." || name_os == ".." {
                continue;
            }
            // 在构造第 remaining+1 个名称、稳定元数据或输出项之前立即停止。
            // 这样单个超宽目录也最多持有剩余 manifest 预算数量的条目。
            if output.len() >= remaining_entries {
                return Err(FolderImportError::BatchEntriesExceeded);
            }
            let Some(name) = name_os.to_str() else {
                return Err(FolderImportError::UnsafeEntry {
                    relative_path: relative.display().to_string(),
                    reason: "路径必须是有效 Unicode",
                });
            };
            let child_path = relative.child(name)?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|error| FolderImportError::io("检查来源条目", &child_path, error))?;
            let stable = stable_for_entry(&entry.path(), &metadata)?;
            output.push(PlatformDirectoryEntry {
                name: name.to_string(),
                stable,
                platform_executable: platform_executable(&metadata),
            });
        }
        let after = directory_metadata(&directory, relative)?;
        if after != before {
            return Err(FolderImportError::SourceChanged {
                relative_path: relative.display().to_string(),
            });
        }
        Ok((before, output))
    }

    pub(super) fn metadata_for_directory(
        root: &RootHandle,
        relative: &RelativePath,
    ) -> Result<StableMetadata, FolderImportError> {
        directory_metadata(&resolve(root, relative), relative)
    }

    pub(super) fn open_file(
        root: &RootHandle,
        relative: &RelativePath,
        expected: &StableMetadata,
    ) -> Result<File, FolderImportError> {
        if relative.0.is_empty() {
            return Err(FolderImportError::unsafe_path("文件路径不能为空"));
        }
        let path = resolve(root, relative);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| FolderImportError::io("检查来源文件", relative, error))?;
        let stable = stable_for_entry(&path, &metadata)?;
        if stable != *expected || stable.kind != FolderEntryKind::File {
            return Err(FolderImportError::SourceChanged {
                relative_path: relative.display().to_string(),
            });
        }
        let file = File::open(&path)
            .map_err(|error| FolderImportError::io("安全打开来源文件", relative, error))?;
        let actual = metadata_for_open_file(&file)?;
        if actual != *expected || actual.kind != FolderEntryKind::File {
            return Err(FolderImportError::SourceChanged {
                relative_path: relative.display().to_string(),
            });
        }
        Ok(file)
    }

    pub(super) fn metadata_for_open_file(file: &File) -> Result<StableMetadata, FolderImportError> {
        let metadata = file.metadata().map_err(|error| FolderImportError::Io {
            operation: "复核已打开来源文件",
            relative_path: ".".into(),
            message: error.to_string(),
        })?;
        let kind = if metadata.file_type().is_file() {
            FolderEntryKind::File
        } else if metadata.file_type().is_dir() {
            FolderEntryKind::Directory
        } else {
            return Err(FolderImportError::UnsafeEntry {
                relative_path: ".".into(),
                reason: "已打开对象不是普通磁盘文件",
            });
        };
        #[cfg_attr(unix, allow(unused_mut))]
        let mut stable = stable_from_metadata(Path::new("."), &metadata, kind);
        // 句柄侧与路径侧身份同源(volume/file-index),同一文件必然可比对。
        #[cfg(not(unix))]
        if let Some((object_a, object_b)) = crate::config::open_file_identity(file) {
            stable.object_a = object_a;
            stable.object_b = object_b;
        }
        Ok(stable)
    }

    pub(super) fn verify_root_path(
        path: &Path,
        _root: &RootHandle,
        expected: &StableMetadata,
    ) -> Result<(), FolderImportError> {
        let metadata =
            fs::symlink_metadata(path).map_err(|_| FolderImportError::SourceChanged {
                relative_path: ".".into(),
            })?;
        if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
            return Err(FolderImportError::SourceChanged {
                relative_path: ".".into(),
            });
        }
        let current = stable_from_metadata(path, &metadata, FolderEntryKind::Directory);
        let identity_unchanged = current.kind == expected.kind
            && current.object_a == expected.object_a
            && current.object_b == expected.object_b;
        if !identity_unchanged {
            return Err(FolderImportError::SourceChanged {
                relative_path: ".".into(),
            });
        }
        Ok(())
    }

    fn resolve(root: &RootHandle, relative: &RelativePath) -> PathBuf {
        root.path.join(relative.to_path_buf())
    }

    fn directory_metadata(
        path: &Path,
        relative: &RelativePath,
    ) -> Result<StableMetadata, FolderImportError> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| FolderImportError::io("复核来源目录", relative, error))?;
        let stable = stable_for_entry(path, &metadata)?;
        if stable.kind != FolderEntryKind::Directory {
            return Err(FolderImportError::SourceChanged {
                relative_path: relative.display().to_string(),
            });
        }
        Ok(stable)
    }

    fn stable_for_entry(
        path: &Path,
        metadata: &fs::Metadata,
    ) -> Result<StableMetadata, FolderImportError> {
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(FolderImportError::UnsafeEntry {
                relative_path: ".".into(),
                reason: "不允许符号链接",
            });
        }
        let kind = if file_type.is_dir() {
            FolderEntryKind::Directory
        } else if file_type.is_file() {
            FolderEntryKind::File
        } else {
            return Err(FolderImportError::UnsafeEntry {
                relative_path: ".".into(),
                reason: "只允许普通文件和目录",
            });
        };
        Ok(stable_from_metadata(path, metadata, kind))
    }

    fn stable_from_metadata(
        path: &Path,
        metadata: &fs::Metadata,
        kind: FolderEntryKind,
    ) -> StableMetadata {
        #[cfg(unix)]
        {
            let _ = path;
            use std::os::unix::fs::MetadataExt as _;
            StableMetadata {
                object_a: metadata.dev(),
                object_b: metadata.ino(),
                object_c: 0,
                size: metadata.size(),
                modified_seconds: metadata.mtime(),
                modified_nanos: metadata.mtime_nsec(),
                changed_seconds: metadata.ctime(),
                changed_nanos: metadata.ctime_nsec(),
                kind,
            }
        }
        #[cfg(not(unix))]
        {
            // 非 unix 的 std metadata 拿不到对象身份;经全共享句柄按路径补查
            // (开-查-关,不钉扎),失败退化为 0——所有构造点同源,比对一致。
            let (object_a, object_b) = crate::config::file_identity(path).unwrap_or((0, 0));
            let (modified_seconds, modified_nanos) = time_parts(metadata.modified());
            StableMetadata {
                object_a,
                object_b,
                object_c: 0,
                size: metadata.len(),
                modified_seconds,
                modified_nanos,
                changed_seconds: modified_seconds,
                changed_nanos: modified_nanos,
                kind,
            }
        }
    }

    #[cfg(not(unix))]
    fn time_parts(time: io::Result<std::time::SystemTime>) -> (i64, i64) {
        let Ok(time) = time else { return (0, 0) };
        match time.duration_since(std::time::UNIX_EPOCH) {
            Ok(duration) => (duration.as_secs() as i64, duration.subsec_nanos() as i64),
            Err(before) => {
                let duration = before.duration();
                (-(duration.as_secs() as i64), duration.subsec_nanos() as i64)
            }
        }
    }

    fn platform_executable(metadata: &fs::Metadata) -> bool {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;
            metadata.mode() & 0o111 != 0
        }
        #[cfg(not(unix))]
        {
            let _ = metadata;
            false
        }
    }
}

#[cfg(test)]
#[path = "folder_tests.rs"]
mod tests;
