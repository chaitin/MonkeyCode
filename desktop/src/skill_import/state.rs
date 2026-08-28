//! 单 Desktop 实例的技能导入批次状态机。
//!
//! 本模块只提供同步、纯 Rust 状态 API。调用方负责在 Tauri 命令中编排后台
//! I/O，并把 [`SkillImportState::take_events`] 返回的元数据事件发布给 WebView。
//! 批次 mutex 只保护内存状态；来源清理、配额文件锁和其他文件系统 I/O 均在
//! 释放该 mutex 后执行。

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::SystemTime;

use super::archive::ArchiveSourceFingerprint;
use super::folder::FolderSourceFingerprint;
use super::lease::{
    BatchAccounting, CleanupGuardError, LeaseError, MergedSourceGuard, SourceMergeCandidate,
    SourceReservation, StagingInstance,
};
use super::model::{
    SkillCommandError, SkillImportAction, SkillImportBatchPhase, SkillImportBatchPreview,
    SkillImportBatchResult, SkillImportCurrentSnapshot, SkillImportDecision, SkillImportItem,
    SkillImportItemResult, SkillImportItemState, SkillImportSnapshotEvent, SkillImportSource,
    SkillImportTotals,
};
use super::{sort_import_items, sort_import_sources};

const ABORTED_EXECUTION_ERROR: &str = "技能导入后台任务异常结束";
const UNRESOLVED_EXECUTION_ERROR: &str = "技能导入执行未返回项目终态";
pub(crate) const PENDING_CLEANUP_RETRY_LIMIT: usize = 8;

/// phase 与在途来源共同决定的操作表。`current` 始终允许，因此不列入表中。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SkillImportAllowedOperations {
    pub add_source: bool,
    pub commit: bool,
    pub retry: bool,
    pub cancel: bool,
    pub read_text: bool,
}

impl SkillImportAllowedOperations {
    fn for_batch(phase: SkillImportBatchPhase, has_in_flight_source: bool) -> Self {
        match phase {
            SkillImportBatchPhase::Collecting => Self {
                add_source: !has_in_flight_source,
                commit: !has_in_flight_source,
                retry: false,
                cancel: !has_in_flight_source,
                read_text: true,
            },
            SkillImportBatchPhase::Completed => Self {
                add_source: false,
                commit: false,
                retry: true,
                cancel: true,
                read_text: true,
            },
            SkillImportBatchPhase::Validating
            | SkillImportBatchPhase::Submitting
            | SkillImportBatchPhase::RetryValidating
            | SkillImportBatchPhase::Retrying => Self {
                add_source: false,
                commit: false,
                retry: false,
                cancel: false,
                read_text: false,
            },
        }
    }
}

/// 首次来源对话框在批次创建前也占据实例唯一槽。token 同时阻止同批次第二个
/// 来源操作，并让已经取消的后台来源无法迟到合并。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SourcePickToken {
    batch_id: String,
    sequence: u64,
}

impl SourcePickToken {
    pub(crate) fn batch_id(&self) -> &str {
        &self.batch_id
    }
}

/// 暂存来源的不可序列化指纹。提交预检可克隆后在批次 mutex 外执行复核。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum StagedSourceFingerprint {
    Folder(FolderSourceFingerprint),
    Archive(ArchiveSourceFingerprint),
}

#[derive(Debug)]
pub(crate) struct StagedImportItemData {
    pub staged_root: Option<PathBuf>,
    /// 暂存技能树的内容指纹。只存在于 Rust 状态中，不进入 serde preview。
    pub staged_fingerprint: Option<super::store::FixedTreeSnapshot>,
    pub preview: SkillImportItem,
}

/// `complete_source_pick` 的纯内存部分。绝对来源路径和暂存根不会进入 preview。
#[derive(Debug)]
pub(crate) struct StagedImportSourceData {
    pub preview: SkillImportSource,
    pub source_path: PathBuf,
    pub fingerprint: Option<StagedSourceFingerprint>,
    pub items: Vec<StagedImportItemData>,
}

/// 一次系统多选操作产生的单个来源。命令层先在后台完成全部发现/暂存，再把
/// 整组候选交给状态机做一次 phase/token 复核和原子内存合并。
pub(crate) struct StagedSourceMerge {
    pub source: StagedImportSourceData,
    pub candidate: SourceMergeCandidate,
    pub reservation: Option<SourceReservation>,
}

