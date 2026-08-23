// 云端流重连状态机:计划钉死的每条策略逐条表驱动验证(假时钟+假管道)。
import { describe, expect, it } from "vitest";

import { b64decode, b64encode } from "@/lib/protocol/codec";
import type { Frame } from "@/lib/protocol/types";
import type { CloudPipe, OpenPipe, WsCloseInfo } from "./pipes";
import {
  connectCloudStream,
  DIAL_GIVEUP_FAILS,
  dialBackoffMs,
  type CloudUserInput,
  type StreamStatus,
} from "./stream";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class FakeClock {
  now = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private seq = 0;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== h);
  };
  /** 推进时间并触发到期定时器(按到期序)。 */
  advance(ms: number): void {
    this.now += ms;
    for (;;) {
      const due = [...this.timers].sort((a, b) => a.at - b.at).find((timer) => timer.at <= this.now);
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      due.fn();
    }
  }
  pendingDelays(): number[] {
    return this.timers.map((timer) => timer.at - this.now);
  }
}

class FakePipe implements CloudPipe {
  sent: string[] = [];
  closed = false;
  failSend = false;
  send = (text: string): Promise<void> => {
    if (this.failSend) return Promise.reject(new Error("pipe dead"));
    this.sent.push(text);
    return Promise.resolve();
  };
  close = (): void => {
    this.closed = true;
  };
}

interface OpenAttempt {
  params: Record<string, unknown>;
  onText(text: string): void;
  onClose(info: WsCloseInfo | null): void;
  accept(): FakePipe;
  fail(msg?: string): void;
}

function harness(
  mode: "attach" | "new" = "attach",
  firstInput?: CloudUserInput,
  /** deferFlush:批调度改成手动(还原 rAF 的"下一拍"语义),由 runFlush 触发 */
  opts: { deferFlush?: boolean } = {},
) {
  const clock = new FakeClock();
  const opens: OpenAttempt[] = [];
  const openPipe: OpenPipe = (_kind, _id, params, onText, onClose) =>
    new Promise<CloudPipe>((resolve, reject) => {
      opens.push({
        params,
        onText,
        onClose,
        accept() {
          const pipe = new FakePipe();
          resolve(pipe);
          return pipe;
        },
        fail(msg = "dial fail") {
          reject(new Error(msg));
        },
      });
    });
  const frames: Frame[][] = [];
  const statuses: { st: StreamStatus; ok: boolean }[] = [];
  const sendFailed: CloudUserInput[] = [];
  const counters = { ended: 0, reconnect: 0, idle: 0 };
  let deferred: (() => void) | null = null;
  const conn = connectCloudStream(
    "task-1",
    mode,
    {
      onFrames: (batch) => frames.push(batch),
      onStatus: (st, ok) => statuses.push({ st, ok }),
      onEnded: () => counters.ended++,
      onReconnect: () => counters.reconnect++,
      onIdle: () => counters.idle++,
      onSendFailed: (input) => sendFailed.push(input),
    },
    firstInput,
    {
      openPipe,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      now: () => clock.now,
      // 默认立即冲刷:一帧一批,断言简单;deferFlush 时攒着等 runFlush
      schedule: opts.deferFlush
        ? (fn) => {
            deferred = fn;
          }
        : (fn) => fn(),
    },
  );
  const kinds = () => statuses.map((s) => s.st.kind);
  const deliver = (i: number, frame: Frame | Record<string, unknown>) => opens[i]!.onText(JSON.stringify(frame));
  const runFlush = () => {
    const fn = deferred;
    deferred = null;
    fn?.();
  };
  return { clock, opens, conn, frames, statuses, sendFailed, counters, kinds, deliver, runFlush };
}

describe("退避参数", () => {
  it("2s 起指数翻倍封顶 30s;放弃阈值 5", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(dialBackoffMs)).toEqual([2000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(DIAL_GIVEUP_FAILS).toBe(5);
  });
});

