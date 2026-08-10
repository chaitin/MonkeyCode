// 云端 WS 管道原语(壳做纯文本管道,协议逻辑在 lib/cloud 各层)。
// 铁律(对应壳侧 monkeycode.rs::cloud_ws_open):pipe id 由本层生成,且
// **先 await 注册 ws-msg:{pipe} 与 ws-closed:{pipe} 监听再 invoke
// cloud_ws_open**——attach 回放在连上瞬间就开始下发,后注册会丢头帧。
import { invoke, listenAsync } from "@/lib/ipc/ipc";

/** ws-closed 事件载荷:服务端 Close 帧的 code/reason(壳透传);
 * 异常断开(无 Close 帧)或壳侧主动断为 null。 */
export interface WsCloseInfo {
  code?: number;
  reason?: string;
}

export interface CloudPipe {
  /** 上行一帧文本;壳侧发送失败 reject(调用方必须外显,不能静默吞)。 */
  send(text: string): Promise<void>;
  close(): void;
}

export type PipeKind = "stream" | "control" | "terminal";

/** openPipe 的函数形状(stream/control/terminal 状态机经它注入假传输做单测)。 */
export type OpenPipe = (
  kind: PipeKind,
  id: string,
  params: Record<string, unknown>,
  onText: (text: string) => void,
  onClose: (info: WsCloseInfo | null) => void,
) => Promise<CloudPipe>;

/** 打开一条云端 WS 管道:onText 收下行文本帧,onClose 收断开(带服务端
 * 关闭原因,异常断开为 null)。open 失败时 reject 并撤掉监听。 */
export const openPipe: OpenPipe = async (kind, id, params, onText, onClose) => {
  const pipe = crypto.randomUUID();
  let closed = false;
  const unMsg = await listenAsync<string>(`ws-msg:${pipe}`, (p) => onText(p));
  const unClosed = await listenAsync<WsCloseInfo | null>(`ws-closed:${pipe}`, (p) => {
    if (closed) return;
    closed = true;
    unMsg();
    unClosed();
    onClose(p ?? null);
  });
  try {
    await invoke("cloud_ws_open", { kind, id, params, pipe });
  } catch (e) {
    unMsg();
    unClosed();
    throw e;
  }
  return {
    send(text: string) {
      return invoke("cloud_ws_send", { pipe, text });
    },
    close() {
      if (closed) return;
      closed = true;
      unMsg();
      unClosed();
      void invoke("cloud_ws_close", { pipe }).catch(() => {});
    },
  };
};
