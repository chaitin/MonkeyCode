// 云端任务状态容器:连接编排(stream attach / control 常驻 / 轮询节奏 /
// 休眠唤醒)与投递状态机(排队/直发/回执/失败重排队/取消)从 CloudTaskView
// 抽出收口,视图只消费 CloudTaskHandle(形状对齐本地会话的 useSession)。
//
// 分层:
//   createCloudTaskCore —— 投递状态机 + 连接持有,刻意不触 React:副作用
//     全部经 CloudCoreIO 注入,vitest 用假壳 IPC + 假时钟即可直接驱动
//     (useCloudTask.test.ts)。这里是历史上反复踩坑(死循环/死等)的
//     地方,不可测等于不可守。
//   useCloudTask —— React 侧:详情轮询、attach/control 生命周期 effect、
//     REST 播种/翻页、模型切换与端口列表,拼装为句柄。
//
// 数据流对齐移动端 task/[id].tsx:
//   结束态(finished/error) → REST rounds 只读回放,"加载更早"按 cursor 往前翻;
//   启动中(pending)        → 轮询详情展示 VM 准备进度,转 processing 后接流;
//   运行中(processing)     → WS attach(内核代理)回放当前轮 + 实时;发消息切 mode=new。
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  connectCloudControl,
  connectCloudTask,
  mcTaskInfo,
  mcTaskOptions,
  mcTaskRounds,
  mcTaskStop,
  WAKE_CALL_TIMEOUT_MS,
  type CloudConn,
  type CloudUserInput,
} from "./cloudapi";
import { groupCloudModels, type McCloudModelGroup } from "./cloud";
import { framesHaveAnchor, withCloudOutlineAnchors } from "./cloudOutline";
import { MAX_CLOUD_ATTS, uploadCloudFile, type CloudUploadedAtt } from "./cloudUpload";
import { frameData } from "./codec";
import { answerAsk as applyAskAnswer, initialChat, reduceBatch, type ChatState } from "./reduce";
import { withCommandSeparator } from "./slashCommands";
import type { CloudAttachment, CloudTask, CloudTaskDetail, Frame, SlashCommand } from "./types";

/** cursor 帧载荷:attach 下发时 data 既有裸 JSON 对象也有 base64(JSON)
 * 形态(云端契约不归本仓库管)——frameData 的双格式容错正是为此收口。 */
function parseCursor(f: Frame): { cursor?: string; has_more?: boolean } | null {
  return frameData<{ cursor?: string; has_more?: boolean }>(f);
}

/** 任务详情决定首屏数据源。运行中只能由 attach 回放当前轮；若同时用
 * REST rounds 播种，迟到的 REST 快照会覆盖 attach 已归档的当前轮。 */
export function cloudInitialSource(status: string): "attach" | "rounds" | "pending" {
  if (status === "processing") return "attach";
  if (status === "finished" || status === "error") return "rounds";
  return "pending";
}

/** 连接状态行的健康文案白名单:健康时 composer 不渲染状态指示(混在
 * 工具栏里是常驻噪音),异常/过渡态才外显。用白名单而非异常名单:
 * 未来新增的异常文案默认可见,不会被静默吞掉。 */
const HEALTHY_STATUS = new Set(["已连接云端", "已就绪,可继续对话", "本轮已结束,可继续对话", "已结束,只读回放"]);
export const cloudStatusHealthy = (status: string) => HEALTHY_STATUS.has(status);

// ==================== 状态机核心(非 React,可单测) ====================

/** 核心对宿主(hook / 测试)的输出口:React 状态回写与跨模块副作用全部
 * 经此注入,核心自身不 import React——这正是投递状态机可被 vitest 直接
 * 驱动的原因。hook 侧的实现全部经稳定 setter / ref 转接:父组件每次渲染
 * 的内联箭头不能进 WS effect 依赖,否则每次重渲染都重建连接(服务端会把
 * 当前轮整轮重放一遍 → 内容重复)。 */
export interface CloudCoreIO {
  /** 增量归约:实时帧喂进 chat */
  applyFrames(frames: Frame[]): void;
  /** 整体重算(attach 重建 / 断线回放归零时,以给定帧集为准) */
  rebuildChat(frames: Frame[]): void;
  /** AI 提问卡答复送达后的回写 */
  applyAskAnswer(askId: string, answers: Record<string, string | string[]>): void;
  setStatus(text: string): void;
  setConnected(ok: boolean): void;
  /** 翻页游标:仅在尚未持有游标时采纳(attach 回放的 cursor 帧) */
  setCursorIfEmpty(cursor: string, hasMore: boolean): void;
  /** 排队内容镜像(React state,供 UI 外显;atts 为随队待发附件) */
  setQueued(text: string, atts: CloudAttachment[]): void;
  setErr(text: string): void;
  /** 重新武装 attach effect(唤醒完成 / 投递被拒后重建观察通道) */
  bumpAttachEpoch(): void;
  /** 直发后贴底跟随 */
  pin(): void;
  /** 一轮结束(task-ended):刷新详情并让侧栏列表同步 */
  onRoundEnded(): void;
}

