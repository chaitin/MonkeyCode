import assert from "node:assert/strict"
import test from "node:test"
import { ROOT_GROUP_ID, descendantIDs, groupMemberIDs } from "../src/lib/member-groups.ts"

const groups = [
  { id: "parent", parent_id: null, name: "研发", member_ids: ["a"] },
  { id: "child", parent_id: "parent", name: "前端", member_ids: ["a", "b"] },
  { id: "other", parent_id: null, name: "产品", member_ids: ["c"] },
]
const users = [{ id: "a", role: "user" }, { id: "b", role: "admin" }, { id: "c", role: "user" }]

test("父分组成员包含后代且跨组去重，移动后更新继承", () => {
  assert.deepEqual([...groupMemberIDs(groups, users, "parent")].sort(), ["a", "b"])
  const moved = groups.map((group) => group.id === "child" ? { ...group, parent_id: "other" } : group)
  assert.deepEqual([...groupMemberIDs(moved, users, "parent")], ["a"])
  assert.deepEqual([...groupMemberIDs(moved, users, "other")].sort(), ["a", "b", "c"])
})

test("虚拟团队根节点包含全部用户，空数据库也可显示成员", () => {
  assert.equal(groupMemberIDs([], users, ROOT_GROUP_ID).size, 3)
  assert.equal(groupMemberIDs(groups, users, ROOT_GROUP_ID).size, 3)
  assert.deepEqual([...groupMemberIDs(groups, users, "other")], ["c"])
  assert.equal(groupMemberIDs(groups, users, "missing").size, 0)
})

test("分组成员仅由关联决定，不根据角色和顶层位置自动加入", () => {
  const empty = { id: "custom", name: "管理员", parent_id: null, member_ids: [] }
  assert.equal(groupMemberIDs([...groups, empty], users, empty.id).size, 0)
  const moved = groups.map((group) => group.id === "child" ? { ...group, parent_id: null } : group)
  assert.deepEqual([...groupMemberIDs(moved, users, "parent")], ["a"])
  assert.deepEqual([...groupMemberIDs(moved, users, "child")].sort(), ["a", "b"])
})

test("移动目标排除自身和全部后代，并可处理重复访问", () => {
  assert.deepEqual([...descendantIDs(groups, "parent")], ["parent", "child"])
  assert.deepEqual([...descendantIDs([...groups, { id: "parent", parent_id: "child", member_ids: [] }], "parent")], ["parent", "child"])
})
