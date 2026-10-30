import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const executablePath = process.env.CHROME_BIN
if (!executablePath) throw new Error("请设置 CHROME_BIN；先执行 pnpm build")
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const user = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002"
const history = "/api/admin/v1/statistics/history"
const taskPath = "/console/statistics/task-history",
  clientPath = "/console/statistics/session-reporting/clients"
const at = "2026-10-01T00:00:00Z"
const tasks = [user, user, other].map((owner, i) => ({
  id: `10000000-0000-4000-8000-00000000000${i}`,
  title: `任务 ${i}`,
  user_id: owner,
  user_name: "同名用户",
  user_email: owner === user ? "first@example.test" : "second@example.test",
  started_at: at,
  last_active_at: at,
  turn_count: 1,
}))
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
}
async function click(page, selector, text) {
  await page.evaluate(() => document.fonts.ready)
  const handle = await page.waitForFunction(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find(
        (el) => text === undefined || el.textContent.trim() === text
      )
      if (!el || el.disabled || el.getAttribute("aria-disabled") === "true")
        return null
      for (let node = el; node; node = node.parentElement)
        if (
          node
            .getAnimations?.()
            .some(
              (a) =>
                a.playState === "running" &&
                Number.isFinite(a.effect?.getComputedTiming().iterations)
            )
        )
          return null
      el.scrollIntoView({ block: "center", inline: "nearest" })
      const r = el.getBoundingClientRect(),
        previous = window.__accountLinkRect
      window.__accountLinkRect = {
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
  for (const source of ["client", "task"])
    for (const width of [1440, 390]) {
      if (
        process.env.SCENARIO_FILTER &&
        !`${source}:${width}`.includes(process.env.SCENARIO_FILTER)
      )
        continue
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
      })
      page.setDefaultTimeout(15000)
      await page.addInitScript(() =>
        localStorage.setItem("monkeyai-admin-language", "zh-CN")
      )
      const errors = [],
        queries = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith("/api/")) {
          let body = {}
          if (url.pathname.endsWith("/session"))
            body = {
              authenticated: true,
              user: {
                id: user,
                name: "管理员",
                role: "admin",
                status: "active",
                email: "admin@example.test",
              },
            }
          else if (url.pathname.endsWith("/branding"))
            body = { product_name: "百智办公" }
          else if (url.pathname === `/api/admin/v1/users/${user}`)
            body = {
              id: user,
              name: "同名用户",
              email: "first@example.test",
              role: "user",
              status: "active",
              joined_at: at,
            }
          else if (url.pathname === `/api/admin/v1/billing/accounts/${user}`)
            body = {
              account: {
                available: "100",
                balance: "100",
                quota: "100",
                frozen: "0",
                version: "1",
                period_start_at: at,
                period_end_at: "2026-11-01T00:00:00Z",
              },
              wallet: { configured: true },
              external_user_id: "",
            }
          else if (url.pathname === "/api/admin/v1/billing/users") {
            const id = url.searchParams.get("id"),
              query = url.searchParams.get("q") ?? ""
            const candidates = [user, other].map((id) => ({
              id,
              name: "同名用户",
              email: id === user ? "first@example.test" : "second@example.test",
              avatar_url: null,
              deleted: false,
            }))
            body = {
              items: candidates.filter((candidate) =>
                id
                  ? candidate.id === id
                  : `${candidate.name} ${candidate.email} ${candidate.id}`.includes(
                      query
                    )
              ),
              has_next: false,
            }
          } else if (url.pathname === history) {
            queries.push(url.searchParams)
            const rows = tasks.filter(
              (task) =>
                !url.searchParams.get("user_id") ||
                task.user_id === url.searchParams.get("user_id")
            )
            body = {
              items: rows,
              page: Number(url.searchParams.get("page") || 1),
              page_size: Number(url.searchParams.get("page_size") || 50),
              has_next: false,
            }
          } else if (url.pathname === "/api/admin/v1/endpoints")
            body = {
              items: [
                {
                  id: user,
                  user_id: user,
                  user_name: "同名用户",
                  user_email: "first@example.test",
                  user_avatar_url: null,
                  user_deleted: false,
                  machine_id: other,
                  device_name: "测试设备",
                  alias: null,
                  platform: "windows",
                  os_version: "11",
                  arch: "arm64",
                  client_type: "desktop",
                  client_version: "1",
                  created_at: at,
                  last_active_at: at,
                  status: "active",
                },
              ],
              page: 1,
              page_size: 50,
              has_next: false,
            }
          else if (url.pathname === "/api/admin/v1/endpoints/overview")
            body = {
              metric: "devices",
              total: 1,
              users: 1,
              distributions: {
                client_type: [{ value: "desktop", count: 1 }],
                platform: [{ value: "windows", count: 1 }],
                client_version: [{ value: "1", count: 1 }],
              },
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
      const response = (id) =>
        page.waitForResponse((res) => {
          const url = new URL(res.url())
          return (
            url.pathname === history &&
            (url.searchParams.get("user_id") || "") === id
          )
        })
      const ready = (count) =>
        page.waitForFunction(
          (count) =>
            document
              .querySelector('table[aria-label="任务历史"]')
              ?.getAttribute("aria-busy") === "false" &&
            document.querySelectorAll("tbody tr").length === count,
          count
        )
      try {
        await page.goto(
          `http://accounts.test${source === "client" ? clientPath : taskPath}`
        )
        await page.waitForFunction(
          () =>
            document.querySelector("table")?.getAttribute("aria-busy") ===
            "false"
        )
        await click(
          page,
          source === "client"
            ? "tbody tr:first-child td:first-child button"
            : "tbody tr:first-child td:nth-child(2) button"
        )
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[role="dialog"] a')].some(
            (el) => el.textContent.trim() === "任务"
          )
        )
        await page.setViewportSize({ width, height: 500 })
        await page.waitForFunction(
          () =>
            !document
              .querySelector('[role="dialog"]')
              .getAnimations()
              .some((animation) => animation.playState === "running")
        )
        const geometry = () =>
          page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]')
            const body = dialog.querySelector(
              '[data-account-dialog-body] [data-slot="scroll-area-viewport"]'
            )
            const header = dialog
              .querySelector('[data-slot="dialog-header"]')
              .getBoundingClientRect()
            const actions = dialog
              .querySelector('[data-slot="account-dialog-actions"]')
              .getBoundingClientRect()
            const content = body.querySelector("dl").getBoundingClientRect()
            const bounds = body.getBoundingClientRect()
            return {
              header: [header.top, header.bottom],
              actions: [actions.top, actions.bottom],
              content: content.top,
              contentInsets: [
                content.left - dialog.getBoundingClientRect().left,
                dialog.getBoundingClientRect().right - content.right,
              ],
              body: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                scrollHeight: body.scrollHeight,
                scrollTop: body.scrollTop,
              },
              height: dialog.getBoundingClientRect().height,
              scrollTop: dialog.scrollTop,
            }
          })
        const before = await geometry()
        assert(before.height <= 500 * 0.85 + 1)
        assert(
          Math.abs(before.contentInsets[0] - before.contentInsets[1]) <= 1,
          `content insets must match: ${before.contentInsets}`
        )
        assert(
          before.body.scrollHeight > before.body.height + 100,
          "small viewport must scroll the body"
        )
        assert(
          before.header[0] >= 0 && before.actions[1] <= 500,
          "header and actions stay visible"
        )
        await page.mouse.move(
          before.body.x + before.body.width / 2,
          before.body.y + before.body.height / 2
        )
        await page.mouse.wheel(0, 500)
        await page.waitForFunction(
          () =>
            document.querySelector(
              '[data-account-dialog-body] [data-slot="scroll-area-viewport"]'
            ).scrollTop > 50
        )
        const after = await geometry()
        for (const key of ["header", "actions"])
          for (let index = 0; index < 2; index++)
            assert(
              Math.abs(before[key][index] - after[key][index]) <= 1,
              `${key} must stay fixed`
            )
        assert(after.content < before.content - 50, "middle content must move")
        assert.equal(after.scrollTop, 0, "the outer dialog must not scroll")
        assert.equal(
          await page
            .locator(
              '[data-account-dialog-body] [data-slot="scroll-area-scrollbar"][data-orientation="vertical"]'
            )
            .count(),
          1
        )
        await page.screenshot({
          path: `/tmp/monkeyai-account-fixed-${source}-${width}-${path.basename(executablePath)}.png`,
        })
        const buttons = await page
          .locator('[role="dialog"] [data-slot="account-dialog-actions"] > *')
          .allTextContents()
        assert.deepEqual(
          buttons.map((text) => text.trim()),
          ["费用明细", "调整积分", "客户端", "任务"]
        )
        assert.equal(
          await page
            .locator('[role="dialog"] a')
            .filter({ hasText: /^任务$/ })
            .getAttribute("href"),
          `${taskPath}?user_id=${user}`
        )
        await Promise.all([
          response(user),
          click(page, '[role="dialog"] a', "任务"),
        ])
        await ready(2)
        await page.waitForFunction(
          () => !document.querySelector('[role="dialog"]')
        )
        assert.equal(new URL(page.url()).searchParams.get("user_id"), user)
        assert.equal(queries.at(-1).get("user"), "")
        await page.waitForFunction(
          () =>
            document.querySelector("#task-history-user").value === "同名用户"
        )
        assert(
          (
            await page.locator("#task-history-user").getAttribute("title")
          ).includes(user)
        )
        await Promise.all([response(user), page.reload()])
        await ready(2)
        await page.waitForFunction(
          () =>
            document.querySelector("#task-history-user").value === "同名用户"
        )
        await click(page, "#task-history-user")
        await page.keyboard.press("Control+a")
        await page.keyboard.insertText(other)
        await page.waitForFunction(
          (id) =>
            [...document.querySelectorAll('[role="option"]')].some((option) =>
              option.title.includes(id)
            ),
          other
        )
        await click(page, `[role="option"][title*="${other}"]`)
        assert.equal(new URL(page.url()).searchParams.get("user_id"), user)
        await Promise.all([
          response(other),
          click(page, 'button[type="submit"]', "搜索"),
        ])
        await ready(1)
        assert.equal(new URL(page.url()).searchParams.get("user_id"), other)
        await Promise.all([response(user), page.goBack()])
        await ready(2)
        await page.waitForFunction(
          () =>
            document.querySelector("#task-history-user").value === "同名用户"
        )
        assert(
          (
            await page.locator("#task-history-user").getAttribute("title")
          ).includes(user)
        )
        await Promise.all([response(other), page.goForward()])
        await ready(1)
        await click(page, "#task-history-user")
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        await Promise.all([
          response(""),
          click(page, 'button[type="submit"]', "搜索"),
        ])
        await ready(3)
        assert.equal(new URL(page.url()).searchParams.has("user_id"), false)
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          ),
          false
        )
        assert.deepEqual(errors, [])
        console.log(
          `PASS account task link ${source} ${width}: fixed header/actions, body wheel scroll, button order, navigation/close, exact UUID, same names, reload, draft, history, clear`
        )
      } catch (error) {
        await page.screenshot({
          path: `/tmp/monkeyai-account-task-${source}-${width}-failed.png`,
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
