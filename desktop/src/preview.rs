use crate::driver::DriverHost;
use base64::Engine as _;
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::io::Read as _;
use std::path::{Component, Path, PathBuf};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::{
    http::{header, Request, Response, StatusCode},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewBuilder,
    WebviewUrl,
};

const LABEL: &str = "design-preview";
pub(crate) const ARTIFACT_SCHEME: &str = "monkeycode-artifact";
const ARTIFACT_HTTP_HOST: &str = "monkeycode-artifact.localhost";
const ARTIFACT_WORKSPACE_PREFIX: &str = "__workspace__";
const MAX_ARTIFACT_RESOURCE_BYTES: u64 = 128 * 1024 * 1024;
const RESULT_SCHEME: &str = "monkeycode-picker";
const PREVIEW_RESULT_SCHEME: &str = "monkeycode-preview-result";
const MAX_RESULT_BYTES: usize = 32 * 1024;
static PICKER_ACTIVE: AtomicBool = AtomicBool::new(false);
static PREVIEW_ZOOM: Mutex<f64> = Mutex::new(1.0);
/// preview 命令族的单车道。全族 async 化(见各命令)后不再内联于主线程的
/// webview IPC 回调——此前它们是同步命令,一个 `preview_create` 在 Windows
/// 上挂死(wry 建 WebView2 走 wait_with_pump 嵌套消息泵,期间重入的
/// preview IPC 可对半建的 webview 做 close/再建,把泵绞死),整个 IPC
/// 派发路径连同取消一起报废(2026-08-31 报障「preview_create 挂起后
/// 后续所有 IPC 全挂」)。async 让 IPC 回调立即返回;这把锁恢复原先
/// 主线程串行给到的次序保证,并从根上杜绝创建期重入。
static PREVIEW_LANE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const SERIALIZE_SCHEME: &str = "monkeycode-serialize";
const SERIALIZE_JS: &str = r#"(()=>{window.__mcSerialize=async id=>{try{const html='<!doctype html>\n'+new XMLSerializer().serializeToString(document.documentElement);if(new TextEncoder().encode(html).length>8388608)throw Error('HTML 超过 8 MiB 限制');const n=4000,total=Math.ceil(html.length/n);for(let i=0;i<total;i++){location.href=`monkeycode-serialize://${id}?index=${i}&total=${total}&data=${encodeURIComponent(html.slice(i*n,(i+1)*n))}`;await new Promise(r=>setTimeout(r,0))}}catch(e){location.href=`monkeycode-serialize://${id}?error=${encodeURIComponent(String(e?.message||e))}`}}})()"#;

fn serialize_result(url: &Url) -> Option<Result<Option<(String, String)>, String>> {
    if url.scheme() != SERIALIZE_SCHEME {
        return None;
    }
    let id = url.host_str().unwrap_or("");
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Some(Err("序列化请求 ID 无效".into()));
    }
    let q: HashMap<_, _> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if let Some(e) = q.get("error") {
        return Some(Err(e.chars().take(500).collect()));
    }
    let (i, t, d) = match (
        q.get("index").and_then(|x| x.parse::<usize>().ok()),
        q.get("total").and_then(|x| x.parse::<usize>().ok()),
        q.get("data"),
    ) {
        (Some(i), Some(t), Some(d)) => (i, t, d),
        _ => return Some(Err("HTML 分片格式无效".into())),
    };
    if t == 0 || t > 2048 || i >= t || d.len() > MAX_CAPTURE_CHUNK {
        return Some(Err("HTML 分片超出限制".into()));
    }
    let mut all = captures().lock().ok()?;
    let key = format!("html-{id}");
    if !all.contains_key(&key) && all.len() >= 8 {
        all.clear()
    }
    let p = all.entry(key.clone()).or_insert_with(|| CaptureParts {
        copy_to_clipboard: false,
        total: t,
        chunks: vec![None; t],
        bytes: 0,
    });
    if p.total != t {
        return Some(Err("HTML 分片数量不一致".into()));
    }
    if p.chunks[i].is_none() {
        p.bytes += d.len();
        if p.bytes > 8 * 1024 * 1024 {
            return Some(Err("HTML 超过 8 MiB 限制".into()));
        }
        p.chunks[i] = Some(d.clone())
    }
    if p.chunks.iter().all(Option::is_some) {
        let out = p.chunks.iter().map(|x| x.as_deref().unwrap()).collect();
        all.remove(&key);
        Some(Ok(Some((id.into(), out))))
    } else {
        Some(Ok(None))
    }
}

const CAPTURE_SCHEME: &str = "monkeycode-capture";
const MAX_CAPTURE_PIXELS: f64 = 80_000_000.0;
const MAX_CAPTURE_BYTES: usize = 24 * 1024 * 1024;
const MAX_CAPTURE_CHUNK: usize = 24 * 1024;

fn validate_capture_size(width: f64, height: f64) -> Result<(f64, f64), String> {
    if !width.is_finite()
        || !height.is_finite()
        || width < 1.0
        || height < 1.0
        || width * height > MAX_CAPTURE_PIXELS
    {
        return Err("页面尺寸无效或超过 8000 万像素".into());
    }
    Ok((width, height))
}

#[derive(Debug, PartialEq)]
struct FullCaptureSizePlan {
    capture: (f64, f64),
    restore: (f64, f64),
}

fn full_capture_size_plan(
    original: (f64, f64),
    page: (f64, f64),
) -> Result<FullCaptureSizePlan, String> {
    let capture = (page.0.ceil(), page.1.ceil());
    validate_capture_size(capture.0, capture.1)?;
    Ok(FullCaptureSizePlan {
        capture,
        restore: original,
    })
}

fn png_data_url(bytes: &[u8]) -> Result<String, String> {
    const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err("原生截图未生成有效 PNG".into());
    }
    if bytes.len() > MAX_CAPTURE_BYTES {
        return Err("截图数据超过 24 MiB".into());
    }
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
#[derive(Default)]
struct CaptureParts {
    copy_to_clipboard: bool,
    total: usize,
    chunks: Vec<Option<String>>,
    bytes: usize,
}
static CAPTURES: OnceLock<Mutex<HashMap<String, CaptureParts>>> = OnceLock::new();
fn captures() -> &'static Mutex<HashMap<String, CaptureParts>> {
    CAPTURES.get_or_init(Default::default)
}

