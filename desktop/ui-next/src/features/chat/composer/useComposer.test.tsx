// composer 状态机的独立契约测试(此前只被 Composer.test 间接覆盖):
// 切会话留档/恢复、排队单槽、失败不丢草稿、迟到回执的纪元守卫,以及
// 补投三道闸(历史未落地不抢投 / 切会话不投错人 / 上行在途不直发)与
// 失败后的退避重试。
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { b64encode } from "@/lib/protocol/codec";
import { deliverQueued, resetStashForTests, stashGet, stashSet } from "./stash";
import { useComposer, type ComposerFeed } from "./useComposer";

function stubSend(impl: (cmd: string) => unknown) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        try {
          return Promise.resolve(impl(cmd));
        } catch (e) {
          return Promise.reject(e);
        }
      },
    },
  };
  return calls;
}

/** 数据面默认信号:历史已落地、无新帧;各用例只覆写关心的那一项。 */
const feed = (over: Partial<ComposerFeed> = {}): ComposerFeed => ({
  running: false,
  historyLoaded: true,
  lastSeq: 0,
  ...over,
});

/** 让在途的 IPC promise 与它引发的 setState 全部落地。 */
const settle = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  resetStashForTests();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useComposer:跨会话留档/恢复", () => {
  it("切会话留档草稿与排队,切回恢复;新会话是干净的", async () => {
    stubSend(() => null);
    const { result, rerender } = renderHook(({ id, running }) => useComposer(id, feed({ running })), {
      initialProps: { id: "a", running: true },
    });
    // send 的闭包按渲染帧取 draft:setDraft 与 send 必须分属两个 act
    act(() => result.current.setDraft("排我"));
    act(() => {
      result.current.send(); // running=true → 入单槽
    });
    act(() => result.current.setDraft("A 的草稿"));
    expect(result.current.queue.map((item) => item.text)).toEqual(["排我"]);

    rerender({ id: "b", running: false });
    expect(result.current.draft).toBe("");
    expect(result.current.queue).toHaveLength(0);

    rerender({ id: "a", running: true });
    expect(result.current.draft).toBe("A 的草稿");
    expect(result.current.queue.map((item) => item.text)).toEqual(["排我"]);
  });

  it("切入后台在途会话时不会用旧水位或历史初始化误确认队首", () => {
    const pending = new Promise<void>(() => {});
    stubSend((cmd) => cmd === "session_send" ? pending : null);
    stashSet("b", {
      draft: "",
      queue: [{ id: "b-queued", text: "B queued", atts: [] }],
      atts: [],
    });
    deliverQueued("b", "idle");
    const { result, rerender } = renderHook(
      ({ id, historyLoaded, lastSeq }) => useComposer(id, feed({ historyLoaded, lastSeq })),
      { initialProps: { id: "a", historyLoaded: true, lastSeq: 12 } },
    );

    rerender({ id: "b", historyLoaded: true, lastSeq: 12 });
    rerender({ id: "b", historyLoaded: false, lastSeq: 0 });
    rerender({ id: "b", historyLoaded: true, lastSeq: 7 });

    expect(result.current.queue.map((queued) => queued.id)).toEqual(["b-queued"]);
    expect(result.current.lockedQueueId).toBe("b-queued");
    expect(stashGet("b")?.queue.map((queued) => queued.id)).toEqual(["b-queued"]);
  });

  it("运行中连续发送按 FIFO 追加并生成稳定 id", () => {
    stubSend(() => null);
    const { result } = renderHook(() => useComposer("a", feed({ running: true })));
    act(() => result.current.setDraft("第一条"));
    act(() => {
      result.current.send();
    });
    act(() => result.current.setDraft("第二条"));
    act(() => {
      result.current.send();
    });
    expect(result.current.queue.map((item) => item.text)).toEqual(["第一条", "第二条"]);
    expect(new Set(result.current.queue.map((item) => item.id)).size).toBe(2);
  });

  it("编辑、删除和排序使用稳定 id 并保留附件", async () => {
    stubSend(() => null);
    const { result } = renderHook(() => useComposer("a", feed({ running: true })));
    act(() => result.current.setDraft("A"));
    act(() => result.current.send());
    await act(async () => { await result.current.sendWithFiles("B", []); });
    const [a, b] = result.current.queue;
    act(() => result.current.updateQueueItem(a!.id, "A edited", [{ path: "x.txt", name: "x.txt", isImage: false }]));
    expect(result.current.queue[0]).toMatchObject({ id: a!.id, text: "A edited", atts: [{ path: "x.txt" }] });
    act(() => result.current.moveQueueItem(b!.id, 0));
    expect(result.current.queue.map((item) => item.id)).toEqual([b!.id, a!.id]);
    act(() => result.current.removeQueueItem(b!.id));
    expect(result.current.queue.map((item) => item.id)).toEqual([a!.id]);
  });

  it("发送失败不丢草稿(壳契约 Err ⟺ 未入会话)", async () => {
    stubSend(() => {
      throw new Error("engine down");
    });
    const { result } = renderHook(() => useComposer("a", feed()));
    act(() => result.current.setDraft("要发的话"));
    act(() => {
      result.current.send(); // setDraft 已提交,本 act 里的 send 闭包是新 draft
    });
    expect(result.current.draft).toBe("");
    await waitFor(() => expect(result.current.draft).toBe("要发的话"));
  });

  it("迟到的失败回执 + 已切会话:草稿回原会话留档,不污染当前会话", async () => {
    stubSend(() => {
      throw new Error("engine down");
    });
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed()), {
      initialProps: { id: "a" },
    });
    act(() => result.current.setDraft("迟到的话"));
    act(() => {
      result.current.send();
    });
    rerender({ id: "b" }); // 回执落地前切走
    await waitFor(() => expect(stashGet("a")?.draft).toBe("迟到的话"));
    expect(result.current.draft).toBe("");

    rerender({ id: "a" });
    expect(result.current.draft).toBe("迟到的话");
  });

  it("轮结束自动补投后保持队首可见，帧确认才移除", async () => {
    const calls = stubSend(() => null);
    const { result, rerender } = renderHook(({ running, lastSeq }) => useComposer("a", feed({ running, lastSeq })), {
      initialProps: { running: true, lastSeq: 0 },
    });
    act(() => result.current.setDraft("排队中"));
    act(() => {
      result.current.send();
    });
    rerender({ running: false, lastSeq: 0 });
    await waitFor(() => expect(calls.some((call) =>
      call.cmd === "session_send" && JSON.stringify(call.args).includes(b64encode("排队中")),
    )).toBe(true));
    const id = result.current.queue[0]!.id;
    expect(result.current.lockedQueueId).toBe(id);
    expect(result.current.queue).toHaveLength(1);
    act(() => result.current.removeQueueItem(id));
    expect(result.current.queue).toHaveLength(1);
    rerender({ running: true, lastSeq: 1 });
    expect(result.current.lockedQueueId).toBeNull();
    expect(result.current.queue).toHaveLength(0);
  });
  it("补投中的锁定队首不能被其他项目越过", async () => {
    stubSend(() => null);
    const { result, rerender } = renderHook(({ running, lastSeq }) => useComposer("a", feed({ running, lastSeq })), {
      initialProps: { running: true, lastSeq: 0 },
    });
    for (const text of ["A", "B"]) {
      act(() => result.current.setDraft(text));
      act(() => result.current.send());
    }

    rerender({ running: false, lastSeq: 0 });
    await waitFor(() => expect(result.current.lockedQueueId).toBe(result.current.queue[0]?.id));
    const ids = result.current.queue.map((item) => item.id);
    act(() => result.current.moveQueueItem(ids[1]!, 0));
    expect(result.current.queue.map((item) => item.id)).toEqual(ids);
  });
});

