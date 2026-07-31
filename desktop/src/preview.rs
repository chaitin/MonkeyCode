use base64::Engine as _;
use crate::driver::DriverHost;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewBuilder,
    WebviewUrl,
};

const LABEL: &str = "design-preview";
const RESULT_SCHEME: &str = "monkeycode-picker";
const MAX_RESULT_BYTES: usize = 32 * 1024;
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
const MAX_CAPTURE_BYTES: usize = 24 * 1024 * 1024;
const MAX_CAPTURE_CHUNK: usize = 24 * 1024;
#[derive(Default)]
struct CaptureParts {
    total: usize,
    chunks: Vec<Option<String>>,
    bytes: usize,
}
static CAPTURES: OnceLock<Mutex<HashMap<String, CaptureParts>>> = OnceLock::new();
fn captures() -> &'static Mutex<HashMap<String, CaptureParts>> {
    CAPTURES.get_or_init(Default::default)
}

fn capture_result(url: &Url) -> Option<Result<Option<(String, String)>, String>> {
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
        total,
        chunks: vec![None; total],
        bytes: 0,
    });
    if p.total != total {
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
        all.remove(id);
        Some(Ok(Some((id.into(), joined))))
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
    let image = tauri::image::Image::from_bytes(&bytes)
        .map_err(|e| format!("截图读取失败: {e}"))?;
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

const CAPTURE_JS: &str = r#"(()=>{const send=(id,q)=>{location.href=`monkeycode-capture://${id}?${q}`};window.__mcPreviewCapture=async(mode,id)=>{try{const root=document.documentElement,body=document.body;const w=mode==='full'?Math.max(root.scrollWidth,body?.scrollWidth||0,root.clientWidth):innerWidth;const h=mode==='full'?Math.max(root.scrollHeight,body?.scrollHeight||0,root.clientHeight):innerHeight;if(w<1||h<1||w*h>80000000)throw Error('页面尺寸无效或超过 8000 万像素');const clone=root.cloneNode(true);const sourceCanvases=[...root.querySelectorAll('canvas')],clonedCanvases=[...clone.querySelectorAll('canvas')];for(let i=0;i<clonedCanvases.length;i++){const source=sourceCanvases[i],canvas=clonedCanvases[i];if(!source||!canvas)continue;const image=document.createElement('img');image.src=source.toDataURL('image/png');image.width=source.width;image.height=source.height;for(const attr of canvas.attributes)image.setAttribute(attr.name,attr.value);image.style.cssText=canvas.style.cssText;canvas.replaceWith(image)}clone.querySelectorAll('script').forEach(x=>x.remove());clone.setAttribute('xmlns','http://www.w3.org/1999/xhtml');if(mode==='viewport'){clone.style.width=`${w}px`;clone.style.height=`${h}px`;clone.style.overflow='hidden';const b=clone.querySelector('body');if(b)b.style.transform=`translate(${-scrollX}px,${-scrollY}px)`}const xml=new XMLSerializer().serializeToString(clone);const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;const img=new Image;await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(Error('页面含无法序列化的跨域资源'));img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');if(!ctx)throw Error('Canvas 不可用');ctx.drawImage(img,0,0);const png=c.toDataURL('image/png');const chunkSize=16000,total=Math.ceil(png.length/chunkSize);if(total<1||total>2048)throw Error('截图超过 24 MiB 限制');for(let i=0;i<total;i++){send(id,`index=${i}&total=${total}&data=${encodeURIComponent(png.slice(i*chunkSize,(i+1)*chunkSize))}`);await new Promise(ok=>setTimeout(ok,0))}}catch(e){send(id,`error=${encodeURIComponent(String(e?.message||e))}`)}}})()"#;

const PICKER_JS: &str = r#"(()=>{if(window.__mcPicker)return;const S=window.__mcPicker={active:false,hover:null,selected:null,undo:[]};const cssEscape=(s)=>window.CSS&&CSS.escape?CSS.escape(s):s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);const selector=(el)=>{if(el.id)return '#'+cssEscape(el.id);const parts=[];for(let n=el;n&&n.nodeType===1&&n!==document.documentElement;n=n.parentElement){let p=n.tagName.toLowerCase();if(n.classList.length)p+='.'+[...n.classList].slice(0,2).map(cssEscape).join('.');const peers=n.parentElement?[...n.parentElement.children].filter(x=>x.tagName===n.tagName):[];if(peers.length>1)p+=`:nth-of-type(${peers.indexOf(n)+1})`;parts.unshift(p);if(document.querySelectorAll(parts.join(' > ')).length===1)break}return parts.join(' > ')};const outline=(el,on)=>{if(!el)return;if(on){el.dataset.mcPickerOutline=el.style.outline;el.style.outline='2px solid #16b364';el.style.outlineOffset='-2px'}else{el.style.outline=el.dataset.mcPickerOutline||'';delete el.dataset.mcPickerOutline}};const pickTarget=(e)=>{const path=typeof e.composedPath==='function'?e.composedPath():[];const el=path.find(x=>x instanceof HTMLElement||x instanceof SVGElement);return el instanceof Element?el:e.target instanceof Element?e.target:null};addEventListener('pointerover',e=>{if(!S.active)return;outline(S.hover,false);S.hover=pickTarget(e);outline(S.hover,true)},true);addEventListener('click',e=>{if(!S.active)return;e.preventDefault();e.stopImmediatePropagation();outline(S.hover,false);S.active=false;S.selected=S.hover||pickTarget(e);const el=S.selected;if(!el)return;const r=el.getBoundingClientRect(),c=getComputedStyle(el);const data={selector:selector(el),text:(el.textContent||'').slice(0,16384),tag:el.tagName.toLowerCase(),bounds:{x:r.x,y:r.y,width:r.width,height:r.height},styles:{color:c.color,backgroundColor:c.backgroundColor,fontSize:c.fontSize,opacity:c.opacity,width:c.width,height:c.height,paddingTop:c.paddingTop,paddingRight:c.paddingRight,paddingBottom:c.paddingBottom,paddingLeft:c.paddingLeft,marginTop:c.marginTop,marginRight:c.marginRight,marginBottom:c.marginBottom,marginLeft:c.marginLeft,borderTopWidth:c.borderTopWidth,borderRightWidth:c.borderRightWidth,borderBottomWidth:c.borderBottomWidth,borderLeftWidth:c.borderLeftWidth,borderStyle:c.borderStyle,borderColor:c.borderColor,borderRadius:c.borderRadius}};location.href='monkeycode-picker://result?data='+encodeURIComponent(JSON.stringify(data))},true);S.toggle=(on)=>{S.active=on;outline(S.hover,false);S.hover=null;document.documentElement.style.cursor=on?'crosshair':''};S.apply=(edit)=>{const el=document.querySelector(edit.selector);if(!el)throw Error('元素已不存在');const prop=edit.property;if(prop==='delete'){const parent=el.parentNode,next=el.nextSibling;S.undo.push({el,prop,parent,next});el.remove();return}const before=prop==='text'?el.textContent:el.style[prop];S.undo.push({el,prop,before});if(prop==='text')el.textContent=edit.value;else el.style[prop]=edit.value};S.undoOne=()=>{const x=S.undo.pop();if(!x)return false;if(x.prop==='delete'){x.parent.insertBefore(x.el,x.next);return true}if(x.prop==='text')x.el.textContent=x.before;else x.el.style[x.prop]=x.before;return true}})()"#;

#[tauri::command]
pub fn preview_create(app: AppHandle, url: String, bounds: PreviewBounds) -> Result<(), String> {
    let url = preview_url(&url)?;
    let bounds = bounds.validate()?;
    if let Some(v) = app.get_webview(LABEL) {
        v.set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
        v.set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
        v.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let window = app.get_window("main").ok_or("主窗口不存在")?;
    let callback_app = app.clone();
    let view = window
        .add_child(
            WebviewBuilder::new(LABEL, WebviewUrl::External(url))
                .on_navigation(move |url| {
                    if let Some(result) = serialize_result(url) {
                        match result { Ok(Some((request_id, html))) => { let _=callback_app.emit_to("main","preview-serialized",serde_json::json!({"requestId":request_id,"html":html})); }, Ok(None)=>{}, Err(error)=>{let _=callback_app.emit_to("main","preview-serialized-error",serde_json::json!({"requestId":url.host_str().unwrap_or(""),"error":error}));} }
                        false
                    } else if let Some(result) = capture_result(url) {
                        match result {
                            Ok(Some((request_id, data_url))) => {
                                let clipboard_error = copy_capture_to_clipboard(&data_url).err();
                                let _ = callback_app.emit_to(
                                    "main",
                                    "preview-captured",
                                    serde_json::json!({"requestId":request_id,"dataUrl":data_url,"clipboardError":clipboard_error}),
                                );
                            }
                            Ok(None) => {}
                            Err(error) => {
                                let _ = callback_app.emit_to("main", "preview-capture-error", serde_json::json!({"requestId":url.host_str().unwrap_or(""),"error":error}));
                            }
                        }
                        false
                    } else if let Some(result) = picker_result(url) {
                        match result {
                            Ok(snapshot) => {
                                let _ = callback_app.emit_to("main", "preview-element-picked", snapshot);
                            }
                            Err(error) => {
                                let _ = callback_app.emit_to("main", "preview-picker-error", error);
                            }
                        }
                        false
                    } else {
                        is_preview_url(url)
                    }
                })
                .on_page_load(|webview, _| {
                    let _ = webview.eval(PICKER_JS);
                    let _ = webview.eval(CAPTURE_JS);
                    let _ = webview.eval(SERIALIZE_JS);
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
pub fn preview_show(app: AppHandle) -> Result<(), String> {
    webview(&app)?.show().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn preview_hide(app: AppHandle) -> Result<(), String> {
    webview(&app)?.hide().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn preview_set_bounds(app: AppHandle, bounds: PreviewBounds) -> Result<(), String> {
    let b = bounds.validate()?;
    let v = webview(&app)?;
    v.set_position(LogicalPosition::new(b.x, b.y))
        .map_err(|e| e.to_string())?;
    v.set_size(LogicalSize::new(b.width, b.height))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn preview_navigate(app: AppHandle, url: String) -> Result<(), String> {
    webview(&app)?
        .navigate(preview_url(&url)?)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn preview_reload(app: AppHandle) -> Result<(), String> {
    webview(&app)?.reload().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn preview_set_zoom(app: AppHandle, scale: f64) -> Result<(), String> {
    if !scale.is_finite() || !(0.1..=5.0).contains(&scale) {
        return Err("缩放比例必须在 10% 到 500% 之间".into());
    }
    webview(&app)?
        .eval(format!(
            "(()=>{{const target=document.getElementById('root')||document.body.firstElementChild||document.body;if(!target)throw new Error('找不到页面根元素');const root=document.documentElement,body=document.body,w=root.clientWidth,h=root.clientHeight,s={scale};target.style.setProperty('width',w+'px','important');target.style.setProperty('min-height',h+'px','important');target.style.setProperty('transform','scale('+s+')','important');target.style.setProperty('transform-origin','0 0','important');target.style.setProperty('margin-left',(s<1?(w-w*s)/2:0)+'px','important');body.style.setProperty('width',Math.max(w,w*s)+'px','important');body.style.setProperty('min-height',Math.max(h,h*s)+'px','important');body.style.setProperty('overflow','visible','important');root.style.setProperty('overflow','auto','important');target.dataset.mcZoom=String(s)}})()"
        ))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn preview_destroy(app: AppHandle) -> Result<(), String> {
    if let Some(v) = app.get_webview(LABEL) {
        v.close().map_err(|e| e.to_string())?
    }
    Ok(())
}
#[tauri::command]
pub fn preview_picker_toggle(app: AppHandle, enabled: bool) -> Result<(), String> {
    let arg = serde_json::to_string(&enabled).unwrap();
    webview(&app)?
        .eval(format!("{PICKER_JS};window.__mcPicker.toggle({arg})"))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn preview_element_apply(app: AppHandle, edit: ElementEdit) -> Result<(), String> {
    if !valid_selector(&edit.selector)
        || !(edit.property == "delete"
            || edit.property == "text"
            || [
                "color", "backgroundColor", "fontSize", "opacity", "width", "height",
                "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
                "marginTop", "marginRight", "marginBottom", "marginLeft",
                "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
                "borderStyle", "borderColor", "borderRadius",
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
pub fn preview_element_undo(app: AppHandle) -> Result<(), String> {
    webview(&app)?
        .eval("window.__mcPicker&&window.__mcPicker.undoOne()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_serialize(app: AppHandle, request_id: String) -> Result<(), String> {
    if request_id.len() != 32 || !request_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("序列化请求 ID 无效".into());
    }
    let id = serde_json::to_string(&request_id).unwrap();
    webview(&app)?
        .eval(format!("{SERIALIZE_JS};window.__mcSerialize({id})"))
        .map_err(|e| e.to_string())
}

fn safe_html_target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let p = Path::new(relative);
    if p.is_absolute()
        || p.extension().and_then(|x| x.to_str()) != Some("html")
        || p.components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("请输入不含路径穿越的项目相对 .html 路径".into());
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

#[tauri::command]
pub fn preview_capture(app: AppHandle, mode: String, request_id: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "viewport" | "full")
        || request_id.len() != 32
        || !request_id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("截图参数无效".into());
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy() {
        assert!(preview_url("http://localhost:3000").is_ok());
        assert!(preview_url("https://localhost.evil").is_err());
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
    fn capture_rejects_bad_id() {
        let u = Url::parse("monkeycode-capture://bad?index=0&total=1&data=x").unwrap();
        assert!(capture_result(&u).unwrap().is_err());
    }
    #[test]
    fn serialization_rejects_bad_transport() {
        let u = Url::parse("monkeycode-serialize://bad?index=0&total=1&data=x").unwrap();
        assert!(serialize_result(&u).unwrap().is_err());
    }
    #[test]
    fn html_target_rejects_unsafe_paths() {
        let root = std::env::temp_dir();
        assert!(safe_html_target(&root, "index.html").is_ok());
        assert!(safe_html_target(&root, "../index.html").is_err());
        assert!(safe_html_target(&root, "index.txt").is_err());
        assert!(safe_html_target(&root, "/tmp/index.html").is_err());
    }
}
