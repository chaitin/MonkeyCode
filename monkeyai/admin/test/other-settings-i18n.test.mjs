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

test("other settings use toasts for transient operation feedback", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /const \{ showToast \} = useAppToast\(\)/)
  assert.match(
    source,
    /status: "success",\s*title: t\("pages\.otherSettings\.brandInfo\.saved"\)/
  )
  assert.match(
    source,
    /status: "success",\s*title: t\("pages\.otherSettings\.email\.saved"\)/
  )
  assert.match(
    source,
    /status: "success",\s*title: t\("pages\.otherSettings\.email\.testSent"/
  )
  assert.match(source, /showToast\(\{ status: "error", title:/)
  assert.doesNotMatch(
    source,
    /brandInfoSaved|settingsError|testError|testSentTo/
  )
  assert.doesNotMatch(
    source,
    /<Badge[^>]*>\s*\{t\("pages\.otherSettings\.brandInfo\.saved"/
  )
  assert.doesNotMatch(source, /CardFooter|oauth\.connectionCount/)
})

test("email sender identity fields appear at the bottom of the dialog", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )
  const fields = source
    .split('<FieldLabel htmlFor="smtp-host">')[1]
    .split("<DialogFooter>")[0]

  assert.ok(fields.indexOf("<RadioGroup") >= 0)
  assert.ok(
    fields.indexOf("<RadioGroup") < fields.indexOf('htmlFor="sender-name"')
  )
  assert.ok(
    fields.indexOf('htmlFor="sender-name"') <
      fields.indexOf('htmlFor="sender-email"')
  )
  assert.match(
    fields,
    /<FieldSet className="md:col-span-2">\s*<FieldLegend variant="label">\s*\{t\("pages\.otherSettings\.email\.encryption"\)\}[\s\S]*?<RadioGroup/
  )
  assert.match(fields, /<RadioGroup\s+className="grid grid-cols-3 gap-3"/)
  assert.match(
    fields,
    /<FieldLabel[\s\S]*?htmlFor=\{`smtp-encryption-\$\{item\.value\}`\}[\s\S]*?className="h-9 [^"]*"[\s\S]*?<RadioGroupItem/
  )
  assert.doesNotMatch(fields, /<Field orientation="horizontal"/)
  assert.doesNotMatch(fields, /<SelectTrigger id="smtp-encryption"/)
  assert.doesNotMatch(
    source,
    /t\("pages\.otherSettings\.email\.dialogDescription"\)/
  )
  assert.equal(zhCN.pages.otherSettings.email.encryption, "加密方式")
  assert.equal(zhCN.pages.otherSettings.email.senderName, "发信人名称")
  assert.equal(zhCN.pages.otherSettings.email.senderEmail, "发信邮箱")
  assert.equal(zhTW.pages.otherSettings.email.encryption, "加密方式")
  assert.equal(zhTW.pages.otherSettings.email.senderName, "發信人名稱")
  assert.equal(zhTW.pages.otherSettings.email.senderEmail, "發信信箱")
})

test("settings cards place tags and knowledge after email", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /<Card className="order-1">[\s\S]*?loginMethods\.title/)
  assert.match(source, /<Card className="order-2">[\s\S]*?email\.title/)
  assert.match(source, /<Card className="order-3">[\s\S]*?skillTags\.title/)
  assert.match(source, /<Card className="order-4">[\s\S]*?knowledgeBase\.title/)
})

test("skill tags use an auto-fit grid without fixed item widths", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )
  const tags = source
    .split('t("pages.otherSettings.skillTags.title")')[1]
    .split("<Dialog open={tagDialogOpen}")[0]

  assert.match(
    tags,
    /<ItemGroup className="grid grid-cols-\[repeat\(auto-fit,minmax\(13rem,1fr\)\)\] gap-2">/
  )
  assert.match(tags, /<Item\s+className="w-full"/)
  assert.doesNotMatch(tags, /sm:w-52|flex-wrap/)
})

