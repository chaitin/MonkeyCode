import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/pages/console/manager/license.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("manager license page uses managerLicense i18n keys", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerLicense\.description"\)/);
  assert.match(source, /t\("managerLicense\.machineCode\.title"\)/);
  assert.match(source, /t\("managerLicense\.toast\.fetchStatusFailed"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("manager license page provides Chinese and English resources", () => {
  assert.equal(cn.managerLicense.description, "查看当前私有化授权状态，复制机器码并导入 license.lic。");
  assert.equal(en.managerLicense.description, "View the current private deployment license status, copy the machine code, and import license.lic.");
  assert.equal(cn.managerLicense.machineCode.title, "机器码");
  assert.equal(en.managerLicense.machineCode.title, "Machine code");
});
