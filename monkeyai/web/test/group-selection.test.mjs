import assert from "node:assert/strict"
import test from "node:test"
import { changeGroupSelection } from "../src/lib/group-selection.ts"

const empty = { groupIds: [], userIds: [] }

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
