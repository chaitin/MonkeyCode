import assert from "node:assert/strict"
import test from "node:test"

import { applySkillBatch } from "../src/lib/skill-batch.ts"

function skill(id, overrides = {}) {
  return {
    id,
    name: `Canonical ${id}`,
    description: `Canonical description ${id}`,
    ownership_type: "system",
    origin: "admin",
    revision: 7,
    grants: [],
    ...overrides,
  }
}

for (const action of ["enable", "disable"]) {
  test(`${action} uses versioned requests for local/package skills and skips personal skills`, async () => {
    const requests = []
    const progress = []
    const result = await applySkillBatch(
      [skill("a"), skill("b", { revision: 12 }), skill("package", { origin: "package" }), skill("personal", { ownership_type: "user" })],
      { action },
      async (path, init) => requests.push({ path, ...init }),
      (value) => progress.push(value)
    )
    assert.deepEqual(requests.map(({ path, method, headers, body }) => [path, method, headers["If-Match"], JSON.parse(body)]), [
      ["/api/admin/v1/skills/a/enabled", "PATCH", '"7"', { enabled: action === "enable" }],
      ["/api/admin/v1/skills/b/enabled", "PATCH", '"12"', { enabled: action === "enable" }],
      ["/api/admin/v1/skills/package/enabled", "PATCH", '"7"', { enabled: action === "enable" }],
    ])
    assert.deepEqual(result, { succeeded: ["a", "b", "package"], skipped: ["personal"], failed: [] })
    assert.deepEqual(progress, [1, 2, 3, 4].map((completed) => ({ completed, total: 4 })))
  })
}

test("delete sends If-Match and skips package and personal skills", async () => {
  const calls = []
  const result = await applySkillBatch(
    [skill("a"), skill("b", { revision: 8 }), skill("package", { origin: "package" }), skill("personal", { ownership_type: "user" })],
    { action: "delete" },
    async (path, init) => calls.push({ path, ...init })
  )
  assert.deepEqual(calls, [
    { path: "/api/admin/v1/skills/a", method: "DELETE", headers: { "If-Match": '"7"' } },
    { path: "/api/admin/v1/skills/b", method: "DELETE", headers: { "If-Match": '"8"' } },
  ])
  assert.deepEqual(result, { succeeded: ["a", "b"], skipped: ["package", "personal"], failed: [] })
})

test("delete reports reference/version conflicts and continues with remaining skills", async () => {
  const calls = []
  const result = await applySkillBatch([skill("referenced"), skill("stale"), skill("ok")], { action: "delete" }, async (path) => {
    calls.push(path)
    if (path.endsWith("/referenced")) throw new Error("资源仍被引用")
    if (path.endsWith("/stale")) throw new Error("资源已更新，请刷新后重试")
  })
  assert.equal(calls.length, 3)
  assert.deepEqual(result.succeeded, ["ok"])
  assert.deepEqual(result.failed.map(({ id, message }) => [id, message]), [
    ["referenced", "资源仍被引用"], ["stale", "资源已更新，请刷新后重试"],
  ])
})

test("package-only delete completes without sending requests", async () => {
  const result = await applySkillBatch([skill("package", { origin: "package" })], { action: "delete" }, async () => assert.fail("Package skill cannot be deleted"))
  assert.deepEqual(result, { succeeded: [], skipped: ["package"], failed: [] })
})

test("tag replacement preserves canonical metadata and omits content, grants and enabled", async () => {
  const requests = []
  const resource = skill("a", {
    name_i18n: { "zh-CN": "显示名称" },
    description_i18n: { "zh-CN": "显示说明" },
  })
  await applySkillBatch([resource, skill("package", { origin: "package" })], { action: "tags", tagIds: ["review", "security", "review"] }, async (path, init) => requests.push({ path, ...init }))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, "/api/admin/v1/skills/a")
  assert.equal(requests[0].method, "PUT")
  assert.equal(requests[0].headers["If-Match"], '"7"')
  assert.deepEqual(JSON.parse(requests[0].body), {
    name: resource.name,
    description: resource.description,
    tag_ids: ["review", "security"],
  })
  await applySkillBatch([resource], { action: "tags", tagIds: [] }, async (_, init) => {
    assert.deepEqual(JSON.parse(init.body).tag_ids, [])
  })
})

test("package-only tag batches complete by skipping every resource without requests", async () => {
  const progress = []
  const result = await applySkillBatch(
    [skill("package-a", { origin: "package" }), skill("package-b", { origin: "package" })],
    { action: "tags", tagIds: ["review"] },
    async () => assert.fail("Package tags must not be written"),
    (value) => progress.push(value)
  )
  assert.deepEqual(result, { succeeded: [], failed: [], skipped: ["package-a", "package-b"] })
  assert.deepEqual(progress, [{ completed: 1, total: 2 }, { completed: 2, total: 2 }])
})