fn capture_result(url: &Url) -> Option<Result<Option<(String, String, bool)>, String>> {
    if url.scheme() != CAPTURE_SCHEME {
        return None;
    }
    let id = url.host_str().unwrap_or("");
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Some(Err("截图请求 ID 无效".into()));
    }
    let q: HashMap<_, _> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if let Some(error) = q.get("error") {
        return Some(Err(format!(
            "页面截图失败: {}",
            error.chars().take(500).collect::<String>()
        )));
    }
    let copy_to_clipboard = match q.get("copy").map(String::as_str) {
        Some("1") => true,
        Some("0") => false,
        _ => return Some(Err("截图剪贴板参数无效".into())),
    };
    let (index, total, data) = match (
        q.get("index").and_then(|x| x.parse::<usize>().ok()),
        q.get("total").and_then(|x| x.parse::<usize>().ok()),
        q.get("data"),
    ) {
        (Some(i), Some(t), Some(d)) => (i, t, d),
        _ => return Some(Err("截图分片格式无效".into())),
    };
    if total == 0 || total > 2048 || index >= total || data.len() > MAX_CAPTURE_CHUNK {
        return Some(Err("截图分片超出限制".into()));
    }
    let mut all = captures()
        .lock()
        .map_err(|_| "截图状态锁损坏".to_string())
        .ok()?;
    if !all.contains_key(id) && all.len() >= 8 {
        all.clear()
    }
    let p = all.entry(id.into()).or_insert_with(|| CaptureParts {
        copy_to_clipboard,
        total,
        chunks: vec![None; total],
        bytes: 0,
    });
    if p.total != total || p.copy_to_clipboard != copy_to_clipboard {
        all.remove(id);
        return Some(Err("截图分片数量不一致".into()));
    }
    if p.chunks[index].is_none() {
        p.bytes += data.len();
        if p.bytes > MAX_CAPTURE_BYTES {
            all.remove(id);
            return Some(Err("截图数据超过 24 MiB 限制".into()));
        }
        p.chunks[index] = Some(data.clone())
    }
    if p.chunks.iter().all(Option::is_some) {
        let joined = p.chunks.iter().map(|x| x.as_deref().unwrap()).collect();
        let copy_to_clipboard = p.copy_to_clipboard;
        all.remove(id);
        Some(Ok(Some((id.into(), joined, copy_to_clipboard))))
    } else {
        Some(Ok(None))
    }
}

fn copy_capture_to_clipboard(data_url: &str) -> Result<(), String> {
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("截图不是 PNG 数据")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("截图解码失败: {e}"))?;
    let image =
        tauri::image::Image::from_bytes(&bytes).map_err(|e| format!("截图读取失败: {e}"))?;
    arboard::Clipboard::new()
        .and_then(|mut clipboard| {
            clipboard.set_image(arboard::ImageData {
                width: image.width() as usize,
                height: image.height() as usize,
                bytes: Cow::Owned(image.rgba().to_vec()),
            })
        })
        .map_err(|e| format!("写入系统剪贴板失败: {e}"))
}

#[derive(Clone, Copy, Deserialize)]
pub struct PreviewBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl PreviewBounds {
    fn validate(self) -> Result<Self, String> {
        if !self.x.is_finite()
            || !self.y.is_finite()
            || !self.width.is_finite()
            || !self.height.is_finite()
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
        {
            return Err("预览区域必须是有限的非负坐标和有限的正尺寸".into());
        }
        Ok(self)
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementStyles {
    color: String,
    background_color: String,
    font_size: String,
    opacity: String,
    width: String,
    height: String,
    justify_content: String,
    align_items: String,
    padding_top: String,
    padding_right: String,
    padding_bottom: String,
    padding_left: String,
    margin_top: String,
    margin_right: String,
    margin_bottom: String,
    margin_left: String,
    border_top_width: String,
    border_right_width: String,
    border_bottom_width: String,
    border_left_width: String,
    border_style: String,
    border_color: String,
    border_radius: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementSnapshot {
    selector: String,
    text: String,
    tag: String,
    bounds: ElementBounds,
    styles: ElementStyles,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementEdit {
    selector: String,
    property: String,
    value: String,
}

fn is_preview_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
}
fn preview_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|e| format!("无效的预览地址: {e}"))?;
    if is_preview_url(&url) {
        Ok(url)
    } else {
        Err("预览仅允许访问本机 localhost、127.0.0.1 或 [::1] 地址".into())
    }
}
fn webview(app: &AppHandle) -> Result<tauri::Webview, String> {
    app.get_webview(LABEL).ok_or_else(|| "预览尚未创建".into())
}
fn preview_zoom() -> Result<f64, String> {
    PREVIEW_ZOOM
        .lock()
        .map(|zoom| *zoom)
        .map_err(|_| "预览缩放状态锁损坏".into())
}
fn zoom_script(scale: f64) -> String {
    format!(
        "(()=>{{const target=document.body;if(!target)throw new Error('找不到页面根元素');const root=document.documentElement,body=document.body,s={scale},key='__mcPreviewZoomState',previous=window[key];if(previous){{for(const item of previous){{if(item.value)item.element.style.setProperty(item.name,item.value,item.priority);else item.element.style.removeProperty(item.name)}}delete window[key]}}if(s===1)return;const saved=[];const set=(element,name,value)=>{{if(!saved.some(item=>item.element===element&&item.name===name))saved.push({{element,name,value:element.style.getPropertyValue(name),priority:element.style.getPropertyPriority(name)}});element.style.setProperty(name,value,'important')}};window[key]=saved;const w=root.clientWidth,h=root.clientHeight;set(target,'width',w+'px');set(target,'min-height',h+'px');const cw=target.scrollWidth,ch=target.scrollHeight,offX=Math.max(0,(w-cw*s)/2),offY=Math.max(0,(h-ch*s)/2);set(target,'transform','translateX('+offX+'px) translateY('+offY+'px) scale('+s+')');set(target,'transform-origin','0 0');set(body,'overflow','visible');set(root,'overflow','auto');const scroller=document.scrollingElement||root;scroller.scrollLeft=Math.max(0,(cw*s-w)/2)}})()"
    )
}
fn apply_zoom(view: &tauri::Webview, scale: f64) -> Result<(), String> {
    view.set_zoom(1.0).map_err(|e| e.to_string())?;
    view.eval(zoom_script(scale)).map_err(|e| e.to_string())
}
fn valid_selector(s: &str) -> bool {
    !s.is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control)
}
fn valid_css_value(s: &str) -> bool {
    s.len() <= 512
        && !s
            .chars()
            .any(|c| c == ';' || c == '{' || c == '}' || c.is_control())
}
fn valid_text_value(s: &str) -> bool {
    s.len() <= 32 * 1024
}
fn validate_snapshot(s: ElementSnapshot) -> Result<ElementSnapshot, String> {
    if !valid_selector(&s.selector)
        || s.text.len() > 16_384
        || s.tag.is_empty()
        || s.tag.len() > 32
        || ![s.bounds.x, s.bounds.y, s.bounds.width, s.bounds.height]
            .iter()
            .all(|n| n.is_finite())
    {
        return Err("元素快照无效".into());
    }
    Ok(s)
}
fn picker_result(url: &Url) -> Option<Result<ElementSnapshot, String>> {
    if url.scheme() != RESULT_SCHEME || url.host_str() != Some("result") {
        return None;
    }
    let raw = url
        .query_pairs()
        .find(|(k, _)| k == "data")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    if raw.len() > MAX_RESULT_BYTES {
        return Some(Err("元素快照过大".into()));
    }
    Some(
        serde_json::from_str(&raw)
            .map_err(|_| "元素快照格式无效".to_string())
            .and_then(validate_snapshot),
    )
}

fn preview_result_action(url: &Url) -> Option<&'static str> {
    if url.scheme() != PREVIEW_RESULT_SCHEME {
        return None;
    }
    if url.path() != "" && url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    match url.host_str() {
        Some("download") => Some("download"),
        Some("send") => Some("send"),
        Some("close") => Some("close"),
        _ => None,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewResultCard<'a> {
    data_url: &'a str,
    status: &'a str,
    comment_count: usize,
}

