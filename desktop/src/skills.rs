// 技能库(skills):壳侧对引擎 SKILL.md 技能的管理与物化。
//
// 引擎在 session/create 时扫描固定目录,每个技能是 `<name>/SKILL.md`
// (frontmatter 只认 name/description/paths,description 必须单行)。Desktop
// 使用 Agent 的 session scope 控制每个会话的启用集:
//
// - **技能库(权威)**:内置技能随包分发(bundle.resources "skills",
//   dev 回退仓库内 desktop/skills/),用户技能在 <app_config_dir>/skills/
//   (壳 UI 增删改,本模块的 skills_* 命令)。同名时用户技能覆盖内置。
// - **按会话物化(派生)**:driver 把启用子集整体重写到
//   <engine_dir>/sessions/<engine-session-id>/skills/。引擎 catalog 是会话
//   创建时的快照,所以中途改选择仍需 destroy + resume 重建 loop,但不会
//   改写其他会话正在使用的技能文件。
//
// 技能内容不进 config.json 事务:与 telemetry.json 同理,库本身就是
// 一目录一文件的权威,坏一个技能只影响它自己。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use fs2::FileExt as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::skill_import::model::{
    SkillCommandError, SkillRecoveryAction, SkillRecoveryIssue, SkillRecoveryResolveResult,
};
use crate::skill_import::store::{BaselineStore, SkillStoreError, StoreRevision, TargetBaseline};

const LOCK_FILE: &str = "skills.lock";
const REVISION_FILE: &str = "skills.revision";
const REVISION_FORMAT: u32 = 1;
const REVISION_MIGRATION_FILE: &str = "skills.revision-migration-v1.json";
const REVISION_MIGRATION_FORMAT: u32 = 1;
const REVISION_MIGRATION_KIND: &str = "legacy-nonempty-store";
const MIGRATED_INITIAL_REVISION: u64 = 1;
const LEGACY_SESSION_SKILLS_FILE: &str = "legacy-session-skills-v1.json";
const SESSIONS_DIR: &str = "ohmy-sessions";

pub(crate) type LegacySessionSkills = std::collections::BTreeMap<String, Vec<String>>;

/// 内置技能的**出厂**缺省启用集:云端建任务的 MC_DEFAULT_SKILL_IDS 四件套
/// (baizhi/monkeycode.rs)+ 桌面端补充的 publish-website(把本会话产出的
/// Web 项目发布上线,官方库专为 pc-client 收录)。官方库全默认启用会把
/// system prompt 塞满几十条 name+description,故其余按需勾选。用户自建
/// 技能不受此表限制,出厂恒默认启用——亲手写的技能就是要用的。出厂规则
/// 之上是用户显式开关(skills-defaults.json,见 load_default_prefs):
/// 没拨过的技能跟随出厂,拨过的以开关为准。解析结果经 skills_list 的
/// default_enabled 字段下发,UI 不再自持一份规则镜像。
pub const DEFAULT_ENABLED: [&str; 5] = [
    "feature-design",
    "project-wiki",
    "feature-implementer",
    "implementation-planner",
    "publish-website",
];

/// 默认启用开关的持久化(<app_config_dir>/skills-defaults.json,
/// `{技能名: bool}` 只存显式拨过的)。刻意不进 config.json 事务:与技能库
/// 同域同理(ARCHITECTURE 契约 4),坏了只影响默认集,回退出厂规则。
pub fn defaults_path(cfg_dir: &Path) -> PathBuf {
    cfg_dir.join("skills-defaults.json")
}

pub fn load_default_prefs(path: &Path) -> std::collections::BTreeMap<String, bool> {
    fs::read(path)
        .ok()
        .and_then(|d| serde_json::from_slice(&d).ok())
        .unwrap_or_default()
}

/// 一个技能是否默认启用:显式开关优先,否则出厂规则。
pub fn is_default_enabled(
    name: &str,
    source: &str,
    prefs: &std::collections::BTreeMap<String, bool>,
) -> bool {
    prefs
        .get(name)
        .copied()
        .unwrap_or_else(|| source == "user" || DEFAULT_ENABLED.contains(&name))
}

/// 旧版 Desktop 曾允许的单组件名。它仍然不含分隔符、反斜杠或 `..`，所以在
/// 已有 macOS/Linux 技能库中按子路径列出和删除是安全的；但它可能以点结尾或
/// 是 Windows 设备名，不能用于新建、导入或 Agent 物化。
fn valid_legacy_skill_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= crate::skill_import::model::MAX_SKILL_NAME_BYTES
        && !name.starts_with('.')
        && name != "."
        && name != ".."
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// 技能名即目录名,会拼进壳与引擎两侧的文件系统路径,校验口径与
/// session id 同类:单段安全名,另限 ASCII(斜杠指令 /name 的可输入性)。
/// 新建和导入始终使用此跨平台严格规则；legacy 兼容只走
/// [`valid_legacy_skill_name`] 标明的只读/删除路径。
pub fn valid_skill_name(name: &str) -> bool {
    valid_legacy_skill_name(name) && !name.ends_with(['.', ' ']) && !is_windows_reserved_name(name)
}

/// Windows 设备名即使带扩展名仍是保留名（例如 `CON.md`）。统一拒绝它们，
/// 避免在一个平台可创建的技能导入后无法复制到另一个受支持平台。
fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
        || upper
            .strip_prefix("LPT")
            .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
}

/// 用于批次重名和跨平台大小写冲突检测。调用前仍应以
/// [`valid_skill_name`] 校验原始名称。
#[allow(dead_code)]
pub fn portable_skill_name_key(name: &str) -> Option<String> {
    valid_skill_name(name).then(|| name.to_ascii_lowercase())
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    /// "builtin"(随包分发,只读)| "user"(用户自建,可改删)
    pub source: String,
    /// SKILL.md 原文(技能都很小,列表直接携带,免一条按名读取命令)
    pub content: String,
    /// 用户技能与某内置技能同名(去重后内置那份不进列表):设置页借它外显
    /// 「覆盖内置」——被覆盖的内置技能收不到官方更新,删副本才还原,
    /// 不标出来用户会以为内置的丢了
    pub overrides: bool,
    /// 新会话是否默认启用(出厂规则 ⊕ skills-defaults.json 显式开关的
    /// 解析结果;UI 的缺省集推导只认这个字段,不复刻规则)
    pub default_enabled: bool,
}

/// 内置技能目录:bundle 资源 + dev 回退(cargo run 无 bundle 资源时用
/// 仓库根 plugins/ submodule(MonkeyCodeOfficialPlugins)的 skills/,与
/// 打包源同一份;未初始化 submodule 则回 None = 只有用户技能,不算错)。
/// 形态照抄 open_extension_dir 的双候选。
pub fn builtin_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app
        .path()
        .resolve("skills", tauri::path::BaseDirectory::Resource)
    {
        candidates.push(p);
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../plugins/skills"));
    candidates.into_iter().find(|p| p.is_dir())
}

/// 用户技能目录(权威,壳 UI 直接读写)。
pub fn user_dir(cfg_dir: &Path) -> PathBuf {
    cfg_dir.join("skills")
}

/// 只用于已经从父目录枚举出的 legacy 项。Windows 的 canonicalize 返回
/// `\\?\` verbatim 路径，因而能够真实寻址/删除普通 Win32 路径无法表达的
/// `CON`、`COM1`、尾点名称；名称本身仍先受旧版单组件规则约束，不能逃逸父目录。
fn existing_skill_path(root: &Path, name: &str) -> Result<PathBuf, SkillStoreError> {
    if !valid_legacy_skill_name(name) {
        return Err(SkillStoreError::InvalidTargetName(name.into()));
    }
    #[cfg(windows)]
    if !valid_skill_name(name) {
        return fs::canonicalize(root)
            .map(|root| root.join(name))
            .map_err(|error| SkillStoreError::io("固定 legacy 技能库根", root, error));
    }
    Ok(root.join(name))
}

// ==================== SKILL.md 解析(引擎子集的镜像) ====================

/// frontmatter 的 name/description(引擎 parseFrontmatter 只认单行值;
/// 这里只取列表展示与名字一致性校验要用的两个键)。
pub(crate) fn parse_frontmatter(text: &str) -> (Option<String>, Option<String>) {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let (mut name, mut description) = (None, None);
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        // 只认**顶层**键:嵌套块的行都带缩进(官方技能的 arguments: 块里
        // 每个参数各有 name/description),不跳过的话后出现的嵌套键会顶掉
        // 顶层值——实际踩过:feature-design 的描述被参数的 description
        // 「Absolute path to the workspace directory」覆盖(2026-08-12)
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key.trim() {
            "name" => name = Some(value),
            "description" => description = Some(value),
            _ => {}
        }
    }
    (name, description)
}

/// 展示描述:frontmatter description,缺省取正文首个非空行去掉 '#'
/// (与引擎的缺省口径一致,两侧列表说同一句话)。
pub(crate) fn derive_description(text: &str) -> String {
    if let (_, Some(d)) = parse_frontmatter(text) {
        if !d.is_empty() {
            return d;
        }
    }
    let body = skip_frontmatter(text);
    body.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|l| l.trim_start_matches('#').trim().to_string())
        .unwrap_or_default()
}

fn skip_frontmatter(text: &str) -> &str {
    let Some(rest) = text.strip_prefix("---") else {
        return text;
    };
    match rest.split_once("\n---") {
        Some((_, body)) => body.split_once('\n').map(|(_, b)| b).unwrap_or(""),
        None => text,
    }
}

/// 导入预览和安装共同使用的名称解析结果。`used_fallback` 让后续调用方
/// 区分显式 frontmatter 名称与目录名/ZIP stem 回退，而无需再次解析文本。
#[derive(Clone, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub struct ResolvedSkillMetadata {
    pub name: String,
    pub portable_name_key: String,
    pub description: String,
    pub used_fallback: bool,
}

/// 严格采用顶层 frontmatter `name`；未声明时采用调用方提供的技能目录名，
/// 或 ZIP 虚拟根的文件 stem。显式空名称不是“未声明”，会按非法名称拒绝。
#[allow(dead_code)]
pub fn resolve_import_skill_metadata(
    skill_md: &str,
    fallback_name: &str,
) -> Result<ResolvedSkillMetadata, String> {
    let (declared_name, _) = parse_frontmatter(skill_md);
    let used_fallback = declared_name.is_none();
    let name = declared_name.unwrap_or_else(|| fallback_name.to_string());
    let Some(portable_name_key) = portable_skill_name_key(&name) else {
        return Err(format!("非法技能名: {name}"));
    };
    Ok(ResolvedSkillMetadata {
        name,
        portable_name_key,
        description: derive_description(skill_md),
        used_fallback,
    })
}

