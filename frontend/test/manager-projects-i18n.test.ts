import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/pages/console/manager/projects.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("manager projects page uses managerProjects i18n keys", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerProjects\.title"\)/);
  assert.match(source, /t\("managerProjects\.columns\.project"\)/);
  assert.match(source, /t\("managerProjects\.toast\.fetchFailed"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("manager projects page provides Chinese and English resources", () => {
  assert.equal(cn.managerProjects.title, "项目");
  assert.equal(en.managerProjects.title, "Projects");
  assert.equal(cn.managerProjects.columns.project, "项目");
  assert.equal(en.managerProjects.columns.project, "Project");
});
