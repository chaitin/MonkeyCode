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
  const png = await readFile(
    new URL("../public/logo-light.png", import.meta.url)
  )
  await page.addInitScript(() => {
    window.__avatarWrites = []
    const nativeFetch = window.fetch
    window.fetch = (input, init) => {
      if (
        String(input).includes("/api/admin/v1/kb") &&
        init?.body instanceof FormData
      ) {
        const file = init.body.get("avatar")
        window.__avatarWrites.push({
          method: init.method,
          metadata: JSON.parse(init.body.get("metadata")),
          file: { name: file.name, type: file.type, size: file.size },
        })
      }
      return nativeFetch(input, init)
    }
  })
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    if (pathname.endsWith("/avatar"))
      return route.fulfill({ contentType: "image/png", body: png })
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
              avatar_path:
                "/api/admin/v1/kb/11111111-1111-4111-8111-111111111111/avatar",
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
          const payload =
            (await page.evaluate(() => window.__avatarWrites.at(-1)))
              ?.metadata ?? route.request().postDataJSON()
          saves.push(payload)
          savedGrants = payload.grants
        }
        body = {
          id: pathname.split("/").at(-1),
          avatar_path:
            "/api/admin/v1/kb/11111111-1111-4111-8111-111111111111/avatar",
          ownership_type: "system",
          name: "测试知识库",
          description: "测试描述",
          grants: savedGrants,
          tags: [],
          revision: saves.length + 1,
        }
      } else if (pathname.includes("/documents")) {
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
  await page.locator('img[src$="/avatar"]').first().waitFor()
  await page.getByText("测试知识库", { exact: true }).click()
  await page.getByRole("button", { name: "修改信息", exact: true }).click()
  await page.locator("#kb-detail-avatar-file").setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("bad"),
  })
  await page.getByRole("alert").waitFor()
  await page
    .locator("#kb-detail-avatar-file")
    .setInputFiles({ name: "kb.png", mimeType: "image/png", buffer: png })
  await page.locator('#kb-detail-avatar-upload img[src^="blob:"]').waitFor()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存修改", exact: true })
    .click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  const writes = await page.evaluate(() => window.__avatarWrites)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].method, "PUT")
  assert.equal(writes[0].metadata.name, "测试知识库")
  assert.deepEqual(writes[0].metadata.grants, [])
  assert.equal(writes[0].file.name, "kb.png")
  assert.equal(writes[0].file.size, png.length)
  await page.getByRole("button", { name: "修改信息", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存修改", exact: true })
    .click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal((await page.evaluate(() => window.__avatarWrites)).length, 1)
  await page.goto("http://admin.test/console/resources/kb", {
    waitUntil: "networkidle",
  })
  await page.getByRole("button", { name: "创建知识库", exact: true }).click()
  await page.locator("#kb-name").fill("图标知识库")
  await page.locator("#kb-description").fill("图标创建回归")
  await page
    .locator("#kb-avatar-file")
    .setInputFiles({ name: "create.png", mimeType: "image/png", buffer: png })
  await page.locator('#kb-avatar-upload img[src^="blob:"]').waitFor()
  const preview = await page.locator("#kb-avatar-upload").boundingBox()
  assert.ok(
    Math.abs(preview.width - preview.height) < 2,
    "avatar preview remains square"
  )
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建", exact: true })
    .click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  const create = await page.evaluate(() => window.__avatarWrites.at(-1))
  assert.equal(create.method, "POST")
  assert.equal(create.metadata.name, "图标知识库")
  assert.equal(create.file.name, "create.png")
  assert.deepEqual(errors, [])
  console.log(
    "knowledge base avatar preview, validation, multipart update and unchanged save passed"
  )
} finally {
  await browser.close()
}
