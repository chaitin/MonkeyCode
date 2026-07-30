// createSessionCore(本地会话状态机)单测:mock 壳 IPC(与 cloudapi.test.ts /
// useCloudTask.test.ts 同款基建)+ 真 connect(session.ts)驱动,覆盖
// 「连接生命周期 → 帧归约 → composer(排队/附件)→ 应答回写 → 模型/权限模式
// 切换」这条主链。核心刻意不触 React(副作用经 SessionCoreIO 注入),
// 故无需 DOM/renderHook。
//
// 假壳刻意还原两个真实约束,它们是历史坑位的根:
//   ① listen 注册跨微任务才落地(真 Tauri 是 IPC 往返);
//   ② session_open 在命令处理中同步 emit 历史帧与连接状态(不排队)。
// 于是「监听先于命令」(ARCHITECTURE 契约 3)在这里是可断言的:谁把
// invoke 提到 listen 前面,回放帧就静默丢失,对话流空 + trace 顺序翻转。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64decode, b64encode } from "./codec";
import { initialChat, type ChatState } from "./reduce";
import { pathBackedFile } from "./uploads";
import { createSessionCore, type SessionCoreIO, type UploadingAtt } from "./useSession";
import type { Attachment, FileChange, Frame, LogItem } from "./types";

// ---- 假 Tauri 壳 ----
const listeners = new Map<string, (e: { payload: unknown }) => void>();
/** 监听落地与命令下发的时序流水(「监听先于命令」据此断言) */
let trace: string[] = [];
/** 上行帧(session_send) */
let sent: { ftype: string; payload: Record<string, unknown> }[] = [];
let sendFail = false; // session_send 是否失败(壳侧发送失败窗口)
/** 门闸:置上后对应命令的应答挂起到 resolve,用于确定性复现「回执落在切会话之后」 */
let sendGate: Promise<void> | null = null;
let uploadGate: Promise<void> | null = null;
/** session_open 返回的尾部窗口 */
let replay: Frame[] = [];
let replayCursor = 0;
let replayHasMore = false;
/** session_history 的应答队列(按调用顺序出队)与调用记录 */
let historyPages: { frames: Frame[]; next_cursor?: number; has_more?: boolean }[] = [];
let historyCalls: { cursor: number; limit: number }[] = [];
/** session_outline 的应答 */
let outlineScript: { seq: number; offset: number; content: string; timestamp?: number }[] = [];
/** session_call 应答脚本:kind → 结果(未登记则 reject) */
let callScript: Record<string, unknown> = {};
let uploaded: string[] = []; // 分块上传收尾(upload_finish)的文件名(按序)
let uploadNames = new Map<number, string>(); // 在途句柄 → 文件名
let nextUploadHandle = 1;
let pathUploads: string[] = []; // 路径直拷(upload_file_path)收到的源路径
/** 按文件名拒收上传(逐文件容错要可确定地只失败其中一个) */
let uploadDeny = new Set<string>();
let closed: string[] = []; // session_close 的会话 id

function emit(name: string, payload: unknown) {
  listeners.get(name)?.({ payload });
}
/** 壳侧推一批帧(frames:{sid} 事件) */
function pushFrames(sid: string, frames: Frame[]) {
  emit(`frames:${sid}`, frames);
}
/** 壳侧推连接状态(conn-status:{sid} 事件) */
function pushStatus(sid: string, text: string, connected: boolean) {
  emit(`conn-status:${sid}`, { text, connected });
}

const frame = (type: string, data?: unknown, kind?: string): Frame => ({
  type,
  ...(kind ? { kind } : {}),
  ...(data !== undefined ? { data } : {}),
});
const agentChunk = (text: string): Frame =>
  frame("task-running", { update: { sessionUpdate: "agent_message_chunk", content: { text } } }, "acp_event");

