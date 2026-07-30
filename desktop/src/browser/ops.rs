// 浏览器操作语义:每个 browser_ 工具对应的会话级实现,以及 MCP 注册用的
// 工具元数据表。契约对齐 agent/internal/browser/ops.go + tools.go
// (文案/参数/坐标计算逐字段移植)。
//
// 对兄弟模块的 API 依赖(并行开发,以任务契约为准):
//   - keys.rs: parse_key_combo(&str) -> Result<KeyPress, String>,
//     KeyPress{ key, code, key_code, text, modifiers }
//   - snapshot.rs: COLLECT_JS 采集脚本常量;SnapshotMeta{ items, cross_origin_iframes, .. }
//     (items[i].framed 可写);parse_snapshot_meta(&str) -> Result<SnapshotMeta, String>;
//     format_snapshot(&SnapshotMeta) -> String
//   - refs.rs: ElemRef{ session_id, object_id }(Clone + Default)

use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use super::keys::{parse_key_combo, KeyPress};
use super::protocol::TabInfo;
use super::refs::{err_ref_stale, ElemRef};
use super::session::{
    first_non_empty, is_stale_object_err, truncate, BrowserSession, EvalResult, RemoteObject,
};
use super::snapshot::{format_snapshot, parse_snapshot_meta, SnapshotMeta, COLLECT_JS};

/// 导航后等待页面加载的上限。
const NAV_TIMEOUT: Duration = Duration::from_secs(10);
/// 交互后给页面反应的时间(JS 处理/发起导航)。
const SETTLE_DELAY: Duration = Duration::from_millis(500);

/// 仅放行 http/https(about:blank 允许,内部空白页)。
/// Go 用 url.Parse 后判 Scheme(Parse 会把 scheme 小写化);此处等价为
/// 大小写不敏感的前缀判定。
fn validate_url(raw: &str) -> Result<(), String> {
    if raw == "about:blank" {
        return Ok(());
    }
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(());
    }
    Err(format!(
        "仅支持 http/https 地址(收到 {raw:?});浏览器内部页面受保护无法访问"
    ))
}

/// 元素滚动进视口后的中心坐标(主视口坐标系)。
#[allow(dead_code)] // w/h 与 Go elemRect 对齐保留,当前仅用中心点
struct ElemRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl BrowserSession {
    // ==================== browser_navigate ====================

    /// 打开 URL("back" 后退);无活动标签页时自动新建。
    pub async fn navigate(&self, url: &str) -> Result<String, String> {
        self.ensure()?;
        if url == "back" {
            return self.navigate_back().await;
        }
        validate_url(url)?;

        let cur = self.state().tab_id;
        let tab = match cur {
            None => {
                let id = self.0.cdp.tabs_create(url).await?.tab_id;
                if let Err(e) = self.0.sessions.claim_tab(&self.0.owner, id, false) {
                    let _ = self.0.cdp.tabs_close(id).await;
                    return Err(e);
                }
                {
                    let mut st = self.state();
                    st.tabs.insert(id);
                    st.tab_id = Some(id);
                    st.refs.invalidate();
                }
                let _ = self.0.cdp.cmd(id, None, "Page.enable", None).await;
                id
            }
            Some(tab) => {
                self.0.cdp.attach(tab).await?;
                let _ = self.0.cdp.cmd(tab, None, "Page.enable", None).await;
                let nav = self
                    .0
                    .cdp
                    .cmd(tab, None, "Page.navigate", Some(json!({ "url": url })))
                    .await?;
                let error_text = nav.get("errorText").and_then(|v| v.as_str()).unwrap_or("");
                if !error_text.is_empty() {
                    return Err(format!("导航失败: {error_text}"));
                }
                tab
            }
        };
        self.wait_loaded(tab, NAV_TIMEOUT).await;
        self.state().refs.invalidate();
        self.page_brief(tab).await
    }

