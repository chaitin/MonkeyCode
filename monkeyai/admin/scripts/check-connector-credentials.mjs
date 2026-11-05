import assert from "node:assert/strict"
import { readFile, stat, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

if (!process.env.CHROME_BIN)
  throw new Error("Set CHROME_BIN and build admin first")
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox"],
})
try {
  for (const width of process.env.WIDTH
    ? [Number(process.env.WIDTH)]
    : [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const errors = [],
      writes = [],
      rows = new Map(),
      credentials = new Map()
    let failCredential = false,
      blockedPopup = false,
      authRequest = null,
      authSequence = 0
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => {
      window.structuredClone = undefined
      Intl.Segmenter = undefined
    })
    const credential = (id, name) => ({
      id: `credential-${id}`,
      connector_id: id,
      name,
      revision: 1,
      user: null,
      authorization_status: "authorized",
      connection_status: "connected",
      header_names: ["Authorization"],
      last_error: null,
    })
    const row = (id, name, origin = "admin") => ({
      id,
      name,
      origin,
      revision: 1,
      config_revision: 1,
      ownership_type: "system",
      enabled: true,
      user: { id: "admin", name: "管理员", email: "admin@example.test" },
      url: "https://mcp.example.test/mcp",
      description: "连接器说明",
      grants: [],
      tags: [],
      credentials: [],
      authorization_mode: "centralized",
      authorization_method: "http_header",
      oauth_config: {},
      callback_url: "",
      icon_path: "",
    })
    rows.set("package", row("package", "资源包连接器", "package"))
    credentials.set("package", credential("package", "包凭证"))
    const view = (item) => ({
      ...item,
      credentials: credentials.has(item.id)
        ? [{ ...credentials.get(item.id) }]
        : [],
    })
    const writeCredential = (item, change, current) => {
      if (!change) return current
      assert.equal(item.authorization_mode, "centralized")
      if (current) {
        assert.equal(change.id, current.id)
        assert.equal(change.revision, current.revision)
      } else assert(!change.id)
      if (change.revoke) return undefined
      const saved = {
        ...(current ?? credential(item.id, change.name)),
        name: change.name ?? current?.name,
        revision: current ? current.revision + 1 : 1,
      }
      if (change.http_headers) {
        assert.equal(item.authorization_method, "http_header")
        saved.header_names = Object.keys(change.http_headers)
        saved.authorization_status = "authorized"
        saved.connection_status = "connected"
      } else if (!current) {
        saved.header_names = []
        saved.authorization_status = "authorization_required"
        saved.connection_status = "unknown"
      }
      return saved
    }
    await context.route("**/*", async (route) => {
      const request = route.request(),
        endpoint = new URL(request.url()).pathname,
        method = request.method()
      const json = (body, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        })
      if (endpoint === "/mock-oauth")
        return route.fulfill({
          contentType: "text/html",
          body: "OAuth fixture",
        })
      if (endpoint.startsWith("/api/")) {
        const matchConnector = endpoint.match(/\/connectors\/([^/]+)$/)
        const matchCredentials = endpoint.match(
          /\/connectors\/([^/]+)\/credentials(?:\/([^/]+))?$/
        )
        const matchOAuth = endpoint.match(
          /\/connectors\/([^/]+)(?:\/credentials\/([^/]+))?\/oauth\/authorizations$/
        )
        const matchGrant = endpoint.match(
          /\/resources\/connector\/([^/]+)\/grants$/
        )
        if (method !== "GET")
          writes.push({
            method,
            endpoint,
            body: request.postData() ? request.postDataJSON() : null,
            version: request.headers()["if-match"],
          })
        if (method === "POST" && endpoint.endsWith("/connectors")) {
          const { credential: change, ...body } = request.postDataJSON(),
            id = `new-${rows.size}`
          if (change && failCredential) {
            failCredential = false
            return json(
              { error: { code: "test_failure", message: "凭证保存失败测试" } },
              500
            )
          }
          const saved = { ...row(id, body.name), ...body, tags: [] }
          const current = writeCredential(saved, change, undefined)
          rows.set(id, saved)
          if (current) credentials.set(id, current)
          return json(view(saved))
        }
        if (matchConnector) {
          const item = rows.get(matchConnector[1])
          assert(item, endpoint)
          if (method === "PUT") {
            assert.equal(request.headers()["if-match"], `"${item.revision}"`)
            const { credential: change, ...body } = request.postDataJSON()
            if (change && failCredential) {
              failCredential = false
              return json(
                {
                  error: { code: "test_failure", message: "凭证保存失败测试" },
                },
                500
              )
            }
            const candidate = {
              ...item,
              ...body,
              tags: [],
              revision: item.revision + 1,
            }
            const changed = [
              "url",
              "authorization_mode",
              "authorization_method",
              "oauth_config",
            ].some(
              (key) =>
                key in body &&
                JSON.stringify(body[key]) !== JSON.stringify(item[key])
            )
            let current = credentials.has(item.id)
              ? { ...credentials.get(item.id) }
              : undefined
            if (changed) {
              candidate.config_revision++
              if (current)
                current.authorization_status = "authorization_required"
              if (candidate.authorization_mode !== item.authorization_mode)
                current = undefined
            }
            current = writeCredential(candidate, change, current)
            Object.assign(item, candidate)
            if (current) credentials.set(item.id, current)
            else credentials.delete(item.id)
          } else assert.equal(method, "GET")
          return json(view(item))
        }
        if (matchGrant) {
          const item = rows.get(matchGrant[1])
          assert.equal(request.headers()["if-match"], `"${item.revision}"`)
          item.grants = request.postDataJSON().grants
          item.revision++
          return json({ grants: item.grants, revision: item.revision })
        }
        if (matchCredentials) {
          const id = matchCredentials[1],
            current = credentials.get(id)
          if (method === "GET") return json({ items: current ? [current] : [] })
          assert.fail("Admin credential writes must use POST/PUT connectors")
        }
        if (matchOAuth) {
          assert.equal(method, "POST")
          const id = matchOAuth[1],
            current = credentials.get(id)
          if (current)
            assert.equal(request.headers()["if-match"], `"${current.revision}"`)
          rows.get(id).revision++ // Dynamic registration updates the connector before the callback.
          authRequest = {
            id: `authorization-${++authSequence}`,
            connectorID: id,
            name: current?.name ?? request.postDataJSON().name,
          }
          return json({
            id: authRequest.id,
            authorization_url: "http://connector.test/mock-oauth",
          })
        }
        if (endpoint.includes("/connector-authorizations/")) {
          assert(authRequest)
          const id = authRequest.connectorID,
            current = credentials.get(id)
          const saved = {
            ...credential(id, authRequest.name),
            revision: current ? current.revision + 1 : 1,
          }
          credentials.set(id, saved)
          return json({ status: "succeeded", credential_id: saved.id })
        }
        if (/\/credentials\/[^/]+\/test$/.test(endpoint)) return json({})
        if (endpoint.endsWith("/connectors"))
          return json({
            items: [...rows.values()].map(view),
            next_cursor: null,
          })
        if (endpoint.endsWith("/session"))
          return json({
            authenticated: true,
            user: {
              id: "admin",
              name: "管理员",
              role: "admin",
              status: "active",
            },
          })
        if (endpoint.endsWith("/branding"))
          return json({ product_name: "百智办公" })
        if (endpoint.endsWith("/license/status"))
          return json({ state: "valid" })
        if (endpoint.endsWith("/authorization-subjects"))
          return json({
            groups: [{ id: "root", name: "根分组", parent_id: null }],
            users: [],
          })
        return json({ items: [], groups: [], users: [], settings: [] })
      }
      const candidate = path.resolve(dist, `.${endpoint}`)
      const exists =
        candidate.startsWith(dist) &&
        (await stat(candidate)
          .then((info) => info.isFile())
          .catch(() => false))
      const file = exists ? candidate : path.join(dist, "index.html")
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
      }
      return route.fulfill({
        contentType: types[path.extname(file)] ?? "application/octet-stream",
        body: await readFile(file),
      })
    })
    await page.goto("http://connector.test/console/resources/tools")
    if (process.env.DARK === "1")
      await page.evaluate(() => document.documentElement.classList.add("dark"))
    const dialog = () =>
      page.getByRole("dialog", { name: /^(添加|修改)连接器$/ })
    const choose = async (id, label) => {
      await dialog().locator(id).click()
      await page.getByRole("option", { name: label, exact: true }).click()
      await page
        .getByRole("option", { name: label, exact: true })
        .waitFor({ state: "hidden" })
    }
    const create = async () => {
      await page
        .getByRole("button", { name: "添加连接器", exact: true })
        .click()
      await dialog().waitFor()
    }
    const edit = async (name) => {
      await page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByTitle(name, { exact: true }) })
        .getByRole("button", { name: "更多", exact: true })
        .click()
      assert.equal(
        await page
          .getByRole("menuitem", { name: "管理凭证", exact: true })
          .count(),
        0
      )
      await page.getByRole("menuitem", { name: "修改", exact: true }).click()
      await dialog().waitFor()
    }
    const fillBasics = async (name) => {
      await dialog().locator("#mcp-name").fill(name)
      await dialog().locator("#mcp-description").fill("说明")
      await dialog().locator("#mcp-url").fill("https://mcp.example.test/mcp")
    }
    const submit = async () => {
      await dialog().locator('button[type="submit"]').click()
    }
    const close = async () => {
      await dialog().getByRole("button", { name: "取消", exact: true }).click()
      await dialog().waitFor({ state: "hidden" })
    }
    const layout = async () => {
      assert.equal(await page.getByRole("dialog").count(), 1)
      const data = await dialog().evaluate((el) => ({
        forms: el.querySelectorAll("form").length,
        overflow: el.scrollWidth > el.clientWidth,
      }))
      assert.equal(data.forms, 1)
      assert(!data.overflow, JSON.stringify(data))
    }

    await create()
    await fillBasics("Header 连接器")
    await choose("#mcp-authentication-mode", "集中认证")
    assert(
      (
        await dialog().locator("#mcp-authentication-protocol").innerText()
      ).includes("HTTP Header")
    )
    await dialog().locator("#credential-name").fill("团队凭证")
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .fill("initial-secret")
    assert.equal(writes.length, 0)
    await layout()
    if (process.env.SCREENSHOT_DIR) {
      await mkdir(process.env.SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({
        path: path.join(
          process.env.SCREENSHOT_DIR,
          `connector-credentials-${width}.png`
        ),
      })
    }
    failCredential = true
    await submit()
    await page.getByText("凭证保存失败测试", { exact: true }).waitFor()
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 内容", exact: true })
        .inputValue(),
      "initial-secret"
    )
    assert.equal(
      writes.filter(
        (write) =>
          write.method === "POST" && write.endpoint.endsWith("/connectors")
      ).length,
      1
    )
    assert.equal(rows.size, 1, "Failed create must not leave a connector")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const header = [...rows.values()].find(
      (item) => item.name === "Header 连接器"
    )
    assert.equal(
      writes.filter(
        (write) =>
          write.method === "POST" && write.endpoint.endsWith("/connectors")
      ).length,
      2
    )
    assert.equal(rows.size, 2)
    assert(credentials.has(header.id))

    await edit("Header 连接器")
    assert.equal(
      await dialog().locator("#credential-name").inputValue(),
      "团队凭证"
    )
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 内容", exact: true })
        .count(),
      0
    )
    const before = writes.filter((write) => write.body?.credential).length
    await dialog().locator("#mcp-description").fill("只修改说明")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert.equal(
      writes.filter((write) => write.body?.credential).length,
      before
    )

    await edit("Header 连接器")
    await dialog()
      .getByRole("checkbox", {
        name: "替换全部 Header（未勾选时保留原值）",
        exact: true,
      })
      .check()
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .fill("replacement-secret")
    await dialog()
      .getByRole("button", { name: "添加 Header", exact: true })
      .click()
    await dialog()
      .getByRole("textbox", { name: "Header 2 名称", exact: true })
      .fill("authorization")
    const beforeDuplicate = writes.length
    await submit()
    await page
      .getByText("Header 名称不能为空或重复。", { exact: true })
      .waitFor()
    assert.equal(writes.length, beforeDuplicate)
    await dialog()
      .getByRole("textbox", { name: "Header 2 名称", exact: true })
      .fill("X-API-Key")
    await dialog()
      .getByRole("textbox", { name: "Header 2 内容", exact: true })
      .fill("second-secret")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const replacement = writes.findLast(
      (write) => write.body?.credential?.http_headers
    )
    assert.equal(replacement.method, "PUT")
    assert.deepEqual(replacement.body.credential.http_headers, {
      Authorization: "replacement-secret",
      "X-API-Key": "second-secret",
    })

    await create()
    await choose("#mcp-authentication-mode", "集中认证")
    await choose("#mcp-authentication-protocol", "MCP OAuth")
    await dialog().locator("#credential-name").fill("OAuth 凭证")
    const beforeInvalid = writes.length
    await dialog()
      .getByRole("button", { name: "连接并授权", exact: true })
      .click()
    assert.equal(writes.length, beforeInvalid)
    await fillBasics("OAuth 连接器")
    await submit()
    await dialog()
      .getByRole("button", { name: "保存修改", exact: true })
      .waitFor()
    assert.equal(
      await dialog().locator("#credential-name").inputValue(),
      "OAuth 凭证"
    )
    await dialog()
      .getByRole("button", { name: "连接并授权", exact: true })
      .click()
    await dialog()
      .getByText(/已授权.*连接正常/)
      .waitFor()
    await layout()
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const oauth = [...rows.values()].find(
      (item) => item.name === "OAuth 连接器"
    )
    assert.equal(oauth.authorization_method, "oauth")
    assert.equal(
      writes.filter(
        (write) =>
          write.method === "POST" && write.endpoint.endsWith("/connectors")
      ).length,
      3
    )
    await edit("OAuth 连接器")
    await dialog().locator("#credential-name").fill("重命名 OAuth 凭证")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const rename = writes.findLast(
      (write) => write.body?.credential?.name === "重命名 OAuth 凭证"
    )
    assert.equal(rename.method, "PUT")
    assert.equal(rename.body.credential.name, "重命名 OAuth 凭证")
    assert(!rename.body.credential.http_headers)
    await edit("OAuth 连接器")
    await dialog().locator("#credential-name").fill("重新授权时更新名称")
    await page.evaluate(() => {
      window.open = () => null
    })
    blockedPopup = true
    await dialog()
      .getByRole("button", { name: "重新授权", exact: true })
      .click()
    await dialog()
      .getByRole("link", { name: "继续授权", exact: true })
      .waitFor()
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[role="dialog"]')
          ?.textContent.includes("正在等待授权结果")
    )
    assert.equal(credentials.get(oauth.id).name, "重新授权时更新名称")
    await choose("#mcp-authentication-protocol", "HTTP Header")
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .waitFor()
    await choose("#mcp-authentication-protocol", "MCP OAuth")
    await dialog()
      .getByRole("button", { name: "检测连接", exact: true })
      .click()
    await page
      .getByText("凭证已保存，连接测试成功。", { exact: true })
      .first()
      .waitFor()
    await dialog()
      .getByRole("button", { name: "撤销凭证", exact: true })
      .click()
    await dialog()
      .getByRole("button", { name: "连接并授权", exact: true })
      .waitFor()
    assert(!credentials.has(oauth.id))
    await close()

    await edit("资源包连接器")
    assert(await dialog().locator("#mcp-avatar-upload").isDisabled())
    await dialog().locator("#credential-name").fill("更新包凭证")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert.equal(credentials.get("package").name, "更新包凭证")

    await create()
    await fillBasics("直接认证连接器")
    await choose("#mcp-authentication-mode", "集中认证")
    await choose("#mcp-authentication-protocol", "MCP OAuth")
    await dialog().locator("#credential-name").fill("直接创建 OAuth 凭证")
    await dialog()
      .getByRole("button", { name: "连接并授权", exact: true })
      .click()
    await dialog()
      .getByText(/已授权.*连接正常/)
      .waitFor()
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert(
      [...rows.values()].some(
        (item) => item.name === "直接认证连接器" && credentials.has(item.id)
      )
    )
    assert.deepEqual(errors, [])
    assert(
      writes.every(
        (write) =>
          !/\/connectors\/[^/]+\/credentials(?:\/[^/]+)?$/.test(write.endpoint)
      ),
      "Legacy admin credential writes must not be used"
    )
    assert(blockedPopup)
    console.log(
      "PASS inline connector credentials:",
      width,
      "Header create/retry/preserve/replace/validation; OAuth create/rename/reauthorize/DCR revision/popup fallback/test/revoke; imported permissions; one dialog and form"
    )
    await context.close()
  }
} finally {
  await browser.close()
}