export type CloudTaskCore = ReturnType<typeof createCloudTaskCore>;

/** 投递状态机 + 连接持有。connect 可注入(测试换假壳 IPC 驱动的真实现)。 */
export function createCloudTaskCore(
  id: string,
  io: CloudCoreIO,
  connect: typeof connectCloudTask = connectCloudTask,
) {
  // 历史帧(已完成轮次,时间正序)与当前轮实时帧分开存:实时增量归约,
  // 历史前插时整体重算(重算彼时只有几千帧,代价可忽略)。
  // 不变式:live 只保存"当前未结束轮"的帧——轮一结束就归档进 history,
  // 这样(重)建 attach 连接时清空 live 再由服务端整轮回放,天然不重复。
  let history: Frame[] = [];
  let live: Frame[] = [];
  let conn: CloudConn | null = null;

  // ===== 发送排队:发消息与连接生命周期解耦 =====
  // 任何时刻都能按发送:环境启动中/正在执行/流还没同步上/上一条还没回执时
  // 先入队,就绪(轮结束、attach 同步完)后自动投递;连发多条合并进同一队列,
  // 不会再出现"第二条把第一条的连接关掉导致丢消息"。
  let queued = ""; // 单一事实源(原 queuedRef + state 双写在此收敛,io.setQueued 只是镜像)
  let queuedAtts: CloudAttachment[] = []; // 随队待发附件(与 queued 同生命周期)
  let running = false; // chat.running 镜像(稳定回调里读)
  let sending = false; // 直发后等首帧回执,期间再发只入队
  let taskStatus = "pending"; // 详情状态的渲染期镜像(原 statusRef)
  // VM 状态:云环境空闲会休眠(hibernated);休眠期间发送入队,唤醒后自动投递
  let hibernated = false;
  let lastVmStatus: string | null = null; // 上次详情帧的 VM 状态(null=尚未观测)
  // attach 已收束/放弃(onIdle):不再自动重建;发消息(mode=new)或唤醒重新武装
  let attachIdle = false;
  let sendFails = 0; // 连续投递失败计数(超限暂停自动重试)

  const setQueued = (v: string, atts: CloudAttachment[]) => {
    queued = v;
    queuedAtts = atts;
    io.setQueued(v, atts);
  };

  /** 云端单条 user-input 附件上限(backend 契约为 10);排队合并超限时
   * 截断并外显——静默丢会让用户以为图已随消息送达 */
  const MAX_SEND_ATTS = 10;
  const capAtts = (atts: CloudAttachment[]) => {
    if (atts.length <= MAX_SEND_ATTS) return atts;
    io.setErr(`合并排队后附件超过 ${MAX_SEND_ATTS} 个上限,已丢弃后 ${atts.length - MAX_SEND_ATTS} 个`);
    return atts.slice(0, MAX_SEND_ATTS);
  };

  // 帧下发处理:cursor 帧捕获翻页游标,其余喂归约;轮结束把当前轮归档进历史
  function onFrames(batch: Frame[]) {
    const frames: Frame[] = [];
    let turnEnded = false;
    for (const f of batch) {
      if (f.type === "cursor") {
        const c = parseCursor(f);
        if (c?.cursor) io.setCursorIfEmpty(c.cursor, !!c.has_more);
        continue;
      }
      // user-input 回显 = 云端已收下这条并排进执行:本轮从此刻起就算在跑。
      // 不能只认 task-started——新建/环境创建时,回显与真正开跑之间隔着整个
      // VM 启动(以分钟计),而 sending 在收到回显那一刻就解除了(见下),这段
      // 真空里 send() 的两道闸全开:第二条直接抢开新一轮,还会顶掉在途连接
      if (f.type === "task-started" || f.type === "user-input") running = true;
      // 被拒/出错:本轮没开起来,放行排队投递。回显之后只等到 task-error
      // (云端不会再补 task-ended)时,不清 running 就是队列永久卡死
      if (f.type === "task-error" && frameData<{ terminal?: boolean }>(f)?.terminal !== false) running = false;
      if (f.type === "task-ended") turnEnded = true;
      frames.push(f);
    }
    if (!frames.length) return;
    sending = false; // 收到帧 = 上一条直发已被云端接收
    sendFails = 0; // 通路恢复,投递失败计数归零
    live.push(...frames);
    io.applyFrames(frames);
    if (turnEnded) {
      history = [...history, ...live];
      live = [];
      running = false;
      // 轮结束是排队消息的主要投递时机(稍等连接收尾)
      setTimeout(trySendQueued, 200);
    }
  }

  function handlers() {
    return {
      onFrames,
      onStatus: (text: string, ok: boolean) => {
        io.setStatus(text);
        io.setConnected(ok);
        if (ok) {
          // 连上后稍等回放揭示轮状态,再尝试投递排队消息
          setTimeout(trySendQueued, 400);
        }
      },
      onEnded: () => io.onRoundEnded(),
      // 空闲关闭(云端对"当前轮已结束"的 attach 直接关连接):不是断线,
      // 转就绪态——可直接发消息(届时另建 mode=new 连接)。
      // 收束即撤下自动重建武装并清掉死连接引用:引用不清,attach effect 的
      // conn 守卫会永远挡住唤醒后的重建
      onIdle: () => {
        attachIdle = true;
        conn = null;
        running = false;
        io.setConnected(false);
        io.setStatus("已就绪,可继续对话");
        setTimeout(trySendQueued, 100);
      },
      // 首条输入未送达(拨号失败/零回显被关):放回队列头,绝不静默丢。
      // 该连接已死,引用一并清掉;连续失败超限后暂停自动重试(内容仍在
      // 队列),否则"投递→被拒→2s 再投"会自持死循环
      onSendFailed: (input: CloudUserInput) => {
        sending = false;
        conn = null;
        setQueued(
          queued ? input.content + "\n" + queued : input.content,
          capAtts([...(input.attachments ?? []), ...queuedAtts]),
        );
        sendFails += 1;
        // 重建 attach 拿回观察通道:被拒大多因为轮在跑/环境未就绪,
        // attach 回放能揭示真实轮状态(收到帧会把失败计数归零),
        // 轮结束后排队消息自动投递
        io.bumpAttachEpoch();
        if (sendFails < 3) {
          io.setStatus("消息未送达,已重新排队");
          setTimeout(trySendQueued, 2000);
        } else {
          io.setStatus("⚠ 消息多次未送达,已暂停自动重试;等环境就绪或点发送再试");
        }
      },
      // 断线重连(降级 attach)会整轮回放当前轮:清本地当前轮缓存,回放为权威
      onReconnect: () => {
        live = [];
        io.rebuildChat(history);
      },
    };
  }

  // 直发:并入历史 → 换 mode=new 连接(连上自动上行 user-input,云端回显)。
  const dispatch = (text: string, atts: CloudAttachment[]) => {
    history = [...history, ...live];
    live = [];
    conn?.close();
    io.pin();
    sending = true;
    // 回执保护:15s 没等到任何帧(投递失败/被拒)就解除,让排队恢复流动
    setTimeout(() => {
      if (sending) {
        sending = false;
        trySendQueued();
      }
    }, 15000);
    conn = connect(id, "new", handlers(), { content: text, attachments: atts });
  };

  // 投递排队消息(对齐 mobile handleSend:直接建 mode=new 连接上行,服务端
  // 才是运行互斥/休眠唤醒的权威,被拒会 onSendFailed 回队重试)。此前还要求
  // attach 已同步(syncedRef)、VM 非休眠(hibernatedRef)、任务 processing:
  // 三者全是本地推断,attach 连不上 / 详情接口 VM 状态不同步时永远为假,
  // 消息卡在"已排队"死等——发送与 attach 生命周期必须彻底解耦
  function trySendQueued() {
    if (!queued) return;
    if (taskStatus === "finished" || taskStatus === "error") return;
    if (running || sending) return; // 可见在跑/未回执才等
    if (sendFails >= 3) return; // 连败暂停:收到帧/唤醒/手动发送解除
    const q = queued;
    const qa = queuedAtts;
    setQueued("", []);
    dispatch(q, qa);
  }

  return {
    // ==================== 投递状态机(视图动作) ====================

    /** 发送:随时可按。当前轮执行中或上一条未回执 → 入队
     * (多条合并,轮结束自动投递);空闲时才直发。atts 为随消息附件。 */
    send(text: string, atts: CloudAttachment[] = []) {
      if (!text || taskStatus === "finished" || taskStatus === "error") return;
      sendFails = 0; // 手动发送 = 用户明确要投递,重试机会重置
      // 当前轮还在执行或上一条直发还没回执:合并入队,别抢开新一轮或
      // 把在途连接顶掉。task-ended / onIdle 会解除 running 并自动投递。
      if (running || sending) {
        setQueued(queued ? queued + "\n" + text : text, capAtts([...queuedAtts, ...atts]));
        return;
      }
      // 空闲时,把队列里压着的一并带上
      const full = [queued, text].filter(Boolean).join("\n");
      const fullAtts = capAtts([...queuedAtts, ...atts]);
      setQueued("", []);
      dispatch(full, fullAtts);
    },

    trySendQueued,

    clearQueued() {
      setQueued("", []);
    },

    /** 中断当前执行(WS user-cancel,不终止任务);发送结果是真实布尔——
     * 失败不能静默,用户会以为已经停了 */
    cancelRun() {
      if (!conn) {
        io.setErr("云端连接未就绪,停止指令未发送");
        return;
      }
      void conn.send("user-cancel").then((ok) => {
        if (!ok) io.setErr("停止指令未送达(云端连接中断),请重试");
      });
    },

    /** 回答 AI 提问:reply-question 经任务流上行(request_id 即 askId)。
     * 等真实发送结果再回写 UI:此前拿同步假 true 乐观回写,壳侧发送失败时
     * 提问卡显示"已回答"而云端根本没收到 */
    answerAsk(askId: string, answers: Record<string, string | string[]>) {
      if (!conn) {
        io.setErr("云端连接已断开,回答未发送;等重连后再试");
        return;
      }
      void conn
        .send("reply-question", { request_id: askId, answers_json: JSON.stringify(answers), cancelled: false })
        .then((ok) => {
          if (ok) io.applyAskAnswer(askId, answers);
          else io.setErr("云端连接已断开,回答未发送;等重连后再试");
        });
    },

    /** 任务结束时还压着排队消息:外显提醒,不静默丢 */
    handleEnded() {
      if (!queued && queuedAtts.length === 0) return;
      const attNote = queuedAtts.length ? `(含 ${queuedAtts.length} 个附件)` : "";
      io.setErr(`任务已结束,有未发送的消息:「${queued.slice(0, 60)}」${attNote}`);
      setQueued("", []);
    },

    // ==================== 连接编排(hook effects 驱动) ====================

    /** 详情状态的渲染期镜像(稳定回调里读,原 statusRef.current = taskStatus) */
    noteTaskStatus(s: string) {
      taskStatus = s;
    },

    /** VM 休眠标记的渲染期镜像(原 hibernatedRef) */
    noteHibernated(h: boolean) {
      hibernated = h;
    },

    /** 详情刷新回调:VM 回到 online 视为唤醒完成,休眠期间压着的排队消息
     * 可以投递了;attach 也重新武装(唤醒 = 新的活动窗口)。按"上次非
     * online → 本次 online"的转变检测而非只看 hibernated 镜像——后端会把
     * 唤醒中的 VM 短暂误判为 offline(hibernated → offline → online),
     * offline 帧会清掉镜像,只看镜像会让排队消息永久卡死、attach 不重建。
     * lastVmStatus !== null 守卫:首帧即 online 的健康任务不触发(否则
     * attach 拆建一次,服务端把当前轮整轮重放);online → online 不随轮询抖。 */
    handleInfo(info: CloudTaskDetail) {
      const vm = info.virtualmachine?.status ?? "";
      const cameOnline = vm === "online" && lastVmStatus !== null && lastVmStatus !== "online";
      const wake = vm === "online" && (cameOnline || hibernated);
      lastVmStatus = vm;
      if (!wake) return;
      hibernated = false;
      attachIdle = false;
      sendFails = 0;
      io.bumpAttachEpoch();
      setTimeout(trySendQueued, 100);
    },

    /** attach effect 主体:守卫通过则建连并返回 true(effect 据此注册 cleanup)。 */
    maybeOpenAttach(): boolean {
      // VM 休眠/唤醒中不发起 attach(必被拒,徒增重连噪音)
      if (hibernated) return false;
      // attach 已收束/放弃:不自动重建(发消息走 mode=new;唤醒经 epoch 重新武装)
      if (attachIdle) return false;
      if (conn) return false; // 发消息时已切换为 mode=new 连接,不重复建
      // attach 会整轮回放当前轮:清掉本地当前轮缓存,以服务端回放为权威
      live = [];
      io.rebuildChat(history);
      conn = connect(id, "attach", handlers());
      return true;
    },

    closeConn() {
      conn?.close();
      conn = null;
    },

    /** 进入/切任务复位(与 hook 的 mount effect 同步;App 以 id 为 key
     * 重挂视图,这里的复位是"key 被移除"时的兜底,保持原语义) */
    resetForTask() {
      history = [];
      live = [];
      attachIdle = false;
      sendFails = 0;
      lastVmStatus = null;
    },

    /** REST 播种历史(进入任务时已完成轮次) */
    seedHistory(frames: Frame[]) {
      history = frames;
    },

    /** "加载更早":历史前插 */
    prependHistory(frames: Frame[]) {
      history = [...frames, ...history];
    },

    /** 历史 + 当前轮快照(整体重算用) */
    frames(): Frame[] {
      return [...history, ...live];
    },
  };
}

