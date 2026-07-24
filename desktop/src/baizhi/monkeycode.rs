// MonkeyCode 云端账号桥接 + 任务代理(agent/internal/baizhi/monkeycode.go +
// mcstream.go 的 Rust 移植)。
//
// 桥接登录:用已登录的百智云会话换取 monkeycode-ai.com 会话——手动跟随
// 重定向链(WebView 导航拦截的等价物):
//
//	GET {mc}/api/v1/users/login → 302 → {baizhi}/oauth/authorize?...(授权页)
//	→ 改写为 {baizhi}/api/v1/oauth/authorize API(带百智 cookie,response_type=code)
//	→ 302 → {mc}/…/callback?code=… → Set-Cookie 落 monkeycode 会话 → 302 前端页
//
// cookie 按域分罐:百智账号域走 store,其余(monkeycode 一族)走 mc。
// 云端任务数据对壳不透明(Value 直通 UI)。
//
// WS 桥:壳带 mc cookie 拨 wss 到云端,下行经 ws-msg:{pipe} 事件到 UI,
// 上行经 cloud_ws_send;帧原样转发零翻译(云端 TaskStream 与 UI Frame 同构)。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::{code_is_zero, other, unwrap_envelope, BzErr, BzResult, Envelope, Service};
use crate::util::urlencode;

/// 桥接重定向链上限(实测 4~6 跳,留余量防环)。
const MAX_BRIDGE_HOPS: usize = 12;

fn account_host(svc: &Service) -> String {
    reqwest::Url::parse(&svc.ep.account)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default()
}

fn on_account_host(svc: &Service, u: &reqwest::Url) -> bool {
    u.host_str().map(str::to_string).unwrap_or_default() == account_host(svc)
        && u.port() == reqwest::Url::parse(&svc.ep.account).ok().and_then(|a| a.port())
}

/// 桥接登录:需已持有百智云会话。成功返回云端用户信息(原样)。
pub async fn login_monkeycode(svc: &Service) -> BzResult<Value> {
    if svc.store.is_empty() {
        return Err(other("请先登录百智云账号"));
    }
    let mut cur = format!("{}/api/v1/users/login?redirect=&inviter_id=", svc.ep.monkeycode);
    for _ in 0..MAX_BRIDGE_HOPS {
        let mut u = reqwest::Url::parse(&cur).map_err(|e| other(format!("云端登录桥接地址异常: {e}")))?;
        // 落到百智授权"页面"时改写为 API 端点(WebView 里这一跳由页面 JS 完成)
        if on_account_host(svc, &u) && u.path() == "/oauth/authorize" {
            cur = authorize_page_to_api(svc, &u)?;
            u = reqwest::Url::parse(&cur).map_err(|e| other(format!("授权地址异常: {e}")))?;
        }
        match bridge_hop(svc, &u).await? {
            Some(next) => cur = next,
            None => return confirm_mc_login(svc).await,
        }
    }
    Err(other("云端登录桥接重定向次数过多"))
}

/// 执行桥接链上的一跳。Ok(None) 表示重定向链走完(停在 2xx)。
async fn bridge_hop(svc: &Service, u: &reqwest::Url) -> BzResult<Option<String>> {
    let store = if on_account_host(svc, u) { &svc.store } else { &svc.mc };
    let (_, status, location) = svc
        .do_store_full(store, reqwest::Method::GET, u.as_str(), None)
        .await
        .map_err(|e| other(format!("云端登录桥接失败: {}", e.msg())))?;
    if (300..400).contains(&status) {
        let loc = location.ok_or_else(|| other("云端登录桥接失败: 重定向缺少目标地址"))?;
        // 相对地址按当前页解析
        let next = u.join(&loc).map_err(|e| other(format!("云端登录桥接失败: 重定向地址异常: {e}")))?;
        return Ok(Some(next.to_string()));
    }
    if !(200..300).contains(&status) {
        if status == 401 && on_account_host(svc, u) {
            return Err(BzErr::Unauthorized("百智云会话已失效,请重新登录".into()));
        }
        return Err(other(format!("云端登录桥接失败(HTTP {status},{})", u.host_str().unwrap_or(""))));
    }
    Ok(None)
}

