import assert from "node:assert/strict"
import test from "node:test"

import {
  MAX_BULK_MEMBERS,
  createBulkMembers,
  parseBulkEmails,
  validateBulkMembers,
} from "../src/lib/bulk-members.ts"
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

test("bulk preview defaults names to normalized emails and ignores empty lines", () => {
  const rows = parseBulkEmails("  A@Example.com \n\nb@example.com\r\n")
  assert.deepEqual(
    rows.map(({ email, name }) => [email, name]),
    [
      ["a@example.com", "a@example.com"],
      ["b@example.com", "b@example.com"],
    ]
  )
  assert.equal(MAX_BULK_MEMBERS, 50)
})

test("bulk validation reports invalid, duplicate, existing and missing names", () => {
  const rows = parseBulkEmails(
    "not-an-email\nA@example.com\na@example.com\nexisting@example.com\nempty@example.com"
  )
  rows[4].name = " "
  const issues = validateBulkMembers(
    rows,
    new Set(["EXISTING@example.com"]),
    "user"
  )
  assert.deepEqual(
    [...issues.values()],
    [
      "invalidEmail",
      "duplicateEmail",
      "duplicateEmail",
      "existingEmail",
      "missingName",
    ]
  )
})

test("bulk administrators need individual passwords; regular members do not", () => {
  const rows = parseBulkEmails("a@example.com\nb@example.com")
  rows[0].password = "long-password-1"
  assert.deepEqual(
    [...validateBulkMembers(rows, new Set(), "admin").values()],
    ["passwordTooShort"]
  )
  assert.equal(validateBulkMembers(rows, new Set(), "user").size, 0)
  rows[1].password = "long-password-1"
  assert.deepEqual(
    [...validateBulkMembers(rows, new Set(), "admin").values()],
    ["duplicatePassword", "duplicatePassword"]
  )
  rows[1].password = "long-password-2"
  assert.equal(validateBulkMembers(rows, new Set(), "admin").size, 0)
})

test("bulk submission continues after a failure and reports progress without reusing passwords", async () => {
  const rows = parseBulkEmails("a@example.com\nb@example.com\nc@example.com")
  rows.forEach((row, index) => {
    row.password = `unique-password-${index}`
  })
  const submitted = []
  const progress = []
  const { created, failures } = await createBulkMembers(
    rows,
    "admin",
    async (input) => {
      submitted.push(input)
      if (input.email === "b@example.com") throw new Error("Already exists")
      return input.email
    },
    (completed, total) => progress.push([completed, total])
  )
  assert.deepEqual(created, ["a@example.com", "c@example.com"])
  assert.deepEqual([...failures.entries()], [[1, "Already exists"]])
  assert.deepEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3],
  ])
  assert.deepEqual(
    submitted.map((item) => item.password),
    ["unique-password-0", "unique-password-1", "unique-password-2"]
  )
  const regular = await createBulkMembers(
    rows.slice(0, 1),
    "user",
    async (input) => input,
    () => {}
  )
  assert.equal("password" in regular.created[0], false)
})

test("bulk creation sends selected groups for every member and retries only failed rows", async () => {
  const rows = parseBulkEmails("a@example.com\nb@example.com")
  const groups = ["group-a", "group-b"]
  const submitted = []
  const result = await createBulkMembers(
    rows,
    "user",
    async (input) => {
      submitted.push(input)
      if (input.email === "b@example.com")
        throw new Error("Group assignment failed")
      return input
    },
    () => {},
    groups
  )
  assert.deepEqual(
    submitted.map((input) => input.group_ids),
    [groups, groups]
  )
  assert.equal(result.created.length, 1)
  assert.equal(result.failures.size, 1)
  const retries = await createBulkMembers(
    rows.filter((row) => result.failures.has(row.id)),
    "user",
    async (input) => input,
    () => {},
    groups
  )
  assert.deepEqual(
    retries.created.map((input) => [input.email, input.group_ids]),
    [["b@example.com", groups]]
  )
  const ungrouped = await createBulkMembers(
    rows.slice(0, 1),
    "user",
    async (input) => input,
    () => {}
  )
  assert.deepEqual(ungrouped.created[0].group_ids, [])
})

test("bulk creation snapshots groups before asynchronous requests", async () => {
  const groups = ["group-a"]
  const result = await createBulkMembers(
    parseBulkEmails("a@example.com\nb@example.com"),
    "user",
    async (input) => {
      groups.push("changed-during-request")
      return input
    },
    () => {},
    groups
  )
  assert.deepEqual(
    result.created.map((input) => input.group_ids),
    [["group-a"], ["group-a"]]
  )
})

test("bulk dialog labels and errors exist in all supported languages", () => {
  const keys = Object.keys(enUS.pages.membersAndGroups.bulk)
  assert.equal(zhCN.pages.membersAndGroups.bulk.role, "角色")
  assert.equal(zhCN.pages.membersAndGroups.bulk.memberList, "成员列表")
  assert.equal(
    zhCN.pages.membersAndGroups.bulk.singleSuccess,
    "已成功添加成员。"
  )
  assert.equal(zhCN.pages.membersAndGroups.bulk.next, "下一步")
  assert.equal(zhCN.pages.membersAndGroups.bulk.previous, "上一步")
  const errorKeys = Object.keys(enUS.pages.membersAndGroups.bulk.errors)
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
    const members = locale.pages.membersAndGroups
    for (const key of ["confirmMemberAction", "actionSucceeded"]) {
      assert.ok(typeof members[key] === "string" && members[key].trim())
    }
    for (const placeholder of ["action", "member", "email"]) {
      assert.ok(members.confirmMemberAction.includes(`{{${placeholder}}}`))
    }
    assert.ok(members.actionSucceeded.includes("{{target}}"))
    const bulk = members.bulk
    assert.deepEqual(Object.keys(bulk), keys)
    assert.deepEqual(Object.keys(bulk.errors), errorKeys)
    for (const key of keys.filter((key) => key !== "errors")) {
      assert.ok(typeof bulk[key] === "string" && bulk[key].trim())
    }
    assert.ok(errorKeys.every((key) => bulk.errors[key].trim()))
  }
})
