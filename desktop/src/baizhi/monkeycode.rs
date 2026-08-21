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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::{code_is_zero, other, unwrap_envelope, BzErr, BzResult, Envelope, Service};
use crate::util::urlencode;
use crate::util::LockExt;

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

/// 账号密码直连登录(参考 mobile:POST /api/v1/users/password-login,免鉴权)。
/// 与百智云桥接互为替代:服务端走同一个 Session.Save,cookie 同名
/// (monkeycode_ai_session)落 mc 罐,下游任务/会员模型全部通用。
/// 流程:MC 域 PoW 验证码 → 登录 → status 权威确认(与桥接同款收尾)。
/// password 发**明文**(HTTPS;服务端 bcrypt 比对——domain.TeamLoginReq 注释
/// 里的"MD5 加密后的值"已过时,mobile/web 前端都发明文,勿做前端哈希)。
/// 服务端把密码错/用户不存在等业务失败统一折叠为「登录失败」(code 10606),
/// 经 ENV_MC 解包原样透传。
pub async fn login_monkeycode_password(svc: &Service, email: &str, password: &str) -> BzResult<Value> {
    // 验证码打 MonkeyCode 域;罐传 mc——罐决定 Set-Cookie 吸收方向,
    // 用百智罐会把 mc 域 cookie 混进百智罐,破坏双罐隔离
    let captcha = svc.captcha_token_at(&svc.ep.monkeycode, &svc.mc, "MonkeyCode ").await?;
    mc_call(
        svc,
        reqwest::Method::POST,
        "/api/v1/users/password-login",
        Some(&json!({ "email": email, "password": password, "captcha_token": captcha })),
    )
    .await?;
    confirm_mc_login(svc).await
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

/// 钱包(积分余额 + 每日免费模型 token 额度)。官方云才有这个端点,
/// 私有化部署会 404。
async fn mc_wallet(svc: &Service) -> BzResult<Value> {
    mc_call(svc, reqwest::Method::GET, "/api/v1/users/wallet", None).await
}

/// 会员订阅(等级/到期/续费来源)。开源版后端固定返回基础状态。
async fn mc_subscription(svc: &Service) -> BzResult<Value> {
    mc_call(svc, reqwest::Method::GET, "/api/v1/users/subscription", None).await
}

/// 当天是否已签到。
async fn mc_checkin_status(svc: &Service) -> BzResult<Value> {
    mc_call(svc, reqwest::Method::GET, "/api/v1/users/wallet/checkin", None).await
}

/// 邀请记录({count, items})。头像地址可能是相对路径,由 UI 按 base_url 补全。
async fn mc_invitations(svc: &Service) -> BzResult<Value> {
    mc_call(svc, reqwest::Method::GET, "/api/v1/users/invitations?page=1&size=50", None).await
}

/// 账号权益总览:额度、会员、签到态、邀请记录并发取回。单路失败按缺省
/// (null)降级——私有化部署只有订阅端点,其余都 404,此时仍要能看到会员
/// 等级。全部失败才报错(会话失效/网络不通这类真故障)。
/// base_url 一并回传:邀请链接和相对头像地址都要以它为解析基准,UI 自己
/// 按主机名拼 https:// 会在自建 http/带端口部署上拼错。
pub async fn mc_usage(svc: &Service) -> BzResult<Value> {
    let (wallet, subscription, checkin, invitations) = tokio::join!(
        mc_wallet(svc),
        mc_subscription(svc),
        mc_checkin_status(svc),
        mc_invitations(svc)
    );
    if wallet.is_err() && subscription.is_err() && checkin.is_err() && invitations.is_err() {
        return Err(wallet.unwrap_err());
    }
    Ok(json!({
        "base_url": svc.ep.monkeycode,
        "wallet": wallet.unwrap_or(Value::Null),
        "subscription": subscription.unwrap_or(Value::Null),
        // 取不到时给 null,与"确定没签到"(false)区分——否则会误催已签到的用户
        "checked_in": checkin.ok().and_then(|v| v.get("checked_in").and_then(Value::as_bool)),
        "invitations": invitations.unwrap_or(Value::Null),
    }))
}

/// 每日签到(每天 1 次;与账密登录同一套 MonkeyCode 域 PoW 验证码)。
/// 重复签到等业务失败由服务端包壳原样透传。
pub async fn mc_checkin(svc: &Service) -> BzResult<Value> {
    let captcha = svc.captcha_token_at(&svc.ep.monkeycode, &svc.mc, "MonkeyCode ").await?;
    mc_call(
        svc,
        reqwest::Method::POST,
        "/api/v1/users/wallet/checkin",
        Some(&json!({ "captcha_token": captcha })),
    )
    .await
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

/// 云端任务提问索引(倒序,cursor 向更早翻页;{items, next_cursor, has_more}
/// 原样透传 UI)。content 已是解码明文(超 500 字符截断),timestamp 纳秒、
/// 与 chunk.timestamp 对齐——UI 的提问大纲靠它与帧流对表。
pub async fn mc_task_user_inputs(svc: &Service, id: &str, cursor: &str, limit: u32) -> BzResult<Value> {
    let mut path = format!("/api/v1/users/tasks/user-inputs?id={}&limit={limit}", urlencode(id));
    if !cursor.is_empty() {
        path.push_str(&format!("&cursor={}", urlencode(cursor)));
    }
    mc_call(svc, reqwest::Method::GET, &path, None).await
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

/// 虚拟机终端 session 列表(打开终端面板时先查已有会话并重连,而不是
/// 每次新开——否则 VM 里孤儿终端只增不减;对齐 web 终端面板行为)。
/// 返回 {terminals: [{id, title, created_at, connected_count}]}。
pub async fn mc_terminal_list(svc: &Service, vm_id: &str) -> BzResult<Value> {
    let out = mc_call(
        svc,
        reqwest::Method::GET,
        &format!("/api/v1/users/hosts/vms/{}/terminals", urlencode(vm_id)),
        None,
    )
    .await?;
    // data 是裸数组;异常形状按空列表处理(调用方会退回新建终端)
    let terminals = if out.is_array() { out } else { json!([]) };
    Ok(json!({ "terminals": terminals }))
}

/// 附件上传壳侧护栏:UI 按云端约束(2MB,超限图片先压 webp)拦截,这里只防
/// 超大载荷绕过 UI 直达 IPC;放宽到 4MB 免得两层阈值因压缩误差打架。
const MC_UPLOAD_MAX_BYTES: usize = 4 << 20;

/// 云端聊天附件上传(对齐 web uploadFileWithPresignedUrl):presign 换预签名
/// URL → 壳直传对象存储(PUT 裸字节,预签名 URL 自带凭证,不带鉴权/Content-Type
/// 头)→ 返回 access_url,由 UI 放进 user-input 帧的 attachments。
pub async fn mc_upload(svc: &Service, filename: &str, data: Vec<u8>) -> BzResult<String> {
    if filename.trim().is_empty() {
        return Err(other("附件缺少文件名"));
    }
    if data.is_empty() {
        return Err(other("附件内容为空"));
    }
    if data.len() > MC_UPLOAD_MAX_BYTES {
        return Err(other("附件过大(上限 2MB)"));
    }
    let out = mc_call(
        svc,
        reqwest::Method::POST,
        "/api/v1/uploader/presign",
        Some(&json!({ "filename": filename })),
    )
    .await?;
    let field = |k: &str| out.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let (upload_url, access_url) = (field("upload_url"), field("access_url"));
    if upload_url.is_empty() || access_url.is_empty() {
        return Err(other("预签名应答缺少上传/访问地址"));
    }
    // 直传走长超时客户端:2MB 在慢速网络下可能贴近 30s 普通超时。
    // 预签名地址按主机路由:单机私有化部署对象存储常与主服务同域,
    // 自签证书场景同样要免验证;独立 OSS 域则照常验证
    let upload_url = reqwest::Url::parse(&upload_url).map_err(|e| other(format!("上传地址异常: {e}")))?;
    let resp = svc
        .lp_for(&upload_url)?
        .put(upload_url)
        .body(data)
        .send()
        .await
        .map_err(|e| other(format!("上传附件失败: {e}")))?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(other(format!("上传附件失败(HTTP {status})")));
    }
    Ok(access_url)
}

/// 工作区文件上传壳侧护栏(UI 按 web 控制台同款 10MB 拦截,这里防超大
/// 载荷绕过 UI 直达 IPC;放宽到 12MB 免得两层阈值打架)。
const MC_FILE_UPLOAD_MAX_BYTES: usize = 12 << 20;

/// 上传文件到云端任务 VM 工作区(对齐 web 控制台文件树的"上传文件":
/// POST /api/v1/users/files/upload?id=<vm>&path=<绝对路径>,multipart 字段
/// file)。path 须为 VM 内绝对路径(如 /workspace/dir/name.txt),文件名取
/// 其末段。
pub async fn mc_file_upload(svc: &Service, vm_id: &str, path: &str, data: Vec<u8>) -> BzResult<()> {
    if vm_id.is_empty() {
        return Err(other("缺少虚拟机 ID"));
    }
    let filename = path.rsplit('/').next().unwrap_or("").to_string();
    if !path.starts_with('/') || filename.is_empty() {
        return Err(other("目标路径必须是文件的绝对路径"));
    }
    if data.is_empty() {
        return Err(other("文件内容为空"));
    }
    if data.len() > MC_FILE_UPLOAD_MAX_BYTES {
        return Err(other("文件过大(上限 10MB)"));
    }
    let target = format!(
        "{}/api/v1/users/files/upload?id={}&path={}",
        svc.ep.monkeycode,
        urlencode(vm_id),
        urlencode(path)
    );
    let url = reqwest::Url::parse(&target).map_err(|e| other(format!("地址异常: {e}")))?;
    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(data).file_name(filename));
    // 长超时客户端:10MB 在慢速网络下会贴近 30s 普通超时
    let mut req = svc.lp_for(&url)?.post(url.clone()).multipart(form);
    if let Some(h) = svc.mc.header(&url) {
        req = req.header(reqwest::header::COOKIE, h);
    }
    if let Some(b) = svc.mc_basic_header(&url) {
        req = req.header(reqwest::header::AUTHORIZATION, b);
    }
    let resp = req.send().await.map_err(|e| other(format!("上传失败: {e}")))?;
    let status = resp.status().as_u16();
    let body = resp.bytes().await.map_err(|e| other(format!("读取响应失败: {e}")))?;
    unwrap_envelope(&body, status, &ENV_MC).map(|_| ())
}

/// 下载取消旗标注册表(壳级单例,dl_id 由 UI 生成)。旗标在下载启动时登记、
/// 收尾时摘除;cancel 只置旗,由下载循环在块间自检收束并清残件。
pub struct DownloadCtl {
    flags: StdMutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DownloadCtl {
    pub fn new() -> Self {
        Self { flags: StdMutex::new(HashMap::new()) }
    }

    fn claim(&self, id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut map = self.flags.lock_ok();
        if map.contains_key(id) {
            return Err("该下载已在进行中".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        map.insert(id.to_string(), flag.clone());
        Ok(flag)
    }

    fn remove(&self, id: &str) {
        self.flags.lock_ok().remove(id);
    }

    pub fn cancel(&self, id: &str) {
        // 不存在(已完成/未开始)静默:取消与完成天然赛跑,不算错
        if let Some(f) = self.flags.lock_ok().get(id) {
            f.store(true, Ordering::Relaxed);
        }
    }
}

/// 进度事件节流间隔:够手感流畅,也不会让 IPC 事件刷屏。
const DL_PROGRESS_EVERY: Duration = Duration::from_millis(150);

/// 下载读等待的心跳间隔:把 stream.next() 的无限等待切成小段,每拍检查
/// 取消旗标(否则取消只在块间生效,连接停摆时永远收不到下一块)。
const DL_READ_TICK: Duration = Duration::from_secs(1);

/// 连续无数据判连接停摆的上限。下载刻意不设总超时(大 zip 慢网会被掐,
/// 见函数头注释),但 TCP 半开(切网/合盖休眠、NAT 静默丢映射)时流会
/// 永久 pending:健康的流式 zip 不会整两分钟一个字节都不给。
const DL_IDLE_TIMEOUT: Duration = Duration::from_secs(120);

/// 从云端任务 VM 工作区下载文件/目录到本地(对齐 web 控制台文件树的
/// "下载":GET /api/v1/users/files/download,目录由服务端打成 zip)。
/// 流式写入 dest,不整包过内存/IPC;失败/取消清掉残件。返回写入字节数。
///
/// 进度经 `dl-progress:{dl_id}` 事件上报 {written, total}:total 取
/// Content-Length,而服务端只在 VM agent 预告了大小(SIZE 帧)时才设——
/// 目录 zip 是流式打包,基本拿不到,UI 按 null 降级为字节计数展示。
///
/// 专用一次性 client:Service 的常规 client 带 30/40s **总**超时,大 zip
/// 在慢速网络下必然中途被掐——下载只限连接超时,不限总时长。
pub async fn mc_file_download(
    app: &AppHandle,
    ctl: &DownloadCtl,
    svc: &Service,
    dl_id: &str,
    vm_id: &str,
    path: &str,
    filename: &str,
    dest: &str,
) -> BzResult<u64> {
    if dl_id.is_empty() || dl_id.len() > 64 {
        return Err(other("下载 id 非法"));
    }
    let flag = ctl.claim(dl_id).map_err(other)?;
    let out = do_file_download(app, &flag, svc, dl_id, vm_id, path, filename, dest).await;
    ctl.remove(dl_id);
    out
}

async fn do_file_download(
    app: &AppHandle,
    cancel: &AtomicBool,
    svc: &Service,
    dl_id: &str,
    vm_id: &str,
    path: &str,
    filename: &str,
    dest: &str,
) -> BzResult<u64> {
    if vm_id.is_empty() {
        return Err(other("缺少虚拟机 ID"));
    }
    if !path.starts_with('/') {
        return Err(other("目标路径必须是绝对路径"));
    }
    if dest.is_empty() {
        return Err(other("缺少保存位置"));
    }
    let target = format!(
        "{}/api/v1/users/files/download?id={}&path={}&filename={}",
        svc.ep.monkeycode,
        urlencode(vm_id),
        urlencode(path),
        urlencode(filename)
    );
    let url = reqwest::Url::parse(&target).map_err(|e| other(format!("地址异常: {e}")))?;
    let mut cb = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15));
    if svc.tls_insecure_for(&url) {
        cb = cb.danger_accept_invalid_certs(true);
    }
    let client = cb.build().map_err(|e| other(format!("HTTP 客户端构建失败: {e}")))?;
    let mut req = client.get(url.clone());
    if let Some(h) = svc.mc.header(&url) {
        req = req.header(reqwest::header::COOKIE, h);
    }
    if let Some(b) = svc.mc_basic_header(&url) {
        req = req.header(reqwest::header::AUTHORIZATION, b);
    }
    let resp = req.send().await.map_err(|e| other(format!("下载失败: {e}")))?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        // 失败时响应体是 JSON 包壳:借 unwrap_envelope 取可读的 message
        let body = resp.bytes().await.unwrap_or_default();
        return match unwrap_envelope(&body, status, &ENV_MC) {
            Err(e) => Err(e),
            Ok(_) => Err(other(format!("下载失败(HTTP {status})"))),
        };
    }
    // total = Content-Length(见函数头注释:目录 zip 基本没有,事件里为 null)
    let total = resp.content_length();
    let emit_progress = |written: u64| {
        let _ = app.emit_to(
            "main",
            &format!("dl-progress:{dl_id}"),
            json!({ "written": written, "total": total }),
        );
    };
    emit_progress(0); // 首帧带上 total,UI 立刻能定进度形态(百分比/字节计数)

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| other(format!("创建文件失败: {e}")))?;
    let mut stream = resp.bytes_stream();
    let mut written: u64 = 0;
    let mut last_emit = Instant::now();
    let mut idle = Duration::ZERO;
    loop {
        // StreamExt::next 可安全取消(未 Ready 不消费数据):select 心跳把
        // 无限读等待切成 1s 小段,停摆的连接上取消旗标也能及时生效
        let next = tokio::select! {
            next = stream.next() => next,
            _ = tokio::time::sleep(DL_READ_TICK) => {
                idle += DL_READ_TICK;
                if !cancel.load(Ordering::Relaxed) && idle < DL_IDLE_TIMEOUT {
                    continue;
                }
                drop(file);
                let _ = tokio::fs::remove_file(dest).await; // 残件不留
                return if cancel.load(Ordering::Relaxed) {
                    Err(other("下载已取消"))
                } else {
                    Err(other(format!(
                        "下载中断: 连接停摆,连续 {}s 未收到数据",
                        DL_IDLE_TIMEOUT.as_secs()
                    )))
                };
            }
        };
        idle = Duration::ZERO;
        let Some(chunk) = next else { break };
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = tokio::fs::remove_file(dest).await; // 取消不留残件
            return Err(other("下载已取消"));
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                drop(file);
                let _ = tokio::fs::remove_file(dest).await; // 残件不留
                return Err(other(format!("下载中断: {e}")));
            }
        };
        if let Err(e) = tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await {
            drop(file);
            let _ = tokio::fs::remove_file(dest).await;
            return Err(other(format!("写入文件失败: {e}")));
        }
        written += chunk.len() as u64;
        if last_emit.elapsed() >= DL_PROGRESS_EVERY {
            last_emit = Instant::now();
            emit_progress(written);
        }
    }
    if let Err(e) = tokio::io::AsyncWriteExt::flush(&mut file).await {
        let _ = tokio::fs::remove_file(dest).await;
        return Err(other(format!("写入文件失败: {e}")));
    }
    emit_progress(written); // 终值:UI 把进度顶满再转"完成"
    Ok(written)
}

