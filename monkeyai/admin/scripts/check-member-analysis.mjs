import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { addDays, eachDayOfInterval, format, subYears } from "date-fns"

const executablePath = process.env.CHROME_BIN
if (!executablePath) throw new Error("请设置 CHROME_BIN；先执行 npm run build")
const baseURL = process.env.ADMIN_DEV_URL || "http://admin.test"
const dist = fileURLToPath(new URL("../dist/", import.meta.url))
const prefix = "/api/admin/v1/statistics/session-reporting/members/"
const overviewPath = `${prefix}overview`
const memberPath = "/console/statistics/session-reporting/members"
const taskPath = "/console/statistics/task-history"
const conversationPath = "/console/statistics/conversation-history"
const users = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "林玫",
    email: "linmei@example.com",
    avatar_url: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "许宁",
    email: "xuning@example.com",
    avatar_url: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "韩亦辰",
    email: "hanyichen@example.com",
    avatar_url: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    name: "已删除成员",
    email: "deleted@example.com",
    avatar_url: null,
    deleted: true,
  },
]
const today = new Date(2026, 10, 3)
const dates = eachDayOfInterval({
  start: addDays(subYears(today, 1), 1),
  end: today,
})
const days = dates.map((date, index) => ({
  date: format(date, "yyyy-MM-dd"),
  conversations: index % 33,
}))
const overview = {
  total_members: 431,
  last_7d: { active_members: 137 },
  previous_7d: { active_members: 182 },
  last_24h: { active_members: 46 },
  previous_24h: { active_members: 23 },
  timezone: "Asia/Shanghai",
  generated_at: "2026-11-03T12:00:00Z",
  days: days.slice(-90).map((day, index) => ({
    date: day.date,
    new_members: index % 5,
    active_members: index % 45,
  })),
}
const detail = (user) => ({
  member: {
    ...user,
    status: "active",
    groups:
      user.id === users[0].id
        ? [
            { id: "engineering", name: "研发部" },
            { id: "team", name: "平台组" },
          ]
        : [],
  },
  timezone: "Asia/Shanghai",
  generated_at: "2026-11-03T12:00:00Z",
  summary: {
    from: "2026-10-04T16:00:00Z",
    until: "2026-11-03T12:00:00Z",
    tasks: 123,
    conversations: 345,
    credits: "1234.987654",
  },
  created_resources: {
    models: 3,
    knowledge_bases: null,
    skills: 8,
    experts: 2,
    connectors: 4,
    rules: 5,
  },
  activity: { from: days[0].date, until: days.at(-1).date, days },
  recent_tasks: Array.from({ length: 10 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `服务端任务 ${index + 1}`,
    turn_count: index === 0 ? null : index + 10,
    started_at: `2026-11-03T${String(9 - Math.floor(index / 2)).padStart(2, "0")}:00:00Z`,
    last_active_at:
      [
        "2026-11-03T11:00:00Z",
        "2026-11-03T11:55:00Z",
        "2026-11-01T12:00:00Z",
        "2026-11-03T11:59:30Z",
      ][index] ?? "2026-11-03T11:00:00Z",
  })),
})
const emptyDetail = {
  ...detail(users[1]),
  summary: {
    ...detail(users[1]).summary,
    tasks: 0,
    conversations: 0,
    credits: "0",
  },
  created_resources: {
    models: 0,
    knowledge_bases: null,
    skills: 0,
    experts: 0,
    connectors: 0,
    rules: 0,
  },
  activity: {
    ...detail(users[1]).activity,
    days: days.map((day) => ({ ...day, conversations: 0 })),
  },
  recent_tasks: [],
}
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
try {
  for (const width of process.env.WIDTH
    ? [Number(process.env.WIDTH)]
    : [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      locale: "zh-CN",
      timezoneId: process.env.BROWSER_TIMEZONE || "Asia/Shanghai",
      reducedMotion: "reduce",
    })
    page.setDefaultTimeout(15000)
    await page.clock.setFixedTime(new Date(overview.generated_at))
    const errors = [],
      detailRequests = [],
      historyRequests = [],
      overviewRequests = []
    page.on("pageerror", (error) => errors.push(error.message))
    let mode = "success",
      hold = true,
      release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        p = url.pathname
      if (p.startsWith("/api/")) {
        assert.equal(request.method(), "GET", `unexpected mutation ${p}`)
        let body = { items: [] }
        if (p === overviewPath) body = overview
        else if (p === "/api/admin/v1/statistics/models/overview") {
          overviewRequests.push(p)
          body = {
            timezone: "Asia/Shanghai",
            generated_at: overview.generated_at,
            last_24h: {
              model_calls: 150,
              input_tokens: 3000,
              output_tokens: 1000,
            },
            previous_24h: {
              model_calls: 100,
              input_tokens: 1000,
              output_tokens: 500,
            },
            last_30m: {
              tpm: 10,
              rpm: 3,
              cache_hit_rate: 50,
              avg_response_time: 1000,
              avg_first_token_time: 500,
              model_success_rate: 100,
            },
            days: overview.days.map((day) => ({
              date: day.date,
              model_calls: 2,
              input_tokens: 1000,
              output_tokens: 300,
              credits: "12",
            })),
          }
        } else if (p === "/api/admin/v1/statistics/tasks/overview") {
          overviewRequests.push(p)
          body = {
            total_tasks: 120,
            new_tasks_24h: 8,
            active_tasks_24h: 12,
            timezone: "Asia/Shanghai",
            generated_at: overview.generated_at,
            days: overview.days.map((day) => ({
              date: day.date,
              new_tasks: 2,
              active_tasks: 4,
            })),
          }
        } else if (p.startsWith(prefix)) {
          const id = decodeURIComponent(p.slice(prefix.length))
          detailRequests.push(id)
          assert.equal(url.search, "")
          if (hold) await gate
          if (mode === "error")
            return route.fulfill({
              status: 503,
              json: { error: { message: "成员分析暂不可用" } },
            })
          const user = users.find((user) => user.id === id && !user.deleted)
          if (!user)
            return route.fulfill({
              status: 404,
              json: { error: { message: "成员不存在" } },
            })
          body = user.id === users[1].id ? emptyDetail : detail(user)
        } else if (p.endsWith("/billing/users")) {
          const id = url.searchParams.get("id"),
            term = url.searchParams.get("q")?.toLowerCase() || ""
          body = {
            items: users.filter((user) =>
              id
                ? user.id === id
                : `${user.name} ${user.email}`.toLowerCase().includes(term)
            ),
            has_next: false,
          }
        } else if (
          p === "/api/admin/v1/statistics/history" ||
          p === "/api/admin/v1/statistics/conversations" ||
          p === "/api/admin/v1/billing/entries"
        ) {
          historyRequests.push(url)
          body = {
            items: [],
            has_next: false,
            page: 1,
            page_size: Number(url.searchParams.get("page_size") || 50),
          }
        } else if (p.endsWith("/session"))
          body = {
            authenticated: true,
            user: {
              id: "admin",
              name: "管理员",
              role: "admin",
              status: "active",
            },
          }
        else if (p.endsWith("/branding")) body = { product_name: "百智办公" }
        else if (p.endsWith("/license/status")) body = { state: "valid" }
        else
          assert(!p.includes("/statistics/"), `unexpected stats request ${p}`)
        return route.fulfill({ json: body })
      }
      if (process.env.ADMIN_DEV_URL) return route.continue()
      const requested = path.resolve(dist, `.${p}`)
      const exists =
        requested.startsWith(dist) &&
        (await stat(requested)
          .then((s) => s.isFile())
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
    await page.goto(`${baseURL}${memberPath}?source=bookmark`)
    const root = page.getByRole("region", { name: "成员", exact: true })
    await root.getByText("请先选择要分析的成员", { exact: true }).waitFor()
    assert.deepEqual(detailRequests, [])
    assert.equal(
      await root
        .getByText("选择一位成员后，可查看使用概况、使用趋势和常用资源。", {
          exact: true,
        })
        .count(),
      0
    )
    const total = root.getByRole("group", { name: "成员总数", exact: true })
    await total.locator('p[title="431 · 团队全部成员"]').waitFor()
    const weekly = root.getByRole("group", {
      name: "活跃成员 · 7 天",
      exact: true,
    })
    assert.equal(
      await weekly
        .locator('[data-slot="tooltip-trigger"]')
        .getAttribute("aria-label"),
      "较此前 7 天减少 25%"
    )
    for (const title of ["新增用户", "活跃用户"]) {
      const figure = root.getByRole("figure", { name: title, exact: true })
      await figure.locator(".recharts-bar-rectangle").first().waitFor()
      assert.equal(await figure.locator(".recharts-bar-rectangle").count(), 90)
    }
    const control = root.getByRole("combobox", {
      name: "选择成员",
      exact: true,
    })
    const search = page.getByRole("combobox", {
      name: "搜索姓名或邮箱",
      exact: true,
    })
    const choose = async (query, name) => {
      await control.click()
      await search.fill(query)
      await page.getByRole("option").filter({ hasText: name }).click()
    }
    await root.getByRole("button", { name: "选择成员", exact: true }).click()
    await page.getByRole("option").filter({ hasText: "林玫" }).waitFor()
    assert.equal(
      await page.getByRole("option").filter({ hasText: "已删除成员" }).count(),
      0
    )
    assert.equal((await control.boundingBox()).width, 192)
    assert.equal(
      (
        await page
          .locator("[data-billing-user-options]")
          .locator("..")
          .boundingBox()
      ).width,
      192
    )
    await search.fill("not-a-member")
    await page.getByText("没有匹配的用户", { exact: true }).waitFor()
    await search.fill("linmei@example.com")
    await page.getByRole("option").filter({ hasText: "林玫" }).waitFor()
    await search.press("ArrowDown")
    await search.press("Enter")
    await root
      .getByRole("status", { name: "加载统计数据…", exact: true })
      .waitFor()
    assert.equal(
      await root.getByText("linmei@example.com", { exact: true }).count(),
      0
    )
    hold = false
    release()
    await root.getByText("linmei@example.com", { exact: true }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get("user_id"), users[0].id)
    assert.equal(new URL(page.url()).searchParams.get("source"), "bookmark")
    if (!process.env.ADMIN_DEV_URL)
      assert.deepEqual(detailRequests, [users[0].id])
    assert.equal(await control.locator('[data-slot="avatar"]').count(), 1)
    assert.equal(
      await root
        .getByRole("button", { name: "清除用户筛选", exact: true })
        .count(),
      0
    )
    await root.getByText("平台组", { exact: true }).waitFor()
    for (const [label, value] of [
      ["会话数", "123"],
      ["消息数", "345"],
      ["消耗积分", "1,234"],
    ]) {
      assert.equal(
        await root
          .getByRole("group", { name: label, exact: true })
          .locator("p[title]")
          .innerText(),
        value
      )
    }
    for (const name of ["活跃天数", "使用偏好"])
      assert.equal(await root.getByText(name, { exact: true }).count(), 0)
    const resources = root.getByRole("region", {
      name: "创建的资源",
      exact: true,
    })
    for (const [label, value] of [
      ["大模型", "3"],
      ["知识库", "—"],
      ["技能", "8"],
      ["专家", "2"],
      ["连接器", "4"],
      ["规则", "5"],
    ]) {
      assert.equal(
        await resources
          .getByRole("group", { name: label, exact: true })
          .locator("p[title]")
          .innerText(),
        value
      )
    }
    const heatmap = root.getByRole("region", {
      name: /^近一年共 [\d,]+ 条消息$/,
    })
    const cells = heatmap.locator("button[data-date]")
    assert.equal(await cells.count(), days.length)
    const calendar = await cells.first().evaluate((cell) => {
      const grid = cell.parentElement,
        wrapper = grid.parentElement,
        viewport = wrapper.parentElement
      return {
        rows: getComputedStyle(grid).gridTemplateRows.split(" ").length,
        width: wrapper.clientWidth,
        scroll: wrapper.scrollWidth,
        viewport: viewport.clientWidth,
        viewportScroll: viewport.scrollWidth,
        months: [...grid.previousElementSibling.children].map((el) =>
          el.textContent.trim()
        ),
      }
    })
    assert.equal(calendar.rows, 7)
    assert.equal(calendar.width, calendar.scroll)
    assert.equal(calendar.viewportScroll, Math.max(640, calendar.viewport))
    assert.deepEqual(calendar.months, ["12 月", "3 月", "6 月", "9 月"])
    const activity = await cells.evaluateAll((elements) =>
      elements.map((el) => ({
        date: el.dataset.date,
        count: Number(el.dataset.conversations),
        opacity: Number(el.querySelector("span").style.opacity),
      }))
    )
    assert.equal(
      await heatmap.locator('[data-slot="card-title"]').innerText(),
      `近一年共 ${new Intl.NumberFormat("zh-CN").format(days.reduce((sum, day) => sum + day.conversations, 0))} 条消息`
    )
    for (const day of activity)
      assert.equal(day.opacity, Math.min(1, day.count / 20))
    const lastDay = cells.last()
    assert.match(
      await lastDay.getAttribute("aria-label"),
      /^2026 年 11 月 3 日 · [\d,]+ 条消息$/
    )
    await lastDay.focus()
    await page
      .locator('[data-slot="tooltip-content"][data-open]')
      .getByText(await lastDay.getAttribute("aria-label"), { exact: true })
      .waitFor()
    await page.keyboard.press("Escape")
    const recent = root.getByRole("region", { name: "最近会话", exact: true })
    assert.deepEqual(await recent.locator("thead th").allTextContents(), [
      "会话名称",
      "消息数量",
      "创建时间",
      "最近活动",
    ])
    assert.equal(await recent.locator("tbody tr").count(), 10)
    assert.equal(
      await recent.locator("tbody tr").first().locator("td").nth(1).innerText(),
      "—"
    )
    for (const [index, expected] of [
      "1 小时前",
      "5 分钟前",
      "2 天前",
      "刚刚",
    ].entries()) {
      const row = recent.locator("tbody tr").nth(index)
      assert.equal(await row.locator("td").nth(3).innerText(), expected)
      assert.equal(
        await row.locator("td").nth(3).getAttribute("title"),
        new Intl.DateTimeFormat("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Shanghai",
        }).format(new Date(detail(users[0]).recent_tasks[index].last_active_at))
      )
    }
    await recent
      .getByRole("link", { name: "服务端任务 1", exact: true })
      .waitFor()
    const more = recent.getByRole("link", { name: "查看更多", exact: true })
    const historyResponse = (api, params) =>
      page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
          url.pathname === api &&
          Object.entries(params).every(
            ([key, value]) => url.searchParams.get(key) === value
          )
        )
      })
    for (const [label, destination, api] of [
      ["会话数", taskPath, "/api/admin/v1/statistics/history"],
      ["消息数", conversationPath, "/api/admin/v1/statistics/conversations"],
      ["消耗积分", "/console/billing/details", "/api/admin/v1/billing/entries"],
    ]) {
      const card = root.getByRole("group", { name: label, exact: true }),
        link = card.getByRole("link", { name: label, exact: true }),
        body = card.locator('[data-slot="card-content"]')
      assert.equal(
        await link.getAttribute("href"),
        `${destination}?user_id=${users[0].id}`
      )
      assert.equal(
        await card
          .locator('[data-slot="card-header"]')
          .getByRole("link")
          .count(),
        0
      )
      const bounds = await body.boundingBox()
      await body.hover({ position: { x: bounds.width - 8, y: 8 } })
      await page.waitForFunction(
        (element) => getComputedStyle(element).color === "rgb(13, 148, 136)",
        await link.elementHandle()
      )
      const response = historyResponse(api, { user_id: users[0].id })
      await body.click({ position: { x: bounds.width - 8, y: 8 } })
      await response
      assert.equal(new URL(page.url()).pathname, destination)
      assert.equal(new URL(page.url()).searchParams.get("user_id"), users[0].id)
      assert.equal(
        historyRequests.at(-1).searchParams.get("user_id"),
        users[0].id
      )
      await page.goBack()
      await root.getByText("linmei@example.com", { exact: true }).waitFor()
    }
    let response = historyResponse("/api/admin/v1/statistics/history", {
      user_id: users[0].id,
    })
    await more.click()
    await response
    await page.goBack()
    await root.getByText("linmei@example.com", { exact: true }).waitFor()
    for (const date of ["2026-11-03", "2025-12-31"]) {
      const from = new Date(`${date}T00:00:00+08:00`).toISOString(),
        until = new Date(new Date(from).getTime() + 86400000).toISOString()
      response = historyResponse("/api/admin/v1/statistics/conversations", {
        user_id: users[0].id,
        from,
        until,
      })
      await heatmap.locator(`button[data-date="${date}"]`).click()
      await response
      for (const params of [
        new URL(page.url()).searchParams,
        historyRequests.at(-1).searchParams,
      ]) {
        assert.equal(params.get("user_id"), users[0].id)
        assert.equal(params.get("from"), from)
        assert.equal(params.get("until"), until)
      }
      await page.goBack()
      await root.getByText("linmei@example.com", { exact: true }).waitFor()
    }
    await choose("许宁", "许宁")
    await root.getByText("xuning@example.com", { exact: true }).waitFor()
    assert.equal(
      await root
        .getByRole("group", { name: "会话数", exact: true })
        .locator("p[title]")
        .innerText(),
      "0"
    )
    assert.equal(await cells.count(), days.length)
    assert.equal(
      await heatmap
        .locator('button[data-conversations]:not([data-conversations="0"])')
        .count(),
      0
    )
    await recent.getByText("没有符合条件的会话", { exact: true }).waitFor()
    assert.equal(
      await more.getAttribute("href"),
      `${taskPath}?user_id=${users[1].id}`
    )
    await page.reload()
    await root.getByText("xuning@example.com", { exact: true }).waitFor()
    await page.goBack()
    await root.getByText("linmei@example.com", { exact: true }).waitFor()
    await page.goForward()
    await root.getByText("xuning@example.com", { exact: true }).waitFor()
    mode = "error"
    await page.reload()
    await root
      .getByRole("alert")
      .getByText("成员分析暂不可用", { exact: true })
      .waitFor()
    assert.equal(
      await root.getByText("xuning@example.com", { exact: true }).count(),
      0
    )
    assert.equal(
      await root.getByRole("group", { name: "会话数", exact: true }).count(),
      0
    )
    mode = "success"
    await root.getByRole("button", { name: "重试", exact: true }).click()
    await root.getByText("xuning@example.com", { exact: true }).waitFor()
    await page.goto(`${baseURL}${memberPath}?user_id=${users[3].id}`)
    await root
      .getByRole("alert")
      .getByText("成员不存在", { exact: true })
      .waitFor()
    assert.equal(
      await root.getByRole("group", { name: "会话数", exact: true }).count(),
      0
    )
    for (const dark of [false, true]) {
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        dark
      )
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
    }
    // Overview keeps model/task metrics and charts; all five user cards and their API are gone.
    await page.goto(`${baseURL}/console/statistics/realtime`)
    for (const label of ["用户总量", "新增用户", "活跃用户"])
      assert.equal(await page.getByText(label, { exact: true }).count(), 0)
    for (const label of [
      "积分消耗量",
      "调用次数",
      "输入 Token",
      "输出 Token",
      "新建会话",
      "活跃会话",
    ]) {
      const figure = page.getByRole("figure", { name: label, exact: true })
      await figure.locator(".recharts-bar-rectangle").first().waitFor()
      assert.equal(await figure.locator(".recharts-bar-rectangle").count(), 90)
    }
    assert.equal(await page.getByRole("figure").count(), 6)
    const comparison = page.locator('[aria-label="较此前 24 小时增加 50%"]')
    await comparison.focus()
    await page
      .locator('[data-slot="tooltip-content"][data-open]')
      .getByText("此前 24 小时：100", { exact: true })
      .waitFor()
    await page.keyboard.press("Escape")
    assert(overviewRequests.some((p) => p.endsWith("/models/overview")))
    assert(overviewRequests.some((p) => p.endsWith("/tasks/overview")))
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    )
    assert.deepEqual(errors, [])
    console.log(
      `PASS ${width}: real user search, single detail API, loading, API counts/resources/year/tasks, body/history/day links, selection reload/history, empty/error/retry/deleted`
    )
    await page.close()
  }
} finally {
  await browser.close()
}
