import assert from "node:assert/strict"
import test from "node:test"

import { compareMembers } from "../src/lib/member-sorting.ts"

const members = [
  { id: "z", role: "user", joined_at: "2026-03-01T00:00:00Z" },
  { id: "b", role: "admin", joined_at: "2025-01-01T00:00:00Z" },
  { id: "a", role: "admin", joined_at: "2025-01-01T00:00:00Z" },
  { id: "c", role: "admin", joined_at: "2026-02-01T00:00:00Z" },
  { id: "d", role: "user", joined_at: "2024-01-01T00:00:00Z" },
]

test("members sort admins first, then by join date oldest first with stable ties", () => {
  assert.deepEqual(
    [...members].sort(compareMembers).map((member) => member.id),
    ["a", "b", "c", "d", "z"]
  )
  assert.equal(members[0].id, "z")
})

test("changing a member to admin moves them above regular members", () => {
  const promoted = members.map((member) =>
    member.id === "z" ? { ...member, role: "admin" } : member
  )
  assert.deepEqual(
    promoted.sort(compareMembers).map((member) => member.id),
    ["a", "b", "c", "z", "d"]
  )
})
