import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  page: readSource("../src/pages/console/user/git-bots.tsx"),
  tasks: readSource("../src/components/console/git-bot/git-bot-tasks.tsx"),
  config: readSource("../src/components/console/git-bot/git-bot-config.tsx"),
  createDialog: readSource("../src/components/console/git-bot/create-git-bot-dialog.tsx"),
  editDialog: readSource("../src/components/console/git-bot/edit-git-bot-dialog.tsx"),
  permissionDialog: readSource("../src/components/console/git-bot/edit-git-bot-permission-dialog.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Git 审查机器人页面和组件使用 consoleGitBot i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleGitBot\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.page, /t\("consoleGitBot\.tabs\.tasks"\)/);
  assert.match(sourceFiles.tasks, /t\("consoleGitBot\.tasks\.empty"\)/);
  assert.match(sourceFiles.config, /t\("consoleGitBot\.config\.empty"\)/);
  assert.match(sourceFiles.createDialog, /t\("consoleGitBot\.dialog\.createTitle"\)/);
  assert.match(sourceFiles.editDialog, /t\("consoleGitBot\.dialog\.editTitle"\)/);
  assert.match(sourceFiles.permissionDialog, /t\("consoleGitBot\.permission\.title"\)/);
});

test("Git 审查机器人提供中英文资源", () => {
  assert.equal(cn.consoleGitBot.tabs.tasks, "审查任务");
  assert.equal(en.consoleGitBot.tabs.tasks, "Review tasks");
  assert.equal(cn.consoleGitBot.actions.create, "创建审查机器人");
  assert.equal(en.consoleGitBot.actions.create, "Create review bot");
  assert.equal(cn.consoleGitBot.permission.title, "修改查看权限");
  assert.equal(en.consoleGitBot.permission.title, "Edit visibility permissions");
});
