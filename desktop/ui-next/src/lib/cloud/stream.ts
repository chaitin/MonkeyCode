// 云端任务流(kind=stream)重连状态机:纯逻辑,时钟/传输/批调度全部可注入,
// vitest 用假管道+假时钟表驱动(stream.test.ts)。移植自旧 UI cloudapi.ts::
// connectCloudTask,行为契约逐条钉死:
// - 上行帧 {type, data: b64(JSON(payload)), timestamp};user-input.content
//   再包一层 base64(引擎/云端契约,data 层之外的内层编码)。
// - 下行即 Frame(与本地会话同构,直接喂 reduceBatch);ping 滤除;
//   seq 单调去重(连接层水位,重连回放时复位;归约层另有跨批水位兜底)。
// - task-ended 不受普通 seq 去重影响:回放中控制帧可能把 seq 水位顶高,后到的
//   task-ended 仍须在 onEnded 前同步交给 onFrames,但必须晚于本轮 task-started，
//   避免重连回放的旧轮终态误关当前轮。
// - 重连退避 2s 起指数翻倍封顶 30s;连续 5 次拨不通放弃(转就绪);
//   重连一律降级 attach(避免误开新轮,对齐移动端)。
// - 服务端 Close 1000/1001 或零业务帧 = 云端主动收束(转就绪,不重连);
//   短命断流(存活 <60s)连续 5 次转就绪兜底。
// - send 返回 Promise<boolean>:false=未送达(调用方保留内容,不乐观回写);
//   mode=new 首条输入失败(拨号失败/零回显被关)经 onSendFailed 交还。
import { b64encode } from "@/lib/protocol/codec";
import type { Frame } from "@/lib/protocol/types";
import { openPipe, type CloudPipe, type OpenPipe, type WsCloseInfo } from "./pipes";

// ---- 拨号退避(control 同族参数):2s 起指数翻倍、封顶 30s;
// 连续 5 次拨不通视为环境不可达,放弃自动重连 ----
export const DIAL_GIVEUP_FAILS = 5;
export const dialBackoffMs = (fails: number) => Math.min(2000 * 2 ** Math.max(0, fails - 1), 30_000);
/** 管道存活超过该时长视为健康连接,短命断流计数归零。 */
export const HEALTHY_LIFE_MS = 60_000;

/** mode=new 的首条输入:正文 + 附件(与 web/mobile 的 user-input 契约一致)。 */
export interface CloudUserInput {
  content: string;
  attachments?: { url: string; filename: string }[];
}

/** 连接状态(结构化事件,不带文案;视图按 i18n 映射)。 */
export type StreamStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "reconnecting"; delayMs: number; reason?: string }
  | { kind: "sendFailed" }
  | { kind: "dialGaveUp"; reason?: string }
  | { kind: "dropGaveUp" }
  | { kind: "roundEnded" };

export interface StreamHandlers {
  /** 实时帧批(ping/重叠帧已滤;cursor 帧保留,由调用方捕获翻页游标) */
  onFrames(batch: Frame[]): void;
  onStatus(status: StreamStatus, connected: boolean): void;
  onEnded?(): void;
  /** 断线重连前回调:attach 会整轮回放当前轮,视图应清掉当前轮本地缓存 */
  onReconnect?(): void;
  /** 空闲关闭/连接彻底失败:云端对"当前轮已结束"的 attach 会直接关连接,
   * 这不是断线,不该重连——视图应转入"就绪"态(发消息时再建连接)。 */
  onIdle?(): void;
  /** mode=new 的首条输入未能送达(拨号失败/零回显被关):内容交还调用方 */
  onSendFailed?(input: CloudUserInput): void;
}

export interface CloudStreamConn {
  /** 上行一帧(payload 会 base64(JSON) 包装);resolve(false)=未送达
   * (未连接或壳侧发送失败,失败已经 onStatus 外显)。 */
  send(type: string, payload?: unknown): Promise<boolean>;
  close(): void;
}

/** 副作用注入面(缺省用真实现;测试全换假的)。 */
export interface StreamDeps {
  openPipe: OpenPipe;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
  /** 帧批调度:同一拍到的帧合并为一批喂 onFrames(默认 rAF,退 setTimeout) */
  schedule(fn: () => void): void;
}

function realDeps(): StreamDeps {
  return {
    openPipe,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    schedule: (fn) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn());
      else setTimeout(fn, 16);
    },
  };
}

