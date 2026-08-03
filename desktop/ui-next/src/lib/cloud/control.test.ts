// 云端控制流 call 配对状态机:配对/超时档位/在途 reject 排队保留/放弃与
// 懒重连,假时钟+假管道表驱动。
import { describe, expect, it } from "vitest";

import { b64decode, b64encode } from "@/lib/protocol/codec";
import type { CloudPipe, OpenPipe, WsCloseInfo } from "./pipes";
import {
  connectCloudControl,
  CONTROL_CALL_TIMEOUT_MS,
  WAKE_CALL_TIMEOUT_MS,
  type ControlStatus,
} from "./control";

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
  send = (text: string): Promise<void> => {
    this.sent.push(text);
    return Promise.resolve();
  };
  close = (): void => {
    this.closed = true;
  };
}

interface OpenAttempt {
  onText(text: string): void;
  onClose(info: WsCloseInfo | null): void;
  accept(): FakePipe;
  fail(msg?: string): void;
}

function harness() {
  const clock = new FakeClock();
  const opens: OpenAttempt[] = [];
  const openPipe: OpenPipe = (_kind, _id, _params, onText, onClose) =>
    new Promise<CloudPipe>((resolve, reject) => {
      opens.push({
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
  const statuses: { st: ControlStatus; ok: boolean }[] = [];
  const ctl = connectCloudControl(
    "task-1",
    { onStatus: (st, ok) => statuses.push({ st, ok }) },
    { openPipe, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: () => clock.now },
  );
  /** 解出上行 call 帧(request_id + payload)。 */
  const sentCall = (pipe: FakePipe, i: number) => {
    const wire = JSON.parse(pipe.sent[i]!) as { type: string; kind: string; data: string };
    return { ...wire, payload: JSON.parse(b64decode(wire.data)) as { request_id: string } & Record<string, unknown> };
  };
  const respond = (i: number, body: Record<string, unknown>, raw = false) =>
    opens[i]!.onText(
      JSON.stringify({ type: "call-response", data: raw ? body : b64encode(JSON.stringify(body)) }),
    );
  return { clock, opens, ctl, statuses, sentCall, respond };
}

describe("connectCloudControl", () => {
  it("上行 call 形状 + request_id 配对(b64 与裸对象双格式应答都收)", async () => {
    const h = harness();
    const pipe = h.opens[0]!.accept();
    await flush();
    const p1 = h.ctl.call<{ files: number[] }>("repo_file_list", { path: "src" });
    const p2 = h.ctl.call<{ ports: number[] }>("port_forward_list");
    await flush();
    expect(pipe.sent).toHaveLength(2);
    const c1 = h.sentCall(pipe, 0);
    expect(c1.type).toBe("call");
    expect(c1.kind).toBe("repo_file_list");
    expect(c1.payload.path).toBe("src");
    expect(typeof c1.payload.request_id).toBe("string");
    const c2 = h.sentCall(pipe, 1);
    // 乱序应答也按 request_id 各回各家;第二条用裸对象 data(双格式容错)
    h.respond(0, { request_id: c2.payload.request_id, ports: [3000] }, true);
    h.respond(0, { request_id: c1.payload.request_id, files: [1, 2] });
    await expect(p1).resolves.toMatchObject({ files: [1, 2] });
    await expect(p2).resolves.toMatchObject({ ports: [3000] });
  });

  it("success:false → reject(remote,带服务端错误文案)", async () => {
    const h = harness();
    const pipe = h.opens[0]!.accept();
    await flush();
    const p = h.ctl.call("switch_model", { model_id: "m1" });
    p.catch(() => {});
    await flush();
    h.respond(0, { request_id: h.sentCall(pipe, 0).payload.request_id, success: false, error: "模型不存在" });
    await expect(p).rejects.toMatchObject({ code: "remote", message: "模型不存在" });
  });

  // 成败判据不能只看 success:后端每个 kind 的响应结构体不一样。
  // repo_file_list 的 RepoListFiles.Success 是 `json:"success,omitempty"`
  // (backend types.go:441)——失败时 success=false 被 omitempty 抹掉,只剩
  // error;而 ListPortforwadResp(types.go:728)压根没有 success 字段。
  // 两头一夹,`success === false` 和 `success !== true` 都是错的。
  it("repo_file_list 失败(success 被 omitempty 抹掉、只剩 error)→ reject,不能读成空目录", async () => {
    const h = harness();
    const pipe = h.opens[0]!.accept();
    await flush();
    const p = h.ctl.call("repo_file_list", { path: "nope" });
    p.catch(() => {});
    await flush();
    // 后端实际下发的失败形状:没有 success 这一项
    h.respond(0, { request_id: h.sentCall(pipe, 0).payload.request_id, path: "nope", error: "目录不存在" });
    await expect(p).rejects.toMatchObject({ code: "remote", message: "目录不存在" });
  });

  it("port_forward_list 应答没有 success 字段:照常 resolve(不能把缺席当失败)", async () => {
    const h = harness();
    const pipe = h.opens[0]!.accept();
    await flush();
    const p = h.ctl.call<{ ports: unknown[] }>("port_forward_list");
    await flush();
    h.respond(0, { request_id: h.sentCall(pipe, 0).payload.request_id, ports: [{ port: 3000 }] });
    await expect(p).resolves.toMatchObject({ ports: [{ port: 3000 }] });
  });

  it("revive():放弃自动重连后不发 call 也能重新拨(唤醒休眠 VM 靠的就是建连本身)", async () => {
    const h = harness();
    const delays = [2000, 4000, 8000, 16000];
    for (let i = 0; i < 4; i++) {
      h.opens[i]!.fail();
      await flush();
      h.clock.advance(delays[i]!);
    }
    h.opens[4]!.fail();
    await flush();
    expect(h.statuses.at(-1)?.st.kind).toBe("offline");
    expect(h.clock.pendingDelays()).toEqual([]); // 放弃后没有任何重连计时器

    h.ctl.revive();
    expect(h.opens).toHaveLength(6); // 没有 call,单靠 revive 也重新拨了
    h.opens[5]!.accept();
    await flush();
    expect(h.statuses.at(-1)?.st.kind).toBe("connected");
    // 已连上时 revive 是空操作,不会拨出多余连接
    h.ctl.revive();
    expect(h.opens).toHaveLength(6);
  });

  it("超时档位:默认 15s;唤醒场景 180s + 定制文案", async () => {
    const h = harness();
    h.opens[0]!.accept();
    await flush();
    const quick = h.ctl.call("repo_file_list");
    quick.catch(() => {});
    const wake = h.ctl.call("switch_model", {}, { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: "唤醒中,可能已生效" });
    wake.catch(() => {});
    await flush();
    expect(CONTROL_CALL_TIMEOUT_MS).toBe(15_000);
    expect(WAKE_CALL_TIMEOUT_MS).toBe(180_000);
    h.clock.advance(15_000);
    await expect(quick).rejects.toMatchObject({ code: "timeout" });
    h.clock.advance(164_999);
    // 179999ms:唤醒档还没到点
    let wakeSettled = false;
    void wake.then(
      () => (wakeSettled = true),
      () => (wakeSettled = true),
    );
    await flush();
    expect(wakeSettled).toBe(false);
    h.clock.advance(1);
    await expect(wake).rejects.toMatchObject({ code: "timeout", message: "唤醒中,可能已生效" });
  });

  it("断开:在途 call 立即 reject,排队中的保留等重连后送达", async () => {
    const h = harness();
    const pipe = h.opens[0]!.accept();
    await flush();
    const inflight = h.ctl.call("repo_file_list");
    inflight.catch(() => {});
    await flush();
    expect(pipe.sent).toHaveLength(1);
    h.opens[0]!.onClose(null); // 断开:在途 reject
    await expect(inflight).rejects.toMatchObject({ code: "disconnected" });
    const queued = h.ctl.call<{ ok: boolean }>("repo_file_changes"); // 管道死了:入队
    expect(h.clock.pendingDelays()).toContain(2000); // 曾成功建立 → 退避从头计
    h.clock.advance(2000);
    const pipe2 = h.opens[1]!.accept();
    await flush();
    expect(pipe2.sent).toHaveLength(1); // 排队帧重连后送出
    const call = h.sentCall(pipe2, 0);
    expect(call.kind).toBe("repo_file_changes");
    h.respond(1, { request_id: call.payload.request_id, ok: true });
    await expect(queued).resolves.toMatchObject({ ok: true });
  });

  it("连续 5 次拨不通:放弃(排队 call 全失败,外显 offline),下一次 call 懒重连", async () => {
    const h = harness();
    const early = h.ctl.call("repo_file_list", {}, { timeoutMs: 600_000 });
    early.catch(() => {});
    const delays = [2000, 4000, 8000, 16000];
    for (let i = 0; i < 4; i++) {
      h.opens[i]!.fail(`unreachable #${i}`);
      await flush();
      expect(h.clock.pendingDelays()).toEqual(expect.arrayContaining([delays[i]]));
      h.clock.advance(delays[i]!);
    }
    h.opens[4]!.fail("unreachable #4");
    await flush();
    await expect(early).rejects.toMatchObject({ code: "offline" });
    expect(h.statuses.at(-1)?.st.kind).toBe("offline");
    expect(h.opens).toHaveLength(5);
    // 懒重连:新 call 重新拨号,连上后送达
    const revived = h.ctl.call<{ ok: boolean }>("port_forward_list");
    expect(h.opens).toHaveLength(6);
    const pipe = h.opens[5]!.accept();
    await flush();
    expect(h.statuses.at(-1)?.st.kind).toBe("connected");
    h.respond(5, { request_id: h.sentCall(pipe, 0).payload.request_id, ok: true });
    await expect(revived).resolves.toMatchObject({ ok: true });
  });

  it("反复短命断开(存活<60s)达上限 → 放弃", async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      h.opens[i]!.accept();
      await flush();
      h.clock.advance(1000);
      h.opens[i]!.onClose(null);
      if (i < 4) h.clock.advance(2000);
    }
    expect(h.statuses.at(-1)?.st.kind).toBe("offline");
    expect(h.clock.pendingDelays()).toEqual([]);
  });

  it("close():在途与排队全部 reject(closed),定时器清空", async () => {
    const h = harness();
    h.opens[0]!.accept();
    await flush();
    const inflight = h.ctl.call("repo_file_list");
    inflight.catch(() => {});
    await flush();
    h.ctl.close();
    await expect(inflight).rejects.toMatchObject({ code: "closed" });
    await expect(h.ctl.call("x")).rejects.toMatchObject({ code: "closed" });
    expect(h.clock.pendingDelays()).toEqual([]);
  });
});
