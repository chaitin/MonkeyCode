// createCloudTaskCore(云端任务投递状态机)单测:mock 壳 IPC(与
// cloudapi.test.ts 同款基建)+ 真 connectCloudTask 驱动,覆盖用户实测踩过
// 的坑位:环境未就绪/休眠时消息不能丢也不能死等,失败要回队、连败要
// 暂停、唤醒/就绪后要自动投递,任务结束压着的队列必须外显。
// 核心刻意不触 React(副作用经 CloudCoreIO 注入),故无需 DOM/renderHook。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64decode } from "./codec";
import { cloudInitialSource, cloudStatusHealthy, createCloudTaskCore, type CloudCoreIO } from "./useCloudTask";
import type { CloudTaskDetail } from "./types";

// ---- 假 Tauri 壳:cloud_ws_open 按脚本决定成败;事件按 pipe 精确投递 ----
const listeners = new Map<string, (e: { payload: unknown }) => void>();
let opens: boolean[] = []; // 每次 open 的行为队列:true=成功建管道,false=拒绝(拨号失败)
let openCalls = 0;
let openPipes: string[] = []; // 成功建立的 pipe id(按序)
let sent: string[] = []; // 上行文本帧
let sendFail = false; // cloud_ws_send 是否失败(模拟管道死亡窗口)

function emit(name: string, payload: unknown) {
  listeners.get(name)?.({ payload });
}

/** 给最新管道发下行帧 */
function pushFrame(f: Record<string, unknown>) {
  emit(`ws-msg:${openPipes.at(-1)}`, JSON.stringify(f));
}
/** 关闭最新管道(info 模拟服务端 Close 帧;缺省 null = 异常断开) */
function closePipe(info: { code?: number; reason?: string } | null = null) {
  emit(`ws-closed:${openPipes.at(-1)}`, info);
}

beforeEach(() => {
  listeners.clear();
  opens = [];
  openCalls = 0;
  openPipes = [];
  sent = [];
  sendFail = false;
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).window = {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: { pipe?: string; text?: string }) => {
          if (cmd === "cloud_ws_open") {
            const okOpen = opens[openCalls] ?? true;
            openCalls += 1;
            if (!okOpen) return Promise.reject(new Error("dial failed"));
            openPipes.push(args!.pipe!);
            return Promise.resolve(null);
          }
          if (cmd === "cloud_ws_send") {
            if (sendFail) return Promise.reject(new Error("pipe dead"));
            sent.push(args!.text!);
            return Promise.resolve(null);
          }
          if (cmd === "cloud_ws_close") return Promise.resolve(null);
          return Promise.reject(new Error("unexpected cmd " + cmd));
        },
      },
      event: {
        listen: (name: string, cb: (e: { payload: unknown }) => void) => {
          listeners.set(name, cb);
          return Promise.resolve(() => listeners.delete(name));
        },
      },
    },
  };
  // rAF:立即执行(帧批量上抛用)
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: () => void) => {
    cb();
    return 0;
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).window;
});

/** 上行 user-input 帧的明文内容(双层 base64:帧 data → payload.content) */
function sentUserInputs(): string[] {
  return sent
    .map((t) => JSON.parse(t) as { type: string; data: string })
    .filter((m) => m.type === "user-input")
    .map((m) => b64decode((JSON.parse(b64decode(m.data)) as { content: string }).content));
}

/** 上行 user-input 帧携带的 attachments(按帧序) */
function sentAttachments(): unknown[] {
  return sent
    .map((t) => JSON.parse(t) as { type: string; data: string })
    .filter((m) => m.type === "user-input")
    .map((m) => (JSON.parse(b64decode(m.data)) as { attachments?: unknown }).attachments);
}

