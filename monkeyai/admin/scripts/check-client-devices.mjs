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
      for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
        if (
          ancestor
            .getAnimations?.()
            .some(
              (animation) =>
                animation.playState === "running" &&
                Number.isFinite(
                  animation.effect?.getComputedTiming().iterations
                )
            )
        )
          return null
      }
      el.scrollIntoView({ block: "center", inline: "nearest" })
      const r = el.getBoundingClientRect()
      // Wait for popup motion to settle before issuing a native pointer click.
      const previous = window.__monkeyaiDeviceClickRect
      window.__monkeyaiDeviceClickRect = {
        el,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }
      if (
        !previous ||
        previous.el !== el ||
        ["x", "y", "width", "height"].some(
          (key) => Math.abs(previous[key] - r[key]) > 0.5
        )
      )
        return null
      const x = r.x + r.width / 2,
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
      if (
        process.env.SCENARIO_FILTER &&
        !`${locale}:${width}`.includes(process.env.SCENARIO_FILTER)
      )
        continue
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
        user_id: i === 50 ? "00000000-0000-4000-8000-000000000002" : id,
        machine_id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        user_name:
          i === 0
            ? "旧设备用户"
            : i === 1
              ? "很长的用户姓名".repeat(20)
              : `成员 ${i}`,
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
          else if (url.pathname === `/api/admin/v1/users/${id}`)
            body = {
              id,
              name: rows[0].user_name,
              email: rows[0].user_email,
              role: "user",
              status: "active",
              joined_at: "2025-01-01T00:00:00Z",
            }
          else if (url.pathname === `/api/admin/v1/billing/accounts/${id}`)
            body = {
              account: {
                id,
                user_id: id,
                version: "1",
                balance: "100",
                frozen: "0",
                available: "100",
                quota: "100",
                period_start_at: "2026-10-01T00:00:00Z",
                period_end_at: "2026-11-01T00:00:00Z",
              },
              user_name: rows[0].user_name,
              user_email: rows[0].user_email,
              wallet: { configured: false },
              external_user_id: "",
            }
          else if (url.pathname === "/api/admin/v1/endpoints/overview") {
            overviews.push(url.searchParams)
            await overviewWait
            if (overviewMode === "error")
              return route.fulfill({
                status: 503,
                json: { error: { message: "设备概览失败" } },
              })
            const matched = rows.filter(
              (row) =>
                !url.searchParams.get("user_id") ||
                row.user_id === url.searchParams.get("user_id")
            )
            const total = overviewMode === "empty" ? 0 : matched.length
            body = {
              metric: "devices",
              total,
              users: total ? (url.searchParams.has("user_id") ? 1 : 3) : 0,
              distributions: {
                client_type: total ? [{ value: "desktop", count: total }] : [],
                platform: total
                  ? [
                      {
                        value: "windows",
                        count: matched.filter(
                          (row) => row.platform === "windows"
                        ).length,
                      },
                      {
                        value: "linux",
                        count: matched.filter((row) => row.platform === "linux")
                          .length,
                      },
                    ]
                  : [],
                client_version: total ? [{ value: "1.2.0", count: total }] : [],
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
            const matched = rows.filter(
              (row) =>
                !url.searchParams.get("user_id") ||
                row.user_id === url.searchParams.get("user_id")
            )
            body = {
              items:
                listMode === "empty" || (vanished && active > 1)
                  ? []
                  : matched.slice((active - 1) * size, active * size),
              page: active,
              page_size: size,
              has_next: listMode !== "empty" && active * size < matched.length,
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
        const list = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/admin/v1/endpoints"
        )
        const overview = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
            "/api/admin/v1/endpoints/overview"
        )
        await Promise.all([
          list,
          overview,
          click(page, 'button[type="submit"]'),
        ])
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
        const userPresentation = await page.evaluate(() => {
          const button = document.querySelector(
            "tbody tr:first-child td:first-child button"
          )
          const avatar = button
            .querySelector('[data-slot="avatar"]')
            .getBoundingClientRect()
          const longName = document.querySelector(
            "tbody tr:nth-child(2) td:first-child button .truncate"
          )
          return {
            text: button.textContent.trim(),
            title: button.title,
            height: button.getBoundingClientRect().height,
            avatar: [avatar.width, avatar.height],
            truncated: longName.scrollWidth > longName.clientWidth,
            deletedDisabled: document.querySelector(
              "tbody tr:nth-child(3) td:first-child button"
            ).disabled,
          }
        })
        assert.equal(userPresentation.text, rows[0].user_name)
        assert.equal(userPresentation.title, rows[0].user_email)
        assert.deepEqual(userPresentation.avatar, [24, 24])
        assert.equal(userPresentation.height, 24)
        assert.equal(userPresentation.truncated, true)
        assert.equal(userPresentation.deletedDisabled, true)
        await click(page, "tbody tr:first-child td:first-child button")
        await page.waitForFunction(() =>
          document.querySelector(
            '[role="dialog"] [data-slot="account-dialog-actions"]'
          )
        )
        assert.equal(
          await page
            .locator(
              '[role="dialog"] [data-slot="dialog-header"] [data-slot="dialog-description"]'
            )
            .count(),
          0
        )
        const clientLink = page
          .locator('[role="dialog"] a')
          .filter({ hasText: /^客户端$/ })
        assert.equal(
          await clientLink.getAttribute("href"),
          `/console/statistics/session-reporting/clients?user_id=${id}`
        )
        const filteredList = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            url.searchParams.get("user_id") === id
          )
        })
        const filteredOverview = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints/overview" &&
            url.searchParams.get("user_id") === id
          )
        })
        await Promise.all([
          filteredList,
          filteredOverview,
          click(page, '[role="dialog"] a', "客户端"),
        ])
        await ready()
        await page.waitForFunction(
          () => !document.querySelector('[role="dialog"]')
        )
        assert.equal(new URL(page.url()).searchParams.get("user_id"), id)
        assert.equal(
          await page.locator("#client-device-user-id").inputValue(),
          id
        )
        assert.equal(
          lists.at(-1).get("query"),
          null,
          "user ID must use an exact filter"
        )
        assert.equal(
          await page
            .locator(
              '[data-slot="table-pagination"] button[aria-label="' +
                tr.pages.operationLogs.pagination.next +
                '"]'
            )
            .isDisabled(),
          true
        )
        const restoredUser = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            url.searchParams.get("user_id") === id
          )
        })
        await page.reload()
        await restoredUser
        await ready()
        assert.equal(
          await page.locator("#client-device-user-id").inputValue(),
          id
        )
        await click(page, "#client-device-user-id")
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        assert.equal(
          new URL(page.url()).searchParams.get("user_id"),
          id,
          "clearing stays a draft until Search"
        )
        const clearedUser = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            !url.searchParams.has("user_id")
          )
        })
        const clearedUserOverview = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints/overview" &&
            !url.searchParams.has("user_id")
          )
        })
        await Promise.all([
          clearedUser,
          clearedUserOverview,
          click(
            page,
            'button[type="submit"]',
            tr.pages.operationLogs.filters.search
          ),
        ])
        await ready()
        assert.equal(new URL(page.url()).searchParams.has("user_id"), false)
        assert.equal(overviews.at(-1).has("user_id"), false)
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
        const nextPageResponse = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            url.searchParams.get("page") === "2"
          )
        })
        await click(
          page,
          '[data-slot="table-pagination"] button',
          tr.pages.operationLogs.pagination.next
        )
        await nextPageResponse
        await ready()
        assert.equal(lists.at(-1).get("page"), "2")
        assert.equal(new URL(page.url()).searchParams.get("page"), "2")
        assert.equal(overviews.length, beforePaging)
        const previousPageResponse = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            url.searchParams.get("page") === "1"
          )
        })
        await click(
          page,
          '[data-slot="table-pagination"] button',
          tr.pages.operationLogs.pagination.previous
        )
        await previousPageResponse
        await ready()
        assert.equal(lists.at(-1).get("page"), "1")
        const sizeTrigger = '[data-slot="table-pagination"] [role="combobox"]'
        await click(page, sizeTrigger)
        const resizedResponse = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            url.searchParams.get("page_size") === "20"
          )
        })
        await click(
          page,
          '[role="option"]',
          tr.pages.operationLogs.pagination.perPage.replace("{{count}}", "20")
        )
        await resizedResponse
        await ready()
        assert.equal(lists.at(-1).get("page_size"), "20")
        assert.equal(new URL(page.url()).searchParams.get("page_size"), "20")
        assert.equal(overviews.length, beforePaging)
        const prior = lists.length
        await click(page, "#client-device-query")
        await page.keyboard.insertText("旧设备用户")
        assert.equal(lists.length, prior)
        assert.equal(new URL(page.url()).searchParams.has("query"), false)
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
        assert.equal(
          new URL(page.url()).searchParams.get("query"),
          "旧设备用户"
        )
        await page.reload()
        await ready()
        assert.equal(
          await page.locator("#client-device-query").inputValue(),
          "旧设备用户"
        )
        assert.equal(lists.at(-1).get("query"), "旧设备用户")
        assert.equal(lists.at(-1).get("page_size"), "20")
        await click(page, "#client-device-query")
        await page.keyboard.press("Control+a")
        await page.keyboard.insertText("另一位用户")
        await submit()
        const back = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            url.searchParams.get("query") === "旧设备用户"
          )
        })
        await page.goBack()
        await back
        await ready()
        assert.equal(
          await page.locator("#client-device-query").inputValue(),
          "旧设备用户"
        )
        const forward = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            url.searchParams.get("query") === "另一位用户"
          )
        })
        await page.goForward()
        await forward
        await ready()
        assert.equal(
          await page.locator("#client-device-query").inputValue(),
          "另一位用户"
        )
        await click(page, "#client-device-query")
        await page.keyboard.press("Control+a")
        await page.keyboard.insertText("旧设备用户")
        await submit()
        const beforeBookmark = page.url(),
          bookmark = new URL(beforeBookmark)
        const restoredFilters = {
          platform: "Windows",
          client_type: "desktop",
          arch: "arm64",
          client_version: "1.2.0",
          status: "revoked",
          from: "2026-10-01T00:00:00.000Z",
          until: "2026-11-01T00:00:00.000Z",
        }
        for (const [key, value] of Object.entries(restoredFilters))
          bookmark.searchParams.set(key, value)
        await page.goto(bookmark.toString())
        await ready()
        for (const [key, value] of Object.entries(restoredFilters))
          assert.equal(lists.at(-1).get(key), value)
        assertSharedFilters()
        for (const field of ["platform", "arch", "client_version"])
          assert.equal(
            await page
              .locator(`input[aria-label="${labels.fields[field]}"]`)
              .inputValue(),
            restoredFilters[field]
          )
        assert.notEqual(
          await page.locator("#client-analysis-from").textContent(),
          labels.activeFrom
        )
        assert.notEqual(
          await page.locator("#client-analysis-until").textContent(),
          labels.activeUntil
        )
        assert(
          (await page.locator("section").textContent()).includes(
            labels.statuses.revoked
          )
        )
        await page.goto(beforeBookmark)
        await ready()
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
        assert.equal(new URL(page.url()).searchParams.has("from"), false)
        assert.equal(new URL(page.url()).searchParams.has("until"), false)
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
        const recoveredPage = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            url.pathname === "/api/admin/v1/endpoints" &&
            url.searchParams.get("page") === "1"
          )
        })
        // Exercise keyboard paging for the empty-page recovery.
        await page
          .locator(
            `[data-slot="table-pagination"] button[aria-label="${tr.pages.operationLogs.pagination.next}"]`
          )
          .focus()
        await Promise.all([recoveredPage, page.keyboard.press("Enter")])
        await ready()
        await page.waitForURL((url) => !url.searchParams.has("page"))
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
        await page.waitForFunction(
          () => document.querySelectorAll("tbody tr").length === 20
        )
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
          `PASS client device inventory ${locale} ${width}: endpoint data, all-time defaults, split OS fields, metadata, pagination, URL filters, account client link, exact user ID, reload, history, dates, independent retry, empty recovery`
        )
      } catch (error) {
        await page.screenshot({
          path: "/tmp/monkeyai-client-devices-failed.png",
          fullPage: true,
        })
        console.error(await page.locator("body").textContent())
        console.error(
          "URL",
          page.url(),
          "recent lists",
          lists.slice(-5).map((params) => params.toString())
        )
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
