use super::*;

use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

struct TestTree {
    root: PathBuf,
}

impl TestTree {
    fn new(label: &str) -> Self {
        let id = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "monkeycode-folder-import-{label}-{}-{id}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        Self { root }
    }

    fn dir(&self, path: &str) {
        fs::create_dir_all(self.root.join(path)).unwrap();
    }

    fn file(&self, path: &str, content: impl AsRef<[u8]>) {
        let path = self.root.join(path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn staging(&self) -> PathBuf {
        self.root.with_file_name(format!(
            "{}-staging",
            self.root.file_name().unwrap().to_string_lossy()
        ))
    }
}

impl Drop for TestTree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        let _ = fs::remove_dir_all(self.staging());
    }
}

fn small_limits() -> FolderLimits {
    FolderLimits {
        manifest_entries: 100,
        entries_per_skill: 100,
        bytes_per_skill: 1024,
        bytes_per_file: 512,
        skill_md_bytes: 256,
        entries_per_batch: 100,
        bytes_per_batch: 4096,
        copy_buffer_bytes: 3,
    }
}

fn stage_with_limits(
    tree: &TestTree,
    limits: FolderLimits,
) -> Result<(StagedFolderSource, FolderBatchUsage), FolderImportError> {
    let mut usage = FolderBatchUsage::default();
    let result = stage_folder_source_inner(&tree.root, &tree.staging(), &mut usage, limits, None)?;
    Ok((result, usage))
}

#[test]
fn root_skill_is_discovered_and_stops_at_root() {
    let tree = TestTree::new("root");
    tree.file("SKILL.md", "# root");
    tree.file("references/readme.txt", "hello");
    tree.file("examples/nested/SKILL.md", "# not another skill");

    let manifest = preflight_folder(&tree.root).unwrap();
    assert_eq!(discover_folder_skills(&manifest), ["."]);

    let mut usage = FolderBatchUsage::default();
    let staged = stage_folder_source(&tree.root, &tree.staging(), &mut usage).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(staged.skills[0].relative_root, ".");
    assert!(tree.staging().join("SKILL.md").is_file());
    assert!(tree.staging().join("examples/nested/SKILL.md").is_file());
}

#[test]
fn deep_and_compatibility_skills_are_found_in_stable_order() {
    let tree = TestTree::new("deep-compatible");
    tree.file("z-wrapper/skills/zeta/SKILL.md", "z");
    tree.file(".ohmyagent/skills/ohmy/SKILL.md", "o");
    tree.file(".claude/skills/claude/SKILL.md", "c");
    tree.file(".agents/skills/agent/SKILL.md", "a");
    tree.file("a-wrapper/deep/alpha/SKILL.md", "alpha");

    let manifest = preflight_folder(&tree.root).unwrap();
    assert_eq!(
        discover_folder_skills(&manifest),
        [
            ".agents/skills/agent",
            ".claude/skills/claude",
            ".ohmyagent/skills/ohmy",
            "a-wrapper/deep/alpha",
            "z-wrapper/skills/zeta",
        ]
    );
}

