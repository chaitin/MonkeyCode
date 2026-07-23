import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);

test("Agent 重启确认弹窗支持左右方向键切换操作按钮", () => {
  assert.match(pageSource, /const restartAgentCancelRef = React\.useRef<HTMLButtonElement>\(null\)/);
  assert.match(pageSource, /const restartAgentConfirmRef = React\.useRef<HTMLButtonElement>\(null\)/);

  const handlerStart = pageSource.indexOf("const handleRestartAgentDialogKeyDown");
  const handlerEnd = pageSource.indexOf("const handleConfirmRestartAgent", handlerStart);
  assert.notEqual(handlerStart, -1, "restart dialog should define an arrow-key handler");
  assert.notEqual(handlerEnd, -1, "restart handler should precede the confirm callback");
  const handlerSource = pageSource.slice(handlerStart, handlerEnd);
  const leftBranch = handlerSource.match(/if \(event\.key === "ArrowLeft"\) \{([\s\S]*?)\n    \}/);
  const rightBranch = handlerSource.match(/if \(event\.key === "ArrowRight"\) \{([\s\S]*?)\n    \}/);
  assert.ok(leftBranch, "restart handler should handle ArrowLeft");
  assert.ok(rightBranch, "restart handler should handle ArrowRight");
  assert.match(leftBranch[1], /event\.preventDefault\(\)/);
  assert.match(leftBranch[1], /restartAgentCancelRef\.current\?\.focus\(\)/);
  assert.match(rightBranch[1], /event\.preventDefault\(\)/);
  assert.match(rightBranch[1], /restartAgentConfirmRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(handlerSource, /event\.key === "Enter"/);

  const dialogMatch = pageSource.match(
    /<AlertDialog\s+open=\{restartAgentDialogOpen\}[\s\S]*?<\/AlertDialog>/,
  );
  assert.ok(dialogMatch, "restart dialog should be present");
  assert.match(dialogMatch[0], /<AlertDialogContent onKeyDown=\{handleRestartAgentDialogKeyDown\}>/);
  assert.match(dialogMatch[0], /<AlertDialogCancel ref=\{restartAgentCancelRef\} disabled=\{restartAgentSubmitting\}>/);
  assert.doesNotMatch(dialogMatch[0], /<AlertDialogAction/);
  const confirmMatch = dialogMatch[0].match(/<Button\s+ref=\{restartAgentConfirmRef\}[\s\S]*?<\/Button>/);
  assert.ok(confirmMatch, "restart confirm should remain a plain Button");
  assert.match(confirmMatch[0], /type="button"/);
  assert.match(confirmMatch[0], /void handleConfirmRestartAgent\(\)/);
  assert.match(confirmMatch[0], /disabled=\{restartAgentSubmitting\}/);
  assert.match(confirmMatch[0], /restartAgentSubmitting && <Spinner/);
});
