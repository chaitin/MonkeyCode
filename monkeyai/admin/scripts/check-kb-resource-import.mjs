import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ["--no-sandbox"] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, locale: "zh-CN" })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  let applied = false
  const upload = { id: "ready-kb", status: "ready", files: [{ name: "knowledge.zip", size: 100 }], total_size: 100, chunk_size: 67108864, chunks: [{ index: 0, size: 100, sha256: "sha256:fixture" }], expires_at: "2099-01-01T00:00:00Z" }
  const knowledge = { publisher_id: "wiki", release_id: "r-1", plan_digest: "knowledge-plan", changes: [{ slug: "manual", name: "百智办公文档", action: "create", documents: 32, folders: 2, images: 119 }] }
  await page.route("**/*", async (route) => {
    const request = route.request()
    const p = new URL(request.url()).pathname
    if (p.startsWith("/api/")) {
      let body = {}
      if (p.endsWith("/session")) body = { authenticated: true, user: { id: "admin", name: "管理员", role: "admin", status: "active" } }
      else if (p.endsWith("/branding")) body = { product_name: "MonkeyAI" }
      else if (p.endsWith("/license/status")) body = { state: "valid" }
      else if (p.endsWith("/settings")) body = { settings: [] }
      else if (p.endsWith("/resource-import-uploads")) body = { items: applied ? [] : [upload] }
      else if (p.endsWith("/resource-imports/preview")) {
        const input = request.postDataJSON()
        if (input.discover_only) body = { available_sections: ["knowledge"], sections: { knowledge: { present: true, supported: true, schema_version: 1 } } }
        else {
          assert.deepEqual(input.sections, ["knowledge"])
          body = { publisher: "wiki", release_id: "r-1", version: 0, package_sha256: "package", plan_digest: "overall", changes: [], ignored_static: [], sections: ["knowledge"], section_plans: { knowledge: { plan_digest: "knowledge-plan", already_imported: false, knowledge } } }
        }
      } else if (p.endsWith("/resource-imports") && request.method() === "POST") {
        const input = request.postDataJSON()
        assert.deepEqual(input.sections, ["knowledge"])
        assert.deepEqual(input.section_plan_digests, { knowledge: "knowledge-plan" })
        assert.equal(input.options.confirm_final, true)
        applied = true
        body = { status: "succeeded", sections: { knowledge: { status: "succeeded", replayed: false, result: knowledge } } }
      } else if (p.endsWith("/resource-imports")) body = { items: [], next_cursor: null }
      return route.fulfill({ json: body })
    }
    const candidate = path.resolve(dist, `.${p}`)
    const exists = candidate.startsWith(dist) && await stat(candidate).then((s) => s.isFile()).catch(() => false)
    const file = exists ? candidate : path.join(dist, "index.html")
    return route.fulfill({ body: await readFile(file), contentType: ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2" })[path.extname(file)] || "application/octet-stream" })
  })
  await page.goto("http://admin.test/admin/resources/imports")
  await page.getByRole("button", { name: "继续确认", exact: true }).click()
  await page.getByRole("checkbox", { name: /知识库/ }).first().waitFor()
  await page.getByRole("button", { name: "解析并预览", exact: true }).click()
  const preview = page.getByRole("region", { name: "知识库预览" })
  await preview.getByText("百智办公文档", { exact: true }).waitFor()
  assert.match(await preview.innerText(), /文档 32/)
  assert.match(await preview.innerText(), /图片 119/)
  const confirm = page.locator('label[for="import-final"]')
  await confirm.click()
  await page.getByRole("button", { name: "确认导入", exact: true }).click()
  await page.getByText("所选分区导入成功", { exact: true }).waitFor()
  assert.equal(applied, true)
  assert.deepEqual(errors, [])
  console.log("知识库分区选择、32 篇文档预览、确认请求和成功状态：浏览器验证通过")
} finally {
  await browser.close()
}
