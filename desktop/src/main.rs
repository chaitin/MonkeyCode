// MonkeyCode 本地桌面客户端 —— Tauri 壳。
//
// 职责边界:壳持有**应用配置**(模型列表等)与宿主事务(进程生命周期、
// 托盘、桌宠、更新),并承载 UI(ui/ 构建产物随壳分发,frontendDist)。
// 引擎 ohmyagent 是壳拉起的子进程(stdio JSON-RPC,driver/ohmy.rs),
// UI 只经 Tauri IPC 与壳对话。
//
// 生命周期:
//   启动 → 拉起引擎(无配置则零模型模式)→ 主窗口加载内置 UI。
//   设置保存 → 壳物化配置 → 重启引擎 → UI 整页刷新(会话在磁盘,重连自动回放)。
//   关主窗口只隐藏(任务继续跑),托盘"退出"才真正退出并回收引擎。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod baizhi;
mod browser;
mod config;
mod driver;
#[cfg(target_os = "windows")]
mod native_pet;
mod repo;
mod telemetry;
mod uploads;
mod util;
mod wsl;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, StyleMask, WebviewWindowExt as _};

use config::{load_config, materialize_engine_config, save_ui_config_files, DesktopConfig};
use driver::DriverHost;
use crate::util::LockExt;

// macOS 桌宠面板类:普通 NSWindow 被点击会激活应用、把主窗口带到最前;
// NonactivatingPanel 让桌宠保持为不抢焦点的独立面板。hides_on_deactivate 必须关,
// 否则 NSPanel 会在应用失活时自行隐藏,违反桌宠常驻语义。
#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(PetPanel {
        config: {
            can_become_key_window: false,
            can_become_main_window: false,
            is_floating_panel: true,
            hides_on_deactivate: false
        }
    })
}

// ==================== 状态 ====================

/// 托盘是否可用;不可用时关窗直接退出(否则窗口藏起来就找不回了)。
struct TrayReady(AtomicBool);

/// 壳→UI 的待处理意图(如托盘"设置")。事件是发后不管的:webview 未就绪
/// 时监听器不存在,事件静默丢失。意图同时落在这里,UI 启动完成后经
/// take_ui_intent 取走补处理,两路兜底。
struct UiIntent(Mutex<Option<String>>);

/// 桌宠开关的运行时缓存(真值落 config.json)。
struct PetEnabled(AtomicBool);

/// 桌宠位置暂存:Moved 事件在拖动中高频触发,不能逐次写盘;
/// 退出与托盘开关切换时经 persist_pet_prefs 落盘。
struct PetPos(Mutex<Option<(i32, i32)>>);

/// 配置物化/Agent 重启串行锁。设置保存、手动恢复与浏览器配对变化都可能
/// 触发同一事务，必须避免两个 Agent 进程交错启停。
struct EngineApply(Mutex<()>);

/// 浏览器配对变化代次。快速“配对→重置”时只让最后一次状态负责通知 UI；
/// 每次物化仍读取当下配对真值，最终配置不会停在过期状态。
struct BrowserMcpRefresh(AtomicU64);

/// 引擎监督(契约 6):崩溃自愈的簿记。
struct EngineSupervisor {
    /// 已连续用掉的自动重试次数;稳定运行满 ENGINE_STABLE_UPTIME 后由
    /// next_retry 归零。
    attempt: AtomicU32,
    /// 重启代次。人工重启/保存设置会 +1,让在途的退避线程作废——否则用户
    /// 手动救回来之后,几秒前排下的那次自动重启还会再把引擎踹一遍。
    generation: AtomicU64,
    /// 本次引擎就绪的时刻,崩溃时据此算存活时长(稳定期判据)。
    ready_at: Mutex<Option<Instant>>,
}

impl EngineSupervisor {
    fn new() -> Self {
        Self {
            attempt: AtomicU32::new(0),
            generation: AtomicU64::new(0),
            ready_at: Mutex::new(None),
        }
    }
}

/// 托盘图标:彩色透明图形(不走 macOS 模板渲染——模板会抹掉颜色只按
/// alpha 涂黑/白,深色菜单栏下整只猴子被反色成白剪影;彩色图自带绿描边,
/// 明暗菜单栏下轮廓均可辨,无需随主题换图)。
/// macOS 用紧裁版(内容占满画布):tray-icon 0.24.1 把菜单栏图标高度
/// 硬编码 18pt 并按整张画布等比缩放,方形画布的上下透明边会白白吃掉
/// 尺寸;其余平台托盘位是方形槽,继续用方形画布居中版。
fn tray_icon() -> Image<'static> {
    #[cfg(target_os = "macos")]
    return Image::from_bytes(include_bytes!("../icons/tray-mac.png")).expect("托盘图标解码失败");
    #[cfg(not(target_os = "macos"))]
    Image::from_bytes(include_bytes!("../icons/tray.png")).expect("托盘图标解码失败")
}

// ==================== Tauri 命令(UI 调用) ====================

#[tauri::command]
fn get_config(app: AppHandle) -> Result<DesktopConfig, String> {
    load_config(&app)
}

