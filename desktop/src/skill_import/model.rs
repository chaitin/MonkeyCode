//! Rust 壳与 WebView 之间的批量技能导入 serde 契约。

use serde::{Deserialize, Serialize};

pub const MIB: u64 = 1024 * 1024;
pub const GIB: u64 = 1024 * MIB;

pub const MAX_SKILL_NAME_BYTES: usize = 64;
pub const MAX_SOURCES_PER_BATCH: usize = 100;
pub const MAX_SKILLS_PER_BATCH: usize = 100;
pub const MAX_ENTRIES_PER_BATCH: usize = 10_000;
pub const MAX_BYTES_PER_BATCH: u64 = 500 * MIB;
pub const MAX_ENTRIES_PER_SKILL: usize = 1_000;
pub const MAX_BYTES_PER_SKILL: u64 = 50 * MIB;
pub const MAX_STAGING_BYTES_PER_CONFIG: u64 = GIB;
pub const MAX_STAGING_ENTRIES_PER_CONFIG: usize = 20_000;
pub const MAX_ZIP_SOURCE_BYTES: u64 = 500 * MIB;
pub const MAX_ZIP_METADATA_BYTES: u64 = 32 * MIB;
pub const MAX_ENTRIES_PER_ZIP_SOURCE: usize = 10_000;
pub const MAX_PATH_DEPTH: usize = 64;
pub const MAX_BYTES_PER_FILE: u64 = 10 * MIB;
pub const MAX_SKILL_MD_BYTES: u64 = MIB;
pub const MAX_TEXT_PREVIEW_BYTES: u64 = MIB;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportCurrentSnapshot {
    pub snapshot_revision: u64,
    pub batch: Option<SkillImportBatchPreview>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportBatchPreview {
    pub batch_id: String,
    pub phase: SkillImportBatchPhase,
    pub snapshot_revision: u64,
    pub in_flight_source_picks: usize,
    pub catalog_revision: Option<u64>,
    pub sources: Vec<SkillImportSource>,
    pub items: Vec<SkillImportItem>,
    pub totals: SkillImportTotals,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillImportBatchPhase {
    Collecting,
    Validating,
    Submitting,
    Completed,
    RetryValidating,
    Retrying,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportSnapshotEvent {
    pub snapshot_revision: u64,
    pub batch_id: String,
    pub deleted: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportSource {
    pub source_id: String,
    pub order: usize,
    pub kind: SkillImportSourceKind,
    pub display_name: String,
    pub status: SkillImportSourceStatus,
    pub skill_count: usize,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillImportSourceKind {
    Folders,
    Zips,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillImportSourceStatus {
    Pending,
    Ready,
    Empty,
    Failed,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportItem {
    pub item_id: String,
    pub source_id: String,
    pub order: usize,
    pub source_display_name: String,
    pub relative_root: String,
    pub name: Option<String>,
    pub portable_name_key: Option<String>,
    pub description: String,
    pub files: Vec<SkillImportFile>,
    pub total_size: u64,
    pub risks: Vec<SkillImportRisk>,
    pub validity: SkillImportValidity,
    pub conflict: SkillImportConflict,
    pub duplicate_group: Option<String>,
    pub state: SkillImportItemState,
    pub last_error: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportFile {
    pub relative_path: String,
    pub name: String,
    pub kind: SkillImportFileKind,
    pub size: u64,
    pub executable: bool,
    pub children: Vec<SkillImportFile>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillImportFileKind {
    File,
    Directory,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportRisk {
    pub kind: SkillImportRiskKind,
    pub paths: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillImportRiskKind {
    ExecutableContent,
    Tools,
    Scripts,
    Hooks,
    Mcp,
    Network,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SkillImportValidity {
    Valid,
    Invalid { reasons: Vec<String> },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SkillImportConflict {
    None,
    BatchDuplicate {
        /// 批次单选约束不能遮蔽当前技能库要求的动作。该字段只承载 catalog
        /// 冲突（不会再次是 BatchDuplicate），供 UI 选择候选时生成正确动作。
        catalog_conflict: Box<SkillImportConflict>,
    },
    UserSkill {
        existing_name: String,
    },
    BuiltinSkill {
        existing_name: String,
    },
    UserNameCase {
        existing_name: String,
    },
    BuiltinNameCase {
        existing_name: String,
    },
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillImportItemState {
    Pending,
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportDecision {
    pub item_id: String,
    pub action: SkillImportAction,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillImportAction {
    Install,
    Replace,
    Skip,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct SkillImportTotals {
    pub source_count: usize,
    pub item_count: usize,
    pub importable_count: usize,
    pub conflict_count: usize,
    pub risk_count: usize,
    pub invalid_count: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportBatchResult {
    pub batch_id: String,
    pub catalog_revision: Option<u64>,
    pub items: Vec<SkillImportItemResult>,
    pub success_count: usize,
    pub failure_count: usize,
    pub skipped_count: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportItemResult {
    pub item_id: String,
    pub name: Option<String>,
    pub state: SkillImportItemState,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillImportTextChunk {
    pub relative_path: String,
    pub offset: u64,
    pub text: String,
    pub next_offset: u64,
    pub eof: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillRecoveryIssue {
    pub transaction_id: String,
    /// 持久事务残留在技能库内的安全展示相对路径；绝不包含配置目录绝对路径。
    pub entry_path: Option<String>,
    pub skill_name: String,
    pub portable_name_key: String,
    pub backup_available: bool,
    pub installed_available: bool,
    pub isolated_available: bool,
    pub authoritative_target_missing: bool,
    pub actions: Vec<SkillRecoveryAction>,
    pub error: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillRecoveryAction {
    RestoreBackup,
    KeepInstalled,
    PreserveFiles,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillRecoveryResolveResult {
    pub preserved_path: Option<String>,
    pub catalog_revision: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum SkillCommandError {
    RecoveryPending { issues: Vec<SkillRecoveryIssue> },
    Busy,
    InvalidRequest { message: String },
    CandidateChanged { entry_path: String },
    FileChanged { relative_path: String },
    CleanupFailed { target: String, message: String },
    Io { message: String },
}
