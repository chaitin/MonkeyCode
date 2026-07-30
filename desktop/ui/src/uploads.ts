// 附件域:对话粘贴/拖入文件的上传与回读。IPC 原语在 ipc.ts。
import { invoke } from "./ipc";

/** 上传对话里粘贴/拖入的文件(图片或任意附件)到会话工作区 .monkeycode/uploads/,
 * 返回工作区相对路径。原始文件名尽量保留(壳清洗);剪贴板截图可传空名。 */
export const uploadFile = (sessionId: string, name: string, mediaType: string, dataB64: string) =>
  invoke<{ path: string }>("upload_file", { id: sessionId, name, mediaType, data: dataB64 });

/** 已上传附件或工作区图片的回读 data URL(<img> 直接可用;壳读盘 base64 内联)。
 * 壳侧只允许上传目录中的附件和工作区内的常见图片。注意:异步,调用方
 * 设置 <img src> 前需 await。 */
export function uploadFileURL(sessionId: string, path: string): Promise<string> {
  return invoke<string>("upload_read", { id: sessionId, path });
}