// ==================== 会员模型本地同步 ====================

/// 会员模型同步条目的 source 标记(UI 按它分组/整组替换,config.rs 物化
/// 按它决定是否注入 signing_secret;对应 ui/src/types.ts 的
/// SOURCE_MONKEYCODE,两侧改动需同步)。
pub(crate) const SOURCE_MONKEYCODE: &str = "monkeycode";

/// 服务端 interface_type → 本地条目 provider(ui/src/types.ts 词汇)。
/// 未知协议返回 None 由调用方跳过:config.rs route_of 对未知 provider
/// 一律兜底 anthropic,透传会把新协议条目错误物化成 anthropic 请求。
fn provider_of_interface(interface_type: &str) -> Option<&'static str> {
    match interface_type {
        "openai_chat" => Some("openai"),
        "openai_responses" => Some("openai_responses"),
        "anthropic" => Some("anthropic"),
        _ => None,
    }
}

/// 裸档位占位条目(服务端会员档位的占位项,非可调用模型;对齐
/// ui/src/cloud.ts 的 BUILTIN_META)。
fn is_builtin_placeholder(model: &str) -> bool {
    matches!(
        model.to_ascii_lowercase().as_str(),
        "monkeycode-basic" | "monkeycode-pro" | "monkeycode-ultra"
    )
}

