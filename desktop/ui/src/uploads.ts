// 附件域:对话粘贴/拖入文件的上传与回读。IPC 原语在 ipc.ts。
// 上传大小不设限,两条通道:
//   分块(uploadFileStream)——只有内容的来源(粘贴/HTML5 拖拽),每块 4MB
//   过 IPC,内存与单条消息都有界;整包 base64 一次穿 IPC 是旧 20MB 上限
//   的根源,已废。
//   路径直拷(uploadFilePath)——拿得到真实路径的来源(Linux 原生拖拽),
//   壳侧 fs::copy,内容零穿越。
import { invoke } from "./ipc";

const CHUNK_BYTES = 4 * 1024 * 1024;

/** ArrayBuffer → base64(btoa 走二进制字符串,分 32KB 段拼,防超长参数栈溢出) */
function b64OfBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** 分块上传文件内容到会话工作区 .monkeycode/uploads/,返回工作区相对路径。
 * 原始文件名尽量保留(壳清洗);剪贴板截图可为空名。任一块失败即 abort
 * 销档(壳删半成品),错误原样上抛。onProgress 每块落地回调一次(已发/总
 * 字节),供 UI 外显进度。 */
export async function uploadFileStream(
  sessionId: string,
  f: File,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): Promise<{ path: string }> {
  const { handle } = await invoke<{ handle: number }>("upload_begin", {
    id: sessionId,
    name: f.name,
    mediaType: f.type,
  });
  try {
    for (let off = 0; off < f.size; off += CHUNK_BYTES) {
      const buf = await f.slice(off, off + CHUNK_BYTES).arrayBuffer();
      await invoke("upload_chunk", { handle, data: b64OfBytes(buf) });
      onProgress?.(Math.min(off + CHUNK_BYTES, f.size), f.size);
    }
    return await invoke<{ path: string }>("upload_finish", { handle });
  } catch (e) {
    void invoke("upload_abort", { handle }).catch(() => {});
    throw e;
  }
}

/** 按源路径把本地文件直拷进会话 uploads 目录(内容零穿越 IPC)。 */
export const uploadFilePath = (sessionId: string, src: string) =>
  invoke<{ path: string }>("upload_file_path", { id: sessionId, src });

// path-backed 占位 File:Linux 原生拖拽只有路径,造一个空内容、仅元数据的
// File 走既有 File[] 附件管线,真实内容由壳按路径直拷(uploadAtt 按
// nativePathOf 分流)。路径侧带在 WeakMap,不在 File 上挂扩展属性。
const nativePaths = new WeakMap<File, string>();

export function pathBackedFile(path: string, name: string, mediaType: string): File {
  const f = new File([], name, { type: mediaType });
  nativePaths.set(f, path);
  return f;
}

/** 占位 File 的真实路径(非占位返回 undefined) */
export const nativePathOf = (f: File): string | undefined => nativePaths.get(f);

/** 已上传附件或工作区图片的回读 data URL(<img> 直接可用;壳读盘 base64 内联)。
 * 壳侧只允许上传目录中的附件和工作区内的常见图片,整包内联限 20MB。
 * 注意:异步,调用方设置 <img src> 前需 await。 */
export function uploadFileURL(sessionId: string, path: string): Promise<string> {
  return invoke<string>("upload_read", { id: sessionId, path });
}
