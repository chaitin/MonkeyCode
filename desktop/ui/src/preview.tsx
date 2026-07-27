import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from "react";
import {
  inDesktopShell,
  previewCreate,
  previewDestroy,
  previewHide,
  previewNavigate,
  previewReload,
  previewSetBounds,
  previewShow,
  onPreviewElementPicked,
  onPreviewPickerError,
  previewElementApply,
  previewElementUndo,
  previewPickerToggle,
  previewCapture, onPreviewCaptured, onPreviewCaptureError,
  previewSerialize, onPreviewSerializedAsync, onPreviewSerializedErrorAsync, previewSaveHtml,
  type PreviewCaptureMode,
  type ElementEdit,
  type ElementSnapshot,
  type PreviewBounds,
} from "./host";

const DEFAULT_URL = "http://localhost:3000";
type Viewport = "desktop" | "tablet" | "mobile";
const widths: Record<Viewport, number | undefined> = { desktop: undefined, tablet: 768, mobile: 390 };

type Mark = { kind: "rect"; x: number; y: number; w: number; h: number } | { kind: "pen"; points: [number, number][] } | { kind: "text"; x: number; y: number; text: string; commentId: string };
export type PreviewComment = { id: string; text: string; x: number; y: number; selector?: string };
export type AnnotatedPreview = { blob: Blob; file: File; comments: PreviewComment[]; width: number; height: number };


type IconName = "arrow" | "check" | "close" | "desktop" | "download" | "edit" | "external" | "globe" | "image" | "mobile" | "more" | "pen" | "refresh" | "rect" | "save" | "send" | "tablet" | "text" | "trash" | "undo";

function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="m9 18 6-6-6-6"/><path d="M4 12h11"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
    desktop: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></>,
    edit: <><path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z"/></>,
    external: <><path d="M14 3h7v7"/><path d="m10 14 11-11"/><path d="M18 13v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h7"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/></>,
    mobile: <><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    pen: <><path d="m4 20 4-1 11-11-3-3L5 16Z"/><path d="m14 7 3 3"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 5"/></>,
    rect: <rect x="4" y="5" width="16" height="14" rx="1"/>,
    save: <><path d="M5 3h12l3 3v15H4V4a1 1 0 0 1 1-1Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    tablet: <><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/></>,
    text: <><path d="M5 5h14M12 5v14M8 19h8"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    undo: <><path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/></>,
  };
  return <svg className="preview-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function IconButton({ icon, label, className = "", ...props }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`preview-icon-button ${className}`} aria-label={label} title={label} {...props}><Icon name={icon}/></button>;
}

