import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from "react";
import {
  inDesktopShell,
  openExternal,
  previewCreate,
  previewDestroy,
  previewHide,
  previewNavigate,
  previewReload,
  previewSetZoom,
  previewSetBounds,
  previewShow,
  onPreviewElementPicked,
  onPreviewPickerError,
  previewElementApply,
  previewElementUndo,
  previewPickerToggle,
  previewCapture, onPreviewCaptured, onPreviewCaptureError,
  previewSerialize, onPreviewSerializedAsync, onPreviewSerializedErrorAsync,
  type PreviewCaptureMode,
  type ElementEdit,
  type ElementSnapshot,
  type PreviewBounds,
} from "./host";

const DEFAULT_URL = "http://localhost:3000";
type Viewport = "desktop" | "tablet" | "mobile";
const viewportSizes: Record<Viewport, { width?: number; height?: number }> = {
  desktop: {},
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};

type Mark = { kind: "rect"; x: number; y: number; w: number; h: number } | { kind: "pen"; points: [number, number][] } | { kind: "text"; x: number; y: number; text: string; commentId: string };
export type PreviewComment = { id: string; text: string; x: number; y: number; selector?: string };
export type AnnotatedPreview = { blob: Blob; file: File; comments: PreviewComment[]; width: number; height: number };


type IconName = "arrow" | "check" | "close" | "code" | "comment" | "demo" | "desktop" | "download" | "edit" | "external" | "globe" | "image" | "mobile" | "more" | "pen" | "refresh" | "rect" | "save" | "send" | "tablet" | "text" | "trash" | "undo";

function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="m9 18 6-6-6-6"/><path d="M4 12h11"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
    code: <><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m14 5-4 14"/></>,
    comment: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 10h8M8 14h5"/></>,
    demo: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m10 8 5 3-5 3Z"/><path d="M9 22h6M12 18v4"/></>,
    desktop: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></>,
    edit: <><path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z"/></>,
    external: <><path d="M14 3h7v7"/><path d="m10 14 11-11"/><path d="M18 13v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h7"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    image: <><path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><rect x="8" y="9" width="8" height="7" rx="1"/><path d="m9.5 14 2-2 1.5 1.5 1-1 1.5 1.5"/></>,
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

