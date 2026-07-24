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

    // MCP 网关:3xx = 未开通;code 认 "ok"/0/200,其余字符串/类型判失败
    let m = err_msg(unwrap_envelope(b"", 302, &ENV_MCP));
    assert!(m.contains("未开通"), "{m}");
    assert!(unwrap_envelope(br#"{"code":"ok","data":1}"#, 200, &ENV_MCP).is_ok());
    assert!(unwrap_envelope(br#"{"code":200,"data":1}"#, 200, &ENV_MCP).is_ok());
    assert!(unwrap_envelope(br#"{"code":"err","message":"x"}"#, 200, &ENV_MCP).is_err());
    assert!(unwrap_envelope(br#"{"code":true}"#, 200, &ENV_MCP).is_err());

    // MonkeyCode:401 不看响应体,固定"重新同步云端账号"(与百智云语义不同)
    let m = unauthorized(unwrap_envelope(r#"{"code":1,"message":"别的话"}"#.as_bytes(), 401, &ENV_MC));
    assert_eq!(m, "MonkeyCode 会话已失效,请重新同步云端账号");
    // 业务失败走清洗后的 message;缺 data 兜底 Null
    assert_eq!(err_msg(unwrap_envelope(r#"{"code":7,"message":"忙 [trace_id:y]"}"#.as_bytes(), 200, &ENV_MC)), "忙");
    assert!(unwrap_envelope(br#"{"code":0}"#, 200, &ENV_MC).map_err(|e| e.msg()).unwrap().is_null());
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
    super::monkeycode::mc_task_stop(&svc, "t1").await.map_err(|e| e.msg()).unwrap();
    super::monkeycode::mc_task_delete(&svc, "t1").await.map_err(|e| e.msg()).unwrap();

    let requests = captured.lock().unwrap();
    let list = requests.iter().find(|(method, path, _)| method == "GET" && path.starts_with("/api/v1/users/tasks?")).unwrap();
    assert!(list.1.contains("status=pending%2Cprocessing"));
    assert!(list.1.contains("project_id=p%2F1"));
    assert!(list.1.contains("quick_start=true"));
    assert!(requests.iter().any(|(method, path, _)| method == "GET" && path == "/api/v1/users/projects?limit=50"));
    assert!(requests.iter().any(|(method, path, body)| method == "PUT" && path == "/api/v1/users/tasks/stop" && body.get("id").and_then(Value::as_str) == Some("t1")));
    assert!(requests.iter().any(|(method, path, _)| method == "DELETE" && path == "/api/v1/users/tasks/t1"));
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
