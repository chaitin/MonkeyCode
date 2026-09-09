import assert from "node:assert/strict"
import test from "node:test"
import { api, ApiError } from "../src/lib/api.ts"

test("上传保留 FormData，由浏览器生成 multipart boundary", async t => {
  const body = new FormData()
  body.set("package", new Blob(["zip-bytes"]), "skill.zip")
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/admin/v1/skills")
    assert.equal(init.body, body)
    assert.equal(init.headers["Content-Type"], undefined)
    assert.equal(init.credentials, "include")
    assert.equal(init.headers["If-Match"], '"2"')
    return Response.json({ id: "skill" })
  })
  assert.deepEqual(await api("/api/admin/v1/skills", { method: "POST", body, headers: { "If-Match": '"2"' } }), { id: "skill" })
})
test("并发保存错误保留状态与可显示消息", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({error:{code:"revision_conflict",message:"资源已更新，请刷新后重试"}}, {status:412}))
  await assert.rejects(api("/api/admin/v1/rules/id", {method:"PUT",body:JSON.stringify({content:"new"})}), e => e instanceof ApiError && e.status === 412 && e.message.includes("刷新"))
})
