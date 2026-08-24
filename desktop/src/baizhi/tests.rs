// baizhi 集成测试:假服务端跑通协议全链路(对照 Go 侧 client_test.go /
// monkeycode_test.go 的场景)。PoW 解由服务端按协议独立校验,与求解器实现解耦。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{unwrap_envelope, BzErr, Endpoints, Service, ENV_BAIZHI};

/// 假服务端收到的一次请求。
struct Req {
    method: String,
    path: String, // 含查询串
    cookie: String,
    authorization: String,
    body: Vec<u8>,
}

/// 应答:状态码 + 额外头 + JSON 体。
struct Resp {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Resp {
    fn json(status: u16, v: Value) -> Self {
        Resp { status, headers: vec![("Content-Type".into(), "application/json".into())], body: v.to_string().into_bytes() }
    }
    fn with_cookie(mut self, c: &str) -> Self {
        self.headers.push(("Set-Cookie".into(), c.into()));
        self
    }
    fn redirect(loc: &str) -> Self {
        Resp { status: 302, headers: vec![("Location".into(), loc.into())], body: vec![] }
    }
}

type Handler = Arc<dyn Fn(Req) -> Resp + Send + Sync>;

/// 极简 HTTP 服务(单线程 accept;Connection: close 简化解析)。
fn serve(handler: Handler) -> (String, Arc<AtomicBool>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            if stop2.load(Ordering::Relaxed) {
                break;
            }
            let Ok(mut conn) = conn else { continue };
            let handler = handler.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(conn.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() || line.is_empty() {
                    return;
                }
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("").to_string();
                let mut cookie = String::new();
                let mut authorization = String::new();
                let mut content_len = 0usize;
                loop {
                    let mut h = String::new();
                    if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
                        break;
                    }
                    let lower = h.to_ascii_lowercase();
                    if lower.starts_with("cookie:") {
                        cookie = h[7..].trim().to_string();
                    }
                    if lower.starts_with("authorization:") {
                        authorization = h[14..].trim().to_string();
                    }
                    if let Some(v) = lower.strip_prefix("content-length:") {
                        content_len = v.trim().parse().unwrap_or(0);
                    }
                }
                let mut body = vec![0u8; content_len];
                if content_len > 0 {
                    let _ = reader.read_exact(&mut body);
                }
                let resp = handler(Req {
                    method,
                    path,
                    cookie,
                    authorization,
                    body,
                });
                let mut out = format!("HTTP/1.1 {} X\r\nConnection: close\r\nContent-Length: {}\r\n", resp.status, resp.body.len());
                for (k, v) in &resp.headers {
                    out.push_str(&format!("{k}: {v}\r\n"));
                }
                out.push_str("\r\n");
                let _ = conn.write_all(out.as_bytes());
                let _ = conn.write_all(&resp.body);
            });
        }
    });
    (format!("http://{addr}"), stop)
}

fn body_json(b: &[u8]) -> Value {
    serde_json::from_slice(b).unwrap_or(Value::Null)
}

#[test]
fn official_model_and_mcp_gateways_are_pinned() {
    assert_eq!(super::DEFAULT_MODEL_GATEWAY, "https://ai-models.app.baizhi.cloud");
    assert_eq!(super::DEFAULT_MCP_GATEWAY, "https://agent-toolkit.app.baizhi.cloud");
}

/// MonkeyCode 服务地址解析:环境变量 > 设置值 > 官方云;设置值 trim +
/// MonkeyCode 地址优先级与尾斜杠归一纯函数,不触碰进程环境。
#[test]
fn endpoints_resolve_honors_configured_mc_base_url() {
    assert_eq!(
        super::resolve_monkeycode("https://self.example.com/", None),
        "https://self.example.com",
        "设置值生效且尾斜杠归一"
    );
    assert_eq!(super::resolve_monkeycode("  ", None), "https://monkeycode-ai.com", "空白设置回落官方云");
    assert_eq!(
        super::resolve_monkeycode("https://self.example.com", Some("https://env.example.com")),
        "https://env.example.com",
        "环境变量优先(开发/联调逃生门)"
    );
}

#[test]
fn baizhi_state_reconfigures_without_losing_runtime_state() {
    let svc = Service::test_service(Endpoints {
        account: "https://account.example.com".into(),
        model_gateway: "https://models.example.com".into(),
        mcp_gateway: "https://mcp.example.com".into(),
        monkeycode: "https://old.example.com".into(),
    });
    svc.mc.update(
        &reqwest::Url::parse("https://old.example.com/").unwrap(),
        &["mc_session=old; Path=/".into()],
    );
    let state = super::BaizhiState::new(svc);
    let old = state.service();
    let cfg = crate::config::DesktopConfig {
        mc_base_url: "https://new.example.com/".into(),
        mc_basic_auth: "user:pass".into(),
        mc_llm_base_url: "https://llm.example.com/v1/".into(),
        ..Default::default()
    };

    let expected_monkeycode = Endpoints::resolve(&cfg.mc_base_url).monkeycode;
    let pipes = super::monkeycode::CloudPipes::new();
    assert!(state.apply_config(&cfg, &pipes).is_some(), "服务地址或鉴权变化应要求关闭旧云端连接");
    let new = state.service();
    assert_eq!(old.ep.monkeycode, "https://old.example.com", "在途请求继续使用稳定旧快照");
    assert_eq!(new.ep.monkeycode, expected_monkeycode);
    assert_eq!(new.mc_llm, "https://llm.example.com/v1");
    assert_eq!(new.mc_basic.as_deref(), Some("Basic dXNlcjpwYXNz"));
    assert!(Arc::ptr_eq(&old.store, &new.store), "切换配置不能复制 cookie 罐");
    assert!(Arc::ptr_eq(&old.mc, &new.mc), "切换配置不能丢失 MonkeyCode 会话");
    assert!(Arc::ptr_eq(&old.wx, &new.wx), "切换配置不能中断扫码状态");

    let llm_only = crate::config::DesktopConfig {
        mc_llm_base_url: "https://another-llm.example.com/v1".into(),
        ..cfg
    };
    assert!(state.apply_config(&llm_only, &pipes).is_none(), "只换 LLM 地址不是 cloud transport 切换");
    assert_eq!(state.transport_generation(), 1, "地址 + Basic 的单一判据只应推进一次代次");
    assert_eq!(state.service().mc_llm, "https://another-llm.example.com/v1");
}

/// 跳过 TLS 验证的作用域:仅私有化 mc 域;官方云与其他域恒验证;
/// 开关翻转按 transport 切换处理(关旧长连接、推进代次)。
#[test]
fn tls_skip_scoped_to_private_mc_domain() {
    let svc = Service::test_service(Endpoints {
        account: "https://account.example.com".into(),
        model_gateway: "https://models.example.com".into(),
        mcp_gateway: "https://mcp.example.com".into(),
        monkeycode: "https://old.example.com".into(),
    });
    let state = super::BaizhiState::new(svc);
    let pipes = super::monkeycode::CloudPipes::new();
    let u = |s: &str| reqwest::Url::parse(s).unwrap();

    let cfg = crate::config::DesktopConfig {
        mc_base_url: "https://self-signed.example.com".into(),
        mc_skip_tls_verify: true,
        ..Default::default()
    };
    assert!(state.apply_config(&cfg, &pipes).is_some());
    let svc = state.service();
    assert!(svc.tls_insecure_for(&u("https://self-signed.example.com/api/v1/public/captcha/challenge")));
    assert!(svc.tls_insecure_for(&u("https://self-signed.example.com:443/x")), "known 默认端口等价");
    assert!(!svc.tls_insecure_for(&u("https://self-signed.example.com:8443/x")), "端口不同即不同源");
    assert!(!svc.tls_insecure_for(&u("https://account.example.com/api")), "百智域恒验证");
    assert!(!svc.tls_insecure_for(&u("https://evil.example.com/")), "第三方域恒验证");
    assert!(svc.http_insecure.is_some() && svc.lp_insecure.is_some(), "免验证客户端应已构建");

    // 只翻开关(地址/Basic 不变)也是 transport 切换:免验证与验证客户端的
    // 握手行为不同,在途长连接不得跨形态延续
    let off = crate::config::DesktopConfig { mc_skip_tls_verify: false, ..cfg.clone() };
    assert!(state.apply_config(&off, &pipes).is_some(), "开关翻转应推进 transport 代次");
    let svc = state.service();
    assert!(!svc.tls_insecure_for(&u("https://self-signed.example.com/x")));
    assert!(svc.http_insecure.is_none() && svc.lp_insecure.is_none());

    // 官方云 + 开关残留:恒不生效(开关只为私有化自签而设,不弱化官方域)
    let official = crate::config::DesktopConfig { mc_base_url: String::new(), mc_skip_tls_verify: true, ..Default::default() };
    assert!(state.apply_config(&official, &pipes).is_some());
    let svc = state.service();
    assert!(!svc.mc_skip_tls, "官方云地址下开关不得生效");
    assert!(svc.http_insecure.is_none());
    assert!(!svc.tls_insecure_for(&u(&format!("{}/api", super::DEFAULT_MONKEYCODE_URL))));
}

#[test]
fn member_key_transport_binds_server_and_basic_identity() {
    let server = "https://private.example.com";
    let llm = "https://private.example.com/v1";
    let one = "Basic dXNlcjpvbmU=";
    let two = "Basic dXNlcjp0d28=";
    let key = json!({
        "id": "k1",
        "api_key": "secret",
        "transport": super::mc_transport_fingerprint(server, Some(one)),
    });
    assert!(super::ohmyagent_key_matches_transport(&key, server, llm, Some(one)));
    assert!(!super::ohmyagent_key_matches_transport(&key, server, llm, Some(two)));
    assert!(!super::ohmyagent_key_matches_transport(
        &key,
        "https://other.example.com",
        "https://other.example.com/v1",
        Some(one),
    ));

    let legacy = json!({ "id": "k1", "api_key": "secret", "server": server, "base_url": llm });
    assert!(super::ohmyagent_key_matches_transport(&legacy, server, llm, None));
    assert!(!super::ohmyagent_key_matches_transport(&legacy, server, llm, Some(one)));
}