impl StagedSourceMerge {
    pub(crate) fn cleanup_unmerged(self) -> Result<(), SkillCommandError> {
        match self.reservation {
            Some(reservation) => reservation
                .cleanup_owned()
                .map_err(|failure| lease_error(failure.into_error())),
            None => Ok(()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StagedImportItemHandle {
    pub staged_root: Option<PathBuf>,
    pub staged_fingerprint: Option<super::store::FixedTreeSnapshot>,
    pub preview: SkillImportItem,
}

struct StagedImportSource {
    preview: SkillImportSource,
    source_path: PathBuf,
    fingerprint: Option<StagedSourceFingerprint>,
    merge_guard: MergedSourceGuard,
}

struct StagedImportItem {
    staged_root: Option<PathBuf>,
    staged_fingerprint: Option<super::store::FixedTreeSnapshot>,
    preview: SkillImportItem,
}

struct StagedImportBatch {
    batch_id: String,
    created_at: SystemTime,
    snapshot_revision: u64,
    phase: SkillImportBatchPhase,
    in_flight_source: Option<SourcePickToken>,
    catalog_revision: Option<u64>,
    sources: Vec<StagedImportSource>,
    items: Vec<StagedImportItem>,
    accounting: BatchAccounting,
}

impl StagedImportBatch {
    fn new(batch_id: String) -> Self {
        Self {
            batch_id,
            created_at: SystemTime::now(),
            snapshot_revision: 0,
            phase: SkillImportBatchPhase::Collecting,
            in_flight_source: None,
            catalog_revision: None,
            sources: Vec::new(),
            items: Vec::new(),
            accounting: BatchAccounting::default(),
        }
    }

    fn preview(&self) -> SkillImportBatchPreview {
        let mut sources = self
            .sources
            .iter()
            .map(|source| source.preview.clone())
            .collect::<Vec<_>>();
        sort_import_sources(&mut sources);
        let mut items = self
            .items
            .iter()
            .map(|item| item.preview.clone())
            .collect::<Vec<_>>();
        sort_import_items(&mut items, &sources);
        let totals = totals(&sources, &items);
        SkillImportBatchPreview {
            batch_id: self.batch_id.clone(),
            phase: self.phase,
            snapshot_revision: self.snapshot_revision,
            in_flight_source_picks: usize::from(self.in_flight_source.is_some()),
            catalog_revision: self.catalog_revision,
            sources,
            items,
            totals,
        }
    }
}

fn totals(sources: &[SkillImportSource], items: &[SkillImportItem]) -> SkillImportTotals {
    use super::model::{SkillImportConflict, SkillImportValidity};

    SkillImportTotals {
        source_count: sources.len(),
        item_count: items.len(),
        importable_count: items
            .iter()
            .filter(|item| {
                matches!(item.validity, SkillImportValidity::Valid)
                    && matches!(item.conflict, SkillImportConflict::None)
            })
            .count(),
        conflict_count: items
            .iter()
            .filter(|item| !matches!(item.conflict, SkillImportConflict::None))
            .count(),
        risk_count: items.iter().filter(|item| !item.risks.is_empty()).count(),
        invalid_count: items
            .iter()
            .filter(|item| matches!(item.validity, SkillImportValidity::Invalid { .. }))
            .count(),
    }
}

enum BatchSlot {
    Empty,
    InitialPick(SourcePickToken),
    Active(StagedImportBatch),
}

struct StateInner {
    slot: BatchSlot,
    next_pick_sequence: u64,
    events: VecDeque<SkillImportSnapshotEvent>,
    /// cancel 墓碑或来源拒绝后仍删除失败的来源。队列只在短临界区移交 guard；
    /// 实际目录删除与 ledger 文件锁始终由命令层在 spawn_blocking 中调用 retry。
    pending_cleanup: VecDeque<MergedSourceGuard>,
}

struct StateCore {
    inner: Mutex<StateInner>,
    snapshot_clock: AtomicU64,
}

/// 克隆只克隆同一实例状态的 `Arc`，不会产生第二个批次槽或 revision clock。
#[derive(Clone)]
pub(crate) struct SkillImportState {
    core: Arc<StateCore>,
    staging: Arc<Mutex<StagingState>>,
}

type StagingPathProtection = dyn Fn(&Path) -> bool + Send + Sync;

enum StagingState {
    Unconfigured,
    Ready(StagingInstance),
    Retryable {
        config_dir: PathBuf,
        protects: Arc<StagingPathProtection>,
        last_error: LeaseError,
    },
}

impl Default for SkillImportState {
    fn default() -> Self {
        Self::new()
    }
}

impl SkillImportState {
    /// 纯状态构造器，供测试以及不需要直接创建 reservation 的编排层使用。
    pub(crate) fn new() -> Self {
        Self {
            core: Arc::new(StateCore {
                inner: Mutex::new(StateInner {
                    slot: BatchSlot::Empty,
                    next_pick_sequence: 0,
                    events: VecDeque::new(),
                    pending_cleanup: VecDeque::new(),
                }),
                snapshot_clock: AtomicU64::new(0),
            }),
            staging: Arc::new(Mutex::new(StagingState::Unconfigured)),
        }
    }

    /// 生产构造器：状态与任务 4 的 instance lease 共享生命周期。
    pub(crate) fn open(
        config_dir: &Path,
        belongs_to_install_transaction: impl Fn(&Path) -> bool,
    ) -> Result<Self, LeaseError> {
        let instance = StagingInstance::open(config_dir, belongs_to_install_transaction)?;
        Ok(Self::with_staging_instance(instance))
    }

    pub(crate) fn with_staging_instance(staging_instance: StagingInstance) -> Self {
        let state = Self::new();
        *state
            .staging
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = StagingState::Ready(staging_instance);
        state
    }

    /// 启动时导入 lease 初始化失败只禁用导入；后续 IPC 会用同一配置与保护规则重试。
    pub(crate) fn open_resilient(
        config_dir: &Path,
        belongs_to_install_transaction: impl Fn(&Path) -> bool + Send + Sync + 'static,
    ) -> Self {
        let protects: Arc<StagingPathProtection> = Arc::new(belongs_to_install_transaction);
        match StagingInstance::open(config_dir, |path| protects(path)) {
            Ok(instance) => Self::with_staging_instance(instance),
            Err(last_error) => {
                let state = Self::new();
                *state
                    .staging
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = StagingState::Retryable {
                    config_dir: config_dir.to_path_buf(),
                    protects,
                    last_error,
                };
                state
            }
        }
    }

    pub(crate) fn ensure_available(&self) -> Result<(), SkillCommandError> {
        self.staging_instance().map(|_| ())
    }

    pub(crate) fn unavailable_error(&self) -> Option<SkillCommandError> {
        let staging = self
            .staging
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match &*staging {
            StagingState::Retryable { last_error, .. } => Some(SkillCommandError::SkillImportUnavailable {
                message: format!("技能导入暂存不可用: {last_error}"),
                action: "请检查配置目录权限；若提示账本损坏，请先备份并修复 skill-import-staging.usage.json，然后重试导入操作".into(),
            }),
            StagingState::Unconfigured | StagingState::Ready(_) => None,
        }
    }

    pub(crate) fn staging_instance(&self) -> Result<StagingInstance, SkillCommandError> {
        let mut staging = self
            .staging
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match &*staging {
            StagingState::Ready(instance) => return Ok(instance.clone()),
            StagingState::Unconfigured => {
                return Err(invalid_request("技能导入状态未配置 instance lease"));
            }
            StagingState::Retryable { .. } => {}
        }
        let StagingState::Retryable {
            config_dir,
            protects,
            ..
        } = &*staging
        else {
            unreachable!()
        };
        let config_dir = config_dir.clone();
        let protects = protects.clone();
        match StagingInstance::open(&config_dir, |path| protects(path)) {
            Ok(instance) => {
                *staging = StagingState::Ready(instance.clone());
                Ok(instance)
            }
            Err(error) => {
                let message = error.to_string();
                if let StagingState::Retryable { last_error, .. } = &mut *staging {
                    *last_error = error;
                }
                Err(SkillCommandError::SkillImportUnavailable {
                    message: format!("技能导入暂存不可用: {message}"),
                    action: "请检查配置目录权限；若提示账本损坏，请先备份并修复 skill-import-staging.usage.json，然后重试导入操作".into(),
                })
            }
        }
    }

    /// 有界取出 cancel/来源拒绝遗留 guard 后在状态锁外重试文件系统清理。失败
    /// guard 会重新入队，确保当前进程解除占用后无需重启即可回收目录与配置配额。
    pub(crate) fn retry_pending_cleanup(&self, limit: usize) -> Result<(), SkillCommandError> {
        if limit == 0 {
            return Ok(());
        }
        let pending = {
            let mut inner = self.core.lock();
            let count = limit.min(inner.pending_cleanup.len());
            inner.pending_cleanup.drain(..count).collect::<Vec<_>>()
        };
        let mut first_error = None;
        let mut retry = Vec::new();
        for guard in pending {
            if let Err(failure) = guard.cleanup() {
                let (error, guard) = failure.into_parts();
                first_error.get_or_insert(error);
                retry.push(guard);
            }
        }
        if !retry.is_empty() {
            self.core.lock().pending_cleanup.extend(retry);
        }
        match first_error {
            Some(error) => Err(lease_error(error)),
            None => Ok(()),
        }
    }

    #[cfg(test)]
    pub(crate) fn pending_cleanup_count(&self) -> usize {
        self.core.lock().pending_cleanup.len()
    }

    #[cfg(test)]
    pub(crate) fn clear_pending_cleanup_errors_for_test(&self) {
        for guard in &mut self.core.lock().pending_cleanup {
            guard.clear_cleanup_error();
        }
    }

    /// 一致读取实例 clock 和 optional batch。锁内只克隆内存模型，不执行 I/O。
    pub(crate) fn current(&self) -> SkillImportCurrentSnapshot {
        let inner = self.core.lock();
        let snapshot_revision = self.core.snapshot_clock.load(Ordering::Acquire);
        let batch = match &inner.slot {
            BatchSlot::Active(batch) => Some(batch.preview()),
            BatchSlot::Empty | BatchSlot::InitialPick(_) => None,
        };
        SkillImportCurrentSnapshot {
            snapshot_revision,
            batch,
        }
    }

    /// 取走尚未发布的单调事件。命令层可在后台 join（含 join error）后调用。
    pub(crate) fn take_events(&self) -> Vec<SkillImportSnapshotEvent> {
        self.core.lock().events.drain(..).collect()
    }

    /// 已经获得来源列表的调用方可直接创建空 Collecting 批次。系统 picker 应优先
    /// 使用 `reserve_initial_source_pick`，避免把尚未选择成功的空批次暴露给 WebView。
    pub(crate) fn create_batch(
        &self,
        batch_id: impl Into<String>,
    ) -> Result<SkillImportSnapshotEvent, SkillCommandError> {
        let batch_id = batch_id.into();
        validate_batch_id(&batch_id)?;
        let mut inner = self.core.lock();
        if !matches!(inner.slot, BatchSlot::Empty) {
            return Err(SkillCommandError::Busy);
        }
        let mut batch = StagedImportBatch::new(batch_id.clone());
        let event = self.core.bump_batch(&mut batch);
        inner.events.push_back(event.clone());
        inner.slot = BatchSlot::Active(batch);
        Ok(event)
    }

    /// 在首个系统文件对话框打开前占据唯一临时槽；此时 `current.batch` 仍为 None。
    pub(crate) fn reserve_initial_source_pick(
        &self,
        batch_id: impl Into<String>,
    ) -> Result<SourcePickToken, SkillCommandError> {
        let batch_id = batch_id.into();
        validate_batch_id(&batch_id)?;
        let mut inner = self.core.lock();
        if !matches!(inner.slot, BatchSlot::Empty) {
            return Err(SkillCommandError::Busy);
        }
        let token = next_pick_token(&mut inner, batch_id);
        inner.slot = BatchSlot::InitialPick(token.clone());
        Ok(token)
    }

    /// 用户确实选择了首批路径后创建可观察批次，并把同一 token 记为唯一在途来源。
    pub(crate) fn activate_initial_source_pick(
        &self,
        token: &SourcePickToken,
    ) -> Result<SkillImportSnapshotEvent, SkillCommandError> {
        let mut inner = self.core.lock();
        match &inner.slot {
            BatchSlot::InitialPick(current) if current == token => {}
            _ => return Err(SkillCommandError::Busy),
        }
        let mut batch = StagedImportBatch::new(token.batch_id.clone());
        batch.in_flight_source = Some(token.clone());
        let event = self.core.bump_batch(&mut batch);
        inner.events.push_back(event.clone());
        inner.slot = BatchSlot::Active(batch);
        Ok(event)
    }

    /// 为已有 Collecting 批次占用唯一来源操作。in-flight 从 0 到 1 推进 revision。
    pub(crate) fn reserve_source_pick(
        &self,
        batch_id: &str,
    ) -> Result<SourcePickToken, SkillCommandError> {
        let mut inner = self.core.lock();
        let can_reserve = matches!(
            &inner.slot,
            BatchSlot::Active(batch)
                if batch.batch_id == batch_id
                    && batch.phase == SkillImportBatchPhase::Collecting
                    && batch.in_flight_source.is_none()
        );
        if !can_reserve {
            return Err(slot_error(&inner.slot, batch_id));
        }
        let token = next_pick_token(&mut inner, batch_id.to_string());
        let event = {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                unreachable!()
            };
            batch.in_flight_source = Some(token.clone());
            self.core.bump_batch(batch)
        };
        inner.events.push_back(event);
        Ok(token)
    }

    /// 文件对话框取消或来源处理提前失败时撤销 token。首个对话框尚未创建批次时
    /// 不改变可观察 snapshot；活动批次的 in-flight 从 1 到 0 会推进 revision。
    pub(crate) fn abandon_source_pick(
        &self,
        token: &SourcePickToken,
    ) -> Result<Option<SkillImportSnapshotEvent>, SkillCommandError> {
        let mut inner = self.core.lock();
        if matches!(&inner.slot, BatchSlot::InitialPick(current) if current == token) {
            inner.slot = BatchSlot::Empty;
            return Ok(None);
        }
        let event = {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                return Err(SkillCommandError::Busy);
            };
            if batch.phase != SkillImportBatchPhase::Collecting
                || batch.in_flight_source.as_ref() != Some(token)
            {
                return Err(SkillCommandError::Busy);
            }
            batch.in_flight_source = None;
            self.core.bump_batch(batch)
        };
        inner.events.push_back(event.clone());
        Ok(Some(event))
    }

    /// 在来源 I/O 完成后原子合并内存模型。配额合并和任何拒绝清理均在批次
    /// mutex 外执行；二次 phase/token 检查确保取消后的迟到来源不能复活批次。
    pub(crate) fn complete_source_pick(
        &self,
        token: &SourcePickToken,
        source: StagedImportSourceData,
        candidate: SourceMergeCandidate,
        reservation: Option<SourceReservation>,
    ) -> Result<SkillImportSnapshotEvent, SkillCommandError> {
        self.complete_source_picks(
            token,
            vec![StagedSourceMerge {
                source,
                candidate,
                reservation,
            }],
        )
    }

    /// 多选结果只在全部后台 I/O 完成后进入这里。规范选择键或稳定对象键重复的
    /// 来源会被清理并忽略；其余来源要么在一次批次临界区全部可见，要么全部清理。
    pub(crate) fn complete_source_picks(
        &self,
        token: &SourcePickToken,
        candidates: Vec<StagedSourceMerge>,
    ) -> Result<SkillImportSnapshotEvent, SkillCommandError> {
        if let Some(error) = candidates
            .iter()
            .find_map(|candidate| validate_source_data(&candidate.source).err())
        {
            self.clear_matching_pick(token);
            let mut cleanup_error = None;
            for candidate in candidates {
                if let Some(reservation) = candidate.reservation {
                    if let Err(cleanup) = reservation.cleanup_owned() {
                        cleanup_error.get_or_insert_with(|| lease_error(cleanup.into_error()));
                    }
                }
            }
            return Err(cleanup_error.unwrap_or(error));
        }

        let accounting = {
            let inner = self.core.lock();
            match &inner.slot {
                BatchSlot::Active(batch) if batch.batch_id == token.batch_id => {
                    batch.accounting.clone()
                }
                _ => BatchAccounting::default(),
            }
        };

        let mut accepted = Vec::new();
        for candidate in candidates {
            match accounting.merge_guarded(candidate.candidate, candidate.reservation) {
                Ok(merged) => accepted.push((candidate.source, merged)),
                Err(rejected) => {
                    let (error, rejected) = rejected.into_parts();
                    if error == LeaseError::DuplicateSource {
                        if let Err(failure) = rejected.cleanup() {
                            self.retain_cleanup_failure(failure);
                            self.cleanup_merged_sources(accepted);
                            self.clear_matching_pick(token);
                            return Err(lease_error(error));
                        }
                        continue;
                    }
                    if let Err(failure) = rejected.cleanup() {
                        self.retain_cleanup_failure(failure);
                    }
                    self.cleanup_merged_sources(accepted);
                    self.clear_matching_pick(token);
                    return Err(lease_error(error));
                }
            }
        }

        let mut inner = self.core.lock();
        let rejection = match &inner.slot {
            BatchSlot::Active(batch)
                if batch.batch_id == token.batch_id
                    && batch.phase == SkillImportBatchPhase::Collecting
                    && batch.in_flight_source.as_ref() == Some(token) =>
            {
                let mut source_ids = batch
                    .sources
                    .iter()
                    .map(|source| source.preview.source_id.as_str())
                    .collect::<HashSet<_>>();
                let mut item_ids = batch
                    .items
                    .iter()
                    .map(|item| item.preview.item_id.as_str())
                    .collect::<HashSet<_>>();
                accepted.iter().find_map(|(source, _)| {
                    if !source_ids.insert(&source.preview.source_id) {
                        Some(invalid_request("来源已存在于当前批次"))
                    } else if source
                        .items
                        .iter()
                        .any(|item| !item_ids.insert(&item.preview.item_id))
                    {
                        Some(invalid_request("批次包含重复 item_id"))
                    } else {
                        None
                    }
                })
            }
            _ => Some(SkillCommandError::Busy),
        };
        if let Some(error) = rejection {
            drop(inner);
            self.cleanup_merged_sources(accepted);
            self.clear_matching_pick(token);
            return Err(error);
        }

        let event = {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                unreachable!()
            };
            for (source, merged) in accepted {
                let StagedImportSourceData {
                    preview,
                    source_path,
                    fingerprint,
                    items,
                } = source;
                batch.sources.push(StagedImportSource {
                    preview,
                    source_path,
                    fingerprint,
                    merge_guard: merged,
                });
                batch
                    .items
                    .extend(items.into_iter().map(|item| StagedImportItem {
                        staged_root: item.staged_root,
                        staged_fingerprint: item.staged_fingerprint,
                        preview: item.preview,
                    }));
            }
            batch.in_flight_source = None;
            self.core.bump_batch(batch)
        };
        inner.events.push_back(event.clone());
        Ok(event)
    }

    /// 只改写纯内存冲突快照；调用方必须先在 mutex 外依据 catalog 完成计算。
    pub(crate) fn update_collecting_conflicts(
        &self,
        batch_id: &str,
        updates: &[(String, super::model::SkillImportConflict, Option<String>)],
    ) -> Result<Option<SkillImportSnapshotEvent>, SkillCommandError> {
        let mut inner = self.core.lock();
        let event = {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                return Err(slot_error(&inner.slot, batch_id));
            };
            if batch.batch_id != batch_id || batch.phase != SkillImportBatchPhase::Collecting {
                return Err(SkillCommandError::Busy);
            }
            let mut changed = false;
            for (item_id, conflict, duplicate_group) in updates {
                let item = batch
                    .items
                    .iter_mut()
                    .find(|item| item.preview.item_id == *item_id)
                    .ok_or_else(|| invalid_request("导入技能项不存在"))?;
                if item.preview.conflict != *conflict
                    || item.preview.duplicate_group != *duplicate_group
                {
                    item.preview.conflict = conflict.clone();
                    item.preview.duplicate_group = duplicate_group.clone();
                    changed = true;
                }
            }
            changed.then(|| self.core.bump_batch(batch))
        };
        if let Some(event) = event.clone() {
            inner.events.push_back(event);
        }
        Ok(event)
    }

