// 百智云账号 + MonkeyCode 云端(agent/internal/baizhi 的 Rust 移植)。
// 壳级单例,与 agent 引擎无关(切到 ohmyagent 云端功能照常)。
// 凭证(cookie)只在壳进程内,UI 经 Tauri IPC 驱动。

pub mod cookies;
pub mod monkeycode;
pub mod pow;
pub mod sync;
pub mod wechat;

#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::State;

use cookies::CookieStore;
use crate::util::LockExt;

const DEFAULT_MODEL_GATEWAY: &str = "https://ai-models.app.baizhi.cloud";
const DEFAULT_MCP_GATEWAY: &str = "https://agent-toolkit.app.baizhi.cloud";
/// MonkeyCode 官方云地址(config.rs 的 Basic Auth 作用域判定也用它)。
pub(crate) const DEFAULT_MONKEYCODE_URL: &str = "https://monkeycode-ai.com";
/// 官方云的模型请求地址:llmproxy 走独立子域,不与主服务同域。
pub(crate) const DEFAULT_MONKEYCODE_LLM_URL: &str = "https://proxy.monkeycode-ai.com/v1";
/// MonkeyCode 国际版官方云地址(设置页版本选择写入 mc_base_url 的值,
/// 与 ui-next settingsForm.ts 的 MC_INTL_URL 保持一致)。
pub(crate) const INTL_MONKEYCODE_URL: &str = "https://monkeycode-ai.net";
/// 国际版官方云的模型请求地址(llmproxy 同样走独立子域)。
pub(crate) const INTL_MONKEYCODE_LLM_URL: &str = "https://proxy.monkeycode-ai.net/v1";

/// 模型请求地址(llmproxy)的单一出处(2026-08-07 用户定案):
/// - 设置里显式填了「模型请求地址」→ 原样用它(拆分部署的逃生门,立即生效);
/// - 否则服务地址就是官方云(国内/国际)→ 各自的独立代理子域;
/// - 否则(自建/私有化/联调)→ 跟随服务地址 {服务地址}/v1:开源后端把
///   llmproxy 挂在主服务的 /v1 下(backend/biz/llmproxy/register.go),同域即达。
///
/// `monkeycode` 传已解析的服务地址(Endpoints::resolve 之后,含环境变量覆盖):
/// 环境变量指向联调环境时按自建处理,不会误发官方代理域。
pub(crate) fn resolve_mc_llm(mc_llm_base_url: &str, monkeycode: &str) -> String {
    let explicit = mc_llm_base_url.trim().trim_end_matches('/');
    if !explicit.is_empty() {
        return explicit.to_string();
    }
    let server = monkeycode.trim().trim_end_matches('/');
    if server == DEFAULT_MONKEYCODE_URL {
        return DEFAULT_MONKEYCODE_LLM_URL.to_string();
    }
    if server == INTL_MONKEYCODE_URL {
        return INTL_MONKEYCODE_LLM_URL.to_string();
    }
    format!("{server}/v1")
}

/// 百智云服务地址。模型与 MCP 服务固定走官方云;账号和 MonkeyCode 地址可覆盖。
pub struct Endpoints {
    /// 账号/登录域(验证码、手机号/微信登录、profile)
    pub account: String,
    /// 模型服务:/api/console/* 取 key 与模型列表;/api/openai、/api/anthropic 推理
    pub model_gateway: String,
    /// Agent 工具包(MCP 服务)
    pub mcp_gateway: String,
    /// MonkeyCode 云端(账号桥接登录 + 云端任务)
    pub monkeycode: String,
}

fn env_or(env: &str, def: &str) -> String {
    std::env::var(env)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| def.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn resolve_monkeycode(mc_base_url: &str, env_override: Option<&str>) -> String {
    let configured = mc_base_url.trim();
    let configured = if configured.is_empty() { DEFAULT_MONKEYCODE_URL } else { configured };
    env_override
        .filter(|value| !value.is_empty())
        .unwrap_or(configured)
        .trim_end_matches('/')
        .to_string()
}

impl Endpoints {
    /// mc_base_url 来自设置(config.json,自建/私有化部署地址;空 = 官方云)。
    /// 优先级:环境变量(开发/联调逃生门)> 设置值 > 官方云默认。
    pub fn resolve(mc_base_url: &str) -> Self {
        let mc_override = std::env::var("MC_DESKTOP_MONKEYCODE_URL").ok();
        Self {
            account: env_or("MC_DESKTOP_BAIZHI_URL", "https://baizhi.cloud"),
            model_gateway: DEFAULT_MODEL_GATEWAY.to_string(),
            mcp_gateway: DEFAULT_MCP_GATEWAY.to_string(),
            monkeycode: resolve_monkeycode(mc_base_url, mc_override.as_deref()),
        }
    }
}

/// 会话失效哨兵:Status 类接口转成"未登录"而非报错;错误信息透传 UI。
pub enum BzErr {
    Unauthorized(String),
    Other(String),
}

impl BzErr {
    pub fn msg(self) -> String {
        match self {
            BzErr::Unauthorized(m) | BzErr::Other(m) => m,
        }
    }
}

pub type BzResult<T> = Result<T, BzErr>;

pub fn other(m: impl Into<String>) -> BzErr {
    BzErr::Other(m.into())
}

/// 百智云账号服务。cookie 分双罐:百智会话(store)与 MonkeyCode 会话(mc),
/// 凭证语义不同,一方登出不牵连另一方。
pub struct Service {
    pub ep: Endpoints,
    /// API 短请求(30s;不自动跟随重定向——微信回调等 302 的 Set-Cookie
    /// 要在首响应就吸收,跟随会丢中间响应的 cookie)
    ///
    /// Option 而非直接 Client:构建只在 TLS 后端起不来时失败,此前是
    /// `.expect()`——而 Service::new 在 setup 里跑,GUI 子系统下(Windows
    /// 无控制台)panic 就是双击没反应、零线索。云端/账号是可降级功能面,
    /// 本地引擎会话并不依赖它,不该被它拖着一起打不开。
    http: Option<reqwest::Client>,
    /// 微信授权页/二维码/长轮询(长轮询最长挂 ~25s)
    lp: Option<reqwest::Client>,
    /// 跳过 mc 域 TLS 证书验证已生效(设置开关开、且服务地址非官方云)。
    /// 免验证只按 URL 作用于 mc 域(tls_insecure_for),百智/官方/第三方
    /// 恒走验证客户端;云端 WS 桥与下载专用客户端也按它判定。
    mc_skip_tls: bool,
    /// http/lp 的免验证形态(仅 mc_skip_tls 时构建;构建失败同 http/lp
    /// 降级为 None,mc 域请求报 TLS 后端错误而不是悄悄退回验证客户端)。
    http_insecure: Option<reqwest::Client>,
    lp_insecure: Option<reqwest::Client>,
    pub store: Arc<CookieStore>,
    pub mc: Arc<CookieStore>,
    mc_cookie_generation: Arc<StdMutex<u64>>,
    mc_cookie_snapshot: u64,
    /// 测试环境反向代理的 Basic Auth 头值(预计算的 "Basic <b64>";None =
    /// 未配置)。仅对 MonkeyCode 域的请求附加,见 mc_basic_header。
    pub(crate) mc_basic: Option<String>,
    /// 模型请求地址(llmproxy):设置里单独指定的值,或默认 {服务地址}/v1。
    /// 会员模型条目的 base_url 快照与物化注入都以它为准。
    pub(crate) mc_llm: String,
    /// 进行中的扫码会话(只保留最新)
    pub wx: Arc<StdMutex<Option<wechat::WechatLogin>>>,
}

/// "user:pass" → 预计算的 Basic Auth 头值(空白 = 未配置)。
fn basic_header_value(user_pass: &str) -> Option<String> {
    use base64::Engine as _;
    let v = user_pass.trim();
    (!v.is_empty()).then(|| format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(v.as_bytes())))
}

