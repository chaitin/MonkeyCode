import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const files = [
  "../src/pages/console/manager/models.tsx",
  "../src/components/manager/add-model.tsx",
  "../src/components/manager/edit-model.tsx",
] as const;

const sources = files.map((file) =>
  readFileSync(new URL(file, import.meta.url), "utf8"),
);
const combinedSource = sources.join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

test("manager model pages use managerModels i18n keys", () => {
  assert.match(combinedSource, /useTranslation/);
  assert.match(combinedSource, /t\("managerModels\.title"\)/);
  assert.match(combinedSource, /t\("managerModels\.form\.addTitle"\)/);
  assert.match(combinedSource, /t\("managerModels\.form\.editTitle"\)/);
  assert.match(combinedSource, /t\("managerModels\.toast\.fetchFailed"\)/);
  for (const source of sources) {
    assert.doesNotMatch(source, cjkPattern);
  }
});

test("manager model pages provide Chinese and English resources", () => {
  assert.equal(cn.managerModels.title, "AI 大模型");
  assert.equal(en.managerModels.title, "AI models");
  assert.equal(cn.managerModels.actions.bind, "绑定");
  assert.equal(en.managerModels.actions.bind, "Bind");
  assert.equal(cn.managerModels.remove.description, "确定要移除模型 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.managerModels.remove.description, "Remove model \"{{name}}\"? This action cannot be undone.");
});
