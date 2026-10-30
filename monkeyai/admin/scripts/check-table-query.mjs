import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { zhCN } from "../src/i18n/locales/zh-CN.ts"

const executablePath = process.env.CHROME_BIN
if (!executablePath) throw new Error("请设置 CHROME_BIN；先执行 pnpm build")
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
const id = "00000000-0000-4000-8000-000000000001"
const taskID = "00000000-0000-4000-8000-000000000002"
const from = "2026-10-01T00:00:00.000Z",
  until = "2026-10-03T00:00:00.000Z"
const configurations = [
  {
    name: "audit",
    route: "/console/settings/operation-logs",
    api: "/api/admin/v1/audits",
    filters: {
      actor_user_id: id,
      ip: "127.0.0.1",
      category: "security",
      result: "success",
      since: from,
      until: "2026-10-02T23:59:59.999Z",
    },
    textKey: "ip",
    input: `input[aria-label="${zhCN.pages.operationLogs.filters.ipSearchPlaceholder}"]`,
    dates: ["audit-start-date", "audit-end-date"],
    dateKeys: ["since", "until"],
  },
  {
    name: "feedback",
    route: "/console/settings/feedback",
    api: "/api/admin/v1/feedback",
    filters: { category: "bug", state: "new" },
  },
  {
    name: "billing",
    route: "/console/billing/details",
    api: "/api/admin/v1/billing/entries",
    filters: {
      view: "entries",
      user_id: id,
      content: "计费 + &",
      category: "model",
      entry_type: "charge",
      from: "2026-10-01",
      until: "2026-10-29",
    },
    textKey: "content",
    input: "#billing-content",
    dates: ["billing-from", "billing-until"],
    dateKeys: ["from", "until"],
  },
  {
    name: "conversation",
    route: "/console/statistics/conversation-history",
    api: "/api/admin/v1/statistics/conversations",
    filters: {
      task: "任务 + &",
      task_id: taskID,
      user_id: id,
      content: "正文 + &",
      from,
      until,
    },
    textKey: "content",
    input: 'input[aria-label="对话内容"]',
    dates: ["conversation-history-from", "conversation-history-until"],
    dateKeys: ["from", "until"],
  },
  {
    name: "task",
    route: "/console/statistics/task-history",
    api: "/api/admin/v1/statistics/history",
    filters: { task: "任务 + &", user_id: id, from, until },
    textKey: "task",
    input: "#task-history-task-name",
    dates: ["task-history-start-time", "task-history-end-time"],
    dateKeys: ["from", "until"],
  },
]
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}
async function click(page, selector, text) {
  await page.evaluate(() => document.fonts.ready)
  const handle = await page.waitForFunction(
    ({ selector, text }) => {
      for (const el of document.querySelectorAll(selector)) {
        if (
          text !== undefined &&
          el.textContent.trim() !== text &&
          el.getAttribute("aria-label") !== text
        )
          continue
        if (el.disabled || el.getAttribute("aria-disabled") === "true") continue
        if (
          !el.getBoundingClientRect().width ||
          !el.getBoundingClientRect().height
        )
          continue
        el.scrollIntoView({ block: "center", inline: "nearest" })
        const r = el.getBoundingClientRect(),
          x = r.x + r.width / 2,
          y = r.y + r.height / 2
        if (el.contains(document.elementFromPoint(x, y))) return { x, y }
      }
      return null
    },
    { selector, text }
  )
  const point = await handle.jsonValue()
  await handle.dispose()
  await page.mouse.click(point.x, point.y)
}
async function type(page, selector, value) {
  await click(page, selector)
  await page.keyboard.press("Control+a")
  if (value) await page.keyboard.insertText(value)
  else await page.keyboard.press("Backspace")
}

