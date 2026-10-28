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
const rootID = "00000000-0000-0000-0000-000000000000"
const memberID = (i) => `u${String(i).padStart(5, "0")}`
const groupID = (i) => `g${String(i).padStart(3, "0")}`
const click = (page, selector) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (!el) throw new Error(`Missing ${selector}`)
    el.click()
  }, selector)
const fill = (page, selector, value) =>
  page.evaluate(
    ({ selector, value }) => {
      const input = document.querySelector(selector)
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    },
    { selector, value }
  )
const rowAction = (page, kind, id, action) =>
  page.evaluate(
    ({ kind, id, action }) => {
      const row = [...document.querySelectorAll("[data-virtual-key]")].find(
        (el) => {
          const key = JSON.parse(el.dataset.virtualKey)
          return key[0] === kind && key[kind === "group" ? 1 : 2] === id
        }
      )
      if (!row) throw new Error(`Missing ${kind} ${id}`)
      const selector =
        action === "expand" ? "button[aria-expanded]" : '[role="checkbox"]'
      const control = row.querySelector(selector)
      if (!control) throw new Error(`Missing ${selector} for ${id}`)
      if (action === "focus") control.focus()
      else control.click()
    },
    { kind, id, action }
  )
const popup = '[data-slot="popover-content"]'
const search = `${popup} input[type="search"]`
const waitUser = (page, id) =>
  page.waitForFunction(
    (id) =>
      [...document.querySelectorAll("[data-virtual-key]")].some((el) => {
        const key = JSON.parse(el.dataset.virtualKey)
        return key[0] === "user" && key[2] === id
      }),
    id
  )
const cases = [
  { size: 1000, width: 1440, language: "zh-CN" },
  { size: 10000, width: 1440, language: "zh-CN" },
  { size: 1000, width: 390, language: "zh-CN", dark: true },
  { size: 1000, width: 390, language: "ar", dark: true },
].filter(
  (entry) =>
    (!process.env.GROUP_SELECT_SIZE ||
      entry.size === Number(process.env.GROUP_SELECT_SIZE)) &&
    (!process.env.GROUP_SELECT_LANGUAGE ||
      entry.language === process.env.GROUP_SELECT_LANGUAGE)
)

