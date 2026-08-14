// 引擎驱动层:UI 只经 Tauri IPC 与壳对话,壳适配 ohmyagent 内核(stdio)。
//
// 下行帧统一走 Tauri 事件(UI 按会话订阅 `frames:{sid}`,帧为 Frame
// 词汇——引擎事件在 driver 内归一化,reduce 层零改动):
//   frames:{sid}       Frame[](~30ms 批量,防高频 delta 拖垮 IPC)
//   conn-status:{sid}  {text, connected} 会话流连接状态
//   session-event      {type: session-status|session-ask|session-summary, ...}
//                      全局状态(侧栏+桌宠)与引擎生成的会话摘要
//   ws-msg:{pipe}      云端 WS 桥下行文本帧(协议逻辑仍在 UI,壳只做管道)
//   ws-closed:{pipe}   云端 WS 桥断开
//
// 上行统一走 invoke 命令(本文件底部,main.rs 注册)。

mod fold;
pub mod frame;
mod normalize;
pub mod ohmy;
mod session;
mod subagent;
mod transport;

use std::ops::Deref;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use ohmy::OhmyDriver;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::config::DesktopConfig;
use crate::repo::RepoCtx;
use crate::util::LockExt;

/// 崩溃后自动重启的次数上限。用尽即熔断(状态停在 Crashed 且
/// retry_in_ms=None),只能人工重启——起不来的引擎多半是配置或安装问题,
/// 无限重试只会刷屏并烧 CPU。
pub const ENGINE_MAX_RETRY: u32 = 5;
/// 判定"这次启动是成功的"所需的连续存活时长,见 next_retry。
pub const ENGINE_STABLE_UPTIME: Duration = Duration::from_secs(60);

/// 引擎生命周期状态(契约 6)。壳内唯一真值:与 `engine` 句柄**同一把锁**
/// 维护,不存在"句柄已摘、状态还是 Ready"这类可观测不一致。UI 的顶部横幅
/// 与"引擎为什么不可用"的文案全部由它派生。
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../ui/src/gen/"))]
pub enum EngineStatus {
    /// 未启动:冷启动前、或应用退出/重启的中间态。
    Stopped,
    /// 正在拉起。attempt>0 表示这是崩溃后的第几次自动重试。
    Starting { attempt: u32 },
    Ready { version: String },
    /// 非 stop() 引发的退出。retry_in_ms=Some 表示正在退避等待自动重启,
    /// None 表示已熔断,只能人工重启。
    /// retry_in_ms 用 u32:u64 经 ts-rs 会生成 `bigint`,而 Tauri IPC 送到 UI
    /// 的是普通 JS number,类型与运行时对不上(退避上限 16s,u32 绰绰有余)。
    Crashed { detail: String, log_tail: String, attempt: u32, retry_in_ms: Option<u32> },
    /// 启动失败:二进制缺失、配置物化失败、握手超时、协议版本不匹配。
    Failed { error: String },
}

impl EngineStatus {
    /// 引擎不在位时给 IPC 调用方的原因。此前每条命令各自撞见
    /// "引擎已退出"/"引擎未运行"两种文案,取决于死句柄有没有被摘,
    /// 用户看到的提示与实际处境对不上;现在统一由状态派生。
    fn unavailable(&self) -> String {
        match self {
            EngineStatus::Starting { attempt: 0 } => "引擎正在启动,请稍候".into(),
            EngineStatus::Starting { .. } => "引擎正在自动重启,请稍候".into(),
            EngineStatus::Crashed { retry_in_ms: Some(_), .. } => "引擎已退出,正在自动重启".into(),
            EngineStatus::Crashed { .. } => "引擎已退出,请点顶部横幅重启".into(),
            EngineStatus::Failed { error } => format!("引擎未运行: {error}"),
            // Ready 而句柄为空是不可达的(同锁维护),兜底给通用文案
            EngineStatus::Stopped | EngineStatus::Ready { .. } => "引擎未运行".into(),
        }
    }

