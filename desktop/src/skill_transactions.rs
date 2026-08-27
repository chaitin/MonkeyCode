//! 技能库逐项安装事务与崩溃恢复。
//!
//! 调用方必须持有 [`crate::skills::SkillStoreState`] 的进程内写锁和跨进程
//! `skills.lock` 独占锁。这里不创建第二套锁；持久事务日志才是跨进程真值。

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::skill_import::model::{SkillRecoveryAction, SkillRecoveryIssue};
use crate::skill_import::store::{
    BaselineStore, FixedStagedSkillRoot, SkillStoreError, StoreRevision, TargetBaseline,
    TargetPresence,
};

const IMPORTS_DIR: &str = ".imports";
const BACKUPS_DIR: &str = ".backups";
const TRANSACTIONS_DIR: &str = ".transactions";
const LOG_FORMAT: u32 = 1;
const MAX_LOG_BYTES: u64 = 64 * 1024;
const PREPARED_DIR: &str = "prepared";
const ISOLATED_DIR: &str = "isolated";
const QUARANTINE_DIR: &str = "promotion-quarantine";
const DISPLACED_DIR: &str = "displaced-target";
const ORIGINAL_DIR: &str = "original";
const SKILL_MD: &str = "SKILL.md";
const PRESERVE_MANIFEST: &str = "manifest.json";
const PRESERVE_FORMAT: u32 = 1;

#[cfg(test)]
static DIRECTORY_SYNC_COUNT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
thread_local! {
    static INJECT_FAILURE_AT: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}

fn inject_failure(point: &'static str) -> Result<(), TxError> {
    #[cfg(test)]
    if INJECT_FAILURE_AT.with(|slot| slot.get() == Some(point)) {
        INJECT_FAILURE_AT.with(|slot| slot.set(None));
        return Err(TxError::Message(format!("注入事务失败点: {point}")));
    }
    let _ = point;
    Ok(())
}

