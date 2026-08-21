import assert from "node:assert/strict"
import test from "node:test"

import cn from "../src/i18n/resources/cn.ts"
import en from "../src/i18n/resources/en.ts"

function collectLeaves(value: unknown, path = "", leaves = new Map<string, string>()) {
  if (typeof value === "string") {
    leaves.set(path, value)
    return leaves
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectLeaves(child, path ? `${path}.${key}` : key, leaves)
    }
  }
  return leaves
}

test("中英文资源结构保持完整一致", () => {
  const cnLeaves = collectLeaves(cn)
  const enLeaves = collectLeaves(en)

  assert.deepEqual([...enLeaves.keys()].sort(), [...cnLeaves.keys()].sort())
})

test("英文资源不包含未翻译中文", () => {
  const allowedChineseIdentifiers = new Set([
    "common.language.cn",
    "welcomeShell.footer.icp",
  ])

  for (const [key, value] of collectLeaves(en)) {
    if (!allowedChineseIdentifiers.has(key)) {
      assert.doesNotMatch(value, /[\u3400-\u9fff]/, `${key} contains untranslated Chinese`)
    }
  }
})