    /// 历史后退。
    async fn navigate_back(&self) -> Result<String, String> {
        let tab = self.ensure_tab().await?;
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Hist {
            #[serde(rename = "currentIndex")]
            current_index: i64,
            entries: Vec<HistEntry>,
        }
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct HistEntry {
            id: i64,
        }
        let raw = self.cmd(tab, None, "Page.getNavigationHistory", None).await?;
        let hist: Hist = serde_json::from_value(raw)
            .map_err(|e| format!("CDP Page.getNavigationHistory 结果解析失败: {e}"))?;
        if hist.current_index <= 0 || hist.current_index as usize >= hist.entries.len() {
            return Err("没有可后退的历史记录".to_string());
        }
        let entry = &hist.entries[hist.current_index as usize - 1];
        self.cmd(
            tab,
            None,
            "Page.navigateToHistoryEntry",
            Some(json!({ "entryId": entry.id })),
        )
        .await?;
        self.wait_loaded(tab, NAV_TIMEOUT).await;
        self.state().refs.invalidate();
        self.page_brief(tab).await
    }

    /// 页面摘要:标题/URL/正文节选(navigate 与 tabs select 的返回体)。
    async fn page_brief(&self, tab: i64) -> Result<String, String> {
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Brief {
            url: String,
            title: String,
            excerpt: String,
        }
        let brief: Brief = self
            .eval(
                tab,
                r"({url:location.href,title:document.title,excerpt:(document.body?document.body.innerText:'').trim().replace(/\n{3,}/g,'\n\n').slice(0,800)})",
            )
            .await?;
        let mut out = format!(
            "已打开: {}\nURL: {}",
            first_non_empty(&[&brief.title, "(无标题)"]),
            brief.url
        );
        if !brief.excerpt.is_empty() {
            out.push_str("\n\n正文开头:\n");
            out.push_str(&brief.excerpt);
        }
        out.push_str("\n\n(调用 browser_snapshot 获取可交互元素列表)");
        Ok(out + &self.take_notes())
    }

    // ==================== browser_snapshot ====================

    /// 页面快照:元数据 + 重建 ref 表 + 格式化文本。
    pub async fn snapshot(&self) -> Result<String, String> {
        let tab = self.ensure_tab().await?;

        // 释放上一代对象组(主 + 上次的所有 OOPIF 子会话,防远端对象泄漏)
        let (old_group, old_sessions, new_gen) = {
            let st = self.state();
            let og = if st.refs.gen() > 0 {
                st.refs.object_group()
            } else {
                String::new()
            };
            let mut sessions = vec![String::new()];
            sessions.extend(st.last_oopif.iter().cloned());
            (og, sessions, st.refs.gen() + 1)
        };
        if !old_group.is_empty() {
            for sid in &old_sessions {
                let sid_opt = if sid.is_empty() { None } else { Some(sid.as_str()) };
                let _ = self
                    .0
                    .cdp
                    .cmd(
                        tab,
                        sid_opt,
                        "Runtime.releaseObjectGroup",
                        Some(json!({ "objectGroup": old_group })),
                    )
                    .await;
            }
        }
        let group = format!("mc-gen-{new_gen}");

        // 主 target(含同源 iframe,阶段1)
        let (mut meta, mut refs) = self.collect_frame(tab, None, &group).await?;

        // 跨源 iframe(OOPIF):各自独立子会话,逐个采集并入(扩展已递归
        // attach 所有层级,frames_list 返回全部深度的子会话)。单个子会话
        // 失败只跳过。
        let mut oopif: Vec<String> = Vec::new();
        if let Ok(frames) = self.0.cdp.frames_list(tab).await {
            for f in frames {
                let Ok((mut f_meta, f_refs)) =
                    self.collect_frame(tab, Some(&f.session_id), &group).await
                else {
                    continue;
                };
                for it in &mut f_meta.items {
                    it.framed = true;
                }
                meta.items.extend(f_meta.items);
                refs.extend(f_refs);
                oopif.push(f.session_id.clone());
            }
            // 顶层跨源 iframe 已展开;仅当无法枚举时才提示"未包含"
            meta.cross_origin_iframes = 0;
        }

        {
            let mut st = self.state();
            st.refs.rebuild(new_gen, refs);
            st.last_oopif = oopif;
        }
        Ok(format_snapshot(&meta) + &self.take_notes())
    }

