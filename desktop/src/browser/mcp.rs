// MCP streamable-http server:把浏览器工具暴露给 ohmyagent(它是 MCP 客户端,
// go-sdk StreamableClientTransport)。手写最小面而非引 HTTP 框架:
// 客户端契约(实测 go-sdk v1.6.1)只需要——
//   POST application/json → 应答 application/json 的 JSON-RPC(无需 SSE);
//   通知(无 id,如 notifications/initialized)→ 202 无体;
//   GET(standalone SSE)→ 405 即被容忍(spec §2.2.3);
//   initialize 由 server 分配 Mcp-Session-Id，后续请求据此路由独立现场。
// 鉴权:随机 Bearer token,经 mcp.json 内置条目的 headers 下发给引擎——
// MCP 面能驱动用户浏览器,不能对本机任意进程裸奔。
//
// 并发模型:Mcp-Session-Id 隔离 transport，tools/call._meta.session_id 再
// 隔离共用 transport 的父/子 Agent；每个 context 独享 BrowserSession。
// 同一 context 内串行保护 current tab/ref，不同 context 可并行。

use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use base64::Engine as _;
use serde_json::{json, Value};

use super::ops::tool_metas;
use super::session::{BrowserSession, BrowserSessions};
use crate::util::LockExt;

/// 请求头(含请求行)总字节上限。环回面在 Bearer 校验**之前**就要读头,
/// 所以这个上限是防本机异常/恶意进程灌爆内存的第一道闸,不能只靠 body 上限。
const MAX_HEADER_BYTES: usize = 32 * 1024;
/// 头条数上限:防只发头不发空行的连接把循环挂死。
const MAX_HEADERS: usize = 100;
/// 在途连接上限。请求频率 = 工具调用频率(极低),真实用量个位数;
/// 设上限只为不让异常端用连接把线程数拉爆(此前 incoming() 无条件 spawn)。
const MAX_INFLIGHT_CONNS: usize = 32;

#[derive(Clone, Default)]
pub struct CallScope {
    pub session_id: Option<String>,
    pub work_dir: Option<String>,
}

/// 解析/校验调用工作区。None 只跳过截图落盘，不影响浏览器操作；owner
/// 隔离由 MCP protocol session + Agent session id 完成，不拿工作区充当锁。
/// 归属解析:返回 (workdir, wsl_distro)。distro 仅 WSL 运行环境为 Some,
/// 截图落盘经 \\wsl$ 视角写进 guest 工作区。
pub type WorkdirFn =
    Arc<dyn Fn(&CallScope) -> Result<Option<(String, Option<String>)>, String> + Send + Sync>;

#[derive(Clone)]
pub struct McpSessions(Arc<McpSessionsInner>);

struct McpSessionsInner {
    browser: BrowserSessions,
    clients: StdMutex<HashMap<String, Arc<McpClientSession>>>,
}

struct McpClientSession {
    closed: AtomicBool,
    contexts: StdMutex<HashMap<String, Arc<McpCallContext>>>,
}

struct McpCallContext {
    browser: BrowserSession,
    call_mu: tokio::sync::Mutex<()>,
}

impl McpClientSession {
    fn drain_contexts(&self) -> Vec<Arc<McpCallContext>> {
        // 先封门再等 contexts 锁：已进临界区的创建会被随后 drain，尚未进入
        // 的创建会看到 closed。DELETE/reset 后不会晚生幽灵 context。
        self.closed.store(true, Ordering::Release);
        self.contexts.lock_ok().drain().map(|(_, context)| context).collect()
    }
}

impl McpSessions {
    pub fn new(bridge: super::bridge::ExtBridge) -> Self {
        Self(Arc::new(McpSessionsInner {
            browser: BrowserSessions::new(bridge),
            clients: StdMutex::new(HashMap::new()),
        }))
    }

    fn create(&self) -> Result<String, String> {
        let id = new_token()?;
        self.0.clients.lock_ok().insert(
            id.clone(),
            Arc::new(McpClientSession {
                closed: AtomicBool::new(false),
                contexts: StdMutex::new(HashMap::new()),
            }),
        );
        Ok(id)
    }

    fn contains(&self, id: &str) -> bool {
        self.0.clients.lock_ok().contains_key(id)
    }

    fn context(&self, protocol_id: &str, agent_id: Option<&str>) -> Option<Arc<McpCallContext>> {
        let client = self.0.clients.lock_ok().get(protocol_id).cloned()?;
        let key = agent_id.filter(|id| !id.is_empty()).unwrap_or("root");
        let mut contexts = client.contexts.lock_ok();
        if client.closed.load(Ordering::Acquire) {
            return None;
        }
        Some(
            contexts
                .entry(key.to_string())
                .or_insert_with(|| {
                    let owner = format!("{protocol_id}:{key}");
                    Arc::new(McpCallContext {
                        browser: self.0.browser.get_or_create(&owner),
                        call_mu: tokio::sync::Mutex::new(()),
                    })
                })
                .clone(),
        )
    }

