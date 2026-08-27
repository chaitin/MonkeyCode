//! 文件夹技能来源的安全清单、发现与暂存。
//!
//! 来源绝不经过 `canonicalize` 后再按路径打开。Unix 的所有后代对象都从固定
//! 根目录句柄以 `openat(O_NOFOLLOW)` 打开；Windows 从固定卷或 UNC share 根开始，
//! 以 `NtCreateFile(RootDirectory=parent)` 逐组件打开，绝不拼接后代完整路径。

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
    UnsupportedPlatformSafety,
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
            Self::UnsupportedPlatformSafety => write!(formatter, "当前平台无法保证安全打开来源"),
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

#[cfg(unix)]
mod platform {
    use super::*;
    use std::os::fd::OwnedFd;
    use std::os::unix::ffi::OsStrExt as _;
    use std::os::unix::fs::MetadataExt as _;

    use rustix::fs::{fstat, openat, statat, AtFlags, Dir, FileType, Mode, OFlags, CWD};

    pub(super) struct RootHandle {
        fd: OwnedFd,
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
        let fd = openat(
            CWD,
            path,
            OFlags::RDONLY
                | OFlags::DIRECTORY
                | OFlags::NOFOLLOW
                | OFlags::NONBLOCK
                | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| FolderImportError::Io {
            operation: "固定来源根",
            relative_path: ".".into(),
            message: error.to_string(),
        })?;
        let stable = stable_from_stat(&fstat(&fd).map_err(|error| FolderImportError::Io {
            operation: "复核来源根",
            relative_path: ".".into(),
            message: error.to_string(),
        })?)?;
        if stable.kind != FolderEntryKind::Directory {
            return Err(FolderImportError::SourceNotDirectory);
        }
        let initial = stable_from_metadata(&metadata, FolderEntryKind::Directory);
        if initial.object_a != stable.object_a || initial.object_b != stable.object_b {
            return Err(FolderImportError::SourceChanged {
                relative_path: ".".into(),
            });
        }
        Ok((RootHandle { fd }, stable))
    }

    pub(super) fn list_directory(
        root: &RootHandle,
        relative: &RelativePath,
        remaining_entries: usize,
    ) -> Result<(StableMetadata, Vec<PlatformDirectoryEntry>), FolderImportError> {
        let directory = open_directory(root, relative)?;
        let before = stable_from_stat(
            &fstat(&directory)
                .map_err(|error| FolderImportError::io("复核来源目录", relative, error))?,
        )?;
        if before.kind != FolderEntryKind::Directory {
            return Err(FolderImportError::SourceChanged {
                relative_path: relative.display().to_string(),
            });
        }
        let mut stream = Dir::read_from(&directory)
            .map_err(|error| FolderImportError::io("枚举来源目录", relative, error))?;
        let mut output = Vec::new();
        while let Some(entry) = stream.read() {
            let entry =
                entry.map_err(|error| FolderImportError::io("枚举来源目录", relative, error))?;
            let bytes = entry.file_name().to_bytes();
            if bytes == b"." || bytes == b".." {
                continue;
            }
            // 在构造第 remaining+1 个名称、稳定元数据或输出项之前立即停止。
            // 这样单个超宽目录也最多持有剩余 manifest 预算数量的条目。
            if output.len() >= remaining_entries {
                return Err(FolderImportError::BatchEntriesExceeded);
            }
            let name_os = std::ffi::OsStr::from_bytes(bytes);
            let Some(name) = name_os.to_str() else {
                return Err(FolderImportError::UnsafeEntry {
                    relative_path: relative.display().to_string(),
                    reason: "路径必须是有效 Unicode",
                });
            };
            let child_path = relative.child(name)?;
            let stat = statat(&directory, name_os, AtFlags::SYMLINK_NOFOLLOW)
                .map_err(|error| FolderImportError::io("检查来源条目", &child_path, error))?;
            let stable = stable_from_stat(&stat)?;
            if !matches!(
                stable.kind,
                FolderEntryKind::File | FolderEntryKind::Directory
            ) {
                return Err(FolderImportError::UnsafeEntry {
                    relative_path: child_path.display().to_string(),
                    reason: "只允许普通文件和目录",
                });
            }
            if stable.kind == FolderEntryKind::Directory {
                let opened = openat(&directory, name_os, directory_flags(), Mode::empty())
                    .map_err(|error| FolderImportError::io("固定来源目录", &child_path, error))?;
                let opened_stable =
                    stable_from_stat(&fstat(&opened).map_err(|error| {
                        FolderImportError::io("复核来源目录", &child_path, error)
                    })?)?;
                if opened_stable != stable {
                    return Err(FolderImportError::SourceChanged {
                        relative_path: child_path.display().to_string(),
                    });
                }
            }
            output.push(PlatformDirectoryEntry {
                name: name.to_string(),
                stable,
                platform_executable: stat.st_mode & 0o111 != 0,
            });
        }
        let after = stable_from_stat(
            &fstat(&directory)
                .map_err(|error| FolderImportError::io("复核来源目录", relative, error))?,
        )?;
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
        let fd = open_directory(root, relative)?;
        stable_from_stat(
            &fstat(&fd).map_err(|error| FolderImportError::io("复核来源目录", relative, error))?,
        )
    }