/// 会员条目的节序(与 ui groupMemberSections / Web 分组同序,两侧改动需
/// 同步):基础 0 → 专业 1 → 旗舰 2 → 付费(public 非档位)3 → 我的 4 →
/// 团队 5。同步输出按它排序,配置顺序即设置页/选择器的展示顺序。
fn member_section_rank(model: &str, owner: &str) -> u8 {
    let n = model.to_ascii_lowercase();
    if n.starts_with("monkeycode-basic") {
        0
    } else if n.starts_with("monkeycode-pro") {
        1
    } else if n.starts_with("monkeycode-ultra") {
        2
    } else if owner == "private" {
        4
    } else if owner == "team" {
        5
    } else {
        3
    }
}

/// 会员档位是否覆盖该模型(按内置命名前缀,与 ui/src/cloud.ts 的
/// planAllowsModel 同一规则,两侧改动需同步):basic 档与非内置命名恒可用,
/// pro 前缀要 pro/flagship/ultra 档,ultra 前缀要 flagship/ultra 档。
fn plan_allows_model(model: &str, plan: &str) -> bool {
    let n = model.to_ascii_lowercase();
    if n.starts_with("monkeycode-ultra") {
        matches!(plan, "flagship" | "ultra")
    } else if n.starts_with("monkeycode-pro") {
        matches!(plan, "pro" | "flagship" | "ultra")
    } else {
        true
    }
}