#[test]
fn excluded_directories_and_platform_metadata_are_not_discovered_or_copied() {
    let tree = TestTree::new("excluded");
    for directory in [".git", "__MACOSX", ".imports", ".backups", ".transactions"] {
        tree.file(&format!("{directory}/hidden/SKILL.md"), "hidden");
    }
    tree.file("visible/SKILL.md", "visible");
    tree.file("visible/.DS_Store", "metadata");
    tree.file("visible/._fork", "metadata");
    tree.file("visible/Thumbs.db", "metadata");

    let (staged, _) = stage_with_limits(&tree, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert_eq!(staged.skills[0].relative_root, "visible");
    assert!(!tree.staging().join("visible/.DS_Store").exists());
    assert!(!tree.staging().join("visible/._fork").exists());
    assert!(!tree.staging().join("visible/Thumbs.db").exists());
}

#[test]
fn discovering_skill_root_skips_nested_skill_discovery() {
    let tree = TestTree::new("skip-nested");
    tree.file("outer/SKILL.md", "outer");
    tree.file("outer/examples/inner/SKILL.md", "inner");
    tree.file("sibling/SKILL.md", "sibling");
    let manifest = preflight_folder(&tree.root).unwrap();
    assert_eq!(discover_folder_skills(&manifest), ["outer", "sibling"]);
}

#[test]
fn empty_directories_count_as_entries() {
    let tree = TestTree::new("empty-directory");
    tree.file("skill/SKILL.md", "x");
    tree.dir("skill/empty");
    let (staged, usage) = stage_with_limits(&tree, small_limits()).unwrap();
    assert_eq!(staged.skills[0].entry_count, 3); // 技能根 + SKILL.md + 空目录
    assert_eq!(usage.entries, 3);
    assert!(tree.staging().join("skill/empty").is_dir());
}

#[cfg(unix)]
#[test]
fn symlink_anywhere_in_source_rejects_entire_source() {
    use std::os::unix::fs::symlink;

    let tree = TestTree::new("symlink");
    tree.file("skill/SKILL.md", "x");
    let outside = TestTree::new("symlink-outside");
    outside.file("secret", "do not copy");
    symlink(outside.root.join("secret"), tree.root.join("skill/link")).unwrap();

    let error = preflight_folder(&tree.root).unwrap_err();
    assert!(matches!(error, FolderImportError::UnsafeEntry { .. }));
    assert!(!tree.staging().exists());
}

#[cfg(unix)]
#[test]
fn fifo_is_rejected_before_it_can_block() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt as _;

    let tree = TestTree::new("fifo");
    tree.file("skill/SKILL.md", "x");
    let path = tree.root.join("skill/pipe");
    let path = CString::new(path.as_os_str().as_bytes()).unwrap();
    let result = unsafe { libc_mkfifo_for_test(path.as_ptr(), 0o600) };
    assert_eq!(result, 0, "mkfifo failed: {}", io::Error::last_os_error());

    let error = preflight_folder(&tree.root).unwrap_err();
    assert!(matches!(error, FolderImportError::UnsafeEntry { .. }));
}

#[cfg(unix)]
unsafe fn libc_mkfifo_for_test(path: *const std::ffi::c_char, mode: u32) -> i32 {
    unsafe extern "C" {
        fn mkfifo(path: *const std::ffi::c_char, mode: u32) -> i32;
    }
    unsafe { mkfifo(path, mode) }
}

#[test]
fn exact_file_skill_manifest_and_batch_boundaries_are_accepted() {
    let tree = TestTree::new("exact-output-limits");
    tree.file("skill/SKILL.md", b"12345678");
    tree.file("skill/data.bin", b"abcdefgh");
    let mut limits = small_limits();
    limits.manifest_entries = 3;
    limits.bytes_per_file = 8;
    limits.skill_md_bytes = 8;
    limits.bytes_per_skill = 16;
    limits.entries_per_skill = 3;
    limits.entries_per_batch = 3;
    limits.bytes_per_batch = 16;

    let (staged, usage) = stage_with_limits(&tree, limits).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert!(staged.skills[0].invalid_reason.is_none());
    assert_eq!(staged.skills[0].entry_count, 3);
    assert_eq!(staged.skills[0].total_size, 16);
    assert_eq!(usage.entries, 3);
    assert_eq!(usage.bytes, 16);
}

#[test]
fn actual_stream_limit_invalidates_growing_or_oversized_file() {
    let tree = TestTree::new("file-limit");
    tree.file("bad/SKILL.md", "ok");
    tree.file("bad/data.bin", b"123456789");
    let mut limits = small_limits();
    limits.bytes_per_file = 8;
    limits.skill_md_bytes = 8;

    let (staged, usage) = stage_with_limits(&tree, limits).unwrap();
    assert_eq!(staged.skills.len(), 1);
    assert!(staged.skills[0]
        .invalid_reason
        .as_deref()
        .unwrap()
        .contains("单个文件"));
    assert_eq!(
        usage,
        FolderBatchUsage {
            skills: 1,
            ..FolderBatchUsage::default()
        }
    );
    assert!(!tree.staging().join("bad").exists());
}

