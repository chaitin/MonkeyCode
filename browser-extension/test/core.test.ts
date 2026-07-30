// core.ts 纯函数单测:错误码映射 / 退避序列 / hello 帧构造 / op 准入 / URL 白名单。
import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  buildHello,
  checkOpAllowed,
  isAllowedCreateUrl,
  mapDebuggerError,
  normalizePairingCode,
  parseBrowserInfo,
  portCandidates,
} from "../src/core";

describe("mapDebuggerError 错误码映射", () => {
  it("按 lastError 文案映射到协议错误码", () => {
    expect(mapDebuggerError("No tab with given id 42.").code).toBe("no_tab");
    expect(mapDebuggerError("Another debugger is already attached to the tab with id: 42.").code).toBe(
      "debugger_conflict"
    );
    expect(mapDebuggerError("Cannot access a chrome:// URL").code).toBe("restricted_url");
    expect(mapDebuggerError("Cannot attach to this target.").code).toBe("restricted_url");
    expect(mapDebuggerError("Detached while handling command.").code).toBe("detached");
  });

  it("未识别的错误落到 cdp_error 且透传 message", () => {
    const err = mapDebuggerError("Some CDP protocol error");
    expect(err.code).toBe("cdp_error");
    expect(err.message).toBe("Some CDP protocol error");
  });

  it("空 message 也不裂开", () => {
    expect(mapDebuggerError(undefined).code).toBe("cdp_error");
  });
});

describe("backoffDelayMs 重连退避", () => {
  it("1s 起指数翻倍,30s 封顶", () => {
    const seq = [0, 1, 2, 3, 4, 5, 6, 10].map(backoffDelayMs);
    expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it("非法 attempt 按 0 处理", () => {
    expect(backoffDelayMs(-3)).toBe(1000);
  });
});

describe("buildHello hello 帧构造", () => {
  const base = { extId: "abc", extVersion: "0.1.0" };

  it("有 token 时用 token,忽略配对码", () => {
    const frame = buildHello({ ...base, token: "tok-1", code: "AB-CD" });
    expect(frame.event).toBe("hello");
    expect(frame.proto).toBe(1);
    expect(frame.auth).toEqual({ token: "tok-1" });
    expect(frame.ext).toEqual({ id: "abc", version: "0.1.0" });
  });

  it("无 token 时用配对码并归一化(去连字符/空白、大写)", () => {
    const frame = buildHello({ ...base, code: "ab-3d 9f2k" });
    expect(frame.auth).toEqual({ code: "AB3D9F2K" });
  });

  it("附带浏览器自述", () => {
    const frame = buildHello({ ...base, token: "t", browser: { name: "Chrome", version: "126" } });
    expect(frame.browser).toEqual({ name: "Chrome", version: "126" });
  });
});

describe("normalizePairingCode 配对码归一化", () => {
  it("去掉连字符与空白并大写", () => {
    expect(normalizePairingCode(" ab-cd-12 ")).toBe("ABCD12");
    expect(normalizePairingCode("XYZ")).toBe("XYZ");
  });
});

describe("checkOpAllowed 受控准入", () => {
  const controlled = new Set([1, 2]);

  it("cdp/attach/tabs.close 对非受控 tab 拒绝 not_controlled", () => {
    for (const op of ["cdp", "attach", "tabs.close"]) {
      expect(checkOpAllowed(op, 99, controlled)?.code).toBe("not_controlled");
      expect(checkOpAllowed(op, undefined, controlled)?.code).toBe("not_controlled");
    }
  });

  it("受控 tab 放行", () => {
    for (const op of ["cdp", "attach", "tabs.close"]) {
      expect(checkOpAllowed(op, 1, controlled)).toBeNull();
    }
  });

  it("不敏感的 op 不做受控校验", () => {
    for (const op of ["tabs.create", "tabs.list", "tabs.activate", "detach"]) {
      expect(checkOpAllowed(op, 99, controlled)).toBeNull();
    }
  });
});

describe("isAllowedCreateUrl URL 白名单", () => {
  it("http/https/about:blank 放行", () => {
    expect(isAllowedCreateUrl("http://example.com")).toBe(true);
    expect(isAllowedCreateUrl("https://example.com/a?b=1")).toBe(true);
    expect(isAllowedCreateUrl("about:blank")).toBe(true);
  });

  it("特权与非 web 协议拒绝", () => {
    expect(isAllowedCreateUrl("chrome://settings")).toBe(false);
    expect(isAllowedCreateUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedCreateUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedCreateUrl("about:config")).toBe(false);
  });
});

describe("portCandidates 端口候选", () => {
  it("自定义端口独占", () => {
    expect(portCandidates(8080)).toEqual([8080]);
  });

  it("未设置时扫描 7440-7449", () => {
    const ports = portCandidates(null);
    expect(ports).toHaveLength(10);
    expect(ports[0]).toBe(7440);
    expect(ports[9]).toBe(7449);
  });

  it("非法端口回落到扫描", () => {
    expect(portCandidates(0)).toHaveLength(10);
    expect(portCandidates(99999)).toHaveLength(10);
  });
});

describe("parseBrowserInfo 浏览器识别", () => {
  it("Edge 的 UA 也带 Chrome 段,须先判 Edg", () => {
    const ua = "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.61";
    expect(parseBrowserInfo(ua)).toEqual({ name: "Edge", version: "126.0.2592.61" });
  });

  it("Chrome 与未知内核", () => {
    expect(parseBrowserInfo("... Chrome/126.0.0.0 Safari/537.36").name).toBe("Chrome");
    expect(parseBrowserInfo("something else").name).toBe("Chromium");
  });
});
