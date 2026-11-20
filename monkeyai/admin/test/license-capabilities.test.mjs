import assert from "node:assert/strict"
import test from "node:test"
import { normalizeCapabilities } from "../src/lib/capabilities.ts"

test("能力仅接受明确的布尔 true，缺失和异常响应关闭能力", () => {
  for (const value of [
    null,
    undefined,
    {},
    { allow_cloud_computer: "true", allow_custom_branding: 1 },
  ]) {
    assert.deepEqual(normalizeCapabilities(value), {
      allow_cloud_computer: false,
      allow_custom_branding: false,
    })
  }
})

test("云电脑和自定义品牌独立启用", () => {
  for (const cloud of [false, true]) {
    for (const branding of [false, true]) {
      const value = {
        allow_cloud_computer: cloud,
        allow_custom_branding: branding,
      }
      assert.deepEqual(normalizeCapabilities(value), value)
    }
  }
})