#[cfg(test)]
pub(crate) fn inject_failure_for_test(point: &'static str) {
    INJECT_FAILURE_AT.with(|slot| slot.set(Some(point)));
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TransactionPhase {
    Prepared,
    BackupCreated,
    Installed,
}

#[derive(Debug)]
pub(crate) struct SkillInstallRequest {
    pub item_id: String,
    pub skill_name: String,
    pub source: FixedStagedSkillRoot,
    pub baseline: TargetBaseline,
    pub replace: bool,
    /// `skill-import-staging/<instance-id>` 的末级安全组件。日志存组件而不是绝对路径。
    pub staging_instance_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SkillInstallOutcome {
    pub item_id: String,
    pub skill_name: String,
    pub transaction_id: Option<String>,
    pub error: Option<String>,
}

impl SkillInstallOutcome {
    #[cfg(test)]
    pub(crate) fn succeeded(&self) -> bool {
        self.error.is_none()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TransactionLog {
    format: u32,
    transaction_id: String,
    skill_name: String,
    portable_name_key: String,
    replace: bool,
    phase: TransactionPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    staging_instance_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct RecoveryEntry {
    pub transaction_id: String,
    pub fingerprint: String,
    pub issue: Option<SkillRecoveryIssue>,
    kind: RecoveryKind,
}

#[derive(Clone, Debug)]
enum RecoveryKind {
    Logged(TransactionLog),
    Malformed { residues: Vec<Residue> },
    PreserveInProgress,
}

#[derive(Clone, Debug)]
struct Residue {
    relative_path: String,
    destination_name: String,
    snapshot: StableSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PreserveManifest {
    format: u32,
    recovery_id: String,
    complete: bool,
    entries: Vec<PreserveManifestEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PreserveManifestEntry {
    source_relative: String,
    destination_name: String,
    expected: StableSnapshot,
    completed: bool,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RecoveryInventory {
    pub entries: Vec<RecoveryEntry>,
}

impl RecoveryInventory {
    pub(crate) fn needs_automatic_recovery(&self) -> bool {
        self.entries.iter().any(|entry| entry.issue.is_none())
    }

    #[cfg(test)]
    pub(crate) fn issues(&self) -> Vec<SkillRecoveryIssue> {
        let mut issues = self
            .entries
            .iter()
            .filter_map(|entry| entry.issue.clone())
            .collect::<Vec<_>>();
        issues.sort_by(|left, right| left.transaction_id.cmp(&right.transaction_id));
        issues
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RecoveryRun {
    pub authority_changed: bool,
    pub issues: Vec<(String, String, SkillRecoveryIssue)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResolveOutcome {
    pub preserved_path: Option<String>,
    pub authority_changed: bool,
}

/// `resolve_recovery` 在 revision write-ahead invalidation 之前生成的纯只读计划。
/// fingerprint 绑定本次 UI 动作看到的日志、候选 identity 与完整树内容；执行阶段
/// 必须重新发现并精确对比，不能把计划中的路径快照直接当成当前权威事实。
#[derive(Clone, Debug)]
pub(crate) struct ResolvePlan {
    transaction_id: String,
    action: SkillRecoveryAction,
    fingerprint: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum StableObjectType {
    File,
    Directory,
    Other,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct StableSnapshot {
    object_type: StableObjectType,
    object_a: u64,
    object_b: u64,
    tree_fingerprint: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CandidateState {
    Missing,
    Valid,
    Unsafe,
}

#[derive(Clone, Debug)]
struct Candidate {
    state: CandidateState,
    snapshot: Option<StableSnapshot>,
}

impl Candidate {
    fn valid(&self) -> bool {
        self.state == CandidateState::Valid
    }
}

#[derive(Clone, Debug)]
struct Candidates {
    target: Candidate,
    prepared: Candidate,
    backup: Candidate,
    isolated: Candidate,
    quarantine: Candidate,
    displaced: Candidate,
    layout_clean: bool,
    fingerprint: String,
}

#[derive(Debug)]
enum TxError {
    Message(String),
    CandidateChanged(String),
    ConflictChanged(String),
}

impl fmt::Display for TxError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Message(message) => formatter.write_str(message),
            Self::CandidateChanged(entry_path) => {
                write!(formatter, "恢复候选已变化: {entry_path}")
            }
            Self::ConflictChanged(skill_name) => {
                write!(formatter, "ConflictChanged: 技能目标 {skill_name} 已变化")
            }
        }
    }
}

impl From<io::Error> for TxError {
    fn from(error: io::Error) -> Self {
        Self::Message(error.to_string())
    }
}

/// 按调用方给出的稳定顺序逐项执行；某项失败（包括回滚失败）只形成该项结果，
/// 后续不同项仍继续。若同一可移植名称已有未解决事务，后续同名项会稳定失败。
pub(crate) fn install_many_locked(
    user_dir: &Path,
    requests: &[SkillInstallRequest],
) -> Vec<SkillInstallOutcome> {
    let mut blocked_keys = discover_locked(user_dir)
        .map(|inventory| {
            inventory
                .entries
                .into_iter()
                .filter_map(|entry| match entry.kind {
                    RecoveryKind::Logged(log) => Some(log.portable_name_key),
                    _ => None,
                })
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let mut outcomes = Vec::with_capacity(requests.len());
    for request in requests {
        let key = crate::skills::portable_skill_name_key(&request.skill_name);
        if key.as_ref().is_some_and(|key| blocked_keys.contains(key)) {
            outcomes.push(SkillInstallOutcome {
                item_id: request.item_id.clone(),
                skill_name: request.skill_name.clone(),
                transaction_id: None,
                error: Some("同名技能存在未解决安装事务".into()),
            });
            continue;
        }
        let transaction_id = match generate_transaction_id() {
            Ok(id) => id,
            Err(error) => {
                outcomes.push(failed_outcome(user_dir, request, None, error));
                continue;
            }
        };
        match install_one_locked(user_dir, request, &transaction_id) {
            Ok(()) => outcomes.push(SkillInstallOutcome {
                item_id: request.item_id.clone(),
                skill_name: request.skill_name.clone(),
                transaction_id: Some(transaction_id),
                error: None,
            }),
            Err(error) => {
                if let Some(key) = key {
                    if path_present(&transaction_log_path(user_dir, &transaction_id)) {
                        blocked_keys.insert(key);
                    }
                }
                outcomes.push(failed_outcome(
                    user_dir,
                    request,
                    Some(transaction_id),
                    error,
                ));
            }
        }
    }
    outcomes
}

fn failed_outcome(
    user_dir: &Path,
    request: &SkillInstallRequest,
    transaction_id: Option<String>,
    error: impl fmt::Display,
) -> SkillInstallOutcome {
    SkillInstallOutcome {
        item_id: request.item_id.clone(),
        skill_name: request.skill_name.clone(),
        transaction_id,
        error: Some(redact_store_path(&error.to_string(), user_dir)),
    }
}

fn install_one_locked(
    user_dir: &Path,
    request: &SkillInstallRequest,
    transaction_id: &str,
) -> Result<(), TxError> {
    validate_transaction_id(transaction_id)?;
    let portable_name_key = crate::skills::portable_skill_name_key(&request.skill_name)
        .ok_or_else(|| TxError::Message(format!("不安全的技能名: {}", request.skill_name)))?;
    if let Some(instance_id) = request.staging_instance_id.as_deref() {
        validate_component(instance_id, "staging instance id")?;
    }
    ensure_layout(user_dir)?;
    inject_failure("after-layout")?;
    let target = user_dir.join(&request.skill_name);
    if request.baseline.target_name != request.skill_name
        || request.baseline.presence
            != if request.replace {
                TargetPresence::Present
            } else {
                TargetPresence::Absent
            }
    {
        return Err(TxError::ConflictChanged(request.skill_name.clone()));
    }
    let target_exists = safe_object_state(&target)? != ObjectState::Missing;
    if request.replace != target_exists {
        return Err(TxError::ConflictChanged(request.skill_name.clone()));
    }
    if request.replace {
        validate_skill_candidate(&target, &request.skill_name)?;
    }

    let import_container = import_container(user_dir, transaction_id);
    create_private_directory(&import_container)?;
    let prepared = import_container.join(PREPARED_DIR);
    if let Err(error) = (|| {
        inject_failure("after-import-container-create")?;
        request
            .source
            .copy_to(&prepared)
            .map_err(|error| TxError::Message(error.to_string()))?;
        inject_failure("after-prepared-copy")?;
        validate_skill_candidate(&prepared, &request.skill_name)?;
        sync_directory(&prepared)?;
        inject_failure("after-prepared-sync")?;
        sync_directory(&import_container)?;
        inject_failure("after-import-container-sync")?;
        sync_directory(&imports_root(user_dir))?;
        inject_failure("after-imports-root-sync")?;
        Ok::<_, TxError>(())
    })() {
        let _ = remove_if_safe(&import_container);
        return Err(error);
    }

    let mut log = TransactionLog {
        format: LOG_FORMAT,
        transaction_id: transaction_id.to_string(),
        skill_name: request.skill_name.clone(),
        portable_name_key,
        replace: request.replace,
        phase: TransactionPhase::Prepared,
        staging_instance_id: request.staging_instance_id.clone(),
    };
    if let Err(error) =
        inject_failure("before-prepared-log").and_then(|_| write_log_synced(user_dir, &log))
    {
        let _ = remove_if_safe(&import_container);
        return Err(error);
    }

    let result = (|| {
        inject_failure("after-prepared-log")?;
        if request.replace {
            let backup_container = backup_container(user_dir, transaction_id);
            create_private_directory(&backup_container)?;
            inject_failure("after-backup-container-create")?;
            let quarantined = backup_container.join(ORIGINAL_DIR);
            durable_rename(&target, &quarantined)?;
            if !quarantined_matches_baseline(&backup_container, &request.baseline)? {
                // 条件替换失败时，权威目录仍未被覆盖；先把隔离原版恢复原位。
                durable_rename_noreplace(&quarantined, &target)?;
                remove_if_safe(&backup_container)?;
                return Err(TxError::ConflictChanged(request.skill_name.clone()));
            }
            inject_failure("after-backup-rename")?;
            log.phase = TransactionPhase::BackupCreated;
            write_log_synced(user_dir, &log)?;
            inject_failure("after-backup-log")?;
        }
        durable_rename_noreplace(&prepared, &target)?;
        inject_failure("after-install-rename")?;
        log.phase = TransactionPhase::Installed;
        write_log_synced(user_dir, &log)?;
        inject_failure("after-installed-log")?;
        cleanup_completed(user_dir, &log)
    })();
    if let Err(error) = result {
        let rollback_error = rollback_one_locked(user_dir, &log).err();
        return Err(match rollback_error {
            Some(rollback) => TxError::Message(format!("{error}; 回滚失败: {rollback}")),
            None => error,
        });
    }
    Ok(())
}

fn rollback_one_locked(user_dir: &Path, log: &TransactionLog) -> Result<(), TxError> {
    let paths = Paths::new(user_dir, log);
    match log.phase {
        TransactionPhase::Prepared => {
            if log.replace && path_present(&paths.target) && !path_present(&paths.backup) {
                // 备份重命名前的普通失败，原目录仍权威。
            } else if path_present(&paths.backup) {
                if path_present(&paths.target) {
                    move_to_isolated(&paths)?;
                }
                durable_rename(&paths.backup, &paths.target)?;
            }
        }
        TransactionPhase::BackupCreated | TransactionPhase::Installed => {
            if path_present(&paths.backup) {
                if path_present(&paths.target) {
                    move_to_isolated(&paths)?;
                }
                durable_rename(&paths.backup, &paths.target)?;
            } else if log.replace {
                return Err(TxError::Message("原版本备份缺失".into()));
            } else if path_present(&paths.target) {
                remove_safe_tree_synced(&paths.target)?;
            }
        }
    }
    remove_if_safe(&paths.import_container)?;
    remove_if_safe(&paths.backup_container)?;
    remove_log_synced(user_dir, &log.transaction_id)
}

fn quarantined_matches_baseline(
    backup_container: &Path,
    expected: &TargetBaseline,
) -> Result<bool, TxError> {
    let store = BaselineStore::open_locked(backup_container)
        .map_err(|error| TxError::Message(error.to_string()))?;
    let revision = StoreRevision {
        store_id: expected.store_id.clone(),
        revision: expected.revision,
    };
    let actual = store
        .capture_locked(&revision, ORIGINAL_DIR)
        .map_err(|error| TxError::Message(error.to_string()))?;
    Ok(actual.presence == expected.presence
        && actual.target_type == expected.target_type
        && tree_matches_after_root_rename(&actual.tree_identity, &expected.tree_identity))
}

fn tree_matches_after_root_rename(
    actual: &[crate::skill_import::store::TreeIdentity],
    expected: &[crate::skill_import::store::TreeIdentity],
) -> bool {
    actual.len() == expected.len()
        && actual.iter().zip(expected).all(|(actual, expected)| {
            actual.relative_path == expected.relative_path
                && actual.entry_type == expected.entry_type
                && actual.object_a == expected.object_a
                && actual.object_b == expected.object_b
                && actual.size == expected.size
                && actual.modified_seconds == expected.modified_seconds
                && actual.modified_nanos == expected.modified_nanos
                && actual.content_sha256 == expected.content_sha256
                // rename 会合法推进根目录 ctime/change-time；后代没有被 rename，仍需
                // 完整比较 changed time，防止隔离前后的树内容竞态。
                && (actual.relative_path.is_empty()
                    || (actual.changed_seconds == expected.changed_seconds
                        && actual.changed_nanos == expected.changed_nanos))
        })
}

/// 在共享读锁内只做磁盘重新校准，不修改任何对象。返回值的顺序按 transaction id
/// 固定；内存 issue 缓存必须以 `(transaction_id, fingerprint)` 对表。
pub(crate) fn discover_locked(user_dir: &Path) -> Result<RecoveryInventory, SkillStoreError> {
    ensure_layout_readable(user_dir).map_err(tx_store_error)?;
    let mut found = BTreeMap::<String, RecoveryEntry>::new();
    let mut claimed_ids = BTreeSet::new();
    let tx_root = transactions_root(user_dir);
    for entry in read_dir_sorted_if_exists(&tx_root).map_err(tx_store_error)? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = format!("{TRANSACTIONS_DIR}/{name}");
        let raw_stem = name.strip_suffix(".json").unwrap_or(&name);
        let correlated_stem = validate_component(raw_stem, "transaction residue id")
            .is_ok()
            .then(|| raw_stem.to_string());
        let valid_stem = name
            .strip_suffix(".json")
            .filter(|id| validate_transaction_id(id).is_ok())
            .map(str::to_string);
        if let Some(id) = correlated_stem.as_deref() {
            // 损坏/短 ID 日志仍认领同 basename 的 imports/backups；否则 UI 上的
            // PreserveFiles 只能移动日志，随后会留下第二个无法解释的孤儿 issue。
            claimed_ids.insert(id.to_string());
        }
        if let Some(id) = valid_stem.as_deref() {
            if let Ok(log) = read_log(&entry.path(), id) {
                let candidates = inspect_candidates(user_dir, &log);
                let issue = classify_issue(&log, &candidates);
                found.insert(
                    id.to_string(),
                    RecoveryEntry {
                        transaction_id: id.to_string(),
                        fingerprint: candidates.fingerprint,
                        issue,
                        kind: RecoveryKind::Logged(log),
                    },
                );
                continue;
            }
        }

        let mut residues = vec![residue_for_path(
            user_dir,
            entry.path(),
            relative.clone(),
            "transaction-entry".into(),
        )
        .map_err(tx_store_error)?];
        if let Some(id) = correlated_stem.as_deref() {
            for (path, relative, destination) in [
                (
                    import_container(user_dir, id),
                    format!("{IMPORTS_DIR}/{id}"),
                    "imports".to_string(),
                ),
                (
                    backup_container(user_dir, id),
                    format!("{BACKUPS_DIR}/{id}"),
                    "backups".to_string(),
                ),
            ] {
                if path_present(&path) {
                    residues.push(
                        residue_for_path(user_dir, path, relative, destination)
                            .map_err(tx_store_error)?,
                    );
                }
            }
        }
        // malformed entry 没有可信任 transaction id。恢复 ID 同时绑定安全相对路径
        // 和当前对象/树 stable identity；同一对象重试稳定，新对象复用原路径时换 ID。
        let recovery_id = recovery_id_for_residues(&relative, &residues);
        let fingerprint = residues_fingerprint(&residues);
        let issue = generic_issue(
            &recovery_id,
            Some(relative),
            "事务日志名称、类型或内容损坏",
            true,
        );
        found.insert(
            recovery_id.clone(),
            RecoveryEntry {
                transaction_id: recovery_id,
                fingerprint,
                issue: Some(issue),
                kind: RecoveryKind::Malformed { residues },
            },
        );
    }

    for (root, prefix, destination) in [
        (imports_root(user_dir), IMPORTS_DIR, "imports"),
        (backups_root(user_dir), BACKUPS_DIR, "backups"),
    ] {
        for entry in read_dir_sorted_if_exists(&root).map_err(tx_store_error)? {
            let name = entry.file_name().to_string_lossy().into_owned();
            if claimed_ids.contains(&name) {
                continue;
            }
            let relative = format!("{prefix}/{name}");
            let residue =
                residue_for_path(user_dir, entry.path(), relative.clone(), destination.into())
                    .map_err(tx_store_error)?;
            let recovery_id = recovery_id_for_residues(&relative, std::slice::from_ref(&residue));
            let issue = generic_issue(
                &recovery_id,
                Some(relative),
                "发现没有有效事务日志的事务残留",
                true,
            );
            found.insert(
                recovery_id.clone(),
                RecoveryEntry {
                    transaction_id: recovery_id,
                    fingerprint: residue.snapshot.tree_fingerprint.clone(),
                    issue: Some(issue),
                    kind: RecoveryKind::Malformed {
                        residues: vec![residue],
                    },
                },
            );
        }
    }

    discover_incomplete_preservations(user_dir, &mut found).map_err(tx_store_error)?;
    Ok(RecoveryInventory {
        entries: found.into_values().collect(),
    })
}

/// 调用方持有独占锁时运行一轮。每个 transaction 只尝试一次；失败被转换为带
/// 当前磁盘 fingerprint 的 issue，调用方缓存后下一轮读检查不会形成死循环。
pub(crate) fn recover_locked(user_dir: &Path) -> Result<RecoveryRun, SkillStoreError> {
    let inventory = discover_locked(user_dir)?;
    let mut run = RecoveryRun::default();
    for entry in inventory.entries {
        if let Some(issue) = entry.issue {
            run.issues
                .push((entry.transaction_id, entry.fingerprint, issue));
            continue;
        }
        let result = match &entry.kind {
            RecoveryKind::Logged(log) => recover_log_locked(user_dir, log),
            RecoveryKind::Malformed { .. } | RecoveryKind::PreserveInProgress => {
                Err(TxError::Message("事务没有可安全自动恢复的状态".into()))
            }
        };
        match result {
            Ok(changed) => run.authority_changed |= changed,
            Err(error) => {
                let refreshed = discover_locked(user_dir)?
                    .entries
                    .into_iter()
                    .find(|candidate| candidate.transaction_id == entry.transaction_id);
                let (fingerprint, mut issue) = refreshed
                    .map(|candidate| {
                        let issue = candidate.issue.unwrap_or_else(|| {
                            generic_issue(&entry.transaction_id, None, &error.to_string(), true)
                        });
                        (candidate.fingerprint, issue)
                    })
                    .unwrap_or_else(|| {
                        (
                            entry.fingerprint,
                            generic_issue(&entry.transaction_id, None, &error.to_string(), true),
                        )
                    });
                issue.error = redact_store_path(&error.to_string(), user_dir);
                run.issues.push((entry.transaction_id, fingerprint, issue));
            }
        }
    }
    run.issues.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(run)
}

fn recover_log_locked(user_dir: &Path, log: &TransactionLog) -> Result<bool, TxError> {
    inject_failure("recover-log")?;
    let paths = Paths::new(user_dir, log);
    let candidates = inspect_candidates(user_dir, log);
    let Some(plan) = automatic_plan(log, &candidates) else {
        // 非精确崩溃形状保持全部候选和日志原样，交给显式 resolve。
        return Err(TxError::Message(
            "事务阶段、候选类型或候选组合不匹配".into(),
        ));
    };
    match plan {
        AutomaticPlan::DiscardPrepared | AutomaticPlan::KeepPreparedTarget => {
            remove_if_safe(&paths.import_container)?;
            remove_log_synced(user_dir, &log.transaction_id)?;
            Ok(false)
        }
        AutomaticPlan::RestoreBackup => {
            ensure_plain_directory(&paths.import_container, true)?;
            stage_promotion_candidate(
                &paths.backup,
                &paths.quarantine,
                candidates.backup.snapshot.as_ref().expect("valid backup"),
                &format!("{BACKUPS_DIR}/{}/original", log.transaction_id),
            )?;
            promote_quarantined(
                &paths.quarantine,
                &paths.target,
                candidates.backup.snapshot.as_ref().expect("valid backup"),
                &format!("{BACKUPS_DIR}/{}/original", log.transaction_id),
            )?;
            remove_if_safe(&paths.import_container)?;
            remove_if_safe(&paths.backup_container)?;
            remove_log_synced(user_dir, &log.transaction_id)?;
            Ok(true)
        }
        AutomaticPlan::RollbackInstalled => {
            stage_promotion_candidate(
                &paths.backup,
                &paths.quarantine,
                candidates.backup.snapshot.as_ref().expect("valid backup"),
                &format!("{BACKUPS_DIR}/{}/original", log.transaction_id),
            )?;
            move_to_isolated_verified(
                &paths,
                candidates.target.snapshot.as_ref().expect("valid target"),
            )?;
            promote_quarantined(
                &paths.quarantine,
                &paths.target,
                candidates.backup.snapshot.as_ref().expect("valid backup"),
                &format!("{BACKUPS_DIR}/{}/original", log.transaction_id),
            )?;
            remove_if_safe(&paths.import_container)?;
            remove_if_safe(&paths.backup_container)?;
            remove_log_synced(user_dir, &log.transaction_id)?;
            Ok(true)
        }
        AutomaticPlan::FinishInstalled => {
            remove_if_safe(&paths.import_container)?;
            remove_if_safe(&paths.backup_container)?;
            remove_log_synced(user_dir, &log.transaction_id)?;
            Ok(false)
        }
    }
}

/// 只读规划：确认 transaction/issue/action 当前存在且可用，并绑定完整 entry
/// fingerprint。调用方必须在同一技能库独占锁内先调用本函数，成功后才能预留 revision。
pub(crate) fn plan_resolve_locked(
    user_dir: &Path,
    transaction_id: &str,
    action: SkillRecoveryAction,
    cached_issue: Option<(&str, &SkillRecoveryIssue)>,
) -> Result<ResolvePlan, SkillStoreError> {
    validate_transaction_id(transaction_id).map_err(tx_store_error)?;
    let entry = discover_locked(user_dir)?
        .entries
        .into_iter()
        .find(|entry| entry.transaction_id == transaction_id)
        .ok_or_else(|| SkillStoreError::InvalidTargetName("恢复事务已不存在".into()))?;
    // issue 必须确实存在于当前磁盘分类，或来自同 fingerprint 的本实例自动恢复
    // 失败缓存。不能仅凭一个仍可自动恢复的日志临时合成 issue 来消费 revision。
    let issue = entry.issue.clone().or_else(|| {
        cached_issue
            .filter(|(fingerprint, _)| *fingerprint == entry.fingerprint)
            .map(|(_, issue)| issue.clone())
    });
    let issue = issue.ok_or_else(|| {
        SkillStoreError::InvalidTargetName("事务没有可解决 issue，请先重新校准".into())
    })?;
    if !issue.actions.contains(&action) {
        return Err(SkillStoreError::InvalidTargetName(
            "磁盘候选已变化，所选恢复动作不再可用".into(),
        ));
    }
    Ok(ResolvePlan {
        transaction_id: transaction_id.to_string(),
        action,
        fingerprint: entry.fingerprint,
    })
}

/// revision 已成功预留后执行计划。任何移动前先重新发现并精确比较 fingerprint；
/// 若 entry 消失或发生变化，返回 CandidateChanged，调用方保留已推进 revision。
pub(crate) fn execute_resolve_plan_locked(
    config_dir: &Path,
    user_dir: &Path,
    plan: ResolvePlan,
) -> Result<ResolveOutcome, SkillStoreError> {
    let entry = discover_locked(user_dir)?
        .entries
        .into_iter()
        .find(|entry| entry.transaction_id == plan.transaction_id)
        .ok_or_else(|| SkillStoreError::CandidateChanged {
            entry_path: plan.transaction_id.clone(),
        })?;
    if entry.fingerprint != plan.fingerprint {
        return Err(SkillStoreError::CandidateChanged {
            entry_path: entry
                .issue
                .as_ref()
                .and_then(|issue| issue.entry_path.clone())
                .unwrap_or_else(|| plan.transaction_id.clone()),
        });
    }

    let outcome = match entry.kind {
        RecoveryKind::Logged(log) => resolve_log(config_dir, user_dir, &log, plan.action),
        RecoveryKind::Malformed { residues } => {
            preserve_residues(config_dir, user_dir, &plan.transaction_id, &residues)
        }
        RecoveryKind::PreserveInProgress => {
            preserve_residues(config_dir, user_dir, &plan.transaction_id, &[])
        }
    }
    .map_err(tx_store_error)?;
    Ok(outcome)
}

#[cfg(test)]
fn resolve_locked(
    config_dir: &Path,
    user_dir: &Path,
    transaction_id: &str,
    action: SkillRecoveryAction,
) -> Result<ResolveOutcome, SkillStoreError> {
    let plan = plan_resolve_locked(user_dir, transaction_id, action, None)?;
    execute_resolve_plan_locked(config_dir, user_dir, plan)
}

fn resolve_log(
    config_dir: &Path,
    user_dir: &Path,
    log: &TransactionLog,
    action: SkillRecoveryAction,
) -> Result<ResolveOutcome, TxError> {
    let candidates = inspect_candidates(user_dir, log);
    let paths = Paths::new(user_dir, log);
    match action {
        SkillRecoveryAction::RestoreBackup if candidates.backup.state == CandidateState::Valid => {
            stage_promotion_candidate(
                &paths.backup,
                &paths.quarantine,
                candidates.backup.snapshot.as_ref().expect("valid backup"),
                &format!("{BACKUPS_DIR}/{}/original", log.transaction_id),
            )?;
            if let Some(target_snapshot) = candidates.target.snapshot.as_ref() {
                move_snapshot_to_private(
                    &paths.target,
                    &paths.displaced,
                    target_snapshot,
                    "target",
                )?;
            }
            promote_quarantined(
                &paths.quarantine,
                &paths.target,
                candidates.backup.snapshot.as_ref().expect("valid backup"),
                &format!("{BACKUPS_DIR}/{}/original", log.transaction_id),
            )?;
            cleanup_completed(user_dir, log)?;
            Ok(ResolveOutcome {
                preserved_path: None,
                authority_changed: true,
            })
        }
        SkillRecoveryAction::KeepInstalled
            if candidates.target.state == CandidateState::Valid
                || candidates.isolated.state == CandidateState::Valid =>
        {
            let mut changed = false;
            if candidates.target.state != CandidateState::Valid {
                stage_promotion_candidate(
                    &paths.isolated,
                    &paths.quarantine,
                    candidates
                        .isolated
                        .snapshot
                        .as_ref()
                        .expect("valid isolated"),
                    &format!("{IMPORTS_DIR}/{}/isolated", log.transaction_id),
                )?;
                if let Some(target_snapshot) = candidates.target.snapshot.as_ref() {
                    move_snapshot_to_private(
                        &paths.target,
                        &paths.displaced,
                        target_snapshot,
                        "target",
                    )?;
                }
                promote_quarantined(
                    &paths.quarantine,
                    &paths.target,
                    candidates
                        .isolated
                        .snapshot
                        .as_ref()
                        .expect("valid isolated"),
                    &format!("{IMPORTS_DIR}/{}/isolated", log.transaction_id),
                )?;
                changed = true;
            }
            cleanup_completed(user_dir, log)?;
            Ok(ResolveOutcome {
                preserved_path: None,
                authority_changed: changed,
            })
        }
        SkillRecoveryAction::PreserveFiles
            if candidates.backup.state != CandidateState::Valid
                && candidates.target.state != CandidateState::Valid
                && candidates.isolated.state != CandidateState::Valid =>
        {
            let residues = logged_residues(user_dir, log)?;
            preserve_residues(config_dir, user_dir, &log.transaction_id, &residues)
        }
        _ => Err(TxError::Message("候选已变化，恢复动作条件不成立".into())),
    }
}

fn preserve_residues(
    config_dir: &Path,
    user_dir: &Path,
    transaction_id: &str,
    residues: &[Residue],
) -> Result<ResolveOutcome, TxError> {
    let recovery_root = config_dir.join("skill-recovery");
    ensure_plain_directory(&recovery_root, true)?;
    let destination = recovery_root.join(transaction_id);
    let mut manifest = open_or_create_preserve_manifest(&destination, transaction_id, residues)?;
    resume_preservation(user_dir, &destination, &mut manifest)?;
    manifest.complete = true;
    write_preserve_manifest(&destination, &manifest)?;
    sync_directory(&destination)?;
    sync_directory(&recovery_root)?;
    Ok(ResolveOutcome {
        // 只返回固定、安全的展示相对路径，绝不投影 config_dir。
        preserved_path: Some(format!("skill-recovery/{transaction_id}")),
        authority_changed: false,
    })
}

fn logged_residues(user_dir: &Path, log: &TransactionLog) -> Result<Vec<Residue>, TxError> {
    let paths = Paths::new(user_dir, log);
    let mut residues = Vec::new();
    for (path, relative, destination) in [
        (paths.target, log.skill_name.clone(), "target".to_string()),
        (
            paths.import_container,
            format!("{IMPORTS_DIR}/{}", log.transaction_id),
            "imports".to_string(),
        ),
        (
            paths.backup_container,
            format!("{BACKUPS_DIR}/{}", log.transaction_id),
            "backups".to_string(),
        ),
        (
            transaction_log_path(user_dir, &log.transaction_id),
            format!("{TRANSACTIONS_DIR}/{}.json", log.transaction_id),
            "transaction.json".to_string(),
        ),
    ] {
        if path_present(&path) {
            residues.push(residue_for_path(user_dir, path, relative, destination)?);
        }
    }
    Ok(residues)
}

fn open_or_create_preserve_manifest(
    destination: &Path,
    recovery_id: &str,
    residues: &[Residue],
) -> Result<PreserveManifest, TxError> {
    validate_transaction_id(recovery_id)?;
    match safe_object_state(destination)? {
        ObjectState::Missing => create_private_directory(destination)?,
        ObjectState::Directory => {}
        ObjectState::Other => {
            return Err(TxError::Message("技能恢复保留目标不是安全普通目录".into()));
        }
    }
    let manifest_path = destination.join(PRESERVE_MANIFEST);
    if path_present(&manifest_path) {
        let manifest = read_preserve_manifest(&manifest_path)?;
        if manifest.recovery_id != recovery_id {
            return Err(TxError::Message("保留 manifest recovery id 不匹配".into()));
        }
        return Ok(manifest);
    }
    if !read_dir_sorted(destination)?.is_empty() {
        return Err(TxError::Message(
            "已有保留目录缺少 manifest，拒绝覆盖其中数据".into(),
        ));
    }
    let mut names = BTreeSet::new();
    let mut entries = Vec::with_capacity(residues.len());
    for residue in residues {
        validate_relative_display(&residue.relative_path)?;
        validate_component(&residue.destination_name, "preserve destination")?;
        if !names.insert(residue.destination_name.clone()) {
            return Err(TxError::Message("保留目标名称重复".into()));
        }
        entries.push(PreserveManifestEntry {
            source_relative: residue.relative_path.clone(),
            destination_name: residue.destination_name.clone(),
            expected: residue.snapshot.clone(),
            completed: false,
        });
    }
    let manifest = PreserveManifest {
        format: PRESERVE_FORMAT,
        recovery_id: recovery_id.to_string(),
        complete: false,
        entries,
    };
    write_preserve_manifest(destination, &manifest)?;
    Ok(manifest)
}

fn resume_preservation(
    user_dir: &Path,
    destination: &Path,
    manifest: &mut PreserveManifest,
) -> Result<(), TxError> {
    for index in 0..manifest.entries.len() {
        let entry = &manifest.entries[index];
        validate_relative_display(&entry.source_relative)?;
        validate_component(&entry.destination_name, "preserve destination")?;
        let source = user_dir.join(&entry.source_relative);
        let preserved = destination.join(&entry.destination_name);
        let source_snapshot = stable_snapshot(&source)?;
        let preserved_snapshot = stable_snapshot(&preserved)?;
        match (source_snapshot.as_ref(), preserved_snapshot.as_ref()) {
            (None, Some(actual)) if actual == &entry.expected => {}
            (Some(actual), None) if actual == &entry.expected => {
                rename_verified(&source, &preserved, &entry.expected, &entry.source_relative)?;
            }
            _ => return Err(TxError::CandidateChanged(entry.source_relative.clone())),
        }
        manifest.entries[index].completed = true;
        write_preserve_manifest(destination, manifest)?;
    }
    Ok(())
}

fn write_preserve_manifest(destination: &Path, manifest: &PreserveManifest) -> Result<(), TxError> {
    if manifest.format != PRESERVE_FORMAT {
        return Err(TxError::Message("不支持的保留 manifest 格式".into()));
    }
    validate_transaction_id(&manifest.recovery_id)?;
    let bytes =
        serde_json::to_vec_pretty(manifest).map_err(|error| TxError::Message(error.to_string()))?;
    crate::config::atomic_write_private(&destination.join(PRESERVE_MANIFEST), &bytes)
        .map_err(TxError::Message)?;
    sync_directory(destination)
}

fn read_preserve_manifest(path: &Path) -> Result<PreserveManifest, TxError> {
    let metadata = fs::symlink_metadata(path)?;
    if !is_plain_file(&metadata) || metadata.len() > MAX_LOG_BYTES {
        return Err(TxError::Message(
            "保留 manifest 不是安全普通文件或超过限制".into(),
        ));
    }
    let file = open_nofollow_file(path)?;
    if !opened_file_still_at_path(path, &file)? {
        return Err(TxError::CandidateChanged(PRESERVE_MANIFEST.into()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_LOG_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_LOG_BYTES {
        return Err(TxError::Message("保留 manifest 超过限制".into()));
    }
    let manifest: PreserveManifest = serde_json::from_slice(&bytes)
        .map_err(|error| TxError::Message(format!("解析保留 manifest 失败: {error}")))?;
    if manifest.format != PRESERVE_FORMAT {
        return Err(TxError::Message("不支持的保留 manifest 格式".into()));
    }
    validate_transaction_id(&manifest.recovery_id)?;
    Ok(manifest)
}

fn discover_incomplete_preservations(
    user_dir: &Path,
    found: &mut BTreeMap<String, RecoveryEntry>,
) -> Result<(), TxError> {
    let Some(config_dir) = user_dir.parent() else {
        return Ok(());
    };
    let recovery_root = config_dir.join("skill-recovery");
    for entry in read_dir_sorted_if_exists(&recovery_root)? {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if !is_plain_directory(&metadata) {
            continue;
        }
        let manifest_path = path.join(PRESERVE_MANIFEST);
        if !path_present(&manifest_path) {
            continue;
        }
        let manifest = match read_preserve_manifest(&manifest_path) {
            Ok(manifest) => manifest,
            Err(_) => continue,
        };
        if manifest.complete || entry.file_name().to_string_lossy() != manifest.recovery_id {
            continue;
        }
        let snapshot = stable_snapshot(&path)?
            .ok_or_else(|| TxError::CandidateChanged(manifest.recovery_id.clone()))?;
        let issue = generic_issue(
            &manifest.recovery_id,
            Some(format!(
                "skill-recovery/{}/manifest.json",
                manifest.recovery_id
            )),
            "保留恢复文件操作尚未完成，可安全重试",
            true,
        );
        found.insert(
            manifest.recovery_id.clone(),
            RecoveryEntry {
                transaction_id: manifest.recovery_id,
                fingerprint: snapshot.tree_fingerprint,
                issue: Some(issue),
                kind: RecoveryKind::PreserveInProgress,
            },
        );
    }
    Ok(())
}

/// instance lease 清理闭包使用。仅接受 `skill-import-staging` 下的一级实例目录，
/// 并且只比较日志中的安全末级组件，不信任或返回绝对来源路径。
pub(crate) fn staging_path_has_active_transaction(config_dir: &Path, instance_path: &Path) -> bool {
    let Some(instance_id) = instance_path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if validate_component(instance_id, "instance id").is_err() {
        return false;
    }
    let expected_parent = config_dir.join("skill-import-staging");
    if instance_path.parent() != Some(expected_parent.as_path()) {
        return false;
    }
    let tx_root = config_dir.join("skills").join(TRANSACTIONS_DIR);
    let Ok(entries) = read_dir_sorted(&tx_root) else {
        return false;
    };
    entries.into_iter().any(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".json") else {
            return false;
        };
        read_log(&entry.path(), id)
            .ok()
            .and_then(|log| log.staging_instance_id)
            .as_deref()
            == Some(instance_id)
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AutomaticPlan {
    DiscardPrepared,
    KeepPreparedTarget,
    RestoreBackup,
    RollbackInstalled,
    FinishInstalled,
}

fn automatic_plan(log: &TransactionLog, candidates: &Candidates) -> Option<AutomaticPlan> {
    use CandidateState::{Missing as M, Valid as V};
    if !candidates.layout_clean {
        return None;
    }
    let states = (
        candidates.target.state,
        candidates.prepared.state,
        candidates.backup.state,
        candidates.isolated.state,
        candidates.quarantine.state,
        candidates.displaced.state,
    );
    match (log.phase, log.replace, states) {
        (TransactionPhase::Prepared, false, (M, V, M, M, M, M)) => {
            Some(AutomaticPlan::DiscardPrepared)
        }
        (TransactionPhase::Prepared, false, (V, M, M, M, M, M)) => {
            Some(AutomaticPlan::KeepPreparedTarget)
        }
        (TransactionPhase::Prepared, true, (V, V, M, M, M, M)) => {
            Some(AutomaticPlan::DiscardPrepared)
        }
        (TransactionPhase::Prepared, true, (M, V, V, M, M, M)) => {
            Some(AutomaticPlan::RestoreBackup)
        }
        (TransactionPhase::BackupCreated, true, (M, V, V, M, M, M)) => {
            Some(AutomaticPlan::RestoreBackup)
        }
        (TransactionPhase::BackupCreated, true, (V, M, V, M, M, M)) => {
            Some(AutomaticPlan::RollbackInstalled)
        }
        (TransactionPhase::Installed, _, (V, M, M | V, M, M, M)) => {
            Some(AutomaticPlan::FinishInstalled)
        }
        (TransactionPhase::Installed, true, (M, M, V, M, M, M)) => {
            Some(AutomaticPlan::RestoreBackup)
        }
        _ => None,
    }
}

fn classify_issue(log: &TransactionLog, candidates: &Candidates) -> Option<SkillRecoveryIssue> {
    automatic_plan(log, candidates)
        .is_none()
        .then(|| issue_for(log, candidates, "事务阶段、候选类型或候选组合不匹配"))
}

fn issue_for(log: &TransactionLog, candidates: &Candidates, error: &str) -> SkillRecoveryIssue {
    let backup_available = candidates.backup.valid();
    let installed_available = candidates.target.valid() || candidates.isolated.valid();
    let mut actions = Vec::new();
    if backup_available {
        actions.push(SkillRecoveryAction::RestoreBackup);
    }
    if installed_available {
        actions.push(SkillRecoveryAction::KeepInstalled);
    }
    if !backup_available && !installed_available {
        actions.push(SkillRecoveryAction::PreserveFiles);
    }
    SkillRecoveryIssue {
        transaction_id: log.transaction_id.clone(),
        entry_path: Some(format!("{TRANSACTIONS_DIR}/{}.json", log.transaction_id)),
        skill_name: log.skill_name.clone(),
        portable_name_key: log.portable_name_key.clone(),
        backup_available,
        installed_available,
        isolated_available: candidates.isolated.valid(),
        authoritative_target_missing: !candidates.target.valid(),
        actions,
        error: error.into(),
    }
}

fn generic_issue(
    transaction_id: &str,
    entry_path: Option<String>,
    error: &str,
    preserve: bool,
) -> SkillRecoveryIssue {
    SkillRecoveryIssue {
        transaction_id: transaction_id.to_string(),
        entry_path,
        skill_name: String::new(),
        portable_name_key: String::new(),
        backup_available: false,
        installed_available: false,
        isolated_available: false,
        authoritative_target_missing: true,
        actions: preserve
            .then_some(SkillRecoveryAction::PreserveFiles)
            .into_iter()
            .collect(),
        error: error.into(),
    }
}

struct Paths {
    target: PathBuf,
    import_container: PathBuf,
    prepared: PathBuf,
    isolated: PathBuf,
    quarantine: PathBuf,
    displaced: PathBuf,
    backup_container: PathBuf,
    backup: PathBuf,
}

impl Paths {
    fn new(user_dir: &Path, log: &TransactionLog) -> Self {
        let import_container = import_container(user_dir, &log.transaction_id);
        let backup_container = backup_container(user_dir, &log.transaction_id);
        Self {
            target: user_dir.join(&log.skill_name),
            prepared: import_container.join(PREPARED_DIR),
            isolated: import_container.join(ISOLATED_DIR),
            quarantine: import_container.join(QUARANTINE_DIR),
            displaced: import_container.join(DISPLACED_DIR),
            backup: backup_container.join(ORIGINAL_DIR),
            import_container,
            backup_container,
        }
    }
}

fn inspect_candidates(user_dir: &Path, log: &TransactionLog) -> Candidates {
    let paths = Paths::new(user_dir, log);
    let target = inspect_candidate(&paths.target, &log.skill_name);
    let prepared = inspect_candidate(&paths.prepared, &log.skill_name);
    let backup = inspect_candidate(&paths.backup, &log.skill_name);
    let isolated = inspect_candidate(&paths.isolated, &log.skill_name);
    let quarantine = inspect_candidate(&paths.quarantine, &log.skill_name);
    let displaced = inspect_candidate(&paths.displaced, &log.skill_name);
    let layout_clean = container_has_only(
        &paths.import_container,
        &[PREPARED_DIR, ISOLATED_DIR, QUARANTINE_DIR, DISPLACED_DIR],
    ) && container_has_only(&paths.backup_container, &[ORIGINAL_DIR]);
    let mut digest = Sha256::new();
    digest.update(serde_json::to_vec(log).unwrap_or_default());
    for (label, candidate) in [
        ("target", &target),
        ("prepared", &prepared),
        ("backup", &backup),
        ("isolated", &isolated),
        ("quarantine", &quarantine),
        ("displaced", &displaced),
    ] {
        digest.update(label.as_bytes());
        digest.update([candidate.state as u8]);
        if let Some(snapshot) = &candidate.snapshot {
            digest.update(serde_json::to_vec(snapshot).unwrap_or_default());
        }
    }
    digest.update([layout_clean as u8]);
    Candidates {
        target,
        prepared,
        backup,
        isolated,
        quarantine,
        displaced,
        layout_clean,
        fingerprint: format!("{:x}", digest.finalize()),
    }
}

fn container_has_only(path: &Path, allowed: &[&str]) -> bool {
    match safe_object_state(path) {
        Ok(ObjectState::Missing) => true,
        Ok(ObjectState::Directory) => read_dir_sorted(path).is_ok_and(|entries| {
            entries.iter().all(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| allowed.contains(&name))
            })
        }),
        Ok(ObjectState::Other) | Err(_) => false,
    }
}

fn inspect_candidate(path: &Path, expected_name: &str) -> Candidate {
    match stable_snapshot(path) {
        Ok(None) => Candidate {
            state: CandidateState::Missing,
            snapshot: None,
        },
        Ok(Some(snapshot)) => Candidate {
            state: if snapshot.object_type == StableObjectType::Directory
                && validate_skill_candidate(path, expected_name).is_ok()
            {
                CandidateState::Valid
            } else {
                CandidateState::Unsafe
            },
            snapshot: Some(snapshot),
        },
        Err(_) => Candidate {
            state: CandidateState::Unsafe,
            snapshot: None,
        },
    }
}

fn validate_skill_candidate(path: &Path, expected_name: &str) -> Result<(), TxError> {
    validate_tree(path)?;
    let skill_md = path.join(SKILL_MD);
    let metadata = fs::symlink_metadata(&skill_md)
        .map_err(|error| TxError::Message(format!("候选缺失 SKILL.md: {error}")))?;
    if !is_plain_file(&metadata) || metadata.len() > crate::skill_import::model::MAX_SKILL_MD_BYTES
    {
        return Err(TxError::Message(
            "候选 SKILL.md 不是安全普通文件或超过限制".into(),
        ));
    }
    let text = fs::read_to_string(&skill_md)
        .map_err(|error| TxError::Message(format!("读取候选 SKILL.md 失败: {error}")))?;
    let metadata = crate::skills::resolve_import_skill_metadata(&text, expected_name)
        .map_err(TxError::Message)?;
    if metadata.name != expected_name {
        return Err(TxError::Message("候选技能名与事务目标不一致".into()));
    }
    Ok(())
}

fn validate_tree(root: &Path) -> Result<(), TxError> {
    let metadata = fs::symlink_metadata(root)?;
    if !is_plain_directory(&metadata) {
        return Err(TxError::Message("候选根不是普通目录或是重解析对象".into()));
    }
    let mut entries = read_dir_sorted(root)?;
    for entry in entries.drain(..) {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if is_plain_directory(&metadata) {
            validate_tree(&path)?;
        } else if is_plain_file(&metadata) {
            // 打开后再次按句柄 metadata 复核，Unix 还使用 O_NOFOLLOW。
            let file = open_nofollow_file(&path)?;
            let opened = file.metadata()?;
            if !is_plain_file(&opened) || !opened_file_still_at_path(&path, &file)? {
                return Err(TxError::Message("候选文件在检查期间被替换".into()));
            }
        } else {
            return Err(TxError::Message(
                "候选树包含链接、重解析点或特殊文件".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
fn copy_skill_tree_synced(
    source: &Path,
    destination: &Path,
    expected: &str,
) -> Result<(), TxError> {
    validate_skill_candidate(source, expected)?;
    copy_tree(source, destination)?;
    validate_skill_candidate(destination, expected)
}

#[cfg(test)]
fn copy_tree(source: &Path, destination: &Path) -> Result<(), TxError> {
    create_private_directory(destination)?;
    for entry in read_dir_sorted(source)? {
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)?;
        if is_plain_directory(&metadata) {
            copy_tree(&source_path, &destination_path)?;
        } else if is_plain_file(&metadata) {
            let mut input = open_nofollow_file(&source_path)?;
            if !opened_file_still_at_path(&source_path, &input)? {
                return Err(TxError::Message("来源文件在复制前被替换".into()));
            }
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt as _;
                options.mode(0o600);
            }
            let mut output = options.open(&destination_path)?;
            io::copy(&mut input, &mut output)?;
            output.sync_all()?;
            if !opened_file_still_at_path(&source_path, &input)? {
                return Err(TxError::Message("来源文件在复制期间被替换".into()));
            }
        } else {
            return Err(TxError::Message("来源包含链接、重解析点或特殊文件".into()));
        }
    }
    sync_directory(destination)
}

fn move_to_isolated(paths: &Paths) -> Result<(), TxError> {
    ensure_plain_directory(&paths.import_container, true)?;
    if path_present(&paths.isolated) {
        return Err(TxError::Message("隔离候选已存在，拒绝覆盖".into()));
    }
    durable_rename(&paths.target, &paths.isolated)
}

fn move_to_isolated_verified(paths: &Paths, expected: &StableSnapshot) -> Result<(), TxError> {
    ensure_plain_directory(&paths.import_container, true)?;
    move_snapshot_to_private(&paths.target, &paths.isolated, expected, "target")
}

fn cleanup_completed(user_dir: &Path, log: &TransactionLog) -> Result<(), TxError> {
    let paths = Paths::new(user_dir, log);
    remove_if_safe(&paths.import_container)?;
    remove_if_safe(&paths.backup_container)?;
    remove_log_synced(user_dir, &log.transaction_id)
}

fn write_log_synced(user_dir: &Path, log: &TransactionLog) -> Result<(), TxError> {
    validate_log(log)?;
    let path = transaction_log_path(user_dir, &log.transaction_id);
    let bytes =
        serde_json::to_vec_pretty(log).map_err(|error| TxError::Message(error.to_string()))?;
    crate::config::atomic_write_private(&path, &bytes).map_err(TxError::Message)?;
    let metadata = fs::symlink_metadata(&path)?;
    if !is_plain_file(&metadata) {
        return Err(TxError::Message("事务日志不是普通文件".into()));
    }
    sync_directory(&transactions_root(user_dir))
}

fn read_log(path: &Path, expected_id: &str) -> Result<TransactionLog, TxError> {
    validate_transaction_id(expected_id)?;
    let metadata = fs::symlink_metadata(path)?;
    if !is_plain_file(&metadata) || metadata.len() > MAX_LOG_BYTES {
        return Err(TxError::Message("日志不是安全普通文件或超过限制".into()));
    }
    let file = open_nofollow_file(path)?;
    if !opened_file_still_at_path(path, &file)? {
        return Err(TxError::Message("日志在打开期间被替换".into()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_LOG_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_LOG_BYTES {
        return Err(TxError::Message("事务日志超过限制".into()));
    }
    let log: TransactionLog = serde_json::from_slice(&bytes)
        .map_err(|error| TxError::Message(format!("解析事务日志失败: {error}")))?;
    if log.transaction_id != expected_id {
        return Err(TxError::Message(
            "日志 transaction id 与文件名不一致".into(),
        ));
    }
    validate_log(&log)?;
    Ok(log)
}

fn validate_log(log: &TransactionLog) -> Result<(), TxError> {
    if log.format != LOG_FORMAT {
        return Err(TxError::Message("不支持的事务日志格式".into()));
    }
    validate_transaction_id(&log.transaction_id)?;
    let key = crate::skills::portable_skill_name_key(&log.skill_name)
        .ok_or_else(|| TxError::Message("日志技能名不安全".into()))?;
    if key != log.portable_name_key {
        return Err(TxError::Message("日志可移植名称键不匹配".into()));
    }
    if let Some(instance_id) = log.staging_instance_id.as_deref() {
        validate_component(instance_id, "staging instance id")?;
    }
    Ok(())
}

fn ensure_layout(user_dir: &Path) -> Result<(), TxError> {
    ensure_plain_directory(user_dir, true)?;
    for path in [
        imports_root(user_dir),
        backups_root(user_dir),
        transactions_root(user_dir),
    ] {
        ensure_plain_directory(&path, true)?;
    }
    Ok(())
}

fn ensure_layout_readable(user_dir: &Path) -> Result<(), TxError> {
    ensure_plain_directory(user_dir, false)?;
    for path in [
        imports_root(user_dir),
        backups_root(user_dir),
        transactions_root(user_dir),
    ] {
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
            Ok(metadata) if is_plain_directory(&metadata) => {}
            Ok(_) => {
                return Err(TxError::Message(format!(
                    "{} 不是安全普通目录",
                    path.display()
                )))
            }
        }
    }
    Ok(())
}

fn ensure_plain_directory(path: &Path, create: bool) -> Result<(), TxError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if is_plain_directory(&metadata) => Ok(()),
        Ok(_) => Err(TxError::Message(format!(
            "{} 不是安全普通目录",
            path.display()
        ))),
        Err(error) if error.kind() == io::ErrorKind::NotFound && create => {
            let parent = path
                .parent()
                .ok_or_else(|| TxError::Message("目录没有父级".into()))?;
            if parent != path {
                let parent_meta = fs::symlink_metadata(parent)?;
                if !is_plain_directory(&parent_meta) {
                    return Err(TxError::Message("待创建目录的父级不安全".into()));
                }
            }
            match fs::create_dir(path) {
                Ok(()) => {
                    sync_directory(parent)?;
                    Ok(())
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    let metadata = fs::symlink_metadata(path)?;
                    if is_plain_directory(&metadata) {
                        Ok(())
                    } else {
                        Err(TxError::Message("并发创建了不安全目录对象".into()))
                    }
                }
                Err(error) => Err(error.into()),
            }
        }
        Err(error) => Err(error.into()),
    }
}

fn create_private_directory(path: &Path) -> Result<(), TxError> {
    let parent = path
        .parent()
        .ok_or_else(|| TxError::Message("目录没有父级".into()))?;
    ensure_plain_directory(parent, false)?;
    #[allow(unused_mut)]
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt as _;
        builder.mode(0o700);
    }
    builder.create(path)?;
    sync_directory(parent)
}

fn durable_rename(from: &Path, to: &Path) -> Result<(), TxError> {
    let expected = stable_snapshot(from)?
        .ok_or_else(|| TxError::CandidateChanged(safe_relative_display(from)))?;
    rename_verified(from, to, &expected, &safe_relative_display(from))
}

fn durable_rename_noreplace(from: &Path, to: &Path) -> Result<(), TxError> {
    // rename_verified 的平台后端使用 no-replace/ReplaceIfExists=false；单独命名此
    // 入口强调 authority promotion 不允许覆盖在检查后出现的目标。
    durable_rename(from, to)
}

/// 把非权威候选先移动到事务私有 quarantine 并在固定父句柄 rename 后复核。
/// 只有复核仍为同一对象时，调用方才能继续把 quarantine promotion 为权威目标。
fn stage_promotion_candidate(
    from: &Path,
    quarantine: &Path,
    expected: &StableSnapshot,
    entry_path: &str,
) -> Result<(), TxError> {
    let parent = quarantine
        .parent()
        .ok_or_else(|| TxError::Message("quarantine 没有父级".into()))?;
    ensure_plain_directory(parent, true)?;
    rename_verified(from, quarantine, expected, entry_path)
}

fn promote_quarantined(
    quarantine: &Path,
    target: &Path,
    expected: &StableSnapshot,
    entry_path: &str,
) -> Result<(), TxError> {
    if stable_snapshot(quarantine)?.as_ref() != Some(expected) {
        return Err(TxError::CandidateChanged(entry_path.into()));
    }
    rename_verified(quarantine, target, expected, entry_path)
}

fn move_snapshot_to_private(
    from: &Path,
    private: &Path,
    expected: &StableSnapshot,
    entry_path: &str,
) -> Result<(), TxError> {
    let parent = private
        .parent()
        .ok_or_else(|| TxError::Message("私有隔离目标没有父级".into()))?;
    ensure_plain_directory(parent, true)?;
    rename_verified(from, private, expected, entry_path)
}

fn rename_verified(
    from: &Path,
    to: &Path,
    expected: &StableSnapshot,
    entry_path: &str,
) -> Result<(), TxError> {
    let from_parent = from
        .parent()
        .ok_or_else(|| TxError::Message("来源没有父级".into()))?;
    let to_parent = to
        .parent()
        .ok_or_else(|| TxError::Message("目标没有父级".into()))?;
    ensure_plain_directory(from_parent, false)?;
    ensure_plain_directory(to_parent, false)?;
    if stable_snapshot(from)?.as_ref() != Some(expected) || path_present(to) {
        return Err(TxError::CandidateChanged(entry_path.into()));
    }
    fixed_parent_rename(from, to)?;
    sync_directory(from_parent)?;
    if from_parent != to_parent {
        sync_directory(to_parent)?;
    }
    if stable_snapshot(to)?.as_ref() != Some(expected) {
        // 目标复核失败时只尝试把同一移动对象恢复原位；绝不继续 promotion。
        if !path_present(from) {
            let _ = fixed_parent_rename(to, from);
            let _ = sync_directory(from_parent);
            let _ = sync_directory(to_parent);
        }
        return Err(TxError::CandidateChanged(entry_path.into()));
    }
    Ok(())
}

#[cfg(unix)]
fn fixed_parent_rename(from: &Path, to: &Path) -> Result<(), TxError> {
    use rustix::fs::{openat, renameat_with, Mode, OFlags, RenameFlags, CWD};
    let from_parent = from
        .parent()
        .ok_or_else(|| TxError::Message("来源没有父级".into()))?;
    let to_parent = to
        .parent()
        .ok_or_else(|| TxError::Message("目标没有父级".into()))?;
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let map_errno = |error: rustix::io::Errno| {
        TxError::from(io::Error::from_raw_os_error(error.raw_os_error()))
    };
    let from_fd = openat(CWD, from_parent, flags, Mode::empty()).map_err(map_errno)?;
    let to_fd = openat(CWD, to_parent, flags, Mode::empty()).map_err(map_errno)?;
    let from_name = from
        .file_name()
        .ok_or_else(|| TxError::Message("来源名缺失".into()))?;
    let to_name = to
        .file_name()
        .ok_or_else(|| TxError::Message("目标名缺失".into()))?;
    renameat_with(&from_fd, from_name, &to_fd, to_name, RenameFlags::NOREPLACE)
        .map_err(map_errno)?;
    Ok(())
}

#[cfg(windows)]
fn fixed_parent_rename(from: &Path, to: &Path) -> Result<(), TxError> {
    // Windows 先打开源对象与目标父目录句柄；SetFileInformationByHandle 的
    // FILE_RENAME_INFO.RootDirectory 让最终 rename 相对固定父句柄完成。
    windows_handle_rename(from, to).map_err(TxError::from)
}

#[cfg(windows)]
fn windows_handle_rename(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileRenameInfo, SetFileInformationByHandle, FILE_RENAME_INFO,
    };
    let source = open_windows_rename_handle(from, false)?;
    let parent = open_windows_rename_handle(
        to.parent()
            .ok_or_else(|| io::Error::other("目标父级缺失"))?,
        true,
    )?;
    let name = to
        .file_name()
        .ok_or_else(|| io::Error::other("目标名缺失"))?
        .encode_wide()
        .collect::<Vec<_>>();
    let base = std::mem::size_of::<FILE_RENAME_INFO>();
    let bytes = base + name.len().saturating_sub(1) * std::mem::size_of::<u16>();
    // FILE_RENAME_INFO 含 HANDLE，必须按指针对齐，不能把 Vec<u8> 直接强转。
    let words = bytes.div_ceil(std::mem::size_of::<usize>());
    let mut buffer = vec![0usize; words];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    unsafe {
        // windows 0.61 将 ReplaceIfExists/Flags 表达为 Anonymous union；Flags=0
        // 即不覆盖已有目标，也不启用任何 FILE_RENAME_FLAG_* 扩展语义。
        (*info).Anonymous.Flags = 0;
        (*info).RootDirectory = HANDLE(parent.as_raw_handle());
        (*info).FileNameLength = (name.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(name.as_ptr(), (*info).FileName.as_mut_ptr(), name.len());
        SetFileInformationByHandle(
            HANDLE(source.as_raw_handle()),
            FileRenameInfo,
            info.cast::<core::ffi::c_void>() as *const core::ffi::c_void,
            bytes as u32,
        )
        .map_err(io::Error::other)
    }
}

#[cfg(windows)]
fn open_windows_rename_handle(path: &Path, directory: bool) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use windows::Win32::Storage::FileSystem::{
        DELETE, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    let mut options = OpenOptions::new();
    options
        .access_mode(DELETE.0)
        .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0 | FILE_SHARE_DELETE.0)
        .custom_flags(
            FILE_FLAG_OPEN_REPARSE_POINT.0
                | if directory {
                    FILE_FLAG_BACKUP_SEMANTICS.0
                } else {
                    0
                },
        );
    options.open(path)
}

#[cfg(not(any(unix, windows)))]
fn fixed_parent_rename(_from: &Path, _to: &Path) -> Result<(), TxError> {
    Err(TxError::Message("当前平台不支持固定父句柄 rename".into()))
}

fn remove_if_safe(path: &Path) -> Result<(), TxError> {
    match safe_object_state(path)? {
        ObjectState::Missing => Ok(()),
        ObjectState::Directory => remove_safe_tree_synced(path),
        ObjectState::Other => Err(TxError::Message(format!(
            "拒绝清理不安全对象: {}",
            path.display()
        ))),
    }
}

fn remove_safe_tree_synced(path: &Path) -> Result<(), TxError> {
    validate_tree(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| TxError::Message("删除目标没有父级".into()))?;
    fs::remove_dir_all(path)?;
    sync_directory(parent)
}

fn remove_log_synced(user_dir: &Path, transaction_id: &str) -> Result<(), TxError> {
    let path = transaction_log_path(user_dir, transaction_id);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
        Ok(metadata) if !is_plain_file(&metadata) => {
            return Err(TxError::Message("拒绝删除不安全事务日志".into()));
        }
        Ok(_) => fs::remove_file(&path)?,
    }
    sync_directory(&transactions_root(user_dir))
}

fn sync_directory(path: &Path) -> Result<(), TxError> {
    #[cfg(test)]
    DIRECTORY_SYNC_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
        Ok(())
    }
    #[cfg(windows)]
    {
        // 文件写使用 sync_all，重命名使用 MOVEFILE_WRITE_THROUGH。Windows 不保证
        // 普通目录句柄的 FlushFileBuffers，因此这里不伪造失败的目录 fsync。
        let _ = path;
        Ok(())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        Err(TxError::Message("当前平台不支持事务目录同步".into()))
    }
}

fn open_nofollow_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
        };
        options
            .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_DELETE.0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0);
    }
    options.open(path)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ObjectState {
    Missing,
    Directory,
    Other,
}

fn path_present(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn safe_object_state(path: &Path) -> Result<ObjectState, TxError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(ObjectState::Missing),
        Err(error) => Err(error.into()),
        Ok(metadata) if is_plain_directory(&metadata) => Ok(ObjectState::Directory),
        Ok(_) => Ok(ObjectState::Other),
    }
}

fn is_plain_directory(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_dir() && !is_reparse(metadata)
}

fn is_plain_file(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_file() && !is_reparse(metadata)
}

#[cfg(windows)]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
}

#[cfg(not(windows))]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(unix)]
fn same_object(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt as _;
    left.dev() == right.dev() && left.ino() == right.ino() && left.file_type() == right.file_type()
}

#[cfg(not(any(unix, windows)))]
fn same_object(_left: &fs::Metadata, _right: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn opened_file_still_at_path(path: &Path, file: &File) -> io::Result<bool> {
    Ok(same_object(&fs::symlink_metadata(path)?, &file.metadata()?))
}

#[cfg(windows)]
fn opened_file_still_at_path(path: &Path, file: &File) -> io::Result<bool> {
    let current = open_windows_identity_handle(path, false)?;
    Ok(windows_handle_identity(file)? == windows_handle_identity(&current)?)
}

#[cfg(not(any(unix, windows)))]
fn opened_file_still_at_path(_path: &Path, _file: &File) -> io::Result<bool> {
    Ok(false)
}

#[cfg(not(windows))]
fn stable_snapshot(path: &Path) -> Result<Option<StableSnapshot>, TxError> {
    let before = match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
        Ok(metadata) => metadata,
    };
    let first_fingerprint = fingerprint_path(path);
    let after = fs::symlink_metadata(path)?;
    let second_fingerprint = fingerprint_path(path);
    if !same_object(&before, &after) || first_fingerprint != second_fingerprint {
        return Err(TxError::CandidateChanged(safe_relative_display(path)));
    }
    let (object_a, object_b) = metadata_identity(&before);
    Ok(Some(StableSnapshot {
        object_type: if is_plain_directory(&before) {
            StableObjectType::Directory
        } else if is_plain_file(&before) {
            StableObjectType::File
        } else {
            StableObjectType::Other
        },
        object_a,
        object_b,
        tree_fingerprint: first_fingerprint,
    }))
}

#[cfg(windows)]
fn stable_snapshot(path: &Path) -> Result<Option<StableSnapshot>, TxError> {
    let before = match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
        Ok(metadata) => metadata,
    };
    let fixed = open_windows_identity_handle(path, before.file_type().is_dir())?;
    let fixed_identity = windows_handle_identity(&fixed)?;
    let first_fingerprint = fingerprint_path(path);
    let after = fs::symlink_metadata(path)?;
    let current = open_windows_identity_handle(path, after.file_type().is_dir())?;
    let current_identity = windows_handle_identity(&current)?;
    let second_fingerprint = fingerprint_path(path);
    if fixed_identity != current_identity
        || before.file_type() != after.file_type()
        || first_fingerprint != second_fingerprint
    {
        return Err(TxError::CandidateChanged(safe_relative_display(path)));
    }
    Ok(Some(StableSnapshot {
        object_type: if is_plain_directory(&before) {
            StableObjectType::Directory
        } else if is_plain_file(&before) {
            StableObjectType::File
        } else {
            StableObjectType::Other
        },
        object_a: fixed_identity.0,
        object_b: fixed_identity.1,
        tree_fingerprint: first_fingerprint,
    }))
}

#[cfg(windows)]
fn open_windows_identity_handle(path: &Path, directory: bool) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    let mut options = OpenOptions::new();
    options
        .read(true)
        .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0 | FILE_SHARE_DELETE.0)
        .custom_flags(
            FILE_FLAG_OPEN_REPARSE_POINT.0
                | if directory {
                    FILE_FLAG_BACKUP_SEMANTICS.0
                } else {
                    0
                },
        );
    options.open(path)
}

#[cfg(windows)]
fn windows_handle_identity(file: &File) -> io::Result<(u64, u64)> {
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT,
    };
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut information) }
        .map_err(io::Error::other)?;
    if information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err(io::Error::other("事务候选句柄是 reparse point"));
    }
    Ok((
        information.dwVolumeSerialNumber as u64,
        ((information.nFileIndexHigh as u64) << 32) | information.nFileIndexLow as u64,
    ))
}

#[cfg(unix)]
fn metadata_identity(metadata: &fs::Metadata) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt as _;
    (metadata.dev(), metadata.ino())
}

