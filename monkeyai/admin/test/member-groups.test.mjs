import assert from "node:assert/strict"
import test from "node:test"
import {
  ROOT_GROUP_ID,
  compareByName,
  descendantIDs,
  directMemberIDs,
  directGroupsByMember,
  groupMemberIDs,
} from "../src/lib/member-groups.ts"

const groups = [
  { id: ROOT_GROUP_ID, parent_id: null, name: "团队", member_ids: ["d"] },
  { id: "parent", parent_id: ROOT_GROUP_ID, name: "研发", member_ids: ["a"] },
  { id: "child", parent_id: "parent", name: "前端", member_ids: ["a", "b"] },
  { id: "other", parent_id: ROOT_GROUP_ID, name: "产品", member_ids: ["c"] },
]

test("父分组成员包含后代且跨组去重，移动后更新继承", () => {
  assert.deepEqual([...groupMemberIDs(groups, "parent")].sort(), [
    "a",
    "b",
  ])
  const moved = groups.map((group) =>
    group.id === "child" ? { ...group, parent_id: "other" } : group
  )
  assert.deepEqual([...groupMemberIDs(moved, "parent")], ["a"])
  assert.deepEqual([...groupMemberIDs(moved, "other")].sort(), [
    "a",
    "b",
    "c",
  ])
})

test("根节点汇总后端直属成员与子组成员，空分组列表不推断成员", () => {
  assert.equal(groupMemberIDs([], ROOT_GROUP_ID).size, 0)
  assert.equal(groupMemberIDs(groups, ROOT_GROUP_ID).size, 4)
  assert.deepEqual([...groupMemberIDs(groups, "other")], ["c"])
  assert.equal(groupMemberIDs(groups, "missing").size, 0)
})

test("分组成员仅由关联决定，不根据角色和顶层位置自动加入", () => {
  const empty = {
    id: "custom",
    name: "管理员",
    parent_id: null,
    member_ids: [],
  }
  assert.equal(groupMemberIDs([...groups, empty], empty.id).size, 0)
  const moved = groups.map((group) =>
    group.id === "child" ? { ...group, parent_id: ROOT_GROUP_ID } : group
  )
  assert.deepEqual([...groupMemberIDs(moved, "parent")], ["a"])
  assert.deepEqual([...groupMemberIDs(moved, "child")].sort(), [
    "a",
    "b",
  ])
})

test("树节点只列后端返回的直接成员，新用户默认在根节点", () => {
  assert.deepEqual([...directMemberIDs(groups, "parent")], ["a"])
  assert.deepEqual([...directMemberIDs(groups, "child")].sort(), ["a", "b"])
  assert.deepEqual([...directMemberIDs(groups, ROOT_GROUP_ID)], ["d"])
  assert.deepEqual([...directMemberIDs(groups, "missing")], [])
})

test("同层分组和成员按当前语言的名称排序，同名时按 ID 稳定排序", () => {
  const collator = new Intl.Collator("en-US", {
    sensitivity: "base",
    numeric: true,
  })
  const entries = [
    { id: "z", name: "Group 10" },
    { id: "b", name: "alpha" },
    { id: "c", name: "Beta" },
    { id: "a", name: "Alpha" },
    { id: "d", name: "Group 2" },
  ]
  assert.deepEqual(
    [...entries]
      .sort((a, b) => compareByName(a, b, collator))
      .map((entry) => entry.id),
    ["a", "b", "c", "d", "z"]
  )
  assert.equal(entries[0].id, "z")
})

test("成员徽章只列直接加入的分组，多组按名称排序", () => {
  const collator = new Intl.Collator("en-US", { sensitivity: "base" })
  const memberships = directGroupsByMember(
    [
      { id: ROOT_GROUP_ID, name: "团队", parent_id: null, member_ids: ["c"] },
      {
        id: "engineering",
        name: "Engineering",
        parent_id: null,
        member_ids: ["a", "a"],
      },
      { id: "design", name: "Design", parent_id: null, member_ids: ["a"] },
      {
        id: "frontend",
        name: "Frontend",
        parent_id: "engineering",
        member_ids: ["b"],
      },
    ],
    collator
  )
  assert.deepEqual(
    memberships.get("a")?.map((group) => group.name),
    ["Design", "Engineering"]
  )
  assert.deepEqual(
    memberships.get("b")?.map((group) => group.name),
    ["Frontend"]
  )
  assert.deepEqual(memberships.get("c")?.map((group) => group.name), ["团队"])
})

test("移动目标排除自身和全部后代，并可处理重复访问", () => {
  assert.deepEqual([...descendantIDs(groups, "parent")], ["parent", "child"])
  assert.deepEqual(
    [
      ...descendantIDs(
        [...groups, { id: "parent", parent_id: "child", member_ids: [] }],
        "parent"
      ),
    ],
    ["parent", "child"]
  )
})
