import assert from "node:assert/strict";
import test from "node:test";

import { filterSelectableSkillIds } from "../src/components/console/task/task-skill-selection.ts";

test("默认选中技能只保留当前技能列表中存在的 id", () => {
  assert.deepEqual(
    filterSelectableSkillIds(["missing-a", "skill-a", "missing-b"], [
      { id: "skill-a" },
      { id: "skill-b" },
    ]),
    ["skill-a"],
  );
});

test("过滤选中技能时忽略没有 id 的技能项", () => {
  assert.deepEqual(
    filterSelectableSkillIds(["skill-a", "skill-b"], [
      { id: "" },
      { name: "missing id" },
      { id: "skill-b" },
    ]),
    ["skill-b"],
  );
});