/// 在文件管理器中定位随包分发的浏览器扩展目录(设置页引导用户到
/// chrome://extensions「加载已解压的扩展程序」选它)。返回目录路径。
/// dev 运行(cargo run 无 bundle 资源)回退仓库内 browser-extension/dist。
#[tauri::command]
fn open_extension_dir(app: AppHandle) -> Result<String, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app
        .path()
        .resolve("browser-extension", tauri::path::BaseDirectory::Resource)
    {
        candidates.push(p);
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../browser-extension/dist"));
    let dir = candidates
        .into_iter()
        .find(|p| p.join("manifest.json").is_file())
        .ok_or_else(|| {
            "扩展目录不存在(安装包未包含扩展,或开发环境未构建 browser-extension)".to_string()
        })?;
    tauri_plugin_opener::reveal_item_in_dir(&dir).map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 在文件管理器中定位引擎日志目录(app_config_dir:ohmyagent.log、
/// ohmyagent.log.prev 与崩溃留存 ohmyagent.crash-N.log 都在这)。
/// 启动失败页与设置页共用:引擎起不来时,横幅里的 15 行 tail 往往不够,
/// 得让用户能一步拿到完整日志。
#[tauri::command]
fn open_log_dir(app: AppHandle) -> Result<String, String> {
    let dir = config::config_dir(&app)?;
    tauri_plugin_opener::reveal_item_in_dir(&dir).map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

// ==================== 引擎生命周期(契约 6)====================

/// 生命周期状态的唯一出口:落状态 + 广播。所有转移都必须经它,否则 UI 会
/// 看到一个停在过去的横幅(此前 restart 中途失败就是这样——DriverHost 空了
/// 却没有任何事件,用户只能在下一条命令上撞见"引擎未运行")。
fn publish_engine_status(app: &AppHandle, status: driver::EngineStatus) {
    app.state::<DriverHost>().set_status(status.clone());
    let _ = app.emit("engine-status", status);
}

/// 引擎就位:句柄、状态与稳定期起点三者一起更新。
///
/// 同时把代次 +1 作废在途的退避重试——**只要有引擎活着,排队中的那次重启
/// 就已经没有意义了**。把这条放在这里而不是各个调用点:保存设置与手动重启
/// 会自己 reset,但浏览器配对刷新那条路径不会,而它同样会拉起新引擎;
/// 靠调用点自觉必然漏掉一条,靠"就位"这个事实则天然全覆盖。
///
/// 注意**不重置 attempt**:那由 next_retry 的稳定期判据负责。在这里清零等于
/// 认定"起来了就算成功",而"起来就崩"恰恰是必须能触发熔断的那种故障。
fn adopt_engine(app: &AppHandle, engine: driver::ohmy::OhmyDriver) {
    let status = driver::EngineStatus::Ready { version: engine.version() };
    let sup = app.state::<EngineSupervisor>();
    sup.generation.fetch_add(1, Ordering::SeqCst);
    sup.ready_at.lock_ok().replace(Instant::now());
    app.state::<DriverHost>().set(engine, status.clone());
    let _ = app.emit("engine-status", status);
}

/// 替换当前引擎。调用方须持 EngineApply，且已完成配置提交/物化；阻塞流程
/// 会等待旧引擎优雅退出并等待新引擎 system/ready。
fn restart_engine_locked(app: &AppHandle, config: &DesktopConfig) -> Result<(), String> {
    let old = app.state::<DriverHost>().take();
    // Starting 要盖住**整个**重启窗口,包括旧引擎的优雅退出(最长 grace+3s)。
    // take() 会把状态落回 Stopped,那期间 running() 为假——关主窗口会真退出
    // 而不是最小化,UI 也看不出正在重启。所以先外显再停。
    let attempt = app.state::<EngineSupervisor>().attempt.load(Ordering::SeqCst);
    publish_engine_status(app, driver::EngineStatus::Starting { attempt });
    if let Some(engine) = old {
        engine.stop();
    }
    if let Some(browser) = app.try_state::<browser::BrowserHost>() {
        tauri::async_runtime::block_on(browser.mcp_sessions.reset());
    }
    match driver::start_engine(app, config) {
        Ok(engine) => {
            adopt_engine(app, engine);
            Ok(())
        }
        Err(e) => {
            // 旧引擎已停、新引擎起不来:此刻 DriverHost 是空的。错误虽然会
            // 从命令返回值上抛,但配对刷新那条路径没有调用方接错误,不在这里
            // 外显就等于静默失去引擎且没有恢复入口。
            publish_engine_status(app, driver::EngineStatus::Failed { error: e.clone() });
            Err(e)
        }
    }
}

/// 人工介入(保存设置 / 点重启横幅):作废在途退避并重新起算重试预算。
fn reset_engine_supervision(app: &AppHandle) {
    let sup = app.state::<EngineSupervisor>();
    sup.generation.fetch_add(1, Ordering::SeqCst);
    sup.attempt.store(0, Ordering::SeqCst);
}

/// 引擎进程非 stop() 退出(ShellCtx::on_engine_exit 的壳侧实现)。
/// 摘死句柄 → 按退避决策置状态 → 排下一次自动重启。
pub fn engine_exited(app: &AppHandle, instance: u64, detail: &str, log_tail: &str) {
    // 先摘句柄,且**只摘这一个实例**:留着句柄会让 running() 恒真(关窗只
    // 隐藏,用户以为退出了进程还在),而不认实例则会拿过期引擎的死讯摘掉
    // 当前活引擎。摘不到 = 这条死讯已过期(停机/重启已收过尾,或来自启动
    // 失败后残留的孤儿进程),整条处理都不该继续。
    if app.state::<DriverHost>().take_instance(instance).is_none() {
        eprintln!("[desktop] 忽略过期引擎实例的退出通知: instance={instance}");
        return;
    }
    let sup = app.state::<EngineSupervisor>();
    let uptime = sup.ready_at.lock_ok().take().map(|t| t.elapsed()).unwrap_or_default();
    let decision = driver::next_retry(sup.attempt.load(Ordering::SeqCst), uptime);
    let (attempt, delay) = match decision {
        Some((attempt, delay)) => {
            sup.attempt.store(attempt, Ordering::SeqCst);
            (attempt, Some(delay))
        }
        None => {
            eprintln!("[desktop] 引擎连续崩溃达上限,停止自动重启");
            (sup.attempt.load(Ordering::SeqCst), None)
        }
    };
    // 先外显再排重启:横幅要在退避窗口的第一时间就出现
    publish_engine_status(
        app,
        driver::EngineStatus::Crashed {
            detail: detail.to_string(),
            log_tail: log_tail.to_string(),
            attempt,
            retry_in_ms: delay.map(|d| d.as_millis() as u32),
        },
    );
    if let Some(delay) = delay {
        schedule_engine_retry(app, delay);
    }
}

/// 退避后自动重启。失败与崩溃在退避上同权,继续退避直到熔断。
fn schedule_engine_retry(app: &AppHandle, delay: Duration) {
    let generation = app.state::<EngineSupervisor>().generation.load(Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let stale = || {
            app.state::<EngineSupervisor>().generation.load(Ordering::SeqCst) != generation
        };
        if stale() {
            return; // 期间用户已手动重启/保存设置,这次自动重启作废
        }
        let result = {
            let apply = app.state::<EngineApply>();
            let _apply = apply.0.lock_ok();
            let host = app.state::<DriverHost>();
            let _host_apply = host.begin_apply();
            // 锁到手可能已过去很久(手动重启正持锁),再验一次代次
            if stale() {
                return;
            }
            load_config(&app).and_then(|config| {
                materialize_engine_config(&app, &config, browser::mcp_endpoint(&app))?;
                restart_engine_locked(&app, &config)
            })
        };
        let Err(e) = result else { return }; // 成功:restart_engine_locked 已置 Ready
        if stale() {
            return;
        }
        let sup = app.state::<EngineSupervisor>();
        // 起不来时 uptime 为零,必然递增 attempt,不会卡在同一档退避上
        match driver::next_retry(sup.attempt.load(Ordering::SeqCst), Duration::ZERO) {
            Some((attempt, next)) => {
                sup.attempt.store(attempt, Ordering::SeqCst);
                publish_engine_status(
                    &app,
                    driver::EngineStatus::Crashed {
                        detail: format!("引擎自动重启失败: {e}"),
                        log_tail: String::new(),
                        attempt,
                        retry_in_ms: Some(next.as_millis() as u32),
                    },
                );
                schedule_engine_retry(&app, next);
            }
            // 熔断:restart_engine_locked 已置 Failed,保留那条更具体的错误
            None => eprintln!("[desktop] 引擎自动重启达上限,停止重试: {e}"),
        }
    });
}

/// 配对刷新等待任务空闲的上限。此前是无截止的 250ms 轮询:只要有一个会话
/// 一直在跑,这个线程就转到进程退出。超时即放弃并外显——工具集会在下一次
/// 引擎重启(保存设置 / 设置页手动重启)时自然生效,不需要线程守着。
const BROWSER_MCP_REFRESH_DEADLINE: Duration = Duration::from_secs(600);

/// 扩展首次配对或重置配对后异步刷新 Agent 的 MCP 工具集合。
/// 回调来自桥的 async 任务，不能在其上阻塞数秒等待 Agent 启停。
fn schedule_browser_mcp_refresh(app: &AppHandle) {
    let generation = app
        .state::<BrowserMcpRefresh>()
        .0
        .fetch_add(1, Ordering::SeqCst)
        .wrapping_add(1);
    let app = app.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            if app.state::<BrowserMcpRefresh>().0.load(Ordering::SeqCst) != generation {
                return;
            }
            let apply = app.state::<EngineApply>();
            let _apply = apply.0.lock_ok();
            if app.state::<BrowserMcpRefresh>().0.load(Ordering::SeqCst) != generation {
                return;
            }
            // 自动配对刷新不能中断正在生成的任务。DriverHost 先封住新 IPC
            // lease、排空已进入的命令，再原子检查 running；忙时释放所有锁
            // 后重试，最新 generation 会取消旧刷新线程。
            let host = app.state::<DriverHost>();
            let Some(_host_apply) = host.try_begin_idle_apply() else {
                drop(_apply);
                if started.elapsed() >= BROWSER_MCP_REFRESH_DEADLINE {
                    eprintln!(
                        "[desktop] 浏览器 MCP 工具刷新放弃:等待任务空闲超过 {}s",
                        BROWSER_MCP_REFRESH_DEADLINE.as_secs()
                    );
                    if app.state::<BrowserMcpRefresh>().0.load(Ordering::SeqCst) == generation {
                        let _ = app.emit("browser-mcp-refresh-timeout", ());
                    }
                    return;
                }
                std::thread::sleep(Duration::from_millis(250));
                continue;
            };
            // 必须在取得配置事务锁后再读盘：否则并发的设置保存可能先写入
            // 新值，本线程却拿旧快照随后覆盖回去。
            let result = load_config(&app).and_then(|config| {
                materialize_engine_config(&app, &config, browser::mcp_endpoint(&app))?;
                restart_engine_locked(&app, &config)
            });
            if let Err(e) = result {
                eprintln!("[desktop] 浏览器 MCP 工具刷新失败: {e}");
                return;
            }
            if app.state::<BrowserMcpRefresh>().0.load(Ordering::SeqCst) == generation {
                let _ = app.emit("browser-mcp-reloaded", ());
            }
            return;
        }
    });
}

