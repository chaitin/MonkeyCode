// 终端管道:上/下行帧编码、terminal_id 复用优先、连接参数。
import { describe, expect, it } from "vitest";

import { b64decode } from "@/lib/protocol/codec";
import type { CloudPipe, OpenPipe } from "./pipes";
import { connectCloudTerminal, parseTermFrame, pickTerminalId, TERM_PING_MS, termBytes, termUplink } from "./terminal";

describe("终端帧编解码", () => {
  it("上行:data=base64(输入)、resize=JSON{row,col}、ping", () => {
    const data = JSON.parse(termUplink.data("ls -la\n")) as { type: string; data: string };
    expect(data.type).toBe("data");
    expect(b64decode(data.data)).toBe("ls -la\n");
    expect(JSON.parse(termUplink.resize(24, 80))).toEqual({ type: "resize", data: '{"row":24,"col":80}' });
    expect(JSON.parse(termUplink.ping())).toEqual({ type: "ping" });
    expect(TERM_PING_MS).toBe(5000);
  });

  it("下行:data 帧 base64 → 字节;坏帧返回 null", () => {
    expect([...termBytes("aGk=")]).toEqual([104, 105]); // "hi"
    expect(parseTermFrame('{"type":"connected"}')).toEqual({ type: "connected" });
    expect(parseTermFrame("not json")).toBeNull();
    expect(parseTermFrame('"bare"')).toBeNull();
  });

  it("下行:坏 base64 返回空字节(脏帧丢弃,不抛未捕获异常)", () => {
    // 与 parseTermFrame 同一容错契约:裸 atob 抛 InvalidCharacterError 会沿
    // Tauri listen 派发链变成全局错误,把终端画成整屏「启动异常」面板
    expect([...termBytes("!!bad!!")]).toEqual([]);
    expect([...termBytes("aGk")]).toEqual([104, 105]); // 无填充仍可解
  });
});

describe("pickTerminalId", () => {
  it("复用已有会话的第一个 id", async () => {
    const id = await pickTerminalId("vm1", async () => ({ terminals: [{ id: "t-1" }, { id: "t-2" }] }));
    expect(id).toBe("t-1");
  });

  it("列表为空/拉取失败:新建 uuid", async () => {
    const fresh = await pickTerminalId("vm1", async () => ({ terminals: [] }));
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    const fallback = await pickTerminalId("vm1", async () => {
      throw new Error("network");
    });
    expect(fallback).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("connectCloudTerminal", () => {
  it("按 kind=terminal, id=vmId, params.terminal_id 开管道", async () => {
    const seen: unknown[] = [];
    const fake: OpenPipe = (kind, id, params) => {
      seen.push([kind, id, params]);
      const pipe: CloudPipe = { send: () => Promise.resolve(), close: () => {} };
      return Promise.resolve(pipe);
    };
    await connectCloudTerminal("vm-9", "term-3", { onText: () => {}, onClose: () => {} }, fake);
    expect(seen).toEqual([["terminal", "vm-9", { terminal_id: "term-3" }]]);
  });
});
