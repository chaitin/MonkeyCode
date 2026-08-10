// stash/deliverQueued 状态机契约(对标旧 useSession.test 的排队场景子集)。
// 壳契约:session_send Err ⟺ 消息未入会话,回栈安全、不会双发。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { b64encode } from "@/lib/protocol/codec";
import {
  bindActiveComposer,
  deliverQueued,
  dropStash,
  resetStashForTests,
  stashGet,
  stashSet,
} from "./stash";

function stubSend(impl: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        try {
          return Promise.resolve(impl(cmd, args));
        } catch (e) {
          return Promise.reject(e);
        }
      },
    },
  };
  return calls;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetStashForTests();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("stash 留档", () => {
  it("全空即清条目;dropStash 清档", () => {
    stashSet("a", { draft: "x", queued: null, atts: [] });
    expect(stashGet("a")?.draft).toBe("x");
    stashSet("a", { draft: "", queued: null, atts: [] });
    expect(stashGet("a")).toBeUndefined();
    stashSet("b", { draft: "", queued: "q", atts: [] });
    dropStash("b");
    expect(stashGet("b")).toBeUndefined();
  });
});

describe("deliverQueued 后台补投", () => {
  it("轮未结束(running/created)不投;现场会话不投", () => {
    const calls = stubSend(() => null);
    stashSet("a", { draft: "", queued: "排着的", atts: [] });
    deliverQueued("a", "running");
    deliverQueued("a", "created");
    const off = bindActiveComposer("a", () => false);
    deliverQueued("a", "idle");
    off();
    expect(calls).toHaveLength(0);
    expect(stashGet("a")?.queued).toBe("排着的");
  });

  it("轮结束:乐观出栈直投,成功回调;draft/atts 留档不动", async () => {
    const calls = stubSend(() => null);
    stashSet("a", { draft: "草稿", queued: "排着的", atts: [{ path: "p.png", name: "p.png", isImage: true }] });
    const delivered = vi.fn();
    deliverQueued("a", "idle", delivered);
    expect(stashGet("a")?.queued).toBeNull(); // 乐观出栈
    await flush();
    expect(calls[0]).toEqual({ cmd: "session_send", args: { id: "a", ftype: "user-input", payload: { content: b64encode("排着的") } } });
    expect(delivered).toHaveBeenCalledWith("a", "排着的");
    expect(stashGet("a")?.draft).toBe("草稿");
    expect(stashGet("a")?.atts).toHaveLength(1);
  });

  it("投递失败回栈;在途期间暂存了新排队则让位(单槽后发优先)", async () => {
    stubSend(() => {
      throw new Error("busy");
    });
    stashSet("a", { draft: "", queued: "旧消息", atts: [] });
    deliverQueued("a", "idle");
    await flush();
    expect(stashGet("a")?.queued).toBe("旧消息"); // 失败回栈

    // 第二轮:失败在途期间又暂存了新排队 → 旧的让位
    deliverQueued("a", "idle");
    stashSet("a", { draft: "", queued: "新消息", atts: [] });
    await flush();
    expect(stashGet("a")?.queued).toBe("新消息");
  });

  it("投递失败且人已切进来:回活动队列槽,不回暂存", async () => {
    stubSend(() => {
      throw new Error("busy");
    });
    stashSet("a", { draft: "", queued: "排着的", atts: [] });
    deliverQueued("a", "idle");
    const requeue = vi.fn().mockReturnValue(true);
    bindActiveComposer("a", requeue); // 补投在途中切进来
    await flush();
    expect(requeue).toHaveBeenCalledWith("排着的");
    expect(stashGet("a")).toBeUndefined();
  });
});
