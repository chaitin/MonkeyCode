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

const modelKeys = [
  "noTags",
  "maxOutputTokens",
  "supportsReasoning",
  "notRecommended",
  "billingMultiplier",
  "authorizedScope",
  "kind",
  "textKind",
  "imageKind",
  "imageProvider",
  "imageCapabilitiesUnavailable",
  "selectAllSupported",
  "imageQuality",
  "aspectRatio",
  "defaultQuality",
  "defaultAspectRatio",
  "baseCreditsPerImage",
  "qualityMultiplier",
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

test("model UI has translations in all supported locales", () => {
  for (const [language, resource] of Object.entries(resources)) {
    for (const key of modelKeys) {
      assert.ok(resource.pages.models[key], `${language} is missing ${key}`)
    }
  }
  assert.equal(zhCN.pages.models.authorizedScope, "授权范围")
  assert.equal(zhCN.pages.models.noTags, "没有标签")
  assert.equal(zhCN.pages.models.maxOutputTokens, "最大输出 Token")
  assert.equal(zhCN.pages.models.supportsReasoning, "推理能力")
  assert.equal(zhCN.pages.models.notRecommended, "不推荐")
  assert.equal(zhCN.pages.models.billingMultiplier, "扣费倍率")
})

test("resource editors retain and save tags", async () => {
  for (const page of ["models", "experts", "tools"]) {
    const source = await readFile(
      new URL(`../src/pages/${page}-page.tsx`, import.meta.url),
      "utf8"
    )
    assert.match(source, /<SkillTagSelect/, `${page} is missing tag selection`)
    assert.match(source, /tag_ids:/, `${page} does not save tags`)
    assert.match(
      source,
      /\(.*\.tags \?\? \[\]\)\.map\(\(tag\) => tag\.id\)/,
      `${page} does not restore tags`
    )
  }
})

test("resource cards show configured tag names", async () => {
  const summary = await readFile(
    new URL("../src/components/resource-tag-summary.tsx", import.meta.url),
    "utf8"
  )
  assert.match(summary, /tagIds\.includes\(tag\.id\)/)
  assert.match(summary, /pages\.skills\.noTags/)

  for (const [page, item] of [
    ["experts", "expert"],
    ["tools", "server"],
  ]) {
    const source = await readFile(
      new URL(`../src/pages/${page}-page.tsx`, import.meta.url),
      "utf8"
    )
    assert.match(
      source,
      new RegExp(`<ResourceTagSummary tagIds=\\{${item}\\.tagIds\\}`)
    )
  }

  const models = await readFile(
    new URL("../src/pages/models-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(models, /tags\.filter\(\(tag\) => tagIds\.includes\(tag\.id\)\)/)
  assert.match(models, /<Badge\s+key=\{tag\.id\}\s+variant="secondary"/)
  assert.match(
    models,
    /<CardFooter[^>]*>\s*<ModelTagBadges\s+tagIds=\{model\.tagIds\}/
  )
  assert.match(
    models,
    /text-muted-foreground">\{t\("pages\.models\.noTags"\)\}/
  )
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
  assert.match(source, /supports_reasoning: supportsReasoning/)
  assert.match(source, /api_key_configured/)
  assert.match(source, /openai_responses/)
  assert.match(source, /image-capabilities/)
  assert.match(source, /base_credits_per_image/)
  assert.match(source, /positiveMultiplier/)
  assert.match(
    source,
    /id="model-multiplier"[\s\S]{0,400}?min="0\.01"[\s\S]{0,400}?step="0\.01"/
  )
  assert.doesNotMatch(source, /aspect_ratio_multipliers|operation_multipliers/)
  assert.match(source, /<GroupSelect/)
  assert.match(source, /options=\{groups\}/)
  assert.match(source, /users=\{members\}/)
  assert.match(source, /groupIds: authorization\.groupIds/)
  assert.match(source, /userIds: authorization\.memberIds/)
  assert.match(source, /memberIds: \[\.\.\.next\.userIds\]/)
  assert.match(source, /selectionMode="both"/)
  assert.match(source, /cascadeGroups/)
  assert.match(source, /searchable/)
  assert.match(source, /user_ids: authorization\.memberIds/)
  assert.doesNotMatch(source, /<AuthorizationSelect\b|ROOT_GROUP_ID/)
  assert.doesNotMatch(source, /member-01|engineering/)
})

test("model kinds use text tabs and icon card badges", async () => {
  const source = await readFile(
    new URL("../src/pages/models-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(
    source,
    /<TabsTrigger type="button" value="text">\s*\{t\("pages\.models\.textKind"\)\}/
  )
  assert.match(
    source,
    /<TabsTrigger type="button" value="image">\s*\{t\("pages\.models\.imageKind"\)\}/
  )
  assert.match(source, /AiChat02Icon/)
  assert.match(source, /AiImageIcon/)
  assert.doesNotMatch(source, /id="model-kind"/)
  assert.equal(zhCN.pages.models.dialogTitle, "添加大模型")
  assert.equal(zhCN.pages.models.textKind, "大语言模型")
})

test("image capabilities use card multi-selects and supported defaults", async () => {
  const page = await readFile(
    new URL("../src/pages/models-page.tsx", import.meta.url),
    "utf8"
  )
  const selector = await readFile(
    new URL("../src/components/image-capability-selector.tsx", import.meta.url),
    "utf8"
  )

  assert.match(page, /preserveSavedSelection/)
  assert.match(page, /api<ImageCapabilities>\(providerPath\)/)
  assert.doesNotMatch(page, /imageModelId|modelSpecific/)
  assert.match(page, /: \[\.\.\.capability\.qualities\]/)
  assert.match(page, /: \[\.\.\.capability\.aspect_ratios\]/)
  assert.match(page, /if \(next\.length === 0\) return/)
  assert.match(page, /<Separator className="my-1"/)
  assert.match(selector, /<ToggleGroup/)
  assert.match(selector, /multiple/)
  assert.match(selector, /AspectRatioGlyph/)
  assert.match(selector, /h-9/)
  assert.match(selector, /h-11/)
  assert.match(selector, /aria-pressed:border-primary/)
  assert.doesNotMatch(selector, /type="checkbox"|SelectedMark|Tick02Icon/)
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