    pub(crate) fn allowed_operations(
        &self,
        batch_id: &str,
    ) -> Result<SkillImportAllowedOperations, SkillCommandError> {
        let inner = self.core.lock();
        let BatchSlot::Active(batch) = &inner.slot else {
            return Err(slot_error(&inner.slot, batch_id));
        };
        if batch.batch_id != batch_id {
            return Err(invalid_request("导入批次不存在"));
        }
        Ok(SkillImportAllowedOperations::for_batch(
            batch.phase,
            batch.in_flight_source.is_some(),
        ))
    }

    pub(crate) fn staged_item(
        &self,
        batch_id: &str,
        item_id: &str,
    ) -> Result<StagedImportItemHandle, SkillCommandError> {
        let inner = self.core.lock();
        let batch = active_batch(&inner.slot, batch_id)?;
        let item = batch
            .items
            .iter()
            .find(|item| item.preview.item_id == item_id)
            .ok_or_else(|| invalid_request("导入技能项不存在"))?;
        Ok(StagedImportItemHandle {
            staged_root: item.staged_root.clone(),
            staged_fingerprint: item.staged_fingerprint.clone(),
            preview: item.preview.clone(),
        })
    }

    pub(crate) fn source_fingerprints(
        &self,
        batch_id: &str,
    ) -> Result<Vec<(String, PathBuf, Option<StagedSourceFingerprint>)>, SkillCommandError> {
        let inner = self.core.lock();
        let batch = active_batch(&inner.slot, batch_id)?;
        Ok(batch
            .sources
            .iter()
            .map(|source| {
                (
                    source.preview.source_id.clone(),
                    source.source_path.clone(),
                    source.fingerprint.clone(),
                )
            })
            .collect())
    }

