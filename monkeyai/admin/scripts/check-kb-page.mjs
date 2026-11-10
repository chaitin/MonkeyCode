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
  let documentRequests = 0
  let checkStaleDocuments = false
  const pendingDocuments = []
  let documentRequested = () => {}
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
        body = { groups: [], users: [] }
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
        if (checkStaleDocuments) {
          body.items.push({
            ...body.items[0],
            id: "44444444-4444-4444-8444-444444444444",
            name: "第二知识库",
          })
        }
      } else if (pathname.includes("/documents")) {
        documentRequests++
        if (checkStaleDocuments) {
          pendingDocuments.push(route)
          documentRequested()
          return
        }
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
  await page.waitForTimeout(1000)

  assert.equal(await page.locator('[role="dialog"]').count(), 1)
  assert.equal(documentRequests, 1)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)

  await page.getByRole("button", { name: "更多" }).click()
  await page.getByText("修改信息", { exact: true }).click()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('[role="dialog"]').count(), 1)
  assert.equal(
    await page
      .getByRole("dialog")
      .getByText("修改知识库", { exact: true })
      .count(),
    1
  )
  assert.equal(await page.locator("#kb-embedding-model").count(), 0)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)

  await page.getByRole("button", { name: "更多" }).click()
  await page.getByText("查看内容", { exact: true }).click()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('[role="dialog"]').count(), 1)
  assert.equal(
    await page
      .getByRole("dialog")
      .getByText("测试知识库", { exact: true })
      .count(),
    1
  )
  await page.getByRole("button", { name: "添加内容", exact: true }).click()
  await page.waitForTimeout(300)
  const documentBody = page.locator("#kb-document-body")
  const contentDialog = page.getByRole("dialog").filter({ has: documentBody })
  const longContent = `![image](https://example.com/${"a".repeat(10000)}.png)`
  for (const width of [1440, 932, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(300)
    await documentBody.fill("短文本")
    const initialWidth = (await documentBody.boundingBox()).width
    await documentBody.fill(longContent)
    await page.waitForTimeout(100)
    const dimensions = await contentDialog.evaluate((dialog) => {
      const textarea = dialog.querySelector("textarea")
      const bounds = dialog.getBoundingClientRect()
      const inputBounds = textarea.getBoundingClientRect()
      return {
        left: bounds.left,
        right: bounds.right,
        width: inputBounds.width,
        contained: inputBounds.left >= bounds.left && inputBounds.right <= bounds.right,
        dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
        inputOverflow: textarea.scrollWidth - textarea.clientWidth,
      }
    })
    assert.ok(
      Math.abs(dimensions.width - initialWidth) <= 1,
      `长文本不应撑宽输入框: ${JSON.stringify({ viewport: width, initialWidth, ...dimensions })}`
    )
    assert.ok(dimensions.left >= 0 && dimensions.right <= width, "弹窗应在视口内")
    assert.ok(dimensions.contained, "输入框应在弹窗内")
    assert.ok(dimensions.dialogOverflow <= 1, "弹窗不应横向溢出")
    assert.ok(dimensions.inputOverflow <= 1, "连续长字符串应在输入框内换行")
    assert.equal(await documentBody.inputValue(), longContent)
  }
  // Keep A pending, switch to B, then deliver A after B has rendered.
  checkStaleDocuments = true
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("http://admin.test/console/resources/kb", {
    waitUntil: "networkidle",
  })
  const firstRequest = new Promise((resolve) => { documentRequested = resolve })
  await page.getByText("测试知识库", { exact: true }).click()
  await firstRequest
  await page.keyboard.press("Escape")
  const secondRequest = new Promise((resolve) => { documentRequested = resolve })
  await page.getByText("第二知识库", { exact: true }).click()
  await secondRequest
  const document = (id, kbId, title) => ({
    id, kb_id: kbId, title, content: "content", source_type: "text",
    status: "learned", size_bytes: 7, chunk_count: 1,
    created_at: "2026-11-05T00:00:00Z", updated_at: "2026-11-05T00:00:00Z",
  })
  await pendingDocuments[1].fulfill({ json: { items: [document(
    "doc-b", "44444444-4444-4444-8444-444444444444", "当前文档 B"
  )] } })
  await page.getByText("当前文档 B", { exact: true }).waitFor()
  await pendingDocuments[0].fulfill({ json: { items: [document(
    "doc-a", "11111111-1111-4111-8111-111111111111", "旧文档 A"
  )] } }).catch(() => {}) // Chrome may already have canceled the request.
  await page.waitForTimeout(200)
  assert.equal(await page.getByText("当前文档 B", { exact: true }).count(), 1)
  assert.equal(await page.getByText("旧文档 A", { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log("knowledge base dialog regression check passed")
} finally {
  await browser.close()
}
