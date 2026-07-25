// 应用配置(壳持有)与内核清单文件写出。
//
// DesktopConfig 是应用权威配置；引擎 settings.json/mcp.json 只是可重建的
// 派生物。所有权威配置读改写经 ConfigStore 串行，并使用同目录临时文件
// 原子替换；损坏的主文件只允许从有效备份恢复，绝不能静默退成默认配置后
// 覆盖用户的模型/API Key。pet_* 是壳自有偏好，设置页保存时从磁盘合并。

use std::ffi::OsString;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use crate::util::LockExt;

static TEMP_FILE_SEQ: AtomicU64 = AtomicU64::new(0);
const DEFAULT_MODEL_CONTEXT_WINDOW: i64 = 200_000;

/// 权威配置的进程内事务锁。引擎重启有自己更粗的 EngineApply 锁；这里的锁
/// 只覆盖短暂的磁盘事务，桌宠偏好保存不会因 Agent 优雅退出而卡住 UI 线程。
pub struct ConfigStore(Mutex<()>);

impl ConfigStore {
    pub fn new() -> Self {
        Self(Mutex::new(()))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ()> {
        // 某次写盘 panic 不应让此后所有配置操作永久不可用；磁盘内容本身由
        // 原子替换保护，恢复 poisoned guard 后仍可安全继续。
        self.0.lock_ok()
    }
}

fn json_array() -> serde_json::Value {
    serde_json::Value::Array(vec![])
}
fn json_object() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

fn default_true() -> bool {
    true
}

fn default_engine() -> String {
    String::new() // 字段已废弃,仅兼容旧 config.json 反序列化
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DesktopConfig {
    #[serde(default = "json_array")]
    pub models: serde_json::Value,
    /// MCP 服务器(name → 配置,与内核 mcp.json 的 mcpServers 同构)
    #[serde(default = "json_object")]
    pub mcp_servers: serde_json::Value,
    /// 内核运行环境:空 = 本机;"wsl:<发行版>" = 在 WSL 中运行(仅 Windows)。
    #[serde(default)]
    pub kernel_env: String,
    /// 已废弃(单引擎化后忽略):历史 config.json 兼容保留,不再消费。
    #[serde(default = "default_engine")]
    pub agent_engine: String,
    /// 桌宠开关(托盘菜单切换)
    #[serde(default = "default_true")]
    pub pet_enabled: bool,
    /// 桌宠窗口位置(物理像素;拖动后记忆)
    #[serde(default)]
    pub pet_pos: Option<(i32, i32)>,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            models: json_array(),
            mcp_servers: json_object(),
            kernel_env: String::new(),
            agent_engine: default_engine(),
            pet_enabled: true,
            pet_pos: None,
        }
    }
}

pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {e}"))
}

/// 应用私有的本地数据目录。与 config_dir 分开：设置适合漫游/备份，
/// 对话工作区及附件体积可能较大，应留在当前设备。
pub fn local_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))
}

/// 用户主目录。语义严格对齐引擎(Go)的 os.UserHomeDir——壳在这里算出的
/// ~ 展开结果会作为 cwd 交给引擎,两侧对"家在哪"的认定必须一致:
/// - Windows:USERPROFILE 优先(Go 在 Windows 上只认 USERPROFILE,忽略 HOME)。
///   HOME 常被 Git-Bash/MSYS/WSL interop 注入且指向类 Unix 目录;若让它胜出,
///   默认工作区 ~/MonkeyCode 会落到 MSYS 家目录而非 C:\Users\<用户>,且与引擎
///   对 ~ 的解析错位——本机模式下正是"agent 写文件的目录不对"的一种成因。
/// - Unix:HOME 优先(USERPROFILE 在 Unix 上不存在,回退项仅作防御)。
///
/// 所有 ~ 展开与 ~/.xxx 定位统一走这里。
pub fn home_dir() -> Option<PathBuf> {
    pick_home(
        std::env::var_os("HOME"),
        std::env::var_os("USERPROFILE"),
        cfg!(windows),
    )
    .map(PathBuf::from)
}