test("settings cards use abstract purpose-oriented descriptions", () => {
  assert.equal(
    zhCN.pages.otherSettings.brandInfo.description,
    "用于修改产品的品牌信息。"
  )
  assert.equal(
    zhTW.pages.otherSettings.brandInfo.description,
    "用於修改產品的品牌資訊。"
  )
  assert.equal(
    zhCN.pages.otherSettings.loginMethods.description,
    "配置系统支持的身份验证方式。"
  )
  assert.equal(
    zhCN.pages.otherSettings.email.description,
    "配置系统邮件服务及相关功能。"
  )
  assert.equal(
    zhTW.pages.otherSettings.loginMethods.description,
    "設定系統支援的身分驗證方式。"
  )
  assert.equal(
    zhTW.pages.otherSettings.email.description,
    "設定系統郵件服務及相關功能。"
  )
  assert.equal(
    zhCN.pages.otherSettings.skillTags.description,
    "用于统一组织和管理系统资源。"
  )
  assert.equal(
    zhCN.pages.otherSettings.knowledgeBase.description,
    "用于管理知识内容的处理与检索能力。"
  )
  assert.equal(
    zhTW.pages.otherSettings.skillTags.description,
    "用於統一組織和管理系統資源。"
  )
  assert.equal(
    zhTW.pages.otherSettings.knowledgeBase.description,
    "用於管理知識內容的處理與檢索能力。"
  )
})

test("email summary hides email-dependent controls when unconfigured", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )
  const summary = source
    .split('t("pages.otherSettings.email.sendingConfiguration")')[1]
    .split("</ItemDescription>")[0]

  assert.match(
    summary,
    /emailConfigurationVisible \? \([\s\S]*?\{savedEmailSettings\.senderEmail\}[\s\S]*?pages\.otherSettings\.email\.notConfigured/
  )
  assert.doesNotMatch(
    summary,
    /savedEmailSettings\.(senderName|smtpHost|smtpPort|smtpUsername|encryption)/
  )
  assert.match(
    source,
    /const \[emailConfigured, setEmailConfigured\] = useState\(false\)/
  )
  assert.match(source, /setEmailConfigured\(true\)/)
  assert.match(
    source,
    /\{emailConfigurationVisible && \(\s*<>[\s\S]*?pages\.otherSettings\.loginMethods\.emailCode[\s\S]*?onCheckedChange=\{setEmailCodePendingValue\}[\s\S]*?pages\.otherSettings\.loginMethods\.autoRegisterMissingUsers[\s\S]*?checked=\{\s*loginMethodSettings\.emailCodeAutoRegistrationEnabled\s*\}[\s\S]*?setAutoRegistrationPending\(\{\s*type: "email",\s*enabled,[\s\S]*?id="test-recipient"[\s\S]*?<\/Item>\s*<\/>\s*\)\}/
  )
  const loginMethodsCard = source
    .split('t("pages.otherSettings.loginMethods.title")')[1]
    .split('t("pages.otherSettings.email.title")')[0]
  assert.doesNotMatch(loginMethodsCard, /loginMethods\.emailCode/)
  assert.doesNotMatch(source, /loginMethods\.emailCodeDescription/)
  assert.equal(
    zhCN.pages.otherSettings.loginMethods.emailCode,
    "使用邮箱验证码登录"
  )
  assert.equal(
    zhTW.pages.otherSettings.loginMethods.emailCode,
    "使用電子郵件驗證碼登入"
  )
  assert.equal(
    zhCN.pages.otherSettings.loginMethods.autoRegisterMissingUsers,
    "用户不存在时自动注册"
  )
  assert.equal(zhCN.pages.otherSettings.email.notConfigured, "尚未配置")
})

test("global registration is removed and password uses an item with confirmation", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )
  const loginCard = source
    .split('t("pages.otherSettings.loginMethods.title")')[1]
    .split('t("pages.otherSettings.email.title")')[0]

  assert.doesNotMatch(loginCard, /loginMethods\.allowRegistration/)
  assert.doesNotMatch(source, /\bregistration_enabled\b/)
  assert.match(
    loginCard,
    /<Item variant="outline">[\s\S]*?loginMethods\.password[\s\S]*?onCheckedChange=\{setPasswordPendingValue\}/
  )
  assert.doesNotMatch(source, /loginMethods\.passwordDescription/)
  assert.match(source, /open=\{passwordPendingValue !== null\}/)
  assert.match(source, /enablePasswordDialogTitle/)
  assert.match(source, /disablePasswordDialogTitle/)
  assert.match(
    source,
    /await setLoginMethodEnabled\(\s*"passwordEnabled",\s*passwordPendingValue\s*\)[\s\S]*?setPasswordPendingValue\(null\)/
  )
  assert.equal(zhCN.pages.otherSettings.loginMethods.password, "使用密码登录")
  assert.equal(
    zhCN.pages.otherSettings.loginMethods.enablePasswordDialogTitle,
    "启用密码登录？"
  )
  assert.equal(
    zhCN.pages.otherSettings.loginMethods.disablePasswordDialogTitle,
    "关闭密码登录？"
  )
})

