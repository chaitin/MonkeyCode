// MonkeyCode 浏览器登录窗:私有化部署的交互式登录。
//
// 账密直连(monkeycode.rs)覆盖不了客户侧的浏览器交互链——企业 OIDC/OAuth
// (backend /api/v1/users/oidc/login → 内部 IdP → callback 落会话)与部署在
// 登录网关(oauth2-proxy 等)之后的实例都要真浏览器才能走完。本模块开一个
// 独立 WebView 窗口指向服务端登录页,用户在窗内完成任意登录链;壳轮询窗口
// cookie 罐,检出有效 MonkeyCode 会话后把 mc 域**全部** cookie(含网关会话,
// 不只 monkeycode 会话)吸入壳的 mc 罐——之后 REST/WS/上传下载照常从罐取
// 凭证,服务端开了哪些登录方式对壳完全透明。
//
// 设计要点:
// - 登录窗 incognito:每次登录都是干净现场(换账号不被 WebView 残留会话
//   静默接管),凭证只落壳侧 0600 罐,不在 WebView 磁盘 profile 里再留一份。
//   代价是重登时要在 IdP 重输一次,与罐的"登录一次长期有效"语义相容。
// - 登录完成的判定不靠导航监听:web 前端是 SPA,登录成功后的 /console 跳转
//   多为 pushState,on_navigation 看不见。改为轮询窗口 cookie,变化时用
//   收割的 cookie 直探 /api/v1/users/status(不经壳罐、不吸收 Set-Cookie),
//   探到有效身份才吸罐 + 罐路权威确认。
// - cookie 收割用全量 cookies() 自筛域:wry 的 cookies_for_url 是**精确**
//   域比较,Domain=.example.com 的网关 cookie 在 macOS 上会被它漏掉。
// - 远程页面拿不到任何 IPC:登录窗 label 不在 tauri.conf.json 任何
//   capability 的 windows 里,保持这一点。
// - 服务切换(transport 代次翻转)时本次登录作废:轮询每拍校验代次,吸罐
//   走 Service::absorb_mc_cookies 的代次守卫兜底竞窗。

use std::fmt::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use super::monkeycode::{confirm_mc_login, user_has_identity, ENV_MC};
use super::{other, unwrap_envelope, BaizhiState, BzErr, BzResult, Service};
use crate::util::LockExt;

/// 登录窗 label。⚠️ 不得加进 tauri.conf.json 任何 capability(远程页面
/// 不许有 IPC);与主窗/桌宠 label 空间共享,保持唯一。
const LOGIN_WINDOW: &str = "mc-login";

/// cookie 轮询间隔。探测请求只在 cookie 集变化时才发,轮询本身不产生流量。
const POLL_INTERVAL: Duration = Duration::from_millis(1000);

/// 进行中的浏览器登录(壳级单例,窗口同刻至多一个)。
pub struct WebLoginCtl {
    active: StdMutex<Option<Arc<ActiveLogin>>>,
}

struct ActiveLogin {
    cancelled: AtomicBool,
    /// 建成后的登录窗句柄。取消/收尾一律按**这一个**句柄关窗,不按 label
    /// 扫射——收尾与新登录开始可交错(finish 释放单例后、close 执行前,
    /// 新登录已建窗),label 寻址会把新登录的窗误关。
    window: StdMutex<Option<tauri::WebviewWindow>>,
}

impl WebLoginCtl {
    pub fn new() -> Self {
        Self {
            active: StdMutex::new(None),
        }
    }

    /// 认领单例。None = 已有登录在进行(调用方把既有窗口带到前台)。
    fn claim(&self) -> Option<Arc<ActiveLogin>> {
        let mut slot = self.active.lock_ok();
        if slot.is_some() {
            return None;
        }
        let mine = Arc::new(ActiveLogin {
            cancelled: AtomicBool::new(false),
            window: StdMutex::new(None),
        });
        *slot = Some(Arc::clone(&mine));
        Some(mine)
    }

