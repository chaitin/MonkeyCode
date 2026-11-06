import assert from "node:assert/strict"
import test from "node:test"
import { addDays, differenceInCalendarDays, format } from "date-fns"
import {
  memberActivityOpacity,
  memberActivityBounds,
  memberActivityYear,
} from "../src/lib/member-activity.ts"

test("年度日历按星期对齐七行，日期连续且不展示未来日期", () => {
  for (const at of [
    new Date(2026, 9, 21),
    new Date(2024, 2, 1),
    new Date(2026, 0, 4),
    new Date(2026, 0, 10),
  ]) {
    const { start, end, cells, weekCount } = memberActivityYear(at)
    const dates = cells.filter(Boolean)
    assert.equal(cells.length, weekCount * 7)
    assert([53, 54].includes(weekCount))
    assert.equal(dates.length, differenceInCalendarDays(end, start) + 1)
    assert([365, 366].includes(dates.length))
    assert.equal(dates[0], format(start, "yyyy-MM-dd"))
    assert.equal(dates.at(-1), format(at, "yyyy-MM-dd"))
    for (let index = 0; index < cells.length; index++) {
      if (!cells[index]) continue
      assert.equal(new Date(`${cells[index]}T12:00:00`).getDay(), index % 7)
    }
    dates.forEach((date, index) =>
      assert.equal(date, format(addDays(start, index), "yyyy-MM-dd"))
    )
  }
})

test("热力图跳转使用北京时间的完整自然日，跨年与闰日的次日上界不重复计入", () => {
  assert.deepEqual(memberActivityBounds("2025-12-31"), {
    from: "2025-12-30T16:00:00.000Z",
    until: "2025-12-31T16:00:00.000Z",
  })
  assert.deepEqual(memberActivityBounds("2024-02-29"), {
    from: "2024-02-28T16:00:00.000Z",
    until: "2024-02-29T16:00:00.000Z",
  })
})

test("每天对话次数按每次 5% 线性映射 emerald 透明度，并在 20 次封顶", () => {
  for (const count of [0, 1, 2, 5, 10, 19, 20, 21, 100]) {
    assert.equal(memberActivityOpacity(count), Math.min(1, count / 20))
  }
  for (const invalid of [-1, NaN, Infinity])
    assert.equal(memberActivityOpacity(invalid), 0)
})