const PREVIEW_RESULT_JS: &str = r#"(()=>{
const id='__monkeycode_preview_result_host';
const remove=()=>{const old=document.getElementById(id);if(old?.dataset.monkeycodePreviewResult==='1')old.remove()};
window.__mcPreviewResultHide=remove;
window.__mcPreviewResultShow=data=>{
 remove();
 const host=document.createElement('div');host.id=id;host.dataset.monkeycodePreviewResult='1';host.style.cssText='all:initial;position:fixed;right:14px;bottom:14px;width:240px;z-index:2147483647;display:block;pointer-events:auto;';
 const root=host.attachShadow({mode:'closed'}),card=document.createElement('section');card.setAttribute('aria-label','截图结果');
 const style=document.createElement('style');style.textContent=':host{all:initial}*{box-sizing:border-box}section{position:relative;width:240px;padding:10px;border:1px solid #3b414b;border-radius:10px;background:#20242b;color:#f2f4f7;box-shadow:0 8px 28px rgba(0,0,0,.38);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{display:flex;gap:9px;align-items:center;padding-right:22px}img{width:72px;height:50px;object-fit:cover;object-position:top;border-radius:6px;background:#111317}strong,small{display:block}small{margin-top:2px;color:#9aa3af}.actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}button{height:29px;border:1px solid #4a5260;border-radius:6px;background:#292e37;color:#e6e9ee;cursor:pointer;font:inherit}button:hover{background:#343b46}.close{position:absolute;right:7px;top:7px;width:24px;height:24px;border:0;background:transparent;font-size:18px}.status{margin:8px 1px 0;color:#9bd7b6;overflow-wrap:anywhere}';
 const header=document.createElement('header'),img=document.createElement('img'),text=document.createElement('div'),title=document.createElement('strong'),count=document.createElement('small');img.src=data.dataUrl;img.alt='截图缩略图';title.textContent='截图已就绪';count.textContent=String(data.commentCount)+' 条评论';text.append(title,count);header.append(img,text);
 const actions=document.createElement('div');actions.className='actions';for(const [action,label] of [['download','下载'],['send','发送到对话']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>{location.href='monkeycode-preview-result://'+action});actions.append(button)}
 const close=document.createElement('button');close.type='button';close.className='close';close.setAttribute('aria-label','关闭');close.textContent='×';close.addEventListener('click',()=>{location.href='monkeycode-preview-result://close'});
 const status=document.createElement('div');status.className='status';status.setAttribute('role','status');status.textContent=data.status;
 card.append(header,actions,status,close);root.append(style,card);document.documentElement.append(host)
};
})()"#;

const CAPTURE_JS: &str = r#"(()=>{const send=(id,q)=>{location.href=`monkeycode-capture://${id}?${q}`};window.__mcPreviewCapture=async(mode,id)=>{try{const viewport=mode==='viewport'||mode==='viewport-no-copy',copy=mode==='viewport-no-copy'?'0':'1';const root=document.documentElement,body=document.body;const w=mode==='full'?Math.max(root.scrollWidth,body?.scrollWidth||0,root.clientWidth):innerWidth;const h=mode==='full'?Math.max(root.scrollHeight,body?.scrollHeight||0,root.clientHeight):innerHeight;if(w<1||h<1||w*h>80000000)throw Error('页面尺寸无效或超过 8000 万像素');const clone=root.cloneNode(true);const sourceCanvases=[...root.querySelectorAll('canvas')],clonedCanvases=[...clone.querySelectorAll('canvas')];for(let i=0;i<clonedCanvases.length;i++){const source=sourceCanvases[i],canvas=clonedCanvases[i];if(!source||!canvas)continue;const image=document.createElement('img');image.src=source.toDataURL('image/png');image.width=source.width;image.height=source.height;for(const attr of canvas.attributes)image.setAttribute(attr.name,attr.value);image.style.cssText=canvas.style.cssText;canvas.replaceWith(image)}clone.querySelectorAll('script').forEach(x=>x.remove());clone.setAttribute('xmlns','http://www.w3.org/1999/xhtml');if(viewport){clone.style.width=`${w}px`;clone.style.height=`${h}px`;clone.style.overflow='hidden';const b=clone.querySelector('body');if(b)b.style.transform=`translate(${-scrollX}px,${-scrollY}px)`}const xml=new XMLSerializer().serializeToString(clone);const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;const img=new Image;await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(Error('页面含无法序列化的跨域资源'));img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');if(!ctx)throw Error('Canvas 不可用');ctx.drawImage(img,0,0);const png=c.toDataURL('image/png');const chunkSize=16000,total=Math.ceil(png.length/chunkSize);if(total<1||total>2048)throw Error('截图超过 24 MiB 限制');for(let i=0;i<total;i++){send(id,`index=${i}&total=${total}&copy=${copy}&data=${encodeURIComponent(png.slice(i*chunkSize,(i+1)*chunkSize))}`);await new Promise(ok=>setTimeout(ok,0))}}catch(e){send(id,`error=${encodeURIComponent(String(e?.message||e))}`)}}})()"#;

