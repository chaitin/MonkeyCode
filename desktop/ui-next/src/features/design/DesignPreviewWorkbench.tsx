import {
  IconArrowBackUp, IconCamera, IconCode, IconDeviceDesktop, IconDeviceMobile,
  IconDeviceTablet, IconDownload, IconMessage, IconPencil, IconPointer, IconRefresh,
  IconSend, IconSquare, IconTrash, IconX, IconFolder, IconCheck, IconChevronDown,
} from "@tabler/icons-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import type { ComposerCtl } from "@/features/chat/composer/useComposer";
import { CodeView } from "@/features/files/CodeView";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { repoArtifactRead, repoPreviewFiles, type RepoArtifact, type RepoPreviewFile } from "@/lib/ipc/repo";
import { rankPreviewFiles, targetForFile, typedWorkdirRelativePath, type DesignPreviewTarget } from "./previewArtifact";
import {
  enqueuePreviewLifecycle, onPreviewElementPicked, onPreviewPickerError, onPreviewResultAction, previewCreate,
  previewCreateArtifact, previewDestroy, previewElementApply, previewElementUndo, previewHide, previewNavigate,
  previewPickerToggle, previewReload, previewResultHide, previewResultShow, previewSaveHtml, previewSetBounds,
  previewSetZoom, previewShow, requestCapture, requestSerialization, type ElementSnapshot, type ElementStyles,
} from "./previewIpc";
import { isLinuxShell } from "@/lib/ipc/host";
import { artifactInlineUrl, normalizePreviewUrl, normalizeTypedPreviewUrl } from "./previewUrl";

type Annotation =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "pen"; points: { x: number; y: number }[] }
  | { kind: "text"; x: number; y: number; text: string };
type Tool = Annotation["kind"];
type DrawingAnnotation = Exclude<Annotation, { kind: "text" }>;

type ElementDraft = ElementStyles & { text: string };
type StyleProperty = keyof ElementStyles;

const EMPTY_ELEMENT_STYLES: ElementStyles = {
  color: "", backgroundColor: "", fontSize: "", opacity: "", width: "", height: "",
  justifyContent: "", alignItems: "",
  paddingTop: "", paddingRight: "", paddingBottom: "", paddingLeft: "",
  marginTop: "", marginRight: "", marginBottom: "", marginLeft: "",
  borderTopWidth: "", borderRightWidth: "", borderBottomWidth: "", borderLeftWidth: "",
  borderStyle: "", borderColor: "", borderRadius: "",
};

function elementDraftOf(snapshot: ElementSnapshot): ElementDraft {
  return {
    ...EMPTY_ELEMENT_STYLES,
    ...snapshot.styles,
    width: snapshot.styles?.width || `${Math.round(snapshot.bounds.width)}px`,
    height: snapshot.styles?.height || `${Math.round(snapshot.bounds.height)}px`,
    text: snapshot.text,
  };
}

const PRESETS = { desktop: 1280, tablet: 768, mobile: 390 } as const;
/** 选中元素弹窗「贴着元素放」所需的最小高度;低于它就改为盖住元素居中放。 */
const SELECTED_DIALOG_MIN_HEIGHT = 160;

