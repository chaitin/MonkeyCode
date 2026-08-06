import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);
const chatInputSource = readFileSync(
  new URL("../src/components/console/task/chat-inputbox.tsx", import.meta.url),
  "utf8",
);
const alertDialogSource = readFileSync(
  new URL("../src/components/ui/alert-dialog.tsx", import.meta.url),
  "utf8",
);

const getDialogSource = (source, openState) => {
  const match = source.match(new RegExp(`<AlertDialog\\s+open=\\{${openState}\\}[\\s\\S]*?</AlertDialog>`));
  assert.ok(match, `${openState} dialog should be present`);
  return match[0];
};

test("AlertDialog 双操作按钮共享左右方向键导航", () => {
  const handlerStart = alertDialogSource.indexOf("function useAlertDialogActionNavigation");
  const handlerEnd = alertDialogSource.indexOf("function AlertDialogTrigger", handlerStart);
  assert.notEqual(handlerStart, -1, "alert dialog should export shared action navigation");
  assert.notEqual(handlerEnd, -1, "shared navigation should precede dialog components");
  const handlerSource = alertDialogSource.slice(handlerStart, handlerEnd);
  const leftBranch = handlerSource.match(/if \(event\.key === "ArrowLeft"\) \{([\s\S]*?)\n    \}/);
  const rightBranch = handlerSource.match(/else if \(event\.key === "ArrowRight"\) \{([\s\S]*?)\n    \}/);
  assert.ok(leftBranch, "shared navigation should handle ArrowLeft");
  assert.ok(rightBranch, "shared navigation should handle ArrowRight");
  assert.match(leftBranch[1], /event\.preventDefault\(\)/);
  assert.match(leftBranch[1], /cancelRef\.current\?\.focus\(\)/);
  assert.match(rightBranch[1], /event\.preventDefault\(\)/);
  assert.match(rightBranch[1], /confirmRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(handlerSource, /event\.key === "Enter"/);
  assert.match(alertDialogSource, /useAlertDialogActionNavigation,/);
});

test("任务确认弹窗复用共享键盘导航", () => {
  const dialogs = [
    ["modelSwitch", "modelSwitchDialogOpen", "modelSwitchSubmitting", "handleConfirmModelSwitch"],
    ["resetContext", "resetContextDialogOpen", "resetContextSubmitting", "handleConfirmResetContext"],
    ["restartAgent", "restartAgentDialogOpen", "restartAgentSubmitting", "handleConfirmRestartAgent"],
  ];

  for (const [dialogName, openState, submittingState, confirmHandler] of dialogs) {
    const dialogSource = getDialogSource(pageSource, openState);
    assert.match(pageSource, new RegExp(`const ${dialogName}DialogNavigation = useAlertDialogActionNavigation\\(\\)`));
    assert.match(dialogSource, new RegExp(`<AlertDialogContent onKeyDown=\\{${dialogName}DialogNavigation\\.onKeyDown\\}>`));
    assert.match(dialogSource, new RegExp(`<AlertDialogCancel ref=\\{${dialogName}DialogNavigation\\.cancelRef\\} disabled=\\{${submittingState}\\}>`));
    assert.match(dialogSource, new RegExp(`ref=\\{${dialogName}DialogNavigation\\.confirmRef\\}[\\s\\S]*?type="button"`));
    assert.match(dialogSource, new RegExp(`void ${confirmHandler}\\(\\)`));
    assert.match(dialogSource, new RegExp(`disabled=\\{${submittingState}\\}`));
    assert.match(dialogSource, new RegExp(`${submittingState} && <Spinner`));
    assert.doesNotMatch(dialogSource, /<AlertDialogAction/);
  }

  assert.doesNotMatch(pageSource, /handleRestartAgentDialogKeyDown/);
});

test("Slash 命令确认弹窗复用共享键盘导航", () => {
  const dialogSource = getDialogSource(chatInputSource, "slashCommandConfirmOpen");
  assert.match(chatInputSource, /const slashCommandDialogNavigation = useAlertDialogActionNavigation\(\)/);
  assert.match(dialogSource, /<AlertDialogContent onKeyDown=\{slashCommandDialogNavigation\.onKeyDown\}>/);
  assert.match(dialogSource, /<AlertDialogCancel ref=\{slashCommandDialogNavigation\.cancelRef\}>/);
  assert.match(dialogSource, /<AlertDialogAction ref=\{slashCommandDialogNavigation\.confirmRef\}/);
  assert.doesNotMatch(chatInputSource, /handleSlashCommandDialogKeyDown/);
});
