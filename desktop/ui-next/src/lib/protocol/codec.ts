// 帧载荷编解码:纯函数,零环境副作用(atob/btoa/TextDecoder 浏览器与
// node 皆为全局,unit(node)单测可直接跑)。归约层只依赖这里。
import type { Frame } from "./types";

/** base64 → UTF-8 文本。atob 只还原"字节串"(每个 charCode 是一个字节),
 * 中文/emoji 必须经 Uint8Array + TextDecoder 重组,直接当字符串用会乱码。
 * 非法 base64 会抛(atob 语义),调用方按场景决定兜底。 */
export function b64decode(s: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
}

/** UTF-8 文本 → base64(b64decode 的逆:先 TextEncoder 取字节再 btoa)。 */
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
 * ① 用户磁盘上的存量 journal(events.jsonl)是旧格式,壳回放原样转发;
 * ② 云端任务流的帧来自云端服务(契约不归本仓库管),实测 data 既有
 *    base64 字符串也有裸对象形态,个别还可能是裸 JSON 字符串——三态都兜。 */
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

/** user-input.content:引擎契约里**始终**是 base64 文本(即使 data 层已是
 * 内联对象,内层 content 仍是 base64)。坏编码回退原文——宁可显示原始串,
 * 不能丢用户的消息。 */
export function decodeUserInput(content: string | undefined | null): string {
  if (!content) return "";
  try {
    return b64decode(content);
  } catch {
    return content;
  }
}

// ==================== 工具载荷的文本提取(归约摘要与详情面板共用) ====================

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

/** 提取 ACP content block(以及本地 {text} 分片)中的纯文本。
 * 云端 block 可能多层嵌套({content:[{content:{text}}]}),深度封顶防环。 */
export function toolContentText(content: unknown, depth = 0): string {
  if (depth > 5 || content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => toolContentText(item, depth + 1)).filter(Boolean).join("\n");
  }
  const source = record(content);
  if (!source) return "";
  if (typeof source.text === "string") return source.text;
  if (source.content !== undefined) return toolContentText(source.content, depth + 1);
  return "";
}

/** rawOutput 的可读正文:本地工具通常直接给字符串,云端常为对象
 * ({output}/{result}/{stdout,stderr}/{error,message} 各形态都见过)。 */
function toolOutputText(rawOutput: unknown): string {
  if (typeof rawOutput === "string") return rawOutput;
  const output = record(rawOutput);
  if (!output) return "";
  if (typeof output.output === "string") return output.output;
  if (typeof output.result === "string") return output.result;
  const stdout = typeof output.stdout === "string" ? output.stdout : "";
  const stderr = typeof output.stderr === "string" ? output.stderr : "";
  if (stdout || stderr) return [stdout, stderr].filter(Boolean).join("\n");
  if (typeof output.error === "string") return output.error;
  if (typeof output.message === "string") return output.message;
  return "";
}

/** 工具结果的可读正文:rawOutput 优先,content block 兜底。 */
export function toolResultText(rawOutput: unknown, content?: unknown): string {
  return toolOutputText(rawOutput) || toolContentText(content);
}
