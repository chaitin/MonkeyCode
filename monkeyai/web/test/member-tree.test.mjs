import assert from "node:assert/strict"
import test from "node:test"
import { buildMemberTree, flattenMemberTree } from "../src/lib/member-tree.ts"

const collator = new Intl.Collator("en-US", {
  sensitivity: "base",
  numeric: true,
})
const group = (id, parent_id, member_ids = [], name = id) => ({
  id,
  parent_id,
  member_ids,
  name,
  actions: ["rename", "move"],
  allow_add_members: true,
})
const users = [
  { id: "b", name: "Member 10", avatar_url: "https://example.com/b.png" },
  { id: "a", name: "Member 2" },
  { id: "c", name: "Member 3" },
  { id: "d", name: "Member 4" },
]
const groups = [
  group("root", null, ["d", "d"]),
  group("g10", "root", ["c"], "Group 10"),
  group("g2", "root", ["b", "a", "a"], "Group 2"),
  group("child", "g2", ["a", "missing"]),
]

test("tree index preserves direct membership, natural order and deduplicated descendant counts", () => {
  const tree = buildMemberTree(groups, users, collator)
  assert.deepEqual(
    tree.children.get("root").map((g) => g.id),
    ["g2", "g10"]
  )
  assert.deepEqual(
    tree.members.get("g2").map((u) => u.id),
    ["a", "b"]
  )
  assert.equal(tree.members.get("g2")[1], users[0])
  assert.deepEqual(
    tree.members.get("child").map((u) => u.id),
    ["a"]
  )
  assert.equal(tree.counts.get("child"), 2)
  assert.equal(tree.counts.get("g2"), 3)
  assert.equal(tree.counts.get("root"), 5)
  assert.deepEqual(groups[2].member_ids, ["b", "a", "a"])
  assert.deepEqual(
    users.map((u) => u.id),
    ["b", "a", "c", "d"]
  )
})

test("deep trees compute and flatten without recursive stack growth", () => {
  const depth = 10000
  const deep = Array.from({ length: depth }, (_, index) =>
    group(
      String(index),
      index === 0 ? null : String(index - 1),
      index === depth - 1 ? ["a"] : []
    )
  )
  const tree = buildMemberTree(deep, users, collator)
  assert.equal(tree.counts.get("0"), 1)
  assert.equal(tree.counts.get(String(depth - 1)), 1)
  const rows = flattenMemberTree(tree, new Map(deep.map((g) => [g.id, true])))
  assert.equal(rows.length, depth + 1)
  assert.equal(rows.at(-1).level, depth)
  assert.equal(rows.at(-1).key, `member:${depth - 1}:a`)
})
