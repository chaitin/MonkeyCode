import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  overview: readSource("../src/pages/console/manager/overview.tsx"),
  rangeTabs: readSource("../src/components/manager/dashboard/time-range-tabs.tsx"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("管理后台概览页使用 managerOverview i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.overview, /t\("managerOverview\.title"\)/);
  assert.match(sourceFiles.overview, /t\("managerOverview\.taskStats\.title"\)/);
  assert.match(sourceFiles.overview, /t\("managerOverview\.metrics\.tasks\.title"\)/);
  assert.match(sourceFiles.rangeTabs, /t\("managerOverview\.ranges\.today"\)/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("管理后台概览页提供中英文资源", () => {
  assert.equal(cn.managerOverview.title, "团队管理仪表盘");
  assert.equal(en.managerOverview.title, "Team dashboard");
  assert.equal(cn.managerOverview.taskStats.title, "任务统计");
  assert.equal(en.managerOverview.taskStats.title, "Task statistics");
  assert.equal(cn.managerOverview.ranges.today, "今日");
  assert.equal(en.managerOverview.ranges.today, "Today");
});
