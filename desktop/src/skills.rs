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

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 内置技能的**出厂**缺省启用集:云端建任务的 MC_DEFAULT_SKILL_IDS 四件套
/// (baizhi/monkeycode.rs)+ 桌面端补充的发布与设计流入口。设计流内部 Skill
/// 由 workflow.json 依赖闭包自动物化，不作为用户可选项。
/// 官方库全默认启用会把 system prompt 塞满几十条 name+description,故其余
/// 按需勾选。用户自建技能不受此表限制,出厂恒默认启用——亲手写的技能就是
/// 要用的。出厂规则之上是用户显式开关(skills-defaults.json,见
/// load_default_prefs):没拨过的技能跟随出厂,拨过的以开关为准。解析结果经
/// skills_list 的 default_enabled 字段下发,UI 不再自持一份规则镜像。
pub const DEFAULT_ENABLED: [&str; 6] = [
    "feature-design",
    "project-wiki",
    "feature-implementer",
    "implementation-planner",
    "publish-website",
    "design-flow",
];

/// 默认启用开关的持久化(<app_config_dir>/skills-defaults.json,
/// `{技能名: bool}` 只存显式拨过的)。刻意不进 config.json 事务:与技能库
/// 同域同理(ARCHITECTURE 契约 4),坏了只影响默认集,回退出厂规则。
pub fn defaults_path(cfg_dir: &Path) -> PathBuf {
    cfg_dir.join("skills-defaults.json")
}

pub fn load_default_prefs(path: &Path) -> std::collections::BTreeMap<String, bool> {
    fs::read(path).ok().and_then(|d| serde_json::from_slice(&d).ok()).unwrap_or_default()
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

/// 技能名即目录名,会拼进壳与引擎两侧的文件系统路径,校验口径与
/// session id 同类:单段安全名,另限 ASCII(斜杠指令 /name 的可输入性)。
pub fn valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

#[derive(Serialize, Clone)]
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
    if let Ok(p) = app.path().resolve("skills", tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../plugins/skills"));
    candidates.into_iter().find(|p| p.is_dir())
}

/// 用户技能目录(权威,壳 UI 直接读写)。
pub fn user_dir(cfg_dir: &Path) -> PathBuf {
    cfg_dir.join("skills")
}

// ==================== SKILL.md 解析(引擎子集的镜像) ====================

/// frontmatter 的 name/description(引擎 parseFrontmatter 只认单行值;
/// 这里只取列表展示与名字一致性校验要用的两个键)。
fn parse_frontmatter(text: &str) -> (Option<String>, Option<String>) {
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
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
        match key.trim() {
            "name" => name = Some(value),
            "description" => description = Some(value),
            _ => {}
        }
    }
    (name, description)
}

