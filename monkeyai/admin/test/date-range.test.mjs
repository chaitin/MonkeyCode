import assert from "node:assert/strict"
import test from "node:test"

import { endOfLocalDay, startOfLocalDay } from "../src/lib/date-range.ts"

test("audit date filters use fixed local day boundaries", () => {
  const selected = new Date(2026, 4, 17, 12, 34, 56, 789)
  const start = startOfLocalDay(selected)
  const end = endOfLocalDay(selected)

  assert.deepEqual(
    [
      start.getHours(),
      start.getMinutes(),
      start.getSeconds(),
      start.getMilliseconds(),
    ],
    [0, 0, 0, 0]
  )
  assert.deepEqual(
    [end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()],
    [23, 59, 59, 999]
  )
  assert.equal(selected.getHours(), 12)
})