describe("useComposer:排队补投的三道闸", () => {
  const sends = (calls: Array<{ cmd: string; args?: Record<string, unknown> }>) =>
    calls.filter((c) => c.cmd === "session_send");

  it("切会话不把上一个会话的排队消息投进新会话", async () => {
    const calls = stubSend(() => null);
    const { result, rerender } = renderHook(({ id, running }) => useComposer(id, feed({ running })), {
      initialProps: { id: "a", running: true },
    });
    act(() => result.current.setDraft("给 A 的话"));
    act(() => {
      result.current.send(); // running=true → 入单槽
    });
    expect(result.current.queue.map((item) => item.text)).toEqual(["给 A 的话"]);

    // 切到空闲的 b:这一帧里 sessionId 已是 b,而 queued 还是 A 的
    // (留档-恢复 effect 的 setState 要下一次渲染才回流)——补投 effect 与它
    // 同一次提交,不对表就把 A 的话发进了 b
    rerender({ id: "b", running: false });
    await settle();
    expect(sends(calls).filter((c) => c.args?.id === "b")).toHaveLength(0);

    // 消息还在 A 的槽里,切回来照样在
    rerender({ id: "a", running: true });
    expect(result.current.queue.map((item) => item.text)).toEqual(["给 A 的话"]);
  });

  it("首份历史落地前不抢投恢复出来的排队消息(running 还不可信)", async () => {
    const calls = stubSend(() => null);
    stashSet("a", { draft: "", queue: [{ id: "restored", text: "切回来要补投的", atts: [] }], atts: [] });
    const { result, rerender } = renderHook(({ historyLoaded, lastSeq }) => useComposer("a", feed({ historyLoaded, lastSeq })), {
      initialProps: { historyLoaded: false, lastSeq: 0 },
    });
    await settle();
    // 恢复出来了,但会话可能正在后台跑轮:此刻直投必被壳的忙碌守卫拒掉
    expect(result.current.queue.map((item) => item.text)).toEqual(["切回来要补投的"]);
    expect(sends(calls)).toHaveLength(0);

    rerender({ historyLoaded: true, lastSeq: 0 });
    await settle();
    expect(sends(calls)).toHaveLength(1);
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.lockedQueueId).toBe("restored");
    rerender({ historyLoaded: true, lastSeq: 1 });
    expect(result.current.queue).toHaveLength(0);
  });

  it("上行在途(壳已 ack、回显帧未到)时第二条进队列;帧到达才补投", async () => {
    const calls = stubSend(() => null);
    const { result, rerender } = renderHook(({ lastSeq }) => useComposer("a", feed({ lastSeq })), {
      initialProps: { lastSeq: 0 },
    });
    act(() => result.current.setDraft("第一条"));
    act(() => {
      result.current.send(); // 空闲 → 直发
    });
    await settle(); // session_send 已 resolve = 引擎 ack,但回显帧还在路上
    expect(sends(calls)).toHaveLength(1);

    act(() => result.current.setDraft("第二条"));
    act(() => {
      result.current.send();
    });
    // 此前 IPC 一 resolve 就摘在途标记,第二条直发撞壳的忙碌守卫,
    // catch 静默把草稿放回输入框(用户看到"消息自己跳回来了")
    expect(result.current.queue.map((item) => item.text)).toEqual(["第二条"]);
    expect(sends(calls)).toHaveLength(1);

    rerender({ lastSeq: 7 }); // 回显帧到达:这才是"上行已被壳接收"
    await settle();
    expect(sends(calls)).toHaveLength(2);
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.lockedQueueId).toBe(result.current.queue[0]!.id);
    rerender({ lastSeq: 8 });
    expect(result.current.queue).toHaveLength(0);
  });
});

