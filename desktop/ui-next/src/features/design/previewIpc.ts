// Typed, literal command/event boundary for desktop/src/preview.rs. Command names stay
// literal at every invoke call so scripts/check_command_contract.py can audit ACL coverage.
import { invoke, listen, listenAsync } from "@/lib/ipc/ipc";

export interface PreviewBounds { x: number; y: number; width: number; height: number }
export interface ElementBounds { x: number; y: number; width: number; height: number }
export interface ElementStyles {
  color: string; backgroundColor: string; fontSize: string; opacity: string; width: string; height: string;
  justifyContent: string; alignItems: string;
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
  marginTop: string; marginRight: string; marginBottom: string; marginLeft: string;
  borderTopWidth: string; borderRightWidth: string; borderBottomWidth: string; borderLeftWidth: string;
  borderStyle: string; borderColor: string; borderRadius: string;
}
export interface ElementSnapshot { selector: string; text: string; tag: string; bounds: ElementBounds; styles: ElementStyles }
export interface ElementEdit { selector: string; property: string; value: string }
export interface CaptureResult { requestId: string; dataUrl: string; clipboardError?: string }
export interface PreviewError { requestId: string; error: string }
export interface SerializeResult { requestId: string; html: string }
export type ResultAction = "download" | "send" | "close";

export const previewCreate = (url: string, bounds: PreviewBounds) => invoke<void>("preview_create", { url, bounds });
export const previewCreateArtifact = (id: string, path: string, bounds: PreviewBounds) => invoke<void>("preview_create_artifact", { id, path, bounds });
export const previewShow = () => invoke<void>("preview_show");
export const previewHide = () => invoke<void>("preview_hide");
export const previewSetBounds = (bounds: PreviewBounds) => invoke<void>("preview_set_bounds", { bounds });
export const previewNavigate = (url: string) => invoke<void>("preview_navigate", { url });
export const previewReload = () => invoke<void>("preview_reload");
export const previewSetZoom = (scale: number) => invoke<void>("preview_set_zoom", { scale });
export const previewDestroy = () => invoke<void>("preview_destroy");
export const previewPickerToggle = (enabled: boolean) => invoke<void>("preview_picker_toggle", { enabled });
export const previewElementApply = (edit: ElementEdit) => invoke<void>("preview_element_apply", { edit });
export const previewElementUndo = () => invoke<void>("preview_element_undo");
export const previewCapture = (mode: "viewport" | "viewport-no-copy" | "full", requestId: string) => invoke<void>("preview_capture", { mode, requestId });
export const previewSerialize = (requestId: string) => invoke<void>("preview_serialize", { requestId });
export const previewSaveHtml = (sessionId: string, path: string, html: string) => invoke<void>("preview_save_html", { sessionId, path, html });
export const previewResultShow = (dataUrl: string, status: string, commentCount: number) => invoke<void>("preview_result_show", { dataUrl, status, commentCount });
export const previewResultHide = () => invoke<void>("preview_result_hide");

// 原生预览 create/destroy 必须串行(壳侧同一个 LABEL webview),所有生命
// 周期操作都排进这一条队列。此前队列私有在 DesignPreviewWorkbench 模块里,
// 启动清扫要共用才搬到这里。
let lifecycleQueue = Promise.resolve();
let lifecycleUsed = false;

export function enqueuePreviewLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  lifecycleUsed = true;
  const result = lifecycleQueue.then(operation);
  lifecycleQueue = result.then(() => {}, () => {});
  return result;
}

/** App 启动清扫孤儿原生预览:UI 重载(HMR/webview 崩溃恢复)后,上一
 * DOM 纪元创建的原生预览无人认领,会永远浮在所有 DOM 之上。仅当本纪元
 * 还没有任何生命周期操作时才清——有了就说明现任所有者在场,轮不到清扫
 * (壳侧 destroy 对「不存在」宽容,返回 Ok)。 */
export function sweepOrphanPreview(): void {
  if (lifecycleUsed) return;
  void enqueuePreviewLifecycle(() => previewDestroy()).catch(() => {});
}

/** 测试复位:队列与清扫哨兵是模块级状态,跨用例会残留。 */
export function resetPreviewLifecycleForTests(): void {
  lifecycleQueue = Promise.resolve();
  lifecycleUsed = false;
}

export const onPreviewCaptured = (cb: (event: CaptureResult) => void) => listen("preview-captured", cb);
export const onPreviewCaptureError = (cb: (event: PreviewError) => void) => listen("preview-capture-error", cb);
export const onPreviewSerialized = (cb: (event: SerializeResult) => void) => listen("preview-serialized", cb);
export const onPreviewSerializedError = (cb: (event: PreviewError) => void) => listen("preview-serialized-error", cb);
export const onPreviewElementPicked = (cb: (event: ElementSnapshot) => void) => listen("preview-element-picked", cb);
export const onPreviewPickerError = (cb: (error: string) => void) => listen("preview-picker-error", cb);
export const onPreviewResultAction = (cb: (action: ResultAction) => void) => listen("preview-result-action", cb);

const id32 = () => {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (uuid) return uuid;
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
};

/** Register both event listeners before invoke; reject all late/foreign request IDs. */
export async function requestCapture(mode: "viewport" | "viewport-no-copy" | "full", timeoutMs = 20_000): Promise<CaptureResult> {
  const requestId = id32();
  return new Promise<CaptureResult>((resolve, reject) => {
    let settled = false;
    let offOk = () => {};
    let offErr = () => {};
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      offOk(); offErr(); fn();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error("Preview capture timed out"))), timeoutMs);
    void (async () => {
      try {
        offOk = await listenAsync<CaptureResult>("preview-captured", (event) => {
          if (event.requestId === requestId) finish(() => resolve(event));
        });
        offErr = await listenAsync<PreviewError>("preview-capture-error", (event) => {
          if (event.requestId === requestId) finish(() => reject(new Error(event.error)));
        });
        await previewCapture(mode, requestId);
      } catch (error) {
        finish(() => reject(error));
      }
    })();
  });
}

export async function requestSerialization(timeoutMs = 15_000): Promise<string> {
  const requestId = id32();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let offOk = () => {};
    let offErr = () => {};
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      offOk(); offErr(); fn();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error("HTML serialization timed out"))), timeoutMs);
    void (async () => {
      try {
        offOk = await listenAsync<SerializeResult>("preview-serialized", (event) => {
          if (event.requestId === requestId) finish(() => resolve(event.html));
        });
        offErr = await listenAsync<PreviewError>("preview-serialized-error", (event) => {
          if (event.requestId === requestId) finish(() => reject(new Error(event.error)));
        });
        await previewSerialize(requestId);
      } catch (error) {
        finish(() => reject(error));
      }
    })();
  });
}
