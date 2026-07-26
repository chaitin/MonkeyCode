// 浏览器扩展桥:独立 loopback WS 监听,管理与浏览器扩展的唯一连接、配对与鉴权。
// 契约逐字对齐 agent/internal/browser/bridge.go(546 行版本);行为断言见
// agent/internal/browser/bridge_test.go。
//
// 桥只负责进程级连接、全局受控标签页集合和唯一事件出口。其后的
// BrowserSessions 维护 tabId→owner 并把事件路由到独立会话；这样无需让扩展
// 协议感知 Agent 身份，也能让不同任务并行而不共享 current tab/ref 现场。
// 其余语义(端口顺延、hello 3s 首帧、constant-time 鉴权、配对码作废时机、
// 新连顶旧连、ping 保活、断连唤醒在途等待者、状态字段、repair)照 Go 原样。
//
// 并发不变式:
//   - 一条连接 = 一个 ConnHandle(writer 任务独占 sink,串行写;reader 任务
//     独占 stream)。epoch 单调递增,作连接身份(替代 Go 的指针比较)。
//   - close_handle 幂等(closed 标志 CAS):先置 closed,再排空 pending(oneshot
//     sender 落栈即唤醒 call() 等待端),最后 notify 关闭信号让 writer 退出
//     (信号走 Notify 不占出站队列,队满时也关得掉);writer 退出使 rx 落栈,
//     tx.closed() 随之唤醒 reader/ping 任务——全链路无悬挂。
//   - 出站队列有界(OUT_QUEUE_CAP),入队一律 try_send 不阻塞:队满 = writer
//     长时间写不动(扩展端 TCP 停滞),视为连接不健康即刻 drop_conn——任何
//     入队点都不会在持锁或事件回调里阻塞,内存也不无界积压。
//   - call() 先挂 pending 再查 closed:与 close_handle「先置 closed 再排空」
//     构成完备配对,任一交错下等待者都能被唤醒,不丢事件。
//   - st(StdMutex)只保护短临界区,绝不跨 await 持锁。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::handshake::server::{
    ErrorResponse as HsErrorResponse, Request as HsRequest, Response as HsResponse,
};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::WebSocketStream;

use super::protocol::*;
use crate::util::LockExt;

/// 连接后首帧(hello)必须在此时限内到达。
const HELLO_TIMEOUT: Duration = Duration::from_secs(3);
/// 内核→扩展保活间隔(兼作 MV3 SW 续命)。
const PING_INTERVAL: Duration = Duration::from_secs(20);
/// 默认端口被占时向上顺延尝试的范围。
const PORT_SCAN_RANGE: u32 = 10;
/// 读上限:整页截图 base64 可达数十 MB。
const MAX_FRAME: usize = 64 * 1024 * 1024;
/// 出站帧队列上限。为何有界:单帧可达数十 MB(截图),扩展端 TCP 停滞而
/// 内核连环发帧时,无界队列等于内存无上限。正常在途量(工具串行 + ping)
/// 远小于 64,积压到此必是连接不健康,try_send 满即断(见 call/ping_loop)。
const OUT_QUEUE_CAP: usize = 64;

/// 扩展桥。进程级单例,Clone 即共享同一 Inner。
#[derive(Clone)]
pub struct ExtBridge(Arc<Inner>);

struct Inner {
    /// 配置的首选端口(默认 7440;被占时向上顺延 PORT_SCAN_RANGE 个)。
    pref_port: u16,
    /// ext-auth.json 路径(app_config_dir 下)。
    auth_path: PathBuf,
    /// call() 请求号发号器(从 1 起;0 保留给 ping 等不占号帧)。
    req_id: AtomicI64,
    st: StdMutex<BridgeState>,
    /// 进程级受控标签页集合；owner 维度由 BrowserSessions 维护。
    tabs: StdMutex<HashSet<i64>>,
    /// 用户交付(handoff)的标签页待领队列(FIFO)。
    handoffs: StdMutex<Vec<TabInfo>>,
    /// 唯一事件出口；生产中注册 BrowserSessions 的 owner 路由器。
    handler: StdMutex<Option<Arc<dyn Fn(Message) + Send + Sync>>>,
    /// 配对状态变化回调。桌面壳据此重写 mcp.json 并重启 Agent；
    /// 只在 false→true / true→false 时触发，普通断线重连不触发。
    pairing_handler: StdMutex<Option<Arc<dyn Fn(bool) + Send + Sync>>>,
}

