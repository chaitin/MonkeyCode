// 模型网关/MCP 网关同步(agent/internal/baizhi/sync.go 的 Rust 移植)。
// 登录后从模型网关拉模型清单并确保有一把可用的推理密钥,产出可直接落盘的
// 清单(models.json 条目 + mcp.json servers)。UI 拿到后整组并入设置表单
// (不再逐条挑选,用户拍板),经保存条落盘重启。
//
// 密钥策略:ai-models 列表会返回完整 api_key → 优先复用调用方已持有的同一把,
// 其次复用 MonkeyCode 自有条目,都没有才新建并启用。

use serde_json::{json, Value};

use super::{clean_message, code_is_zero, other, snippet, unwrap_envelope, BzErr, BzResult, Envelope, Service};

/// 同步新建密钥的名字(网关控制台里用户可见)。
const SYNC_KEY_NAME: &str = "MonkeyCode";
/// 同步条目的 source 标记(UI 按它分组/整组替换;对应 agent/ui/src/types.ts 的 SOURCE_BAIZHI)。
const SOURCE_BAIZHI: &str = "baizhi";
/// 同步产出的 mcp.json 条目名(工具命名空间前缀 mcp__<name>__)。
const MCP_ENTRY_NAME: &str = "baizhi-toolkit";

/// 确保推理密钥 + 用该密钥拉取 Anthropic 兼容模型清单。
/// 密钥管理要求已登录(有 cookie),模型清单则走 Bearer 鉴权的推理接口。
/// known_keys 是调用方已持有的候选明文密钥,能对上 ai-models 返回值就复用。
pub async fn sync(svc: &Service, known_keys: &[String]) -> BzResult<Value> {
    let (key, key_name, created) = ensure_api_key(svc, known_keys).await?;
    let (models, mut notes) = gateway_models(svc, &key).await?;
    let (mcp, mcp_notes) = mcp_servers(svc).await;
    notes.extend(mcp_notes);
    Ok(json!({
        "models": models,
        "mcp_servers": mcp,
        "key_created": created,
        "key_name": key_name,
        "notes": notes,
    }))
}

/// ai-models 包壳:{data,error};成功 data 是数组(新版)或 {items,total}
/// 分页对象(旧版部署,见 console_items 两代兼容)。
/// 控制台接口靠 cookie 鉴权,3xx 即被踢去登录页——给明确文案,
/// 别让用户对着"HTTP 302"猜。
pub(crate) const ENV_CONSOLE: Envelope = Envelope {
    label: "网关",
    code_ok: code_is_zero,
    check_success: false,
    redirect_msg: Some("百智云登录已失效,请重新登录后再同步"),
    fixed_401: None,
    whole_body_fallback: false,
};

/// ai-models 请求(带 cookie),解包 {data,error}。
async fn console_call(svc: &Service, method: reqwest::Method, path: &str, body: Option<&Value>) -> BzResult<Value> {
    let target = format!("{}{}", svc.ep.model_gateway, path);
    let (data, status) = svc.do_store(&svc.store, method, &target, body).await?;
    if let Ok(v) = serde_json::from_slice::<Value>(&data) {
        if let Some(err) = v.get("error").filter(|err| !err.is_null()) {
            let msg = clean_message(err.get("message").and_then(Value::as_str).unwrap_or(""));
            let msg = if msg.is_empty() {
                format!("模型服务请求失败(HTTP {status})")
            } else {
                msg
            };
            return if status == 401 {
                Err(BzErr::Unauthorized(msg))
            } else {
                Err(other(msg))
            };
        }
    }
    let out = unwrap_envelope(&data, status, &ENV_CONSOLE);
    // 解包成 Null = 响应不是预期 JSON(登录页 HTML/空 data):原文留痕到
    // stderr,报障时终端启动就能看到网关到底回了什么(壳没有自己的日志文件)
    if matches!(&out, Ok(v) if v.is_null()) {
        eprintln!(
            "[desktop] 网关 {path} 非预期响应(HTTP {status}): {}",
            snippet(&String::from_utf8_lossy(&data), 200)
        );
    }
    out
}

