use super::*;

use std::fs;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::thread;

use crate::skill_import::lease::{SourceKey, StagingUsage};
use crate::skill_import::model::{
    SkillImportConflict, SkillImportSourceKind, SkillImportSourceStatus, SkillImportValidity,
};

static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

struct TestConfig {
    root: PathBuf,
}

impl TestConfig {
    fn new(label: &str) -> Self {
        let id = NEXT_TEST.fetch_add(1, AtomicOrdering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "monkeycode-skill-state-{label}-{}-{id}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Self { root }
    }
}

impl Drop for TestConfig {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn item(id: &str, source_id: &str) -> SkillImportItem {
    SkillImportItem {
        item_id: id.into(),
        source_id: source_id.into(),
        order: usize::MAX,
        source_display_name: format!("{source_id}-display"),
        relative_root: id.into(),
        name: Some(id.into()),
        portable_name_key: Some(id.to_ascii_lowercase()),
        description: String::new(),
        files: Vec::new(),
        total_size: 0,
        risks: Vec::new(),
        validity: SkillImportValidity::Valid,
        conflict: SkillImportConflict::None,
        duplicate_group: None,
        state: SkillImportItemState::Pending,
        last_error: None,
    }
}

fn source_data(source_id: &str, item_ids: &[&str]) -> StagedImportSourceData {
    StagedImportSourceData {
        preview: SkillImportSource {
            source_id: source_id.into(),
            order: 0,
            kind: SkillImportSourceKind::Folders,
            display_name: format!("{source_id}-display"),
            status: SkillImportSourceStatus::Ready,
            skill_count: item_ids.len(),
            error: None,
        },
        source_path: PathBuf::from(format!("/{source_id}")),
        fingerprint: None,
        items: item_ids
            .iter()
            .map(|id| StagedImportItemData {
                staged_root: Some(PathBuf::from(format!("/staged/{id}"))),
                staged_fingerprint: None,
                preview: item(id, source_id),
            })
            .collect(),
    }
}

fn merge_candidate(source_id: &str, skill_count: usize) -> SourceMergeCandidate {
    let selection = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new(&format!("/{source_id}-selection")),
    )
    .unwrap();
    let canonical = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new(&format!("/{source_id}-canonical")),
    )
    .unwrap();
    SourceMergeCandidate::staged(selection, canonical, skill_count, StagingUsage::default())
}

fn add_source(state: &SkillImportState, batch_id: &str, source_id: &str, items: &[&str]) {
    let token = state.reserve_source_pick(batch_id).unwrap();
    state
        .complete_source_pick(
            &token,
            source_data(source_id, items),
            merge_candidate(source_id, items.len()),
            None,
        )
        .unwrap();
}

fn decisions(entries: &[(&str, SkillImportAction)]) -> Vec<SkillImportDecision> {
    entries
        .iter()
        .map(|(item_id, action)| SkillImportDecision {
            item_id: (*item_id).into(),
            action: *action,
        })
        .collect()
}

#[test]
fn unique_slot_and_initial_pick_reservation_are_instance_wide() {
    let state = SkillImportState::new();
    let initial = state.reserve_initial_source_pick("batch-a").unwrap();
    assert!(matches!(
        state.reserve_initial_source_pick("batch-b"),
        Err(SkillCommandError::Busy)
    ));
    assert!(matches!(
        state.create_batch("batch-b"),
        Err(SkillCommandError::Busy)
    ));
    assert!(state.current().batch.is_none());

    state.abandon_source_pick(&initial).unwrap();
    let created = state.create_batch("batch-a").unwrap();
    assert_eq!(created.snapshot_revision, 1);
    assert!(matches!(
        state.create_batch("batch-b"),
        Err(SkillCommandError::Busy)
    ));
}