/// 授权页 URL → 授权 API URL(参数校验对齐移动端)。
fn authorize_page_to_api(svc: &Service, page: &reqwest::Url) -> BzResult<String> {
    let q = |name: &str| -> String {
        page.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default()
    };
    let client_id = q("client_id");
    let mut redirect_uri = q("redirect_uri");
    if redirect_uri.is_empty() {
        redirect_uri = q("redirect_url");
    }
    let (scope, state) = (q("scope"), q("state"));
    if client_id.is_empty() || redirect_uri.is_empty() || scope.is_empty() || state.is_empty() {
        return Err(other("云端登录桥接失败: 授权参数不完整"));
    }
    let mut response_type = q("response_type");
    if response_type.is_empty() {
        response_type = "code".into();
    }
    let mut api = reqwest::Url::parse(&format!("{}/api/v1/oauth/authorize", svc.ep.account))
        .map_err(|e| other(format!("授权地址异常: {e}")))?;
    api.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", &scope)
        .append_pair("state", &state)
        .append_pair("response_type", &response_type);
    Ok(api.to_string())
}

/// 桥接链走完后校验云端会话已建立,返回用户信息。
async fn confirm_mc_login(svc: &Service) -> BzResult<Value> {
    match mc_user(svc).await {
        Ok(user) => Ok(user),
        Err(BzErr::Unauthorized(_)) => Err(other("云端登录未完成: 未获得 MonkeyCode 会话")),
        Err(e) => Err(e),
    }
}

/// 拉取云端用户信息;会话无效返回 Unauthorized。
async fn mc_user(svc: &Service) -> BzResult<Value> {
    let out = mc_call(svc, reqwest::Method::GET, "/api/v1/users/status", None).await?;
    let user = out.get("user").cloned().unwrap_or(Value::Null);
    // 空对象也算未登录(与移动端 hasUserIdentity 语义一致)
    let has_identity = ["id", "name", "username", "email"]
        .iter()
        .any(|k| user.get(k).and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false));
    if !has_identity {
        return Err(BzErr::Unauthorized("MonkeyCode 会话无效".into()));
    }
    Ok(user)
}

/// 云端会话状态:有会话时返回用户信息。
pub async fn mc_status(svc: &Service) -> BzResult<(bool, Value)> {
    if svc.mc.is_empty() {
        return Ok((false, Value::Null));
    }
    match mc_user(svc).await {
        Ok(user) => Ok((true, user)),
        Err(BzErr::Unauthorized(_)) => Ok((false, Value::Null)),
        Err(e) => Err(e),
    }
}

/// 云端服务主机名(诊断展示 + UI 拼任务详情外链)。
pub fn mc_host(svc: &Service) -> String {
    reqwest::Url::parse(&svc.ep.monkeycode)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| svc.ep.monkeycode.clone())
}

/// 云端任务列表({tasks, page_info} 原样透传 UI)。project_id / quick_start
/// 与 Web 侧栏筛选一致：项目内任务、未关联项目的快速任务分别查询。
pub async fn mc_tasks(
    svc: &Service,
    page: u32,
    size: u32,
    status: &str,
    project_id: &str,
    quick_start: Option<bool>,
) -> BzResult<Value> {
    let mut path = format!("/api/v1/users/tasks?page={page}&size={size}");
    if !status.is_empty() {
        path.push_str(&format!("&status={}", urlencode(status)));
    }
    if !project_id.is_empty() {
        path.push_str(&format!("&project_id={}", urlencode(project_id)));
    }
    if let Some(value) = quick_start {
        path.push_str(&format!("&quick_start={value}"));
    }
    mc_call(svc, reqwest::Method::GET, &path, None).await
}

/// Web 侧栏同款项目列表；每个项目可携带其最近任务。
pub async fn mc_projects(svc: &Service) -> BzResult<Value> {
    mc_call(svc, reqwest::Method::GET, "/api/v1/users/projects?limit=50", None).await
}

pub async fn mc_task_info(svc: &Service, id: &str) -> BzResult<Value> {
    mc_call(svc, reqwest::Method::GET, &format!("/api/v1/users/tasks/{}", urlencode(id)), None).await
}

