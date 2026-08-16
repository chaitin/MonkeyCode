// 云端任务详情的状态容器(简版,对齐移动端 task/[id].tsx 的数据流):
//   结束态(finished/error) → REST rounds 只读回放,"加载更早"按 cursor 往前翻;
//   启动中(pending)        → 轮询详情展示 VM 准备时间线,转 processing 后接流;
//   运行中(processing)     → WS attach(内核代理)回放当前轮 + 实时归约。
//
// 云端机器的唤醒与保活靠**常驻控制流**(与 web 控制台 / 移动端 / 旧桌面 UI 同一
// 机制):后端只在控制流 WS 建连时才 Resume 休眠 VM 并持续续期空闲计时器
// (backend task_control.go::Control);任务流 WS 连的是后端,VM 睡着照样秒连,
// 它既不唤醒机器也不知道机器醒没醒。所以本 hook 进任务即建一条控制连接,
// 「机器就绪与否」一律取详情接口的 virtualmachine.status,不拿连接状态当代理。
//
// 发送:机器收得到的时候直发——关掉观察连接,建 mode=new 连接(连上即上行
// 首条输入,经 stream 内部 send);收不到(环境还在建 / 机器休眠)则**押后**:
// 内容挂成占位气泡,等押后条件解除再上行(此刻直发只会掉进黑洞——后端收到
// user-input 先原样回显、再 Continue 到没起来的机器上失败,只写一行日志)。
// 失败经 onSendFailed 交还草稿,绝不静默丢。
// 执行中不排队(与旧 UI 投递队列的差异,刻意的简化):提示后保留草稿。
//
// 协议状态机(重连/退避/收束判定)全部在 lib/cloud/stream,本 hook 只做
// 编排:历史/当前轮帧缓存、归约回写、连接生命周期与轮询节奏。
// 契约:App 必须以 task.id 为 key 挂载视图(id 在一次挂载内不变)。
import { useCallback, useEffect, useRef, useState } from "react";

import { connectCloudControl, WAKE_CALL_TIMEOUT_MS, type CloudControl } from "@/lib/cloud/control";
import { groupCloudModels, type McCloudModelGroup } from "@/lib/cloud/options";
import { chronoRounds } from "@/lib/cloud/rounds";
import {
  connectCloudStream,
  type CloudStreamConn,
  type CloudUserInput,
  type StreamHandlers,
  type StreamStatus,
} from "@/lib/cloud/stream";
import { isImageFilename, MAX_CLOUD_ATTS, uploadCloudFile, type CloudUploadedAtt } from "@/lib/cloud/upload";
import { t } from "@/lib/i18n";
import type { FrameSender } from "@/lib/ipc/approvals";
import {
  mcTaskInfo,
  mcTaskOptions,
  mcTaskRounds,
  mcTaskStop,
  type CloudTask,
  type CloudTaskDetail,
} from "@/lib/ipc/cloudtasks";
import { frameData } from "@/lib/protocol/codec";
import { createChatState, prependHistory, reduceBatch } from "@/lib/protocol/reduce";
import type { ChatState, Frame, SlashCommand } from "@/lib/protocol/types";
import { withCommandSeparator } from "@/lib/util/slash";
import { useMcTransport } from "@/lib/mcTransport";

/** 任务详情决定首屏数据源。运行中只能由 attach 回放当前轮;若同时用 REST
 * rounds 播种,迟到的 REST 快照会覆盖 attach 已归档的当前轮。 */
export function cloudInitialSource(status: string): "attach" | "rounds" | "pending" {
  if (status === "processing") return "attach";
  if (status === "finished" || status === "error") return "rounds";
  return "pending";
}

/** port_forward_list 条目(控制流内核代理;与 web 控制台同一形状)。 */
export interface PortInfo {
  port?: number;
  access_url?: string;
  label?: string;
  process?: string;
  status?: string;
}