    async fn remove(&self, id: &str) -> bool {
        let client = self.0.clients.lock_ok().remove(id);
        let Some(client) = client else { return false };
        for context in client.drain_contexts() {
            // DELETE 可与最后一个 tools/call 同时到达。先从协议注册表摘除，
            // 再等 context 调用锁，确保不会在旧调用仍操作 tab 时 detach。
            let _guard = context.call_mu.lock().await;
            context.browser.close().await;
        }
        true
    }

    /// Agent 进程整体重启/浏览器重新配对时清空旧协议会话。先同步摘掉全部
    /// protocol id，随后逐 context 排空在途调用并 detach；返回后新 Agent
    /// initialize 不会与旧 owner 争同一个 tab。
    pub async fn reset(&self) {
        let clients = {
            let mut clients = self.0.clients.lock_ok();
            std::mem::take(&mut *clients).into_values().collect::<Vec<_>>()
        };
        for client in clients {
            for context in client.drain_contexts() {
                let _guard = context.call_mu.lock().await;
                context.browser.close().await;
            }
        }
    }
}

/// 启动 MCP server(随机端口),返回 (url, bearer_token)。
/// 阻塞式 HTTP 处理跑在独立线程(请求频率 = 工具调用频率,极低)。
pub fn serve(sessions: McpSessions, workdir: WorkdirFn) -> Result<(String, String), String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("MCP 监听失败: {e}"))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let token = new_token()?;
    let url = format!("http://{addr}/mcp");

    let tok = token.clone();
    let inflight = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut conn) = conn else { continue };
            // 满载直接回 503 并关闭,不排队、不 spawn。工具调用是低频串行动作,
            // 触到上限说明对端异常,让它立刻收到明确拒绝比堆线程好。
            if inflight.load(Ordering::SeqCst) >= MAX_INFLIGHT_CONNS {
                let _ = write_http(&mut conn, 503, "text/plain", b"too many connections", None);
                continue;
            }
            inflight.fetch_add(1, Ordering::SeqCst);
            let sessions = sessions.clone();
            let tok = tok.clone();
            let wd = workdir.clone();
            let gauge = inflight.clone();
            std::thread::spawn(move || {
                handle_conn(conn, &sessions, &tok, &wd);
                gauge.fetch_sub(1, Ordering::SeqCst);
            });
        }
    });
    Ok((url, token))
}

fn new_token() -> Result<String, String> {
    // 随机 32 hex:进程内每次启动新发(mcp.json 随引擎重启重写,不需持久)。
    // 熵源用 getrandom crate(与 bridge.rs 配对 token 同源):跨平台走系统
    // CSPRNG(Windows 无 /dev/urandom,手写读文件必退化)。失败直接报错让
    // serve 整体失败(能力降级)——不做弱随机兜底,token 可猜等于鉴权白设
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).map_err(|e| format!("系统随机源不可用: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

fn handle_conn(
    mut conn: TcpStream,
    sessions: &McpSessions,
    token: &str,
    workdir: &WorkdirFn,
) {
    let Some(req) = read_http_request(&mut conn) else { return };

    // 常时比较(复用 bridge.rs 的 ct_eq):`!=` 明文比对逐字节短路,
    // 本机恶意进程可按响应时延逐位试出 token
    let authed = req
        .bearer
        .as_deref()
        .is_some_and(|b| super::bridge::ct_eq(b.as_bytes(), token.as_bytes()));
    if !authed {
        write_http(
            &mut conn,
            401,
            "application/json",
            br#"{"error":"unauthorized"}"#,
            None,
        );
        return;
    }
    if req.method == "DELETE" {
        let Some(id) = req.mcp_session_id.as_deref() else {
            write_http(&mut conn, 400, "text/plain", b"missing Mcp-Session-Id", None);
            return;
        };
        let removed = tauri::async_runtime::block_on(sessions.remove(id));
        write_http(
            &mut conn,
            if removed { 204 } else { 404 },
            "text/plain",
            b"",
            None,
        );
        return;
    }
    if req.method != "POST" {
        // GET(standalone SSE)按 spec 返回 405,go-sdk 客户端容忍
        write_http(&mut conn, 405, "text/plain", b"method not allowed", None);
        return;
    }
    let Ok(rpc) = serde_json::from_slice::<Value>(&req.body) else {
        write_http(&mut conn, 400, "text/plain", b"bad json", None);
        return;
    };

    let method = rpc.get("method").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let protocol_id = if method == "initialize" {
        match req.mcp_session_id.as_deref() {
            Some(id) if sessions.contains(id) => id.to_string(),
            _ => match sessions.create() {
                Ok(id) => id,
                Err(e) => {
                    write_http(&mut conn, 500, "text/plain", e.as_bytes(), None);
                    return;
                }
            },
        }
    } else {
        let Some(id) = req.mcp_session_id.as_deref().filter(|id| sessions.contains(id)) else {
            write_http(&mut conn, 404, "text/plain", b"unknown MCP session", None);
            return;
        };
        id.to_string()
    };

    // 通知(无 id):202 无体
    if rpc.get("id").is_none() {
        write_http(&mut conn, 202, "application/json", b"", Some(&protocol_id));
        return;
    }
    let id = rpc.get("id").cloned().unwrap_or(Value::Null);
    let params = rpc.get("params").cloned().unwrap_or(Value::Null);

    // 工具执行是 async(桥 call 走 tokio);当前线程无 runtime,借 tauri 全局
    let result = tauri::async_runtime::block_on(dispatch(
        sessions,
        &protocol_id,
        workdir,
        &method,
        params,
    ));
    let resp = match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, msg)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": msg } })
        }
    };
    write_http(
        &mut conn,
        200,
        "application/json",
        resp.to_string().as_bytes(),
        Some(&protocol_id),
    );
}

