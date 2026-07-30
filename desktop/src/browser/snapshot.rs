// 页面快照:采集脚本 + 快照文本拼装。契约对齐 agent/internal/browser/snapshot.go。

/// 快照元素上限(防 token 爆炸)。与 COLLECT_JS 里的 MAX 保持一致。
pub const SNAPSHOT_MAX_ELEMS: i64 = 150;

/// 页面内采集脚本:枚举可见的可交互元素,递归进开放 shadowRoot
/// 与**同源 iframe**(contentDocument 可访问);跨源 iframe(OOPIF)在另一
/// 进程/执行上下文,此脚本进不去,仅计数(由内核的 OOPIF 路径单独采集)。
/// 元素数组存入 window.__mcAgentRefs 供第二步取句柄;window.__mcAgentGen 为
/// 页面内代号:导航后归零,交互前用它快速判定 ref 失效。
/// 脚本内容逐字对齐 Go 的 collectJS,一个字符都不能变。
pub const COLLECT_JS: &str = r#"(() => {
  const SELS = 'a[href],button,input,select,textarea,summary,[onclick],[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=combobox],[role=option],[role=switch],[contenteditable="true"]';
  const MAX = 150;
  const seen = new Set();
  const els = [];
  let truncated = false;
  let crossOrigin = 0;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // iframe 内元素须用其所属 window 的 getComputedStyle(跨 document)
    const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    const st = win.getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const collect = (root) => {
    for (const el of root.querySelectorAll(SELS)) {
      if (els.length >= MAX) { truncated = true; return; }
      if (seen.has(el) || !visible(el) || el.disabled) continue;
      seen.add(el);
      els.push(el);
    }
    // 开放 shadowRoot 与同源 iframe 递归(closed shadowRoot / 跨源 iframe 进不去)
    for (const el of root.querySelectorAll('*')) {
      if (els.length >= MAX) { truncated = true; return; }
      if (el.shadowRoot) collect(el.shadowRoot);
      if (el.tagName === 'IFRAME') {
        let doc = null;
        try { doc = el.contentDocument; } catch (e) { doc = null; }
        if (doc) collect(doc);
        else crossOrigin++;
      }
    }
  };
  collect(document);
  window.__mcAgentRefs = els;
  window.__mcAgentGen = (window.__mcAgentGen || 0) + 1;
  const items = els.map((el) => {
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const it = { tag, text };
    const role = el.getAttribute('role');
    if (role) it.role = role;
    if (tag === 'input') it.type = el.type || 'text';
    if (tag === 'a') it.href = (el.getAttribute('href') || '').slice(0, 120);
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      it.value = String(el.value ?? '').slice(0, 60);
      if (el.placeholder) it.ph = String(el.placeholder).slice(0, 40);
    }
    if (el.type === 'checkbox' || el.type === 'radio' || role === 'checkbox' || role === 'switch') {
      it.checked = !!el.checked || el.getAttribute('aria-checked') === 'true';
    }
    // 元素在同源 iframe 内时标注,便于模型理解层级
    if (el.ownerDocument !== document) it.framed = true;
    return it;
  });
  return JSON.stringify({
    url: location.href, title: document.title,
    scrollY: Math.round(scrollY), winH: innerHeight,
    docH: Math.round(document.documentElement.scrollHeight),
    crossOriginIframes: crossOrigin,
    truncated, gen: window.__mcAgentGen, items,
  });
})()"#;

/// 采集脚本返回的元数据(serde default:字段缺省即 Go 零值)。
#[derive(serde::Deserialize, Default, Debug)]
#[serde(default)]
pub struct SnapshotMeta {
    pub title: String,
    pub url: String,
    #[serde(rename = "scrollY")]
    pub scroll_y: i64,
    #[serde(rename = "winH")]
    pub win_h: i64,
    #[serde(rename = "docH")]
    pub doc_h: i64,
    #[serde(rename = "crossOriginIframes")]
    pub cross_origin_iframes: i64,
    pub truncated: bool,
    pub gen: i64,
    pub items: Vec<SnapItem>,
}

#[derive(serde::Deserialize, Default, Debug, Clone)]
#[serde(default)]
pub struct SnapItem {
    pub tag: String,
    #[serde(rename = "type")]
    pub typ: String,
    pub role: String,
    pub text: String,
    pub value: String,
    pub ph: String,
    /// 三态:JSON 缺席才不输出(对齐 Go 的 *bool)
    pub checked: Option<bool>,
    pub href: String,
    pub framed: bool,
}