/// POST /api/v1/users/ohmyagent/api-keys(无请求参数)。三个字段都必需,
/// 缺任一即在此快失败,别拖到对话时变成难解释的上游报错。
pub async fn mc_ohmyagent_key_create(svc: &Service) -> BzResult<Value> {
    let out = mc_call(svc, reqwest::Method::POST, "/api/v1/users/ohmyagent/api-keys", None).await?;
    let has = |k: &str| out.get(k).and_then(Value::as_str).map(|s| !s.is_empty()).unwrap_or(false);
    if !has("id") || !has("api_key") || !has("signing_secret") {
        return Err(other("同步准备失败:服务端响应缺少必要字段"));
    }
    Ok(out)
}

/// DELETE /api/v1/users/ohmyagent/api-keys/{id}。
pub async fn mc_ohmyagent_key_delete(svc: &Service, id: &str) -> BzResult<()> {
    mc_call(
        svc,
        reqwest::Method::DELETE,
        &format!("/api/v1/users/ohmyagent/api-keys/{}", urlencode(id)),
        None,
    )
    .await
    .map(|_| ())
}

/// users/models 条目 → 本地模型条目(ui/src/types.ts HostModel 词汇)。
/// 收 owner.type ∈ {public, private, team}(未知/缺失跳过——形状不明的
/// 条目宁缺勿滥);会员档未覆盖的内置模型**不再剔除**,改打 `locked: true`
/// (UI 灰态展示禁选,物化层跳过,升级会员重同步后解锁,对齐 Web 的
/// canUseModelBySubscription 灰态)。请求的 model 字段传**服务端模型名**
/// ——swagger 写"传模型配置 ID"是过时文档,后端实际按模型名解析(后端
/// 同学确认);私有/团队模型属于该用户,同样按名解析。base_url/api_key
/// 为空占位,物化时由壳补齐(config.rs write_ohmyagent_config)。
/// 逐条容错,不拖垮整批。
fn local_model_entries(items: &[Value], plan: &str) -> (Vec<Value>, Vec<String>) {
    // (节序, weight, name, entry):映射后统一排序——节序 → weight 降序
    // (服务端权重,容缺按 0,与 cloud.ts byWeightThenName 同款)→ name
    let mut keyed: Vec<(u8, i64, String, Value)> = Vec::new();
    let mut notes = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut dup_names = 0usize; // 同批重名:不再丢弃,只提示(落盘名靠 id 区分)
    // 跳过计数:同步条数对不上时,消息里要能说清差额去哪了(逐条列会太长)
    let (mut alien_owner, mut placeholder) = (0usize, 0usize);
    for it in items {
        let s = |k: &str| it.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
        let owner = match it.pointer("/owner/type").and_then(Value::as_str) {
            Some(o @ ("public" | "private" | "team")) => o,
            // owner 整个缺席按 public 收:服务端该字段是 omitempty,且只在模型
            // 挂着 user 边时才填(backend domain/model.go Model::From),会员内置
            // 模型来自内部 hook,这一层不保证带上——丢掉它们就是"同步的模型不全"。
            // UI 早就容缺(memberCategory 把无 owner 归「付费」),两侧口径就此对齐
            None if it.get("owner").map_or(true, Value::is_null) => "public",
            // 认不出的归属类型(将来新增的第四种)才跳过,且要出 note
            _ => {
                alien_owner += 1;
                continue;
            }
        };
        // 服务端标了隐藏就是刻意不给用户看的,静默跳过——报个数只是噪音
        if it.get("is_hidden").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let (id, model) = (s("id"), s("model"));
        if id.is_empty() || model.is_empty() || is_builtin_placeholder(&model) {
            placeholder += 1; // 占位/残缺条目不是可调用模型
            continue;
        }
        // 超档 ≠ 排除:展示但禁选(静默,不出 note——菜单灰态即是外显)
        let locked = !plan_allows_model(&model, plan);
        let itype = s("interface_type");
        let Some(provider) = provider_of_interface(&itype) else {
            notes.push(format!("模型 {model} 使用了本版本不支持的协议「{itype}」,已跳过"));
            continue;
        };
        // remark 是后台人起的备注,同批重复很正常。以前撞了就丢第二条(表现
        // 为"同步的模型不全");现在原样收下,由 UI 侧 syncedName 用这里带出去
        // 的服务端配置 id 拼出唯一落盘名(展示层剥掉),不再有条目因重名蒸发
        let name = { let n = s("remark"); if n.is_empty() { model.clone() } else { n } };
        let mut entry = json!({
            "name": name.clone(),
            "id": id.clone(),
            "provider": provider,
            "base_url": "",
            "api_key": "",
            "model": model,
            "source": SOURCE_MONKEYCODE,
            "owner": owner,
        });
        if locked {
            entry["locked"] = json!(true); // omit-false:解锁条目不携带该字段
        }
        let num = |k: &str| it.get(k).and_then(Value::as_i64).filter(|&n| n > 0);
        if let Some(cw) = num("context_limit") {
            entry["context_window"] = json!(cw);
        }
        // 服务端配的输出上限原样收下(2026-08-06 用户定案):此前按
        // 「max_output < context_window×10%」丢弃越界值,是为迁就设置页那条
        // 同口径的保存校验(否则同步条目把整次保存拦死)。那条校验已撤,这里
        // 再丢就是净损失——服务端 output_limit 默认 32000、窗口默认 200000,
        // 恰好 16% 必被丢,表现为「同步回来没有 max_output」,落引擎默认反而
        // 可能高于服务端本意
        if let Some(mo) = num("output_limit") {
            entry["max_output"] = json!(mo);
        }
        if it.get("support_image").and_then(Value::as_bool).unwrap_or(false) {
            entry["vision"] = json!(true);
        }
        // thinking_enabled 对 public 条目刻意忽略(用户拍板):会员内置
        // 模型来自服务端内部 hook,该字段并不可靠(漏填即 false),照抄会
        // 把支持思考的模型默认压成关闭。统一跟随产品默认档「低」(config.rs
        // 未配置时物化 thinking low),真不支持的由用户在设置页调 off。
        // 私有/团队条目是用户自己配置的,标了不支持就该尊重——否则默认档
        // 「低」的首个请求就会被上游拒。
        if owner != "public" && it.get("thinking_enabled").and_then(Value::as_bool) == Some(false) {
            entry["think"] = json!("off");
        }
        if !seen.insert(name.clone()) {
            dup_names += 1;
        }
        let weight = it.get("weight").and_then(Value::as_i64).unwrap_or(0);
        keyed.push((member_section_rank(&model, owner), weight, name, entry));
    }
    if dup_names > 0 {
        notes.push(format!("{dup_names} 条模型与同批条目重名,已按服务端配置区分收录"));
    }
    if alien_owner > 0 {
        notes.push(format!("{alien_owner} 条模型的归属类型无法识别,已跳过"));
    }
    if placeholder > 0 {
        notes.push(format!("{placeholder} 条档位占位/字段残缺的条目未同步"));
    }
    keyed.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    (keyed.into_iter().map(|(_, _, _, e)| e).collect(), notes)
}

