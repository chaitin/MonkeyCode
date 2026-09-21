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

test("login page loads public branding with safe defaults", async () => {
  const source = await readFile(
    new URL("../src/pages/login-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /workspace_name: "Monkey AI"/)
  assert.match(source, /product_name: "MonkeyAI"/)
  assert.match(source, /api<LoginBranding>\("\/api\/auth\/v1\/branding"/)
  assert.match(source, /\.catch\(\(\) => undefined\)/)
  assert.match(source, /teamName=\{branding\.workspace_name\}/)
  assert.match(source, /toolName=\{branding\.product_name\}/)
  assert.match(
    source,
    /document\.title = t\("login\.adminPanelDocumentTitle", \{\s*toolName: branding\.product_name,\s*teamName: branding\.workspace_name/
  )
})

test("login form renders product and workspace branding", async () => {
  const source = await readFile(
    new URL("../src/components/login-form.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /<h1 className="text-2xl font-bold">\{toolName\}<\/h1>/)
  assert.match(source, /t\("login\.adminPanelSubtitle", \{ teamName \}\)/)
  assert.doesNotMatch(source, /login\.(title|subtitle)/)
})

test("login branding copy is translated in every supported language", () => {
  for (const [language, resource] of Object.entries(resources)) {
    assert.ok(
      resource.login.adminPanelSubtitle.includes("{{teamName}}"),
      language
    )
    assert.ok(
      resource.login.adminPanelDocumentTitle.includes("{{toolName}}") &&
        resource.login.adminPanelDocumentTitle.includes("{{teamName}}"),
      language
    )
    assert.equal(resource.login.title, undefined, language)
    assert.equal(resource.login.subtitle, undefined, language)
  }

  assert.equal(
    zhCN.login.adminPanelSubtitle,
    "登录到 {{teamName}} 的管理员面板"
  )
  assert.equal(
    zhCN.login.adminPanelDocumentTitle,
    "{{toolName}} 管理员面板 - {{teamName}}"
  )
})

test("app leaves the login document title to the login page", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8")
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8")

  assert.match(
    app,
    /if \(location\.pathname !== LOGIN_PATH\) \{\s*document\.title = t\("app\.documentTitle"\)/
  )
  assert.match(html, /<title>MonkeyAI Admin Panel - Monkey AI<\/title>/)
})
