import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/pages/console/user/terminal.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("控制台终端页面使用 consoleTerminal i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("consoleTerminal\.actions\.reconnect"\)/);
  assert.match(source, /t\("consoleTerminal\.assist\.copyText"/);
  assert.match(source, /t\("consoleTerminal\.alerts\.hostConnectionFailed"\)/);
  assert.match(source, /t\("sharedTerminal\.theme\.label"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("控制台终端页面提供中英文资源", () => {
  assert.equal(cn.consoleTerminal.actions.remoteAssist, "远程协助");
  assert.equal(en.consoleTerminal.actions.remoteAssist, "Remote assistance");
  assert.equal(cn.consoleTerminal.assist.copyConnection, "复制连接信息");
  assert.equal(en.consoleTerminal.assist.copyConnection, "Copy connection info");
  assert.equal(cn.consoleTerminal.alerts.hostConnectionFailed, "无法连接主机");
  assert.equal(en.consoleTerminal.alerts.hostConnectionFailed, "Unable to connect to host");
});
