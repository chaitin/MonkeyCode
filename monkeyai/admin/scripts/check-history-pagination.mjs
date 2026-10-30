import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const executablePath = process.env.CHROME_BIN
if (!executablePath) throw new Error("请设置 CHROME_BIN；先执行 pnpm build")
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
const id = "00000000-0000-4000-8000-000000000001"
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}

// Playwright's current role/visibility engine requires checkVisibility, absent
// in Chrome 86. Inspect the DOM and use hit-tested native mouse events instead.
async function click(page, { root = "#root", selector = "button", text }) {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  )
  const handle = await page.waitForFunction(
    ({ root, selector, text }) => {
      const parent = document.querySelector(root)
      if (!parent) return null
      const el = [...parent.querySelectorAll(selector)].find(
        (el) =>
          text === undefined ||
          el.getAttribute("aria-label") === text ||
          el.textContent.trim() === text
      )
      if (!el || el.disabled) return null
      el.scrollIntoView({ block: "center", inline: "nearest" })
      const rect = el.getBoundingClientRect(),
        x = rect.x + rect.width / 2,
        y = rect.y + rect.height / 2
      if (!el.contains(document.elementFromPoint(x, y))) return null
      return { x, y }
    },
    { root, selector, text }
  )
  const point = await handle.jsonValue()
  await handle.dispose()
  await page.mouse.click(point.x, point.y)
}

