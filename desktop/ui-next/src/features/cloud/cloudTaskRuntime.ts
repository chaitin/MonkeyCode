import {
  block,
  claimHead,
  cloudSendQueueTarget,
  completeTurn,
  confirmResume as confirmQueueResume,
  isCloudQueueAttachment,
  markReceipt,
  markUncertain,
  nackHead,
  pausePending,
  readSendQueueLane,
  subscribeSendQueueLane,
  updateSendQueueLane,
  type CloudQueueAttachment,
  type SendQueueBlock,
  type SendQueueLane,
} from "@/features/chat/composer/sendQueue";
import { connectCloudControl, type CloudControl, type ControlStatus } from "@/lib/cloud/control";
import { connectCloudStream, type CloudStreamConn, type CloudUserInput, type StreamHandlers, type StreamStatus } from "@/lib/cloud/stream";
import { mcTaskInfo, type CloudTaskDetail } from "@/lib/ipc/cloudtasks";
import type { Frame } from "@/lib/protocol/types";

export const CLOUD_TASK_INFO_POLL_MS = 2_000;
export const CLOUD_SEND_RECEIPT_MS = 15_000;

export type CloudRuntimeEvent =
  | { sequence: number; kind: "frames"; frames: Frame[] }
  | { sequence: number; kind: "reconnect" }
  | { sequence: number; kind: "attention"; reason: "task-ended" | "error" };
type CloudRuntimeEventInput =
  | { kind: "frames"; frames: Frame[] }
  | { kind: "reconnect" }
  | { kind: "attention"; reason: "task-ended" | "error" };

export interface CloudTaskRuntimeSnapshot {
  taskId: string;
  accountScope: string;
  detail: CloudTaskDetail | null;
  reconciling: boolean;
  streamStatus: StreamStatus | null;
  connected: boolean;
  controlStatus: ControlStatus | null;
  controlConnected: boolean;
  error: string;
  event: CloudRuntimeEvent | null;
}

export interface CloudTaskRuntimeLease {
  release(): void;
}

export interface CloudTaskRuntime {
  readonly taskId: string;
  readonly accountScope: string;
  acquire(reason: "view" | "queue"): CloudTaskRuntimeLease;
  subscribe(listener: () => void): () => void;
  getSnapshot(): CloudTaskRuntimeSnapshot;
  /** 视图切离期间产生的事件批次；用于重新挂载后补齐同一 runtime 的帧。 */
  eventsSince?(sequence: number): readonly CloudRuntimeEvent[];
  sendFrame(type: string, payload?: unknown): Promise<void>;
  /** 用户主动取消当前轮：先暂停剩余队列，再发送取消帧。 */
  cancelRun(): Promise<void>;
  borrowControl(): { ctrl: CloudControl; release(): void };
  /** 控制调用成功后立即更新详情投影；后续 taskInfo 刷新仍是权威来源。 */
  confirmModel(model: CloudTaskDetail["model"]): void;
  confirmResume(): void;
  invalidate(reason?: SendQueueBlock): void;
  dispose(): void;
}

export interface CloudRuntimeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  queueMicrotask(fn: () => void): void;
}

export interface CloudRuntimeDeps {
  readLane(taskId: string): SendQueueLane<CloudQueueAttachment>;
  updateLane(
    taskId: string,
    update: (lane: SendQueueLane<CloudQueueAttachment>) => SendQueueLane<CloudQueueAttachment>,
  ): SendQueueLane<CloudQueueAttachment>;
  subscribeLane(taskId: string, listener: () => void): () => void;
  taskInfo(taskId: string): Promise<CloudTaskDetail>;
  connectControl(
    taskId: string,
    handlers: { onStatus?(status: ControlStatus, connected: boolean): void },
  ): CloudControl;
  connectStream(
    taskId: string,
    mode: "attach" | "new",
    handlers: StreamHandlers,
    input?: CloudUserInput,
  ): CloudStreamConn;
  clock: CloudRuntimeClock;
  generation: number;
  isGenerationCurrent(generation: number): boolean;
  pollMs: number;
  receiptTimeoutMs: number;
  onAttention?(taskId: string, reason: "task-ended" | "error"): void;
}