function AnnotationSurface({ src, selected, onCancel, onReady }: { src: string; selected: ElementSnapshot | null; onCancel: () => void; onReady: (result: AnnotatedPreview) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), image = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<"rect" | "pen" | "text">("rect"), [marks, setMarks] = useState<Mark[]>([]), [comments, setComments] = useState<PreviewComment[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const drawing = useRef<Extract<Mark, { kind: "rect" | "pen" }> | null>(null);
  const paint = () => { const c=canvas.current,img=image.current;if(!c||!img)return;const g=c.getContext("2d");if(!g)return;g.clearRect(0,0,c.width,c.height);g.drawImage(img,0,0);g.strokeStyle="#ef4444";g.fillStyle="#ef4444";g.lineWidth=Math.max(2,c.width/500);g.font=`${Math.max(14,c.width/60)}px sans-serif`;for(const m of marks){if(m.kind==="rect")g.strokeRect(m.x,m.y,m.w,m.h);else if(m.kind==="text")g.fillText(m.text,m.x,m.y);else{g.beginPath();m.points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.stroke()}} };
  useEffect(()=>{setImageLoaded(false);const img=new Image;img.onload=()=>{image.current=img;const c=canvas.current;if(c){c.width=img.naturalWidth;c.height=img.naturalHeight;paint();setImageLoaded(true)}};img.onerror=()=>onCancel();img.src=src},[src]);
  useEffect(paint,[marks]);
  const point=(e:React.PointerEvent<HTMLCanvasElement>):[number,number]=>{const c=e.currentTarget,r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]};
  const down=(e:React.PointerEvent<HTMLCanvasElement>)=>{e.currentTarget.setPointerCapture(e.pointerId);const [x,y]=point(e);if(tool==="text"){const text=prompt("输入标注/评论")?.trim();if(text){const commentId=crypto.randomUUID();setMarks(v=>[...v,{kind:"text",x,y,text,commentId}]);setComments(v=>[...v,{id:commentId,text,x:x/(canvas.current?.width||1),y:y/(canvas.current?.height||1),selector:selected?.selector}])}return}drawing.current=tool==="rect"?{kind:"rect",x,y,w:0,h:0}:{kind:"pen",points:[[x,y]]}};
  const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{const m=drawing.current;if(!m)return;const [x,y]=point(e);if(m.kind==="rect"){m.w=x-m.x;m.h=y-m.y}else m.points.push([x,y]);paint();const c=canvas.current,g=c?.getContext("2d");if(!g)return;g.strokeStyle="#ef4444";g.lineWidth=Math.max(2,(c?.width||500)/500);if(m.kind==="rect")g.strokeRect(m.x,m.y,m.w,m.h);else{g.beginPath();m.points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.stroke()}};
  const up=()=>{if(drawing.current){setMarks(v=>[...v,drawing.current!]);drawing.current=null}};
  const undoMark=()=>setMarks(v=>{const removed=v[v.length-1];if(removed?.kind==="text")setComments(c=>c.filter(x=>x.id!==removed.commentId));return v.slice(0,-1)});
  const produce=async()=>{const c=canvas.current;if(!c)return;const blob=await new Promise<Blob|null>(ok=>c.toBlob(ok,"image/png"));if(blob)onReady({blob,file:new File([blob],"annotated-preview.png",{type:"image/png"}),comments,width:c.width,height:c.height})};
  return <div className="preview-annotation">
    <div className="preview-annotation-tools" role="toolbar" aria-label="截图标注工具">
      <div className="preview-tool-group">
        <IconButton icon="rect" label="矩形标注" className={tool === "rect" ? "active" : ""} onClick={() => setTool("rect")}/>
        <IconButton icon="pen" label="画笔标注" className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")}/>
        <IconButton icon="text" label="添加文字或评论" className={tool === "text" ? "active" : ""} onClick={() => setTool("text")}/>
      </div>
      <div className="preview-tool-divider"/>
      <IconButton icon="undo" label="撤销标注" onClick={undoMark} disabled={!marks.length}/>
      <IconButton icon="trash" label="清空标注" onClick={() => { setMarks([]); setComments([]); }}/>
      <span className="preview-comment-count">{comments.length} 条评论</span>
      <button type="button" className="preview-annotation-cancel" onClick={onCancel}>取消</button>
      <button type="button" className="preview-annotation-done" disabled={!imageLoaded} onClick={() => void produce()}><Icon name="check"/>生成 PNG</button>
    </div>
    <div className="preview-canvas-scroll"><canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}/></div>
  </div>;
}

