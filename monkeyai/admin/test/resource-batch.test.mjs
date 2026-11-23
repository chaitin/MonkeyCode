import assert from "node:assert/strict"
import test from "node:test"
import { applyResourceBatch } from "../src/lib/resource-batch.ts"

const paths = {
  skill: "skills",
  expert: "experts",
  connector: "connectors",
  rule: "rules",
}
const row = (id, extra = {}) => ({
  id,
  name: `Canonical ${id}`,
  description: `Description ${id}`,
  revision: 7,
  ownership_type: "system",
  origin: "admin",
  content: "Original rule content",
  prompt: "Original expert prompt",
  grants: [{ group_id: "required", usage_requirement: "required" }],
  ...extra,
})

test("启停四类资源时逐项校验版本", async () => {
  for (const [kind, endpoint] of Object.entries(paths)) {
    for (const action of ["enable", "disable"]) {
      const calls = []
      const progress = []
      const result = await applyResourceBatch(
        kind,
        [
          row("local"),
          row("package", { origin: "package", revision: 12 }),
          row("personal", { ownership_type: "user" }),
        ],
        { action },
        async (path, init) => calls.push({ path, ...init }),
        (value) => progress.push(value)
      )
      assert.deepEqual(
        progress,
        [1, 2, 3].map((completed) => ({ completed, total: 3 }))
      )
      assert.deepEqual(result, {
        succeeded: ["local", "package"],
        skipped: ["personal"],
        failed: [],
      })
      assert.deepEqual(
        calls.map(({ path, method, headers, body }) => [
          path,
          method,
          headers,
          JSON.parse(body),
        ]),
        [
          ["local", '"7"'],
          ["package", '"12"'],
        ].map(([id, version]) => [
          `/api/admin/v1/${endpoint}/${id}/enabled`,
          "PATCH",
          { "If-Match": version },
          { enabled: action === "enable" },
        ])
      )
    }
  }
})

test("修改四类资源标签时保留必要内容", async () => {
  for (const [kind, endpoint] of Object.entries(paths)) {
    const calls = []
    const local = row("local", {
      name_i18n: { "zh-CN": "显示名称" },
      description_i18n: { "zh-CN": "显示说明" },
    })
    const result = await applyResourceBatch(
      kind,
      [local, row("package", { origin: "package" })],
      { action: "tags", tagIds: ["a", "a", "b"] },
      async (path, init) => calls.push({ path, ...init })
    )
    assert.deepEqual(result, {
      succeeded: ["local"],
      skipped: ["package"],
      failed: [],
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].path, `/api/admin/v1/${endpoint}/local`)
    assert.equal(calls[0].method, "PUT")
    assert.deepEqual(calls[0].headers, { "If-Match": '"7"' })
    assert.deepEqual(JSON.parse(calls[0].body), {
      name: "Canonical local",
      description: "Description local",
      ...(kind === "expert" ? { prompt: "Original expert prompt" } : {}),
      ...(kind === "rule" ? { content: "Original rule content" } : {}),
      tag_ids: ["a", "b"],
    })
    await applyResourceBatch(
      kind,
      [row("local")],
      { action: "tags", tagIds: [] },
      async (_, init) => assert.deepEqual(JSON.parse(init.body).tag_ids, [])
    )
  }
})

test("四类资源授权保留强制规则", async () => {
  for (const kind of Object.keys(paths)) {
    const calls = []
    await applyResourceBatch(
      kind,
      [row("package", { origin: "package" })],
      {
        action: "authorization",
        authorization: { groupIds: ["required", "new"], memberIds: ["member"] },
      },
      async (path, init) => calls.push({ path, ...init })
    )
    assert.equal(
      calls[0].path,
      `/api/admin/v1/resources/${kind}/package/grants`
    )
    assert.deepEqual(JSON.parse(calls[0].body), {
      grants: [
        { group_id: "required", usage_requirement: "required" },
        { group_id: "new", usage_requirement: "optional" },
        { user_id: "member", usage_requirement: "optional" },
      ],
    })
    assert.deepEqual(calls[0].headers, { "If-Match": '"7"' })
  }
})

test("删除四类资源时跳过受保护项并报告冲突", async () => {
  for (const [kind, endpoint] of Object.entries(paths)) {
    const calls = [],
      progress = []
    const result = await applyResourceBatch(
      kind,
      [
        row("a"),
        row("a"),
        row("stale"),
        row("package", { origin: "package" }),
        row("personal", { ownership_type: "user" }),
        row("last", { revision: 8 }),
      ],
      { action: "delete" },
      async (path, init) => {
        calls.push({ path, ...init })
        if (path.endsWith("/stale")) throw new Error("资源已更新，请刷新后重试")
      },
      (value) => progress.push(value)
    )
    assert.deepEqual(result.succeeded, ["a", "last"])
    assert.deepEqual(result.skipped, ["package", "personal"])
    assert.deepEqual(result.failed, [
      {
        id: "stale",
        name: "Canonical stale",
        message: "资源已更新，请刷新后重试",
      },
    ])
    assert.deepEqual(
      calls,
      [
        ["a", '"7"'],
        ["stale", '"7"'],
        ["last", '"8"'],
      ].map(([id, version]) => ({
        path: `/api/admin/v1/${endpoint}/${id}`,
        method: "DELETE",
        headers: { "If-Match": version },
      }))
    )
    assert.deepEqual(
      progress,
      [1, 2, 3, 4, 5].map((completed) => ({ completed, total: 5 }))
    )
  }
})
