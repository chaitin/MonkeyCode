import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import {
  createTaskPreview,
  summarizeTaskPreview,
  taskOutcomes,
  taskPreviewOverview,
  taskPreviewModels,
  createSessionOverviewFixture,
  emptySessionOverviewFixture,
} from "./fixtures/task-analysis.ts"

const executablePath = process.env.CHROME_BIN
if (!executablePath) throw new Error("请设置 CHROME_BIN；先执行 npm run build")
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const routePath = "/console/statistics/session-reporting/tasks"
const overviewPath =
  "/api/admin/v1/statistics/session-reporting/sessions/overview"
const now = new Date("2026-11-03T12:00:00Z")
const turns = createTaskPreview(now)
const overview = taskPreviewOverview(turns, now)
const apiOverview = createSessionOverviewFixture(now)
const emptyOverview = emptySessionOverviewFixture(now)
const serverOverview = {
  ...emptyOverview,
  total_sessions: 100,
  new_sessions_24h: 2,
  active_sessions_24h: 10,
  total_messages: 1000,
  last_24h: {
    ...emptyOverview.last_24h,
    messages: 25,
    outcomes: { ...emptyOverview.last_24h.outcomes, complete: 25 },
    duration_seconds: { average: 0, p10: 0, p90: 0 },
    messages_per_session: { average: 2.5, p10: 1, p90: 4 },
    models: [{ id: null, name: null, messages: 25 }],
  },
  days: emptyOverview.days.map((day, index) =>
    index === 89
      ? { ...day, new_sessions: 2, active_sessions: 10, messages: 25 }
      : day
  ),
}
const recentTurns = turns.filter(
  (turn) =>
    Date.parse(turn.startedAt) >= now.getTime() - 86_400_000 &&
    Date.parse(turn.startedAt) < now.getTime()
)
const last24h = recentTurns.length
const rankedModels = taskPreviewModels
  .map((model) => ({
    id: model.id,
    total: recentTurns.filter((turn) => turn.modelId === model.id).length,
  }))
  .filter((model) => model.total > 0)
  .sort((a, b) => b.total - a.total)
const otherIDs =
  rankedModels.length > 4 ? rankedModels.slice(3).map((model) => model.id) : []
const expectedLegend = otherIDs.length
  ? [
      ...rankedModels.slice(0, 3),
      {
        id: "other",
        total: rankedModels
          .slice(3)
          .reduce((sum, model) => sum + model.total, 0),
      },
    ]
  : rankedModels
const expected24h = summarizeTaskPreview(recentTurns)
const sessionMessageCounts = [
  ...new Set(recentTurns.map((turn) => turn.taskId)),
]
  .map((id) => recentTurns.filter((turn) => turn.taskId === id).length)
  .sort((a, b) => a - b)