/// 云端任务历史回放,归一为 UI 帧词汇:chunk 的 event→type,时间戳纳秒→毫秒;
/// data(base64)原样透传,与本地会话的 Frame 结构同构。
pub async fn mc_task_rounds(svc: &Service, id: &str, cursor: &str, limit: u32) -> BzResult<Value> {
    let mut path = format!("/api/v1/users/tasks/rounds?id={}&limit={limit}", urlencode(id));
    if !cursor.is_empty() {
        path.push_str(&format!("&cursor={}", urlencode(cursor)));
    }
    let out = mc_call(svc, reqwest::Method::GET, &path, None).await?;
    let chunks = out.get("chunks").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let frames: Vec<Value> = chunks
        .iter()
        .map(|c| {
            let mut ts = c.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
            if ts > 100_000_000_000_000 {
                ts /= 1_000_000; // 纳秒级(rounds 落盘粒度)转毫秒,对齐 WS 下行
            }
            let mut f = json!({
                "type": c.get("event").and_then(|v| v.as_str()).unwrap_or(""),
                "timestamp": ts,
            });
            if let Some(kind) = c.get("kind").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
                f["kind"] = json!(kind);
            }
            if let Some(data) = c.get("data").filter(|d| !d.is_null()) {
                f["data"] = data.clone();
            }
            if let Some(seq) = c.get("seq").and_then(|v| v.as_u64()).filter(|&s| s > 0) {
                f["seq"] = json!(seq);
            }
            f
        })
        .collect();
    Ok(json!({
        "frames": frames,
        "next_cursor": out.get("next_cursor").cloned().unwrap_or(json!("")),
        "has_more": out.get("has_more").cloned().unwrap_or(json!(false)),
    }))
}

/// 终止云端任务(区别于 WS 上行 user-cancel:那只中断当前执行)。
pub async fn mc_task_stop(svc: &Service, id: &str) -> BzResult<()> {
    mc_call(svc, reqwest::Method::PUT, "/api/v1/users/tasks/stop", Some(&json!({ "id": id })))
        .await
        .map(|_| ())
}

/// 删除云端任务。服务端会拒绝仍在运行或虚拟机尚在线的任务。
pub async fn mc_task_delete(svc: &Service, id: &str) -> BzResult<()> {
    mc_call(
        svc,
        reqwest::Method::DELETE,
        &format!("/api/v1/users/tasks/{}", urlencode(id)),
        None,
    )
    .await
    .map(|_| ())
}

// ---- 云端建任务默认档位(云端契约)----
// 与 mobile TASK_DEFAULTS / DEFAULT_SKILL_IDS 及 Web 端一致:个人云端固定
// 公共宿主机 + opencode CLI + 2 核 8G 3 小时 + 官方四技能。
// 这是云端产品策略,options 各端点(models/images/projects/subscription)
// 目前均未下发这些档位,只能在壳里钉死;待服务端在 options 应答里补
// task_defaults 字段后,会经 mc_task_options 透传给 UI、由建任务请求带上
// 对应字段优先生效(见 mc_task_create 的取用逻辑),届时删除这些常量迁移。
const MC_DEFAULT_HOST_ID: &str = "public_host";
const MC_DEFAULT_CLI_NAME: &str = "opencode";
/// (核数, 内存字节, 存活秒)
const MC_DEFAULT_RESOURCE: (u64, u64, u64) = (2, 8 << 30, 3 * 60 * 60);
const MC_DEFAULT_SKILL_IDS: [&str; 4] = [
    "MonkeyCodeOfficialPlugins/main/skills/feature-design",
    "MonkeyCodeOfficialPlugins/main/skills/project-wiki",
    "MonkeyCodeOfficialPlugins/main/skills/feature-implementer",
    "MonkeyCodeOfficialPlugins/main/skills/implementation-planner",
];