    /// 置取消旗并关掉**当前登录自己的**窗(登录不存在时静默:取消与完成
    /// 天然赛跑,不算错;迟到的取消也伤不到下一个登录的窗)。
    fn cancel(&self) {
        let win = {
            let slot = self.active.lock_ok();
            let Some(active) = slot.as_ref() else { return };
            active.cancelled.store(true, Ordering::Relaxed);
            // 先落成具名绑定:尾表达式的临时锁卫会活到外层语句末,
            // 越过 slot 的作用域,借用检查不过
            let win = active.window.lock_ok().clone();
            win
        };
        if let Some(w) = win {
            let _ = w.close();
        }
    }

    /// 摘除自己的登记(仅当在位的仍是自己:收尾与新登录开始可能交错)。
    fn finish(&self, mine: &Arc<ActiveLogin>) {
        let mut slot = self.active.lock_ok();
        if slot.as_ref().is_some_and(|cur| Arc::ptr_eq(cur, mine)) {
            *slot = None;
        }
    }
}

/// cookie 是否属于 mc 主机的作用范围。收割、指纹、探测头三个消费者共用
/// 这一个判定,改口径只改这一处:
/// - 名字为空的畸形条目一律不算(指纹抖动/探测头噪音);
/// - Domain 属性(去前导点)按 RFC 6265 域后缀匹配;TLD 级(无点)Domain
///   只认与 host 完全相等(localhost 联调),与 cookies.rs 罐侧 update 的
///   公共后缀最小防护同口径——否则 Domain=com 这类条目会先被探测头发给
///   服务端、又在入罐时被拒,两侧口径分叉;
/// - 无 Domain 属性按 host-only 收(罐按请求 host 归属)。
fn in_mc_scope(c: &cookie::Cookie<'static>, host: &str) -> bool {
    if c.name().is_empty() {
        return false;
    }
    match c.domain().map(|d| d.trim_start_matches('.')) {
        Some(d) if !d.is_empty() => {
            d == host || (d.contains('.') && host.ends_with(&format!(".{d}")))
        }
        _ => true,
    }
}

/// 窗口 cookie → mc 域作用范围内的 Set-Cookie 行(供 CookieStore::update
/// 吸收)。重建最小行而不用 Cookie::to_string():HttpOnly/SameSite 罐不
/// 消费,Expires 经 CookieBuilder 渲染保证与罐侧同一 crate 解析往返。
fn mc_scope_set_cookies(cookies: &[cookie::Cookie<'static>], host: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for c in cookies.iter().filter(|c| in_mc_scope(c, host)) {
        let mut b = cookie::Cookie::build((c.name().to_string(), c.value().to_string()));
        if let Some(d) = c.domain().map(|d| d.trim_start_matches('.')) {
            if !d.is_empty() {
                b = b.domain(d.to_string());
            }
        }
        let path = c.path().filter(|p| !p.is_empty()).unwrap_or("/");
        b = b.path(path.to_string());
        if c.secure() == Some(true) {
            b = b.secure(true);
        }
        if let Some(exp) = c.expires_datetime() {
            b = b.expires(exp);
        }
        lines.push(b.build().to_string());
    }
    lines
}

