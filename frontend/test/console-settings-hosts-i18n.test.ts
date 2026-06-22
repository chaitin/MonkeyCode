import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/components/console/settings/hosts.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("设置宿主机页面使用 consoleSettings hosts i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /consoleSettings\.hosts\./);
  assert.doesNotMatch(source, cjkPattern);
});

test("设置宿主机页面提供中英文资源", () => {
  assert.equal(cn.consoleSettings.hosts.title, "开发环境宿主机");
  assert.equal(en.consoleSettings.hosts.title, "Development environment hosts");
  assert.equal(cn.consoleSettings.hosts.actions.bind, "绑定");
  assert.equal(en.consoleSettings.hosts.actions.bind, "Bind");
  assert.equal(cn.consoleSettings.hosts.remove.description, "确定要移除宿主机 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.consoleSettings.hosts.remove.description, "Remove host \"{{name}}\"? This action cannot be undone.");
});
