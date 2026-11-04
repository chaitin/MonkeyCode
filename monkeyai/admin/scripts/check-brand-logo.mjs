import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

if (!process.env.CHROME_BIN)
  throw new Error("Set CHROME_BIN and build admin first")
const dist = path.resolve(fileURLToPath(new URL("../dist/", import.meta.url)))
const image = await readFile(
  new URL("../public/logo-light.png", import.meta.url)
)
const webp = Buffer.from(
  "UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoIAAYAAUAmJaACdLoB+AADsAD+9Bi3/q0PlofLQ/hIf+Uq8FjdmwAA",
  "base64"
)
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox"],
})
try {
  for (const width of process.env.WIDTH
    ? [Number(process.env.WIDTH)]
    : [390, 1440])
    for (const dark of process.env.DARK
      ? [process.env.DARK === "1"]
      : [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      })
      page.setDefaultTimeout(8000)
      await page.addInitScript(() => {
        const nativeFetch = window.fetch
        window.fetch = (input, init) => {
          if (
            String(input).endsWith("/api/admin/v1/settings/branding") &&
            init?.body instanceof FormData
          )
            window.__brandForm = Object.fromEntries(
              ["workspace_name", "product_name", "logo_action"].map((key) => [
                key,
                init.body.get(key),
              ])
            )
          return nativeFetch(input, init)
        }
      })
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      let authenticated = false,
        version = 0,
        broken = false,
        failNext = false,
        invalidNext = false,
        legacy = false,
        unavailable = false,
        release
      const branding = { workspace_name: "测试团队", product_name: "测试产品" },
        writes = []
      const logo = () =>
        version ? `http://logo.test/api/auth/v1/branding/logo?v=${version}` : ""
      const record = () => ({
        key: "branding",
        value: { ...branding, logo_url: logo() },
        schema_version: 1,
      })
      await page.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          endpoint = url.pathname
        const json = (body, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          })
        if (endpoint === "/api/auth/v1/branding")
          return unavailable
            ? json({ error: { message: "unavailable" } }, 503)
            : json({
                ...branding,
                ...(!legacy ? { logo_url: logo() } : {}),
                has_commercial_license: false,
                machine_code: "test-machine",
              })
        if (endpoint === "/api/auth/v1/branding/logo")
          return broken || !version
            ? route.fulfill({ status: 404, body: "" })
            : route.fulfill({ contentType: "image/png", body: image })
        if (
          endpoint === "/api/admin/v1/settings/branding" &&
          request.method() === "PUT"
        ) {
          const multipart = request
            .headers()
            ["content-type"]?.startsWith("multipart/form-data")
          const data = multipart
            ? await page.evaluate(() => window.__brandForm)
            : request.postDataJSON().value
          writes.push(data)
          if (invalidNext) {
            invalidNext = false
            return json({ error: { message: "请选择有效的图片" } }, 400)
          }
          if (failNext) {
            failNext = false
            return json({ error: { message: "模拟保存失败" } }, 500)
          }
          if (release === null)
            await new Promise((resolve) => {
              release = resolve
            })
          if (multipart) {
            assert(["replace", "reset"].includes(data.logo_action))
            version = data.logo_action === "reset" ? 0 : version + 1
          }
          Object.assign(branding, {
            workspace_name: data.workspace_name,
            product_name: data.product_name,
          })
          return json(record())
        }
        if (endpoint.startsWith("/api/")) {
          assert.equal(request.method(), "GET", endpoint)
          if (endpoint.endsWith("/session"))
            return json({
              authenticated,
              user: authenticated
                ? {
                    id: "admin",
                    name: "管理员",
                    role: "admin",
                    status: "active",
                  }
                : null,
            })
          if (endpoint === "/api/admin/v1/settings")
            return json({ settings: [record()] })
          if (endpoint.endsWith("/settings/proxies"))
            return json({ value: { proxies: [] } })
          if (endpoint.endsWith("/license/status"))
            return json({ state: "valid" })
          if (endpoint.endsWith("/license/machine-code"))
            return json({ machine_code: "test-machine" })
          return json({ items: [], groups: [], users: [], providers: [] })
        }
        const candidate = path.resolve(dist, `.${endpoint}`)
        const exists =
          candidate.startsWith(dist + path.sep) &&
          (await stat(candidate)
            .then((x) => x.isFile())
            .catch(() => false))
        const file = exists ? candidate : path.join(dist, "index.html")
        const types = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".webp": "image/webp",
          ".woff2": "font/woff2",
          ".json": "application/json",
        }
        return route.fulfill({
          contentType: types[path.extname(file)] || "application/octet-stream",
          body: await readFile(file),
        })
      })
      async function go(route) {
        await page.goto("http://logo.test" + route)
        await page.evaluate(
          (dark) => document.documentElement.classList.toggle("dark", dark),
          dark
        )
      }
      const preview = () => page.getByRole("img", { name: "Logo", exact: true })
      const card = () =>
        page
          .locator('[data-slot="card"]')
          .filter({ has: page.locator("#team-name") })
      const save = () =>
        card().getByRole("button", { name: "保存", exact: true }).click()
      async function saved() {
        await page.waitForFunction(
          () => !document.querySelector("#brand-logo-file").disabled
        )
        await card()
          .getByRole("button", { name: "保存", exact: true })
          .waitFor({ state: "hidden" })
      }
      async function sidebar(url, name) {
        if (width < 768)
          await page
            .getByRole("button", { name: "Toggle Sidebar", exact: true })
            .click()
        const header = page.locator('[data-slot="sidebar-header"]')
        await header.locator("img").waitFor()
        assert.equal(await header.locator("img").getAttribute("src"), url)
        if (name) await header.getByText(name, { exact: true }).waitFor()
        if (width < 768) {
          await page.keyboard.press("Escape")
          await header.waitFor({ state: "hidden" })
          await page.evaluate(() =>
            Promise.all(
              document.getAnimations().map((a) => a.finished.catch(() => {}))
            )
          )
        }
      }
      async function expectLogo(url) {
        await page.waitForFunction(
          (expected) =>
            document.querySelector('img[alt="Logo"]')?.getAttribute("src") ===
            expected,
          url || "/monkeyai-logo.webp"
        )
        assert.equal(
          await page.locator('link[rel="icon"]').getAttribute("href"),
          url || "/monkeyai-logo.webp"
        )
        assert.equal(
          await page
            .locator('link[rel="apple-touch-icon"]')
            .getAttribute("href"),
          url || "/monkeyai-logo.webp"
        )
        if (url) await sidebar(url)
      }
      const select = (isWebp = false) =>
        page.locator("#brand-logo-file").setInputFiles({
          name: isWebp ? "brand.webp" : "brand.png",
          mimeType: isWebp ? "image/webp" : "image/png",
          buffer: isWebp ? webp : image,
        })
      await go("/")
      await page.waitForFunction(() =>
        document.querySelector("footer")?.textContent.includes("测试产品")
      )
      await go("/login")
      await page
        .getByRole("heading", { name: "测试产品", exact: true })
        .waitFor()
      assert.equal(
        await page.locator("img").first().getAttribute("src"),
        "/monkeyai-logo.webp"
      )
      authenticated = true
      await go("/console/settings/other")
      await preview().waitFor()
      await expectLogo("")
      const trigger = page.locator("#brand-logo-upload")
      assert.equal((await trigger.innerText()).trim(), "")
      const bounds = await trigger.boundingBox()
      assert.equal(bounds.width, 80)
      assert.equal(bounds.height, 80)
      await trigger.hover()
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("#brand-logo-upload > span"))
            .opacity === "1"
      )
      assert.equal(await trigger.locator("svg").count(), 1)
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        trigger.click(),
      ])
      await chooser.setFiles({
        name: "bad.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("<svg/>"),
      })
      assert.equal(writes.length, 0, "Picking a file must not upload it")
      invalidNext = true
      await save()
      await page.getByText("请选择有效的图片", { exact: true }).last().waitFor()
      assert.equal(version, 0)
      await page.locator("#brand-logo-file").setInputFiles({
        name: "big.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(1024 * 1024 + 1),
      })
      await page
        .getByRole("alert")
        .filter({ hasText: "请选择 1 MiB" })
        .waitFor()
      assert.equal(writes.length, 1)
      await select(true)
      await page.waitForFunction(() =>
        document
          .querySelector('img[alt="Logo"]')
          ?.getAttribute("src")
          .startsWith("blob:")
      )
      assert.equal(writes.length, 1)
      assert.equal(
        await page.locator('link[rel="icon"]').getAttribute("href"),
        "/monkeyai-logo.webp"
      )
      await page.locator("#team-name").fill("更新团队")
      await page.locator("#tool-name").fill("更新产品")
      release = null
      await save()
      await page.waitForFunction(
        () => document.querySelector("#brand-logo-file").disabled
      )
      assert.equal(typeof release, "function")
      assert(await trigger.isDisabled())
      assert.equal(version, 0)
      release()
      await saved()
      assert.equal(version, 1)
      await expectLogo(logo())
      await sidebar(logo(), "更新产品")
      await page.locator("#tool-name").fill("最终产品")
      await save()
      await saved()
      assert.equal(version, 1)
      await expectLogo(logo())
      await select()
      assert.equal(version, 1)
      const count = writes.length
      await save()
      await saved()
      assert.equal(writes.length, count + 1)
      assert.equal(version, 2)
      await expectLogo(logo())
      await select(true)
      failNext = true
      await save()
      await page.getByText("模拟保存失败", { exact: true }).last().waitFor()
      assert.equal(version, 2)
      assert((await preview().getAttribute("src")).startsWith("blob:"))
      assert.equal(
        await page.locator('link[rel="icon"]').getAttribute("href"),
        logo()
      )
      await save()
      await saved()
      assert.equal(version, 3)
      await expectLogo(logo())
      assert.equal(
        await page
          .getByRole("button", { name: "恢复默认", exact: true })
          .count(),
        0
      )
      if (process.env.SCREENSHOT_DIR)
        await card().screenshot({
          path: path.join(
            process.env.SCREENSHOT_DIR,
            `brand-logo-${width}-${dark ? "dark" : "light"}.png`
          ),
        })
      assert.equal(await page.locator("#tool-name").inputValue(), "最终产品")
      // Leaving without saving discards the staged image and leaves the server alone.
      await select()
      const beforeLeave = writes.length
      await page.reload()
      await preview().waitFor()
      await expectLogo(logo())
      assert.equal(writes.length, beforeLeave)
      version = 0
      await page.reload()
      await preview().waitFor()
      await expectLogo("")
      version = 4
      broken = true
      const failedImage = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth/v1/branding/logo"
      )
      await page.reload()
      await failedImage
      await preview().waitFor()
      await expectLogo("")
      broken = false
      version = 5
      await go("/")
      await page.waitForFunction(
        (expected) =>
          document.querySelector("header img")?.getAttribute("src") ===
          expected,
        logo()
      )
      authenticated = false
      await go("/login")
      await page.waitForFunction(
        (expected) =>
          document.querySelector("img")?.getAttribute("src") === expected,
        logo()
      )
      legacy = true
      await page.reload()
      await page
        .getByRole("heading", { name: "最终产品", exact: true })
        .waitFor()
      assert.equal(
        await page.locator("img").first().getAttribute("src"),
        "/monkeyai-logo.webp"
      )
      unavailable = true
      await page.reload()
      await page
        .getByRole("heading", { name: "MonkeyAI", exact: true })
        .waitFor()
      assert.equal(
        await page.locator("img").first().getAttribute("src"),
        "/monkeyai-logo.webp"
      )
      assert.deepEqual(errors, [])
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false
      )
      console.log(
        `${width}px ${dark ? "dark" : "light"}: clickable logo/hover overlay, no reset button, local-only preview, unified Save, retry drafts, WebP, sidebar/favicon updates, defaults and legacy passed`
      )
      await page.close()
    }
} finally {
  await browser.close()
}