const realClock: CloudRuntimeClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  queueMicrotask: (fn) => globalThis.queueMicrotask(fn),
};

export function defaultCloudRuntimeDeps(
  accountScope: string,
  generation: number,
  isGenerationCurrent: (generation: number) => boolean,
  onAttention?: CloudRuntimeDeps["onAttention"],
): CloudRuntimeDeps {
  return {
    readLane: (taskId) =>
      readSendQueueLane(cloudSendQueueTarget(accountScope, taskId), { attachmentGuard: isCloudQueueAttachment }),
    updateLane: (taskId, update) =>
      updateSendQueueLane(cloudSendQueueTarget(accountScope, taskId), update, {
        attachmentGuard: isCloudQueueAttachment,
      }).lane,
    subscribeLane: (taskId, listener) =>
      subscribeSendQueueLane(cloudSendQueueTarget(accountScope, taskId), listener),
    taskInfo: mcTaskInfo,
    connectControl: (taskId, handlers) => connectCloudControl(taskId, handlers),
    connectStream: (taskId, mode, handlers, input) => connectCloudStream(taskId, mode, handlers, input),
    clock: realClock,
    generation,
    isGenerationCurrent,
    pollMs: CLOUD_TASK_INFO_POLL_MS,
    receiptTimeoutMs: CLOUD_SEND_RECEIPT_MS,
    onAttention,
  };
}

interface DispatchToken {
  generation: number;
  runtimeEpoch: number;
  taskId: string;
  itemId: string;
  streamId: number;
}

interface StreamSlot {
  id: number;
  mode: "attach" | "new";
  conn: CloudStreamConn | null;
  /** stream 会在 give-up status 后紧接 onIdle；保留结构化失败，禁止后者
   * 把异常收束误写成可发送 idle。 */
  terminalFailure: "dialGaveUp" | "dropGaveUp" | null;
}

const laneHasWork = (lane: SendQueueLane<CloudQueueAttachment>) =>
  lane.pending.length > 0 || lane.inFlight !== null;
const laneIsExecutable = (lane: SendQueueLane<CloudQueueAttachment>) => laneHasWork(lane) && lane.blocked === null;
const isTerminal = (status: string) => status === "finished" || status === "error";
const isBusinessFrame = (frame: Frame) =>
  frame.type !== "cursor" && frame.type !== "error" && frame.type !== "task-error" && frame.type !== "task-ended";
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function taskInfoBlock(error: unknown, at: number): SendQueueBlock {
  const message = errorText(error);
  if (/401|403|unauthor|forbidden/i.test(message)) return { code: "unauthorized", message, at };
  if (/404|not found|missing/i.test(message)) return { code: "task-missing", message, at };
  return { code: "control-offline", message, at };
}

