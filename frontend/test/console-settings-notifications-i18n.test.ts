import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";
import { shouldShowWechatMp } from "../src/utils/wechat-mp.ts";

const source = readFileSync(
  new URL("../src/components/console/settings/notifications.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("设置通知页面使用 consoleSettings notifications i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /consoleSettings\.notifications\./);
  assert.doesNotMatch(source, cjkPattern);
});

test("设置通知页面提供中英文资源", () => {
  assert.equal(cn.consoleSettings.notifications.title, "消息通知");
  assert.equal(en.consoleSettings.notifications.title, "Notifications");
  assert.equal(cn.consoleSettings.notifications.actions.addReceiver, "添加接收端");
  assert.equal(en.consoleSettings.notifications.actions.addReceiver, "Add receiver");
  assert.equal(cn.consoleSettings.notifications.remove.description, "确定要移除接收端 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.consoleSettings.notifications.remove.description, "Remove receiver \"{{name}}\"? This action cannot be undone.");
});

test("海外 SaaS 隐藏微信公众号绑定并保留企业微信机器人", () => {
  assert.match(source, /useAppRuntime/);
  assert.match(
    source,
    /const showWechatMp = shouldShowWechatMp\(IS_ONLINE_EDITION, serverConfig\?\.region\)/,
  );
  assert.match(source, /\{showWechatMp && wechatMpStatusCard\}/);
  assert.match(
    source,
    /\{showWechatMp && \([\s\S]*<WechatMpBindDialog[\s\S]*open=\{wechatMpUnbindDialogOpen\}[\s\S]*\n\s{6}\)\}/,
  );
  assert.match(source, /value: "wechat_work"/);
});

test("微信公众号绑定仅在国内在线版显示", () => {
  assert.equal(shouldShowWechatMp(true, "cn"), true);
  assert.equal(shouldShowWechatMp(true, "global"), false);
  assert.equal(shouldShowWechatMp(true, undefined), false);
  assert.equal(shouldShowWechatMp(false, "cn"), false);
});