/// 保存配置并重启引擎。内容不做业务校验(壳零字段知识):表单校验在设置
/// 视图,权威校验在内核。返回后 UI 自行整页刷新(不再有壳侧导航,原
/// WebKitGTK IPC 重放竞态随之消失)。
#[tauri::command]
async fn save_config(app: AppHandle, config: DesktopConfig) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let apply = app.state::<EngineApply>();
        let _apply = apply.0.lock_ok();
        let host = app.state::<DriverHost>();
        let _host_apply = host.begin_apply();
        reset_engine_supervision(&app);
        // 壳自有偏好的合并与写盘在 ConfigStore 的同一事务内完成。
        let config = save_ui_config_files(&app, config, browser::mcp_endpoint(&app))?;
        restart_engine_locked(&app, &config)
    })
    .await
    .map_err(|e| format!("保存失败: {e}"))?
}

/// 按当前配置重启引擎(引擎崩溃/熔断后 UI 一键恢复;engine-status 横幅的出口)。
#[tauri::command]
async fn engine_restart(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let apply = app.state::<EngineApply>();
        let _apply = apply.0.lock_ok();
        let host = app.state::<DriverHost>();
        let _host_apply = host.begin_apply();
        reset_engine_supervision(&app);
        let config = load_config(&app)?;
        materialize_engine_config(&app, &config, browser::mcp_endpoint(&app))?;
        restart_engine_locked(&app, &config)
    })
    .await
    .map_err(|e| format!("重启失败: {e}"))?
}