#[test]
fn stale_member_key_commit_and_logout_cannot_touch_new_service() {
    let svc = Service::test_service(Endpoints {
        account: "https://account.example.com".into(),
        model_gateway: "https://models.example.com".into(),
        mcp_gateway: "https://mcp.example.com".into(),
        monkeycode: "https://old.example.com".into(),
    });
    let state = super::BaizhiState::new(svc);
    let (_old, old_generation) = state.service_snapshot();
    let pipes = super::monkeycode::CloudPipes::new();
    let cfg = crate::config::DesktopConfig {
        mc_base_url: "https://new.example.com".into(),
        ..Default::default()
    };
    state.apply_config(&cfg, &pipes);
    let (current, current_generation) = state.service_snapshot();
    assert!(
        state.service_snapshot_if_current(Some(old_generation)).is_none(),
        "排队中的旧代次命令不得在拿锁后改为操作新服务"
    );
    let current_url = reqwest::Url::parse("https://new.example.com/").unwrap();
    current.mc.update(&current_url, &["session=new; Path=/".into()]);

    let dir = std::env::temp_dir().join(format!("mc-stale-key-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(super::OHMYAGENT_KEY_FILE);
    assert!(state
        .commit_member_key(old_generation, &path, None, Some(br#"{"id":"old","api_key":"old"}"#))
        .is_err());
    assert!(!path.exists(), "旧服务迟到的创建结果不得写入新服务 Key 文件");
    assert!(!state.logout_if_current(old_generation, &pipes), "旧断开不得清理当前新服务");
    assert_eq!(current.mc.header(&current_url).as_deref(), Some("session=new"));

    std::fs::write(&path, b"first").unwrap();
    std::fs::write(&path, b"replacement").unwrap();
    assert!(state.commit_member_key(current_generation, &path, Some(b"first"), None).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"replacement", "文件身份变化后不得误删替代者");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stale_service_response_cannot_overwrite_current_monkeycode_cookie() {
    let svc = Service::test_service(Endpoints {
        account: "https://account.example.com".into(),
        model_gateway: "https://models.example.com".into(),
        mcp_gateway: "https://mcp.example.com".into(),
        monkeycode: "http://localhost:8000".into(),
    });
    let state = super::BaizhiState::new(svc);
    let old = state.service();
    let cfg = crate::config::DesktopConfig {
        mc_base_url: "http://localhost:9000".into(),
        mc_basic_auth: "new-auth".into(),
        ..Default::default()
    };
    let pipes = super::monkeycode::CloudPipes::new();

    state.apply_config(&cfg, &pipes);
    let current = state.service();
    let current_url = reqwest::Url::parse(&format!("{}/", current.ep.monkeycode)).unwrap();
    let old_url = reqwest::Url::parse(&format!("{}/", old.ep.monkeycode)).unwrap();
    current.update_response_cookies(&current.mc, &current_url, &["session=new; Path=/".into()]);
    old.update_response_cookies(&old.mc, &old_url, &["session=old; Path=/".into()]);

    assert_eq!(current.mc.header(&current_url).as_deref(), Some("session=new"));
}

/// 模型请求地址(llmproxy)的解析口径,2026-08-07 用户定案:官方云走独立
/// 代理子域,自建看用户填没填——填了用填的,没填跟随服务地址 /v1。
#[test]
fn mc_llm_resolution_prefers_proxy_on_official_cloud() {
    use super::{
        resolve_mc_llm, DEFAULT_MONKEYCODE_LLM_URL, DEFAULT_MONKEYCODE_URL, INTL_MONKEYCODE_LLM_URL,
        INTL_MONKEYCODE_URL,
    };
    assert_eq!(resolve_mc_llm("", DEFAULT_MONKEYCODE_URL), DEFAULT_MONKEYCODE_LLM_URL);
    assert_eq!(
        resolve_mc_llm("", "https://monkeycode-ai.com/"),
        DEFAULT_MONKEYCODE_LLM_URL,
        "尾斜杠归一后仍认作官方云"
    );
    assert_eq!(resolve_mc_llm("", INTL_MONKEYCODE_URL), INTL_MONKEYCODE_LLM_URL);
    assert_eq!(
        resolve_mc_llm("", "https://monkeycode-ai.net/"),
        INTL_MONKEYCODE_LLM_URL,
        "国际版官方云同样走独立代理子域"
    );
    assert_eq!(
        resolve_mc_llm("", "https://self.example.com"),
        "https://self.example.com/v1",
        "自建未填:跟随服务地址(开源后端 llmproxy 挂在主服务 /v1)"
    );
    assert_eq!(
        resolve_mc_llm(" https://llm.self.example.com/v1/ ", "https://self.example.com"),
        "https://llm.self.example.com/v1",
        "自建填了:原样用(trim + 尾斜杠归一)"
    );
    assert_eq!(
        resolve_mc_llm("https://llm.example.com/v1", DEFAULT_MONKEYCODE_URL),
        "https://llm.example.com/v1",
        "显式值压过官方云默认"
    );
}

/// ai-models 真机契约:控制台只管密钥;模型清单用该密钥请求
/// /api/anthropic/models。清单按 Anthropic data/has_more 分页,条目标识为 id。
#[tokio::test(flavor = "multi_thread")]
async fn ai_models_sync_contract() {
    let (url, _stop) = serve(Arc::new(|req: Req| {
        match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/api/console/api-keys") => Resp::json(200, json!({ "data": [] })),
            ("POST", "/api/console/api-keys") => {
                let body = body_json(&req.body);
                assert_eq!(body.get("name").and_then(Value::as_str), Some("MonkeyCode"));
                assert_eq!(body.get("quota_enabled").and_then(Value::as_bool), Some(false));
                assert_eq!(body.get("ip_whitelist").and_then(Value::as_array).map(Vec::len), Some(0));
                Resp::json(
                    200,
                    json!({
                        "data": {
                            "id": "key-1",
                            "name": "MonkeyCode",
                            "api_key": "sk-live",
                            "status": "active"
                        }
                    }),
                )
            }
            ("GET", "/api/anthropic/models") => {
                assert_eq!(req.authorization, "Bearer sk-live");
                Resp::json(
                    200,
                    json!({
                        "data": [
                            {"id": "coding-model", "type": "model", "display_name": "Coding Model"},
                            {"id": "reasoning-model", "type": "model", "display_name": "Reasoning Model"}
                        ],
                        "has_more": true
                    }),
                )
            }
            ("GET", "/api/anthropic/models?after_id=reasoning-model") => {
                assert_eq!(req.authorization, "Bearer sk-live");
                Resp::json(
                    200,
                    json!({
                        "data": [{"id": "new-model", "type": "model", "display_name": "New Model"}],
                        "has_more": false
                    }),
                )
            }
            ("GET", "/") => Resp::json(200, json!({})),
            ("GET", "/api/v1/services") => Resp::redirect("/apply"),
            _ => Resp::json(404, json!({ "error": {"message": "not found"} })),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url.clone(),
    });

    let synced = super::sync::sync(&svc, &[]).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(synced.get("key_created").and_then(Value::as_bool), Some(true));
    let models = synced.get("models").and_then(Value::as_array).unwrap();
    assert_eq!(models.len(), 3, "应合并推理接口的所有分页");
    assert_eq!(models[0].get("name").and_then(Value::as_str), Some("coding-model"));
    assert_eq!(models[1].get("name").and_then(Value::as_str), Some("reasoning-model"));
    assert_eq!(models[2].get("name").and_then(Value::as_str), Some("new-model"));
    assert_eq!(models[0].get("provider").and_then(Value::as_str), Some("anthropic"));
    let expected_base_url = format!("{url}/api/anthropic");
    assert_eq!(models[0].get("base_url").and_then(Value::as_str), Some(expected_base_url.as_str()));
    assert_eq!(models[0].get("api_key").and_then(Value::as_str), Some("sk-live"));
}

/// 控制台密钥列表的旧版契约:data 套 {items,total} 分页对象、数组在
/// items 里(2026-08-12 用户现场,两代服务端并存)。必须兼容,否则这类
/// 部署上同步永远"响应格式异常";已持有的密钥照常识别复用,不重复创建。
#[tokio::test(flavor = "multi_thread")]
async fn console_api_keys_items_wrapper_contract() {
    let (url, _stop) = serve(Arc::new(|req: Req| {
        match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/api/console/api-keys") => Resp::json(
                200,
                json!({ "data": { "items": [
                    { "id": "key-1", "name": "MonkeyCode", "api_key": "sk-live", "status": "active" }
                ], "total": 1 } }),
            ),
            ("GET", "/api/anthropic/models") => Resp::json(
                200,
                json!({ "data": [{ "id": "coding-model", "type": "model" }], "has_more": false }),
            ),
            _ => Resp::json(404, json!({ "error": { "message": "not found" } })),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url.clone(),
    });
    let synced = super::sync::sync(&svc, &["sk-live".to_string()]).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(synced.get("key_created").and_then(Value::as_bool), Some(false), "items 包裹形态下应识别并复用既有密钥");
    let models = synced.get("models").and_then(Value::as_array).unwrap();
    assert_eq!(models[0].get("name").and_then(Value::as_str), Some("coding-model"));
}

/// cookie 失效的真实形态必须翻译成"登录失效",不能报"响应格式异常"
/// (2026-08-12 反馈):控制台/云端过期后常回 2xx 登录页 HTML(unwrap_envelope
/// 对 2xx 宽容折成 Null)或 302 踢登录页,两种都不是标准 401。
#[tokio::test(flavor = "multi_thread")]
async fn expired_session_reports_relogin_not_format_error() {
    let login_page = || Resp {
        status: 200,
        headers: vec![("Content-Type".into(), "text/html".into())],
        body: b"<!doctype html><html>login</html>".to_vec(),
    };
    let endpoints = |url: &str| Endpoints {
        account: url.to_string(),
        model_gateway: url.to_string(),
        mcp_gateway: url.to_string(),
        monkeycode: url.to_string(),
    };

    // 百智云控制台:200 + 登录页 HTML
    let (url, _stop) = serve(Arc::new(move |req: Req| match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/console/api-keys") => login_page(),
        _ => Resp::json(404, json!({})),
    }));
    let err = super::sync::sync(&Service::test_service(endpoints(&url)), &[]).await.err().expect("应失败").msg();
    assert!(err.contains("百智云登录已失效"), "{err}");

    // 百智云控制台:302 踢去登录页
    let (url, _stop) = serve(Arc::new(|req: Req| match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/api/console/api-keys") => Resp::redirect("/login"),
        _ => Resp::json(404, json!({})),
    }));
    let err = super::sync::sync(&Service::test_service(endpoints(&url)), &[]).await.err().expect("应失败").msg();
    assert!(err.contains("百智云登录已失效"), "{err}");

    // MonkeyCode:users/models 回 200 + 登录页 HTML
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        match (req.method.as_str(), req.path.split('?').next().unwrap()) {
            ("GET", "/api/v1/users/models") => login_page(),
            _ => Resp::json(404, json!({})),
        }
    }));
    let err = super::monkeycode::mc_member_models_sync(&Service::test_service(endpoints(&url)))
        .await
        .err()
        .expect("应失败")
        .msg();
    assert!(err.contains("MonkeyCode 会话已失效"), "{err}");
}

/// prng 复刻(服务端独立校验 PoW 解;与 pow.rs 实现同协议)。
fn prng(seed: &str, length: usize) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for b in seed.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    let mut state = hash;
    let mut out = String::new();
    while out.len() < length {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        out.push_str(&format!("{state:08x}"));
    }
    out.truncate(length);
    out
}