/// ai-models 控制台列表(当前用于 API key)的 data:新契约直接是数组,
/// 旧版部署套 {items,total} 分页对象、数组在 items 里(2026-08-12 用户
/// 现场实锤,两代服务端并存)——两代都收;契约漂移时报错,不能静默当作
/// 空列表。
///
/// data 为 Null 单独翻译成"登录失效":cookie 过期后网关常回 2xx 的
/// 登录页 HTML 或空 data,unwrap_envelope 对 2xx 宽容地折成 Null
/// (改那两个宽容分支会伤及"2xx 空体即成功"的端点)——落到这儿十有
/// 八九是会话没了,报"响应格式异常"只会让用户摸不着头脑。
fn console_items(data: &Value) -> BzResult<Vec<Value>> {
    if data.is_null() {
        return Err(BzErr::Unauthorized("百智云登录已失效,请重新登录后再同步".into()));
    }
    if let Some(arr) = data.as_array().or_else(|| data.get("items").and_then(Value::as_array)) {
        return Ok(arr.clone());
    }
    // 真契约漂移:带上实际结构定位,但对象只报字段名——密钥列表响应含
    // 明文 api_key,原文进弹窗会随报障截图外传
    let shape = match data.as_object() {
        Some(o) => format!("对象字段: {}", o.keys().cloned().collect::<Vec<_>>().join(",")),
        None => snippet(&data.to_string(), 120),
    };
    Err(other(format!("模型服务列表响应格式异常({shape})")))
}

fn api_key_secret(item: &Value) -> &str {
    item.get("api_key")
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn api_key_active(item: &Value) -> bool {
    item.get("status").and_then(Value::as_str) == Some("active")
}

fn sync_key_name(name: &str) -> bool {
    name == SYNC_KEY_NAME
        || name
            .strip_prefix(SYNC_KEY_NAME)
            .and_then(|suffix| suffix.strip_prefix('-'))
            .map(|suffix| !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit()))
            .unwrap_or(false)
}

/// 确保拿到一把可用(存在且启用)的明文推理密钥。返回 (key, 密钥名, 是否新建)。
async fn ensure_api_key(svc: &Service, known_keys: &[String]) -> BzResult<(String, String, bool)> {
    let list = console_call(svc, reqwest::Method::GET, "/api/console/api-keys", None)
        .await
        .map_err(|e| other(format!("获取密钥列表失败: {}", e.msg())))?;
    let items = console_items(&list)?;

    // ai-models 会返回完整 api_key。优先复用调用方已持有的同一把 key。
    for k in known_keys {
        let k = k.trim();
        if !k.starts_with("sk-") {
            continue;
        }
        for it in &items {
            if api_key_secret(it) != k {
                continue;
            }
            let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !api_key_active(it) {
                enable_api_key(svc, it)
                    .await
                    .map_err(|e| other(format!("重新启用密钥「{name}」失败: {}", e.msg())))?;
            }
            return Ok((k.to_string(), name, false));
        }
    }

    // 新接口可读回完整密钥:复用已有 MonkeyCode 系列条目,无需重复创建。
    if let Some(it) = items.iter().find(|it| {
        it.get("name")
            .and_then(Value::as_str)
            .map(sync_key_name)
            .unwrap_or(false)
            && !api_key_secret(it).is_empty()
    }) {
        let name = it.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        if !api_key_active(it) {
            enable_api_key(svc, it)
                .await
                .map_err(|e| other(format!("重新启用密钥「{name}」失败: {}", e.msg())))?;
        }
        return Ok((api_key_secret(it).to_string(), name, false));
    }

    // 没有自家密钥才新建。ai-models 新建条目默认启用并直接返回 api_key。
    let name = pick_key_name(&items)?;
    let created = console_call(
        svc,
        reqwest::Method::POST,
        "/api/console/api-keys",
        Some(&json!({
            "name": name,
            "quota_enabled": false,
            "remaining_quota": 0,
            "ip_whitelist": [],
            "rpm_limit": 0,
            "tpm_limit": 0,
        })),
    )
    .await
    .map_err(|e| other(format!("创建密钥失败: {}", e.msg())))?;
    let key = api_key_secret(&created).to_string();
    if key.is_empty() {
        return Err(other("创建密钥成功但响应未含明文密钥"));
    }
    if !api_key_active(&created) {
        enable_api_key(svc, &created)
            .await
            .map_err(|e| other(format!("启用新建密钥失败: {}", e.msg())))?;
    }
    Ok((key, name, true))
}