    pub(crate) fn begin_initial_commit(
        &self,
        batch_id: &str,
    ) -> Result<CommitPhaseGuard, SkillCommandError> {
        self.begin_commit(batch_id, CommitKind::Initial)
    }

    pub(crate) fn begin_retry(
        &self,
        batch_id: &str,
    ) -> Result<CommitPhaseGuard, SkillCommandError> {
        self.begin_commit(batch_id, CommitKind::Retry)
    }

    fn begin_commit(
        &self,
        batch_id: &str,
        kind: CommitKind,
    ) -> Result<CommitPhaseGuard, SkillCommandError> {
        let mut inner = self.core.lock();
        let event = {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                return Err(slot_error(&inner.slot, batch_id));
            };
            if batch.batch_id != batch_id {
                return Err(invalid_request("导入批次不存在"));
            }
            let valid = match kind {
                CommitKind::Initial => {
                    batch.phase == SkillImportBatchPhase::Collecting
                        && batch.in_flight_source.is_none()
                }
                CommitKind::Retry => batch.phase == SkillImportBatchPhase::Completed,
            };
            if !valid {
                return Err(SkillCommandError::Busy);
            }
            batch.phase = kind.validating_phase();
            self.core.bump_batch(batch)
        };
        inner.events.push_back(event);
        Ok(CommitPhaseGuard {
            core: self.core.clone(),
            batch_id: batch_id.to_string(),
            kind,
            stage: GuardStage::Validating,
            unresolved: HashSet::new(),
            armed: true,
        })
    }

    /// cancel 只在 Collecting 且无在途来源，或 Completed 时成立。同一临界区先
    /// 产生更高 tombstone revision 再移除唯一槽；返回值随后在锁外显式清理配额。
    pub(crate) fn cancel(&self, batch_id: &str) -> Result<CancelledImportBatch, SkillCommandError> {
        let mut inner = self.core.lock();
        let allowed = matches!(
            &inner.slot,
            BatchSlot::Active(batch)
                if batch.batch_id == batch_id
                    && ((batch.phase == SkillImportBatchPhase::Collecting
                        && batch.in_flight_source.is_none())
                        || batch.phase == SkillImportBatchPhase::Completed)
        );
        if !allowed {
            return Err(slot_error(&inner.slot, batch_id));
        }
        let revision = self.core.next_revision();
        let event = SkillImportSnapshotEvent {
            snapshot_revision: revision,
            batch_id: batch_id.to_string(),
            deleted: true,
        };
        let slot = std::mem::replace(&mut inner.slot, BatchSlot::Empty);
        let BatchSlot::Active(batch) = slot else {
            unreachable!()
        };
        inner.events.push_back(event.clone());
        Ok(CancelledImportBatch {
            event,
            sources: batch.sources,
            core: self.core.clone(),
        })
    }

    pub(crate) fn result(
        &self,
        batch_id: &str,
    ) -> Result<SkillImportBatchResult, SkillCommandError> {
        let inner = self.core.lock();
        let batch = active_batch(&inner.slot, batch_id)?;
        if batch.phase != SkillImportBatchPhase::Completed {
            return Err(SkillCommandError::Busy);
        }
        build_result(batch)
    }

    fn retain_cleanup_failure(&self, failure: CleanupGuardError<MergedSourceGuard>) {
        let (_, guard) = failure.into_parts();
        self.core.lock().pending_cleanup.push_back(guard);
    }

    fn cleanup_merged_sources(&self, candidates: Vec<(StagedImportSourceData, MergedSourceGuard)>) {
        let mut pending = Vec::new();
        for (_, candidate) in candidates {
            if let Err(failure) = candidate.cleanup() {
                let (_, guard) = failure.into_parts();
                pending.push(guard);
            }
        }
        if !pending.is_empty() {
            self.core.lock().pending_cleanup.extend(pending);
        }
    }

    fn clear_matching_pick(&self, token: &SourcePickToken) {
        let mut inner = self.core.lock();
        let event = match &mut inner.slot {
            BatchSlot::Active(batch)
                if batch.phase == SkillImportBatchPhase::Collecting
                    && batch.in_flight_source.as_ref() == Some(token) =>
            {
                batch.in_flight_source = None;
                Some(self.core.bump_batch(batch))
            }
            _ => None,
        };
        if let Some(event) = event {
            inner.events.push_back(event);
        }
    }
}

