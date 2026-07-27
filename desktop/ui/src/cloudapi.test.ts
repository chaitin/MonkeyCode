// connectCloudTask / connectCloudControl(cloudapi.ts)单测:mock 壳 IPC
// 原语层(ipc.ts 的 invoke/listen,经假 __TAURI__ 全局)驱动管道生命周期。覆盖用户实测炸过的场景:云端对"当前轮已结束"的 attach
// 直接关连接,客户端不能当断线无限重连(「云端连接断开,2 秒后自动重连…」
// 死循环);控制流同理不能 1.5s 无限拨号刷屏。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64decode, b64encode } from "./codec";

// ---- 假 Tauri 壳:cloud_ws_open 按脚本决定成败;事件按 pipe 精确投递 ----
interface PipeScript {
  /** 每次 open 的行为队列:true=成功建管道,false=拒绝(拨号失败) */
  opens: boolean[];
}
const listeners = new Map<string, (e: { payload: unknown }) => void>();
let script: PipeScript = { opens: [] };
let openCalls = 0;
let openPipes: string[] = []; // 成功建立的 pipe id(按序)
let sent: string[] = []; // 上行文本帧
let sendFail = false; // cloud_ws_send 是否失败(模拟管道死亡窗口)

function emit(name: string, payload: unknown) {
  listeners.get(name)?.({ payload });
}

/** 给第 n 条(默认最新)管道发下行帧 */
function pushFrame(f: Record<string, unknown>, pipeIdx = -1) {
  const pipe = openPipes.at(pipeIdx);
  emit(`ws-msg:${pipe}`, JSON.stringify(f));
}
/** 关闭第 n 条(默认最新)管道;info 模拟壳透传的服务端 Close 帧
 * (如 {code:1000} 正常关闭),缺省 null = 异常断开 */
function closePipe(pipeIdx = -1, info: { code?: number; reason?: string } | null = null) {
  const pipe = openPipes.at(pipeIdx);
  emit(`ws-closed:${pipe}`, info);
}