/// 取走(消费)待处理的壳→UI 意图。UI 两处调用:启动完成后补处理错过的
/// 事件;open-settings 事件处理器里消费掉副本,防止下次整页加载时重放。
#[tauri::command]
fn take_ui_intent(app: AppHandle) -> Option<String> {
    app.state::<UiIntent>().0.lock_ok().take()
}

/// 宿主与内核信息(设置视图"关于"卡片展示)。
#[tauri::command]
fn host_info(app: AppHandle, host: tauri::State<'_, DriverHost>) -> serde_json::Value {
    let engine_version = host.get().ok().map(|engine| engine.version());
    serde_json::json!({
        "version": display_version(&app.package_info().version.to_string()),
        "engine_version": engine_version,
    })
}

/// 无头探针的备用上报通道(仅 MC_DESKTOP_IPC_PROBE 下注册使用):
/// fetch 通道依赖 WebKit 网络进程,其崩溃时经 IPC 落 stderr 仍可观测。
#[tauri::command]
fn probe_log(msg: String) {
    eprintln!("[probe] {msg}");
}

const OPEN_SESSION_INTENT_PREFIX: &str = "open-session:";

/// 桌宠携带的会话 ID 只来自壳内 pet.html；仍在 IPC/原生窗口边界做基本
/// 限长与控制字符过滤，避免异常载荷长期占住 UiIntent。
fn open_session_intent(session_id: &str) -> Option<String> {
    let id = session_id.trim();
    if id.is_empty() || id.len() > 512 || id.chars().any(char::is_control) {
        return None;
    }
    Some(format!("{OPEN_SESSION_INTENT_PREFIX}{id}"))
}

/// 唤回主窗口，并在桌宠当前状态有明确目标时要求主 UI 打开对应会话。
/// 事件负责已就绪页面的实时跳转，UiIntent 负责页面尚未开始监听时的兜底。
fn show_main_session(app: &AppHandle, session_id: Option<&str>) {
    let target = session_id.and_then(|id| {
        open_session_intent(id).map(|intent| (id.trim().to_string(), intent))
    });
    if let Some((_, intent)) = &target {
        app.state::<UiIntent>()
            .0
            .lock_ok()
            .replace(intent.clone());
    }
    show_any_window(app);
    if let Some((id, _)) = target {
        let _ = app.emit_to("main", "open-session", id);
    }
}

/// 唤回主窗口(桌宠点击)。
#[tauri::command]
fn show_main(app: AppHandle, session_id: Option<String>) {
    show_main_session(&app, session_id.as_deref());
}

/// Windows 隐藏状态页→原生 layered window 的视觉快照。
/// 非 Windows 继续由 pet.html 自己渲染,命令保留为跨平台空操作,
/// 使同一份内置页不需分叉打包。
#[tauri::command]
fn pet_native_render(
    app: AppHandle,
    state: String,
    tone: String,
    text: String,
    session_id: Option<String>,
) {
    #[cfg(target_os = "windows")]
    native_pet::update(&app, &state, &tone, &text, session_id.as_deref());
    #[cfg(not(target_os = "windows"))]
    let _ = (app, state, tone, text, session_id);
}

/// 枚举 WSL 发行版(设置视图"运行环境"下拉用)。
/// 非 Windows、未装 WSL 或任何失败均返回空数组,UI 据此隐藏 WSL 选项。
#[tauri::command]
fn list_wsl_distros() -> Vec<String> {
    wsl::list_distros()
}

/// UI 内检查更新:返回结果而非弹对话框(设置视图内联展示)。
#[tauri::command]
async fn update_check(app: AppHandle) -> Result<serde_json::Value, String> {
    let updater = build_updater(&app)?;
    match updater.check().await {
        Ok(Some(u)) => Ok(serde_json::json!({
            "available": true,
            "current": display_version(&u.current_version),
            "latest": display_version(&u.version),
        })),
        Ok(None) => Ok(serde_json::json!({
            "available": false,
            "current": display_version(&app.package_info().version.to_string()),
        })),
        Err(e) => Err(format!("检查更新失败: {e}")),
    }
}

/// UI 内下载安装更新并重启(update_check 确认有新版后调用)。
#[tauri::command]
async fn update_install(app: AppHandle) -> Result<(), String> {
    let updater = build_updater(&app)?;
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => return Err("当前已是最新版本".into()),
        Err(e) => return Err(format!("检查更新失败: {e}")),
    };
    eprintln!("[desktop] 更新: UI 内触发下载安装 {}", update.version);
    update
        .download_and_install(|_, _| {}, || eprintln!("[desktop] 更新: 下载完成,安装中"))
        .await
        .map_err(|e| format!("更新失败: {e}"))?;
    eprintln!("[desktop] 更新: 安装完成,重启应用");
    app.restart();
}

// ==================== 自动更新 ====================
//
// OSS 静态清单(latest.json)+ tauri-plugin-updater:远端版本高于本地才提示
// (YYMMDDNN 日期序号占 semver 主版本位,使用插件默认 SemVer 大小比较);
// 用户确认后下载安装并重启,minisign 签名校验完整性。

/// 展示用短版本号:去掉内部 semver 的 ".0.0" 后缀(26071401.0.0 → 26071401)。
pub(crate) fn display_version(v: &str) -> String {
    v.strip_suffix(".0.0").unwrap_or(v).to_string()
}