const PICKER_JS: &str = r#"(()=>{
if(window.__mcPicker)return;
const S=window.__mcPicker={active:false,hover:null,selected:null,undo:[]};
const originalOutline=new WeakMap();
const restoreProperty=(style,name,value,priority)=>{if(value)style.setProperty(name,value,priority);else style.removeProperty(name)};
const cssEscape=(s)=>window.CSS&&CSS.escape?CSS.escape(s):s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
const selector=(el)=>{if(el.id)return '#'+cssEscape(el.id);const parts=[];for(let n=el;n&&n.nodeType===1&&n!==document.documentElement;n=n.parentElement){let p=n.tagName.toLowerCase();if(n.classList.length)p+='.'+[...n.classList].slice(0,2).map(cssEscape).join('.');const peers=n.parentElement?[...n.parentElement.children].filter(x=>x.tagName===n.tagName):[];if(peers.length>1)p+=`:nth-of-type(${peers.indexOf(n)+1})`;parts.unshift(p);if(document.querySelectorAll(parts.join(' > ')).length===1)break}return parts.join(' > ')};
const outline=(el,on)=>{if(!el)return;if(on){if(!originalOutline.has(el))originalOutline.set(el,[el.style.getPropertyValue('outline'),el.style.getPropertyPriority('outline'),el.style.getPropertyValue('outline-offset'),el.style.getPropertyPriority('outline-offset')]);el.style.setProperty('outline','2px solid #16b364','important');el.style.setProperty('outline-offset','-2px','important')}else{const before=originalOutline.get(el);if(!before)return;restoreProperty(el.style,'outline',before[0],before[1]);restoreProperty(el.style,'outline-offset',before[2],before[3]);originalOutline.delete(el)}};
const eventTarget=(e)=>{const path=typeof e.composedPath==='function'?e.composedPath():[];const el=path.find(x=>x instanceof Element);return el instanceof Element?el:e.target instanceof Element?e.target:null};
const containsPoint=(el,x,y)=>{const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;return [...el.getClientRects()].some(r=>r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)};
const pickTarget=(root,x,y)=>{if(!root)return null;let best=root,bestDepth=0,bestArea=Infinity;const stack=[...root.children].map(el=>[el,1]);while(stack.length){const [child,depth]=stack.pop();if(!containsPoint(child,x,y))continue;const r=child.getBoundingClientRect(),area=Math.max(0,r.width*r.height);if(depth>bestDepth||(depth===bestDepth&&area<=bestArea)){best=child;bestDepth=depth;bestArea=area}for(const nested of child.children)stack.push([nested,depth+1])}return best};
const updateHover=(root,x,y)=>{const next=pickTarget(root,x,y);if(next===S.hover)return;outline(S.hover,false);S.hover=next;outline(S.hover,true)};
let hoverFrame=0,pendingHover=null,cursorBefore=null;
const stopHoverFrame=()=>{if(hoverFrame)cancelAnimationFrame(hoverFrame);hoverFrame=0;pendingHover=null};
const setActive=(on)=>{if(on&&!S.active){const style=document.documentElement.style;cursorBefore=[style.getPropertyValue('cursor'),style.getPropertyPriority('cursor')];style.setProperty('cursor','crosshair','important')}else if(!on&&S.active){const style=document.documentElement.style;if(cursorBefore)restoreProperty(style,'cursor',cursorBefore[0],cursorBefore[1]);cursorBefore=null;stopHoverFrame()}S.active=on;if(!on){outline(S.hover,false);S.hover=null}};
addEventListener('pointermove',e=>{if(!S.active)return;pendingHover={root:eventTarget(e),x:e.clientX,y:e.clientY};if(hoverFrame)return;hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;const point=pendingHover;pendingHover=null;if(S.active&&point)updateHover(point.root,point.x,point.y)})},true);
addEventListener('click',e=>{if(!S.active)return;e.preventDefault();e.stopImmediatePropagation();stopHoverFrame();updateHover(eventTarget(e),e.clientX,e.clientY);const el=S.hover;outline(el,false);S.hover=null;setActive(false);S.selected=el;if(!el)return;const r=el.getBoundingClientRect(),c=getComputedStyle(el);const data={selector:selector(el),text:(el.textContent||'').slice(0,16384),tag:el.tagName.toLowerCase(),bounds:{x:r.x,y:r.y,width:r.width,height:r.height},styles:{color:c.color,backgroundColor:c.backgroundColor,fontSize:c.fontSize,opacity:c.opacity,width:c.width,height:c.height,justifyContent:c.justifyContent,alignItems:c.alignItems,paddingTop:c.paddingTop,paddingRight:c.paddingRight,paddingBottom:c.paddingBottom,paddingLeft:c.paddingLeft,marginTop:c.marginTop,marginRight:c.marginRight,marginBottom:c.marginBottom,marginLeft:c.marginLeft,borderTopWidth:c.borderTopWidth,borderRightWidth:c.borderRightWidth,borderBottomWidth:c.borderBottomWidth,borderLeftWidth:c.borderLeftWidth,borderStyle:c.borderStyle,borderColor:c.borderColor,borderRadius:c.borderRadius}};location.href='monkeycode-picker://result?data='+encodeURIComponent(JSON.stringify(data))},true);
S.toggle=setActive;
S.apply=(edit)=>{const el=document.querySelector(edit.selector);if(!el)throw Error('元素已不存在');const prop=edit.property;if(prop==='delete'){const parent=el.parentNode,next=el.nextSibling;S.undo.push({el,prop,parent,next});el.remove();return}const before=prop==='text'?el.textContent:el.style[prop];S.undo.push({el,prop,before});if(prop==='text')el.textContent=edit.value;else el.style[prop]=edit.value};
S.undoOne=()=>{const x=S.undo.pop();if(!x)return false;if(x.prop==='delete'){x.parent.insertBefore(x.el,x.next);return true}if(x.prop==='text')x.el.textContent=x.before;else x.el.style[x.prop]=x.before;return true}
})()"#;

#[derive(Clone)]
struct ArtifactSite {
    workspace: PathBuf,
    root: PathBuf,
    entry: PathBuf,
}

static ARTIFACT_SITE: Mutex<Option<ArtifactSite>> = Mutex::new(None);

fn artifact_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "xml" => "application/xml",
        "txt" => "text/plain; charset=utf-8",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn artifact_request_file(site: &ArtifactSite, request_path: &str) -> Result<PathBuf, StatusCode> {
    let decoded = percent_decode_str(request_path.trim_start_matches('/'))
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let relative = Path::new(decoded.as_ref());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut components = relative.components();
    let workspace_relative = matches!(
        components.next(),
        Some(Component::Normal(part)) if part == ARTIFACT_WORKSPACE_PREFIX
    );
    let candidate = if workspace_relative {
        components.fold(site.workspace.clone(), |path, part| match part {
            Component::Normal(part) => path.join(part),
            _ => path,
        })
    } else {
        site.root.join(relative)
    };
    let candidate = if candidate.is_dir() {
        candidate.join("index.html")
    } else {
        candidate
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let allowed_root = if workspace_relative {
        &site.workspace
    } else {
        &site.root
    };
    if !canonical.starts_with(allowed_root) || !canonical.is_file() {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(canonical)
}

fn artifact_response_with_length(
    status: StatusCode,
    body: Vec<u8>,
    mime: &'static str,
    content_length: u64,
) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("X-Content-Type-Options", "nosniff")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn artifact_response(status: StatusCode, body: Vec<u8>, mime: &'static str) -> Response<Vec<u8>> {
    let content_length = body.len() as u64;
    artifact_response_with_length(status, body, mime, content_length)
}

fn read_artifact_file(path: &Path) -> Result<Vec<u8>, StatusCode> {
    let file = std::fs::File::open(path).map_err(|_| StatusCode::NOT_FOUND)?;
    if file.metadata().map_err(|_| StatusCode::NOT_FOUND)?.len() > MAX_ARTIFACT_RESOURCE_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let mut body = Vec::new();
    file.take(MAX_ARTIFACT_RESOURCE_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if body.len() as u64 > MAX_ARTIFACT_RESOURCE_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    Ok(body)
}

pub(crate) fn artifact_protocol_response(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    #[cfg(debug_assertions)]
    eprintln!("[preview-resource] {} {}", request.method(), request.uri());
    if request.method() != "GET" && request.method() != "HEAD" {
        return artifact_response(
            StatusCode::METHOD_NOT_ALLOWED,
            Vec::new(),
            "text/plain; charset=utf-8",
        );
    }
    let site = match ARTIFACT_SITE.lock().ok().and_then(|site| site.clone()) {
        Some(site) => site,
        None => {
            return artifact_response(
                StatusCode::NOT_FOUND,
                Vec::new(),
                "text/plain; charset=utf-8",
            )
        }
    };
    let file = match artifact_request_file(&site, request.uri().path()) {
        Ok(file) => file,
        Err(status) => return artifact_response(status, Vec::new(), "text/plain; charset=utf-8"),
    };
    let mime = artifact_mime(&file);
    if request.method() == "HEAD" {
        let content_length = match file.metadata() {
            Ok(metadata) => metadata.len(),
            Err(_) => {
                return artifact_response(
                    StatusCode::NOT_FOUND,
                    Vec::new(),
                    "text/plain; charset=utf-8",
                )
            }
        };
        return artifact_response_with_length(StatusCode::OK, Vec::new(), mime, content_length);
    }
    let body = match read_artifact_file(&file) {
        Ok(body) => body,
        Err(status) => return artifact_response(status, Vec::new(), "text/plain; charset=utf-8"),
    };
    artifact_response(StatusCode::OK, body, mime)
}

fn artifact_preview_file(workdir: &Path, relative: &str) -> Result<ArtifactSite, String> {
    let relative = Path::new(relative);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("预览文件路径无效".into());
    }
    if relative.extension().and_then(|ext| ext.to_str()) != Some("html") {
        return Err("只能预览 HTML 文件".into());
    }
    let root = workdir
        .canonicalize()
        .map_err(|e| format!("工作目录不可用: {e}"))?;
    let file = root
        .join(relative)
        .canonicalize()
        .map_err(|e| format!("预览文件不可用: {e}"))?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("预览文件不在工作目录内".into());
    }
    let artifact_root = file.parent().ok_or("预览文件没有父目录")?.to_path_buf();
    Ok(ArtifactSite {
        workspace: root,
        root: artifact_root,
        entry: file,
    })
}

fn artifact_entry_url(site: &ArtifactSite) -> Result<Url, String> {
    let relative = site
        .entry
        .strip_prefix(&site.workspace)
        .map_err(|_| "预览入口不在工作目录内")?;
    let mut path = format!("/{ARTIFACT_WORKSPACE_PREFIX}");
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err("预览入口路径无效".into());
        };
        let part = part.to_str().ok_or("预览入口路径不是 UTF-8")?;
        path.push('/');
        path.push_str(&utf8_percent_encode(part, NON_ALPHANUMERIC).to_string());
    }
    Url::parse(&format!("{ARTIFACT_SCHEME}://localhost{path}"))
        .map_err(|e| format!("无法创建预览地址: {e}"))
}

