use super::*;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

#[derive(serde::Deserialize)]
struct DesktopNameFixtures {
    schema_version: u32,
    cases: Vec<DesktopNameFixture>,
}

#[derive(serde::Deserialize)]
struct DesktopNameFixture {
    id: String,
    fallback_name: String,
    #[serde(default)]
    content: String,
    repeat: Option<DesktopRepeatFixture>,
    #[serde(default)]
    desktop_zip_virtual_root: bool,
    expected_name: Option<String>,
}

#[derive(serde::Deserialize)]
struct DesktopRepeatFixture {
    text: String,
    bytes: usize,
}

impl DesktopNameFixture {
    fn skill_md(&self) -> String {
        let Some(repeat) = &self.repeat else {
            return self.content.clone();
        };
        assert_eq!(
            repeat.text.len(),
            1,
            "{}: repeat text must be one byte",
            self.id
        );
        repeat.text.repeat(repeat.bytes)
    }
}

fn desktop_name_fixtures() -> DesktopNameFixtures {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/skill_import/testdata/skill-name-resolution.json");
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

struct TestRoot(PathBuf);

impl TestRoot {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "monkeycode-import-command-{label}-{}",
            random_id("test").unwrap()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write_skill(root: &Path, name: &str, extra: &[(&str, &[u8])]) -> PathBuf {
    let skill = root.join(name);
    fs::create_dir_all(&skill).unwrap();
    fs::write(
        skill.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: test\n---\n# {name}\n"),
    )
    .unwrap();
    for (path, content) in extra {
        let target = skill.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(target, content).unwrap();
    }
    skill
}

fn write_zip_skill(path: &Path, name: &str) {
    let file = fs::File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    writer
        .start_file(
            format!("{name}/SKILL.md"),
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    writer
        .write_all(format!("---\nname: {name}\n---\n# {name}\n").as_bytes())
        .unwrap();
    writer.finish().unwrap();
}

fn fixture(
    label: &str,
    skill_name: &str,
) -> (TestRoot, SkillImportState, SkillStoreState, PathBuf) {
    let root = TestRoot::new(label);
    let config = root.path().join("config");
    fs::create_dir_all(&config).unwrap();
    let store = SkillStoreState::new(config.clone()).unwrap();
    let state =
        SkillImportState::with_staging_instance(StagingInstance::open(&config, |_| false).unwrap());
    let source_parent = root.path().join("sources");
    fs::create_dir_all(&source_parent).unwrap();
    let source = write_skill(&source_parent, skill_name, &[]);
    (root, state, store, source)
}

fn stage_one(state: &SkillImportState, store: &SkillStoreState, source: PathBuf) -> String {
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();
    let staged = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Folders,
        vec![source],
        0,
    )
    .unwrap();
    state.complete_source_picks(&token, staged).unwrap();
    let preview = state.current().batch.unwrap();
    let catalog = store.snapshot(None).unwrap();
    state
        .update_collecting_conflicts("batch", &conflict_updates(&preview.items, &catalog.skills))
        .unwrap();
    state.current().batch.unwrap().items[0].item_id.clone()
}

fn decision(item_id: &str, action: SkillImportAction) -> Vec<SkillImportDecision> {
    vec![SkillImportDecision {
        item_id: item_id.into(),
        action,
    }]
}

fn catalog_skill(name: &str, source: &str) -> SkillInfo {
    SkillInfo {
        name: name.into(),
        description: String::new(),
        source: source.into(),
        content: String::new(),
        overrides: false,
        default_enabled: false,
    }
}

#[test]
fn desktop_name_fixtures_match_preview_and_install_targets() {
    let fixtures = desktop_name_fixtures();
    assert_eq!(fixtures.schema_version, 1);

    for case in fixtures.cases {
        let root = TestRoot::new(&format!("desktop-name-{}", case.id));
        let config = root.path().join("config");
        fs::create_dir_all(&config).unwrap();
        let store = SkillStoreState::new(config.clone()).unwrap();
        let state = SkillImportState::with_staging_instance(
            StagingInstance::open(&config, |_| false).unwrap(),
        );
        let source_parent = root.path().join("sources");
        fs::create_dir_all(&source_parent).unwrap();
        let (source_kind, source) = if case.desktop_zip_virtual_root {
            let source = source_parent.join(format!("{}.zip", case.fallback_name));
            let mut writer = zip::ZipWriter::new(fs::File::create(&source).unwrap());
            writer
                .start_file("SKILL.md", zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(case.skill_md().as_bytes()).unwrap();
            writer.finish().unwrap();
            (SkillImportSourceKind::Zips, source)
        } else {
            let source = source_parent.join(&case.fallback_name);
            fs::create_dir_all(&source).unwrap();
            fs::write(source.join("SKILL.md"), case.skill_md()).unwrap();
            (SkillImportSourceKind::Folders, source)
        };

        state.create_batch("batch").unwrap();
        let token = state.reserve_source_pick("batch").unwrap();
        let staged = stage_selected_paths(
            state.staging_instance().unwrap(),
            source_kind,
            vec![source],
            0,
        )
        .unwrap();
        state.complete_source_picks(&token, staged).unwrap();
        let preview = state.current().batch.unwrap();
        assert_eq!(preview.items.len(), 1, "{}: preview item count", case.id);
        let item = &preview.items[0];
        assert_eq!(
            item.name.as_deref(),
            case.expected_name.as_deref(),
            "{}: preview name",
            case.id
        );

        let Some(expected_name) = case.expected_name.as_deref() else {
            assert!(
                matches!(&item.validity, SkillImportValidity::Invalid { reasons } if !reasons.is_empty()),
                "{}: invalid preview",
                case.id
            );
            assert_eq!(
                fs::read_dir(config.join("skills"))
                    .map(|entries| entries.count())
                    .unwrap_or(0),
                0,
                "{}: invalid fixture changed the store",
                case.id
            );
            continue;
        };

        assert_eq!(
            item.validity,
            SkillImportValidity::Valid,
            "{}: valid preview",
            case.id
        );
        state
            .update_collecting_conflicts("batch", &conflict_updates(&preview.items, &[]))
            .unwrap();
        let item_id = item.item_id.clone();
        let guard = state.begin_initial_commit("batch").unwrap();
        let result = commit_blocking(
            state,
            store,
            None,
            "batch".into(),
            decision(&item_id, SkillImportAction::Install),
            true,
            guard,
        )
        .unwrap();
        assert_eq!(result.success_count, 1, "{}: install result", case.id);
        let target = config.join("skills").join(expected_name);
        assert!(
            target.join("SKILL.md").is_file(),
            "{}: install target {}",
            case.id,
            target.display()
        );
        if expected_name != case.fallback_name {
            assert!(
                !config.join("skills").join(&case.fallback_name).exists(),
                "{}: fallback target was used",
                case.id
            );
        }
    }
}

#[test]
fn multi_selection_deduplicates_selection_key_and_keeps_one_source() {
    let (_root, state, store, source) = fixture("dedup", "dedup-skill");
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();
    let staged = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Folders,
        vec![source.clone(), source],
        0,
    )
    .unwrap();
    assert_eq!(staged.len(), 1);
    state.complete_source_picks(&token, staged).unwrap();
    assert_eq!(state.current().batch.unwrap().sources.len(), 1);
    assert_eq!(store.current_revision_for_test(), 0);
}

#[test]
fn multi_folder_and_multi_zip_selections_merge_in_selection_order() {
    let root = TestRoot::new("multi-folder-zip");
    let config = root.path().join("config");
    fs::create_dir_all(&config).unwrap();
    let state =
        SkillImportState::with_staging_instance(StagingInstance::open(&config, |_| false).unwrap());
    state.create_batch("batch").unwrap();

    let folder_parent = root.path().join("folders");
    fs::create_dir_all(folder_parent.join("first-source")).unwrap();
    fs::create_dir_all(folder_parent.join("second-source")).unwrap();
    let first_folder = write_skill(&folder_parent.join("first-source"), "z-folder", &[]);
    let second_folder = write_skill(&folder_parent.join("second-source"), "a-folder", &[]);
    let folder_token = state.reserve_source_pick("batch").unwrap();
    let folders = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Folders,
        vec![first_folder, second_folder],
        0,
    )
    .unwrap();
    assert_eq!(folders.len(), 2);
    state.complete_source_picks(&folder_token, folders).unwrap();

    let first_zip = root.path().join("z-first.zip");
    let second_zip = root.path().join("a-second.zip");
    write_zip_skill(&first_zip, "z-zip");
    write_zip_skill(&second_zip, "a-zip");
    let zip_token = state.reserve_source_pick("batch").unwrap();
    let zips = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Zips,
        vec![first_zip, second_zip],
        2,
    )
    .unwrap();
    assert_eq!(zips.len(), 2);
    state.complete_source_picks(&zip_token, zips).unwrap();

    let batch = state.current().batch.unwrap();
    assert_eq!(
        batch
            .sources
            .iter()
            .map(|source| (source.order, source.kind, source.display_name.as_str()))
            .collect::<Vec<_>>(),
        [
            (0, SkillImportSourceKind::Folders, "z-folder"),
            (1, SkillImportSourceKind::Folders, "a-folder"),
            (2, SkillImportSourceKind::Zips, "z-first.zip"),
            (3, SkillImportSourceKind::Zips, "a-second.zip"),
        ]
    );
    assert_eq!(
        batch
            .items
            .iter()
            .map(|item| (item.order, item.name.as_deref().unwrap()))
            .collect::<Vec<_>>(),
        [(0, "z-folder"), (1, "a-folder"), (2, "z-zip"), (3, "a-zip")]
    );
}

