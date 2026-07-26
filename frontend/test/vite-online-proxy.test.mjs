import assert from "node:assert/strict";
import test from "node:test";

import { resolveOnlineProxyTarget } from "../vite.config.ts";

test("online serve 缺少 TARGET 时立即失败", () => {
  assert.throws(
    () =>
      resolveOnlineProxyTarget({
        command: "serve",
        appEdition: "online",
        target: undefined,
      }),
    /TARGET is required for online preview/,
  );
});

test("online serve 拒绝非 HTTP 协议 TARGET", () => {
  assert.throws(
    () =>
      resolveOnlineProxyTarget({
        command: "serve",
        appEdition: "online",
        target: "file:///tmp/backend",
      }),
    /TARGET must be an absolute HTTP\(S\) URL/,
  );
});

test("online serve 返回规范化的 HTTP TARGET", () => {
  assert.equal(
    resolveOnlineProxyTarget({
      command: "serve",
      appEdition: "online",
      target: "  https://example.com/api  ",
    }),
    "https://example.com/api",
  );
});

test("online build 缺少 TARGET 时保持可用", () => {
  assert.equal(
    resolveOnlineProxyTarget({
      command: "build",
      appEdition: "online",
      target: undefined,
    }),
    undefined,
  );
});