/// 服务地址是否官方云(国内/国际)。跳过 TLS 验证的开关对官方云恒不
/// 生效:它只为私有化自签证书而设,不能被拿来弱化官方域的传输安全。
fn is_official_mc(monkeycode: &str) -> bool {
    monkeycode == DEFAULT_MONKEYCODE_URL || monkeycode == INTL_MONKEYCODE_URL
}

/// API 短请求 / 长轮询客户端超时(秒;Service::new 与 reconfigured 共用)。
const HTTP_TIMEOUT_SECS: u64 = 30;
const LP_TIMEOUT_SECS: u64 = 40;

/// API 客户端构建。失败只发生在 TLS 后端起不来时,降级为 None(语义见
/// Service.http 字段注释)。insecure = 跳过证书链与主机名校验(私有化
/// 自签部署的 mc 域专用;加密与完整性保持)。
fn build_client(timeout: u64, insecure: bool) -> Option<reqwest::Client> {
    let mut b = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(timeout));
    if insecure {
        b = b.danger_accept_invalid_certs(true);
    }
    b.build()
        .inspect_err(|e| eprintln!("[desktop] HTTP 客户端构建失败(云端/账号功能不可用): {e}"))
        .ok()
}

impl Service {
    /// 测试构造:端点可注入,cookie 仅内存。
    #[cfg(test)]
    pub fn test_service(ep: Endpoints) -> Self {
        let mk = |timeout: u64| {
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(timeout))
                .build()
                .expect("构建 HTTP 客户端失败")
        };
        let mc_llm = resolve_mc_llm("", &ep.monkeycode);
        Self {
            ep,
            http: Some(mk(10)),
            lp: Some(mk(10)),
            mc_skip_tls: false,
            http_insecure: None,
            lp_insecure: None,
            store: Arc::new(CookieStore::new(None)),
            mc: Arc::new(CookieStore::new(None)),
            mc_cookie_generation: Arc::new(StdMutex::new(0)),
            mc_cookie_snapshot: 0,
            mc_basic: None,
            mc_llm,
            wx: Arc::new(StdMutex::new(None)),
        }
    }

    pub fn new(config_dir: std::path::PathBuf, cfg: &crate::config::DesktopConfig) -> Self {
        // 构建失败只发生在 TLS 后端初始化不了时。不 panic:壳在 setup 里
        // 构造本服务,GUI 子系统下 panic = 双击没反应、无任何线索。降级为
        // 云端/账号命令逐条报错,本地引擎会话不受影响。
        let ep = Endpoints::resolve(&cfg.mc_base_url);
        let mc_llm = resolve_mc_llm(&cfg.mc_llm_base_url, &ep.monkeycode);
        let mc_skip_tls = cfg.mc_skip_tls_verify && !is_official_mc(&ep.monkeycode);
        Self {
            ep,
            http: build_client(HTTP_TIMEOUT_SECS, false),
            lp: build_client(LP_TIMEOUT_SECS, false),
            mc_skip_tls,
            http_insecure: mc_skip_tls.then(|| build_client(HTTP_TIMEOUT_SECS, true)).flatten(),
            lp_insecure: mc_skip_tls.then(|| build_client(LP_TIMEOUT_SECS, true)).flatten(),
            store: Arc::new(CookieStore::new(Some(config_dir.join("baizhi-cookies.json")))),
            mc: Arc::new(CookieStore::new(Some(config_dir.join("monkeycode-cookies.json")))),
            mc_cookie_generation: Arc::new(StdMutex::new(0)),
            mc_cookie_snapshot: 0,
            mc_basic: basic_header_value(&cfg.mc_basic_auth),
            mc_llm,
            wx: Arc::new(StdMutex::new(None)),
        }
    }

    fn reconfigured(&self, cfg: &crate::config::DesktopConfig) -> (Self, bool) {
        let resolved = Endpoints::resolve(&cfg.mc_base_url);
        let ep = Endpoints {
            account: self.ep.account.clone(),
            model_gateway: self.ep.model_gateway.clone(),
            mcp_gateway: self.ep.mcp_gateway.clone(),
            monkeycode: resolved.monkeycode,
        };
        let mc_llm = resolve_mc_llm(&cfg.mc_llm_base_url, &ep.monkeycode);
        let mc_basic = basic_header_value(&cfg.mc_basic_auth);
        let mc_skip_tls = cfg.mc_skip_tls_verify && !is_official_mc(&ep.monkeycode);
        // 开关翻转也算 transport 变化:免验证与验证客户端的握手行为不同,
        // 在途请求/长连接不应跨形态延续(与地址/Basic 变化同待遇)。
        let transport_changed = self.ep.monkeycode != ep.monkeycode
            || self.mc_basic != mc_basic
            || self.mc_skip_tls != mc_skip_tls;
        let (http_insecure, lp_insecure) = if !mc_skip_tls {
            (None, None)
        } else if self.mc_skip_tls {
            (self.http_insecure.clone(), self.lp_insecure.clone())
        } else {
            (
                build_client(HTTP_TIMEOUT_SECS, true),
                build_client(LP_TIMEOUT_SECS, true),
            )
        };
        let mc_cookie_snapshot = if transport_changed {
            let mut generation = self.mc_cookie_generation.lock_ok();
            *generation = generation.wrapping_add(1);
            *generation
        } else {
            self.mc_cookie_snapshot
        };
        (
            Self {
                ep,
                http: self.http.clone(),
                lp: self.lp.clone(),
                mc_skip_tls,
                http_insecure,
                lp_insecure,
                store: Arc::clone(&self.store),
                mc: Arc::clone(&self.mc),
                mc_cookie_generation: Arc::clone(&self.mc_cookie_generation),
                mc_cookie_snapshot,
                mc_basic,
                mc_llm,
                wx: Arc::clone(&self.wx),
            },
            transport_changed,
        )
    }

    /// 清会话时也推进 Cookie 代次。这样登出前已经发出的请求即使稍后才
    /// 带着 Set-Cookie 返回,也不能把刚清空的当前会话重新写回来。
    fn logged_out(&self) -> Self {
        let mc_cookie_snapshot = {
            let mut generation = self.mc_cookie_generation.lock_ok();
            *generation = generation.wrapping_add(1);
            self.mc.clear();
            *generation
        };
        Self {
            ep: Endpoints {
                account: self.ep.account.clone(),
                model_gateway: self.ep.model_gateway.clone(),
                mcp_gateway: self.ep.mcp_gateway.clone(),
                monkeycode: self.ep.monkeycode.clone(),
            },
            http: self.http.clone(),
            lp: self.lp.clone(),
            mc_skip_tls: self.mc_skip_tls,
            http_insecure: self.http_insecure.clone(),
            lp_insecure: self.lp_insecure.clone(),
            store: Arc::clone(&self.store),
            mc: Arc::clone(&self.mc),
            mc_cookie_generation: Arc::clone(&self.mc_cookie_generation),
            mc_cookie_snapshot,
            mc_basic: self.mc_basic.clone(),
            mc_llm: self.mc_llm.clone(),
            wx: Arc::clone(&self.wx),
        }
    }

    /// 测试环境反向代理的 Basic Auth 头(仅当 url 落在 MonkeyCode 域时返回;
    /// 业务鉴权走 cookie,REST/WS 链路上 Authorization 头是空闲的,对齐
    /// mobile 的 authHeaders)。会员模型的 LLM 调用不走这里:引擎侧由物化
    /// 把 Basic 嵌进条目 base_url 的 userinfo(config.rs with_basic_userinfo,
    /// anthropic 协议可用;openai 系协议因引擎占用 Authorization 仍受限)。
    pub(crate) fn mc_basic_header(&self, url: &reqwest::Url) -> Option<&str> {
        let basic = self.mc_basic.as_deref()?;
        let mc = reqwest::Url::parse(&self.ep.monkeycode).ok()?;
        (url.host_str() == mc.host_str() && url.port_or_known_default() == mc.port_or_known_default())
            .then_some(basic)
    }

    /// 取 API 客户端;TLS 后端起不来时给出可行动错误而不是 panic。
    fn http(&self) -> BzResult<&reqwest::Client> {
        self.http
            .as_ref()
            .ok_or_else(|| other("HTTP 客户端初始化失败(系统 TLS 不可用),云端与账号功能暂不可用"))
    }

    /// 取长轮询客户端(同上)。
    fn lp(&self) -> BzResult<&reqwest::Client> {
        self.lp
            .as_ref()
            .ok_or_else(|| other("HTTP 客户端初始化失败(系统 TLS 不可用),云端与账号功能暂不可用"))
    }

    /// 该 URL 的请求是否跳过 TLS 证书验证:开关生效且落在 mc 域
    /// (host/port 判定与 mc_basic_header 同口径)。云端 WS 桥与下载
    /// 专用客户端也按它决定各自的免验证形态。
    pub(crate) fn tls_insecure_for(&self, url: &reqwest::Url) -> bool {
        if !self.mc_skip_tls {
            return false;
        }
        let Ok(mc) = reqwest::Url::parse(&self.ep.monkeycode) else {
            return false;
        };
        url.host_str() == mc.host_str() && url.port_or_known_default() == mc.port_or_known_default()
    }

    /// 按目标 URL 选 API 客户端:免验证只给 mc 域,百智/官方/第三方恒走
    /// 验证客户端。免验证客户端缺席(TLS 后端异常)时报错,不悄悄退回
    /// 验证客户端——那只会把"开关没生效"伪装成又一次证书错误。
    fn http_for(&self, url: &reqwest::Url) -> BzResult<&reqwest::Client> {
        if self.tls_insecure_for(url) {
            return self
                .http_insecure
                .as_ref()
                .ok_or_else(|| other("HTTP 客户端初始化失败(系统 TLS 不可用),云端与账号功能暂不可用"));
        }
        self.http()
    }

    /// http_for 的长轮询版(上传等长耗时请求用)。
    fn lp_for(&self, url: &reqwest::Url) -> BzResult<&reqwest::Client> {
        if self.tls_insecure_for(url) {
            return self
                .lp_insecure
                .as_ref()
                .ok_or_else(|| other("HTTP 客户端初始化失败(系统 TLS 不可用),云端与账号功能暂不可用"));
        }
        self.lp()
    }

    // ==================== HTTP 基座 ====================

    fn update_response_cookies(&self, store: &CookieStore, url: &reqwest::Url, set_cookies: &[String]) {
        if std::ptr::eq(store, self.mc.as_ref()) {
            let generation = self.mc_cookie_generation.lock_ok();
            if *generation != self.mc_cookie_snapshot {
                return;
            }
            store.update(url, set_cookies);
            return;
        }
        store.update(url, set_cookies);
    }

    /// 发请求:携带指定罐的 cookie,吸收响应的 Set-Cookie。
    /// 返回 (body, status, Location 头)——桥接登录手动跟随重定向需要 Location。
    pub async fn do_store_full(
        &self,
        store: &CookieStore,
        method: reqwest::Method,
        target: &str,
        body: Option<&Value>,
    ) -> BzResult<(Vec<u8>, u16, Option<String>)> {
        let url = reqwest::Url::parse(target).map_err(|e| other(format!("地址异常: {e}")))?;
        let host = url.host_str().unwrap_or("").to_string();
        let mut req = self.http_for(&url)?.request(method, url.clone());
        if let Some(b) = body {
            req = req.json(b);
        }
        if let Some(h) = store.header(&url) {
            req = req.header(reqwest::header::COOKIE, h);
        }
        if let Some(b) = self.mc_basic_header(&url) {
            req = req.header(reqwest::header::AUTHORIZATION, b);
        }
        let resp = req.send().await.map_err(|e| other(format!("请求 {host} 失败: {e}")))?;
        let status = resp.status().as_u16();
        let location = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let set_cookies: Vec<String> = resp
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok().map(str::to_string))
            .collect();
        self.update_response_cookies(store, resp.url(), &set_cookies);
        let data = resp.bytes().await.map_err(|e| other(format!("读取响应失败: {e}")))?;
        Ok((data.to_vec(), status, location))
    }

    /// do_store_full 的常用形态(不关心 Location)。
    pub async fn do_store(
        &self,
        store: &CookieStore,
        method: reqwest::Method,
        target: &str,
        body: Option<&Value>,
    ) -> BzResult<(Vec<u8>, u16)> {
        let (data, status, _) = self.do_store_full(store, method, target, body).await?;
        Ok((data, status))
    }

    /// 账号域相对路径请求(绝对 URL 直接用)。
    async fn account_do(&self, method: reqwest::Method, path: &str, body: Option<&Value>) -> BzResult<(Vec<u8>, u16)> {
        let target = if path.starts_with("http://") || path.starts_with("https://") {
            path.to_string()
        } else {
            format!("{}{}", self.ep.account, path)
        };
        self.do_store(&self.store, method, &target, body).await
    }

    /// GET 任意 URL(百智罐;微信页面/图片/长轮询走这里,超时 40s)。
    pub async fn fetch(&self, raw_url: &str) -> BzResult<Vec<u8>> {
        let url = reqwest::Url::parse(raw_url).map_err(|e| other(format!("地址异常: {e}")))?;
        let mut req = self.lp()?.get(url.clone());
        if let Some(h) = self.store.header(&url) {
            req = req.header(reqwest::header::COOKIE, h);
        }
        let resp = req.send().await.map_err(|e| other(format!("请求失败: {e}")))?;
        let status = resp.status().as_u16();
        let set_cookies: Vec<String> = resp
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok().map(str::to_string))
            .collect();
        self.store.update(resp.url(), &set_cookies);
        if status >= 400 {
            return Err(other(format!("HTTP {status}")));
        }
        resp.bytes().await.map(|b| b.to_vec()).map_err(|e| other(format!("读取响应失败: {e}")))
    }

    /// 请求百智云业务接口并解开 {code,message,success,data} 包壳。
    /// 返回 data(缺 data 字段时返回整个响应体,对齐移动端语义)。
    pub async fn call(&self, method: reqwest::Method, path: &str, body: Option<&Value>) -> BzResult<Value> {
        let (data, status) = self.account_do(method, path, body).await?;
        unwrap_envelope(&data, status, &ENV_BAIZHI)
    }

    /// 裸结构端点请求(验证码 challenge/redeem 不套 {code,data} 包壳,
    /// 2xx 即成功):罐与错误标签由调用方指定。罐参数决定的是
    /// 响应 Set-Cookie 的**吸收方向**(裸结构端点本身多为免鉴权)——
    /// MonkeyCode 域必须传 mc 罐,用百智罐会把 mc 域 cookie 混进百智罐,
    /// 破坏双罐隔离。
    async fn raw_at(
        &self,
        store: &CookieStore,
        method: reqwest::Method,
        target: &str,
        body: Option<&Value>,
        label: &str,
    ) -> BzResult<Value> {
        let (data, status) = self.do_store(store, method, target, body).await?;
        if !(200..300).contains(&status) {
            if let Ok(v) = serde_json::from_slice::<Value>(&data) {
                if let Some(m) = v.get("message").and_then(|m| m.as_str()) {
                    return Err(other(clean_message(m)));
                }
            }
            return Err(http_error(status, &data, label));
        }
        serde_json::from_slice(&data).map_err(|e| other(format!("{label}响应解析失败: {e}")))
    }

    // ==================== 登录/状态 ====================

    /// 百智云域的 PoW 验证码(手机号发码/登录用)。
    async fn obtain_captcha_token(&self) -> BzResult<String> {
        self.captcha_token_at(&self.ep.account, &self.store, "百智云").await
    }

    /// 完整跑一遍 PoW 验证码,返回登录接口所需 captcha_token。百智云与
    /// MonkeyCode 服务端用同一套 go-cap 协议(challenge 201 裸结构 → 本地
    /// 爆破 → redeem 换 token),差异只在域、cookie 罐与错误标签。
    pub(crate) async fn captcha_token_at(&self, base: &str, store: &CookieStore, label: &str) -> BzResult<String> {
        let ch = self
            .raw_at(
                store,
                reqwest::Method::POST,
                &format!("{base}/api/v1/public/captcha/challenge"),
                None,
                label,
            )
            .await
            .map_err(|e| other(format!("获取验证码质询失败: {}", e.msg())))?;
        let token = ch.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let challenge: pow::Challenge = serde_json::from_value(ch.get("challenge").cloned().unwrap_or(Value::Null))
            .map_err(|_| other("验证码质询响应格式异常"))?;
        // valid() 同时给 c/s/d 设上界:参数来自服务端,超界值要么是恶意
        // 要么是协议破损,放进爆破只会钉死 blocking 线程(见 pow.rs)
        if token.is_empty() || !challenge.valid() {
            return Err(other("验证码质询响应格式异常"));
        }
        // SHA-256 爆破是 CPU 密集,丢 blocking 池
        let tk = token.clone();
        let solutions = tauri::async_runtime::spawn_blocking(move || pow::solve_challenges(&tk, challenge))
            .await
            .map_err(|e| other(format!("验证码求解失败: {e}")))?
            .map_err(other)?;
        let rd = self
            .raw_at(
                store,
                reqwest::Method::POST,
                &format!("{base}/api/v1/public/captcha/redeem"),
                Some(&json!({ "token": token, "solutions": solutions })),
                label,
            )
            .await
            .map_err(|e| other(format!("验证码校验失败: {}", e.msg())))?;
        let ok = rd.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
        let rd_token = rd.get("token").and_then(|v| v.as_str()).unwrap_or("");
        if !ok || rd_token.is_empty() {
            let msg = rd.get("message").and_then(|v| v.as_str()).unwrap_or("验证码校验未通过");
            return Err(other(clean_message(msg)));
        }
        Ok(rd_token.to_string())
    }

    /// 发送登录短信验证码(内部先完成 PoW 验证码)。
    pub async fn send_phone_code(&self, phone: &str) -> BzResult<()> {
        let captcha = self.obtain_captcha_token().await?;
        self.call(
            reqwest::Method::POST,
            "/api/v1/user/phone_code",
            Some(&json!({ "phone": phone, "kind": "login", "captcha_token": captcha })),
        )
        .await
        .map(|_| ())
    }

    /// 手机号 + 短信验证码登录;成功后会话 cookie 已持久化。
    pub async fn login_phone(&self, phone: &str, code: &str) -> BzResult<()> {
        let captcha = self.obtain_captcha_token().await?;
        self.call(
            reqwest::Method::POST,
            "/api/v1/user/login/phone",
            Some(&json!({ "phone": phone, "code": code, "captcha_token": captcha })),
        )
        .await
        .map(|_| ())
    }

    /// 会话状态:有 cookie 时探测 profile,200 视为已登录并返回原样 profile。
    pub async fn status(&self) -> BzResult<(bool, Value)> {
        if self.store.is_empty() {
            return Ok((false, Value::Null));
        }
        match self.call(reqwest::Method::GET, "/api/v1/user/profile", None).await {
            Ok(profile) => Ok((true, profile)),
            Err(BzErr::Unauthorized(_)) => Ok((false, Value::Null)),
            Err(e) => Err(e),
        }
    }

    /// 账号域主机名(诊断展示用)。
    pub fn base_host(&self) -> String {
        reqwest::Url::parse(&self.ep.account)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_else(|| self.ep.account.clone())
    }
}

