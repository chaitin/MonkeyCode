//! 技能安装：校验 → 临时目录完整拷贝 → 旧目录挪 trash → rename 就位。
//!
//! 事务日志/隔离区/多阶段恢复机已废弃：安装对象是用户可重新导入的数据，
//! 中途失败最多留下 dot 前缀的临时 sibling，下次安装前会被清扫；不存在
//! 需要人工裁决的恢复状态。历史版本留下的 `.skill-imports`/`.skill-backups`
//! /`.skill-transactions` 残留目录同样在盘点时 best-effort 清理。

use std::fs;
use std::path::{Path, PathBuf};

use crate::skill_import::store::{
    FixedStagedSkillRoot, SkillStoreError, TargetBaseline, TargetPresence,
};

#[derive(Debug)]
pub(crate) struct SkillInstallRequest {
    pub item_id: String,
    pub skill_name: String,
    pub source: FixedStagedSkillRoot,
    pub baseline: TargetBaseline,
    pub replace: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SkillInstallOutcome {
    pub item_id: String,
    pub skill_name: String,
    pub error: Option<String>,
}

impl SkillInstallOutcome {
    #[cfg(test)]
    pub(crate) fn succeeded(&self) -> bool {
        self.error.is_none()
    }
}

/// 空盘点：没有事务日志就没有可恢复状态。保留类型只为 `skills.rs` 的
/// 恢复 IPC 外形。
#[derive(Clone, Debug, Default)]
pub(crate) struct RecoveryInventory {}

/// 盘点即清扫：删除历史版本事务机留下的残留目录与本模块的临时 sibling。
/// 全部 best-effort——清不掉不阻塞任何读写，下次再试。
pub(crate) fn discover_locked(user_dir: &Path) -> Result<RecoveryInventory, SkillStoreError> {
    for legacy in [".skill-imports", ".skill-backups", ".skill-transactions"] {
        let path = user_dir.join(legacy);
        if fs::symlink_metadata(&path).is_ok() {
            let _ = remove_tree(&path);
        }
    }
    if let Ok(entries) = fs::read_dir(user_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(".import-") || name.starts_with(".trash-") {
                let _ = remove_tree(&entry.path());
            }
        }
    }
    Ok(RecoveryInventory::default())
}

pub(crate) fn install_many_locked(
    user_dir: &Path,
    requests: &[SkillInstallRequest],
) -> Vec<SkillInstallOutcome> {
    let _ = discover_locked(user_dir);
    requests
        .iter()
        .map(|request| SkillInstallOutcome {
            item_id: request.item_id.clone(),
            skill_name: request.skill_name.clone(),
            error: install_one(user_dir, request).err(),
        })
        .collect()
}

fn install_one(user_dir: &Path, request: &SkillInstallRequest) -> Result<(), String> {
    if crate::skills::portable_skill_name_key(&request.skill_name).is_none() {
        return Err(format!("不安全的技能名: {}", request.skill_name));
    }
    if request.baseline.target_name != request.skill_name
        || request.baseline.presence
            != if request.replace {
                TargetPresence::Present
            } else {
                TargetPresence::Absent
            }
    {
        return Err("技能目标状态与所选动作不一致，请重新导入".into());
    }
    let target = user_dir.join(&request.skill_name);
    let target_state = fs::symlink_metadata(&target);
    let target_exists = target_state.is_ok();
    if let Ok(metadata) = &target_state {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!("安装目标不是普通目录: {}", request.skill_name));
        }
    }
    if request.replace != target_exists {
        return Err("技能目标状态与所选动作不一致，请重新导入".into());
    }

    let temporary = unique_sibling(user_dir, ".import-")?;
    // copy_to 内部在复制前后比对暂存快照，暂存内容被篡改时局部失败。
    if let Err(error) = request.source.copy_to(&temporary) {
        let _ = remove_tree(&temporary);
        return Err(error.to_string());
    }
    let skill_md = temporary.join("SKILL.md");
    match fs::symlink_metadata(&skill_md) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {}
        _ => {
            let _ = remove_tree(&temporary);
            return Err(format!("技能缺少 SKILL.md: {}", request.skill_name));
        }
    }

    let trash = unique_sibling(user_dir, ".trash-")?;
    if target_exists {
        if let Err(error) = rename_retrying(&target, &trash) {
            let _ = remove_tree(&temporary);
            return Err(format!("移开原有技能目录失败: {error}"));
        }
    }
    if let Err(error) = rename_retrying(&temporary, &target) {
        if target_exists {
            let _ = rename_retrying(&trash, &target);
        }
        let _ = remove_tree(&temporary);
        return Err(format!("安装技能目录失败: {error}"));
    }
    let _ = remove_tree(&trash);
    Ok(())
}

fn unique_sibling(user_dir: &Path, prefix: &str) -> Result<PathBuf, String> {
    for _ in 0..16 {
        let mut random = [0u8; 12];
        getrandom::getrandom(&mut random).map_err(|e| format!("生成临时目录标识失败: {e}"))?;
        let suffix = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let candidate = user_dir.join(format!("{prefix}{suffix}"));
        if fs::symlink_metadata(&candidate).is_err() {
            return Ok(candidate);
        }
    }
    Err("生成临时目录连续冲突".into())
}

