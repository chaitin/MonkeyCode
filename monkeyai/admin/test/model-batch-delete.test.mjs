import assert from "node:assert/strict"
import test from "node:test"

import { deleteModelBatch } from "../src/lib/model-batch-delete.ts"

const model = (id, type = "system") => ({ id, displayName: `模型 ${id}`, type })

test("model batch deletion deletes each selected system model once", async () => {
  const calls = []
  const progress = []
  const result = await deleteModelBatch(
    [model("text"), model("image"), model("video"), model("text"), model("personal", "user")],
    async (path, init) => calls.push([path, init]),
    (value) => progress.push(value)
  )
  assert.deepEqual(calls, ["text", "image", "video"].map((id) => [`/api/admin/v1/models/${id}`, { method: "DELETE" }]))
  assert.deepEqual(result, { succeeded: ["text", "image", "video"], failed: [] })
  assert.deepEqual(progress, [1, 2, 3].map((completed) => ({ completed, total: 3 })))
})

test("model batch deletion collects per-model errors and continues without automatic retries", async () => {
  const calls = []
  const result = await deleteModelBatch([model("a"), model("b"), model("c")], async (path) => {
    calls.push(path)
    if (path.endsWith("/b")) throw new Error("删除失败")
  })
  assert.equal(calls.length, 3)
  assert.deepEqual(result, {
    succeeded: ["a", "c"],
    failed: [{ id: "b", name: "模型 b", message: "删除失败" }],
  })
  const retried = []
  await deleteModelBatch([model("a"), model("b"), model("c")].filter((item) => result.failed.some(({ id }) => id === item.id)), async (path) => retried.push(path))
  assert.deepEqual(retried, ["/api/admin/v1/models/b"])
})

test("empty and user-only model batches perform no requests", async () => {
  for (const rows of [[], [model("personal", "user")]]) {
    assert.deepEqual(await deleteModelBatch(rows, async () => assert.fail("Unexpected deletion")), { succeeded: [], failed: [] })
  }
})

test("model delete accepts a 204 response through the real HTTP client", async (t) => {
  const calls = []
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, ...init })
    return new Response(null, { status: 204 })
  })
  assert.deepEqual(await deleteModelBatch([model("a")]), { succeeded: ["a"], failed: [] })
  assert.equal(calls[0].path, "/api/admin/v1/models/a")
  assert.equal(calls[0].method, "DELETE")
  assert.equal(calls[0].credentials, "include")
  assert.equal(calls[0].body, undefined)
})