/// 手机号登录全链路:challenge(201) → redeem(独立校验解) → 发码 → 登录种
/// cookie → profile 校验 cookie(对照 Go TestLoginFlow)。
#[tokio::test(flavor = "multi_thread")]
async fn login_flow() {
    let state = Arc::new(Mutex::new((String::new(), String::new(), String::new()))); // (challenge_token, captcha_token, session)
    let st = state.clone();
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        let mut s = st.lock().unwrap();
        match (req.method.as_str(), req.path.split('?').next().unwrap()) {
            ("POST", "/api/v1/public/captcha/challenge") => {
                s.0 = "chtok-123".into();
                // 真实服务端回 201,钉住 2xx 兼容
                Resp::json(201, json!({ "challenge": {"c": 3, "s": 32, "d": 3}, "token": s.0 }))
            }
            ("POST", "/api/v1/public/captcha/redeem") => {
                let b = body_json(&req.body);
                let token = b.get("token").and_then(|v| v.as_str()).unwrap_or("");
                let sols: Vec<u64> = b
                    .get("solutions")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_u64()).collect())
                    .unwrap_or_default();
                if token != s.0 || sols.len() != 3 {
                    return Resp::json(200, json!({ "success": false, "message": "质询不匹配" }));
                }
                // 独立校验每个解(协议本身的校验逻辑,与求解器实现无关)
                for (i, nonce) in sols.iter().enumerate() {
                    let idx = (i + 1).to_string();
                    let salt = prng(&format!("{token}{idx}"), 32);
                    let target = prng(&format!("{token}{idx}d"), 3);
                    let mut h = Sha256::new();
                    h.update(salt.as_bytes());
                    h.update(nonce.to_string().as_bytes());
                    let hex = h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
                    if !hex.starts_with(&target) {
                        return Resp::json(200, json!({ "success": false, "message": "PoW 解无效" }));
                    }
                }
                s.1 = "captok-456".into();
                Resp::json(200, json!({ "success": true, "token": s.1 }))
            }
            ("POST", "/api/v1/user/phone_code") => {
                let b = body_json(&req.body);
                if b.get("captcha_token").and_then(|v| v.as_str()) != Some(s.1.as_str()) {
                    return Resp::json(400, json!({ "code": 400, "message": "验证码无效 [trace_id:abc123]" }));
                }
                assert_eq!(b.get("kind").and_then(|v| v.as_str()), Some("login"));
                Resp::json(200, json!({ "code": 0 }))
            }
            ("POST", "/api/v1/user/login/phone") => {
                let b = body_json(&req.body);
                if b.get("phone").and_then(|v| v.as_str()) != Some("13800138000")
                    || b.get("code").and_then(|v| v.as_str()) != Some("123456")
                {
                    return Resp::json(400, json!({ "code": 401, "message": "验证码错误" }));
                }
                s.2 = "sess-789".into();
                Resp::json(200, json!({ "code": 0 })).with_cookie("baizhi_session=sess-789; Path=/; HttpOnly")
            }
            ("GET", "/api/v1/user/profile") => {
                if s.2.is_empty() || !req.cookie.contains(&format!("baizhi_session={}", s.2)) {
                    return Resp { status: 401, headers: vec![], body: b"Unauthorized".to_vec() };
                }
                Resp::json(200, json!({ "code": 0, "data": {"phone": "13800138000", "name": "测试用户"} }))
            }
            _ => Resp::json(404, json!({ "message": "not found" })),
        }
    }));

    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url.clone(),
    });

    // 未登录状态
    let (li, _) = svc.status().await.map_err(|e| e.msg()).unwrap();
    assert!(!li);

    // 发码 + 登录
    svc.send_phone_code("13800138000").await.map_err(|e| e.msg()).unwrap();
    svc.login_phone("13800138000", "123456").await.map_err(|e| e.msg()).unwrap();

    // 会话已持久化,profile 探测为已登录
    let (li, profile) = svc.status().await.map_err(|e| e.msg()).unwrap();
    assert!(li);
    assert_eq!(profile.get("name").and_then(|v| v.as_str()), Some("测试用户"));

    // 登出清罐
    svc.store.clear();
    let (li, _) = svc.status().await.map_err(|e| e.msg()).unwrap();
    assert!(!li);
}