/// 技能库 mutation/session mutation 与 catalog snapshot 的稳定 IPC 契约。
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub struct SkillMutationResult {
    pub catalog_revision: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub struct SessionSkillsMutationResult {
    pub skills: Vec<String>,
    pub skills_revision: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub struct SkillsCatalogSnapshot {
    pub revision: u64,
    pub store_id: String,
    pub skills: Vec<SkillInfo>,
}

// ==================== 共享技能库状态 ====================

/// 同一 Desktop 进程内所有技能库生产入口共享的状态。锁序始终是：
/// `gate` 的读/写 guard → 配置目录稳定锚 → 每次重新打开的 `skills.lock`。
#[derive(Clone)]
pub(crate) struct SkillStoreState {
    inner: Arc<SkillStoreStateInner>,
}

struct SkillStoreStateInner {
    gate: RwLock<()>,
    config_dir: PathBuf,
    user_dir: PathBuf,
    defaults_path: PathBuf,
    revision_path: PathBuf,
    revision_migration_path: PathBuf,
    sessions_path: PathBuf,
    legacy_session_skills_path: PathBuf,
    observed: Mutex<Option<StoreRevision>>,
    recovery_issues: Mutex<BTreeMap<String, CachedRecoveryIssue>>,
    #[cfg(test)]
    fail_next_revision_write: std::sync::atomic::AtomicBool,
    #[cfg(test)]
    fail_next_legacy_baseline_write: std::sync::atomic::AtomicBool,
}

#[derive(Serialize, Deserialize)]
struct RevisionDocument {
    format: u32,
    store_id: String,
    revision: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RevisionMigrationDocument {
    format: u32,
    migration: String,
    store_id: String,
    initial_revision: u64,
}

#[derive(Clone)]
struct CachedRecoveryIssue {
    fingerprint: String,
    issue: SkillRecoveryIssue,
}

impl SkillStoreState {
    pub(crate) fn new(config_dir: PathBuf) -> Result<Self, SkillStoreError> {
        ensure_plain_directory(&config_dir)?;
        let state = Self {
            inner: Arc::new(SkillStoreStateInner {
                gate: RwLock::new(()),
                user_dir: user_dir(&config_dir),
                defaults_path: defaults_path(&config_dir),
                revision_path: config_dir.join(REVISION_FILE),
                revision_migration_path: config_dir.join(REVISION_MIGRATION_FILE),
                sessions_path: config_dir.join(SESSIONS_DIR),
                legacy_session_skills_path: config_dir.join(LEGACY_SESSION_SKILLS_FILE),
                config_dir,
                observed: Mutex::new(None),
                recovery_issues: Mutex::new(BTreeMap::new()),
                #[cfg(test)]
                fail_next_revision_write: std::sync::atomic::AtomicBool::new(false),
                #[cfg(test)]
                fail_next_legacy_baseline_write: std::sync::atomic::AtomicBool::new(false),
            }),
        };
        state.initialize_if_new()?;
        Ok(state)
    }

    #[cfg(test)]
    pub(crate) fn inject_revision_failure_for_test(&self) {
        self.inner
            .fail_next_revision_write
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(crate) fn current_revision_for_test(&self) -> u64 {
        read_revision(&self.inner.revision_path)
            .unwrap()
            .unwrap()
            .revision
    }

    pub(crate) fn snapshot(
        &self,
        builtin: Option<&Path>,
    ) -> Result<SkillsCatalogSnapshot, SkillStoreError> {
        self.read(|revision| {
            Ok(SkillsCatalogSnapshot {
                revision: revision.revision,
                store_id: revision.store_id.clone(),
                skills: list_unlocked(builtin, &self.inner.user_dir, &self.inner.defaults_path),
            })
        })
    }

    /// `skills.revision` 监视器的轻量轮询入口。revision 文件由原子 rename
    /// 发布，因此无需持有技能库共享锁；`observed` 既抑制本进程自己提交的版本，
    /// 也保证同一 store 只向调用方交付严格递增的跨进程版本。
    pub(crate) fn poll_external_catalog_revision(
        &self,
    ) -> Result<Option<StoreRevision>, SkillStoreError> {
        let revision = read_revision(&self.inner.revision_path)?.ok_or_else(|| {
            SkillStoreError::RecoveryPending(vec![revision_recovery_issue(
                "非空技能库缺失 skills.revision，禁止重置为新 store".into(),
            )])
        })?;
        validate_revision(&revision)?;
        let mut observed = self
            .inner
            .observed
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match observed.as_ref() {
            Some(previous) if previous.store_id != revision.store_id => {
                return Err(SkillStoreError::StoreIdChanged {
                    expected: previous.store_id.clone(),
                    disk: revision.store_id,
                });
            }
            Some(previous) if revision.revision < previous.revision => {
                return Err(SkillStoreError::RevisionRollback {
                    observed: previous.revision,
                    disk: revision.revision,
                });
            }
            Some(previous) if revision.revision == previous.revision => return Ok(None),
            Some(_) => {}
            None => {
                *observed = Some(revision);
                return Ok(None);
            }
        }
        *observed = Some(revision.clone());
        Ok(Some(revision))
    }

    pub(crate) fn save_skill(
        &self,
        name: &str,
        content: &str,
        builtin: Option<&Path>,
    ) -> Result<StoreRevision, SkillStoreError> {
        let name = name.to_string();
        let content = content.to_string();
        self.mutate(builtin, true, |user, _| {
            let dir = user.join(&name);
            fs::create_dir_all(&dir)
                .map_err(|error| SkillStoreError::io("创建技能目录", &dir, error))?;
            let skill_md = dir.join("SKILL.md");
            crate::config::atomic_write_private(&skill_md, content.as_bytes())
                .map_err(|error| SkillStoreError::io("写入 SKILL.md", &skill_md, error))?;
            sync_directory(&dir)?;
            sync_directory(user)
        })
        .map(|(_, revision)| revision)
    }

    pub(crate) fn set_default(
        &self,
        name: &str,
        enabled: bool,
        builtin: Option<&Path>,
    ) -> Result<StoreRevision, SkillStoreError> {
        let name = name.to_string();
        self.mutate(builtin, true, |_, defaults| {
            let mut prefs = load_default_prefs(defaults);
            prefs.insert(name, enabled);
            let data = serde_json::to_vec_pretty(&prefs)
                .map_err(|error| SkillStoreError::CorruptRevision(error.to_string()))?;
            crate::config::atomic_write_private(defaults, &data)
                .map_err(|error| SkillStoreError::io("写入技能默认集", defaults, error))?;
            sync_directory(defaults.parent().unwrap_or_else(|| Path::new(".")))
        })
        .map(|(_, revision)| revision)
    }

    pub(crate) fn delete_skill(
        &self,
        name: &str,
        builtin: Option<&Path>,
    ) -> Result<StoreRevision, SkillStoreError> {
        let name = name.to_string();
        if !valid_legacy_skill_name(&name) {
            return Err(SkillStoreError::InvalidTargetName(name));
        }
        self.mutate(builtin, true, |user, defaults| {
            let dir = existing_skill_path(user, &name)?;
            if !dir.join("SKILL.md").is_file() {
                return Err(SkillStoreError::InvalidTargetName(format!(
                    "用户技能不存在: {name}"
                )));
            }
            fs::remove_dir_all(&dir)
                .map_err(|error| SkillStoreError::io("删除技能", &dir, error))?;
            sync_directory(user)?;
            let mut prefs = load_default_prefs(defaults);
            if prefs.remove(&name).is_some() {
                let data = serde_json::to_vec_pretty(&prefs)
                    .map_err(|error| SkillStoreError::CorruptRevision(error.to_string()))?;
                crate::config::atomic_write_private(defaults, &data)
                    .map_err(|error| SkillStoreError::io("清理技能默认值", defaults, error))?;
                sync_directory(defaults.parent().unwrap_or_else(|| Path::new(".")))?;
            }
            Ok(())
        })
        .map(|(_, revision)| revision)
    }

    /// list/materialize/import 预检共用的共享读入口。
    pub(crate) fn read<T>(
        &self,
        operation: impl FnOnce(&StoreRevision) -> Result<T, SkillStoreError>,
    ) -> Result<T, SkillStoreError> {
        // 闭包只在最终“事务检查与读取共处同一共享锁临界区”时消费。
        let mut operation = Some(operation);
        loop {
            let process = self
                .inner
                .gate
                .read()
                .unwrap_or_else(|error| error.into_inner());
            let os = os_lock::lock(&self.inner.config_dir, false)?;
            let inventory = crate::skill_transactions::discover_locked(&self.inner.user_dir)?;
            let issues = self.reconcile_recovery_issues_locked(&inventory);
            if !issues.is_empty() {
                return Err(SkillStoreError::RecoveryPending(issues));
            }
            if !inventory.needs_automatic_recovery() {
                let revision = self.load_revision_locked()?;
                return operation.take().expect("read operation consumed")(&revision);
            }

            // 共享锁不能升级：严格释放 OS/进程读锁，再按固定顺序取得两层写锁。
            drop(os);
            drop(process);
            self.recover_once_exclusive()?;
            // 独占锁到下一轮共享锁之间可能出现另一个进程的新事务，故必须循环，
            // 绝不直接执行 operation。
        }
    }

    /// save/delete/default/import 的唯一权威写入口。取得全部锁后先持久预留
    /// next revision，再调用权威闭包：revision 写失败时闭包绝不执行；闭包失败
    /// 或进程崩溃则保留已推进的 revision，作为保守 catalog invalidation。
    #[allow(dead_code)] // 事务测试和后续导入编排的通用入口。
    pub(crate) fn write<T>(
        &self,
        operation: impl FnOnce(&Path, &Path) -> Result<T, SkillStoreError>,
    ) -> Result<(T, StoreRevision), SkillStoreError> {
        self.mutate(None, true, operation)
    }

    /// 后续导入编排只可从这个入口进入同一 state，不得自建锁。
    #[allow(dead_code)] // 导入命令尚未注册；task 6 先冻结唯一入口。
    pub(crate) fn import<T>(
        &self,
        builtin: Option<&Path>,
        operation: impl FnOnce(&Path, &Path) -> Result<T, SkillStoreError>,
    ) -> Result<(T, StoreRevision), SkillStoreError> {
        self.mutate(builtin, true, operation)
    }

    /// 恢复 commit 与普通 mutation 使用相同锁和 revision 出口。
    #[allow(dead_code)] // 恢复命令尚未注册；不得另建锁域。
    pub(crate) fn recovery<T>(
        &self,
        operation: impl FnOnce(&Path, &Path) -> Result<T, SkillStoreError>,
    ) -> Result<(T, StoreRevision), SkillStoreError> {
        self.mutate(None, false, operation)
    }

    #[allow(dead_code)] // 导入提交尚未注册；本任务先覆盖锁内 baseline 契约。
    pub(crate) fn capture_target_baseline(
        &self,
        target_name: &str,
    ) -> Result<TargetBaseline, SkillStoreError> {
        // baseline 是提交校验的一部分，按要求在同一 write 锁内捕获
        // presence/type/稳定树身份并解析 SKILL.md。
        let _process = self
            .inner
            .gate
            .write()
            .unwrap_or_else(|error| error.into_inner());
        let _os = os_lock::lock(&self.inner.config_dir, true)?;
        self.recover_under_exclusive_locked()?;
        let revision = self.load_revision_locked()?;
        let baseline = BaselineStore::open_locked(&self.inner.user_dir)?;
        baseline.capture_locked(&revision, target_name)
    }

    #[allow(dead_code)] // 无 session id 的低层入口仅供技能库隔离测试。
    pub(crate) fn materialize(
        &self,
        target: &Path,
        builtin: Option<&Path>,
        enabled: Option<&[String]>,
    ) -> Result<Vec<String>, SkillStoreError> {
        self.read(|_| {
            materialize_unlocked(
                target,
                builtin,
                &self.inner.user_dir,
                &self.inner.defaults_path,
                enabled,
            )
            .map_err(|message| SkillStoreError::Io {
                operation: "物化技能",
                path: target.display().to_string(),
                message,
            })
        })
    }

    /// 在一次技能库共享读临界区内解析历史会话快照并物化。若本调用先读到
    /// baseline 尚未建立，后续技能写必须等待本次按修改前默认集物化完成；若
    /// 技能写先完成，本调用则必定读到该写事务建立的 baseline。
    #[cfg(test)]
    pub(crate) fn materialize_session(
        &self,
        target: &Path,
        builtin: Option<&Path>,
        session_id: &str,
        explicit: Option<&[String]>,
    ) -> Result<Vec<String>, SkillStoreError> {
        let journal =
            default_materialize_journal_path(target).map_err(|message| SkillStoreError::Io {
                operation: "构造物化事务日志",
                path: target.display().to_string(),
                message,
            })?;
        self.materialize_session_with_journal(target, &journal, builtin, session_id, explicit)
    }

    pub(crate) fn materialize_session_with_journal(
        &self,
        target: &Path,
        journal: &Path,
        builtin: Option<&Path>,
        session_id: &str,
        explicit: Option<&[String]>,
    ) -> Result<Vec<String>, SkillStoreError> {
        self.read(|_| {
            let baseline = read_legacy_session_skills(&self.inner.legacy_session_skills_path)?;
            let enabled = explicit.or_else(|| {
                baseline
                    .as_ref()
                    .and_then(|entries| entries.get(session_id))
                    .map(Vec::as_slice)
            });
            materialize_unlocked_with_journal(
                target,
                journal,
                builtin,
                &self.inner.user_dir,
                &self.inner.defaults_path,
                enabled,
                &mut |_| Ok(()),
            )
            .map_err(|message| SkillStoreError::Io {
                operation: "物化会话技能",
                path: target.display().to_string(),
                message,
            })
        })
    }

    /// 会话 list/open 在同一技能库共享读锁下读取 sidecar 与 baseline，避免
    /// 返回“新 catalog + 旧会话仍为 null”的混合观察。
    pub(crate) fn with_legacy_session_skills<T>(
        &self,
        operation: impl FnOnce(Option<&LegacySessionSkills>) -> Result<T, SkillStoreError>,
    ) -> Result<T, SkillStoreError> {
        self.read(|_| {
            let baseline = read_legacy_session_skills(&self.inner.legacy_session_skills_path)?;
            operation(baseline.as_ref())
        })
    }

    /// 恢复面板读取：与普通 read 相同地先接管全部可恢复事务，但不会把已登记
    /// issue 自身转换成错误。
    pub(crate) fn recovery_issues(&self) -> Result<Vec<SkillRecoveryIssue>, SkillStoreError> {
        loop {
            let process = self
                .inner
                .gate
                .read()
                .unwrap_or_else(|error| error.into_inner());
            let os = os_lock::lock(&self.inner.config_dir, false)?;
            let inventory = crate::skill_transactions::discover_locked(&self.inner.user_dir)?;
            let issues = self.reconcile_recovery_issues_locked(&inventory);
            if !issues.is_empty() || !inventory.needs_automatic_recovery() {
                return Ok(issues);
            }
            drop(os);
            drop(process);
            // 失败会登记 issue；恢复列表下一轮把它返回，而不是重复尝试。
            match self.recover_once_exclusive() {
                Ok(()) | Err(SkillStoreError::RecoveryPending(_)) => {}
                Err(error) => return Err(error),
            }
        }
    }

    pub(crate) fn resolve_recovery(
        &self,
        transaction_id: &str,
        action: SkillRecoveryAction,
    ) -> Result<SkillRecoveryResolveResult, SkillStoreError> {
        let _process = self
            .inner
            .gate
            .write()
            .unwrap_or_else(|error| error.into_inner());
        let _os = os_lock::lock(&self.inner.config_dir, true)?;
        // 先在同一独占锁内纯只读确认 issue/action 并绑定候选 fingerprint。无效请求
        // 在 revision write-ahead invalidation 之前返回，不能制造虚假的 catalog 版本。
        let cached_issue = self
            .inner
            .recovery_issues
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(transaction_id)
            .cloned();
        let plan = crate::skill_transactions::plan_resolve_locked(
            &self.inner.user_dir,
            transaction_id,
            action,
            cached_issue
                .as_ref()
                .map(|cached| (cached.fingerprint.as_str(), &cached.issue)),
        )?;
        // 合法计划才预留 revision。写失败时尚未移动任何候选；执行失败或计划后
        // fingerprint 改变则允许 revision 保守前进。
        let revision = self.advance_revision_locked()?;
        self.mark_revision_observed(&revision);
        let outcome = crate::skill_transactions::execute_resolve_plan_locked(
            &self.inner.config_dir,
            &self.inner.user_dir,
            plan,
        )?;
        let inventory = crate::skill_transactions::discover_locked(&self.inner.user_dir)?;
        self.reconcile_recovery_issues_locked(&inventory);
        Ok(SkillRecoveryResolveResult {
            preserved_path: outcome.preserved_path,
            catalog_revision: revision.revision,
        })
    }

    /// task 10 的批次编排必须复用此入口；返回顺序与请求顺序严格一致。
    #[allow(dead_code)]
    pub(crate) fn install_transactions(
        &self,
        builtin: Option<&Path>,
        requests: &[crate::skill_transactions::SkillInstallRequest],
    ) -> Result<
        (
            Vec<crate::skill_transactions::SkillInstallOutcome>,
            StoreRevision,
        ),
        SkillStoreError,
    > {
        self.import(builtin, |user, _| {
            Ok(crate::skill_transactions::install_many_locked(
                user, requests,
            ))
        })
    }

    /// task 10 的“同一写锁内零写入预检 → 单次批次事务”入口。validate 在
    /// revision、baseline 和当前 catalog 的同一独占锁快照上运行；失败时不会推进
    /// revision、迁移 baseline 或触碰技能目录。空请求（全 skip）同样零写入。
    pub(crate) fn install_transactions_validated(
        &self,
        builtin: Option<&Path>,
        validate: impl FnOnce(
            &StoreRevision,
            &[SkillInfo],
            &BaselineStore,
        ) -> Result<
            Vec<crate::skill_transactions::SkillInstallRequest>,
            SkillStoreError,
        >,
        before_execute: impl FnOnce() -> Result<(), SkillStoreError>,
    ) -> Result<
        (
            Vec<crate::skill_transactions::SkillInstallOutcome>,
            StoreRevision,
        ),
        SkillStoreError,
    > {
        let _process = self
            .inner
            .gate
            .write()
            .unwrap_or_else(|error| error.into_inner());
        let _os = os_lock::lock(&self.inner.config_dir, true)?;
        self.recover_under_exclusive_locked()?;
        let current = self.load_revision_locked()?;
        let catalog = list_unlocked(builtin, &self.inner.user_dir, &self.inner.defaults_path);
        let baselines = BaselineStore::open_locked(&self.inner.user_dir)?;
        let requests = validate(&current, &catalog, &baselines)?;
        // phase 必须在首个事务/默认集写入前切到 Submitting/Retrying；闭包只允许
        // 修改短时内存状态，不执行 I/O。
        before_execute()?;
        if requests.is_empty() {
            return Ok((Vec::new(), current));
        }

        let revision = self.advance_revision_locked()?;
        self.mark_revision_observed(&revision);
        self.migrate_legacy_session_skills_locked(builtin)?;
        let outcomes =
            crate::skill_transactions::install_many_locked(&self.inner.user_dir, &requests);
        Ok((outcomes, revision))
    }

    /// task 4 的 instance lease 清理闭包：活动事务仅按日志中的安全实例组件豁免。
    pub(crate) fn protects_staging_path(&self, path: &Path) -> bool {
        crate::skill_transactions::staging_path_has_active_transaction(&self.inner.config_dir, path)
    }

    fn reconcile_recovery_issues_locked(
        &self,
        inventory: &crate::skill_transactions::RecoveryInventory,
    ) -> Vec<SkillRecoveryIssue> {
        let mut cache = self
            .inner
            .recovery_issues
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut next = BTreeMap::new();
        for entry in &inventory.entries {
            let cached = cache
                .get(&entry.transaction_id)
                .filter(|cached| cached.fingerprint == entry.fingerprint)
                .cloned();
            let issue = entry
                .issue
                .clone()
                .or_else(|| cached.map(|cached| cached.issue));
            if let Some(issue) = issue {
                next.insert(
                    entry.transaction_id.clone(),
                    CachedRecoveryIssue {
                        fingerprint: entry.fingerprint.clone(),
                        issue,
                    },
                );
            }
        }
        *cache = next;
        cache.values().map(|cached| cached.issue.clone()).collect()
    }

    fn recover_once_exclusive(&self) -> Result<(), SkillStoreError> {
        let _process = self
            .inner
            .gate
            .write()
            .unwrap_or_else(|error| error.into_inner());
        let _os = os_lock::lock(&self.inner.config_dir, true)?;
        self.recover_under_exclusive_locked()
    }

    fn recover_under_exclusive_locked(&self) -> Result<(), SkillStoreError> {
        let inventory = crate::skill_transactions::discover_locked(&self.inner.user_dir)?;
        let existing = self.reconcile_recovery_issues_locked(&inventory);
        // 同 fingerprint 的失败只尝试一次，避免 list/materialize 的升级循环忙转。
        if !existing.is_empty() {
            return Err(SkillStoreError::RecoveryPending(existing));
        }
        if !inventory.needs_automatic_recovery() {
            return Ok(());
        }
        // 自动恢复即使只清理日志/备份也可能改变读者判断，执行任何 rename/delete
        // 前先持久预留 revision。写失败必须保持事务目录完全不变。
        self.advance_revision_locked()?;
        let run = crate::skill_transactions::recover_locked(&self.inner.user_dir)?;
        {
            let mut cache = self
                .inner
                .recovery_issues
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            for (transaction_id, fingerprint, issue) in run.issues {
                cache.insert(transaction_id, CachedRecoveryIssue { fingerprint, issue });
            }
        }
        let inventory = crate::skill_transactions::discover_locked(&self.inner.user_dir)?;
        let issues = self.reconcile_recovery_issues_locked(&inventory);
        if issues.is_empty() {
            Ok(())
        } else {
            Err(SkillStoreError::RecoveryPending(issues))
        }
    }

    fn advance_revision_locked(&self) -> Result<StoreRevision, SkillStoreError> {
        let current = self.load_revision_locked()?;
        let revision = StoreRevision {
            store_id: current.store_id,
            revision: current
                .revision
                .checked_add(1)
                .ok_or(SkillStoreError::RevisionOverflow)?,
        };
        #[cfg(test)]
        if self
            .inner
            .fail_next_revision_write
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(SkillStoreError::io(
                "注入 catalog revision 写入失败",
                &self.inner.revision_path,
                "test injection",
            ));
        }
        write_revision_synced(&self.inner.revision_path, &revision)?;
        Ok(revision)
    }

    fn mark_revision_observed(&self, revision: &StoreRevision) {
        *self
            .inner
            .observed
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(revision.clone());
    }

    fn mutate<T>(
        &self,
        builtin: Option<&Path>,
        migrate_legacy_sessions: bool,
        operation: impl FnOnce(&Path, &Path) -> Result<T, SkillStoreError>,
    ) -> Result<(T, StoreRevision), SkillStoreError> {
        let _process = self
            .inner
            .gate
            .write()
            .unwrap_or_else(|error| error.into_inner());
        let _os = os_lock::lock(&self.inner.config_dir, true)?;
        // 每次普通写都从磁盘接管崩溃事务；内存 cache 绝不是放行依据。
        self.recover_under_exclusive_locked()?;
        let current = self.load_revision_locked()?;
        let revision = StoreRevision {
            store_id: current.store_id,
            revision: current
                .revision
                .checked_add(1)
                .ok_or(SkillStoreError::RevisionOverflow)?,
        };

        // revision 是所有潜在权威变化的 write-ahead invalidation。这里必须位于
        // operation 之前，且成功后绝不因 operation 失败而回退或二次提交。
        #[cfg(test)]
        if self
            .inner
            .fail_next_revision_write
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(SkillStoreError::io(
                "注入 catalog revision 写入失败",
                &self.inner.revision_path,
                "test injection",
            ));
        }
        write_revision_synced(&self.inner.revision_path, &revision)?;
        self.mark_revision_observed(&revision);

        // revision 可作为保守 write-ahead invalidation 提前推进；baseline 迁移
        // 必须先于任何技能目录/defaults 权威写。迁移失败时 operation 不运行。
        if migrate_legacy_sessions {
            self.migrate_legacy_session_skills_locked(builtin)?;
        }
        let value = operation(&self.inner.user_dir, &self.inner.defaults_path)?;
        Ok((value, revision))
    }

    fn migrate_legacy_session_skills_locked(
        &self,
        builtin: Option<&Path>,
    ) -> Result<(), SkillStoreError> {
        let existing = read_legacy_session_skills(&self.inner.legacy_session_skills_path)?;
        let mut baseline = existing.clone().unwrap_or_default();
        let default_skills =
            list_unlocked(builtin, &self.inner.user_dir, &self.inner.defaults_path)
                .into_iter()
                .filter(|skill| skill.default_enabled)
                .map(|skill| skill.name)
                .collect::<Vec<_>>();
        let mut changed = existing.is_none();

        let entries = match fs::read_dir(&self.inner.sessions_path) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return self.write_legacy_session_skills_if_changed(&baseline, changed);
            }
            Err(error) => {
                return Err(SkillStoreError::io(
                    "扫描持久会话目录",
                    &self.inner.sessions_path,
                    error,
                ));
            }
        };
        for entry in entries {
            let entry = entry.map_err(|error| {
                SkillStoreError::io("枚举持久会话目录", &self.inner.sessions_path, error)
            })?;
            let session_id = entry.file_name().to_string_lossy().into_owned();
            #[cfg(test)]
            {
                let request = self.inner.config_dir.join("baseline.pause-request");
                if fs::read_to_string(&request).is_ok_and(|requested| requested == session_id) {
                    fs::write(
                        self.inner.config_dir.join("baseline.scan-entered"),
                        b"entered",
                    )
                    .map_err(|error| {
                        SkillStoreError::io("写入 baseline 测试屏障", &request, error)
                    })?;
                    let release = self.inner.config_dir.join("baseline.scan-release");
                    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
                    while !release.exists() {
                        if std::time::Instant::now() >= deadline {
                            return Err(SkillStoreError::io(
                                "等待 baseline 测试屏障",
                                &release,
                                "timeout",
                            ));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                }
            }
            let metadata = match fs::symlink_metadata(entry.path()) {
                Ok(metadata) => metadata,
                // sidecar 删除不取得技能库锁；枚举后消失是合法竞态。迁移只写独立
                // baseline，不能因会话恰好删除而失败，更不能重建其目录。
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(SkillStoreError::io(
                        "检查持久会话目录项",
                        &entry.path(),
                        error,
                    ));
                }
            };
            if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
                continue;
            }
            if !crate::driver::valid_session_id(&session_id) {
                continue;
            }
            let meta_path = entry.path().join("meta.json");
            let bytes = match fs::read(&meta_path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(SkillStoreError::io("读取会话 sidecar", &meta_path, error));
                }
            };
            let meta: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|error| SkillStoreError::io("解析会话 sidecar", &meta_path, error))?;
            if meta.as_object().is_none_or(|object| object.is_empty())
                || meta
                    .get("skills")
                    .and_then(serde_json::Value::as_array)
                    .is_some()
                || baseline.contains_key(&session_id)
            {
                continue;
            }
            baseline.insert(session_id, default_skills.clone());
            changed = true;
        }
        self.write_legacy_session_skills_if_changed(&baseline, changed)
    }

    fn write_legacy_session_skills_if_changed(
        &self,
        baseline: &LegacySessionSkills,
        changed: bool,
    ) -> Result<(), SkillStoreError> {
        if !changed {
            return Ok(());
        }
        #[cfg(test)]
        if self
            .inner
            .fail_next_legacy_baseline_write
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(SkillStoreError::io(
                "注入历史会话 baseline 写入失败",
                &self.inner.legacy_session_skills_path,
                "test injection",
            ));
        }
        let bytes = serde_json::to_vec_pretty(baseline)
            .map_err(|error| SkillStoreError::CorruptRevision(error.to_string()))?;
        crate::config::atomic_write_private(&self.inner.legacy_session_skills_path, &bytes)
            .map_err(|error| {
                SkillStoreError::io(
                    "原子写入历史会话 baseline",
                    &self.inner.legacy_session_skills_path,
                    error,
                )
            })?;
        sync_directory(&self.inner.config_dir)
    }

    fn initialize_if_new(&self) -> Result<(), SkillStoreError> {
        let _process = self
            .inner
            .gate
            .write()
            .unwrap_or_else(|error| error.into_inner());
        let _os = os_lock::lock(&self.inner.config_dir, true)?;
        match read_revision(&self.inner.revision_path) {
            Ok(Some(revision)) => {
                validate_revision(&revision)?;
                *self
                    .inner
                    .observed
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = Some(revision);
                ensure_plain_directory(&self.inner.user_dir)?;
            }
            Ok(None) => match self.initialize_missing_revision_locked() {
                Ok(revision) => {
                    *self
                        .inner
                        .observed
                        .lock()
                        .unwrap_or_else(|error| error.into_inner()) = Some(revision);
                }
                // 不安全 legacy 根、未完成事务和损坏 migration marker 都不得被
                // “初始化”覆盖。保留现场并让 catalog 入口继续返回 RecoveryPending。
                Err(SkillStoreError::RecoveryPending(_))
                | Err(SkillStoreError::UnsafeObject { .. })
                | Err(SkillStoreError::InvalidTargetName(_))
                | Err(SkillStoreError::CorruptRevision(_)) => {}
                Err(error) => return Err(error),
            },
            // 已存在但损坏的 revision 绝不走兼容迁移或被 marker 覆盖。
            Err(SkillStoreError::CorruptRevision(_)) => {}
            Err(error) => return Err(error),
        }
        Ok(())
    }

    /// 兼容早于 catalog revision 的 Desktop 技能库。调用方已完整持有进程写锁
    /// 和 `skills.lock` 独占锁；第二个进程进入后会先看到第一个原子发布的 revision，
    /// 因而 migration marker/store_id 只会生成一次。
    fn initialize_missing_revision_locked(&self) -> Result<StoreRevision, SkillStoreError> {
        ensure_plain_directory(&self.inner.user_dir)?;
        let marker = read_revision_migration(&self.inner.revision_migration_path)?;
        if marker.is_none() && authoritative_store_is_empty(&self.inner)? {
            let revision = StoreRevision {
                store_id: generate_store_id()?,
                revision: 0,
            };
            write_revision_synced(&self.inner.revision_path, &revision)?;
            return Ok(revision);
        }

        // 缺 revision 时不能先运行会改动权威目录的自动恢复，因为恢复自身也必须
        // 预留 revision。任何 transaction residue 都先成为无动作 blocker。
        let inventory = crate::skill_transactions::discover_locked(&self.inner.user_dir)?;
        if !inventory.entries.is_empty() {
            let issues = self.cache_missing_revision_transaction_blockers(&inventory);
            return Err(SkillStoreError::RecoveryPending(issues));
        }

        let had_marker = marker.is_some();
        let revision = match marker {
            Some(marker) => StoreRevision {
                store_id: marker.store_id,
                revision: marker.initial_revision,
            },
            None => StoreRevision {
                store_id: generate_store_id()?,
                revision: MIGRATED_INITIAL_REVISION,
            },
        };
        validate_legacy_store_for_revision_migration(&self.inner, &revision)?;
        if !had_marker {
            write_revision_migration_synced(&self.inner.revision_migration_path, &revision)?;
        }
        // marker 先落盘：若在两次原子写之间退出，下一实例复用同一 store_id 后
        // 完成 revision 发布，不会把同一个 legacy store 识别成两个 store。
        write_revision_synced(&self.inner.revision_path, &revision)?;
        Ok(revision)
    }

    fn cache_missing_revision_transaction_blockers(
        &self,
        inventory: &crate::skill_transactions::RecoveryInventory,
    ) -> Vec<SkillRecoveryIssue> {
        let mut cache = self
            .inner
            .recovery_issues
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        cache.clear();
        for entry in &inventory.entries {
            let issue = entry.issue.clone().unwrap_or_else(|| SkillRecoveryIssue {
                transaction_id: entry.transaction_id.clone(),
                entry_path: Some(format!(".transactions/{}", entry.transaction_id)),
                skill_name: String::new(),
                portable_name_key: String::new(),
                backup_available: false,
                installed_available: false,
                isolated_available: false,
                authoritative_target_missing: false,
                actions: Vec::new(),
                error: "技能库缺失 skills.revision，必须先恢复 revision 后才能安全接管事务".into(),
            });
            cache.insert(
                entry.transaction_id.clone(),
                CachedRecoveryIssue {
                    fingerprint: entry.fingerprint.clone(),
                    issue,
                },
            );
        }
        cache.values().map(|cached| cached.issue.clone()).collect()
    }

    fn load_revision_locked(&self) -> Result<StoreRevision, SkillStoreError> {
        let revision = read_revision(&self.inner.revision_path).and_then(|revision| {
            revision.ok_or_else(|| {
                SkillStoreError::RecoveryPending(vec![revision_recovery_issue(
                    "非空技能库缺失 skills.revision，禁止重置为新 store".into(),
                )])
            })
        })?;
        validate_revision(&revision).map_err(|error| {
            SkillStoreError::RecoveryPending(vec![revision_recovery_issue(format!(
                "skills.revision 无法验证: {error}"
            ))])
        })?;
        let observed = self
            .inner
            .observed
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(previous) = observed.as_ref() {
            if previous.store_id != revision.store_id {
                return Err(SkillStoreError::StoreIdChanged {
                    expected: previous.store_id.clone(),
                    disk: revision.store_id,
                });
            }
            if revision.revision < previous.revision {
                return Err(SkillStoreError::RevisionRollback {
                    observed: previous.revision,
                    disk: revision.revision,
                });
            }
        }
        // `observed` 是 watcher 的交付水位，不是任意读者的磁盘缓存。
        // 普通 read（尤其自动恢复后的重读）不能吞掉尚未 emit 的 revision。
        Ok(revision)
    }
}

