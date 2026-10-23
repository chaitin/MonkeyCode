import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const executablePath = process.env.CHROME_BIN
if (!executablePath)
  throw new Error(
    "请设置 CHROME_BIN，指向待验证的 Chrome/Chromium 可执行文件；先执行 pnpm build"
  )
const baseURL = process.env.ADMIN_DEV_URL || "http://admin.test"
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  let authenticated = false
  const authentication = {
    password_enabled: true,
    email_code_enabled: true,
    email_code_auto_registration_enabled: false,
    oauth_connections: [],
  }
  let authenticationWrites = 0
  let releaseAuthentication
  let holdAuthentication = false
  let failAuthentication = false
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: `entry-${i}`,
    occurred_at: "2026-10-19T12:34:56Z",
    entry_type: "charge",
    category: "model",
    user_name: `用户 ${i}`,
    user_id: null,
    item_name: "测试模型",
    credit_delta: "-1",
    balance_after: "100",
    mode: "local",
  }))
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    if (p === "/downloads.json")
      return route.fulfill({ json: { windows: "/downloads/windows.zip" } })
    if (p.startsWith("/api/")) {
      let body = {}
      if (p.endsWith("/session"))
        body = {
          authenticated,
          user: authenticated
            ? { id: "admin", name: "管理员", role: "admin", status: "active" }
            : null,
        }
      else if (p.endsWith("/branding")) body = { product_name: "MonkeyAI" }
      else if (p.endsWith("/license/status")) body = { state: "valid" }
      else if (p.endsWith("/settings"))
        body = { settings: [{ key: "authentication", value: authentication }] }
      else if (p.endsWith("/settings/authentication")) {
        authenticationWrites++
        if (holdAuthentication)
          await new Promise((resolve) => {
            releaseAuthentication = resolve
          })
        if (failAuthentication) {
          failAuthentication = false
          return route.fulfill({
            status: 503,
            json: { error: { message: "保存测试失败" } },
          })
        }
        Object.assign(authentication, route.request().postDataJSON().value)
        body = { value: authentication }
      } else if (p.endsWith("/tags")) body = { items: [] }
      else if (p.endsWith("/clients/overview"))
        body = {
          metric: "sessions",
          total: 10,
          distributions: {
            client_type: [{ value: "desktop", count: 10 }],
            platform: [{ value: "windows", count: 10 }],
            client_version: [{ value: "1.0", count: 10 }],
          },
        }
      else if (p.endsWith("/session-reporting/clients"))
        body = { items: [], next_cursor: null }
      else if (p.endsWith("/billing/entries"))
        body = {
          items: rows,
          total: 3,
          page: 1,
          page_size: Number(url.searchParams.get("page_size") || 50),
        }
      return route.fulfill({ json: body })
    }
    if (process.env.ADMIN_DEV_URL) return route.continue()
    const requested = path.resolve(dist, `.${p}`)
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

  await page.goto(`${baseURL}/`)
  await page.waitForFunction(() =>
    document.querySelector('a[href="/downloads/windows.zip"]')
  )
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.querySelector("header > div")).display
    ),
    "flex"
  )
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(255, 255, 255)"
  )
  const ids = await page.evaluate(() =>
    Array.from({ length: 50 }, () => crypto.randomUUID())
  )
  assert.equal(new Set(ids).size, 50)

  authenticated = true
  await page.goto(`${baseURL}/console/billing/details`)
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 3
  )
  for (const dark of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value),
      dark
    )
    await page.waitForTimeout(300)
    const metrics = await page.evaluate(() => ({
      header: document.querySelector("thead tr").getBoundingClientRect().height,
      rows: Array.from(
        document.querySelectorAll("tbody tr"),
        (tr) => tr.getBoundingClientRect().height
      ),
      background: getComputedStyle(document.body).backgroundColor,
      border: getComputedStyle(document.querySelector("tbody tr"))
        .borderBottomWidth,
    }))
    assert.equal(metrics.header, 48)
    assert.deepEqual(metrics.rows, [48, 48, 48])
    assert.equal(metrics.border, "1px")
    assert.equal(
      metrics.background,
      dark ? "rgb(10, 10, 10)" : "rgb(255, 255, 255)"
    )
  }
  // Exercise a real select popup without relying on newer browser APIs in locator engines.
  const point = await page.evaluate(() => {
    const r = document
      .querySelector('[data-slot="table-pagination"] [role="combobox"]')
      .getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.click(point.x, point.y)
  await page.waitForFunction(
    () => document.querySelectorAll('[role="option"]').length === 5
  )
  assert.deepEqual(
    await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[role="option"]'),
        (el) => el.textContent
      )
    ),
    ["20 条 / 页", "50 条 / 页", "100 条 / 页", "200 条 / 页", "500 条 / 页"]
  )
  await page.keyboard.press("Escape")

  const datePoint = await page.evaluate(() => {
    const r = document.querySelector("#billing-from").getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.click(datePoint.x, datePoint.y)
  await page.waitForFunction(() => document.querySelector("button[data-day]"))
  assert.ok(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("button[data-day]")).every(
        (el) => el.getBoundingClientRect().height >= 28
      )
    )
  )
  await page.keyboard.press("Escape")

  // :has() must react to attribute changes, not only the first render.
  await page.evaluate(() => {
    const probe = document.createElement("div")
    probe.id = "compat-has"
    probe.className = "grid has-[[data-slot=card-action]]:grid-cols-[1fr_auto]"
    probe.style.width = "350px"
    probe.innerHTML = '<div data-slot="card-title">标题</div><div>操作</div>'
    document.body.append(probe)
    probe.lastElementChild.setAttribute("data-slot", "card-action")
  })
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector("#compat-has")
      ).gridTemplateColumns.split(" ").length === 2,
    null,
    { timeout: 4000 }
  )
  await page.evaluate(() =>
    document
      .querySelector("#compat-has")
      .lastElementChild.removeAttribute("data-slot")
  )
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector("#compat-has")
      ).gridTemplateColumns.split(" ").length === 1
  )

  await page.evaluate(() => document.querySelector("#compat-has").remove())
  await page.goto(`${baseURL}/console/statistics/session-reporting/clients`)
  await page.waitForFunction(() =>
    document.querySelector('[role="figure"][data-container-wide]')
  )
  await page.evaluate(() => {
    document.querySelector('[role="figure"]').style.width = "350px"
  })
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="figure"] .recharts-sector').length >= 3
  )
  assert.ok(
    await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[role="figure"] [data-slot="chart"]')
      ).every((el) => el.getBoundingClientRect().height > 50)
    )
  )

  await page.waitForFunction(
    () =>
      document.querySelector('[role="figure"]').dataset.containerWide === "true"
  )
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('[role="figure"] .flex-col'))
          .flexDirection
    ),
    "row"
  )
  await page.evaluate(() => {
    document.querySelector('[role="figure"]').style.width = "315px"
  })
  await page.waitForFunction(
    () =>
      document.querySelector('[role="figure"]').dataset.containerWide ===
      "false"
  )
  await page.evaluate(() => {
    document.querySelector('[role="figure"]').style.width = "317px"
  })
  await page.waitForFunction(
    () =>
      document.querySelector('[role="figure"]').dataset.containerWide === "true"
  )
  await page.evaluate(() => {
    document.querySelector('[role="figure"]').style.width = "250px"
  })
  await page.waitForFunction(
    () =>
      document.querySelector('[role="figure"]').dataset.containerWide ===
      "false"
  )
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('[role="figure"] .flex-col'))
          .flexDirection
    ),
    "column"
  )
  await page.evaluate(() => {
    document.querySelector('[role="figure"]').style.width = ""
  })

  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${baseURL}/console/settings/other`)
  await page.waitForFunction(() =>
    document.querySelector('[role="switch"][aria-label="使用密码登录"]')
  )
  const click = async (selector) => {
    await page.evaluate(
      (selector) =>
        document.querySelector(selector).scrollIntoView({ block: "center" }),
      selector
    )
    await page.waitForTimeout(100)
    const point = await page.evaluate((selector) => {
      const r = document.querySelector(selector).getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, selector)
    await page.mouse.click(point.x, point.y)
  }
  const passwordSwitch = '[role="switch"][aria-label="使用密码登录"]'
  await page.evaluate(() => {
    window.__switchChangeCount = 0
    document.addEventListener(
      "change",
      () => window.__switchChangeCount++,
      true
    )
  })
  await click(passwordSwitch)
  await page.waitForFunction(
    () => document.querySelector('[role="alertdialog"]'),
    null,
    { timeout: 4000 }
  )
  assert.equal(
    await page.evaluate(() =>
      document
        .querySelector('[role="switch"][aria-label="使用密码登录"]')
        .getAttribute("aria-checked")
    ),
    "true"
  )
  assert.equal(authenticationWrites, 0, "opening confirmation must not save")
  holdAuthentication = true
  const saveStarted = page.waitForRequest(
    (r) =>
      new URL(r.url()).pathname.endsWith("/settings/authentication") &&
      r.method() === "PUT"
  )
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((el) => el.textContent.trim() === "关闭")
      .click()
  )
  await saveStarted
  await page.waitForFunction(() =>
    document.querySelector('[role="alertdialog"] button[aria-busy="true"]')
  )
  const pendingConfirmation = await page.evaluate(() => {
    const button = document.querySelector(
      '[role="alertdialog"] button[aria-busy="true"]'
    )
    return {
      text: button.textContent.trim(),
      disabled: button.disabled,
      spinner: getComputedStyle(button.querySelector("svg")).animationName,
    }
  })
  assert.deepEqual(pendingConfirmation, {
    text: "关闭",
    disabled: true,
    spinner: "spin",
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="switch"]')].every(
      (el) => el.getAttribute("aria-disabled") === "true" || el.disabled
    )
  )
  await page.evaluate(() =>
    document.querySelector('[role="switch"][aria-label="使用密码登录"]').click()
  )
  assert.equal(authenticationWrites, 1)
  assert.equal(
    await page.evaluate(() => window.__switchChangeCount),
    1,
    "disabled Switch must not dispatch another change"
  )
  holdAuthentication = false
  releaseAuthentication()
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="alertdialog"]') &&
      document
        .querySelector('[role="switch"][aria-label="使用密码登录"]')
        .getAttribute("aria-checked") === "false"
  )
  await page.evaluate(() =>
    document.querySelector('[role="switch"][aria-label="使用密码登录"]').focus()
  )
  await page.keyboard.press("Space")
  await page.waitForFunction(
    () => document.querySelector('[role="alertdialog"]'),
    null,
    { timeout: 4000 }
  )
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((el) => el.textContent.trim() === "取消")
      .click()
  )
  await page.waitForFunction(
    () => !document.querySelector('[role="alertdialog"]')
  )
  assert.equal(authenticationWrites, 1, "cancel must not save")

  await click(passwordSwitch)
  await page.waitForFunction(() =>
    document.querySelector('[role="alertdialog"]')
  )
  const confirmationSelector =
    '[role="alertdialog"] [data-slot="alert-dialog-action"]'
  const confirmationLabel = await page.evaluate(
    (selector) => document.querySelector(selector).textContent.trim(),
    confirmationSelector
  )
  holdAuthentication = true
  failAuthentication = true
  const failureStarted = page.waitForRequest(
    (r) =>
      new URL(r.url()).pathname.endsWith("/settings/authentication") &&
      r.method() === "PUT"
  )
  await click(confirmationSelector)
  await failureStarted
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("aria-busy") === "true",
    confirmationSelector
  )
  assert.equal(
    await page.evaluate(
      (selector) => document.querySelector(selector).textContent.trim(),
      confirmationSelector
    ),
    confirmationLabel
  )
  holdAuthentication = false
  releaseAuthentication()
  await page.waitForFunction((selector) => {
    const button = document.querySelector(selector)
    return button && !button.disabled && !button.querySelector("svg")
  }, confirmationSelector)
  assert.equal(
    await page.evaluate(
      (selector) => document.querySelector(selector).textContent.trim(),
      confirmationSelector
    ),
    confirmationLabel
  )
  assert.equal(
    await page.evaluate(
      (selector) =>
        document.querySelector(selector).getAttribute("aria-checked"),
      passwordSwitch
    ),
    "false"
  )
  await click(confirmationSelector)
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="alertdialog"]') &&
      document
        .querySelector('[role="switch"][aria-label="使用密码登录"]')
        .getAttribute("aria-checked") === "true"
  )
  assert.equal(
    authenticationWrites,
    3,
    "one failed save and one successful retry"
  )
  assert.deepEqual(errors, [])
  console.log(
    `${await browser.version()}: homepage, HTTP UUID, dark/light table, select, dynamic :has(), container resize, mobile and Switch mouse/keyboard plus confirmation label/Loader/disabled/failure/retry checks passed`
  )
} finally {
  await browser.close()
}