export function DesignPreview({
  children,
  sessionId,
  suggestedUrl,
  open,
  obscured,
  onClose,
  onSendAgent,
}: {
  children: ReactNode;
  sessionId: string | null;
  suggestedUrl: string | null;
  open: boolean;
  obscured: boolean;
  onClose: () => void;
  onSendAgent: (files: File[], prompt: string) => Promise<void>;
}) {
  const initialUrl = suggestedUrl ?? DEFAULT_URL;
  const [url, setUrl] = useState(initialUrl);
  const [draft, setDraft] = useState(initialUrl);
  const [error, setError] = useState("");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [paneWidth, setPaneWidth] = useState(48);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<ElementSnapshot | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const [capture, setCapture] = useState<{ requestId: string; dataUrl?: string } | null>(null);
  const [annotatedPreview, setAnnotatedPreview] = useState<AnnotatedPreview | null>(null);
  const [edits, setEdits] = useState<Array<{selector:string;property:string;before:string;after:string}>>([]);
  const [htmlPath, setHtmlPath] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const created = useRef(false);
  const generation = useRef(0);
  const dragging = useRef(false);
  const stopDragging = useRef<() => void>(() => {});
  const shell = inDesktopShell();

  const bounds = (): PreviewBounds | null => {
    const rect = slotRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };

  useLayoutEffect(() => {
    if (!open || !shell) return;
    const currentGeneration = ++generation.current;
    const sync = async () => {
      const next = bounds();
      if (!next || generation.current !== currentGeneration) return;
      try {
        if (!created.current) {
          await previewCreate(url, next);
          if (generation.current !== currentGeneration) {
            await previewDestroy();
            return;
          }
          created.current = true;
        } else {
          await previewSetBounds(next);
        }
        if (generation.current !== currentGeneration) return;
        if (obscured || dragging.current || menuOpen || !!capture || !!annotatedPreview) await previewHide();
        else await previewShow();
        if (generation.current === currentGeneration) setError("");
      } catch (e) {
        if (generation.current === currentGeneration) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    const ro = new ResizeObserver(() => void sync());
    if (slotRef.current) ro.observe(slotRef.current);
    window.addEventListener("resize", sync);
    void sync();
    return () => {
      if (generation.current === currentGeneration) generation.current += 1;
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [open, shell, paneWidth, viewport, obscured, menuOpen, !!capture, !!annotatedPreview]);

  useEffect(() => {
    const nextUrl = suggestedUrl ?? DEFAULT_URL;
    setUrl(nextUrl);
    setDraft(nextUrl);
    setError("");
    setViewport("desktop");
    setMenuOpen(false);
  }, [sessionId]);

  useEffect(() => {
    if (!suggestedUrl || suggestedUrl === url) return;
    setUrl(suggestedUrl);
    setDraft(suggestedUrl);
    setPicking(false);
    setSelected(null);
    setUndoCount(0);
    setEdits([]);
    if (open && shell && created.current) {
      void previewNavigate(suggestedUrl).then(() => setError("")).catch((e) => setError(String(e)));
    }
  }, [suggestedUrl]);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !(target instanceof Element && target.closest("#preview-overflow-menu"))) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (open || !shell) return;
    created.current = false;
    void previewDestroy().catch(() => {});
  }, [open, shell]);

  useEffect(
    () => () => {
      generation.current += 1;
      stopDragging.current();
      created.current = false;
      if (shell) void previewDestroy().catch(() => {});
    },
    [shell],
  );

  useEffect(() => {
    if (!shell) return;
    const offPicked = onPreviewElementPicked((snapshot) => { setSelected(snapshot); setPicking(false); });
    const offError = onPreviewPickerError(setError);
    const offCapture = onPreviewCaptured((value) => { setCapture((x) => x?.requestId === value.requestId ? value : x); setError(""); });
    const offCaptureError = onPreviewCaptureError((value) => { setCapture((current) => { if (current?.requestId !== value.requestId) return current; setError(value.error); if (!obscured) void previewShow().catch(()=>{}); return null; }); });
    return () => { offPicked(); offError(); offCapture(); offCaptureError(); };
  }, [shell, obscured]);

  const resetPageState = () => { setPicking(false); setSelected(null); setUndoCount(0); setEdits([]); };
  const togglePicker = async () => {
    const next = !picking;
    try { await previewPickerToggle(next); setPicking(next); }
    catch (e) { setError(String(e)); }
  };
  const applyEdit = async (property: ElementEdit["property"], value: string) => {
    if (!selected) return;
    try {
      const target = selected;
      const before=property === "text" ? target.text : target.styles[property];
      setSelected((current) => current ? property === "text" ? { ...current, text: value } : { ...current, styles: { ...current.styles, [property]: value } } : current);
      await previewElementApply({ selector: target.selector, property, value });
      setEdits(v=>[...v,{selector:target.selector,property,before,after:value}]);
      setUndoCount((n) => n + 1);
      setError("");
    } catch (e) {
      setSelected((current) => {
        if (!current || current.selector !== selected.selector) return current;
        if (property === "text" && current.text === value) return { ...current, text: selected.text };
        if (property !== "text" && current.styles[property] === value) return { ...current, styles: { ...current.styles, [property]: selected.styles[property] } };
        return current;
      });
      setError(String(e));
    }
  };
  const undo = async () => {
    const reverted = edits[edits.length - 1];
    try {
      await previewElementUndo();
      setUndoCount((n) => Math.max(0, n - 1));
      setEdits((current) => current.slice(0, -1));
      if (reverted) {
        setSelected((current) => {
          if (!current || current.selector !== reverted.selector) return current;
          if (reverted.property === "text") return { ...current, text: reverted.before };
          return { ...current, styles: { ...current.styles, [reverted.property]: reverted.before } };
        });
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const beginCapture = async (mode: PreviewCaptureMode) => { const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,"0")).join("");try{setAnnotatedPreview(null);setCapture({requestId});setError("");await previewCapture(mode,requestId);await previewHide()}catch(e){setCapture(null);setError(String(e));if (!obscured) void previewShow().catch(()=>{})} };
  const cancelCapture = () => { setCapture(null); if (!obscured) void previewShow().catch((e)=>setError(String(e))); };

  const dismissAnnotatedPreview = () => {
    setAnnotatedPreview(null);
    if (!obscured && shell) void previewShow().catch((e) => setError(String(e)));
  };

  const navigate = async (e: FormEvent) => {
    e.preventDefault();
    if (!shell) return;
    const nextUrl = /^https?:\/\//i.test(draft.trim()) ? draft.trim() : `http://${draft.trim()}`;
    try {
      await previewNavigate(nextUrl);
      setUrl(nextUrl);
      setDraft(nextUrl);
      resetPageState();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const close = async () => {
    generation.current += 1;
    if (shell && created.current) {
      try {
        await previewDestroy();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    created.current = false;
    onClose();
  };

  const startResize = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    if (shell && created.current) void previewHide().catch(() => {});
    const move = (event: PointerEvent) => {
      const root = rootRef.current?.getBoundingClientRect();
      if (!root) return;
      setPaneWidth(Math.max(30, Math.min(70, ((root.right - event.clientX) / root.width) * 100)));
    };
    const removeListeners = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      stopDragging.current = () => {};
    };
    const up = () => {
      dragging.current = false;
      removeListeners();
      requestAnimationFrame(() => {
        const next = bounds();
        if (!shell || !created.current || !next) return;
        void previewSetBounds(next)
          .then(() => (obscured ? previewHide() : previewShow()))
          .catch((err) => setError(err instanceof Error ? err.message : String(err)));
      });
    };
    stopDragging.current = () => {
      dragging.current = false;
      removeListeners();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const download=(blob:Blob,name:string)=>{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
  const artifacts=()=>{const comments=annotatedPreview?.comments??[];const json=JSON.stringify({url,selectors:[...new Set(edits.map(x=>x.selector))],edits,comments},null,2);const report=`# 设计反馈\n\n- URL: ${url}\n\n## 元素修改\n${edits.map(x=>`- \`${x.selector}\` ${x.property}: \`${x.before}\` → \`${x.after}\``).join("\n")||"无"}\n\n## 评论\n${comments.map(x=>`- ${x.text} (${x.selector||"无选择器"}, ${x.x.toFixed(3)}, ${x.y.toFixed(3)})`).join("\n")||"无"}\n`;return{json,report,comments}};
  const saveHtml=async()=>{if(!sessionId)return;const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,"0")).join("");let offSuccess=()=>{},offError=()=>{};const cleanup=()=>{offSuccess();offError()};try{offSuccess=await onPreviewSerializedAsync(v=>{if(v.requestId!==requestId)return;cleanup();void previewSaveHtml(sessionId,htmlPath,v.html).then(()=>setError("HTML 已保存")).catch(e=>setError(String(e)))});offError=await onPreviewSerializedErrorAsync(v=>{if(v.requestId!==requestId)return;cleanup();setError(v.error)});await previewSerialize(requestId)}catch(e){cleanup();setError(String(e))}};

  return (
    <div ref={rootRef} className="preview-root">
      <div className="preview-host-pane" style={{ flex: open ? `1 1 ${100 - paneWidth}%` : "1" }}>{children}</div>
      {open && (
        <>
          <div className="preview-divider" onPointerDown={startResize}/>
          <section className="preview-pane" style={{ width: `${paneWidth}%` }}>
            <header className="preview-toolbar" role="toolbar" aria-label="设计预览工具栏">
              <form className="preview-address" onSubmit={navigate}>
                <Icon name="globe" size={14}/>
                <input aria-label="预览地址" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}/>
                <IconButton icon="arrow" label="打开地址" type="submit"/>
              </form>
              <div className="preview-tool-group preview-viewport-control" aria-label="视口尺寸">
                {(["desktop", "tablet", "mobile"] as Viewport[]).map((item) => {
                  const label = item === "desktop" ? "桌面视口" : item === "tablet" ? "平板视口" : "手机视口";
                  return <IconButton key={item} icon={item} label={label} className={viewport === item ? "active" : ""} aria-pressed={viewport === item} onClick={() => setViewport(item)}/>;
                })}
              </div>
              <div className="preview-tool-group">
                <IconButton icon="edit" label={picking ? "停止检查元素" : "检查并编辑元素"} className={picking ? "active" : ""} onClick={() => void togglePicker()} disabled={!shell}/>
                <IconButton icon="image" label="截取当前视口" onClick={() => void beginCapture("viewport")} disabled={!shell || !!capture}/>
                <IconButton icon="undo" label={undoCount ? `撤销修改（${undoCount}）` : "撤销修改"} onClick={() => void undo()} disabled={!shell || undoCount === 0}/>
              </div>
              <span className="preview-zoom" title="当前缩放比例" aria-label="当前缩放比例 100%">100%</span>
              <IconButton icon="refresh" label="刷新预览" onClick={() => void previewReload().then(() => { resetPageState(); setError(""); }).catch((e) => setError(String(e)))} disabled={!shell}/>
              <div className="preview-menu-anchor" ref={menuRef}>
                <IconButton icon="more" label="更多预览操作" className={menuOpen ? "active" : ""} aria-expanded={menuOpen} aria-controls="preview-overflow-menu" onClick={() => setMenuOpen((value) => !value)}/>
              </div>
              <IconButton icon="close" label="关闭设计预览" className="preview-close" onClick={close}/>
            </header>
            {menuOpen && (
              <div id="preview-overflow-menu" className="preview-overflow-panel" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void beginCapture("full"); }} disabled={!shell || !!capture}><Icon name="image"/>截取整页</button>
                {annotatedPreview && <>
                  <button type="button" role="menuitem" onClick={() => { download(annotatedPreview.blob, "annotated-preview.png"); setMenuOpen(false); }}><Icon name="download"/>导出 PNG</button>
                  <button type="button" role="menuitem" onClick={() => { download(new Blob([artifacts().json], { type: "application/json" }), "design-comments.json"); setMenuOpen(false); }}><Icon name="download"/>导出 JSON</button>
                  <button type="button" role="menuitem" onClick={() => { download(new Blob([artifacts().report], { type: "text/markdown" }), "design-feedback.md"); setMenuOpen(false); }}><Icon name="download"/>导出报告</button>
                </>}
                <div className="preview-save-html">
                  <Icon name="save"/>
                  <input aria-label="HTML 保存路径" placeholder="public/preview.html" value={htmlPath} onChange={(e) => setHtmlPath(e.target.value)}/>
                  <button type="button" title="保存 HTML" aria-label="保存 HTML" disabled={!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.html$/.test(htmlPath) || !sessionId} onClick={() => { saveHtml(); setMenuOpen(false); }}><Icon name="arrow"/></button>
                </div>
              </div>
            )}
            {error && <div className="preview-error" role="status">{error}</div>}
            <div className="preview-workspace">
              <div className="preview-viewport-wrap">
                <div ref={slotRef} className="preview-slot" style={{ width: widths[viewport] ? `min(100%, ${widths[viewport]}px)` : "100%" }}>
                  {capture?.dataUrl && <AnnotationSurface src={capture.dataUrl} selected={selected} onCancel={cancelCapture} onReady={(result) => { setAnnotatedPreview(result); setCapture(null); }}/>}
                  {annotatedPreview && !capture && (
                    <div className="preview-annotation-ready">
                      <div className="preview-result-copy"><Icon name="check"/><span><strong>标注已就绪</strong>{annotatedPreview.comments.length} 条评论</span></div>
                      <IconButton icon="download" label="导出标注 PNG" onClick={() => download(annotatedPreview.blob, "annotated-preview.png")}/>
                      <button type="button" className="preview-send-agent" disabled={sending} onClick={async () => { const a = artifacts(); const files = [annotatedPreview.file, new File([a.json], "design-comments.json", { type: "application/json" }), new File([a.report], "design-feedback.md", { type: "text/markdown" })]; setSending(true); setSendStatus(""); try { await onSendAgent(files, `请根据以下设计预览反馈修改项目。\nURL: ${url}\n选择器: ${[...new Set(edits.map(x => x.selector))].join(", ") || "无"}\n元素修改: ${JSON.stringify(edits)}\n评论: ${JSON.stringify(a.comments)}\n附件路径将在本消息中列出：annotated-preview.png、design-comments.json、design-feedback.md。`); setSendStatus("已发送给 Agent"); } catch (e) { setSendStatus(`发送失败：${String(e)}`); } finally { setSending(false); } }}><Icon name="send"/>{sending ? "发送中…" : "发送 Agent"}</button>
                      {sendStatus && <span role="status">{sendStatus}</span>}
                      <IconButton icon="close" label="关闭标注结果" onClick={dismissAnnotatedPreview}/>
                    </div>
                  )}
                  {!shell && (
                    <div className="preview-empty">
                      <strong>设计预览需要桌面应用</strong>
                      <span>浏览器模式不会创建原生预览窗口。</span>
                      <code>{url}</code>
                    </div>
                  )}
                </div>
              </div>
              {selected && (
                <aside className="preview-inspector" aria-label="元素检查器">
                  <div className="preview-inspector-header">
                    <div><span>元素检查器</span><strong>{selected.tag}</strong></div>
                    <IconButton icon="close" label="关闭元素检查器" onClick={() => setSelected(null)}/>
                  </div>
                  <div className="preview-selection">
                    <code title={selected.selector}>{selected.selector}</code>
                    <span>{Math.round(selected.bounds.width)} × {Math.round(selected.bounds.height)}</span>
                  </div>
                  <div className="preview-inspector-fields">
                    <label className="preview-text-field"><span>文本内容</span><textarea value={selected.text} onChange={(e) => { void applyEdit("text", e.target.value); }}/></label>
                    {([
                      ["颜色", "color"], ["背景", "backgroundColor"], ["字号", "fontSize"],
                      ["内边距", "padding"], ["外边距", "margin"], ["圆角", "borderRadius"],
                    ] as const).map(([label, property]) => <label key={property}><span>{label}</span><input value={selected.styles[property]} onChange={(e) => { void applyEdit(property, e.target.value); }}/></label>)}
                  </div>
                </aside>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