fn authoritative_store_is_empty(inner: &SkillStoreStateInner) -> Result<bool, SkillStoreError> {
    if inner.defaults_path.exists() {
        return Ok(false);
    }
    match fs::symlink_metadata(&inner.user_dir) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(SkillStoreError::io(
            "检查用户技能库",
            &inner.user_dir,
            error,
        )),
        Ok(metadata) if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() => {
            Ok(false)
        }
        Ok(_) => {
            let mut entries = fs::read_dir(&inner.user_dir)
                .map_err(|error| SkillStoreError::io("枚举用户技能库", &inner.user_dir, error))?;
            Ok(entries.next().is_none())
        }
    }
}

fn validate_legacy_store_for_revision_migration(
    inner: &SkillStoreStateInner,
    revision: &StoreRevision,
) -> Result<(), SkillStoreError> {
    match fs::symlink_metadata(&inner.defaults_path) {
        Ok(metadata) => {
            if !plain_file_metadata(&metadata) {
                return Err(SkillStoreError::unsafe_object(
                    "skills-defaults.json",
                    "legacy 默认集不是普通文件",
                ));
            }
            let bytes = fs::read(&inner.defaults_path).map_err(|error| {
                SkillStoreError::io("读取 legacy 技能默认集", &inner.defaults_path, error)
            })?;
            let defaults: BTreeMap<String, bool> =
                serde_json::from_slice(&bytes).map_err(|error| {
                    SkillStoreError::unsafe_object(
                        "skills-defaults.json",
                        format!("legacy 默认集损坏: {error}"),
                    )
                })?;
            if let Some(name) = defaults.keys().find(|name| !valid_legacy_skill_name(name)) {
                return Err(SkillStoreError::unsafe_object(
                    "skills-defaults.json",
                    format!("legacy 默认集包含不安全技能名: {name}"),
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(SkillStoreError::io(
                "检查 legacy 技能默认集",
                &inner.defaults_path,
                error,
            ));
        }
    }

    let baseline = BaselineStore::open_locked(&inner.user_dir)?;
    let entries = fs::read_dir(&inner.user_dir)
        .map_err(|error| SkillStoreError::io("枚举 legacy 技能库", &inner.user_dir, error))?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            SkillStoreError::io("读取 legacy 技能库目录项", &inner.user_dir, error)
        })?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| SkillStoreError::unsafe_object("skills", "legacy 技能目录名不是 UTF-8"))?;
        let internal = matches!(name.as_str(), ".imports" | ".backups" | ".transactions");
        let path = if internal {
            entry.path()
        } else {
            existing_skill_path(&inner.user_dir, &name)?
        };
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| SkillStoreError::io("检查 legacy 技能目录项", &path, error))?;
        if internal {
            if !plain_directory_metadata(&metadata) {
                return Err(SkillStoreError::unsafe_object(
                    name,
                    "事务内部根必须是普通目录",
                ));
            }
            continue;
        }
        if !valid_legacy_skill_name(&name) || !plain_directory_metadata(&metadata) {
            return Err(SkillStoreError::unsafe_object(
                name,
                "legacy 技能库根只允许旧版安全单组件普通技能目录和固定事务内部目录",
            ));
        }
        if valid_skill_name(&name) {
            let captured = baseline.capture_locked(revision, &name)?;
            if captured.presence != crate::skill_import::store::TargetPresence::Present
                || captured.target_type
                    != Some(crate::skill_import::store::TargetEntryType::Directory)
                || captured.preview.is_none()
            {
                return Err(SkillStoreError::unsafe_object(
                    name,
                    "legacy 技能必须是包含普通 SKILL.md 的完整安全目录树",
                ));
            }
        } else {
            validate_legacy_incompatible_skill_tree(&path, &name)?;
        }
    }
    Ok(())
}

/// 旧版规则安全、但当前 Agent/Windows 规则不兼容的根名称无法传入严格
/// `BaselineStore`。迁移只需证明原有目录没有链接/特殊文件且 SKILL.md 可读；
/// 不移动、不改写技能数据，随后只允许 catalog 展示和按原名单组件删除。
fn validate_legacy_incompatible_skill_tree(path: &Path, name: &str) -> Result<(), SkillStoreError> {
    materialized_tree_digest(path).map_err(|reason| {
        SkillStoreError::unsafe_object(name, format!("legacy 技能目录树不安全: {reason}"))
    })?;
    let skill_md = path.join("SKILL.md");
    let metadata = fs::symlink_metadata(&skill_md)
        .map_err(|error| SkillStoreError::io("检查 legacy SKILL.md", &skill_md, error))?;
    if !plain_file_metadata(&metadata)
        || metadata.len() > crate::skill_import::model::MAX_SKILL_MD_BYTES
    {
        return Err(SkillStoreError::unsafe_object(
            format!("{name}/SKILL.md"),
            "legacy 技能必须包含不超过 1 MiB 的普通 SKILL.md",
        ));
    }
    fs::read_to_string(&skill_md)
        .map_err(|error| SkillStoreError::io("读取 legacy SKILL.md", &skill_md, error))?;
    Ok(())
}

fn read_revision_migration(
    path: &Path,
) -> Result<Option<RevisionMigrationDocument>, SkillStoreError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(SkillStoreError::io("检查 revision migration", path, error)),
    };
    if !plain_file_metadata(&metadata) {
        return Err(SkillStoreError::unsafe_object(
            REVISION_MIGRATION_FILE,
            "revision migration marker 不是普通文件",
        ));
    }
    let bytes = fs::read(path)
        .map_err(|error| SkillStoreError::io("读取 revision migration", path, error))?;
    let marker: RevisionMigrationDocument = serde_json::from_slice(&bytes)
        .map_err(|error| SkillStoreError::CorruptRevision(format!("migration marker: {error}")))?;
    if marker.format != REVISION_MIGRATION_FORMAT
        || marker.migration != REVISION_MIGRATION_KIND
        || marker.initial_revision != MIGRATED_INITIAL_REVISION
    {
        return Err(SkillStoreError::CorruptRevision(
            "revision migration marker 格式非法".into(),
        ));
    }
    validate_revision(&StoreRevision {
        store_id: marker.store_id.clone(),
        revision: marker.initial_revision,
    })?;
    Ok(Some(marker))
}

fn write_revision_migration_synced(
    path: &Path,
    revision: &StoreRevision,
) -> Result<(), SkillStoreError> {
    let marker = RevisionMigrationDocument {
        format: REVISION_MIGRATION_FORMAT,
        migration: REVISION_MIGRATION_KIND.into(),
        store_id: revision.store_id.clone(),
        initial_revision: revision.revision,
    };
    let bytes = serde_json::to_vec_pretty(&marker)
        .map_err(|error| SkillStoreError::CorruptRevision(error.to_string()))?;
    crate::config::atomic_write_private(path, &bytes)
        .map_err(|error| SkillStoreError::io("原子写入 revision migration", path, error))?;
    sync_directory(path.parent().unwrap_or_else(|| Path::new(".")))
}

fn ensure_plain_directory(path: &Path) -> Result<(), SkillStoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
            Ok(())
        }
        Ok(_) => Err(SkillStoreError::unsafe_object(
            path.display().to_string(),
            "必须是普通目录且不得为链接/重解析点",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(path)
            .map_err(|error| SkillStoreError::io("创建技能库目录", path, error)),
        Err(error) => Err(SkillStoreError::io("检查技能库目录", path, error)),
    }
}

fn read_revision(path: &Path) -> Result<Option<StoreRevision>, SkillStoreError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(SkillStoreError::io("读取 catalog revision", path, error)),
    };
    let document: RevisionDocument = serde_json::from_slice(&bytes)
        .map_err(|error| SkillStoreError::CorruptRevision(error.to_string()))?;
    if document.format != REVISION_FORMAT {
        return Err(SkillStoreError::CorruptRevision(format!(
            "未知格式 {}",
            document.format
        )));
    }
    Ok(Some(StoreRevision {
        store_id: document.store_id,
        revision: document.revision,
    }))
}

fn read_legacy_session_skills(path: &Path) -> Result<Option<LegacySessionSkills>, SkillStoreError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(SkillStoreError::io("读取历史会话 baseline", path, error));
        }
    };
    let baseline = serde_json::from_slice::<LegacySessionSkills>(&bytes)
        .map_err(|error| SkillStoreError::io("解析历史会话 baseline", path, error))?;
    Ok(Some(baseline))
}

fn validate_revision(revision: &StoreRevision) -> Result<(), SkillStoreError> {
    if revision.store_id.len() != 32
        || !revision
            .store_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(SkillStoreError::CorruptRevision("store_id 格式非法".into()));
    }
    Ok(())
}

fn write_revision_synced(path: &Path, revision: &StoreRevision) -> Result<(), SkillStoreError> {
    let document = RevisionDocument {
        format: REVISION_FORMAT,
        store_id: revision.store_id.clone(),
        revision: revision.revision,
    };
    let bytes = serde_json::to_vec_pretty(&document)
        .map_err(|error| SkillStoreError::CorruptRevision(error.to_string()))?;
    crate::config::atomic_write_private(path, &bytes)
        .map_err(|error| SkillStoreError::io("原子写入 catalog revision", path, error))?;
    sync_directory(path.parent().unwrap_or_else(|| Path::new(".")))
}

fn sync_directory(path: &Path) -> Result<(), SkillStoreError> {
    #[cfg(unix)]
    {
        fs::File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| SkillStoreError::io("同步目录", path, error))
    }
    #[cfg(windows)]
    {
        // atomic_write_private 在 Windows 使用 MOVEFILE_WRITE_THROUGH。
        let _ = path;
        Ok(())
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err(SkillStoreError::unsafe_object(
            path.display().to_string(),
            "当前平台不支持目录同步",
        ))
    }
}

