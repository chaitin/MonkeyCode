import assert from "node:assert/strict"
import test from "node:test"
import {
  createGroupSearchIndex,
  searchGroupTree,
} from "../src/lib/group-select-search.ts"

const groups = [
  { id: "root", name: "Team" },
  { id: "eng", parentId: "root", name: "Engineering" },
  { id: "web", parentId: "eng", name: "Frontend" },
  { id: "ops", parentId: "root", name: "Operations" },
]
const users = [
  { id: "alice", name: "Alice", groupIds: ["web"] },
  { id: "bob", name: "Bob", groupIds: ["ops"] },
  { id: "sam", name: "Sam", groupIds: ["web", "ops"] },
  { id: "ungrouped", name: "Alex", groupIds: [] },
]

const chineseGroups = [
  { id: "root", name: "全部成员" },
  { id: "rd", parentId: "root", name: "研发团队" },
]
const chineseUsers = [
  {
    id: "zhang",
    name: "张三",
    email: "zhang.san@example.com",
    groupIds: ["rd"],
  },
  { id: "lv", name: "吕布", email: "warrior@example.org", groupIds: ["root"] },
]

for (const query of [
  "张三",
  "zhangsan",
  "ZHANG SAN",
  "zs",
  "zhāng sān",
  "ZHANG.SAN@EXAMPLE.COM",
  "san@example",
]) {
  test(`user search supports name, email and pinyin: ${query}`, () => {
    const result = searchGroupTree(chineseGroups, chineseUsers, query, "zh-CN")
    assert.deepEqual([...result.userIds], ["zhang"])
    assert.deepEqual([...result.groupIds].sort(), ["rd", "root"])
  })
}

for (const query of ["yanfatuandui", "yan fa", "yftd", "研发"]) {
  test(`group pinyin search retains its members: ${query}`, () => {
    const result = searchGroupTree(chineseGroups, chineseUsers, query)
    assert.deepEqual([...result.groupIds].sort(), ["rd", "root"])
    assert.deepEqual([...result.userIds], ["zhang"])
  })
}

for (const query of ["lvbu", "lü bu", "lǚ bù", "lb"]) {
  test(`umlaut pinyin matching: ${query}`, () => {
    assert.deepEqual(
      [...searchGroupTree(chineseGroups, chineseUsers, query).userIds],
      ["lv"]
    )
  })
}

test("prepared index gives the same results across changing queries", () => {
  const index = createGroupSearchIndex(chineseGroups, chineseUsers, "zh-CN")
  for (const query of ["zs", "example.org", "研发", "", "no match"]) {
    assert.deepEqual(
      searchGroupTree(chineseGroups, chineseUsers, query, "zh-CN", index),
      searchGroupTree(chineseGroups, chineseUsers, query, "zh-CN")
    )
  }
})

test("empty search keeps all groups and users", () => {
  const result = searchGroupTree(groups, users, "  ")
  assert.deepEqual(
    [...result.groupIds],
    groups.map((group) => group.id)
  )
  assert.deepEqual(
    [...result.userIds],
    users.map((user) => user.id)
  )
})

test("user name search preserves ancestors without unrelated rows", () => {
  const result = searchGroupTree(groups, users, " ALICE ")
  assert.deepEqual([...result.groupIds].sort(), ["eng", "root", "web"])
  assert.deepEqual([...result.userIds], ["alice"])
})

test("group search retains its subtree and members", () => {
  const result = searchGroupTree(groups, users, "engineering")
  assert.deepEqual([...result.groupIds].sort(), ["eng", "root", "web"])
  assert.deepEqual([...result.userIds], ["alice", "sam"])
  assert.equal(result.userIds.has("bob"), false)
})

test("folder-only search cannot match hidden users", () => {
  const result = searchGroupTree(groups, [], "Alice")
  assert.equal(result.groupIds.size, 0)
  assert.equal(result.userIds.size, 0)
})

test("ungrouped users can match without creating unrelated group paths", () => {
  const result = searchGroupTree(groups, users, "Alex")
  assert.equal(result.groupIds.size, 0)
  assert.deepEqual([...result.userIds], ["ungrouped"])
})

test("shared user matches include every parent path and one selection ID", () => {
  const result = searchGroupTree(groups, users, "Sam")
  assert.deepEqual([...result.groupIds].sort(), ["eng", "ops", "root", "web"])
  assert.deepEqual([...result.userIds], ["sam"])
})

test("missing matches are empty and cyclic parents terminate", () => {
  const result = searchGroupTree(groups, users, "missing")
  assert.equal(result.groupIds.size, 0)
  assert.equal(result.userIds.size, 0)
  const cycle = searchGroupTree(
    [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ],
    [],
    "A"
  )
  assert.deepEqual([...cycle.groupIds].sort(), ["a", "b"])
})
