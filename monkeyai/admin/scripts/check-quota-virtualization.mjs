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
try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1100 },
    locale: "zh-CN",
  })
  page.setDefaultTimeout(10000)
  const errors = [],
    accounts = []
  page.on("pageerror", (error) => errors.push(error.message))
  const size = 10000,
    id = (index) => `quota-${String(index).padStart(5, "0")}`
  const users = Array.from({ length: size }, (_, index) => ({
    id: id(index),
    name: `成员${String(index).padStart(5, "0")}`,
    email: `user${index}@example.com`,
    status: index === 11 ? "disabled" : "active",
    group_ids: ["root"],
    effective_credits: String(index + 50000),
    balance_credits: String(size - index),
    available_credits: "999999",
    inherited_from: "root",
  }))
  users[7].balance_credits = "999999999999.000000"
  users[8].balance_credits = "999999999999.000001"
  delete users[9].balance_credits
  users[11].balance_credits = "-2.100001"
  users[12].balance_credits = "-2.000000"
  users[13].balance_credits = "0"
  const settings = {
    policy: {
      revision: 1,
      enabled: true,
      charging_mode: "local",
      quota_refresh_cycle: "weekly",
      input_credits_per_million_tokens: "1000",
      cached_input_credits_per_million_tokens: "100",
      output_credits_per_million_tokens: "2000",
    },
    wallet: { configured: false, credentials_configured: false },
    timezone: "Asia/Shanghai",
    next_refresh_at: "2026-10-19T00:00:00Z",
  }
  let quotaRequests = 0
  await page.route("**/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const json = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      })
    if (pathname.startsWith("/api/")) {
      assert.equal(
        route.request().method(),
        "GET",
        "this regression must not perform financial writes"
      )
      if (pathname.endsWith("/session"))
        return json({
          authenticated: true,
          user: {
            id: "admin",
            name: "管理员",
            role: "admin",
            status: "active",
          },
        })
      if (pathname.endsWith("/branding"))
        return json({ product_name: "MonkeyAI" })
      if (pathname.endsWith("/license/status")) return json({ state: "valid" })
      if (pathname.endsWith("/billing/settings")) return json(settings)
      if (pathname.endsWith("/billing/quotas")) {
        quotaRequests++
        return json({
          groups: [
            {
              id: "root",
              parent_id: null,
              name: "性能测试团队",
              credits: "10000",
              allow_inherit: false,
            },
          ],
          users,
          revision: 1,
          effective_at: "2026-10-19T00:00:00Z",
        })
      }
      if (
        pathname.includes("/users/") ||
        pathname.includes("/billing/accounts/")
      ) {
        accounts.push(pathname)
        const user = users.find(
          (user) => user.id === pathname.split("/").at(-1)
        )
        assert.ok(user)
        if (pathname.includes("/users/")) return json({ ...user, role: "user" })
        return json({
          account: {
            version: "1",
            id: `account-${user.id}`,
            user_id: user.id,
            balance: user.balance_credits ?? "0",
            frozen: "0",
            available: "999999",
            quota: user.effective_credits,
            period_start_at: "2026-10-12T00:00:00Z",
            period_end_at: "2026-10-19T00:00:00Z",
          },
          user_name: user.name,
          user_email: user.email,
          wallet: { configured: false, credentials_configured: false },
          external_user_id: "",
        })
      }
      return json({ items: [] })
    }
    const requested = path.resolve(dist, `.${pathname}`)
    const exists =
      requested.startsWith(dist) &&
      (await stat(requested)
        .then((s) => s.isFile())
        .catch(() => false))
    const file = exists ? requested : path.join(dist, "index.html")
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".webp": "image/webp",
      ".woff2": "font/woff2",
    }
    return route.fulfill({
      contentType: types[path.extname(file)] || "application/octet-stream",
      body: await readFile(file),
    })
  })
  const row = (index) => `[role="listitem"][data-virtual-key="${id(index)}"]`
  const sort = '[aria-label="成员排序"]',
    search = 'input[aria-label="搜索成员"]'
  const click = async (selector, text) => {
    await page.waitForFunction(
      ({ selector, text }) =>
        [...document.querySelectorAll(selector)].some(
          (node) =>
            (text === undefined || node.textContent.trim() === text) &&
            node.getClientRects().length &&
            getComputedStyle(node).visibility !== "hidden"
        ),
      { selector, text }
    )
    await page.evaluate(
      ({ selector, text }) => {
        const element = [...document.querySelectorAll(selector)].find(
          (node) => text === undefined || node.textContent.trim() === text
        )
        element.scrollIntoView({ block: "nearest" })
        window.__clickPoint = { x: -1, y: -1, stable: 0 }
      },
      { selector, text }
    )
    await page.waitForFunction(
      ({ selector, text }) => {
        const element = [...document.querySelectorAll(selector)].find(
          (node) => text === undefined || node.textContent.trim() === text
        )
        if (!element || element.disabled) return false
        const rect = element.getBoundingClientRect(),
          x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2
        const previous = window.__clickPoint,
          stable =
            Math.abs(previous.x - x) < 0.1 && Math.abs(previous.y - y) < 0.1
              ? previous.stable + 1
              : 0
        window.__clickPoint = { x, y, stable }
        const target = document.elementFromPoint(x, y)
        return stable >= 2 && !!target && element.contains(target)
      },
      { selector, text }
    )
    const point = await page.evaluate(() => window.__clickPoint)
    await page.mouse.click(point.x, point.y)
  }
  const scroll = async (end) => {
    await page.evaluate((end) => {
      const viewport = document
        .querySelector('[role="listitem"][data-virtual-key]')
        .closest('[data-slot="scroll-area-viewport"]')
      viewport.scrollTop = end ? viewport.scrollHeight : 0
      viewport.dispatchEvent(new Event("scroll"))
    }, end)
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
  }
  const exists = (selector) =>
    page.waitForFunction(
      (selector) => !!document.querySelector(selector),
      selector
    )
  const rendered = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[role="listitem"][data-virtual-key]')]
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        .map((node) => node.dataset.virtualKey)
    )
  const bounded = async () => {
    const count = await page.evaluate(
      () =>
        document.querySelectorAll('[role="listitem"][data-virtual-key]').length
    )
    assert.ok(count > 0 && count < 50, `mounted ${count} quota rows`)
    return count
  }
  const chooseSort = async (label) => {
    await click(sort)
    await exists('[role="option"]')
    assert.deepEqual(
      await page.evaluate(() =>
        [...document.querySelectorAll('[role="option"]')].map((node) =>
          node.textContent.trim()
        )
      ),
      ["姓名排序", "积分排序"]
    )
    await click('[role="option"]', label)
  }
  const fill = async (value) => {
    await page.evaluate(
      ({ selector, value }) => {
        const input = document.querySelector(selector)
        input.focus()
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        ).set.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
      },
      { selector: search, value }
    )
  }
  await page.goto("http://admin.test/console/billing/settings")
  await exists(row(0))
  const initial = await bounded()
  assert.equal(await page.getAttribute(row(0), "aria-setsize"), String(size))
  await scroll(true)
  await exists(row(size - 1))
  await bounded()
  assert.equal(quotaRequests, 1)
  await chooseSort("积分排序")
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-virtual-key="quota-00011"]')
        ?.getAttribute("aria-posinset") === "1"
  )
  assert.deepEqual((await rendered()).slice(0, 3), [id(11), id(12), id(13)])
  await scroll(true)
  await exists(row(9))
  assert.deepEqual((await rendered()).slice(-3), [id(7), id(8), id(9)])
  assert.ok((await page.textContent(row(9))).includes("—"))

  await click(`${row(8)} button`)
  await exists('[role="dialog"] dl')
  assert.ok(accounts.some((pathname) => pathname.endsWith(`/users/${id(8)}`)))
  assert.ok(
    accounts.some((pathname) => pathname.endsWith(`/billing/accounts/${id(8)}`))
  )
  await scroll(false)
  assert.equal(
    await page.evaluate(
      (selector) => !!document.querySelector(selector),
      row(8)
    ),
    true,
    "account dialog must retain the clicked row"
  )
  await bounded()
  users[8].balance_credits = "-9999.000001"
  const refresh = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/billing/quotas")
  )
  await page.keyboard.press("Escape")
  await refresh
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="dialog"]') &&
      document
        .querySelector('[data-virtual-key="quota-00008"]')
        ?.getAttribute("aria-posinset") === "1"
  )
  assert.equal(quotaRequests, 2)
  assert.ok((await page.textContent(sort)).includes("积分排序"))
  await fill("USER8@EXAMPLE.COM")
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="listitem"][data-virtual-key]')
        .length === 1 &&
      document
        .querySelector('[role="listitem"]')
        .getAttribute("aria-setsize") === "1"
  )
  assert.deepEqual(await rendered(), [id(8)])
  assert.equal(
    await page.evaluate(
      () =>
        document
          .querySelector('[role="listitem"]')
          .closest('[data-slot="scroll-area-viewport"]').scrollTop
    ),
    0
  )
  await fill("no-matching-member")
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="listitem"][data-virtual-key]')
        .length === 0
  )
  assert.ok((await page.textContent("body")).includes("没有找到成员"))
  await fill("")
  await chooseSort("姓名排序")
  await exists(row(0))
  assert.equal(quotaRequests, 2, "scroll, search and sort must stay local")

  for (const width of [1500, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 1100 })
    await scroll(false)
    await exists(row(0))
    await bounded()
    const layout = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll('[role="listitem"][data-virtual-key]'),
      ].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
      const viewport = rows[0].closest('[data-slot="scroll-area-viewport"]')
      const input = document
        .querySelector('input[aria-label="搜索成员"]')
        .getBoundingClientRect()
      const select = document
        .querySelector('[aria-label="成员排序"]')
        .getBoundingClientRect()
      return {
        height: viewport.clientHeight,
        content: viewport.scrollHeight,
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        inputWidth: input.width,
        selectWidth: select.width,
        sameLine: Math.abs(input.y - select.y) < 1,
        overlap: rows.some(
          (node, index) =>
            index &&
            Number(node.dataset.index) ===
              Number(rows[index - 1].dataset.index) + 1 &&
            node.getBoundingClientRect().top <
              rows[index - 1].getBoundingClientRect().bottom + 6
        ),
      }
    })
    assert.ok(
      layout.height > 0 &&
        layout.height <= 1100 &&
        layout.content > layout.height,
      JSON.stringify(layout)
    )
    assert.ok(
      layout.scrollWidth <= layout.width &&
        layout.inputWidth <= 128.1 &&
        layout.inputWidth >= 70 &&
        layout.selectWidth === 112 &&
        layout.sameLine,
      JSON.stringify(layout)
    )
    assert.equal(layout.overlap, false, JSON.stringify(layout))
    await scroll(true)
    await exists(row(size - 1))
    await bounded()
  }
  assert.equal(quotaRequests, 2)
  assert.deepEqual(errors, [])
  console.log(
    `${await browser.version()}: 10,000 quota members; initially ${initial} mounted rows. Full-range scrolling, exact six-decimal balance sorting, negative/missing balances, dialog anchor and refreshed ordering, local search/sort, empty results, 1500–320px layouts and row spacing passed.`
  )
} finally {
  await browser.close()
}
