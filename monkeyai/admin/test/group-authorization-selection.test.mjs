import assert from "node:assert/strict"
import test from "node:test"
import {
  changeGroupSelection,
  inheritedGroupSelection,
} from "../src/lib/group-selection.ts"

const hierarchy = {
  groups: [
    { id: "root" },
    { id: "engineering", parentId: "root" },
    { id: "frontend", parentId: "engineering" },
    { id: "operations", parentId: "root" },
  ],
  users: [
    { id: "alice", groupIds: ["frontend"] },
    { id: "bob", groupIds: ["operations"] },
    { id: "carol", groupIds: ["root"] },
    { id: "shared", groupIds: ["frontend", "operations"] },
  ],
}

const select = (value, kind, id, checked) =>
  changeGroupSelection(value, kind, id, checked, true, "both", hierarchy)

test("authorizing a parent replaces redundant descendants and preserves unrelated grants", () => {
  const value = {
    groupIds: ["frontend", "operations"],
    userIds: ["alice", "carol"],
  }
  const next = select(value, "group", "engineering", true)
  assert.deepEqual(next, {
    groupIds: ["operations", "engineering"],
    userIds: ["carol"],
  })
  assert.deepEqual(value, {
    groupIds: ["frontend", "operations"],
    userIds: ["alice", "carol"],
  })
})

test("root authorization covers all subgroups and users, including root members", () => {
  const next = select(
    { groupIds: ["frontend"], userIds: ["carol"] },
    "group",
    "root",
    true
  )
  assert.deepEqual(next, { groupIds: ["root"], userIds: [] })
  const state = inheritedGroupSelection(next, hierarchy)
  assert.deepEqual([...state.inheritedGroupIds].sort(), [
    "engineering",
    "frontend",
    "operations",
  ])
  assert.deepEqual([...state.inheritedUserIds].sort(), [
    "alice",
    "bob",
    "carol",
    "shared",
  ])
  assert.equal(state.partialGroupIds.size, 0)
  assert.deepEqual(select(next, "group", "root", false), {
    groupIds: [],
    userIds: [],
  })
})

test("inherited authorization cannot be removed through a child checkbox", () => {
  const value = { groupIds: ["engineering"], userIds: [] }
  assert.strictEqual(select(value, "group", "frontend", false), value)
  assert.strictEqual(select(value, "user", "alice", false), value)
  assert.strictEqual(select(value, "user", "shared", true), value)
})

test("explicit user and subgroup grants show partial selection on ancestors", () => {
  const state = inheritedGroupSelection(
    { groupIds: ["frontend"], userIds: ["bob"] },
    hierarchy
  )
  assert.deepEqual([...state.partialGroupIds].sort(), [
    "engineering",
    "operations",
    "root",
  ])
  assert.equal(state.inheritedUserIds.has("alice"), true)
  assert.equal(state.inheritedUserIds.has("bob"), false)
})

test("group selection without authorization inheritance remains independent", () => {
  const value = { groupIds: ["frontend"], userIds: ["alice"] }
  assert.deepEqual(
    changeGroupSelection(value, "group", "engineering", true, true, "both"),
    {
      groupIds: ["frontend", "engineering"],
      userIds: ["alice"],
    }
  )
})
