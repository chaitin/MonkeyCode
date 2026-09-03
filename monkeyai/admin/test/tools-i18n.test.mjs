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

const resources = { ar, deDE, enUS, es419, frFR, jaJP, koKR, ruRU, zhCN, zhTW }

function getLeafPaths(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key

    return typeof child === "object" && child !== null
      ? getLeafPaths(child, path)
      : [path]
  })
}

test("tools are fully translated in every supported language", () => {
  const expectedPaths = getLeafPaths(enUS.pages.tools).sort()

  for (const [language, resource] of Object.entries(resources)) {
    assert.deepEqual(
      getLeafPaths(resource.pages.tools).sort(),
      expectedPaths,
      `${language} is missing tool translations`
    )
  }
})

test("tools only configure remote MCP servers with client or centralized auth", async () => {
  const source = await readFile(
    new URL("../src/pages/tools-page.tsx", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(source, /\bstdio\b/i)
  assert.doesNotMatch(source, /McpTransport|Streamable HTTP|>SSE</)
  assert.doesNotMatch(source, /clientAvailability|handleToggleServer/)
  assert.match(source, /<TabsTrigger value="oauth">/)
  assert.match(source, /<TabsTrigger value="httpHeader">/)
  assert.match(source, /<TabsTrigger value="none">/)
  assert.doesNotMatch(source, /ToggleGroup/)
  assert.match(source, /name="httpHeaders"/)
  assert.doesNotMatch(source, /name="keyName"|name="keyValue"/)
  assert.match(source, /defaultValue=/)
  assert.match(
    source,
    /type McpAuthorizationMode = "none" \| "independent" \| "centralized"/
  )
  assert.match(source, /type McpAuthorizationMethod = "oauth" \| "httpHeader"/)
  assert.match(source, /pages\.tools\.authorizationModes\.none/)
  assert.doesNotMatch(source, /pages\.tools\.authorizationMethods\.none/)
  assert.match(source, /pages\.tools\.viewTools/)
  assert.match(source, /<Switch/)
  assert.match(source, /pointsPerCall: 0/)
  assert.match(source, /disabled=\{!tool\.enabled\}/)
  assert.match(source, /description: string/)
  assert.match(source, /\{tool\.description\}/)
  assert.doesNotMatch(source, /McpToolPricing|pricingOptions|<Select/)
})
