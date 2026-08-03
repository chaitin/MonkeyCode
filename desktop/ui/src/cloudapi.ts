// MonkeyCode 云端域(百智会话桥接;凭证不出内核):REST 命令 + 云端 WS 桥
// (stream/control/terminal;壳做纯文本管道,协议逻辑在本层)+ 拨号退避。
// 云端默认值纯函数在 cloud.ts;IPC 原语在 ipc.ts,载荷纯数据类型在 types.ts。
import { b64encode, frameData } from "./codec";
import type { McTaskOptions } from "./cloud";
import { invoke, listenAsync } from "./ipc";
import type { CloudAttachment, CloudProjectsResp, CloudTaskDetail, CloudTasksResp, CloudUserInputsResp, Frame, McModelsSyncResult, McStatus, McUsage, McUser, WsCloseInfo } from "./types";

// ==================== 云端 REST(壳命令代理) ====================

export const mcStatus = () => invoke<McStatus>("mc_status");

/** 桥接登录:壳用已有的百智云会话走 OAuth 换 monkeycode 会话。
 * 未登录百智云或百智会话失效时报错。 */
export const mcLogin = () => invoke<{ ok: boolean; user?: McUser }>("mc_login");

/** 账号密码直连登录(不经百智云):壳内自动完成 PoW 验证码,明文密码经
 * TLS 直发服务端(后端 bcrypt 比对),不落盘不留存;会话与桥接登录同构。 */
export const mcPasswordLogin = (email: string, password: string) =>
  invoke<{ ok: boolean; user?: McUser }>("mc_password_login", { email, password });

export const mcLogout = () => invoke<{ ok: boolean }>("mc_logout");

/** 账号权益(额度/会员/签到态/邀请)。壳侧各路并发且各自容错,全失败才 reject。 */
export const mcUsage = () => invoke<McUsage>("mc_usage");

/** 每日签到(壳内自动完成 PoW 验证码)。成功后调用方重拉 mcUsage 刷新余额。 */
export const mcCheckin = () => invoke<{ ok: boolean }>("mc_checkin");

/** 同步会员内置模型为本地条目(不碰配置,返回值经设置表单落盘)。 */
export const mcModelsSync = () => invoke<McModelsSyncResult>("mc_models_sync");

/** 断开 MonkeyCode 账号时调用(从未同步过为 no-op;失败时本地记录保留
 * 供下次重试)。须在 mcLogout 之前调用——请求走 mc 会话。 */
export const mcModelsRevoke = () => invoke<{ ok: boolean }>("mc_models_revoke");

export const mcTasks = (
  page = 1,
  size = 20,
  status = "",
  options: { projectId?: string; quickStart?: boolean } = {},
) => invoke<CloudTasksResp>("mc_tasks", {
  page,
  size,
  status,
  projectId: options.projectId ?? null,
  quickStart: options.quickStart ?? null,
});

export const mcProjects = () => invoke<CloudProjectsResp>("mc_projects");

export const mcTaskInfo = (id: string) => invoke<CloudTaskDetail>("mc_task_info", { id });

/** 历史回放:壳已把云端 chunk 归一为 Frame 词汇(event→type,ns→ms)。
 * 一次一轮(对齐移动端);cursor 往更早翻。 */
export const mcTaskRounds = (id: string, cursor = "", limit = 1) =>
  invoke<{ frames: Frame[]; next_cursor?: string; has_more?: boolean }>("mc_task_rounds", {
    id,
    cursor,
    limit,
  });

/** 提问索引(倒序,cursor 向更早翻;大纲数据源,content 已解码明文)。 */
export const mcTaskUserInputs = (id: string, cursor = "", limit = 100) =>
  invoke<CloudUserInputsResp>("mc_task_user_inputs", { id, cursor, limit });

/** 终止云端任务(区别于流上行 user-cancel:那只中断当前执行)。 */
export const mcTaskStop = (id: string) => invoke<{ ok: boolean }>("mc_task_stop", { id });