/// 同步会员模型:模型清单来自 GET /api/v1/users/models(超出订阅档的
/// 内置模型标 locked 展示禁选;订阅读取失败可容忍,进阶档全部锁定并出
/// note,重新同步可恢复)。返回 {models, notes}(与 baizhi_sync 返回形状
/// 平行;不碰 config.json)。
pub async fn mc_member_models_sync(svc: &Service) -> BzResult<Value> {
    // 服务端是游标分页,limit 缺省只给 100(backend handler List);显式要 200,
    // 还有下一页就出 note——宁可说清楚,也不让用户对着少掉的条目猜
    let out = mc_call(svc, reqwest::Method::GET, "/api/v1/users/models?limit=200", None).await?;
    // out 为 Null 单独翻译成"会话失效":会话过期若不是标准 401(有 fixed_401
    // 兜住)而是 2xx 登录页/空 data,unwrap_envelope 的 2xx 宽容分支会折成
    // Null——报"格式异常"让用户摸不着头脑(同 sync.rs console_items,
    // 2026-08-12 反馈)。真正的契约漂移(结构对不上)才报格式异常
    if out.is_null() {
        return Err(BzErr::Unauthorized("MonkeyCode 会话已失效,请在设置中重新连接".into()));
    }
    let items = out
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| other(format!("模型列表响应格式异常: {}", super::snippet(&out.to_string(), 120))))?;
    let mut notes = Vec::new();
    if out.pointer("/page/has_next_page").and_then(Value::as_bool) == Some(true) {
        notes.push("服务端模型超过 200 条,本次只同步了前 200 条".to_string());
    }
    let plan = match mc_call(svc, reqwest::Method::GET, "/api/v1/users/subscription", None).await {
        Ok(v) => v.get("plan").and_then(Value::as_str).unwrap_or("").to_string(),
        Err(e) => {
            notes.push(format!("订阅信息读取失败({}),进阶档模型已按不可用锁定,重新同步可恢复", e.msg()));
            String::new()
        }
    };
    let (models, mut map_notes) = local_model_entries(&items, &plan);
    notes.append(&mut map_notes);
    Ok(json!({ "models": models, "notes": notes }))
}

/// MonkeyCode 云端包壳 {code,message,data}。401 不看响应体直接判会话失效:
/// 恢复动作是到设置中重新连接(百智云桥接或账号密码登录皆可),文案保持
/// 中性不偏向某一种登录方式。
pub(crate) const ENV_MC: Envelope = Envelope {
    label: "MonkeyCode ", // 尾部空格:拉丁词与中文文案之间的排版间隔
    code_ok: code_is_zero,
    check_success: false,
    redirect_msg: None,
    fixed_401: Some("MonkeyCode 会话已失效,请在设置中重新连接"),
    whole_body_fallback: false,
};

/// 请求 MonkeyCode 云端接口并解开包壳。
async fn mc_call(svc: &Service, method: reqwest::Method, path: &str, body: Option<&Value>) -> BzResult<Value> {
    let target = format!("{}{}", svc.ep.monkeycode, path);
    let (data, status) = svc.do_store(&svc.mc, method, &target, body).await?;
    unwrap_envelope(&data, status, &ENV_MC)
}

// ==================== 云端 WS 桥 ====================

/// 云端 WS 桥的 TLS connector:跳过证书验证生效且目标落在 mc 域时给
/// 免验证 rustls 配置,否则 None(tungstenite 默认 webpki 验证)。
fn ws_connector(svc: &Service, https_url: &str) -> Option<tokio_tungstenite::Connector> {
    let url = reqwest::Url::parse(https_url).ok()?;
    if !svc.tls_insecure_for(&url) {
        return None;
    }
    insecure_rustls_config().map(tokio_tungstenite::Connector::Rustls)
}

/// 免验证 rustls 配置(进程内构建一次)。仅云端 WS 桥用——HTTP 侧
/// reqwest 有内置 danger_accept_invalid_certs,不走这里。构建失败
/// (密码学后端异常,实际不可达)返回 None,调用方退回默认验证
/// connector:表现为证书错误,而不是把壳拖崩。
fn insecure_rustls_config() -> Option<Arc<rustls::ClientConfig>> {
    use std::sync::OnceLock;
    static CFG: OnceLock<Option<Arc<rustls::ClientConfig>>> = OnceLock::new();
    CFG.get_or_init(|| {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let base = rustls::ClientConfig::builder_with_provider(Arc::clone(&provider))
            .with_safe_default_protocol_versions()
            .inspect_err(|e| eprintln!("[desktop] 免验证 TLS 配置构建失败: {e}"))
            .ok()?;
        Some(Arc::new(
            base.dangerous()
                .with_custom_certificate_verifier(Arc::new(NoCertVerify(provider)))
                .with_no_client_auth(),
        ))
    })
    .clone()
}

