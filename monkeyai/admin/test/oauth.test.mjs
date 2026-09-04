import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { createOAuthConnectionID } from "../src/lib/oauth.ts"

test("creates unique OAuth connection IDs without randomUUID", () => {
  const first = createOAuthConnectionID()
  const second = createOAuthConnectionID()

  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
  assert.notEqual(first, second)
})

test("OAuth settings do not depend on crypto.randomUUID", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(source, /crypto\.randomUUID/)
  assert.match(source, /createOAuthConnectionID\(\)/)
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