/// 受 st 锁保护的可变状态(对应 Go ExtBridge 里 mu 保护的字段)。
#[derive(Default)]
struct BridgeState {
    /// 长期 ext token(已配对时非空)。
    token: String,
    /// 配对时记录的扩展 ID(token 重连时纵深防御校验)。
    ext_id: String,
    /// 一次性配对码(本次启动有效,token 连入确认后作废)。
    pairing_code: String,
    /// 实际监听地址(启动成功后非空)。
    listen_addr: String,
    /// 监听失败原因(状态页外显)。
    listen_err: String,
    /// hello 携带的浏览器自述(状态页展示)。
    browser: BrowserInfo,
    conn: Option<ConnHandle>,
}

/// 一条扩展 WS 连接的句柄(Clone 即共享)。
#[derive(Clone)]
struct ConnHandle {
    /// 出站帧队列:writer 任务独占消费,天然串行写(对应 Go 的 writeMu)。
    /// 有界(OUT_QUEUE_CAP),入队一律 try_send:满即判连接不健康走 drop_conn。
    tx: mpsc::Sender<String>,
    /// 关闭信号(close_handle → writer 退出)。不复用 tx 发哨兵帧:队满时
    /// 哨兵挤不进有界队列,连接会关不掉;Notify 在 writer 尚未 await 时
    /// notify_one 也会存下 permit,信号不丢。
    close: Arc<tokio::sync::Notify>,
    /// 在途请求表:id → 应答投递口。
    pending: Arc<StdMutex<HashMap<i64, oneshot::Sender<Message>>>>,
    /// 连接已关闭(幂等标志,对应 Go 的 closeOnce+closed 通道)。
    closed: Arc<AtomicBool>,
    /// 连接代次(单调递增),drop_conn 用它做身份比较(替代 Go 指针相等)。
    epoch: u64,
}

/// ext-auth.json 落盘结构(json tag 对齐 Go extAuth)。
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct ExtAuthFile {
    token: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    ext_id: String,
}

impl ExtBridge {
    /// 创建扩展桥:读 ext-auth.json 恢复长期 token,生成本次启动的配对码。
    /// 监听地址固定 127.0.0.1(Go 版校验 loopback,这里直接写死,不给配错机会)。
    pub fn new(pref_port: u16, data_dir: &Path) -> Self {
        let auth_path = data_dir.join("ext-auth.json");
        let mut st = BridgeState::default();
        if let Ok(data) = std::fs::read(&auth_path) {
            if let Ok(a) = serde_json::from_slice::<ExtAuthFile>(&data) {
                if !a.token.is_empty() {
                    st.token = a.token;
                    st.ext_id = a.ext_id;
                }
            }
        }
        st.pairing_code = new_pairing_code();
        ExtBridge(Arc::new(Inner {
            pref_port,
            auth_path,
            req_id: AtomicI64::new(0),
            st: StdMutex::new(st),
            tabs: StdMutex::new(HashSet::new()),
            handoffs: StdMutex::new(Vec::new()),
            handler: StdMutex::new(None),
            pairing_handler: StdMutex::new(None),
        }))
    }

    /// 是否已持有扩展的长期配对凭据。浏览器是否正在运行是瞬时连接状态，
    /// 不能作为 MCP 工具是否安装到 Agent 的条件。
    pub fn is_paired(&self) -> bool {
        !self.0.st.lock_ok().token.is_empty()
    }

    /// 注册配对状态变化回调。仅桌面壳生命周期层消费；桥本身不负责重启 Agent。
    pub fn set_pairing_change_handler(&self, f: Arc<dyn Fn(bool) + Send + Sync>) {
        *self.0.pairing_handler.lock_ok() = Some(f);
    }

    fn notify_pairing_changed(&self, paired: bool) {
        let handler = self.0.pairing_handler.lock_ok().clone();
        if let Some(handler) = handler {
            handler(paired);
        }
    }

    /// 启动监听(后台任务)。端口全占时只记录 listen_err(状态页外显),
    /// 不 panic 不返回错误——浏览器能力降级不可用,不拖垮宿主。
    pub fn spawn(&self) {
        let b = self.clone();
        tauri::async_runtime::spawn(async move { run_listener(b).await });
    }

