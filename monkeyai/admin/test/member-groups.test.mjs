import assert from "node:assert/strict"
import test from "node:test"
import { ar } from "../src/i18n/locales/ar.ts"
import { deDE } from "../src/i18n/locales/de-DE.ts"
import { enUS } from "../src/i18n/locales/en-US.ts"
import { es419 } from "../src/i18n/locales/es-419.ts"
import { frFR } from "../src/i18n/locales/fr-FR.ts"
import { jaJP } from "../src/i18n/locales/ja-JP.ts"
import { koKR } from "../src/i18n/locales/ko-KR.ts"
import { ruRU } from "../src/i18n/locales/ru-RU.ts"
import { zhCN } from "../src/i18n/locales/zh-CN.ts"
import { zhTW } from "../src/i18n/locales/zh-TW.ts"
import {
  ROOT_GROUP_ID,
  compareByName,
  descendantIDs,
  directMemberIDs,
  directGroupsByMember,
  groupMemberIDs,
  ungroupedMemberIDs,
} from "../src/lib/member-groups.ts"

const groups = [
  { id: "parent", parent_id: null, name: "研发", member_ids: ["a"] },
  { id: "child", parent_id: "parent", name: "前端", member_ids: ["a", "b"] },
  { id: "other", parent_id: null, name: "产品", member_ids: ["c"] },
]
const users = [
  { id: "a", role: "user" },
  { id: "b", role: "admin" },
  { id: "c", role: "user" },
]

test("父分组成员包含后代且跨组去重，移动后更新继承", () => {
  assert.deepEqual([...groupMemberIDs(groups, users, "parent")].sort(), [
    "a",
    "b",
  ])
  const moved = groups.map((group) =>
    group.id === "child" ? { ...group, parent_id: "other" } : group
  )
  assert.deepEqual([...groupMemberIDs(moved, users, "parent")], ["a"])
  assert.deepEqual([...groupMemberIDs(moved, users, "other")].sort(), [
    "a",
    "b",
    "c",
  ])
})

test("团队根节点只统计已分组成员，并跨分组去重", () => {
  const withUngrouped = [...users, { id: "d", role: "user" }]
  assert.equal(groupMemberIDs([], withUngrouped, ROOT_GROUP_ID).size, 0)
  assert.equal(groupMemberIDs(groups, withUngrouped, ROOT_GROUP_ID).size, 3)
  assert.deepEqual([...groupMemberIDs(groups, users, "other")], ["c"])
  assert.equal(groupMemberIDs(groups, users, "missing").size, 0)
})

test("分组成员仅由关联决定，不根据角色和顶层位置自动加入", () => {
  const empty = {
    id: "custom",
    name: "管理员",
    parent_id: null,
    member_ids: [],
  }
  assert.equal(groupMemberIDs([...groups, empty], users, empty.id).size, 0)
  const moved = groups.map((group) =>
    group.id === "child" ? { ...group, parent_id: null } : group
  )
  assert.deepEqual([...groupMemberIDs(moved, users, "parent")], ["a"])
  assert.deepEqual([...groupMemberIDs(moved, users, "child")].sort(), [
    "a",
    "b",
  ])
})

test("树节点区分真实分组直属成员与未分组成员", () => {
  const withUngrouped = [...users, { id: "d", role: "user" }]
  assert.deepEqual([...directMemberIDs(groups, "parent")], ["a"])
  assert.deepEqual([...directMemberIDs(groups, "child")].sort(), ["a", "b"])
  assert.deepEqual([...directMemberIDs(groups, ROOT_GROUP_ID)], [])
  assert.deepEqual([...directMemberIDs(groups, "missing")], [])
  assert.deepEqual([...ungroupedMemberIDs(groups, withUngrouped)], ["d"])
  assert.deepEqual(
    [...ungroupedMemberIDs([], withUngrouped)],
    ["a", "b", "c", "d"]
  )
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
  assert.equal(memberships.has("c"), false)
})

test("未分组成员标题支持所有控制台语言", () => {
  for (const locale of [
    ar,
    deDE,
    enUS,
    es419,
    frFR,
    jaJP,
    koKR,
    ruRU,
    zhCN,
    zhTW,
  ]) {
    assert.ok(locale.pages.membersAndGroups.ungroupedMembers.trim())
  }
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