export interface CloudTaskHandle {
  id: string;
  /** 任务详情(异步补全;VM 状态/模型/统计都在这) */
  meta: CloudTaskDetail | null;
  chat: ChatState;
  /** 连接状态(结构化;视图映射文案,健康态不外显) */
  status: StreamStatus | null;
  connected: boolean;
  /** 常驻控制流已放弃自动重连(后台机件的健康度)。它一断,保活与唤醒
   * 就都没了——机器会照常休眠且没人去叫醒,所以要外显;唤醒期拨号必然
   * 连败,那段由 waking 压掉不外显(与旧 UI 同口径)。 */
  ctrlOffline: boolean;
  /** 操作失败/提示(视图横幅) */
  err: string;
  clearErr(): void;
  /** 视图侧动作失败入同一错误通道(如删除任务被服务端拒绝) */
  notifyErr(msg: string): void;
  /** 标题文案(task → meta 逐级回退) */
  label: string;
  taskStatus: string;
  ended: boolean;
  vmId: string;
  running: boolean;
  input: string;
  setInput(v: string): void;
  send(): void;
  /** 待发附件(上传已完成;发送时映射成 {url, filename} 随首条输入出线) */
  atts: CloudUploadedAtt[];
  /** 上传在途计数(>0 时发送被拦截并外显提示) */
  uploading: number;
  /** 逐个上传文件为附件(超限/失败经 err 外显;对话框/粘贴/拖拽共用) */
  addFiles(files: File[]): void;
  removeAtt(i: number): void;
  /** 模型分组投影(null = 未加载/加载失败;loadModels 幂等可重试) */
  models: McCloudModelGroup[] | null;
  loadModels(): void;
  switching: boolean;
  /** 经控制流 switch_model 切换模型(保留会话上下文;成败都刷新详情) */
  switchModel(modelId: string): Promise<void>;
  /** 中断当前执行(WS user-cancel,不终止任务;真布尔回执,失败外显) */
  cancelRun(): void;
  /** 审批/提问答复的上行发送面(适配 stream WS 的 send,封包归 stream;
   * 未连接或未送达 reject——卡片按失败回滚,不乐观假装已决)。 */
  sendFrame: FrameSender;
  /** 终止任务(REST stop;确认交互在视图) */
  stopTask(): Promise<void>;
  cursor: { cursor: string; hasMore: boolean } | null;
  loadingEarlier: boolean;
  /** 往更早翻 limit 轮(默认 1;壳侧上限 10)。大纲跳转补页用大步长
   * 减少跳到很早提问时的串行往返,"加载更早"按钮维持一次一轮。 */
  loadEarlier(limit?: number): Promise<void>;
  /** 斜杠指令清单(粘住最近一次非空:attach 重连/新一轮会以历史帧重算
   * chat 使 chat.commands 归零,菜单不该跟着空掉) */
  commands: SlashCommand[];
  /** VM 开放端口(null = 检测中/未拉过);access_url 可直接在浏览器打开 */
  ports: PortInfo[] | null;
  /** 拉一次开放端口(⋯ 菜单打开时触发;结束态/无 VM 不拉) */
  fetchPorts(): void;
  /** 借常驻控制流办事(文件面板等):优先复用,借不到才临时建一条;
   * release 只关自己建的那条。每条控制连接在后端都会另起一份 TaskLive
   * 上游订阅(task_control.go),各开各的既费上游也白白多一条保活链。 */
  borrowControl(): { ctrl: CloudControl; release: () => void };
  /** 还没被云端回显的那条输入(押在本地等机器醒 / mode=new 连接在途)。
   * 视图据此渲染「发送中」占位气泡——不占位的话输入框一清、日志无变化,
   * 用户会以为消息丢了 */
  sending: { content: string; attachments: { url: string; filename: string }[] } | null;
  /** 云端机器休眠中、正在被唤醒。此间发送押后,等唤醒完成自动送出;
   * 「连接中」与「唤醒中」的等待量级差一个数量级(秒 vs 分钟),文案要分开 */
  waking: boolean;
  /** 云端机器离线(已回收 / Failed 条件 / 建成超 3 分钟仍探不到在线)。
   * 与 waking 是两回事:后端只对 hibernated 做 Resume,offline 没人会去救
   * (vmstatus.Resolve + task_control.go),所以不能拿「正在唤醒」糊过去 */
  vmOffline: boolean;
  /** offline 且服务端给了 Failed 条件:确凿的启动失败,终态 */
  vmFailed: boolean;
  /** offline 但没有 Failed 条件:只知道没上线,可能还在起、也可能已回收 */
  vmNotReady: boolean;
  /** Failed 条件带的原因(有就直接给用户看,别让他去翻控制台) */
  vmFailReason: string;
  /** VM 状态原值(空/pending/online/offline/hibernated) */
  vmStatus: string;
}

/** 押后等待唤醒的上限:冷唤醒以分钟计(自家文案写的是 1~2 分钟),给到 5 分钟
 * 还没 online 就不是"在唤醒"而是起不来了(唤醒失败/虚拟机已回收)——交还草稿
 * 并外显,不把消息永远压在本地转圈。 */
const WAKE_WAIT_MAX_MS = 300_000;

/** 已出门的那条等回执的上限(旧 UI useCloudTask.ts:229 同值):15s 内云端
 * 一帧不回就解除发送态,否则连接静静挂着时发送按钮永远转圈。 */
const SEND_RECEIPT_MAX_MS = 15_000;