/// 放行一切服务器证书(私有化自签部署)。跳过的只是证书链与主机名校验,
/// 握手签名验证照常执行,与 reqwest danger_accept_invalid_certs 同口径。
#[derive(Debug)]
struct NoCertVerify(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for NoCertVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

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
        let mut map = self.pipes.lock_ok();
        if map.contains_key(pipe) {
            return Err("该管道已在连接中或已占用".into());
        }
        map.insert(pipe.to_string(), PipeEntry { gen, tx });
        Ok(gen)
    }

    fn claim_with_service(
        &self,
        bz: &super::BaizhiState,
        pipe: &str,
        tx: mpsc::UnboundedSender<PipeMsg>,
    ) -> Result<(Arc<Service>, u64), String> {
        bz.with_current_service(|current| {
            let gen = self.claim(pipe, tx)?;
            Ok((Arc::clone(current), gen))
        })
    }

    pub(crate) fn close_all(&self) {
        let entries = {
            let mut map = self.pipes.lock_ok();
            std::mem::take(&mut *map)
        };
        for entry in entries.into_values() {
            let _ = entry.tx.send(PipeMsg::Close);
        }
    }

    /// 按代次摘除:仅当注册项仍是自己那一代才删——连接失败/转发任务收尾
    /// 只清理自己的占位,不碰后来者。
    fn remove_gen(&self, pipe: &str, gen: u64) {
        let mut map = self.pipes.lock_ok();
        if map.get(pipe).map(|e| e.gen) == Some(gen) {
            map.remove(pipe);
        }
    }
}

struct PipeReservation<'a> {
    pipes: &'a CloudPipes,
    pipe: String,
    gen: u64,
    active: bool,
}

impl PipeReservation<'_> {
    fn commit(mut self) -> u64 {
        self.active = false;
        self.gen
    }
}

impl Drop for PipeReservation<'_> {
    fn drop(&mut self) {
        if self.active {
            self.pipes.remove_gen(&self.pipe, self.gen);
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
    // 服务快照与管道占位共享 BaizhiState 锁,配置切换只能关闭完整的旧代次。
    // 构建或连接失败时 reservation 自动撤销占位。
    let (tx, mut rx) = mpsc::unbounded_channel::<PipeMsg>();
    let (svc, my_gen) = pipes.claim_with_service(&bz, &pipe, tx)?;
    let reservation = PipeReservation {
        pipes: &pipes,
        pipe: pipe.clone(),
        gen: my_gen,
        active: true,
    };

    if svc.mc.is_empty() {
        return Err("MonkeyCode 会话缺失,请先在设置中连接 MonkeyCode 账号".into());
    }
    let (https_url, ws_url) = pipe_urls(&svc, &kind, &id, &params)?;

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
        // 测试环境反代的 Basic Auth 对 WS 升级请求同样生效(对齐 mobile 的
        // 带头 WebSocket;业务鉴权走 cookie,Authorization 头空闲)
        if let Some(b) = svc.mc_basic_header(&u) {
            req.headers_mut().insert(
                "Authorization",
                b.parse().map_err(|_| "Basic Auth 头构造失败".to_string())?,
            );
        }
    }

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
        tokio_tungstenite::connect_async_tls_with_config(
            req,
            Some(ws_config),
            false,
            ws_connector(&svc, &https_url),
        ),
    )
    .await
    {
        // 失败必须落壳日志:UI 只拿到 invoke 错误串,循环重连时无从追查;
        // reservation 会按代次移除自己的占位,不误删后来者。
        Err(_) => {
            eprintln!("[desktop] 云端 WS({kind}) 连接超时 url={ws_url}");
            return Err("连接云端任务流超时".into());
        }
        Ok(Err(e)) => {
            let msg = format!("连接云端任务流失败: {e}");
            eprintln!("[desktop] 云端 WS({kind}) {msg} url={ws_url}");
            return Err(msg);
        }
        Ok(Ok((ws, _))) => ws,
    };
    let my_gen = reservation.commit();

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
    let map = pipes.pipes.lock_ok();
    let entry = map.get(&pipe).ok_or_else(|| "连接已关闭".to_string())?;
    entry.tx.send(PipeMsg::Text(text)).map_err(|_| "连接已关闭".to_string())
}

#[tauri::command]
pub async fn cloud_ws_close(pipes: State<'_, CloudPipes>, pipe: String) -> Result<(), String> {
    if let Some(entry) = pipes.pipes.lock_ok().remove(&pipe) {
        let _ = entry.tx.send(PipeMsg::Close);
    }
    Ok(())
}

#[cfg(test)]
mod local_models_tests {
    use super::*;
    use crate::baizhi::Endpoints;

    #[test]
    fn service_switch_closes_old_claim_without_closing_new_claim() {
        let state = super::super::BaizhiState::new(Service::test_service(Endpoints {
            account: "https://account.example.com".into(),
            model_gateway: "https://models.example.com".into(),
            mcp_gateway: "https://mcp.example.com".into(),
            monkeycode: "https://old.example.com".into(),
        }));
        let pipes = CloudPipes::new();
        let (old_tx, mut old_rx) = mpsc::unbounded_channel();
        let (old, _) = pipes.claim_with_service(&state, "old", old_tx).unwrap();
        assert_eq!(old.ep.monkeycode, "https://old.example.com");

        let cfg = crate::config::DesktopConfig {
            mc_base_url: "https://new.example.com".into(),
            mc_basic_auth: "new-auth".into(),
            ..Default::default()
        };
        let expected_monkeycode = Endpoints::resolve(&cfg.mc_base_url).monkeycode;
        state.apply_config(&cfg, &pipes);
        assert!(matches!(old_rx.try_recv(), Ok(PipeMsg::Close)));

        let (new_tx, mut new_rx) = mpsc::unbounded_channel();
        let (new, _) = pipes.claim_with_service(&state, "new", new_tx).unwrap();
        assert_eq!(new.ep.monkeycode, expected_monkeycode);
        assert!(matches!(new_rx.try_recv(), Err(mpsc::error::TryRecvError::Empty)));
    }

    #[test]
    fn close_all_disconnects_existing_cloud_pipes() {
        let pipes = CloudPipes::new();
        let (first_tx, mut first_rx) = mpsc::unbounded_channel();
        let first_gen = pipes.claim("first", first_tx).unwrap();
        let (second_tx, mut second_rx) = mpsc::unbounded_channel();
        pipes.claim("second", second_tx).unwrap();

        pipes.close_all();

        assert!(matches!(first_rx.try_recv(), Ok(PipeMsg::Close)));
        assert!(matches!(second_rx.try_recv(), Ok(PipeMsg::Close)));
        let (replacement_tx, _replacement_rx) = mpsc::unbounded_channel();
        let replacement_gen = pipes.claim("first", replacement_tx).unwrap();
        pipes.remove_gen("first", first_gen);
        assert_eq!(pipes.pipes.lock_ok().get("first").map(|entry| entry.gen), Some(replacement_gen));
    }

