import assert from "node:assert/strict"
import test from "node:test"
import {
  tableQueryParams,
  tableQueryState,
  queryDate,
  queryDateValue,
} from "../src/lib/table-query.ts"

const keys = ["task", "task_id", "user", "user_id", "content", "from", "until"]
test("table URL state round-trips literal searches, dates and paging", () => {
  const filters = {
    task: "任务 + & %",
    task_id: "id",
    user: " 张三 ",
    user_id: "00000000-0000-4000-8000-000000000001",
    content: "hello?world#",
    from: "2026-10-01T01:02:03.456Z",
    until: "2026-10-02T04:05:06.789Z",
  }
  const params = tableQueryParams(
    "source=shared&task=old&page=9&page_size=500",
    keys,
    filters,
    2,
    20
  )
  assert.equal(params.get("source"), "shared")
  const state = tableQueryState(params.toString(), keys)
  assert.deepEqual(state.filters, filters)
  assert.equal(state.page, 2)
  assert.equal(state.pageSize, 20)
  const cleared = tableQueryParams(params.toString(), keys, {}, 1, 50)
  assert.equal(cleared.toString(), "source=shared")
})
test("table paging validates bounds and the shared size options", () => {
  for (const query of [
    "page=-1",
    "page=oops",
    "page=1.5",
    "page=1000001",
    "page_size=501",
    "page_size=21",
  ]) {
    const state = tableQueryState(query, [])
    assert.equal(state.page, 1)
    assert.equal(state.pageSize, 50)
  }
  for (const size of [20, 50, 100, 200, 500])
    assert.equal(tableQueryState(`page_size=${size}`, []).pageSize, size)
})
test("restored date bounds retain their exact precision when resubmitted", () => {
  const from = "2026-10-01T10:20:30.123456Z",
    until = "2026-10-02T13:14:15.654321Z"
  assert.equal(queryDateValue(queryDate(from), from, "from"), from)
  assert.equal(
    queryDateValue(queryDate(until, true), until, "exclusiveUntil"),
    until
  )
  assert.equal(queryDateValue(queryDate(until), until, "inclusiveUntil"), until)
  assert.equal(queryDate("bad"), undefined)
  assert.equal(queryDateValue(undefined, from, "from"), "")
})
test("calendar edits retain inclusive audit and exclusive history boundaries", () => {
  const day = new Date(2026, 9, 29)
  const end = new Date(2026, 9, 29, 23, 59, 59, 999)
  const next = new Date(2026, 9, 30)
  assert.equal(queryDateValue(day, undefined, "from"), day.toISOString())
  assert.equal(
    queryDateValue(day, undefined, "inclusiveUntil"),
    end.toISOString()
  )
  assert.equal(
    queryDateValue(day, undefined, "exclusiveUntil"),
    next.toISOString()
  )
})