#[test]
fn concurrent_pick_commit_and_cancel_are_busy_while_source_is_in_flight() {
    let state = SkillImportState::new();
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();

    let pick_state = state.clone();
    let commit_state = state.clone();
    let cancel_state = state.clone();
    let pick = thread::spawn(move || pick_state.reserve_source_pick("batch"));
    let commit = thread::spawn(move || commit_state.begin_initial_commit("batch"));
    let cancel = thread::spawn(move || cancel_state.cancel("batch"));

    assert!(matches!(pick.join().unwrap(), Err(SkillCommandError::Busy)));
    assert!(matches!(
        commit.join().unwrap(),
        Err(SkillCommandError::Busy)
    ));
    assert!(matches!(
        cancel.join().unwrap(),
        Err(SkillCommandError::Busy)
    ));
    assert_eq!(
        state.allowed_operations("batch").unwrap(),
        SkillImportAllowedOperations {
            add_source: false,
            commit: false,
            retry: false,
            cancel: false,
            read_text: true,
        }
    );

    state.abandon_source_pick(&token).unwrap();
    assert!(state.allowed_operations("batch").unwrap().commit);
}

#[test]
fn current_revision_rejects_out_of_order_snapshot_after_cancel_tombstone() {
    let state = SkillImportState::new();
    state.create_batch("batch").unwrap();
    add_source(&state, "batch", "source", &["item"]);
    let old_current = state.current();
    let cancelled = state.cancel("batch").unwrap();
    let tombstone = cancelled.event.clone();
    cancelled.cleanup().unwrap();
    let empty_current = state.current();

    assert!(tombstone.deleted);
    assert!(tombstone.snapshot_revision > old_current.snapshot_revision);
    assert_eq!(empty_current.snapshot_revision, tombstone.snapshot_revision);
    assert!(empty_current.batch.is_none());

    // 模拟 task 17 的“只接受更高 revision”：取消前克隆、取消后才返回的 current
    // 不能覆盖已经接受的墓碑。
    let accepted_revision = tombstone.snapshot_revision;
    assert!(old_current.snapshot_revision <= accepted_revision);
    assert!(!old_current
        .batch
        .as_ref()
        .is_some_and(|_| old_current.snapshot_revision > accepted_revision));
}

#[test]
fn validation_guards_restore_first_and_retry_phases() {
    let state = SkillImportState::new();
    state.create_batch("batch").unwrap();
    add_source(&state, "batch", "source", &["failed"]);

    let mut invalid = state.begin_initial_commit("batch").unwrap();
    assert!(matches!(
        invalid.enter_execution(&decisions(&[
            ("failed", SkillImportAction::Install),
            ("failed", SkillImportAction::Install),
        ])),
        Err(SkillCommandError::InvalidRequest { .. })
    ));
    drop(invalid);
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::Collecting
    );

    let mut initial = state.begin_initial_commit("batch").unwrap();
    initial
        .enter_execution(&decisions(&[("failed", SkillImportAction::Install)]))
        .unwrap();
    initial
        .record_item_outcome(
            "failed",
            SkillImportItemState::Failed,
            Some("first failure".into()),
        )
        .unwrap();
    initial.finish(None);

    drop(state.begin_retry("batch").unwrap());
    let snapshot = state.current().batch.unwrap();
    assert_eq!(snapshot.phase, SkillImportBatchPhase::Completed);
    assert_eq!(snapshot.items[0].state, SkillImportItemState::Failed);
    assert_eq!(
        snapshot.items[0].last_error.as_deref(),
        Some("first failure")
    );
}

#[test]
fn validating_submitting_and_retry_phases_reject_every_concurrent_operation() {
    let state = SkillImportState::new();
    state.create_batch("batch").unwrap();
    add_source(&state, "batch", "source", &["item"]);

    let assert_busy = |state: &SkillImportState| {
        assert!(matches!(
            state.reserve_source_pick("batch"),
            Err(SkillCommandError::Busy)
        ));
        assert!(matches!(
            state.cancel("batch"),
            Err(SkillCommandError::Busy)
        ));
        assert!(matches!(
            state.begin_initial_commit("batch"),
            Err(SkillCommandError::Busy)
        ));
        assert!(matches!(
            state.begin_retry("batch"),
            Err(SkillCommandError::Busy)
        ));
        assert!(state.current().batch.is_some());
    };

    let mut initial = state.begin_initial_commit("batch").unwrap();
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::Validating
    );
    assert_busy(&state);
    initial
        .enter_execution(&decisions(&[("item", SkillImportAction::Install)]))
        .unwrap();
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::Submitting
    );
    assert_busy(&state);
    initial
        .record_item_outcome(
            "item",
            SkillImportItemState::Failed,
            Some("retry me".into()),
        )
        .unwrap();
    initial.finish(None);

    let mut retry = state.begin_retry("batch").unwrap();
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::RetryValidating
    );
    assert_busy(&state);
    assert!(matches!(
        retry.enter_execution(&decisions(&[
            ("item", SkillImportAction::Install),
            ("item", SkillImportAction::Install),
        ])),
        Err(SkillCommandError::InvalidRequest { .. })
    ));
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::RetryValidating
    );
    retry
        .enter_execution(&decisions(&[("item", SkillImportAction::Install)]))
        .unwrap();
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::Retrying
    );
    assert_busy(&state);
    retry
        .record_item_outcome("item", SkillImportItemState::Succeeded, None)
        .unwrap();
    retry.finish(Some(7));
    assert_eq!(state.result("batch").unwrap().success_count, 1);
}