    /// 引擎在位或正在拉起。关主窗口是"隐藏留活"还是"放行销毁"以此为准——
    /// 两种都不退进程(托盘可用时 ExitRequested 一律 prevent_exit),区别只在
    /// 有没有任务要护着;销毁那条依赖 show_any_window 能把窗口重建回来。
    pub fn alive(&self) -> bool {
        matches!(self, EngineStatus::Ready { .. } | EngineStatus::Starting { .. })
    }
}

/// 崩溃后的重试决策(纯函数,便于单测)。`uptime` = 本次引擎从就绪到崩溃的
/// 存活时长。返回 (本次用掉的第几次重试, 退避时长);None = 熔断。
///
/// 稳定期判据是这套自愈的关键:没有它,"起来就崩"的引擎每次崩溃都被当作
/// 首次,attempt 永远停在 1、退避永远是 1s、熔断永远触发不到——自动重启
/// 直接退化成 1s 一次的死循环。
pub fn next_retry(attempt: u32, uptime: Duration) -> Option<(u32, Duration)> {
    let used = if uptime >= ENGINE_STABLE_UPTIME { 0 } else { attempt };
    if used >= ENGINE_MAX_RETRY {
        return None;
    }
    Some((used + 1, Duration::from_secs(1u64 << used))) // 1/2/4/8/16s
}

/// 当前引擎(壳生命周期内至多一个;保存设置时整体替换)。命令通过 lease
/// 使用克隆句柄；维护事务先关闭新 lease，再等已有 IPC 调用退出。
/// 句柄与生命周期状态同锁维护,状态变更一律经 main.rs 的 `publish_*` 收口
/// (那里负责 emit `engine-status`),本类型不自己发事件。
pub struct DriverHost {
    state: Mutex<DriverHostState>,
    idle: Condvar,
}

struct DriverHostState {
    engine: Option<OhmyDriver>,
    status: EngineStatus,
    applying: bool,
    leases: usize,
}

pub struct DriverLease<'a> {
    host: &'a DriverHost,
    engine: OhmyDriver,
}

impl Deref for DriverLease<'_> {
    type Target = OhmyDriver;
    fn deref(&self) -> &Self::Target { &self.engine }
}

impl Drop for DriverLease<'_> {
    fn drop(&mut self) {
        let mut state = self.host.state.lock_ok();
        state.leases = state.leases.saturating_sub(1);
        self.host.idle.notify_all();
    }
}

/// 持有期间 get 拒绝新命令；已有命令在 guard 创建前已排空。
#[must_use]
pub struct DriverApplyGuard<'a> { host: &'a DriverHost }

impl Drop for DriverApplyGuard<'_> {
    fn drop(&mut self) {
        let mut state = self.host.state.lock_ok();
        state.applying = false;
        self.host.idle.notify_all();
    }
}