// ==================== 包壳/错误辅助 ====================

/// 包壳解包策略。四个后端(百智云账号域/模型网关/MCP 网关/MonkeyCode)的
/// {code,message,(success),data} 包壳结构相同,差异只在 code 合法值集合、
/// 3xx/401 处理与 data 缺失兜底——用参数钉住差异,防止各自拷贝后语义漂移。
pub(crate) struct Envelope {
    /// http_error 的前缀标签(拉丁词标签自带尾部空格,与中文拼接时留排版间隔)
    pub label: &'static str,
    /// code 字段合法值判定(收到的是 `v.get("code")` 原值,含缺失/非数字情形)
    pub code_ok: fn(Option<&Value>) -> bool,
    /// 是否额外检查 success 布尔字段(百智云账号域包壳带 success)
    pub check_success: bool,
    /// Some(文案):3xx 直接以该文案判失败(MCP 网关未开通时不重定向即 302)
    pub redirect_msg: Option<&'static str>,
    /// Some(文案):401 不看响应体,直接返回固定 Unauthorized
    /// (MonkeyCode 链路的 401 恢复动作是"到设置中重新连接"——桥接或账密皆可)
    pub fixed_401: Option<&'static str>,
    /// data 缺失/为 null 时:true 返回整个响应体(百智云,对齐移动端),false 返回 Null
    pub whole_body_fallback: bool,
}

