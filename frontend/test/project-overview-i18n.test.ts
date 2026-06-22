import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const files = [
  "../src/pages/console/user/project/overview/index.tsx",
  "../src/pages/console/user/project/overview/info-tab.tsx",
  "../src/pages/console/user/project/overview/issues-tab.tsx",
  "../src/pages/console/user/project/overview/tasks-tab.tsx",
];
const sources = files.map((file) => readFileSync(new URL(file, import.meta.url), "utf8"));
const combinedSource = sources.join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

test("项目 overview 页面使用 projectOverview i18n key", () => {
  assert.match(combinedSource, /useTranslation/);
  assert.match(combinedSource, /t\("projectOverview\.tabs\.info"\)/);
  assert.match(combinedSource, /t\("projectOverview\.issues\.create"\)/);
  assert.match(combinedSource, /t\("projectOverview\.tasks\.delete\.title"\)/);
  assert.match(combinedSource, /t\("projectOverview\.info\.loading"\)/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("项目 overview 页面提供中英文资源", () => {
  assert.equal(cn.projectOverview.tabs.info, "信息");
  assert.equal(en.projectOverview.tabs.info, "Info");
  assert.equal(cn.projectOverview.tasks.emptyTitle, "暂无任务");
  assert.equal(en.projectOverview.tasks.emptyTitle, "No tasks");
  assert.equal(cn.projectOverview.issues.create, "创建需求");
  assert.equal(en.projectOverview.issues.create, "Create issue");
});
