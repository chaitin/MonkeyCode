// 浏览器桥集成测试:假扩展(WS 客户端)走真实配对/调用链;MCP 面 HTTP 冒烟;
// 以及基于「可编程应答表假扩展」(FakeExt)的 ops/session 行为面集成测试——
// 把「与 Go 版逐字对齐」的声明从人工比对固化为 CI 断言。
// 契约对齐 agent/internal/browser/bridge_test.go 的关键断言。

use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::{json, Value};

use super::bridge::ExtBridge;
use super::mcp;
use super::session::{BrowserSession, BrowserSessions};

fn tmp_dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("mc-browser-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn browser_mcp_endpoint_requires_pairing() {
    let endpoint = Some(("http://127.0.0.1:7777/mcp".to_string(), "token".to_string()));
    assert_eq!(super::endpoint_for_pairing(false, endpoint.clone()), None);
    assert_eq!(super::endpoint_for_pairing(true, endpoint.clone()), endpoint);
}

/// 轮询桥就绪并取实际地址。
async fn wait_addr(b: &ExtBridge) -> String {
    for _ in 0..50 {
        let st = b.status();
        if let Some(addr) = st.get("addr").and_then(|v| v.as_str()) {
            if !addr.is_empty() {
                return addr.to_string();
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("桥未就绪: {:?}", b.status());
}

#[tokio::test(flavor = "multi_thread")]
async fn bridge_pair_and_call_roundtrip() {
    let dir = tmp_dir("bridge");
    let b = ExtBridge::new(27440, &dir);
    let pairing_changes = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let pairing_changes2 = pairing_changes.clone();
    b.set_pairing_change_handler(std::sync::Arc::new(move |paired| {
        pairing_changes2.lock().unwrap().push(paired);
    }));
    assert!(!b.is_paired(), "新配置目录不应被视为已配对");
    b.spawn();
    let addr = wait_addr(&b).await;

    // 配对:用状态页展示的一次性配对码(小写 + 连字符,测 normalize)
    let code = b.status().get("pairing_code").and_then(|v| v.as_str()).unwrap().to_string();
    let scrambled = format!("{}-{}", code[..4].to_lowercase(), &code[4..]);
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ext")).await.expect("连接");
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({ "event": "hello", "proto": 1,
            "auth": { "code": scrambled },
            "ext": { "id": "ext-test", "version": "1" },
            "browser": { "name": "TestChrome", "version": "1.0" } })
        .to_string(),
    ))
    .await
    .unwrap();
    let reply: Value = match ws.next().await.unwrap().unwrap() {
        tokio_tungstenite::tungstenite::Message::Text(t) => serde_json::from_str(&t).unwrap(),
        other => panic!("非文本帧: {other:?}"),
    };
    assert_eq!(reply.get("event").and_then(|v| v.as_str()), Some("hello.ok"));
    let token = reply.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    assert_eq!(token.len(), 32, "配对应颁发 32 hex token");

    // 已配对状态外显 + 浏览器信息
    let st = b.status();
    assert_eq!(st.get("paired").and_then(|v| v.as_bool()), Some(true));
    assert!(b.is_paired());
    assert_eq!(*pairing_changes.lock().unwrap(), vec![true]);
    assert_eq!(st.get("connected").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(st.get("browser_name").and_then(|v| v.as_str()), Some("TestChrome"));

    // 调用往返:假扩展应答 tabs.list
    let b2 = b.clone();
    let call = tauri::async_runtime::spawn(async move {
        let mut req = super::protocol::Request::default();
        req.op = super::protocol::OP_TABS_LIST.to_string();
        b2.call(req, Duration::from_secs(5)).await
    });
    // 假扩展侧:收到请求,按 id 回 result
    let req: Value = match ws.next().await.unwrap().unwrap() {
        tokio_tungstenite::tungstenite::Message::Text(t) => serde_json::from_str(&t).unwrap(),
        other => panic!("非文本帧: {other:?}"),
    };
    assert_eq!(req.get("op").and_then(|v| v.as_str()), Some("tabs.list"));
    let id = req.get("id").and_then(|v| v.as_i64()).unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({ "id": id, "result": [{ "tabId": 7, "url": "https://a", "title": "A" }] }).to_string(),
    ))
    .await
    .unwrap();
    let result = call.await.unwrap().expect("call 应成功");
    assert_eq!(result[0]["tabId"].as_i64(), Some(7));

    // 扩展错误码 → 中文可行动文案
    let b3 = b.clone();
    let call2 = tauri::async_runtime::spawn(async move {
        let mut req = super::protocol::Request::default();
        req.op = super::protocol::OP_ATTACH.to_string();
        req.tab_id = Some(7);
        b3.call(req, Duration::from_secs(5)).await
    });
    let req2: Value = match ws.next().await.unwrap().unwrap() {
        tokio_tungstenite::tungstenite::Message::Text(t) => serde_json::from_str(&t).unwrap(),
        other => panic!("非文本帧: {other:?}"),
    };
    let id2 = req2.get("id").and_then(|v| v.as_i64()).unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({ "id": id2, "error": { "code": "not_controlled" } }).to_string(),
    ))
    .await
    .unwrap();
    let err = call2.await.unwrap().expect_err("应报错");
    assert!(err.contains("交给 agent 操作"), "错误文案未翻译: {err}");

    // R3:detached 错误码 → 错误串前置稳定标记(session 自愈按标记分类,
    // 不再匹配中文文案);strip 后只剩人读文案(MCP 最终出口形态)
    let b4 = b.clone();
    let call3 = tauri::async_runtime::spawn(async move {
        let mut req = super::protocol::Request::default();
        req.op = super::protocol::OP_CDP.to_string();
        req.tab_id = Some(7);
        req.method = Some("Page.enable".to_string());
        b4.call(req, Duration::from_secs(5)).await
    });
    let req3: Value = match ws.next().await.unwrap().unwrap() {
        tokio_tungstenite::tungstenite::Message::Text(t) => serde_json::from_str(&t).unwrap(),
        other => panic!("非文本帧: {other:?}"),
    };
    let id3 = req3.get("id").and_then(|v| v.as_i64()).unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({ "id": id3, "error": { "code": "detached" } }).to_string(),
    ))
    .await
    .unwrap();
    let err = call3.await.unwrap().expect_err("应报错");
    assert!(
        err.starts_with(super::protocol::ERR_MARK_DETACHED),
        "detached 错误应带稳定标记: {err}"
    );
    let stripped = super::protocol::strip_err_marks(err);
    assert!(!stripped.contains(super::protocol::ERR_MARK_DETACHED), "标记应被剥除");
    assert!(stripped.contains("浏览器调试连接已断开"), "人读文案应保留: {stripped}");

    // R6:repair 应一并清空受控集合与 handoff 队列(换浏览器后 tabId 撞号)。
    // read_loop 按帧序处理:先发 handoff 事件帧,再借一次 call 往返做屏障,
    // call 返回即证明 handoff 已入队
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({ "event": "handoff", "info": { "tabId": 9, "url": "https://h", "title": "H" } })
            .to_string(),
    ))
    .await
    .unwrap();
    b.claim_tab(9);
    let b5 = b.clone();
    let barrier = tauri::async_runtime::spawn(async move {
        let mut req = super::protocol::Request::default();
        req.op = super::protocol::OP_TABS_LIST.to_string();
        b5.call(req, Duration::from_secs(5)).await
    });
    let req4: Value = match ws.next().await.unwrap().unwrap() {
        tokio_tungstenite::tungstenite::Message::Text(t) => serde_json::from_str(&t).unwrap(),
        other => panic!("非文本帧: {other:?}"),
    };
    let id4 = req4.get("id").and_then(|v| v.as_i64()).unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({ "id": id4, "result": [] }).to_string(),
    ))
    .await
    .unwrap();
    barrier.await.unwrap().expect("屏障 call 应成功");
    b.repair();
    assert!(!b.is_paired());
    assert_eq!(*pairing_changes.lock().unwrap(), vec![true, false]);
    assert!(b.take_pending_handoff().is_none(), "repair 应清空 handoff 队列");
    assert!(!b.owns_tab(9), "repair 应清空受控集合");
}