/// 常规 code 判定:整数 0 合法;缺失或非数字不视为失败(与各链路原语义一致)。
pub(crate) fn code_is_zero(c: Option<&Value>) -> bool {
    c.and_then(Value::as_i64).map(|x| x == 0).unwrap_or(true)
}

/// 百智云账号域:包壳带 success 布尔;缺 data 回整个响应体(对齐移动端)。
pub(crate) const ENV_BAIZHI: Envelope = Envelope {
    label: "百智云",
    code_ok: code_is_zero,
    check_success: true,
    redirect_msg: None,
    fixed_401: None,
    whole_body_fallback: true,
};

/// 按策略解开包壳:非 2xx 或 code/success 判失败;失败信息经 clean_message,
/// 401 转 Unauthorized 哨兵;成功取 data。
pub(crate) fn unwrap_envelope(data: &[u8], status: u16, p: &Envelope) -> BzResult<Value> {
    if let Some(msg) = p.fixed_401 {
        if status == 401 {
            return Err(BzErr::Unauthorized(msg.into()));
        }
    }
    if let Some(msg) = p.redirect_msg {
        if (300..400).contains(&status) {
            return Err(other(msg));
        }
    }
    let is2xx = (200..300).contains(&status);
    let Ok(v) = serde_json::from_slice::<Value>(data) else {
        if is2xx {
            return Ok(Value::Null); // 非 JSON 但 2xx,视为成功无数据
        }
        return Err(http_error(status, data, p.label));
    };
    let code_fail = !(p.code_ok)(v.get("code"));
    let success_fail = p.check_success
        && v.get("success").and_then(|s| s.as_bool()).map(|s| !s).unwrap_or(false);
    if !is2xx || code_fail || success_fail {
        let msg = clean_message(v.get("message").and_then(|m| m.as_str()).unwrap_or(""));
        if msg.is_empty() {
            return Err(http_error(status, &[], p.label));
        }
        if status == 401 {
            return Err(BzErr::Unauthorized(msg));
        }
        return Err(other(msg));
    }
    match v.get("data") {
        Some(d) if !d.is_null() => Ok(d.clone()),
        _ if p.whole_body_fallback => Ok(v),
        _ => Ok(Value::Null),
    }
}