beforeEach(() => {
  listeners.clear();
  trace = [];
  sent = [];
  sendFail = false;
  sendGate = null;
  uploadGate = null;
  replay = [];
  replayCursor = 0;
  replayHasMore = false;
  historyPages = [];
  historyCalls = [];
  outlineScript = [];
  callScript = {};
  uploaded = [];
  uploadNames = new Map();
  nextUploadHandle = 1;
  pathUploads = [];
  uploadDeny = new Set();
  closed = [];
  (globalThis as Record<string, unknown>).window = {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          trace.push("invoke:" + cmd);
          if (cmd === "session_open") {
            const sid = args!.id as string;
            // 历史走返回值(尾部窗口);连接状态仍是命令内同步 emit 的事件
            // (Tauri 事件不排队:监听没注册就永久丢失)
            pushStatus(sid, "已连接", true);
            return Promise.resolve({ frames: replay, cursor: replayCursor, has_more: replayHasMore });
          }
          if (cmd === "session_history") {
            historyCalls.push({ cursor: args!.cursor as number, limit: args!.limit as number });
            const page = historyPages.shift();
            return Promise.resolve(page ?? { frames: [], next_cursor: 0, has_more: false });
          }
          if (cmd === "session_outline") {
            return Promise.resolve(outlineScript);
          }
          if (cmd === "session_send") {
            const finish = () => {
              if (sendFail) return Promise.reject(new Error("引擎未就绪"));
              sent.push({ ftype: args!.ftype as string, payload: args!.payload as Record<string, unknown> });
              return Promise.resolve(null);
            };
            return sendGate ? sendGate.then(finish) : finish();
          }
          if (cmd === "session_call") {
            const kind = args!.kind as string;
            if (!(kind in callScript)) return Promise.reject(new Error("unexpected call " + kind));
            return Promise.resolve(callScript[kind]);
          }
          if (cmd === "session_close") {
            closed.push(args!.id as string);
            return Promise.resolve(null);
          }
          // 分块上传协议:begin 发名字领句柄(门闸/拒收都在这一步,与旧
          // upload_file 单命令语义对齐),chunk 直收,finish 记录已上传并回路径
          if (cmd === "upload_begin") {
            const name = args!.name as string;
            const finish = () => {
              if (uploadDeny.has(name)) return Promise.reject(new Error("磁盘已满"));
              const handle = nextUploadHandle++;
              uploadNames.set(handle, name);
              return Promise.resolve({ handle });
            };
            return uploadGate ? uploadGate.then(finish) : finish();
          }
          if (cmd === "upload_chunk") return Promise.resolve(null);
          if (cmd === "upload_finish") {
            const name = uploadNames.get(args!.handle as number) ?? "";
            uploaded.push(name);
            return Promise.resolve({ path: ".monkeycode/uploads/" + name });
          }
          if (cmd === "upload_abort") return Promise.resolve(null);
          if (cmd === "upload_file_path") {
            const src = args!.src as string;
            pathUploads.push(src);
            const base = src.split(/[\\/]/).pop() || "file";
            return Promise.resolve({ path: ".monkeycode/uploads/" + base });
          }
          return Promise.reject(new Error("unexpected cmd " + cmd));
        },
      },
      event: {
        // 真 Tauri 的 listen 是异步 IPC:注册跨微任务才落地
        listen: (name: string, cb: (e: { payload: unknown }) => void) =>
          new Promise<() => void>((resolve) => {
            queueMicrotask(() => {
              listeners.set(name, cb);
              trace.push("listen-ready:" + name);
              resolve(() => listeners.delete(name));
            });
          }),
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  vi.unstubAllGlobals();
});

/** 假 FileReader:uploadAtt 的 readAsDataURL 走它拿 dataURL */
function stubFileReader() {
  vi.stubGlobal(
    "FileReader",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result = "";
      readAsDataURL(f: { name: string }) {
        this.result = `data:image/png;base64,${btoa("bytes-of-" + f.name)}`;
        queueMicrotask(() => this.onload?.());
      }
    },
  );
}
/** 假 File(node 环境无 File;uploadAtt 读 size/type/name,分块上传经 slice) */
const fakeFile = (name: string, type = "image/png", size = 10) =>
  ({
    name,
    type,
    size,
    slice: (a: number, b: number) => ({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(Math.max(0, Math.min(b, size) - a))),
    }),
  }) as unknown as File;

/** 组装核心 + 记录型 IO(所有回写落到 out,便于断言) */
function makeCore() {
  const out = {
    id: null as string | null,
    chat: initialChat as ChatState,
    status: "未连接",
    connected: false,
    input: "有内容",
    queued: null as string | null,
    atts: [] as Attachment[],
    uploads: [] as UploadingAtt[],
    /** setUploads 的全部快照(进度序列断言:在途中间态会被最终态覆盖) */
    uploadFrames: [] as UploadingAtt[][],
    changes: null as FileChange[] | null,
    isGitRepo: null as boolean | null,
    changesErr: "",
    notices: [] as string[],
    sessionsChanged: 0,
    remembered: null as string | null,
    forgotten: false,
    canLoadEarlier: false,
    loadingEarlier: [] as boolean[],
    outline: [] as { seq: number; offset: number; text: string; timestamp?: number }[],
  };
  const io: SessionCoreIO = {
    setId: (v) => (out.id = v),
    setChat: (v) => (out.chat = v),
    setStatus: (v) => (out.status = v),
    setConnected: (v) => (out.connected = v),
    setInput: (v) => (out.input = v),
    setQueued: (v) => (out.queued = v),
    setAtts: (v) => (out.atts = v),
    setUploads: (v) => {
      out.uploads = v;
      out.uploadFrames.push(v);
    },
    setChanges: (v) => (out.changes = v),
    setIsGitRepo: (v) => (out.isGitRepo = v),
    setChangesErr: (v) => (out.changesErr = v),
    notify: (text) => out.notices.push(text),
    setCanLoadEarlier: (v) => (out.canLoadEarlier = v),
    setLoadingEarlier: (v) => out.loadingEarlier.push(v),
    setOutline: (v) => (out.outline = v),
    onSessionsChanged: () => (out.sessionsChanged += 1),
    rememberSession: (sid) => (out.remembered = sid),
    forgetSession: () => (out.forgotten = true),
  };
  return { core: createSessionCore(io), out };
}

/** 上行 user-input 的明文(payload.content 是 base64) */
function userInputs(): string[] {
  return sent.filter((m) => m.ftype === "user-input").map((m) => b64decode(m.payload.content as string));
}
/** 打开会话并等连接落定(listen 注册 → session_open → 同步回放/状态) */
async function openAndSettle(core: ReturnType<typeof makeCore>["core"], sid = "s1") {
  callScript.repo_file_changes = { result: [], is_git_repo: true };
  core.open(sid);
  await vi.waitFor(() => expect(trace).toContain("invoke:session_open"));
  await Promise.resolve();
}
/** 等第 nth 次 session_open 落定(切会话的测试要按次数等,contains 不够) */
async function settleOpen(nth: number) {
  await vi.waitFor(() => expect(trace.filter((t) => t === "invoke:session_open")).toHaveLength(nth));
  await Promise.resolve();
  await Promise.resolve();
}

