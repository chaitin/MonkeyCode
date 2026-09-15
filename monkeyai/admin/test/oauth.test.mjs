import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

test("login method switches remain visible and persist with authentication settings", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /pages\.otherSettings\.loginMethods\.password/)
  assert.match(source, /pages\.otherSettings\.loginMethods\.emailCode/)
  assert.match(source, /password_enabled: loginMethods\.passwordEnabled/)
  assert.match(source, /email_code_enabled: loginMethods\.emailCodeEnabled/)
})

test("DCR 发起授权后立即同步连接，取消或关闭弹窗不影响版本同步", async (t) => {
  const source = await readFile(
    new URL("../src/components/connector-credentials.tsx", import.meta.url),
    "utf8"
  )
  const tree = ts.createSourceFile(
    "component.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let handler
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "authorize"
    )
      handler = node.initializer.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(handler)
  const compiled = ts.transpileModule(`(${handler})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const scenario of [
    "取消授权",
    "弹窗被阻止",
    "刷新列表失败",
    "注册失败",
  ]) {
    await t.test(scenario, async () => {
      const events = []
      let pending
      let request
      const popup = {
        opener: {},
        location: { href: "about:blank" },
        close: () => events.push("close"),
      }
      const authorize = runInNewContext(compiled, {
        name: "凭证",
        lock: { current: false },
        credential: null,
        path: "/connectors/test",
        window: { open: () => (scenario === "弹窗被阻止" ? null : popup) },
        run: (action) => {
          pending = action()
        },
        api: async () => {
          events.push("register")
          if (scenario === "注册失败") throw new Error("注册失败")
          return {
            id: "auth",
            authorization_url: "https://oauth.example.com/authorize",
          }
        },
        setRequest: (value) => {
          request = value
        },
        onChange: async () => {
          events.push("reload")
          if (scenario === "刷新列表失败") throw new Error("刷新失败")
        },
      })
      authorize()
      if (scenario === "注册失败") {
        await assert.rejects(pending, /注册失败/)
        assert.deepEqual(events, ["register", "close"])
        assert.equal(request, undefined)
      } else {
        if (scenario === "刷新列表失败")
          await assert.rejects(pending, /刷新失败/)
        else await pending
        assert.deepEqual(events, ["register", "reload"])
        assert.equal(request.id, "auth")
        if (scenario !== "弹窗被阻止")
          assert.equal(popup.location.href, request.url)
      }
    })
  }
})

test("admin login lists configured OAuth providers and uses the admin flow", async () => {
  const [page, form] = await Promise.all([
    readFile(new URL("../src/pages/login-page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/login-form.tsx", import.meta.url),
      "utf8"
    ),
  ])

  assert.match(page, /\/api\/auth\/v1\/providers/)
  assert.match(page, /\/admin-start/)
  assert.match(form, /providers\.map/)
})
