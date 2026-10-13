import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const source = (path) => readFile(new URL(path, root), "utf8")

test("service version is displayed in the sidebar footer", async () => {
  const [sidebar, component] = await Promise.all([
    source("src/components/app-sidebar.tsx"),
    source("src/components/service-version.tsx"),
  ])
  assert.match(sidebar, /<SidebarFooter>[\s\S]*<ServiceVersion \/>[\s\S]*<\/SidebarFooter>/)
  assert.match(component, /\/api\/admin\/v1\/version"/)
  assert.match(component, /\/api\/admin\/v1\/version\/release"/)
  assert.match(component, /version\.current/)
})

test("upgrade uses only HTTPS links from the release endpoint", async () => {
  const component = await source("src/components/service-version.tsx")
  assert.match(component, /url\.protocol === "https:"/)
  assert.match(component, /release\.version !== current/)
  assert.match(component, /href=\{upgradeURL\}/)
  assert.match(component, /rel="noopener noreferrer"/)
})

test("version copy exists in primary locales", async () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const content = await source(`src/i18n/locales/${locale}.ts`)
    assert.match(content, /version: \{[\s\S]*current: /)
    assert.match(content, /upgrade: /)
  }
})
