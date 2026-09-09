import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("login method switches remain visible and persist with authentication settings", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /pages\.otherSettings\.loginMethods\.password/)
  assert.match(source, /pages\.otherSettings\.loginMethods\.emailCode/)
  assert.match(source, /password_enabled: loginMethods\.passwordEnabled/)
  assert.match(source, /email_code_enabled: loginMethods\.emailCodeEnabled/)
})

test("admin login lists configured OAuth providers and uses the admin flow", async () => {
  const [page, form] = await Promise.all([
    readFile(new URL("../src/pages/login-page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/login-form.tsx", import.meta.url),
      "utf8"
    ),
  ])

  assert.match(page, /\/api\/auth\/v1\/providers/)
  assert.match(page, /\/admin-start/)
  assert.match(form, /providers\.map/)
})
