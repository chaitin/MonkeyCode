import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const source = (path) => readFile(new URL(path, root), "utf8")

test("about card shows the current version at the end of other settings", async () => {
  const [sidebar, settings, component, provider] = await Promise.all([
    source("src/components/app-sidebar.tsx"),
    source("src/pages/other-settings-page.tsx"),
    source("src/components/about-card.tsx"),
    source("src/components/version-provider.tsx"),
  ])
  assert.doesNotMatch(sidebar, /ServiceVersion|AboutCard/)
  assert.match(
    settings,
    /<PaidLicenseCard className="order-6" \/>[\s\S]*<AboutCard className="order-7" \/>/
  )
  assert.match(provider, /\/api\/admin\/v1\/version"/)
  assert.match(provider, /\/api\/admin\/v1\/version\/release"/)
  assert.match(component, /<Item variant="outline">[\s\S]*version\.current/)
})

test("upgrade uses only HTTPS links from the release endpoint", async () => {
  const [context, provider, button] = await Promise.all([
    source("src/lib/version-context.ts"),
    source("src/components/version-provider.tsx"),
    source("src/components/version-upgrade-button.tsx"),
  ])
  assert.match(context, /url\.protocol === "https:"/)
  assert.match(provider, /release\.version !== current/)
  assert.match(button, /href=\{upgradeURL\}/)
  assert.match(button, /rel="noopener noreferrer"/)
})

test("version copy exists in primary locales", async () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const content = await source(`src/i18n/locales/${locale}.ts`)
    assert.match(content, /version: \{[\s\S]*current: /)
    assert.match(content, /upgrade: /)
  }
})