describe("本地会话核心:「监听先于命令」不变式(契约 3)", () => {
  it("open 先等两个监听注册落地,再发 session_open;壳的同步回放一帧不丢", async () => {
    replay = [agentChunk("历史回放的第一句")];
    const { core, out } = makeCore();
    await openAndSettle(core);

    // 时序:两个监听落地 → session_open。任何"先 invoke 再 listen"的改写
    // 都会让下面两条断言同时崩(顺序翻转 + 回放帧被丢)
    expect(trace.slice(0, 3)).toEqual([
      "listen-ready:frames:s1",
      "listen-ready:conn-status:s1",
      "invoke:session_open",
    ]);
    expect(out.chat.items).toEqual([{ kind: "agent", text: "历史回放的第一句" }]);
    expect(out.connected).toBe(true);
    expect(out.status).toBe("已连接");
  });

  it("连接中的状态在 invoke 之前就外显,不等壳应答", () => {
    const { core, out } = makeCore();
    core.open("s1");
    // connect() 同步先喊"连接中…":监听尚未落地、session_open 还没发出
    expect(out.status).toBe("连接中…");
    expect(out.connected).toBe(false);
    expect(trace).toEqual([]);
  });
});

describe("本地会话核心:连接生命周期", () => {
  it("连上即拉改动计数(旧壳缺 is_git_repo 时按仓库处理)", async () => {
    const { core, out } = makeCore();
    callScript.repo_file_changes = { result: [{ status: "M", path: "a.ts" }] };
    core.open("s1");
    await vi.waitFor(() => expect(out.changes).toHaveLength(1));
    expect(out.isGitRepo).toBe(true);
    expect(out.changesErr).toBe("");
  });

  it("改动查询报错时清空列表并外显,改动页转不可判定", async () => {
    const { core, out } = makeCore();
    callScript.repo_file_changes = { error: "not a git repo" };
    core.open("s1");
    await vi.waitFor(() => expect(out.changesErr).toBe("not a git repo"));
    expect(out.changes).toEqual([]);
    expect(out.isGitRepo).toBe(null);
  });

  it("open 记住会话、通知列表刷新;close(forget) 断开、复位并清掉记忆", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    expect(out.remembered).toBe("s1");
    expect(out.sessionsChanged).toBeGreaterThan(0);

    core.close(true);
    expect(closed).toEqual(["s1"]);
    expect(out.id).toBe(null);
    expect(out.status).toBe("未连接");
    expect(out.connected).toBe(false);
    expect(out.chat).toEqual(initialChat);
    expect(out.forgotten).toBe(true);
  });

  it("换会话先关旧连接,新会话的 model/mode 作为 chat 初值注入", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core, "s1");
    core.open("s2", { model: "gpt-x", mode: "yolo" });
    expect(closed).toEqual(["s1"]);
    expect(out.id).toBe("s2");
    expect(out.chat.model).toBe("gpt-x");
    expect(out.chat.permMode).toBe("yolo");
    expect(out.chat.items).toEqual([]);
  });

  it("首条消息在连上后自动发出;发送失败留着下次连上重发,已送达的不重发", async () => {
    const { core } = makeCore();
    sendFail = true;
    callScript.repo_file_changes = { result: [], is_git_repo: true };
    core.open("s1", { firstMessage: "帮我看下这个仓库" });
    await vi.waitFor(() => expect(trace).toContain("invoke:session_open"));
    await Promise.resolve();
    await Promise.resolve();
    expect(userInputs()).toEqual([]); // 壳侧发送失败:内容留着

    // send 失败时 Conn 已经 onStatus(…, false) 外显,连接态因此打回未连接,
    // 下一次连上就是补发时机
    sendFail = false;
    pushStatus("s1", "已连接", true);
    await vi.waitFor(() => expect(userInputs()).toEqual(["帮我看下这个仓库"]));

    // 补发只认 false→true 的转变:重复的 connected=true 既不重发也不重复拉改动
    const calls = trace.filter((t) => t === "invoke:session_call").length;
    pushStatus("s1", "已连接", true);
    await Promise.resolve();
    expect(userInputs()).toEqual(["帮我看下这个仓库"]);
    expect(trace.filter((t) => t === "invoke:session_call").length).toBe(calls);
  });

  it("首条附件在连上后上传,附件行并入首条消息;上传失败外显且不吞正文", async () => {
    stubFileReader();
    uploadDeny.add("bad.png"); // 第二个文件落盘失败:提示外显,正文与成功的附件行照常发出
    const { core, out } = makeCore();
    callScript.repo_file_changes = { result: [], is_git_repo: true };
    core.open("s1", { firstMessage: "看这张图", firstFiles: [fakeFile("shot.png"), fakeFile("bad.png")] });
    await vi.waitFor(() => expect(userInputs()).toHaveLength(1));
    expect(uploaded).toEqual(["shot.png"]);
    expect(userInputs()[0]).toBe("看这张图\n[图片] .monkeycode/uploads/shot.png");
    expect(out.notices.some((n) => n.includes("附件上传失败"))).toBe(true);
  });

  it("首条消息上传期间切会话:不发进新会话,转入原会话排队暂存,切回补投", async () => {
    stubFileReader();
    let release!: () => void;
    uploadGate = new Promise<void>((r) => (release = r));
    const { core, out } = makeCore();
    callScript.repo_file_changes = { result: [], is_git_repo: true };
    core.open("s1", { firstMessage: "首条", firstFiles: [fakeFile("slow.png")] });
    await vi.waitFor(() => expect(trace).toContain("invoke:upload_begin")); // 上传在途

    core.open("s2"); // 上传完成前切走
    await settleOpen(2);
    release();
    await vi.waitFor(() => expect(uploaded).toEqual(["slow.png"]));
    await new Promise((r) => setTimeout(r, 0));
    // 旧实现:闭包在 await 后重读 conn,首条消息会经 s2 的连接发出去
    expect(userInputs()).toEqual([]);

    // 切回 s1:成品(正文+附件行)按排队恢复,历史落地即补投
    core.open("s1");
    expect(out.queued).toBe("首条\n[图片] .monkeycode/uploads/slow.png");
    await vi.waitFor(() => expect(userInputs()).toEqual(["首条\n[图片] .monkeycode/uploads/slow.png"]));
    expect(out.queued).toBe(null);
  });
});