/** 组装核心 + 记录型 IO(排队/状态/错误/回写全部落到 out,便于断言) */
function makeCore(taskStatus = "processing") {
  const events: string[] = [];
  const out = { queued: "", status: "", err: "", epochBumps: 0 };
  const io: CloudCoreIO = {
    applyFrames: (frames) => events.push("frames:" + frames.map((f) => f.type).join(",")),
    rebuildChat: () => events.push("rebuild"),
    applyAskAnswer: (askId) => events.push("ask-applied:" + askId),
    setStatus: (t) => {
      out.status = t;
      events.push("status:" + t);
    },
    setConnected: () => {},
    setCursorIfEmpty: () => {},
    setQueued: (v) => {
      out.queued = v;
    },
    setErr: (t) => {
      out.err = t;
      events.push("err:" + t);
    },
    bumpAttachEpoch: () => {
      out.epochBumps += 1;
    },
    pin: () => {},
    onRoundEnded: () => events.push("roundEnded"),
  };
  const core = createCloudTaskCore("task-1", io);
  core.noteTaskStatus(taskStatus);
  return { core, out, events };
}

describe("云端任务首屏数据源", () => {
  it("运行中只走 attach，结束态才走 REST rounds", () => {
    expect(cloudInitialSource("processing")).toBe("attach");
    expect(cloudInitialSource("finished")).toBe("rounds");
    expect(cloudInitialSource("error")).toBe("rounds");
    expect(cloudInitialSource("pending")).toBe("pending");
  });
});

describe("连接状态行健康判定(composer 健康时隐藏指示)", () => {
  it("健康文案命中白名单,过渡/异常态判为需外显", () => {
    expect(cloudStatusHealthy("已连接云端")).toBe(true);
    expect(cloudStatusHealthy("已就绪,可继续对话")).toBe(true);
    expect(cloudStatusHealthy("本轮已结束,可继续对话")).toBe(true);
    expect(cloudStatusHealthy("已结束,只读回放")).toBe(true);

    expect(cloudStatusHealthy("加载中…")).toBe(false);
    expect(cloudStatusHealthy("连接云端…")).toBe(false);
    expect(cloudStatusHealthy("⚠ 云端连接断开(x),2 秒后自动重连…")).toBe(false);
    expect(cloudStatusHealthy("消息未送达,已重新排队")).toBe(false);
  });
});