fn frontmatter_value(text: &str, wanted: &str) -> Option<String> {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return None;
    }
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        if key.trim() == wanted {
            return Some(value.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

/// 展示描述:frontmatter description,缺省取正文首个非空行去掉 '#'
/// (与引擎的缺省口径一致,两侧列表说同一句话)。
fn derive_description(text: &str) -> String {
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
    let Some(rest) = text.strip_prefix("---") else { return text };
    match rest.split_once("\n---") {
        Some((_, body)) => body.split_once('\n').map(|(_, b)| b).unwrap_or(""),
        None => text,
    }
}

// ==================== 技能库扫描 ====================

struct StoreSkill {
    info: SkillInfo,
    dir: PathBuf,
    internal: bool,
    owner: Option<String>,
}

/// 扫一个来源目录:<dir>/<name>/SKILL.md。坏条目(读不了/名字非法)跳过
/// 不拖垮整库——列表少一条比整页报错可诊断(目录名非法只可能是手工放入)。
fn scan_source(dir: &Path, source: &str, out: &mut Vec<StoreSkill>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if !valid_skill_name(&name) {
            continue;
        }
        let Ok(content) = fs::read_to_string(path.join("SKILL.md")) else { continue };
        out.push(StoreSkill {
            internal: frontmatter_value(&content, "visibility").as_deref() == Some("internal"),
            owner: frontmatter_value(&content, "owner"),
            info: SkillInfo {
                description: derive_description(&content),
                name,
                source: source.into(),
                content,
                overrides: false,
                default_enabled: false, // 占位,list()/materialize() 按 prefs 解析
            },
            dir: path,
        });
    }
}

/// 技能库全量:用户技能在前且同名覆盖内置(引擎去重也是先到先得,
/// 物化顺序与此一致,两侧"谁生效"口径相同)。按名排序稳定输出。
fn scan_store(builtin: Option<&Path>, user: &Path) -> Vec<StoreSkill> {
    let mut all = Vec::new();
    scan_source(user, "user", &mut all);
    if let Some(b) = builtin {
        scan_source(b, "builtin", &mut all);
    }
    let builtin_names: std::collections::HashSet<String> = all
        .iter()
        .filter(|s| s.info.source == "builtin")
        .map(|s| s.info.name.clone())
        .collect();
    let internal_builtin_names: std::collections::HashSet<String> = all
        .iter()
        .filter(|s| s.info.source == "builtin" && s.internal)
        .map(|s| s.info.name.clone())
        .collect();
    all.retain(|s| s.info.source != "user" || !internal_builtin_names.contains(&s.info.name));
    for s in &mut all {
        s.info.overrides = s.info.source == "user" && builtin_names.contains(&s.info.name);
    }
    let mut seen = std::collections::HashSet::new();
    all.retain(|s| seen.insert(s.info.name.clone()));
    all.sort_by(|a, b| a.info.name.cmp(&b.info.name));
    all
}

pub fn list(builtin: Option<&Path>, user: &Path, defaults: &Path) -> Vec<SkillInfo> {
    let prefs = load_default_prefs(defaults);
    scan_store(builtin, user)
        .into_iter()
        .filter(|s| !s.internal)
        .map(|s| {
            let mut info = s.info;
            info.default_enabled = is_default_enabled(&info.name, &info.source, &prefs);
            info
        })
        .collect()
}

// ==================== 按会话物化 ====================

fn workflow_dependencies(dir: &Path) -> Vec<String> {
    let Ok(data) = fs::read(dir.join("workflow.json")) else { return Vec::new() };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&data) else { return Vec::new() };
    let mut dependencies = std::collections::BTreeSet::new();
    for route in value.get("routes").and_then(|v| v.as_array()).into_iter().flatten() {
        for skill in route.get("skills").and_then(|v| v.as_array()).into_iter().flatten() {
            if let Some(name) = skill.as_str() {
                dependencies.insert(name.to_string());
            }
        }
        for step in route.get("steps").and_then(|v| v.as_array()).into_iter().flatten() {
            for skill in step.get("skills").and_then(|v| v.as_array()).into_iter().flatten() {
                if let Some(name) = skill.as_str() {
                    dependencies.insert(name.to_string());
                }
            }
        }
    }
    dependencies.into_iter().collect()
}

