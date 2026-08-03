// 云端控制流(kind=control)call 配对状态机:纯逻辑,时钟/传输可注入,
// 表驱动单测(control.test.ts)。移植自旧 UI cloudapi.ts::connectCloudControl,
// 行为契约钉死:
// - 上行 {type:"call", kind, data: b64(JSON({request_id, ...payload}))};
//   下行按 request_id 配对 type="call-response"(data 经 frameData 双格式容错)。
// - 默认超时 15s;经"休眠唤醒"路径的操作给 180s 余量(WAKE_CALL_TIMEOUT_MS)。
// - 断线重连按 stream 同族退避;连续拨号失败/反复短命断开达上限后放弃
//   自动重连(onStatus 外显 offline),下一次 call() 到来时懒重连,或由宿主
//   显式 revive()(唤醒休眠 VM 的触发点是**建连本身**,没有 call 也得重拨)。
// - 未连上时发起的 call 排队等 open;管道断开时**在途** call 立即失败
//   (应答不可能再来),排队中的保留等重连。
// - 应答的成败判定见 callFailed():绝不能只看 success——`repo_file_list` 的
//   后端结构体是 `json:"success,omitempty"`,失败时这个字段整个不出现。
import { frameData } from "@/lib/protocol/codec";
import { b64encode } from "@/lib/protocol/codec";
import { t } from "@/lib/i18n";
import type { Frame } from "@/lib/protocol/types";
import { openPipe, type CloudPipe, type OpenPipe } from "./pipes";
import { DIAL_GIVEUP_FAILS, dialBackoffMs, HEALTHY_LIFE_MS } from "./stream";

export const CONTROL_CALL_TIMEOUT_MS = 15_000;

/** 经"休眠唤醒"路径的控制流 call 余量:冷唤醒以分钟计,90s 仍偏紧。 */
export const WAKE_CALL_TIMEOUT_MS = 180_000;

export type ControlErrorCode = "timeout" | "disconnected" | "offline" | "closed" | "remote";

/** call 失败的结构化错误:code 供程序分支,message 直接外显。 */
export class CloudControlError extends Error {
  readonly code: ControlErrorCode;
  constructor(code: ControlErrorCode, message: string) {
    super(message);
    this.name = "CloudControlError";
    this.code = code;
  }
}

export type ControlStatus = { kind: "connected" } | { kind: "offline"; reason?: string };

export interface CloudControl {
  /** 发一次 call(kind + payload),按 request_id 等待应答;失败 reject
   * CloudControlError。opts.timeoutMs 覆盖默认 15s;opts.timeoutMsg 定制
   * 超时文案(区分"唤醒中,操作可能仍会生效"与普通超时)。 */
  call<T>(kind: string, payload?: Record<string, unknown>, opts?: { timeoutMs?: number; timeoutMsg?: string }): Promise<T>;
  /** 放弃自动重连后显式复活(已连/未放弃/已关闭时是空操作)。
   * 为什么需要它:懒重连只挂在 call() 入口,而**唤醒休眠 VM 的唯一触发点是
   * 控制流建连本身**(backend task_control.go::Control),没有任何 call 也
   * 必须重新拨一次——否则"控制流悄悄放弃 → 机器休眠 → 没人去唤醒"就成死结
   * (2026-08-09)。旧 UI 靠发一发空 port_forward_list 撞出懒重连,这里把
   * 意图直接表达出来,不发假 RPC(假 RPC 还会挂一条 180s 的 pending)。 */
  revive(): void;
  close(): void;
  /** 是否已被 close()。**不可复活**——closed 之后 call() 一律 reject
   *  "closed"、revive() 也被挡死。借用方(CloudFiles 等)据此判断手里那条
   *  是不是已经被宿主关掉了,是就重借一条,别把死连接一直攥到卸载。 */
  isClosed(): boolean;
}