#[cfg(not(any(unix, windows)))]
fn metadata_identity(_metadata: &fs::Metadata) -> (u64, u64) {
    (0, 0)
}

fn residue_for_path(
    user_dir: &Path,
    path: PathBuf,
    relative_path: String,
    destination_name: String,
) -> Result<Residue, TxError> {
    validate_relative_display(&relative_path)?;
    let snapshot =
        stable_snapshot(&path)?.ok_or_else(|| TxError::CandidateChanged(relative_path.clone()))?;
    if !path.starts_with(user_dir) {
        return Err(TxError::Message("事务残留不在技能库内".into()));
    }
    Ok(Residue {
        relative_path,
        destination_name,
        snapshot,
    })
}

fn residues_fingerprint(residues: &[Residue]) -> String {
    let mut digest = Sha256::new();
    for residue in residues {
        digest.update(residue.relative_path.as_bytes());
        digest.update(serde_json::to_vec(&residue.snapshot).unwrap_or_default());
    }
    format!("{:x}", digest.finalize())
}

fn recovery_id_for_residues(relative_path: &str, residues: &[Residue]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"skill-recovery-malformed-v2\0");
    digest.update(relative_path.as_bytes());
    digest.update([0]);
    digest.update(residues_fingerprint(residues).as_bytes());
    let digest = format!("{:x}", digest.finalize());
    digest[..32].to_string()
}