describe("本地会话核心:composer(排队与附件)", () => {
  it("空输入或未连接一律不接受(返回 false)", () => {
    const { core } = makeCore();
    expect(core.send("   ")).toBe(false); // 未连接 + 空内容
  });

  it("运行中发送先排队,本轮结束(task-ended)自动发出并刷新改动与列表", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    expect(core.send("先跑起来")).toBe(true);
    expect(out.queued).toBe("先跑起来");
    expect(out.input).toBe(""); // 已接受:清输入
    expect(userInputs()).toEqual([]);

    const changedBefore = out.sessionsChanged;
    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(out.queued).toBe(null)); // 送达才清队列
    expect(userInputs()).toEqual(["先跑起来"]);
    expect(out.chat.turnEnded).toBe(false); // 消费掉,不重复触发
    expect(out.sessionsChanged).toBe(changedBefore + 1);
  });

  it("排队投递失败回队,下一个时机重投", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("排着的");
    sendFail = true;
    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(out.queued).toBe("排着的")); // 没送达就回队

    sendFail = false;
    pushFrames("s1", [frame("task-started")]);
    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(out.queued).toBe(null));
    expect(userInputs()).toEqual(["排着的"]);
  });

  it("投递被壳收下但本轮随即失败(引擎没接活):不回队,不重复投递", async () => {
    // 壳的 session_send 契约:回显帧一旦物化就回 Ok(错误走 task-error 帧),
    // Err 只留给「消息未入会话」。这里钉住 UI 侧的配合面:回执 Ok 后失败轮
    // 的收尾帧到达,不得把已落对话流的消息回队/重投(否则用户看到
    // 「已发出却仍在排队」,重投再落一条重复回显)
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("引擎会拒的");
    expect(out.queued).toBe("引擎会拒的");

    pushFrames("s1", [frame("task-ended")]); // 轮末投递:壳收下,回执 Ok
    await vi.waitFor(() => expect(userInputs()).toEqual(["引擎会拒的"]));
    expect(out.queued).toBe(null);

    // 壳物化的失败轮(回显 + 收尾)整批到达:再触发 flushQueued 也无货可投
    pushFrames("s1", [
      frame("user-input", { content: b64encode("引擎会拒的") }),
      frame("task-started"),
      frame("task-error", { message: "引擎没接活" }),
      frame("task-ended"),
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(userInputs()).toEqual(["引擎会拒的"]); // 只投递过一次
    expect(out.queued).toBe(null); // 消息归对话流持有,队列不再持有
  });

  it("运行中连发多条:单槽后发覆盖先发,轮末只发最新一条", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("第一条");
    core.send("第二条");
    expect(out.queued).toBe("第二条"); // chip 可见,最新一条为准
    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(out.queued).toBe(null));
    expect(userInputs()).toEqual(["第二条"]);
  });

  it("轮末投递失败后断线重连,排队消息自动补投", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("重连后要补上");
    sendFail = true;
    // 投递失败时 Conn 已 onStatus(…, false) 打回未连接,之后不再有新帧——
    // 旧实现在这里永久卡死(快照闸门被消费,没有任何重投时机)
    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(out.queued).toBe("重连后要补上"));
    expect(userInputs()).toEqual([]);

    sendFail = false;
    pushStatus("s1", "已连接", true); // 壳侧重连:false→true 即补投时机
    await vi.waitFor(() => expect(userInputs()).toEqual(["重连后要补上"]));
    expect(out.queued).toBe(null);
  });

  it("直发后回显帧未到的窗口内再发:入队,不抢开新一轮", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    core.send("第一条"); // 空闲直发,task-started 帧还没回来
    core.send("第二条"); // 真空期:直发会被壳的忙碌守卫拒掉,必须入队
    expect(out.queued).toBe("第二条");
    await vi.waitFor(() => expect(userInputs()).toEqual(["第一条"]));

    pushFrames("s1", [frame("task-started")]); // 回执到达,本轮开跑
    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(userInputs()).toEqual(["第一条", "第二条"]));
    expect(out.queued).toBe(null);
  });

  it("失败残留的积压:下次发送覆盖为最新内容并立即投递", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("压着的");
    sendFail = true;
    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(out.queued).toBe("压着的"));

    sendFail = false;
    core.send("新输入");
    await vi.waitFor(() => expect(userInputs()).toEqual(["新输入"]));
    expect(out.queued).toBe(null);
  });

  it("切走会话排队不丢:不报警、会话间隔离,切回恢复并在原会话轮末补投", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("切走也不能丢");
    expect(out.queued).toBe("切走也不能丢");

    core.open("s2");
    await settleOpen(2);
    expect(out.notices).toEqual([]); // 不再红条报警
    expect(out.queued).toBe(null); // 隔离:s2 看不到 s1 的排队
    expect(userInputs()).toEqual([]);

    // 切回 s1:后台仍在跑,尾部窗口停在 task-started
    replay = [frame("task-started")];
    core.open("s1");
    expect(out.queued).toBe("切走也不能丢"); // 恢复是同步的,chip 立即可见
    await settleOpen(3);
    expect(userInputs()).toEqual([]); // 历史显示轮未结束:不抢投(忙碌守卫会拒)

    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(userInputs()).toEqual(["切走也不能丢"]));
    expect(out.queued).toBe(null);
  });

  it("切回已空闲的会话:排队消息在历史窗口落地后立即补投", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("等你跑完");
    core.open("s2");
    await settleOpen(2);

    // 切走期间 s1 的轮已在后台结束:重开时尾部窗口是一段完整的轮
    replay = [frame("task-started"), frame("task-ended")];
    core.open("s1");
    await vi.waitFor(() => expect(userInputs()).toEqual(["等你跑完"]));
    expect(out.queued).toBe(null);
  });

  it("删除会话(close forget)连排队暂存一起清,重开不复活", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("将随会话一起删除");
    core.close(true);
    expect(out.queued).toBe(null);

    core.open("s1");
    await settleOpen(2);
    expect(out.queued).toBe(null);
    expect(userInputs()).toEqual([]);
  });

  it("直发回执落在切会话之后:不清新会话恢复的附件,已送达的附件暂存不复活", async () => {
    stubFileReader();
    const { core, out } = makeCore();
    await openAndSettle(core); // s1
    await core.addFiles([fakeFile("mine.png")]); // s1 的待发附件
    core.open("s2"); // 切走:mine.png 入 s1 暂存
    await settleOpen(2);

    await core.addFiles([fakeFile("sent.png")]);
    core.send("s2 的消息"); // 直发在途:附件行已折进正文,atts 等回执才清
    core.open("s1"); // 回执落地前切走,s1 的 mine.png 同步恢复
    expect(out.atts.map((a) => a.name)).toEqual(["mine.png"]);
    await settleOpen(3);
    // s2 的成功回执不能把 s1 恢复出来的附件清掉(旧写法 setAtts([]) 会串会话)
    expect(out.atts.map((a) => a.name)).toEqual(["mine.png"]);
    expect(userInputs()).toEqual(["s2 的消息\n[图片] .monkeycode/uploads/sent.png"]);

    // 已送达:s2 暂存里的附件一并清掉,切回不复活(否则会重复发送)
    core.open("s2");
    expect(out.atts).toEqual([]);
  });

  it("待发附件同样按会话暂存:切走隔离,切回恢复", async () => {
    stubFileReader();
    const { core, out } = makeCore();
    await openAndSettle(core);
    await core.addFiles([fakeFile("keep.png")]);
    expect(out.atts.map((a) => a.name)).toEqual(["keep.png"]);

    core.open("s2");
    await settleOpen(2);
    expect(out.atts).toEqual([]); // 隔离:s2 没有 s1 的附件

    core.open("s1");
    expect(out.atts.map((a) => a.name)).toEqual(["keep.png"]); // 切回恢复
  });

  it("后台会话轮结束(session-status 事件):暂存的排队消息免连接补投", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("后台跑完就发");
    core.open("s2");
    await settleOpen(2);
    expect(userInputs()).toEqual([]);

    // 后台 s1 的轮结束:壳广播 session-status,App 转 deliverQueued
    core.deliverQueued("s1", "idle");
    await vi.waitFor(() => expect(userInputs()).toEqual(["后台跑完就发"]));
    // 成功提示在回执微任务里外显,同样要等
    await vi.waitFor(() => expect(out.notices.some((n) => n.includes("排队消息已发出"))).toBe(true));

    // 暂存已清:切回没有排队 chip,后续轮末也不会重复投递
    core.open("s1");
    await settleOpen(3);
    expect(out.queued).toBe(null);
    pushFrames("s1", [frame("task-ended")]);
    await new Promise((r) => setTimeout(r, 0));
    expect(userInputs()).toEqual(["后台跑完就发"]);
  });

  it("deliverQueued 甄别:running 不投、无暂存不投、当前会话让位给 flushQueued", async () => {
    const { core } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("只该发一次");
    core.open("s2");
    await settleOpen(2);

    core.deliverQueued("s1", "running"); // 轮未结束:不投
    core.deliverQueued("s3", "idle"); // 无暂存:不投
    await new Promise((r) => setTimeout(r, 0));
    expect(userInputs()).toEqual([]);

    // 切回 s1:暂存条目仍挂在 map 里(open 恢复不删条目),此时轮末的
    // session-status 事件到达——当前会话必须让位,否则与 flushQueued 双发
    replay = [frame("task-started")];
    core.open("s1");
    await settleOpen(3);
    core.deliverQueued("s1", "idle");
    await new Promise((r) => setTimeout(r, 0));
    expect(userInputs()).toEqual([]);

    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(userInputs()).toEqual(["只该发一次"]));
  });

  it("补投失败(引擎未就绪/恰好又开跑):静默回栈,切回仍可见", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("投不出去先留着");
    core.open("s2");
    await settleOpen(2);

    sendFail = true;
    core.deliverQueued("s1", "idle");
    await new Promise((r) => setTimeout(r, 0));
    expect(userInputs()).toEqual([]);
    expect(out.notices).toEqual([]); // 失败不打扰:按排队语义等下个时机

    sendFail = false;
    core.open("s1");
    expect(out.queued).toBe("投不出去先留着");
  });

  it("补投在途时用户切进该会话:失败内容回到活动队列槽,不落死暂存", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("在途切入");
    core.open("s2");
    await settleOpen(2);

    let release!: () => void;
    sendGate = new Promise<void>((r) => (release = r));
    sendFail = true;
    core.deliverQueued("s1", "idle"); // 上行挂起在途
    core.open("s1"); // 暂存已被乐观清掉:恢复不到排队
    expect(out.queued).toBe(null);
    await settleOpen(3);

    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(out.queued).toBe("在途切入"); // 失败回到活动槽,chip 重新可见
  });

  it("直发失败的回执落在切会话之后:不把新会话的状态行打成未连接", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    let release!: () => void;
    sendGate = new Promise<void>((r) => (release = r));
    sendFail = true;
    core.send("会失败的在途消息");

    core.open("s2"); // 回执前切走(open 会 close 旧连接)
    await settleOpen(2);
    expect(out.status).toBe("已连接");

    release(); // 旧连接的失败回执此刻才到:closed 闸住,不再回喊状态
    await new Promise((r) => setTimeout(r, 0));
    expect(out.status).toBe("已连接");
    expect(out.connected).toBe(true);
  });

  it("dropStash:删除未打开的会话时清其排队暂存,重开不复活", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("要被删的会话的排队");
    core.open("s2"); // s1 排队入暂存
    await settleOpen(2);

    core.dropStash("s1"); // App 删除 s1(非当前打开)时调用
    core.open("s1");
    await settleOpen(3);
    expect(out.queued).toBe(null);
    expect(userInputs()).toEqual([]);
  });

  it("取消排队后本轮结束不再投递", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [frame("task-started")]);
    core.send("反悔了");
    core.clearQueued();
    expect(out.queued).toBe(null);
    pushFrames("s1", [frame("task-ended")]);
    await Promise.resolve();
    expect(userInputs()).toEqual([]);
  });

  it("空闲时直发;发送失败保留输入与附件供重试", async () => {
    stubFileReader();
    const { core, out } = makeCore();
    await openAndSettle(core);
    await core.addFiles([fakeFile("a.png")]);
    expect(out.atts).toHaveLength(1);

    sendFail = true;
    expect(core.send("看图")).toBe(true);
    await Promise.resolve();
    expect(out.atts).toHaveLength(1); // 失败:附件不清,用户可重试
    sendFail = false;
    core.send("看图");
    await vi.waitFor(() => expect(out.atts).toEqual([])); // 送达才清附件
    expect(userInputs()).toEqual(["看图\n[图片] .monkeycode/uploads/a.png"]);
    expect(out.input).toBe("");
  });

  it("附件上传失败只外显,不进附件行;removeAtt 按下标摘除", async () => {
    stubFileReader();
    const { core, out } = makeCore();
    await openAndSettle(core);
    uploadDeny.add("no.png");
    await core.addFiles([fakeFile("ok.png"), fakeFile("no.png")]);
    expect(out.atts.map((a) => a.name)).toEqual(["ok.png"]);
    expect(out.notices.some((n) => n.includes("附件上传失败"))).toBe(true);

    await core.addFiles([fakeFile("doc.txt", "text/plain")]);
    expect(out.atts.map((a) => a.name)).toEqual(["ok.png", "doc.txt"]);
    expect(out.atts[1].isImage).toBe(false);
    core.removeAtt(0);
    expect(out.atts.map((a) => a.name)).toEqual(["doc.txt"]);
  });

  it("大附件不再设上限:分块上传成功入列,大图不整读预览", async () => {
    // 旧 20MB 上限是整包 base64 穿 IPC 的产物,分块通道下已废
    stubFileReader();
    const { core, out } = makeCore();
    await openAndSettle(core);
    await core.addFiles([fakeFile("huge.png", "image/png", 21 * 1024 * 1024)]);
    expect(uploaded).toEqual(["huge.png"]);
    expect(out.atts.map((a) => a.name)).toEqual(["huge.png"]);
    // 超过预览阈值(8MB)的图不整读 dataURL(整读会撑爆 webview 内存)
    expect(out.atts[0].preview).toBeUndefined();
    // 21MB 按 4MB 分块:6 个 chunk 帧
    expect(trace.filter((t) => t === "invoke:upload_chunk")).toHaveLength(6);
  });

  it("path-backed 附件(Linux 原生拖拽)走壳路径直拷,不经内容分块", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    await core.addFiles([pathBackedFile("/home/u/数据集.csv", "数据集.csv", "text/csv")]);
    expect(pathUploads).toEqual(["/home/u/数据集.csv"]);
    expect(trace.filter((t) => t === "invoke:upload_begin")).toHaveLength(0);
    expect(out.atts.map((a) => a.name)).toEqual(["数据集.csv"]);
  });

  it("上传中外显进度:入列→逐块推进→完成出列(大文件不再像卡死)", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    out.uploadFrames.length = 0; // 只看本次上传的镜像序列(open 复位不算)
    await core.addFiles([fakeFile("big.zip", "application/zip", 12 * 1024 * 1024)]);

    // 首帧入列(0%),末帧出列(空);中间是逐块推进的百分比
    const seq = out.uploadFrames.map((f) => f.map((u) => u.pct));
    expect(seq[0]).toEqual([0]);
    expect(seq.at(-1)).toEqual([]);
    // 12MB/4MB = 3 块:33 / 66 / 99(末块封顶 99,100% 由出列表达——
    // finish 改名还在途时显示 100 会让"卡在 100%"重新变成谜)
    expect(seq.slice(1, -1)).toEqual([[33], [66], [99]]);
    expect(out.uploads).toEqual([]); // 收尾后不残留
    expect(out.atts.map((a) => a.name)).toEqual(["big.zip"]);
  });

  it("路径直拷与上传失败:进度不确定态(-1)且都必须出列,不留卡死的条", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    out.uploadFrames.length = 0;
    await core.addFiles([pathBackedFile("/home/u/a.bin", "a.bin", "")]);
    // 直拷没有分块回调:pct=-1(spinner 不画进度线),两帧一进一出
    expect(out.uploadFrames.map((f) => f.map((u) => u.pct))).toEqual([[-1], []]);

    // 失败路径同样出列(finally),否则失败后进度条永久挂着像卡死
    out.uploadFrames.length = 0;
    uploadDeny.add("no.bin");
    await core.addFiles([fakeFile("no.bin", "", 10)]);
    expect(out.uploads).toEqual([]);
    expect(out.uploadFrames.at(-1)).toEqual([]);
    expect(out.notices.some((n) => n.includes("附件上传失败"))).toBe(true);
  });

  it("stop 上行 user-cancel", async () => {
    const { core } = makeCore();
    await openAndSettle(core);
    core.stop();
    await Promise.resolve();
    expect(sent.map((m) => m.ftype)).toContain("user-cancel");
  });
});

