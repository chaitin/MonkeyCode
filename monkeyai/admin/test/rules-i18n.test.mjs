import assert from "node:assert/strict"
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

test("rules are fully translated in every supported language", () => {
  const expectedPaths = getLeafPaths(enUS.pages.rules).sort()

  for (const [language, resource] of Object.entries(resources)) {
    assert.deepEqual(
      getLeafPaths(resource.pages.rules).sort(),
      expectedPaths,
      `${language} is missing rules translations`
    )
  }
})