/// 选一个与现有密钥不撞名的名字:MonkeyCode、MonkeyCode-2、…
fn pick_key_name(existing: &[Value]) -> BzResult<String> {
    let taken: std::collections::HashSet<&str> = existing
        .iter()
        .filter_map(|it| it.get("name").and_then(|v| v.as_str()))
        .collect();
    if !taken.contains(SYNC_KEY_NAME) {
        return Ok(SYNC_KEY_NAME.to_string());
    }
    for i in 2..=99 {
        let name = format!("{SYNC_KEY_NAME}-{i}");
        if !taken.contains(name.as_str()) {
            return Ok(name);
        }
    }
    Err(other(format!("网关中 {SYNC_KEY_NAME} 系列密钥过多,请在百智云控制台清理后重试")))
}

/// ai-models 通过 PUT 更新密钥状态,支持只传 status。
async fn enable_api_key(svc: &Service, item: &Value) -> BzResult<()> {
    let id = id_path(item);
    if id.is_empty() {
        return Err(other("密钥响应未含 id"));
    }
    console_call(
        svc,
        reqwest::Method::PUT,
        &format!("/api/console/api-keys/{id}"),
        Some(&json!({ "status": "active" })),
    )
    .await
    .map(|_| ())
}

/// Anthropic 兼容模型清单请求。这是面向推理密钥的权威可用列表,
/// 不能用控制台 /api/console/models 代替:后者是管理视图,字段和可见集都不同。
async fn model_catalog_page(svc: &Service, key: &str, after_id: Option<&str>) -> BzResult<Value> {
    let mut url = reqwest::Url::parse(&format!("{}/api/anthropic/models", svc.ep.model_gateway))
        .map_err(|e| other(format!("模型列表地址异常: {e}")))?;
    if let Some(after) = after_id {
        url.query_pairs_mut().append_pair("after_id", after);
    }
    let host = url.host_str().unwrap_or("").to_string();
    let resp = svc
        .http()?
        .get(url)
        .bearer_auth(key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .send()
        .await
        .map_err(|e| other(format!("请求 {host} 失败: {e}")))?;
    let status = resp.status().as_u16();
    let data = resp
        .bytes()
        .await
        .map_err(|e| other(format!("读取模型列表失败: {e}")))?;
    let value: Value = serde_json::from_slice(&data)
        .map_err(|e| other(format!("模型列表响应解析失败: {e}")))?;
    if !(200..300).contains(&status) {
        let msg = value
            .pointer("/error/message")
            .or_else(|| value.get("message"))
            .and_then(Value::as_str)
            .map(clean_message)
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| format!("模型服务请求失败(HTTP {status})"));
        return if status == 401 {
            Err(BzErr::Unauthorized(msg))
        } else {
            Err(other(msg))
        };
    }
    if !value.get("data").is_some_and(Value::is_array) {
        return Err(other("模型列表响应格式异常"));
    }
    Ok(value)
}

/// 按模型 id 选推理协议与端点(用户拍板):GPT 系列走 OpenAI Responses
/// (网关 /api/openai 推理面,引擎按 base_url + "/responses" 拼请求,故带
/// /v1),其余一律 Anthropic 兼容面(引擎会把 base_url 归一到 /v1)。
fn entry_route(id: &str, gateway: &str) -> (&'static str, String) {
    if id.to_ascii_lowercase().starts_with("gpt") {
        ("openai_responses", format!("{gateway}/api/openai/v1"))
    } else {
        ("anthropic", format!("{gateway}/api/anthropic"))
    }
}

/// 拉模型列表并映射为同步条目。推理接口返回的 data 已是该密钥可用的
/// 模型集,直接以 id 为请求模型,不再按控制台的 type=llm 字段二次过滤。
async fn gateway_models(svc: &Service, key: &str) -> BzResult<(Vec<Value>, Vec<String>)> {
    let mut models = Vec::new();
    let mut notes = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut after_id: Option<String> = None;
    // 防御服务端错误地永返 has_more=true;正常情况远少于 100 页。
    for _ in 0..100 {
        let page = model_catalog_page(svc, key, after_id.as_deref())
            .await
            .map_err(|e| other(format!("获取模型列表失败: {}", e.msg())))?;
        let items = page
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| other("模型列表响应格式异常"))?;
        for m in items {
            let id = m.get("id").and_then(Value::as_str).unwrap_or("").trim();
            if id.is_empty() || !seen.insert(id.to_string()) {
                continue;
            }
            let (provider, base_url) = entry_route(id, &svc.ep.model_gateway);
            models.push(json!({
                "name": id,
                "provider": provider,
                "base_url": base_url,
                "api_key": key,
                "model": id,
                "source": SOURCE_BAIZHI,
            }));
        }
        if !page.get("has_more").and_then(Value::as_bool).unwrap_or(false) {
            if models.is_empty() {
                notes.push("推理接口下没有可用模型".to_string());
            }
            return Ok((models, notes));
        }
        let next = page
            .get("last_id")
            .and_then(Value::as_str)
            .or_else(|| items.last().and_then(|m| m.get("id")).and_then(Value::as_str))
            .unwrap_or("")
            .trim();
        if next.is_empty() || after_id.as_deref() == Some(next) {
            return Err(other("模型列表分页响应缺少有效游标"));
        }
        after_id = Some(next.to_string());
    }
    Err(other("模型列表分页过多,已停止同步"))
}