/// trace_id 剥离正则。OnceLock:clean_message 在每条错误路径上被调,
/// 现编译正则(微秒级但反复发生)纯属浪费,进程内编译一次即可。
static TRACE_ID_RE: OnceLock<regex::Regex> = OnceLock::new();

/// 去掉服务端 message 尾部的 trace_id 标注(对齐移动端)。
pub fn clean_message(msg: &str) -> String {
    TRACE_ID_RE
        .get_or_init(|| regex::Regex::new(r"(?i)\s*\[trace_id:[^\]]+\]\s*$").unwrap())
        .replace(msg, "")
        .trim()
        .to_string()
}

/// 诊断片段:非预期响应的原文截断(契约漂移/登录页嗅探的报错与日志用),
/// 按字符截断避免撕裂多字节。
pub(crate) fn snippet(text: &str, max_chars: usize) -> String {
    let t = text.trim();
    if t.chars().count() <= max_chars {
        t.to_string()
    } else {
        let cut: String = t.chars().take(max_chars).collect();
        format!("{cut}…")
    }
}

pub fn http_error(status: u16, body: &[u8], label: &str) -> BzErr {
    if status == 401 {
        return BzErr::Unauthorized(format!("{label}会话已失效,请重新登录"));
    }
    let text = String::from_utf8_lossy(body);
    let text = text.trim();
    if !text.is_empty() && text.len() <= 200 && !text.starts_with('<') {
        other(format!("{label}请求失败(HTTP {status}): {text}"))
    } else {
        other(format!("{label}请求失败(HTTP {status})"))
    }
}

// ==================== Tauri 命令 ====================

pub struct BaizhiState {
    service: StdMutex<Arc<Service>>,
    /// 仅服务地址或 Basic Auth 变化时推进,供 UI 丢弃旧 transport 的异步结果。
    transport_generation: AtomicU64,
    /// 同一时刻只允许一条会员 Key 生命周期操作跨越网络等待。
    member_ops: tokio::sync::Mutex<()>,
    /// 配置切换与 Key 文件最终提交共用的同步边界,消除 check-then-write。
    member_commit: StdMutex<()>,
}

impl BaizhiState {
    pub fn new(service: Service) -> Self {
        Self {
            service: StdMutex::new(Arc::new(service)),
            transport_generation: AtomicU64::new(0),
            member_ops: tokio::sync::Mutex::new(()),
            member_commit: StdMutex::new(()),
        }
    }

    pub fn service(&self) -> Arc<Service> {
        self.service_snapshot().0
    }

    fn service_snapshot(&self) -> (Arc<Service>, u64) {
        let current = self.service.lock_ok();
        (
            Arc::clone(&current),
            self.transport_generation.load(Ordering::SeqCst),
        )
    }

    /// UI 发起操作时携带它看到的壳代次。即使命令先在异步互斥锁上排队，
    /// 真正开始网络请求时也不能悄悄改为操作已经切入的新服务。
    fn service_snapshot_if_current(&self, expected_generation: Option<u64>) -> Option<(Arc<Service>, u64)> {
        let current = self.service.lock_ok();
        let generation = self.transport_generation.load(Ordering::SeqCst);
        if expected_generation.is_some_and(|expected| expected != generation) {
            return None;
        }
        Some((Arc::clone(&current), generation))
    }

    pub(crate) fn with_current_service<T>(&self, f: impl FnOnce(&Arc<Service>) -> T) -> T {
        let current = self.service.lock_ok();
        f(&current)
    }

    fn is_current(&self, expected_generation: u64) -> bool {
        let _current = self.service.lock_ok();
        self.transport_generation.load(Ordering::SeqCst) == expected_generation
    }

    #[cfg(test)]
    pub fn transport_generation(&self) -> u64 {
        self.transport_generation.load(Ordering::SeqCst)
    }

    /// 更新后续 IPC 使用的服务快照。在途请求持有旧 Arc,不会被切换打断。
    /// 服务地址或 Basic Auth 变化时,在同一切换边界内关闭旧云端长连接。
    pub fn apply_config(
        &self,
        cfg: &crate::config::DesktopConfig,
        pipes: &monkeycode::CloudPipes,
    ) -> Option<u64> {
        let _commit = self.member_commit.lock_ok();
        let mut current = self.service.lock_ok();
        let (next, transport_changed) = current.reconfigured(cfg);
        let next = Arc::new(next);
        *current = next;
        if transport_changed {
            let generation = self.transport_generation.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
            // service 锁保持到管道关闭完成:新 claim 不会插进 swap 与 close_all 之间。
            pipes.close_all();
            Some(generation)
        } else {
            None
        }
    }