    pub(super) fn open_file(
        root: &RootHandle,
        relative: &RelativePath,
        expected: &StableMetadata,
    ) -> Result<File, FolderImportError> {
        let (parent, name) = split_parent(relative)?;
        let parent_fd = open_directory(root, &parent)?;
        let fd = openat(
            &parent_fd,
            std::ffi::OsStr::new(name),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| FolderImportError::io("安全打开来源文件", relative, error))?;
        let actual = stable_from_stat(
            &fstat(&fd).map_err(|error| FolderImportError::io("复核来源文件", relative, error))?,
        )?;
        if actual != *expected || actual.kind != FolderEntryKind::File {
            return Err(FolderImportError::SourceChanged {
                relative_path: relative.display().to_string(),
            });
        }
        Ok(File::from(fd))
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
        Ok(stable_from_metadata(&metadata, kind))
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
        let current = stable_from_metadata(&metadata, FolderEntryKind::Directory);
        if &current != expected {
            return Err(FolderImportError::SourceChanged {
                relative_path: ".".into(),
            });
        }
        Ok(())
    }

    fn open_directory(
        root: &RootHandle,
        relative: &RelativePath,
    ) -> Result<OwnedFd, FolderImportError> {
        let mut current =
            openat(&root.fd, ".", directory_flags(), Mode::empty()).map_err(|error| {
                FolderImportError::io("复制来源根句柄", &RelativePath::root(), error)
            })?;
        let mut walked = RelativePath::root();
        for component in relative.0.split('/').filter(|part| !part.is_empty()) {
            walked = walked.child(component)?;
            current = openat(
                &current,
                std::ffi::OsStr::new(component),
                directory_flags(),
                Mode::empty(),
            )
            .map_err(|error| FolderImportError::io("安全打开来源目录", &walked, error))?;
            let stable = stable_from_stat(
                &fstat(&current)
                    .map_err(|error| FolderImportError::io("复核来源目录", &walked, error))?,
            )?;
            if stable.kind != FolderEntryKind::Directory {
                return Err(FolderImportError::SourceChanged {
                    relative_path: walked.display().to_string(),
                });
            }
        }
        Ok(current)
    }

    fn directory_flags() -> OFlags {
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC
    }

    fn split_parent(relative: &RelativePath) -> Result<(RelativePath, &str), FolderImportError> {
        if relative.0.is_empty() {
            return Err(FolderImportError::unsafe_path("文件路径不能为空"));
        }
        Ok((relative.parent(), relative.file_name()))
    }

