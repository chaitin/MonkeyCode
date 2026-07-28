// 会话状态容器 hook:WS 连接生命周期、帧归约、composer(输入/排队/附件)、
// 模型与权限模式切换、改动查询,统一收口为一个句柄。App 只留布局切换与
// App 级浮层,ChatView 整体消费句柄而非逐项 props。协议层(client/reduce)不变。
//
// 分层(与 useCloudTask 同款):
//   createSessionCore —— 连接生命周期 + 帧归约 + composer(排队/附件)状态机,
//     刻意不触 React:副作用全部经 SessionCoreIO 注入,vitest 用假壳 IPC
//     即可直接驱动(useSession.test.ts)。ChatState 由核心持有,io.setChat
//     只是视图镜像——原来散在 hook 里的四个 effect(连上补发、轮结束刷新、
//     排队投递、卸载断开)在这里成为显式时机,可测即可守。
//   useSession —— React 侧:state 持有与镜像回写、notice 定时器、卸载断开,
//     拼装为 SessionHandle(形状不变)。
import { useCallback, useEffect, useRef, useState } from "react";
import { connect, sessionFrame, sessionHistory, sessionOutline, type Conn, type HistoryPage } from "./session";
import { uploadFile, uploadFileURL } from "./uploads";
import { b64decode, b64encode } from "./codec";
import {
  answerAsk as applyAskAnswer,
  answerPerm as applyPermAnswer,
  initialChat,
  prependBatch,
  reduceBatch,
  type ChatState,
} from "./reduce";
import type { Attachment, FileChange, FileEntry, Frame, SessionNotice } from "./types";

/** 提问大纲的一条(壳的 session_outline 投影;text 已解 base64) */
export interface OutlineItem {
  /** 产生它的 user-input 帧 seq:与 LogItem.user.seq 对表 */
  seq: number;
  /** 该轮在 replay.jsonl 的字节偏移:跳到未加载区间时当翻页 cursor */
  offset: number;
  text: string;
  timestamp?: number;
}

export type PermAction = "allow" | "always" | "persist" | "deny";

/** 「上次会话」记忆:读写统一在本模块(open 写入、close(forget) 清除、App 启动恢复时读)。 */
const LAST_SESSION_KEY = "mc.lastSession";
export const lastSessionId = () => localStorage.getItem(LAST_SESSION_KEY);

/** 单附件上传:File → base64 → 壳命令落盘工作区 uploads 目录,返回附件
 * 描述(超限/读取/上传失败抛出)。会话内 addFiles 与新建会话的首条消息
 * 附件共用。 */