try {
  for (const kind of ["task", "conversation"]) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        locale: "zh-CN",
      })
      page.setDefaultTimeout(15000)
      await page.addInitScript(() =>
        localStorage.setItem("monkeyai-admin-language", "zh-CN")
      )
      const apiPath = `/api/admin/v1/statistics/${kind === "task" ? "history" : "conversations"}`
      const errors = [],
        requests = []
      page.on("pageerror", (error) => errors.push(error.message))
      let calibrated = false
      let mode = "data",
        release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const rows = Array.from({ length: 51 }, (_, i) =>
        kind === "task"
          ? {
              id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
              title: `任务 ${i + 1}`,
              user_id: id,
              user_name: "历史用户",
              user_email: "history@example.com",
              started_at: "2026-10-01T00:00:00Z",
              last_active_at: "2026-10-01T00:01:00Z",
              turn_count: i === 0 ? null : i,
            }
          : {
              session_id: id,
              turn_index: i + 1,
              task_title: "任务",
              user_id: id,
              user_name: "历史用户",
              user_email: "history@example.com",
              started_at: "2026-10-01T00:00:00Z",
              ended_at: "2026-10-01T00:00:01Z",
              duration_seconds: 1,
              input_text: `正文 ${i + 1}`,
              input_text_truncated: false,
              input_kind: "prompt",
              input_tokens: 0,
              output_tokens: null,
              outcome: "complete",
              error_code: null,
              is_completed: true,
            }
      )
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
                email: "admin@example.com",
                role: "admin",
                status: "active",
              },
            }
          else if (url.pathname.endsWith("/branding"))
            body = { product_name: "百智办公", workspace_name: "测试" }
          else if (url.pathname === apiPath) {
            requests.push(url.searchParams)
            await gate
            if (mode === "error")
              return route.fulfill({
                status: 503,
                json: { error: { message: "查询失败" } },
              })
            const page = Number(url.searchParams.get("page") || 1),
              size = Number(url.searchParams.get("page_size") || 50)
            const items =
              mode === "empty" || (mode === "vanished" && page > 1)
                ? []
                : rows.slice((page - 1) * size, page * size)
            body = {
              items: items.map((item) =>
                kind === "task" && calibrated && item.turn_count === null
                  ? { ...item, turn_count: 0 }
                  : item
              ),
              page,
              page_size: size,
              has_next: mode !== "empty" && page * size < rows.length,
            }
          }
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
      try {
        const table = `table[aria-label="${kind === "task" ? "任务历史" : "对话历史"}"]`
        const pagination = '[data-slot="table-pagination"]'
        const disabled = (name) =>
          page.evaluate(
            (name) =>
              document.querySelector(`button[aria-label="${name}"]`).disabled,
            name
          )
        const footer = () =>
          page.evaluate(
            (selector) => document.querySelector(selector).textContent,
            pagination
          )
        const ready = (count) =>
          page.waitForFunction(
            ({ table, count }) => {
              const el = document.querySelector(table)
              return (
                el?.getAttribute("aria-busy") === "false" &&
                el.querySelectorAll("tbody tr").length === count
              )
            },
            { table, count }
          )
        const responseFor = (predicate = () => true) =>
          page.waitForResponse((response) => {
            const url = new URL(response.url())
            return url.pathname === apiPath && predicate(url.searchParams)
          })
        const press = async (text, root) => {
          const response = responseFor()
          await click(page, { text, root })
          await response
        }
        await page.goto(
          `http://history.test/console/statistics/${kind}-history`
        )
        await page.waitForFunction(
          (selector) => document.querySelector(selector),
          table
        )
        assert.equal(
          await page.evaluate(
            (selector) =>
              document.querySelector(selector).getAttribute("aria-busy"),
            table
          ),
          "true"
        )
        release()
        await ready(50)
        assert.equal(requests[0].get("page_size"), "50")
        assert.match(await footer(), /显示 1–50 条/)
        assert.ok(!(await footer()).includes("共"))
        assert.equal(await disabled("上一页"), true)
        if (kind === "task") {
          assert.equal(
            await page.evaluate(
              (selector) =>
                document.querySelector(selector).querySelector("tbody tr")
                  .children[3].textContent,
              table
            ),
            "—"
          )
          calibrated = true
          await page.waitForFunction(
            (selector) =>
              document.querySelector(selector)?.querySelector("tbody tr")
                ?.children[3]?.textContent === "0",
            table
          )
          const afterCalibration = requests.length
          assert.ok(afterCalibration >= 2, "uncalibrated counts must refresh")
          await page.waitForTimeout(5_200)
          assert.equal(
            requests.length,
            afterCalibration,
            "calibrated counts must stop polling"
          )
        }
        await press("下一页")
        await ready(1)
        assert.equal(requests.at(-1).get("page"), "2")
        assert.equal(await disabled("下一页"), true)
        assert.equal(await disabled("上一页"), false)
        assert.match(await footer(), /显示 51–51 条/)
        await press("上一页")
        await ready(50)
        mode = "vanished"
        const recovered = responseFor((query) => query.get("page") === "1")
        await press("下一页")
        await recovered
        await ready(50)
        assert.equal(requests.at(-1).get("page"), "1")
        mode = "empty"
        await press("搜索")
        await ready(1)
        assert.equal(
          await page.evaluate(
            (selector) =>
              document.querySelector(selector).querySelectorAll("tbody td")
                .length,
            table
          ),
          1
        )
        assert.equal(await disabled("下一页"), true)
        mode = "error"
        await press("搜索")
        const retryRoot = kind === "task" ? "#root" : table
        await page.waitForFunction(
          (root) =>
            [...document.querySelector(root).querySelectorAll("button")].some(
              (el) => el.textContent.trim() === "重试"
            ),
          retryRoot
        )
        assert.equal(await disabled("下一页"), true)
        mode = "data"
        await press("重试", retryRoot)
        await ready(50)
        await click(page, { root: pagination, selector: '[role="combobox"]' })
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[role="option"]')].some(
            (el) => el.textContent.trim() === "20 条 / 页"
          )
        )
        const resized = responseFor((query) => query.get("page_size") === "20")
        await click(page, {
          root: "body",
          selector: '[role="option"]',
          text: "20 条 / 页",
        })
        await resized
        await ready(20)
        assert.equal(requests.at(-1).get("page_size"), "20")
        assert.equal(requests.at(-1).get("page"), "1")
        await press("下一页")
        await ready(20)
        assert.equal(requests.at(-1).get("page"), "2")
        await press("搜索")
        await ready(20)
        assert.equal(requests.at(-1).get("page"), "1")
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        assert.deepEqual(errors, [])
        console.log(
          `${kind} ${width}: no-total pagination, calibration placeholder, end/empty/error/retry, size/search reset and deleted-page recovery passed`
        )
      } finally {
        await page.close()
      }
    }
  }
} finally {
  await browser.close()
}