    fn stable_from_stat(stat: &rustix::fs::Stat) -> Result<StableMetadata, FolderImportError> {
        let kind = match FileType::from_raw_mode(stat.st_mode) {
            FileType::RegularFile => FolderEntryKind::File,
            FileType::Directory => FolderEntryKind::Directory,
            FileType::Symlink => {
                return Err(FolderImportError::UnsafeEntry {
                    relative_path: ".".into(),
                    reason: "不允许符号链接",
                })
            }
            _ => {
                return Err(FolderImportError::UnsafeEntry {
                    relative_path: ".".into(),
                    reason: "只允许普通文件和目录",
                })
            }
        };
        let (modified_seconds, modified_nanos, changed_seconds, changed_nanos) = stat_times(stat);
        Ok(StableMetadata {
            object_a: stat.st_dev as u64,
            object_b: stat.st_ino as u64,
            object_c: 0,
            size: stat.st_size.max(0) as u64,
            modified_seconds,
            modified_nanos,
            changed_seconds,
            changed_nanos,
            kind,
        })
    }

    fn stable_from_metadata(metadata: &fs::Metadata, kind: FolderEntryKind) -> StableMetadata {
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

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn stat_times(stat: &rustix::fs::Stat) -> (i64, i64, i64, i64) {
        (
            stat.st_mtime,
            stat.st_mtime_nsec,
            stat.st_ctime,
            stat.st_ctime_nsec,
        )
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    fn stat_times(_stat: &rustix::fs::Stat) -> (i64, i64, i64, i64) {
        (0, 0, 0, 0)
    }
}

// Windows 只用一次完整路径 API 固定卷或 UNC share 根；选中根及其所有后代均
// 通过已固定父句柄逐组件打开。禁止在此模块中保存可供后代重新拼接的根路径。
#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::{OsStr, OsString};
    use std::mem::{offset_of, size_of};
    use std::os::windows::ffi::{OsStrExt as _, OsStringExt as _};
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, RawHandle};
    use std::path::Prefix;

    use windows::core::{PCWSTR, PWSTR};
    use windows::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows::Wdk::Storage::FileSystem::{
        NtCreateFile, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
        FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT,
    };
    use windows::Win32::Foundation::{
        HANDLE, OBJ_CASE_INSENSITIVE, OBJ_DONT_REPARSE, UNICODE_STRING,
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
        identity: ObjectIdentity,
        component_identities: Vec<ObjectIdentity>,
    }

    impl fmt::Debug for RootHandle {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("RootHandle")
                .field("identity", &self.identity)
                .finish_non_exhaustive()
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct ObjectIdentity {
        volume: u64,
        file_id_low: u64,
        file_id_high: u64,
    }

    struct ParsedAbsolutePath {
        anchor: OsString,
        components: Vec<OsString>,
        labels: Vec<String>,
    }

    #[derive(Clone, Copy)]
    enum OpenKind {
        Any,
        Directory,
        File,
    }

    pub(super) fn open_root(
        path: &Path,
    ) -> Result<(RootHandle, StableMetadata), FolderImportError> {
        let parsed = parse_absolute_path(path)?;
        let (file, component_identities) = open_selected_path(&parsed)?;
        let stable = inspect_handle(&file, &RelativePath::root())?;
        if stable.kind != FolderEntryKind::Directory {
            return Err(FolderImportError::SourceNotDirectory);
        }
        let identity = identity(&stable);
        Ok((
            RootHandle {
                file,
                identity,
                component_identities,
            },
            stable,
        ))
    }