    #[test]
    fn interface_type_vocabulary_pinned() {
        // 服务端 openai_chat ↔ 本地 openai 的词汇差异是唯一改名点;
        // 未知协议必须拒绝(route_of 的 anthropic 兜底不适用于它们)
        assert_eq!(provider_of_interface("openai_chat"), Some("openai"));
        assert_eq!(provider_of_interface("openai_responses"), Some("openai_responses"));
        assert_eq!(provider_of_interface("anthropic"), Some("anthropic"));
        assert_eq!(provider_of_interface("grpc_v2"), None);
        assert_eq!(provider_of_interface(""), None);
    }

    #[test]
    fn plan_tier_rule_matches_cloud_picker() {
        // 与 ui/src/cloud.ts planAllowsModel 同一规则(前缀配档)
        assert!(plan_allows_model("monkeycode-basic-x", "basic"));
        assert!(plan_allows_model("some-other-model", ""));
        assert!(!plan_allows_model("monkeycode-pro-x", "basic"));
        assert!(plan_allows_model("monkeycode-pro-x", "pro"));
        assert!(plan_allows_model("monkeycode-pro-x", "flagship"));
        assert!(!plan_allows_model("monkeycode-ultra-x", "pro"));
        assert!(plan_allows_model("monkeycode-ultra-x", "ultra"));
        assert!(plan_allows_model("Monkeycode-Pro-X", "pro"), "档位前缀不区分大小写");
    }

    fn pub_owner() -> Value {
        json!({ "type": "public" })
    }

