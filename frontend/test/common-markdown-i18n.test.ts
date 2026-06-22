import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const markdownSource = readFileSync(new URL("../src/components/common/markdown.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("../src/components/common/markdown-editor.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("Markdown 公共组件使用 common i18n key", () => {
  assert.match(markdownSource, /useTranslation/);
  assert.match(markdownSource, /t\("common\.markdown\.copyCode"\)/);
  assert.match(editorSource, /useTranslation/);
  assert.match(editorSource, /t\("common\.markdownEditor\.uploadSuccess"\)/);
  assert.match(editorSource, /t\("common\.markdownEditor\.previewTitle"\)/);
  assert.doesNotMatch(markdownSource, cjkPattern);
  assert.doesNotMatch(editorSource, cjkPattern);
});

test("Markdown 公共组件提供中英文资源", () => {
  assert.equal(cn.common.markdown.copyCode, "复制代码");
  assert.equal(en.common.markdown.copyCode, "Copy code");
  assert.equal(cn.common.markdownEditor.uploadingImage, "正在上传图片...");
  assert.equal(en.common.markdownEditor.uploadingImage, "Uploading image...");
});