describe("本地会话核心:审批与提问答复", () => {
  const permFrame = frame("permission-req", { id: "p1", title: "写文件", tool: "write" });
  const permItem = (chat: ChatState) => chat.items.find((it) => it.kind === "perm") as Extract<LogItem, { kind: "perm" }>;

  it("审批送达才回写卡片终态,并按动作带上 remember/persist", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [permFrame]);
    expect(permItem(out.chat).state).toBe("open");

    core.answerPerm("p1", "persist");
    await vi.waitFor(() => expect(permItem(out.chat).state).toBe("allowed"));
    expect(sent.at(-1)).toEqual({
      ftype: "permission-resp",
      payload: { id: "p1", approved: true, remember: true, persist: true },
    });
  });

  it("拒绝走 approved:false;发送失败不回写(否则卡片显示已拒而引擎还在等)", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [permFrame]);
    sendFail = true;
    core.answerPerm("p1", "deny");
    await Promise.resolve();
    expect(permItem(out.chat).state).toBe("open");

    sendFail = false;
    core.answerPerm("p1", "deny");
    await vi.waitFor(() => expect(permItem(out.chat).state).toBe("rejected"));
    expect(sent.at(-1)!.payload.approved).toBe(false);
  });

  it("提问卡答复上行 reply-question 并按题回填答案", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    pushFrames("s1", [
      frame(
        "task-running",
        { update: { sessionUpdate: "tool_call", toolCallId: "ask-1", title: "Question", rawInput: { questions: [{ question: "选哪个?", options: [{ label: "A" }] }] } } },
        "acp_event",
      ),
    ]);
    core.answerAsk("ask-1", { "选哪个?": "A" });
    await vi.waitFor(() => {
      const ask = out.chat.items.find((it) => it.kind === "ask") as Extract<LogItem, { kind: "ask" }>;
      expect(ask.state).toBe("done");
      expect(ask.questions[0].answer).toBe("A");
    });
    expect(sent.at(-1)).toEqual({
      ftype: "reply-question",
      payload: { request_id: "ask-1", answers_json: JSON.stringify({ "选哪个?": "A" }), cancelled: false },
    });
  });
});

