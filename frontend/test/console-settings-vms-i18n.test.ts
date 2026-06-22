import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  vms: readSource("../src/components/console/settings/vms.tsx"),
  addVm: readSource("../src/components/console/vm/vm-add.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("设置开发环境页面使用 consoleSettings vms i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleSettings\.vms\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.vms, /t\("consoleSettings\.vms\.title"\)/);
  assert.match(sourceFiles.addVm, /t\("consoleSettings\.vms\.add\.title"\)/);
});

test("设置开发环境页面提供中英文资源", () => {
  assert.equal(cn.consoleSettings.vms.title, "开发环境");
  assert.equal(en.consoleSettings.vms.title, "Development environments");
  assert.equal(cn.consoleSettings.vms.actions.create, "创建开发环境");
  assert.equal(en.consoleSettings.vms.actions.create, "Create environment");
  assert.equal(cn.consoleSettings.vms.remove.description, "确定要移除开发环境 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.consoleSettings.vms.remove.description, "Remove development environment \"{{name}}\"? This action cannot be undone.");
});
