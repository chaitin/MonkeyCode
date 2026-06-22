import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  checkin: readSource("../src/components/console/nav/nav-checkin.tsx"),
  invite: readSource("../src/components/console/nav/nav-invite.tsx"),
  essay: readSource("../src/components/console/nav/nav-essay.tsx"),
  freeModelUsage: readSource("../src/components/console/nav/free-model-usage-indicator.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("侧边栏在线权益入口使用 consoleShell rewards i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleShell\.rewards\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.checkin, /t\("consoleShell\.rewards\.checkin\.label"\)/);
  assert.match(sourceFiles.invite, /t\("consoleShell\.rewards\.invite\.title"\)/);
  assert.match(sourceFiles.essay, /t\("consoleShell\.rewards\.essay\.label"\)/);
  assert.match(sourceFiles.freeModelUsage, /t\("consoleShell\.rewards\.quota\.freeQuota"\)/);
});

test("侧边栏在线权益入口提供中英文资源", () => {
  assert.equal(cn.consoleShell.rewards.checkin.label, "签到领积分");
  assert.equal(en.consoleShell.rewards.checkin.label, "Check in for credits");
  assert.equal(cn.consoleShell.rewards.invite.title, "邀请注册赚积分");
  assert.equal(en.consoleShell.rewards.invite.title, "Invite users for credits");
  assert.equal(cn.consoleShell.rewards.quota.freeQuota, "免费额度");
  assert.equal(en.consoleShell.rewards.quota.freeQuota, "Free quota");
});