/// 读头发生在 Bearer 校验**之前**,所以头部必须自带字节上限:否则环回上的
/// 任意本机进程只要发一条永不换行的超长头,壳侧 String 就一路长到吃光内存。
/// 断言超限连接被干掉(无正常应答),且服务端在此之后仍能正常服务。
#[tokio::test(flavor = "multi_thread")]
async fn mcp_oversized_headers_are_dropped_and_server_survives() {
    let dir = tmp_dir("mcp-hdr");
    let b = ExtBridge::new(27462, &dir);
    let sessions = mcp::McpSessions::new(b);
    let (url, token) = mcp::serve(sessions, std::sync::Arc::new(|_| Ok(None))).expect("MCP 启动");
    let addr = url.strip_prefix("http://").unwrap().split('/').next().unwrap().to_string();
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    // 一条 1MB 且不含 CRLF 的头(远超 32KB 上限),连体都不发
    {
        let mut conn = tokio::net::TcpStream::connect(&addr).await.unwrap();
        conn.write_all(b"POST /mcp HTTP/1.1\r\nX-Flood: ").await.unwrap();
        // 服务端读到 32KB 上限就会主动关连接；客户端仍在写剩余 1MB 时
        // 收到 BrokenPipe/Reset 正是期望结果，不能把它当成测试失败。
        if let Err(e) = conn.write_all(&vec![b'A'; 1024 * 1024]).await {
            assert!(
                matches!(
                    e.kind(),
                    std::io::ErrorKind::BrokenPipe
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                ),
                "超限连接只应因服务端主动关闭而写失败: {e}"
            );
        } else {
            let _ = conn.flush().await;
        }
        let mut buf = Vec::new();
        // 关键断言是"服务端**主动**关了连接",而不仅仅是"没应答":无上限时
        // 服务端会一直等 CRLF、把头读到内存里,直到它自己 30s 读超时才罢手,
        // 此处的 read_to_end 就会超时。有上限时 32KB 一到即放弃并关连接,
        // EOF 立刻到达。只断言"无 jsonrpc 应答"两种实现都成立,区分不了。
        // 15s 而非 5s:区分信号本身余量极大(有上限时 32KB 一到即关连接、
        // 近乎瞬时;无上限时要等服务端自己的 30s 读超时),没必要把阈值卡在
        // 会被机器负载影响的位置。
        let closed = tokio::time::timeout(std::time::Duration::from_secs(15), conn.read_to_end(&mut buf)).await;
        assert!(closed.is_ok(), "超限连接应被服务端及时关闭(EOF),而不是挂着等 CRLF");
        let resp = String::from_utf8_lossy(&buf);
        assert!(!resp.contains("jsonrpc"), "超长头不应得到 JSON-RPC 应答: {resp}");
    }

    // 服务端未被拖死,正常请求照常受理
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18" } })
    .to_string();
    let req = format!(
        "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n\
         Authorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    let mut conn = tokio::net::TcpStream::connect(&addr).await.unwrap();
    conn.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    let _ = conn.read_to_end(&mut buf).await;
    let resp = String::from_utf8_lossy(&buf);
    assert!(resp.contains(r#""protocolVersion":"2025-06-18""#), "超限连接后服务端应仍可用: {resp}");
}

#[tokio::test(flavor = "multi_thread")]
async fn mcp_smoke_initialize_list_call() {
    let dir = tmp_dir("mcp");
    let b = ExtBridge::new(27460, &dir);
    // 不 spawn 桥监听:MCP 面不依赖扩展在线
    let sessions = mcp::McpSessions::new(b);
    let scopes: std::sync::Arc<std::sync::Mutex<Vec<mcp::CallScope>>> = Default::default();
    let scopes2 = scopes.clone();
    let (url, token) = mcp::serve(
        sessions,
        std::sync::Arc::new(move |scope| {
            scopes2.lock().unwrap().push(scope.clone());
            Ok(scope.work_dir.clone().map(|wd| (wd, None)))
        }),
    )
    .expect("MCP 启动");

    let post = |body: Value, auth: Option<String>, session: Option<String>| {
        let url = url.clone();
        async move {
            let mut req = format!(
                "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n"
            );
            if let Some(t) = auth {
                req.push_str(&format!("Authorization: Bearer {t}\r\n"));
            }
            if let Some(session) = session {
                req.push_str(&format!("Mcp-Session-Id: {session}\r\n"));
            }
            let body = body.to_string();
            req.push_str(&format!("Content-Length: {}\r\n\r\n{}", body.len(), body));
            let addr = url.strip_prefix("http://").unwrap().split('/').next().unwrap().to_string();
            let mut conn = tokio::net::TcpStream::connect(&addr).await.unwrap();
            use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
            conn.write_all(req.as_bytes()).await.unwrap();
            let mut buf = Vec::new();
            let _ = conn.read_to_end(&mut buf).await;
            String::from_utf8_lossy(&buf).into_owned()
        }
    };

    // 未带 token → 401
    let resp = post(
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
        None,
        None,
    )
    .await;
    assert!(resp.starts_with("HTTP/1.1 401"), "缺鉴权应 401: {resp}");

    // initialize:回显协议版本
    let resp = post(
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-06-18" } }),
        Some(token.clone()),
        None,
    )
    .await;
    assert!(resp.contains(r#""protocolVersion":"2025-06-18""#), "initialize 应答不对: {resp}");
    assert!(resp.contains("mc-browser"));
    let session = resp
        .lines()
        .find_map(|line| line.strip_prefix("Mcp-Session-Id: "))
        .map(str::trim)
        .expect("initialize 应返回 Mcp-Session-Id")
        .to_string();

    // 每条 MCP transport 都拿独立协议会话，不能退化成进程级共享现场。
    let resp = post(
        json!({ "jsonrpc": "2.0", "id": 11, "method": "initialize", "params": {} }),
        Some(token.clone()),
        None,
    )
    .await;
    let session2 = resp
        .lines()
        .find_map(|line| line.strip_prefix("Mcp-Session-Id: "))
        .map(str::trim)
        .expect("第二次 initialize 应返回 Mcp-Session-Id")
        .to_string();
    assert_ne!(session, session2, "不同 transport 不应共享 protocol session");

    // tools/list:9 个工具,名字与扩展契约一致
    let resp = post(
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        Some(token.clone()),
        Some(session.clone()),
    )
    .await;
    for name in [
        "browser_navigate", "browser_snapshot", "browser_take_screenshot", "browser_click",
        "browser_type", "browser_select_option", "browser_press_key", "browser_scroll", "browser_tabs",
    ] {
        assert!(resp.contains(name), "tools/list 缺 {name}");
    }

    // tools/call(无标签页)→ isError:true + 可行动引导文案(不是协议错误;
    // 无 tab 的引导在会话层短路,尚未触达"扩展未连接"——与 Go 语义一致)
    let resp = post(
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": { "name": "browser_snapshot", "arguments": {} } }),
        Some(token.clone()),
        Some(session.clone()),
    )
    .await;
    assert!(resp.contains(r#""isError":true"#), "应 isError: {resp}");
    assert!(resp.contains("当前没有活动标签页"), "缺可行动文案: {resp}");

    // 新 Agent 发送顶层 _meta.session_id/work_dir；Desktop 必须按实际字段
    // 消费，不能沿用旧草案里的 namespace 或 cwd 拼写。
    let resp = post(
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": { "name": "browser_snapshot", "arguments": {}, "_meta": {
                "session_id": "agent-child", "work_dir": "/workspace/child"
            } } }),
        Some(token.clone()),
        Some(session.clone()),
    )
    .await;
    assert!(resp.contains(r#""isError":true"#));
    {
        let seen = scopes.lock().unwrap();
        let scope = seen.last().expect("workdir resolver 应收到 scope");
        assert_eq!(scope.session_id.as_deref(), Some("agent-child"));
        assert_eq!(scope.work_dir.as_deref(), Some("/workspace/child"));
    }

    // 通知 → 202
    let resp = post(
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        Some(token.clone()),
        Some(session.clone()),
    )
    .await;
    assert!(resp.starts_with("HTTP/1.1 202"), "通知应 202: {resp}");

    // DELETE 释放对应 protocol session；其后旧 id 必须失效，不能复活现场。
    let addr = url.strip_prefix("http://").unwrap().split('/').next().unwrap().to_string();
    let req = format!(
        "DELETE /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {token}\r\n\
         Mcp-Session-Id: {session2}\r\nContent-Length: 0\r\n\r\n"
    );
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    let mut conn = tokio::net::TcpStream::connect(&addr).await.unwrap();
    conn.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    let _ = conn.read_to_end(&mut buf).await;
    let resp = String::from_utf8_lossy(&buf);
    assert!(resp.starts_with("HTTP/1.1 204"), "DELETE 应释放会话: {resp}");
    let resp = post(
        json!({ "jsonrpc": "2.0", "id": 12, "method": "tools/list" }),
        Some(token),
        Some(session2),
    )
    .await;
    assert!(resp.starts_with("HTTP/1.1 404"), "已删除会话必须失效: {resp}");
}

/// 父/子 Agent 共用一个 MCP transport；不同 _meta.session_id 必须真正并行，
/// 不能只做到状态分表后仍被 transport 级全局 mutex 串行。
#[tokio::test(flavor = "multi_thread")]
async fn mcp_agent_contexts_execute_in_parallel() {
    let dir = tmp_dir("mcp-parallel");
    let sessions = mcp::McpSessions::new(ExtBridge::new(27465, &dir));
    let gate = std::sync::Arc::new((
        std::sync::Mutex::new(0usize),
        std::sync::Condvar::new(),
    ));
    let timed_out = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let gate2 = gate.clone();
    let timed_out2 = timed_out.clone();
    let (url, token) = mcp::serve(
        sessions,
        std::sync::Arc::new(move |_| {
            let (lock, ready) = &*gate2;
            let mut entered = lock.lock().unwrap();
            *entered += 1;
            ready.notify_all();
            let (entered, wait) = ready
                .wait_timeout_while(entered, Duration::from_secs(2), |entered| *entered < 2)
                .unwrap();
            if wait.timed_out() && *entered < 2 {
                timed_out2.store(true, std::sync::atomic::Ordering::SeqCst);
            }
            Ok(None)
        }),
    )
    .expect("MCP 启动");
    let addr = url.strip_prefix("http://").unwrap().split('/').next().unwrap().to_string();

    async fn post(addr: &str, token: &str, session: Option<&str>, body: Value) -> String {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
        let body = body.to_string();
        let session = session
            .map(|id| format!("Mcp-Session-Id: {id}\r\n"))
            .unwrap_or_default();
        let req = format!(
            "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n\
             Authorization: Bearer {token}\r\n{session}Content-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let mut conn = tokio::net::TcpStream::connect(addr).await.unwrap();
        conn.write_all(req.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        let _ = conn.read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).into_owned()
    }

    let init = post(
        &addr,
        &token,
        None,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
    )
    .await;
    let session = init
        .lines()
        .find_map(|line| line.strip_prefix("Mcp-Session-Id: "))
        .map(str::trim)
        .expect("initialize 应返回 session id")
        .to_string();
    let one = post(
        &addr,
        &token,
        Some(&session),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
            "name": "browser_snapshot", "arguments": {},
            "_meta": { "session_id": "agent-one", "work_dir": "/workspace/one" }
        } }),
    );
    let two = post(
        &addr,
        &token,
        Some(&session),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "browser_snapshot", "arguments": {},
            "_meta": { "session_id": "agent-two", "work_dir": "/workspace/two" }
        } }),
    );
    let (one, two) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(one, two)
    })
    .await
    .expect("不同 Agent context 不应互相阻塞");
    assert!(one.contains(r#""isError":true"#) && two.contains(r#""isError":true"#));
    assert_eq!(*gate.0.lock().unwrap(), 2, "两个 Agent context 都应进入 resolver");
    assert!(
        !timed_out.load(std::sync::atomic::Ordering::SeqCst),
        "两个 Agent context 被 transport 级锁串行了"
    );
}

/// R4:模拟 go-sdk StreamableClientTransport(实测 v1.6.1)的实际发包形态——
/// initialize 后请求带 MCP-Protocol-Version 头(server 须忽略不拒),
/// 且会 GET 拉 standalone SSE 流(server 按 spec §2.2.3 回 405,客户端容忍)。
#[tokio::test(flavor = "multi_thread")]
async fn mcp_gosdk_wire_shape() {
    let dir = tmp_dir("mcp-wire");
    let b = ExtBridge::new(27470, &dir);
    let sessions = mcp::McpSessions::new(b);
    let (url, token) = mcp::serve(sessions, std::sync::Arc::new(|_| Ok(None))).expect("MCP 启动");
    let addr = url.strip_prefix("http://").unwrap().split('/').next().unwrap().to_string();

    async fn raw(addr: &str, req: String) -> String {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
        let mut conn = tokio::net::TcpStream::connect(addr).await.unwrap();
        conn.write_all(req.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        let _ = conn.read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).into_owned()
    }

    // standalone SSE:GET → 405(go-sdk 容忍,见 mcp.rs 头注释)
    let resp = raw(
        &addr,
        format!(
            "GET /mcp HTTP/1.1\r\nHost: x\r\nAccept: text/event-stream\r\nAuthorization: Bearer {token}\r\n\r\n"
        ),
    )
    .await;
    assert!(resp.starts_with("HTTP/1.1 405"), "GET 应 405: {resp}");

    let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18" } }).to_string();
    let resp = raw(
        &addr,
        format!(
            "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n\
             Accept: application/json, text/event-stream\r\nAuthorization: Bearer {token}\r\n\
             Content-Length: {}\r\n\r\n{}",
            init.len(),
            init
        ),
    )
    .await;
    let session = resp
        .lines()
        .find_map(|line| line.strip_prefix("Mcp-Session-Id: "))
        .map(str::trim)
        .expect("initialize 应返回 session id");

    // initialize 之后 go-sdk 每个请求都带 protocol/session 头 + 双类型 Accept
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string();
    let resp = raw(
        &addr,
        format!(
            "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n\
             Accept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-06-18\r\n\
             Mcp-Session-Id: {session}\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert!(resp.starts_with("HTTP/1.1 200"), "带 MCP-Protocol-Version 头应正常应答: {resp}");
    assert!(resp.contains("browser_navigate"), "tools/list 应答不对: {resp}");
}

// ===========================================================================
// 可编程假扩展(应答表 + 事件注入)与 ops/session 行为面集成测试
// ===========================================================================

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex as StdMutex};

use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message as WsMsg;

type WsClient =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// 可编程假扩展:真实 WS 客户端连入桥,按「op/method → 脚本应答队列」自动
/// 应答内核请求,并提供事件注入通道;测试逐条编排应答表即可驱动 ops/session
/// 的完整行为分支。
///
/// 语义约定:
///   - 应答键:非 cdp 请求用 op 原名(如 "attach");cdp 请求用 "cdp:<method>"。
///   - 队列语义:len>1 时逐条消费;仅剩最后一条时重复应答(幂等命令只需脚本一次)。
///   - 无脚本的请求不应答(在途悬置,供断连唤醒类测试)。
///   - 所有收到的请求帧记入日志,供断言调用顺序与参数(逐字段对齐 Go 语义)。
struct FakeExt {
    /// 事件注入通道:测试 → 假扩展任务 → WS(附 ack,保证事件帧先于后续请求写出)。
    event_tx: mpsc::UnboundedSender<(Value, oneshot::Sender<()>)>,
    script: Arc<StdMutex<HashMap<String, VecDeque<Value>>>>,
    log: Arc<StdMutex<Vec<(String, Value)>>>,
}

impl FakeExt {
    /// 连入扩展桥并完成 hello 鉴权;返回 (假扩展, 配对新颁发的 token;token 重连为 None)。
    async fn connect(addr: &str, auth: Value, browser_name: &str) -> (FakeExt, Option<String>) {
        let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ext"))
            .await
            .expect("连接扩展桥");
        ws.send(WsMsg::Text(
            json!({ "event": "hello", "proto": 1, "auth": auth,
                "ext": { "id": "ext-test", "version": "1" },
                "browser": { "name": browser_name, "version": "1.0" } })
            .to_string(),
        ))
        .await
        .unwrap();
        let reply = next_json(&mut ws).await.expect("应收到 hello.ok");
        assert_eq!(reply["event"].as_str(), Some("hello.ok"), "hello 应答不对: {reply}");
        let token = reply["token"].as_str().map(str::to_string);

        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<(Value, oneshot::Sender<()>)>();
        let script: Arc<StdMutex<HashMap<String, VecDeque<Value>>>> = Arc::default();
        let log: Arc<StdMutex<Vec<(String, Value)>>> = Arc::default();
        let (script2, log2) = (script.clone(), log.clone());
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    ev = event_rx.recv() => {
                        let Some((v, ack)) = ev else { break };
                        if ws.send(WsMsg::Text(v.to_string())).await.is_err() { break; }
                        let _ = ack.send(());
                    }
                    frame = ws.next() => {
                        let text = match frame {
                            Some(Ok(WsMsg::Text(t))) => t,
                            Some(Ok(WsMsg::Close(_))) | Some(Err(_)) | None => break,
                            Some(Ok(_)) => continue,
                        };
                        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                        let op = v["op"].as_str().unwrap_or("");
                        if op.is_empty() || op == "ping" {
                            continue; // ping 保活帧 id=0,无需应答
                        }
                        let key = if op == "cdp" {
                            format!("cdp:{}", v["method"].as_str().unwrap_or(""))
                        } else {
                            op.to_string()
                        };
                        log2.lock().unwrap().push((key.clone(), v.clone()));
                        let resp = {
                            let mut s = script2.lock().unwrap();
                            match s.get_mut(&key) {
                                Some(q) if q.len() > 1 => q.pop_front(),
                                Some(q) => q.front().cloned(), // 最后一条重复应答
                                None => None,                  // 无脚本:悬置不答
                            }
                        };
                        if let Some(mut r) = resp {
                            r["id"] = v["id"].clone();
                            if ws.send(WsMsg::Text(r.to_string())).await.is_err() { break; }
                        }
                    }
                }
            }
        });
        (FakeExt { event_tx, script, log }, token)
    }

    /// 追加一条脚本应答(队列尾)。
    fn on(&self, key: &str, resp: Value) {
        self.script.lock().unwrap().entry(key.to_string()).or_default().push_back(resp);
    }

    /// 整队替换脚本应答。
    fn set(&self, key: &str, resps: Vec<Value>) {
        self.script.lock().unwrap().insert(key.to_string(), resps.into());
    }

    /// 注入一条扩展事件帧;返回时事件已写出到 WS。桥的 read_loop 按帧序
    /// 处理,之后再借一次 call 往返(见 barrier)即可确认事件已被处理。
    async fn send_event(&self, v: Value) {
        let (tx, rx) = oneshot::channel();
        self.event_tx.send((v, tx)).expect("假扩展任务应存活");
        rx.await.expect("事件应写出成功");
    }

    /// 指定键收到的全部请求帧(按到达顺序)。
    fn calls(&self, key: &str) -> Vec<Value> {
        self.log
            .lock().unwrap()
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .collect()
    }

    fn call_count(&self, key: &str) -> usize {
        self.log.lock().unwrap().iter().filter(|(k, _)| k == key).count()
    }

    /// 全部请求键序列(断言调用顺序用)。
    fn key_log(&self) -> Vec<String> {
        self.log.lock().unwrap().iter().map(|(k, _)| k.clone()).collect()
    }

    /// 轮询等待指定键的第 n 次调用到达(异步旁路,如对话框自动应答)。
    async fn wait_call(&self, key: &str, n: usize) {
        for _ in 0..100 {
            if self.call_count(key) >= n {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("等待 {key} 第 {n} 次调用超时;已收到: {:?}", self.key_log());
    }
}

/// 读下一条 JSON 文本帧。
async fn next_json(ws: &mut WsClient) -> Option<Value> {
    while let Some(item) = ws.next().await {
        match item.ok()? {
            WsMsg::Text(t) => return serde_json::from_str(&t).ok(),
            WsMsg::Close(_) => return None,
            _ => continue,
        }
    }
    None
}

/// 配对连入:用状态页配对码完成首次配对,返回假扩展与长期 token。
async fn pair(b: &ExtBridge) -> (FakeExt, String) {
    let addr = wait_addr(b).await;
    let code = b.status()["pairing_code"].as_str().expect("未配对应外显配对码").to_string();
    let (fake, token) = FakeExt::connect(&addr, json!({ "code": code }), "TestChrome").await;
    (fake, token.expect("配对应颁发 token"))
}

/// 事件屏障:send_event 已保证事件帧先写出,再借一次脚本化 call 往返;
/// 桥 read_loop 按帧序处理,call 返回即证明先行事件已被同步处理完。
async fn barrier(fake: &FakeExt, b: &ExtBridge) {
    fake.on("test.barrier", ok_res(Value::Null));
    let mut req = super::protocol::Request::default();
    req.op = "test.barrier".to_string();
    b.call(req, Duration::from_secs(5)).await.expect("屏障 call 应成功");
}

/// CDP Runtime.evaluate / callFunctionOn 形态的成功应答(returnByValue 值)。
fn cdp_value(v: Value) -> Value {
    json!({ "result": { "result": { "value": v } } })
}

/// CDP 形态的对象句柄应答(objectGroup 取数组句柄用)。
fn cdp_object(object_id: &str) -> Value {
    json!({ "result": { "result": { "objectId": object_id } } })
}

/// 扩展侧错误应答。
fn ext_err(code: &str, message: &str) -> Value {
    json!({ "error": { "code": code, "message": message } })
}

/// 普通成功应答。
fn ok_res(v: Value) -> Value {
    json!({ "result": v })
}

/// ensure_tab 所需的 attach + 域启用脚本(幂等,重复应答)。
fn script_attach(fake: &FakeExt) {
    fake.set("attach", vec![ok_res(json!({}))]);
    fake.set("cdp:Page.enable", vec![ok_res(json!({}))]);
    fake.set("cdp:DOM.enable", vec![ok_res(json!({}))]);
}

/// 编排一次「两元素页面」快照的全部 CDP 应答:e1=button「登录」,e2=a「首页」。
/// objectId 带 gen 后缀,供断言交互命令作用于正确代次的对象。
fn script_snapshot(fake: &FakeExt, gen: i64) {
    let meta = json!({
        "url": "https://a/", "title": "A", "gen": gen,
        "items": [
            { "tag": "button", "text": "登录" },
            { "tag": "a", "text": "首页", "href": "/home" },
        ],
    })
    .to_string();
    fake.set(
        "cdp:Runtime.evaluate",
        vec![
            cdp_value(json!(meta)), // COLLECT_JS 采集元数据(JSON 字符串)
            cdp_object("arr-1"),    // window.__mcAgentRefs 数组句柄
        ],
    );
    fake.set(
        "cdp:Runtime.getProperties",
        vec![ok_res(json!({ "result": [
            { "name": "0", "value": { "objectId": format!("obj-btn-{gen}") } },
            { "name": "1", "value": { "objectId": format!("obj-a-{gen}") } },
        ] }))],
    );
    fake.set("frames.list", vec![ok_res(Value::Null)]); // 无 OOPIF
    fake.set("cdp:Runtime.releaseObjectGroup", vec![ok_res(json!({}))]);
}

/// 扩展交付标签页 → 会话认领(handoff 事件 → 屏障 → ensure 消费待领队列,
/// 消费点对齐 Go 的 ensure → TakePendingHandoff)。
async fn adopt_tab(fake: &FakeExt, b: &ExtBridge, sess: &BrowserSession, tab_id: i64) {
    fake.send_event(
        json!({ "event": "handoff", "info": { "tabId": tab_id, "url": "https://a/", "title": "A" } }),
    )
    .await;
    barrier(fake, b).await;
    sess.ensure().expect("ensure 应成功");
    assert_eq!(sess.state().tab_id, Some(tab_id), "handoff 后应认领标签页 #{tab_id}");
}

/// 锁什么:snapshot→click 完整链路。快照按 CDP 语义应答(COLLECT_JS 元数据
/// → 数组句柄 → getProperties 逐元素 objectId),断言 ref 表重建(e1/e2 编号、
/// 格式化文本、事件旁白附注);click 断言作用于快照解析出的 objectId、
/// getBoxModel 中心坐标计算、moved/pressed/released 三段真实鼠标序列,
/// 以及交互后轻量状态回报(gen>0 不提示重新快照)。
#[tokio::test(flavor = "multi_thread")]
async fn ops_snapshot_click_full_roundtrip() {
    let dir = tmp_dir("snap-click");
    let b = ExtBridge::new(27480, &dir);
    b.spawn();
    let sess = BrowserSession::new(b.clone());
    let (fake, _) = pair(&b).await;

    adopt_tab(&fake, &b, &sess, 7).await;
    script_attach(&fake);
    script_snapshot(&fake, 1);

    let out = sess.snapshot().await.expect("snapshot 应成功");
    for want in [
        "页面: A",
        "URL: https://a/",
        "可交互元素(2 个)",
        "e1 [button] \"登录\"",
        "e2 [a] \"首页\" → /home",
        "[浏览器事件] 用户交付了标签页 #7(A)", // 事件旁白附注到工具结果
    ] {
        assert!(out.contains(want), "快照缺少 {want:?},实际:\n{out}");
    }

    // click e1:定位(scrollIntoView + getBoxModel)→ 三段真实鼠标事件 → 状态回报
    fake.set("cdp:Runtime.callFunctionOn", vec![cdp_value(json!(true))]);
    fake.set(
        "cdp:DOM.getBoxModel",
        vec![ok_res(json!({ "model": {
            "content": [10.0, 10.0, 110.0, 10.0, 110.0, 40.0, 10.0, 40.0],
            "width": 100.0, "height": 30.0,
        } }))],
    );
    fake.set("cdp:Input.dispatchMouseEvent", vec![ok_res(json!({}))]);
    // 交互后的轻量状态(interaction_result → status)
    fake.set(
        "cdp:Runtime.evaluate",
        vec![cdp_value(json!({ "url": "https://a/x", "title": "X", "gen": 1 }))],
    );

    let out = sess.click("e1").await.expect("click 应成功");
    assert!(out.contains("已点击 e1"), "点击结果不对: {out}");
    assert!(out.contains("当前页面: X(https://a/x)"), "应回报轻量状态: {out}");
    assert!(!out.contains("引用已失效"), "gen>0 不应提示重新快照: {out}");

    // CDP 往返细节:作用对象与坐标(盒模型四角中心 = (60,25))
    let fn_calls = fake.calls("cdp:Runtime.callFunctionOn");
    assert_eq!(
        fn_calls[0]["params"]["objectId"].as_str(),
        Some("obj-btn-1"),
        "click 应作用于快照解析出的 e1 对象"
    );
    let box_calls = fake.calls("cdp:DOM.getBoxModel");
    assert_eq!(box_calls[0]["params"]["objectId"].as_str(), Some("obj-btn-1"));
    let mouse = fake.calls("cdp:Input.dispatchMouseEvent");
    let kinds: Vec<&str> =
        mouse.iter().map(|m| m["params"]["type"].as_str().unwrap_or("")).collect();
    assert_eq!(kinds, ["mouseMoved", "mousePressed", "mouseReleased"], "鼠标序列不对");
    for m in &mouse {
        assert_eq!(m["params"]["x"].as_f64(), Some(60.0), "x 应为盒模型中心");
        assert_eq!(m["params"]["y"].as_f64(), Some(25.0), "y 应为盒模型中心");
    }
}

/// 锁什么:导航后 ref 失效的错误闭环(refs.rs 语义)。四条分支:
/// ① 未知 ref → err_ref_stale 文案引导重新 snapshot;② 主 frame 导航事件
/// (Page.frameNavigated 无 parentId)→ 整表失效,旧 ref 报「尚无元素快照」
/// 且不发起任何元素级 CDP;③ 子 frame 导航不失效主表;④ 扩展报「执行上下文
/// 已销毁」→ 统一翻译为 ref 失效错误(is_stale_object_err 判定)。
#[tokio::test(flavor = "multi_thread")]
async fn ops_ref_stale_after_navigation_guides_resnapshot() {
    let dir = tmp_dir("ref-stale");
    let b = ExtBridge::new(27490, &dir);
    b.spawn();
    let sess = BrowserSession::new(b.clone());
    let (fake, _) = pair(&b).await;

    adopt_tab(&fake, &b, &sess, 7).await;
    script_attach(&fake);
    script_snapshot(&fake, 1);
    sess.snapshot().await.expect("snapshot 应成功");

    // ① 未知 ref:引导重新 snapshot(文案逐字对齐 Go errRefStale)
    let err = sess.click("e99").await.expect_err("未知 ref 应报错");
    assert!(
        err.contains("e99") && err.contains("请先调用 browser_snapshot"),
        "未知 ref 文案不对: {err}"
    );

    // ② 主 frame 导航 → 整表失效,旧代 ref 闭环报错
    fake.send_event(json!({ "event": "cdp", "tabId": 7, "method": "Page.frameNavigated",
        "params": { "frame": { "id": "f1" } } }))
    .await;
    barrier(&fake, &b).await;
    let n_before = fake.call_count("cdp:Runtime.callFunctionOn");
    let err = sess.click("e1").await.expect_err("导航后旧 ref 应报错");
    assert!(err.contains("请先调用 browser_snapshot"), "失效文案不对: {err}");
    assert_eq!(
        fake.call_count("cdp:Runtime.callFunctionOn"),
        n_before,
        "失效 ref 不应发起任何元素级 CDP"
    );

    // ③ 子 frame 导航(有 parentId)不失效主表
    script_snapshot(&fake, 2);
    sess.snapshot().await.expect("重新 snapshot 应成功");
    fake.send_event(json!({ "event": "cdp", "tabId": 7, "method": "Page.frameNavigated",
        "params": { "frame": { "id": "f2", "parentId": "f1" } } }))
    .await;
    barrier(&fake, &b).await;
    assert!(sess.state().refs.lookup("e1").is_ok(), "子 frame 导航不应失效主表");

    // ④ 执行上下文已销毁(实际导航但事件未及处理)→ 翻译为 ref 失效错误
    fake.set(
        "cdp:Runtime.callFunctionOn",
        vec![ext_err("cdp_error", "Execution context was destroyed")],
    );
    let err = sess.click("e1").await.expect_err("上下文销毁应报错");
    assert!(
        err.contains("已过期") && err.contains("请先调用 browser_snapshot"),
        "stale 翻译不对: {err}"
    );
}

/// 锁什么:detached 自愈语义(session.rs cmd 的命令级兜底)。① 非用户原因
/// detached 错误 → 恰好自动重 attach 一次并重试成功(调用序列断言);
/// ② detached 事件非用户原因 → 保留成员资格,旁白提示自动重连;③ 用户主动
/// 收回(canceled_by_user)→ 移出会话与受控集合;④ 收回后重试:重 attach 被
/// 扩展拒绝(not_controlled),引导文案透出且不再二次重试——不违背用户意愿。
#[tokio::test(flavor = "multi_thread")]
async fn session_detached_auto_reattach_once_respects_user_revoke() {
    let dir = tmp_dir("detached");
    let b = ExtBridge::new(27500, &dir);
    b.spawn();
    let sess = BrowserSession::new(b.clone());
    let (fake, _) = pair(&b).await;
    adopt_tab(&fake, &b, &sess, 7).await;

    // ① 首次命令回 detached → 自动 attach → 重试成功
    fake.set("attach", vec![ok_res(json!({}))]);
    fake.set("cdp:Page.reload", vec![ext_err("detached", ""), ok_res(json!({}))]);
    sess.cmd(7, None, "Page.reload", None).await.expect("detached 后应自愈成功");
    let seq: Vec<String> = fake
        .key_log()
        .into_iter()
        .filter(|k| k == "cdp:Page.reload" || k == "attach")
        .collect();
    assert_eq!(
        seq,
        ["cdp:Page.reload", "attach", "cdp:Page.reload"],
        "应恰好重 attach 一次并重试原命令"
    );

    // ② detached 事件(非用户原因,如页面崩溃):保留成员资格,提示自动重连
    fake.send_event(json!({ "event": "detached", "tabId": 7, "reason": "target_crashed" })).await;
    barrier(&fake, &b).await;
    assert!(b.owns_tab(7), "非用户原因不应移出受控集合");
    assert_eq!(sess.state().tab_id, Some(7), "非用户原因应保留当前标签页");
    assert!(sess.take_notes().contains("将自动重连"), "应旁白提示自动重连");

    // ③ 用户主动收回控制权:尊重之,移出会话与受控集合
    fake.send_event(json!({ "event": "detached", "tabId": 7, "reason": "canceled_by_user" })).await;
    barrier(&fake, &b).await;
    assert!(!b.owns_tab(7), "用户收回应移出受控集合");
    assert_eq!(sess.state().tab_id, None, "用户收回应清空当前标签页");
    assert!(sess.take_notes().contains("用户收回了标签页 #7"), "应旁白记录用户收回");

    // ④ 收回后的命令级重试:重 attach 被扩展拒绝(受控集合外),引导文案
    //    透出且不再二次重试原命令
    fake.set("attach", vec![ext_err("not_controlled", "")]);
    fake.set("cdp:Page.stopLoading", vec![ext_err("detached", "")]);
    let err = sess.cmd(7, None, "Page.stopLoading", None).await.expect_err("应报错");
    assert!(err.contains("交给 agent 操作"), "应透出扩展的引导文案: {err}");
    assert_eq!(fake.call_count("cdp:Page.stopLoading"), 1, "attach 被拒后不应再重试原命令");
}

/// 锁什么:新连顶旧连(bridge 的 epoch/排空语义,从 ops 层视角断言)。
/// 旧连上有在途工具调用(假扩展悬置不答)时,新连接以长期 token 连入:
/// ① 在途 call 立即被唤醒报「连接已断开」(而非等到 30s 超时);② token
/// 重连不再颁发新 token;③ 新连上的工具调用照常完整往返。
#[tokio::test(flavor = "multi_thread")]
async fn bridge_preempt_wakes_inflight_call_from_ops_view() {
    let dir = tmp_dir("preempt");
    let b = ExtBridge::new(27510, &dir);
    b.spawn();
    let sess = BrowserSession::new(b.clone());
    let (fake1, token) = pair(&b).await;

    // 旧连在途调用:tabs.list 无脚本 → 假扩展悬置不答
    let sess2 = sess.clone();
    let inflight = tauri::async_runtime::spawn(async move { sess2.tabs("list", None, None).await });
    fake1.wait_call("tabs.list", 1).await;

    // 新连接以长期 token 连入 → 顶掉旧连
    let addr = wait_addr(&b).await;
    let (fake2, reissued) = FakeExt::connect(&addr, json!({ "token": token }), "TestChrome").await;
    assert!(reissued.is_none(), "token 重连不应再颁发新 token");

    // 旧连在途 call 被立即唤醒(3s 上限远小于 30s 命令超时)
    let err = tokio::time::timeout(Duration::from_secs(3), inflight)
        .await
        .expect("旧连在途 call 应被立即唤醒,而非等到命令超时")
        .unwrap()
        .expect_err("被顶掉连接上的调用应报错");
    assert!(err.contains("连接已断开"), "断连文案不对: {err}");

    // 新连上的工具调用照常工作(ops 视角完整往返)
    fake2.set(
        "tabs.list",
        vec![ok_res(json!([{ "tabId": 3, "url": "https://b", "title": "B", "controlled": true }]))],
    );
    let out = sess.tabs("list", None, None).await.expect("新连上的调用应成功");
    assert!(out.contains("#3 [待认领] B — https://b"), "标签页列表不对: {out}");
}

/// 锁什么:session 事件处理。① tab.removed → 双侧清理(桥受控集合 +
/// 会话当前标签页)并旁白记录,后续工具入口闭环报「当前没有活动标签页」;
/// ② JS 对话框自动应答:alert 自动确认(accept:true)、confirm 自动取消
/// (accept:false),均旁白记录且带消息内容。
#[tokio::test(flavor = "multi_thread")]
async fn session_tab_removed_cleanup_and_dialog_auto_reply() {
    let dir = tmp_dir("events");
    let b = ExtBridge::new(27520, &dir);
    b.spawn();
    let sess = BrowserSession::new(b.clone());
    let (fake, _) = pair(&b).await;

    adopt_tab(&fake, &b, &sess, 7).await;
    assert!(b.owns_tab(7));

    // ① tab.removed → 桥受控集合与会话状态双侧清理
    fake.send_event(json!({ "event": "tab.removed", "tabId": 7 })).await;
    barrier(&fake, &b).await;
    assert!(!b.owns_tab(7), "tab.removed 应释放桥受控集合");
    assert_eq!(sess.state().tab_id, None, "tab.removed 应清空当前标签页");
    assert!(sess.take_notes().contains("标签页 #7 已被关闭"), "应旁白记录关闭");
    let err = sess.snapshot().await.expect_err("无标签页应报引导错误");
    assert!(err.contains("当前没有活动标签页"), "引导文案不对: {err}");

    // ② 对话框自动应答(异步旁路):alert 确认、confirm 取消
    adopt_tab(&fake, &b, &sess, 8).await;
    fake.set("cdp:Page.handleJavaScriptDialog", vec![ok_res(json!({}))]);
    fake.send_event(json!({ "event": "cdp", "tabId": 8, "method": "Page.javascriptDialogOpening",
        "params": { "type": "alert", "message": "保存成功" } }))
    .await;
    fake.wait_call("cdp:Page.handleJavaScriptDialog", 1).await;
    fake.send_event(json!({ "event": "cdp", "tabId": 8, "method": "Page.javascriptDialogOpening",
        "params": { "type": "confirm", "message": "确定删除?" } }))
    .await;
    fake.wait_call("cdp:Page.handleJavaScriptDialog", 2).await;

    let replies = fake.calls("cdp:Page.handleJavaScriptDialog");
    assert_eq!(replies[0]["tabId"].as_i64(), Some(8));
    assert_eq!(replies[0]["params"]["accept"].as_bool(), Some(true), "alert 应自动确认");
    assert_eq!(replies[1]["params"]["accept"].as_bool(), Some(false), "confirm 应自动取消");
    let notes = sess.take_notes();
    assert!(
        notes.contains("alert 对话框(已自动确认)") && notes.contains("保存成功"),
        "alert 旁白不对: {notes}"
    );
    assert!(notes.contains("confirm 对话框(已自动取消)"), "confirm 旁白不对: {notes}");
}

#[tokio::test(flavor = "multi_thread")]
async fn concurrent_browser_sessions_keep_tab_ownership_and_events_isolated() {
    let dir = tmp_dir("multi-session");
    let bridge = ExtBridge::new(27530, &dir);
    bridge.spawn();
    let sessions = BrowserSessions::new(bridge.clone());
    let one = sessions.get_or_create("agent-one");
    let two = sessions.get_or_create("agent-two");
    let (fake, _) = pair(&bridge).await;

    adopt_tab(&fake, &bridge, &one, 7).await;
    adopt_tab(&fake, &bridge, &two, 8).await;
    assert_eq!(one.state().tab_id, Some(7));
    assert_eq!(two.state().tab_id, Some(8));
    assert_eq!(sessions.owner_of(7).as_deref(), Some("agent-one"));
    assert_eq!(sessions.owner_of(8).as_deref(), Some("agent-two"));

    let err = two
        .tabs("select", Some(7), None)
        .await
        .expect_err("另一任务不得抢占 tab");
    assert!(err.contains("另一个任务"), "归属冲突文案不对: {err}");

    fake.send_event(json!({ "event": "tab.removed", "tabId": 7 })).await;
    barrier(&fake, &bridge).await;
    assert_eq!(one.state().tab_id, None, "tab #7 事件应只清理 owner one");
    assert_eq!(two.state().tab_id, Some(8), "tab #7 事件不应污染 owner two");
    assert_eq!(sessions.owner_of(7), None);
    assert_eq!(sessions.owner_of(8).as_deref(), Some("agent-two"));
}
