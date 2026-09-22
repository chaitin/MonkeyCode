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
  assert.match(
    source,
    /void saveMove\(pendingMove\.payload, pendingMove\.target\)/
  )
  assert.match(source, /setPendingMove\(null\)/)
})

test("拖拽预览使用整行的原生快照", async () => {
  const source = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )
  const drag = source
    .split("const startDrag =")[1]
    .split("const dragGroup =")[0]
  assert.match(drag, /setDragging\(payload\)/)
  assert.match(drag, /event\.dataTransfer\.effectAllowed = "move"/)
  assert.match(
    drag,
    /event\.dataTransfer\.setData\("text\/plain", "move-group-members"\)/
  )
  assert.doesNotMatch(
    drag,
    /setDragImage|createElement\("div"\)|cloneNode|innerHTML/
  )
  const tree = await readFile(
    new URL("../src/components/members/group-tree.tsx", import.meta.url),
    "utf8"
  )
  assert.match(tree, /classList\.add\(\.\.\.dragPreviewClasses\)/)
  assert.match(tree, /classList\.remove\(\.\.\.dragPreviewClasses\)/)
})

test("多选模式仅显示成员复选框，分组永远不能勾选", async () => {
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
  const [folder, memberRow] = tree.split("function GroupTreeMemberRow(")
  assert.match(folder, /multiSelect && \(\s*<Checkbox[\s\S]*disabled/)
  assert.match(folder, /checked=\{false\}/)
  assert.match(memberRow, /multiSelect && \(\s*<Checkbox/)
  assert.match(memberRow, /onCheckedChange=\{onSelect\}/)
  assert.doesNotMatch(tree, /Sweep|SelectionDot/)
  assert.match(page, /\[multiSelect, setMultiSelect\] = useState\(false\)/)
  assert.match(page, /if \(!multiSelect \|\| moving\) return/)
  assert.match(page, /setMultiSelect\((true|false)|setMultiSelect\(false\)/)
  assert.match(page, /setSelectedMembers\(\[\]\)/)
  assert.doesNotMatch(page, /selectedGroupIDs|selectionSweep/)
  assert.match(memberRow, /draggable=\{!multiSelect\}/)
  assert.match(memberRow, /onDragStart=\{\(event\) => \{/)
  assert.match(folder, /draggable=\{!multiSelect\}/)
  assert.match(folder, /onGroupDragStart\(group, event\)/)
})

test("成员勾选可增删和去重，同一用户在不同分组中的来源独立保留", () => {
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
