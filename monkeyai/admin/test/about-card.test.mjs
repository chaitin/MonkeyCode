import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const source = (path) => readFile(new URL(path, root), "utf8")

test("about card shows the current version at the end of other settings", async () => {
  const [sidebar, settings, component] = await Promise.all([
    source("src/components/app-sidebar.tsx"),
    source("src/pages/other-settings-page.tsx"),
    source("src/components/about-card.tsx"),
  ])
  assert.doesNotMatch(sidebar, /ServiceVersion|AboutCard/)
  assert.match(
    settings,
    /<PaidLicenseCard className="order-6" \/>[\s\S]*<AboutCard className="order-7" \/>/
  )
  assert.match(component, /\/api\/admin\/v1\/version"/)
  assert.match(component, /\/api\/admin\/v1\/version\/release"/)
  assert.match(component, /<Item variant="outline">[\s\S]*version\.current/)
})

test("upgrade uses only HTTPS links from the release endpoint", async () => {
  const component = await source("src/components/about-card.tsx")
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
