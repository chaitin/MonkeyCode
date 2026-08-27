//! 技能导入 async Tauri 命令编排。所有阻塞文件系统工作均进入 `spawn_blocking`。

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Emitter as _, State};
use tauri_plugin_dialog::DialogExt as _;

use super::archive::{stage_archive_source_with_reservation, verify_archive_source_fingerprint};
use super::folder::{
    stage_folder_source_with_reservation, verify_folder_source_fingerprint, FolderBatchUsage,
    FolderEntryKind,
};
use super::lease::{SourceKey, SourceMergeCandidate, StagingInstance, StagingUsage};
use super::model::{
    SkillCommandError, SkillImportAction, SkillImportBatchPhase, SkillImportBatchPreview,
    SkillImportBatchResult, SkillImportConflict, SkillImportCurrentSnapshot, SkillImportDecision,
    SkillImportFile, SkillImportFileKind, SkillImportItem, SkillImportItemState,
    SkillImportRiskKind, SkillImportSourceKind, SkillImportSourceStatus, SkillImportTextChunk,
    SkillImportValidity, SkillRecoveryAction, SkillRecoveryIssue, SkillRecoveryResolveResult,
    MAX_SKILL_MD_BYTES, MAX_TEXT_PREVIEW_BYTES,
};
use super::state::{
    CommitPhaseGuard, SkillImportState, SourcePickToken, StagedImportItemData,
    StagedImportSourceData, StagedSourceFingerprint, StagedSourceMerge,
    PENDING_CLEANUP_RETRY_LIMIT,
};
use super::store::{
    FixedStagedSkillRoot, FixedTreeSnapshot, SkillStoreError, TargetEntryType, TargetPresence,
};
use super::{
    analyze_skill_risks, is_executable_file, with_source_display_name,
    SkillImportSourcePreviewInput,
};
use crate::skill_transactions::SkillInstallRequest;
use crate::skills::{self, SkillInfo, SkillStoreState};

const IMPORT_UPDATED_EVENT: &str = "skills-import-updated";

/// 一个 picker 命令从预留 token 起就由本 guard 负责。任何 `?`、join error 或
/// unwind 都先显式清理尚未合并 reservation，再撤销 inflight；只有原子 merge
/// 成功后才 `commit`。
struct SourcePickCommandGuard {
    app: Option<AppHandle>,
    state: SkillImportState,
    token: Option<SourcePickToken>,
    staged: Vec<StagedSourceMerge>,
}

impl SourcePickCommandGuard {
    fn new(app: AppHandle, state: SkillImportState, token: SourcePickToken) -> Self {
        Self {
            app: Some(app),
            state,
            token: Some(token),
            staged: Vec::new(),
        }
    }

    #[cfg(test)]
    fn new_for_test(state: SkillImportState, token: SourcePickToken) -> Self {
        Self {
            app: None,
            state,
            token: Some(token),
            staged: Vec::new(),
        }
    }

    fn token(&self) -> &SourcePickToken {
        self.token.as_ref().expect("未 commit 的 picker guard")
    }

    fn set_staged(&mut self, staged: Vec<StagedSourceMerge>) {
        self.staged = staged;
    }

    fn merge(mut self) -> Result<(), SkillCommandError> {
        let token = self.token.as_ref().expect("未 commit 的 picker guard");
        let staged = std::mem::take(&mut self.staged);
        let result = self.state.complete_source_picks(token, staged);
        // complete_source_picks 对成功和所有拒绝路径都已取得/清理候选所有权并
        // 清除匹配 token；禁止 Drop 再执行第二轮清理。
        self.token = None;
        if let Some(app) = &self.app {
            publish_events(app, &self.state);
        }
        result.map(|_| ())
    }
}

impl Drop for SourcePickCommandGuard {
    fn drop(&mut self) {
        let mut cleanup_error = None;
        for staged in self.staged.drain(..) {
            if let Err(error) = staged.cleanup_unmerged() {
                cleanup_error.get_or_insert(error);
            }
        }
        if let Some(token) = self.token.take() {
            let _ = self.state.abandon_source_pick(&token);
        }
        if let Some(app) = &self.app {
            publish_events(app, &self.state);
        }
        // Drop 无法返回 cleanup error；正常错误路径在 staged producer/merge 内显式
        // 传播。这里是 panic/join 失败兜底，ledger 仍由 reservation Drop 保守保留。
        let _ = cleanup_error;
    }
}

#[tauri::command]
pub async fn skills_import_current(
    state: State<'_, SkillImportState>,
) -> Result<SkillImportCurrentSnapshot, SkillCommandError> {
    let state = state.inner().clone();
    let maintenance = state.clone();
    run_blocking(move || maintenance.retry_pending_cleanup(PENDING_CLEANUP_RETRY_LIMIT)).await??;
    Ok(state.current())
}

#[tauri::command]
pub async fn skills_import_pick(
    app: AppHandle,
    imports: State<'_, SkillImportState>,
    store: State<'_, SkillStoreState>,
    source_kind: SkillImportSourceKind,
    batch_id: Option<String>,
) -> Result<Option<SkillImportBatchPreview>, SkillCommandError> {
    let imports = imports.inner().clone();
    let store = store.inner().clone();
    let maintenance = imports.clone();
    run_blocking(move || maintenance.retry_pending_cleanup(PENDING_CLEANUP_RETRY_LIMIT)).await??;
    let token = match batch_id.as_deref() {
        Some(batch_id) => imports.reserve_source_pick(batch_id)?,
        None => imports.reserve_initial_source_pick(random_id("batch")?)?,
    };
    let mut pick_guard = SourcePickCommandGuard::new(app.clone(), imports.clone(), token);
    publish_events(&app, &imports);
    let selected = pick_paths(&app, source_kind).await?;
    if selected.is_empty() {
        return Ok(None); // guard Drop 撤销 token，已有 batch 内容保持不变。
    }
    if batch_id.is_none() {
        imports.activate_initial_source_pick(pick_guard.token())?;
        publish_events(&app, &imports);
    }
    let active_batch_id = pick_guard.token().batch_id().to_string();

    let base_order = imports
        .current()
        .batch
        .and_then(|batch| batch.sources.into_iter().map(|source| source.order).max())
        .map_or(0, |order| order.saturating_add(1));
    let instance = imports.staging_instance()?;
    let app_for_catalog = app.clone();
    let catalog = run_blocking(move || {
        let builtin = skills::builtin_dir(&app_for_catalog);
        store.snapshot(builtin.as_deref()).map(|value| value.skills)
    })
    .await?
    .map_err(store_error)?;
    let staged =
        run_blocking(move || stage_selected_paths(instance, source_kind, selected, base_order))
            .await??;
    pick_guard.set_staged(staged);
    pick_guard.merge()?;
    let preview = imports
        .current()
        .batch
        .ok_or_else(|| invalid("导入批次不存在"))?;
    imports.update_collecting_conflicts(
        &active_batch_id,
        &conflict_updates(&preview.items, &catalog),
    )?;
    publish_events(&app, &imports);
    Ok(imports.current().batch)
}