    #[test]
    fn entry_mapping_filters_and_field_renames() {
        let items = vec![
            json!({ "id": "cfg-1", "remark": "旗舰模型", "model": "monkeycode-ultra-x", "interface_type": "anthropic",
                    "owner": pub_owner(), "context_limit": 200_000, "output_limit": 16_384, "support_image": true }),
            // remark 空回退模型名;openai_chat → openai;thinking_enabled
            // 服务端标 false(该字段不可靠,同步须忽略)
            json!({ "id": "cfg-2", "remark": "", "model": "mc-gpt", "interface_type": "openai_chat",
                    "owner": pub_owner(), "thinking_enabled": false }),
            // 未知协议 → 跳过 + note
            json!({ "id": "cfg-3", "remark": "新协议", "model": "m-new", "interface_type": "grpc_v2", "owner": pub_owner() }),
            // 裸档位占位 → 静默跳过
            json!({ "id": "cfg-4", "remark": "专业档", "model": "monkeycode-ultra", "interface_type": "anthropic", "owner": pub_owner() }),
            // 私有条目(用户在服务端自配)→ 收录,标注 thinking_enabled:false
            // 时须尊重(用户自己标的,不同于 public 的不可靠内部 hook)
            json!({ "id": "cfg-5", "remark": "私有", "model": "my-model", "interface_type": "anthropic",
                    "owner": { "type": "private" }, "thinking_enabled": false }),
            // 隐藏条目 → 静默跳过
            json!({ "id": "cfg-6", "remark": "隐藏", "model": "hidden-model", "interface_type": "anthropic",
                    "owner": pub_owner(), "is_hidden": true }),
            // 与首条重名 → 照常收录(落盘名由 UI 用 id 区分),只出提示
            json!({ "id": "cfg-7", "remark": "旗舰模型", "model": "m-dup", "interface_type": "anthropic", "owner": pub_owner() }),
            // 团队条目 → 收录;owner 整个缺席 → 按 public 收录(服务端 omitempty,
            // 内部 hook 的会员内置模型不保证带);认不出的归属类型 → 跳过 + note
            json!({ "id": "cfg-8", "remark": "团队", "model": "team-model", "interface_type": "anthropic",
                    "owner": { "type": "team", "name": "翼龙组" } }),
            json!({ "id": "cfg-9", "remark": "无主", "model": "orphan", "interface_type": "anthropic" }),
            json!({ "id": "cfg-10", "remark": "未知主", "model": "alien", "interface_type": "anthropic",
                    "owner": { "type": "galaxy" } }),
        ];
        let (models, notes) = local_model_entries(&items, "ultra");
        assert_eq!(models.len(), 6, "同批重名不再丢条目: {models:?}");
        // 服务端配置 id 随条目带出:UI 侧靠它拼唯一落盘名
        assert_eq!(models[0].get("id").and_then(Value::as_str), Some("cfg-1"));
        let dups: Vec<_> = models
            .iter()
            .filter(|m| m.get("name").and_then(Value::as_str) == Some("旗舰模型"))
            .filter_map(|m| m.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(dups, vec!["cfg-1", "cfg-7"], "重名两条都在,靠 id 区分");
        let m0 = &models[0];
        assert_eq!(m0.get("name").and_then(Value::as_str), Some("旗舰模型"));
        assert_eq!(m0.get("provider").and_then(Value::as_str), Some("anthropic"));
        // model 字段 = 服务端模型名(swagger 的"配置 ID"是过时文档);
        // base_url/api_key 为空占位,物化时由壳补齐
        assert_eq!(m0.get("model").and_then(Value::as_str), Some("monkeycode-ultra-x"));
        assert_eq!(m0.get("api_key").and_then(Value::as_str), Some(""));
        assert_eq!(m0.get("base_url").and_then(Value::as_str), Some(""));
        assert_eq!(m0.get("source").and_then(Value::as_str), Some("monkeycode"));
        assert_eq!(m0.get("context_window").and_then(Value::as_i64), Some(200_000));
        assert_eq!(m0.get("max_output").and_then(Value::as_i64), Some(16_384));
        assert_eq!(m0.get("vision").and_then(Value::as_bool), Some(true));
        let by = |name: &str| {
            models
                .iter()
                .find(|m| m.get("name").and_then(Value::as_str) == Some(name))
                .unwrap_or_else(|| panic!("条目 {name} 应被收录: {models:?}"))
        };
        let m1 = by("mc-gpt");
        assert_eq!(m1.get("name").and_then(Value::as_str), Some("mc-gpt"));
        assert_eq!(m1.get("model").and_then(Value::as_str), Some("mc-gpt"), "remark 空时 name==model,与百智云同构");
        assert_eq!(m1.get("provider").and_then(Value::as_str), Some("openai"));
        assert!(m1.get("vision").is_none());
        assert!(m1.get("context_window").is_none());
        // thinking_enabled 对 public 忽略(不可靠内部 hook,漏填即 false),
        // 对 private/team(用户自配)标 false 时须写 off
        assert!(m1.get("think").is_none(), "public 标 false 也不压 off");
        assert!(m0.get("think").is_none(), "未标注的模型跟随产品默认档");
        // 无主条目按 public 收:排在付费节(节序 3),在私有/团队之前
        let orphan = models.iter().find(|m| m.get("name").and_then(Value::as_str) == Some("无主")).expect("无主条目应被收录");
        assert_eq!(orphan.get("owner").and_then(Value::as_str), Some("public"));
        let m2 = by("私有");
        assert_eq!(m2.get("name").and_then(Value::as_str), Some("私有"));
        assert_eq!(m2.get("owner").and_then(Value::as_str), Some("private"));
        assert_eq!(m2.get("think").and_then(Value::as_str), Some("off"), "私有条目标 false 须尊重");
        let m3 = by("团队");
        assert_eq!(m3.get("owner").and_then(Value::as_str), Some("team"));
        assert_eq!(m0.get("owner").and_then(Value::as_str), Some("public"));
        assert!(
            !models.iter().any(|m| m.get("name").and_then(Value::as_str) == Some("未知主")),
            "认不出的归属类型仍要跳过: {models:?}"
        );
        // 未知协议 1 + 重名提示 1 + 两类跳过计数(归属不明 1 / 占位 1);
        // 隐藏条目静默跳过,不出 note
        assert_eq!(notes.len(), 4, "{notes:?}");
        assert!(notes.iter().any(|n| n.contains("与同批条目重名,已按服务端配置区分收录")), "{notes:?}");
        assert!(!notes.iter().any(|n| n.contains("隐藏")), "隐藏条目不该出 note: {notes:?}");
        assert!(notes.iter().any(|n| n.contains("归属类型无法识别")), "{notes:?}");
        assert!(notes.iter().any(|n| n.contains("占位")), "{notes:?}");
    }

    #[test]
    fn plan_gating_marks_higher_tiers_locked() {
        let items = vec![
            json!({ "id": "c1", "model": "monkeycode-basic-a", "interface_type": "anthropic", "owner": pub_owner() }),
            json!({ "id": "c2", "model": "monkeycode-pro-a", "interface_type": "anthropic", "owner": pub_owner() }),
            json!({ "id": "c3", "model": "monkeycode-ultra-a", "interface_type": "anthropic", "owner": pub_owner() }),
        ];
        let (models, notes) = local_model_entries(&items, "pro");
        let names: Vec<_> = models.iter().filter_map(|m| m.get("model").and_then(Value::as_str)).collect();
        assert_eq!(
            names,
            vec!["monkeycode-basic-a", "monkeycode-pro-a", "monkeycode-ultra-a"],
            "超档条目保留(展示禁选),不再剔除"
        );
        assert!(models[0].get("locked").is_none(), "档内条目无 locked(omit-false)");
        assert!(models[1].get("locked").is_none());
        assert_eq!(models[2].get("locked").and_then(Value::as_bool), Some(true), "ultra 超出 pro 档 → locked");
        assert!(notes.is_empty(), "锁定静默不出 note(菜单灰态即外显)");
    }

    #[test]
    fn empty_plan_locks_all_tiers_but_not_custom() {
        // 订阅读取失败(plan="")的降级路径:内置档全锁、非内置命名
        // (私有/团队/付费自定义)不受档位门限
        let items = vec![
            json!({ "id": "c1", "model": "monkeycode-pro-a", "interface_type": "anthropic", "owner": pub_owner() }),
            json!({ "id": "c2", "model": "some-model", "interface_type": "anthropic", "owner": { "type": "private" } }),
        ];
        let (models, _) = local_model_entries(&items, "");
        assert_eq!(models[0].get("locked").and_then(Value::as_bool), Some(true));
        assert!(models[1].get("locked").is_none(), "非内置命名不锁");
    }

    #[test]
    fn entries_sorted_by_section_then_weight_then_name() {
        // 乱序输入 → 节序(基础→专业→旗舰→付费→我的→团队)→ 节内
        // weight 降序(容缺按 0)→ name 升序;配置顺序即展示顺序
        let items = vec![
            json!({ "id": "c1", "model": "team-x", "interface_type": "anthropic", "owner": { "type": "team" } }),
            json!({ "id": "c2", "model": "my-x", "interface_type": "anthropic", "owner": { "type": "private" } }),
            json!({ "id": "c3", "model": "paid-low", "interface_type": "anthropic", "owner": pub_owner(), "weight": 1 }),
            json!({ "id": "c4", "model": "paid-high", "interface_type": "anthropic", "owner": pub_owner(), "weight": 9 }),
            json!({ "id": "c5", "model": "monkeycode-ultra/u", "interface_type": "anthropic", "owner": pub_owner() }),
            json!({ "id": "c6", "model": "monkeycode-basic/b", "interface_type": "anthropic", "owner": pub_owner() }),
            json!({ "id": "c7", "model": "paid-a", "interface_type": "anthropic", "owner": pub_owner(), "weight": 1 }),
        ];
        let (models, _) = local_model_entries(&items, "ultra");
        let names: Vec<_> = models.iter().filter_map(|m| m.get("name").and_then(Value::as_str)).collect();
        assert_eq!(
            names,
            vec![
                "monkeycode-basic/b",
                "monkeycode-ultra/u",
                "paid-high",
                "paid-a",
                "paid-low",
                "my-x",
                "team-x",
            ],
            "同权重(paid-a/paid-low 均 1)按 name 兜底"
        );
    }

    #[test]
    fn limits_synced_verbatim() {
        // 窗口/输出上限原样同步:服务端默认 200000/32000(占 16%)曾被
        // 「<窗口 10%」的旧规则丢掉,表现为同步回来没有 max_output
        let items = vec![
            json!({ "id": "c1", "model": "m-a", "interface_type": "anthropic", "owner": pub_owner(),
                    "context_limit": 200_000, "output_limit": 32_000 }),
            json!({ "id": "c2", "model": "m-b", "interface_type": "anthropic", "owner": pub_owner(),
                    "context_limit": 128_000, "output_limit": 16_384 }),
            // 服务端没给(内置 hook 常缺):两项都不落,物化时用产品默认
            json!({ "id": "c3", "model": "m-c", "interface_type": "anthropic", "owner": pub_owner(),
                    "context_limit": 0, "output_limit": 0 }),
        ];
        let (models, _) = local_model_entries(&items, "");
        let by = |name: &str| {
            models.iter().find(|m| m.get("model").and_then(Value::as_str) == Some(name)).expect("条目应在")
        };
        assert_eq!(by("m-a").get("context_window").and_then(Value::as_i64), Some(200_000));
        assert_eq!(by("m-a").get("max_output").and_then(Value::as_i64), Some(32_000));
        assert_eq!(by("m-b").get("max_output").and_then(Value::as_i64), Some(16_384));
        assert!(by("m-c").get("context_window").is_none());
        assert!(by("m-c").get("max_output").is_none());
    }
}
