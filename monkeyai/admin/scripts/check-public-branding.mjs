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
  for (const width of [390, 1440]) {
    for (const scenario of [
      "paid",
      "unpaid",
      "legacy",
      "invalid-flag",
      "unavailable",
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        locale: "zh-CN",
      })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.route("**/*", async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const json = (body, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          })
        if (url.pathname === "/api/auth/v1/branding") {
          assert.equal(request.method(), "GET")
          if (scenario === "unavailable")
            return json({ error: { message: "配置暂不可用" } }, 503)
          const branding = {
            product_name: "测试产品",
            workspace_name: "测试团队",
            machine_code: "public-machine-code",
          }
          if (scenario !== "legacy")
            branding.has_commercial_license =
              scenario === "paid"
                ? true
                : scenario === "invalid-flag"
                  ? "true"
                  : false
          return json(branding)
        }
        if (url.pathname.startsWith("/api/")) {
          assert.equal(request.method(), "GET")
          return json(
            url.pathname.endsWith("/session")
              ? { authenticated: false, user: null }
              : { items: [] }
          )
        }
        const requested = path.resolve(dist, `.${url.pathname}`)
        const exists =
          requested.startsWith(dist) &&
          (await stat(requested)
            .then((value) => value.isFile())
            .catch(() => false))
        const file = exists ? requested : path.join(dist, "index.html")
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".png": "image/png",
          ".webp": "image/webp",
          ".woff2": "font/woff2",
        }
        return route.fulfill({
          contentType: types[path.extname(file)] || "application/octet-stream",
          body: await readFile(file),
        })
      })
      const brandingResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth/v1/branding"
      )
      await page.goto("http://branding.test/")
      await brandingResponse
      const product = scenario === "unavailable" ? "MonkeyAI" : "测试产品"
      await page.waitForFunction(
        (name) => document.querySelector("footer")?.textContent.includes(name),
        product
      )
      const footer = await page.evaluate(() => ({
        poweredBy: !!document.querySelector(
          'footer a[href="https://work.baizhi.cloud/"]'
        ),
        text: document.querySelector("footer").textContent,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }))
      assert.equal(
        footer.poweredBy,
        scenario !== "paid",
        `${scenario}: hide attribution only for a verified commercial license`
      )
      assert.ok(footer.text.includes(product))
      assert.equal(
        (await page.textContent("body")).includes("public-machine-code"),
        false
      )
      assert.equal(footer.overflow, false)
      assert.deepEqual(errors, [])
      console.log(
        `${width}px ${scenario}: public branding and attribution passed`
      )
      await page.close()
    }
  }
  console.log(`${await browser.version()}: public branding passed`)
} finally {
  await browser.close()
}