fn generate_store_id() -> Result<String, SkillStoreError> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|error| SkillStoreError::Io {
        operation: "生成 store_id",
        path: REVISION_FILE.into(),
        message: error.to_string(),
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn command_error(error: SkillStoreError, config_dir: &Path) -> SkillCommandError {
    match error {
        SkillStoreError::InvalidTargetName(message) => SkillCommandError::InvalidRequest {
            message: redact_store_path(&message, config_dir),
        },
        SkillStoreError::CandidateChanged { entry_path } => SkillCommandError::CandidateChanged {
            entry_path: redact_store_path(&entry_path, config_dir),
        },
        SkillStoreError::RevisionOverflow => SkillCommandError::InvalidRequest {
            message: "技能库 revision 已到上限；请先导出需要保留的技能并重建技能库".into(),
        },
        SkillStoreError::RecoveryPending(mut issues) => {
            for issue in &mut issues {
                issue.error = redact_store_path(&issue.error, config_dir);
                issue.entry_path = issue
                    .entry_path
                    .take()
                    .map(|path| redact_store_path(&path, config_dir));
            }
            SkillCommandError::RecoveryPending { issues }
        }
        SkillStoreError::CorruptRevision(message) => SkillCommandError::RecoveryPending {
            issues: vec![revision_recovery_issue(redact_store_path(
                &message, config_dir,
            ))],
        },
        error @ (SkillStoreError::RevisionRollback { .. }
        | SkillStoreError::StoreIdChanged { .. }) => SkillCommandError::RecoveryPending {
            issues: vec![revision_recovery_issue(redact_store_path(
                &error.to_string(),
                config_dir,
            ))],
        },
        SkillStoreError::Io {
            operation,
            path,
            message,
        } => SkillCommandError::Io {
            message: format!(
                "{operation} {} 失败: {}。请重试；若仍失败，请检查技能库权限或在恢复面板处理",
                redact_store_path(&path, config_dir),
                redact_store_path(&message, config_dir)
            ),
        },
        SkillStoreError::UnsafeObject {
            relative_path,
            reason,
        } => SkillCommandError::Io {
            message: format!(
                "检查技能库对象 {} 失败: {}。请在恢复面板保留或移除该对象后重试",
                redact_store_path(&relative_path, config_dir),
                redact_store_path(&reason, config_dir)
            ),
        },
        SkillStoreError::TargetChanged { target_name } => SkillCommandError::Io {
            message: format!("技能 {target_name} 在操作期间发生变化，请刷新列表后重试"),
        },
    }
}

/// WebView 错误只展示逻辑位置。底层错误可能重复携带完整 config/home 路径，
/// 因此结构化丢弃 `Io.path` 的绝对前缀后，仍对 OS message 和恢复 issue 做兜底。
fn redact_store_path(message: &str, config_dir: &Path) -> String {
    let mut redacted = message.to_string();
    let mut private_roots = vec![(
        config_dir.to_string_lossy().into_owned(),
        "<app-config>".to_string(),
    )];
    for variable in ["HOME", "USERPROFILE"] {
        if let Some(value) = std::env::var_os(variable) {
            private_roots.push((
                PathBuf::from(value).to_string_lossy().into_owned(),
                "<home>".to_string(),
            ));
        }
    }
    private_roots.sort_by(|left, right| right.0.len().cmp(&left.0.len()));
    for (private, replacement) in private_roots {
        if !private.is_empty() {
            redacted = redacted.replace(&private, &replacement);
            let alternate = if private.contains('\\') {
                private.replace('\\', "/")
            } else {
                private.replace('/', "\\")
            };
            if alternate != private {
                redacted = redacted.replace(&alternate, &replacement);
            }
        }
    }
    redacted
}

fn background_command_error(operation: &'static str) -> SkillCommandError {
    SkillCommandError::Io {
        message: format!("{operation}后台任务异常退出，请重试；若仍失败，请重启应用"),
    }
}

fn revision_recovery_issue(message: String) -> SkillRecoveryIssue {
    SkillRecoveryIssue {
        transaction_id: "skills-revision".into(),
        entry_path: Some("skills.revision".into()),
        skill_name: String::new(),
        portable_name_key: String::new(),
        backup_available: false,
        installed_available: false,
        isolated_available: false,
        authoritative_target_missing: true,
        actions: Vec::new(),
        error: message,
    }
}

#[cfg(unix)]
mod os_lock {
    use super::*;
    use std::fs::File;
    use std::os::fd::{AsFd, OwnedFd};

    use rustix::fs::{fstat, openat, FileType, Mode, OFlags, CWD};

    pub(super) struct Guard {
        anchor: File,
        lock: File,
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = fs2::FileExt::unlock(&self.lock);
            let _ = fs2::FileExt::unlock(&self.anchor);
        }
    }

    pub(super) fn lock(config_dir: &Path, exclusive: bool) -> Result<Guard, SkillStoreError> {
        let anchor_fd = openat(
            CWD,
            config_dir,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| SkillStoreError::io("打开技能库稳定父目录", config_dir, error))?;
        let anchor = File::from(anchor_fd);
        file_lock(&anchor, exclusive, config_dir, "取得技能库父目录锚锁")?;

        let lock_fd = open_lock_at(anchor.as_fd())?;
        let lock = File::from(lock_fd);
        file_lock(
            &lock,
            exclusive,
            &config_dir.join(LOCK_FILE),
            "取得 skills.lock",
        )?;

        // 在父目录锚锁仍持有时重新按名称打开并比较 dev/inode。协作进程不能
        // 删除/替换路径；若不协作的外部程序竞态替换，identity 不同即拒绝。
        let current = open_lock_at(anchor.as_fd())?;
        let locked_stat = fstat(&lock).map_err(|error| {
            SkillStoreError::io("复核 skills.lock 句柄", Path::new(LOCK_FILE), error)
        })?;
        let current_stat = fstat(&current).map_err(|error| {
            SkillStoreError::io("复核 skills.lock 路径", Path::new(LOCK_FILE), error)
        })?;
        if locked_stat.st_dev != current_stat.st_dev || locked_stat.st_ino != current_stat.st_ino {
            return Err(SkillStoreError::unsafe_object(
                LOCK_FILE,
                "锁路径在进入临界区前被替换",
            ));
        }
        Ok(Guard { anchor, lock })
    }

    fn open_lock_at(anchor: impl AsFd) -> Result<OwnedFd, SkillStoreError> {
        let fd = openat(
            anchor,
            LOCK_FILE,
            OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|error| {
            SkillStoreError::io("安全打开 skills.lock", Path::new(LOCK_FILE), error)
        })?;
        let stat = fstat(&fd).map_err(|error| {
            SkillStoreError::io("复核 skills.lock", Path::new(LOCK_FILE), error)
        })?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile {
            return Err(SkillStoreError::unsafe_object(
                LOCK_FILE,
                "锁对象不是普通文件",
            ));
        }
        Ok(fd)
    }

    fn file_lock(
        file: &File,
        exclusive: bool,
        path: &Path,
        operation: &'static str,
    ) -> Result<(), SkillStoreError> {
        let result = if exclusive {
            file.lock_exclusive()
        } else {
            file.lock_shared()
        };
        result.map_err(|error| SkillStoreError::io(operation, path, error))
    }
}

#[cfg(windows)]
mod os_lock {
    use super::*;
    use std::fs::{File, OpenOptions};
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle as _;

    use sha2::{Digest as _, Sha256};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0};
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    use windows::Win32::System::Threading::{
        CreateMutexW, ReleaseMutex, WaitForSingleObject, INFINITE,
    };

    struct NamedMutex(HANDLE);

    impl Drop for NamedMutex {
        fn drop(&mut self) {
            unsafe {
                let _ = ReleaseMutex(self.0);
                let _ = CloseHandle(self.0);
            }
        }
    }

    pub(super) struct Guard {
        anchor: NamedMutex,
        lock: File,
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = fs2::FileExt::unlock(&self.lock);
        }
    }

    pub(super) fn lock(config_dir: &Path, exclusive: bool) -> Result<Guard, SkillStoreError> {
        // 命名 mutex 不依赖可替换文件路径；所有进程在整个临界区持有它，再
        // 每次重新打开 skills.lock 并比较 file-index。
        let anchor = named_mutex(config_dir)?;
        let lock_path = config_dir.join(LOCK_FILE);
        let lock = open(&lock_path)?;
        let result = if exclusive {
            lock.lock_exclusive()
        } else {
            lock.lock_shared()
        };
        result.map_err(|error| SkillStoreError::io("取得 skills.lock", &lock_path, error))?;
        let current = open(&lock_path)?;
        if identity(&lock)? != identity(&current)? {
            return Err(SkillStoreError::unsafe_object(LOCK_FILE, "锁路径被替换"));
        }
        Ok(Guard { anchor, lock })
    }

    fn named_mutex(config_dir: &Path) -> Result<NamedMutex, SkillStoreError> {
        let key = config_dir.to_string_lossy().to_ascii_lowercase();
        let digest = format!("{:x}", Sha256::digest(key.as_bytes()));
        let name = format!("Local\\MonkeyCodeSkills-{}", &digest[..32]);
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(None, false, PCWSTR(wide.as_ptr())) }
            .map_err(|error| SkillStoreError::io("创建技能库命名 mutex", config_dir, error))?;
        let wait = unsafe { WaitForSingleObject(handle, INFINITE) };
        if wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED {
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Err(SkillStoreError::io(
                "等待技能库命名 mutex",
                config_dir,
                format!("等待结果 {wait:?}"),
            ));
        }
        Ok(NamedMutex(handle))
    }

    fn open(path: &Path) -> Result<File, SkillStoreError> {
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            // 允许其他进程预先打开并等待 advisory lock，但拒绝删除/替换。
            .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0);
        options
            .open(path)
            .map_err(|error| SkillStoreError::io("安全打开锁文件", path, error))
    }

    fn identity(file: &File) -> Result<(u32, u64), SkillStoreError> {
        let mut information = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut information) }
            .map_err(|error| SkillStoreError::io("读取锁身份", Path::new(LOCK_FILE), error))?;
        Ok((
            information.dwVolumeSerialNumber,
            ((information.nFileIndexHigh as u64) << 32) | information.nFileIndexLow as u64,
        ))
    }
}

#[cfg(not(any(unix, windows)))]
mod os_lock {
    use super::*;
    pub(super) struct Guard;
    pub(super) fn lock(_config_dir: &Path, _exclusive: bool) -> Result<Guard, SkillStoreError> {
        Err(SkillStoreError::unsafe_object(
            ".",
            "当前平台不支持技能库锁",
        ))
    }
}

// ==================== 技能库扫描 ====================

struct StoreSkill {
    info: SkillInfo,
}

/// 扫一个来源目录:<dir>/<name>/SKILL.md。坏条目(读不了/名字非法)跳过
/// 不拖垮整库——列表少一条比整页报错可诊断(目录名非法只可能是手工放入)。
fn scan_source(dir: &Path, source: &str, allow_legacy_names: bool, out: &mut Vec<StoreSkill>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !(valid_skill_name(&name) || (allow_legacy_names && valid_legacy_skill_name(&name))) {
            continue;
        }
        let Ok(path) = existing_skill_path(dir, &name) else {
            continue;
        };
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !plain_directory_metadata(&metadata) {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        let Ok(skill_metadata) = fs::symlink_metadata(&skill_md) else {
            continue;
        };
        if !plain_file_metadata(&skill_metadata) {
            continue;
        }
        let Ok(content) = fs::read_to_string(&skill_md) else {
            continue;
        };
        out.push(StoreSkill {
            info: SkillInfo {
                description: derive_description(&content),
                name,
                source: source.into(),
                content,
                overrides: false,
                default_enabled: false, // 占位,list_unlocked()/materialize_unlocked() 按 prefs 解析
            },
        });
    }
}

/// 技能库全量:用户技能在前且同名覆盖内置(引擎去重也是先到先得,
/// 物化顺序与此一致,两侧"谁生效"口径相同)。按名排序稳定输出。
fn scan_store(builtin: Option<&Path>, user: &Path) -> Vec<StoreSkill> {
    let mut all = Vec::new();
    // 用户库可能由旧版 macOS/Linux Desktop 创建；只兼容旧规则本就允许的
    // 安全单组件名。内置库及所有新入口仍只接受当前严格规则。
    scan_source(user, "user", true, &mut all);
    if let Some(b) = builtin {
        scan_source(b, "builtin", false, &mut all);
    }
    let builtin_names: std::collections::HashSet<String> = all
        .iter()
        .filter(|s| s.info.source == "builtin")
        .map(|s| s.info.name.clone())
        .collect();
    for s in &mut all {
        s.info.overrides = s.info.source == "user" && builtin_names.contains(&s.info.name);
    }
    let mut seen = std::collections::HashSet::new();
    all.retain(|s| seen.insert(s.info.name.clone()));
    all.sort_by(|a, b| a.info.name.cmp(&b.info.name));
    all
}

fn list_unlocked(builtin: Option<&Path>, user: &Path, defaults: &Path) -> Vec<SkillInfo> {
    let prefs = load_default_prefs(defaults);
    scan_store(builtin, user)
        .into_iter()
        .map(|s| {
            let mut info = s.info;
            // Agent 现行 catalog 使用严格跨平台名称规则。legacy 技能只供 UI
            // 查看/删除，不声称默认可用，也不会进入会话物化结果。
            info.default_enabled = valid_skill_name(&info.name)
                && is_default_enabled(&info.name, &info.source, &prefs);
            info
        })
        .collect()
}

// ==================== 按会话物化 ====================

/// 把启用子集原子切换到 Agent 的 session skills 目录。
/// enabled=None 表示"缺省集"(新会话初始;旧 sidecar 无 skills 字段):
/// 出厂规则 ⊕ defaults 文件的显式开关(is_default_enabled)。返回实际物化
/// 的技能名(sidecar 落这份快照)。完整新树先生成在目标同级目录；只有全部
/// 拷贝和同步成功后，才执行“旧目录 → backup、新目录 → target”的原子切换。
/// 所有返回错误的路径都会尝试把旧目录恢复到原名，绝不先删旧目录。
fn materialize_unlocked(
    target: &Path,
    builtin: Option<&Path>,
    user: &Path,
    defaults: &Path,
    enabled: Option<&[String]>,
) -> Result<Vec<String>, String> {
    materialize_unlocked_with_hook(target, builtin, user, defaults, enabled, |_| Ok(()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MaterializeStep {
    ValidateParent,
    CreateTemporary,
    ScanCatalog,
    CopySkill,
    SyncTemporary,
    ValidateTarget,
    BackupOld,
    SyncParentAfterBackup,
    InstallNew,
    SyncParentAfterInstall,
    CleanupBackup,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum MaterializeTransactionStage {
    Prepared,
    BackupCreated,
    Installed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MaterializeTransactionJournal {
    format: u32,
    target: String,
    temporary: String,
    backup: String,
    stage: MaterializeTransactionStage,
    had_old: bool,
    old_digest: Option<String>,
    new_digest: String,
}

fn materialize_unlocked_with_hook(
    target: &Path,
    builtin: Option<&Path>,
    user: &Path,
    defaults: &Path,
    enabled: Option<&[String]>,
    mut before: impl FnMut(MaterializeStep) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    let journal = default_materialize_journal_path(target)?;
    materialize_unlocked_with_journal(
        target,
        &journal,
        builtin,
        user,
        defaults,
        enabled,
        &mut before,
    )
}

fn materialize_unlocked_with_journal(
    target: &Path,
    journal_path: &Path,
    builtin: Option<&Path>,
    user: &Path,
    defaults: &Path,
    enabled: Option<&[String]>,
    before: &mut impl FnMut(MaterializeStep) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    recover_materialize_journal(target, journal_path)?;
    before(MaterializeStep::ValidateParent)?;
    let parent = target
        .parent()
        .ok_or_else(|| "会话技能目录缺少父目录".to_string())?;
    ensure_plain_materialize_parent(parent)?;
    let (temporary, backup) = unique_materialize_siblings(target)?;

    before(MaterializeStep::CreateTemporary)?;
    fs::create_dir(&temporary).map_err(|e| format!("创建会话技能临时目录失败: {e}"))?;

    let prefs = load_default_prefs(defaults);
    let mut done = Vec::new();
    let generated = (|| {
        before(MaterializeStep::ScanCatalog)?;
        for s in scan_store(builtin, user) {
            if !valid_skill_name(&s.info.name) {
                continue;
            }
            let on = match enabled {
                Some(names) => names.contains(&s.info.name),
                None => is_default_enabled(&s.info.name, &s.info.source, &prefs),
            };
            if !on {
                continue;
            }
            before(MaterializeStep::CopySkill)?;
            let source_root = if s.info.source == "user" {
                user
            } else {
                builtin.ok_or_else(|| format!("内置技能根缺失: {}", s.info.name))?
            };
            crate::skill_import::store::copy_skill_directory_verified(
                source_root,
                &s.info.name,
                &temporary.join(&s.info.name),
            )
            .map_err(|e| format!("物化技能 {} 失败: {e}", s.info.name))?;
            done.push(s.info.name);
        }
        before(MaterializeStep::SyncTemporary)?;
        sync_materialized_tree(&temporary)?;
        Ok::<(), String>(())
    })();
    if let Err(error) = generated {
        let _ = remove_plain_tree(&temporary);
        return Err(error);
    }

    if let Err(error) = before(MaterializeStep::ValidateTarget) {
        let _ = remove_plain_tree(&temporary);
        return Err(error);
    }
    let had_old = match path_is_plain_directory_or_missing(target) {
        Ok(had_old) => had_old,
        Err(error) => {
            let _ = remove_plain_tree(&temporary);
            return Err(error);
        }
    };
    let old_digest = if had_old {
        Some(materialized_tree_digest(target)?)
    } else {
        None
    };
    let new_digest = materialized_tree_digest(&temporary)?;
    let mut journal = MaterializeTransactionJournal {
        format: 1,
        target: safe_file_name(target)?,
        temporary: safe_file_name(&temporary)?,
        backup: safe_file_name(&backup)?,
        stage: MaterializeTransactionStage::Prepared,
        had_old,
        old_digest,
        new_digest,
    };
    write_materialize_journal(journal_path, &journal)?;
    crash_materialize_boundary_for_test("journal-prepared");
    let switched = (|| {
        if had_old {
            before(MaterializeStep::BackupOld)?;
            rename_materialize_path(target, &backup)
                .map_err(|e| format!("备份旧会话技能目录失败: {e}"))?;
            crash_materialize_boundary_for_test("backup-renamed");
            before(MaterializeStep::SyncParentAfterBackup)?;
            sync_materialize_parent(parent)?;
            journal.stage = MaterializeTransactionStage::BackupCreated;
            write_materialize_journal(journal_path, &journal)?;
            crash_materialize_boundary_for_test("backup-stage-synced");
        }

        before(MaterializeStep::InstallNew)?;
        rename_materialize_path(&temporary, target)
            .map_err(|e| format!("安装新会话技能目录失败: {e}"))?;
        crash_materialize_boundary_for_test("target-installed");
        before(MaterializeStep::SyncParentAfterInstall)?;
        sync_materialize_parent(parent)?;
        journal.stage = MaterializeTransactionStage::Installed;
        write_materialize_journal(journal_path, &journal)?;
        crash_materialize_boundary_for_test("installed-stage-synced");
        if materialized_tree_digest(target)? != journal.new_digest {
            return Err("新会话技能目录安装后完整性复核失败".into());
        }
        if had_old {
            // 注入点位于任何破坏性清理之前，因此这一步失败仍能完整恢复旧树。
            before(MaterializeStep::CleanupBackup)?;
        }
        Ok::<(), String>(())
    })();

    if let Err(error) = switched {
        // 普通错误与进程崩溃的决策不同：只要本次调用向上返回 Err，就必须
        // 恢复调用前的旧树；崩溃重入则按持久 stage/磁盘状态完成或回滚。
        // 不能复用 recover_materialize_journal 的“已安装新树即提交”规则，
        // 否则 CleanupBackup 等注入错误会一边报失败、一边留下新树。
        let recovery = rollback_materialize_journal(target, journal_path);
        return Err(match recovery {
            Ok(()) => error,
            Err(recovery_error) => format!("{error}; 持久物化恢复失败: {recovery_error}"),
        });
    }

    if had_old {
        // 此时新目录已经原子安装并同步。递归删除不是原子操作；清理失败不能
        // 伪造物化失败（那会在备份已被部分删除后无法诚实恢复）。保留剩余
        // backup 供下次/人工清理，权威 target 仍是完整的新树。
        remove_plain_tree(&backup).map_err(|error| format!("清理会话技能备份失败: {error}"))?;
        sync_materialize_parent(parent)?;
    }
    crash_materialize_boundary_for_test("backup-cleaned");
    remove_materialize_journal(journal_path)?;
    Ok(done)
}

fn default_materialize_journal_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "会话技能目录缺少父目录".to_string())?;
    Ok(parent.join(format!(".{}.materialize.json", safe_file_name(target)?)))
}

fn safe_file_name(path: &Path) -> Result<String, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("路径缺少安全 UTF-8 文件名: {}", path.display()))?;
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err(format!("不安全的物化事务文件名: {name:?}"));
    }
    Ok(name.to_string())
}

