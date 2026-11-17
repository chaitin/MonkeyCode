import assert from "node:assert/strict"
import test from "node:test"
import { loadEngineHosts } from "../src/lib/engine-hosts.ts"

test("宿主机超过接口单页上限时加载全部记录，并传递取消信号", async (t) => {
  const hosts = Array.from({ length: 205 }, (_, id) => ({ id }))
  const pages = []
  const controller = new AbortController()
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(init.signal, controller.signal)
    const query = new URL(path, "http://localhost").searchParams
    const page = Number(query.get("page"))
    assert.equal(query.get("page_size"), "100")
    pages.push(page)
    return Response.json({
      items: hosts.slice((page - 1) * 100, page * 100),
      total: hosts.length,
    })
  })
  assert.deepEqual(
    await loadEngineHosts("/api/admin/v1/engine-hosts", {
      signal: controller.signal,
    }),
    { items: hosts, total: 205 }
  )
  assert.deepEqual(pages, [1, 2, 3])
})

test("宿主机为空时只请求一次", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ items: [], total: 0 })
  )
  assert.deepEqual(await loadEngineHosts("/api/admin/v1/engine-hosts"), {
    items: [],
    total: 0,
  })
  assert.equal(request.mock.callCount(), 1)
})

test("后续页失败时不将不完整列表作为成功结果", async (t) => {
  let page = 0
  t.mock.method(globalThis, "fetch", async () => {
    page++
    return page === 1
      ? Response.json({
          items: Array.from({ length: 100 }, (_, id) => ({ id })),
          total: 101,
        })
      : Response.json({ error: { message: "加载失败" } }, { status: 503 })
  })
  await assert.rejects(
    loadEngineHosts("/api/admin/v1/engine-hosts"),
    /加载失败/
  )
})
