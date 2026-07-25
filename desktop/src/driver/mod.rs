// 引擎驱动层:UI 只经 Tauri IPC 与壳对话,壳适配 ohmyagent 内核(stdio)。
//
// 下行帧统一走 Tauri 事件(UI 按会话订阅 `frames:{sid}`,帧为 Frame
// 词汇——引擎事件在 driver 内归一化,reduce 层零改动):
//   frames:{sid}       Frame[](~30ms 批量,防高频 delta 拖垮 IPC)
//   conn-status:{sid}  {text, connected} 会话流连接状态
//   session-event      {type: session-status|session-ask, ...} 全局状态(侧栏+桌宠)
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

use ohmy::OhmyDriver;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::config::DesktopConfig;
use crate::repo::RepoCtx;
use crate::util::LockExt;

/// 当前引擎(壳生命周期内至多一个;保存设置时整体替换)。命令通过 lease
/// 使用克隆句柄；维护事务先关闭新 lease，再等已有 IPC 调用退出。
pub struct DriverHost {
    state: Mutex<DriverHostState>,
    idle: Condvar,
}

struct DriverHostState {
    engine: Option<OhmyDriver>,
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
            state: Mutex::new(DriverHostState { engine: None, applying: false, leases: 0 }),
            idle: Condvar::new(),
        }
    }

    pub fn get(&self) -> Result<DriverLease<'_>, String> {
        let mut state = self.state.lock_ok();
        if state.applying { return Err("引擎配置正在应用，请稍后重试".into()); }
        let engine = state.engine.clone().ok_or_else(|| "引擎未运行".to_string())?;
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

    pub fn running(&self) -> bool {
        self.state.lock_ok().engine.is_some()
    }

    pub fn set(&self, e: OhmyDriver) {
        self.state.lock_ok().engine = Some(e);
    }

    pub fn take(&self) -> Option<OhmyDriver> {
        self.state.lock_ok().engine.take()
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
    Caps {
        browser_ext,
        usage_update: engine.has_capability("turn/stopped"),
        perm_remember: engine.has_capability("permissionRemember"),
        // 上传/路径注入由壳实现，不是引擎握手项。
        attachments: true,
    }
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

#[tauri::command]
pub async fn engine_caps(app: AppHandle, host: State<'_, DriverHost>) -> Result<Caps, String> {
    let engine = host.get()?;
    let browser_ext = app.try_state::<crate::browser::BrowserHost>().is_some();
    Ok(caps(&engine, browser_ext))
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
) -> Result<Value, String> {
    let kind = kind.as_deref().unwrap_or("local");
    if !matches!(kind, "local" | "chat") {
        return Err(format!("不支持的会话类型: {kind}"));
    }
    host.get()?.session_create_with_kind(&workdir, &model, create_dir, kind).await
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
    host: State<'_, DriverHost>,
    id: String,
    ftype: String,
    payload: Value,
) -> Result<(), String> {
    host.get()?.session_send(&id, &ftype, payload).await
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
        // wsl_distro 待 M3(ohmy WSL 模式)接回
        let ctx = RepoCtx { workdir, wsl_distro: None };
        // git/fs 是阻塞操作,丢 blocking 池;15s 超时防文件面板永久转圈
        let task = tauri::async_runtime::spawn_blocking(move || crate::repo::dispatch(&ctx, &kind, &payload));
        return match tokio::time::timeout(std::time::Duration::from_secs(15), task).await {
            Ok(r) => r.map_err(|e| format!("repo 查询失败: {e}")),
            Err(_) => Err("repo 查询超时(15s)".into()),
        };
    }
    engine.session_call(&id, &kind, payload).await
}

#[tauri::command]
pub async fn upload_file(
    host: State<'_, DriverHost>,
    id: String,
    name: String,
    media_type: String,
    data: String,
) -> Result<Value, String> {
    let engine = host.get()?;
    let workdir = engine.session_workdir(&id).await?;
    tauri::async_runtime::spawn_blocking(move || crate::uploads::save(&workdir, None, &name, &media_type, &data))
        .await
        .map_err(|e| format!("上传失败: {e}"))?
}

#[tauri::command]
pub async fn upload_read(host: State<'_, DriverHost>, id: String, path: String) -> Result<String, String> {
    let engine = host.get()?;
    let workdir = engine.session_workdir(&id).await?;
    tauri::async_runtime::spawn_blocking(move || crate::uploads::read_data_url(&workdir, None, &path))
        .await
        .map_err(|e| format!("读取失败: {e}"))?
}