fn validate_batch_id(batch_id: &str) -> Result<(), SkillCommandError> {
    if batch_id.is_empty() {
        Err(invalid_request("batch_id 不能为空"))
    } else {
        Ok(())
    }
}

fn validate_source_data(source: &StagedImportSourceData) -> Result<(), SkillCommandError> {
    if source.preview.source_id.is_empty() {
        return Err(invalid_request("source_id 不能为空"));
    }
    let mut item_ids = HashSet::new();
    for item in &source.items {
        if item.preview.source_id != source.preview.source_id {
            return Err(invalid_request("技能项 source_id 与来源不一致"));
        }
        if !item_ids.insert(item.preview.item_id.as_str()) {
            return Err(invalid_request("来源包含重复 item_id"));
        }
    }
    Ok(())
}

fn next_pick_token(inner: &mut StateInner, batch_id: String) -> SourcePickToken {
    inner.next_pick_sequence = inner
        .next_pick_sequence
        .checked_add(1)
        .expect("来源 token 序号溢出");
    SourcePickToken {
        batch_id,
        sequence: inner.next_pick_sequence,
    }
}

fn reject_unmerged<T>(
    reservation: Option<SourceReservation>,
    error: SkillCommandError,
) -> Result<T, SkillCommandError> {
    if let Some(reservation) = reservation {
        reservation
            .cleanup_owned()
            .map_err(|failure| lease_error(failure.into_error()))?;
    }
    Err(error)
}

