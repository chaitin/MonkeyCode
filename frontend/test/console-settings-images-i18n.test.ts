import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  addImage: readSource("../src/components/console/settings/add-image.tsx"),
  editImage: readSource("../src/components/console/settings/edit-image.tsx"),
  images: readSource("../src/components/console/settings/images.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("设置镜像页面使用 consoleSettings i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleSettings\.images\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.addImage, /t\("consoleSettings\.images\.add\.title"\)/);
  assert.match(sourceFiles.editImage, /t\("consoleSettings\.images\.edit\.title"\)/);
  assert.match(sourceFiles.images, /t\("consoleSettings\.images\.title"\)/);
});

test("设置镜像页面提供中英文资源", () => {
  assert.equal(cn.consoleSettings.images.title, "系统镜像");
  assert.equal(en.consoleSettings.images.title, "System images");
  assert.equal(cn.consoleSettings.images.add.title, "绑定系统镜像");
  assert.equal(en.consoleSettings.images.add.title, "Bind system image");
  assert.equal(cn.consoleSettings.images.delete.description, "确定要移除镜像 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.consoleSettings.images.delete.description, "Remove image \"{{name}}\"? This action cannot be undone.");
});
