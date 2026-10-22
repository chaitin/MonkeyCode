import assert from "node:assert/strict"
import test from "node:test"
import { billingDateDefaults, billingExclusiveUntil, billingPageParams } from "../src/lib/billing-range.ts"

test("账本默认最近28个自然日，跨年正确，并保留显式单侧时间范围", () => {
  assert.deepEqual(billingDateDefaults("", new Date(2027, 0, 4, 12)), {
    from: "2026-12-08", until: "2027-01-04",
  })
  assert.deepEqual(billingDateDefaults("?until=2020-01-01"), {})
  assert.deepEqual(billingDateDefaults("?from=2020-01-01"), {})
})

test("默认日期补齐无范围入口，不混入历史日期和显式全量查询", () => {
  const now = new Date(2026, 9, 20, 12)
  const first = billingPageParams("user=alice", now)
  assert.equal(first.get("user"), "alice")
  assert.equal(first.get("from"), "2026-09-23")
  const historical = billingPageParams("until=2020-01-01", now)
  assert.equal(historical.has("from"), false)
  assert.equal(historical.get("until"), "2020-01-01")
  assert.equal(billingPageParams("view=entries&range=all", now).has("from"), false)
  assert.equal(billingPageParams("from=&until=", now).get("from"), "")
  assert.equal(billingPageParams("view=entries", now).get("from"), "2026-09-23")
  assert.equal(billingPageParams(first.toString(), now).toString(), first.toString())
})

test("账本结束日期转换为下一自然日零点，覆盖最后一毫秒和夏令时", () => {
  const previous = process.env.TZ
  try {
    process.env.TZ = "America/New_York"
    const day = new Date(2026, 2, 8, 0, 0, 0, 0)
    const until = billingExclusiveUntil(day)
    assert.equal(until.getDate(), 9)
    assert.equal(until.getHours(), 0)
    assert.equal(until.getTime() - day.getTime(), 23 * 3600 * 1000)
    assert.equal(day.getDate(), 8)
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})