fn validate_relative_display(relative: &str) -> Result<(), TxError> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path.components().any(|component| {
            !matches!(component, Component::Normal(_))
                || component.as_os_str().to_string_lossy().is_empty()
        })
    {
        return Err(TxError::Message("恢复 entry path 不是安全相对路径".into()));
    }
    Ok(())
}

fn safe_relative_display(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "candidate".into())
}

fn read_dir_sorted(path: &Path) -> Result<Vec<fs::DirEntry>, TxError> {
    let mut entries = fs::read_dir(path)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    Ok(entries)
}

fn read_dir_sorted_if_exists(path: &Path) -> Result<Vec<fs::DirEntry>, TxError> {
    match read_dir_sorted(path) {
        Ok(entries) => Ok(entries),
        Err(TxError::Message(message))
            if fs::symlink_metadata(path)
                .is_err_and(|error| error.kind() == io::ErrorKind::NotFound) =>
        {
            let _ = message;
            Ok(Vec::new())
        }
        Err(error) => Err(error),
    }
}

fn fingerprint_path(path: &Path) -> String {
    let mut digest = Sha256::new();
    fn walk(path: &Path, digest: &mut Sha256, include_name: bool) {
        match fs::symlink_metadata(path) {
            Err(error) => digest.update(format!("missing:{:?}", error.kind()).as_bytes()),
            Ok(metadata) => {
                // 根候选会在 quarantine/promotion 时改名；根名不是对象内容的一部分。
                // 后代名称仍参与 hash，避免树内 rename 被误判为同一候选。
                if include_name {
                    digest.update(
                        path.file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .as_bytes(),
                    );
                }
                digest.update(metadata.len().to_le_bytes());
                if is_plain_directory(&metadata) {
                    if let Ok(entries) = read_dir_sorted(path) {
                        for entry in entries {
                            walk(&entry.path(), digest, true);
                        }
                    }
                } else if is_plain_file(&metadata) {
                    if let Ok(mut file) = open_nofollow_file(path) {
                        let mut buffer = [0u8; 8192];
                        loop {
                            match file.read(&mut buffer) {
                                Ok(0) | Err(_) => break,
                                Ok(read) => digest.update(&buffer[..read]),
                            }
                        }
                    }
                } else {
                    digest.update(b"unsafe");
                }
            }
        }
    }
    walk(path, &mut digest, false);
    format!("{:x}", digest.finalize())
}

