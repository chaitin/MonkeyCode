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

test("login marquee labels are translated in every supported language", () => {
  for (const [language, resource] of Object.entries(resources)) {
    for (const key of ["marqueeCapabilities", "marqueeSkills"]) {
      const items = resource.login[key]
      assert.equal(items.length, enUS.login[key].length, `${language}.${key}`)
      assert.ok(
        items.every((item) => typeof item === "string" && item.trim()),
        `${language}.${key}`
      )
    }
  }
})
