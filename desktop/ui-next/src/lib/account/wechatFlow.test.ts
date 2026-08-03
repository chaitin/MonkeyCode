import { describe, expect, it } from "vitest";

import {
  createWechatFlow,
  pollTransition,
  type WechatPollStatus,
  type WechatSnapshot,
} from "./wechatFlow";

describe("pollTransition:轮询结果转移表", () => {
  const table: Array<[status: string, phase: string, done: boolean]> = [
    ["waiting", "waiting", false],
    ["scanned", "scanned", false],
    ["canceled", "waiting", false], // 取消回待扫,二维码仍有效
    ["expired", "expired", true],
    ["ok", "ok", true],
    ["unknown-future", "error", true], // 协议新增的未知状态按 error 收
  ];
  for (const [status, phase, done] of table) {
    it(`${status} → ${phase}${done ? "(终态)" : "(续询)"}`, () => {
      expect(pollTransition(status as WechatPollStatus)).toEqual({ phase, done });
    });
  }
});

/** 测试驾驶台:start 固定回码,poll 按脚本出队(Error 项 reject),
 *  时钟立即 resolve 并记录喘息。 */
function harness(script: Array<WechatPollStatus | Error>, opts?: { qr?: string; startError?: Error }) {
  const snaps: WechatSnapshot[] = [];
  const sleeps: number[] = [];
  let polls = 0;
  const flow = createWechatFlow({
    start: () =>
      opts?.startError ? Promise.reject(opts.startError) : Promise.resolve({ qr: opts?.qr ?? "data:qr" }),
    poll: () => {
      polls++;
      const next = script.shift();
      if (next === undefined) return new Promise(() => {}); // 脚本耗尽:挂起(等价壳长挂)
      return next instanceof Error ? Promise.reject(next) : Promise.resolve({ status: next });
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    onChange: (s) => snaps.push(s),
  });
  return { flow, snaps, sleeps, pollCount: () => polls };
}

const phases = (snaps: WechatSnapshot[]) => snaps.map((s) => s.phase);

describe("createWechatFlow:全路径", () => {
  it("成功路径 waiting→scanned→ok:快照依序推进,终态后不再轮询", async () => {
    const h = harness(["waiting", "scanned", "ok"]);
    await h.flow.begin();
    expect(phases(h.snaps)).toEqual(["loading", "waiting", "waiting", "scanned", "ok"]);
    expect(h.snaps.at(-1)?.qr).toBe("data:qr");
    expect(h.pollCount()).toBe(3);
    expect(h.sleeps).toEqual([300, 300]); // 每次续询前喘息一次;终态不喘
  });

  it("canceled 回待扫并继续轮询,不终止循环", async () => {
    const h = harness(["scanned", "canceled", "ok"]);
    await h.flow.begin();
    expect(phases(h.snaps)).toEqual(["loading", "waiting", "scanned", "waiting", "ok"]);
    expect(h.pollCount()).toBe(3);
  });

  it("expired 终态:停止轮询,快照留在 expired(UI 覆「重新获取」)", async () => {
    const h = harness(["waiting", "expired", "ok"]);
    await h.flow.begin();
    expect(phases(h.snaps)).toEqual(["loading", "waiting", "waiting", "expired"]);
    expect(h.pollCount()).toBe(2); // 终态后脚本剩余的 ok 不被消费
    expect(h.flow.snapshot().phase).toBe("expired");
  });

  it("start 失败 → error 快照带壳错误信息,不进入轮询", async () => {
    const h = harness([], { startError: new Error("获取微信授权地址失败: 网络不通") });
    await h.flow.begin();
    expect(phases(h.snaps)).toEqual(["loading", "error"]);
    expect(h.snaps.at(-1)?.error).toContain("获取微信授权地址失败");
    expect(h.pollCount()).toBe(0);
  });

  it("start 回空码视同失败", async () => {
    const h = harness([], { qr: "" });
    await h.flow.begin();
    expect(phases(h.snaps)).toEqual(["loading", "error"]);
    expect(h.snaps.at(-1)?.error).toBe("二维码数据为空");
  });

  it("poll 失败 → error 终态", async () => {
    const h = harness(["waiting", new Error("查询扫码状态失败: HTTP 500")]);
    await h.flow.begin();
    expect(phases(h.snaps)).toEqual(["loading", "waiting", "waiting", "error"]);
    expect(h.snaps.at(-1)?.error).toContain("查询扫码状态失败");
  });
});

describe("createWechatFlow:并发与作废", () => {
  it("begin 重入:旧循环被作废,迟到的轮询结果不倒灌快照", async () => {
    const snaps: WechatSnapshot[] = [];
    let firstPoll: ((v: { status: WechatPollStatus }) => void) | undefined;
    let calls = 0;
    const flow = createWechatFlow({
      start: () => Promise.resolve({ qr: `qr-${++calls}` }),
      poll: () => {
        if (calls === 1) return new Promise((r) => (firstPoll = r)); // 第一代:挂起待手动放行
        return Promise.resolve({ status: "ok" });
      },
      sleep: () => Promise.resolve(),
      onChange: (s) => snaps.push(s),
    });
    const first = flow.begin();
    await Promise.resolve(); // 让第一代走到轮询挂起处
    const second = flow.begin(); // 重新获取:作废第一代
    firstPoll?.({ status: "ok" }); // 第一代迟到的 ok 必须被丢弃
    await Promise.all([first, second]);
    expect(flow.snapshot().qr).toBe("qr-2");
    expect(flow.snapshot().phase).toBe("ok");
    // 第一代挂起前最后快照是 waiting(qr-1);其 ok 不应出现在 qr-1 的快照序列里
    expect(snaps.filter((s) => s.qr === "qr-1").map((s) => s.phase)).toEqual(["waiting"]);
  });

  it("dispose 后不再有 onChange", async () => {
    const snaps: WechatSnapshot[] = [];
    let release: ((v: { status: WechatPollStatus }) => void) | undefined;
    const flow = createWechatFlow({
      start: () => Promise.resolve({ qr: "qr" }),
      poll: () => new Promise((r) => (release = r)),
      sleep: () => Promise.resolve(),
      onChange: (s) => snaps.push(s),
    });
    const run = flow.begin();
    await Promise.resolve();
    const before = snaps.length;
    flow.dispose();
    release?.({ status: "ok" });
    await run;
    expect(snaps.length).toBe(before); // dispose 之后零新快照
  });
});