fn write_materialize_journal(
    path: &Path,
    journal: &MaterializeTransactionJournal,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "物化事务日志缺少父目录".to_string())?;
    ensure_plain_materialize_parent(parent)?;
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !plain_file_metadata(&metadata) {
            return Err(format!("物化事务日志不是普通文件: {}", path.display()));
        }
    }
    let bytes = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("序列化物化事务日志失败: {error}"))?;
    crate::config::atomic_write_private(path, &bytes)
        .map_err(|error| format!("原子写入物化事务日志失败: {error}"))?;
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("同步物化事务日志失败: {error}"))?;
    sync_materialize_parent(parent)
}

fn remove_materialize_journal(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("检查物化事务日志失败: {error}")),
        Ok(metadata) if plain_file_metadata(&metadata) => {}
        Ok(_) => return Err(format!("拒绝删除不安全物化事务日志: {}", path.display())),
    }
    fs::remove_file(path).map_err(|error| format!("删除物化事务日志失败: {error}"))?;
    sync_materialize_parent(path.parent().unwrap_or_else(|| Path::new(".")))
}

fn read_materialize_journal(path: &Path) -> Result<Option<MaterializeTransactionJournal>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("检查物化事务日志失败: {error}")),
        Ok(metadata) => metadata,
    };
    if !plain_file_metadata(&metadata) || metadata.len() > 64 * 1024 {
        return Err(format!("物化事务日志不安全或过大: {}", path.display()));
    }
    let bytes = fs::read(path).map_err(|error| format!("读取物化事务日志失败: {error}"))?;
    let journal: MaterializeTransactionJournal =
        serde_json::from_slice(&bytes).map_err(|error| format!("解析物化事务日志失败: {error}"))?;
    if journal.format != 1 {
        return Err(format!("未知物化事务日志格式: {}", journal.format));
    }
    Ok(Some(journal))
}

pub(crate) fn recover_session_materialization(
    target: &Path,
    journal_path: &Path,
) -> Result<(), String> {
    recover_materialize_journal(target, journal_path)
}

fn recover_materialize_journal(target: &Path, journal_path: &Path) -> Result<(), String> {
    let Some(journal) = read_materialize_journal(journal_path)? else {
        return reject_orphan_materialize_siblings(target);
    };
    let parent = target
        .parent()
        .ok_or_else(|| "物化恢复目标缺少父目录".to_string())?;
    ensure_plain_materialize_parent(parent)?;
    if journal.target != safe_file_name(target)?
        || !journal
            .temporary
            .starts_with(&format!(".{}.materialize-", journal.target))
        || !journal
            .backup
            .starts_with(&format!(".{}.backup-", journal.target))
        || safe_file_name(Path::new(&journal.temporary))? != journal.temporary
        || safe_file_name(Path::new(&journal.backup))? != journal.backup
    {
        return Err("物化事务日志包含不安全或不匹配路径".into());
    }
    let temporary = parent.join(&journal.temporary);
    let backup = parent.join(&journal.backup);
    let target_digest = digest_if_plain_directory(target)?;
    let temporary_digest = digest_if_plain_directory(&temporary)?;
    let backup_digest = digest_if_plain_directory(&backup)?;
    let target_is_new = target_digest.as_deref() == Some(journal.new_digest.as_str());
    let target_is_old = journal
        .old_digest
        .as_ref()
        .is_some_and(|old| target_digest.as_deref() == Some(old.as_str()));
    let backup_is_old = journal
        .old_digest
        .as_ref()
        .is_some_and(|old| backup_digest.as_deref() == Some(old.as_str()));
    let temporary_is_new = temporary_digest.as_deref() == Some(journal.new_digest.as_str());

    if target_is_new {
        if backup_digest.is_some() && !backup_is_old {
            return Err("已安装新目录但 backup 与旧目录指纹不一致，恢复存在歧义".into());
        }
        if temporary_digest.is_some() && !temporary_is_new {
            return Err("已安装新目录但 temporary 指纹不一致，恢复存在歧义".into());
        }
        remove_plain_tree(&temporary).map_err(|error| error.to_string())?;
        remove_plain_tree(&backup).map_err(|error| error.to_string())?;
        sync_materialize_parent(parent)?;
        return remove_materialize_journal(journal_path);
    }

    if target_is_old && backup_digest.is_none() {
        if temporary_digest.is_some() && !temporary_is_new {
            return Err("旧目录仍在但 temporary 指纹不一致，恢复存在歧义".into());
        }
        remove_plain_tree(&temporary).map_err(|error| error.to_string())?;
        sync_materialize_parent(parent)?;
        return remove_materialize_journal(journal_path);
    }

    if target_digest.is_none() && backup_is_old {
        rename_materialize_path(&backup, target)
            .map_err(|error| format!("恢复旧会话技能目录失败: {error}"))?;
        sync_materialize_parent(parent)?;
        if temporary_digest.is_some() && !temporary_is_new {
            return Err("旧目录已恢复但 temporary 指纹不一致，恢复存在歧义".into());
        }
        remove_plain_tree(&temporary).map_err(|error| error.to_string())?;
        sync_materialize_parent(parent)?;
        return remove_materialize_journal(journal_path);
    }

    if !journal.had_old && target_digest.is_none() {
        if temporary_digest.is_some() && !temporary_is_new {
            return Err("无旧目录事务的 temporary 指纹不一致，恢复存在歧义".into());
        }
        if backup_digest.is_some() {
            return Err("无旧目录事务意外出现 backup，恢复存在歧义".into());
        }
        if temporary_digest.is_none() && journal.stage != MaterializeTransactionStage::Prepared {
            return Err("已安装阶段权威目标缺失且无备份，恢复存在歧义".into());
        }
        remove_plain_tree(&temporary).map_err(|error| error.to_string())?;
        sync_materialize_parent(parent)?;
        return remove_materialize_journal(journal_path);
    }

    Err(format!(
        "会话技能物化事务状态歧义: stage={:?}, target={:?}, temporary={:?}, backup={:?}",
        journal.stage, target_digest, temporary_digest, backup_digest
    ))
}

/// 当前调用明确失败时恢复调用前状态。日志保留到旧状态及临时对象均同步完成，
/// 因而回滚过程中再次崩溃仍可由通用恢复入口接管。
fn rollback_materialize_journal(target: &Path, journal_path: &Path) -> Result<(), String> {
    let Some(journal) = read_materialize_journal(journal_path)? else {
        return reject_orphan_materialize_siblings(target);
    };
    let parent = target
        .parent()
        .ok_or_else(|| "物化回滚目标缺少父目录".to_string())?;
    ensure_plain_materialize_parent(parent)?;
    if journal.target != safe_file_name(target)?
        || safe_file_name(Path::new(&journal.temporary))? != journal.temporary
        || safe_file_name(Path::new(&journal.backup))? != journal.backup
    {
        return Err("物化事务日志包含不安全或不匹配路径".into());
    }
    let temporary = parent.join(&journal.temporary);
    let backup = parent.join(&journal.backup);
    let target_digest = digest_if_plain_directory(target)?;
    let temporary_digest = digest_if_plain_directory(&temporary)?;
    let backup_digest = digest_if_plain_directory(&backup)?;
    let target_is_new = target_digest.as_deref() == Some(journal.new_digest.as_str());
    let target_is_old = journal
        .old_digest
        .as_ref()
        .is_some_and(|old| target_digest.as_deref() == Some(old.as_str()));
    let backup_is_old = journal
        .old_digest
        .as_ref()
        .is_some_and(|old| backup_digest.as_deref() == Some(old.as_str()));
    let temporary_is_new = temporary_digest.as_deref() == Some(journal.new_digest.as_str());

    if temporary_digest.is_some() && !temporary_is_new {
        return Err("回滚时 temporary 与新目录指纹不一致，保留全部对象".into());
    }
    if journal.had_old {
        if backup_digest.is_some() && !backup_is_old {
            return Err("回滚时 backup 与旧目录指纹不一致，保留全部对象".into());
        }
        if target_is_new {
            if !backup_is_old {
                return Err("回滚已安装目录时缺少完整旧备份".into());
            }
            remove_plain_tree(target).map_err(|error| format!("移除未提交新目录失败: {error}"))?;
            sync_materialize_parent(parent)?;
        } else if target_digest.is_some() && !target_is_old {
            return Err("回滚时目标既不是旧目录也不是新目录，保留全部对象".into());
        }
        if target_digest.is_none() || target_is_new {
            rename_materialize_path(&backup, target)
                .map_err(|error| format!("回滚恢复旧会话技能目录失败: {error}"))?;
            sync_materialize_parent(parent)?;
        }
        if materialized_tree_digest(target)? != journal.old_digest.clone().unwrap_or_default() {
            return Err("回滚后的旧会话技能目录完整性复核失败".into());
        }
    } else {
        if backup_digest.is_some() {
            return Err("无旧目录事务在回滚时出现 backup，保留全部对象".into());
        }
        if target_is_new {
            remove_plain_tree(target).map_err(|error| format!("移除未提交新目录失败: {error}"))?;
            sync_materialize_parent(parent)?;
        } else if target_digest.is_some() {
            return Err("无旧目录事务在回滚时出现未知目标，保留全部对象".into());
        }
    }
    remove_plain_tree(&temporary).map_err(|error| format!("清理物化临时目录失败: {error}"))?;
    sync_materialize_parent(parent)?;
    remove_materialize_journal(journal_path)
}

fn reject_orphan_materialize_siblings(target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "物化目标缺少父目录".to_string())?;
    let target_name = safe_file_name(target)?;
    let temporary_prefix = format!(".{target_name}.materialize-");
    let backup_prefix = format!(".{target_name}.backup-");
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("扫描孤立物化目录失败: {error}")),
    };
    for entry in entries {
        let entry = entry.map_err(|error| format!("枚举孤立物化目录失败: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&temporary_prefix) || name.starts_with(&backup_prefix) {
            return Err(format!("发现无事务日志的孤立物化目录，拒绝继续: {name}"));
        }
    }
    Ok(())
}

fn digest_if_plain_directory(path: &Path) -> Result<Option<String>, String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("检查物化目录失败({}): {error}", path.display())),
        Ok(metadata) if plain_directory_metadata(&metadata) => {
            materialized_tree_digest(path).map(Some)
        }
        Ok(_) => Err(format!("物化事务对象不是普通目录: {}", path.display())),
    }
}

fn materialized_tree_digest(root: &Path) -> Result<String, String> {
    use sha2::{Digest as _, Sha256};
    fn walk(path: &Path, relative: &str, digest: &mut Sha256) -> Result<(), String> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("检查物化树对象失败({}): {error}", path.display()))?;
        if plain_directory_metadata(&metadata) {
            digest.update(b"D\0");
            digest.update(relative.as_bytes());
            digest.update(b"\0");
            let mut entries = fs::read_dir(path)
                .map_err(|error| format!("枚举物化树失败({}): {error}", path.display()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("枚举物化树条目失败: {error}"))?;
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| "物化树路径不是 UTF-8".to_string())?;
                if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
                    return Err("物化树含不安全路径组件".into());
                }
                let child = if relative.is_empty() {
                    name
                } else {
                    format!("{relative}/{name}")
                };
                walk(&entry.path(), &child, digest)?;
            }
            Ok(())
        } else if plain_file_metadata(&metadata) {
            digest.update(b"F\0");
            digest.update(relative.as_bytes());
            digest.update(b"\0");
            let bytes = fs::read(path)
                .map_err(|error| format!("读取物化树文件失败({}): {error}", path.display()))?;
            digest.update((bytes.len() as u64).to_le_bytes());
            digest.update(&bytes);
            Ok(())
        } else {
            Err(format!(
                "物化树含链接、重解析点或特殊对象: {}",
                path.display()
            ))
        }
    }
    let mut digest = Sha256::new();
    walk(root, "", &mut digest)?;
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
fn crash_materialize_boundary_for_test(boundary: &str) {
    if std::env::var("MC_MATERIALIZE_CRASH_BOUNDARY").as_deref() == Ok(boundary) {
        std::process::exit(86);
    }
}

#[cfg(not(test))]
fn crash_materialize_boundary_for_test(_boundary: &str) {}

fn ensure_plain_materialize_parent(parent: &Path) -> Result<(), String> {
    validate_plain_ancestor_chain(parent)?;
    match fs::symlink_metadata(parent) {
        Ok(metadata) if plain_directory_metadata(&metadata) => Ok(()),
        Ok(_) => Err(format!(
            "会话技能父目录不是普通目录或包含重解析点: {}",
            parent.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(parent).map_err(|e| format!("创建会话技能父目录失败: {e}"))?;
            validate_plain_ancestor_chain(parent)?;
            let metadata =
                fs::symlink_metadata(parent).map_err(|e| format!("复核会话技能父目录失败: {e}"))?;
            if plain_directory_metadata(&metadata) {
                Ok(())
            } else {
                Err("创建后的会话技能父目录不是普通目录".into())
            }
        }
        Err(error) => Err(format!("检查会话技能父目录失败: {error}")),
    }
}

fn validate_plain_ancestor_chain(path: &Path) -> Result<(), String> {
    // 系统临时目录在 macOS 常经 /var -> /private/var 别名进入；拒绝整个绝对
    // 路径链会误伤正常目标。这里只校验最接近目标的既有祖先：它正是
    // create_dir_all 会从中继续创建的边界，也足以拦住 target 父级中的链接。
    let mut ancestor = path;
    loop {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if plain_directory_metadata(&metadata) => return Ok(()),
            Ok(_) => {
                return Err(format!(
                    "会话技能路径祖先不是普通目录或包含重解析点: {}",
                    ancestor.display()
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| format!("会话技能路径没有可验证父级: {}", path.display()))?;
            }
            Err(error) => {
                return Err(format!(
                    "检查会话技能路径祖先失败({}): {error}",
                    ancestor.display()
                ));
            }
        }
    }
}

/// 返回 target 是否存在普通旧目录；不存在返回 false，不安全对象直接拒绝。
fn path_is_plain_directory_or_missing(target: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(target) {
        Ok(metadata) if plain_directory_metadata(&metadata) => Ok(true),
        Ok(_) => Err(format!(
            "会话技能目标不是普通目录或包含重解析点: {}",
            target.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("检查会话技能目标失败: {error}")),
    }
}

fn unique_materialize_siblings(target: &Path) -> Result<(PathBuf, PathBuf), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "会话技能目录缺少父目录".to_string())?;
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "会话技能目录名不是 UTF-8".to_string())?;
    for _ in 0..16 {
        let mut random = [0u8; 12];
        getrandom::getrandom(&mut random).map_err(|e| format!("生成物化事务标识失败: {e}"))?;
        let suffix = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let temporary = parent.join(format!(".{name}.materialize-{suffix}"));
        let backup = parent.join(format!(".{name}.backup-{suffix}"));
        if !temporary.exists() && !backup.exists() {
            return Ok((temporary, backup));
        }
    }
    Err("生成会话技能临时目录连续冲突".into())
}

fn sync_materialized_tree(path: &Path) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("检查待同步会话技能对象失败: {e}"))?;
    if !plain_directory_metadata(&metadata) {
        return Err(format!(
            "待同步会话技能对象不是普通目录: {}",
            path.display()
        ));
    }
    for entry in fs::read_dir(path).map_err(|e| format!("枚举待同步会话技能目录失败: {e}"))?
    {
        let entry = entry.map_err(|e| format!("读取待同步会话技能条目失败: {e}"))?;
        let child = entry.path();
        let metadata =
            fs::symlink_metadata(&child).map_err(|e| format!("检查待同步会话技能条目失败: {e}"))?;
        if plain_directory_metadata(&metadata) {
            sync_materialized_tree(&child)?;
        } else if plain_file_metadata(&metadata) {
            fs::File::open(&child)
                .and_then(|file| file.sync_all())
                .map_err(|e| format!("同步会话技能文件 {} 失败: {e}", child.display()))?;
        } else {
            return Err(format!("待同步会话技能条目不安全: {}", child.display()));
        }
    }
    sync_materialize_parent(path)
}

fn remove_plain_tree(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
        Ok(metadata) if plain_directory_metadata(&metadata) => fs::remove_dir_all(path),
        Ok(_) => Err(std::io::Error::other("拒绝递归删除链接或重解析点")),
    }
}

#[cfg(not(windows))]
fn rename_materialize_path(from: &Path, to: &Path) -> std::io::Result<()> {
    use rustix::fs::{openat, renameat, Mode, OFlags, CWD};

    let metadata = fs::symlink_metadata(from)?;
    if !plain_directory_metadata(&metadata) {
        return Err(std::io::Error::other("拒绝重命名链接或非普通目录"));
    }
    if to.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "重命名目标已存在",
        ));
    }
    let from_parent = from
        .parent()
        .ok_or_else(|| std::io::Error::other("来源父级缺失"))?;
    let to_parent = to
        .parent()
        .ok_or_else(|| std::io::Error::other("目标父级缺失"))?;
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let from_fd = openat(CWD, from_parent, flags, Mode::empty())
        .map_err(|error| std::io::Error::from_raw_os_error(error.raw_os_error()))?;
    let to_fd = openat(CWD, to_parent, flags, Mode::empty())
        .map_err(|error| std::io::Error::from_raw_os_error(error.raw_os_error()))?;
    renameat(
        &from_fd,
        from.file_name()
            .ok_or_else(|| std::io::Error::other("来源名缺失"))?,
        &to_fd,
        to.file_name()
            .ok_or_else(|| std::io::Error::other("目标名缺失"))?,
    )
    .map_err(|error| std::io::Error::from_raw_os_error(error.raw_os_error()))
}

#[cfg(windows)]
fn rename_materialize_path(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::fs::{MetadataExt as _, OpenOptionsExt as _};
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileRenameInfo, SetFileInformationByHandle, DELETE, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_RENAME_INFO,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    let metadata = fs::symlink_metadata(from)?;
    if !plain_directory_metadata(&metadata) {
        return Err(std::io::Error::other(
            "拒绝重命名链接、重解析点或非普通目录",
        ));
    }
    if to.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "重命名目标已存在",
        ));
    }
    let open = |path: &Path, directory: bool| {
        let mut options = fs::OpenOptions::new();
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
        let file = options.open(path)?;
        let metadata = file.metadata()?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            return Err(std::io::Error::other("拒绝重命名 Windows reparse point"));
        }
        Ok(file)
    };
    let source = open(from, true)?;
    let parent = open(
        to.parent()
            .ok_or_else(|| std::io::Error::other("目标父级缺失"))?,
        true,
    )?;
    let name = to
        .file_name()
        .ok_or_else(|| std::io::Error::other("目标名缺失"))?
        .encode_wide()
        .collect::<Vec<_>>();
    let bytes = std::mem::size_of::<FILE_RENAME_INFO>()
        + name.len().saturating_sub(1) * std::mem::size_of::<u16>();
    let words = bytes.div_ceil(std::mem::size_of::<usize>());
    let mut buffer = vec![0usize; words];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    unsafe {
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
        .map_err(std::io::Error::other)
    }
}

