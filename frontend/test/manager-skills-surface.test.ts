import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const navSource = readFileSync(
  new URL("../src/components/manager/nav-teams.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/pages/console/manager/page.tsx", import.meta.url),
  "utf8",
);

test("管理后台挂载 Skills 页面路由和侧边栏入口", () => {
  assert.match(appSource, /TeamManagerSkills/);
  assert.match(appSource, /path="skills"/);
  assert.match(navSource, /to="\/manager\/skills"/);
  assert.match(navSource, />Skills</);
  assert.match(pageSource, /"\/manager\/skills"/);
  assert.match(pageSource, /label: "Skills"/);
});
