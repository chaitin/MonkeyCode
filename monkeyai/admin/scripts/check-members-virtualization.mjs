import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const executablePath = process.env.CHROME_BIN
if (!executablePath) throw new Error("请设置 CHROME_BIN；先执行 pnpm build")
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
  page.setDefaultTimeout(10000)
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  const size = 10000
  const id = (index) => `user-${String(index).padStart(5, "0")}`
  const users = Array.from({ length: size }, (_, index) => ({
    id: id(index),
    name: `成员${String(index).padStart(5, "0")}`,
    email: `user${index}@example.com`,
    role: index === 0 ? "admin" : "user",
    status: "active",
    joined_at: "2026-01-01T00:00:00Z",
  }))
  const group = (id, parent_id, name, member_ids = []) => ({
    id,
    parent_id,
    name,
    member_ids,
    actions: ["add-subgroup", "rename", "adjust-members", "move", "delete"],
    allow_add_members: true,
  })
  const groups = [
    group(
      "root",
      null,
      "性能测试团队",
      users.map((user) => user.id)
    ),
    group("a", "root", "部门 A", [id(3), id(4)]),
    group("b", "root", "部门 B", [id(5)]),
    group("a1", "a", "小组 A1", [id(3)]),
    ...Array.from({ length: 24 }, (_, index) =>
      group(`badge-${index}`, "b", `用于检查换行的很长的分组名称 ${index}`, [
        id(0),
      ])
    ),
  ]
  const writes = []
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      pathname = url.pathname
    const json = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      })
    if (pathname.startsWith("/api/")) {
      if (request.method() !== "GET") {
        const body = request.postData() ? request.postDataJSON() : null
        writes.push({ pathname, method: request.method(), body })
        if (pathname.endsWith("/reset-password"))
          return json({ password: "temporary-test-password" })
        if (request.method() === "PATCH" && pathname.includes("/users/")) {
          const user = users.find(
            (user) => user.id === pathname.split("/").at(-1)
          )
          assert.ok(user)
          Object.assign(user, body)
          return json(user)
        }
        if (pathname.endsWith("/groups/move")) {
          assert.equal(body.target_id, "b")
          for (const member of body.members) {
            for (const group of groups) {
              if (
                !member.source_group_id ||
                member.source_group_id === group.id
              )
                group.member_ids = group.member_ids.filter(
                  (id) => id !== member.id
                )
            }
            groups
              .find((group) => group.id === body.target_id)
              .member_ids.push(member.id)
          }
          return json({})
        }
        throw new Error(`Unexpected mutation ${request.method()} ${pathname}`)
      }
      if (pathname.endsWith("/session"))
        return json({ authenticated: true, user: users[0] })
      if (pathname.endsWith("/branding"))
        return json({ product_name: "MonkeyAI" })
      if (pathname.endsWith("/license/status")) return json({ state: "valid" })
      if (pathname.endsWith("/users")) return json({ users })
      if (pathname.endsWith("/groups")) return json({ groups })
      if (pathname.endsWith("/settings")) return json({ settings: [] })
      return json({ items: [] })
    }
    const requested = path.resolve(dist, `.${pathname}`)
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
  const tree = 'ul[aria-label="分组"]'
  const treeRow = (key) => `${tree} [data-virtual-key="${key}"]`
  const card = (index) => `[role="listitem"][data-virtual-key="${id(index)}"]`
  const groupButton = (id) => `${treeRow(`group:${id}`)} > div > button`
  const viewportSelector = (panel) =>
    panel === "tree" ? tree : '[data-slot="item-group"]'
  const click = async (selector, text) => {
    await page.waitForFunction(
      ({ selector, text }) =>
        [...document.querySelectorAll(selector)].some(
          (node) =>
            (text === undefined || node.textContent.trim() === text) &&
            node.getClientRects().length &&
            getComputedStyle(node).visibility !== "hidden"
        ),
      { selector, text }
    )
    await page.evaluate(
      ({ selector, text }) => {
        const element = [...document.querySelectorAll(selector)].find(
          (node) => text === undefined || node.textContent.trim() === text
        )
        element.scrollIntoView({ block: "nearest" })
        window.__clickPoint = { x: -1, y: -1, stable: 0 }
      },
      { selector, text }
    )
    // Popup animations and row measurements must settle before a real mouse click.
    await page.waitForFunction(
      ({ selector, text }) => {
        const element = [...document.querySelectorAll(selector)].find(
          (node) => text === undefined || node.textContent.trim() === text
        )
        if (!element || element.disabled) return false
        const rect = element.getBoundingClientRect()
        const x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2
        const target = document.elementFromPoint(x, y)
        const previous = window.__clickPoint
        const stable =
          Math.abs(previous.x - x) < 0.1 && Math.abs(previous.y - y) < 0.1
            ? previous.stable + 1
            : 0
        window.__clickPoint = { x, y, stable }
        return stable >= 2 && !!target && element.contains(target)
      },
      { selector, text }
    )
    const point = await page.evaluate(() => window.__clickPoint)
    await page.mouse.click(point.x, point.y)
  }
  const scroll = async (panel, end) => {
    await page.evaluate(
      ({ selector, end }) => {
        const viewport = document
          .querySelector(selector)
          .closest('[data-slot="scroll-area-viewport"]')
        viewport.scrollTop = end ? viewport.scrollHeight : 0
        viewport.dispatchEvent(new Event("scroll"))
      },
      { selector: viewportSelector(panel), end }
    )
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
  }
  const exists = (selector) =>
    page.waitForFunction(
      (selector) => !!document.querySelector(selector),
      selector
    )
  const assertBounded = async () => {
    const counts = await page.evaluate(() => ({
      cards: document.querySelectorAll('[role="listitem"]').length,
      tree: document.querySelector('ul[aria-label="分组"]').children.length,
      dom: document.querySelectorAll("*").length,
    }))
    assert.ok(counts.cards > 0 && counts.cards < 60, JSON.stringify(counts))
    assert.ok(counts.tree > 0 && counts.tree < 80, JSON.stringify(counts))
    assert.ok(counts.dom < 3500, JSON.stringify(counts))
    return counts
  }
  const assertCardLayout = async () => {
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('[role="listitem"]')].sort(
        (a, b) => Number(a.dataset.index) - Number(b.dataset.index)
      )
      return rows.every(
        (row, index) =>
          !index ||
          Number(row.dataset.index) !==
            Number(rows[index - 1].dataset.index) + 1 ||
          row.getBoundingClientRect().top >=
            rows[index - 1].getBoundingClientRect().bottom + 6
      )
    })
  }
  const fillSearch = async (value) => {
    await page.evaluate((value) => {
      const input = document.querySelector('input[aria-label="搜索成员"]')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }, value)
  }
  await page.goto("http://admin.test/console/settings/members")
  await exists(card(0))
  await exists(groupButton("a"))
  const initial = await assertBounded()
  assert.equal(
    await page.getAttribute(groupButton("root"), "aria-expanded"),
    "true"
  )
  assert.equal(
    await page.getAttribute(groupButton("a"), "aria-expanded"),
    "false"
  )
  assert.ok((await page.textContent(treeRow("group:root"))).includes("10000"))
  await assertCardLayout()
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('[role="listitem"]')].map(
      (element) => element.getBoundingClientRect().height
    )
  )
  assert.ok(
    Math.max(...heights) - Math.min(...heights) > 30,
    "wrapped badges must produce measured variable heights"
  )

  await scroll("members", true)
  await exists(card(size - 1))
  await assertCardLayout()
  await assertBounded()
  await scroll("members", false)
  await exists(card(0))
  await click(groupButton("a"))
  await click(groupButton("a1"))
  await exists(treeRow(`member:a1:${id(3)}`))
  await scroll("tree", true)
  await exists(treeRow(`member:root:${id(size - 1)}`))
  await assertBounded()
  await scroll("tree", false)
  await exists(groupButton("a1"))
  assert.equal(
    await page.getAttribute(groupButton("a1"), "aria-expanded"),
    "true"
  )
  await click(groupButton("a"))
  await page.keyboard.press("Enter")
  await exists(treeRow(`member:a1:${id(3)}`))

  await click('[data-slot="card"] button', "多选")
  const firstCheck = `${treeRow(`member:root:${id(1)}`)} [role="checkbox"]`
  await click(firstCheck)
  await scroll("tree", true)
  const lastCheck = `${treeRow(`member:root:${id(size - 1)}`)} [role="checkbox"]`
  await exists(lastCheck)
  await click(lastCheck)
  await scroll("tree", false)
  await exists(firstCheck)
  assert.equal(await page.getAttribute(firstCheck, "aria-checked"), "true")
  await click('[data-slot="card"] button', "操作")
  await click('[role="menuitem"]', "禁用")
  await exists('[role="alertdialog"] button[type="submit"]')
  await click('[role="alertdialog"] button[type="submit"]')
  await page.waitForFunction(
    () => !document.querySelector('[role="alertdialog"]')
  )
  assert.deepEqual(
    writes
      .filter((write) => write.method === "PATCH")
      .map((write) => write.pathname.split("/").at(-1))
      .sort(),
    [id(1), id(size - 1)]
  )
  assert.ok(
    writes
      .filter((write) => write.method === "PATCH")
      .every((write) => write.body.status === "disabled")
  )
  await click('[data-slot="card-action"] button', "取消")

  await scroll("members", false)
  await exists(card(0))
  await page.evaluate(
    (selector) =>
      document.querySelector(selector).querySelector("button").focus(),
    card(0)
  )
  await scroll("members", true)
  assert.equal(
    await page.evaluate(
      (selector) =>
        document.querySelector(selector)?.contains(document.activeElement),
      card(0)
    ),
    true,
    "keyboard focus must survive scrolling"
  )
  await scroll("members", false)
  await click(`${card(0)} button`)
  await exists('[role="menu"]')
  await scroll("members", true)
  assert.equal(
    await page.evaluate(
      (selector) => !!document.querySelector(selector),
      card(0)
    ),
    true,
    "an open menu must retain its anchor"
  )
  await assertBounded()
  await page.keyboard.press("Escape")
  await scroll("members", false)
  await exists(card(0))
  await click(`${card(0)} button`)
  await click('[role="menuitem"]', "重置密码")
  await click('[role="alertdialog"] [data-slot="alert-dialog-action"]')
  await exists("#member-generated-password")
  assert.equal(
    await page.inputValue("#member-generated-password"),
    "temporary-test-password"
  )
  await click('[role="alertdialog"] button', "关闭")

  await page.evaluate((selector) => {
    const source = document
      .querySelector(selector)
      .querySelector('[data-slot="item-media"]')
    window.__dragSource = source
    window.__dragTransfer = new DataTransfer()
    source.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__dragTransfer,
      })
    )
  }, card(0))
  await scroll("members", true)
  assert.equal(
    await page.evaluate(() => window.__dragSource.isConnected),
    true,
    "dragging must retain its source"
  )
  await page.evaluate((selector) => {
    const target = document.querySelector(selector).firstElementChild
    target.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__dragTransfer,
      })
    )
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__dragTransfer,
      })
    )
    window.__dragSource.dispatchEvent(
      new DragEvent("dragend", {
        bubbles: true,
        dataTransfer: window.__dragTransfer,
      })
    )
  }, treeRow("group:b"))
  await exists('section > [role="status"] button')
  await click('section > [role="status"] button', "保存")
  await page.waitForFunction(
    () => !document.querySelector('section > [role="status"]')
  )
  const move = writes.find((write) => write.pathname.endsWith("/groups/move"))
  assert.deepEqual(move.body.members, [{ id: id(0) }])
  assert.equal(move.body.target_id, "b")

  await fillSearch("成员09999")
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="listitem"]').length === 1 &&
      document
        .querySelector('[role="listitem"]')
        .getAttribute("aria-setsize") === "1"
  )
  assert.equal(
    await page.evaluate(
      () =>
        document
          .querySelector('[data-slot="item-group"]')
          .closest('[data-slot="scroll-area-viewport"]').scrollTop
    ),
    0
  )
  await fillSearch("no-such-member")
  await page.waitForFunction(
    () => document.querySelectorAll('[role="listitem"]').length === 0
  )
  assert.ok((await page.textContent("body")).includes("没有找到成员"))
  await fillSearch("")
  await exists(card(0))
  await assertCardLayout()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  )
  await assertCardLayout()
  const mobile = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewports: [
      ...document.querySelectorAll(
        'section [data-slot="scroll-area-viewport"]'
      ),
    ].map((element) => ({
      height: element.clientHeight,
      content: element.scrollHeight,
    })),
  }))
  assert.ok(mobile.scrollWidth <= mobile.width, JSON.stringify(mobile))
  assert.ok(
    mobile.viewports.every(
      (viewport) =>
        viewport.height > 0 &&
        viewport.height <= 844 &&
        viewport.content > viewport.height
    ),
    JSON.stringify(mobile)
  )
  await scroll("members", true)
  await exists(card(size - 1))
  await scroll("tree", true)
  await exists(treeRow(`member:root:${id(size - 1)}`))
  await assertBounded()
  await assertCardLayout()
  assert.deepEqual(errors, [])
  console.log(
    `${await browser.version()}: 10,000 members; initial ${initial.cards} cards / ${initial.tree} tree rows / ${initial.dom} DOM nodes. Full-range scrolling, variable heights, persistent expansion and selection, menu/drag anchors, member actions, move payloads, search reset, empty results and mobile checks passed.`
  )
} finally {
  await browser.close()
}
