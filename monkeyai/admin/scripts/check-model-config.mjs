import assert from "node:assert/strict"
import { chromium } from "playwright-core"
import { fileURLToPath } from "node:url"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const original = {
  id: "model1",
  ownership_type: "system",
  user: { id: "admin", name: "管理员", email: "admin@example.com" },
  model_id: "original-model",
  display_name: "原有自定义名称",
  kind: "text",
  provider: "passthrough",
  protocol: "anthropic",
  base_url: "https://models.example.com/v1",
  proxy_id: "test-proxy",
  api_key_configured: true,
  advanced_config: {
    context_window_tokens: 128000,
    max_output_tokens: 8192,
    supports_vision: true,
    supports_reasoning: true,
  },
  credit_multiplier: 2.5,
  authorization: { group_ids: ["group1"], user_ids: [] },
  enabled: true,
}
const scenarios = [
  { name: "add-defaults" },
  { name: "add-auto-follow", follow: true },
  { name: "add-custom-preserved", customName: true },
  { name: "add-clear-and-follow", clearFollow: true },
  { name: "add-empty-name-fallback", emptyName: true },
  { name: "edit-preserve", edit: true },
  { name: "edit-id-preserve-custom", edit: true, customName: true },
  {
    name: "edit-empty-name-follows",
    edit: true,
    emptyStoredName: true,
    follow: true,
  },
  { name: "advanced-values-retained", customAdvanced: true },
  { name: "invalid-hidden-context", invalid: "model-context-size", bad: "" },
  {
    name: "invalid-hidden-output",
    invalid: "model-max-output-tokens",
    bad: "0",
  },
  { name: "invalid-hidden-multiplier", invalid: "model-multiplier", bad: "-1" },
  { name: "invalid-hidden-step", invalid: "model-multiplier", bad: "1.005" },
  {
    name: "basic-validation-before-hidden",
    invalid: "model-context-size",
    bad: "0",
    basicFirst: true,
  },
  { name: "mobile-defaults", width: 390, screenshots: true },
  { name: "image-auto-name", kind: "image", useDefaultRates: true },
  { name: "video-auto-name", kind: "video", useDefaultRates: true },
  {
    name: "video-default-aliases",
    kind: "video",
    useDefaultRates: true,
    allVideoResolutionAliases: true,
  },
  { name: "default-root-delayed", delayedScope: true },
  { name: "clear-root-does-not-reselect", clearScope: true },
  { name: "edit-preserve-scope", edit: true, nonRootScope: true },
  { name: "edit-empty-scope-stays-empty", edit: true, emptyScope: true },
  { name: "edit-image-all-supported", edit: true, kind: "image" },
  {
    name: "edit-image-invalid-default-fallback",
    edit: true,
    kind: "image",
    invalidDefaults: true,
  },
  { name: "edit-video-all-modes", edit: true, kind: "video" },
  { name: "image-invalid-price", kind: "image", invalidImagePrice: true },
  { name: "image-capability-skeleton", kind: "image", capabilityCheck: true },
  {
    name: "image-capability-failure-retry",
    kind: "image",
    capabilityCheck: true,
    capabilityFailure: true,
  },
  { name: "video-capability-skeleton", kind: "video", capabilityCheck: true },
  {
    name: "video-capability-failure-retry",
    kind: "video",
    capabilityCheck: true,
    capabilityFailure: true,
  },
  { name: "mobile-image", kind: "image", width: 390, screenshots: true },
  { name: "mobile-video", kind: "video", width: 390, screenshots: true },
  {
    name: "edit-image-new-quality-needs-price",
    edit: true,
    kind: "image",
    missingImageRates: true,
  },
  { name: "discovery-openai-responses", discover: true },
  {
    name: "discovery-openai-chat",
    discover: true,
    discoveryProtocol: "openai_chat_completions",
  },
  { name: "discovery-saved-key-anthropic", edit: true, discover: true },
  {
    name: "discovery-custom-name-preserved",
    discover: true,
    discoveryCustomName: true,
  },
  { name: "discovery-empty", discover: true, discoveryEmpty: true },
  { name: "discovery-error-retry", discover: true, discoveryError: true },
  {
    name: "discovery-missing-credentials",
    discover: true,
    missingCredentials: true,
  },
  {
    name: "discovery-close-cancels-stale-request",
    discover: true,
    cancelDiscovery: true,
  },
  { name: "discovery-keyboard", discover: true, discoveryKeyboard: true },
  {
    name: "discovery-mobile-long-model-list",
    discover: true,
    longModels: true,
    width: 390,
  },
  {
    name: "discovery-protocol-change-cancels",
    discover: true,
    changeDiscoveryProtocol: true,
  },
  {
    name: "discovery-mobile-arabic",
    discover: true,
    longModels: true,
    width: 390,
    language: "ar",
    dark: true,
  },
]
if (!process.env.CHROME_BIN)
  throw new Error("请设置 CHROME_BIN；先执行 pnpm build")
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
const fill = (page, id, value) =>
  page.evaluate(
    ({ id, value }) => {
      const input = document.getElementById(id)
      assertInput(input, id)
      function assertInput(input, id) {
        if (!input) throw Error(`Missing ${id}`)
      }
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    },
    { id, value }
  )
const click = (page, selector) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (!el) throw Error(`Missing ${selector}`)
    el.click()
  }, selector)
