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
const users = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "张三",
    email: "first@example.test",
    avatar_url: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "张三",
    email: "second@example.test",
    avatar_url: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "离职成员",
    email: "deleted@example.test",
    avatar_url: null,
    deleted: true,
  },
]
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}
// Current Playwright visibility helpers require checkVisibility, absent in Chrome 86.
async function click(page, selector, text) {
  await page.evaluate(() => document.fonts.ready)
  const handle = await page.waitForFunction(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find(
        (el) =>
          text === undefined ||
          el.textContent.includes(text) ||
          el.getAttribute("aria-label") === text
      )
      if (!el || el.disabled) return null
      el.scrollIntoView({ block: "center", inline: "nearest" })
      const rect = el.getBoundingClientRect(),
        x = rect.x + rect.width / 2,
        y = rect.y + rect.height / 2
      return el.contains(document.elementFromPoint(x, y)) ? { x, y } : null
    },
    { selector, text }
  )
  const point = await handle.jsonValue()
  await handle.dispose()
  await page.mouse.click(point.x, point.y)
}
async function type(page, text) {
  await click(page, "#billing-user")
  await page.keyboard.press("Control+a")
  await page.keyboard.insertText(text)
}
const pause = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      locale: "zh-CN",
    })
    page.setDefaultTimeout(15000)
    await page.addInitScript(() =>
      localStorage.setItem("monkeyai-admin-language", "zh-CN")
    )
    const errors = [],
      entries = [],
      lookups = []
    page.on("pageerror", (error) => errors.push(error.message))
    const first = pause(),
      stale = pause()
    let firstPending = true,
      failures = 0
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith("/api/")) {
        let body = {}
        if (url.pathname.endsWith("/session"))
          body = {
            authenticated: true,
            user: {
              ...users[0],
              name: "管理员",
              role: "admin",
              status: "active",
            },
          }
        else if (url.pathname.endsWith("/branding"))
          body = { product_name: "百智办公", workspace_name: "测试" }
        else if (url.pathname === "/api/admin/v1/billing/users") {
          lookups.push(url.searchParams)
          const query = url.searchParams.get("q") || "",
            id = url.searchParams.get("id")
          if (query === "张" && firstPending) {
            firstPending = false
            await first.promise
          }
          if (query === "旧请求") {
            await stale.promise
            body = {
              items: [{ ...users[0], name: "过期结果" }],
              has_next: false,
            }
          } else if (query === "故障" && failures++ === 0)
            return route.fulfill({
              status: 503,
              json: { error: { message: "用户查询失败" } },
            })
          else
            body = {
              items: id
                ? users.filter((user) => user.id === id)
                : query === "故障"
                  ? [users[2]]
                  : !query || query === "张"
                    ? users.slice(0, 2)
                    : [],
              has_next: !query,
            }
        } else if (url.pathname === "/api/admin/v1/billing/entries") {
          entries.push(url.searchParams)
          body = {
            items: [0, 1].map((n) => ({
              id: `entry-${n}`,
              user_id: url.searchParams.get("user_id") || users[0].id,
              user_name: "历史姓名",
              user_email: "old@example.test",
              user_deleted: false,
              user_avatar_url: null,
              occurred_at: "2026-10-01T00:00:00Z",
              entry_type: "charge",
              credit_delta: "-10",
              balance_after: "90",
              category: "model",
              item_name: "模型扣费",
              mode: "local",
              transaction_id: null,
            })),
            page: Number(url.searchParams.get("page") || 1),
            page_size: 50,
            has_next: true,
          }
        }
        return route.fulfill({ json: body }).catch(() => {})
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
    const options = (count) =>
      page.waitForFunction(
        (count) =>
          document.querySelectorAll('[role="option"]').length === count,
        count
      )
    const submit = async () => {
      await ready()
      await click(page, 'button[type="submit"]')
      await ready()
    }
    try {
      await page.goto(
        "http://monkeyai.test/console/billing/details?view=entries&page=3"
      )
      await ready()
      const before = entries.length
      await type(page, "张")
      await page.waitForFunction(() =>
        document.querySelector('[role="status"][aria-label="正在加载"]')
      )
      assert.equal(
        entries.length,
        before,
        "candidate search must not query ledger facts"
      )
      first.release()
      await options(2)
      assert.match(
        await page.locator('[role="listbox"]').textContent(),
        /first@example.test/
      )
      assert.match(
        await page.locator('[role="listbox"]').textContent(),
        /second@example.test/
      )
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Enter")
      await page.waitForFunction(
        () => document.querySelector("#billing-user").value === "张三"
      )
      assert.equal(
        entries.length,
        before,
        "selecting a candidate must wait for Search"
      )
      await submit()
      assert.equal(entries.at(-1).get("user_id"), users[1].id)
      assert.equal(entries.at(-1).get("user"), null)
      assert.equal(entries.at(-1).get("page"), "1")
      await page.reload()
      await ready()
      await page.waitForFunction(
        () => document.querySelector("#billing-user").value === "张三"
      )
      assert(
        lookups.some((query) => query.get("id") === users[1].id),
        "selected UUID must restore after reload"
      )
      await click(page, 'button[aria-label="下一页"]')
      await ready()
      assert.equal(entries.at(-1).get("user_id"), users[1].id)
      assert.equal(entries.at(-1).get("page"), "2")
      await click(page, 'button[aria-label="清除用户筛选"]')
      await submit()
      assert.equal(entries.at(-1).get("user_id"), null)
      assert.equal(entries.at(-1).get("user"), null)
      await type(page, "离职旧名")
      await options(0)
      await page.keyboard.press("Enter")
      await ready()
      assert.equal(entries.at(-1).get("user"), "离职旧名")
      assert.equal(entries.at(-1).get("user_id"), null)
      const staleStarted = page.waitForRequest(
        (request) => new URL(request.url()).searchParams.get("q") === "旧请求"
      )
      await type(page, "旧请求")
      await staleStarted
      await type(page, "张")
      await options(2)
      stale.release()
      await new Promise((resolve) => setTimeout(resolve, 150))
      assert.doesNotMatch(
        await page.locator('[role="listbox"]').textContent(),
        /过期结果/
      )
      await click(page, '[role="option"]', "first@example.test")
      await submit()
      assert.equal(entries.at(-1).get("user_id"), users[0].id)
      await type(page, "旧名")
      await page.keyboard.press("Enter")
      await ready()
      assert.equal(
        entries.at(-1).get("user"),
        "旧名",
        "editing a selection must switch back to historical text search"
      )
      assert.equal(entries.at(-1).get("user_id"), null)
      await type(page, "故障")
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="alert"]')].some((el) =>
          el.textContent.includes("用户查询失败")
        )
      )
      await click(page, '[role="alert"] button', "重试")
      await options(1)
      assert.match(
        await page.locator('[role="option"]').textContent(),
        /已删除/
      )
      await click(page, '[role="option"]', "deleted@example.test")
      await submit()
      assert.equal(entries.at(-1).get("user_id"), users[2].id)
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        ),
        false
      )
      assert.deepEqual(errors, [])
      await page.screenshot({
        path: `/tmp/monkeyai-billing-users-${width}-${path.basename(executablePath)}.png`,
      })
      console.log(
        `PASS billing user selection ${width}: duplicates, exact ID, reload, paging, clear, legacy, stale requests, retry, deleted`
      )
    } catch (error) {
      await page.screenshot({ path: "/tmp/monkeyai-billing-users-failed.png" })
      console.error(await page.locator("body").textContent())
      throw error
    } finally {
      first.release()
      stale.release()
      await page.close()
    }
  }
} finally {
  await browser.close()
}
