import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  models: readSource("../src/components/console/settings/models.tsx"),
  addModel: readSource("../src/components/console/settings/add-model.tsx"),
  editModel: readSource("../src/components/console/settings/edit-model.tsx"),
  providerModelCombobox: readSource("../src/components/console/settings/provider-model-combobox.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("设置模型页面使用 consoleSettings models i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleSettings\.models\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.models, /t\("consoleSettings\.models\.title"\)/);
  assert.match(sourceFiles.addModel, /t\("consoleSettings\.models\.add\.title"\)/);
  assert.match(sourceFiles.editModel, /t\("consoleSettings\.models\.edit\.title"\)/);
});

test("设置模型页面提供中英文资源", () => {
  assert.equal(cn.consoleSettings.models.title, "AI 大模型");
  assert.equal(en.consoleSettings.models.title, "AI models");
  assert.equal(cn.consoleSettings.models.actions.bind, "绑定");
  assert.equal(en.consoleSettings.models.actions.bind, "Bind");
  assert.equal(cn.consoleSettings.models.actions.copy, "复制");
  assert.equal(en.consoleSettings.models.actions.copy, "Copy");
  assert.equal(cn.consoleSettings.models.remove.description, "确定要移除模型 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.consoleSettings.models.remove.description, "Remove model \"{{name}}\"? This action cannot be undone.");
});

test("模型设置提供共享的可搜索模型选择器", () => {
  assert.match(sourceFiles.providerModelCombobox, /CommandInput/);
  assert.match(sourceFiles.providerModelCombobox, /filterAndGroupProviderModels/);
  assert.match(sourceFiles.providerModelCombobox, /useDeferredValue/);
  assert.match(sourceFiles.providerModelCombobox, /deferredQuery/);
  assert.match(sourceFiles.providerModelCombobox, /useMemo/);
  assert.match(sourceFiles.providerModelCombobox, /isSearchPending/);
  assert.match(sourceFiles.providerModelCombobox, /getProviderModelCommandValue/);
  assert.match(sourceFiles.providerModelCombobox, /role="combobox"/);
  assert.match(sourceFiles.providerModelCombobox, /groupedModels\.map/);
  assert.match(sourceFiles.providerModelCombobox, /disabled=\{disabled \|\| loading\}/);
  assert.match(sourceFiles.providerModelCombobox, /<Popover modal/);
  assert.match(sourceFiles.providerModelCombobox, /side="bottom"/);
  assert.match(sourceFiles.providerModelCombobox, /avoidCollisions=\{false\}/);
  assert.match(sourceFiles.providerModelCombobox, /--radix-popover-content-available-height/);
});

test("模型搜索提供中英文文案", () => {
  assert.equal(cn.consoleSettings.models.placeholders.searchModel, "搜索模型 ID");
  assert.equal(en.consoleSettings.models.placeholders.searchModel, "Search model ID");
  assert.equal(cn.consoleSettings.models.noSearchResults, "未找到匹配的模型");
  assert.equal(en.consoleSettings.models.noSearchResults, "No matching models");
});

test("新增和编辑模型表单复用模型搜索组件", () => {
  assert.match(sourceFiles.addModel, /ProviderModelCombobox/);
  assert.match(sourceFiles.editModel, /ProviderModelCombobox/);
  assert.doesNotMatch(sourceFiles.addModel, /const getGroupedModels/);
  assert.doesNotMatch(sourceFiles.editModel, /const getGroupedModels/);
});
