import assert from "node:assert/strict"
import test from "node:test"
import { change } from "../src/lib/statistics.ts"

test("没有可比样本时不生成虚假环比", () => {
  assert.equal(change(10, 0, "zh-CN"), undefined)
  assert.equal(change(0, 0, "zh-CN"), undefined)
  assert.equal(change(null, 20, "zh-CN"), undefined)
  assert.equal(change(20, null, "zh-CN"), undefined)
})

test("数量环比与百分比指标使用不同单位", () => {
  assert.equal(change(120, 100, "zh-CN"), "+20%")
  assert.equal(change(50, 100, "zh-CN"), "-50%")
  assert.equal(change(0, 100, "zh-CN"), "-100%")
  assert.equal(change(51, 50, "zh-CN", true), "+1 pp")
  assert.equal(change(20, 0, "zh-CN", true), "+20 pp")
})