test("authorization uses the grants endpoint for local/package skills and preserves required flags", async () => {
  const resources = [skill("local"), skill("package", { origin: "package" })].map((row) => ({
    ...row,
    grants: [
      { group_id: "existing", usage_requirement: "required" },
      { user_id: "member", usage_requirement: "required" },
      { user_id: "removed", usage_requirement: "optional" },
    ],
  }))
  const calls = []
  const result = await applySkillBatch(resources, { action: "authorization", authorization: { groupIds: ["existing", "new", "existing"], memberIds: ["member", "new-user"] } }, async (path, init) => calls.push({ path, ...init }))
  assert.deepEqual(result.succeeded, ["local", "package"])
  assert.deepEqual(result.skipped, [])
  assert.deepEqual(calls.map((call) => call.path), ["/api/admin/v1/resources/skill/local/grants", "/api/admin/v1/resources/skill/package/grants"])
  for (const call of calls) {
    assert.equal(call.method, "PUT")
    assert.equal(call.headers["If-Match"], '"7"')
    assert.deepEqual(JSON.parse(call.body), { grants: [
      { group_id: "existing", usage_requirement: "required" },
      { group_id: "new", usage_requirement: "optional" },
      { user_id: "member", usage_requirement: "required" },
      { user_id: "new-user", usage_requirement: "optional" },
    ] })
  }
})

test("failures do not abort the batch or retry stale revisions automatically", async () => {
  const calls = []
  const progress = []
  const result = await applySkillBatch([skill("conflict"), skill("ok"), skill("retired", { origin: "package" })], { action: "authorization", authorization: { groupIds: ["group"], memberIds: [] } }, async (path) => {
    calls.push(path)
    if (path.includes("/conflict/")) throw new Error("资源版本冲突")
    if (path.includes("/retired/")) throw new Error("退役资源只能撤销现有授权")
  }, (value) => progress.push(value.completed))
  assert.equal(calls.length, 3)
  assert.deepEqual(result.succeeded, ["ok"])
  assert.deepEqual(result.failed, [
    { id: "conflict", name: "Canonical conflict", message: "资源版本冲突" },
    { id: "retired", name: "Canonical retired", message: "退役资源只能撤销现有授权" },
  ])
  assert.deepEqual(progress, [1, 2, 3])
})

test("a running batch captures the tag draft and deduplicates resources", async () => {
  let release
  const first = new Promise((resolve) => { release = resolve })
  const change = { action: "tags", tagIds: ["original"] }
  const bodies = []
  const execution = applySkillBatch([skill("a"), skill("a"), skill("b")], change, async (_, init) => {
    bodies.push(JSON.parse(init.body))
    if (bodies.length === 1) await first
  })
  change.tagIds.push("changed-during-submit")
  release()
  const result = await execution
  assert.deepEqual(result.succeeded, ["a", "b"])
  assert.deepEqual(bodies.map((body) => body.tag_ids), [["original"], ["original"]])
})

test("authorization captures both recipient lists before submission", async () => {
  let release
  const first = new Promise((resolve) => { release = resolve })
  const change = { action: "authorization", authorization: { groupIds: ["group"], memberIds: ["member"] } }
  const bodies = []
  const execution = applySkillBatch([skill("a"), skill("b")], change, async (_, init) => {
    bodies.push(JSON.parse(init.body))
    if (bodies.length === 1) await first
  })
  change.authorization.groupIds.push("other")
  change.authorization.memberIds.length = 0
  release()
  await execution
  assert.deepEqual(bodies[0], bodies[1])
  assert.deepEqual(bodies[1].grants, [
    { group_id: "group", usage_requirement: "optional" },
    { user_id: "member", usage_requirement: "optional" },
  ])
})

test("the real HTTP client sends credentials, JSON and If-Match and exposes API errors", async (t) => {
  const calls = []
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls.push({ path, ...init })
    return new Response(JSON.stringify({ error: { message: "版本不匹配" } }), { status: 409, headers: { "Content-Type": "application/json" } })
  })
  const result = await applySkillBatch([skill("a")], { action: "enable" })
  assert.equal(calls[0].credentials, "include")
  assert.equal(calls[0].headers["Content-Type"], "application/json")
  assert.equal(calls[0].headers["If-Match"], '"7"')
  assert.equal(result.failed[0].message, "版本不匹配")
})