describe("connectCloudStream", () => {
  it("按模式开管道;attach 参数钉死", () => {
    const h = harness("attach");
    expect(h.opens).toHaveLength(1);
    expect(h.opens[0]!.params).toEqual({ mode: "attach" });
    expect(h.kinds()).toEqual(["connecting"]);
  });

  it("连上后下行帧透传;ping 滤除;seq 重叠帧去重", async () => {
    const h = harness();
    h.opens[0]!.accept();
    await flush();
    expect(h.kinds()).toEqual(["connecting", "connected"]);
    h.deliver(0, { type: "ping" });
    h.deliver(0, { type: "task-started", seq: 1 });
    h.deliver(0, { type: "task-started", seq: 1 }); // 重叠帧
    h.deliver(0, { type: "task-running", seq: 2 });
    expect(h.frames.flat().map((f) => [f.type, f.seq])).toEqual([
      ["task-started", 1],
      ["task-running", 2],
    ]);
  });

  it("mode=new:连上即上行首条输入,payload b64(JSON)、content 再包一层 base64", async () => {
    const input = { content: "云端你好", attachments: [{ url: "https://oss/a.png", filename: "a.png" }] };
    const h = harness("new", input);
    expect(h.opens[0]!.params).toEqual({ mode: "new" });
    const pipe = h.opens[0]!.accept();
    await flush();
    expect(pipe.sent).toHaveLength(1);
    const wire = JSON.parse(pipe.sent[0]!) as { type: string; data: string; timestamp: number };
    expect(wire.type).toBe("user-input");
    expect(typeof wire.timestamp).toBe("number");
    const payload = JSON.parse(b64decode(wire.data)) as { content: string; attachments: unknown[] };
    expect(payload.content).toBe(b64encode("云端你好")); // 双层 base64
    expect(b64decode(payload.content)).toBe("云端你好");
    expect(payload.attachments).toEqual(input.attachments);
  });

  it("连续 5 次拨不通:退避 2/4/8/16s 后放弃,转就绪不再拨号", async () => {
    const h = harness();
    const expectedDelays = [2000, 4000, 8000, 16000];
    for (let i = 0; i < DIAL_GIVEUP_FAILS - 1; i++) {
      h.opens[i]!.fail(`no route #${i}`);
      await flush();
      expect(h.clock.pendingDelays()).toEqual([expectedDelays[i]]);
      h.clock.advance(expectedDelays[i]!);
    }
    expect(h.opens).toHaveLength(5);
    h.opens[4]!.fail("no route #4");
    await flush();
    expect(h.kinds().filter((k) => k === "reconnecting")).toHaveLength(4);
    const gaveUp = h.statuses.find((s) => s.st.kind === "dialGaveUp");
    expect(gaveUp && gaveUp.st.kind === "dialGaveUp" ? gaveUp.st.reason : "").toContain("no route #4");
    expect(h.counters.idle).toBe(1);
    expect(h.clock.pendingDelays()).toEqual([]); // 没有残留定时器
    h.clock.advance(120_000);
    expect(h.opens).toHaveLength(5); // 不再拨号
  });

  it("断流重连一律降级 attach;回放为权威(onReconnect + seq 水位复位)", async () => {
    const h = harness("new", { content: "hi" });
    h.opens[0]!.accept();
    await flush();
    h.deliver(0, { type: "user-input", seq: 7 }); // 回显 = 业务帧
    h.opens[0]!.onClose(null); // 异常断流(无 Close 帧)
    expect(h.kinds()).toContain("reconnecting");
    expect(h.clock.pendingDelays()).toEqual([2000]);
    h.clock.advance(2000);
    expect(h.opens).toHaveLength(2);
    expect(h.opens[1]!.params).toEqual({ mode: "attach" }); // 降级
    expect(h.counters.reconnect).toBe(1);
    h.opens[1]!.accept();
    await flush();
    h.deliver(1, { type: "user-input", seq: 7 }); // 回放重叠帧:水位已复位,应再次透传
    expect(h.frames.flat().filter((f) => f.seq === 7)).toHaveLength(2);
  });

  it("低 seq 的 task-ended 仍同步冲刷待处理帧,再通知结束且不重连", async () => {
    const h = harness("attach", undefined, { deferFlush: true });
    h.opens[0]!.accept();
    await flush();
    h.deliver(0, { type: "task-started", seq: 10 });
    h.deliver(0, { type: "task-running", seq: 40 }); // 控制帧顶高水位,仍在下一拍队列中
    expect(h.frames).toEqual([]);
    h.deliver(0, { type: "task-ended", seq: 22 }); // 晚于本轮开始，不能按普通重叠帧丢弃
    expect(h.frames.flat().map((f) => f.type)).toEqual(["task-started", "task-running", "task-ended"]);
    expect(h.counters.ended).toBe(1);
    h.runFlush(); // 原先已安排的批处理回调应为空操作
    expect(h.frames).toHaveLength(1);
    h.opens[0]!.onClose(null);
    expect(h.kinds().at(-1)).toBe("roundEnded");
    expect(h.clock.pendingDelays()).toEqual([]); // 不重连
    expect(h.counters.idle).toBe(0);
  });

  it("早于当前 task-started 的旧 task-ended 不得结束新轮", async () => {
    const h = harness();
    h.opens[0]!.accept();
    await flush();
    h.deliver(0, { type: "task-started", seq: 30 });
    h.deliver(0, { type: "task-running", seq: 40 });
    h.deliver(0, { type: "task-ended", seq: 25 });
    expect(h.frames.flat().map((f) => f.type)).toEqual(["task-started", "task-running"]);
    expect(h.counters.ended).toBe(0);
    h.conn.close();
  });

  it("服务端 Close 1000 = 云端收束:转就绪不重连", async () => {
    const h = harness();
    h.opens[0]!.accept();
    await flush();
    h.deliver(0, { type: "task-running", seq: 3 });
    h.opens[0]!.onClose({ code: 1000 });
    expect(h.counters.idle).toBe(1);
    expect(h.clock.pendingDelays()).toEqual([]);
    h.clock.advance(120_000);
    expect(h.opens).toHaveLength(1);
  });

  it("零业务帧被关 = 空闲收束(cursor 不算轮活跃)", async () => {
    const h = harness();
    h.opens[0]!.accept();
    await flush();
    h.deliver(0, { type: "cursor", data: { cursor: "c1", has_more: true } });
    h.opens[0]!.onClose(null); // 连 Close 帧都没有,也该按空闲收束
    expect(h.counters.idle).toBe(1);
    expect(h.clock.pendingDelays()).toEqual([]);
    // cursor 帧本身仍透传(调用方捕获翻页游标)
    expect(h.frames.flat().map((f) => f.type)).toEqual(["cursor"]);
  });

  it("短命断流(存活<60s)连续 5 次转就绪", async () => {
    const h = harness();
    for (let i = 0; i < DIAL_GIVEUP_FAILS; i++) {
      h.opens[i]!.accept();
      await flush();
      h.deliver(i, { type: "task-running", seq: i + 1 });
      h.clock.advance(1000); // 短命:1s 后被关
      h.opens[i]!.onClose(null);
      if (i < DIAL_GIVEUP_FAILS - 1) {
        h.clock.advance(2000); // dialFails=0 → 固定 2s 重拨
      }
    }
    expect(h.statuses.some((s) => s.st.kind === "dropGaveUp")).toBe(true);
    expect(h.counters.idle).toBe(1);
    expect(h.clock.pendingDelays()).toEqual([]);
  });

  it("存活超 60s 视为健康连接:短命断流计数归零", async () => {
    const h = harness();
    // 4 次短命断流(还差 1 次到上限)
    for (let i = 0; i < 4; i++) {
      h.opens[i]!.accept();
      await flush();
      h.deliver(i, { type: "task-running", seq: i + 1 });
      h.clock.advance(1000);
      h.opens[i]!.onClose(null);
      h.clock.advance(2000);
    }
    // 第 5 条连接健康存活 61s:断开后计数应归零,继续重连而非放弃
    h.opens[4]!.accept();
    await flush();
    h.deliver(4, { type: "task-running", seq: 99 });
    h.clock.advance(61_000);
    h.opens[4]!.onClose(null);
    expect(h.statuses.some((s) => s.st.kind === "dropGaveUp")).toBe(false);
    expect(h.counters.idle).toBe(0);
    expect(h.clock.pendingDelays()).toEqual([2000]); // 还在重连
  });

  it("send 真布尔:未连接 false;壳侧发送失败 false 且外显;成功 true", async () => {
    const h = harness();
    expect(await h.conn.send("user-cancel")).toBe(false); // 还没连上
    const pipe = h.opens[0]!.accept();
    await flush();
    expect(await h.conn.send("user-cancel")).toBe(true);
    pipe.failSend = true;
    expect(await h.conn.send("user-cancel")).toBe(false);
    expect(h.statuses.some((s) => s.st.kind === "sendFailed")).toBe(true);
  });

  it("mode=new 拨号失败:首条输入经 onSendFailed 交还,连接作废", async () => {
    const input = { content: "别丢我", attachments: [{ url: "u", filename: "f" }] };
    const h = harness("new", input);
    h.opens[0]!.fail("vm asleep");
    await flush();
    expect(h.sendFailed).toEqual([input]);
    expect(h.counters.idle).toBe(0);
    expect(h.clock.pendingDelays()).toEqual([]); // 不重连,交还即终局
    h.clock.advance(120_000);
    expect(h.opens).toHaveLength(1);
  });

  it("mode=new 零回显被关(运行互斥/休眠被拒):sentFirst 兜底交还", async () => {
    const input = { content: "又被拒" };
    const h = harness("new", input);
    h.opens[0]!.accept();
    await flush(); // 首条输入已上行
    h.opens[0]!.onClose({ code: 1000 }); // 一帧未回就被正常关闭
    expect(h.sendFailed).toEqual([input]);
    expect(h.counters.idle).toBe(0); // 交还优先于转就绪
  });

  it("close() 清掉重连定时器", async () => {
    const h = harness();
    h.opens[0]!.fail();
    await flush();
    expect(h.clock.pendingDelays()).toEqual([2000]);
    h.conn.close();
    expect(h.clock.pendingDelays()).toEqual([]);
    h.clock.advance(60_000);
    expect(h.opens).toHaveLength(1);
  });

  it("close() 连同**同一拍里已排队还没 flush 的帧**一起作废", async () => {
    // 批调度是 rAF/宏任务:close() 之后那一拍照样会跑 flush,把帧喂给调用方
    // 已经弃用的 handler。发消息正是这条路径——先 close 观察连接再建
    // mode=new,残留帧一到就把「发送中」占位气泡在任何回显之前撤掉
    const h = harness("attach", undefined, { deferFlush: true });
    h.opens[0]!.accept();
    await flush();
    h.deliver(0, { type: "task-running", seq: 1 });
    expect(h.frames).toEqual([]); // 还没到 flush 那一拍
    h.conn.close();
    h.runFlush();
    expect(h.frames).toEqual([]);
  });

  it("服务端正常收束时,最后一批回放帧仍要送到(不能被 close 守卫连坐)", async () => {
    // 与上一条相对:清的是队列,不是"关了就不再回吐"——onIdle/onSendFailed
    // 路径内部同样置 closed,加 closed 守卫会把云端最后一批帧一起丢掉
    const h = harness("attach", undefined, { deferFlush: true });
    h.opens[0]!.accept();
    await flush();
    h.deliver(0, { type: "task-running", seq: 1 });
    h.opens[0]!.onClose({ code: 1000 }); // 云端回放完整轮后正常关连接
    h.runFlush();
    expect(h.frames.flat().map((f) => f.type)).toEqual(["task-running"]);
    expect(h.counters.idle).toBe(1);
  });
});
