use std::path::PathBuf;

use super::model::*;
use super::*;
use crate::skills::{
    derive_description, portable_skill_name_key, resolve_import_skill_metadata, valid_skill_name,
};

fn source(id: &str, order: usize) -> SkillImportSource {
    SkillImportSource {
        source_id: id.into(),
        order,
        kind: SkillImportSourceKind::Folders,
        display_name: format!("{id}-display"),
        status: SkillImportSourceStatus::Ready,
        skill_count: 1,
        error: None,
    }
}

fn item(id: &str, source_id: &str, relative_root: &str) -> SkillImportItem {
    SkillImportItem {
        item_id: id.into(),
        source_id: source_id.into(),
        order: usize::MAX,
        source_display_name: String::new(),
        relative_root: relative_root.into(),
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

#[test]
fn import_name_uses_only_top_level_frontmatter() {
    let metadata = resolve_import_skill_metadata(
        "---\nname: TopLevel\ndescription: 顶层描述\nmetadata:\n  name: nested\n  description: 嵌套描述\n---   \n正文\nname: body-name",
        "directory-fallback",
    )
    .unwrap();
    assert_eq!(metadata.name, "TopLevel");
    assert_eq!(metadata.portable_name_key, "toplevel");
    assert_eq!(metadata.description, "顶层描述");
    assert!(!metadata.used_fallback);
}

#[test]
fn import_name_falls_back_to_directory_or_zip_stem() {
    let directory = resolve_import_skill_metadata("# Directory skill", "directory-skill").unwrap();
    assert_eq!(directory.name, "directory-skill");
    assert!(directory.used_fallback);

    let zip =
        resolve_import_skill_metadata("---\ndescription: Zip skill\n---", "bundle-stem").unwrap();
    assert_eq!(zip.name, "bundle-stem");
    assert!(zip.used_fallback);
}

#[test]
fn description_prefers_top_level_declaration_then_body_heading() {
    assert_eq!(
        derive_description(
            "---\ndescription: declared\nmetadata:\n  description: nested\n---\n# Body"
        ),
        "declared"
    );
    assert_eq!(
        derive_description("\n# First heading\nbody"),
        "First heading"
    );
}

#[test]
fn skill_name_rejects_windows_names_and_trailing_dot_or_space() {
    for bad in [
        "CON", "con.md", "PRN", "AUX", "NUL", "COM1", "com9.txt", "LPT1", "lpt9.log", "skill.",
        "skill ", ".", "..",
    ] {
        assert!(!valid_skill_name(bad), "{bad:?} 应当被拒绝");
    }
    assert!(valid_skill_name("console"));
    assert!(valid_skill_name("com10"));
}

#[test]
fn portable_key_is_ascii_lowercase_and_requires_valid_name() {
    assert_eq!(
        portable_skill_name_key("My.Skill_1").as_deref(),
        Some("my.skill_1")
    );
    assert_eq!(portable_skill_name_key("技能"), None);
    assert_eq!(portable_skill_name_key("a/b"), None);
}

#[test]
fn executable_detection_covers_scripts_extensions_and_platform_flag() {
    assert!(is_executable_file("scripts/deploy", false));
    assert!(is_executable_file("nested/SCRIPTS/deploy.txt", false));
    assert!(is_executable_file("tools/check.py", false));
    assert!(is_executable_file("references/plain.txt", true));
    assert!(!is_executable_file("references/plain.txt", false));
    assert!(!is_executable_file("scripts", false));
    assert!(!is_executable_file("nested/scripts", false));
}

#[test]
fn risk_analysis_finds_capabilities_and_sorts_executables() {
    let risks = analyze_skill_risks(
        "---\nallowed-tools: Bash\nhooks: enabled\nmcp-servers: local\nnetwork: required\n---\nRun scripts safely.",
        &["scripts/z.sh".into(), "scripts/a.sh".into(), "scripts/z.sh".into()],
    );
    assert_eq!(
        risks.iter().map(|risk| risk.kind).collect::<Vec<_>>(),
        vec![
            SkillImportRiskKind::ExecutableContent,
            SkillImportRiskKind::Tools,
            SkillImportRiskKind::Scripts,
            SkillImportRiskKind::Hooks,
            SkillImportRiskKind::Mcp,
            SkillImportRiskKind::Network,
        ]
    );
    assert_eq!(risks[0].paths, vec!["scripts/a.sh", "scripts/z.sh"]);
}

#[test]
fn source_and_skill_sorting_is_stable_and_reproducible() {
    let mut sources = vec![source("second", 1), source("first", 0)];
    sort_import_sources(&mut sources);
    assert_eq!(
        sources
            .iter()
            .map(|source| source.source_id.as_str())
            .collect::<Vec<_>>(),
        ["first", "second"]
    );

    let mut items = vec![
        item("b", "second", "a/root"),
        item("c", "first", "z/root"),
        item("a", "first", "a/root"),
    ];
    sort_import_items(&mut items, &sources);
    assert_eq!(
        items
            .iter()
            .map(|item| item.item_id.as_str())
            .collect::<Vec<_>>(),
        ["a", "c", "b"]
    );
    assert_eq!(
        items.iter().map(|item| item.order).collect::<Vec<_>>(),
        [0, 1, 2]
    );
}

#[test]
fn source_preview_serialization_never_contains_absolute_path() {
    let absolute = PathBuf::from("/private/Users/alice/secret/team-skills.zip");
    let preview: SkillImportSource = SkillImportSourcePreviewInput {
        source_id: "source-1".into(),
        order: 0,
        kind: SkillImportSourceKind::Zips,
        source_path: absolute.clone(),
        status: SkillImportSourceStatus::Failed,
        skill_count: 2,
        error: Some(format!("读取来源失败: {}", absolute.display())),
    }
    .into();
    assert_eq!(preview.display_name, "team-skills.zip");
    let json = serde_json::to_string(&preview).unwrap();
    assert!(!json.contains(absolute.to_string_lossy().as_ref()));
    assert!(!json.contains("/private/Users/alice/secret"));
    assert_eq!(
        preview.error.as_deref(),
        Some("读取来源失败: team-skills.zip")
    );

    let mut raw_item = item("item", "source-1", ".");
    raw_item.last_error = Some(format!("读取失败: {}/nested/SKILL.md", absolute.display()));
    let item_preview = with_source_display_name(raw_item, &absolute);
    let item_json = serde_json::to_string(&item_preview).unwrap();
    assert_eq!(item_preview.source_display_name, "team-skills.zip");
    assert_eq!(
        item_preview.last_error.as_deref(),
        Some("读取失败: team-skills.zip/nested/SKILL.md")
    );
    assert!(!item_json.contains("/private/Users/alice/secret"));
}

#[test]
fn serde_enum_contracts_use_kebab_case() {
    assert_eq!(
        serde_json::to_string(&SkillImportBatchPhase::RetryValidating).unwrap(),
        "\"retry-validating\""
    );
    assert_eq!(
        serde_json::to_string(&SkillRecoveryAction::RestoreBackup).unwrap(),
        "\"restore-backup\""
    );
    assert_eq!(
        serde_json::to_value(SkillImportConflict::BatchDuplicate {
            catalog_conflict: Box::new(SkillImportConflict::UserSkill {
                existing_name: "same-skill".into(),
            }),
        })
        .unwrap(),
        serde_json::json!({
            "kind": "batch-duplicate",
            "catalog_conflict": { "kind": "user-skill", "existing_name": "same-skill" },
        })
    );
    let error = SkillCommandError::InvalidRequest {
        message: "bad".into(),
    };
    assert_eq!(
        serde_json::to_value(error).unwrap()["code"],
        "invalid-request"
    );
}