fn is_artifact_url(url: &Url) -> bool {
    url.scheme() == ARTIFACT_SCHEME
        || matches!(url.scheme(), "http" | "https") && url.host_str() == Some(ARTIFACT_HTTP_HOST)
}

/// 自定义协议 URL 的 http 桥接形态(`http://monkeycode-artifact.localhost/…`)。
/// Windows 上 WebView2 导航不了原生自定义 scheme——tauri 的自定义协议在
/// Windows/Android 只经此形态可达(tauri app.rs 文档),而 tauri 对
/// `WebviewUrl::CustomProtocol` 的入口 URL 原样透传不做平台转换。路径保持
/// 已编码形态原样拼接,不二次编码。
fn bridged_artifact_url(url: &Url) -> Result<Url, String> {
    Url::parse(&format!("http://{ARTIFACT_HTTP_HOST}{}", url.path()))
        .map_err(|e| format!("无法创建桥接预览地址: {e}"))
}

/// artifact 入口按平台选形态:Windows 走 http 桥接(否则永远空白,
/// 2026-08-31 报障「本地 html 无法预览」;导航白名单 is_artifact_url 早已
/// 两种形态都认,此前唯独漏了入口);macOS/Linux 走真自定义协议。
fn artifact_webview_url(url: Url) -> Result<WebviewUrl, String> {
    if cfg!(windows) {
        Ok(WebviewUrl::External(bridged_artifact_url(&url)?))
    } else {
        Ok(WebviewUrl::CustomProtocol(url))
    }
}

fn create_preview(
    app: AppHandle,
    url: Url,
    bounds: PreviewBounds,
    artifact_root: Option<PathBuf>,
) -> Result<(), String> {
    let bounds = bounds.validate()?;
    if let Some(v) = app.get_webview(LABEL) {
        v.close().map_err(|e| e.to_string())?;
    }
    let window = app.get_window("main").ok_or("主窗口不存在")?;
    let callback_app = app.clone();
    let navigation_root = artifact_root.clone();
    let webview_url = if is_artifact_url(&url) {
        artifact_webview_url(url)?
    } else {
        WebviewUrl::External(url)
    };
    let view = window
        .add_child(
            WebviewBuilder::new(LABEL, webview_url)
                .on_navigation(move |url| {
                    if let Some(action) = preview_result_action(url) {
                        let _ = callback_app.emit_to("main", "preview-result-action", action);
                        false
                    } else if url.scheme() == PREVIEW_RESULT_SCHEME {
                        false
                    } else if let Some(result) = serialize_result(url) {
                        match result { Ok(Some((request_id, html))) => { let _=callback_app.emit_to("main","preview-serialized",serde_json::json!({"requestId":request_id,"html":html})); }, Ok(None)=>{}, Err(error)=>{let _=callback_app.emit_to("main","preview-serialized-error",serde_json::json!({"requestId":url.host_str().unwrap_or(""),"error":error}));} }
                        false
                    } else if let Some(result) = capture_result(url) {
                        match result {
                            Ok(Some((request_id, data_url, copy_to_clipboard))) => {
                                // 本回调在主线程消息泵里跑;Windows 系统剪贴板是全局锁
                                // (OpenClipboard 可被他程占住而阻塞),写入挪去独立线程,
                                // 完成后再发事件
                                let app = callback_app.clone();
                                std::thread::spawn(move || {
                                    let clipboard_error = copy_to_clipboard
                                        .then(|| copy_capture_to_clipboard(&data_url))
                                        .transpose()
                                        .err();
                                    let _ = app.emit_to("main", "preview-captured", serde_json::json!({"requestId":request_id,"dataUrl":data_url,"clipboardError":clipboard_error}));
                                });
                            }
                            Ok(None) => {}
                            Err(error) => { let _ = callback_app.emit_to("main", "preview-capture-error", serde_json::json!({"requestId":url.host_str().unwrap_or(""),"error":error})); }
                        }
                        false
                    } else if let Some(result) = picker_result(url) {
                        PICKER_ACTIVE.store(false, Ordering::Relaxed);
                        match result {
                            Ok(snapshot) => { let _ = callback_app.emit_to("main", "preview-element-picked", snapshot); }
                            Err(error) => { let _ = callback_app.emit_to("main", "preview-picker-error", error); }
                        }
                        false
                    } else if let Some(root) = &navigation_root {
                        is_artifact_url(url)
                            || url.to_file_path()
                                .ok()
                                .and_then(|path| path.canonicalize().ok())
                                .is_some_and(|path| path.starts_with(root))
                    } else {
                        is_preview_url(url)
                    }
                })
                .on_page_load(|webview, _| {
                    let picker_active = PICKER_ACTIVE.load(Ordering::Relaxed);
                    let _ = webview.eval(format!(
                        "{PICKER_JS};window.__mcPicker.toggle({picker_active})"
                    ));
                    let _ = webview.eval(CAPTURE_JS);
                    let _ = webview.eval(SERIALIZE_JS);
                    if let Ok(scale) = preview_zoom() {
                        let _ = apply_zoom(&webview, scale);
                    }
                }),
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| format!("创建预览失败: {e}"))?;
    view.eval(PICKER_JS)
        .map_err(|e| format!("初始化元素选择器失败: {e}"))?;
    view.eval(CAPTURE_JS)
        .map_err(|e| format!("初始化截图器失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn preview_create(app: AppHandle, url: String, bounds: PreviewBounds) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    #[cfg(debug_assertions)]
    eprintln!("[preview-lifecycle] create url={url}");
    *ARTIFACT_SITE.lock().map_err(|_| "预览资源状态锁损坏")? = None;
    create_preview(app, preview_url(&url)?, bounds, None)
}

#[tauri::command]
pub async fn preview_create_artifact(
    app: AppHandle,
    host: State<'_, DriverHost>,
    id: String,
    path: String,
    bounds: PreviewBounds,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!("[preview-lifecycle] create-artifact id={id} path={path}");
    let engine = host.get()?;
    let workdir = engine.session_workdir(&id).await?;
    let fs_root = match engine.wsl_distro() {
        Some(distro) => crate::wsl::host_fs_view(&distro, &workdir),
        None => PathBuf::from(workdir),
    };
    let site = artifact_preview_file(&fs_root, &path)?;
    let url = artifact_entry_url(&site)?;
    let root = site.root.clone();
    let _lane = PREVIEW_LANE.lock().await;
    *ARTIFACT_SITE.lock().map_err(|_| "预览资源状态锁损坏")? = Some(site);
    if let Err(error) = create_preview(app, url, bounds, Some(root)) {
        if let Ok(mut active) = ARTIFACT_SITE.lock() {
            *active = None;
        }
        return Err(error);
    }
    Ok(())
}
#[tauri::command]
pub async fn preview_show(app: AppHandle) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    webview(&app)?.show().map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn preview_hide(app: AppHandle) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    webview(&app)?.hide().map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn preview_set_bounds(app: AppHandle, bounds: PreviewBounds) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    let b = bounds.validate()?;
    let v = webview(&app)?;
    v.set_position(LogicalPosition::new(b.x, b.y))
        .map_err(|e| e.to_string())?;
    v.set_size(LogicalSize::new(b.width, b.height))
        .map_err(|e| e.to_string())?;
    apply_zoom(&v, preview_zoom()?)
}
#[tauri::command]
pub async fn preview_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    webview(&app)?
        .navigate(preview_url(&url)?)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn preview_reload(app: AppHandle) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    webview(&app)?.reload().map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn preview_set_zoom(app: AppHandle, scale: f64) -> Result<(), String> {
    if !scale.is_finite() || !(0.1..=5.0).contains(&scale) {
        return Err("缩放比例必须在 10% 到 500% 之间".into());
    }
    let _lane = PREVIEW_LANE.lock().await;
    *PREVIEW_ZOOM.lock().map_err(|_| "预览缩放状态锁损坏")? = scale;
    apply_zoom(&webview(&app)?, scale)
}
#[tauri::command]
pub async fn preview_destroy(app: AppHandle) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    #[cfg(debug_assertions)]
    eprintln!("[preview-lifecycle] destroy");
    PICKER_ACTIVE.store(false, Ordering::Relaxed);
    *ARTIFACT_SITE.lock().map_err(|_| "预览资源状态锁损坏")? = None;
    if let Some(v) = app.get_webview(LABEL) {
        v.close().map_err(|e| e.to_string())?
    }
    Ok(())
}
#[tauri::command]
pub async fn preview_result_show(
    app: AppHandle,
    data_url: String,
    status: String,
    comment_count: usize,
) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    if !data_url.starts_with("data:image/png;base64,")
        || data_url.len() > MAX_CAPTURE_BYTES * 4 / 3 + 64
        || status.chars().count() > 500
        || comment_count > 100_000
    {
        return Err("截图结果卡参数无效".into());
    }
    let card = PreviewResultCard {
        data_url: &data_url,
        status: &status,
        comment_count,
    };
    let data = serde_json::to_string(&card).map_err(|e| e.to_string())?;
    webview(&app)?
        .eval(format!(
            "{PREVIEW_RESULT_JS};window.__mcPreviewResultShow({data})"
        ))
        .map_err(|e| format!("显示截图结果卡失败: {e}"))
}