/// 创建云端任务;返回云端 ProjectTask(含 id)。首轮由服务端用 content 自动启动。
/// 档位字段(host_id/cli_name/resource/skill_ids)优先取 req 里显式下发的值
/// (UI 从 mc_task_options 透传的 task_defaults 取),缺省用壳内常量——
/// 云端改档位只需服务端下发,无需壳发版。
pub async fn mc_task_create(svc: &Service, req: &Value) -> BzResult<Value> {
    let get = |k: &str| req.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let (content, model_id, image_id) = (get("content"), get("model_id"), get("image_id"));
    if content.is_empty() || model_id.is_empty() || image_id.is_empty() {
        return Err(other("任务描述、模型与镜像不能为空"));
    }
    let mut repo = json!({});
    let repo_url = get("repo_url");
    if !repo_url.is_empty() {
        repo["repo_url"] = json!(repo_url);
        let branch = get("branch");
        if !branch.is_empty() {
            repo["branch"] = json!(branch);
        }
    }
    let host_id = get("host_id");
    let host_id = if host_id.is_empty() { MC_DEFAULT_HOST_ID.into() } else { host_id };
    let cli_name = get("cli_name");
    let cli_name = if cli_name.is_empty() { MC_DEFAULT_CLI_NAME.into() } else { cli_name };
    let resource = match req.get("resource") {
        Some(r) if r.is_object() => r.clone(),
        _ => {
            let (core, memory, life) = MC_DEFAULT_RESOURCE;
            json!({ "core": core, "memory": memory, "life": life })
        }
    };
    let skill_ids = match req.get("skill_ids").and_then(|v| v.as_array()) {
        Some(a) if !a.is_empty() => json!(a),
        _ => json!(MC_DEFAULT_SKILL_IDS),
    };
    let mut extra = json!({ "skill_ids": skill_ids });
    let project_id = get("project_id");
    if !project_id.is_empty() {
        extra["project_id"] = json!(project_id);
    }
    let payload = json!({
        "content": content,
        "host_id": host_id,
        "image_id": image_id,
        "model_id": model_id,
        "repo": repo,
        "cli_name": cli_name,
        "resource": resource,
        "task_type": "develop",
        "extra": extra,
    });
    mc_call(svc, reqwest::Method::POST, "/api/v1/users/tasks", Some(&payload)).await
}

/// 建任务所需的下拉数据:模型/宿主机/镜像/项目/订阅档。
/// 宿主机、项目与订阅失败可容忍(公共宿主机仍可使用),模型/镜像失败即报错。
pub async fn mc_task_options(svc: &Service) -> BzResult<Value> {
    let models = mc_call(svc, reqwest::Method::GET, "/api/v1/users/models", None).await?;
    let images = mc_call(svc, reqwest::Method::GET, "/api/v1/users/images", None).await?;
    let arr = |v: &Value, k: &str| -> Value {
        match v.get(k) {
            Some(x) if x.is_array() => x.clone(),
            _ => json!([]),
        }
    };
    let mut res = json!({
        "models": arr(&models, "models"),
        "images": arr(&images, "images"),
        "hosts": [],
        "projects": [],
        "plan": "",
    });
    // 服务端若在 models 应答里下发 task_defaults(host_id/cli_name/resource/
    // skill_ids 档位),原样透传给 UI;UI 建任务时带上,mc_task_create 即优先
    // 取用,壳内常量退位(云端调档不再依赖壳发版)。当前真实云端无此字段。
    if let Some(d) = models.get("task_defaults").filter(|d| d.is_object()) {
        res["task_defaults"] = d.clone();
    }
    if let Ok(hosts) = mc_call(svc, reqwest::Method::GET, "/api/v1/users/hosts", None).await {
        res["hosts"] = arr(&hosts, "hosts");
    }
    if let Ok(projects) = mc_call(svc, reqwest::Method::GET, "/api/v1/users/projects?limit=50", None).await {
        res["projects"] = arr(&projects, "projects");
    }
    if let Ok(sub) = mc_call(svc, reqwest::Method::GET, "/api/v1/users/subscription", None).await {
        res["plan"] = sub.get("plan").cloned().unwrap_or(json!(""));
    }
    Ok(res)
}

/// MonkeyCode 云端包壳 {code,message,data}。401 不看响应体直接判会话失效:
/// 恢复动作是"重新同步云端账号"(桥接登录),与百智云的"重新登录"不同。
pub(crate) const ENV_MC: Envelope = Envelope {
    label: "MonkeyCode ", // 尾部空格:拉丁词与中文文案之间的排版间隔
    code_ok: code_is_zero,
    check_success: false,
    redirect_msg: None,
    fixed_401: Some("MonkeyCode 会话已失效,请重新同步云端账号"),
    whole_body_fallback: false,
};

/// 请求 MonkeyCode 云端接口并解开包壳。
async fn mc_call(svc: &Service, method: reqwest::Method, path: &str, body: Option<&Value>) -> BzResult<Value> {
    let target = format!("{}{}", svc.ep.monkeycode, path);
    let (data, status) = svc.do_store(&svc.mc, method, &target, body).await?;
    unwrap_envelope(&data, status, &ENV_MC)
}

// ==================== 云端 WS 桥 ====================

enum PipeMsg {
    Text(String),
    Close,
}

/// 注册表条目:sender + 代次。代次防"跨代误删"——旧转发任务收尾时
/// 同名 pipe 可能已被 close+重开占用,无代次比较会摘掉新连接的注册项
/// (同 src/browser/bridge.rs drop_conn 的 epoch 方案)。
struct PipeEntry {
    gen: u64,
    tx: mpsc::UnboundedSender<PipeMsg>,
}