// ==================== MCP(agent-toolkit)====================

/// agent-toolkit 的 code 合法值:缺失/null 合法,字符串只认 "ok",数字认 0/200。
fn code_ok_toolkit(c: Option<&Value>) -> bool {
    match c {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s == "ok",
        Some(Value::Number(n)) => n.as_i64() == Some(0) || n.as_i64() == Some(200),
        _ => false,
    }
}

/// MCP 网关包壳。与 console 的差异:code 可能是字符串 "ok";
/// 3xx 视为未开通(不跟随重定向,首响应即 302)。
pub(crate) const ENV_MCP: Envelope = Envelope {
    label: "MCP 网关",
    code_ok: code_ok_toolkit,
    check_success: false,
    redirect_msg: Some("当前团队未开通 Agent 工具包"),
    fixed_401: None,
    whole_body_fallback: false,
};

/// agent-toolkit 管理 API 请求。
async fn mcp_call(svc: &Service, method: reqwest::Method, path: &str, body: Option<&Value>) -> BzResult<Value> {
    let target = format!("{}{}", svc.ep.mcp_gateway, path);
    let (data, status) = svc.do_store(&svc.store, method, &target, body).await?;
    unwrap_envelope(&data, status, &ENV_MCP)
}

/// 拉 Agent 工具包服务并确保一把 MCP 密钥,映射为单个 streamable-http 条目。
/// 非致命:任何一步失败仅记 note,不阻断模型同步。
async fn mcp_servers(svc: &Service) -> (Value, Vec<String>) {
    let empty = json!({});

    // 握手:agent-toolkit 的 sl-session 按 host 独立,先 GET / 领取
    let _ = svc
        .do_store(&svc.store, reqwest::Method::GET, &format!("{}/", svc.ep.mcp_gateway), None)
        .await;

    let svc_list = match mcp_call(svc, reqwest::Method::GET, "/api/v1/services", None).await {
        Ok(v) => v,
        Err(e) => {
            let msg = e.msg();
            if msg.contains("未开通") {
                return (empty, vec!["当前团队未开通 Agent 工具包,已跳过 MCP 同步(可在百智云控制台申请开通)".into()]);
            }
            return (empty, vec![format!("获取 MCP 服务失败: {msg}")]);
        }
    };
    let items: Vec<Value> = svc_list.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if items.is_empty() {
        return (empty, vec!["Agent 工具包下没有可用的 MCP 服务".into()]);
    }
    let codes: Vec<String> = items
        .iter()
        .filter_map(|it| it.get("catalog_code").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string))
        .collect();
    let names: Vec<String> = items
        .iter()
        .filter_map(|it| it.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string))
        .collect();

    let (key, note) = ensure_mcp_key(svc, &codes).await;
    if key.is_empty() {
        return (empty, vec![note]);
    }
    let out = json!({
        MCP_ENTRY_NAME: {
            "url": format!("{}/mcp", svc.ep.mcp_gateway),
            "headers": { "Authorization": format!("Bearer {key}") },
            "source": SOURCE_BAIZHI,
        }
    });
    let mut notes = vec![format!("MCP 已同步(含 {} 个服务: {})", items.len(), names.join("、"))];
    if !note.is_empty() {
        notes.push(note);
    }
    (out, notes)
}