#[test]
fn skill_md_has_its_own_smaller_stream_limit() {
    let tree = TestTree::new("skill-md-limit");
    tree.file("bad/SKILL.md", b"123456789");
    let mut limits = small_limits();
    limits.bytes_per_file = 100;
    limits.skill_md_bytes = 8;

    let (staged, _) = stage_with_limits(&tree, limits).unwrap();
    assert!(staged.skills[0]
        .invalid_reason
        .as_deref()
        .unwrap()
        .contains("SKILL.md"));
}

#[test]
fn skill_level_limit_isolated_and_later_skill_continues() {
    let tree = TestTree::new("skill-isolation");
    tree.file("a-bad/SKILL.md", "ok");
    tree.file("a-bad/big.bin", b"123456789");
    tree.file("b-good/SKILL.md", "good");
    tree.file("b-good/data.txt", "fine");
    let mut limits = small_limits();
    limits.bytes_per_file = 8;

    let (staged, usage) = stage_with_limits(&tree, limits).unwrap();
    assert_eq!(staged.skills.len(), 2);
    assert!(staged.skills[0].invalid_reason.is_some());
    assert!(staged.skills[1].invalid_reason.is_none());
    assert!(!tree.staging().join("a-bad").exists());
    assert_eq!(
        fs::read(tree.staging().join("b-good/data.txt")).unwrap(),
        b"fine"
    );
    assert_eq!(usage.skills, 2, "无效技能也计入批次技能上限");
    assert_eq!(usage.entries, 3); // b-good 技能根 + 两个文件
}

#[test]
fn skill_total_byte_limit_is_streamed_separately_from_file_limit() {
    let tree = TestTree::new("skill-byte-limit");
    tree.file("bad/SKILL.md", "123456");
    tree.file("bad/data.bin", "123456");
    let mut limits = small_limits();
    limits.bytes_per_file = 8;
    limits.skill_md_bytes = 8;
    limits.bytes_per_skill = 10;

    let (staged, usage) = stage_with_limits(&tree, limits).unwrap();
    assert!(staged.skills[0]
        .invalid_reason
        .as_deref()
        .unwrap()
        .contains("技能总大小"));
    assert_eq!(
        usage,
        FolderBatchUsage {
            skills: 1,
            ..FolderBatchUsage::default()
        }
    );
    assert!(!tree.staging().join("bad").exists());
}

#[test]
fn skill_entry_limit_isolated_and_counts_empty_directories() {
    let tree = TestTree::new("entry-isolation");
    tree.file("a-bad/SKILL.md", "x");
    tree.dir("a-bad/empty-one");
    tree.dir("a-bad/empty-two");
    tree.file("b-good/SKILL.md", "x");
    let mut limits = small_limits();
    limits.entries_per_skill = 2;

    let (staged, usage) = stage_with_limits(&tree, limits).unwrap();
    assert!(staged.skills[0].invalid_reason.is_some());
    assert!(staged.skills[1].invalid_reason.is_none());
    assert_eq!(usage.entries, 2); // b-good 技能根 + SKILL.md
}

#[test]
fn folder_skill_batch_limit_rejects_before_staging_and_is_atomic_across_sources() {
    let many = TestTree::new("101-skills");
    for index in 0..101 {
        many.file(&format!("skill-{index}/SKILL.md"), "x");
    }
    let mut usage = FolderBatchUsage::default();
    let error = stage_folder_source(&many.root, &many.staging(), &mut usage).unwrap_err();
    assert_eq!(error, FolderImportError::BatchSkillsExceeded);
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(!many.staging().exists());

    let next = TestTree::new("cross-source-skill-limit");
    next.file("skill/SKILL.md", "x");
    let mut usage = FolderBatchUsage {
        skills: MAX_SKILLS_PER_BATCH,
        entries: 11,
        bytes: 12,
    };
    let original = usage;
    let error = stage_folder_source(&next.root, &next.staging(), &mut usage).unwrap_err();
    assert_eq!(error, FolderImportError::BatchSkillsExceeded);
    assert_eq!(usage, original);
    assert!(!next.staging().exists());
}

