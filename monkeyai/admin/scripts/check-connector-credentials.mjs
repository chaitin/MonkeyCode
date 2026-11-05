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
      failConnectionTest = false,
      listRequests = 0,
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
    rows.set("package", {
      ...row("package", "资源包连接器", "package"),
      auth_header_name: "X-Package-Key",
    })
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
      if (
        change.revoke ||
        (change.http_headers && Object.keys(change.http_headers).length === 0)
      )
        return undefined
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
        if (/\/credentials\/[^/]+\/test$/.test(endpoint)) {
          if (failConnectionTest) {
            failConnectionTest = false
            return json(
              { error: { code: "test_failure", message: "检测连接失败测试" } },
              500
            )
          }
          return json({})
        }
        if (endpoint.endsWith("/connectors")) {
          listRequests++
          return json({
            items: [...rows.values()].map(view),
            next_cursor: null,
          })
        }
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
    const checkConnection = async (fail = false) => {
      const beforeList = listRequests
      const beforeWrites = writes.length
      failConnectionTest = fail
      const testButton = dialog().getByRole("button", {
        name: "连接检测",
        exact: true,
      })
      const placement = await testButton.evaluate((button) => {
        const row = button.parentElement.parentElement
        const label = row.querySelector('[data-slot="field-label"]')
        const actionBounds = button.getBoundingClientRect()
        const labelBounds = label.getBoundingClientRect()
        return {
          label: label.textContent,
          actions: [...button.parentElement.querySelectorAll("button")].map(
            (action) => action.textContent.trim()
          ),
          sameRow:
            Math.abs(
              actionBounds.y +
                actionBounds.height / 2 -
                labelBounds.y -
                labelBounds.height / 2
            ) < 2,
          rightAligned:
            Math.abs(row.getBoundingClientRect().right - actionBounds.right) <
            2,
        }
      })
      assert.equal(placement.label, "认证")
      assert(
        (placement.sameRow || width < 500) && placement.rightAligned,
        JSON.stringify(placement)
      )
      assert.equal(placement.actions.at(-1), "连接检测")
      if (placement.actions.includes("重新授权"))
        assert.deepEqual(placement.actions, [
          "重新授权",
          "撤销凭证",
          "连接检测",
        ])
      await testButton.click()
      await page
        .getByText(fail ? "检测连接失败测试" : "凭证已保存，连接测试成功。", {
          exact: true,
        })
        .first()
        .waitFor()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="dialog"] button')].some(
          (button) =>
            button.textContent.trim() === "连接检测" && !button.disabled
        )
      )
      assert.equal(
        listRequests,
        beforeList,
        "Connection tests must not reload the connector list"
      )
      assert.equal(
        writes.length,
        beforeWrites + 1,
        "Connection tests must not save editor drafts"
      )
      assert(writes.at(-1).endpoint.endsWith("/test"))
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
    assert.equal(await dialog().locator("#credential-name").count(), 0)
    assert.equal(await dialog().locator("#mcp-auth-header-name").count(), 0)
    assert.equal(
      await dialog()
        .getByText("名称由你填写，用于区分凭证，不代表第三方账户身份。", {
          exact: true,
        })
        .count(),
      0
    )
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
    assert.equal(credentials.get(header.id).name, "Header 连接器")
    assert(
      !Object.hasOwn(
        writes.findLast(
          (write) =>
            write.method === "POST" && write.endpoint.endsWith("/connectors")
        ).body,
        "auth_header_name"
      )
    )

    await edit("Header 连接器")
    assert.equal(await dialog().locator("#credential-name").count(), 0)
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 内容", exact: true })
        .inputValue(),
      ""
    )
    assert.equal(
      await dialog().locator("#replace-credential-headers").count(),
      0
    )
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 内容", exact: true })
        .getAttribute("placeholder"),
      "留空保留原值"
    )
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 名称", exact: true })
        .getAttribute("placeholder"),
      "Key"
    )
    assert.equal(
      await dialog().getByText("已授权 · 连接正常", { exact: true }).count(),
      0
    )
    const credentialFieldset = dialog()
      .locator("fieldset")
      .filter({
        has: page.getByRole("textbox", { name: "Header 1 名称", exact: true }),
      })
      .last()
    assert.equal(
      await credentialFieldset.evaluate(
        (el) => getComputedStyle(el).borderTopWidth
      ),
      "0px"
    )
    const before = writes.filter((write) => write.body?.credential).length
    await dialog().locator("#mcp-description").fill("只修改说明")
    await checkConnection()
    await checkConnection(true)
    assert.equal(
      await dialog().locator("#mcp-description").inputValue(),
      "只修改说明"
    )
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert.equal(
      writes.filter((write) => write.body?.credential).length,
      before
    )

    await edit("Header 连接器")
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .fill("replacement-secret")
    await dialog()
      .getByRole("button", { name: "添加 Header", exact: true })
      .click()
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 2 名称", exact: true })
        .getAttribute("placeholder"),
      "Key"
    )
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 2 内容", exact: true })
        .getAttribute("placeholder"),
      "Value"
    )
    await dialog()
      .getByRole("textbox", { name: "Header 2 名称", exact: true })
      .fill("authorization")
    await dialog()
      .getByRole("textbox", { name: "Header 2 内容", exact: true })
      .fill("second-secret")
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

    await edit("Header 连接器")
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 2 内容", exact: true })
        .inputValue(),
      ""
    )
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .fill("third-secret")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const partial = writes.findLast(
      (write) => write.body?.credential?.http_headers
    )
    assert.deepEqual(partial.body.credential.http_headers, {
      Authorization: "third-secret",
      "X-API-Key": "",
    })

    await edit("Header 连接器")
    await dialog()
      .getByRole("button", { name: "删除", exact: true })
      .nth(1)
      .click()
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert.deepEqual(
      writes.findLast((write) => write.body?.credential?.http_headers).body
        .credential.http_headers,
      { Authorization: "" }
    )
    assert.deepEqual(credentials.get(header.id).header_names, ["Authorization"])

    await edit("Header 连接器")
    assert.equal(
      await dialog()
        .getByRole("button", { name: "撤销凭证", exact: true })
        .count(),
      0
    )
    const beforeClearCancel = writes.length
    await dialog().getByRole("button", { name: "删除", exact: true }).click()
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 名称", exact: true })
        .count(),
      0
    )
    assert(
      await dialog()
        .getByRole("button", { name: "连接检测", exact: true })
        .isDisabled()
    )
    assert.equal(
      writes.length,
      beforeClearCancel,
      "Deleting rows must only change the draft"
    )
    await close()
    assert.equal(writes.length, beforeClearCancel)
    assert(credentials.has(header.id), "Cancel must keep the saved credential")

    await edit("Header 连接器")
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 名称", exact: true })
        .inputValue(),
      "Authorization"
    )
    await dialog().getByRole("button", { name: "删除", exact: true }).click()
    failCredential = true
    await submit()
    await page.getByText("凭证保存失败测试", { exact: true }).waitFor()
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 名称", exact: true })
        .count(),
      0
    )
    assert(
      credentials.has(header.id),
      "A failed clear must keep the stored credential"
    )
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const cleared = writes.findLast(
      (write) => write.body?.credential?.http_headers
    )
    assert.deepEqual(cleared.body.credential.http_headers, {})
    assert(!cleared.body.credential.revoke)
    assert(!credentials.has(header.id))

    await edit("Header 连接器")
    assert.equal(
      await dialog()
        .getByRole("textbox", { name: "Header 1 名称", exact: true })
        .count(),
      0
    )
    assert.equal(
      await dialog()
        .getByRole("button", { name: "撤销凭证", exact: true })
        .count(),
      0
    )
    await dialog()
      .getByRole("button", { name: "添加 Header", exact: true })
      .click()
    await dialog()
      .getByRole("textbox", { name: "Header 1 名称", exact: true })
      .fill("X-Restored-Key")
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .fill("restored-secret")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert.deepEqual(credentials.get(header.id).header_names, [
      "X-Restored-Key",
    ])
    assert(
      !writes.findLast((write) => write.body?.credential?.http_headers).body
        .credential.id
    )

    await create()
    await choose("#mcp-authentication-mode", "集中认证")
    await choose("#mcp-authentication-protocol", "MCP OAuth")
    const beforeInvalid = writes.length
    await dialog()
      .getByRole("button", { name: "连接并授权", exact: true })
      .click()
    assert.equal(writes.length, beforeInvalid)
    await fillBasics("OAuth 连接器")
    assert(
      (await dialog().locator("#mcp-oauth-client-mode").innerText()).includes(
        "动态 Client（自动发现）"
      )
    )
    await dialog().locator("#mcp-oauth-client-mode").click()
    for (const value of ["dynamic", "manual"]) {
      const description = page.locator(
        `#mcp-oauth-client-option-${value}-description`
      )
      await description.waitFor()
      assert((await description.innerText()).length > 20)
      assert.equal(
        await description
          .locator('xpath=ancestor::*[@role="option"]')
          .getAttribute("aria-describedby"),
        `mcp-oauth-client-option-${value}-description`
      )
    }
    const optionsBounds = await page
      .locator('[data-slot="select-content"][data-open]')
      .boundingBox()
    assert(
      optionsBounds.x >= 0 && optionsBounds.x + optionsBounds.width <= width + 1
    )
    await page
      .getByRole("option", { name: "传统配置（手动）", exact: true })
      .click()
    await page
      .getByRole("option", { name: "传统配置（手动）", exact: true })
      .waitFor({ state: "hidden" })
    assert.equal(
      (await dialog().locator("#mcp-oauth-client-mode").innerText()).trim(),
      "传统配置（手动）"
    )
    assert.equal(
      await dialog()
        .locator("#mcp-oauth-client-option-manual-description")
        .count(),
      0
    )
    await dialog().locator("#oauthAuthorizationURL").waitFor()
    await dialog().locator("#oauthTokenURL").waitFor()
    await dialog().locator("#oauthClientID").waitFor()
    await layout()
    await choose("#mcp-oauth-client-mode", "动态 Client（自动发现）")
    assert.equal(await dialog().locator("#oauthClientID").count(), 0)
    await submit()
    await dialog()
      .getByRole("button", { name: "保存修改", exact: true })
      .waitFor()
    assert.equal(await dialog().locator("#credential-name").count(), 0)
    await dialog()
      .getByRole("button", { name: "连接并授权", exact: true })
      .click()
    await dialog()
      .getByRole("button", { name: "重新授权", exact: true })
      .waitFor()
    assert.equal(
      await dialog().getByText("已授权 · 连接正常", { exact: true }).count(),
      0
    )
    assert.equal(
      await dialog()
        .getByText("重新授权会替换这份凭证的授权内容，并重新同步工具目录。", {
          exact: true,
        })
        .count(),
      0
    )
    assert(
      await dialog()
        .getByRole("button", { name: "重新授权", exact: true })
        .evaluate((button) => button.classList.contains("border-border"))
    )
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
    assert.equal(credentials.get(oauth.id).name, "OAuth 连接器")
    await edit("OAuth 连接器")
    assert(
      (await dialog().locator("#mcp-oauth-client-mode").innerText()).includes(
        "动态 Client（自动发现）"
      )
    )
    await dialog().locator("#mcp-name").fill("已改名 OAuth 连接器")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const rename = writes.findLast((write) =>
      write.endpoint.endsWith(`/connectors/${oauth.id}`)
    )
    assert.equal(rename.method, "PUT")
    assert.equal(rename.body.name, "已改名 OAuth 连接器")
    assert(!rename.body.credential)
    assert.equal(credentials.get(oauth.id).name, "OAuth 连接器")
    await edit("已改名 OAuth 连接器")
    await dialog().locator("#mcp-name").fill("重新授权的 OAuth 连接器")
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
    assert.equal(credentials.get(oauth.id).name, "OAuth 连接器")
    await choose("#mcp-authentication-protocol", "HTTP Header")
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .waitFor()
    await choose("#mcp-authentication-protocol", "MCP OAuth")
    await checkConnection()
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
    assert.equal(await dialog().locator("#credential-name").count(), 0)
    await dialog().locator("#mcp-name").fill("自定义包连接器")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert.equal(credentials.get("package").name, "包凭证")
    assert.equal(rows.get("package").auth_header_name, "X-Package-Key")
    assert(
      !Object.hasOwn(
        writes.findLast((write) =>
          write.endpoint.endsWith("/connectors/package")
        ).body,
        "auth_header_name"
      )
    )

    await create()
    await fillBasics("直接认证连接器")
    await choose("#mcp-authentication-mode", "集中认证")
    await choose("#mcp-authentication-protocol", "MCP OAuth")
    await dialog()
      .getByRole("button", { name: "连接并授权", exact: true })
      .click()
    await dialog()
      .getByRole("button", { name: "重新授权", exact: true })
      .waitFor()
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert(
      [...rows.values()].some(
        (item) => item.name === "直接认证连接器" && credentials.has(item.id)
      )
    )
    const direct = [...rows.values()].find(
      (item) => item.name === "直接认证连接器"
    )
    assert.equal(credentials.get(direct.id).name, direct.name)

    await create()
    const longName = "a".repeat(127) + "😀" + "b".repeat(40)
    await fillBasics(`  ${longName}  `)
    await choose("#mcp-authentication-mode", "集中认证")
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .fill("long-name-secret")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const longConnector = [...rows.values()].find(
      (item) => item.name === longName
    )
    assert.equal(credentials.get(longConnector.id).name, "a".repeat(127) + "😀")
    assert.equal(Array.from(credentials.get(longConnector.id).name).length, 128)
    await create()
    await fillBasics("独立认证连接器")
    await choose("#mcp-authentication-mode", "独立认证")
    await dialog().locator("#mcp-auth-header-name").fill("X-User-Key")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    const independent = [...rows.values()].find(
      (item) => item.name === "独立认证连接器"
    )
    assert.equal(independent.auth_header_name, "X-User-Key")
    assert(!credentials.has(independent.id))
    await edit(independent.name)
    await choose("#mcp-authentication-mode", "集中认证")
    assert.equal(await dialog().locator("#mcp-auth-header-name").count(), 0)
    await dialog()
      .getByRole("button", { name: "添加 Header", exact: true })
      .click()
    await dialog()
      .getByRole("textbox", { name: "Header 1 名称", exact: true })
      .fill("Authorization")
    await dialog()
      .getByRole("textbox", { name: "Header 1 内容", exact: true })
      .fill("central-secret")
    await submit()
    await dialog().waitFor({ state: "hidden" })
    assert.equal(rows.get(independent.id).auth_header_name, "X-User-Key")
    assert(
      !Object.hasOwn(
        writes.findLast((write) =>
          write.endpoint.endsWith(`/connectors/${independent.id}`)
        ).body,
        "auth_header_name"
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
      "automatic credential names, Unicode length limit, existing-name preservation; Header create/retry/preserve/replace/validation/delete-all/cancel/clear-failure/recreate; OAuth create/reauthorize/DCR revision/popup fallback/test/revoke; imported permissions; one dialog and form"
    )
    await context.close()
  }
} finally {
  await browser.close()
}
