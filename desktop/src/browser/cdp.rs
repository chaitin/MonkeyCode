// CDP-over-bridge 薄客户端:经扩展桥对指定标签页执行 CDP 命令与 tabs 管理。
// 契约逐字对齐 agent/internal/browser/cdp.go(124 行版本):方法集刻意最小
// (v1 仅工具所需),不引第三方 CDP 库;全部 op 统一 30s 超时(Go callTimeout,
// 导航等待等长操作由调用方分段轮询)。
//
// 与 Go 的形态差异(非语义差异):
//   - cmd() 直接返回 result 的 serde_json::Value,由调用方自行解构(Go 是
//     unmarshal 进 out 指针,Rust 无对应形态);
//   - tabs_create 返回整个 TabInfo(Go 只回 tabId;载荷与校验一致:结果无
//     tabId 或为 0 即报「tabs.create 结果无效」)。

use std::time::Duration;

use serde_json::Value;

use super::bridge::ExtBridge;
use super::protocol::*;

/// 单条指令默认超时(对齐 Go cdp.go callTimeout;所有 op 共用)。
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// CDP 薄封装(Clone 即共享底层桥)。
#[derive(Clone)]
pub struct Cdp {
    pub bridge: ExtBridge,
}

impl Cdp {
    /// 空请求骨架(id 由 bridge.call 发号,这里恒置 0)。
    fn req(op: &str) -> Request {
        Request {
            id: 0,
            op: op.to_string(),
            tab_id: None,
            method: None,
            params: None,
            session_id: None,
        }
    }

    /// 执行一条 CDP 命令。session_id 为 Some 且非空时路由到跨源 iframe
    /// (OOPIF)的 flat 子会话;None/空 = 标签页根会话(对齐 Go CDPSession
    /// 的 omitempty 语义)。params 为 Null 时省略字段(对齐 Go params=nil)。
    pub async fn cmd(
        &self,
        tab_id: i64,
        session_id: Option<&str>,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, String> {
        let mut r = Self::req(OP_CDP);
        r.tab_id = Some(tab_id);
        r.method = Some(method.to_string());
        r.params = params.filter(|p| !p.is_null());
        r.session_id = session_id.filter(|s| !s.is_empty()).map(|s| s.to_string());
        self.bridge.call(r, CALL_TIMEOUT).await
    }

    /// 新建标签页(扩展侧自动 attach 并纳入受控集合)。
    /// 载荷 {"url": ...} 逐字对齐 Go TabsCreate。
    pub async fn tabs_create(&self, url: &str) -> Result<TabInfo, String> {
        let mut r = Self::req(OP_TABS_CREATE);
        r.params = Some(serde_json::json!({ "url": url }));
        let res = self.bridge.call(r, CALL_TIMEOUT).await?;
        let info: TabInfo = serde_json::from_value(res.clone()).unwrap_or_default();
        if info.tab_id == 0 {
            return Err(format!("tabs.create 结果无效: {res}"));
        }
        Ok(info)
    }

    /// 列出全部标签页(含受控标注)。
    pub async fn tabs_list(&self) -> Result<Vec<TabInfo>, String> {
        let res = self.bridge.call(Self::req(OP_TABS_LIST), CALL_TIMEOUT).await?;
        serde_json::from_value(res).map_err(|e| format!("tabs.list 结果解析失败: {e}"))
    }

    /// 激活标签页并前置其窗口(截图与真实输入需要可见)。
    #[allow(dead_code)] // 契约 API 保留(Go 同样未消费)
    pub async fn tabs_activate(&self, tab_id: i64) -> Result<(), String> {
        let mut r = Self::req(OP_TABS_ACTIVATE);
        r.tab_id = Some(tab_id);
        self.bridge.call(r, CALL_TIMEOUT).await.map(|_| ())
    }

    /// 关闭受控标签页。
    pub async fn tabs_close(&self, tab_id: i64) -> Result<(), String> {
        let mut r = Self::req(OP_TABS_CLOSE);
        r.tab_id = Some(tab_id);
        self.bridge.call(r, CALL_TIMEOUT).await.map(|_| ())
    }

    /// 附加 debugger(幂等;仅受控集合内的标签页允许)。
    pub async fn attach(&self, tab_id: i64) -> Result<(), String> {
        let mut r = Self::req(OP_ATTACH);
        r.tab_id = Some(tab_id);
        self.bridge.call(r, CALL_TIMEOUT).await.map(|_| ())
    }

    /// 剥离 debugger。
    #[allow(dead_code)] // session.close 链使用;单会话常驻下暂无调用方
    pub async fn detach(&self, tab_id: i64) -> Result<(), String> {
        let mut r = Self::req(OP_DETACH);
        r.tab_id = Some(tab_id);
        self.bridge.call(r, CALL_TIMEOUT).await.map(|_| ())
    }

    /// 列出标签页当前的跨源 iframe(OOPIF)子会话。
    /// 结果为空(扩展回 null/缺省)时返回空列表(对齐 Go len(res)==0 分支)。
    pub async fn frames_list(&self, tab_id: i64) -> Result<Vec<FrameInfo>, String> {
        let mut r = Self::req(OP_FRAMES_LIST);
        r.tab_id = Some(tab_id);
        let res = self.bridge.call(r, CALL_TIMEOUT).await?;
        if res.is_null() {
            return Ok(Vec::new());
        }
        serde_json::from_value(res).map_err(|e| format!("frames.list 结果解析失败: {e}"))
    }
}