#[tauri::command]
pub async fn skills_import_read_text(
    state: State<'_, SkillImportState>,
    batch_id: String,
    item_id: String,
    relative_path: String,
    offset: u64,
    limit: u64,
) -> Result<SkillImportTextChunk, SkillCommandError> {
    if limit == 0 || limit > MAX_TEXT_PREVIEW_BYTES {
        return Err(invalid("文本预览单次 limit 必须在 1 到 1 MiB 之间"));
    }
    if !state.allowed_operations(&batch_id)?.read_text {
        return Err(SkillCommandError::Busy);
    }
    let item = state.staged_item(&batch_id, &item_id)?;
    let root = item
        .staged_root
        .ok_or_else(|| invalid("无效技能项没有暂存根"))?;
    let expected = item
        .staged_fingerprint
        .ok_or_else(|| invalid("技能项缺少暂存根稳定身份"))?;
    let relative = normalize_relative(&relative_path)?;
    if !preview_contains_file(&item.preview.files, &relative) {
        return Err(invalid("relative_path 不属于该技能项的已验证文件树"));
    }
    run_blocking(move || read_text_from_expected(&root, &expected, &relative, offset, limit))
        .await?
}

#[tauri::command]
pub async fn skills_import_commit(
    app: AppHandle,
    imports: State<'_, SkillImportState>,
    store: State<'_, SkillStoreState>,
    batch_id: String,
    decisions: Vec<SkillImportDecision>,
    executable_content_reviewed: bool,
) -> Result<SkillImportBatchResult, SkillCommandError> {
    let imports = imports.inner().clone();
    let store = store.inner().clone();
    let phase = imports
        .current()
        .batch
        .filter(|batch| batch.batch_id == batch_id)
        .ok_or_else(|| invalid("导入批次不存在"))?
        .phase;
    let guard = match phase {
        SkillImportBatchPhase::Collecting => imports.begin_initial_commit(&batch_id)?,
        SkillImportBatchPhase::Completed => imports.begin_retry(&batch_id)?,
        _ => return Err(SkillCommandError::Busy),
    };
    publish_events(&app, &imports);
    let task_imports = imports.clone();
    let app_for_task = app.clone();
    let result = run_blocking(move || {
        let builtin = skills::builtin_dir(&app_for_task);
        commit_blocking(
            task_imports,
            store,
            builtin,
            batch_id,
            decisions,
            executable_content_reviewed,
            guard,
        )
    })
    .await?;
    publish_events(&app, &imports);
    result
}

#[tauri::command]
pub async fn skills_import_cancel(
    app: AppHandle,
    state: State<'_, SkillImportState>,
    batch_id: String,
) -> Result<(), SkillCommandError> {
    let state = state.inner().clone();
    let maintenance = state.clone();
    run_blocking(move || maintenance.retry_pending_cleanup(PENDING_CLEANUP_RETRY_LIMIT)).await??;
    let cancelled = state.cancel(&batch_id)?;
    publish_events(&app, &state);
    run_blocking(move || cancelled.cleanup()).await??;
    Ok(())
}

pub async fn skills_recovery_list(
    store: State<'_, SkillStoreState>,
) -> Result<Vec<SkillRecoveryIssue>, SkillCommandError> {
    let store = store.inner().clone();
    run_blocking(move || store.recovery_issues())
        .await?
        .map_err(store_error)
}

pub async fn skills_recovery_resolve(
    store: State<'_, SkillStoreState>,
    transaction_id: String,
    action: SkillRecoveryAction,
) -> Result<SkillRecoveryResolveResult, SkillCommandError> {
    let store = store.inner().clone();
    run_blocking(move || store.resolve_recovery(&transaction_id, action))
        .await?
        .map_err(store_error)
}

async fn pick_paths(
    app: &AppHandle,
    kind: SkillImportSourceKind,
) -> Result<Vec<PathBuf>, SkillCommandError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    match kind {
        SkillImportSourceKind::Folders => app.dialog().file().pick_folders(move |paths| {
            let _ = sender.send(paths);
        }),
        SkillImportSourceKind::Zips => {
            app.dialog()
                .file()
                .add_filter("ZIP", &["zip"])
                .pick_files(move |paths| {
                    let _ = sender.send(paths);
                })
        }
    }
    receiver
        .await
        .map_err(|_| io_error("系统文件选择器未返回结果"))?
        .unwrap_or_default()
        .into_iter()
        .map(|path| {
            path.into_path()
                .map_err(|_| invalid("选择器返回了非本地路径"))
        })
        .collect()
}

fn publish_events(app: &AppHandle, state: &SkillImportState) {
    for event in state.take_events() {
        let _ = app.emit(IMPORT_UPDATED_EVENT, event);
    }
}

async fn run_blocking<F, R>(operation: F) -> Result<R, SkillCommandError>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| io_error(format!("技能导入后台任务异常结束: {error}")))
}

