import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("任务详情页面壳使用 taskDetail page i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("taskDetail\.page\.models\.basic"\)/);
  assert.match(source, /t\("taskDetail\.page\.context\.compactTitle"\)/);
  assert.match(source, /t\("taskDetail\.page\.dialogs\.switchModel\.title"\)/);
  assert.match(source, /t\("taskDetail\.panels\.preview"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("任务详情页面壳提供中英文资源", () => {
  assert.equal(cn.taskDetail.page.models.basic, "基础模型");
  assert.equal(en.taskDetail.page.models.basic, "Basic model");
  assert.equal(cn.taskDetail.page.context.compactTitle, "压缩上下文");
  assert.equal(en.taskDetail.page.context.compactTitle, "Compact context");
  assert.equal(cn.taskDetail.page.dialogs.switchModel.title, "切换模型");
  assert.equal(en.taskDetail.page.dialogs.switchModel.title, "Switch model");
});

test("任务详情模型切换推荐标按同级别模型 weight 计算", () => {
  assert.match(source, /recommendedModelKeys/);
  assert.match(source, /getBuiltinModelName\(model\.model\) === option\.model/);
  assert.match(source, /\(right\.weight \|\| 0\) - \(left\.weight \|\| 0\)/);
  assert.doesNotMatch(source, /qwen3\.5-plus|qwen3\.6-plus|gpt-5\.5/);
});
