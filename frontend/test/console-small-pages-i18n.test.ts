import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const wechatSource = readFileSync(new URL("../src/components/console/wechat-mp-bind-dialog.tsx", import.meta.url), "utf8");
const ideSource = readFileSync(new URL("../src/pages/console/user/ide-ide.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("微信公众号绑定和 IDE 页面使用 i18n key", () => {
  assert.match(wechatSource, /useTranslation/);
  assert.match(wechatSource, /t\("consoleWechatMp\.title"\)/);
  assert.match(ideSource, /useTranslation/);
  assert.match(ideSource, /t\("consoleIde\.comingSoonTitle"\)/);
  assert.doesNotMatch(wechatSource, cjkPattern);
  assert.doesNotMatch(ideSource, cjkPattern);
});

test("微信公众号绑定和 IDE 页面提供中英文资源", () => {
  assert.equal(cn.consoleWechatMp.title, "订阅重要通知");
  assert.equal(en.consoleWechatMp.title, "Subscribe to important notifications");
  assert.equal(cn.consoleIde.openSourceRepository, "开源仓库");
  assert.equal(en.consoleIde.openSourceRepository, "Open source repository");
});