/// 把启用子集整体重写到 Agent 的 session skills 目录。
/// enabled=None 表示"缺省集"(新会话初始;旧 sidecar 无 skills 字段):
/// 出厂规则 ⊕ defaults 文件的显式开关(is_default_enabled)。返回公开入口的
/// 启用快照；workflow 内部依赖只写入目标目录，不进入 sidecar。目标目录是
/// 纯派生物,整删整建;技能名
/// 经 valid_skill_name 才可能进库,拼路径安全。
pub fn materialize(
    target: &Path,
    builtin: Option<&Path>,
    user: &Path,
    defaults: &Path,
    enabled: Option<&[String]>,
) -> Result<Vec<String>, String> {
    if target.exists() {
        fs::remove_dir_all(target).map_err(|e| format!("清理会话技能目录失败: {e}"))?;
    }
    fs::create_dir_all(target).map_err(|e| format!("创建会话技能目录失败: {e}"))?;
    let prefs = load_default_prefs(defaults);
    let store = scan_store(builtin, user);
    let roots: std::collections::BTreeSet<String> = store
        .iter()
        .filter(|s| !s.internal)
        .filter(|s| match enabled {
            Some(names) => names.contains(&s.info.name),
            None => is_default_enabled(&s.info.name, &s.info.source, &prefs),
        })
        .map(|s| s.info.name.clone())
        .collect();
    let mut dependencies = std::collections::BTreeSet::new();
    for root in store.iter().filter(|s| roots.contains(&s.info.name)) {
        dependencies.extend(workflow_dependencies(&root.dir));
    }
    let mut done = Vec::new();
    for s in store {
        let on = roots.contains(&s.info.name)
            || (dependencies.contains(&s.info.name)
                && (!s.internal || s.owner.as_deref().map_or(true, |owner| roots.contains(owner))));
        if !on {
            continue;
        }
        copy_dir(&s.dir, &target.join(&s.info.name))
            .map_err(|e| format!("物化技能 {} 失败: {e}", s.info.name))?;
        if roots.contains(&s.info.name) {
            done.push(s.info.name);
        }
    }
    Ok(done)
}

/// 递归拷贝技能目录(SKILL.md + references/ 等辅助资源)。跳过符号链接:
/// 库目录用户可手工触碰,链接指向库外时整删整建的目标目录不该放大删除面。
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)?.flatten() {
        let ty = e.file_type()?;
        let dst = to.join(e.file_name());
        if ty.is_dir() {
            copy_dir(&e.path(), &dst)?;
        } else if ty.is_file() {
            fs::copy(e.path(), &dst)?;
        }
    }
    Ok(())
}

// ==================== Tauri 命令 ====================

/// 技能库全量(内置 + 用户,同名用户覆盖)。会话级"启用哪些"见
/// session_call 的 session_set_skills(driver/session.rs)。
#[tauri::command]
pub fn skills_list(app: AppHandle) -> Result<Vec<SkillInfo>, String> {
    let cfg_dir = crate::config::config_dir(&app)?;
    Ok(list(builtin_dir(&app).as_deref(), &user_dir(&cfg_dir), &defaults_path(&cfg_dir)))
}

/// 默认启用开关:只影响**新会话**(与旧 sidecar 无 skills 字段的会话)的
/// 缺省集,已有会话跟随各自快照。写显式值而不是"翻转出厂规则":出厂表
/// 将来变了,用户拨过的开关语义不漂移。
#[tauri::command]
pub fn skills_set_default(app: AppHandle, name: String, enabled: bool) -> Result<(), String> {
    if !valid_skill_name(&name) {
        return Err(format!("非法技能名: {name}"));
    }
    let path = defaults_path(&crate::config::config_dir(&app)?);
    let mut prefs = load_default_prefs(&path);
    prefs.insert(name, enabled);
    let data = serde_json::to_vec_pretty(&prefs).map_err(|e| format!("序列化失败: {e}"))?;
    crate::config::atomic_write_private(&path, &data)
}

