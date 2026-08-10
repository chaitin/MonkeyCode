// composer 状态机的独立契约测试(此前只被 Composer.test 间接覆盖):
// 切会话留档/恢复、排队单槽、失败不丢草稿、迟到回执的纪元守卫,以及
// 补投三道闸(历史未落地不抢投 / 切会话不投错人 / 上行在途不直发)与
// 失败后的退避重试。
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { b64encode } from "@/lib/protocol/codec";
import { resetStashForTests, stashGet, stashSet } from "./stash";
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
    expect(result.current.queued).toBe("排我");

    rerender({ id: "b", running: false });
    expect(result.current.draft).toBe("");
    expect(result.current.queued).toBeNull();

    rerender({ id: "a", running: true });
    expect(result.current.draft).toBe("A 的草稿");
    expect(result.current.queued).toBe("排我");
  });

  it("排队单槽:后发覆盖先发", () => {
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
    expect(result.current.queued).toBe("第二条");
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

  it("轮结束自动补投排队消息(payload 走 base64)", async () => {
    const calls = stubSend(() => null);
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    act(() => result.current.setDraft("排队中"));
    act(() => {
      result.current.send();
    });
    rerender({ running: false });
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "session_send" && JSON.stringify(c.args).includes(b64encode("排队中")))).toBe(true),
    );
    expect(result.current.queued).toBeNull();
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
    expect(result.current.queued).toBe("给 A 的话");

    // 切到空闲的 b:这一帧里 sessionId 已是 b,而 queued 还是 A 的
    // (留档-恢复 effect 的 setState 要下一次渲染才回流)——补投 effect 与它
    // 同一次提交,不对表就把 A 的话发进了 b
    rerender({ id: "b", running: false });
    await settle();
    expect(sends(calls).filter((c) => c.args?.id === "b")).toHaveLength(0);

    // 消息还在 A 的槽里,切回来照样在
    rerender({ id: "a", running: true });
    expect(result.current.queued).toBe("给 A 的话");
  });

  it("首份历史落地前不抢投恢复出来的排队消息(running 还不可信)", async () => {
    const calls = stubSend(() => null);
    stashSet("a", { draft: "", queued: "切回来要补投的", atts: [] });
    const { result, rerender } = renderHook(({ historyLoaded }) => useComposer("a", feed({ historyLoaded })), {
      initialProps: { historyLoaded: false },
    });
    await settle();
    // 恢复出来了,但会话可能正在后台跑轮:此刻直投必被壳的忙碌守卫拒掉
    expect(result.current.queued).toBe("切回来要补投的");
    expect(sends(calls)).toHaveLength(0);

    rerender({ historyLoaded: true });
    await settle();
    expect(sends(calls)).toHaveLength(1);
    expect(result.current.queued).toBeNull();
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
    expect(result.current.queued).toBe("第二条");
    expect(sends(calls)).toHaveLength(1);

    rerender({ lastSeq: 7 }); // 回显帧到达:这才是"上行已被壳接收"
    await settle();
    expect(sends(calls)).toHaveLength(2);
    expect(result.current.queued).toBeNull();
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
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    act(() => result.current.setDraft("排一条"));
    act(() => {
      result.current.send();
    });
    expect(result.current.queued).toBe("排一条");

    rerender({ running: false }); // 轮结束 → 补投 → 壳拒
    await act(async () => {
      await Promise.resolve();
    });
    const sends = () => calls.filter((c) => c.cmd === "session_send").length;
    expect(sends()).toBe(1);
    expect(result.current.queued).toBe("排一条"); // 失败回队

    // 此后引擎恢复,但**没有任何 running 边沿**(壳一直没接活):
    // 抑制闸只等 running 变化的话,这条消息永远发不出去
    broken = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(sends()).toBe(2);
    expect(result.current.queued).toBeNull();
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

    act(() => result.current.clearQueued());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(calls.filter((c) => c.cmd === "session_send")).toHaveLength(1);
    expect(result.current.queued).toBeNull();
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