    /// Key 文件的比较并交换。校验当前 transport 代次、文件旧内容与最终提交在
    /// member_commit 锁内完成,配置切换不可能夹在校验与写盘/删除之间。
    fn commit_member_key(
        &self,
        expected_generation: u64,
        path: &std::path::Path,
        expected_file: Option<&[u8]>,
        replacement: Option<&[u8]>,
    ) -> BzResult<()> {
        let _commit = self.member_commit.lock_ok();
        let _current = self.service.lock_ok();
        if self.transport_generation.load(Ordering::SeqCst) != expected_generation {
            return Err(other("服务配置已切换,旧服务的会员密钥结果已丢弃,请重试"));
        }
        let actual = read_optional_file(path)?;
        if actual.as_deref() != expected_file {
            return Err(other("会员密钥文件已被更新,本次旧结果未写入,请重试"));
        }
        match replacement {
            Some(data) => crate::config::atomic_write_private(path, data).map_err(other),
            None => match std::fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(other(format!("删除会员密钥失败: {e}"))),
            },
        }
    }

    /// 只在断开流程开始时捕获的 transport 仍是当前代次时清 Cookie。清理与服务
    /// 校验原子化,并推进 Cookie 代次以拦截登出前的迟到 Set-Cookie。
    fn logout_if_current(&self, expected_generation: u64, pipes: &monkeycode::CloudPipes) -> bool {
        let _commit = self.member_commit.lock_ok();
        let mut current = self.service.lock_ok();
        if self.transport_generation.load(Ordering::SeqCst) != expected_generation {
            return false;
        }
        *current = Arc::new(current.logged_out());
        pipes.close_all();
        true
    }
}

fn valid_phone(p: &str) -> bool {
    p.len() == 11 && p.starts_with('1') && p.bytes().all(|b| b.is_ascii_digit()) && (b'3'..=b'9').contains(&p.as_bytes()[1])
}

fn valid_code(c: &str) -> bool {
    (4..=6).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_digit())
}

#[tauri::command]
pub async fn baizhi_status(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    let svc = bz.service();
    let (logged_in, profile) = svc.status().await.map_err(BzErr::msg)?;
    let mut resp = json!({ "logged_in": logged_in, "host": svc.base_host() });
    if !profile.is_null() {
        resp["profile"] = profile;
    }
    Ok(resp)
}

#[tauri::command]
pub async fn baizhi_send_code(bz: State<'_, BaizhiState>, phone: String) -> Result<Value, String> {
    if !valid_phone(&phone) {
        return Err("请输入有效的手机号".into());
    }
    bz.service().send_phone_code(&phone).await.map_err(BzErr::msg)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn baizhi_login(bz: State<'_, BaizhiState>, phone: String, code: String) -> Result<Value, String> {
    if !valid_phone(&phone) || !valid_code(&code) {
        return Err("请输入有效的手机号和短信验证码".into());
    }
    bz.service().login_phone(&phone, &code).await.map_err(BzErr::msg)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn baizhi_logout(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    bz.service().store.clear();
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn baizhi_wechat_start(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    let qr = wechat::start_wechat_login(&bz.service()).await.map_err(BzErr::msg)?;
    Ok(json!({ "qr": qr }))
}

#[tauri::command]
pub async fn baizhi_wechat_poll(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    let status = wechat::poll_wechat_login(&bz.service()).await.map_err(BzErr::msg)?;
    Ok(json!({ "status": status }))
}

#[tauri::command]
pub async fn baizhi_sync(bz: State<'_, BaizhiState>, known_keys: Option<Vec<String>>) -> Result<Value, String> {
    sync::sync(&bz.service(), &known_keys.unwrap_or_default()).await.map_err(BzErr::msg)
}

#[tauri::command]
pub async fn mc_status(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    let svc = bz.service();
    let (logged_in, user) = monkeycode::mc_status(&svc).await.map_err(BzErr::msg)?;
    let mut resp = json!({
        "logged_in": logged_in,
        "host": monkeycode::mc_host(&svc),
        "base_url": svc.ep.monkeycode,
    });
    if !user.is_null() {
        resp["user"] = user;
    }
    Ok(resp)
}

#[tauri::command]
pub async fn mc_login(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    let user = monkeycode::login_monkeycode(&bz.service()).await.map_err(BzErr::msg)?;
    let mut resp = json!({ "ok": true });
    if !user.is_null() {
        resp["user"] = user;
    }
    Ok(resp)
}

/// MonkeyCode 账号密码直连登录(不经百智云;壳内自动完成 PoW 验证码)。
/// 校验对齐 mobile 的弱校验:仅非空;password **不 trim**——首尾空格是
/// 密码的一部分,trim 会与 mobile/web 行为分叉。
#[tauri::command]
pub async fn mc_password_login(bz: State<'_, BaizhiState>, email: String, password: String) -> Result<Value, String> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err("请输入邮箱和密码".into());
    }
    let user = monkeycode::login_monkeycode_password(&bz.service(), email, &password)
        .await
        .map_err(BzErr::msg)?;
    let mut resp = json!({ "ok": true });
    if !user.is_null() {
        resp["user"] = user;
    }
    Ok(resp)
}

#[tauri::command]
pub async fn mc_logout(
    bz: State<'_, BaizhiState>,
    pipes: State<'_, monkeycode::CloudPipes>,
) -> Result<Value, String> {
    let _op = bz.member_ops.lock().await;
    let (_, generation) = bz.service_snapshot();
    bz.logout_if_current(generation, &pipes);
    Ok(json!({ "ok": true }))
}

/// 账号权益(额度/会员/签到态/邀请一次取回;单路缺席按 null 降级,见 mc_usage)。
#[tauri::command]
pub async fn mc_usage(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    monkeycode::mc_usage(&bz.service()).await.map_err(BzErr::msg)
}

/// 每日签到(壳内自动完成 PoW 验证码)。成功后 UI 重拉 mc_usage 刷新余额。
#[tauri::command]
pub async fn mc_checkin(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    monkeycode::mc_checkin(&bz.service()).await.map_err(BzErr::msg)?;
    Ok(json!({ "ok": true }))
}

// ==================== 会员模型本地同步 ====================

pub(crate) const OHMYAGENT_KEY_FILE: &str = "monkeycode-ohmyagent-key.json";

fn read_optional_file(path: &std::path::Path) -> BzResult<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(other(format!("读取会员密钥失败: {e}"))),
    }
}

fn parse_ohmyagent_key(data: &[u8]) -> Option<Value> {
    let v: Value = serde_json::from_slice(data).ok()?;
    let has = |k: &str| v.get(k).and_then(Value::as_str).map(|s| !s.is_empty()).unwrap_or(false);
    (has("id") && has("api_key")).then_some(v)
}

/// 已落盘的记录(要求 id 与 api_key 齐全,损坏视为无)。
pub(crate) fn stored_ohmyagent_key(cfg_dir: &std::path::Path) -> Option<Value> {
    let data = std::fs::read(cfg_dir.join(OHMYAGENT_KEY_FILE)).ok()?;
    parse_ohmyagent_key(&data)
}

fn mc_transport_fingerprint(server: &str, basic: Option<&str>) -> String {
    use sha2::{Digest as _, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"monkeycode-transport-v1\0");
    hash.update(server.as_bytes());
    hash.update(b"\0");
    hash.update(basic.unwrap_or("").as_bytes());
    let digest = hash.finalize();
    format!("{digest:x}")
}

