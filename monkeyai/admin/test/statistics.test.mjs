import assert from "node:assert/strict"
import test from "node:test"
import { change, periodChange } from "../src/lib/statistics.ts"

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
