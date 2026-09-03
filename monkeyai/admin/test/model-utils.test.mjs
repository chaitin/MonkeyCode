import assert from "node:assert/strict"
import test from "node:test"

import { getModelIconName } from "../src/lib/model-utils.ts"

test("selects iconfont symbols from model names", () => {
  assert.equal(getModelIconName("gpt-4o"), "icon-openai")
  assert.equal(getModelIconName("o3"), "icon-openai")
  assert.equal(getModelIconName("claude-3-5-sonnet-latest"), "icon-claude")
  assert.equal(getModelIconName("deepseek-chat"), "icon-deepseek")
  assert.equal(getModelIconName("qwen-max"), "icon-qwen")
  assert.equal(getModelIconName("doubao-pro-32k"), "icon-doubao")
})

test("falls back to the generic model icon", () => {
  assert.equal(getModelIconName("custom-private-model"), "icon-model")
})
