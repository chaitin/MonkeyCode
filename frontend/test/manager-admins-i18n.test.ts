import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/pages/console/manager/manager.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("管理员管理页面使用 managerAdmins i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerAdmins\.title"\)/);
  assert.match(source, /t\("managerAdmins\.actions\.add"\)/);
  assert.match(source, /t\("managerAdmins\.dialogs\.add\.title"\)/);
  assert.match(source, /t\("managerAdmins\.dialogs\.resetPassword\.offlineDescription"/);
  assert.match(source, /t\("managerAdmins\.toast\.resetEmailSent"/);
  assert.doesNotMatch(source, cjkPattern);
});

test("管理员管理页面提供中英文资源", () => {
  assert.equal(cn.managerAdmins.title, "管理员");
  assert.equal(en.managerAdmins.title, "Admins");
  assert.equal(cn.managerAdmins.actions.add, "添加管理员");
  assert.equal(en.managerAdmins.actions.add, "Add admin");
  assert.equal(cn.managerAdmins.dialogs.resetPassword.confirm, "确认重置");
  assert.equal(en.managerAdmins.dialogs.resetPassword.confirm, "Reset password");
});