/** 连接云端任务流(内核代理拨 wss)。mode=attach 回放当前轮+实时跟看;
 * mode=new 开新一轮(连上即发 firstInput)。断线自动重连(降级 attach);
 * 收到 task-ended 后不再重连并回调 onEnded。 */
export function connectCloudStream(
  taskId: string,
  mode: "attach" | "new",
  h: StreamHandlers,
  firstInput?: CloudUserInput,
  deps: Partial<StreamDeps> = {},
): CloudStreamConn {
  const d: StreamDeps = { ...realDeps(), ...deps };
  let pipe: CloudPipe | null = null;
  let closed = false;
  let ended = false;
  let lastSeq = 0;
  let lastTaskStartedSeq = 0;
  let queue: Frame[] = [];
  let flushScheduled = false;
  let reconnectTimer: unknown = null;
  let pendingFirst: CloudUserInput | undefined = firstInput;
  let curMode = mode;
  let attempt = 0;
  let openedThisAttempt = false; // 本次尝试是否成功建立过管道
  let framesThisOpen = 0; // 本次连接收到的业务帧数(区分"空闲关闭"与"断流")
  let dialFails = 0; // 连续拨号失败次数(指数退避,超限放弃)
  let dialErr = ""; // 最近一次拨号失败原因(状态外显留痕,吞掉无从诊断)
  let dropCount = 0; // 连续短命断流次数(收过流又快速被关;超限转就绪兜底)
  let openedAt = 0; // 本次管道建立时刻
  let sentFirst: CloudUserInput | null = null; // 已上行但尚无任何回显的首条输入

  function flush() {
    flushScheduled = false;
    const batch = queue;
    queue = [];
    if (batch.length) h.onFrames(batch);
  }
  function schedule() {
    if (flushScheduled) return;
    flushScheduled = true;
    d.schedule(flush);
  }

  const doSend = async (type: string, payload: unknown = {}): Promise<boolean> => {
    if (!pipe) return false;
    // 管道死亡与 ws-closed 事件到达之间有窗口:发送失败必须外显,且要把
    // 真实结果返回给调用方(乐观回写必须等这里的真布尔)
    try {
      await pipe.send(JSON.stringify({ type, data: b64encode(JSON.stringify(payload)), timestamp: d.now() }));
      return true;
    } catch {
      h.onStatus({ kind: "sendFailed" }, false);
      return false;
    }
  };

  function onText(text: string) {
    let f: Frame;
    try {
      f = JSON.parse(text) as Frame;
    } catch {
      return;
    }
    if (f.type === "ping") return;
    const isTaskEnded = f.type === "task-ended";
    const frameSeq = typeof f.seq === "number" && f.seq > 0 ? f.seq : null;
    if (
      isTaskEnded &&
      (ended || (frameSeq !== null && lastTaskStartedSeq > 0 && frameSeq <= lastTaskStartedSeq))
    ) return;
    if (frameSeq !== null) {
      // task-ended 是终止控制帧，可能使用低于业务帧水位的 seq，不能按普通
      // 回放重叠帧丢弃；但也不能让它把连接水位倒退。
      if (frameSeq <= lastSeq && !isTaskEnded) return;
      if (frameSeq > lastSeq) lastSeq = frameSeq;
      if (f.type === "task-started" && frameSeq > lastTaskStartedSeq) lastTaskStartedSeq = frameSeq;
    }
    // cursor(翻页游标)/task-error(拒绝提示,含旧词 error)不算"轮活跃":
    // 空闲 attach 云端也会先发 cursor 再关连接,计入会让空闲关闭被误判
    // 成断流而无限重连
    if (f.type !== "cursor" && f.type !== "error" && f.type !== "task-error") {
      framesThisOpen += 1;
      sentFirst = null; // 有回显 = 首条输入已被云端接收
    }
    queue.push(f);
    if (isTaskEnded) {
      // 必须先置 ended，避免 onFrames 内关闭管道时被当成断流重连；再同步
      // 冲刷此前尚在 rAF 队列里的业务帧和终止帧，确保队列清账先于 onEnded。
      ended = true;
      try {
        flush();
      } finally {
        h.onEnded?.();
      }
      return;
    }
    schedule();
  }

  function onPipeClose(info: WsCloseInfo | null = null) {
    pipe = null;
    if (closed) return;
    if (ended) {
      // task-ended 按轮下发:这里只代表本轮结束,任务是否终结以详情为准
      h.onStatus({ kind: "roundEnded" }, false);
      return;
    }
    // 服务端正常关闭(Close 1000/1001)= 云端主动收束,不是断线:
    // 对"当前轮已结束"的 attach,云端回放完整轮帧后就正常关连接——
    // 只按 framesThisOpen 猜会误判成断流,陷入"重连→回放→被关"死循环
    const cleanClose = info?.code === 1000 || info?.code === 1001;
    if (openedThisAttempt && (cleanClose || framesThisOpen === 0)) {
      closed = true;
      if (sentFirst !== null) {
        // mode=new 发了首条输入却零回显被关:大概率被拒(休眠/运行互斥),
        // 内容交还调用方重试,绝不静默丢
        h.onSendFailed?.(sentFirst);
        return;
      }
      // 云端收束/一帧未发就被关:停止重连,转"就绪"
      h.onIdle?.();
      return;
    }
    if (!openedThisAttempt) {
      dialFails += 1;
      if (pendingFirst !== undefined) {
        // 带首条输入的连接没拨通:内容交还,本连接就此作废
        const input = pendingFirst;
        pendingFirst = undefined;
        closed = true;
        h.onSendFailed?.(input);
        return;
      }
      if (dialFails >= DIAL_GIVEUP_FAILS) {
        // 连不上云端流(网络/环境异常):放弃自动重连,转就绪兜底
        closed = true;
        h.onStatus({ kind: "dialGaveUp", ...(dialErr ? { reason: dialErr } : {}) }, false);
        h.onIdle?.();
        return;
      }
    } else {
      dialFails = 0; // 曾成功收流的断开:退避从头计
      // 短命断流计数:这条路径没有拨号失败那样的自然上限,若服务端每次
      // 都在回放后快速关闭(且没带可识别 Close 帧),会永远 2 秒循环
      if (d.now() - openedAt > HEALTHY_LIFE_MS) dropCount = 0;
      dropCount += 1;
      if (dropCount >= DIAL_GIVEUP_FAILS) {
        closed = true;
        h.onStatus({ kind: "dropGaveUp" }, false);
        h.onIdle?.();
        return;
      }
    }
    const delay = dialBackoffMs(dialFails);
    h.onStatus({ kind: "reconnecting", delayMs: delay, ...(dialErr ? { reason: dialErr } : {}) }, false);
    curMode = "attach"; // 重连降级为跟看,避免误开新轮(对齐移动端)
    reconnectTimer = d.setTimeout(open, delay);
  }

  function open() {
    if (closed || ended) return;
    if (attempt > 0) {
      // 重连:回放将成为当前轮的权威来源,seq 水位一并复位
      h.onReconnect?.();
      lastSeq = 0;
    }
    attempt += 1;
    openedThisAttempt = false;
    framesThisOpen = 0;
    h.onStatus({ kind: "connecting" }, false);
    d.openPipe("stream", taskId, { mode: curMode }, onText, onPipeClose)
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
        h.onStatus({ kind: "connected" }, true);
        // 新一轮:云端等第一条 user-input 才开跑;content 需再包一层 base64
        if (pendingFirst !== undefined) {
          const first = pendingFirst;
          pendingFirst = undefined;
          sentFirst = first;
          // 发送失败不在此处理:零回显被关时经 sentFirst → onSendFailed 兜底
          void doSend("user-input", {
            content: b64encode(first.content),
            attachments: first.attachments ?? [],
          });
        }
      })
      .catch((e: unknown) => {
        // 拨号失败原因必须留痕:吞掉的话"断开重连"循环无从诊断
        dialErr = String(e instanceof Error ? e.message : e).slice(0, 140);
        onPipeClose();
      });
  }

  open();
  return {
    send: doSend,
    close() {
      closed = true;
      // 主动关闭要连**同一拍里已排队、还没 flush 的帧**一起作废:批调度是
      // rAF/宏任务,close() 之后那一拍照样会跑 flush,把帧喂给调用方已经
      // 弃用的 handler。发消息正是这条路径——dispatch 先 close 掉观察连接
      // 再建 mode=new,残留帧一到就 clearSentPlaceholder(),把「发送中」的
      // 占位气泡在任何回显之前撤掉,气泡存在的意义正好被它抵消(2026-08-09)。
      // 只清队列不加 closed 守卫:服务端正常收束(onIdle/onSendFailed)那条
      // 路径同样置 closed,加守卫会把云端最后一批回放帧一起丢掉。
      queue = [];
      if (reconnectTimer !== null) d.clearTimeout(reconnectTimer);
      pipe?.close();
      pipe = null;
    },
  };
}
