import assert from "node:assert/strict"
import test from "node:test"
import { userQuota } from "../src/lib/billing.ts"

const groups = [
  { id: "team", parent_id: null, name: "团队", credits: "15000" },
  { id: "parent", parent_id: "team", name: "上级", credits: "50000" },
  { id: "child", parent_id: "parent", name: "子组", credits: null },
  { id: "other", parent_id: "team", name: "另一组", credits: "80000" },
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

test("无分组继承团队，单组继承最近上级，多组取最高而非叠加", () => {
  assert.equal(userQuota({ ...user, group_ids: [] }, groups).effective, "15000")
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

test("个人低额度和零额度优先，恢复继承不复用服务器的个人覆盖值", () => {
  const custom = {
    ...user,
    credits: "123",
    effective_credits: "123",
    inherited_from: "user",
  }
  assert.deepEqual(userQuota(custom, groups), {
    own: "123",
    inherited: "80000",
    effective: "123",
  })
  assert.equal(userQuota(custom, groups, { "user:user": "0" }).effective, "0")
  assert.equal(
    userQuota(custom, groups, { "user:user": null }).effective,
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
      "group:team": "20000",
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
    "15000"
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
