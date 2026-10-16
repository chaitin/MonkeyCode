import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

test("技能上传代理允许 500 MiB 包并保留 multipart 开销", () => {
  const config = readFileSync(new URL("../nginx/app.conf", import.meta.url), "utf8")
  const locations = [...config.matchAll(/location ~ (\S+) \{([^}]+)\}/g)].map(
    ([, pattern, body]) => ({ pattern: new RegExp(pattern), body })
  )
  const matchingLocation = (path) =>
    locations.find(({ pattern }) => pattern.test(path))?.body

  for (const path of [
    "/api/admin/v1/skills",
    "/api/admin/v1/skills/owned/package",
    "/api/v1/skills",
    "/api/v1/skills/owned/package",
  ]) {
    const body = matchingLocation(path)
    assert.match(body, /client_max_body_size 501m;/, path)
    assert.match(body, /proxy_request_buffering off;/, path)
  }
  for (const path of ["/api/admin/v1/rules", "/api/v1/skills/owned/manifest"]) {
    assert.doesNotMatch(matchingLocation(path), /client_max_body_size/, path)
  }
  for (const path of [
    "/api/admin/v1/resource-imports",
    "/api/admin/v1/resource-imports/preview",
  ]) {
    assert.match(matchingLocation(path), /client_max_body_size 2064m;/, path)
  }
})
