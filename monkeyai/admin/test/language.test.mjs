import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_LANGUAGE,
  detectBrowserLanguage,
  getLanguageDirection,
  matchSupportedLanguage,
} from "../src/i18n/language.ts"

test("matches regional Arabic locales and enables RTL", () => {
  assert.equal(matchSupportedLanguage("ar-SA"), "ar")
  assert.equal(matchSupportedLanguage("ar_EG"), "ar")
  assert.equal(getLanguageDirection("ar-AE"), "rtl")
  assert.equal(getLanguageDirection("en-US"), "ltr")
})

test("maps Spanish variants to the Latin American resource", () => {
  assert.equal(matchSupportedLanguage("es-MX"), "es-419")
  assert.equal(matchSupportedLanguage("es-ES"), "es-419")
})

test("uses the first supported browser language and falls back to English", () => {
  assert.equal(detectBrowserLanguage(["pt-BR", "ar-EG"]), "ar")
  assert.equal(detectBrowserLanguage(["pt-BR"]), DEFAULT_LANGUAGE)
})
