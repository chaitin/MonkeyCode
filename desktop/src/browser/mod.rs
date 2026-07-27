// 浏览器扩展桥:自研 MV3 扩展经本地 WS 桥接,
// agent 在用户真实浏览器(Chrome/Edge)中执行 CDP 操作。
//
// 分层:
//   protocol.rs  扩展↔壳 WS 契约(Op/Ev/错误码/中文文案,PROTO_VERSION=1,
//                与 browser-extension/src/protocol.ts 对表——扩展零改动)
//   bridge.rs    WS server(/ext,7440 起顺延 10 端口)+ 配对鉴权 + 连接管理
//   cdp.rs       CDP-over-bridge 薄客户端
//   session.rs   浏览器会话现场(tab/refs/notes/对话框/OOPIF)
//   ops.rs       9 个 browser_* 工具语义 + MCP 工具元数据
//   keys.rs/refs.rs/snapshot.rs  键表/元素引用表/页面采集 JS
//   mcp.rs       MCP streamable-http server:配对后把工具暴露给 ohmyagent
//                (Bearer 鉴权,URL+token 经 mcp.json 内置条目物化下发)
//
// MCP initialize 为每条客户端 transport 分配协议会话；Agent 在 tools/call
// `_meta` 携带实际 session_id/work_dir。两级 key 各自拥有 BrowserSession，
// 允许父任务与子 Agent 并行，同时隔离 current tab/ref 与截图落盘路径。

pub mod bridge;
pub mod cdp;
pub mod keys;
pub mod mcp;
pub mod ops;
pub mod protocol;
pub mod refs;
pub mod session;
pub mod snapshot;

#[cfg(test)]
mod tests;

use std::sync::OnceLock;

use tauri::{AppHandle, Manager, State};

/// 全局桥实例(进程级单例;setup 时初始化)。
pub struct BrowserHost {
    pub bridge: bridge::ExtBridge,
    pub mcp_sessions: mcp::McpSessions,
}

/// MCP server 的接入信息。config 模块不直接读它:mcp.json 物化路径由调用方
/// (main.rs)在 init 之后查询一次、经 save_ui_config_files 参数显式传入；
/// mcp_endpoint 还会检查长期配对凭据，未配对时返回 None。
static MCP_ENDPOINT: OnceLock<(String, String)> = OnceLock::new(); // (url, bearer_token)

fn endpoint_for_pairing(
    paired: bool,
    endpoint: Option<(String, String)>,
) -> Option<(String, String)> {
    if paired { endpoint } else { None }
}

pub fn mcp_endpoint(app: &AppHandle) -> Option<(String, String)> {
    let paired = app
        .try_state::<BrowserHost>()
        .is_some_and(|host| host.bridge.is_paired());
    endpoint_for_pairing(paired, MCP_ENDPOINT.get().cloned())
}

/// 初始化浏览器桥 + MCP server(setup 阶段调用,先于引擎启动——
/// 引擎配置物化需要 MCP URL/token)。失败不阻断应用(能力降级)。
pub fn init(app: &AppHandle) {
    let data_dir = match crate::config::config_dir(app) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[desktop] 浏览器桥初始化失败(配置目录): {e}");
            return;
        }
    };
    let b = bridge::ExtBridge::new(7440, &data_dir);
    let mcp_sessions = mcp::McpSessions::new(b.clone());
    // 新 Agent 直接在 tools/call._meta 携带实际 work_dir；兼容旧 Agent 时
    // 回退 session id/唯一活跃工作区。无法确定只跳过落盘，不阻断操作。
    let app2 = app.clone();
    let wd: mcp::WorkdirFn = std::sync::Arc::new(move |scope| {
        // 上面那句"无法确定只跳过落盘，不阻断操作"此前并未成立:取不到
        // driver 就返回 Err，整个 tools/call 直接失败。而 DriverHost::get()
        // 在配置应用期(保存设置/配对刷新)必然报错——用户存一次设置就能让
        // 正在进行的浏览器操作报"引擎配置正在应用"。归属解析不出来时按
        // 契约退化成 Ok(None):跳过本地副本，截图仍作为 MCP image 回模型。
        let Some(host) = app2.try_state::<crate::driver::DriverHost>() else {
            eprintln!("[desktop] 浏览器操作归属未定(驱动未初始化),跳过本地落盘");
            return Ok(None);
        };
        let driver = match host.get() {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[desktop] 浏览器操作归属未定({e}),跳过本地落盘");
                return Ok(None);
            }
        };
        let distro = driver.wsl_distro();
        Ok(scope
            .work_dir
            .clone()
            .or_else(|| {
                scope
                    .session_id
                    .as_deref()
                    .and_then(|id| driver.browser_workdir_for(id))
            })
            .or_else(|| driver.single_running_workdir())
            .map(|wd| (wd, distro)))
    });
    match mcp::serve(mcp_sessions.clone(), wd) {
        Ok((url, token)) => {
            let _ = MCP_ENDPOINT.set((url, token));
        }
        Err(e) => eprintln!("[desktop] 浏览器 MCP server 启动失败: {e}"),
    }
    app.manage(BrowserHost { bridge: b, mcp_sessions });
    let app2 = app.clone();
    app.state::<BrowserHost>()
        .bridge
        .set_pairing_change_handler(std::sync::Arc::new(move |_| {
            crate::schedule_browser_mcp_refresh(&app2);
        }));
    app.state::<BrowserHost>().bridge.spawn();
}

// ==================== Tauri 命令(设置页) ====================

#[tauri::command]
pub fn browser_status(host: State<'_, BrowserHost>) -> serde_json::Value {
    host.bridge.status()
}

#[tauri::command]
pub async fn browser_repair(app: AppHandle) -> Result<serde_json::Value, String> {
    // repair 会清桥的全局受控 tab 集合；先排空每个 MCP context 并 detach，
    // 避免注册表仍保留旧 tabId，换浏览器后撞号导致事件错投。
    let (sessions, bridge) = {
        let host = app.state::<BrowserHost>();
        (host.mcp_sessions.clone(), host.bridge.clone())
    };
    sessions.reset().await;
    Ok(bridge.repair())
}