/// home_dir 的纯选择逻辑,与平台解耦以便跨平台单测锁定 Windows 语义
/// (std::env/PathBuf 在 Linux CI 上无法复现 Windows 的 USERPROFILE 优先级)。
fn pick_home(
    home: Option<OsString>,
    userprofile: Option<OsString>,
    windows: bool,
) -> Option<OsString> {
    if windows {
        userprofile.or(home)
    } else {
        home.or(userprofile)
    }
}

/// unix 毫秒 → RFC3339(UTC)。会话 updated_at 等对 UI 的时间字段统一此
/// 格式(与 Go 侧 time.Time 的 JSON 序列化对表,字典序即时间序)。
pub fn ms_to_rfc3339(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    // unix 天数 → 民用历(Howard Hinnant 算法)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let (y, m) = if mp < 10 {
        (y, mp + 3)
    } else {
        (y + 1, mp - 9)
    };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// 展开路径开头的 ~/(或裸 ~)为用户主目录;非 ~ 开头原样返回。
pub fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return home_dir()
            .map(|h| h.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    path.to_string()
}

fn backup_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("config");
    path.with_file_name(format!("{name}.bak"))
}

fn sibling_temp_path(path: &Path, label: &str) -> PathBuf {
    let seq = TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("config");
    path.with_file_name(format!(".{name}.{label}-{}-{seq}", std::process::id()))
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    // Unix rename 在同一文件系统内原子替换已有目标。
    fs::rename(from, to)
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(std::io::Error::other)
    }
}