    pub(super) fn list_directory(
        root: &RootHandle,
        relative: &RelativePath,
        remaining_entries: usize,
    ) -> Result<(StableMetadata, Vec<PlatformDirectoryEntry>), FolderImportError> {
        let directory = open_directory(root, relative)?;
        let before = inspect_handle(&directory, relative)?;
        if before.kind != FolderEntryKind::Directory {
            return Err(source_changed(relative));
        }
        let mut output = Vec::new();
        let mut restart = true;
        loop {
            // u64 backing 保证变长 FILE_ID_BOTH_DIR_INFO 记录的对齐。
            let mut buffer = vec![0u64; DIRECTORY_BUFFER_BYTES / size_of::<u64>()];
            // try_clone/DuplicateHandle 共享同一个 file object 及其目录枚举游标。
            // 每次 list 的首个请求必须显式 restart，后续请求再从当前游标继续。
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
                return Err(FolderImportError::io("枚举来源目录句柄", relative, error));
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
                    return Err(unsafe_entry(relative, "目录枚举记录越界"));
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
                    return Err(unsafe_entry(relative, "目录项名称记录非法"));
                }
                let name_start = offset + header_size;
                let wide = bytes[name_start..name_start + name_bytes]
                    .chunks_exact(2)
                    .map(|pair| u16::from_ne_bytes([pair[0], pair[1]]))
                    .collect::<Vec<_>>();
                let name = String::from_utf16(&wide)
                    .map_err(|_| unsafe_entry(relative, "路径必须是有效 Unicode"))?;
                if name != "." && name != ".." {
                    // 在创建第 budget+1 个名称对应的元数据与输出对象前停止。
                    if output.len() >= remaining_entries {
                        return Err(FolderImportError::BatchEntriesExceeded);
                    }
                    let child_path = relative.child(&name)?;
                    let attributes = record.FileAttributes;
                    if attributes & (FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_DEVICE.0) != 0
                    {
                        return Err(FolderImportError::UnsafeEntry {
                            relative_path: child_path.display().to_string(),
                            reason: "不允许重解析点或特殊对象",
                        });
                    }
                    let record_directory = attributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0;
                    let child = open_relative_nt(
                        &directory,
                        OsStr::new(&name),
                        &child_path,
                        if record_directory {
                            OpenKind::Directory
                        } else {
                            OpenKind::File
                        },
                        "父句柄相对打开来源条目",
                    )?;
                    let stable = inspect_handle(&child, &child_path)?;
                    let expected_kind = if record_directory {
                        FolderEntryKind::Directory
                    } else {
                        FolderEntryKind::File
                    };
                    // 枚举记录只提供 64-bit FileId；完整 128-bit identity、size 与
                    // 时间均取自刚刚固定的对象句柄。
                    if stable.kind != expected_kind
                        || stable.object_a != before.object_a
                        || stable.object_b != record.FileId as u64
                        || (stable.kind == FolderEntryKind::File
                            && (stable.size != record.EndOfFile.max(0) as u64
                                || (stable.modified_seconds, stable.modified_nanos)
                                    != windows_time(record.LastWriteTime)))
                    {
                        return Err(source_changed(&child_path));
                    }
                    output.push(PlatformDirectoryEntry {
                        name,
                        stable,
                        platform_executable: false,
                    });
                }
                if record.NextEntryOffset == 0 {
                    break;
                }
                let next = record.NextEntryOffset as usize;
                if next < header_size
                    || offset
                        .checked_add(next)
                        .is_none_or(|next_offset| next_offset >= bytes.len())
                {
                    return Err(unsafe_entry(relative, "目录枚举链偏移非法"));
                }
                offset += next;
            }
        }
        if inspect_handle(&directory, relative)? != before {
            return Err(source_changed(relative));
        }
        Ok((before, output))
    }

    pub(super) fn metadata_for_directory(
        root: &RootHandle,
        relative: &RelativePath,
    ) -> Result<StableMetadata, FolderImportError> {
        let directory = open_directory(root, relative)?;
        let stable = inspect_handle(&directory, relative)?;
        if stable.kind != FolderEntryKind::Directory {
            return Err(source_changed(relative));
        }
        Ok(stable)
    }

    pub(super) fn open_file(
        root: &RootHandle,
        relative: &RelativePath,
        expected: &StableMetadata,
    ) -> Result<File, FolderImportError> {
        if relative.0.is_empty() {
            return Err(FolderImportError::unsafe_path("文件路径不能为空"));
        }
        let parent = open_directory(root, &relative.parent())?;
        let file = open_relative_nt(
            &parent,
            OsStr::new(relative.file_name()),
            relative,
            OpenKind::File,
            "父句柄相对打开来源文件",
        )?;
        let actual = inspect_handle(&file, relative)?;
        if actual != *expected || actual.kind != FolderEntryKind::File {
            return Err(source_changed(relative));
        }
        // NtCreateFile 的 FILE_SHARE_READ 拒绝 WRITE/DELETE，共享约束随返回的
        // File 覆盖整个读取期；调用方只从这个固定句柄读取并在结束后复核。
        Ok(file)
    }

    pub(super) fn metadata_for_open_file(file: &File) -> Result<StableMetadata, FolderImportError> {
        inspect_handle(file, &RelativePath::root())
    }

    pub(super) fn verify_root_path(
        path: &Path,
        root: &RootHandle,
        expected: &StableMetadata,
    ) -> Result<(), FolderImportError> {
        let parsed =
            parse_absolute_path(path).map_err(|_| source_changed(&RelativePath::root()))?;
        let (current, component_identities) =
            open_selected_path(&parsed).map_err(|_| source_changed(&RelativePath::root()))?;
        let current_stable = inspect_handle(&current, &RelativePath::root())
            .map_err(|_| source_changed(&RelativePath::root()))?;
        if component_identities != root.component_identities
            || identity(&current_stable) != root.identity
            || identity(&current_stable) != identity(expected)
        {
            return Err(source_changed(&RelativePath::root()));
        }
        Ok(())
    }

    fn parse_absolute_path(path: &Path) -> Result<ParsedAbsolutePath, FolderImportError> {
        let input = path.as_os_str().encode_wide().collect::<Vec<_>>();
        if input.is_empty() || input.contains(&0) || input.contains(&('/' as u16)) {
            return Err(FolderImportError::unsafe_path(
                "Windows 来源必须是规范 drive 或 UNC share 绝对路径",
            ));
        }
        let mut parts = path.components();
        let Some(Component::Prefix(prefix)) = parts.next() else {
            return Err(FolderImportError::unsafe_path(
                "Windows 来源必须是规范 drive 或 UNC share 绝对路径",
            ));
        };
        let (anchor_wide, unc) = match prefix.kind() {
            Prefix::Disk(letter) => (vec![letter as u16, ':' as u16, '\\' as u16], false),
            Prefix::UNC(server, share) => {
                let server = server.encode_wide().collect::<Vec<_>>();
                let share = share.encode_wide().collect::<Vec<_>>();
                if server.is_empty()
                    || share.is_empty()
                    || server
                        .iter()
                        .chain(&share)
                        .any(|unit| *unit == 0 || *unit == b'/' as u16 || *unit == b'\\' as u16)
                {
                    return Err(FolderImportError::unsafe_path("UNC server/share 名称非法"));
                }
                let mut anchor = vec![b'\\' as u16, b'\\' as u16];
                anchor.extend(server);
                anchor.push(b'\\' as u16);
                anchor.extend(share);
                anchor.push(b'\\' as u16);
                (anchor, true)
            }
            _ => {
                return Err(FolderImportError::unsafe_path(
                    "拒绝 verbatim、device 与 drive-relative 路径",
                ))
            }
        };
        let mut had_root = false;
        let mut components = Vec::new();
        let mut labels = Vec::new();
        for component in parts {
            match component {
                Component::RootDir if !had_root && components.is_empty() => had_root = true,
                Component::Normal(name) if had_root => {
                    let label = name
                        .to_str()
                        .ok_or_else(|| FolderImportError::unsafe_path("路径必须是有效 Unicode"))?;
                    if label.is_empty() || label == "." || label == ".." {
                        return Err(FolderImportError::unsafe_path("来源绝对路径组件非法"));
                    }
                    components.push(name.to_os_string());
                    labels.push(label.to_string());
                }
                _ => {
                    return Err(FolderImportError::unsafe_path(
                        "Windows 来源必须是规范绝对路径",
                    ))
                }
            }
        }
        if !had_root && !(unc && components.is_empty()) {
            return Err(FolderImportError::unsafe_path("拒绝 drive-relative 路径"));
        }
        let mut normalized = anchor_wide.clone();
        // Rust 对 UNC prefix 提供隐式 RootDir，因此无尾斜杠的 share root 也会
        // 得到 had_root=true。share root 的两种标准拼写都归一到同一 anchor；
        // 只有无后续组件时允许省略这一个尾斜杠。
        if unc && components.is_empty() && input.last() != Some(&(b'\\' as u16)) {
            normalized.pop();
        }
        for (index, component) in components.iter().enumerate() {
            if index > 0 {
                normalized.push(b'\\' as u16);
            }
            normalized.extend(component.encode_wide());
        }
        if normalized != input {
            return Err(FolderImportError::unsafe_path(
                "Windows 来源路径包含非规范分隔符或跳转组件",
            ));
        }
        Ok(ParsedAbsolutePath {
            anchor: OsString::from_wide(&anchor_wide),
            components,
            labels,
        })
    }

    #[cfg(test)]
    pub(super) fn parse_absolute_path_for_test(
        path: &Path,
    ) -> Result<(OsString, Vec<String>), FolderImportError> {
        let parsed = parse_absolute_path(path)?;
        Ok((parsed.anchor, parsed.labels))
    }

    fn open_selected_path(
        parsed: &ParsedAbsolutePath,
    ) -> Result<(File, Vec<ObjectIdentity>), FolderImportError> {
        let mut anchor = parsed.anchor.encode_wide().collect::<Vec<_>>();
        anchor.push(0);
        let handle = unsafe {
            CreateFileW(
                PCWSTR(anchor.as_ptr()),
                FILE_GENERIC_READ.0,
                FILE_SHARE_READ,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                None,
            )
        }
        .map_err(|error| FolderImportError::Io {
            operation: "固定 Windows 卷或 share 根",
            relative_path: ".".into(),
            message: error.to_string(),
        })?;
        let mut current = unsafe { File::from_raw_handle(handle.0 as RawHandle) };
        let mut stable = inspect_handle(&current, &RelativePath::root())?;
        if stable.kind != FolderEntryKind::Directory {
            return Err(FolderImportError::SourceNotDirectory);
        }
        let mut chain = vec![identity(&stable)];
        let mut walked = RelativePath::root();
        for (index, component) in parsed.components.iter().enumerate() {
            walked = walked.child(&parsed.labels[index])?;
            let kind = if index + 1 == parsed.components.len() {
                OpenKind::Any
            } else {
                OpenKind::Directory
            };
            current = open_relative_nt(&current, component, &walked, kind, "从卷根逐组件打开来源")?;
            stable = inspect_handle(&current, &walked)?;
            if stable.kind != FolderEntryKind::Directory {
                if index + 1 == parsed.components.len() {
                    return Err(FolderImportError::SourceNotDirectory);
                }
                return Err(source_changed(&walked));
            }
            chain.push(identity(&stable));
        }
        Ok((current, chain))
    }

    fn open_directory(
        root: &RootHandle,
        relative: &RelativePath,
    ) -> Result<File, FolderImportError> {
        let mut current = root.file.try_clone().map_err(|error| {
            FolderImportError::io("复制固定来源根句柄", &RelativePath::root(), error)
        })?;
        let mut walked = RelativePath::root();
        for component in relative.0.split('/').filter(|part| !part.is_empty()) {
            walked = walked.child(component)?;
            current = open_relative_nt(
                &current,
                OsStr::new(component),
                &walked,
                OpenKind::Directory,
                "安全打开来源目录",
            )?;
            if inspect_handle(&current, &walked)?.kind != FolderEntryKind::Directory {
                return Err(source_changed(&walked));
            }
        }
        Ok(current)
    }

    fn open_relative_nt(
        parent: &File,
        name: &OsStr,
        relative: &RelativePath,
        kind: OpenKind,
        operation: &'static str,
    ) -> Result<File, FolderImportError> {
        let mut name_wide = name.encode_wide().collect::<Vec<_>>();
        if name_wide.is_empty()
            || name_wide.contains(&0)
            || name_wide.contains(&(b'\\' as u16))
            || name_wide.contains(&(b'/' as u16))
        {
            return Err(unsafe_entry(relative, "路径组件非法"));
        }
        let name_bytes = name_wide
            .len()
            .checked_mul(2)
            .and_then(|bytes| u16::try_from(bytes).ok())
            .ok_or_else(|| unsafe_entry(relative, "路径组件过长"))?;
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
        let kind_options = match kind {
            OpenKind::Any => Default::default(),
            OpenKind::Directory => FILE_DIRECTORY_FILE,
            OpenKind::File => FILE_NON_DIRECTORY_FILE,
        };
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
                kind_options | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                None,
                0,
            )
        };
        if status.0 < 0 {
            return Err(FolderImportError::Io {
                operation,
                relative_path: relative.display().to_string(),
                message: format!("NTSTATUS 0x{:08x}", status.0 as u32),
            });
        }
        Ok(unsafe { File::from_raw_handle(handle.0 as RawHandle) })
    }

    fn inspect_handle(
        file: &File,
        relative: &RelativePath,
    ) -> Result<StableMetadata, FolderImportError> {
        let handle = HANDLE(file.as_raw_handle());
        if unsafe { GetFileType(handle) } != FILE_TYPE_DISK {
            return Err(unsafe_entry(relative, "对象不是磁盘文件或目录"));
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
        .map_err(|error| FolderImportError::io("复核 Windows 来源句柄", relative, error))?;
        if basic.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_DEVICE.0) != 0
            || standard.EndOfFile < 0
        {
            return Err(unsafe_entry(relative, "不允许重解析点或特殊对象"));
        }
        let (modified_seconds, modified_nanos) = windows_time(basic.LastWriteTime);
        let (changed_seconds, changed_nanos) = windows_time(basic.ChangeTime);
        Ok(StableMetadata {
            object_a: id.VolumeSerialNumber,
            object_b: u64::from_le_bytes(id.FileId.Identifier[..8].try_into().unwrap()),
            object_c: u64::from_le_bytes(id.FileId.Identifier[8..].try_into().unwrap()),
            size: standard.EndOfFile as u64,
            modified_seconds,
            modified_nanos,
            changed_seconds,
            changed_nanos,
            kind: if standard.Directory {
                FolderEntryKind::Directory
            } else {
                FolderEntryKind::File
            },
        })
    }

    fn windows_time(ticks: i64) -> (i64, i64) {
        (
            ticks.div_euclid(10_000_000),
            ticks.rem_euclid(10_000_000) * 100,
        )
    }

    fn identity(stable: &StableMetadata) -> ObjectIdentity {
        ObjectIdentity {
            volume: stable.object_a,
            file_id_low: stable.object_b,
            file_id_high: stable.object_c,
        }
    }

    fn source_changed(relative: &RelativePath) -> FolderImportError {
        FolderImportError::SourceChanged {
            relative_path: relative.display().to_string(),
        }
    }

    fn unsafe_entry(relative: &RelativePath, reason: &'static str) -> FolderImportError {
        FolderImportError::UnsafeEntry {
            relative_path: relative.display().to_string(),
            reason,
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use super::*;

    #[derive(Debug)]
    pub(super) struct RootHandle;

    pub(super) fn open_root(
        _path: &Path,
    ) -> Result<(RootHandle, StableMetadata), FolderImportError> {
        Err(FolderImportError::UnsupportedPlatformSafety)
    }
    pub(super) fn list_directory(
        _root: &RootHandle,
        _relative: &RelativePath,
        _remaining_entries: usize,
    ) -> Result<(StableMetadata, Vec<PlatformDirectoryEntry>), FolderImportError> {
        Err(FolderImportError::UnsupportedPlatformSafety)
    }
    pub(super) fn metadata_for_directory(
        _root: &RootHandle,
        _relative: &RelativePath,
    ) -> Result<StableMetadata, FolderImportError> {
        Err(FolderImportError::UnsupportedPlatformSafety)
    }
    pub(super) fn open_file(
        _root: &RootHandle,
        _relative: &RelativePath,
        _expected: &StableMetadata,
    ) -> Result<File, FolderImportError> {
        Err(FolderImportError::UnsupportedPlatformSafety)
    }
    pub(super) fn metadata_for_open_file(
        _file: &File,
    ) -> Result<StableMetadata, FolderImportError> {
        Err(FolderImportError::UnsupportedPlatformSafety)
    }
    pub(super) fn verify_root_path(
        _path: &Path,
        _root: &RootHandle,
        _expected: &StableMetadata,
    ) -> Result<(), FolderImportError> {
        Err(FolderImportError::UnsupportedPlatformSafety)
    }
}

#[cfg(test)]
#[path = "folder_tests.rs"]
mod tests;