try {
  for (const config of cases) {
    const page = await browser.newPage({
      viewport: { width: config.width, height: 900 },
      locale: "zh-CN",
    })
    page.setDefaultTimeout(15000)
    const errors = [],
      writes = [],
      avatarRequests = new Set()
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(({ language, dark }) => {
      localStorage.setItem("monkeyai-admin-language", language)
      localStorage.setItem("theme", dark ? "dark" : "light")
    }, config)
    const groups = [
      { id: rootID, name: "全体成员" },
      ...Array.from({ length: 100 }, (_, i) => ({
        id: groupID(i),
        parent_id: rootID,
        name: `部门${String(i).padStart(3, "0")}`,
      })),
    ]
    const users = Array.from({ length: config.size }, (_, i) => ({
      id: memberID(i),
      name: `成员${String(i).padStart(5, "0")}`,
      email: `member${i}@example.com`,
      group_id: groupID(i % 100),
      avatar_url:
        i === 100
          ? null
          : i === 200
            ? "/missing-avatar.webp"
            : ` /monkeyai-logo.webp?member=${i} `,
    }))
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        pathname = url.pathname
      const json = (body) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(body),
        })
      if (pathname.startsWith("/api/")) {
        if (request.method() !== "GET") {
          assert.equal(request.method(), "POST")
          assert.equal(pathname, "/api/admin/v1/models")
          writes.push(request.postDataJSON())
          return json({
            ...writes.at(-1),
            id: "created",
            ownership_type: "system",
            user: { id: "admin", name: "管理员" },
            api_key_configured: true,
            enabled: true,
          })
        }
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
        if (pathname.endsWith("/license/status"))
          return json({ state: "valid" })
        if (
          pathname.endsWith("/version") ||
          pathname.endsWith("/version/release")
        )
          return json({ version: "1" })
        if (pathname.endsWith("/models/authorization-subjects"))
          return json({ groups, users })
        if (pathname.endsWith("/models"))
          return json({ models: [], next_cursor: null })
        if (pathname.endsWith("/users")) return json({ users: [] })
        if (pathname.endsWith("/groups"))
          return json({
            groups: groups.map((group) => ({
              ...group,
              parent_id: group.parent_id ?? null,
              member_ids: [],
              actions: group.id === rootID ? [] : ["move"],
              allow_add_members: true,
            })),
          })
        if (pathname.endsWith("/settings")) return json({ settings: [] })
        return json({ items: [] })
      }
      if (url.searchParams.has("member"))
        avatarRequests.add(url.searchParams.get("member"))
      if (pathname === "/missing-avatar.webp")
        return route.fulfill({ status: 404, body: "missing" })
      const requested = path.resolve(dist, `.${pathname}`)
      const exists =
        requested.startsWith(dist) &&
        (await stat(requested)
          .then((entry) => entry.isFile())
          .catch(() => false))
      const file = exists ? requested : path.join(dist, "index.html")
      const types = {
        ".html": "text/html; charset=utf-8",
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
    try {
      await page.goto("http://group-select.test/console/resources/models")
      await page.waitForFunction(() =>
        document.querySelector('[data-slot="dialog-trigger"]')
      )
      const dialogStart = performance.now()
      await click(page, '[data-slot="dialog-trigger"]')
      await page.waitForFunction(() =>
        document.getElementById("model-authorization")
      )
      const dialogMs = Math.round(performance.now() - dialogStart)
      await page.evaluate(() =>
        document
          .getElementById("model-authorization")
          .scrollIntoView({ block: "center" })
      )
      const openStart = performance.now()
      await click(page, "#model-authorization")
      await page.waitForFunction(() =>
        document.querySelector(
          '[data-slot="popover-content"] [data-virtual-key]'
        )
      )
      const openMs = Math.round(performance.now() - openStart)
      const initialRows = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '[data-slot="popover-content"] [data-virtual-key]'
          ),
        ].map((el) => ({
          key: JSON.parse(el.dataset.virtualKey),
          total: Number(el.getAttribute("aria-setsize")),
        }))
      )
      assert.ok(initialRows.length < 30)
      assert.ok(initialRows.every((row) => row.total === 101 + config.size))
      assert.ok(initialRows.some((row) => row.key[0] === "user"))
      await page.waitForFunction(
        (id) =>
          [...document.querySelectorAll("[data-virtual-key]")]
            .find((el) => {
              const key = JSON.parse(el.dataset.virtualKey)
              return key[0] === "group" && key[1] === id
            })
            ?.querySelector('[role="checkbox"]')
            .getAttribute("aria-checked") === "true",
        rootID
      )
      await rowAction(page, "group", rootID, "check")
      await waitUser(page, memberID(0))
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-slot="avatar-image"]')].some(
          (img) => img.src.includes("member=0")
        )
      )
      const avatars = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '[data-slot="popover-content"] [data-virtual-key]'
          ),
        ]
          .filter((el) => JSON.parse(el.dataset.virtualKey)[0] === "user")
          .map((el) => ({
            id: JSON.parse(el.dataset.virtualKey)[2],
            size: parseFloat(
              getComputedStyle(el.querySelector('[data-slot="avatar"]')).width
            ),
            fallback: !!el.querySelector('[data-slot="avatar-fallback"] img'),
          }))
      )
      assert.ok(avatars.every((avatar) => avatar.size === 20))
      assert.equal(
        avatars.find((avatar) => avatar.id === memberID(100))?.fallback,
        true
      )
      await page.waitForFunction(() => {
        const row = [...document.querySelectorAll("[data-virtual-key]")].find(
          (el) => JSON.parse(el.dataset.virtualKey)[2] === "u00200"
        )
        return row?.querySelector('[data-slot="avatar-fallback"] img')
      })
      const selectStart = performance.now()
      await rowAction(page, "user", memberID(0), "check")
      await page.waitForFunction(() =>
        document
          .getElementById("model-authorization")
          .textContent.includes("成员00000")
      )
      const selectMs = Math.round(performance.now() - selectStart)
      await page.waitForFunction(
        (id) =>
          [...document.querySelectorAll("[data-virtual-key]")]
            .find((el) => {
              const key = JSON.parse(el.dataset.virtualKey)
              return key[0] === "group" && key[1] === id
            })
            ?.querySelector('[role="checkbox"]')
            .getAttribute("aria-checked") === "mixed",
        rootID
      )
      await rowAction(page, "group", groupID(0), "expand")
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll("[data-virtual-key]")].some((el) => {
            const key = JSON.parse(el.dataset.virtualKey)
            return key[0] === "user" && key[1] === "g000"
          })
        ),
        false
      )
      await rowAction(page, "group", groupID(0), "expand")
      await waitUser(page, memberID(0))
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("[data-virtual-key]")]
            .find((el) => JSON.parse(el.dataset.virtualKey)[2] === "u00000")
            ?.querySelector('[role="checkbox"]')
            .getAttribute("aria-checked") === "true"
      )
      for (const query of [
        "chengyuan00000",
        "cy00000",
        "member0@example.com",
      ]) {
        await fill(page, search, query)
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-slot="popover-content"] li')
              ?.getAttribute("aria-setsize") === "3"
        )
        await waitUser(page, memberID(0))
      }
      await fill(page, search, `member${config.size - 1}@example.com`)
      await waitUser(page, memberID(config.size - 1))
      await rowAction(page, "user", memberID(config.size - 1), "check")
      await fill(page, search, "")
      await waitUser(page, memberID(0))
      await rowAction(page, "user", memberID(0), "focus")
      await page.keyboard.press("ArrowDown")
      await page.waitForFunction(
        () =>
          JSON.parse(
            document.activeElement.closest("[data-virtual-key]")?.dataset
              .virtualKey || "[]"
          )[2] === "u00100"
      )
      await page.keyboard.press("ArrowUp")
      await page.waitForFunction(
        () =>
          JSON.parse(
            document.activeElement.closest("[data-virtual-key]")?.dataset
              .virtualKey || "[]"
          )[2] === "u00000"
      )
      await page.evaluate(() => {
        const el = document.querySelector(
          '[data-slot="popover-content"] [data-slot="scroll-area-viewport"]'
        )
        el.scrollTop = el.scrollHeight
      })
      await waitUser(page, memberID(config.size - 1))
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(
              document.activeElement.closest("[data-virtual-key]").dataset
                .virtualKey
            )[2]
        ),
        memberID(0)
      )
      await page.keyboard.press("End")
      await page.waitForFunction(
        (id) =>
          JSON.parse(
            document.activeElement.closest("[data-virtual-key]")?.dataset
              .virtualKey || "[]"
          )[2] === id,
        memberID(config.size - 1)
      )
      await page.keyboard.press("Home")
      await page.waitForFunction(
        (id) =>
          JSON.parse(
            document.activeElement.closest("[data-virtual-key]")?.dataset
              .virtualKey || "[]"
          )[1] === id,
        rootID
      )
      await page.keyboard.press("Tab")
      await page.keyboard.press("Tab")
      await page.keyboard.press("Shift+Tab")
      await page.keyboard.press("Space")
      await page.waitForFunction(() =>
        document
          .getElementById("model-authorization")
          .textContent.includes("全体成员")
      )
      await fill(page, search, "member0@example.com")
      await waitUser(page, memberID(0))
      assert.equal(
        await page.evaluate(() => {
          const row = [...document.querySelectorAll("[data-virtual-key]")].find(
            (el) => JSON.parse(el.dataset.virtualKey)[2] === "u00000"
          )
          const checkbox = row.querySelector('[role="checkbox"]')
          return (
            checkbox.getAttribute("aria-checked") === "true" &&
            (checkbox.hasAttribute("disabled") ||
              checkbox.hasAttribute("data-disabled") ||
              checkbox.getAttribute("aria-disabled") === "true")
          )
        }),
        true
      )
      await rowAction(page, "group", rootID, "check")
      for (let i = 0; i < 4; i++) {
        await fill(page, search, `member${i}@example.com`)
        await waitUser(page, memberID(i))
        await rowAction(page, "user", memberID(i), "check")
      }
      await page.waitForFunction(() =>
        document.getElementById("model-authorization").textContent.includes("4")
      )
      assert.ok((await page.textContent("#model-authorization")).length < 80)
      await fill(page, search, "")
      await waitUser(page, memberID(0))
      await rowAction(page, "group", groupID(0), "expand")
      await click(page, "#model-authorization")
      await page.waitForFunction(
        () => !document.querySelector('[data-slot="popover-content"]')
      )
      await click(page, "#model-authorization")
      await page.waitForFunction(() =>
        document.querySelector(
          '[data-slot="popover-content"] [data-virtual-key]'
        )
      )
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll("[data-virtual-key]")].some((el) => {
            const key = JSON.parse(el.dataset.virtualKey)
            return key[0] === "user" && key[1] === "g000"
          })
        ),
        false
      )
      await rowAction(page, "group", groupID(0), "check")
      const bounds = await page.evaluate(() => {
        const popup = document.querySelector('[data-slot="popover-content"]'),
          rect = popup.getBoundingClientRect()
        const viewport = popup.querySelector(
          '[data-slot="scroll-area-viewport"]'
        )
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          listOverflow: viewport.scrollWidth - viewport.clientWidth,
          rows: popup.querySelectorAll("[data-virtual-key]").length,
        }
      })
      assert.ok(
        bounds.left >= 0 &&
          bounds.right <= config.width + 1 &&
          bounds.top >= 0 &&
          bounds.bottom <= 901,
        JSON.stringify(bounds)
      )
      assert.equal(bounds.pageOverflow, 0)
      assert.equal(bounds.listOverflow, 0)
      assert.ok(bounds.rows < 30)
      assert.ok(
        avatarRequests.size < 100,
        `Avatar requests should be bounded: ${avatarRequests.size}`
      )
      await page.waitForTimeout(200)
      await page.screenshot({
        path: `/tmp/monkeyai-group-select-${config.size}-${config.width}-${config.language}-${(await browser.version()).split(".")[0]}.png`,
      })
      await click(page, "#model-authorization")
      for (const [id, value] of [
        ["model-id", "test-model"],
        ["model-display-name", "测试模型"],
        ["model-base-url", "https://models.example.com/v1"],
        ["model-api-key", "test-key"],
        ["model-context-size", "256"],
        ["model-max-output-tokens", "16384"],
        ["model-multiplier", "1"],
      ])
        await fill(page, `#${id}`, value)
      await click(page, '[data-slot="dialog-content"] button[type="submit"]')
      await page.waitForFunction(() => !document.getElementById("model-id"))
      assert.equal(writes.length, 1)
      assert.deepEqual(writes[0].authorization.group_ids, [groupID(0)])
      assert.deepEqual([...writes[0].authorization.user_ids].sort(), [
        memberID(1),
        memberID(2),
        memberID(3),
      ])
      if (config.size === 1000 && config.width === 1440) {
        await page.goto("http://group-select.test/console/settings/members")
        await page.waitForFunction(() =>
          document.querySelector(
            '[data-virtual-key="group:g000"] button[aria-haspopup="menu"]'
          )
        )
        await click(
          page,
          '[data-virtual-key="group:g000"] button[aria-haspopup="menu"]'
        )
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[role="menuitem"]')].some((el) =>
            el.textContent.includes("移动分组")
          )
        )
        await page.evaluate(() =>
          [...document.querySelectorAll('[role="menuitem"]')]
            .find((el) => el.textContent.includes("移动分组"))
            .click()
        )
        await page.waitForFunction(() =>
          document.getElementById("group-parent-select")
        )
        await click(page, "#group-parent-select")
        await page.waitForFunction(() =>
          document.querySelector(
            '[data-slot="popover-content"] [role="radio"]:not([data-disabled])'
          )
        )
        await page.evaluate(() =>
          document
            .querySelector(
              '[data-slot="popover-content"] [role="radio"]:not([data-disabled])'
            )
            .focus()
        )
        await page.keyboard.press("End")
        await page.waitForFunction(
          () => !document.querySelector('[data-slot="popover-content"]')
        )
        assert.ok(
          (await page.textContent("#group-parent-select")).includes("部门099")
        )
        await click(page, "#group-parent-select")
        await page.waitForFunction(() =>
          document.querySelector(
            '[data-slot="popover-content"] [role="radio"][aria-checked="true"]'
          )
        )
        assert.ok(
          await page.evaluate(() => {
            const el = document.querySelector(
              '[data-slot="popover-content"] [role="radio"][aria-checked="true"]'
            )
            const a = el.getBoundingClientRect(),
              v = el
                .closest('[data-slot="scroll-area-viewport"]')
                .getBoundingClientRect()
            return a.top >= v.top && a.bottom <= v.bottom + 1
          })
        )
        await fill(page, search, "部门000")
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-slot="popover-content"] li')
              ?.getAttribute("aria-setsize") === "2"
        )
        assert.equal(
          await page.evaluate(() =>
            document.querySelector(
              '[data-slot="popover-content"] [role="radio"]:not([data-disabled])'
            )
          ),
          null
        )
        assert.ok(
          (await page.textContent("#group-parent-select")).includes("部门099")
        )
        assert.equal(writes.length, 1)
      }
      assert.deepEqual(errors, [])
      console.log(
        JSON.stringify({
          ...config,
          dialogMs,
          openMs,
          selectMs,
          initialRows: initialRows.length,
          finalRows: bounds.rows,
          avatarRequests: avatarRequests.size,
        })
      )
    } catch (error) {
      console.error(
        await page.evaluate(() => {
          const dialog = document.querySelector('[data-slot="dialog-content"]'),
            s = dialog && getComputedStyle(dialog),
            r = dialog?.getBoundingClientRect()
          return {
            dir: document.documentElement.dir,
            scrollX,
            dialog: r?.toJSON(),
            left: s?.left,
            right: s?.right,
            transform: s?.transform,
            direction: s?.direction,
          }
        })
      )
      await page.screenshot({ path: "/tmp/monkeyai-group-select-failed.png" })
      throw new Error(`${JSON.stringify(config)}: ${error.message}`, {
        cause: error,
      })
    } finally {
      await page.close()
    }
  }
  console.log("PASS group selector", await browser.version())
} finally {
  await browser.close()
}