describe("useComposer:共享在途所有权", () => {
  const queued = (id: string, text: string) => ({ id, text, atts: [] });

  it("后台 A 在途时切入会话，锁住 A 且不会并发发送 B", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const calls = stubSend(() => pending);
    stashSet("a", { draft: "", queue: [queued("a", "A"), queued("b", "B")], atts: [] });
    deliverQueued("a", "idle");
    const { result } = renderHook(() => useComposer("a", feed()));
    await settle();
    expect(calls.filter((call) => call.cmd === "session_send")).toHaveLength(1);
    expect(result.current.queue.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.current.lockedQueueId).toBe("a");
    resolve();
  });

  it("活动自动补投 reject 保留队首、解除锁定并显示 ErrorBar 文案", async () => {
    stubSend((cmd) => { if (cmd === "session_send") throw new Error("queue busy"); return null; });
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    act(() => result.current.setDraft("A"));
    act(() => result.current.send());
    rerender({ running: false });
    await waitFor(() => expect(result.current.error).toContain("queue busy"));
    expect(result.current.queue.map((item) => item.text)).toEqual(["A"]);
    expect(result.current.lockedQueueId).toBeNull();
  });

  it("活动补投后视图卸载，迟到 reject 后项目仍在原会话 stash", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => { reject = fail; });
    stubSend(() => pending);
    const hook = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    act(() => hook.result.current.setDraft("不会丢"));
    act(() => hook.result.current.send());
    hook.rerender({ running: false });
    await waitFor(() => expect(hook.result.current.lockedQueueId).not.toBeNull());
    const id = hook.result.current.queue[0]!.id;
    hook.unmount();
    expect(stashGet("a")?.queue.map((item) => item.id)).toEqual([id]);
    reject(new Error("late failure"));
    await settle();
    expect(stashGet("a")?.queue.map((item) => item.id)).toEqual([id]);
  });
});