fn reject_merged<T>(
    candidate: MergedSourceGuard,
    error: SkillCommandError,
) -> Result<T, SkillCommandError> {
    candidate
        .cleanup()
        .map_err(|failure| lease_error(failure.into_error()))?;
    Err(error)
}

fn slot_error(slot: &BatchSlot, requested_batch_id: &str) -> SkillCommandError {
    match slot {
        BatchSlot::Active(batch) if batch.batch_id != requested_batch_id => {
            invalid_request("导入批次不存在")
        }
        BatchSlot::Empty => invalid_request("当前没有活动导入批次"),
        BatchSlot::InitialPick(_) | BatchSlot::Active(_) => SkillCommandError::Busy,
    }
}

fn active_batch<'a>(
    slot: &'a BatchSlot,
    batch_id: &str,
) -> Result<&'a StagedImportBatch, SkillCommandError> {
    match slot {
        BatchSlot::Active(batch) if batch.batch_id == batch_id => Ok(batch),
        _ => Err(slot_error(slot, batch_id)),
    }
}

fn invalid_request(message: impl Into<String>) -> SkillCommandError {
    SkillCommandError::InvalidRequest {
        message: message.into(),
    }
}

fn lease_error(error: LeaseError) -> SkillCommandError {
    match error {
        LeaseError::CleanupFailed { target, message } => SkillCommandError::CleanupFailed {
            target: target.to_string(),
            message,
        },
        error => SkillCommandError::Io {
            message: error.to_string(),
        },
    }
}

