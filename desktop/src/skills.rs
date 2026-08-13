// 技能库(skills):壳侧对引擎 SKILL.md 技能的管理与物化。
//
// 引擎(ohmyagent)没有任何"启用/禁用技能"的协议入口——它只在
// session/create 时扫描固定目录(<cwd>/.ohmyagent/skills、
// $OHMYAGENT_CONFIG_DIR/skills、系统目录、二进制内置),每个技能是
// `<name>/SKILL.md`(frontmatter 只认 name/description/paths,description
// 必须单行)。因此壳的控制手段只有文件系统:
//
// - **技能库(权威)**:内置技能随包分发(bundle.resources "skills",
//   dev 回退仓库内 desktop/skills/),用户技能在 <app_config_dir>/skills/
//   (壳 UI 增删改,本模块的 skills_* 命令)。同名时用户技能覆盖内置。
// - **按会话物化(派生)**:driver 在每次引擎 session/create 之前,把该
//   会话启用的技能子集整体重写到 <engine_dir>/skills/(引擎的 user 级
//   来源;引擎目录在宿主侧,WSL 模式经 wslpath 注入,两种运行环境同路)。
//   引擎 catalog 是会话创建时的快照,所以"本会话启用哪些"就由创建前
//   目录里有什么决定;中途改选择 = destroy + resume 重建(session.rs)。
//
// 已知取舍:引擎技能目录是全局一份,多个会话并发且选择不同时,后创建的
// 会话会重写目录——先前会话的 catalog 不变(快照),但它启用而新会话未启用
// 的技能正文已被移走,届时 Skill 工具加载报错(引擎友好提示,不致崩)。
// 换按会话目录只有 cwd 一条路,会污染用户项目,不做。
//
// 技能内容不进 config.json 事务:与 telemetry.json 同理,库本身就是
// 一目录一文件的权威,坏一个技能只影响它自己。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

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
        .map(|s| {
            let mut info = s.info;
            info.default_enabled = is_default_enabled(&info.name, &info.source, &prefs);
            info
        })
        .collect()
}

// ==================== 按会话物化 ====================

/// 把启用子集整体重写到 <engine_dir>/skills/(引擎 user 级来源)。
/// enabled=None 表示"缺省集"(新会话初始;旧 sidecar 无 skills 字段):
/// 出厂规则 ⊕ defaults 文件的显式开关(is_default_enabled)。返回实际物化
/// 的技能名(sidecar 落这份快照)。目标目录是纯派生物,整删整建;技能名
/// 经 valid_skill_name 才可能进库,拼路径安全。
pub fn materialize(
    engine_dir: &Path,
    builtin: Option<&Path>,
    user: &Path,
    defaults: &Path,
    enabled: Option<&[String]>,
) -> Result<Vec<String>, String> {
    let target = engine_dir.join("skills");
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| format!("清理引擎技能目录失败: {e}"))?;
    }
    fs::create_dir_all(&target).map_err(|e| format!("创建引擎技能目录失败: {e}"))?;
    let prefs = load_default_prefs(defaults);
    let mut done = Vec::new();
    for s in scan_store(builtin, user) {
        let on = match enabled {
            Some(names) => names.contains(&s.info.name),
            None => is_default_enabled(&s.info.name, &s.info.source, &prefs),
        };
        if !on {
            continue;
        }
        copy_dir(&s.dir, &target.join(&s.info.name))
            .map_err(|e| format!("物化技能 {} 失败: {e}", s.info.name))?;
        done.push(s.info.name);
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
    fn materialize_writes_enabled_subset_and_wipes_stale() {
        let builtin = test_dir("mat-builtin");
        let user = test_dir("mat-user");
        let engine = test_dir("mat-engine");
        put_skill(&builtin, "a", "A");
        put_skill(&user, "b", "B");
        // 辅助资源一并拷贝
        fs::create_dir_all(user.join("b/references")).unwrap();
        fs::write(user.join("b/references/x.md"), "ref").unwrap();

        let nodefaults = user.join("no-defaults.json");
        let both =
            materialize(&engine, Some(&builtin), &user, &nodefaults, Some(&["a".into(), "b".into()]))
                .unwrap();
        assert_eq!(both, vec!["a", "b"]);
        assert!(engine.join("skills/b/references/x.md").is_file());

        let only_b =
            materialize(&engine, Some(&builtin), &user, &nodefaults, Some(&["b".into()])).unwrap();
        assert_eq!(only_b, vec!["b"]);
        assert!(!engine.join("skills/a").exists(), "未启用的技能必须被清走");
        // 启用名单里有已删除的技能名:跳过不报错(会话 sidecar 可能引用旧名)
        let gone = materialize(
            &engine,
            Some(&builtin),
            &user,
            &nodefaults,
            Some(&["b".into(), "zz".into()]),
        )
        .unwrap();
        assert_eq!(gone, vec!["b"]);
    }

    #[test]
    fn default_set_is_factory_rule_overridden_by_prefs() {
        let builtin = test_dir("def-builtin");
        let user = test_dir("def-user");
        let engine = test_dir("def-engine");
        put_skill(&builtin, "feature-design", "官方默认项");
        put_skill(&builtin, "tailwindcss-helper", "官方非默认项");
        put_skill(&user, "my-skill", "用户技能出厂默认启用");

        // 无开关文件:纯出厂规则
        let def =
            materialize(&engine, Some(&builtin), &user, &user.join("no-defaults.json"), None)
                .unwrap();
        assert_eq!(def, vec!["feature-design", "my-skill"]);
        assert!(!engine.join("skills/tailwindcss-helper").exists());

        // 显式开关压过出厂:关掉官方默认项、打开非默认项与用户技能关闭
        let prefs_path = test_dir("def-prefs").join("skills-defaults.json");
        fs::write(
            &prefs_path,
            r#"{"feature-design": false, "tailwindcss-helper": true, "my-skill": false}"#,
        )
        .unwrap();
        let def = materialize(&engine, Some(&builtin), &user, &prefs_path, None).unwrap();
        assert_eq!(def, vec!["tailwindcss-helper"]);
        // list() 的 default_enabled 与物化同一解析
        let infos = list(Some(&builtin), &user, &prefs_path);
        let on: Vec<&str> =
            infos.iter().filter(|s| s.default_enabled).map(|s| s.name.as_str()).collect();
        assert_eq!(on, vec!["tailwindcss-helper"]);
    }

    #[test]
    fn frontmatter_name_mismatch_is_detected() {
        let (name, _) = parse_frontmatter("---\nname: other\n---\n正文");
        assert_eq!(name.as_deref(), Some("other"));
        let (none, _) = parse_frontmatter("# 无 frontmatter");
        assert!(none.is_none());
    }
}
