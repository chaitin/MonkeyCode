import assert from "node:assert/strict"
import { readFile, stat, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

if (!process.env.CHROME_BIN)
  throw new Error("Set CHROME_BIN and build admin first")
const dist = path.resolve(fileURLToPath(new URL("../dist/", import.meta.url)))
const png = await readFile(new URL("../public/logo-light.png", import.meta.url))
const webp = Buffer.from(
  "UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoIAAYAAUAmJaACdLoB+AADsAD+9Bi3/q0PlofLQ/hIf+Uq8FjdmwAA",
  "base64"
)
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox"],
})
try {
  for (const width of process.env.WIDTH
    ? [Number(process.env.WIDTH)]
    : [390, 1440])
    for (const dark of process.env.DARK
      ? [process.env.DARK === "1"]
      : [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      })
      page.setDefaultTimeout(8000)
      await page.addInitScript(() => {
        window.structuredClone = undefined
        Intl.Segmenter = undefined
        const nativeFetch = window.fetch
        window.fetch = (input, init) => {
          if (
            String(input).includes("/api/admin/v1/experts") &&
            init?.body instanceof FormData
          ) {
            const file = init.body.get("avatar")
            window.__expertForm = {
              metadata: JSON.parse(init.body.get("metadata")),
              avatar: { name: file.name, size: file.size, type: file.type },
            }
          }
          return nativeFetch(input, init)
        }
      })
      const errors = [],
        writes = []
      page.on("pageerror", (error) => errors.push(error.message))
      const row = (id, name, origin) => ({
        id,
        name,
        origin,
        revision: 1,
        ownership_type: "system",
        enabled: true,
        description: "专家说明",
        prompt: "专家提示词",
        user: { id: "author", name: "Alice", email: "alice@example.test" },
        grants: [],
        tags: [],
        rule_ids: [],
        skill_ids: [],
        connectors: [],
        avatar_path: `/api/admin/v1/experts/${id}/avatar?v=initial`,
      })
      const items = [
        row("ordinary", "普通专家", "admin"),
        row("package", "资源包专家", "package"),
      ]
      let releaseSubjects
      const subjectsReady = new Promise((resolve) => {
        releaseSubjects = resolve
      })
      let failNext = false,
        holdNext = false,
        release
      await page.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          endpoint = url.pathname
        const json = (body, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          })
        if (/\/experts\/[^/]+\/avatar$/.test(endpoint))
          return route.fulfill({ contentType: "image/png", body: png })
        if (endpoint.startsWith("/api/")) {
          if (
            /\/experts(?:\/[^/]+)?$/.test(endpoint) &&
            ["PUT", "POST"].includes(request.method())
          ) {
            const multipart = request
              .headers()
              ["content-type"]?.startsWith("multipart/form-data")
            const form = multipart
              ? await page.evaluate(() => window.__expertForm)
              : { metadata: request.postDataJSON() }
            writes.push({
              ...form,
              multipart,
              method: request.method(),
              match: request.headers()["if-match"],
            })
            if (failNext) {
              failNext = false
              return json({ error: { message: "模拟头像保存失败" } }, 500)
            }
            if (holdNext) {
              holdNext = false
              await new Promise((resolve) => {
                release = resolve
              })
            }
            let target
            if (request.method() === "POST") {
              target = row("created", "", "admin")
              target.avatar_path = ""
              items.unshift(target)
            } else
              target = items.find(
                (item) => item.id === endpoint.split("/").at(-1)
              )
            assert(target)
            if (request.method() === "PUT")
              assert.equal(
                request.headers()["if-match"],
                `"${target.revision}"`
              )
            Object.assign(target, form.metadata, {
              revision: target.revision + 1,
            })
            if (multipart)
              target.avatar_path = `/api/admin/v1/experts/${target.id}/avatar?v=${target.revision}`
            return json(target)
          }
          assert.equal(request.method(), "GET", endpoint)
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
            return json({
              workspace_name: "测试团队",
              product_name: "测试产品",
            })
          if (endpoint.endsWith("/license/status"))
            return json({ state: "valid" })
          if (endpoint.endsWith("/resources/authorization-subjects")) {
            await subjectsReady
            return json({
              groups: [{ id: "root", name: "根分组", parent_id: null }],
              users: [],
            })
          }
          if (endpoint.endsWith("/experts"))
            return json({ items, next_cursor: null })
          return json({ items: [], groups: [], users: [], settings: [] })
        }
        const candidate = path.resolve(dist, `.${endpoint}`)
        const exists =
          candidate.startsWith(dist + path.sep) &&
          (await stat(candidate)
            .then((s) => s.isFile())
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
          contentType: types[path.extname(file)] || "application/octet-stream",
          body: await readFile(file),
        })
      })
      await page.goto("http://expert.test/console/resources/experts")
      await page.getByTitle("普通专家", { exact: true }).waitFor()
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        dark
      )
      const dialog = () =>
        page.getByRole("dialog", { name: /新建专家|编辑专家/ })
      const select = (
        buffer = png,
        name = "avatar.png",
        mimeType = "image/png"
      ) =>
        dialog()
          .locator("#expert-avatar-file")
          .setInputFiles({ name, mimeType, buffer })
      async function create() {
        await page
          .getByRole("button", { name: "新建专家", exact: true })
          .click()
        await dialog().waitFor()
      }
      async function edit(name) {
        await page
          .locator('[data-slot="card"]')
          .filter({ has: page.getByTitle(name, { exact: true }) })
          .getByRole("button", { name: "更多", exact: true })
          .click()
        await page.getByRole("menuitem", { name: "编辑", exact: true }).click()
        await dialog().waitFor()
      }
      const preview = () =>
        dialog().locator("#expert-avatar-upload [data-slot=avatar-image]")
      const close = async () => {
        await dialog()
          .getByRole("button", { name: "取消", exact: true })
          .click()
        await dialog().waitFor({ state: "hidden" })
      }
      const cardImage = (name) =>
        page
          .locator('[data-slot="card"]')
          .filter({ has: page.getByTitle(name, { exact: true }) })
          .locator('[data-slot="avatar-image"]')
      await create()
      releaseSubjects()
      await page.waitForFunction(() =>
        document
          .querySelector("#expert-authorization")
          ?.textContent.includes("根分组")
      )
      await page.waitForFunction(() => {
        const popup = document.querySelector('[role="dialog"]')
        return (
          popup &&
          popup
            .getAnimations({ subtree: true })
            .every((animation) => animation.playState !== "running")
        )
      })
      const layout = await dialog().evaluate((el) => {
        const name = el.querySelector("#expert-name").getBoundingClientRect()
        const description = el
          .querySelector("#expert-description")
          .getBoundingClientRect()
        const avatar = el
          .querySelector("#expert-avatar-upload")
          .getBoundingClientRect()
        return {
          gap: avatar.left - name.right,
          basicClasses: el.querySelector("[data-expert-basics]").className,
          basicRowGap: getComputedStyle(
            el.querySelector("[data-expert-basics]")
          ).rowGap,
          viewportWidth: window.innerWidth,
          descriptionRight: description.right,
          nameRight: name.right,
          aligned:
            Math.abs(avatar.top - name.top) < 1 &&
            Math.abs(avatar.bottom - description.bottom) < 1,
          avatarWidth: avatar.width,
          avatarHeight: avatar.height,
          nameWidth: name.width,
          noOverflow: el.scrollWidth <= el.clientWidth,
          dialogWidth: el.getBoundingClientRect().width,
          inputRadius: getComputedStyle(el.querySelector("#expert-name"))
            .borderRadius,
          avatarRadii: [
            getComputedStyle(el.querySelector("#expert-avatar-upload"))
              .borderRadius,
            getComputedStyle(
              el.querySelector("#expert-avatar-upload [data-slot=avatar]")
            ).borderRadius,
            getComputedStyle(
              el.querySelector("#expert-avatar-upload [data-slot=avatar]"),
              "::after"
            ).borderRadius,
            getComputedStyle(
              el.querySelector(
                "#expert-avatar-upload [data-slot=avatar-fallback]"
              )
            ).borderRadius,
            getComputedStyle(
              el.querySelector("#expert-avatar-upload > span[aria-hidden]")
            ).borderRadius,
          ],
        }
      })
      assert(
        Math.abs(layout.gap - (width < 640 ? 12 : 16)) < 0.5,
        JSON.stringify(layout)
      )
      assert(
        Math.abs(layout.avatarWidth - layout.avatarHeight) < 0.5,
        JSON.stringify(layout)
      )
      assert.equal(layout.descriptionRight, layout.nameRight)
      assert(layout.aligned)
      assert(layout.avatarWidth >= 80, JSON.stringify(layout))
      assert(layout.avatarHeight > 80, JSON.stringify(layout))
      assert(layout.nameWidth >= 120, JSON.stringify(layout))
      assert(layout.noOverflow, JSON.stringify(layout))
      assert(layout.dialogWidth <= 577, JSON.stringify(layout))
      const ringSpace = await dialog().evaluate((el) => {
        const group = el
          .querySelector('[data-slot="field-group"]')
          .getBoundingClientRect()
        const name = el.querySelector("#expert-name").getBoundingClientRect()
        const scope = el
          .querySelector("#expert-authorization")
          .getBoundingClientRect()
        const popup = el.getBoundingClientRect()
        return {
          left: name.left - group.left,
          right: group.right - scope.right,
          leftInset: name.left - popup.left,
          rightInset: popup.right - scope.right,
        }
      })
      assert(
        ringSpace.left >= 3 && ringSpace.right >= 3,
        JSON.stringify(ringSpace)
      )
      assert(
        Math.abs(ringSpace.leftInset - ringSpace.rightInset) < 1,
        JSON.stringify(ringSpace)
      )
      assert(
        layout.avatarRadii.every((radius) => radius === layout.inputRadius),
        JSON.stringify(layout)
      )
      const rows = await dialog().evaluate((el) => {
        const rect = (id) => el.querySelector(`#${id}`).getBoundingClientRect()
        const skill = rect("expert-skillIds"),
          rule = rect("expert-ruleIds"),
          connector = rect("expert-toolIds"),
          tags = rect("expert-tags"),
          scope = rect("expert-authorization")
        return {
          skillsLeft: skill.right < rule.left,
          skillsRulesAligned: Math.abs(skill.top - rule.top) < 1,
          connectorBelow: connector.top > skill.bottom,
          tagsBelow: tags.top > connector.bottom,
          tagsScopeAligned: Math.abs(tags.top - scope.top) < 1,
          tagsLeft: tags.right < scope.left,
        }
      })
      assert(Object.values(rows).every(Boolean), JSON.stringify(rows))
      const descriptionInput = await dialog()
        .locator("#expert-description")
        .evaluate((el) => ({
          tag: el.tagName,
          height: el.getBoundingClientRect().height,
          nameHeight: document
            .querySelector("#expert-name")
            .getBoundingClientRect().height,
        }))
      assert.equal(descriptionInput.tag, "INPUT")
      assert.equal(descriptionInput.height, descriptionInput.nameHeight)
      const upload = dialog().getByRole("button", {
        name: "上传头像",
        exact: true,
      })
      await upload.hover()
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector("#expert-avatar-upload > span[aria-hidden]")
          ).opacity === "1"
      )
      await select()
      await preview().waitFor({ state: "visible" })
      assert.match(await preview().getAttribute("src"), /^blob:/)
      assert.equal(
        await preview().evaluate((el) => getComputedStyle(el).borderRadius),
        layout.inputRadius
      )
      assert.equal(writes.length, 0, "choosing an image must not send a write")
      await dialog().locator("#expert-authorization").click()
      await page
        .getByRole("checkbox", { name: "根分组", exact: true })
        .uncheck()
      await page.keyboard.press("Escape")
      await page
        .getByRole("checkbox", { name: "根分组", exact: true })
        .waitFor({ state: "hidden" })
      await dialog().locator("#expert-name").fill("保留手动清空的授权")
      assert(
        !(await dialog().locator("#expert-authorization").innerText()).includes(
          "根分组"
        )
      )
      await close()
      await create()
      assert.equal(
        await preview().count(),
        0,
        "cancel must discard avatar draft"
      )
      await select(Buffer.alloc(1024 * 1024 + 1))
      await dialog().getByRole("alert").filter({ hasText: "1 MiB" }).waitFor()
      assert.equal(await preview().count(), 0)
      await select(Buffer.from("<svg/>"), "avatar.svg", "image/svg+xml")
      await dialog().getByRole("alert").filter({ hasText: "PNG" }).waitFor()
      await select()
      await dialog().locator("#expert-name").fill("新建头像专家")
      await dialog().locator("#expert-description").fill("新建说明")
      await dialog().locator("#expert-prompt").fill("新建提示词")
      failNext = true
      await dialog().getByRole("button", { name: "创建", exact: true }).click()
      await page.getByText("模拟头像保存失败", { exact: true }).waitFor()
      assert.equal(writes.length, 1)
      assert.equal(items.length, 2)
      assert.match(await preview().getAttribute("src"), /^blob:/)
      assert.equal(
        await dialog().locator("#expert-name").inputValue(),
        "新建头像专家"
      )
      holdNext = true
      await dialog().getByRole("button", { name: "创建", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector("#expert-avatar-upload")?.disabled
      )
      assert(await dialog().locator("#expert-name").isDisabled())
      assert(
        await dialog()
          .getByRole("button", { name: "取消", exact: true })
          .isDisabled()
      )
      await page.keyboard.press("Escape")
      assert(await dialog().isVisible(), "pending save must keep draft mounted")
      assert(release)
      release()
      await dialog().waitFor({ state: "hidden" })
      await page.getByTitle("新建头像专家", { exact: true }).waitFor()
      assert.equal(writes.length, 2)
      assert.equal(writes[1].method, "POST")
      assert.equal(writes[1].match, undefined)
      assert(writes[1].multipart)
      assert.equal(writes[1].avatar.size, png.length)
      assert.equal(writes[1].metadata.prompt, "新建提示词")
      assert.deepEqual(writes[1].metadata.grants, [
        { group_id: "root", usage_requirement: "optional" },
      ])
      const image = cardImage("新建头像专家")
      await image.waitFor({ state: "visible" })
      const sizes = await image.evaluate((el) => {
        const image = el.getBoundingClientRect(),
          outer = el.parentElement.getBoundingClientRect()
        return [
          image.width,
          image.height,
          outer.width,
          outer.height,
          image.left - outer.left,
          image.top - outer.top,
        ]
      })
      assert.deepEqual(sizes, [36, 36, 40, 40, 2, 2])
      await edit("普通专家")
      assert(
        !(await dialog().locator("#expert-authorization").innerText()).includes(
          "根分组"
        ),
        "editing must preserve the original empty scope"
      )
      await preview().waitFor({ state: "visible" })
      assert(
        (await preview().getAttribute("src")).includes(
          "ordinary/avatar?v=initial"
        )
      )
      await select(webp, "avatar.webp", "image/webp")
      assert.equal(writes.length, 2)
      assert(
        (await cardImage("普通专家").getAttribute("src")).includes("v=initial")
      )
      await dialog().locator("#expert-name").fill("已换头像专家")
      await dialog().getByRole("button", { name: "保存", exact: true }).click()
      await dialog().waitFor({ state: "hidden" })
      await page.getByTitle("已换头像专家", { exact: true }).waitFor()
      assert.equal(writes[2].match, '"1"')
      assert.equal(writes[2].avatar.type, "image/webp")
      assert.deepEqual(writes[2].metadata.grants, [])
      assert(
        (await cardImage("已换头像专家").getAttribute("src")).includes("v=2")
      )
      // A subsequent edit without choosing an image stays JSON and preserves the path.
      await edit("已换头像专家")
      await dialog().locator("#expert-description").fill("仅修改说明")
      await dialog().getByRole("button", { name: "保存", exact: true }).click()
      await dialog().waitFor({ state: "hidden" })
      assert.equal(writes[3].multipart, false)
      assert.equal(writes[3].match, '"2"')
      assert(
        (await cardImage("已换头像专家").getAttribute("src")).includes("v=2")
      )
      await edit("资源包专家")
      assert(await dialog().locator("#expert-avatar-upload").isDisabled())
      assert(await dialog().locator("#expert-avatar-file").isDisabled())
      assert(await dialog().locator("#expert-tags").isDisabled())
      assert(!(await dialog().locator("#expert-authorization").isDisabled()))
      assert(
        !(await dialog().locator("#expert-name").isDisabled()),
        "package name overrides remain editable"
      )
      if (process.env.SCREENSHOT_DIR) {
        await close()
        await edit("已换头像专家")
        await preview().waitFor({ state: "visible" })
        await page.waitForFunction(() => {
          const popup = document.querySelector('[role="dialog"]')
          return (
            popup &&
            popup
              .getAnimations({ subtree: true })
              .every((animation) => animation.playState !== "running")
          )
        })
        await mkdir(process.env.SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({
          path: path.join(
            process.env.SCREENSHOT_DIR,
            `expert-avatar-${width}-${dark ? "dark" : "light"}.png`
          ),
        })
      }
      assert.deepEqual(errors, [])
      console.log(
        `PASS expert avatar ${width} ${dark ? "dark" : "light"}: local preview/cancel, size/format errors, create/retry, pending locks, replacement/version, JSON preservation, package read-only and 36/40px card geometry`
      )
      await page.close()
    }
} finally {
  await browser.close()
}