#[test]
fn creation_phase_inflight_source_and_item_mutations_advance_instance_clock() {
    let state = SkillImportState::new();
    state.create_batch("batch").unwrap();
    let pick = state.reserve_source_pick("batch").unwrap();
    state.abandon_source_pick(&pick).unwrap();
    add_source(&state, "batch", "source", &["item"]);
    let mut guard = state.begin_initial_commit("batch").unwrap();
    guard
        .enter_execution(&decisions(&[("item", SkillImportAction::Install)]))
        .unwrap();
    guard
        .record_item_outcome("item", SkillImportItemState::Succeeded, None)
        .unwrap();
    guard.finish(Some(9));

    let events = state.take_events();
    assert!(events.len() >= 9);
    assert!(events
        .windows(2)
        .all(|pair| pair[0].snapshot_revision < pair[1].snapshot_revision));
    assert!(events
        .iter()
        .all(|event| event.batch_id == "batch" && !event.deleted));
    let current = state.current();
    assert_eq!(
        current.snapshot_revision,
        events.last().unwrap().snapshot_revision
    );
    assert_eq!(
        current.batch.unwrap().snapshot_revision,
        current.snapshot_revision
    );
}

#[test]
fn panicking_background_guard_marks_unresolved_failed_and_completes() {
    let state = SkillImportState::new();
    state.create_batch("batch").unwrap();
    add_source(&state, "batch", "source", &["pending"]);

    let mut guard = state.begin_initial_commit("batch").unwrap();
    let join = thread::spawn(move || {
        guard
            .enter_execution(&decisions(&[("pending", SkillImportAction::Install)]))
            .unwrap();
        panic!("injected worker panic");
    })
    .join();
    assert!(join.is_err());

    let snapshot = state.current().batch.unwrap();
    assert_eq!(snapshot.phase, SkillImportBatchPhase::Completed);
    assert_eq!(snapshot.items[0].state, SkillImportItemState::Failed);
    assert_eq!(
        snapshot.items[0].last_error.as_deref(),
        Some(ABORTED_EXECUTION_ERROR)
    );
    let result = state.result("batch").unwrap();
    assert_eq!(result.failure_count, 1);
}

#[test]
fn execution_abort_preserves_success_and_skip_and_accumulates_retry_result() {
    let state = SkillImportState::new();
    state.create_batch("batch").unwrap();
    add_source(&state, "batch", "source", &["success", "skip", "retry"]);

    let mut initial = state.begin_initial_commit("batch").unwrap();
    initial
        .enter_execution(&decisions(&[
            ("success", SkillImportAction::Install),
            ("skip", SkillImportAction::Skip),
            ("retry", SkillImportAction::Install),
        ]))
        .unwrap();
    initial
        .record_item_outcome("success", SkillImportItemState::Succeeded, None)
        .unwrap();
    initial.abort("injected execution failure");

    let first = state.result("batch").unwrap();
    assert_eq!(first.success_count, 1);
    assert_eq!(first.failure_count, 1);
    assert_eq!(first.skipped_count, 1);
    assert_eq!(
        first
            .items
            .iter()
            .find(|item| item.item_id == "success")
            .unwrap()
            .state,
        SkillImportItemState::Succeeded
    );
    assert_eq!(
        first
            .items
            .iter()
            .find(|item| item.item_id == "skip")
            .unwrap()
            .state,
        SkillImportItemState::Skipped
    );

    let mut retry = state.begin_retry("batch").unwrap();
    retry
        .enter_execution(&decisions(&[("retry", SkillImportAction::Install)]))
        .unwrap();
    retry
        .record_item_outcome("retry", SkillImportItemState::Succeeded, None)
        .unwrap();
    retry.finish(Some(42));

    let cumulative = state.result("batch").unwrap();
    assert_eq!(cumulative.success_count, 2);
    assert_eq!(cumulative.failure_count, 0);
    assert_eq!(cumulative.skipped_count, 1);
    assert_eq!(cumulative.items.len(), 3);
    assert_eq!(cumulative.catalog_revision, Some(42));
}