// ==================== React hook ====================

/** 在线预览端口(⋯ 菜单;access_url 可直接在浏览器打开) */
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
  /** 连接状态行文案(composer 状态行) */
  status: string;
  connected: boolean;
  /** 操作失败/结束提醒(视图横幅) */
  err: string;
  /** 标题文案(task → meta 逐级回退) */
  label: string;
  taskStatus: string;
  ended: boolean;
  vmId: string;
  vmStatus: string;
  /** 云环境休眠唤醒中(状态行外显 + 排队提示文案) */
  vmWaking: boolean;
  /** 本轮执行中(运行条/停止按钮) */
  running: boolean;
  roundNo: number;
  input: string;
  setInput(v: string): void;
  queued: string;
  /** 随排队消息待发的附件数(排队 chip 外显) */
  queuedAtts: number;
  clearQueued(): void;
  send(): void;
  /** Agent 上报的可用斜杠指令(composer 的 / 菜单;跨重连粘住最近一次非空清单) */
  commands: SlashCommand[];
  /** 待发送附件(已上传完成;单条消息上限 3) */
  atts: CloudUploadedAtt[];
  /** 上传进行中的附件数(>0 时发送先拦下,避免半套附件出门) */
  uploading: number;
  /** 选择/粘贴/拖入的文件逐个上传为附件(超限/失败经 err 外显) */
  addFiles(files: File[]): void;
  removeAtt(i: number): void;
  /** 视图侧错误外显(如原生拖放读文件失败),走 err 横幅 */
  notify(text: string): void;
  /** 中断当前执行(user-cancel,不终止任务) */
  cancel(): void;
  /** 终止任务(REST stop;确认交互在视图) */
  stopTask(): Promise<void>;
  answerAsk(askId: string, answers: Record<string, string | string[]>): void;
  cursor: { cursor: string; hasMore: boolean } | null;
  loadingEarlier: boolean;
  loadEarlier(): Promise<void>;
  /** 把历史翻到某大纲锚已加载(大纲跳转用;返回是否找到)。 */
  ensureLoaded(anchorSeq: number): Promise<boolean>;
  /** 云端可用模型分组(null = 未加载/拉取失败可重试;loadModels 惰性拉取) */
  cloudGroups: McCloudModelGroup[] | null;
  switching: boolean;
  loadModels(): void;
  switchModel(modelId: string): Promise<void>;
  /** 开放端口(null = 检测中;fetchPorts 触发) */
  ports: PortInfo[] | null;
  fetchPorts(): void;
  /** 对话流滚动容器(贴底跟随在 hook 内做,视图挂 ref + 两个手势回调) */
  scrollRef: RefObject<HTMLDivElement>;
  onWheel(e: { deltaY: number }): void;
  onScroll(): void;
  /** 解除贴底跟随(大纲跳转等程序滚动前调用,否则下一批帧又拽回底部) */
  unpin(): void;
}

