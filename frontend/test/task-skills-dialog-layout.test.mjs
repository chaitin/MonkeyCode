import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { twMerge } from "tailwind-merge";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const updateDialog = readSource(
  "../src/components/console/task/task-skills-update-dialog.tsx",
);
const skillSelector = readSource(
  "../src/components/console/task/task-skill-selector.tsx",
);

function extractClassTokens(source, pattern) {
  const match = source.match(pattern);

  assert.ok(match, `未找到布局元素：${pattern}`);
  return new Set(match[1].split(/\s+/));
}

function assertHasClasses(classTokens, expectedClasses) {
  for (const expectedClass of expectedClasses) {
    assert.ok(classTokens.has(expectedClass), `缺少布局类：${expectedClass}`);
  }
}

test("任务技能弹窗限制 Grid 子项宽度", () => {
  const dialogBodyClasses = extractClassTokens(
    updateDialog,
    /<div className="([^"]+)">\s*<TaskSkillPickerBody/,
  );

  assertHasClasses(dialogBodyClasses, ["min-w-0", "max-w-full"]);
  assert.equal(dialogBodyClasses.has("overflow-hidden"), false);
});

test("任务技能标签栏在弹窗宽度内横向滚动", () => {
  const pickerClasses = extractClassTokens(
    skillSelector,
    /<Tabs[\s\S]*?className=\{cn\("([^"]+)", className\)\}/,
  );
  const tagRowClasses = extractClassTokens(
    skillSelector,
    /<div className="([^"]+)">\s*<Button[\s\S]*?<IconChevronLeft/,
  );
  const tabsListClasses = extractClassTokens(
    skillSelector,
    /<TabsList[\s\S]*?className="([^"]+)"/,
  );

  assertHasClasses(pickerClasses, ["min-w-0", "w-full"]);
  assertHasClasses(tagRowClasses, ["min-w-0"]);
  assertHasClasses(tabsListClasses, [
    "min-w-0",
    "w-auto",
    "flex-1",
    "overflow-x-auto",
    "whitespace-nowrap",
  ]);

  const mergedTabsListClasses = twMerge("inline-flex w-fit", [...tabsListClasses].join(" "));
  assert.match(mergedTabsListClasses, /(?:^|\s)w-auto(?:\s|$)/);
  assert.doesNotMatch(mergedTabsListClasses, /(?:^|\s)w-fit(?:\s|$)/);
});