describe("本地会话核心:模型与权限模式切换", () => {
  it("切模型成功回写 chat 并刷新会话列表;同名或未连接直接跳过", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    callScript.session_set_model = { result: { model: "gpt-x" } };
    const before = out.sessionsChanged;
    await core.switchModel("gpt-x");
    expect(out.chat.model).toBe("gpt-x");
    expect(out.sessionsChanged).toBe(before + 1);

    // 同名不再往下打(内核 call 脚本撤掉也不该被调用)
    delete callScript.session_set_model;
    await core.switchModel("gpt-x");
    await core.switchModel("");
    expect(out.notices).toEqual([]);
  });

  it("切模型内核报错只外显,不回写模型(避免 UI 与引擎不一致)", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    callScript.session_set_model = { error: "模型不可用" };
    await core.switchModel("gone");
    expect(out.chat.model).toBe("");
    expect(out.notices[0]).toContain("切换模型失败: 模型不可用");
  });

  it("YOLO 乐观回写,失败按原值回滚", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    callScript.session_set_mode = { result: { mode: "yolo" } };
    await core.toggleYolo();
    expect(out.chat.permMode).toBe("yolo");
    // 再按一次切回 default
    callScript.session_set_mode = { result: { mode: "default" } };
    await core.toggleYolo();
    expect(out.chat.permMode).toBe("default");
    // 失败回滚到切换前的模式
    callScript.session_set_mode = { error: "任务运行中" };
    await core.toggleYolo();
    expect(out.chat.permMode).toBe("default");
    expect(out.notices[0]).toContain("切换权限模式失败: 任务运行中");
  });
});