fn sync_materialize_parent(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        fs::File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|e| format!("同步会话技能目录 {} 失败: {e}", path.display()))
    }
    #[cfg(windows)]
    {
        // SetFileInformationByHandle 的 fixed-parent rename 不允许通过 std File
        // 同步目录；源/父句柄会保持到 rename 返回，Windows cache manager 负责
        // 目录元数据提交。这里不能退回会跟随 reparse point 的路径式打开。
        let _ = path;
        Ok(())
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err(format!(
            "当前平台不支持同步会话技能目录: {}",
            path.display()
        ))
    }
}

fn plain_directory_metadata(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_dir()
        && !metadata.file_type().is_symlink()
        && !metadata_is_reparse_point(metadata)
}

fn plain_file_metadata(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_file()
        && !metadata.file_type().is_symlink()
        && !metadata_is_reparse_point(metadata)
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

// ==================== Tauri 命令 ====================

/// 技能库全量(内置 + 用户,同名用户覆盖)。会话级"启用哪些"见
/// session_call 的 session_set_skills(driver/session.rs)。
#[tauri::command]
pub async fn skills_list(
    app: AppHandle,
    store: State<'_, SkillStoreState>,
) -> Result<SkillsCatalogSnapshot, SkillCommandError> {
    let store = store.inner().clone();
    let error_config_dir = store.inner.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Tauri resource resolution and every candidate metadata/is_dir probe may block.
        let builtin = builtin_dir(&app);
        store.snapshot(builtin.as_deref())
    })
    .await
    .map_err(|_| background_command_error("读取技能列表"))?
    .map_err(|error| command_error(error, &error_config_dir))
}

/// 默认启用开关:只影响**新会话**(与旧 sidecar 无 skills 字段的会话)的
/// 缺省集,已有会话跟随各自快照。写显式值而不是"翻转出厂规则":出厂表
/// 将来变了,用户拨过的开关语义不漂移。
#[tauri::command]
pub async fn skills_set_default(
    app: AppHandle,
    store: State<'_, SkillStoreState>,
    name: String,
    enabled: bool,
) -> Result<SkillMutationResult, SkillCommandError> {
    if !valid_skill_name(&name) {
        return Err(SkillCommandError::InvalidRequest {
            message: format!("非法技能名: {name}"),
        });
    }
    let store = store.inner().clone();
    let error_config_dir = store.inner.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let builtin = builtin_dir(&app);
        store.set_default(&name, enabled, builtin.as_deref())
    })
    .await
    .map_err(|_| background_command_error("更新技能默认值"))?
    .map(|revision| SkillMutationResult {
        catalog_revision: revision.revision,
    })
    .map_err(|error| command_error(error, &error_config_dir))
}

/// 新建/覆盖用户技能:写 <app_config_dir>/skills/<name>/SKILL.md。
/// frontmatter 里写了不同 name 会让引擎按 frontmatter 定名,与壳的
/// 目录名寻址(启用勾选、/name 斜杠)错位——前置拒绝,不留两套名字。
#[tauri::command]
pub async fn skills_save(
    app: AppHandle,
    store: State<'_, SkillStoreState>,
    name: String,
    content: String,
) -> Result<SkillMutationResult, SkillCommandError> {
    if !valid_skill_name(&name) {
        return Err(SkillCommandError::InvalidRequest {
            message: "技能名只能用字母、数字、-、_、.(不以 . 开头,至多 64 字符)".into(),
        });
    }
    if content.trim().is_empty() {
        return Err(SkillCommandError::InvalidRequest {
            message: "技能内容不能为空".into(),
        });
    }
    if let (Some(fm_name), _) = parse_frontmatter(&content) {
        if !fm_name.is_empty() && fm_name != name {
            return Err(SkillCommandError::InvalidRequest {
                message: format!("frontmatter 的 name({fm_name})与技能名({name})不一致"),
            });
        }
    }
    let store = store.inner().clone();
    let error_config_dir = store.inner.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let builtin = builtin_dir(&app);
        store.save_skill(&name, &content, builtin.as_deref())
    })
    .await
    .map_err(|_| background_command_error("保存技能"))?
    .map(|revision| SkillMutationResult {
        catalog_revision: revision.revision,
    })
    .map_err(|error| command_error(error, &error_config_dir))
}

/// 删除用户技能(内置技能只读——同名建用户技能即覆盖,删掉即还原)。
/// 已启用它的会话不受影响:物化按名取,取不到就跳过。
#[tauri::command]
pub async fn skills_delete(
    app: AppHandle,
    store: State<'_, SkillStoreState>,
    name: String,
) -> Result<SkillMutationResult, SkillCommandError> {
    if !valid_legacy_skill_name(&name) {
        return Err(SkillCommandError::InvalidRequest {
            message: format!("非法技能名: {name}"),
        });
    }
    let store = store.inner().clone();
    let error_config_dir = store.inner.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let builtin = builtin_dir(&app);
        store.delete_skill(&name, builtin.as_deref())
    })
    .await
    .map_err(|_| background_command_error("删除技能"))?
    .map(|revision| SkillMutationResult {
        catalog_revision: revision.revision,
    })
    .map_err(|error| command_error(error, &error_config_dir))
}

#[tauri::command]
pub async fn skills_recovery_list(
    store: State<'_, SkillStoreState>,
) -> Result<Vec<SkillRecoveryIssue>, SkillCommandError> {
    let store = store.inner().clone();
    let error_config_dir = store.inner.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || store.recovery_issues())
        .await
        .map_err(|_| background_command_error("读取技能恢复列表"))?
        .map_err(|error| command_error(error, &error_config_dir))
}

