import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

if (!process.env.CHROME_BIN)
  throw new Error("请设置 CHROME_BIN；先执行 npm run build")
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})

try {
  for (const width of process.env.WIDTH
    ? [Number(process.env.WIDTH)]
    : [1440, 390, 320]) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      })
      await context.addInitScript((dark) => {
        localStorage.setItem("i18nextLng", "zh-CN")
        if (dark) localStorage.setItem("theme", "dark")
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              if (window.__denyCopy) throw new Error("clipboard unavailable")
              window.__copied = text
            },
          },
        })
      }, dark)
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      const users = [
        {
          id: "admin",
          name: "管理员",
          email: "admin@example.com",
          role: "admin",
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
        },
      ]
      const root = "00000000-0000-0000-0000-000000000000"
      const groups = [
        {
          id: root,
          parent_id: null,
          name: "测试团队",
          member_ids: ["admin"],
          actions: ["add-subgroup"],
          allow_add_members: true,
        },
      ]
      const writes = [],
        credentials = []
      let retryFailed = false
      let releaseSlow
      const slow = new Promise((resolve) => {
        releaseSlow = resolve
      })
      await context.route("**/*", async (route) => {
        const request = route.request(),
          endpoint = new URL(request.url()).pathname
        const json = (body, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          })
        if (endpoint.startsWith("/api/")) {
          if (request.method() === "POST" && endpoint.endsWith("/users")) {
            const input = request.postDataJSON()
            writes.push(input)
            if (input.email === "slow@example.com") await slow
            if (
              input.email === "failed@example.com" ||
              (input.email === "retry@example.com" && !retryFailed)
            ) {
              retryFailed = input.email === "retry@example.com" || retryFailed
              return json(
                {
                  error: { code: "server_error", message: "创建失败，请重试" },
                },
                500
              )
            }
            const user = {
              id: `created-${credentials.length}`,
              name: input.name,
              email: input.email,
              role: input.role,
              status: "active",
              joined_at: "2026-01-01T00:00:00Z",
            }
            const initial_password =
              input.role === "admin"
                ? input.password
                : `Aa0123456789${String(credentials.length).padStart(4, "0")}`
            users.push(user)
            groups[0].member_ids.push(user.id)
            credentials.push({ ...user, initial_password })
            if (input.email === "legacy@example.com") return json(user, 201)
            return json({ ...user, initial_password }, 201)
          }
          assert.equal(
            request.method(),
            "GET",
            `Unexpected mutation ${endpoint}`
          )
          if (endpoint.endsWith("/session"))
            return json({ authenticated: true, user: users[0] })
          if (endpoint.endsWith("/branding"))
            return json({ product_name: "百智办公" })
          if (endpoint.endsWith("/license/status"))
            return json({ state: "valid" })
          if (endpoint.endsWith("/users")) return json({ users })
          if (endpoint.endsWith("/groups")) return json({ groups })
          return json({ items: [] })
        }
        let file = path.resolve(dist, `.${endpoint}`)
        if (!file.startsWith(dist)) return route.abort()
        try {
          if (!(await stat(file)).isFile()) file = path.join(dist, "index.html")
        } catch {
          file = path.join(dist, "index.html")
        }
        const types = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".woff2": "font/woff2",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }
        return route.fulfill({
          contentType: types[path.extname(file)] || "application/octet-stream",
          body: await readFile(file),
        })
      })

      await page.goto("http://member.test/console/settings/members")
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        dark
      )
      const dialog = page.getByRole("dialog")
      const open = async () => {
        await page
          .getByRole("button", { name: "添加成员", exact: true })
          .click()
        await dialog.waitFor()
      }
      const results = () =>
        dialog.getByRole("region", { name: "创建结果", exact: true })
      const checkCredentials = async (expected) => {
        await results().getByRole("listitem").last().waitFor()
        assert.equal(
          await results().getByRole("listitem").count(),
          expected.length
        )
        const fields = await results().evaluate((root) =>
          [...root.querySelectorAll('[role="listitem"]')].map((row) => {
            const input = row.querySelector("input")
            const button = row.querySelector("button")
            const field = input.getBoundingClientRect()
            const copy = button.getBoundingClientRect()
            return {
              text: row.innerText,
              value: input.value,
              type: input.type,
              readOnly: input.readOnly,
              buttonText: button.innerText.trim(),
              buttonLabel: button.getAttribute("aria-label"),
              copyInside:
                copy.left >= field.left &&
                copy.right <= field.right + 1 &&
                copy.top >= field.top &&
                copy.bottom <= field.bottom + 1,
            }
          })
        )
        for (const [index, member] of expected.entries()) {
          const field = fields[index]
          const characters = Array.from(member.initial_password)
          assert(field.text.includes(member.email))
          assert(!field.text.includes(member.initial_password))
          assert(!field.text.includes("初始密码"))
          assert.equal(field.type, "text")
          assert(field.readOnly)
          assert.equal(field.value.slice(0, 4), characters.slice(0, 4).join(""))
          assert.equal(field.value.slice(-4), characters.slice(-4).join(""))
          assert.match(field.value.slice(4, -4), /^•+$/)
          assert.notEqual(field.value, member.initial_password)
          assert.equal(field.buttonText, "")
          assert.equal(field.buttonLabel, `复制密码 (${member.email})`)
          assert(field.copyInside)
        }
        assert.equal(
          await dialog
            .getByText(
              "初始密码仅本次显示，请复制后交给成员。关闭后可通过重置密码生成新密码。",
              { exact: true }
            )
            .count(),
          0
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
      }
      const checkCleared = async () => {
        await dialog
          .locator('[data-slot="dialog-footer"]')
          .getByRole("button", { name: "关闭", exact: true })
          .click()
        await dialog.waitFor({ state: "hidden" })
        for (const member of credentials)
          assert.equal(
            await page
              .getByText(member.initial_password, { exact: true })
              .count(),
            0
          )
        await open()
        assert.equal(await results().count(), 0)
        assert.equal(await dialog.locator("#new-user-password").count(), 0)
        const storage = await page.evaluate(() =>
          JSON.stringify({
            local: { ...localStorage },
            session: { ...sessionStorage },
          })
        )
        for (const member of credentials)
          assert(!storage.includes(member.initial_password))
      }

      await open()
      await dialog.locator("#new-user-name").fill("单个成员")
      await dialog.locator("#new-user-email").fill("failed@example.com")
      await dialog.getByRole("button", { name: "创建", exact: true }).click()
      await page.getByText("创建失败，请重试", { exact: true }).waitFor()
      assert.equal(await results().count(), 0)
      assert.equal(
        await dialog.locator("#new-user-email").inputValue(),
        "failed@example.com"
      )
      await dialog.locator("#new-user-email").fill("slow@example.com")
      await dialog.getByRole("button", { name: "创建", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('button[type="submit"]').disabled
      )
      await page.keyboard.press("Escape")
      assert(await dialog.isVisible())
      assert(
        await dialog
          .getByRole("button", { name: "取消", exact: true })
          .isDisabled()
      )
      releaseSlow()
      await results().waitFor()
      await checkCredentials(credentials.slice(0, 1))
      const copyPasswordButton = dialog.getByRole("button", {
        name: "复制密码 (slow@example.com)",
        exact: true,
      })
      await copyPasswordButton.hover()
      const beforePress = await copyPasswordButton.boundingBox()
      await page.mouse.down()
      await page.waitForTimeout(180)
      const duringPress = await copyPasswordButton.boundingBox()
      assert(
        Math.abs(duringPress.y - beforePress.y) <= 1.25,
        "copy button must retain vertical centering while pressed"
      )
      await page.mouse.up()
      await page.waitForFunction(() => window.__copied)
      assert.equal(
        await page.evaluate(() => window.__copied),
        credentials[0].initial_password
      )
      await page.evaluate(() => {
        window.__denyCopy = true
      })
      await dialog
        .getByRole("button", { name: "复制全部", exact: true })
        .click()
      await page
        .getByText("复制失败，请手动选择密码。", { exact: true })
        .waitFor()
      assert(await results().isVisible())
      await page.evaluate(() => {
        window.__denyCopy = false
      })
      await checkCleared()

      await dialog.locator("#new-user-role").click()
      await page.getByRole("option", { name: "管理员", exact: true }).click()
      await dialog.locator("#new-user-name").fill("新管理员")
      await dialog.locator("#new-user-email").fill("new-admin@example.com")
      await dialog
        .locator("#new-user-password")
        .fill("PreservedAdminPassword!123")
      await dialog.getByRole("button", { name: "创建", exact: true }).click()
      await results().waitFor()
      await checkCredentials(credentials.slice(1, 2))
      assert.equal(
        credentials[1].initial_password,
        "PreservedAdminPassword!123"
      )
      await checkCleared()

      await dialog.getByRole("tab", { name: "添加多个", exact: true }).click()
      await dialog
        .locator("#bulk-member-emails")
        .fill("first@example.com\nretry@example.com\nlast@example.com")
      await dialog.getByRole("button", { name: "下一步", exact: true }).click()
      await dialog
        .getByRole("button", { name: "添加 3 位成员", exact: true })
        .click()
      await dialog.getByText("待重试成员", { exact: true }).waitFor()
      const beforeRetry = credentials.slice(2)
      await checkCredentials(beforeRetry)
      assert.equal(
        await dialog
          .locator('input[type="email"]')
          .filter({ visible: true })
          .count(),
        1
      )
      assert.equal(await dialog.getByRole("tab").count(), 0)
      await dialog
        .getByRole("button", { name: "复制全部", exact: true })
        .click()
      const copiedBefore = await page.evaluate(() => window.__copied)
      assert(copiedBefore.includes(beforeRetry[0].initial_password))
      assert(copiedBefore.includes(beforeRetry[1].initial_password))
      await dialog
        .getByRole("button", { name: "重试 1 位成员", exact: true })
        .click()
      await dialog
        .getByRole("button", { name: "重试 1 位成员", exact: true })
        .waitFor({ state: "hidden" })
      await checkCredentials(credentials.slice(2))
      assert.equal(
        writes.filter((input) => input.email === "first@example.com").length,
        1
      )
      assert.equal(
        writes.filter((input) => input.email === "last@example.com").length,
        1
      )
      assert.equal(
        writes.filter((input) => input.email === "retry@example.com").length,
        2
      )
      await dialog
        .getByRole("button", { name: "复制全部", exact: true })
        .click()
      const copiedAll = await page.evaluate(() => window.__copied)
      for (const member of credentials.slice(2))
        assert(
          copiedAll.includes(`${member.email}\t${member.initial_password}`)
        )
      await checkCleared()

      // Reopening must start a fresh batch, without the previous results or drafts.
      await dialog.getByRole("tab", { name: "添加多个", exact: true }).click()
      assert.equal(await dialog.locator("#bulk-member-emails").inputValue(), "")
      const count = 50
      await dialog
        .locator("#bulk-member-emails")
        .fill(
          Array.from({ length: count }, (_, i) => `batch${i}@example.com`).join(
            "\n"
          )
        )
      await dialog.getByRole("button", { name: "下一步", exact: true }).click()
      await dialog
        .getByRole("button", { name: `添加 ${count} 位成员`, exact: true })
        .click()
      await results().getByRole("listitem").nth(count - 1).waitFor()
      await checkCredentials(credentials.slice(-count))
      const scrolling = await results()
        .getByRole("list")
        .evaluate((element) => {
          element.scrollTop = element.scrollHeight
          return {
            height: element.getBoundingClientRect().height,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            scrollTop: element.scrollTop,
          }
        })
      assert(scrolling.height <= 362, JSON.stringify(scrolling))
      assert(scrolling.scrollHeight > scrolling.clientHeight)
      assert(scrolling.scrollTop > 0)
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden" })

      await open()
      await dialog.getByRole("tab", { name: "添加一个", exact: true }).click()
      await dialog.locator("#new-user-name").fill("旧服务响应")
      await dialog.locator("#new-user-email").fill("legacy@example.com")
      await dialog.getByRole("button", { name: "创建", exact: true }).click()
      await dialog
        .getByText("服务未返回初始密码，请通过重置密码获取新密码。", {
          exact: true,
        })
        .waitFor()
      assert.equal(await results().locator("input[readonly]").inputValue(), "")
      assert(await results().locator("input[readonly]").isDisabled())
      assert(
        await dialog
          .getByRole("button", {
            name: "复制密码 (legacy@example.com)",
            exact: true,
          })
          .isDisabled()
      )
      assert(
        await dialog
          .getByRole("button", { name: "复制全部", exact: true })
          .isDisabled()
      )
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden" })
      assert.deepEqual(errors, [])
      console.log(
        `PASS member creation ${width} ${dark ? "dark" : "light"}: single/admin passwords, pending lock, copy/failure, partial retry, result retention/cleanup, 50-member scroll and missing legacy password`
      )
      await context.close()
    }
  }
} finally {
  await browser.close()
}