    /// 在一个会话(None = 根会话/主 target;Some = OOPIF 子会话)采集可交互
    /// 元素:执行 COLLECT_JS 拿元数据,再取元素数组句柄逐个解析 objectId。
    async fn collect_frame(
        &self,
        tab: i64,
        session_id: Option<&str>,
        group: &str,
    ) -> Result<(SnapshotMeta, Vec<ElemRef>), String> {
        let raw: String = self.eval_session(tab, session_id, COLLECT_JS).await?;
        let meta = parse_snapshot_meta(&raw)?;
        let arr_raw = self
            .cmd(
                tab,
                session_id,
                "Runtime.evaluate",
                Some(json!({"expression": "window.__mcAgentRefs", "objectGroup": group})),
            )
            .await?;
        let arr: EvalResult = serde_json::from_value(arr_raw)
            .map_err(|e| format!("CDP Runtime.evaluate 结果解析失败: {e}"))?;
        arr.err()?;
        // 不变式:refs 与 meta.items 按下标一一对应(缺句柄的槽位留空 ref,
        // 交互时会以 stale 报错兜底)
        let mut refs: Vec<ElemRef> = vec![ElemRef::default(); meta.items.len()];
        if !arr.result.object_id.is_empty() && !meta.items.is_empty() {
            #[derive(Deserialize, Default)]
            #[serde(default)]
            struct Props {
                result: Vec<Prop>,
            }
            #[derive(Deserialize, Default)]
            #[serde(default)]
            struct Prop {
                name: String,
                value: Option<RemoteObject>,
            }
            let props_raw = self
                .cmd(
                    tab,
                    session_id,
                    "Runtime.getProperties",
                    Some(json!({"objectId": arr.result.object_id, "ownProperties": true})),
                )
                .await?;
            let props: Props = serde_json::from_value(props_raw)
                .map_err(|e| format!("CDP Runtime.getProperties 结果解析失败: {e}"))?;
            for p in props.result {
                let Ok(idx) = p.name.parse::<usize>() else { continue };
                let Some(v) = p.value else { continue };
                if idx >= refs.len() {
                    continue;
                }
                refs[idx] = ElemRef {
                    session_id: session_id.unwrap_or("").to_string(),
                    object_id: v.object_id,
                };
            }
        }
        Ok((meta, refs))
    }

    /// 取 ref 对应的元素定位信息。
    fn resolve_ref(&self, r: &str) -> Result<ElemRef, String> {
        self.state().refs.lookup(r)
    }

    /// 交互后的状态回报(settle 延时 + 轻量状态,免于每步 snapshot)。
    async fn interaction_result(&self, tab: i64, action: &str) -> String {
        tokio::time::sleep(SETTLE_DELAY).await;
        let st = match self.status(tab).await {
            Err(_) => return format!("{action}{}", self.take_notes()),
            Ok(s) => s,
        };
        let mut out = format!(
            "{action};当前页面: {}({})",
            first_non_empty(&[&st.title, "(无标题)"]),
            st.url
        );
        if st.gen == 0 {
            out.push_str("\n页面已导航,元素引用已失效;如需继续交互请重新 browser_snapshot");
        }
        out + &self.take_notes()
    }