try {
  for (const config of configurations)
    for (const width of [1440, 390]) {
      if (
        process.env.SCENARIO_FILTER &&
        !`${config.name}:${width}`.includes(process.env.SCENARIO_FILTER)
      )
        continue
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
      })
      page.setDefaultTimeout(15000)
      await page.clock.setFixedTime(new Date("2026-10-29T10:20:30+08:00"))
      await page.addInitScript(() =>
        localStorage.setItem("monkeyai-admin-language", "zh-CN")
      )
      const errors = [],
        requests = []
      page.on("pageerror", (error) => errors.push(error.message))
      const rows = Array.from({ length: 65 }, (_, i) => {
        const common = {
          id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
          user_id: id,
          user_name: "张三",
          user_email: "person@example.test",
          user_avatar_url: null,
        }
        if (config.name === "audit")
          return {
            ...common,
            occurred_at: from,
            actor_user_id: id,
            actor_name: "张三",
            actor_email: "person@example.test",
            actor_avatar_url: null,
            action: "login",
            category: "security",
            target_type: "user",
            target_id: id,
            request_params: {},
            source_ip: "127.0.0.1",
            user_agent: "test",
            request_id: "request",
            result: "success",
            error_message: null,
          }
        if (config.name === "feedback")
          return {
            ...common,
            category: "bug",
            content: `反馈 ${i}`,
            rating: 5,
            state: "new",
            platform: "windows",
            client_version: "1.0",
            created_at: from,
            updated_at: from,
            attachments: [],
          }
        if (config.name === "billing")
          return {
            ...common,
            occurred_at: from,
            entry_type: "charge",
            category: "model",
            item_name: "模型扣费",
            credit_delta: "-1",
            balance_after: "99",
            mode: "local",
            transaction_id: null,
          }
        if (config.name === "task")
          return {
            ...common,
            title: `任务 ${i}`,
            started_at: from,
            last_active_at: until,
            turn_count: 1,
          }
        return {
          ...common,
          session_id: taskID,
          turn_index: i + 1,
          task_title: `任务 ${i}`,
          started_at: from,
          ended_at: until,
          duration_seconds: 1,
          input_text: `正文 ${i}`,
          input_text_truncated: false,
          input_kind: "prompt",
          input_tokens: 1,
          output_tokens: 2,
          outcome: "complete",
          error_code: null,
          is_completed: true,
        }
      })
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
          else if (url.pathname === "/api/admin/v1/billing/users")
            body = {
              items: [
                {
                  id,
                  name: "张三",
                  email: "person@example.test",
                  avatar_url: null,
                  deleted: false,
                },
              ],
              has_next: false,
            }
          else if (url.pathname === config.api) {
            requests.push(url.searchParams)
            const active = Number(url.searchParams.get("page") || 1),
              size = Number(url.searchParams.get("page_size") || 50)
            body = {
              items: rows.slice((active - 1) * size, active * size),
              total: rows.length,
              has_next: active * size < rows.length,
              page: active,
              page_size: size,
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
      const response = (predicate = () => true) =>
        page.waitForResponse((res) => {
          const url = new URL(res.url())
          return url.pathname === config.api && predicate(url.searchParams)
        })
      const ready = () =>
        page.waitForFunction(
          () =>
            document.querySelector("table")?.getAttribute("aria-busy") ===
              "false" && document.querySelectorAll("tbody tr").length > 0
        )
      const search = async (key, value) => {
        const pending = response(
          (q) => (q.get(key) || "") === value && q.get("page") === "1"
        )
        await click(page, "button", "搜索")
        await pending
        await ready()
      }
      const assertFilters = () => {
        const q = requests.at(-1)
        for (const [key, value] of Object.entries(config.filters)) {
          if (key === "view") continue
          const expected =
            config.name === "billing" && key === "from"
              ? "2026-09-30T16:00:00.000Z"
              : config.name === "billing" && key === "until"
                ? "2026-10-29T16:00:00.000Z"
                : value
          assert.equal(q.get(key), expected, `${config.name} ${key}`)
        }
      }
      try {
        const params = new URLSearchParams({
          ...config.filters,
          page: "2",
          page_size: "20",
        })
        let pending = response((q) => q.get("page") === "2")
        await page.goto(`http://tables.test${config.route}?${params}`)
        await pending
        await ready()
        assertFilters()
        assert.equal(requests.at(-1).get("page_size"), "20")
        if (config.input)
          assert.equal(
            await page.locator(config.input).inputValue(),
            config.filters[config.textKey]
          )
        if (config.dates)
          for (const selector of config.dates)
            assert.match(
              await page.locator(`#${selector}`).textContent(),
              /2026/
            )
        if (config.name === "billing")
          await page.waitForFunction(
            () => document.querySelector("#billing-user").value === "张三"
          )
        pending = response((q) => q.get("page") === "2")
        await page.reload()
        await pending
        await ready()
        assertFilters()
        assert.equal(new URL(page.url()).searchParams.get("page"), "2")
        pending = response((q) => q.get("page") === "3")
        await click(page, '[data-slot="table-pagination"] button', "下一页")
        await pending
        await ready()
        assert.equal(new URL(page.url()).searchParams.get("page"), "3")
        assertFilters()
        await click(page, '[data-slot="table-pagination"] [role="combobox"]')
        pending = response(
          (q) => q.get("page") === "1" && q.get("page_size") === "50"
        )
        await click(page, '[role="option"]', "50 条 / 页")
        await pending
        await ready()
        assert.equal(new URL(page.url()).searchParams.has("page"), false)
        assert.equal(new URL(page.url()).searchParams.has("page_size"), false)
        if (config.name !== "feedback") {
          const value = "新关键词 + &"
          await type(page, config.input, value)
          assert.equal(
            new URL(page.url()).searchParams.get(config.textKey),
            config.filters[config.textKey]
          )
          pending = response((q) => q.get("page") === "2")
          await click(page, '[data-slot="table-pagination"] button', "下一页")
          await pending
          await ready()
          assert.equal(
            await page.locator(config.input).inputValue(),
            value,
            "paging preserves the draft"
          )
          assert.equal(
            new URL(page.url()).searchParams.get(config.textKey),
            config.filters[config.textKey]
          )
          await click(page, '[data-slot="table-pagination"] [role="combobox"]')
          pending = response(
            (q) => q.get("page") === "1" && q.get("page_size") === "20"
          )
          await click(page, '[role="option"]', "20 条 / 页")
          await pending
          await ready()
          assert.equal(
            await page.locator(config.input).inputValue(),
            value,
            "page size preserves the draft"
          )
          const beforeSearch = requests.length
          await search(config.textKey, value)
          assert.equal(
            requests.length,
            beforeSearch + 1,
            "changed filters fetch once"
          )
          assert.equal(
            new URL(page.url()).searchParams.get(config.textKey),
            value
          )
          pending = response((q) => q.get(config.textKey) === value)
          await page.reload()
          await pending
          await ready()
          assert.equal(await page.locator(config.input).inputValue(), value)
          pending = response(
            (q) => q.get(config.textKey) === config.filters[config.textKey]
          )
          await page.goBack()
          await pending
          await ready()
          assert.equal(
            await page.locator(config.input).inputValue(),
            config.filters[config.textKey]
          )
          pending = response((q) => q.get(config.textKey) === value)
          await page.goForward()
          await pending
          await ready()
          assert.equal(await page.locator(config.input).inputValue(), value)
          const beforeRefresh = requests.length
          await search(config.textKey, value)
          assert.equal(
            requests.length,
            beforeRefresh + 1,
            "same-condition search refreshes once"
          )
          await type(page, config.input, "")
          await search(config.textKey, "")
          assert.equal(
            new URL(page.url()).searchParams.has(config.textKey),
            false
          )
          for (const selector of config.dates) {
            await click(page, `#${selector}`)
            await click(
              page,
              '[data-slot="calendar"] button[data-selected-single="true"]'
            )
            await page.keyboard.press("Escape")
          }
          pending = response((q) => config.dateKeys.every((key) => !q.has(key)))
          await click(page, "button", "搜索")
          await pending
          await ready()
          for (const key of config.dateKeys)
            assert.equal(new URL(page.url()).searchParams.has(key), false)
          pending = response((q) => config.dateKeys.every((key) => q.has(key)))
          await page.goBack()
          await pending
          await ready()
          for (const selector of config.dates)
            assert.match(
              await page.locator(`#${selector}`).textContent(),
              /2026/
            )
          pending = response((q) => config.dateKeys.every((key) => !q.has(key)))
          await page.goForward()
          await pending
          await ready()
          if (config.name === "billing") {
            assert.equal(new URL(page.url()).searchParams.get("range"), "all")
            pending = response((q) => !q.has("from") && !q.has("until"))
            await page.reload()
            await pending
            await ready()
            pending = response((q) => q.has("from") && q.has("until"))
            await page.goto(`http://tables.test${config.route}`)
            await pending
            await ready()
            assert.equal(
              new URL(page.url()).searchParams.get("from"),
              "2026-10-02"
            )
            assert.equal(
              new URL(page.url()).searchParams.get("until"),
              "2026-10-29"
            )
            pending = response((q) => q.get("page") === "1")
            await page.goto(
              `http://tables.test${config.route}?${new URLSearchParams({ ...config.filters, page: "1", page_size: "50" })}`
            )
            await pending
            await ready()
            const beforeCanonicalSearch = requests.length
            await search(config.textKey, config.filters[config.textKey])
            assert.equal(
              requests.length,
              beforeCanonicalSearch + 1,
              "explicit default paging still refreshes once"
            )
            await page.waitForFunction(() =>
              [...document.querySelectorAll("button")].some(
                (button) =>
                  button.textContent.trim() === "搜索" && !button.disabled
              )
            )
          }
          if (config.name === "conversation") {
            pending = response(
              (q) => q.get("content") === config.filters.content
            )
            const spaced = new URLSearchParams({
              ...config.filters,
              content: ` ${config.filters.content} `,
              page: "1",
              page_size: "50",
            })
            await page.goto(`http://tables.test${config.route}?${spaced}`)
            await pending
            await ready()
            const beforeTrimmedSearch = requests.length
            await search("content", config.filters.content)
            assert.equal(
              requests.length,
              beforeTrimmedSearch + 1,
              "normalizing URL whitespace still refreshes once"
            )
          }
        } else {
          await click(page, '[role="combobox"]', zhCN.pages.feedback.category)
          pending = response(
            (q) => q.get("category") === "feature" && q.get("page") === "1"
          )
          await click(
            page,
            '[role="option"]',
            zhCN.pages.feedback.categories.feature
          )
          await pending
          await ready()
          assert.equal(
            new URL(page.url()).searchParams.get("category"),
            "feature"
          )
          pending = response((q) => q.get("category") === "feature")
          await page.reload()
          await pending
          await ready()
          pending = response((q) => q.get("category") === "bug")
          await page.goBack()
          await pending
          await ready()
          pending = response((q) => q.get("category") === "feature")
          await page.goForward()
          await pending
          await ready()
          await click(page, '[role="combobox"]', zhCN.pages.feedback.state)
          pending = response((q) => !q.has("state"))
          await click(page, '[role="option"]', zhCN.pages.feedback.allStates)
          await pending
          await ready()
          assert.equal(new URL(page.url()).searchParams.has("state"), false)
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          ),
          false
        )
        assert.deepEqual(errors, [])
        console.log(
          `PASS URL search ${config.name} ${width}: bookmark, all filters, paging, reload, back/forward, clear${config.name === "billing" ? ", default28/all-time" : ""}`
        )
      } catch (error) {
        await page.screenshot({
          path: `/tmp/monkeyai-table-query-${config.name}-${width}-failed.png`,
          fullPage: true,
        })
        throw error
      } finally {
        await page.close()
      }
    }
} finally {
  await browser.close()
}