impl DriverHost {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(DriverHostState {
                engine: None,
                status: EngineStatus::Stopped,
                applying: false,
                leases: 0,
            }),
            idle: Condvar::new(),
        }
    }

    pub fn get(&self) -> Result<DriverLease<'_>, String> {
        let mut state = self.state.lock_ok();
        if state.applying { return Err("引擎配置正在应用，请稍后重试".into()); }
        let Some(engine) = state.engine.clone() else { return Err(state.status.unavailable()) };
        state.leases += 1;
        Ok(DriverLease { host: self, engine })
    }

    /// 显式设置保存/手动重启：阻止新命令，并等待已进入的 IPC 命令退出。
    pub fn begin_apply(&self) -> DriverApplyGuard<'_> {
        let mut state = self.state.lock_ok();
        while state.applying {
            state = self.idle.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        state.applying = true;
        while state.leases != 0 {
            state = self.idle.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        DriverApplyGuard { host: self }
    }

    /// 自动维护只在没有运行中父任务时取得独占权。先关入口并排空 lease，
    /// 再检查 running，消除“检查空闲后新任务刚好启动”的 TOCTOU 窗口。
    pub fn try_begin_idle_apply(&self) -> Option<DriverApplyGuard<'_>> {
        let mut state = self.state.lock_ok();
        // 忙碌期间刷新线程会周期重试；先读一次状态可避免每次轮询都短暂
        // 关闭 IPC 入口。这个检查只用于快速退出，真正取得 guard 前仍会
        // 在排空 lease 后二次检查。
        if state.applying
            || state
                .engine
                .as_ref()
                .is_some_and(OhmyDriver::has_running_sessions)
        {
            return None;
        }
        state.applying = true;
        while state.leases != 0 {
            state = self.idle.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        let running = state.engine.as_ref().is_some_and(OhmyDriver::has_running_sessions);
        if running {
            state.applying = false;
            self.idle.notify_all();
            return None;
        }
        Some(DriverApplyGuard { host: self })
    }

    /// 引擎在位或正在拉起(关窗语义、托盘常驻判据)。
    pub fn running(&self) -> bool {
        let state = self.state.lock_ok();
        state.engine.is_some() || state.status.alive()
    }

    pub fn status(&self) -> EngineStatus {
        self.state.lock_ok().status.clone()
    }

    /// 引擎就位:句柄与状态同一把锁一起写。
    pub fn set(&self, e: OhmyDriver, status: EngineStatus) {
        let mut state = self.state.lock_ok();
        state.engine = Some(e);
        state.status = status;
    }

    /// 只改状态(Starting/Crashed/Failed);句柄不动。
    pub fn set_status(&self, status: EngineStatus) {
        self.state.lock_ok().status = status;
    }

    /// 摘除句柄并落回 Stopped。停机、重启前置与**崩溃**都经它——崩溃路径
    /// 此前不摘句柄,导致 running() 恒真(关窗只隐藏,用户以为退出了进程还在)
    /// 且每条 IPC 都能借到一个必然失败的死引擎。
    pub fn take(&self) -> Option<OhmyDriver> {
        let mut state = self.state.lock_ok();
        state.status = EngineStatus::Stopped;
        state.engine.take()
    }

    /// 仅当在位的引擎就是 `instance` 时摘除。崩溃通知专用:壳生命周期内
    /// 先后起过多个引擎进程,退出通知可能来自早已被弃用的那一个——
    /// - 启动握手超时后残留的孤儿进程,几分钟后才咽气;
    /// - 重启期间旧引擎抢在 stop() 置位前自行退出。
    ///
    /// 不认实例就会拿别人的死讯摘掉**当前活引擎**的句柄,再发一轮崩溃横幅和
    /// 自动重启,把刚起来的引擎踹掉。返回 None 表示这条死讯已过期,应忽略。
    pub fn take_instance(&self, instance: u64) -> Option<OhmyDriver> {
        let mut state = self.state.lock_ok();
        if state.engine.as_ref().map(OhmyDriver::instance) != Some(instance) {
            return None;
        }
        state.status = EngineStatus::Stopped;
        state.engine.take()
    }
}

/// 引擎能力表(对表 desktop/ui/src/types.ts 的 EngineCaps)。
/// 能力仍是渐进的(随上游补齐翻位),由 ready 握手与桌面壳实际能力
/// 共同投影；UI 降级与命令层守卫都读取同一份运行时结果。
#[derive(Clone, Copy, serde::Serialize)]
pub struct Caps {
    /// 浏览器扩展桥(壳内 browser/ 模块,MCP 暴露给引擎)
    pub browser_ext: bool,
    /// 上下文用量(event/stream usage 实时更新 + turn/stopped 轮后快照)
    pub usage_update: bool,
    pub perm_remember: bool,
    pub attachments: bool,
}