/// 云端 WS 管道注册表(壳级单例;与引擎无关)。
/// pipe id 由 UI 生成并先注册好事件监听再来开管道——若由壳生成,
/// 监听注册(异步 IPC)会与转发任务的首批 emit 赛跑,attach 回放丢头帧。
pub struct CloudPipes {
    pipes: StdMutex<HashMap<String, PipeEntry>>,
    /// 代次发号器(进程内单调递增,溢出无虞)
    next_gen: AtomicU64,
}

impl CloudPipes {
    pub fn new() -> Self {
        Self { pipes: StdMutex::new(HashMap::new()), next_gen: AtomicU64::new(0) }
    }

    /// 检查与占位一步完成(持同一把锁):占用即报错,否则立刻 insert——
    /// 消除"检查通过→20s 连接→才 insert"窗口里并发 open 同名 pipe 的
    /// TOCTOU(双流交织、互删注册项)。返回本次的代次。
    fn claim(&self, pipe: &str, tx: mpsc::UnboundedSender<PipeMsg>) -> Result<u64, String> {
        let gen = self.next_gen.fetch_add(1, Ordering::Relaxed);
        let mut map = self.pipes.lock().unwrap();
        if map.contains_key(pipe) {
            return Err("该管道已在连接中或已占用".into());
        }
        map.insert(pipe.to_string(), PipeEntry { gen, tx });
        Ok(gen)
    }

    /// 按代次摘除:仅当注册项仍是自己那一代才删——连接失败/转发任务收尾
    /// 只清理自己的占位,不碰后来者。
    fn remove_gen(&self, pipe: &str, gen: u64) {
        let mut map = self.pipes.lock().unwrap();
        if map.get(pipe).map(|e| e.gen) == Some(gen) {
            map.remove(pipe);
        }
    }
}

/// 云端 wss 地址(cookie 罐按 https 形态取,Secure cookie 匹配 scheme)。
fn pipe_urls(svc: &Service, kind: &str, id: &str, params: &Value) -> Result<(String, String), String> {
    let path = match kind {
        "stream" => {
            let mode = params.get("mode").and_then(|v| v.as_str()).unwrap_or("attach");
            let mode = if mode == "new" { "new" } else { "attach" };
            format!("/api/v1/users/tasks/stream?id={}&mode={mode}", urlencode(id))
        }
        "control" => format!("/api/v1/users/tasks/control?id={}", urlencode(id)),
        "terminal" => {
            let tid = params.get("terminal_id").and_then(|v| v.as_str()).unwrap_or("");
            if tid.is_empty() {
                return Err("缺少 terminal_id".into());
            }
            format!("/api/v1/users/hosts/vms/{}/terminals/connect?terminal_id={}", urlencode(id), urlencode(tid))
        }
        _ => return Err(format!("未知 WS 桥类型 {kind}")),
    };
    let https_url = format!("{}{}", svc.ep.monkeycode, path);
    let ws_url = https_url.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    Ok((https_url, ws_url))
}