export interface ControlDeps {
  openPipe: OpenPipe;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

/** call 应答的成败判定。**不能写成 `success !== true`**:
 * - `port_forward_list` 的 ListPortforwadResp(backend types.go:728)压根没有
 *   success 字段,按"缺席即失败"判会把每次端口列表都判成失败;
 * - 反过来 `repo_file_list` 的 RepoListFiles.Success 是 `json:"success,omitempty"`
 *   (types.go:441)——**失败时 success=false 会被 omitempty 整个抹掉**,只剩
 *   一个 error 字段;写成 `success === false` 就把失败读成了成功,上层拿到
 *   `files: undefined` 渲染成"空目录",错误原因连同故障一起消失(2026-08-09)。
 * 故判据取并集:显式 success:false,或带了非空 error。其余(含两者皆无)算成功。 */
export function callFailed(resp: { success?: unknown; error?: unknown }): boolean {
  if (resp.success === false) return true;
  return typeof resp.error === "string" && resp.error !== "";
}

function realDeps(): ControlDeps {
  return {
    openPipe,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  };
}

/** 连接云端任务控制流(内核代理;长生命周期)。服务端在连接建立时自动
 * 唤醒休眠 VM,连接存续期间保活(对齐 web 控制台机制)。 */
export function connectCloudControl(
  taskId: string,
  h?: { onStatus?(status: ControlStatus, connected: boolean): void },
  deps: Partial<ControlDeps> = {},
): CloudControl {
  const d: ControlDeps = { ...realDeps(), ...deps };
  let pipe: CloudPipe | null = null;
  let closed = false;
  let offline = false; // 放弃自动重连后置真:等下一次 call 懒重连
  let reconnectTimer: unknown = null;
  let openedThisAttempt = false;
  let dialFails = 0;
  let dialErr = "";
  let dropCount = 0; // 连续短命断开次数(与 stream 同款兜底闸)
  let openedAt = 0;

  interface Pending {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: unknown;
    inFlight: boolean; // 已实际上行(区别于 sendQueue 里排队等 open 的)
  }
  const pending = new Map<string, Pending>();
  let sendQueue: { requestID: string; msg: string }[] = []; // open 前排队的上行帧

  /** 批量失败在途 call;onlyInFlight=true 时放过还在排队的(重连后仍会送达)。 */
  function rejectPending(err: () => CloudControlError, onlyInFlight: boolean) {
    for (const [id, p] of [...pending]) {
      if (onlyInFlight && !p.inFlight) continue;
      pending.delete(id);
      d.clearTimeout(p.timer);
      p.reject(err());
    }
  }

  function onText(text: string) {
    let f: Frame;
    try {
      f = JSON.parse(text) as Frame;
    } catch {
      return;
    }
    if (f.type !== "call-response") return;
    // 云端下行 data 双格式(base64(JSON)/裸对象),frameData 统一容错
    const resp = frameData<{ request_id?: string; success?: boolean; error?: string } & Record<string, unknown>>(f);
    if (!resp) return;
    const p = resp.request_id ? pending.get(resp.request_id) : undefined;
    if (!p) return;
    pending.delete(resp.request_id!);
    d.clearTimeout(p.timer);
    if (callFailed(resp)) p.reject(new CloudControlError("remote", resp.error || t("cloud.ctl.failed")));
    else p.resolve(resp);
  }

  /** 放弃自动重连:失败所有 pending(含排队的——没有重连就没有送达),
   * 外显原因;懒重连武装在 call() 入口。 */
  function giveUp(reason?: string) {
    offline = true;
    rejectPending(() => new CloudControlError("offline", t("cloud.ctl.offline") + (reason ? `(${reason})` : "")), false);
    sendQueue = [];
    h?.onStatus?.({ kind: "offline", ...(reason ? { reason } : {}) }, false);
  }

  function onPipeClose() {
    pipe = null;
    if (closed) return;
    // 在途 call 立即失败:管道已断,应答不可能再来;排队中的保留等重连
    rejectPending(() => new CloudControlError("disconnected", t("cloud.ctl.disconnected")), true);
    if (!openedThisAttempt) {
      dialFails += 1;
      if (dialFails >= DIAL_GIVEUP_FAILS) {
        giveUp(dialErr || undefined);
        return;
      }
    } else {
      dialFails = 0; // 曾成功建立的断开:退避从头计
      // 短命断开兜底闸(与 stream 对齐):服务端每次接受又快速关闭时,
      // 拨号失败上限永远够不着,没有这道闸就是换了个姿势的无限重连
      if (d.now() - openedAt > HEALTHY_LIFE_MS) dropCount = 0;
      dropCount += 1;
      if (dropCount >= DIAL_GIVEUP_FAILS) {
        giveUp();
        return;
      }
    }
    reconnectTimer = d.setTimeout(open, dialBackoffMs(dialFails));
  }

  function open() {
    if (closed) return;
    openedThisAttempt = false;
    d.openPipe("control", taskId, {}, onText, onPipeClose)
      .then((p) => {
        if (closed) {
          p.close();
          return;
        }
        pipe = p;
        openedThisAttempt = true;
        openedAt = d.now();
        dialFails = 0;
        dialErr = "";
        h?.onStatus?.({ kind: "connected" }, true);
        const q = sendQueue;
        sendQueue = [];
        for (const { requestID, msg } of q) {
          const pd = pending.get(requestID);
          if (!pd) continue; // 排队期间已超时
          pd.inFlight = true;
          void p.send(msg).catch(() => {
            const cur = pending.get(requestID);
            if (cur) {
              pending.delete(requestID);
              d.clearTimeout(cur.timer);
              cur.reject(new CloudControlError("disconnected", t("cloud.ctl.disconnected")));
            }
          });
        }
      })
      .catch((e: unknown) => {
        // 拨号失败原因必须留痕:吞掉的话重连循环无从诊断
        dialErr = String(e instanceof Error ? e.message : e).slice(0, 140);
        onPipeClose();
      });
  }

  /** 放弃后重新拨号(计数清零)。call() 入口与 revive() 共用同一条路径。 */
  function reopenIfGaveUp() {
    if (closed || !offline || pipe) return;
    offline = false;
    dialFails = 0;
    dropCount = 0;
    open();
  }

  open();
  return {
    revive: reopenIfGaveUp,
    isClosed: () => closed,
    call<T>(kind: string, payload: Record<string, unknown> = {}, opts?: { timeoutMs?: number; timeoutMsg?: string }): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (closed) return reject(new CloudControlError("closed", t("cloud.ctl.closed")));
        // 懒重连:放弃后新的 call 说明用户仍需要控制通道,计数清零重新拨
        reopenIfGaveUp();
        const requestID = crypto.randomUUID();
        const msg = JSON.stringify({
          type: "call",
          kind,
          data: b64encode(JSON.stringify({ request_id: requestID, ...payload })),
        });
        const entry: Pending = {
          resolve: resolve as (v: unknown) => void,
          reject,
          inFlight: false,
          timer: d.setTimeout(() => {
            pending.delete(requestID);
            sendQueue = sendQueue.filter((s) => s.requestID !== requestID);
            reject(new CloudControlError("timeout", opts?.timeoutMsg ?? t("cloud.ctl.timeout")));
          }, opts?.timeoutMs ?? CONTROL_CALL_TIMEOUT_MS),
        };
        pending.set(requestID, entry);
        if (pipe) {
          entry.inFlight = true;
          pipe.send(msg).catch(() => {
            const p = pending.get(requestID);
            if (p) {
              pending.delete(requestID);
              d.clearTimeout(p.timer);
              p.reject(new CloudControlError("disconnected", t("cloud.ctl.disconnected")));
            }
          });
        } else {
          sendQueue.push({ requestID, msg });
        }
      });
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) d.clearTimeout(reconnectTimer);
      rejectPending(() => new CloudControlError("closed", t("cloud.ctl.closed")), false);
      sendQueue = [];
      pipe?.close();
      pipe = null;
    },
  };
}