#[test]
fn late_source_merge_is_rejected_and_explicitly_releases_reservation() {
    let config = TestConfig::new("late-source-cleanup");
    let instance = StagingInstance::open(&config.root, |_| false).unwrap();
    let state = SkillImportState::with_staging_instance(instance.clone());
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();

    let mut reservation = instance.begin_source().unwrap();
    reservation.reserve_entries(1).unwrap();
    reservation.reserve_bytes(4).unwrap();
    fs::create_dir(reservation.staging_root()).unwrap();
    fs::write(reservation.staging_root().join("data"), b"data").unwrap();
    let staged_root = reservation.staging_root().to_path_buf();
    let usage = reservation.usage();
    let selection =
        SourceKey::from_selection(SkillImportSourceKind::Folders, Path::new("/late-selection"))
            .unwrap();
    let canonical =
        SourceKey::from_selection(SkillImportSourceKind::Folders, Path::new("/late-canonical"))
            .unwrap();
    let candidate = SourceMergeCandidate::staged(selection, canonical, 0, usage);

    state.abandon_source_pick(&token).unwrap();
    let late = state.complete_source_pick(
        &token,
        source_data("late", &[]),
        candidate,
        Some(reservation),
    );
    assert!(matches!(late, Err(SkillCommandError::Busy)));
    assert!(!staged_root.exists());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
    assert!(state.current().batch.unwrap().sources.is_empty());
}

#[test]
fn late_source_cleanup_permission_denied_is_structured_and_preserves_staging_ledger() {
    let config = TestConfig::new("late-source-cleanup-denied");
    let instance = StagingInstance::open(&config.root, |_| false).unwrap();
    let state = SkillImportState::with_staging_instance(instance.clone());
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();

    let mut reservation = instance.begin_source().unwrap();
    reservation.reserve_entries(1).unwrap();
    reservation.reserve_bytes(4).unwrap();
    fs::create_dir(reservation.staging_root()).unwrap();
    fs::write(reservation.staging_root().join("data"), b"data").unwrap();
    let staged_root = reservation.staging_root().to_path_buf();
    let usage = reservation.usage();
    reservation.inject_cleanup_error(io::ErrorKind::PermissionDenied);
    let selection = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/late-denied-pick"),
    )
    .unwrap();
    let canonical = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/late-denied-canonical"),
    )
    .unwrap();
    let candidate = SourceMergeCandidate::staged(selection, canonical, 0, usage);

    state.abandon_source_pick(&token).unwrap();
    let error = state
        .complete_source_pick(
            &token,
            source_data("late-denied", &[]),
            candidate,
            Some(reservation),
        )
        .unwrap_err();
    assert!(matches!(
        error,
        SkillCommandError::CleanupFailed { ref target, .. }
            if target == "来源暂存目录"
    ));
    assert!(staged_root.exists());
    assert_eq!(instance.config_usage().unwrap(), usage);
    assert!(state.current().batch.unwrap().sources.is_empty());
}