function AnnotationSurface({ src, selected, onCancel, onSend }: { src: string; selected: ElementSnapshot | null; onCancel: () => void; onSend: (result: AnnotatedPreview, prompt: string) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null), image = useRef<HTMLImageElement | null>(null), textInput = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<"rect" | "pen" | "text">("rect"), [marks, setMarks] = useState<Mark[]>([]), [comments, setComments] = useState<PreviewComment[]>([]);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const [message, setMessage] = useState(""), [sending, setSending] = useState(false), [sendError, setSendError] = useState("");
  const drawing = useRef<Extract<Mark, { kind: "rect" | "pen" }> | null>(null);
  const cancelText = useRef(false);
  const paint = () => { const c=canvas.current,img=image.current;if(!c||!img)return;const g=c.getContext("2d");if(!g)return;g.clearRect(0,0,c.width,c.height);g.drawImage(img,0,0);g.strokeStyle="#ef4444";g.fillStyle="#ef4444";g.lineWidth=Math.max(2,c.width/500);g.font=`${Math.max(14,c.width/60)}px sans-serif`;for(const m of marks){if(m.kind==="rect")g.strokeRect(m.x,m.y,m.w,m.h);else if(m.kind==="text")g.fillText(m.text,m.x,m.y);else{g.beginPath();m.points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.stroke()}} };
  useEffect(()=>{const img=new Image;img.onload=()=>{image.current=img;const c=canvas.current;if(c){c.width=img.naturalWidth;c.height=img.naturalHeight;paint()}};img.onerror=()=>onCancel();img.src=src},[src]);
  useEffect(paint,[marks]);
  useLayoutEffect(() => {
    if (!textDraft) return;
    textInput.current?.focus();
    textInput.current?.select();
  }, [textDraft?.x, textDraft?.y]);
  const point=(e:React.PointerEvent<HTMLCanvasElement>):[number,number]=>{const c=e.currentTarget,r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]};
  const down=(e:React.PointerEvent<HTMLCanvasElement>)=>{const [x,y]=point(e);if(tool==="text"){e.preventDefault();cancelText.current=false;setTextDraft({x,y,text:""});return}e.currentTarget.setPointerCapture(e.pointerId);drawing.current=tool==="rect"?{kind:"rect",x,y,w:0,h:0}:{kind:"pen",points:[[x,y]]}};
  const commitText=()=>{const draft=textDraft,text=draft?.text.trim();setTextDraft(null);if(cancelText.current){cancelText.current=false;return}if(!draft||!text)return;const commentId=crypto.randomUUID();setMarks(v=>[...v,{kind:"text",x:draft.x,y:draft.y,text,commentId}]);setComments(v=>[...v,{id:commentId,text,x:draft.x/(canvas.current?.width||1),y:draft.y/(canvas.current?.height||1),selector:selected?.selector}])};
  const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{const m=drawing.current;if(!m)return;const [x,y]=point(e);if(m.kind==="rect"){m.w=x-m.x;m.h=y-m.y}else m.points.push([x,y]);paint();const c=canvas.current,g=c?.getContext("2d");if(!g)return;g.strokeStyle="#ef4444";g.lineWidth=Math.max(2,(c?.width||500)/500);if(m.kind==="rect")g.strokeRect(m.x,m.y,m.w,m.h);else{g.beginPath();m.points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.stroke()}};
  const up=()=>{const completed=drawing.current;if(!completed)return;drawing.current=null;setMarks(v=>[...v,completed])};
  const undoMark=()=>setMarks(v=>{const removed=v[v.length-1];if(removed?.kind==="text")setComments(c=>c.filter(x=>x.id!==removed.commentId));return v.slice(0,-1)});
  const renderPreview=async():Promise<AnnotatedPreview|null>=>{commitText();await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const c=canvas.current;if(!c)return null;const blob=await new Promise<Blob|null>(ok=>c.toBlob(ok,"image/png"));return blob?{blob,file:new File([blob],"annotated-preview.png",{type:"image/png"}),comments,width:c.width,height:c.height}:null};
  const send=async()=>{if(sending)return;setSending(true);setSendError("");try{const result=await renderPreview();if(result)await onSend(result,message.trim())}catch(e){setSendError(String(e))}finally{setSending(false)}};
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
    </div>
    <div className="preview-canvas-scroll"><div className="preview-canvas-stage"><canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}/>{textDraft && <input ref={textInput} className="preview-text-input" aria-label="输入截图文字" placeholder="输入文字，回车确认" value={textDraft.text} style={{left:`${textDraft.x/(canvas.current?.width||1)*100}%`,top:`${textDraft.y/(canvas.current?.height||1)*100}%`}} onPointerDown={(e)=>e.stopPropagation()} onChange={(e)=>setTextDraft(v=>v&&({...v,text:e.target.value}))} onBlur={commitText} onKeyDown={(e)=>{if(e.key==="Enter"){e.preventDefault();commitText()}else if(e.key==="Escape"){e.preventDefault();cancelText.current=true;setTextDraft(null)}}}/>}</div></div>
    <form className="preview-annotation-composer" onSubmit={(e)=>{e.preventDefault();void send()}}>
      <input aria-label="标注补充说明" placeholder="描述你希望 Agent 如何修改…" value={message} onChange={(e)=>setMessage(e.target.value)}/>
      <span>{comments.length} 条标注</span>
      <button type="submit" disabled={sending} aria-label="发送标注到对话" title="发送到对话"><Icon name="send"/>{sending ? "发送中…" : "发送到对话"}</button>
      {sendError && <small role="status">发送失败：{sendError}</small>}
    </form>
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
  onQueueAgent,
}: {
  children: ReactNode;
  sessionId: string | null;
  suggestedUrl: string | null;
  open: boolean;
  obscured: boolean;
  onClose: () => void;
  onSendAgent: (files: File[], prompt: string) => Promise<void>;
  onQueueAgent: (files: File[]) => Promise<void>;
}) {
  const initialUrl = suggestedUrl ?? DEFAULT_URL;
  const [url, setUrl] = useState(initialUrl);
  const [draft, setDraft] = useState(initialUrl);
  const [error, setError] = useState("");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [paneWidth, setPaneWidth] = useState(68);
  const [picking, setPicking] = useState(false);
  const [pickerPurpose, setPickerPurpose] = useState<"comment" | "edit" | null>(null);
  const [selected, setSelected] = useState<ElementSnapshot | null>(null);
  const [commentText, setCommentText] = useState("");
  const [undoCount, setUndoCount] = useState(0);
  const [capture, setCapture] = useState<{ requestId: string; dataUrl?: string; purpose: "screenshot" | "mark" } | null>(null);
  const [annotatedPreview, setAnnotatedPreview] = useState<AnnotatedPreview | null>(null);
  const [annotatedPreviewUrl, setAnnotatedPreviewUrl] = useState("");
  const [edits, setEdits] = useState<Array<{selector:string;property:ElementEdit["property"];before:string;after:string}>>([]);
  const [sending, setSending] = useState(false);
  const [source, setSource] = useState(""), [sourceLoading, setSourceLoading] = useState(false), [sourceError, setSourceError] = useState("");
  const [zoom, setZoom] = useState(100), [zoomDraft, setZoomDraft] = useState("100");
  const [sendStatus, setSendStatus] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
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
        if (obscured || dragging.current || mode === "code" || !!capture) await previewHide();
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
  }, [open, shell, paneWidth, viewport, obscured, mode, !!capture]);

  useEffect(() => {
    const nextUrl = suggestedUrl ?? DEFAULT_URL;
    setUrl(nextUrl);
    setDraft(nextUrl);
    setError("");
    setViewport("desktop");
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
    if (!annotatedPreview) { setAnnotatedPreviewUrl(""); return; }
    const objectUrl = URL.createObjectURL(annotatedPreview.blob);
    setAnnotatedPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [annotatedPreview]);

  const copyImageToClipboard=async(blob:Blob)=>{await navigator.clipboard.write([new ClipboardItem({"image/png":blob})])};

  useEffect(() => {
    if (!capture?.dataUrl || capture.purpose !== "screenshot") return;
    let cancelled = false;
    const image = new Image();
    image.src = capture.dataUrl;
    void Promise.all([fetch(capture.dataUrl).then((response) => response.blob()), new Promise<{width:number;height:number}>((resolve,reject)=>{image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(new Error("截图尺寸读取失败"));})]).then(([blob,size]) => {
      if (cancelled) return;
      finishAnnotation({ blob, file: new File([blob], "full-page.png", { type: "image/png" }), comments: [], ...size });
    }).catch((e) => { if (!cancelled) { setCapture(null); setError(String(e)); restorePreview(); } });
    return () => { cancelled = true; };
  }, [capture?.dataUrl, capture?.purpose]);

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
    const offCapture = onPreviewCaptured((value) => {
      setCapture((current) => current?.requestId === value.requestId ? { ...current, dataUrl: value.dataUrl } : current);
      setSendStatus(value.clipboardError ? `自动复制失败：${value.clipboardError}` : "截图已复制到剪贴板");
      setError("");
    });
    const offCaptureError = onPreviewCaptureError((value) => { setCapture((current) => { if (current?.requestId !== value.requestId) return current; setError(value.error); if (!obscured) void previewShow().catch(()=>{}); return null; }); });
    return () => { offPicked(); offError(); offCapture(); offCaptureError(); };
  }, [shell, obscured]);

  const resetPageState = () => { setPicking(false); setPickerPurpose(null); setSelected(null); setCommentText(""); setUndoCount(0); setEdits([]); };
  const togglePicker = async (purpose: "comment" | "edit") => {
    const next = !picking || pickerPurpose !== purpose;
    try {
      if (next) {
        setMode("preview");
        const nextBounds = bounds();
        if (nextBounds) await previewSetBounds(nextBounds);
        await previewShow();
      }
      await previewPickerToggle(next);
      setPicking(next); setPickerPurpose(next ? purpose : null);
      if (next) { setSelected(null); setCommentText(""); }
      setError("");
    } catch (e) { setError(String(e)); }
  };
  const applyEdit = async (property: ElementEdit["property"], value: string) => {
    if (!selected) return;
    try {
      const target = selected;
      const before=property === "delete" ? "" : property === "text" ? target.text : target.styles[property];
      if (property !== "delete") setSelected((current) => current ? property === "text" ? { ...current, text: value } : { ...current, styles: { ...current.styles, [property]: value } } : current);
      await previewElementApply({ selector: target.selector, property, value });
      setEdits(v=>[...v,{selector:target.selector,property,before,after:value}]);
      if (property === "delete") setSelected(null);
      setUndoCount((n) => n + 1);
      setError("");
    } catch (e) {
      setSelected((current) => {
        if (!current || current.selector !== selected.selector) return current;
        if (property === "text" && current.text === value) return { ...current, text: selected.text };
        if (property !== "text" && property !== "delete" && current.styles[property] === value) return { ...current, styles: { ...current.styles, [property]: selected.styles[property] } };
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
          if (reverted.property === "delete") return current;
          return { ...current, styles: { ...current.styles, [reverted.property]: reverted.before } };
        });
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const beginCapture = async (mode: PreviewCaptureMode, purpose: "screenshot" | "mark") => { const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,"0")).join("");try{setAnnotatedPreview(null);setCapture({requestId,purpose});setError("");setSendStatus("");await previewPickerToggle(false);setPicking(false);setPickerPurpose(null);await previewCapture(mode,requestId);await previewHide()}catch(e){setCapture(null);setError(String(e));if (!obscured) void previewShow().catch(()=>{})} };
  const cancelCapture = () => { setCapture(null); if (!obscured) void previewShow().catch((e)=>setError(String(e))); };

  const dismissAnnotatedPreview = () => {
    setAnnotatedPreview(null);
    if (!obscured && shell) void previewShow().catch((e) => setError(String(e)));
  };

  const restorePreview = () => {
    if (!shell || obscured || mode === "code") return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const next = bounds();
      if (!next || !created.current) return;
      void previewSetBounds(next)
        .then(() => previewShow())
        .catch((e) => setError(String(e)));
    }));
  };

  const finishAnnotation = (result: AnnotatedPreview) => {
    setAnnotatedPreview(result);
    setCapture(null);
    restorePreview();
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
      const maxPreview = Math.min(76, ((root.width - Math.min(400, root.width * 0.42)) / root.width) * 100);
      setPaneWidth(Math.max(42, Math.min(maxPreview, ((root.right - event.clientX) / root.width) * 100)));
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
  const copyAnnotatedPreview=async()=>{if(!annotatedPreview)return;try{await copyImageToClipboard(annotatedPreview.blob);setSendStatus("图片已复制到剪贴板")}catch(e){setSendStatus(`复制失败：${e instanceof Error?e.message:String(e)}`)}};
  const artifacts=()=>{const comments=annotatedPreview?.comments??[];const json=JSON.stringify({url,selectors:[...new Set(edits.map(x=>x.selector))],edits,comments},null,2);const report=`# 设计反馈\n\n- URL: ${url}\n\n## 元素修改\n${edits.map(x=>`- \`${x.selector}\` ${x.property}: \`${x.before}\` → \`${x.after}\``).join("\n")||"无"}\n\n## 评论\n${comments.map(x=>`- ${x.text} (${x.selector||"无选择器"}, ${x.x.toFixed(3)}, ${x.y.toFixed(3)})`).join("\n")||"无"}\n`;return{json,report,comments}};
  const commentFiles=()=>{if(!selected) return [];const data={url,comment:commentText.trim(),element:selected};return [new File([JSON.stringify(data,null,2)],"element-comment.json",{type:"application/json"}),new File([`# 元素注释\n\n- URL: ${url}\n- 选择器: \`${selected.selector}\`\n- 元素: \`${selected.tag}\`\n\n${commentText.trim()}\n`],"element-comment.md",{type:"text/markdown"})]};
  const submitComment=async(action:"queue"|"send")=>{if(!selected||!commentText.trim())return;setSending(true);setSendStatus("");try{const files=commentFiles();if(action==="queue"){await onQueueAgent(files);setSendStatus("已加入对话附件")}else{await onSendAgent(files,`请处理这个页面元素的注释。\nURL: ${url}\n选择器: ${selected.selector}\n元素: ${selected.tag}\n评论: ${commentText.trim()}`);setSendStatus("已发送给 Agent")}setSelected(null);setCommentText("");setPickerPurpose(null)}catch(e){setSendStatus(`${action==="queue"?"加入队列":"发送"}失败：${String(e)}`)}finally{setSending(false)}};
  const loadSource=async()=>{
    const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,"0")).join("");
    setSourceLoading(true);setSourceError("");
    let offSuccess=()=>{},offError=()=>{};
    const cleanup=()=>{offSuccess();offError()};
    try{
      offSuccess=await onPreviewSerializedAsync(value=>{if(value.requestId!==requestId)return;cleanup();setSource(value.html);setSourceLoading(false)});
      offError=await onPreviewSerializedErrorAsync(value=>{if(value.requestId!==requestId)return;cleanup();setSourceError(value.error);setSourceLoading(false)});
      await previewSerialize(requestId);
    }catch(e){cleanup();setSourceError(String(e));setSourceLoading(false)}
  };
  const changeZoom=async(value:number)=>{
    const next=Math.min(500,Math.max(10,Math.round(value)));
    setZoomDraft(String(next));
    try{await previewSetZoom(next/100);setZoom(next);setError("")}catch(e){setZoomDraft(String(zoom));setError(String(e))}
  };
  const openDemo=()=>{try{const target=new URL(url);if(!["http:","https:"].includes(target.protocol))throw new Error("演示仅支持 HTTP 地址");openExternal(target.href);setError("")}catch(e){setError(e instanceof Error?e.message:String(e))}};
  const openCode=()=>{setMode("code");void loadSource()};
  const sendAnnotatedResult=async(result:AnnotatedPreview,message:string)=>{const json=JSON.stringify({url,comments:result.comments},null,2);const report=`# 截图标注\n\n- URL: ${url}\n\n${result.comments.map(x=>`- ${x.text} (${x.x.toFixed(3)}, ${x.y.toFixed(3)})`).join("\n")||"无文字标注"}\n`;await onSendAgent([result.file,new File([json],"design-comments.json",{type:"application/json"}),new File([report],"design-feedback.md",{type:"text/markdown"})],message||`请根据截图中的标注修改页面。\nURL: ${url}`);setCapture(null);setSendStatus("已发送给 Agent");restorePreview()};

  return (
    <div ref={rootRef} className="preview-root">
      <div className="preview-host-pane" style={{ flex: open ? `1 1 ${100 - paneWidth}%` : "1" }}>{children}</div>
      {open && (
        <>
          <div className="preview-divider" onPointerDown={startResize}/>
          <section className="preview-pane" style={{ width: `${paneWidth}%` }}>
            <form className="preview-address preview-address-row" onSubmit={navigate}>
              <Icon name="globe" size={14}/>
              <input aria-label="预览地址" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}/>
              <IconButton icon="arrow" label="打开地址" type="submit"/>
            </form>
            {!capture?.dataUrl && <header className="preview-toolbar" role="toolbar" aria-label="设计预览工具栏">
              <IconButton icon="refresh" label="刷新预览" onClick={() => void previewReload().then(() => { resetPageState(); setError(""); }).catch((e) => setError(String(e)))} disabled={!shell}/>
              <div className="preview-mode-tabs" aria-label="查看模式">
                <button type="button" className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>预览</button>
                <button type="button" className={mode === "code" ? "active" : ""} onClick={openCode}>代码</button>
              </div>
              <IconButton icon="demo" label="在浏览器中演示" onClick={openDemo}/>
              <div className="preview-tool-divider"/>
              <div className="preview-device-picker">
                <Icon name={viewport}/><span>{viewport === "desktop" ? "桌面端" : viewport === "tablet" ? "平板端" : "手机端"}</span>
                <div className="preview-device-options">
                  {(["desktop", "tablet", "mobile"] as Viewport[]).map((item) => <IconButton key={item} icon={item} label={item === "desktop" ? "桌面视口" : item === "tablet" ? "平板视口" : "手机视口"} className={viewport === item ? "active" : ""} onClick={() => { setViewport(item); setMode("preview"); }}/>) }
                </div>
              </div>
              <div className="preview-toolbar-spacer"/>
              <IconButton icon="image" label="截取完整页面" onClick={() => void beginCapture("full", "screenshot")} disabled={!shell || !!capture}/>
              <IconButton icon="comment" label={picking && pickerPurpose === "comment" ? "停止注释" : "注释元素"} className={picking && pickerPurpose === "comment" ? "active" : ""} onClick={() => { setMode("preview"); void togglePicker("comment"); }} disabled={!shell}/>
              <IconButton icon="pen" label="标记截图" onClick={() => void beginCapture("viewport", "mark")} disabled={!shell || !!capture}/>
              <IconButton icon="edit" label={picking && pickerPurpose === "edit" ? "停止编辑" : "编辑元素"} className={picking && pickerPurpose === "edit" ? "active" : ""} onClick={() => { setMode("preview"); void togglePicker("edit"); }} disabled={!shell}/>
              <IconButton icon="undo" label={undoCount ? `撤销修改（${undoCount}）` : "撤销修改"} onClick={() => void undo()} disabled={!shell || undoCount === 0}/>
              <label className="preview-zoom" title="输入预览缩放比例">
                <input type="number" min="10" max="500" step="1" inputMode="numeric" aria-label="预览缩放比例" value={zoomDraft} onChange={(e)=>setZoomDraft(e.target.value)} onFocus={(e)=>e.currentTarget.select()} onBlur={()=>{const value=Number(zoomDraft);if(Number.isFinite(value))void changeZoom(value);else setZoomDraft(String(zoom))}} onKeyDown={(e)=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur()}else if(e.key==="Escape"){setZoomDraft(String(zoom));e.currentTarget.blur()}}}/>
                <span aria-hidden="true">%</span>
              </label>
              <IconButton icon="close" label="关闭设计预览" className="preview-close" onClick={close}/>
            </header>}
            {error && <div className="preview-error" role="status">{error}</div>}
            {annotatedPreview && !capture && (
              <div className="preview-annotation-ready">
                {annotatedPreviewUrl && <img className="preview-result-thumbnail" src={annotatedPreviewUrl} alt="标注截图缩略图"/>}
                <div className="preview-result-copy"><Icon name="check"/><span><strong>标注已就绪</strong>{annotatedPreview.comments.length} 条评论</span></div>
                <div className="preview-result-actions">
                  <button type="button" onClick={() => void copyAnnotatedPreview()}>复制</button>
                  <button type="button" onClick={() => download(annotatedPreview.blob, "annotated-preview.png")}>下载</button>
                  <button type="button" className="preview-send-agent" disabled={sending} onClick={async () => { const a = artifacts(); const files = [annotatedPreview.file, new File([a.json], "design-comments.json", { type: "application/json" }), new File([a.report], "design-feedback.md", { type: "text/markdown" })]; setSending(true); setSendStatus(""); try { await onSendAgent(files, `请根据以下设计预览反馈修改项目。\nURL: ${url}\n选择器: ${[...new Set(edits.map(x => x.selector))].join(", ") || "无"}\n元素修改: ${JSON.stringify(edits)}\n评论: ${JSON.stringify(a.comments)}\n附件路径将在本消息中列出：annotated-preview.png、design-comments.json、design-feedback.md。`); setSendStatus("已发送给 Agent"); } catch (e) { setSendStatus(`发送失败：${String(e)}`); } finally { setSending(false); } }}><Icon name="send"/>{sending ? "发送中…" : "发送 Agent"}</button>
                </div>
                {sendStatus && <span className="preview-result-status" role="status">{sendStatus}</span>}
                <IconButton icon="close" label="关闭标注结果" className="preview-result-close" onClick={dismissAnnotatedPreview}/>
              </div>
            )}
            <div className="preview-workspace">
              <div className="preview-viewport-wrap">
                <div
                  ref={slotRef}
                  className={`preview-slot preview-slot-${viewport}`}
                  style={viewport === "desktop" ? undefined : {
                    width: `min(${viewportSizes[viewport].width}px, calc(100% - 32px))`,
                    height: `min(${viewportSizes[viewport].height}px, calc(100% - 32px))`,
                  }}
                >
                  {mode === "code" && <div className="preview-code-view">
                    <div className="preview-code-bar"><span>当前页面 HTML</span><button type="button" onClick={()=>void loadSource()} disabled={sourceLoading}><Icon name="refresh"/>{sourceLoading ? "读取中…" : "刷新源码"}</button></div>
                    {sourceError ? <div className="preview-code-error">读取失败：{sourceError}</div> : sourceLoading && !source ? <div className="preview-code-loading">正在读取当前页面源码…</div> : <pre><code>{source}</code></pre>}
                  </div>}
                  {capture?.dataUrl && capture.purpose === "mark" && <AnnotationSurface src={capture.dataUrl} selected={selected} onCancel={cancelCapture} onSend={sendAnnotatedResult}/>}
                  {!shell && (
                    <div className="preview-empty">
                      <strong>设计预览需要桌面应用</strong>
                      <span>浏览器模式不会创建原生预览窗口。</span>
                      <code>{url}</code>
                    </div>
                  )}
                </div>
              </div>
              {selected && pickerPurpose === "comment" && (
                <aside className="preview-inspector preview-comment-composer" aria-label="元素注释">
                  <div className="preview-comment-header">
                    <div className="preview-comment-heading"><span className="preview-comment-heading-icon"><Icon name="comment" size={14}/></span><div><strong>添加元素反馈</strong><span>描述你希望怎样调整</span></div></div>
                    <IconButton icon="close" label="取消注释" onClick={() => { setSelected(null); setCommentText(""); setPickerPurpose(null); }}/>
                  </div>
                  <div className="preview-comment-target"><div><span>当前元素</span><code title={selected.selector}>{selected.selector}</code></div><span>{Math.round(selected.bounds.width)} × {Math.round(selected.bounds.height)}</span></div>
                  <label className="preview-comment-field"><span>反馈内容</span><textarea autoFocus aria-label="评论内容" placeholder="例如：标题字号再大一些，并与左侧内容对齐…" value={commentText} onChange={(e)=>setCommentText(e.target.value)}/></label>
                  <div className="preview-comment-actions"><button type="button" disabled={sending||!commentText.trim()} onClick={()=>void submitComment("queue")}>加入对话</button><button type="button" disabled={sending||!commentText.trim()} onClick={()=>void submitComment("send")}><Icon name="send" size={13}/>{sending?"处理中…":"发送反馈"}</button></div>
                  {sendStatus&&<span className="preview-comment-status" role="status">{sendStatus}</span>}
                </aside>
              )}
              {selected && pickerPurpose !== "comment" && (
                <aside className="preview-inspector" aria-label="元素检查器">
                  <div className="preview-inspector-header">
                    <div><span>元素检查器</span><strong>{selected.tag}</strong></div>
                    <IconButton icon="close" label="关闭元素检查器" onClick={() => setSelected(null)}/>
                  </div>
                  <div className="preview-selection">
                    <code title={selected.selector}>{selected.selector}</code>
                    <span>{Math.round(selected.bounds.width)} × {Math.round(selected.bounds.height)}</span>
                  </div>
                  <div className="preview-inspector-fields preview-box-editor">
                    <label className="preview-text-field"><span>文本内容</span><textarea value={selected.text} onChange={(e) => { void applyEdit("text", e.target.value); }}/></label>
                    {([
                      ["尺寸", [["宽度","width"],["高度","height"]]],
                      ["外观", [["填充","backgroundColor"],["透明度","opacity"],["文字颜色","color"],["字号","fontSize"]]],
                      ["内边距", [["上","paddingTop"],["右","paddingRight"],["下","paddingBottom"],["左","paddingLeft"]]],
                      ["外边距", [["上","marginTop"],["右","marginRight"],["下","marginBottom"],["左","marginLeft"]]],
                      ["边框", [["上","borderTopWidth"],["右","borderRightWidth"],["下","borderBottomWidth"],["左","borderLeftWidth"],["样式","borderStyle"],["颜色","borderColor"],["圆角","borderRadius"]]],
                    ] as Array<[string, Array<[string, keyof ElementSnapshot["styles"]]>]>).map(([group,fields])=><fieldset key={group}><legend>{group}</legend><div>{fields.map(([label,property])=><label key={property}><span>{label}</span><input value={selected.styles[property]} onChange={(e)=>void applyEdit(property,e.target.value)}/></label>)}</div></fieldset>)}
                  </div>
                  <div className="preview-inspector-footer"><button type="button" className="preview-delete-element" onClick={()=>void applyEdit("delete","")}><Icon name="trash"/>删除元素</button><button type="button" onClick={()=>setSelected(null)}>完成</button></div>
                </aside>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
