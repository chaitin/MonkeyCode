import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import i18next from "i18next"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider, initReactI18next, Trans } from "react-i18next"

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

test("the public root has its own page and the admin link opens login", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8")
  const landing = await readFile(
    new URL("../src/pages/landing-page.tsx", import.meta.url),
    "utf8"
  )
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8")

  assert.match(app, /<Route path="\/" element=\{<LandingPage \/>\} \/>/)
  assert.match(
    app,
    /if \(location\.pathname !== LOGIN_PATH && location\.pathname !== "\/"\) \{\s*document\.title = t\("app\.documentTitle"\)/
  )
  assert.match(
    landing,
    /api<\{ product_name: string; workspace_name: string \}>\(/
  )
  assert.match(landing, /"\/api\/auth\/v1\/branding"/)
  assert.match(landing, /branding\.product_name\.trim\(\) \|\| "MonkeyAI"/)
  assert.match(landing, /branding\.workspace_name\.trim\(\) \|\| "Monkey AI"/)
  assert.match(
    landing,
    /document\.title = t\("landing\.title", \{ productName \}\)/
  )
  assert.match(landing, /<h1[^>]*>\s*\{t\("landing\.positioning"\)\}/)
  assert.match(landing, /render=\{<Link to=\{LOGIN_PATH\} \/>\}/)
  assert.match(landing, /href="https:\/\/github\.com\/chaitin\/monkeycode"/)
  assert.match(landing, /i18nKey="landing\.poweredBy"/)
  assert.match(landing, /repo: \(/)
  assert.match(html, /<title>MonkeyAI \| AI Workbench<\/title>/)
})

test("landing copy is available in every supported language", () => {
  const keys = [
    "title",
    "positioning",
    "promise",
    "management",
    "modesLabel",
    "poweredBy",
  ]
  const downloadKeys = [
    "title",
    "description",
    "download",
    "unavailable",
    "android",
    "ios",
    "windows",
    "linux",
    "macos",
    "appleSilicon",
    "intel",
    "harmonyDesktop",
  ]

  for (const [language, resource] of Object.entries(resources)) {
    for (const key of keys) {
      assert.ok(resource.landing[key], `${language} is missing landing.${key}`)
    }
    for (const mode of ["coding", "work", "design"]) {
      assert.ok(
        resource.landing.modeNames[mode],
        `${language} is missing landing.modeNames.${mode}`
      )
      assert.ok(
        resource.landing.modeDescriptions[mode],
        `${language} is missing landing.modeDescriptions.${mode}`
      )
    }
    for (const key of [
      "title",
      "sharingTitle",
      "sharingDescription",
      "billingTitle",
      "billingDescription",
      "governanceTitle",
      "governanceDescription",
      "statisticsTitle",
      "statisticsDescription",
    ]) {
      assert.ok(
        resource.landing.enterprise[key],
        `${language} is missing landing.enterprise.${key}`
      )
    }
    for (const key of downloadKeys) {
      assert.ok(
        resource.landing.downloads[key],
        `${language} is missing landing.downloads.${key}`
      )
    }
    assert.ok(resource.landing.title.includes("{{productName}}"), language)
    assert.ok(
      resource.landing.poweredBy.includes("<repo>Monkey AI</repo>"),
      language
    )
  }
  assert.deepEqual(zhCN.landing.modeNames, {
    coding: "编程",
    work: "办公",
    design: "设计",
  })
  assert.equal(zhCN.landing.positioning, "企业 AI 办公工作台")
  assert.equal(
    zhCN.landing.promise,
    "只要说出需求，AI 就会开始执行任务，并交付完整成果。"
  )
  assert.equal(
    zhCN.landing.management,
    "完善的企业管理面板，支持丰富的团队协作。"
  )
  assert.match(
    zhCN.landing.enterprise.sharingDescription,
    /大模型、知识库、技能、专家、MCP 和规则/
  )
  assert.equal(zhCN.landing.poweredBy, "当前系统由 <repo>Monkey AI</repo> 驱动")
})

test("powered-by footer renders Monkey AI inside a clickable link", async () => {
  const i18n = i18next.createInstance()
  await i18n.use(initReactI18next).init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zhCN } },
  })
  const url = "https://github.com/chaitin/monkeycode"
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(Trans, {
        i18nKey: "landing.poweredBy",
        components: { repo: createElement("a", { href: url }) },
      })
    )
  )
  assert.equal(markup, `当前系统由 <a href="${url}">Monkey AI</a> 驱动`)
})

test("client download configuration covers every platform and both desktop architectures", async () => {
  const config = JSON.parse(
    await readFile(new URL("../public/downloads.json", import.meta.url), "utf8")
  )
  assert.deepEqual(Object.keys(config).sort(), [
    "android",
    "harmony_desktop",
    "ios",
    "linux_arm64",
    "linux_x64",
    "macos_arm64",
    "macos_x64",
    "windows",
  ])
  assert.deepEqual(
    Object.keys(config)
      .filter((key) => config[key])
      .sort(),
    ["linux_x64", "macos_arm64", "macos_x64", "windows"]
  )
  assert.equal(
    config.macos_x64,
    "https://release.monkeycode-ai.com/public/monkeyai/desktop/mac/x64/MonkeyAI-latest-mac-x64.dmg"
  )
  for (const url of Object.values(config)) {
    assert.ok(
      typeof url === "string" &&
        (url === "" || /^https?:\/\/|^\/(?!\/)/.test(url))
    )
  }
})
