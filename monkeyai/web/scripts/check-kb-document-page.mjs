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
  let ownership = "system"
  let failLoad = false
  let failSave = false
  let failUpload = false
  let uploads = 0
  let uploadGate = null
  const saved = []
  const kbId = "11111111-1111-4111-8111-111111111111"
  const documentId = "44444444-4444-4444-8444-444444444444"
  let document = {
    id: documentId,
    kb_id: kbId,
    title: "Markdown 测试文档",
    content:
      "# 文档标题\n\n**粗体**与列表：\n\n- 第一项\n- 第二项\n\n| 项目 | 内容 |\n| --- | --- |\n| 示例 | 测试 |",
    source_type: "text",
    file_type: "md",
    content_editable: true,
    revision: 1,
    file_name: null,
    mime_type: null,
    size_bytes: 100,
    status: "learned",
    chunk_count: 1,
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
  }
  page.on("pageerror", (error) => {
    errors.push(error.message)
    console.error(error.stack)
  })
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
              ownership_type: ownership,
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
      } else if (pathname === `/api/admin/v1/kb/${kbId}`) {
        body = { id: kbId, ownership_type: ownership }
      } else if (pathname === `/api/admin/v1/kb/${kbId}/images/upload`) {
        uploads++
        assert.equal(route.request().method(), "POST")
        assert.match(
          route.request().headers()["content-type"],
          /multipart\/form-data; boundary=/
        )
        assert.match(
          route.request().postData(),
          /name="file"; filename="clipboard.png"/
        )
        if (uploadGate) await uploadGate
        if (failUpload)
          return route.fulfill({
            status: 500,
            json: { error: { message: "模拟图片上传失败" } },
          })
        body = { url: `/api/kb/${kbId}/assets/${"a".repeat(64)}.png` }
      } else if (pathname.startsWith(`/api/kb/${kbId}/assets/`)) {
        return route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
            "base64"
          ),
        })
      } else if (
        pathname === `/api/admin/v1/kb/${kbId}/documents/${documentId}`
      ) {
        if (failLoad || (failSave && route.request().method() === "PUT")) {
          return route.fulfill({
            status: 500,
            json: { error: { message: "模拟请求失败" } },
          })
        }
        if (route.request().method() === "PUT") {
          const input = route.request().postDataJSON()
          saved.push(input)
          document = { ...document, ...input }
        }
        body = document
      } else if (pathname.endsWith("/file/detail")) {
        return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64") })
      } else if (pathname.includes("/documents")) {
        documentRequests++
        body = { items: [document] }
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

  const url = `http://admin.test/admin/resources/kb/${kbId}/documents/${documentId}`
  if (process.argv.includes("--images-only")) {
    document = { ...document, content_editable: false, file_type: "png", has_original: true, content: "## 画面描述\n\n一只狗坐在草地上。\n\n## 图片内文字\n\n未见可辨识文字" }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(url, { waitUntil: "networkidle" })
      const picture = page.getByRole("img", { name: document.title, exact: true })
      await picture.waitFor()
      assert.equal(await picture.evaluate(img => img.complete && img.naturalWidth > 0), true)
      const left = await page.locator("[data-kb-image-preview]").boundingBox()
      const right = await page.locator("[data-kb-image-description]").boundingBox()
      assert.ok(left && right)
      if (width >= 768) {
        assert.ok(left.x + left.width <= right.x, "图片应位于文字左侧")
        assert.ok(Math.abs(left.y - right.y) < 1, "左右区域应顶部对齐")
      } else {
        assert.ok(left.y + left.height <= right.y, "窄屏应上下排列")
      }

      await page.getByText("一只狗坐在草地上。", { exact: true }).waitFor()
      assert.equal(await page.locator('.tiptap[contenteditable="true"]').count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    }
    await page.screenshot({ path: "/tmp/monkeyai-kb-image-preview.png", fullPage: true })
    assert.deepEqual(errors, [])
    console.log("knowledge image original preview regression passed")
  } else {
  await page.goto("http://admin.test/admin/resources/kb", {
    waitUntil: "networkidle",
  })
  await page.getByText("测试知识库", { exact: true }).click()
  await page.getByText("Markdown 测试文档", { exact: true }).click()
  await page.waitForURL(url)
  await page.locator("[data-markdown-editor] .ace_editor").waitFor()
  assert.equal(await page.getByRole("dialog").count(), 0)
  await page.locator(".tiptap h1").filter({ hasText: "文档标题" }).waitFor()
  await page.screenshot({
    path: "/tmp/monkeyai-document-editor-desktop.png",
    fullPage: true,
  })
  const title = page.getByRole("textbox", { name: "内容标题", exact: true })
  await title.fill("编辑后的文档")
  const ace = page.locator(".ace_text-input:not([aria-hidden=true])")
  await ace.focus()
  await page.keyboard.press("ControlOrMeta+End")
  await page.keyboard.type("\n\nUpdated content")
  async function pasteImage(
    type = "image/png",
    selector = ".ace_text-input:not([aria-hidden=true])",
    count = 1
  ) {
    await page.locator(selector).evaluate(
      (element, { type, count }) => {
        const data = new DataTransfer()
        for (let i = 0; i < count; i++)
          data.items.add(
            new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", {
              type,
            })
          )
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          })
        )
      },
      { type, count }
    )
  }
  let releaseUpload
  uploadGate = new Promise((resolve) => {
    releaseUpload = resolve
  })
  await pasteImage()
  await page.getByText("图片上传中…", { exact: true }).waitFor()
  assert.equal(
    await page.getByRole("button", { name: "保存并重新学习" }).isDisabled(),
    true
  )
  // Typing and moving focus during the upload must not replace or relocate the image.
  await page.keyboard.type(" preserved while uploading")
  await title.focus()
  releaseUpload()
  uploadGate = null
  await page.waitForFunction(() =>
    document
      .querySelector(".ace_editor")
      .env.editor.getValue()
      .includes("/assets/")
  )
  assert.equal(uploads, 1)
  const imageURL = `/api/kb/${kbId}/assets/${"a".repeat(64)}.png`
  let draft = await page
    .locator("[data-markdown-editor] .ace_editor:not(.ace_autocomplete)")
    .evaluate((el) => el.env.editor.getValue())
  assert.ok(
    draft.includes(
      `Updated content\n![](${imageURL})\n preserved while uploading`
    ),
    JSON.stringify(draft)
  )
  await pasteImage("image/png", ".ace_text-input:not([aria-hidden=true])", 2)
  await page.waitForFunction(
    () =>
      document
        .querySelector(".ace_editor")
        .env.editor.getValue()
        .split("/assets/").length === 4
  )
  draft = await page
    .locator("[data-markdown-editor] .ace_editor:not(.ace_autocomplete)")
    .evaluate((el) => el.env.editor.getValue())
  assert.equal(uploads, 3, "all clipboard images should upload")
  // Failed uploads and unsupported formats must preserve the current draft.
  failUpload = true
  await pasteImage()
  await page.getByText("模拟图片上传失败", { exact: true }).waitFor()
  assert.equal(
    await page
      .locator("[data-markdown-editor] .ace_editor:not(.ace_autocomplete)")
      .evaluate((el) => el.env.editor.getValue()),
    draft
  )
  failUpload = false
  await pasteImage("image/svg+xml")
  await page
    .getByText("仅支持 PNG、JPEG、GIF 或 WebP 图片", { exact: true })
    .waitFor()
  assert.equal(uploads, 4)
  await page.getByText("未保存更改，10 秒后自动保存", { exact: true }).waitFor()
  await page.getByRole("button", { name: "保存并重新学习" }).click()
  await page.getByText("已保存", { exact: true }).waitFor()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].title, "编辑后的文档")
  assert.ok(saved[0].content.includes("Updated content"))
  assert.ok(saved[0].content.includes(`![](${imageURL})`))
  assert.ok(saved[0].content.includes("preserved while uploading"))
  assert.equal(
    saved[0].size_bytes,
    new TextEncoder().encode(saved[0].content).length
  )

  await title.fill("保存失败保留草稿")
  failSave = true
  await page.getByRole("button", { name: "保存并重新学习" }).click()
  await page.getByText("模拟请求失败", { exact: true }).waitFor()
  assert.equal(await title.inputValue(), "保存失败保留草稿")
  assert.equal(saved.length, 1)
  failSave = false

  async function confirmNavigation(action, discard = false) {
    const handled = new Promise((resolve, reject) => {
      page.once("dialog", (dialog) => {
        const result = discard ? dialog.accept() : dialog.dismiss()
        result.then(resolve, reject)
      })
    })
    await action()
    await handled
  }

  // Router navigation must preserve a draft when discard is declined.
  await page.getByRole("button", { name: "资源管理", exact: true }).click()
  const modelsLink = page.locator('a[href="/admin/resources/models"]').first()
  await confirmNavigation(() => modelsLink.click())
  assert.equal(page.url(), url)
  assert.equal(await title.inputValue(), "保存失败保留草稿")
  await confirmNavigation(() => page.evaluate(() => window.history.back()))
  await page.waitForURL(url)
  assert.equal(await title.inputValue(), "保存失败保留草稿")

  await confirmNavigation(() =>
    page.getByRole("button", { name: "返回知识库", exact: true }).click()
  )
  assert.equal(page.url(), url)
  await title.fill(document.title)
  await page.getByRole("button", { name: "返回知识库", exact: true }).click()
  await page.waitForURL(`**/kb/${kbId}`)
  await page.getByText(document.title, { exact: true }).waitFor()
  assert.ok(documentRequests >= 2)

  await page.goto(url, { waitUntil: "networkidle" })
  await title.fill("确认放弃的草稿")
  await page.getByRole("button", { name: "资源管理", exact: true }).click()
  await confirmNavigation(() => modelsLink.click(), true)
  await page.waitForURL("**/admin/resources/models")

  ownership = "user"
  await page.goto(url, { waitUntil: "networkidle" })
  await page.getByText("只读", { exact: true }).waitFor()
  await page.locator(".tiptap h1").waitFor()
  assert.equal(await title.getAttribute("readonly"), "")
  assert.equal(
    await page.getByRole("button", { name: "保存并重新学习" }).count(),
    0
  )
  assert.equal(await page.locator('.tiptap[contenteditable="true"]').count(), 0)
  await pasteImage("image/png", "[data-markdown-editor]")
  assert.equal(uploads, 4, "read-only documents must not upload pasted images")
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      ),
      "页面不应横向溢出"
    )
  }
  await page.screenshot({
    path: "/tmp/monkeyai-document-editor.png",
    fullPage: true,
  })
  document = { ...document, content_editable: false, file_type: "pdf", has_original: true }
  await page.goto(url, { waitUntil: "networkidle" })
  await page.locator(".tiptap h1").waitFor()
  assert.equal(await page.locator('.tiptap[contenteditable="true"]').count(), 0)
  assert.ok((await page.getByRole("link", { name: "预览原件" }).getAttribute("href")).endsWith("?preview=true"))
  document = { ...document, content_editable: false, file_type: "png", has_original: true, content: "## 画面描述\n\n一只狗坐在草地上。\n\n## 图片内文字\n\n未见可辨识文字" }
  await page.goto(url, { waitUntil: "networkidle" })
  await page.getByRole("img", { name: document.title, exact: true }).waitFor()
  assert.ok((await page.getByRole("img", { name: document.title, exact: true }).getAttribute("src")).endsWith("/file/detail?preview=true"))
  assert.equal(await page.locator('.tiptap[contenteditable="true"]').count(), 0)
  await page.getByText("一只狗坐在草地上。", { exact: true }).waitFor()
  document = { ...document, content_editable: true, file_type: "html", file_name: "source.html", content: '<h1>源码</h1><script>window.badPreview = true</script><img src="https://invalid.example/image">' }
  await page.goto(url, { waitUntil: "networkidle" })
  const source = page.getByRole("textbox", { name: "文本内容", exact: true })
  await page.locator('textarea').waitFor()
  assert.equal(await page.locator('textarea').inputValue(), document.content)
  await page.getByRole("tab", { name: "预览", exact: true }).click()
  const frame = page.frameLocator('iframe[sandbox=""]')
  await frame.locator('h1').waitFor()
  assert.equal(await frame.locator('script,img').count(), 0)
  assert.equal(await page.evaluate(() => window.badPreview), undefined)
  await page.getByRole("tab", { name: "源码", exact: true }).click()
  assert.equal(await page.locator('textarea').inputValue(), document.content)

  failLoad = true
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("alert").filter({ hasText: "模拟请求失败" }).waitFor()
  assert.equal(await page.locator("[data-markdown-editor]").count(), 0)
  assert.deepEqual(errors, [])
  console.log("knowledge document editor regression check passed")
  }
} finally {
  await browser.close()
}