/// 新建/覆盖用户技能:写 <app_config_dir>/skills/<name>/SKILL.md。
/// frontmatter 里写了不同 name 会让引擎按 frontmatter 定名,与壳的
/// 目录名寻址(启用勾选、/name 斜杠)错位——前置拒绝,不留两套名字。
#[tauri::command]
pub fn skills_save(app: AppHandle, name: String, content: String) -> Result<SkillInfo, String> {
    if !valid_skill_name(&name) {
        return Err("技能名只能用字母、数字、-、_、.(不以 . 开头,至多 64 字符)".into());
    }
    if content.trim().is_empty() {
        return Err("技能内容不能为空".into());
    }
    if let (Some(fm_name), _) = parse_frontmatter(&content) {
        if !fm_name.is_empty() && fm_name != name {
            return Err(format!("frontmatter 的 name({fm_name})与技能名({name})不一致"));
        }
    }
    let cfg_dir = crate::config::config_dir(&app)?;
    let dir = user_dir(&cfg_dir).join(&name);
    fs::create_dir_all(&dir).map_err(|e| format!("创建技能目录失败: {e}"))?;
    crate::config::atomic_write_private(&dir.join("SKILL.md"), content.as_bytes())?;
    let overrides = builtin_dir(&app)
        .map(|b| b.join(&name).join("SKILL.md").is_file())
        .unwrap_or(false);
    let prefs = load_default_prefs(&defaults_path(&cfg_dir));
    Ok(SkillInfo {
        description: derive_description(&content),
        default_enabled: is_default_enabled(&name, "user", &prefs),
        name,
        source: "user".into(),
        content,
        overrides,
    })
}