export function useCloudTask(
  task: CloudTask,
  opts: { onTasksChanged?: () => void } = {},
): CloudTaskHandle {
  const id = task.id;
  const { generation: transportGeneration, isCurrent: isTransportCurrent } = useMcTransport();
  const [meta, setMeta] = useState<CloudTaskDetail | null>(null);
  const [chat, setChat] = useState<ChatState>(createChatState);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [ctrlOffline, setCtrlOffline] = useState(false);
  const [err, setErr] = useState("");
  const [input, setInput] = useState("");
  const [atts, setAtts] = useState<CloudUploadedAtt[]>([]);
  const [uploading, setUploading] = useState(0);
  // 等云端回显的那条输入。ref 与 state 并存:onFrames 在连接回调闭包里跑,
  // 读 state 是陈旧的
  const [sending, setSending] = useState<CloudTaskHandle["sending"]>(null);
  const sendingRef = useRef(false);
  // 出件箱单槽:已按发送但**还没上行**的那条(机器没就绪时押在这)。
  // 与 sending 的区别是"到底出没出门"——出了门只能等回显,没出门要等唤醒
  const outboxRef = useRef<{ content: string; attachments: { url: string; filename: string }[] } | null>(null);
  // 押后的兜底闸:机器迟迟不 online(唤醒失败/虚拟机已回收)时,消息不能
  // 永远压在本地转圈。到点交还草稿并外显——不是"到点照发":此刻上行只会被
  // 后端回显一下就丢,看起来像发成功了,比转圈更坏
  const wakeTimerRef = useRef(0);
  // 回执兜底闸:已经出门(mode=new 已建)但云端一帧不回。socket 连上后
  // 静静挂着时,onFrames/onIdle/onSendFailed 一个都不会来,发送态就永远
  // 悬着——按钮转圈到天荒地老,用户的字已经离开输入框,再按发送还被
  // 「上一条还在拨号」挡回来。旧 UI 同位置有一道 15s 闸(useCloudTask.ts:229)
  const receiptTimerRef = useRef(0);
  const clearTimer = (ref: { current: number }) => {
    if (!ref.current) return;
    window.clearTimeout(ref.current);
    ref.current = 0;
  };
  const clearSending = () => {
    outboxRef.current = null;
    clearTimer(wakeTimerRef);
    clearTimer(receiptTimerRef);
    if (!sendingRef.current) return;
    sendingRef.current = false;
    setSending(null);
  };
  /** 连接侧「这条已经有着落了」的收尾:押在出件箱里那条还没出门,任何连接
   * 事件都不能替它签收(否则回放来一帧、或 attach 空闲收束,占位气泡就没了,
   * 消息永久卡在本地)——只在真上行过之后才让位。 */
  const clearSentPlaceholder = () => {
    if (!outboxRef.current) clearSending();
  };
  // 附件占位计数走 ref:addFiles 的串行 async 循环里 state 闭包是陈旧的
  const attCountRef = useRef(0);
  // 斜杠指令清单粘住最近一次非空:清单是事件驱动的(available_commands_update),
  // attach 重连/新一轮以历史帧重算 chat 会让 chat.commands 归零,菜单不能跟着空
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const [models, setModels] = useState<McCloudModelGroup[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const modelsInFlight = useRef(false);
  const modelsLoadedRef = useRef(false);
  const [cursor, setCursorState] = useState<{ cursor: string; hasMore: boolean } | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // 游标/翻页互斥的权威读写走 ref:连续 await 间的 state 闭包是陈旧的
  const cursorRef = useRef<{ cursor: string; hasMore: boolean } | null>(null);
  const loadingRef = useRef(false);
  // 历史帧(已完成轮次)与当前轮实时帧分开:实时增量归约,重建时整体重算。
  // 不变式:live 只存"当前未结束轮"——轮一结束归档进 history,(重)建
  // attach 时清空 live 再由服务端整轮回放,天然不重复。
  const historyRef = useRef<Frame[]>([]);
  const liveRef = useRef<Frame[]>([]);
  const connRef = useRef<CloudStreamConn | null>(null);
  // attach 已收束(onIdle)后不自动重建:发消息走 mode=new;失败/唤醒经
  // epoch 重新武装
  const attachIdleRef = useRef(false);
  const [attachEpoch, setAttachEpoch] = useState(0);
  // 常驻控制连接(唤醒 + 保活;切模型/端口列表复用它,见下方 effect)
  const ctrlRef = useRef<CloudControl | null>(null);
  const onTasksChangedRef = useRef(opts.onTasksChanged);
  onTasksChangedRef.current = opts.onTasksChanged;

  const applyCursor = (c: { cursor: string; hasMore: boolean } | null) => {
    cursorRef.current = c;
    setCursorState(c);
  };

  const taskStatus = meta?.status ?? task.status ?? "pending";
  const ended = taskStatus === "finished" || taskStatus === "error";
  const vmId = meta?.virtualmachine?.id ?? "";
  const vmStatus = meta?.virtualmachine?.status ?? "";
  // 唤醒中 = 任务在跑而且服务端说机器**休眠**。判据只取详情接口的 VM 状态,
  // **不挂连接状态**:任务流 WS 连的是后端,机器睡着它照样 connected——旧判据
  // 挂了 connected/status,现实里恒假,唤醒文案永远不亮(2026-08-08 用户报障)。
  // 也**不能写成"非 online"**(2026-08-09 修):后端 vmstatus.Resolve 对已回收、
  // 带 Failed 条件、以及建成超 3 分钟仍探不到在线的 VM 一律给 offline,而
  // task_control.go 只对 hibernated 调 Resume——把 offline 也算成"正在唤醒"
  // 就是对着一台没人会去救的机器显唤醒动画、押住消息死等 5 分钟。
  // vmStatus 空(详情没到/任务没带 VM)什么都不算:不妄断,发送照旧直发。
  const waking = taskStatus === "processing" && vmStatus === "hibernated";
  // **offline 不等于"完了"**(2026-08-09 用户报障「明显是错的」):服务端把三件
  // 事挤进同一个枚举值(backend/pkg/vmstatus/status.go::Resolve)——
  //   ① IsRecycled(真回收)
  //   ② 最后一条 condition 是 Failed(真启动失败)
  //   ③ **建成超 3 分钟仍没探到在线**,既没 Failed 也没 Hibernated
  // ③ 只是"还在起,只是慢"——本产品自己的文案都写着 VM 排队要数分钟
  // (LAYOUT §6.1),3 分钟这条线一跨就被判成 offline。此前 UI 见 offline 就
  // 断言「已回收或启动失败,不会自动恢复」,对 ③ 就是纯造谣,还劝用户重建任务。
  // 载荷里只有 ② 认得出来(conditions 详情接口是给的),① 与 ③ 无从区分,
  // 那就**不下定论**:只有 ② 敢说失败,其余一律说"尚未上线"。
  const lastCond = meta?.virtualmachine?.conditions?.at(-1);
  const failedCond = lastCond?.type === "Failed" ? lastCond : undefined;
  const vmOffline = taskStatus === "processing" && vmStatus === "offline";
  /** 确凿的启动失败(服务端给了 Failed 条件):终态,不会自愈 */
  const vmFailed = vmOffline && !!failedCond;
  /** 只知道"没上线":可能仍在启动,也可能已被回收——不许说成终态 */
  const vmNotReady = vmOffline && !failedCond;
  // 环境还在建(task pending):VM 尚未存在,消息同样发不出去,一并押后
  const starting = taskStatus === "pending";
  // 押后条件:机器此刻收不到。解除的那一刻把出件箱里那条送出去(见下方 effect)
  const parked = starting || waking;
  const label = task.title || task.summary || task.content || meta?.title || meta?.summary || t("cloud.list.untitled");

  const refreshInfo = useCallback(async (): Promise<CloudTaskDetail | null> => {
    try {
      const info = await mcTaskInfo(id);
      setMeta(info);
      return info;
    } catch (e) {
      setErr(t("cloud.err.loadFailed", { reason: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  }, [id]);

  /** 内容交还输入框与待发条(所有"没送出去"的路径共用:mode=new 被拒、
   * 押后等唤醒超时)。绝不静默丢——用户打的字必须回到他能再按一次发送的地方。 */
  const returnDraft = (failed: CloudUserInput, reason: string) => {
    clearSending(); // 内容回到输入框,占位气泡随之撤
    setInput((cur) => (cur ? failed.content + "\n" + cur : failed.content));
    const back = (failed.attachments ?? []).map((a) => ({ ...a, isImage: isImageFilename(a.filename) }));
    if (back.length) {
      attCountRef.current += back.length;
      setAtts((cur) => [...back, ...cur]);
    }
    setErr(reason);
  };

  /** 连接回调(每次建连新做一份闭包;引用的全是稳定 setter/ref)。 */
  const makeHandlers = (): StreamHandlers => ({
    onFrames: (batch) => {
      const frames: Frame[] = [];
      let turnEnded = false;
      for (const f of batch) {
        if (f.type === "cursor") {
          // attach 下发的翻页游标:仅在尚未持有时采纳
          const c = frameData<{ cursor?: string; has_more?: boolean }>(f);
          if (c?.cursor && !cursorRef.current) applyCursor({ cursor: c.cursor, hasMore: !!c.has_more });
          continue;
        }
        if (f.type === "task-ended") turnEnded = true;
        frames.push(f);
      }
      if (!frames.length) return;
      // 云端开始回显(第一批实时帧里就有服务端回写的这条 user 消息):
      // 占位气泡让位给真气泡(押后未上行的那条不算,见 clearSentPlaceholder)
      clearSentPlaceholder();
      liveRef.current.push(...frames);
      setChat((s) => reduceBatch(s, frames));
      if (turnEnded) {
        historyRef.current = [...historyRef.current, ...liveRef.current];
        liveRef.current = [];
      }
    },
    onStatus: (st, ok) => {
      setStatus(st);
      setConnected(ok);
    },
    // 一轮结束:刷新详情并让侧栏列表同步
    onEnded: () => {
      const expectedTransport = transportGeneration;
      void refreshInfo().then(() => {
        if (isTransportCurrent(expectedTransport)) onTasksChangedRef.current?.();
      });
    },
    // 断线重连(降级 attach)会整轮回放当前轮:清本地当前轮缓存,回放为权威
    onReconnect: () => {
      liveRef.current = [];
      setChat(reduceBatch(createChatState(), historyRef.current));
    },
    // 空闲关闭/放弃重连:转就绪态,发消息时另建 mode=new 连接
    onIdle: () => {
      attachIdleRef.current = true;
      connRef.current = null;
      setConnected(false);
      // 连接以「空闲」收束却一帧未回:发送态不能悬着(否则占位气泡永远转圈)。
      // 内容已经出门,不退回输入框——退回会造成重复发送。押后未上行的那条
      // 不受影响:它等的是机器醒,不是这条连接
      clearSentPlaceholder();
    },
    // mode=new 首条输入未送达(拨号失败/零回显被关):草稿与附件都交还,
    // 绝不静默丢;重建 attach 拿回观察通道(被拒大多因为轮在跑)
    onSendFailed: (failed) => {
      connRef.current = null;
      returnDraft(failed, t("cloud.err.sendRejected"));
      attachIdleRef.current = false;
      setAttachEpoch((e) => e + 1);
    },
  });

  /** 真正上行:当前轮并入历史 → 关掉观察连接 → 建 mode=new 连接(连上即上行
   * 首条输入,经 stream 内部 send;拨号失败/零回显被拒经 onSendFailed 交还
   * 草稿与附件)。send 与「机器醒了」的 effect 共用这一条出门通道。 */
  const dispatch = (outgoing: { content: string; attachments: { url: string; filename: string }[] }) => {
    historyRef.current = [...historyRef.current, ...liveRef.current];
    liveRef.current = [];
    connRef.current?.close();
    attachIdleRef.current = true; // 由新连接接管;失败时 onSendFailed 重新武装
    // 回执兜底:连上后一帧不回(socket 静静挂着)时没有任何回调会来,
    // 到点解除发送态并把内容外显——不放回输入框,内容已经出门,退回去
    // 就是重复发送(与 onIdle 同一口径)
    clearTimer(receiptTimerRef);
    receiptTimerRef.current = window.setTimeout(() => {
      receiptTimerRef.current = 0;
      if (!sendingRef.current || outboxRef.current) return;
      clearSending();
      setErr(t("cloud.err.sendNoReceipt", { text: outgoing.content }));
    }, SEND_RECEIPT_MAX_MS);
    // content 交明文:内层 base64 由 stream 状态机统一包(双重编码会乱码)
    connRef.current = connectCloudStream(id, "new", makeHandlers(), outgoing);
  };

  // 进入任务:复位 + 拉详情;结束态走 REST rounds 回放。运行中不在这里碰
  // history——由下方 attach effect 独占当前轮,避免迟到的 REST 覆盖 WS 回放。
  useEffect(() => {
    historyRef.current = [];
    liveRef.current = [];
    attachIdleRef.current = false;
    setChat(createChatState());
    applyCursor(null);
    setErr("");
    setInput("");
    setAtts([]);
    attCountRef.current = 0;
    sendingRef.current = false;
    outboxRef.current = null;
    setSending(null);
    let alive = true;
    void (async () => {
      const info = await refreshInfo();
      if (!alive || !info) return;
      if (cloudInitialSource(info.status ?? "") === "rounds") {
        try {
          const r = await mcTaskRounds(id, "", 1);
          if (!alive) return;
          historyRef.current = chronoRounds(r.frames ?? []);
          applyCursor(r.next_cursor ? { cursor: r.next_cursor, hasMore: !!r.has_more } : null);
          setChat(reduceBatch(createChatState(), historyRef.current));
        } catch (e) {
          setErr(t("cloud.err.loadFailed", { reason: e instanceof Error ? e.message : String(e) }));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, refreshInfo]);

  // 状态轮询:押后中(环境在建 / 机器休眠)3s 盯状态翻转——押后的消息就等
  // 这一下;其余 processing 10s(刷新元数据);结束停。
  useEffect(() => {
    if (ended) return;
    const timer = setInterval(() => void refreshInfo(), parked ? 3000 : 10000);
    return () => clearInterval(timer);
  }, [ended, parked, refreshInfo]);

  // 常驻控制流:进任务即连。**这是唯一会唤醒休眠 VM 的通道**——后端在控制流
  // 建连时 Resume 休眠机器,并在连接存续期间持续刷新空闲计时器保活
  // (backend task_control.go::Control)。web 控制台与移动端进任务即连,
  // 旧桌面 UI 同法;ui-next 此前只在切模型/端口/文件面板临时连一下,于是
  // 打开一个休眠任务根本没人去唤醒它(2026-08-08 用户报障根因)。
  // 代价与 web/移动端一致:任务视图开着期间机器不会休眠。
  // 控制流自身的 offline 状态**不进 err 横幅**(它是后台机件),但也不能吞:
  // 通道一断,保活与唤醒就都没了,机器照常休眠且没人叫醒——外显走连接条
  // (结构化布尔,文案在视图),唤醒期那段由 waking 压掉(拨号必然连败,
  // 与「唤醒中」同屏矛盾)。与旧 UI useCloudTask.ts:630-636 同口径
  useEffect(() => {
    if (ended || !vmId) return;
    const ctrl = connectCloudControl(id, {
      onStatus: (_st, ok) => setCtrlOffline(!ok),
    });
    ctrlRef.current = ctrl;
    // 不在这里复位 ctrlOffline:它由 onStatus 单向驱动(建连成功/放弃重连),
    // 而本 effect 只在 id/vmId/ended 变化时重跑——切任务视图整棵重挂,状态
    // 本就是新的;结束态连接条整条不渲染
    // 建连触发唤醒后尽快让轮询看到状态翻转(否则要等下一个 3s/10s 拍子)
    const t = setTimeout(() => void refreshInfo(), 1500);
    return () => {
      clearTimeout(t);
      ctrl.close();
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    };
  }, [id, ended, vmId, refreshInfo]);

  // 休眠边沿上复活控制通道。控制流连败到上限会**永久**放弃自动重连(懒重连
  // 只挂在 call() 入口,而 call 只有开 ⋯ 菜单/切模型时才发),于是「网络抖
  // 30 秒 → 通道悄悄退场 → 15 分钟后机器休眠 → 界面显示正在唤醒、实际没人
  // 去唤醒」成了死结(2026-08-09)。两个边沿各修一头:
  //  - 进入休眠:此刻正需要有人建连去 Resume,把通道叫回来;
  //  - 唤醒完成:唤醒期间的拨号必然连败,醒了要复活通道恢复保活(旧 UI
  //    useCloudTask.ts:646-656 用一发空 port_forward_list 撞懒重连,这里直接
  //    revive(),不发假 RPC)。
  // 只在**边沿**动手,不在 waking 为真时反复戳:那等于绕开放弃闸做无限重连。
  // 也刻意不把 waking 挂进上面那个 effect 的依赖——拆建连接会 reject 唤醒期
  // 在途的长等待 call(switch_model 等)。
  const prevWakingRef = useRef(false);
  useEffect(() => {
    if (prevWakingRef.current !== waking) ctrlRef.current?.revive();
    prevWakingRef.current = waking;
  }, [waking]);

  /** 借一条控制连接办事(切模型/端口列表/文件面板):优先复用常驻那条——省掉
   * 每次都拨一条新 WS(后端每条控制连接都会另起一份 TaskLive 上游订阅,
   * task_control.go::controlSubscribeTaskEvents),也避免临时连接关闭时打断
   * 保活;常驻不在(结束态/详情还没带 VM)才临时建一条,用完即关。
   * release 只关自己建的那条。 */
  const borrowControl = useCallback((): { ctrl: CloudControl; release: () => void } => {
    const shared = ctrlRef.current;
    if (shared) return { ctrl: shared, release: () => undefined };
    const own = connectCloudControl(id);
    return { ctrl: own, release: () => own.close() };
  }, [id]);

  // 押后条件解除(环境建好 / 机器醒了):把出件箱里那条送出去。
  // 判据取「押后条件」本身而不是「vm 变 online」:启动期的任务详情可能压根
  // 不带 virtualmachine,盯 vm 状态转变会让启动期排的那条永远发不出去。
  // 押后期间任务被终止/结束的兜底在下方 ended effect
  useEffect(() => {
    // ended 也会让 parked 翻假(任务跑完/被终止时既非 pending 也非唤醒中),
    // 但那不是"可以发了"而是"发不出去了":交给下方 ended effect 外显
    if (parked || ended) return;
    const queued = outboxRef.current;
    if (!queued) return;
    outboxRef.current = null;
    dispatch(queued);
    // dispatch 只读稳定 ref/setter,刻意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parked, ended]);

  // 唤醒完成(观测到「非 online → online」的转变):除了投递押后的消息,还要
  // 把观察通道重新武装起来——唤醒期间 attach 大概率已经连败收束(attachIdle),
  // 不重新武装的话 attach effect 的守卫会永远挡着,实时输出就此死掉
  // (旧 UI useCloudTask.ts:337-348 的四件事,ui-next 此前只做了投递那一件)。
  // 按**转变**判定而非「当前 online」:首次观测就 online 的健康任务不能触发,
  // 否则 attach 被无谓拆建一次,服务端把当前轮整轮重放(内容重复)。
  const lastVmRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vmStatus) return; // 详情还没到:既不记录也不判定
    const prev = lastVmRef.current;
    lastVmRef.current = vmStatus;
    if (vmStatus !== "online" || prev === null || prev === "online") return;
    attachIdleRef.current = false;
    setAttachEpoch((e) => e + 1);
  }, [vmStatus]);

  // 押后期间任务结束(自己终止/云端跑完):占位气泡撤下,内容外显——
  // 结束态 composer 不渲染,放回输入框没有意义,但绝不能静默丢
  useEffect(() => {
    if (!ended) return;
    const queued = outboxRef.current;
    if (!queued) return;
    clearSending();
    setErr(t("cloud.err.endedWithPending", { text: queued.content }));
    // clearSending/setErr 稳定,t 随 locale 变化重跑无害
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);

  // 运行中:WS attach 跟看。attachEpoch 驱动重建(发送失败后重新武装);
  // 已收束(attachIdleRef)或已有连接(发送切换的 mode=new)不重复建。
  useEffect(() => {
    if (cloudInitialSource(taskStatus) !== "attach") return;
    if (attachIdleRef.current || connRef.current) return;
    // attach 会整轮回放当前轮:清掉本地当前轮缓存,以服务端回放为权威
    liveRef.current = [];
    setChat(reduceBatch(createChatState(), historyRef.current));
    const conn = connectCloudStream(id, "attach", makeHandlers());
    connRef.current = conn;
    return () => {
      conn.close();
      if (connRef.current === conn) connRef.current = null;
    };
    // makeHandlers 引用的全是稳定 setter/ref,刻意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, taskStatus, attachEpoch]);

  // 卸载兜底:发送切换出的 mode=new 连接不归 attach effect 管;押后计时器
  // 同理(卸载后再触发就是往已卸载组件里 setState)
  useEffect(
    () => () => {
      connRef.current?.close();
      connRef.current = null;
      clearTimer(wakeTimerRef);
      clearTimer(receiptTimerRef);
    },
    // clearTimer 只读稳定 ref,刻意不进依赖
     
    [],
  );

  const send = () => {
    // 整条恰是 `/<已知指令>` 时补尾随空格:云端按 `/name args` 解析,
    // 缺了这个分隔符整条会被当普通文本(与旧 UI 同一口径)
    const text = withCommandSeparator(input, commands);
    if (!text.trim() || ended) return;
    if (sendingRef.current) {
      // 上一条还在拨号(唤醒机器可能要几分钟):再发一次会 close 掉在途连接,
      // 首条经 onSendFailed 弹回输入框、把用户刚打的字挤掉。拦下并说明
      setErr(t("cloud.err.sendInFlight"));
      return;
    }
    if (chat.running) {
      // 简版:执行中不排队,提示并保留草稿(服务端运行互斥,抢发必被拒)
      setErr(t("cloud.err.roundRunning"));
      return;
    }
    if (uploading > 0) {
      // 上传没落定就发送,消息会带着半套附件出门:拦下并外显
      setErr(t("cloud.attach.uploadingWait"));
      return;
    }
    setErr("");
    setInput("");
    const attachments = atts.map(({ url, filename }) => ({ url, filename }));
    setAtts([]);
    attCountRef.current = 0;
    const outgoing = { content: text, attachments };
    // 占位气泡立刻上屏:内容已经离开输入框,不占位的话日志毫无变化,
    // 用户只能猜消息是不是丢了(2026-08-06 用户报障)
    sendingRef.current = true;
    setSending(outgoing);
    if (parked) {
      // 机器此刻收不到(环境还在建 / 机器休眠):押后,等条件解除再上行。
      // 此刻直发只会掉进黑洞——后端收到 user-input 会先原样回显给我们,
      // 再把内容 Continue 到没起来的机器上失败、只写一行日志,表现就是
      // 「消息进了日志然后永远没有下文」(2026-08-08 用户报障)。
      // 启动期同样收下不退化成只读等待页——这是桌面侧独有的能力
      // (旧 UI cloudStartup.tsx:6-8「环境就绪即送达」)
      outboxRef.current = outgoing;
      wakeTimerRef.current = window.setTimeout(() => {
        wakeTimerRef.current = 0;
        const stuck = outboxRef.current;
        if (stuck) returnDraft(stuck, t("cloud.err.wakeTimeout"));
      }, WAKE_WAIT_MAX_MS);
      return;
    }
    dispatch(outgoing);
  };

  // 附件逐个上传(与本地会话 addFiles 语义对齐:超限/失败经 err 外显,
  // 成功即出现在待发条;上传中计数供发送拦截与 spinner)
  const addFiles = (files: File[]) => {
    if (ended) return;
    void (async () => {
      for (const f of files) {
        if (attCountRef.current >= MAX_CLOUD_ATTS) {
          setErr(t("cloud.attach.limit", { n: MAX_CLOUD_ATTS }));
          break;
        }
        attCountRef.current += 1;
        setUploading((n) => n + 1);
        try {
          const att = await uploadCloudFile(f);
          setAtts((prev) => [...prev, att]);
          setErr("");
        } catch (e) {
          attCountRef.current -= 1;
          setErr(t("cloud.attach.uploadFailed", { reason: e instanceof Error ? e.message : String(e) }));
        } finally {
          setUploading((n) => n - 1);
        }
      }
    })();
  };

  const removeAtt = (i: number) => {
    attCountRef.current = Math.max(0, attCountRef.current - 1);
    setAtts((prev) => prev.filter((_, j) => j !== i));
  };

  // 模型分组投影懒加载。幂等靠 inFlight ref 而非「已有值」:失败保持 null,
  // 重开菜单可重试(失败缓存 [] 会让本次挂载永远「没有可用模型」)。
  // 失败原因必须外显:重试可以留给下次开菜单,但静默吞掉的话模型菜单就是
  // 永远空白且一句交代都没有,用户无从判断是"没有模型"还是"没连上"
  const loadModels = useCallback(() => {
    if (modelsLoadedRef.current || modelsInFlight.current) return;
    modelsInFlight.current = true;
    mcTaskOptions()
      .then((o) => {
        modelsLoadedRef.current = true;
        setModels(groupCloudModels(o.models, o.plan));
      })
      .catch((e: unknown) => setErr(t("cloud.model.loadFailed", { reason: e instanceof Error ? e.message : String(e) })))
      .finally(() => {
        modelsInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    if (chat.commands.length) setCommands(chat.commands);
  }, [chat.commands]);

  // 在线预览:⋯ 菜单打开时拉一次开放端口。唤醒期给足余量——默认 15s 在
  // 唤醒期间必超时,菜单会误显「没有开放的端口」
  const fetchPorts = () => {
    if (!vmId || ended) return;
    setPorts(null);
    const { ctrl, release } = borrowControl();
    ctrl
      .call<{ ports?: PortInfo[] }>("port_forward_list", {}, { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: t("cloud.ctl.wakeTimeout") })
      .then((r) => setPorts(r.ports ?? []))
      .catch(() => setPorts([])) // 失败与「没开端口」同一呈现:菜单不留悬空 loading
      .finally(release);
  };

  // 切换模型:经控制流调 switch_model(load_session=true 保留会话上下文)。
  // 超时也不能断言失败——操作可能已在云端生效,故成败都刷新详情
  const switchModel = async (modelId: string) => {
    if (switching || !modelId || modelId === meta?.model?.id) return;
    // locked(超会员档)条目菜单层已禁选,这里兜底防旁路
    if (models?.some((g) => g.models.some((m) => m.id === modelId && m.locked))) return;
    setSwitching(true);
    setErr("");
    const { ctrl, release } = borrowControl();
    try {
      await ctrl.call(
        "switch_model",
        { model_id: modelId, load_session: true },
        { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: t("cloud.ctl.wakeTimeout") },
      );
    } catch (e) {
      setErr(t("cloud.model.switchFailed", { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      release();
      setSwitching(false);
      void refreshInfo(); // 成败都刷新:超时路径的真实结果以详情为准
    }
  };

  // 审批/提问答复上行:适配 stream 的 send(b64(JSON) 封包在 stream 内统一
  // 做)成 FrameSender 契约——false/无连接一律 reject,卡片的失败回滚生效。
  // useCallback 空依赖:只读稳定 ref,注入下游(LogList)不随渲染变引用。
  const sendFrame: FrameSender = useCallback(async (ftype, payload) => {
    const conn = connRef.current;
    if (!conn) throw new Error("cloud stream not connected");
    const ok = await conn.send(ftype, payload);
    if (!ok) throw new Error("cloud frame not delivered");
  }, []);

  const cancelRun = () => {
    const conn = connRef.current;
    if (!conn) {
      setErr(t("cloud.err.cancelNotSent"));
      return;
    }
    // 等真实发送结果:同步假 true 会把"没送达"渲染成"已停止"
    void conn.send("user-cancel").then((ok) => {
      if (!ok) setErr(t("cloud.err.cancelNotSent"));
    });
  };

  const stopTask = async () => {
    const expectedTransport = transportGeneration;
    try {
      await mcTaskStop(id);
      if (!isTransportCurrent(expectedTransport)) return;
      await refreshInfo();
      if (!isTransportCurrent(expectedTransport)) return;
      onTasksChangedRef.current?.();
    } catch (e) {
      if (isTransportCurrent(expectedTransport)) {
        setErr(t("cloud.err.stopFailed", { reason: e instanceof Error ? e.message : String(e) }));
      }
    }
  };

  const loadEarlier = async (limit = 1) => {
    const cur = cursorRef.current;
    if (!cur || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingEarlier(true);
    try {
      const r = await mcTaskRounds(id, cur.cursor, limit);
      // 时序归一(lib/cloud/rounds):backward 批次轮间倒序,多轮直插会乱序
      const frames = chronoRounds(r.frames ?? []);
      historyRef.current = [...frames, ...historyRef.current];
      applyCursor(r.next_cursor && r.has_more !== false ? { cursor: r.next_cursor, hasMore: !!r.has_more } : null);
      setChat((s) => prependHistory(s, frames));
    } catch (e) {
      setErr(t("cloud.err.loadFailed", { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      loadingRef.current = false;
      setLoadingEarlier(false);
    }
  };

  return {
    id,
    meta,
    chat,
    status,
    connected,
    ctrlOffline,
    err,
    clearErr: () => setErr(""),
    notifyErr: setErr,
    label,
    taskStatus,
    ended,
    vmId,
    running: chat.running && taskStatus === "processing",
    input,
    setInput,
    send,
    atts,
    uploading,
    addFiles,
    removeAtt,
    models,
    loadModels,
    switching,
    switchModel,
    cancelRun,
    sendFrame,
    stopTask,
    cursor,
    loadingEarlier,
    loadEarlier,
    commands,
    ports,
    fetchPorts,
    borrowControl,
    sending,
    waking,
    vmOffline,
    vmFailed,
    vmNotReady,
    vmFailReason: failedCond?.message ?? "",
    vmStatus,
  };
}
