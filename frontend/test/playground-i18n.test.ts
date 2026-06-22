import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  playground: readSource("../src/pages/playground.tsx"),
  postCreate: readSource("../src/pages/post-create.tsx"),
};

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("开发者广场页面使用 playground i18n key", () => {
  assert.match(sourceFiles.playground, /useTranslation/);
  assert.match(sourceFiles.playground, /t\("playground\.title"\)/);
  assert.match(sourceFiles.playground, /t\("playground\.actions\.publish"\)/);

  assert.match(sourceFiles.postCreate, /useTranslation/);
  assert.match(sourceFiles.postCreate, /t\("playground\.create\.typeTitle"\)/);
  assert.match(sourceFiles.postCreate, /t\("playground\.create\.task\.selectPlaceholder"\)/);
  assert.match(sourceFiles.postCreate, /t\("playground\.create\.toast\.shareSuccess"\)/);
});

test("开发者广场提供中英文资源", () => {
  assert.equal(cn.playground.title, "开发者广场");
  assert.equal(en.playground.title, "Developer Playground");
  assert.equal(cn.playground.create.typeTitle, "选择发布类型");
  assert.equal(en.playground.create.typeTitle, "Choose post type");
  assert.equal(cn.playground.create.task.selectedFiles, "已选择 {{count}} 个文件");
  assert.equal(en.playground.create.task.selectedFiles, "{{count}} files selected");
});