    /// 主 target(含同进程 iframe)元素滚动进视口并取**主视口坐标**
    /// (供顶层 Input 真实鼠标点击)。坐标经 DOM.getBoxModel(objectId) 取得,
    /// 浏览器统一计算,自动含所有同进程 iframe 偏移。OOPIF 元素不走此路。
    async fn locate(&self, tab: i64, obj_id: &str) -> Result<ElemRect, String> {
        // 先滚进视口(iframe 内元素 scrollIntoView 会滚对应 iframe;
        // callFunctionOn 在元素所属执行上下文运行,跨 iframe 自动正确)
        let connected: Option<bool> = self
            .call_on(
                tab,
                None,
                obj_id,
                r"function(){
			if (!this.isConnected) return null;
			this.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
			return true;
		}",
                &[],
            )
            .await?;
        if connected.is_none() {
            return Err(err_ref_stale("该元素"));
        }
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct BoxRes {
            model: BoxModel,
        }
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct BoxModel {
            content: Vec<f64>,
            width: f64,
            height: f64,
        }
        let raw = match self
            .cmd(tab, None, "DOM.getBoxModel", Some(json!({ "objectId": obj_id })))
            .await
        {
            Ok(v) => v,
            Err(e) => {
                if is_stale_object_err(&e) {
                    return Err(err_ref_stale("该元素"));
                }
                return Err(e);
            }
        };
        let b: BoxRes = serde_json::from_value(raw)
            .map_err(|e| format!("CDP DOM.getBoxModel 结果解析失败: {e}"))?;
        let q = &b.model.content;
        if q.len() < 8 || b.model.width <= 0.0 || b.model.height <= 0.0 {
            return Err(err_ref_stale("该元素"));
        }
        // content 是内容盒的四角 [x1,y1,x2,y2,x3,y3,x4,y4](主视口坐标),取中心
        Ok(ElemRect {
            x: (q[0] + q[2] + q[4] + q[6]) / 4.0,
            y: (q[1] + q[3] + q[5] + q[7]) / 4.0,
            w: b.model.width,
            h: b.model.height,
        })
    }

    // ==================== browser_click ====================

    /// 点击 ref 元素。主 target(含同源 iframe)走真实鼠标事件(坐标经
    /// getBoxModel 统一计算);跨源 iframe(OOPIF)因跨进程坐标累加脆弱,
    /// 退化为在元素所在子会话执行 element.click()(合成事件)。
    pub async fn click(&self, r: &str) -> Result<String, String> {
        let tab = self.ensure_tab().await?;
        let er = self.resolve_ref(r)?;
        if er.session_id.is_empty() {
            let rect = self.locate(tab, &er.object_id).await?;
            for ev in [
                json!({"type": "mouseMoved", "x": rect.x, "y": rect.y}),
                json!({"type": "mousePressed", "x": rect.x, "y": rect.y, "button": "left", "clickCount": 1}),
                json!({"type": "mouseReleased", "x": rect.x, "y": rect.y, "button": "left", "clickCount": 1}),
            ] {
                self.cmd(tab, None, "Input.dispatchMouseEvent", Some(ev)).await?;
            }
        } else {
            let ok: Option<bool> = self
                .call_on(
                    tab,
                    Some(&er.session_id),
                    &er.object_id,
                    r"function(){
				if (!this.isConnected) return null;
				this.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
				this.click();
				return true;
			}",
                    &[],
                )
                .await?;
            if ok.is_none() {
                return Err(err_ref_stale(r));
            }
        }
        Ok(self.interaction_result(tab, &format!("已点击 {r}")).await)
    }

    // ==================== browser_type ====================

    /// 聚焦元素并输入文本(真实输入事件,框架监听可触发)。
    pub async fn type_text(
        &self,
        r: &str,
        text: &str,
        clear: bool,
        submit: bool,
    ) -> Result<String, String> {
        let tab = self.ensure_tab().await?;
        let er = self.resolve_ref(r)?;
        let mut action = format!("已在 {} 输入 {:?}", r, truncate(text, 60));
        if !er.session_id.is_empty() {
            // 跨源 iframe:顶层 Input 到不了子进程焦点,直接在子会话用 DOM 设值
            let ok: Option<bool> = self
                .call_on(
                    tab,
                    Some(&er.session_id),
                    &er.object_id,
                    r"function(text, clear, submit){
				if (!this.isConnected) return null;
				this.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
				this.focus();
				if ('value' in this) {
					this.value = clear ? text : (this.value + text);
				} else if (this.isContentEditable) {
					if (clear) this.textContent = '';
					this.textContent += text;
				}
				this.dispatchEvent(new Event('input', {bubbles: true}));
				this.dispatchEvent(new Event('change', {bubbles: true}));
				if (submit && this.form) this.form.requestSubmit ? this.form.requestSubmit() : this.form.submit();
				return true;
			}",
                    &[json!(text), json!(clear), json!(submit)],
                )
                .await?;
            if ok.is_none() {
                return Err(err_ref_stale(r));
            }
            if submit {
                action.push_str(" 并提交");
            }
            return Ok(self.interaction_result(tab, &action).await);
        }

        // 主 target(含同源 iframe):真实输入事件
        let ok: Option<bool> = self
            .call_on(
                tab,
                None,
                &er.object_id,
                r"function(clear){
			if (!this.isConnected) return null;
			this.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
			this.focus();
			if (clear) {
				if ('value' in this && typeof this.select === 'function') { this.select(); }
				else if (this.isContentEditable) { document.execCommand('selectAll', false, null); }
			}
			return true;
		}",
                &[json!(clear)],
            )
            .await?;
        if ok.is_none() {
            return Err(err_ref_stale(r));
        }
        // 选中态下 insertText 覆盖旧值(等价清空)
        self.cmd(tab, None, "Input.insertText", Some(json!({ "text": text })))
            .await?;
        if submit {
            let enter = parse_key_combo("Enter")?;
            self.dispatch_key(tab, &enter).await?;
            action.push_str(" 并回车提交");
        }
        Ok(self.interaction_result(tab, &action).await)
    }

    // ==================== browser_select_option ====================

    /// 设置 <select> 选中项(按 value 或可见文本匹配)。
    pub async fn select_option(&self, r: &str, values: &[String]) -> Result<String, String> {
        let tab = self.ensure_tab().await?;
        let er = self.resolve_ref(r)?;
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct SelRes {
            err: String,
            hit: i64,
        }
        let sid = if er.session_id.is_empty() {
            None
        } else {
            Some(er.session_id.as_str())
        };
        let res: Option<SelRes> = self
            .call_on(
                tab,
                sid,
                &er.object_id,
                r"function(values){
			if (!this.isConnected) return null;
			if (this.tagName !== 'SELECT') return {err: 'not_select'};
			const want = new Set(values);
			let hit = 0;
			for (const o of this.options) {
				const on = want.has(o.value) || want.has(o.textContent.trim());
				if (!this.multiple && hit > 0 && on) continue;
				o.selected = on;
				if (on) hit++;
			}
			this.dispatchEvent(new Event('input', {bubbles: true}));
			this.dispatchEvent(new Event('change', {bubbles: true}));
			return {hit};
		}",
                &[json!(values)],
            )
            .await?;
        let Some(res) = res else {
            return Err(err_ref_stale(r));
        };
        if res.err == "not_select" {
            return Err(format!(
                "{r} 不是 <select> 元素;文本输入用 browser_type,点击用 browser_click"
            ));
        }
        if res.hit == 0 {
            // Go %v 对 []string 的展示形态:[a b]
            return Err(format!(
                "没有匹配的选项(按 value 或可见文本精确匹配): [{}];可先 browser_snapshot 查看",
                values.join(" ")
            ));
        }
        Ok(self
            .interaction_result(tab, &format!("已在 {} 选中 {} 项", r, res.hit))
            .await)
    }

    // ==================== browser_press_key ====================

    /// 向焦点元素发送按键(支持 Control+A 等组合)。
    pub async fn press_key(&self, key: &str) -> Result<String, String> {
        let tab = self.ensure_tab().await?;
        let press = parse_key_combo(key)?;
        self.dispatch_key(tab, &press).await?;
        Ok(self.interaction_result(tab, &format!("已按下 {key}")).await)
    }

    /// 完整按键序列 rawKeyDown → char(如有文本) → keyUp
    /// (修饰键经 modifiers 位掩码随三个事件下发,对齐 Go dispatchKey)。
    async fn dispatch_key(&self, tab: i64, k: &KeyPress) -> Result<(), String> {
        let down = json!({
            "type": "rawKeyDown", "modifiers": k.modifiers,
            "key": k.key, "code": k.code,
            "windowsVirtualKeyCode": k.key_code, "nativeVirtualKeyCode": k.key_code,
        });
        self.cmd(tab, None, "Input.dispatchKeyEvent", Some(down)).await?;
        if !k.text.is_empty() {
            let ch = json!({
                "type": "char", "modifiers": k.modifiers, "text": k.text,
                "key": k.key, "windowsVirtualKeyCode": k.key_code,
            });
            self.cmd(tab, None, "Input.dispatchKeyEvent", Some(ch)).await?;
        }
        let up = json!({
            "type": "keyUp", "modifiers": k.modifiers,
            "key": k.key, "code": k.code,
            "windowsVirtualKeyCode": k.key_code, "nativeVirtualKeyCode": k.key_code,
        });
        self.cmd(tab, None, "Input.dispatchKeyEvent", Some(up)).await?;
        Ok(())
    }

    // ==================== browser_scroll ====================

    /// 视口滚动一屏(direction)或滚动到元素(ref)。
    pub async fn scroll(
        &self,
        direction: Option<&str>,
        r: Option<&str>,
    ) -> Result<String, String> {
        let tab = self.ensure_tab().await?;
        if let Some(r) = r.filter(|v| !v.is_empty()) {
            let er = self.resolve_ref(r)?;
            if er.session_id.is_empty() {
                self.locate(tab, &er.object_id).await?;
            } else {
                // OOPIF:在子会话滚动元素进视口
                let ok: Option<bool> = self
                    .call_on(
                        tab,
                        Some(&er.session_id),
                        &er.object_id,
                        r"function(){
					if (!this.isConnected) return null;
					this.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
					return true;
				}",
                        &[],
                    )
                    .await?;
                if ok.is_none() {
                    return Err(err_ref_stale(r));
                }
            }
            return Ok(format!("已滚动到 {}{}", r, self.take_notes()));
        }
        let dir: i64 = if direction == Some("up") { -1 } else { 1 };
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Pos {
            y: i64,
            #[serde(rename = "docH")]
            doc_h: i64,
            #[serde(rename = "winH")]
            win_h: i64,
        }
        let expr = format!(
            "(window.scrollBy({{top: {dir} * innerHeight * 0.8, behavior: 'instant'}}),\n\t\t{{y: Math.round(scrollY), docH: Math.round(document.documentElement.scrollHeight), winH: innerHeight}})"
        );
        let pos: Pos = self.eval(tab, &expr).await?;
        Ok(format!(
            "已滚动,视口顶部在 {}/{}px(视口高 {}px);元素位置可能已变化,交互前建议重新 browser_snapshot{}",
            pos.y,
            pos.doc_h,
            pos.win_h,
            self.take_notes()
        ))
    }

    // ==================== browser_take_screenshot ====================

    /// 截图,返回 (png 字节, 文本注释)。注释含标题/URL/尺寸并附事件旁白;
    /// 图片块的组装(MCP image content)由调用方负责。
    /// 与 Go 的差异:Go 侧经 ImageBlockFromBytes 超限缩放,本层不做图像
    /// 处理(无图像解码依赖),尺寸直接读 PNG IHDR;缩放留给上层按需实现。
    pub async fn screenshot(&self, full_page: bool) -> Result<(Vec<u8>, String), String> {
        let tab = self.ensure_tab().await?;
        let mut params = json!({ "format": "png" });
        if full_page {
            params["captureBeyondViewport"] = json!(true);
        }
        let res = self
            .cmd(tab, None, "Page.captureScreenshot", Some(params))
            .await?;
        let data = res.get("data").and_then(|v| v.as_str()).unwrap_or("");
        let raw = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|e| format!("截图数据解码失败: {e}"))?;
        let (w, h) = png_dims(&raw).ok_or_else(|| "截图处理失败: 非法 PNG 数据".to_string())?;
        let st = self.status(tab).await.unwrap_or_default();
        let note = format!(
            "截图: {}({},{w}×{h})",
            first_non_empty(&[&st.title, "当前页面"]),
            st.url
        );
        Ok((raw, note + &self.take_notes()))
    }

    // ==================== browser_tabs ====================

    /// 标签页管理:list/new/select/close。
    pub async fn tabs(
        &self,
        action: &str,
        tab_id: Option<i64>,
        url: Option<&str>,
    ) -> Result<String, String> {
        self.ensure()?;
        match action {
            "list" | "" => {
                let tabs = self.0.cdp.tabs_list().await?;
                Ok(self.format_tabs(tabs))
            }
            "new" => {
                let raw = match url {
                    Some(u) if !u.is_empty() => u.to_string(),
                    _ => "about:blank".to_string(),
                };
                validate_url(&raw)?;
                let id = self.0.cdp.tabs_create(&raw).await?.tab_id;
                if let Err(e) = self.0.sessions.claim_tab(&self.0.owner, id, false) {
                    let _ = self.0.cdp.tabs_close(id).await;
                    return Err(e);
                }
                {
                    let mut st = self.state();
                    st.tabs.insert(id);
                    st.tab_id = Some(id);
                    st.refs.invalidate();
                }
                let _ = self.0.cdp.cmd(id, None, "Page.enable", None).await;
                self.wait_loaded(id, NAV_TIMEOUT).await;
                Ok(format!(
                    "已新建标签页 #{}({})并设为当前{}",
                    id,
                    raw,
                    self.take_notes()
                ))
            }
            "select" => {
                let Some(id) = tab_id.filter(|t| *t != 0) else {
                    return Err("select 需要 tab_id(先用 action=list 查看)".to_string());
                };
                // 先在壳侧锁定 owner，避免两个 Agent 同时选择同一标签页；
                // attach 失败则回滚新认领。
                let newly_claimed = self.0.sessions.claim_tab(&self.0.owner, id, false)?;
                if let Err(e) = self.0.cdp.attach(id).await {
                    if newly_claimed {
                        self.0.sessions.release_tab(&self.0.owner, id);
                    }
                    return Err(e);
                }
                {
                    let mut st = self.state();
                    st.tabs.insert(id);
                    st.tab_id = Some(id);
                    st.refs.invalidate();
                }
                let _ = self.0.cdp.cmd(id, None, "Page.enable", None).await;
                self.page_brief(id).await
            }
            "close" => {
                let Some(id) = tab_id.filter(|t| *t != 0) else {
                    return Err("close 需要 tab_id".to_string());
                };
                if self.0.sessions.owner_of(id).as_deref() != Some(self.0.owner.as_str()) {
                    return Err(format!("标签页 #{id} 不属于当前任务，不能关闭"));
                }
                self.0.cdp.tabs_close(id).await?;
                self.0.sessions.release_tab(&self.0.owner, id);
                {
                    let mut st = self.state();
                    st.tabs.remove(&id);
                    if st.tab_id == Some(id) {
                        st.tab_id = None;
                        st.refs.invalidate();
                    }
                }
                Ok(format!("已关闭标签页 #{}{}", id, self.take_notes()))
            }
            other => Err(format!("未知 action {other:?}(支持 list/new/select/close)")),
        }
    }

    /// 标签页列表文本。
    fn format_tabs(&self, mut tabs: Vec<TabInfo>) -> String {
        let current = self.state().tab_id;
        tabs.sort_by_key(|t| t.tab_id);
        let mut b = format!("标签页({} 个):\n", tabs.len());
        for t in &tabs {
            let mut marks = String::new();
            if current == Some(t.tab_id) {
                marks.push_str("[当前]");
            }
            let owner = self.0.sessions.owner_of(t.tab_id);
            marks.push_str(match owner.as_deref() {
                Some(owner) if owner == self.0.owner => "[受控]",
                Some(_) => "[其他任务]",
                None if t.controlled => "[待认领]",
                None => "[未受控]",
            });
            b.push_str(&format!(
                "#{} {} {} — {}\n",
                t.tab_id,
                marks,
                first_non_empty(&[&t.title, "(无标题)"]),
                t.url
            ));
        }
        b.push_str("[待认领]可由当前任务 select；[其他任务]已隔离不可抢占；[未受控]需用户通过浏览器扩展交付\n");
        b + &self.take_notes()
    }
}

