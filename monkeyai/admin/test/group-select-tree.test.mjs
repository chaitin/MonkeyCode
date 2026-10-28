import assert from "node:assert/strict"
import test from "node:test"
import {
  buildGroupSelectTree,
  flattenGroupSelectTree,
} from "../src/lib/group-select-tree.ts"
import { searchGroupTree } from "../src/lib/group-select-search.ts"
import {
  indexGroupSelection,
  inheritedGroupSelection,
  changeGroupSelection,
} from "../src/lib/group-selection.ts"

const groups = [
  { id: "root", name: "Workspace" },
  { id: "team", parentId: "root", name: "Team" },
  { id: "child", parentId: "team", name: "Child" },
  { id: "other", parentId: "root", name: "Other" },
]
const users = [
  {
    id: "shared",
    name: "张三",
    email: "zhang@example.com",
    groupIds: ["child", "other"],
    avatarUrl: "/avatar.webp",
  },
  { id: "root-user", name: "Root member", groupIds: ["root"] },
  { id: "orphan", name: "Ungrouped", groupIds: ["missing"] },
]
const tree = () => buildGroupSelectTree(groups, users, "zh-CN")

test("trees initially expand every group; collapsing branches preserves data", () => {
  const data = tree()
  const allRows = flattenGroupSelectTree(data, new Map(), true)
  assert.equal(
    allRows.filter((row) => row.kind === "group").every((row) => row.expanded),
    true
  )
  assert.equal(
    allRows.filter((row) => row.kind === "user" && row.user.id === "shared")
      .length,
    2
  )
  const rows = flattenGroupSelectTree(
    data,
    new Map([
      ["team", false],
      ["other", false],
    ]),
    true
  )
  assert.deepEqual(
    rows.map((row) => (row.kind === "group" ? row.group.id : row.user.id)),
    ["root", "other", "team", "root-user", "orphan"]
  )
  assert.equal(
    rows.find((row) => row.kind === "group" && row.group.id === "team")
      .expanded,
    false
  )
  assert.equal(data.usersByID.get("shared").avatarUrl, "/avatar.webp")
  const expanded = flattenGroupSelectTree(
    data,
    new Map([
      ["team", true],
      ["child", true],
      ["other", false],
    ]),
    true
  )
  assert.equal(
    expanded.filter((row) => row.kind === "user" && row.user.id === "shared")
      .length,
    1
  )
})

test("shared members have distinct stable row keys and shared authorization", () => {
  const rows = flattenGroupSelectTree(tree(), new Map(), true)
  const appearances = rows.filter(
    (row) => row.kind === "user" && row.user.id === "shared"
  )
  assert.equal(appearances.length, 2)
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length)
  const index = indexGroupSelection({ groups, users })
  const selected = changeGroupSelection(
    { groupIds: [], userIds: [] },
    "user",
    "shared",
    true,
    true,
    "both",
    index
  )
  assert.deepEqual(
    [...inheritedGroupSelection(selected, index).partialGroupIds].sort(),
    ["child", "other", "root", "team"]
  )
  const parent = changeGroupSelection(
    selected,
    "group",
    "team",
    true,
    true,
    "both",
    index
  )
  assert.deepEqual(parent, { groupIds: ["team"], userIds: [] })
  assert.equal(
    inheritedGroupSelection(parent, index).inheritedUserIds.has("shared"),
    true
  )
  assert.strictEqual(
    changeGroupSelection(parent, "user", "shared", false, true, "both", index),
    parent
  )
})

test("search temporarily opens matching ancestor paths and restores expansion", () => {
  const data = tree(),
    expansion = new Map([["root", false]])
  const before = flattenGroupSelectTree(data, expansion, true)
  for (const query of ["张三", "zhangsan", "zs", "zhang@example.com"]) {
    const visible = searchGroupTree(data.groups, data.users, query, "zh-CN")
    const rows = flattenGroupSelectTree(data, expansion, true, visible)
    assert.equal(
      rows.filter((row) => row.kind === "user" && row.user.id === "shared")
        .length,
      2,
      query
    )
    assert.equal(
      rows.some((row) => row.kind === "user" && row.user.id === "root-user"),
      false
    )
  }
  assert.deepEqual(flattenGroupSelectTree(data, expansion, true), before)
  assert.equal(expansion.get("root"), false)
})

test("large collapsed trees produce rows for expanded branches only", () => {
  const manyGroups = [
    { id: "root", name: "Root" },
    ...Array.from({ length: 100 }, (_, i) => ({
      id: `g${i}`,
      parentId: "root",
      name: `Team ${i}`,
    })),
  ]
  const manyUsers = Array.from({ length: 10000 }, (_, i) => ({
    id: `u${i}`,
    name: `Member ${i}`,
    groupIds: [`g${i % 100}`],
  }))
  const data = buildGroupSelectTree(manyGroups, manyUsers, "en-US")
  assert.equal(flattenGroupSelectTree(data, new Map(), true).length, 10101)
  const collapsed = new Map(
    manyGroups.slice(1).map((group) => [group.id, false])
  )
  assert.equal(flattenGroupSelectTree(data, collapsed, true).length, 101)
  assert.equal(
    flattenGroupSelectTree(data, new Map(collapsed).set("g0", true), true)
      .length,
    201
  )
  const index = indexGroupSelection({ groups: manyGroups, users: manyUsers })
  const selection = {
    groupIds: [],
    userIds: manyUsers.slice(-100).map((user) => user.id),
  }
  const state = inheritedGroupSelection(selection, index)
  assert.equal(state.partialGroupIds.size, 101)
  assert.equal(state.inheritedUserIds.size, 0)
})

test("updated membership gets a new index and invalid hierarchy cannot loop", () => {
  const first = indexGroupSelection({ groups, users })
  const updated = indexGroupSelection({
    groups,
    users: users.map((user) => ({ ...user, groupIds: ["other"] })),
  })
  const selection = { groupIds: [], userIds: ["shared"] }
  assert.equal(
    inheritedGroupSelection(selection, first).partialGroupIds.has("child"),
    true
  )
  assert.deepEqual(
    [...inheritedGroupSelection(selection, updated).partialGroupIds].sort(),
    ["other", "root"]
  )
  const invalid = buildGroupSelectTree(
    [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
      { id: "orphan", parentId: "missing", name: "Orphan" },
    ],
    []
  )
  assert.deepEqual(
    flattenGroupSelectTree(invalid, new Map(), true).map((row) => row.group.id),
    ["orphan"]
  )
})
