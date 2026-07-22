import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);

test("Agent 重启确认弹窗支持左右方向键切换操作按钮", () => {
  assert.match(pageSource, /AlertDialogAction,/);
  assert.match(pageSource, /const restartAgentCancelRef = React\.useRef<HTMLButtonElement>\(null\)/);
  assert.match(pageSource, /const restartAgentConfirmRef = React\.useRef<HTMLButtonElement>\(null\)/);

  const handlerStart = pageSource.indexOf("const handleRestartAgentDialogKeyDown");
  const handlerEnd = pageSource.indexOf("const handleConfirmRestartAgent", handlerStart);
  assert.notEqual(handlerStart, -1, "restart dialog should define an arrow-key handler");
  assert.notEqual(handlerEnd, -1, "restart handler should precede the confirm callback");
  const handlerSource = pageSource.slice(handlerStart, handlerEnd);
  assert.match(handlerSource, /event\.key === "ArrowLeft"/);
  assert.match(handlerSource, /event\.preventDefault\(\)/);
  assert.match(handlerSource, /restartAgentCancelRef\.current\?\.focus\(\)/);
  assert.match(handlerSource, /event\.key === "ArrowRight"/);
  assert.match(handlerSource, /restartAgentConfirmRef\.current\?\.focus\(\)/);

  const dialogMatch = pageSource.match(
    /<AlertDialog\s+open=\{restartAgentDialogOpen\}[\s\S]*?<\/AlertDialog>/,
  );
  assert.ok(dialogMatch, "restart dialog should be present");
  assert.match(dialogMatch[0], /<AlertDialogContent onKeyDown=\{handleRestartAgentDialogKeyDown\}>/);
  assert.match(dialogMatch[0], /<AlertDialogCancel ref=\{restartAgentCancelRef\} disabled=\{restartAgentSubmitting\}>/);
  assert.match(dialogMatch[0], /<AlertDialogAction[\s\S]*?ref=\{restartAgentConfirmRef\}/);
  assert.match(dialogMatch[0], /void handleConfirmRestartAgent\(\)/);
  assert.match(dialogMatch[0], /disabled=\{restartAgentSubmitting\}/);
  assert.match(dialogMatch[0], /restartAgentSubmitting && <Spinner/);
});