#[test]
fn dialog_cancel_protocol_preserves_existing_batch_and_store() {
    let (_root, state, store, source) = fixture("dialog-cancel", "kept-skill");
    let _ = stage_one(&state, &store, source);
    let before = state.current().batch.unwrap();
    let token = state.reserve_source_pick("batch").unwrap();
    state.abandon_source_pick(&token).unwrap();
    let after = state.current().batch.unwrap();
    assert_eq!(before.sources, after.sources);
    assert_eq!(before.items, after.items);
    assert_eq!(store.current_revision_for_test(), 0);
}

#[test]
fn invalid_utf8_pick_error_raii_clears_inflight_quota_and_allows_cancel() {
    let (_root, state, _store, source) = fixture("invalid-utf8", "bad-utf8");
    fs::write(source.join("SKILL.md"), [0xff, 0xfe]).unwrap();
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();
    let guard = SourcePickCommandGuard::new_for_test(state.clone(), token);
    let result = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Folders,
        vec![source],
        0,
    );
    assert!(result.is_err());
    drop(guard);
    let batch = state.current().batch.unwrap();
    assert_eq!(batch.in_flight_source_picks, 0);
    assert!(state.allowed_operations("batch").unwrap().cancel);
    assert_eq!(
        state.staging_instance().unwrap().config_usage().unwrap(),
        StagingUsage::default()
    );
    state.cancel("batch").unwrap().cleanup().unwrap();
}