pub fn caps(engine: &OhmyDriver, browser_ext: bool) -> Caps {
    // WSL 运行环境:guest 内引擎回连宿主 127.0.0.1 仅 mirrored 网络可达,
    // 其余模式浏览器桥压 false(mcp.json 物化同判定,见 write_ohmyagent_config)
    let browser_reachable = match engine.wsl_networking() {
        Some(mode) => mode == "mirrored",
        None => true,
    };
    Caps {
        browser_ext: browser_ext && browser_reachable,
        usage_update: engine.has_capability("turn/stopped"),
        perm_remember: engine.has_capability("permissionRemember"),
        // 上传/路径注入由壳实现，不是引擎握手项。
        attachments: true,
    }
}

/// 引擎日志的真实落点(报障导出与崩溃 tail 的单一出处)。
///
/// 两处都要看:引擎自己按运行分文件写 `<config_dir>/ohmyagent/logs/ohmyagent-*.log`
/// (健康运行的全部现场都在这);壳接的 stderr `ohmyagent.log` 只在引擎连
/// 日志器都没起来时才有内容(动态库缺失、panic、wsl.exe 自身报错)——正常
/// 跑一轮它是 0 字节,此前导出/崩溃 tail 都只认它,于是拿到的是**空文件**
/// (2026-08-07 用户报障「导出的日志是空白的」)。
///
/// 取「非空里最新」的那个:健康运行落引擎自己的日志;起都起不来时 stderr
/// 才是唯一现场,且它此时必然比上一轮的引擎日志新。全空返回 None(引擎没
/// 启动过,或本轮什么都没写)——宁可如实报"没有日志",不给一个空文件。
pub fn engine_log_file(cfg_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut best: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
    let mut consider = |p: std::path::PathBuf| {
        let Ok(md) = std::fs::metadata(&p) else { return };
        if !md.is_file() || md.len() == 0 {
            return; // 空文件不是现场
        }
        let t = md.modified().unwrap_or(std::time::UNIX_EPOCH);
        if best.as_ref().is_none_or(|(bt, _)| t > *bt) {
            best = Some((t, p));
        }
    };
    if let Ok(entries) = std::fs::read_dir(cfg_dir.join("ohmyagent").join("logs")) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("log") {
                consider(p);
            }
        }
    }
    consider(cfg_dir.join("ohmyagent.log"));
    best.map(|(_, p)| p)
}

/// 日志尾部(崩溃外显用;文件缺失返回空)。
pub fn log_tail(path: &std::path::Path, lines: usize) -> String {
    std::fs::read(path)
        .map(|b| {
            let s = crate::wsl::decode_wsl_output(&b);
            let all: Vec<_> = s.lines().collect();
            all[all.len().saturating_sub(lines)..].join("\n")
        })
        .unwrap_or_default()
}

/// 按配置启动引擎(阻塞等就绪;setup 与 save_config 共用)。
pub fn start_engine(app: &AppHandle, cfg: &DesktopConfig) -> Result<OhmyDriver, String> {
    OhmyDriver::start(app.clone(), cfg)
}

// ==================== Tauri 命令 ====================

/// 引擎生命周期状态查询。UI 挂载后先拉一次:`engine-status` 事件在窗口
/// 建起来之前就可能发过(冷启动失败、启动期崩溃),只靠监听必然错过。
#[tauri::command]
pub async fn engine_status(host: State<'_, DriverHost>) -> Result<EngineStatus, String> {
    Ok(host.status())
}

#[tauri::command]
pub async fn engine_caps(app: AppHandle, host: State<'_, DriverHost>) -> Result<Caps, String> {
    let engine = host.get()?;
    let browser_ext = app.try_state::<crate::browser::BrowserHost>().is_some();
    Ok(caps(&engine, browser_ext))
}

/// 目录选择对话框的初始位置:WSL 模式返回 guest 家目录的 \\wsl$ 视角
/// (prepare 采集,随引擎实例);本机模式/引擎未起返回 None,UI 自行回退
/// (发行版根或不指定)。
#[tauri::command]
pub async fn wsl_workdir_base(host: State<'_, DriverHost>) -> Result<Option<String>, String> {
    Ok(host.get().ok().and_then(|e| e.wsl_workdir_base()))
}

