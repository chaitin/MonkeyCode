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

const imageKeys = [
  "kind",
  "textKind",
  "imageKind",
  "imageProvider",
  "imageCapabilitiesUnavailable",
  "imageQuality",
  "aspectRatio",
  "defaultQuality",
  "defaultAspectRatio",
  "baseCreditsPerImage",
  "qualityMultiplier",
  "aspectMultiplier",
  "editMultiplier",
  "testGeneration",
  "testGenerationWarning",
  "invocationKey",
  "imageOperation",
  "generate",
  "prompt",
  "selectAspect",
  "imageCount",
  "referenceImages",
  "mask",
  "taskStatus",
]

test("image model UI has translations in all supported locales", () => {
  for (const [language, resource] of Object.entries(resources)) {
    for (const key of imageKeys) {
      assert.ok(resource.pages.models[key], `${language} is missing ${key}`)
    }
  }
})

test("models page uses backend models and authorization subjects", async () => {
  const source = await readFile(
    new URL("../src/pages/models-page.tsx", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(source, /INITIAL_MODELS/)
  assert.match(source, /\/api\/admin\/v1\/models/)
  assert.match(source, /\/authorization-subjects/)
  assert.match(source, /max_output_tokens/)
  assert.match(source, /api_key_configured/)
  assert.match(source, /openai_responses/)
  assert.match(source, /image-capabilities/)
  assert.match(source, /base_credits_per_image/)
  assert.doesNotMatch(source, /member-01|engineering/)
})

test("image generation test form follows model capabilities and protects invocation key", async () => {
  const source = await readFile(
    new URL("../src/components/image-generation-test.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /allowed_aspect_ratios/)
  assert.match(source, /max_reference_images/)
  assert.match(source, /\/v1\/images\/inputs/)
  assert.match(source, /\/v1\/images\/generations/)
  assert.match(source, /\/v1\/images\/edits/)
  assert.match(source, /\/v1\/images\/tasks/)
  assert.match(source, /X-Api-Key/)
  assert.match(source, /credentials: "omit"/)
  assert.match(source, /URL\.revokeObjectURL/)
})