/// 更新流程中的提示。只服务托盘的手动检查——用户点了就得有回音,"已是最新"
/// 也要弹。曾有个 manual 开关用来让自动检查静默,自动检查移到 UI 侧之后这个
/// 分支恒真,留着就是死参数。UI 侧的静默检查走 update_check 命令,不经这里。
fn update_notice(app: &AppHandle, error: bool, msg: &str) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    eprintln!("[desktop] 更新: {msg}");
    let kind = if error {
        MessageDialogKind::Error
    } else {
        MessageDialogKind::Info
    };
    app.dialog()
        .message(msg)
        .title("检查更新")
        .kind(kind)
        .show(|_| {});
}

/// 本机运行形态是否支持自更新。
///
/// Linux 上 updater 的安装方式是**原地覆盖当前 AppImage 文件**
/// (tauri-plugin-updater::install_appimage)。deb/rpm 装出来的是 /usr/bin 下的
/// 普通可执行文件:覆盖它既越权(要 root)又会把包管理器的记录搞乱——这两种
/// 分发形态本就该由 apt/dnf 升级。所以非 AppImage 运行时直接不提供更新,
/// 而不是让用户点了"更新"再收一个权限错误。
/// 其它平台恒为支持(.app / NSIS 安装器都有对应安装路径)。
fn updater_supported(app: &AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    {
        return app.env().appimage.is_some();
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        true
    }
}

/// 组装更新器(自动/手动/UI 内三条路径共用):仅升级 + 清单地址可覆盖。
/// update_check / update_install / check_update 三个入口都经此收口,
/// 运行形态守卫因此只需放这一处。
fn build_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    if !updater_supported(app) {
        return Err("当前安装方式(deb/rpm)由系统包管理器升级,应用内不提供自动更新;\
                    AppImage 版本支持一键更新"
            .into());
    }
    let handle = app.clone();
    let mut builder = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        // Windows 安装器路径由插件直接退进程(不走 RunEvent::Exit),
        // 必须先在这里回收引擎进程,否则 ohmyagent.exe 占用文件导致 NSIS 安装失败
        .on_before_exit(move || {
            if let Some(engine) = handle.state::<DriverHost>().take() {
                engine.stop();
            }
        });
    // 本机测试覆盖清单地址(release 构建强制 https,http 清单只在 debug 下可用)
    if let Ok(url) = std::env::var("MC_UPDATE_MANIFEST") {
        let u = url
            .parse()
            .map_err(|e| format!("MC_UPDATE_MANIFEST 无效: {e}"))?;
        builder = builder
            .endpoints(vec![u])
            .map_err(|e| format!("更新地址无效: {e}"))?;
    }
    builder
        .build()
        .map_err(|e| format!("初始化更新器失败: {e}"))
}

/// 托盘「检查更新」:查到新版就询问用户,确认则下载安装 + 重启(内核经
/// RunEvent::Exit 回收)。自动检查不走这里,见 setup 里那段说明。
async fn check_update(app: AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

    let updater = match build_updater(&app) {
        Ok(u) => u,
        Err(e) => return update_notice(&app, true, &e),
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            let cur = display_version(&app.package_info().version.to_string());
            return update_notice(&app, false, &format!("当前已是最新版本({cur})"));
        }
        Err(e) => return update_notice(&app, true, &format!("检查更新失败: {e}")),
    };

    let msg = format!(
        "发现新版本 {}(当前 {}),是否立即更新?\n更新完成后应用将自动重启。",
        display_version(&update.version),
        display_version(&update.current_version),
    );
    eprintln!(
        "[desktop] 更新: 发现新版本 {}(当前 {})",
        update.version, update.current_version
    );
    app.dialog()
        .message(msg)
        .title("发现新版本")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "立即更新".into(),
            "以后再说".into(),
        ))
        .show({
            let app = app.clone();
            move |confirmed| {
                if !confirmed {
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    let mut announced = false;
                    let result = update
                        .download_and_install(
                            move |_chunk, total| {
                                if !announced {
                                    eprintln!("[desktop] 更新: 开始下载({total:?} 字节)");
                                    announced = true;
                                }
                            },
                            || eprintln!("[desktop] 更新: 下载完成,安装中"),
                        )
                        .await;
                    match result {
                        Ok(()) => {
                            eprintln!("[desktop] 更新: 安装完成,重启应用");
                            app.restart();
                        }
                        // 用户已确认过更新,失败必须外显
                        Err(e) => update_notice(&app, true, &format!("更新失败: {e}")),
                    }
                });
            }
        });
}

// ==================== 窗口 ====================

/// 允许 webview 停留的内部地址:壳内置页面(app://tauri 协议)。
/// 其余导航(对话里的外部链接等)一律拒绝并交系统浏览器。
fn is_internal_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        // Windows 下 Tauri app 页面以 http(s)://tauri.localhost 承载
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost")),
        _ => false,
    }
}

/// 创建主窗口并加载壳内置页面(page 如 "index.html" / "error.html#msg")。
fn create_main_window(app: &AppHandle, page: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let opener = app.clone();
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(page.into()))
        .title("MonkeyCode")
        .inner_size(1200.0, 800.0)
        // 布局下限:设置视图(168px 导航 + 内容列 + 保存条)在极窄窗口下
        // 保存按钮会被挤出可视区
        .min_inner_size(640.0, 480.0)
        // Tauri 默认的原生拖放处理器会在窗口层吞掉文件拖拽,HTML5 的
        // drag/drop 事件到不了页面(对话区拖入图片/文件依赖 DOM 事件);
        // 禁用后由 UI 侧统一处理
        .disable_drag_drop_handler()
        // 导航守卫:webview 只许待在壳内置页面;外部链接交系统浏览器,
        // 防止应用被"跳走"后无法返回。UI 侧已拦截点击,这里是兜底。
        .on_navigation(move |url| {
            let internal = is_internal_url(url);
            if !internal {
                use tauri_plugin_opener::OpenerExt;
                let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            }
            internal
        });
    // macOS:标题栏悬浮融入侧栏(红绿灯直接落在 UI 上);
    // UI 侧在 mac 壳内为侧栏顶部预留拖拽区
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    // Windows:去原生装饰栏,UI 侧自绘 36px 标题栏(拖拽区 + 窗口按钮)
    #[cfg(target_os = "windows")]
    {
        builder = builder.decorations(false);
    }
    // 无头冒烟探针:页面加载后自动走一遍 UI→IPC→壳配置 链路,结果经本地
    // 回环上报(无头环境唯一可靠的回读通道)。脚本外置 probe.js:JS 内嵌
    // Rust 字符串需要行续接转义,难读难改;include_str! 编译期内联,行为不变
    if std::env::var("MC_DESKTOP_IPC_PROBE").is_ok() {
        builder = builder.initialization_script(include_str!("probe.js"));
    }
    let _ = builder.build();
}