#[test]
fn same_item_id_from_different_sources_is_rejected_and_cannot_leave_completed_pending() {
    let config = TestConfig::new("cross-source-item-id");
    let instance = StagingInstance::open(&config.root, |_| false).unwrap();
    let state = SkillImportState::with_staging_instance(instance.clone());
    state.create_batch("batch").unwrap();
    add_source(&state, "batch", "first", &["same"]);

    let token = state.reserve_source_pick("batch").unwrap();
    let mut reservation = instance.begin_source().unwrap();
    reservation.reserve_entries(1).unwrap();
    reservation.reserve_bytes(4).unwrap();
    fs::create_dir(reservation.staging_root()).unwrap();
    fs::write(reservation.staging_root().join("data"), b"data").unwrap();
    let staged_root = reservation.staging_root().to_path_buf();
    let selection = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/second-selection"),
    )
    .unwrap();
    let canonical = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/second-canonical"),
    )
    .unwrap();
    let candidate = SourceMergeCandidate::staged(selection, canonical, 1, reservation.usage());

    let error = state
        .complete_source_pick(
            &token,
            source_data("second", &["same"]),
            candidate,
            Some(reservation),
        )
        .unwrap_err();
    assert!(matches!(error, SkillCommandError::InvalidRequest { .. }));
    assert!(!staged_root.exists());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
    let snapshot = state.current().batch.unwrap();
    assert_eq!(snapshot.sources.len(), 1);
    assert_eq!(snapshot.items.len(), 1);
    assert_eq!(snapshot.in_flight_source_picks, 0);

    let mut guard = state.begin_initial_commit("batch").unwrap();
    guard
        .enter_execution(&decisions(&[("same", SkillImportAction::Install)]))
        .unwrap();
    guard
        .record_item_outcome("same", SkillImportItemState::Succeeded, None)
        .unwrap();
    guard.finish(None);
    let completed = state.current().batch.unwrap();
    assert_eq!(completed.phase, SkillImportBatchPhase::Completed);
    assert!(completed
        .items
        .iter()
        .all(|item| item.state != SkillImportItemState::Pending));
    state.result("batch").unwrap();
}

#[test]
fn duplicate_source_cleanup_permission_denied_is_structured_and_preserves_staging_ledger() {
    let config = TestConfig::new("merge-reject-cleanup-denied");
    let instance = StagingInstance::open(&config.root, |_| false).unwrap();
    let state = SkillImportState::with_staging_instance(instance.clone());
    state.create_batch("batch").unwrap();
    add_source(&state, "batch", "duplicate", &[]);

    let token = state.reserve_source_pick("batch").unwrap();
    let mut reservation = instance.begin_source().unwrap();
    reservation.reserve_entries(1).unwrap();
    reservation.reserve_bytes(4).unwrap();
    fs::create_dir(reservation.staging_root()).unwrap();
    fs::write(reservation.staging_root().join("data"), b"data").unwrap();
    let staged_root = reservation.staging_root().to_path_buf();
    let usage = reservation.usage();
    reservation.inject_cleanup_error(io::ErrorKind::PermissionDenied);
    let selection = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/duplicate-selection"),
    )
    .unwrap();
    let canonical = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/duplicate-canonical"),
    )
    .unwrap();
    let candidate = SourceMergeCandidate::staged(selection, canonical, 0, usage);

    let error = state
        .complete_source_pick(
            &token,
            source_data("rejected", &[]),
            candidate,
            Some(reservation),
        )
        .unwrap_err();
    assert!(matches!(
        error,
        SkillCommandError::CleanupFailed { ref target, .. }
            if target == "来源暂存目录"
    ));
    assert!(staged_root.exists(), "显式清理失败后必须保留 staging");
    assert_eq!(
        instance.config_usage().unwrap(),
        usage,
        "必须保留 ledger 配额"
    );
    let snapshot = state.current().batch.unwrap();
    assert_eq!(snapshot.sources.len(), 1);
    assert_eq!(snapshot.in_flight_source_picks, 0);
}

#[test]
fn cancel_publishes_tombstone_before_explicit_task4_cleanup() {
    let config = TestConfig::new("cancel-cleanup");
    let instance = StagingInstance::open(&config.root, |_| false).unwrap();
    let state = SkillImportState::with_staging_instance(instance.clone());
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();

    let mut reservation = instance.begin_source().unwrap();
    reservation.reserve_entries(1).unwrap();
    reservation.reserve_bytes(4).unwrap();
    fs::create_dir(reservation.staging_root()).unwrap();
    fs::write(reservation.staging_root().join("data"), b"data").unwrap();
    let staged_root = reservation.staging_root().to_path_buf();
    let selection = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/cancel-selection"),
    )
    .unwrap();
    let canonical = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/cancel-canonical"),
    )
    .unwrap();
    let candidate = SourceMergeCandidate::staged(selection, canonical, 0, reservation.usage());
    state
        .complete_source_pick(
            &token,
            source_data("cancel", &[]),
            candidate,
            Some(reservation),
        )
        .unwrap();

    let cancelled = state.cancel("batch").unwrap();
    assert!(cancelled.event.deleted);
    assert!(state.current().batch.is_none());
    assert!(staged_root.exists(), "cancel 临界区不得跨目录删除 I/O");
    cancelled.cleanup().unwrap();
    assert!(!staged_root.exists());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
}