async function uploadAtt(sid: string, f: File): Promise<Attachment> {
  if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name || "文件"} 过大(上限 20MB)`);
  const dataURL = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("读取文件失败"));
    r.readAsDataURL(f);
  });
  const b64 = dataURL.slice(dataURL.indexOf(",") + 1);
  const isImage = f.type.startsWith("image/");
  const { path } = await uploadFile(sid, f.name, f.type, b64);
  return { path, isImage, name: f.name || path.split("/").pop() || "", preview: isImage ? dataURL : undefined };
}

/** 附件行:send() 与新建会话首条消息共用的「[图片]/[文件] 路径」约定 */
const attLine = (a: Attachment) => `${a.isImage ? "[图片]" : "[文件]"} ${a.path}`;

// ==================== 状态机核心(非 React,可单测) ====================

/** 核心对宿主(hook / 测试)的输出口:React 状态回写与浏览器全局副作用
 * 全部经此注入,核心自身不 import React——这正是连接生命周期与 composer
 * 状态机可被 vitest 直接驱动的原因。hook 侧的实现全部指向稳定 setter /
 * ref 转接,核心一次构造即长期持有。 */
export interface SessionCoreIO {
  /** 当前会话 ID(null = 未打开/已复位) */
  setId(id: string | null): void;
  /** 对话状态镜像:帧归约、审批/提问回写、模型与权限模式切换的唯一出口
   * (ChatState 是唯一真值,由核心持有,这里只推给视图) */
  setChat(chat: ChatState): void;
  /** 连接状态文案(侧栏状态行,只反映连接) */
  setStatus(text: string): void;
  setConnected(ok: boolean): void;
  /** 输入框(发送成功才清空;失败保留供重试) */
  setInput(text: string): void;
  /** 排队内容镜像(React state,供 UI 外显) */
  setQueued(text: string | null): void;
  /** 待发送附件镜像 */
  setAtts(atts: Attachment[]): void;
  setChanges(list: FileChange[] | null): void;
  /** null = 尚未探测/查询失败 */
  setIsGitRepo(v: boolean | null): void;
  setChangesErr(text: string): void;
  /** 短暂提示(自动消退渠道,不占用连接状态行) */
  notify(text: string, options?: Partial<Pick<SessionNotice, "tone" | "targetSessionId">>): void;
  /** 会话列表需要刷新(打开会话、本轮结束、切模型) */
  onSessionsChanged(): void;
  /** 还能不能往前翻(尾部窗口之前是否还有历史) */
  setCanLoadEarlier(v: boolean): void;
  setLoadingEarlier(v: boolean): void;
  /** 提问大纲(全量,含尚未加载进对话流的更早提问) */
  setOutline(items: OutlineItem[]): void;
  /** 「上次会话」记忆写入/清除(localStorage 留在 hook 侧,核心不碰浏览器全局) */
  rememberSession(id: string): void;
  forgetSession(): void;
}

export type SessionCore = ReturnType<typeof createSessionCore>;

/** 连接生命周期 + 帧归约 + composer 状态机。connect 可注入(测试换假壳 IPC
 * 驱动的真实现,「监听先于命令」等连接契约照样过真代码)。 */
export function createSessionCore(io: SessionCoreIO, openConn: typeof connect = connect) {
  let conn: Conn | null = null;
  let sid: string | null = null;
  // ChatState 是唯一真值:核心内持有,io.setChat 只是视图镜像
  let chat: ChatState = initialChat;
  let queued: string | null = null;
  let atts: Attachment[] = [];
  // 连接态的核心镜像:false→true 的转变才是「连上」时机(含断线重连),
  // 原 useEffect([connected]) 的依赖语义在此显式化
  let connected = false;
  let pendingMsg: string | null = null; // 新建会话时输入的首个任务,连上后发出
  // 新建会话时暂存的附件:连上后上传,附件行并入 pendingMsg(只上传一次,
  // 带会话 id 避免闭包对不上)
  let pendingFiles: { sid: string; files: File[] } | null = null;
  // 上行在途/等首帧回执:user-input 发出后到回显帧到达之间,running 还是
  // false(task-started 帧要 ~30ms 批量推回),这段真空里再发必须入队,
  // 否则第二条直发会被壳的忙碌守卫拒掉(与 useCloudTask 的 sending 同款)
  let sending = false;
  // 历史翻页游标:cursor 是当前已加载最早那一轮在 replay.jsonl 的字节偏移
  let cursor = 0;
  let hasMore = false;
  let loadingEarlier = false;

  const setChat = (next: ChatState) => {
    chat = next;
    io.setChat(next);
  };
  const setQueued = (v: string | null) => {
    queued = v;
    io.setQueued(v);
  };
  const setAtts = (v: Attachment[]) => {
    atts = v;
    io.setAtts(v);
  };

  async function refreshChanges(): Promise<FileChange[]> {
    const c = conn;
    if (!c) return [];
    try {
      const r = await c.call<{ result?: FileChange[]; is_git_repo?: boolean; error?: string }>("repo_file_changes");
      if (conn !== c) return [];
      if (r.error) {
        io.setChangesErr(r.error);
        io.setChanges([]);
        io.setIsGitRepo(null);
        return [];
      }
      io.setChangesErr("");
      // 缺字段时兼容旧壳：只在明确返回 false 时隐藏改动页。
      io.setIsGitRepo(r.is_git_repo ?? true);
      const list = r.result ?? [];
      io.setChanges(list);
      return list;
    } catch (e) {
      if (conn !== c) return [];
      io.setChangesErr(e instanceof Error ? e.message : String(e));
      io.setChanges([]);
      io.setIsGitRepo(null);
      return [];
    }
  }

  // 排队的输入:运行结束后自动发送。乐观出队、失败回队(内容不丢),
  // 下一个时机(新帧到达/断线重连/用户再发送)重投。此前用「running/queued
  // 依赖快照」当闸门,快照在发送成功前就被消费——一旦投递失败(引擎未就绪
  // 等),之后每批帧都在闸门处提前返回,消息卡死在队列里直到被切会话清掉
  function flushQueued() {
    const c = conn;
    if (chat.running || sending || !queued || !c) return;
    const q = queued;
    sending = true;
    setQueued(null);
    void c.send("user-input", { content: b64encode(q) }).then((ok) => {
      if (ok) return; // 回执 = 回显帧到达,onFrames 解除 sending
      sending = false;
      // 失败回队;在途期间用户又排了新的,按单槽语义保留最新那条
      setQueued(queued ?? q);
    });
  }

  // 连接就绪:拉改动计数;若新建会话时带了首个任务/附件,此刻发出。
  // 附件先上传拿到工作区路径,附件行按 send() 同款约定并入正文;上传结果
  // (含失败后的残句)回写 pendingMsg,send 失败时下次 connected 重试
  // 只重发文本,不重复上传。
  function onConnected() {
    void refreshChanges();
    flushQueued(); // 断线/发送失败会打回未连接,重连即是排队消息的补投时机
    if (!pendingMsg && !pendingFiles) return;
    void (async () => {
      let text = pendingMsg ?? "";
      const pf = pendingFiles;
      if (pf) {
        pendingFiles = null;
        const lines: string[] = [];
        for (const f of pf.files) {
          try {
            const a = await uploadAtt(pf.sid, f);
            lines.push(attLine(a));
          } catch (e) {
            io.notify("⚠ 附件上传失败: " + (e instanceof Error ? e.message : String(e)));
          }
        }
        text = [text, ...lines].filter(Boolean).join("\n");
        pendingMsg = text || null;
      }
      if (!text) return;
      const ok = await conn?.send("user-input", { content: b64encode(text) });
      if (ok) pendingMsg = null;
    })();
  }

  /** 大纲随历史推进变化:打开时拉一次,每轮结束再拉一次(几十 KB 的顺序读) */
  async function refreshOutline() {
    const id = sid;
    if (!id) return;
    try {
      const raw = await sessionOutline(id);
      if (sid !== id) return;
      io.setOutline(
        raw.map((e) => {
          let text = "";
          try {
            text = b64decode(e.content);
          } catch {
            /* 坏载荷按空条目处理,不吞掉整份大纲 */
          }
          return { seq: e.seq, offset: e.offset, text, timestamp: e.timestamp };
        }),
      );
    } catch {
      /* 大纲拿不到不影响会话本身 */
    }
  }

  function applyHistory(page: HistoryPage) {
    // 已有内容时按前插处理:实时帧理论上可能先于命令返回值到达(两条都是
    // 异步 IPC),窗口与实时流在壳侧按 opened 切分、互不重叠,前插总是正确的
    setChat(chat.items.length === 0 ? reduceBatch(chat, page.frames) : prependBatch(chat, page.frames));
    cursor = page.cursor;
    hasMore = page.hasMore;
    io.setCanLoadEarlier(hasMore && cursor > 0);
    void refreshOutline();
  }

  /** 往前翻一页;beforeApply 在写入 state 前同步回调,供视图记录滚动锚点 */
  async function loadEarlier(beforeApply?: () => void): Promise<void> {
    const id = sid;
    if (!id || !hasMore || cursor <= 0 || loadingEarlier) return;
    loadingEarlier = true;
    io.setLoadingEarlier(true);
    try {
      const r = await sessionHistory(id, cursor, 1);
      if (sid !== id) return;
      beforeApply?.();
      setChat(prependBatch(chat, r.frames ?? []));
      cursor = r.next_cursor ?? 0;
      hasMore = !!r.has_more;
      io.setCanLoadEarlier(hasMore && cursor > 0);
    } catch (e) {
      io.notify("⚠ 加载更早的对话失败: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      loadingEarlier = false;
      io.setLoadingEarlier(false);
    }
  }

  /** 确保 offset 所在的那一轮已加载(大纲跳到窗口之前的提问)。
   * 上限兜底,防坏 cursor 把这里变成死循环。 */
  async function ensureLoaded(offset: number): Promise<void> {
    for (let i = 0; i < 200 && hasMore && cursor > offset; i++) {
      const before = cursor;
      await loadEarlier();
      if (cursor === before) return; // 没前进(失败/到头),别空转
    }
  }

  function handlers() {
    return {
      onHistory: applyHistory,
      onFrames: (batch: Frame[]) => {
        sending = false; // 帧到达 = 上一条上行已被壳接收
        setChat(reduceBatch(chat, batch));
        // 本轮结束:刷新改动计数与会话列表
        if (chat.turnEnded) {
          setChat({ ...chat, turnEnded: false });
          void refreshChanges();
          // 轮末壳侧刚把这一轮物化,大纲多出一条提问
          void refreshOutline();
          io.onSessionsChanged();
        }
        flushQueued();
      },
      onStatus: (text: string, ok: boolean) => {
        io.setStatus(text);
        io.setConnected(ok);
        const was = connected;
        connected = ok;
        if (!ok) sending = false; // 连接已断,回执不会再来
        if (ok && !was) onConnected();
      },
    };
  }

  return {
    /** 打开会话并接上 WS(见 SessionHandle.open) */
    open(id: string, o: { model?: string; mode?: string; think?: string; firstMessage?: string; firstFiles?: File[] } = {}) {
      // 复位会丢掉还压着的排队消息:外显提醒,不静默丢(与云端 handleEnded 同款)
      if (queued) io.notify(`已离开会话,未发送的排队消息:「${queued.slice(0, 60)}」`);
      conn?.close();
      sid = id;
      io.setId(id);
      // model/permMode 以 ChatState 为唯一真值:meta 值作为初值注入,后续
      // model_update / permission_mode_update 帧经 reduce 覆盖(回放/多客户端
      // 同步)。此前 hook 里另存镜像 state 靠 effect 缝合,存在不一致窗口。
      setChat({ ...initialChat, model: o.model ?? "", think: o.think ?? "", permMode: o.mode ?? "" });
      setQueued(null);
      setAtts([]);
      io.setChanges(null);
      io.setIsGitRepo(null);
      io.setChangesErr("");
      pendingMsg = o.firstMessage ?? null;
      pendingFiles = o.firstFiles?.length ? { sid: id, files: o.firstFiles } : null;
      sending = false;
      cursor = 0;
      hasMore = false;
      loadingEarlier = false;
      io.setCanLoadEarlier(false);
      io.setLoadingEarlier(false);
      io.setOutline([]);
      io.rememberSession(id);
      conn = openConn(id, handlers());
      io.onSessionsChanged();
    },

    /** 断开并复位;forget 时一并清掉"上次会话"记忆(删除流程) */
    close(forget = false) {
      conn?.close();
      conn = null;
      pendingMsg = null;
      pendingFiles = null;
      sid = null;
      io.setId(null);
      setChat(initialChat);
      io.setStatus("未连接");
      connected = false;
      io.setConnected(false);
      setQueued(null);
      setAtts([]);
      io.setChanges(null);
      io.setIsGitRepo(null);
      io.setChangesErr("");
      sending = false;
      cursor = 0;
      hasMore = false;
      loadingEarlier = false;
      io.setCanLoadEarlier(false);
      io.setLoadingEarlier(false);
      io.setOutline([]);
      if (forget) io.forgetSession();
    },

    /** 发送输入+附件(见 SessionHandle.send;input 由视图持有,故显式传入) */
    send(input: string): boolean {
      const lines = atts.map(attLine);
      const text = [input.trim(), ...lines].filter(Boolean).join("\n");
      if (!text || !conn) return false;
      if (chat.running || sending || queued) {
        // 运行中/上一条未回执/已有积压:单槽排队,后发覆盖先发(chip 可见,
        // 最新一条为准),本轮结束自动发送(可取消)
        setQueued(text);
        io.setInput("");
        setAtts([]);
        flushQueued(); // 空闲且只是有积压(投递失败残留)时,立即投递
        return true;
      }
      sending = true;
      void conn.send("user-input", { content: b64encode(text) }).then((ok) => {
        // 失败时保留输入与附件(原因已经 onStatus 外显),用户可重试
        if (ok) {
          io.setInput("");
          setAtts([]);
        } else {
          sending = false;
        }
      });
      return true;
    },

    stop() {
      void conn?.send("user-cancel", {});
    },

    clearQueued() {
      setQueued(null);
    },

    async addFiles(files: File[]) {
      if (!sid) return;
      for (const f of files) {
        try {
          const a = await uploadAtt(sid, f);
          setAtts([...atts, a]);
        } catch (e) {
          io.notify("⚠ 附件上传失败: " + (e instanceof Error ? e.message : String(e)));
        }
      }
    },

    removeAtt(i: number) {
      setAtts(atts.filter((_, j) => j !== i));
    },

    answerPerm(pid: string, action: PermAction) {
      const approved = action !== "deny";
      void conn
        ?.send("permission-resp", {
          id: pid,
          approved,
          remember: action === "always" || action === "persist",
          persist: action === "persist",
        })
        .then((ok) => {
          if (ok) setChat(applyPermAnswer(chat, pid, approved));
        });
    },

    // AI 提问卡答复:request_id 即 askId;发送成功即乐观回写(与云端一致)
    answerAsk(askId: string, answers: Record<string, string | string[]>) {
      void conn
        ?.send("reply-question", {
          request_id: askId,
          answers_json: JSON.stringify(answers),
          cancelled: false,
        })
        .then((ok) => {
          if (ok) setChat(applyAskAnswer(chat, askId, answers));
        });
    },

    async switchModel(name: string) {
      if (!conn || !name || name === chat.model) return;
      try {
        const r = await conn.call<{ result?: { model: string }; error?: string }>(
          "session_set_model",
          { model: name },
        );
        if (r.error) {
          io.notify("⚠ 切换模型失败: " + r.error);
          return;
        }
        // 成功即回写 chat(唯一真值),不等 model_update 帧——帧到达时幂等
        // 覆盖并渲染系统行;不做失败前的乐观更新是因为切换可即时校验
        setChat({ ...chat, model: name });
        io.onSessionsChanged();
      } catch (e) {
        io.notify("⚠ 切换模型失败: " + (e instanceof Error ? e.message : e));
      }
    },

    // 会话级思考档位(""=跟随模型默认):壳切到模型的 #think 变体别名,
    // 回写语义与 switchModel 同款(成功即回写,think_update 帧幂等覆盖)
    async setThink(level: string) {
      if (!conn || level === chat.think) return;
      try {
        const r = await conn.call<{ result?: { think: string }; error?: string }>(
          "session_set_think",
          { think: level },
        );
        if (r.error) {
          io.notify("⚠ 调整思考深度失败: " + r.error);
          return;
        }
        setChat({ ...chat, think: level });
        io.onSessionsChanged();
      } catch (e) {
        io.notify("⚠ 调整思考深度失败: " + (e instanceof Error ? e.message : e));
      }
    },

    async toggleYolo() {
      if (!conn) return;
      const prevMode = chat.permMode;
      const next = prevMode === "yolo" ? "default" : "yolo";
      // 乐观回写 chat(唯一真值),失败按原值回滚;permission_mode_update
      // 帧到达后幂等覆盖并渲染系统行
      setChat({ ...chat, permMode: next });
      try {
        const r = await conn.call<{ result?: { mode: string }; error?: string }>(
          "session_set_mode",
          { mode: next },
        );
        if (r.error) {
          setChat({ ...chat, permMode: prevMode });
          io.notify("⚠ 切换权限模式失败: " + r.error);
        }
      } catch (e) {
        setChat({ ...chat, permMode: prevMode });
        io.notify("⚠ 切换权限模式失败: " + (e instanceof Error ? e.message : e));
      }
    },

    refreshChanges,
    loadEarlier,
    ensureLoaded,

    /** 回读被截断的工具大字段原文(见 fold.rs 的大字段护栏) */
    loadFrame(seq: number) {
      if (!sid) return Promise.reject(new Error("未打开会话"));
      return sessionFrame(sid, seq);
    },

    fileDiff(path: string) {
      const c = conn;
      if (!c) return Promise.reject(new Error("未连接"));
      return c.call<{ result?: { diff?: string }; error?: string }>("repo_file_diff", { path });
    },

    listFiles(dir: string) {
      const c = conn;
      if (!c) return Promise.reject(new Error("未连接"));
      return c.call<{ result?: FileEntry[]; error?: string }>("repo_file_list", { path: dir });
    },

    readFile(path: string) {
      const c = conn;
      if (!c) return Promise.reject(new Error("未连接"));
      return c.call<{ result?: { content?: string }; error?: string }>("repo_read_file", { path });
    },

    reveal(path: string) {
      const c = conn;
      if (!c) return Promise.reject(new Error("未连接"));
      return c.call<{ result?: { ok?: boolean }; error?: string }>("repo_reveal", { path });
    },

    /** 卸载即断开(hook 的 unmount cleanup) */
    dispose() {
      conn?.close();
    },
  };
}

// ==================== React hook ====================

export interface SessionHandle {
  /** 当前会话 ID(null = 未打开) */
  id: string | null;
  chat: ChatState;
  /** 连接状态文案(侧栏状态行,只反映连接) */
  status: string;
  /** 会话区短暂提示(自动消退;与连接状态分渠道——
   * 此前混用状态行,一条"切换失败"一闪即被 conn-status 覆盖,
   * 表现为"点了没反应") */
  notice: SessionNotice | null;
  dismissNotice(): void;
  connected: boolean;
  /** 会话当前模型(空 = 未知,调用方回退默认模型展示) */
  model: string;
  yolo: boolean;
  input: string;
  queued: string | null;
  atts: Attachment[];
  changes: FileChange[] | null;
  /** null = 尚未探测；false 时文件抽屉不展示“改动”页。 */
  isGitRepo: boolean | null;
  changesErr: string;
  /** 尾部窗口之前还有历史(可「加载更早」) */
  canLoadEarlier: boolean;
  loadingEarlier: boolean;
  /** 往前翻一页;beforeApply 在写入 state 前同步回调,供视图记录滚动锚点 */
  loadEarlier(beforeApply?: () => void): Promise<void>;
  /** 确保某轮(replay.jsonl 字节偏移)已加载进对话流——大纲跳到更早提问用 */
  ensureLoaded(offset: number): Promise<void>;
  /** 提问大纲(全量,含尚未加载进对话流的更早提问) */
  outline: OutlineItem[];
  /** 回读被截断的工具大字段原文(工具卡展开时按需取) */
  loadFrame(seq: number): Promise<Frame>;
  /** 已上传附件/工作区图片的回读 URL(无会话时 undefined) */
  uploadUrl?: (path: string) => Promise<string>;

  /** 打开会话并接上 WS;firstMessage 在连接就绪后自动发出(新建会话的
   * 首个任务);firstFiles 此刻上传落盘,按 send() 同款「[图片] 路径」
   * 约定拼进首条消息(新建任务页的附件——那时会话还不存在,传不了) */
  open(id: string, opts?: { model?: string; mode?: string; think?: string; firstMessage?: string; firstFiles?: File[] }): void;
  /** 断开并复位;forget 时一并清掉"上次会话"记忆(删除流程) */
  close(forget?: boolean): void;
  setInput(v: string): void;
  /** 发送输入+附件;运行中自动排队,本轮结束发出。
   * 返回本次输入是否已接受(已发送或已排队),视图据此决定是否跟随最新消息。 */
  send(): boolean;
  stop(): void;
  clearQueued(): void;
  addFiles(files: File[]): Promise<void>;
  removeAtt(i: number): void;
  answerPerm(id: string, action: PermAction): void;
  /** 答复 AI 提问卡(reply-question 上行;发送成功后乐观回写 UI) */
  answerAsk(askId: string, answers: Record<string, string | string[]>): void;
  switchModel(name: string): Promise<void>;
  /** 会话级思考档位(""=跟随模型默认;引擎切到 #think 变体别名) */
  setThink(level: string): Promise<void>;
  toggleYolo(): Promise<void>;
  refreshChanges(): Promise<FileChange[]>;
  /** repo_file_diff 同步查询(文件抽屉:改动文件的 diff) */
  fileDiff(path: string): Promise<{ result?: { diff?: string }; error?: string }>;
  /** repo_file_list 同步查询(文件抽屉:列目录,单层) */
  listFiles(dir: string): Promise<{ result?: FileEntry[]; error?: string }>;
  /** repo_read_file 同步查询(文件抽屉:读文件内容,内核限 1MB) */
  readFile(path: string): Promise<{ result?: { content?: string }; error?: string }>;
  /** repo_reveal:在系统文件管理器中定位(内核本机执行,浏览器模式同样可用) */
  reveal(path: string): Promise<{ result?: { ok?: boolean }; error?: string }>;
  /** 外显一条提示；默认错误色，targetSessionId 存在时由视图提供跳转。 */
  notify(text: string, options?: Partial<Pick<SessionNotice, "tone" | "targetSessionId">>): void;
}

export function useSession(opts: { onSessionsChanged?: () => void } = {}): SessionHandle {
  const [id, setId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatState>(initialChat);
  const [status, setStatus] = useState("未连接");
  // 连接态取 onStatus 回调的权威布尔,不从 status 文案推导
  const [connected, setConnected] = useState(false);
  // 短暂提示独立渠道(自动消退),不占用连接状态行
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const pushNotice = useCallback((
    text: string,
    options: Partial<Pick<SessionNotice, "tone" | "targetSessionId">> = {},
  ) => {
    setNotice({ text, tone: options.tone ?? "error", targetSessionId: options.targetSessionId });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 8000);
  }, []);
  const dismissNotice = () => {
    window.clearTimeout(noticeTimer.current);
    setNotice(null);
  };
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const [input, setInput] = useState("");
  const [queued, setQueued] = useState<string | null>(null);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null);
  const [changesErr, setChangesErr] = useState("");
  const [canLoadEarlier, setCanLoadEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);

  // 回调经 ref 转发,避免调用方每次渲染的新函数搅动核心持有的 IO
  const onSessionsChangedRef = useRef(opts.onSessionsChanged);
  onSessionsChangedRef.current = opts.onSessionsChanged;

  // 状态机核心:一次挂载建一次;IO 全部指向稳定 setter / ref 转接,
  // 核心回调可安全长期持有
  const coreRef = useRef<SessionCore | null>(null);
  if (!coreRef.current) {
    const io: SessionCoreIO = {
      setId,
      setChat,
      setStatus,
      setConnected,
      setInput,
      setQueued,
      setAtts,
      setChanges,
      setIsGitRepo,
      setChangesErr,
      notify: pushNotice,
      setCanLoadEarlier,
      setLoadingEarlier,
      setOutline,
      onSessionsChanged: () => onSessionsChangedRef.current?.(),
      rememberSession: (sid) => localStorage.setItem(LAST_SESSION_KEY, sid),
      forgetSession: () => localStorage.removeItem(LAST_SESSION_KEY),
    };
    coreRef.current = createSessionCore(io);
  }
  const core = coreRef.current;

  // 卸载即断开
  useEffect(() => () => core.dispose(), [core]);

  return {
    id,
    chat,
    status,
    notice,
    dismissNotice,
    connected,
    // 由 chat 派生对外(SessionHandle 形状不变):ChatState 是唯一真值
    model: chat.model,
    yolo: chat.permMode === "yolo",
    input,
    queued,
    atts,
    changes,
    isGitRepo,
    changesErr,
    canLoadEarlier,
    loadingEarlier,
    loadEarlier: core.loadEarlier,
    ensureLoaded: core.ensureLoaded,
    outline,
    loadFrame: core.loadFrame,
    uploadUrl: id ? (p: string) => uploadFileURL(id, p) : undefined,
    open: core.open,
    close: core.close,
    setInput,
    send: () => core.send(input),
    stop: core.stop,
    clearQueued: core.clearQueued,
    addFiles: core.addFiles,
    removeAtt: core.removeAtt,
    answerPerm: core.answerPerm,
    answerAsk: core.answerAsk,
    switchModel: core.switchModel,
    setThink: core.setThink,
    toggleYolo: core.toggleYolo,
    refreshChanges: core.refreshChanges,
    fileDiff: core.fileDiff,
    listFiles: core.listFiles,
    readFile: core.readFile,
    reveal: core.reveal,
    notify: pushNotice,
  };
}