export const mcTaskDelete = (id: string) => invoke<{ ok: boolean }>("mc_task_delete", { id });

/** 创建云端任务(壳补默认值:公共宿主机/opencode/2核8G3小时/官方技能)。 */
export const mcTaskCreate = (req: {
  content: string;
  model_id: string;
  host_id: string;
  image_id: string;
  repo_url?: string;
  branch?: string;
  project_id?: string;
}) => invoke<CloudTaskDetail>("mc_task_create", { req });

export const mcTaskOptions = () => invoke<McTaskOptions>("mc_task_options");

/** 云端聊天附件上传(壳内 presign + 直传对象存储,凭证不出内核;data 为
 * base64 文件字节)。返回的 access_url 放进 user-input 的 attachments。 */
export const mcUpload = (filename: string, dataB64: string) =>
  invoke<{ access_url: string }>("mc_upload", { filename, data: dataB64 });

/** 上传文件到云端任务 VM 工作区(壳代理 multipart,对齐 web 控制台文件树
 * 的"上传文件")。path 为 VM 内绝对路径(如 /workspace/dir/name.txt)。 */
export const mcFileUpload = (vmId: string, path: string, dataB64: string) =>
  invoke<{ ok: boolean }>("mc_file_upload", { vmId, path, data: dataB64 });

/** 从云端任务 VM 工作区下载文件/目录(壳带会话流式落盘到 dest,目录由
 * 服务端打成 zip;对齐 web 控制台文件树的"下载")。dlId 由调用方生成,
 * 进度经 `dl-progress:{dlId}` 事件下发 {written, total}(total 可为 null)。 */
export const mcFileDownload = (dlId: string, vmId: string, path: string, filename: string, dest: string) =>
  invoke<{ ok: boolean; bytes: number }>("mc_file_download", { dlId, vmId, path, filename, dest });

/** 取消进行中的下载(壳侧置旗收束并清残件;已完成/不存在静默)。 */
export const mcFileDownloadCancel = (dlId: string) => invoke<{ ok: boolean }>("mc_file_download_cancel", { dlId });

/** 虚拟机终端 session 列表(终端面板打开时复用已有会话,对齐 web 行为)。 */
export const mcTerminalList = (vmId: string) =>
  invoke<{ terminals?: { id?: string; title?: string; created_at?: number; connected_count?: number }[] }>(
    "mc_terminal_list",
    { vmId },
  );

// ==================== 云端 WS 桥(壳做纯文本管道,协议逻辑在本层) ====================

/** 打开一条云端 WS 管道:onText 收下行文本帧,onClose 收断开(带服务端
 * 关闭原因,异常断开为 null)。
 * 返回 {send, close};open 失败时 reject。send 返回 Promise,发送失败会
 * reject(调用方决定如何外显——静默吞掉会让用户消息无声丢失)。
 * pipe id 由本层生成并**先注册监听再开管道**:attach 回放在连上瞬间就
 * 开始下发,监听后注册会丢头帧。 */
