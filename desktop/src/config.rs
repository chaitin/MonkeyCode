// 应用配置(壳持有)与内核清单文件写出。
//
// DesktopConfig 是应用权威配置；引擎 settings.json/mcp.json 只是可重建的
// 派生物。所有权威配置读改写经 ConfigStore 串行，并使用同目录临时文件
// 原子替换；损坏的主文件只允许从有效备份恢复，绝不能静默退成默认配置后
// 覆盖用户的模型/API Key。pet_*、main_window_state(窗口事件)、sound_enabled
// (设置页/托盘即时开关)与 telemetry_enabled(仅改文件)都不在设置页表单里，
// 设置页保存时必须从磁盘合并，否则会被默认值打回。

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
const DEFAULT_MODEL_MAX_OUTPUT: i64 = 32_768;
/// 思考深度产品默认档:模型未配置(含旧版/未知档位)时物化此档。
const DEFAULT_MODEL_THINK: &str = "low";

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MainWindowState {
    /// 窗口外框左上角，物理像素（可跨多显示器为负坐标）。
    pub x: i32,
    pub y: i32,
    /// 客户区逻辑尺寸，不随显示器缩放比例变化。
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
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
    /// MonkeyCode 服务地址(自建/私有化部署;空 = 官方云)。环境变量
    /// MC_DESKTOP_MONKEYCODE_URL 优先于本字段(开发/联调逃生门)。修改
    /// 保存后需**重启应用**生效:云端服务(baizhi::Service)在应用启动
    /// 时按此构造一次,设置页保存只重启引擎、不重建它。
    #[serde(default)]
    pub mc_base_url: String,
    /// MonkeyCode 测试环境反向代理的 HTTP Basic Auth("user:pass",空 =
    /// 无;对齐 mobile 的 mc.basicAuth)。仅对 MonkeyCode 域的请求附
    /// Authorization 头;同样重启应用生效。
    #[serde(default)]
    pub mc_basic_auth: String,
    /// 模型请求地址(llmproxy,会员模型的 LLM 调用打这里;服务端
    /// LLMProxy.BaseURL 的客户端镜像)。空 = 默认 {服务地址}/v1;拆分
    /// 部署(模型代理独立域名/端口,或绕开反代鉴权)时单独指定。
    #[serde(default)]
    pub mc_llm_base_url: String,
    /// 已废弃(单引擎化后忽略):历史 config.json 兼容保留,不再消费。
    #[serde(default = "default_engine")]
    pub agent_engine: String,
    /// 桌宠开关(托盘菜单切换)
    #[serde(default = "default_true")]
    pub pet_enabled: bool,
    /// 事件提示音开关(设置页与托盘菜单切换)。关掉后桌宠页的五种音效
    /// (启动/轮次完成/出错/请求审批/空闲提醒)全部静音;桌宠是否显示不影响
    /// 音效(pet.html 隐藏后仍在跑),两个开关彼此独立。
    #[serde(default = "default_true")]
    pub sound_enabled: bool,
    /// 桌宠窗口位置(物理像素;拖动后记忆)
    #[serde(default)]
    pub pet_pos: Option<(i32, i32)>,
    /// 主窗口正常态的位置、大小与最大化状态。
    #[serde(default)]
    pub main_window_state: Option<MainWindowState>,
    /// 装机统计开关。**刻意不做任何 UI**:载荷只有随机设备标识、版本、系统和
    /// 一个"用没用"的布尔,不含可关联到人的信息,装机计数不需要征求同意。留这个
    /// 字段是给客户合规问卷的出口(改 config.json 一行即可关),不是给普通用户的
    /// 选项。真正的第一道闸门在构建期:没注入上报端点就恒不上报。
    #[serde(default = "default_true")]
    pub telemetry_enabled: bool,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            models: json_array(),
            mcp_servers: json_object(),
            kernel_env: String::new(),
            mc_base_url: String::new(),
            mc_basic_auth: String::new(),
            mc_llm_base_url: String::new(),
            agent_engine: default_engine(),
            pet_enabled: true,
            sound_enabled: true,
            pet_pos: None,
            main_window_state: None,
            telemetry_enabled: true,
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
    let cfg = merge_shell_prefs(incoming, &disk);
    write_ohmyagent_config(&dir.join("ohmyagent"), &cfg, browser_mcp.as_ref())?;
    save_config_unlocked(&dir, &cfg)?;
    Ok(cfg)
}