#[test]
fn batch_limit_cleans_whole_new_source_and_preserves_usage() {
    let tree = TestTree::new("batch-cleanup");
    tree.file("a/SKILL.md", "123456");
    tree.file("b/SKILL.md", "123456");
    let mut limits = small_limits();
    limits.bytes_per_batch = 10;
    let mut usage = FolderBatchUsage {
        skills: 5,
        entries: 7,
        bytes: 0,
    };

    let error = stage_folder_source_inner(&tree.root, &tree.staging(), &mut usage, limits, None)
        .unwrap_err();
    assert_eq!(error, FolderImportError::BatchBytesExceeded);
    assert_eq!(
        usage,
        FolderBatchUsage {
            skills: 5,
            entries: 7,
            bytes: 0
        }
    );
    assert!(!tree.staging().exists());
}

#[test]
fn batch_entry_limit_cleans_whole_new_source_and_preserves_usage() {
    let tree = TestTree::new("batch-entry-cleanup");
    tree.file("skill/SKILL.md", "x");
    tree.dir("skill/empty");
    let mut limits = small_limits();
    limits.entries_per_batch = 2;
    let mut usage = FolderBatchUsage {
        skills: 6,
        entries: 1,
        bytes: 3,
    };

    let error = stage_folder_source_inner(&tree.root, &tree.staging(), &mut usage, limits, None)
        .unwrap_err();
    assert_eq!(error, FolderImportError::BatchEntriesExceeded);
    assert_eq!(
        usage,
        FolderBatchUsage {
            skills: 6,
            entries: 1,
            bytes: 3
        }
    );
    assert!(!tree.staging().exists());
}

#[test]
fn batch_entries_include_deep_skill_roots_and_shared_ancestors_once() {
    let tree = TestTree::new("shared-ancestor-entries");
    tree.file("wrapper/shared/a/SKILL.md", "a");
    tree.file("wrapper/shared/b/SKILL.md", "b");
    let mut limits = small_limits();
    limits.entries_per_batch = 5;
    let mut usage = FolderBatchUsage::default();

    let error = stage_folder_source_inner(&tree.root, &tree.staging(), &mut usage, limits, None)
        .unwrap_err();
    assert_eq!(error, FolderImportError::BatchEntriesExceeded);
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(
        !tree.staging().exists(),
        "超限必须在创建来源 staging 前失败"
    );

    limits.entries_per_batch = 6;
    let staged =
        stage_folder_source_inner(&tree.root, &tree.staging(), &mut usage, limits, None).unwrap();
    assert_eq!(staged.skills[0].entry_count, 2);
    assert_eq!(staged.skills[1].entry_count, 2);
    assert_eq!(staged.entry_count, 6);
    assert_eq!(usage.entries, 6);
    assert!(tree.staging().join("wrapper/shared/a/SKILL.md").is_file());
    assert!(tree.staging().join("wrapper/shared/b/SKILL.md").is_file());
}

#[test]
fn manifest_directory_enumeration_stops_at_remaining_budget_plus_one() {
    let tree = TestTree::new("manifest-enumeration-budget");
    tree.dir("empty-a");
    tree.dir("empty-b");
    let mut limits = small_limits();
    limits.manifest_entries = 2;
    let mut usage = FolderBatchUsage::default();

    let staged =
        stage_folder_source_inner(&tree.root, &tree.staging(), &mut usage, limits, None).unwrap();
    assert!(staged.skills.is_empty());
    assert!(!tree.staging().exists());

    tree.dir("empty-c");
    let error = stage_folder_source_inner(&tree.root, &tree.staging(), &mut usage, limits, None)
        .unwrap_err();
    assert_eq!(error, FolderImportError::BatchEntriesExceeded);
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(!tree.staging().exists());
}

#[test]
fn manifest_remaining_budget_includes_already_collected_sibling_entries() {
    let tree = TestTree::new("manifest-recursive-budget");
    tree.dir("a/nested");
    tree.dir("b");
    let mut limits = small_limits();
    limits.manifest_entries = 2;
    let mut usage = FolderBatchUsage::default();

    let error = stage_folder_source_inner(&tree.root, &tree.staging(), &mut usage, limits, None)
        .unwrap_err();
    assert_eq!(error, FolderImportError::BatchEntriesExceeded);
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(!tree.staging().exists());
}