test("per-method auto-registration persists only after confirmation", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(
    source,
    /email_code_auto_registration_enabled:\s*loginMethods\.emailCodeAutoRegistrationEnabled/
  )
  assert.match(
    source,
    /auto_registration_enabled: connection\.autoRegistrationEnabled/
  )
  assert.match(source, /open=\{autoRegistrationPending !== null\}/)
  assert.match(source, /onClick=\{confirmAutoRegistration\}/)
  assert.match(source, /enableEmailAutoRegistrationDialogTitle/)
  assert.match(source, /disableEmailAutoRegistrationDialogTitle/)
  assert.match(source, /enableOauthAutoRegistrationDialogTitle/)
  assert.match(source, /disableOauthAutoRegistrationDialogTitle/)
  assert.match(
    source,
    /await saveAuthentication\(oauthConnections, nextSettings\)[\s\S]*?setLoginMethodSettings\(nextSettings\)/
  )
  assert.match(
    source,
    /connection\.id === autoRegistrationPending\.connection\.id[\s\S]*?autoRegistrationEnabled: autoRegistrationPending\.enabled[\s\S]*?await saveAuthentication\(connections\)/
  )
})

test("standalone email registration is removed", async () => {
  const source = await readFile(
    new URL("../src/components/email-auth-form.tsx", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(
    source,
    /"register"|email\/register|\bregistration_enabled\b/
  )
})

test("email code sign-in changes require confirmation", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(
    source,
    /const \[emailCodePendingValue, setEmailCodePendingValue\] = useState<\s*boolean \| null\s*>\(null\)/
  )
  assert.match(source, /onCheckedChange=\{setEmailCodePendingValue\}/)
  assert.match(source, /<AlertDialog\s+open=\{emailCodePendingValue !== null\}/)
  assert.match(source, /enableEmailCodeDialogTitle/)
  assert.match(source, /disableEmailCodeDialogTitle/)
  assert.match(
    source,
    /await setLoginMethodEnabled\(\s*"emailCodeEnabled",\s*emailCodePendingValue\s*\)[\s\S]*?setEmailCodePendingValue\(null\)/
  )
  assert.equal(
    zhCN.pages.otherSettings.loginMethods.enableEmailCodeDialogTitle,
    "启用邮箱验证码登录？"
  )
  assert.equal(
    zhCN.pages.otherSettings.loginMethods.disableEmailCodeDialogTitle,
    "关闭邮箱验证码登录？"
  )
})

test("other settings configuration buttons use the secondary style", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.equal(
    (
      source.match(
        /DialogTrigger render=\{<Button variant="secondary" \/>\}/g
      ) ?? []
    ).length,
    3
  )
  assert.match(
    source,
    /variant="secondary"\s+onClick=\{\(\) => handleEmailDialogOpenChange\(true\)\}/
  )
  assert.doesNotMatch(
    source,
    /DialogTrigger render=\{<Button variant="outline" \/>\}[\s\S]*?knowledgeBase\.configure/
  )
  assert.match(
    source,
    /type="submit"\s+variant="secondary"\s+disabled=\{testSending\}/
  )
})

test("other settings are fully translated in every supported language", () => {
  const expectedPaths = getLeafPaths(enUS.pages.otherSettings).sort()

  for (const [language, resource] of Object.entries(resources)) {
    assert.deepEqual(
      getLeafPaths(resource.pages.otherSettings).sort(),
      expectedPaths,
      `${language} is missing other settings translations`
    )
  }
})
