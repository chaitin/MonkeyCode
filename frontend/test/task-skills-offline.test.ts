import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taskInputSource = readFileSync(
  new URL("../src/components/console/task/task-input.tsx", import.meta.url),
  "utf8",
);
const defaultTaskDialogSource = readFileSync(
  new URL("../src/components/console/task/create-default-task-dialog.tsx", import.meta.url),
  "utf8",
);

test("任务输入框在 offline 模式下也加载并展示 Skills", () => {
  assert.match(taskInputSource, /apiRequest\('v1SkillsList'/);
  assert.doesNotMatch(taskInputSource, /const fetchSkillList = \(\) => \{\s*if \(IS_OFFLINE_EDITION\)/);
  assert.doesNotMatch(taskInputSource, /\{!IS_OFFLINE_EDITION && \(\s*<TaskSkillSelector/);
  assert.match(taskInputSource, /filterSelectableSkillIds\(prev, skills\)/);
});

test("默认任务弹窗在 offline 模式下也加载并展示 Skills", () => {
  const loadEffectMatch = defaultTaskDialogSource.match(
    /useEffect\(\(\) => \{[\s\S]*?\}, \[open, skillList\.length, pluginList\.length\]\)/,
  );
  assert.ok(loadEffectMatch, "default task dialog should have resource-loading effect");

  const loadEffectSource = loadEffectMatch[0];
  const skillRequestIndex = loadEffectSource.indexOf("v1SkillsList");
  const offlineReturnIndex = loadEffectSource.indexOf("if (IS_OFFLINE_EDITION)");

  assert.ok(skillRequestIndex >= 0, "default task dialog should request Skills");
  assert.ok(
    offlineReturnIndex === -1 || skillRequestIndex < offlineReturnIndex,
    "offline guard should not skip loading Skills",
  );
  assert.doesNotMatch(defaultTaskDialogSource, /\{!IS_OFFLINE_EDITION && \(\s*<TaskSkillSelector/);
  assert.match(defaultTaskDialogSource, /filterSelectableSkillIds\(prev, skills\)/);
  assert.match(defaultTaskDialogSource, /filterSelectableSkillIds\(defaultSkills, skillList\)/);
});