fn ohmyagent_key_matches_transport(key: &Value, server: &str, llm: &str, basic: Option<&str>) -> bool {
    let expected = mc_transport_fingerprint(server, basic);
    if let Some(stored) = key.get("transport").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        return stored == expected;
    }

    // 旧版文件没有 transport。没有 Basic 时尚可用 server(再老版本用
    // base_url)确认身份;配置了 Basic 后无法证明是同一套反代凭证,宁可要求
    // 重新同步,也不能把别的服务签发的 key 注入当前引擎。
    if basic.is_some() {
        return false;
    }
    if let Some(stored) = key.get("server").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        return stored == server;
    }
    key.get("base_url").and_then(Value::as_str).filter(|s| !s.is_empty()) == Some(llm)
}

pub(crate) fn ohmyagent_key_matches_config(key: &Value, cfg: &crate::config::DesktopConfig) -> bool {
    let ep = Endpoints::resolve(&cfg.mc_base_url);
    let llm = resolve_mc_llm(&cfg.mc_llm_base_url, &ep.monkeycode);
    let basic = basic_header_value(&cfg.mc_basic_auth);
    ohmyagent_key_matches_transport(key, &ep.monkeycode, &llm, basic.as_deref())
}

fn stamp_ohmyagent_key(mut key: Value, svc: &Service) -> Value {
    key["server"] = json!(svc.ep.monkeycode);
    key["base_url"] = json!(svc.mc_llm);
    key["transport"] = json!(mc_transport_fingerprint(&svc.ep.monkeycode, svc.mc_basic.as_deref()));
    key
}

/// 取本机记录,没有就创建并立刻落盘。`server` 变化(切换了服务地址)作废
/// 重建,仅 `base_url` 变化则原地刷新。新记录同时绑定服务地址与 Basic Auth。
#[cfg(test)]
async fn ensure_ohmyagent_key(svc: &Service, cfg_dir: &std::path::Path) -> BzResult<Value> {
    let persist = |k: &Value| {
        crate::config::atomic_write_private(&cfg_dir.join(OHMYAGENT_KEY_FILE), k.to_string().as_bytes())
            .map_err(other)
    };
    if let Some(k) = stored_ohmyagent_key(cfg_dir) {
        if ohmyagent_key_matches_transport(&k, &svc.ep.monkeycode, &svc.mc_llm, svc.mc_basic.as_deref()) {
            let k = stamp_ohmyagent_key(k, svc);
            persist(&k)?;
            return Ok(k);
        }
    }
    let k = stamp_ohmyagent_key(monkeycode::mc_ohmyagent_key_create(svc).await?, svc);
    persist(&k)?;
    Ok(k)
}

/// 生产命令使用的带代次 + 文件身份检查版本。网络等待前记住原文件,
/// 等待后通过 BaizhiState 的 CAS 提交；切服或外部改写都会使旧结果失效。
async fn ensure_ohmyagent_key_current(
    bz: &BaizhiState,
    svc: &Arc<Service>,
    transport_generation: u64,
    cfg_dir: &std::path::Path,
) -> BzResult<Value> {
    let path = cfg_dir.join(OHMYAGENT_KEY_FILE);
    let before = read_optional_file(&path)?;
    if let Some(k) = before.as_deref().and_then(parse_ohmyagent_key) {
        if ohmyagent_key_matches_transport(&k, &svc.ep.monkeycode, &svc.mc_llm, svc.mc_basic.as_deref()) {
            let stamped = stamp_ohmyagent_key(k, svc);
            let data = serde_json::to_vec(&stamped).map_err(|e| other(format!("序列化会员密钥失败: {e}")))?;
            if before.as_deref() != Some(data.as_slice()) {
                bz.commit_member_key(transport_generation, &path, before.as_deref(), Some(&data))?;
            } else if !bz.is_current(transport_generation) {
                return Err(other("服务配置已切换,旧服务的会员密钥结果已丢弃,请重试"));
            }
            return Ok(stamped);
        }
    }

    let key = stamp_ohmyagent_key(monkeycode::mc_ohmyagent_key_create(svc).await?, svc);
    let data = serde_json::to_vec(&key).map_err(|e| other(format!("序列化会员密钥失败: {e}")))?;
    bz.commit_member_key(transport_generation, &path, before.as_deref(), Some(&data))?;
    Ok(key)
}

/// 同步会员内置模型(命令的可测内核:tests.rs 以 TempDir 直调)。
#[cfg(test)]
pub(crate) async fn sync_member_models(svc: &Service, cfg_dir: &std::path::Path) -> BzResult<Value> {
    ensure_ohmyagent_key(svc, cfg_dir).await?;
    monkeycode::mc_member_models_sync(svc).await
}

/// 删成功才移除本地记录;删失败(如断网)保留记录,下次断开重试即收敛。
#[cfg(test)]
pub(crate) async fn revoke_member_models(svc: &Service, cfg_dir: &std::path::Path) -> BzResult<()> {
    let Some(key) = stored_ohmyagent_key(cfg_dir) else {
        return Ok(()); // 从未同步过,无可删
    };
    if !ohmyagent_key_matches_transport(&key, &svc.ep.monkeycode, &svc.mc_llm, svc.mc_basic.as_deref()) {
        return Ok(());
    }
    let id = key.get("id").and_then(Value::as_str).unwrap_or("");
    monkeycode::mc_ohmyagent_key_delete(svc, id).await?;
    let _ = std::fs::remove_file(cfg_dir.join(OHMYAGENT_KEY_FILE));
    Ok(())
}

async fn revoke_member_models_current(
    bz: &BaizhiState,
    svc: &Arc<Service>,
    transport_generation: u64,
    cfg_dir: &std::path::Path,
) -> BzResult<()> {
    let path = cfg_dir.join(OHMYAGENT_KEY_FILE);
    let before = read_optional_file(&path)?;
    let Some(key) = before.as_deref().and_then(parse_ohmyagent_key) else {
        return Ok(());
    };
    if !ohmyagent_key_matches_transport(&key, &svc.ep.monkeycode, &svc.mc_llm, svc.mc_basic.as_deref()) {
        return Ok(());
    }
    let id = key.get("id").and_then(Value::as_str).unwrap_or("");
    monkeycode::mc_ohmyagent_key_delete(svc, id).await?;
    bz.commit_member_key(transport_generation, &path, before.as_deref(), None)
}

/// 同步 MonkeyCode 会员内置模型为本地条目(source="monkeycode")。与
/// baizhi_sync 同款语义:不碰 config.json,纯返回 {models, notes}。
#[tauri::command]
pub async fn mc_models_sync(
    app: tauri::AppHandle,
    bz: State<'_, BaizhiState>,
    expected_generation: Option<u64>,
) -> Result<Value, String> {
    let cfg_dir = crate::config::config_dir(&app)?;
    let _op = bz.member_ops.lock().await;
    let Some((svc, transport_generation)) = bz.service_snapshot_if_current(expected_generation) else {
        return Err("服务配置已切换,本次会员模型同步已取消,请重试".into());
    };
    ensure_ohmyagent_key_current(&bz, &svc, transport_generation, &cfg_dir).await.map_err(BzErr::msg)?;
    let models = monkeycode::mc_member_models_sync(&svc).await.map_err(BzErr::msg)?;
    if !bz.is_current(transport_generation) {
        return Err("服务配置已切换,旧服务的模型结果已丢弃,请重试".into());
    }
    Ok(models)
}

