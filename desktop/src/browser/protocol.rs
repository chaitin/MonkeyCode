// 浏览器桥接协议帧定义。契约对齐 agent/internal/browser/protocol.go。
//
// 架构:扩展是"带鉴权的 chrome.debugger 哑代理 + 标签页授权 UI",一切浏览器
// 语义(快照、ref、坐标点击、键序列)在内核侧实现。
//
// 桥接协议(JSON 文本帧,单连接):
//
//	扩展→内核 首帧  {"event":"hello","auth":{"token"|"code"},"ext":{...},"browser":{...},"proto":1}
//	内核→扩展 应答  {"event":"hello.ok","token":"<配对时新颁发>"}
//	内核→扩展 请求  {"id":N,"op":"cdp|tabs.*|attach|detach|ping","tabId":T,"method":"...","params":{...}}
//	扩展→内核 应答  {"id":N,"result":{...}} | {"id":N,"error":{"code","message"}}
//	扩展→内核 事件  {"event":"cdp|tab.updated|tab.removed|detached|handoff|pong","tabId":T,...}

// 协议面完整保留(与 Go/扩展side 对表),未用到的常量不裁剪。
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// 桥接协议版本(前向兼容判断用)。
pub const PROTO_VERSION: i64 = 1;

// 内核→扩展的请求 op。
pub const OP_CDP: &str = "cdp"; // chrome.debugger.sendCommand 透传
pub const OP_TABS_CREATE: &str = "tabs.create"; // 新建标签页并 attach,自动纳入受控集合
pub const OP_TABS_LIST: &str = "tabs.list"; // 列出全部标签页(含受控标注)
pub const OP_TABS_ACTIVATE: &str = "tabs.activate"; // 激活标签页/前置窗口(截图与真实输入需要)
pub const OP_TABS_CLOSE: &str = "tabs.close"; // 关闭标签页
pub const OP_ATTACH: &str = "attach"; // attach debugger(幂等;仅受控集合内允许)
pub const OP_DETACH: &str = "detach"; // detach debugger
pub const OP_FRAMES_LIST: &str = "frames.list"; // 列出标签页的跨源 iframe(OOPIF)子会话
pub const OP_PING: &str = "ping"; // 保活(兼作 MV3 SW 续命)

// 扩展→内核的事件。
pub const EVENT_HELLO: &str = "hello"; // 连接首帧(鉴权)
pub const EVENT_HELLO_OK: &str = "hello.ok"; // 内核应答(仅此一个下行事件)
pub const EVENT_CDP: &str = "cdp"; // chrome.debugger.onEvent 透传
pub const EVENT_TAB_UPDATED: &str = "tab.updated"; // 受控标签页 URL/标题/加载状态变化
pub const EVENT_TAB_REMOVED: &str = "tab.removed"; // 受控标签页被关闭
pub const EVENT_DETACHED: &str = "detached"; // debugger 被剥离(用户点信息条取消/页面关闭/DevTools)
pub const EVENT_HANDOFF: &str = "handoff"; // 用户在 popup 把当前标签页交给 agent
pub const EVENT_PONG: &str = "pong"; // ping 应答

// 扩展侧错误码。
pub const ERR_CODE_DETACHED: &str = "detached"; // debugger 未附加/已被剥离
pub const ERR_CODE_NO_TAB: &str = "no_tab"; // 标签页不存在
pub const ERR_CODE_RESTRICTED_URL: &str = "restricted_url"; // chrome:// 等受限页面
pub const ERR_CODE_NOT_CONTROLLED: &str = "not_controlled"; // 标签页不在受控集合
pub const ERR_CODE_CDP: &str = "cdp_error"; // CDP 命令执行失败
pub const ERR_CODE_DEBUGGER_CONFLICT: &str = "debugger_conflict"; // 已有其他调试器(如 DevTools)

/// detached 错误的稳定机器标记:bridge.call 对 ERR_CODE_DETACHED 的错误串
/// 前置此标记,session 层据此判定是否自动重 attach。为何不匹配文案:to_msg
/// 的中文文案是产品措辞,改一个字就会静默破坏错误分类;标记是进程内契约,
/// 与文案解耦。给模型的最终文本(MCP isError)拼装前由 strip_err_marks 剥除。
pub const ERR_MARK_DETACHED: &str = "[ERR_DETACHED]";

/// 剥除内部错误标记(错误文本抵达最终出口前调用;模型不应看到内部标记)。
pub fn strip_err_marks(e: String) -> String {
    if e.contains(ERR_MARK_DETACHED) {
        e.replace(ERR_MARK_DETACHED, "")
    } else {
        e
    }
}

