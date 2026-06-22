import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/pages/console/manager/tasks.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("manager tasks page uses managerTasks i18n keys", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerTasks\.title"\)/);
  assert.match(source, /t\("managerTasks\.status\.pending"\)/);
  assert.match(source, /t\("managerTasks\.kind\.develop"\)/);
  assert.match(source, /t\("managerTasks\.toast\.fetchFailed"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("manager tasks page provides Chinese and English resources", () => {
  assert.equal(cn.managerTasks.title, "任务");
  assert.equal(en.managerTasks.title, "Tasks");
  assert.equal(cn.managerTasks.status.pending, "准备中");
  assert.equal(en.managerTasks.status.pending, "Pending");
});