    /// 发送请求并等待应答(超时/断连即错)。req.id 由本方法发号,调用方置 0 即可。
    pub async fn call(&self, mut req: Request, timeout: Duration) -> Result<serde_json::Value, String> {
        let c = { self.0.st.lock_ok().conn.clone() };
        let Some(c) = c else {
            return Err("浏览器扩展未连接;请确认已在浏览器中安装 MonkeyCode 扩展并完成配对(设置页可查看状态)".to_string());
        };
        req.id = self.0.req_id.fetch_add(1, Ordering::Relaxed) + 1;
        let id = req.id;
        let (otx, orx) = oneshot::channel::<Message>();
        // 不变式:先挂 pending 再查 closed。close_handle 先置 closed 再排空
        // pending——两侧任一交错,本次等待都能收到断连唤醒或被本地清理。
        c.pending.lock_ok().insert(id, otx);
        let sent = if c.closed.load(Ordering::SeqCst) {
            false
        } else {
            match serde_json::to_string(&req) {
                // try_send 不阻塞:队满 = writer 长时间写不动(扩展端停滞),
                // 连接已不健康,复用既有关闭路径断开止损(唤醒全部在途等待者)
                Ok(data) => match c.tx.try_send(data) {
                    Ok(()) => true,
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        self.drop_conn(Some(&c));
                        c.pending.lock_ok().remove(&id);
                        return Err("发送浏览器指令失败: 出站队列积压(连接不健康),已断开".to_string());
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => false,
                },
                Err(e) => {
                    c.pending.lock_ok().remove(&id);
                    return Err(format!("发送浏览器指令失败: {e}"));
                }
            }
        };
        if !sent {
            c.pending.lock_ok().remove(&id);
            return Err("发送浏览器指令失败: 连接已关闭".to_string());
        }
        let res = tokio::time::timeout(timeout, orx).await;
        c.pending.lock_ok().remove(&id);
        match res {
            // 超时(对应 Go ctx.Err())
            Err(_) => Err(format!("等待浏览器扩展应答超时({}s)", timeout.as_secs())),
            // sender 落栈 = 连接被关闭排空(对应 Go 的 <-c.closed 分支)
            Ok(Err(_)) => Err("浏览器扩展连接已断开,请稍后重试".to_string()),
            Ok(Ok(msg)) => match msg.error {
                // detached 按错误码前置稳定标记:session 层据标记(而非人读
                // 文案)判定自动重 attach,文案改动不再静默破坏错误分类
                Some(e) if e.code == ERR_CODE_DETACHED => {
                    Err(format!("{ERR_MARK_DETACHED}{}", e.to_msg()))
                }
                Some(e) => Err(e.to_msg()),
                None => Ok(msg.result.unwrap_or(serde_json::Value::Null)),
            },
        }
    }

    /// 设置进程级事件出口。生产中只注册一次 BrowserSessions 路由器；二次
    /// 注册意味着旧路由器被静默顶掉失聪，是编码错误。
    pub fn set_event_handler(&self, f: Arc<dyn Fn(Message) + Send + Sync>) {
        // 下划线前缀:release 构建 debug_assert 不求值,避免未用变量警告
        let _prev = self.0.handler.lock_ok().replace(f);
        debug_assert!(_prev.is_none(), "ExtBridge 事件路由器重复注册");
    }

    /// 声明标签页受控(新建/认领交付时调用;幂等)。
    pub fn claim_tab(&self, tab_id: i64) {
        self.0.tabs.lock_ok().insert(tab_id);
    }

    /// 释放标签页(关闭/用户收回时调用)。
    pub fn release_tab(&self, tab_id: i64) {
        self.0.tabs.lock_ok().remove(&tab_id);
    }

    /// 标签页是否在受控集合内。
    #[allow(dead_code)] // 契约 API 保留(Go 同样未消费)
    pub fn owns_tab(&self, tab_id: i64) -> bool {
        self.0.tabs.lock_ok().contains(&tab_id)
    }

    /// 认领一个用户交付的标签页(队首;无则 None)。
    pub fn take_pending_handoff(&self) -> Option<TabInfo> {
        let mut q = self.0.handoffs.lock_ok();
        if q.is_empty() {
            None
        } else {
            Some(q.remove(0))
        }
    }

