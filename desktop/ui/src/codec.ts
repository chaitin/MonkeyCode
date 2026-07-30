// 帧载荷编解码:纯函数,无 DOM/环境副作用(壳连接层 ipc.ts/cloudapi.ts 等
// 依赖 window/crypto 等浏览器环境,node 单测导入需 mock 假壳;归约层只依赖这里)。
import type { Frame } from "./types";

export function b64decode(s: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
}

export function b64encode(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 解开帧 data:唯一收口,UI 内部消费一律走这里,不得直接摸 f.data。
 *
 * 双格式容错(必须保留,不是过渡代码):
 * 新格式 = 内联 JSON 对象(壳 driver/frame.rs 产帧,base64 层已去除);
 * 旧格式 = base64(JSON) 字符串,两条来源决定容错不可拆:
 * ① 用户磁盘上的存量 journal(events.jsonl)是旧格式,壳回放原样转发,
 *    这里必须能读;
 * ② 云端任务流的帧来自云端服务(契约不归本仓库管),实测 data 既有
 *    base64 字符串也有裸对象形态(见 useCloudTask 的 cursor 帧),
 *    个别还可能是裸 JSON 字符串——三态都兜。 */
export function frameData<T = Record<string, unknown>>(f: Frame): T | null {
  const d = f.data;
  if (d === undefined || d === null) return null;
  if (typeof d === "object") return d as T; // 新格式/云端裸对象
  if (typeof d !== "string") return null;
  try {
    return JSON.parse(b64decode(d)) as T; // 旧格式 base64(JSON)
  } catch {
    try {
      return JSON.parse(d) as T; // 云端裸 JSON 字符串兜底
    } catch {
      return null;
    }
  }
}