fn stage_selected_paths(
    instance: StagingInstance,
    kind: SkillImportSourceKind,
    paths: Vec<PathBuf>,
    base_order: usize,
) -> Result<Vec<StagedSourceMerge>, SkillCommandError> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for (index, path) in paths.into_iter().enumerate() {
        let selection_key = match SourceKey::from_selection(kind, &path)
            .map_err(|error| io_error(format!("规范化来源失败: {error}")))
        {
            Ok(key) => key,
            Err(error) => {
                let cleanup = cleanup_unmerged_sources(std::mem::take(&mut output)).err();
                return Err(cleanup.unwrap_or(error));
            }
        };
        if !seen.insert(selection_key.clone()) {
            continue;
        }
        let source_id = match random_id("source") {
            Ok(id) => id,
            Err(error) => {
                let cleanup = cleanup_unmerged_sources(std::mem::take(&mut output)).err();
                return Err(cleanup.unwrap_or(error));
            }
        };
        let order = base_order.saturating_add(index);
        let mut reservation = match instance.begin_source().map_err(lease_error) {
            Ok(reservation) => reservation,
            Err(error) => {
                let cleanup = cleanup_unmerged_sources(std::mem::take(&mut output)).err();
                return Err(cleanup.unwrap_or(error));
            }
        };
        let mut batch_usage = FolderBatchUsage::default();
        let staged = match kind {
            SkillImportSourceKind::Folders => {
                stage_folder_source_with_reservation(&path, &mut batch_usage, &mut reservation)
                    .map(|source| StagedValue::Folder(source))
                    .map_err(|error| error.to_string())
            }
            SkillImportSourceKind::Zips => {
                stage_archive_source_with_reservation(&path, &mut batch_usage, &mut reservation)
                    .map(|source| StagedValue::Archive(source))
                    .map_err(|error| error.to_string())
            }
        };
        match staged {
            Err(message) => {
                if let Err(error) = reservation
                    .cleanup_owned()
                    .map_err(|failure| lease_error(failure.into_error()))
                {
                    let prior = cleanup_unmerged_sources(std::mem::take(&mut output)).err();
                    return Err(prior.unwrap_or(error));
                }
                output.push(StagedSourceMerge {
                    source: make_source(
                        source_id,
                        order,
                        kind,
                        &path,
                        SkillImportSourceStatus::Failed,
                        Some(message),
                        None,
                        Vec::new(),
                    ),
                    candidate: SourceMergeCandidate::failed_or_empty(selection_key),
                    reservation: None,
                });
            }
            Ok(staged) => {
                let converted = (|| {
                    let value = match staged {
                        StagedValue::Folder(source) => {
                            let usage = StagingUsage {
                                entries: source.entry_count,
                                bytes: source.total_size,
                            };
                            let canonical = source.fingerprint.source_key();
                            let items = source
                                .skills
                                .into_iter()
                                .map(|skill| {
                                    let fallback = if skill.relative_root == "." {
                                        super::source_display_name(&path)
                                    } else {
                                        skill
                                            .relative_root
                                            .rsplit('/')
                                            .next()
                                            .unwrap_or_default()
                                            .to_string()
                                    };
                                    let entries = skill
                                        .entries
                                        .into_iter()
                                        .map(|entry| EntryView {
                                            path: entry.relative_path,
                                            kind: entry.kind,
                                            size: entry.size,
                                            executable: entry.platform_executable,
                                        })
                                        .collect();
                                    make_item(
                                        &source_id,
                                        order,
                                        &path,
                                        skill.relative_root,
                                        fallback,
                                        skill.staged_root,
                                        entries,
                                        skill.total_size,
                                        skill.invalid_reason,
                                    )
                                })
                                .collect::<Result<Vec<_>, _>>()?;
                            (
                                items,
                                StagedSourceFingerprint::Folder(source.fingerprint),
                                canonical,
                                usage,
                            )
                        }
                        StagedValue::Archive(source) => {
                            let usage = StagingUsage {
                                entries: source.entry_count,
                                bytes: source.total_size,
                            };
                            let canonical = source.fingerprint.source_key();
                            let items = source
                                .skills
                                .into_iter()
                                .map(|skill| {
                                    let entries = skill
                                        .entries
                                        .into_iter()
                                        .map(|entry| EntryView {
                                            path: entry.relative_path,
                                            kind: entry.kind,
                                            size: entry.size,
                                            executable: entry.platform_executable,
                                        })
                                        .collect();
                                    make_item(
                                        &source_id,
                                        order,
                                        &path,
                                        skill.relative_root,
                                        skill.fallback_name,
                                        skill.staged_root,
                                        entries,
                                        skill.total_size,
                                        skill.invalid_reason,
                                    )
                                })
                                .collect::<Result<Vec<_>, _>>()?;
                            (
                                items,
                                StagedSourceFingerprint::Archive(source.fingerprint),
                                canonical,
                                usage,
                            )
                        }
                    };
                    Ok::<_, SkillCommandError>(value)
                })();
                let (items, fingerprint, canonical, usage) = match converted {
                    Ok(value) => value,
                    Err(error) => {
                        let cleanup = reservation
                            .cleanup_owned()
                            .err()
                            .map(|failure| lease_error(failure.into_error()));
                        let prior_cleanup =
                            cleanup_unmerged_sources(std::mem::take(&mut output)).err();
                        return Err(cleanup.or(prior_cleanup).unwrap_or(error));
                    }
                };
                if reservation.usage() != usage {
                    let error = io_error("来源暂存配额记账不一致");
                    let cleanup = reservation
                        .cleanup_owned()
                        .err()
                        .map(|failure| lease_error(failure.into_error()));
                    let prior = cleanup_unmerged_sources(std::mem::take(&mut output)).err();
                    return Err(cleanup.or(prior).unwrap_or(error));
                }
                if items.is_empty() {
                    if let Err(error) = reservation
                        .cleanup_owned()
                        .map_err(|failure| lease_error(failure.into_error()))
                    {
                        let prior = cleanup_unmerged_sources(std::mem::take(&mut output)).err();
                        return Err(prior.unwrap_or(error));
                    }
                    output.push(StagedSourceMerge {
                        source: make_source(
                            source_id,
                            order,
                            kind,
                            &path,
                            SkillImportSourceStatus::Empty,
                            Some("未发现可导入技能；请选择包含 SKILL.md 的目录或 ZIP".into()),
                            Some(fingerprint),
                            items,
                        ),
                        candidate: SourceMergeCandidate::staged(
                            selection_key,
                            canonical,
                            0,
                            StagingUsage::default(),
                        ),
                        reservation: None,
                    });
                } else {
                    let count = items.len();
                    output.push(StagedSourceMerge {
                        source: make_source(
                            source_id,
                            order,
                            kind,
                            &path,
                            SkillImportSourceStatus::Ready,
                            None,
                            Some(fingerprint),
                            items,
                        ),
                        candidate: SourceMergeCandidate::staged(
                            selection_key,
                            canonical,
                            count,
                            usage,
                        ),
                        reservation: Some(reservation),
                    });
                }
            }
        }
    }
    Ok(output)
}

