import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

import {
  canMoveTo,
  memberMoveKey,
  movableGroupIDs,
  updateGroupSelection,
  updateMemberSelection,
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
  assert.deepEqual(movableGroupIDs(groups, [child.id, team.id, target.id]), [
    team.id,
    target.id,
  ])
})

test("拖放只创建待保存操作，点击保存才请求接口", async () => {
  const source = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )
  const drop = source.split("const dropOn =")[1].split("const saveMove =")[0]
  const save = source
    .split("const saveMove =")[1]
    .split("const createUser =")[0]
  assert.match(drop, /setPendingMove\(\{ payload: dragging, target \}\)/)
  assert.doesNotMatch(drop, /api</)
  assert.match(save, /api<void>\("\/api\/admin\/v1\/groups\/move"/)
  assert.match(source, /onClick=\{\(\) => void saveMove\(\)\}/)
  assert.match(source, /setPendingMove\(null\)/)
})

test("拖拽预览只显示名称，不使用整行或页面的原生快照", async () => {
  const source = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )
  const drag = source
    .split("const startDrag =")[1]
    .split("const dragGroup =")[0]
  assert.match(drag, /document\.createElement\("div"\)/)
  assert.match(drag, /preview\.textContent = .*names\[0\]/)
  assert.match(drag, /setDragImage\(preview, 12, 12\)/)
  assert.match(drag, /requestAnimationFrame\(\(\) => preview\.remove\(\)\)/)
  assert.doesNotMatch(drag, /cloneNode|innerHTML/)
})

test("左侧圆点按住滑过同类行多选，不触发整行原生拖拽", async () => {
  const [tree, page] = await Promise.all([
    readFile(
      new URL("../src/components/members/group-tree.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
      "utf8"
    ),
  ])
  assert.match(tree, /role="checkbox"\s+aria-checked=\{selected\}/)
  assert.match(tree, /size-2\.5 rounded-full border border-input bg-white/)
  assert.match(tree, /selected && "border-foreground bg-foreground"/)
  assert.match(
    tree,
    /onPointerDown=\{\(event: PointerEvent<HTMLButtonElement>\)/
  )
  assert.match(
    tree,
    /onGroupSweepEnter\(group\.id, \(event\.buttons & 1\) !== 0\)/
  )
  assert.match(tree, /onSweepEnter\(\(event\.buttons & 1\) !== 0\)/)
  assert.match(page, /window\.addEventListener\("pointerup", finishSweep\)/)
  assert.match(page, /select: !wasSelected/)
  assert.match(page, /updateGroupSelection\(current, id, sweep\.select\)/)
  assert.match(page, /updateMemberSelection\(current, member, sweep\.select\)/)
  const memberRow = tree.split("function GroupTreeMemberRow(")[1]
  assert.doesNotMatch(
    memberRow.split("return (")[1].split("<SelectionDot")[0],
    /draggable/
  )
  assert.match(memberRow, /<span\s+draggable\s+onDragStart=\{onDragStart\}/)
})

test("从已选中的圆点划过可连续取消选择，未选中则连续选择", () => {
  assert.deepEqual(updateGroupSelection(["a", "b"], "a", false), ["b"])
  assert.deepEqual(updateGroupSelection(["a"], "b", true), ["a", "b"])
  assert.deepEqual(updateGroupSelection(["a"], "a", true), ["a"])

  const first = { id: "user", source_group_id: "a" }
  const second = { id: "user", source_group_id: "b" }
  assert.deepEqual(updateMemberSelection([first, second], first, false), [
    second,
  ])
  assert.deepEqual(updateMemberSelection([first], second, true), [
    first,
    second,
  ])
  assert.deepEqual(updateMemberSelection([first], first, true), [first])
})

test("树中移动成员保留来源信息，列表成员不允许无意义地放入根", () => {
  assert.notEqual(
    memberMoveKey({ id: "user", source_group_id: team.id }),
    memberMoveKey({ id: "user" })
  )
  assert.equal(
    canMoveTo(
      groups,
      { kind: "member", members: [{ id: "user", source_group_id: team.id }] },
      target
    ),
    true
  )
  assert.equal(
    canMoveTo(
      groups,
      { kind: "member", members: [{ id: "user", source_group_id: team.id }] },
      team
    ),
    false
  )
  assert.equal(
    canMoveTo(
      groups,
      { kind: "member", members: [{ id: "user", source_group_id: team.id }] },
      root
    ),
    true
  )
  assert.equal(
    canMoveTo(groups, { kind: "member", members: [{ id: "user" }] }, root),
    false
  )
  assert.equal(
    canMoveTo(groups, { kind: "member", members: [{ id: "user" }] }, target),
    true
  )
})