    /// 桥接状态快照(设置页外显)。字段名/省略语义逐字对齐 Go Status 的
    /// json tag:enabled、addr(omitempty)、error(omitempty)、paired、
    /// connected、browser_name/browser_version(仅 connected)、
    /// pairing_code(仅未配对)。
    pub fn status(&self) -> serde_json::Value {
        let st = self.0.st.lock_ok();
        let mut m = serde_json::Map::new();
        m.insert("enabled".into(), (!st.listen_addr.is_empty()).into());
        if !st.listen_addr.is_empty() {
            m.insert("addr".into(), st.listen_addr.clone().into());
        }
        if !st.listen_err.is_empty() {
            m.insert("error".into(), st.listen_err.clone().into());
        }
        let paired = !st.token.is_empty();
        m.insert("paired".into(), paired.into());
        let connected = st.conn.is_some();
        m.insert("connected".into(), connected.into());
        if connected {
            if !st.browser.name.is_empty() {
                m.insert("browser_name".into(), st.browser.name.clone().into());
            }
            if !st.browser.version.is_empty() {
                m.insert("browser_version".into(), st.browser.version.clone().into());
            }
        }
        if !paired && !st.pairing_code.is_empty() {
            m.insert("pairing_code".into(), st.pairing_code.clone().into());
        }
        serde_json::Value::Object(m)
    }

    /// 重置配对:删除长期 token 与落盘凭据,断开现有连接,生成新配对码。
    pub fn repair(&self) -> serde_json::Value {
        let (old, was_paired) = {
            let mut st = self.0.st.lock_ok();
            let was_paired = !st.token.is_empty();
            st.token.clear();
            st.ext_id.clear();
            st.pairing_code = new_pairing_code();
            let _ = std::fs::remove_file(&self.0.auth_path);
            (st.conn.take(), was_paired)
        };
        // 受控 tab 与待领 handoff 随旧浏览器一并失效:重置配对多半是换浏览器/
        // 换扩展,新浏览器的 tabId 会与旧号撞号,不清空会把新事件错误路由
        // (handle_event 按 tabs 集合放行)、把旧 handoff 交给新会话
        self.0.tabs.lock_ok().clear();
        self.0.handoffs.lock_ok().clear();
        if let Some(c) = old {
            close_handle(&c);
        }
        if was_paired {
            self.notify_pairing_changed(false);
        }
        self.status()
    }

    /// 校验 hello 鉴权。配对码路径成功时颁发并落盘长期 token,返回新 token
    /// (扩展需存储);token 路径返回空串。语义逐字对齐 Go authorize()。
    fn authorize(&self, hello: &Message) -> Result<String, String> {
        let mut st = self.0.st.lock_ok();
        let ext_id = hello.ext.as_ref().map(|e| e.id.clone()).unwrap_or_default();
        let Some(auth) = hello.auth.as_ref() else {
            return Err("unauthorized".to_string());
        };
        if !auth.token.is_empty() && !st.token.is_empty() {
            if !ct_eq(auth.token.as_bytes(), st.token.as_bytes()) {
                return Err("unauthorized".to_string());
            }
            // 配对时记录过扩展 ID 则要求一致(纵深防御)
            if !st.ext_id.is_empty() && !ext_id.is_empty() && ext_id != st.ext_id {
                return Err("extension mismatch".to_string());
            }
            // 扩展以 token 连入 = 已确认持久化配对凭据,配对码此刻才作废。
            // (若在颁发 token 时就作废:连接在扩展落库前夭折会吞掉配对码,
            // 扩展带着旧码重试永远失败,用户只能重新配对)
            st.pairing_code.clear();
            return Ok(String::new());
        }
        if !auth.code.is_empty()
            && !st.pairing_code.is_empty()
            && ct_eq(normalize_code(&auth.code).as_bytes(), st.pairing_code.as_bytes())
        {
            let mut raw = [0u8; 16];
            if getrandom::getrandom(&mut raw).is_err() {
                return Err("internal error".to_string());
            }
            let token = hex_encode(&raw);
            let file = ExtAuthFile { token: token.clone(), ext_id: ext_id.clone() };
            let data = serde_json::to_vec(&file).map_err(|_| "persist failed".to_string())?;
            if write_file_0600(&self.0.auth_path, &data).is_err() {
                return Err("persist failed".to_string());
            }
            let became_paired = st.token.is_empty();
            st.token = token.clone();
            st.ext_id = ext_id;
            drop(st);
            if became_paired {
                self.notify_pairing_changed(true);
            }
            return Ok(token);
        }
        Err("unauthorized".to_string())
    }