/// 0600 同目录临时文件 → sync → 原子替换；写入失败时主文件保持不变。
/// session sidecar 与权威配置共用这一底层原语，确保 Windows 上也能替换
/// 已存在的目标文件。
pub(crate) fn atomic_write_private(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} 没有父目录", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录 {} 失败: {e}", parent.display()))?;
    let tmp = sibling_temp_path(path, "tmp");
    let result = (|| -> Result<(), String> {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|e| format!("创建临时文件 {} 失败: {e}", tmp.display()))?;
        file.write_all(data)
            .map_err(|e| format!("写入临时文件 {} 失败: {e}", tmp.display()))?;
        file.sync_all()
            .map_err(|e| format!("同步临时文件 {} 失败: {e}", tmp.display()))?;
        drop(file);
        replace_file(&tmp, path).map_err(|e| format!("替换 {} 失败: {e}", path.display()))?;
        #[cfg(unix)]
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn current_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn parse_config(path: &Path, data: &[u8]) -> Result<DesktopConfig, String> {
    serde_json::from_slice(data).map_err(|e| format!("配置文件 {} 损坏: {e}", path.display()))
}

fn load_config_unlocked(dir: &Path) -> Result<DesktopConfig, String> {
    let path = dir.join("config.json");
    let data = match fs::read(&path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(DesktopConfig::default()),
        Err(e) => return Err(format!("读取配置文件 {} 失败: {e}", path.display())),
    };
    match parse_config(&path, &data) {
        Ok(cfg) => Ok(cfg),
        Err(primary_error) => {
            // 主文件损坏时只接受能完整反序列化的备份。先保全坏文件，再恢复
            // 主文件；备份本身不动，恢复中途失败仍有至少一份完整副本。
            let backup = backup_path(&path);
            let backup_data = fs::read(&backup).map_err(|e| {
                format!("{primary_error}；读取备份 {} 也失败: {e}", backup.display())
            })?;
            let cfg = parse_config(&backup, &backup_data)
                .map_err(|e| format!("{primary_error}；备份也不可用: {e}"))?;
            let corrupt = path.with_file_name(format!(
                "config.json.corrupt-{}-{}",
                current_time_ms(),
                TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            atomic_write_private(&corrupt, &data)?;
            atomic_write_private(&path, &backup_data)?;
            eprintln!(
                "[desktop] config.json 损坏，已从 {} 恢复；坏文件保存在 {}",
                backup.display(),
                corrupt.display()
            );
            Ok(cfg)
        }
    }
}

fn save_config_unlocked(dir: &Path, cfg: &DesktopConfig) -> Result<(), String> {
    let path = dir.join("config.json");
    let data = serde_json::to_vec_pretty(cfg).map_err(|e| format!("序列化配置失败: {e}"))?;
    // 仅用可解析的旧主文件更新备份；异常文件不能覆盖最后一份好备份。
    if let Ok(old) = fs::read(&path) {
        if serde_json::from_slice::<DesktopConfig>(&old).is_ok() {
            atomic_write_private(&backup_path(&path), &old)?;
        }
    }
    atomic_write_private(&path, &data)
}

pub fn load_config(app: &AppHandle) -> Result<DesktopConfig, String> {
    let store = app.state::<ConfigStore>();
    let _guard = store.lock();
    load_config_unlocked(&config_dir(app)?)
}

/// 设置页提交：在同一配置事务内合并壳自有偏好、生成引擎派生文件，最后
/// 原子提交权威 config.json。返回实际提交的完整配置供调用方启动引擎。
pub fn save_ui_config_files(
    app: &AppHandle,
    incoming: DesktopConfig,
    browser_mcp: Option<(String, String)>,
) -> Result<DesktopConfig, String> {
    let store = app.state::<ConfigStore>();
    let _guard = store.lock();
    let dir = config_dir(app)?;
    let disk = load_config_unlocked(&dir)?;
    let cfg = DesktopConfig {
        pet_enabled: disk.pet_enabled,
        pet_pos: disk.pet_pos,
        ..incoming
    };
    write_ohmyagent_config(&dir.join("ohmyagent"), &cfg, browser_mcp.as_ref())?;
    save_config_unlocked(&dir, &cfg)?;
    Ok(cfg)
}

/// 只重建引擎派生配置，不改写权威 config.json。启动、手动重启和浏览器
/// 配对变化走这条，避免一次普通启动把读取异常变成永久数据丢失。
pub fn materialize_engine_config(
    app: &AppHandle,
    cfg: &DesktopConfig,
    browser_mcp: Option<(String, String)>,
) -> Result<(), String> {
    let store = app.state::<ConfigStore>();
    let _guard = store.lock();
    write_ohmyagent_config(&engine_config_dir(app)?, cfg, browser_mcp.as_ref())
}

/// 壳自有偏好的原子 read-modify-write；不会触发引擎配置物化。
pub fn update_config_json(
    app: &AppHandle,
    update: impl FnOnce(&mut DesktopConfig),
) -> Result<DesktopConfig, String> {
    let store = app.state::<ConfigStore>();
    let _guard = store.lock();
    let dir = config_dir(app)?;
    let mut cfg = load_config_unlocked(&dir)?;
    update(&mut cfg);
    save_config_unlocked(&dir, &cfg)?;
    Ok(cfg)
}

/// 引擎配置目录:app_config_dir/ohmyagent(经 OHMYAGENT_CONFIG_DIR 注入引擎)。
/// 桌面版自此拥有私有引擎目录,不再接管用户全局 ~/.ohmyagent(CLI 不受影响)。
pub fn engine_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("ohmyagent"))
}

/// 壳清单 → <engine_config_dir>/settings.json + mcp.json。
///
/// 映射:HostModel{name,provider,base_url,api_key,model,…} → 以别名为键的
/// settings.models；每个模型自带协议、endpoint 和凭据，可支持同协议多网关。
fn write_ohmyagent_config(
    dir: &Path,
    cfg: &DesktopConfig,
    browser_mcp: Option<&(String, String)>,
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建引擎配置目录失败: {e}"))?;

    // 协议 → 引擎 wire 类型(e792858 起扁平 per-model schema:每条模型
    // 自带 type/api_key/base_url,按别名作键——壳清单一一对应物化,
    // 旧 providers 槽位与冲突跳过逻辑随之消亡)
    let route_of = |provider: &str| match provider {
        "openai" => "openai-chat",
        "openai_responses" => "openai-responses",
        _ => "anthropic",
    };

    let empty = vec![];
    let models_arr = cfg.models.as_array().unwrap_or(&empty);
    let mut models_out = serde_json::Map::new();
    let mut default_model = String::new();
    for m in models_arr {
        let get = |k: &str| m.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let (name, provider, base_url, api_key, model) = (
            get("name"),
            get("provider"),
            get("base_url"),
            get("api_key"),
            get("model"),
        );
        if name.is_empty() || model.is_empty() {
            continue;
        }
        let mut entry = serde_json::json!({
            "type": route_of(&provider), "model": model,
            "base_url": base_url, "api_key": api_key,
        });
        let context_window = m
            .get("context_window")
            .and_then(|v| v.as_i64())
            .filter(|&c| c > 0)
            .unwrap_or(DEFAULT_MODEL_CONTEXT_WINDOW);
        // Desktop 的产品默认值是 200k。必须显式写给引擎，否则自定义/未知
        // model id 会落入引擎自己的 128k 通用兜底，composer 显示与设置页不符。
        entry["context_window"] = serde_json::json!(context_window);
        // 视觉标记透传:缺失时 ohmyagent 按不支持处理,读图降级为文本占位
        if m.get("vision").and_then(|v| v.as_bool()).unwrap_or(false) {
            entry["supports_images"] = serde_json::json!(true);
        }
        models_out.insert(name.clone(), entry);
        let is_default = m.get("default").and_then(|v| v.as_bool()).unwrap_or(false);
        if default_model.is_empty() || is_default {
            default_model = name; // 别名即选择键(session/create、switchModel 同)
        }
    }

    let settings = serde_json::json!({
        "default_model": default_model,
        "permission_mode": "auto",
        "models": models_out,
    });
    atomic_write_private(
        &dir.join("settings.json"),
        &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )?;

    // MCP:壳词汇 {name: {command,args,env}|{url,headers}} → ohmy {servers:[{name,transport,…}]}
    let mut servers: Vec<serde_json::Value> = Vec::new();
    if let Some(map) = cfg.mcp_servers.as_object() {
        for (name, v) in map {
            // 设置页「停用」的 server 不物化:mcp.json 是引擎 MCP 的唯一
            // 来源,此处过滤即全链路生效(保存配置随即重启引擎重读)
            if v.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false) {
                continue;
            }
            // 新版 UI 会前置校验名称；旧配置/外部写入仍可能含中文。引擎会把
            // name 拼进 mcp__<server>__<tool>,而 OpenAI Responses 仅接受
            // [A-Za-z0-9_-]。只规范化派生 mcp.json,不回写权威 config.json。
            let engine_name = engine_mcp_server_name(name);
            if let Some(cmd) = v.get("command").and_then(|c| c.as_str()) {
                let mut entry = serde_json::json!({
                    "name": engine_name, "transport": "stdio", "command": cmd
                });
                if let Some(args) = v.get("args") {
                    entry["args"] = args.clone();
                }
                if let Some(env) = v.get("env") {
                    entry["env"] = env.clone();
                }
                servers.push(entry);
            } else if let Some(url) = v.get("url").and_then(|u| u.as_str()) {
                let mut entry = serde_json::json!({
                    "name": engine_name, "transport": "streamable-http", "url": url
                });
                if let Some(h) = v
                    .get("headers")
                    .and_then(|h| h.as_object())
                    .filter(|h| !h.is_empty())
                {
                    entry["headers"] = serde_json::json!(h);
                }
                servers.push(entry);
            }
        }
    }
    // 内置条目:壳的浏览器桥 MCP(browser_* 工具),接入信息经参数传入。
    // Bearer token 进程级每次启动新发;mcp.json 随引擎(重)启重写,
    // 恒为当前值,无需持久。
    if let Some((url, token)) = browser_mcp {
        servers.push(serde_json::json!({
            "name": "mc-browser", "transport": "streamable-http", "url": url,
            "headers": { "Authorization": format!("Bearer {token}") },
        }));
    }
    atomic_write_private(
        &dir.join("mcp.json"),
        &serde_json::to_vec_pretty(&serde_json::json!({ "servers": servers }))
            .map_err(|e| e.to_string())?,
    )?;
    Ok(())
}