/// 跨平台 rename；Windows 上对实时防护/索引器的短暂句柄占用退避重试。
fn rename_retrying(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        crate::config::retry_transient_windows_rename(|| fs::rename(from, to))
    }
    #[cfg(not(windows))]
    {
        fs::rename(from, to)
    }
}

fn remove_tree(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            #[cfg(windows)]
            {
                crate::config::retry_transient_windows_remove(|| fs::remove_dir_all(path))
            }
            #[cfg(not(windows))]
            {
                fs::remove_dir_all(path)
            }
        }
        Ok(_) => fs::remove_file(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skill_import::store::{BaselineStore, FixedTreeSnapshot, StoreRevision};

    fn test_root(label: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "mc-tx-{label}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn stage_skill(root: &Path, name: &str, content: &str) -> (PathBuf, FixedTreeSnapshot) {
        let staged = root.join(name);
        fs::create_dir_all(&staged).unwrap();
        fs::write(staged.join("SKILL.md"), content).unwrap();
        let snapshot = FixedStagedSkillRoot::capture(&staged).unwrap();
        (staged, snapshot)
    }

    fn request_for(
        user_dir: &Path,
        staged: &Path,
        snapshot: &FixedTreeSnapshot,
        name: &str,
        replace: bool,
    ) -> SkillInstallRequest {
        let source = FixedStagedSkillRoot::open_expected(staged, snapshot).unwrap();
        let store = BaselineStore::open_locked(user_dir).unwrap();
        let revision = StoreRevision {
            store_id: "test".into(),
            revision: 0,
        };
        let baseline = store.capture_locked(&revision, name).unwrap();
        SkillInstallRequest {
            item_id: format!("item-{name}"),
            skill_name: name.into(),
            source,
            baseline,
            replace,
        }
    }

    #[test]
    fn install_copies_skill_and_replace_swaps_content() {
        let staging = test_root("stage");
        let user_dir = test_root("user");
        let (staged, snapshot) = stage_skill(&staging, "alpha", "v1");

        let request = request_for(&user_dir, &staged, &snapshot, "alpha", false);
        let outcomes = install_many_locked(&user_dir, &[request]);
        assert!(outcomes[0].succeeded(), "{:?}", outcomes[0].error);
        assert_eq!(
            fs::read_to_string(user_dir.join("alpha/SKILL.md")).unwrap(),
            "v1"
        );

        // 替换:内容换新,失败留旧的语义由 trash+rename 保证。
        let (staged2, snapshot2) = stage_skill(&test_root("stage2"), "alpha", "v2");
        let request = request_for(&user_dir, &staged2, &snapshot2, "alpha", true);
        let outcomes = install_many_locked(&user_dir, &[request]);
        assert!(outcomes[0].succeeded(), "{:?}", outcomes[0].error);
        assert_eq!(
            fs::read_to_string(user_dir.join("alpha/SKILL.md")).unwrap(),
            "v2"
        );
        // 无残留 sibling
        let leftovers: Vec<_> = fs::read_dir(&user_dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name != "alpha")
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn install_rejects_action_state_mismatch_and_staged_tampering() {
        let staging = test_root("stage-conflict");
        let user_dir = test_root("user-conflict");
        let (staged, snapshot) = stage_skill(&staging, "beta", "v1");

        // replace=true 但目标不存在:baseline 已经对不上
        let source = FixedStagedSkillRoot::open_expected(&staged, &snapshot).unwrap();
        let store = BaselineStore::open_locked(&user_dir).unwrap();
        let revision = StoreRevision {
            store_id: "test".into(),
            revision: 0,
        };
        let baseline = store.capture_locked(&revision, "beta").unwrap();
        let mismatch = SkillInstallRequest {
            item_id: "item-beta".into(),
            skill_name: "beta".into(),
            source,
            baseline,
            replace: true,
        };
        let outcomes = install_many_locked(&user_dir, &[mismatch]);
        assert!(outcomes[0].error.is_some());
        assert!(!user_dir.join("beta").exists());

        // 暂存内容在 open_expected 之后被篡改:copy_to 的快照复核局部失败
        let request = request_for(&user_dir, &staged, &snapshot, "beta", false);
        fs::write(staged.join("SKILL.md"), "tampered").unwrap();
        let outcomes = install_many_locked(&user_dir, &[request]);
        assert!(outcomes[0].error.is_some());
        assert!(!user_dir.join("beta").exists());
    }

    #[test]
    fn discover_sweeps_legacy_transaction_residue() {
        let user_dir = test_root("legacy-residue");
        for legacy in [".skill-imports", ".skill-backups", ".skill-transactions"] {
            fs::create_dir_all(user_dir.join(legacy).join("t1")).unwrap();
        }
        fs::create_dir_all(user_dir.join(".import-deadbeef")).unwrap();
        fs::create_dir_all(user_dir.join(".trash-deadbeef")).unwrap();
        fs::create_dir_all(user_dir.join("keep-skill")).unwrap();
        discover_locked(&user_dir).unwrap();
        let names: Vec<_> = fs::read_dir(&user_dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["keep-skill"]);
    }
}
