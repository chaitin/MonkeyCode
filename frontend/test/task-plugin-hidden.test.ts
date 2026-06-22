import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taskCreationSources = [
  {
    name: "task input",
    source: readFileSync(
      new URL("../src/components/console/task/task-input.tsx", import.meta.url),
      "utf8",
    ),
  },
  {
    name: "default task dialog",
    source: readFileSync(
      new URL("../src/components/console/task/create-default-task-dialog.tsx", import.meta.url),
      "utf8",
    ),
  },
];

test("创建任务入口暂不开放 Plugins 选择", () => {
  for (const { name, source } of taskCreationSources) {
    assert.doesNotMatch(source, /TaskPluginSelector/, `${name} should not render plugin selector`);
    assert.doesNotMatch(source, /fetchPluginListing/, `${name} should not fetch plugin listing`);
    assert.doesNotMatch(source, /plugin_ids/, `${name} should not submit plugin ids`);
  }
});
