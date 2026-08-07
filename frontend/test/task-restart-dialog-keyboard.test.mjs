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
const tasksPageSource = readFileSync(
  new URL("../src/pages/console/user/tasks.tsx", import.meta.url),
  "utf8",
);
const projectTasksSource = readFileSync(
  new URL("../src/pages/console/user/project/overview/tasks-tab.tsx", import.meta.url),
  "utf8",
);
const navProjectSource = readFileSync(
  new URL("../src/components/console/nav/nav-project.tsx", import.meta.url),
  "utf8",
);
const longContentSource = readFileSync(
  new URL("../src/components/console/task/task-long-content-dialog.tsx", import.meta.url),
  "utf8",
);
const fileActionsSource = readFileSync(
  new URL("../src/components/console/task/file-actions-dropdown.tsx", import.meta.url),
  "utf8",
);
const terminalPanelSource = readFileSync(
  new URL("../src/components/console/task/task-terminal-panel.tsx", import.meta.url),
  "utf8",
);
const whiteboardSource = readFileSync(
  new URL("../src/components/console/task/task-whiteboard-dialog.tsx", import.meta.url),
  "utf8",
);
const dialogNavigationSource = readFileSync(
  new URL("../src/components/ui/dialog-action-navigation.ts", import.meta.url),
  "utf8",
);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAlertDialogSource = (source, openExpression) => {
  const match = source.match(new RegExp(`<AlertDialog\\s+open=\\{${escapeRegExp(openExpression)}\\}[\\s\\S]*?</AlertDialog>`));
  assert.ok(match, `${openExpression} alert dialog should be present`);
  return match[0];
};

const assertDialogNavigation = (source, dialogSource, navigationName, contentName = "AlertDialogContent") => {
  assert.match(source, new RegExp(`const ${navigationName} = useDialogActionNavigation\\(\\)`));
  assert.match(dialogSource, new RegExp(`<${contentName}\\b[\\s\\S]*?onKeyDown=\\{${navigationName}\\.onKeyDown\\}`));
  assert.match(dialogSource, new RegExp(`<(?:AlertDialogCancel|Button)[^>]*ref=\\{${navigationName}\\.cancelRef\\}`));
  assert.match(dialogSource, new RegExp(`<(?:AlertDialogAction|Button)[^>]*ref=\\{${navigationName}\\.confirmRef\\}`));
};

test("双操作确认弹窗共享左右方向键导航", () => {
  const leftBranch = dialogNavigationSource.match(/if \(event\.key === "ArrowLeft"\) \{([\s\S]*?)\n    \}/);
  const rightBranch = dialogNavigationSource.match(/else if \(event\.key === "ArrowRight"\) \{([\s\S]*?)\n    \}/);
  assert.ok(leftBranch, "shared navigation should handle ArrowLeft");
  assert.ok(rightBranch, "shared navigation should handle ArrowRight");
  assert.match(leftBranch[1], /event\.preventDefault\(\)/);
  assert.match(leftBranch[1], /cancelRef\.current\?\.focus\(\)/);
  assert.match(rightBranch[1], /event\.preventDefault\(\)/);
  assert.match(rightBranch[1], /confirmRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(dialogNavigationSource, /event\.key === "Enter"/);
  assert.match(dialogNavigationSource, /export \{ useDialogActionNavigation \}/);
});

test("任务确认弹窗复用共享键盘导航", () => {
  const dialogs = [
    ["modelSwitch", "modelSwitchDialogOpen", "modelSwitchSubmitting", "handleConfirmModelSwitch"],
    ["resetContext", "resetContextDialogOpen", "resetContextSubmitting", "handleConfirmResetContext"],
    ["restartAgent", "restartAgentDialogOpen", "restartAgentSubmitting", "handleConfirmRestartAgent"],
  ];

  for (const [dialogName, openState, submittingState, confirmHandler] of dialogs) {
    const dialogSource = getAlertDialogSource(pageSource, openState);
    assertDialogNavigation(pageSource, dialogSource, `${dialogName}DialogNavigation`);
    assert.match(dialogSource, new RegExp(`<AlertDialogCancel[^>]*disabled=\\{${submittingState}\\}>`));
    assert.match(dialogSource, new RegExp(`ref=\\{${dialogName}DialogNavigation\\.confirmRef\\}[\\s\\S]*?type="button"`));
    assert.match(dialogSource, new RegExp(`void ${confirmHandler}\\(\\)`));
    assert.match(dialogSource, new RegExp(`disabled=\\{${submittingState}\\}`));
    assert.match(dialogSource, new RegExp(`${submittingState} && <Spinner`));
    assert.doesNotMatch(dialogSource, /<AlertDialogAction/);
  }

  assert.doesNotMatch(pageSource, /handleRestartAgentDialogKeyDown/);
});

test("Slash 命令确认弹窗复用共享键盘导航", () => {
  const dialogSource = getAlertDialogSource(chatInputSource, "slashCommandConfirmOpen");
  assertDialogNavigation(chatInputSource, dialogSource, "slashCommandDialogNavigation");
  assert.doesNotMatch(chatInputSource, /handleSlashCommandDialogKeyDown/);
});

test("任务列表和侧边栏的删除终止弹窗复用共享键盘导航", () => {
  const dialogs = [
    [tasksPageSource, "!!taskToDelete", "deleteTaskDialogNavigation"],
    [tasksPageSource, "!!taskToStop", "stopTaskDialogNavigation"],
    [projectTasksSource, "!!taskToDelete", "deleteTaskDialogNavigation"],
    [navProjectSource, "!!taskToDelete", "deleteTaskDialogNavigation"],
    [navProjectSource, "!!taskToStop", "stopTaskDialogNavigation"],
  ];

  for (const [source, openExpression, navigationName] of dialogs) {
    assertDialogNavigation(source, getAlertDialogSource(source, openExpression), navigationName);
  }
});

test("任务辅助操作确认弹窗复用共享键盘导航", () => {
  const dialogs = [
    [longContentSource, "open", "dialogNavigation"],
    [fileActionsSource, "deleteDialogOpen", "deleteDialogNavigation"],
    [terminalPanelSource, "closeDialogOpen", "closeDialogNavigation"],
    [whiteboardSource, "resetDialogOpen", "resetDialogNavigation"],
  ];

  for (const [source, openExpression, navigationName] of dialogs) {
    assertDialogNavigation(source, getAlertDialogSource(source, openExpression), navigationName);
  }
});

test("发布网站确认弹窗复用共享键盘导航", () => {
  const dialogMatch = pageSource.match(/<Dialog open=\{publishConfirmDialogOpen\}[\s\S]*?<\/Dialog>/);
  assert.ok(dialogMatch, "publish website dialog should be present");
  assertDialogNavigation(pageSource, dialogMatch[0], "publishWebsiteDialogNavigation", "DialogContent");
});
