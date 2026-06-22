import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/pages/shared-terminal.tsx", import.meta.url), "utf8");

test("共享终端页面使用 sharedTerminal i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("sharedTerminal\.status\.connecting"\)/);
  assert.match(source, /t\("sharedTerminal\.password\.title"\)/);
  assert.match(source, /t\("sharedTerminal\.theme\.label"\)/);
});

test("共享终端页面提供中英文资源", () => {
  assert.equal(cn.sharedTerminal.status.connecting, "正在连接");
  assert.equal(en.sharedTerminal.status.connecting, "Connecting");
  assert.equal(cn.sharedTerminal.password.title, "输入连接密码");
  assert.equal(en.sharedTerminal.password.title, "Enter connection password");
});
