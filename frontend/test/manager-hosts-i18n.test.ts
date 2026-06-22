import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/pages/console/manager/hosts.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("宿主机管理页面使用 managerHosts i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerHosts\.policy\.title"\)/);
  assert.match(source, /t\("managerHosts\.hosts\.title"\)/);
  assert.match(source, /t\("managerHosts\.bind\.title"\)/);
  assert.match(source, /t\("managerHosts\.toast\.fetchHostsFailed"/);
  assert.doesNotMatch(source, cjkPattern);
});

test("宿主机管理页面提供中英文资源", () => {
  assert.equal(cn.managerHosts.policy.title, "任务策略");
  assert.equal(en.managerHosts.policy.title, "Task policy");
  assert.equal(cn.managerHosts.hosts.title, "开发环境宿主机");
  assert.equal(en.managerHosts.hosts.title, "Development environment hosts");
  assert.equal(cn.managerHosts.bind.title, "绑定宿主机");
  assert.equal(en.managerHosts.bind.title, "Bind host");
});
