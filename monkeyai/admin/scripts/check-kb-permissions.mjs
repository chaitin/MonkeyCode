import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const executablePath = process.env.CHROME_BIN
if (!executablePath) {
  throw new Error(
    "请设置 CHROME_BIN，指向待验证的 Chrome/Chromium 可执行文件；先执行 pnpm build"
  )
}
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
  const saves = []
  let savedGrants = []
  let documentRequests = 0
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    if (pathname.startsWith("/api/")) {
      let body = {}
      if (pathname.endsWith("/session")) {
        body = {
          authenticated: true,
          user: {
            id: "admin",
            name: "管理员",
            email: "admin@example.com",
            role: "admin",
            status: "active",
          },
        }
      } else if (pathname.endsWith("/branding")) {
        body = { product_name: "MonkeyAI" }
      } else if (pathname.endsWith("/license/status")) {
        body = { state: "valid" }
      } else if (pathname.endsWith("/settings")) {
        body = { settings: [] }
      } else if (pathname.endsWith("/resources/authorization-subjects")) {
        body = {
          groups: [
            { id: "group-product", name: "产品组" },
            { id: "group-child", name: "子组", parent_id: "group-product" },
          ],
          users: [
            {
              id: "user-zhang",
              name: "张三",
              email: "zhang@example.com",
              group_id: "group-product",
            },
            {
              id: "user-li",
              name: "李四",
              email: "li@example.com",
              group_id: "group-child",
            },
          ],
        }
      } else if (pathname.endsWith("/tags")) {
        body = { items: [] }
      } else if (pathname === "/api/admin/v1/models") {
        body = {
          models: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              display_name: "Embedding Regression",
              model_id: "embedding-primary",
              kind: "embedding",
              enabled: true,
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              display_name: "",
              model_id: "embedding-fallback",
              kind: "embedding",
              enabled: true,
            },
          ],
        }
      } else if (pathname === "/api/admin/v1/kb") {
        body = {
          items: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "测试知识库",
              description: "测试描述",
              ownership_type: "system",
              enabled: true,
              revision: 1,
              embedding_model_id: "22222222-2222-4222-8222-222222222222",
              embedding_dimension: 1024,
              document_count: 0,
              learned_count: 0,
              grants: [],
              tags: [],
              updated_at: "2026-11-05T00:00:00Z",
              user: {
                id: "admin",
                name: "管理员",
                email: "admin@example.com",
              },
            },
          ],
          next_cursor: "",
        }
      } else if (/^\/api\/admin\/v1\/kb\/[^/]+$/.test(pathname)) {
        if (route.request().method() === "PUT") {
          const payload = route.request().postDataJSON()
          saves.push(payload)
          savedGrants = payload.grants
        }
        body = {
          id: pathname.split("/").at(-1),
          ownership_type: "system",
          name: "测试知识库",
          description: "测试描述",
          grants: savedGrants,
          tags: [],
          revision: saves.length + 1,
        }
      } else if (pathname.includes("/documents")) {
        documentRequests++
        body = { items: [] }
      }
      return route.fulfill({ json: body })
    }

    const requested = path.resolve(dist, `.${pathname}`)
    const exists =
      requested.startsWith(dist) &&
      (await stat(requested)
        .then((entry) => entry.isFile())
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

  await page.goto("http://admin.test/console/resources/kb", {
    waitUntil: "networkidle",
  })
  await page.getByText("测试知识库", { exact: true }).click()
  await page.waitForURL("**/kb/11111111-1111-4111-8111-111111111111")
  await page.getByRole("button", { name: "修改信息", exact: true }).waitFor()
  assert.equal(await page.getByRole("dialog").count(), 0)
  assert.equal(documentRequests, 1)
  await page.getByRole("button", { name: "修改信息", exact: true }).click()
  await page.getByRole("dialog").waitFor()
  const editor = page.locator("#kb-detail-authorized-users")
  await editor.click()
  const setPermission = async (name, permission) => {
    await page
      .getByRole("combobox", { name: `${name}的权限`, exact: true })
      .click()
    await page
      .locator('[data-slot="select-content"][data-open]')
      .getByRole("option", { name: permission, exact: true })
      .click()
  }
  await setPermission("产品组", "读写")
  await setPermission("张三", "只读")
  await page.keyboard.press("Escape")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存修改", exact: true })
    .click()
  await page
    .getByRole("dialog", { name: "修改知识库", exact: true })
    .waitFor({ state: "hidden" })
  assert.deepEqual(
    saves[0].grants.map((g) => ({
      user_id: g.user_id,
      group_id: g.group_id,
      access_level: g.access_level,
    })),
    [
      {
        user_id: undefined,
        group_id: "group-product",
        access_level: "read_write",
      },
      { user_id: "user-zhang", group_id: undefined, access_level: "read_only" },
    ]
  )
  await page.getByRole("button", { name: "修改信息", exact: true }).click()
  await editor.click()
  await setPermission("张三", "读写")
  await setPermission("产品组", "未授权")
  await page.keyboard.press("Escape")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存修改", exact: true })
    .click()
  await page
    .getByRole("dialog", { name: "修改知识库", exact: true })
    .waitFor({ state: "hidden" })
  assert.equal(saves[1].grants.length, 1)
  assert.equal(saves[1].grants[0].user_id, "user-zhang")
  assert.equal(saves[1].grants[0].access_level, "read_write")
  assert.deepEqual(errors, [])
  console.log(
    "knowledge base inline permissions, group identity, per-row updates and removal passed"
  )
} finally {
  await browser.close()
}