const realClick = async (page, selector) => {
  await page.evaluate(
    (selector) =>
      document.querySelector(selector)?.scrollIntoView({ block: "nearest" }),
    selector
  )
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.evaluate((selector) => {
    delete document.querySelector(selector).__testClickRect
  }, selector)
  await page.waitForFunction((selector) => {
    const el = document.querySelector(selector),
      r = el?.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return false
    const box = [r.left, r.top, r.width, r.height].join(","),
      previous = el.__testClickRect
    el.__testClickRect = {
      box,
      count: previous?.box === box ? previous.count + 1 : 0,
    }
    return (
      el.__testClickRect.count >= 3 &&
      el.contains(
        document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      )
    )
  }, selector)
  const point = await page.evaluate((selector) => {
    const r = document.querySelector(selector).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, selector)
  await page.mouse.click(point.x, point.y)
}
const closed = (page) =>
  page.waitForFunction(
    () =>
      document
        .getElementById("model-advanced-trigger")
        ?.getAttribute("aria-expanded") === "false"
  )
const opened = (page) =>
  page.waitForFunction(
    () =>
      document
        .getElementById("model-advanced-trigger")
        ?.getAttribute("aria-expanded") === "true"
  )
try {
  const selectedScenarios = scenarios.filter(
    (scenario) =>
      !process.env.SCENARIO_FILTER ||
      scenario.name.includes(process.env.SCENARIO_FILTER)
  )
  for (const scenario of selectedScenarios) {
    const page = await browser.newPage({
      viewport: { width: scenario.width || 1440, height: 900 },
      locale: "zh-CN",
    })
    page.setDefaultTimeout(8000)
    await page.addInitScript(
      ({ language, dark }) => {
        localStorage.setItem("monkeyai-admin-language", language)
        localStorage.setItem("theme", dark ? "dark" : "light")
      },
      { language: scenario.language || "zh-CN", dark: scenario.dark || false }
    )
    const writes = [],
      errors = [],
      consoleErrors = [],
      discoveries = [],
      discoveryReleases = [],
      capabilityReleases = []
    const menu = '[data-slot="dropdown-menu-content"]'
    const setProtocol = async (value) => {
      await realClick(page, "#model-protocol")
      await page.waitForFunction(
        (value) =>
          [...document.querySelectorAll('[role="option"]')].some(
            (el) =>
              el.dataset.value === value ||
              el.textContent.includes(
                value === "anthropic"
                  ? "Anthropic"
                  : value === "openai_chat_completions"
                    ? "Chat Completions"
                    : "Responses"
              )
          ),
        value
      )
      const selector = await page.evaluate((value) => {
        const el = [...document.querySelectorAll('[role="option"]')].find(
          (el) =>
            el.textContent.includes(
              value === "anthropic"
                ? "Anthropic"
                : value === "openai_chat_completions"
                  ? "Chat Completions"
                  : "Responses"
            )
        )
        el.setAttribute("data-test-protocol-option", "target")
        return '[data-test-protocol-option="target"]'
      }, value)
      await realClick(page, selector)
    }
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    const kind = scenario.kind || "text"
    const videoDefaultPrices = {
      "720p": "40",
      "480p": "20",
      "1080p": "80",
      "720P": "40",
      "1080P": "80",
      "768P": "40",
      "1K": "80",
      "2K": "160",
      "4k": "320",
      "4K": "320",
    }
    const videoResolutionChoices = scenario.allVideoResolutionAliases
      ? Object.keys(videoDefaultPrices)
      : ["720p", "480p", "1080p"]
    const fixture = structuredClone(original)
    if (scenario.emptyStoredName) fixture.display_name = ""
    if (kind === "image")
      Object.assign(fixture, {
        kind,
        provider: "openai_images",
        protocol: "image_generation",
        image_config: {
          qualities: ["1K", "2K", "4K"],
          aspect_ratios: ["16:9"],
          default_quality: scenario.invalidDefaults ? "unknown" : "2K",
          default_aspect_ratio: scenario.invalidDefaults ? "99:1" : "16:9",
        },
        image_pricing: {
          rates: [
            { quality: "1K", credits_per_image: "0" },
            { quality: "2K", credits_per_image: "7.123456" },
            { quality: "4K", credits_per_image: "19" },
          ],
        },
      })
    if (kind === "video")
      Object.assign(fixture, {
        kind,
        provider: "xai",
        protocol: "video_generation",
        model_id: "grok-imagine-video-1.5",
        video_config: {
          modes: ["text_to_video"],
          defaults: {
            text_to_video: {
              resolution: "720p",
              duration: 8,
              watermark: false,
            },
          },
        },
        video_pricing: {
          rates: [
            { resolution: "720p", credits_per_second: "2.5" },
            { resolution: "480p", credits_per_second: "1.25" },
            { resolution: "1080p", credits_per_second: "3.5" },
          ],
        },
      })
    if (scenario.missingImageRates) {
      fixture.image_config.qualities = ["2K"]
      fixture.image_pricing.rates = fixture.image_pricing.rates.filter(
        (rate) => rate.quality === "2K"
      )
    }
    if (scenario.nonRootScope) fixture.authorization.group_ids = ["child-group"]
    if (scenario.emptyScope) fixture.authorization.group_ids = []
    await page.route("**/*", async (route) => {
      const request = route.request(),
        p = new URL(request.url()).pathname
      const json = (body) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(body),
        })
      if (p.startsWith("/api/")) {
        if (p.endsWith("/models/discover")) {
          const index = discoveries.length
          discoveries.push(request.postDataJSON())
          await new Promise((resolve) => (discoveryReleases[index] = resolve))
          if (scenario.discoveryError && index === 0)
            return route
              .fulfill({
                status: 502,
                contentType: "application/json",
                body: JSON.stringify({ error: { message: "测试上游不可用" } }),
              })
              .catch(() => {})
          const models = scenario.discoveryEmpty
            ? []
            : scenario.longModels
              ? Array.from({ length: 1000 }, (_, i) => ({
                  id: `remote-${String(i).padStart(4, "0")}-${"long-model-".repeat(15)}`,
                }))
              : [
                  {
                    id:
                      scenario.cancelDiscovery && index === 0
                        ? "stale-model"
                        : "remote-model-a",
                  },
                  { id: "remote-model-b" },
                ]
          return route
            .fulfill({
              contentType: "application/json",
              body: JSON.stringify({ models }),
            })
            .catch(() => {})
        }
        if (request.method() !== "GET") {
          assert.ok(
            p === "/api/admin/v1/models" || p === "/api/admin/v1/models/model1"
          )
          writes.push({
            method: request.method(),
            body: request.postDataJSON(),
          })
          return json(fixture)
        }
        if (p.endsWith("/session"))
          return json({
            authenticated: true,
            user: {
              id: "admin",
              name: "测试管理员",
              email: "test@example.com",
              role: "admin",
              status: "active",
            },
          })
        if (p.endsWith("/branding"))
          return json({ product_name: "MonkeyAI", workspace_name: "测试团队" })
        if (p.endsWith("/license/status")) return json({ state: "valid" })
        if (p.endsWith("/version") || p.endsWith("/version/release"))
          return json({ version: "1" })
        if (p.endsWith("/settings"))
          return json({
            settings: [
              {
                key: "proxies",
                value: {
                  proxies: [
                    {
                      id: "test-proxy",
                      name: "测试代理",
                      url: "http://proxy.test:8080",
                    },
                  ],
                },
              },
            ],
          })
        if (p.endsWith("/models/authorization-subjects")) {
          if (scenario.delayedScope)
            await new Promise((resolve) => setTimeout(resolve, 800))
          return json({
            groups: [
              { id: "group1", name: "测试分组" },
              { id: "child-group", parent_id: "group1", name: "测试子分组" },
            ],
            users: [],
          })
        }
        if (
          scenario.capabilityCheck &&
          (p.endsWith("/models/image-capabilities") ||
            p.endsWith("/models/video-capabilities"))
        ) {
          const index = capabilityReleases.length
          await new Promise((resolve) => (capabilityReleases[index] = resolve))
          if (scenario.capabilityFailure && index === 0)
            return route
              .fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                  error: { message: "测试能力接口失败" },
                }),
              })
              .catch(() => {})
        }
        if (p.endsWith("/models/image-capabilities"))
          return json({
            qualities: ["1K", "2K", "4K"],
            aspect_ratios: ["1:1", "16:9"],
            operations: ["generate"],
            max_images: 1,
            max_reference_images: 0,
            supports_reference_image: false,
            supports_mask: false,
          })
        if (p.endsWith("/models/video-capabilities"))
          return json({
            modes: ["text_to_video", "image_to_video"],
            params: [
              {
                name: "resolution",
                type: "string",
                choices: videoResolutionChoices,
              },
              { name: "duration", type: "integer", min: 5, max: 30 },
              { name: "watermark", type: "boolean" },
            ],
          })
        if (p.endsWith("/models"))
          return json({
            models: scenario.edit ? [fixture] : [],
            next_cursor: null,
          })
        return json({ items: [] })
      }
      const f = path.resolve(dist, `.${p}`),
        exists =
          f.startsWith(dist) &&
          (await stat(f)
            .then((s) => s.isFile())
            .catch(() => false))
      const file = exists ? f : path.join(dist, "index.html"),
        types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".webp": "image/webp",
          ".woff2": "font/woff2",
          ".json": "application/json",
        }
      return route.fulfill({
        contentType: types[path.extname(file)] || "application/octet-stream",
        body: await readFile(file),
      })
    })
    try {
      await page.goto("http://advanced.test/console/resources/models")
      if (scenario.edit) {
        await page.waitForFunction(() =>
          document.querySelector('[data-slot="card"] button[aria-label="更多"]')
        )
        await click(page, '[data-slot="card"] button[aria-label="更多"]')
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[role="menuitem"]')].some(
            (el) => el.textContent.trim() === "修改"
          )
        )
        await page.evaluate(() =>
          [...document.querySelectorAll('[role="menuitem"]')]
            .find((el) => el.textContent.trim() === "修改")
            .click()
        )
      } else {
        const addLabel =
          scenario.language === "ar" ? "إضافة نموذج" : "添加大模型"
        await page.waitForFunction(
          (label) =>
            [...document.querySelectorAll("button")].some(
              (el) => el.textContent.trim() === label
            ),
          addLabel
        )
        await page.evaluate(
          (label) =>
            [...document.querySelectorAll("button")]
              .find((el) => el.textContent.trim() === label)
              .click(),
          addLabel
        )
      }
      await page.waitForFunction(() =>
        document.getElementById("model-advanced-trigger")
      )
      await closed(page)
      const structure = await page.evaluate(
        (currentKind) => {
          const ids = [
            "model-display-name",
            "model-proxy",
            ...(currentKind === "text"
              ? [
                  "model-context-size",
                  "model-max-output-tokens",
                  "model-multiplier",
                ]
              : []),
          ]
          const field = document.getElementById("model-id"),
            base = document.getElementById("model-base-url"),
            key = document.getElementById("model-api-key"),
            protocol = document.getElementById(
              currentKind === "text"
                ? "model-protocol"
                : currentKind === "image"
                  ? "model-provider"
                  : "video-model"
            )
          return {
            baseTop: base.getBoundingClientRect().top,
            keyTop: key.getBoundingClientRect().top,
            nested: ids.every((id) =>
              document.getElementById(id)?.closest("#model-advanced-options")
            ),
            hidden:
              getComputedStyle(
                document.getElementById("model-advanced-options")
              ).display === "none",
            label: document
              .querySelector('label[for="model-id"]')
              .textContent.trim(),
            modelTop: field.getBoundingClientRect().top,
            protocolTop: protocol.getBoundingClientRect().top,
            modelRight: field.getBoundingClientRect().right,
            protocolLeft: protocol.getBoundingClientRect().left,
            hint: document
              .querySelector('[data-slot="dialog-content"]')
              .textContent.includes("留空时使用"),
          }
        },
        scenario.edit ? kind : "text"
      )
      assert.equal(structure.nested, true)
      assert.equal(structure.hidden, true)
      assert.equal(
        structure.label,
        scenario.language === "ar" ? "اسم النموذج" : "模型名称"
      )
      assert.equal(structure.hint, false)
      assert.ok(structure.baseTop > structure.protocolTop)
      if (scenario.width) {
        assert.ok(structure.protocolTop > structure.modelTop)
        assert.ok(structure.keyTop > structure.baseTop)
      } else {
        assert.ok(Math.abs(structure.protocolTop - structure.modelTop) < 1)
        assert.ok(structure.protocolLeft > structure.modelRight)
        assert.ok(Math.abs(structure.baseTop - structure.keyTop) < 1)
      }
      let expectedId = scenario.edit ? fixture.model_id : "new-model",
        expectedName =
          scenario.edit && !scenario.emptyStoredName
            ? "原有自定义名称"
            : expectedId
      if (!scenario.edit) {
        if (kind !== "text")
          await page.evaluate(
            (kind) =>
              [...document.querySelectorAll('[role="tab"]')]
                .find(
                  (el) =>
                    el.textContent.trim() ===
                    (kind === "image" ? "生图模型" : "视频模型")
                )
                .click(),
            kind
          )
        if (kind !== "video") await fill(page, "model-id", expectedId)
        else {
          expectedId = "grok-imagine-video-1.5"
          expectedName = expectedId
        }
        await fill(page, "model-base-url", "https://models.example.com/v1")
        await fill(page, "model-api-key", "test-key")
        await page.waitForFunction(() =>
          document
            .getElementById("model-authorization")
            .textContent.includes("测试分组")
        )
      }
      if (scenario.discover) {
        if (scenario.discoveryProtocol)
          await setProtocol(scenario.discoveryProtocol)
        if (scenario.discoveryCustomName) {
          await click(page, "#model-advanced-trigger")
          await opened(page)
          await fill(page, "model-display-name", "自定义展示名称")
          await click(page, "#model-advanced-trigger")
          await closed(page)
          expectedName = "自定义展示名称"
        }
        if (scenario.missingCredentials) {
          await fill(page, "model-base-url", "")
          await fill(page, "model-api-key", "")
          await realClick(page, "#model-discovery-trigger")
          await page.waitForFunction(() =>
            document
              .querySelector('[role="alert"]')
              ?.textContent.includes("请先填写 Base URL 和密钥")
          )
          assert.equal(discoveries.length, 0)
          await realClick(page, "#model-discovery-trigger")
          await fill(page, "model-base-url", "https://models.example.com/v1")
          await fill(page, "model-api-key", "test-key")
        }
        await realClick(page, "#model-discovery-trigger")
        await page.waitForFunction(() =>
          document.querySelector(
            '[data-slot="dropdown-menu-content"] [role="status"]'
          )
        )
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-slot="dropdown-menu-content"]')
              ?.getBoundingClientRect().height > 0
        )
        await page.waitForTimeout(250)
        const loading = await page.evaluate(() => {
          const menu = document.querySelector(
              '[data-slot="dropdown-menu-content"]'
            ),
            a = document.getElementById("model-id").getBoundingClientRect(),
            r = menu.getBoundingClientRect()
          return {
            height: r.height,
            width: r.width,
            inputWidth: a.width,
            left: r.left,
            right: r.right,
            view: innerWidth,
            items: menu.querySelectorAll('[role="menuitem"]').length,
            text: menu.textContent.trim(),
            spinners: menu.querySelectorAll("svg.animate-spin").length,
          }
        })
        assert.ok(loading.height <= 46, JSON.stringify(loading))
        assert.ok(
          Math.abs(loading.width - loading.inputWidth) < 2,
          JSON.stringify(loading)
        )
        assert.ok(loading.left >= 0 && loading.right <= loading.view)
        assert.equal(loading.items, 0)
        assert.equal(loading.text, "")
        assert.equal(loading.spinners, 1)
        while (!discoveryReleases[0]) await page.waitForTimeout(10)
        assert.equal(
          discoveries[0].protocol,
          scenario.discoveryProtocol ||
            (scenario.edit ? "anthropic" : "openai_responses")
        )
        assert.equal(discoveries[0].base_url, "https://models.example.com/v1")
        assert.equal(discoveries[0].api_key, scenario.edit ? "" : "test-key")
        assert.equal(discoveries[0].proxy_id, scenario.edit ? "test-proxy" : "")
        assert.equal(
          discoveries[0].model_resource_id,
          scenario.edit ? "model1" : undefined
        )
        if (scenario.changeDiscoveryProtocol) {
          await page.keyboard.press("Escape")
          await setProtocol("anthropic")
          discoveryReleases[0]()
          await page.waitForFunction(
            () =>
              !document
                .getElementById("model-discovery-trigger")
                .getAttribute("aria-expanded") ||
              document
                .getElementById("model-discovery-trigger")
                .getAttribute("aria-expanded") === "false"
          )
          await realClick(page, "#model-discovery-trigger")
          while (!discoveryReleases[1]) await page.waitForTimeout(10)
          assert.equal(discoveries[1].protocol, "anthropic")
          discoveryReleases[1]()
        } else if (scenario.cancelDiscovery) {
          await page.keyboard.press("Escape")
          await fill(page, "model-base-url", "https://changed.example.com/v1")
          await fill(page, "model-api-key", "changed-key")
          await realClick(page, "#model-discovery-trigger")
          while (!discoveryReleases[1]) await page.waitForTimeout(10)
          assert.equal(
            discoveries[1].base_url,
            "https://changed.example.com/v1"
          )
          assert.equal(discoveries[1].api_key, "changed-key")
          discoveryReleases[0]()
          assert.equal(
            await page.evaluate(
              () =>
                document.querySelectorAll(
                  '[data-slot="dropdown-menu-content"] [role="menuitem"]'
                ).length
            ),
            0
          )
          discoveryReleases[1]()
        } else {
          discoveryReleases[0]()
        }
        if (scenario.discoveryError) {
          await page.waitForFunction(() =>
            document
              .querySelector('[role="alert"]')
              ?.textContent.includes("测试上游不可用")
          )
          assert.equal(writes.length, 0)
          await realClick(page, "#model-discovery-trigger")
          await realClick(page, "#model-discovery-trigger")
          while (!discoveryReleases[1]) await page.waitForTimeout(10)
          discoveryReleases[1]()
        }
        if (scenario.discoveryEmpty) {
          await page.waitForFunction(() =>
            document
              .querySelector('[data-slot="dropdown-menu-content"]')
              ?.textContent.includes("未获取到可用模型")
          )
          await page.keyboard.press("Escape")
        } else {
          await page.waitForFunction(
            () =>
              document.querySelectorAll(
                '[data-slot="dropdown-menu-content"] [role="menuitem"]'
              ).length > 0
          )
          expectedId = scenario.longModels
            ? `remote-0000-${"long-model-".repeat(15)}`
            : "remote-model-a"
          if (!scenario.edit && !scenario.discoveryCustomName)
            expectedName = expectedId
          if (scenario.longModels) {
            const rect = await page.evaluate(() => {
              const r = document
                .querySelector('[data-slot="dropdown-menu-content"]')
                .getBoundingClientRect()
              return {
                height: r.height,
                left: r.left,
                right: r.right,
                width: innerWidth,
              }
            })
            assert.ok(
              rect.height <= 258 && rect.left >= 0 && rect.right <= rect.width
            )
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
              ),
              false
            )
          }
          if (scenario.discoveryKeyboard) {
            await page.keyboard.press("ArrowDown")
            await page.keyboard.press("Enter")
          } else await realClick(page, `${menu} [role="menuitem"]`)
          await page.waitForFunction(
            () =>
              !document.querySelector(
                '[data-slot="dropdown-menu-content"] [role="menuitem"]'
              )
          )
          assert.equal(await page.inputValue("#model-id"), expectedId)
          assert.equal(
            await page.inputValue("#model-display-name"),
            expectedName
          )
        }
      }
      if (scenario.clearScope || scenario.emptyScope) {
        if (scenario.clearScope) {
          await click(page, "#model-authorization")
          await page.waitForFunction(() =>
            document.querySelector(
              '[data-slot="popover-content"] [role="checkbox"]'
            )
          )
          await click(page, '[data-slot="popover-content"] [role="checkbox"]')
          await click(page, "#model-authorization")
        }
        await fill(page, "model-id", expectedId)
        assert.equal(
          await page.evaluate(() =>
            document
              .getElementById("model-authorization")
              .textContent.includes("测试分组")
          ),
          false
        )
        await click(page, '[data-slot="dialog-content"] button[type="submit"]')
        await page.waitForFunction(() =>
          [...document.querySelectorAll("ol[aria-live] li")].some((el) =>
            el.textContent.includes("请至少选择一个授权分组或用户")
          )
        )
        assert.equal(writes.length, 0)
        await click(page, "#model-authorization")
        await page.waitForFunction(() =>
          document.querySelector(
            '[data-slot="popover-content"] [role="checkbox"]'
          )
        )
        await click(page, '[data-slot="popover-content"] [role="checkbox"]')
        await click(page, "#model-authorization")
      }
      if (scenario.capabilityCheck) {
        const loadingSelector = "[data-model-pricing-loading]"
        const assertPending = async () => {
          await page.waitForFunction(() =>
            document.querySelector("[data-model-pricing-loading]")
          )
          assert.equal(
            await page.evaluate(() =>
              document
                .querySelector("[data-model-pricing-loading]")
                .getAttribute("aria-busy")
            ),
            "true"
          )
          assert.equal(
            await page.evaluate(
              () =>
                document.querySelectorAll(
                  '[data-model-pricing-loading] [data-slot="skeleton"]'
                ).length
            ),
            6
          )
          assert.equal(
            await page.evaluate(() =>
              document.querySelector(
                '[data-slot="dialog-content"] [role="alert"]'
              )
            ),
            null
          )
          assert.equal(
            await page.evaluate(
              () =>
                document.querySelector(
                  '[data-slot="dialog-content"] button[type="submit"]'
                ).disabled
            ),
            true
          )
          assert.equal(
            await page.evaluate(
              () =>
                document.querySelectorAll(
                  '[id^="image-rate-"], [id^="video-rate-"]'
                ).length
            ),
            0
          )
        }
        await assertPending()
        await click(page, '[data-slot="dialog-content"] button[type="submit"]')
        assert.equal(writes.length, 0)
        while (!capabilityReleases[0]) await page.waitForTimeout(10)
        await assertPending()
        await page.screenshot({
          path: `/tmp/monkeyai-model-${kind}-skeleton-${(await browser.version()).split(".")[0]}.png`,
        })
        capabilityReleases[0]()
        if (scenario.capabilityFailure) {
          await page.waitForFunction(() =>
            document.querySelector(
              '[data-slot="dialog-content"] [role="alert"]'
            )
          )
          assert.equal(
            await page.evaluate(
              (selector) => document.querySelector(selector),
              loadingSelector
            ),
            null
          )
          assert.equal(
            await page.evaluate(
              () =>
                document.querySelector(
                  '[data-slot="dialog-content"] button[type="submit"]'
                ).disabled
            ),
            false
          )
          await page.evaluate(() =>
            [...document.querySelectorAll('[role="tab"]')]
              .find((el) => el.textContent.trim() === "大语言模型")
              .click()
          )
          await page.waitForFunction(() =>
            document.getElementById("model-protocol")
          )
          await page.evaluate(
            (kind) =>
              [...document.querySelectorAll('[role="tab"]')]
                .find(
                  (el) =>
                    el.textContent.trim() ===
                    (kind === "image" ? "生图模型" : "视频模型")
                )
                .click(),
            kind
          )
          await assertPending()
          while (!capabilityReleases[1]) await page.waitForTimeout(10)
          capabilityReleases[1]()
        }
        await page.waitForFunction(
          (kind) =>
            document.querySelector(
              kind === "image" ? "#image-rate-1K" : "#video-rate-720p"
            ),
          kind
        )
        assert.equal(
          await page.evaluate(
            (selector) => document.querySelector(selector),
            loadingSelector
          ),
          null
        )
        assert.equal(
          await page.evaluate(() =>
            document.querySelector(
              '[data-slot="dialog-content"] [role="alert"]'
            )
          ),
          null
        )
        assert.equal(
          await page.evaluate(
            () =>
              document.querySelector(
                '[data-slot="dialog-content"] button[type="submit"]'
              ).disabled
          ),
          false
        )
      }
      if (kind !== "text") {
        const geometry = await page.evaluate((kind) => {
          const a = document.getElementById("model-id").getBoundingClientRect(),
            b = document
              .getElementById(
                kind === "image" ? "model-provider" : "video-model"
              )
              .getBoundingClientRect()
          return {
            top: a.top,
            otherTop: b.top,
            right: a.right,
            otherLeft: b.left,
          }
        }, kind)
        if (scenario.width) assert.ok(geometry.otherTop > geometry.top)
        else {
          assert.ok(Math.abs(geometry.otherTop - geometry.top) < 1)
          assert.ok(geometry.otherLeft > geometry.right)
        }
      }
      assert.equal(await page.inputValue("#model-display-name"), expectedName)
      if (scenario.follow) {
        for (const next of ["model-next", "model-final"]) {
          await fill(page, "model-id", next)
          assert.equal(await page.inputValue("#model-display-name"), next)
        }
        expectedId = expectedName = "model-final"
      }
      if (scenario.customName || scenario.clearFollow || scenario.emptyName) {
        await click(page, "#model-advanced-trigger")
        await opened(page)
        if (!scenario.edit)
          await fill(page, "model-display-name", "手工展示名称")
        if (scenario.customName) {
          await fill(page, "model-id", "renamed-model")
          expectedId = "renamed-model"
          expectedName = scenario.edit ? "原有自定义名称" : "手工展示名称"
          assert.equal(
            await page.inputValue("#model-display-name"),
            expectedName
          )
        } else {
          await fill(page, "model-display-name", "")
          if (scenario.clearFollow) {
            await fill(page, "model-id", "fallback-model")
            expectedId = expectedName = "fallback-model"
            assert.equal(
              await page.inputValue("#model-display-name"),
              expectedName
            )
          }
        }
        await click(page, "#model-advanced-trigger")
        await closed(page)
      }
      let expectedContext = scenario.edit ? 128000 : 256000,
        expectedOutput = scenario.edit ? 8192 : 16384,
        expectedMultiplier = scenario.edit ? 2.5 : 1,
        expectedProxy = scenario.edit ? "test-proxy" : ""
      if (scenario.customAdvanced) {
        await click(page, "#model-advanced-trigger")
        await opened(page)
        for (const [id, value] of [
          ["model-context-size", "512"],
          ["model-max-output-tokens", "32768"],
          ["model-multiplier", "1.75"],
        ])
          await fill(page, id, value)
        await click(page, "#model-proxy")
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[role="option"]')].some((el) =>
            el.textContent.includes("测试代理")
          )
        )
        await page.waitForFunction(() => {
          const el = [...document.querySelectorAll('[role="option"]')].find(
            (el) => el.textContent.includes("测试代理")
          )
          const r = el?.getBoundingClientRect()
          return (
            r &&
            r.width > 0 &&
            r.height > 0 &&
            el.contains(
              document.elementFromPoint(
                r.left + r.width / 2,
                r.top + r.height / 2
              )
            )
          )
        })
        const optionPoint = await page.evaluate(() => {
          const r = [...document.querySelectorAll('[role="option"]')]
            .find((el) => el.textContent.includes("测试代理"))
            .getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        })
        await page.mouse.click(optionPoint.x, optionPoint.y)
        await page.waitForFunction(
          () =>
            new FormData(
              document.querySelector('[data-slot="dialog-content"] form')
            ).get("proxyId") === "test-proxy"
        )
        await click(page, "#model-advanced-trigger")
        await closed(page)
        await click(page, "#model-advanced-trigger")
        await opened(page)
        assert.equal(await page.inputValue("#model-context-size"), "512")
        assert.equal(await page.inputValue("#model-multiplier"), "1.75")
        await click(page, "#model-advanced-trigger")
        await closed(page)
        expectedContext = 512000
        expectedOutput = 32768
        expectedMultiplier = 1.75
        expectedProxy = "test-proxy"
      }
      if (scenario.invalid) {
        await click(page, "#model-advanced-trigger")
        await opened(page)
        await fill(page, scenario.invalid, scenario.bad)
        await click(page, "#model-advanced-trigger")
        await closed(page)
        if (scenario.basicFirst) {
          await fill(page, "model-id", "")
          await click(
            page,
            '[data-slot="dialog-content"] button[type="submit"]'
          )
          await page.waitForFunction(
            () => document.activeElement?.id === "model-id"
          )
          await closed(page)
          await fill(page, "model-id", expectedId)
        }
        await click(page, '[data-slot="dialog-content"] button[type="submit"]')
        await opened(page)
        await page.waitForFunction(
          (id) => document.activeElement?.id === id,
          scenario.invalid
        )
        assert.equal(writes.length, 0)
        await fill(
          page,
          scenario.invalid,
          scenario.invalid === "model-context-size"
            ? "256"
            : scenario.invalid === "model-max-output-tokens"
              ? "16384"
              : "1"
        )
        await click(page, "#model-advanced-trigger")
        await closed(page)
      }
      if (scenario.name === "add-defaults" || scenario.screenshots) {
        await page.waitForTimeout(150)
        await page.screenshot({
          path: `/tmp/monkeyai-model-advanced-${kind}-${scenario.width || 1440}-closed-${(await browser.version()).split(".")[0]}.png`,
        })
        await click(page, "#model-advanced-trigger")
        await opened(page)
        const labels = await page.evaluate(() => ({
          label: document
            .querySelector('label[for="model-proxy"]')
            .textContent.trim(),
          proxy: document.getElementById("model-proxy").textContent,
        }))
        assert.equal(labels.label, "网络代理")
        assert.ok(labels.proxy.includes("不使用代理"))
        await page.waitForTimeout(150)
        await page.screenshot({
          path: `/tmp/monkeyai-model-advanced-${kind}-${scenario.width || 1440}-open-${(await browser.version()).split(".")[0]}.png`,
        })
        await click(page, "#model-advanced-trigger")
        await closed(page)
      }
      if (kind === "image") {
        await page.waitForFunction(() =>
          document.getElementById("image-rate-4K")
        )
        const imageLabels = await page.evaluate(() =>
          ["1K", "2K", "4K"].map((quality) =>
            document
              .querySelector(`label[for="image-rate-${quality}"]`)
              .textContent.trim()
          )
        )
        assert.deepEqual(
          imageLabels,
          ["1K", "2K", "4K"].map((quality) => `每张图积分扣费 - ${quality}`)
        )
        if (scenario.missingImageRates) {
          assert.equal(await page.inputValue("#image-rate-1K"), "20")
          assert.equal(await page.inputValue("#image-rate-2K"), "7.123456")
          assert.equal(await page.inputValue("#image-rate-4K"), "80")
          await fill(page, "image-rate-1K", "")
          await click(
            page,
            '[data-slot="dialog-content"] button[type="submit"]'
          )
          assert.equal(writes.length, 0)
          await fill(page, "image-rate-1K", "0")
          await fill(page, "image-rate-4K", "19")
        } else if (scenario.edit) {
          for (const [quality, price] of [
            ["1K", "0"],
            ["2K", "7.123456"],
            ["4K", "19"],
          ])
            assert.equal(await page.inputValue(`#image-rate-${quality}`), price)
        } else {
          for (const [quality, price] of [
            ["1K", "20"],
            ["2K", "40"],
            ["4K", "80"],
          ])
            assert.equal(await page.inputValue(`#image-rate-${quality}`), price)
          if (!scenario.useDefaultRates)
            for (const [quality, price] of [
              ["1K", "0"],
              ["2K", "7.123456"],
              ["4K", "19"],
            ])
              await fill(page, `image-rate-${quality}`, price)
        }
        assert.equal(
          await page.evaluate(() =>
            document.getElementById("model-base-credits")
          ),
          null
        )
        assert.equal(
          await page.evaluate(() =>
            document.querySelector(
              "#quality-price-1K, #quality-price-2K, #quality-price-4K"
            )
          ),
          null
        )
        assert.equal(
          await page.evaluate(() =>
            [
              ...document.querySelectorAll(
                '[data-slot="dialog-content"] label'
              ),
            ].some((el) =>
              ["画质档位", "比例", "默认画质", "默认比例"].includes(
                el.textContent.trim()
              )
            )
          ),
          false
        )
        if (scenario.invalidImagePrice) {
          await fill(page, "image-rate-2K", "0.1234567")
          await click(
            page,
            '[data-slot="dialog-content"] button[type="submit"]'
          )
          await page.waitForFunction(() =>
            [...document.querySelectorAll("ol[aria-live] li")].some((el) =>
              el.textContent.includes("每种清晰度的单张积分必须为非负数")
            )
          )
          assert.equal(writes.length, 0)
          await fill(page, "image-rate-2K", "7.123456")
        }
      }
      if (kind === "video") {
        await page.waitForFunction(() =>
          document.getElementById("video-rate-720p")
        )
        assert.equal(
          await page.evaluate(() =>
            document
              .querySelector('[data-slot="dialog-content"]')
              .textContent.includes("开放模式")
          ),
          false
        )
        if (!scenario.edit) {
          for (const resolution of videoResolutionChoices)
            assert.equal(
              await page.inputValue(`#video-rate-${resolution}`),
              videoDefaultPrices[resolution]
            )
          if (!scenario.useDefaultRates)
            for (const resolution of ["720p", "480p", "1080p"])
              await fill(page, `video-rate-${resolution}`, "1")
        }
        const labels = await page.evaluate(() =>
          ["480p", "720p", "1080p"].map((resolution) =>
            document
              .querySelector(`label[for="video-rate-${resolution}"]`)
              .textContent.trim()
          )
        )
        assert.deepEqual(
          labels,
          ["480p", "720p", "1080p"].map(
            (resolution) => `每秒积分扣费 - ${resolution}`
          )
        )
        assert.equal(
          await page.evaluate(() =>
            document
              .querySelector('[data-slot="dialog-content"]')
              .textContent.includes("每秒积分（按清晰度）")
          ),
          false
        )
        assert.equal(
          await page.evaluate(
            () =>
              document.querySelectorAll(
                '[data-slot="dialog-content"] [data-slot="separator"]'
              ).length
          ),
          0
        )
      }
      assert.equal(
        await page.evaluate(() =>
          document
            .querySelector('[data-slot="dialog-content"] form')
            .checkValidity()
        ),
        true
      )
      await click(page, '[data-slot="dialog-content"] button[type="submit"]')
      await page.waitForFunction(() => !document.getElementById("model-id"))
      assert.equal(writes.length, 1)
      assert.equal(writes[0].method, scenario.edit ? "PUT" : "POST")
      const body = writes[0].body
      assert.equal(body.model_id, expectedId)
      assert.equal(body.display_name, expectedName)
      assert.equal(body.proxy_id, expectedProxy)
      assert.deepEqual(
        body.authorization.group_ids,
        scenario.nonRootScope ? ["child-group"] : ["group1"]
      )
      if (kind === "text") {
        assert.equal(
          body.advanced_config.context_window_tokens,
          expectedContext
        )
        assert.equal(body.advanced_config.max_output_tokens, expectedOutput)
        assert.equal(body.credit_multiplier, expectedMultiplier)
      }
      if (kind === "image") {
        assert.deepEqual(body.image_config.qualities, ["1K", "2K", "4K"])
        assert.deepEqual(body.image_config.aspect_ratios, ["1:1", "16:9"])
        assert.equal(
          body.image_config.default_quality,
          scenario.edit && !scenario.invalidDefaults ? "2K" : "1K"
        )
        assert.equal(
          body.image_config.default_aspect_ratio,
          scenario.edit && !scenario.invalidDefaults ? "16:9" : "1:1"
        )
        assert.deepEqual(body.image_pricing, {
          rates: scenario.useDefaultRates
            ? [
                { quality: "1K", credits_per_image: "20" },
                { quality: "2K", credits_per_image: "40" },
                { quality: "4K", credits_per_image: "80" },
              ]
            : [
                { quality: "1K", credits_per_image: "0" },
                { quality: "2K", credits_per_image: "7.123456" },
                { quality: "4K", credits_per_image: "19" },
              ],
        })
      }
      if (kind === "video") {
        assert.deepEqual(body.video_config.modes, [
          "text_to_video",
          "image_to_video",
        ])
        assert.deepEqual(body.video_config.defaults.text_to_video, {
          resolution: "720p",
          duration: scenario.edit ? 8 : 5,
          watermark: !scenario.edit,
        })
        assert.deepEqual(body.video_config.defaults.image_to_video, {
          resolution: "720p",
          duration: 5,
          watermark: true,
        })
        assert.equal(
          body.video_pricing.rates[0].credits_per_second,
          scenario.edit ? "2.5" : scenario.useDefaultRates ? "40" : "1"
        )
        assert.deepEqual(
          body.video_pricing.rates.map((rate) => rate.resolution),
          videoResolutionChoices
        )
        if (scenario.edit || scenario.useDefaultRates)
          assert.deepEqual(
            body.video_pricing.rates.map((rate) => rate.credits_per_second),
            scenario.edit
              ? ["2.5", "1.25", "3.5"]
              : videoResolutionChoices.map(
                  (resolution) => videoDefaultPrices[resolution]
                )
          )
      }
      assert.deepEqual(errors, [])
      assert.deepEqual(
        consoleErrors.filter((text) => text.includes("not focusable")),
        []
      )
      console.log("PASS", scenario.name)
    } catch (error) {
      await page.screenshot({ path: "/tmp/monkeyai-model-advanced-failed.png" })
      throw new Error(`${scenario.name}: ${error.message}`, { cause: error })
    } finally {
      for (const release of discoveryReleases) release?.()
      for (const release of capabilityReleases) release?.()
      await page.close()
    }
  }
  console.log(
    "PASSED",
    selectedScenarios.length,
    "scenarios",
    await browser.version()
  )
} finally {
  await browser.close()
}