beforeEach(() => {
  listeners.clear();
  script = { opens: [] };
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
            const okOpen = script.opens[openCalls] ?? true;
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

async function makeConn(
  mode: "attach" | "new",
  firstInput?: string | { content: string; attachments?: { url: string; filename: string }[] },
) {
  const { connectCloudTask } = await import("./cloudapi");
  const events: string[] = [];
  const conn = connectCloudTask(
    "task-1",
    mode,
    {
      onFrames: (batch) => events.push("frames:" + batch.map((f) => f.type).join(",")),
      onStatus: (text) => events.push("status:" + text),
      onEnded: () => events.push("ended"),
      onIdle: () => events.push("idle"),
      onSendFailed: (input) => events.push("sendFailed:" + input.content),
      onReconnect: () => events.push("reconnect"),
    },
    firstInput,
  );
  await vi.advanceTimersByTimeAsync(0); // 让 openPipe 的 promise 链落定
  return { conn, events };
}

describe("connectCloudTask 重连状态机", () => {
  it("空闲关闭(连上后只有 cursor 就被关)→ onIdle,绝不重连", async () => {
    script.opens = [true];
    const { events } = await makeConn("attach");
    pushFrame({ type: "cursor", data: { cursor: "3", has_more: true } });
    closePipe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toContain("idle");
    expect(openCalls).toBe(1); // 没有任何重连
    expect(events.join()).not.toContain("自动重连");
  });

  it("轮结束(task-ended)后关闭 → 不重连,状态提示可继续对话", async () => {
    script.opens = [true];
    const { events } = await makeConn("attach");
    pushFrame({ type: "task-started", seq: 1 });
    pushFrame({ type: "task-ended", seq: 2 });
    closePipe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toContain("ended");
    expect(openCalls).toBe(1);
    expect(events.some((e) => e.includes("本轮已结束"))).toBe(true);
  });

  it("回放整轮业务帧后服务端正常关闭(1000)→ onIdle,绝不重连", async () => {
    // 用户实测死循环的变体:当前轮已结束但任务仍 processing,attach 回放
    // 历史帧(framesThisOpen>0)后云端正常关连接——不是断线
    script.opens = [true];
    const { events } = await makeConn("attach");
    pushFrame({ type: "task-started", seq: 1 });
    pushFrame({ type: "task-running", kind: "acp_event", seq: 2 });
    closePipe(-1, { code: 1000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toContain("idle");
    expect(openCalls).toBe(1);
    expect(events.join()).not.toContain("自动重连");
  });

  it("task-ended 的 seq 低于回放水位(被去重)也要停机,不得重连", async () => {
    // 单调 seq 去重不能误杀停机信号:控制帧把水位顶高后 task-ended 后到
    script.opens = [true];
    const { events } = await makeConn("attach");
    pushFrame({ type: "task-started", seq: 10 });
    pushFrame({ type: "task-ended", seq: 5 }); // seq 低于水位,帧本身被去重
    closePipe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toContain("ended");
    expect(openCalls).toBe(1);
    expect(events.some((e) => e.includes("本轮已结束"))).toBe(true);
  });

  it("连续短命断流(无 Close 帧可识别)达上限 → 转 onIdle 兜底", async () => {
    // 兜底闸:即便服务端异常关闭不带原因码,也不能永远 2 秒循环
    script.opens = [true, true, true, true, true, true];
    const { events } = await makeConn("attach");
    for (let i = 0; i < 5; i++) {
      pushFrame({ type: "task-running", kind: "acp_event", seq: 1 }); // 重连后水位归零,seq=1 均有效
      closePipe();
      await vi.advanceTimersByTimeAsync(2100);
    }
    expect(openCalls).toBe(5); // 第 5 次断流后放弃,不再第 6 次
    expect(events).toContain("idle");
    expect(events.some((e) => e.includes("反复断开"))).toBe(true);
  });

  it("活跃流中途断开 → 按 2s 重连并回放归零(onReconnect)", async () => {
    script.opens = [true, true];
    const { events } = await makeConn("attach");
    pushFrame({ type: "task-started", seq: 1 });
    pushFrame({ type: "task-running", kind: "acp_event", seq: 2 });
    closePipe();
    expect(events.some((e) => e.includes("2 秒后自动重连"))).toBe(true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(openCalls).toBe(2);
    expect(events).toContain("reconnect");
  });

  it("连续拨号失败 → 指数退避,5 次后放弃转 onIdle", async () => {
    script.opens = [false, false, false, false, false];
    const { events } = await makeConn("attach");
    // 退避:2s,4s,8s,16s;第 5 次失败后放弃
    await vi.advanceTimersByTimeAsync(2100); // fail#2
    await vi.advanceTimersByTimeAsync(4100); // fail#3
    await vi.advanceTimersByTimeAsync(8100); // fail#4
    await vi.advanceTimersByTimeAsync(16100); // fail#5 → 放弃
    await vi.advanceTimersByTimeAsync(120_000);
    expect(openCalls).toBe(5);
    expect(events).toContain("idle");
    expect(events.some((e) => e.includes("发送消息时会重试"))).toBe(true);
  });

  it("mode=new 拨号失败 → 首条输入经 onSendFailed 交还,不重试", async () => {
    script.opens = [false];
    const { events } = await makeConn("new", "你好云端");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toContain("sendFailed:你好云端");
    expect(openCalls).toBe(1);
  });

  it("mode=new 已上行但零回显被关 → onSendFailed 兜底,不静默丢", async () => {
    script.opens = [true];
    const { events } = await makeConn("new", "排队内容");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.length).toBe(1); // user-input 已上行
    closePipe(); // 云端没回显任何帧就关(拒收)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toContain("sendFailed:排队内容");
    expect(openCalls).toBe(1);
  });

  it("mode=new 首条输入带附件 → user-input 帧携带 attachments(content 仍双层 base64)", async () => {
    script.opens = [true];
    const att = { url: "https://oss.example.com/a.webp", filename: "a.webp" };
    await makeConn("new", { content: "看下这张图", attachments: [att] });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.length).toBe(1);
    const frame = JSON.parse(sent[0]) as { type: string; data: string };
    expect(frame.type).toBe("user-input");
    const payload = JSON.parse(b64decode(frame.data)) as { content: string; attachments: unknown };
    expect(b64decode(payload.content)).toBe("看下这张图");
    expect(payload.attachments).toEqual([att]);
  });

  it("mode=new 裸字符串首条输入(兼容旧调用)→ attachments 为空数组", async () => {
    script.opens = [true];
    await makeConn("new", "纯文本");
    await vi.advanceTimersByTimeAsync(0);
    const payload = JSON.parse(b64decode((JSON.parse(sent[0]) as { data: string }).data)) as {
      attachments: unknown;
    };
    expect(payload.attachments).toEqual([]);
  });

  it("mode=new 有回显后中断 → 正常按断线重连(不误判拒收)", async () => {
    script.opens = [true, true];
    const { events } = await makeConn("new", "正常输入");
    await vi.advanceTimersByTimeAsync(0);
    pushFrame({ type: "user-input", seq: 1, data: "e30=" }); // 回显到达
    closePipe();
    await vi.advanceTimersByTimeAsync(2100);
    expect(events.join()).not.toContain("sendFailed");
    expect(openCalls).toBe(2);
  });
});

describe("CloudConn.send 真实布尔", () => {
  it("管道存活发送成功 → true;壳侧发送失败 → false 并外显", async () => {
    // 曾是同步假 true:调用方(提问卡)拿它乐观回写,消息没送达也显示"已回答"
    script.opens = [true];
    const { conn, events } = await makeConn("attach");
    await expect(conn.send("user-cancel")).resolves.toBe(true);
    expect(sent.length).toBe(1);
    sendFail = true; // 管道死亡与 ws-closed 事件到达之间的窗口
    await expect(conn.send("user-cancel")).resolves.toBe(false);
    expect(events.some((e) => e.includes("发送失败"))).toBe(true);
  });

  it("管道未建立(拨号失败中)→ false,不抛错", async () => {
    script.opens = [false, true];
    const { conn } = await makeConn("attach"); // 首拨失败,2s 后才重试
    await expect(conn.send("user-cancel")).resolves.toBe(false);
  });
});

// ---- connectCloudControl:退避/放弃/懒重连/在途 call 立即失败 ----

/** base64(JSON)(控制流应答载荷;复用 codec 的编解码,Node ≥16 有 atob/btoa) */
function b64(obj: unknown): string {
  return b64encode(JSON.stringify(obj));
}
/** 从最近一条上行 call 帧里取 request_id(应答按它配对) */
function lastCallRequestId(): string {
  const m = JSON.parse(sent.at(-1)!) as { data: string };
  return (JSON.parse(b64decode(m.data)) as { request_id: string }).request_id;
}
function pushCallResponse(body: Record<string, unknown>) {
  pushFrame({ type: "call-response", data: b64(body) });
}

async function makeCtrl() {
  const { connectCloudControl } = await import("./cloudapi");
  const events: string[] = [];
  const ctrl = connectCloudControl("task-1", {
    onStatus: (text, ok) => events.push(`status:${ok ? "up" : "down"}:${text}`),
  });
  await vi.advanceTimersByTimeAsync(0); // 让 openPipe 的 promise 链落定
  return { ctrl, events };
}

/** 走完整个拨号退避序列(2/4/8/16s)直至第 5 次失败放弃 */
async function exhaustDialBackoff() {
  for (const ms of [2100, 4100, 8100, 16100]) await vi.advanceTimersByTimeAsync(ms);
}

describe("connectCloudControl 重连与 pending 生命周期", () => {
  it("连续拨号失败 → 指数退避,5 次后放弃并外显环境离线", async () => {
    // 曾是固定 1.5s 无限重连:任务结束/环境回收后长驻抽屉永远拨号刷屏
    script.opens = [false, false, false, false, false];
    const { ctrl, events } = await makeCtrl();
    expect(openCalls).toBe(1); // 首拨已失败,等 2s 退避
    await exhaustDialBackoff();
    await vi.advanceTimersByTimeAsync(300_000); // 放弃后再久也不自动重拨
    expect(openCalls).toBe(5);
    expect(events.some((e) => e.startsWith("status:down:") && e.includes("环境离线"))).toBe(true);
    ctrl.close();
  });

  it("放弃后 call() 懒重连:重新拨号,连上后排队 call 送达", async () => {
    script.opens = [false, false, false, false, false, true];
    const { ctrl } = await makeCtrl();
    await exhaustDialBackoff();
    expect(openCalls).toBe(5); // 已放弃
    const p = ctrl.call<{ success?: boolean }>("repo_file_changes");
    await vi.advanceTimersByTimeAsync(0); // 懒重连拨号落定 + 队列 flush
    expect(openCalls).toBe(6);
    expect(sent.length).toBe(1);
    pushCallResponse({ request_id: lastCallRequestId(), success: true });
    await expect(p).resolves.toMatchObject({ success: true });
    ctrl.close();
  });

  it("放弃时排队中的 call 立即失败(没有重连就没有送达),不干等超时", async () => {
    script.opens = [false, false, false, false, false];
    const { ctrl } = await makeCtrl();
    // 超时给足 120s:确保先到的是"放弃拨号"的即时失败,而不是超时兜底
    const p = ctrl.call("repo_file_list", {}, { timeoutMs: 120_000 }).catch((e: Error) => e.message);
    await exhaustDialBackoff(); // 累计 ~30s 放弃,远未到 120s
    expect(await p).toContain("环境离线");
    ctrl.close();
  });

  it("管道断开 → 在途 call 立即 reject,不干等 15s 超时", async () => {
    script.opens = [true, true];
    const { ctrl } = await makeCtrl();
    const p = ctrl.call("repo_file_list").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.length).toBe(1); // 已实际上行 = 在途
    closePipe(); // 不推进任何时钟:必须立即失败
    expect(await p).toContain("已断开");
    ctrl.close();
  });

  it("拨号失败期间排队的 call 不被断开误杀,重连成功后送达", async () => {
    script.opens = [false, true];
    const { ctrl } = await makeCtrl(); // 首拨失败,2s 后重试
    const p = ctrl.call<{ success?: boolean }>("repo_file_changes");
    await vi.advanceTimersByTimeAsync(2100); // 重拨成功 → flush 队列
    expect(openCalls).toBe(2);
    expect(sent.length).toBe(1);
    pushCallResponse({ request_id: lastCallRequestId(), success: true });
    await expect(p).resolves.toMatchObject({ success: true });
    ctrl.close();
  });

  it("连接反复短命断开达上限 → 停止自动重连(拨号成功够不着失败上限)", async () => {
    script.opens = [true, true, true, true, true, true];
    const { ctrl, events } = await makeCtrl();
    for (let i = 0; i < 5; i++) {
      closePipe();
      await vi.advanceTimersByTimeAsync(2100);
    }
    expect(openCalls).toBe(5); // 第 5 次断开后放弃,不再第 6 拨
    expect(events.some((e) => e.includes("反复断开"))).toBe(true);
    ctrl.close();
  });

  it("call 超时可按调用覆盖(唤醒路径给 90s)且文案可定制", async () => {
    script.opens = [true];
    const { ctrl } = await makeCtrl();
    const p = ctrl
      .call("switch_model", { model_id: "m" }, { timeoutMs: 90_000, timeoutMsg: "唤醒中,操作可能仍会生效" })
      .catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(20_000); // 越过默认 15s:不得按默认超时
    await vi.advanceTimersByTimeAsync(75_000); // 到 90s
    expect(await p).toContain("仍会生效");
    ctrl.close();
  });

  it("close() 后所有 pending 失败,call 直接拒绝", async () => {
    script.opens = [true];
    const { ctrl } = await makeCtrl();
    const p = ctrl.call("repo_file_list").catch((e: Error) => e.message);
    ctrl.close();
    expect(await p).toContain("已关闭");
    await expect(ctrl.call("x")).rejects.toThrow("已关闭");
  });
});