describe("本地会话核心:文件抽屉查询", () => {
  it("未连接时四个只读查询一律 reject,不静默给空", async () => {
    const { core } = makeCore();
    await expect(core.fileDiff("a.ts")).rejects.toThrow("未连接");
    await expect(core.listFiles("")).rejects.toThrow("未连接");
    await expect(core.readFile("a.ts")).rejects.toThrow("未连接");
    await expect(core.reveal("a.ts")).rejects.toThrow("未连接");
    expect(await core.refreshChanges()).toEqual([]);
  });

  it("连接后按 repo_* 协议透传", async () => {
    const { core } = makeCore();
    await openAndSettle(core);
    callScript.repo_file_diff = { result: { diff: "@@ -1 +1 @@" } };
    callScript.repo_file_list = { result: [{ name: "src", path: "src", is_dir: true, size: 0 }] };
    callScript.repo_read_file = { result: { content: "hello" } };
    callScript.repo_reveal = { result: { ok: true } };
    expect((await core.fileDiff("a.ts")).result?.diff).toContain("@@");
    expect((await core.listFiles("")).result?.[0].name).toBe("src");
    expect((await core.readFile("a.ts")).result?.content).toBe("hello");
    expect((await core.reveal("a.ts")).result?.ok).toBe(true);
  });
});