/// serde skip_serializing_if 辅助:bool 的 omitempty 语义(false 即省略)。
fn is_false(b: &bool) -> bool {
    !*b
}

/// 内核→扩展请求帧。字段省略语义与 Go json tag omitempty 对齐。
#[derive(Serialize, Clone, Debug, Default)]
pub struct Request {
    pub id: i64,
    pub op: String,
    #[serde(rename = "tabId", skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<i64>,
    /// op=cdp 时的 CDP 方法名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    /// 非空时命令路由到跨源 iframe(OOPIF)的 flat 子会话
    /// (chrome.debugger flat session,Chrome 125+);空 = 标签页根会话。
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// 扩展→内核入站帧(应答或事件,按字段区分)。
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Message {
    // 应答字段(id 有值且 >0)
    pub id: Option<i64>,
    pub result: Option<serde_json::Value>,
    pub error: Option<RespError>,

    // 事件字段
    pub event: String,
    #[serde(rename = "tabId")]
    pub tab_id: Option<i64>,
    /// event=cdp 且来自 OOPIF 子会话时。
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// event=cdp 时的 CDP 事件名。
    pub method: String,
    /// event=cdp 时的事件载荷。
    pub params: Option<serde_json::Value>,
    /// tab.updated / handoff。
    pub info: Option<TabInfo>,
    /// detached。
    pub reason: String,

    // hello 字段
    pub auth: Option<HelloAuth>,
    pub ext: Option<ExtInfo>,
    pub browser: Option<BrowserInfo>,
    pub proto: Option<i64>,
}

/// 扩展侧执行错误。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct RespError {
    pub code: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
}

impl RespError {
    /// 转为内核侧错误(给模型的文案,按错误码翻译成可行动的提示)。
    /// 文案是产品契约,逐字对齐 Go 的 Error() 方法。
    pub fn to_msg(&self) -> String {
        match self.code.as_str() {
            ERR_CODE_DETACHED => {
                "浏览器调试连接已断开(用户可能点了「取消」提示条),请用 browser_tabs 重新选择或新建标签页".to_string()
            }
            ERR_CODE_NO_TAB => {
                "标签页不存在(可能已被关闭),请用 browser_tabs 查看当前标签页".to_string()
            }
            ERR_CODE_RESTRICTED_URL => {
                "该页面受浏览器保护(chrome:// 等内部页面),无法操作".to_string()
            }
            ERR_CODE_NOT_CONTROLLED => {
                "该标签页未交给 agent 控制;请引导用户点击浏览器工具栏的 MonkeyCode 扩展图标,选择「交给 agent 操作」".to_string()
            }
            ERR_CODE_DEBUGGER_CONFLICT => {
                "该标签页已被其他调试器占用(如已打开开发者工具),请引导用户关闭该页的 DevTools 后重试".to_string()
            }
            _ => {
                if !self.message.is_empty() {
                    format!("浏览器操作失败({}): {}", self.code, self.message)
                } else {
                    format!("浏览器操作失败({})", self.code)
                }
            }
        }
    }
}

/// 连接鉴权:长期 token(已配对)或一次性配对码(首次配对)。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct HelloAuth {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub token: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub code: String,
}

/// 扩展自述。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct ExtInfo {
    pub id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub version: String,
}

/// 浏览器自述(状态页展示)。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct BrowserInfo {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub version: String,
}

/// 标签页元数据(tabs.list 结果项 / tab.updated / handoff 载荷)。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct TabInfo {
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub url: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub title: String,
    #[serde(skip_serializing_if = "is_false")]
    pub active: bool,
    /// 在受控集合内。
    #[serde(skip_serializing_if = "is_false")]
    pub controlled: bool,
    /// loading | complete。
    #[serde(skip_serializing_if = "String::is_empty")]
    pub status: String,
}

/// 一个跨源 iframe(OOPIF)子会话(frames.list 结果项)。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct FrameInfo {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub url: String,
}

/// 内核对 hello 的应答帧:{"event":"hello.ok","token":<配对时新颁发,空则省略>,"proto":1}。
pub fn hello_ok(token: &str) -> serde_json::Value {
    let mut v = serde_json::json!({ "event": EVENT_HELLO_OK, "proto": PROTO_VERSION });
    if !token.is_empty() {
        v["token"] = serde_json::Value::String(token.to_string());
    }
    v
}
