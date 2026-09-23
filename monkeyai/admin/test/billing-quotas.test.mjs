import assert from "node:assert/strict"
import test from "node:test"
import { userQuota } from "../src/lib/billing.ts"

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

test("移动分组后跟随新上级额度", () => {
  const moved = groups.map((group) =>
    group.id === "child" ? { ...group, parent_id: "other" } : group
  )
  assert.equal(
    userQuota({ ...user, group_ids: ["child"] }, moved).effective,
    "80000"
  )
})