    /// 扩展事件分发：handoff 进待领队列；其余带 tabId 的事件先按进程级
    /// 受控集合过滤，再交给 BrowserSessions 做 tab owner 路由。
    fn handle_event(&self, msg: Message) {
        match msg.event.as_str() {
            EVENT_PONG | "" => {}
            EVENT_HANDOFF => {
                if let Some(info) = msg.info.clone() {
                    self.0.handoffs.lock_ok().push(info);
                }
            }
            _ => {
                let tab = msg.tab_id.unwrap_or(0);
                if self.0.tabs.lock_ok().contains(&tab) {
                    let h = self.0.handler.lock_ok().clone();
                    if let Some(h) = h {
                        h(msg);
                    }
                }
            }
        }
    }

    /// 关闭并清理连接。c 为 None 时清理当前连接;Some 时仅当仍是当前连接才
    /// 从状态摘除(epoch 比较),但无论如何都关闭 c 本身(对齐 Go dropConn)。
    fn drop_conn(&self, c: Option<&ConnHandle>) {
        let target = {
            let mut st = self.0.st.lock_ok();
            match c {
                None => st.conn.take(),
                Some(h) => {
                    if st.conn.as_ref().map(|cur| cur.epoch) == Some(h.epoch) {
                        st.conn.take()
                    } else {
                        Some(h.clone())
                    }
                }
            }
        };
        if let Some(t) = target {
            close_handle(&t);
        }
    }
}

/// 关闭连接(幂等):唤醒全部在途等待者,并让 writer/reader/ping 任务退出。
fn close_handle(c: &ConnHandle) {
    if c.closed.swap(true, Ordering::SeqCst) {
        return;
    }
    // 排空在途请求:oneshot sender 落栈 → call() 端收到「连接已断开」
    c.pending.lock_ok().clear();
    // 关闭信号:writer 发 WS Close 帧后退出;rx 落栈使 tx.closed() 就绪,
    // reader/ping 的 select 分支随之唤醒——不依赖对端配合。走 Notify 而非
    // 队列哨兵:有界队列满时哨兵会挤不进去,连接关不掉
    c.close.notify_one();
}

/// 生成 8 位配对码(剔除易混字符的 base32 字母表,与 Go 完全一致)。
///
/// 随机源失败时返回**空串**,而不是把全零缓冲映射成 `AAAAAAAA`——配对码是
/// 授予"驱动用户浏览器"能力的唯一凭据,可猜等于没有。空串是 fail-closed 的:
/// `authorize()` 要求 `!st.pairing_code.is_empty()` 才受理配对码,`status()`
/// 也只在非空时下发,所以拿不到熵就是"这次启动不提供配对",不是"人人可配对"。
/// (同一纪律见 mcp.rs::new_token 与 authorize() 里颁发长期 token 的分支。)
fn new_pairing_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTVWXYZ23456789";
    let mut raw = [0u8; 8];
    if let Err(e) = getrandom::getrandom(&mut raw) {
        eprintln!("[desktop] 系统随机源不可用,本次不生成浏览器配对码: {e}");
        return String::new();
    }
    raw.iter().map(|&c| ALPHABET[c as usize % ALPHABET.len()] as char).collect()
}

#[cfg(test)]
mod pairing_code_tests {
    use super::*;

