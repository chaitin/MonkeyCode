import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  models: readSource("../src/components/console/settings/models.tsx"),
  addModel: readSource("../src/components/console/settings/add-model.tsx"),
  editModel: readSource("../src/components/console/settings/edit-model.tsx"),
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
  assert.equal(cn.consoleSettings.models.remove.description, "确定要移除模型 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.consoleSettings.models.remove.description, "Remove model \"{{name}}\"? This action cannot be undone.");
});
