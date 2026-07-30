import { describe, expect, it } from "vitest";

import { sessionIdFromUiIntent } from "./host";

describe("sessionIdFromUiIntent", () => {
  it("解析桌宠打开会话意图", () => {
    expect(sessionIdFromUiIntent("open-session:session-1")).toBe("session-1");
  });

  it("忽略设置、空目标和缺失意图", () => {
    expect(sessionIdFromUiIntent("open-settings")).toBeNull();
    expect(sessionIdFromUiIntent("open-session:")).toBeNull();
    expect(sessionIdFromUiIntent(null)).toBeNull();
  });
});