describe("useComposer:补投失败后的重试", () => {
  it("失败后 running 再也不变,退避重试仍把消息投出去(此前永久卡在 chip 里)", async () => {
    vi.useFakeTimers();
    let broken = true;
    const calls = stubSend((cmd) => {
      if (cmd === "session_send" && broken) throw new Error("engine busy");
      return null;
    });
    const { result, rerender } = renderHook(({ running, lastSeq }) => useComposer("a", feed({ running, lastSeq })), {
      initialProps: { running: true, lastSeq: 0 },
    });
    act(() => result.current.setDraft("排一条"));
    act(() => {
      result.current.send();
    });
    expect(result.current.queue.map((item) => item.text)).toEqual(["排一条"]);

    rerender({ running: false, lastSeq: 0 }); // 轮结束 → 补投 → 壳拒
    await act(async () => {
      await Promise.resolve();
    });
    const sends = () => calls.filter((c) => c.cmd === "session_send").length;
    expect(sends()).toBe(1);
    expect(result.current.queue.map((item) => item.text)).toEqual(["排一条"]); // 失败回队

    // 此后引擎恢复,但**没有任何 running 边沿**(壳一直没接活):
    // 抑制闸只等 running 变化的话,这条消息永远发不出去
    broken = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(sends()).toBe(2);
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.lockedQueueId).toBe(result.current.queue[0]!.id);
    rerender({ running: true, lastSeq: 1 });
    expect(result.current.queue).toHaveLength(0);
  });

  it("取消排队即撤销在途重试(定时器不该把已撤的消息再投一次)", async () => {
    vi.useFakeTimers();
    const calls = stubSend((cmd) => {
      if (cmd === "session_send") throw new Error("engine busy");
      return null;
    });
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    act(() => result.current.setDraft("不要了"));
    act(() => {
      result.current.send();
    });
    rerender({ running: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.filter((c) => c.cmd === "session_send")).toHaveLength(1);

    act(() => result.current.removeQueueItem(result.current.queue[0]!.id));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(calls.filter((c) => c.cmd === "session_send")).toHaveLength(1);
    expect(result.current.queue).toHaveLength(0);
  });
});
describe("useComposer:附件上传的纪元守卫", () => {
  it("上传落地时人已切走:附件归原会话留档,不落进当前 composer", async () => {
    let finish: (v: { path: string }) => void = () => {};
    const pending = new Promise<{ path: string }>((r) => {
      finish = r;
    });
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) => (cmd === "upload_file_path" ? pending : Promise.resolve(null)),
      },
    };
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed()), {
      initialProps: { id: "a" },
    });
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.addPaths(["/proj-a/图.png"]);
    });
    rerender({ id: "b" }); // 大文件上传数秒,期间切走了

    await act(async () => {
      finish({ path: ".monkeycode/uploads/图.png" });
      await done;
    });
    // 落进当前 composer 的话,path 是**旧工作区**的相对路径,发出去读不到
    expect(result.current.atts).toHaveLength(0);
    expect(stashGet("a")?.atts.map((a) => a.path)).toEqual([".monkeycode/uploads/图.png"]);

    rerender({ id: "a" });
    expect(result.current.atts.map((a) => a.path)).toEqual([".monkeycode/uploads/图.png"]);
  });
});

