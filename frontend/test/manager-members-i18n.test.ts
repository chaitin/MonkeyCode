import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  page: readSource("../src/pages/console/manager/members.tsx"),
  membersCard: readSource("../src/components/manager/team-members-card.tsx"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("成员管理页面使用 managerMembers i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.page, /t\("managerMembers\.sections\.admins"\)/);
  assert.match(sourceFiles.membersCard, /t\("managerMembers\.title"\)/);
  assert.match(sourceFiles.membersCard, /t\("managerMembers\.actions\.add"\)/);
  assert.match(sourceFiles.membersCard, /t\("managerMembers\.dialogs\.resetPassword\.offlineDescription"/);
  assert.match(sourceFiles.membersCard, /t\("managerMembers\.toast\.invalidEmails"/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("成员管理页面提供中英文资源", () => {
  assert.equal(cn.managerMembers.title, "普通成员");
  assert.equal(en.managerMembers.title, "Members");
  assert.equal(cn.managerMembers.actions.add, "添加成员");
  assert.equal(en.managerMembers.actions.add, "Add members");
  assert.equal(cn.managerMembers.dialogs.resetPassword.confirm, "确认重置");
  assert.equal(en.managerMembers.dialogs.resetPassword.confirm, "Reset password");
});
