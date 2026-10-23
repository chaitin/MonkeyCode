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
    "scoped",
    "localhost",
    "unsafe-https",
    "unsafe-script",
    "logged-out",
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
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
    const user = {
      id: "review-user",
      name: "授权测试用户",
      email: "review@example.com",
      role: "user",
      status: "active",
    }
    let completions = 0,
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
            authenticated: scenario !== "logged-out",
            user: scenario === "logged-out" ? null : user,
          })
        if (p.endsWith("/branding")) return json({ product_name: "MonkeyAI" })
        if (p.endsWith("/methods"))
          return json({
            password_enabled: true,
            email_code_enabled: false,
            email_code_auto_registration_enabled: false,
          })
        if (p.endsWith("/client-requests/review"))
          return json({
            request_id: "review",
            client: {
              client_id: "monkeyai-desktop",
              name: "MonkeyAI Desktop",
              redirect_uri: redirect,
            },
            authenticated: scenario !== "logged-out",
            user: scenario === "logged-out" ? null : user,
            providers: [],
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
    if (scenario === "logged-out") {
      await page.waitForFunction(() =>
        document.querySelector('input[type="email"]')
      )
      await page.waitForTimeout(200)
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll("button")].some(
            (el) => el.textContent.trim() === "确认授权"
          )
        ),
        false
      )
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
      assert.ok((await page.textContent("body")).includes(user.email))
      assert.ok((await page.textContent("body")).includes(redirect))
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
    if (scenario === "logged-out") assert.equal(completions, 0)
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
