// 云端任务视图状态投影。详情轮询、control、attach、mode=new 与队列 claim
// 全部由 App 级 CloudTaskRuntime 唯一拥有；本 hook 只订阅 runtime、归约帧并维护
// 当前视图的历史分页、草稿、附件上传及菜单状态。
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  beginEdit,
  cancelEdit,
  clearPending,
  cloudSendQueueTarget,
  createSendQueueItem,
  discardUncertain,
  emptySendQueueLane,
  enqueue,
  readSendQueueLane,
  remove,
  reorderBefore,
  subscribeSendQueueLane,
  updateEdited,
  updateSendQueueLane,
  type CloudQueueAttachment,
  type SendQueueLane,
} from "@/features/chat/composer/sendQueue";
import { useCloudQueue, useCloudQueueTask } from "@/features/cloud/CloudQueueCoordinator";
import type { CloudRuntimeEvent } from "@/features/cloud/cloudTaskRuntime";
import { WAKE_CALL_TIMEOUT_MS, type CloudControl } from "@/lib/cloud/control";
import { groupCloudModels, type McCloudModelGroup } from "@/lib/cloud/options";
import { chronoRounds } from "@/lib/cloud/rounds";
import type { StreamStatus } from "@/lib/cloud/stream";
import { MAX_CLOUD_ATTS, uploadCloudFile, type CloudUploadedAtt } from "@/lib/cloud/upload";
import { t } from "@/lib/i18n";
import type { FrameSender } from "@/lib/ipc/approvals";
import {
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

export function cloudInitialSource(status: string): "attach" | "rounds" | "pending" {
  if (status === "processing") return "attach";
  if (status === "finished" || status === "error") return "rounds";
  return "pending";
}

export interface PortInfo {
  port?: number;
  access_url?: string;
  label?: string;
  process?: string;
  status?: string;
}

export interface CloudTaskHandle {
  id: string;
  meta: CloudTaskDetail | null;
  chat: ChatState;
  status: StreamStatus | null;
  connected: boolean;
  ctrlOffline: boolean;
  err: string;
  clearErr(): void;
  notifyErr(msg: string): void;
  label: string;
  taskStatus: string;
  ended: boolean;
  vmId: string;
  running: boolean;
  input: string;
  setInput(v: string): void;
  send(): void;
  atts: CloudUploadedAtt[];
  uploading: number;
  addFiles(files: File[]): void;
  removeAtt(i: number): void;
  models: McCloudModelGroup[] | null;
  loadModels(): void;
  currentModel: CloudTaskDetail["model"];
  switching: boolean;
  switchModel(modelId: string): Promise<void>;
  cancelRun(): void;
  sendFrame: FrameSender;
  stopTask(): Promise<void>;
  cursor: { cursor: string; hasMore: boolean } | null;
  loadingEarlier: boolean;
  loadEarlier(limit?: number): Promise<void>;
  commands: SlashCommand[];
  ports: PortInfo[] | null;
  fetchPorts(): void;
  borrowControl(): { ctrl: CloudControl; release: () => void };
  /** 共享持久化队列；发送中项也来自这里，不再有 hook 私有 outbox。 */
  queue: SendQueueLane<CloudQueueAttachment>;
  editingId: string | null;
  beginEditQueued(id: string): void;
  saveEditedQueued(): boolean;
  cancelEditedQueued(): void;
  removeQueued(id: string): void;
  reorderQueued(id: string, beforeId: string | null): void;
  confirmQueue(): void;
  clearQueue(): void;
  discardUncertain(id: string): void;
  stopAndClearQueue(): void;
  waking: boolean;
  vmOffline: boolean;
  vmFailed: boolean;
  vmNotReady: boolean;
  vmFailReason: string;
  vmStatus: string;
}

const EMPTY_CLOUD_LANE = emptySendQueueLane<CloudQueueAttachment>();

export function useCloudTask(
  task: CloudTask,
  opts: { onTasksChanged?: () => void } = {},
): CloudTaskHandle {
  const id = task.id;
  const cloudQueue = useCloudQueue();
  const runtimeTask = useCloudQueueTask(id);
  const runtime = runtimeTask?.runtime ?? null;
  const snapshot = runtimeTask?.snapshot ?? null;
  const accountScope = cloudQueue.accountScope;
  const { generation: transportGeneration, isCurrent: isTransportCurrent } = useMcTransport();

  const subscribeLane = useCallback(
    (listener: () => void) =>
      accountScope ? subscribeSendQueueLane(cloudSendQueueTarget(accountScope, id), listener) : () => undefined,
    [accountScope, id],
  );
  const getLane = useCallback(
    () => accountScope ? readSendQueueLane<CloudQueueAttachment>(cloudSendQueueTarget(accountScope, id)) : EMPTY_CLOUD_LANE,
    [accountScope, id],
  );
  const queue = useSyncExternalStore(subscribeLane, getLane, getLane);
  const updateLane = useCallback(
    (update: (lane: SendQueueLane<CloudQueueAttachment>) => SendQueueLane<CloudQueueAttachment>) => {
      if (!accountScope) return null;
      return updateSendQueueLane<CloudQueueAttachment>(cloudSendQueueTarget(accountScope, id), update);
    },
    [accountScope, id],
  );

  const meta = snapshot?.detail ?? null;
  const [chat, setChat] = useState<ChatState>(createChatState);
  const [localErr, setErr] = useState("");
  const [input, setInput] = useState("");
  const [atts, setAtts] = useState<CloudUploadedAtt[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const savedDraftRef = useRef<{ input: string; atts: CloudUploadedAtt[] } | null>(null);
  const [uploading, setUploading] = useState(0);
  const attCountRef = useRef(0);
  // 上传结果只能落回发起时的草稿/编辑上下文；取消、保存、终态和切任务都会换代。
  const attachmentContextRef = useRef(0);
  const previousAccountScopeRef = useRef(accountScope);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const [models, setModels] = useState<McCloudModelGroup[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const modelsInFlight = useRef(false);
  const modelsLoadedRef = useRef(false);
  const [cursor, setCursorState] = useState<{ cursor: string; hasMore: boolean } | null>(null);
  const cursorRef = useRef<{ cursor: string; hasMore: boolean } | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadingRef = useRef(false);
  const historyRef = useRef<Frame[]>([]);
  const liveRef = useRef<Frame[]>([]);
  const localNoticesRef = useRef<Frame[]>([]);
  const lastEventRef = useRef(0);
  const loadedRoundsForRef = useRef("");
  const onTasksChangedRef = useRef(opts.onTasksChanged);
  onTasksChangedRef.current = opts.onTasksChanged;

  const applyCursor = useCallback((value: { cursor: string; hasMore: boolean } | null) => {
    cursorRef.current = value;
    setCursorState(value);
  }, []);

  const taskStatus = meta?.status ?? task.status ?? "pending";
  const ended = taskStatus === "finished" || taskStatus === "error";
  const vmId = meta?.virtualmachine?.id ?? "";
  const vmStatus = meta?.virtualmachine?.status ?? "";
  const waking = taskStatus === "processing" && vmStatus === "hibernated";
  const lastCond = meta?.virtualmachine?.conditions?.at(-1);
  const failedCond = lastCond?.type === "Failed" ? lastCond : undefined;
  const vmOffline = taskStatus === "processing" && vmStatus === "offline";
  const vmFailed = vmOffline && !!failedCond;
  const vmNotReady = vmOffline && !failedCond;
  const label = task.title || task.summary || task.content || meta?.title || meta?.summary || t("cloud.list.untitled");

  // 视图卸载/切任务必须释放短暂编辑锁；崩溃场景则由 lane 恢复规则兜底。
  useEffect(() => {
    return () => {
      // 初次身份解析的 null → 稳定 scope 会执行旧 effect cleanup；此时不能
      // 换代，否则解析前启动的上传其 success/finally 都会被挡住并永久卡计数。
      if (!accountScope) return;
      attachmentContextRef.current += 1;
      const itemId = editingIdRef.current;
      if (!itemId) return;
      updateSendQueueLane<CloudQueueAttachment>(cloudSendQueueTarget(accountScope, id), (lane) =>
        cancelEdit(lane, itemId),
      );
    };
  }, [accountScope, id]);

  // 已稳定账号真正离开时清掉账号专属草稿投影与上传预留；null 初次解析成
  // 第一个稳定 scope 不属于切号，必须原样保留此时已经开始的上传。
  useEffect(() => {
    const previous = previousAccountScopeRef.current;
    previousAccountScopeRef.current = accountScope;
    if (!previous || previous === accountScope) return;
    savedDraftRef.current = null;
    editingIdRef.current = null;
    setEditingId(null);
    setInput("");
    setAtts([]);
    setUploading(0);
    attCountRef.current = 0;
  }, [accountScope]);

  // task.id 是挂载边界；这里只清视图投影，不释放 runtime（lease 由协调器 hook 管）。
  useEffect(() => {
    attachmentContextRef.current += 1;
    historyRef.current = [];
    liveRef.current = [];
    localNoticesRef.current = [];
    lastEventRef.current = 0;
    loadedRoundsForRef.current = "";
    setChat(createChatState());
    applyCursor(null);
    setErr("");
    editingIdRef.current = null;
    savedDraftRef.current = null;
    setEditingId(null);
    setInput("");
    setAtts([]);
    setUploading(0);
    attCountRef.current = 0;
  }, [id, applyCursor]);

  const applyRuntimeEvent = useCallback((event: CloudRuntimeEvent) => {
    if (event.kind === "reconnect") {
      liveRef.current = [];
      setChat(reduceBatch(createChatState(), [...historyRef.current, ...localNoticesRef.current]));
      return;
    }
    if (event.kind !== "frames") return;
    const frames: Frame[] = [];
    let turnEnded = false;
    for (const frame of event.frames) {
      if (frame.type === "cursor") {
        const data = frameData<{ cursor?: string; has_more?: boolean }>(frame);
        if (data?.cursor && !cursorRef.current) applyCursor({ cursor: data.cursor, hasMore: !!data.has_more });
        continue;
      }
      if (frame.type === "task-ended") turnEnded = true;
      frames.push(frame);
    }
    if (frames.length) {
      liveRef.current.push(...frames);
      setChat((state) => reduceBatch(state, frames));
    }
    if (turnEnded) {
      historyRef.current = [...historyRef.current, ...liveRef.current];
      liveRef.current = [];
      onTasksChangedRef.current?.();
    }
  }, [applyCursor]);

  // eventsSince 是为切离期间多批帧补齐的小幅 runtime API 扩展；旧假 runtime
  // 没实现时退回 snapshot.event，便于渐进测试与第三方注入。
  useEffect(() => {
    if (!runtime || !snapshot?.event) return;
    const events = runtime.eventsSince?.(lastEventRef.current) ?? [snapshot.event];
    for (const event of events) {
      if (event.sequence <= lastEventRef.current) continue;
      lastEventRef.current = event.sequence;
      applyRuntimeEvent(event);
    }
  }, [runtime, snapshot?.event, applyRuntimeEvent]);

  // 结束态历史仍由 REST rounds 权威播种；runtime 只拥有详情轮询与实时 transport。
  useEffect(() => {
    if (!ended || loadedRoundsForRef.current === id) return;
    loadedRoundsForRef.current = id;
    let alive = true;
    const expectedTransport = transportGeneration;
    void mcTaskRounds(id, "", 1)
      .then((result) => {
        if (!alive || !isTransportCurrent(expectedTransport)) return;
        historyRef.current = chronoRounds(result.frames ?? []);
        liveRef.current = [];
        applyCursor(result.next_cursor ? { cursor: result.next_cursor, hasMore: !!result.has_more } : null);
        setChat(reduceBatch(createChatState(), [...historyRef.current, ...localNoticesRef.current]));
      })
      .catch((error: unknown) => {
        if (alive && isTransportCurrent(expectedTransport)) {
          setErr(t("cloud.err.loadFailed", { reason: error instanceof Error ? error.message : String(error) }));
        }
      });
    return () => { alive = false; };
  }, [ended, id, transportGeneration, isTransportCurrent, applyCursor]);

  useEffect(() => {
    if (chat.commands.length) setCommands(chat.commands);
  }, [chat.commands]);

  const send = () => {
    if (editingIdRef.current) return;
    const text = withCommandSeparator(input, commands);
    if (!text.trim() || ended) return;
    if (uploading > 0) {
      setErr(t("cloud.attach.uploadingWait"));
      return;
    }
    const attachments: CloudQueueAttachment[] = atts.map(({ url, filename, isImage }) => ({ url, filename, isImage }));
    const result = updateLane((lane) => enqueue(lane, createSendQueueItem(text, attachments)));
    if (!result) {
      setErr(t("cloud.err.sendRejected"));
      return;
    }
    if (!result.ok) setErr(t("chat.sendQueue.persistenceFailed"));
    // 每次追加都立即清草稿与本条附件；后续录入绑定到下一条队列项。
    if (result.ok) setErr("");
    setInput("");
    setAtts([]);
    attCountRef.current = 0;
  };

  const addFiles = (files: File[]) => {
    if (editingIdRef.current) {
      setErr(t("chat.sendQueue.attachmentsReadOnly"));
      return;
    }
    if (ended) return;
    const context = attachmentContextRef.current;
    void (async () => {
      for (const file of files) {
        if (attachmentContextRef.current !== context) break;
        if (attCountRef.current >= MAX_CLOUD_ATTS) {
          setErr(t("cloud.attach.limit", { n: MAX_CLOUD_ATTS }));
          break;
        }
        attCountRef.current += 1;
        setUploading((count) => count + 1);
        try {
          const attachment = await uploadCloudFile(file);
          if (attachmentContextRef.current !== context) continue;
          setAtts((previous) => [...previous, attachment]);
          setErr("");
        } catch (error) {
          if (attachmentContextRef.current === context) {
            attCountRef.current -= 1;
            setErr(t("cloud.attach.uploadFailed", { reason: error instanceof Error ? error.message : String(error) }));
          }
        } finally {
          if (attachmentContextRef.current === context) setUploading((count) => Math.max(0, count - 1));
        }
      }
    })();
  };

  const removeAtt = (index: number) => {
    if (editingIdRef.current) {
      setErr(t("chat.sendQueue.attachmentsReadOnly"));
      return;
    }
    attCountRef.current = Math.max(0, attCountRef.current - 1);
    setAtts((previous) => previous.filter((_, at) => at !== index));
  };

  const loadModels = useCallback(() => {
    if (modelsLoadedRef.current || modelsInFlight.current) return;
    modelsInFlight.current = true;
    mcTaskOptions()
      .then((options) => {
        modelsLoadedRef.current = true;
        setModels(groupCloudModels(options.models, options.plan));
      })
      .catch((error: unknown) => setErr(t("cloud.model.loadFailed", { reason: error instanceof Error ? error.message : String(error) })))
      .finally(() => { modelsInFlight.current = false; });
  }, []);

  const borrowControl = useCallback(() => {
    if (!runtimeTask) throw new Error("Cloud task runtime is not ready");
    return runtimeTask.borrowControl();
  }, [runtimeTask]);

  const fetchPorts = () => {
    if (!vmId || ended) return;
    setPorts(null);
    let borrowed: ReturnType<typeof borrowControl>;
    try { borrowed = borrowControl(); } catch { setPorts([]); return; }
    borrowed.ctrl
      .call<{ ports?: PortInfo[] }>("port_forward_list", {}, { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: t("cloud.ctl.wakeTimeout") })
      .then((result) => setPorts(result.ports ?? []))
      .catch(() => setPorts([]))
      .finally(borrowed.release);
  };

  const currentModel = meta?.model;
  const switchModel = async (modelId: string) => {
    if (switching || !modelId || modelId === currentModel?.id) return;
    const pickedModel = models?.flatMap((group) => group.models).find((model) => model.id === modelId);
    if (pickedModel?.locked) return;
    setSwitching(true);
    setErr("");
    let borrowed: ReturnType<typeof borrowControl> | null = null;
    try {
      borrowed = borrowControl();
      const result = await borrowed.ctrl.call<{ model?: CloudTaskDetail["model"] }>(
        "switch_model",
        { model_id: modelId, load_session: true },
        { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: t("cloud.ctl.wakeTimeout") },
      );
      const nextModel = result.model ?? pickedModel ?? { id: modelId };
      runtime?.confirmModel(nextModel);
      const name = nextModel.remark || nextModel.model;
      if (name) {
        const notice: Frame = {
          type: "task-running",
          kind: "acp_event",
          data: { update: { sessionUpdate: "model_update", model: name } },
        };
        localNoticesRef.current.push(notice);
        setChat((state) => reduceBatch(state, [notice]));
      }
    } catch (error) {
      setErr(t("cloud.model.switchFailed", { reason: error instanceof Error ? error.message : String(error) }));
    } finally {
      borrowed?.release();
      setSwitching(false);
    }
  };

  const sendFrame: FrameSender = useCallback(async (type, payload) => {
    if (!runtimeTask) throw new Error("Cloud task runtime is not ready");
    await runtimeTask.sendFrame(type, payload);
  }, [runtimeTask]);

  const cancelRun = () => {
    if (!runtimeTask) {
      setErr(t("cloud.err.cancelNotSent"));
      return;
    }
    void runtimeTask.cancelRun().catch(() => setErr(t("cloud.err.cancelNotSent")));
  };

  const stopTask = async () => {
    const expectedTransport = transportGeneration;
    try {
      await mcTaskStop(id);
      if (isTransportCurrent(expectedTransport)) onTasksChangedRef.current?.();
    } catch (error) {
      if (isTransportCurrent(expectedTransport)) {
        setErr(t("cloud.err.stopFailed", { reason: error instanceof Error ? error.message : String(error) }));
      }
    }
  };

  const loadEarlier = async (limit = 1) => {
    const current = cursorRef.current;
    if (!current || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingEarlier(true);
    try {
      const result = await mcTaskRounds(id, current.cursor, limit);
      const frames = chronoRounds(result.frames ?? []);
      historyRef.current = [...frames, ...historyRef.current];
      applyCursor(result.next_cursor && result.has_more !== false ? { cursor: result.next_cursor, hasMore: !!result.has_more } : null);
      setChat((state) => prependHistory(state, frames));
    } catch (error) {
      setErr(t("cloud.err.loadFailed", { reason: error instanceof Error ? error.message : String(error) }));
    } finally {
      loadingRef.current = false;
      setLoadingEarlier(false);
    }
  };

  const beginEditQueued = (itemId: string) => {
    if (ended || editingIdRef.current || uploading > 0) {
      if (uploading > 0) setErr(t("chat.sendQueue.editUploadPending"));
      return;
    }
    let acquired = false;
    const result = updateLane((lane) => {
      const next = beginEdit(lane, itemId);
      acquired = next !== lane;
      return next;
    });
    const lockedItem = acquired ? result?.lane.pending.find((entry) => entry.id === itemId) : undefined;
    if (!result || !lockedItem || result.lane.editing?.itemId !== itemId) {
      setErr(t("chat.sendQueue.editConflict"));
      return;
    }
    if (!result.ok) {
      updateLane((lane) => cancelEdit(lane, itemId));
      setErr(t("chat.sendQueue.persistenceFailed"));
      return;
    }
    savedDraftRef.current = { input, atts: [...atts] };
    attachmentContextRef.current += 1;
    editingIdRef.current = itemId;
    setEditingId(itemId);
    setInput(lockedItem.content);
    setAtts(lockedItem.attachments.map((attachment) => ({ ...attachment })));
    attCountRef.current = lockedItem.attachments.length;
    setErr("");
  };

  const restoreDraftAfterEdit = () => {
    const saved = savedDraftRef.current ?? { input: "", atts: [] };
    attachmentContextRef.current += 1;
    savedDraftRef.current = null;
    editingIdRef.current = null;
    setEditingId(null);
    setUploading(0);
    setInput(saved.input);
    setAtts([...saved.atts]);
    attCountRef.current = saved.atts.length;
  };

  const saveEditedQueued = (): boolean => {
    const itemId = editingIdRef.current;
    const content = withCommandSeparator(input, commands);
    if (!itemId || !content.trim() || uploading > 0) return false;
    const attachments: CloudQueueAttachment[] = atts.map(({ url, filename, isImage }) => ({ url, filename, isImage }));
    let updated = false;
    let lockedLane: SendQueueLane<CloudQueueAttachment> | null = null;
    const result = updateLane((lane) => {
      lockedLane = lane;
      const next = updateEdited(lane, itemId, content, attachments);
      updated = next !== lane;
      return next;
    });
    if (!result || !updated) {
      setErr(t("chat.sendQueue.editConflict"));
      restoreDraftAfterEdit();
      return false;
    }
    if (!result.ok) {
      // 持久化失败时内存已经是解锁后的新正文；回滚为转换前带锁原项，保留编辑面供重试。
      if (lockedLane) updateLane(() => lockedLane!);
      setErr(t("chat.sendQueue.persistenceFailed"));
      return false;
    }
    setErr("");
    restoreDraftAfterEdit();
    return true;
  };

  const cancelEditedQueued = () => {
    const itemId = editingIdRef.current;
    if (!itemId) return;
    const result = updateLane((lane) => cancelEdit(lane, itemId));
    if (result && !result.ok) setErr(t("chat.sendQueue.persistenceFailed"));
    restoreDraftAfterEdit();
  };

  // CloudComposer 在终态隐藏但 hook 保持挂载；终态边沿必须主动释放 durable 编辑锁。
  useEffect(() => {
    if (!ended) return;
    const itemId = editingIdRef.current;
    if (!itemId) return;
    attachmentContextRef.current += 1;
    updateLane((lane) => cancelEdit(lane, itemId));
    savedDraftRef.current = null;
    editingIdRef.current = null;
    setEditingId(null);
    setInput("");
    setAtts([]);
    setUploading(0);
    attCountRef.current = 0;
  }, [ended, updateLane]);

  return {
    id,
    meta,
    chat,
    status: snapshot?.streamStatus ?? null,
    connected: snapshot?.connected ?? false,
    ctrlOffline: snapshot?.controlStatus?.kind === "offline",
    err: localErr || snapshot?.error || "",
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
    currentModel,
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
    queue,
    editingId,
    beginEditQueued,
    saveEditedQueued,
    cancelEditedQueued,
    removeQueued: (itemId) => { updateLane((lane) => remove(lane, itemId)); },
    reorderQueued: (itemId, beforeId) => { updateLane((lane) => reorderBefore(lane, itemId, beforeId)); },
    confirmQueue: () => runtimeTask?.confirmResume(),
    clearQueue: () => { updateLane(clearPending); },
    discardUncertain: (itemId) => { updateLane((lane) => discardUncertain(lane, itemId)); },
    stopAndClearQueue: () => cloudQueue.dropTask(id),
    waking,
    vmOffline,
    vmFailed,
    vmNotReady,
    vmFailReason: failedCond?.message ?? "",
    vmStatus,
  };
}
