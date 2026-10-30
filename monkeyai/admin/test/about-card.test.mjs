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
  assert.match(provider, /isNewerVersion\(release\.version, current\)/)
  assert.match(button, /href=\{upgradeURL\}/)
  assert.match(button, /rel="noopener noreferrer"/)
})

test("仅日期或序号更高的发布版本提示升级", async () => {
  const { isNewerVersion } = await import("../src/lib/version-context.ts")
  for (const [latest, current, expected] of [
    ["v26103002", "v26103001", true],
    ["v26103001", "v26103001", false],
    ["v26103001", "v26103002", false],
    ["v26103101", "v26103099", true],
    ["v26110101", "v26103199", true],
    ["v27010101", "v26123199", true],
    ["v261030100", "v26103099", true],
    ["v26103101", "v261030100", true],
    ["v261030100", "v26103101", false],
    ["v261030001", "v26103001", false],
    ["v26103001", "dev", false],
    ["v26103001", "cf3f8842", false],
    ["dev", "v26103001", false],
    ["v26.1030.2", "v26103001", false],
    ["v26103002-rc1", "v26103001", false],
    ["", "v26103001", false],
  ]) {
    assert.equal(
      isNewerVersion(latest, current),
      expected,
      `${latest} > ${current}`
    )
  }
})

test("version copy exists in primary locales", async () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const content = await source(`src/i18n/locales/${locale}.ts`)
    assert.match(content, /version: \{[\s\S]*current: /)
    assert.match(content, /upgrade: /)
  }
})