/// 收割集的指纹(变化检测用):名值对排序拼接。属性不参与——会话建立表现
/// 为名值变化;Expires 刷新这类纯属性抖动不值得再探一次服务端。
fn cookie_fingerprint(cookies: &[cookie::Cookie<'static>], host: &str) -> String {
    let mut pairs: Vec<String> = cookies
        .iter()
        .filter(|c| in_mc_scope(c, host))
        .map(|c| format!("{}\u{1}{}", c.name(), c.value()))
        .collect();
    pairs.sort();
    pairs.join("\u{2}")
}

/// 收割集拼探测请求的 Cookie 头(路径/Secure 不筛:探测打的就是 mc 域根
/// API,多带无害;真正入罐后的匹配由罐执行)。
fn probe_cookie_header(cookies: &[cookie::Cookie<'static>], host: &str) -> String {
    let mut header = String::new();
    for c in cookies.iter().filter(|c| in_mc_scope(c, host)) {
        if !header.is_empty() {
            header.push_str("; ");
        }
        let _ = write!(header, "{}={}", c.name(), c.value());
    }
    header
}

/// 用收割的 cookie 直探 /api/v1/users/status(不经壳罐,不吸收响应
/// Set-Cookie:登录未完成前的探测不得污染罐)。三态:
/// - Ok(Some(user)):窗内已持有有效 MonkeyCode 会话;
/// - Ok(None):**明确**未登录(网关弹回 3xx / 已解析应答无身份)——这套
///   cookie 不必再探,等下一次变化;
/// - Err(()):传输抖动(网络错误/5xx/形状异常),未取得可判定的应答——
///   调用方**保留指纹**下拍重探。抖动若与未登录混为一谈,登录完成后的
///   最后一次 cookie 变化恰逢抖动时,指纹已落、cookie 不再变,轮询将
///   永远不再探测,用户困在"请在登录窗口中完成登录"。
pub(crate) async fn probe_status(svc: &Service, cookie_header: &str) -> Result<Option<Value>, ()> {
    let target = format!("{}/api/v1/users/status", svc.ep.monkeycode);
    let url = reqwest::Url::parse(&target).map_err(|_| ())?;
    let mut req = svc
        .http_for(&url)
        .map_err(|_| ())?
        .get(url.clone())
        .header(reqwest::header::COOKIE, cookie_header);
    if let Some(b) = svc.mc_basic_header(&url) {
        req = req.header(reqwest::header::AUTHORIZATION, b);
    }
    for (name, value) in svc.mc_identity_headers(&url) {
        req = req.header(name, value);
    }
    let resp = req.send().await.map_err(|_| ())?;
    let status = resp.status().as_u16();
    // 网关把未认证请求弹去登录页:明确未登录,不是抖动
    if (300..400).contains(&status) {
        return Ok(None);
    }
    let body = resp.bytes().await.map_err(|_| ())?;
    match unwrap_envelope(&body, status, &ENV_MC) {
        Ok(out) => {
            let user = out.get("user").cloned().unwrap_or(Value::Null);
            Ok(user_has_identity(&user).then_some(user))
        }
        Err(BzErr::Unauthorized(_)) => Ok(None),
        Err(BzErr::Other(_)) => Err(()),
    }
}

/// 浏览器登录主流程。invoke 挂起直到:登录成功(ok)/用户关窗或取消
/// (cancelled)/服务切换或窗口创建失败(Err)。
async fn run_web_login(
    app: &AppHandle,
    bz: &BaizhiState,
    svc: &Service,
    generation: u64,
    active: &ActiveLogin,
) -> BzResult<Value> {
    let base_url =
        reqwest::Url::parse(&svc.ep.monkeycode).map_err(|e| other(format!("服务地址异常: {e}")))?;
    let host = base_url.host_str().unwrap_or("").to_string();
    let login_url: tauri::Url = format!("{}/login", svc.ep.monkeycode)
        .parse()
        .map_err(|e| other(format!("登录页地址异常: {e}")))?;

    // 上一次登录窗的残影(close 尚未走完)会让同 label 建窗失败;单例已由
    // claim 保证,此刻存在的必是残影,直接销毁
    if let Some(stale) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = stale.destroy();
    }
    let mut builder = WebviewWindowBuilder::new(app, LOGIN_WINDOW, WebviewUrl::External(login_url))
        // 标题带目标主机:IdP 重定向会把窗内页面带去别的域,标题钉住
        // "在登录哪个服务"这一事实
        .title(format!("登录 {host}"))
        .inner_size(480.0, 720.0)
        .min_inner_size(400.0, 560.0)
        .center()
        .incognito(true);
    // 登录窗钉死主窗上报的 UA:本就是同一 WebView 引擎的缺省值,显式钉住
    // 保证与壳侧/引擎随 cookie 发出的身份逐字一致(会话绑定指纹的网关)
    let pinned_ua = svc
        .identity
        .lock_ok()
        .as_ref()
        .map(|i| i.user_agent.clone())
        .filter(|ua| !ua.is_empty());
    if let Some(ua) = pinned_ua {
        builder = builder.user_agent(&ua);
    }
    let win = builder
        .build()
        .map_err(|e| other(format!("登录窗口创建失败: {e}")))?;
    *active.window.lock_ok() = Some(win.clone());
    let closed = Arc::new(AtomicBool::new(false));
    {
        let closed = Arc::clone(&closed);
        win.on_window_event(move |e| {
            if matches!(e, WindowEvent::Destroyed) {
                closed.store(true, Ordering::Relaxed);
            }
        });
    }

    let mut last_fp = String::new();
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        // label 兜底:整个轮询期间单例在手,label 只可能属于本次登录的窗
        if active.cancelled.load(Ordering::Relaxed)
            || closed.load(Ordering::Relaxed)
            || app.get_webview_window(LOGIN_WINDOW).is_none()
        {
            return Ok(json!({ "ok": false, "cancelled": true }));
        }
        // 服务切换即作废:继续轮询只会把 A 服务的窗口会话灌进 B 服务的罐
        if !bz.is_current(generation) {
            return Err(other("服务配置已切换,本次登录已取消"));
        }
        // cookie 读取经主线程派发,平台侧偶发超时(wry 限 1s)按本拍未读到处理
        let Ok(cookies) = win.cookies() else { continue };
        let fp = cookie_fingerprint(&cookies, &host);
        if fp.is_empty() || fp == last_fp {
            continue;
        }
        let header = probe_cookie_header(&cookies, &host);
        match probe_status(svc, &header).await {
            // 抖动:指纹**不落**,同一套 cookie 下拍重探(时序契约见 probe_status 头注)
            Err(()) => continue,
            // 明确未登录:这套 cookie 定案,等下一次变化再探
            Ok(None) => {
                last_fp = fp;
                continue;
            }
            Ok(Some(_)) => {}
        }
        // 窗内会话已有效:mc 域 cookie 全量吸罐(网关会话一并),代次守卫
        // 拦截切服竞窗;随后走罐路权威确认(与账密/桥接同一收尾)
        if !svc.absorb_mc_cookies(&base_url, &mc_scope_set_cookies(&cookies, &host)) {
            return Err(other("服务配置已切换,本次登录已取消"));
        }
        // 确认走罐路,探测刚见过有效会话,这里失败大概率是抖动:重试两拍;
        // 仍失败时罐已吸收,报错文案要指向"稍后查看连接状态"而不是让用户
        // 以为登录整个没成再来一遍
        let mut confirmed = confirm_mc_login(svc).await;
        for _ in 0..2 {
            if confirmed.is_ok() {
                break;
            }
            tokio::time::sleep(POLL_INTERVAL).await;
            confirmed = confirm_mc_login(svc).await;
        }
        let user = confirmed.map_err(|e| {
            other(format!(
                "登录确认未完成({}),请稍后在设置中查看连接状态",
                e.msg()
            ))
        })?;
        let mut resp = json!({ "ok": true });
        if !user.is_null() {
            resp["user"] = user;
        }
        return Ok(resp);
    }
}