#[tauri::command]
pub async fn cloud_ws_open(
    app: AppHandle,
    bz: State<'_, super::BaizhiState>,
    pipes: State<'_, CloudPipes>,
    kind: String,
    id: String,
    params: Value,
    pipe: String,
) -> Result<String, String> {
    if id.is_empty() {
        return Err("缺少资源 ID".into());
    }
    if pipe.is_empty() || pipe.len() > 64 {
        return Err("pipe id 非法".into());
    }
    let svc = &bz.0;
    if svc.mc.is_empty() {
        return Err("MonkeyCode 会话缺失,请先同步云端账号".into());
    }
    let (https_url, ws_url) = pipe_urls(svc, &kind, &id, &params)?;

    let mut req = ws_url
        .clone()
        .into_client_request()
        .map_err(|e| format!("云端地址异常: {e}"))?;
    if let Ok(u) = reqwest::Url::parse(&https_url) {
        if let Some(h) = svc.mc.header(&u) {
            req.headers_mut().insert(
                "Cookie",
                h.parse().map_err(|_| "cookie 头构造失败".to_string())?,
            );
        }
    }

    // 连接前先占位(检查+insert 同锁):并发的第二次 open 同名 pipe 立即
    // 报错,而不是各自跨过 20s 连接窗口后互相覆盖/互删(TOCTOU)。
    // 副作用是连接期间 cloud_ws_send 的帧会入队缓冲,连上后按序发出。
    let (tx, mut rx) = mpsc::unbounded_channel::<PipeMsg>();
    let my_gen = pipes.claim(&pipe, tx)?;

    // 读上限:云端工具输出帧可以很大(Go 侧代理为此把下行上限提到 32MB,
    // "默认 32KB 必炸");tungstenite 默认 max_frame_size 16MiB 不够,放宽到
    // 64MiB(消息级同步放宽),超限会断流并陷入重连循环
    let ws_config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig {
        max_message_size: Some(64 << 20),
        max_frame_size: Some(64 << 20),
        ..Default::default()
    };
    let ws = match tokio::time::timeout(
        Duration::from_secs(20),
        tokio_tungstenite::connect_async_with_config(req, Some(ws_config), false),
    )
    .await
    {
        // 失败必须落壳日志:UI 只拿到 invoke 错误串,循环重连时无从追查;
        // 并且要移除自己的占位(按代次,不误删期间 close+重开的新连接)
        Err(_) => {
            pipes.remove_gen(&pipe, my_gen);
            eprintln!("[desktop] 云端 WS({kind}) 连接超时 url={ws_url}");
            return Err("连接云端任务流超时".into());
        }
        Ok(Err(e)) => {
            pipes.remove_gen(&pipe, my_gen);
            let msg = format!("连接云端任务流失败: {e}");
            eprintln!("[desktop] 云端 WS({kind}) {msg} url={ws_url}");
            return Err(msg);
        }
        Ok(Ok((ws, _))) => ws,
    };

    let pipe_id = pipe;
    let pid = pipe_id.clone();
    let pipes_map = {
        // 任务内需要清理注册表:经 AppHandle state 再取(CloudPipes 是 'static 管理态)
        app.clone()
    };
    tauri::async_runtime::spawn(async move {
        let (mut sink, mut stream) = ws.split();
        // 服务端 Close 帧的 code/reason:必须透传给 UI——正常关闭(1000,如
        // attach 回放完当前轮)与异常断流的重连决策完全不同,丢掉原因码
        // UI 只能靠帧数猜,曾导致"回放→被关→重连"死循环
        let mut close_info: Option<Value> = None;
        loop {
            tokio::select! {
                // biased + rx 在前:连接期间 UI 可能已 close(Close 在队列里),
                // 必须先于下行帧处理,否则会向已注销的 pipe 多 emit 几帧
                biased;
                msg = rx.recv() => match msg {
                    Some(PipeMsg::Text(t)) => {
                        if sink.send(Message::Text(t.into())).await.is_err() {
                            break;
                        }
                    }
                    Some(PipeMsg::Close) | None => break,
                },
                msg = stream.next() => match msg {
                    Some(Ok(Message::Text(t))) => {
                        let _ = pipes_map.emit_to("main", &format!("ws-msg:{pid}"), t.to_string());
                    }
                    Some(Ok(Message::Close(c))) => {
                        close_info = c.map(|f| {
                            serde_json::json!({ "code": u16::from(f.code), "reason": f.reason.to_string() })
                        });
                        break;
                    }
                    Some(Ok(_)) => {} // 二进制/ping 等忽略(云端协议均为文本 JSON)
                    _ => break,
                },
            }
        }
        use tauri::Manager;
        // 收尾按代次摘除:pipe 可能已被 close+重开,不能删别人那一代
        pipes_map.state::<CloudPipes>().remove_gen(&pid, my_gen);
        let _ = pipes_map.emit_to("main", &format!("ws-closed:{pid}"), close_info);
    });
    Ok(pipe_id)
}

#[tauri::command]
pub async fn cloud_ws_send(pipes: State<'_, CloudPipes>, pipe: String, text: String) -> Result<(), String> {
    let map = pipes.pipes.lock().unwrap();
    let entry = map.get(&pipe).ok_or_else(|| "连接已关闭".to_string())?;
    entry.tx.send(PipeMsg::Text(text)).map_err(|_| "连接已关闭".to_string())
}

#[tauri::command]
pub async fn cloud_ws_close(pipes: State<'_, CloudPipes>, pipe: String) -> Result<(), String> {
    if let Some(entry) = pipes.pipes.lock().unwrap().remove(&pipe) {
        let _ = entry.tx.send(PipeMsg::Close);
    }
    Ok(())
}