impl StateCore {
    fn lock(&self) -> MutexGuard<'_, StateInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn next_revision(&self) -> u64 {
        self.snapshot_clock
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |revision| {
                revision.checked_add(1)
            })
            .expect("技能导入 snapshot revision 溢出")
            + 1
    }

    fn bump_batch(&self, batch: &mut StagedImportBatch) -> SkillImportSnapshotEvent {
        let revision = self.next_revision();
        batch.snapshot_revision = revision;
        SkillImportSnapshotEvent {
            snapshot_revision: revision,
            batch_id: batch.batch_id.clone(),
            deleted: false,
        }
    }

    fn recover_guard(
        &self,
        batch_id: &str,
        kind: CommitKind,
        stage: GuardStage,
        unresolved: &HashSet<String>,
        error: &str,
        catalog_revision: Option<u64>,
    ) {
        let mut inner = self.lock();
        let mut events = Vec::new();
        {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                return;
            };
            if batch.batch_id != batch_id || batch.phase != stage.phase(kind) {
                return;
            }

            if stage == GuardStage::Executing {
                for index in 0..batch.items.len() {
                    let should_fail = {
                        let item = &batch.items[index].preview;
                        (unresolved.contains(&item.item_id)
                            || item.state == SkillImportItemState::Pending)
                            && !matches!(
                                item.state,
                                SkillImportItemState::Succeeded | SkillImportItemState::Skipped
                            )
                    };
                    if !should_fail {
                        continue;
                    }
                    let item = &mut batch.items[index].preview;
                    item.state = SkillImportItemState::Failed;
                    item.last_error = Some(error.to_string());
                    events.push(self.bump_batch(batch));
                }
                batch.catalog_revision = catalog_revision.or(batch.catalog_revision);
            }
            batch.phase = match (kind, stage) {
                (CommitKind::Initial, GuardStage::Validating) => SkillImportBatchPhase::Collecting,
                (CommitKind::Retry, GuardStage::Validating) => SkillImportBatchPhase::Completed,
                (_, GuardStage::Executing) => SkillImportBatchPhase::Completed,
            };
            events.push(self.bump_batch(batch));
        }
        inner.events.extend(events);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CommitKind {
    Initial,
    Retry,
}

impl CommitKind {
    fn validating_phase(self) -> SkillImportBatchPhase {
        match self {
            Self::Initial => SkillImportBatchPhase::Validating,
            Self::Retry => SkillImportBatchPhase::RetryValidating,
        }
    }

