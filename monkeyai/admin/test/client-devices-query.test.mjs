import assert from "node:assert/strict"
import test from "node:test"
import {
  devicePageParams,
  devicePageState,
  deviceQuery,
} from "../src/lib/client-devices.ts"

test("client device search survives a URL round trip without losing literal characters", () => {
  const filters = {
    query: " 张三 + 设备 & 版本% ",
    user_id: "00000000-0000-4000-8000-000000000001",
    platform: "Windows",
    client_type: "desktop",
    client_version: "1.2.3",
    arch: "arm64",
    status: "revoked",
    from: "2026-10-01T00:00:00+08:00",
    until: "2026-11-01T00:00:00+08:00",
  }
  const params = devicePageParams("", filters, 3, 20)
  const restored = devicePageState(params.toString())
  assert.deepEqual(restored.filters, {
    ...filters,
    query: filters.query.trim(),
  })
  assert.equal(restored.page, 3)
  assert.equal(restored.pageSize, 20)
  assert.equal(
    new URLSearchParams(deviceQuery(restored.filters)).get("query"),
    filters.query.trim()
  )
})

test("cleared client device filters disappear while unrelated URL parameters remain", () => {
  const params = devicePageParams(
    "query=old&user_id=00000000-0000-4000-8000-000000000001&platform=linux&client_type=desktop&arch=x64&client_version=1&status=revoked&from=old&until=old&page=4&page_size=500&source=bookmark",
    { query: "  " },
    1,
    50
  )
  assert.equal(params.toString(), "source=bookmark")
  assert.deepEqual(devicePageState(params.toString()), {
    filters: {},
    page: 1,
    pageSize: 50,
  })
})

test("client device pagination rejects malformed values and accepts supported sizes", () => {
  for (const query of [
    "page=-1",
    "page=1.5",
    "page=oops",
    "page=1000001",
    "page_size=0",
    "page_size=999",
    "page_size=020",
  ]) {
    const { page, pageSize } = devicePageState(query)
    assert.equal(page, 1)
    assert.equal(pageSize, 50)
  }
  for (const pageSize of [20, 50, 100, 200, 500])
    assert.equal(devicePageState(`page_size=${pageSize}`).pageSize, pageSize)
})
