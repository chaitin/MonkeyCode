import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const tasksSource = readFileSync(
  new URL("../src/pages/console/user/tasks.tsx", import.meta.url),
  "utf8",
);

test("console tasks 页面使用 i18n key 渲染主要文案", () => {
  assert.match(tasksSource, /useTranslation/);
  assert.match(tasksSource, /t\("consoleTasks\.title"\)/);
  assert.match(tasksSource, /t\("consoleTasks\.toast\.deleted"\)/);
  assert.match(tasksSource, /t\("consoleTasks\.hover\.taskName"\)/);
  assert.match(tasksSource, /t\("consoleTasks\.status\.processing"\)/);
  assert.match(tasksSource, /t\("consoleTasks\.dialog\.delete\.description"/);
  assert.match(tasksSource, /taskName:/);
});

test("console tasks 翻译资源提供中英文文案", () => {
  assert.equal(cn.consoleTasks.title, "MonkeyCode 智能任务");
  assert.equal(en.consoleTasks.title, "MonkeyCode AI Tasks");
  assert.equal(cn.consoleTasks.dialog.delete.confirming, "删除中...");
  assert.equal(en.consoleTasks.dialog.delete.confirming, "Deleting...");
  assert.equal(cn.consoleTasks.dialog.stop.description, "确定要终止任务「{{taskName}}」吗？任务终止后无法恢复。");
  assert.equal(en.consoleTasks.dialog.stop.description, "Stop task \"{{taskName}}\"? This action cannot be restored.");
});