#[test]
fn initial_risk_failure_is_zero_write_and_success_advances_revision() {
    let root = TestRoot::new("risk-revision");
    let config = root.path().join("config");
    fs::create_dir_all(&config).unwrap();
    let store = SkillStoreState::new(config.clone()).unwrap();
    let state =
        SkillImportState::with_staging_instance(StagingInstance::open(&config, |_| false).unwrap());
    let sources = root.path().join("sources");
    fs::create_dir_all(&sources).unwrap();
    let source = write_skill(&sources, "risky", &[("scripts/run.sh", b"echo hi")]);
    let item_id = stage_one(&state, &store, source);

    let guard = state.begin_initial_commit("batch").unwrap();
    let error = commit_blocking(
        state.clone(),
        store.clone(),
        None,
        "batch".into(),
        decision(&item_id, SkillImportAction::Install),
        false,
        guard,
    )
    .unwrap_err();
    assert!(matches!(error, SkillCommandError::InvalidRequest { .. }));
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::Collecting
    );
    assert_eq!(store.current_revision_for_test(), 0);
    assert!(!config.join("skills/risky").exists());

    let guard = state.begin_initial_commit("batch").unwrap();
    let result = commit_blocking(
        state.clone(),
        store.clone(),
        None,
        "batch".into(),
        decision(&item_id, SkillImportAction::Install),
        true,
        guard,
    )
    .unwrap();
    assert_eq!(result.success_count, 1);
    assert_eq!(result.catalog_revision, Some(1));
    assert!(config.join("skills/risky/SKILL.md").is_file());
}

