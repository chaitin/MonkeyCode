import assert from "node:assert/strict"
import test from "node:test"

import { SUPPORTED_LANGUAGES } from "../src/i18n/language.ts"
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

const locales = {
  ar,
  "de-DE": deDE,
  "en-US": enUS,
  "es-419": es419,
  "fr-FR": frFR,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "ru-RU": ruRU,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
}
const pages = [
  "experts",
  "knowledgeBases",
  "rules",
  "skills",
  "tools",
  "otherSettings",
  "realtimeStatus",
  "taskHistory",
  "billingDetails",
  "billingSettings",
  "clientDevices",
]

function leafKeys(value, prefix) {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix + "." + key
      return child !== null && typeof child === "object"
        ? leafKeys(child, path)
        : [path]
    })
    .sort()
}

test("各语言的统计和管理页面词条与英文基准一致", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const locale = locales[lang]
    assert.ok(locale, lang)
    assert.match(locale.audit.targets.connector_credential, /\S/, lang)
    const { quotaRefresh, groupQuota } = locale.pages.billingSettings
    assert.ok(quotaRefresh.resetSuccess.includes("{{count}}"), lang)
    assert.ok(groupQuota.remaining.includes("{{credits}}"), lang)
    assert.deepEqual(
      leafKeys(locale.statistics, "statistics"),
      leafKeys(enUS.statistics, "statistics"),
      lang
    )
    for (const page of pages) {
      const path = "pages." + page
      assert.ok(locale.pages[page], lang + ": " + path)
      assert.deepEqual(
        leafKeys(locale.pages[page], path),
        leafKeys(enUS.pages[page], path),
        lang + ": " + path
      )
    }
  }
})
