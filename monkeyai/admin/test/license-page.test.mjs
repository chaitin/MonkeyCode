import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const root = new URL("../", import.meta.url)
const source = async (path) =>
  readFile(new URL(path, root), "utf8")

test("license page exposes all license management operations", async () => {
  const page = await source("src/pages/license-page.tsx")
  assert.match(page, /\/api\/admin\/v1\/license\/status/)
  assert.match(page, /\/api\/admin\/v1\/license\/machine-code/)
  assert.match(page, /\/api\/admin\/v1\/license\/import/)
  assert.match(page, /FormData/)
  assert.match(page, /max_members/)
})

test("license page is routed and visible in system settings", async () => {
  const [routes, app, sidebar] = await Promise.all([
    source("src/lib/routes.ts"),
    source("src/App.tsx"),
    source("src/components/app-sidebar.tsx"),
  ])
  assert.match(routes, /license: "\/console\/settings\/license"/)
  assert.match(app, /<LicensePage \/>/)
  assert.match(sidebar, /pages\.license\.title/)
})

test("license page has primary locale translations", async () => {
  const [en, zh] = await Promise.all([
    source("src/i18n/locales/en-US.ts"),
    source("src/i18n/locales/zh-CN.ts"),
  ])
  for (const messages of [en, zh]) {
    assert.match(messages, /license: \{/)
    assert.match(messages, /importSuccess:/)
    assert.match(messages, /machineCodeCopied:/)
  }
})