#[test]
fn source_and_staged_toctou_are_rejected_before_store_write() {
    let (_root, state, store, source) = fixture("source-toctou", "source-change");
    let item_id = stage_one(&state, &store, source.clone());
    fs::write(
        source.join("SKILL.md"),
        "---\nname: source-change\n---\nchanged",
    )
    .unwrap();
    let guard = state.begin_initial_commit("batch").unwrap();
    assert!(commit_blocking(
        state.clone(),
        store.clone(),
        None,
        "batch".into(),
        decision(&item_id, SkillImportAction::Install),
        true,
        guard
    )
    .is_err());
    assert_eq!(store.current_revision_for_test(), 0);
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::Collecting
    );

    // 重新建一批，仅篡改暂存副本，覆盖 staged tree 指纹复核。
    state.cancel("batch").unwrap().cleanup().unwrap();
    let source_parent = source.parent().unwrap();
    let clean = write_skill(source_parent, "staged-change", &[]);
    let staged_item = stage_one(&state, &store, clean);
    let handle = state.staged_item("batch", &staged_item).unwrap();
    fs::write(handle.staged_root.unwrap().join("SKILL.md"), "tampered").unwrap();
    let guard = state.begin_initial_commit("batch").unwrap();
    assert!(commit_blocking(
        state.clone(),
        store.clone(),
        None,
        "batch".into(),
        decision(&staged_item, SkillImportAction::Install),
        true,
        guard
    )
    .is_err());
    assert_eq!(store.current_revision_for_test(), 0);
}

#[test]
fn all_selected_staged_handles_are_fixed_before_first_batch_write() {
    let root = TestRoot::new("all-selected-preflight");
    let config = root.path().join("config");
    fs::create_dir_all(&config).unwrap();
    let store = SkillStoreState::new(config.clone()).unwrap();
    let state =
        SkillImportState::with_staging_instance(StagingInstance::open(&config, |_| false).unwrap());
    let collection = root.path().join("collection");
    fs::create_dir_all(&collection).unwrap();
    write_skill(&collection, "first", &[]);
    write_skill(&collection, "second", &[]);
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();
    let staged = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Folders,
        vec![collection],
        0,
    )
    .unwrap();
    state.complete_source_picks(&token, staged).unwrap();
    let preview = state.current().batch.unwrap();
    let catalog = store.snapshot(None).unwrap();
    state
        .update_collecting_conflicts("batch", &conflict_updates(&preview.items, &catalog.skills))
        .unwrap();
    let batch = state.current().batch.unwrap();
    let decisions = batch
        .items
        .iter()
        .map(|item| SkillImportDecision {
            item_id: item.item_id.clone(),
            action: SkillImportAction::Install,
        })
        .collect::<Vec<_>>();
    let second = state.staged_item("batch", &batch.items[1].item_id).unwrap();
    fs::write(second.staged_root.unwrap().join("SKILL.md"), "tampered").unwrap();
    let guard = state.begin_initial_commit("batch").unwrap();
    assert!(commit_blocking(
        state.clone(),
        store.clone(),
        None,
        "batch".into(),
        decisions,
        true,
        guard,
    )
    .is_err());
    assert_eq!(store.current_revision_for_test(), 0);
    assert!(!config.join("skills/first").exists());
    assert!(!config.join("skills/second").exists());
}