async function openPipe(
  kind: "stream" | "control" | "terminal",
  id: string,
  params: Record<string, unknown>,
  onText: (text: string) => void,
  onClose: (info: WsCloseInfo | null) => void,
): Promise<{ send(text: string): Promise<void>; close(): void }> {
  const pipe = crypto.randomUUID();
  let closed = false;
  const unMsg = await listenAsync(`ws-msg:${pipe}`, (p) => onText(p as string));
  const unClosed = await listenAsync(`ws-closed:${pipe}`, (p) => {
    if (closed) return;
    closed = true;
    unMsg();
    unClosed();
    onClose((p as WsCloseInfo | null) ?? null);
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
}

// ---- 拨号退避(stream/control 参数对齐):2s 起指数翻倍、封顶 30s;
// 连续 5 次拨不通视为环境不可达,放弃自动重连(兜底策略见各调用处) ----
const DIAL_GIVEUP_FAILS = 5;
const dialBackoffMs = (fails: number) => Math.min(2000 * 2 ** Math.max(0, fails - 1), 30_000);

export interface CloudConn {
  /** 上行一帧(payload 会 base64(JSON) 包装);resolve(false)=未送达
   * (未连接或壳侧发送失败,失败已经 onStatus 外显)。与本地 Conn.send
   * 语义对齐——此前同步返回假 true,调用方拿它做乐观回写会把"没送达"
   * 渲染成"已发送"。 */
  send(type: string, payload?: unknown): Promise<boolean>;
  close(): void;
}

/** mode=new 的首条输入:正文 + 附件(与 web/mobile 的 user-input 契约一致)。 */
export interface CloudUserInput {
  content: string;
  attachments?: CloudAttachment[];
}

/** 连接云端任务流(内核代理:内核带 monkeycode 会话拨 wss 到云端)。
 * mode=attach 回放当前轮+实时跟看;mode=new 开新一轮(连上即发 firstInput)。
 * 帧结构与本地会话 Frame 同构,可直接喂 reduceBatch;ping 已滤除,seq 单调去重。
 * 断线自动重连(降级 attach);收到 task-ended 后不再重连并回调 onEnded。 */
export function connectCloudTask(
  taskId: string,
  mode: "attach" | "new",
  h: {
    onFrames(batch: Frame[]): void;
    onStatus(text: string, connected: boolean): void;
    onEnded?(): void;
    /** 断线重连前回调:attach 会整轮回放当前轮,视图应清掉当前轮本地缓存 */
    onReconnect?(): void;
    /** 空闲关闭/连接彻底失败:云端对"当前轮已结束"的 attach 会直接关连接,
     * 这不是断线,不该重连——视图应转入"就绪"态(发消息时再建连接)。 */
    onIdle?(): void;
    /** mode=new 的首条输入未能送达(拨号失败):视图应把内容(含附件)放回队列 */
    onSendFailed?(input: CloudUserInput): void;
  },
  /** 裸字符串视作无附件正文(兼容旧调用/测试) */
  firstInput?: string | CloudUserInput,
): CloudConn {
  let pipe: { send(t: string): Promise<void>; close(): void } | null = null;
  let closed = false;
  let ended = false;
  let lastSeq = 0;
  let queue: Frame[] = [];
  let flushScheduled = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFirst: CloudUserInput | undefined =
    firstInput === undefined ? undefined : typeof firstInput === "string" ? { content: firstInput } : firstInput;
  let curMode = mode;
  let attempt = 0;
  let openedThisAttempt = false; // 本次尝试是否成功建立过管道
  let framesThisOpen = 0; // 本次连接收到的业务帧数(区分"空闲关闭"与"断流")
  let dialFails = 0; // 连续拨号失败次数(指数退避,超限放弃)
  let dialErr = ""; // 最近一次拨号失败原因(状态行外显,不能吞——否则无从诊断)
  let dropCount = 0; // 连续短命断流次数(收过流又快速被关;超限转就绪兜底)
  let openedAt = 0; // 本次管道建立时刻(存活超 1 分钟视为健康,断流计数归零)
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
    requestAnimationFrame(flush);
  }

  const doSend = async (type: string, payload: unknown = {}): Promise<boolean> => {
    if (!pipe) return false;
    // 管道死亡与 ws-closed 事件到达之间有窗口:发送失败必须外显,不能无声丢;
    // 且要把真实结果返回给调用方(乐观回写必须等这里的真布尔)
    try {
      await pipe.send(JSON.stringify({ type, data: b64encode(JSON.stringify(payload)), timestamp: Date.now() }));
      return true;
    } catch {
      h.onStatus("⚠ 发送失败(云端连接中断),内容未送达", false);
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
    // task-ended 判定先于 seq 去重:回放中控制帧可能把 seq 水位顶高,
    // 后到的 task-ended 会被当重叠帧丢弃,ended 永不置真 → 断开后被
    // 误判断流而无限重连
    if (f.type === "task-ended" && !ended) {
      ended = true;
      h.onEnded?.();
    }
    if (typeof f.seq === "number" && f.seq > 0) {
      if (f.seq <= lastSeq) return; // 重连回放重叠帧去重
      lastSeq = f.seq;
    }
    // cursor(翻页游标)/task-error(拒绝提示,含旧词 error)不算"轮活跃":
    // 空闲 attach 云端也会先发 cursor 再关连接,计入会让空闲关闭被误判
    // 成断流而无限重连
    if (f.type !== "cursor" && f.type !== "error" && f.type !== "task-error") {
      framesThisOpen += 1;
      sentFirst = null; // 有回显 = 首条输入已被云端接收
    }
    queue.push(f);
    schedule();
  }

  function onPipeClose(info: WsCloseInfo | null = null) {
    pipe = null;
    if (closed) return;
    if (ended) {
      // task-ended 按轮下发:这里只代表本轮结束,任务是否终结以详情轮询为准
      h.onStatus("本轮已结束,可继续对话", false);
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
        // 内容交还队列重试,绝不静默丢
        h.onSendFailed?.(sentFirst);
        return;
      }
      // 云端收束/一帧未发就被关:停止重连,转"就绪"——发消息时会另建
      // mode=new 连接
      h.onIdle?.();
      return;
    }
    if (!openedThisAttempt) {
      dialFails += 1;
      if (pendingFirst !== undefined) {
        // 带首条输入的连接没拨通:内容交还视图排队,本连接就此作废
        const input = pendingFirst;
        pendingFirst = undefined;
        closed = true;
        h.onSendFailed?.(input);
        return;
      }
      if (dialFails >= DIAL_GIVEUP_FAILS) {
        // 连不上云端流(网络/环境异常):放弃自动重连,转就绪模式兜底
        closed = true;
        h.onStatus(`⚠ 云端流连接失败${dialErr ? `: ${dialErr}` : ""},发送消息时会重试`, false);
        h.onIdle?.();
        return;
      }
    } else {
      dialFails = 0; // 曾成功收流的断开:从头开始退避
      // 短命断流计数:这条路径没有拨号失败那样的自然上限,若服务端每次
      // 都在回放后快速关闭(且没带 Close 帧可识别),会永远 2 秒循环。
      // 存活超 1 分钟视为健康连接,计数归零;连续短命断流超限转就绪兜底
      if (Date.now() - openedAt > 60_000) dropCount = 0;
      dropCount += 1;
      if (dropCount >= DIAL_GIVEUP_FAILS) {
        closed = true;
        h.onStatus("⚠ 云端流反复断开,发送消息时会重试", false);
        h.onIdle?.();
        return;
      }
    }
    const delay = dialBackoffMs(dialFails);
    h.onStatus(
      `⚠ 云端连接断开${dialErr ? `(${dialErr})` : ""},${Math.round(delay / 1000)} 秒后自动重连…`,
      false,
    );
    curMode = "attach"; // 重连降级为跟看,避免误开新轮(对齐移动端)
    reconnectTimer = setTimeout(open, delay);
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
    h.onStatus("连接云端…", false);
    openPipe("stream", taskId, { mode: curMode }, onText, onPipeClose)
      .then((p) => {
        if (closed) {
          p.close();
          return;
        }
        pipe = p;
        openedThisAttempt = true;
        openedAt = Date.now();
        dialFails = 0;
        dialErr = "";
        h.onStatus("已连接云端", true);
        // 新一轮:云端等第一条 user-input 才开跑;content 需再包一层 base64
        if (pendingFirst !== undefined) {
          sentFirst = pendingFirst;
          // 发送失败不在此处理:零回显被关时经 sentFirst → onSendFailed 兜底
          void doSend("user-input", {
            content: b64encode(pendingFirst.content),
            attachments: pendingFirst.attachments ?? [],
          });
          pendingFirst = undefined;
        }
      })
      .catch((e) => {
        // 拨号失败原因必须留痕:吞掉的话"云端连接断开"循环无从诊断
        dialErr = String(e instanceof Error ? e.message : e).slice(0, 140);
        console.error(`[cloud-stream] 拨号失败(${taskId}):`, e);
        onPipeClose();
      });
  }

  open();
  return {
    send: doSend,
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      pipe?.close();
      pipe = null;
    },
  };
}

