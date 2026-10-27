import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

if (!process.env.CHROME_BIN)
  throw new Error("请设置 CHROME_BIN；先执行 pnpm build")
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
try {
  for (const scenario of [
    "empty",
    "expired",
    "branding-empty",
    "branding-error",
    "avatar",
    "broken-avatar",
    "blank-avatar",
    "scoped",
    "localhost",
    "unsafe-https",
    "unsafe-script",
    "logged-out",
    "logged-out-sso",
    "logged-out-sso-only",
    "logged-out-password",
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    })
    page.setDefaultTimeout(10000)
    const errors = [],
      navigations = []
    page.on("pageerror", (error) => errors.push(error.message))
    const scopes = scenario === "scoped" ? ["files:read"] : []
    const redirect =
      scenario === "scoped"
        ? "http://[::1]:54322/oauth/callback"
        : scenario === "localhost"
          ? "http://localhost:54323/oauth/callback"
          : "http://127.0.0.1:54321/oauth/callback"
    const loggedOut = scenario.startsWith("logged-out")
    const providers = scenario.startsWith("logged-out-sso")
      ? [
          { id: "enterprise", provider: "oidc", name: "企业统一登录" },
          { id: "backup", provider: "oauth2", name: "备用登录" },
        ]
      : []
    const user = {
      id: "review-user",
      name: "授权测试用户",
      email: "review@example.com",
      last_login_at: scenario === "scoped" ? "2026-10-26T01:34:56Z" : undefined,
      avatar_url:
        scenario === "avatar"
          ? " http://auth.test/avatar-valid.webp "
          : scenario === "broken-avatar"
            ? " http://auth.test/avatar-missing.webp "
            : scenario === "blank-avatar"
              ? " \t "
              : undefined,
      role: "user",
      status: "active",
    }
    let completions = 0,
      brandingRequests = 0,
      authenticated = !loggedOut,
      passwordLogins = 0,
      ssoStarts = 0,
      release
    const pending = new Promise((resolve) => {
      release = resolve
    })
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        p = url.pathname
      const json = (body, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        })
      if (request.isNavigationRequest() && url.hostname !== "auth.test") {
        navigations.push(url.toString())
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: "<p>应用已收到授权码</p>",
        })
      }
      if (p.startsWith("/api/")) {
        if (p.endsWith("/session"))
          return json({
            authenticated,
            user: authenticated ? user : null,
          })
        if (p.endsWith("/branding")) {
          brandingRequests++
          assert.equal(request.method(), "GET")
          if (scenario === "branding-error")
            return json({ error: { message: "模拟品牌配置加载失败" } }, 503)
          return json({
            product_name:
              scenario === "branding-empty" ? " \t " : " 团队 AI 办公 ",
            workspace_name:
              scenario === "branding-empty" ? " \t " : " 百智团队 ",
          })
        }
        if (p.startsWith("/api/auth/v1/oauth/")) {
          assert.equal(p, "/api/auth/v1/oauth/enterprise/start")
          assert.equal(url.searchParams.get("request_id"), "review")
          assert.equal(request.method(), "GET")
          ssoStarts++
          return route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: "<p>正在打开登录提供方</p>",
          })
        }
        if (p === "/api/auth/v1/login") {
          assert.equal(request.method(), "POST")
          assert.deepEqual(request.postDataJSON(), {
            email: user.email,
            password: "fixture-password",
            code: "",
          })
          passwordLogins++
          await pending
          authenticated = true
          return json(user)
        }
        if (p.endsWith("/methods"))
          return json({
            password_enabled: scenario !== "logged-out-sso-only",
            email_code_enabled: false,
            email_code_auto_registration_enabled: false,
          })
        if (p.endsWith("/client-requests/review") && scenario === "expired")
          return json(
            { error: { message: "授权请求不存在、已完成或已过期" } },
            404
          )
        if (p.endsWith("/client-requests/review"))
          return json({
            request_id: "review",
            client: {
              client_id: "monkeyai-desktop",
              name: "MonkeyAI Desktop",
              redirect_uri: redirect,
            },
            authenticated,
            user: authenticated ? user : null,
            providers,
            scopes,
            scope_descriptions: { "files:read": "读取获准文件" },
            consent_required: scenario === "scoped",
            csrf_token: "csrf-review-proof",
          })
        if (p.endsWith("/client-requests/review/complete")) {
          completions++
          assert.equal(request.method(), "POST")
          assert.equal(request.headers()["x-csrf-token"], "csrf-review-proof")
          assert.deepEqual(request.postDataJSON(), { approved_scopes: scopes })
          if (scenario.startsWith("unsafe-") && completions === 1) {
            await pending
            return json({ error: { message: "模拟授权失败" } }, 503)
          }
          const launch =
            scenario === "unsafe-https"
              ? "https://oauth-audit.invalid/callback?code=code&state=state"
              : scenario === "unsafe-script"
                ? "javascript:window.__unsafe=1//?code=code&state=state"
                : `${redirect}?code=review-code&state=review-state`
          return json({ launch_url: launch })
        }
        assert.equal(request.method(), "GET", "unexpected authentication write")
        return json({ items: [] })
      }
      if (p === "/avatar-valid.webp")
        return route.fulfill({
          contentType: "image/webp",
          body: await readFile(path.join(dist, "monkeyai-logo.webp")),
        })
      if (p === "/avatar-missing.webp")
        return route.fulfill({ status: 404, body: "" })
      const requested = path.resolve(dist, `.${p}`)
      const exists =
        requested.startsWith(dist) &&
        (await stat(requested)
          .then((s) => s.isFile())
          .catch(() => false))
      const file = exists ? requested : path.join(dist, "index.html")
      const types = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".png": "image/png",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
      }
      return route.fulfill({
        contentType: types[path.extname(file)] || "application/octet-stream",
        body: await readFile(file),
      })
    })
    await page.goto("http://auth.test/client-login?request_id=review")
    const expectedProductName = scenario.startsWith("branding-")
      ? "MonkeyAI"
      : "团队 AI 办公"
    await page.waitForFunction(
      ({ product, workspace }) =>
        document.querySelector('[data-slot="card-description"]')
          ?.textContent === `${product}即将登录到${workspace}的团队空间`,
      {
        product: expectedProductName,
        workspace: scenario.startsWith("branding-") ? "Monkey AI" : "百智团队",
      }
    )
    const expectedImage =
      scenario === "avatar"
        ? "http://auth.test/avatar-valid.webp"
        : "/monkeyai-logo.webp"
    await page.waitForFunction((src) => {
      const image = document.querySelector('[data-slot="card-header"] img')
      return (
        image?.getAttribute("src") === src &&
        image.complete &&
        image.naturalWidth > 0
      )
    }, expectedImage)
    if (scenario === "expired") {
      await page.waitForFunction(() => {
        const alert = document.querySelector('[data-slot="alert"]')
        return (
          alert?.querySelector('[data-slot="alert-title"]')?.textContent ===
            "授权请求访问失败" &&
          alert
            .querySelector('[data-slot="alert-description"]')
            ?.textContent.includes("授权请求可能不存在、已完成或已过期") &&
          !!alert.querySelector("svg")
        )
      })
      assert.equal(completions, 0)
      assert.equal(await page.locator('button[type="submit"]').count(), 0)
    } else if (loggedOut) {
      if (scenario === "logged-out-sso-only") {
        await page.waitForFunction(() =>
          document.querySelector('button[title="企业统一登录"]')
        )
      } else {
        await page.waitForFunction(() =>
          document.querySelector('input[type="email"]')
        )
      }
      await page.waitForTimeout(200)
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll("button")].some(
            (el) => el.textContent.trim() === "确认授权"
          )
        ),
        false
      )
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      if (providers.length > 0) {
        const layout = await page.evaluate(() => {
          const button = document.querySelector('button[title="企业统一登录"]')
          const form = document.querySelector("form")
          return {
            label: button.textContent.trim(),
            centered: getComputedStyle(button).justifyContent === "center",
            hasIcon: !!button.querySelector("svg"),
            hasSeparator: !!document.querySelector('[data-slot="marker"]'),
            hasEmail: !!document.querySelector('input[type="email"]'),
            formFirst:
              !form ||
              form.getBoundingClientRect().bottom <
                button.getBoundingClientRect().top,
          }
        })
        assert.deepEqual(layout, {
          label: "企业统一登录",
          centered: true,
          hasIcon: true,
          hasSeparator: scenario !== "logged-out-sso-only",
          hasEmail: scenario !== "logged-out-sso-only",
          formFirst: true,
        })
        await page.screenshot({
          path: `/tmp/monkeyai-client-login-${scenario}-${(await browser.version()).split(".")[0]}.png`,
          fullPage: true,
        })
        await page.evaluate(() =>
          document.querySelector('button[title="企业统一登录"]').click()
        )
        await page.waitForFunction(() =>
          document.body.textContent.includes("正在打开登录提供方")
        )
        assert.equal(ssoStarts, 1)
      } else if (scenario === "logged-out-password") {
        await page.evaluate(
          ({ email, password }) => {
            const setValue = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value"
            ).set
            for (const [id, value] of [
              ["auth-email", email],
              ["auth-password", password],
            ]) {
              const input = document.getElementById(id)
              setValue.call(input, value)
              input.dispatchEvent(new Event("input", { bubbles: true }))
            }
          },
          { email: user.email, password: "fixture-password" }
        )
        await page.evaluate(() =>
          document.querySelector('button[type="submit"]').click()
        )
        await page.waitForFunction(
          () =>
            document.querySelector("fieldset")?.disabled &&
            document
              .querySelector('button[type="submit"]')
              ?.getAttribute("aria-busy") === "true"
        )
        assert.equal(passwordLogins, 1)
        release()
        await page.waitForFunction(() =>
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent.trim() === "确认授权"
          )
        )
        assert.ok((await page.textContent("body")).includes(user.email))
        assert.equal(completions, 0, "logging in must still require approval")
      }
    } else {
      await page.waitForFunction(() =>
        [...document.querySelectorAll("button")].some(
          (el) => el.textContent.trim() === "确认授权"
        )
      )
      await page.waitForTimeout(200)
      assert.equal(
        completions,
        0,
        "an existing login/empty scopes/legacy consent=false must never auto-authorize"
      )
      const body = await page.textContent("body")
      assert.ok(body.includes(user.email))
      assert.ok(body.includes(user.name))
      assert.equal(body.includes("需要使用你的登录身份"), false)
      const lastLogin = await page
        .getByText("上次登录", { exact: true })
        .locator("..")
        .locator("dd")
        .textContent()
      assert.equal(
        lastLogin.trim(),
        user.last_login_at ? "2026/10/26 09:34" : "—"
      )
      assert.equal(body.includes("授权码仅可使用一次"), false)
      assert.equal(body.includes("返回应用地址"), false)
      assert.equal(body.includes(redirect), false)
      assert.equal(body.includes("同时申请以下权限"), false)
      assert.equal(body.includes("读取获准文件"), false)
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      const approve = () =>
        page.evaluate(() =>
          document.querySelector('button[type="submit"]').click()
        )
      await approve()
      if (scenario.startsWith("unsafe-")) {
        await page.waitForFunction(
          () =>
            document
              .querySelector('button[type="submit"]')
              ?.getAttribute("aria-busy") === "true"
        )
        const button = await page.evaluate(() => {
          const node = document.querySelector('button[type="submit"]')
          return {
            text: node.textContent.trim(),
            disabled: node.disabled,
            spinner: getComputedStyle(node.querySelector("svg")).animationName,
          }
        })
        assert.deepEqual(button, {
          text: "确认授权",
          disabled: true,
          spinner: "spin",
        })
        await approve()
        assert.equal(completions, 1)
        release()
        await page.waitForFunction(
          () =>
            document
              .querySelector('[role="alert"]')
              ?.textContent.includes("模拟授权失败") &&
            !document.querySelector('button[type="submit"]').disabled
        )
        await approve()
        await page.waitForFunction(() =>
          document
            .querySelector('[role="alert"]')
            ?.textContent.includes("授权回调地址校验失败")
        )
        assert.equal(completions, 2)
        assert.deepEqual(navigations, [])
        assert.equal(await page.evaluate(() => window.__unsafe), undefined)
        assert.equal(
          await page.evaluate(
            () =>
              !!document.querySelector(
                'a[href*="oauth-audit.invalid"], a[href^="javascript:"]'
              )
          ),
          false
        )
      } else {
        await page
          .waitForFunction(() =>
            document.body.textContent.includes("应用已收到授权码")
          )
          .catch(async (error) => {
            console.error({
              scenario,
              completions,
              navigations,
              url: page.url(),
              body: await page.textContent("body"),
            })
            throw error
          })
        assert.equal(completions, 1)
        assert.equal(navigations.length, 1)
        const callback = new URL(navigations[0])
        assert.equal(callback.searchParams.get("code"), "review-code")
        assert.equal(callback.searchParams.get("state"), "review-state")
        callback.search = ""
        assert.equal(callback.toString(), redirect)
      }
    }
    if (loggedOut) assert.equal(completions, 0)
    assert.ok(brandingRequests > 0, "client login must request branding")
    assert.deepEqual(errors, [])
    console.log(
      `${scenario}: explicit approval, bound destination and safe navigation passed`
    )
    await page.close()
  }
  console.log(
    `${await browser.version()}: client authorization regression passed`
  )
} finally {
  await browser.close()
}
