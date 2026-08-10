// openPipe 原语:「监听先于命令」铁律、事件路由、close 幂等、open 失败撤监听。
import { afterEach, describe, expect, it, vi } from "vitest";

import { openPipe } from "./pipes";

afterEach(() => vi.unstubAllGlobals());

function stubShell(openResult: () => Promise<unknown> = () => Promise.resolve("ok")) {
  const log: string[] = []; // 时序日志:listen/invoke 交错顺序的证据
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  const offs: string[] = [];
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  vi.stubGlobal("window", {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          log.push(`invoke:${cmd}`);
          calls.push({ cmd, args });
          if (cmd === "cloud_ws_open") return openResult();
          return Promise.resolve(null);
        },
      },
      event: {
        listen: (name: string, cb: (e: { payload: unknown }) => void) => {
          log.push(`listen:${name.split(":")[0]}`);
          handlers.set(name, cb);
          return Promise.resolve(() => {
            offs.push(name);
          });
        },
      },
    },
  });
  return { log, handlers, offs, calls };
}

describe("openPipe", () => {
  it("先注册 ws-msg/ws-closed 监听再 invoke cloud_ws_open;pipe id 一致", async () => {
    const shell = stubShell();
    const texts: string[] = [];
    await openPipe("stream", "t1", { mode: "attach" }, (text) => texts.push(text), () => {});
    expect(shell.log).toEqual(["listen:ws-msg", "listen:ws-closed", "invoke:cloud_ws_open"]);
    const open = shell.calls.find((c) => c.cmd === "cloud_ws_open")!;
    expect(open.args).toMatchObject({ kind: "stream", id: "t1", params: { mode: "attach" } });
    const pipe = open.args!.pipe as string;
    expect([...shell.handlers.keys()]).toEqual([`ws-msg:${pipe}`, `ws-closed:${pipe}`]);
    // 下行帧路由
    shell.handlers.get(`ws-msg:${pipe}`)!({ payload: '{"type":"ping"}' });
    expect(texts).toEqual(['{"type":"ping"}']);
  });

  it("ws-closed 带原因回调一次并撤监听;close() 幂等且发 cloud_ws_close", async () => {
    const shell = stubShell();
    const closes: unknown[] = [];
    const conn = await openPipe("control", "t1", {}, () => {}, (info) => closes.push(info));
    const pipe = shell.calls[0]!.args!.pipe as string;
    shell.handlers.get(`ws-closed:${pipe}`)!({ payload: { code: 1000, reason: "bye" } });
    shell.handlers.get(`ws-closed:${pipe}`)!({ payload: null }); // 第二次:已关,不再回调
    expect(closes).toEqual([{ code: 1000, reason: "bye" }]);
    expect(shell.offs).toEqual([`ws-msg:${pipe}`, `ws-closed:${pipe}`]);
    conn.close(); // 事件已关:不再发 cloud_ws_close
    expect(shell.calls.filter((c) => c.cmd === "cloud_ws_close")).toHaveLength(0);
  });

  it("主动 close():发 cloud_ws_close,后续 ws-closed 不再回调", async () => {
    const shell = stubShell();
    const closes: unknown[] = [];
    const conn = await openPipe("terminal", "vm1", { terminal_id: "t" }, () => {}, (info) => closes.push(info));
    const pipe = shell.calls[0]!.args!.pipe as string;
    conn.close();
    conn.close(); // 幂等
    expect(shell.calls.filter((c) => c.cmd === "cloud_ws_close")).toHaveLength(1);
    shell.handlers.get(`ws-closed:${pipe}`)!({ payload: null });
    expect(closes).toEqual([]);
    // send 透传 cloud_ws_send
    await conn.send("x").catch(() => {});
    expect(shell.calls.at(-1)).toMatchObject({ cmd: "cloud_ws_send", args: { pipe, text: "x" } });
  });

  it("open 失败:reject 并撤掉两个监听", async () => {
    const shell = stubShell(() => Promise.reject(new Error("会话缺失")));
    await expect(openPipe("stream", "t1", {}, () => {}, () => {})).rejects.toThrow("会话缺失");
    expect(shell.offs).toHaveLength(2);
  });
});