export function createCloudTaskRuntime(
  accountScope: string,
  taskId: string,
  deps: CloudRuntimeDeps,
): CloudTaskRuntime {
  let disposed = false;
  let runtimeEpoch = 1;
  let viewRefs = 0;
  let queueRefs = 0;
  let controlRefs = 0;
  let eventSequence = 0;
  const eventLog: CloudRuntimeEvent[] = [];
  let streamSequence = 0;
  let controlSequence = 0;
  let activeControlId = 0;
  let evaluating = false;
  let evaluationQueued = false;
  let infoPending = false;
  let detailRevision = 0;
  let roundState: "unknown" | "busy" | "idle" | "blocked" = "unknown";
  let ctrl: CloudControl | null = null;
  let stream: StreamSlot | null = null;
  let dispatchToken: DispatchToken | null = null;
  let pollTimer: unknown = null;
  let receiptTimer: unknown = null;
  const listeners = new Set<() => void>();
  let snapshot: CloudTaskRuntimeSnapshot = {
    taskId,
    accountScope,
    detail: null,
    reconciling: true,
    streamStatus: null,
    connected: false,
    controlStatus: null,
    controlConnected: false,
    error: "",
    event: null,
  };
  const getDispatchToken = (): DispatchToken | null => dispatchToken;

  const emit = (patch: Partial<CloudTaskRuntimeSnapshot> = {}) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const emitEvent = (event: CloudRuntimeEventInput) => {
    eventSequence += 1;
    const next = { ...event, sequence: eventSequence } as CloudRuntimeEvent;
    eventLog.push(next);
    // 这里只承接短期后台→前台恢复；长期历史仍由 rounds 分页负责。
    if (eventLog.length > 512) eventLog.splice(0, eventLog.length - 512);
    emit({ event: next });
  };
  const current = () => !disposed && deps.isGenerationCurrent(deps.generation);
  const clearPoll = () => {
    if (pollTimer !== null) deps.clock.clearTimeout(pollTimer);
    pollTimer = null;
  };
  const clearReceipt = () => {
    if (receiptTimer !== null) deps.clock.clearTimeout(receiptTimer);
    receiptTimer = null;
  };
  const tokenMatches = (token: DispatchToken | null, streamId?: number) =>
    !!token &&
    current() &&
    token.generation === deps.generation &&
    token.runtimeEpoch === runtimeEpoch &&
    token.taskId === taskId &&
    (streamId === undefined || token.streamId === streamId);
  const closeStream = () => {
    const old = stream;
    stream = null;
    old?.conn?.close();
    emit({ connected: false });
  };
  const closeControlIfUnused = () => {
    const lane = deps.readLane(taskId);
    if (viewRefs > 0 || controlRefs > 0 || laneIsExecutable(lane)) return;
    activeControlId = 0;
    ctrl?.close();
    ctrl = null;
    emit({ controlConnected: false });
  };
  const releaseNetwork = () => {
    clearPoll();
    clearReceipt();
    closeStream();
    if (controlRefs === 0) {
      activeControlId = 0;
      ctrl?.close();
      ctrl = null;
      emit({ controlConnected: false });
    }
  };
  const setLaneBlock = (reason: SendQueueBlock) => {
    const lane = deps.readLane(taskId);
    if (!laneHasWork(lane)) return lane;
    if (lane.blocked?.code === reason.code) return lane;
    return deps.updateLane(taskId, (value) => block(value, reason));
  };
  const schedulePoll = () => {
    if (pollTimer !== null || !current()) return;
    pollTimer = deps.clock.setTimeout(() => {
      pollTimer = null;
      void refreshInfo();
    }, deps.pollMs);
  };
  const ensureControl = () => {
    if (ctrl || !current()) return ctrl;
    const epoch = runtimeEpoch;
    const controlId = ++controlSequence;
    activeControlId = controlId;
    try {
      const made = deps.connectControl(taskId, {
        onStatus(status, connected) {
          if (!current() || epoch !== runtimeEpoch || activeControlId !== controlId) return;
          emit({ controlStatus: status, controlConnected: connected });
          if (status.kind === "offline") {
            setLaneBlock({
              code: "control-offline",
              message: status.reason || "Cloud control connection is offline",
              at: deps.clock.now(),
            });
            kick();
          }
        },
      });
      ctrl = made;
      return made;
    } catch (error) {
      if (activeControlId === controlId) activeControlId = 0;
      setLaneBlock({ code: "control-offline", message: errorText(error), at: deps.clock.now() });
      emit({ error: errorText(error) });
      return null;
    }
  };
  const invalidateDispatch = () => {
    clearReceipt();
    dispatchToken = null;
  };

  const finishTurn = (token: DispatchToken) => {
    if (!tokenMatches(token)) return;
    const lane = deps.readLane(taskId);
    const completed = completeTurn(lane, token.itemId);
    if (completed === lane) {
      setLaneBlock({
        code: "receipt-unknown",
        message: "Cloud round ended before its receipt could be confirmed",
        at: deps.clock.now(),
      });
      invalidateDispatch();
      closeStream();
      return;
    }
    deps.updateLane(taskId, () => completed);
    invalidateDispatch();
    closeStream();
    roundState = "idle";
    if (viewRefs === 0) {
      emitEvent({ kind: "attention", reason: "task-ended" });
      deps.onAttention?.(taskId, "task-ended");
    }
    snapshot = { ...snapshot, reconciling: true };
    void refreshInfo();
    deps.clock.queueMicrotask(kick);
  };

  const handleFrames = (slot: StreamSlot, frames: Frame[]) => {
    if (!current() || stream !== slot) return;
    emitEvent({ kind: "frames", frames });
    for (const frame of frames) {
      if (slot.mode === "attach") {
        if (isBusinessFrame(frame)) roundState = "busy";
        if (frame.type === "task-ended") {
          roundState = "idle";
          closeStream();
          snapshot = { ...snapshot, reconciling: true };
          void refreshInfo();
        }
        continue;
      }
      const token = dispatchToken;
      if (!token || !tokenMatches(token, slot.id)) continue;
      if (isBusinessFrame(frame)) {
        const lane = deps.readLane(taskId);
        const next = markReceipt(lane, token.itemId);
        if (next !== lane) deps.updateLane(taskId, () => next);
        clearReceipt();
        roundState = "busy";
      }
      if (frame.type === "task-ended") finishTurn(token);
    }
    kick();
  };

  const streamHandlers = (slot: StreamSlot): StreamHandlers => ({
    onFrames: (frames) => handleFrames(slot, frames),
    onStatus: (status, connected) => {
      if (!current() || stream !== slot) return;
      emit({ streamStatus: status, connected });
      if (status.kind !== "dialGaveUp" && status.kind !== "dropGaveUp") return;
      slot.terminalFailure = status.kind;
      roundState = "blocked";
      const message = status.kind === "dialGaveUp"
        ? `Cloud task stream could not connect${status.reason ? `: ${status.reason}` : ""}`
        : "Cloud task stream repeatedly disconnected";
      if (slot.mode === "new" && tokenMatches(dispatchToken, slot.id)) {
        // mode=new 收到业务回显后 firstInput 已被接受，后续重连降级 attach。
        // 此时 give-up 既不能 complete，也不能 nack 自动重发，只能把已出门项
        // 标成 uncertain，等待用户明确确认。
        deps.updateLane(taskId, (lane) => markUncertain(lane, message, deps.clock.now()));
        invalidateDispatch();
      } else {
        setLaneBlock({ code: "control-offline", message, at: deps.clock.now() });
      }
      emit({ error: message });
    },
    onReconnect: () => {
      if (!current() || stream !== slot) return;
      emitEvent({ kind: "reconnect" });
    },
    onIdle: () => {
      if (!current() || stream !== slot) return;
      stream = null;
      emit({ connected: false });
      if (slot.terminalFailure) {
        // dialGaveUp/dropGaveUp 后的 onIdle 只是 stream 状态机的收尾通知，
        // 不是“当前轮已确认空闲”。保持 blocked，绝不据此开 mode=new。
        kick();
        return;
      }
      if (slot.mode === "new") {
        const token = dispatchToken;
        if (tokenMatches(token, slot.id)) {
          // mode=new 已有业务回显却没有 task-ended 就普通收束：只能确认“已
          // 投递”，不能确认“该轮已结束”。receipt timer 此时已经清掉，若仅
          // 释放 stream 会让 awaiting-turn-end 永久悬挂；也不能 nack 自动重发。
          const message = "Cloud task stream closed before task-ended was observed";
          deps.updateLane(taskId, (lane) => markUncertain(lane, message, deps.clock.now()));
          invalidateDispatch();
          roundState = "blocked";
          emit({ error: message });
        }
        kick();
        return;
      }
      if (slot.mode === "attach") {
        roundState = "idle";
        kick();
      }
    },
    onSendFailed: () => {
      if (!current() || stream !== slot || slot.mode !== "new") return;
      const token = dispatchToken;
      if (!token || !tokenMatches(token, slot.id)) return;
      const reason: SendQueueBlock = {
        code: "send-rejected",
        message: "Cloud transport rejected the queued message",
        at: deps.clock.now(),
      };
      deps.updateLane(taskId, (lane) => nackHead(lane, token.itemId, reason));
      invalidateDispatch();
      stream = null;
      emit({ connected: false, error: reason.message });
      kick();
    },
  });

  const openStream = (mode: "attach" | "new", input?: CloudUserInput, itemId?: string) => {
    if (stream || !current()) return;
    const slot: StreamSlot = { id: ++streamSequence, mode, conn: null, terminalFailure: null };
    stream = slot;
    if (mode === "new" && itemId) {
      dispatchToken = {
        generation: deps.generation,
        runtimeEpoch,
        taskId,
        itemId,
        streamId: slot.id,
      };
    }
    try {
      const conn = deps.connectStream(taskId, mode, streamHandlers(slot), input);
      if (stream === slot) slot.conn = conn;
      else conn.close();
    } catch (error) {
      if (stream === slot) stream = null;
      if (mode === "new" && dispatchToken?.streamId === slot.id) {
        const token = dispatchToken;
        deps.updateLane(taskId, (lane) =>
          nackHead(lane, token.itemId, {
            code: "send-rejected",
            message: errorText(error),
            at: deps.clock.now(),
          }),
        );
        invalidateDispatch();
      }
      emit({ error: errorText(error), connected: false });
    }
  };

  const dispatchHead = () => {
    if (!current() || stream || dispatchToken) return;
    const lane = deps.readLane(taskId);
    const claimed = claimHead(lane, { phase: "awaiting-receipt", startedAt: deps.clock.now() });
    if (claimed === lane || !claimed.inFlight) return;
    deps.updateLane(taskId, () => claimed); // claim 必须在开流之前持久化。
    const item = claimed.inFlight.item;
    const input: CloudUserInput = {
      content: item.content,
      ...(item.attachments.length
        ? { attachments: item.attachments.map(({ url, filename }) => ({ url, filename })) }
        : {}),
    };
    openStream("new", input, item.id);
    // dispatchToken 在 openStream 内赋值；经函数边界读取，避免沿用入口处
    // “当前为空”的控制流窄化。
    const token = getDispatchToken();
    if (!token) return;
    receiptTimer = deps.clock.setTimeout(() => {
      if (!tokenMatches(token, token.streamId)) return;
      deps.updateLane(taskId, (value) =>
        markUncertain(value, "Cloud delivery receipt was not observed before timeout", deps.clock.now()),
      );
      invalidateDispatch();
      closeStream();
      emit({ error: "Cloud delivery receipt was not observed before timeout" });
      kick();
    }, deps.receiptTimeoutMs);
  };

  const evaluate = () => {
    if (!current()) return;
    const lane = deps.readLane(taskId);
    const active = viewRefs > 0 || controlRefs > 0 || laneIsExecutable(lane);
    if (!active) {
      releaseNetwork();
      return;
    }
    const detail = snapshot.detail;
    if (!detail) {
      if (!infoPending) void refreshInfo();
      return;
    }
    // task-ended/确认恢复后必须先拿新详情；旧 processing 快照不能越过
    // reconciliation 直接领取下一项，否则任务刚转终态时仍会误开 mode=new。
    if (snapshot.reconciling || infoPending) return;
    if (roundState === "blocked") return;
    const status = detail.status ?? "";
    if (isTerminal(status)) {
      const blocked = setLaneBlock({ code: "task-ended", message: "Cloud task has ended", at: deps.clock.now() });
      releaseNetwork();
      if (viewRefs === 0 && laneHasWork(lane) && blocked !== lane) deps.onAttention?.(taskId, "error");
      return;
    }
    const vmStatus = detail.virtualmachine?.status?.toLowerCase() ?? "";
    const failed = detail.virtualmachine?.conditions?.at(-1)?.type === "Failed";
    if (failed) {
      setLaneBlock({ code: "vm-failed", message: "Cloud virtual machine failed to start", at: deps.clock.now() });
      releaseNetwork();
      return;
    }
    // 少数详情会在 task 仍标 pending 时先暴露 hibernated VM；唤醒判据以 VM
    // 实态优先，不能被 task.status 的启动期枚举挡掉。
    if (vmStatus === "hibernated") {
      ensureControl()?.revive();
      schedulePoll();
      return;
    }
    if (status === "pending") {
      schedulePoll();
      return;
    }
    if (status !== "processing") {
      schedulePoll();
      return;
    }
    if (vmStatus === "pending" || vmStatus === "offline") {
      schedulePoll();
      return;
    }
    ensureControl();
    if (roundState === "unknown") {
      openStream("attach");
      return;
    }
    if (roundState === "idle" && laneIsExecutable(lane) && !lane.inFlight) dispatchHead();
  };

  function kick() {
    if (!current() || evaluationQueued) return;
    evaluationQueued = true;
    deps.clock.queueMicrotask(() => {
      evaluationQueued = false;
      if (evaluating || !current()) return;
      evaluating = true;
      try {
        evaluate();
      } finally {
        evaluating = false;
      }
    });
  }

  async function refreshInfo() {
    if (infoPending || !current()) return;
    infoPending = true;
    clearPoll();
    const epoch = runtimeEpoch;
    const revision = detailRevision;
    emit({ reconciling: true });
    try {
      const detail = await deps.taskInfo(taskId);
      if (!current() || epoch !== runtimeEpoch) return;
      const resolvedDetail = revision === detailRevision
        ? detail
        : { ...detail, model: snapshot.detail?.model };
      emit({ detail: resolvedDetail, reconciling: false, error: "" });
    } catch (error) {
      if (!current() || epoch !== runtimeEpoch) return;
      const reason = taskInfoBlock(error, deps.clock.now());
      setLaneBlock(reason);
      emit({ reconciling: false, error: reason.message });
      if (reason.code !== "unauthorized" && reason.code !== "task-missing") schedulePoll();
    } finally {
      if (epoch === runtimeEpoch) infoPending = false;
      kick();
    }
  }

  const unsubscribeLane = deps.subscribeLane(taskId, kick);

  const runtime: CloudTaskRuntime = {
    taskId,
    accountScope,
    acquire(reason) {
      if (disposed) throw new Error("CloudTaskRuntime is disposed");
      if (reason === "view") viewRefs += 1;
      else queueRefs += 1;
      kick();
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          if (reason === "view") viewRefs = Math.max(0, viewRefs - 1);
          else queueRefs = Math.max(0, queueRefs - 1);
          kick();
        },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    eventsSince: (sequence) => eventLog.filter((event) => event.sequence > sequence),
    async sendFrame(type, payload) {
      if (!current() || !stream?.conn) throw new Error("Cloud task stream is not connected");
      const ok = await stream.conn.send(type, payload);
      if (!ok) throw new Error("Cloud task stream rejected the frame");
    },
    async cancelRun() {
      // 先落暂停再出 cancel；否则 task-ended 可能先触发 kick 并领取下一条。
      deps.updateLane(taskId, (lane) => pausePending(lane, deps.clock.now()));
      await runtime.sendFrame("user-cancel", {});
    },
    borrowControl() {
      if (disposed) throw new Error("CloudTaskRuntime is disposed");
      controlRefs += 1;
      const borrowed = ensureControl();
      if (!borrowed) {
        controlRefs -= 1;
        throw new Error("Cloud control connection could not be created");
      }
      let released = false;
      return {
        ctrl: borrowed,
        release() {
          if (released) return;
          released = true;
          controlRefs = Math.max(0, controlRefs - 1);
          closeControlIfUnused();
          kick();
        },
      };
    },
    confirmModel(model) {
      if (!current()) return;
      detailRevision += 1;
      emit({ detail: { ...(snapshot.detail ?? { id: taskId }), model } });
    },
    confirmResume() {
      deps.updateLane(taskId, confirmQueueResume);
      roundState = "unknown";
      emit({ reconciling: true, error: "" });
      void refreshInfo();
    },
    invalidate(reason = {
      code: "transport-changed",
      message: "Cloud transport changed; confirm before resuming",
      at: deps.clock.now(),
    }) {
      if (disposed) return;
      setLaneBlock(reason);
      runtimeEpoch += 1;
      invalidateDispatch();
      releaseNetwork();
      emit({ reconciling: false, error: reason.message });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtimeEpoch += 1;
      unsubscribeLane();
      invalidateDispatch();
      clearPoll();
      closeStream();
      activeControlId = 0;
      ctrl?.close();
      ctrl = null;
      listeners.clear();
    },
  };
  return runtime;
}