// ==================== 桌宠 ====================

/// 桌宠窗口尺寸(逻辑像素):气泡(24)+ 吉祥物精灵图(88)的画布。
const PET_W: f64 = 116.0;
const PET_H: f64 = 120.0;

/// 创建非 Windows 桌宠窗口。先隐藏创建以避免定位前在屏幕角落闪现,
/// 定位完成后按用户开关显示,不受主窗口焦点影响。
/// focusable(false):桌宠是状态外显不是交互主体,永不抢焦点;
/// 鼠标点击与拖动不依赖键盘焦点,不受影响。
#[cfg(not(target_os = "windows"))]
fn ensure_pet_window(app: &AppHandle) {
    if app.get_webview_window("pet").is_some() {
        return;
    }
    let saved = *app
        .state::<PetPos>()
        .0
        .lock_ok();
    let win = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("pet.html".into()))
        .title("MonkeyCode 桌宠")
        .inner_size(PET_W, PET_H)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build();
    match win {
        Ok(win) => {
            let _ = win.set_position(pet_position(app, saved));
            // macOS:转 NonactivatingPanel(见文件头 PetPanel 注释);
            // 无边框样式保持与 decorations(false) 一致
            #[cfg(target_os = "macos")]
            match win.to_panel::<PetPanel>() {
                Ok(panel) => {
                    panel.set_style_mask(
                        StyleMask::empty().borderless().nonactivating_panel().into(),
                    );
                }
                Err(e) => eprintln!("[desktop] 桌宠转 NSPanel 失败(点击会激活应用): {e}"),
            }
            set_pet_visible(app, true);
        }
        Err(e) => eprintln!("[desktop] 桌宠窗口创建失败: {e}"),
    }
}

/// Windows 可见桌宠不创建 WebView/Tao Window:后者窗口类带 CS_OWNDC,
/// 与 WS_EX_LAYERED 不兼容。native_pet 自建 Win32 popup 并用
/// UpdateLayeredWindow 绘制,避开黑底、Win7 标题栏和 WebView2 白边。
/// pet-service 始终隐藏,只复用成熟的会话聚合与 MP3 音效逻辑。
#[cfg(target_os = "windows")]
fn ensure_pet_window(app: &AppHandle) {
    if native_pet::exists(app) {
        return;
    }
    let saved = *app
        .state::<PetPos>()
        .0
        .lock_ok();
    let position = pet_position(app, saved);
    let scale = app
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .find(|m| {
            let p = m.position();
            let s = m.size();
            position.x >= p.x
                && position.x < p.x + s.width as i32
                && position.y >= p.y
                && position.y < p.y + s.height as i32
        })
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    if let Err(e) = native_pet::create(
        app,
        position.x,
        position.y,
        (PET_W * scale).round() as i32,
        (PET_H * scale).round() as i32,
    ) {
        eprintln!("[desktop] Windows 原生桌宠初始化失败: {e}");
        return;
    }

    // 不透明、永不 show:它只是桌宠状态机与音频宿主,
    // 对 Win7 的 WebView2 透明限制零依赖。
    if let Err(e) =
        WebviewWindowBuilder::new(app, "pet-service", WebviewUrl::App("pet.html".into()))
            .title("MonkeyCode 桌宠状态服务")
            .inner_size(1.0, 1.0)
            .decorations(false)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(false)
            .focusable(false)
            .focused(false)
            .visible(false)
            .build()
    {
        eprintln!("[desktop] 桌宠状态服务创建失败: {e}");
    }
    set_pet_visible(app, true);
}

/// 桌宠位置:记忆位置仍落在任一显示器内则沿用(显示器可能被拔掉),
/// 否则回主显示器右下角留边(避开任务栏)。
fn pet_position(app: &AppHandle, saved: Option<(i32, i32)>) -> tauri::PhysicalPosition<i32> {
    if let Some((x, y)) = saved {
        let on_screen = app
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .any(|m| {
                let p = m.position();
                let s = m.size();
                x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
            });
        if on_screen {
            return tauri::PhysicalPosition::new(x, y);
        }
    }
    let (mx, my, mw, mh, scale) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            (
                m.position().x,
                m.position().y,
                m.size().width as i32,
                m.size().height as i32,
                m.scale_factor(),
            )
        })
        .unwrap_or((0, 0, 1280, 800, 1.0));
    let w = (PET_W * scale) as i32;
    let h = (PET_H * scale) as i32;
    let margin = (24.0 * scale) as i32;
    let taskbar = (56.0 * scale) as i32;
    tauri::PhysicalPosition::new(mx + mw - w - margin, my + mh - h - margin - taskbar)
}

/// 按用户开关显示/隐藏桌宠。引擎不可用时桌宠自己展示离线状态;
/// 主窗口是否在前台不参与可见性决策。
#[cfg(target_os = "windows")]
fn set_pet_visible(app: &AppHandle, show: bool) {
    let enabled = app.state::<PetEnabled>().0.load(Ordering::Relaxed);
    native_pet::set_visible(app, show && enabled);
}

#[cfg(not(target_os = "windows"))]
fn set_pet_visible(app: &AppHandle, show: bool) {
    let pet = app.get_webview_window("pet");
    let Some(pet) = pet else {
        return;
    };
    if !show {
        let _ = pet.hide();
        return;
    }
    let enabled = app.state::<PetEnabled>().0.load(Ordering::Relaxed);
    if enabled {
        let _ = pet.show();
    }
}