/// 删除用户技能(内置技能只读——同名建用户技能即覆盖,删掉即还原)。
/// 已启用它的会话不受影响:物化按名取,取不到就跳过。
#[tauri::command]
pub fn skills_delete(app: AppHandle, name: String) -> Result<(), String> {
    if !valid_skill_name(&name) {
        return Err(format!("非法技能名: {name}"));
    }
    let cfg_dir = crate::config::config_dir(&app)?;
    let dir = user_dir(&cfg_dir).join(&name);
    if !dir.join("SKILL.md").is_file() {
        return Err(format!("用户技能不存在: {name}"));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除技能失败: {e}"))?;
    // 顺手清默认开关残留;同名副本删除后还原出的内置技能不该背着副本的
    // 开关值。清理失败不上抛——技能已删成功,残留项只是无主键值
    let path = defaults_path(&cfg_dir);
    let mut prefs = load_default_prefs(&path);
    if prefs.remove(&name).is_some() {
        if let Ok(data) = serde_json::to_vec_pretty(&prefs) {
            let _ = crate::config::atomic_write_private(&path, &data);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn skill_name_validation_rejects_path_escapes() {
        assert!(valid_skill_name("git-commit"));
        assert!(valid_skill_name("a.b_c1"));
        for bad in ["", ".hidden", "a/b", "a\\b", "..", "名字", &"x".repeat(65)] {
            assert!(!valid_skill_name(bad), "{bad:?} 应当被拒绝");
        }
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
        let all = list(Some(&builtin), &user, &user.join("no-defaults.json"));
        assert_eq!(
            all.iter().map(|s| (s.name.as_str(), s.source.as_str())).collect::<Vec<_>>(),
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
        // references/ 的多层辅助资源一并递归拷贝
        fs::create_dir_all(user.join("b/references/components")).unwrap();
        fs::write(user.join("b/references/components/x.md"), "nested ref").unwrap();

        let nodefaults = user.join("no-defaults.json");
        let both =
            materialize(&first, Some(&builtin), &user, &nodefaults, Some(&["a".into(), "b".into()]))
                .unwrap();
        assert_eq!(both, vec!["a", "b"]);
        assert_eq!(
            fs::read_to_string(first.join("b/references/components/x.md")).unwrap(),
            "nested ref"
        );

        let only_b =
            materialize(&second, Some(&builtin), &user, &nodefaults, Some(&["b".into()])).unwrap();
        assert_eq!(only_b, vec!["b"]);
        assert!(first.join("a").exists(), "更新另一会话不得改写已有会话");
        assert!(!second.join("a").exists(), "未启用的技能不得写入当前会话");
        // 启用名单里有已删除的技能名:跳过不报错(会话 sidecar 可能引用旧名)
        let gone = materialize(
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
    fn design_skills_are_factory_enabled_and_user_prefs_override_them() {
        const INTERNAL_SKILLS: [&str; 10] = [
            "design-generation",
            "design-refinement",
            "frontend-design",
            "web-design-art-direction",
            "image-generation",
            "image-refinement",
            "visual-design-foundations",
            "web-component-design",
            "react-native-design",
            "headless-design-jury",
        ];
        assert!(DEFAULT_ENABLED.contains(&"design-flow"));
        assert!(INTERNAL_SKILLS.iter().all(|name| !DEFAULT_ENABLED.contains(name)));

        let builtin = test_dir("def-builtin");
        let user = test_dir("def-user");
        let target = test_dir("def-target");
        put_skill(&builtin, "design-flow", "---\nname: design-flow\n---\n入口");
        for name in INTERNAL_SKILLS {
            put_skill(&builtin, name, &format!("---\nname: {name}\nvisibility: internal\nowner: design-flow\n---\n内部"));
        }
        let steps: Vec<_> = INTERNAL_SKILLS.iter().map(|name| serde_json::json!({"skills": [name]})).collect();
        fs::write(
            builtin.join("design-flow/workflow.json"),
            serde_json::to_vec(&serde_json::json!({"routes": [{"steps": steps}]})).unwrap(),
        ).unwrap();
        put_skill(&builtin, "tailwindcss-helper", "官方非默认项");
        put_skill(&user, "my-skill", "用户技能出厂默认启用");

        // 用户只选择公开入口，内部依赖仍自动物化，但不进入返回的显式启用集。
        let def =
            materialize(&target, Some(&builtin), &user, &user.join("no-defaults.json"), None)
                .unwrap();
        assert!(def.iter().any(|enabled| enabled == "design-flow"));
        for name in INTERNAL_SKILLS {
            assert!(!def.iter().any(|enabled| enabled == name));
            assert!(target.join(name).join("SKILL.md").is_file());
        }
        assert!(def.iter().any(|enabled| enabled == "my-skill"));
        assert!(!target.join("tailwindcss-helper").exists());

        let infos = list(Some(&builtin), &user, &user.join("no-defaults.json"));
        assert!(infos.iter().any(|skill| skill.name == "design-flow"));
        assert!(INTERNAL_SKILLS.iter().all(|name| !infos.iter().any(|skill| skill.name == *name)));

        // 关闭入口后不再物化它的内部依赖。
        let prefs_path = test_dir("def-prefs").join("skills-defaults.json");
        fs::write(
            &prefs_path,
            r#"{"design-flow": false, "tailwindcss-helper": true, "my-skill": false}"#,
        )
        .unwrap();
        let def = materialize(&target, Some(&builtin), &user, &prefs_path, None).unwrap();
        assert!(!def.iter().any(|enabled| enabled == "design-flow"));
        assert!(def.iter().any(|enabled| enabled == "tailwindcss-helper"));
        assert!(!def.iter().any(|enabled| enabled == "my-skill"));
        assert!(!target.join("design-flow").exists());
        assert!(INTERNAL_SKILLS.iter().all(|name| !target.join(name).exists()));
        // list() 的 default_enabled 与物化同一解析
        let infos = list(Some(&builtin), &user, &prefs_path);
        let enabled = |name: &str| {
            infos
                .iter()
                .find(|skill| skill.name == name)
                .map(|skill| skill.default_enabled)
        };
        assert_eq!(enabled("design-flow"), Some(false));
        assert_eq!(enabled("design-generation"), None);
        assert_eq!(enabled("tailwindcss-helper"), Some(true));
        assert_eq!(enabled("my-skill"), Some(false));
    }

    #[test]
    fn frontmatter_name_mismatch_is_detected() {
        let (name, _) = parse_frontmatter("---\nname: other\n---\n正文");
        assert_eq!(name.as_deref(), Some("other"));
        let (none, _) = parse_frontmatter("# 无 frontmatter");
        assert!(none.is_none());
    }
}
