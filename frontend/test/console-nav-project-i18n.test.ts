import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/components/console/nav/nav-project.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("项目导航使用 navProject i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("navProject\.emptyProject"\)/);
  assert.match(source, /t\("navProject\.actions\.startTask"\)/);
  assert.match(source, /t\("navProject\.deleteTask\.title"\)/);
  assert.match(source, /t\("navProject\.stopTask\.title"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("项目导航提供中英文资源", () => {
  assert.equal(cn.navProject.emptyProject, "空项目");
  assert.equal(en.navProject.emptyProject, "Unlinked tasks");
  assert.equal(cn.navProject.actions.startTask, "启动任务");
  assert.equal(en.navProject.actions.startTask, "Start task");
  assert.equal(cn.navProject.deleteTask.confirm, "删除任务");
  assert.equal(en.navProject.deleteTask.confirm, "Delete task");
});