#[test]
fn cancel_cleanup_failure_is_reaped_by_later_command_without_restart() {
    let config = TestConfig::new("cancel-cleanup-retry");
    let instance = StagingInstance::open(&config.root, |_| false).unwrap();
    let state = SkillImportState::with_staging_instance(instance.clone());
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();

    let mut reservation = instance.begin_source().unwrap();
    reservation.reserve_entries(1).unwrap();
    reservation.reserve_bytes(4).unwrap();
    fs::create_dir(reservation.staging_root()).unwrap();
    fs::write(reservation.staging_root().join("data"), b"data").unwrap();
    let staged_root = reservation.staging_root().to_path_buf();
    let usage = reservation.usage();
    // 模拟 cancel 时文件仍被占用；后面显式解除注入，代表占用已释放。
    reservation.inject_cleanup_error(io::ErrorKind::PermissionDenied);
    let selection = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/cancel-retry-selection"),
    )
    .unwrap();
    let canonical = SourceKey::from_selection(
        SkillImportSourceKind::Folders,
        Path::new("/cancel-retry-canonical"),
    )
    .unwrap();
    state
        .complete_source_pick(
            &token,
            source_data("cancel-retry", &[]),
            SourceMergeCandidate::staged(selection, canonical, 0, usage),
            Some(reservation),
        )
        .unwrap();

    let cancelled = state.cancel("batch").unwrap();
    let tombstone = cancelled.event.clone();
    let error = cancelled.cleanup().unwrap_err();
    assert!(matches!(
        error,
        SkillCommandError::CleanupFailed { ref target, .. }
            if target == "来源暂存目录"
    ));
    assert!(tombstone.deleted);
    assert!(state.current().batch.is_none(), "墓碑后批次不得重现");
    assert_eq!(state.pending_cleanup_count(), 1);
    assert!(staged_root.exists());
    assert_eq!(instance.config_usage().unwrap(), usage);

    // 解除占用后，current/pick/cancel 命令会在 spawn_blocking 中调用同一有界维护入口。
    state.clear_pending_cleanup_errors_for_test();
    state
        .retry_pending_cleanup(PENDING_CLEANUP_RETRY_LIMIT)
        .unwrap();
    assert_eq!(state.pending_cleanup_count(), 0);
    assert!(!staged_root.exists());
    assert_eq!(instance.config_usage().unwrap(), StagingUsage::default());
    assert!(
        state.current().batch.is_none(),
        "清理完成也不得复活墓碑批次"
    );

    let mut replacement = instance.begin_source().unwrap();
    replacement.reserve_entries(1).unwrap();
    replacement.reserve_bytes(4).unwrap();
    replacement.cleanup_owned().unwrap();
}

#[test]
fn phase_operation_table_covers_all_six_phases() {
    assert_eq!(
        SkillImportAllowedOperations::for_batch(SkillImportBatchPhase::Collecting, false),
        SkillImportAllowedOperations {
            add_source: true,
            commit: true,
            retry: false,
            cancel: true,
            read_text: true,
        }
    );
    assert!(SkillImportAllowedOperations::for_batch(SkillImportBatchPhase::Completed, false).retry);
    for phase in [
        SkillImportBatchPhase::Validating,
        SkillImportBatchPhase::Submitting,
        SkillImportBatchPhase::RetryValidating,
        SkillImportBatchPhase::Retrying,
    ] {
        let allowed = SkillImportAllowedOperations::for_batch(phase, false);
        assert_eq!(
            allowed,
            SkillImportAllowedOperations {
                add_source: false,
                commit: false,
                retry: false,
                cancel: false,
                read_text: false,
            }
        );
    }
}