fn id_path(item: &Value) -> String {
    match item.get("id") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// 确保拿到一把可用的 MCP 明文密钥;返回 (key, note)。
/// 与模型网关不同,这里明文可经 reveal 随时取回。
async fn ensure_mcp_key(svc: &Service, tool_codes: &[String]) -> (String, String) {
    let list = match mcp_call(svc, reqwest::Method::GET, "/api/v1/api-keys", None).await {
        Ok(v) => v,
        Err(e) => return (String::new(), format!("获取 MCP 密钥列表失败: {}", e.msg())),
    };
    let items: Vec<Value> = list.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    // 已有可用密钥(优先同名)→ reveal 取明文;停用的同名密钥先启用
    let mut pick: Option<&Value> = None;
    for it in &items {
        let status = it.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if status == "enabled" && (pick.is_none() || name == SYNC_KEY_NAME) {
            pick = Some(it);
        }
    }
    let mut picked = pick.cloned();
    if picked.is_none() {
        for it in &items {
            let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name == SYNC_KEY_NAME {
                // 只碰自家条目,不动用户手工停用的密钥
                if let Err(e) = mcp_call(
                    svc,
                    reqwest::Method::POST,
                    &format!("/api/v1/api-keys/{}/enable", id_path(it)),
                    None,
                )
                .await
                {
                    return (String::new(), format!("重新启用 MCP 密钥失败: {}", e.msg()));
                }
                picked = Some(it.clone());
                break;
            }
        }
    }
    if let Some(it) = picked {
        let rev = match mcp_call(svc, reqwest::Method::GET, &format!("/api/v1/api-keys/{}/reveal", id_path(&it)), None).await {
            Ok(v) => v,
            Err(e) => return (String::new(), format!("获取 MCP 密钥明文失败: {}", e.msg())),
        };
        let key = rev.get("key").and_then(|v| v.as_str()).unwrap_or("");
        if key.is_empty() {
            return (String::new(), "MCP 密钥明文响应为空".into());
        }
        return (key.to_string(), String::new());
    }

    // 没有任何可用密钥 → 新建(授权全部服务)
    let created = match mcp_call(
        svc,
        reqwest::Method::POST,
        "/api/v1/api-keys",
        Some(&json!({ "name": SYNC_KEY_NAME, "tool_codes": tool_codes })),
    )
    .await
    {
        Ok(v) => v,
        Err(e) => return (String::new(), format!("创建 MCP 密钥失败: {}", e.msg())),
    };
    let key = created.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if key.is_empty() {
        return (String::new(), "创建 MCP 密钥成功但响应未含明文".into());
    }
    let status = created.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if !status.is_empty() && status != "enabled" {
        if let Err(e) = mcp_call(
            svc,
            reqwest::Method::POST,
            &format!("/api/v1/api-keys/{}/enable", id_path(&created)),
            None,
        )
        .await
        {
            return (String::new(), format!("启用新建 MCP 密钥失败: {}", e.msg()));
        }
    }
    (key, String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_route_gpt_series_uses_responses() {
        let gw = "https://gw.example";
        assert_eq!(
            entry_route("gpt-5-codex", gw),
            ("openai_responses", "https://gw.example/api/openai/v1".to_string())
        );
        assert_eq!(
            entry_route("GPT-4o", gw),
            ("openai_responses", "https://gw.example/api/openai/v1".to_string()),
            "大小写不敏感"
        );
        assert_eq!(
            entry_route("claude-sonnet-4-5", gw),
            ("anthropic", "https://gw.example/api/anthropic".to_string())
        );
        assert_eq!(
            entry_route("deepseek-v3", gw),
            ("anthropic", "https://gw.example/api/anthropic".to_string()),
            "非 GPT 系一律 anthropic"
        );
    }

    #[test]
    fn pick_name_skips_taken() {
        let items = vec![json!({"name": "MonkeyCode"}), json!({"name": "MonkeyCode-2"})];
        assert_eq!(pick_key_name(&items).map_err(|e| e.msg()).unwrap(), "MonkeyCode-3");
        assert_eq!(pick_key_name(&[]).map_err(|e| e.msg()).unwrap(), "MonkeyCode");
    }

    #[test]
    fn ai_models_key_console_contract() {
        let key = json!({
            "id": "key-1",
            "name": "MonkeyCode",
            "api_key": "sk-live",
            "status": "active"
        });
        assert_eq!(api_key_secret(&key), "sk-live");
        assert!(api_key_active(&key));
        assert!(sync_key_name("MonkeyCode"));
        assert!(sync_key_name("MonkeyCode-2"));
        assert!(!sync_key_name("MonkeyCode-test"));
    }
}