const messageMetricLabels = ["平均消息数", "P10 消息数", "P90 消息数"]
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
try {
  for (const [width, theme] of [
    [1440, "light"],
    [1440, "dark"],
    [390, "dark"],
    [320, "light"],
  ]) {
    if (process.env.WIDTH && Number(process.env.WIDTH) !== width) continue
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      locale: "zh-CN",
      timezoneId: process.env.BROWSER_TIMEZONE || "Asia/Shanghai",
      reducedMotion: "reduce",
    })
    page.setDefaultTimeout(15000)
    await page.clock.setFixedTime(now)
    await page.addInitScript((theme) => {
      localStorage.setItem("monkeyai-admin-language", "zh-CN")
      localStorage.setItem("theme", theme)
    }, theme)
    const errors = [],
      apiRequests = []
    let mode = "success"
    let releaseOverview
    const overviewReady = new Promise((resolve) => {
      releaseOverview = resolve
    })
    page.on("pageerror", (error) => errors.push(error.message))
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url())
      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(url.pathname)
        assert.equal(request.method(), "GET")
        if (url.pathname === overviewPath) {
          assert.equal(url.search, "")
          await overviewReady
          if (mode === "error")
            return route.fulfill({
              status: 503,
              json: {
                error: {
                  code: "test_statistics_unavailable",
                  message: "测试统计暂不可用",
                },
              },
            })
          return route.fulfill({
            json:
              mode === "empty"
                ? emptyOverview
                : mode === "server"
                  ? serverOverview
                  : apiOverview,
          })
        }
        let body = {}
        if (url.pathname.endsWith("/session"))
          body = {
            authenticated: true,
            user: {
              id: "admin",
              name: "管理员",
              role: "admin",
              status: "active",
            },
          }
        else if (url.pathname.endsWith("/branding"))
          body = { product_name: "百智办公" }
        else if (url.pathname.endsWith("/license/status"))
          body = { state: "valid" }
        assert(
          !url.pathname.includes("/statistics/"),
          `unexpected analytics API: ${url.pathname}`
        )
        return route.fulfill({ json: body })
      }
      const requested = path.resolve(dist, `.${url.pathname}`)
      const exists =
        requested.startsWith(dist) &&
        (await stat(requested).catch(() => null))?.isFile()
      const file = exists ? requested : path.join(dist, "index.html")
      const mime = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".png": "image/png",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
      }
      return route.fulfill({
        contentType: mime[path.extname(file)] || "application/octet-stream",
        body: await readFile(file),
      })
    })
    try {
      await page.goto(`http://task-preview.test${routePath}`)
      await page
        .getByRole("status", { name: "加载统计数据…", exact: true })
        .waitFor()
      assert.equal(
        await page
          .getByRole("group", { name: "会话总量", exact: true })
          .count(),
        0,
        "no sample or zero metrics while loading"
      )
      releaseOverview()
      await page
        .getByRole("region", { name: "消息结果", exact: true })
        .waitFor()
      assert.equal(await page.getByText("示例数据", { exact: true }).count(), 0)
      assert.equal(
        await page.getByRole("combobox", { name: "筛选模型" }).count(),
        0
      )
      assert.equal(
        await page.getByRole("tablist", { name: "统计时间范围" }).count(),
        0
      )
      const number = new Intl.NumberFormat("zh-CN")
      for (const [label, value] of [
        ["会话总量", overview.total_tasks],
        ["新建会话", overview.new_tasks_24h],
        ["活跃会话", overview.active_tasks_24h],
        ["消息总数", turns.length],
        ["新建消息", last24h],
      ]) {
        const card = page.getByRole("group", { name: label, exact: true })
        await card.getByText(number.format(value), { exact: true }).waitFor()
        if (label !== "会话总量" && label !== "消息总数")
          assert.equal(
            await card.getByText("24 小时", { exact: true }).count(),
            1
          )
      }
      if (width >= 1024) {
        const sessionCards = await Promise.all(
          ["会话总量", "新建会话", "活跃会话"].map((name) =>
            page.getByRole("group", { name, exact: true }).boundingBox()
          )
        )
        for (const card of sessionCards) {
          assert(
            Math.abs(card.y - sessionCards[0].y) <= 1,
            "session metrics share one row"
          )
          assert(
            Math.abs(card.width - sessionCards[0].width) <= 1,
            "session metric widths match"
          )
        }
        const messageCards = await Promise.all(
          ["消息总数", "新建消息"].map((name) =>
            page.getByRole("group", { name, exact: true }).boundingBox()
          )
        )
        assert(messageCards[0].y >= sessionCards[0].y + sessionCards[0].height)
        assert(
          Math.abs(messageCards[0].y - messageCards[1].y) <= 1,
          "message metrics share a separate row"
        )
      }
      for (const title of ["新建会话", "活跃会话", "消息数"]) {
        const chart = page.getByRole("figure", { name: title, exact: true })
        await chart.locator(".recharts-bar-rectangle").first().waitFor()
        assert.equal(await chart.locator(".recharts-bar-rectangle").count(), 90)
        if (title !== "消息数") {
          const bounds = await chart.boundingBox()
          const messageBounds = await page
            .getByRole("group", { name: "消息总数", exact: true })
            .boundingBox()
          assert(
            bounds.y + bounds.height <= messageBounds.y,
            "session trends appear above message metric cards"
          )
        }
        assert.equal(
          await chart.getByText("近 90 天", { exact: true }).count(),
          1
        )
        assert(
          (await chart.boundingBox()).y <
            (
              await page
                .getByRole("region", { name: "消息结果", exact: true })
                .boundingBox()
            ).y
        )
      }
      const readMetric = (label) =>
        page
          .getByRole("region", { name: label, exact: true })
          .locator("p")
          .innerText()
      for (const label of ["活跃会话数", "消息次数"])
        assert.equal(
          await page.getByRole("region", { name: label, exact: true }).count(),
          0
        )
      const displayDuration = (value) => {
        const seconds = Math.round(value)
        const minutes = Math.floor(seconds / 60)
        const rest = seconds % 60
        return minutes
          ? rest
            ? `${minutes} 分 ${rest} 秒`
            : `${minutes} 分`
          : `${rest} 秒`
      }
      const check24hMetrics = async () => {
        const summary = expected24h
        for (const [label, field] of [
          ["平均耗时", "average"],
          ["P10 耗时", "p10"],
          ["P90 耗时", "p90"],
        ])
          assert.equal(await readMetric(label), displayDuration(summary[field]))
        for (const [label, value] of [
          [
            "平均消息数",
            new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(
              last24h / sessionMessageCounts.length
            ),
          ],
          [
            "P10 消息数",
            number.format(
              sessionMessageCounts[
                Math.ceil(sessionMessageCounts.length * 0.1) - 1
              ]
            ),
          ],
          [
            "P90 消息数",
            number.format(
              sessionMessageCounts[
                Math.ceil(sessionMessageCounts.length * 0.9) - 1
              ]
            ),
          ],
        ])
          assert.equal(await readMetric(label), value)
        const counts = page.getByRole("region", {
          name: "消息结果",
          exact: true,
        })
        assert.equal(
          await counts
            .locator('[data-slot="conversation-success-rate"]')
            .count(),
          0
        )
        for (const label of ["消息成功率", "消息数"])
          assert.equal(
            await counts.getByText(label, { exact: true }).count(),
            0
          )
        const legend = counts.locator(
          '[data-slot="conversation-outcome-legend"]'
        )
        assert.deepEqual(
          await legend.locator(":scope > span").allTextContents(),
          ["成功", "失败", "用户取消", "达到轮次上限", "达到输出限制", "未知"]
        )
        assert.doesNotMatch(await legend.innerText(), /\d/)
        const tops = await legend
          .locator(":scope > span")
          .evaluateAll((items) =>
            items.map((item) => item.getBoundingClientRect().top)
          )
        assert(
          tops.every((top) => Math.abs(top - tops[0]) <= 1),
          "legend must stay on one row"
        )
        assert.equal(
          await counts
            .locator('[data-slot="conversation-outcome-bar"]')
            .evaluate((bar) => bar.getBoundingClientRect().height),
          12
        )
        const segments = await counts
          .locator('[data-slot="conversation-outcome-bar"] [data-outcome]')
          .evaluateAll((items) =>
            items.map((item) => ({
              outcome: item.dataset.outcome,
              count: Number(item.dataset.count),
              width: Number.parseFloat(item.style.width),
              color: getComputedStyle(item).backgroundColor,
            }))
          )
        assert.deepEqual(
          segments.map((item) => item.outcome),
          taskOutcomes.filter((outcome) => summary[outcome] > 0)
        )
        for (const segment of segments) {
          assert.equal(segment.count, summary[segment.outcome])
          assert(
            Math.abs(segment.width - (segment.count / summary.total) * 100) <
              0.0001
          )
          assert.notEqual(segment.color, "rgba(0, 0, 0, 0)")
        }
        assert.equal(
          segments.reduce((sum, item) => sum + item.count, 0),
          summary.total
        )
        assert(
          Math.abs(segments.reduce((sum, item) => sum + item.width, 0) - 100) <
            0.0001
        )
        for (const label of [
          "消息结果",
          "平均耗时",
          "P10 耗时",
          "P90 耗时",
          ...messageMetricLabels,
        ])
          assert.equal(
            await page
              .getByRole("region", { name: label, exact: true })
              .getByText("24 小时", { exact: true })
              .count(),
            1
          )
      }
      await check24hMetrics()
      const messageCards = await Promise.all(
        messageMetricLabels.map((name) =>
          page.getByRole("region", { name, exact: true }).boundingBox()
        )
      )
      const lastDuration = await page
        .getByRole("region", { name: "P90 耗时", exact: true })
        .boundingBox()
      const resultCard = await page
        .getByRole("region", { name: "消息结果", exact: true })
        .boundingBox()
      for (const bounds of messageCards) {
        assert(
          bounds.y >= lastDuration.y + lastDuration.height,
          "message count metrics appear below duration metrics"
        )
        assert(
          resultCard.y >= bounds.y + bounds.height,
          "message results remain below message count metrics"
        )
        if (width >= 1024) {
          assert(Math.abs(bounds.y - messageCards[0].y) <= 1)
          assert(Math.abs(bounds.width - lastDuration.width) <= 1)
          assert(Math.abs(bounds.height - lastDuration.height) <= 1)
        }
      }
      for (const label of ["消息出错率", "消息成功率", "消息结果次数"])
        assert.equal(
          await page.getByRole("region", { name: label, exact: true }).count(),
          0
        )
      const segment = page
        .getByRole("region", { name: "消息结果", exact: true })
        .locator("[data-outcome]")
        .first()
      await segment.focus()
      await page
        .locator('[data-slot="tooltip-content"][data-open]')
        .getByText(await segment.getAttribute("aria-label"), { exact: true })
        .waitFor()
      await page.keyboard.press("Escape")
      assert(
        await page
          .getByRole("region", { name: "消息结果", exact: true })
          .evaluate(
            (element) => element === element.parentElement.lastElementChild
          ),
        "message results occupy the final row"
      )
      if (width >= 1024) {
        const resultBounds = await page
          .getByRole("region", { name: "消息结果", exact: true })
          .boundingBox()
        const durations = await Promise.all(
          ["平均耗时", "P10 耗时", "P90 耗时"].map((name) =>
            page.getByRole("region", { name, exact: true }).boundingBox()
          )
        )
        for (const bounds of durations) {
          assert(Math.abs(bounds.y - durations[0].y) <= 1)
          assert(Math.abs(bounds.width - durations[0].width) <= 1)
          assert(resultBounds.y >= bounds.y + bounds.height)
        }
        assert(Math.abs(durations[0].x - resultBounds.x) <= 1)
        assert(
          Math.abs(
            durations[2].x +
              durations[2].width -
              resultBounds.x -
              resultBounds.width
          ) <= 1
        )
      }
      assert.equal(
        await page
          .getByRole("region", { name: "模型使用明细", exact: true })
          .count(),
        0
      )
      assert.equal(await page.locator("table").count(), 0)
      for (const name of ["消息结果趋势", "消息耗时趋势", "消息结果分布"])
        assert.equal(
          await page.getByRole("region", { name, exact: true }).count(),
          0
        )
      assert.equal(await page.getByRole("figure").count(), 3)
      const modelUsage = page.getByRole("region", {
        name: "模型使用情况",
        exact: true,
      })
      assert.equal(
        await modelUsage.getByText("24 小时", { exact: true }).count(),
        1
      )
      const legend = modelUsage.locator('[data-slot="model-usage-legend"]')
      assert.equal(await modelUsage.getByRole("button").count(), 0)
      assert.equal(await modelUsage.locator("[aria-pressed]").count(), 0)
      assert.equal(
        await legend.locator("[data-model-id]").count(),
        Math.min(4, rankedModels.length)
      )
      const legendItems = await legend
        .locator("[data-model-id]")
        .evaluateAll((items) =>
          items.map((item) => ({
            id: item.dataset.modelId,
            total: Number(item.dataset.count),
          }))
        )
      assert.deepEqual(legendItems, expectedLegend)
      assert.doesNotMatch(await legend.innerText(), /%/)
      for (const item of legendItems)
        assert.equal(
          await legend
            .locator(`[data-model-id="${item.id}"]`)
            .locator("span")
            .last()
            .innerText(),
          number.format(item.total)
        )
      assert.equal(
        legendItems.reduce((sum, item) => sum + item.total, 0),
        recentTurns.length
      )
      await modelUsage.locator("svg.recharts-surface").waitFor()
      assert.equal(
        (
          await modelUsage
            .locator('[data-slot="chart"][role="img"]')
            .locator("..")
            .innerText()
        )
          .trim()
          .replace(/\s+/g, " "),
        number.format(recentTurns.length)
      )
      assert.equal(
        await modelUsage.locator(".recharts-pie-sector").count(),
        expectedLegend.length
      )
      assert(
        await modelUsage
          .locator(".recharts-sector")
          .evaluateAll((items) =>
            items.every(
              (item) => getComputedStyle(item).fill !== "rgba(0, 0, 0, 0)"
            )
          )
      )
      await modelUsage.locator('[data-slot="chart"]').scrollIntoViewIfNeeded()
      const chartBounds = await modelUsage
        .locator('[data-slot="chart"]')
        .boundingBox()
      let preceding = 0
      for (const item of legendItems) {
        const label =
          item.id === "other"
            ? "其他"
            : taskPreviewModels.find((model) => model.id === item.id).name
        const hint = `${number.format(item.total)} 条消息使用了 ${label}`
        assert(
          (
            await legend
              .locator(`[data-model-id="${item.id}"]`)
              .getAttribute("title")
          ).includes(hint)
        )
        const angle =
          ((90 - ((preceding + item.total / 2) / recentTurns.length) * 360) *
            Math.PI) /
          180
        const radius = Math.min(chartBounds.width, chartBounds.height) * 0.4
        await page.mouse.move(
          chartBounds.x + chartBounds.width / 2 + Math.cos(angle) * radius,
          chartBounds.y + chartBounds.height / 2 - Math.sin(angle) * radius
        )
        await modelUsage
          .locator(".recharts-tooltip-wrapper")
          .getByText(hint, { exact: true })
          .waitFor()
        assert.equal(
          await modelUsage
            .locator(".recharts-tooltip-wrapper")
            .getByText(hint, { exact: true })
            .evaluate((element) => {
              const range = document.createRange()
              range.selectNodeContents(element)
              return range.getClientRects().length
            }),
          1,
          "model usage hint stays on one line"
        )
        assert.equal(
          await modelUsage
            .locator('.recharts-tooltip-wrapper span[aria-hidden="true"]')
            .evaluate((element) => getComputedStyle(element).backgroundColor),
          await modelUsage
            .locator(".recharts-sector")
            .nth(legendItems.indexOf(item))
            .evaluate((element) => getComputedStyle(element).fill),
          "tooltip dot matches the model color"
        )
        preceding += item.total
      }
      await page.mouse.move(0, 0)
      await modelUsage
        .locator(".recharts-tooltip-wrapper")
        .waitFor({ state: "hidden" })
      const modelBounds = await modelUsage.boundingBox()
      const conversationChart = page.getByRole("figure", {
        name: "消息数",
        exact: true,
      })
      const conversationBounds = await conversationChart.boundingBox()
      assert(
        Math.abs(modelBounds.height - conversationBounds.height) <= 1,
        "model card height matches conversation card"
      )
      const modelBody = await modelUsage
        .locator('[data-slot="card-content"]')
        .boundingBox()
      const conversationBody = await conversationChart
        .locator('[data-slot="card-content"]')
        .boundingBox()
      assert(Math.abs(modelBody.height - conversationBody.height) <= 1)
      if (width >= 1024) {
        assert(
          Math.abs(modelBounds.y - conversationBounds.y) <= 1,
          "model and conversation cards share a row"
        )
        assert(Math.abs(modelBounds.width - conversationBounds.width) <= 1)
        assert(modelBounds.x > conversationBounds.x)
      }
      const percentile = page
        .getByRole("region", { name: "P90 耗时", exact: true })
        .locator("p")
      await percentile.focus()
      await page
        .locator('[data-slot="tooltip-content"][data-open]')
        .getByText("近 24 小时内，90% 的消息在此时间内结束。", { exact: true })
        .waitFor()
      await page.keyboard.press("Escape")
      await page
        .getByRole("region", { name: "P90 消息数", exact: true })
        .locator("p")
        .focus()
      await page
        .locator('[data-slot="tooltip-content"][data-open]')
        .getByText(
          "近 24 小时有消息的会话，其消息数的第 90 百分位。仅统计此期间的消息。",
          { exact: true }
        )
        .waitFor()
      await page.keyboard.press("Escape")
      await legend
        .locator(`[data-model-id="${taskPreviewModels[1].id}"]`)
        .click()
      await check24hMetrics()
      if (otherIDs.length) {
        await legend.locator('[data-model-id="other"]').click()
        await check24hMetrics()
      }
      await modelUsage
        .locator(".recharts-sector")
        .first()
        .dispatchEvent("click")
      await check24hMetrics()
      assert(
        await modelUsage
          .locator(".recharts-sector")
          .evaluateAll((items) =>
            items.every((item) => getComputedStyle(item).fillOpacity === "1")
          )
      )
      await page.evaluate(() => document.fonts.ready)
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        "page must not overflow horizontally"
      )
      assert.deepEqual(errors, [])
      assert.deepEqual(
        apiRequests.filter((path) => path.includes("/statistics/")),
        [overviewPath]
      )
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.classList.contains("dark")
        ),
        theme === "dark"
      )
      await page.screenshot({
        path: `/tmp/monkeyai-task-analysis-${width}-${theme}.png`,
        fullPage: true,
      })
      mode = "empty"
      await page.reload()
      for (const name of [
        "会话总量",
        "新建会话",
        "活跃会话",
        "消息总数",
        "新建消息",
      ])
        await page
          .getByRole("group", { name, exact: true })
          .getByText("0", { exact: true })
          .waitFor()
      for (const name of [
        "平均耗时",
        "P10 耗时",
        "P90 耗时",
        ...messageMetricLabels,
      ])
        assert.equal(await readMetric(name), "—")
      assert.equal(
        await page
          .locator('[data-slot="model-usage-legend"] [data-model-id]')
          .count(),
        0
      )
      assert.equal(
        await page
          .locator('[data-slot="conversation-outcome-bar"] [data-outcome]')
          .count(),
        0
      )
      mode = "server"
      await page.reload()
      for (const [name, value] of [
        ["会话总量", "100"],
        ["新建会话", "2"],
        ["活跃会话", "10"],
        ["消息总数", "1,000"],
        ["新建消息", "25"],
      ])
        await page
          .getByRole("group", { name, exact: true })
          .getByText(value, { exact: true })
          .waitFor()
      for (const [name, value] of [
        ["平均耗时", "0 秒"],
        ["P10 耗时", "0 秒"],
        ["P90 耗时", "0 秒"],
        ["平均消息数", "2.5"],
        ["P10 消息数", "1"],
        ["P90 消息数", "4"],
      ])
        assert.equal(await readMetric(name), value)
      const unknown = page.locator(
        '[data-slot="model-usage-legend"] [data-model-id="unknown"]'
      )
      assert.equal(
        await unknown.getAttribute("title"),
        "25 条消息使用了 未知模型"
      )
      assert.equal(await unknown.locator("span").last().innerText(), "25")
      assert.equal(await modelUsage.locator("p").innerText(), "25")
      mode = "error"
      await page.reload()
      await page
        .getByText("会话分析加载失败，请重试。", { exact: true })
        .waitFor()
      assert.equal(
        await page
          .getByRole("group", { name: "会话总量", exact: true })
          .count(),
        0
      )
      const requestsBeforeRetry = apiRequests.filter(
        (path) => path === overviewPath
      ).length
      mode = "success"
      await page.getByRole("button", { name: "重试", exact: true }).click()
      await page
        .getByRole("group", { name: "会话总量", exact: true })
        .getByText(number.format(overview.total_tasks), { exact: true })
        .waitFor()
      await check24hMetrics()
      assert.equal(
        apiRequests.filter((path) => path === overviewPath).length,
        requestsBeforeRetry + 1
      )
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width} ${theme}: coherent API metrics, model outcomes/durations, equal height conversation/model row, 24h model donut, four legend entries, grouped other models, display only with no click filtering, tooltips, 24h per-session message counts and percentiles below duration cards, single overview API, loading/empty/unknown/error/retry states`
      )
    } finally {
      releaseOverview()
      await page.close()
    }
  }
} finally {
  await browser.close()
}
