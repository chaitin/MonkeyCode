import assert from "node:assert/strict"
import test from "node:test"
import { periodChange } from "../src/lib/statistics.ts"

test("24 小时变化率分别表示增长、下降和持平", () => {
  assert.deepEqual(periodChange(150, 100), { direction: "up", percent: 50 })
  assert.deepEqual(periodChange(70, 100), { direction: "down", percent: 30 })
  assert.deepEqual(periodChange(100, 100), { direction: "flat", percent: 0 })
  assert.deepEqual(periodChange(0, 100), { direction: "down", percent: 100 })
  assert.equal(periodChange(4, 3).direction, "up")
  assert.ok(Math.abs(periodChange(4, 3).percent - 100 / 3) < 1e-10)
})

test("上期为零时区分新增与零值持平，不生成无穷百分比", () => {
  assert.deepEqual(periodChange(10, 0), { direction: "up", percent: null })
  assert.deepEqual(periodChange(0, 0), { direction: "flat", percent: 0 })
})

test("缺失和无效数据不显示变化率", () => {
  for (const value of [null, undefined, NaN, Infinity, -1]) {
    assert.equal(periodChange(value, 100), undefined)
    assert.equal(periodChange(100, value), undefined)
  }
})