fn cleanup_unmerged_sources(sources: Vec<StagedSourceMerge>) -> Result<(), SkillCommandError> {
    let mut first_error = None;
    for source in sources {
        if let Err(error) = source.cleanup_unmerged() {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

enum StagedValue {
    Folder(super::folder::StagedFolderSource),
    Archive(super::archive::StagedArchiveSource),
}

fn make_source(
    source_id: String,
    order: usize,
    kind: SkillImportSourceKind,
    path: &Path,
    status: SkillImportSourceStatus,
    error: Option<String>,
    fingerprint: Option<StagedSourceFingerprint>,
    items: Vec<StagedImportItemData>,
) -> StagedImportSourceData {
    let preview = SkillImportSourcePreviewInput {
        source_id,
        order,
        kind,
        source_path: path.to_path_buf(),
        status,
        skill_count: items.len(),
        error,
    };
    StagedImportSourceData {
        preview: preview.into(),
        source_path: path.to_path_buf(),
        fingerprint,
        items,
    }
}

struct EntryView {
    path: String,
    kind: FolderEntryKind,
    size: u64,
    executable: bool,
}

#[allow(clippy::too_many_arguments)]
fn make_item(
    source_id: &str,
    order: usize,
    source_path: &Path,
    relative_root: String,
    fallback: String,
    staged_root: Option<PathBuf>,
    entries: Vec<EntryView>,
    total_size: u64,
    invalid_reason: Option<String>,
) -> Result<StagedImportItemData, SkillCommandError> {
    let files = build_file_tree(&entries)?;
    let executable_paths = entries
        .iter()
        .filter(|entry| {
            entry.kind == FolderEntryKind::File && is_executable_file(&entry.path, entry.executable)
        })
        .map(|entry| entry.path.clone())
        .collect::<Vec<_>>();
    let (name, key, description, risks, validity, staged_fingerprint) = if let (Some(root), None) =
        (staged_root.as_ref(), invalid_reason.as_ref())
    {
        let snapshot = FixedStagedSkillRoot::capture(root).map_err(store_error)?;
        let fixed = FixedStagedSkillRoot::open_expected(root, &snapshot).map_err(store_error)?;
        let (bytes, size) = fixed
            .read_file_range("SKILL.md", 0, (MAX_SKILL_MD_BYTES + 1) as usize)
            .map_err(store_error)?;
        if size > MAX_SKILL_MD_BYTES {
            return Err(invalid("SKILL.md 超过 1 MiB"));
        }
        let text = String::from_utf8(bytes).map_err(|_| invalid("SKILL.md 不是 UTF-8 文本"))?;
        let fingerprint = Some(snapshot);
        match skills::resolve_import_skill_metadata(&text, &fallback) {
            Ok(meta) => (
                Some(meta.name),
                Some(meta.portable_name_key),
                meta.description,
                analyze_skill_risks(&text, &executable_paths),
                SkillImportValidity::Valid,
                fingerprint,
            ),
            Err(reason) => (
                None,
                None,
                skills::derive_description(&text),
                analyze_skill_risks(&text, &executable_paths),
                SkillImportValidity::Invalid {
                    reasons: vec![reason],
                },
                fingerprint,
            ),
        }
    } else {
        (
            None,
            None,
            String::new(),
            Vec::new(),
            SkillImportValidity::Invalid {
                reasons: vec![invalid_reason.unwrap_or_else(|| "技能暂存不可用".into())],
            },
            None,
        )
    };
    let preview = with_source_display_name(
        SkillImportItem {
            item_id: random_id("item")?,
            source_id: source_id.into(),
            order,
            source_display_name: String::new(),
            relative_root,
            name,
            portable_name_key: key,
            description,
            files,
            total_size,
            risks,
            validity,
            conflict: SkillImportConflict::None,
            duplicate_group: None,
            state: SkillImportItemState::Pending,
            last_error: None,
        },
        source_path,
    );
    Ok(StagedImportItemData {
        staged_root,
        staged_fingerprint,
        preview,
    })
}

fn build_file_tree(entries: &[EntryView]) -> Result<Vec<SkillImportFile>, SkillCommandError> {
    #[derive(Default)]
    struct Node {
        value: Option<(FolderEntryKind, u64, bool)>,
        children: BTreeMap<String, Node>,
    }
    fn render(path: String, name: String, node: Node) -> SkillImportFile {
        let (kind, size, executable) = node.value.unwrap_or((FolderEntryKind::Directory, 0, false));
        let children = node
            .children
            .into_iter()
            .map(|(name, child)| {
                let child_path = if path.is_empty() {
                    name.clone()
                } else {
                    format!("{path}/{name}")
                };
                render(child_path, name, child)
            })
            .collect();
        SkillImportFile {
            relative_path: path,
            name,
            kind: if kind == FolderEntryKind::File {
                SkillImportFileKind::File
            } else {
                SkillImportFileKind::Directory
            },
            size,
            executable,
            children,
        }
    }
    let mut root = Node::default();
    for entry in entries {
        let path = normalize_relative(&entry.path)?;
        let parts = path.split('/').collect::<Vec<_>>();
        let mut node = &mut root;
        for (index, part) in parts.iter().enumerate() {
            node = node.children.entry((*part).into()).or_default();
            if index + 1 == parts.len() {
                node.value = Some((
                    entry.kind,
                    entry.size,
                    entry.kind == FolderEntryKind::File
                        && is_executable_file(&path, entry.executable),
                ));
            }
        }
    }
    Ok(root
        .children
        .into_iter()
        .map(|(name, node)| render(name.clone(), name, node))
        .collect())
}

fn conflict_updates(
    items: &[SkillImportItem],
    catalog: &[SkillInfo],
) -> Vec<(String, SkillImportConflict, Option<String>)> {
    let mut groups = HashMap::<&str, usize>::new();
    for item in items {
        if let Some(key) = item.portable_name_key.as_deref() {
            *groups.entry(key).or_default() += 1;
        }
    }
    items
        .iter()
        .map(|item| {
            let duplicate = item
                .portable_name_key
                .as_deref()
                .filter(|key| groups.get(key).copied().unwrap_or(0) > 1)
                .map(str::to_string);
            let catalog_conflict = catalog_conflict(
                item.name.as_deref(),
                item.portable_name_key.as_deref(),
                catalog,
            );
            let conflict = if duplicate.is_some() {
                SkillImportConflict::BatchDuplicate {
                    catalog_conflict: Box::new(catalog_conflict),
                }
            } else {
                catalog_conflict
            };
            (item.item_id.clone(), conflict, duplicate)
        })
        .collect()
}

fn catalog_conflict(
    name: Option<&str>,
    portable_key: Option<&str>,
    catalog: &[SkillInfo],
) -> SkillImportConflict {
    let (Some(name), Some(portable_key)) = (name, portable_key) else {
        return SkillImportConflict::None;
    };
    if let Some(skill) = catalog
        .iter()
        .find(|skill| skill.source == "user" && skill.name == name)
    {
        return SkillImportConflict::UserSkill {
            existing_name: skill.name.clone(),
        };
    }
    if let Some(skill) = catalog.iter().find(|skill| {
        skill.source == "user"
            && skills::portable_skill_name_key(&skill.name).as_deref() == Some(portable_key)
    }) {
        return SkillImportConflict::UserNameCase {
            existing_name: skill.name.clone(),
        };
    }
    if let Some(skill) = catalog
        .iter()
        .find(|skill| skill.source == "builtin" && skill.name == name)
    {
        return SkillImportConflict::BuiltinSkill {
            existing_name: skill.name.clone(),
        };
    }
    // 用户同名覆盖后内置项从 catalog 去重，但 overrides 明确证明同名内置存在；
    // exact user 已在上方优先返回，这里只需覆盖普通内置可见项的大小写冲突。
    if let Some(skill) = catalog.iter().find(|skill| {
        skill.source == "builtin"
            && skills::portable_skill_name_key(&skill.name).as_deref() == Some(portable_key)
    }) {
        return SkillImportConflict::BuiltinNameCase {
            existing_name: skill.name.clone(),
        };
    }
    SkillImportConflict::None
}

fn commit_blocking(
    imports: SkillImportState,
    store: SkillStoreState,
    builtin: Option<PathBuf>,
    batch_id: String,
    decisions: Vec<SkillImportDecision>,
    executable_content_reviewed: bool,
    guard: CommitPhaseGuard,
) -> Result<SkillImportBatchResult, SkillCommandError> {
    let phase_guard = RefCell::new(guard);
    let preview = imports
        .current()
        .batch
        .filter(|batch| batch.batch_id == batch_id)
        .ok_or_else(|| invalid("导入批次不存在"))?;
    validate_decision_shape(&preview, &decisions)?;
    let decision_map = decisions
        .iter()
        .map(|decision| (decision.item_id.clone(), decision.action))
        .collect::<HashMap<_, _>>();
    let handles = decisions
        .iter()
        .map(|decision| {
            imports
                .staged_item(&batch_id, &decision.item_id)
                .map(|item| (decision.clone(), item))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let source_fingerprints = imports.source_fingerprints(&batch_id)?;
    let decisions_for_enter = decisions.clone();
    let preview_for_validate = preview.clone();

    let install = store.install_transactions_validated(
        builtin.as_deref(),
        |revision, catalog, baselines| {
            let recalculated = conflict_updates(&preview_for_validate.items, catalog);
            let by_id = recalculated
                .iter()
                .map(|(id, conflict, group)| (id.as_str(), (conflict, group)))
                .collect::<HashMap<_, _>>();
            let mut changed = false;
            for (decision, handle) in &handles {
                let (conflict, group) = by_id.get(decision.item_id.as_str()).ok_or_else(|| {
                    SkillStoreError::InvalidTargetName("技能项冲突快照缺失".into())
                })?;
                if handle.preview.conflict != **conflict
                    || handle.preview.duplicate_group != **group
                {
                    phase_guard
                        .borrow_mut()
                        .update_item_conflict(
                            &decision.item_id,
                            (*conflict).clone(),
                            (*group).clone(),
                        )
                        .map_err(state_store_error)?;
                    changed = true;
                }
            }
            if changed {
                return Err(SkillStoreError::InvalidTargetName(
                    "技能库冲突已变化，请重新确认动作".into(),
                ));
            }

            validate_actions(
                &preview_for_validate.items,
                &decision_map,
                catalog,
                executable_content_reviewed,
            )?;
            verify_sources(&source_fingerprints)?;

            let mut requests = Vec::new();
            let mut ordered = handles.clone();
            ordered.sort_by_key(|(_, item)| item.preview.order);
            for (decision, item) in ordered {
                if decision.action == SkillImportAction::Skip {
                    continue;
                }
                let root = item
                    .staged_root
                    .as_ref()
                    .ok_or_else(|| SkillStoreError::InvalidTargetName("技能项没有暂存根".into()))?;
                let expected = item.staged_fingerprint.as_ref().ok_or_else(|| {
                    SkillStoreError::InvalidTargetName("技能项缺少暂存内容指纹".into())
                })?;
                let fixed_source = FixedStagedSkillRoot::open_expected(root, expected)?;
                let name = item
                    .preview
                    .name
                    .as_deref()
                    .ok_or_else(|| SkillStoreError::InvalidTargetName("技能名无效".into()))?;
                let baseline = baselines.capture_locked(revision, name)?;
                let replace = decision.action == SkillImportAction::Replace;
                let expected_presence = if replace {
                    TargetPresence::Present
                } else {
                    TargetPresence::Absent
                };
                if baseline.presence != expected_presence
                    || (replace && baseline.target_type != Some(TargetEntryType::Directory))
                {
                    return Err(SkillStoreError::InvalidTargetName(
                        "技能目标 baseline 与所选动作不一致".into(),
                    ));
                }
                requests.push(SkillInstallRequest {
                    item_id: decision.item_id,
                    skill_name: name.to_string(),
                    source: fixed_source,
                    baseline,
                    replace,
                    staging_instance_id: Some(
                        imports
                            .staging_instance()
                            .map_err(state_store_error)?
                            .instance_id()
                            .to_string(),
                    ),
                });
            }
            // 所有 selected item 都已打开并固定后、任何 revision/事务写入前，再做
            // 一轮整批 staged identity 与权威 baseline 复核。不能在 item1 写完后才
            // 发现 item2 已变化。
            for request in &requests {
                request.source.verify()?;
                let current = baselines.capture_locked(revision, &request.skill_name)?;
                if current != request.baseline {
                    return Err(SkillStoreError::TargetChanged {
                        target_name: request.skill_name.clone(),
                    });
                }
            }
            Ok(requests)
        },
        || {
            phase_guard
                .borrow_mut()
                .enter_execution(&decisions_for_enter)
                .map(|_| ())
                .map_err(state_store_error)
        },
    );

    let (outcomes, revision) = install.map_err(store_error)?;
    let mut guard = phase_guard.into_inner();
    let catalog_was_invalidated = !outcomes.is_empty();
    for outcome in outcomes {
        let (state, error) = match outcome.error {
            Some(error) => (SkillImportItemState::Failed, Some(error)),
            None => (SkillImportItemState::Succeeded, None),
        };
        guard.record_item_outcome(&outcome.item_id, state, error)?;
    }
    guard.finish(catalog_was_invalidated.then_some(revision.revision));
    imports.result(&batch_id)
}

fn validate_decision_shape(
    preview: &SkillImportBatchPreview,
    decisions: &[SkillImportDecision],
) -> Result<(), SkillCommandError> {
    let mut ids = HashSet::new();
    if decisions
        .iter()
        .any(|decision| !ids.insert(&decision.item_id))
    {
        return Err(invalid("提交决策包含重复 item_id"));
    }
    let expected_state = match preview.phase {
        SkillImportBatchPhase::Validating => SkillImportItemState::Pending,
        SkillImportBatchPhase::RetryValidating => SkillImportItemState::Failed,
        _ => return Err(SkillCommandError::Busy),
    };
    let eligible = preview
        .items
        .iter()
        .filter(|item| item.state == expected_state)
        .map(|item| item.item_id.as_str())
        .collect::<HashSet<_>>();
    if preview.phase == SkillImportBatchPhase::Validating {
        if decisions.len() != eligible.len()
            || decisions
                .iter()
                .any(|decision| !eligible.contains(decision.item_id.as_str()))
        {
            return Err(invalid("首次提交必须恰好覆盖全部 pending 技能项"));
        }
    } else if decisions.is_empty()
        || decisions
            .iter()
            .any(|decision| !eligible.contains(decision.item_id.as_str()))
    {
        return Err(invalid("重试只接受 failed 技能项"));
    }
    Ok(())
}

fn validate_actions(
    items: &[SkillImportItem],
    decisions: &HashMap<String, SkillImportAction>,
    catalog: &[SkillInfo],
    executable_content_reviewed: bool,
) -> Result<(), SkillStoreError> {
    let mut selected_keys = HashSet::new();
    for item in items {
        let Some(action) = decisions.get(&item.item_id).copied() else {
            continue;
        };
        if matches!(item.validity, SkillImportValidity::Invalid { .. })
            && action != SkillImportAction::Skip
        {
            return Err(SkillStoreError::InvalidTargetName(
                "无效技能项只能跳过".into(),
            ));
        }
        if action == SkillImportAction::Skip {
            continue;
        }
        if item.risks.iter().any(|risk| {
            risk.kind == SkillImportRiskKind::ExecutableContent && !risk.paths.is_empty()
        }) && !executable_content_reviewed
        {
            return Err(SkillStoreError::InvalidTargetName(
                "必须确认已经检查可执行内容".into(),
            ));
        }
        let key = item
            .portable_name_key
            .as_deref()
            .ok_or_else(|| SkillStoreError::InvalidTargetName("技能名称无效".into()))?;
        if !selected_keys.insert(key) {
            return Err(SkillStoreError::InvalidTargetName(
                "批次内同名候选最多选择一个".into(),
            ));
        }
        let conflict = catalog_conflict(item.name.as_deref(), Some(key), catalog);
        let legal = match conflict {
            SkillImportConflict::None | SkillImportConflict::BuiltinSkill { .. } => {
                action == SkillImportAction::Install
            }
            SkillImportConflict::UserSkill { .. } => action == SkillImportAction::Replace,
            SkillImportConflict::UserNameCase { .. }
            | SkillImportConflict::BuiltinNameCase { .. }
            | SkillImportConflict::BatchDuplicate { .. } => false,
        };
        if !legal {
            return Err(SkillStoreError::InvalidTargetName(
                "技能冲突动作与当前 catalog 不一致".into(),
            ));
        }
    }
    Ok(())
}

fn verify_sources(
    fingerprints: &[(String, PathBuf, Option<StagedSourceFingerprint>)],
) -> Result<(), SkillStoreError> {
    for (_, path, fingerprint) in fingerprints {
        match fingerprint {
            Some(StagedSourceFingerprint::Folder(expected)) => {
                verify_folder_source_fingerprint(path, expected).map_err(|error| {
                    SkillStoreError::InvalidTargetName(format!("文件夹来源指纹已变化: {error}"))
                })?;
            }
            Some(StagedSourceFingerprint::Archive(expected)) => {
                verify_archive_source_fingerprint(path, expected).map_err(|error| {
                    SkillStoreError::InvalidTargetName(format!("ZIP 来源指纹已变化: {error}"))
                })?;
            }
            None => {}
        }
    }
    Ok(())
}

fn read_text_from_expected(
    root: &Path,
    expected: &FixedTreeSnapshot,
    relative: &str,
    offset: u64,
    limit: u64,
) -> Result<SkillImportTextChunk, SkillCommandError> {
    if limit == 0 || limit > MAX_TEXT_PREVIEW_BYTES {
        return Err(invalid("文本预览单次 limit 必须在 1 到 1 MiB 之间"));
    }
    let fixed = FixedStagedSkillRoot::open_expected(root, expected).map_err(file_store_error)?;
    // 最多读取 1 MiB；小 limit 至少取 4 bytes，确保一个合法 Unicode scalar 不会
    // 因分页太小被误判为非法。大 limit 的尾部不完整 scalar 会回退到字符边界。
    let read_limit = limit.max(4).min(MAX_TEXT_PREVIEW_BYTES) as usize;
    let (bytes, size) = fixed
        .read_file_range(relative, offset, read_limit)
        .map_err(file_store_error)?;
    if offset > size {
        return Err(file_changed(relative));
    }
    let valid_len = match std::str::from_utf8(&bytes) {
        Ok(_) => bytes.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(_) => return Err(invalid("文件不是 UTF-8 文本，或 offset 不在字符边界")),
    };
    if !bytes.is_empty() && valid_len == 0 {
        return Err(invalid("文件不是 UTF-8 文本，或 offset 不在字符边界"));
    }
    let valid = std::str::from_utf8(&bytes[..valid_len]).expect("valid_up_to 保证 UTF-8");
    let budget = limit as usize;
    let mut consumed = valid
        .char_indices()
        .map(|(index, character)| index + character.len_utf8())
        .take_while(|end| *end <= budget)
        .last()
        .unwrap_or(0);
    if consumed == 0 {
        // limit=1 遇到中文/emoji 时仍返回首个 scalar；scalar 最多 4 bytes，且总响应
        // 仍受 MAX_TEXT_PREVIEW_BYTES 硬上限约束。
        consumed = valid.chars().next().map(char::len_utf8).unwrap_or_default();
    }
    let text = valid[..consumed].to_string();
    let next_offset = offset + consumed as u64;
    Ok(SkillImportTextChunk {
        relative_path: relative.into(),
        offset,
        text,
        next_offset,
        eof: next_offset == size,
    })
}

fn file_changed(relative: &str) -> SkillCommandError {
    SkillCommandError::FileChanged {
        relative_path: relative.into(),
    }
}

fn file_store_error(error: SkillStoreError) -> SkillCommandError {
    match error {
        SkillStoreError::CandidateChanged { entry_path }
        | SkillStoreError::TargetChanged {
            target_name: entry_path,
        } => file_changed(&entry_path),
        SkillStoreError::UnsafeObject { relative_path, .. } => file_changed(&relative_path),
        other => store_error(other),
    }
}

fn normalize_relative(value: &str) -> Result<String, SkillCommandError> {
    let path = Path::new(value);
    if value.is_empty() || path.is_absolute() {
        return Err(invalid("relative_path 必须是非空相对路径"));
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part
                    .to_str()
                    .ok_or_else(|| invalid("relative_path 必须是 UTF-8"))?;
                if part.is_empty() || part.contains(['/', '\\']) {
                    return Err(invalid("relative_path 包含非法组件"));
                }
                parts.push(part);
            }
            _ => return Err(invalid("relative_path 不得包含点、父跳转或前缀")),
        }
    }
    Ok(parts.join("/"))
}

fn preview_contains_file(files: &[SkillImportFile], relative: &str) -> bool {
    files.iter().any(|file| {
        (file.relative_path == relative && file.kind == SkillImportFileKind::File)
            || preview_contains_file(&file.children, relative)
    })
}

fn random_id(prefix: &str) -> Result<String, SkillCommandError> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|error| io_error(error.to_string()))?;
    Ok(format!(
        "{prefix}-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

fn invalid(message: impl Into<String>) -> SkillCommandError {
    SkillCommandError::InvalidRequest {
        message: message.into(),
    }
}

fn io_error(message: impl Into<String>) -> SkillCommandError {
    SkillCommandError::Io {
        message: message.into(),
    }
}

fn lease_error(error: super::lease::LeaseError) -> SkillCommandError {
    match error {
        super::lease::LeaseError::CleanupFailed { target, message } => {
            SkillCommandError::CleanupFailed {
                target: target.into(),
                message,
            }
        }
        error => io_error(error.to_string()),
    }
}

fn state_store_error(error: SkillCommandError) -> SkillStoreError {
    SkillStoreError::InvalidTargetName(match error {
        SkillCommandError::InvalidRequest { message } | SkillCommandError::Io { message } => {
            message
        }
        other => format!("批次状态变化: {other:?}"),
    })
}

fn command_store_error(error: SkillCommandError) -> SkillStoreError {
    SkillStoreError::InvalidTargetName(match error {
        SkillCommandError::InvalidRequest { message } | SkillCommandError::Io { message } => {
            message
        }
        other => format!("暂存内容复核失败: {other:?}"),
    })
}

fn store_error(error: SkillStoreError) -> SkillCommandError {
    match error {
        SkillStoreError::InvalidTargetName(message) => invalid(message),
        SkillStoreError::CandidateChanged { entry_path } => {
            SkillCommandError::CandidateChanged { entry_path }
        }
        SkillStoreError::RecoveryPending(issues) => SkillCommandError::RecoveryPending { issues },
        SkillStoreError::UnsafeObject {
            relative_path,
            reason,
        } => io_error(format!("技能库对象 {relative_path} 不安全: {reason}")),
        SkillStoreError::TargetChanged { target_name } => {
            io_error(format!("技能目标 {target_name} 已变化"))
        }
        SkillStoreError::Io {
            operation, message, ..
        } => io_error(format!("{operation}失败: {message}")),
        SkillStoreError::RevisionRollback { observed, disk } => {
            io_error(format!("技能库 revision 回退: {observed} -> {disk}"))
        }
        SkillStoreError::StoreIdChanged { .. } => io_error("技能库标识已变化"),
        SkillStoreError::RevisionOverflow => invalid("技能库 revision 已到上限"),
        SkillStoreError::CorruptRevision(message) => {
            io_error(format!("skills.revision 损坏: {message}"))
        }
    }
}

#[cfg(unix)]
mod secure_tree {
    use super::*;
    use std::ffi::{OsStr, OsString};
    use std::fs::File;
    use std::io::{Read, Seek, SeekFrom};
    use std::os::fd::OwnedFd;
    use std::os::unix::ffi::OsStringExt as _;

    use rustix::fs::{fstat, openat, Dir, FileType, Mode, OFlags, CWD};
    use sha2::{Digest as _, Sha256};

    fn directory_flags() -> OFlags {
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC
    }

    fn open_root(path: &Path) -> Result<OwnedFd, SkillCommandError> {
        let fd = openat(CWD, path, directory_flags(), Mode::empty())
            .map_err(|error| io_error(format!("安全打开暂存技能根失败: {error}")))?;
        let stat = fstat(&fd).map_err(|error| io_error(format!("复核暂存技能根失败: {error}")))?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::Directory {
            return Err(invalid("暂存技能根不是普通目录"));
        }
        Ok(fd)
    }

    fn open_directory(root: &OwnedFd, relative: &[String]) -> Result<OwnedFd, SkillCommandError> {
        let mut current = openat(root, ".", directory_flags(), Mode::empty())
            .map_err(|error| io_error(format!("复制暂存根句柄失败: {error}")))?;
        for component in relative {
            current = openat(
                &current,
                OsStr::new(component),
                directory_flags(),
                Mode::empty(),
            )
            .map_err(|_| invalid("暂存路径包含链接、特殊对象或已逃逸"))?;
            let stat = fstat(&current).map_err(|error| io_error(error.to_string()))?;
            if FileType::from_raw_mode(stat.st_mode) != FileType::Directory {
                return Err(invalid("暂存路径组件不是普通目录"));
            }
        }
        Ok(current)
    }

    fn open_file(root: &OwnedFd, relative: &str) -> Result<File, SkillCommandError> {
        let parts = relative.split('/').collect::<Vec<_>>();
        let (name, parents) = parts.split_last().ok_or_else(|| invalid("文件路径为空"))?;
        let parents = parents
            .iter()
            .map(|part| (*part).to_string())
            .collect::<Vec<_>>();
        let parent = open_directory(root, &parents)?;
        let fd = openat(
            &parent,
            OsStr::new(name),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| invalid("暂存文件包含链接、特殊对象或已逃逸"))?;
        let stat = fstat(&fd).map_err(|error| io_error(error.to_string()))?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile {
            return Err(invalid("文本预览只允许普通文件"));
        }
        Ok(File::from(fd))
    }

    pub(super) fn read_small_file(
        root_path: &Path,
        relative: &str,
        maximum: u64,
    ) -> Result<Vec<u8>, SkillCommandError> {
        let relative = normalize_relative(relative)?;
        let root = open_root(root_path)?;
        let mut file = open_file(&root, &relative)?;
        let mut limited = (&mut file).take(maximum.saturating_add(1));
        let mut bytes = Vec::new();
        limited
            .read_to_end(&mut bytes)
            .map_err(|error| io_error(format!("读取暂存文件失败: {error}")))?;
        if bytes.len() as u64 > maximum {
            return Err(invalid("暂存文件超过读取上限"));
        }
        Ok(bytes)
    }

    pub(super) fn read_text_chunk(
        root_path: &Path,
        relative: &str,
        offset: u64,
        limit: u64,
    ) -> Result<SkillImportTextChunk, SkillCommandError> {
        if limit == 0 || limit > MAX_TEXT_PREVIEW_BYTES {
            return Err(invalid("文本预览单次 limit 必须在 1 到 1 MiB 之间"));
        }
        let relative = normalize_relative(relative)?;
        let root = open_root(root_path)?;
        let mut file = open_file(&root, &relative)?;
        let size = file
            .metadata()
            .map_err(|error| io_error(error.to_string()))?
            .len();
        if offset > size {
            return Err(invalid("文本预览 offset 超出文件末尾"));
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| io_error(error.to_string()))?;
        let wanted = limit.min(size - offset) as usize;
        let mut bytes = vec![0u8; wanted];
        file.read_exact(&mut bytes)
            .map_err(|error| io_error(format!("读取文本分页失败: {error}")))?;
        let consumed = match std::str::from_utf8(&bytes) {
            Ok(_) => bytes.len(),
            Err(error) if error.error_len().is_none() && error.valid_up_to() > 0 => {
                error.valid_up_to()
            }
            Err(_) => return Err(invalid("文件不是 UTF-8 文本，或 offset 位于字符中间")),
        };
        bytes.truncate(consumed);
        let text = String::from_utf8(bytes).expect("上方已经验证 UTF-8");
        let next_offset = offset + consumed as u64;
        Ok(SkillImportTextChunk {
            relative_path: relative,
            offset,
            text,
            next_offset,
            eof: next_offset == size,
        })
    }

    pub(super) fn fingerprint(root_path: &Path) -> Result<String, SkillCommandError> {
        let root = open_root(root_path)?;
        let mut records = Vec::<(String, u8, u64, String)>::new();
        scan(&root, &[], "", &mut records)?;
        records.sort_by(|left, right| left.0.cmp(&right.0));
        let mut digest = Sha256::new();
        for (path, kind, size, hash) in records {
            digest.update((path.len() as u64).to_le_bytes());
            digest.update(path.as_bytes());
            digest.update([kind]);
            digest.update(size.to_le_bytes());
            digest.update(hash.as_bytes());
        }
        Ok(format!("{:x}", digest.finalize()))
    }

    fn scan(
        root: &OwnedFd,
        components: &[String],
        relative: &str,
        output: &mut Vec<(String, u8, u64, String)>,
    ) -> Result<(), SkillCommandError> {
        let directory = open_directory(root, components)?;
        let mut stream = Dir::read_from(&directory).map_err(|error| io_error(error.to_string()))?;
        let mut names = Vec::new();
        while let Some(entry) = stream.read() {
            let entry = entry.map_err(|error| io_error(error.to_string()))?;
            let bytes = entry.file_name().to_bytes();
            if bytes == b"." || bytes == b".." {
                continue;
            }
            let name = OsString::from_vec(bytes.to_vec());
            let text = name
                .to_str()
                .ok_or_else(|| invalid("暂存路径必须是 UTF-8"))?
                .to_string();
            if text.contains(['/', '\\']) {
                return Err(invalid("暂存路径组件非法"));
            }
            names.push(text);
        }
        names.sort();
        for name in names {
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            let fd = openat(
                &directory,
                OsStr::new(&name),
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| invalid("暂存树包含链接或特殊对象"))?;
            let stat = fstat(&fd).map_err(|error| io_error(error.to_string()))?;
            match FileType::from_raw_mode(stat.st_mode) {
                FileType::Directory => {
                    output.push((path.clone(), 0, 0, String::new()));
                    let mut next = components.to_vec();
                    next.push(name.clone());
                    scan(root, &next, &path, output)?;
                }
                FileType::RegularFile => {
                    let mut file = File::from(fd);
                    let mut hash = Sha256::new();
                    let mut buffer = [0u8; 64 * 1024];
                    let mut size = 0u64;
                    loop {
                        let read = file
                            .read(&mut buffer)
                            .map_err(|error| io_error(error.to_string()))?;
                        if read == 0 {
                            break;
                        }
                        size += read as u64;
                        hash.update(&buffer[..read]);
                    }
                    output.push((path, 1, size, format!("{:x}", hash.finalize())));
                }
                _ => return Err(invalid("暂存树包含链接或特殊文件")),
            }
        }
        Ok(())
    }
}

#[cfg(not(unix))]
mod secure_tree {
    use super::*;
    pub(super) fn read_small_file(_: &Path, _: &str, _: u64) -> Result<Vec<u8>, SkillCommandError> {
        Err(invalid("当前平台不支持固定句柄读取"))
    }
    pub(super) fn read_text_chunk(
        _: &Path,
        _: &str,
        _: u64,
        _: u64,
    ) -> Result<SkillImportTextChunk, SkillCommandError> {
        Err(invalid("当前平台不支持固定句柄读取"))
    }
    pub(super) fn fingerprint(_: &Path) -> Result<String, SkillCommandError> {
        Err(invalid("当前平台不支持固定句柄复核"))
    }
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