#[tauri::command]
pub async fn sessions_list(host: State<'_, DriverHost>) -> Result<Value, String> {
    host.get()?.sessions_list().await
}

#[tauri::command]
pub async fn session_create(
    host: State<'_, DriverHost>,
    workdir: String,
    model: String,
    create_dir: bool,
    kind: Option<String>,
    think: Option<String>,
) -> Result<Value, String> {
    let kind = kind.as_deref().unwrap_or("local");
    if !matches!(kind, "local" | "chat") {
        return Err(format!("不支持的会话类型: {kind}"));
    }
    host.get()?
        .session_create_with_kind(&workdir, &model, create_dir, kind, think.as_deref().unwrap_or(""))
        .await
}

#[tauri::command]
pub async fn session_delete(host: State<'_, DriverHost>, id: String) -> Result<Value, String> {
    host.get()?.session_delete(&id).await
}

#[tauri::command]
pub async fn session_patch(host: State<'_, DriverHost>, id: String, patch: Value) -> Result<Value, String> {
    host.get()?.session_patch(&id, patch).await
}

#[tauri::command]
pub async fn models_list(host: State<'_, DriverHost>) -> Result<Value, String> {
    host.get()?.models_list().await
}

/// 本地会话 token 用量统计(按天/会话/模型聚合,usage 事件记账)。
#[tauri::command]
pub async fn usage_stats(host: State<'_, DriverHost>) -> Result<Value, String> {
    Ok(host.get()?.usage_stats())
}

/// 打开会话:返回尾部回放窗口 `{frames, cursor, has_more}`。历史走返回值
/// 而非 `frames:{sid}` 事件——返回值天生有序,不必依赖"监听先于命令"。
#[tauri::command]
pub async fn session_open(host: State<'_, DriverHost>, id: String) -> Result<Value, String> {
    host.get()?.session_open(&id).await
}

/// 往前翻页:cursor 之前的最多 limit 轮,形状对齐云端 mc_task_rounds
/// (`{frames, next_cursor, has_more}`),UI 两条路径共用一套"加载更早"。
#[tauri::command]
pub async fn session_history(
    host: State<'_, DriverHost>,
    id: String,
    cursor: u64,
    limit: usize,
) -> Result<Value, String> {
    host.get()?.session_history(&id, cursor, limit).await
}

/// 回读单帧原文:物化时截断的工具大字段,展开卡片时按 seq 取全文。
#[tauri::command]
pub async fn session_frame(host: State<'_, DriverHost>, id: String, seq: u64) -> Result<Value, String> {
    host.get()?.session_frame(&id, seq).await
}

/// 提问大纲:全量 user-input 条目(含未物化尾巴),条目自带轮起始偏移,
/// UI 点到未加载的早期提问时拿它当 cursor 补历史。
#[tauri::command]
pub async fn session_outline(host: State<'_, DriverHost>, id: String) -> Result<Value, String> {
    host.get()?.session_outline(&id).await
}

