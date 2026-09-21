import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

test("all member menus open the one-time password reset dialog", async () => {
  const actions = await readFile(
    new URL("../src/components/members/member-actions.tsx", import.meta.url),
    "utf8"
  )
  const tree = await readFile(
    new URL("../src/components/members/group-tree.tsx", import.meta.url),
    "utf8"
  )
  const page = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )
  const dialog = await readFile(
    new URL(
      "../src/components/members/reset-member-password-dialog.tsx",
      import.meta.url
    ),
    "utf8"
  )

  assert.match(
    actions,
    /<DropdownMenuItem onClick=\{\(\) => onResetPassword\(user\)\}>/
  )
  assert.match(tree, /onResetPassword=\{onResetPassword\}/)
  assert.equal(
    (page.match(/onResetPassword=\{setPasswordResetUser\}/g) ?? []).length,
    3
  )
  assert.match(
    page,
    /<ResetMemberPasswordDialog\s+key=\{passwordResetUser\.id\}/
  )
  assert.match(dialog, /api<\{ password: string \}>\([\s\S]*?\/reset-password`/)
  assert.match(dialog, /\{ method: "POST" \}/)
  assert.match(dialog, /value=\{password\}\s+readOnly/)
  assert.match(dialog, /navigator\.clipboard\.writeText\(password\)/)
  assert.doesNotMatch(dialog, /description:\s*password|title:\s*password/)
})

test("one-time reset instructions are translated in every supported language", () => {
  const keys = [
    "resetPassword",
    "confirmResetPassword",
    "resetPasswordResult",
    "generatedPassword",
    "copyPassword",
    "passwordCopied",
    "passwordCopyFailed",
  ]
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
    for (const key of keys) {
      assert.ok(typeof members[key] === "string" && members[key].trim(), key)
    }
    for (const key of ["confirmResetPassword", "resetPasswordResult"]) {
      assert.ok(members[key].includes("{{member}}"), key)
    }
    assert.ok(members.confirmResetPassword.includes("{{email}}"))
  }
})
