import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const pageSource = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);
const chatInputSource = readFileSync(
  new URL("../src/components/console/task/chat-inputbox.tsx", import.meta.url),
  "utf8",
);

test("任务详情预览弹窗支持确认后填入发布指令", () => {
  assert.match(chatInputSource, /export interface TaskChatInputBoxHandle/);
  assert.match(chatInputSource, /requestPublishWebsite: \(\) => void/);
  assert.match(chatInputSource, /React\.useImperativeHandle\(ref/);
  assert.match(chatInputSource, /setContent\(t\("taskDetail\.chat\.commands\.publishPrompt"\)\)/);
  assert.doesNotMatch(chatInputSource, /taskDetail\.chat\.commands\.publishWebsite/);
  assert.doesNotMatch(chatInputSource, /taskDetail\.chat\.commands\.publishWebsiteDescription/);

  assert.match(pageSource, /TaskChatInputBoxHandle/);
  assert.match(pageSource, /chatInputRef/);
  assert.match(pageSource, /publishConfirmDialogOpen/);
  assert.match(pageSource, /chatInputRef\.current\?\.requestPublishWebsite\(\)/);
  assert.match(pageSource, /t\("taskDetail\.page\.dialogs\.publishWebsite\.description"\)/);
  assert.match(pageSource, /t\("taskDetail\.page\.dialogs\.publishWebsite\.confirm"\)/);

  const panelButtonGroupMatch = pageSource.match(
    /<IconTerminal2[\s\S]*?t\("taskDetail\.panels\.preview"\)[\s\S]*?<IconUpload[\s\S]*?t\("taskDetail\.page\.dialogs\.publishWebsite\.button"\)[\s\S]*?<\/div>/,
  );
  assert.ok(panelButtonGroupMatch, "publish button should sit next to terminal, files, and preview controls");

  const previewDialogMatch = pageSource.match(
    /<Dialog open=\{previewDialogOpen\}[\s\S]*?<\/Dialog>/,
  );
  assert.ok(previewDialogMatch, "preview dialog should be present");
  assert.doesNotMatch(
    previewDialogMatch[0],
    /taskDetail\.page\.dialogs\.publishWebsite\.button/,
    "publish button should not be inside the preview dialog",
  );
});

test("任务详情预览发布确认提供中英文资源", () => {
  assert.equal(cn.taskDetail.page.dialogs.publishWebsite.button, "发布");
  assert.equal(en.taskDetail.page.dialogs.publishWebsite.button, "Publish");
  assert.equal(
    cn.taskDetail.page.dialogs.publishWebsite.description,
    "发布会将当前任务所作的 Web 应用打包发布到 MonkeyCode 作品集，发布后将可以公开访问。",
  );
  assert.equal(
    en.taskDetail.page.dialogs.publishWebsite.description,
    "This will package the web app from the current task and publish it to the MonkeyCode portfolio. It will be publicly accessible after publishing.",
  );
});