export function useCloudTask(
  /** 侧栏/新建入口带进来的任务(至少含 id;详情异步补全)。App 以 task.id
   * 为 key 挂载视图,故 id 在一次挂载内不变。 */
  task: CloudTask,
  opts: {
    /** 状态变化(停止/结束)后让 App 刷新侧栏列表 */
    onTasksChanged?: () => void;
  } = {},
): CloudTaskHandle {
  const id = task.id;
  const [meta, setMeta] = useState<CloudTaskDetail | null>(null);
  const [chat, setChat] = useState<ChatState>(initialChat);
  const [status, setStatus] = useState("加载中…");
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState<{ cursor: string; hasMore: boolean } | null>(null);
  // 游标的权威读写走 ref,state 只是渲染镜像:大纲跳转的补页循环跨多次
  // await,读 state 闭包会拿到旧游标(重复拉同一页/误判"无进展"提前放弃)
  const cursorRef = useRef<{ cursor: string; hasMore: boolean } | null>(null);
  const applyCursor = (c: { cursor: string; hasMore: boolean } | null) => {
    cursorRef.current = c;
    setCursor(c);
  };
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // 翻页互斥同理走 ref:state 闭包在连续 await 间是陈旧的
  const loadingEarlierRef = useRef(false);
  const [err, setErr] = useState("");
  const [queued, setQueuedState] = useState("");
  const [queuedAtts, setQueuedAttsState] = useState<CloudAttachment[]>([]);
  // 待发送附件与上传中计数(附件随消息发出/入队后清空,额度重新起算)
  const [atts, setAtts] = useState<CloudUploadedAtt[]>([]);
  const [uploading, setUploading] = useState(0);
  // 额度计数含上传中的(并发粘贴/拖入共享额度,state 异步更新看不住)
  const attCountRef = useRef(0);
  // attach 生命周期与轮询解耦:vmStatus 抖动不能反复拆建连接——每次重建
  // 都会把 connectCloudTask 内部的重连上限(dialFails/dropCount)清零,
  // 3s/10s 的轮询节奏快于内部 ~30s 的放弃阈值,表现为永久"断开重连"。
  // 休眠期间不发起(核心内读镜像);唤醒完成经 attachEpoch 触发一次重建。
  const [attachEpoch, setAttachEpoch] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  // 回调经 ref 转接:父组件每次渲染的内联箭头不能进 effect 依赖,
  // 否则每次重渲染都重建连接(服务端会把当前轮整轮重放一遍 → 内容重复)
  const onTasksChangedRef = useRef(opts.onTasksChanged);
  onTasksChangedRef.current = opts.onTasksChanged;
  const refreshInfoRef = useRef<() => Promise<CloudTaskDetail | null>>(async () => null);

  // 状态机核心:一次挂载建一次(App 以 id 为 key,id 不会中途变);
  // IO 全部指向稳定 setter / ref 转接,核心回调可安全长期持有
  const coreRef = useRef<CloudTaskCore | null>(null);
  if (!coreRef.current) {
    const io: CloudCoreIO = {
      // 归约边界统一给 user-input 帧盖大纲锚(seq=时间戳锚);core 存原始帧,
      // WS 去重水位与回放缓存不受影响
      applyFrames: (frames) => setChat((s) => reduceBatch(s, withCloudOutlineAnchors(frames))),
      rebuildChat: (frames) => setChat(reduceBatch(initialChat, withCloudOutlineAnchors(frames))),
      applyAskAnswer: (askId, answers) => setChat((s) => applyAskAnswer(s, askId, answers)),
      setStatus,
      setConnected,
      setCursorIfEmpty: (c, hasMore) => {
        if (!cursorRef.current) applyCursor({ cursor: c, hasMore });
      },
      setQueued: (text, queueAtts) => {
        setQueuedState(text);
        setQueuedAttsState(queueAtts);
      },
      setErr,
      bumpAttachEpoch: () => setAttachEpoch((e) => e + 1),
      pin: () => {
        pinnedRef.current = true;
      },
      onRoundEnded: () => void refreshInfoRef.current().then(() => onTasksChangedRef.current?.()),
    };
    coreRef.current = createCloudTaskCore(id, io);
  }
  const core = coreRef.current;

  const taskStatus = meta?.status ?? task.status ?? "pending";
  const ended = taskStatus === "finished" || taskStatus === "error";
  const vmId = meta?.virtualmachine?.id ?? "";
  const vmStatus = meta?.virtualmachine?.status ?? "";
  // 渲染期镜像进核心(原 statusRef/hibernatedRef 的每次渲染赋值)
  core.noteTaskStatus(taskStatus);
  core.noteHibernated(taskStatus === "processing" && vmStatus === "hibernated");
  const label = task.title || task.summary || task.content || meta?.title || meta?.summary || "云端任务";

  const rebuild = useCallback(() => {
    setChat(reduceBatch(initialChat, withCloudOutlineAnchors(core.frames())));
  }, [core]);

  const refreshInfo = useCallback(async () => {
    try {
      const info = await mcTaskInfo(id);
      setMeta(info);
      core.handleInfo(info); // VM 唤醒转变检测(排队投递 + attach 重新武装)
      return info;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [id, core]);
  refreshInfoRef.current = refreshInfo;

  // 进入/切任务:复位 + 拉详情。结束态走 REST 回放；运行中不在这里碰
  // history，由下方 attach 独占当前轮，避免迟到的 REST 覆盖 WS 回放。
  useEffect(() => {
    core.resetForTask();
    setChat(initialChat);
    applyCursor(null);
    setErr("");
    setInput("");
    setAtts([]);
    attCountRef.current = 0;
    pinnedRef.current = true;
    let alive = true;
    void (async () => {
      const info = await refreshInfo();
      if (!alive || !info) return;
      if (cloudInitialSource(info.status ?? "") === "rounds") {
        try {
          const r = await mcTaskRounds(id, "", 1);
          if (!alive) return;
          core.seedHistory(r.frames ?? []);
          applyCursor(r.next_cursor ? { cursor: r.next_cursor, hasMore: !!r.has_more } : null);
          rebuild();
          setStatus("已结束,只读回放");
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, core, refreshInfo, rebuild]);

  // 状态轮询:pending/休眠唤醒中 3s(盯状态翻转),processing 10s(刷新元数据)
  const vmWaking = taskStatus === "processing" && vmStatus === "hibernated";
  const vmWakingRef = useRef(false);
  vmWakingRef.current = vmWaking; // 渲染期镜像(控制流回调长期持有,不能闭包渲染值)
  useEffect(() => {
    if (ended) return;
    const fast = taskStatus === "pending" || vmWaking;
    const t = setInterval(() => void refreshInfo(), fast ? 3000 : 10000);
    return () => clearInterval(t);
  }, [taskStatus, ended, vmWaking, refreshInfo]);

  // 常驻控制流:进对话即连——服务端在控制连接建立时会自动唤醒休眠 VM,
  // 且连接存续期间持续保活(不休眠);关闭视图断开,云端开始空闲倒计时。
  // 与 web 控制台行为一致;switch_model/端口列表也复用这条连接。
  const ctrlRef = useRef<ReturnType<typeof connectCloudControl> | null>(null);
  useEffect(() => {
    if (ended || !vmId) return;
    // 控制流放弃自动重连(连不上/反复断开)时外显;恢复(ok=true)清掉。
    // 之后任何经它的操作(切模型/端口列表)会触发懒重连。
    // 唤醒期间拨号必然连败,"环境离线"与标题栏"环境唤醒中"同屏矛盾:压掉,
    // 唤醒完成后由下方 effect 复活通道
    const ctrl = connectCloudControl(id, {
      onStatus: (text, ok) => {
        if (ok) setErr("");
        else if (!vmWakingRef.current) setErr(text);
      },
    });
    ctrlRef.current = ctrl;
    // 连接触发唤醒后,尽快让轮询看到状态翻转
    const t = setTimeout(() => void refreshInfo(), 1500);
    return () => {
      clearTimeout(t);
      ctrl.close();
      ctrlRef.current = null;
    };
  }, [id, ended, vmId, refreshInfo]);

  // 唤醒完成:控制通道若在唤醒期间连败放弃,用一次轻量 call 触发懒重连
  // (cloudapi 在 call() 入口武装 offline 懒重连),恢复保活;失败静默。
  // 刻意不把 vmWaking 挂进上方 ctrl effect 依赖:拆建连接会 reject 唤醒中
  // 在途的 switch_model 等长等待 call
  const prevWakingRef = useRef(false);
  useEffect(() => {
    if (prevWakingRef.current && !vmWaking && ctrlRef.current) {
      void ctrlRef.current.call("port_forward_list", {}, { timeoutMs: WAKE_CALL_TIMEOUT_MS }).catch(() => undefined);
    }
    prevWakingRef.current = vmWaking;
  }, [vmWaking]);

  // 运行中:WS attach 跟看(内核代理带 monkeycode 会话拨云端)。
  // 依赖刻意不含 vmWaking:vmStatus 由轮询刷新,抖动会反复拆建连接,
  // 每次重建把 connectCloudTask 内部的重连上限清零 → 永久"断开重连"。
  // 休眠与否在核心内读镜像;唤醒完成由 handleInfo 按转变 bump
  // attachEpoch 触发一次重建。
  useEffect(() => {
    if (cloudInitialSource(taskStatus) !== "attach") return;
    if (!core.maybeOpenAttach()) return;
    return () => core.closeConn();
  }, [id, core, taskStatus, attachEpoch]);

  // 斜杠指令清单是"事件驱动"的:只在 available_commands_update 到达时才有值,
  // 而 attach 重连/新一轮会以历史帧重算 chat(commands 归零)。这里把最近一次
  // 非空清单粘住,断线重连后 composer 的 / 菜单不会突然空掉。
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  useEffect(() => {
    if (chat.commands.length) setCommands(chat.commands);
  }, [chat.commands]);
  // 切任务时清空(App 以 id 为 key 重挂视图,这里是"key 被移除"时的兜底)
  useEffect(() => setCommands([]), [id]);

  // 贴底跟随(简化版:仅程序滚动,不做锚点恢复——云端流为跟看场景)
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [chat]);

  /** 往前翻并推进游标(权威游标在 ref,连续调用不受渲染时序影响)。 */
  const fetchEarlier = async (limit: number) => {
    const cur = cursorRef.current;
    if (!cur) return;
    const r = await mcTaskRounds(id, cur.cursor, limit);
    core.prependHistory(r.frames ?? []);
    applyCursor(r.next_cursor && r.has_more !== false ? { cursor: r.next_cursor, hasMore: !!r.has_more } : null);
    pinnedRef.current = false;
    rebuild();
  };

  const loadEarlier = async () => {
    if (!cursorRef.current || loadingEarlierRef.current) return;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    try {
      await fetchEarlier(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
    }
  };

  /** 大纲跳转:把历史一直往前翻到该锚的 user-input 帧已加载(或翻完/失败)。
   * 判定读 core 的帧集而非 DOM——prepend 后帧立即可查,不赌 React 提交时序;
   * 大步长(一次 10 轮,壳上限)减少跳到很早提问时的串行往返。返回是否找到。 */
  const ensureLoaded = async (anchorSeq: number): Promise<boolean> => {
    const found = () => framesHaveAnchor(core.frames(), anchorSeq);
    if (found()) return true;
    // 手动"加载更早"在途时稍候(它很快),拿不到独占就放弃本次预加载
    for (let i = 0; i < 30 && loadingEarlierRef.current; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (loadingEarlierRef.current) return found();
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    try {
      // 200 × 10 轮的护栏:防坏游标空转;正常任务远在其内
      for (let i = 0; i < 200 && cursorRef.current && !found(); i++) {
        await fetchEarlier(10);
      }
    } catch (e) {
      setErr("加载更早的对话失败: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
    }
    return found();
  };

  const send = () => {
    // 发原文,不 trim:云端按 `/name args` 解析斜杠指令,指令名后那个空格是
    // 分隔符——抹掉它,技能就只是一句普通文本(Web 侧同样原样发,见
    // frontend chat-inputbox sendInputSnapshot)。空判断仍按 trim 走。
    // 光敲了指令名就发(没走菜单补全)的,替他把分隔符补上:整条消息恰好是
    // 一条已知指令时才补,免得把普通文本里的 /path 也动了。
    const text = withCommandSeparator(input, commands);
    if (!text.trim() || ended) return;
    // 上传还没落定就发送,消息会带着半套附件出门:拦下并外显
    if (uploading > 0) {
      setErr("附件上传中,请稍候再发送");
      return;
    }
    setInput("");
    const sendAtts = atts.map(({ url, filename }) => ({ url, filename }));
    setAtts([]);
    attCountRef.current = 0;
    core.send(text, sendAtts);
  };

  // 附件逐个上传(与本地会话 addFiles 语义对齐:超限/失败经 err 外显,
  // 成功即出现在待发条;上传中计数供发送拦截与 spinner)
  const addFiles = (files: File[]) => {
    if (ended) return;
    void (async () => {
      for (const f of files) {
        if (attCountRef.current >= MAX_CLOUD_ATTS) {
          setErr(`一条消息最多 ${MAX_CLOUD_ATTS} 个附件`);
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
          setErr("附件上传失败: " + (e instanceof Error ? e.message : String(e)));
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

  // 任务结束时还压着排队消息:外显提醒,不静默丢
  useEffect(() => {
    if (ended) core.handleEnded();
  }, [ended, core]);

  // 终止任务(REST stop);确认交互在视图的 ⋯ 菜单里
  const stopTask = async () => {
    try {
      await mcTaskStop(id);
      await refreshInfo();
      onTasksChangedRef.current?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // 切换模型:经控制流调 switch_model(load_session 保留会话上下文)。
  // 存分组投影(与 newtask 建任务菜单同一分类:档位/付费/我的/团队)
  const [cloudGroups, setCloudGroups] = useState<McCloudModelGroup[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const modelsInFlight = useRef(false);
  const loadModels = () => {
    // 幂等靠 inFlight ref 而非「已有值」:失败保持 null,重开菜单可重试
    //(旧实现失败缓存 [],一次失败本次挂载就永远「没有可用模型」)
    if (cloudGroups !== null || modelsInFlight.current) return;
    modelsInFlight.current = true;
    mcTaskOptions()
      .then((o) => setCloudGroups(groupCloudModels(o.models, o.plan)))
      .catch(() => undefined)
      .finally(() => {
        modelsInFlight.current = false;
      });
  };
  const switchModel = async (modelId: string) => {
    if (switching || modelId === meta?.model?.id) return;
    // locked(超会员档)条目只展示不可切:菜单层已禁选,这里兜底防旁路
    if (cloudGroups?.some((g) => g.models.some((m) => m.id === modelId && m.locked))) return;
    setSwitching(true);
    setErr("");
    // 优先复用常驻控制连接;不在(结束态等)才临时建一条
    const shared = ctrlRef.current;
    const ctrl = shared ?? connectCloudControl(id);
    try {
      // 控制连接会触发休眠 VM 唤醒(以分钟计),默认 15s 必超时:给足唤醒
      // 余量;即便超时也不能断言失败——操作可能已在云端生效
      await ctrl.call(
        "switch_model",
        { model_id: modelId, load_session: true },
        { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: "操作超时——云端环境可能在唤醒中,切换可能已生效" },
      );
    } catch (e) {
      setErr("切换模型失败: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (!shared) ctrl.close();
      setSwitching(false);
      void refreshInfo(); // 成败都刷新:超时路径的真实结果以详情为准
    }
  };

  // 在线预览:⋯ 菜单打开时拉端口列表,access_url 可直接在浏览器打开
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const fetchPorts = () => {
    if (!vmId || ended) return;
    setPorts(null);
    const shared = ctrlRef.current;
    const ctrl = shared ?? connectCloudControl(id);
    ctrl
      // 唤醒路径同样给足余量:默认 15s 在唤醒期间必超时,菜单会误显"没有开放的端口"
      .call<{ ports?: PortInfo[] }>("port_forward_list", {}, { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: "云端环境可能在唤醒中,端口检测超时" })
      .then((r) => setPorts(r.ports ?? []))
      .catch(() => setPorts([]))
      .finally(() => {
        if (!shared) ctrl.close();
      });
  };

  return {
    id,
    meta,
    chat,
    status,
    connected,
    err,
    label,
    taskStatus,
    ended,
    vmId,
    vmStatus,
    vmWaking,
    running: chat.running && taskStatus === "processing",
    roundNo: Math.max(1, chat.items.filter((it) => it.kind === "user").length),
    input,
    setInput,
    queued,
    queuedAtts: queuedAtts.length,
    clearQueued: () => core.clearQueued(),
    send,
    commands,
    atts,
    uploading,
    addFiles,
    removeAtt,
    notify: setErr,
    cancel: () => core.cancelRun(),
    stopTask,
    answerAsk: (askId, answers) => core.answerAsk(askId, answers),
    cursor,
    loadingEarlier,
    loadEarlier,
    ensureLoaded,
    cloudGroups,
    switching,
    loadModels,
    switchModel,
    ports,
    fetchPorts,
    scrollRef,
    onWheel: (e) => {
      if (e.deltaY < 0) pinnedRef.current = false;
    },
    onScroll: () => {
      const el = scrollRef.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40) pinnedRef.current = true;
    },
    unpin: () => {
      pinnedRef.current = false;
    },
  };
}
