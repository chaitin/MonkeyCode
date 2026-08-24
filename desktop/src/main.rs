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

mod background;
mod baizhi;
mod browser;
mod config;
mod driver;
#[cfg(target_os = "windows")]
mod native_pet;
mod repo;
mod skills;
mod telemetry;
mod todos;
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
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};
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

/// 事件提示音开关的运行时缓存(真值落 config.json)。音效由桌宠页 pet.html
/// 播放,开关由设置页与托盘两处切换,故运行时真值收在壳里,变更经
/// `sound-enabled` 事件广播给两个 webview。
struct SoundEnabled(AtomicBool);

/// 托盘的提示音勾选项。设置页切换时要把托盘勾选态改过来,否则两处显示会打架;
/// 托盘创建失败(无托盘宿主)时为 None,设置页照常工作。
struct TraySoundItem(Mutex<Option<CheckMenuItem<tauri::Wry>>>);

/// 桌宠位置暂存:Moved 事件在拖动中高频触发,不能逐次写盘;
/// 退出与托盘开关切换时经 persist_pet_prefs 落盘。
struct PetPos(Mutex<Option<(i32, i32)>>);

struct MainWindowRuntime(Mutex<Option<config::MainWindowState>>);

#[derive(Clone, Copy)]
struct MainWindowRestore {
    bounds: Option<config::MainWindowState>,
    maximized: bool,
}

#[derive(Clone, Copy)]
struct DisplayArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

impl From<&tauri::window::Monitor> for DisplayArea {
    fn from(monitor: &tauri::window::Monitor) -> Self {
        let work_area = monitor.work_area();
        Self {
            x: work_area.position.x,
            y: work_area.position.y,
            width: work_area.size.width,
            height: work_area.size.height,
            scale_factor: monitor.scale_factor(),
        }
    }
}

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