    fn executing_phase(self) -> SkillImportBatchPhase {
        match self {
            Self::Initial => SkillImportBatchPhase::Submitting,
            Self::Retry => SkillImportBatchPhase::Retrying,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GuardStage {
    Validating,
    Executing,
}

impl GuardStage {
    fn phase(self, kind: CommitKind) -> SkillImportBatchPhase {
        match self {
            Self::Validating => kind.validating_phase(),
            Self::Executing => kind.executing_phase(),
        }
    }
}

/// RAII phase guard。验证错误、线程 panic 和 join failure 都会通过 `Drop` 恢复；
/// 一旦进入写阶段，尚未产生终态的本次项目会累计为 failed。
pub(crate) struct CommitPhaseGuard {
    core: Arc<StateCore>,
    batch_id: String,
    kind: CommitKind,
    stage: GuardStage,
    unresolved: HashSet<String>,
    armed: bool,
}

impl CommitPhaseGuard {
    /// 全部预检成功后调用。首次提交必须覆盖所有 pending；重试只接受 failed，且
    /// 可以只选择其中一部分。skip 在同一临界区直接成为终态，避免随后异常误标 failed。
    pub(crate) fn enter_execution(
        &mut self,
        decisions: &[SkillImportDecision],
    ) -> Result<SkillImportSnapshotEvent, SkillCommandError> {
        if self.stage != GuardStage::Validating || !self.armed {
            return Err(SkillCommandError::Busy);
        }
        let mut requested = HashSet::new();
        for decision in decisions {
            if !requested.insert(decision.item_id.as_str()) {
                return Err(invalid_request("提交决策包含重复 item_id"));
            }
        }

        let mut inner = self.core.lock();
        let mut events = Vec::new();
        let phase_event;
        {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                return Err(SkillCommandError::Busy);
            };
            if batch.batch_id != self.batch_id || batch.phase != self.kind.validating_phase() {
                return Err(SkillCommandError::Busy);
            }

            let eligible = batch
                .items
                .iter()
                .filter(|item| {
                    item.preview.state
                        == match self.kind {
                            CommitKind::Initial => SkillImportItemState::Pending,
                            CommitKind::Retry => SkillImportItemState::Failed,
                        }
                })
                .map(|item| item.preview.item_id.as_str())
                .collect::<Vec<_>>();
            match self.kind {
                CommitKind::Initial
                    if eligible.len() != requested.len()
                        || eligible.iter().any(|item_id| !requested.contains(item_id)) =>
                {
                    return Err(invalid_request("首次提交必须恰好覆盖全部 pending 技能项"));
                }
                CommitKind::Retry => {
                    if requested.is_empty()
                        || requested.iter().any(|item_id| {
                            eligible
                                .iter()
                                .filter(|eligible_id| *eligible_id == item_id)
                                .count()
                                != 1
                        })
                    {
                        return Err(invalid_request("重试只接受 failed 技能项"));
                    }
                }
                CommitKind::Initial => {}
            }

            for decision in decisions {
                let item = batch
                    .items
                    .iter_mut()
                    .find(|item| item.preview.item_id == decision.item_id)
                    .expect("eligible 已验证 item_id");
                if decision.action == SkillImportAction::Skip {
                    item.preview.state = SkillImportItemState::Skipped;
                    item.preview.last_error = None;
                    events.push(self.core.bump_batch(batch));
                } else {
                    self.unresolved.insert(decision.item_id.clone());
                }
            }
            batch.phase = self.kind.executing_phase();
            phase_event = self.core.bump_batch(batch);
            events.push(phase_event.clone());
        }
        inner.events.extend(events);
        self.stage = GuardStage::Executing;
        Ok(phase_event)
    }

    pub(crate) fn record_item_outcome(
        &mut self,
        item_id: &str,
        state: SkillImportItemState,
        error: Option<String>,
    ) -> Result<SkillImportSnapshotEvent, SkillCommandError> {
        if self.stage != GuardStage::Executing || !self.unresolved.contains(item_id) {
            return Err(invalid_request("技能项不属于本次未决执行集合"));
        }
        if !matches!(
            state,
            SkillImportItemState::Succeeded | SkillImportItemState::Failed
        ) {
            return Err(invalid_request("执行结果只能是 succeeded 或 failed"));
        }
        let mut inner = self.core.lock();
        let event = {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                return Err(SkillCommandError::Busy);
            };
            if batch.batch_id != self.batch_id || batch.phase != self.kind.executing_phase() {
                return Err(SkillCommandError::Busy);
            }
            let item = batch
                .items
                .iter_mut()
                .find(|item| item.preview.item_id == item_id)
                .ok_or_else(|| invalid_request("导入技能项不存在"))?;
            if matches!(
                item.preview.state,
                SkillImportItemState::Succeeded | SkillImportItemState::Skipped
            ) {
                return Err(invalid_request("成功或跳过技能项不能重新激活"));
            }
            item.preview.state = state;
            item.preview.last_error = match state {
                SkillImportItemState::Failed => {
                    Some(error.unwrap_or_else(|| "技能安装失败".to_string()))
                }
                SkillImportItemState::Succeeded => None,
                SkillImportItemState::Pending | SkillImportItemState::Skipped => unreachable!(),
            };
            self.core.bump_batch(batch)
        };
        inner.events.push_back(event.clone());
        self.unresolved.remove(item_id);
        Ok(event)
    }

    /// 重试预检重算冲突时使用；不允许借闭包把 I/O 带入批次临界区，也不允许
    /// 改写成功/跳过等累计终态。
    pub(crate) fn update_item_conflict(
        &mut self,
        item_id: &str,
        conflict: super::model::SkillImportConflict,
        duplicate_group: Option<String>,
    ) -> Result<SkillImportSnapshotEvent, SkillCommandError> {
        if self.stage != GuardStage::Validating || !self.armed {
            return Err(SkillCommandError::Busy);
        }
        let mut inner = self.core.lock();
        let event = {
            let BatchSlot::Active(batch) = &mut inner.slot else {
                return Err(SkillCommandError::Busy);
            };
            if batch.batch_id != self.batch_id || batch.phase != self.kind.validating_phase() {
                return Err(SkillCommandError::Busy);
            }
            let item = batch
                .items
                .iter_mut()
                .find(|item| item.preview.item_id == item_id)
                .ok_or_else(|| invalid_request("导入技能项不存在"))?;
            if matches!(
                item.preview.state,
                SkillImportItemState::Succeeded | SkillImportItemState::Skipped
            ) {
                return Err(invalid_request("成功或跳过技能项不能重新激活"));
            }
            item.preview.conflict = conflict;
            item.preview.duplicate_group = duplicate_group;
            self.core.bump_batch(batch)
        };
        inner.events.push_back(event.clone());
        Ok(event)
    }

    /// 正常执行完成。若调用方遗漏某个未决项，仍按异常语义累计为 failed。
    pub(crate) fn finish(mut self, catalog_revision: Option<u64>) {
        self.core.recover_guard(
            &self.batch_id,
            self.kind,
            self.stage,
            &self.unresolved,
            UNRESOLVED_EXECUTION_ERROR,
            catalog_revision,
        );
        self.armed = false;
    }

    /// 显式错误路径可保留具体原因；不调用时 `Drop` 使用稳定后台异常文案。
    pub(crate) fn abort(mut self, error: impl AsRef<str>) {
        self.core.recover_guard(
            &self.batch_id,
            self.kind,
            self.stage,
            &self.unresolved,
            error.as_ref(),
            None,
        );
        self.armed = false;
    }
}

impl Drop for CommitPhaseGuard {
    fn drop(&mut self) {
        if self.armed {
            self.core.recover_guard(
                &self.batch_id,
                self.kind,
                self.stage,
                &self.unresolved,
                ABORTED_EXECUTION_ERROR,
                None,
            );
            self.armed = false;
        }
    }
}

/// cancel 临界区返回的所有权对象。墓碑已经可见，但来源 reservation 仍由该对象
/// 持有；命令层应在 `spawn_blocking` 中调用 `cleanup`。
pub(crate) struct CancelledImportBatch {
    pub event: SkillImportSnapshotEvent,
    sources: Vec<StagedImportSource>,
    core: Arc<StateCore>,
}

impl CancelledImportBatch {
    pub(crate) fn cleanup(self) -> Result<(), SkillCommandError> {
        let mut first_error = None;
        let mut pending = Vec::new();
        for source in self.sources {
            if let Err(failure) = source.merge_guard.cleanup() {
                let (error, guard) = failure.into_parts();
                first_error.get_or_insert(error);
                pending.push(guard);
            }
        }
        if !pending.is_empty() {
            self.core.lock().pending_cleanup.extend(pending);
        }
        match first_error {
            Some(error) => Err(lease_error(error)),
            None => Ok(()),
        }
    }
}

fn build_result(batch: &StagedImportBatch) -> Result<SkillImportBatchResult, SkillCommandError> {
    let mut success_count = 0;
    let mut failure_count = 0;
    let mut skipped_count = 0;
    let items = batch
        .items
        .iter()
        .map(|item| {
            match item.preview.state {
                SkillImportItemState::Succeeded => success_count += 1,
                SkillImportItemState::Failed => failure_count += 1,
                SkillImportItemState::Skipped => skipped_count += 1,
                SkillImportItemState::Pending => {}
            }
            SkillImportItemResult {
                item_id: item.preview.item_id.clone(),
                name: item.preview.name.clone(),
                state: item.preview.state,
                error: item.preview.last_error.clone(),
            }
        })
        .collect::<Vec<_>>();
    if success_count + failure_count + skipped_count != items.len() {
        return Err(invalid_request("Completed 批次仍包含 pending 技能项"));
    }
    Ok(SkillImportBatchResult {
        batch_id: batch.batch_id.clone(),
        catalog_revision: batch.catalog_revision,
        items,
        success_count,
        failure_count,
        skipped_count,
    })
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