#[tauri::command]
pub async fn preview_result_hide(app: AppHandle) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    webview(&app)?
        .eval(format!(
            "{PREVIEW_RESULT_JS};window.__mcPreviewResultHide()"
        ))
        .map_err(|e| format!("隐藏截图结果卡失败: {e}"))
}

#[tauri::command]
pub async fn preview_picker_toggle(app: AppHandle, enabled: bool) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    let arg = serde_json::to_string(&enabled).unwrap();
    webview(&app)?
        .eval(format!("{PICKER_JS};window.__mcPicker.toggle({arg})"))
        .map_err(|e| e.to_string())?;
    PICKER_ACTIVE.store(enabled, Ordering::Relaxed);
    Ok(())
}
#[tauri::command]
pub async fn preview_element_apply(app: AppHandle, edit: ElementEdit) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    if !valid_selector(&edit.selector)
        || !(edit.property == "delete"
            || edit.property == "text"
            || [
                "color",
                "backgroundColor",
                "fontSize",
                "opacity",
                "width",
                "height",
                "justifyContent",
                "alignItems",
                "paddingTop",
                "paddingRight",
                "paddingBottom",
                "paddingLeft",
                "marginTop",
                "marginRight",
                "marginBottom",
                "marginLeft",
                "borderTopWidth",
                "borderRightWidth",
                "borderBottomWidth",
                "borderLeftWidth",
                "borderStyle",
                "borderColor",
                "borderRadius",
            ]
            .contains(&edit.property.as_str()))
        || if edit.property == "text" {
            !valid_text_value(&edit.value)
        } else if edit.property == "delete" {
            !edit.value.is_empty()
        } else {
            !valid_css_value(&edit.value)
        }
    {
        return Err("元素修改无效".into());
    }
    let json = serde_json::to_string(&edit).map_err(|e| e.to_string())?;
    webview(&app)?
        .eval(format!(
            "window.__mcPicker&&window.__mcPicker.apply({json})"
        ))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn preview_element_undo(app: AppHandle) -> Result<(), String> {
    let _lane = PREVIEW_LANE.lock().await;
    webview(&app)?
        .eval("window.__mcPicker&&window.__mcPicker.undoOne()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_serialize(app: AppHandle, request_id: String) -> Result<(), String> {
    if request_id.len() != 32 || !request_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("序列化请求 ID 无效".into());
    }
    let _lane = PREVIEW_LANE.lock().await;
    let id = serde_json::to_string(&request_id).unwrap();
    webview(&app)?
        .eval(format!("{SERIALIZE_JS};window.__mcSerialize({id})"))
        .map_err(|e| e.to_string())
}

fn safe_html_target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let p = Path::new(relative);
    let html_extension = p
        .extension()
        .and_then(|x| x.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm")
        });
    if p.is_absolute()
        || !html_extension
        || p.components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("请输入不含路径穿越的项目相对 .html/.htm 路径".into());
    }
    let root = root
        .canonicalize()
        .map_err(|e| format!("工作区无效: {e}"))?;
    let target = root.join(p);
    let parent = target.parent().ok_or("目标目录无效")?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("目标目录必须已存在: {e}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("目标路径超出工作区或经过符号链接".into());
    }
    let output = canonical_parent.join(target.file_name().unwrap());
    if output.exists() {
        let metadata =
            std::fs::symlink_metadata(&output).map_err(|e| format!("目标文件无效: {e}"))?;
        if metadata.file_type().is_symlink() {
            return Err("目标文件不能是符号链接".into());
        }
        let canonical_output = output
            .canonicalize()
            .map_err(|e| format!("目标文件无效: {e}"))?;
        if !canonical_output.starts_with(&root) {
            return Err("目标文件超出工作区".into());
        }
    }
    Ok(output)
}
#[tauri::command]
pub async fn preview_save_html(
    host: State<'_, DriverHost>,
    session_id: String,
    path: String,
    html: String,
) -> Result<(), String> {
    if html.len() > 8 * 1024 * 1024 {
        return Err("HTML 超过 8 MiB 限制".into());
    }
    let list = host.get()?.sessions_list().await?;
    let items = list
        .as_array()
        .or_else(|| list.get("sessions").and_then(|v| v.as_array()))
        .ok_or("无法读取会话列表")?;
    let workdir = items
        .iter()
        .find(|x| x.get("id").and_then(|v| v.as_str()) == Some(&session_id))
        .and_then(|x| x.get("workdir"))
        .and_then(|v| v.as_str())
        .ok_or("当前会话不存在")?;
    let target = safe_html_target(Path::new(workdir), &path)?;
    std::fs::write(target, html).map_err(|e| format!("保存 HTML 失败: {e}"))
}

