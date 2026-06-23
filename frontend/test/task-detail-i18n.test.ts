import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  chatInput: readSource("../src/components/console/task/chat-inputbox.tsx"),
  messageToolcall: readSource("../src/components/console/task/message-toolcall.tsx"),
  fileExplorer: readSource("../src/components/console/task/task-file-explorer.tsx"),
  fileActions: readSource("../src/components/console/task/file-actions-dropdown.tsx"),
  fileDownload: readSource("../src/components/console/task/file-download-dialog.tsx"),
  terminalPanel: readSource("../src/components/console/task/task-terminal-panel.tsx"),
  messageList: readSource("../src/components/console/task/task-message-virtual-list.tsx"),
  attachmentPreview: readSource("../src/components/console/task/task-attachment-preview-dialog.tsx"),
  chatSection: readSource("../src/components/console/task/task-chat-section.tsx"),
  rounds: readSource("../src/components/console/task/task-rounds.ts"),
  userInputIndex: readSource("../src/components/console/task/task-user-input-index.tsx"),
  messageHandler: readSource("../src/components/console/task/task-message-handler.ts"),
};

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("任务详情核心组件使用 taskDetail i18n key", () => {
  assert.match(sourceFiles.chatInput, /useTranslation/);
  assert.match(sourceFiles.chatInput, /t\("taskDetail\.chat\.placeholder\.idle"\)/);
  assert.match(sourceFiles.chatInput, /t\("taskDetail\.chat\.quickInputs\.label"\)/);
  assert.match(sourceFiles.chatInput, /t\("taskDetail\.chat\.toast\.fileTooLarge"/);

  assert.match(sourceFiles.messageToolcall, /taskDetailT/);
  assert.match(sourceFiles.messageToolcall, /toolcall\.previewRequest/);

  assert.match(sourceFiles.fileExplorer, /useTranslation/);
  assert.match(sourceFiles.fileExplorer, /t\("taskDetail\.files\.title"\)/);
  assert.match(sourceFiles.fileExplorer, /t\("taskDetail\.files\.emptyDirectory"\)/);

  assert.match(sourceFiles.fileActions, /useTranslation/);
  assert.match(sourceFiles.fileActions, /t\("taskDetail\.fileActions\.download"\)/);
  assert.match(sourceFiles.fileActions, /t\("taskDetail\.fileActions\.deleteDescription"/);

  assert.match(sourceFiles.fileDownload, /useTranslation/);
  assert.match(sourceFiles.fileDownload, /t\("taskDetail\.download\.downloading"\)/);

  assert.match(sourceFiles.terminalPanel, /t\("taskDetail\.terminal\.newTerminal"\)/);
  assert.match(sourceFiles.messageList, /t\("taskDetail\.messages\.empty"\)/);
  assert.match(sourceFiles.attachmentPreview, /t\("taskDetail\.attachment\.title"\)/);

  assert.match(sourceFiles.chatSection, /useTranslation/);
  assert.match(sourceFiles.chatSection, /t\("taskDetail\.panels\.files"\)/);
  assert.match(sourceFiles.chatSection, /t\("taskDetail\.chat\.followupPlaceholder"\)/);

  assert.match(sourceFiles.rounds, /taskDetailT\("rounds\.loadFailed"\)/);

  assert.match(sourceFiles.userInputIndex, /useTranslation/);
  assert.match(sourceFiles.userInputIndex, /t\("taskDetail\.userInputIndex\.loadMore"\)/);

  assert.match(sourceFiles.messageHandler, /taskDetailT\("system\.userCanceled"\)/);
  assert.match(sourceFiles.messageHandler, /taskDetailT\("alert\.llmRetryAttempt"/);
});

test("任务详情核心组件提供中英文资源", () => {
  assert.equal(cn.taskDetail.chat.placeholder.idle, "描述你的需求，Shift+Enter 换行，Enter 发送。");
  assert.equal(en.taskDetail.chat.placeholder.idle, "Describe what you need. Shift+Enter for a new line, Enter to send.");
  assert.equal(cn.taskDetail.chat.quickInputs.label, "快捷输入");
  assert.equal(en.taskDetail.chat.quickInputs.label, "Quick input");
  assert.equal(cn.taskDetail.files.title, "项目文件");
  assert.equal(en.taskDetail.files.title, "Project files");
  assert.equal(cn.taskDetail.fileActions.download, "下载");
  assert.equal(en.taskDetail.fileActions.download, "Download");
  assert.equal(cn.taskDetail.download.downloading, "正在下载");
  assert.equal(en.taskDetail.download.downloading, "Downloading");
  assert.equal(cn.taskDetail.toolcall.editingFile, "正在修改文件");
  assert.equal(en.taskDetail.toolcall.editingFile, "Editing file");
  assert.equal(cn.taskDetail.panels.files, "文件");
  assert.equal(en.taskDetail.panels.files, "Files");
  assert.equal(cn.taskDetail.userInputIndex.locating, "正在定位消息...");
  assert.equal(en.taskDetail.userInputIndex.locating, "Locating message...");
  assert.equal(cn.taskDetail.alert.compactEnded, "上下文压缩完成");
  assert.equal(en.taskDetail.alert.compactEnded, "Context compression completed");
});