/// 桌宠偏好落盘:以磁盘配置为基础只覆写壳自有字段,只写权威 config.json
/// (不触发引擎配置物化——含密钥的派生文件不该被无关操作反复重写)。
fn persist_pet_prefs(app: &AppHandle) {
    let enabled = app.state::<PetEnabled>().0.load(Ordering::Relaxed);
    #[cfg(target_os = "windows")]
    let pos = native_pet::position(app);
    #[cfg(not(target_os = "windows"))]
    let pos = *app.state::<PetPos>().0.lock_ok();
    if let Err(e) = config::update_config_json(app, |cfg| {
        cfg.pet_enabled = enabled;
        if let Some(pos) = pos {
            cfg.pet_pos = Some(pos);
        }
    }) {
        eprintln!("[desktop] 桌宠偏好保存失败: {e}");
    }
}

fn main() {
    eprintln!("[desktop] main 进入");
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    // 桌宠 NSPanel 转换(ensure_pet_window)依赖此插件注册的面板管理状态
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    #[cfg(target_os = "windows")]
    let builder = builder.manage(native_pet::NativePetHost::new());
    builder
        .manage(config::ConfigStore::new())
        .manage(DriverHost::new())
        .manage(TrayReady(AtomicBool::new(true)))
        .manage(UiIntent(Mutex::new(None)))
        .manage(PetEnabled(AtomicBool::new(true)))
        .manage(PetPos(Mutex::new(None)))
        .manage(EngineApply(Mutex::new(())))
        .manage(BrowserMcpRefresh(AtomicU64::new(0)))
        .manage(EngineSupervisor::new())
        .manage(baizhi::monkeycode::CloudPipes::new())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            take_ui_intent,
            host_info,
            show_main,
            pet_native_render,
            update_check,
            update_install,
            open_extension_dir,
            open_log_dir,
            list_wsl_distros,
            engine_restart,
            probe_log,
            driver::engine_status,
            driver::engine_caps,
            browser::browser_status,
            browser::browser_repair,
            driver::sessions_list,
            driver::session_create,
            driver::session_delete,
            driver::session_patch,
            driver::models_list,
            driver::session_open,
            driver::session_history,
            driver::session_outline,
            driver::session_frame,
            driver::session_close,
            driver::session_send,
            driver::session_call,
            driver::upload_file,
            driver::upload_read,
            baizhi::baizhi_status,
            baizhi::baizhi_send_code,
            baizhi::baizhi_login,
            baizhi::baizhi_logout,
            baizhi::baizhi_wechat_start,
            baizhi::baizhi_wechat_poll,
            baizhi::baizhi_sync,
            baizhi::mc_status,
            baizhi::mc_login,
            baizhi::mc_logout,
            baizhi::mc_tasks,
            baizhi::mc_projects,
            baizhi::mc_task_info,
            baizhi::mc_task_rounds,
            baizhi::mc_task_stop,
            baizhi::mc_task_delete,
            baizhi::mc_task_create,
            baizhi::mc_task_options,
            baizhi::monkeycode::cloud_ws_open,
            baizhi::monkeycode::cloud_ws_send,
            baizhi::monkeycode::cloud_ws_close
        ])
        .setup(|app| {
            // 百智云/云端服务(壳级单例;凭证 cookie 与配置同目录)
            let cfg_dir = config::config_dir(app.handle()).map_err(std::io::Error::other)?;
            app.manage(baizhi::BaizhiState(std::sync::Arc::new(
                baizhi::Service::new(cfg_dir),
            )));

            // 配置损坏且无有效备份时绝不能按默认值继续并覆写；仍创建错误页
            // 让用户看见可行动诊断。托盘/桌宠只使用内存中的安全默认值。
            let (cfg, config_error) = match load_config(app.handle()) {
                Ok(cfg) => (cfg, None),
                Err(e) => (DesktopConfig::default(), Some(e)),
            };
            app.state::<PetEnabled>()
                .0
                .store(cfg.pet_enabled, Ordering::Relaxed);
            *app.state::<PetPos>()
                .0
                .lock_ok() = cfg.pet_pos;

            // 托盘失败只降级(无托盘宿主的桌面环境),不阻塞
            if let Err(e) = setup_tray(app.handle(), cfg.pet_enabled) {
                eprintln!("[desktop] 托盘创建失败(关窗将直接退出): {e}");
                app.state::<TrayReady>().0.store(false, Ordering::Relaxed);
            }

            // 装机/使用统计心跳。端点未注入(默认)或用户在托盘关掉则空转。
            telemetry::start(app.handle());

            // 自动检查更新整条收在 UI 侧(ui/src/App.tsx + updateGate.ts):挂载、
            // 切回前台、4 小时兜底三个触发点共用一道 30 分钟闸门,发现新版点亮
            // 侧栏徽标与横幅。这里曾经还有一条"启动后 5 秒自检 + 弹对话框"的
            // 并行路径,与 UI 那次在启动瞬间各打一遍更新端点,且弹窗与横幅重复;
            // 唯一去处是托盘的「检查更新」——那条仍在(见 check_update)。
            // 联调仍走 MC_UPDATE_MANIFEST:它在 build_updater 里覆盖清单地址,
            // 对托盘手动检查与 UI 的 update_check 命令同样生效。

            if let Some(e) = config_error {
                eprintln!("[desktop] 配置加载失败: {e}");
                create_main_window(app.handle(), &format!("error.html#{}", util::urlencode(&e)));
                ensure_pet_window(app.handle());
                return Ok(());
            }

            // 无模型配置时引擎以零模型模式启动，首启向导由 UI 承担。
            // 浏览器桥 + MCP server 先于引擎:配置物化要写入 MCP URL/token,
            // init 后查询一次显式传参(时序依赖由数据流表达,不靠注释约束)
            browser::init(app.handle());
            if let Err(e) =
                materialize_engine_config(app.handle(), &cfg, browser::mcp_endpoint(app.handle()))
            {
                eprintln!("[desktop] 引擎配置物化失败: {e}");
                create_main_window(app.handle(), &format!("error.html#{}", util::urlencode(&e)));
                ensure_pet_window(app.handle());
                return Ok(());
            }
            publish_engine_status(app.handle(), driver::EngineStatus::Starting { attempt: 0 });
            match driver::start_engine(app.handle(), &cfg) {
                Ok(engine) => {
                    adopt_engine(app.handle(), engine);
                    create_main_window(app.handle(), "index.html");
                }
                Err(e) => {
                    eprintln!("[desktop] 引擎启动失败: {e}");
                    publish_engine_status(
                        app.handle(),
                        driver::EngineStatus::Failed { error: e.clone() },
                    );
                    create_main_window(
                        app.handle(),
                        &format!("error.html#{}", util::urlencode(&e)),
                    );
                }
            }
            // 桌宠是独立常驻面板:主窗口的焦点/可见性和引擎在线状态
            // 都不影响它出现;只有用户在托盘菜单关掉"显示桌宠"才隐藏。
            ensure_pet_window(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // 桌宠拖动:位置暂存,退出/开关切换时落盘(Moved 高频,不逐次写)
            if let WindowEvent::Moved(pos) = event {
                if window.label() == "pet" {
                    window
                        .app_handle()
                        .state::<PetPos>()
                        .0
                        .lock_ok()
                        .replace((pos.x, pos.y));
                }
            }
            // 主窗口:引擎在跑且托盘可用时关窗只隐藏(任务继续跑);引擎不在位
            // (崩溃/退避中/启动失败)则放行销毁——那时没有任务要护着,留一个
            // 隐藏的陈旧页面反而挡住重建。**注意关窗不等于退出进程**:
            // ExitRequested 在托盘可用时一律 prevent_exit,所以销毁后必须能重建,
            // 由 show_any_window 负责(否则托盘里剩个叫不出来的应用)
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let app = window.app_handle();
                let engine_running = app.state::<DriverHost>().running();
                let tray_ready = app.state::<TrayReady>().0.load(Ordering::Relaxed);
                if engine_running && tray_ready {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("启动 Tauri 失败")
        .run(|app, event| match event {
            // 兜底:托盘可用时窗口全部关闭不结束进程(托盘常驻);
            // app.exit() 显式退出或托盘不可用时放行
            RunEvent::ExitRequested { api, code, .. }
                if code.is_none() && app.state::<TrayReady>().0.load(Ordering::Relaxed) =>
            {
                api.prevent_exit();
            }
            RunEvent::Exit => {
                persist_pet_prefs(app); // 拖动位置只在退出/开关切换时落盘
                #[cfg(target_os = "windows")]
                native_pet::shutdown(app);
                if let Some(engine) = app.state::<DriverHost>().take() {
                    engine.stop();
                }
            }
            _ => {}
        });
}

/// 创建托盘:菜单(显示窗口/设置/退出)+ 左键单击恢复窗口。
fn setup_tray(app: &AppHandle, pet_enabled: bool) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let pet = CheckMenuItem::with_id(
        app,
        "toggle-pet",
        "显示桌宠",
        true,
        pet_enabled,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(app, "check-update", "检查更新", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 MonkeyCode", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &pet, &update, &quit])?;
    let tray = TrayIconBuilder::new()
        .icon(tray_icon())
        .tooltip("MonkeyCode")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_any_window(app),
            // 设置在 UI 页内:恢复主窗口后发事件让 React 切到设置视图;
            // 意图同时落待取状态,webview 未就绪丢事件时由 UI 启动后补取
            "settings" => {
                show_any_window(app);
                app.state::<UiIntent>()
                    .0
                    .lock_ok()
                    .replace("open-settings".into());
                let _ = app.emit_to("main", "open-settings", ());
            }
            // 桌宠开关:CheckMenuItem 点击自翻勾选态,这里同步运行时缓存、
            // 立即更新可见性并落盘。
            "toggle-pet" => {
                let enabled = !app.state::<PetEnabled>().0.load(Ordering::Relaxed);
                app.state::<PetEnabled>()
                    .0
                    .store(enabled, Ordering::Relaxed);
                persist_pet_prefs(app);
                set_pet_visible(app, enabled);
            }
            "check-update" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { check_update(app).await });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_any_window(tray.app_handle());
            }
        });
    // 托盘句柄由 Tauri 内部登记持有(tray_by_id 可取),无需自存
    tray.build(app)?;
    Ok(())
}