/// trace_id 清洗:验证失败 message 尾部标注被剥掉(对照 Go TestSendCodeError)。
#[tokio::test(flavor = "multi_thread")]
async fn error_message_cleaned() {
    let (url, _stop) = serve(Arc::new(|req: Req| {
        match req.path.split('?').next().unwrap() {
            "/api/v1/public/captcha/challenge" => {
                Resp::json(201, json!({ "challenge": {"c": 1, "s": 8, "d": 1}, "token": "t" }))
            }
            "/api/v1/public/captcha/redeem" => Resp::json(200, json!({ "success": true, "token": "cap" })),
            _ => Resp::json(400, json!({ "code": 400, "message": "验证码无效 [trace_id:abc123]" })),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url,
    });
    let err = svc.send_phone_code("13800138000").await.err().map(|e| e.msg()).unwrap();
    assert_eq!(err, "验证码无效");
}

/// MonkeyCode 桥接登录:手动跟随重定向链(mc → 授权页改写 API → 回调种
/// mc cookie → 前端页 2xx),cookie 分罐(对照 Go TestLoginMonkeyCode)。
#[tokio::test(flavor = "multi_thread")]
async fn monkeycode_bridge_login() {
    // 两个"域":account 与 mc(同 IP 不同端口,storeFor 按 host:port 分罐)
    let mc_session = Arc::new(Mutex::new(String::new()));

    // account 假服务:授权 API 校验百智 cookie 后 302 回 mc callback
    let ms = mc_session.clone();
    let mc_url_holder: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let mh = mc_url_holder.clone();
    let (account_url, _s1) = serve(Arc::new(move |req: Req| {
        match req.path.split('?').next().unwrap() {
            "/api/v1/oauth/authorize" => {
                // 必须带百智会话 cookie
                if !req.cookie.contains("baizhi_session=sess-1") {
                    return Resp { status: 401, headers: vec![], body: b"{}".to_vec() };
                }
                // 校验参数齐全(response_type=code)
                assert!(req.path.contains("client_id=cid"));
                assert!(req.path.contains("response_type=code"));
                let mc = mh.lock().unwrap().clone();
                Resp::redirect(&format!("{mc}/api/v1/users/login/callback?code=authcode-1"))
            }
            "/api/v1/user/profile" => Resp::json(200, json!({ "code": 0, "data": {"name": "u"} })),
            _ => Resp::json(404, json!({})),
        }
    }));

    // mc 假服务:login 302 到授权"页面";callback 种 mc 会话再 302 前端;status 校验 cookie
    let ms2 = mc_session.clone();
    let account2 = account_url.clone();
    let (mc_url, _s2) = serve(Arc::new(move |req: Req| {
        match req.path.split('?').next().unwrap() {
            "/api/v1/users/login" => Resp::redirect(&format!(
                "{account2}/oauth/authorize?client_id=cid&redirect_uri={account2}/cb&scope=all&state=st1"
            )),
            "/api/v1/users/login/callback" => {
                assert!(req.path.contains("code=authcode-1"));
                *ms2.lock().unwrap() = "mcsess-1".into();
                Resp::redirect("/dashboard").with_cookie("mc_session=mcsess-1; Path=/; HttpOnly")
            }
            "/dashboard" => Resp::json(200, json!({ "ok": true })),
            "/api/v1/users/status" => {
                let sess = ms2.lock().unwrap().clone();
                if sess.is_empty() || !req.cookie.contains(&format!("mc_session={sess}")) {
                    return Resp::json(200, json!({ "code": 0, "data": {"user": {}} }));
                }
                Resp::json(200, json!({ "code": 0, "data": {"user": {"id": "u1", "name": "云端用户"}} }))
            }
            _ => Resp::json(404, json!({})),
        }
    }));
    *mc_url_holder.lock().unwrap() = mc_url.clone();
    let _ = ms;

    let svc = Service::test_service(Endpoints {
        account: account_url.clone(),
        model_gateway: account_url.clone(),
        mcp_gateway: account_url.clone(),
        monkeycode: mc_url,
    });

    // 未持有百智会话 → 拒绝
    assert!(super::monkeycode::login_monkeycode(&svc).await.is_err());

    // 种百智会话后走通桥接
    svc.store.update(
        &reqwest::Url::parse(&format!("{account_url}/")).unwrap(),
        &["baizhi_session=sess-1; Path=/".to_string()],
    );
    let user = super::monkeycode::login_monkeycode(&svc).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(user.get("id").and_then(|v| v.as_str()), Some("u1"));

    // mc 会话已入独立罐:status 走 mc 罐;百智登出不影响云端会话
    let (li, user) = super::monkeycode::mc_status(&svc).await.map_err(|e| e.msg()).unwrap();
    assert!(li);
    assert_eq!(user.get("name").and_then(|v| v.as_str()), Some("云端用户"));
    svc.store.clear();
    let (li, _) = super::monkeycode::mc_status(&svc).await.map_err(|e| e.msg()).unwrap();
    assert!(li, "百智登出不应牵连 MonkeyCode 会话");
}

/// 账号密码直连登录契约(对齐 mobile/backend):MC 域 PoW 验证码
/// (challenge 201 裸结构、redeem 成功 201/失败 500,服务端按协议独立校验
/// 解)→ password-login(email 精确、password **明文原样**含尾空格、
/// captcha_token 必带)种 monkeycode_ai_session cookie → status 权威确认;
/// 全程不碰百智罐(双罐隔离)。业务失败统一 200+code10606「登录失败」透传。
#[tokio::test(flavor = "multi_thread")]
async fn monkeycode_password_login_contract() {
    let state = Arc::new(Mutex::new((String::new(), String::new(), String::new()))); // (challenge_token, captcha_token, session)
    let st = state.clone();
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        let mut s = st.lock().unwrap();
        match (req.method.as_str(), req.path.split('?').next().unwrap()) {
            ("POST", "/api/v1/public/captcha/challenge") => {
                s.0 = "mc-chtok".into();
                // 真实服务端(go-cap)回 201 + 裸结构(不套 {code,data} 包壳)
                Resp::json(201, json!({ "challenge": {"c": 3, "s": 32, "d": 3}, "token": s.0 }))
            }
            ("POST", "/api/v1/public/captcha/redeem") => {
                let b = body_json(&req.body);
                let token = b.get("token").and_then(|v| v.as_str()).unwrap_or("");
                let sols: Vec<u64> = b
                    .get("solutions")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_u64()).collect())
                    .unwrap_or_default();
                if token != s.0 || sols.len() != 3 {
                    // 真实失败形态:HTTP 500 + {success:false,message}
                    return Resp::json(500, json!({ "success": false, "message": "质询不匹配" }));
                }
                // 服务端独立校验每个解(与 login_flow 同一套协议复刻)
                for (i, nonce) in sols.iter().enumerate() {
                    let idx = (i + 1).to_string();
                    let salt = prng(&format!("{token}{idx}"), 32);
                    let target = prng(&format!("{token}{idx}d"), 3);
                    let mut h = Sha256::new();
                    h.update(salt.as_bytes());
                    h.update(nonce.to_string().as_bytes());
                    let hex = h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
                    if !hex.starts_with(&target) {
                        return Resp::json(500, json!({ "success": false, "message": "PoW 解无效" }));
                    }
                }
                s.1 = "mc-captok".into();
                // 真实成功形态:HTTP 201
                Resp::json(201, json!({ "success": true, "token": s.1 }))
            }
            ("POST", "/api/v1/users/password-login") => {
                let b = body_json(&req.body);
                if b.get("captcha_token").and_then(Value::as_str) != Some(s.1.as_str()) {
                    // captcha 校验失败的真实形态(errcode.ErrForbidden)
                    return Resp::json(403, json!({ "code": 403, "message": "禁止访问" }));
                }
                if b.get("email").and_then(Value::as_str) != Some("dev@monkeycode.io") {
                    // 密码错/用户不存在统一折叠为 10606(HTTP 200)
                    return Resp::json(200, json!({ "code": 10606, "message": "登录失败" }));
                }
                // password 明文原样:尾空格必须保留(mobile/web 均不 trim 不哈希)
                assert_eq!(b.get("password").and_then(Value::as_str), Some("p@ss word "));
                s.2 = "mc-sess-1".into();
                Resp::json(200, json!({ "code": 0, "data": {"id": "u9", "email": "dev@monkeycode.io"} }))
                    .with_cookie("monkeycode_ai_session=mc-sess-1; Path=/; HttpOnly")
            }
            ("GET", "/api/v1/users/status") => {
                let sess = s.2.clone();
                if sess.is_empty() || !req.cookie.contains(&format!("monkeycode_ai_session={sess}")) {
                    return Resp::json(200, json!({ "code": 0, "data": {"user": {}} }));
                }
                Resp::json(200, json!({ "code": 0, "data": {"user": {"id": "u9", "name": "账密用户"}} }))
            }
            _ => Resp::json(404, json!({ "code": 1, "message": "not found" })),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url.clone(),
    });

    // 业务失败:10606「登录失败」原样透传,会话不建立
    let err = super::monkeycode::login_monkeycode_password(&svc, "wrong@x.com", "whatever")
        .await
        .err()
        .map(|e| e.msg())
        .unwrap();
    assert_eq!(err, "登录失败");
    let (li, _) = super::monkeycode::mc_status(&svc).await.map_err(|e| e.msg()).unwrap();
    assert!(!li, "登录失败不应建立会话");

    // 成功:PoW → 登录种 cookie → status 权威确认
    let user = super::monkeycode::login_monkeycode_password(&svc, "dev@monkeycode.io", "p@ss word ")
        .await
        .map_err(|e| e.msg())
        .unwrap();
    assert_eq!(user.get("id").and_then(Value::as_str), Some("u9"));
    assert_eq!(user.get("name").and_then(Value::as_str), Some("账密用户"));
    let (li, u) = super::monkeycode::mc_status(&svc).await.map_err(|e| e.msg()).unwrap();
    assert!(li);
    assert_eq!(u.get("id").and_then(Value::as_str), Some("u9"));
    // 双罐隔离:整个账密链路(含 MC 域验证码)不得污染百智罐
    assert!(svc.store.is_empty(), "百智罐必须始终为空");
}

/// 测试环境反代 Basic Auth:仅 MonkeyCode 域的请求附 Authorization 头
/// ("Basic <b64(user:pass)>",对齐 mobile 的 authHeaders);百智域零附加
/// (业务鉴权走 cookie,该头在 MC 的 REST/WS 链路上是空闲的)。
#[tokio::test(flavor = "multi_thread")]
async fn basic_auth_header_scoped_to_mc_host() {
    let mc_auth: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let bz_auth: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let cap_mc = mc_auth.clone();
    let (mc_url, _s1) = serve(Arc::new(move |req: Req| {
        cap_mc.lock().unwrap().push(req.authorization.clone());
        Resp::json(200, json!({ "code": 0, "data": { "projects": [] } }))
    }));
    let cap_bz = bz_auth.clone();
    let (bz_url, _s2) = serve(Arc::new(move |req: Req| {
        cap_bz.lock().unwrap().push(req.authorization.clone());
        Resp::json(200, json!({ "code": 0, "data": {} }))
    }));
    let mut svc = Service::test_service(Endpoints {
        account: bz_url.clone(),
        model_gateway: bz_url.clone(),
        mcp_gateway: bz_url.clone(),
        monkeycode: mc_url.clone(),
    });
    svc.mc_basic = super::basic_header_value("user:pass");
    assert_eq!(svc.mc_basic.as_deref(), Some("Basic dXNlcjpwYXNz"));
    assert!(super::basic_header_value("  ").is_none(), "空白 = 未配置");

    super::monkeycode::mc_projects(&svc).await.map_err(|e| e.msg()).unwrap();
    svc.call(reqwest::Method::GET, "/api/v1/user/profile", None).await.map_err(|e| e.msg()).unwrap();

    assert_eq!(mc_auth.lock().unwrap().as_slice(), ["Basic dXNlcjpwYXNz"], "MC 域必须附 Basic 头");
    assert_eq!(bz_auth.lock().unwrap().as_slice(), [""], "百智域不得附 Basic 头");
}