#[test]
fn retry_recomputes_current_catalog_conflict_and_keeps_completed() {
    let (_root, state, store, source) = fixture("retry-conflict", "retry-skill");
    let item_id = stage_one(&state, &store, source);
    let mut guard = state.begin_initial_commit("batch").unwrap();
    guard
        .enter_execution(&decision(&item_id, SkillImportAction::Install))
        .unwrap();
    guard
        .record_item_outcome(
            &item_id,
            SkillImportItemState::Failed,
            Some("injected".into()),
        )
        .unwrap();
    guard.finish(None);
    store
        .save_skill("retry-skill", "---\nname: retry-skill\n---\nexisting", None)
        .unwrap();

    let guard = state.begin_retry("batch").unwrap();
    let error = commit_blocking(
        state.clone(),
        store,
        None,
        "batch".into(),
        decision(&item_id, SkillImportAction::Install),
        true,
        guard,
    )
    .unwrap_err();
    assert!(matches!(error, SkillCommandError::InvalidRequest { .. }));
    let batch = state.current().batch.unwrap();
    assert_eq!(batch.phase, SkillImportBatchPhase::Completed);
    assert!(matches!(
        batch.items[0].conflict,
        SkillImportConflict::UserSkill { .. }
    ));
    assert_eq!(batch.items[0].state, SkillImportItemState::Failed);
}

#[test]
fn batch_duplicate_allows_exactly_one_candidate_and_rejects_two_without_writes() {
    let root = TestRoot::new("batch-duplicate");
    let config = root.path().join("config");
    fs::create_dir_all(&config).unwrap();
    let store = SkillStoreState::new(config.clone()).unwrap();
    let state =
        SkillImportState::with_staging_instance(StagingInstance::open(&config, |_| false).unwrap());
    let left_parent = root.path().join("left");
    let right_parent = root.path().join("right");
    fs::create_dir_all(&left_parent).unwrap();
    fs::create_dir_all(&right_parent).unwrap();
    let left = write_skill(&left_parent, "same-skill", &[]);
    let right = write_skill(&right_parent, "same-skill", &[]);

    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();
    let staged = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Folders,
        vec![left, right],
        0,
    )
    .unwrap();
    state.complete_source_picks(&token, staged).unwrap();
    let preview = state.current().batch.unwrap();
    state
        .update_collecting_conflicts("batch", &conflict_updates(&preview.items, &[]))
        .unwrap();
    let items = state.current().batch.unwrap().items;
    assert_eq!(items.len(), 2);
    assert!(items.iter().all(|item| {
        matches!(
            item.conflict,
            SkillImportConflict::BatchDuplicate { ref catalog_conflict }
                if **catalog_conflict == SkillImportConflict::None
        ) && item.duplicate_group.as_deref() == Some("same-skill")
    }));

    let user_exact = conflict_updates(&items, &[catalog_skill("same-skill", "user")]);
    assert!(user_exact.iter().all(|(_, conflict, _)| matches!(
        conflict,
        SkillImportConflict::BatchDuplicate { catalog_conflict }
            if matches!(&**catalog_conflict, SkillImportConflict::UserSkill { .. })
    )));
    let builtin_exact = conflict_updates(&items, &[catalog_skill("same-skill", "builtin")]);
    assert!(builtin_exact.iter().all(|(_, conflict, _)| matches!(
        conflict,
        SkillImportConflict::BatchDuplicate { catalog_conflict }
            if matches!(&**catalog_conflict, SkillImportConflict::BuiltinSkill { .. })
    )));
    let user_case = conflict_updates(&items, &[catalog_skill("Same-Skill", "user")]);
    assert!(user_case.iter().all(|(_, conflict, _)| matches!(
        conflict,
        SkillImportConflict::BatchDuplicate { catalog_conflict }
            if matches!(&**catalog_conflict, SkillImportConflict::UserNameCase { .. })
    )));
    let builtin_case = conflict_updates(&items, &[catalog_skill("Same-Skill", "builtin")]);
    assert!(builtin_case.iter().all(|(_, conflict, _)| matches!(
        conflict,
        SkillImportConflict::BatchDuplicate { catalog_conflict }
            if matches!(&**catalog_conflict, SkillImportConflict::BuiltinNameCase { .. })
    )));

    store
        .save_skill(
            "same-skill",
            "---\nname: same-skill\n---\nexisting catalog value",
            None,
        )
        .unwrap();
    let baseline_revision = store.current_revision_for_test();
    let existing_path = config.join("skills/same-skill/SKILL.md");
    let existing = fs::read(&existing_path).unwrap();

    let both = items
        .iter()
        .map(|item| SkillImportDecision {
            item_id: item.item_id.clone(),
            action: SkillImportAction::Replace,
        })
        .collect::<Vec<_>>();
    // commit 锁内重算必须把 nested catalog 冲突写回 preview，并要求用户重新确认。
    let guard = state.begin_initial_commit("batch").unwrap();
    assert!(commit_blocking(
        state.clone(),
        store.clone(),
        None,
        "batch".into(),
        both.clone(),
        true,
        guard,
    )
    .is_err());
    assert_eq!(store.current_revision_for_test(), baseline_revision);
    assert_eq!(fs::read(&existing_path).unwrap(), existing);
    assert_eq!(
        state.current().batch.unwrap().phase,
        SkillImportBatchPhase::Collecting
    );
    assert!(state
        .current()
        .batch
        .unwrap()
        .items
        .iter()
        .all(|item| matches!(
            item.conflict,
            SkillImportConflict::BatchDuplicate { ref catalog_conflict }
                if matches!(&**catalog_conflict, SkillImportConflict::UserSkill { .. })
        )));

    // 快照确认后仍不能同时选择两个候选，且整批验证发生在任何事务写入前。
    let guard = state.begin_initial_commit("batch").unwrap();
    assert!(commit_blocking(
        state.clone(),
        store.clone(),
        None,
        "batch".into(),
        both.clone(),
        true,
        guard,
    )
    .is_err());
    assert_eq!(store.current_revision_for_test(), baseline_revision);
    assert_eq!(fs::read(&existing_path).unwrap(), existing);

    let choose_one = vec![
        SkillImportDecision {
            item_id: items[0].item_id.clone(),
            action: SkillImportAction::Replace,
        },
        SkillImportDecision {
            item_id: items[1].item_id.clone(),
            action: SkillImportAction::Skip,
        },
    ];
    let guard = state.begin_initial_commit("batch").unwrap();
    let result =
        commit_blocking(state, store, None, "batch".into(), choose_one, true, guard).unwrap();
    assert_eq!(result.success_count, 1);
    assert_eq!(result.skipped_count, 1);
    assert_eq!(result.failure_count, 0);
    assert!(existing_path.is_file());
    assert_ne!(fs::read(existing_path).unwrap(), existing);
}

