import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/components/console/data-provider.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("console data provider uses i18n keys", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("consoleDataProvider\.toast\.fetchHostsFailed"/);
  assert.match(source, /t\("consoleDataProvider\.fallback\.unknownModel"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("console data provider provides Chinese and English resources", () => {
  assert.equal(cn.consoleDataProvider.toast.fetchHostsFailed, "获取宿主机列表失败: {{message}}");
  assert.equal(en.consoleDataProvider.toast.fetchHostsFailed, "Failed to load hosts: {{message}}");
  assert.equal(cn.consoleDataProvider.fallback.unknownModel, "未知模型");
  assert.equal(en.consoleDataProvider.fallback.unknownModel, "Unknown model");
});
