import assert from "node:assert/strict"
import test from "node:test"
import { changeGroupSelection } from "../src/lib/group-selection.ts"

const empty = { groupIds: [], userIds: [] }

test("multi-selection keeps groups and users separate even when IDs match", () => {
  const groups = changeGroupSelection(
    empty,
    "group",
    "same",
    true,
    true,
    "both"
  )
  const both = changeGroupSelection(groups, "user", "same", true, true, "both")
  assert.deepEqual(both, { groupIds: ["same"], userIds: ["same"] })
  assert.deepEqual(
    changeGroupSelection(both, "user", "same", false, true, "both"),
    groups
  )
  assert.deepEqual(empty, { groupIds: [], userIds: [] })
})

test("a user shown under multiple groups is selected once", () => {
  const first = changeGroupSelection(empty, "user", "u1", true, true, "users")
  assert.deepEqual(
    changeGroupSelection(first, "user", "u1", true, true, "users"),
    first
  )
  assert.deepEqual(
    changeGroupSelection(first, "user", "u1", false, true, "users"),
    empty
  )
})

test("single selection replaces prior group and user selections", () => {
  const previous = { groupIds: ["g1", "g2"], userIds: ["u1"] }
  assert.deepEqual(
    changeGroupSelection(previous, "user", "u2", true, false, "both"),
    {
      groupIds: [],
      userIds: ["u2"],
    }
  )
  const group = changeGroupSelection(
    previous,
    "group",
    "g3",
    true,
    false,
    "both"
  )
  assert.deepEqual(group, { groupIds: ["g3"], userIds: [] })
  assert.deepEqual(
    changeGroupSelection(group, "group", "g3", false, false, "both"),
    empty
  )
})

test("selection modes reject nodes of the wrong kind", () => {
  assert.strictEqual(
    changeGroupSelection(empty, "user", "u1", true, true, "groups"),
    empty
  )
  assert.strictEqual(
    changeGroupSelection(empty, "group", "g1", true, true, "users"),
    empty
  )
  assert.deepEqual(
    changeGroupSelection(empty, "group", "g1", true, true, "groups"),
    {
      groupIds: ["g1"],
      userIds: [],
    }
  )
})