/// 解析采集脚本返回的 JSON。
pub fn parse_snapshot_meta(raw: &str) -> Result<SnapshotMeta, String> {
    serde_json::from_str(raw).map_err(|e| format!("快照元数据解析失败: {}", e))
}

/// 快照文本(给模型):页面信息 + 带 ref 的可交互元素列表。
/// 拼装格式逐字对齐 Go 的 formatSnapshot。
pub fn format_snapshot(m: &SnapshotMeta) -> String {
    use std::fmt::Write as _;

    let mut b = String::new();
    let _ = write!(b, "页面: {}\nURL: {}\n", m.title, m.url);
    if m.doc_h > m.win_h {
        let _ = write!(b, "滚动: 视口顶部在 {}/{}px(视口高 {}px)\n", m.scroll_y, m.doc_h, m.win_h);
    }
    let _ = write!(b, "可交互元素({} 个):\n", m.items.len());
    for (i, it) in m.items.iter().enumerate() {
        let _ = write!(b, "e{} [{}", i + 1, it.tag);
        // 与 Go 的 `Type != "" && Type != "text" || Tag == "input"` 同优先级:input 恒展示类型。
        if (!it.typ.is_empty() && it.typ != "text") || it.tag == "input" {
            let _ = write!(b, ":{}", it.typ);
        }
        if !it.role.is_empty() {
            let _ = write!(b, " role={}", it.role);
        }
        b.push(']');
        if !it.text.is_empty() {
            let _ = write!(b, " {:?}", it.text);
        }
        if !it.value.is_empty() {
            let _ = write!(b, " 值:{:?}", it.value);
        }
        if !it.ph.is_empty() {
            let _ = write!(b, " 占位:{:?}", it.ph);
        }
        if let Some(checked) = it.checked {
            b.push_str(if checked { " [已勾选]" } else { " [未勾选]" });
        }
        if !it.href.is_empty() {
            let _ = write!(b, " → {}", it.href);
        }
        if it.framed {
            b.push_str(" (iframe 内)");
        }
        b.push('\n');
    }
    if m.truncated {
        let _ = write!(b, "(元素过多,仅列出前 {} 个;可滚动后重新 snapshot)\n", SNAPSHOT_MAX_ELEMS);
    }
    if m.cross_origin_iframes > 0 {
        let _ = write!(b, "(页面含 {} 个跨源 iframe,其内容未包含)\n", m.cross_origin_iframes);
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    // 契约对齐 snapshot_test.go 的 TestParseAndFormatSnapshot。
    #[test]
    fn test_parse_and_format_snapshot() {
        let raw = r#"{"url":"https://example.com/login","title":"登录页","scrollY":0,"winH":800,"docH":2400,
            "crossOriginIframes":1,"truncated":false,"gen":3,"items":[
            {"tag":"a","text":"首页","href":"/home"},
            {"tag":"button","text":"登录"},
            {"tag":"input","type":"text","text":"","value":"","ph":"用户名"},
            {"tag":"input","type":"checkbox","text":"记住我","checked":true},
            {"tag":"button","text":"发布","framed":true}
        ]}"#;
        let m = parse_snapshot_meta(raw).expect("解析应成功");
        assert!(m.gen == 3 && m.items.len() == 5, "元数据解析不对: {:?}", m);
        let out = format_snapshot(&m);
        for want in [
            "页面: 登录页",
            "URL: https://example.com/login",
            "e1 [a] \"首页\" → /home",
            "e2 [button] \"登录\"",
            "e3 [input:text]",
            "占位:\"用户名\"",
            "e4 [input:checkbox]",
            "[已勾选]",
            "e5 [button] \"发布\" (iframe 内)",
            "滚动: 视口顶部在 0/2400px",
            "1 个跨源 iframe",
        ] {
            assert!(out.contains(want), "快照缺少 {:?},实际:\n{}", want, out);
        }
    }

    // 契约对齐 snapshot_test.go 的 TestFormatSnapshot_Truncated。
    #[test]
    fn test_format_snapshot_truncated() {
        let out = format_snapshot(&SnapshotMeta { truncated: true, ..Default::default() });
        assert!(out.contains("仅列出前 150 个"), "截断提示缺失");
    }
}