describe("云端投递状态机:排队与自动投递", () => {
  it("启动中直发被拒 → 入队;attach 就绪后自动投递", async () => {
    // 环境未就绪(pending):手动发送不看本地推断,直接建 mode=new 交服务端
    // 裁决;拨号失败 → onSendFailed 回队,绝不静默丢
    opens = [false, true, true];
    const { core, out } = makeCore("pending");
    core.send("你好云端");
    await vi.advanceTimersByTimeAsync(0);
    expect(out.queued).toBe("你好云端");
    expect(out.status).toContain("已重新排队");
    expect(out.epochBumps).toBe(1); // 被拒后重建 attach 拿回观察通道

    // 环境就绪:hook 会因 epoch bump 重跑 attach effect,这里手动等价触发
    core.noteTaskStatus("processing");
    expect(core.maybeOpenAttach()).toBe(true);
    await vi.advanceTimersByTimeAsync(0); // attach 拨号落定 → onStatus(ok)
    await vi.advanceTimersByTimeAsync(450); // 连上 400ms 后自动投递排队消息
    expect(out.queued).toBe("");
    expect(sentUserInputs()).toEqual(["你好云端"]);
  });

  it("执行中入队:未回执先合并排队,轮结束(task-ended)后自动投递", async () => {
    opens = [true, true];
    const { core, out } = makeCore();
    core.send("第一条");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentUserInputs()).toEqual(["第一条"]);
    // 上一条直发还没回执(sending):再发只入队,不顶掉在途连接
    core.send("第二条");
    expect(out.queued).toBe("第二条");
    expect(openCalls).toBe(1);
    // 回显 + 开跑:回执解除,但轮在跑 → 排队继续等
    pushFrame({ type: "user-input", seq: 1, data: "e30=" });
    pushFrame({ type: "task-started", seq: 2 });
    core.trySendQueued();
    expect(out.queued).toBe("第二条"); // 可见在跑,不投递
    // 轮结束:200ms 后自动投递
    pushFrame({ type: "task-ended", seq: 3 });
    await vi.advanceTimersByTimeAsync(250);
    expect(out.queued).toBe("");
    expect(sentUserInputs()).toEqual(["第一条", "第二条"]);
  });

  it("附件随消息投递:直发带附件;未回执入队的附件轮结束后随队发出", async () => {
    opens = [true, true];
    const { core, out } = makeCore();
    const att1 = { url: "https://oss.example.com/a.webp", filename: "a.webp" };
    const att2 = { url: "https://oss.example.com/b.pdf", filename: "b.pdf" };
    core.send("第一条", [att1]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentAttachments()).toEqual([[att1]]);
    // 上一条未回执:第二条连同附件一起排队
    core.send("第二条", [att2]);
    expect(out.queued).toBe("第二条");
    // 回显解除回执等待;轮结束后排队消息(含附件)自动投递
    pushFrame({ type: "user-input", seq: 1, data: "e30=" });
    pushFrame({ type: "task-ended", seq: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(sentUserInputs()).toEqual(["第一条", "第二条"]);
    expect(sentAttachments()).toEqual([[att1], [att2]]);
  });

  it("已收到运行帧后再次发送仍入队,不会直接抢开新一轮", async () => {
    opens = [true, true];
    const { core, out } = makeCore();
    // 进入一个已经在执行的云端任务:attach 回放 task-started 后,
    // sending 已经解除,但 running 仍应阻止新消息直接发出。
    expect(core.maybeOpenAttach()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    pushFrame({ type: "task-started", seq: 1 });

    core.send("运行中补充");
    expect(out.queued).toBe("运行中补充");
    expect(openCalls).toBe(1);
    expect(sentUserInputs()).toEqual([]);

    // 当前轮结束后再自动开新一轮投递。
    pushFrame({ type: "task-ended", seq: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(out.queued).toBe("");
    expect(openCalls).toBe(2);
    expect(sentUserInputs()).toEqual(["运行中补充"]);
  });

  it("发送失败交还队列:连败 3 次暂停自动重试,手动发送重置并合并带上", async () => {
    opens = [true, true, true, true];
    const { core, out } = makeCore();
    // 三轮"上行后零回显被关"(云端拒收):每次回队并 2s 重试
    core.send("A");
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(0);
      closePipe(); // 零回显被关 → onSendFailed
      await vi.advanceTimersByTimeAsync(0);
      expect(out.queued).toBe("A");
      if (i < 2) await vi.advanceTimersByTimeAsync(2100); // 自动重试再投
    }
    expect(out.status).toContain("已暂停自动重试");
    // 暂停后不再自持重试(此前"投递→被拒→2s 再投"会死循环)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(openCalls).toBe(3);
    expect(out.queued).toBe("A");
    // 手动发送 = 用户明确要投递:失败计数重置,队列压着的一并带上
    core.send("B");
    await vi.advanceTimersByTimeAsync(0);
    expect(out.queued).toBe("");
    expect(sentUserInputs().at(-1)).toBe("A\nB");
  });

  it("回执保护:直发 15s 无任何帧 → 解除 sending,排队恢复流动", async () => {
    opens = [true, true];
    const { core, out } = makeCore();
    core.send("头一条");
    await vi.advanceTimersByTimeAsync(0);
    core.send("压队的"); // 在途未回执 → 入队
    expect(out.queued).toBe("压队的");
    await vi.advanceTimersByTimeAsync(15_100); // 回执保护解除 → trySendQueued
    expect(out.queued).toBe("");
    expect(sentUserInputs()).toEqual(["头一条", "压队的"]);
  });

  it("休眠时入队(连败暂停),唤醒完成后重置并自动投递", async () => {
    opens = [false, false, false, true];
    const { core, out } = makeCore();
    core.noteHibernated(true);
    expect(core.maybeOpenAttach()).toBe(false); // 休眠中不发起 attach(必被拒)
    // 休眠中发送:mode=new 连不上,回队;自动重试再败两次后暂停
    core.send("唤醒后见");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(2100);
    expect(out.queued).toBe("唤醒后见");
    expect(openCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(30_000); // 暂停期:不再自动拨号
    expect(openCalls).toBe(3);
    // 详情轮询看到 VM online(休眠 → 唤醒完成的转变):失败计数清零,
    // attach 重新武装,压着的排队消息 100ms 后自动投递
    const bumpsBefore = out.epochBumps;
    core.handleInfo({ id: "task-1", virtualmachine: { status: "online" } } as CloudTaskDetail);
    expect(out.epochBumps).toBe(bumpsBefore + 1);
    await vi.advanceTimersByTimeAsync(150);
    expect(out.queued).toBe("");
    expect(sentUserInputs()).toEqual(["唤醒后见"]);
  });

  it("唤醒序列 hibernated → offline → online(后端误判中间态):仍视为唤醒完成并投递", async () => {
    // 后端会把唤醒中的 VM 短暂误判为 offline:offline 帧把 hibernated 镜像
    // 清掉,若只认镜像,随后的 online 不触发唤醒完成 → 队列永久卡死
    opens = [false, false, false, true];
    const { core, out } = makeCore();
    core.handleInfo({ id: "task-1", virtualmachine: { status: "hibernated" } } as CloudTaskDetail);
    core.noteHibernated(true);
    core.send("穿过误判");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(2100);
    expect(out.queued).toBe("穿过误判"); // 连败暂停,压在队里
    // 误判中间态:详情帧闪过 offline,hook 每帧镜像随之清掉 hibernated
    //(发送失败路径自身会 bump epoch,故用相对计数)
    const bumpsBefore = out.epochBumps;
    core.handleInfo({ id: "task-1", virtualmachine: { status: "offline" } } as CloudTaskDetail);
    core.noteHibernated(false);
    expect(out.epochBumps).toBe(bumpsBefore);
    // 真正唤醒完成:按"上次非 online → 本次 online"转变触发
    core.handleInfo({ id: "task-1", virtualmachine: { status: "online" } } as CloudTaskDetail);
    expect(out.epochBumps).toBe(bumpsBefore + 1);
    await vi.advanceTimersByTimeAsync(150);
    expect(out.queued).toBe("");
    expect(sentUserInputs()).toEqual(["穿过误判"]);
  });

  it("首帧即 online 与 online → online:不触发 attach 重建(不随轮询抖)", () => {
    const { core, out } = makeCore();
    // 健康任务首帧就是 online:误 bump 会让 attach 拆建、整轮重放
    core.handleInfo({ id: "task-1", virtualmachine: { status: "online" } } as CloudTaskDetail);
    core.handleInfo({ id: "task-1", virtualmachine: { status: "online" } } as CloudTaskDetail);
    expect(out.epochBumps).toBe(0);
  });

  it("任务结束还压着队列 → 外显提醒并清空,不静默丢", async () => {
    opens = [true];
    const { core, out } = makeCore();
    core.send("在途");
    await vi.advanceTimersByTimeAsync(0);
    core.send("没发出去的"); // 未回执 → 入队
    expect(out.queued).toBe("没发出去的");
    core.noteTaskStatus("finished");
    core.handleEnded();
    expect(out.err).toContain("「没发出去的」");
    expect(out.queued).toBe("");
    // 结束态下 trySend 永不投递(即便有人再塞队列)
    core.trySendQueued();
    expect(sentUserInputs()).toEqual(["在途"]);
  });

  it("新建/环境创建中:收到 user-input 回显后第二条仍入队,不抢开新一轮", async () => {
    // 用户实测:新建任务(环境还在创建)时连发两条,第二条直接发出去了。
    // 云端收下第一条会先回显 user-input,回显解除了 sending,而 task-started
    // 要等 VM 起来(以分钟计)才来——这段真空里两道闸全开。回显即视为在跑。
    opens = [true, true];
    const { core, out } = makeCore("pending");
    core.send("第一条");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentUserInputs()).toEqual(["第一条"]);
    pushFrame({ type: "user-input", seq: 1, data: "e30=" }); // 云端回显:已收下
    core.send("第二条");
    await vi.advanceTimersByTimeAsync(0);
    expect(out.queued).toBe("第二条");
    expect(openCalls).toBe(1); // 没顶掉在途连接
    expect(sentUserInputs()).toEqual(["第一条"]);
    // 环境就绪开跑 → 本轮结束后才投递排队的那条
    pushFrame({ type: "task-started", seq: 2 });
    pushFrame({ type: "task-ended", seq: 3 });
    await vi.advanceTimersByTimeAsync(250);
    expect(out.queued).toBe("");
    expect(sentUserInputs()).toEqual(["第一条", "第二条"]);
  });

  it("回显后被拒(task-error 且无 task-ended):放行排队投递,不永久卡死", async () => {
    opens = [true, true];
    const { core, out } = makeCore("pending");
    core.send("第一条");
    await vi.advanceTimersByTimeAsync(0);
    pushFrame({ type: "user-input", seq: 1, data: "e30=" });
    core.send("第二条");
    expect(out.queued).toBe("第二条");
    // 云端拒了这一轮:不会再补 task-ended,清 running 才不会让队列死等
    pushFrame({ type: "task-error", seq: 2, data: "e30=" });
    core.trySendQueued();
    await vi.advanceTimersByTimeAsync(0);
    expect(out.queued).toBe("");
    expect(sentUserInputs()).toEqual(["第一条", "第二条"]);
  });

  it("取消排队:clearQueued 清空,后续就绪时机不再投递", async () => {
    opens = [true];
    const { core, out } = makeCore();
    core.send("在途");
    await vi.advanceTimersByTimeAsync(0);
    core.send("反悔了");
    expect(out.queued).toBe("反悔了");
    core.clearQueued();
    expect(out.queued).toBe("");
    pushFrame({ type: "task-started", seq: 1 });
    pushFrame({ type: "task-ended", seq: 2 });
    await vi.advanceTimersByTimeAsync(300); // 轮结束的投递时机:队列已空,无动作
    expect(sentUserInputs()).toEqual(["在途"]);
  });
});

describe("云端投递状态机:ask 答复回写", () => {
  it("回答发送成功才回写 UI;壳侧发送失败则外显且不回写", async () => {
    opens = [true];
    const { core, out, events } = makeCore();
    expect(core.maybeOpenAttach()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    // 成功:reply-question 上行 + 回写
    core.answerAsk("ask-1", { q: "yes" });
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContain("ask-applied:ask-1");
    const reply = sent.map((t) => JSON.parse(t) as { type: string }).find((m) => m.type === "reply-question");
    expect(reply).toBeTruthy();
    // 失败(管道死亡窗口):不回写,外显错误——此前拿同步假 true 乐观回写,
    // 云端没收到也显示"已回答"
    sendFail = true;
    core.answerAsk("ask-2", { q: "no" });
    await vi.advanceTimersByTimeAsync(0);
    expect(events).not.toContain("ask-applied:ask-2");
    expect(out.err).toContain("回答未发送");
  });

  it("连接不在(收束/断开)时直接外显,不吞不抛", () => {
    const { core, out } = makeCore();
    core.answerAsk("ask-1", { q: "yes" });
    expect(out.err).toContain("回答未发送");
  });
});
