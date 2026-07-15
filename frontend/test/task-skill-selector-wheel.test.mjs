import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const selector = readSource(
  "../src/components/console/task/task-skill-selector.tsx",
);
const startTask = readSource(
  "../src/components/console/project/start-develop-task-dialog.tsx",
);
const taskInput = readSource("../src/components/console/task/task-input.tsx");
const defaultTask = readSource(
  "../src/components/console/task/create-default-task-dialog.tsx",
);

function taskSkillSelectorTags(source) {
  return source.match(/<TaskSkillSelector\b[^>]*\/>/gs) ?? [];
}

function loadWheelScrollDelta() {
  const match = selector.match(
    /function getWheelScrollDelta\([^)]*\) \{([\s\S]*?)\n\}\n\ntype DomainSkill/,
  );

  assert.ok(match, "未找到滚轮增量换算函数");

  const body = match[1]
    .replaceAll("DOM_DELTA_LINE", "1")
    .replaceAll("DOM_DELTA_PAGE", "2")
    .replaceAll("WHEEL_LINE_HEIGHT", "16");

  return new Function("deltaY", "deltaMode", "pageHeight", body);
}

test("启动任务技能选择器启用滚轮回退", () => {
  assert.match(selector, /enableWheelScrollFallback\?: boolean/);
  assert.match(selector, /addEventListener\("wheel", handleSkillListWheel, \{ passive: false \}\)/);
  assert.match(selector, /event\.preventDefault\(\)/);
  assert.match(selector, /removeEventListener\("wheel", handleSkillListWheel\)/);
  assert.match(
    selector,
    /\[enableWheelScrollFallback, open, popoverContentElement\]/,
  );
  assert.match(selector, /setPopoverContentElement/);
  assert.match(selector, /activeSkillList\.scrollTop \+= getWheelScrollDelta/);
  assert.match(selector, /closest<HTMLDivElement>\(ACTIVE_SKILL_LIST_SELECTOR\)/);
  assert.match(selector, /ref=\{setPopoverContentElement\}/);
  assert.match(selector, /event\.ctrlKey/);
  assert.match(
    selector,
    /Math\.abs\(event\.deltaY\) <= Math\.abs\(event\.deltaX\)/,
  );
  assert.doesNotMatch(
    selector,
    /ref=\{tag === activeSkillTag \? setSkillListElement : undefined\}/,
  );
  assert.doesNotMatch(selector, /<Popover modal=/);
  assert.equal(
    taskSkillSelectorTags(startTask).some((tag) =>
      /\benableWheelScrollFallback\b/.test(tag),
    ),
    true,
  );
});

test("滚轮回退按 deltaMode 换算滚动距离", () => {
  const getWheelScrollDelta = loadWheelScrollDelta();

  assert.equal(getWheelScrollDelta(24, 0, 300), 24);
  assert.equal(getWheelScrollDelta(3, 1, 300), 48);
  assert.equal(getWheelScrollDelta(2, 2, 300), 600);
  assert.equal(getWheelScrollDelta(-2, 1, 300), -32);
});

test("创建任务入口启用回退且任务首页保持默认行为", () => {
  assert.equal(
    taskSkillSelectorTags(defaultTask).some((tag) =>
      /\benableWheelScrollFallback\b/.test(tag),
    ),
    true,
  );
  assert.equal(
    taskSkillSelectorTags(taskInput).some((tag) =>
      /\benableWheelScrollFallback\b/.test(tag),
    ),
    false,
  );
});
