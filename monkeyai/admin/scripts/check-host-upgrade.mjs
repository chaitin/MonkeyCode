import assert from "node:assert/strict"
import { chromium } from "playwright-core"

// 使用已构建的当前页面，先启动 scripts/environment-fixture.mjs。
const base = process.env.FIXTURE_URL || "http://127.0.0.1:4187"
if (!process.env.CHROME_BIN) throw new Error("请设置 CHROME_BIN，并先构建当前页面、启动环境测试服务")
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true })
try {
  for (const scenario of ["automatic", "manual", "offline", "unsupported", "automatic-error", "manual-error", "current", "ahead", "unknown", "running", "pending"]) {
    const context = await browser.newContext({ locale: "zh-CN" })
    try {
      const page = await context.newPage()
      let host
      const upgrades = []
      const enrollments = []
      let commands = 0
      const command = "安装／升级命令（仅用于测试，禁止执行）"
      await page.route("**/api/admin/v1/engine-hosts?*", async route => {
        if (!host) {
          const response = await route.fetch()
          const data = await response.json()
          host = structuredClone(data.items[0])
          assert.ok(host?.upgrade, "测试宿主必须提供升级元数据")
          if (scenario === "pending") { host.status = "pending"; host.online = false }
          if (scenario === "offline") { host.online = false; host.upgrade.can_upgrade = false }
          if (scenario === "unsupported") { host.upgrade.supported = false; host.upgrade.can_upgrade = false }
          if (["current", "ahead", "unknown"].includes(scenario)) {
            host.upgrade.version_state = scenario
            host.upgrade.update_available = false
            host.upgrade.can_upgrade = false
          }
          if (scenario === "running") {
            host.upgrade.can_upgrade = false
            host.upgrade.task = { id: "fixture-task", version: host.upgrade.target_version, status: "pending", reason: "", updated_at: new Date().toISOString() }
          }
        }
        await route.fulfill({ json: { items: [host], total: 1 } })
      })
      await page.route("**/api/admin/v1/engine-hosts/*/upgrade", async route => {
        assert.equal(route.request().method(), "POST")
        upgrades.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
        if (scenario === "automatic-error") {
          await route.fulfill({ status: 409, json: { error: { message: "测试：目标版本已变化" } } })
          return
        }
        host.upgrade.can_upgrade = false
        host.upgrade.task = { id: "fixture-task", version: host.upgrade.target_version, status: "pending", reason: "", updated_at: new Date().toISOString() }
        await route.fulfill({ status: 202, json: {} })
      })
      await page.route("**/api/admin/v1/engine-upgrade", async route => {
        assert.equal(route.request().method(), "GET")
        commands++
        await route.fulfill(scenario === "manual-error"
          ? { status: 503, json: { error: { message: "测试：命令暂不可用" } } }
          : { json: { command } })
      })
      await page.route("**/api/admin/v1/engine-hosts/*/enrollment", async route => {
        assert.equal(scenario, "pending", "仅待接入宿主可重新生成安装命令")
        assert.equal(route.request().method(), "POST")
        assert.equal(new URL(route.request().url()).pathname, "/api/admin/v1/engine-hosts/" + host.id + "/enrollment")
        enrollments.push(host.id)
        host.id = "fixture-renewed-" + enrollments.length
        await route.fulfill({ json: { host_id: host.id, version: host.version, command, expires_at: new Date(Date.now() + 1800000).toISOString() } })
      })
      await page.goto(base + "/console/environments/cloud-hosts")
      await page.getByRole("button", { name: "开发宿主机", exact: true }).click()
      const details = page.getByRole("dialog", { name: "宿主机详情", exact: true })
      const footer = details.locator('[data-slot="dialog-footer"]')
      await footer.getByRole("button", { name: "关闭", exact: true }).waitFor()
      if (scenario === "pending") {
        for (let i = 1; i <= 2; i++) {
          await footer.getByRole("button", { name: "重新生成安装命令", exact: true }).click()
          const commandDialog = page.getByRole("dialog", { name: "安装命令", exact: true })
          await commandDialog.getByLabel("安装命令").waitFor()
          assert.equal(await commandDialog.getByLabel("安装命令").textContent(), command)
          assert.equal(enrollments.length, i, "每次点击只生成一次，后续使用新宿主ID")
          assert.equal(await commandDialog.getByRole("button", { name: "复制命令", exact: true }).isEnabled(), true)
          await commandDialog.getByRole("button", { name: "关闭", exact: true }).first().click()
          await commandDialog.waitFor({ state: "hidden" })
        }
        await footer.getByRole("button", { name: "关闭", exact: true }).click()
        await details.waitFor({ state: "hidden" })
        continue
      }
      assert.equal(await footer.getByRole("button", { name: "重新生成安装命令", exact: true }).count(), 0, "已接入宿主不展示安装命令入口")
      const trigger = details.getByRole("button", { name: "需要升级", exact: true })
      if (["current", "ahead", "unknown"].includes(scenario)) {
        assert.equal(await trigger.count(), 0, "无可用更新时不展示版本行升级入口")
        continue
      }
      await trigger.click()
      const choice = page.getByRole("dialog", { name: "升级引擎", exact: true })
      await choice.waitFor()
      assert.equal(upgrades.length, 0, "打开选择对话框不能自动下发升级")
      assert.equal(commands, 0, "打开选择对话框不能自动请求命令")
      if (scenario === "running") {
        assert.equal(await choice.getByRole("button", { name: "升级中", exact: true }).isDisabled(), true)
        assert.equal(await choice.getByRole("button", { name: "手动升级", exact: true }).count(), 0)
      } else if (["manual", "offline", "unsupported", "manual-error"].includes(scenario)) {
        if (scenario !== "manual" && scenario !== "manual-error") {
          assert.equal(await choice.getByRole("button", { name: "自动升级", exact: true }).isDisabled(), true)
        }
        await choice.getByRole("button", { name: "手动升级", exact: true }).click()
        const manualDialog = page.getByRole("dialog", { name: "手动升级", exact: true })
        await manualDialog.waitFor()
        if (scenario === "manual-error") {
          await manualDialog.getByRole("alert").filter({ hasText: "测试：命令暂不可用" }).waitFor()
        } else {
          await manualDialog.getByLabel("获取安装／升级命令").waitFor()
          assert.equal(await manualDialog.getByLabel("获取安装／升级命令").textContent(), command)
          assert.equal(await manualDialog.getByRole("button", { name: "复制命令", exact: true }).isEnabled(), true)
        }
        assert.equal(commands, 1)
        assert.equal(upgrades.length, 0, "手动升级不能下发自动升级任务")
        await manualDialog.getByRole("button", { name: "取消", exact: true }).first().click()
        await manualDialog.waitFor({ state: "hidden" })
        await choice.waitFor()
        assert.equal(await choice.getByLabel("获取安装／升级命令").count(), 0, "命令不应内嵌在升级方式对话框")
      } else {
        await choice.getByRole("button", { name: "自动升级", exact: true }).click()
        const confirmation = page.getByRole("alertdialog", { name: "确认升级", exact: true })
        await confirmation.waitFor()
        assert.equal(upgrades.length, 0, "自动升级必须等待二次确认")
        await confirmation.getByRole("button", { name: "确认", exact: true }).click()
        if (scenario === "automatic-error") {
          await confirmation.getByRole("alert").filter({ hasText: "测试：目标版本已变化" }).waitFor()
        } else {
          await confirmation.waitFor({ state: "hidden" })
          await choice.getByRole("status").filter({ hasText: "升级任务已下发" }).waitFor()
        }
        assert.deepEqual(upgrades, [{ path: "/api/admin/v1/engine-hosts/" + host.id + "/upgrade", body: { version: host.upgrade.target_version } }])
        assert.equal(commands, 0)
      }
      console.log("通过：" + scenario)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