/// 兼容旧版/外部写入的中文 MCP 名称：引擎侧名称会进入模型工具标识，必须
/// 满足 OpenAI 的 ASCII 约束。合法名称保持不变；发生转换时追加原名哈希。
fn engine_mcp_server_name(display_name: &str) -> String {
    let compatible = !display_name.is_empty()
        && display_name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if compatible {
        return display_name.to_string();
    }

    let mut slug = String::new();
    let mut separator_pending = false;
    for ch in display_name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            if separator_pending
                && !slug.is_empty()
                && !slug.ends_with('_')
                && !slug.ends_with('-')
            {
                slug.push('_');
            }
            slug.push(ch);
            separator_pending = false;
        } else {
            separator_pending = true;
        }
    }
    let slug = slug.trim_matches(|c| c == '_' || c == '-');
    let slug = if slug.is_empty() { "server" } else { slug };
    let digest = Sha256::digest(display_name.as_bytes());
    let hash: String = digest[..6].iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{slug}_{hash}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "mc-config-{label}-{}-{}",
            std::process::id(),
            TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn missing_authoritative_config_uses_defaults_without_creating_a_file() {
        let dir = test_dir("missing");
        let _ = fs::remove_dir_all(&dir);

        let cfg = load_config_unlocked(&dir).unwrap();

        assert!(cfg.models.as_array().unwrap().is_empty());
        assert!(cfg.pet_enabled);
        assert!(!dir.join("config.json").exists());
    }

    #[test]
    fn save_keeps_the_previous_valid_config_as_backup() {
        let dir = test_dir("backup");
        let _ = fs::remove_dir_all(&dir);
        let first = DesktopConfig {
            kernel_env: "wsl:first".into(),
            ..Default::default()
        };
        let second = DesktopConfig {
            kernel_env: "wsl:second".into(),
            ..Default::default()
        };

        save_config_unlocked(&dir, &first).unwrap();
        save_config_unlocked(&dir, &second).unwrap();

        let primary: DesktopConfig =
            serde_json::from_slice(&fs::read(dir.join("config.json")).unwrap()).unwrap();
        let backup: DesktopConfig =
            serde_json::from_slice(&fs::read(dir.join("config.json.bak")).unwrap()).unwrap();
        assert_eq!(primary.kernel_env, "wsl:second");
        assert_eq!(backup.kernel_env, "wsl:first");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_primary_is_restored_from_backup_and_preserved_for_diagnostics() {
        let dir = test_dir("recover");
        let _ = fs::remove_dir_all(&dir);
        let first = DesktopConfig {
            kernel_env: "wsl:known-good".into(),
            ..Default::default()
        };
        let second = DesktopConfig {
            kernel_env: "wsl:newer".into(),
            ..Default::default()
        };
        save_config_unlocked(&dir, &first).unwrap();
        save_config_unlocked(&dir, &second).unwrap();
        fs::write(dir.join("config.json"), b"{broken").unwrap();

        let recovered = load_config_unlocked(&dir).unwrap();

        assert_eq!(recovered.kernel_env, "wsl:known-good");
        let restored: DesktopConfig =
            serde_json::from_slice(&fs::read(dir.join("config.json")).unwrap()).unwrap();
        assert_eq!(restored.kernel_env, "wsl:known-good");
        let preserved = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("config.json.corrupt-")
            })
            .expect("损坏的主配置应保留");
        assert_eq!(fs::read(preserved.path()).unwrap(), b"{broken");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_primary_without_a_valid_backup_is_an_error_and_is_not_overwritten() {
        let dir = test_dir("no-backup");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(&path, b"{broken").unwrap();

        let error = load_config_unlocked(&dir).err().expect("应拒绝静默降级");

        assert!(error.contains("损坏"), "{error}");
        assert_eq!(fs::read(&path).unwrap(), b"{broken");
        let _ = fs::remove_dir_all(&dir);
    }

    /// desktop 启动 agent 时统一启用 AI 权限分类；会话创建也显式传 auto，
    /// 这里作为进程级兜底，覆盖未携带 permission_mode 的兼容路径。
    #[test]
    fn ohmyagent_config_defaults_to_auto_permissions() {
        let dir = std::env::temp_dir().join(format!("mc-permission-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        write_ohmyagent_config(&dir, &DesktopConfig::default(), None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["permission_mode"], "auto");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ohmyagent_config_materializes_desktop_context_window_default() {
        let dir = test_dir("model-context-window");
        let _ = fs::remove_dir_all(&dir);
        let cfg = DesktopConfig {
            models: serde_json::json!([
                {
                    "name": "default-context",
                    "provider": "openai_responses",
                    "base_url": "https://example.invalid",
                    "api_key": "test-key",
                    "model": "custom-model"
                },
                {
                    "name": "explicit-context",
                    "provider": "openai_responses",
                    "base_url": "https://example.invalid",
                    "api_key": "test-key",
                    "model": "another-model",
                    "context_window": 300000
                }
            ]),
            ..Default::default()
        };

        write_ohmyagent_config(&dir, &cfg, None).unwrap();

        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(
            settings["models"]["default-context"]["context_window"],
            DEFAULT_MODEL_CONTEXT_WINDOW
        );
        assert_eq!(
            settings["models"]["explicit-context"]["context_window"],
            300000
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 设置页停用的 MCP 不得物化进引擎 mcp.json(mcp.json 是引擎 MCP
    /// 的唯一来源,漏过滤 = 禁用不生效)。
    #[test]
    fn disabled_mcp_excluded_from_mcp_json() {
        let dir = std::env::temp_dir().join(format!("mc-mcp-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let cfg = DesktopConfig {
            mcp_servers: serde_json::json!({
                "on-stdio": { "command": "npx", "args": ["-y", "some-mcp"] },
                "off-stdio": { "command": "npx", "disabled": true },
                "off-http": { "url": "https://example.invalid/mcp", "disabled": true },
            }),
            ..Default::default()
        };
        write_ohmyagent_config(&dir, &cfg, None).unwrap();
        let mcp: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("mcp.json")).unwrap()).unwrap();
        let names: Vec<&str> = mcp["servers"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|s| s["name"].as_str())
            .collect();
        assert!(
            names.contains(&"on-stdio"),
            "未禁用的 server 应保留: {names:?}"
        );
        assert!(
            !names.contains(&"off-stdio"),
            "禁用的 stdio server 应被过滤: {names:?}"
        );
        assert!(
            !names.contains(&"off-http"),
            "禁用的 http server 应被过滤: {names:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 旧版中文名称写给引擎时必须生成稳定的 ASCII server 标识，且不能
    /// 反向改掉用户的权威配置。
    #[test]
    fn unicode_mcp_name_is_normalized_only_in_derived_config() {
        let dir = test_dir("unicode-mcp-name");
        let _ = fs::remove_dir_all(&dir);
        let display_name = "我的知识库";
        let cfg = DesktopConfig {
            mcp_servers: serde_json::json!({
                display_name: { "url": "https://example.invalid/mcp" },
                "english-server": { "command": "mcp-server" },
            }),
            ..Default::default()
        };

        write_ohmyagent_config(&dir, &cfg, None).unwrap();

        let mcp: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("mcp.json")).unwrap()).unwrap();
        let names: Vec<&str> = mcp["servers"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|server| server["name"].as_str())
            .collect();
        let engine_name = engine_mcp_server_name(display_name);
        assert_ne!(engine_name, display_name);
        assert!(
            engine_name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
            "引擎名称必须满足 OpenAI tool name 约束: {engine_name}"
        );
        assert!(names.contains(&engine_name.as_str()), "派生名称缺失: {names:?}");
        assert!(names.contains(&"english-server"), "合法名称不应改变: {names:?}");
        assert_eq!(engine_mcp_server_name(display_name), engine_name);
        assert_ne!(engine_mcp_server_name("另一个知识库"), engine_name);
        assert!(
            cfg.mcp_servers.get(display_name).is_some(),
            "权威配置中的中文展示名不应改变"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 浏览器桥 MCP 接入信息经参数传入后应物化为 mc-browser 内置条目
    /// (endpoint 显式化前依赖进程级 OnceLock,该路径不可测)。
    #[test]
    fn browser_mcp_param_materialized() {
        let dir = std::env::temp_dir().join(format!("mc-mcp-browser-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let ep = ("http://127.0.0.1:7777/mcp".to_string(), "tok-1".to_string());
        write_ohmyagent_config(&dir, &DesktopConfig::default(), Some(&ep)).unwrap();
        let mcp: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("mcp.json")).unwrap()).unwrap();
        let servers = mcp["servers"].as_array().unwrap();
        let b = servers
            .iter()
            .find(|s| s["name"] == "mc-browser")
            .expect("应有 mc-browser 条目");
        assert_eq!(b["url"], "http://127.0.0.1:7777/mcp");
        assert_eq!(b["headers"]["Authorization"], "Bearer tok-1");
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- home_dir 选择语义(跨平台锁 Windows USERPROFILE 优先) ----

    /// Windows:USERPROFILE 必须压过 HOME——HOME 常被 Git-Bash/MSYS/WSL
    /// interop 注入并指向类 Unix 家目录,让它胜出会把 ~/MonkeyCode 写到
    /// MSYS 家而非 C:\Users\<用户>,与引擎(Go os.UserHomeDir)错位。
    #[test]
    fn pick_home_windows_prefers_userprofile() {
        let home = Some(OsString::from(r"C:\msys64\home\dev"));
        let up = Some(OsString::from(r"C:\Users\dev"));
        assert_eq!(pick_home(home.clone(), up.clone(), true), up);
        // USERPROFILE 缺失时回退 HOME,仍能定位(不至于无家可归)
        assert_eq!(pick_home(home.clone(), None, true), home);
        // 两者皆无 → None
        assert_eq!(pick_home(None, None, true), None);
    }

    /// Unix:HOME 优先(USERPROFILE 在 Unix 上不存在,回退项仅防御)。
    #[test]
    fn pick_home_unix_prefers_home() {
        let home = Some(OsString::from("/home/dev"));
        let up = Some(OsString::from(r"C:\Users\dev"));
        assert_eq!(pick_home(home.clone(), up.clone(), false), home);
        assert_eq!(pick_home(None, up.clone(), false), up);
        assert_eq!(pick_home(None, None, false), None);
    }

    // ---- ms_to_rfc3339(手写 Hinnant 历算,靠已知值对表锚定正确性) ----

    #[test]
    fn ms_to_rfc3339_epoch_and_truncation() {
        assert_eq!(ms_to_rfc3339(0), "1970-01-01T00:00:00Z");
        // 毫秒向下截断到秒
        assert_eq!(ms_to_rfc3339(1999), "1970-01-01T00:00:01Z");
    }

    #[test]
    fn ms_to_rfc3339_leap_day() {
        // 2024:普通闰年;2000:世纪年被 400 整除的闰年(历算最易错分支)
        assert_eq!(ms_to_rfc3339(1_709_164_800_000), "2024-02-29T00:00:00Z");
        assert_eq!(ms_to_rfc3339(951_825_600_000), "2000-02-29T12:00:00Z");
        // 闰日翻页到 3 月 1 日
        assert_eq!(ms_to_rfc3339(1_709_251_200_000), "2024-03-01T00:00:00Z");
    }

    #[test]
    fn ms_to_rfc3339_year_boundary() {
        assert_eq!(ms_to_rfc3339(1_704_067_199_000), "2023-12-31T23:59:59Z");
        assert_eq!(ms_to_rfc3339(1_704_067_200_000), "2024-01-01T00:00:00Z");
    }

    #[test]
    fn ms_to_rfc3339_known_values() {
        // 外部工具(date -u -d @…)对表的锚点值
        assert_eq!(ms_to_rfc3339(1_700_000_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(ms_to_rfc3339(1_721_001_600_000), "2024-07-15T00:00:00Z");
    }
}