/// 设置页表单只覆盖它自己呈现的字段。桌宠偏好由托盘切换、提示音开关走自己的
/// 即时命令(set_sound_enabled,点一下就落盘,不进保存条)、统计开关只由改文件
/// 关闭,三者都不在表单里——incoming 携带的是 serde 默认值(全为"开")。不从
/// 磁盘捞回来,用户关掉的东西会被下一次"保存设置"静默打开。
fn merge_shell_prefs(incoming: DesktopConfig, disk: &DesktopConfig) -> DesktopConfig {
    DesktopConfig {
        pet_enabled: disk.pet_enabled,
        sound_enabled: disk.sound_enabled,
        pet_pos: disk.pet_pos,
        main_window_state: disk.main_window_state,
        telemetry_enabled: disk.telemetry_enabled,
        ..incoming
    }
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

/// 思考深度 → 引擎统一 thinking 配置(9af68c5 起 {enabled,effort} 对
/// 所有协议生效:openai 系映射 reasoning effort,anthropic 由引擎转成
/// adaptive + output_config.effort;budget_tokens/type 已废弃不再写)。
fn thinking_config(effort: &str) -> serde_json::Value {
    serde_json::json!({ "enabled": true, "effort": effort })
}

/// url 的主机是否就是 MonkeyCode 服务主机——Basic Auth 的作用域判定,与
/// baizhi::Service::mc_basic_header 同语义:模型请求地址指向其他主机(拆分
/// 部署)时,不得把 MC 的反代凭证嵌进去泄漏给第三方主机。**刻意不解析
/// MC_DESKTOP_MONKEYCODE_URL 环境变量**:测试并行读写该变量会互相踩,且
/// 判定从严(拿不准就不嵌)是安全的方向;纯环境变量改地址的开发场景在
/// 设置里补同样的服务地址即可。
fn on_mc_host(url: &str, mc_base_url: &str) -> bool {
    let mc = mc_base_url.trim().trim_end_matches('/');
    let mc = if mc.is_empty() { crate::baizhi::DEFAULT_MONKEYCODE_URL } else { mc };
    let (Ok(a), Ok(b)) = (reqwest::Url::parse(url), reqwest::Url::parse(mc)) else {
        return false;
    };
    a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// 反代 Basic Auth 嵌进 base_url 的 userinfo(https://user:pass@host/…)。
/// Go 引擎的 http 客户端在 Authorization 为空时按 userinfo 自动补 Basic 头
/// (net/http client.send);anthropic 协议用 x-api-key 携带模型密钥、
/// Authorization 空闲,恰好接住,llmproxy 也优先读 X-Api-Key——三方咬合。
/// openai 系协议引擎自身占用 Authorization(Bearer),Basic 无从附加,
/// 反代环境下该类条目仍不可用(引擎侧限制)。url 库对 userinfo 自动
/// 百分号转义;解析失败原样返回(请求时报错外显)。
fn with_basic_userinfo(base_url: &str, user_pass: &str) -> String {
    let Ok(mut u) = reqwest::Url::parse(base_url) else {
        return base_url.to_string();
    };
    let (user, pass) = match user_pass.split_once(':') {
        Some((user, pass)) => (user, Some(pass)),
        None => (user_pass, None),
    };
    if u.set_username(user).is_err() {
        return base_url.to_string();
    }
    let _ = u.set_password(pass);
    u.to_string()
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

    // MonkeyCode 会员条目的 base_url/api_key 在物化时从应用配置目录
    //(= 引擎目录的父目录,见 baizhi::OHMYAGENT_KEY_FILE)补齐。
    let is_monkeycode = |m: &serde_json::Value| {
        m.get("source").and_then(|v| v.as_str()) == Some(crate::baizhi::monkeycode::SOURCE_MONKEYCODE)
    };
    // locked = 超出会员档的条目(同步层打标):**照常物化**——会员档权限由
    // 服务端把关,引擎 settings 缺了条目反而让老会话(会员到期前选的模型)
    // 一打开就 "unknown model",连恢复都进不去。locked 只影响 default 回退
    // (不默认选禁用项)与显式选择(session.rs model_id_of 拒绝)。
    // 只认会员条目上的标记,手编条目的杂散 locked 忽略。
    let is_locked_member = |m: &serde_json::Value| {
        is_monkeycode(m) && m.get("locked").and_then(|v| v.as_bool()).unwrap_or(false)
    };
    let mc_key = models_arr
        .iter()
        .any(is_monkeycode)
        .then(|| dir.parent().and_then(crate::baizhi::stored_ohmyagent_key))
        .flatten();
    let mc_key_field = |k: &str| {
        mc_key
            .as_ref()
            .and_then(|v| v.get(k))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let mut models_out = serde_json::Map::new();
    let mut default_model = String::new();
    for m in models_arr {
        let get = |k: &str| m.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let (name, provider, model) = (get("name"), get("provider"), get("model"));
        // 会员条目的密钥由壳补齐(本机记录缺失时照常物化,请求时报错外显,
        // 不静默丢条目);配了测试环境反代 Basic Auth 时嵌进 userinfo
        // (见 with_basic_userinfo)
        let (base_url, api_key) = if is_monkeycode(m) {
            // 地址按当前配置现算(baizhi::resolve_mc_llm 单一出处):设置里显式
            // 指定 > 官方云代理子域 > {服务地址}/v1。**不读 Key 文件里的
            // base_url 快照**——那是建 Key 当时的地址,默认值一改(如官方云
            // 从主域挪到 proxy 子域)老机器会一直打旧地址,直到下次重新同步
            let server = crate::baizhi::Endpoints::resolve(&cfg.mc_base_url).monkeycode;
            let mut b = crate::baizhi::resolve_mc_llm(&cfg.mc_llm_base_url, &server);
            let basic = cfg.mc_basic_auth.trim();
            // Basic Auth 只嵌给 MonkeyCode 主机:模型地址指向别的主机时嵌入
            // 等于把反代凭证泄漏给第三方(host 门与 mc_basic_header 同语义)
            if !b.is_empty() && !basic.is_empty() && on_mc_host(&b, &cfg.mc_base_url) {
                b = with_basic_userinfo(&b, basic);
            }
            (b, mc_key_field("api_key"))
        } else {
            (get("base_url"), get("api_key"))
        };
        if name.is_empty() || model.is_empty() {
            continue;
        }
        let wire_type = route_of(&provider);
        let mut entry = serde_json::json!({
            "type": wire_type, "model": model,
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
        // 视觉标记显式透传:勾选即支持;未勾选写 false 压过引擎目录里
        // 已知 model id 的 vision 默认,保证不发图片块(读图降级为文本占位)
        let vision = m.get("vision").and_then(|v| v.as_bool()).unwrap_or(false);
        entry["supports_images"] = serde_json::json!(vision);
        // 最大输出:显式配置(>0)优先,缺省物化产品默认 32768——新一代模型
        // 的输出上限(64k~128k)远超引擎 16384 兜底,不抬高会截断长输出。
        // 已知取舍:引擎压缩在上下文占用 90% 才触发且不预留输出空间,
        // 200k 窗口下输入落在 167k~180k 的请求会因 输入+输出 超模型上限
        // 被服务端拒(settings.tsx 的 10% 校验即为此而设)。
        let max_output = m
            .get("max_output")
            .and_then(|v| v.as_i64())
            .filter(|&n| n > 0)
            .unwrap_or(DEFAULT_MODEL_MAX_OUTPUT);
        entry["max_output"] = serde_json::json!(max_output);
        // 思考深度:条目按模型设置的 think 档物化,未配置/未知档位落产品
        // 默认「低」;显式 off 写 enabled:false(与 vision 同理,显式写入
        // 压过引擎目录里已知 model id 的默认)。会话级调整走引擎
        // session/setThinking RPC(session.rs),不再物化变体别名。
        entry["thinking"] = match m.get("think").and_then(|v| v.as_str()).unwrap_or("") {
            "off" => serde_json::json!({ "enabled": false }),
            effort @ ("low" | "medium" | "high") => thinking_config(effort),
            _ => thinking_config(DEFAULT_MODEL_THINK),
        };
        models_out.insert(name.clone(), entry);
        // default/首条回退滤 locked(降档后 config 的 default 可能落在锁定行,
        // 宁可换成首个可用条目也不默认选禁用项;session.rs 空名回退同口径)
        let is_default = m.get("default").and_then(|v| v.as_bool()).unwrap_or(false);
        if !is_locked_member(m) && (default_model.is_empty() || is_default) {
            default_model = name; // 别名即选择键(session/create、switchModel 同)
        }
    }

    let mut settings = serde_json::json!({
        "default_model": default_model,
        "permission_mode": "auto",
        "models": models_out,
    });
    // 顶层字段,引擎按需使用;对全部模型生效,其他网关忽略无副作用。
    // 无会员条目时不写。
    let secret = mc_key_field("signing_secret");
    if !secret.is_empty() {
        settings["signing_secret"] = serde_json::json!(secret);
    }
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
    // WSL 运行环境:桥监听宿主 127.0.0.1,NAT 网络下 guest 内的引擎打不到
    // (127.0.0.1 是 guest 自己)——仅 mirrored 网络物化,其余降级不写,
    // UI 能力同步压 false(driver::caps)。改绑 vEth IP/interop stdio 代理
    // 留待后续评估。
    if let Some((url, token)) = browser_mcp {
        let reachable = match crate::wsl::distro_of(&cfg.kernel_env) {
            Some(distro) => {
                let mode = crate::wsl::networking_mode(distro);
                if mode != "mirrored" {
                    eprintln!(
                        "[desktop] WSL 网络模式为 {mode},guest 无法回连宿主 127.0.0.1,\
                         浏览器工具暂不可用(mirrored 网络可用)"
                    );
                }
                mode == "mirrored"
            }
            None => true,
        };
        if reachable {
            servers.push(serde_json::json!({
                "name": "mc-browser", "transport": "streamable-http", "url": url,
                "headers": { "Authorization": format!("Bearer {token}") },
            }));
        }
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

    /// 表单外关掉的东西不得被"保存设置"打回默认。设置页表单不含这些字段，
    /// 于是 incoming 里它们恒为 serde 默认值 true —— 少一次磁盘合并，客户按
    /// 合规要求关掉的统计会在下一次改模型配置时被静默打开，且毫无提示。
    #[test]
    fn saving_ui_settings_preserves_preferences_outside_the_form() {
        let disk = DesktopConfig {
            pet_enabled: false,
            sound_enabled: false,
            pet_pos: Some((12, 34)),
            main_window_state: Some(MainWindowState {
                x: 56,
                y: 78,
                width: 1200,
                height: 800,
                maximized: true,
            }),
            telemetry_enabled: false,
            ..Default::default()
        };
        // 设置页提交的形态:只有表单字段有值，壳自有偏好走 serde 默认。
        let incoming = DesktopConfig {
            kernel_env: "wsl:Ubuntu".into(),
            ..Default::default()
        };
        assert!(incoming.telemetry_enabled, "前提:表单提交里它就是 true");

        let merged = merge_shell_prefs(incoming, &disk);

        assert!(!merged.telemetry_enabled, "统计开关必须保留磁盘上的关闭态");
        assert!(!merged.pet_enabled);
        assert!(!merged.sound_enabled, "提示音开关同样不在表单里,必须保留关闭态");
        assert_eq!(merged.pet_pos, Some((12, 34)));
        assert_eq!(merged.main_window_state, disk.main_window_state);
        assert_eq!(merged.kernel_env, "wsl:Ubuntu", "表单字段仍应生效");
    }

    /// 老版本 config.json 没有这个字段，升级后应视为开启(而不是 false)。
    #[test]
    fn config_without_telemetry_field_defaults_to_enabled() {
        let cfg: DesktopConfig = serde_json::from_str(r#"{"models":[],"pet_enabled":false}"#).unwrap();
        assert!(cfg.telemetry_enabled);
        assert!(cfg.sound_enabled, "升级到带提示音开关的版本不该静音");
        assert!(!cfg.pet_enabled, "同一份 JSON 里显式给出的字段不受影响");
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

    /// MonkeyCode 会员条目的 base_url/api_key 在 config.json 里是空占位,
    /// 物化时从应用配置目录的本机记录补齐;顶层 signing_secret 同源。
    /// 无会员条目时不写 secret。
    #[test]
    fn ohmyagent_config_injects_proxy_credentials_for_monkeycode_entries() {
        let root = test_dir("signing-secret");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join(crate::baizhi::OHMYAGENT_KEY_FILE),
            br#"{"id":"key-1","api_key":"omk-1","signing_secret":"sec-9","base_url":"https://mc.example.com/v1"}"#,
        )
        .unwrap();
        let engine_dir = root.join("ohmyagent");
        let mc_cfg = DesktopConfig {
            models: serde_json::json!([
                {
                    "name": "会员模型", "provider": "anthropic",
                    "base_url": "", "api_key": "",
                    "model": "cfg-1", "source": "monkeycode"
                },
                {
                    "name": "自定义", "provider": "anthropic",
                    "base_url": "https://direct.example.com", "api_key": "sk-direct", "model": "m"
                }
            ]),
            ..Default::default()
        };

        write_ohmyagent_config(&engine_dir, &mc_cfg, None).unwrap();

        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(engine_dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["signing_secret"], "sec-9");
        assert_eq!(settings["models"]["会员模型"]["api_key"], "omk-1");
        // 官方云(未配服务地址):模型请求打独立代理子域,**不跟随** Key 文件
        // 里 https://mc.example.com/v1 的旧快照(2026-08-07 用户定案)
        assert_eq!(
            settings["models"]["会员模型"]["base_url"],
            crate::baizhi::DEFAULT_MONKEYCODE_LLM_URL
        );
        // 非会员条目不受注入影响
        assert_eq!(settings["models"]["自定义"]["api_key"], "sk-direct");
        assert_eq!(settings["models"]["自定义"]["base_url"], "https://direct.example.com");

        // 配置了反代 Basic Auth:嵌进会员条目 base_url 的 userinfo(Go 引擎
        // 在 Authorization 空闲时自动补 Basic 头;特殊字符需百分号转义)。
        // host 门:凭证只嵌给 MonkeyCode 主机,服务地址须与之匹配;
        // 非会员条目不受影响
        let basic_cfg = DesktopConfig {
            mc_base_url: "https://mc.example.com".into(),
            mc_basic_auth: "user:p@ss".into(),
            ..mc_cfg.clone()
        };
        write_ohmyagent_config(&engine_dir, &basic_cfg, None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(engine_dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["models"]["会员模型"]["base_url"], "https://user:p%40ss@mc.example.com/v1");
        assert_eq!(settings["models"]["自定义"]["base_url"], "https://direct.example.com");

        // 显式模型请求地址(拆分部署):物化直接采用设置值(尾斜杠归一,
        // 不等重新同步刷新 Key 快照)
        let llm_cfg = DesktopConfig { mc_llm_base_url: "https://llm.example.com/v1/".into(), ..mc_cfg.clone() };
        write_ohmyagent_config(&engine_dir, &llm_cfg, None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(engine_dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["models"]["会员模型"]["base_url"], "https://llm.example.com/v1");

        // 模型地址指向第三方主机 + 配了 Basic:**不得**把 MC 反代凭证嵌给
        // 第三方(host 门,与 mc_basic_header 同语义);指回 MC 主机则照嵌
        let split_cfg = DesktopConfig {
            mc_base_url: "https://mc.example.com".into(),
            mc_basic_auth: "user:p@ss".into(),
            mc_llm_base_url: "https://llm.example.com/v1".into(),
            ..mc_cfg.clone()
        };
        write_ohmyagent_config(&engine_dir, &split_cfg, None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(engine_dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(
            settings["models"]["会员模型"]["base_url"], "https://llm.example.com/v1",
            "第三方主机不得携带 MC 反代凭证"
        );
        let same_host_cfg = DesktopConfig {
            mc_llm_base_url: "https://mc.example.com/llm/v1".into(),
            ..split_cfg.clone()
        };
        write_ohmyagent_config(&engine_dir, &same_host_cfg, None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(engine_dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["models"]["会员模型"]["base_url"], "https://user:p%40ss@mc.example.com/llm/v1");

        // 无会员条目:即便 Key 文件在,也不写顶层 secret
        let plain_cfg = DesktopConfig {
            models: serde_json::json!([{
                "name": "自定义", "provider": "anthropic",
                "base_url": "https://x", "api_key": "k", "model": "m"
            }]),
            ..Default::default()
        };
        write_ohmyagent_config(&engine_dir, &plain_cfg, None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(engine_dir.join("settings.json")).unwrap()).unwrap();
        assert!(settings.get("signing_secret").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    /// locked(超会员档)会员条目:**照常物化**(缺条目会让到期前选它的
    /// 老会话恢复即 "unknown model";档位权限归服务端把关),但 default
    /// 回退滤 locked;全锁时 secret 照写(条目在,请求得能签)。
    #[test]
    fn ohmyagent_config_materializes_locked_member_entries() {
        let root = test_dir("locked-members");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join(crate::baizhi::OHMYAGENT_KEY_FILE),
            br#"{"id":"key-1","api_key":"omk-1","signing_secret":"sec-9","base_url":"https://mc.example.com/v1"}"#,
        )
        .unwrap();
        let engine_dir = root.join("ohmyagent");
        let cfg = DesktopConfig {
            models: serde_json::json!([
                { "name": "旗舰模型", "provider": "anthropic", "base_url": "", "api_key": "",
                  "model": "monkeycode-ultra/x", "source": "monkeycode", "locked": true, "default": true },
                { "name": "专业模型", "provider": "anthropic", "base_url": "", "api_key": "",
                  "model": "monkeycode-pro/y", "source": "monkeycode" },
                // 手编条目带杂散 locked:不是会员条目,照常物化
                { "name": "手编", "provider": "anthropic", "base_url": "https://x", "api_key": "k",
                  "model": "m", "locked": true }
            ]),
            ..Default::default()
        };
        write_ohmyagent_config(&engine_dir, &cfg, None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(engine_dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["models"]["旗舰模型"]["api_key"], "omk-1", "locked 会员条目照常物化并注入密钥");
        assert_eq!(settings["models"]["专业模型"]["api_key"], "omk-1", "未锁会员条目照常注入");
        assert_eq!(settings["models"]["手编"]["api_key"], "k", "杂散 locked 的手编条目不受影响");
        assert_eq!(settings["default_model"], "专业模型", "default 落在 locked 条目时回退首个未锁条目");
        assert_eq!(settings["signing_secret"], "sec-9");

        // 全部会员条目均 locked:条目照常物化,secret 照写,default 落未锁的自定义条目
        let all_locked = DesktopConfig {
            models: serde_json::json!([
                { "name": "旗舰模型", "provider": "anthropic", "base_url": "", "api_key": "",
                  "model": "monkeycode-ultra/x", "source": "monkeycode", "locked": true },
                { "name": "自定义", "provider": "anthropic", "base_url": "https://x", "api_key": "k", "model": "m" }
            ]),
            ..Default::default()
        };
        write_ohmyagent_config(&engine_dir, &all_locked, None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(engine_dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["signing_secret"], "sec-9", "有会员条目(含全锁)就写顶层 secret");
        assert_eq!(settings["models"]["旗舰模型"]["api_key"], "omk-1");
        assert_eq!(settings["default_model"], "自定义", "default 不落在 locked 条目上");
        let _ = fs::remove_dir_all(&root);
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

    /// 最大输出/思考深度的物化:max_output 显式配置优先,缺省写产品默认
    /// 32768;think 物化为引擎统一 {enabled,effort},未配置/未知档位落产品
    /// 默认「低」,显式 off 写 enabled:false。
    #[test]
    fn ohmyagent_config_materializes_max_output_and_thinking() {
        let dir = test_dir("model-max-output-thinking");
        let _ = fs::remove_dir_all(&dir);
        let cfg = DesktopConfig {
            models: serde_json::json!([
                {
                    "name": "plain",
                    "provider": "openai",
                    "base_url": "https://example.invalid",
                    "api_key": "k",
                    "model": "m"
                },
                {
                    "name": "openai-tuned",
                    "provider": "openai",
                    "base_url": "https://example.invalid",
                    "api_key": "k",
                    "model": "m",
                    "max_output": 32768,
                    "think": "high"
                },
                {
                    "name": "claude-default-max",
                    "provider": "anthropic",
                    "base_url": "https://example.invalid",
                    "api_key": "k",
                    "model": "m",
                    "think": "high"
                },
                {
                    "name": "claude-small-max",
                    "provider": "anthropic",
                    "base_url": "https://example.invalid",
                    "api_key": "k",
                    "model": "m",
                    "max_output": 4096,
                    "think": "high"
                },
                {
                    "name": "claude-tiny-max",
                    "provider": "anthropic",
                    "base_url": "https://example.invalid",
                    "api_key": "k",
                    "model": "m",
                    "max_output": 1500,
                    "think": "low"
                },
                {
                    "name": "bad-think",
                    "provider": "openai",
                    "base_url": "https://example.invalid",
                    "api_key": "k",
                    "model": "m",
                    "think": "ultra"
                },
                {
                    "name": "think-off",
                    "provider": "openai",
                    "base_url": "https://example.invalid",
                    "api_key": "k",
                    "model": "m",
                    "think": "off"
                }
            ]),
            ..Default::default()
        };

        write_ohmyagent_config(&dir, &cfg, None).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("settings.json")).unwrap()).unwrap();
        let models = &settings["models"];

        // 未配置:max_output 落产品默认 32768,thinking 落产品默认「低」
        assert_eq!(models["plain"]["max_output"], 32768);
        assert_eq!(
            models["plain"]["thinking"],
            serde_json::json!({ "enabled": true, "effort": "low" })
        );

        assert_eq!(models["openai-tuned"]["max_output"], 32768);
        assert_eq!(
            models["openai-tuned"]["thinking"],
            serde_json::json!({ "enabled": true, "effort": "high" })
        );

        // anthropic 与 openai 同用统一 {enabled,effort}(引擎按协议转译,
        // budget_tokens/type 已废弃),max_output 不再耦合 thinking
        assert_eq!(models["claude-default-max"]["max_output"], 32768);
        assert_eq!(
            models["claude-default-max"]["thinking"],
            serde_json::json!({ "enabled": true, "effort": "high" })
        );
        assert_eq!(
            models["claude-small-max"]["thinking"],
            serde_json::json!({ "enabled": true, "effort": "high" })
        );
        assert_eq!(
            models["claude-tiny-max"]["thinking"],
            serde_json::json!({ "enabled": true, "effort": "low" })
        );
        assert_eq!(models["claude-tiny-max"]["max_output"], 1500);

        // 未知档位不透传原值(防旧版/实验值造成引擎侧报错),落产品默认「低」
        assert_eq!(
            models["bad-think"]["thinking"],
            serde_json::json!({ "enabled": true, "effort": "low" })
        );
        // 显式关闭:enabled:false 显式写入,压过引擎目录里的模型默认
        assert_eq!(models["think-off"]["thinking"], serde_json::json!({ "enabled": false }));
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
