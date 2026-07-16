import assert from "node:assert/strict";
import test from "node:test";

import {
  filterAndGroupProviderModels,
  getProviderModelCommandValue,
} from "../src/components/console/settings/provider-model-options.ts";

const models = [
  { model: "openai/gpt-4.1" },
  { model: "anthropic/claude-sonnet-4" },
  { model: "anthropic/claude-3.7-sonnet" },
  { model: "Google/Gemini-2.5-Pro" },
  { model: "" },
  {},
];

test("空搜索词返回全部有效模型并稳定分组排序", () => {
  const groups = filterAndGroupProviderModels(models, "", "other");

  assert.deepEqual(groups.map((group) => group.key), [
    "anthropic/claude",
    "Google/Gemini",
    "openai/gpt",
  ]);
  assert.deepEqual(groups[0].models.map((item) => item.model), [
    "anthropic/claude-3.7-sonnet",
    "anthropic/claude-sonnet-4",
  ]);
});

test("搜索按完整模型 ID 执行大小写无关包含匹配", () => {
  const groups = filterAndGroupProviderModels(models, " GEMINI-2.5 ", "other");

  assert.deepEqual(groups, [{
    key: "Google/Gemini",
    models: [{ model: "Google/Gemini-2.5-Pro" }],
  }]);
});

test("搜索支持斜杠、点号、短横线和数字", () => {
  const groups = filterAndGroupProviderModels(models, "claude-3.7", "other");

  assert.deepEqual(groups.flatMap((group) => group.models), [
    { model: "anthropic/claude-3.7-sonnet" },
  ]);

  assert.deepEqual(
    filterAndGroupProviderModels(models, "openai/gpt-4.1", "other")
      .flatMap((group) => group.models),
    [{ model: "openai/gpt-4.1" }],
  );
});

test("无匹配结果时返回空分组列表", () => {
  assert.deepEqual(filterAndGroupProviderModels(models, "missing", "other"), []);
});

test("缺少分组前缀时使用 fallback 分组", () => {
  assert.deepEqual(filterAndGroupProviderModels([{ model: "-preview" }], "", "other"), [{
    key: "other",
    models: [{ model: "-preview" }],
  }]);
});

test("重复模型 ID 保留首个条目", () => {
  const first = { model: "openai/gpt-4.1", name: "first" };
  const duplicate = { model: "openai/gpt-4.1", name: "duplicate" };

  const groups = filterAndGroupProviderModels([first, duplicate], "", "other");

  assert.deepEqual(groups.flatMap((group) => group.models), [first]);
});

test("cmdk 标识在 trim 后仍能区分首尾空白不同的模型 ID", () => {
  const modelIds = ["model-a", " model-a", "model-a ", "model-a\t"];
  const commandValues = modelIds.map((modelId) => (
    getProviderModelCommandValue(modelId).trim()
  ));

  assert.equal(new Set(commandValues).size, modelIds.length);
});
