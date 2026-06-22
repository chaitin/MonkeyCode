import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/utils/common.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("common utilities use commonUtils i18n resources", () => {
  assert.match(source, /import i18n from "@\/i18n"/);
  assert.match(source, /i18n\.t\("commonUtils\.model\.basic"\)/);
  assert.match(source, /i18n\.t\("commonUtils\.taskStatus\.started"\)/);
  assert.match(source, /i18n\.t\("commonUtils\.download\.streamUnavailable"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("common utilities provide Chinese and English resources", () => {
  assert.equal(cn.commonUtils.model.basic, "基础模型");
  assert.equal(en.commonUtils.model.basic, "Basic model");
  assert.equal(cn.commonUtils.taskStatus.started, "正在执行任务");
  assert.equal(en.commonUtils.taskStatus.started, "Running task");
  assert.equal(cn.commonUtils.download.streamUnavailable, "无法获取文件流");
  assert.equal(en.commonUtils.download.streamUnavailable, "Unable to read the file stream");
});