#[test]
fn source_cleanup_failure_is_structured_and_preserves_staging_for_recovery() {
    let tree = TestTree::new("source-cleanup-failure");
    tree.file("a/SKILL.md", "123456");
    tree.file("b/SKILL.md", "123456");
    let staging = tree.staging();
    let fail_root = staging.clone();
    let cleanup = move |path: &Path| {
        if path == fail_root {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected cleanup failure",
            ))
        } else {
            Ok(())
        }
    };
    let mut limits = small_limits();
    limits.bytes_per_batch = 10;
    let mut usage = FolderBatchUsage::default();

    let error = stage_folder_source_inner_with_cleanup(
        &tree.root,
        &staging,
        &mut usage,
        limits,
        None,
        Some(&cleanup),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        FolderImportError::CleanupFailed {
            ref relative_path,
            ..
        } if relative_path == "."
    ));
    assert!(staging.exists(), "清理失败时保留来源 staging 供 lease 回收");
    assert_eq!(usage, FolderBatchUsage::default());
    assert!(!error
        .to_string()
        .contains(tree.root.to_string_lossy().as_ref()));
}

#[test]
fn skill_cleanup_failure_is_reported_and_outer_source_cleanup_is_checked() {
    let tree = TestTree::new("skill-cleanup-failure");
    tree.file("bad/SKILL.md", "x");
    tree.file("bad/data.bin", "123456789");
    let cleanup = |path: &Path| {
        if path.ends_with("bad") {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected skill cleanup failure",
            ))
        } else {
            Ok(())
        }
    };
    let mut limits = small_limits();
    limits.bytes_per_file = 8;
    let mut usage = FolderBatchUsage::default();

    let error = stage_folder_source_inner_with_cleanup(
        &tree.root,
        &tree.staging(),
        &mut usage,
        limits,
        None,
        Some(&cleanup),
    )
    .unwrap_err();
    assert!(matches!(error, FolderImportError::CleanupFailed { .. }));
    assert!(
        !tree.staging().exists(),
        "外层显式清理成功后不应留下 staging"
    );
    assert_eq!(usage, FolderBatchUsage::default());
}

#[test]
fn cleanup_metadata_permission_error_cannot_be_misread_as_missing() {
    let tree = TestTree::new("cleanup-metadata-permission");
    let staging = tree.staging();
    let skill_root = RelativePath::parse(Path::new("wrapper/skill")).unwrap();
    let target = staging.join(skill_root.to_path_buf());
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("partial"), "partial").unwrap();
    let denied_target = target.clone();
    let metadata = move |path: &Path| {
        if path == denied_target {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected metadata permission denial",
            ))
        } else {
            fs::symlink_metadata(path)
        }
    };

    let result =
        cleanup_skill_target_with_metadata(&staging, &target, &skill_root, None, &metadata);
    assert!(matches!(
        result,
        Err(FolderImportError::CleanupFailed { .. })
    ));
    assert!(target.join("partial").exists(), "代理错误时部分暂存仍存在");

    // 模拟 stage_folder_source 的外层错误路径：技能清理失败后仍显式尝试整源清理，
    // 且该结果必须可观察，不能依赖 Drop 吞错。
    let mut guard = StagingGuard::new(&staging, None);
    guard.cleanup_explicit().unwrap();
    assert!(!staging.exists());
}

#[test]
fn source_replacement_after_manifest_rejects_and_cleans() {
    let tree = TestTree::new("replace-after-check");
    tree.file("skill/SKILL.md", "original");
    let original = tree.root.join("skill/SKILL.md");
    let old = tree.root.join("skill/old.md");
    let hook = || {
        fs::rename(&original, &old).unwrap();
        fs::write(&original, "replacement").unwrap();
        fs::remove_file(&old).unwrap();
    };
    let mut usage = FolderBatchUsage::default();
    let error = stage_folder_source_inner(
        &tree.root,
        &tree.staging(),
        &mut usage,
        small_limits(),
        Some(&hook),
    )
    .unwrap_err();
    assert!(matches!(error, FolderImportError::SourceChanged { .. }));
    assert!(!tree.staging().exists());
    assert_eq!(usage, FolderBatchUsage::default());
}