// ---- 云端控制流(文件树/读文件/改动/diff/端口;call 按 request_id 配对) ----

export interface CloudControl {
  /** 发一次 call(kind + payload),按 request_id 等待应答;失败 reject(error)。
   * opts.timeoutMs 覆盖默认 15s——控制连接会触发休眠 VM 唤醒(以分钟计),
   * 经唤醒路径的操作必须给足余量;opts.timeoutMsg 定制超时文案(区分
   * "唤醒中,操作可能仍会生效"与普通超时)。 */
  call<T>(
    kind: string,
    payload?: Record<string, unknown>,
    opts?: { timeoutMs?: number; timeoutMsg?: string },
  ): Promise<T>;
  close(): void;
}

const CONTROL_CALL_TIMEOUT_MS = 15_000;

/** 经"休眠唤醒"路径的控制流 call 余量:冷唤醒以分钟计,90s 仍偏紧 */
export const WAKE_CALL_TIMEOUT_MS = 180_000;

/** 连接云端任务控制流(内核代理)。长生命周期;断线按 stream 同族参数
 * 指数退避重连,连续拨号失败/反复断开达上限后放弃自动重连(经 onStatus
 * 外显"环境离线"),下一次 call() 到来时再重新拨号(懒重连)——此前固定
 * 1.5s 无限重连,任务结束/环境回收后长驻抽屉会永远拨号刷屏。
 * 未连上时发起的 call 排队等 open;管道断开时在途 call 立即失败(应答不
 * 可能再来,等 15s 超时只是干耗)。服务端在连接建立时自动唤醒休眠 VM,
 * 连接存续期间保活(对齐 web 控制台机制)。 */