describe("历史分页与提问大纲", () => {
  const userFrame = (text: string, seq: number): Frame =>
    ({ type: "user-input", data: { content: b64encode(text) }, seq }) as unknown as Frame;

  it("打开时的尾部窗口来自 session_open 返回值,并带出翻页能力与大纲", async () => {
    replay = [userFrame("窗口里的提问", 40), agentChunk("答")];
    replayCursor = 512;
    replayHasMore = true;
    outlineScript = [
      { seq: 7, offset: 0, content: b64encode("很早的提问"), timestamp: 1 },
      { seq: 40, offset: 512, content: b64encode("窗口里的提问"), timestamp: 2 },
    ];
    const { core, out } = makeCore();
    await openAndSettle(core);
    await vi.waitFor(() => expect(out.outline.length).toBe(2));

    expect(out.chat.items.map((i) => i.kind)).toEqual(["user", "agent"]);
    expect(out.canLoadEarlier).toBe(true);
    // 大纲是全量的:第一条尚未加载进对话流,但目录里有,且带翻页锚点
    expect(out.outline[0]).toEqual({ seq: 7, offset: 0, text: "很早的提问", timestamp: 1 });
  });

  it("加载更早把历史插到最前,keyBase 左移保住既有条目的渲染 key", async () => {
    replay = [userFrame("第二问", 40)];
    replayCursor = 512;
    replayHasMore = true;
    historyPages = [{ frames: [userFrame("第一问", 7)], next_cursor: 0, has_more: false }];
    const { core, out } = makeCore();
    await openAndSettle(core);
    const keyOfSecond = out.chat.keyBase + 0;

    await core.loadEarlier();

    expect(historyCalls).toEqual([{ cursor: 512, limit: 1 }]);
    expect(out.chat.items.map((i) => (i as { text: string }).text)).toEqual(["第一问", "第二问"]);
    // 「第二问」原来在下标 0,前插一条后到下标 1;key = keyBase + 下标 应当不变
    expect(out.chat.keyBase + 1).toBe(keyOfSecond);
    expect(out.canLoadEarlier).toBe(false);
    // open 会先复位一次,翻页本身是 true → false
    expect(out.loadingEarlier.slice(-2)).toEqual([true, false]);
  });

  it("到头之后不再发请求,失败只提示不打断会话", async () => {
    replay = [];
    replayCursor = 0;
    replayHasMore = false;
    const { core, out } = makeCore();
    await openAndSettle(core);

    await core.loadEarlier();

    expect(historyCalls).toEqual([]);
    expect(out.notices).toEqual([]);
  });

  it("跳到未加载的早期提问:按 offset 一路往前翻到覆盖它为止", async () => {
    replay = [userFrame("最新一问", 90)];
    replayCursor = 900;
    replayHasMore = true;
    historyPages = [
      { frames: [userFrame("中间一问", 50)], next_cursor: 500, has_more: true },
      { frames: [userFrame("最早一问", 7)], next_cursor: 0, has_more: false },
    ];
    const { core, out } = makeCore();
    await openAndSettle(core);

    await core.ensureLoaded(0);

    expect(historyCalls.map((c) => c.cursor)).toEqual([900, 500]);
    expect(out.chat.items.map((i) => (i as { text: string }).text)).toEqual([
      "最早一问",
      "中间一问",
      "最新一问",
    ]);
  });

  it("本轮结束会重拉大纲(壳刚把这一轮物化)", async () => {
    const { core, out } = makeCore();
    await openAndSettle(core);
    outlineScript = [{ seq: 3, offset: 0, content: b64encode("刚问完的"), timestamp: 9 }];

    pushFrames("s1", [frame("task-ended")]);
    await vi.waitFor(() => expect(out.outline.length).toBe(1));

    expect(out.outline[0].text).toBe("刚问完的");
  });
});