function ElementSelect({
  label, value, options, onChange, openAbove = false,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange(value: string): void;
  openAbove?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const displayedOptions = options.includes(value) ? options : [value, ...options];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>("[role=option][aria-selected=true]")?.focus());
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const moveFocus = (current: HTMLElement, offset: number) => {
    const optionElements = [...(rootRef.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    const index = optionElements.indexOf(current);
    optionElements[(index + offset + optionElements.length) % optionElements.length]?.focus();
  };

  return <div ref={rootRef} className="relative min-w-0" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button
      ref={triggerRef}
      type="button"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      className={`flex h-6 w-full min-w-0 items-center gap-1.5 rounded-field border bg-base-100 px-2 text-left transition-colors ${open ? "border-primary ring-2 ring-primary/10" : "border-base-300 hover:border-base-content/30"}`}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      <span className="shrink-0 text-[10px] text-base-content/50">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-base-content">{value || "—"}</span>
      <IconChevronDown size={12} stroke={1.8} className={`shrink-0 text-base-content/40 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <ul
      role="listbox"
      aria-label={label}
      className={`absolute inset-x-0 z-40 max-h-52 overflow-x-hidden overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-xl ${openAbove ? "bottom-full mb-1" : "top-full mt-1"}`}
    >
      {displayedOptions.map((option) => <li key={option}>
        <button
          type="button"
          role="option"
          aria-selected={option === value}
          className={`flex h-7 w-full items-center gap-2 rounded-field px-2 text-left text-xs transition-colors ${option === value ? "bg-primary/12 font-medium text-primary" : "text-base-content/80 hover:bg-base-200"}`}
          onPointerDown={(event) => {
            event.preventDefault();
            onChange(option);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          onClick={(event) => {
            if (event.detail !== 0) return;
            onChange(option);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
            if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(event.currentTarget, 1); }
            if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(event.currentTarget, -1); }
          }}
        >
          <IconCheck size={12} stroke={2} className={option === value ? "opacity-100" : "opacity-0"} />
          <span className="truncate">{option || "—"}</span>
        </button>
      </li>)}
    </ul>}
  </div>;
}

function pickerColorOf(value: string) {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) return `#${hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex}`;
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) return "#000000";
  return `#${rgb.slice(1, 4).map((part) => Math.min(255, Math.max(0, Math.round(Number(part)))).toString(16).padStart(2, "0")).join("")}`;
}

function hsvOf(hex: string) {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return { hue: hue < 0 ? hue + 360 : hue, saturation: max ? delta / max : 0, value: max };
}

function hexOf(hue: number, saturation: number, value: number) {
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const [red, green, blue] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  const offset = value - chroma;
  return `#${[red, green, blue].map((part) => Math.round((part + offset) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const COLOR_PALETTE_WIDTH = 208;
const COLOR_PALETTE_HEIGHT = 200;

function ElementColorInput({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const hsv = useMemo(() => hsvOf(pickerColorOf(value)), [value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !paletteRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const openPalette = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const right = bounds.right + 8;
    const left = right + COLOR_PALETTE_WIDTH <= window.innerWidth - 8 ? right : Math.max(8, bounds.left - COLOR_PALETTE_WIDTH - 8);
    const top = Math.min(Math.max(8, bounds.top), Math.max(8, window.innerHeight - COLOR_PALETTE_HEIGHT - 8));
    setPosition({ left, top });
    setOpen((current) => !current);
  };

  const updateSaturationValue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const saturation = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const brightness = Math.min(1, Math.max(0, 1 - (event.clientY - bounds.top) / bounds.height));
    onChange(hexOf(hsv.hue, saturation, brightness));
  };

  return <div className="input input-xs flex min-w-0 items-center gap-1.5 px-2 text-[10px] text-base-content/50">
    <span className="shrink-0">{label}</span>
    <input aria-label={label} className="min-w-0 flex-1 text-right text-xs text-base-content" value={value} onChange={(event) => onChange(event.target.value)} />
    <button
      ref={triggerRef}
      type="button"
      aria-label={`${label} picker`}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="relative size-4 shrink-0 overflow-hidden rounded border border-base-content/20 shadow-inner"
      style={{ backgroundImage: "linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%)", backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0", backgroundSize: "8px 8px" }}
      onClick={openPalette}
    >
      <span className="absolute inset-0" style={{ backgroundColor: value }} />
    </button>
    {open && createPortal(<div
      ref={paletteRef}
      role="dialog"
      aria-label={`${label} palette`}
      className="fixed z-[100] w-[208px] rounded-box border border-base-300 bg-base-100 p-3 text-base-content shadow-2xl"
      style={position}
      onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } }}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${label} saturation and brightness`}
        aria-valuetext={`${Math.round(hsv.saturation * 100)}% saturation, ${Math.round(hsv.value * 100)}% brightness`}
        className="relative h-28 w-full cursor-crosshair overflow-hidden rounded-field"
        style={{ backgroundColor: `hsl(${hsv.hue} 100% 50%)`, backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)" }}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateSaturationValue(event); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturationValue(event); }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.01;
          if (event.key === "ArrowLeft") onChange(hexOf(hsv.hue, Math.max(0, hsv.saturation - step), hsv.value));
          else if (event.key === "ArrowRight") onChange(hexOf(hsv.hue, Math.min(1, hsv.saturation + step), hsv.value));
          else if (event.key === "ArrowDown") onChange(hexOf(hsv.hue, hsv.saturation, Math.max(0, hsv.value - step)));
          else if (event.key === "ArrowUp") onChange(hexOf(hsv.hue, hsv.saturation, Math.min(1, hsv.value + step)));
          else return;
          event.preventDefault();
        }}
      >
        <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.value) * 100}%` }} />
      </div>
      <input
        type="range"
        aria-label={`${label} hue`}
        min="0"
        max="359"
        value={Math.round(hsv.hue)}
        className="mt-3 h-3 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
        onChange={(event) => onChange(hexOf(Number(event.target.value), hsv.saturation, hsv.value))}
      />
      <div className="mt-3 flex items-center gap-2">
        <span className="size-6 shrink-0 rounded-field border border-base-300" style={{ backgroundColor: pickerColorOf(value) }} />
        <output className="min-w-0 flex-1 font-mono text-xs">{pickerColorOf(value)}</output>
      </div>
    </div>, document.body)}
  </div>;
}

function downloadDataUrl(dataUrl: string, name = "design-preview.png") {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}

async function annotatedDataUrl(dataUrl: string, annotations: Annotation[]): Promise<string> {
  if (!annotations.length) return dataUrl;
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.drawImage(image, 0, 0);
  const x = (n: number) => n * canvas.width / 100;
  const y = (n: number) => n * canvas.height / 100;
  ctx.lineWidth = Math.max(2, canvas.width / 500);
  ctx.font = `${Math.max(14, canvas.width / 70)}px sans-serif`;
  for (const a of annotations) {
    ctx.strokeStyle = "#ff2d2d";
    ctx.fillStyle = ctx.strokeStyle;
    if (a.kind === "rect") ctx.strokeRect(x(a.x), y(a.y), x(a.width), y(a.height));
    else if (a.kind === "pen") {
      ctx.beginPath();
      a.points.forEach((p, i) => i ? ctx.lineTo(x(p.x), y(p.y)) : ctx.moveTo(x(p.x), y(p.y)));
      ctx.stroke();
    } else ctx.fillText(a.text, x(a.x), y(a.y));
  }
  return canvas.toDataURL("image/png");
}

async function downloadAnnotated(dataUrl: string, annotations: Annotation[]) {
  downloadDataUrl(await annotatedDataUrl(dataUrl, annotations));
}

function pngFileOf(dataUrl: string): File {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Captured preview is not a valid data URL.");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const binary = /;base64(?:;|$)/i.test(header) ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `design-feedback-${Date.now()}.png`, { type: "image/png" });
}

function feedbackOf(url: string, annotations: Annotation[], message: string) {
  return [
    message.trim(),
    `Design preview feedback for ${url}`,
    `Annotations: ${annotations.length}.`,
  ].filter(Boolean).join("\n\n");
}

export function DesignPreviewWorkbench({
  sessionId, initialTarget, refreshKey = 0, composer, obscured, workdir,
}: {
  sessionId: string;
  initialTarget: DesignPreviewTarget;
  refreshKey?: number;
  composer: Pick<ComposerCtl, "sendWithFiles">;
  obscured: boolean;
  /** 会话工作目录:地址栏把粘贴的绝对路径折算成 workdir 相对路径用。 */
  workdir?: string;
}) {
  const { t } = useI18n();
  // Linux 上游限制:tauri-runtime-wry 把子 webview pack_start 进窗口的垂直
  // GtkBox(不是按坐标叠放),窗口被对半分、预览整宽落底,且 wry set_bounds
  // 仅在 fixed 父容器下生效——摆位调用全部空转(2026-08-31 报障截图)。
  // 原生子 webview 在 Linux 不可用,降级为 DOM 内嵌 iframe:层级/摆位天然
  // 正确(浮层遮挡也无需冻结帧);代价是依赖原生 eval 的选元素/截图/标记/
  // 序列化在 Linux 隐藏。localhost 与 artifact(自定义协议对全部 webview
  // 注册,主 webview 内的 iframe 一样可加载)都走 iframe。
  // ⚠️ iframe 的可加载性受主 webview CSP 管(原生 webview 时代不受):
  // tauri.conf.json 的 frame-src 必须放行 localhost 族 + monkeycode-artifact:,
  // 否则整块白屏(2026-08-31 Linux 实测报障,frame-src 当时只有 'self' blob:)。
  const inlineFallback = isLinuxShell();
  const [inlineReload, setInlineReload] = useState(0);
  const initialUrl = initialTarget.kind === "localhost" ? initialTarget.url : "";
  const hostRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(0);
  const createdRef = useRef(false);
  const incomingTargetKey = initialTarget.kind === "localhost"
    ? `localhost:${normalizePreviewUrl(initialTarget.url) ?? initialTarget.url}`
    : `artifact:${initialTarget.path}`;
  const incomingNative = initialTarget.kind === "localhost" || initialTarget.artifactKind === "html";
  const incomingRefreshRef = useRef(refreshKey);
  const [target, setTarget] = useState<DesignPreviewTarget>(initialTarget);
  const targetKey = target.kind === "localhost" ? `localhost:${normalizePreviewUrl(target.url) ?? target.url}` : target.kind === "artifact" ? `artifact:${target.path}` : "none";
  const latestRef = useRef({ sessionId, targetKey, targetKind: target.kind });
  latestRef.current = { sessionId, targetKey, targetKind: target.kind };
  const elementSelectionRef = useRef(0);
  const [address, setAddress] = useState(initialUrl);
  const [filesOpen, setFilesOpen] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<RepoPreviewFile[] | null>(null);
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [artifact, setArtifact] = useState<RepoArtifact | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // 地址走 ref 而非依赖:submitFeedback 一旦跟着 address 变身份,挂在它上面的
  // preview-element-picked / picker-error / result-action 三个原生监听就会随
  // 地址栏的每次击键注销重注册(选区事件正好落在这个窗口里就丢了)。
  const addressRef = useRef(address);
  addressRef.current = address;
  const [preset, setPreset] = useState<keyof typeof PRESETS>("desktop");
  const [status, setStatus] = useState("");
  const [html, setHtml] = useState("");
  const [savePath, setSavePath] = useState(initialTarget.kind === "artifact" && initialTarget.artifactKind === "html" ? initialTarget.path : "index.html");
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [picker, setPicker] = useState(false);
  const [pickerPurpose, setPickerPurpose] = useState<"edit" | "comment" | null>(null);
  const pickerRef = useRef(false);
  pickerRef.current = picker;
  const pickerCommandRef = useRef<Promise<void>>(Promise.resolve());
  const overlayRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<ElementSnapshot | null>(null);
  const pickedRef = useRef<ElementSnapshot | null>(null);
  pickedRef.current = picked;
  const pickedPreviewRequestRef = useRef(0);
  const commentRequestRef = useRef(0);
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [elementDraft, setElementDraft] = useState<ElementDraft | null>(null);
  const elementSavingRef = useRef(false);
  const [elementSaving, setElementSaving] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  /** 外部浮层遮挡期间垫在宿主原位的冻结帧(null = 未冻结/截帧失败退文字)。 */
  const [obscuredFreeze, setObscuredFreeze] = useState<string | null>(null);
  const freezeGen = useRef(0);
  const resultImageRef = useRef<string | null>(null);
  const resultAnnotationsRef = useRef<Annotation[]>([]);
  const resultFeedbackRef = useRef("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<Tool>("rect");
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const drawing = useRef<DrawingAnnotation | null>(null);
  const [drawingAnnotation, setDrawingAnnotation] = useState<DrawingAnnotation | null>(null);
  const feedbackSendingRef = useRef(false);
  const [feedbackSending, setFeedbackSending] = useState(false);

  useEffect(() => {
    setTarget(initialTarget);
    if (initialTarget.kind === "localhost") setAddress(initialTarget.url);
    setSavePath(initialTarget.kind === "artifact" && initialTarget.artifactKind === "html" ? initialTarget.path : "index.html");
    setFilesOpen(false);
  }, [initialTarget]);

  useEffect(() => {
    elementSelectionRef.current += 1;
  }, [sessionId, targetKey]);

  const native = target.kind === "localhost" || (target.kind === "artifact" && target.artifactKind === "html");
  const previewSourceKey = target.kind === "localhost" ? "localhost" : target.kind === "artifact" && target.artifactKind === "html" ? `artifact:${target.path}` : "none";
  // 隐藏原因分两类:工作台自身的视图切换(代码页/文件面板/截图/选元素,
  // 各有自己的视觉承接)与外部浮层遮挡(菜单/模态)。后者要走「冻结帧」
  // 路径——预览在用户眼里不消失,见 hidden effect。
  const hiddenByView = !native || tab === "code" || filesOpen || !!capture || !!picked;
  const hidden = hiddenByView || obscured;
  const visibleFiles = useMemo(() => rankPreviewFiles(previewFiles ?? [], fileQuery), [previewFiles, fileQuery]);
  const findMatches = useMemo(() => {
    if (!findQuery) return [];
    const matches: number[] = [];
    const escapedQuery = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of html.matchAll(new RegExp(escapedQuery, "gi"))) matches.push(match.index);
    return matches;
  }, [findQuery, html]);
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const result = await repoPreviewFiles(sessionId);
      setPreviewFiles(result.files); setFilesTruncated(result.truncated);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setFilesLoading(false); }
  }, [sessionId]);
  const report = useCallback((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)), []);
  useEffect(() => {
    const previousRefreshKey = incomingRefreshRef.current;
    incomingRefreshRef.current = refreshKey;
    if (refreshKey === previousRefreshKey || !incomingNative || incomingTargetKey !== latestRef.current.targetKey) return;
    if (inlineFallback) {
      setInlineReload((n) => n + 1);
      return;
    }
    void enqueuePreviewLifecycle(() => {
      if (latestRef.current.targetKey !== incomingTargetKey) return Promise.resolve();
      return previewReload();
    }).catch(report);
  }, [incomingNative, incomingTargetKey, inlineFallback, refreshKey, report]);
  const submitFeedback = useCallback(async (image: string, feedbackAnnotations: Annotation[], message: string): Promise<boolean> => {
    if (feedbackSendingRef.current) return false;
    feedbackSendingRef.current = true;
    setFeedbackSending(true);
    setStatus("Preparing annotated preview…");
    const forSid = sessionId;
    try {
      const annotated = await annotatedDataUrl(image, feedbackAnnotations);
      if (latestRef.current.sessionId !== forSid) return false;
      const accepted = await composer.sendWithFiles(
        feedbackOf(addressRef.current, feedbackAnnotations, message),
        [pngFileOf(annotated)],
      );
      if (latestRef.current.sessionId !== forSid) return false;
      if (!accepted) {
        setStatus("Feedback was not sent. Check the composer error and try again.");
        return false;
      }
      setStatus("Feedback sent through the composer.");
      return true;
    } catch (error) {
      if (latestRef.current.sessionId === forSid) report(error);
      return false;
    } finally {
      feedbackSendingRef.current = false;
      if (latestRef.current.sessionId === forSid) setFeedbackSending(false);
    }
  }, [sessionId, composer, report]);

  const bounds = useCallback(() => {
    const host = hostRef.current;
    if (!host || !createdRef.current) return;
    const r = host.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    void previewSetBounds({ x: r.left, y: r.top, width: r.width, height: r.height }).catch(report);
  }, [report]);

  useLayoutEffect(() => {
    if (inlineFallback) return; // Linux:内嵌 iframe,不建原生 webview
    const generation = ++liveRef.current;
    const artifactPath = target.kind === "artifact" && target.artifactKind === "html" ? target.path : null;
    const url = target.kind === "localhost" ? normalizePreviewUrl(target.url) : null;
    if (!url && !artifactPath) {
      createdRef.current = false;
      void enqueuePreviewLifecycle(() => previewDestroy()).catch(() => {});
      return;
    }
    let starting = false;
    const sync = () => {
      const host = hostRef.current;
      if (!host || (!url && !artifactPath)) return;
      const r = host.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (createdRef.current) { bounds(); return; }
      if (starting) return;
      starting = true;
      const create = enqueuePreviewLifecycle(() => artifactPath
        ? previewCreateArtifact(sessionId, artifactPath, { x: r.left, y: r.top, width: r.width, height: r.height })
        : previewCreate(url!, { x: r.left, y: r.top, width: r.width, height: r.height }));
      void create.then(() => {
        starting = false;
        if (liveRef.current !== generation) return;
        createdRef.current = true;
        void previewSetZoom(zoomRef.current / 100).then(bounds).catch(report);
        if (pickerRef.current) void previewPickerToggle(true).catch((error) => { setPicker(false); report(error); });
      }, (error) => { starting = false; report(error); });
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    if (hostRef.current) ro?.observe(hostRef.current);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      liveRef.current += 1;
      createdRef.current = false;
      ro?.disconnect();
      window.removeEventListener("resize", sync);
      void enqueuePreviewLifecycle(() => previewDestroy()).catch(() => {});
    };
    // URL changes navigate through the dedicated effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, previewSourceKey]);

  // 逐帧位移追踪:纯位移(拖格换位/任务列收起/分屏重排)不改宿主尺寸,
  // ResizeObserver 不响,原生 webview 就被留在原地(2026-08-31 报障截图)。
  // rAF 比对宿主矩形,变了才发 preview_set_bounds——静止帧只有一次布局读、
  // 零 IPC;尺寸变化同样被覆盖,原先这里的 RO 随之退役(创建路径的 RO
  // 在上面的生命周期 effect 里,不动)。
  useLayoutEffect(() => {
    if (tab !== "preview" || inlineFallback) return;
    let raf = 0;
    let last: { x: number; y: number; width: number; height: number } | null = null;
    const track = () => {
      raf = requestAnimationFrame(track);
      const host = hostRef.current;
      if (!host || !createdRef.current) return;
      const r = host.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (last && r.left === last.x && r.top === last.y && r.width === last.width && r.height === last.height) return;
      last = { x: r.left, y: r.top, width: r.width, height: r.height };
      void previewSetBounds(last).catch(report);
    };
    track();
    return () => cancelAnimationFrame(raf);
  }, [tab, inlineFallback, report]);

  useEffect(() => {
    // 地址栏常驻:artifact 态也把当前路径回填,免得输入框空着看不出在预览什么。
    if (target.kind === "artifact") { setAddress(target.path); return; }
    if (target.kind !== "localhost") return;
    const url = normalizePreviewUrl(target.url);
    if (!url) return;
    setAddress(url);
    if (createdRef.current) void previewNavigate(url).catch(report);
  }, [target, report]);

  useEffect(() => {
    if (target.kind !== "artifact" || target.artifactKind === "html") { setArtifact(null); return; }
    let active = true;
    setStatus("Loading artifact…");
    void repoArtifactRead(sessionId, target.path).then((value) => {
      if (!active) return;
      setArtifact(value); setStatus(""); setTab("preview");
    }, (error) => active && report(error));
    return () => { active = false; };
  }, [sessionId, target, report]);

  useEffect(() => {
    if (inlineFallback || !createdRef.current) return;
    const gen = ++freezeGen.current;
    if (!hidden) {
      // 冻结帧等 show 落地再撤,避免露出一帧空白/提示
      void previewShow()
        .then(() => {
          bounds();
          if (freezeGen.current === gen) setObscuredFreeze(null);
        })
        .catch(report);
      return;
    }
    if (hiddenByView) {
      setObscuredFreeze(null);
      void previewHide().catch(report);
      return;
    }
    // 外部浮层遮挡:原生 webview 必须让位(它永远压在 DOM 之上),但预览
    // 不能在用户眼里"消失"——先截一帧冻结在原位再隐藏,浮层浮在冻结帧上,
    // 关闭后无缝切回活视图(选元素弹窗 pickedPreview 的同一手法)。截帧
    // 期间活视图仍在,占位不会闪现;限时 800ms:页面繁忙截不到就直接隐藏
    // 走文字兜底,不能让浮层被预览压着等默认的 20s 截图预算。
    void requestCapture("viewport-no-copy", 800)
      .then((result) => {
        if (freezeGen.current === gen) setObscuredFreeze(result.dataUrl);
      })
      .catch(() => {})
      .finally(() => {
        if (freezeGen.current === gen) void previewHide().catch(report);
      });
  }, [hidden, hiddenByView, inlineFallback, bounds, report]);

  useEffect(() => {
    const offPicked = onPreviewElementPicked((snapshot) => {
      if (!pickerRef.current) return;
      pickerRef.current = false;
      // 代次在**事件到达时**取,不能在注册时取:换预览目标会重建 webview 并
      // 递增 liveRef,而本 effect 不跟着重跑(重跑会引入注册/注销竞态)。按
      // 注册时的快照比对,切过一次文件或地址之后每次选取都会被当成过期丢掉
      // ——现象就是「点了编辑、选了元素,却不弹窗」。
      const generation = liveRef.current;
      const selection = ++elementSelectionRef.current;
      const selectedTarget = latestRef.current.targetKey;
      const showPicked = (preview: string | null) => {
        if (liveRef.current !== generation || elementSelectionRef.current !== selection || latestRef.current.targetKey !== selectedTarget) return;
        setPickedPreview(preview);
        setPicked(snapshot); setElementDraft(elementDraftOf(snapshot));
      };
      setPicker(false);
      void requestCapture("viewport-no-copy").then((result) => {
        showPicked(result.dataUrl);
      }).catch((error) => {
        showPicked(null);
        if (elementSelectionRef.current === selection && latestRef.current.targetKey === selectedTarget) report(error);
      });
      void previewPickerToggle(false).catch(report);
    });
    const offError = onPreviewPickerError((error) => report(error));
    const offAction = onPreviewResultAction((action) => {
      if (latestRef.current.sessionId !== sessionId) return;
      const image = resultImageRef.current;
      const resultAnnotations = resultAnnotationsRef.current;
      const resultFeedback = resultFeedbackRef.current;
      if (action === "download" && image) void downloadAnnotated(image, resultAnnotations).catch(report);
      if (action === "send" && image) {
        void submitFeedback(image, resultAnnotations, resultFeedback).then((sent) => {
          if (sent) void previewResultHide().catch(report);
        });
      }
      if (action === "close") void previewResultHide().catch(report);
    });
    return () => { offPicked(); offError(); offAction(); };
    // 依赖刻意不含 previewSourceKey:监听常驻,过期判定交给上面的代次/选区/
    // 目标三重守卫。跟着目标重注册会踩注册-注销竞态(旧的 unlisten 落在新的
    // listen 之后,把新监听一并摘掉)。
  }, [sessionId, submitFeedback, report]);

  const togglePicker = (purpose: "edit" | "comment") => {
    if (!createdRef.current) {
      setStatus(t("design.preview.loading"));
      return;
    }
    const next = !pickerRef.current || pickerPurpose !== purpose;
    pickerRef.current = next;
    setPicker(next);
    setPickerPurpose(next ? purpose : null);
    if (next) {
      elementSelectionRef.current += 1;
      setPicked(null); setPickedPreview(null); setElementDraft(null); setCommentText("");
    }
    setStatus(next ? t(purpose === "comment" ? "design.preview.commentHint" : "design.preview.editHint") : "");
    pickerCommandRef.current = pickerCommandRef.current
      .catch(() => undefined)
      .then(() => previewPickerToggle(next))
      .catch((error) => {
        if (pickerRef.current === next) {
          pickerRef.current = false;
          setPicker(false);
          setPickerPurpose(null);
        }
        report(error);
      });
  };
  const openTarget = (next: DesignPreviewTarget) => {
    elementSelectionRef.current += 1;
    setPicked(null); setPickedPreview(null);
    setTarget(next); setStatus("");
    if (next.kind === "artifact" && next.artifactKind === "html") setSavePath(next.path);
  };
  // 地址栏兼收两种输入(像浏览器地址栏兼收网址与搜索):localhost 地址切 dev
  // server,工作区相对路径切静态文件。文件路径只认 repo_preview_files 报过的
  // 那些——既省掉自己判扩展名,也保证不会切到一个预览不了的路径。
  const navigate = () => {
    const typed = address.trim();
    const normalized = normalizeTypedPreviewUrl(typed);
    if (normalized) {
      openTarget({ kind: "localhost", url: normalized });
      setAddress(normalized);
      // Linux 内嵌态换目标即换 iframe key,无原生 webview 可导航
      if (native && !inlineFallback) void previewNavigate(normalized).catch(report);
      return;
    }
    if (!typed) return;
    // 原样回车(路径没改)= 刷新当前预览,不该报错
    if (target.kind === "artifact" && typed === target.path) {
      if (inlineFallback) setInlineReload((n) => n + 1);
      else void previewReload().catch(report);
      return;
    }
    void (previewFiles ? Promise.resolve(previewFiles) : repoPreviewFiles(sessionId).then((r) => {
      setPreviewFiles(r.files); setFilesTruncated(r.truncated);
      return r.files;
    })).then((files) => {
      if (latestRef.current.sessionId !== sessionId) return;
      // 绝对路径(Windows 用户粘贴 c:\… 全路径)折算成 workdir 相对再匹配;
      // 比较统一正斜杠,命中仍以索引里的原始 path 开预览
      const relativeTyped = typedWorkdirRelativePath(typed, workdir);
      const wanted = [typed, relativeTyped]
        .filter((value): value is string => !!value)
        .map((value) => value.replaceAll("\\", "/"));
      const hit = files.find((file) => wanted.includes(file.path.replaceAll("\\", "/")));
      if (hit) openTarget(targetForFile(hit));
      else setStatus(t("design.preview.addressInvalid"));
    }, report);
  };
  const serialize = async () => {
    setStatus("Serializing…");
    try {
      const serialized = await requestSerialization();
      await previewHide();
      setHtml(serialized); setActiveMatch(0); setTab("code"); setStatus("");
    } catch (error) { report(error); }
  };
  const saveHtml = async () => {
    const savedSessionId = sessionId;
    const savedTargetKey = targetKey;
    const savedPath = savePath;
    const savedHtml = html;
    try {
      await previewSaveHtml(savedSessionId, savedPath, savedHtml);
      if (latestRef.current.sessionId === savedSessionId && latestRef.current.targetKey === savedTargetKey && createdRef.current) {
        await previewReload();
      }
      if (latestRef.current.sessionId === savedSessionId) setStatus(t("design.preview.code.saved", { path: savedPath }));
    } catch (error) {
      if (latestRef.current.sessionId === savedSessionId) report(error);
    }
  };
  const selectMatch = useCallback((index: number) => {
    if (findMatches.length === 0) return;
    const next = (index + findMatches.length) % findMatches.length;
    const start = findMatches[next]!;
    setActiveMatch(next);
    htmlRef.current?.setSelectionRange(start, start + findQuery.length);
  }, [findMatches, findQuery]);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    requestAnimationFrame(() => htmlRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!findOpen || findMatches.length === 0) return;
    const start = findMatches[0]!;
    htmlRef.current?.setSelectionRange(start, start + findQuery.length);
  }, [findOpen, findMatches, findQuery]);
  const takeScreenshot = async () => {
    setStatus(t("design.preview.capturing"));
    try {
      const result = await requestCapture("viewport");
      if (latestRef.current.sessionId !== sessionId) return;
      setStatus(result.clipboardError ? t("design.preview.copyFailed", { error: result.clipboardError }) : t("design.preview.copied"));
    } catch (error) { report(error); }
  };
  const startCapture = async () => {
    const pickerWasEnabled = pickerRef.current;
    pickerRef.current = false;
    elementSelectionRef.current += 1;
    setPicker(false);
    setPicked(null);
    setPickedPreview(null);
    setElementDraft(null);
    setCommentText("");
    setPickerPurpose(null);
    setStatus(t("design.preview.capturing"));
    try {
      if (pickerWasEnabled) {
        pickerCommandRef.current = pickerCommandRef.current
          .catch(() => undefined)
          .then(() => previewPickerToggle(false));
        await pickerCommandRef.current;
      }
      const result = await requestCapture("viewport");
      if (latestRef.current.sessionId !== sessionId) return;
      setCapture(result.dataUrl); setAnnotations([]); setTextDraft(null); setFeedbackText(""); setStatus(result.clipboardError ?? "");
    } catch (error) { report(error); }
  };
  const cancelCapture = () => {
    drawing.current = null;
    setDrawingAnnotation(null);
    setTextDraft(null);
    setCapture(null);
  };
  const closeCapture = () => {
    const image = capture;
    if (!image) return;
    resultImageRef.current = image;
    resultAnnotationsRef.current = annotations;
    resultFeedbackRef.current = feedbackText;
    setCapture(null);
    void previewResultShow(image, t("design.preview.annotationReady"), annotations.length).catch(report);
  };
  const sendFeedback = async () => {
    const image = capture;
    if (!image) return;
    // 发出去了就直接收起标注层。这里不能走 closeCapture:它会弹原生结果卡
    // 再问一次「下载 / 发送到对话」——对一件已经做完的事二次追问。结果卡只
    // 服务「关掉标注但还没发」那条路。
    if (await submitFeedback(image, annotations, feedbackText)) cancelCapture();
  };

  const point = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };
  const commitTextDraft = (draft = textDraft) => {
    const text = draft?.text.trim();
    if (draft && text) setAnnotations((all) => [...all, { kind: "text", x: draft.x, y: draft.y, text }]);
    setTextDraft(null);
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = point(e);
    if (tool === "text") {
      e.preventDefault();
      setTextDraft({ ...p, text: "" });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const next: DrawingAnnotation = tool === "rect" ? { kind: "rect", ...p, width: 0, height: 0 } : { kind: "pen", points: [p] };
    drawing.current = next;
    setDrawingAnnotation(next);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const current = drawing.current;
    if (!current) return;
    const p = point(e);
    const next: DrawingAnnotation = current.kind === "rect"
      ? { ...current, width: p.x - current.x, height: p.y - current.y }
      : { ...current, points: [...current.points, p] };
    drawing.current = next;
    setDrawingAnnotation(next);
  };
  const onPointerCancel = () => {
    drawing.current = null;
    setDrawingAnnotation(null);
  };
  const onPointerUp = () => {
    if (!drawing.current) return;
    const next = drawing.current; drawing.current = null;
    setDrawingAnnotation(null);
    setAnnotations((all) => [...all, next]);
  };

  const previewTarget = target.kind === "artifact" ? target.path : address;
  const submitElementComment = async () => {
    if (!picked || !commentText.trim() || feedbackSendingRef.current) return;
    const request = ++commentRequestRef.current;
    const selected = picked;
    const selectedTarget = latestRef.current.targetKey;
    feedbackSendingRef.current = true;
    setFeedbackSending(true);
    try {
      const text = [
        t("design.preview.commentPrompt"),
        `${target.kind === "artifact" ? t("design.preview.filePath") : "URL"}: ${previewTarget}`,
        `${t("design.preview.elementSelector")}: ${picked.selector}`,
        `${t("design.preview.elementTag")}: ${picked.tag}`,
        `${t("design.preview.commentContent")}: ${commentText.trim()}`,
      ].join("\n");
      const accepted = await composer.sendWithFiles(text, [new File([JSON.stringify({ target: previewTarget, comment: commentText.trim(), element: picked }, null, 2)], "element-comment.json", { type: "application/json" })]);
      if (commentRequestRef.current !== request || pickedRef.current !== selected || latestRef.current.targetKey !== selectedTarget) return;
      if (!accepted) { setStatus(t("design.preview.feedbackFailed")); return; }
      setPicked(null); setCommentText(""); setPickerPurpose(null); setStatus(t("design.preview.commentSent"));
    } catch (error) {
      if (commentRequestRef.current === request && pickedRef.current === selected && latestRef.current.targetKey === selectedTarget) report(error);
    }
    finally { feedbackSendingRef.current = false; setFeedbackSending(false); }
  };
  const dismissPicked = () => {
    pickedPreviewRequestRef.current += 1;
    setPicked(null);
    setPickedPreview(null);
    setElementDraft(null);
  };
  const saveElement = async () => {
    if (!picked || !elementDraft || elementSavingRef.current) return;
    const original = elementDraftOf(picked);
    const edits = (["text", ...Object.keys(EMPTY_ELEMENT_STYLES)] as ("text" | StyleProperty)[])
      .filter((name) => elementDraft[name] !== original[name])
      .map((name) => ({ selector: picked.selector, property: name, value: elementDraft[name] }));
    let applied = 0;
    elementSavingRef.current = true;
    setElementSaving(true);
    try {
      for (const edit of edits) {
        await previewElementApply(edit);
        applied += 1;
      }
    } catch (error) {
      try {
        while (applied > 0) {
          await previewElementUndo();
          applied -= 1;
        }
        report(error);
      } catch (rollbackError) {
        report(new Error(`${error instanceof Error ? error.message : String(error)}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`));
      }
      return;
    } finally {
      elementSavingRef.current = false;
      setElementSaving(false);
    }
    setStatus(t("design.preview.applied"));
    dismissPicked();
  };
  const deleteElement = async () => {
    if (!picked || elementSavingRef.current) return;
    elementSavingRef.current = true;
    setElementSaving(true);
    try {
      await previewElementApply({ selector: picked.selector, property: "delete", value: "" });
    } catch (error) {
      report(error);
      return;
    } finally {
      elementSavingRef.current = false;
      setElementSaving(false);
    }
    setStatus(t("design.preview.applied"));
    dismissPicked();
  };
  const updateElementDraft = (property: "text" | StyleProperty, value: string) => {
    setElementDraft((draft) => draft ? { ...draft, [property]: value } : draft);
  };
  const overlayBounds = overlayRef.current?.getBoundingClientRect();
  const selectedPreviewPosition = (() => {
    const hostRect = hostRef.current?.getBoundingClientRect();
    return {
      left: (hostRect?.left ?? 0) - (overlayBounds?.left ?? 0),
      top: (hostRect?.top ?? 0) - (overlayBounds?.top ?? 0),
      width: hostRect?.width ?? 0,
      height: hostRect?.height ?? 0,
    };
  })();
  const selectedElementLeft = selectedPreviewPosition.left + (picked?.bounds.x ?? 0);
  const selectedElementTop = selectedPreviewPosition.top + (picked?.bounds.y ?? 0);
  const selectedElementBottom = selectedElementTop + (picked?.bounds.height ?? 0);
  const overlayWidth = overlayBounds?.width ?? 0;
  const overlayHeight = overlayBounds?.height ?? 0;
  const selectedElementDialogWidth = Math.min(352, Math.max(0, overlayWidth - 24));
  const selectedElementDialogLeft = Math.max(12, overlayWidth > 0
    ? Math.min(selectedElementLeft, overlayWidth - selectedElementDialogWidth - 12)
    : selectedElementLeft);
  const selectedElementDialogBelowTop = Math.max(12, selectedElementBottom + 8);
  const selectedElementDialogBelowSpace = Math.max(0, overlayHeight - selectedElementDialogBelowTop - 12);
  const selectedElementDialogAboveSpace = Math.max(0, selectedElementTop - 20);
  const selectedElementDialogRoom = Math.max(0, overlayHeight - 24);
  const selectedElementDialogPreferredHeight = Math.min(320, selectedElementDialogRoom);
  // 选中元素占满视口(点到 section/body 这类大块)时,元素上下都挤不出空间,
  // 继续「贴着元素放」会把 maxHeight 算成 0——弹窗还在 DOM 里但高度为零,
  // 现象就是「选中了却什么都没弹」。侧边栏形态(2026-08-30)比旧的宽 aside
  // 矮窄得多,这一档必现。放不下时改为盖住元素、用满可用高度:挡住一部分
  // 预览也好过一个不可见的弹窗。
  const selectedElementDialogFits = overlayHeight > 0
    && Math.max(selectedElementDialogBelowSpace, selectedElementDialogAboveSpace)
      >= Math.min(SELECTED_DIALOG_MIN_HEIGHT, selectedElementDialogPreferredHeight);
  const selectedElementDialogAbove = selectedElementDialogFits
    && selectedElementDialogBelowSpace < selectedElementDialogPreferredHeight
    && selectedElementDialogAboveSpace > selectedElementDialogBelowSpace;
  // overlayHeight 尚未量到(首帧/隐藏态)时不设上限,交给自然高度,
  // 免得靠一个陈旧的 0 把弹窗压没。
  const selectedElementDialogStyle = overlayHeight <= 0
    ? { left: selectedElementDialogLeft, top: 12 }
    : !selectedElementDialogFits
      ? { left: selectedElementDialogLeft, top: 12, maxHeight: selectedElementDialogRoom }
      : selectedElementDialogAbove
        ? { left: selectedElementDialogLeft, bottom: Math.max(12, overlayHeight - selectedElementTop + 8), maxHeight: selectedElementDialogAboveSpace }
        : { left: selectedElementDialogLeft, top: selectedElementDialogBelowTop, maxHeight: selectedElementDialogBelowSpace };

  return (
    // 嵌入形态(2026-08-30 侧边栏定案):宽度/拖宽/关闭都上收到 SidePanel,
    // 本体只负责填满侧边栏的「预览」tab 区
    <section aria-label={t("design.preview.workbench")} className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-base-100">
      <div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-base-300 px-2">
        <button aria-label={t("design.preview.chooseFile")} className="btn btn-ghost btn-square btn-xs" onClick={() => { const open = !filesOpen; setFilesOpen(open); if (open && previewFiles === null) void loadFiles(); }}><IconFolder size={14} /></button>
        {/* 地址栏常驻(2026-08-30):此前只在 localhost 目标下渲染,而切到
            localhost 的唯一途径是 agent 在消息里打印过 URL——自己起的 dev
            server 就永远进不来。artifact 态回填文件路径,键入 localhost 地址
            回车即切换目标。 */}
        <input
          aria-label={t("design.preview.address")}
          placeholder={t("design.preview.addressPlaceholder")}
          title={target.kind === "artifact" ? target.path : address}
          className="input input-xs min-w-24 flex-1 font-mono"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate()}
        />
        <button className="btn btn-ghost btn-square btn-xs" title={t("design.preview.navigate")} onClick={navigate}>→</button>
        {(target.kind === "localhost" || (target.kind === "artifact" && target.artifactKind === "html")) &&
          <button className="btn btn-ghost btn-square btn-xs" title={t("design.preview.reload")} onClick={() => { if (inlineFallback) { setInlineReload((n) => n + 1); return; } void previewReload().catch(report); }}><IconRefresh size={14} stroke={1.75} /></button>}
        {filesOpen && <div className="absolute inset-x-2 top-10 z-40 max-h-72 overflow-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
          <div className="flex gap-1"><input autoFocus aria-label={t("design.preview.searchFiles")} className="input input-xs min-w-0 flex-1" placeholder={t("design.preview.searchPlaceholder")} value={fileQuery} onChange={(e) => setFileQuery(e.target.value)} /><button className="btn btn-ghost btn-xs" disabled={filesLoading} onClick={() => void loadFiles()}><IconRefresh size={13} /> {t("design.preview.refresh")}</button></div>
          {filesTruncated && <p className="py-1 text-xs text-warning">{t("design.preview.truncated")}</p>}
          <div className="mt-1 flex flex-col">{visibleFiles.map((file) => <button key={file.path} className="btn btn-ghost btn-sm h-auto min-h-8 justify-start font-mono text-xs" title={file.path} onClick={() => { openTarget(targetForFile(file)); setFilesOpen(false); }}>{file.path}</button>)}</div>
          {!filesLoading && visibleFiles.length === 0 && <p className="p-2 text-xs text-base-content/60">{t("design.preview.empty")}</p>}
        </div>}
      </div>
      {native && <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b border-base-300 px-2 py-1">
        {Object.entries(PRESETS).map(([name]) => {
          const Icon = name === "desktop" ? IconDeviceDesktop : name === "tablet" ? IconDeviceTablet : IconDeviceMobile;
          const label = t(`design.preview.device.${name}` as MessageKey);
          return <button key={name} className={`btn btn-square btn-xs ${preset === name ? "btn-active" : "btn-ghost"}`} title={label} aria-label={label} onClick={() => setPreset(name as keyof typeof PRESETS)}><Icon size={14} stroke={1.75} /></button>;
        })}
        {/* Linux 内嵌降级:代码页(序列化)与四个动作都依赖对原生 webview 的
            eval,整组隐藏;缩放改走 iframe 的 CSS zoom,不发原生命令 */}
        {!inlineFallback && (<>
          <div role="tablist" className="tabs tabs-box tabs-xs ms-1">
            <button role="tab" className={`tab ${tab === "preview" ? "tab-active" : ""}`} onClick={() => { setTab("preview"); requestAnimationFrame(() => void previewShow().then(bounds).catch(report)); }}>{t("design.preview.tab.preview")}</button>
            <button role="tab" className={`tab ${tab === "code" ? "tab-active" : ""}`} onClick={() => void serialize()}><IconCode size={12} stroke={1.75} /> {t("design.preview.tab.code")}</button>
          </div>
          {/* 四个动作两两相似(截图/标记都出图,注释/编辑都要选元素),标签本身
              分不出差别——tooltip 一律说「点完得到什么」,并点明去向:截图只进
              剪贴板、编辑只改预览,另两个才发进对话。 */}
          <button title={t("design.preview.screenshotTip")} className="btn btn-ghost btn-xs ms-auto" onClick={() => void takeScreenshot()}><IconCamera size={13} stroke={1.75} /> {t("design.preview.screenshot")}</button>
          <button title={picker && pickerPurpose === "comment" ? t("design.preview.exitTip") : t("design.preview.annotateTip")} className={`btn btn-xs ${picker && pickerPurpose === "comment" ? "btn-primary" : "btn-ghost"}`} onClick={() => void togglePicker("comment")}><IconMessage size={13} stroke={1.75} /> {t("design.preview.annotate")}</button>
          <button title={capture ? t("design.preview.exitTip") : t("design.preview.markTip")} className={`btn btn-xs ${capture ? "btn-primary" : "btn-ghost"}`} onClick={() => capture ? cancelCapture() : void startCapture()}><IconPencil size={13} stroke={1.75} /> {t("design.preview.mark")}</button>
          <button title={picker && pickerPurpose === "edit" ? t("design.preview.exitTip") : t("design.preview.editTip")} className={`btn btn-xs ${picker && pickerPurpose === "edit" ? "btn-primary" : "btn-ghost"}`} onClick={() => void togglePicker("edit")}><IconPointer size={13} stroke={1.75} /> {t("design.preview.edit")}</button>
        </>)}
        <select aria-label={t("design.preview.zoom")} className={`select select-xs w-20 ${inlineFallback ? "ms-auto" : ""}`} value={zoom} onChange={(e) => { const n = Math.min(500, Math.max(10, Number(e.target.value))); setZoom(n); if (!inlineFallback) void previewSetZoom(n / 100).catch(report); }}>
          {[10, 25, 50, 75, 100, 125, 150, 200, 300, 400, 500].map((n) => <option key={n} value={n}>{n}%</option>)}
        </select>
      </div>}
      {status && <div role="status" className="shrink-0 border-b border-base-300 px-3 py-1 text-xs text-base-content/60">{status}</div>}
      <div ref={overlayRef} className="relative min-h-0 flex-1 overflow-hidden bg-base-200">
        {target.kind === "artifact" && target.artifactKind !== "html" ? (
          artifact?.kind === "image" ? <div className="flex size-full items-center justify-center overflow-auto p-2"><img src={artifact.dataUrl} alt={artifact.path} className="max-h-full max-w-full" /></div>
          : artifact?.kind === "text" ? <div className="size-full overflow-auto"><CodeView path={artifact.path} text={artifact.content} /></div>
          : null
        ) : tab === "preview" ? (
          <div className="flex size-full justify-center overflow-auto p-2">
            <div ref={hostRef} data-preview-host="" style={{ width: preset === "desktop" ? "100%" : `min(100%, ${PRESETS[preset]}px)` }} className="h-full min-w-40 bg-base-100">
              {inlineFallback && native ? (
                /* Linux 内嵌预览:DOM iframe,层级/摆位天然正确,浮层遮挡
                   无需冻结帧;key 带 targetKey 与 reload 计数,切目标/刷新
                   即重载;缩放走 WebKit 的 CSS zoom */
                <iframe
                  key={`${targetKey}:${inlineReload}`}
                  title={t("design.preview.workbench")}
                  src={target.kind === "localhost"
                    ? normalizePreviewUrl(target.url) ?? "about:blank"
                    : target.kind === "artifact"
                      ? artifactInlineUrl(target.path)
                      : "about:blank"}
                  className="size-full border-0"
                  style={{ zoom: zoom / 100 }}
                />
              ) : obscured && native ? (
                /* 原生 webview 被浮层(菜单/模态)顶避让时,宿主垫冻结帧,
                   预览在用户眼里不消失(「预览直接消失了」的报障);截帧
                   失败才退文字说明,浮层一关 previewShow 即还原 */
                obscuredFreeze ? (
                  <img src={obscuredFreeze} alt="" aria-hidden className="size-full object-fill" />
                ) : (
                  <div role="status" className="flex h-full items-center justify-center px-4 text-center text-xs text-base-content/40">
                    {t("design.preview.obscuredHint")}
                  </div>
                )
              ) : null}
            </div>
          </div>
        ) : (
          <div
            className="flex size-full flex-col gap-2 p-2"
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
                event.preventDefault();
                setFindOpen(true);
                requestAnimationFrame(() => { findInputRef.current?.focus(); findInputRef.current?.select(); });
              } else if (findOpen && event.key === "Escape") {
                event.preventDefault();
                closeFind();
              }
            }}
          >
            {findOpen && <div role="search" className="flex shrink-0 items-center gap-1 rounded-field border border-base-300 bg-base-100 p-1 shadow-sm">
              <input
                ref={findInputRef}
                aria-label={t("design.preview.code.find")}
                className="input input-xs min-w-0 flex-1 font-mono"
                value={findQuery}
                onChange={(event) => { setFindQuery(event.target.value); setActiveMatch(0); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    selectMatch(activeMatch + (event.shiftKey ? -1 : 1));
                  }
                }}
              />
              <span aria-live="polite" className="min-w-12 text-center text-[11px] tabular-nums text-base-content/60">
                {findMatches.length === 0 ? `0 / 0` : `${activeMatch + 1} / ${findMatches.length}`}
              </span>
              <button type="button" className="btn btn-ghost btn-square btn-xs" aria-label={t("design.preview.code.previousMatch")} disabled={findMatches.length === 0} onClick={() => selectMatch(activeMatch - 1)}>↑</button>
              <button type="button" className="btn btn-ghost btn-square btn-xs" aria-label={t("design.preview.code.nextMatch")} disabled={findMatches.length === 0} onClick={() => selectMatch(activeMatch + 1)}>↓</button>
              <button type="button" className="btn btn-ghost btn-square btn-xs" aria-label={t("design.preview.code.closeFind")} onClick={closeFind}><IconX size={13} /></button>
            </div>}
            <textarea ref={htmlRef} aria-label={t("design.preview.code.html")} wrap="off" className="textarea size-full min-h-0 min-w-0 flex-1 resize-none overflow-auto whitespace-pre font-mono text-xs" value={html} onChange={(e) => { setHtml(e.target.value); setActiveMatch(0); }} />
            <div className="flex gap-2">
              <input aria-label={t("design.preview.code.path")} className="input input-sm min-w-0 flex-1 font-mono" value={savePath} onChange={(e) => setSavePath(e.target.value)} />
              <button className="btn btn-primary btn-sm" onClick={() => void saveHtml()}>{t("design.preview.code.save")}</button>
            </div>
          </div>
        )}
        {picked && (
          <div className="absolute inset-0 z-10 pointer-events-none">
          {pickedPreview && <img src={pickedPreview} alt="" className="absolute object-fill" style={selectedPreviewPosition} />}
          <div
            role="dialog"
            aria-label={t("design.preview.element")}
            className="pointer-events-auto absolute w-[352px] max-w-[calc(100%-1.5rem)] overflow-auto rounded-box border border-primary/25 bg-base-100 p-4 shadow-2xl ring-1 ring-primary/10"
            style={selectedElementDialogStyle}
          >
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-field bg-primary/12 text-primary">
                {pickerPurpose === "comment" ? <IconMessage size={16} stroke={1.8} /> : <IconPointer size={16} stroke={1.8} />}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-base-content/60">{t("design.preview.element")}</span>
                <div className="mt-1 min-w-0">
                  <strong className="block truncate rounded-field bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-medium text-primary" title={picked.selector}>{picked.tag} · {picked.selector}</strong>
                </div>
              </div>
              <button aria-label={t("design.preview.close")} className="btn btn-ghost btn-square btn-xs -me-1 -mt-1 hover:bg-primary/10 hover:text-primary" disabled={elementSaving} onClick={dismissPicked}><IconX size={14} /></button>
            </div>
            <dl className="mt-3 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 rounded-box border border-base-300 bg-base-200/60 px-3 py-2.5 text-xs">
              <dt className="text-base-content/50">{t("design.preview.elementSize")}</dt>
              <dd className="font-medium">{Math.round(picked.bounds.width)}×{Math.round(picked.bounds.height)}</dd>
              <dt className="text-base-content/50">{t("design.preview.elementText")}</dt>
              <dd className="truncate font-medium" title={picked.text}>{picked.text || "—"}</dd>
            </dl>
            {pickerPurpose === "comment" ? <>
              <label className="mt-3 block text-xs font-medium text-base-content/70">
                <span>{t("design.preview.commentContent")}</span>
                <textarea autoFocus aria-label={t("design.preview.commentContent")} placeholder={t("design.preview.commentPlaceholder")} className="textarea mt-1.5 min-h-24 w-full resize-none border-base-300 bg-base-100 text-sm leading-5 transition-[border-color,box-shadow] placeholder:text-base-content/35 focus:border-primary focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_15%,transparent)]" value={commentText} onChange={(e) => setCommentText(e.target.value)} />
              </label>
              <div className="mt-3 flex justify-end border-t border-base-300 pt-3"><button className="btn btn-primary btn-sm min-w-28" disabled={feedbackSending || !commentText.trim()} onClick={() => void submitElementComment()}><IconSend size={14} /> {t("design.preview.sendComment")}</button></div>
            </> : elementDraft && <>
              <section className="mt-3">
                <label className="block text-[10px] font-medium uppercase tracking-wide text-base-content/55">
                  {t("design.preview.section.content")}
                  <textarea aria-label={t("design.preview.elementText")} className="textarea textarea-sm mt-1.5 min-h-20 w-full resize-y font-mono text-xs" value={elementDraft.text} onChange={(e) => updateElementDraft("text", e.target.value)} />
                </label>
              </section>
              <section className="mt-3 border-t border-base-300 pt-3">
                <h3 className="text-[10px] font-medium uppercase tracking-wide text-base-content/55">{t("design.preview.section.size")}</h3>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {(["width", "height"] as const).map((name) => <label key={name} className="input input-xs flex min-w-0 items-center gap-1 px-2 text-[10px] text-base-content/50">
                    <span>{t(`design.preview.property.${name}` as MessageKey)}</span>
                    <input aria-label={t(`design.preview.property.${name}` as MessageKey)} className="min-w-0 flex-1 text-right text-xs text-base-content" value={elementDraft[name]} onChange={(e) => updateElementDraft(name, e.target.value)} />
                  </label>)}
                </div>
              </section>
              <section className="mt-3 border-t border-base-300 pt-3">
                <h3 className="text-[10px] font-medium uppercase tracking-wide text-base-content/55">{t("design.preview.section.layout")}</h3>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {(["justifyContent", "alignItems"] as const).map((name) => {
                    const options = name === "justifyContent" ? ["normal", "flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"] : ["normal", "stretch", "flex-start", "center", "flex-end", "baseline"];
                    return <ElementSelect
                      key={name}
                      label={t(`design.preview.property.${name}` as MessageKey)}
                      value={elementDraft[name]}
                      options={options}
                      onChange={(value) => updateElementDraft(name, value)}
                    />;
                  })}
                </div>
              </section>
              <section className="mt-3 border-t border-base-300 pt-3">
                <h3 className="text-[10px] font-medium uppercase tracking-wide text-base-content/55">{t("design.preview.section.box")}</h3>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <ElementColorInput label={t("design.preview.property.backgroundColor")} value={elementDraft.backgroundColor} onChange={(value) => updateElementDraft("backgroundColor", value)} />
                  <label className="input input-xs flex min-w-0 items-center gap-1 px-2 text-[10px] text-base-content/50">
                    <span>{t("design.preview.property.opacity")}</span>
                    <input aria-label={t("design.preview.property.opacity")} className="min-w-0 flex-1 text-right text-xs text-base-content" value={elementDraft.opacity} onChange={(e) => updateElementDraft("opacity", e.target.value)} />
                  </label>
                </div>
              </section>
              <section className="mt-3">
                <h3 className="text-xs font-medium text-base-content/65">{t("design.preview.section.style")}</h3>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <ElementColorInput label={t("design.preview.property.color")} value={elementDraft.color} onChange={(value) => updateElementDraft("color", value)} />
                  <label className="input input-xs flex min-w-0 items-center gap-1 px-2 text-[10px] text-base-content/50">
                    <span>{t("design.preview.property.fontSize")}</span>
                    <input aria-label={t("design.preview.property.fontSize")} className="min-w-0 flex-1 text-right text-xs text-base-content" value={elementDraft.fontSize} onChange={(e) => updateElementDraft("fontSize", e.target.value)} />
                  </label>
                </div>
              </section>
              {(["padding", "margin"] as const).map((group) => <section key={group} className="mt-3">
                <h3 className="text-xs font-medium text-base-content/65">{t(`design.preview.section.${group}` as MessageKey)}</h3>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {(["Top", "Right", "Bottom", "Left"] as const).map((side) => {
                    const name = `${group}${side}` as StyleProperty;
                    return <label key={name} className="input input-xs flex min-w-0 items-center gap-1 px-2 text-[10px] text-base-content/50">
                      <span>{side[0]}</span>
                      <input aria-label={`${t(`design.preview.section.${group}` as MessageKey)} ${side}`} className="min-w-0 flex-1 text-right text-xs text-base-content" value={elementDraft[name]} onChange={(e) => updateElementDraft(name, e.target.value)} />
                    </label>;
                  })}
                </div>
              </section>)}
              <section className="mt-3">
                <h3 className="text-xs font-medium text-base-content/65">{t("design.preview.section.border")}</h3>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {(["Top", "Right", "Bottom", "Left"] as const).map((side) => {
                    const name = `border${side}Width` as StyleProperty;
                    return <label key={name} className="input input-xs flex min-w-0 items-center gap-1 px-2 text-[10px] text-base-content/50">
                      <span>{side[0]}</span>
                      <input aria-label={`${t("design.preview.section.border")} ${side}`} className="min-w-0 flex-1 text-right text-xs text-base-content" value={elementDraft[name]} onChange={(e) => updateElementDraft(name, e.target.value)} />
                    </label>;
                  })}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <ElementSelect
                    label={t("design.preview.property.borderStyle")}
                    value={elementDraft.borderStyle}
                    options={["none", "solid", "dashed", "dotted", "double"]}
                    onChange={(value) => updateElementDraft("borderStyle", value)}
                    openAbove
                  />
                  <ElementColorInput label={t("design.preview.property.borderColor")} value={elementDraft.borderColor} onChange={(value) => updateElementDraft("borderColor", value)} />
                </div>
                <label className="input input-xs mt-1.5 flex items-center gap-1 px-2 text-[10px] text-base-content/50">
                  <span>{t("design.preview.property.borderRadius")}</span>
                  <input aria-label={t("design.preview.property.borderRadius")} className="min-w-0 flex-1 text-right text-xs text-base-content" value={elementDraft.borderRadius} onChange={(e) => updateElementDraft("borderRadius", e.target.value)} />
                </label>
              </section>
              <div className="sticky -bottom-4 mt-3 flex items-center gap-1 border-t border-base-300 bg-base-100 py-3">
                <button aria-label={t("design.preview.property.delete")} className="btn btn-ghost btn-square btn-sm text-error" disabled={elementSaving} onClick={() => void deleteElement()}><IconTrash size={15} /></button>
                <button className="btn btn-ghost btn-sm ms-auto" disabled={elementSaving} onClick={dismissPicked}>{t("design.preview.cancel")}</button>
                <button className="btn btn-primary btn-sm min-w-16" disabled={elementSaving} onClick={() => void saveElement()}>{t("design.preview.save")}</button>
              </div>
            </>}
          </div>
          </div>
        )}
        {capture && (
          <div className="absolute inset-0 z-20 flex flex-col bg-base-200 p-2">
            <div className="flex shrink-0 flex-wrap items-center gap-1 pb-2">
              {([['rect', IconSquare], ['pen', IconPencil], ['text', IconCode]] as const).map(([name, Icon]) => <button key={name} className={`btn btn-xs ${tool === name ? "btn-active" : "btn-ghost"}`} onClick={() => { setTool(name); setTextDraft(null); }}><Icon size={13} /> {t(`design.preview.capture.${name}` as MessageKey)}</button>)}
              <button className="btn btn-ghost btn-xs ms-auto" onClick={() => setAnnotations((a) => a.slice(0, -1))}><IconArrowBackUp size={13} /> {t("design.preview.undo")}</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setAnnotations([])}><IconTrash size={13} /> {t("design.preview.capture.clear")}</button>
              <button className="btn btn-ghost btn-xs" onClick={() => void downloadAnnotated(capture, annotations).catch(report)}><IconDownload size={13} /> {t("design.preview.capture.download")}</button>
              <button aria-label={t("design.preview.closeCapture")} className="btn btn-ghost btn-square btn-xs" onClick={closeCapture}><IconX size={13} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-box bg-base-300/40 p-1">
              <div className="relative w-fit max-w-full">
                <img src={capture} alt={t("design.preview.capture.image")} className="block max-w-full select-none" draggable={false} />
                <svg aria-label={t("design.preview.capture.surface")} className="absolute inset-0 size-full touch-none" viewBox="0 0 100 100" preserveAspectRatio="none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
                  <rect x="0" y="0" width="100" height="100" fill="transparent" pointerEvents="all" />
                  {[...annotations, ...(drawingAnnotation ? [drawingAnnotation] : [])].map((a, i) => a.kind === "rect" ? <rect key={i} x={Math.min(a.x, a.x + a.width)} y={Math.min(a.y, a.y + a.height)} width={Math.abs(a.width)} height={Math.abs(a.height)} fill="none" stroke="red" strokeWidth="0.5" /> : a.kind === "pen" ? <polyline key={i} points={a.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="red" strokeWidth="0.6" /> : <text key={i} x={a.x} y={a.y} fill="red" fontSize="3">{a.text}</text>)}
                </svg>
                {textDraft && <input
                  autoFocus
                  aria-label={t("design.preview.capture.textInput")}
                  className="input input-sm absolute z-10 min-w-40 border-error bg-base-100/95 text-error shadow-lg focus:outline-none"
                  style={{ left: `${textDraft.x}%`, top: `${textDraft.y}%`, transform: "translateY(-50%)" }}
                  value={textDraft.text}
                  onChange={(e) => setTextDraft((draft) => draft ? { ...draft, text: e.target.value } : null)}
                  onBlur={(e) => { if (e.currentTarget.dataset.cancelled !== "true") commitTextDraft(); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitTextDraft(); }
                    if (e.key === "Escape") { e.currentTarget.dataset.cancelled = "true"; setTextDraft(null); }
                  }}
                />}
              </div>
            </div>
            <div className="mt-2 flex shrink-0 items-end gap-2 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm transition-[border-color,box-shadow] focus-within:border-primary focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_12%,transparent)]">
              <textarea
                aria-label={t("design.preview.capture.feedbackInput")}
                placeholder={t("design.preview.capture.feedbackPlaceholder")}
                className="min-h-10 max-h-28 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 outline-none placeholder:text-base-content/35"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
              />
              <button aria-label={t("design.preview.capture.send")} className="btn btn-primary btn-circle btn-sm shrink-0" disabled={feedbackSending} onClick={() => void sendFeedback()}><IconSend size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