async fn dispatch(
    sessions: &McpSessions,
    protocol_id: &str,
    workdir: &WorkdirFn,
    method: &str,
    params: Value,
) -> Result<Value, (i64, String)> {
    match method {
        "initialize" => {
            // 协议版本:回显客户端请求的版本(go-sdk 校验应答版本可识别)
            let ver = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("2025-03-26");
            Ok(json!({
                "protocolVersion": ver,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "mc-browser", "version": env!("CARGO_PKG_VERSION") },
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => {
            let tools: Vec<Value> = tool_metas()
                .iter()
                .map(|t| {
                    json!({ "name": t.name, "description": t.description, "inputSchema": (t.input_schema)() })
                })
                .collect();
            Ok(json!({ "tools": tools }))
        }
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let scope = call_scope(&params);
            let context = sessions
                .context(protocol_id, scope.session_id.as_deref())
                .ok_or_else(|| (-32001, "MCP 会话已关闭".to_string()))?;
            // 同一 Agent context 的 current-tab/ref 状态串行；不同 context
            // 没有共享可变现场，可并行进入扩展桥。
            let _g = context.call_mu.lock().await;
            let out = match workdir(&scope) {
                Err(e) => Err(e),
                Ok(owner_workdir) => tokio::time::timeout(
                    std::time::Duration::from_secs(180),
                    call_tool(&context.browser, owner_workdir, &name, &args),
                )
                .await
                .unwrap_or_else(|_| Err("浏览器操作超时(180s)".into())),
            };
            // MCP 语义:工具失败走 isError 带回模型(可行动文案),不是协议错误
            Ok(match out {
                Ok(content) => json!({ "content": content, "isError": false }),
                // 最终出口:剥除进程内错误标记(如 [ERR_DETACHED],供 session
                // 层做错误分类),模型只看人读文案
                Err(msg) => json!({
                    "content": [{ "type": "text", "text": super::protocol::strip_err_marks(msg) }],
                    "isError": true,
                }),
            })
        }
        _ => Err((-32601, format!("method not found: {method}"))),
    }
}

fn call_scope(params: &Value) -> CallScope {
    let meta = params.get("_meta");
    let value = |key: &str| meta.and_then(|value| value.get(key)).and_then(Value::as_str);
    CallScope {
        session_id: value("session_id")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        // work_dir 是文件系统值，不裁剪合法的首尾空格。
        work_dir: value("work_dir").filter(|value| !value.is_empty()).map(str::to_string),
    }
}

/// 工具分派:名称/入参形态对齐 ops.rs 的 tool_metas(即 Go tools.go)。
async fn call_tool(
    sess: &BrowserSession,
    workdir: Option<(String, Option<String>)>,
    name: &str,
    args: &Value,
) -> Result<Vec<Value>, String> {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let text_block = |t: String| vec![json!({ "type": "text", "text": t })];
    match name {
        "browser_navigate" => sess.navigate(&s("url")).await.map(text_block),
        "browser_snapshot" => sess.snapshot().await.map(text_block),
        "browser_take_screenshot" => {
            let full = args.get("full_page").and_then(|v| v.as_bool()).unwrap_or(false);
            let (png, mut note) = sess.screenshot(full).await?;
            // 截图同时落当前会话工作区:UI 工具卡按路径内联显示
            // (帧协议传路径不传 base64);模型侧走 MCP image 块直达
            // (上游 c1d8482 起)
            if let Some((wd, distro)) = workdir {
                let name = format!("browser-{}.png", crate::driver::frame::now_ms());
                match crate::uploads::save_raw(&wd, distro.as_deref(), &name, &png) {
                    Ok(rel) => note.push_str(&format!("\n截图已保存: {rel}")),
                    Err(e) => eprintln!("[desktop] 截图落盘失败: {e}"),
                }
            }
            Ok(vec![
                json!({ "type": "image", "data": base64::engine::general_purpose::STANDARD.encode(&png), "mimeType": "image/png" }),
                json!({ "type": "text", "text": note }),
            ])
        }
        "browser_click" => sess.click(&s("ref")).await.map(text_block),
        "browser_type" => {
            let clear = args.get("clear").and_then(|v| v.as_bool()).unwrap_or(true);
            let submit = args.get("submit").and_then(|v| v.as_bool()).unwrap_or(false);
            sess.type_text(&s("ref"), &s("text"), clear, submit).await.map(text_block)
        }
        "browser_select_option" => {
            let values: Vec<String> = args
                .get("values")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            sess.select_option(&s("ref"), &values).await.map(text_block)
        }
        "browser_press_key" => sess.press_key(&s("key")).await.map(text_block),
        "browser_scroll" => {
            let dir = args.get("direction").and_then(|v| v.as_str());
            let r = args.get("ref").and_then(|v| v.as_str());
            sess.scroll(dir, r).await.map(text_block)
        }
        "browser_tabs" => {
            let tab_id = args.get("tab_id").and_then(|v| v.as_i64());
            let url = args.get("url").and_then(|v| v.as_str());
            sess.tabs(&s("action"), tab_id, url).await.map(text_block)
        }
        other => Err(format!("未知工具: {other}")),
    }
}

// ==================== 最小 HTTP(单请求,Connection: close) ====================

struct HttpReq {
    method: String,
    bearer: Option<String>,
    mcp_session_id: Option<String>,
    body: Vec<u8>,
}

fn read_http_request(conn: &mut TcpStream) -> Option<HttpReq> {
    let _ = conn.set_read_timeout(Some(std::time::Duration::from_secs(30)));
    let mut reader = std::io::BufReader::new(conn.try_clone().ok()?);
    use std::io::BufRead as _;
    // 头部整体设上限。此前请求行与每条头都是无界 read_line:环回上的任意
    // 本地进程(还没到 Bearer 校验)只要发一条不含换行的超长头,String 就
    // 一直长到把内存吃光;头条数也没有上限。体量上限只管到 body,管不到这里。
    let mut head = reader.by_ref().take(MAX_HEADER_BYTES as u64);
    let mut line = String::new();
    head.read_line(&mut line).ok()?;
    let method = line.split_whitespace().next()?.to_string();
    let mut bearer = None;
    let mut mcp_session_id = None;
    let mut content_len = 0usize;
    for _ in 0..MAX_HEADERS {
        let mut h = String::new();
        if head.read_line(&mut h).is_err() || h.trim().is_empty() {
            break;
        }
        let lower = h.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_len = v.trim().parse().unwrap_or(0);
        }
        if lower.starts_with("authorization:") {
            // 原始行取值(token 大小写敏感)
            let v = h.split_once(':').map(|(_, value)| value).unwrap_or("").trim();
            bearer = v.strip_prefix("Bearer ").map(str::to_string);
        }
        if lower.starts_with("mcp-session-id:") {
            let value = h.split_once(':').map(|(_, value)| value).unwrap_or("").trim();
            if !value.is_empty() {
                mcp_session_id = Some(value.to_string());
            }
        }
    }
    // 体量上限 4MB:工具入参不会更大,防异常端灌爆内存
    if content_len > 4 * 1024 * 1024 {
        return None;
    }
    let mut body = vec![0u8; content_len];
    reader.read_exact(&mut body).ok()?;
    Some(HttpReq { method, bearer, mcp_session_id, body })
}

fn write_http(
    conn: &mut TcpStream,
    status: u16,
    ctype: &str,
    body: &[u8],
    mcp_session_id: Option<&str>,
) {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let session_header = mcp_session_id
        .map(|id| format!("Mcp-Session-Id: {id}\r\n"))
        .unwrap_or_default();
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\n{session_header}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = conn.write_all(head.as_bytes());
    let _ = conn.write_all(body);
}