#[test]
fn catalog_conflict_distinguishes_user_builtin_exact_and_case_variants() {
    let catalog = [
        catalog_skill("UserExact", "user"),
        catalog_skill("UserCase", "user"),
        catalog_skill("BuiltinExact", "builtin"),
        catalog_skill("BuiltinCase", "builtin"),
    ];
    assert_eq!(
        catalog_conflict(Some("UserExact"), Some("userexact"), &catalog),
        SkillImportConflict::UserSkill {
            existing_name: "UserExact".into()
        }
    );
    assert_eq!(
        catalog_conflict(Some("usercase"), Some("usercase"), &catalog),
        SkillImportConflict::UserNameCase {
            existing_name: "UserCase".into()
        }
    );
    assert_eq!(
        catalog_conflict(Some("BuiltinExact"), Some("builtinexact"), &catalog),
        SkillImportConflict::BuiltinSkill {
            existing_name: "BuiltinExact".into()
        }
    );
    assert_eq!(
        catalog_conflict(Some("builtincase"), Some("builtincase"), &catalog),
        SkillImportConflict::BuiltinNameCase {
            existing_name: "BuiltinCase".into()
        }
    );
}

#[test]
fn builtin_exact_conflict_allows_explicit_override_install() {
    let (root, state, store, source) = fixture("builtin", "builtin-skill");
    let builtin = root.path().join("builtin");
    write_skill(&builtin, "builtin-skill", &[]);
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();
    let staged = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Folders,
        vec![source],
        0,
    )
    .unwrap();
    state.complete_source_picks(&token, staged).unwrap();
    let catalog = store.snapshot(Some(&builtin)).unwrap();
    let preview = state.current().batch.unwrap();
    state
        .update_collecting_conflicts("batch", &conflict_updates(&preview.items, &catalog.skills))
        .unwrap();
    let item_id = state.current().batch.unwrap().items[0].item_id.clone();
    assert!(matches!(
        state.current().batch.unwrap().items[0].conflict,
        SkillImportConflict::BuiltinSkill { .. }
    ));
    let guard = state.begin_initial_commit("batch").unwrap();
    let result = commit_blocking(
        state,
        store,
        Some(builtin),
        "batch".into(),
        decision(&item_id, SkillImportAction::Install),
        true,
        guard,
    )
    .unwrap();
    assert_eq!(result.success_count, 1);
}

