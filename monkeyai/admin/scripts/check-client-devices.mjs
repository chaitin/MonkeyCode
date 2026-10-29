import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { zhCN } from "../src/i18n/locales/zh-CN.ts"
import { ar } from "../src/i18n/locales/ar.ts"

const executablePath = process.env.CHROME_BIN
if (!executablePath) throw new Error("请设置 CHROME_BIN；先执行 pnpm build")
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
const id = "00000000-0000-4000-8000-000000000001"
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}
const gate = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}
// Avoid current Playwright visibility helpers, which need checkVisibility in Chrome 86.
async function click(page, selector, text) {
  await page.evaluate(() => document.fonts.ready)
  const handle = await page.waitForFunction(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find(
        (el) =>
          text === undefined ||
          el.textContent.trim() === text ||
          el.getAttribute("aria-label") === text
      )
      if (!el || el.disabled || el.getAttribute("aria-disabled") === "true")
        return null
      el.scrollIntoView({ block: "center", inline: "nearest" })
      const r = el.getBoundingClientRect(),
        x = r.x + r.width / 2,
        y = r.y + r.height / 2
      return el.contains(document.elementFromPoint(x, y)) ? { x, y } : null
    },
    { selector, text }
  )
  const point = await handle.jsonValue()
  await handle.dispose()
  await page.mouse.click(point.x, point.y)
}
try {
  for (const [locale, tr] of [
    ["zh-CN", zhCN],
    ["ar", ar],
  ])
    for (const width of [1440, 390]) {
      const labels = tr.pages.clientDevices
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale,
        timezoneId: "Asia/Shanghai",
      })
      page.setDefaultTimeout(15000)
      await page.clock.setFixedTime(new Date("2026-10-29T10:20:30+08:00"))
      await page.addInitScript((locale) => {
        localStorage.setItem("monkeyai-admin-language", locale)
        localStorage.setItem("theme", locale === "ar" ? "dark" : "light")
      }, locale)
      const errors = [],
        lists = [],
        overviews = [],
        legacy = []
      page.on("pageerror", (error) => errors.push(error.message))
      const firstList = gate(),
        firstOverview = gate()
      let listWait = firstList.promise,
        overviewWait = firstOverview.promise,
        listMode = "data",
        overviewMode = "data",
        vanished = false
      const rows = Array.from({ length: 51 }, (_, i) => ({
        id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        user_id: id,
        machine_id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        user_name: i === 0 ? "旧设备用户" : `成员 ${i}`,
        user_email: `person-${i}@example.test`,
        user_avatar_url: null,
        user_deleted: i === 2,
        device_name: `设备 ${i}`,
        alias: i === 0 ? "办公室电脑" : null,
        platform: i % 2 ? "linux" : "windows",
        os_version: i % 2 ? "Ubuntu 24.04" : "11 24H2",
        arch: "arm64",
        client_type: "desktop",
        client_name: "MonkeyAI Desktop",
        client_version: "1.2.0",
        runtime_version: "22.1.0",
        engine_version: "1.9.0",
        locale: "zh-CN",
        system_locale: "en-US",
        timezone: "Asia/Shanghai",
        status: i === 2 ? "revoked" : "active",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
        last_seen_at: "2025-01-02T00:00:00Z",
        last_reported_at: null,
        last_active_at: "2025-01-02T00:00:00Z",
      }))
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith("/api/")) {
          let body = {}
          if (url.pathname.endsWith("/session"))
            body = {
              authenticated: true,
              user: {
                id,
                name: "管理员",
                email: "admin@example.test",
                role: "admin",
                status: "active",
              },
            }
          else if (url.pathname.endsWith("/branding"))
            body = { product_name: "百智办公" }
          else if (url.pathname === "/api/admin/v1/endpoints/overview") {
            overviews.push(url.searchParams)
            await overviewWait
            if (overviewMode === "error")
              return route.fulfill({
                status: 503,
                json: { error: { message: "设备概览失败" } },
              })
            const total = overviewMode === "empty" ? 0 : 51
            body = {
              metric: "devices",
              total,
              users: total ? 3 : 0,
              distributions: {
                client_type: total ? [{ value: "desktop", count: 51 }] : [],
                platform: total
                  ? [
                      { value: "windows", count: 26 },
                      { value: "linux", count: 25 },
                    ]
                  : [],
                client_version: total ? [{ value: "1.2.0", count: 51 }] : [],
              },
            }
          } else if (url.pathname === "/api/admin/v1/endpoints") {
            lists.push(url.searchParams)
            await listWait
            if (listMode === "error")
              return route.fulfill({
                status: 503,
                json: { error: { message: "设备列表失败" } },
              })
            const active = Number(url.searchParams.get("page") || 1),
              size = Number(url.searchParams.get("page_size") || 50)
            body = {
              items:
                listMode === "empty" || (vanished && active > 1)
                  ? []
                  : rows.slice((active - 1) * size, active * size),
              page: active,
              page_size: size,
              has_next: listMode !== "empty" && active * size < rows.length,
            }
          } else if (url.pathname.includes("session-reporting/clients"))
            legacy.push(url.pathname)
          return route.fulfill({ json: body })
        }
        let file = path.join(dist, decodeURIComponent(url.pathname))
        if (!file.startsWith(dist))
          return route.fulfill({ status: 404, body: "missing" })
        if (!(await stat(file).catch(() => null))?.isFile())
          file = path.join(dist, "index.html")
        return route.fulfill({
          contentType: mime[path.extname(file)] || "application/octet-stream",
          body: await readFile(file),
        })
      })
      const ready = () =>
        page.waitForFunction(
          () =>
            document.querySelector('button[type="submit"]')?.disabled === false
        )
      const submit = async () => {
        const count = lists.length
        await ready()
        await click(page, 'button[type="submit"]')
        await ready()
        assert.equal(lists.length, count + 1)
      }
      const assertSharedFilters = () => {
        for (const key of ["query", "platform", "client_type", "from", "until"])
          assert.equal(lists.at(-1).get(key), overviews.at(-1).get(key), key)
      }
      try {
        await page.goto(
          "http://monkeyai.test/console/statistics/session-reporting/clients"
        )
        await page.waitForFunction(
          () =>
            document.querySelectorAll('[role="figure"] [role="status"]')
              .length === 3
        )
        assert.equal(
          await page.locator('button[type="submit"]').isDisabled(),
          true
        )
        firstList.release()
        listWait = Promise.resolve()
        await page.waitForFunction(
          () => document.querySelectorAll("tbody tr").length === 50
        )
        assert.equal(
          await page.locator('button[type="submit"]').isDisabled(),
          true,
          "search waits for the overview as well"
        )
        firstOverview.release()
        overviewWait = Promise.resolve()
        await ready()
        for (const query of [...lists, ...overviews]) {
          assert.equal(query.has("from"), false)
          assert.equal(query.has("until"), false)
        }
        assert.deepEqual(
          legacy,
          [],
          "inventory must not depend on session reports"
        )
        const heads = await page.locator("thead th").allTextContents()
        assert.deepEqual(
          heads,
          ["user", "device_name", "platform", "last_active_at"].map(
            (field) => labels.fields[field]
          )
        )
        assert.equal(
          (await page.locator("section").textContent()).includes(
            labels.description
          ),
          false
        )
        await click(page, "button", labels.selectColumns)
        await page.waitForFunction(
          () =>
            document.querySelectorAll('[role="menuitemcheckbox"]').length === 17
        )
        assert.equal(
          await page.locator('[role="menuitemcheckbox"]').count(),
          17
        )
        for (const field of [
          "os_version",
          "client_type",
          "client_name",
          "client_version",
          "arch",
          "locale",
          "runtime_version",
          "engine_version",
          "created_at",
        ]) {
          await click(page, '[role="menuitemcheckbox"]', labels.fields[field])
        }
        await page.keyboard.press("Escape")
        const expandedHeads = await page.locator("thead th").allTextContents()
        for (const field of [
          "os_version",
          "client_type",
          "client_name",
          "client_version",
          "arch",
          "locale",
          "runtime_version",
          "engine_version",
          "created_at",
        ])
          assert(expandedHeads.includes(labels.fields[field]), field)
        const first = await page.locator("tbody tr").first().textContent()
        for (const value of [
          "旧设备用户",
          "办公室电脑",
          "Windows",
          "11 24H2",
          "arm64",
          "MonkeyAI Desktop",
          "1.2.0",
          "22.1.0",
          "1.9.0",
          "2025",
        ])
          assert(first.includes(value), value)
        const beforePaging = overviews.length
        await click(
          page,
          '[data-slot="table-pagination"] button',
          tr.pages.operationLogs.pagination.next
        )
        await ready()
        assert.equal(lists.at(-1).get("page"), "2")
        assert.equal(overviews.length, beforePaging)
        await click(
          page,
          '[data-slot="table-pagination"] button',
          tr.pages.operationLogs.pagination.previous
        )
        await ready()
        assert.equal(lists.at(-1).get("page"), "1")
        const sizeTrigger = '[data-slot="table-pagination"] [role="combobox"]'
        await click(page, sizeTrigger)
        await click(
          page,
          '[role="option"]',
          tr.pages.operationLogs.pagination.perPage.replace("{{count}}", "20")
        )
        await ready()
        assert.equal(lists.at(-1).get("page_size"), "20")
        assert.equal(overviews.length, beforePaging)
        const prior = lists.length
        await click(page, "#client-device-query")
        await page.keyboard.insertText("旧设备用户")
        assert.equal(lists.length, prior)
        const slowList = gate(),
          slowOverview = gate()
        listWait = slowList.promise
        overviewWait = slowOverview.promise
        await click(page, 'button[type="submit"]')
        await page.waitForFunction(
          () => document.querySelector('button[type="submit"]').disabled
        )
        slowList.release()
        listWait = Promise.resolve()
        await page.waitForFunction(
          () =>
            document.querySelector("table").getAttribute("aria-busy") ===
            "false"
        )
        assert.equal(
          await page.locator('button[type="submit"]').isDisabled(),
          true
        )
        slowOverview.release()
        overviewWait = Promise.resolve()
        await ready()
        assertSharedFilters()
        assert.equal(lists.at(-1).get("query"), "旧设备用户")
        assert.equal(lists.at(-1).get("page"), "1")
        await click(page, "button", tr.common.more)
        await click(
          page,
          '[role="menuitemcheckbox"]',
          labels.fields.last_active_at
        )
        await page.keyboard.press("Escape")
        assert.equal(
          await page.locator("#client-analysis-from").textContent(),
          labels.activeFrom
        )
        assert.equal(
          await page.locator("#client-analysis-until").textContent(),
          labels.activeUntil
        )
        await click(page, "#client-analysis-from")
        const day = await page.evaluate(
          (locale) =>
            new Date("2026-10-26T00:00:00+08:00").toLocaleDateString(locale),
          locale
        )
        await click(page, `[data-slot="calendar"] button[data-day="${day}"]`)
        await submit()
        assert.equal(lists.at(-1).get("from"), "2026-10-25T16:00:00.000Z")
        assertSharedFilters()
        await click(page, "#client-analysis-from")
        await click(page, `[data-slot="calendar"] button[data-day="${day}"]`)
        await page.keyboard.press("Escape")
        await submit()
        assert.equal(lists.at(-1).has("from"), false)
        assert.equal(lists.at(-1).has("until"), false)
        overviewMode = "error"
        await submit()
        await page.waitForFunction(
          () =>
            document.querySelectorAll('[role="figure"] [role="alert"]')
              .length === 3
        )
        const beforeRetry = lists.length
        overviewMode = "data"
        await click(page, '[role="figure"] button')
        await ready()
        assert.equal(lists.length, beforeRetry)
        listMode = "error"
        await submit()
        await page.waitForFunction(() =>
          document
            .querySelector('div[role="alert"]')
            ?.textContent.includes("设备列表失败")
        )
        const oldOverview = overviews.length
        listMode = "data"
        await click(page, 'div[role="alert"] button')
        await ready()
        assert.equal(overviews.length, oldOverview)
        listMode = "empty"
        overviewMode = "empty"
        await submit()
        assert.equal(
          await page.locator('[role="figure"] [data-slot="chart"]').count(),
          0
        )
        assert.equal(await page.locator("tbody tr").count(), 1)
        listMode = "data"
        overviewMode = "data"
        await submit()
        vanished = true
        await click(
          page,
          '[data-slot="table-pagination"] button',
          tr.pages.operationLogs.pagination.next
        )
        await ready()
        await page.waitForFunction(() =>
          document
            .querySelector('[data-slot="table-pagination"]')
            .textContent.includes("1")
        )
        assert.equal(
          lists.at(-1).get("page"),
          "1",
          "empty later page must recover"
        )
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          ),
          false
        )
        assert.deepEqual(errors, [])
        // Capture the default view after the interaction checks, without transient toasts.
        await page.reload()
        await ready()
        assert.equal(await page.locator("#client-analysis-from").count(), 0)
        const rowHeights = await page.evaluate(() =>
          [...document.querySelectorAll("thead tr, tbody tr")]
            .slice(0, 3)
            .map((row) => row.getBoundingClientRect().height)
        )
        assert(
          rowHeights.every((height) => Math.abs(height - 48) <= 1),
          `table density: ${rowHeights}`
        )
        await page.waitForFunction(() => {
          const cell = document.querySelector("tbody td")
          cell.scrollIntoView({ block: "center", inline: "nearest" })
          const r = cell.getBoundingClientRect()
          return cell.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          )
        })
        // Chrome 86 does not reliably paint beyond the viewport in full-page captures.
        const height = await page.evaluate(() =>
          Math.max(1000, Math.min(3000, document.documentElement.scrollHeight))
        )
        await page.setViewportSize({ width, height })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({
          path: `/tmp/monkeyai-client-devices-${locale}-${width}-${path.basename(executablePath)}.png`,
          fullPage: true,
        })
        console.log(
          `PASS client device inventory ${locale} ${width}: endpoint data, all-time defaults, split OS fields, metadata, pagination, filters, dates, independent retry, empty recovery`
        )
      } catch (error) {
        await page.screenshot({
          path: "/tmp/monkeyai-client-devices-failed.png",
          fullPage: true,
        })
        console.error(await page.locator("body").textContent())
        throw error
      } finally {
        firstList.release()
        firstOverview.release()
        await page.close()
      }
    }
} finally {
  await browser.close()
}