/// 浏览器登录:开登录窗并等待完成。窗口生命周期与本命令绑定——成功、
/// 取消、出错都在收尾统一关窗。
#[tauri::command]
pub async fn mc_web_login(
    app: AppHandle,
    bz: State<'_, BaizhiState>,
    ctl: State<'_, WebLoginCtl>,
) -> Result<Value, String> {
    let Some(active) = ctl.claim() else {
        // 已有登录在进行:把既有窗口带回前台,本次调用让位
        if let Some(win) = app.get_webview_window(LOGIN_WINDOW) {
            let _ = win.set_focus();
        }
        return Err("登录窗口已打开,请在该窗口中完成登录".into());
    };
    let (svc, generation) = bz.service_snapshot();
    let result = run_web_login(&app, &bz, &svc, generation, &active).await;
    // 收尾按句柄关自己的窗(不按 label:释放单例后新登录可能已建同名窗)
    let win = active.window.lock_ok().take();
    ctl.finish(&active);
    if let Some(win) = win {
        let _ = win.close();
    }
    result.map_err(BzErr::msg)
}

/// 取消进行中的浏览器登录(关登录自己的窗;无进行中登录时为空操作)。
#[tauri::command]
pub async fn mc_web_login_cancel(ctl: State<'_, WebLoginCtl>) -> Result<Value, String> {
    ctl.cancel();
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ck(raw: &str) -> cookie::Cookie<'static> {
        cookie::Cookie::parse(raw.to_string()).unwrap()
    }

    #[test]
    fn scope_predicate_follows_rfc6265_with_tld_guard() {
        let f = |raw: &str| in_mc_scope(&ck(raw), "mc.example.com");
        assert!(f("a=1; Domain=example.com"), "父域后缀应覆盖");
        assert!(f("a=1; Domain=.example.com"), "前导点形态等价");
        assert!(f("a=1; Domain=mc.example.com"), "同域");
        assert!(f("a=1; Path=/"), "无 Domain 按 host-only 收");
        assert!(!f("a=1; Domain=other.example.com"), "旁系子域不覆盖");
        assert!(!f("a=1; Domain=idp.internal"), "外域不覆盖");
        // TLD 级(无点)Domain 拒收,与罐侧公共后缀防护同口径;
        // 单标签主机(localhost 联调)靠完全相等照常放行
        assert!(!f("a=1; Domain=com"));
        assert!(in_mc_scope(&ck("a=1; Domain=localhost"), "localhost"));
        // 空名畸形条目一律不算(指纹/探测头/收割三处同判;parse 造不出
        // 空名,直接构造——平台罐映射层理论上可能给出)
        assert!(!in_mc_scope(
            &cookie::Cookie::new("", "v"),
            "mc.example.com"
        ));
    }

    /// 收割筛选:本域(含父域 Domain 属性、前导点形态)进,外域出;
    /// host-only 不写 Domain。产出行必须能被壳罐吸收并对 mc 请求出头。
    #[test]
    fn harvest_scopes_to_mc_domain_and_roundtrips_into_jar() {
        let cookies = vec![
            ck("monkeycode_ai_session=s1; Path=/; Domain=mc.example.com"),
            // 网关会话常见形态:父域 + 前导点(wry cookies_for_url 的精确
            // 比较会漏掉它,这正是自筛域的存在理由)
            ck("_oauth2_proxy=g1; Path=/; Domain=.example.com; Secure"),
            ck("tracker=x; Path=/; Domain=idp.internal"),
            ck("csrf=t1; Path=/"),
        ];
        let lines = mc_scope_set_cookies(&cookies, "mc.example.com");
        assert_eq!(lines.len(), 3, "外域 cookie 必须被筛掉: {lines:?}");

        let jar = super::super::cookies::CookieStore::new(None);
        let base = reqwest::Url::parse("https://mc.example.com/").unwrap();
        jar.update(&base, &lines);
        let header = jar
            .header(&reqwest::Url::parse("https://mc.example.com/api/v1/users/tasks").unwrap())
            .unwrap();
        assert!(header.contains("monkeycode_ai_session=s1"), "{header}");
        assert!(header.contains("_oauth2_proxy=g1"), "{header}");
        assert!(header.contains("csrf=t1"), "{header}");
        assert!(!header.contains("tracker"), "{header}");
    }

    /// 指纹只认名值:会话建立(新增/换值)触发探测,纯属性抖动不触发;
    /// 外域 cookie 变化不参与(它们不影响 mc 会话判定)。
    #[test]
    fn fingerprint_tracks_name_value_changes_only() {
        let a = vec![ck("s=1; Domain=mc.example.com")];
        let b = vec![ck("s=1; Domain=mc.example.com; Secure")];
        let c = vec![ck("s=2; Domain=mc.example.com")];
        let d = vec![
            ck("s=1; Domain=mc.example.com"),
            ck("x=9; Domain=idp.internal"),
        ];
        let fp = |v: &Vec<cookie::Cookie<'static>>| cookie_fingerprint(v, "mc.example.com");
        assert_eq!(fp(&a), fp(&b));
        assert_ne!(fp(&a), fp(&c));
        assert_eq!(fp(&a), fp(&d));
    }

    #[test]
    fn probe_header_joins_scoped_pairs() {
        let cookies = vec![
            ck("a=1; Domain=.example.com"),
            ck("b=2; Path=/"),
            ck("evil=3; Domain=idp.internal"),
        ];
        assert_eq!(probe_cookie_header(&cookies, "mc.example.com"), "a=1; b=2");
    }
}