fn validate_transaction_id(id: &str) -> Result<(), TxError> {
    if id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(TxError::Message("transaction id 格式非法".into()))
    }
}

fn validate_component(value: &str, label: &str) -> Result<(), TxError> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > 128
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
        || value == "."
        || value == ".."
    {
        Err(TxError::Message(format!("{label} 不是安全单段组件")))
    } else {
        Ok(())
    }
}

fn redact_store_path(message: &str, user_dir: &Path) -> String {
    let absolute = user_dir.to_string_lossy();
    if absolute.is_empty() {
        message.to_string()
    } else {
        message.replace(absolute.as_ref(), "skills")
    }
}

fn generate_transaction_id() -> Result<String, TxError> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|error| TxError::Message(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn imports_root(user_dir: &Path) -> PathBuf {
    user_dir.join(IMPORTS_DIR)
}
fn backups_root(user_dir: &Path) -> PathBuf {
    user_dir.join(BACKUPS_DIR)
}
fn transactions_root(user_dir: &Path) -> PathBuf {
    user_dir.join(TRANSACTIONS_DIR)
}
fn import_container(user_dir: &Path, id: &str) -> PathBuf {
    imports_root(user_dir).join(id)
}
fn backup_container(user_dir: &Path, id: &str) -> PathBuf {
    backups_root(user_dir).join(id)
}
fn transaction_log_path(user_dir: &Path, id: &str) -> PathBuf {
    transactions_root(user_dir).join(format!("{id}.json"))
}

fn tx_store_error(error: TxError) -> SkillStoreError {
    match error {
        TxError::CandidateChanged(entry_path) => SkillStoreError::CandidateChanged { entry_path },
        TxError::ConflictChanged(target_name) => SkillStoreError::TargetChanged { target_name },
        TxError::Message(message) => SkillStoreError::Io {
            operation: "技能安装事务",
            path: "skills/.transactions".into(),
            message,
        },
    }
}

#[cfg(test)]
pub(crate) fn seed_unrecoverable_for_test(user_dir: &Path, skill_name: &str) -> String {
    ensure_layout(user_dir).unwrap();
    let id = generate_transaction_id().unwrap();
    write_log_synced(
        user_dir,
        &TransactionLog {
            format: LOG_FORMAT,
            transaction_id: id.clone(),
            skill_name: skill_name.into(),
            portable_name_key: crate::skills::portable_skill_name_key(skill_name).unwrap(),
            replace: true,
            phase: TransactionPhase::Installed,
            staging_instance_id: None,
        },
    )
    .unwrap();
    id
}

#[cfg(test)]
pub(crate) fn seed_prepared_new_for_test(
    user_dir: &Path,
    source: &Path,
    skill_name: &str,
) -> String {
    ensure_layout(user_dir).unwrap();
    let id = generate_transaction_id().unwrap();
    let container = import_container(user_dir, &id);
    create_private_directory(&container).unwrap();
    copy_skill_tree_synced(source, &container.join(PREPARED_DIR), skill_name).unwrap();
    write_log_synced(
        user_dir,
        &TransactionLog {
            format: LOG_FORMAT,
            transaction_id: id.clone(),
            skill_name: skill_name.into(),
            portable_name_key: crate::skills::portable_skill_name_key(skill_name).unwrap(),
            replace: false,
            phase: TransactionPhase::Prepared,
            staging_instance_id: None,
        },
    )
    .unwrap();
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "mc-skill-transactions-{label}-{}-{}",
            std::process::id(),
            generate_transaction_id().unwrap()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn skill(root: &Path, name: &str, body: &str) -> PathBuf {
        let path = root.join(name);
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join(SKILL_MD),
            format!("---\nname: {name}\n---\n{body}"),
        )
        .unwrap();
        path
    }

    fn request(
        user: &Path,
        source: PathBuf,
        name: &str,
        replace: bool,
        item: &str,
    ) -> SkillInstallRequest {
        let snapshot = FixedStagedSkillRoot::capture(&source).unwrap();
        let source = FixedStagedSkillRoot::open_expected(&source, &snapshot).unwrap();
        let revision = StoreRevision {
            store_id: "transaction-test".into(),
            revision: 0,
        };
        let baseline = BaselineStore::open_locked(user)
            .unwrap()
            .capture_locked(&revision, name)
            .unwrap();
        SkillInstallRequest {
            item_id: item.into(),
            skill_name: name.into(),
            source,
            baseline,
            replace,
            staging_instance_id: None,
        }
    }

    #[test]
    fn install_and_replace_use_layout_and_leave_no_finished_transaction() {
        let config = root("install-replace");
        let user = config.join("skills");
        fs::create_dir(&user).unwrap();
        let source_root = root("install-replace-source");
        let first = skill(&source_root, "demo", "first");
        let outcomes = install_many_locked(&user, &[request(&user, first, "demo", false, "one")]);
        assert!(outcomes[0].succeeded(), "{:?}", outcomes[0]);
        assert!(fs::read_to_string(user.join("demo/SKILL.md"))
            .unwrap()
            .contains("first"));
        assert!(read_dir_sorted(&user.join(TRANSACTIONS_DIR))
            .unwrap()
            .is_empty());

        let source_root = root("install-replace-source-two");
        let second = skill(&source_root, "demo", "second");
        let outcomes = install_many_locked(&user, &[request(&user, second, "demo", true, "two")]);
        assert!(outcomes[0].succeeded(), "{:?}", outcomes[0]);
        assert!(fs::read_to_string(user.join("demo/SKILL.md"))
            .unwrap()
            .contains("second"));
        assert!(read_dir_sorted(&user.join(BACKUPS_DIR)).unwrap().is_empty());
    }

    #[test]
    fn conditional_baseline_mismatch_restores_quarantine_without_overwrite() {
        let config = root("conditional-baseline");
        let user = config.join("skills");
        fs::create_dir(&user).unwrap();
        let existing_root = root("conditional-existing");
        let existing = skill(&existing_root, "demo", "old");
        copy_skill_tree_synced(&existing, &user.join("demo"), "demo").unwrap();
        let source_root = root("conditional-source");
        let replacement = skill(&source_root, "demo", "replacement");
        let request = request(&user, replacement, "demo", true, "item");

        // 模拟全批 preflight 与事务条件 rename 之间的外部修改。
        fs::write(user.join("demo/SKILL.md"), "---\nname: demo\n---\nchanged").unwrap();
        let outcomes = install_many_locked(&user, &[request]);
        assert!(outcomes[0]
            .error
            .as_deref()
            .is_some_and(|error| error.contains("ConflictChanged")));
        let content = fs::read_to_string(user.join("demo/SKILL.md")).unwrap();
        assert!(content.contains("changed"));
        assert!(!content.contains("replacement"));
    }

    #[test]
    fn every_precommit_filesystem_boundary_cleans_current_item_and_continues_next_item() {
        for point in [
            "after-layout",
            "after-import-container-create",
            "after-prepared-copy",
            "after-prepared-sync",
            "after-import-container-sync",
            "after-imports-root-sync",
            "before-prepared-log",
            "after-backup-container-create",
        ] {
            let config = root(&format!("precommit-{point}"));
            let user = config.join("skills");
            ensure_layout(&user).unwrap();
            let existing_root = root(&format!("precommit-existing-{point}"));
            let existing = skill(&existing_root, "demo", "old-authority");
            copy_skill_tree_synced(&existing, &user.join("demo"), "demo").unwrap();
            let sources = root(&format!("precommit-source-{point}"));
            let replacement = skill(&sources, "demo", "new-version");
            let later = skill(&sources, "later", "later-version");
            inject_failure_for_test(point);
            let outcomes = install_many_locked(
                &user,
                &[
                    request(&user, replacement, "demo", true, "first"),
                    request(&user, later, "later", false, "second"),
                ],
            );
            assert!(outcomes[0].error.is_some(), "{point}");
            assert!(outcomes[1].succeeded(), "{point}: {:?}", outcomes[1]);
            assert!(
                fs::read_to_string(user.join("demo/SKILL.md"))
                    .unwrap()
                    .contains("old-authority"),
                "{point}"
            );
            assert!(user.join("later/SKILL.md").is_file(), "{point}");
            assert!(
                discover_locked(&user).unwrap().entries.is_empty(),
                "{point} left transaction residue"
            );
        }
    }

    #[test]
    fn every_post_log_failure_rolls_back_current_item_and_continues_next_item() {
        for point in [
            "after-prepared-log",
            "after-backup-rename",
            "after-backup-log",
            "after-install-rename",
            "after-installed-log",
        ] {
            let config = root(&format!("rollback-{point}"));
            let user = config.join("skills");
            ensure_layout(&user).unwrap();
            let existing_root = root(&format!("rollback-existing-{point}"));
            let existing = skill(&existing_root, "demo", "old-authority");
            copy_skill_tree_synced(&existing, &user.join("demo"), "demo").unwrap();
            let sources = root(&format!("rollback-source-{point}"));
            let replacement = skill(&sources, "demo", "new-version");
            let later = skill(&sources, "later", "later-version");
            INJECT_FAILURE_AT.with(|slot| slot.set(Some(point)));
            let outcomes = install_many_locked(
                &user,
                &[
                    request(&user, replacement, "demo", true, "first"),
                    request(&user, later, "later", false, "second"),
                ],
            );
            assert!(outcomes[0].error.is_some(), "{point}");
            assert!(outcomes[1].succeeded(), "{point}");
            assert!(
                fs::read_to_string(user.join("demo/SKILL.md"))
                    .unwrap()
                    .contains("old-authority"),
                "{point}"
            );
            assert!(user.join("later/SKILL.md").is_file(), "{point}");
            assert!(
                discover_locked(&user).unwrap().entries.is_empty(),
                "{point}"
            );
        }
    }

    #[test]
    fn every_cross_directory_rename_synchronizes_both_parents() {
        let root = root("parent-fsync");
        let left = root.join("left");
        let right = root.join("right");
        fs::create_dir(&left).unwrap();
        fs::create_dir(&right).unwrap();
        fs::create_dir(left.join("value")).unwrap();
        let before = DIRECTORY_SYNC_COUNT.load(std::sync::atomic::Ordering::SeqCst);
        durable_rename(&left.join("value"), &right.join("value")).unwrap();
        let after = DIRECTORY_SYNC_COUNT.load(std::sync::atomic::Ordering::SeqCst);
        assert!(after >= before + 2, "来源与目标父目录都必须同步");
    }

    #[test]
    fn one_item_failure_does_not_stop_later_stable_item() {
        let config = root("continue");
        let user = config.join("skills");
        fs::create_dir(&user).unwrap();
        let sources = root("continue-sources");
        let bad = skill(&sources, "bad", "fails");
        let good = skill(&sources, "good", "ok");
        let requests = vec![
            request(&user, bad, "bad", false, "first"),
            request(&user, good, "good", false, "second"),
        ];
        inject_failure_for_test("after-prepared-log");
        let outcomes = install_many_locked(&user, &requests);
        assert!(outcomes[0].error.is_some());
        assert!(outcomes[1].succeeded());
        assert!(user.join("good/SKILL.md").is_file());
    }

    #[test]
    fn recovery_is_idempotent_for_every_persisted_phase_shape() {
        for phase in [
            TransactionPhase::Prepared,
            TransactionPhase::BackupCreated,
            TransactionPhase::Installed,
        ] {
            let config = root(&format!("phase-{phase:?}"));
            let user = config.join("skills");
            ensure_layout(&user).unwrap();
            let id = generate_transaction_id().unwrap();
            let source_root = root("phase-source");
            let new = skill(&source_root, "demo", "new");
            let imports = import_container(&user, &id);
            create_private_directory(&imports).unwrap();
            copy_skill_tree_synced(&new, &imports.join(PREPARED_DIR), "demo").unwrap();
            let log = TransactionLog {
                format: LOG_FORMAT,
                transaction_id: id.clone(),
                skill_name: "demo".into(),
                portable_name_key: "demo".into(),
                replace: phase != TransactionPhase::Prepared,
                phase,
                staging_instance_id: None,
            };
            if phase != TransactionPhase::Prepared {
                let old_root = root("phase-old");
                let old = skill(&old_root, "demo", "old");
                let backups = backup_container(&user, &id);
                create_private_directory(&backups).unwrap();
                copy_skill_tree_synced(&old, &backups.join(ORIGINAL_DIR), "demo").unwrap();
            }
            if phase == TransactionPhase::Installed {
                durable_rename(&imports.join(PREPARED_DIR), &user.join("demo")).unwrap();
            }
            write_log_synced(&user, &log).unwrap();
            let first = recover_locked(&user).unwrap();
            assert!(first.issues.is_empty());
            let second = recover_locked(&user).unwrap();
            assert!(second.issues.is_empty());
            assert!(!second.authority_changed);
            assert!(discover_locked(&user).unwrap().entries.is_empty());
        }
    }

    #[test]
    fn recovery_actions_are_recomputed_from_fixed_candidates_before_commit() {
        // 有效原版备份 + 非法目标：只允许恢复原版。
        let config = root("restore-action");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let id = generate_transaction_id().unwrap();
        fs::create_dir(user.join("demo")).unwrap();
        fs::write(user.join("demo/not-a-skill"), b"stray").unwrap();
        let old_root = root("restore-action-old");
        let old = skill(&old_root, "demo", "old");
        let backup = backup_container(&user, &id);
        create_private_directory(&backup).unwrap();
        copy_skill_tree_synced(&old, &backup.join(ORIGINAL_DIR), "demo").unwrap();
        let log = TransactionLog {
            format: LOG_FORMAT,
            transaction_id: id.clone(),
            skill_name: "demo".into(),
            portable_name_key: "demo".into(),
            replace: true,
            phase: TransactionPhase::Installed,
            staging_instance_id: None,
        };
        write_log_synced(&user, &log).unwrap();
        let issue = discover_locked(&user).unwrap().issues().pop().unwrap();
        assert_eq!(issue.actions, vec![SkillRecoveryAction::RestoreBackup]);
        resolve_locked(&config, &user, &id, SkillRecoveryAction::RestoreBackup).unwrap();
        assert!(fs::read_to_string(user.join("demo/SKILL.md"))
            .unwrap()
            .contains("old"));

        // 有效安装目标但备份缺失：只允许保留安装版；候选改变后旧动作被拒绝。
        let config = root("keep-action");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let id = generate_transaction_id().unwrap();
        let new_root = root("keep-action-new");
        let new = skill(&new_root, "demo", "new");
        copy_skill_tree_synced(&new, &user.join("demo"), "demo").unwrap();
        let log = TransactionLog {
            format: LOG_FORMAT,
            transaction_id: id.clone(),
            skill_name: "demo".into(),
            portable_name_key: "demo".into(),
            replace: true,
            phase: TransactionPhase::BackupCreated,
            staging_instance_id: None,
        };
        write_log_synced(&user, &log).unwrap();
        let issue = discover_locked(&user).unwrap().issues().pop().unwrap();
        assert_eq!(issue.actions, vec![SkillRecoveryAction::KeepInstalled]);
        assert!(resolve_locked(&config, &user, &id, SkillRecoveryAction::RestoreBackup).is_err());
        resolve_locked(&config, &user, &id, SkillRecoveryAction::KeepInstalled).unwrap();
        assert!(fs::read_to_string(user.join("demo/SKILL.md"))
            .unwrap()
            .contains("new"));
    }

    #[test]
    fn unrecoverable_transaction_has_conditional_actions_and_safe_preserved_path() {
        let config = root("preserve");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let id = generate_transaction_id().unwrap();
        let log = TransactionLog {
            format: LOG_FORMAT,
            transaction_id: id.clone(),
            skill_name: "demo".into(),
            portable_name_key: "demo".into(),
            replace: true,
            phase: TransactionPhase::Installed,
            staging_instance_id: None,
        };
        write_log_synced(&user, &log).unwrap();
        let inventory = discover_locked(&user).unwrap();
        let issue = inventory.issues().pop().unwrap();
        assert!(issue.authoritative_target_missing);
        assert_eq!(issue.actions, vec![SkillRecoveryAction::PreserveFiles]);
        let outcome =
            resolve_locked(&config, &user, &id, SkillRecoveryAction::PreserveFiles).unwrap();
        assert_eq!(outcome.preserved_path, Some(format!("skill-recovery/{id}")));
        let shown = outcome.preserved_path.unwrap();
        assert!(!shown.contains(config.to_string_lossy().as_ref()));
        assert!(config.join(shown).is_dir());
    }

    #[test]
    fn lease_orphan_exemption_uses_only_active_log_instance_component() {
        let config = root("lease");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let staging = config.join("skill-import-staging");
        fs::create_dir(&staging).unwrap();
        let instance = staging.join("instance-safe");
        fs::create_dir(&instance).unwrap();
        let id = generate_transaction_id().unwrap();
        write_log_synced(
            &user,
            &TransactionLog {
                format: LOG_FORMAT,
                transaction_id: id,
                skill_name: "demo".into(),
                portable_name_key: "demo".into(),
                replace: false,
                phase: TransactionPhase::Prepared,
                staging_instance_id: Some("instance-safe".into()),
            },
        )
        .unwrap();
        assert!(staging_path_has_active_transaction(&config, &instance));
        assert!(!staging_path_has_active_transaction(
            &config,
            &config.join("instance-safe")
        ));
    }

    #[test]
    fn all_rename_and_phase_log_crash_boundaries_recover_without_data_loss() {
        // copy 完成但 prepared 日志尚未提交：孤儿 .imports 可安全清理。
        let config = root("crash-copy");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let id = generate_transaction_id().unwrap();
        let sources = root("crash-copy-source");
        let new = skill(&sources, "demo", "new");
        let container = import_container(&user, &id);
        create_private_directory(&container).unwrap();
        copy_skill_tree_synced(&new, &container.join(PREPARED_DIR), "demo").unwrap();
        let run = recover_locked(&user).unwrap();
        assert_eq!(run.issues.len(), 1);
        assert!(container.exists(), "无日志残留不得自动删除");
        let recovery_id = run.issues[0].0.clone();
        resolve_locked(
            &config,
            &user,
            &recovery_id,
            SkillRecoveryAction::PreserveFiles,
        )
        .unwrap();
        assert!(!container.exists());
        assert!(config
            .join(format!(
                "skill-recovery/{recovery_id}/imports/prepared/SKILL.md"
            ))
            .is_file());

        for (label, phase, target_new, backup_old, prepared_new, expect_old) in [
            (
                "prepared-before-backup",
                TransactionPhase::Prepared,
                true,
                false,
                true,
                false,
            ),
            (
                "prepared-after-backup-rename",
                TransactionPhase::Prepared,
                false,
                true,
                true,
                true,
            ),
            (
                "backup-log-before-install",
                TransactionPhase::BackupCreated,
                false,
                true,
                true,
                true,
            ),
            (
                "backup-log-after-install-rename",
                TransactionPhase::BackupCreated,
                true,
                true,
                false,
                true,
            ),
            (
                "installed-log-before-cleanup",
                TransactionPhase::Installed,
                true,
                true,
                false,
                false,
            ),
            (
                "installed-missing-target",
                TransactionPhase::Installed,
                false,
                true,
                false,
                true,
            ),
        ] {
            let config = root(label);
            let user = config.join("skills");
            ensure_layout(&user).unwrap();
            let id = generate_transaction_id().unwrap();
            let source_root = root(&format!("{label}-source"));
            let old = skill(&source_root, "old-source", "old");
            // 候选 frontmatter 目标必须仍为 demo。
            fs::write(old.join(SKILL_MD), "---\nname: demo\n---\nold").unwrap();
            let new = skill(&source_root, "new-source", "new");
            fs::write(new.join(SKILL_MD), "---\nname: demo\n---\nnew").unwrap();
            if target_new {
                copy_skill_tree_synced(&new, &user.join("demo"), "demo").unwrap();
            }
            let imports = import_container(&user, &id);
            if prepared_new {
                create_private_directory(&imports).unwrap();
                copy_skill_tree_synced(&new, &imports.join(PREPARED_DIR), "demo").unwrap();
            }
            if backup_old {
                let backups = backup_container(&user, &id);
                create_private_directory(&backups).unwrap();
                copy_skill_tree_synced(&old, &backups.join(ORIGINAL_DIR), "demo").unwrap();
            }
            write_log_synced(
                &user,
                &TransactionLog {
                    format: LOG_FORMAT,
                    transaction_id: id,
                    skill_name: "demo".into(),
                    portable_name_key: "demo".into(),
                    replace: backup_old || label == "prepared-before-backup",
                    phase,
                    staging_instance_id: None,
                },
            )
            .unwrap();
            let run = recover_locked(&user).unwrap();
            assert!(run.issues.is_empty(), "{label}: {:?}", run.issues);
            let content = fs::read_to_string(user.join("demo/SKILL.md")).unwrap();
            assert_eq!(content.contains("old"), expect_old, "{label}");
            assert!(discover_locked(&user).unwrap().entries.is_empty());
        }
    }

    #[test]
    fn separate_store_instances_recalibrate_after_other_instance_resolves() {
        let config = root("cross-instance-cache");
        let first = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        let second = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        let id = seed_unrecoverable_for_test(&config.join("skills"), "demo");
        assert!(matches!(
            first.snapshot(None),
            Err(SkillStoreError::RecoveryPending(_))
        ));
        assert!(matches!(
            first.save_skill("blocked", "blocked", None),
            Err(SkillStoreError::RecoveryPending(_))
        ));
        assert!(!config.join("skills/blocked").exists());
        let materialized = config.join("materialized");
        fs::create_dir(&materialized).unwrap();
        fs::write(materialized.join("keep"), b"keep").unwrap();
        assert!(matches!(
            first.materialize(&materialized, None, None),
            Err(SkillStoreError::RecoveryPending(_))
        ));
        assert!(materialized.join("keep").is_file());
        let result = second
            .resolve_recovery(&id, SkillRecoveryAction::PreserveFiles)
            .unwrap();
        assert_eq!(result.preserved_path, Some(format!("skill-recovery/{id}")));
        // first 的旧 cache 不能继续阻塞；下一次读从持久目录移除旧 issue。
        assert_eq!(
            first.snapshot(None).unwrap().revision,
            result.catalog_revision
        );
    }

    #[test]
    fn failed_automatic_recovery_is_attempted_once_per_unchanged_issue() {
        let config = root("automatic-recovery-single-attempt");
        let state = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        let sources = root("automatic-recovery-single-attempt-source");
        let source = skill(&sources, "demo", "new");
        let id = seed_prepared_new_for_test(&config.join("skills"), &source, "demo");

        inject_failure_for_test("recover-log");
        assert!(matches!(
            state.snapshot(None),
            Err(SkillStoreError::RecoveryPending(_))
        ));
        assert!(transaction_log_path(&config.join("skills"), &id).is_file());
        let after_first = state.current_revision_for_test();

        // failpoint 已一次性消费；如果同 fingerprint 被重试，这一轮会自动成功。
        // 日志仍存在且 revision 不再推进，证明缓存 issue 阻止了忙循环。
        assert!(matches!(
            state.snapshot(None),
            Err(SkillStoreError::RecoveryPending(_))
        ));
        assert!(transaction_log_path(&config.join("skills"), &id).is_file());
        assert_eq!(state.current_revision_for_test(), after_first);

        // 独立实例没有本进程缓存，会从磁盘重新校准并接管该事务。
        let restarted = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        assert!(restarted.snapshot(None).is_ok());
        assert!(!transaction_log_path(&config.join("skills"), &id).exists());
    }

    #[test]
    fn competing_recovery_readers_converge_on_stable_read_lock_state() {
        let config = root("recovery-race");
        let initial = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        let sources = root("recovery-race-source");
        let source = skill(&sources, "demo", "new");
        seed_prepared_new_for_test(&config.join("skills"), &source, "demo");
        drop(initial);
        let left = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        let right = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let handles = [left, right].map(|state| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                state.snapshot(None).unwrap().revision
            })
        });
        barrier.wait();
        let revisions = handles.map(|handle| handle.join().unwrap());
        assert_eq!(revisions[0], revisions[1]);
        assert!(discover_locked(&config.join("skills"))
            .unwrap()
            .entries
            .is_empty());
    }

    #[test]
    fn mismatched_target_backup_and_prepared_matrix_keeps_every_candidate() {
        let config = root("matrix-target-backup-prepared");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let id = generate_transaction_id().unwrap();
        let sources = root("matrix-target-backup-prepared-source");
        let target = skill(&sources, "target-source", "target-version");
        fs::write(
            target.join(SKILL_MD),
            "---\nname: demo\n---\ntarget-version",
        )
        .unwrap();
        let prepared = skill(&sources, "prepared-source", "prepared-version");
        fs::write(
            prepared.join(SKILL_MD),
            "---\nname: demo\n---\nprepared-version",
        )
        .unwrap();
        let backup = skill(&sources, "backup-source", "backup-version");
        fs::write(
            backup.join(SKILL_MD),
            "---\nname: demo\n---\nbackup-version",
        )
        .unwrap();
        copy_skill_tree_synced(&target, &user.join("demo"), "demo").unwrap();
        let imports = import_container(&user, &id);
        create_private_directory(&imports).unwrap();
        copy_skill_tree_synced(&prepared, &imports.join(PREPARED_DIR), "demo").unwrap();
        let backups = backup_container(&user, &id);
        create_private_directory(&backups).unwrap();
        copy_skill_tree_synced(&backup, &backups.join(ORIGINAL_DIR), "demo").unwrap();
        write_log_synced(
            &user,
            &TransactionLog {
                format: LOG_FORMAT,
                transaction_id: id.clone(),
                skill_name: "demo".into(),
                portable_name_key: "demo".into(),
                replace: true,
                phase: TransactionPhase::Installed,
                staging_instance_id: None,
            },
        )
        .unwrap();

        let run = recover_locked(&user).unwrap();
        assert_eq!(run.issues.len(), 1);
        assert!(fs::read_to_string(user.join("demo/SKILL.md"))
            .unwrap()
            .contains("target-version"));
        assert!(fs::read_to_string(imports.join("prepared/SKILL.md"))
            .unwrap()
            .contains("prepared-version"));
        assert!(fs::read_to_string(backups.join("original/SKILL.md"))
            .unwrap()
            .contains("backup-version"));
        assert!(transaction_log_path(&user, &id).is_file());
    }

    #[test]
    fn malformed_entries_without_suffix_or_with_short_id_can_be_preserved() {
        for name in ["no-suffix", "abc.json"] {
            let config = root(&format!("malformed-{name}"));
            let user = config.join("skills");
            ensure_layout(&user).unwrap();
            fs::write(transactions_root(&user).join(name), b"malformed").unwrap();
            if name == "abc.json" {
                let correlated = import_container(&user, "abc");
                create_private_directory(&correlated).unwrap();
                fs::write(correlated.join("keep"), b"correlated-residue").unwrap();
            }
            let inventory = discover_locked(&user).unwrap();
            assert_eq!(inventory.entries.len(), 1);
            let recovery_id = inventory.entries[0].transaction_id.clone();
            assert_eq!(
                inventory.entries[0].issue.as_ref().unwrap().actions,
                vec![SkillRecoveryAction::PreserveFiles]
            );
            let outcome = resolve_locked(
                &config,
                &user,
                &recovery_id,
                SkillRecoveryAction::PreserveFiles,
            )
            .unwrap();
            assert_eq!(
                outcome.preserved_path,
                Some(format!("skill-recovery/{recovery_id}"))
            );
            assert!(discover_locked(&user).unwrap().entries.is_empty());
            assert_eq!(
                fs::read(config.join(format!("skill-recovery/{recovery_id}/transaction-entry")))
                    .unwrap(),
                b"malformed"
            );
            if name == "abc.json" {
                assert_eq!(
                    fs::read(config.join(format!("skill-recovery/{recovery_id}/imports/keep")))
                        .unwrap(),
                    b"correlated-residue"
                );
            }
        }
    }

    #[test]
    fn repeated_malformed_path_gets_new_identity_bound_recovery_archive() {
        let config = root("malformed-repeat-generation");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let malformed = transactions_root(&user).join("repeat-broken");
        let mut recovery_ids = Vec::new();

        for generation in ["first-generation", "second-generation"] {
            fs::write(&malformed, generation.as_bytes()).unwrap();
            let inventory = discover_locked(&user).unwrap();
            assert_eq!(inventory.entries.len(), 1);
            let recovery_id = inventory.entries[0].transaction_id.clone();
            resolve_locked(
                &config,
                &user,
                &recovery_id,
                SkillRecoveryAction::PreserveFiles,
            )
            .unwrap();
            assert!(discover_locked(&user).unwrap().entries.is_empty());
            assert_eq!(
                fs::read(config.join(format!("skill-recovery/{recovery_id}/transaction-entry")))
                    .unwrap(),
                generation.as_bytes()
            );
            recovery_ids.push(recovery_id);
        }

        assert_ne!(recovery_ids[0], recovery_ids[1]);
        assert!(recovery_ids
            .iter()
            .all(|id| config.join("skill-recovery").join(id).is_dir()));
    }

    #[test]
    fn resolve_plan_rejects_entry_fingerprint_change_before_any_move() {
        let config = root("resolve-plan-candidate-change");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let malformed = transactions_root(&user).join("changing-entry");
        fs::write(&malformed, b"planned-object").unwrap();
        let entry = discover_locked(&user).unwrap().entries.pop().unwrap();
        let plan = plan_resolve_locked(
            &user,
            &entry.transaction_id,
            SkillRecoveryAction::PreserveFiles,
            None,
        )
        .unwrap();
        fs::remove_file(&malformed).unwrap();
        fs::write(&malformed, b"replacement-object").unwrap();

        let error = execute_resolve_plan_locked(&config, &user, plan).unwrap_err();
        assert!(matches!(error, SkillStoreError::CandidateChanged { .. }));
        assert_eq!(fs::read(&malformed).unwrap(), b"replacement-object");
        assert!(!config
            .join("skill-recovery")
            .join(entry.transaction_id)
            .exists());
    }

    #[test]
    fn preserve_files_resumes_an_existing_partial_destination_idempotently() {
        let config = root("preserve-resume");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let malformed = transactions_root(&user).join("broken-entry");
        fs::write(&malformed, b"keep-me").unwrap();
        let entry = discover_locked(&user).unwrap().entries.pop().unwrap();
        let RecoveryKind::Malformed { residues } = entry.kind else {
            panic!("expected malformed residue");
        };
        let destination = config.join("skill-recovery").join(&entry.transaction_id);
        ensure_plain_directory(destination.parent().unwrap(), true).unwrap();
        let mut manifest =
            open_or_create_preserve_manifest(&destination, &entry.transaction_id, &residues)
                .unwrap();
        let first = manifest.entries[0].clone();
        rename_verified(
            &user.join(&first.source_relative),
            &destination.join(&first.destination_name),
            &first.expected,
            &first.source_relative,
        )
        .unwrap();
        // 模拟崩溃发生在 rename 后、completed manifest 写入前。
        assert!(!manifest.entries[0].completed);
        let issue = discover_locked(&user).unwrap().entries.pop().unwrap();
        assert_eq!(issue.transaction_id, entry.transaction_id);
        resolve_locked(
            &config,
            &user,
            &entry.transaction_id,
            SkillRecoveryAction::PreserveFiles,
        )
        .unwrap();
        assert!(discover_locked(&user).unwrap().entries.is_empty());
        manifest = read_preserve_manifest(&destination.join(PRESERVE_MANIFEST)).unwrap();
        assert!(manifest.complete);
        assert!(manifest.entries.iter().all(|entry| entry.completed));
        assert_eq!(
            fs::read(destination.join("transaction-entry")).unwrap(),
            b"keep-me"
        );
    }

    #[test]
    fn changed_quarantined_candidate_is_rejected_before_authority_promotion() {
        let config = root("candidate-changed");
        let user = config.join("skills");
        ensure_layout(&user).unwrap();
        let sources = root("candidate-changed-source");
        let candidate = skill(&sources, "demo", "original-candidate");
        let private = user.join(IMPORTS_DIR).join("private");
        create_private_directory(&private).unwrap();
        let source = private.join("candidate");
        copy_skill_tree_synced(&candidate, &source, "demo").unwrap();
        let expected = stable_snapshot(&source).unwrap().unwrap();
        let quarantine = private.join(QUARANTINE_DIR);
        stage_promotion_candidate(&source, &quarantine, &expected, "candidate").unwrap();
        fs::write(
            quarantine.join(SKILL_MD),
            "---\nname: demo\n---\nreplacement",
        )
        .unwrap();
        let error = promote_quarantined(&quarantine, &user.join("demo"), &expected, "candidate")
            .unwrap_err();
        assert!(matches!(error, TxError::CandidateChanged(_)));
        assert!(!user.join("demo").exists(), "变化候选不得成为权威目录");
        assert!(quarantine.is_dir());
    }

    #[test]
    fn revision_failure_runs_zero_resolve_and_automatic_recovery_actions() {
        let config = root("revision-zero-recovery");
        let state = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        let user = config.join("skills");
        let id = seed_unrecoverable_for_test(&user, "demo");
        state.inject_revision_failure_for_test();
        assert!(state
            .resolve_recovery(&id, SkillRecoveryAction::PreserveFiles)
            .is_err());
        assert!(transaction_log_path(&user, &id).is_file());
        assert!(!config.join(format!("skill-recovery/{id}")).exists());
        assert_eq!(state.current_revision_for_test(), 0);

        fs::remove_file(transaction_log_path(&user, &id)).unwrap();
        let sources = root("revision-zero-recovery-source");
        let source = skill(&sources, "prepared", "prepared");
        fs::write(source.join(SKILL_MD), "---\nname: demo\n---\nprepared").unwrap();
        let automatic_id = seed_prepared_new_for_test(&user, &source, "demo");
        state.inject_revision_failure_for_test();
        assert!(state.snapshot(None).is_err());
        assert!(transaction_log_path(&user, &automatic_id).is_file());
        assert!(import_container(&user, &automatic_id)
            .join(PREPARED_DIR)
            .is_dir());
        assert_eq!(state.current_revision_for_test(), 0);
    }

    #[test]
    fn resolve_planning_rejects_invalid_requests_without_revision_but_execution_failure_advances() {
        let config = root("resolve-plan-revision-order");
        let state = crate::skills::SkillStoreState::new(config.clone()).unwrap();
        let user = config.join("skills");
        let missing_id = "00000000000000000000000000000000";
        assert!(state
            .resolve_recovery(missing_id, SkillRecoveryAction::PreserveFiles)
            .is_err());
        assert_eq!(state.current_revision_for_test(), 0);

        // 精确自动恢复形状本身不是 issue；不得临时合成 PreserveFiles 计划。
        let sources = root("resolve-plan-no-issue-source");
        let source = skill(&sources, "prepared", "prepared");
        fs::write(source.join(SKILL_MD), "---\nname: auto-demo\n---\nprepared").unwrap();
        let automatic_id = seed_prepared_new_for_test(&user, &source, "auto-demo");
        assert!(state
            .resolve_recovery(&automatic_id, SkillRecoveryAction::PreserveFiles)
            .is_err());
        assert_eq!(state.current_revision_for_test(), 0);
        assert!(transaction_log_path(&user, &automatic_id).is_file());
        remove_if_safe(&import_container(&user, &automatic_id)).unwrap();
        remove_log_synced(&user, &automatic_id).unwrap();

        let id = seed_unrecoverable_for_test(&user, "demo");
        assert!(state
            .resolve_recovery(&id, SkillRecoveryAction::RestoreBackup)
            .is_err());
        assert_eq!(state.current_revision_for_test(), 0);

        // 计划只读阶段合法；预先存在的非空归档目录使执行阶段保守失败。
        let destination = config.join("skill-recovery").join(&id);
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("foreign"), b"do-not-overwrite").unwrap();
        assert!(state
            .resolve_recovery(&id, SkillRecoveryAction::PreserveFiles)
            .is_err());
        assert_eq!(state.current_revision_for_test(), 1);
        assert!(transaction_log_path(&user, &id).is_file());
        assert_eq!(
            fs::read(destination.join("foreign")).unwrap(),
            b"do-not-overwrite"
        );
    }

    #[test]
    fn windows_contract_rejects_reparse_objects_and_uses_write_through_rename() {
        let source = include_str!("skill_transactions.rs")
            .rsplit_once("#[cfg(test)]\nmod tests {")
            .unwrap()
            .0;
        assert!(source.contains("FILE_FLAG_OPEN_REPARSE_POINT"));
        assert!(source.contains("FILE_ATTRIBUTE_REPARSE_POINT"));
        assert!(source.contains("GetFileInformationByHandle"));
        assert!(source.contains("windows_handle_identity"));
        assert!(!source.contains("volume_serial_number()"));
        assert!(!source.contains("file_index()"));
        assert!(source.contains("Anonymous.Flags = 0"));
        assert!(source.contains("MOVEFILE_WRITE_THROUGH"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_candidates_and_internal_layout_are_never_followed() {
        use std::os::unix::fs::symlink;
        let config = root("symlink");
        let user = config.join("skills");
        fs::create_dir(&user).unwrap();
        let outside = root("symlink-outside");
        symlink(&outside, user.join(IMPORTS_DIR)).unwrap();
        let error = discover_locked(&user).unwrap_err();
        assert!(error.to_string().contains("不是安全普通目录"));
        assert!(outside.is_dir());
    }
}
