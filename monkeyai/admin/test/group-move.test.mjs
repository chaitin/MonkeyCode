import assert from "node:assert/strict"
import test from "node:test"

import {
  canMoveTo,
} from "../src/lib/group-move.ts"

const root = {
  id: "root",
  parent_id: null,
  name: "团队",
  member_ids: [],
  actions: ["add-subgroup"],
  allow_add_members: false,
}
const team = {
  id: "team",
  parent_id: root.id,
  name: "团队一",
  member_ids: [],
  actions: ["move"],
  allow_add_members: true,
}
const child = {
  id: "child",
  parent_id: team.id,
  name: "子组",
  member_ids: [],
  actions: ["move"],
  allow_add_members: true,
}
const target = {
  id: "target",
  parent_id: root.id,
  name: "目标",
  member_ids: [],
  actions: ["move"],
  allow_add_members: true,
}
const groups = [root, team, child, target]

test("批量分组不能放入自身或后代，也不能原地移动", () => {
  assert.equal(
    canMoveTo(groups, { kind: "group", ids: [team.id, target.id] }, child),
    false
  )
  assert.equal(
    canMoveTo(groups, { kind: "group", ids: [team.id] }, root),
    false
  )
  assert.equal(
    canMoveTo(groups, { kind: "group", ids: [child.id, target.id] }, team),
    false
  )
  assert.equal(
    canMoveTo(groups, { kind: "group", ids: [child.id] }, target),
    true
  )
  assert.equal(
    canMoveTo(groups, { kind: "group", ids: [root.id] }, team),
    false
  )
})

test("批量成员可选择共同目标，不能选中任一成员当前所在的分组", () => {
  const members = [
    { id: "first", source_group_id: team.id },
    { id: "second", source_group_id: child.id },
  ]
  const payload = { kind: "member", members }
  assert.equal(canMoveTo(groups, payload, target), true)
  assert.equal(canMoveTo(groups, payload, root), true)
  assert.equal(canMoveTo(groups, payload, team), false)
  assert.equal(canMoveTo(groups, payload, child), false)
  assert.equal(
    canMoveTo(groups, { kind: "member", members: [] }, target),
    false
  )
  assert.equal(
    canMoveTo(
      groups,
      {
        kind: "member",
        members: [...members, { id: "ungrouped", source_group_id: root.id }],
      },
      root
    ),
    false
  )
})
