// composer 状态机：草稿/结构化持久发送队列/附件上传/发送与停止。
// 发送面契约(对表壳侧 driver/session.rs::session_send):
// - user-input 载荷只有 {content: b64};本地附件不进独立字段,按
//   「[图片]/[文件] <工作区相对路径>」附件行并入正文(旧 UI ATT_LINE 同
//   口径,壳只解 content)。
// - Err ⟺ 消息未入会话(未物化任何帧)——失败回队/回草稿是安全的;
//   引擎接活后本轮失败会回 Ok(错误走 task-error 帧),不得重投。
// - 停止 = user-cancel {}(取消斡旋与看门狗都在壳侧)。
// 排队语义：运行中/上一条未回执/已有 lane 时结构化追加；轮结束只领取一个
// 队首。失败同 ID 回队首并阻塞，直到帧/轮次/退避/用户动作解除。
// 补投安全闸：historyLoaded、stateSid、sendingRef；帧水位确认 receipt，
// running=true→false 完成对应轮，sid + item id 隔离迟到异步回调。
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { t } from "@/lib/i18n";
import { sessionCompact } from "@/lib/ipc/controls";
import { sessionSend } from "@/lib/ipc/sessions";
import { attLineOf } from "@/lib/protocol/attLine";
import {
  isImagePath,
  nativePathOf,
  uploadFilePath,
  uploadFileStream,
} from "@/lib/ipc/uploads";
import { b64encode } from "@/lib/protocol/codec";
import { bindActiveComposer, stashGet, stashSet } from "./stash";
import {
  claimHead,
  clearPending,
  completeTurn,
  confirmResume,
  createSendQueueItem,
  discardUncertain,
  enqueue,
  getSendQueueLaneSnapshot,
  localSendQueueTarget,
  markReceipt,
  nackHead,
  pausePending,
  remove,
  reorderBefore,
  resumeAutomatic,
  subscribeSendQueueLane,
  updateSendQueueLane,
  type LocalQueueAttachment,
  type SendQueueLane,
} from "./sendQueue";

export interface ComposerAtt {
  /** 工作区相对路径(壳返回;附件行与模型可读路径都用它)。 */
  path: string;
  name: string;
  isImage: boolean;
}

export interface ComposerUpload {
  id: number;
  name: string;
  /** 0-100;-1 = 不确定进度(路径直拷/空文件,无分块回调)。 */
  pct: number;
  /** 分块通道可取消;路径直拷不可(无句柄)。 */
  cancel?: () => void;
}

/** 本地附件行(约定唯一出处在 lib/protocol/attLine,进消息正文)。 */
export const attLine = (a: ComposerAtt) => attLineOf(a.path, a.isImage);

export interface ComposerCtl {
  draft: string;
  setDraft(v: string): void;
  queue: SendQueueLane<LocalQueueAttachment>;
  removeQueued(id: string): void;
  reorderQueued(id: string, beforeId: string | null): void;
  resumeQueue(): void;
  clearQueue(): void;
  discardUncertainQueued(id: string): void;
  atts: ComposerAtt[];
  removeAtt(index: number): void;
  uploads: ComposerUpload[];
  /** 短暂错误提示(上传/切换失败;自动消退)。 */
  error: string | null;
  dismissError(): void;
  notifyError(message: string): void;
  /** 发送草稿+附件;运行中自动排队。返回是否已接受(发送或排队)。 */
  send(): boolean;
  stop(): void;
  /** 粘贴/拖拽的 File 上传为附件(path-backed 占位走路径直拷)。 */
  addFiles(files: File[]): Promise<void>;
  /** 系统对话框选出的本地路径直拷为附件。 */
  addPaths(paths: string[]): Promise<void>;
}

const ERROR_TTL_MS = 8000;

/** 补投失败后的退避重试节奏(ms)。旧 UI 在「每批帧到达 / 断线重连 / 首份
 *  历史落地」三处反复重投,ui-next 只在 running 变化时解除失败抑制——可
 *  失败若恰好发生在空闲期(壳还没接活),那条 running 边沿可能永远不来,
 *  「已排队」chip 就永久钉住、谁也不再投。帧水位变化已经补回"每批帧重投",
 *  这串退避再补上"一帧都不再来"的死角;耗尽即停,不无限空转。 */
