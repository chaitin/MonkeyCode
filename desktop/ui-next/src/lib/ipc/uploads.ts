// 附件域:对话附件的上传/选择/原生拖放。IPC 原语在 ipc.ts;命令面契约 =
// 壳侧 uploads.rs 与 driver/mod.rs(upload_begin/chunk/finish/abort、
// upload_file_path、stat_dropped_file)。
// 上传大小不设限,两条通道:
// - 分块(uploadFileStream):只有内容的来源(粘贴/HTML5 拖拽),每块 4MB
//   base64 过 IPC,内存与单条消息都有界;任一块失败或取消即 upload_abort
//   销档(壳删半成品 .part)。
// - 路径直拷(uploadFilePath):拿得到真实路径的来源(系统文件对话框、
//   Linux 原生拖拽),壳侧 fs::copy,内容零穿越 IPC。
import { inDesktopShell, invoke, listen } from "./ipc";

export const CHUNK_BYTES = 4 * 1024 * 1024;

/** ArrayBuffer → base64(btoa 走二进制字符串,分 32KB 段拼,防超长参数栈溢出)。 */
export function b64OfBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export interface UploadStreamOptions {
  /** 每块落地回调一次(已发/总字节),供 UI 外显进度。 */
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** 取消信号:置位后当前块收尾即中止,壳侧 upload_abort 销档。 */
  signal?: AbortSignal;
  /** 块大小(默认 4MB;测试用小块钉边界)。 */
  chunkBytes?: number;
}

/** 按已开句柄推完内容并收尾(会话 upload_begin 与待办 todo_upload_begin
 * 两个开档命令面共用这条循环与壳侧句柄表):任一块失败/取消即 upload_abort
 * 销档,错误原样上抛(取消抛 AbortError)。 */
export async function streamToHandle(
  handle: number,
  f: File,
  opts: UploadStreamOptions = {},
): Promise<{ path: string }> {
  const chunkBytes = opts.chunkBytes ?? CHUNK_BYTES;
  try {
    for (let off = 0; off < f.size; off += chunkBytes) {
      if (opts.signal?.aborted) throw new DOMException("upload aborted", "AbortError");
      const buf = await f.slice(off, off + chunkBytes).arrayBuffer();
      await invoke("upload_chunk", { handle, data: b64OfBytes(buf) });
      opts.onProgress?.(Math.min(off + chunkBytes, f.size), f.size);
    }
    if (opts.signal?.aborted) throw new DOMException("upload aborted", "AbortError");
    return await invoke<{ path: string }>("upload_finish", { handle });
  } catch (e) {
    void invoke("upload_abort", { handle }).catch(() => {});
    throw e;
  }
}

/** 分块上传文件内容到会话工作区 .monkeycode/uploads/,返回工作区相对路径。
 * 原始文件名尽量保留(壳清洗);剪贴板截图可为空名。失败/取消时 abort
 * 销档,错误原样上抛(取消抛 AbortError)。 */
export async function uploadFileStream(
  sessionId: string,
  f: File,
  opts: UploadStreamOptions = {},
): Promise<{ path: string }> {
  const { handle } = await invoke<{ handle: number }>("upload_begin", {
    id: sessionId,
    name: f.name,
    mediaType: f.type,
  });
  return streamToHandle(handle, f, opts);
}

/** 按源路径把本地文件直拷进会话 uploads 目录(内容零穿越 IPC)。 */
export function uploadFilePath(sessionId: string, src: string): Promise<{ path: string }> {
  return invoke<{ path: string }>("upload_file_path", { id: sessionId, src });
}

/** 回读本地资源为 data URL(壳 upload_read):uploads 目录内附件放行,
 * 其余路径只放行工作区内常见图片;20MB 上限。Tauri 下 <img> 带不了鉴权头,
 * 也不开 asset scope 到任意工作区,小图 base64 内联最稳(壳侧头注同口径)。 */
export function uploadFileURL(sessionId: string, path: string): Promise<string> {
  return invoke<string>("upload_read", { id: sessionId, path });
}

// path-backed 占位 File:原生拖拽只有路径,造一个空内容、仅元数据的 File
// 走既有 File[] 附件管线,真实内容由壳按路径直拷(nativePathOf 分流)。
// 路径侧带在 WeakMap,不在 File 上挂扩展属性。
const nativePaths = new WeakMap<File, string>();