export function connectCloudControl(
  taskId: string,
  h?: { onStatus?(text: string, connected: boolean): void },
): CloudControl {
  let pipe: { send(t: string): Promise<void>; close(): void } | null = null;
  let closed = false;
  let offline = false; // 放弃自动重连后置真:等下一次 call 懒重连
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let openedThisAttempt = false; // 本次尝试是否成功建立过管道
  let dialFails = 0; // 连续拨号失败次数(指数退避,超限放弃)
  let dialErr = ""; // 最近一次拨号失败原因(外显,不能吞——否则无从诊断)
  let dropCount = 0; // 连续短命断开次数(与 stream 同款兜底闸)
  let openedAt = 0; // 本次管道建立时刻(存活超 1 分钟视为健康,断开计数归零)
  interface Pending {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    inFlight: boolean; // 已实际上行(区别于 sendQueue 里排队等 open 的)
  }
  const pending = new Map<string, Pending>();
  let sendQueue: { requestID: string; msg: string }[] = []; // open 前排队的上行帧

  /** 批量失败在途 call;onlyInFlight=true 时放过还在排队的(重连后仍会送达)。 */
  function rejectPending(reason: string, onlyInFlight: boolean) {
    for (const [id, p] of [...pending]) {
      if (onlyInFlight && !p.inFlight) continue;
      pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new Error(reason));
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
    clearTimeout(p.timer);
    if (resp.success === false) p.reject(new Error(resp.error || "云端操作失败"));
    else p.resolve(resp);
  }

  /** 放弃自动重连:失败所有 pending(含排队的——没有重连就没有送达),
   * 外显原因;懒重连武装在 call() 入口。 */
  function giveUp(reason: string) {
    offline = true;
    rejectPending(reason, false);
    sendQueue = [];
    h?.onStatus?.(`⚠ ${reason},下次操作时自动重连`, false);
  }

  function onPipeClose() {
    pipe = null;
    if (closed) return;
    // 在途 call 立即失败:管道已断,应答不可能再来;排队中的保留等重连
    rejectPending("云端连接已断开,操作结果未知", true);
    if (!openedThisAttempt) {
      dialFails += 1;
      if (dialFails >= DIAL_GIVEUP_FAILS) {
        giveUp(`云端环境离线${dialErr ? `(${dialErr})` : ""}`);
        return;
      }
    } else {
      dialFails = 0; // 曾成功建立的断开:退避从头计
      // 短命断开兜底闸(与 stream 对齐):服务端每次接受又快速关闭时,
      // 拨号失败上限永远够不着,没有这道闸就是换了个姿势的无限重连
      if (Date.now() - openedAt > 60_000) dropCount = 0;
      dropCount += 1;
      if (dropCount >= DIAL_GIVEUP_FAILS) {
        giveUp("云端控制连接反复断开");
        return;
      }
    }
    reconnectTimer = setTimeout(open, dialBackoffMs(dialFails));
  }

  function open() {
    if (closed) return;
    openedThisAttempt = false;
    openPipe("control", taskId, {}, onText, onPipeClose)
      .then((p) => {
        if (closed) {
          p.close();
          return;
        }
        pipe = p;
        openedThisAttempt = true;
        openedAt = Date.now();
        dialFails = 0;
        dialErr = "";
        h?.onStatus?.("云端控制通道已连接", true);
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
              clearTimeout(cur.timer);
              cur.reject(new Error("云端连接已断开"));
            }
          });
        }
      })
      .catch((e) => {
        // 拨号失败原因必须留痕:吞掉的话重连循环无从诊断
        dialErr = String(e instanceof Error ? e.message : e).slice(0, 140);
        console.error(`[cloud-control] 拨号失败(${taskId}):`, e);
        onPipeClose();
      });
  }

  open();
  return {
    call<T>(
      kind: string,
      payload: Record<string, unknown> = {},
      opts?: { timeoutMs?: number; timeoutMsg?: string },
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (closed) return reject(new Error("连接已关闭"));
        // 懒重连:放弃后新的 call 说明用户仍需要控制通道,计数清零重新拨
        if (offline && !pipe) {
          offline = false;
          dialFails = 0;
          dropCount = 0;
          open();
        }
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
          timer: setTimeout(() => {
            pending.delete(requestID);
            sendQueue = sendQueue.filter((s) => s.requestID !== requestID);
            reject(new Error(opts?.timeoutMsg ?? "云端操作超时"));
          }, opts?.timeoutMs ?? CONTROL_CALL_TIMEOUT_MS),
        };
        pending.set(requestID, entry);
        if (pipe) {
          entry.inFlight = true;
          pipe.send(msg).catch(() => {
            const p = pending.get(requestID);
            if (p) {
              pending.delete(requestID);
              clearTimeout(p.timer);
              p.reject(new Error("云端连接已断开"));
            }
          });
        } else {
          sendQueue.push({ requestID, msg });
        }
      });
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      rejectPending("连接已关闭", false);
      sendQueue = [];
      pipe?.close();
      pipe = null;
    },
  };
}

/** 云端 VM 终端管道(cloudterm.tsx 用;协议:文本 JSON 帧 data/resize/ping,payload base64)。 */
export function connectCloudTerminal(
  vmId: string,
  terminalId: string,
  h: { onText(text: string): void; onClose(): void },
): Promise<{ send(text: string): Promise<void>; close(): void }> {
  return openPipe("terminal", vmId, { terminal_id: terminalId }, h.onText, h.onClose);
}
