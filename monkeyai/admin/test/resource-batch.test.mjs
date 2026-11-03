import assert from "node:assert/strict"
import test from "node:test"
import { applyResourceBatch } from "../src/lib/resource-batch.ts"

const paths = { skill: "skills", expert: "experts", connector: "connectors", rule: "rules" }
const row = (id, extra = {}) => ({
  id, name: `Canonical ${id}`, description: `Description ${id}`, revision: 7,
  ownership_type: "system", origin: "admin", content: "Original rule content", prompt: "Original expert prompt",
  grants: [{ group_id: "required", usage_requirement: "required" }], ...extra,
})

for (const [kind, endpoint] of Object.entries(paths)) {
  test(`${kind}: toggles include package resources and version every request`, async () => {
    for (const action of ["enable", "disable"]) {
      const calls = []
      const result = await applyResourceBatch(kind, [row("local"), row("package", { origin: "package" }), row("personal", { ownership_type: "user" })], { action }, async (path, init) => calls.push({ path, ...init }))
      assert.deepEqual(result, { succeeded: ["local", "package"], skipped: ["personal"], failed: [] })
      assert.deepEqual(calls.map(({ path, method, headers, body }) => [path, method, headers, JSON.parse(body)]), ["local", "package"].map((id) => [`/api/admin/v1/${endpoint}/${id}/enabled`, "PATCH", { "If-Match": '"7"' }, { enabled: action === "enable" }]))
    }
  })
  test(`${kind}: tags preserve canonical required content and omit unrelated configuration`, async () => {
    const calls = []
    const result = await applyResourceBatch(kind, [row("local"), row("package", { origin: "package" })], { action: "tags", tagIds: ["a", "a", "b"] }, async (path, init) => calls.push({ path, ...init }))
    assert.deepEqual(result, { succeeded: ["local"], skipped: ["package"], failed: [] })
    assert.equal(calls[0].path, `/api/admin/v1/${endpoint}/local`)
    assert.deepEqual(JSON.parse(calls[0].body), { name: "Canonical local", description: "Description local", ...(kind === "expert" ? { prompt: "Original expert prompt" } : {}), ...(kind === "rule" ? { content: "Original rule content" } : {}), tag_ids: ["a", "b"] })
    await applyResourceBatch(kind, [row("local")], { action: "tags", tagIds: [] }, async (_, init) => assert.deepEqual(JSON.parse(init.body).tag_ids, []))
  })
  test(`${kind}: authorization replaces scope using the grants API and preserves required rules`, async () => {
    const calls = []
    await applyResourceBatch(kind, [row("package", { origin: "package" })], { action: "authorization", authorization: { groupIds: ["required", "new"], memberIds: ["member"] } }, async (path, init) => calls.push({ path, ...init }))
    assert.equal(calls[0].path, `/api/admin/v1/resources/${kind}/package/grants`)
    assert.deepEqual(JSON.parse(calls[0].body), { grants: [{ group_id: "required", usage_requirement: "required" }, { group_id: "new", usage_requirement: "optional" }, { user_id: "member", usage_requirement: "optional" }] })
    assert.deepEqual(calls[0].headers, { "If-Match": '"7"' })
  })
  test(`${kind}: delete skips package/personal resources, continues after conflict, and reports progress`, async () => {
    const calls = [], progress = []
    const result = await applyResourceBatch(kind, [row("a"), row("a"), row("stale"), row("package", { origin: "package" }), row("personal", { ownership_type: "user" }), row("last")], { action: "delete" }, async (path, init) => {
      calls.push({ path, ...init })
      if (path.endsWith("/stale")) throw new Error("资源已更新，请刷新后重试")
    }, (value) => progress.push(value))
    assert.deepEqual(result.succeeded, ["a", "last"])
    assert.deepEqual(result.skipped, ["package", "personal"])
    assert.deepEqual(result.failed, [{ id: "stale", name: "Canonical stale", message: "资源已更新，请刷新后重试" }])
    assert.deepEqual(calls, ["a", "stale", "last"].map((id) => ({ path: `/api/admin/v1/${endpoint}/${id}`, method: "DELETE", headers: { "If-Match": '"7"' } })))
    assert.deepEqual(progress, [1, 2, 3, 4, 5].map((completed) => ({ completed, total: 5 })))
  })
}
