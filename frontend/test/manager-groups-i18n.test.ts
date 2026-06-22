import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/components/manager/team-groups-card.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("成员分组卡片使用 managerGroups i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("managerGroups\.title"\)/);
  assert.match(source, /t\("managerGroups\.actions\.add"\)/);
  assert.match(source, /t\("managerGroups\.dialogs\.delete\.description"/);
  assert.match(source, /t\("managerGroups\.members\.selectedMany"/);
  assert.doesNotMatch(source, cjkPattern);
});

test("成员分组卡片提供中英文资源", () => {
  assert.equal(cn.managerGroups.title, "分组");
  assert.equal(en.managerGroups.title, "Groups");
  assert.equal(cn.managerGroups.actions.add, "添加分组");
  assert.equal(en.managerGroups.actions.add, "Add group");
  assert.equal(cn.managerGroups.dialogs.delete.confirm, "确认删除");
  assert.equal(en.managerGroups.dialogs.delete.confirm, "Delete");
  assert.equal(cn.managerShell.common.close, "关闭");
  assert.equal(en.managerShell.common.close, "Close");
});
