import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  listPage: readSource("../src/components/manager/manager-list-page.tsx"),
  conversations: readSource("../src/pages/console/manager/conversations.tsx"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("对话管理页面使用 managerConversations i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.listPage, /t\("managerList\.count"/);
  assert.match(sourceFiles.conversations, /t\("managerConversations\.title"\)/);
  assert.match(sourceFiles.conversations, /t\("managerConversations\.columns\.input"\)/);
  assert.match(sourceFiles.conversations, /t\("managerConversations\.empty\.description"\)/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("对话管理页面提供中英文资源", () => {
  assert.equal(cn.managerConversations.title, "对话");
  assert.equal(en.managerConversations.title, "Conversations");
  assert.equal(cn.managerConversations.columns.input, "用户输入");
  assert.equal(en.managerConversations.columns.input, "User input");
  assert.equal(cn.managerList.count, " · 当前 {{count}} 条");
  assert.equal(en.managerList.count, " · {{count}} items");
});
