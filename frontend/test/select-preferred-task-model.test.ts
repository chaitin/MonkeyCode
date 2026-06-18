import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const commonSource = readFileSync(
  new URL("../src/utils/common.tsx", import.meta.url),
  "utf8",
);

const functionSourceMatch = commonSource.match(
  /export function selectPreferredTaskModel[\s\S]*?\n}\n\n\nexport function selectHost/,
);

test("默认任务模型在套餐和 public 模型都不可用时使用模型列表里的第一个可用模型", () => {
  assert.ok(functionSourceMatch, "selectPreferredTaskModel source should be present");

  const functionSource = functionSourceMatch[0];
  const preferredModelIndex = functionSource.indexOf("const preferredModel = models");
  const fallbackModelIndex = functionSource.indexOf("const fallbackModel = models.find");
  const emptyReturnIndex = functionSource.indexOf('return ""');

  assert.ok(preferredModelIndex >= 0, "should first try public preferred models");
  assert.ok(fallbackModelIndex > preferredModelIndex, "fallback should run after public preferred models");
  assert.ok(emptyReturnIndex > fallbackModelIndex, "fallback should run before returning an empty model id");

  const fallbackSource = functionSource.slice(fallbackModelIndex, emptyReturnIndex);
  assert.match(fallbackSource, /model\.id/);
  assert.match(fallbackSource, /canUseModelBySubscription\(model, subscription\)/);
  assert.doesNotMatch(fallbackSource, /owner\?\.type === ConstsOwnerType\.OwnerTypePublic/);
});
