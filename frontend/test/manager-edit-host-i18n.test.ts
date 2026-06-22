import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/components/manager/edit-host.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("edit host dialog uses managerHosts i18n keys", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerHosts\.edit\.title"\)/);
  assert.match(source, /t\("managerHosts\.groups\.select"\)/);
  assert.match(source, /t\("managerHosts\.toast\.groupFetchFailedWithMessage"/);
  assert.doesNotMatch(source, cjkPattern);
});

test("edit host dialog provides Chinese and English resources", () => {
  assert.equal(cn.managerHosts.edit.title, "修改宿主机");
  assert.equal(en.managerHosts.edit.title, "Edit host");
  assert.equal(cn.managerHosts.groups.select, "请选择分组");
  assert.equal(en.managerHosts.groups.select, "Select groups");
});