/// 断开 MonkeyCode 账号时调用(从未同步过直接成功)。须在清除 mc 会话
/// 之前调用——请求走 mc 会话认证。
#[tauri::command]
pub async fn mc_models_revoke(
    app: tauri::AppHandle,
    bz: State<'_, BaizhiState>,
    expected_generation: Option<u64>,
) -> Result<Value, String> {
    let cfg_dir = crate::config::config_dir(&app)?;
    let _op = bz.member_ops.lock().await;
    let Some((svc, transport_generation)) = bz.service_snapshot_if_current(expected_generation) else {
        return Err("服务配置已切换,本次会员密钥吊销已取消,请重试".into());
    };
    revoke_member_models_current(&bz, &svc, transport_generation, &cfg_dir).await.map_err(BzErr::msg)?;
    Ok(json!({ "ok": true }))
}

/// 吊销会员 Key + 清会话的一体化断开命令。整个流程捕获同一 transport 代次;
/// 若等待吊销期间切了服务,最后的原子校验会拒绝清掉新服务 Cookie。
#[tauri::command]
pub async fn mc_disconnect(
    app: tauri::AppHandle,
    bz: State<'_, BaizhiState>,
    pipes: State<'_, monkeycode::CloudPipes>,
    expected_generation: u64,
) -> Result<Value, String> {
    let cfg_dir = crate::config::config_dir(&app)?;
    let _op = bz.member_ops.lock().await;
    let Some((svc, transport_generation)) = bz.service_snapshot_if_current(Some(expected_generation)) else {
        return Ok(json!({ "ok": false, "cancelled": true }));
    };
    let warning = revoke_member_models_current(&bz, &svc, transport_generation, &cfg_dir)
        .await
        .err()
        .map(BzErr::msg);
    let current = bz.logout_if_current(transport_generation, &pipes);
    Ok(json!({
        "ok": current,
        "cancelled": !current,
        "warning": warning,
    }))
}

#[tauri::command]
pub async fn mc_tasks(
    bz: State<'_, BaizhiState>,
    page: u32,
    size: u32,
    status: Option<String>,
    project_id: Option<String>,
    quick_start: Option<bool>,
) -> Result<Value, String> {
    let size = size.clamp(1, 50);
    let page = page.max(1);
    monkeycode::mc_tasks(
        &bz.service(),
        page,
        size,
        status.as_deref().unwrap_or(""),
        project_id.as_deref().unwrap_or(""),
        quick_start,
    )
    .await
    .map_err(BzErr::msg)
}

#[tauri::command]
pub async fn mc_projects(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    monkeycode::mc_projects(&bz.service()).await.map_err(BzErr::msg)
}

#[tauri::command]
pub async fn mc_task_info(bz: State<'_, BaizhiState>, id: String) -> Result<Value, String> {
    monkeycode::mc_task_info(&bz.service(), &id).await.map_err(BzErr::msg)
}

#[tauri::command]
pub async fn mc_task_rounds(
    bz: State<'_, BaizhiState>,
    id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let limit = limit.unwrap_or(1).clamp(1, 10);
    monkeycode::mc_task_rounds(&bz.service(), &id, cursor.as_deref().unwrap_or(""), limit)
        .await
        .map_err(BzErr::msg)
}

#[tauri::command]
pub async fn mc_task_user_inputs(
    bz: State<'_, BaizhiState>,
    id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    // 后端上限 100;大纲一次多拿些,减少全量拉取的往返数
    let limit = limit.unwrap_or(100).clamp(1, 100);
    monkeycode::mc_task_user_inputs(&bz.service(), &id, cursor.as_deref().unwrap_or(""), limit)
        .await
        .map_err(BzErr::msg)
}

#[tauri::command]
pub async fn mc_task_stop(bz: State<'_, BaizhiState>, id: String) -> Result<Value, String> {
    monkeycode::mc_task_stop(&bz.service(), &id).await.map_err(BzErr::msg)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn mc_task_delete(bz: State<'_, BaizhiState>, id: String) -> Result<Value, String> {
    monkeycode::mc_task_delete(&bz.service(), &id).await.map_err(BzErr::msg)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn mc_task_create(bz: State<'_, BaizhiState>, req: Value) -> Result<Value, String> {
    monkeycode::mc_task_create(&bz.service(), &req).await.map_err(BzErr::msg)
}

#[tauri::command]
pub async fn mc_task_options(bz: State<'_, BaizhiState>) -> Result<Value, String> {
    monkeycode::mc_task_options(&bz.service()).await.map_err(BzErr::msg)
}

/// 云端聊天附件上传(data = base64 文件字节);返回 {access_url}。
#[tauri::command]
pub async fn mc_upload(bz: State<'_, BaizhiState>, filename: String, data: String) -> Result<Value, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("附件数据解码失败: {e}"))?;
    let access_url = monkeycode::mc_upload(&bz.service(), &filename, bytes).await.map_err(BzErr::msg)?;
    Ok(json!({ "access_url": access_url }))
}

/// 虚拟机终端 session 列表(终端面板复用已有会话用;返回 {terminals})。
#[tauri::command]
pub async fn mc_terminal_list(bz: State<'_, BaizhiState>, vm_id: String) -> Result<Value, String> {
    monkeycode::mc_terminal_list(&bz.service(), &vm_id).await.map_err(BzErr::msg)
}

/// 从云端任务 VM 工作区下载文件/目录到本地(dest 为 UI 经保存对话框
/// 选定的本地路径;目录由服务端打成 zip)。dl_id 由 UI 生成,进度经
/// `dl-progress:{dl_id}` 事件上报,取消走 mc_file_download_cancel。
/// 返回 {ok, bytes}。
#[tauri::command]
pub async fn mc_file_download(
    app: tauri::AppHandle,
    bz: State<'_, BaizhiState>,
    ctl: State<'_, monkeycode::DownloadCtl>,
    dl_id: String,
    vm_id: String,
    path: String,
    filename: String,
    dest: String,
) -> Result<Value, String> {
    let bytes = monkeycode::mc_file_download(&app, &ctl, &bz.service(), &dl_id, &vm_id, &path, &filename, &dest)
        .await
        .map_err(BzErr::msg)?;
    Ok(json!({ "ok": true, "bytes": bytes }))
}

/// 取消进行中的下载(置旗,由下载循环在块间收束并清残件;已完成/不存在
/// 静默——取消与完成天然赛跑)。
#[tauri::command]
pub async fn mc_file_download_cancel(
    ctl: State<'_, monkeycode::DownloadCtl>,
    dl_id: String,
) -> Result<Value, String> {
    ctl.cancel(&dl_id);
    Ok(json!({ "ok": true }))
}

/// 上传文件到云端任务 VM 工作区(path 为 VM 内绝对路径,data = base64 文件字节)。
#[tauri::command]
pub async fn mc_file_upload(
    bz: State<'_, BaizhiState>,
    vm_id: String,
    path: String,
    data: String,
) -> Result<Value, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("文件数据解码失败: {e}"))?;
    monkeycode::mc_file_upload(&bz.service(), &vm_id, &path, bytes).await.map_err(BzErr::msg)?;
    Ok(json!({ "ok": true }))
}