export function pathBackedFile(path: string, name: string, mediaType: string): File {
  const f = new File([], name, { type: mediaType });
  nativePaths.set(f, path);
  return f;
}

/** 占位 File 的真实路径(非占位返回 undefined)。 */
export const nativePathOf = (f: File): string | undefined => nativePaths.get(f);

/** 系统文件对话框多选附件,返回本地路径列表(取消/浏览器模式返回空)。
 * title 由调用方传入(文案走 i18n,本层不产 UI 词)。 */
export async function pickAttachmentPaths(title?: string): Promise<string[]> {
  if (!inDesktopShell()) return [];
  try {
    const r = await invoke<unknown>("plugin:dialog|open", {
      options: { multiple: true, ...(title ? { title } : {}) },
    });
    if (Array.isArray(r)) return r.filter((x): x is string => typeof x === "string");
    return typeof r === "string" ? [r] : [];
  } catch {
    return [];
  }
}

/** 路径按扩展名判定是否图片(与壳侧 uploads.rs::image_mime 同一张表;
 * 附件行 [图片]/[文件] 前缀与 chip 展示按此分流)。 */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(path);
}

/** 系统对话框选图:非图片路径直接滤掉(待办附件只收图),包成 path-backed
 * 占位 File(内容由壳按路径直拷,不进 webview)。composer/新建任务收所有
 * 类型,不经此门。 */
export async function pickImageFiles(title?: string): Promise<File[]> {
  const paths = await pickAttachmentPaths(title);
  return paths.filter(isImagePath).map((p) => {
    const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
    return pathBackedFile(p, name, "image/*");
  });
}

export interface NativeDropHandlers {
  onDragging(dragging: boolean): void;
  onFiles(files: File[]): void;
  onError?(message: string): void;
  /** 需要文件**内容本体**(云端任务附件要把字节上行对象存储)。
   * 缺省只 stat 元数据造 path-backed 占位 File(0 字节,壳按路径直拷,
   * 大小不设限);置真则经壳 read_dropped_file 读回字节还原成真 File,
   * 保留壳侧整包 20MB 上限。旧 UI nativeDrop.ts:58-66 的同一个分岔——
   * 漏掉它,云端侧拖进来的每个文件都会以「是空文件」告吹(uploadCloudFile
   * 的 size===0 拦截),Linux 壳上拖放对云端任务整个不可用。 */
  wantContent?: boolean;
}

/** base64 → File(壳 read_dropped_file 的回包;data 是整包 base64)。 */
function fileOfDropped(r: { name?: string; mediaType?: string; data?: string }, path: string): File {
  const bin = atob(r.data ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const name = r.name || path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "file";
  return new File([bytes], name, { type: r.mediaType ?? "" });
}

/** 订阅壳的原生文件拖放事件(Linux 壳:WebKitGTK 的 HTML5 拖拽拿不到
 * File,壳保留 Tauri 原生处理器,以 tauri://drag-* 事件送达路径)。
 * 默认只 stat 元数据造 path-backed 占位 File,内容由壳按路径直拷,大小不
 * 设限;wantContent 的调用方(云端)经壳读回字节还原 File。
 * mac/Windows 壳禁用了原生处理器走 DOM 事件,这里的监听永不触发,无副作用。
 * 返回退订函数。 */
export function onNativeFileDrop(h: NativeDropHandlers): () => void {
  const offs = [
    listen("tauri://drag-enter", () => h.onDragging(true)),
    listen("tauri://drag-leave", () => h.onDragging(false)),
    listen<{ paths?: string[] } | null>("tauri://drag-drop", (payload) => {
      h.onDragging(false);
      const paths = payload?.paths ?? [];
      if (!paths.length) return;
      void (async () => {
        const files: File[] = [];
        for (const p of paths) {
          try {
            if (h.wantContent) {
              const r = await invoke<{ name?: string; mediaType?: string; data?: string }>("read_dropped_file", { path: p });
              files.push(fileOfDropped(r, p));
            } else {
              const st = await invoke<{ name?: string; mediaType?: string }>("stat_dropped_file", { path: p });
              const name = st.name || p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "file";
              files.push(pathBackedFile(p, name, st.mediaType ?? ""));
            }
          } catch (e) {
            h.onError?.(e instanceof Error ? e.message : String(e));
          }
        }
        if (files.length) h.onFiles(files);
      })();
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