    fn bridge(tag: &str) -> ExtBridge {
        let dir = std::env::temp_dir()
            .join(format!("mc-bridge-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        ExtBridge::new(7440, &dir)
    }

    /// 正常路径:8 位、全部落在剔除易混字符的字母表内、且每次不同。
    #[test]
    fn generated_code_is_eight_chars_from_the_unambiguous_alphabet() {
        const ALPHABET: &str = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
        let a = new_pairing_code();
        assert_eq!(a.chars().count(), 8, "配对码长度变了: {a:?}");
        assert!(a.chars().all(|c| ALPHABET.contains(c)), "混入易混字符: {a:?}");
        assert_ne!(a, new_pairing_code(), "两次生成相同,随机源没起作用");
    }

    /// fail-closed 契约:配对码为空(随机源失败时 new_pairing_code 的返回值)
    /// 必须让**所有**配对尝试落空,而不是变成"空码即可配对"。
    /// 这条是 new_pairing_code 敢于在拿不到熵时返回空串的前提。
    #[test]
    fn an_empty_pairing_code_authorizes_nobody() {
        let b = bridge("empty-code");
        b.0.st.lock_ok().pairing_code.clear();
        assert!(b.0.st.lock_ok().token.is_empty(), "前置条件:尚未配对");

        let hello = |code: &str| Message {
            event: EVENT_HELLO.to_string(),
            auth: Some(HelloAuth { token: String::new(), code: code.to_string() }),
            ..Default::default()
        };
        // 空码、任意猜测、以及全零缓冲会映射出的那个码,一个都不能过
        for attempt in ["", "AAAAAAAA", "ABCDEFGH", "-"] {
            assert!(
                b.authorize(&hello(attempt)).is_err(),
                "配对码为空时 {attempt:?} 不该被受理",
            );
        }
        // 也不该因为这些尝试而反手颁发长期 token
        assert!(b.0.st.lock_ok().token.is_empty(), "失败的配对尝试不得留下 token");
    }
}

/// 配对码归一:去连字符/空格,大写(按字节处理,对齐 Go normalizeCode)。
fn normalize_code(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    for &c in s.as_bytes() {
        if c == b'-' || c == b' ' {
            continue;
        }
        let c = if c.is_ascii_lowercase() { c - (b'a' - b'A') } else { c };
        out.push(c);
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// constant-time 字节比较:逐字节 XOR 累积,不提前返回(对齐 Go
/// subtle.ConstantTimeCompare;长度不等直接 false,与 Go 相同)。
/// pub(crate):mcp.rs 的 Bearer 校验复用同一实现,避免各写一份。
pub(crate) fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

fn hex_encode(raw: &[u8]) -> String {
    raw.iter().map(|b| format!("{b:02x}")).collect()
}

/// 落盘凭据:目录 0700、文件 0600(unix;其他平台退化为默认权限)。
fn write_file_0600(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
        }
        #[cfg(not(unix))]
        std::fs::create_dir_all(dir)?;
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        f.write_all(data)
    }
    #[cfg(not(unix))]
    std::fs::write(path, data)
}

/// 桥接线路日志(MC_BRIDGE_DEBUG 非空时输出,排查扩展联调问题用)。
/// 时间戳为 UTC 时分秒(Go 版是本地时间;仅调试输出,不引入时区依赖)。
fn debugf(args: std::fmt::Arguments<'_>) {
    if std::env::var("MC_BRIDGE_DEBUG").unwrap_or_default().is_empty() {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() % 86400;
    eprintln!(
        "[bridge {:02}:{:02}:{:02}.{:03}] {}",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60,
        now.subsec_millis(),
        args
    );
}

/// 截断到 n 字节(调试输出用;截在 UTF-8 边界中间时 lossy 显示)。
fn truncate_str(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        format!("{}...", String::from_utf8_lossy(&s.as_bytes()[..n]))
    }
}

fn spawn_task<F>(f: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    tauri::async_runtime::spawn(f);
}

// ==================== 监听与连接任务 ====================

/// 监听主循环:仅绑 127.0.0.1,从 pref_port 起向上顺延 PORT_SCAN_RANGE 个
/// 端口;全占则记录 listen_err 后返回(对齐 Go ListenAndServe 的降级语义)。
async fn run_listener(bridge: ExtBridge) {
    let pref = bridge.0.pref_port;
    let mut listener = None;
    let mut last_err = String::new();
    for i in 0..PORT_SCAN_RANGE {
        let port = pref as u32 + i;
        if port > u16::MAX as u32 {
            break;
        }
        match TcpListener::bind(("127.0.0.1", port as u16)).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    let l = match listener {
        Some(l) => l,
        None => {
            bridge.0.st.lock_ok().listen_err = format!(
                "扩展桥监听失败(端口 {} 起 {} 个均被占用): {}",
                pref, PORT_SCAN_RANGE, last_err
            );
            return;
        }
    };
    if let Ok(addr) = l.local_addr() {
        bridge.0.st.lock_ok().listen_addr = addr.to_string();
    }
    loop {
        match l.accept().await {
            Ok((stream, _)) => {
                let b = bridge.clone();
                spawn_task(serve_conn(b, stream));
            }
            // accept 瞬时错误(fd 耗尽等):退避后继续,监听不塌
            Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
}

type WsSink = SplitSink<WebSocketStream<TcpStream>, WsMessage>;
type WsSource = SplitStream<WebSocketStream<TcpStream>>;

/// 单连接接入流程:HTTP upgrade(路径必须 /ext)→ 3s 内 hello 鉴权 →
/// hello.ok → 顶替旧连接 → ping 保活 + 读循环。对齐 Go handleExt。
async fn serve_conn(bridge: ExtBridge, stream: TcpStream) {
    // 跳过 Origin 校验:扩展 SW 的 Origin 是 chrome-extension://<id>,必然
    // 非同源。信任根是 token/配对码(+ authorize 里的扩展 ID 绑定),Origin
    // 对本机进程本就可伪造,不作为安全边界。
    let cfg = WebSocketConfig {
        max_message_size: Some(MAX_FRAME),
        max_frame_size: Some(MAX_FRAME),
        ..Default::default()
    };
    let cb = |req: &HsRequest, resp: HsResponse| -> Result<HsResponse, HsErrorResponse> {
        if req.uri().path() != "/ext" {
            let mut r = HsErrorResponse::new(Some("not found".to_string()));
            *r.status_mut() = StatusCode::NOT_FOUND;
            return Err(r);
        }
        Ok(resp)
    };
    let ws = match tokio_tungstenite::accept_hdr_async_with_config(stream, cb, Some(cfg)).await {
        Ok(ws) => ws,
        Err(_) => return,
    };
    let (mut sink, mut source) = ws.split();

    // hello 首帧:3s 时限(对齐 Go helloTimeout)
    let first = tokio::time::timeout(HELLO_TIMEOUT, next_text(&mut source)).await;
    let data = match first {
        Ok(Some(d)) => d,
        _ => {
            close_policy(&mut sink, "hello timeout").await;
            return;
        }
    };
    let hello: Message = match serde_json::from_str(&data) {
        Ok(m) => m,
        Err(_) => {
            close_policy(&mut sink, "bad hello").await;
            return;
        }
    };
    if hello.event != EVENT_HELLO || hello.auth.is_none() {
        close_policy(&mut sink, "bad hello").await;
        return;
    }

    let issued = match bridge.authorize(&hello) {
        Ok(t) => t,
        Err(e) => {
            close_policy(&mut sink, &e).await;
            return;
        }
    };

    // 连接代次发号器(进程级单调)
    static CONN_EPOCH: AtomicU64 = AtomicU64::new(1);
    let (tx, rx) = mpsc::channel::<String>(OUT_QUEUE_CAP);
    let c = ConnHandle {
        tx,
        close: Arc::new(tokio::sync::Notify::new()),
        pending: Arc::new(StdMutex::new(HashMap::new())),
        closed: Arc::new(AtomicBool::new(false)),
        epoch: CONN_EPOCH.fetch_add(1, Ordering::Relaxed),
    };
    spawn_task(writer_task(sink, rx, bridge.clone(), c.clone()));

    // hello.ok 先于任何后续请求写出(writer 串行保证顺序;队列刚建必有余量,
    // try_send 只可能因 closed 失败)
    let ok = match serde_json::to_string(&hello_ok(&issued)) {
        Ok(s) => s,
        Err(_) => return,
    };
    if c.tx.try_send(ok).is_err() {
        return;
    }

    // 新连接顶替旧连接(处理浏览器重启后的僵尸连接);旧连 close 唤醒其
    // 全部在途等待者
    let old = {
        let mut st = bridge.0.st.lock_ok();
        if let Some(b) = &hello.browser {
            st.browser = b.clone();
        }
        st.conn.replace(c.clone())
    };
    if let Some(old) = old {
        close_handle(&old);
    }

    spawn_task(ping_loop(bridge.clone(), c.clone()));
    read_loop(bridge, c, source).await; // 阻塞至连接断开
}

/// 取下一条数据帧文本(跳过 Ping/Pong 等控制帧;Close/出错返回 None)。
async fn next_text(source: &mut WsSource) -> Option<String> {
    while let Some(item) = source.next().await {
        match item {
            Ok(WsMessage::Text(s)) => return Some(s),
            Ok(WsMessage::Binary(b)) => return Some(String::from_utf8_lossy(&b).into_owned()),
            Ok(WsMessage::Close(_)) | Err(_) => return None,
            Ok(_) => continue,
        }
    }
    None
}

/// 以 1008(policy violation)关闭握手失败的连接(对齐 Go 的 ws.Close 语义)。
async fn close_policy(sink: &mut WsSink, reason: &str) {
    let frame = CloseFrame {
        code: CloseCode::Policy,
        reason: reason.to_string().into(),
    };
    let _ = sink.send(WsMessage::Close(Some(frame))).await;
    let _ = sink.close().await;
}

/// 写任务:独占 sink 串行写出(对应 Go 的 writeMu)。close 信号 = 关闭连接。
/// 写失败即 drop_conn(reader 随之被 tx.closed() 唤醒)。
async fn writer_task(
    mut sink: WsSink,
    mut rx: mpsc::Receiver<String>,
    bridge: ExtBridge,
    c: ConnHandle,
) {
    loop {
        let s = tokio::select! {
            // 关闭信号(不占出站队列):发 Close 帧后退出;rx 落栈唤醒
            // reader/ping。排队中的帧直接丢弃——连接已判死,写出无意义
            _ = c.close.notified() => {
                let _ = sink.send(WsMessage::Close(None)).await;
                let _ = sink.close().await;
                return;
            }
            item = rx.recv() => match item {
                Some(s) => s,
                None => return,
            },
        };
        debugf(format_args!("→ {}", truncate_str(&s, 200)));
        if sink.send(WsMessage::Text(s)).await.is_err() {
            bridge.drop_conn(Some(&c));
            return;
        }
    }
}

/// 读循环:id>0 的帧经 pending 表派发给等待者,其余走事件分发。
/// 退出时 drop_conn(对齐 Go readLoop 的 defer)。
async fn read_loop(bridge: ExtBridge, c: ConnHandle, mut source: WsSource) {
    loop {
        let item = tokio::select! {
            // writer 退出(关闭哨兵/写失败)→ rx 落栈 → 立即结束读循环,
            // 不等对端配合(对齐 Go ws.Close 强制唤醒阻塞读)
            _ = c.tx.closed() => break,
            item = source.next() => item,
        };
        let msg = match item {
            Some(Ok(m)) => m,
            Some(Err(e)) => {
                debugf(format_args!("readLoop 结束: {e}"));
                break;
            }
            None => break,
        };
        let data = match msg {
            WsMessage::Text(s) => s,
            WsMessage::Binary(b) => String::from_utf8_lossy(&b).into_owned(),
            WsMessage::Close(_) => break,
            _ => continue,
        };
        debugf(format_args!("← {}", truncate_str(&data, 200)));
        let parsed: Message = match serde_json::from_str(&data) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let id = parsed.id.unwrap_or(0);
        if id > 0 {
            // 应答:oneshot 一次性投递(Go 是缓冲 1 的 channel,等价)
            let tx = c.pending.lock_ok().remove(&id);
            if let Some(tx) = tx {
                let _ = tx.send(parsed);
            }
        } else {
            bridge.handle_event(parsed);
        }
    }
    bridge.drop_conn(Some(&c));
}

/// 周期 ping:活跃的 WS 收发让扩展 SW 免于被浏览器回收。
/// ping 帧 id=0 不占号,直接入写队列不走 call()(对齐 Go pingLoop)。
async fn ping_loop(bridge: ExtBridge, c: ConnHandle) {
    loop {
        tokio::select! {
            _ = tokio::time::sleep(PING_INTERVAL) => {}
            // 连接关闭(writer 退出、rx 落栈)→ 立即结束
            _ = c.tx.closed() => return,
        }
        if c.closed.load(Ordering::SeqCst) {
            return;
        }
        let ping = Request {
            id: 0,
            op: OP_PING.to_string(),
            tab_id: None,
            method: None,
            params: None,
            session_id: None,
        };
        let data = match serde_json::to_string(&ping) {
            Ok(s) => s,
            Err(_) => return,
        };
        // try_send:队满(writer 停滞)与已关闭同判连接不健康,断开止损
        if c.tx.try_send(data).is_err() {
            bridge.drop_conn(Some(&c));
            return;
        }
    }
}
