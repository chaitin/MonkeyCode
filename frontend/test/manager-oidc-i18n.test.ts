import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/pages/console/manager/oidc.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("manager OIDC page uses managerOidc i18n keys", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerOidc\.title"\)/);
  assert.match(source, /t\("managerOidc\.fields\.enabled"\)/);
  assert.match(source, /t\("managerOidc\.toast\.saved"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("manager OIDC page provides Chinese and English resources", () => {
  assert.equal(cn.managerOidc.title, "企业登录");
  assert.equal(en.managerOidc.title, "Enterprise sign-in");
  assert.equal(cn.managerOidc.fields.enabled, "启用企业登录");
  assert.equal(en.managerOidc.fields.enabled, "Enable enterprise sign-in");
});