const FLUSH_RETRY_MS = [600, 1800, 5000, 12000];

/** 数据面喂给 composer 的三个信号(全部来自 useSessionFeed 的 ChatState)。 */
export interface ComposerFeed {
  /** 轮次执行中(壳的忙碌守卫按它拒直发)。 */
  running: boolean;
  /** 首份历史(尾部回放窗口)已落地——落地前 running 恒 false 但不可信。 */
  historyLoaded: boolean;
  /** 帧 seq 水位:任一批帧到达即抬升。等价于旧 UI 的 onFrames 时机——
   *  "壳已把上一条上行物化成帧",是解除在途标记与失败抑制的唯一可信信号。 */
  lastSeq: number;
}

export function useComposer(sessionId: string, feed: ComposerFeed): ComposerCtl {
  const { running, historyLoaded, lastSeq } = feed;
  const [draft, setDraft] = useState("");
  const target = useMemo(() => localSendQueueTarget(sessionId), [sessionId]);
  const subscribeLane = useCallback((listener: () => void) => subscribeSendQueueLane(target, listener), [target]);
  const getLane = useCallback(() => getSendQueueLaneSnapshot<LocalQueueAttachment>(target), [target]);
  const queue = useSyncExternalStore(subscribeLane, getLane, getLane);
  const [atts, setAtts] = useState<ComposerAtt[]>([]);
  const [uploads, setUploads] = useState<ComposerUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 上行在途:user-input 发出到回执/开轮之间再发必须入队,否则第二条直发
  // 会被壳的忙碌守卫拒掉
  const sendingRef = useRef(false);
  // 排队补投失败后的抑制闸:防「失败→回队→effect 立即重投」空转,
  // 新帧到达/running 变化/退避到点/用户再次发送时解除
  const flushBlockedRef = useRef(false);
  const retryTimer = useRef(0);
  const retryStep = useRef(0);
  // 补投 effect 的显式重跑信号(退避定时器只能改 ref,得有个 state 推一把)
  const [flushTick, setFlushTick] = useState(0);
  const handledFlushTickRef = useRef(0);
  const uploadSeqRef = useRef(0);
  const errorTimer = useRef(0);
  const previousRunningRef = useRef(running);
  const currentRunningRef = useRef(running);
  currentRunningRef.current = running;
  // 当前 hook 启动的队列 IPC token；每个 sid 记录稳定 item id，切走后迟到回调
  // 仍更新原 lane，而同 sid 的后续项/删除后的空 lane 会由 item id 转换守卫挡住。
  const queueDispatchRef = useRef(new Map<string, string>());

  // 草稿/附件仍经 effect 留档恢复；切会话首帧里 sessionId/queue target 已换，
  // 但编辑面 state 尚未完成恢复。stateSid 作为会话纪元闸，阻止这一帧启动补投。
  const [stateSid, setStateSid] = useState(sessionId);
  const composerReady = stateSid === sessionId;

  const clearRetry = useCallback(() => {
    window.clearTimeout(retryTimer.current);
    retryTimer.current = 0;
    retryStep.current = 0;
  }, []);
  const scheduleRetry = useCallback(() => {
    const delay = FLUSH_RETRY_MS[retryStep.current];
    if (delay === undefined) return; // 退避耗尽:停手,等帧/轮次/用户再发
    retryStep.current += 1;
    window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      flushBlockedRef.current = false;
      setFlushTick((n) => n + 1);
    }, delay);
  }, []);

  // 编辑面快照(留档用):cleanup 时拿到的是最后一次已提交状态
  const snapRef = useRef<{ draft: string; atts: ComposerAtt[] }>({
    draft: "",
    atts: [],
  });
  snapRef.current = { draft, atts };
  // 当前活跃会话(迟到的发送回执按它守卫,不污染切换后的会话)
  const activeRef = useRef(sessionId);
  activeRef.current = sessionId;

  // 切会话 = 先留档再恢复(草稿/排队/附件按 sid 暂存,切回不丢;上传中列表
  // 是瞬态不入档,在途收尾回调按 id 过滤,清空后的 filter/map 无害)。
  // 留档挂在 cleanup:切走与卸载(关视图/进设置)统一走同一条路径。
  useEffect(() => {
    const entry = stashGet(sessionId);
    setDraft(entry?.draft ?? "");
    setAtts(entry?.atts ? [...entry.atts] : []);
    setUploads([]);
    setError(null);
    setStateSid(sessionId); // 与上面几个 setState 同批提交:补投 effect 据此放行
    sendingRef.current = false;
    flushBlockedRef.current = false;
    clearRetry();
    previousRunningRef.current = currentRunningRef.current;
    const unbind = bindActiveComposer(sessionId);
    return () => {
      unbind();
      stashSet(sessionId, snapRef.current);
      clearRetry();
    };
  }, [sessionId, clearRetry]);

  useEffect(() => () => window.clearTimeout(errorTimer.current), []);

  const notifyError = useCallback((message: string) => {
    setError(message);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), ERROR_TTL_MS);
  }, []);

  const dismissError = useCallback(() => {
    window.clearTimeout(errorTimer.current);
    setError(null);
  }, []);

  const updateQueue = useCallback(
    (transition: (lane: SendQueueLane<LocalQueueAttachment>) => SendQueueLane<LocalQueueAttachment>) => {
      const result = updateSendQueueLane<LocalQueueAttachment>(target, transition);
      if (!result.ok) notifyError(t("chat.sendQueue.persistenceFailed"));
      return result.lane;
    },
    [notifyError, target],
  );

  useEffect(() => {
    if (handledFlushTickRef.current === flushTick) return;
    handledFlushTickRef.current = flushTick;
    updateQueue(resumeAutomatic);
  }, [flushTick, updateQueue]);

  const send = useCallback((): boolean => {
    const content = draft.trim();
    if (!content && atts.length === 0) return false;
    // /compact 是控制指令，不得进入待发送 lane。
    if (content === "/compact" && atts.length === 0) {
      if (running || sendingRef.current || queue.pending.length > 0 || queue.inFlight || queue.blocked) {
        notifyError(t("chat.compact.busy"));
        return false;
      }
      setDraft("");
      void sessionCompact(sessionId).catch((e: unknown) => {
        notifyError(t("chat.compact.failed", { reason: e instanceof Error ? e.message : String(e) }));
      });
      return true;
    }

    if (running || sendingRef.current || queue.pending.length > 0 || queue.inFlight || queue.blocked) {
      // 忙碌/已有 lane 时结构化追加到队尾；附件行只在真正投递时生成。
      flushBlockedRef.current = false;
      clearRetry();
      updateQueue((lane) => enqueue(resumeAutomatic(lane), createSendQueueItem(content, atts)));
      setDraft("");
      setAtts([]);
      return true;
    }

    const text = [content, ...atts.map(attLine)].filter(Boolean).join("\n");
    sendingRef.current = true;
    const forSid = sessionId;
    const prevDraft = draft;
    const prevAtts = atts;
    setDraft("");
    setAtts([]);
    // 成功路径不摘 sendingRef：必须等帧水位或开轮信号。
    void sessionSend(forSid, "user-input", { content: b64encode(text) }).catch((e: unknown) => {
      sendingRef.current = false;
      if (activeRef.current !== forSid) {
        const prev = stashGet(forSid);
        stashSet(forSid, {
          draft: prev?.draft || prevDraft,
          atts: prev?.atts.length ? prev.atts : prevAtts,
        });
        return;
      }
      setDraft((cur) => cur || prevDraft);
      setAtts((cur) => (cur.length ? cur : prevAtts));
      notifyError(e instanceof Error ? e.message : String(e));
    });
    return true;
  }, [
    draft,
    atts,
    running,
    queue.pending.length,
    queue.inFlight,
    queue.blocked,
    sessionId,
    notifyError,
    clearRetry,
    updateQueue,
  ]);

  // 帧水位抬升 = 上行已物化。只把匹配 baseline 的队列项推进到等待轮末；
  // Promise resolve 本身不摘 in-flight，避免 ack 与首帧之间的真空连投。
  useEffect(() => {
    sendingRef.current = false;
    flushBlockedRef.current = false;
    clearRetry();
    updateQueue((lane) => {
      let next = resumeAutomatic(lane);
      const inFlight = next.inFlight;
      if (inFlight && (inFlight.baselineSeq === undefined || lastSeq > inFlight.baselineSeq)) {
        next = markReceipt(next, inFlight.item.id);
      }
      return next;
    });
  }, [lastSeq, clearRetry, updateQueue]);

  // 开轮确认 receipt；只有观察到同一会话 running=true → false 才完成该项。
  useEffect(() => {
    const wasRunning = previousRunningRef.current;
    previousRunningRef.current = running;
    sendingRef.current = false;
    flushBlockedRef.current = false;
    clearRetry();
    updateQueue((lane) => {
      let next = resumeAutomatic(lane);
      const itemId = next.inFlight?.item.id;
      if (running && itemId) next = markReceipt(next, itemId);
      if (!running && wasRunning && itemId) next = completeTurn(next, itemId);
      return next;
    });
  }, [running, clearRetry, updateQueue]);

  // 空闲时原子领取一个队首并投递；领取先落持久化，失败同 ID 回队首且阻塞。
  useEffect(() => {
    if (
      running ||
      !historyLoaded ||
      !composerReady ||
      queue.pending.length === 0 ||
      queue.inFlight ||
      queue.blocked ||
      sendingRef.current ||
      flushBlockedRef.current
    ) {
      return;
    }
    const claimed = updateQueue((lane) =>
      claimHead(lane, { phase: "awaiting-receipt", baselineSeq: lastSeq }),
    ).inFlight;
    if (!claimed || claimed.phase !== "awaiting-receipt") return;

    const forSid = sessionId;
    const itemId = claimed.item.id;
    const text = [
      claimed.item.content.trim(),
      ...claimed.item.attachments.map((att) => attLineOf(att.path, att.isImage)),
    ]
      .filter(Boolean)
      .join("\n");
    sendingRef.current = true;
    queueDispatchRef.current.set(forSid, itemId);
    void sessionSend(forSid, "user-input", { content: b64encode(text) }).then(
      () => {
        if (queueDispatchRef.current.get(forSid) === itemId) queueDispatchRef.current.delete(forSid);
      },
      (e: unknown) => {
        if (queueDispatchRef.current.get(forSid) !== itemId) return;
        queueDispatchRef.current.delete(forSid);
        updateSendQueueLane<LocalQueueAttachment>(localSendQueueTarget(forSid), (lane) =>
          nackHead(lane, itemId, {
            code: "send-rejected",
            message: e instanceof Error ? e.message : String(e),
            at: Date.now(),
          }),
        );
        if (activeRef.current === forSid) {
          sendingRef.current = false;
          flushBlockedRef.current = true;
          notifyError(e instanceof Error ? e.message : String(e));
          scheduleRetry();
        }
      },
    );
  }, [
    running,
    historyLoaded,
    composerReady,
    queue.pending,
    queue.inFlight,
    queue.blocked,
    sessionId,
    lastSeq,
    flushTick,
    notifyError,
    scheduleRetry,
    updateQueue,
  ]);

  const stop = useCallback(() => {
    // 用户停止与正常轮末必须分流：先持久化暂停，再发 cancel，避免 task-ended
    // 边沿抢先领取下一条；空队列也需短暂设屏障，拦住取消完成前的新消息。
    clearRetry();
    flushBlockedRef.current = false;
    updateQueue(pausePending);
    void sessionSend(sessionId, "user-cancel", {});
  }, [clearRetry, sessionId, updateQueue]);

  /** 上传一个来源并入列附件;失败外显、不阻断后续文件。 */
  const uploadOne = useCallback(
    async (run: (onProgress: (sent: number, total: number) => void, signal: AbortSignal) => Promise<{ path: string }>, name: string, indeterminate: boolean, fallbackIsImage: boolean) => {
      const id = ++uploadSeqRef.current;
      const forSid = sessionId;
      const ctl = new AbortController();
      setUploads((list) => [
        ...list,
        {
          id,
          // 空名兜底(旧 UI useSession.ts `f.name || "文件"`):剪贴板截图可为
          // 空名(uploads.ts 头注),不兜底的话上传中的 chip 就是一枚只有
          // spinner + 百分比、没有任何文字的 badge——大图分块要传数秒,这
          // 几秒里用户看不出这是什么。**只兜显示名**:下面成品附件仍优先
          // 用真实路径末段(比"未命名文件"信息量大),两者不共用一个值。
          name: name || t("common.unnamedFile"),
          pct: indeterminate ? -1 : 0,
          ...(indeterminate ? {} : { cancel: () => ctl.abort() }),
        },
      ]);
      try {
        const { path } = await run((sent, total) => {
          // 封顶 99:最后一块落地后还有 finish(改名)在途,100% 由出列表达
          const pct = total > 0 ? Math.min(99, Math.floor((sent / total) * 100)) : 99;
          setUploads((list) => list.map((u) => (u.id === id ? { ...u, pct } : u)));
        }, ctl.signal);
        const att: ComposerAtt = {
          path,
          name: name || path.split("/").pop() || "file",
          isImage: fallbackIsImage || isImagePath(path),
        };
        // 大文件上传耗时可观(数秒),期间完全可能已切会话:附件只归原会话。
        // 不守卫的话它会落进**当前**会话的 composer,而 path 是按旧工作区
        // 算的相对路径——附件行发出去模型根本读不到那个文件(旧 UI
        // useSession.ts:555-571 同款纪元守卫)
        if (activeRef.current === forSid) {
          setAtts((list) => [...list, att]);
        } else {
          const prev = stashGet(forSid);
          stashSet(forSid, {
            draft: prev?.draft ?? "",
            atts: [...(prev?.atts ?? []), att],
          });
        }
      } catch (e) {
        if (!ctl.signal.aborted) {
          notifyError(t("chat.uploadFailed", { reason: e instanceof Error ? e.message : String(e) }));
        }
      } finally {
        setUploads((list) => list.filter((u) => u.id !== id));
      }
    },
    [notifyError, sessionId],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const f of files) {
        const native = nativePathOf(f);
        await uploadOne(
          (onProgress, signal) =>
            native
              ? uploadFilePath(sessionId, native)
              : uploadFileStream(sessionId, f, { onProgress, signal }),
          f.name,
          !!native || f.size === 0,
          f.type.startsWith("image/"),
        );
      }
    },
    [sessionId, uploadOne],
  );

  const addPaths = useCallback(
    async (paths: string[]) => {
      for (const p of paths) {
        const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
        await uploadOne(() => uploadFilePath(sessionId, p), name, true, false);
      }
    },
    [sessionId, uploadOne],
  );

  const removeAtt = useCallback((index: number) => {
    setAtts((list) => list.filter((_, i) => i !== index));
  }, []);

  const removeQueued = useCallback(
    (id: string) => {
      clearRetry();
      flushBlockedRef.current = false;
      updateQueue((lane) => remove(lane, id));
    },
    [clearRetry, updateQueue],
  );
  const reorderQueued = useCallback(
    (id: string, beforeId: string | null) => updateQueue((lane) => reorderBefore(lane, id, beforeId)),
    [updateQueue],
  );
  const resumeQueue = useCallback(() => {
    clearRetry();
    flushBlockedRef.current = false;
    updateQueue(confirmResume);
  }, [clearRetry, updateQueue]);
  const clearQueue = useCallback(() => {
    clearRetry();
    flushBlockedRef.current = false;
    updateQueue(clearPending);
  }, [clearRetry, updateQueue]);
  const discardUncertainQueued = useCallback(
    (id: string) => updateQueue((lane) => discardUncertain(lane, id)),
    [updateQueue],
  );

  return useMemo(
    () => ({
      draft,
      setDraft,
      queue,
      removeQueued,
      reorderQueued,
      resumeQueue,
      clearQueue,
      discardUncertainQueued,
      atts,
      removeAtt,
      uploads,
      error,
      dismissError,
      notifyError,
      send,
      stop,
      addFiles,
      addPaths,
    }),
    [
      draft,
      queue,
      removeQueued,
      reorderQueued,
      resumeQueue,
      clearQueue,
      discardUncertainQueued,
      atts,
      removeAtt,
      uploads,
      error,
      dismissError,
      notifyError,
      send,
      stop,
      addFiles,
      addPaths,
    ],
  );
}
