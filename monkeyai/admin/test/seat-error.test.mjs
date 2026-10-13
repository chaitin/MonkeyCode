import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { runInNewContext } from "node:vm"

import i18next from "i18next"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as jsxRuntime from "react/jsx-runtime"
import ts from "typescript"

import { enUS } from "../src/i18n/locales/en-US.ts"
import { zhCN } from "../src/i18n/locales/zh-CN.ts"

async function renderLoginPage(page, search, language) {
  const translation = i18next.createInstance()
  await translation.init({
    lng: language,
    resources: {
      "zh-CN": { translation: zhCN },
      "en-US": { translation: enUS },
    },
  })
  const source = await readFile(
    new URL(`../src/pages/${page}.tsx`, import.meta.url),
    "utf8"
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const toasts = []
  const module = { exports: {} }
  const componentStub = ({ children }) =>
    React.createElement("div", null, children)
  runInNewContext(compiled, {
    exports: module.exports,
    document: { title: "" },
    AbortController,
    URLSearchParams,
    require: (name) => {
      switch (name) {
        case "react":
          return { ...React, useEffect: (effect) => effect() }
        case "react/jsx-runtime":
          return jsxRuntime
        case "react-i18next":
          return { useTranslation: () => ({ t: translation.t }) }
        case "react-router-dom":
          return {
            useSearchParams: () => [new URLSearchParams(search)],
            useLocation: () => ({ search }),
            useNavigate: () => () => {},
          }
        case "@/lib/api":
          return { api: () => new Promise(() => {}) }
        case "@/hooks/use-auth":
          return { useAuth: () => ({ isLoading: false, user: null }) }
        case "@/components/animated-toast-provider":
          return {
            useAppToast: () => ({ showToast: (toast) => toasts.push(toast) }),
          }
        default:
          return new Proxy({}, { get: () => componentStub })
      }
    },
  })
  const Component =
    module.exports[page === "login-page" ? "LoginPage" : "ClientLoginPage"]
  return {
    html: renderToStaticMarkup(React.createElement(Component)),
    toasts,
  }
}

for (const [code, key, message] of [
  [
    "seats_exceeded",
    "seatsExceeded",
    "席位不足，请联系管理员导入有效 License 或增加授权席位。",
  ],
  [
    "seats_unavailable",
    "seatsUnavailable",
    "席位授权不可用，请联系管理员导入有效 License。",
  ],
]) {
  for (const [language, resource] of Object.entries({
    "zh-CN": zhCN,
    "en-US": enUS,
  })) {
    test(`${language} ${code} 在客户端和管理员登录页显示 License 提示`, async () => {
      const expected = resource.login[key]
      if (language === "zh-CN") assert.equal(expected, message)
      assert.ok(expected.includes("License"))
      for (const request of ["", "&request_id=client-request"]) {
        const client = await renderLoginPage(
          "client-login-page",
          `?error=${code}${request}`,
          language
        )
        assert.ok(client.html.includes(expected), client.html)
        assert.match(client.html, /role="alert"/)
      }
      const admin = await renderLoginPage(
        "login-page",
        `?oauth_error=${code}`,
        language
      )
      assert.equal(admin.toasts.length, 1)
      assert.equal(admin.toasts[0].title, expected)
      assert.equal(admin.toasts[0].status, "error")
    })
  }
}