/// 从 PNG 字节读取尺寸(IHDR:宽/高在偏移 16/20 处,大端 u32)。
fn png_dims(data: &[u8]) -> Option<(u32, u32)> {
    const SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if data.len() < 24 || data[..8] != SIG {
        return None;
    }
    let w = u32::from_be_bytes(data[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(data[20..24].try_into().ok()?);
    Some((w, h))
}

// ==================== 工具元数据(MCP 注册用) ====================
// name/description/InputSchema 逐字对齐 agent/internal/browser/tools.go。

pub struct ToolMeta {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: fn() -> Value,
}

/// 9 个浏览器工具的注册元数据(顺序对齐 Go Session.Tools())。
pub fn tool_metas() -> Vec<ToolMeta> {
    vec![
        ToolMeta {
            name: "browser_navigate",
            description: "在用户浏览器中打开网页(经 MonkeyCode 扩展控制,共享用户登录态)。无活动标签页时自动新建;url 填 \"back\" 表示后退。仅支持 http/https。",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "目标 URL;填 \"back\" 后退"}
                },
                "required": ["url"]
            }),
        },
        ToolMeta {
            name: "browser_snapshot",
            description: "获取当前页面快照:标题/URL/滚动位置 + 带编号(e1、e2...)的可交互元素列表。点击/输入等操作按编号定位元素;页面变化后需重新快照。",
            input_schema: || json!({"type": "object", "properties": {}}),
        },
        ToolMeta {
            name: "browser_take_screenshot",
            description: "截取当前页面为图片(视觉查看页面布局/图形内容;文字与可交互元素优先用 browser_snapshot,更省 token)。",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "full_page": {"type": "boolean", "description": "整页截图(默认仅当前视口)"}
                }
            }),
        },
        ToolMeta {
            name: "browser_click",
            description: "点击页面元素(browser_snapshot 返回的编号,如 e3)。真实鼠标事件,自动滚动元素进视口。",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "元素编号,如 e3"}
                },
                "required": ["ref"]
            }),
        },
        ToolMeta {
            name: "browser_type",
            description: "在输入框中输入文本(按元素编号定位)。默认覆盖原值;submit=true 输入后按回车提交。",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "元素编号,如 e3"},
                    "text": {"type": "string", "description": "要输入的文本"},
                    "clear": {"type": "boolean", "description": "先清空原值(默认 true)"},
                    "submit": {"type": "boolean", "description": "输入后按回车提交"}
                },
                "required": ["ref", "text"]
            }),
        },
        ToolMeta {
            name: "browser_select_option",
            description: "设置下拉框(<select>)的选中项,按选项 value 或可见文本精确匹配。",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "元素编号,如 e3"},
                    "values": {"type": "array", "items": {"type": "string"},
                        "description": "要选中的选项(value 或可见文本)"}
                },
                "required": ["ref", "values"]
            }),
        },
        ToolMeta {
            name: "browser_press_key",
            description: "向页面焦点元素发送按键,如 Enter、Escape、Tab、ArrowDown、PageDown,或组合键如 Control+A。",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "按键名或组合,如 Enter、Control+A"}
                },
                "required": ["key"]
            }),
        },
        ToolMeta {
            name: "browser_scroll",
            description: "滚动页面:direction=up/down 翻一屏,或 ref 滚动到指定元素。",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "direction": {"type": "string", "enum": ["up", "down"],
                        "description": "滚动方向(与 ref 二选一)"},
                    "ref": {"type": "string", "description": "滚动到该元素(与 direction 二选一)"}
                }
            }),
        },
        ToolMeta {
            name: "browser_tabs",
            description: "标签页管理:list 列出全部(含受控标注)、new 新建、select 切换到受控标签页、close 关闭。操作用户已打开的标签页需要用户先经扩展交付。",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "new", "select", "close"],
                        "description": "操作类型"},
                    "tab_id": {"type": "integer", "description": "目标标签页(select/close 必填)"},
                    "url": {"type": "string", "description": "新标签页打开的地址(action=new 可选,默认空白页)"}
                },
                "required": ["action"]
            }),
        },
    ]
}