#[tauri::command]
pub async fn skills_recovery_resolve(
    store: State<'_, SkillStoreState>,
    transaction_id: String,
    action: SkillRecoveryAction,
) -> Result<SkillRecoveryResolveResult, SkillCommandError> {
    let store = store.inner().clone();
    let error_config_dir = store.inner.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || store.resolve_recovery(&transaction_id, action))
        .await
        .map_err(|_| background_command_error("处理技能恢复"))?
        .map_err(|error| command_error(error, &error_config_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn test_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mc-skills-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put_skill(root: &Path, name: &str, content: &str) {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), content).unwrap();
    }

    fn put_session_meta(cfg: &Path, id: &str, meta: serde_json::Value) {
        let dir = cfg.join(SESSIONS_DIR).join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("meta.json"),
            serde_json::to_vec_pretty(&meta).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn skill_name_validation_rejects_path_escapes_and_nonportable_names() {
        assert!(valid_skill_name("git-commit"));
        assert!(valid_skill_name("a.b_c1"));
        for bad in [
            "",
            ".hidden",
            "a/b",
            "a\\b",
            "..",
            "名字",
            "CON",
            "con.md",
            "COM1",
            "LPT9.txt",
            "foo.",
            &"x".repeat(65),
        ] {
            assert!(!valid_skill_name(bad), "{bad:?} 应当被拒绝");
        }
        for legacy in ["CON", "COM1", "foo."] {
            assert!(valid_legacy_skill_name(legacy));
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn legacy_safe_names_migrate_list_delete_but_never_materialize() {
        let cfg = test_dir("legacy-safe-names");
        for name in ["CON", "COM1", "foo.", "strict"] {
            put_skill(
                &cfg.join("skills"),
                name,
                &format!("---\nname: {name}\n---\n{name}"),
            );
        }
        fs::write(
            cfg.join("skills-defaults.json"),
            br#"{"CON":true,"COM1":true,"foo.":true,"strict":true}"#,
        )
        .unwrap();

        let state = SkillStoreState::new(cfg.clone()).unwrap();
        let snapshot = state.snapshot(None).unwrap();
        assert_eq!(snapshot.revision, MIGRATED_INITIAL_REVISION);
        assert_eq!(
            snapshot
                .skills
                .iter()
                .map(|skill| (skill.name.as_str(), skill.default_enabled))
                .collect::<Vec<_>>(),
            vec![
                ("COM1", false),
                ("CON", false),
                ("foo.", false),
                ("strict", true)
            ]
        );
        assert!(cfg.join(REVISION_FILE).is_file());
        assert!(cfg.join(REVISION_MIGRATION_FILE).is_file());

        let target = cfg.join("materialized");
        let enabled = ["CON".into(), "COM1".into(), "foo.".into(), "strict".into()];
        assert_eq!(
            state.materialize(&target, None, Some(&enabled)).unwrap(),
            vec!["strict"]
        );
        for legacy in ["CON", "COM1", "foo."] {
            assert!(!target.join(legacy).exists());
            state.delete_skill(legacy, None).unwrap();
            assert!(!cfg.join("skills").join(legacy).exists());
            assert!(cfg.join("skills/strict/SKILL.md").is_file());
        }
        assert_eq!(
            state
                .snapshot(None)
                .unwrap()
                .skills
                .iter()
                .map(|skill| skill.name.as_str())
                .collect::<Vec<_>>(),
            vec!["strict"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn legacy_migration_still_rejects_unsafe_linked_tree_without_revision_write() {
        use std::os::unix::fs::symlink;

        let cfg = test_dir("legacy-unsafe-tree");
        let outside = test_dir("legacy-unsafe-tree-outside");
        put_skill(&cfg.join("skills"), "foo.", "legacy");
        fs::write(outside.join("secret"), b"secret").unwrap();
        symlink(&outside, cfg.join("skills/foo./escape")).unwrap();

        let state = SkillStoreState::new(cfg.clone()).unwrap();
        assert!(matches!(
            state.snapshot(None),
            Err(SkillStoreError::RecoveryPending(_)) | Err(SkillStoreError::UnsafeObject { .. })
        ));
        assert!(!cfg.join(REVISION_FILE).exists());
        assert!(!cfg.join(REVISION_MIGRATION_FILE).exists());
        assert_eq!(fs::read(outside.join("secret")).unwrap(), b"secret");
    }

    #[test]
    fn description_prefers_frontmatter_then_first_body_line() {
        let with_fm = "---\nname: a\ndescription: 一句话\n---\n\n# 标题\n正文";
        assert_eq!(derive_description(with_fm), "一句话");
        let no_fm = "# 生成提交信息\n\n步骤…";
        assert_eq!(derive_description(no_fm), "生成提交信息");
    }

    #[test]
    fn nested_frontmatter_keys_do_not_clobber_top_level() {
        // 官方技能的真实形态:arguments 块里每个参数各带 name/description
        let fm = "---\nname: feature-design\ndescription: 顶层描述\narguments:\n  - name: workspace\n    description: Absolute path to the workspace directory\n---\n正文";
        let (name, desc) = parse_frontmatter(fm);
        assert_eq!(name.as_deref(), Some("feature-design"));
        assert_eq!(desc.as_deref(), Some("顶层描述"));
    }

    #[test]
    fn user_skill_shadows_builtin_with_same_name() {
        let builtin = test_dir("shadow-builtin");
        let user = test_dir("shadow-user");
        put_skill(&builtin, "review", "内置版");
        put_skill(&builtin, "only-builtin", "内置独有");
        put_skill(&user, "review", "用户版");
        let all = list_unlocked(Some(&builtin), &user, &user.join("no-defaults.json"));
        assert_eq!(
            all.iter()
                .map(|s| (s.name.as_str(), s.source.as_str()))
                .collect::<Vec<_>>(),
            vec![("only-builtin", "builtin"), ("review", "user")]
        );
        assert_eq!(all[1].content, "用户版");
        // 覆盖关系外显:设置页靠 overrides 提示"官方更新不会跟进这份副本"
        assert!(all[1].overrides, "同名用户技能应标记覆盖内置");
        assert!(!all[0].overrides);
    }

    #[test]
    fn materialize_writes_enabled_subset_and_keeps_sessions_isolated() {
        let builtin = test_dir("mat-builtin");
        let user = test_dir("mat-user");
        let engine = test_dir("mat-engine");
        let first = engine.join("sessions/first/skills");
        let second = engine.join("sessions/second/skills");
        put_skill(&builtin, "a", "A");
        put_skill(&user, "b", "B");
        // 辅助资源一并拷贝
        fs::create_dir_all(user.join("b/references")).unwrap();
        fs::write(user.join("b/references/x.md"), "ref").unwrap();

        let nodefaults = user.join("no-defaults.json");
        let both = materialize_unlocked(
            &first,
            Some(&builtin),
            &user,
            &nodefaults,
            Some(&["a".into(), "b".into()]),
        )
        .unwrap();
        assert_eq!(both, vec!["a", "b"]);
        assert!(first.join("b/references/x.md").is_file());

        let only_b = materialize_unlocked(
            &second,
            Some(&builtin),
            &user,
            &nodefaults,
            Some(&["b".into()]),
        )
        .unwrap();
        assert_eq!(only_b, vec!["b"]);
        assert!(first.join("a").exists(), "更新另一会话不得改写已有会话");
        assert!(!second.join("a").exists(), "未启用的技能不得写入当前会话");
        // 启用名单里有已删除的技能名:跳过不报错(会话 sidecar 可能引用旧名)
        let gone = materialize_unlocked(
            &second,
            Some(&builtin),
            &user,
            &nodefaults,
            Some(&["b".into(), "zz".into()]),
        )
        .unwrap();
        assert_eq!(gone, vec!["b"]);
        assert!(first.join("a").exists(), "重写当前会话仍不得影响其他会话");
    }

    #[test]
    fn every_atomic_materialize_failure_restores_the_old_directory() {
        let user = test_dir("materialize-fault-user");
        put_skill(&user, "new-skill", "new");
        let defaults = user.join("no-defaults.json");
        let steps = [
            MaterializeStep::ValidateParent,
            MaterializeStep::CreateTemporary,
            MaterializeStep::ScanCatalog,
            MaterializeStep::CopySkill,
            MaterializeStep::SyncTemporary,
            MaterializeStep::ValidateTarget,
            MaterializeStep::BackupOld,
            MaterializeStep::SyncParentAfterBackup,
            MaterializeStep::InstallNew,
            MaterializeStep::SyncParentAfterInstall,
            MaterializeStep::CleanupBackup,
        ];

        for (index, failed_step) in steps.into_iter().enumerate() {
            let root = test_dir(&format!("materialize-fault-{index}"));
            let target = root.join("skills");
            fs::create_dir(&target).unwrap();
            fs::write(target.join("old.marker"), format!("old-{index}")).unwrap();
            let result = materialize_unlocked_with_hook(
                &target,
                None,
                &user,
                &defaults,
                Some(&["new-skill".into()]),
                |step| {
                    if step == failed_step {
                        Err(format!("injected {step:?}"))
                    } else {
                        Ok(())
                    }
                },
            );
            assert!(result.is_err(), "{failed_step:?} 未触发失败");
            assert_eq!(
                fs::read_to_string(target.join("old.marker")).unwrap(),
                format!("old-{index}"),
                "{failed_step:?} 没有恢复旧目录"
            );
            assert!(
                !target.join("new-skill").exists(),
                "{failed_step:?} 泄漏了未提交新目录"
            );
            let leftovers = fs::read_dir(&root)
                .unwrap()
                .flatten()
                .filter(|entry| entry.file_name().to_string_lossy().starts_with(".skills."))
                .collect::<Vec<_>>();
            assert!(leftovers.is_empty(), "{failed_step:?} 残留事务目录");
        }
    }

    #[test]
    fn real_process_crash_reentry_recovers_every_materialize_stage_without_orphans() {
        for boundary in [
            "journal-prepared",
            "backup-renamed",
            "backup-stage-synced",
            "target-installed",
            "installed-stage-synced",
            "backup-cleaned",
        ] {
            let root = test_dir(&format!("materialize-crash-{boundary}"));
            let user = root.join("user");
            fs::create_dir(&user).unwrap();
            put_skill(&user, "new-skill", "new");
            let target = root.join("skills");
            fs::create_dir(&target).unwrap();
            fs::write(target.join("old.marker"), "old").unwrap();

            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .arg("--exact")
                .arg("skills::tests::materialize_crash_helper")
                .arg("--nocapture")
                .env("MC_MATERIALIZE_CRASH_ROOT", &root)
                .env("MC_MATERIALIZE_CRASH_BOUNDARY", boundary)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap();
            assert_eq!(status.code(), Some(86), "boundary={boundary}");

            let done = materialize_unlocked(
                &target,
                None,
                &user,
                &user.join("no-defaults.json"),
                Some(&["new-skill".into()]),
            )
            .unwrap();
            assert_eq!(done, vec!["new-skill"]);
            assert_eq!(
                fs::read_to_string(target.join("new-skill/SKILL.md")).unwrap(),
                "new"
            );
            let leftovers = fs::read_dir(&root)
                .unwrap()
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| {
                    name.starts_with(".skills.materialize-")
                        || name.starts_with(".skills.backup-")
                        || name == ".skills.materialize.json"
                })
                .collect::<Vec<_>>();
            assert!(leftovers.is_empty(), "boundary={boundary}: {leftovers:?}");
        }
    }

    #[test]
    fn materialize_crash_helper() {
        let Some(root) = std::env::var_os("MC_MATERIALIZE_CRASH_ROOT").map(PathBuf::from) else {
            return;
        };
        let target = root.join("skills");
        let user = root.join("user");
        let result = materialize_unlocked(
            &target,
            None,
            &user,
            &user.join("no-defaults.json"),
            Some(&["new-skill".into()]),
        );
        panic!("崩溃边界未退出进程: {result:?}");
    }

    #[test]
    fn atomic_materialize_success_replaces_old_tree_only_after_full_generation() {
        let user = test_dir("materialize-success-user");
        put_skill(&user, "new-skill", "new");
        let root = test_dir("materialize-success-root");
        let target = root.join("skills");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("old.marker"), "old").unwrap();

        let done = materialize_unlocked(
            &target,
            None,
            &user,
            &user.join("no-defaults.json"),
            Some(&["new-skill".into()]),
        )
        .unwrap();
        assert_eq!(done, vec!["new-skill"]);
        assert_eq!(
            fs::read_to_string(target.join("new-skill/SKILL.md")).unwrap(),
            "new"
        );
        assert!(!target.join("old.marker").exists());
    }

    #[test]
    fn recovery_gate_blocks_materialize_without_touching_the_old_tree() {
        let cfg = test_dir("materialize-recovery-gate");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        put_skill(&cfg.join("skills"), "new-skill", "new");
        fs::remove_file(cfg.join(REVISION_FILE)).unwrap();
        let target = cfg.join("session/skills");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("old.marker"), "old").unwrap();

        let error = state
            .materialize(&target, None, Some(&["new-skill".into()]))
            .unwrap_err();
        assert!(matches!(error, SkillStoreError::RecoveryPending(_)));
        assert_eq!(
            fs::read_to_string(target.join("old.marker")).unwrap(),
            "old"
        );
        assert!(!target.join("new-skill").exists());
    }

    #[cfg(unix)]
    #[test]
    fn materialize_rejects_reparsed_parent_without_writing_outside() {
        use std::os::unix::fs::symlink;

        let user = test_dir("materialize-parent-link-user");
        put_skill(&user, "safe", "safe");
        let root = test_dir("materialize-parent-link-root");
        let outside = test_dir("materialize-parent-link-outside");
        symlink(&outside, root.join("linked")).unwrap();
        let target = root.join("linked/session/skills");

        assert!(materialize_unlocked(
            &target,
            None,
            &user,
            &user.join("no-defaults.json"),
            Some(&["safe".into()]),
        )
        .is_err());
        assert!(!outside.join("session").exists());
    }

    #[cfg(unix)]
    #[test]
    fn materialize_rejects_source_symlink_and_preserves_old_tree() {
        use std::os::unix::fs::symlink;

        let user = test_dir("materialize-source-link-user");
        put_skill(&user, "linked", "linked");
        fs::write(user.join("linked/real.txt"), "outside").unwrap();
        symlink("real.txt", user.join("linked/link.txt")).unwrap();
        let root = test_dir("materialize-source-link-root");
        let target = root.join("skills");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("old.marker"), "old").unwrap();

        assert!(materialize_unlocked(
            &target,
            None,
            &user,
            &user.join("no-defaults.json"),
            Some(&["linked".into()]),
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(target.join("old.marker")).unwrap(),
            "old"
        );
    }

    #[test]
    fn default_set_is_factory_rule_overridden_by_prefs() {
        let builtin = test_dir("def-builtin");
        let user = test_dir("def-user");
        let target = test_dir("def-target");
        put_skill(&builtin, "feature-design", "官方默认项");
        put_skill(&builtin, "tailwindcss-helper", "官方非默认项");
        put_skill(&user, "my-skill", "用户技能出厂默认启用");

        // 无开关文件:纯出厂规则
        let def = materialize_unlocked(
            &target,
            Some(&builtin),
            &user,
            &user.join("no-defaults.json"),
            None,
        )
        .unwrap();
        assert_eq!(def, vec!["feature-design", "my-skill"]);
        assert!(!target.join("tailwindcss-helper").exists());

        // 显式开关压过出厂:关掉官方默认项、打开非默认项与用户技能关闭
        let prefs_path = test_dir("def-prefs").join("skills-defaults.json");
        fs::write(
            &prefs_path,
            r#"{"feature-design": false, "tailwindcss-helper": true, "my-skill": false}"#,
        )
        .unwrap();
        let def = materialize_unlocked(&target, Some(&builtin), &user, &prefs_path, None).unwrap();
        assert_eq!(def, vec!["tailwindcss-helper"]);
        // list_unlocked() 的 default_enabled 与物化同一解析
        let infos = list_unlocked(Some(&builtin), &user, &prefs_path);
        let on: Vec<&str> = infos
            .iter()
            .filter(|s| s.default_enabled)
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(on, vec!["tailwindcss-helper"]);
    }

    #[test]
    fn frontmatter_name_mismatch_is_detected() {
        let (name, _) = parse_frontmatter("---\nname: other\n---\n正文");
        assert_eq!(name.as_deref(), Some("other"));
        let (none, _) = parse_frontmatter("# 无 frontmatter");
        assert!(none.is_none());
    }

    #[test]
    fn state_revision_results_cover_save_default_delete_and_recovery() {
        let cfg = test_dir("state-revisions");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        let initial = state.snapshot(None).unwrap();
        assert_eq!(initial.revision, 0);
        assert_eq!(initial.store_id.len(), 32);

        let saved = state
            .save_skill("review", "---\nname: review\n---\nbody", None)
            .unwrap();
        let defaulted = state.set_default("review", false, None).unwrap();
        let target = cfg.join("session-skills");
        let materialized = state
            .materialize(&target, None, Some(&["review".into()]))
            .unwrap();
        assert_eq!(materialized, vec!["review"]);
        let listed = state.snapshot(None).unwrap();
        assert_eq!(listed.revision, defaulted.revision);
        assert_eq!(listed.store_id, initial.store_id);
        assert_eq!(listed.skills.len(), 1);
        let deleted = state.delete_skill("review", None).unwrap();
        let (_, imported) = state
            .import(None, |user, _| {
                fs::write(user.join("import-marker"), b"imported")
                    .map_err(|error| SkillStoreError::io("导入测试", user, error))?;
                sync_directory(user)
            })
            .unwrap();
        let (_, recovered) = state
            .recovery(|user, _| {
                fs::write(user.join("recovery-marker"), b"recovered")
                    .map_err(|error| SkillStoreError::io("恢复测试", user, error))?;
                sync_directory(user)
            })
            .unwrap();
        assert_eq!(
            [
                saved.revision,
                defaulted.revision,
                deleted.revision,
                imported.revision,
                recovered.revision,
            ],
            [1, 2, 3, 4, 5]
        );
    }

    #[test]
    fn automatic_recovery_revision_is_polled_once_but_local_write_is_deduplicated() {
        let cfg = test_dir("automatic-recovery-event");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        assert!(state.poll_external_catalog_revision().unwrap().is_none());

        let source = test_dir("automatic-recovery-event-source");
        put_skill(&source, "recovered", "recovered content");
        crate::skill_transactions::seed_prepared_new_for_test(
            &cfg.join("skills"),
            &source.join("recovered"),
            "recovered",
        );
        let snapshot = state.snapshot(None).unwrap();
        assert_eq!(snapshot.revision, 1);
        assert!(
            crate::skill_transactions::discover_locked(&cfg.join("skills"))
                .unwrap()
                .entries
                .is_empty(),
            "read 必须完成自动恢复后才返回"
        );

        let recovered = state
            .poll_external_catalog_revision()
            .unwrap()
            .expect("自动恢复推进的 revision 必须交付给 watcher");
        assert_eq!(recovered.revision, 1);
        assert!(state.poll_external_catalog_revision().unwrap().is_none());

        let saved = state.save_skill("local", "local", None).unwrap();
        assert_eq!(saved.revision, 2);
        assert!(
            state.poll_external_catalog_revision().unwrap().is_none(),
            "显式本地 mutation 应更新 watcher 水位，避免重复事件"
        );
    }

    #[test]
    fn first_skill_write_freezes_missing_sessions_at_prewrite_defaults_idempotently() {
        let cfg = test_dir("legacy-session-baseline");
        let builtin = test_dir("legacy-session-builtin");
        put_skill(&builtin, "feature-design", "builtin default");
        put_skill(&builtin, "opt-in", "builtin opt-in");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        put_skill(&cfg.join("skills"), "existing-user", "existing");
        fs::write(cfg.join("skills-defaults.json"), br#"{"opt-in":true}"#).unwrap();
        put_session_meta(&cfg, "legacy", json!({"title":"old"}));
        put_session_meta(
            &cfg,
            "explicit",
            json!({"skills":["kept"],"skills_revision":7}),
        );

        state
            .save_skill("new-user", "---\nname: new-user\n---\nnew", Some(&builtin))
            .unwrap();
        let first_bytes = fs::read(cfg.join(LEGACY_SESSION_SKILLS_FILE)).unwrap();
        let baseline: LegacySessionSkills = serde_json::from_slice(&first_bytes).unwrap();
        assert_eq!(
            baseline.get("legacy").unwrap(),
            &vec![
                "existing-user".to_string(),
                "feature-design".to_string(),
                "opt-in".to_string(),
            ]
        );
        assert!(!baseline.contains_key("explicit"));
        assert!(!baseline["legacy"].contains(&"new-user".to_string()));

        state
            .set_default("new-user", false, Some(&builtin))
            .unwrap();
        assert_eq!(
            fs::read(cfg.join(LEGACY_SESSION_SKILLS_FILE)).unwrap(),
            first_bytes,
            "第二次写入不得重算已冻结 baseline"
        );
        let explicit: Value = serde_json::from_slice(
            &fs::read(cfg.join(SESSIONS_DIR).join("explicit/meta.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(explicit["skills"], json!(["kept"]));
        assert_eq!(explicit["skills_revision"], 7);
    }

    #[test]
    fn baseline_failure_advances_only_conservative_catalog_revision() {
        let cfg = test_dir("legacy-session-baseline-failure");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        put_skill(&cfg.join("skills"), "before", "before");
        put_session_meta(&cfg, "legacy", json!({"title":"old"}));
        state
            .inner
            .fail_next_legacy_baseline_write
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let result = state.save_skill("must-not-exist", "content", None);
        assert!(matches!(result, Err(SkillStoreError::Io { .. })));
        assert!(!cfg.join("skills/must-not-exist").exists());
        assert!(!cfg.join(LEGACY_SESSION_SKILLS_FILE).exists());
        assert_eq!(state.snapshot(None).unwrap().revision, 1);
    }

    #[test]
    fn save_delete_default_and_import_all_run_the_same_baseline_gate() {
        for mutation in ["save", "delete", "default", "import"] {
            let cfg = test_dir(&format!("legacy-gate-{mutation}"));
            let state = SkillStoreState::new(cfg.clone()).unwrap();
            put_skill(&cfg.join("skills"), "before", "before");
            put_session_meta(&cfg, "legacy", json!({"title":"old"}));
            match mutation {
                "save" => {
                    state.save_skill("after", "after", None).unwrap();
                }
                "delete" => {
                    state.delete_skill("before", None).unwrap();
                }
                "default" => {
                    state.set_default("before", false, None).unwrap();
                }
                "import" => {
                    state
                        .import(None, |user, _| {
                            fs::write(user.join("imported"), b"imported")
                                .map_err(|error| SkillStoreError::io("导入测试", user, error))
                        })
                        .unwrap();
                }
                _ => unreachable!(),
            }
            let baseline: LegacySessionSkills =
                serde_json::from_slice(&fs::read(cfg.join(LEGACY_SESSION_SKILLS_FILE)).unwrap())
                    .unwrap();
            assert_eq!(baseline["legacy"], vec!["before"], "mutation={mutation}");
        }
    }

    #[test]
    fn corrupt_sidecar_aborts_baseline_before_authoritative_write() {
        let cfg = test_dir("legacy-session-corrupt-sidecar");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        let session = cfg.join(SESSIONS_DIR).join("legacy");
        fs::create_dir_all(&session).unwrap();
        fs::write(session.join("meta.json"), b"{").unwrap();

        let result = state.set_default("feature-design", false, None);
        assert!(matches!(result, Err(SkillStoreError::Io { .. })));
        assert!(!cfg.join("skills-defaults.json").exists());
        assert_eq!(state.snapshot(None).unwrap().revision, 1);
    }

    #[test]
    fn materialize_uses_explicit_sidecar_selection_before_legacy_baseline() {
        let cfg = test_dir("legacy-session-materialize");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        put_skill(&cfg.join("skills"), "frozen", "frozen");
        put_skill(&cfg.join("skills"), "explicit", "explicit");
        crate::config::atomic_write_private(
            &cfg.join(LEGACY_SESSION_SKILLS_FILE),
            &serde_json::to_vec_pretty(&json!({"legacy":["frozen"]})).unwrap(),
        )
        .unwrap();

        let target = cfg.join("materialized-legacy");
        assert_eq!(
            state
                .materialize_session(&target, None, "legacy", None)
                .unwrap(),
            vec!["frozen"]
        );
        assert!(!target.join("explicit").exists());
        assert_eq!(
            state
                .materialize_session(&target, None, "legacy", Some(&["explicit".into()]),)
                .unwrap(),
            vec!["explicit"]
        );
        assert!(!target.join("frozen").exists());
    }

    #[test]
    fn list_read_gate_is_shared_within_and_across_os_lock_layer() {
        let cfg = test_dir("shared-read");
        let state = SkillStoreState::new(cfg).unwrap();
        let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let maximum = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut threads = Vec::new();
        for _ in 0..2 {
            let state = state.clone();
            let active = active.clone();
            let maximum = maximum.clone();
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                state
                    .read(|_| {
                        let now = active.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                        maximum.fetch_max(now, std::sync::atomic::Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(80));
                        active.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                        Ok(())
                    })
                    .unwrap();
            }));
        }
        barrier.wait();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(maximum.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn windows_baseline_contract_uses_fixed_parent_relative_handles() {
        let source = include_str!("skill_import/store.rs");
        let windows = source
            .split("#[cfg(windows)]")
            .nth(1)
            .unwrap()
            .split("#[cfg(not(any(unix, windows)))]")
            .next()
            .unwrap();
        for required in [
            "NtCreateFile",
            "RootDirectory",
            "OBJ_DONT_REPARSE",
            "FILE_OPEN_REPARSE_POINT",
            "GetFileInformationByHandleEx",
            "FileIdBothDirectoryInfo",
            "FILE_ATTRIBUTE_REPARSE_POINT",
            "FILE_TYPE_DISK",
        ] {
            assert!(
                windows.contains(required),
                "Windows baseline 缺少 {required}"
            );
        }
        // 来源只能相对固定父句柄枚举/打开/读取；destination.join 只是构造
        // 已独占创建的输出树名称，不属于来源路径重开。
        for forbidden in ["fs::read_dir", "fs::read(", "fs::copy"] {
            assert!(
                !windows.contains(forbidden),
                "Windows baseline 不得按来源路径重开: {forbidden}"
            );
        }
        for required in ["open_relative(&directory", ".create_new(true)", "io::copy"] {
            assert!(
                windows.contains(required),
                "Windows 安全复制缺少 {required}"
            );
        }
        assert!(!windows.contains("Windows 安全 baseline 相对枚举当前不可用"));
    }

    #[test]
    fn safe_nonempty_store_missing_revision_is_migrated_once_but_corruption_is_preserved() {
        let cfg = test_dir("missing-revision-migration");
        put_skill(&cfg.join("skills"), "keep", "keep me");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        let snapshot = state.snapshot(None).unwrap();
        assert_eq!(snapshot.revision, MIGRATED_INITIAL_REVISION);
        assert_eq!(snapshot.skills.len(), 1);
        let marker: RevisionMigrationDocument =
            serde_json::from_slice(&fs::read(cfg.join(REVISION_MIGRATION_FILE)).unwrap()).unwrap();
        assert_eq!(marker.format, REVISION_MIGRATION_FORMAT);
        assert_eq!(marker.migration, REVISION_MIGRATION_KIND);
        assert_eq!(marker.store_id, snapshot.store_id);
        assert_eq!(marker.initial_revision, MIGRATED_INITIAL_REVISION);
        assert_eq!(
            fs::read_to_string(cfg.join("skills/keep/SKILL.md")).unwrap(),
            "keep me"
        );

        // 模拟 marker 已 fsync、revision 尚未发布时退出；重入必须复用 store_id。
        fs::remove_file(cfg.join(REVISION_FILE)).unwrap();
        drop(state);
        let resumed = SkillStoreState::new(cfg.clone())
            .unwrap()
            .snapshot(None)
            .unwrap();
        assert_eq!(resumed.store_id, marker.store_id);
        assert_eq!(resumed.revision, MIGRATED_INITIAL_REVISION);

        let corrupt = test_dir("corrupt-revision");
        put_skill(&corrupt.join("skills"), "keep", "keep me");
        fs::write(corrupt.join(REVISION_FILE), b"not-json").unwrap();
        let state = SkillStoreState::new(corrupt.clone()).unwrap();
        assert!(matches!(
            state.snapshot(None),
            Err(SkillStoreError::RecoveryPending(_)) | Err(SkillStoreError::CorruptRevision(_))
        ));
        assert_eq!(fs::read(corrupt.join(REVISION_FILE)).unwrap(), b"not-json");
        assert!(!corrupt.join(REVISION_MIGRATION_FILE).exists());
    }

    #[test]
    fn missing_revision_migration_rejects_unsafe_root_and_transaction_residue() {
        let unsafe_cfg = test_dir("missing-revision-unsafe");
        fs::create_dir_all(unsafe_cfg.join("skills")).unwrap();
        fs::write(unsafe_cfg.join("skills/rogue.txt"), b"rogue").unwrap();
        let unsafe_state = SkillStoreState::new(unsafe_cfg.clone()).unwrap();
        assert!(matches!(
            unsafe_state.snapshot(None),
            Err(SkillStoreError::RecoveryPending(_))
        ));
        assert!(!unsafe_cfg.join(REVISION_FILE).exists());
        assert!(!unsafe_cfg.join(REVISION_MIGRATION_FILE).exists());

        let tx_cfg = test_dir("missing-revision-transaction");
        let source = test_dir("missing-revision-transaction-source");
        put_skill(&source, "demo", "candidate");
        crate::skill_transactions::seed_prepared_new_for_test(
            &tx_cfg.join("skills"),
            &source.join("demo"),
            "demo",
        );
        let tx_state = SkillStoreState::new(tx_cfg.clone()).unwrap();
        let issues = tx_state.recovery_issues().unwrap();
        assert!(!issues.is_empty());
        assert!(issues.iter().all(|issue| issue.actions.is_empty()));
        assert!(!tx_cfg.join(REVISION_FILE).exists());
        assert!(!tx_cfg.join(REVISION_MIGRATION_FILE).exists());
    }

    #[test]
    fn concurrent_missing_revision_initializers_publish_one_store_identity() {
        let cfg = test_dir("missing-revision-concurrent");
        put_skill(&cfg.join("skills"), "keep", "keep me");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let handles = (0..2)
            .map(|_| {
                let cfg = cfg.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    SkillStoreState::new(cfg).unwrap().snapshot(None).unwrap()
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let snapshots = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(snapshots[0].store_id, snapshots[1].store_id);
        assert_eq!(snapshots[0].revision, MIGRATED_INITIAL_REVISION);
        assert_eq!(snapshots[1].revision, MIGRATED_INITIAL_REVISION);
        let marker: RevisionMigrationDocument =
            serde_json::from_slice(&fs::read(cfg.join(REVISION_MIGRATION_FILE)).unwrap()).unwrap();
        assert_eq!(marker.store_id, snapshots[0].store_id);
    }

    #[test]
    fn revision_write_failure_runs_zero_authoritative_side_effects() {
        let cfg = test_dir("revision-write-failure");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        state
            .inner
            .fail_next_revision_write
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let called = std::sync::atomic::AtomicBool::new(false);
        let result = state.write(|user, _| {
            called.store(true, std::sync::atomic::Ordering::SeqCst);
            fs::write(user.join("must-not-exist"), b"bad")
                .map_err(|error| SkillStoreError::io("revision 失败测试", user, error))
        });
        assert!(matches!(result, Err(SkillStoreError::Io { .. })));
        assert!(!called.load(std::sync::atomic::Ordering::SeqCst));
        assert!(!cfg.join("skills/must-not-exist").exists());
        assert_eq!(state.snapshot(None).unwrap().revision, 0);
    }

    #[test]
    fn failed_authoritative_closure_keeps_pre_reserved_revision() {
        let cfg = test_dir("failed-authoritative-closure");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        let result = state.import::<()>(None, |_, _| {
            // 闭包开始时 next revision 必须已经原子持久化，而不是事后提交。
            assert_eq!(
                read_revision(&cfg.join(REVISION_FILE))
                    .unwrap()
                    .unwrap()
                    .revision,
                1
            );
            Err(SkillStoreError::io(
                "注入权威闭包失败",
                Path::new("operation"),
                "test injection",
            ))
        });
        assert!(matches!(result, Err(SkillStoreError::Io { .. })));
        assert_eq!(state.snapshot(None).unwrap().revision, 1);

        let (_, reserved) = state.recovery(|_, _| Ok(())).unwrap();
        assert_eq!(reserved.revision, 2);
        assert_eq!(state.snapshot(None).unwrap().revision, 2);
    }

    #[test]
    fn revision_overflow_runs_zero_authoritative_writes() {
        let cfg = test_dir("revision-overflow");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        let initial = state.snapshot(None).unwrap();
        write_revision_synced(
            &cfg.join(REVISION_FILE),
            &StoreRevision {
                store_id: initial.store_id,
                revision: u64::MAX,
            },
        )
        .unwrap();
        let called = std::sync::atomic::AtomicBool::new(false);
        let result = state.write(|user, _| {
            called.store(true, std::sync::atomic::Ordering::SeqCst);
            fs::write(user.join("must-not-exist"), b"bad")
                .map_err(|error| SkillStoreError::io("overflow 测试", user, error))
        });
        assert!(matches!(result, Err(SkillStoreError::RevisionOverflow)));
        assert!(!called.load(std::sync::atomic::Ordering::SeqCst));
        assert!(!cfg.join("skills/must-not-exist").exists());
        assert_eq!(
            read_revision(&cfg.join(REVISION_FILE))
                .unwrap()
                .unwrap()
                .revision,
            u64::MAX
        );
    }

    #[test]
    fn baseline_is_captured_under_state_write_gate_with_parsed_skill_md() {
        let cfg = test_dir("state-baseline");
        let state = SkillStoreState::new(cfg).unwrap();
        state
            .save_skill(
                "review",
                "---\nname: review\ndescription: stable preview\n---\nbody",
                None,
            )
            .unwrap();
        let baseline = state.capture_target_baseline("review").unwrap();
        assert_eq!(baseline.revision, 1);
        assert_eq!(baseline.preview.unwrap().description, "stable preview");
        assert!(baseline
            .tree_identity
            .iter()
            .any(|entry| entry.relative_path == "SKILL.md"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_baseline_runtime_enumerates_nested_tree_from_handles() {
        let cfg = test_dir("windows-baseline-runtime");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        state
            .save_skill("review", "---\nname: review\n---\nbody", None)
            .unwrap();
        let references = cfg.join("skills/review/references");
        fs::create_dir_all(&references).unwrap();
        fs::write(references.join("guide.md"), b"fixed-handle content").unwrap();

        let baseline = state.capture_target_baseline("review").unwrap();
        let paths = baseline
            .tree_identity
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<Vec<_>>();
        assert!(paths.contains(&"SKILL.md"));
        assert!(paths.contains(&"references"));
        assert!(paths.contains(&"references/guide.md"));
        assert!(baseline
            .tree_identity
            .iter()
            .filter(|entry| entry.entry_type == crate::skill_import::store::TargetEntryType::File)
            .all(|entry| entry.content_sha256.is_some()));
    }

    fn spawn_state_helper(cfg: &Path, role: &str, mode: &str) -> std::process::Child {
        std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("skills::tests::multiprocess_state_helper")
            .arg("--nocapture")
            .env("MC_SKILLS_HELPER_CFG", cfg)
            .env("MC_SKILLS_HELPER_ROLE", role)
            .env("MC_SKILLS_HELPER_MODE", mode)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap()
    }

    fn wait_for(path: &Path) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while !path.exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "等待 {} 超时",
                path.display()
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    #[test]
    fn multiprocess_production_state_covers_list_save_delete_default_and_materialize() {
        let cfg = test_dir("state-production-multiprocess");
        let mut children = ["a", "b", "c"]
            .into_iter()
            .map(|role| spawn_state_helper(&cfg, role, "production"))
            .collect::<Vec<_>>();
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }
        let store_ids = ["a", "b", "c"]
            .into_iter()
            .map(|role| fs::read_to_string(cfg.join(format!("{role}.store-id"))).unwrap())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(store_ids.len(), 1);
        let state = SkillStoreState::new(cfg).unwrap();
        // 每个 helper 的 save/default/delete 都是权威 mutation；list/materialize
        // 是共享读且不推进 revision。
        assert_eq!(state.snapshot(None).unwrap().revision, 9);
    }

    #[test]
    fn two_process_stress_interleaves_all_store_entrypoints_and_external_revision_poll() {
        let cfg = test_dir("state-all-entrypoints-stress");
        let observer = SkillStoreState::new(cfg.clone()).unwrap();
        assert_eq!(observer.snapshot(None).unwrap().revision, 0);
        let mut children = ["left", "right"]
            .into_iter()
            .map(|role| spawn_state_helper(&cfg, role, "all-entrypoints-stress"))
            .collect::<Vec<_>>();
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }

        let event = observer
            .poll_external_catalog_revision()
            .unwrap()
            .expect("另一进程的 mutation 应触发 catalog revision 事件");
        assert_eq!(event.revision, 40);
        assert!(observer.poll_external_catalog_revision().unwrap().is_none());
        assert_eq!(observer.snapshot(None).unwrap().revision, 40);
        for role in ["left", "right"] {
            for iteration in 0..4 {
                assert!(cfg
                    .join("skills")
                    .join(format!("import-{role}-{iteration}"))
                    .is_file());
                assert!(cfg
                    .join("skills")
                    .join(format!("recovery-{role}-{iteration}"))
                    .is_file());
            }
        }
    }

    #[test]
    fn multiprocess_readers_take_over_crashed_transaction_before_listing() {
        let cfg = test_dir("transaction-takeover-multiprocess");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        let source_root = test_dir("transaction-takeover-source");
        put_skill(
            &source_root,
            "demo",
            "---\nname: demo\n---\ncrashed prepared content",
        );
        crate::skill_transactions::seed_prepared_new_for_test(
            &cfg.join("skills"),
            &source_root.join("demo"),
            "demo",
        );
        drop(state);
        let mut children = ["a", "b"]
            .into_iter()
            .map(|role| spawn_state_helper(&cfg, role, "recovery-read"))
            .collect::<Vec<_>>();
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }
        assert!(
            crate::skill_transactions::discover_locked(&cfg.join("skills"))
                .unwrap()
                .entries
                .is_empty()
        );
        assert!(SkillStoreState::new(cfg).unwrap().snapshot(None).is_ok());
    }

    #[test]
    fn multiprocess_observer_drops_cached_issue_after_resolver_commits() {
        let cfg = test_dir("transaction-resolve-multiprocess");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        let id =
            crate::skill_transactions::seed_unrecoverable_for_test(&cfg.join("skills"), "demo");
        fs::write(cfg.join("recovery.tx-id"), &id).unwrap();
        drop(state);

        let mut observer = spawn_state_helper(&cfg, "observer", "recovery-cache");
        wait_for(&cfg.join("observer.blocked"));
        let mut resolver = spawn_state_helper(&cfg, "resolver", "recovery-resolve");
        assert!(resolver.wait().unwrap().success());
        assert!(observer.wait().unwrap().success());
        let revision = fs::read_to_string(cfg.join("observer.revision"))
            .unwrap()
            .parse::<u64>()
            .unwrap();
        assert_eq!(
            SkillStoreState::new(cfg)
                .unwrap()
                .snapshot(None)
                .unwrap()
                .revision,
            revision
        );
    }

    #[test]
    fn multiprocess_first_writers_freeze_one_prewrite_legacy_baseline() {
        let cfg = test_dir("legacy-session-multiprocess");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        put_skill(&cfg.join("skills"), "before", "before");
        put_session_meta(&cfg, "legacy", json!({"title":"old"}));
        drop(state);

        let mut children = ["a", "b"]
            .into_iter()
            .map(|role| spawn_state_helper(&cfg, role, "legacy-baseline"))
            .collect::<Vec<_>>();
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }
        let baseline: LegacySessionSkills =
            serde_json::from_slice(&fs::read(cfg.join(LEGACY_SESSION_SKILLS_FILE)).unwrap())
                .unwrap();
        assert_eq!(baseline["legacy"], vec!["before"]);
        assert_eq!(
            SkillStoreState::new(cfg)
                .unwrap()
                .snapshot(None)
                .unwrap()
                .revision,
            2
        );
    }

    #[test]
    fn baseline_scan_tolerates_concurrent_explicit_sidecar_write_and_delete() {
        let cfg = test_dir("legacy-session-sidecar-race");
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        put_skill(&cfg.join("skills"), "before", "before");
        put_session_meta(&cfg, "becomes-explicit", json!({"title":"old"}));
        put_session_meta(&cfg, "deleted", json!({"title":"delete me"}));
        drop(state);
        fs::write(cfg.join("baseline.pause-request"), b"deleted").unwrap();

        let mut migrator = spawn_state_helper(&cfg, "migrator", "baseline-sidecar-race");
        wait_for(&cfg.join("baseline.scan-entered"));
        crate::config::atomic_write_private(
            &cfg.join(SESSIONS_DIR).join("becomes-explicit/meta.json"),
            &serde_json::to_vec_pretty(&json!({
                "title": "updated concurrently",
                "skills": ["explicit"],
                "skills_revision": 9,
            }))
            .unwrap(),
        )
        .unwrap();
        fs::remove_dir_all(cfg.join(SESSIONS_DIR).join("deleted")).unwrap();
        fs::write(cfg.join("baseline.scan-release"), b"release").unwrap();
        assert!(migrator.wait().unwrap().success());

        let explicit: Value = serde_json::from_slice(
            &fs::read(cfg.join(SESSIONS_DIR).join("becomes-explicit/meta.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(explicit["skills"], json!(["explicit"]));
        assert_eq!(explicit["skills_revision"], 9);
        assert!(!cfg.join(SESSIONS_DIR).join("deleted").exists());
        let baseline: LegacySessionSkills =
            serde_json::from_slice(&fs::read(cfg.join(LEGACY_SESSION_SKILLS_FILE)).unwrap())
                .unwrap();
        // Depending on directory enumeration order the independent baseline may have
        // captured the old implicit state, but the explicit sidecar always wins and is untouched.
        assert!(!baseline.contains_key("deleted"));
        assert!(cfg.join("skills/after-migrator/SKILL.md").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn replacing_skills_lock_cannot_split_two_process_critical_sections() {
        let cfg = test_dir("replace-lock");
        let mut first = spawn_state_helper(&cfg, "first", "replacement");
        wait_for(&cfg.join("first.active"));
        // 模拟不遵守协议的外部删除/替换。第二个生产 state 仍先等待稳定父目录
        // 锚锁，不能仅因拿到新 inode 而与第一个旧 inode 临界区重叠。
        fs::remove_file(cfg.join(LOCK_FILE)).unwrap();
        fs::write(cfg.join(LOCK_FILE), b"replacement").unwrap();
        let mut second = spawn_state_helper(&cfg, "second", "replacement");
        assert!(first.wait().unwrap().success());
        assert!(second.wait().unwrap().success());
        assert!(!cfg.join("overlap").exists());
        assert_eq!(
            SkillStoreState::new(cfg)
                .unwrap()
                .snapshot(None)
                .unwrap()
                .revision,
            2
        );
    }

    #[test]
    fn multiprocess_state_helper() {
        let Ok(cfg) = std::env::var("MC_SKILLS_HELPER_CFG") else {
            return;
        };
        let role = std::env::var("MC_SKILLS_HELPER_ROLE").unwrap();
        let mode = std::env::var("MC_SKILLS_HELPER_MODE").unwrap();
        let cfg = PathBuf::from(cfg);
        let state = SkillStoreState::new(cfg.clone()).unwrap();
        if mode == "recovery-read" {
            let snapshot = state.snapshot(None).unwrap();
            fs::write(
                cfg.join(format!("{role}.revision")),
                snapshot.revision.to_string(),
            )
            .unwrap();
            return;
        }
        if mode == "recovery-cache" {
            assert!(matches!(
                state.snapshot(None),
                Err(SkillStoreError::RecoveryPending(_))
            ));
            fs::write(cfg.join(format!("{role}.blocked")), b"blocked").unwrap();
            wait_for(&cfg.join("resolver.resolved"));
            let snapshot = state.snapshot(None).unwrap();
            fs::write(
                cfg.join(format!("{role}.revision")),
                snapshot.revision.to_string(),
            )
            .unwrap();
            return;
        }
        if mode == "recovery-resolve" {
            let id = fs::read_to_string(cfg.join("recovery.tx-id")).unwrap();
            let issues = state.recovery_issues().unwrap();
            assert!(issues.iter().any(|issue| issue.transaction_id == id));
            state
                .resolve_recovery(&id, SkillRecoveryAction::PreserveFiles)
                .unwrap();
            fs::write(cfg.join(format!("{role}.resolved")), b"resolved").unwrap();
            return;
        }
        if mode == "legacy-baseline" {
            let skill = format!("after-{role}");
            state.save_skill(&skill, "after", None).unwrap();
            return;
        }
        if mode == "baseline-sidecar-race" {
            state
                .save_skill(
                    "after-migrator",
                    "---\nname: after-migrator\n---\nafter",
                    None,
                )
                .unwrap();
            return;
        }
        if mode == "all-entrypoints-stress" {
            for iteration in 0..4 {
                let skill = format!("stress-{role}-{iteration}");
                state.snapshot(None).unwrap();
                state
                    .save_skill(&skill, &format!("---\nname: {skill}\n---\nbody"), None)
                    .unwrap();
                state.set_default(&skill, iteration % 2 == 0, None).unwrap();
                state
                    .import(None, |user, _| {
                        let marker = user.join(format!("import-{role}-{iteration}"));
                        fs::write(&marker, b"import").map_err(|error| {
                            SkillStoreError::io("stress import", &marker, error)
                        })?;
                        sync_directory(user)
                    })
                    .unwrap();
                state
                    .recovery(|user, _| {
                        let marker = user.join(format!("recovery-{role}-{iteration}"));
                        fs::write(&marker, b"recovery").map_err(|error| {
                            SkillStoreError::io("stress recovery", &marker, error)
                        })?;
                        sync_directory(user)
                    })
                    .unwrap();
                let target = cfg.join(format!("materialized-{role}-{iteration}"));
                assert_eq!(
                    state
                        .materialize(&target, None, Some(std::slice::from_ref(&skill)))
                        .unwrap(),
                    vec![skill.clone()]
                );
                state.delete_skill(&skill, None).unwrap();
                state.snapshot(None).unwrap();
            }
            return;
        }
        if mode == "production" {
            let skill = format!("skill-{role}");
            let snapshot = state.snapshot(None).unwrap();
            fs::write(cfg.join(format!("{role}.store-id")), snapshot.store_id).unwrap();
            state
                .save_skill(&skill, &format!("---\nname: {skill}\n---\nbody"), None)
                .unwrap();
            state.set_default(&skill, false, None).unwrap();
            let target = cfg.join(format!("materialized-{role}"));
            assert_eq!(
                state
                    .materialize(&target, None, Some(std::slice::from_ref(&skill)))
                    .unwrap(),
                vec![skill.clone()]
            );
            state.delete_skill(&skill, None).unwrap();
            return;
        }

        state
            .write(|_, _| {
                let active = cfg.join("critical.active");
                if fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&active)
                    .is_err()
                {
                    fs::write(cfg.join("overlap"), b"overlap").unwrap();
                    return Err(SkillStoreError::RecoveryPending(vec![
                        revision_recovery_issue("临界区重叠".into()),
                    ]));
                }
                fs::write(cfg.join(format!("{role}.active")), b"active").unwrap();
                std::thread::sleep(std::time::Duration::from_millis(250));
                fs::remove_file(active).unwrap();
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn command_io_errors_for_all_skill_operations_redact_private_paths() {
        let cfg = PathBuf::from("/Users/review-user/Library/Application Support/MonkeyCode");
        for operation in [
            "读取技能列表",
            "保存技能",
            "删除技能",
            "写入技能默认集",
            "读取技能恢复列表",
            "处理技能恢复",
        ] {
            let private_path = cfg.join("skills/private/SKILL.md");
            let error = SkillStoreError::io(
                operation,
                &private_path,
                format!("permission denied while opening {}", private_path.display()),
            );
            let json = serde_json::to_string(&command_error(error, &cfg)).unwrap();
            assert!(json.contains(operation), "缺少 operation: {json}");
            assert!(json.contains("请重试"), "缺少可行动信息: {json}");
            assert!(
                !json.contains(cfg.to_string_lossy().as_ref()),
                "泄漏 config: {json}"
            );
            assert!(!json.contains("review-user"), "泄漏用户名: {json}");
            assert!(json.contains("<app-config>"), "缺少逻辑路径: {json}");
        }

        let issue = SkillRecoveryIssue {
            transaction_id: "tx-redact".into(),
            entry_path: Some(
                cfg.join("skills/.transactions/tx-redact")
                    .display()
                    .to_string(),
            ),
            skill_name: "demo".into(),
            portable_name_key: "demo".into(),
            backup_available: true,
            installed_available: false,
            isolated_available: false,
            authoritative_target_missing: true,
            actions: vec![SkillRecoveryAction::RestoreBackup],
            error: format!("恢复 {} 失败，可重试", cfg.join("skills/demo").display()),
        };
        let json = serde_json::to_string(&command_error(
            SkillStoreError::RecoveryPending(vec![issue]),
            &cfg,
        ))
        .unwrap();
        assert!(json.contains("recovery-pending"));
        assert!(json.contains("<app-config>"));
        assert!(!json.contains(cfg.to_string_lossy().as_ref()));
        assert!(!json.contains("review-user"));
    }

    #[test]
    fn command_filesystem_work_starts_inside_spawn_blocking() {
        let source = include_str!("skills.rs");
        for (start, end, filesystem_call) in [
            (
                "pub async fn skills_list",
                "pub async fn skills_set_default",
                "builtin_dir(&app)",
            ),
            (
                "pub async fn skills_set_default",
                "pub async fn skills_save",
                "store.set_default",
            ),
            (
                "pub async fn skills_save",
                "pub async fn skills_delete",
                "store.save_skill",
            ),
            (
                "pub async fn skills_delete",
                "#[cfg(test)]",
                "store.delete_skill",
            ),
        ] {
            let body = source
                .split(start)
                .nth(1)
                .unwrap()
                .split(end)
                .next()
                .unwrap();
            assert!(
                body.find("spawn_blocking").unwrap() < body.find(filesystem_call).unwrap(),
                "{filesystem_call} 必须位于 blocking 闭包内"
            );
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn spawn_blocking_boundary_keeps_runtime_responsive() {
        let started = std::time::Instant::now();
        let blocking = tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(std::time::Duration::from_millis(150));
        });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(started.elapsed() < std::time::Duration::from_millis(100));
        blocking.await.unwrap();
    }
}
