import assert from "node:assert/strict"
import test from "node:test"
import { sortQuotaUsers } from "../src/lib/billing.ts"

const user = {
  id: "user",
  name: "成员",
  email: "user@example.com",
}

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
})

test("相同积分按姓名稳定排序，空或无效积分不当作零", () => {
  const members = [
    { ...user, id: "b", name: "Bravo", balance_credits: "1.000000" },
    { ...user, id: "a", name: "Alpha", balance_credits: "1" },
    { ...user, id: "empty", name: "Empty", balance_credits: "" },
    { ...user, id: "invalid", name: "Invalid", balance_credits: "—" },
  ]
  assert.deepEqual(
    sortQuotaUsers(members, "credits-asc", "en-US").map((member) => member.id),
    ["a", "b", "empty", "invalid"]
  )
})
