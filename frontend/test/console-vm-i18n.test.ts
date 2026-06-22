import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  terminalConnection: readSource("../src/components/console/terminal-connection-dialog.tsx"),
  portForward: readSource("../src/components/console/vm/vm-port-forward.tsx"),
  renew: readSource("../src/components/console/vm/vm-renew.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("终端连接和 VM 弹窗使用 consoleVm i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleVm\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.terminalConnection, /t\("consoleVm\.connection\.title"\)/);
  assert.match(sourceFiles.portForward, /t\("consoleVm\.port\.title"\)/);
  assert.match(sourceFiles.renew, /t\("consoleVm\.renew\.title"\)/);
});

test("终端连接和 VM 弹窗提供中英文资源", () => {
  assert.equal(cn.consoleVm.connection.title, "选择终端连接");
  assert.equal(en.consoleVm.connection.title, "Select terminal connection");
  assert.equal(cn.consoleVm.port.title, "端口管理");
  assert.equal(en.consoleVm.port.title, "Port management");
  assert.equal(cn.consoleVm.renew.confirm, "确认续期");
  assert.equal(en.consoleVm.renew.confirm, "Renew");
});
