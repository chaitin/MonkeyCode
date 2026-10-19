import assert from "node:assert/strict"
import test from "node:test"
import { sortQuotaUsers, userQuota } from "../src/lib/billing.ts"

const rootID = "00000000-0000-0000-0000-000000000000"

const groups = [
  { id: rootID, parent_id: null, name: "团队", credits: "10000" },
  { id: "parent", parent_id: rootID, name: "上级", credits: "50000" },
  { id: "child", parent_id: "parent", name: "子组", credits: null },
  { id: "other", parent_id: rootID, name: "另一组", credits: "80000" },
]
const user = {
  id: "user",
  name: "成员",
  email: "user@example.com",
  status: "active",
  group_ids: ["child", "other"],
  credits: null,
  effective_credits: "80000",
  inherited_from: "other",
}

test("根分组成员继承团队，单组继承最近上级，多组取最高而非叠加", () => {
  assert.equal(
    userQuota({ ...user, group_ids: [rootID] }, groups).effective,
    "10000"
  )
  assert.equal(
    userQuota({ ...user, group_ids: ["child"] }, groups).effective,
    "50000"
  )
  assert.equal(userQuota(user, groups).effective, "80000")
  assert.equal(
    userQuota({ ...user, group_ids: ["other", "child"] }, groups).effective,
    "80000"
  )
})

test("个人额度数据不参与计算，成员始终使用最高分组额度", () => {
  const legacy = {
    ...user,
    credits: "123",
    effective_credits: "123",
    inherited_from: "user",
  }
  assert.deepEqual(userQuota(legacy, groups), {
    inherited: "80000",
    effective: "80000",
  })
  assert.equal(
    userQuota(legacy, groups, { "user:user": "0" }).effective,
    "80000"
  )
})

test("草稿实时反映所有分组额度，树形列表和搜索使用相同结果", () => {
  assert.equal(
    userQuota(user, groups, { "group:parent": "90000" }).effective,
    "90000"
  )
  assert.equal(
    userQuota(user, groups, { "group:other": null }).effective,
    "50000"
  )
  assert.equal(
    userQuota(user, groups, {
      "group:other": null,
      "group:parent": null,
      [`group:${rootID}`]: "20000",
    }).effective,
    "20000"
  )
})

test("子组零额度覆盖上级，团队不是所有分组的额度下限", () => {
  assert.equal(
    userQuota({ ...user, group_ids: ["child"] }, groups, { "group:child": "0" })
      .effective,
    "0"
  )
  assert.equal(
    userQuota(user, groups, { "group:parent": "10", "group:other": "20" })
      .effective,
    "20"
  )
  assert.equal(
    userQuota(user, groups, { "group:parent": "10", "group:other": null })
      .effective,
    "10000"
  )
})

test("最高额度比较保留大金额的六位小数精度", () => {
  assert.equal(
    userQuota(user, groups, {
      "group:parent": "999999999999.000001",
      "group:other": "999999999999.000000",
    }).effective,
    "999999999999.000001"
  )
})

test("成员姓名排序使用本地语言和自然数字顺序，不改动原列表", () => {
  const members = Object.freeze(
    [10, 2, 1].map((id) => ({ ...user, id: String(id), name: `Member ${id}` }))
  )
  const names = (sort) =>
    sortQuotaUsers(members, sort, "en-US").map((member) => member.name)
  assert.deepEqual(names("name-asc"), ["Member 1", "Member 2", "Member 10"])
  assert.deepEqual(names("name-desc"), ["Member 10", "Member 2", "Member 1"])
  assert.deepEqual(
    members.map((member) => member.id),
    ["10", "2", "1"]
  )
  const chinese = ["张三", "李四", "王五"].map((name) => ({ ...user, name }))
  assert.deepEqual(
    sortQuotaUsers(chinese, "name-asc", "zh-CN").map((member) => member.name),
    ["李四", "王五", "张三"]
  )
})

test("成员积分按实际余额排序，保留大额六位精度、负数和缺失值", () => {
  const values = [
    "999999999999.000001",
    "-2.000000",
    undefined,
    "0",
    "999999999999.000000",
    "-2.000001",
    "-0.000001",
  ]
  const members = values.map((balance_credits, index) => ({
    ...user,
    id: String(index),
    balance_credits,
    effective_credits: String(100 - index),
  }))
  const balances = (sort) =>
    sortQuotaUsers(members, sort, "en-US").map(
      (member) => member.balance_credits
    )
  assert.deepEqual(balances("credits-asc"), [
    "-2.000001",
    "-2.000000",
    "-0.000001",
    "0",
    "999999999999.000000",
    "999999999999.000001",
    undefined,
  ])
  assert.deepEqual(balances("credits-desc"), [
    "999999999999.000001",
    "999999999999.000000",
    "0",
    "-0.000001",
    "-2.000000",
    "-2.000001",
    undefined,
  ])
})

test("相同积分按姓名稳定排序，空或无效积分不当作零", () => {
  const members = [
    { ...user, id: "b", name: "Bravo", balance_credits: "1.000000" },
    { ...user, id: "a", name: "Alpha", balance_credits: "1" },
    { ...user, id: "empty", name: "Empty", balance_credits: "" },
    { ...user, id: "invalid", name: "Invalid", balance_credits: "—" },
  ]
  for (const sort of ["credits-asc", "credits-desc"]) {
    assert.deepEqual(
      sortQuotaUsers(members, sort, "en-US").map((member) => member.id),
      ["a", "b", "empty", "invalid"]
    )
  }
})

test("移动分组后跟随新上级额度", () => {
  const moved = groups.map((group) =>
    group.id === "child" ? { ...group, parent_id: "other" } : group
  )
  assert.equal(
    userQuota({ ...user, group_ids: ["child"] }, moved).effective,
    "80000"
  )
})