/// 在文件管理器中定位**程序本体**(关于页的隐藏排障入口)。
///
/// 这里刻意用 reveal(父目录里选中)而不是 open:macOS 的 .app 是个"目录",
/// open 它等于**再启动一次应用**;Windows/Linux 上目标是可执行文件,open
/// 同样是执行它。要的是"看见它在哪",所以是选中而非打开。
/// macOS 的可执行文件埋在 <应用>.app/Contents/MacOS/ 里,直接选中它等于把
/// 用户丢进包内部——往上找到 .app 那一层选中应用本体(开发构建没有 .app
/// 祖先,自然回落到可执行文件)。
#[tauri::command]
fn open_app_dir() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法定位程序路径: {e}"))?;
    let target = exe
        .ancestors()
        .find(|p| p.extension().and_then(|s| s.to_str()) == Some("app"))
        .unwrap_or(exe.as_path());
    tauri_plugin_opener::reveal_item_in_dir(target).map_err(|e| format!("定位程序失败: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

/// 在文件管理器中定位应用存储目录(app_config_dir)。这里同时是引擎日志的
/// 落点(ohmyagent.log[.prev]、崩溃留存 ohmyagent.crash-N.log,以及引擎自己
/// 按运行分文件写的 ohmyagent/logs/*.log)与配置/会话/cookie 的家,所以
/// 引擎横幅的「打开日志目录」与关于页的「打开存储目录」是同一处、同一命令。
/// 引擎起不来时横幅里的 15 行 tail 往往不够,得让用户一步拿到完整现场。
#[tauri::command]
fn open_log_dir(app: AppHandle) -> Result<String, String> {
    let dir = config::config_dir(&app)?;
    // open_path 而非 reveal_item_in_dir:reveal 的语义是「在**父目录**里选中
    // 该项」,对目录就是停在 Application Support 里高亮一个文件夹,用户还得
    // 自己双击进去(2026-08-07 用户报障)。这里要的是直接进到目录内
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 导出引擎最新日志:保存对话框另存一份 ohmyagent.log(引擎 stderr 全量)。
/// 横幅/侧栏卡里的 15 行 tail 不够排查时,用户从设置页一键拿到完整现场当
/// 报障附件。async:blocking_save_file 不能占主线程。用户取消返回 None。
#[tauri::command]
async fn export_engine_log(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let cfg_dir = config::config_dir(&app)?;
    // 引擎自己的运行日志优先,壳接的 stderr 只是兜底(driver::engine_log_file)
    let Some(src) = driver::engine_log_file(&cfg_dir) else {
        return Err("暂无引擎日志(引擎尚未启动过,或本轮运行没有任何输出)".into());
    };
    let file_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("ohmyagent.log")
        .to_string();
    // 起始目录落系统「下载」:不给 set_directory 时,对话框的落点由平台
    // 自行决定(Windows 上是进程 CWD——安装目录,用户根本找不到自己存哪了),
    // 与云端文件下载的 pickSaveFile 同一口径;拿不到目录就交回平台默认
    let mut picker = app.dialog().file().set_file_name(&file_name);
    if let Ok(dir) = app.path().download_dir() {
        picker = picker.set_directory(dir);
    }
    let Some(dest) = picker.blocking_save_file() else {
        return Ok(None);
    };
    let dest = dest
        .into_path()
        .map_err(|e| format!("无效的保存路径: {e}"))?;
    std::fs::copy(&src, &dest).map_err(|e| format!("导出失败: {e}"))?;
    Ok(Some(dest.to_string_lossy().into_owned()))
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

/// 将盘上配置应用到壳侧云 transport，并在真正变化的同一条路径上通知 UI。
/// 通知发生在后续物化/引擎重启之前：即使引擎启动失败，账号和云任务也不会
/// 继续展示旧服务数据。所有配置应用入口都必须经这里，避免遗漏某条恢复路径。
fn apply_cloud_config(app: &AppHandle, config: &DesktopConfig) -> bool {
    let pipes = app.state::<baizhi::monkeycode::CloudPipes>();
    let Some(generation) = app.state::<baizhi::BaizhiState>().apply_config(config, &pipes) else {
        return false;
    };
    if let Err(e) = app.emit("monkeycode-transport-changed", generation) {
        eprintln!("[desktop] 通知 UI 云服务切换失败: {e}");
    }
    true
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
                // 壳侧云端快照跟随盘上权威配置(配置未变时为 no-op):失败的
                // 保存/重启可能留下快照落后于盘的分裂态,自动重启在此自愈。
                apply_cloud_config(&app, &config);
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
                // 同 schedule_engine_retry:壳侧云端快照跟随盘上配置,自愈分裂态。
                apply_cloud_config(&app, &config);
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
        // 配置一旦落盘,壳侧云端服务快照必须先于引擎重启切换:apply_config
        // 是纯内存操作不会失败,而 restart_engine_locked 失败会早退——若快照
        // 切换排在其后,失败路径会留下「盘上/引擎是新地址、壳侧云端打旧地址」
        // 的分裂态,且两条自动恢复路径都不会替本命令收这个尾。
        apply_cloud_config(&app, &config);
        restart_engine_locked(&app, &config)?;
        Ok(())
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
        // 快照切换先于重启,理由同 save_config;此处配置未变时是纯 no-op,
        // 但能自愈此前失败路径遗留的「壳侧快照落后于盘上配置」分裂态。
        apply_cloud_config(&app, &config);
        materialize_engine_config(&app, &config, browser::mcp_endpoint(&app))?;
        restart_engine_locked(&app, &config)?;
        Ok(())
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

/// 排障入口:壳内右键改自绘菜单后不再暴露"检查元素",devtools 由 UI 侧
/// 快捷键(F12 / Ctrl|Cmd+Shift+I)经此命令打开;能力依赖 Cargo 的
/// devtools feature,release 包保留。
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// Windows 窗体系统菜单(移动/大小/最小化/最大化/关闭)。壳在 Windows 走
/// decorations(false),原生标题栏连同它的右键菜单一起没了;UI 侧窗框条的
/// 右键与左端应用图标点击都落到这儿,把菜单补回来(Win95 起的老规矩,
/// VS Code / Windows Terminal 至今保留)。
///
/// 为什么不走 WM_NCHITTEST/HTSYSMENU 让系统自己弹:WebView2 子窗口铺满整个
/// 客户区,非客户区命中测试根本到不了咱们这层。改由 UI 报指针位、壳主动
/// TrackPopupMenu,绕开这件事。
///
/// 弹出位置取**指针的物理屏幕坐标**(Tauri 的 cursor_position),不收 UI 传的
/// clientX/clientY:那是 CSS 像素,在 150% 缩放的屏上要乘 scale 再做客户区→
/// 屏幕换算,两步都能错;而系统菜单本就该弹在指针处,直接问壳最稳。
///
/// TPM_RETURNCMD 让 TrackPopupMenu 同步返回选中项,再 PostMessage 交回窗口
/// 自己执行——不用 SendMessage:那会在菜单的模态消息循环里重入窗口过程。
/// 非 Windows 是空操作(mac 有原生菜单栏;GTK 侧无对等 API,图标纯展示)。
#[tauri::command]
fn window_system_menu(window: tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetSystemMenu, PostMessageW, SetForegroundWindow, TrackPopupMenu, TPM_RETURNCMD,
            TPM_RIGHTBUTTON, WM_SYSCOMMAND,
        };
        let (Ok(hwnd), Ok(pos)) = (window.hwnd(), window.cursor_position()) else {
            return;
        };
        unsafe {
            let menu = GetSystemMenu(hwnd, false);
            if menu.is_invalid() {
                return;
            }
            // 菜单要求窗口在前台,否则点别处不会自动收起(MSDN TrackPopupMenu 注)
            let _ = SetForegroundWindow(hwnd);
            let cmd = TrackPopupMenu(
                menu,
                TPM_RETURNCMD | TPM_RIGHTBUTTON,
                pos.x as i32,
                pos.y as i32,
                Some(0),
                hwnd,
                None,
            );
            // TPM_RETURNCMD 下返回值是命令 id,0 = 用户没选(点空处/Esc)
            if cmd.0 != 0 {
                let _ = PostMessageW(Some(hwnd), WM_SYSCOMMAND, WPARAM(cmd.0 as usize), LPARAM(0));
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
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
        // latest*.json 原地覆盖发布；安装前的二次检查不能复用旧清单。
        .header("Cache-Control", "no-cache, no-store, max-age=0")
        .and_then(|builder| builder.header("Pragma", "no-cache"))
        .map_err(|e| format!("初始化更新请求头失败: {e}"))?
        // Windows 安装器路径由插件直接退进程(不走 RunEvent::Exit),
        // 必须先保存窗口状态并回收引擎进程,否则位置会丢失且
        // ohmyagent.exe 占用文件会导致 NSIS 安装失败。自定义回调会覆盖
        // updater_builder 默认的 Tauri 清理,所以最后还要显式移除托盘等资源。
        .on_before_exit(move || {
            #[cfg(target_os = "windows")]
            persist_main_window_state(&handle);
            if let Some(engine) = handle.state::<DriverHost>().take() {
                engine.stop();
            }
            handle.cleanup_before_exit();
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
        "http" | "https" => {
            // Windows 下 Tauri app 页面以 http(s)://tauri.localhost 承载
            if matches!(url.host_str(), Some("tauri.localhost")) {
                return true;
            }
            // dev 构建:`tauri dev` 的 devUrl 是 http://localhost:<port>(vite),
            // 初始加载同样走本守卫,不放行就是一扇纯白窗口。发布版无 devUrl,
            // 不放行 localhost,守卫语义不变。
            #[cfg(dev)]
            if matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")) {
                return true;
            }
            false
        }
        _ => false,
    }
}

/// dev 前端从磁盘服务:返回 uidist/index.html 引用但磁盘上缺失的第一个
/// 产物名(uidist 路径按编译机源码目录定位,dev 专用;index.html 整体
/// 缺失沿用 tauri 自身报错,不在此重复)。
#[cfg(dev)]
fn frontend_missing_asset() -> Option<String> {
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("uidist");
    let index = std::fs::read_to_string(dist.join("index.html")).ok()?;
    for part in index.split("\"/assets/").skip(1) {
        if let Some(name) = part.split('"').next() {
            if !dist.join("assets").join(name).is_file() {
                return Some(format!("assets/{name}"));
            }
        }
    }
    None
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
    let restored = restorable_main_window_state(app);
    if let Some(state) = restored.and_then(|restore| restore.bounds) {
        builder = builder.inner_size(state.width as f64, state.height as f64);
    }
    builder = builder.visible(false);
    // Windows/macOS:Tauri 原生拖放处理器会在窗口层吞掉文件拖拽,HTML5 的
    // drag/drop 事件到不了页面(对话区拖入图片/文件依赖 DOM 事件),禁用后
    // 由 UI 侧统一处理。Linux 相反:WebKitGTK 在 wry 窗口里的 HTML5 拖拽
    // 拿不到 File 对象(上游缺陷),必须保留原生处理器——UI 侧监听
    // tauri://drag-* 事件取路径,经 read_dropped_file 读盘还原(nativeDrop.ts)
    #[cfg(not(target_os = "linux"))]
    {
        builder = builder.disable_drag_drop_handler();
    }
    // macOS:标题栏悬浮融入内容(Overlay),原生红绿灯在 build 后被
    // hide_native_window_buttons 隐藏,UI 侧自绘 10px 小红绿灯替代
    // (TitleBar::MacWindowControls,App 固定左上角渲染)。自绘版曾于
    // 2026-08-18 退役回原生,2026-08-20 用户「原生太大,能小一点么」再
    // 反转——原生按钮尺寸是系统私有绘制不可调,要小只能藏掉自绘。
    // ⚠️ 别试 traffic_light_position:2.11.5(runtime-wry
    // with_traffic_light_inset)在 Overlay 下实测灯纹丝不动,真机截图为证。
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    // Windows / Linux:去原生装饰栏,UI 侧自绘 32px 扁平窗框条(拖拽区 +
    // caption 三键 + 左端应用图标),见 ui-next 的 TitleBar。
    //
    // Linux 一并走 CSD(2026-08-08):保留原生装饰栏的话,mac/Windows 精心画的
    // 那条窗框在 Linux 上会被换成 Adwaita/Breeze 的条——三端里唯一不受我们
    // 控制的那端恰恰最显眼。VS Code(titleBarStyle 在 Linux 默认 custom)、
    // Slack、Discord、Spotify 一律如此;GNOME 自己的 libadwaita 更是 CSD 优先。
    // 代价:WM 的 resize 边/右键标题菜单/部分平铺手势没了,resize 由 UI 侧
    // 边缘热区经 start_resize_dragging 补回(ResizeEdges.tsx);GNOME 用户若把
    // button-layout 设成靠左,我们仍在右边。
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.decorations(false);
    }
    // 无头冒烟探针:页面加载后自动走一遍 UI→IPC→壳配置 链路,结果经本地
    // 回环上报(无头环境唯一可靠的回读通道)。脚本外置 probe.js:JS 内嵌
    // Rust 字符串需要行续接转义,难读难改;include_str! 编译期内联,行为不变
    if std::env::var("MC_DESKTOP_IPC_PROBE").is_ok() {
        builder = builder.initialization_script(include_str!("probe.js"));
    }
    #[cfg(not(target_os = "macos"))]
    if let Ok(win) = builder.build() {
        finish_main_window_creation(&win, restored);
    }
    #[cfg(target_os = "macos")]
    if let Ok(win) = builder.build() {
        hide_native_window_buttons(&win);
        // AppKit 在全屏往返等时机会重建标题栏视图,原生按钮可能复现;
        // 尺寸/焦点事件上幂等补一次(三次空 objc 调用,开销可忽略)。
        let w = win.clone();
        win.on_window_event(move |e| {
            if matches!(
                e,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_)
            ) {
                hide_native_window_buttons(&w);
            }
        });
        finish_main_window_creation(&win, restored);
    }
}

/// macOS:隐藏原生红绿灯。AppKit 标准窗口按钮的尺寸与间距是系统私有绘制,
/// 公开途径只能整组挪位置;要"更小的红绿灯"只能藏掉原生、UI 自绘替身
/// (跨平台应用的通行做法)。NSWindow 消息须在主线程发。
#[cfg(target_os = "macos")]
fn hide_native_window_buttons(window: &tauri::WebviewWindow) {
    let win = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ns_window) = win.ns_window() else {
            return;
        };
        let ns_window = ns_window as *mut objc2::runtime::AnyObject;
        // NSWindowButton: Close=0 / Miniaturize=1 / Zoom=2
        for kind in 0usize..=2 {
            unsafe {
                let btn: *mut objc2::runtime::AnyObject =
                    objc2::msg_send![ns_window, standardWindowButton: kind];
                if !btn.is_null() {
                    let _: () = objc2::msg_send![btn, setHidden: true];
                }
            }
        }
    });
}

fn finish_main_window_creation(window: &WebviewWindow, restored: Option<MainWindowRestore>) {
    if let Some(restore) = restored {
        if let Some(state) = restore.bounds {
            let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
        }
        if restore.maximized {
            let _ = window.maximize();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn restorable_main_window_state(app: &AppHandle) -> Option<MainWindowRestore> {
    let state = (*app.state::<MainWindowRuntime>().0.lock_ok())?;
    let monitors = app.available_monitors().ok()?;
    let displays: Vec<_> = monitors.iter().map(DisplayArea::from).collect();
    Some(MainWindowRestore {
        bounds: window_state_on_available_display(state, &displays).then_some(state),
        maximized: state.maximized,
    })
}

fn window_state_on_available_display(
    state: config::MainWindowState,
    displays: &[DisplayArea],
) -> bool {
    displays.iter().any(|display| {
        let physical_width = (state.width as f64 * display.scale_factor).round() as i64;
        let physical_height = (state.height as f64 * display.scale_factor).round() as i64;
        let right = state.x as i64 + physical_width;
        let bottom = state.y as i64 + physical_height;
        let display_right = display.x as i64 + display.width as i64;
        let display_bottom = display.y as i64 + display.height as i64;
        (state.x as i64) >= display.x as i64
            && (state.y as i64) >= display.y as i64
            && right <= display_right
            && bottom <= display_bottom
    })
}

fn update_main_window_runtime(app: &AppHandle, window: &Window) {
    if window.label() != "main"
        || window.is_minimized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
    {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let state = app.state::<MainWindowRuntime>();
    let mut runtime = state.0.lock_ok();
    if maximized {
        if let Some(state) = runtime.as_mut() {
            state.maximized = true;
        }
        return;
    }
    let (Ok(position), Ok(size), Ok(scale_factor)) = (
        window.outer_position(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return;
    };
    let logical = size.to_logical::<f64>(scale_factor);
    *runtime = Some(config::MainWindowState {
        x: position.x,
        y: position.y,
        width: logical.width.round().max(1.0) as u32,
        height: logical.height.round().max(1.0) as u32,
        maximized: false,
    });
}

fn persist_main_window_state(app: &AppHandle) {
    let state = *app.state::<MainWindowRuntime>().0.lock_ok();
    let Some(state) = state else {
        return;
    };
    if let Err(e) = config::update_config_json(app, |cfg| cfg.main_window_state = Some(state)) {
        eprintln!("[desktop] 保存主窗口状态失败: {e}");
    }
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
        // GTK 的不可缩放窗口按内容自然尺寸布局,resize 与几何约束全被忽略,
        // 实测落在 WebView 默认的 200x200。Linux 改为保留 resizable,
        // 用 min=max 几何约束钉死 116x120(用户与 WM 同样无法拉伸);
        // mac 维持原状,约束只是兜底
        .min_inner_size(PET_W, PET_H)
        .max_inner_size(PET_W, PET_H)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(cfg!(target_os = "linux"))
        .maximizable(false)
        .minimizable(false)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build();
    match win {
        Ok(win) => {
            let position = pet_position(app, saved);
            let _ = win.set_position(position);
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
            // 排障锚点:"桌宠看不见"类反馈全靠这一行定位——开关/落点/实际
            // 可见性/尺寸/会话环境一次外显,用户贴日志即可判因。
            eprintln!(
                "[desktop] 桌宠已创建: enabled={} saved={:?} pos=({},{}) visible={:?} size={:?} 屏幕={:?} 工作区={:?} 环境: DISPLAY={:?} WAYLAND_DISPLAY={:?} XDG_SESSION_TYPE={:?} GDK_BACKEND={:?}",
                app.state::<PetEnabled>().0.load(Ordering::Relaxed),
                saved,
                position.x,
                position.y,
                win.is_visible(),
                win.outer_size(),
                app.primary_monitor().ok().flatten().map(|m| (*m.position(), *m.size(), m.scale_factor())),
                app.primary_monitor().ok().flatten().map(|m| monitor_usable_rect(&m)),
                std::env::var("DISPLAY").ok(),
                std::env::var("WAYLAND_DISPLAY").ok(),
                std::env::var("XDG_SESSION_TYPE").ok(),
                std::env::var("GDK_BACKEND").ok(),
            );
            // GTK 的 map 是异步的,创建瞬间 visible 恒为 false;3s 后再查
            // 一次稳态(方法内部会派发回主线程,跨线程调用安全)。
            let win = win.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                eprintln!(
                    "[desktop] 桌宠稳态: visible={:?} pos={:?} size={:?}",
                    win.is_visible(),
                    win.outer_position(),
                    win.outer_size(),
                );
            });
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

/// 显示器可用矩形(物理像素):任务栏/Dock/面板层级压过 always-on-top,
/// 落进面板下的部分会被盖住(实测:KDE 底部面板把桌宠的腿吞了),所以
/// 一律以工作区为准(X11 _NET_WORKAREA / mac visibleFrame)。WM 未上报
/// (工作区与整屏等大)时按 56 逻辑像素预留底部任务栏保守量。
fn monitor_usable_rect(m: &tauri::Monitor) -> (i32, i32, i32, i32) {
    let wa = m.work_area();
    let (x, y) = (wa.position.x, wa.position.y);
    let (w, mut h) = (wa.size.width as i32, wa.size.height as i32);
    if (w, h) == (m.size().width as i32, m.size().height as i32) {
        h -= (56.0 * m.scale_factor()) as i32;
    }
    (x, y, w, h)
}

/// 桌宠位置:记忆位置须让**整个窗口**落在某台显示器的可用区域内才沿用
/// (显示器可能被拔掉/换分辨率;历史版本还存过按别的窗口尺寸/别的后端
/// 算出的坐标)。只验左上角时,窗口下半悬出屏外/压进任务栏的陈旧坐标会
/// 让桌宠只露上半身——实测复现:1000 高的屏 + 记忆 y=950,只剩头顶。
/// 判不过就回主显示器可用区域右下角留边。
fn pet_position(app: &AppHandle, saved: Option<(i32, i32)>) -> tauri::PhysicalPosition<i32> {
    if let Some((x, y)) = saved {
        let fits = app
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .any(|m| {
                let (ax, ay, aw, ah) = monitor_usable_rect(m);
                let w = (PET_W * m.scale_factor()).round() as i32;
                let h = (PET_H * m.scale_factor()).round() as i32;
                x >= ax && y >= ay && x + w <= ax + aw && y + h <= ay + ah
            });
        if fits {
            return tauri::PhysicalPosition::new(x, y);
        }
    }
    let (ax, ay, aw, ah, scale) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let (ax, ay, aw, ah) = monitor_usable_rect(&m);
            (ax, ay, aw, ah, m.scale_factor())
        })
        .unwrap_or((0, 0, 1280, 744, 1.0));
    let w = (PET_W * scale) as i32;
    let h = (PET_H * scale) as i32;
    let margin = (24.0 * scale) as i32;
    tauri::PhysicalPosition::new(ax + aw - w - margin, ay + ah - h - margin)
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

/// 提示音开关当前值(桌宠页启动时读一次;设置页渲染开关用)。
#[tauri::command]
fn sound_enabled(app: AppHandle) -> bool {
    app.state::<SoundEnabled>().0.load(Ordering::Relaxed)
}

/// 设置页切换提示音。与主题一样点一下即生效:不进保存条、不重启引擎。
#[tauri::command]
fn set_sound_enabled(app: AppHandle, enabled: bool) {
    apply_sound_enabled(&app, enabled);
}

/// 提示音开关的唯一落点(设置页命令与托盘勾选项共用):更新运行时真值 →
/// 同步托盘勾选态 → 广播给桌宠页与设置页 → 落盘。
///
/// 广播先于落盘:静音是用户此刻就要的效果,写盘失败(磁盘满/权限)不该让
/// 本次静音也失效——下次启动回到旧值即可,而不是"点了没反应"。
fn apply_sound_enabled(app: &AppHandle, enabled: bool) {
    app.state::<SoundEnabled>().0.store(enabled, Ordering::Relaxed);
    if let Some(item) = app.state::<TraySoundItem>().0.lock_ok().as_ref() {
        let _ = item.set_checked(enabled);
    }
    let _ = app.emit("sound-enabled", enabled);
    if let Err(e) = config::update_config_json(app, |cfg| cfg.sound_enabled = enabled) {
        eprintln!("[desktop] 提示音开关保存失败: {e}");
    }
}

#[cfg(any(target_os = "linux", test))]
fn default_linux_gdk_backend(
    wayland_display: Option<&std::ffi::OsStr>,
    session_type: Option<&std::ffi::OsStr>,
) -> &'static str {
    match session_type.and_then(std::ffi::OsStr::to_str) {
        Some(value) if value.eq_ignore_ascii_case("wayland") => "wayland",
        Some(value) if value.eq_ignore_ascii_case("x11") => "x11",
        _ if wayland_display.is_some_and(|value| !value.is_empty()) => "wayland",
        _ => "x11",
    }
}

fn main() {
    eprintln!("[desktop] main 进入");
    // Linux 根据登录会话选择原生后端，避免 Wayland 会话经 XWayland 渲染时
    // 出现异常高 CPU。原生 Wayland 无法保证桌宠定位和置顶，需要时可显式
    // 设置 GDK_BACKEND=x11。必须在任何 GTK 初始化之前完成选择。
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        let wayland_display = std::env::var_os("WAYLAND_DISPLAY");
        let session_type = std::env::var_os("XDG_SESSION_TYPE");
        std::env::set_var(
            "GDK_BACKEND",
            default_linux_gdk_backend(wayland_display.as_deref(), session_type.as_deref()),
        );
    }
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
        .manage(SoundEnabled(AtomicBool::new(true)))
        .manage(TraySoundItem(Mutex::new(None)))
        .manage(PetPos(Mutex::new(None)))
        .manage(MainWindowRuntime(Mutex::new(None)))
        .manage(EngineApply(Mutex::new(())))
        .manage(BrowserMcpRefresh(AtomicU64::new(0)))
        .manage(EngineSupervisor::new())
        .manage(baizhi::monkeycode::CloudPipes::new())
        .manage(baizhi::monkeycode::DownloadCtl::new())
        .manage(todos::TodosStore::new())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            take_ui_intent,
            host_info,
            show_main,
            open_devtools,
            window_system_menu,
            pet_native_render,
            sound_enabled,
            set_sound_enabled,
            update_check,
            update_install,
            open_extension_dir,
            open_app_dir,
            open_log_dir,
            export_engine_log,
            list_wsl_distros,
            engine_restart,
            probe_log,
            background::background_import,
            background::background_confirm,
            background::background_discard,
            background::background_read,
            background::background_clear,
            driver::engine_status,
            driver::engine_caps,
            driver::wsl_workdir_base,
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
            skills::skills_list,
            skills::skills_save,
            skills::skills_delete,
            skills::skills_set_default,
            driver::upload_begin,
            driver::upload_file_path,
            driver::upload_read,
            uploads::upload_chunk,
            uploads::upload_finish,
            uploads::upload_abort,
            uploads::stat_dropped_file,
            uploads::read_dropped_file,
            baizhi::baizhi_status,
            baizhi::baizhi_send_code,
            baizhi::baizhi_login,
            baizhi::baizhi_logout,
            baizhi::baizhi_wechat_start,
            baizhi::baizhi_wechat_poll,
            baizhi::baizhi_sync,
            baizhi::mc_status,
            baizhi::mc_login,
            baizhi::mc_password_login,
            baizhi::mc_logout,
            baizhi::mc_usage,
            baizhi::mc_checkin,
            baizhi::mc_models_sync,
            baizhi::mc_models_revoke,
            baizhi::mc_disconnect,
            baizhi::mc_tasks,
            baizhi::mc_projects,
            baizhi::mc_task_info,
            baizhi::mc_task_rounds,
            baizhi::mc_task_user_inputs,
            baizhi::mc_task_stop,
            baizhi::mc_task_delete,
            baizhi::mc_task_create,
            baizhi::mc_task_options,
            baizhi::mc_upload,
            baizhi::mc_file_upload,
            baizhi::mc_file_download,
            baizhi::mc_file_download_cancel,
            baizhi::mc_terminal_list,
            baizhi::monkeycode::cloud_ws_open,
            baizhi::monkeycode::cloud_ws_send,
            baizhi::monkeycode::cloud_ws_close,
            todos::todos_load,
            todos::todos_save,
            todos::todo_upload_begin,
            todos::todo_upload_path,
            todos::todo_upload_read,
            todos::todo_upload_delete,
            todos::todo_uploads_dir
        ])
        .setup(|app| {
            // 配置损坏且无有效备份时绝不能按默认值继续并覆写；仍创建错误页
            // 让用户看见可行动诊断。托盘/桌宠只使用内存中的安全默认值。
            let (cfg, config_error) = match load_config(app.handle()) {
                Ok(cfg) => (cfg, None),
                Err(e) => (DesktopConfig::default(), Some(e)),
            };
            *app.state::<MainWindowRuntime>().0.lock_ok() = cfg.main_window_state;

            // 百智云/云端服务(壳级单例;凭证 cookie 与配置同目录)。晚于
            // 配置加载:MonkeyCode 服务地址由设置指定,保存后替换服务快照;
            // 配置损坏时按默认值落官方云,错误页照常外显。
            let cfg_dir = config::config_dir(app.handle()).map_err(std::io::Error::other)?;
            app.manage(baizhi::BaizhiState::new(baizhi::Service::new(cfg_dir, &cfg)));
            app.state::<PetEnabled>()
                .0
                .store(cfg.pet_enabled, Ordering::Relaxed);
            app.state::<SoundEnabled>()
                .0
                .store(cfg.sound_enabled, Ordering::Relaxed);
            *app.state::<PetPos>()
                .0
                .lock_ok() = cfg.pet_pos;

            // 托盘失败只降级(无托盘宿主的桌面环境),不阻塞
            if let Err(e) = setup_tray(app.handle(), cfg.pet_enabled, cfg.sound_enabled) {
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

            // 前端产物完整性(仅 dev:此时资产从磁盘 uidist 服务;release
            // 走编译期嵌入,build.rs 已把关)。index.html 指向不存在的 hash
            // 时资产协议会 SPA 回退返回 text/html,WKWebView 拒执行模块
            // 脚本 → 白屏 + 晦涩 MIME 报错;抢在开窗前换成可行动的错误页。
            #[cfg(dev)]
            if let Some(missing) = frontend_missing_asset() {
                let msg = format!(
                    "前端产物不完整(index.html 引用的 {missing} 不存在),\
                     请先执行 cd desktop/ui && npm run build 重建后再启动"
                );
                eprintln!("[desktop] {msg}");
                create_main_window(app.handle(), &format!("error.html#{}", util::urlencode(&msg)));
                ensure_pet_window(app.handle());
                return Ok(());
            }

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
                } else {
                    update_main_window_runtime(window.app_handle(), window);
                }
            }
            if matches!(event, WindowEvent::Resized(_)) {
                update_main_window_runtime(window.app_handle(), window);
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
            // macOS 点 Dock 图标只派发 Reopen。桌宠常驻时
            // has_visible_windows=true，但它不能替代主窗口，仍应无条件唤回。
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_any_window(app),
            // 兜底:托盘可用时窗口全部关闭不结束进程(托盘常驻);
            // app.exit() 显式退出或托盘不可用时放行
            RunEvent::ExitRequested { api, code, .. }
                if code.is_none() && app.state::<TrayReady>().0.load(Ordering::Relaxed) =>
            {
                api.prevent_exit();
            }
            RunEvent::Exit => {
                persist_pet_prefs(app); // 拖动位置只在退出/开关切换时落盘
                persist_main_window_state(app);
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
fn setup_tray(app: &AppHandle, pet_enabled: bool, sound_enabled: bool) -> tauri::Result<()> {
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
    let sound = CheckMenuItem::with_id(
        app,
        "toggle-sound",
        "任务提示音",
        true,
        sound_enabled,
        None::<&str>,
    )?;
    // 设置页切换时要回改这个勾选项(见 apply_sound_enabled)
    *app.state::<TraySoundItem>().0.lock_ok() = Some(sound.clone());
    // 重启引擎:引擎正常跑着时界面上原本没有任何入口(横幅只在崩溃/启动
     // 失败时才出),而「改了设置外的东西要重启才生效」的提示到处都在指它。
    // 托盘这一份还兼顾引擎卡死到 UI 都不响应的场景(2026-08-07 用户报障)
    let restart_engine = MenuItem::with_id(app, "restart-engine", "重启引擎", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "check-update", "检查更新", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 MonkeyCode", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &pet, &sound, &restart_engine, &update, &quit])?;
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
            // 提示音开关:CheckMenuItem 已自翻勾选态,apply 里的 set_checked 是
            // 幂等回写(设置页那条路径才真正需要它)
            "toggle-sound" => {
                let enabled = !app.state::<SoundEnabled>().0.load(Ordering::Relaxed);
                apply_sound_enabled(app, enabled);
            }
            // 与命令 engine_restart 同一例程:失败只进壳日志(托盘没有外显位),
            // UI 侧照常经 engine-status 事件看到状态流转
            "restart-engine" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = engine_restart(app).await {
                        eprintln!("[desktop] 托盘重启引擎失败: {e}");
                    }
                });
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
    use super::{config, open_session_intent, window_state_on_available_display, DisplayArea};

    #[test]
    fn restores_window_on_negative_coordinate_monitor() {
        let state = config::MainWindowState {
            x: -1200,
            y: 100,
            width: 900,
            height: 700,
            maximized: false,
        };
        let displays = [DisplayArea {
            x: -1440,
            y: 0,
            width: 1920,
            height: 900,
            scale_factor: 1.0,
        }];
        assert!(window_state_on_available_display(state, &displays));
    }

    #[test]
    fn rejects_window_when_saved_monitor_is_gone() {
        let state = config::MainWindowState {
            x: 2200,
            y: 100,
            width: 900,
            height: 700,
            maximized: false,
        };
        let displays = [DisplayArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        }];
        assert!(!window_state_on_available_display(state, &displays));
    }

    #[test]
    fn rejects_window_with_only_a_thin_edge_visible() {
        let state = config::MainWindowState {
            x: 0,
            y: -799,
            width: 1200,
            height: 800,
            maximized: false,
        };
        let displays = [DisplayArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        }];
        assert!(!window_state_on_available_display(state, &displays));
    }

    #[test]
    fn rejects_window_when_titlebar_is_above_work_area() {
        let state = config::MainWindowState {
            x: 100,
            y: -1,
            width: 1200,
            height: 800,
            maximized: false,
        };
        let displays = [DisplayArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        }];
        assert!(!window_state_on_available_display(state, &displays));
    }

    #[test]
    fn rejects_window_with_only_caption_buttons_visible() {
        let state = config::MainWindowState {
            x: -1062,
            y: 100,
            width: 1200,
            height: 800,
            maximized: false,
        };
        let displays = [DisplayArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        }];
        assert!(!window_state_on_available_display(state, &displays));
    }

    #[test]
    fn accepts_window_fully_inside_work_area() {
        let state = config::MainWindowState {
            x: 100,
            y: 100,
            width: 1200,
            height: 800,
            maximized: false,
        };
        let displays = [DisplayArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        }];
        assert!(window_state_on_available_display(state, &displays));
    }

    #[test]
    fn detects_visible_window_using_monitor_scale() {
        let state = config::MainWindowState {
            x: 100,
            y: 100,
            width: 800,
            height: 600,
            maximized: false,
        };
        let displays = [DisplayArea {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
            scale_factor: 2.0,
        }];
        assert!(window_state_on_available_display(state, &displays));
    }

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

#[cfg(test)]
mod linux_gdk_backend_tests {
    use super::default_linux_gdk_backend;
    use std::ffi::OsStr;

    #[test]
    fn selects_backend_from_linux_session_environment() {
        assert_eq!(
            default_linux_gdk_backend(
                Some(OsStr::new("wayland-0")),
                Some(OsStr::new("wayland")),
            ),
            "wayland"
        );
        assert_eq!(
            default_linux_gdk_backend(
                Some(OsStr::new("wayland-0")),
                Some(OsStr::new("x11")),
            ),
            "x11"
        );
        assert_eq!(
            default_linux_gdk_backend(Some(OsStr::new("wayland-0")), None),
            "wayland"
        );
        assert_eq!(default_linux_gdk_backend(None, None), "x11");
    }
}