#[tauri::command]
pub async fn session_close(host: State<'_, DriverHost>, id: String) -> Result<(), String> {
    if let Ok(e) = host.get() {
        e.session_close(&id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn session_send(
    app: AppHandle,
    host: State<'_, DriverHost>,
    id: String,
    ftype: String,
    payload: Value,
) -> Result<(), String> {
    host.get()?.session_send(&id, &ftype, payload).await?;
    // 装机统计里"用没用"的判据:开出了一轮真实对话,而不是"启动过"。
    // 埋点是策略,只在命令层做——driver 内部只做协议翻译。上行还有审批
    // 应答等其它 ftype,它们不算开轮。
    if ftype == "user-input" {
        crate::telemetry::mark_used(&app);
    }
    Ok(())
}

/// 会话 call 统一入口:repo_* 前缀在命令层分派到壳原生实现(UI 不感知
/// 谁执行),其余交引擎。应答 {result}/{error} 载荷同构。
#[tauri::command]
pub async fn session_call(
    host: State<'_, DriverHost>,
    id: String,
    kind: String,
    payload: Value,
) -> Result<Value, String> {
    let engine = host.get()?;
    if kind.starts_with("repo_") {
        let workdir = engine.session_workdir(&id).await?;
        let ctx = RepoCtx { workdir, wsl_distro: engine.wsl_distro() };
        // git/fs 是阻塞操作,丢 blocking 池;15s 超时防文件面板永久转圈
        let task = tauri::async_runtime::spawn_blocking(move || crate::repo::dispatch(&ctx, &kind, &payload));
        return match tokio::time::timeout(std::time::Duration::from_secs(15), task).await {
            Ok(r) => r.map_err(|e| format!("repo 查询失败: {e}")),
            Err(_) => Err("repo 查询超时(15s)".into()),
        };
    }
    engine.session_call(&id, &kind, payload).await
}

/// 开始分块上传附件(chunk/finish/abort 在 uploads.rs——不需要会话上下文)。
/// 附件大小不设限:单块 4MB 由 UI 控制,内存与单条 IPC 消息都有界。
#[tauri::command]
pub async fn upload_begin(
    host: State<'_, DriverHost>,
    id: String,
    name: String,
    media_type: String,
) -> Result<Value, String> {
    let engine = host.get()?;
    let workdir = engine.session_workdir(&id).await?;
    let distro = engine.wsl_distro();
    tauri::async_runtime::spawn_blocking(move || {
        crate::uploads::begin(&workdir, distro.as_deref(), &name, &media_type)
            .map(|h| serde_json::json!({ "handle": h }))
    })
    .await
    .map_err(|e| format!("上传失败: {e}"))?
}

/// 按源路径把本地文件直拷进会话 uploads 目录(Linux 原生拖拽给真实路径,
/// 内容零穿越 IPC,大小不设限)。
#[tauri::command]
pub async fn upload_file_path(
    host: State<'_, DriverHost>,
    id: String,
    src: String,
) -> Result<Value, String> {
    let engine = host.get()?;
    let workdir = engine.session_workdir(&id).await?;
    let distro = engine.wsl_distro();
    tauri::async_runtime::spawn_blocking(move || {
        crate::uploads::save_from_path(&workdir, distro.as_deref(), &src)
    })
    .await
    .map_err(|e| format!("上传失败: {e}"))?
}

#[tauri::command]
pub async fn upload_read(host: State<'_, DriverHost>, id: String, path: String) -> Result<String, String> {
    let engine = host.get()?;
    let workdir = engine.session_workdir(&id).await?;
    let distro = engine.wsl_distro();
    tauri::async_runtime::spawn_blocking(move || {
        crate::uploads::read_data_url(&workdir, distro.as_deref(), &path)
    })
    .await
    .map_err(|e| format!("读取失败: {e}"))?
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    /// 崩了就重启,退避 1/2/4/8/16s,第 6 次熔断。
    #[test]
    fn backoff_grows_then_trips_the_breaker() {
        let crashed_fast = Duration::from_secs(1);
        let delays: Vec<u64> = (0..ENGINE_MAX_RETRY)
            .map(|n| next_retry(n, crashed_fast).expect("未到上限应继续重试").1.as_secs())
            .collect();
        assert_eq!(delays, vec![1, 2, 4, 8, 16]);
        assert_eq!(next_retry(ENGINE_MAX_RETRY, crashed_fast), None, "用尽即熔断");
    }

    /// 每次重试都要真的递增,否则退避永远停在第一档。
    #[test]
    fn each_retry_consumes_one_attempt() {
        let (next, _) = next_retry(2, Duration::from_secs(1)).unwrap();
        assert_eq!(next, 3);
    }

    /// 稳定期判据:活够久才算"上次重启成功",计数归零重新起算。
    #[test]
    fn a_long_lived_engine_resets_the_retry_budget() {
        let stable = ENGINE_STABLE_UPTIME;
        let (next, delay) = next_retry(4, stable).expect("稳定运行过就不该受旧计数拖累");
        assert_eq!((next, delay.as_secs()), (1, 1), "归零后从头退避");
        // 已经熔断过的计数同样能被一次稳定运行救回来
        assert!(next_retry(ENGINE_MAX_RETRY, stable).is_some());
    }

    /// 这条是整套自愈的命门:起来就崩若被当成"每次都是首次崩溃",
    /// attempt 永远回不到上限,自动重启退化成 1s 一次的死循环。
    #[test]
    fn an_instantly_crashing_engine_still_trips_the_breaker() {
        let mut attempt = 0;
        let mut rounds = 0;
        // 每次刚起来就崩(uptime 远小于稳定期)
        while let Some((next, _)) = next_retry(attempt, Duration::from_millis(200)) {
            attempt = next;
            rounds += 1;
            assert!(rounds <= ENGINE_MAX_RETRY, "必须收敛到熔断,不能无限重试");
        }
        assert_eq!(rounds, ENGINE_MAX_RETRY);
    }

    /// 状态决定关窗语义:崩溃/熔断态不该再假装最小化到托盘。
    #[test]
    fn only_live_phases_keep_the_window_in_the_tray() {
        assert!(EngineStatus::Ready { version: "v".into() }.alive());
        assert!(EngineStatus::Starting { attempt: 1 }.alive());
        assert!(!EngineStatus::Stopped.alive());
        assert!(!EngineStatus::Failed { error: "x".into() }.alive());
        assert!(!EngineStatus::Crashed {
            detail: "x".into(),
            log_tail: String::new(),
            attempt: 1,
            retry_in_ms: Some(1000),
        }
        .alive());
    }

    /// 引擎不在位时的文案由状态派生,退避中与熔断后必须说得不一样——
    /// 一个是"等着就行",一个是"得你动手"。
    #[test]
    fn the_unavailable_reason_distinguishes_retrying_from_given_up() {
        let crashed = |retry_in_ms| EngineStatus::Crashed {
            detail: "崩了".into(),
            log_tail: String::new(),
            attempt: 1,
            retry_in_ms,
        };
        assert!(crashed(Some(1000)).unavailable().contains("正在自动重启"));
        assert!(crashed(None).unavailable().contains("请点顶部横幅重启"));
        assert!(EngineStatus::Failed { error: "找不到二进制".into() }
            .unavailable()
            .contains("找不到二进制"));
    }

    /// 过期实例的死讯不得动到当前引擎——这是"启动超时残留的孤儿进程日后
    /// 咽气"与"重启期间旧引擎自行退出"两条路径共用的闸门。
    #[test]
    fn a_stale_instance_exit_cannot_evict_the_live_engine() {
        let host = DriverHost::new();
        // 不起真进程:take_instance 的判定只看实例号,用状态侧模拟即可
        assert!(host.take_instance(41).is_none(), "空 host 上任何实例都摘不到");
        host.set_status(EngineStatus::Ready { version: "v".into() });
        assert!(
            host.take_instance(41).is_none(),
            "句柄不在位时不得把状态改成 Stopped"
        );
        assert!(host.status().alive(), "状态必须原样保留,交给真正的收尾方处理");
    }

    /// 崩溃摘句柄后,借引擎的命令必须拿到崩溃态的文案而不是通用的"未运行"。
    #[test]
    fn a_crashed_host_reports_the_crash_not_a_generic_error() {
        let host = DriverHost::new();
        host.set_status(EngineStatus::Crashed {
            detail: "崩了".into(),
            log_tail: String::new(),
            attempt: 2,
            retry_in_ms: Some(2000),
        });
        assert!(!host.running(), "崩溃态不算存活");
        let Err(err) = host.get() else { panic!("句柄已摘,不该借得出引擎") };
        assert!(err.contains("自动重启"), "文案应说明壳正在处理: {err}");
    }
}