/// 包壳解包策略:四链路(百智云/网关/MCP 网关/MonkeyCode)的差异点钉死,
/// 防止合一后语义漂移(code 合法值集合、3xx/401 处理、data 兜底)。
#[test]
fn envelope_policies_pinned() {
    use super::monkeycode::ENV_MC;
    use super::sync::{ENV_CONSOLE, ENV_MCP};
    let unauthorized = |r: super::BzResult<Value>| match r {
        Err(BzErr::Unauthorized(m)) => m,
        Err(BzErr::Other(m)) => panic!("应为 Unauthorized,实为 Other: {m}"),
        Ok(v) => panic!("应失败,实为成功: {v}"),
    };
    let err_msg = |r: super::BzResult<Value>| match r {
        Err(BzErr::Other(m)) => m,
        Err(BzErr::Unauthorized(m)) => panic!("应为 Other,实为 Unauthorized: {m}"),
        Ok(v) => panic!("应失败,实为成功: {v}"),
    };

    // 百智云:success=false 即失败;缺 data 回整个响应体(对齐移动端)
    let body = r#"{"success":false,"message":"坏了 [trace_id:x]"}"#.as_bytes();
    assert_eq!(err_msg(unwrap_envelope(body, 200, &ENV_BAIZHI)), "坏了");
    let whole = unwrap_envelope(br#"{"code":0,"foo":1}"#, 200, &ENV_BAIZHI).map_err(|e| e.msg()).unwrap();
    assert_eq!(whole.get("foo").and_then(|v| v.as_i64()), Some(1));
    // 401 带 message → Unauthorized 透传业务文案
    let m = unauthorized(unwrap_envelope(r#"{"code":1,"message":"过期"}"#.as_bytes(), 401, &ENV_BAIZHI));
    assert_eq!(m, "过期");

    // 网关:无 success 字段检查;缺 data 兜底 Null;401 无 message 走固定文案
    let v = unwrap_envelope(br#"{"code":0,"success":false}"#, 200, &ENV_CONSOLE).map_err(|e| e.msg()).unwrap();
    assert!(v.is_null());
    let m = unauthorized(unwrap_envelope(br#"{}"#, 401, &ENV_CONSOLE));
    assert!(m.contains("会话已失效"), "{m}");
    // 控制台 cookie 鉴权:3xx = 被踢去登录页,给"登录失效"而非裸 HTTP 状态码
    let m = err_msg(unwrap_envelope(b"", 302, &ENV_CONSOLE));
    assert!(m.contains("登录已失效"), "{m}");

    // MCP 网关:3xx = 未开通;code 认 "ok"/0/200,其余字符串/类型判失败
    let m = err_msg(unwrap_envelope(b"", 302, &ENV_MCP));
    assert!(m.contains("未开通"), "{m}");
    assert!(unwrap_envelope(br#"{"code":"ok","data":1}"#, 200, &ENV_MCP).is_ok());
    assert!(unwrap_envelope(br#"{"code":200,"data":1}"#, 200, &ENV_MCP).is_ok());
    assert!(unwrap_envelope(br#"{"code":"err","message":"x"}"#, 200, &ENV_MCP).is_err());
    assert!(unwrap_envelope(br#"{"code":true}"#, 200, &ENV_MCP).is_err());

    // MonkeyCode:401 不看响应体,固定"到设置中重新连接"(中性,不偏向
    // 桥接或账密任一登录方式;与百智云的"重新登录"语义不同)
    let m = unauthorized(unwrap_envelope(r#"{"code":1,"message":"别的话"}"#.as_bytes(), 401, &ENV_MC));
    assert_eq!(m, "MonkeyCode 会话已失效,请在设置中重新连接");
    // 业务失败走清洗后的 message;缺 data 兜底 Null
    assert_eq!(err_msg(unwrap_envelope(r#"{"code":7,"message":"忙 [trace_id:y]"}"#.as_bytes(), 200, &ENV_MC)), "忙");
    assert!(unwrap_envelope(br#"{"code":0}"#, 200, &ENV_MC).map_err(|e| e.msg()).unwrap().is_null());
    // 账密登录的 captcha 校验失败形态:HTTP 403 + message,非 401 → Other 透传
    assert_eq!(err_msg(unwrap_envelope(r#"{"code":403,"message":"禁止访问"}"#.as_bytes(), 403, &ENV_MC)), "禁止访问");
}

/// rounds 归一化:event→type、纳秒→毫秒、seq/kind/data 透传(对照 Go TestTaskRounds)。
#[tokio::test(flavor = "multi_thread")]
async fn rounds_normalization() {
    let (url, _stop) = serve(Arc::new(|req: Req| {
        match req.path.split('?').next().unwrap() {
            "/api/v1/users/tasks/rounds" => Resp::json(
                200,
                json!({ "code": 0, "data": {
                    "chunks": [
                        { "event": "task-running", "kind": "acp_event", "data": "eyJ4IjoxfQ==",
                          "timestamp": 1_752_000_000_123_456_789i64, "seq": 7 },
                        { "event": "task-ended", "timestamp": 1_752_000_000_123i64, "seq": 8 }
                    ],
                    "next_cursor": "c2", "has_more": true
                } }),
            ),
            _ => Resp::json(404, json!({})),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url,
    });
    // mc 罐需非空(代理守卫);种一个假 cookie
    svc.mc.update(
        &reqwest::Url::parse("https://monkeycode-ai.com/").unwrap(),
        &["mc_session=x; Path=/".to_string()],
    );
    let out = super::monkeycode::mc_task_rounds(&svc, "t1", "", 2).await.map_err(|e| e.msg()).unwrap();
    let frames = out.get("frames").and_then(|v| v.as_array()).unwrap();
    assert_eq!(frames.len(), 2);
    // 纳秒 → 毫秒
    assert_eq!(frames[0].get("timestamp").and_then(|v| v.as_i64()), Some(1_752_000_000_123));
    assert_eq!(frames[0].get("type").and_then(|v| v.as_str()), Some("task-running"));
    assert_eq!(frames[0].get("kind").and_then(|v| v.as_str()), Some("acp_event"));
    assert_eq!(frames[0].get("seq").and_then(|v| v.as_u64()), Some(7));
    // 已是毫秒 → 原样
    assert_eq!(frames[1].get("timestamp").and_then(|v| v.as_i64()), Some(1_752_000_000_123));
    assert!(frames[1].get("kind").is_none());
    assert_eq!(out.get("next_cursor").and_then(|v| v.as_str()), Some("c2"));
    assert_eq!(out.get("has_more").and_then(|v| v.as_bool()), Some(true));
}

/// 建任务档位:req 未显式下发时用壳内常量(现有真实云端行为);服务端在
/// models 应答里补 task_defaults 后经 options 透传,req 带上对应字段即优先
/// 生效——钉住"云端调档无需壳发版"的取用逻辑。
#[tokio::test(flavor = "multi_thread")]
async fn task_create_defaults_and_overrides() {
    let captured: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let cap = captured.clone();
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        match (req.method.as_str(), req.path.split('?').next().unwrap()) {
            ("POST", "/api/v1/users/tasks") => {
                cap.lock().unwrap().push(body_json(&req.body));
                Resp::json(200, json!({ "code": 0, "data": {"id": "t1"} }))
            }
            ("GET", "/api/v1/users/models") => Resp::json(
                200,
                json!({ "code": 0, "data": {
                    "models": [{"id": "m1"}],
                    // 服务端下发档位样例(现网暂无此字段)
                    "task_defaults": {
                        "host_id": "gpu_host",
                        "cli_name": "claude-code",
                        "resource": { "core": 4, "memory": 1024, "life": 60 },
                        "skill_ids": ["Org/main/skills/only-one"]
                    }
                } }),
            ),
            ("GET", "/api/v1/users/images") => Resp::json(200, json!({ "code": 0, "data": {"images": []} })),
            ("GET", "/api/v1/users/hosts") => Resp::json(
                200,
                json!({ "code": 0, "data": {"hosts": [{"id": "gpu_host", "status": "online"}] } }),
            ),
            _ => Resp::json(404, json!({ "code": 1, "message": "not found" })),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url,
    });

    // options 透传服务端 task_defaults
    let opts = super::monkeycode::mc_task_options(&svc).await.map_err(|e| e.msg()).unwrap();
    let defaults = opts.get("task_defaults").cloned().unwrap();
    assert_eq!(defaults.get("host_id").and_then(|v| v.as_str()), Some("gpu_host"));
    assert_eq!(opts.pointer("/hosts/0/id").and_then(|v| v.as_str()), Some("gpu_host"));

    // req 未带档位 → 壳内常量(与 mobile/Web 端一致的云端契约)
    let req = json!({ "content": "做点事", "model_id": "m1", "image_id": "i1" });
    super::monkeycode::mc_task_create(&svc, &req).await.map_err(|e| e.msg()).unwrap();
    let p = captured.lock().unwrap().last().cloned().unwrap();
    assert_eq!(p.get("host_id").and_then(|v| v.as_str()), Some("public_host"));
    assert_eq!(p.get("cli_name").and_then(|v| v.as_str()), Some("opencode"));
    assert_eq!(p.pointer("/resource/core").and_then(|v| v.as_u64()), Some(2));
    assert_eq!(p.pointer("/resource/memory").and_then(|v| v.as_u64()), Some(8 << 30));
    assert_eq!(p.pointer("/resource/life").and_then(|v| v.as_u64()), Some(3 * 60 * 60));
    assert_eq!(p.pointer("/extra/skill_ids").and_then(|v| v.as_array()).map(|a| a.len()), Some(4));
    assert_eq!(p.get("task_type").and_then(|v| v.as_str()), Some("develop"));

    // req 带上 options 下发的档位 → 覆盖常量
    let mut req2 = json!({ "content": "做点事", "model_id": "m1", "image_id": "i1" });
    for k in ["host_id", "cli_name", "resource", "skill_ids"] {
        req2[k] = defaults.get(k).cloned().unwrap();
    }
    super::monkeycode::mc_task_create(&svc, &req2).await.map_err(|e| e.msg()).unwrap();
    let p = captured.lock().unwrap().last().cloned().unwrap();
    assert_eq!(p.get("host_id").and_then(|v| v.as_str()), Some("gpu_host"));
    assert_eq!(p.get("cli_name").and_then(|v| v.as_str()), Some("claude-code"));
    assert_eq!(p.pointer("/resource/core").and_then(|v| v.as_u64()), Some(4));
    assert_eq!(
        p.pointer("/extra/skill_ids").and_then(|v| v.as_array()).map(|a| a.len()),
        Some(1)
    );
}

/// 桌面云端侧栏与 Web 使用同一组项目/任务管理接口：快速任务筛选、
/// 项目列表、终止和删除都由壳代理，凭证不进入 UI。
#[tokio::test(flavor = "multi_thread")]
async fn cloud_sidebar_and_task_actions_contract() {
    let captured: Arc<Mutex<Vec<(String, String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
    let cap = captured.clone();
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        cap.lock().unwrap().push((req.method.clone(), req.path.clone(), body_json(&req.body)));
        match (req.method.as_str(), req.path.split('?').next().unwrap()) {
            ("GET", "/api/v1/users/tasks") => {
                Resp::json(200, json!({ "code": 0, "data": { "tasks": [{"id": "t1"}] } }))
            }
            ("GET", "/api/v1/users/projects") => {
                Resp::json(200, json!({ "code": 0, "data": { "projects": [{"id": "p1"}] } }))
            }
            ("GET", "/api/v1/users/tasks/user-inputs") => Resp::json(
                200,
                json!({ "code": 0, "data": { "items": [{"id": "user-input-1", "content": "你好", "timestamp": 1_722_000_000_000_000_000_i64}], "next_cursor": "c2", "has_more": true } }),
            ),
            ("PUT", "/api/v1/users/tasks/stop") | ("DELETE", "/api/v1/users/tasks/t1") => {
                Resp::json(200, json!({ "code": 0, "data": {} }))
            }
            _ => Resp::json(404, json!({ "code": 1, "message": "not found" })),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url,
    });

    let tasks = super::monkeycode::mc_tasks(&svc, 1, 50, "pending,processing", "p/1", Some(true))
        .await
        .map_err(|e| e.msg())
        .unwrap();
    assert_eq!(tasks.pointer("/tasks/0/id").and_then(Value::as_str), Some("t1"));
    let projects = super::monkeycode::mc_projects(&svc).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(projects.pointer("/projects/0/id").and_then(Value::as_str), Some("p1"));
    // 提问索引(云端大纲):{items, next_cursor, has_more} 原样透传
    let inputs = super::monkeycode::mc_task_user_inputs(&svc, "t1", "c1", 100).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(inputs.pointer("/items/0/content").and_then(Value::as_str), Some("你好"));
    assert_eq!(inputs.get("next_cursor").and_then(Value::as_str), Some("c2"));
    assert_eq!(inputs.get("has_more").and_then(Value::as_bool), Some(true));
    super::monkeycode::mc_task_stop(&svc, "t1").await.map_err(|e| e.msg()).unwrap();
    super::monkeycode::mc_task_delete(&svc, "t1").await.map_err(|e| e.msg()).unwrap();

    let requests = captured.lock().unwrap();
    let list = requests.iter().find(|(method, path, _)| method == "GET" && path.starts_with("/api/v1/users/tasks?")).unwrap();
    assert!(list.1.contains("status=pending%2Cprocessing"));
    assert!(list.1.contains("project_id=p%2F1"));
    assert!(list.1.contains("quick_start=true"));
    assert!(requests.iter().any(|(method, path, _)| method == "GET" && path == "/api/v1/users/projects?limit=50"));
    assert!(requests.iter().any(|(method, path, _)| {
        method == "GET"
            && path.starts_with("/api/v1/users/tasks/user-inputs?")
            && path.contains("id=t1")
            && path.contains("limit=100")
            && path.contains("cursor=c1")
    }));
    assert!(requests.iter().any(|(method, path, body)| method == "PUT" && path == "/api/v1/users/tasks/stop" && body.get("id").and_then(Value::as_str) == Some("t1")));
    assert!(requests.iter().any(|(method, path, _)| method == "DELETE" && path == "/api/v1/users/tasks/t1"));
}

/// 账号权益契约:钱包/订阅/签到态/邀请四路并发取回,单路缺席(私有化部署
/// 只有订阅端点,其余 404)按 null 降级而不牵连其余;全部失败才整体报错。
/// 签到态取不到时是 null 而非 false——否则会误催已签到的用户。
#[tokio::test(flavor = "multi_thread")]
async fn mc_usage_contract() {
    let saas = Arc::new(AtomicBool::new(true)); // false = 只留订阅端点的自建部署
    let sub_ok = Arc::new(AtomicBool::new(true));
    let (o, s) = (saas.clone(), sub_ok.clone());
    let (url, _stop) = serve(Arc::new(move |req: Req| match req.path.split('?').next().unwrap() {
        "/api/v1/users/wallet" if o.load(Ordering::Relaxed) => Resp::json(
            200,
            json!({ "code": 0, "data": { "balance": 12_345_678, "daily_token_balance": 400_000, "daily_token_limit": 1_000_000 } }),
        ),
        "/api/v1/users/wallet/checkin" if o.load(Ordering::Relaxed) => {
            Resp::json(200, json!({ "code": 0, "data": { "checked_in": true } }))
        }
        "/api/v1/users/invitations" if o.load(Ordering::Relaxed) => Resp::json(
            200,
            json!({ "code": 0, "data": { "count": 2, "items": [{ "id": "u2", "name": "阿茂" }] } }),
        ),
        "/api/v1/users/subscription" if s.load(Ordering::Relaxed) => {
            Resp::json(200, json!({ "code": 0, "data": { "plan": "pro", "auto_renew": false } }))
        }
        _ => Resp::json(404, json!({ "code": 404, "message": "not found" })),
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url.clone(),
    });

    let usage = super::monkeycode::mc_usage(&svc).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(usage.pointer("/wallet/balance").and_then(Value::as_i64), Some(12_345_678));
    assert_eq!(usage.pointer("/subscription/plan").and_then(Value::as_str), Some("pro"));
    assert_eq!(usage.get("checked_in").and_then(Value::as_bool), Some(true));
    assert_eq!(usage.pointer("/invitations/count").and_then(Value::as_i64), Some(2));
    // 邀请链接与相对头像地址的解析基准,必须是完整基址(含协议/端口)
    assert_eq!(usage.get("base_url").and_then(Value::as_str), Some(url.as_str()));

    // 私有化部署:只剩订阅端点,会员等级照常可见,其余按 null 降级
    saas.store(false, Ordering::Relaxed);
    let usage = super::monkeycode::mc_usage(&svc).await.map_err(|e| e.msg()).unwrap();
    assert!(usage.get("wallet").unwrap().is_null());
    assert!(usage.get("checked_in").unwrap().is_null(), "签到态取不到时不能退化成 false");
    assert!(usage.get("invitations").unwrap().is_null());
    assert_eq!(usage.pointer("/subscription/plan").and_then(Value::as_str), Some("pro"));

    // 四路都不可用 = 真故障,如实报错
    sub_ok.store(false, Ordering::Relaxed);
    assert!(super::monkeycode::mc_usage(&svc).await.is_err());
}

/// 签到契约:壳内先取 MonkeyCode 域 PoW 验证码,再带 captcha_token POST
/// 签到端点(与账密登录同一套验证码,全程不碰百智罐)。PoW 求解本身由
/// monkeycode_password_login_contract 按协议校验,这里只盯签到这一跳。
#[tokio::test(flavor = "multi_thread")]
async fn mc_checkin_contract() {
    let captured: Arc<Mutex<Vec<(String, String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
    let cap = captured.clone();
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        let body = body_json(&req.body);
        cap.lock().unwrap().push((req.method.clone(), req.path.clone(), body.clone()));
        match (req.method.as_str(), req.path.split('?').next().unwrap()) {
            // go-cap:201 + 裸结构(不套 {code,data} 包壳)
            ("POST", "/api/v1/public/captcha/challenge") => {
                Resp::json(201, json!({ "challenge": { "c": 1, "s": 32, "d": 1 }, "token": "mc-chtok" }))
            }
            ("POST", "/api/v1/public/captcha/redeem") => {
                Resp::json(201, json!({ "success": true, "token": "mc-captoken" }))
            }
            ("POST", "/api/v1/users/wallet/checkin") => {
                if body.get("captcha_token").and_then(Value::as_str) != Some("mc-captoken") {
                    return Resp::json(403, json!({ "code": 403, "message": "禁止访问" }));
                }
                Resp::json(200, json!({ "code": 0, "data": { "credits": 100 } }))
            }
            _ => Resp::json(404, json!({ "code": 404, "message": "not found" })),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url,
    });

    super::monkeycode::mc_checkin(&svc).await.map_err(|e| e.msg()).unwrap();

    let requests = captured.lock().unwrap();
    assert!(requests.iter().any(|(m, p, _)| m == "POST" && p == "/api/v1/public/captcha/challenge"));
    assert!(requests
        .iter()
        .any(|(m, p, b)| m == "POST" && p == "/api/v1/users/wallet/checkin" && b.get("captcha_token").is_some()));
    // 百智罐不该被这条链路碰到(双罐隔离)
    assert!(svc.store.is_empty());
}

// ==================== 会员模型本地同步 ====================

/// 会员模型同步/删除契约(对齐服务端 swagger【用户】OhMyAgent 分组):
/// 首次同步 POST ohmyagent/api-keys 并落盘,重同步复用不再创建;条目来自
/// GET users/models(收 public/private/team,未知归属跳过;超订阅档的内置
/// 模型**标 locked 保留**而非过滤——展示禁选;interface_type 改名
/// provider、model 字段 = 服务端模型名);断开走 DELETE,成功清本地记录、
/// 失败保留(下次重试)。
#[tokio::test(flavor = "multi_thread")]
async fn mc_member_models_sync_and_revoke_contract() {
    struct TempDir(std::path::PathBuf);
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let tmp = TempDir(std::env::temp_dir().join(format!("monkeycode-omk-{}-{nonce}", std::process::id())));
    std::fs::create_dir_all(&tmp.0).unwrap();

    let captured: Arc<Mutex<Vec<(String, String, String)>>> = Arc::new(Mutex::new(Vec::new())); // (method, path, cookie)
    let created = Arc::new(Mutex::new(0u32));
    let (cap, cnt) = (captured.clone(), created.clone());
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        cap.lock().unwrap().push((req.method.clone(), req.path.clone(), req.cookie.clone()));
        match (req.method.as_str(), req.path.split('?').next().unwrap()) {
            ("POST", "/api/v1/users/ohmyagent/api-keys") => {
                let mut n = cnt.lock().unwrap();
                *n += 1;
                Resp::json(
                    200,
                    json!({ "code": 0, "data": {
                        "id": format!("key-{}", *n), "api_key": format!("omk-{}", *n),
                        "signing_secret": "sec-1", "created_at": 1_753_000_000
                    } }),
                )
            }
            ("DELETE", "/api/v1/users/ohmyagent/api-keys/key-1") => Resp::json(200, json!({ "code": 0, "data": {} })),
            // key-2 的删除持续失败(演断网/服务端错):本地记录必须保留
            ("DELETE", "/api/v1/users/ohmyagent/api-keys/key-2") => {
                Resp::json(500, json!({ "code": 1, "message": "boom" }))
            }
            ("GET", "/api/v1/users/models") => Resp::json(
                200,
                json!({ "code": 0, "data": { "models": [
                    { "id": "cfg-1", "remark": "专业模型", "model": "monkeycode-pro-claude", "interface_type": "anthropic",
                      "owner": { "type": "public" }, "context_limit": 200_000, "output_limit": 16_384,
                      "support_image": true, "access_level": "pro", "is_free": false },
                    { "id": "cfg-2", "remark": "", "model": "mc-gpt", "interface_type": "openai_chat",
                      "owner": { "type": "public" } },
                    // 订阅档(pro)未覆盖 → 保留 + locked(展示禁选,静默无 note)
                    { "id": "cfg-3", "remark": "旗舰", "model": "monkeycode-ultra-x", "interface_type": "anthropic",
                      "owner": { "type": "public" } },
                    // 未来新协议 → 跳过 + note(不能落进 anthropic 兜底)
                    { "id": "cfg-4", "remark": "新协议", "model": "mc-next", "interface_type": "grpc_v2",
                      "owner": { "type": "public" } },
                    // 私有/团队条目(用户在服务端自配)→ 同样收录,走同一代理
                    { "id": "cfg-5", "remark": "我的", "model": "my-model", "interface_type": "anthropic",
                      "owner": { "type": "private" } },
                    { "id": "cfg-6", "remark": "团队的", "model": "team-model", "interface_type": "anthropic",
                      "owner": { "type": "team", "name": "翼龙组" } },
                    // owner 整个缺席 → 按 public 收(服务端 omitempty,内部 hook 的
                    // 会员内置模型不保证带);认不出的归属类型才跳过
                    { "id": "cfg-7", "remark": "无主", "model": "orphan", "interface_type": "anthropic" },
                    { "id": "cfg-8", "remark": "未知主", "model": "alien", "interface_type": "anthropic",
                      "owner": { "type": "galaxy" } }
                ] } }),
            ),
            ("GET", "/api/v1/users/subscription") => Resp::json(200, json!({ "code": 0, "data": { "plan": "pro" } })),
            _ => Resp::json(404, json!({ "code": 1, "message": "not found" })),
        }
    }));
    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url.clone(),
    });
    // 种 mc 会话 cookie:创建/删除/模型清单都走既有 MonkeyCode 会话
    svc.mc.update(
        &reqwest::Url::parse(&format!("{url}/")).unwrap(),
        &["mc_session=sess-9; Path=/".to_string()],
    );

    // 首次同步:创建并落盘;条目 base_url/api_key 是空占位,物化时补齐
    let out = super::sync_member_models(&svc, &tmp.0).await.map_err(|e| e.msg()).unwrap();
    let models = out.get("models").and_then(Value::as_array).unwrap();
    // 输出按节序排序:专业(档位)→ 旗舰(档位,locked)→ 付费 → 我的 → 团队
    assert_eq!(models.len(), 6, "仅协议/占位/归属不明被过滤,超档转 locked、私有/团队/无主收录: {models:?}");
    let m0 = &models[0];
    assert_eq!(m0.get("name").and_then(Value::as_str), Some("专业模型"));
    assert_eq!(m0.get("provider").and_then(Value::as_str), Some("anthropic"));
    assert_eq!(
        m0.get("model").and_then(Value::as_str),
        Some("monkeycode-pro-claude"),
        "model 字段 = 服务端模型名(swagger 的'配置 ID'为过时文档)"
    );
    assert_eq!(m0.get("api_key").and_then(Value::as_str), Some(""), "条目里是空占位");
    assert_eq!(m0.get("base_url").and_then(Value::as_str), Some(""), "条目里是空占位");
    assert_eq!(m0.get("context_window").and_then(Value::as_i64), Some(200_000));
    assert_eq!(m0.get("max_output").and_then(Value::as_i64), Some(16_384));
    assert_eq!(m0.get("vision").and_then(Value::as_bool), Some(true));
    assert_eq!(m0.get("source").and_then(Value::as_str), Some("monkeycode"));
    assert_eq!(m0.get("owner").and_then(Value::as_str), Some("public"));
    assert!(m0.get("locked").is_none(), "档内条目不携带 locked(omit-false)");
    // 超档条目:保留 + locked(物化层整条跳过);
    // 节序在付费条目之前(旗舰档位节 rank 2 < 付费 rank 3)
    let m1 = &models[1];
    assert_eq!(m1.get("name").and_then(Value::as_str), Some("旗舰"));
    assert_eq!(m1.get("locked").and_then(Value::as_bool), Some(true));
    assert_eq!(m1.get("owner").and_then(Value::as_str), Some("public"));
    assert_eq!(m1.get("api_key").and_then(Value::as_str), Some(""));
    assert_eq!(m1.get("base_url").and_then(Value::as_str), Some(""));
    assert_eq!(models[2].get("name").and_then(Value::as_str), Some("mc-gpt"), "remark 空回退模型名");
    assert_eq!(models[2].get("model").and_then(Value::as_str), Some("mc-gpt"));
    assert_eq!(models[2].get("provider").and_then(Value::as_str), Some("openai"));
    assert_eq!(models[2].get("api_key").and_then(Value::as_str), Some(""));
    // owner 缺席的条目按 public 收,与 mc-gpt 同在付费节(按 name 排序在其后)
    assert_eq!(models[3].get("name").and_then(Value::as_str), Some("无主"));
    assert_eq!(models[3].get("owner").and_then(Value::as_str), Some("public"));
    // 私有/团队条目:收录、归属标注、不锁(非内置命名不受档位门限)
    let m4 = &models[4];
    assert_eq!(m4.get("name").and_then(Value::as_str), Some("我的"));
    assert_eq!(m4.get("owner").and_then(Value::as_str), Some("private"));
    assert!(m4.get("locked").is_none());
    assert_eq!(models[5].get("name").and_then(Value::as_str), Some("团队的"));
    assert_eq!(models[5].get("owner").and_then(Value::as_str), Some("team"));
    // 认不出的归属类型(cfg-8)仍跳过
    assert!(
        !models.iter().any(|m| m.get("name").and_then(Value::as_str) == Some("未知主")),
        "认不出的归属类型必须跳过"
    );
    let notes = out.get("notes").and_then(Value::as_array).unwrap();
    assert_eq!(notes.len(), 2, "未知协议 + 归属不明各一条(锁定与私有收录都静默): {notes:?}");
    assert!(notes.iter().any(|n| n.as_str().is_some_and(|s| s.contains("归属类型无法识别"))), "{notes:?}");
    // 本机记录承载物化所需的全部字段(含 base_url 快照,同源 /v1)
    let stored = super::stored_ohmyagent_key(&tmp.0).unwrap();
    assert_eq!(stored.get("api_key").and_then(Value::as_str), Some("omk-1"));
    assert_eq!(stored.get("signing_secret").and_then(Value::as_str), Some("sec-1"));
    let expected_base = format!("{url}/v1");
    assert_eq!(stored.get("base_url").and_then(Value::as_str), Some(expected_base.as_str()));

    // 重同步:复用落盘 Key,不再创建
    super::sync_member_models(&svc, &tmp.0).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(*created.lock().unwrap(), 1, "重同步不应重复创建 Key");

    // 断开:DELETE 按 Key ID 删,成功后本地记录清除;再删是 no-op
    super::revoke_member_models(&svc, &tmp.0).await.map_err(|e| e.msg()).unwrap();
    assert!(!tmp.0.join(super::OHMYAGENT_KEY_FILE).exists(), "删成功应清本地记录");
    super::revoke_member_models(&svc, &tmp.0).await.map_err(|e| e.msg()).unwrap();

    // 再同步 → 创建 key-2;其删除失败时本地记录保留(下次复用/重试)
    super::sync_member_models(&svc, &tmp.0).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(
        super::stored_ohmyagent_key(&tmp.0).unwrap().get("api_key").and_then(Value::as_str),
        Some("omk-2")
    );
    assert!(super::revoke_member_models(&svc, &tmp.0).await.is_err(), "服务端删失败应报错");
    assert!(tmp.0.join(super::OHMYAGENT_KEY_FILE).exists(), "删失败必须保留本地记录,否则孤儿 Key");
    super::sync_member_models(&svc, &tmp.0).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(
        super::stored_ohmyagent_key(&tmp.0).unwrap().get("api_key").and_then(Value::as_str),
        Some("omk-2"),
        "删失败后同步复用原 Key"
    );
    assert_eq!(*created.lock().unwrap(), 2);

    // 服务器切换:旧文件无 server 快照且 base_url 与当前不符(历史形态的
    // 宽松判定)→ 作废重建(旧 Key 属旧服务器,跨服复用是误用;旧服务器侧
    // 无从删除,已知限制)
    let stale = json!({ "id": "key-2", "api_key": "omk-2", "signing_secret": "sec-1",
                        "base_url": "https://old.example.com/v1" });
    std::fs::write(tmp.0.join(super::OHMYAGENT_KEY_FILE), stale.to_string()).unwrap();
    super::sync_member_models(&svc, &tmp.0).await.map_err(|e| e.msg()).unwrap();
    let renewed = super::stored_ohmyagent_key(&tmp.0).unwrap();
    assert_eq!(renewed.get("api_key").and_then(Value::as_str), Some("omk-3"), "服务器切换应重建 Key 而非跨服复用");
    assert_eq!(renewed.get("base_url").and_then(Value::as_str), Some(expected_base.as_str()));
    assert_eq!(renewed.get("server").and_then(Value::as_str), Some(url.as_str()), "新文件应带服务器快照");
    assert_eq!(*created.lock().unwrap(), 3);

    // 同服务器只换模型请求地址(拆分部署):Key 仍属同一服务器 → 复用并
    // 原地刷新 base_url,不重建
    let moved = json!({ "id": "key-3", "api_key": "omk-3", "signing_secret": "sec-1",
                        "server": url, "base_url": "https://old-llm.example.com/v1" });
    std::fs::write(tmp.0.join(super::OHMYAGENT_KEY_FILE), moved.to_string()).unwrap();
    super::sync_member_models(&svc, &tmp.0).await.map_err(|e| e.msg()).unwrap();
    let refreshed = super::stored_ohmyagent_key(&tmp.0).unwrap();
    assert_eq!(refreshed.get("api_key").and_then(Value::as_str), Some("omk-3"), "同服务器换模型地址不得重建 Key");
    assert_eq!(refreshed.get("base_url").and_then(Value::as_str), Some(expected_base.as_str()), "模型地址应原地刷新");
    assert_eq!(*created.lock().unwrap(), 3);

    let reqs = captured.lock().unwrap();
    let post = reqs.iter().find(|(m, p, _)| m == "POST" && p == "/api/v1/users/ohmyagent/api-keys").unwrap();
    assert!(post.2.contains("mc_session=sess-9"), "创建必须带 mc 会话 cookie: {}", post.2);
    let del = reqs.iter().find(|(m, p, _)| m == "DELETE" && p == "/api/v1/users/ohmyagent/api-keys/key-1").unwrap();
    assert!(del.2.contains("mc_session=sess-9"), "删除必须带 mc 会话 cookie: {}", del.2);
    let deletes = reqs.iter().filter(|(m, _, _)| m == "DELETE").count();
    assert_eq!(deletes, 2, "已清记录后的 revoke 不应再发 DELETE");
}

// ==================== 微信扫码登录(wechat.rs 刮取链路) ====================

/// 微信授权页(qrconnect)HTML 最小快照,结构取自
/// open.weixin.qq.com/connect/qrconnect 线上页面(快照日期 2026-07)。
/// QRCODE_UUID_RE 刮的就是 <img src="/connect/qrcode/<uuid>"> 这一处;
/// uuid 故意含 `_`/`-`,把正则的字符集假设一并钉住。微信改版导致 CI 在
/// 这里断裂时:先对照线上页面更新此快照,再改 wechat.rs 的正则。
const WX_AUTH_PAGE: &str = r#"<!DOCTYPE html>
<html>
<head><title>微信登录</title></head>
<body>
<div class="main impowerBox">
  <div class="wrp_code">
    <img class="qrcode lightBorder" src="/connect/qrcode/uuid-Ab3_x-9Z"/>
  </div>
  <div class="info"><p class="status status_browser js_status normal">
    <span>使用微信扫一扫登录</span>
  </p></div>
</div>
</body>
</html>"#;

/// 长轮询应答快照(lp.open.weixin.qq.com/connect/l/qrconnect,2026-07):
/// 一段 JS,WX_ERRCODE_RE / WX_CODE_RE 从中刮状态码与授权码。
fn wx_lp_resp(errcode: i32, code: &str) -> Resp {
    Resp {
        status: 200,
        headers: vec![("Content-Type".into(), "text/javascript".into())],
        body: format!("window.wx_errcode={errcode};window.wx_code='{code}';").into_bytes(),
    }
}

/// 最小百分号编码(测试里拼授权页 URL 的 redirect_uri 参数用)。
fn pct(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// 微信扫码全链路:授权页刮 uuid → 二维码 data URL → 长轮询状态机各分支 →
/// 405 拿 wx_code 走回调种 cookie → profile 确认已登录 → 会话清理。
///
/// 单主机假服务端同时扮演百智云与微信(授权页/二维码/长轮询/回调);
/// 长轮询主机靠 MC_DESKTOP_WECHAT_LP_BASE 注入指回本服务端(实现默认按
/// `lp.` 前缀推导,见 wechat.rs lp_base_for)。该环境变量只有本用例设置、
/// 只有 poll 成功路径读取,与其他并行用例无交叉。
#[tokio::test(flavor = "multi_thread")]
async fn wechat_scan_login_flow() {
    use base64::Engine as _;
    use std::collections::VecDeque;

    // 长轮询脚本队列:每次 poll 弹一个应答,按序演完状态机全部分支
    let lp_script: Arc<Mutex<VecDeque<Vec<u8>>>> = Arc::new(Mutex::new(VecDeque::new()));
    // 回调收到的完整 path(事后断言 code/state 拼接正确)
    let callback_hit: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let session = Arc::new(Mutex::new(String::new()));
    let url_holder: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

    let qr_img: &[u8] = b"\xff\xd8fake-jpeg-bytes";
    let (script, hit, sess, uh) = (lp_script.clone(), callback_hit.clone(), session.clone(), url_holder.clone());
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        let base = uh.lock().unwrap().clone();
        match req.path.split('?').next().unwrap() {
            // 1. 百智云下发授权页 URL(query 携带 state 与回调地址)
            "/api/v1/user/oauth/login" => {
                assert!(req.path.contains("platform=wechat"));
                assert!(req.path.contains("redirect_url="));
                let cb = pct(&format!("{base}/wx/callback"));
                Resp::json(200, json!({ "code": 0, "data": { "url": format!(
                    "{base}/connect/qrconnect?appid=wx-test&scope=snsapi_login&state=st-42&redirect_uri={cb}"
                ) } }))
            }
            // 2. 微信授权页(HTML 快照)
            "/connect/qrconnect" => Resp {
                status: 200,
                headers: vec![("Content-Type".into(), "text/html; charset=utf-8".into())],
                body: WX_AUTH_PAGE.as_bytes().to_vec(),
            },
            // 3. 二维码图片(uuid 必须与快照页一致)
            "/connect/qrcode/uuid-Ab3_x-9Z" => Resp {
                status: 200,
                headers: vec![("Content-Type".into(), "image/jpeg".into())],
                body: b"\xff\xd8fake-jpeg-bytes".to_vec(),
            },
            // 4. 长轮询(uuid 透传;应答按脚本队列出)
            "/connect/l/qrconnect" => {
                assert!(req.path.contains("uuid=uuid-Ab3_x-9Z"), "长轮询未带页面刮出的 uuid: {}", req.path);
                let body = script.lock().unwrap().pop_front().expect("长轮询脚本队列耗尽");
                Resp { status: 200, headers: vec![("Content-Type".into(), "text/javascript".into())], body }
            }
            // 5. 回调:校验后 302 + 种会话 cookie(不跟随重定向,首响应即吸收)
            "/wx/callback" => {
                *hit.lock().unwrap() = Some(req.path.clone());
                assert!(req.path.contains("code=wxcode-007") && req.path.contains("state=st-42"));
                *sess.lock().unwrap() = "wx-sess-1".into();
                Resp::redirect("/").with_cookie("baizhi_session=wx-sess-1; Path=/; HttpOnly")
            }
            "/api/v1/user/profile" => {
                let s = sess.lock().unwrap().clone();
                if s.is_empty() || !req.cookie.contains(&format!("baizhi_session={s}")) {
                    return Resp { status: 401, headers: vec![], body: b"Unauthorized".to_vec() };
                }
                Resp::json(200, json!({ "code": 0, "data": {"name": "微信用户"} }))
            }
            _ => Resp::json(404, json!({ "message": "not found" })),
        }
    }));
    *url_holder.lock().unwrap() = url.clone();
    // 实现默认推导 lp.<host>,测试单主机接不住;注入指回假服务端
    std::env::set_var("MC_DESKTOP_WECHAT_LP_BASE", &url);

    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url.clone(),
    });

    // start:uuid 刮取正确 → 二维码按 data URL 原样下发
    let qr = super::wechat::start_wechat_login(&svc).await.map_err(|e| e.msg()).unwrap();
    assert_eq!(qr, format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(qr_img)));

    // 长轮询状态机:非终态不清会话,同一会话按序演完
    let push = |body: Vec<u8>| lp_script.lock().unwrap().push_back(body);
    let poll = || super::wechat::poll_wechat_login(&svc);
    for (resp, want) in [
        (wx_lp_resp(408, "").body, "waiting"),  // 待扫码
        (wx_lp_resp(404, "").body, "scanned"),  // 已扫码待确认
        (wx_lp_resp(403, "").body, "canceled"), // 手机端取消
        (wx_lp_resp(402, "").body, "expired"),  // 二维码过期
        (wx_lp_resp(500, "").body, "expired"),  // 500 同过期
    ] {
        push(resp);
        assert_eq!(poll().await.map_err(|e| e.msg()).unwrap(), want);
    }
    // 未知状态码 → 报错(而非误判成功)
    push(wx_lp_resp(666, "").body);
    assert!(poll().await.err().map(|e| e.msg()).unwrap().contains("未知扫码状态"));
    // 应答结构面目全非(改版哨兵)→ 明确报"响应异常"
    push(b"<html>totally different</html>".to_vec());
    assert!(poll().await.err().map(|e| e.msg()).unwrap().contains("扫码状态响应异常"));
    // 405 但 wx_code 为空 → 报错且不吞会话(可继续 poll)
    push(wx_lp_resp(405, "").body);
    assert!(poll().await.err().map(|e| e.msg()).unwrap().contains("未返回授权码"));

    // 405 + wx_code → 回调拼 code/state → cookie 落罐 → profile 权威确认
    push(wx_lp_resp(405, "wxcode-007").body);
    assert_eq!(poll().await.map_err(|e| e.msg()).unwrap(), "ok");
    assert!(callback_hit.lock().unwrap().is_some(), "回调未被触达");
    let (li, profile) = svc.status().await.map_err(|e| e.msg()).unwrap();
    assert!(li, "回调种下的 cookie 应使 profile 探测为已登录");
    assert_eq!(profile.get("name").and_then(|v| v.as_str()), Some("微信用户"));

    // 成功后会话清理:再 poll 应提示先获取二维码
    let err = poll().await.err().map(|e| e.msg()).unwrap();
    assert!(err.contains("没有进行中的扫码会话"), "{err}");
}

/// start 的防御路径:授权 URL 缺 state/redirect_uri、授权页改版刮不出
/// uuid(QRCODE_UUID_RE 断裂的第一现场)、无会话时 poll——都应给出指向
/// 明确的错误而非 panic/误成功。不触发长轮询,不依赖 lp 注入变量。
#[tokio::test(flavor = "multi_thread")]
async fn wechat_start_guards() {
    let mode = Arc::new(Mutex::new(0u8));
    let (m, url_holder) = (mode.clone(), Arc::new(Mutex::new(String::new())));
    let uh = url_holder.clone();
    let (url, _stop) = serve(Arc::new(move |req: Req| {
        let base = uh.lock().unwrap().clone();
        match req.path.split('?').next().unwrap() {
            "/api/v1/user/oauth/login" => {
                let auth = if *m.lock().unwrap() == 0 {
                    // 缺 state / redirect_uri
                    format!("{base}/connect/qrconnect?appid=wx-test")
                } else {
                    format!("{base}/connect/qrconnect?appid=wx-test&state=s&redirect_uri={}", pct(&base))
                };
                Resp::json(200, json!({ "code": 0, "data": { "url": auth } }))
            }
            // 改版后的假想页面:二维码不再走 /connect/qrcode/ 路径
            "/connect/qrconnect" => Resp {
                status: 200,
                headers: vec![("Content-Type".into(), "text/html".into())],
                body: br#"<html><body><img src="/connect/qr/v2/xyz"/></body></html>"#.to_vec(),
            },
            _ => Resp::json(404, json!({})),
        }
    }));
    *url_holder.lock().unwrap() = url.clone();

    let svc = Service::test_service(Endpoints {
        account: url.clone(),
        model_gateway: url.clone(),
        mcp_gateway: url.clone(),
        monkeycode: url,
    });

    // 授权 URL 缺参数
    let err = super::wechat::start_wechat_login(&svc).await.err().map(|e| e.msg()).unwrap();
    assert!(err.contains("缺少 state/redirect_uri"), "{err}");

    // 页面结构变化 → 指明"页面结构可能已变化"
    *mode.lock().unwrap() = 1;
    let err = super::wechat::start_wechat_login(&svc).await.err().map(|e| e.msg()).unwrap();
    assert!(err.contains("没找到二维码"), "{err}");

    // 无进行中会话直接 poll
    let err = super::wechat::poll_wechat_login(&svc).await.err().map(|e| e.msg()).unwrap();
    assert!(err.contains("没有进行中的扫码会话"), "{err}");
}
