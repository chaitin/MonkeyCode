// 云端 VM 终端管道(kind=terminal):协议对齐 web 端 common/terminal.tsx——
// 文本 JSON 帧 {type, data};上行 data=base64(输入)、resize=JSON{row,col}、
// 5s ping;下行 connected / data(base64→xterm)/ resize / error / ping。
// terminal_id 复用优先(对齐 web 终端面板):挂载先拉 VM 的终端列表重连
// 第一个——每次新生成会把孤儿会话在 VM 里越堆越多,shell 上下文也随开关
// 全丢;列表为空或拉取失败才新建。
import { mcTerminalList } from "@/lib/ipc/cloudtasks";
import { b64encode } from "@/lib/protocol/codec";
import { openPipe, type CloudPipe, type OpenPipe, type WsCloseInfo } from "./pipes";

/** 上行 ping 周期(对齐 web 端 5s 保活)。 */
export const TERM_PING_MS = 5000;

/** 上行帧编码(纯函数;CloudTerminal 组件与单测共用)。 */
export const termUplink = {
  data: (input: string) => JSON.stringify({ type: "data", data: b64encode(input) }),
  resize: (row: number, col: number) => JSON.stringify({ type: "resize", data: JSON.stringify({ row, col }) }),
  ping: () => JSON.stringify({ type: "ping" }),
};

export interface TermFrame {
  type?: string;
  data?: string;
}

/** 下行文本帧解析;坏帧返回 null(终端流里偶发脏数据不炸)。 */
export function parseTermFrame(text: string): TermFrame | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" ? (v as TermFrame) : null;
  } catch {
    return null;
  }
}

/** 下行 data 帧 → 终端字节(base64 → Uint8Array,直接喂 xterm.write)。
 *  坏 base64 返回空字节——契约与 parseTermFrame 对齐:终端流里偶发脏数据
 *  (截断帧/URL-safe 变体/服务端异常输出)丢弃即可。裸 atob 会同步抛
 *  InvalidCharacterError,沿 Tauri listen 派发链变成未捕获错误,被
 *  index.html 的全局陷阱画成整屏「启动异常」诊断面板(safeOff 头注记录的
 *  2026-08-12 报障即同型事故)。 */
export function termBytes(dataB64: string): Uint8Array {
  try {
    return Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}

/** 复用优先挑 terminal_id:VM 已有会话重连第一个;列表为空/拉取失败才新建。 */
export async function pickTerminalId(vmId: string, list: typeof mcTerminalList = mcTerminalList): Promise<string> {
  try {
    const r = await list(vmId);
    const existing = (r.terminals ?? []).find((item) => item.id)?.id;
    if (existing) return existing;
  } catch {
    // 列表拉不到不挡路:退回新建
  }
  return crypto.randomUUID();
}

/** 打开终端管道(id=vmId,params.terminal_id 指定会话)。 */
export function connectCloudTerminal(
  vmId: string,
  terminalId: string,
  h: { onText(text: string): void; onClose(info: WsCloseInfo | null): void },
  open: OpenPipe = openPipe,
): Promise<CloudPipe> {
  return open("terminal", vmId, { terminal_id: terminalId }, h.onText, h.onClose);
}