#[test]
fn text_pagination_handles_small_scalars_max_boundary_and_root_replacement() {
    let root = TestRoot::new("read-text");
    let mut boundary = "a".repeat(MAX_TEXT_PREVIEW_BYTES as usize - 1);
    boundary.push('中');
    let skill = write_skill(
        root.path(),
        "reader",
        &[
            ("notes.txt", "中😀abc".as_bytes()),
            ("boundary.txt", boundary.as_bytes()),
        ],
    );
    let expected = FixedStagedSkillRoot::capture(&skill).unwrap();
    let chinese = read_text_from_expected(&skill, &expected, "notes.txt", 0, 1).unwrap();
    assert_eq!(chinese.text, "中");
    let emoji = read_text_from_expected(&skill, &expected, "notes.txt", 3, 1).unwrap();
    assert_eq!(emoji.text, "😀");
    let rest = read_text_from_expected(&skill, &expected, "notes.txt", 7, 3).unwrap();
    assert_eq!(rest.text, "abc");
    assert!(rest.eof);
    assert!(read_text_from_expected(&skill, &expected, "notes.txt", 1, 4).is_err());

    let max = read_text_from_expected(&skill, &expected, "boundary.txt", 0, MAX_TEXT_PREVIEW_BYTES)
        .unwrap();
    assert_eq!(max.text.len(), MAX_TEXT_PREVIEW_BYTES as usize - 1);
    assert!(!max.eof);
    assert!(normalize_relative("../outside").is_err());

    // 整体替换技能根后 expected identity 不匹配；必须返回局部 changed，不能读取
    // replacement 中的内容。
    let old = root.path().join("reader-old");
    fs::rename(&skill, &old).unwrap();
    let replacement = write_skill(root.path(), "reader", &[("notes.txt", b"REPLACEMENT")]);
    let error = read_text_from_expected(&replacement, &expected, "notes.txt", 0, 8).unwrap_err();
    assert!(matches!(error, SkillCommandError::FileChanged { .. }));

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(old.join("notes.txt"), old.join("linked.txt")).unwrap();
        assert!(FixedStagedSkillRoot::capture(&old).is_err());
    }
}

#[test]
fn per_item_transaction_failure_continues_and_result_is_cumulative() {
    let root = TestRoot::new("continue");
    let config = root.path().join("config");
    fs::create_dir_all(&config).unwrap();
    let store = SkillStoreState::new(config.clone()).unwrap();
    let state =
        SkillImportState::with_staging_instance(StagingInstance::open(&config, |_| false).unwrap());
    let collection = root.path().join("collection");
    fs::create_dir_all(&collection).unwrap();
    write_skill(&collection, "first-skill", &[]);
    write_skill(&collection, "second-skill", &[]);
    state.create_batch("batch").unwrap();
    let token = state.reserve_source_pick("batch").unwrap();
    let staged = stage_selected_paths(
        state.staging_instance().unwrap(),
        SkillImportSourceKind::Folders,
        vec![collection],
        0,
    )
    .unwrap();
    state.complete_source_picks(&token, staged).unwrap();
    let catalog = store.snapshot(None).unwrap();
    let preview = state.current().batch.unwrap();
    state
        .update_collecting_conflicts("batch", &conflict_updates(&preview.items, &catalog.skills))
        .unwrap();
    let decisions = state
        .current()
        .batch
        .unwrap()
        .items
        .into_iter()
        .map(|item| SkillImportDecision {
            item_id: item.item_id,
            action: SkillImportAction::Install,
        })
        .collect::<Vec<_>>();
    crate::skill_transactions::inject_failure_for_test("after-prepared-log");
    let guard = state.begin_initial_commit("batch").unwrap();
    let result =
        commit_blocking(state, store, None, "batch".into(), decisions, true, guard).unwrap();
    assert_eq!(result.failure_count, 1);
    assert_eq!(result.success_count, 1);
    assert_eq!(result.skipped_count, 0);
    assert!(config.join("skills/second-skill/SKILL.md").is_file());
}