#[test]
fn source_growth_after_manifest_is_a_toctou_error() {
    let tree = TestTree::new("growth-after-check");
    tree.file("skill/SKILL.md", "x");
    tree.file("skill/data", "123");
    let data = tree.root.join("skill/data");
    let hook = || {
        let mut file = OpenOptions::new().append(true).open(&data).unwrap();
        file.write_all(b"456789").unwrap();
    };
    let mut usage = FolderBatchUsage::default();
    let error = stage_folder_source_inner(
        &tree.root,
        &tree.staging(),
        &mut usage,
        small_limits(),
        Some(&hook),
    )
    .unwrap_err();
    assert!(matches!(error, FolderImportError::SourceChanged { .. }));
    assert!(!tree.staging().exists());
}

#[test]
fn paths_deeper_than_64_are_rejected() {
    let exact_tree = TestTree::new("exact-depth");
    let exact = (0..63)
        .map(|index| format!("d{index}"))
        .collect::<Vec<_>>()
        .join("/");
    exact_tree.file(&format!("{exact}/SKILL.md"), "x");
    let (staged, _) = stage_with_limits(&exact_tree, small_limits()).unwrap();
    assert_eq!(staged.skills.len(), 1);

    let tree = TestTree::new("depth");
    let deep = (0..65)
        .map(|index| format!("d{index}"))
        .collect::<Vec<_>>()
        .join("/");
    tree.file(&format!("{deep}/SKILL.md"), "x");
    let error = preflight_folder(&tree.root).unwrap_err();
    assert!(matches!(error, FolderImportError::PathTooDeep { .. }));
}

#[test]
fn existing_staging_target_is_rejected_without_deleting_it() {
    let tree = TestTree::new("existing-target");
    tree.file("skill/SKILL.md", "x");
    fs::create_dir(&tree.staging()).unwrap();
    fs::write(tree.staging().join("keep"), "keep").unwrap();
    let mut usage = FolderBatchUsage::default();

    let error = stage_folder_source(&tree.root, &tree.staging(), &mut usage).unwrap_err();
    assert!(matches!(error, FolderImportError::TargetCollision { .. }));
    assert_eq!(fs::read(tree.staging().join("keep")).unwrap(), b"keep");
}

#[test]
fn case_insensitive_collision_index_rejects_file_directory_aliases() {
    let paths = BTreeMap::from([
        (
            RelativePath::parse(Path::new("skill/Node")).unwrap(),
            FolderEntryKind::File,
        ),
        (
            RelativePath::parse(Path::new("skill/node")).unwrap(),
            FolderEntryKind::Directory,
        ),
    ]);
    let error = check_target_path_collisions(&paths, true).unwrap_err();
    assert!(matches!(error, FolderImportError::TargetCollision { .. }));
    assert!(check_target_path_collisions(&paths, false).is_ok());
}

#[test]
fn case_collision_is_rejected_when_source_and_target_volumes_can_express_it() {
    let tree = TestTree::new("case-collision");
    tree.file("Skill/SKILL.md", "upper");
    // 大小写不敏感来源卷无法构造两个不同来源对象，此平台条件不具备测试能力。
    if fs::create_dir(tree.root.join("skill")).is_err() {
        return;
    }
    tree.file("skill/SKILL.md", "lower");
    let staging = tree.staging();
    let target_parent = staging.parent().unwrap();
    if !target_is_case_insensitive(target_parent).unwrap() {
        return;
    }
    let mut usage = FolderBatchUsage::default();
    let error = stage_folder_source(&tree.root, &tree.staging(), &mut usage).unwrap_err();
    assert!(matches!(error, FolderImportError::TargetCollision { .. }));
    assert!(!tree.staging().exists());
}

#[test]
fn errors_never_include_absolute_source_path() {
    let tree = TestTree::new("redaction");
    tree.file("skill/SKILL.md", "x");
    let file = tree.root.join("skill/SKILL.md");
    let hook = || fs::remove_file(&file).unwrap();
    let mut usage = FolderBatchUsage::default();
    let error = stage_folder_source_inner(
        &tree.root,
        &tree.staging(),
        &mut usage,
        small_limits(),
        Some(&hook),
    )
    .unwrap_err();
    assert!(!error
        .to_string()
        .contains(tree.root.to_string_lossy().as_ref()));
}

