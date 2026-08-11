// composer 状态机:草稿/单槽排队/附件上传/发送与停止。
// 发送面契约(对表壳侧 driver/session.rs::session_send):
// - user-input 载荷只有 {content: b64};本地附件不进独立字段,按
//   「[图片]/[文件] <工作区相对路径>」附件行并入正文(旧 UI ATT_LINE 同
//   口径,壳只解 content)。
// - Err ⟺ 消息未入会话(未物化任何帧)——失败回队/回草稿是安全的;
//   引擎接活后本轮失败会回 Ok(错误走 task-error 帧),不得重投。
// - 停止 = user-cancel {}(取消斡旋与看门狗都在壳侧)。
// 排队语义:运行中/上一条未回执时发送进单槽(后发覆盖先发,chip 外显可
// 取消),轮结束(running 变 false)自动补投;失败回队并压住自动重投,
// 直到下一批帧到达 / running 变化 / 退避重试到点 / 用户再次发送。
// 补投的三道闸(每道都对应过一次真实故障,见各自注释):
//   ①feed.historyLoaded —— 首份历史归约前 running 不可信,不许抢投;
//   ②stateSid === sessionId —— 切会话那一帧里 queued 还属于上一个会话;
//   ③sendingRef —— 上行在途(壳已收、回显帧未到)期间不许第二条直发。
import { useCallback, useEffect, useRef, useState } from "react";

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
  queued: string | null;
  clearQueued(): void;
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
  const [queued, setQueued] = useState<string | null>(null);
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
  const uploadSeqRef = useRef(0);
  const errorTimer = useRef(0);

  // 「当前这份 composer 状态归属哪个会话」。必须是 state 而不是 ref:切会话
  // 那一帧里 sessionId 已经换新,而 draft/queued/atts 还是上一个会话的值——
  // 留档-恢复 effect 的 setState 要下一次渲染才回流,可补投 effect 就排在它
  // 后面、同一次提交里跑,拿到的正是「旧 queued + 新 sessionId」,于是
  // sessionSend(新会话, 旧文本)(send() 早有 forSid/activeRef 纪元守卫,
  // 唯独这条自动路径漏了)。恢复 effect 落位时与 draft/queued 同批提交,
  // 补投 effect 因它变化重新起跑,不靠"下一次恰好有别的依赖变"。
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
  const snapRef = useRef<{ draft: string; queued: string | null; atts: ComposerAtt[] }>({
    draft: "",
    queued: null,
    atts: [],
  });
  snapRef.current = { draft, queued, atts };
  // 当前活跃会话(迟到的发送回执按它守卫,不污染切换后的会话)
  const activeRef = useRef(sessionId);
  activeRef.current = sessionId;

  // 切会话 = 先留档再恢复(草稿/排队/附件按 sid 暂存,切回不丢;上传中列表
  // 是瞬态不入档,在途收尾回调按 id 过滤,清空后的 filter/map 无害)。
  // 留档挂在 cleanup:切走与卸载(关视图/进设置)统一走同一条路径。
  useEffect(() => {
    const entry = stashGet(sessionId);
    setDraft(entry?.draft ?? "");
    setQueued(entry?.queued ?? null);
    setAtts(entry?.atts ? [...entry.atts] : []);
    setUploads([]);
    setError(null);
    setStateSid(sessionId); // 与上面几个 setState 同批提交:补投 effect 据此放行
    sendingRef.current = false;
    flushBlockedRef.current = false;
    clearRetry();
    // 登记活动队列槽:后台补投失败且人恰好切进来时,消息回到这里
    const unbind = bindActiveComposer(sessionId, (text) => {
      if (snapRef.current.queued) return false; // 已排新内容则让位(单槽后发优先)
      setQueued(text);
      return true;
    });
    return () => {
      unbind();
      stashSet(sessionId, snapRef.current);
      clearRetry();
    };
  }, [sessionId, clearRetry]);

  useEffect(() => () => window.clearTimeout(errorTimer.current), []);

  // 帧水位抬升 = 壳已经把上一条上行物化成帧(user-input 回显 + task-started),
  // 这才是"上行落地"的可信信号。此前是 session_send 的 Promise resolve 就摘
  // 在途标记,可壳在**引擎 ack** 时就返回、回显帧还要 ~30ms 才批量推回:
  // 这段真空里 running 仍是 false、sendingRef 也已归零,紧跟着的第二条会
  // **直发**,撞上壳的忙碌守卫(driver/session.rs 「当前会话已有任务在执行」),
  // catch 静默把草稿放回输入框——用户看到的是"消息自己跳回来了"。
  // 顺带解除失败抑制:新帧到达说明这条通道还活着(旧 UI 每批帧都重投一次)。
  useEffect(() => {
    sendingRef.current = false;
    flushBlockedRef.current = false;
    clearRetry();
  }, [lastSeq, clearRetry]);

  const notifyError = useCallback((message: string) => {
    setError(message);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), ERROR_TTL_MS);
  }, []);

  const dismissError = useCallback(() => {
    window.clearTimeout(errorTimer.current);
    setError(null);
  }, []);

  const send = useCallback((): boolean => {
    const text = [draft.trim(), ...atts.map(attLine)].filter(Boolean).join("\n");
    if (!text) return false;
    // /compact 是控制指令不是消息:直达壳的 session_call,不得进排队槽
    // (排队会在轮后把「/compact」当普通文本发给模型)。忙时外显错误并留
    // 住草稿;接受后不乐观落帧——压缩生命周期由壳外显(task_started +
    // 实时 compact_status(started) → task_ended)。reject ⟺ 压缩没起来
    // (忙碌/旧引擎无能力/会话未打开),走 ErrorBar;开轮后的失败壳按
    // user-input 同契约经 task-error 帧收进对话流,不再 reject。
    if (draft.trim() === "/compact" && atts.length === 0) {
      if (running || sendingRef.current || queued) {
        notifyError(t("chat.compact.busy"));
        return false;
      }
      setDraft("");
      void sessionCompact(sessionId).catch((e: unknown) => {
        notifyError(t("chat.compact.failed", { reason: e instanceof Error ? e.message : String(e) }));
      });
      return true;
    }
    if (running || sendingRef.current || queued) {
      // 单槽排队,后发覆盖先发(chip 可见,最新一条为准);用户主动再发
      // 也解除失败抑制,flush effect 在空闲时立即补投
      flushBlockedRef.current = false;
      clearRetry();
      setQueued(text);
      setDraft("");
      setAtts([]);
      return true;
    }
    sendingRef.current = true;
    const forSid = sessionId;
    const prevDraft = draft;
    const prevAtts = atts;
    setDraft("");
    setAtts([]);
    // 成功路径**不摘** sendingRef:壳在引擎 ack 时就返回,回显帧还在路上,
    // 这段真空里摘掉标记会让下一条直发撞忙碌守卫(见上面的帧水位 effect)
    void sessionSend(sessionId, "user-input", { content: b64encode(text) })
      .catch((e: unknown) => {
        sendingRef.current = false;
        // 失败不丢草稿:文本回输入框、附件回 chips(壳契约 Err ⟺ 未入会话)。
        // 回执迟到且人已切走 → 回原会话留档,不污染当前会话(纪元守卫)
        if (activeRef.current !== forSid) {
          const prev = stashGet(forSid);
          stashSet(forSid, {
            draft: prev?.draft || prevDraft,
            queued: prev?.queued ?? null,
            atts: prev?.atts.length ? prev.atts : prevAtts,
          });
          return;
        }
        // 期间用户已敲了新内容/新附件则让位,不覆盖
        setDraft((cur) => (cur ? cur : prevDraft));
        setAtts((cur) => (cur.length ? cur : prevAtts));
        // **必须外显**:只回滚草稿的话,用户看到的是"输入框先清空、片刻后原文
        // 又跳回来",界面一句解释都没有——分不清是自己手滑还是引擎出了问题,
        // 只能反复重试,而重试同样静默失败。壳侧 Err 分支是实打实的:
        // driver/session.rs 的 ensure_engine_ready / 「会话未打开」/
        // 「当前会话已有任务在执行」,引擎重启后与会话恢复失败后最容易撞上。
        // ErrorBar 正是本文件其它失败路径(上传、切模型/档位/权限模式)统一
        // 使用的外显通道;云端侧 CloudTaskView 也早就渲染了 sendFailed
        notifyError(t("chat.sendFailed", { reason: e instanceof Error ? e.message : String(e) }));
      });
    return true;
  }, [draft, atts, queued, running, sessionId, clearRetry]);

  // 排队补投:轮结束(running 变 false)且无在途上行时发出。
  // 重跑时机 = running 变化 / 队列内容变化 / 新一批帧(lastSeq)/ 退避到点
  // (flushTick)/ 会话状态归位(composerReady)——旧 UI 的「每批帧 + 重连 +
  // 历史落地」三处重投在这里对应到前三项。
  useEffect(() => {
    if (running) {
      // 开轮 = 上一条上行已被壳接收;失败抑制也随轮次推进解除
      sendingRef.current = false;
      flushBlockedRef.current = false;
      clearRetry();
      return;
    }
    // historyLoaded:首份历史归约前 running 恒 false 却不可信(会话可能正在
    // 后台跑轮),抢投必被壳的忙碌守卫拒掉,再落进下面的失败抑制里——
    // "恢复的排队消息永远发不出去"的两条根因串在一起(旧 UI 同款闸门)。
    // composerReady:切会话那一帧 queued 还属于上一个会话,发出去就是投错人。
    if (!historyLoaded || !composerReady || !queued || sendingRef.current || flushBlockedRef.current) return;
    const q = queued;
    const forSid = sessionId;
    sendingRef.current = true;
    setQueued(null);
    // 同 send():成功路径不摘 sendingRef,交给帧水位 effect
    void sessionSend(sessionId, "user-input", { content: b64encode(q) })
      .catch(() => {
        sendingRef.current = false;
        flushBlockedRef.current = true;
        scheduleRetry();
        // 回执迟到且人已切走 → 回原会话暂存(deliverQueued 接手后台补投)
        if (activeRef.current !== forSid) {
          const prev = stashGet(forSid);
          if (!prev?.queued) {
            stashSet(forSid, { draft: prev?.draft ?? "", queued: q, atts: prev?.atts ?? [] });
          }
          return;
        }
        // 失败回队;在途期间用户又排了新的,按单槽语义保留最新那条
        setQueued((cur) => cur ?? q);
      });
  }, [running, queued, sessionId, historyLoaded, composerReady, lastSeq, flushTick, clearRetry, scheduleRetry]);

  const stop = useCallback(() => {
    void sessionSend(sessionId, "user-cancel", {}).catch(() => {});
  }, [sessionId]);

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
            queued: prev?.queued ?? null,
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

  // 取消排队 = 这条消息不要了:在途的退避重试一并撤销,免得定时器到点又
  // 把已经撤掉的抑制闸放开、白跑一次 effect
  const clearQueued = useCallback(() => {
    clearRetry();
    flushBlockedRef.current = false;
    setQueued(null);
  }, [clearRetry]);

  return {
    draft,
    setDraft,
    queued,
    clearQueued,
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
  };
}