describe("useComposer:guarded generated-file send", () => {
  const image = () => new File([new Uint8Array([1, 2, 3])], "annotated.png", { type: "image/png" });
  const path = ".monkeycode/uploads/annotated.png";
  const installUpload = (fail?: "upload" | "send") => stubSend((cmd) => {
    if (cmd === "upload_begin") {
      if (fail === "upload") throw new Error("disk full");
      return { handle: 7 };
    }
    if (cmd === "upload_finish") return { path };
    if (cmd === "session_send" && fail === "send") throw new Error("engine down");
    return null;
  });

  it("uploads the image and sends feedback with the standard image attachment line", async () => {
    const calls = installUpload();
    const { result } = renderHook(() => useComposer("a", feed()));
    let accepted = false;
    await act(async () => { accepted = await result.current.sendWithFiles("review metadata", [image()]); });
    expect(accepted).toBe(true);
    const send = calls.find((c) => c.cmd === "session_send");
    expect(send?.args).toEqual({
      id: "a",
      ftype: "user-input",
      payload: { content: b64encode(`review metadata\n[图片] ${path}`) },
    });
  });

  it("uploads while running and places the complete payload in the single queue slot", async () => {
    const calls = installUpload();
    const { result } = renderHook(() => useComposer("a", feed({ running: true })));
    let accepted = false;
    await act(async () => { accepted = await result.current.sendWithFiles("queued review", [image()]); });
    expect(accepted).toBe(true);
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.queue[0]).toMatchObject({ text: "queued review", atts: [{ path, name: "annotated.png", isImage: true }] });
    expect(calls.filter((c) => c.cmd === "session_send")).toHaveLength(0);
  });

  it("surfaces upload and send failures and never reports them as accepted", async () => {
    let calls = installUpload("upload");
    let hook = renderHook(() => useComposer("a", feed()));
    let accepted = true;
    await act(async () => { accepted = await hook.result.current.sendWithFiles("review", [image()]); });
    expect(accepted).toBe(false);
    expect(hook.result.current.error).toContain("disk full");
    expect(calls.filter((c) => c.cmd === "session_send")).toHaveLength(0);
    hook.unmount();

    calls = installUpload("send");
    hook = renderHook(() => useComposer("a", feed()));
    await act(async () => { accepted = await hook.result.current.sendWithFiles("review", [image()]); });
    expect(accepted).toBe(false);
    expect(hook.result.current.error).toContain("engine down");
    expect(hook.result.current.draft).toBe("review");
    expect(hook.result.current.atts.map((a) => a.path)).toEqual([path]);
    expect(calls.filter((c) => c.cmd === "session_send")).toHaveLength(1);
  });

  it("does not send an upload that completes after the active session switches", async () => {
    let finish: (value: { path: string }) => void = () => {};
    const pending = new Promise<{ path: string }>((resolve) => { finish = resolve; });
    const calls = stubSend((cmd) => {
      if (cmd === "upload_begin") return { handle: 9 };
      if (cmd === "upload_finish") return pending;
      return null;
    });
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed()), { initialProps: { id: "a" } });
    let sending: Promise<boolean> = Promise.resolve(true);
    act(() => { sending = result.current.sendWithFiles("old-session review", [image()]); });
    await waitFor(() => expect(calls.some((c) => c.cmd === "upload_finish")).toBe(true));
    rerender({ id: "b" });
    let accepted = true;
    await act(async () => { finish({ path }); accepted = await sending; });
    expect(accepted).toBe(false);
    expect(calls.filter((c) => c.cmd === "session_send")).toHaveLength(0);
    expect(stashGet("a")?.draft).toBe("old-session review");
    expect(stashGet("a")?.atts.map((a) => a.path)).toEqual([path]);
  });
});
