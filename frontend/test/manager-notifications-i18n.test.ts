import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/components/manager/team-notifications.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("团队通知组件使用 managerNotifications i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerNotifications\.title"\)/);
  assert.match(source, /t\("managerNotifications\.actions\.addReceiver"\)/);
  assert.match(source, /t\("managerNotifications\.receiverTypes\.dingtalk"\)/);
  assert.match(source, /t\("managerNotifications\.toast\.loadChannelsFailed"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("团队通知组件提供中英文资源", () => {
  assert.equal(cn.managerNotifications.title, "消息通知");
  assert.equal(en.managerNotifications.title, "Notifications");
  assert.equal(cn.managerNotifications.actions.addReceiver, "添加接收端");
  assert.equal(en.managerNotifications.actions.addReceiver, "Add receiver");
  assert.equal(cn.managerNotifications.receiverTypes.dingtalk, "钉钉机器人");
  assert.equal(en.managerNotifications.receiverTypes.dingtalk, "DingTalk bot");
});