/// 恢复主窗口。
/// 唤回主窗口;**窗口已被销毁则重建**。
///
/// 只 show 不重建会留下一个叫不出来的应用:`ExitRequested` 在托盘可用时一律
/// `prevent_exit`,所以"关窗"从来不等于"退出进程"——只要有一条路径让
/// CloseRequested 不走隐藏(引擎未在位时就是如此:崩溃/退避中/启动失败),
/// 窗口就真的没了,而托盘的三个入口(左键、显示窗口、设置)全走这里,
/// 于是只剩"退出"一个可用菜单项。
fn show_any_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        // 重建一律回 index.html:启动失败页是一次性的,重来时该给正常 UI
        // (引擎仍不可用的话,横幅会按 engine_status 如实渲染)
        create_main_window(app, "index.html");
        return;
    };
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
}

#[cfg(test)]
mod ui_intent_tests {
    use super::open_session_intent;

    #[test]
    fn session_intent_accepts_normal_id_and_rejects_invalid_input() {
        assert_eq!(
            open_session_intent(" session-1 ").as_deref(),
            Some("open-session:session-1")
        );
        assert!(open_session_intent("").is_none());
        assert!(open_session_intent("bad\nid").is_none());
        assert!(open_session_intent(&"x".repeat(513)).is_none());
    }
}