#[test]
fn platform_backend_is_unified_std_without_handle_pinning() {
    let source = include_str!("folder.rs");
    for forbidden in [
        "NtCreateFile",
        "CreateFileW",
        "OBJ_DONT_REPARSE",
        "FILE_SHARE_READ",
        "windows::",
        "rustix",
        "openat",
        "cfg(windows)",
        "cfg(not(any(unix, windows)))",
        "UnsupportedPlatformSafety",
        "canonicalize",
    ] {
        assert!(
            !source.contains(forbidden),
            "统一 std 平台后端后不得残留平台句柄机: {forbidden}"
        );
    }
    assert_eq!(
        source.matches("mod platform").count(),
        1,
        "folder.rs 只应保留一套统一 platform 实现"
    );
}

#[cfg(windows)]
#[test]
fn windows_same_root_handle_lists_nonempty_directory_from_start_twice() {
    let tree = TestTree::new("windows-list-restart");
    tree.file("alpha.txt", "alpha");
    tree.file("nested/beta.txt", "beta");
    let (root, _) = platform::open_root(&tree.root).unwrap();

    let (first_root, first_entries) =
        platform::list_directory(&root, &RelativePath::root(), 100).unwrap();
    let (second_root, second_entries) =
        platform::list_directory(&root, &RelativePath::root(), 100).unwrap();
    let snapshot = |entries: Vec<PlatformDirectoryEntry>| {
        entries
            .into_iter()
            .map(|entry| (entry.name, entry.stable, entry.platform_executable))
            .collect::<Vec<_>>()
    };

    assert_eq!(first_root, second_root);
    assert!(!first_entries.is_empty());
    assert_eq!(snapshot(first_entries), snapshot(second_entries));
}

#[cfg(windows)]
#[test]
fn windows_preflight_then_verify_succeeds_for_nonempty_tree() {
    let tree = TestTree::new("windows-preflight-verify-restart");
    tree.file("skill/SKILL.md", "# stable");
    tree.file("skill/references/readme.txt", "content");

    let manifest = preflight_folder(&tree.root).unwrap();
    assert!(!manifest.entries.is_empty());
    verify_manifest_unchanged(&manifest).unwrap();
}

#[cfg(windows)]
#[test]
fn windows_backend_enumerates_unicode_tree_and_reads_fixed_file() {
    let tree = TestTree::new("windows-unicode");
    tree.file("技能/资料/说明.txt", "固定内容");
    tree.file("技能/SKILL.md", "# Windows");

    let manifest = preflight_folder(&tree.root).unwrap();
    assert_eq!(discover_folder_skills(&manifest), ["技能"]);
    let entry = manifest
        .entries
        .iter()
        .find(|entry| entry.path.display() == "技能/资料/说明.txt")
        .unwrap();
    let mut file = platform::open_file(&manifest.root, &entry.path, &entry.stable).unwrap();
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, "固定内容".as_bytes());
    assert_eq!(
        platform::metadata_for_open_file(&file).unwrap(),
        entry.stable
    );
}

#[cfg(windows)]
#[test]
fn windows_backend_detects_replaced_path_component() {
    let tree = TestTree::new("windows-root-replaced");
    tree.file("selected/source/SKILL.md", "original");
    let source = tree.root.join("selected/source");
    let manifest = preflight_folder(&source).unwrap();

    fs::rename(tree.root.join("selected"), tree.root.join("moved")).unwrap();
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("SKILL.md"), "replacement").unwrap();

    let error = verify_manifest_unchanged(&manifest).unwrap_err();
    assert!(matches!(error, FolderImportError::SourceChanged { .. }));
}

#[cfg(windows)]
#[test]
fn windows_backend_rejects_directory_reparse_point() {
    use std::os::windows::fs::symlink_dir;

    let tree = TestTree::new("windows-reparse");
    tree.file("skill/SKILL.md", "x");
    let outside = TestTree::new("windows-reparse-outside");
    outside.file("secret", "do not copy");
    if let Err(error) = symlink_dir(&outside.root, tree.root.join("skill/link")) {
        // 非 Developer Mode/无创建符号链接权限的 CI 无法构造 fixture。
        if error.kind() == io::ErrorKind::PermissionDenied {
            return;
        }
        panic!("创建 Windows reparse fixture 失败: {error}");
    }

    let error = preflight_folder(&tree.root).unwrap_err();
    assert!(matches!(error, FolderImportError::UnsafeEntry { .. }));
}
