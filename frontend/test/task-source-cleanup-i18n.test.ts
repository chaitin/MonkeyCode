import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = [
  "../src/components/console/task/voice-input-button.tsx",
  "../src/components/console/task/file-actions-dropdown.tsx",
  "../src/components/console/task/task-input.tsx",
  "../src/components/console/task/create-default-task-dialog.tsx",
  "../src/components/console/task/chat-inputbox.tsx",
  "../src/components/console/task/task-content-limit.ts",
  "../src/components/console/task/task-user-input-index-model.ts",
  "../src/components/console/task/task-message-handler.ts",
  "../src/components/console/task/task-file-explorer.tsx",
  "../src/components/console/task/task-user-input-index.tsx",
  "../src/components/console/task/task-shared.ts",
  "../src/components/console/task/task-preparing-dialog.tsx",
  "../src/components/console/task/task-plugin-selector.tsx",
  "../src/components/console/task/message.tsx",
  "../src/components/console/task/chat-panel.tsx",
  "../src/components/console/task/toolcalls/fallback.tsx",
];
const cjkPattern = /[\u3400-\u9fff]/;

test("任务目录已接入 i18n 的源码不再残留中文", () => {
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, cjkPattern, file);
  }
});