#[cfg(target_os = "macos")]
mod native_capture {
    use super::{full_capture_size_plan, png_data_url, validate_capture_size, LABEL};
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::AnyObject, AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage,
    };
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use serde::Deserialize;
    use tauri::{AppHandle, Emitter, Manager};

    #[derive(Deserialize)]
    struct PageSize {
        width: f64,
        height: f64,
    }

    fn error_text(error: *mut NSError, fallback: &str) -> String {
        if error.is_null() {
            fallback.into()
        } else {
            // SAFETY: WebKit guarantees that NSError lives for the completion callback.
            unsafe { (&*error).localizedDescription().to_string() }
        }
    }

    fn emit_error(app: &AppHandle, request_id: &str, error: String) {
        let _ = app.emit_to(
            "main",
            "preview-capture-error",
            serde_json::json!({"requestId": request_id, "error": error}),
        );
    }

    fn image_data_url(image: &NSImage) -> Result<String, String> {
        let tiff = image
            .TIFFRepresentation()
            .ok_or("原生截图无法转换为 TIFF")?;
        let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)
            .ok_or("原生截图无法创建位图")?;
        let properties = NSDictionary::<NSBitmapImageRepPropertyKey, AnyObject>::dictionary();
        // SAFETY: The dictionary is empty and therefore contains no incorrectly typed values.
        let png = unsafe {
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
        }
        .ok_or("原生截图无法编码 PNG")?;
        png_data_url(&png.to_vec())
    }

    fn snapshot(
        view: Retained<WKWebView>,
        app: AppHandle,
        request_id: String,
        original_frame: Option<objc2_foundation::NSRect>,
        copy_to_clipboard: bool,
    ) {
        let mtm = MainThreadMarker::new().expect("WKWebView callback must run on the main thread");
        // SAFETY: construction occurs on the main thread required by WebKit.
        let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
        // WK requires the configured rect to be contained in the current view bounds.
        unsafe {
            configuration.setRect(view.bounds());
            configuration.setAfterScreenUpdates(true);
        }
        let restore_view = view.clone();
        let completion = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            if let Some(frame) = original_frame {
                restore_view.setFrame(frame);
            }
            if image.is_null() {
                emit_error(&app, &request_id, error_text(error, "WKWebView 未返回截图"));
                return;
            }
            // SAFETY: WebKit guarantees NSImage lives for the completion callback.
            let result = image_data_url(unsafe { &*image });
            match result {
                Ok(data_url) => {
                    let clipboard_error = copy_to_clipboard
                        .then(|| super::copy_capture_to_clipboard(&data_url))
                        .transpose()
                        .err()
                        .map(|error| {
                            eprintln!("design preview clipboard copy failed: {error}");
                            error
                        });
                    let _ = app.emit_to(
                        "main",
                        "preview-captured",
                        serde_json::json!({
                            "requestId": request_id,
                            "dataUrl": data_url,
                            "clipboardError": clipboard_error,
                        }),
                    );
                }
                Err(error) => emit_error(&app, &request_id, error),
            }
        });
        // SAFETY: view/configuration are valid main-thread WebKit objects; WebKit copies the block.
        unsafe {
            view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &completion);
        }
    }

    pub(super) fn start(app: AppHandle, mode: String, request_id: String) -> Result<(), String> {
        let copy_to_clipboard = mode != "viewport-no-copy";
        let Some(webview) = app.get_webview(LABEL) else {
            emit_error(&app, &request_id, "预览尚未创建".into());
            return Ok(());
        };
        let callback_app = app.clone();
        let dispatch_app = app.clone();
        let dispatch_id = request_id.clone();
        let result = webview.with_webview(move |platform| {
            // SAFETY: Tauri's macOS inner handle is the live WKWebView and this callback runs
            // on its main UI thread. Retaining it keeps it valid through async completions.
            let Some(view) = (unsafe {
                Retained::<WKWebView>::retain(platform.inner().cast::<WKWebView>())
            }) else {
                emit_error(&callback_app, &request_id, "无法获取 WKWebView".into());
                return;
            };
            if mode == "viewport" || mode == "viewport-no-copy" {
                let bounds = view.bounds();
                if let Err(error) = validate_capture_size(bounds.size.width, bounds.size.height) {
                    emit_error(&callback_app, &request_id, error);
                } else {
                    snapshot(view, callback_app, request_id, None, copy_to_clipboard);
                }
                return;
            }

            let size_view = view.clone();
            let size_app = callback_app.clone();
            let size_id = request_id.clone();
            let completion = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                if value.is_null() {
                    emit_error(
                        &size_app,
                        &size_id,
                        error_text(error, "无法读取完整页面尺寸"),
                    );
                    return;
                }
                // The script explicitly returns a JSON string.
                let raw = unsafe { &*(value.cast::<NSString>()) }.to_string();
                let size = match serde_json::from_str::<PageSize>(&raw) {
                    Ok(size) => size,
                    Err(error) => {
                        emit_error(
                            &size_app,
                            &size_id,
                            format!("完整页面尺寸格式无效: {error}"),
                        );
                        return;
                    }
                };
                let original = size_view.frame();
                let plan = match full_capture_size_plan(
                    (original.size.width, original.size.height),
                    (size.width, size.height),
                ) {
                    Ok(plan) => plan,
                    Err(error) => {
                        emit_error(&size_app, &size_id, error);
                        return;
                    }
                };
                let mut expanded = original;
                expanded.size.width = plan.capture.0;
                expanded.size.height = plan.capture.1;
                let mut restore = original;
                restore.size.width = plan.restore.0;
                restore.size.height = plan.restore.1;
                size_view.setFrame(expanded);
                snapshot(size_view.clone(), size_app.clone(), size_id.clone(), Some(restore), true);
            });
            let script = NSString::from_str(
                "JSON.stringify({width:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0,document.documentElement.clientWidth),height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0,document.documentElement.clientHeight)})",
            );
            // SAFETY: valid main-thread WebKit object and copied completion block.
            unsafe {
                view.evaluateJavaScript_completionHandler(&script, Some(&completion));
            }
        });
        if let Err(error) = result {
            emit_error(
                &dispatch_app,
                &dispatch_id,
                format!("启动 WKWebView 原生截图失败: {error}"),
            );
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn preview_capture(app: AppHandle, mode: String, request_id: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "viewport" | "viewport-no-copy" | "full")
        || request_id.len() != 32
        || !request_id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("截图参数无效".into());
    }
    let _lane = PREVIEW_LANE.lock().await;
    #[cfg(target_os = "macos")]
    {
        return native_capture::start(app, mode, request_id);
    }
    #[cfg(not(target_os = "macos"))]
    {
        captures()
            .lock()
            .map_err(|_| "截图状态锁损坏")?
            .remove(&request_id);
        let mode = serde_json::to_string(&mode).unwrap();
        let id = serde_json::to_string(&request_id).unwrap();
        let js = format!("{CAPTURE_JS};window.__mcPreviewCapture({mode},{id})");
        webview(&app)?
            .eval(js)
            .map_err(|e| format!("启动页面截图失败: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy() {
        assert!(preview_url("http://localhost:3000").is_ok());
        assert!(preview_url("https://localhost.evil").is_err());
    }
    /// Windows 入口桥接:路径已编码段原样保留,不二次编码。
    #[test]
    fn artifact_bridge_preserves_encoded_path() {
        let url = Url::parse("monkeycode-artifact://localhost/__workspace__/a%20b/index.html").unwrap();
        assert_eq!(
            bridged_artifact_url(&url).unwrap().as_str(),
            "http://monkeycode-artifact.localhost/__workspace__/a%20b/index.html"
        );
    }
    #[test]
    fn edit_validation() {
        assert!(valid_selector("#app > p"));
        assert!(!valid_selector("a\n"));
        assert!(valid_css_value("12px 4px"));
        assert!(!valid_css_value("red;display:none"));
        assert!(valid_text_value("line one\nline two; { ok }"));
        assert!(valid_text_value(&"x".repeat(32 * 1024)));
        assert!(!valid_text_value(&"x".repeat(32 * 1024 + 1)));
    }
    #[test]
    fn zoom_scales_the_fixed_canvas_including_responsive_images() {
        let script = zoom_script(0.75);
        assert!(script.contains("const target=document.body"));
        assert!(!script.contains("body.firstElementChild"));
        assert!(script.contains("set(target,'width',w+'px')"));
        assert!(script
            .contains("'transform','translateX('+offX+'px) translateY('+offY+'px) scale('+s+')'"));
        assert!(script.contains("set(target,'transform-origin','0 0')"));
        assert!(script.contains("Math.max(0,(w-cw*s)/2)"));
        assert!(script.contains("scroller.scrollLeft=Math.max(0,(cw*s-w)/2)"));
        assert!(script.contains("s=0.75"));
        assert!(
            script.contains("item.element.style.setProperty(item.name,item.value,item.priority)")
        );
    }
    #[test]
    fn capture_size_limit_and_png_data_url() {
        assert_eq!(
            validate_capture_size(10_000.0, 8_000.0).unwrap(),
            (10_000.0, 8_000.0)
        );
        assert!(validate_capture_size(10_001.0, 8_000.0).is_err());
        assert!(validate_capture_size(f64::NAN, 20.0).is_err());
        let plan = full_capture_size_plan((640.0, 480.0), (1200.2, 900.1)).unwrap();
        assert_eq!(plan.capture, (1201.0, 901.0));
        assert_eq!(plan.restore, (640.0, 480.0));
        assert!(png_data_url(b"not png").is_err());
        let png = b"\x89PNG\r\n\x1a\nbytes";
        let url = png_data_url(png).unwrap();
        let encoded = url.strip_prefix("data:image/png;base64,").unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap(),
            png
        );
    }
    #[test]
    fn capture_rejects_bad_id() {
        let u = Url::parse("monkeycode-capture://bad?index=0&total=1&data=x").unwrap();
        assert!(capture_result(&u).unwrap().is_err());
    }
    #[test]
    fn capture_preserves_clipboard_mode() {
        assert!(CAPTURE_JS.contains("mode==='viewport'||mode==='viewport-no-copy'"));
        let id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let no_copy = Url::parse(&format!(
            "monkeycode-capture://{id}?index=0&total=1&copy=0&data=x"
        ))
        .unwrap();
        assert_eq!(
            capture_result(&no_copy).unwrap().unwrap(),
            Some((id.into(), "x".into(), false))
        );
        let copy = Url::parse(&format!(
            "monkeycode-capture://{id}?index=0&total=1&copy=1&data=x"
        ))
        .unwrap();
        assert_eq!(
            capture_result(&copy).unwrap().unwrap(),
            Some((id.into(), "x".into(), true))
        );
    }
    #[test]
    fn serialization_rejects_bad_transport() {
        let u = Url::parse("monkeycode-serialize://bad?index=0&total=1&data=x").unwrap();
        assert!(serialize_result(&u).unwrap().is_err());
    }
    #[test]
    fn preview_result_action_is_strictly_whitelisted() {
        for action in ["download", "send", "close"] {
            let url = Url::parse(&format!("monkeycode-preview-result://{action}")).unwrap();
            assert_eq!(preview_result_action(&url), Some(action));
        }
        for raw in [
            "monkeycode-preview-result://open",
            "monkeycode-preview-result://copy/extra",
            "monkeycode-preview-result://copy?next=send",
            "https://copy/",
        ] {
            assert_eq!(preview_result_action(&Url::parse(raw).unwrap()), None);
        }
    }
    #[test]
    fn artifact_preview_serves_entry_directory_as_site_root() {
        let root =
            std::env::temp_dir().join(format!("monkeycode-preview-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dist = root.join("dist");
        std::fs::create_dir_all(dist.join("_expo/static/js/web")).unwrap();
        std::fs::write(
            dist.join("index.html"),
            r#"<script src="/_expo/static/js/web/index.js"></script>"#,
        )
        .unwrap();
        std::fs::write(
            dist.join("_expo/static/js/web/index.js"),
            "document.body.textContent='ready'",
        )
        .unwrap();
        std::fs::write(root.join("styles.css"), "body{}").unwrap();
        std::fs::write(root.join("index.txt"), "text").unwrap();

        let site = artifact_preview_file(&root, "dist/index.html").unwrap();
        let entry_url = artifact_entry_url(&site).unwrap();
        assert_eq!(site.root, dist.canonicalize().unwrap());
        assert_eq!(
            artifact_request_file(&site, entry_url.path()).unwrap(),
            dist.join("index.html").canonicalize().unwrap()
        );
        assert_eq!(
            artifact_request_file(
                &site,
                entry_url
                    .join("/_expo/static/js/web/index.js")
                    .unwrap()
                    .path()
            )
            .unwrap(),
            dist.join("_expo/static/js/web/index.js")
                .canonicalize()
                .unwrap()
        );
        assert_eq!(
            artifact_request_file(&site, entry_url.join("../styles.css").unwrap().path()).unwrap(),
            root.join("styles.css").canonicalize().unwrap()
        );
        assert_eq!(
            artifact_request_file(&site, "/../index.txt"),
            Err(StatusCode::BAD_REQUEST)
        );
        assert!(artifact_preview_file(&root, "../index.html").is_err());
        assert!(artifact_preview_file(&root, "index.txt").is_err());
        assert!(artifact_preview_file(&root, "/tmp/index.html").is_err());
        assert!(artifact_preview_file(&root, "missing.html").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn artifact_urls_accept_windows_custom_protocol_form() {
        assert!(is_artifact_url(
            &Url::parse("monkeycode-artifact://localhost/index.html").unwrap()
        ));
        assert!(is_artifact_url(
            &Url::parse("http://monkeycode-artifact.localhost/index.html").unwrap()
        ));
        assert!(!is_artifact_url(
            &Url::parse("http://monkeycode-artifact.localhost.example/index.html").unwrap()
        ));
    }

    #[test]
    fn artifact_response_allows_web_fonts() {
        let response = artifact_response(StatusCode::OK, Vec::new(), "font/ttf");
        assert_eq!(
            response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(&header::HeaderValue::from_static("*"))
        );
    }

    #[test]
    fn artifact_reader_rejects_oversized_files() {
        let path = std::env::temp_dir().join(format!(
            "monkeycode-preview-large-test-{}",
            std::process::id()
        ));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_ARTIFACT_RESOURCE_BYTES + 1).unwrap();
        assert_eq!(
            read_artifact_file(&path),
            Err(StatusCode::PAYLOAD_TOO_LARGE)
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn html_target_rejects_unsafe_paths() {
        let root = std::env::temp_dir();
        assert!(safe_html_target(&root, "index.html").is_ok());
        assert!(safe_html_target(&root, "index.htm").is_ok());
        assert!(safe_html_target(&root, "index.HTML").is_ok());
        assert!(safe_html_target(&root, "../index.html").is_err());
        assert!(safe_html_target(&root, "index.txt").is_err());
        assert!(safe_html_target(&root, "/tmp/index.html").is_err());
    }
}
